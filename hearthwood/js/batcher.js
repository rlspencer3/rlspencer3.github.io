// Static batching of the built world — far fewer draw calls for big builds.
//
// The placed pieces' meshes are merged into BATCH UNITS:
// * render units — one per (material, receiveShadow, shadow mode) for the whole lot (a material whose batch
//   grows past `splitVerts` vertices is split into lot quadrants). A render unit is one merged mesh that uses
//   the very same shared material object as the pieces, so night glow / season tints keep working.
// * shadow units — one per SIZE × SIZE-cell region (and face side): a position-only "proxy" of everything
//   in the region that casts a shadow. Proxies sit on LAYER_SHADOW, which only the lights' shadow cameras
//   see, so the shadow pass costs ~1 draw call per region; the render units then don't cast shadows.
//
// Draw calls end up ≈ number of distinct materials (+ unbatched glass) instead of ≈ pieces × materials.
//
// * Baked meshes live in their own group in the scene (never inside world.root, so picking never hits them).
// * Pieces' own meshes stay in world.root, raycastable, but move to layer LAYER_BAKED, which no camera
//   renders (world.pick enables that layer on its raycaster). `.visible` is left alone: levels use it.
// * Inside every merged buffer the vertices are sorted by level, so a level cutaway (world.setView) is just
//   a shorter draw range — baked meshes hide exactly what the per-piece `.visible` would hide.
// * Any change (add / remove / replace / contextual remount / undo / redo / load / clear) PUNCHES the old
//   piece out of the merged buffers (its triangles collapse to a point; partial GPU upload) and puts it back
//   on layer 0, so new pieces, pop-in / pop-out tweens and paint render on their own right away while the
//   rest stays batched. A touched unit is rebaked (time-sliced, ≤ budget ms per frame) once it has been
//   quiet for `quiet` seconds. Only units whose material / region the change touched are rebaked.
// * Pieces that are not SETTLED when their unit is baked — tweening, scaled (≠ 1) or with their inner group
//   hidden (a blueprint cascade keeps waiting pieces at scale 0.001, inner group hidden) — are left out of
//   that bake and keep rendering on their own (layer 0). They wait in `pending`; at most every
//   `settleEvery` seconds, when the baker has nothing else ready, the ones that have settled since are
//   folded in (their units rebake at once, shadow units first). So a long cascade costs a few rebakes
//   instead of every stamped piece drawing on its own until the very last one has landed.
// * Transparent materials (window glass…), userData.noMerge meshes and anything unusual (custom render
//   hooks, extra vertex attributes, mirrored transforms…) are never merged: they stay on layer 0.
// * Anything that animates a piece's object outside world mutations should use effects tweens (detected
//   automatically) or call world.batcher.wake(entry.obj); scale changes on baked pieces are detected too.
//
// Invariants: a mesh is inside a baked render unit exactly when it sits on LAYER_BAKED (so nothing is drawn
// twice or not at all); a mesh on LAYER_BAKED whose shadow goes through a proxy is always inside a baked
// proxy (render units only take such meshes once their shadow unit is baked; punching always removes a piece
// from every unit at once); a baked piece is always settled (anything else is punched out every frame).

import * as THREE from 'three';
import { MAX_LEVEL, GRID_MIN } from './config.js';

export const LAYER_BAKED = 1;    // source meshes of baked units: raycastable, never rendered
export const LAYER_SHADOW = 2;   // shadow proxies: seen by shadow cameras only

const NL = MAX_LEVEL + 2;      // cutaway levels: 0..MAX_LEVEL, plus a roof over the top floor's walls (world entry.level)
const MASK_LIVE = 1;
const MASK_BAKED = 1 << LAYER_BAKED;
const BASE_ATTRS = { position: true, normal: true, uv: true };
const DEFAULT_OBR = THREE.Object3D.prototype.onBeforeRender;
const DEFAULT_OAR = THREE.Object3D.prototype.onAfterRender;
const _nm = new THREE.Matrix3();
const now = () => performance.now();

const proxyMats = new Map();
function proxyMaterial(side, shadowSide) {
  const k = side + '|' + shadowSide;
  let m = proxyMats.get(k);
  if (!m) {
    // Only used by the shadow pass (side / shadowSide decide which faces go into the depth map).
    m = new THREE.MeshBasicMaterial({ side, colorWrite: false, depthWrite: false });
    m.shadowSide = shadowSide;
    m.name = 'batch-shadow|' + k;
    proxyMats.set(k, m);
  }
  return m;
}

