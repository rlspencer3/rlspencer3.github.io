// World model: the set of placed pieces, their 3D objects, undo/redo and (de)serialization.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/BufferGeometryUtils.js';
import {
  CELL, STEP, levelY, slotKey, roofSteps, inGrid, inGridVertex, MAX_LEVEL, GRID_MIN, GRID_MAX,
} from './config.js';
import { getDef } from './catalog.js';
import { MATERIALS } from './materials.js';
import { events } from './state.js';
import { Batcher, LAYER_BAKED } from './batcher.js';

const HALF_PI = Math.PI / 2;
const RECORD_FIELDS = ['t', 'x', 'y', 'z', 'a', 'r', 'h', 's', 'm', 'c', 'k'];

/** Strip runtime fields and defaults so records stay small in saves. */
export function compact(p) {
  const o = { t: p.t, x: p.x, y: p.y, z: p.z };
  if (p.a) o.a = p.a;
  if (p.r) o.r = p.r;
  if (p.h) o.h = p.h;
  if (p.s) o.s = p.s;
  if (p.m) o.m = p.m;
  if (p.c) o.c = p.c;
  if (p.k) o.k = p.k;
  return o;
}

export class World {
  /**
   * @param {THREE.Scene} scene
   * @param {object} [opts] { batch: false | batcher options } — static batching (see batcher.js), on by default
   */
  constructor(scene, opts = {}) {
    this.root = new THREE.Group();
    this.root.name = 'world';
    scene.add(this.root);
    this.entries = new Map();      // key -> { key, p, def, obj, level }
    this.undoStack = [];
    this.redoStack = [];
    this._batch = null;
    this.viewLevel = MAX_LEVEL;
    this.seeAll = true;
    this.templates = new Map();    // build-signature -> merged template Object3D
    // Template cache bounds: templates used by placed pieces are kept; unused ("idle") ones are kept for quick
    // reuse (undo, ghosts, repaint back) up to maxIdleTemplates, then the least recently used are disposed.
    this._tplRefs = new Map();     // sig -> number of placed entries whose object was cloned from it
    this._tplIdle = new Set();     // sigs no placed entry uses, least recently used first
    this.maxIdleTemplates = 160;
    this.version = 0;              // bumps on every change
    // Static batching: merges settled pieces into ~one mesh per material (separate group in the scene).
    const bo = opts.batch === false ? { enabled: false } : (typeof opts.batch === 'object' ? opts.batch : {});
    this.batcher = new Batcher(this, scene, bo);
    /** Optional hook (from, to) called when a piece's object is rebuilt in place (main.js moves tweens). */
    this.onRemount = null;
  }

  /** Per-frame upkeep (batch baking). Returns true when shadow maps should be refreshed. */
  tick(dt) {
    if (this._tplIdle.size > this.maxIdleTemplates) this._trimTemplates();
    return this.batcher.update(dt);
  }

  // ---------- records ----------

  /** Fill defaults for a record and return a normalized copy (or null if the type is unknown). */
  normalize(p) {
    if (!p || typeof p !== 'object' || typeof p.t !== 'string') return null;
    const def = getDef(p.t);
    if (!def) return null;
    const q = {};
    for (const f of RECORD_FIELDS) if (p[f] !== undefined && p[f] !== null) q[f] = p[f];
    q.x |= 0; q.y |= 0; q.z |= 0;
    q.r = (q.r | 0) & 3;
    if (def.rot === 'none') q.r = 0;
    if (def.rot === 'flip') q.r = q.r >= 2 ? 2 : 0;
    if (def.slot === 'edge') q.a = q.a === 'z' ? 'z' : 'x'; else delete q.a;
    q.h = q.h | 0;
    if (def.mats && def.mats.length) {
      if (!q.m || !def.mats.includes(q.m)) q.m = def.mats[0];
    } else delete q.m;
    if (q.c && !(def.paint && q.m && MATERIALS[q.m]?.paintable) && !def.paintAlways) delete q.c;
    if (q.k && !def.accent) delete q.k;
    return q;
  }

  keyOf(p) {
    const def = p && getDef(p.t);
    return def ? slotKey(def, p) : null;
  }

  /** Placed record at a slot key (or undefined). */
  get(key) { return this.entries.get(key)?.p; }
  entry(key) { return this.entries.get(key); }
  get count() { return this.entries.size; }

