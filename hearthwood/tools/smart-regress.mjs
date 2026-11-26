#!/usr/bin/env node
// Hearthwood smart-building regression (docs/SMART_BUILD.md §9). Run: node tools/smart-regress.mjs [--only=A,C]
// (~8 min headless; exits 1 on any failed check). HW_ROOT points it at another checkout (tools/harness.mjs).
//   A  the rules (js/facing.js autoFacing) in the 266 scenes of Appendix A and B and repair rounds 1 and 2 (smart-scenes.js)
//   B  blueprint agreement: the five stock blueprints in four build orders against §8.3's thresholds and §10.3's list
//   C  real taps place the auto facing (iPhone 13): a bed in a corner, doors, chairs round a table, a roof slope and
//      the panel above it, porch steps, a fence stroke, the press preview, a tree in the meadow (the fallback)
//   D  tap again turns (iPhone 13): one undo step, flips, undo / redo, restyle, replace, the double-tap guard, the
//      slot decided as before (furniture against a wall vs in the open, trees, wall tops from Floor 2, gaps, roofs)
//   E  the Turn button and R: the piece just placed, the hint, the preview pin, the piece under the cursor, hidden for
//      railings and gables, Turn during an aim, a roof's second row
//   F  draw strokes: one facing per fence line, restyling keeps facings, no turns, R mid-stroke
//   G  guides, saves, share codes, Show me (its preview has the wish's facing; an aim whose lifted point is on the
//      ring and whose finger is not builds it there)
//   H  the lifted aim (§6): press and hold previews and places `lift` px above the finger (iPhone 13 portrait and
//      844 × 390 landscape 62 px, a 320 × 568 phone 52 px), the ease and ring, the top bar clamp, quick taps under
//      the finger, the tray and a pinch cancel, mouse / pen / Draw unchanged, the setting (and photo mode), Erase
//   I  the village: a sleeper's bed, a sitter's chair and a range turned by real taps
//   J  cost: autoFacing per call and resolve() with vs without it
//   R  repair round 1 (real touches): a tall piece on a window wall (S1.1), the lifted aim with the finger on the tray
//      (S1.2, three phones), a tap on top of a sofa in the open, tap again on stairs and a roof slope, a finished blueprint
//      piece in guided mode, porch steps in the open meadow; repair round 2: the window spot with a table or counter in
//      front (S2.4), tap again after the room changed round a bed, an armchair and a chair (S2.2)
//   K  no console errors
// Real touches go through CDP Input.dispatchTouchEvent; desktop clicks and keys through Playwright's mouse / keyboard.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { ROOT, startServer, launch, openGame, injectHelpers } from './harness.mjs';
const { devices } = createRequire(import.meta.url)('playwright');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
const want = (name) => !ONLY.length || ONLY.includes(name);
const SCENES = fs.readFileSync(path.join(HERE, 'smart-scenes.js'), 'utf8');
const Q = 'clean=1&nosave=1&town=0&thumbs=0';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
console.log(`smart-regress: ${ROOT}`);

const { server, base } = await startServer();
const browser = await launch();
let fails = 0, passes = 0;
const allProblems = [];
const check = (id, name, ok, info) => {
  if (ok) passes++; else fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${name}${info !== undefined ? '  ' + JSON.stringify(info) : ''}`);
};
async function section(name, fn) {
  if (!want(name)) return;
  console.log(`\n== ${name}`);
  try { await fn(); } catch (e) { check(name, `section ran without throwing`, false, String(e?.stack || e).split('\n').slice(0, 3).join(' | ')); }
}

// page helpers (window.__s): scenes, screen points (CSS px of the page), the builder's answer at a point, a log
const PAGE = String.raw`window.__s = (() => {
  const hw = __hw, W = hw.world, THREE = hw.THREE, B = hw.builder;
  const LY = (y) => 0.25 + 2.5 * y;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const box = (t, x0, x1, z0, z1, y = 0, o = {}) => { const out = []; for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) out.push({ t, x, y, z, ...o }); return out; };
  /** walls round a footprint, facing out; swap: { 'x|x|z' | 'z|x|z': piece } (a window, a door, null = a gap) */
  const ring = (x0, x1, z0, z1, y = 0, t = 'wall', swap = {}) => {
    const out = [], put = (k, q) => { const s = k in swap ? swap[k] : t; if (s) out.push({ ...q, t: s }); };
    for (let x = x0; x <= x1; x++) { put('x|' + x + '|' + (z1 + 1), { a: 'x', x, y, z: z1 + 1, r: 0 }); put('x|' + x + '|' + z0, { a: 'x', x, y, z: z0, r: 2 }); }
    for (let z = z0; z <= z1; z++) { put('z|' + (x1 + 1) + '|' + z, { a: 'z', x: x1 + 1, y, z, r: 0 }); put('z|' + x0 + '|' + z, { a: 'z', x: x0, y, z, r: 2 }); }
    return out;
  };
  const house = (x0, x1, z0, z1, swap = {}) => [...box('foundation', x0, x1, z0, z1), ...ring(x0, x1, z0, z1, 0, 'wall', swap)];
  const load = (list, patch = {}) => { W.load({ pieces: list }); hw.state.set({ level: 0, seeAll: true, hOffset: 0, tool: 'build', drawMode: false, ...patch }); B.lastPlaced = null; };
  const view = async (t, th, ph, r, ms = 300) => { hw.rig.setView({ t, th, ph, r }, true); await sleep(ms); };
  /** screen point of a world point: page px (x, y), canvas px (cx, cy); ok: on the canvas, not under the UI */
  const pt = (x, y, z) => {
    const v = new THREE.Vector3(x, y, z).project(hw.camera), el = hw.renderer.domElement, rc = el.getBoundingClientRect();
    const cx = (v.x + 1) / 2 * el.clientWidth, cy = (1 - v.y) / 2 * el.clientHeight;
    const hit = document.elementFromPoint(rc.left + cx, rc.top + cy);
    return { x: rc.left + cx, y: rc.top + cy, cx, cy, ok: hit === el && v.z < 1 && Math.abs(v.x) < 0.97 && Math.abs(v.y) < 0.97 };
  };
  const cell = (x, z, y = 0, dy = 0, ox = 0, oz = 0) => pt((x + 0.5 + ox) * 2, LY(y) + dy, (z + 0.5 + oz) * 2);
  const edge = (a, x, z, y = 0, h = 1.2, f = 0.5) => (a === 'x' ? pt((x + f) * 2, LY(y) + h, z * 2) : pt(x * 2, LY(y) + h, (z + f) * 2));
  const I = (x, y, z) => 'I|' + x + '|' + y + '|' + z;
  const Wk = (a, x, y, z) => 'W|' + a + '|' + x + '|' + y + '|' + z;
  const get = (k) => { const q = W.get(k); return q ? { ...q } : null; };
  const log = { sfx: [], toast: [] };
  hw.events.on('sfx', (d) => log.sfx.push(d && d.name));
  hw.events.on('toast', (d) => log.toast.push(d && d.text));
  /** what the builder would do at a screen point (the preview) */
  const at = (p) => { const t = B.resolve(p.cx, p.cy); return t ? { key: t.key, r: t.p.r, h: t.p.h, x: t.p.x, y: t.p.y, z: t.p.z, action: t.action || null, source: (t.facing && t.facing.source) || null, fallback: !!(t.facing && t.facing.fallback), valid: t.valid } : null; };
  const target = () => { const t = B.target; return t && B.ghostVisible ? { key: t.key, r: t.p.r, h: t.p.h, action: t.action || null, source: (t.facing && t.facing.source) || null } : null; };
  const undos = () => W.undoStack.length;
  return { hw, W, B, THREE, LY, sleep, box, ring, house, load, view, pt, cell, edge, I, Wk, get, log, at, target, undos };
})();`;

async function game(q, opts = {}) {
  const g = await openGame(browser, base, q, opts);
  await injectHelpers(g.page);
  await g.page.addScriptTag({ content: PAGE });
  allProblems.push(g.problems);
  return g;
}
/** Real touches: tap(p) = start, 60 ms, end; hold(p, ms, moves) = start, wait, moves 30 ms apart, end. */
async function touchOf(ctx, page) {
  const cdp = await ctx.newCDPSession(page);
  const send = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: p.id ?? i, radiusX: 4, radiusY: 4, force: 1 })) });
  const tap = async (p, after = 120) => { await send('touchStart', [p]); await wait(60); await send('touchEnd', []); await wait(after); };
  const hold = async (p, ms, moves = [], { end = true } = {}) => {
    await send('touchStart', [p]); await wait(ms);
    for (const m of moves) { await send('touchMove', [m]); await wait(30); }
    if (end) { await send('touchEnd', []); await wait(120); }
  };
  return { send, tap, hold };
}
const ev = (page, fn, arg) => page.evaluate(fn, arg);

// ------------------------------------------------------------------------------- the lifted aim's helpers (G5L, H)
const liftFor = (w, h) => Math.min(72, Math.max(52, Math.round(Math.min(w, h) * 0.16)));
// page helpers (window.__h): an empty meadow seen from above, the slot under a point, the aim and its ring, a sampler
const HPAGE = String.raw`window.__h = (() => {
  const hw = __hw, s = __s, B = hw.builder, rig = hw.rig, el = hw.renderer.domElement;
  const res = (x, y) => { const t = B.resolve(x, y); return t ? t.key : null; };   // the canvas sits at the page's 0, 0
  const onCanvas = (x, y) => document.elementFromPoint(x, y) === el;
  const ring = () => {
    const root = document.querySelector('.hw-aim'), r = document.querySelector('.hw-aim-ring');
    if (!root || !r || root.style.display === 'none' || getComputedStyle(root).display === 'none') return null;
    const b = r.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2, op: +root.style.opacity };
  };
  const aim = () => (rig.aim ? { ...rig.aim } : null);
  const scene = async (piece = 'foundation', patch = {}) => { s.load([], { pieceId: piece, ...patch }); await s.view([0, 0, 0], 0.6, 0.6, 20); };
  /** a finger point in the middle of the free band (under the top bar, over the tray, left of the rail), its lifted
   *  point on the canvas too */
  const spot = (lift, dx = 0) => {
    const I = rig.insets, w = el.clientWidth, h = el.clientHeight;
    const x = Math.round((w - I.right) / 2 + dx), y = Math.round((I.top + h - I.bottom) / 2 + lift / 2);
    return { x, y, ok: onCanvas(x, y) && onCanvas(x, y - lift) };
  };
  /** a finger point 20 px under the top bar, in the left half, on the canvas */
  const topSpot = () => {
    const I = rig.insets, w = el.clientWidth, y = Math.round(I.top + 20);
    for (let f = 0.3; f < 0.48; f += 0.02) { const x = Math.round(w * f); if (onCanvas(x, y)) return { x, y, ok: true, top: I.top }; }
    return { x: Math.round(w * 0.3), y, ok: false, top: I.top };
  };
  let samp = null;
  /** every frame from now: the aim point, its ease, the ring and the rig's mode (stop() returns them) */
  const sample = () => {
    const mine = samp = [];
    const loop = () => { if (samp !== mine) return; const a = rig.aim; mine.push({ t: performance.now(), a: a ? { x: a.x, y: a.y, k: a.k } : null, mode: rig.mode, ring: ring(), ghost: !!B.ghostVisible }); if (mine.length < 600) requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  };
  const stop = () => { const out = samp || []; samp = null; return out; };
  /** wait until the aim's ease is done (slow SwiftShader frames) */
  const eased = async (ms = 4000) => { const t0 = performance.now(); while (performance.now() - t0 < ms) { if (rig.aim && rig.aim.k >= 1) return true; await s.sleep(20); } return false; };
  const keys = () => [...hw.world.entries.keys()];
  const target = () => (B.target && B.ghostVisible ? B.target.key : null);
  const mid = () => ({ aim: aim(), ring: ring(), target: target(), mode: rig.mode });
  return { res, onCanvas, ring, aim, scene, spot, topSpot, sample, stop, eased, keys, target, mid };
})();`;

/** A phone page at any size (the iPhone 13 device, viewport w × h) with the page helpers. */
async function phone(q, w, h, extra = {}) {
  const ctx = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: w, height: h }, screen: { width: Math.min(w, h), height: Math.max(w, h) }, deviceScaleFactor: 1, ...extra });
  const page = await ctx.newPage();
  const problems = [];
  page.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !/GPU stall|ReadPixels/.test(m.text())) problems.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`));
  await page.goto(`${base}?${q}`);
  await ready(page);
  allProblems.push(problems);
  return { ctx, page, problems };
}
async function ready(page) {
  await page.waitForFunction(() => window.__hwReady === true, null, { timeout: 60000 });
  await injectHelpers(page);
  await page.addScriptTag({ content: PAGE });
  await page.addScriptTag({ content: HPAGE });
}
/** Hold a finger at p until the aim's ease is done (or `ms`), read `fn` in the page, then lift (or not). */
async function holdAt(T, page, p, fn, { end = true, ms = 700, after = 450 } = {}) {
  await T.send('touchStart', [p]);
  await wait(ms);
  await ev(page, () => __h.eased());
  const mid = fn ? await ev(page, fn) : null;
  if (end) { await T.send('touchEnd', []); await wait(after); }
  return mid;
}
const MID = () => __h.mid();


// ================================================================================================ A, B: the rules
await section('A', async () => {
  const { ctx, page } = await game(Q);
  let res = null, err = null;
  try { res = await page.evaluate(`(async () => { ${SCENES} })()`); } catch (e) { err = String(e.message || e).split('\n')[0]; }
  check('A', 'the scene script runs against js/facing.js', !!res && !err, err || undefined);
  if (res) {
    const sets = {};
    for (const s of res.scenes) {
      (sets[s.set] ||= { n: 0, ok: 0 }).n++;
      if (s.ok) sets[s.set].ok++;
      check(`A ${s.set}`, s.name, !!s.ok, s.ok ? undefined : { got: s.got, want: s.want, S: s.S, why: s.why });
    }
    check('A', 'all 266 scenes (Appendix A 46, Appendix B 174: N 95, C1 39, C2 12, C3 28; repair round 1: R1 12; repair round 2: R2 34)', res.scenes.length === 266 && res.scenes.every((s) => s.ok)
      && sets.A?.n === 46 && sets.N?.n === 95 && sets.C1?.n === 39 && sets.C2?.n === 12 && sets.C3?.n === 28 && sets.R1?.n === 12 && sets.R2?.n === 34, sets);
    globalThis.__metric = res.metric;
  }
  await ctx.close();
});