/** Can the shadow pass draw this material's depth with a plain depth material? */
function proxyable(m) {
  if (m.alphaTest > 0 && (m.map || m.alphaMap)) return false;
  if (m.alphaToCoverage) return false;
  if (m.displacementMap && m.displacementScale !== 0) return false;
  if (m.clippingPlanes && m.clippingPlanes.length) return false;
  return true;
}

function isPlain(a, size) {
  return a && !a.isInterleavedBufferAttribute && !a.normalized && a.itemSize === size;
}

export class Batcher {
  /**
   * @param {World} world
   * @param {THREE.Scene} scene
   * @param {object} [opts] size (shadow region, cells, default 8) · splitVerts · splitSize · quiet (s) ·
   *   settleEvery (s) · budget (ms/frame) · enabled · shadowProxies · batchTransparent
   */
  constructor(world, scene, opts = {}) {
    this.world = world;
    this.scene = scene;
    this.root = new THREE.Group();
    this.root.name = 'world-batches';
    this.root.matrixAutoUpdate = false;
    scene?.add(this.root);
    const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    this.size = opts.size || 8;                         // shadow-proxy region edge in cells (8 cells = 16 m)
    this.splitVerts = opts.splitVerts || 131072;        // a whole-lot material batch bigger than this is split…
    this.splitSize = opts.splitSize || 10;              // …into regions of this many cells (lot quadrants)
    this.quiet = opts.quiet ?? 0.5;                     // seconds a unit must be untouched before rebaking
    this.settleEvery = opts.settleEvery ?? 0.25;        // seconds between folding settled pieces into batches
    this.budget = opts.budget ?? (coarse ? 4 : 6);      // ms of baking work per frame
    this.enabled = opts.enabled !== false;
    this.shadowProxies = opts.shadowProxies !== false;
    this.batchTransparent = !!opts.batchTransparent;    // off: glass etc. stays per piece (correct sorting)
    this.effects = null;                                // set by main.js (tween detection)
    this.units = new Map();                             // key -> unit
    this.entryUnits = new WeakMap();                    // entry -> [unit…] it belongs to
    this.recs = new WeakMap();                          // entry.obj -> [unit, parts, unit, parts…]; parts = [mesh, start, count…]
    this.inProxy = new WeakSet();                       // source meshes whose shadow a baked proxy draws
    this.split = new Set();                             // material ids batched per region instead of whole-lot
    this.dirty = new Set();
    this.pending = new Set();                           // entries left out of a bake because they were not settled
    this.job = null;
    this.viewLevel = MAX_LEVEL;
    this.seeAll = true;
    this.changed = false;                               // baked / unbaked since the last update() → shadow refresh
    this._anim = new Set();                             // objects effects tweens animate (refreshed every update)
    this._sweepAt = -Infinity;
    this._lightTick = 0;
    this._msPerVert = 0.0001;                           // running estimate of copy cost (keeps slices in budget)
    this.stat = { bakes: 0, totalMs: 0, lastMs: 0, maxBakeMs: 0, maxSliceMs: 0, punches: 0, splits: 0 };
  }

  // ------------------------------------------------------------------ bookkeeping (called by World)

  /** A piece was mounted. */
  add(entry) {
    const us = this._unitsFor(entry);
    this.entryUnits.set(entry, us);
    for (const u of us) { u.entries.add(entry); this._touch(u); }
  }

  /** A piece is being unmounted: punch it out (its object goes back on layer 0, e.g. for a pop-out). */
  remove(entry) {
    this._punch(entry.obj);
    const us = this.entryUnits.get(entry);
    this.entryUnits.delete(entry);
    if (us) for (const u of us) this._leave(u, entry);
  }

  /** A piece's object was rebuilt in place (contextual neighbour change…). */
  remounted(entry, oldObj) {
    this._punch(oldObj);
    this._rekey(entry);
  }

  /** Make a piece render on its own right now (call before animating entry.obj outside world mutations). */
  wake(obj) {
    const punched = this._punch(obj);
    // a bake in progress that copied this piece must not swap it in: start that unit over after the quiet period
    if (this.job && this.job.objs.has(obj)) this._touch(this.job.unit);
    return punched;
  }

  /** Forget every bake and unit (world cleared / about to load). */
  reset() {
    this._unbakeAll();
    this.units.clear();
    this.dirty.clear();
    this.pending.clear();
    this.entryUnits = new WeakMap();
    this.split.clear();
  }

