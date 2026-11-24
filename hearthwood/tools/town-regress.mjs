#!/usr/bin/env node
// Hearthwood Living Town end-to-end regression (docs/LIVING.md §13.4, WP4). Run: node tools/town-regress.mjs
// (several minutes headless; prints PASS / FAIL / SKIP per check and exits 1 on any FAIL).
//   --batch   also runs tools/batch-regress.mjs twice (R13: town=0 and HW_TOWN=1; about 15 minutes more)
//   --only=a,b   run only these sections (params, spine, off, settings, crash, importfail, autosave, parts, offline,
//                blueprints, homes, arrival, evict, stuck, budget, determinism, passerby, showme, gifts, share, photo,
//                villageoff, guided, persist, taps, migration, twotabs, watch, repair1, repair2, feel)
// M0: the spine — boot / ready / restore recompute (R1), the TownAPI and debug shape, params, enabled(), clocks,
// recompute scheduling, rig pass-through, failure isolation, an import failure (R5's last case), the core edits
// (state keys, env exports, catalog.setHidden, the autosave guard) and R13.
// M1 (the vertical slice): R2 homes and recipes per blueprint, R3 the first traveller and move-in, R6 never evict, R7
// never stuck, R11 the PERF_TOWN budget, R12 determinism, R14 offline (sw.js, done early), R17 the passer-by on a phone,
// and every blueprint booting with the town on.
// M2: R4 the first wish, Show me and taps on the ring / ghost (+ the four variants), R5 gifts, R8 guided mode, R9 photo
// mode, R10 persistence, R15 share codes and Pick with gift pieces, R16 villagers off / on, R18 taps near villagers, R19
// the migration intro card, R20 two tabs, R21 life you can watch (+ nobody in bed or night-strolling at 10:00), and a
// `feel` section (sleepers lie with the head at the headboard). Repair rounds: `repair1` (T1.x) and `repair2` (T2.x:
// a Show me ghost never claims every tap, the camp tip toast never covers the camp bubble, the tray handle's label
// after a reload); R11 also shows every feasible wish with Show me (the ghost is one mesh, T2.4).
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { ROOT, startServer, launch, openGame, injectHelpers } from './harness.mjs';
const { devices } = createRequire(import.meta.url)('playwright');

const argv = process.argv.slice(2);
const ONLY = (argv.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
const want = (name) => !ONLY.length || ONLY.includes(name);
let fails = 0, passes = 0, skips = 0;
const check = (id, name, ok, info) => {
  if (ok) passes++; else fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${name}${info !== undefined ? '  ' + JSON.stringify(info) : ''}`);
};
const skip = (id, name, why) => { skips++; console.log(`SKIP ${id} ${name}  (${why})`); };
/** Console problems minus the ones a check expects. */
const unexpected = (problems, allow = []) => problems.filter((p) => !allow.some((re) => re.test(p)));

const { server, base } = await startServer();
const browser = await launch();
// §13.4 fixtures in the page (window.__fx): SMALL_HOME, HOME4, PERF_TOWN, ring, N1, N2, build
const FIX = String.raw`window.__fx = (() => {
  function SMALL_HOME(x0, z0) {
    const P = [];
    for (let x = x0; x <= x0 + 1; x++) for (let z = z0; z <= z0 + 1; z++) { P.push({ t: 'foundation', x, y: 0, z }); P.push({ t: 'roof_flat', x, y: 1, z, h: 0 }); }
    for (let x = x0; x <= x0 + 1; x++) { P.push({ t: 'wall', a: 'x', x, y: 0, z: z0 }); P.push({ t: x === x0 ? 'wall_door' : 'wall', a: 'x', x, y: 0, z: z0 + 2 }); }
    for (let z = z0; z <= z0 + 1; z++) { P.push({ t: 'wall', a: 'z', x: x0, y: 0, z }); P.push({ t: 'wall', a: 'z', x: x0 + 2, y: 0, z }); }
    P.push({ t: 'bed', x: x0, y: 0, z: z0 });
    return P;
  }
  function HOME4(x0, z0) {
    const P = [];
    for (let x = x0; x <= x0 + 3; x++) for (let z = z0; z <= z0 + 1; z++) { P.push({ t: 'foundation', x, y: 0, z }); P.push({ t: 'roof_flat', x, y: 1, z, h: 0 }); }
    for (let x = x0; x <= x0 + 3; x++) { P.push({ t: 'wall', a: 'x', x, y: 0, z: z0 }); P.push({ t: x === x0 + 1 ? 'wall_door' : 'wall', a: 'x', x, y: 0, z: z0 + 2 }); }
    for (let z = z0; z <= z0 + 1; z++) { P.push({ t: 'wall', a: 'z', x: x0, y: 0, z }); P.push({ t: 'wall', a: 'z', x: x0 + 4, y: 0, z }); }
    for (let x = x0; x <= x0 + 3; x++) P.push({ t: 'bed', x, y: 0, z: z0 });
    return P;
  }
  const PERF_TOWN = () => [...HOME4(-9, -9), ...HOME4(1, -9), ...HOME4(-9, -3), ...HOME4(1, -3), ...HOME4(-4, 4)];
  function ring(x0, z0, x1, z1, t) {
    const P = [];
    for (let x = x0; x <= x1; x++) { P.push({ t, a: 'x', x, y: 0, z: z0 }); P.push({ t, a: 'x', x, y: 0, z: z1 + 1 }); }
    for (let z = z0; z <= z1; z++) { P.push({ t, a: 'z', x: x0, y: 0, z }); P.push({ t, a: 'z', x: x1 + 1, y: 0, z }); }
    return P;
  }
  const N1 = () => [...SMALL_HOME(0, 0), ...ring(-2, -2, 3, 4, 'fence_picket')];
  const N2 = () => [...SMALL_HOME(0, 0), ...ring(-10, -10, 9, 9, 'hedge')];
  function build(world, pieces) {
    world.clear({ record: false });
    const bad = [];
    for (const p of pieces) if (!world.add(p, { record: false })) bad.push(p.t + '@' + (p.a || '') + p.x + ',' + p.y + ',' + p.z);
    return bad;
  }
  const hide = () => Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
  const show = () => { delete document.visibilityState; };
  return { SMALL_HOME, HOME4, PERF_TOWN, ring, N1, N2, build, hide, show };
})();`;
/** A page on a new context; `init` (a function) runs before any page script (event recorders, hidden pages). */
async function game(q, opts = {}) {
  let g;
  const br = opts.browser || browser;
  if (opts.init) {
    const ctx = await br.newContext(opts.mobile ? { ...devices['iPhone 13'], deviceScaleFactor: 1 } : { viewport: { width: opts.w || 1280, height: opts.h || 800 }, deviceScaleFactor: 1 });
    await ctx.addInitScript(opts.init);
    const page = await ctx.newPage();
    const problems = [];
    page.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !/GPU stall|ReadPixels/.test(m.text())) problems.push(`[${m.type()}] ${m.text()}`); });
    page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`));
    await page.goto(`${base}?${q}`);
    await page.waitForFunction(() => window.__hwReady === true, null, { timeout: 60000 });
    g = { ctx, page, problems };
  } else g = await openGame(br, base, q, opts);
  await injectHelpers(g.page);
  await g.page.addScriptTag({ content: FIX });
  return g;
}
/** Reload an open page with another query (same profile / localStorage) and wait for the game. */
async function reopen(page, q) {
  await page.goto(`${base}?${q}`);
  await page.waitForFunction(() => window.__hwReady === true, null, { timeout: 60000 });
  await injectHelpers(page);
  await page.addScriptTag({ content: FIX });
}
/** Records town events (and toasts) from the very first frame: window.__ev = [[type, clock, detail]]. */
const RECORD = () => {
  window.__ev = [];
  const iv = setInterval(() => {
    const hw = window.__hw;
    if (!hw?.events || !hw.town) return;
    clearInterval(iv);
    const types = ['ready', 'town-ready', 'town-traveller', 'town-movein', 'town-wish', 'town-granted', 'town-status', 'town-fixed',
      'town-passerby', 'town-cozy', 'town-homes', 'town-gift', 'town-showme', 'town-showme-end', 'toast', 'sfx'];
    for (const k of types) hw.events.on(k, (d) => {
      let x = null;
      try { x = k === 'toast' ? { text: d?.text, act: d?.action?.label || null } : k === 'sfx' ? { name: d?.name } : JSON.parse(JSON.stringify(d || {}, (key, v) => (key === 'homes' ? undefined : v))); } catch { x = null; }
      window.__ev.push([k, +(hw.town.clock?.() || 0).toFixed(2), x, performance.now()]);
    });
  }, 2);
};
const HIDDEN = () => Object.defineProperty(document, 'visibilityState', { get: () => 'hidden', configurable: true });
async function section(name, fn) {
  if (!want(name)) return;
  try { await fn(); } catch (e) { check(name, 'section ran to the end', false, String(e?.stack || e).split('\n').slice(0, 3).join(' | ')); }
}

// ---------------------------------------------------------------- params (Node: parseParams is pure)
await section('params', async () => {
  const { parseParams, phaseAt } = await import(pathToFileURL(path.join(ROOT, 'js', 'town', 'index.js')).href);
  const p = (q) => parseParams(new URLSearchParams(q));
  const a = p('town=fresh&townrender=0&townseed=7&townspeed=60&spawn=gardener,baker,nobody&wish=w_door_bench&cozy=40&unlock=gift_gnome,bad id&townnav=1&townhud=1&townlog=1');
  check('P1', 'every town param of §12.12 parses', a.town === 'fresh' && a.render === false && a.seed === 7 && a.speed === 60
    && JSON.stringify(a.spawn) === '{"jobs":["gardener","baker"]}' && a.wish === 'w_door_bench' && a.cozy === 40
    && JSON.stringify(a.unlock) === '["gift_gnome"]' && a.nav && a.hud && a.log, a);
  const b = p('town=2&townrender=yes&townseed=-1&townspeed=500&spawn=21&wish=bench&cozy=1e3&unlock=,');
  check('P2', 'malformed or out-of-range values are ignored', b.town === null && b.render === true && b.seed === null && b.speed === 1
    && b.spawn === null && b.wish === null && b.cozy === null && b.unlock === null, b);
  const c = p('spawn=20&townseed=4294967295&townspeed=1&cozy=0&unlock=all&town=0');
  check('P3', 'edge values: spawn=20, townseed=2^32−1, townspeed=1, cozy=0, unlock=all, town=0', c.spawn?.n === 20
    && c.seed === 4294967295 && c.speed === 1 && c.cozy === 0 && c.unlock === 'all' && c.town === '0' && p('townseed=4294967296').seed === null, c);
  check('P4', 'phases of the steady schedule (§5.2) at the presets', ['dawn 0.27', 'morning 0.42', 'noon 0.55', 'sunset 0.74', 'night 0.9', '03:00 0.125']
    .map((s) => phaseAt(+s.split(' ')[1])).join() === 'morning,day,day,evening,home,night');
});

// ---------------------------------------------------------------- the spine on a default page
await section('spine', async () => {
  const { ctx, page, problems } = await game('clean=1&nosave=1');
  const r1 = await page.evaluate(async () => {
    const hw = __hw, t = hw.town;
    if (!t) return { town: null };
    await __t.sleep(600);
    const api = ['enabled', 'clock', 'day', 'cozy', 'view', 'villager', 'bubbles', 'giftInfo', 'tipOnce', 'audible', 'hitTest', 'showMe',
      'showing', 'endShowMe', 'muteHint', 'answerIntro', 'follow', 'focusHome', 'update'].filter((k) => typeof t[k] !== 'function');
    const dbg = ['state', 'homes', 'recipes', 'spawn', 'traveller', 'passerby', 'wish', 'plan', 'grant', 'edit', 'expire', 'cozy', 'speed',
      'unlock', 'unlockAll', 'advance', 'step', 'phase', 'nav', 'path', 'stuck', 'outdoors', 'select', 'stats', 'snapshot', 'reset']
      .filter((k) => typeof t.debug?.[k] !== 'function');
    const v = t.view();
    const viewKeys = ['day', 'cozy', 'villagers', 'homes', 'couldMoveIn', 'almost', 'campers', 'openWishes', 'granted', 'full', 'timeFlow', 'enabled', 'note', 'intro'];
    const cz = t.cozy();
    const s = t.debug.stats();
    return {
      ready: t.ready, enabled: t.enabled(), missingApi: api, missingDebug: dbg, viewMissing: viewKeys.filter((k) => !(k in v)),
      arrays: ['villagers', 'homes', 'couldMoveIn', 'almost'].every((k) => Array.isArray(v[k])), sameView: t.view() === v,
      cozyOk: ['value', 'tier', 'warmth', 'charm', 'floor', 'frac'].every((k) => k in cz) && ['quiet', 'content', 'cheerful', 'glowing'].includes(cz.tier),
      bubbles: t.bubbles(), audible: t.audible(), version: hw.world.version, recomputes: s.recomputes, ticks: s.ticks,
      stuck: t.debug.stuck(), townCalls: s.calls, townGroup: !!hw.scene.getObjectByName('town'),
      wrapped: String(hw.rig.onTap).includes('snapToHighlight') && String(hw.rig.onPress).includes('highlightHit') && String(hw.rig.onAimEnd).includes('snapToHighlight'),
      hit: t.hitTest(100, 100), showMe: t.showMe({ villager: 'v1' }), showing: t.showing(), giftInfo: t.giftInfo('gift_gnome'),
      tip1: t.tipOnce('m0-test'), tip2: t.tipOnce('m0-test'),
    };
  });
  check('R1', 'boot: town.ready is true after `ready` with no world-change (clean=1), by exactly one restore recompute', r1.ready === true && r1.enabled === true
    && r1.version === 0 && r1.recomputes === 1, { ready: r1.ready, enabled: r1.enabled, version: r1.version, recomputes: r1.recomputes });
  check('R1', 'nothing town-drawn before anyone is there (the town group is in the scene, 0 town draw calls)', r1.townCalls === 0 && r1.townGroup,
    { calls: r1.townCalls, group: r1.townGroup });
  check('API', 'TownAPI has every §12.4 member and debug every §12.13 member', !r1.missingApi?.length && !r1.missingDebug?.length, { api: r1.missingApi, debug: r1.missingDebug });
  check('API', 'view(): every TownView field, cached (same object within 250 ms); cozy() shape', !r1.viewMissing?.length && r1.arrays && r1.sameView && r1.cozyOk, r1.viewMissing);
  check('API', 'empty data: no bubbles, talkers, hits, Show me, gift info; stuck() empty; tipOnce true then false',
    Array.isArray(r1.bubbles) && !r1.bubbles.length && !r1.audible.talkers.length && !r1.audible.foley.length && r1.hit === null && r1.showMe === false
    && r1.showing === null && r1.giftInfo === null && Array.isArray(r1.stuck) && !r1.stuck.length && r1.tip1 === true && r1.tip2 === false, r1);
  check('INPUT', 'rig.onTap / onPress / onAimEnd are wrapped (§12.7)', r1.wrapped);

  // clocks: the frame hook ticks the town clock only while visible and on (§5.1)
  const r2 = await page.evaluate(async () => {
    const hw = __hw, t = hw.town, T = __t, ev = [];
    const off = hw.events.on('town-enabled', (d) => ev.push(d.on));
    const c0 = t.clock(); await T.sleep(1500); const c1 = t.clock();
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    await T.sleep(200); const h0 = t.clock(); await T.sleep(1200); const h1 = t.clock();
    delete document.visibilityState;
    await T.sleep(1000); const c2 = t.clock();
    hw.state.set({ village: false });
    await T.sleep(200); const o0 = t.clock(); await T.sleep(1000); const o1 = t.clock(); const offEnabled = t.enabled(); const offView = t.view().enabled;
    hw.state.set({ village: true });
    await T.sleep(1000); const c3 = t.clock();
    off();
    t.answerIntro(false); const quiet = hw.state.village; hw.state.set({ village: true });
    return { c0, c1, h0, h1, c2, o0, o1, c3, offEnabled, offView, ev, quiet };
  });
  check('CLOCK', 'the town clock runs while visible (frame hook)', r2.c1 > r2.c0 + 0.2, [r2.c0, r2.c1]);
  check('CLOCK', 'frozen while the page is hidden, resumes after', r2.h1 === r2.h0 && r2.c2 > r2.h1, [r2.h0, r2.h1, r2.c2]);
  check('ENABLED', 'villagers off: enabled() false, clock frozen, view().enabled false; on again: runs; town-enabled off → on',
    r2.offEnabled === false && r2.offView === false && r2.o1 === r2.o0 && r2.c3 > r2.o1 && JSON.stringify(r2.ev) === '[false,true]', r2);
  check('ENABLED', 'answerIntro(false) ("Keep my meadow quiet") sets state.village false', r2.quiet === false);

  // recompute scheduling (§3.8): 0.3 s after the last change, ≤ 2 Hz, never twice for one world.version
  const r3 = await page.evaluate(async () => {
    const hw = __hw, t = hw.town, T = __t, rc = () => t.debug.stats().recomputes;
    const out = {};
    const r0 = rc();
    for (let i = 0; i < 6; i++) hw.world.add({ t: 'foundation', x: -8 + i, y: 0, z: -8 }, { record: false });
    const tEdit = performance.now();
    // a loaded machine can stretch a 120 ms sleep past 0.3 s, so the recompute's own timestamp decides "within 0.3 s"
    await T.sleep(1320); out.after = rc() - r0;
    out.afterMs = +(t.debug.stats().recomputeAt - tEdit).toFixed(1);
    out.during = out.after > 0 && out.afterMs < 290 ? 1 : 0;
    await T.sleep(800); out.quiet = rc() - r0;
    hw.events.emit('world-change', { kind: 'fake' });          // dirty, but the version didn't change
    await T.sleep(1200); out.sameVersion = rc() - r0;
    // a burst spread over ~1 s (a draw stroke): one recompute after it. A pause of ≥ 0.3 s between two changes (a
    // slow software-rendered frame on a loaded machine) legitimately lets one more through, so those are counted.
    const r1 = rc();
    let last = performance.now(), pauses = 0;
    for (let i = 0; i < 12; i++) {
      hw.world.add({ t: 'path', x: -8 + i, y: 0, z: -6 }, { record: false });
      const now = performance.now(); if (i && now - last >= 280) pauses++; last = now;
      await T.sleep(60);
    }
    await T.sleep(1500); out.stroke = rc() - r1; out.strokePauses = pauses;
    // a stamp is one recompute
    const r2 = rc();
    hw.blueprints.stamp('cottage', { animate: true, record: true });
    await T.settle(); await T.sleep(1200); out.stamp = rc() - r2;
    // debug.edit: applied at a tick boundary, recomputed synchronously, resolves to the new version
    const r3 = rc();
    const v = await t.debug.edit((w) => w.add({ t: 'bench', x: 5, y: 0, z: 6 }, { record: false }));
    out.edit = { v, version: hw.world.version, recomputes: rc() - r3, placed: !!hw.world.get('I|5|0|6') };
    // debug.advance crosses a town day → town-day; debug.phase sets mid-phase sky time
    const days = []; const off = hw.events.on('town-day', (d) => days.push(d.day));
    const c0 = t.clock(); t.debug.advance(600); out.advance = { dc: +(t.clock() - c0).toFixed(2), days, day: t.day() }; off();
    out.phase = t.debug.phase('night'); out.phaseDay = t.debug.phase('day'); out.phaseBad = t.debug.phase('lunch');
    return out;
  });
  check('RECOMPUTE', '6 quick edits → none within 0.3 s, then exactly one; none while quiet', r3.during === 0 && r3.after === 1 && r3.quiet === 1, r3);
  check('RECOMPUTE', 'never twice for the same world.version (a world-change without a change)', r3.sameVersion === 1, r3.sameVersion);
  check('RECOMPUTE', 'a draw-stroke-like burst and an animated blueprint stamp each give one recompute', r3.stroke >= 1 && r3.stroke <= 1 + r3.strokePauses
    && r3.stamp === 1, { stroke: r3.stroke, pauses: r3.strokePauses, stamp: r3.stamp });
  check('DEBUG', 'debug.edit(fn) recomputes synchronously and resolves to world.version', r3.edit.v === r3.edit.version && r3.edit.recomputes === 1 && r3.edit.placed, r3.edit);
  check('DEBUG', 'debug.advance(600) adds 600 s of town clock and fires town-day; debug.phase sets mid-phase time', r3.advance.dc === 600
    && r3.advance.days.length === 1 && r3.advance.days[0] === r3.advance.day && Math.abs(r3.phase - 2.25 / 24) < 1e-6
    && Math.abs(r3.phaseDay - 12.75 / 24) < 1e-6 && r3.phaseBad === false, { advance: r3.advance, phase: r3.phase });

  // rig pass-through: with nothing to hit, taps, presses and aims build exactly as before
  const r4 = await page.evaluate(async () => {
    const hw = __hw, T = __t;
    hw.town.debug.reset();                         // nobody about (the advance above brought a villager)
    hw.world.clear({ record: false });
    hw.state.set({ pieceId: 'foundation', tool: 'build', level: 0, seeAll: true, photoMode: false });
    hw.rig.setView({ t: [0, 0, 0], th: 0.6, ph: 1.0, r: 30 }, true);
    await T.sleep(300);
    const at = (x, z) => T.toScreen(new hw.THREE.Vector3(x * 2 + 1, 0.1, z * 2 + 1));
    const n0 = hw.world.count;
    const a = at(0, 0); hw.rig.onPress(a.x, a.y, 'touch'); hw.rig.onTap(a.x, a.y, { pointerType: 'mouse' });
    const n1 = hw.world.count;
    const b = at(2, 0); hw.rig.onAimEnd(b.x, b.y, false, { pointerType: 'touch' });
    const n2 = hw.world.count;
    const c = at(4, 0); hw.rig.onAimEnd(c.x, c.y, true);
    const n3 = hw.world.count;
    return { n0, n1, n2, n3, k1: !!hw.world.get('F|0|0|0'), k2: !!hw.world.get('F|2|0|0') };
  });
  check('INPUT', 'wrapped tap / aim place a piece exactly as the builder does; a cancelled aim places nothing', r4.n1 === r4.n0 + 1
    && r4.n2 === r4.n1 + 1 && r4.n3 === r4.n2 && r4.k1 && r4.k2, r4);
  check('R1', 'no console errors (spine session)', problems.length === 0, problems.slice(0, 6));
  await ctx.close();
});

