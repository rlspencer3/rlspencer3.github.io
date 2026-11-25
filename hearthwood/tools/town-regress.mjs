#!/usr/bin/env node
// Hearthwood Living Town end-to-end regression (docs/LIVING.md §13.4, WP4). Run: node tools/town-regress.mjs
// (several minutes headless; prints PASS / FAIL / SKIP per check and exits 1 on any FAIL).
//   --batch   also runs tools/batch-regress.mjs twice (R13: town=0 and HW_TOWN=1; about 15 minutes more)
//   --only=a,b   run only these sections (params, spine, off, settings, crash, importfail, autosave, parts, offline,
//                blueprints, homes, arrival, evict, stuck, budget, determinism, passerby, showme, gifts, share, photo,
//                villageoff, guided, persist, taps, migration, twotabs, watch, repair1, repair2, repair3, repair4, repair5,
//                repair6, repair7, repair8, repair9, feel)
// M0: the spine — boot / ready / restore recompute (R1), the TownAPI and debug shape, params, enabled(), clocks,
// recompute scheduling, rig pass-through, failure isolation, an import failure (R5's last case), the core edits
// (state keys, env exports, catalog.setHidden, the autosave guard) and R13.
// M1 (the vertical slice): R2 homes and recipes per blueprint, R3 the first traveller and move-in, R6 never evict, R7
// never stuck, R11 the PERF_TOWN budget, R12 determinism, R14 offline (sw.js, done early), R17 the passer-by on a phone,
// and every blueprint booting with the town on.
// M2: R4 the first wish, Show me and taps on the ring / ghost (+ the four variants), R5 gifts, R8 guided mode, R9 photo
// mode, R10 persistence, R15 share codes and Pick with gift pieces, R16 villagers off / on, R18 taps near villagers, R19
// the migration intro card, R20 two tabs, R21 life you can watch (+ nobody in bed or night-strolling at 10:00), and a
// `feel` section (sleepers lie with the head at the headboard). Repair rounds: `repair1` (T1.x), `repair2` (T2.x:
// a Show me ghost never claims every tap, the camp tip toast never covers the camp bubble, the tray handle's label
// after a reload) and `repair3` (T3.x: no decoy rings and faint rings that look faint, a wish bubble on the framed
// farmhouse, a Show me swap spot wins over a villager on it, the checklist chip never over a bubble, housemates never on
// one lunch spot, thank-yous that differ) and `repair4` (T4.x: an off-screen wisher's edge bubble never under the
// checklist chip, wish bubbles never culled while their villager is on screen, no two villagers posed on one spot, and
// the drawn backstop) and `repair5` (T5.x: housemates indoors each in a place of their own, never on a bed; campers of a
// built-over tent mouth side by side; the backstop for lying and indoor bodies; a generic overlap audit of full town
// days on six layouts; the 20-villager tick judged on the fastest batch) and `repair6` (T6.x: a sitter in a dining
// chair on its drawn seat, tucked up to the table; furnishing a home, or taking a seat away, never leaves a housemate
// inside the new piece or in mid-air; housemates' edge bubbles merge into one ×2; debug.spawn never reuses a pending
// traveller's id) and `repair7` (T7.x: a sleeper whose bed is replaced in one edit is booked again at once, and sleeps in
// a newly given bed; edge bubbles of different kinds never merge, they fan apart; a ×N badge sits opposite the edge
// arrow) and `repair8` (T8.x, the round-7 review: a waiting sleeper keeps their bed and gets it back, a new bed in a
// full home takes nobody's; edge bubbles never flip sides, never sit on the wrapped rail of a short phone, never under
// a neighbour's arrow in landscape; a wish and a dream on one point side by side; a merged dreams' count readable);
// and `repair9` (T9.x, the round-8 re-check: a waiting sleeper whose bed is upstairs in a roofless farmhouse sleeps in
// the building they wait in and is never walked out by edits; a 💤 never on a bubble set beside; a bubble beside
// another never jumps across it, nor as its roof crosses the edge; on a 320×568 phone no arrow over a disc);
// R11 also shows every feasible wish with Show me (the ghost is one mesh,
// T2.4), and judges its wall-clock budgets on the fastest of several batches (T2.5, T3.7).
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
/** A page on a new context; `init` (a function) runs before any page script (event recorders, hidden pages); `device`
 *  (context options) gives another phone than the iPhone 13 of `mobile`. */
async function game(q, opts = {}) {
  let g;
  const br = opts.browser || browser;
  if (opts.init || opts.device) {
    const ctx = await br.newContext(opts.device || (opts.mobile ? { ...devices['iPhone 13'], deviceScaleFactor: 1 } : { viewport: { width: opts.w || 1280, height: opts.h || 800 }, deviceScaleFactor: 1 }));
    if (opts.init) await ctx.addInitScript(opts.init);
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
    // the same update, timed in a tight loop (R3 T3.7, as T2.5 made L1 / B9 robust): on a shared, loaded machine one
    // stretch of frames can cost several times the next, and the live EMA is one sample of it. Nine 60-update batches
    // (one town second each, ticks included) with a short pause between them: the budget is checked against the
    // fastest (the cost without the noise), with the median and a same-page calibration loop reported beside it
    const calib = () => { const c0 = performance.now(); let a = 0; for (let k = 0; k < 2e6; k++) a = (a + k * 7) % 1000003; return [performance.now() - c0, a]; };
    const calibMs = +Math.min(...[0, 1, 2].map(() => calib()[0])).toFixed(2);
    const ub = [];
    for (let b = 0; b < 9; b++) {
      const u0 = performance.now();
      for (let i = 0; i < 60; i++) t.update(1 / 60);
      ub.push((performance.now() - u0) / 60);
      await T.sleep(30);
    }
    const us = ub.slice().sort((a, b) => a - b);
    out.update = { ema: out.updateMs, fastest: +us[0].toFixed(4), median: +us[4].toFixed(4), batches: ub.map((x) => +x.toFixed(3)), calibMs };
    const g = t.debug.actors.group;
    const on = T.render(), triOn = hw.renderer.info.render.triangles;
    g.visible = false;
    const off = T.render(), triOff = hw.renderer.info.render.triangles;
    g.visible = true;
    out.calls = [on, off, on - off];
    out.tris = [triOn - triOff, t.debug.stats().tris];
    // recompute: five batches of 8 edits with a pause between them (R3 T3.7); each batch's median, and the budget is
    // checked against the fastest batch's median. All 40 (min, quartiles, max) are reported as before
    const ms = [], rb = [];
    for (let b = 0, i = 0; b < 5; b++) {
      const one = [];
      for (let k = 0; k < 8; k++, i++) {
        await t.debug.edit((w) => (i % 2 ? w.remove(`I|-6|0|2`, { record: false }) : w.add({ t: 'flowers', x: -6, y: 0, z: 2 }, { record: false })));
        one.push(t.debug.stats().recomputeMs);
      }
      ms.push(...one);
      one.sort((a, b) => a - b);
      rb.push(+((one[3] + one[4]) / 2).toFixed(3));
      await T.sleep(150);
    }
    ms.sort((a, b) => a - b);
    out.recompute = [ms[0], ms[10], ms[20], ms[30], ms[39]];
    out.recomputeBatches = { medians: rb, fastest: Math.min(...rb), calibMs };
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
  check('R11', 'town update ≤ 0.6 ms (the live EMA, or the fastest of nine 60-update batches; median and calibration shown)', r.update.ema <= 0.6 || r.update.fastest <= 0.6, r.update);
  check('R11', 'recompute (buildWorldModel + re-binding + wish checks) ≤ 2 ms (the fastest of five 8-edit batch medians; min, quartiles, max of all 40 shown)',
    r.recomputeBatches.fastest <= 2, { all: r.recompute, ...r.recomputeBatches });
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
    // .hw-hide-photo hides with `visibility 0s linear 0.35s`: on a loaded machine (300–600 ms headless frames) one
    // read 800 ms in could still see it. Poll up to 3 s for both to be hidden (R3 T3.7); the time it took is reported
    const hearthShown = () => { const h = document.querySelector('.hw-hearth'); return !!h && h.getBoundingClientRect().width > 0 && getComputedStyle(h).visibility !== 'hidden' && getComputedStyle(h).display !== 'none'; };
    const h0 = performance.now();
    while ((vis() > 0 || hearthShown()) && performance.now() - h0 < 3000) await T.sleep(100);
    out.hiddenAfterMs = Math.round(800 + performance.now() - h0);
    out.bubbles = vis();
    out.hearth = hearthShown();
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
  check('R9', 'photo mode: bubbles and the hearth hidden (within 3.8 s)', r.before.bubbles > 0 && r.bubbles === 0 && !r.hearth, { before: r.before, after: r.bubbles, hearth: r.hearth, ms: r.hiddenAfterMs });
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

// ---------------------------------------------------------------- round-3 repairs (T3.x), real touch on an iPhone 13: no
// decoy rings and faint rings that look faint, a wish bubble on the framed farmhouse, a Show me swap spot that wins over
// a villager on it, the checklist chip never over a bubble, housemates never on one lunch spot, thank-yous that differ
await section('repair3', async () => {
  const wait = (ms) => new Promise((res) => setTimeout(res, ms));
  const touchOf = async (ctx, page) => {
    const cdp = await ctx.newCDPSession(page);
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p[0], y: p[1], id: i, radiusX: 4, radiusY: 4, force: 1 })) });
    return async (p) => { await touch('touchStart', [p]); await wait(60); await touch('touchEnd', []); await wait(1500); };
  };
  // in the page: pose a villager standing at a world point (the R18 _steps trick), and the Show me rings as drawn
  const PAGE = String.raw`window.__r3 = {
    async pose(id, at) {
      const D = __hw.town.debug, sv = D.sim.villagers.find((u) => u.id === id);
      const p = [at[0], D.model.nav.surfaceAt(at[0], at[2]), at[2]];
      sv._steps = [{ k: 'pose', pose: 'stand', at: p, face: 0, dur: Infinity, cell: D.model.nav.cellOf(p[0], p[2]) }];
      sv.plan = { ...sv.plan, t1: __hw.town.clock() };
      D.step(2);
      await __t.sleep(1500);
    },
    rings() {
      const hw = __hw, A = hw.town.debug.actors, R = A.render, THREE = hw.THREE;
      const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(), c = new THREE.Color();
      const out = [];
      for (let i = 0; i < R.rings.count; i++) {
        R.rings.getMatrixAt(i, m); m.decompose(p, q, s); R.rings.getColorAt(i, c);
        const sc = __t.toScreen(p.clone());
        out.push({ y: +p.y.toFixed(2), scale: +s.x.toFixed(2), r: +c.r.toFixed(2), hit: A.highlightHit(sc.x, sc.y) });
      }
      return out;
    },
    /** Pose a villager 0.55 m in front of the Show me ghost of an edge rec (toward the camera) → where to tap them. */
    async inFront(id, axis) {
      const hw = __hw, t = hw.town, D = t.debug, THREE = hw.THREE;
      const g = D.actors.render.ghost; g.updateMatrixWorld(true);
      const c = new THREE.Box3().setFromObject(g).getCenter(new THREE.Vector3());
      const n = axis === 'x' ? new THREE.Vector3(0, 0, Math.sign(hw.camera.position.z - c.z) || 1) : new THREE.Vector3(Math.sign(hw.camera.position.x - c.x) || 1, 0, 0);
      const at = c.clone().addScaledVector(n, 0.55);
      await this.pose(id, [at.x, 0, at.z]);
      const p = D.actors.positionOf(id), s = __t.toScreen(new THREE.Vector3(p.x, p.y + 0.7, p.z));
      return { tap: [s.x, s.y], onSpot: D.actors.highlightHit(s.x, s.y), villagerHit: t.hitTest(s.x, s.y, 12) };
    },
  };`;
  /** A swap rec's Show me with a villager posed on the spot: a real tap on their chest builds the piece (T3.5). */
  async function swapTap(page, tap, id, target) {
    const pre = await page.evaluate(async ([id, target]) => {
      const hw = __hw, rec = hw.town.debug.sim.planFor(target).plan.recs[0].rec;
      const key = hw.world.keyOf(hw.world.normalize(rec));
      const f = await __r3.inFront(id, rec.a);
      return { ...f, want: rec.t, key, before: hw.world.entries.get(key)?.def?.id || null, undo: hw.world.undoStack.length, piece: hw.state.pieceId };
    }, [id, target]);
    await tap(pre.tap);
    const post = await page.evaluate((key) => ({ undo: __hw.world.undoStack.length, at: __hw.world.entries.get(key)?.def?.id || null, card: [...document.querySelectorAll('.hw-tcard.is-open')].map((e) => e.className) }), pre.key);
    return { pre, post };
  }

  // -- page 1: the stamped farmhouse (framed from ≈ 48 m on a portrait phone)
  const { ctx, page, problems } = await game('bp=farmhouse&nosave=1&town=fresh&spawn=1&townseed=4', { mobile: true });
  await page.addScriptTag({ content: PAGE });
  const tap = await touchOf(ctx, page);
  await page.evaluate(() => __t.sleep(2500));
  // T3.2: a wish at the veg beds behind the house, at the default framing: its bubble shows (the 45 m cull hid it)
  const far = await page.evaluate(async () => {
    const hw = __hw, t = hw.town, D = t.debug;
    hw.state.set({ timeFlow: false, time: 0.42 });
    const v = D.state().roster[0];
    const tpl = ['w_fire_circle', 'w_birds', 'w_well', 'w_mailbox'].find((x) => D.wish(v.id, x).ok);
    await __r3.pose(v.id, [7.4, 0, -5.2]);
    const radius = +hw.rig.goal.radius.toFixed(1);
    let shown = false, dist = null;
    for (let i = 0; i < 20 && !shown; i++) {
      const b = t.bubbles().find((x) => x.kind === 'wish' && x.villager === v.id);
      const c = hw.camera.position;
      dist = b ? +Math.hypot(c.x - b.at[0], c.y - b.at[1], c.z - b.at[2]).toFixed(1) : null;
      shown = [...document.querySelectorAll('.hw-bubble.k-wish')].some((e) => !e.classList.contains('is-hid') && e.getBoundingClientRect().width > 0);
      if (!shown) await __t.sleep(250);
    }
    const p = D.actors.positionOf(v.id), s = __t.toScreen(new hw.THREE.Vector3(p.x, p.y + 1, p.z));
    return { id: v.id, tpl, radius, dist, shown, onScreen: s.inside };
  });
  check('T3.2', 'the stamped farmhouse framed on a phone: a wish anchored > 45 m from the camera, villager on screen, still shows its bubble',
    !!far.tpl && far.radius >= 40 && far.dist > 45 && far.onScreen && far.shown, far);
  // T3.5 (a): window boxes swap a wall_window for wall_window_shutters; the wisher posed in front of the glowing ghost
  const wb = await page.evaluate(async (id) => {
    const t = __hw.town, D = t.debug;
    D.expire(id);
    const ok = D.wish(id, 'w_window_boxes').ok;
    const shown = ok && t.showMe({ villager: id });
    await __t.sleep(2500);
    return { ok, shown };
  }, far.id);
  const s1 = wb.shown ? await swapTap(page, tap, far.id, { villager: far.id }) : null;
  check('T3.5', 'a window-boxes Show me with the villager standing on the spot: a real tap on them swaps the window (one undo step), no villager card',
    wb.shown && s1.pre.onSpot >= 0 && s1.pre.villagerHit === far.id && s1.pre.before === 'wall_window' && s1.pre.want === 'wall_window_shutters'
    && s1.post.at === 'wall_window_shutters' && s1.post.undo === s1.pre.undo + 1 && s1.post.card.length === 0, { wb, ...s1 });
  // T3.1 (b): the fire circle: the later parts' rings (the benches) are small, dim and on the ground, the current one full
  const fc = await page.evaluate(async (id) => {
    const t = __hw.town, D = t.debug;
    t.endShowMe();
    if (D.state().roster.find((u) => u.id === id)?.wish) D.expire(id);
    const ok = D.wish(id, 'w_fire_circle').ok;
    const shown = ok && t.showMe({ villager: id });
    await __t.sleep(2000);
    const rings = __r3.rings();
    return { ok, shown, cur: rings.filter((r) => r.hit >= 0), faint: rings.filter((r) => r.hit < 0) };
  }, far.id);
  const minCur = (k) => Math.min(...fc.cur.map((r) => r[k]));
  check('T3.1', 'fire circle Show me: the benches\' faint rings are at most 0.6× the size and 0.4× the brightness of the fire pit\'s, at its height',
    fc.shown && fc.cur.length >= 1 && fc.faint.length >= 1 && fc.faint.every((r) => r.scale <= 0.6 * minCur('scale') && r.r <= 0.4 * minCur('r') && Math.abs(r.y - fc.cur[0].y) < 0.5), fc);
  await page.evaluate(() => __hw.town.endShowMe());

  // -- page 2: a clean lot with two campers
  const p2 = await game('clean=1&nosave=1&town=fresh&spawn=gardener,beekeeper', { mobile: true });
  await p2.page.addScriptTag({ content: PAGE });
  const tap2 = await touchOf(p2.ctx, p2.page);
  await p2.page.evaluate(() => __t.sleep(2500));
  // T3.1 (a): the camp Show me: one ring per foundation, nothing floating at roof height, every ring a real spot
  const camp = await p2.page.evaluate(async () => {
    const t = __hw.town;
    const shown = t.showMe({ camp: true });
    await __t.sleep(2500);
    const hits = t.debug.sim.planFor({ camp: true }).plan.recs.filter((e, i, a) => (e.part | 0) === (a[0].part | 0)).length;
    return { shown, hits, rings: __r3.rings(), check: document.querySelector('.hw-tcheck:not([hidden])')?.textContent || null };
  });
  check('T3.1', 'camp Show me: exactly one ring per foundation of the current part (no roof / bed rings), none above 0.5 m, every ring a hit',
    camp.shown && camp.rings.length === camp.hits && camp.hits === 4 && camp.rings.every((r) => r.y < 0.5 && r.hit >= 0) && /Foundation 0\/4/.test(camp.check || ''), camp);
  // T3.6: the camp bubble high on screen while the Show me's checklist chip is up: the chip never covers it, and a real
  // tap on it opens the camp card
  const cb = await p2.page.evaluate(async () => {
    const hw = __hw;
    hw.rig.setView({ t: [-21, 0.5, 10], th: 0, ph: 0.95, r: 22 }, true);
    const rect = (e) => { const b = e.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)]; };
    const ov = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
    const out = [];
    for (let i = 0; i < 8; i++) {
      await __t.sleep(600);
      const el = document.querySelector('.hw-bubble.k-camp'), chk = document.querySelector('.hw-tcheck:not([hidden])');
      const bub = el && !el.classList.contains('is-hid') && el.getBoundingClientRect().width > 0 ? rect(el) : null;
      const c = chk ? rect(chk) : null;
      // where the bubble's tail would sit without the dodge: its anchor, kept 50 px below the free area's top (keepIn)
      const a = hw.town.bubbles().find((x) => x.kind === 'camp');
      const ay = a ? Math.max(__t.toScreen(new hw.THREE.Vector3(a.at[0], a.at[1], a.at[2])).y, (hw.rig.insets?.top || 0) + 50) : null;
      const top = bub ? document.elementFromPoint((bub[0] + bub[2]) / 2, (bub[1] + bub[3]) / 2) : null;
      out.push({ bub, chk: c, tailY: ay === null ? null : Math.round(ay), needed: !!(c && ay !== null && ay - 46 < c[3] && ay > c[1]), under: !!(bub && c && ov(bub, c)), top: top ? !!top.closest('.hw-bubble.k-camp') : false });
    }
    return out;
  });
  const lastB = cb[cb.length - 1].bub;
  if (lastB) await tap2([(lastB[0] + lastB[2]) / 2, (lastB[1] + lastB[3]) / 2]);
  const card = await p2.page.evaluate(() => [...document.querySelectorAll('.hw-tcard.is-open')].map((e) => e.className).join(' '));
  check('T3.6', 'a Show me checklist chip up and the camp bubble\'s anchor under it: the bubble moves clear (never under the chip, topmost at its centre) and a real tap opens the camp card',
    cb.some((s) => s.needed) && cb.every((s) => s.chk && s.bub && !s.under && s.top) && /k-camp/.test(card), { samples: cb, card });
  // T3.5 (b): the door hint of a doorless hut turns a wall into a wall_door; a camper posed on the spot
  const dh = await p2.page.evaluate(async () => {
    const hw = __hw, t = hw.town, D = t.debug;
    document.querySelector('.hw-tcard.is-open .hw-tc-x')?.click();
    t.endShowMe();
    await D.edit((w) => { for (const p of __fx.SMALL_HOME(0, 0)) w.add(p.t === 'wall_door' ? { ...p, t: 'wall' } : p, { record: false }); });
    D.advance(2);
    const h = D.homes().find((x) => !x.home && x.reasons.includes('door'));
    const shown = !!h && t.showMe({ home: h.id, hint: 'door' });
    await __t.sleep(2500);
    return { home: h?.id || null, shown, piece: hw.state.pieceId };
  });
  const s2 = dh.shown ? await swapTap(p2.page, tap2, 'v1', { home: dh.home, hint: 'door' }) : null;
  check('T3.5', 'a door-hint Show me with a camper standing on the wall spot: a real tap on them places the door (one undo step), no villager card',
    dh.shown && dh.piece === 'wall_door' && s2.pre.onSpot >= 0 && s2.pre.villagerHit === 'v1' && s2.pre.before === 'wall' && s2.pre.want === 'wall_door'
    && s2.post.at === 'wall_door' && s2.post.undo === s2.pre.undo + 1 && s2.post.card.length === 0, { dh, ...s2 });

  // -- page 3: two residents of a 2-bed hut with no outdoor seat, lunch pinned; then three thank-yous in one town day
  const p3 = await game('clean=1&nosave=1&town=fresh&time=0.505&townseed=4', { mobile: true });
  const life = await p3.page.evaluate(async () => {
    const hw = __hw, t = hw.town, D = t.debug, out = {};
    hw.state.set({ timeFlow: false, time: 0.505 });
    await D.edit((w) => { for (const p of [...__fx.SMALL_HOME(-1, -1), { t: 'bed', x: 0, y: 0, z: -1 }]) w.add(p, { record: false }); });
    D.spawn('gardener'); D.spawn('beekeeper');
    out.roster = D.state().roster.map((v) => v.status);
    let both = 0, overlap = 0, minD = Infinity;
    for (let k = 0; k < 600; k++) {
      D.step(1);
      const vs = D.sim.villagers.filter((v) => v.plan?.kind === 'pose' && v._act === 'lunch');
      if (vs.length < 2) continue;
      both++;
      const [a, b] = vs.map((v) => v.plan.ground || v.plan.at);
      const d = Math.hypot(a[0] - b[0], a[2] - b[2]);
      minD = Math.min(minD, d);
      if (d < 0.45) overlap++;
    }
    out.lunch = { both, overlap, minD: +minD.toFixed(2) };
    // T3.4: three wishes of one villager granted within one town day, each after the 60 s thank-you window
    const toasts = [];
    const v = D.state().roster[0].id, name = D.state().roster[0].name, day0 = D.state().day;
    hw.events.on('toast', (d) => { if ((d?.text || '').startsWith(`💛 ${name}:`)) toasts.push(d.text.replace(/ · Cozy.*/, '')); });
    hw.state.set({ time: 0.42 });
    out.grants = [];
    for (let i = 0; i < 3; i++) {
      const tpl = ['w_mailbox', 'w_well', 'w_door_lamp', 'w_washing_line', 'w_apple_tree', 'w_birds', 'w_shade_tree'].find((x) => D.wish(v, x).ok);
      const g = await D.grant(v, { build: true });
      D.advance(2);
      out.grants.push([tpl, !!g.granted]);
      D.advance(70);
    }
    out.sameDay = D.state().day === day0;
    out.toasts = toasts;
    return out;
  });
  check('T3.3', 'lunch with no outdoor seat: two housemates take two spots on the doorstep (≥ 0.6 m apart, never one fused figure)',
    life.roster.every((s) => s === 'resident') && life.lunch.both > 20 && life.lunch.overlap === 0 && life.lunch.minD >= 0.6, { roster: life.roster, ...life.lunch });
  check('T3.4', 'three wishes of one villager granted on one town day: three different thank-you lines in a row',
    life.sameDay && life.grants.every((g) => g[1]) && life.toasts.length === 3 && new Set(life.toasts).size === 3, { grants: life.grants, toasts: life.toasts });
  check('T3.x', 'no console errors (repair3)', problems.length === 0 && p2.problems.length === 0 && p3.problems.length === 0, [...problems, ...p2.problems, ...p3.problems].slice(0, 4));
  await p3.ctx.close();
  await p2.ctx.close();
  await ctx.close();
});