  /** Bake touched units as soon as possible (skip the quiet period), e.g. after a load. */
  flush() {
    for (const u of this.dirty) u.dirtyAt = -Infinity;
    this._sweepAt = -Infinity;
  }

  setEnabled(on) {
    on = !!on;
    if (on === this.enabled) return;
    this.enabled = on;
    if (!on) this._unbakeAll();
    else for (const u of this.units.values()) { this._touch(u); u.dirtyAt = -Infinity; }
    this.changed = true;
  }

  /** Level cutaway: same rule as World._levelVisible (seeAll || level <= viewLevel). */
  setView(level, seeAll) {
    this.viewLevel = level;
    this.seeAll = seeAll;
    for (const u of this.units.values()) this._applyView(u);
    this.changed = true;
  }

  // ------------------------------------------------------------------ per frame

  /** Advance baking. Returns true when the baked set changed since the last call (refresh shadow maps). */
  update() {
    if (this.enabled) {
      const anim = this._animSet();
      // safety net: a baked piece that is tweening, rescaled or hidden must render on its own
      for (const o of anim) if (this.recs.has(o)) this._punch(o);
      for (const e of this.world.entries.values()) {
        if (!this._still(e.obj) && this.recs.has(e.obj)) this._punch(e.obj);
      }
      if (this.dirty.size || this.job || this.pending.size) this._work(this.budget, anim);
      if (++this._lightTick >= 90) { this._lightTick = 0; this._scanLights(); }
    }
    const ch = this.changed;
    this.changed = false;
    return ch;
  }

  /** Synchronously bake everything that is ready (tests, or before a one-off capture). Returns units baked. */
  bakeNow(ignoreQuiet = true) {
    if (!this.enabled) return 0;
    if (ignoreQuiet) this.flush();
    const before = this.stat.bakes;
    this._work(Infinity, this._animSet());
    return this.stat.bakes - before;
  }

  /** Is this piece currently drawn by a batch (its own meshes on LAYER_BAKED)? */
  isBaked(entry) {
    return !!entry && this.recs.has(entry.obj);
  }

  /** Units of a placed piece: [{ key, kind: 'r'|'s', baked, dirty, verts, entries }]. */
  unitsOf(entry) {
    return (this.entryUnits.get(entry) || []).map((u) => ({
      key: u.key, kind: u.kind, baked: !!u.mesh, dirty: u.dirty, verts: u.verts, entries: u.entries.size, mesh: u.mesh,
    }));
  }

  stats() {
    let render = 0, proxies = 0, verts = 0, baked = 0;
    for (const u of this.units.values()) {
      if (u.mesh) { baked++; if (u.kind === 'r') render++; else proxies++; }
      verts += u.verts;
    }
    let live = 0, entries = 0;
    for (const e of this.world.entries.values()) { entries++; if (!this.recs.has(e.obj)) live++; }
    return {
      enabled: this.enabled, units: this.units.size, bakedUnits: baked, dirty: this.dirty.size, busy: !!this.job,
      pending: this.pending.size, meshes: render, proxies, verts, entries, liveEntries: live, split: this.split.size, ...this.stat,
    };
  }

  // ------------------------------------------------------------------ settled pieces

  /** Objects animated by effects tweens right now (one shared set, rebuilt per call). */
  _animSet() {
    const anim = this._anim;
    anim.clear();
    const tw = this.effects?.tweens;
    if (tw) for (let i = 0; i < tw.length; i++) anim.add(tw[i].obj);
    return anim;
  }

  /** Full scale and look shown (a blueprint cascade hides the inner group of pieces waiting for their pop-in). */
  _still(obj) {
    const s = obj.scale;
    if (s.x !== 1 || s.y !== 1 || s.z !== 1) return false;
    const inner = obj.children[0];
    return !inner || inner.visible !== false;
  }

  /** May this piece be baked now? (still, and no tween on it) */
  _settled(obj, anim) {
    return this._still(obj) && !anim.has(obj);
  }

