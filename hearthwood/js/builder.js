// Placement controller: turns taps / drags into pieces on the grid.
// Tools: build · erase · paint · pick (eyedropper).

import * as THREE from 'three';
import {
  CELL, LEVEL_H, STEP, levelY, DIRS, K, MAX_LEVEL, GRID_MIN, GRID_MAX, clamp,
} from './config.js';
import { getDef, CATEGORIES, piecesIn } from './catalog.js';
import { state, events } from './state.js';
import { ghostMat, MATERIALS } from './materials.js';

const _ray = new THREE.Raycaster();
const _ndc = new THREE.Vector2();
const _plane = new THREE.Plane();
const _hit = new THREE.Vector3();
const _box = new THREE.Box3();
const _hit2 = new THREE.Vector3();

const LS_TIPS = 'hearthwood.tips';
const TOUCH_TIP_MS = 6000;        // undo this soon after a touch placement → suggest press-and-hold
/** Wall-like pieces that can hold up a roof (garden fences, hedges and railings can't). */
const holdsRoof = (def) => !!def && (def.layer === 'B' || def.cat === 'walls' || def.cat === 'openings');

export class Builder {
  constructor(app) {
    this.app = app;
    const { scene, rig, world } = app;
    this.scene = scene;
    this.world = world;
    this.rig = rig;
    this.target = null;
    this.ghost = null;
    this.ghostSig = null;
    this.ghostVisible = false;
    this.drawing = null;
    this._touch = false;            // last placement input was a finger (haptics, tips)
    this._lastTouchPlace = 0;
    this._tapRun = 0;               // consecutive single-tap edge placements (draw-mode tip)
    this._tips = null;
    this._gc = null;                // cached gable candidates
    this._top = null;               // cached highest structural level
    this._gbp = null;               // cached blueprint pieces for guide snapping

    this._makeHelpers();
    rig.onTap = (x, y, e) => this.tap(x, y, e);
    rig.onHover = (x, y) => this.hover(x, y);
    rig.onPress = (x, y) => this.press(x, y);
    rig.onAimStart = (x, y) => this.aimStart(x, y);
    rig.onAimMove = (x, y) => this.hover(x, y);
    rig.onAimEnd = (x, y, cancelled, e) => this.aimEnd(x, y, cancelled, e);
    rig.onDrawStart = (x, y) => this.drawStart(x, y);
    rig.onDrawMove = (x, y) => this.drawMove(x, y);
    rig.onDrawEnd = () => this.drawEnd();
    rig.onDrawCancel = () => this.drawCancel();
    rig.onGestureStart = () => this.hideGhost();
    rig.pickPoint = (x, y) => this.pointAt(x, y);
    rig.orbitPoint = (x, y) => this.orbitAt(x, y);
    state.on((changed) => this._onState(changed));
    window.addEventListener('keydown', (e) => this._key(e));
    this._applyLevel(true);
  }

  // ---------------------------------------------------------------- helpers