// ---------------------------------------------------------------- round-4 repairs (T4.x), real touch on phones: an
// off-screen wisher's edge bubble never under the Show me checklist chip, a wish bubble never culled while its villager
// is on screen (a tall phone's farmhouse framing, a full pinch-out), and no two villagers ever posed on one spot
await section('repair4', async () => {
  const wait = (ms) => new Promise((res) => setTimeout(res, ms));
  const touchOf = async (ctx, page) => {
    const cdp = await ctx.newCDPSession(page);
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p[0], y: p[1], id: i, radiusX: 4, radiusY: 4, force: 1 })) });
    const tap = async (p) => { await touch('touchStart', [p]); await wait(60); await touch('touchEnd', []); await wait(1200); };
    const pinch = async (cx, cy, d0, d1) => {            // two fingers apart → together: a pinch-out (zoom out)
      const pts = (d) => [[cx - d / 2, cy], [cx + d / 2, cy]];
      await touch('touchStart', pts(d0));
      for (let i = 1; i <= 10; i++) { await wait(30); await touch('touchMove', pts(d0 + (d1 - d0) * i / 10)); }
      await touch('touchEnd', []); await wait(500);
    };
    return { tap, pinch };
  };
  // in the page: pose a villager standing at a world point (the R18 _steps trick); the wish bubble of a villager as
  // laid out (its box, edge mode, what a tap at its centre hits) and the checklist chip's box
  const PAGE = String.raw`window.__r4 = {
    async pose(id, at, ms = 1500) {
      const D = __hw.town.debug, sv = D.sim.villagers.find((u) => u.id === id);
      const p = [at[0], D.model.nav.surfaceAt(at[0], at[2]), at[2]];
      sv._steps = [{ k: 'pose', pose: 'stand', at: p, face: 0, dur: Infinity, cell: D.model.nav.cellOf(p[0], p[2]) }];
      sv.plan = { ...sv.plan, t1: __hw.town.clock() };
      D.step(2);
      await __t.sleep(ms);
    },
    box(el) { const b = el.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)]; },
    wish() {
      const el = [...document.querySelectorAll('.hw-bubble.k-wish')].find((e) => !e.classList.contains('is-hid') && e.getBoundingClientRect().width > 0);
      if (!el) return null;
      const b = this.box(el), hit = document.elementFromPoint((b[0] + b[2]) / 2, (b[1] + b[3]) / 2);
      return { box: b, edge: el.classList.contains('is-edge'), top: !!(hit && hit.closest('.hw-bubble.k-wish')) };
    },
    chip() { const c = document.querySelector('.hw-tcheck'); return c && !c.hidden ? this.box(c) : null; },
    /** Camera distance of a villager's wish anchor, and whether the villager stands in the free area. */
    where(id) {
      const hw = __hw, t = hw.town, c = hw.camera.position, I = hw.rig.insets;
      const b = t.bubbles().find((x) => x.kind === 'wish' && x.villager === id);
      const q = t.debug.actors.positionOf(id), s = __t.toScreen(new hw.THREE.Vector3(q.x, q.y + 1, q.z));
      const el = hw.renderer.domElement;
      return { r: +hw.rig.goal.radius.toFixed(1), dist: b ? +Math.hypot(c.x - b.at[0], c.y - b.at[1], c.z - b.at[2]).toFixed(1) : null,
        onScreen: q.visible && s.inside && s.y > I.top && s.y < el.clientHeight - I.bottom, at: [Math.round(s.x), Math.round(s.y)] };
    },
  };`;
  const ov = (a, b) => !!(a && b) && a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];

  // -- page 1 (iPhone 13): the farmhouse, the Farmer wishing for a fire circle; real taps on his bubble and Show me
  const { ctx, page, problems } = await game('bp=farmhouse&town=fresh&spawn=farmer&wish=w_fire_circle&nosave=1&townseed=4', { mobile: true });
  await page.addScriptTag({ content: PAGE });
  const { tap } = await touchOf(ctx, page);
  await page.evaluate(() => __t.sleep(3000));
  const b0 = await page.evaluate(() => __r4.wish());
  if (b0) await tap([(b0.box[0] + b0.box[2]) / 2, (b0.box[1] + b0.box[3]) / 2]);
  const sm = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.hw-tcard.is-open button')].find((e) => /Show me/.test(e.textContent) && e.getBoundingClientRect().width > 0);
    return btn ? __r4.box(btn) : null;
  });
  if (sm) await tap([(sm[0] + sm[2]) / 2, (sm[1] + sm[3]) / 2]);
  await wait(2000);
  // T4.1: Show me has turned the camera to the plan site; the wisher's anchor now sits just above the free area's top,
  // near the middle, so his bubble rides the top edge, where the checklist chip is
  const e1 = await page.evaluate(async () => {
    const hw = __hw, t = hw.town, D = t.debug, THREE = hw.THREE;
    const v = D.state().roster[0], W = [7.4, 0, -5.2];
    await __r4.pose(v.id, W, 600);
    const view = hw.rig.getView(), el = hw.renderer.domElement, I = hw.rig.insets;
    const fx = -Math.sin(view.th), fz = -Math.cos(view.th);
    let found = null;
    for (let d = 0; d <= 40 && !found; d++) {
      hw.rig.setView({ t: [W[0] - fx * d, 0.5, W[2] - fz * d], th: view.th, ph: view.ph, r: view.r }, true);
      await __t.sleep(80);
      const b = t.bubbles().find((x) => x.kind === 'wish' && x.villager === v.id);
      const p = b && new THREE.Vector3(...b.at).project(hw.camera);
      const sx = p && (p.x + 1) / 2 * el.clientWidth, sy = p && (1 - p.y) / 2 * el.clientHeight;
      if (p && p.z < 1 && sy < I.top - 8 && sy > -400 && Math.abs(sx - el.clientWidth / 2) < 80) found = { d, anchor: [Math.round(sx), Math.round(sy)] };
    }
    await __t.sleep(1200);
    const chip = __r4.chip();
    // without the dodge an edge bubble rides the free area's top, its centre EDGE_PX (50 px) inside: under the chip
    const undodged = [Math.round(el.clientWidth / 2 - 24), I.top + 50 - 24, Math.round(el.clientWidth / 2 + 24), I.top + 50 + 24];
    const samples = [];
    for (let i = 0; i < 6; i++) { samples.push({ ...__r4.wish(), chip: __r4.chip() }); await __t.sleep(500); }
    return { id: v.id, found, chip, needed: !!chip && undodged[1] < chip[3] && undodged[3] > chip[1], samples };
  });
  const last1 = e1.samples[e1.samples.length - 1];
  if (last1?.box) await tap([(last1.box[0] + last1.box[2]) / 2, (last1.box[1] + last1.box[3]) / 2]);
  const card1 = await page.evaluate(() => [...document.querySelectorAll('.hw-tcard.is-open')].map((e) => e.className).join(' '));
  check('T4.1', 'Show me turns the camera from the wisher: his edge bubble rides below the checklist chip (never under it, topmost at its centre) and a real tap on it opens his card',
    !!b0 && !!sm && !!e1.found && e1.needed && e1.samples.every((s) => s.box && s.edge && s.chip && !ov(s.box, s.chip) && s.top) && /k-villager/.test(card1),
    { tapped: !!b0, showMe: !!sm, found: e1.found, chip: e1.chip, samples: e1.samples, card: card1 });

  // -- page 2 (a tall portrait phone, 412 × 915): the stamped farmhouse is framed from ≈ 55 m
  const tall = { viewport: { width: 412, height: 915 }, screen: { width: 412, height: 915 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true };
  const p2 = await game('bp=farmhouse&nosave=1&town=fresh&spawn=1&townseed=4', { device: tall });
  await p2.page.addScriptTag({ content: PAGE });
  const t2 = await touchOf(p2.ctx, p2.page);
  await p2.page.evaluate(() => __t.sleep(3000));
  // T4.2 (a): the wisher on the on-screen walkable cell farthest from the camera at the default framing
  const far = await p2.page.evaluate(async () => {
    const hw = __hw, t = hw.town, D = t.debug, THREE = hw.THREE;
    hw.state.set({ timeFlow: false, time: 0.42 });
    const v = D.state().roster[0];
    const tpl = ['w_birds', 'w_fire_circle', 'w_well', 'w_mailbox'].find((x) => D.wish(v.id, x).ok);
    const el = hw.renderer.domElement, I = hw.rig.insets, nav = D.model.nav, cam = hw.camera.position;
    let best = null;
    for (let x = -11; x <= 10; x++) for (let z = -11; z <= 10; z++) {
      if (!nav.inMain(x, z)) continue;
      const c = nav.centre(x, z), head = __t.toScreen(new THREE.Vector3(c[0], c[1] + 2, c[2])), feet = __t.toScreen(new THREE.Vector3(c[0], c[1], c[2]));
      if (!(head.inside && feet.inside && head.x > I.left + 20 && head.x < el.clientWidth - I.right - 20 && head.y > I.top + 50 && feet.y < el.clientHeight - I.bottom - 10)) continue;
      const d = cam.distanceTo(new THREE.Vector3(c[0], c[1] + 2, c[2]));
      if (!best || d > best.d) best = { x, z, d, c };
    }
    await __r4.pose(v.id, [best.c[0], 0, best.c[2]]);
    let shown = null;
    for (let i = 0; i < 12 && !shown; i++) { shown = __r4.wish(); if (!shown) await __t.sleep(250); }
    return { id: v.id, tpl, cell: [best.x, best.z], ...__r4.where(v.id), shown };
  });
  check('T4.2', 'a tall phone (412 × 915) frames the stamped farmhouse: the wisher on the farthest on-screen cell (> 75 m) still shows his wish bubble',
    !!far.tpl && far.r >= 50 && far.dist > 75 && far.onScreen && !!far.shown, far);
  // T4.2 (b): four real two-finger pinch-outs pull the camera back to the rig's 80 m; the Farmer at the veg beds
  const max = await p2.page.evaluate(async (id) => { await __r4.pose(id, [7.4, 0, -5.2], 800); return { h: innerHeight, w: innerWidth }; }, far.id);
  for (let k = 0; k < 4; k++) await t2.pinch(max.w / 2 - 30, max.h * 0.4, 240, 60);
  const pin = await p2.page.evaluate(async (id) => {
    await __t.sleep(1500);
    let shown = null;
    for (let i = 0; i < 12 && !shown; i++) { shown = __r4.wish(); if (!shown) await __t.sleep(250); }
    return { ...__r4.where(id), shown };
  }, far.id);
  check('T4.2', 'pinched all the way out (rig r 80) with real touches: the wisher on screen > 75 m away still shows his wish bubble',
    pin.r >= 79 && pin.dist > 75 && pin.onScreen && !!pin.shown, pin);

  // -- page 3 (iPhone 13): a flowing town day, 8 villagers in the cottage and two huts (the verifiers' setup, seed 12)
  const p3 = await game('bp=cottage&nosave=1&town=fresh&townseed=12', { mobile: true });
  const day = await p3.page.evaluate(async () => {
    const hw = __hw, D = hw.town.debug;
    const hut = (x0, z0) => [...__fx.SMALL_HOME(x0, z0), { t: 'bed', x: x0 + 1, y: 0, z: z0 }];
    await D.edit((w) => { for (const p of [...hut(4, 4), ...hut(-9, 5)]) w.add(p, { record: false }); });
    for (const j of ['gardener', 'beekeeper', 'baker', 'fisher', 'postie', 'lamplighter', 'farmer', 'gardener']) D.spawn(j);
    hw.state.set({ timeFlow: true, time: 0.3 });
    const out = { pairs: 0, near: 0, held: 0, byAct: {}, example: null, acts: {} };
    for (let k = 0; k < 2400; k++) {                       // 2400 ticks × 0.25 s = one town day
      D.step(1);
      const vs = D.sim.villagers.filter((v) => v._loc === 'out' && v.plan?.kind === 'pose');
      for (const v of vs) out.acts[v._act] = (out.acts[v._act] || 0) + 1;
      for (let i = 0; i < vs.length; i++) for (let j = i + 1; j < vs.length; j++) {
        const a = vs[i].plan.ground || vs[i].plan.at, b = vs[j].plan.ground || vs[j].plan.at;
        if (Math.abs(a[1] - b[1]) > 0.5) continue;
        const d = Math.hypot(a[0] - b[0], a[2] - b[2]);
        if (d < 0.45) out.near++;
        if (d >= 0.35) continue;
        out.pairs++;
        const key = [vs[i]._act, vs[j]._act].sort().join('+');
        out.byAct[key] = (out.byAct[key] || 0) + 1;
        if (!out.example) out.example = { h: +(hw.state.time * 24).toFixed(2), a: [vs[i].name, vs[i]._act, vs[i].plan.pose, vs[i]._spot], b: [vs[j].name, vs[j]._act, vs[j].plan.pose, vs[j]._spot], at: a.map((x) => +x.toFixed(2)) };
      }
      // the places held: never two within SPOT_GAP (0.45 m) of each other
      const hs = D.sim.villagers.filter((v) => v._spot && v._spotAt);
      for (let i = 0; i < hs.length; i++) for (let j = i + 1; j < hs.length; j++) {
        const a = hs[i]._spotAt, b = hs[j]._spotAt;
        if (Math.abs(a[1] - b[1]) < 1 && Math.hypot(a[0] - b[0], a[2] - b[2]) < 0.449) out.held++;
      }
    }
    out.stuck = D.stuck();
    out.roster = D.state().roster.map((v) => v.status).join(',');
    return out;
  });
  check('T4.4', 'a flowing town day, 8 villagers in 3 homes: no two posed outdoors closer than 0.35 m (on HEAD 159–457 such pairs a day), and no two places held within 0.45 m',
    day.pairs === 0 && day.held === 0 && day.stuck.length === 0, { pairs: day.pairs, near45: day.near, held: day.held, byAct: day.byAct, example: day.example, stuck: day.stuck });
  check('T4.4', 'the same day keeps its routine: lunch, work, chores and hangouts all happen outdoors',
    ['lunch', 'work', 'chore', 'hangout'].every((k) => (day.acts[k] || 0) > 20), day.acts);

  // T4.4 (backstop): two villagers posed on exactly one point (no place booked: the _steps trick) are drawn apart
  const p4 = await game('clean=1&nosave=1&town=fresh&spawn=gardener,beekeeper&time=0.42', { mobile: true });
  await p4.page.addScriptTag({ content: PAGE });
  const bs = await p4.page.evaluate(async () => {
    const hw = __hw, D = hw.town.debug;
    hw.state.set({ timeFlow: false, time: 0.42 });
    const [a, b] = D.state().roster.map((v) => v.id);
    await __r4.pose(a, [1, 0, 1], 100);
    await __r4.pose(b, [1, 0, 1], 500);
    // the split eases in over a few frames: read it for up to 8 s (a loaded machine draws few frames a second)
    let pa, pb, drawn = 0;
    for (let i = 0; i < 40 && drawn < 0.4; i++) {
      await __t.sleep(200);
      pa = D.actors.positionOf(a); pb = D.actors.positionOf(b);
      drawn = Math.hypot(pa.x - pb.x, pa.z - pb.z);
    }
    const sa = D.sim.villagers.find((v) => v.id === a).plan.at, sb = D.sim.villagers.find((v) => v.id === b).plan.at;
    return { sim: +Math.hypot(sa[0] - sb[0], sa[2] - sb[2]).toFixed(3), drawn: +drawn.toFixed(3), visible: pa.visible && pb.visible };
  });
  check('T4.4', 'the drawn backstop: two villagers posed on one point in the sim are drawn ≥ 0.4 m apart (never one figure with two hats)',
    bs.sim < 0.01 && bs.visible && bs.drawn >= 0.4, bs);
  check('T4.x', 'no console errors (repair4)', [problems, p2.problems, p3.problems, p4.problems].every((p) => p.length === 0), [...problems, ...p2.problems, ...p3.problems, ...p4.problems].slice(0, 4));
  await p4.ctx.close();
  await p3.ctx.close();
  await p2.ctx.close();
  await ctx.close();
});