// ---------------------------------------------------------------- town=0 / showcase: off for the load
await section('off', async () => {
  const { ctx, page, problems } = await game('clean=1&nosave=1&town=0&unlock=all');
  const r = await page.evaluate(async () => {
    const hw = __hw, t = hw.town;
    hw.state.set({ village: true });
    await __t.sleep(800);
    const s = t.debug.stats();
    return { ready: t.ready, enabled: t.enabled(), parts: Object.keys(t.debug.parts()), recomputes: s.recomputes, ticks: s.ticks,
      clock: t.clock(), wrapped: String(hw.rig.onTap).includes('snapToHighlight'), bubbles: document.querySelectorAll('.hw-bubble').length,
      group: hw.scene.getObjectByName('town')?.visible ?? null, viewEnabled: t.view().enabled };
  });
  check('R1', 'town=0: enabled() false even with the setting on; nothing imported, wrapped, recomputed or ticked; no bubbles', r.enabled === false
    && r.ready === false && !r.parts.length && r.recomputes === 0 && r.ticks === 0 && r.clock === 0 && !r.wrapped && r.bubbles === 0
    && (r.group === null || r.group === false) && r.viewEnabled === false, r);
  check('R1', 'town=0 (with unlock=all): no console errors', problems.length === 0, problems.slice(0, 6));
  await reopen(page, 'showcase=walls&ui=0&nosave=1');
  const s = await page.evaluate(() => ({ enabled: __hw.town.enabled(), wrapped: String(__hw.rig.onTap).includes('snapToHighlight'), parts: Object.keys(__hw.town.debug.parts()) }));
  check('OFF', 'showcase: the town is off for the load (not wrapped, nothing imported)', s.enabled === false && !s.wrapped && !s.parts.length, s);
  check('OFF', 'no console errors (showcase)', problems.length === 0, problems.slice(0, 6));
  await ctx.close();
});

// ---------------------------------------------------------------- settings: state keys and the town param overrides
await section('settings', async () => {
  const { ctx, page, problems } = await game('clean=1&nosave=1&ui=0');
  const d = await page.evaluate(() => {
    const st = __hw.state;
    const out = { timeFlow: st.timeFlow, village: st.village, chatter: st.chatter };
    st.set({ village: false, chatter: false }); st.save();
    try { out.saved = JSON.parse(localStorage.getItem('hearthwood.settings.v1')); } catch { out.saved = null; }
    const env = __hw.modules.env;
    out.env = { lane: Array.isArray(env.LANE) && env.LANE.length > 3 && env.LANE[2][0] === -37 && env.LANE[2][1] === -8, day: env.DAY_SECONDS };
    const c = __hw.catalog;
    out.setHidden = { unknown: c.setHidden('no_such_piece', false), shown: c.piecesIn('garden').some((x) => x.id === 'bench') };
    c.setHidden('bench', true); out.setHidden.hidden = !c.piecesIn('garden').some((x) => x.id === 'bench') && c.getDef('bench').hidden === true;
    out.setHidden.ret = c.setHidden('bench', false); out.setHidden.back = c.piecesIn('garden').some((x) => x.id === 'bench');
    return out;
  });
  check('STATE', 'fresh profile: timeFlow on (§0.4), village and chatter on', d.timeFlow === true && d.village === true && d.chatter === true, d);
  check('STATE', 'village and chatter persist in hearthwood.settings.v1', d.saved && d.saved.village === false && d.saved.chatter === false, d.saved);
  check('ENV', 'env.js exports LANE and DAY_SECONDS (600)', d.env.lane && d.env.day === 600, d.env);
  check('CATALOG', 'catalog.setHidden hides / shows a piece in the tray; false for an unknown id', d.setHidden.unknown === false && d.setHidden.shown
    && d.setHidden.hidden && d.setHidden.ret === true && d.setHidden.back, d.setHidden);
  const modes = {};
  for (const q of ['', '&town=1', '&town=fresh', '&town=0']) {
    await reopen(page, `clean=1&nosave=1&ui=0${q}`);
    modes[q || 'none'] = await page.evaluate(() => ({ village: __hw.state.village, enabled: __hw.town.enabled(), ready: __hw.town.ready }));
  }
  check('ENABLED', 'setting off: off; town=1 and town=fresh: on for the load (setting unchanged); town=0: off', modes.none.village === false
    && !modes.none.enabled && modes.none.ready && modes['&town=1'].enabled && modes['&town=fresh'].enabled && !modes['&town=0'].enabled
    && Object.values(modes).every((m) => m.village === false), modes);
  check('STATE', 'no console errors (settings)', problems.length === 0, problems.slice(0, 6));
  await ctx.close();
});

// ---------------------------------------------------------------- a failure inside the town turns it off; building goes on
await section('crash', async () => {
  for (const where of ['update', 'api']) {
    const { ctx, page, problems } = await game('clean=1&nosave=1&ui=0');
    const r = await page.evaluate(async (where) => {
      const hw = __hw, t = hw.town, T = __t, ev = [];
      const off = hw.events.on('town-enabled', (d) => ev.push(d.on));
      t.debug.crash(where);
      await T.sleep(500);
      const c0 = t.clock(); await T.sleep(600); const c1 = t.clock();
      hw.state.set({ pieceId: 'foundation', tool: 'build', level: 0 });
      hw.rig.setView({ t: [0, 0, 0], th: 0.6, ph: 1.0, r: 30 }, true);
      await T.sleep(300);
      const p = T.toScreen(new hw.THREE.Vector3(1, 0.1, 1));
      const n0 = hw.world.count; hw.rig.onTap(p.x, p.y, { pointerType: 'mouse' }); const n1 = hw.world.count;
      off();
      return { enabled: t.enabled(), healthy: t.debug.state().healthy, errors: hw.errors.map((e) => e.where), ev, frozen: c1 === c0,
        hookAlive: typeof t.update === 'function', view: t.view().enabled, placed: n1 === n0 + 1 };
    }, where);
    const townErr = problems.filter((p) => /\[hearthwood\] town/.test(p));
    check('CRASH', `debug.crash('${where}'): the town turns off for the session, reports once, clock frozen, building goes on`, r.enabled === false
      && r.healthy === false && r.errors.length === 1 && r.errors[0].startsWith('town.') && JSON.stringify(r.ev) === '[false]' && r.frozen
      && r.view === false && r.placed && townErr.length === 1, { ...r, townErr: townErr.length });
    check('CRASH', `no console errors besides the town's one report (${where})`, unexpected(problems, [/\[hearthwood\] town/]).length === 0, unexpected(problems, [/\[hearthwood\] town/]).slice(0, 4));
    await ctx.close();
  }
});

