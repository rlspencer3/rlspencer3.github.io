#!/usr/bin/env node
// Hearthwood static-batching regression test. Run: node tools/batch-regress.mjs  (~6 min headless; exits 1 on any
// failed check). Set HW_ROOT to test a game checkout somewhere else; HW_TOWN=1 runs it with the town on (below).
// The server / browser / page helpers live in tools/harness.mjs (shared with tools/town-regress.mjs).
// Checks: animated stamp (settled pieces bake mid-cascade; per-frame invariants: nothing drawn twice / lost, no
// animating piece baked, no baked piece without its shadow proxy; mid-cascade pixels / cutaway / picks match
// unbatched; cascade draw calls), stamp→bake, erase at projected screen point, paint, undo/redo, level cutaways, pick/resolve equivalence,
// popOut of removed pieces, pop-in on rebuilt pieces, clear/load, snapshot, thumbnails, smoke emitters, guided ghosts,
// full UI, welcome lot, showcase, touch taps. Every 'matches unbatched' check renders the same frame with batching on/off.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, startServer, launch, openGame, saveDataURL, helpers, helpers2 } from './harness.mjs';
export { ROOT, startServer, launch, openGame, saveDataURL };      // old callers imported these from here
if (!fs.existsSync(path.join(ROOT, 'js', 'batcher.js'))) { console.error(`batch-regress: no game at ${ROOT} (set HW_ROOT)`); process.exit(2); }
// Every page runs with the villagers off (town=0), or with HW_TOWN=1 with a fresh town whose logic, rig wrapping and
// recomputes run but which draws nothing (town=fresh&townrender=0), so every check below holds unchanged either way
// (docs/LIVING.md §12.6, R13).
const TOWN_Q = process.env.HW_TOWN === '1' ? '&town=fresh&townrender=0' : '&town=0';
console.log(`batch-regress: ${process.env.HW_TOWN === '1' ? 'HW_TOWN=1 (town=fresh&townrender=0)' : 'town=0'}`);
const { server, base } = await startServer();
const browser = await launch();
let fails = 0, passes = 0;
const check = (name, ok, info) => { if (ok) passes++; else fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info !== undefined ? '  ' + JSON.stringify(info) : ''}`); };
const PIX_OK = (r) => r.pct < 0.2 && r.pct32 < 0.05;   // tiny z-fighting differences on coplanar edges are fine

async function game(q, opts) {
  const g = await openGame(browser, base, q + TOWN_Q, opts);
  await g.page.addScriptTag({ content: helpers });
  await g.page.addScriptTag({ content: helpers2 });
  return g;
}

// ---------------------------------------------------------------- 1. stamp + bake + edit cycle
{
  const { ctx, page, problems } = await game('clean=1&ui=0&nosave=1');
  const r1 = await page.evaluate(async () => {
    const hw = __hw, b = hw.world.batcher, T = __t, R = hw.renderer;
    const raf = () => new Promise((r) => requestAnimationFrame(r));
    // draw calls of every game frame while the cascade animates (every one of them redraws the shadow maps)
    const calls = [];
    let probing = false;
    const render = R.render;
    R.render = function (s, c) { render.call(this, s, c); if (!probing && hw.effects.tweens.length) calls.push(R.info.render.calls); };
    hw.blueprints.stamp('farmhouse', { animate: true, record: true });
    const inv = { doubleDraw: 0, lost: 0, unsettledBaked: 0, shadowless: 0 };
    let frames = 0, bakedMid = 0, tweenFrames = 0, mid = null;
    while (frames < 900) {
      await raf();
      frames++;
      const tw = hw.effects.tweens.length, x = T.invariants();
      for (const k in inv) inv[k] += x[k];
      if (tw) { tweenFrames++; bakedMid = Math.max(bakedMid, x.bakedEntries); }
      if (tw && !mid && x.bakedEntries >= 40) {
        // a frame in the middle of the cascade: half baked, half live (popping in / waiting / just landed)
        probing = true;
        mid = { tweens: tw, bakedEntries: x.bakedEntries, pending: b.pending.size, all: T.cmpLive() };
        hw.state.set({ level: 0, seeAll: false });
        mid.floor1 = T.cmpLive();
        hw.state.set({ level: 0, seeAll: true });
        mid.pick = T.pickDiff();
        probing = false;
      }
      if (!tw && frames > 10) break;
    }
    R.render = render;
    const settleMs = await T.settle();
    const s = b.stats(), end = T.invariants();
    let scaled = 0; for (const e of hw.world.entries.values()) if (e.obj.scale.x !== 1) scaled++;
    return { frames, tweenFrames, inv, bakedMid, mid, maxCalls: Math.max(0, ...calls), settleMs, stats: s, end, scaled, cmp: T.cmpOnOff() };
  });
  check('stamp: settled pieces are baked while the cascade still animates', r1.bakedMid >= 40 && !!r1.mid, { bakedMid: r1.bakedMid, tweenFrames: r1.tweenFrames, mid: r1.mid && { tweens: r1.mid.tweens, baked: r1.mid.bakedEntries, pending: r1.mid.pending } });
  check('stamp: every cascade frame — nothing drawn twice or lost, no animating piece baked, no baked piece without its shadow', Object.values(r1.inv).every((n) => n === 0) && r1.frames > 5, { frames: r1.frames, ...r1.inv });
  check('stamp: mid-cascade frame matches unbatched (all floors + Floor 1 cutaway)', !!r1.mid && PIX_OK(r1.mid.all) && PIX_OK(r1.mid.floor1), r1.mid && { all: r1.mid.all, floor1: r1.mid.floor1 });
  check('stamp: mid-cascade picking matches unbatched', !!r1.mid && r1.mid.pick.diff === 0 && r1.mid.pick.hits > 10, r1.mid && r1.mid.pick);
  check('stamp: draw calls during the cascade stay ≤ 60% of the unbatched farmhouse', r1.maxCalls > 0 && r1.maxCalls <= 0.6 * r1.cmp.callsOff, { maxCallsDuringCascade: r1.maxCalls, unbatched: r1.cmp.callsOff });
  check('stamp: everything bakes after the cascade (nothing left live or pending)', r1.settleMs > 0 && r1.stats.liveEntries === 0 && r1.stats.dirty === 0 && r1.stats.pending === 0 && Object.values(r1.end).slice(0, 4).every((n) => n === 0), { settleMs: Math.round(r1.settleMs), live: r1.stats.liveEntries, pending: r1.stats.pending, units: r1.stats.units, end: r1.end });
  check('stamp: no piece left scaled', r1.scaled === 0, r1.scaled);
  check('stamp: batched frame matches unbatched', PIX_OK(r1.cmp), r1.cmp);
  check('stamp: draw calls cut ≥5×', r1.cmp.callsOff / r1.cmp.callsOn >= 5, r1.cmp);

  // ---- erase a wall at its screen position
  const r2 = await page.evaluate(async () => {
    const hw = __hw, b = hw.world.batcher, T = __t;
    hw.state.set({ level: 0, seeAll: true });
    await T.settle();
    const w = T.findWall(0, ['wall', 'wall_half', 'wall_window', 'wall_window_shutters']);
    if (!w) return { err: 'no wall on screen' };
    const e = hw.world.entry(w.key);
    const before = T.bakedState(e);
    const units = b.unitsOf(e).map((u) => u.key);
    const pixBefore = T.region(w.x, w.y);
    const geomsBefore = hw.renderer.info.memory.geometries;
    hw.state.set({ tool: 'erase' });
    const ok = hw.builder.eraseAt(w.x, w.y);
    const gone = hw.world.get(w.key) === undefined;
    const objLive = e.obj.traverse ? (() => { let m = 0; e.obj.traverse((o) => { if (o.isMesh && o.layers.mask !== 1) m++; }); return m === 0; })() : false;
    const punchedNow = !b.isBaked(e);
    const dirtyNow = units.map((k) => b.units.get(k)).filter((u) => u && u.dirty).length;
    const pixAfter = T.region(w.x, w.y);
    const settleMs = await T.settle();
    const rebaked = units.map((k) => b.units.get(k)).filter(Boolean).every((u) => !u.dirty && u.mesh);
    const pick = hw.builder.pickPiece(w.x, w.y);
    hw.state.set({ tool: 'build' });
    return { w, before, ok, gone, objLive, punchedNow, dirtyNow, units: units.length, pixChanged: pixBefore !== pixAfter, settleMs, rebaked, pickedOther: !pick || pick.entry.key !== w.key, live: b.stats().liveEntries, cmp: T.cmpOnOff(), geomsBefore, geomsAfter: hw.renderer.info.memory.geometries };
  });
  if (r2.err) check('erase: found a wall', false, r2.err);
  else {
    check('erase: wall was baked before', r2.before.baked, r2.before);
    check('erase: eraseAt at projected screen point removed it', r2.ok && r2.gone, { ok: r2.ok, gone: r2.gone });
    check('erase: removed object punched out + back on layer 0 at once', r2.punchedNow && r2.objLive && r2.dirtyNow > 0, r2);
    check('erase: wall disappears from the very next frame', r2.pixChanged);
    check('erase: touched units rebaked after quiet period', r2.settleMs > 0 && r2.rebaked && r2.live === 0, { settleMs: Math.round(r2.settleMs), rebaked: r2.rebaked, live: r2.live });
    check('erase: pick no longer finds it', r2.pickedOther);
    check('erase: batched frame matches unbatched', PIX_OK(r2.cmp), r2.cmp);
    check('erase: GPU geometries do not leak', r2.geomsAfter <= r2.geomsBefore + 2, { before: r2.geomsBefore, after: r2.geomsAfter });
  }

  // ---- paint a wall
  const r3 = await page.evaluate(async () => {
    const hw = __hw, b = hw.world.batcher, T = __t;
    const w = T.findWall(0, ['wall', 'wall_window', 'wall_window_shutters', 'wall_half']);
    if (!w) return { err: 'no wall' };
    const e = hw.world.entry(w.key);
    const old = { ...e.p };
    hw.state.set({ tool: 'paint', paintColor: '#b4473a', paintTarget: 'main', paintMat: null });
    const ok = hw.builder.paintAt(w.x, w.y);
    const ne = hw.world.entry(w.key);
    const immediate = { newObj: ne !== e, newLive: !b.isBaked(ne), oldPunched: !b.isBaked(e), tweening: hw.effects.isAnimating(ne.obj) };
    await T.sleep(120);
    const midBaked = b.isBaked(ne);
    const settleMs = await T.settle();
    hw.state.set({ tool: 'build' });
    return { w, ok, old: old.c, now: ne.p.c, immediate, midBaked, settleMs, bakedAfter: b.isBaked(hw.world.entry(w.key)), cmp: T.cmpOnOff() };
  });
  if (r3.err) check('paint: found a wall', false, r3.err);
  else {
    check('paint: colour applied', r3.ok && r3.now === '#b4473a', { ok: r3.ok, old: r3.old, now: r3.now });
    check('paint: repainted piece renders live (pop-in tween) right away', r3.immediate.newObj && r3.immediate.newLive && r3.immediate.oldPunched && r3.immediate.tweening && !r3.midBaked, r3.immediate);
    check('paint: rebaked after tween + quiet', r3.settleMs > 0 && r3.bakedAfter, { settleMs: Math.round(r3.settleMs) });
    check('paint: batched frame matches unbatched', PIX_OK(r3.cmp), r3.cmp);
  }

  // ---- undo / redo
  const r4 = await page.evaluate(async () => {
    const hw = __hw, b = hw.world.batcher, T = __t;
    const out = [];
    for (const op of ['undo', 'undo', 'redo', 'redo', 'undo']) {
      const n0 = hw.world.count;
      hw.builder[op]();
      const live = b.stats().liveEntries;
      const settleMs = await T.settle();
      const s = b.stats();
      out.push({ op, count: hw.world.count, dCount: hw.world.count - n0, liveRightAfter: live, settleMs: Math.round(settleMs), liveAfter: s.liveEntries, cmp: T.cmpOnOff() });
    }
    return out;
  });
  const okU = r4.every((x) => x.settleMs > 0 && x.liveAfter === 0 && PIX_OK(x.cmp));
  check('undo/redo: each step rebakes and matches unbatched', okU, r4.map((x) => [x.op, x.dCount, x.liveRightAfter, x.liveAfter, x.cmp.pct]));
  check('undo/redo: undo paint / undo erase (+1) / redo erase (-1) / redo paint', JSON.stringify(r4.map((x) => x.dCount)) === '[0,1,-1,0,0]', r4.map((x) => x.dCount));

  // ---- levels / cutaway
  const r5 = await page.evaluate(async () => {
    const hw = __hw, b = hw.world.batcher, T = __t;
    const res = [];
    for (const [level, seeAll] of [[0, false], [1, false], [2, false], [0, true], [1, true]]) {
      hw.state.set({ level, seeAll });
      // every render unit's draw range must equal the vertices of the levels on view
      let okRange = true;
      for (const u of b.units.values()) {
        if (!u.mesh) continue;
        const bt = u.mesh.userData.batch, want = seeAll ? bt.total : bt.levelEnd[level];
        if (u.mesh.geometry.drawRange.count !== want || u.mesh.visible !== want > 0) okRange = false;
      }
      res.push({ level, seeAll, okRange, cmp: T.cmpOnOff() });
    }
    hw.state.set({ level: 0, seeAll: true });
    return res;
  });
  check('levels: batch draw ranges follow level / seeAll', r5.every((x) => x.okRange), r5.map((x) => [x.level, x.seeAll, x.okRange]));
  check('levels: cutaway frames match unbatched', r5.every((x) => PIX_OK(x.cmp)), r5.map((x) => [x.level, x.seeAll, x.cmp.pct, x.cmp.pct32]));

  // ---- pick & resolve equivalence on a screen grid (baked vs unbatched)
  const r6 = await page.evaluate(async () => {
    const hw = __hw, b = hw.world.batcher, T = __t;
    await T.settle();
    const el = hw.renderer.domElement, W = el.clientWidth, H = el.clientHeight;
    const pts = []; for (let i = 1; i < 24; i++) for (let j = 1; j < 15; j++) pts.push([W * i / 24, H * j / 15]);
    const run = () => pts.map(([x, y]) => { const p = hw.builder.pickPiece(x, y); return p ? p.entry.key : null; });
    const res = () => { hw.state.set({ pieceId: 'wall', tool: 'build' }); return pts.map(([x, y]) => { const r = hw.builder.resolve(x, y); return r ? r.key + (r.valid ? '' : '!') : null; }); };
    const bakedAll = b.stats().liveEntries === 0;
    const a = run(), ra = res();
    b.setEnabled(false);
    const o = run(), ro = res();
    b.setEnabled(true); b.bakeNow();
    let same = 0, hits = 0, rsame = 0;
    for (let i = 0; i < a.length; i++) { if (a[i] === o[i]) same++; if (a[i]) hits++; if (ra[i] === ro[i]) rsame++; }
    // level 1 picking: only pieces of visible levels
    hw.state.set({ level: 1, seeAll: false });
    const a1 = run(); b.setEnabled(false); const o1 = run(); b.setEnabled(true); b.bakeNow();
    let same1 = 0; for (let i = 0; i < a1.length; i++) if (a1[i] === o1[i]) same1++;
    hw.state.set({ level: 0, seeAll: true });
    return { n: a.length, bakedAll, hits, same, rsame, same1, layerMask: hw.builder.constructor.name && null };
  });
  check('pick: finds pieces on baked units (same result as unbatched on every grid point)', r6.bakedAll && r6.hits > 50 && r6.same === r6.n, r6);
  check('pick: cutaway (level 1) picks match unbatched', r6.same1 === r6.n, r6);
  check('builder.resolve (wall tool, edge preference on walls) unchanged', r6.rsame === r6.n, r6);

  // ---- popOut of a removed (detached) piece renders, tween retarget on contextual remount
  const r7 = await page.evaluate(async () => {
    const hw = __hw, b = hw.world.batcher, T = __t;
    await T.settle();
    // a baked piece removed directly, then popped out
    let e = null; for (const x of hw.world.entries.values()) if (b.isBaked(x) && x.def.layer === 'I') { e = x; break; }
    if (!e) return { err: 'no baked item' };
    const obj = e.obj;
    hw.world.remove(e.key);
    let masks = new Set(); obj.traverse((o) => { if (o.isMesh) masks.add(o.layers.mask); });
    let doneCalled = false;
    hw.effects.popOut(obj, () => { doneCalled = true; });
    const inScene = obj.parent === hw.scene;
    // the 0.18 s tween needs a few frames (dt is capped per frame): wait for it, not for a fixed time, so a
    // slow / busy machine doesn't fail the check (400 ms stays the minimum)
    await T.sleep(400);
    for (let i = 0; i < 100 && hw.effects.isAnimating(obj); i++) await T.sleep(50);
    await T.sleep(50);
    const removedAfter = obj.parent === null;
    // fast placement of neighbouring walls: the first wall is rebuilt while its pop-in still runs
    hw.world.beginBatch();
    const base = { t: 'wall', y: 0, a: 'x', m: 'clapboard' };
    const e1 = hw.builder.place({ ...base, x: -9, z: 8 });
    const e2 = hw.builder.place({ ...base, x: -8, z: 8 });
    const e3 = hw.builder.place({ t: 'wall', y: 0, a: 'z', x: -7, z: 8, m: 'clapboard' });
    hw.world.endBatch();
    await T.settle();
    const scales = [e1, e2, e3].map((x) => x && hw.world.entry(x.key)?.obj.scale.x);
    let stuck = 0; for (const x of hw.world.entries.values()) if (x.obj.scale.x !== 1) stuck++;
    hw.builder.undo(); await T.settle();
    return { masks: [...masks], inScene, removedAfter, doneCalled, scales, stuck, live: b.stats().liveEntries };
  });
  if (r7.err) check('popOut: found item', false, r7.err);
  else {
    check('popOut: removed baked piece is back on layer 0 and shown during its pop-out', r7.masks.length === 1 && r7.masks[0] === 1 && r7.inScene && r7.removedAfter && r7.doneCalled, r7);
    check('pop-in: walls rebuilt mid-tween end at full scale (no stuck scale)', r7.scales.every((s) => s === 1) && r7.stuck === 0, r7);
  }

  // ---- save / load / clear / snapshot / thumbnail / emitters
  const r8 = await page.evaluate(async () => {
    const hw = __hw, b = hw.world.batcher, T = __t;
    await T.settle();
    const data = hw.world.serialize();
    const snapA = hw.snapshot(320).length;
    hw.world.clear({ record: true });
    const afterClear = { units: b.units.size, meshes: b.root.children.length, entries: hw.world.count };
    hw.loadBuild(data);
    await T.sleep(50);
    const settleMs = await T.settle();
    const s = b.stats();
    const cmp = T.cmpOnOff();
    const snapB = hw.snapshot(320).length;
    const thumb = await hw.thumbnail('wall_window');
    const emitters = hw.env?.env?.emitters?.length ?? -1;
    return { afterClear, settleMs, live: s.liveEntries, units: s.units, cmp, snapA, snapB, thumb: typeof thumb === 'string' && thumb.startsWith('data:image'), emitters, smoke: hw.env?.env?.smoke?.visible };
  });
  check('clear: all batches released', r8.afterClear.units === 0 && r8.afterClear.meshes === 0 && r8.afterClear.entries === 0, r8.afterClear);
  check('load: bakes right after loading', r8.settleMs > 0 && r8.live === 0, { settleMs: Math.round(r8.settleMs), live: r8.live });
  check('load: batched frame matches unbatched', PIX_OK(r8.cmp), r8.cmp);
  check('snapshot + thumbnail still work', r8.snapA > 1000 && r8.snapB > 1000 && r8.thumb, r8);
  check('chimney smoke emitter still found', r8.emitters > 0, { emitters: r8.emitters, smoke: r8.smoke });
  check('no console errors (stamp/edit session)', problems.length === 0, problems.slice(0, 5));
  await ctx.close();
}

// ---------------------------------------------------------------- 2. guided blueprint ghosts + ghost preview
{
  const { ctx, page, problems } = await game('clean=1&ui=0&nosave=1');
  const r = await page.evaluate(async () => {
    const hw = __hw, b = hw.world.batcher, T = __t;
    hw.blueprints.stamp('starter', { animate: false, record: true });
    await T.settle();
    hw.blueprints.startGuided('cottage');
    await T.sleep(300);
    let ghosts = 0; hw.scene.traverse((o) => { if (o.isMesh && o.material?.name?.startsWith('blueprint|') && o.visible) ghosts++; });
    hw.state.set({ pieceId: 'wall', tool: 'build' });
    const el = hw.renderer.domElement;
    hw.builder.hover(el.clientWidth / 2, el.clientHeight / 2);
    const ghost = hw.builder.ghost;
    let gm = new Set(); ghost?.traverse((o) => { if (o.isMesh) gm.add(o.layers.mask); });
    const stats = b.stats();
    hw.blueprints.stop();
    return { ghosts, ghostVisible: !!ghost?.visible, ghostMasks: [...gm], live: stats.liveEntries, units: stats.units };
  });
  check('guided blueprint ghosts render alongside baked world', r.ghosts > 0 && r.live === 0, r);
  check('placement ghost is a normal layer-0 object', r.ghostVisible && r.ghostMasks.length === 1 && r.ghostMasks[0] === 1, r);
  check('no console errors (guided)', problems.length === 0, problems.slice(0, 5));
  await ctx.close();
}

// ---------------------------------------------------------------- 3. full UI + welcome lot + showcase
for (const q of ['bp=farmhouse&nosave=1', 'nosave=1&welcome=1', 'showcase=all&ui=0&nosave=1']) {
  const { ctx, page, problems } = await game(q);
  const r = await page.evaluate(async () => { const T = __t; await T.sleep(800); const ms = await T.settle(20000); return { ms, s: __hw.world.batcher.stats(), cmp: T.cmpOnOff(), pieces: __hw.world.count }; });
  check(`${q}: bakes and matches unbatched`, r.ms > 0 && r.s.liveEntries === 0 && PIX_OK(r.cmp), { pieces: r.pieces, calls: [r.cmp.callsOn, r.cmp.callsOff], pct: r.cmp.pct, live: r.s.liveEntries });
  check(`${q}: no console errors`, problems.length === 0, problems.slice(0, 5));
  await ctx.close();
}

// ---------------------------------------------------------------- 4. touch (iPhone emulation): tap to place, tap to erase
{
  const { ctx, page, problems } = await game('clean=1&ui=0&nosave=1', { mobile: true });
  await page.evaluate(async () => { __hw.blueprints.stamp('starter', { animate: false, record: false }); await __t.settle(); __hw.state.set({ pieceId: 'foundation', tool: 'build', level: 0 }); });
  const target = await page.evaluate(() => { const hw = __hw, T = __t; return T.toScreen(new hw.THREE.Vector3(-13, 0.2, -13)); });
  const n0 = await page.evaluate(() => __hw.world.count);
  await page.touchscreen.tap(target.x, target.y);
  await page.waitForTimeout(200);
  const n1 = await page.evaluate(() => __hw.world.count);
  await page.evaluate(async () => { await __t.settle(); });
  const w = await page.evaluate(() => { __hw.state.set({ tool: 'erase' }); return __t.findWall(0, ['wall', 'wall_window', 'wall_door', 'wall_window_shutters']); });
  let n2 = n1;
  if (w) { await page.touchscreen.tap(w.x, w.y); await page.waitForTimeout(200); n2 = await page.evaluate(() => __hw.world.count); }
  const r = await page.evaluate(async () => { const ms = await __t.settle(); return { ms, s: __hw.world.batcher.stats(), pr: __hw.renderer.getPixelRatio() }; });
  check('touch: tap places a piece and it bakes', n1 === n0 + 1 && r.s.liveEntries === 0, { n0, n1, live: r.s.liveEntries });
  check('touch: tap with erase tool removes a baked wall', !!w && n2 === n1 - 1, { w: !!w, n1, n2 });
  check('no console errors (touch)', problems.length === 0, problems.slice(0, 5));
  await ctx.close();
}

await browser.close(); server.close();
console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