// ---------------------------------------------------------------- repair round 5 (T5.x): indoors and at the camp, one place each
await section('repair5', async () => {
  const wait = (ms) => new Promise((res) => setTimeout(res, ms));
  const tapOf = async (ctx, page) => {
    const cdp = await ctx.newCDPSession(page);
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p[0], y: p[1], id: i, radiusX: 4, radiusY: 4, force: 1 })) });
    return async (p) => { await touch('touchStart', [p]); await wait(60); await touch('touchEnd', []); await wait(1200); };
  };
  // in the page: every posed villager (an outdoor pose or an indoor step; the traveller and the passer-by too) as a
  // body: a point (standing, sitting) or, lying, the segment 0.5 m either side of its centre along its face. Pairs on
  // one storey nearer than R. The only intentional near pair would be two chatting face to face at their chat distance
  // (≥ 1 m today), so it is let through only when both chat, face each other and are > 0.15 m apart
  const PAGE = String.raw`window.__r5 = {
    body(v) {
      const p = v && v.plan;
      if (!p || (p.kind !== 'pose' && p.kind !== 'inside')) return null;
      const at = p.kind === 'pose' ? (p.ground || p.at) : p.at, f = Number.isFinite(p.face) ? p.face : 0;
      const lie = p.kind === 'inside' ? p.pose === 'sleep' : p.pose === 'lie';
      const c = [p.at[0], p.at[2]], h = lie ? 0.5 : 0;
      return { id: v.id, name: v.name, act: v._act, pose: p.pose, kind: p.kind, lv: p.kind === 'inside' ? (p.level | 0) : 0, y: at[1], lie, f, spot: v._spot,
        a: lie ? [c[0] - Math.sin(f) * h, c[1] - Math.cos(f) * h] : [at[0], at[2]], b: lie ? [c[0] + Math.sin(f) * h, c[1] + Math.cos(f) * h] : [at[0], at[2]] };
    },
    segd(p, a, b) { const dx = b[0] - a[0], dz = b[1] - a[1], L = dx * dx + dz * dz; const t = L ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L)) : 0; return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz); },
    dist(A, B) { return Math.min(this.segd(A.a, B.a, B.b), this.segd(A.b, B.a, B.b), this.segd(B.a, A.a, A.b), this.segd(B.b, A.a, A.b)); },
    intentional(A, B, d) {
      const faces = (P, Q) => Math.cos(P.f - Math.atan2(Q.a[0] - P.a[0], Q.a[1] - P.a[1])) > 0.7;
      return A.pose === 'chat' && B.pose === 'chat' && d > 0.15 && faces(A, B) && faces(B, A);
    },
    scan(R = 0.3) {
      const D = __hw.town.debug, out = [];
      const bs = [...D.sim.villagers, D.sim.traveller, D.sim.passerby].map((v) => this.body(v)).filter(Boolean);
      for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) {
        const A = bs[i], B = bs[j];
        const storey = A.kind === 'inside' && B.kind === 'inside' ? A.lv === B.lv : Math.abs(A.y - B.y) <= 1.2;
        if (!storey) continue;
        const d = this.dist(A, B);
        if (d < R && !this.intentional(A, B, d)) out.push({ d: +d.toFixed(3), A, B });
      }
      return out;
    },
    /** n ticks of flowing time; pairs nearer than 0.3 m by kind, the first few, and how many indoor / camp bodies were seen. */
    run(n) {
      const D = __hw.town.debug, out = { n: 0, kinds: {}, ex: [], inside: 0, camp: 0, lie: 0 };
      for (let k = 0; k < n; k++) {
        D.step(1);
        for (const v of D.sim.villagers) { const p = v.plan; if (p?.kind === 'inside') out.inside++; if (v._act === 'camp' && p?.kind === 'pose') out.camp++; if (p && (p.pose === 'lie' || (p.kind === 'inside' && p.pose === 'sleep'))) out.lie++; }
        for (const { d, A, B } of this.scan(0.3)) {
          out.n++;
          const key = [A.kind + ':' + A.act + ':' + A.pose, B.kind + ':' + B.act + ':' + B.pose].sort().join(' + ');
          out.kinds[key] = (out.kinds[key] || 0) + 1;
          if (out.ex.length < 3) out.ex.push({ h: +(__hw.state.time * 24).toFixed(2), d, A: [A.name, A.pose, A.spot, A.a.map((x) => +x.toFixed(2))], B: [B.name, B.pose, B.spot, B.a.map((x) => +x.toFixed(2))] });
        }
      }
      return out;
    },
    /** The bounding box of the actors' drawn bodies of two villagers: their drawn gap (a lying one as its segment). */
    drawnGap(a, b) {
      const D = __hw.town.debug, A = D.actors.actor(a), B = D.actors.actor(b);
      const pa = D.actors.positionOf(a), pb = D.actors.positionOf(b);
      const seg = (act, p) => act.tg.lie ? [[p.x - Math.sin(act.tg.yaw) * 0.5, p.z - Math.cos(act.tg.yaw) * 0.5], [p.x + Math.sin(act.tg.yaw) * 0.5, p.z + Math.cos(act.tg.yaw) * 0.5]] : [[p.x, p.z], [p.x, p.z]];
      const [a0, a1] = seg(A, pa), [b0, b1] = seg(B, pb);
      const d = Math.min(this.segd(a0, b0, b1), this.segd(a1, b0, b1), this.segd(b0, a0, a1), this.segd(b1, a0, a1));
      return { d: +d.toFixed(3), visible: pa.visible && pb.visible, lieA: !!A.tg.lie, lieB: !!B.tg.lie };
    },
  };`;
  const SHED = (x, z0) => `await D.edit((w) => {
      for (const z of [${z0}, ${z0 + 1}]) { w.add({ t: 'foundation', x: ${x}, y: 0, z }, { record: false }); w.add({ t: 'roof_flat', x: ${x}, y: 1, z, h: 0 }, { record: false }); }
      w.add({ t: 'wall_door', a: 'z', x: ${x}, y: 0, z: ${z0} }, { record: false }); w.add({ t: 'wall', a: 'z', x: ${x}, y: 0, z: ${z0 + 1} }, { record: false });
      w.add({ t: 'wall', a: 'z', x: ${x + 1}, y: 0, z: ${z0} }, { record: false }); w.add({ t: 'wall', a: 'z', x: ${x + 1}, y: 0, z: ${z0 + 1} }, { record: false });
      w.add({ t: 'wall', a: 'x', x: ${x}, y: 0, z: ${z0} }, { record: false }); w.add({ t: 'wall', a: 'x', x: ${x}, y: 0, z: ${z0 + 2} }, { record: false });
    });`;
  const allProblems = [];

  // -- T5.1 (a), iPhone 13: the cottage with a second bed, the Gardener and the Baker home for the evening (the
  // verifiers' repro, seed 8: on HEAD both sat in the one armchair at 21:49 for ≈ 100 ticks); then a real tap on the
  // rail's eye switches to the cutaway, where the two are drawn apart
  {
    const { ctx, page, problems } = await game('bp=cottage&nosave=1&town=fresh&townseed=8', { mobile: true });
    await page.addScriptTag({ content: PAGE });
    const tap = await tapOf(ctx, page);
    const r = await page.evaluate(async () => {
      const hw = __hw, D = hw.town.debug;
      await __t.sleep(2000);
      const bed = hw.world.add({ t: 'bed', x: 2, y: 0, z: 1, r: 0, m: 'wood' });
      await __t.sleep(500);
      D.spawn('gardener'); D.spawn('baker');
      hw.state.set({ timeFlow: true, time: 0.74 });
      window.__r5a = { bed: !!bed, homes: D.homes().map((h) => h.capacity + ':' + h.residents.length), n: 0, ex: [], bothSit: 0, seats: new Set(), k: 0 };
      const out = window.__r5a;
      // up to the first moment both sit at home after 21:30 (on HEAD: 21:49, both in the one armchair)
      for (; out.k < 1600; out.k++) {
        D.step(1);
        const ps = __r5.scan(0.3);
        out.n += ps.length;
        if (ps.length && out.ex.length < 2) out.ex.push(ps.map((p) => [p.d, p.A.name, p.A.pose, p.B.name, p.B.pose]));
        const ins = D.sim.villagers.filter((v) => v.plan?.kind === 'inside');
        if (ins.length === 2 && ins.every((v) => v.plan.pose === 'sit')) { out.bothSit++; for (const v of ins) out.seats.add(v._spot); if (out.k > 380) break; }
      }
      hw.state.set({ timeFlow: false });
      out.h = +(hw.state.time * 24).toFixed(2);
      return { h: out.h, seats: [...out.seats] };
    });
    // the rail's eye: 'All' → 'Cutaway' with a real tap
    const eye = await page.evaluate(() => { const b = document.querySelector('.hw-rail .hw-see'); if (!b || !(b.getBoundingClientRect().width > 0)) return null; const q = b.getBoundingClientRect(); return [q.left + q.width / 2, q.top + q.height / 2]; });
    if (eye) await tap(eye);
    const dr = await page.evaluate(async () => {
      const hw = __hw, D = hw.town.debug;
      hw.rig.setView({ t: [1, 0.6, 0], th: 0.6, ph: 0.75, r: 11 }, true);
      await __t.sleep(1500);
      const [a, b] = D.sim.villagers.map((v) => v.id);
      return { seeAll: hw.state.seeAll, label: document.querySelector('.hw-rail .hw-see')?.textContent.trim(), ...__r5.drawnGap(a, b) };
    });
    // the rest of the evening, the night and the next morning
    Object.assign(r, await page.evaluate(() => {
      const hw = __hw, D = hw.town.debug, out = window.__r5a;
      hw.state.set({ timeFlow: true });
      for (; out.k < 1600; out.k++) {
        D.step(1);
        const ps = __r5.scan(0.3);
        out.n += ps.length;
        if (ps.length && out.ex.length < 2) out.ex.push(ps.map((p) => [p.d, p.A.name, p.A.pose, p.B.name, p.B.pose]));
        const ins = D.sim.villagers.filter((v) => v.plan?.kind === 'inside');
        if (ins.length === 2 && ins.every((v) => v.plan.pose === 'sit')) { out.bothSit++; for (const v of ins) out.seats.add(v._spot); }
      }
      return { ...out, seats: [...out.seats] };
    }));
    check('T5.1', 'the cottage with a second bed, a flowing evening (seed 8): the two housemates sit at home together, each in a seat of their own (on HEAD both in the one armchair), and no two bodies indoors or out come within 0.3 m',
      r.bed && r.bothSit > 0 && r.seats.length >= 2 && r.n === 0, r);
    check('T5.1', 'a real tap on the rail\'s eye opens the cutaway while both sit at home: the two housemates are drawn apart (> 1 m) and both visible',
      !!eye && dr.seeAll === false && dr.visible && dr.d > 1, { eye: !!eye, ...dr });
    allProblems.push(...problems);
    await ctx.close();
  }
  // -- T5.1 (b): the 2-bed flat-roofed hut (the camp plan's shape), seed 4: one asleep, the other up indoors. On HEAD the
  // one up stood at the hut's centre cell, the sleeper's bed. Indoor stands are never on a cell with a bed or furniture
  {
    const { ctx, page, problems } = await game('clean=1&nosave=1&town=fresh&townseed=4', { mobile: true });
    await page.addScriptTag({ content: PAGE });
    const r = await page.evaluate(async () => {
      const hw = __hw, D = hw.town.debug;
      await __t.sleep(1500);
      await D.edit((w) => { for (const p of __fx.SMALL_HOME(0, 0)) w.add(p, { record: false }); w.add({ t: 'bed', x: 1, y: 0, z: 0 }, { record: false }); });
      D.spawn('gardener'); D.spawn('beekeeper');
      hw.state.set({ timeFlow: true, time: 0.72 });
      const ix = D.model.index, out = { n: 0, ex: [], upWithSleeper: 0, onFurniture: [], stands: new Set() };
      for (let k = 0; k < 1500; k++) {
        D.step(1);
        const ps = __r5.scan(0.3);
        out.n += ps.length;
        if (ps.length && out.ex.length < 2) out.ex.push(ps.map((p) => [p.d, p.A.name, p.A.pose, p.A.a, p.B.name, p.B.pose, p.B.a]));
        const ins = D.sim.villagers.filter((v) => v.plan?.kind === 'inside');
        for (const v of ins) {
          if (v.plan.pose === 'sleep') continue;
          const x = Math.floor(v.plan.at[0] / 2), z = Math.floor(v.plan.at[2] / 2);
          out.stands.add(v.plan.pose + '@' + x + ',' + z);
          if (v.plan.pose === 'stand' && ix.I.has(x + '|' + (v.plan.level | 0) + '|' + z)) out.onFurniture.push([v.name, x, z]);
        }
        if (ins.length === 2 && ins.some((v) => v.plan.pose === 'sleep') && ins.some((v) => v.plan.pose !== 'sleep')) out.upWithSleeper++;
      }
      hw.state.set({ timeFlow: false });
      out.stands = [...out.stands];
      return out;
    });
    check('T5.1', 'the 2-bed hut through an evening and night (seed 4): one housemate up indoors while the other sleeps, never standing on a bed or furniture cell, and no two bodies within 0.3 m (on HEAD: 111 sleep+stand pair-ticks on the bed)',
      r.upWithSleeper > 0 && r.onFurniture.length === 0 && r.n === 0, r);
    allProblems.push(...problems);
    await ctx.close();
  }
  // -- T5.2: 20 campers in 10 tents, a bed-less shed built at x = −10 over the mouths of the tents at z 4 and 5 (the
  // verifiers' t44camp repro): at night and in the evening every camper has a place of their own, tent-mates side by side
  {
    const { ctx, page, problems } = await game('clean=1&nosave=1&town=fresh&townseed=5&spawn=20', { mobile: true });
    await page.addScriptTag({ content: PAGE });
    const r = await page.evaluate(new Function(`return (async () => {
      const hw = __hw, D = hw.town.debug;
      await __t.sleep(2500);
      ${SHED(-10, 4)}
      const out = [];
      for (const tm of [0.95, 0.925]) {                   // 22:48 asleep, 22:12 at home (sitting): the home phase starts ≈ 21:30
        hw.state.set({ timeFlow: false, time: tm });
        D.advance(60);
        const ps = __r5.scan(0.3);
        const camp = D.sim.villagers.filter((v) => v._act === 'camp' && v.plan?.kind === 'pose');
        const spots = camp.map((v) => v._spot);
        // the tent at z 4: its mates' places (its mouth (−10, 4) is under the shed)
        const k = D.sim.villagers.filter((v) => v.status === 'camping');
        const mates = [k[8], k[9]].filter((v) => v && v.plan?.kind === 'pose').map((v) => (v.plan.ground || v.plan.at).map((x) => +x.toFixed(2)));
        out.push({ tm, tents: D.state().tents.length, campers: k.length, posed: camp.length, held: spots.filter(Boolean).length, unique: new Set(spots).size, n: ps.length,
          ex: ps.slice(0, 2).map((p) => [p.d, p.A.name, p.A.pose, p.A.spot, p.B.name, p.B.pose, p.B.spot]), mates, matesGap: mates.length === 2 ? +Math.hypot(mates[0][0] - mates[1][0], mates[0][2] - mates[1][2]).toFixed(2) : null });
      }
      // drawn: the actors keep every pair of camp bodies apart too
      hw.rig.setView({ t: [-19, 0.5, 9], th: -1.3, ph: 0.8, r: 12 }, true);
      await __t.sleep(1500);
      const ids = D.sim.villagers.filter((v) => v._act === 'camp' && v.plan?.kind === 'pose').map((v) => v.id);
      let drawnMin = Infinity;
      for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) { const g = __r5.drawnGap(ids[i], ids[j]); if (g.visible) drawnMin = Math.min(drawnMin, g.d); }
      return { out, drawnMin: +drawnMin.toFixed(3) };
    })()`));
    check('T5.2', 'a shed built over two tent mouths, 20 campers at night (lying) and in the evening (sitting): every camper holds a place of their own, the tent-mates of a built-over mouth ≥ 0.9 m apart, no two bodies within 0.3 m (on HEAD a lie + sit and a sit + sit pair on one point), and the drawn bodies too',
      r.out.every((o) => o.campers === 20 && o.posed >= 12 && o.held === o.posed && o.unique === o.posed && o.n === 0 && (o.matesGap === null || o.matesGap >= 0.89)) && r.out.some((o) => o.matesGap !== null) && r.drawnMin >= 0.3, r);
    allProblems.push(...problems);
    await ctx.close();
  }
  // -- the drawn backstop, extended (T5.1 / T5.2): a villager posed sitting on a lying camper's body, and two posed
  // indoors on one point, places unbooked (the _steps trick): drawn off the sleeper (≥ 0.4 m from its body), apart (≥
  // 0.4 m) indoors; the sleeper is never moved
  const POSE = String.raw`window.__r5pose = (id, step) => {
    const D = __hw.town.debug, v = D.sim.villagers.find((u) => u.id === id);
    v._steps = [step]; v.plan = { ...v.plan, t1: __hw.town.clock() }; D.step(2);
    return v.plan.kind + ':' + v.plan.pose;
  };`;
  {
    const { ctx, page, problems } = await game('clean=1&nosave=1&town=fresh&spawn=gardener,beekeeper&time=0.42', { mobile: true });
    await page.addScriptTag({ content: PAGE });
    await page.addScriptTag({ content: POSE });
    const r = await page.evaluate(async () => {
      const hw = __hw, D = hw.town.debug, nav = D.model.nav;
      hw.state.set({ timeFlow: false, time: 0.42 });
      const [a, b] = D.sim.villagers.map((v) => v.id);
      const P = [1, nav.surfaceAt(1, 1), 1];
      const pa = __r5pose(a, { k: 'pose', pose: 'lie', at: P, face: -Math.PI / 2, dur: Infinity, cell: nav.cellOf(1, 1) });
      const pb = __r5pose(b, { k: 'pose', pose: 'sit', at: [1.3, P[1], 1], face: Math.PI / 2, dur: Infinity, cell: nav.cellOf(1, 1) });
      hw.rig.setView({ t: [1, 0.5, 1], th: 0.6, ph: 0.8, r: 8 }, true);
      let g = null;
      for (let i = 0; i < 40; i++) { await __t.sleep(200); g = __r5.drawnGap(a, b); if (g.d >= 0.4) break; }
      const lier = D.actors.positionOf(a);
      return { plans: [pa, pb], ...g, lierMoved: +Math.hypot(lier.x - 1, lier.z - 1).toFixed(3) };
    });
    check('T5.2', 'the drawn backstop: a villager posed (unbooked) sitting on a lying camper is drawn off the body (≥ 0.4 m from it), and the sleeper stays put',
      r.plans.join() === 'pose:lie,pose:sit' && r.lieA && r.visible && r.d >= 0.4 && r.lierMoved < 0.05, r);
    allProblems.push(...problems);
    await ctx.close();
  }
  {
    const { ctx, page, problems } = await game('bp=cottage&nosave=1&town=fresh&spawn=gardener,beekeeper&time=0.42&townseed=2', { mobile: true });
    await page.addScriptTag({ content: PAGE });
    await page.addScriptTag({ content: POSE });
    const r = await page.evaluate(async () => {
      const hw = __hw, D = hw.town.debug;
      hw.state.set({ timeFlow: false, time: 0.42, seeAll: false, level: 0 });
      await __t.sleep(1000);
      const hid = D.homes()[0]?.id || null;
      const [a, b] = D.sim.villagers.map((v) => v.id);
      const Q = [1, 0.25, 1];                          // the middle of the cottage's free cell (0, 0)
      const plans = [a, b].map((id) => __r5pose(id, { k: 'inside', homeId: hid, pose: 'stand', at: Q, face: 0, level: 0, dur: Infinity }));
      hw.rig.setView({ t: [1, 0.6, 0], th: 0.6, ph: 0.8, r: 8 }, true);
      let g = null;
      for (let i = 0; i < 40; i++) { await __t.sleep(200); g = __r5.drawnGap(a, b); if (g.d >= 0.4) break; }
      return { home: hid, plans, ...g };
    });
    check('T5.1', 'the drawn backstop indoors: two villagers posed (unbooked) on one point of the cottage\'s floor are drawn ≥ 0.4 m apart in the cutaway',
      !!r.home && r.plans.join() === 'inside:stand,inside:stand' && r.visible && r.d >= 0.4, r);
    allProblems.push(...problems);
    await ctx.close();
  }
  // -- the generic overlap audit: full flowing town days (2400 ticks from 07:12) on varied layouts. No two villagers
  // (the traveller and the passer-by included) posed within 0.3 m of each other, standing, sitting or lying, indoors
  // or out, at any tick. On HEAD: farmhouse 295, cottage 743, hut 143, crammed hut 585, built-over camp 2208 pair-ticks
  const LAYOUTS = {
    'farmhouse + 4 huts, 12 villagers': ['bp=farmhouse&nosave=1&town=fresh&townseed=7', `
      const hut = (x0, z0) => [...__fx.SMALL_HOME(x0, z0), { t: 'bed', x: x0 + 1, y: 0, z: z0 }];
      await D.edit((w) => { for (const p of [...hut(4, 5), ...hut(-9, 5), ...hut(-9, -9), ...hut(4, -9)]) w.add(p, { record: false }); });
      for (const j of ['gardener', 'beekeeper', 'baker', 'fisher', 'postie', 'lamplighter', 'farmer', 'gardener', 'woodcutter', 'baker', 'farmer', 'postie']) D.spawn(j);`],
    'cottage, no seat, 4 housemates': ['bp=cottage&nosave=1&town=fresh&townseed=11', `
      await D.edit((w) => {
        for (const e of [...w.entries.values()]) if (['chair', 'armchair', 'sofa', 'rocking_chair'].includes(e.p.t)) w.remove(e.key, { record: false });
        for (const [x, z] of [[1, -1], [-2, 0], [0, 1]]) w.add({ t: 'bed', x, y: 0, z, r: 0 }, { record: false });
      });
      for (const j of ['gardener', 'baker', 'postie', 'farmer']) D.spawn(j);`],
    'cottage, no seat, 2 housemates': ['bp=cottage&nosave=1&town=fresh&townseed=3', `
      await D.edit((w) => {
        for (const e of [...w.entries.values()]) if (['chair', 'armchair', 'sofa', 'rocking_chair'].includes(e.p.t)) w.remove(e.key, { record: false });
        w.add({ t: 'bed', x: 1, y: 0, z: -1, r: 0 }, { record: false });
      });
      for (const j of ['fisher', 'beekeeper']) D.spawn(j);`],
    'a hut of four beds, 4 housemates': ['clean=1&nosave=1&town=fresh&townseed=6', `
      await D.edit((w) => { for (const p of __fx.SMALL_HOME(0, 0)) w.add(p, { record: false }); for (const [x, z] of [[1, 0], [0, 1], [1, 1]]) w.add({ t: 'bed', x, y: 0, z, r: 0 }, { record: false }); });
      for (const j of ['gardener', 'beekeeper', 'fisher', 'postie']) D.spawn(j);`],
    'an empty lot, 6 campers': ['clean=1&nosave=1&town=fresh&townseed=9&spawn=6', ''],
    'a camp, two mouths built over, 8 campers': ['clean=1&nosave=1&town=fresh&townseed=5&spawn=8', SHED(-10, 1)],
  };
  const audit = {};
  for (const [name, [q, setup]] of Object.entries(LAYOUTS)) {
    const { ctx, page, problems } = await game(q, { mobile: true });
    await page.addScriptTag({ content: PAGE });
    audit[name] = await page.evaluate(new Function(`return (async () => {
      const hw = __hw, D = hw.town.debug;
      await __t.sleep(1500);
      ${setup}
      hw.state.set({ timeFlow: true, time: 0.3 });
      const r = __r5.run(2400);
      r.roster = D.state().roster.map((v) => v.status[0]).join('');
      r.stuck = D.stuck().length;
      return r;
    })()`));
    allProblems.push(...problems);
    await ctx.close();
  }
  const rows = Object.entries(audit);
  check('T5.x', 'the overlap audit: a full flowing day on each of 6 layouts (farmhouse + huts with 12 villagers, a seatless cottage with 2 and with 4 housemates, a hut of four beds, an empty lot with 6 campers, a camp with two mouths built over), no two villagers posed within 0.3 m (standing, sitting or lying, indoors or out) at any tick, nobody stuck',
    rows.every(([, r]) => r.n === 0 && r.stuck === 0), Object.fromEntries(rows.map(([k, r]) => [k, r.n ? { n: r.n, kinds: r.kinds, ex: r.ex } : `0 (indoor ${r.inside}, camp ${r.camp}, lying ${r.lie} body-ticks; ${r.roster})`])));
  check('T5.x', 'the audit saw the cases it guards: housemates indoors, sleepers, campers lying and sitting at a built-over camp',
    rows.every(([k, r]) => (/camp/.test(k) ? r.camp > 1000 : r.inside > 1000) && r.lie > 500), Object.fromEntries(rows.map(([k, r]) => [k, [r.inside, r.camp, r.lie]])));

  // -- T5.3: the 20-villager tick on PERF_TOWN in the game, judged like town-brain's B9 (the fastest of five 120 s
  // batches; the budget, 0.1 ms, unchanged), and town-brain's B9 itself judges its tick that way
  {
    const { ctx, page, problems } = await game('clean=1&nosave=1&town=fresh&townseed=21', { mobile: true });
    const r = await page.evaluate(async () => {
      const hw = __hw, D = hw.town.debug;
      await D.edit((w) => { for (const p of __fx.PERF_TOWN()) w.add(p, { record: false }); });
      const jobs = ['gardener', 'farmer', 'woodcutter', 'fisher', 'beekeeper', 'baker', 'lamplighter', 'postie'];
      for (let k = 0; k < 20; k++) D.spawn(jobs[k % 8]);
      hw.state.set({ timeFlow: false, time: 0.42 });
      D.advance(60);
      const tb = [];
      for (let b = 0; b < 5; b++) { D.sim.debug.resetStats(); D.advance(120); tb.push(D.sim.debug.stats().tickMs); }
      const ts = tb.slice().sort((a, b) => a - b);
      return { villagers: D.sim.villagers.length, fastest: +ts[0].toFixed(4), median: +ts[2].toFixed(4), batches: tb.map((x) => +x.toFixed(4)) };
    });
    const src = (await import('node:fs')).readFileSync(path.join(ROOT, 'tools', 'town-brain.js'), 'utf8');
    const b9 = src.slice(src.indexOf('// tick with 20 villagers'), src.indexOf('report.B9 = out;'));
    check('T5.3', 'the 20-villager tick ≤ 0.1 ms on the fastest of five 120 s batches (median reported), and town-brain B9 judges its tick the same way (no single sample)',
      r.villagers === 20 && r.fastest <= 0.1 && /for \(let b = 0; b < 5; b\+\+\)/.test(b9) && /tick20Batches/.test(b9) && /ts\[0\]/.test(b9), r);
    allProblems.push(...problems);
    await ctx.close();
  }
  check('T5.x', 'no console errors (repair5)', allProblems.length === 0, allProblems.slice(0, 4));
});