  /**
   * Fold pending pieces that have settled into their batches: their units (the ones that don't hold them yet)
   * become ready right away. Runs only when the baker has nothing else ready, at most every `settleEvery`
   * seconds, so pieces landing one after another are folded in a few at a time. Returns true if any unit
   * was marked.
   */
  _sweep(t, anim) {
    if (!this.pending.size || t - this._sweepAt < this.settleEvery * 1000) return false;
    this._sweepAt = t;
    let marked = false;
    for (const e of this.pending) {
      const us = this.entryUnits.get(e);
      if (!us) { this.pending.delete(e); continue; }       // removed from the world meanwhile
      if (!this._settled(e.obj, anim)) continue;
      this.pending.delete(e);
      for (const u of us) {
        if (u.dirty || u.objs.has(e.obj)) continue;      // already holds it, or rebakes soon anyway
        u.dirty = true;
        u.dirtyAt = -Infinity;
        this.dirty.add(u);
        marked = true;
      }
    }
    return marked;
  }

  // ------------------------------------------------------------------ units & membership

  _region(p, S, o) {
    return Math.floor((p.x - o) / S) + ',' + Math.floor((p.z - o) / S);
  }

  /** Render-unit key of an eligible mesh of a piece at record p. */
  _rkey(m, p) {
    const mat = m.material;
    const mode = m.castShadow ? (this.shadowProxies && proxyable(mat) ? 'p' : 'c') : '0';
    const reg = this.split.has(mat.id) ? this._region(p, this.splitSize, GRID_MIN) : 'g';
    return 'r' + mat.id + '|' + (m.receiveShadow ? 1 : 0) + mode + '|' + reg;
  }

  /** Shadow-unit key of an eligible mesh (null when its shadow is not drawn by a proxy). */
  _skey(m, p) {
    if (!m.castShadow || !this.shadowProxies || !proxyable(m.material)) return null;
    return 's' + m.material.side + '|' + m.material.shadowSide + '|' + this._region(p, this.size, 0);
  }

  _unit(key, kind, m) {
    let u = this.units.get(key);
    if (!u) {
      const mat = m.material;
      u = {
        key, kind,
        material: kind === 'r' ? mat : null,
        mode: kind === 'r' ? (m.castShadow ? (this.shadowProxies && proxyable(mat) ? 'p' : 'c') : '0') : 's',
        receive: kind === 'r' && m.receiveShadow,
        side: mat.side, shadowSide: mat.shadowSide,
        entries: new Set(), objs: new Set(), mesh: null, attr: null,
        dirty: false, dirtyAt: 0, verts: 0, needsCover: false,
      };
      this.units.set(key, u);
    }
    return u;
  }

  _unitsFor(entry) {
    const out = [];
    if (entry.obj) this._scan(entry.obj, 0, entry.p, out);
    return out;
  }

  _scan(o, depth, p, out) {
    // a hidden sub-part is left alone; the wrapper (level cutaway) and its inner group (a piece waiting in a
    // blueprint cascade) count anyway: the piece joins those units once it is shown
    if (depth > 1 && o.visible === false) return;
    if (o.isMesh && this._eligible(o, false)) {
      const u = this._unit(this._rkey(o, p), 'r', o);
      if (!out.includes(u)) out.push(u);
      const sk = this._skey(o, p);
      if (sk) {
        const s = this._unit(sk, 's', o);
        if (!out.includes(s)) out.push(s);
      }
    }
    const ch = o.children;
    for (let i = 0; i < ch.length; i++) this._scan(ch[i], depth + 1, p, out);
  }

  /** Recompute a piece's units (its object or the split set changed). Touches old and new units. */
  _rekey(entry) {
    const old = this.entryUnits.get(entry) || [];
    const next = this._unitsFor(entry);
    this.entryUnits.set(entry, next);
    for (const u of old) if (!next.includes(u)) this._leave(u, entry);
    for (const u of next) { u.entries.add(entry); this._touch(u); }
  }

  _leave(u, entry) {
    u.entries.delete(entry);
    if (!u.entries.size) this._dropUnit(u);
    else this._touch(u);
  }

  _touch(u) {
    u.dirty = true;
    u.dirtyAt = now();
    this.dirty.add(u);
    if (this.job && this.job.unit === u) this.job = null;   // its snapshot is stale
  }

  _dropUnit(u) {
    if (u.kind === 's') for (const obj of [...u.objs]) this._punch(obj);   // keep the shadow invariant
    this._release(u);
    this.units.delete(u.key);
    this.dirty.delete(u);
    if (this.job && this.job.unit === u) this.job = null;
  }

  _unbakeAll() {
    this.job = null;
    for (const u of this.units.values()) this._release(u);
  }

  // ------------------------------------------------------------------ punching