  /** Is the record placeable (bounds & level rules)? Occupied slots are allowed (they get replaced). */
  validate(p) {
    const def = getDef(p.t);
    if (!def) return { ok: false, reason: 'Unknown piece' };
    const [lo, hi] = def.levels;
    if (p.y < lo || p.y > hi) return { ok: false, reason: lo === hi ? `Only on level ${lo + 1}` : 'Not on this level' };
    if (def.slot === 'cell') {
      if (!inGrid(p.x, p.z)) return { ok: false, reason: 'Outside the lot' };
    } else if (def.slot === 'corner') {
      if (!inGridVertex(p.x, p.z)) return { ok: false, reason: 'Outside the lot' };
    } else {
      // axis 'x': segment (x,z)->(x+1,z); axis 'z': segment (x,z)->(x,z+1)
      const ok = p.a === 'x'
        ? p.x >= GRID_MIN && p.x <= GRID_MAX && p.z >= GRID_MIN && p.z <= GRID_MAX + 1
        : p.z >= GRID_MIN && p.z <= GRID_MAX && p.x >= GRID_MIN && p.x <= GRID_MAX + 1;
      if (!ok) return { ok: false, reason: 'Outside the lot' };
    }
    if (def.layer === 'R') {
      const hs = roofSteps(p);
      if (hs < 0 || hs > (MAX_LEVEL + 2) * 2) return { ok: false, reason: 'Too high' };
    }
    if (def.canPlace) {
      const r = def.canPlace(p, this.ctxFor(p, def));
      if (r && r !== true) return { ok: false, reason: typeof r === 'string' ? r : 'Cannot place here' };
    }
    return { ok: true };
  }

  // ---------- object building ----------

  ctxFor(p, def) {
    return {
      world: this,
      def,
      p,
      get: (key) => this.get(key),
      defOf: (rec) => (rec ? getDef(rec.t) : null),
    };
  }

  /** World transform for a record. */
  placeTransform(p, def, obj) {
    let x, y = levelY(p.y), z, ry = 0;
    if (def.slot === 'cell') {
      x = (p.x + 0.5) * CELL; z = (p.z + 0.5) * CELL;
      ry = p.r * HALF_PI;
      if (def.layer === 'R') y += (p.h || 0) * STEP;
    } else if (def.slot === 'edge') {
      if (p.a === 'z') { x = p.x * CELL; z = (p.z + 0.5) * CELL; ry = HALF_PI; }
      else { x = (p.x + 0.5) * CELL; z = p.z * CELL; }
      if (p.r === 2) ry += Math.PI;
    } else {
      x = p.x * CELL; z = p.z * CELL;
    }
    obj.position.set(x, y, z);
    obj.rotation.set(0, ry, 0);
  }

  /** Template-cache signature for a record (null when the piece can't be cached). */
  signature(p, def = getDef(p.t), ctx = this.ctxFor(p, def)) { return this._signature(p, def, ctx); }

  _signature(p, def, ctx) {
    let sig = `${p.t}|${p.m || ''}|${p.c || ''}|${p.k || ''}|${p.h || 0}|${p.s || 0}`;
    if (def.contextual) {
      if (!def.contextKey) return null;
      sig += '|' + def.contextKey(p, ctx);
    }
    if (def.cacheExtra) sig += '|' + def.cacheExtra(p);
    return sig;
  }

  /** Build the local-space object for a record (merged by material, cached when possible). */
  buildLocal(p) {
    const def = getDef(p.t);
    const ctx = this.ctxFor(p, def);
    return this._buildLocal(p, def, ctx, this._signature(p, def, ctx));
  }

  _buildLocal(p, def, ctx, sig) {
    let tpl = sig ? this.templates.get(sig) : null;
    if (tpl) {
      if (this._tplIdle.has(sig)) { this._tplIdle.delete(sig); this._tplIdle.add(sig); }   // recently used
    } else {
      let raw;
      try {
        raw = def.build(p, ctx);
      } catch (e) {
        console.error(`build failed for ${p.t}`, e);
        raw = errorObject();
      }
      tpl = mergeByMaterial(raw);
      if (sig) {
        this.templates.set(sig, tpl);
        if (!this._tplRefs.get(sig)) this._tplIdle.add(sig);   // a ghost / overlay look: idle until placed
      }
    }
    return tpl.clone();
  }

  /** Count placed entries per template (d = +1 mounted, -1 unmounted); unused templates become idle. */
  _useTpl(sig, d) {
    if (!sig) return;
    const n = (this._tplRefs.get(sig) || 0) + d;
    if (n > 0) { this._tplRefs.set(sig, n); this._tplIdle.delete(sig); return; }
    this._tplRefs.delete(sig);
    if (this.templates.has(sig)) { this._tplIdle.delete(sig); this._tplIdle.add(sig); }
  }