// ---------------------------------------------------------------- repair round 6 (T6.x): a sitter in a dining chair sits
// on its drawn seat; furnishing a home never leaves a housemate inside the new piece; edge bubbles of housemates merge
// into one ×2; debug.spawn while a traveller is on the way never reuses its id
await section('repair6', async () => {
  const wait = (ms) => new Promise((res) => setTimeout(res, ms));
  const touchOf = async (ctx, page) => {
    const cdp = await ctx.newCDPSession(page);
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p[0], y: p[1], id: i, radiusX: 4, radiusY: 4, force: 1 })) });
    const tap = async (p) => { await touch('touchStart', [p]); await wait(60); await touch('touchEnd', []); await wait(1200); };
    const slide2 = async (x0, y0, dx, dy) => {         // two fingers side by side slide together: a pan
      const pts = (t) => [[x0 - 45 + dx * t, y0 + dy * t], [x0 + 45 + dx * t, y0 + dy * t]];
      await touch('touchStart', pts(0));
      for (let i = 1; i <= 12; i++) { await wait(40); await touch('touchMove', pts(i / 12)); }
      await touch('touchEnd', []); await wait(1200);
    };
    return { tap, slide2 };
  };
  const eyeOf = (page) => page.evaluate(() => { const b = document.querySelector('.hw-rail .hw-see'); if (!b || !(b.getBoundingClientRect().width > 0)) return null; const q = b.getBoundingClientRect(); return [q.left + q.width / 2, q.top + q.height / 2]; });
  // in the page: a seated villager against the drawn seat of their chair (the centre of the chair's drawn box: the
  // ladder-back's legs, seat and back are centred on its seat), and every pair of posed bodies nearer than 0.3 m
  const PAGE = String.raw`window.__r6 = {
    chairOf(spot) {
      const [, t, x, y, z] = String(spot).split('|');
      return [...__hw.world.entries.values()].find((e) => e.p.t === t && e.p.x === +x && e.p.y === +y && e.p.z === +z) || null;
    },
    seat(id) {
      const hw = __hw, D = hw.town.debug, THREE = hw.THREE, v = D.sim.villagers.find((u) => u.id === id);
      const e = v && /^seat\|chair\|/.test(v._spot || '') ? this.chairOf(v._spot) : null;
      if (!e) return { spot: v && v._spot, plan: v && v.plan.kind + ':' + v.plan.pose };
      const c = new THREE.Box3().setFromObject(e.obj).getCenter(new THREE.Vector3()), q = D.actors.positionOf(id);
      return { name: v.name, spot: v._spot, plan: v.plan.kind + ':' + v.plan.pose, r: e.p.r, chair: [+c.x.toFixed(2), +c.z.toFixed(2)], at: [+v.plan.at[0].toFixed(2), +v.plan.at[2].toFixed(2)],
        drawn: [+q.x.toFixed(2), +q.z.toFixed(2)], visible: q.visible, planGap: +Math.hypot(v.plan.at[0] - c.x, v.plan.at[2] - c.z).toFixed(3), gap: +Math.hypot(q.x - c.x, q.z - c.z).toFixed(3) };
    },
    /** Flowing town ticks until a villager sits in a dining chair with > 30 s of the sit left. */
    toChair(n) {
      const D = __hw.town.debug;
      for (let k = 0; k < n; k++) {
        D.step(1);
        const v = D.sim.villagers.find((u) => u.plan?.kind === 'inside' && /^seat\|chair\|/.test(u._spot || '') && u.plan.t1 - D.state().clock > 30);
        if (v) return { k, id: v.id, h: +(__hw.state.time * 24).toFixed(2) };
      }
      return null;
    },
    near(R = 0.3) {
      const D = __hw.town.debug, out = [];
      const body = (v) => { const p = v.plan; if (!p || (p.kind !== 'pose' && p.kind !== 'inside')) return null; const a = p.kind === 'pose' ? (p.ground || p.at) : p.at; return { n: v.name, lv: p.kind === 'inside' ? p.level | 0 : 0, y: a[1], x: a[0], z: a[2], lie: p.pose === 'sleep' || p.pose === 'lie' }; };
      const bs = D.sim.villagers.map(body).filter((b) => b && !b.lie);
      for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) if (Math.abs(bs[i].y - bs[j].y) < 1.2 && Math.hypot(bs[i].x - bs[j].x, bs[i].z - bs[j].z) < R) out.push([bs[i].n, bs[j].n]);
      return out;
    },
  };`;
  const allProblems = [];

  // -- T6.1 + T6.2, iPhone 13: the cottage with a second bed, the Gardener and the Baker home for the evening (the
  // verifiers' repro, seed 10: the second housemate takes a dining chair at the table's end, a quarter turn from it, whose
  // seat is drawn 0.66 m toward it; on HEAD the Baker sat 0.66 m behind the chair, in mid-air). A real tap on the rail's eye
  // opens the cutaway: the sitter is drawn on the chair's seat. Then the table is taken away (the chair's seat goes
  // back to its cell's middle) and put back (undo): the sitter goes with the seat each time (T6.2's recheck)
  {
    const { ctx, page, problems } = await game('bp=cottage&nosave=1&town=fresh&townseed=10', { mobile: true });
    await page.addScriptTag({ content: PAGE });
    const { tap } = await touchOf(ctx, page);
    const r = await page.evaluate(async () => {
      const hw = __hw, D = hw.town.debug;
      await __t.sleep(2000);
      const bed = !!hw.world.add({ t: 'bed', x: 2, y: 0, z: 1, r: 1, m: 'wood' });
      await __t.sleep(500);
      D.spawn('gardener'); D.spawn('baker');
      hw.state.set({ timeFlow: true, time: 0.74 });
      const hit = __r6.toChair(1500);
      hw.state.set({ timeFlow: false });
      return { bed, hit };
    });
    const eye = await eyeOf(page);
    if (eye && r.hit) await tap(eye);
    const seen = await page.evaluate(async (hit) => {
      const hw = __hw;
      if (!hit) return null;
      const s0 = __r6.seat(hit.id);
      hw.rig.setView({ t: [s0.chair[0], 0.6, s0.chair[1]], th: 2.2, ph: 0.95, r: 6 }, true);
      await __t.sleep(1500);
      return { seeAll: hw.state.seeAll, label: document.querySelector('.hw-rail .hw-see')?.textContent.trim(), ...__r6.seat(hit.id) };
    }, r.hit);
    check('T6.1', 'the cottage with a second bed, a flowing evening (seed 10): the housemate in a dining chair at the table\'s end (a quarter turn from it) is posed and drawn on the chair\'s seat, tucked 0.66 m toward the table (on HEAD 0.66 m behind it, in mid-air), seen in the cutaway after a real tap on the rail\'s eye',
      r.bed && !!r.hit && !!eye && seen?.seeAll === false && seen.visible && seen.planGap < 0.06 && seen.gap < 0.1, { ...r, eye: !!eye, seen });
    // T6.2: the table erased, then undone, while the sitter sits
    const moves = await page.evaluate(async (hit) => {
      const hw = __hw, D = hw.town.debug;
      if (!hit) return null;
      const out = [];
      const chair = __r6.chairOf(D.sim.villagers.find((u) => u.id === hit.id)._spot).p;
      const f = [[0, 1], [1, 0], [0, -1], [-1, 0]][chair.r & 3];
      const table = [...hw.world.entries.values()].find((e) => e.p.t === 'table' && e.p.x === chair.x + f[0] && e.p.z === chair.z + f[1] && e.p.y === chair.y);
      if (!table) return { noTable: true };
      const until = async (ok) => { for (let i = 0; i < 40; i++) { await __t.sleep(150); const s = __r6.seat(hit.id); if (ok(s)) return s; } return __r6.seat(hit.id); };
      hw.world.remove(table.key);
      out.push({ step: 'table erased', ...(await until((s) => s.gap < 0.1 && s.planGap < 0.06 && Math.abs(Math.hypot(s.chair[0] - (chair.x + 0.5) * 2, s.chair[1] - (chair.z + 0.5) * 2) - 0.05) < 0.03)) });
      hw.world.undo();
      out.push({ step: 'table back (undo)', ...(await until((s) => s.gap < 0.1 && s.planGap < 0.06 && Math.hypot(s.chair[0] - (chair.x + 0.5) * 2, s.chair[1] - (chair.z + 0.5) * 2) > 0.6)) });
      out.push({ near: __r6.near(0.3) });
      return out;
    }, r.hit);
    check('T6.2', 'the table under the sitter\'s chair erased, then put back with undo: the chair\'s seat moves to its cell\'s middle and back, and the sitter is posed and drawn on it each time (a recompute rechecks indoor places), nobody within 0.3 m',
      Array.isArray(moves) && moves.length === 3 && moves.slice(0, 2).every((m) => m.spot?.startsWith('seat|chair|') && m.planGap < 0.06 && m.gap < 0.1) && moves[2].near.length === 0, moves);
    allProblems.push(...problems);
    await ctx.close();
  }
  // -- T6.1, the farmhouse (seed 21, two more beds upstairs, three residents): a dining chair turned like its table, its
  // seat drawn 0.9 m toward it (on HEAD the sitter was drawn 0.9 m behind the seat)
  {
    const { ctx, page, problems } = await game('bp=farmhouse&nosave=1&town=fresh&townseed=21', { mobile: true });
    await page.addScriptTag({ content: PAGE });
    const { tap } = await touchOf(ctx, page);
    const r = await page.evaluate(async () => {
      const hw = __hw, D = hw.town.debug;
      await __t.sleep(2000);
      const beds = [[-2, -3], [-2, -2]].map(([x, z]) => !!hw.world.add({ t: 'bed', x, y: 1, z, r: 0, m: 'wood' }));
      await __t.sleep(600);
      D.spawn('gardener'); D.spawn('farmer'); D.spawn('baker');
      hw.state.set({ timeFlow: true, time: 0.74 });
      const hit = __r6.toChair(1500);
      hw.state.set({ timeFlow: false });
      return { beds, hit };
    });
    const eye = await eyeOf(page);
    if (eye && r.hit) await tap(eye);
    const seen = await page.evaluate(async (hit) => {
      const hw = __hw;
      if (!hit) return null;
      const s0 = __r6.seat(hit.id);
      hw.rig.setView({ t: [s0.chair[0], 0.6, s0.chair[1]], th: 2.2, ph: 0.95, r: 6 }, true);
      await __t.sleep(1500);
      const e = __r6.chairOf(s0.spot).p, tuck = Math.hypot(s0.chair[0] - (e.x + 0.5) * 2, s0.chair[1] - (e.z + 0.5) * 2);
      return { seeAll: hw.state.seeAll, tuck: +tuck.toFixed(2), ...__r6.seat(hit.id) };
    }, r.hit);
    check('T6.1', 'the farmhouse, three residents (seed 21): the housemate in a dining chair at the table\'s long side (turned like it) is drawn on the chair\'s seat, tucked 0.9 m toward the table (on HEAD 0.9 m behind it), in the cutaway after a real tap on the rail\'s eye',
      r.beds.every(Boolean) && !!r.hit && !!eye && seen?.seeAll === false && seen.visible && Math.abs(seen.tuck - 0.9) < 0.05 && seen.planGap < 0.06 && seen.gap < 0.1, { ...r, seen });
    allProblems.push(...problems);
    await ctx.close();
  }
  // -- T6.1 by construction: the piece and the villagers read one seat (config.js CHAIR_SEAT_Z / chairTuck)
  {
    const cfg = await import(pathToFileURL(path.join(ROOT, 'js', 'config.js')).href);
    const fs = await import('node:fs');
    const decor = fs.readFileSync(path.join(ROOT, 'js', 'pieces', 'decor.js'), 'utf8'), simSrc = fs.readFileSync(path.join(ROOT, 'js', 'town', 'sim.js'), 'utf8');
    const at = (x, z, t) => (xx, y, zz) => (xx === x && zz === z ? t : null);
    const tuck = typeof cfg.chairTuck === 'function' ? cfg.chairTuck : () => '?';
    const codes = [tuck({ x: 0, y: 0, z: 0, r: 0 }, at(0, 1, { t: 'table', r: 0 })), tuck({ x: 0, y: 0, z: 0, r: 1 }, at(1, 0, { t: 'table', r: 0 })),
      tuck({ x: 0, y: 0, z: 0, r: 2 }, at(0, 1, { t: 'table', r: 0 })), tuck({ x: 0, y: 0, z: 0, r: 3 }, at(-1, 0, { t: 'bed', r: 0 }))];
    check('T6.1', 'one seat for the chair and its sitter: config.js chairTuck / CHAIR_SEAT_Z (z 0.9, x 0.66, none 0.05) drive both the Ladder-back Chair\'s seat (decor.js) and the dining-chair sit point (sim.js)',
      codes.join(',') === 'z,x,,' && !!cfg.CHAIR_SEAT_Z && cfg.CHAIR_SEAT_Z.z === 0.9 && cfg.CHAIR_SEAT_Z.x === 0.66 && cfg.CHAIR_SEAT_Z[''] === 0.05
        && /chairTuck\(p, \(x, y, z\) => ctx\.get\(K\.I\(x, y, z\)\)\)/.test(decor) && /CHAIR_SEAT_Z\[o\.nb\]/.test(decor) && /CHAIR_SEAT_Z\[chairTuck\(p, itemAt\)\]/.test(simSrc), { codes });
  }
  // -- T6.2, iPhone 13: the verifiers' repro. The 2-bed hut (seed 4), the Gardener and the Beekeeper home for the evening;
  // one stands on the floor with a minute and more of it left. A real tap on the eye opens the cutaway and a real tap on
  // a free corner of that very cell places a Farmhouse Table there: the housemate moves at once to another free place
  // (on HEAD they stayed 70 s inside the table, the hat through the tabletop)
  {
    const { ctx, page, problems } = await game('clean=1&nosave=1&town=fresh&townseed=4', { mobile: true });
    await page.addScriptTag({ content: PAGE });
    const { tap } = await touchOf(ctx, page);
    const r = await page.evaluate(async () => {
      const hw = __hw, D = hw.town.debug;
      await __t.sleep(1500);
      await D.edit((w) => { for (const p of __fx.SMALL_HOME(0, 0)) w.add(p, { record: false }); w.add({ t: 'bed', x: 1, y: 0, z: 0 }, { record: false }); });
      D.spawn('gardener'); D.spawn('beekeeper');
      hw.state.set({ timeFlow: true, time: 0.72 });
      let hit = null;
      for (let k = 0; k < 1600 && !hit; k++) {
        D.step(1);
        const v = D.sim.villagers.find((u) => u.plan?.kind === 'inside' && u.plan.pose === 'stand' && /^floor\|/.test(u._spot || '') && u.plan.t1 - D.state().clock > 60);
        if (v) hit = { id: v.id, name: v.name, spot: v._spot, at: v.plan.at.slice(), k, h: +(hw.state.time * 24).toFixed(2) };
      }
      hw.state.set({ timeFlow: false });
      return hit;
    });
    const eye = await eyeOf(page);
    if (eye && r) await tap(eye);
    let placed = null;
    if (r) {
      await page.evaluate(() => { __hw.rig.setView({ t: [2, 0.6, 2.5], th: 0.5, ph: 0.55, r: 12 }, true); __hw.state.set({ pieceId: 'table', tool: 'build', level: 0, rot: 0 }); });
      await wait(1500);
      const cx = Math.floor(r.at[0] / 2), cz = Math.floor(r.at[2] / 2);
      for (const [dx, dz] of [[0.36, 0.36], [-0.36, 0.36], [0.36, -0.36], [-0.36, -0.36]]) {
        const s = await page.evaluate(([x, z]) => { const p = __t.toScreen(new __hw.THREE.Vector3(x, 0.25, z)); return { x: p.x, y: p.y, villager: !!__hw.town.hitTest(p.x, p.y) }; }, [cx * 2 + 1 + dx * 2, cz * 2 + 1 + dz * 2]);
        if (s.villager) continue;
        const n0 = await page.evaluate(() => __hw.world.count);
        await tap([s.x, s.y]);
        if ((await page.evaluate(() => __hw.world.count)) > n0) { placed = [cx, cz]; break; }
      }
    }
    const after = r && await page.evaluate(async ([id, cell]) => {
      const hw = __hw, D = hw.town.debug, ix = () => D.model.index;
      const st = () => { const v = D.sim.villagers.find((u) => u.id === id), q = D.actors.positionOf(id); return { plan: v.plan.kind + ':' + v.plan.pose, spot: v._spot, at: v.plan.at.map((x) => +x.toFixed(2)), drawn: [q.x, q.z].map((x) => +x.toFixed(2)), left: +(v.plan.t1 - D.state().clock).toFixed(1) }; };
      const inCell = (p) => Math.floor(p[0] / 2) === cell[0] && Math.floor(p[p.length - 1] / 2) === cell[1];
      let a = st();
      for (let i = 0; i < 20 && inCell(a.at); i++) { await __t.sleep(150); a = st(); }
      await __t.sleep(1200);                         // the actor eases over
      a = st();
      const recs = [...hw.world.entries.values()].filter((e) => e.p.x === cell[0] && e.p.z === cell[1] && e.p.y === 0).map((e) => e.p.t);
      const furnished = !!ix().I.get(Math.floor(a.at[0] / 2) + '|0|' + Math.floor(a.at[2] / 2));
      return { ...a, recs, planInTable: inCell(a.at), drawnInTable: inCell(a.drawn), furnished, near: __r6.near(0.3) };
    }, [r.id, placed || [Math.floor(r.at[0] / 2), Math.floor(r.at[2] / 2)]]);
    check('T6.2', 'the 2-bed hut in the evening (seed 4): a real tap places a Farmhouse Table on the floor cell where a housemate stands (cutaway): within 3 s they stand on another free floor place, holding it, posed and drawn off the table, the rest of their step kept; nobody within 0.3 m (on HEAD they stayed inside the table for 70 s)',
      !!r && !!eye && !!placed && after.recs.includes('table') && after.plan === 'inside:stand' && /^floor\|/.test(after.spot || '') && after.spot !== r.spot && !after.planInTable && !after.drawnInTable && !after.furnished && after.left > 30 && after.near.length === 0,
      { hit: r, eye: !!eye, placed, after });
    allProblems.push(...problems);
    await ctx.close();
  }
  // -- T6.2 by the debug API: (a) the seat under a sitter erased; (b) an indoor step planned for a floor place that is
  // furnished before the step starts (a housemate on the way in): neither is left in mid-air or inside the new piece
  {
    const { ctx, page, problems } = await game('bp=cottage&nosave=1&town=fresh&townseed=3&spawn=gardener,beekeeper&time=0.42', { mobile: true });
    await page.addScriptTag({ content: PAGE });
    const r = await page.evaluate(async () => {
      const hw = __hw, D = hw.town.debug, S = D.sim;
      hw.state.set({ timeFlow: false, time: 0.42 });
      await __t.sleep(1000);
      const home = D.homes()[0];
      const [a, b] = S.villagers;
      const out = {};
      // (a) a sitter in the armchair (a step naming its seat; claimInside books it at the seat's real point); erased
      const arm = [...hw.world.entries.values()].find((e) => e.p.t === 'armchair');
      a._steps = [{ k: 'inside', homeId: home.id, kind: 'sit', spot: 'seat|armchair|' + arm.p.x + '|0|' + arm.p.z + '|0', at: [(arm.p.x + 0.5) * 2, 0.7, (arm.p.z + 0.5) * 2], face: 0, level: 0, pose: 'sit', dur: Infinity }];
      a.plan = { ...a.plan, t1: hw.town.clock() }; D.step(2);
      out.a0 = { plan: a.plan.kind + ':' + a.plan.pose, spot: a._spot, at: a.plan.at.map((x) => +x.toFixed(2)) };
      await D.edit((w) => w.remove(arm.key, { record: false }));
      D.step(1);
      out.a1 = { plan: a.plan.kind + ':' + a.plan.pose, spot: a._spot, at: a.plan.at.map((x) => +x.toFixed(2)) };
      // (b) a step for a free floor cell of the cottage (none of its housemates on it), then a table set there before
      // the step starts
      const B0 = D.model.buildings.find((x) => x.id === home.id), lo = B0.lo | 0, ix = D.model.index;
      const busy = S.villagers.filter((u) => u.plan?.at).map((u) => Math.floor(u.plan.at[0] / 2) + ',' + Math.floor(u.plan.at[2] / 2));
      const c = B0.foot.find(([x, z]) => B0.cells.has(x + '|' + lo + '|' + z) && !ix.I.has(x + '|' + lo + '|' + z) && !busy.includes(x + ',' + z));
      out.cell = c;
      b._steps = [{ k: 'inside', homeId: home.id, kind: 'stand', spot: 'floor|' + c[0] + '|' + lo + '|' + c[1] + '|0', at: [c[0] * 2 + 1, 0.25, c[1] * 2 + 1], face: 0, level: lo, pose: 'stand', dur: Infinity }];
      let added = false;
      await D.edit((w) => { added = !!w.add({ t: 'table', x: c[0], y: lo, z: c[1], r: 0 }, { record: false }); });
      b.plan = { ...b.plan, t1: hw.town.clock() }; D.step(2);
      const bc = [Math.floor(b.plan.at[0] / 2), Math.floor(b.plan.at[2] / 2)];
      out.b = { added, plan: b.plan.kind + ':' + b.plan.pose, spot: b._spot, at: b.plan.at.map((x) => +x.toFixed(2)), inTable: bc[0] === c[0] && bc[1] === c[1],
        furnished: /^floor\|/.test(b._spot || '') && !!D.model.index.I.get(bc[0] + '|' + lo + '|' + bc[1]) };
      out.near = __r6.near(0.3);
      return out;
    });
    check('T6.2', 'the armchair erased under its sitter: they take another place at once (not left sitting in mid-air); an indoor step planned for a floor cell furnished before it starts goes to another free place (by the range, or a floor cell with nothing on it), not inside the new table; nobody within 0.3 m',
      r.a0.spot?.startsWith('seat|armchair|') && r.a1.plan.startsWith('inside:') && !!r.a1.spot && r.a1.spot !== r.a0.spot && Math.hypot(r.a1.at[0] - r.a0.at[0], r.a1.at[2] - r.a0.at[2]) > 0.3
        && r.b.added && r.b.plan === 'inside:stand' && !!r.b.spot && r.b.spot !== 'floor|' + r.cell[0] + '|0|' + r.cell[1] + '|0' && !r.b.inTable && !r.b.furnished && r.near.length === 0, r);
    allProblems.push(...problems);
    await ctx.close();
  }
  // -- T6.3, iPhone 13: the cottage with a second bed, the Gardener and the Baker indoors with a wish each (their
  // bubbles share the roof anchor: one '×2' on screen). (a) real two-finger slides pan the cottage off screen: one edge
  // bubble '×2' ('and 1 more'), not two on one point with the second hidden. (b) a real tap on the eye and a close-up
  // in the cutaway, the roof anchor above the top bar: again one '×2' edge bubble
  {
    const { ctx, page, problems } = await game('bp=cottage&nosave=1&town=fresh&townseed=8', { mobile: true });
    const { tap, slide2 } = await touchOf(ctx, page);
    const r = await page.evaluate(async () => {
      const hw = __hw, D = hw.town.debug;
      await __t.sleep(2000);
      hw.world.add({ t: 'bed', x: 2, y: 0, z: 1, r: 1, m: 'wood' });
      await __t.sleep(500);
      D.spawn('gardener'); D.spawn('baker');
      hw.state.set({ timeFlow: true, time: 0.74 });
      for (let k = 0; k < 900; k++) { D.step(1); if (k > 300 && D.sim.villagers.filter((v) => v.plan?.kind === 'inside').length === 2) break; }
      hw.state.set({ timeFlow: false });
      for (const v of D.sim.villagers) if (!v.wish) for (const t of ['w_birds', 'w_mailbox', 'w_door_lamp', 'w_soft_rug', 'w_pet', 'w_well']) if (D.wish(v.id, t).ok) break;
      await __t.sleep(1500);
      return D.sim.villagers.map((v) => v.name + ':' + (v.wish && v.wish.tpl) + ':' + v.plan.kind);
    });
    const vis = () => page.evaluate(() => [...document.querySelectorAll('.hw-bubble.k-wish')].filter((b) => !b.classList.contains('is-hid') && b.getBoundingClientRect().width > 0)
      .map((b) => ({ txt: b.textContent, edge: b.classList.contains('is-edge'), tf: b.style.transform.split(' translate(')[0], label: b.getAttribute('aria-label') })));
    const on = await vis();
    const steps = [];
    for (let i = 0; i < 4; i++) {
      await slide2(195, 300, -160, 120);
      const b = await vis();
      steps.push(b);
      if (b.some((x) => x.edge)) break;
    }
    const off = steps[steps.length - 1] || [];
    check('T6.3', 'two housemates indoors with a wish each, panned off screen by real two-finger slides: their edge bubbles (one roof anchor) merge into one ×2 bubble, labelled \'and 1 more\' (on HEAD two bubbles on one point, the second hidden, no ×2)',
      r.every((x) => /:w_|:J_/.test(x) && /:inside$/.test(x)) && on.length === 1 && /×2/.test(on[0].txt) && off.length === 1 && off[0].edge && /×2/.test(off[0].txt) && /and 1 more/.test(off[0].label),
      { r, on, off });
    // (b) the cutaway close-up
    await page.evaluate(() => __hw.rig.setView({ t: [1, 0.6, 0], th: 0.6, ph: 0.75, r: 11 }, true));
    await wait(1200);
    const eye = await eyeOf(page);
    if (eye) await tap(eye);
    await page.evaluate(() => __hw.rig.setView({ t: [1.5, 0.6, 1.5], th: 0.6, ph: 0.75, r: 10 }, true));
    await wait(1500);
    const cut = { seeAll: await page.evaluate(() => __hw.state.seeAll), b: await vis() };
    check('T6.3', 'the same two in the cutaway close-up after a real tap on the eye (their roof anchor above the top bar): one ×2 edge bubble, never two stacked on one point',
      !!eye && cut.seeAll === false && cut.b.length === 1 && /×2/.test(cut.b[0].txt) && (cut.b[0].edge ? /and 1 more/.test(cut.b[0].label) : true), cut);
    allProblems.push(...problems);
    await ctx.close();
  }
  // -- T6.4: the farmhouse with two more beds upstairs, a traveller on the way; debug.spawn twice meanwhile: ids unique,
  // the spawned villagers drawn at their own places (on HEAD the first got the traveller's id and was drawn on the
  // lane with it); the traveller moves in later, ids still unique
  {
    const { ctx, page, problems } = await game('bp=farmhouse&nosave=1&town=fresh&townseed=13', {});
    const r = await page.evaluate(async () => {
      const hw = __hw, D = hw.town.debug, S = D.sim;
      await D.edit((w) => { for (const [x, z] of [[-2, -3], [-2, -2]]) w.add({ t: 'bed', x, y: 1, z, r: 0 }, { record: false }); });
      for (let i = 0; i < 80 && !S.traveller; i++) await __t.sleep(250);
      if (!S.traveller) D.traveller();
      const trav = S.traveller && S.traveller.id, travName = S.traveller && S.traveller.name;
      const a = D.spawn('gardener'), b = D.spawn('beekeeper');
      await __t.sleep(2500);
      const ids = [...S.villagers.map((v) => v.id), S.traveller && S.traveller.id].filter(Boolean);
      const drawn = [a, b].map((id) => { const v = S.villagers.find((u) => u.id === id), q = D.actors.positionOf(id), p = v.plan.kind === 'walk' ? null : (v.plan.ground || v.plan.at || v._pos); return p ? +Math.hypot(q.x - p[0], q.z - p[2]).toFixed(2) : 0; });
      for (let k = 0; k < 3000 && S.traveller; k++) D.step(1);
      const ids2 = S.villagers.map((v) => v.id);
      return { trav, travName, spawned: [a, b], ids, dup: ids.filter((x, i) => ids.indexOf(x) !== i), drawn, joined: !S.traveller && S.villagers.some((v) => v.id === trav && v.name === travName), ids2, dup2: ids2.filter((x, i) => ids2.indexOf(x) !== i), nextOk: ids2.every((id) => +id.slice(1) < (D.sim.serialize?.().nextId ?? Infinity)) };
    });
    check('T6.4', 'debug.spawn twice while a traveller is on the way: ids unique (never the traveller\'s), the spawned villagers drawn at their own places (not on the lane with the traveller); the traveller moves in later with its own id, still unique',
      !!r.trav && r.spawned.every(Boolean) && !r.spawned.includes(r.trav) && r.dup.length === 0 && r.drawn.every((d) => d < 0.6) && r.joined && r.dup2.length === 0 && r.nextOk, r);
    allProblems.push(...problems);
    await ctx.close();
  }
  check('T6.x', 'no console errors (repair6)', allProblems.length === 0, allProblems.slice(0, 4));
});