await section('B', async () => {
  let m = globalThis.__metric;
  if (!m) {
    const { ctx, page } = await game(Q);
    try { m = (await page.evaluate(`(async () => { ${SCENES} })()`)).metric; } catch (e) { m = null; }
    await ctx.close();
  }
  check('B', 'the blueprint metric ran', !!m);
  if (!m) return;
  const DELIB = ['Walls, windows, doors', 'Roof slopes', 'Porch deck boards', 'Porch steps', 'Stairs & ladder', 'Back-to-wall furniture', 'Tables',
    'Dining chairs', 'Armchair / sofa / rocker', 'Rugs', 'Garden bench', 'Garden things with a front'];
  const sum = (tab, cats) => cats.reduce((a, c) => ({ n: a.n + (tab[c]?.n || 0), ok: a.ok + (tab[c]?.ok || 0) }), { n: 0, ok: 0 });
  const pct = (e) => (e.n ? (100 * e.ok) / e.n : 0);
  const row = (c) => [c, m.M.loo[c]?.n || 0, ...['loo', 'ord', 'cold', 'shuf'].map((o) => `${m.M[o][c]?.ok ?? 0}/${m.M[o][c]?.n ?? 0} (${pct(m.M[o][c] || { n: 0 }).toFixed(1)}%)`)];
  console.log('  category | n | leave-one-out | build order | stage-cold | shuffled (20×, all runs)');
  for (const c of [...DELIB, ...Object.keys(m.M.loo).filter((c) => !DELIB.includes(c)).sort()]) console.log('  ' + row(c).join(' | '));
  const all = { loo: sum(m.M.loo, DELIB), ord: sum(m.M.ord, DELIB), cold: sum(m.M.cold, DELIB), shuf: sum(m.M.shuf, DELIB) };
  console.log('  deliberate, player-placeable: ' + JSON.stringify(Object.fromEntries(Object.entries(all).map(([k, e]) => [k, `${e.ok}/${e.n} ${pct(e).toFixed(1)}%`]))));
  check('B', '241 deliberate, player-placeable facings: leave-one-out ≥ 97%', all.loo.n === 241 && pct(all.loo) >= 97, all.loo);
  check('B', 'build order ≥ 97%', all.ord.n === 241 && pct(all.ord) >= 97, all.ord);
  check('B', 'stage-cold ≥ 90%', pct(all.cold) >= 90, all.cold);
  check('B', 'shuffled within stages (20 seeded runs) ≥ 92%', pct(all.shuf) >= 92, { ok: all.shuf.ok, n: all.shuf.n, pct: +pct(all.shuf).toFixed(1) });
  const full = ['Walls, windows, doors', 'Porch steps', 'Porch deck boards', 'Tables'];
  check('B', 'walls / windows / doors, porch steps, decks and tables: 100% in all four orders',
    full.every((c) => ['loo', 'ord', 'cold', 'shuf'].every((o) => m.M[o][c] && m.M[o][c].ok === m.M[o][c].n)), full.map((c) => row(c).join(' ')));
  const rs = 'Roof slopes';
  check('B', 'roof slopes 100% leave-one-out and build order, ≥ 90% stage-cold and shuffled',
    m.M.loo[rs]?.ok === m.M.loo[rs]?.n && m.M.ord[rs]?.ok === m.M.ord[rs]?.n && pct(m.M.cold[rs]) >= 90 && pct(m.M.shuf[rs]) >= 90, row(rs));
  // §10.3: every disagreement in the three fixed orders, with the orders it shows in (L leave-one-out, O build order, C stage-cold)
  const KNOWN = {
    'starter wheelbarrow (1,0,1)': 'LOC', 'aframe chimney (1,0,0)': 'C', 'aframe chair (-1,0,-2)': 'C', 'aframe cat (0,0,1)': 'LOC',
    'aframe rug (-1,1,-3)': 'LOC', 'logcabin roof_slope (-2,1,1)': 'C', 'logcabin roof_slope (1,1,1)': 'C', 'logcabin roof_slope (-1,1,1)': 'C',
    'logcabin roof_slope (0,1,1)': 'C', 'logcabin chair (-2,0,0)': 'C', 'logcabin chair (-1,0,-1)': 'C', 'logcabin rug (0,0,-2)': 'C',
    'cottage chair (0,0,-1)': 'C', 'cottage rug (-1,0,0)': 'C', 'cottage bench (-2,0,4)': 'C', 'cottage beehive (4,0,0)': 'LOC',
    'farmhouse armchair (1,0,0)': 'C', 'farmhouse rug (1,0,-1)': 'LC', 'farmhouse grandfather_clock (-2,0,-3)': 'OC', 'farmhouse chair (0,0,-1)': 'C',
    'farmhouse dresser (-2,1,0)': 'LO', 'farmhouse cat (1,1,-1)': 'LOC', 'farmhouse fence_picket (-4,0,2 z)': 'LOC', 'farmhouse fence_picket (-4,0,3 z)': 'LOC',
  };
  const fresh = [];
  for (const r of m.rows) {
    const k = `${r.bp} ${r.t} ${r.at}`, orders = (r.L !== 'ok' ? 'L' : '') + (r.O !== 'ok' ? 'O' : '') + (r.C !== 'ok' ? 'C' : '');
    for (const o of orders) if (!(KNOWN[k] || '').includes(o)) fresh.push(`${k} [${o}] want ${r.want}: ${r[o]}`);
  }
  check('B', 'every disagreement in the three fixed orders is one of §10.3 (with its reason)', fresh.length === 0, fresh.slice(0, 8));
  const y0 = m.M.loo['A-frame roof at y 0 (guide only)'];
  console.log(`  (reported apart) A-frame roof panels at y 0, guide only: ${y0?.ok}/${y0?.n} leave-one-out`);
});

// ================================================================================================ C: real taps
await section('C', async () => {
  const { ctx, page } = await game(Q, { mobile: true });
  const { tap, send } = await touchOf(ctx, page);
  const S = (fn, arg) => ev(page, fn, arg);
  // C1 a bed in the back-left corner (a window behind it on −Z, a plain wall on −X): headboard on the plain wall (r 1)
  await S(async () => { const s = __s; s.load([...s.house(0, 3, 0, 2, { 'x|0|0': 'wall_window' })], { pieceId: 'bed', rot: 2 }); await s.view([4, 0.3, 3], 0.6, 0.62, 17); });
  let p = await S(() => __s.cell(0, 0));
  await tap(p, 400);
  let r = await S(() => __s.get(__s.I(0, 0, 0)));
  check('C1', 'a bed tapped into a corner gets the corner rule: headboard on the plain wall, not the window (r 1; the fallback was 2)', r?.r === 1, { r, onCanvas: p.ok });
  // C2 doors: the front wall → r 0, the back wall → r 2
  await S(() => __s.hw.state.set({ pieceId: 'wall_door', rot: 2 }));
  p = await S(() => __s.edge('x', 1, 3, 0, 1.0));
  await tap(p, 400);
  await S(() => __s.hw.state.set({ rot: 0 }));
  const p2 = await S(() => __s.edge('x', 2, 0, 0, 1.6));
  await tap(p2, 400);
  r = await S(() => [__s.get(__s.Wk('x', 1, 0, 3)), __s.get(__s.Wk('x', 2, 0, 0))]);
  check('C2', 'a door tapped on the front wall faces out (r 0), one on the back wall faces out (r 2)', r[0]?.t === 'wall_door' && r[0].r === 0 && r[1]?.t === 'wall_door' && r[1].r === 2, r);
  // C3 chairs on all four sides of a table face it
  await S(async () => { const s = __s; s.load([...s.house(0, 3, 0, 3), { t: 'table', x: 1, y: 0, z: 1 }], { pieceId: 'chair', rot: 0 }); await s.view([4, 0.3, 4], 0.55, 0.55, 17); });
  const sides = [[0, 1, 1, -0.3, 0], [2, 1, 3, 0.3, 0], [1, 0, 0, 0, -0.3], [1, 2, 2, 0, 0.3]];
  const got = [];
  for (const [x, z, want, ox, oz] of sides) {
    p = await S(([x, z, ox, oz]) => __s.cell(x, z, 0, 0, ox, oz), [x, z, ox, oz]);
    await tap(p, 400);
    const q = await S(([x, z]) => __s.get(__s.I(x, 0, z)), [x, z]);
    got.push({ at: [x, z], r: q?.r, want, ok: p.ok });
  }
  check('C3', 'chairs tapped on all four sides of a table face it (chairTuck tucks them in)', got.every((g) => g.r === g.want), got);
  // C4 a roof slope tapped onto the west wall top of a 4 × 6 shell → downhill west (r 1); the next cell up → r 1, h 1
  await S(async () => { const s = __s; s.load([...s.house(0, 3, 0, 5)], { pieceId: 'roof_slope', rot: 0 }); await s.view([4, 2.5, 6], Math.PI / 2, 0.6, 18); });
  p = await S(() => __s.pt(0.5, __s.LY(1), 5));
  await tap(p, 450);
  const p4 = await S(() => __s.pt(3, __s.LY(1), 5));
  await tap(p4, 450);
  r = await S(() => [...__s.W.entries.values()].filter((e) => e.def.layer === 'R').map((e) => ({ x: e.p.x, y: e.p.y, z: e.p.z, r: e.p.r, h: e.p.h })).sort((a, b) => a.x - b.x));
  check('C4', 'a roof slope tapped on the west wall top runs downhill to that eave (r 1); the cell above it continues the slope (r 1, h 1)',
    r.length === 2 && r[0].x === 0 && r[0].z === 2 && r[0].r === 1 && r[0].h === 0 && r[1].x === 1 && r[1].z === 2 && r[1].r === 1 && r[1].h === 1, r);
  // C5 porch steps in front of the deck climb toward it (r 2)
  await S(async () => { const s = __s; s.load([...s.box('foundation', 0, 2, 0, 1), ...s.box('deck', 0, 2, 2, 2), { t: 'path', x: 1, y: 0, z: 4 }], { pieceId: 'steps', rot: 0 }); await s.view([3, 0.3, 4], 0.4, 0.8, 15); });
  p = await S(() => __s.cell(1, 3));
  await tap(p, 400);
  r = await S(() => __s.get('F|1|0|3'));
  check('C5', 'porch steps tapped in front of the deck climb toward it (r 2)', r?.t === 'steps' && r.r === 2, r);
  // C6 picket fences drawn (Draw mode, a real drag) south and north of a house: pickets away from it
  await S(() => { const s = __s; s.load([...s.house(0, 2, 0, 2)], { pieceId: 'fence_picket', rot: 0, drawMode: true }); });
  const drag = async (a, b, n = 12) => {
    await send('touchStart', [a]);
    for (let i = 1; i <= n; i++) { await send('touchMove', [{ x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n }]); await wait(30); }
    await send('touchEnd', []); await wait(300);
  };
  const [sa, sb] = await S(async () => { await __s.view([3, 0.3, 10], 0.25, 0.8, 16); return [__s.pt(0.3, 0.25, 10), __s.pt(5.7, 0.25, 10)]; });
  await drag(sa, sb);
  const [na, nb] = await S(async () => { await __s.view([3, 0.3, -4], 0.25, 0.8, 16); return [__s.pt(0.3, 0.25, -4), __s.pt(5.7, 0.25, -4)]; });
  await drag(na, nb);
  r = await S(() => [...__s.W.entries.values()].filter((e) => e.def.id === 'fence_picket').map((e) => ({ a: e.p.a, x: e.p.x, z: e.p.z, r: e.p.r })));
  const south = r.filter((q) => q.a === 'x' && q.z === 5), north = r.filter((q) => q.a === 'x' && q.z === -2);
  check('C6', 'picket fences drawn with a real drag south and north of the house show their pickets away from it (south r 0, north r 2) on every segment',
    south.length >= 3 && north.length >= 3 && south.every((q) => q.r === 0) && north.every((q) => q.r === 2) && r.length === south.length + north.length, { south, north, all: r.length, onCanvas: [sa.ok, sb.ok, na.ok, nb.ok] });
  // C7 the press preview shows the facing the tap then places (a door on the back wall, the fallback 0)
  await S(async () => { const s = __s; s.load([...s.house(0, 3, 0, 2)], { pieceId: 'wall_door', rot: 0 }); await s.view([4, 0.3, 3], 0.6, 0.62, 17); });
  p = await S(() => __s.edge('x', 1, 0, 0, 1.6));
  await send('touchStart', [p]); await wait(120);
  const pre = await S(() => __s.target());
  await send('touchEnd', []); await wait(400);
  r = await S(() => __s.get(__s.Wk('x', 1, 0, 0)));
  check('C7', 'the press preview (touch down, 120 ms) shows the facing the tap then places: a back-wall door, out (r 2)', pre?.r === 2 && r?.t === 'wall_door' && r.r === 2, { pre, placed: r });
  // C8 a tree in the empty meadow takes the fallback (the facing last chosen: 3)
  await S(async () => { const s = __s; s.load([], { pieceId: 'tree_oak', rot: 3 }); await s.view([0, 0.3, 0], 0.7, 0.9, 20); });
  p = await S(() => __s.cell(0, 0));
  const pv = await S((p) => __s.at(p), p);
  await tap(p, 400);
  r = await S(() => __s.get(__s.I(0, 0, 0)));
  check('C8', 'a tree in the empty meadow: no rule has a signal, so it takes the fallback (state.rot 3), and says so', r?.r === 3 && pv?.fallback === true && pv?.source === 'auto', { r, pv });
  await ctx.close();
});