  /** Dispose the least recently used idle templates beyond maxIdleTemplates (their geometry is theirs alone). */
  _trimTemplates() {
    const idle = this._tplIdle;
    while (idle.size > this.maxIdleTemplates) {
      const sig = idle.values().next().value;
      idle.delete(sig);
      const tpl = this.templates.get(sig);
      this.templates.delete(sig);
      if (tpl) tpl.traverse((o) => { if (o.userData.ownGeo) o.geometry.dispose(); });
    }
  }

  /** Build a fully positioned object (used for ghosts & blueprint overlays). */
  buildPlaced(p) {
    const def = getDef(p.t);
    const wrap = new THREE.Group();
    wrap.add(this.buildLocal(p));
    this.placeTransform(p, def, wrap);
    return wrap;
  }

  /** Positioned object for a placed record, tagged with its slot key and template signature. */
  _buildEntryObj(p, def, key) {
    const ctx = this.ctxFor(p, def);
    const sig = this._signature(p, def, ctx);
    const obj = new THREE.Group();
    obj.add(this._buildLocal(p, def, ctx, sig));
    this.placeTransform(p, def, obj);
    obj.traverse((o) => { o.userData.key = key; });
    obj.userData.sig = sig;
    return obj;
  }

  _mount(p, def, key) {
    const obj = this._buildEntryObj(p, def, key);
    this._useTpl(obj.userData.sig, 1);
    const entry = { key, p, def, obj, level: p.y };
    obj.visible = this._levelVisible(entry);
    this.root.add(obj);
    this.entries.set(key, entry);
    this.batcher.add(entry);
    return entry;
  }

  _unmount(entry) {
    this.batcher.remove(entry);
    this.root.remove(entry.obj);
    this.entries.delete(entry.key);
    this._useTpl(entry.obj.userData.sig, -1);
  }

  /** Rebuild a (contextual) piece in place. Skipped when its look (template signature) is unchanged. */
  _remountInPlace(entry, force = false) {
    const old = entry.obj;
    if (!force && old.userData.sig) {
      const sig = this._signature(entry.p, entry.def, this.ctxFor(entry.p, entry.def));
      if (sig === old.userData.sig) return false;
    }
    const obj = this._buildEntryObj(entry.p, entry.def, entry.key);
    obj.visible = old.visible;
    obj.scale.copy(old.scale);
    this.root.remove(old);
    this.root.add(obj);
    entry.obj = obj;
    this._useTpl(obj.userData.sig, 1);
    this._useTpl(old.userData.sig, -1);
    this.batcher.remounted(entry, old);
    if (this.onRemount) {
      try { this.onRemount(old, obj); } catch (e) { console.error(e); }
    }
    return true;
  }

  /** Rebuild contextual pieces near a record (within 1 cell and 1 level). */
  _refreshAround(p) {
    const y0 = p.y;
    for (const e of this.entries.values()) {
      if (!e.def.contextual) continue;
      const q = e.p;
      if (Math.abs(q.x - p.x) > 2 || Math.abs(q.z - p.z) > 2 || Math.abs(q.y - y0) > 2) continue;
      this._remountInPlace(e);
    }
  }

  // ---------- mutations (recorded for undo) ----------

  /**
   * Add a piece. Replaces anything in the same slot. Returns the entry or null.
   * opts.record (default true) pushes onto the undo stack.
   */
  add(rec, opts = {}) {
    const p = this.normalize(rec);
    if (!p) return null;
    const def = getDef(p.t);
    const v = this.validate(p);
    if (!v.ok && !opts.force) return null;
    const key = slotKey(def, p);
    const prev = this.entries.get(key);
    if (prev && sameRecord(prev.p, p)) return prev;
    const ops = [];
    if (prev) { this._unmount(prev); ops.push({ type: 'remove', p: prev.p }); }
    const entry = this._mount(p, def, key);
    ops.push({ type: 'add', p });
    this._refreshAround(p);
    this._record(ops, opts);
    this._changed('add', p, prev?.p);
    return entry;
  }

  remove(key, opts = {}) {
    const entry = this.entries.get(key);
    if (!entry) return null;
    this._unmount(entry);
    this._refreshAround(entry.p);
    this._record([{ type: 'remove', p: entry.p }], opts);
    this._changed('remove', entry.p);
    return entry.p;
  }