// ---------------------------------------------------------------- repair7: a sleeper's bed replaced; edge bubbles of two kinds
await section('repair7', async () => {
  const wait = (ms) => new Promise((res) => setTimeout(res, ms));
  const allProblems = [];
  const tapAt = async (ctx, page, p) => {
    const cdp = await ctx.newCDPSession(page);
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((q, i) => ({ x: q[0], y: q[1], id: i, radiusX: 4, radiusY: 4, force: 1 })) });
    await touch('touchStart', [p]); await wait(60); await touch('touchEnd', []); await wait(1200);
  };
  // -- T7.1: a resident asleep in their bed; the player puts a table (or a bookshelf) on the bed in ONE edit (a tap of
  // another piece replaces whatever is in the slot). On HEAD the sleeper kept lying 0.87 m up on the new piece until
  // morning, because the sleep place accepted any piece in the bed's cell as the bed. Now: booked again at once on a
  // sofa / armchair / bedroll, still asleep. With a second bed in the home, once the binding gives them that bed they
  // sleep in it (commit re-books a sleeper whose bed changed)
  for (const [piece, extraBed] of [['table', false], ['bookshelf', false], ['table', true]]) {
    const { ctx, page, problems } = await game('bp=cottage&nosave=1&town=fresh&townseed=10', {});
    const r = await page.evaluate(async ({ piece, extraBed }) => {
      const hw = __hw, D = hw.town.debug, S = D.sim;
      hw.state.set({ timeFlow: false });
      if (extraBed) await D.edit((w) => w.add({ t: 'bed', x: 2, y: 0, z: 1, r: 1 }));
      D.spawn('gardener', { trait: 'homebody' });
      D.phase('night'); D.step(2); S.reseat(); D.step(2);
      await __t.sleep(1200);
      const v = S.villagers[0];
      const before = { spot: v._spot, at: v.plan.at.slice(), pose: v.plan.pose };
      const bedKey = v.bed, rec = { ...hw.world.entries.get(bedKey).p };
      await D.edit((w) => w.add({ t: piece, x: rec.x, y: rec.y, z: rec.z, r: rec.r }));
      D.step(1); await __t.sleep(800);
      const a = D.actors.positionOf(v.id);
      const after = { cell: hw.world.entries.get(bedKey)?.p?.t, spot: v._spot, at: v.plan.at.slice(), pose: v.plan.pose, kind: v.plan.kind, drawnGap: +Math.hypot(a.x - v.plan.at[0], a.z - v.plan.at[2]).toFixed(2) };
      D.advance(6); await __t.sleep(800);
      const later = { status: v.status, bed: v.bed, spot: v._spot, at: v.plan.at.slice(), pose: v.plan.pose };
      return { before, after, later, oldLie: before.at };
    }, { piece, extraBed });
    const off = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
    if (!extraBed) {
      check('T7.1', `a ${piece} put on a sleeper's bed in one edit: booked again at once (not the old bed's place), still asleep, never lying where the bed was`,
        /^bed\|/.test(r.before.spot || '') && r.after.cell === piece && r.after.spot !== r.before.spot && off(r.after.at, r.oldLie) > 0.5 && r.after.pose === 'sleep' && r.after.kind === 'inside'
        && r.later.spot === r.after.spot && off(r.later.at, r.oldLie) > 0.5, r);
    } else {
      check('T7.1', 'the same with a second bed in the home: once the binding gives the sleeper that bed, they sleep in it (not on the table, not left on the sofa)',
        r.after.cell === 'table' && off(r.after.at, r.oldLie) > 0.5 && r.later.status === 'resident' && r.later.bed === 'I|2|0|1' && r.later.spot === 'bed|2|0|1' && r.later.pose === 'sleep', r);
    }
    allProblems.push(...problems);
    await ctx.close();
  }
  // -- T7.2, iPhone 13: a traveller coming up the lane and an off-screen wisher in the same direction. On HEAD their edge
  // bubbles merged into one '🎒×2' (a tap only followed the traveller; the wish had no bubble for the whole walk-in).
  // Now each keeps its own edge bubble, a circle apart, and a real tap on the wish opens the wisher's card
  {
    const { ctx, page, problems } = await game('bp=cottage&nosave=1&town=fresh&townseed=3', { mobile: true });
    const r = await page.evaluate(async () => {
      const hw = __hw, D = hw.town.debug;
      await __t.sleep(1500);
      const id = D.spawn('gardener');
      D.step(10);
      const w = D.wish(id, 'w_door_lamp');
      hw.world.add({ t: 'bed', x: 2, y: 0, z: 1, r: 1, m: 'wood' });
      let cap = 0;
      for (let i = 0; i < 40 && cap < 2; i++) { await __t.sleep(150); cap = D.homes().reduce((a, h) => a + h.capacity, 0); }
      const tid = D.traveller('beekeeper');
      return { id, wish: w.ok, tid, cap };
    });
    const views = [];
    for (const [t, th] of [[[14, 0.5, 4], 0.5], [[16.5, 0.5, 2.6], 0.5], [[18, 0.5, 6], 0.3], [[14, 0.5, -6], 0.9]]) {
      await page.evaluate(([t, th]) => __hw.rig.setView({ t, th, ph: 0.95, r: 22 }, true), [t, th]);
      await wait(1200);
      views.push(await page.evaluate(() => [...document.querySelectorAll('.hw-bubble.is-edge')].filter((b) => !b.classList.contains('is-hid') && b.getBoundingClientRect().width > 0)
        .map((b) => { const q = b.getBoundingClientRect(); return { kind: [...b.classList].find((c) => c.startsWith('k-')), merged: b.classList.contains('is-merged'), txt: b.textContent, x: Math.round(q.left + 19), y: Math.round(q.top + 19) }; })));
    }
    const ok = views.map((v) => { const t = v.find((b) => b.kind === 'k-traveller'), w = v.find((b) => b.kind === 'k-wish'); return !!t && !!w && !t.merged && !w.merged && Math.hypot(t.x - w.x, t.y - w.y) >= 44; });
    const last = views[views.length - 1].find((b) => b.kind === 'k-wish');
    let card = null;
    if (last) {
      await tapAt(ctx, page, [last.x, last.y]);
      card = await page.evaluate(() => { const c = document.querySelector('.hw-tcard.is-open'); return c ? { cls: c.className, txt: c.textContent.slice(0, 80) } : null; });
    }
    check('T7.2', 'a traveller on the lane and an off-screen wisher the same way (4 views): two edge bubbles a circle apart, neither merged, and a real tap on the wish opens the wisher\'s card (on HEAD one 🎒×2 that only followed the traveller)',
      !!r.tid && r.wish && ok.every(Boolean) && !!card && /k-villager/.test(card.cls) && /Mabel/.test(card.txt), { r, views, card });
    allProblems.push(...problems);
    await ctx.close();
  }
  // -- T7.3, iPhone 13 landscape: the merged '×2' edge bubble of two housemates indoors with a wish each, in the cutaway
  // close-up at 12 camera turns (the arrow turns all the way round). On HEAD the badge sat top-right whatever the arrow
  // and an arrow pointing up or up-right covered it ('×Z'). Now the badge sits opposite the arrow: never overlapping
  {
    const { ctx, page, problems } = await game('bp=cottage&nosave=1&town=fresh&townseed=8', { device: { viewport: { width: 844, height: 390 }, screen: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 } });
    const r = await page.evaluate(async () => {
      const hw = __hw, D = hw.town.debug;
      await __t.sleep(2000);
      hw.world.add({ t: 'bed', x: 2, y: 0, z: 1, r: 1, m: 'wood' });
      await __t.sleep(500);
      D.spawn('gardener'); D.spawn('baker');
      hw.state.set({ timeFlow: true, time: 0.74 });
      for (let k = 0; k < 900; k++) { D.step(1); if (k > 300 && D.sim.villagers.filter((v) => v.plan?.kind === 'inside').length === 2) break; }
      hw.state.set({ timeFlow: false });
      for (const v of D.sim.villagers) if (!v.wish) for (const t of ['w_birds', 'w_mailbox', 'w_door_lamp', 'w_soft_rug', 'w_pet', 'w_well']) if (D.wish(v.id, t).ok) break;
      hw.state.set({ seeAll: false });
      await __t.sleep(1000);
      return D.sim.villagers.map((v) => v.name + ':' + (v.wish && v.wish.tpl) + ':' + v.plan.kind);
    });
    const rows = [];
    for (let i = 0; i < 12; i++) {
      const th = (i * Math.PI * 2) / 12;
      await page.evaluate((th) => __hw.rig.setView({ t: [1.5, 0.6, 1.5], th, ph: 0.9, r: 6 }, true), th);
      await wait(700);
      rows.push(await page.evaluate(() => [...document.querySelectorAll('.hw-bubble.is-edge.has-badge')].filter((b) => !b.classList.contains('is-hid') && b.getBoundingClientRect().width > 0).map((b) => {
        const q = (e) => { const x = e.getBoundingClientRect(); return [x.left, x.top, x.right, x.bottom]; };
        const B = q(b.querySelector('.hw-bubble-badge')), A = q(b.querySelector('.hw-bubble-arrow'));
        return { txt: b.textContent, ang: b.querySelector('.hw-bubble-arrow').style.transform.match(/rotate\((-?\d+)deg/)?.[1], overlap: !(A[2] <= B[0] || B[2] <= A[0] || A[3] <= B[1] || B[3] <= A[1]) };
      })));
    }
    const seen = rows.flat();
    const angles = new Set(seen.map((b) => b.ang));
    check('T7.3', 'a merged ×2 edge bubble at 12 camera turns in the cutaway close-up (landscape): the badge never overlaps the arrow, whichever way the arrow points (on HEAD an arrow up or up-right covered it)',
      r.length === 2 && seen.length >= 6 && angles.size >= 4 && seen.every((b) => /×2/.test(b.txt) && !b.overlap), { r, n: seen.length, angles: [...angles], bad: seen.filter((b) => b.overlap) });
    allProblems.push(...problems);
    await ctx.close();
  }
  check('T7.x', 'no console errors (repair7)', allProblems.length === 0, allProblems.slice(0, 4));
});