// ---------------------------------------------------------------- js/town/index.js fails to import (R5's last case)
await section('importfail', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  await ctx.route('**/js/town/index.js', (route) => route.fulfill({ status: 500, contentType: 'text/plain', body: 'boom' }));
  const page = await ctx.newPage();
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`));
  await page.goto(`${base}?clean=1&nosave=1`);
  await page.waitForFunction(() => window.__hwReady === true, null, { timeout: 60000 });
  await injectHelpers(page);
  const r = await page.evaluate(async () => {
    const hw = __hw, T = __t;
    await T.sleep(500);
    hw.state.set({ pieceId: 'foundation', tool: 'build', level: 0 });
    hw.rig.setView({ t: [0, 0, 0], th: 0.6, ph: 1.0, r: 30 }, true);
    await T.sleep(300);
    const p = T.toScreen(new hw.THREE.Vector3(1, 0.1, 1));
    const n0 = hw.world.count; hw.rig.onTap(p.x, p.y, { pointerType: 'mouse' });
    return { town: hw.town, errors: hw.errors.map((e) => e.where), placed: hw.world.count === n0 + 1, ui: !!hw.ui };
  });
  const allow = [/module town/, /status of 500/];
  check('R5', 'index.js fails to import: app.town null, the game boots with its UI and builds', r.town === null && r.ui && r.placed
    && r.errors.length === 1 && r.errors[0] === 'module town', r);
  check('R5', 'no errors outside the module report', unexpected(problems, allow).length === 0, unexpected(problems, allow).slice(0, 4));
  await ctx.close();
});

// ---------------------------------------------------------------- main.js autosave guard (§12.6 (5))
await section('autosave', async () => {
  const { ctx, page, problems } = await game('clean=1&nosave=1&ui=0');
  const KEY = 'hearthwood.autosave.v1';
  const run = async (pieces) => {
    await page.evaluate(([k, pieces]) => localStorage.setItem(k, JSON.stringify({ app: 'hearthwood', v: 1, pieces, cam: { t: [0, 1, 0], th: 0.5, ph: 1, r: 20 }, date: 1 })), [KEY, pieces]);
    await reopen(page, 'ui=0&town=0');
    return page.evaluate(async (k) => {
      const hw = __hw, T = __t, before = localStorage.getItem(k);
      const count = hw.world.count;
      hw.rig.setView({ t: [2, 1, 2], th: 2.0, ph: 0.9, r: 25 }, true);
      await T.sleep(200);
      window.dispatchEvent(new Event('pagehide'));
      const afterCam = localStorage.getItem(k);
      hw.world.add({ t: 'foundation', x: 3, y: 0, z: 3 });
      await T.sleep(1400);
      const afterEdit = JSON.parse(localStorage.getItem(k) || 'null');
      return { count, camOnlyKept: afterCam === before, editSaved: !!afterEdit && afterEdit.pieces.some((p) => p.t === 'foundation' && p.x === 3 && p.z === 3) };
    }, KEY);
  };
  const lossy = await run([{ t: 'foundation', x: 0, y: 0, z: 0 }, { t: 'zz_future_piece', x: 1, y: 0, z: 0 }]);
  const clean = await run([{ t: 'foundation', x: 0, y: 0, z: 0 }, { t: 'foundation', x: 1, y: 0, z: 0 }]);
  check('AUTOSAVE', 'a restore that dropped an unknown piece is not overwritten by a camera-only flush; an edit still saves', lossy.count === 1
    && lossy.camOnlyKept && lossy.editSaved, lossy);
  check('AUTOSAVE', 'a clean restore still flushes a camera-only change (unchanged behaviour)', clean.count === 2 && !clean.camOnlyKept && clean.editSaved, clean);
  check('AUTOSAVE', 'no console errors (autosave)', problems.length === 0, problems.slice(0, 6));
  await ctx.close();
});

// ---------------------------------------------------------------- brain / body modules (smoke test; wired in M1)
await section('parts', async () => {
  const { ctx, page, problems } = await game('clean=1&nosave=1&ui=0');
  const r = await page.evaluate(async () => {
    const t = __hw.town;
    const boot = t.debug.parts();
    const all = await t.debug.loadParts();
    await __t.sleep(300);
    return { boot, all, enabled: t.enabled(), homes: t.debug.homes().length };
  });
  check('PARTS', 'boot imports every brain / body module with the exports index.js needs (M1: all wired)', Object.keys(r.boot).length === 8
    && Object.values(r.boot).every((p) => p.ok), r.boot);
  const missing = Object.entries(r.all).filter(([, p]) => !p.ok);
  if (missing.length) skip('PARTS', 'every brain / body module imports with its §12.4 exports', `not there yet: ${missing.map(([n, p]) => `${n}${p.missing.length ? ' (no ' + p.missing.join(', ') + ')' : ''}`).join(', ')}`);
  else check('PARTS', 'every brain / body module imports with its §12.4 exports', true);
  check('PARTS', 'the town stays on whatever loadParts found', r.enabled === true);
  check('PARTS', 'no console errors besides missing-module 404s', unexpected(problems, [/status of 404/]).length === 0, unexpected(problems, [/status of 404/]).slice(0, 4));
  await ctx.close();
});

// ---------------------------------------------------------------- R14: offline (sw.js CORE, §12.6) — Node only
await section('offline', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const core = [...src.slice(src.indexOf('const CORE'), src.indexOf('];', src.indexOf('const CORE'))).matchAll(/'\.\/([^']+)'/g)].map((m) => m[1]);
  const town = fs.readdirSync(path.join(ROOT, 'js', 'town')).filter((f) => f.endsWith('.js')).map((f) => `js/town/${f}`);
  const want = [...town, 'js/pieces/gifts.js', 'css/town.css'];
  const missing = want.filter((f) => !core.includes(f));
  const ghosts = core.filter((f) => !fs.existsSync(path.join(ROOT, f)));
  const version = Number((/const VERSION = (\d+)/.exec(src) || [])[1]);
  check('R14', 'sw.js CORE lists every js/town file (14), js/pieces/gifts.js and css/town.css, and nothing that is not on disk; VERSION 5',
    town.length === 14 && !missing.length && !ghosts.length && version === 5, { town: town.length, missing, ghosts, version });
});

// ---------------------------------------------------------------- every blueprint boots with the town on
await section('blueprints', async () => {
  for (const bp of ['starter', 'aframe', 'logcabin', 'cottage', 'farmhouse']) {
    const { ctx, page, problems } = await game(`bp=${bp}&nosave=1&town=fresh`, { mobile: true });
    const r = await page.evaluate(async () => {
      await __t.sleep(2500);
      const t = __hw.town;
      return { ready: t.ready, enabled: t.enabled(), homes: t.debug.homes().filter((h) => h.home).length, errors: __hw.errors.map((e) => e.where) };
    });
    check('BOOT', `bp=${bp} with the town on (fresh, phone): ready, no console errors`, r.ready && r.enabled && !r.errors.length && problems.length === 0,
      { ...r, problems: problems.slice(0, 4) });
    await ctx.close();
  }
});

// ---------------------------------------------------------------- R2: homes and recipes per blueprint (§3.2, B2)
await section('homes', async () => {
  const { ctx, page, problems } = await game('clean=1&nosave=1&ui=0&town=fresh', { init: HIDDEN });
  const r = await page.evaluate(async () => {
    const hw = __hw, t = hw.town, out = {};
    for (const id of ['starter', 'aframe', 'logcabin', 'cottage', 'farmhouse']) {
      await t.debug.edit((w) => { w.clear({ record: false }); hw.blueprints.stamp(id, { animate: false, record: false }); });
      const hs = t.debug.homes().sort((a, b) => b.cells - a.cells);
      const b = hs[0];
      const rc = t.debug.recipes().find((x) => x.id === b?.id) || null;
      const fit = rc ? Object.fromEntries(Object.entries(rc.fit).filter(([, v]) => v > 0).map(([k, v]) => [k, +v.toFixed(2)])) : null;
      out[id] = b ? { n: hs.length, cells: b.cells, levels: b.levels, rooms: b.rooms, beds: b.beds, doors: b.doors, gaps: b.gaps, unroofed: b.unroofed,
        home: b.home, reasons: b.reasons, doorsteps: b.doorsteps, best: rc?.best ?? null, fit } : null;
    }
    return out;
  });
  const want = {
    starter: { cells: 4, levels: [0], rooms: 1, beds: 0, doors: 1, gaps: 0, unroofed: 0, home: false, reasons: ['bed'], doorsteps: [[-1, 1]] },
    aframe: { cells: 24, levels: [0, 1], rooms: 2, beds: 1, doors: 1, gaps: 0, unroofed: 0, home: true, reasons: [], doorsteps: [[-1, 2]], best: 'woodcutter', fit: { woodcutter: 1 } },
    logcabin: { cells: 16, levels: [0], rooms: 1, beds: 1, doors: 1, gaps: 0, unroofed: 0, home: true, reasons: [], doorsteps: [[-1, 1]], best: 'woodcutter', fit: { woodcutter: 1 } },
    cottage: { cells: 20, levels: [0], rooms: 1, beds: 1, doors: 1, gaps: 0, unroofed: 0, home: true, reasons: [], doorsteps: [[0, 2]], best: 'gardener', fit: { gardener: 2, beekeeper: 1, baker: 1 } },
    farmhouse: { cells: 40, levels: [0, 1], rooms: 2, beds: 1, doors: 2, gaps: 0, unroofed: 0, home: true, reasons: [], doorsteps: [[0, -4], [0, 1]], best: 'farmer', fit: { gardener: 1.33, farmer: 1.5 } },
  };
  for (const [id, w] of Object.entries(want)) {
    const got = r[id];
    const keys = Object.keys(w).filter((k) => k !== 'best' && k !== 'fit');
    const bad = !got ? ['none'] : keys.filter((k) => JSON.stringify(k === 'doorsteps' ? [...got[k]].sort() : got[k]) !== JSON.stringify(k === 'doorsteps' ? [...w[k]].sort() : w[k]));
    check('R2', `${id}: debug.homes() matches §3.2 (cells, levels, rooms, beds, doors, gaps, unroofed, home, reasons, doorsteps)`, !bad.length, bad.length ? { bad, got } : undefined);
    if (w.best) {
      const fitOk = got && JSON.stringify(got.fit) === JSON.stringify(w.fit);
      check('R2', `${id}: debug.recipes() best job ${w.best}, fits as B2`, got && got.best === w.best && fitOk, { best: got?.best, fit: got?.fit });
    }
  }
  check('R2', 'no console errors (homes)', problems.length === 0, problems.slice(0, 4));
  await ctx.close();
});

// ---------------------------------------------------------------- R3: the first traveller and the move-in (§1.1, §4)
await section('arrival', async () => {
  // its own browser: the frame-work check measures a fresh game's first traveller, and SwiftShader's shared GPU
  // process carries state from earlier sections (render submit 45–70 ms there vs ≈ 20 ms fresh, M2)
  const own = await launch();
  const { ctx, page, problems } = await game('bp=cottage&nosave=1&town=fresh&townseed=3', { mobile: true, init: RECORD, browser: own });
  const r = await page.evaluate(async () => {
    const hw = __hw, t = hw.town, T = __t;
    const until = async (fn, ms) => { const t0 = performance.now(); while (performance.now() - t0 < ms) { const v = fn(); if (v) return v; await T.sleep(50); } return null; };
    const out = { ready: t.ready };
    await until(() => t.clock() >= 2, 20000);
    const programs0 = hw.renderer.info.programs.length;
    // per-frame main-thread work of the game (render submit + town + ui/hud): on software GL the frame time itself is
    // the rasteriser's, so the hitch check measures what the town adds to a frame
    const frames = [];
    let cur = null;
    const wrap = (obj, key, tag) => { const f = obj[key].bind(obj); obj[key] = (...a) => { const t0 = performance.now(); try { return f(...a); } finally { if (cur) { const d = performance.now() - t0; cur.js += d; cur[tag] = (cur[tag] || 0) + d; } } }; };
    wrap(hw.renderer, 'render', 'render'); wrap(t, 'update', 'town'); if (hw.ui?.update) wrap(hw.ui, 'update', 'ui');
    let lastF = performance.now();
    const loop = () => { const n = performance.now(); if (cur) { cur.dt = n - lastF; frames.push(cur); } lastF = n; cur = { js: 0, clock: t.clock() }; if (frames.length < 4000) requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
    t.debug.stats();                                                     // start a frame window
    await until(() => t.clock() >= 4.3, 20000);
    out.baseMax = t.debug.stats().maxFrameMs;                            // longest frame of the quiet window before
    const tr = await until(() => __ev.find((e) => e[0] === 'town-traveller'), 30000);
    out.travellerAt = tr ? tr[1] : null;
    const id = tr?.[2]?.villager?.id;
    out.visibleAt = await until(() => { const p = id && t.debug.actors.positionOf(id); return p && p.visible ? t.clock() : null; }, 10000);
    await until(() => t.clock() >= (out.travellerAt || 0) + 1.5, 10000);
    out.appearMax = t.debug.stats().maxFrameMs;                          // longest frame while the traveller appears
    const win = (a, b) => frames.filter((f) => f.clock >= a && f.clock <= b);
    const mx = (l, k) => +Math.max(0, ...l.map((f) => f[k])).toFixed(1);
    out.jsBefore = mx(win(2, 4.3), 'js');
    out.jsAppear = mx(win((out.travellerAt || 5) - 0.5, (out.travellerAt || 5) + 1.5), 'js');
    const worst = win((out.travellerAt || 5) - 0.5, (out.travellerAt || 5) + 1.5).sort((a, b) => b.js - a.js)[0];
    out.worst = worst ? { render: +(worst.render || 0).toFixed(1), town: +(worst.town || 0).toFixed(1), ui: +(worst.ui || 0).toFixed(1), clock: worst.clock } : null;
    out.programs = [programs0, hw.renderer.info.programs.length];
    const mv = await until(() => __ev.find((e) => e[0] === 'town-movein'), 120000);
    out.moveinAt = mv ? mv[1] : null;
    await T.sleep(2500);
    out.order = __ev.filter((e) => e[0] === 'town-traveller' || e[0] === 'town-movein').map((e) => e[0]);
    out.toasts = __ev.filter((e) => e[0] === 'toast').map((e) => e[2]?.text);
    out.travToast = __ev.find((e) => e[0] === 'toast' && /coming up the lane/.test(e[2]?.text || ''))?.[2] || null;
    const hearth = document.querySelector('.hw-hearth');
    out.hearth = !!hearth && !hearth.hidden && hearth.getBoundingClientRect().width > 0;
    out.sfx = __ev.filter((e) => e[0] === 'sfx' && /move-in|wish/.test(e[2]?.name || '')).map((e) => e[2].name);
    out.resident = t.debug.state().roster.map((v) => [v.name, v.job, v.status]);
    return out;
  });
  check('R3', 'the first traveller appears on the lane ≤ 6 s (town clock) after ready and is drawn', r.travellerAt !== null && r.travellerAt <= 6
    && r.visibleAt !== null && r.visibleAt <= 6.5, { travellerAt: r.travellerAt, visibleAt: r.visibleAt });
  check('R3', 'town-movein ≤ 45 s; events in order traveller → movein', r.moveinAt !== null && r.moveinAt <= 45 && JSON.stringify(r.order) === '["town-traveller","town-movein"]',
    { moveinAt: r.moveinAt, order: r.order });
  check('R3', 'toasts: the traveller toast with 👀 Watch, then "🏡 Mabel the Gardener moved into the thatched cottage!"', r.travToast?.act === '👀 Watch'
    && r.toasts.includes('🏡 Mabel the Gardener moved into the thatched cottage!'), r.toasts);
  check('R3', 'the hearth chip shows after the first move-in; the move-in jingle played', r.hearth && r.sfx.includes('move-in'), { hearth: r.hearth, sfx: r.sfx });
  check('R3', 'no new shader program when the traveller appears (compiled behind the loading screen)', r.programs[0] === r.programs[1], r.programs);
  // headless SwiftShader frames take 90–200 ms whatever the town does (§12.11: "fps is meaningless" there), so the
  // ≤ 50 ms worst-frame budget is checked on the main-thread work of each frame (render submit + town + ui / hud)
  check('R3', 'worst frame work while the traveller appears ≤ 50 ms (render submit + town + hud; raw software-GL frame times reported)',
    r.jsAppear <= 50, { jsAppear: r.jsAppear, worst: r.worst, jsBefore: r.jsBefore, rawFrameAppear: r.appearMax, rawFrameBefore: r.baseMax });
  check('R3', 'no console errors (arrival)', problems.length === 0, problems.slice(0, 4));
  await ctx.close();
  await own.close();
});

// ---------------------------------------------------------------- R6: never evict (§3.5, §3.6, §12.10)
await section('evict', async () => {
  const { ctx, page, problems } = await game('clean=1&nosave=1&town=fresh&townseed=5', { init: RECORD });
  const until = (fn, ms = 20000) => page.evaluate(async ([src, ms]) => {
    const f = new Function(`return (${src})()`);
    const t0 = performance.now();
    while (performance.now() - t0 < ms) { const v = f(); if (v) return v; await __t.sleep(60); }
    return null;
  }, [fn.toString(), ms]);
  // (a) the roof comes off → waiting; 60 s later the fix-up bubble; undo → resident + town-fixed
  const a = await page.evaluate(async () => {
    const hw = __hw, t = hw.town, w = hw.world;
    await t.debug.edit((w) => { w.clear({ record: false }); hw.blueprints.stamp('cottage', { animate: false, record: false }); });
    const id = t.debug.spawn('gardener');
    const v0 = t.debug.state().roster.find((v) => v.id === id);
    const roof = [...w.entries.values()].filter((e) => e.def.layer === 'R' && e.p.z >= 0).map((e) => e.key);
    __ev.length = 0;
    await t.debug.edit((w) => { w.beginBatch(); for (const k of roof) w.remove(k, { record: true }); w.endBatch(); });
    t.debug.advance(4);
    const s1 = t.debug.state().roster.find((v) => v.id === id).status;
    const fix0 = t.bubbles().some((b) => b.kind === 'fix');
    t.debug.advance(61);
    const fix1 = t.bubbles().some((b) => b.kind === 'fix' && b.home);
    const warm0 = t.cozy().warmth;
    await t.debug.edit((w) => w.undo());
    t.debug.advance(4);
    const v1 = t.debug.state().roster.find((v) => v.id === id);
    return { panels: roof.length, bed0: v0.bed, s1, fix0, fix1, s2: v1.status, bed2: v1.bed, fixed: __ev.filter((e) => e[0] === 'town-fixed').length,
      status: __ev.filter((e) => e[0] === 'town-status').map((e) => e[2].changes.map((c) => `${c.prev}→${c.status}`).join(',')), warm: [warm0, t.cozy().warmth] };
  });
  check('R6', 'roof removed → waiting after 3 s; the 🔨 fix-up bubble only after 60 s; undo → resident in the same bed + town-fixed (+Warmth)',
    a.s1 === 'waiting' && !a.fix0 && a.fix1 && a.s2 === 'resident' && a.bed2 === a.bed0 && a.fixed === 1 && a.warm[1] > a.warm[0], a);
  // (b) a panel off and back within 2 s (real time, the town clock running) → no status event
  const b = await page.evaluate(async () => {
    const hw = __hw, w = hw.world, T = __t;
    __ev.length = 0;
    const k = [...w.entries.values()].find((e) => e.def.layer === 'R').key;
    w.remove(k, { record: true });
    await T.sleep(900);
    w.undo();
    const c0 = hw.town.clock();
    while (hw.town.clock() < c0 + 5) await T.sleep(100);
    return { status: __ev.filter((e) => e[0] === 'town-status').length, back: !!w.get(k), resident: hw.town.debug.state().roster.every((v) => v.status === 'resident') };
  });
  check('R6', 'a roof panel removed and put back within 2 s → 0 town-status events', b.status === 0 && b.back && b.resident, b);
  // (c) newBuild() with 3 residents → one camping toast, the camp drawn; undo → home again in the same beds
  const c = await page.evaluate(async () => {
    const hw = __hw, t = hw.town, T = __t;
    await t.debug.edit((w) => __fx.build(w, __fx.HOME4(-4, -2)));
    t.debug.reset();
    for (const j of ['gardener', 'farmer', 'baker']) t.debug.spawn(j);
    const beds0 = t.debug.state().roster.map((v) => [v.id, v.bed]);
    __ev.length = 0;
    hw.newBuild();
    const c0 = t.clock();
    while (t.clock() < c0 + 4.5) await T.sleep(100);
    await T.sleep(800);
    const st = t.debug.state();
    const camp = hw.scene.getObjectByName('town-camp');
    const out = { statuses: st.roster.map((v) => v.status), tents: st.tents.length, campDrawn: !!camp && camp.visible && camp.count > 0,
      campBubble: t.bubbles().some((b) => b.kind === 'camp'), toasts: __ev.filter((e) => e[0] === 'toast').map((e) => e[2].text) };
    __ev.length = 0;
    hw.world.undo();
    const c1 = t.clock();
    while (t.clock() < c1 + 4.5) await T.sleep(100);
    await T.sleep(800);
    const st2 = t.debug.state();
    out.after = st2.roster.map((v) => [v.id, v.bed]);
    out.beds0 = beds0;
    out.statuses2 = st2.roster.map((v) => v.status);
    out.tents2 = st2.tents.length;
    out.toasts2 = __ev.filter((e) => e[0] === 'toast').map((e) => e[2].text);
    return out;
  });
  const campToasts = c.toasts.filter((x) => /camping by the lane/.test(x));
  check('R6', 'newBuild() with 3 residents → all camping, exactly 1 camping toast, the camp tents drawn and the ⛺ camp bubble', c.statuses.every((s) => s === 'camping')
    && c.statuses.length === 3 && campToasts.length === 1 && /3 villagers are camping/.test(campToasts[0] || '') && c.campDrawn && c.tents === 2 && c.campBubble, c);
  check('R6', 'undo → residents again in the same beds, tents gone', c.statuses2.every((s) => s === 'resident') && JSON.stringify(c.after) === JSON.stringify(c.beds0)
    && c.tents2 === 0, { after: c.after, before: c.beds0, statuses: c.statuses2, toasts: c.toasts2 });
  // (d) load the farmhouse (a slot / share code: world.load, record) → moving day into it, one toast; undo → back
  const d = await page.evaluate(async () => {
    const hw = __hw, t = hw.town, T = __t;
    await t.debug.edit((w) => { w.clear({ record: false }); hw.blueprints.stamp('cottage', { animate: false, record: false }); });
    t.debug.reset();
    const id = t.debug.spawn('gardener');
    const bed0 = t.debug.state().roster[0].bed;
    __ev.length = 0;
    hw.loadBuild({ pieces: hw.blueprints.get('farmhouse').pieces }, { record: true });
    const c0 = t.clock();
    while (t.clock() < c0 + 4.5) await T.sleep(100);
    await T.sleep(600);
    const v1 = t.debug.state().roster.find((v) => v.id === id);
    const out = { bed0, bed1: v1.bed, s1: v1.status, home1: t.debug.homes().find((h) => h.id === v1.homeId)?.name, toasts: __ev.filter((e) => e[0] === 'toast').map((e) => e[2].text) };
    __ev.length = 0;
    hw.world.undo();
    const c1 = t.clock();
    while (t.clock() < c1 + 4.5) await T.sleep(100);
    await T.sleep(600);
    const v2 = t.debug.state().roster.find((v) => v.id === id);
    Object.assign(out, { bed2: v2.bed, s2: v2.status, toasts2: __ev.filter((e) => e[0] === 'toast').map((e) => e[2].text) });
    return out;
  });
  const moveToasts = d.toasts.filter((x) => /^📦/.test(x));
  check('R6', 'loadBuild(farmhouse, record) → moving day into the farmhouse with one 📦 toast; undo → back in the cottage bed', d.s1 === 'resident'
    && d.bed1 !== d.bed0 && /farmhouse/.test(d.home1 || '') && moveToasts.length === 1 && d.s2 === 'resident' && d.bed2 === d.bed0, d);
  check('R6', 'no console errors (evict)', problems.length === 0, problems.slice(0, 4));
  void until;
  await ctx.close();
});

// ---------------------------------------------------------------- R7: never stuck (§6.3)
await section('stuck', async () => {
  const { ctx, page, problems } = await game('clean=1&nosave=1&ui=0&town=fresh&townseed=11', { init: HIDDEN });
  const r = await page.evaluate(async () => {
    const hw = __hw, t = hw.town, out = {};
    hw.state.set({ timeFlow: false, time: 0.42 });
    /** A villager standing (not walking) on an ordinary outdoor lot cell. */
    const standing = () => {
      for (let i = 0; i < 400; i++) {
        const v = t.debug.state().roster.find((u) => u.loc === 'out' && u.plan === 'pose' && u.cell && Math.abs(u.cell[0]) <= 8 && Math.abs(u.cell[1]) <= 8
          && !t.debug.homes().some((h) => h.doorsteps.some(([x, z]) => x === u.cell[0] && z === u.cell[1])));
        if (v) return v;
        t.debug.step(2);
      }
      return null;
    };
    const setup = async () => { await t.debug.edit((w) => __fx.build(w, __fx.SMALL_HOME(0, 0))); t.debug.reset(); t.debug.spawn('gardener'); };
    const trial = async (name, put) => {
      await setup();
      const v = standing();
      if (!v) { out[name] = { error: 'nobody standing outdoors' }; return; }
      const [x, z] = v.cell;
      await t.debug.edit((w) => put(w, x, z));
      t.debug.step(8);                                                   // 2 s of town clock
      const v2 = t.debug.state().roster.find((u) => u.id === v.id);
      out[name] = { cell: [x, z], stuck: t.debug.stuck(), after: v2.cell, plan: v2.plan };
    };
    await trial('walls', (w, x, z) => { for (const e of [{ a: 'x', x, z }, { a: 'x', x, z: z + 1 }, { a: 'z', x, z }, { a: 'z', x: x + 1, z }]) w.add({ t: 'wall', ...e, y: 0 }, { record: false }); });
    await trial('pond', (w, x, z) => { const k = `I|${x}|0|${z}`; if (w.get(k)) w.remove(k, { record: false }); w.add({ t: 'pond', x, y: 0, z }, { record: false }); });
    await trial('fence', (w, x, z) => { for (const e of [{ a: 'x', x, z }, { a: 'x', x, z: z + 1 }, { a: 'z', x, z }, { a: 'z', x: x + 1, z }]) w.add({ t: 'fence_picket', ...e, y: 0 }, { record: false }); });
    for (const nm of ['N1', 'N2']) {
      await t.debug.edit((w) => __fx.build(w, __fx[nm]()));
      t.debug.reset();
      t.debug.spawn('gardener');
      hw.state.set({ timeFlow: true, time: 0.3 });
      let stuck = 0;
      for (let i = 0; i < 60; i++) { t.debug.advance(10); stuck += t.debug.stuck().length; }
      out[nm] = { stuck, slips: t.debug.stats().slips, clock: t.clock(), status: t.debug.state().roster.map((u) => u.status) };
    }
    return out;
  });
  for (const k of ['walls', 'pond', 'fence']) check('R7', `${k === 'walls' ? 'wall-boxed' : k === 'pond' ? 'a pond dropped on them' : 'fenced in'}: debug.stuck() empty within 2 s`,
    r[k] && !r[k].error && Array.isArray(r[k].stuck) && r[k].stuck.length === 0, r[k]);
  for (const k of ['N1', 'N2']) check('R7', `living in ${k} for 10 town minutes: stuck() always empty, stats().slips 0`, r[k] && r[k].stuck === 0 && r[k].slips === 0, r[k]);
  check('R7', 'no console errors (stuck)', problems.length === 0, problems.slice(0, 4));
  await ctx.close();
});

// ---------------------------------------------------------------- R11: the PERF_TOWN budget (§12.11)
await section('budget', async () => {
  // a small canvas: software GL then draws a few frames a second, so the EMA sees enough frames (the costs measured
  // here are main-thread JS and draw calls, which don't depend on the canvas size)
  const { ctx, page, problems } = await game('clean=1&nosave=1&ui=0&town=fresh&townseed=9&spawn=20', { w: 800, h: 500 });
  const r = await page.evaluate(async () => {
    const hw = __hw, t = hw.town, T = __t, out = {};
    out.campers = t.debug.state().roster.filter((v) => v.status === 'camping').length;
    await t.debug.edit((w) => __fx.build(w, __fx.PERF_TOWN()));
    t.debug.advance(8);                                                  // settle: moving day into the five houses
    const st = t.debug.state();
    out.pop = st.roster.length;
    out.residents = st.roster.filter((v) => v.status === 'resident').length;
    out.jobs = new Set(st.roster.map((v) => v.job)).size;
    hw.rig.setView({ t: [-2, 1, -2], th: 0.6, ph: 1.0, r: 46 }, true);
    // walking, sitting, working: let the EMA (α 0.1) forget the first frames, which build the job meshes
    let frames = 0; const count = () => { frames++; if (frames < 400) requestAnimationFrame(count); }; requestAnimationFrame(count);
    const t0 = performance.now();
    while (frames < 90 && performance.now() - t0 < 60000) await T.sleep(200);
    out.frames = frames;
    out.updateMs = t.debug.stats().updateMs;
    const g = t.debug.actors.group;
    const on = T.render(), triOn = hw.renderer.info.render.triangles;
    g.visible = false;
    const off = T.render(), triOff = hw.renderer.info.render.triangles;
    g.visible = true;
    out.calls = [on, off, on - off];
    out.tris = [triOn - triOff, t.debug.stats().tris];
    const ms = [];
    for (let i = 0; i < 20; i++) {
      await t.debug.edit((w) => (i % 2 ? w.remove(`I|-6|0|2`, { record: false }) : w.add({ t: 'flowers', x: -6, y: 0, z: 2 }, { record: false })));
      ms.push(t.debug.stats().recomputeMs);
    }
    ms.sort((a, b) => a - b);
    out.recompute = [ms[0], ms[5], ms[10], ms[15], ms[19]];
    out.stuck = t.debug.stuck();
    // a Show me highlight up (T2.4): every wish a resident can be given here, each shown in turn. The ghost is baked
    // into one mesh, so the worst piece (the 10-part birdhouse, the 2.6k-triangle apple tree) costs the rings + 1 call
    const W = await import(new URL('js/town/wishes.js', location.href).href);
    const v = t.debug.state().roster.find((u) => u.status === 'resident');
    const hl = { shown: 0, ghostMeshes: 0, worstCalls: null, worstTris: null };
    for (const tpl of Object.keys(W.TEMPLATE)) {
      t.endShowMe();
      if (t.debug.state().roster.find((u) => u.id === v.id)?.wish) t.debug.expire(v.id);
      if (!t.debug.wish(v.id, tpl).ok || !t.showMe({ villager: v.id })) continue;
      await T.sleep(250);
      const c1 = T.render(), tr1 = hw.renderer.info.render.triangles;
      g.visible = false;
      const c0 = T.render(), tr0 = hw.renderer.info.render.triangles;
      g.visible = true;
      let gm = 0;
      t.debug.actors.render.ghost?.traverse((o) => { if (o.isMesh) gm++; });
      const row = { tpl, calls: c1 - c0, tris: tr1 - tr0, ghost: gm };
      hl.shown++;
      hl.ghostMeshes = Math.max(hl.ghostMeshes, gm);
      if (!hl.worstCalls || row.calls > hl.worstCalls.calls) hl.worstCalls = row;
      if (!hl.worstTris || row.tris > hl.worstTris.tris) hl.worstTris = row;
    }
    t.endShowMe();
    out.highlight = hl;
    // the night worst case (T1.13): the lot cleared, so all 20 camp (10 tents with lanterns) and each carries a lantern
    await t.debug.edit((w) => w.clear({ record: false }));
    hw.state.set({ timeFlow: false, time: 0.9 });
    t.debug.advance(30);
    await T.sleep(1500);
    const camp = t.debug.state().roster.filter((v) => v.status === 'camping').length;
    const lanterns = t.debug.sim.villagers.filter((v) => v.flags?.lantern).length;
    const nOn = T.render(), nTriOn = hw.renderer.info.render.triangles;
    g.visible = false;
    const nOff = T.render(), nTriOff = hw.renderer.info.render.triangles;
    g.visible = true;
    out.night = { campers: camp, tents: t.debug.sim.tents().length, lanterns, calls: nOn - nOff, tris: [nTriOn - nTriOff, t.debug.stats().tris] };
    return out;
  });
  check('R11', 'PERF_TOWN with spawn=20: 20 residents of all 8 jobs after the campers move in', r.pop === 20 && r.residents === 20 && r.jobs === 8 && r.campers === 20, r);
  check('R11', 'render calls (town on) − (town hidden) ≤ 14', r.calls[2] <= 14 && r.calls[2] > 0, r.calls);
  check('R11', 'town triangles ≤ 20k', r.tris[0] <= 20000 && r.tris[1] <= 20000, r.tris);
  check('R11', 'night with 20 campers (10 tents, lanterns): ≤ 14 calls and ≤ 20k triangles', r.night.campers === 20 && r.night.tents === 10 && r.night.lanterns >= 20 && r.night.calls <= 14 && r.night.tris[0] <= 20000 && r.night.tris[1] <= 20000, r.night);
  check('R11', 'every feasible wish shown with Show me (T2.4): the ghost is one mesh, render calls ≤ 20, town triangles ≤ 20k + the ghost piece (≤ 22.6k)',
    r.highlight.shown >= 10 && r.highlight.ghostMeshes === 1 && r.highlight.worstCalls.calls <= 20 && r.highlight.worstTris.tris <= 22600, r.highlight);
  check('R11', 'town update EMA ≤ 0.6 ms', r.updateMs <= 0.6, r.updateMs);
  check('R11', 'recompute (buildWorldModel + re-binding + wish checks) ≤ 2 ms (median of 20; min, quartiles, max shown)', r.recompute[2] <= 2, r.recompute);
  check('R11', 'no console errors (budget)', problems.length === 0, problems.slice(0, 4));
  await ctx.close();
});

// ---------------------------------------------------------------- R12: determinism (§12.13 edit + advance)
await section('determinism', async () => {
  const runOnce = async () => {
    const { ctx, page, problems } = await game('clean=1&nosave=1&ui=0&town=fresh&townseed=7&townspeed=60', { init: HIDDEN });
    const s = await page.evaluate(async () => {
      const hw = __hw, t = hw.town;
      let sky = 0.42;
      const adv = (sec) => { hw.state.set({ timeFlow: true, time: sky }); t.debug.advance(sec); sky = hw.state.time; };
      await t.debug.edit((w) => hw.blueprints.stamp('cottage', { animate: false, record: false }));
      adv(120);                                                          // Mabel comes up the lane and moves in
      await t.debug.edit((w) => {                                        // a second home with flowers round it (a gardener's recipe)
        for (const p of __fx.SMALL_HOME(-8, 4)) w.add(p, { record: false });
        for (const [x, z] of [[-9, 7], [-7, 7], [-6, 6], [-9, 3]]) w.add({ t: 'flowers', x, y: 0, z }, { record: false });
      });
      adv(400);
      let roof = [];
      await t.debug.edit((w) => {                                        // the cottage's front roof comes off …
        roof = [...w.entries.values()].filter((e) => e.def.layer === 'R' && e.p.z >= 0).map((e) => ({ ...e.p }));
        for (const p of roof) w.remove(w.keyOf(p), { record: false });
      });
      adv(100);
      await t.debug.edit((w) => { for (const p of roof) w.add(p, { record: false }); });   // … and goes back on
      adv(200);
      await t.debug.edit((w) => w.add({ t: 'bench', x: 2, y: 0, z: 4 }, { record: false }));
      adv(3600);
      const st = t.debug.state();
      return { json: JSON.stringify(st), clock: st.clock, roster: st.roster.map((v) => `${v.name}:${v.status}:${v.wish?.tpl || '-'}`), grants: st.stats };
    });
    await ctx.close();
    return { ...s, problems };
  };
  const a = await runOnce();
  const b = await runOnce();
  let diff = null;
  if (a.json !== b.json) { let i = 0; while (i < a.json.length && a.json[i] === b.json[i]) i++; diff = [a.json.slice(Math.max(0, i - 80), i + 80), b.json.slice(Math.max(0, i - 80), i + 80)]; }
  check('R12', 'two pages, same seed and scripted debug.edit edits → identical debug.state() after advance(3600)', a.json === b.json && a.roster.length > 0,
    diff ? { diff } : { clock: a.clock, roster: a.roster, stats: a.grants });
  check('R12', 'no console errors (determinism)', a.problems.length === 0 && b.problems.length === 0, [...a.problems, ...b.problems].slice(0, 4));
});

// ---------------------------------------------------------------- R17: the passer-by on a phone (§4.7)
await section('passerby', async () => {
  const { ctx, page, problems } = await game('nosave=1', { mobile: true, init: RECORD });
  const r = await page.evaluate(async () => {
    const hw = __hw, t = hw.town, T = __t, THREE = hw.THREE;
    const out = { homes: t.debug.homes().filter((h) => h.home).length };
    // a first visit opens the welcome card (bubbles stay hidden under it); the player taps the meadow round it
    await T.sleep(800);
    const wel = document.querySelector('.hw-welcome-wrap.is-open');
    out.welcome = !!wel;
    if (wel) wel.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    let id = null;
    for (let i = 0; i < 600 && !id; i++) { id = t.debug.state().passerby?.id || null; if (!id) await T.sleep(100); }
    out.id = id;
    out.spawnClock = t.clock();
    if (!id) return out;
    const el = hw.renderer.domElement, v = new THREE.Vector3();
    let run = 0, best = 0, last = t.clock(), off = 0, arrows = 0, watch = null, gone = false, seenOn = false;
    for (let i = 0; i < 1500; i++) {
      await T.sleep(80);
      const p = t.debug.actors.positionOf(id);
      if (!t.debug.state().passerby || !p) { gone = true; break; }
      const W = el.clientWidth, H = el.clientHeight, I = hw.rig.insets;
      v.set(p.x, p.y + 0.6, p.z).project(hw.camera);
      const x = (v.x + 1) / 2 * W, y = (1 - v.y) / 2 * H;
      const inFree = v.z < 1 && x >= I.left && x <= W - I.right && y >= I.top && y <= H - I.bottom;
      const c = t.clock();
      if (inFree && p.visible) { run += c - last; best = Math.max(best, run); seenOn = true; }
      else {
        run = 0;
        if (p.visible) {
          off++;
          const a = document.querySelector('.hw-bubble.k-passerby.is-edge:not(.is-hid)');
          if (a && a.getBoundingClientRect().width > 0) arrows++;
        }
      }
      last = c;
      if (!watch) {
        for (const tEl of document.querySelectorAll('.hw-toast.has-act')) {
          if (/passes by/.test(tEl.textContent)) { watch = tEl.querySelector('.hw-toast-act'); out.watchLabel = watch?.textContent; }
        }
      }
      if (seenOn && run === 0 && c - out.spawnClock > 45) break;          // on screen and gone again: on its way back
    }
    Object.assign(out, { best: +best.toFixed(2), off, arrows, gone });
    if (watch && !gone) {
      watch.click();
      await T.sleep(1500);
      const p = t.debug.actors.positionOf(id), g = hw.rig.goal.target;
      out.following = t.debug.following();
      out.camDist = p ? +Math.hypot(g.x - p.x, g.z - p.z).toFixed(2) : null;
    }
    return out;
  });
  check('R17', 'a passer-by comes along on the welcome lot (no Home there)', !!r.id && r.homes === 0, { id: r.id, homes: r.homes, at: r.spawnClock });
  check('R17', 'the passer-by is inside the free area for ≥ 3 s in a row (portrait phone)', r.best >= 3, { best: r.best });
  check('R17', 'while off-screen its edge arrow is shown', r.off > 0 && r.arrows / r.off >= 0.8, { off: r.off, arrows: r.arrows });
  check('R17', 'the tip toast has a 👀 Watch button that starts following the passer-by', r.watchLabel === '👀 Watch' && r.following === r.id && r.camDist !== null && r.camDist < 3,
    { label: r.watchLabel, following: r.following, camDist: r.camDist });
  check('R17', 'no console errors (passerby)', problems.length === 0, problems.slice(0, 4));
  await ctx.close();
});

// ---------------------------------------------------------------- R4: the first wish, Show me, taps on the ring / ghost (§7.6, §12.7)
await section('showme', async () => {
  const { ctx, page, problems } = await game('bp=cottage&nosave=1&town=fresh&townseed=3', { mobile: true, init: RECORD });
  const r = await page.evaluate(async () => {
    const hw = __hw, t = hw.town, T = __t, out = {};
    hw.state.set({ timeFlow: false, time: 0.42 });
    const until = async (fn, ms) => { const t0 = performance.now(); while (performance.now() - t0 < ms) { const v = fn(); if (v) return v; await T.sleep(50); } return null; };
    // the first traveller and the move-in at real speed, then town time to the first wish (deterministic ticks)
    const mv = await until(() => __ev.find((e) => e[0] === 'town-movein'), 150000);
    out.moveinAt = mv ? mv[1] : null;
    let wish = null;
    for (let i = 0; i < 240 && !wish; i++) { t.debug.step(1); wish = __ev.find((e) => e[0] === 'town-wish'); }
    out.wishAt = wish ? wish[1] : null;
    const id = mv?.[2]?.villager?.id;
    out.id = id;
    out.tpl = t.debug.state().roster.find((v) => v.id === id)?.wish?.tpl || null;
    // bring the wisher into view, still (the hud places bubbles per frame)
    const p0 = t.debug.actors.positionOf(id);
    if (p0) hw.rig.setView({ t: [p0.x, 1, p0.z], th: hw.rig.goal.theta, ph: 1.05, r: 22 }, true);
    await T.sleep(900);
    const bubble = await until(() => document.querySelector(`.hw-bubble.k-wish[data-key="w:${id}"]:not(.is-hid)`), 8000);
    out.bubble = !!bubble;
    if (!bubble) return out;
    bubble.click();
    const card = await until(() => document.querySelector('.hw-tcard.is-open.k-villager'), 3000);
    out.card = !!card;
    const show = card?.querySelector('[data-act="showme"]');
    out.showBtn = !!show;
    if (!show) return out;
    const evN = __ev.length;
    show.click();
    await T.sleep(1200);
    const after = __ev.slice(evN);
    const plan = t.debug.plan(id);
    const first = plan?.recs?.[0];
    out.piece = hw.state.pieceId; out.want = first?.rec?.t || null;
    if (!first) { out.noPlan = { tpl: t.debug.state().roster.find((v) => v.id === id)?.wish, after: after.map((e) => e[0]) }; return out; }
    out.toasts = after.filter((e) => e[0] === 'toast').map((e) => e[2].text);
    out.showing = t.showing();
    out.highlight = !!t.debug.actors.render.ghost && t.debug.actors.render.ghostHolder.visible;
    out.ringsDrawn = t.debug.actors.render.rings.count;
    out.cardClosed = !document.querySelector('.hw-tcard.is-open.k-villager');
    // a tap on the projected ring centre builds exactly there and grants the wish
    const w0 = t.cozy().warmth, g0 = __ev.filter((e) => e[0] === 'town-granted').length, n0 = hw.world.count;
    const s = T.toScreen(new hw.THREE.Vector3(first.x, first.y + 0.02, first.z));
    const tapAt = performance.now();
    hw.rig.onTap(s.x, s.y, { pointerType: 'touch' });
    const placed = hw.world.get(hw.world.keyOf(hw.world.normalize(first.rec) || first.rec));
    out.placed = placed ? { t: placed.t, x: placed.x, z: placed.z, r: placed.r ?? 0 } : null;
    out.planRec = { t: first.rec.t, x: first.rec.x, z: first.rec.z, r: first.rec.r ?? 0 };
    out.added = hw.world.count - n0;
    const gr = await until(() => __ev.filter((e) => e[0] === 'town-granted').length > g0, 4000);
    out.grantMs = gr ? Math.round(performance.now() - tapAt) : null;
    out.warm = [w0, t.cozy().warmth];
    out.endEv = __ev.some((e) => e[0] === 'town-showme-end');
    // a second wish (debug.wish), granted by a tap on the projected top of its ghost
    t.debug.step(4);
    const w2 = ['w_door_bench', 'w_well', 'w_washing_line', 'w_veg_patch', 'w_chickens', 'w_mailbox', 'w_apple_tree', 'w_shade_tree', 'w_birds']
      .find((tpl) => t.debug.wish(id, tpl).ok) || null;
    out.second = w2;
    if (w2) {
      t.showMe({ villager: id });
      await T.sleep(600);
      const pl = t.debug.plan(id), e1 = pl.recs[0];
      const box = new hw.THREE.Box3().setFromObject(t.debug.actors.render.ghost);
      const top = T.toScreen(new hw.THREE.Vector3(e1.x, box.max.y - 0.15, e1.z));
      const ring = T.toScreen(new hw.THREE.Vector3(e1.x, e1.y, e1.z));
      out.ghostPx = Math.round(Math.hypot(top.x - ring.x, top.y - ring.y));
      const g1 = __ev.filter((e) => e[0] === 'town-granted').length;
      hw.rig.onTap(top.x, top.y, { pointerType: 'touch' });
      out.ghostPlaced = !!hw.world.get(hw.world.keyOf(hw.world.normalize(e1.rec) || e1.rec));
      out.ghostGrant = !!(await until(() => __ev.filter((e) => e[0] === 'town-granted').length > g1, 4000));
    }
    // undo never takes a grant back
    const wb = t.cozy().warmth, grants = t.debug.state().stats.granted;
    hw.builder.undo();
    await T.sleep(1200);
    out.undo = { warmth: [wb, t.cozy().warmth], granted: [grants, t.debug.state().stats.granted], wish: t.debug.state().roster.find((v) => v.id === id)?.wish?.tpl || null };
    return out;
  });
  check('R4', 'the first wish comes ≤ 40 s (town clock) after the move-in', r.moveinAt !== null && r.wishAt !== null && r.wishAt - r.moveinAt <= 40,
    { moveinAt: r.moveinAt, wishAt: r.wishAt, tpl: r.tpl });
  check('R4', 'DOM click on the bubble opens the card; Show me hands over the first part piece, draws the highlight, closes the card',
    r.bubble && r.card && r.showBtn && r.piece === r.want && r.highlight && r.ringsDrawn > 0 && r.cardClosed, { piece: r.piece, want: r.want, rings: r.ringsDrawn });
  check('R4', 'exactly one toast after Show me (the town\'s hint, none from the builder)', r.toasts?.length === 1 && /Tap a glowing spot/.test(r.toasts[0]), r.toasts);
  check('R4', 'a tap on the projected ring centre builds exactly the planned rec and grants ≤ 1 s later, Warmth up; the highlight ends',
    !!r.placed && r.added === 1 && r.placed.t === r.planRec.t && r.placed.x === r.planRec.x && r.placed.z === r.planRec.z && r.grantMs !== null && r.grantMs <= 1000
    && r.warm[1] > r.warm[0] && r.endEv, { placed: r.placed, plan: r.planRec, grantMs: r.grantMs, warm: r.warm });
  check('R4', 'a second wish is granted by a tap on the projected top of its ghost', !!r.second && r.ghostPlaced && r.ghostGrant, { tpl: r.second, ghostPx: r.ghostPx });
  check('R4', 'builder.undo() takes nothing back: still granted, Warmth unchanged', r.undo && r.undo.warmth[0] === r.undo.warmth[1] && r.undo.granted[0] === r.undo.granted[1], r.undo);

  // variants on a fresh town: (a) a door facing away from the camera, (b) Floor 3 with an outdoor wish, (c) w_soft_rug inside, (d) w_supper_table
  const v = await page.evaluate(async () => {
    const hw = __hw, t = hw.town, T = __t, out = {};
    const HOUSE = (x0, z0) => {                                          // 4 × 3 on foundations, door on +Z at x0 + 1, one bed
      const P = [];
      for (let x = x0; x <= x0 + 3; x++) for (let z = z0; z <= z0 + 2; z++) { P.push({ t: 'foundation', x, y: 0, z }); P.push({ t: 'roof_flat', x, y: 1, z, h: 0 }); }
      for (let x = x0; x <= x0 + 3; x++) { P.push({ t: 'wall', a: 'x', x, y: 0, z: z0 }); P.push({ t: x === x0 + 1 ? 'wall_door' : 'wall', a: 'x', x, y: 0, z: z0 + 3 }); }
      for (let z = z0; z <= z0 + 2; z++) { P.push({ t: 'wall', a: 'z', x: x0, y: 0, z }); P.push({ t: 'wall', a: 'z', x: x0 + 4, y: 0, z }); }
      P.push({ t: 'bed', x: x0, y: 0, z: z0 });
      return P;
    };
    await t.debug.edit((w) => __fx.build(w, HOUSE(-2, -2)));
    t.debug.reset();
    const id = t.debug.spawn('gardener');
    t.debug.step(8);
    const tap = (e, dy = 0.02) => { const s = T.toScreen(new hw.THREE.Vector3(e.x, e.y + dy, e.z)); hw.rig.onTap(s.x, s.y, { pointerType: 'touch' }); };
    const toastsSince = (n) => __ev.slice(n).filter((e) => e[0] === 'toast').map((e) => e[2].text);
    // (a) the camera behind the house: Show me for a door wish turns the view to face the door (out = +Z)
    hw.rig.setView({ t: [0, 1, 0], th: Math.PI, ph: 1.05, r: 24 }, true);
    const wa = t.debug.wish(id, 'w_door_bench');
    t.showMe({ villager: id });
    await T.sleep(300);
    const th = hw.rig.goal.theta;
    out.a = { ok: wa.ok, theta: +th.toFixed(3), off: +Math.abs(Math.atan2(Math.sin(th), Math.cos(th))).toFixed(3) };
    t.endShowMe();
    t.debug.expire(id);
    // (b) on Floor 3 with an outdoor wish: Show me puts the view on the ground floor, no builder toast
    t.debug.step(4);
    hw.state.set({ level: 2, seeAll: false });
    await T.sleep(200);
    const wb = t.debug.wish(id, 'w_shade_tree').ok ? 'w_shade_tree' : t.debug.wish(id, 'w_birds').ok ? 'w_birds' : null;
    const nb = __ev.length;
    t.showMe({ villager: id });
    await T.sleep(900);
    out.b = { tpl: wb, level: hw.state.level, toasts: toastsSince(nb) };
    t.endShowMe();
    t.debug.expire(id);
    // (c) w_soft_rug: the spot's own level, no "see all", a steep view into the cutaway
    t.debug.step(4);
    hw.rig.setView({ t: [0, 1, 0], th: 0.5, ph: 1.2, r: 24 }, true);
    const wc = t.debug.wish(id, 'w_soft_rug');
    t.showMe({ villager: id });
    await T.sleep(400);
    const pc = t.debug.plan(id);
    out.c = { ok: wc.ok, level: hw.state.level, spotLevel: pc?.recs?.[0]?.level, seeAll: hw.state.seeAll, phi: +hw.rig.goal.phi.toFixed(3), piece: hw.state.pieceId };
    t.endShowMe();
    t.debug.expire(id);
    // (d) w_supper_table: the table, then the chair in hand and the rings move; two chairs grant it
    t.debug.step(4);
    const wd = t.debug.wish(id, 'w_supper_table');
    out.d = { ok: wd.ok, reason: wd.reason, steps: [] };
    if (wd.ok) {
      t.showMe({ villager: id });
      await T.sleep(500);
      const g0 = __ev.filter((e) => e[0] === 'town-granted').length;
      for (let k = 0; k < 4; k++) {
        const pl = t.debug.plan(id);
        if (!pl || !pl.recs.length) break;
        const e0 = pl.recs[0];
        const step = { piece: hw.state.pieceId, want: e0.rec.t, at: [e0.rec.x, e0.rec.z] };
        tap(e0);
        await T.sleep(1100);
        step.placed = !!hw.world.get(hw.world.keyOf(hw.world.normalize(e0.rec) || e0.rec));
        out.d.steps.push(step);
        if (__ev.filter((e) => e[0] === 'town-granted').length > g0) { out.d.granted = true; break; }
      }
    }
    return out;
  });
  check('R4', '(a) a door facing away from the camera: after Show me the view faces the door (within 1.2 rad)', v.a.ok && v.a.off <= 1.2, v.a);
  check('R4', '(b) on Floor 3, an outdoor wish\'s Show me sets state.level 0 with no builder toast', !!v.b.tpl && v.b.level === 0
    && v.b.toasts.length === 1 && /Tap a glowing spot/.test(v.b.toasts[0]), v.b);
  check('R4', '(c) w_soft_rug: state.level = the spot\'s level, seeAll false, rig.goal.phi ≤ 0.9', v.c.ok && v.c.level === v.c.spotLevel && v.c.seeAll === false
    && v.c.phi <= 0.9, v.c);
  check('R4', '(d) w_supper_table: the table, then the chair in hand with the rings moved; two chairs grant it', v.d.ok && v.d.granted === true
    && v.d.steps[0]?.want === 'table' && v.d.steps[0]?.piece === 'table' && v.d.steps.slice(1).every((s) => s.want === 'chair' && s.piece === 'chair')
    && v.d.steps.length === 3 && v.d.steps.every((s) => s.placed), v.d);
  check('R4', 'no console errors (showme)', problems.length === 0, problems.slice(0, 4));
  await ctx.close();
});

// ---------------------------------------------------------------- R5: gifts (§8): unlocked on schedule, kept for good
await section('gifts', async () => {
  // a real profile: the town is saved on the device (no nosave, no town=fresh)
  const { ctx, page, problems } = await game('bp=cottage&townseed=6', { init: RECORD });
  const GRANTABLE = ['w_door_lamp', 'w_well', 'w_washing_line', 'w_veg_patch', 'w_chickens', 'w_mailbox', 'w_apple_tree', 'w_door_bench', 'w_pond', 'w_hive'];
  const a = await page.evaluate(async (list) => {
    const hw = __hw, t = hw.town, T = __t, out = { grants: [] };
    hw.state.set({ timeFlow: false, time: 0.42 });
    const id = t.debug.spawn('gardener');
    for (let k = 0; k < 2; k++) {
      t.debug.step(4);
      const tpl = list.find((x) => t.debug.wish(id, x).ok);
      const g = tpl ? t.debug.grant(id, { build: true }) : null;
      out.grants.push([tpl, !!g?.granted]);
    }
    await T.sleep(300);
    const gifts = __ev.filter((e) => e[0] === 'town-gift');
    out.gifts = gifts.map((e) => e[2].id);
    out.gift = out.gifts[0] || null;
    out.inTray = !!out.gift && hw.catalog.piecesIn('garden').some((d) => d.id === out.gift);
    out.mirror = JSON.parse(localStorage.getItem('hearthwood.unlocks.v1') || '[]');
    out.saved = Object.keys(JSON.parse(localStorage.getItem('hearthwood.town.v1') || '{}').unlocks || {});
    out.info = out.gift ? t.giftInfo(out.gift) : null;
    return out;
  }, GRANTABLE);
  check('R5', 'two granted wishes (debug.grant { build: true }) → exactly one town-gift, and the gift is in the Garden tray', a.grants.every((g) => g[1]) && a.gifts.length === 1 && a.inTray, a);
  check('R5', 'the unlock is written to the tiny mirror key and the town save; giftInfo names the granter', a.mirror.includes(a.gift) && a.saved.includes(a.gift)
    && a.info?.from === 'Mabel' && a.info?.isNew === true, { mirror: a.mirror, saved: a.saved, info: a.info });
  await reopen(page, 'bp=cottage&townseed=6');
  const b = await page.evaluate((gift) => {
    const hw = __hw;
    const out = { reload: hw.catalog.piecesIn('garden').some((d) => d.id === gift) };
    hw.state.set({ village: false });
    out.off = hw.catalog.piecesIn('garden').some((d) => d.id === gift);
    hw.state.set({ village: true });
    return out;
  }, a.gift);
  check('R5', 'reload (same profile) → still unlocked; villagers off → still in the tray', b.reload && b.off, b);
  await ctx.route('**/js/town/index.js', (route) => route.fulfill({ status: 500, contentType: 'text/plain', body: 'boom' }));
  const n0 = problems.length;
  await reopen(page, 'bp=cottage&townseed=6');
  const c = await page.evaluate((gift) => ({ town: __hw.town, tray: __hw.catalog.piecesIn('garden').some((d) => d.id === gift), errors: __hw.errors.map((e) => e.where) }), a.gift);
  const allow = [/module town/, /status of 500/];
  check('R5', 'the town fails to import (index.js → 500): the gift is still in the tray, no errors outside the module report', c.town === null && c.tray
    && unexpected(problems.slice(n0), allow).length === 0, { ...c, problems: unexpected(problems.slice(n0), allow).slice(0, 3) });
  check('R5', 'no console errors before the import failure (gifts)', problems.slice(0, n0).length === 0, problems.slice(0, n0).slice(0, 4));
  await ctx.close();
});

// ---------------------------------------------------------------- R15: share codes with gift pieces; Pick on a locked gift (§8.3)
await section('share', async () => {
  const { ctx, page, problems } = await game('clean=1&nosave=1&town=fresh');
  const r = await page.evaluate(async () => {
    const hw = __hw, T = __t, out = {};
    const locked = hw.catalog.allDefs().filter((d) => d.gift && d.hidden).map((d) => d.id);
    out.locked = locked.length;
    const g = locked.includes('gift_gnome') ? 'gift_gnome' : locked[0];
    out.gift = g;
    hw.world.clear({ record: false });
    hw.world.add({ t: 'foundation', x: 0, y: 0, z: 0 }, { record: false });
    hw.world.add({ t: g, x: 2, y: 0, z: 2 }, { record: false });
    hw.world.add({ t: 'gift_tea_table', x: -2, y: 0, z: 2 }, { record: false });
    const code = await hw.storage.exportCode(hw.world.serialize());
    out.codeOk = typeof code === 'string' && /^HW[01]:/.test(code);
    const data = await hw.storage.importCode(code);
    out.dropped = data?.dropped || 0;
    out.pieces = data?.pieces?.length || 0;
    hw.world.clear({ record: false });
    const n = hw.loadBuild(data);
    out.loaded = n;
    out.has = !!hw.world.get(`I|2|0|2`) && hw.world.get(`I|2|0|2`).t === g;
    // Pick on the placed (still locked) gift copies it
    hw.state.set({ tool: 'pick', seeAll: true, level: 0 });
    hw.rig.setView({ t: [5, 0.5, 5], th: 0.6, ph: 1.0, r: 14 }, true);
    await T.sleep(400);
    const e = hw.world.entry('I|2|0|2');
    const box = new hw.THREE.Box3().setFromObject(e.obj);
    const c = box.getCenter(new hw.THREE.Vector3());
    const s = T.toScreen(c);
    hw.rig.onTap(s.x, s.y, { pointerType: 'mouse' });
    await T.sleep(200);
    out.pick = { piece: hw.state.pieceId, tool: hw.state.tool, stillLocked: !!hw.catalog.getDef(g).hidden };
    return out;
  });
  check('R15', 'a share code holding gift pieces imports with dropped 0 and loads them', r.codeOk && r.dropped === 0 && r.pieces === 3 && r.loaded === 3 && r.has, r);
  check('R15', 'Pick on a placed gift copies it while it is still locked', r.pick.piece === r.gift && r.pick.stillLocked, r.pick);
  check('R15', 'no console errors (share)', problems.length === 0, problems.slice(0, 4));
  await ctx.close();
});

// ---------------------------------------------------------------- R9: photo mode (§10.8)
await section('photo', async () => {
  const { ctx, page, problems } = await game('bp=cottage&nosave=1&town=fresh&townseed=8', { mobile: true });
  const r = await page.evaluate(async () => {
    const hw = __hw, t = hw.town, T = __t, out = {};
    hw.state.set({ timeFlow: false, time: 0.42 });
    const id = t.debug.spawn('gardener');
    t.debug.step(8);
    const tpl = ['w_door_lamp', 'w_well', 'w_washing_line', 'w_mailbox', 'w_apple_tree'].find((x) => t.debug.wish(id, x).ok);
    await T.sleep(400);
    const p = t.debug.actors.positionOf(id);
    hw.rig.setView({ t: [p.x, 1, p.z], th: hw.rig.goal.theta, ph: 1.05, r: 20 }, true);
    await T.sleep(1000);
    const vis = () => [...document.querySelectorAll('.hw-bubble:not(.is-hid)')].filter((e) => e.getBoundingClientRect().width > 0 && getComputedStyle(e).visibility !== 'hidden'
      && !e.closest('.is-off') && getComputedStyle(e.closest('.hw-bubbles') || e).display !== 'none' && getComputedStyle(e.closest('.hw-bubbles') || e).visibility !== 'hidden').length;
    out.before = { bubbles: vis(), tpl };
    const calls0 = T.render();
    hw.state.set({ photoMode: true });
    await T.sleep(800);
    out.drawn = { villager: !!t.debug.actors.positionOf(id)?.visible, group: t.debug.actors.group.visible, calls: t.debug.stats().calls };
    out.bubbles = vis();
    out.hearth = (() => { const h = document.querySelector('.hw-hearth'); return !!h && h.getBoundingClientRect().width > 0 && getComputedStyle(h).visibility !== 'hidden' && getComputedStyle(h).display !== 'none'; })();
    const n0 = hw.world.count;
    const q = T.toScreen(new hw.THREE.Vector3(p.x, p.y + 0.9, p.z));
    hw.rig.onTap(q.x, q.y, { pointerType: 'touch' });
    const g = T.toScreen(new hw.THREE.Vector3(14, 0.1, 14));
    hw.rig.onTap(g.x, g.y, { pointerType: 'touch' });
    await T.sleep(400);
    out.tap = { added: hw.world.count - n0, card: !!document.querySelector('.hw-tcard.is-open') };
    hw.state.set({ photoMode: false });
    void calls0;
    return out;
  });
  check('R9', 'photo mode: villagers drawn (town group visible, draw calls > 0)', r.drawn.villager && r.drawn.group && r.drawn.calls > 0, r.drawn);
  check('R9', 'photo mode: bubbles and the hearth hidden', r.before.bubbles > 0 && r.bubbles === 0 && !r.hearth, { before: r.before, after: r.bubbles, hearth: r.hearth });
  check('R9', 'photo mode: a canvas tap does nothing (no piece, no card)', r.tap.added === 0 && !r.tap.card, r.tap);
  check('R9', 'no console errors (photo)', problems.length === 0, problems.slice(0, 4));
  await ctx.close();
});

// ---------------------------------------------------------------- R16: villagers off / on (§10.7, §12.10)
await section('villageoff', async () => {
  const { ctx, page, problems } = await game('bp=cottage&nosave=1&town=fresh&townseed=12', { mobile: true });
  const r = await page.evaluate(async () => {
    const hw = __hw, t = hw.town, T = __t, out = {};
    hw.state.set({ timeFlow: true, time: 0.42 });
    for (const j of ['gardener', 'baker']) t.debug.spawn(j);
    await t.debug.edit((w) => { for (const p of __fx.SMALL_HOME(-8, 4)) w.add(p, { record: false }); });
    t.debug.advance(30);
    const id = t.debug.state().roster[0].id;
    t.debug.wish(id, ['w_door_lamp', 'w_well', 'w_washing_line', 'w_mailbox'].find((x) => t.debug.wish(id, x).ok) || 'w_well');
    await T.sleep(800);
    const shown = () => [...document.querySelectorAll('.hw-bubble:not(.is-hid)')].filter((e) => e.getBoundingClientRect().width > 0 && !e.closest('.is-off')).length;
    const hearth = () => { const h = document.querySelector('.hw-hearth'); return !!h && !h.hidden && h.getBoundingClientRect().width > 0 && getComputedStyle(h).display !== 'none'; };
    out.on0 = { hearth: hearth(), talkers: t.audible().talkers.length };
    hw.state.set({ village: false });
    await T.sleep(500);
    const c0 = t.clock();
    await T.sleep(1500);
    out.off = { bubbles: shown(), hearth: hearth(), talkers: t.audible().talkers.length, clock: [c0, t.clock()], calls: (T.render(), t.debug.stats().calls), group: t.debug.actors.group.visible, bubbleList: t.bubbles().length };
    // villagers back on at a different hour: everyone is re-seated (a free main-region cell outdoors, or indoors)
    hw.state.set({ time: 0.62 });
    hw.state.set({ village: true });
    await T.sleep(600);
    const st = t.debug.state();
    const nav = t.debug.model.nav;
    out.seat = st.roster.map((v) => ({ id: v.id, loc: v.loc, plan: v.plan, cell: v.cell, ok: v.loc === 'in' || v.loc === 'gone' || (v.cell && nav.isFree(v.cell[0], v.cell[1]) && nav.inMain(v.cell[0], v.cell[1])) || v.plan === 'walk' || v.plan === 'door' }));
    out.stuck = t.debug.stuck();
    out.on1 = { hearth: hearth(), clockRuns: (await T.sleep(1200), t.clock() > out.off.clock[1]) };
    return out;
  });
  check('R16', 'villagers off: no bubbles, no hearth, no chatter, nothing drawn, the clock frozen', r.off.bubbles === 0 && !r.off.hearth && r.off.talkers === 0
    && r.off.clock[0] === r.off.clock[1] && r.off.bubbleList === 0 && !r.off.group && r.on0.hearth, { on: r.on0, off: r.off });
  check('R16', 'villagers on: every villager re-seated on a free main-region cell or indoors; stuck() empty; the clock runs again', r.seat.every((s) => s.ok)
    && r.stuck.length === 0 && r.on1.clockRuns && r.on1.hearth, { seat: r.seat, stuck: r.stuck, on: r.on1 });
  check('R16', 'no console errors (villageoff)', problems.length === 0, problems.slice(0, 4));
  await ctx.close();
});

// ---------------------------------------------------------------- R8: guided mode (§4.1): paused while unfinished, a traveller at the finish
await section('guided', async () => {
  const { ctx, page, problems } = await game('clean=1&nosave=1&town=fresh&townseed=13&townspeed=10', { init: RECORD });
  const r = await page.evaluate(async () => {
    const hw = __hw, t = hw.town, T = __t, out = {};
    hw.state.set({ timeFlow: false, time: 0.42 });
    hw.blueprints.startGuided('cottage');
    const items = hw.blueprints.get('cottage').pieces.map((p) => ({ ...p }));
    const lastI = items.findIndex((p) => p.t === 'bed');                   // the bed goes in last
    const last = items.splice(lastI, 1)[0];
    await t.debug.edit((w) => { for (const p of items) w.add(p, { record: true }); });
    const p1 = hw.blueprints.progress();
    t.debug.advance(40);
    out.unfinished = { progress: [p1.done, p1.total], guided: t.debug.state().guided, traveller: __ev.some((e) => e[0] === 'town-traveller') };
    await t.debug.edit((w) => w.add(last, { record: true }));
    const p2 = hw.blueprints.progress();
    const c0 = t.clock();
    let tr = null;
    for (let i = 0; i < 60 && !tr; i++) { t.debug.step(1); tr = __ev.find((e) => e[0] === 'town-traveller'); }
    out.finish = { progress: [p2.done, p2.total], active: hw.blueprints.active(), delay: tr ? +(tr[1] - c0).toFixed(2) : null };
    // three town minutes later, without pressing Close
    t.debug.advance(180);
    out.later = {
      movein: __ev.some((e) => e[0] === 'town-movein'), wish: __ev.some((e) => e[0] === 'town-wish'), active: hw.blueprints.active(),
      dims: t.bubbles().map((b) => b.dim), guided: t.debug.state().guided,
    };
    // erase one guide piece: the guide is unfinished again, so the town pauses again
    const flower = items.find((p) => p.t === 'flowers' || p.t === 'lavender');
    await t.debug.edit((w) => w.remove(w.keyOf(w.normalize(flower) || flower), { record: true }));
    t.debug.step(2);
    const p3 = hw.blueprints.progress();
    out.erased = { progress: [p3.done, p3.total], guided: t.debug.state().guided, dims: t.bubbles().filter((b) => b.kind !== 'sleep').map((b) => b.dim) };
    return out;
  });
  check('R8', 'while the guide is unfinished: guided, and no traveller', r.unfinished.guided === true && !r.unfinished.traveller && r.unfinished.progress[0] < r.unfinished.progress[1], r.unfinished);
  check('R8', 'at done === total: a traveller ≤ 4 s + 0.5 s later', r.finish.progress[0] === r.finish.progress[1] && r.finish.delay !== null && r.finish.delay <= 4.5, r.finish);
  check('R8', 'three town minutes later, the finished guide still active (no Close): a move-in, a new wish, every bubble dim: false', r.later.movein && r.later.wish
    && r.later.active === 'cottage' && r.later.guided === false && r.later.dims.length > 0 && r.later.dims.every((d) => d === false), r.later);
  check('R8', 'erasing one guide piece pauses the town again (guided, bubbles dimmed)', r.erased.guided === true && r.erased.progress[0] < r.erased.progress[1]
    && r.erased.dims.every((d) => d === true), r.erased);
  check('R8', 'no console errors (guided)', problems.length === 0, problems.slice(0, 4));
  await ctx.close();
});

// ---------------------------------------------------------------- R10: persistence (§12.9)
await section('persist', async () => {
  const { ctx, page, problems } = await game('clean=1&townseed=21', { init: RECORD });
  const KEY = 'hearthwood.town.v1';
  const a = await page.evaluate(async () => {
    const hw = __hw, t = hw.town, T = __t;
    hw.state.set({ timeFlow: false, time: 0.42 });
    hw.world.clear({ record: false });
    for (const p of [...__fx.SMALL_HOME(-6, -2), ...__fx.SMALL_HOME(3, -2)]) hw.world.add(p, { record: true });
    await T.sleep(1200);
    t.debug.spawn('gardener'); t.debug.spawn('baker');
    t.debug.step(8);
    const id = t.debug.state().roster[0].id;
    ['w_door_lamp', 'w_well', 'w_washing_line', 'w_mailbox', 'w_door_bench'].find((x) => t.debug.wish(id, x).ok);
    t.debug.step(4);
    await T.sleep(600);
    window.dispatchEvent(new Event('pagehide'));                            // the autosave and the town save flush
    const saved = JSON.parse(localStorage.getItem('hearthwood.town.v1') || 'null');
    const st = t.debug.state();
    return { saved: saved && { clock: saved.clock, n: saved.villagers.length }, roster: st.roster.map((v) => ({ id: v.id, name: v.name, homeId: v.homeId, bed: v.bed, status: v.status, wish: v.wish && `${v.wish.tpl}@${v.wish.born}` })) };
  });
  await reopen(page, 'townseed=21');
  const b = await page.evaluate(async () => {
    const hw = __hw, t = hw.town, T = __t;
    await T.sleep(2500);
    const ready = __ev.find((e) => e[0] === 'town-ready');
    const st = t.debug.state();
    const out = {
      readyClock: ready ? ready[1] : null, roster: st.roster.map((v) => ({ id: v.id, name: v.name, homeId: v.homeId, bed: v.bed, status: v.status, wish: v.wish && `${v.wish.tpl}@${v.wish.born}` })),
      status: __ev.filter((e) => e[0] === 'town-status').length, toasts: __ev.filter((e) => e[0] === 'toast').map((e) => e[2].text), homes: st.homes.filter((h) => h.home).length,
    };
    // hidden: the town clock is frozen
    Object.defineProperty(document, 'visibilityState', { get: () => 'hidden', configurable: true });
    await T.sleep(300);
    const h0 = t.clock();
    await T.sleep(15000);
    out.hidden = [h0, t.clock()];
    delete document.visibilityState;
    return out;
  });
  check('R10', 'reload → the same ids, names, homes, beds and wishes; the clock resumes where it was saved (± 1 s)', b.roster.length === 2
    && JSON.stringify(b.roster) === JSON.stringify(a.roster) && a.saved && b.readyClock !== null && Math.abs(b.readyClock - a.saved.clock) <= 1,
    { before: a.roster, after: b.roster, saved: a.saved, readyClock: b.readyClock });
  check('R10', 'reloading a lot with 2 homes: 0 town-status events, 0 toasts, identical bindings', b.homes === 2 && b.status === 0 && b.toasts.length === 0, { homes: b.homes, status: b.status, toasts: b.toasts });
  check('R10', 'the town clock is frozen while the page is hidden (15 s)', b.hidden[0] === b.hidden[1], b.hidden);
  await reopen(page, 'townseed=21&nosave=1');
  const c = await page.evaluate(async (k) => {
    const hw = __hw, t = hw.town, T = __t;
    const before = localStorage.getItem(k);
    t.debug.spawn('farmer');
    const id = t.debug.state().roster[0].id;
    t.debug.expire(id);
    t.debug.advance(90);
    await T.sleep(3000);
    window.dispatchEvent(new Event('pagehide'));
    document.dispatchEvent(new Event('visibilitychange'));
    return { same: localStorage.getItem(k) === before, len: before?.length || 0 };
  }, KEY);
  check('R10', 'nosave=1 → the town key is byte-identical after a session', c.same && c.len > 0, c);
  check('R10', 'no console errors (persist)', problems.length === 0, problems.slice(0, 4));
  await ctx.close();
});

// ---------------------------------------------------------------- R18: taps near villagers keep building (§12.7)
await section('taps', async () => {
  const { ctx, page, problems } = await game('bp=cottage&nosave=1&town=fresh&townseed=14', { mobile: true });
  const r = await page.evaluate(async () => {
    const hw = __hw, t = hw.town, T = __t, out = {};
    hw.state.set({ timeFlow: false, time: 0.42, seeAll: true, level: 0 });
    const id = t.debug.spawn('gardener');
    t.debug.step(4);
    // pose the villager on the doorstep (0, 2), facing out, until further notice
    const v = t.debug.sim.villagers.find((u) => u.id === id);
    const y = t.debug.model.nav.surfaceAt(1, 4.75);
    v._steps = [{ k: 'pose', pose: 'stand', at: [1, y, 4.75], face: 0, dur: Infinity, cell: [0, 2] }];
    v.plan = { ...v.plan, t1: t.clock() };
    t.debug.step(2);
    hw.rig.setView({ t: [1.5, 1.2, 4.5], th: 0.25, ph: 1.18, r: 15 }, true);
    await T.sleep(1200);
    const sel = []; const off = hw.events.on('town-select', (d) => sel.push(d.id));
    const pos = t.debug.actors.positionOf(id);
    out.pos = pos && [+pos.x.toFixed(2), +pos.z.toFixed(2)];
    hw.state.set({ tool: 'build' });
    hw.builder.selectPiece('wall_door');
    await T.sleep(200);
    // (1) the wall right of the door, 2.0 m above the doorstep
    const n1 = hw.world.get('W|x|1|0|2')?.t;
    const s1 = T.toScreen(new hw.THREE.Vector3(3, 2.0, 4));
    out.hitWall = t.hitTest(s1.x, s1.y, 12);
    hw.rig.onTap(s1.x, s1.y, { pointerType: 'touch' });
    await T.sleep(300);
    out.wall = { before: n1, after: hw.world.get('W|x|1|0|2')?.t };
    // (2) 20 px beside the villager's body
    const chest = T.toScreen(new hw.THREE.Vector3(pos.x, pos.y + 0.8, pos.z));
    const sideX = chest.x - (0.3 * (hw.camera.projectionMatrix.elements[5] * hw.renderer.domElement.clientHeight / 2) / hw.camera.position.distanceTo(new hw.THREE.Vector3(pos.x, pos.y + 0.8, pos.z))) - 20;
    const placed = []; const off2 = hw.events.on('placed', (d) => placed.push(d.def.id));
    out.hitSide = t.hitTest(sideX, chest.y, 12);
    hw.rig.onTap(sideX, chest.y, { pointerType: 'touch' });
    await T.sleep(300);
    out.side = { placed: placed.slice(), card: !!document.querySelector('.hw-tcard.is-open.k-villager') };
    off2();
    // (3) the same tap on the villager's chest with the Erase tool opens the card
    hw.state.set({ tool: 'erase' });
    await T.sleep(200);
    const n3 = hw.world.count;
    hw.rig.onTap(chest.x, chest.y, { pointerType: 'touch' });
    await T.sleep(600);
    out.erase = { select: sel.slice(), card: !!document.querySelector('.hw-tcard.is-open.k-villager'), removed: n3 - hw.world.count };
    off();
    hw.state.set({ tool: 'build' });
    return out;
  });
  check('R18', 'Door in hand, a villager on the doorstep: a tap on the wall 2.0 m above the doorstep swaps in the door and opens no card', !!r.wall.before && r.wall.before !== 'wall_door'
    && r.wall.after === 'wall_door' && r.hitWall === null && r.erase.select.length <= 1, r);
  check('R18', 'a tap 20 px beside the villager\'s body places the door and opens no card', r.hitSide === null && r.side.placed.includes('wall_door') && !r.side.card, r.side);
  check('R18', 'the same tap on the villager\'s chest with the Erase tool opens the villager card (and erases nothing)', r.erase.select.length === 1 && r.erase.card && r.erase.removed === 0, r.erase);
  check('R18', 'no console errors (taps)', problems.length === 0, problems.slice(0, 4));
  await ctx.close();
});

// ---------------------------------------------------------------- R19: migration — an existing build meets a fresh town (§1.3)
await section('migration', async () => {
  const setup = async () => {
    const ctx = await browser.newContext({ ...devices['iPhone 13'], deviceScaleFactor: 1 });
    await ctx.addInitScript(RECORD);
    const page = await ctx.newPage();
    const problems = [];
    page.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !/GPU stall|ReadPixels/.test(m.text())) problems.push(`[${m.type()}] ${m.text()}`); });
    page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`));
    // an existing player: an autosave with the cottage, settings from before the town, no town key
    await page.goto(`${base}?clean=1&nosave=1&ui=0&town=0`);
    await page.waitForFunction(() => window.__hwReady === true, null, { timeout: 60000 });
    await page.evaluate(() => {
      const hw = __hw;
      hw.blueprints.stamp('cottage', { animate: false, record: false });
      hw.storage.autosave(hw.world.serialize(), hw.rig.getView());
      localStorage.removeItem('hearthwood.town.v1');
      localStorage.removeItem('hearthwood.unlocks.v1');
    });
    await page.goto(`${base}`);
    await page.waitForFunction(() => window.__hwReady === true, null, { timeout: 60000 });
    await injectHelpers(page);
    return { ctx, page, problems };
  };
  const probe = (page) => page.evaluate(async () => {
    const hw = __hw, t = hw.town, T = __t;
    const until = async (fn, ms) => { const t0 = performance.now(); while (performance.now() - t0 < ms) { const v = fn(); if (v) return v; await T.sleep(60); } return null; };
    const card = await until(() => document.querySelector('.hw-tcard.is-open.k-intro'), 8000);
    // the card stays open for a while: no traveller is scheduled meanwhile
    const c0 = t.clock();
    while (t.clock() < c0 + 9) await T.sleep(150);
    return { card: !!card, intro: t.view().intro, waited: +(t.clock() - c0).toFixed(1), traveller: __ev.some((e) => e[0] === 'town-traveller'), homes: t.debug.state().homes.filter((h) => h.home).length };
  });
  {
    const { ctx, page, problems } = await setup();
    const a = await probe(page);
    const q = await page.evaluate(async () => {
      const btn = document.querySelector('.hw-tcard.is-open.k-intro [data-act="quiet"]');
      btn?.click();
      await __t.sleep(400);
      return { clicked: !!btn, village: __hw.state.village, card: !!document.querySelector('.hw-tcard.is-open.k-intro'), tips: __hw.town.debug.sim.tips.intro };
    });
    check('R19', 'an autosave and no town key → the intro card; no traveller while it is open', a.card && a.intro && a.homes === 1 && !a.traveller && a.waited >= 9, a);
    check('R19', 'Keep my meadow quiet → state.village false (and the answer is kept)', q.clicked && q.village === false && !q.card && q.tips === 1, q);
    check('R19', 'no console errors (migration, quiet)', problems.length === 0, problems.slice(0, 4));
    await ctx.close();
  }
  {
    const { ctx, page, problems } = await setup();
    const a = await probe(page);
    const l = await page.evaluate(async () => {
      const hw = __hw, t = hw.town, T = __t;
      const btn = document.querySelector('.hw-tcard.is-open.k-intro [data-act="lovely"]');
      const c0 = t.clock();
      btn?.click();
      const t0 = performance.now();
      let tr = null;
      while (!tr && performance.now() - t0 < 40000) { tr = __ev.find((e) => e[0] === 'town-traveller'); await T.sleep(60); }
      return { clicked: !!btn, village: hw.state.village, delay: tr ? +(tr[1] - c0).toFixed(2) : null, migration: tr?.[2]?.migration ?? null,
        toast: __ev.filter((e) => e[0] === 'toast').map((e) => e[2].text).find((x) => /Word of your lovely home/.test(x || '')) || null };
    });
    check('R19', 'Lovely → a traveller ≤ FIRST_ARRIVAL_DELAY + 1 s later, with the migration toast', a.card && l.clicked && l.village === true && l.delay !== null
      && l.delay <= 6 && l.migration === true && !!l.toast, { ...l, card: a.card });
    check('R19', 'no console errors (migration, lovely)', problems.length === 0, problems.slice(0, 4));
    await ctx.close();
  }
});