  /** Update fields of a placed piece (e.g. paint). Same slot only. */
  update(key, patch, opts = {}) {
    const entry = this.entries.get(key);
    if (!entry) return null;
    const next = this.normalize({ ...entry.p, ...patch });
    if (!next || sameRecord(next, entry.p)) return entry;
    if (this.keyOf(next) !== key) return null;
    return this.add(next, opts);
  }

  clear(opts = {}) {
    const ops = [];
    this.batcher.reset();
    for (const e of [...this.entries.values()]) { ops.push({ type: 'remove', p: e.p }); this._unmount(e); }
    this._record(ops, opts);
    this._changed('clear');
  }

  beginBatch() { if (!this._batch) this._batch = []; this._batchDepth = (this._batchDepth || 0) + 1; }
  /** Close a batch. Returns true when the outermost batch pushed one undo step (it recorded something). */
  endBatch() {
    if (!this._batch) return false;
    this._batchDepth--;
    if (this._batchDepth > 0) return false;
    const ops = this._batch;
    this._batch = null;
    if (!ops.length) return false;
    this.undoStack.push(ops); this.redoStack.length = 0; this._trimUndo();
    events.emit('history', { canUndo: this.canUndo(), canRedo: this.canRedo() });
    return true;
  }

  _record(ops, opts) {
    if (opts.record === false || !ops.length) return;
    if (this._batch) { this._batch.push(...ops); return; }
    this.undoStack.push(ops);
    this.redoStack.length = 0;
    this._trimUndo();
  }

  _trimUndo() { if (this.undoStack.length > 300) this.undoStack.shift(); }

  _apply(ops, invert) {
    const list = invert ? [...ops].reverse() : ops;
    for (const op of list) {
      const type = invert ? (op.type === 'add' ? 'remove' : 'add') : op.type;
      const key = this.keyOf(op.p);
      if (type === 'add') {
        const prev = this.entries.get(key);
        if (prev) this._unmount(prev);
        this._mount(op.p, getDef(op.p.t), key);
      } else {
        const e = this.entries.get(key);
        if (e) this._unmount(e);
      }
    }
    // refresh contextual pieces around everything touched (each one rebuilt once)
    this._refreshMany(list.map((op) => op.p));
  }

  /** Rebuild, once each, the contextual pieces within 2 cells / 2 levels of any of the given records. */
  _refreshMany(points) {
    if (points.length <= 2) { for (const p of points) this._refreshAround(p); return; }
    const touched = new Map();   // "x|z" -> [min y, max y]
    for (const p of points) {
      const k = p.x + '|' + p.z, t = touched.get(k);
      if (!t) touched.set(k, [p.y, p.y]);
      else { t[0] = Math.min(t[0], p.y); t[1] = Math.max(t[1], p.y); }
    }
    for (const e of this.entries.values()) {
      if (!e.def.contextual) continue;
      const q = e.p;
      let hit = false;
      for (let dx = -2; dx <= 2 && !hit; dx++) {
        for (let dz = -2; dz <= 2 && !hit; dz++) {
          const t = touched.get((q.x + dx) + '|' + (q.z + dz));
          if (t && q.y >= t[0] - 2 && q.y <= t[1] + 2) hit = true;
        }
      }
      if (hit) this._remountInPlace(e);
    }
  }

  canUndo() { return this.undoStack.length > 0; }
  canRedo() { return this.redoStack.length > 0; }

  undo() {
    const ops = this.undoStack.pop();
    if (!ops) return false;
    this._apply(ops, true);
    this.redoStack.push(ops);
    this._changed('undo');
    return true;
  }

  redo() {
    const ops = this.redoStack.pop();
    if (!ops) return false;
    this._apply(ops, false);
    this.undoStack.push(ops);
    this._changed('redo');
    return true;
  }

  /**
   * Revert the last undo step WITHOUT offering it as a redo (a gesture that turned out to be accidental,
   * e.g. a draw stroke that was really the start of a pinch). Emits world-change {kind:'undo'} and history.
   */
  discardLast() {
    const ops = this.undoStack.pop();
    if (!ops) return false;
    this._apply(ops, true);
    this._changed('undo');
    events.emit('history', { canUndo: this.canUndo(), canRedo: this.canRedo() });
    return true;
  }

  _changed(kind, p, prev) {
    this.version++;
    if (this._tplIdle.size > this.maxIdleTemplates) this._trimTemplates();
    events.emit('world-change', { kind, p, prev, count: this.entries.size });
  }

  // ---------- save / load ----------

  serialize() {
    const pieces = [];
    for (const e of this.entries.values()) pieces.push(compact(e.p));
    return { app: 'hearthwood', v: 1, pieces };
  }