  _makeHelpers() {
    const size = (GRID_MAX - GRID_MIN + 1) * CELL;
    const center = ((GRID_MIN + GRID_MAX + 1) / 2) * CELL;
    const grid = new THREE.GridHelper(size, GRID_MAX - GRID_MIN + 1, 0xffffff, 0xffffff);
    grid.material.transparent = true;
    grid.material.opacity = 0.28;
    grid.material.depthWrite = false;
    grid.position.set(center, 0, center);
    grid.renderOrder = 2;
    this.grid = grid;
    this.scene.add(grid);

    const markerMat = new THREE.MeshBasicMaterial({ color: 0xfff3c4, transparent: true, opacity: 0.55, depthWrite: false });
    this.markerMat = markerMat;
    this.markers = {
      cell: new THREE.Mesh(new THREE.BoxGeometry(CELL * 0.96, 0.03, CELL * 0.96), markerMat),
      edge: new THREE.Mesh(new THREE.BoxGeometry(CELL, 0.05, 0.32), markerMat),
      corner: new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.05, 16), markerMat),
    };
    for (const m of Object.values(this.markers)) { m.visible = false; m.renderOrder = 3; this.scene.add(m); }
  }

  _onState(changed) {
    if (changed.includes('pieceId')) { const d = getDef(state.pieceId); if (d) (this._lastInCat ||= {})[d.cat] = d.id; }
    if (changed.includes('level') || changed.includes('seeAll')) this._applyLevel();
    if (changed.some((k) => ['pieceId', 'rot', 'tool', 'hOffset', 'mats', 'colors', 'accent', 'level'].includes(k))) {
      if (this.target && this.lastScreen && this.ghostVisible) this.hover(this.lastScreen.x, this.lastScreen.y);
      else this.hideGhost();
    }
    if (changed.includes('drawMode')) this.rig.drawMode = state.drawMode;
    if (changed.includes('tool')) this.grid.visible = state.tool === 'build' && !state.photoMode;
    if (changed.includes('photoMode')) { this.grid.visible = !state.photoMode && state.tool === 'build'; this.hideGhost(); }
  }

  _applyLevel(immediate = false) {
    const y = levelY(state.level);
    this.grid.position.y = y + 0.01;
    this.world.setView(state.level, state.seeAll);
    this.rig.setTargetY(y + 0.6);
    if (immediate) this.rig.snap();
  }

  // ---------------------------------------------------------------- picking

  _setRay(sx, sy) {
    const el = this.app.renderer.domElement;
    _ndc.set((sx / el.clientWidth) * 2 - 1, -(sy / el.clientHeight) * 2 + 1);
    _ray.setFromCamera(_ndc, this.app.camera);
    return _ray;
  }

  rayPlane(sx, sy, y) {
    this._setRay(sx, sy);
    _plane.set(new THREE.Vector3(0, 1, 0), -y);
    const p = _ray.ray.intersectPlane(_plane, _hit);
    return p ? p.clone() : null;
  }

  pickPiece(sx, sy) {
    this._setRay(sx, sy);
    return this.world.pick(_ray);
  }

  /** World point under a screen position (a visible piece, else the active level's plane). Used as gesture pivot. */
  pointAt(sx, sy) {
    const pick = this.pickPiece(sx, sy);
    if (pick) return pick.point.clone();
    return this.rayPlane(sx, sy, levelY(state.level));
  }

  /**
   * Point to turn the view around for what's under (sx, sy): the middle of the building there along the
   * line of sight (so a house spins in place instead of swinging about its front wall). Null over open meadow.
   */
  orbitAt(sx, sy) {
    const pick = this.pickPiece(sx, sy);
    if (!pick) return null;
    const occ = this._occupied();
    const ray = _ray.ray;
    const start = pick.point.distanceTo(ray.origin);
    const P = pick.point;
    if (!occ.cells.has(`${Math.floor(P.x / CELL)}|${Math.floor(P.z / CELL)}`)) return P.clone();
    let last = start, out = 0;
    for (let d = start + 0.5; d < start + 24; d += 0.5) {
      ray.at(d, _hit2);
      const inside = _hit2.y > -0.5 && _hit2.y < occ.top && occ.cells.has(`${Math.floor(_hit2.x / CELL)}|${Math.floor(_hit2.z / CELL)}`);
      if (inside) { last = d; out = 0; } else if (++out > 4) break;
    }
    return ray.at((start + last) / 2, new THREE.Vector3());
  }

  /** Cells covered by buildings (not garden things), plus the roof-top height. Cached per world version. */
  _occupied() {
    const v = this.world.version;
    if (this._occ && this._occ.v === v) return this._occ;
    const cells = new Set();
    let top = 0;
    for (const e of this.world.entries.values()) {
      const d = e.def, p = e.p;
      if (d.cat === 'garden' || d.id === 'path') continue;
      if (d.slot === 'cell') cells.add(`${p.x}|${p.z}`);
      else if (d.slot === 'edge') {
        cells.add(`${p.x}|${p.z}`);
        cells.add(p.a === 'x' ? `${p.x}|${p.z - 1}` : `${p.x - 1}|${p.z}`);
      } else {
        for (const [dx, dz] of [[0, 0], [-1, 0], [0, -1], [-1, -1]]) cells.add(`${p.x + dx}|${p.z + dz}`);
      }
      const y = levelY(p.y) + (d.layer === 'R' ? ((p.h || 0) + (d.roof?.rise ?? 1)) * STEP : LEVEL_H);
      if (y > top) top = y;
    }
    this._occ = { v, cells, top: top + 0.5 };
    return this._occ;
  }

  // ---------------------------------------------------------------- smart slots

  /** Blueprint guides: the missing slot (of the selected piece type) whose glowing guide is under the ray. */
  _guideSlot(def, pick) {
    const id = state.blueprint;
    if (!id) return null;
    if (!this._gbp || this._gbp.id !== id) {
      let pieces = null;
      try { pieces = this.app.blueprints?.get?.(id)?.pieces || null; } catch { pieces = null; }
      const keys = new Map();
      if (pieces) for (const q of pieces) keys.set(this.world.keyOf(q), q);
      this._gbp = { id, pieces, keys };
    }
    const pieces = this._gbp.pieces;
    if (!pieces) return null;
    const ray = _ray.ray;
    let best = null, bestD = Infinity;
    for (const q of pieces) {
      if (q.t !== def.id) continue;
      if (!state.seeAll && q.y > state.level) continue;
      const cur = this.world.get(this.world.keyOf(q));
      if (cur && cur.t === q.t && (cur.r || 0) === (q.r || 0)) continue;     // already built
      this._slotBox(def, q, _box);
      const hit = ray.intersectBox(_box, _hit2);
      if (!hit) continue;
      const d = hit.distanceTo(ray.origin);
      if (d < bestD) { bestD = d; best = q; }
    }
    if (!best) return null;
    // a placed piece clearly in front of the guide wins (the player tapped that piece) — unless it already is
    // the piece in hand, where a tap would change nothing: then they meant the guide peeking out behind it
    // or it's a finished piece of this very blueprint (re-tapping it could only spoil it)
    if (pick && pick.point.distanceTo(ray.origin) + 0.6 < bestD && pick.entry.p.t !== def.id
      && this._gbp.keys.get(pick.entry.key)?.t !== pick.entry.p.t) return null;
    const out = { x: best.x, y: best.y, z: best.z };
    for (const f of ['a', 'r', 'h', 's']) if (best[f] !== undefined) out[f] = best[f];
    return out;
  }

  /** Does the active blueprint still have an unbuilt (visible) guide for this piece type? */
  _guidesLeft(def) {
    if (!state.blueprint || !this._gbp || this._gbp.id !== state.blueprint || !this._gbp.pieces) return false;
    for (const q of this._gbp.pieces) {
      if (q.t !== def.id) continue;
      const cur = this.world.get(this.world.keyOf(q));
      if (!(cur && cur.t === q.t && (cur.r || 0) === (q.r || 0))) return true;
    }
    return false;
  }

  /** Generous pick box around a slot (for guide snapping). */
  _slotBox(def, q, box) {
    const y0 = levelY(q.y);
    if (def.slot === 'cell') {
      const x0 = q.x * CELL, z0 = q.z * CELL;
      let lo = y0 - 0.35, hi = y0 + 0.3;
      if (def.layer === 'R') { lo = y0 + (q.h || 0) * STEP - 0.1; hi = lo + (def.roof?.rise ?? 1) * STEP + 0.5; }
      else if (def.layer === 'I' || def.layer === 'D') { lo = y0 - 0.1; hi = y0 + 1.4; }
      box.min.set(x0, lo, z0); box.max.set(x0 + CELL, hi, z0 + CELL);
    } else if (def.slot === 'edge') {
      const t = 0.35;
      let lo = y0 - 0.1, hi = y0 + LEVEL_H;
      if (def.autoGable) hi = y0 + ((q.h || 0) + (q.s || 1)) * STEP + 0.15;
      if (def.layer === 'B') { lo = y0 + LEVEL_H - 0.6; hi = y0 + LEVEL_H + 0.15; }
      if (q.a === 'z') { box.min.set(q.x * CELL - t, lo, q.z * CELL); box.max.set(q.x * CELL + t, hi, (q.z + 1) * CELL); }
      else { box.min.set(q.x * CELL, lo, q.z * CELL - t); box.max.set((q.x + 1) * CELL, hi, q.z * CELL + t); }
    } else {
      box.min.set(q.x * CELL - 0.4, y0 - 0.1, q.z * CELL - 0.4); box.max.set(q.x * CELL + 0.4, y0 + LEVEL_H, q.z * CELL + 0.4);
    }
    return box;
  }

  /** Window / door tapped onto a wall of ANOTHER (visible) floor: swap that wall rather than the active floor's edge. */
  _swapAcross(def, e, pick) {
    if (def.cat !== 'openings' || e.def.layer !== 'W' || def.layer !== 'W') return false;
    if (e.def.id === def.id || e.p.y === state.level) return false;
    return pick.point.y < levelY(e.p.y) + LEVEL_H - 0.45;   // not the top rim (that means "build on top")
  }

  /** Highest level that has anything structural (walls, beams, posts). Cached per world version. */
  _topLevel() {
    const v = this.world.version;
    if (this._top && this._top.v === v) return this._top.y;
    let y = -1;
    for (const e of this.world.entries.values()) {
      if ((e.def.layer === 'P' || holdsRoof(e.def)) && e.p.y > y) y = e.p.y;
    }
    this._top = { v, y };
    return y;
  }

  /** Is cell (x, z) a sensible spot for a roof based on level y (i.e. on top of level y-1 walls)? */
  _roofSupported(x, y, z) {
    const W = this.world, b = y - 1;
    const has = (k) => { const q = W.get(k); return q && holdsRoof(getDef(q.t)); };
    if (has(K.W('x', x, b, z)) || has(K.W('x', x, b, z + 1)) || has(K.W('z', x, b, z)) || has(K.W('z', x + 1, b, z))) return true;
    if (has(K.B('x', x, b, z)) || has(K.B('x', x, b, z + 1)) || has(K.B('z', x, b, z)) || has(K.B('z', x + 1, b, z))) return true;
    if (W.get(K.P(x, b, z)) || W.get(K.P(x + 1, b, z)) || W.get(K.P(x, b, z + 1)) || W.get(K.P(x + 1, b, z + 1))) return true;
    // continues a roof that already sits on this level
    for (let hs = 2 * y; hs <= 2 * y + 8; hs++) {
      if (W.get(K.R(x, hs, z)) || W.get(K.R(x - 1, hs, z)) || W.get(K.R(x + 1, hs, z)) || W.get(K.R(x, hs, z - 1)) || W.get(K.R(x, hs, z + 1))) return true;
    }
    // inside a walled footprint (walls found in all four directions)
    const N = 10;
    const dirs = [
      (i) => has(K.W('z', x - i, b, z)), (i) => has(K.W('z', x + 1 + i, b, z)),
      (i) => has(K.W('x', x, b, z - i)), (i) => has(K.W('x', x, b, z + 1 + i)),
    ];
    for (const f of dirs) {
      let found = false;
      for (let i = 0; i < N && !found; i++) found = f(i);
      if (!found) return false;
    }
    return true;
  }

  /** Base level for a roof piece under the finger: the top of the walls you're pointing at. */
  _roofLevel(sx, sy) {
    const top = this._topLevel();
    if (top < 0) return null;
    const maxY = Math.min(MAX_LEVEL, top + 1, state.seeAll ? MAX_LEVEL : state.level + 1);
    for (let y = maxY; y >= 1; y--) {
      const hit = this.rayPlane(sx, sy, levelY(y));
      if (!hit) continue;
      if (this._roofSupported(Math.floor(hit.x / CELL), y, Math.floor(hit.z / CELL))) return y;
    }
    return null;
  }

  /** Open roof ends: edges beside a visible slope panel where the roof doesn't carry on. Cached per world/view. */
  _gableCandidates() {
    const W = this.world;
    const sig = `${W.version}|${state.seeAll}|${state.level}`;
    if (this._gc && this._gc.sig === sig) return this._gc.list;
    const list = [];
    const seen = new Set();
    for (const e of W.entries.values()) {
      if (e.def.layer !== 'R' || (e.def.roof?.kind || 'slope') !== 'slope' || !e.obj.visible) continue;
      const q = e.p, hs = 2 * q.y + (q.h || 0), r = q.r || 0;
      const gy = Math.floor(hs / 2);
      const sides = (r === 0 || r === 2)
        ? [['z', q.x, q.z, q.x - 1, q.z], ['z', q.x + 1, q.z, q.x + 1, q.z]]
        : [['x', q.x, q.z, q.x, q.z - 1], ['x', q.x, q.z + 1, q.x, q.z + 1]];
      for (const [a, x, z, nx, nz] of sides) {
        const n = W.get(K.R(nx, hs, nz));
        if (n && (n.r || 0) === r && (getDef(n.t)?.roof?.kind || 'slope') === 'slope') continue;   // roof carries on
        const k = `${a}|${x}|${z}|${gy}`;
        if (seen.has(k)) continue;
        seen.add(k);
        list.push({ a, x, z, y: gy, top: (hs - 2 * gy + (e.def.roof?.rise ?? 1)) * STEP, rx: q.x, rz: q.z });
      }
    }
    this._gc = { sig, list };
    return list;
  }

  /** Gable pieces: the open roof end the player points at (triangle, roof panel beside it, or wall below it). */
  _gableSlot(pick) {
    const cands = this._gableCandidates();
    if (!cands.length) return null;
    const ray = _ray.ray;
    if (pick) {
      const e = pick.entry;
      // the roof panel itself → its nearest open end
      if (e.def.layer === 'R') {
        let best = null, bd = Infinity;
        for (const c of cands) {
          if (c.rx !== e.p.x || c.rz !== e.p.z) continue;
          const d = c.a === 'z' ? Math.abs(pick.point.x - c.x * CELL) : Math.abs(pick.point.z - c.z * CELL);
          if (d < bd) { bd = d; best = c; }
        }
        if (best) return best;
      }
      // the wall right under an open end
      if (e.def.layer === 'W' && !e.def.autoGable) {
        const c = cands.find((c) => c.a === e.p.a && c.x === e.p.x && c.z === e.p.z && c.y === e.p.y + 1);
        if (c) return c;
      }
    }
    // the open triangle itself
    const o = ray.origin, dir = ray.direction;
    let best = null, bestT = Infinity;
    for (const c of cands) {
      const y0 = levelY(c.y);
      let t, along;
      if (c.a === 'z') {
        if (Math.abs(dir.x) < 1e-6) continue;
        t = (c.x * CELL - o.x) / dir.x;
        along = o.z + dir.z * t - c.z * CELL;
      } else {
        if (Math.abs(dir.z) < 1e-6) continue;
        t = (c.z * CELL - o.z) / dir.z;
        along = o.x + dir.x * t - c.x * CELL;
      }
      if (t <= 0 || t >= bestT) continue;
      const y = o.y + dir.y * t;
      if (along < -0.1 || along > CELL + 0.1 || y < y0 - 0.15 || y > y0 + c.top + 0.2) continue;
      best = c; bestT = t;
    }
    if (best && (!pick || bestT <= pick.point.distanceTo(o) + 0.3)) return best;
    return null;
  }

  // ---------------------------------------------------------------- records

  materialFor(def) {
    if (!def.mats || !def.mats.length) return undefined;
    const m = state.mats[def.matGroup];
    return def.mats.includes(m) ? m : def.mats[0];
  }

  colorFor(def, m) {
    if (!def.paint && !def.paintAlways) return undefined;
    if (!def.paintAlways && !MATERIALS[m]?.paintable) return undefined;
    return state.colors[m || def.id] || undefined;
  }

  /** Resolve the slot under a screen point for the current piece. Returns { p, def, key, valid, reason } or null. */
  resolve(sx, sy) {
    const def = getDef(state.pieceId);
    if (!def) return null;
    const L = state.level;
    const pick = this.pickPiece(sx, sy);     // also aims _ray at (sx, sy)
    const p = { t: def.id, y: L };
    let fixed = false;      // true: slot decided · 'roof': keep the tapped panel's height · 'guide': copy the blueprint
    let px, pz;

    // 1. blueprint guides under the finger
    const g = this._guideSlot(def, pick);
    if (g) { Object.assign(p, g); fixed = 'guide'; }
    // 2. gables find the open roof end you point at, whatever floor is active
    if (!fixed && def.autoGable) {
      const c = this._gableSlot(pick);
      if (c) { p.a = c.a; p.x = c.x; p.z = c.z; p.y = c.y; fixed = true; }
    }
    // 3. the piece under the finger
    if (!fixed && pick) {
      const e = pick.entry;
      // a stroke follows the floor grid: walls standing in the way (same piece, or across the stroke's line)
      // must not hijack it into cross walls
      const dr = this.drawing;
      const skip = dr && (e.def.id === def.id || (dr.axis && e.p.a !== dr.axis));
      if (def.slot === 'edge' && e.def.slot === 'edge' && !skip) {
        if (e.p.y === L || this._swapAcross(def, e, pick)) { p.a = e.p.a; p.x = e.p.x; p.z = e.p.z; p.y = e.p.y; fixed = true; }
      } else if (def.slot === 'corner' && (e.def.slot === 'edge' || e.def.slot === 'corner') && e.p.y === L) {
        px = pick.point.x; pz = pick.point.z;
      } else if (def.layer === 'R' && e.def.layer === 'R' && !(dr && e.def.layer === def.layer)) {
        // (a stroke paints a row on the wall tops; it never flips the panels it passes over)
        p.x = e.p.x; p.z = e.p.z; p.y = e.p.y; p.h = e.p.h; fixed = 'roof';
      } else if (def.cat === 'roof' && def.slot === 'cell' && def.layer !== 'R' && e.def.layer === 'R') {
        // chimney tapped onto the roof: stand it in that spot on the storey under the roof
        p.x = e.p.x; p.z = e.p.z; p.y = Math.max(0, e.p.y - 1); fixed = true;
      }
    }
    // 4. roofs settle on top of the walls under the finger (any floor); a draw stroke keeps its first level
    if (!fixed && def.layer === 'R') {
      let lv = this.drawing ? this.drawing.roofLevel : undefined;
      if (lv === undefined) {
        lv = this._roofLevel(sx, sy);
        if (this.drawing) this.drawing.roofLevel = lv;
      }
      if (lv !== null && lv !== undefined) p.y = lv;
    }
    if (!fixed) {
      if (px === undefined) {
        const hit = this.rayPlane(sx, sy, levelY(p.y));
        if (!hit) return null;
        px = hit.x; pz = hit.z;
      }
      if (def.slot === 'cell') {
        p.x = Math.floor(px / CELL); p.z = Math.floor(pz / CELL);
      } else if (def.slot === 'corner') {
        p.x = Math.round(px / CELL); p.z = Math.round(pz / CELL);
      } else {
        const fx = px / CELL, fz = pz / CELL;
        const cx = Math.floor(fx), cz = Math.floor(fz);
        const u = fx - cx, v = fz - cz;
        const lock = this.drawing?.axis;
        const cand = [
          { a: 'x', x: cx, z: cz, d: v },
          { a: 'x', x: cx, z: cz + 1, d: 1 - v },
          { a: 'z', x: cx, z: cz, d: u },
          { a: 'z', x: cx + 1, z: cz, d: 1 - u },
        ].filter((c) => !lock || c.a === lock);
        cand.sort((m, n) => m.d - n.d);
        Object.assign(p, { a: cand[0].a, x: cand[0].x, z: cand[0].z });
      }
    }
    if (fixed === 'guide') {
      // follow the blueprint exactly (facing, roof height, gable shape)
      if (def.rot !== 'none' && p.r === undefined) p.r = 0;
    } else {
      if (def.rot === 'four') p.r = state.rot & 3;
      else if (def.rot === 'flip') p.r = state.rot >= 2 ? 2 : 0;
      if (def.layer === 'R') {
        if (fixed !== 'roof') p.h = this.autoRoofHeight(def, p.x, p.z, p.r, p.y);
        p.h = clamp((p.h || 0) + (fixed === 'roof' ? 0 : state.hOffset), 0, 9);
      }
      if (def.autoGable) Object.assign(p, this.autoGable(def, p));
    }

    const m = this.materialFor(def);
    if (m) p.m = m;
    const c = this.colorFor(def, m);
    if (c) p.c = c;
    if (def.accent) p.k = state.accent;

    const q = this.world.normalize(p);
    if (!q) return null;
    const v = this.world.validate(q);
    const key = this.world.keyOf(q);
    const out = { p: q, def, key, valid: v.ok, reason: v.reason, existing: this.world.get(key) };
    // following a blueprint: while this piece still has glowing guides, only they take it (no stray pieces from mis-taps)
    if (fixed !== 'guide' && v.ok && this._guidesLeft(def)) {
      out.valid = false;
      out.offGuide = true;
      out.reason = '✨ Tap a glowing guide — or Stop guides to build freely';
    }
    return out;
  }

  /** Auto height (in half-steps above the level) so roof panels continue the slope below them. */
  autoRoofHeight(def, x, z, r, L) {
    const base = L * 2;
    const kind = def.roof?.kind || 'slope';
    if (kind === 'flat' || kind === 'cap') return 0;
    const [dx, dz] = DIRS[r];
    const [ex, ez] = DIRS[(r + 1) & 3];
    if (kind === 'inner') {
      // a valley sits level with the slopes beside it, or stacks diagonally on a valley below it
      let best = -1;
      for (let hs = base; hs <= base + 12; hs++) {
        const d = this.world.get(K.R(x - dx - ex, hs, z - dz - ez));
        const dd = d && getDef(d.t);
        if (dd?.roof?.kind === 'inner' && d.r === r) best = Math.max(best, hs + (dd.roof.rise ?? 1));
        for (const [cx, cz, rr] of [[x - dx, z - dz, (r + 1) & 3], [x - ex, z - ez, r]]) {
          const q = this.world.get(K.R(cx, hs, cz));
          const qd = q && getDef(q.t);
          if (qd?.roof && (qd.roof.kind || 'slope') === 'slope' && q.r === rr) best = Math.max(best, hs);
        }
      }
      return best < 0 ? 0 : best - base;
    }
    const probes = kind === 'slope'
      ? [[x - dx, z - dz]]
      : [[x - dx - ex, z - dz - ez], [x - dx, z - dz], [x - ex, z - ez]];
    let best = -1;
    for (const [cx, cz] of probes) {
      for (let hs = base; hs <= base + 12; hs++) {
        const q = this.world.get(K.R(cx, hs, cz));
        if (!q) continue;
        const qd = getDef(q.t);
        const qk = qd?.roof?.kind || 'slope';
        if (qk === 'flat' || qk === 'cap') continue;
        const sameDir = q.r === r;
        if (kind === 'slope' && !sameDir) continue;
        if (kind !== 'slope' && !(sameDir && (qk === kind))) {
          // corners stacking diagonally need same kind & rotation; straight probes accept slopes
          if (qk !== 'slope') continue;
          if (!(q.r === r || q.r === ((r + 1) & 3))) continue;
        }
        const top = hs + (qd.roof?.rise ?? 1);
        if (top > best) best = top;
      }
    }
    return best < 0 ? 0 : best - base;
  }

  /** Auto-fit a gable piece to the roof panels resting on/over its edge. Returns { h, s, r }. */
  autoGable(def, p) {
    const L = p.y;
    const cells = p.a === 'x' ? [[p.x, p.z - 1], [p.x, p.z]] : [[p.x - 1, p.z], [p.x, p.z]];
    const along = p.a === 'x' ? [1, 3] : [0, 2];
    let found = null;
    for (let hs = L * 2; hs <= L * 2 + 12 && !found; hs++) {
      for (const [cx, cz] of cells) {
        const q = this.world.get(K.R(cx, hs, cz));
        if (!q) continue;
        const qd = getDef(q.t);
        if ((qd?.roof?.kind || 'slope') !== 'slope' || !along.includes(q.r)) continue;
        found = { hs, q, rise: qd.roof?.rise ?? 1 };
        break;
      }
    }
    if (!found) return { h: p.h || 0, s: p.s || 1 };
    let r;
    if (p.a === 'x') r = found.q.r === 1 ? 0 : 2;     // local +X == world +X when r=0
    else r = found.q.r === 2 ? 0 : 2;                 // local +X == world -Z when r=0 (axis z)
    return { h: found.hs - L * 2, s: found.rise, r };
  }

  // ---------------------------------------------------------------- ghost

  hover(sx, sy) {
    if (sx === null || state.photoMode) { this.hideGhost(); return; }
    this.lastScreen = { x: sx, y: sy };
    if (state.tool !== 'build') {
      this.hideGhost();
      this._hoverPick(sx, sy);
      return;
    }
    const t = this.resolve(sx, sy);
    this.target = t;
    if (!t) { this.hideGhost(); return; }
    this._showGhost(t);
  }

  _hoverPick(sx, sy) {
    // subtle highlight of the piece under the pointer for erase / paint / pick
    const pick = this.pickPiece(sx, sy);
    if (this._hl && (!pick || pick.entry.obj !== this._hl.obj)) { this._setHighlight(null); }
    if (pick && (!this._hl || pick.entry.obj !== this._hl.obj)) this._setHighlight(pick.entry);
  }

  _setHighlight(entry) {
    // one Box3Helper, reused (a new helper per hover change leaked its geometry & material on every move)
    this._hl = entry ? { obj: entry.obj } : null;
    if (!entry) { if (this._hlBox) this._hlBox.visible = false; return; }
    if (!this._hlBox) {
      this._hlBox = new THREE.Box3Helper(new THREE.Box3(), 0xfff0b0);
      this._hlBox.material.depthTest = false;
      this._hlBox.renderOrder = 10;
      this.scene.add(this._hlBox);
    }
    this._hlBox.box.setFromObject(entry.obj);
    this._hlBox.material.color.set(state.tool === 'erase' ? 0xff8a7a : 0xfff0b0);
    this._hlBox.visible = true;
  }

  _showGhost(t) {
    const { p, def } = t;
    const sig = def.contextual ? JSON.stringify(p) : `${p.t}|${p.m}|${p.h}|${p.s}|${p.a}|${p.r}|${t.valid}`;
    if (sig !== this.ghostSig) {
      if (this.ghost) this.scene.remove(this.ghost);
      const g = this.world.buildPlaced(p);
      const gm = ghostMat(t.valid);
      g.traverse((o) => {
        if (o.isMesh) { o.material = gm; o.castShadow = false; o.receiveShadow = false; o.renderOrder = 5; }
      });
      g.userData.ghost = true;
      this.ghost = g;
      this.ghostSig = sig;
      this.scene.add(g);
    }
    this.world.placeTransform(p, def, this.ghost);
    this.ghost.visible = true;
    this.ghostVisible = true;
    // marker
    for (const m of Object.values(this.markers)) m.visible = false;
    const mk = this.markers[def.slot];
    const y = levelY(p.y) + (def.layer === 'R' ? (p.h || 0) * STEP : 0) + 0.03;
    if (def.slot === 'cell') mk.position.set((p.x + 0.5) * CELL, y, (p.z + 0.5) * CELL);
    else if (def.slot === 'corner') mk.position.set(p.x * CELL, y, p.z * CELL);
    else {
      if (p.a === 'z') { mk.position.set(p.x * CELL, y, (p.z + 0.5) * CELL); mk.rotation.y = Math.PI / 2; }
      else { mk.position.set((p.x + 0.5) * CELL, y, p.z * CELL); mk.rotation.y = 0; }
    }
    this.markerMat.color.set(t.valid ? 0xfff3c4 : 0xff9a8a);
    mk.visible = true;
  }

  hideGhost() {
    if (this.ghost) this.ghost.visible = false;
    this.ghostVisible = false;
    for (const m of Object.values(this.markers)) m.visible = false;
    if (this._hl) this._setHighlight(null);
  }

  // ---------------------------------------------------------------- actions

  tap(sx, sy, e) {
    if (state.photoMode) return;
    this.lastScreen = { x: sx, y: sy };
    const touch = !!e && e.pointerType !== undefined && e.pointerType !== 'mouse';
    this._touch = touch;
    switch (state.tool) {
      case 'build': {
        const t = this.resolve(sx, sy);
        if (!t) { if (touch) this.hideGhost(); return; }
        if (!t.valid) { this._fail(t.reason); if (touch) this.hideGhost(); return; }
        const entry = this.place(t.p);
        this.hideGhost();
        if (entry) this._afterPlace(t, touch, false);
        break;
      }
      case 'erase': if (this.eraseAt(sx, sy) && touch) this._buzz(8); break;
      case 'paint': if (this.paintAt(sx, sy) && touch) this._buzz(6); break;
      case 'pick': if (this.pickAt(sx, sy) && touch) this._buzz(6); break;
    }
    if (touch && state.tool !== 'build') this.hideGhost();
  }

  /** Touch: show what a tap here would do as soon as the finger lands. */
  press(sx, sy) {
    if (state.photoMode) return;
    this.hover(sx, sy);
  }

  /** Press-and-hold: the preview follows the finger until it lifts. */
  aimStart(sx, sy) {
    if (state.photoMode) return;
    this.hover(sx, sy);
    this._buzz(5);
  }

  aimEnd(sx, sy, cancelled, e) {
    if (cancelled) { this.hideGhost(); return; }
    this.tap(sx, sy, e || { pointerType: 'touch' });
  }

  /** Feedback & gentle teaching after a piece lands. */
  _afterPlace(t, touch, stroke) {
    // a piece placed above the cutaway would vanish: show every floor
    if (!state.seeAll && t.p.y > state.level) {
      state.set({ seeAll: true });
      events.emit('toast', { text: '👁️ Showing every floor so you can see it', kind: 'info', ms: 2200 });
    }
    if (t.def.layer === 'R' && t.p.y !== state.level) this._tip('roofauto', '🏠 Roof pieces settle on top of your walls by themselves — no need to change floors.');
    if (!touch) return;
    this._buzz(stroke ? 4 : 9);
    this._lastTouchPlace = performance.now();
    if (stroke) return;
    // several single taps of wall-like pieces in Look mode → suggest Draw
    if (t.def.slot === 'edge' && !state.drawMode) {
      const now = performance.now();
      this._tapRun = now - (this._tapRunT || 0) < 15000 ? this._tapRun + 1 : 1;
      this._tapRunT = now;
      if (this._tapRun >= 4) this._tip('draw', '✏️ Tip: switch ✋ Look to ✏️ Draw on the right, then drag a finger to lay a whole row at once.');
    }
  }

  _buzz(ms) {
    try { if (navigator.vibrate) navigator.vibrate(ms); } catch { /* not supported */ }
  }

  /** Show a one-time tip (remembered per device). */
  _tip(id, text, ms = 5200) {
    if (!this._tips) {
      try { this._tips = JSON.parse(localStorage.getItem(LS_TIPS) || '{}') || {}; } catch { this._tips = {}; }
    }
    if (this._tips[id]) return false;
    this._tips[id] = 1;
    try { localStorage.setItem(LS_TIPS, JSON.stringify(this._tips)); } catch { /* ignore */ }
    events.emit('toast', { text, kind: 'info', ms });
    return true;
  }

  /** Place a record (replacing whatever shares its slot). Returns the entry or null. */
  place(p, opts = {}) {
    const before = this.world.get(this.world.keyOf(p));
    const entry = this.world.add(p, opts);
    if (!entry) return null;
    if (before && entry.p === before) return entry; // identical — nothing changed
    if (opts.animate !== false) {
      this.app.effects.popIn(entry.obj);
      this.app.effects.puff(entry.obj.position.clone().setY(entry.obj.position.y + 0.15), 0xf3ead8, 8);
    }
    if (!opts.silent) events.emit('sfx', { name: before ? 'replace' : 'place', flavor: entry.def.sound });
    events.emit('placed', { p: entry.p, def: entry.def, replaced: before || null });
    return entry;
  }

  eraseAt(sx, sy) {
    const pick = this.pickPiece(sx, sy);
    if (!pick) return false;
    const { entry } = pick;
    const pos = entry.obj.position.clone();
    this.world.remove(entry.key);
    this.app.effects.puff(pos.setY(pos.y + 0.4), 0xe8dcc8, 12, 1.2);
    events.emit('sfx', { name: 'remove', flavor: entry.def.sound });
    if (this._hl) this._setHighlight(null);
    return true;
  }

  paintAt(sx, sy) {
    const pick = this.pickPiece(sx, sy);
    if (!pick) return false;
    const { entry } = pick;
    const def = entry.def;
    const patch = {};
    const target = state.paintTarget || 'main';
    if (target === 'accent') {
      if (!def.accent || !state.paintColor) { this._fail('No accent colour on this piece'); return false; }
      patch.k = state.paintColor;
    } else {
      if (state.paintMat && def.mats?.includes(state.paintMat)) patch.m = state.paintMat;
      const m = patch.m || entry.p.m;
      if (state.paintColor && (def.paintAlways || (def.paint && MATERIALS[m]?.paintable))) patch.c = state.paintColor;
      else if (patch.m && patch.m !== entry.p.m) patch.c = null;
    }
    if (!Object.keys(patch).length) { this._fail("That paint doesn't fit this piece"); return false; }
    const res = this.world.update(entry.key, patch);
    if (res && res !== entry) {
      this.app.effects.popIn(res.obj, 0.22);
      events.emit('sfx', { name: 'paint' });
      return true;
    }
    return false;
  }

  pickAt(sx, sy) {
    const pick = this.pickPiece(sx, sy);
    if (!pick) return false;
    const { p, def } = pick.entry;
    const patch = { pieceId: def.id, category: def.cat, tool: 'build', hOffset: 0 };
    if (def.rot !== 'none') patch.rot = p.r || 0;
    if (p.m) patch.mats = { ...state.mats, [def.matGroup]: p.m };
    if (p.c) patch.colors = { ...state.colors, [p.m || def.id]: p.c };
    if (p.k) patch.accent = p.k;
    if (def.layer !== 'R') patch.level = p.y;
    state.set(patch);
    events.emit('sfx', { name: 'click' });
    events.emit('toast', { text: `Picked ${def.name}` });
    return true;
  }

  _fail(reason) {
    events.emit('sfx', { name: 'error' });
    if (reason) events.emit('toast', { text: reason, kind: 'warn' });
  }

  // ---------------------------------------------------------------- draw mode

  drawStart(sx, sy) {
    if (state.photoMode) return;
    this.world.beginBatch();
    let touch = false;
    for (const ptr of this.rig.pointers?.values?.() || []) if (ptr.type !== 'mouse') touch = true;
    this.drawing = { seen: new Set(), axis: null, count: 0, ops: 0, touch, roofLevel: undefined };
    this.drawMove(sx, sy);
  }

  drawMove(sx, sy) {
    const d = this.drawing;
    if (!d) return;
    this.lastScreen = { x: sx, y: sy };
    if (state.tool === 'build') {
      const t = this.resolve(sx, sy);
      if (!t) return;
      this._showGhost(t);
      if (d.seen.has(t.key) || !t.valid) return;
      d.seen.add(t.key);
      if (t.def.slot === 'edge' && !d.axis) d.axis = t.p.a;
      if (this.place(t.p, { silent: d.count > 0 && d.count % 2 === 1 })) {
        d.count++; d.ops++;
        this._afterPlace(t, d.touch, true);
      }
    } else if (state.tool === 'erase') {
      // a stroke tidies one kind of thing on one floor: wiping across a roof must not tunnel
      // through to the walls and furniture that appear underneath as the panels vanish
      const pick = this.pickPiece(sx, sy);
      if (!pick) return;
      const e = pick.entry, kind = e.def.layer === 'R' ? 'R' : e.def.layer + '|' + e.p.y;
      if (d.kind === undefined) d.kind = kind;
      else if (d.kind !== kind) return;
      if (this.eraseAt(sx, sy)) { d.ops++; if (d.touch) this._buzz(4); }
    } else if (state.tool === 'paint') {
      const pick = this.pickPiece(sx, sy);
      if (pick && !d.seen.has(pick.entry.key)) { d.seen.add(pick.entry.key); if (this.paintAt(sx, sy)) d.ops++; }
    }
  }

  drawEnd() {
    if (!this.drawing) return;
    this.drawing = null;
    this.world.endBatch();
    this.hideGhost();
  }

  /** The stroke was really the first finger of a pinch: take back whatever it placed. */
  drawCancel() {
    const d = this.drawing;
    if (!d) return;
    this.drawing = null;
    const recorded = this.world.endBatch();   // false if the stroke changed nothing (e.g. re-placed identical pieces)
    this.hideGhost();
    if (recorded) this.world.discardLast();   // undone, and nothing to redo: it was never meant
  }

  // ---------------------------------------------------------------- commands for UI

  rotate(dir = 1) {
    const def = getDef(state.pieceId);
    if (def?.rot === 'flip') state.set({ rot: state.rot >= 2 ? 0 : 2 });
    else state.set({ rot: (state.rot + dir + 4) & 3 });
    events.emit('sfx', { name: 'rotate' });
  }

  raise(d) {
    state.set({ hOffset: clamp(state.hOffset + d, -8, 8) });
    events.emit('sfx', { name: 'click' });
  }

  setLevel(n) {
    const lv = clamp(n, 0, MAX_LEVEL);
    if (lv === state.level) return;
    // stepping down a floor shows a cutaway (upper floors hidden); stepping up keeps the current view.
    // Outdoor pieces (garden, paths, fences) don't need to see inside, so the house keeps its roof.
    const patch = { level: lv, hOffset: 0 };
    const def = getDef(state.pieceId);
    const outdoor = def && state.tool === 'build' && (def.cat === 'garden' || def.id === 'path');
    if (lv < state.level && !outdoor) patch.seeAll = false;
    state.set(patch);
    events.emit('sfx', { name: 'level' });
  }

  selectPiece(id) {
    const def = getDef(id);
    if (!def) return;
    const prev = getDef(state.pieceId);
    const patch = { pieceId: id, category: def.cat, tool: 'build', hOffset: 0 };
    if (def.rot === 'flip' && state.rot % 2) patch.rot = 0;
    state.set(patch);
    if (!prev || prev.cat !== def.cat || prev.layer !== def.layer) this._autoView(def);
  }

  /**
   * Pick a sensible view for the kind of piece in hand: cozy things → a floor you can stand on, with a
   * cutaway so you can see inside; roofs & gables → the whole house.
   */
  _autoView(def) {
    const W = this.world;
    if (def.cat === 'interior') {
      const floorAt = (y) => { for (const e of W.entries.values()) if (e.p.y === y && e.def.layer === 'F') return true; return false; };
      if (state.level > 0 && !floorAt(state.level)) {
        for (let y = state.level - 1; y >= 0; y--) {
          if (y === 0 || floorAt(y)) {
            this.setLevel(y);
            events.emit('toast', { text: `🛋️ Floor ${y + 1} — cozy things need a floor to stand on`, kind: 'info', ms: 2600 });
            return;
          }
        }
      }
      if (state.seeAll) {
        let above = false;
        for (const e of W.entries.values()) if (e.level > state.level) { above = true; break; }
        if (above) {
          state.set({ seeAll: false });
          events.emit('toast', { text: '✂️ Peeking inside — the roof and upper floors are hidden', kind: 'info', ms: 2600 });
        }
      }
    } else if (/^(stairs|stairs_spiral|ladder)$/.test(def.id) && state.level > 0) {
      // standing on a brand-new top floor with no way up yet: the stairs belong on the floor below
      const L = state.level;
      let floorHere = false, floorAbove = false, climbBelow = false;
      for (const e of W.entries.values()) {
        if (e.def.layer === 'F' && e.p.y === L) floorHere = true;
        if (e.def.layer === 'F' && e.p.y === L + 1) floorAbove = true;
        if (e.p.y === L - 1 && /^(stairs|stairs_spiral|ladder)$/.test(e.def.id)) climbBelow = true;
      }
      if (floorHere && !floorAbove && !climbBelow) {
        this.setLevel(L - 1);
        events.emit('toast', { text: `🪜 Floor ${L} — stairs climb from here up to Floor ${L + 1}`, kind: 'info', ms: 2800 });
      }
    } else if ((def.layer === 'R' || def.autoGable) && !state.seeAll) {
      state.set({ seeAll: true });
      events.emit('toast', { text: '👁️ Showing the whole house for roofing', kind: 'info', ms: 2200 });
    }
  }

  undo() {
    if (this.world.undo()) {
      events.emit('sfx', { name: 'undo' });
      // undoing right after a finger placement: maybe the tap landed in the wrong spot
      if (this._lastTouchPlace && performance.now() - this._lastTouchPlace < TOUCH_TIP_MS) {
        this._lastTouchPlace = 0;
        this._tip('aim', '💡 Tip: press and hold to preview a piece — slide your finger to adjust, then lift to place.', 5600);
      }
      return true;
    }
    return false;
  }

  redo() {
    if (this.world.redo()) { events.emit('sfx', { name: 'undo' }); return true; }
    return false;
  }

  _key(e) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    const k = e.key.toLowerCase();
    const mod = e.ctrlKey || e.metaKey;
    if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) this.redo(); else this.undo(); return; }
    if (mod && k === 'y') { e.preventDefault(); this.redo(); return; }
    if (mod) return;
    if (k === 'r') this.rotate(e.shiftKey ? -1 : 1);
    else if (k === 'e') state.set({ tool: state.tool === 'erase' ? 'build' : 'erase' });
    else if (k === 'b') state.set({ tool: 'build' });
    else if (k === 'p') state.set({ tool: state.tool === 'paint' ? 'build' : 'paint' });
    else if (k === 'i') state.set({ tool: state.tool === 'pick' ? 'build' : 'pick' });
    else if (k === 'd') state.set({ drawMode: !state.drawMode });
    else if (k === 'pageup' || k === '=' || k === '+') this.setLevel(state.level + 1);
    else if (k === 'pagedown' || k === '-' || k === '_') this.setLevel(state.level - 1);
    else if (k === ']') this.raise(1);
    else if (k === '[') this.raise(-1);
    else if (k === 'v') state.set({ seeAll: !state.seeAll });
    else if (k === 'escape') { state.set({ tool: 'build' }); this.hideGhost(); }
    else if (k === 'q') this.rig.rotateBy(-Math.PI / 8);
    else if (k === 'w' && e.shiftKey) this.rig.rotateBy(Math.PI / 8);
    else if (/^[1-7]$/.test(k)) {
      // like tapping a tab: hand over a piece from that category (the last one used there, else the first)
      const cat = CATEGORIES[+k - 1];
      if (!cat) return;
      const cur = getDef(state.pieceId);
      if (cur && cur.cat === cat.id) { state.set({ category: cat.id }); return; }
      const list = piecesIn(cat.id);
      const want = list.find((d) => d.id === this._lastInCat?.[cat.id]) || list[0];
      if (want) this.selectPiece(want.id); else state.set({ category: cat.id });
    }
  }
}