  /** Take a piece out of every batch at once: collapse its triangles, put its meshes back on layer 0. */
  _punch(obj) {
    const rec = obj && this.recs.get(obj);
    if (!rec) return false;
    this.recs.delete(obj);
    for (let i = 0; i < rec.length; i += 2) {
      const u = rec[i], parts = rec[i + 1], attr = u.attr;
      for (let j = 0; j < parts.length; j += 3) {
        const m = parts[j];
        if (u.kind === 'r') m.layers.mask = MASK_LIVE; else this.inProxy.delete(m);
        if (attr) {
          const s = parts[j + 1] * 3, n = parts[j + 2] * 3;
          attr.array.fill(0, s, s + n);
          attr.addUpdateRange(s, n);
        }
      }
      if (attr) attr.needsUpdate = true;
      u.objs.delete(obj);
      this._touch(u);
    }
    this.stat.punches++;
    this.changed = true;
    return true;
  }

  /** Remove a unit's batch and its records (source meshes back to normal); buffers are disposed. */
  _release(u) {
    for (const obj of u.objs) {
      const rec = this.recs.get(obj);
      if (!rec) continue;
      for (let i = 0; i < rec.length; i += 2) {
        if (rec[i] !== u) continue;
        const parts = rec[i + 1];
        for (let j = 0; j < parts.length; j += 3) {
          if (u.kind === 'r') parts[j].layers.mask = MASK_LIVE; else this.inProxy.delete(parts[j]);
        }
        rec.splice(i, 2);
        break;
      }
      if (!rec.length) this.recs.delete(obj);
    }
    u.objs.clear();
    if (u.mesh) {
      this.root.remove(u.mesh);
      u.mesh.geometry.dispose();
      u.mesh = null;
      u.attr = null;
      u.verts = 0;
      if (u.kind === 's' || u.mode === 'c') this.changed = true;
    }
  }

  _applyView(u) {
    const m = u.mesh;
    if (!m) return;
    const b = m.userData.batch, L = this.viewLevel;
    const n = this.seeAll ? b.total : L < 0 ? 0 : b.levelEnd[Math.min(L, NL - 1)];
    m.geometry.setDrawRange(0, n);
    m.visible = n > 0;
  }

  // ------------------------------------------------------------------ baking

  _work(budget, anim) {
    const t0 = now();
    const deadline = t0 + budget;
    for (;;) {
      let t = now();
      if (!this.job) {
        if (t > t0 && deadline - t < budget * 0.25) break;   // not worth starting another unit this frame
        let u = this._nextReady(t);
        if (!u && this._sweep(t, anim)) u = this._nextReady(t);
        if (!u) break;
        this.dirty.delete(u);
        this.job = this._collect(u, anim);
        const t2 = now();
        if (this.job) this.job.ms += t2 - t;
        t = t2;
        if (!this.job) { if (t >= deadline) break; continue; }
      }
      const job = this.job;
      if (!job.done) {
        job.done = this._step(job, deadline);
        const t2 = now();
        job.ms += t2 - t;
        t = t2;
      }
      // the swap is cheap but not free: leave it for the next frame when out of time
      if (job.done && (t < deadline || job.ms === 0)) {
        this.job = null;
        this._commit(job, anim);
        job.ms += now() - t;
        this.stat.bakes++;
        this.stat.lastMs = job.ms;
        this.stat.totalMs += job.ms;
        if (job.ms > this.stat.maxBakeMs) this.stat.maxBakeMs = job.ms;
      }
      if (now() >= deadline) break;
    }
    const dt = now() - t0;
    if (dt > this.stat.maxSliceMs && budget !== Infinity) this.stat.maxSliceMs = dt;
  }

  /**
   * Next unit to bake: quiet for `quiet` seconds; shadow units first; a proxied render unit waits while a
   * shadow unit of its pieces is dirty (it would leave those pieces live and need another bake). Pieces that
   * are still animating don't hold a unit back: the bake leaves them out (see _collect / _sweep).
   */
  _nextReady(t) {
    const q = this.quiet * 1000;
    let sDirty = false;
    for (const u of this.dirty) {
      if (u.kind !== 's') continue;
      if (t - u.dirtyAt >= q) return u;
      sDirty = true;
    }
    for (const u of this.dirty) {
      if (u.kind !== 'r' || t - u.dirtyAt < q) continue;
      if (sDirty && u.mode === 'p' && !this._coverReady(u)) continue;
      return u;
    }
    return null;
  }