  /** Replace the world with saved data. Not undoable unless opts.record. */
  load(data, opts = {}) {
    const list = Array.isArray(data) ? data : data?.pieces;
    if (!Array.isArray(list)) return false;
    const ops = [];
    this.batcher.reset();
    for (const e of [...this.entries.values()]) { ops.push({ type: 'remove', p: e.p }); this._unmount(e); }
    let n = 0;
    for (const rec of list) {
      const p = this.normalize(rec);
      if (!p) continue;
      const def = getDef(p.t);
      const key = slotKey(def, p);
      const prev = this.entries.get(key);
      if (prev) { this._unmount(prev); ops.push({ type: 'remove', p: prev.p }); }
      this._mount(p, def, key);
      ops.push({ type: 'add', p });
      n++;
    }
    // contextual pieces need neighbours present: rebuild them all once
    for (const e of this.entries.values()) if (e.def.contextual) this._remountInPlace(e);
    this.batcher.flush();          // bake on the next frames, no quiet period
    if (opts.record) this._record(ops, opts);
    else {
      // a fresh history: also drop a batch left open (e.g. a draw stroke), whose ops describe the old world
      this.undoStack.length = 0; this.redoStack.length = 0;
      this._batch = null; this._batchDepth = 0;
    }
    events.emit('history', { canUndo: this.canUndo(), canRedo: this.canRedo() });
    this._changed('load');
    return n;
  }

  // ---------- visibility & picking ----------

  _levelVisible(entry) {
    return this.seeAll || entry.level <= this.viewLevel;
  }

  setView(level, seeAll) {
    this.viewLevel = level;
    this.seeAll = seeAll;
    for (const e of this.entries.values()) e.obj.visible = this._levelVisible(e);
    this.batcher.setView(level, seeAll);
  }

  /** Raycast placed pieces; returns { entry, point, face } of the nearest visible hit or null. */
  pick(raycaster) {
    // pieces drawn by a batch sit on LAYER_BAKED (not rendered) but must stay pickable
    const mask = raycaster.layers.mask;
    raycaster.layers.enable(LAYER_BAKED);
    let hits;
    try { hits = raycaster.intersectObjects(this.root.children, true); } finally { raycaster.layers.mask = mask; }
    for (const h of hits) {
      let o = h.object, visible = true;
      for (let q = o; q; q = q.parent) if (!q.visible) { visible = false; break; }
      if (!visible) continue;
      const key = o.userData.key;
      const entry = key && this.entries.get(key);
      if (entry) return { entry, point: h.point, face: h.face, object: o };
    }
    return null;
  }
}

function sameRecord(a, b) {
  for (const f of RECORD_FIELDS) if ((a[f] ?? null) !== (b[f] ?? null)) return false;
  return true;
}

function errorObject() {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), new THREE.MeshBasicMaterial({ color: 0xff00ff })));
  return g;
}

const _m = new THREE.Matrix4();
/**
 * Flatten a built piece into one mesh per material (fewer draw calls).
 * Meshes flagged userData.noMerge are kept separately (e.g. animated or transparent parts).
 */
export function mergeByMaterial(root) {
  root.updateMatrixWorld(true);
  const groups = new Map();
  const keep = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    if (o.userData.noMerge || Array.isArray(o.material)) { keep.push(o); return; }
    let list = groups.get(o.material);
    if (!list) { list = []; groups.set(o.material, list); }
    list.push(o);
  });
  const out = new THREE.Group();
  out.name = root.name || 'piece';
  for (const [material, meshes] of groups) {
    const geos = [];
    let cast = false, receive = false;
    for (const m of meshes) {
      let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
      if (!g.attributes.normal) g.computeVertexNormals();
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      g.applyMatrix4(_m.copy(m.matrixWorld));
      g.morphAttributes = {};
      geos.push(g);
      cast ||= m.castShadow; receive ||= m.receiveShadow;
    }
    const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
    if (!merged) { meshes.forEach((m) => keep.push(m)); continue; }
    merged.computeBoundingSphere();
    const mm = new THREE.Mesh(merged, material);
    mm.userData.ownGeo = true;   // made here: disposed with its template (kept noMerge meshes may share geom.js geometry)
    mm.castShadow = cast; mm.receiveShadow = receive;
    out.add(mm);
  }
  for (const m of keep) {
    const c = m.clone();
    m.matrixWorld.decompose(c.position, c.quaternion, c.scale);
    out.add(c);
  }
  return out;
}