// ---------------------------------------------------------------- repair8: the round-7 review (sleepers, edge bubble layout)
await section('repair8', async () => {
  const wait = (ms) => new Promise((res) => setTimeout(res, ms));
  const allProblems = [];
  // synthetic bubbles anchored on chosen screen points (town.bubbles replaced in the page), and what the hud drew
  const SYN = String.raw`window.__s8 = {
    install() { const t = __hw.town; if (!window.__s8orig) window.__s8orig = t.bubbles; window.__s8b = []; t.bubbles = () => window.__s8b; },
    at(sx, sy, d = 25) { const hw = __hw, cam = hw.camera, cv = hw.renderer.domElement; const v = new hw.THREE.Vector3((sx / cv.clientWidth) * 2 - 1, 1 - (sy / cv.clientHeight) * 2, 0.5).unproject(cam); const dir = v.sub(cam.position).normalize(); const p = cam.position.clone().addScaledVector(dir, d); return [p.x, p.y, p.z]; },
    free() { const cv = __hw.renderer.domElement, I = __hw.rig.insets; return { fl: I.left, ft: I.top, fr: cv.clientWidth - I.right, fb: cv.clientHeight - I.bottom }; },
    // a screen point whose natural edge point is X on the top edge / Y on the right edge
    top(X) { const f = this.free(), cx = (f.fl + f.fr) / 2, cy = (f.ft + f.fb) / 2, hh = (f.fb - f.ft) / 2 - 50; return [2 * X - cx, cy - 2 * hh]; },
    right(Y) { const f = this.free(), cx = (f.fl + f.fr) / 2, cy = (f.ft + f.fb) / 2, hw = (f.fr - f.fl) / 2 - 50; return [cx + 2 * hw, 2 * Y - cy]; },
    set(specs) { window.__s8b = specs.map((s, i) => ({ key: s.key || s.kind[0] + ':' + i, kind: s.kind, icon: { traveller: '🎒', wish: '💡', dream: '🪴' }[s.kind], label: 'syn ' + s.kind + ' ' + i, at: this.at(s.sx, s.sy), villager: s.villager || 'syn-' + i, tappable: true, arrow: s.kind === 'traveller' })); },
    drawn() { return [...document.querySelectorAll('.hw-bubble')].filter((b) => !b.classList.contains('is-hid') && b.getBoundingClientRect().width > 0).map((b) => {
      const r = (e) => { const q = e.getBoundingClientRect(); return [q.left, q.top, q.right, q.bottom]; };
      const c = r(b.querySelector('.hw-bubble-c')), bd = b.querySelector('.hw-bubble-badge'), edge = b.classList.contains('is-edge');
      return { kind: [...b.classList].find((k) => k.startsWith('k-')), edge, merged: b.classList.contains('is-merged'), label: b.getAttribute('aria-label'), x: (c[0] + c[2]) / 2, y: (c[1] + c[3]) / 2, disc: c,
        arrow: edge ? r(b.querySelector('.hw-bubble-arrow')) : null, badge: getComputedStyle(bd).display !== 'none' ? r(bd) : null, badgeBg: getComputedStyle(bd).backgroundColor };
    }); },
  };`;
  const hit = (A, B) => !!A && !!B && !(A[2] <= B[0] || B[2] <= A[0] || A[3] <= B[1] || B[3] <= A[1]);

  // -- T8.1: a sleeper whose home lost its roof (waiting) keeps sleeping in their own bed, and is still there when the
  // roof is back; a bed swapped for a table and back again: the sleeper ends in their bed (on the code before, they
  // spent the rest of the night on the armchair beside a free bed of their own). A fifth bed added to a full home at
  // night takes nobody's bed (on the code before, a new bed sorting first took one away and got its owner up)
  {
    const { ctx, page, problems } = await game('bp=cottage&nosave=1&town=fresh&townseed=10', {});
    const r = await page.evaluate(async () => {
      const hw = __hw, D = hw.town.debug, S = D.sim, out = {};
      hw.state.set({ timeFlow: false });
      D.spawn('gardener', { trait: 'homebody' });
      D.phase('night'); D.step(2); S.reseat(); D.step(2);
      await __t.sleep(800);
      const v = S.villagers[0], bedKey = v.bed, rec = { ...hw.world.entries.get(bedKey).p }, bedSpot = 'bed|' + bedKey.split('|').slice(1).join('|');
      const snap = () => ({ status: v.status, spot: v._spot, pose: v.plan.pose });
      out.asleep = snap();
      const roofs = [...hw.world.entries.values()].filter((e) => /roof/.test(e.def.id)).slice(0, 3).map((e) => ({ key: e.key, p: { ...e.p } }));
      await D.edit((w) => { for (const q of roofs) w.remove(q.key); });
      D.advance(6); out.roofOff = snap();
      await D.edit((w) => { for (const q of roofs) w.add(q.p); });
      D.advance(6); out.roofBack = snap();
      await D.edit((w) => { w.remove(bedKey); w.add({ t: 'table', x: rec.x, y: rec.y, z: rec.z, r: rec.r }); });
      D.advance(6); out.table = snap();
      await D.edit((w) => { w.remove(bedKey); w.add({ t: 'bed', x: rec.x, y: rec.y, z: rec.z, r: rec.r }); });
      D.advance(6); out.bedBack = snap();
      out.bedSpot = bedSpot;
      return out;
    });
    check('T8.1', 'a sleeper whose home loses its roof (waiting) stays in their own bed and is still there once the roof is back; a bed swapped for a table and back: they end in their own bed again',
      r.asleep.spot === r.bedSpot && r.roofOff.status === 'waiting' && r.roofOff.spot === r.bedSpot && r.roofBack.status === 'resident' && r.roofBack.spot === r.bedSpot
      && r.table.spot !== r.bedSpot && r.table.pose === 'sleep' && r.bedBack.status === 'resident' && r.bedBack.spot === r.bedSpot && r.bedBack.pose === 'sleep', r);
    allProblems.push(...problems);
    await ctx.close();
  }
  {
    const { ctx, page, problems } = await game('clean=1&nosave=1&town=fresh&townseed=3', {});
    const r = await page.evaluate(async () => {
      const hw = __hw, D = hw.town.debug, S = D.sim;
      hw.state.set({ timeFlow: false });
      await D.edit((w) => { for (const p of __fx.HOME4(0, 0)) w.add(p); });   // four beds along z 0 (I|0..3|0|0)
      for (const j of ['gardener', 'baker', 'fisher', 'farmer']) D.spawn(j, { trait: 'homebody' });
      D.phase('night'); D.step(2); S.reseat(); D.step(2);
      const snap = () => S.villagers.map((u) => [u.name, u.status, u.bed, u._spot, u.plan.at.map((q) => +q.toFixed(2)).join(',')].join(' '));
      const before = snap();
      await D.edit((w) => w.add({ t: 'bed', x: 0, y: 0, z: 1, r: 0 }));   // I|0|0|1 sorts before I|1|0|0
      D.advance(5);
      return { before, after: snap() };
    });
    check('T8.1', 'a fifth bed added at night to a full four-bed home takes nobody\'s bed: every resident keeps their bed and their place',
      r.before.length === 4 && r.before.every((s) => / resident I\|/.test(s)) && JSON.stringify(r.before) === JSON.stringify(r.after), r);
    allProblems.push(...problems);
    await ctx.close();
  }

  // -- T8.2, iPhone 13: a traveller's top-edge point wobbling 1-3 px around an off-screen wish's (40 frames): the
  // fanned wish never flips across it (on the code before it jumped 96 px back and forth)
  {
    const { ctx, page, problems } = await game('bp=cottage&nosave=1&town=fresh&townseed=3', { mobile: true });
    await page.addScriptTag({ content: SYN });
    await page.evaluate(() => __s8.install());
    const sides = [];
    for (let i = 0; i < 40; i++) {
      const X = 161 + [-3, -1, 0, 1, 3, 1, 0, -1][i % 8];
      await page.evaluate((X) => { const w = __s8.top(161), t = __s8.top(X); __s8.set([{ kind: 'traveller', sx: t[0], sy: t[1] }, { kind: 'wish', sx: w[0], sy: w[1] }]); }, X);
      await wait(110);
      const d = await page.evaluate(() => __s8.drawn());
      const t = d.find((b) => b.kind === 'k-traveller'), w = d.find((b) => b.kind === 'k-wish');
      sides.push(t && w && !w.merged && !t.merged ? Math.sign(w.x - t.x) : 0);
    }
    let flips = 0; for (let i = 1; i < sides.length; i++) if (sides[i] !== sides[i - 1]) flips++;
    check('T8.2', 'an off-screen wish fanned beside a traveller whose edge point wobbles 1-3 px around it (40 frames): two bubbles every frame, never flipping sides', flips === 0 && sides.every((x) => x !== 0), { flips, sides: sides.join('') });
    allProblems.push(...problems);
    await ctx.close();
  }

  // -- T8.3, 320×568 (the rail wraps into a second column inside the free area): a traveller and a real wish at one
  // right-edge point: neither bubble meets a rail button; a real tap on the wish opens its card and leaves Draw off.
  // With two toasts up and the natural point under the rail: still nothing on the rail buttons or under the toasts
  {
    const SE = { viewport: { width: 320, height: 568 }, screen: { width: 320, height: 568 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 };
    const { ctx, page, problems } = await game('bp=cottage&nosave=1&town=fresh&townseed=3', { device: SE });
    await page.addScriptTag({ content: SYN });
    const vid = await page.evaluate(async () => { const D = __hw.town.debug; const id = D.spawn('gardener'); D.step(10); D.wish(id, 'w_door_lamp'); await __t.sleep(400); __s8.install(); return id; });
    const rails = () => page.evaluate(() => [...document.querySelectorAll('.hw-rail-group')].map((g) => { const q = g.getBoundingClientRect(); return [q.left, q.top, q.right, q.bottom]; }));
    const R = await rails();
    await page.evaluate((vid) => { const p = __s8.right(200); __s8.set([{ kind: 'traveller', sx: p[0], sy: p[1] }, { kind: 'wish', sx: p[0], sy: p[1], villager: vid }]); }, vid);
    await wait(400);
    const a = await page.evaluate(() => __s8.drawn());
    const clearA = a.length === 2 && a.every((b) => !b.merged && R.every((q) => !hit(b.disc, q)));
    const w = a.find((b) => b.kind === 'k-wish');
    let tapped = null;
    if (w) {
      const cdp = await ctx.newCDPSession(page);
      const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((q, i) => ({ x: q[0], y: q[1], id: i, radiusX: 4, radiusY: 4, force: 1 })) });
      await touch('touchStart', [[w.x, w.y]]); await wait(60); await touch('touchEnd', []); await wait(1000);
      tapped = await page.evaluate(() => ({ draw: __hw.state.drawMode, card: document.querySelector('.hw-tcard.is-open')?.className || null }));
      await page.evaluate(() => document.querySelector('.hw-tcard.is-open .hw-tc-x')?.click());
      await wait(500);
    }
    await page.evaluate(() => { __hw.events.emit('toast', { text: 'First toast: something happened in the village today', kind: 'info', ms: 8000 }); __hw.events.emit('toast', { text: 'Second toast: another long message to stack up', kind: 'info', ms: 8000 }); });
    await wait(500);
    await page.evaluate(() => { const p = __s8.right(280); __s8.set([{ kind: 'traveller', sx: p[0], sy: p[1] }, { kind: 'wish', sx: p[0], sy: p[1] }]); });
    await wait(400);
    const b = await page.evaluate(() => __s8.drawn());
    const band = await page.evaluate(() => { const t = document.querySelector('.hw-toasts'); const q = t.getBoundingClientRect(); return t.childElementCount ? [q.left, q.top, q.right, q.bottom] : null; });
    const clearB = b.length >= 1 && b.every((x) => R.every((q) => !hit(x.disc, q)) && !hit(x.disc, band));
    check('T8.3', 'a 320×568 phone (the rail wraps into the free area): fanned edge bubbles never sit on a rail button, a real tap on the wish opens its card and leaves Draw off; with two toasts up, nothing on the rail or under the toasts',
      clearA && !!tapped && tapped.draw === false && /k-villager/.test(tapped.card || '') && !!band && clearB, { R, a: a.map((x) => [x.kind, Math.round(x.x), Math.round(x.y), x.merged]), tapped, band, b: b.map((x) => [x.kind, Math.round(x.x), Math.round(x.y), x.merged]) });
    allProblems.push(...problems);
    await ctx.close();
  }

  // -- T8.4, 844×390: a traveller, two wishes and a dream at one top-edge point (near-level arrows): fanned apart so no
  // arrow meets another bubble's disc or badge, and the ×2 badge meets no arrow
  {
    const L = { viewport: { width: 844, height: 390 }, screen: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 };
    const { ctx, page, problems } = await game('bp=cottage&nosave=1&town=fresh&townseed=3', { device: L });
    await page.addScriptTag({ content: SYN });
    await page.evaluate(() => __s8.install());
    const res = [];
    for (const X of [90, 690]) {
      await page.evaluate((X) => { const p = __s8.top(X); __s8.set([{ kind: 'wish', sx: p[0], sy: p[1] }, { kind: 'wish', sx: p[0], sy: p[1] }, { kind: 'traveller', sx: p[0], sy: p[1] }, { kind: 'dream', sx: p[0], sy: p[1] }]); }, X);
      await wait(400);
      res.push(await page.evaluate(() => __s8.drawn()));
    }
    const bad = [];
    for (const d of res) for (const a of d) for (const b of d) if (a !== b && (hit(a.arrow, b.disc) || hit(a.arrow, b.badge))) bad.push([a.kind, b.kind]);
    const shape = res.map((d) => d.map((b) => b.kind + (b.merged ? '×' : '')).sort().join(','));
    check('T8.4', 'landscape top edge: a traveller, two wishes (×2) and a dream at one point fan apart with no arrow over another bubble\'s disc or badge, and the ×2 badge under no arrow',
      bad.length === 0 && res.every((d) => d.length === 3 && d.some((b) => b.kind === 'k-wish' && b.merged && b.badge)), { bad, shape });
    allProblems.push(...problems);
    await ctx.close();
  }

  // -- T8.5, iPhone 13: a wish and a dream at one on-screen roof point (two housemates) show as two bubbles side by side,
  // each with its own label (on the code before, one 'wish ×2' whose tap never reached the dreamer); two dreams
  // merged show a readable count pill (the dream's badge had no background)
  {
    const { ctx, page, problems } = await game('bp=cottage&nosave=1&town=fresh&townseed=3', { mobile: true });
    await page.addScriptTag({ content: SYN });
    await page.evaluate(() => __s8.install());
    await page.evaluate(() => __s8.set([{ kind: 'wish', sx: 160, sy: 250 }, { kind: 'dream', sx: 160, sy: 250 }]));
    await wait(400);
    const a = await page.evaluate(() => __s8.drawn());
    await page.evaluate(() => __s8.set([{ kind: 'dream', sx: 220, sy: 300 }, { kind: 'dream', sx: 220, sy: 300 }]));
    await wait(400);
    const b = await page.evaluate(() => __s8.drawn());
    check('T8.5', 'a wish and a dream at one on-screen point: two bubbles side by side with their own labels; two dreams merged: a ×2 count on a visible pill',
      a.length === 2 && a.every((x) => !x.merged && !x.edge) && Math.abs(a[0].x - a[1].x) >= 36 && new Set(a.map((x) => x.label)).size === 2
      && b.length === 1 && b[0].merged && !!b[0].badge && !/rgba\(0, 0, 0, 0\)|transparent/.test(b[0].badgeBg), { a: a.map((x) => [x.kind, Math.round(x.x), Math.round(x.y), x.label]), b: b.map((x) => [x.kind, x.merged, x.badgeBg]) });
    allProblems.push(...problems);
    await ctx.close();
  }
  check('T8.x', 'no console errors (repair8)', allProblems.length === 0, allProblems.slice(0, 4));
});