// ================================================================================================ D: tap again
await section('D', async () => {
  const { ctx, page } = await game(Q, { mobile: true });
  const { tap, send } = await touchOf(ctx, page);
  const S = (fn, arg) => ev(page, fn, arg);
  await S(async () => { const s = __s; s.load([...s.house(0, 3, 0, 2)], { pieceId: 'bed', rot: 0 }); await s.view([4, 0.3, 3], 0.6, 0.62, 17); });
  // D1 a bed, tapped again ≥ 400 ms later: same slot, the next facing in the rules' order (the preview shows it), one
  // undo step, the turn sound
  let p = await S(() => __s.cell(1, 1));
  await tap(p, 450);
  const b0 = await S(() => ({ q: __s.get(__s.I(1, 0, 1)), n: __s.W.count, u: __s.undos() }));
  await S(() => { __s.log.sfx.length = 0; });
  const pre1 = await S((p) => __s.at(p), p);
  await tap(p, 450);
  const b1 = await S(() => ({ q: __s.get(__s.I(1, 0, 1)), n: __s.W.count, u: __s.undos(), sfx: __s.log.sfx.slice() }));
  check('D1', 'a placed bed tapped again (≥ 400 ms later): same slot, turned to the facing its preview showed (another one), count unchanged, one undo step, the rotate sound',
    !!b0.q && pre1?.action === 'turn' && b1.q?.r === pre1.r && b1.q.r !== b0.q.r && b1.n === b0.n && b1.u === b0.u + 1 && b1.sfx.includes('rotate'), { b0, pre1, b1 });
  // D3 a third and a fourth tap → the other two facings, a fifth back to the first (the order goes round all four);
  // D4 undo → the facing before, redo → the turned one again
  const seq = [b0.q?.r, b1.q?.r];
  for (let i = 0; i < 3; i++) { await tap(p, 450); seq.push(await S(() => __s.get(__s.I(1, 0, 1))?.r)); }
  const ur = await S(() => { const B = __s.B; B.undo(); const u = __s.get(__s.I(1, 0, 1)); B.redo(); return { u, r: __s.get(__s.I(1, 0, 1)) }; });
  check('D3', 'tapped again and again, the bed goes round all four facings and back to the first', new Set(seq.slice(0, 4)).size === 4 && seq[4] === seq[0], { seq });
  check('D4', 'undo of a turn brings the old facing back; redo turns it again', ur.u?.r === seq[3] && ur.r?.r === seq[4], { ur, seq });
  // D2 a door: tapped onto the front wall (out, r 0), tapped again → flipped (r 2)
  await S(() => __s.hw.state.set({ pieceId: 'wall_door', rot: 0 }));
  p = await S(() => __s.edge('x', 1, 3, 0, 1.0));
  await tap(p, 450);
  const d0 = await S(() => __s.get(__s.Wk('x', 1, 0, 3)));
  await tap(p, 450);
  const d1 = await S(() => __s.get(__s.Wk('x', 1, 0, 3)));
  check('D2', 'a door tapped again flips (r ^ 2)', d0?.t === 'wall_door' && d1?.t === 'wall_door' && d1.r === (d0.r ^ 2), { d0, d1 });
  // D5 restyle: another wall material in hand → the wall's material changes, its facing stays (the fallback is 2)
  const mats = await S(() => __s.hw.catalog.getDef('wall').mats);
  await S((m) => { const s = __s; s.hw.state.set({ pieceId: 'wall', rot: 2, mats: { ...s.hw.state.mats, wall: m } }); }, mats[1]);
  p = await S(() => __s.edge('x', 2, 3, 0, 1.0));
  const w0 = await S(() => __s.get(__s.Wk('x', 2, 0, 3)));
  await tap(p, 450);
  const w1 = await S(() => __s.get(__s.Wk('x', 2, 0, 3)));
  check('D5', 'a wall tapped with another material: restyled in place, its facing kept', w1?.m === mats[1] && w0?.m !== mats[1] && w1.r === w0.r, { w0, w1 });
  // D6 replace: a window tapped onto a back wall faces out (r 2; the fallback is 0)
  await S(() => __s.hw.state.set({ pieceId: 'wall_window', rot: 0 }));
  p = await S(() => __s.edge('x', 2, 0, 0, 1.6));
  await tap(p, 450);
  const win = await S(() => __s.get(__s.Wk('x', 2, 0, 0)));
  check('D6', 'a window tapped onto a back wall replaces it facing out (r 2)', win?.t === 'wall_window' && win.r === 2, win);
  // D7 a double tap on an empty cell: one piece, not turned — its auto facing (a wardrobe on the back wall, its back to
  // the window D6 put there: r 0); a tap again after the guard's 250 ms turns it. The two taps go through the rig's onTap
  // back to back: on software GL the first placement takes about a second to draw, so two real touches 60 ms apart
  // reach the game a second apart (a real double tap on a phone is 100–200 ms)
  await S(() => __s.hw.state.set({ pieceId: 'wardrobe', rot: 2 }));
  p = await S(() => __s.cell(2, 0));
  const n7 = await S((p) => ({ n: __s.W.count, pre: __s.at(p), ok: p.ok }), p);
  const d7 = await S(async (p) => {
    const s = __s, rig = s.hw.rig, e = { pointerType: 'touch' };
    const t0 = performance.now(); rig.onTap(p.cx, p.cy, e); const t1 = performance.now(); rig.onTap(p.cx, p.cy, e);
    const one = { q: s.get(s.I(2, 0, 0)), n: s.W.count, gap: +(t1 - t0).toFixed(0), since: +(performance.now() - s.B.lastPlaced.placed).toFixed(0) };
    await s.sleep(400);
    const pre = s.at(p);
    rig.onTap(p.cx, p.cy, e);
    return { ...one, pre, later: s.get(s.I(2, 0, 0)), n2: s.W.count };
  }, p);
  check('D7', 'a double tap on an empty cell (two taps back to back through the rig): one piece, not turned (its auto facing: a wardrobe on the back wall, its back to the window there, r 0); a tap 400 ms later turns it as its preview shows',
    n7.pre?.r === 0 && d7.n === n7.n + 1 && d7.q?.r === 0 && d7.pre?.action === 'turn' && d7.later?.r === d7.pre.r && d7.later.r !== 0 && d7.n2 === d7.n, { n7, d7 });

  // D8 furniture: against the back wall, a tap on its upper half turns it (nothing outside); in the open, a tap on its
  // upper half (the floor under the finger the cell right behind it) turns it too, and so does a tap at its foot; with
  // another part in hand the same tap furnishes the cell behind it
  await S(async () => { const s = __s; s.load([...s.house(0, 3, 0, 3), { t: 'wardrobe', x: 2, y: 0, z: 0, r: 0 }, { t: 'wardrobe', x: 1, y: 0, z: 2, r: 0 }], { pieceId: 'wardrobe', rot: 0 }); await s.view([4, 0.3, 4], 0.6, 0.7, 16); });
  p = await S(() => __s.cell(2, 0, 0, 1.6));
  const n8 = await S(() => __s.W.count);
  const pa8 = await S((p) => __s.at(p), p);
  await tap(p, 450);
  const a8 = await S(() => ({ q: __s.get(__s.I(2, 0, 0)), n: __s.W.count }));
  p = await S(() => __s.cell(1, 2, 0, 1.6));
  const behind = await S((p) => __s.at(p), p);
  const under = await S((p) => { const h = __s.B.rayPlane(p.cx, p.cy, __s.LY(0)); return h && [Math.floor(h.x / 2), Math.floor(h.z / 2)]; }, p);
  await tap(p, 450);
  const b8 = await S(() => ({ q: __s.get(__s.I(1, 0, 2)), n: __s.W.count }));
  const pc = await S(() => __s.cell(1, 2, 0, 0.12, 0, 0.42));
  const pc8 = await S((p) => __s.at(p), pc);
  await tap(pc, 450);
  const c8 = await S(() => ({ q: __s.get(__s.I(1, 0, 2)), n: __s.W.count }));
  await S(() => __s.hw.state.set({ pieceId: 'bookshelf' }));
  const other = await S((p) => __s.at(p), p);
  await tap(p, 450);
  const d8 = await S((k) => ({ q: k && __s.get(k), n: __s.W.count, w: __s.get(__s.I(1, 0, 2)) }), other?.key);
  check('D8', 'a wardrobe against the back wall turns from a tap on its upper half (nothing placed outside); one in the open turns from a tap on its upper half (the floor under it the cell right behind) and from a tap at its foot, nothing placed; a bookshelf in hand, the same tap furnishes the cell behind it',
    a8.n === n8 && pa8?.action === 'turn' && a8.q?.r === pa8.r && a8.q.r !== 0 && behind?.action === 'turn' && behind.key === 'I|1|0|2' && !!under && (under[0] !== 1 || under[1] !== 2)
      && b8.n === n8 && b8.q?.r === behind.r && b8.q.r !== 0 && pc8?.action === 'turn' && c8.n === n8 && c8.q?.r === pc8.r && c8.q.r !== b8.q.r
      && other?.action === 'place' && other.key !== 'I|1|0|2' && d8.n === n8 + 1 && d8.q?.t === 'bookshelf' && d8.w?.r === c8.q.r, { pa8, a8, behind, under, b8, pc8, c8, other, d8 });
  // D9 trees: an oak's canopy over the cell diagonally behind it plants a second oak there; the trunk base turns it
  await S(async () => { const s = __s; s.load([{ t: 'tree_oak', x: 0, y: 0, z: 0, r: 0 }], { pieceId: 'tree_oak', rot: 0 }); await s.view([0, 1.5, 0], Math.PI / 4, 0.85, 18); });
  const canopy = await S(() => {
    const s = __s;
    // the floor point of cell (−1, −1) as seen through the canopy: on the same screen ray, the oak's mesh is hit first
    const q = s.cell(-1, -1);
    const pk = s.B.pickPiece(q.cx, q.cy);
    return { ...q, pick: pk ? pk.entry.key : null, hitY: pk ? +pk.point.y.toFixed(2) : null };
  });
  await tap(canopy, 450);
  const t9 = await S(() => ({ a: __s.get(__s.I(0, 0, 0)), b: __s.get(__s.I(-1, 0, -1)) }));
  p = await S(() => __s.cell(0, 0, 0, 0.15));
  await tap(p, 450);
  const t9b = await S(() => __s.get(__s.I(0, 0, 0)));
  check('D9', 'a tap on an oak\'s canopy over the cell diagonally behind it plants a second oak there (the first unchanged); its trunk base turns it',
    canopy.pick === 'I|0|0|0' && canopy.hitY > 1.2 && t9.b?.t === 'tree_oak' && t9.a?.r === 0 && t9b?.r === 1, { canopy, t9, t9b });
  // D10 Floor 2 active, a wall in hand: taps on the top rim of Floor-1 back walls (95 / 90 / 80 / 60% of their height,
  // the critique's heights) build a new Floor-2 wall each time — the rim ones right on top, facing out (r 2) — and never
  // touch a Floor-1 wall
  await S(async () => { const s = __s; s.load([...s.house(0, 3, 0, 2), ...s.box('floor', 0, 3, 0, 2, 1)], { pieceId: 'wall', rot: 0 }); s.hw.state.set({ level: 1, seeAll: true }); await s.view([4, 2.2, 1], 0.35, 0.95, 15); });
  const d10 = [];
  for (const [x, f] of [[0, 0.95], [1, 0.9], [2, 0.8], [2, 0.6]]) {
    p = await S(([x, f]) => __s.pt(x * 2 + 1, __s.LY(0) + 2.5 * f, 0.09), [x, f]);
    const before = await S(() => JSON.stringify([...__s.W.entries.values()].filter((e) => e.def.layer === 'W' && e.p.y === 0).map((e) => e.p)));
    const n0 = await S(() => [...__s.W.entries.values()].filter((e) => e.def.layer === 'W' && e.p.y === 1).map((e) => e.key));
    await tap(p, 450);
    const after = await S(([n0, before]) => {
      const s = __s, ups = [...s.W.entries.values()].filter((e) => e.def.layer === 'W' && e.p.y === 1 && !n0.includes(e.key));
      const low = JSON.stringify([...s.W.entries.values()].filter((e) => e.def.layer === 'W' && e.p.y === 0).map((e) => e.p));
      return { added: ups.map((e) => ({ key: e.key, r: e.p.r, auto: s.B.facingAt?.(e.def, e.p)?.r })), lowSame: low === before };
    }, [n0, before]);
    d10.push({ x, f, ok: p.ok, ...after });
  }
  check('D10', 'Floor 2 active: a tap at 95 / 90 / 80 / 60% of a Floor-1 back wall\'s height builds one new Floor-2 wall each time with its auto facing (the rim taps right on top, facing out: r 2); no Floor-1 wall changes',
    d10.every((d) => d.ok && d.added.length === 1 && d.lowSame && d.added[0].r === d.added[0].auto) && d10.slice(0, 3).every((d) => d.added[0].key === `W|x|${d.x}|1|0` && d.added[0].r === 2), d10);
  // D11 a gap in the front wall, a low camera: 25 taps across the gap fill it every time, facing out (r 0; the fallback
  // is 2), and never turn the back wall seen through it
  await S(async () => { const s = __s; s.load([...s.house(0, 3, 0, 2, { 'x|1|3': null })], { pieceId: 'wall', rot: 2 }); await s.view([3, 1, 6], 0.15, 1.38, 14); });
  const d11 = { filled: 0, out: 0, backTurned: 0, n: 0, off: 0 };
  for (let i = 0; i < 5; i++) {
    for (let j = 0; j < 5; j++) {
      p = await S(([i, j]) => __s.pt(2 + 0.3 + 0.35 * i, __s.LY(0) + 0.35 + 0.42 * j, 6), [i, j]);
      if (!p.ok) { d11.off++; continue; }
      d11.n++;
      await tap(p, 300);
      const q = await S(() => ({ g: __s.get(__s.Wk('x', 1, 0, 3)), back: [0, 1, 2, 3].map((x) => __s.get(__s.Wk('x', x, 0, 0))?.r) }));
      if (q.g?.t === 'wall') { d11.filled++; if (q.g.r === 0) d11.out++; }
      if (q.back.some((r) => r !== 2)) d11.backTurned++;
      await S(() => { if (__s.W.get(__s.Wk('x', 1, 0, 3))) __s.B.undo(); });
      await wait(120);
    }
  }
  check('D11', 'a gap in the front wall, low camera (θ 0.15, φ 1.38): 25 taps across it fill the gap every time, facing out (r 0); no wall behind it turns',
    d11.n === 25 && d11.filled === 25 && d11.out === 25 && d11.backTurned === 0, d11);
  // D12 roofs: a roof slope tapped onto a panel of the same part turns it, keeping its height; a skylight tapped on it
  // replaces it in place with the panel's facing and height (the fallback differs from both)
  await S(async () => {
    const s = __s;
    s.load([...s.house(0, 3, 0, 3), { t: 'roof_slope', x: 0, y: 1, z: 1, r: 1, h: 0 }, { t: 'roof_slope', x: 1, y: 1, z: 1, r: 1, h: 1 }], { pieceId: 'roof_slope', rot: 3 });
    await s.view([3, 3, 3], 2.2, 0.75, 16);
  });
  p = await S(() => __s.pt(3, __s.LY(1) + 1.25 + 0.65, 3));
  const pk12 = await S((p) => { const k = __s.B.pickPiece(p.cx, p.cy); return k ? k.entry.key : null; }, p);
  await tap(p, 450);
  const e1 = await S(() => [...__s.W.entries.values()].filter((e) => e.def.layer === 'R').map((e) => ({ t: e.p.t, x: e.p.x, z: e.p.z, r: e.p.r, h: e.p.h })).sort((a, b) => a.x - b.x));
  await S(() => __s.hw.state.set({ pieceId: 'roof_window', rot: 0 }));
  await tap(p, 450);
  const e2 = await S(() => [...__s.W.entries.values()].filter((e) => e.def.layer === 'R').map((e) => ({ t: e.p.t, x: e.p.x, z: e.p.z, r: e.p.r, h: e.p.h })).sort((a, b) => a.x - b.x));
  check('D12', 'a roof slope tapped on its own panel turns that panel to the other side of the ridge (r 1 → 3, the next most likely) keeping its height; a skylight tapped on it swaps in with the panel\'s facing and height',
    pk12 === 'R|1|3|1' && e1.length === 2 && e1[1].t === 'roof_slope' && e1[1].r === 3 && e1[1].h === 1 && e2.length === 2 && e2[1].t === 'roof_window' && e2[1].r === 3 && e2[1].h === 1, { pk12, e1, e2 });
  await ctx.close();
});