  _coverReady(u) {
    for (const e of u.entries) {
      const us = this.entryUnits.get(e);
      if (us) for (let i = 0; i < us.length; i++) if (us[i].kind === 's' && us[i].dirty) return false;
    }
    return true;
  }

  _eligible(m, full = true) {
    if (m.isInstancedMesh || m.isSkinnedMesh || m.isBatchedMesh) return false;
    if (m.userData.noMerge || m.renderOrder !== 0 || m.frustumCulled === false) return false;
    if (m.onBeforeRender !== DEFAULT_OBR || m.onAfterRender !== DEFAULT_OAR) return false;
    const lm = m.layers.mask;
    if (lm !== MASK_LIVE && lm !== MASK_BAKED) return false;
    const mat = m.material;
    if (!mat || Array.isArray(mat) || mat.visible === false) return false;
    if (mat.transparent && !this.batchTransparent) return false;
    const geo = m.geometry;
    if (!geo || !geo.isBufferGeometry || geo.isInstancedBufferGeometry) return false;
    const a = geo.attributes;
    if (!a.position || a.position.itemSize !== 3) return false;
    for (const k in a) if (!BASE_ATTRS[k]) return false;
    if (a.normal && a.normal.itemSize !== 3) return false;
    if (a.uv && a.uv.itemSize !== 2) return false;
    const mo = geo.morphAttributes;
    if (mo && (mo.position || mo.normal)) return false;
    if (full && m.matrixWorld.determinant() <= 0) return false;   // mirrored: winding would flip
    return true;
  }

  _gather(o, isRoot, e, lvl, job) {
    if (!isRoot && o.visible === false) return;
    if (o.isMesh && this._eligible(o, true)) {
      const u = job.unit;
      const key = u.kind === 'r' ? this._rkey(o, e.p) : this._skey(o, e.p);
      if (key === u.key) {
        if (u.mode === 'p' && !this.inProxy.has(o)) job.uncovered = true;   // shadow not proxied yet: stay live
        else {
          const geo = o.geometry;
          const total = geo.index ? geo.index.count : geo.attributes.position.count;
          const ds = Math.max(0, geo.drawRange.start | 0);
          const count = Math.max(0, Math.min(total, ds + geo.drawRange.count) - ds);
          job.items.push({ e, obj: e.obj, mesh: o, lvl, ds, count, start: 0 });
          job.objs.add(e.obj);
          job.counts[lvl] += count;
          job.total += count;
        }
      }
    }
    const ch = o.children;
    for (let i = 0; i < ch.length; i++) this._gather(ch[i], false, e, lvl, job);
  }

  /**
   * Snapshot a unit: which meshes go where (cheap); the vertex copying happens in _step. Pieces that are not
   * settled (tweening, scaled, inner group hidden) are left out: they keep rendering on their own and wait in
   * `pending` until they settle (see _sweep).
   */
  _collect(u, anim) {
    const job = {
      unit: u, items: [], objs: new Set(), skipped: [], counts: new Int32Array(NL), levelEnd: new Int32Array(NL),
      total: 0, uncovered: false, ii: 0, w: 0, pos: null, nor: null, uv: null, done: false, ms: 0,
      x0: Infinity, y0: Infinity, z0: Infinity, x1: -Infinity, y1: -Infinity, z1: -Infinity,
    };
    for (const e of u.entries) {
      const obj = e.obj;
      if (!obj) continue;
      if (!this._settled(obj, anim)) { job.skipped.push(e); continue; }
      obj.updateWorldMatrix(true, true);
      this._gather(obj, true, e, Math.min(NL - 1, Math.max(0, e.level | 0)), job);
    }
    if (u.kind === 'r' && job.total > this.splitVerts && u.key.endsWith('|g')) {
      // too big to rebake as one piece on every edit: batch this material per region from now on
      this.split.add(u.material.id);
      this.stat.splits++;
      const entries = [...u.entries];
      this._dropUnit(u);
      for (const e of entries) {
        this._rekey(e);
        for (const x of this.entryUnits.get(e)) x.dirtyAt = -Infinity;   // nothing to wait for
      }
      return null;
    }
    job.items.sort((a, b) => a.lvl - b.lvl);
    let acc = 0;
    for (let l = 0; l < NL; l++) { acc += job.counts[l]; job.levelEnd[l] = acc; }
    if (job.total) {
      job.pos = new Float32Array(job.total * 3);
      if (u.kind === 'r') { job.nor = new Float32Array(job.total * 3); job.uv = new Float32Array(job.total * 2); }
    }
    return job;
  }