// ---------------------------------------------------------------- repair9: the round-8 re-check (waiting sleepers, 💤, sides)
await section('repair9', async () => {
  const wait = (ms) => new Promise((res) => setTimeout(res, ms));
  const allProblems = [];
  // synthetic bubbles on chosen screen points (town.bubbles replaced in the page) and what the hud drew
  const SYN9 = String.raw`window.__s9 = {
    install() { const t = __hw.town; window.__s9b = []; t.bubbles = () => window.__s9b; },
    at(sx, sy, d = 25) { const hw = __hw, cam = hw.camera, cv = hw.renderer.domElement; const v = new hw.THREE.Vector3((sx / cv.clientWidth) * 2 - 1, 1 - (sy / cv.clientHeight) * 2, 0.5).unproject(cam); const dir = v.sub(cam.position).normalize(); const p = cam.position.clone().addScaledVector(dir, d); return [p.x, p.y, p.z]; },
    set(list) { window.__s9b = list.map((s) => ({ tappable: s.kind !== 'sleep', arrow: s.kind === 'traveller', villager: s.v || s.key, label: s.key, icon: { traveller: '🎒', wish: '💡', dream: '🪴', vacancy: '🏡✨', sleep: '💤' }[s.kind], ...s, at: s.at || this.at(s.sx, s.sy) })); },
    frames(n = 3) { return new Promise((r) => { const f = () => (--n <= 0 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }); },
    drawn() { return [...document.querySelectorAll('.hw-bubble')].filter((b) => !b.classList.contains('is-hid') && b.getBoundingClientRect().width > 0).map((b) => {
      const r = (e) => { const q = e.getBoundingClientRect(); return [q.left, q.top, q.right, q.bottom]; };
      const c = b.querySelector('.hw-bubble-c'), edge = b.classList.contains('is-edge');
      return { kind: [...b.classList].find((k) => k.startsWith('k-')), edge, merged: b.classList.contains('is-merged'), disc: r(c), x: (r(c)[0] + r(c)[2]) / 2, arrow: edge ? r(b.querySelector('.hw-bubble-arrow')) : null };
    }); },
  };`;
  const area = (A, B) => (A && B ? Math.max(0, Math.min(A[2], B[2]) - Math.max(A[0], B[0])) * Math.max(0, Math.min(A[3], B[3]) - Math.max(A[1], B[1])) : 0);

  // -- T9.1: the farmhouse, a sleeper upstairs, every roof panel lifted (the upstairs room becomes a shell, not part of
  // the building they now wait in): they sleep inside that building, and four unrelated edits elsewhere never walk
  // them out (on the code before, each edit put them out of the door and they walked back up to their bed)
  {
    const { ctx, page, problems } = await game('bp=farmhouse&nosave=1&town=fresh&townseed=10', {});
    const r = await page.evaluate(async () => {
      const hw = __hw, D = hw.town.debug, S = D.sim;
      hw.state.set({ timeFlow: false });
      D.spawn('gardener', { trait: 'homebody' });
      D.phase('night'); D.step(2); S.reseat(); D.step(2);
      await __t.sleep(800);
      const v = S.villagers[0];
      const snap = () => [v.status, v._loc, v.plan.kind, v.plan.pose || '', v._spot].join(' ');
      const out = { asleep: snap() };
      const roofs = [...hw.world.entries.values()].filter((e) => e.p.t === 'roof_slope').map((e) => e.key);
      await D.edit((w) => { for (const k of roofs) w.remove(k); });
      D.advance(46); out.settled = snap();
      out.edits = [];
      for (let k = 0; k < 4; k++) { await D.edit((w) => w.add({ t: 'bush', x: 6 + k, y: 0, z: 7, r: 0 })); out.edits.push(snap()); D.advance(20); out.edits.push(snap()); }
      return out;
    });
    check('T9.1', 'a farmhouse sleeper upstairs, every roof panel lifted: waiting, asleep inside the building they wait in, and four unrelated edits never walk them out',
      /^waiting in inside sleep/.test(r.settled) && r.edits.every((x) => x === r.settled), r);
    allProblems.push(...problems);
    await ctx.close();
  }

  // -- T9.2..T9.4, iPhone 13, synthetic bubbles
  {
    const { ctx, page, problems } = await game('bp=cottage&nosave=1&town=fresh&townseed=3', { mobile: true });
    await page.addScriptTag({ content: SYN9 });
    await page.evaluate(() => __s9.install());
    // T9.2: a wish, a dream, a vacancy and a 💤 on one roof point: four bubbles, no disc over another (on the code
    // before, the 💤 was nudged a fixed 34 px, onto the bubble set 40 px beside)
    const z = await page.evaluate(async () => { const a = __s9.at(180, 300); __s9.set([{ key: 'w9', kind: 'wish', at: a }, { key: 'd9', kind: 'dream', at: a }, { key: 'v9', kind: 'vacancy', at: a }, { key: 'z9', kind: 'sleep', at: a }]); await __s9.frames(4); return __s9.drawn(); });
    const zbad = [];
    for (let i = 0; i < z.length; i++) for (let j = i + 1; j < z.length; j++) if (area(z[i].disc, z[j].disc) > 0) zbad.push([z[i].kind, z[j].kind]);
    check('T9.2', 'a wish, a dream, a vacancy and a 💤 on one roof point: all four drawn, no bubble over another', z.length === 4 && zbad.length === 0, { z: z.map((b) => [b.kind, Math.round(b.x)]), zbad });
    // T9.3: a wish passing a dream's roof point in 4 px steps: the dream sits beside it and never jumps across it (on the
    // code before, +40, then −40, then back)
    const pass = await page.evaluate(async () => {
      const d = __s9.at(180, 320), out = [];
      for (let dx = -48; dx <= 48; dx += 4) {
        __s9.set([{ key: 'pw', kind: 'wish', at: __s9.at(180 + dx, 320) }, { key: 'pd', kind: 'dream', at: d }]);
        await __s9.frames(3);
        const b = __s9.drawn(), w = b.find((q) => q.kind === 'k-wish'), dr = b.find((q) => q.kind === 'k-dream');
        out.push(w && dr ? Math.sign(dr.x - w.x) : 0);
      }
      return out;
    });
    let pf = 0; for (let i = 1; i < pass.length; i++) if (pass[i] !== pass[i - 1]) pf++;
    // and a vacancy hint whose anchor hovers 3-6 px beside a wish's (the reviewer's case: it hopped 81 px each time)
    const hover = await page.evaluate(async () => {
      const w = __s9.at(180, 420), out = [];
      for (let i = 0; i < 24; i++) {
        const dx = [-3, -4, -5, -6, -5, -4][i % 6];
        __s9.set([{ key: 'hw', kind: 'wish', at: w }, { key: 'hv', kind: 'vacancy', at: __s9.at(180 + dx, 420) }]);
        await __s9.frames(3);
        const b = __s9.drawn(), a = b.find((q) => q.kind === 'k-wish'), v = b.find((q) => q.kind === 'k-vacancy');
        out.push(a && v ? Math.sign(v.x - a.x) : 0);
      }
      return out;
    });
    let hf = 0; for (let i = 1; i < hover.length; i++) if (hover[i] !== hover[i - 1]) hf++;
    check('T9.3', 'a wish passing a dream\'s roof point (4 px steps): two bubbles throughout, the dream stays on one side while beside it and changes side at most once (going home once the wish is past); a vacancy hovering 3-6 px beside a wish never hops across it',
      pf <= 1 && pass.every((x) => x !== 0) && hf === 0 && hover.every((x) => x !== 0), { pass: pass.join(''), hover: hover.join('') });
    // T9.4: a wish and a dream on one point, carried from on screen up across the top edge and back, at three x: the
    // pair keeps its order (on the code before, it swapped as the roof crossed the edge)
    const cross = await page.evaluate(async () => {
      const I = __hw.rig.insets, res = {};
      for (const X of [80, 195, 300]) {
        const seq = [];
        for (const k of [...Array(61).keys(), ...[...Array(60).keys()].reverse()]) {
          const a = __s9.at(X, I.top + 120 - k * 4);
          __s9.set([{ key: 'cw' + X, kind: 'wish', at: a, v: 'v1' }, { key: 'cd' + X, kind: 'dream', at: a, v: 'v2' }]);
          await __s9.frames(3);
          const b = __s9.drawn(), w = b.find((q) => q.kind === 'k-wish'), d = b.find((q) => q.kind === 'k-dream');
          seq.push(w && d ? Math.sign(d.x - w.x) : 0);
        }
        let f = 0; for (let i = 1; i < seq.length; i++) if (seq[i] !== seq[i - 1]) f++;
        res[X] = { flips: f, zeros: seq.filter((x) => x === 0).length };
      }
      return res;
    });
    check('T9.4', 'a wish and a dream on one roof point carried across the top edge and back (x 80 / 195 / 300): the pair never swaps sides',
      Object.values(cross).every((c) => c.flips === 0 && c.zeros === 0), cross);
    allProblems.push(...problems);
    await ctx.close();
  }

  // -- T9.5, 320×568: a traveller and a wish on the right edge across 120 pairs of places (the wrapped rail column puts
  // bubbles inward of it): no arrow ever over another bubble's disc (on the code before, an inward bubble's arrow
  // pointed into its neighbour)
  {
    const SE = { viewport: { width: 320, height: 568 }, screen: { width: 320, height: 568 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 };
    const { ctx, page, problems } = await game('bp=cottage&nosave=1&town=fresh&townseed=3', { device: SE });
    await page.addScriptTag({ content: SYN9 });
    const r = await page.evaluate(async () => {
      __s9.install();
      const hw = __hw, cv = hw.renderer.domElement, I = hw.rig.insets;
      const fl = I.left, ft = I.top, fr = cv.clientWidth - I.right, fb = cv.clientHeight - I.bottom, cx = (fl + fr) / 2, cy = (ft + fb) / 2, hw2 = (fr - fl) / 2 - 50;
      const SX = 900, k = hw2 / (SX - cx), syFor = (Y) => cy + (Y - cy) / k;
      const ov = (A, B) => Math.max(0, Math.min(A[2], B[2]) - Math.max(A[0], B[0])) * Math.max(0, Math.min(A[3], B[3]) - Math.max(A[1], B[1]));
      const bad = [];
      let n = 0;
      for (let Yt = 150; Yt <= 300; Yt += 15) for (let Yw = 110; Yw <= 300; Yw += 18) {
        n++;
        __s9.set([{ key: 't5:' + n, kind: 'traveller', at: __s9.at(SX, syFor(Yt)) }, { key: 'w5:' + n, kind: 'wish', at: __s9.at(SX, syFor(Yw)) }]);
        await __s9.frames(3);
        const d = __s9.drawn().filter((b) => b.edge);
        for (const a of d) for (const b of d) if (a !== b && ov(a.arrow, b.disc) > 0) bad.push([Yt, Yw, a.kind, b.kind]);
      }
      return { n, bad };
    });
    check('T9.5', `a 320×568 phone: a traveller and a wish at ${r.n} pairs of right-edge places: no arrow over another bubble's disc`, r.n >= 100 && r.bad.length === 0, r);
    allProblems.push(...problems);
    await ctx.close();
  }
  check('T9.x', 'no console errors (repair9)', allProblems.length === 0, allProblems.slice(0, 4));
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
