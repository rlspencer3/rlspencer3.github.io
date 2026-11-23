// Placement controller: turns taps / drags into pieces on the grid.
// Tools: build · erase · paint · pick (eyedropper).

import * as THREE from 'three';
import {
  CELL, LEVEL_H, STEP, levelY, DIRS, K, roofSteps, MAX_LEVEL, GRID_MIN, GRID_MAX, clamp,
} from './config.js';
import { getDef, CATEGORIES } from './catalog.js';
import { state, events } from './state.js';
import { ghostMat, MATERIALS } from './materials.js';

const _ray = new THREE.Raycaster();
const _ndc = new THREE.Vector2();
const _plane = new THREE.Plane();
const _hit = new THREE.Vector3();
const _box = new THREE.Box3();

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

    this._makeHelpers();
    rig.onTap = (x, y) => this.tap(x, y);
    rig.onHover = (x, y) => this.hover(x, y);
    rig.onDrawStart = (x, y) => this.drawStart(x, y);
    rig.onDrawMove = (x, y) => this.drawMove(x, y);
    rig.onDrawEnd = () => this.drawEnd();
    rig.onGestureStart = () => this.hideGhost();
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
    const planeY = levelY(L);
    const hit = this.rayPlane(sx, sy, planeY);
    const pick = this.pickPiece(sx, sy);
    let px = hit?.x, pz = hit?.z;
    const p = { t: def.id, y: L };
    let fixed = false;

    if (pick && pick.entry.p.y === L) {
      const e = pick.entry;
      if (def.slot === 'edge' && e.def.slot === 'edge') {
        p.a = e.p.a; p.x = e.p.x; p.z = e.p.z; fixed = true;
      } else if (def.slot === 'corner' && (e.def.slot === 'edge' || e.def.slot === 'corner')) {
        px = pick.point.x; pz = pick.point.z;
      } else if (def.layer === 'R' && e.def.layer === 'R') {
        p.x = e.p.x; p.z = e.p.z; p.h = e.p.h; fixed = 'roof';
      }
    }
    if (!fixed) {
      if (px === undefined) return null;
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
    if (def.rot === 'four') p.r = state.rot & 3;
    else if (def.rot === 'flip') p.r = state.rot >= 2 ? 2 : 0;

    if (def.layer === 'R') {
      if (fixed !== 'roof') p.h = this.autoRoofHeight(def, p.x, p.z, p.r, L);
      p.h = clamp((p.h || 0) + (fixed === 'roof' ? 0 : state.hOffset), 0, 9);
    }
    if (def.autoGable) Object.assign(p, this.autoGable(def, p));

    const m = this.materialFor(def);
    if (m) p.m = m;
    const c = this.colorFor(def, m);
    if (c) p.c = c;
    if (def.accent) p.k = state.accent;

    const q = this.world.normalize(p);
    if (!q) return null;
    const v = this.world.validate(q);
    const key = this.world.keyOf(q);
    return { p: q, def, key, valid: v.ok, reason: v.reason, existing: this.world.get(key) };
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
    if (this._hlBox) { this.scene.remove(this._hlBox); this._hlBox = null; }
    this._hl = entry ? { obj: entry.obj } : null;
    if (!entry) return;
    _box.setFromObject(entry.obj);
    const helper = new THREE.Box3Helper(_box.clone(), state.tool === 'erase' ? 0xff8a7a : 0xfff0b0);
    helper.material.depthTest = false;
    helper.renderOrder = 10;
    this._hlBox = helper;
    this.scene.add(helper);
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
    const y = levelY(state.level) + 0.03;
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

  tap(sx, sy) {
    if (state.photoMode) return;
    this.lastScreen = { x: sx, y: sy };
    switch (state.tool) {
      case 'build': {
        const t = this.resolve(sx, sy);
        if (!t) return;
        if (!t.valid) { this._fail(t.reason); return; }
        this.place(t.p);
        this.hideGhost();
        break;
      }
      case 'erase': this.eraseAt(sx, sy); break;
      case 'paint': this.paintAt(sx, sy); break;
      case 'pick': this.pickAt(sx, sy); break;
    }
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
    this.drawing = { seen: new Set(), axis: null, count: 0 };
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
      if (this.place(t.p, { silent: d.count > 0 && d.count % 2 === 1 })) d.count++;
    } else if (state.tool === 'erase') {
      this.eraseAt(sx, sy);
    } else if (state.tool === 'paint') {
      const pick = this.pickPiece(sx, sy);
      if (pick && !d.seen.has(pick.entry.key)) { d.seen.add(pick.entry.key); this.paintAt(sx, sy); }
    }
  }

  drawEnd() {
    if (!this.drawing) return;
    this.drawing = null;
    this.world.endBatch();
    this.hideGhost();
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
    // stepping down a floor shows a cutaway (upper floors hidden); stepping up keeps the current view
    const patch = { level: lv, hOffset: 0 };
    if (lv < state.level) patch.seeAll = false;
    state.set(patch);
    events.emit('sfx', { name: 'level' });
  }

  selectPiece(id) {
    const def = getDef(id);
    if (!def) return;
    const patch = { pieceId: id, category: def.cat, tool: 'build', hOffset: 0 };
    if (def.rot === 'flip' && state.rot % 2) patch.rot = 0;
    state.set(patch);
  }

  undo() {
    if (this.world.undo()) { events.emit('sfx', { name: 'undo' }); return true; }
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
      const cat = CATEGORIES[+k - 1];
      if (cat) state.set({ category: cat.id });
    }
  }
}