  /** Copy vertices until the deadline (estimated before each piece). Returns true when the job is complete. */
  _step(job, deadline) {
    const items = job.items;
    let first = true;
    while (job.ii < items.length) {
      const it = items[job.ii];
      const t = now();
      if (!first && t + it.count * this._msPerVert > deadline) return false;
      this._write(job, it);
      job.ii++;
      first = false;
      if (it.count > 256) {
        const per = (now() - t) / it.count;
        this._msPerVert += (per - this._msPerVert) * 0.2;
      }
    }
    return true;
  }

  _write(job, it) {
    const mesh = it.mesh, geo = mesh.geometry, n = it.count;
    const base = job.w;
    it.start = base;
    job.w += n;
    if (!n) return;
    const P = geo.attributes.position, I = geo.index;
    const N = job.nor ? geo.attributes.normal : null, U = job.uv ? geo.attributes.uv : null;
    const e = mesh.matrixWorld.elements;
    const m0 = e[0], m1 = e[1], m2 = e[2], m4 = e[4], m5 = e[5], m6 = e[6], m8 = e[8], m9 = e[9], m10 = e[10];
    const m12 = e[12], m13 = e[13], m14 = e[14];
    const pos = job.pos, nor = job.nor, uv = job.uv;
    const ia = I ? I.array : null;
    const pa = isPlain(P, 3) ? P.array : null;
    const ds = it.ds;
    let x0 = job.x0, y0 = job.y0, z0 = job.z0, x1 = job.x1, y1 = job.y1, z1 = job.z1;
    for (let k = 0; k < n; k++) {
      const v = ia ? ia[ds + k] : ds + k;
      let x, y, z;
      if (pa) { const j = v * 3; x = pa[j]; y = pa[j + 1]; z = pa[j + 2]; } else { x = P.getX(v); y = P.getY(v); z = P.getZ(v); }
      const o = (base + k) * 3;
      const wx = m0 * x + m4 * y + m8 * z + m12;
      const wy = m1 * x + m5 * y + m9 * z + m13;
      const wz = m2 * x + m6 * y + m10 * z + m14;
      pos[o] = wx; pos[o + 1] = wy; pos[o + 2] = wz;
      if (wx < x0) x0 = wx; if (wx > x1) x1 = wx;
      if (wy < y0) y0 = wy; if (wy > y1) y1 = wy;
      if (wz < z0) z0 = wz; if (wz > z1) z1 = wz;
    }
    job.x0 = x0; job.y0 = y0; job.z0 = z0; job.x1 = x1; job.y1 = y1; job.z1 = z1;
    if (nor) {
      if (N) {
        _nm.getNormalMatrix(mesh.matrixWorld);
        const q = _nm.elements;
        const n0 = q[0], n1 = q[1], n2 = q[2], n3 = q[3], n4 = q[4], n5 = q[5], n6 = q[6], n7 = q[7], n8 = q[8];
        const na = isPlain(N, 3) ? N.array : null;
        for (let k = 0; k < n; k++) {
          const v = ia ? ia[ds + k] : ds + k;
          let a, b, c;
          if (na) { const j = v * 3; a = na[j]; b = na[j + 1]; c = na[j + 2]; } else { a = N.getX(v); b = N.getY(v); c = N.getZ(v); }
          const o = (base + k) * 3;
          nor[o] = n0 * a + n3 * b + n6 * c;
          nor[o + 1] = n1 * a + n4 * b + n7 * c;
          nor[o + 2] = n2 * a + n5 * b + n8 * c;
        }
      } else {
        // no normals in the source: flat face normals
        for (let k = 0; k + 2 < n; k += 3) {
          const a = (base + k) * 3, b = a + 3, c = a + 6;
          const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
          const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
          let fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
          const l = Math.hypot(fx, fy, fz) || 1;
          fx /= l; fy /= l; fz /= l;
          for (let j = 0; j < 9; j += 3) { nor[a + j] = fx; nor[a + j + 1] = fy; nor[a + j + 2] = fz; }
        }
      }
    }
    if (uv && U) {
      const ua = isPlain(U, 2) ? U.array : null;
      for (let k = 0; k < n; k++) {
        const v = ia ? ia[ds + k] : ds + k;
        const t = (base + k) * 2;
        if (ua) { const j = v * 2; uv[t] = ua[j]; uv[t + 1] = ua[j + 1]; } else { uv[t] = U.getX(v); uv[t + 1] = U.getY(v); }
      }
    }
  }