// ================================================================================================ E: Turn and R
await section('E', async () => {
  // --- phone: the Turn button
  {
    const { ctx, page } = await game(Q, { mobile: true });
    const { tap, send } = await touchOf(ctx, page);
    const S = (fn, arg) => ev(page, fn, arg);
    const turnBtn = () => S(() => { const b = document.querySelector('.hw-rot'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    await S(async () => { const s = __s; s.load([...s.house(0, 3, 0, 2)], { pieceId: 'sofa', rot: 0 }); await s.view([4, 0.3, 3], 0.6, 0.62, 17); });
    let p = await S(() => __s.cell(1, 1));
    await tap(p, 450);
    const e0 = await S(() => ({ q: __s.get(__s.I(1, 0, 1)), u: __s.undos(), n: __s.W.count }));
    let b = await turnBtn();
    if (b) await tap(b, 450);
    const e1 = await S(() => ({ q: __s.get(__s.I(1, 0, 1)), u: __s.undos(), n: __s.W.count }));
    check('E1', 'phone: a sofa tap-placed, then a real tap on the tray\'s Turn button turns it (+90°, one undo step)', !!b && !!e0.q && e1.q?.r === ((e0.q.r + 1) & 3) && e1.u === e0.u + 1 && e1.n === e0.n, { e0, e1, btn: !!b });
    // E2 another piece in hand (not the one just placed): Turn says how to turn a piece and changes nothing
    await S(() => { __s.hw.state.set({ pieceId: 'armchair' }); __s.log.toast.length = 0; });
    const v0 = await S(() => __s.W.version);
    b = await turnBtn();
    if (b) await tap(b, 450);
    const e2 = await S(() => ({ v: __s.W.version, toasts: __s.log.toast.slice(), q: __s.get(__s.I(1, 0, 1)) }));
    check('E2', 'then another piece in hand: Turn shows the hint toast and changes nothing', !!b && e2.v === v0 && e2.q?.r === e1.q?.r && e2.toasts.some((t) => /Tap a piece you placed/.test(t)), e2);
    // E5 no Turn button for pieces whose turn shows nothing (railings) or that fit their roof (gables)
    const e5 = await S(async () => {
      const out = {};
      for (const id of ['railing', 'gable', 'gable_window', 'sofa', 'wall_door']) { __s.hw.state.set({ pieceId: id }); await __s.sleep(60); out[id] = !!document.querySelector('.hw-rot'); }
      return out;
    });
    check('E5', 'the Turn button is hidden for railings and gables (and shown for a sofa and a door)', !e5.railing && !e5.gable && !e5.gable_window && e5.sofa && e5.wall_door, e5);
    // E6 during an aim: Turn (a second touch on the button) turns the preview of an empty cell and the lift places it
    // turned; over a placed piece of that part it turns the piece at once and the lift adds no second turn. The finger
    // holds `lift` px under the cell, so the lifted aim point (§6) is on it
    await S(() => __s.hw.state.set({ pieceId: 'bookshelf', rot: 0 }));
    p = await S(() => __s.cell(2, 0));
    const f = { x: p.x, y: p.y + liftFor(390, 664) };
    const fOk = await S((f) => document.elementFromPoint(f.x, f.y) === __s.hw.renderer.domElement, f);
    const eased = () => S(async () => { for (let i = 0; i < 200 && !(__s.hw.rig.aim && __s.hw.rig.aim.k >= 1); i++) await __s.sleep(20); });
    b = await turnBtn();
    await send('touchStart', [{ ...f, id: 0 }]); await wait(700); await eased();
    const a0 = await S(() => ({ t: __s.target(), mode: __s.hw.rig.mode }));
    if (b) { await send('touchStart', [{ ...f, id: 0 }, { ...b, id: 1 }]); await wait(60); await send('touchEnd', [{ ...b, id: 1 }]); await wait(200); }
    const a1 = await S(() => __s.target());
    await send('touchEnd', []); await wait(450);
    const a2 = await S(() => __s.get(__s.I(2, 0, 0)));
    await send('touchStart', [{ ...f, id: 0 }]); await wait(700); await eased();
    const c0 = await S(() => ({ t: __s.target(), mode: __s.hw.rig.mode, u: __s.undos() }));
    if (b) { await send('touchStart', [{ ...f, id: 0 }, { ...b, id: 1 }]); await wait(60); await send('touchEnd', [{ ...b, id: 1 }]); await wait(200); }
    const c1 = await S(() => ({ q: __s.get(__s.I(2, 0, 0)), t: __s.target() }));
    await send('touchEnd', []); await wait(450);
    const c2 = await S(() => ({ q: __s.get(__s.I(2, 0, 0)), u: __s.undos() }));
    check('E6', 'during an aim (the lifted point on an empty cell), Turn (a second touch on its button) turns the preview and the lift places it turned; aiming at the placed piece, Turn turns it at once and the lift adds no second turn',
      fOk && a0.mode === 'aim' && a0.t?.key === 'I|2|0|0' && a0.t?.r === 0 && a1?.r === 1 && a2?.r === 1 && c0.mode === 'aim' && c0.t?.action === 'turn' && c1.q?.r === 2 && c2.q?.r === 2 && c2.u === c0.u + 1,
      { fOk, a0, a1, a2: a2?.r, c0, c1, c2 });
    await ctx.close();
  }
  // --- desktop: hover, R, clicks
  {
    const { ctx, page } = await game(Q, { w: 1280, h: 800 });
    const S = (fn, arg) => ev(page, fn, arg);
    const M = page.mouse, KB = page.keyboard;
    await S(async () => { const s = __s; s.load([...s.house(0, 3, 0, 2)], { pieceId: 'bookshelf', rot: 0 }); await s.view([4, 0.3, 3], 0.6, 0.7, 15); });
    // E3 hover an empty cell: the auto facing; R turns the preview (a pin); the click places it so; another cell: auto again
    let p = await S(() => __s.cell(1, 0));
    await M.move(p.x, p.y); await wait(150);
    const h0 = await S(() => __s.target());
    await KB.press('r'); await wait(150);
    const h1 = await S(() => __s.target());
    await M.click(p.x, p.y); await wait(400);
    const q1 = await S(() => __s.get(__s.I(1, 0, 0)));
    const p2 = await S(() => __s.cell(3, 0));
    await M.move(p2.x, p2.y, { steps: 4 }); await wait(150);
    const h2 = await S(() => __s.target());
    check('E3', 'desktop: hovering an empty cell previews the auto facing; R turns the preview; the click places it turned; another cell previews the auto facing again',
      h0?.r === 0 && h0.source === 'auto' && h1?.r === 1 && h1.source === 'pin' && q1?.r === 1 && h2?.r === 0 && h2.source === 'auto', { h0, h1, q1, h2 });
    // E4 click a bookshelf in, move the mouse off the canvas: R turns that piece, Shift+R turns it back
    await M.click(p2.x, p2.y); await wait(400);
    const k0 = await S(() => __s.get(__s.I(3, 0, 0)));
    const bar = await S(() => { const r = document.querySelector('.hw-count').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    await M.move(bar.x, bar.y, { steps: 4 }); await wait(150);
    const off = await S(() => __s.B.ghostVisible);
    await KB.press('r'); await wait(300);
    const k1 = await S(() => __s.get(__s.I(3, 0, 0)));
    await KB.press('Shift+R'); await wait(300);
    const k2 = await S(() => __s.get(__s.I(3, 0, 0)));
    check('E4', 'desktop: R with the mouse off the canvas right after a click turns that piece (+1); Shift+R turns it back (−1)',
      !off && k0?.r === 0 && k1?.r === 1 && k2?.r === 0, { off, k0, k1, k2 });
    // E4b the mouse still over the piece just clicked: R turns it at once (one undo step a press), Shift+R back, a
    // click turns it again (tap again), and undo × 4 brings back the auto facing
    await S(async () => { const s = __s; s.load([...s.house(0, 3, 0, 2)], { pieceId: 'sofa', rot: 0 }); await s.view([4, 0.3, 3], 0.6, 0.7, 15); });
    p = await S(() => __s.cell(1, 1));
    await M.move(p.x, p.y); await wait(100);
    await M.click(p.x, p.y); await wait(400);
    await M.move(p.x + 3, p.y, { steps: 2 }); await wait(150);
    const s0 = await S(() => ({ q: __s.get(__s.I(1, 0, 1)), t: __s.target(), u: __s.undos(), n: __s.W.count }));
    const seq = [];
    for (const k of ['r', 'r', 'Shift+R']) { await KB.press(k); await wait(250); seq.push(await S(() => __s.get(__s.I(1, 0, 1))?.r)); }
    const tc = await S(() => __s.target());
    await M.click(p.x + 3, p.y); await wait(400);
    seq.push(await S(() => __s.get(__s.I(1, 0, 1))?.r));
    const s1 = await S(() => ({ u: __s.undos(), n: __s.W.count }));
    const back = await S(() => { for (let i = 0; i < 4; i++) __s.B.undo(); return __s.get(__s.I(1, 0, 1))?.r; });
    const r0 = s0.q?.r;
    check('E4b', 'desktop, the mouse still on the sofa just clicked: R → +1, R → +2, Shift+R → +1 (each at once, one undo step each), a click → the facing the preview showed (tap again); undo × 4 → the auto facing',
      s0.t?.action === 'turn' && seq.slice(0, 3).join() === [1, 2, 1].map((d) => (r0 + d) & 3).join() && tc?.action === 'turn' && seq[3] === tc.r && seq[3] !== seq[2]
        && s1.u === s0.u + 4 && s1.n === s0.n && back === r0, { s0, seq, tc, s1, back });
    // E7 roofs: a 4 × 4 house with its west eave row (r 1); hovering the second-row cell previews r 1, h 1; R steps the
    // preview round (each facing its own height, one slot all along); the click places what the preview showed
    await S(async () => {
      const s = __s;
      s.load([...s.house(0, 3, 0, 3), ...[0, 1, 2, 3].map((z) => ({ t: 'roof_slope', x: 0, y: 1, z, r: 1, h: 0 }))], { pieceId: 'roof_slope', rot: 0 });
      await s.view([4, 2.5, 4], Math.PI / 2, 0.62, 16);
    });
    p = await S(() => __s.pt(3, __s.LY(1) + 0.1, 3));
    await M.move(p.x, p.y, { steps: 3 }); await wait(150);
    const steps = [await S(() => { const t = __s.B.target; return t && { r: t.p.r, h: t.p.h, sk: t.slotKey, source: t.facing?.source }; })];
    for (let i = 0; i < 5; i++) { await KB.press('r'); await wait(150); steps.push(await S(() => { const t = __s.B.target; return t && { r: t.p.r, h: t.p.h, sk: t.slotKey, source: t.facing?.source }; })); }
    await M.click(p.x, p.y); await wait(400);
    const placed = await S(() => [...__s.W.entries.values()].filter((e) => e.def.layer === 'R' && e.p.x === 1).map((e) => ({ x: e.p.x, z: e.p.z, r: e.p.r, h: e.p.h })));
    const wantR = [1, 2, 3, 0, 1, 2];
    check('E7', 'a roof\'s second row: the preview is r 1, h 1; R steps it r 2 → 3 → 0 → 1 → 2, each with its own height, the same slot all along; the click places r 2 at the height shown',
      steps.every((s, i) => s && s.r === wantR[i] && s.sk === steps[0].sk) && steps[0].h === 1 && steps[4].h === 1 && steps[0].source === 'auto'
      && placed.length === 1 && placed[0].r === 2 && placed[0].h === steps[5].h && placed[0].z === 1, { steps, placed });
    await ctx.close();
  }
});

// ================================================================================================ F: strokes
await section('F', async () => {
  const { ctx, page } = await game(Q, { w: 1280, h: 800 });
  const S = (fn, arg) => ev(page, fn, arg);
  const M = page.mouse, KB = page.keyboard;
  const drag = async (a, b, n = 14, mid = null) => {
    await M.move(a.x, a.y); await M.down();
    for (let i = 1; i <= n; i++) { await M.move(a.x + ((b.x - a.x) * i) / n, a.y + ((b.y - a.y) * i) / n); await wait(35); if (mid && i === mid.at) await mid.fn(); }
    await M.up(); await wait(350);
  };
  // F1 a hedge stroke along one line south of a house: one facing for every segment, away from the house (r 0)
  let pts = await S(async () => { const s = __s; s.load([...s.house(0, 2, 0, 2)], { pieceId: 'hedge', rot: 2, drawMode: true }); await s.view([3, 0.3, 8], 0.3, 0.8, 16); return [s.pt(0.3, 0.25, 10), s.pt(5.7, 0.25, 10)]; });
  await drag(pts[0], pts[1]);
  let r = await S(() => [...__s.W.entries.values()].filter((e) => e.def.id === 'hedge').map((e) => ({ a: e.p.a, x: e.p.x, z: e.p.z, r: e.p.r })));
  check('F1', 'a hedge stroke along one line: every segment takes one facing, away from the house (r 0; the fallback is 2)', r.length >= 3 && r.every((q) => q.a === 'x' && q.z === 5 && q.r === 0), r);
  // F2 a wall stroke restyling a row of walls with mixed facings keeps each wall's facing
  const mats = await S(() => __s.hw.catalog.getDef('wall').mats);
  pts = await S(async (m) => {
    const s = __s;
    s.load([0, 1, 2, 3].map((x) => ({ t: 'wall', a: 'x', x, y: 0, z: 0, r: x % 2 ? 2 : 0, m: m[0] })), { pieceId: 'wall', rot: 0, drawMode: true, mats: { ...s.hw.state.mats, wall: m[1] } });
    await s.view([4, 0.5, 2], 0.3, 0.9, 14);
    return [s.pt(0.4, 0.25, 0.6), s.pt(7.6, 0.25, 0.6)];
  }, mats);
  await drag(pts[0], pts[1]);
  r = await S(() => [0, 1, 2, 3].map((x) => __s.get(__s.Wk('x', x, 0, 0))));
  check('F2', 'a wall stroke restyling a row of walls with mixed facings: every wall takes the new look and keeps its own facing', r.every((q, x) => q?.m === mats[1] && q.r === (x % 2 ? 2 : 0)), r.map((q) => q && [q.m, q.r]));
  // F3 a stroke over identical pieces (hedges, mixed facings) turns none of them
  pts = await S(async () => {
    const s = __s;
    s.load([0, 1, 2, 3].map((x) => ({ t: 'hedge', a: 'x', x, y: 0, z: 0, r: x % 2 ? 2 : 0 })), { pieceId: 'hedge', rot: 0, drawMode: true });
    await s.view([4, 0.5, 2], 0.3, 0.9, 14);
    return [s.pt(0.4, 0.25, 0.6), s.pt(7.6, 0.25, 0.6)];
  });
  const u3 = await S(() => __s.undos());
  await drag(pts[0], pts[1]);
  r = await S(() => ({ q: [0, 1, 2, 3].map((x) => __s.get(__s.Wk('x', x, 0, 0))?.r), u: __s.undos(), n: __s.W.count }));
  check('F3', 'a stroke over identical pieces with mixed facings turns none of them (nothing recorded)', r.q.join() === '0,2,0,2' && r.u === u3 && r.n === 4, { ...r, u3 });
  // F4 R mid-stroke turns the stroke's line (the segments laid so far too); the stroke undoes in one step
  pts = await S(async () => { const s = __s; s.load([...s.house(0, 2, 0, 2)], { pieceId: 'fence_picket', rot: 0, drawMode: true }); await s.view([3, 0.3, 8], 0.3, 0.8, 16); return [s.pt(0.3, 0.25, 10), s.pt(5.7, 0.25, 10)]; });
  const n4 = await S(() => ({ n: __s.W.count, u: __s.undos() }));
  let mid = null;
  await drag(pts[0], pts[1], 14, { at: 7, fn: async () => { mid = await S(() => [...__s.W.entries.values()].filter((e) => e.def.id === 'fence_picket').map((e) => e.p.r)); await KB.press('r'); await wait(120); } });
  r = await S(() => [...__s.W.entries.values()].filter((e) => e.def.id === 'fence_picket').map((e) => ({ x: e.p.x, z: e.p.z, r: e.p.r })));
  const u4 = await S(() => { const u = __s.undos(); __s.B.undo(); return { u, n: __s.W.count }; });
  check('F4', 'desktop: R mid-stroke turns the stroke\'s line — later segments and the ones already laid (r 0 → 2) — and the whole stroke undoes in one step',
    mid?.length >= 1 && mid.every((x) => x === 0) && r.length > mid.length && r.every((q) => q.z === 5 && q.r === 2) && u4.u === n4.u + 1 && u4.n === n4.n, { mid, r, n4, u4 });
  await ctx.close();
});

// ================================================================================================ G: guides, saves, Show me
await section('G', async () => {
  // G1 / G2 guided cottage, real taps on the phone
  {
    const { ctx, page } = await game(Q, { mobile: true });
    const { tap } = await touchOf(ctx, page);
    const S = (fn, arg) => ev(page, fn, arg);
    await S(async () => { __s.load([]); __s.hw.blueprints.startGuided('cottage'); await __s.sleep(400); });
    // fast-forward a stage (rot 'none' pieces and what the check does not tap) straight from the blueprint
    const fill = (stages, skipTypes = []) => S(([stages, skipTypes]) => {
      const s = __s, bp = s.hw.blueprints.get('cottage');
      for (const it of bp._items) if (stages.includes(it.stage) && !skipTypes.includes(it.p.t) && !s.W.get(it.key)) s.W.add(it.p, { record: false });
    }, [stages, skipTypes]);
    const g1 = [];
    const snap = async (want, n) => {
      for (let i = 0; i < 40 && g1.filter((g) => g.stage === want).length < n; i++) {
        const it = await S(async () => {
          const s = __s, B = s.B, bp = s.hw.blueprints;
          const q = bp.selectNext({ focus: false, quiet: true });
          if (!q) return null;
          const def = s.hw.catalog.getDef(q.t);
          const st = bp.get('cottage')._items.find((x) => x.key === s.W.keyOf(q))?.stage;
          s.hw.state.set({ rot: (((q.r | 0) + 1) & 3), seeAll: true });          // a fallback the guide must not take
          const box = B._slotBox(def, q, new s.THREE.Box3()), c = box.getCenter(new s.THREE.Vector3());
          await s.view([c.x, c.y, c.z], s.hw.rig.goal.theta, 0.95, 12, 250);
          const p = s.pt(c.x, c.y, c.z);
          const t = s.at(p);
          return { q, stage: st, p, pre: t && { key: t.key, r: t.r, source: t.source } };
        });
        if (!it) break;
        const before = await S(() => [...__s.W.entries.keys()]);
        await tap(it.p, 300);
        const added = await S(([before]) => { const s = __s, bp = s.hw.blueprints.get('cottage'), m = new Map(bp._items.map((x) => [x.key, x.p])); return [...s.W.entries.values()].filter((e) => !before.includes(e.key)).map((e) => ({ key: e.key, r: e.p.r, bpR: m.get(e.key)?.r | 0, inBp: m.has(e.key) })); }, [before]);
        g1.push({ stage: it.stage, t: it.q.t, want: it.q.r | 0, source: it.pre?.source, added });
      }
    };
    await fill(['foundation']);
    await snap('walls', 14);
    await fill(['walls', 'porch', 'upper', 'upperWalls']);
    await snap('roof', 6);
    const ok1 = g1.length === 20 && g1.every((g) => g.source === 'guide' && g.added.length === 1 && g.added[0].inBp && g.added[0].r === g.added[0].bpR);
    check('G1', 'guided cottage: 20 guides snapped with real taps (14 walls round the house, 6 roof panels) — each placed with the blueprint\'s facing, never the fallback; the preview said "guide"', ok1,
      ok1 ? { walls: g1.filter((g) => g.stage === 'walls').length, roof: g1.filter((g) => g.stage === 'roof').length } : g1.filter((g) => !(g.source === 'guide' && g.added.length === 1 && g.added[0].inBp && g.added[0].r === g.added[0].bpR)).slice(0, 5));
    // G2 every wall guide built: a tap with a wall on a finished wall (the fallback turned away from it) changes nothing
    await fill(['walls']);
    const g2 = await S(async () => {
      const s = __s, bp = s.hw.blueprints.get('cottage');
      await s.sleep(800);                                 // the guides move on to the next stage (and hand its piece)
      const it = bp._items.find((x) => x.p.t === 'wall' && x.p.y === 0 && (x.p.r | 0) === 0);
      const colors = { ...s.hw.state.colors };
      if (it.p.c) colors[it.p.m] = it.p.c; else delete colors[it.p.m];
      s.hw.state.set({ pieceId: 'wall', rot: 2, level: 0, seeAll: true, mats: { ...s.hw.state.mats, wall: it.p.m }, colors });
      const q = it.p, c = q.a === 'x' ? [(q.x + 0.5) * 2, 1.3, q.z * 2] : [q.x * 2, 1.3, (q.z + 0.5) * 2];
      await s.view(c, s.hw.rig.goal.theta, 1.0, 12, 250);
      const pv = s.at(s.pt(...c));
      return { key: it.key, rec: s.get(it.key), p: s.pt(...c), guides: s.B._guidesLeft(s.hw.catalog.getDef('wall')), inHand: s.hw.state.pieceId, pv };
    });
    await tap(g2.p, 450);
    const g2b = await S((k) => __s.get(k), g2.key);
    check('G2', 'guided cottage, every wall guide built: a tap with a wall in hand (its own look) on a finished blueprint wall never turns it (the fallback was the other way)',
      !g2.guides && !!g2.rec && g2.inHand === 'wall' && g2.pv?.key === g2.key && g2.pv.source === 'blueprint' && JSON.stringify(g2b) === JSON.stringify(g2.rec),
      { before: g2.rec, after: g2b, guidesLeft: g2.guides, inHand: g2.inHand, pv: g2.pv });
    await ctx.close();
  }
  // G3 / G4 stamps, saves, share codes (desktop)
  {
    const { ctx, page } = await game(Q, { w: 1280, h: 800 });
    const S = (fn, arg) => ev(page, fn, arg);
    const g3 = await S(async () => {
      const s = __s, hw = s.hw, out = { same: {}, differs: 0 };
      const { compact } = await import('/js/world.js');
      for (const id of ['starter', 'aframe', 'logcabin', 'cottage', 'farmhouse']) {
        s.load([]);
        hw.blueprints.stamp(id, { animate: false, record: false });
        const key = (q) => s.W.keyOf(q);
        const got = hw.world.serialize().pieces.map((q) => JSON.stringify(q)).sort();
        const want = hw.blueprints.get(id).pieces.map((q) => JSON.stringify(compact(s.W.normalize(q)))).sort();
        out.same[id] = got.length === want.length && got.every((x, i) => x === want[i]);
        // control: smart facing is live here and would have decided some of these differently (stamping never asks it)
        for (const e of hw.world.entries.values()) { const f = typeof s.B.facingAt === 'function' ? s.B.facingAt(e.def, e.p) : null; if (f && f.rule && f.rule !== 'gable' && !(f.r === e.p.r)) out.differs++; }
        void key;
      }
      return out;
    });
    check('G3', 'every stock blueprint stamped serialises exactly like its records — although the rules (live in this build) would face some of them otherwise',
      Object.values(g3.same).every(Boolean) && Object.keys(g3.same).length === 5 && g3.differs > 0, g3);
    const g4 = await S(async () => {
      const s = __s, hw = s.hw;
      // a hand-written save with deliberately "wrong" facings: back walls r 0 (out is r 2), a bed facing the wall, a door inward
      const save = { app: 'hearthwood', v: 1, pieces: [
        ...s.box('foundation', 0, 3, 0, 2), ...[0, 1, 2, 3].map((x) => ({ t: 'wall', x, y: 0, z: 0, a: 'x' })),
        ...[0, 1, 2, 3].map((x) => ({ t: x === 1 ? 'wall_door' : 'wall', x, y: 0, z: 3, a: 'x', r: x === 1 ? 2 : 0 })),
        ...[0, 1, 2].flatMap((z) => [{ t: 'wall', x: 0, y: 0, z, a: 'z', r: 2 }, { t: 'wall', x: 4, y: 0, z, a: 'z' }]),
        { t: 'bed', x: 1, y: 0, z: 0, r: 2 },
      ] };
      const { compact } = await import('/js/world.js');
      const norm = save.pieces.map((q) => compact(s.W.normalize(q)));
      hw.world.load(save);
      const a = JSON.stringify(hw.world.serialize()), want = JSON.stringify({ app: 'hearthwood', v: 1, pieces: norm });
      const code = await hw.storage.exportCode(hw.world.serialize());
      const back = await hw.storage.importCode(code);
      hw.loadBuild(back);
      const b = JSON.stringify(hw.world.serialize());
      const f = typeof s.B.facingAt === 'function' ? [s.B.facingAt('wall', { t: 'wall', x: 1, y: 0, z: 0, a: 'x' })?.r, s.B.facingAt('bed', { t: 'bed', x: 1, y: 0, z: 0 })?.r, s.B.facingAt('wall_door', { t: 'wall_door', x: 1, y: 0, z: 3, a: 'x' })?.r] : null;
      return { loaded: a === want, roundTrip: b === want, code: code.slice(0, 12), rules: f };
    });
    check('G4', 'a hand-written save with deliberately "wrong" facings loads and serialises byte-identically, and survives a share-code round trip — the rules would have faced the back wall, the bed and the door otherwise (r 2, r 0, r 0)',
      g4.loaded && g4.roundTrip && g4.rules?.join() === '2,0,0', g4);
    await ctx.close();
  }
  // G5 / G5b Show me: the preview on a Show me spot has the wish's facing; the snap builds it
  {
    const HOUSE = String.raw`(x0, z0, roof = true, bed = true) => {
      const P = [];
      for (let x = x0; x <= x0 + 3; x++) for (let z = z0; z <= z0 + 2; z++) { P.push({ t: 'foundation', x, y: 0, z }); if (roof) P.push({ t: 'roof_flat', x, y: 1, z, h: 0 }); }
      for (let x = x0; x <= x0 + 3; x++) { P.push({ t: 'wall', a: 'x', x, y: 0, z: z0 }); P.push({ t: x === x0 + 1 ? 'wall_door' : 'wall', a: 'x', x, y: 0, z: z0 + 3 }); }
      for (let z = z0; z <= z0 + 2; z++) { P.push({ t: 'wall', a: 'z', x: x0, y: 0, z }); P.push({ t: 'wall', a: 'z', x: x0 + 4, y: 0, z }); }
      if (bed) P.push({ t: 'bed', x: x0, y: 0, z: z0, r: 1 });
      return P;
    }`;
    const { ctx, page } = await game('clean=1&nosave=1&town=fresh&thumbs=0', { mobile: true });
    const { send } = await touchOf(ctx, page);
    const S = (fn, arg) => ev(page, fn, arg);
    const g5 = await S(async (HOUSE) => {
      const s = __s, hw = s.hw, t = hw.town, H = eval(HOUSE);
      hw.state.set({ timeFlow: false, time: 0.42 });
      await t.debug.edit((w) => { w.clear({ record: false }); for (const p of H(-2, -2)) w.add(p, { record: false }); });
      t.debug.reset();
      const id = t.debug.spawn('gardener');
      t.debug.step(8);
      const ok = t.debug.wish(id, 'w_door_bench').ok;
      t.showMe({ villager: id });
      await s.sleep(500);
      const e = t.debug.plan(id)?.recs?.[0];
      if (!ok || !e) return { ok, e: !!e };
      const rec = { ...e.rec };
      hw.state.set({ rot: ((rec.r | 0) + 1) & 3 });               // the fallback turned away from the wish's facing
      await s.view([e.x, 0.5, e.z], hw.rig.goal.theta, 0.9, 14, 300);
      const auto = s.B.facingAt?.(hw.catalog.getDef(rec.t), rec)?.r;
      return { ok, id, rec, p: s.pt(e.x, e.y + 0.02, e.z), auto };
    }, HOUSE);
    let pre = null, placed = null;
    if (g5.p) {
      await send('touchStart', [g5.p]); await wait(150);
      pre = await S(() => __s.target());
      await send('touchEnd', []); await wait(600);
      placed = await S((rec) => __s.get(__s.W.keyOf(__s.W.normalize(rec))), g5.rec);
    }
    check('G5', 'Show me for a bench (w_door_bench), the fallback turned away: the press preview on the ring has the wish\'s facing, and the lift builds the bench exactly there with it',
      g5.ok && !!pre && pre.r === (g5.rec.r | 0) && pre.source === 'hint' && placed?.t === 'bench' && placed.r === (g5.rec.r | 0), { rec: g5.rec, auto: g5.auto, pre, placed });
    await ctx.close();
  }
  // G5L the lifted aim on a Show me ring (§6.4): the finger held `lift` px under the ring (off it), the lifted point
  // on it → the preview has the wish's facing, and lifting builds the bench exactly there (the town's onAimEnd wrapper
  // gets the lifted point; nothing is built under the finger)
  {
    const HOUSE = String.raw`(x0, z0) => {
      const P = [];
      for (let x = x0; x <= x0 + 3; x++) for (let z = z0; z <= z0 + 2; z++) P.push({ t: 'foundation', x, y: 0, z }, { t: 'roof_flat', x, y: 1, z, h: 0 });
      for (let x = x0; x <= x0 + 3; x++) { P.push({ t: 'wall', a: 'x', x, y: 0, z: z0 }); P.push({ t: x === x0 + 1 ? 'wall_door' : 'wall', a: 'x', x, y: 0, z: z0 + 3 }); }
      for (let z = z0; z <= z0 + 2; z++) { P.push({ t: 'wall', a: 'z', x: x0, y: 0, z }); P.push({ t: 'wall', a: 'z', x: x0 + 4, y: 0, z }); }
      P.push({ t: 'bed', x: x0, y: 0, z: z0, r: 1 });
      return P;
    }`;
    const LIFT = liftFor(390, 664);
    const { ctx, page } = await phone('clean=1&nosave=1&town=fresh&thumbs=0', 390, 664);
    const T = await touchOf(ctx, page);
    const S = (fn, arg) => ev(page, fn, arg);
    const g = await S(async ([HOUSE, L]) => {
      const s = __s, hw = s.hw, t = hw.town, H = eval(HOUSE);
      hw.state.set({ timeFlow: false, time: 0.42 });
      await t.debug.edit((w) => { w.clear({ record: false }); for (const p of H(-2, -2)) w.add(p, { record: false }); });
      t.debug.reset();
      const id = t.debug.spawn('gardener');
      t.debug.step(8);
      const ok = t.debug.wish(id, 'w_door_bench').ok;
      t.showMe({ villager: id });
      await s.sleep(500);
      const e = t.debug.plan(id)?.recs?.[0];
      if (!ok || !e) return { ok, e: !!e };
      const rec = { ...e.rec };
      hw.state.set({ rot: ((rec.r | 0) + 1) & 3 });               // the fallback turned away from the wish's facing
      await s.view([e.x, 0.5, e.z], hw.rig.goal.theta, 0.9, 14, 300);
      const p = s.pt(e.x, e.y + 0.02, e.z), f = { x: p.x, y: p.y + L }, A = t.debug.actors;
      return { ok, rec, p: { x: p.x, y: p.y }, f, fOnCanvas: __h.onCanvas(f.x, f.y), hitP: A.highlightHit(p.cx, p.cy), hitF: A.highlightHit(f.x, f.y),
        keyRec: s.W.keyOf(s.W.normalize(rec)), keyF: __h.res(f.x, f.y), benches: [...s.W.entries.values()].filter((q) => q.def.id === 'bench').length };
    }, [HOUSE, LIFT]);
    let m = null, after = null;
    if (g.f) {
      m = await holdAt(T, page, g.f, () => ({ ...__h.mid(), pre: __s.target() }), { after: 700 });
      after = await S((k) => ({ placed: __s.get(k), benches: [...__s.W.entries.values()].filter((q) => q.def.id === 'bench').map((q) => q.key) }), g.keyRec);
    }
    check('G5L', `Show me for a bench, a finger held ${LIFT} px under the ring (off it): the lifted point is on the ring, the preview there has the wish's facing, and the lift builds the bench exactly on the spot with it — nothing under the finger`,
      g.ok && g.fOnCanvas && g.hitP >= 0 && g.hitF < 0 && g.keyF !== g.keyRec && m?.aim?.k === 1 && Math.abs(m.aim.y - g.p.y) <= 1.5 && m.pre?.key === g.keyRec && m.pre.r === (g.rec.r | 0) && m.pre.source === 'hint'
        && after?.placed?.t === 'bench' && after.placed.r === (g.rec.r | 0) && after.benches.length === g.benches + 1,
      { g, m, after });
    await ctx.close();
  }
  {
    const { ctx, page } = await game('clean=1&nosave=1&town=fresh&thumbs=0', { w: 1280, h: 800 });
    const S = (fn, arg) => ev(page, fn, arg);
    const M = page.mouse;
    const HOUSE = String.raw`(x0, z0, roof, bed) => {
      const P = [];
      for (let x = x0; x <= x0 + 3; x++) for (let z = z0; z <= z0 + 2; z++) { P.push({ t: 'foundation', x, y: 0, z }); if (roof === 'flat') P.push({ t: 'roof_flat', x, y: 1, z, h: 0 }); }
      if (roof === 'half') for (let x = x0; x <= x0 + 3; x++) P.push({ t: 'roof_slope', x, y: 1, z: z0, r: 0, h: 0 }, { t: 'roof_slope', x, y: 1, z: z0 + 2, r: 2, h: 0 });
      for (let x = x0; x <= x0 + 3; x++) { P.push({ t: 'wall', a: 'x', x, y: 0, z: z0 }); P.push({ t: x === x0 + 1 ? 'wall_door' : 'wall', a: 'x', x, y: 0, z: z0 + 3 }); }
      for (let z = z0; z <= z0 + 2; z++) { P.push({ t: 'wall', a: 'z', x: x0, y: 0, z }); P.push({ t: 'wall', a: 'z', x: x0 + 4, y: 0, z }); }
      if (bed) P.push({ t: 'bed', x: x0, y: 0, z: z0, r: 1 });
      return P;
    }`;
    const runs = [];
    for (const kind of ['bed', 'roof', 'bench']) {
      const r = await S(async ([HOUSE, kind]) => {
        const s = __s, hw = s.hw, t = hw.town, H = eval(HOUSE);
        hw.state.set({ timeFlow: false, time: 0.42 });
        await t.debug.edit((w) => { w.clear({ record: false }); for (const p of H(-2, -2, kind === 'roof' ? 'half' : 'flat', kind !== 'bed')) w.add(p, { record: false }); });
        t.debug.reset();
        let id = null, home = null;
        if (kind === 'bench') { id = t.debug.spawn('gardener'); t.debug.step(8); t.debug.wish(id, 'w_door_bench'); t.showMe({ villager: id }); } else {
          t.debug.step(2);
          home = t.debug.homes()[0];
          if (!home) return { kind, noHome: true };
          t.showMe({ home: home.id, hint: kind });
        }
        await s.sleep(500);
        const sh = t.showing?.();
        const pl = id ? t.debug.plan(id) : t.debug.sim.planFor({ home: home.id, hint: kind })?.plan;
        const rec = pl?.recs?.[0]?.rec && { ...pl.recs[0].rec };
        if (!rec) return { kind, noRec: true, sh: !!sh };
        if (rec.h === null || rec.h === undefined) rec.h = hw.catalog.getDef(rec.t).layer === 'R' ? s.B.autoRoofHeight(hw.catalog.getDef(rec.t), rec.x, rec.z, rec.r | 0, rec.y | 0) : 0;
        hw.state.set({ rot: ((rec.r | 0) + 1) & 3 });
        const L = s.LY(rec.y | 0) + 0.03;          // a roof: the wall-top plane it settles on
        const cx = (rec.x + 0.5) * 2, cz = (rec.z + 0.5) * 2;
        await s.view([cx, L, cz], hw.rig.goal.theta, kind === 'roof' ? 0.45 : 0.8, 13, 300);
        return { kind, rec: { t: rec.t, x: rec.x, y: rec.y, z: rec.z, r: rec.r, h: rec.h }, p: s.pt(cx, L, cz), auto: s.B.facingAt?.(hw.catalog.getDef(rec.t), rec)?.r };
      }, [HOUSE, kind]);
      if (!r.p) { runs.push(r); continue; }
      await M.move(r.p.x, r.p.y, { steps: 3 }); await wait(200);
      r.hover = await S(() => {
        const s = __s, t = s.B.target, g = s.B.ghost, tg = s.hw.town.debug.actors.render.ghost;
        const ang = g && tg ? +g.getWorldQuaternion(new s.THREE.Quaternion()).angleTo(tg.getWorldQuaternion(new s.THREE.Quaternion())).toFixed(3) : null;
        return t && s.B.ghostVisible ? { r: t.p.r, h: t.p.h, x: t.p.x, z: t.p.z, source: t.facing?.source, ghostAngle: ang } : null;
      });
      await S(() => __s.hw.town.endShowMe());
      await M.move(r.p.x + 1, r.p.y, { steps: 2 }); await wait(200);
      r.after = await S(() => { const t = __s.B.target; return t && { r: t.p.r, source: t.facing?.source }; });
      runs.push(r);
    }
    const good = (r) => r.hover && r.hover.r === (r.rec.r | 0) && r.hover.source === 'hint' && r.hover.x === r.rec.x && r.hover.z === r.rec.z && r.hover.ghostAngle !== null && r.hover.ghostAngle < 0.01
      && (r.kind !== 'roof' || r.hover.h === (r.rec.h | 0)) && r.after?.source && r.after.source !== 'hint';
    check('G5b', 'desktop hover on a Show me ring (a bed hint, a roof hint, a bench wish), the fallback turned away: the preview has the rec\'s facing (and a roof its height), the builder\'s ghost turned like the town\'s; after Show me ends the spot previews its own facing again',
      runs.length === 3 && runs.every(good), runs);
    await ctx.close();
  }
});

// ================================================================================================ H: the lifted aim
// docs/SMART_BUILD.md §6: a touch press and hold previews `lift` px above the finger (the ease starts at the fingertip)
// and lifting places there; quick taps, mouse, pen and Draw strokes are unchanged; the tray, the screen edge and a
// second finger cancel; the setting (and photo mode) turn it off. The expected lift is the spec's formula, worked
// out here from the viewport, not read from the page.
await section('H', async () => {
  // --- on three phones (iPhone 13 portrait, 844 × 390 landscape, a 320 × 568 phone): H1 / H5, H2, H3, H4, H6b;
  // on the iPhone 13 also H6 (the tray), H8 (Draw), H10 (Erase), H9 (the setting)
  for (const [w, h, tag] of [[390, 664, 'iPhone 13'], [844, 390, '844 × 390 landscape'], [320, 568, '320 × 568']]) {
    const LIFT = liftFor(w, h);
    const { ctx, page } = await phone(Q, w, h);
    const T = await touchOf(ctx, page);
    const S = (fn, arg) => ev(page, fn, arg);
    const full = w === 390;
    // H1 / H5: hold, the aim point eases up LIFT px above the finger, the ring is drawn there, the preview is the slot
    // there (not the one under the finger), lifting places it there
    await S(() => __h.scene());
    const P = await S((L) => __h.spot(L), LIFT);
    const keyP = await S((p) => __h.res(p.x, p.y), P), keyL = await S(([p, L]) => __h.res(p.x, p.y - L), [P, LIFT]);
    await S(() => { __h.sample(); __s.hw.rig.__starts = []; const f = __s.hw.rig.onAimStart; __s.hw.rig.onAimStart = function (x, y) { const r = f.call(this, x, y); __s.hw.rig.__starts.push({ x, y, t: performance.now(), target: __h.target() }); return r; }; });
    const m1 = await holdAt(T, page, P, MID);
    const s1 = await S(() => ({ samp: __h.stop(), starts: __s.hw.rig.__starts }));
    const a1 = await S(() => ({ keys: __h.keys(), aim: __h.aim(), ring: __h.ring(), ghost: __s.B.ghostVisible }));
    const H1 = { tag, LIFT, P, keyP, keyL, m1, a1 };
    const id1 = full ? 'H1' : 'H5';
    check(id1, `${tag}: hold 700 ms → the aim point is ${LIFT} px straight above the finger (k 1), the ring is drawn there, the preview is that slot (not the one under the finger); lifting places it there, the ring goes`,
      P.ok && keyP && keyL && keyP !== keyL && m1?.mode === 'aim' && m1.aim?.k === 1 && m1.aim.lift === LIFT && Math.abs(m1.aim.y - (P.y - LIFT)) <= 1 && Math.abs(m1.aim.x - P.x) <= 1
        && !!m1.ring && Math.hypot(m1.ring.x - m1.aim.x, m1.ring.y - m1.aim.y) <= 2 && m1.target === keyL
        && a1.keys.length === 1 && a1.keys[0] === keyL && a1.aim === null && a1.ring === null && !a1.ghost, H1);
    // H2: no jarring jump — the aim starts at the fingertip with the press preview, then glides up frame by frame
    {
      const st = s1.starts?.[0];
      const run = (s1.samp || []).filter((q) => q.mode === 'aim' && q.a);
      const ys = [P.y, ...run.map((q) => q.a.y)];
      const steps = ys.slice(1).map((y, i) => ys[i] - y);
      const at = (ms) => { const q = run.filter((r) => st && r.t - st.t <= ms).pop(); return q ? q.a.y : P.y; };
      const mids = run.filter((q) => q.a.k > 0 && q.a.k < 1);
      const firstRing = run.find((q) => q.ring)?.ring;
      const H2 = { start: st && { x: st.x, y: st.y, target: st.target }, keyP, frames: run.length, easing: mids.length, maxStep: +Math.max(...steps).toFixed(1), y30: at(30), y70: at(70), y150: at(150), end: ys[ys.length - 1], firstRingOpacity: firstRing?.op };
      check('H2', `${tag}: the hold start — the aim begins at the fingertip with the press preview (k 0), then eases up over several frames: never back down, no frame step over 30 px, still rising at +30 ms, samples at +30 / +70 / +150 ms decreasing, the ring fading in`,
        !!st && st.x === P.x && st.y === P.y && st.target === keyP && mids.length >= 2 && steps.every((d) => d >= -0.01) && Math.max(...steps) <= 30
          && H2.y30 >= H2.y70 && H2.y70 >= H2.y150 && H2.y30 > H2.y150 && H2.y30 > H2.end + 5 && Math.abs(H2.end - (P.y - LIFT)) <= 1 && firstRing && firstRing.op < 1, H2);
      // H3: a quick tap at the same point places under the finger — where the hold did not
      await S(() => { __h.scene(); __h.sample(); });
      await T.tap(P, 450);
      const t3 = await S(() => ({ keys: __h.keys(), samp: __h.stop() }));
      check('H3', `${tag}: a quick tap at the same point places under the finger (the hold there placed ${LIFT} px higher); no aim, no ring`,
        t3.keys.length === 1 && t3.keys[0] === keyP && keyP !== H1.a1.keys[0] && t3.samp.every((q) => !q.a && !q.ring), { keyP, held: H1.a1.keys, tapped: t3.keys });
    }
    // H4: near the top bar the aim point stays 6 px under it and leans toward the middle of the screen instead
    {
      await S(() => __h.scene());
      const F = await S(() => __h.topSpot());
      const m4 = await holdAt(T, page, F, () => ({ ...__h.mid(), key: __h.aim() && __h.res(__h.aim().x, __h.aim().y) }));
      const keyF = await S((f) => __h.res(f.x, f.y), F);
      const k4 = await S(() => __h.keys());
      const a = m4?.aim;
      check('H4', `${tag}: a finger 20 px under the top bar → the aim point stays 6 px under it (y ${F.top + 6}), leans ${LIFT} px toward the middle, the ring there; lifting places at that point`,
        F.ok && !!a && a.k === 1 && Math.abs(a.y - (F.top + 6)) <= 1 && a.y >= F.top + 6 - 0.5 && a.x - F.x > LIFT * 0.8 && Math.abs(Math.hypot(a.x - F.x, a.y - F.y) - LIFT) <= 1
          && !!m4.ring && Math.hypot(m4.ring.x - a.x, m4.ring.y - a.y) <= 2 && !!m4.key && k4.length === 1 && k4[0] === m4.key && m4.key !== keyF,
        { F, aim: a, ring: m4?.ring, key: m4?.key, keyF, placed: k4 });
    }
    // H6b: a hold that becomes a pinch cancels cleanly: the ring hides at the second finger, nothing is placed
    await S(() => __h.scene());
    const m7 = await holdAt(T, page, P, MID, { end: false });
    // the second finger on the canvas (a finger on a button — Turn — does not end an aim, by design: E6)
    const Q2 = { ...(await S((p) => [80, -80, 60, -60, 40].map((dx) => ({ x: p.x + dx, y: p.y + 10 })).find((q) => __h.onCanvas(q.x, q.y)) || { x: p.x + 80, y: p.y + 10 }, P)), id: 1 };
    await T.send('touchStart', [{ ...P, id: 0 }, Q2]); await wait(120);
    const m7b = await S(MID);
    const out = Math.sign(Q2.x - P.x) || 1;             // pinch out: the fingers move apart
    for (let i = 1; i <= 6; i++) { await T.send('touchMove', [{ x: P.x - 4 * i * out, y: P.y, id: 0 }, { x: Q2.x + 8 * i * out, y: Q2.y, id: 1 }]); await wait(30); }
    await T.send('touchEnd', []); await wait(450);
    const a7 = await S(() => ({ keys: __h.keys(), aim: __h.aim(), ring: __h.ring(), ghost: __s.B.ghostVisible, mode: __s.hw.rig.mode }));
    check('H6b', `${tag}: a hold that becomes a pinch: the ring (showing) hides as the second finger lands, the aim ends cancelled, the preview goes; nothing is placed`,
      m7?.mode === 'aim' && !!m7.ring && m7b.mode === 'multi' && m7b.aim === null && m7b.ring === null && m7b.target === null && a7.keys.length === 0 && a7.aim === null && a7.ring === null && a7.mode === 'idle',
      { m7, m7b, a7 });
    if (full) {
      // H6: lifting with the aim point over the tray cancels (judged at the aim point, R2): aim.off and no preview while
      // it is there (the ring slips under the tray); nothing placed, the ring and the preview gone
      await S(() => __h.scene());
      const tray = await S((L) => { const r = document.querySelector('.hw-tray').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + L + 40) }; }, LIFT);
      const m6 = await holdAt(T, page, P, MID, { end: false });
      for (let i = 1; i <= 6; i++) { await T.send('touchMove', [{ x: P.x, y: P.y + ((tray.y - P.y) * i) / 6 }]); await wait(30); }
      await wait(250);                                  // pointer moves are coalesced per frame: let the last one land
      const m6b = await S(MID);
      await T.send('touchEnd', []); await wait(450);
      const a6 = await S(() => ({ keys: __h.keys(), aim: __h.aim(), ring: __h.ring(), ghost: __s.B.ghostVisible }));
      const overTray = await S((t) => !__h.onCanvas(t.x, t.y), tray);
      const aimOverTray = await S(([t, L]) => !__h.onCanvas(t.x, t.y - L), [tray, LIFT]);
      check('H6', 'lifting with the ring over the tray cancels: the ring followed the finger (still above it, 40 px into the tray) and showed it would (off, no preview); nothing is placed, the ring, the aim and the preview are gone',
        !!m6?.ring && overTray && aimOverTray && m6b.mode === 'aim' && !!m6b.ring && Math.abs(m6b.aim.y - (tray.y - LIFT)) <= 1 && m6b.aim.off === true && m6b.target === null
          && a6.keys.length === 0 && a6.aim === null && a6.ring === null && !a6.ghost,
        { m6, m6b, a6, tray });
      // H8: Draw mode — a held finger starts a stroke under the finger when it moves (no aim, no ring); with Draw off
      // the same hold aims above the finger
      await S(() => __h.scene('foundation', { drawMode: true }));
      await T.send('touchStart', [P]); await wait(700);
      const m8 = await S(MID);
      for (let i = 1; i <= 8; i++) { await T.send('touchMove', [{ x: P.x + 12 * i, y: P.y }]); await wait(40); }
      await T.send('touchEnd', []); await wait(600);
      const a8 = await S(() => ({ keys: __h.keys(), aim: __h.aim(), ring: __h.ring() }));
      await S(() => __h.scene('foundation', { drawMode: false }));
      await holdAt(T, page, P, null);
      const b8 = await S(() => __h.keys());
      check('H8', 'Draw mode: a held finger never aims (no ring); moving it starts the stroke under the finger; with Draw off the same hold places above the finger',
        m8.mode === 'pending' && m8.aim === null && m8.ring === null && a8.keys.length >= 2 && a8.keys[0] === keyP && a8.ring === null && b8.length === 1 && b8[0] === keyL,
        { m8, stroke: a8.keys, held: b8, keyP, keyL });
      // H10: Erase with an aim removes the piece under the lifted point, not the one under the finger
      const e10 = await S(async ([p, L]) => {
        await __h.scene();
        const B = __s.B, a = B.resolve(p.x, p.y), b = B.resolve(p.x, p.y - L);
        __s.W.add(a.p, { record: false }); __s.W.add(b.p, { record: false });
        __s.hw.state.set({ tool: 'erase' });
        await __s.sleep(200);
        return { under: a.key, lifted: b.key };
      }, [P, LIFT]);
      const m10 = await holdAt(T, page, P, () => ({ ...__h.mid(), hl: __s.B._hl && [...__s.W.entries.values()].find((e) => e.obj === __s.B._hl.obj)?.key }));
      const a10 = await S(() => { const k = __h.keys(); __s.hw.state.set({ tool: 'build' }); return k; });
      check('H10', 'Erase with an aim: the highlight is on the piece under the lifted point, and lifting erases that piece — the one under the finger stays',
        e10.under !== e10.lifted && m10.hl === e10.lifted && a10.length === 1 && a10[0] === e10.under, { e10, hl: m10.hl, left: a10 });
      // H9: the setting — Settings → Preview above your finger (a real tap on its switch) turns the lift off: the aim
      // places under the finger, no ring; it persists over a reload; photo mode turns it off too; on again lifts
      await page.evaluate(() => __s.hw.ui.open('settings'));
      await wait(500);
      const sw = await S(() => { const b = document.querySelector('.hw-switch[data-key="aimLift"]'); if (!b) return null; b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, on: b.getAttribute('aria-checked'), label: b.closest('.hw-set-row')?.textContent }; });
      if (sw) { await wait(250); const r2 = await S(() => { const r = document.querySelector('.hw-switch[data-key="aimLift"]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }); await T.tap(r2, 300); }
      const s9 = await S(() => ({ state: __s.hw.state.aimLift, rig: __s.hw.rig.aimLift, aria: document.querySelector('.hw-switch[data-key="aimLift"]')?.getAttribute('aria-checked') }));
      await S(() => { __s.hw.ui.close(); __s.hw.state.save(); });
      await wait(400);
      await S(() => __h.scene());
      const m9 = await holdAt(T, page, P, MID);
      const k9 = await S(() => __h.keys());
      await page.reload();
      await ready(page);
      const r9 = await S(() => ({ state: __s.hw.state.aimLift, rig: __s.hw.rig.aimLift }));
      await S(() => __h.scene());
      await holdAt(T, page, P, null);
      const k9b = await S(() => __h.keys());
      const ph = await S(async () => { const st = __s.hw.state; st.set({ aimLift: true }); const on = __s.hw.rig.aimLift; st.set({ photoMode: true }); await __s.sleep(150); const photo = __s.hw.rig.aimLift; st.set({ photoMode: false }); await __s.sleep(150); return { on, photo, back: __s.hw.rig.aimLift }; });
      await S(() => __h.scene());
      await holdAt(T, page, P, null);
      const k9c = await S(() => __h.keys());
      await S(() => __s.hw.state.save());
      check('H9', 'Settings → "Preview above your finger": a tap turns it off (state, rig, switch), an aim then places under the finger with no ring; still off after a reload; photo mode turns the lift off; on again it lifts',
        !!sw && /Preview above your finger/.test(sw.label || '') && sw.on === 'true' && s9.state === false && s9.rig === false && s9.aria === 'false'
          && m9?.mode === 'aim' && m9.aim?.lift === 0 && m9.ring === null && k9.length === 1 && k9[0] === keyP
          && r9.state === false && r9.rig === false && k9b.length === 1 && k9b[0] === keyP
          && ph.on === true && ph.photo === false && ph.back === true && k9c.length === 1 && k9c[0] === keyL,
        { sw, s9, m9, k9, r9, k9b, ph, k9c, keyP, keyL });
    }
    await ctx.close();
  }
  // --- H7: mouse and pen are unchanged (a desktop page that also takes touches): a mouse held 700 ms never aims and
  // places under the pointer; a pen hold aims under the tip (lift 0, no ring); a finger held there places above it
  {
    const ctx = await browser.newContext({ viewport: { width: 1024, height: 700 }, deviceScaleFactor: 1, hasTouch: true });
    const page = await ctx.newPage();
    const problems = [];
    page.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !/GPU stall|ReadPixels/.test(m.text())) problems.push(`[${m.type()}] ${m.text()}`); });
    page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`));
    allProblems.push(problems);
    await page.goto(`${base}?${Q}`);
    await ready(page);
    const T = await touchOf(ctx, page);
    const cdp = await ctx.newCDPSession(page);
    const S = (fn, arg) => ev(page, fn, arg);
    const LIFT = liftFor(1024, 700);
    await S(() => __h.scene());
    const P = await S((L) => __h.spot(L), LIFT);
    const keyP = await S((p) => __h.res(p.x, p.y), P), keyL = await S(([p, L]) => __h.res(p.x, p.y - L), [P, LIFT]);
    await page.mouse.move(P.x, P.y);
    await S(() => __h.sample());
    await page.mouse.down(); await wait(900); await page.mouse.up(); await wait(450);
    const mo = await S(() => ({ samp: __h.stop(), keys: __h.keys() }));
    await S(() => __h.scene());
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: P.x, y: P.y, pointerType: 'pen' });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: P.x, y: P.y, button: 'left', clickCount: 1, pointerType: 'pen' });
    await wait(700); await S(() => __h.eased());
    const pen = await S(MID);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: P.x, y: P.y, button: 'left', clickCount: 1, pointerType: 'pen' });
    await wait(450);
    const penKeys = await S(() => __h.keys());
    await S(() => __h.scene());
    const fin = await holdAt(T, page, P, MID);
    const finKeys = await S(() => __h.keys());
    check('H7', `mouse held 900 ms: never an aim, placed under the pointer; a pen hold aims under the tip (lift 0, no ring); a finger held there aims ${LIFT} px above and places there`,
      P.ok && keyP !== keyL && mo.samp.length > 0 && mo.samp.every((q) => q.mode !== 'aim' && !q.a && !q.ring) && mo.keys.length === 1 && mo.keys[0] === keyP
        && pen.mode === 'aim' && pen.aim?.lift === 0 && pen.aim.y === P.y && pen.ring === null && penKeys.length === 1 && penKeys[0] === keyP
        && fin.aim?.lift === LIFT && finKeys.length === 1 && finKeys[0] === keyL,
      { P, keyP, keyL, mouse: { frames: mo.samp.length, modes: [...new Set(mo.samp.map((q) => q.mode))], keys: mo.keys }, pen, penKeys, fin, finKeys });
    await ctx.close();
  }
});

// ================================================================================================ I: the village
await section('I', async () => {
  // a real tap (piece in hand) on a free floor point of a piece's cell, away from the villager on it: tap again turns it
  const VPAGE = String.raw`window.__v = {
    async l2w() { return (await import('/js/town/recipes.js')).localToWorld; },
    /** screen points on the floor of cell (x, z) (local offsets in the piece's frame), none over a villager */
    async spots(x, z, r, offs) {
      const s = __s, l2w = await this.l2w(), out = [];
      for (const [lx, lz] of offs) {
        const [wx, wz] = l2w(x, z, r, lx, lz), p = s.pt(wx, s.LY(0) + 0.02, wz);
        const t = s.at(p);
        if (p.ok && !s.hw.town.hitTest(p.x, p.y) && t && t.key === 'I|' + x + '|0|' + z) out.push(p);
      }
      return out;
    },
  };`;
  // I1 a sleeper's bed turned by a real tap on its foot end: the sleeper lies with the head at the new headboard
  {
    const { ctx, page } = await game('clean=1&nosave=1&town=fresh&thumbs=0', { mobile: true });
    await page.addScriptTag({ content: VPAGE });
    const { tap } = await touchOf(ctx, page);
    const S = (fn, arg) => ev(page, fn, arg);
    const a = await S(async () => {
      const s = __s, hw = s.hw, D = hw.town.debug;
      hw.state.set({ timeFlow: false });
      await D.edit((w) => {
        w.clear({ record: false });
        const P = [...s.house(0, 3, 0, 2, { 'x|1|3': 'wall_door' }), ...s.box('roof_flat', 0, 3, 0, 2, 1), { t: 'bed', x: 1, y: 0, z: 0, r: 0 }];
        for (const p of P) w.add(p, { record: false });
      });
      D.reset();
      D.spawn('gardener', { trait: 'homebody' });
      D.phase('night'); D.step(2); D.sim.reseat(); D.step(2);
      await s.sleep(1000);
      const v = D.sim.villagers[0];
      if (!v) return { noVillager: true };
      hw.state.set({ pieceId: 'bed', tool: 'build', level: 0, seeAll: false, rot: 0 });
      await s.view([3, 0.3, 1.5], 0.3, 0.45, 9, 500);
      const offs = [[0, 0.8], [0.55, 0.8], [-0.55, 0.8], [0.6, 0.55], [-0.6, 0.55]];
      const pts = await __v.spots(1, 0, 0, offs);
      return { id: v.id, bed: v.bed, spot: v._spot, pose: v.plan.pose, at: v.plan.at.map((x) => +x.toFixed(2)), p: pts[0] || null };
    });
    if (a.p) await tap(a.p, 300);
    const b = await S(async (id) => {
      const s = __s, hw = s.hw, D = hw.town.debug, l2w = await __v.l2w();
      let out = null;
      for (let i = 0; i < 20; i++) {
        D.step(1); await s.sleep(150);
        const v = D.sim.villagers.find((u) => u.id === id), bed = s.get('I|1|0|0');
        const [wx, wz] = l2w(1, 0, bed.r | 0, 0, -0.1);
        out = { r: bed.r, pose: v.plan.pose, spot: v._spot, at: v.plan.at.map((x) => +x.toFixed(2)), want: [+wx.toFixed(2), +wz.toFixed(2)], off: +Math.hypot(v.plan.at[0] - wx, v.plan.at[2] - wz).toFixed(3) };
        if (out.r === 1 && out.off < 0.05) break;
      }
      return out;
    }, a.id);
    check('I1', 'a sleeper\'s bed turned by a real tap on its foot end (bed in hand): within 3 s the sleeper lies in it with the head at the new headboard (within 5 cm)',
      !!a.p && a.pose === 'sleep' && /^bed\|1\|0\|0/.test(a.spot || '') && b?.r === 1 && b.pose === 'sleep' && b.off < 0.05, { a: { ...a, p: !!a.p }, b });
    await ctx.close();
  }
  // I2 a sitter's dining chair turned by a real tap: within 3 s they sit on its new seat (CHAIR_SEAT_Z of its tuck)
  {
    const { ctx, page } = await game('bp=cottage&nosave=1&town=fresh&townseed=10&thumbs=0', { mobile: true });
    await page.addScriptTag({ content: VPAGE });
    const { tap } = await touchOf(ctx, page);
    const S = (fn, arg) => ev(page, fn, arg);
    const a = await S(async () => {
      const s = __s, hw = s.hw, D = hw.town.debug;
      await s.sleep(2000);
      hw.world.add({ t: 'bed', x: 2, y: 0, z: 1, r: 1, m: 'wood' });
      await s.sleep(500);
      D.spawn('gardener'); D.spawn('baker');
      hw.state.set({ timeFlow: true, time: 0.74 });
      let hit = null;
      for (let k = 0; k < 1500 && !hit; k++) {
        D.step(1);
        const v = D.sim.villagers.find((u) => u.plan?.kind === 'inside' && /^seat\|chair\|/.test(u._spot || '') && u.plan.t1 - D.state().clock > 40);
        if (v) hit = v;
      }
      hw.state.set({ timeFlow: false });
      if (!hit) return { hit: null };
      const [, , x, y, z] = hit._spot.split('|').map((q, i) => (i >= 2 && i <= 4 ? +q : q));
      const chair = s.get('I|' + x + '|' + y + '|' + z);
      hw.state.set({ pieceId: 'chair', tool: 'build', level: 0, seeAll: false, rot: chair.r | 0 });
      await s.view([(x + 0.5) * 2, 0.3, (z + 0.5) * 2], hw.rig.goal.theta, 0.45, 8, 600);
      const pts = await __v.spots(x, z, chair.r | 0, [[0.75, -0.75], [-0.75, -0.75], [0.75, 0.75], [-0.75, 0.75], [0.8, 0], [-0.8, 0], [0, -0.8]]);
      return { hit: { id: hit.id, spot: hit._spot, at: hit.plan.at.map((q) => +q.toFixed(2)) }, chair, p: pts[0] || null };
    });
    if (a.p) await tap(a.p, 300);
    const b = a.hit && await S(async ([id, c]) => {
      const s = __s, hw = s.hw, D = hw.town.debug, l2w = await __v.l2w(), cfg = await import('/js/config.js');
      let out = null;
      for (let i = 0; i < 20; i++) {
        await s.sleep(150);
        const v = D.sim.villagers.find((u) => u.id === id), ch = s.get('I|' + c.x + '|' + c.y + '|' + c.z);
        const lz = cfg.CHAIR_SEAT_Z[cfg.chairTuck(ch, (x, y, z) => hw.world.get(cfg.K.I(x, y, z)) || null)];
        const [wx, wz] = l2w(c.x, c.z, ch.r | 0, 0, lz);
        out = { r: ch.r, spot: v._spot, pose: v.plan.pose, at: v.plan.at.map((q) => +q.toFixed(2)), want: [+wx.toFixed(2), +wz.toFixed(2)], off: +Math.hypot(v.plan.at[0] - wx, v.plan.at[2] - wz).toFixed(3) };
        if (out.r !== c.r && out.off < 0.06) break;
      }
      return out;
    }, [a.hit.id, a.chair]);
    check('I2', 'a sitter\'s dining chair turned by a real tap (chair in hand, on a free corner of its cell): within 3 s they sit on the chair\'s new seat (its CHAIR_SEAT_Z for the new tuck, within 6 cm)',
      !!a.hit && !!a.p && b?.r !== (a.chair.r | 0) && b.spot === a.hit.spot && b.pose === 'sit' && b.off < 0.06, { a: { ...a, p: !!a?.p }, b });
    await ctx.close();
  }
  // I3 a range turned (a real tap) from facing the wall to facing the room: the cook's stand-by spot moves in front of it
  {
    const { ctx, page } = await game('clean=1&nosave=1&town=fresh&thumbs=0', { mobile: true });
    await page.addScriptTag({ content: VPAGE });
    const { tap } = await touchOf(ctx, page);
    const S = (fn, arg) => ev(page, fn, arg);
    const a = await S(async () => {
      const s = __s, hw = s.hw, D = hw.town.debug;
      hw.state.set({ timeFlow: false });
      // a home whose range at (0, 0) faces the west wall (r 3); one more turn faces it into the room (r 0)
      await D.edit((w) => {
        w.clear({ record: false });
        const P = [...s.house(0, 3, 0, 2, { 'x|1|3': 'wall_door' }), ...s.box('roof_flat', 0, 3, 0, 2, 1), { t: 'bed', x: 3, y: 0, z: 0, r: 0 }, { t: 'kitchen_range', x: 0, y: 0, z: 0, r: 3 }];
        for (const p of P) w.add(p, { record: false });
      });
      D.reset();
      D.spawn('baker');
      hw.state.set({ timeFlow: true, time: 0.3 });
      let hit = null;
      for (let k = 0; k < 2400 && !hit; k++) { D.step(1); const v = D.sim.villagers.find((u) => /^by\|0\|0\|0\|/.test(u._spot || '') && u.plan.t1 - D.state().clock > 40); if (v) hit = v; }
      hw.state.set({ timeFlow: false });
      hw.state.set({ pieceId: 'kitchen_range', tool: 'build', level: 0, seeAll: false, rot: 3 });
      await s.view([1, 0.3, 1], 0.6, 0.45, 8, 600);
      const pts = await __v.spots(0, 0, 3, [[0.75, -0.75], [-0.75, -0.75], [0, -0.8], [0.8, 0], [-0.8, 0]]);
      return { hit: hit && { id: hit.id, spot: hit._spot, at: hit.plan.at.map((q) => +q.toFixed(2)) }, p: pts[0] || null };
    });
    if (a.p) await tap(a.p, 300);
    const b = a.hit && await S(async (id) => {
      const s = __s, hw = s.hw, D = hw.town.debug, l2w = await __v.l2w();
      let out = null;
      for (let i = 0; i < 20; i++) {
        await s.sleep(150);
        const v = D.sim.villagers.find((u) => u.id === id), rg = s.get('I|0|0|0');
        const k = +(String(v._spot || '').split('|')[4] || 0), [wx, wz] = l2w(0, 0, rg.r | 0, [0, -0.55, 0.55][k] ?? 0, 0.75);
        out = { r: rg.r, spot: v._spot, at: v.plan.at.map((q) => +q.toFixed(2)), want: [+wx.toFixed(2), +wz.toFixed(2)], off: +Math.hypot(v.plan.at[0] - wx, v.plan.at[2] - wz).toFixed(3) };
        if (out.r === 0 && /^by\|0\|0\|0\|/.test(out.spot || '') && out.off < 0.05) break;
      }
      return out;
    }, a.hit.id);
    check('I3', 'a range facing the wall, its cook standing at it: a real tap turns it to face the room, and within 3 s the cook\'s stand-by spot is in front of it (within 5 cm)',
      !!a.hit && !!a.p && b?.r === 0 && /^by\|0\|0\|0\|/.test(b.spot || '') && b.off < 0.05 && Math.hypot(b.at[0] - a.hit.at[0], b.at[2] - a.hit.at[2]) > 0.5, { a: { ...a, p: !!a?.p }, b });
    await ctx.close();
  }
});

// ================================================================================================ J: cost
await section('J', async () => {
  const { ctx, page } = await game('bp=farmhouse&nosave=1&town=0&thumbs=0', { w: 1280, h: 800 });
  const r = await page.evaluate(async () => {
    const s = __s, hw = s.hw, B = s.B, W = s.W;
    hw.state.set({ seeAll: true, level: 0, tool: 'build' });
    await s.sleep(500);
    if (typeof B.facingAt !== 'function' || typeof B._auto !== 'function') return { missing: true };
    let seed = 99; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const defs = hw.catalog.allDefs().filter((d) => d.rot !== 'none' && !d.hidden);
    const el = hw.renderer.domElement;
    // J1 the facing itself: 2,000 random spots (piece, screen point → resolve's slot), each timed over 10 calls
    const per = [];
    for (let i = 0; per.length < 2000 && i < 6000; i++) {
      const def = defs[Math.floor(rnd() * defs.length)];
      hw.state.set({ pieceId: def.id });
      const t = B.resolve(rnd() * el.clientWidth, rnd() * el.clientHeight);
      if (!t || !t.facing || t.facing.source !== 'auto') continue;
      const t0 = performance.now();
      for (let k = 0; k < 10; k++) B.facingAt(def, t.p, { roofLevel: t.p.y, lift: 0 });
      per.push((performance.now() - t0) / 10);
    }
    per.sort((a, b) => a - b);
    const q = (a, f) => a[Math.min(a.length - 1, Math.floor(a.length * f))];
    // J2 resolve() with the facing vs without it (autoFacing stubbed to the fallback), the memo cleared each call
    const pts = Array.from({ length: 400 }, () => [defs[Math.floor(rnd() * defs.length)].id, rnd() * el.clientWidth, rnd() * el.clientHeight]);
    const run = () => {
      const out = [];
      for (const [id, x, y] of pts) {
        hw.state.set({ pieceId: id });
        const t0 = performance.now();
        for (let k = 0; k < 5; k++) { B._memo = null; B.resolve(x, y); }
        out.push((performance.now() - t0) / 5);
      }
      return out.sort((a, b) => a - b);
    };
    const auto = B._auto, stub = function (def, p) { return { r: hw.state.rot & 3, rule: null, tie: false, fallback: true }; };
    run();                                                    // warm up
    // three alternating batches each, the lowest median of each kind (the page timer is coarse: one batch's median
    // moves by a quantum or two from run to run, enough to swing the ratio past 1.5 either way)
    const withF = [], without = [];
    for (let rep = 0; rep < 3; rep++) { B._auto = auto; withF.push(q(run(), 0.5)); B._auto = stub; without.push(q(run(), 0.5)); }
    B._auto = auto;
    return { n: per.length, median: +q(per, 0.5).toFixed(4), p99: +q(per, 0.99).toFixed(4), max: +per[per.length - 1].toFixed(3),
      resolveWith: +Math.min(...withF).toFixed(4), resolveWithout: +Math.min(...without).toFixed(4), batches: { withF, without }, pieces: W.count };
  });
  check('J1', 'facing cost over 2,000 random spots on the farmhouse: median ≤ 0.1 ms, p99 ≤ 1 ms per call', !r.missing && r.n === 2000 && r.median <= 0.1 && r.p99 <= 1, r);
  check('J2', 'resolve() median with the facing ≤ 1.5 × without it (the lowest of three alternating batches each)', !r.missing && r.resolveWith <= 1.5 * r.resolveWithout, { with: r.resolveWith, without: r.resolveWithout, batches: r.batches });
  await ctx.close();
});

// ================================================================================================ R: repair round 1
// The verifiers' findings, reproduced with real touches: S1.1 a tall piece on a window wall (the hand build), S1.2 the
// lifted aim with the finger on the tray, a tap on top of a piece in the open, tap again on stairs and a roof slope, a
// finished blueprint piece tapped in guided mode, porch steps in the open meadow; repair round 2: S2.4 the window spot
// with a table or counter in front (R7), S2.2 tap again once the room has changed round a piece (R8).
await section('R', async () => {
  // --- R1 (S1.1) a Cook Stove tapped on a window wall, a wall one cell to its side / beside a corner bookshelf
  {
    const { ctx, page } = await game(Q, { mobile: true });
    const { tap } = await touchOf(ctx, page);
    const S = (fn, arg) => ev(page, fn, arg);
    const got = [];
    for (const sc of [
      { name: 'the hand build: a 6 × 4 house, a Window behind cell (1, −2), the right wall a cell to its side', x: 1, z: -2, list: 'a' },
      { name: 'a 4 × 3 room, Windows behind (−1, −1) and (0, −1), a bookshelf in the corner (−2, −1)', x: -1, z: -1, list: 'b' },
    ]) {
      await S(async (sc) => {
        const s = __s;
        const list = sc.list === 'a' ? s.house(-3, 2, -2, 1, { 'x|1|-2': 'wall_window' })
          : [...s.house(-2, 1, -1, 1, { 'x|-1|-1': 'wall_window', 'x|0|-1': 'wall_window' }), { t: 'bookshelf', x: -2, y: 0, z: -1, r: 0 }];
        s.load(list, { pieceId: 'kitchen_range', rot: 0, seeAll: false });
        await s.view([sc.x * 2 + 1, 0.5, sc.z * 2 + 2], 0.5, 0.8, 12);
      }, sc);
      const p = await S((sc) => __s.cell(sc.x, sc.z), sc);
      const pre = await S((p) => __s.at(p), p);
      await tap(p, 450);
      const q = await S((sc) => __s.get(__s.I(sc.x, 0, sc.z)), sc);
      got.push({ name: sc.name, ok: p.ok, pre: pre && { key: pre.key, r: pre.r }, r: q?.r, t: q?.t });
    }
    check('R1', 'S1.1: a Cook Stove tapped onto a window wall — with the side wall a cell away (the hand build) and beside a corner bookshelf — stands with its back to its own window (r 0), never its back to open floor or the bookshelf',
      got.every((g) => g.ok && g.t === 'kitchen_range' && g.r === 0), got);
    // --- R3 (low) a tap on the top of a sofa standing in the open, the sofa in hand: it turns, nothing is placed behind
    await S(async () => { const s = __s; s.load([...s.house(-4, 2, -3, 2), { t: 'sofa', x: -1, y: 0, z: 0, r: 1 }], { pieceId: 'sofa', rot: 0 }); await s.view([-1, 0.5, 0], Math.PI / 4, 1.0, 14); });
    const top = await S(() => {
      // points on the sofa whose floor point is the empty cell next to it (the backrest's top): the highest one
      const s = __s, B = s.B, out = [];
      const e = s.W.entry('I|-1|0|0'), bb = new s.THREE.Box3().setFromObject(e.obj);
      for (let i = 0; i <= 20; i++) for (let j = 0; j <= 20; j++) {
        const X = bb.min.x + (bb.max.x - bb.min.x) * i / 20, Z = bb.min.z + (bb.max.z - bb.min.z) * j / 20;
        const p = s.pt(X, bb.max.y - 0.04, Z);
        if (!p.ok) continue;
        const pk = B.pickPiece(p.cx, p.cy), hit = B.rayPlane(p.cx, p.cy, s.LY(0));
        if (!pk || pk.entry.key !== 'I|-1|0|0' || !hit) continue;
        const cx = Math.floor(hit.x / 2), cz = Math.floor(hit.z / 2);
        if ((cx !== -1 || cz !== 0) && !s.W.get(s.I(cx, 0, cz))) out.push({ ...p, under: [cx, cz] });
      }
      out.sort((a, b) => a.y - b.y);
      return out[0] || null;
    });
    const t0 = await S(() => ({ n: __s.W.count, u: __s.undos(), q: __s.get('I|-1|0|0') }));
    const pre3 = top && await S((p) => __s.at(p), top);
    if (top) await tap(top, 450);
    const t1 = await S(() => ({ n: __s.W.count, u: __s.undos(), q: __s.get('I|-1|0|0') }));
    check('R3', 'a real tap on the top of a sofa standing in the open (its floor point the empty cell behind it), the sofa in hand: the sofa turns (one undo step), no second sofa behind it',
      !!top && pre3?.action === 'turn' && pre3.key === 'I|-1|0|0' && t1.n === t0.n && t1.u === t0.u + 1 && t1.q?.r !== t0.q?.r && t1.q?.r === pre3.r, { top, pre3, t0, t1 });
    // --- R4 (low) tap again goes to the next most likely facing: stairs along the back wall → the other way along it;
    // a roof slope on the front eave → the other side of the ridge (one tap, not two through a broken middle)
    await S(async () => {
      const s = __s;
      s.load([...s.house(-3, 2, -2, 1), ...s.box('floor', -3, 2, -2, 1, 1).filter((q) => !(q.x === -1 && q.z === -2))], { pieceId: 'stairs', rot: 0 });
      await s.view([0, 0.5, 0], 0.55, 0.85, 14);
    });
    const st = await S(() => __s.cell(-1, -2, 0, 0, 0, 0.3));
    await tap(st, 450);
    const st0 = await S(() => __s.get(__s.I(-1, 0, -2)));
    const stPre = await S((p) => __s.at(p), st);
    await tap(st, 450);
    const st1 = await S(() => __s.get(__s.I(-1, 0, -2)));
    await S(async () => { const s = __s; s.load([...s.house(-3, 2, -2, 1)], { pieceId: 'roof_slope', rot: 0 }); await s.view([0, 2.5, 4], 0.3, 0.7, 18); });
    const rf = await S(() => __s.pt(1, __s.LY(1) + 0.05, 4 - 0.2));
    await tap(rf, 450);
    const rf0 = await S(() => [...__s.W.entries.values()].filter((e) => e.def.layer === 'R').map((e) => ({ key: e.key, x: e.p.x, z: e.p.z, r: e.p.r, h: e.p.h })));
    const rp = rf0[0] && await S((k) => { const s = __s, e = s.W.entry(k), c = e.obj.position; return s.pt(c.x, c.y + 0.45, c.z + 0.3); }, rf0[0].key);
    if (rp) await tap(rp, 450);
    const rf1 = await S(() => [...__s.W.entries.values()].filter((e) => e.def.layer === 'R').map((e) => ({ key: e.key, x: e.p.x, z: e.p.z, r: e.p.r, h: e.p.h })));
    check('R4', 'tap again: stairs placed along the back wall (climbing one way along it) turn with one tap to climb the other way along it (r 1 ↔ 3); a roof slope on the front eave (r 2) turns with one tap to the other side of the ridge (r 0)',
      !!st0 && (st0.r === 1 || st0.r === 3) && stPre?.action === 'turn' && st1?.r === (st0.r ^ 2) && rf0.length === 1 && rf0[0].z === 1 && rf0[0].r === 2 && rf1.length === 1 && rf1[0].x === rf0[0].x && rf1[0].z === 1 && rf1[0].r === 0,
      { st0, stPre, st1, rf0, rf1, rp: !!rp });
    // --- R6 (low) porch steps tapped in the open meadow take the facing the player last chose (D4), like everything else
    await S(async () => { const s = __s; s.load([], { pieceId: 'steps', rot: 1 }); await s.view([0, 0.3, 0], 0.7, 0.9, 16); });
    const sp = await S(() => __s.cell(0, 0));
    const spPre = await S((p) => __s.at(p), sp);
    await tap(sp, 450);
    const spq = await S(() => __s.get('F|0|0|0'));
    check('R6', 'porch steps tapped in the open meadow (state.rot 1, the camera on the other side): they take the facing the player last chose (r 1), the preview says it is the fallback',
      spq?.t === 'steps' && spq.r === 1 && spPre?.fallback === true, { spPre, spq });
    // --- R7 (repair round 2, S2.4) the S1.1 spot with something in front: a Farmhouse Table or a Kitchen Counter at
    // (1, −1), then a Cook Stove or a Wardrobe tapped at (1, −2) — still its back to its own window (r 0)
    const got7 = [];
    for (const sc of [{ front: 'table', t: 'kitchen_range' }, { front: 'kitchen_counter', t: 'kitchen_range' }, { front: 'table', t: 'wardrobe' }]) {
      await S(async (sc) => {
        const s = __s;
        s.load([...s.house(-3, 2, -2, 1, { 'x|1|-2': 'wall_window' })], { pieceId: sc.front, rot: 0, seeAll: false });
        await s.view([3, 0.5, -2], 0.5, 0.7, 12);
      }, sc);
      const pf = await S(() => __s.cell(1, -1));
      await tap(pf, 450);
      await S((t) => __s.hw.state.set({ pieceId: t }), sc.t);
      const p = await S(() => __s.cell(1, -2));
      const pre = await S((p) => __s.at(p), p);
      await tap(p, 450);
      const q = await S(() => ({ f: __s.get(__s.I(1, 0, -1)), q: __s.get(__s.I(1, 0, -2)) }));
      got7.push({ want: sc.front, piece: sc.t, ok: p.ok && pf.ok, pre: pre && { key: pre.key, r: pre.r, source: pre.source }, front: q.f?.t, r: q.q?.r, t: q.q?.t });
    }
    check('R7', 'S2.4: a Farmhouse Table (or a Kitchen Counter) tapped in front of the S1.1 window spot, then a Cook Stove (or a Wardrobe) tapped onto the window spot (1, −2): it stands with its back to its own window (r 0), not sideways with its back to open floor',
      got7.length === 3 && got7.every((g) => g.ok && g.front === g.want && g.t === g.piece && g.r === 0 && g.pre?.key === 'I|1|0|-2' && g.pre.r === 0), got7);
    // --- R8 (repair round 2, S2.2) the room changes round a placed piece, then tap again: the first tap turns it to the
    // facing the rules now prefer (one tap, not three through two wrong ones), more taps go round all four
    // (room x −3..1, z −2..1: a bed in the back-left corner facing r 1, then a Nightstand tapped beside its foot; an
    // armchair against the front wall facing r 2, then a Stone Fireplace tapped onto the left wall; a chair against the
    // front wall facing r 2, then a Farmhouse Table tapped beside it)
    const got8 = [];
    for (const sc of [
      { t: 'bed', at: [-3, -2], r0: 1, add: 'nightstand', addAt: [-2, -2], want: 0, view: [[-2, 0.5, -1], 0.45, 0.75, 13] },
      { t: 'armchair', at: [-1, 1], r0: 2, add: 'fireplace', addAt: [-3, 0], want: 3, view: [[-2.6, 0.5, 2], Math.PI, 0.7, 13] },
      { t: 'chair', at: [-1, 1], r0: 2, add: 'table', addAt: [0, 1], want: 1, view: [[-1, 0.5, 1], Math.PI + 0.45, 0.75, 13] },
    ]) {
      await S(async (sc) => {
        const s = __s;
        s.load([...s.house(-3, 1, -2, 1), { t: sc.t, x: sc.at[0], y: 0, z: sc.at[1], r: sc.r0 }], { pieceId: sc.add, rot: 0, seeAll: false });
        await s.view(...sc.view);
      }, sc);
      const pa = await S((c) => __s.cell(c[0], c[1]), sc.addAt);
      await tap(pa, 450);
      const added = await S((c) => __s.get(__s.I(c[0], 0, c[1])), sc.addAt);
      await S((t) => __s.hw.state.set({ pieceId: t }), sc.t);
      const p = await S((c) => __s.cell(c[0], c[1]), sc.at);
      const best = await S(({ t, c }) => __s.B.facingAt(t, { t, x: c[0], y: 0, z: c[1] }), { t: sc.t, c: sc.at });
      const u0 = await S(() => __s.undos()), n0 = await S(() => __s.W.count);
      const pre = await S((p) => __s.at(p), p);
      const seq = [];
      for (let i = 0; i < 4; i++) { await tap(p, 450); seq.push(await S((c) => __s.get(__s.I(c[0], 0, c[1]))?.r, sc.at)); }
      const end = await S(({ c, a }) => ({ n: __s.W.count, u: __s.undos(), q: __s.get(__s.I(c[0], 0, c[1])), added: __s.get(__s.I(a[0], 0, a[1])) }), { c: sc.at, a: sc.addAt });
      got8.push({ t: sc.t, ok: pa.ok && p.ok, added: added && { t: added.t, r: added.r }, order: best?.order, want: sc.want, pre: pre && { key: pre.key, r: pre.r, action: pre.action }, seq, du: end.u - u0, dn: end.n - n0 });
    }
    check('R8', 'S2.2: a bed in a corner then a nightstand beside its foot, an armchair then a fireplace, a chair then a table — tap again (the piece in hand) turns it to the facing the rules now prefer with ONE tap (bed r 0, armchair r 3 facing the fire, chair r 1 facing the table), three more taps go round the other three facings (one undo step each, nothing placed)',
      got8.length === 3 && got8.every((g) => g.ok && !!g.added && g.order?.[0] === g.want && g.pre?.action === 'turn' && g.pre.r === g.want && g.seq[0] === g.want
        && new Set(g.seq).size === 4 && g.seq.join() === g.order.join() && g.du === 4 && g.dn === 0),
      got8);
    await ctx.close();
  }
  // --- R2 (S1.2) the lifted aim with the finger on the tray: the ring over the view places there; the ring over the tray
  // cancels — with a dashed ring and no preview before the lift (iPhone 13 portrait, a 320 × 568 phone, 844 × 390)
  for (const [w, h, tag] of [[390, 664, 'iPhone 13'], [320, 568, '320 × 568'], [844, 390, '844 × 390 landscape']]) {
    const LIFT = liftFor(w, h);
    const { ctx, page } = await phone(Q, w, h);
    const T = await touchOf(ctx, page);
    const S = (fn, arg) => ev(page, fn, arg);
    await S(() => __h.scene());
    const tr = await S(() => { const r = document.querySelector('.hw-tray').getBoundingClientRect(); return { top: Math.round(r.top), left: Math.round(r.left), right: Math.round(r.right) }; });
    // a column where the hold point and its lifted point are on the view, F1 on the tray with its lifted point on the
    // view, F2 and its lifted point both on the tray (the verifier's x 131 where it fits)
    const X = await S(([tr, L]) => {
      const fits = (x) => __h.onCanvas(x, tr.top - 20) && __h.onCanvas(x, tr.top - 20 - L) && !__h.onCanvas(x, tr.top + 24) && __h.onCanvas(x, tr.top + 24 - L)
        && !__h.onCanvas(x, tr.top + L + 14) && !__h.onCanvas(x, tr.top + 14);
      if (fits(131)) return 131;
      for (let x = tr.left + 30; x <= tr.right - 30; x += 6) if (fits(x)) return x;
      return null;
    }, [tr, LIFT]);
    const P = { x: X ?? 131, y: tr.top - 20 };
    const F1 = { x: P.x, y: tr.top + 24 }, F2 = { x: P.x, y: tr.top + LIFT + 14 };
    const look = () => S(() => {
      const ring = document.querySelector('.hw-aim-ring'), a = __s.hw.rig.aim;
      return { aim: a && { x: a.x, y: a.y, k: a.k, off: a.off }, ring: __h.ring(), dashed: !!ring && ring.style.borderStyle === 'dashed', ghost: !!__s.B.ghostVisible, target: __h.target(), mode: __s.hw.rig.mode };
    });
    const slide = async (from, to) => { for (let i = 1; i <= 6; i++) { await T.send('touchMove', [{ x: from.x + ((to.x - from.x) * i) / 6, y: from.y + ((to.y - from.y) * i) / 6 }]); await wait(30); } await wait(250); };
    // a: the finger slides onto the tray, the ring stays over the grass → lifting places at the ring
    await S(() => __h.scene());
    const ok = await S(([P, F1, F2, L]) => ({ P: __h.onCanvas(P.x, P.y), Paim: __h.onCanvas(P.x, P.y - L), F1tray: !__h.onCanvas(F1.x, F1.y), F1aim: __h.onCanvas(F1.x, F1.y - L), F2tray: !__h.onCanvas(F2.x, F2.y), F2aim: !__h.onCanvas(F2.x, F2.y - L) }), [P, F1, F2, LIFT]);
    await holdAt(T, page, P, null, { end: false });
    await slide(P, F1);
    const a1 = await look();
    const want1 = await S(([x, y]) => __h.res(x, y), [F1.x, F1.y - LIFT]);
    await T.send('touchEnd', []); await wait(450);
    const k1 = await S(() => __h.keys());
    // b: the finger slides further, until the ring is over the tray too → a dashed ring, no preview; lifting cancels
    await S(() => __h.scene());
    await holdAt(T, page, P, null, { end: false });
    await slide(P, F2);
    const a2 = await look();
    await T.send('touchEnd', []); await wait(450);
    const k2 = await S(() => ({ keys: __h.keys(), ring: __h.ring(), aim: __h.aim(), ghost: __s.B.ghostVisible }));
    check(w === 390 ? 'R2' : 'R2b', `S1.2 ${tag}: held ${tr.top - P.y} px above the tray, the finger slid onto the tray (${F1.y - tr.top} px in) with the ring still over the grass — the preview is the ring's slot and lifting places it there; slid ${F2.y - tr.top} px in, the ring over the tray turns dashed, the preview hides, and lifting places nothing`,
      Object.values(ok).every(Boolean) && a1.mode === 'aim' && a1.aim?.off === false && !!a1.ring && !a1.dashed && a1.ghost && !!want1 && a1.target === want1 && Math.abs(a1.aim.y - (F1.y - LIFT)) <= 1
        && k1.length === 1 && k1[0] === want1
        && a2.mode === 'aim' && a2.aim?.off === true && !!a2.ring && a2.dashed && !a2.ghost && k2.keys.length === 0 && k2.ring === null && k2.aim === null && !k2.ghost,
      { tag, LIFT, tray: tr, X, P, F1, F2, ok, a1, want1, k1, a2, k2 });
    await ctx.close();
  }
  // --- R5 (low) guided mode: a tap on a finished blueprint piece with its part in hand says it follows the blueprint
  // (a click and the toast; nothing changes), and Turn right after says the same — not the generic hint
  {
    const { ctx, page } = await game(Q, { mobile: true });
    const { tap } = await touchOf(ctx, page);
    const S = (fn, arg) => ev(page, fn, arg);
    const g = await S(async () => {
      const s = __s, bp = s.hw.blueprints;
      s.load([]); bp.startGuided('cottage'); await s.sleep(400);
      const b = bp.get('cottage');
      for (const it of b._items) if (['foundation', 'walls'].includes(it.stage) && !s.W.get(it.key)) s.W.add(it.p, { record: false });
      await s.sleep(800);                                 // the guides move on to the next stage (and its piece)
      const it = b._items.find((x) => x.p.t === 'wall' && x.p.y === 0 && (x.p.r | 0) === 0);
      const colors = { ...s.hw.state.colors };            // the wall's own look in hand: material and colour
      if (it.p.c) colors[it.p.m] = it.p.c; else delete colors[it.p.m];
      s.hw.state.set({ pieceId: 'wall', rot: 2, level: 0, seeAll: true, mats: { ...s.hw.state.mats, wall: it.p.m }, colors });
      const q = it.p, c = q.a === 'x' ? [(q.x + 0.5) * 2, 1.3, q.z * 2] : [q.x * 2, 1.3, (q.z + 0.5) * 2];
      await s.view(c, s.hw.rig.goal.theta, 1.0, 12, 250);
      s.log.toast.length = 0; s.log.sfx.length = 0;
      const pv = s.at(s.pt(...c));
      return { key: it.key, rec: s.get(it.key), p: s.pt(...c), v: s.W.version, inHand: s.hw.state.pieceId, pv };
    });
    await tap(g.p, 450);
    const g1 = await S((k) => ({ rec: __s.get(k), v: __s.W.version, toast: __s.log.toast.slice(), sfx: __s.log.sfx.slice() }), g.key);
    await S(() => { __s.log.toast.length = 0; });
    const b = await S(() => { const e = document.querySelector('.hw-rot'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    if (b) await tap(b, 450);
    const g2 = await S((k) => ({ rec: __s.get(k), v: __s.W.version, toast: __s.log.toast.slice() }), g.key);
    const BP = /follows the blueprint/;
    check('R5', 'guided cottage: a real tap on a finished blueprint wall with the wall in hand changes nothing and says "✨ This one follows the blueprint" (with a click); the Turn button right after says the same, not the generic hint',
      !!g.rec && g.inHand === 'wall' && g.pv?.key === g.key && g.pv.source === 'blueprint' && g.pv.r === g.rec.r
        && JSON.stringify(g1.rec) === JSON.stringify(g.rec) && g1.v === g.v && g1.toast.some((t) => BP.test(t)) && g1.sfx.includes('click')
        && !!b && JSON.stringify(g2.rec) === JSON.stringify(g.rec) && g2.v === g.v && g2.toast.some((t) => BP.test(t)) && !g2.toast.some((t) => /Tap a piece you placed/.test(t)),
      { g: { key: g.key, ok: g.p.ok, inHand: g.inHand, pv: g.pv }, g1, g2, btn: !!b });
    await ctx.close();
  }
});

// ================================================================================================ K and the summary
await section('K', async () => {
  const flat = allProblems.flat();
  check('K', 'no console errors or page errors in any page', flat.length === 0, flat.slice(0, 6));
});
await browser.close();
server.close();
console.log(`\nsmart-regress: ${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