// ---------------------------------------------------------------- R20: two tabs on one profile (§12.9)
await section('twotabs', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(RECORD);
  const problems = [];
  const open = async () => {
    const page = await ctx.newPage();
    page.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !/GPU stall|ReadPixels/.test(m.text())) problems.push(`[${m.type()}] ${m.text()}`); });
    page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`));
    await page.goto(`${base}?bp=cottage&townseed=41`);
    await page.waitForFunction(() => window.__hwReady === true, null, { timeout: 60000 });
    await injectHelpers(page);
    return page;
  };
  const A = await open();
  const B = await open();
  await B.evaluate(async () => {
    __hw.town.debug.spawn('gardener');
    await __t.sleep(300);
    window.dispatchEvent(new Event('pagehide'));                            // B writes the town key
  });
  const a1 = await A.evaluate(async () => {
    const T = __t;
    const t0 = performance.now();
    let el = null;
    while (!el && performance.now() - t0 < 6000) { el = [...document.querySelectorAll('.hw-toast.has-act')].find((x) => /another tab/.test(x.textContent)); await T.sleep(100); }
    return { toast: el ? el.textContent : null, button: el?.querySelector('.hw-toast-act')?.textContent || null, readOnly: __hw.town.debug.state().readOnly,
      ev: __ev.filter((e) => e[0] === 'toast').map((e) => e[2].text).filter((x) => /another tab/.test(x || '')).length };
  });
  await B.close({ runBeforeUnload: false });
  await A.evaluate(() => __t.sleep(500));
  const key0 = await A.evaluate(() => localStorage.getItem('hearthwood.town.v1'));
  const a2 = await A.evaluate(async () => {
    const hw = __hw, t = hw.town, T = __t;
    t.debug.spawn('baker');
    t.debug.advance(60);
    const c0 = t.clock();
    while (t.clock() < c0 + 4) await T.sleep(200);                           // a few real seconds of play too
    window.dispatchEvent(new Event('pagehide'));
    return { roster: t.debug.state().roster.length };
  });
  const key1 = await A.evaluate(() => localStorage.getItem('hearthwood.town.v1'));
  check('R20', 'another tab writes the town → this tab turns read-only and shows the Reload toast once', !!a1.toast && a1.button === 'Reload' && a1.readOnly === true && a1.ev === 1, a1);
  check('R20', 'the read-only tab never writes the town key again (byte-identical after 60 s of play there)', !!key0 && key0 === key1 && a2.roster >= 1, { len: key0?.length, same: key0 === key1 });
  check('R20', 'no console errors (twotabs)', problems.length === 0, problems.slice(0, 4));
  await ctx.close();
});

// ---------------------------------------------------------------- R21: life you can watch (§1.4, §5)
await section('watch', async () => {
  const { ctx, page, problems } = await game('clean=1&nosave=1&ui=0&town=fresh&townseed=9&spawn=20&townspeed=60', { init: HIDDEN, w: 800, h: 500 });
  const r = await page.evaluate(async () => {
    const hw = __hw, t = hw.town, out = {};
    await t.debug.edit((w) => __fx.build(w, __fx.PERF_TOWN()));
    t.debug.advance(8);
    out.residents = t.debug.state().roster.filter((v) => v.status === 'resident').length;
    hw.state.set({ timeFlow: true, time: 0.42 });
    t.debug.sim.debug.resetOutdoors();
    t.debug.advance(3600);
    out.flowing = +t.debug.outdoors().toFixed(3);
    out.stuckF = t.debug.stuck().length;
    out.slipsF = t.debug.stats().slips;
    // night strolls never trap anyone in a daytime bed (feel check): at 10:00 nobody sleeps or strolls
    while (Math.abs(hw.state.time - 10 / 24) > 0.003) t.debug.step(1);
    out.at10 = t.debug.state().roster.filter((v) => v.pose === 'sleep' || v.act === 'nightStroll').map((v) => `${v.name}:${v.act}/${v.pose}`);
    hw.state.set({ timeFlow: false, time: 0.42 });
    t.debug.advance(1);
    t.debug.sim.debug.resetOutdoors();
    t.debug.advance(600);
    out.pinned = +t.debug.outdoors().toFixed(3);
    out.stuckP = t.debug.stuck().length;
    return out;
  });
  check('R21', 'PERF_TOWN, 20 villagers, the day passing: share of town time with ≥ 1 villager outdoors ≥ 0.85 over an hour', r.residents === 20 && r.flowing >= 0.85, r);
  check('R21', 'pinned at Morning (0.42): ≥ 0.95', r.pinned >= 0.95, { pinned: r.pinned });
  check('R21', 'after an hour of days and nights (night strolls included), nobody is asleep or strolling at 10:00; stuck() empty', r.at10.length === 0
    && r.stuckF === 0 && r.stuckP === 0, { at10: r.at10, stuck: [r.stuckF, r.stuckP], slips: r.slipsF });
  check('R21', 'no console errors (watch)', problems.length === 0, problems.slice(0, 4));
  await ctx.close();
});

// ---------------------------------------------------------------- repair round 1 (T1.x): a camper named on the town card, a hint
// Show me that ends once its bed is placed, Follow kept through a real pinch, no vacancy flash for a bed a camper takes,
// "back home" only for the old bed
await section('repair1', async () => {
  const { ctx, page, problems } = await game('bp=cottage&nosave=1&town=fresh&townseed=4&spawn=gardener,beekeeper', { mobile: true });
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p[0], y: p[1], id: i, radiusX: 4, radiusY: 4, force: 1 })) });
  const wait = (ms) => new Promise((res) => setTimeout(res, ms));
  const two = async (a0, b0, a1, b1, steps = 10) => {
    await touch('touchStart', [a0, b0]);
    for (let i = 1; i <= steps; i++) { await wait(30); await touch('touchMove', [[a0[0] + (a1[0] - a0[0]) * i / steps, a0[1] + (a1[1] - a0[1]) * i / steps], [b0[0] + (b1[0] - b0[0]) * i / steps, b0[1] + (b1[1] - b0[1]) * i / steps]]); }
    await touch('touchEnd', []); await wait(400);
  };
  const scr = (p) => page.evaluate((p) => { const v = __t.toScreen(new __hw.THREE.Vector3(p[0], p[1], p[2])); return [Math.round(v.x), Math.round(v.y)]; }, p);
  await page.evaluate(() => __t.sleep(1500));
  const rows = await page.evaluate(() => ({ rows: __hw.town.view().couldMoveIn.map((r) => r.text), roster: __hw.town.debug.state().roster.map((v) => `${v.name}:${v.status}`) }));
  check('T1.7', 'a full Home with a camper waiting: the "one more bed" row names the camper, not a newcomer', rows.rows.length === 1 && /could move in from the camp/.test(rows.rows[0]) && rows.roster.some((x) => /camping/.test(x)), rows);
  // Follow (§10.2): a pinch out, a pinch in, a one-finger-still pinch and a twist keep it; a two-finger slide ends it
  await page.evaluate(() => { __hw.town.follow('v1'); return __t.sleep(1200); });
  const f = { start: await page.evaluate(() => __hw.town.debug.following()) };
  const r0 = await page.evaluate(() => __hw.rig.goal.radius);
  const c = await scr(await page.evaluate(() => { const p = __hw.town.debug.actors.positionOf('v1'); return [p.x, p.y + 0.8, p.z]; }));
  await two([c[0] - 50, c[1]], [c[0] + 50, c[1]], [c[0] - 90, c[1]], [c[0] + 90, c[1]]);
  f.pinchOut = await page.evaluate(() => __hw.town.debug.following());
  f.radius = [+r0.toFixed(1), await page.evaluate(() => +__hw.rig.goal.radius.toFixed(1))];
  await two([105, 300], [285, 300], [155, 300], [235, 300]);
  f.pinchIn = await page.evaluate(() => __hw.town.debug.following());
  await two([135, 300], [215, 300], [135, 300], [295, 300]);
  f.oneFinger = await page.evaluate(() => __hw.town.debug.following());
  await two([145, 300], [245, 300], [149, 264], [241, 336]);
  f.twist = await page.evaluate(() => __hw.town.debug.following());
  await two([150, 260], [240, 260], [150, 350], [240, 350]);
  f.slide = await page.evaluate(() => __hw.town.debug.following());
  check('T1.4', 'Follow keeps the villager through a pinch out / in, a one-finger-still pinch and a twist (real touch); a two-finger slide ends it',
    f.start === 'v1' && f.pinchOut === 'v1' && f.radius[1] < f.radius[0] && f.pinchIn === 'v1' && f.oneFinger === 'v1' && f.twist === 'v1' && f.slide === null, f);
  // the town card row's Show me: tap the ghost bed (real touch) → placed, and Show me ends instead of moving on
  const homeId = await page.evaluate(() => __hw.town.view().couldMoveIn[0]?.homeId);
  const shown = await page.evaluate((id) => __hw.town.showMe({ home: id, hint: 'bed' }), homeId);
  await page.evaluate(() => __t.sleep(2500));
  const g = await page.evaluate(() => { const o = __hw.town.debug.actors.render.ghost, p = new __hw.THREE.Vector3(); o?.getWorldPosition(p); return [p.x, p.y + 0.3, p.z]; });
  const gs = await scr(g);
  const beds0 = await page.evaluate(() => [...__hw.world.entries.values()].filter((e) => e.p.t === 'bed').length);
  await touch('touchStart', [gs]); await wait(60); await touch('touchEnd', []);
  await page.evaluate(() => __t.sleep(2500));
  const h = await page.evaluate((b0) => ({ beds: [b0, [...__hw.world.entries.values()].filter((e) => e.p.t === 'bed').length], showing: __hw.town.showing() }), beds0);
  check('T1.2', 'a "one more bed" Show me: tapping the ghost places the bed and the Show me ends (no second ghost bed)', shown && h.beds[1] === h.beds[0] + 1 && h.showing === null, h);
  await ctx.close();
  // vacancy and status wording: undo a clear (the old bed) → "back home"; a new hut → "moving into"; no vacancy bubble
  const p2 = await game('clean=1&nosave=1&town=fresh&townseed=4', { mobile: true });
  const v = await p2.page.evaluate(async () => {
    const hw = __hw, t = hw.town, out = {};
    const log = []; hw.events.on('toast', (d) => log.push(d?.text || ''));
    // step the town clock a tick at a time and look at the sim's own home views after each (no frame timing)
    const run = (secs) => { let vac = 0; for (let k = 0; k < secs * 4; k++) { t.debug.step(1); if (t.debug.sim.homeViews().some((h) => h.bubble === 'vacancy')) vac++; } return vac; };
    await t.debug.edit((w) => __fx.build(w, __fx.SMALL_HOME(0, 0)));
    t.debug.spawn('gardener');
    t.debug.advance(5);
    await t.debug.edit((w) => w.clear());
    t.debug.advance(70);
    log.length = 0;
    hw.world.undo();
    await t.debug.edit(() => {});
    const vu = run(10);
    await __t.sleep(1500);
    out.undo = { toasts: log.slice(), vacancy: vu, roster: t.debug.state().roster.map((x) => x.status) };
    await t.debug.edit((w) => w.clear());
    t.debug.advance(10);
    log.length = 0;
    await t.debug.edit((w) => { for (const p of __fx.SMALL_HOME(-6, 2)) w.add(p, { record: false }); });
    const vh = run(10);
    await __t.sleep(1500);
    out.hut = { toasts: log.slice(), vacancy: vh, roster: t.debug.state().roster.map((x) => x.status) };
    return out;
  });
  check('T1.6', 'undoing a clear: "back home" (the old bed); a camper into a new hut: "moving into"', v.undo.toasts.some((x) => /is back home/.test(x)) && !v.undo.toasts.some((x) => /moving into/.test(x))
    && v.hut.toasts.some((x) => /is moving into/.test(x)) && !v.hut.toasts.some((x) => /back home/.test(x)), v);
  check('T1.5', 'no vacancy bubble (nor its tip) for a bed a camper is about to take', v.undo.vacancy === 0 && v.hut.vacancy === 0 && ![...v.undo.toasts, ...v.hut.toasts].some((x) => /A free bed/.test(x)), v);
  check('T1.x', 'no console errors (repair1)', problems.length === 0 && p2.problems.length === 0, [...problems, ...p2.problems].slice(0, 4));
  await p2.ctx.close();
});

// ---------------------------------------------------------------- round-2 repairs (T2.x), real touch on an iPhone 13
await section('repair2', async () => {
  const { ctx, page, problems } = await game('clean=1&nosave=1&town=fresh&spawn=gardener,beekeeper', { mobile: true });
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p[0], y: p[1], id: i, radiusX: 4, radiusY: 4, force: 1 })) });
  const wait = (ms) => new Promise((res) => setTimeout(res, ms));
  const tap = async (p) => { await touch('touchStart', [p]); await wait(60); await touch('touchEnd', []); await wait(900); };
  await page.evaluate(() => __t.sleep(2500));
  // T2.2: the camp bubble high on screen; its one-time tip toast must not cover it, and it goes back once the toast has
  const camp = await page.evaluate(async () => {
    const box = () => {
      const el = document.querySelector('.hw-bubble.k-camp');
      if (!el || el.classList.contains('is-hid') || !el.offsetParent) return null;
      const b = el.getBoundingClientRect();
      const toasts = [...document.querySelectorAll('.hw-toast:not(.out)')].map((t) => { const r = t.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)]; });
      return { bub: [Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)], toasts, text: [...document.querySelectorAll('.hw-toast')].map((t) => t.textContent.slice(0, 48)) };
    };
    __hw.rig.setView({ t: [-21, 0.5, 10], th: 0, ph: 0.95, r: 22 }, true);
    const out = { during: [], after: null };
    for (let i = 0; i < 4; i++) { await __t.sleep(700); out.during.push(box()); }
    for (let i = 0; i < 20 && document.querySelector('.hw-toast:not(.out)'); i++) await __t.sleep(500);
    await __t.sleep(800);
    out.after = box();
    return out;
  });
  const over = (b, t) => b[0] < t[2] && b[2] > t[0] && b[1] < t[3] && b[3] > t[1];
  const tipped = camp.during.some((d) => d && d.text.some((x) => /without a bed camp/.test(x)));
  check('T2.2', 'the camp bubble near the top: the one-time camp tip toast never covers it, and it returns under its anchor once the toast has gone',
    tipped && camp.during.every((d) => d && d.toasts.every((t) => !over(d.bub, t))) && camp.after && camp.after.bub[1] < camp.during[camp.during.length - 1].bub[1], camp);
  // T2.1: the camp Show me with no Home on the lot. Every plan rec has a rotation, the ghost foundation is drawn (one
  // mesh, a finite box), and a tap away from the rings builds where it was aimed, not on the plan
  const s1 = await page.evaluate(async () => {
    const hw = __hw, t = hw.town, A = t.debug.actors, out = {};
    out.shown = t.showMe({ camp: true });
    await __t.sleep(2500);
    const g = A.render.ghost;
    let meshes = 0; g?.traverse((o) => { if (o.isMesh) meshes++; });
    const b = g ? new hw.THREE.Box3().setFromObject(g) : null;
    out.ghost = { meshes, finite: !!b && !b.isEmpty() && [b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z].every(Number.isFinite) };
    const el = hw.renderer.domElement, W = el.clientWidth, H = el.clientHeight, I = hw.rig.insets;
    out.corners = [[I.left + 12, I.top + 12], [W - I.right - 12, I.top + 12], [I.left + 12, H - I.bottom - 12], [W - I.right - 12, H - I.bottom - 12]].map(([x, y]) => A.highlightHit(x, y));
    const recs = t.debug.sim.planFor({ camp: true })?.plan?.recs || [];
    out.recsR = recs.every((e) => Number.isFinite(e.rec.r));
    out.ringKeys = recs.filter((e) => (e.part | 0) === (recs[0]?.part | 0)).map((e) => hw.world.keyOf(hw.world.normalize(e.rec)));
    const r0 = recs[0], s = __t.toScreen(new hw.THREE.Vector3(r0.x, r0.y, r0.z));
    out.ring = [Math.round(s.x), Math.round(s.y)];
    out.far = [I.left + 30, Math.round(H - I.bottom - 40)];
    out.farHit = A.highlightHit(out.far[0], out.far[1]);
    out.piece = hw.state.pieceId;
    out.keys0 = [...hw.world.entries.keys()];
    return out;
  });
  await tap(s1.far);
  const k1 = await page.evaluate(() => [...__hw.world.entries.keys()]);
  const farNew = k1.filter((k) => !s1.keys0.includes(k));
  await tap(s1.ring);
  const k2 = await page.evaluate(() => [...__hw.world.entries.keys()]);
  const ringNew = k2.filter((k) => !k1.includes(k));
  const r1 = { ...s1, keys0: undefined, farNew, ringNew };
  check('T2.1', 'camp Show me with no Home: the ghost foundation is drawn (one mesh, finite box); highlightHit at the four corners of the free area is −1',
    s1.shown && s1.recsR && s1.ghost.meshes === 1 && s1.ghost.finite && s1.corners.every((i) => i === -1) && s1.farHit === -1, r1);
  check('T2.1', 'with the foundation in hand, a real tap on grass far from the rings builds there (not on the plan); a tap on a ring builds on it',
    s1.piece === 'foundation' && farNew.length === 1 && !s1.ringKeys.includes(farNew[0]) && ringNew.length === 1 && s1.ringKeys.includes(ringNew[0]), r1);
  // T2.3: the tray handle's label after a reload with the tray collapsed
  const h0 = await page.evaluate(() => { __hw.town.endShowMe(); const h = document.querySelector('button.hw-handle'); h.click(); return h.getAttribute('aria-label'); });
  await reopen(page, 'clean=1&nosave=1&town=0');
  const h1 = await page.evaluate(() => { const h = document.querySelector('button.hw-handle'); return { label: h.getAttribute('aria-label'), expanded: h.getAttribute('aria-expanded'), collapsed: document.querySelector('.hw-tray').classList.contains('is-collapsed') }; });
  await page.evaluate(() => document.querySelector('button.hw-handle').click());
  check('T2.3', 'a reload with the tray collapsed: the handle reads "Show pieces" (aria-expanded false)', h0 === 'Show pieces' && h1.collapsed && h1.label === 'Show pieces' && h1.expanded === 'false', { afterTap: h0, afterReload: h1 });
  // T2.1 (b): the w_neighbour wish's Show me (the same SMALL_HOME layout beside a cottage)
  const p2 = await game('bp=cottage&nosave=1&town=fresh&spawn=gardener&wish=w_neighbour', { mobile: true });
  const nb = await p2.page.evaluate(async () => {
    const hw = __hw, t = hw.town, A = t.debug.actors;
    await __t.sleep(2500);
    const v = t.debug.state().roster.find((u) => u.wish?.tpl === 'w_neighbour');
    const shown = !!v && t.showMe({ villager: v.id });
    await __t.sleep(2500);
    const g = A.render.ghost, b = g ? new hw.THREE.Box3().setFromObject(g) : null;
    const el = hw.renderer.domElement, W = el.clientWidth, H = el.clientHeight, I = hw.rig.insets;
    return {
      shown, ghost: !!b && !b.isEmpty() && [b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z].every(Number.isFinite),
      corners: [[I.left + 12, I.top + 12], [W - I.right - 12, I.top + 12], [I.left + 12, H - I.bottom - 12], [W - I.right - 12, H - I.bottom - 12]].map(([x, y]) => A.highlightHit(x, y)),
    };
  });
  check('T2.1', 'the w_neighbour Show me: a drawn ghost with a finite box; highlightHit at the four corners is −1', nb.shown && nb.ghost && nb.corners.every((i) => i === -1), nb);
  check('T2.x', 'no console errors (repair2)', problems.length === 0 && p2.problems.length === 0, [...problems, ...p2.problems].slice(0, 4));
  await p2.ctx.close();
  await ctx.close();
});

// ---------------------------------------------------------------- the feel check's must-fixes (M2): asleep the right way round
await section('feel', async () => {
  const { ctx, page, problems } = await game('bp=cottage&nosave=1&town=fresh&townseed=3&spawn=gardener&time=0.05', { mobile: true });
  const r = await page.evaluate(async () => {
    const hw = __hw, t = hw.town, T = __t;
    hw.state.set({ timeFlow: false, time: 0.05, seeAll: false, level: 0 });
    await T.sleep(1500);
    const v = t.debug.state().roster[0];
    const a = t.debug.actors.actor(v.id);
    const bedRec = [...hw.world.entries.values()].find((e) => e.p.t === 'bed').p;
    const r = (bedRec.r | 0) & 3;
    const fwd = [[0, 1], [1, 0], [0, -1], [-1, 0]][r];                     // the bed's local +Z in world (its foot end)
    const c = [(bedRec.x + 0.5) * 2, (bedRec.z + 0.5) * 2];
    const head = new hw.THREE.Vector3(0, 1.0, 0).applyMatrix4(a.matrix);
    const feet = new hw.THREE.Vector3(0, 0.1, 0).applyMatrix4(a.matrix);
    const along = (p) => (p.x - c[0]) * fwd[0] + (p.z - c[1]) * fwd[1];
    return { pose: v.pose, plan: v.plan, head: +along(head).toFixed(2), feet: +along(feet).toFixed(2) };
  });
  check('FEEL', 'asleep in bed: the head lies toward the headboard (the bed\'s local −Z), the feet toward its foot', r.pose === 'sleep' && r.head < -0.2 && r.feet > 0.2, r);
  check('FEEL', 'no console errors (feel)', problems.length === 0, problems.slice(0, 4));
  await ctx.close();
});

await browser.close();
server.close();

// ---------------------------------------------------------------- R13: batch-regress in both modes (opt-in: long)
if (argv.includes('--batch')) {
  for (const env of [{}, { HW_TOWN: '1' }]) {
    const label = env.HW_TOWN ? 'HW_TOWN=1 (town=fresh&townrender=0)' : 'town=0';
    const res = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'batch-regress.mjs')], { env: { ...process.env, ...env }, encoding: 'utf8', maxBuffer: 64 << 20 });
    const out = `${res.stdout || ''}`;
    const summary = (out.match(/(\d+) passed, (\d+) failed/) || [])[0] || 'no summary';
    for (const line of out.split('\n').filter((l) => l.startsWith('FAIL'))) console.log(`  ${line}`);
    check('R13', `batch-regress passes with ${label}`, res.status === 0, summary);
  }
} else if (!ONLY.length) skip('R13', 'batch-regress in both modes', 'run with --batch');

console.log(`\n${passes} passed, ${fails} failed, ${skips} skipped`);
process.exit(fails ? 1 : 0);
