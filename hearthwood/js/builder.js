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
const LINE_SLACK = 0.8;           // a wall stroke stays on its grid line until the finger is this many cells off it…
const LINE_ON = 0.3;              // …(closer than this counts as "on the line")
const SEG_SLACK = 0.25;           // …and takes the next segment once the finger is this far into it
const TURN_RATIO = 0.5;           // leaving the line steeper than ~63° is a turn (an L), shallower a hop to the next line…
const HEAD_LEN = 0.45;            // …or heading steeper than 45° over the finger's last ~half cell (a rounded corner)
const HOP_UNDO = 1;               // a turn within this many cells of a hop turns from the line before the hop
const TURN_FIX = 4;               // a hop to the next line within this many cells of a corner moves the corner there…
const TURN_MEAN = 0.35;           // …when the finger has kept (on average) this far toward that line since the turn
const ROOF_FAR = '🏠 Tap the top of a wall to rest the roof on it';
// build grid: soft white by day, a dim moonlit blue at night (so it doesn't glow over the scene)
const GRID_OPACITY = 0.28;
const GRID_NIGHT_DIM = 0.55;
const GRID_DAY = new THREE.Color(0xffffff);
const GRID_NIGHT = new THREE.Color(0x8d9cc4);
/** Wall-like pieces that can hold up a roof (garden fences, hedges and railings can't). */
const holdsRoof = (def) => !!def && (def.layer === 'B' || def.cat === 'walls' || def.cat === 'openings');
/** Which edge pieces line up into one run with a gap to fill: walls & openings together, else each kind alone. */
const gapFamily = (def) => (def.cat === 'walls' || def.cat === 'openings' ? 'wall' : def.id);

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
    // the grid is unlit (and not tone mapped): fade & tint it with the dark so it doesn't glow at night.
    // Checked just before it draws — no per-frame work while it's hidden, nothing allocated.
    this._gridNight = -1;
    grid.onBeforeRender = () => {
      const n = this.app.env?.night;
      const night = typeof n === 'number' && Number.isFinite(n) ? clamp(n, 0, 1) : 0;
      if (Math.abs(night - this._gridNight) < 0.004) return;
      this._gridNight = night;
      grid.material.opacity = GRID_OPACITY * (1 - GRID_NIGHT_DIM * night);
      grid.material.color.copy(GRID_DAY).lerp(GRID_NIGHT, night);
    };
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

  /**
   * Where a roof piece under the finger settles: { lv, x, z }. lv is the level whose floor plane is the top of
   * the walls (1..MAX_LEVEL + 1 — MAX_LEVEL + 1 is a roof over the top floor's walls, stored as y = MAX_LEVEL
   * plus a storey of half-steps), (x, z) the cell there.
   * Pointing at a wall, beam or post: on top of THAT piece, in a cell beside it — or { far: true, … } when the
   * finger's line crosses its top more than about a cell away (e.g. a tap low on a wall face), so the tap fails
   * visibly instead of dropping a panel somewhere else. Otherwise: the highest supported plane under the finger.
   * Null when nothing holds a roof.
   */
  _roofLevel(sx, sy, pick) {
    const top = this._topLevel();
    if (top < 0) return null;
    const e = pick?.entry;
    if (e && (holdsRoof(e.def) || e.def.layer === 'P')) {
      const lv = Math.min(e.p.y + 1, MAX_LEVEL + 1);
      const hit = this.rayPlane(sx, sy, levelY(lv));
      if (!hit) return null;
      const x = Math.floor(hit.x / CELL), z = Math.floor(hit.z / CELL);
      if (this._pieceDist(e, hit) > CELL) return { far: true, lv, x, z };
      if (this._roofSupported(x, lv, z)) return { lv, x, z };
      const [bx, bz] = this._besideCell(e, hit);      // just off the end of the wall: the cell beside it
      return { lv, x: bx, z: bz };
    }
    const maxY = Math.min(MAX_LEVEL + 1, top + 1, state.seeAll ? MAX_LEVEL + 1 : state.level + 1);
    for (let y = maxY; y >= 1; y--) {
      const hit = this.rayPlane(sx, sy, levelY(y));
      if (!hit) continue;
      const x = Math.floor(hit.x / CELL), z = Math.floor(hit.z / CELL);
      if (this._roofSupported(x, y, z)) return { lv: y, x, z };
    }
    return null;
  }

  /** Horizontal distance (m) from a world point to a wall-like piece's footprint (edge segment or post). */
  _pieceDist(e, P) {
    const p = e.p;
    if (e.def.slot === 'edge') {
      const x0 = p.x * CELL, z0 = p.z * CELL;
      const t = clamp(p.a === 'x' ? (P.x - x0) / CELL : (P.z - z0) / CELL, 0, 1);
      const qx = p.a === 'x' ? x0 + t * CELL : x0, qz = p.a === 'x' ? z0 : z0 + t * CELL;
      return Math.hypot(P.x - qx, P.z - qz);
    }
    if (e.def.slot === 'corner') return Math.hypot(P.x - p.x * CELL, P.z - p.z * CELL);
    return Math.hypot(P.x - (p.x + 0.5) * CELL, P.z - (p.z + 0.5) * CELL);
  }

  /** The cell next to a wall / post that is nearer a world point (a roof resting on that piece). */
  _besideCell(e, P) {
    const p = e.p;
    if (e.def.slot === 'edge') {
      if (p.a === 'x') return [p.x, P.z < p.z * CELL ? p.z - 1 : p.z];
      return [P.x < p.x * CELL ? p.x - 1 : p.x, p.z];
    }
    if (e.def.slot === 'corner') return [P.x < p.x * CELL ? p.x - 1 : p.x, P.z < p.z * CELL ? p.z - 1 : p.z];
    return [p.x, p.z];
  }

  /**
   * Wall strokes keep to their grid line: the finger may wander up to LINE_SLACK cells off it (a drifting thumb)
   * before the stroke follows. Leaving it across the line (a turn) carries on along the cross line through the
   * grid corner nearest the finger (an L): segments this stroke laid past that corner are taken back (an
   * overshooting thumb leaves no stub), a row that stopped short of it is finished, and the new side is filled
   * in from the corner to the finger (see resolve / drawMove). Leaving while still travelling along the line
   * moves the stroke to the parallel line.
   * Steep or shallow is judged twice: overall since the finger was last on the line, and by where it is heading
   * now (its last ~half cell), so a thumb rounding a wide corner — or wobbling at it — still turns. A hop that
   * turns within a cell is taken as that turn from the line before the hop (the hop's segment is taken back).
   */
  _strokeLine(dr, sx, sy, L, at, keep = false) {
    const hit = at || this.rayPlane(sx, sy, levelY(L));   // the finger's spot (see resolve), else the floor
    if (!hit) return;
    const x = dr.axis === 'x';
    const along = (x ? hit.x : hit.z) / CELL, perp = (x ? hit.z : hit.x) / CELL;
    // the finger's recent track (cells), for the way it is heading
    const tr = dr.track, hx = hit.x / CELL, hz = hit.z / CELL, tl = tr[tr.length - 1];
    if (!tl || Math.abs(hx - tl[0]) + Math.abs(hz - tl[1]) > 0.02) { tr.push([hx, hz]); if (tr.length > 24) tr.shift(); }
    if (dr.hopFrom && Math.abs(along - dr.hopFrom.along) >= HOP_UNDO) dr.hopFrom = null;   // a real hop: keep it
    const tn = dr.turn;
    if (tn) {
      // how far off the new line, on average, the finger has run since the turn (a weave is off to one side;
      // over a wall the stroke just laid there, it counts as on the line: the floor seen behind it can be far off)
      const dA = Math.abs(along - tn.at);
      tn.at = along; tn.sum += (keep ? 0 : perp - dr.line) * dA; tn.len += dA;
      if (Math.abs(along - tn.line) > TURN_FIX) dr.turn = null;                          // well past the corner: keep it
    }
    const off = Math.abs(perp - dr.line);
    if (off <= LINE_ON) { dr.on = along; return; }
    if (keep || off <= LINE_SLACK) return;
    let steep = Math.abs(along - dr.on) < TURN_RATIO * off;
    if (!steep) {
      for (let k = tr.length - 2; k >= 0; k--) {
        const dA = along - (x ? tr[k][0] : tr[k][1]), dP = perp - (x ? tr[k][1] : tr[k][0]);
        if (Math.hypot(dA, dP) < HEAD_LEN && k > 0) continue;
        steep = Math.abs(dA) < Math.abs(dP);
        break;
      }
    }
    if (steep) {
      // turned a corner (left the line steeply). The finger is on the new line now, so the corner is the grid
      // point nearest it along the old line. The row's direction of travel (dr.go) comes from its segments, so
      // a thumb wobbling back a little as it rounds the corner can't flip it.
      const hop = dr.hopFrom;
      dr.hopFrom = null;
      if (hop && Math.abs(along - hop.along) < HOP_UNDO) {
        // it only hopped on its way round the corner: turn from the line it was on, taking the hop's segments back
        dr.drop.push(...hop.keys);
        dr.line = hop.line; dr.seg = hop.seg; dr.go = hop.go; dr.last = hop.last;
      }
      const c = Math.round(along), go = dr.go, oldLine = dr.line;
      // the segment the row laid last, past that corner: an overshooting thumb's stub, taken back
      const last = dr.last;
      if (last && ((go > 0 && last.i >= c) || (go < 0 && last.i < c))) dr.drop.push(last.key);
      // a row that stopped short of the corner (a fast finger skipped a sample) is finished up to it
      if (dr.seg !== undefined && go) {
        for (let i = dr.seg + go, n = 0; (go > 0 ? i < c : i >= c) && n < 3; i += go, n++) {
          dr.fill.push(x ? { a: 'x', x: i, z: oldLine } : { a: 'z', x: oldLine, z: i });
        }
      }
      // remembered for a while: a hop to the next line soon after means the corner was on that line (see below)
      dr.turn = { axis: dr.axis, line: oldLine, c, keys: [], at: perp, sum: 0, len: 0 };
      dr.axis = x ? 'z' : 'x';
      dr.line = c;
      dr.on = perp;
      dr.corner = oldLine;       // where the new side starts (along the new line): filled in up to the finger
      dr.go = 0;
      dr.last = null;
    } else if (dr.turn && Math.abs(Math.round(perp) - dr.line) === 1 && tn.len > 0
      && (tn.sum / tn.len) * (Math.round(perp) - dr.line) > TURN_MEAN) {
      // drifting onto the next line a few cells after a corner, having kept toward it all along: the corner was
      // on that line (a slow weave was off to one side just as the turn registered). A finger that ran on the
      // new line before drifting off it hops as usual. Turn again there: what the stroke laid on the wrong line
      // is taken back, the old row is trimmed or finished up to the new corner, and the new side is filled in
      // from the corner to the finger.
      const c2 = Math.round(perp), oa = tn.axis, c = tn.c;
      dr.turn = null;
      dr.hopFrom = null;
      dr.drop.push(...tn.keys);
      // the old row lies on the side of the new corner where the stroke has more of its segments (not dr.go:
      // a weave wobbling back across a segment line flips that)
      const def = getDef(state.pieceId);
      const slot = (i) => (oa === 'x' ? { a: 'x', x: i, z: tn.line } : { a: 'z', x: tn.line, z: i });
      const key = (i) => this.world.keyOf({ t: def.id, y: L, ...slot(i) });
      let up = 0, down = 0;           // segments i >= c2 / i < c2 near the corner
      for (let k = 0; k < 3; k++) { if (dr.seen.has(key(c2 + k))) up++; if (dr.seen.has(key(c2 - 1 - k))) down++; }
      if (up !== down) {
        const rowUp = up > down;      // the row came down to the corner (from i >= c2), else up to it
        for (const i of rowUp ? [c2 - 1, c2 - 2] : [c2, c2 + 1]) { const k = key(i); if (dr.fresh.has(k)) dr.drop.push(k); }
        if (rowUp ? c > c2 : c < c2) for (let i = Math.min(c, c2), n = 0; i < Math.max(c, c2) && n < 3; i++, n++) dr.fill.push(slot(i));
      }
      dr.line = c2;
      dr.on = along;
      dr.corner = tn.line;
      dr.go = 0;
      dr.last = null;
    } else {
      // a hop to the parallel line: still travelling the same way (remembered, in case it was a corner after all)
      dr.hopFrom = { line: dr.line, along, seg: dr.seg, go: dr.go, last: dr.last, keys: [] };
      dr.turn = null;
      dr.line = Math.round(perp);
      dr.on = along;
      dr.corner = undefined;
      dr.last = null;
    }
    dr.seg = undefined;
  }

  /** A stroke's row moved on to segment i (dr.go follows the segments, not every wobble of the finger). */
  _strokeSeg(dr, i) {
    if (dr.seg !== undefined && i !== dr.seg) dr.go = Math.sign(i - dr.seg);
    dr.seg = i;
  }

  /**
   * A full record for an edge piece in a slot the stroke fills in by itself (a corner it rounded, the start of
   * a new side): like a tap there, but only into an empty slot — or over the same piece in another look (a
   * stroke restyling a row repaints the corner it crossed before the turn showed). Null when it can't go there.
   */
  _strokeRec(def, L, slot) {
    if (def.slot !== 'edge' || this._guidesLeft(def)) return null;
    const p = { t: def.id, y: L, a: slot.a, x: slot.x, z: slot.z };
    if (def.rot === 'four') p.r = state.rot & 3;
    else if (def.rot === 'flip') p.r = state.rot >= 2 ? 2 : 0;
    if (def.autoGable) Object.assign(p, this.autoGable(def, p));
    const m = this.materialFor(def);
    if (m) p.m = m;
    const c = this.colorFor(def, m);
    if (c) p.c = c;
    if (def.accent) p.k = state.accent;
    if (def.autoGable && this._tallGable(def, p)) return null;
    const q = this.world.normalize(p);
    if (!q || !this.world.validate(q).ok) return null;
    const cur = this.world.get(this.world.keyOf(q));
    if (cur && (cur.t !== q.t || def.autoGable || (cur.m === q.m && (cur.c || '') === (q.c || '')
      && (cur.k || '') === (q.k || '') && (cur.r || 0) === (q.r || 0)))) return null;
    return q;
  }

  /**
   * A gable over the top floor takes the Floor-5 wall's slot as one tall piece (that wall + the triangle). It
   * keeps that wall's look (material & paint); a window, door or anything else there would be covered up, so
   * that's refused with a reason. Mutates p (m / c); returns '' or the reason.
   */
  _tallGable(def, p) {
    if (p.y !== MAX_LEVEL || (p.h || 0) < 2) return '';
    const under = this.world.get(K.W(p.a, p.x, MAX_LEVEL, p.z));
    const ud = under && getDef(under.t);
    if (!ud || ud.autoGable) return '';       // an open edge, or a tall gable being swapped for another one
    if (ud.id === 'wall') {
      if (under.m && def.mats?.includes(under.m)) p.m = under.m;
      if (under.c) p.c = under.c; else delete p.c;
      return '';
    }
    const name = (ud.name || 'piece').toLowerCase();
    if (ud.cat === 'openings') return `${ud.icon || '🪟'} That wall has ${/^[aeiou]/.test(name) ? 'an' : 'a'} ${name} — the gable would cover it`;
    return `${ud.icon || '🧱'} The gable would cover the ${name} there`;
  }

  /**
   * Gaps in a wall line on floor L: empty edges whose two ends both meet a piece of the same family (walls &
   * openings, or one kind of fence / hedge / railing) — and that carry on a line of that family at one end, or
   * whose ends don't sit in the middle of a straight run across them (a cross edge of a one-cell-deep corridor
   * or annex touches both long walls, but it is no gap: a tap there means the cell the finger is on).
   * Cached per world version.
   */
  _gaps(fam, L) {
    const W = this.world;
    const sig = `${W.version}|${L}|${fam}`;
    if (this._gp && this._gp.sig === sig) return this._gp.list;
    const verts = new Set(), pieces = [];
    for (const e of W.entries.values()) {
      if (e.def.layer !== 'W' || e.p.y !== L || gapFamily(e.def) !== fam) continue;
      const p = e.p;
      pieces.push(p);
      verts.add(p.x + '|' + p.z);
      verts.add(p.a === 'x' ? (p.x + 1) + '|' + p.z : p.x + '|' + (p.z + 1));
    }
    const has = (a, x, z) => { const q = W.get(K.W(a, x, L, z)); return !!q && gapFamily(getDef(q.t)) === fam; };
    // a run across axis a passing straight through vertex (vx, vz)
    const through = (a, vx, vz) => (a === 'x' ? has('z', vx, vz - 1) && has('z', vx, vz) : has('x', vx - 1, vz) && has('x', vx, vz));
    const collinear = (a, x, z) => (a === 'x' ? has('x', x - 1, z) || has('x', x + 1, z) : has('z', x, z - 1) || has('z', x, z + 1));
    const list = [], seen = new Set();
    const consider = (a, x, z) => {
      const k = a + '|' + x + '|' + z;
      if (seen.has(k)) return;
      seen.add(k);
      if (W.get(K.W(a, x, L, z))) return;
      const [ex, ez] = a === 'x' ? [x + 1, z] : [x, z + 1];
      if (!verts.has(x + '|' + z) || !verts.has(ex + '|' + ez)) return;
      if (!collinear(a, x, z) && (through(a, x, z) || through(a, ex, ez))) return;
      list.push({ a, x, z });
    };
    for (const p of pieces) {
      for (const [vx, vz] of [[p.x, p.z], p.a === 'x' ? [p.x + 1, p.z] : [p.x, p.z + 1]]) {
        consider('x', vx, vz); consider('x', vx - 1, vz); consider('z', vx, vz); consider('z', vx, vz - 1);
      }
    }
    this._gp = { sig, list };
    return list;
  }

  /**
   * A tap into a gap in a wall line (seen through it, the floor or a wall behind would otherwise decide):
   * the gap's edge, when the ray crosses its opening before anything else. Window & door tools aimed at a
   * wall seen through the gap keep swapping that wall.
   */
  _gapSlot(def, L, pick) {
    const fam = gapFamily(def);
    const list = this._gaps(fam, L);
    if (!list.length) return null;
    const o = _ray.ray.origin, dir = _ray.ray.direction;
    const y0 = (L === 0 ? 0 : levelY(L)) - 0.05, y1 = levelY(L) + (fam === 'wall' ? LEVEL_H : 1.2);
    let best = null, bestT = Infinity;
    for (const g of list) {
      let t, along;
      if (g.a === 'z') {
        if (Math.abs(dir.x) < 1e-6) continue;
        t = (g.x * CELL - o.x) / dir.x;
        along = o.z + dir.z * t - g.z * CELL;
      } else {
        if (Math.abs(dir.z) < 1e-6) continue;
        t = (g.z * CELL - o.z) / dir.z;
        along = o.x + dir.x * t - g.x * CELL;
      }
      if (t <= 0 || t >= bestT) continue;
      const y = o.y + dir.y * t;
      if (along < 0.1 || along > CELL - 0.1 || y < y0 || y > y1) continue;
      best = g; bestT = t;
    }
    if (!best) return null;
    if (pick) {
      if (pick.point.distanceTo(o) < bestT - 0.1) return null;          // something stands in front of the gap
      const e = pick.entry;
      if (def.cat === 'openings' && e.def.layer === 'W' && gapFamily(e.def) === 'wall' && e.def.id !== def.id
        && (e.p.y === L || this._swapAcross(def, e, pick))) return null;
    }
    return best;
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
      // the gable stands on the floor under the roof's edge there; over the top floor (no floor above it) it
      // takes the top floor's slot and grows a storey taller (h ≥ 2: the wall and the triangle in one piece)
      const gy = Math.min(MAX_LEVEL, Math.floor(hs / 2));
      const sides = (r === 0 || r === 2)
        ? [['z', q.x, q.z, q.x - 1, q.z], ['z', q.x + 1, q.z, q.x + 1, q.z]]
        : [['x', q.x, q.z, q.x, q.z - 1], ['x', q.x, q.z + 1, q.x, q.z + 1]];
      for (const [a, x, z, nx, nz] of sides) {
        const n = W.get(K.R(nx, hs, nz));
        if (n && (n.r || 0) === r && (getDef(n.t)?.roof?.kind || 'slope') === 'slope') continue;   // roof carries on
        const k = `${a}|${x}|${z}|${gy}`;
        if (seen.has(k)) continue;
        seen.add(k);
        list.push({ a, x, z, y: gy, lift: hs - 2 * gy, top: (hs - 2 * gy + (e.def.roof?.rise ?? 1)) * STEP, rx: q.x, rz: q.z });
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
    // the open triangle itself, when nothing stands in front of it (looking through one open end, the far
    // end's wall or the panels behind must not win)
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
    if (pick) {
      const e = pick.entry;
      // the roof panel itself → its nearest open end
      if (e.def.layer === 'R') {
        let near = null, bd = Infinity;
        for (const c of cands) {
          if (c.rx !== e.p.x || c.rz !== e.p.z) continue;
          const d = c.a === 'z' ? Math.abs(pick.point.x - c.x * CELL) : Math.abs(pick.point.z - c.z * CELL);
          if (d < bd) { bd = d; near = c; }
        }
        if (near) return near;
      }
      // the wall right under an open end (over the top floor: the wall the tall gable takes the place of)
      if (e.def.layer === 'W' && !e.def.autoGable) {
        const c = cands.find((c) => c.a === e.p.a && c.x === e.p.x && c.z === e.p.z
          && (c.y === e.p.y + 1 || (c.y === e.p.y && c.lift >= 2)));
        if (c) return c;
      }
    }
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

  /** The grid edge nearest a point (in cells), optionally only along axis `lock`: { a, x, z, f } (f: 0..1 along it). */
  _nearestEdge(fx, fz, lock) {
    const cx = Math.floor(fx), cz = Math.floor(fz), u = fx - cx, v = fz - cz;
    const cand = [
      { a: 'x', x: cx, z: cz, d: v, f: u },
      { a: 'x', x: cx, z: cz + 1, d: 1 - v, f: u },
      { a: 'z', x: cx, z: cz, d: u, f: v },
      { a: 'z', x: cx + 1, z: cz, d: 1 - u, f: v },
    ].filter((c) => !lock || c.a === lock);
    cand.sort((m, n) => m.d - n.d);
    return cand[0];
  }

  /**
   * Does a garden piece have something to stand on at world point P on level y? Its cell (a floor, deck or roof
   * terrace), or for fences & hedges the edge nearest P (world.edgeSupported: a deck or floor beside it).
   */
  _gardenStands(def, P, y) {
    if (def.slot === 'cell') return this.world.hasFloor(Math.floor(P.x / CELL), y, Math.floor(P.z / CELL));
    const e = this._nearestEdge(P.x / CELL, P.z / CELL);
    return this.world.edgeSupported({ t: def.id, y, a: e.a, x: e.x, z: e.z }, def);
  }

  /** The level a garden piece goes on from the current floor at a screen point: this floor if it stands there, else the ground. */
  _gardenY(def, sx, sy) {
    const L = state.level;
    if (L <= 0 || L > (def.levels?.[1] ?? MAX_LEVEL)) return 0;
    const hit = this.rayPlane(sx, sy, levelY(L));
    return hit && this._gardenStands(def, hit, L) ? L : 0;
  }

  /** Resolve the slot under a screen point for the current piece. Returns { p, def, key, valid, reason } or null. */
  resolve(sx, sy) {
    const def = getDef(state.pieceId);
    if (!def) return null;
    const dr = this.drawing;
    const L = dr && dr.y !== undefined ? dr.y : state.level;    // a garden fence stroke keeps its level
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
    // a tap into a gap in a wall line fills that gap (not the floor or the far wall seen through it)
    if (!fixed && !dr && def.layer === 'W' && !def.autoGable) {
      const gap = this._gapSlot(def, L, pick);
      if (gap) { p.a = gap.a; p.x = gap.x; p.z = gap.z; fixed = true; }
    }
    // a wall stroke keeps to its grid line (and turns corners) — decided before the pieces under the finger
    if (!fixed && dr && dr.axis && dr.line !== undefined && def.slot === 'edge') {
      // where the finger is: on a wall the stroke is restyling, the spot on that wall (seen low, the floor behind
      // a wall can be cells away); else the floor — and over a piece of its own kind on its line (one it just
      // laid), it is still on that line whatever the floor behind says
      const e = pick?.entry;
      const edgeHere = e && e.def.slot === 'edge' && e.p.y === L;
      const laid = edgeHere && e.def.id === def.id && e.p.a === dr.axis && (e.p.a === 'x' ? e.p.z : e.p.x) === dr.line;
      this._strokeLine(dr, sx, sy, L, edgeHere && e.def.id !== def.id ? pick.point : null, laid);
    }
    // 3. the piece under the finger
    if (!fixed && pick) {
      const e = pick.entry;
      // a stroke follows the floor grid: walls standing in the way (same piece, across the stroke's line, or
      // along a parallel line the finger is only drifting toward) must not hijack it
      const skip = dr && (e.def.id === def.id || (dr.axis && (e.p.a !== dr.axis
        || (dr.line !== undefined && e.def.slot === 'edge' && (e.p.a === 'x' ? e.p.z : e.p.x) !== dr.line))));
      if (def.slot === 'edge' && e.def.slot === 'edge' && !skip) {
        if (e.p.y === L || this._swapAcross(def, e, pick)) { p.a = e.p.a; p.x = e.p.x; p.z = e.p.z; p.y = e.p.y; fixed = true; }
      } else if (def.slot === 'corner' && (e.def.slot === 'edge' || e.def.slot === 'corner') && e.p.y === L) {
        px = pick.point.x; pz = pick.point.z;
      } else if (def.layer === 'R' && e.def.layer === 'R' && !(dr && e.def.layer === def.layer)) {
        // (a stroke paints a row on the wall tops; it never flips the panels it passes over)
        p.x = e.p.x; p.z = e.p.z; p.y = e.p.y; p.h = e.p.h; fixed = 'roof';
      } else if (def.cat === 'roof' && def.slot === 'cell' && def.layer !== 'R' && e.def.layer === 'R') {
        // chimney tapped onto the roof: stand it in that spot on the storey under the roof
        // (a roof over the top floor's walls is y = MAX_LEVEL lifted a storey: that floor is the one under it)
        p.x = e.p.x; p.z = e.p.z; fixed = true;
        p.y = e.p.y === MAX_LEVEL && (e.p.h || 0) >= 2 ? MAX_LEVEL : Math.max(0, e.p.y - 1);
      }
    }
    // 4. roofs settle on top of the walls under the finger (any floor, the top floor's too); a draw stroke keeps
    //    its first level. Records stop at y = MAX_LEVEL, so a roof over the top floor's walls is y = MAX_LEVEL
    //    with `lift` (a storey of half-steps) added to its height.
    let lift = 0, roofFar = false, roofLv = null;
    if (!fixed && def.layer === 'R') {
      if (dr && dr.roofLevel !== undefined) roofLv = dr.roofLevel;
      else {
        const r = this._roofLevel(sx, sy, pick);
        roofLv = r ? r.lv : null;
        if (r && !r.far) { px = (r.x + 0.5) * CELL; pz = (r.z + 0.5) * CELL; }
        roofFar = !!r?.far;
        // a stroke that starts off a wall top tries again as the finger moves on
        if (dr && !roofFar) dr.roofLevel = roofLv;
      }
      if (roofLv !== null) {
        if (roofLv > MAX_LEVEL) { p.y = MAX_LEVEL; lift = 2 * (roofLv - MAX_LEVEL); } else p.y = roofLv;
      }
    }
    if (!fixed) {
      if (px === undefined) {
        let hit = this.rayPlane(sx, sy, levelY(p.y) + lift * STEP);
        // garden things upstairs with nothing to stand on under the finger (the meadow seen past the house,
        // not a deck or roof terrace — for fences & hedges, nothing beside the edge): they go on the ground
        // there instead of hanging in the air (a fence stroke decided its level when it started)
        if (def.cat === 'garden' && def.slot !== 'corner' && p.y > 0 && !(dr && dr.y !== undefined)
          && (!hit || p.y > (def.levels?.[1] ?? MAX_LEVEL) || !this._gardenStands(def, hit, p.y))) {
          const g0 = this.rayPlane(sx, sy, levelY(0));
          if (g0) { hit = g0; p.y = 0; }
        }
        if (!hit) return null;
        px = hit.x; pz = hit.z;
      }
      if (def.slot === 'cell') {
        p.x = Math.floor(px / CELL); p.z = Math.floor(pz / CELL);
      } else if (def.slot === 'corner') {
        p.x = Math.round(px / CELL); p.z = Math.round(pz / CELL);
      } else if (dr && dr.axis && dr.line !== undefined) {
        // a stroke: one segment after the next along its line (a turn just past a corner leaves no stub)
        const along = (dr.axis === 'x' ? px : pz) / CELL;
        let i = Math.floor(along);
        if (dr.seg === i - 1 && along - i < SEG_SLACK) i = dr.seg;
        else if (dr.seg === i + 1 && i + 1 - along < SEG_SLACK) i = dr.seg;
        this._strokeSeg(dr, i);
        if (dr.axis === 'x') Object.assign(p, { a: 'x', x: i, z: dr.line });
        else Object.assign(p, { a: 'z', x: dr.line, z: i });
      } else {
        const c = this._nearestEdge(px / CELL, pz / CELL, dr?.axis);
        let ex = c.x, ez = c.z;
        if (dr?.dir) {
          // a stroke's first edge: a finger landing just short of a corner starts the row at that corner
          const f = c.f;
          const step = dr.dir > 0 && f > 1 - SEG_SLACK ? 1 : dr.dir < 0 && f < SEG_SLACK ? -1 : 0;
          if (c.a === 'x') ex += step; else ez += step;
        }
        Object.assign(p, { a: c.a, x: ex, z: ez });
      }
    }
    if (fixed === 'guide') {
      // follow the blueprint exactly (facing, roof height, gable shape)
      if (def.rot !== 'none' && p.r === undefined) p.r = 0;
    } else {
      if (def.rot === 'four') p.r = state.rot & 3;
      else if (def.rot === 'flip') p.r = state.rot >= 2 ? 2 : 0;
      if (def.layer === 'R' && fixed !== 'roof') {
        // (a tapped panel keeps its own height)
        p.h = this.autoRoofHeight(def, p.x, p.z, p.r, p.y + lift / 2) + lift;
        p.h = clamp(p.h + state.hOffset, lift, 9 + lift);
      }
      if (def.autoGable) Object.assign(p, this.autoGable(def, p));
    }

    const m = this.materialFor(def);
    if (m) p.m = m;
    const c = this.colorFor(def, m);
    if (c) p.c = c;
    if (def.accent) p.k = state.accent;
    // a gable over the top floor wears the look of the wall it grows from (or can't cover an opening)
    const tall = def.autoGable && fixed !== 'guide' ? this._tallGable(def, p) : '';

    const q = this.world.normalize(p);
    if (!q) return null;
    const v = this.world.validate(q);
    const key = this.world.keyOf(q);
    const out = { p: q, def, key, valid: v.ok, reason: v.reason, existing: this.world.get(key) };
    if (tall && out.valid) { out.valid = false; out.reason = tall; }
    // pointing at a wall too far below its top: say so (and show where the roof would land) rather than place it
    if (roofFar && out.valid) { out.valid = false; out.reason = ROOF_FAR; }
    // following a blueprint: while this piece still has glowing guides, only they take it (no stray pieces from mis-taps)
    if (fixed !== 'guide' && out.valid && this._guidesLeft(def)) {
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
    // a piece placed above the cutaway would vanish: show every floor (a roof over the top floor's walls
    // hides above that floor, though its record says y = MAX_LEVEL)
    const lv = this.world.entry(this.world.keyOf(t.p))?.level ?? t.p.y;
    if (!state.seeAll && lv > state.level) {
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
    // axis / line / on / seg / go / corner: a wall stroke's grid line (see _strokeLine); fresh: what it put into
    // empty slots (key → record), last: the newest of those on the current row; drop / fill: a stub to take
    // back and slots to fill in at a corner; track: the finger's recent spots (its heading); hopFrom: the line
    // before a hop and what was laid since (a hop that turns at once was a corner); turn: the last corner and what
    // was laid since (a hop soon after it moves the corner); roofLevel: a roof stroke's level; y: a garden
    // fence / hedge stroke's level
    this.drawing = {
      seen: new Set(), axis: null, line: undefined, on: 0, seg: undefined, go: 0, corner: undefined,
      fresh: new Map(), last: null, drop: [], fill: [], count: 0, ops: 0, touch, roofLevel: undefined, y: undefined,
      track: [], hopFrom: null, turn: null,
    };
    // a wall-like stroke waits for the finger's first move: its direction picks the first edge's axis (not
    // whichever edge happens to be nearest where the finger landed — on a corner that's a coin toss)
    if (state.tool === 'build' && getDef(state.pieceId)?.slot === 'edge') { this.drawing.from = { x: sx, y: sy }; return; }
    this.drawMove(sx, sy);
  }

  drawMove(sx, sy) {
    const d = this.drawing;
    if (!d) return;
    if (d.from) {
      const f = d.from, def = getDef(state.pieceId);
      // a garden fence / hedge stroke stays on one level: upstairs, a deck's (or roof terrace's) edge, else the
      // ground — decided where the finger lands, so a row can't jump between floors halfway
      if (def?.cat === 'garden') d.y = this._gardenY(def, f.x, f.y);
      const y = levelY(d.y ?? state.level);
      d.from = null;
      const a = this.rayPlane(f.x, f.y, y), b = this.rayPlane(sx, sy, y);
      if (a && b && (a.x !== b.x || a.z !== b.z)) {
        d.axis = Math.abs(b.x - a.x) >= Math.abs(b.z - a.z) ? 'x' : 'z';
        d.dir = d.go = Math.sign(d.axis === 'x' ? b.x - a.x : b.z - a.z);
      }
      this.drawMove(f.x, f.y);
    }
    this.lastScreen = { x: sx, y: sy };
    if (state.tool === 'build') {
      const t = this.resolve(sx, sy);
      if (d.drop.length) this._strokeDrop(d);
      if (!t) return;
      this._showGhost(t);
      // the row's current segment (also when a piece under the finger decided it)
      if (t.def.slot === 'edge' && t.p.a === d.axis && (t.p.a === 'x' ? t.p.z : t.p.x) === d.line) {
        const i = t.p.a === 'x' ? t.p.x : t.p.z;
        if (d.corner !== undefined) {
          // just turned a corner: the new side runs from the corner to here (the turn only shows once the
          // finger is well off the old line — or past a wall it just laid — so fill in what it crossed)
          const c = d.corner, s = i >= c ? 1 : -1;
          d.corner = undefined;
          for (let j = s > 0 ? c : c - 1, n = 0; j !== i && n < 5; j += s, n++) {
            d.fill.push(d.axis === 'x' ? { a: 'x', x: j, z: d.line } : { a: 'z', x: d.line, z: j });
          }
          d.go = s;
        }
        this._strokeSeg(d, i);
      }
      if (d.fill.length) {
        // a corner the stroke rounded: the segments the finger crossed before the turn showed
        const fill = d.fill;
        d.fill = [];
        for (const slot of fill) {
          const L = d.y ?? state.level, q = this._strokeRec(t.def, L, slot);
          if (q) { this._strokePlace(d, { p: q, def: t.def, key: this.world.keyOf(q), valid: true }); continue; }
          // a window or door it crossed keeps its place (and takes a restyled row's look)
          const key = this.world.keyOf({ t: t.def.id, y: L, ...slot }), m = this.materialFor(t.def);
          if (key && !d.seen.has(key)) this._strokeKeep(d, { def: t.def, key, existing: this.world.get(key), p: { m, c: this.colorFor(t.def, m) } });
        }
      }
      if (d.seen.has(t.key) || !t.valid) return;
      if (t.def.slot === 'edge' && d.line === undefined) {
        // the first edge sets the stroke's line (see _strokeLine)
        const x = t.p.a === 'x';
        d.axis = t.p.a; d.line = x ? t.p.z : t.p.x; d.on = (x ? t.p.x : t.p.z) + 0.5; d.seg = x ? t.p.x : t.p.z;
      }
      if (this._strokeKeep(d, t)) return;
      this._strokePlace(d, t);
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

  /** Place a stroke's piece (once per slot per stroke). */
  _strokePlace(d, t) {
    if (d.seen.has(t.key)) return;
    d.seen.add(t.key);
    const before = this.world.get(t.key);
    const entry = this.place(t.p, { silent: d.count > 0 && d.count % 2 === 1 });
    if (!entry) return;
    if (!before) {
      d.fresh.set(t.key, entry.p);
      // the last new segment of the current row (a stub to take back if the stroke turns short of it)
      const q = entry.p;
      if (q.a && q.a === d.axis && (q.a === 'x' ? q.z : q.x) === d.line) {
        d.last = { key: t.key, i: q.a === 'x' ? q.x : q.z };
        if (d.hopFrom) d.hopFrom.keys.push(t.key);      // laid on a line it just hopped to (see _strokeLine)
        if (d.turn) d.turn.keys.push(t.key);            // …or just turned onto
      }
    }
    d.count++; d.ops++;
    this._afterPlace(t, d.touch, true);
  }

  /**
   * A stroke passing over a window, door, archway or gable keeps it: only a tap swaps one (or a stroke of
   * windows & doors, or of that very piece). A row of walls restyled by the stroke keeps its windows and doors
   * in the row's new look. Returns true when the slot was kept.
   */
  _strokeKeep(d, t) {
    const cur = t.existing, cd = cur && getDef(cur.t);
    if (!cd || cd.id === t.def.id || t.def.layer !== 'W' || t.def.cat === 'openings') return false;
    if (cd.cat !== 'openings' && !cd.autoGable && cd.id !== 'wall_arch') return false;
    d.seen.add(t.key);
    if (cd.cat === 'openings' && t.def.matGroup === cd.matGroup && t.p.m && cd.mats?.includes(t.p.m)) {
      const res = this.world.update(t.key, { m: t.p.m, c: t.p.c || null });
      if (res && res.p !== cur) {
        this.app.effects.popIn(res.obj, 0.22);
        if (d.count % 2 === 0) events.emit('sfx', { name: 'paint' });
        d.count++; d.ops++;
      }
    }
    return true;
  }

  /** Take back stub segments a stroke laid past the corner it turned at (only pieces it put into empty slots). */
  _strokeDrop(d) {
    const keys = d.drop;
    d.drop = [];
    for (const key of keys) {
      const q = d.fresh.get(key);
      d.fresh.delete(key);
      d.seen.delete(key);
      const e = this.world.entry(key);
      if (!q || !e || e.p !== q) continue;
      const pos = e.obj.position.clone();
      this.world.remove(key);
      this.app.effects.puff(pos.setY(pos.y + 0.3), 0xf3ead8, 5, 0.6);
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
    // chosen from its own tray (a card), not handed over by opening a tab
    const fromTray = state.category === def.cat;
    const patch = { pieceId: id, category: def.cat, tool: 'build', hOffset: 0 };
    if (def.rot === 'flip' && state.rot % 2) patch.rot = 0;
    state.set(patch);
    if (this._toItsFloor(def, fromTray)) return;
    if (!prev || prev.cat !== def.cat || prev.layer !== def.layer) this._autoView(def);
  }

  /**
   * A piece picked up on a floor too high for it (a tree up on Floor 3, a foundation on Floor 2, stairs on the
   * top floor): step down to the highest floor it can go on, with a gentle word. Only for a piece the player
   * chose — opening the Floors tab upstairs hands over a foundation, but they're likely after floor tiles —
   * except garden things, which all live outdoors: upstairs they only stay for a deck or roof terrace there.
   * Guided builds pick the floor themselves. Returns true when the floor changed.
   */
  _toItsFloor(def, chosen = true) {
    let hi = def.levels?.[1] ?? MAX_LEVEL;
    if (def.cat === 'garden' && state.level > 0 && !this._outdoorAt(state.level)) hi = 0;
    if (state.blueprint || state.level <= hi || (!chosen && def.cat !== 'garden')) return false;
    this.setLevel(hi);
    if (state.level !== hi) return false;
    let text;
    if (hi === 0) text = def.cat === 'garden' ? '🌷 Back to Floor 1 — the garden grows on the ground' : `${def.icon || '🌱'} Back to Floor 1 — this one sits on the ground`;
    else if (/^(stairs|stairs_spiral|ladder)$/.test(def.id)) text = `🪜 Floor ${hi + 1} — stairs climb from here up to Floor ${hi + 2}`;
    else text = `${def.icon || '🪜'} Floor ${hi + 1} — as high as this one goes`;
    events.emit('toast', { text, kind: 'info', ms: 2600 });
    return true;
  }

  /** Has floor y somewhere outdoors to set garden things on (a deck, or a flat roof laid on that floor)? */
  _outdoorAt(y) {
    for (const e of this.world.entries.values()) {
      if (e.p.y === y && e.def.id === 'deck') return true;
      if (e.def.roof?.kind === 'flat' && 2 * e.p.y + (e.p.h || 0) === 2 * y) return true;
    }
    return false;
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
      // like tapping a tab: hand over a piece from that category (the last one used there, else the first;
      // upstairs one that can go on this floor — garden things walk back down by themselves)
      const cat = CATEGORIES[+k - 1];
      if (!cat) return;
      const cur = getDef(state.pieceId);
      if (cur && cur.cat === cat.id) { state.set({ category: cat.id }); return; }
      const list = piecesIn(cat.id);
      const fits = (d) => state.level >= (d.levels?.[0] ?? 0) && state.level <= (d.levels?.[1] ?? MAX_LEVEL);
      const last = list.find((d) => d.id === this._lastInCat?.[cat.id]);
      const want = (last && (fits(last) || last.cat === 'garden') ? last : null) || list.find(fits) || last || list[0];
      if (want) this.selectPiece(want.id); else state.set({ category: cat.id });
    }
  }
}