  _commit(job, anim) {
    const u = job.unit;
    const oldObjs = u.kind === 's' && u.objs.size ? [...u.objs] : null;
    this._release(u);
    u.dirty = false;
    u.needsCover = job.uncovered;
    for (const e of job.skipped) this.pending.add(e);
    // a piece that started animating while this job was copying stays live: collapse its copy, don't record it
    let late = null;
    for (const obj of job.objs) if (!this._settled(obj, anim)) (late || (late = new Set())).add(obj);
    if (late) {
      for (const it of job.items) {
        if (!late.has(it.obj)) continue;
        job.pos.fill(0, it.start * 3, (it.start + it.count) * 3);
        this.pending.add(it.e);
      }
    }
    if (job.total) {
      const geo = new THREE.BufferGeometry();
      const P = new THREE.BufferAttribute(job.pos, 3);
      geo.setAttribute('position', P);
      if (u.kind === 'r') {
        geo.setAttribute('normal', new THREE.BufferAttribute(job.nor, 3));
        geo.setAttribute('uv', new THREE.BufferAttribute(job.uv, 2));
      }
      geo.boundingBox = new THREE.Box3(new THREE.Vector3(job.x0, job.y0, job.z0), new THREE.Vector3(job.x1, job.y1, job.z1));
      geo.boundingSphere = geo.boundingBox.getBoundingSphere(new THREE.Sphere());
      let mesh;
      if (u.kind === 'r') {
        mesh = new THREE.Mesh(geo, u.material);
        mesh.name = 'batch';
        mesh.castShadow = u.mode === 'c';
        mesh.receiveShadow = u.receive;
      } else {
        mesh = new THREE.Mesh(geo, proxyMaterial(u.side, u.shadowSide));
        mesh.name = 'batch-shadow';
        mesh.castShadow = true;
        mesh.receiveShadow = false;
        mesh.layers.set(LAYER_SHADOW);
      }
      mesh.matrixAutoUpdate = false;
      mesh.userData.batch = { total: job.total, levelEnd: job.levelEnd, unit: u.key };
      this.root.add(mesh);
      u.mesh = mesh;
      u.attr = P;
      u.verts = job.total;
      // records: which piece meshes this batch now draws
      let lastObj = null, parts = null;
      for (const it of job.items) {
        if (late && late.has(it.obj)) continue;
        if (it.obj !== lastObj) {
          lastObj = it.obj;
          let rec = this.recs.get(it.obj);
          if (!rec) { rec = []; this.recs.set(it.obj, rec); }
          parts = null;
          for (let i = 0; i < rec.length; i += 2) if (rec[i] === u) { parts = rec[i + 1]; break; }
          if (!parts) { parts = []; rec.push(u, parts); }
          u.objs.add(it.obj);
        }
        parts.push(it.mesh, it.start, it.count);
        if (u.kind === 'r') it.mesh.layers.mask = MASK_BAKED;
        else this.inProxy.add(it.mesh);
      }
      this._applyView(u);
    }
    if (u.kind === 's') {
      // a piece that was in the old proxy but not in the new one must not stay hidden without a shadow
      if (oldObjs) for (const obj of oldObjs) if (!u.objs.has(obj)) this._punch(obj);
      // render units that skipped pieces waiting for this proxy can now take them
      for (const e of u.entries) {
        const us = this.entryUnits.get(e);
        if (us) for (const r of us) if (r.kind === 'r' && r.needsCover && !r.dirty) { this._touch(r); r.dirtyAt = -Infinity; }
      }
      if (u.mesh) this._scanLights();
    }
    // a render unit whose shadow goes through a proxy doesn't change the shadow map
    if (u.kind === 's' || u.mode === 'c') this.changed = true;
  }

  /** Every shadow camera must also see the proxies' layer (three.js then uses its layers for the pass). */
  _scanLights() {
    if (!this.scene) return;
    const skip1 = this.world.root, skip2 = this.root;
    const visit = (o) => {
      if (o === skip1 || o === skip2) return;
      if (o.isLight && o.shadow && o.shadow.camera) {
        const L = o.shadow.camera.layers;
        if (!L.isEnabled(LAYER_SHADOW)) { L.enable(0); L.enable(LAYER_SHADOW); }
      }
      const ch = o.children;
      for (let i = 0; i < ch.length; i++) visit(ch[i]);
    };
    visit(this.scene);
  }
}
