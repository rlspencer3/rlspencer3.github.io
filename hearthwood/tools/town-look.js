// Hearthwood — WP2 acceptance: the town body (docs/LIVING.md §13.4, L1–L11).
//
// A tools/shot.mjs --script body (it runs inside the page and returns a report):
//   node tools/shot.mjs --query "bp=cottage&nosave=1&ui=0&town=0" --script tools/town-look.js [--mobile] [--wait 200]
// Returns { fails: [...], passed: [...], info: {...} }; `fails` is empty when every check passes.
//
// It hand-writes 20 VillagerModels with plans (§13.2: walk loops, sitting on the bench and the picnic table, lying in
// the cottage bed, chopping, fishing, watering, waving) and drives them with its own render clock; no sim, no nav.
//
// Scene mode (for the L5 screenshots): set window.__LOOK first with --eval, e.g.
//   --eval "window.__LOOK={scene:{time:0.9,view:{t:[0,1,6],th:0.5,ph:1.1,r:16}}}"
// and the script only builds the scene, leaves it running and returns; shot.mjs then takes the picture.
// scene options: time, view {t,th,ph,r}, lineup (8 jobs + a traveller in a row), level/seeAll (cutaway), pulse (the
// move-in glow), tent, highlight, cues.

const app = window.__hw;
const { THREE, world, renderer, scene, camera, state, rig, catalog } = app;
const OPT = window.__LOOK || {};
const fails = [], passed = [], info = {};
const check = (id, ok, msg) => (ok ? passed : fails).push(`${id}: ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { createActors } = await import('/js/town/actors.js');
const L = await import('/js/town/look.js');
const D = await import('/js/town/data.js');

// ------------------------------------------------------------------------------------------------ gifts (L7 part 1)
// KEYS.unlocks preset to ["gift_gnome"] before the gifts register: the gnome must come up unhidden. If main.js already
// registered them at boot, register a fresh copy of the module (cache-busting query) so it reads the key again.
const giftsAtBoot = !!catalog.getDef('gift_gnome');
let unlockProbe = null;
if (!OPT.scene) {
  try {
    localStorage.setItem(D.KEYS.unlocks, JSON.stringify(['gift_gnome']));
    await import('/js/pieces/gifts.js' + (giftsAtBoot ? '?probe=' + Date.now() : ''));
    unlockProbe = { gnome: catalog.getDef('gift_gnome')?.hidden, cart: catalog.getDef('gift_flower_cart')?.hidden };
  } finally { localStorage.removeItem(D.KEYS.unlocks); }
} else await import('/js/pieces/gifts.js');

// ------------------------------------------------------------------------------------------------ helpers
const DIRS = [[0, 1], [1, 0], [0, -1], [-1, 0]];
/** World [x, z] of a piece-local point (lx along local +X, lz along local +Z) of a cell record. */
const localXZ = (rec, lx, lz) => {
  const f = DIRS[rec.r & 3], s = DIRS[(rec.r + 1) & 3];
  return [(rec.x + 0.5) * 2 + lx * s[0] + lz * f[0], (rec.z + 0.5) * 2 + lx * s[1] + lz * f[1]];
};
const yawOf = (r) => (r & 3) * Math.PI / 2;
const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
function project(v) {
  const p = v.clone().project(camera), el = renderer.domElement;
  return { x: (p.x + 1) / 2 * el.clientWidth, y: (1 - p.y) / 2 * el.clientHeight, z: p.z };
}
const onScreen = (p, m = 30) => p.z < 1 && p.x > m && p.y > m && p.x < renderer.domElement.clientWidth - m && p.y < renderer.domElement.clientHeight - m;
/** Draw calls / triangles of one main-pass render (no shadow pass). */
function measure() {
  const inf = renderer.info, ar = inf.autoReset;
  inf.autoReset = false; inf.reset();
  const nu = renderer.shadowMap.needsUpdate;
  renderer.shadowMap.needsUpdate = false;
  renderer.render(scene, camera);
  renderer.shadowMap.needsUpdate = nu;
  const out = { calls: inf.render.calls, tris: inf.render.triangles };
  inf.autoReset = ar;
  return out;
}
/** Average RGB of a 5 × 5 block at CSS px (sx, sy), read right after a render. */
function pixel(sx, sy) {
  const nu = renderer.shadowMap.needsUpdate;
  renderer.shadowMap.needsUpdate = false;
  renderer.render(scene, camera);
  renderer.shadowMap.needsUpdate = nu;
  const gl = renderer.getContext(), pr = renderer.getPixelRatio(), H = renderer.domElement.height;
  const buf = new Uint8Array(100);
  gl.readPixels(Math.round(sx * pr) - 2, H - Math.round(sy * pr) - 3, 5, 5, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  const s = [0, 0, 0];
  for (let i = 0; i < 25; i++) { s[0] += buf[i * 4]; s[1] += buf[i * 4 + 1]; s[2] += buf[i * 4 + 2]; }
  return s.map((v) => v / 25);
}

// ------------------------------------------------------------------------------------------------ the lot
const put = (rec) => world.add(rec, { record: false });
const PICNIC = { t: 'picnic_table', x: -6, y: 0, z: 1, r: 0, m: 'wood' };
const WOODPILE = { t: 'woodpile', x: 6, y: 0, z: 1, r: 3 };
const POND = { t: 'pond', x: 6, y: 0, z: 6, r: 0 };
const BENCH = { t: 'bench', x: -2, y: 0, z: 4, r: 1 };           // part of the cottage blueprint
const BED = { t: 'bed', x: 2, y: 0, z: -2, r: 0 };               // part of the cottage blueprint
for (const rec of [PICNIC, WOODPILE, POND, { t: 'deck', x: 3, y: 0, z: -1 }]) put(rec);
world.batcher.flush();

// spill: every lowest-level door / window of the cottage (ground pools on the nav surface, openings 2 cm proud)
const isFound = (x, z) => world.get(`F|${x}|0|${z}`)?.t === 'foundation';
const lights = [];
for (const e of world.entries.values()) {
  const p = e.p;
  if (p.y !== 0 || !/^wall_(door|window)/.test(p.t)) continue;
  let n, cx, cz;
  if (p.a === 'x') { const a = isFound(p.x, p.z - 1), b = isFound(p.x, p.z); cx = (p.x + 0.5) * 2; cz = p.z * 2; n = a && !b ? [0, 1] : !a && b ? [0, -1] : null; }
  else { const a = isFound(p.x - 1, p.z), b = isFound(p.x, p.z); cx = p.x * 2; cz = (p.z + 0.5) * 2; n = a && !b ? [1, 0] : !a && b ? [-1, 0] : null; }
  if (!n) continue;
  const door = p.t.startsWith('wall_door');
  const gx = cx + n[0] * 0.75, gz = cz + n[1] * 0.75;
  const f = world.get(`F|${Math.floor(gx / 2)}|0|${Math.floor(gz / 2)}`);
  const sy = f?.t === 'path' ? 0.025 : f?.t === 'deck' ? 0.25 : 0;
  lights.push({ kind: 'ground', x: gx, y: sy + 0.03, z: gz, nx: n[0], nz: n[1], w: 1.6, h: 1.2, homeId: 'cottage', door });
  lights.push({ kind: 'opening', x: cx + n[0] * 0.11, y: 0.25 + (door ? 1.0 : 1.32), z: cz + n[1] * 0.11, nx: n[0], nz: n[1], w: door ? 0.86 : 0.8, h: door ? 1.95 : 1.0, homeId: 'cottage', door });
}

// ------------------------------------------------------------------------------------------------ 20 villagers
let planSeq = 1;
const looks = (i) => ({ outfit: i % 3, skin: (i * 5) % 6, hair: (i * 7 + 1) % 6, build: (i * 2) % 3 });
const flags = (o = {}) => ({ tool: true, pack: false, basket: false, book: false, lantern: false, ...o });
const pose = (at, face, poseId, level = 0) => ({ kind: 'pose', at, face, pose: poseId, t0: 0, t1: Infinity, level });
function V(i, job, plan, fl = {}, extra = {}) {
  return { id: 'v' + i, name: job + i, job, trait: 'early', voice: 1, seed: 1234 + i * 977, look: looks(i), status: 'resident',
    leaving: false, homeId: null, bed: null, feet: [], arrived: 0, grants: 0, plan, planId: planSeq++, wish: null, flags: flags(fl), mood: 2, ...extra };
}
function walkPlan(pts2, t0, speed = 1.25, hops = []) {
  const pts = new Float32Array(pts2.length * 3);
  let len = 0;
  pts2.forEach(([x, z, y = 0], i) => {
    pts.set([x, y, z], i * 3);
    if (i) len += Math.hypot(x - pts2[i - 1][0], z - pts2[i - 1][1]);
  });
  return { kind: 'walk', pts, len, t0, t1: t0 + len / speed, hops, slips: [], hurry: false };
}
const seatAt = (rec, seat) => { const [x, z] = localXZ(rec, seat[0], seat[2]); return { at: [x, seat[1], z], face: yawOf(rec.r) + seat[3] }; };

const WALKS = {
  v0: { job: 'postie', pts: [[-14, 16], [14, 16]] },
  v1: { job: 'farmer', pts: [[-9, -8], [9, -8], [9, -12], [-9, -12]] },
  v2: { job: 'lamplighter', pts: [[-16, -2], [-16, 12]] },
  v3: { job: 'fisher', pts: [[-30, -4], [-21, -2], [-14, 4]], speed: 1.6, fl: { pack: true, tool: false } },
  v4: { job: 'baker', pts: [[-3, 6.5], [-3, 9], [-3, 11], [-3, 13.5]], hops: [1], fl: { basket: true } },   // hops the hedge
  v5: { job: 'beekeeper', pts: [[14, -6], [14, 10]] },
};
function makeModels() {
  const m = [];
  for (const [id, w] of Object.entries(WALKS)) {
    const i = +id.slice(1);
    m.push(V(i, w.job, walkPlan(w.pts, 0, w.speed || 1.25, w.hops || []), w.fl || {}, { walk: w, dir: 1 }));
  }
  const bench = D.SPOT_DEFS.bench.seats, picnic = D.SPOT_DEFS.picnic_table.seats;
  let s = seatAt(BENCH, bench[0]); m.push(V(6, 'gardener', pose(s.at, s.face, 'sit'), { tool: false }));
  s = seatAt(BENCH, bench[1]); m.push(V(7, 'postie', pose(s.at, s.face, 'read'), { tool: false, book: true }));
  s = seatAt(PICNIC, picnic[0]); m.push(V(8, 'farmer', pose(s.at, s.face, 'chat'), { tool: false }));
  s = seatAt(PICNIC, picnic[1]); m.push(V(9, 'baker', pose(s.at, s.face, 'sit'), { tool: false }));
  // asleep in the cottage bed (inside, level 0): body centre at the bed's local (0, 0.62, −0.10) (§5.7)
  const [bx, bz] = localXZ(BED, 0, -0.1);
  m.push(V(10, 'lamplighter', { kind: 'inside', homeId: 'cottage', level: 0, at: [bx, 0.25 + 0.62, bz], face: yawOf(BED.r), pose: 'sleep', t0: 0, t1: Infinity }, { tool: false }));
  // chopping at the woodpile's front cell, fishing beside the pond, watering blooms, waving at the camera
  const [wx, wz] = localXZ(WOODPILE, 0, 2);
  m.push(V(11, 'woodcutter', pose([wx + 0.2, 0, wz + 0.6], Math.PI / 2, 'chop')));
  m.push(V(12, 'woodcutter', pose([wx + 0.2, 0, wz - 0.7], Math.PI / 2, 'chop')));
  m.push(V(13, 'fisher', pose([11.2, 0, 13], Math.PI / 2, 'fish')));
  m.push(V(14, 'fisher', pose([13, 0, 11.2], 0, 'fish')));
  m.push(V(15, 'gardener', pose([9, 0, 5], -Math.PI / 2, 'water')));
  m.push(V(16, 'gardener', pose([-7, 0, 5], Math.PI / 2, 'water')));
  m.push(V(17, 'beekeeper', pose([-2, 0, 12.6], 0, 'wave'), { tool: false }));
  m.push(V(18, 'woodcutter', pose([2.2, 0, 12.8], 0, 'wave'), { tool: false }));
  m.push(V(19, 'postie', pose([6, 0, 12.2], -0.3, 'wave'), { tool: false }));
  return m;
}
function lineupModels() {
  const jobs = L.JOBS;
  const m = jobs.map((job, i) => V(i, job, pose([-7 + i * 2, 0, 14], 0, 'stand')));
  m.push(V(8, 'gardener', pose([10, 0, 14], 0, 'stand'), { pack: true, tool: false }));
  return m;
}

// ------------------------------------------------------------------------------------------------ the driver
let clock = 0, last = performance.now(), running = true;
let A = null, models = [];
const frameCtx = () => ({ night: app.env?.night ?? 0, viewLevel: world.viewLevel, seeAll: world.seeAll, photo: !!state.photoMode,
  camTarget: [rig.target.x, rig.target.y, rig.target.z] });
function drive() {
  const night = (app.env?.night ?? 0) > 0.4;
  for (const m of models) {
    if (m.walk) {
      m.flags.lantern = night;
      if (clock >= m.plan.t1 + 0.6) {
        m.dir = -m.dir;
        const pts = m.dir > 0 ? m.walk.pts : [...m.walk.pts].reverse();
        const hops = (m.walk.hops || []).map((h) => (m.dir > 0 ? h : m.walk.pts.length - 2 - h));
        m.plan = walkPlan(pts, clock, m.walk.speed || 1.25, hops);
        m.planId = planSeq++;
      }
    }
  }
}
function step(dt) { clock += dt; drive(); A.update(dt, clock, frameCtx()); }
function loop() {
  if (!running) return;
  const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  try { step(dt); } catch (e) { running = false; console.error('[town-look] driver', e); }
  requestAnimationFrame(loop);
}

// ================================================================================================ scene mode (L5)
if (OPT.scene) {
  const S = OPT.scene;
  if (S.time !== undefined) state.set({ time: S.time, timeFlow: false });
  A = createActors(app);
  await A.compile(camera);
  models = S.lineup ? lineupModels() : makeModels();
  A.sync(models);
  A.setSpill(lights, () => 1);
  if (S.tent !== false) A.setCamp([{ x: -21, z: 3 }]);
  if (S.level !== undefined) state.set({ level: S.level, seeAll: !!S.seeAll });
  if (S.view) rig.setView(S.view, true);
  window.__townLook = { A, models };
  loop();
  if (S.walk) {             // the lineup strolls along +X (and back)
    for (const m of models) {
      const [x, , z] = m.plan.at;
      m.walk = { pts: [[x - 3, z], [x + 3, z]] };
      m.dir = 1;
      m.plan = walkPlan(m.walk.pts, clock, 1.25);
      m.planId = planSeq++;
    }
  }
  if (S.follow) {           // keep the camera on one villager (rig.focus each frame)
    const f = () => { const p = A.positionOf(S.follow); if (p) rig.focus(p.x, p.y + 0.6, p.z); if (running) requestAnimationFrame(f); };
    f();
  }
  if (S.highlight) A.highlight({ cells: [{ x: 3, y: 0, z: 5 }, { x: -1, y: 0, z: 7 }], ghost: { t: 'bench', x: -1, y: 0, z: 3, r: 0, m: 'wood' } });
  await sleep(S.settle ?? 2500);
  if (S.pulse) A.cue({ kind: 'pulse', home: 'cottage' });
  if (S.cues) {
    A.cue({ kind: 'hearts', id: 'v17' }); A.cue({ kind: 'chips', id: 'v11' }); A.cue({ kind: 'drops', id: 'v15' });
    A.cue({ kind: 'bees', at: [8, 1, 1] }); A.cue({ kind: 'note', id: 'v18' }); A.cue({ kind: 'puff', at: [3.5, 5.6, 2.5], n: 8 });
    A.cue({ kind: 'z', id: 'v10' });
  }
  return { scene: true, stats: A.stats(), night: app.env?.night };
}

// ================================================================================================ checks

// ---- L4 baseline (before the town exists; the lot fully baked)
world.batcher.bakeNow();
await sleep(300);
world.batcher.bakeNow();
const before = { batch: JSON.stringify(world.batcher.stats()), rootKids: world.root.children.length, tweens: app.effects.tweens.length };
const progBefore = renderer.info.programs.length;

// ---- L9 setup: actors + compile behind the "loading screen", then count programs
A = createActors(app);
await A.compile(camera);
const prog0 = renderer.info.programs.length;
info.programs = { beforeTown: progBefore, afterCompile: prog0 };

models = makeModels();
A.sync(models);
A.setSpill(lights, () => 1);
A.setCamp([{ x: -21, z: 3 }]);
loop();
await sleep(2500);

// ---- L9: everything shown (20 villagers of all jobs, lanterns, blobs, spill, FX, a tent, rings) → no new program
state.set({ time: 0.9, timeFlow: false });
await sleep(1200);
for (const m of models) m.flags.lantern = true;
A.cue({ kind: 'pulse', home: 'cottage' });
A.cue({ kind: 'hearts', at: [0, 2, 8] });
A.highlight({ cells: [{ x: 3, y: 0, z: 5 }], faint: [{ x: 5, y: 0, z: 5 }] });
await sleep(600);
measure();
const prog1 = renderer.info.programs.length;
const st9 = A.stats();
info.L9 = { prog0, prog1, stats: st9 };
check('L9', prog1 === prog0, `no program compiled on first use (programs ${prog0} → ${prog1})`);
A.highlight(null);

// ---- L1: budgets with 20 villagers (night: lanterns + spill + FX; and day)
const jobsShown = new Set(models.map((m) => m.job));
check('L1', jobsShown.size === 8 && models.length === 20, `20 villagers of all 8 jobs (${models.length}, ${jobsShown.size} jobs)`);
async function budget(label) {
  A.cue({ kind: 'sparkle', at: [0, 1.5, 9] });
  await sleep(150);
  A.setVisible(false); const off = measure();
  A.setVisible(true); const on = measure();
  const d = { calls: on.calls - off.calls, tris: on.tris - off.tris, stats: A.stats() };
  info['L1-' + label] = d;
  check('L1', d.calls <= 13, `${label}: render-call delta ${d.calls} ≤ 13`);
  check('L1', d.tris <= 20000, `${label}: triangle delta ${d.tris} ≤ 20k`);
  return d;
}
await budget('night');
state.set({ time: 0.42, timeFlow: false });
for (const m of models) if (!m.walk) m.flags.lantern = false;
await sleep(1500);
await budget('day');
// update cost: EMA from the live loop, plus a tight loop (headless SwiftShader; JS only). On a shared, loaded machine
// one batch can take several times the next (R2 T2.5), so, as B9 does, the loop runs as nine 100-update batches with a
// short pause between them and the budget is checked against the fastest (the cost without the noise); the median and
// a same-page calibration loop are reported beside it so a slow run can be told from a slow machine
await sleep(1500);
const ema = A.stats().updateMs;
const calib = () => { const c0 = performance.now(); let a = 0; for (let k = 0; k < 2e6; k++) a = (a + k * 7) % 1000003; return [performance.now() - c0, a]; };
const calibMs = +Math.min(...[0, 1, 2].map(() => calib()[0])).toFixed(2);
const batches = [];
for (let b = 0; b < 9; b++) {
  const t0 = performance.now();
  for (let i = 0; i < 100; i++) { clock += 1 / 60; drive(); A.update(1 / 60, clock, frameCtx()); }
  batches.push((performance.now() - t0) / 100);
  await sleep(20);
}
const sortedB = batches.slice().sort((a, b) => a - b);
const fastest = sortedB[0], median = sortedB[4];
info.L1update = { ema, fastest: +fastest.toFixed(3), median: +median.toFixed(3), batches: batches.map((x) => +x.toFixed(3)), calibMs };
check('L1', ema <= 0.3 || fastest <= 0.3, `update EMA ${ema} ms / tight loop fastest of 9 batches ${fastest.toFixed(3)} ms (median ${median.toFixed(3)}, calib ${calibMs} ms) ≤ 0.3 ms`);

// ---- L2: hit test (chest → id with pad 12 and 24; 20 px outside → null at 12, id at 24; 60 px → null)
// probed from a few closer views so that a narrow phone screen still shows villagers apart
const f5 = () => camera.projectionMatrix.elements[5] * renderer.domElement.clientHeight / 2;
function capsuleOf(a) {
  const P0 = v3(0, 0.3, 0).applyMatrix4(a.matrix), P1 = v3(0, 0.95, 0).applyMatrix4(a.matrix);
  const d0 = -P0.clone().applyMatrix4(camera.matrixWorldInverse).z, d1 = -P1.clone().applyMatrix4(camera.matrixWorldInverse).z;
  const p0 = project(P0), p1 = project(P1);
  return { p0, p1, r: 0.3 * f5() / ((d0 + d1) / 2) };
}
function segDist(c, x, y) {
  const vx = c.p1.x - c.p0.x, vy = c.p1.y - c.p0.y, L2 = vx * vx + vy * vy;
  const t = L2 > 1e-6 ? Math.max(0, Math.min(1, ((x - c.p0.x) * vx + (y - c.p0.y) * vy) / L2)) : 0;
  return Math.hypot(x - (c.p0.x + vx * t), y - (c.p0.y + vy * t));
}
const l2ids = new Set(), l2sideIds = new Set(), l2bad = [];
const narrow = renderer.domElement.clientWidth < 600;
// views centred on each group of villagers (a portrait phone sees a strip ~10 m wide)
const VIEWS = narrow
  ? [[-1, 11], [11, 8], [-9, 4], [4, -4], [0, 16], [0, -10], [-16, 4], [14, 2]].map(([x, z]) => ({ t: [x, 0.5, z], th: 0.3, ph: 0.85, r: 20 }))
  : [{ t: [0, 0.5, 6], th: 0.35, ph: 1.0, r: 26 }, { t: [8, 0.5, 6], th: -0.3, ph: 1.0, r: 16 }];
const margin = narrow ? 40 : 70;
for (const view of VIEWS) {
  rig.setView(view, true);
  await sleep(300);
  step(0);
  const drawnNow = models.filter((m) => A.actor(m.id)?.drawn && m.status !== 'passerby');
  const caps = new Map(drawnNow.map((m) => [m.id, capsuleOf(A.actor(m.id))]));
  const vstat = { drawn: drawnNow.length, onScreen: 0, crowded: 0 };
  (info.L2views ||= []).push(vstat);
  for (const m of drawnNow) {
    const a = A.actor(m.id), c = caps.get(m.id);
    const chest = project(v3(0, 0.7, 0).applyMatrix4(a.matrix));
    if (!onScreen(chest, margin)) continue;
    vstat.onScreen++;
    const near = (x, y, pad) => [...caps].some(([id, k]) => id !== m.id && segDist(k, x, y) <= k.r + pad);
    if (near(chest.x, chest.y, 30)) { vstat.crowded++; continue; }
    l2ids.add(m.id);
    const h12 = A.hitTest(chest.x, chest.y, 12), h24 = A.hitTest(chest.x, chest.y, 24);
    if (h12?.id !== m.id || h24?.id !== m.id) l2bad.push(`${m.id} chest → ${h12?.id}/${h24?.id}`);
    // perpendicular to the projected body axis, 20 px and 60 px beyond the capsule edge
    const ax = c.p1.x - c.p0.x, ay = c.p1.y - c.p0.y, al = Math.hypot(ax, ay) || 1;
    for (const s of [1, -1]) {
      const nx = (-ay / al) * s, ny = (ax / al) * s;
      const base = segDist(c, chest.x, chest.y);
      const k20 = c.r + 20 - base, k60 = c.r + 60 - base;
      const p20 = [chest.x + nx * k20, chest.y + ny * k20], p60 = [chest.x + nx * k60, chest.y + ny * k60];
      if (near(...p20, 40) || near(...p60, 40)) continue;
      l2sideIds.add(m.id);
      const a12 = A.hitTest(...p20, 12), a24 = A.hitTest(...p20, 24), b24 = A.hitTest(...p60, 24);
      if (a12 !== null) l2bad.push(`${m.id} 20px pad12 → ${a12?.id}`);
      if (a24?.id !== m.id) l2bad.push(`${m.id} 20px pad24 → ${a24?.id}`);
      if (b24 !== null) l2bad.push(`${m.id} 60px → ${b24?.id}`);
      break;
    }
  }
}
info.L2 = { views: VIEWS.length, checked: l2ids.size, sides: l2sideIds.size, bad: l2bad };
check('L2', l2ids.size >= 10 && l2sideIds.size >= 8 && !l2bad.length, `hit test on ${l2ids.size} villagers (${l2sideIds.size} with side probes)${l2bad.length ? ': ' + l2bad.join('; ') : ''}`);

// ---- L3: a villager inside on level 1 is hidden with level 0 + seeAll false, shown with seeAll
const up = V(20, 'baker', { kind: 'inside', homeId: 'x', level: 1, at: [0, 2.75, 0], face: 0, pose: 'stand', t0: 0, t1: Infinity });
A.sync([...models, up]);
state.set({ level: 0, seeAll: false });
step(0.05);
const hid = A.positionOf('v20')?.visible;
state.set({ seeAll: true });
step(0.05);
const shown = A.positionOf('v20')?.visible;
check('L3', hid === false && shown === true, `inside on level 1: hidden at level 0 without seeAll (${hid}), shown with seeAll (${shown})`);
A.sync(models);

// ---- L4: batching untouched, layers, tweens, shadow map
step(0.05);
const layersOk = (() => { let ok = true; A.group.traverse((o) => { if (o.layers.mask !== 1) ok = false; }); return ok; })();
const inRoot = (() => { let found = false; world.root.traverse((o) => { if (o.name && o.name.startsWith('town')) found = true; }); return found; })();
renderer.shadowMap.needsUpdate = false;
for (let i = 0; i < 30; i++) step(1 / 60);
const shadowSet = renderer.shadowMap.needsUpdate;
const after = { batch: JSON.stringify(world.batcher.stats()), rootKids: world.root.children.length, tweens: app.effects.tweens.length };
info.L4 = { before, after };
check('L4', after.rootKids === before.rootKids && !inRoot, `world.root untouched (${before.rootKids} → ${after.rootKids} children)`);
check('L4', A.group.parent === scene, 'the town group sits in app.scene');
check('L4', layersOk, 'every town object is on layer 0 only');
check('L4', after.tweens === before.tweens, `effects tweens unchanged (${before.tweens} → ${after.tweens})`);
check('L4', !shadowSet, 'actors.update never sets shadowMap.needsUpdate');
check('L4', (() => { let c = false; A.group.traverse((o) => { if (o.castShadow) c = true; }); return !c; })(), 'no town object casts shadows');
const bs0 = JSON.parse(before.batch), bs1 = JSON.parse(after.batch);
check('L4', bs0.units === bs1.units && bs0.meshes === bs1.meshes && bs0.entries === bs1.entries && bs0.verts === bs1.verts,
  `batcher stats unchanged (units ${bs0.units} → ${bs1.units}, meshes ${bs0.meshes} → ${bs1.meshes}, entries ${bs0.entries} → ${bs1.entries})`);

// ---- L8: 256 FX particles in one frame → one FX draw call
A.setVisible(false); const fx0 = measure();
A.setVisible(true);
for (let i = 0; i < 4; i++) A.cue({ kind: 'hearts', at: [i, 1.5, 8], n: 64 });
step(1 / 60);
const fxA = measure();
const pts = A.render.fx;
A.render.fx.visible = false; const fxB = measure(); A.render.fx.visible = true;
info.L8 = { off: fx0.calls, on: fxA.calls, withoutFx: fxB.calls };
check('L8', fxA.calls - fxB.calls === 1 && pts.isPoints, `256 particles cost one draw call (${fxA.calls - fxB.calls})`);

// ---- L10: move-in glow at 10:05 lights the door opening (≥ 0.7) for 2.5 s
state.set({ time: 0.42, timeFlow: false });
await sleep(800);
const doorOpen = lights.find((l) => l.kind === 'opening' && l.door);
rig.setView({ t: [doorOpen.x, 1.3, doorOpen.z], th: 0.15, ph: 1.25, r: 9 }, true);
await sleep(500);
running = false;
step(1 / 60);
const dp = project(v3(doorOpen.x, doorOpen.y, doorOpen.z));
const px0 = pixel(dp.x, dp.y);
A.cue({ kind: 'pulse', home: 'cottage' });
const lvls = [];
let px1 = null;
for (let t = 0; t <= 2.7; t += 0.05) {
  step(0.05);
  const spill = A.render.spill;
  const i = lights.indexOf(doorOpen);
  const c = new THREE.Color(); spill.getColorAt(i, c);
  lvls.push([+t.toFixed(2), spill.visible ? +c.r.toFixed(3) : 0]);
  if (Math.abs(t - 0.5) < 0.026) px1 = pixel(dp.x, dp.y);
}
const lit = lvls.filter(([t]) => t >= 0.15 && t <= 1.65).every(([, b]) => b >= 0.7);
const off = lvls[lvls.length - 1][1] === 0;
const gain = px1 ? (px1[0] + px1[1] + px1[2]) - (px0[0] + px0[1] + px0[2]) : 0;
info.L10 = { levels: lvls.filter((_, k) => k % 6 === 0), px0, px1, gain };
check('L10', lit && off, `opening + ground quads ≥ 0.7 from 0.15 s to 1.65 s, out by 2.7 s (night ${(app.env?.night ?? 0).toFixed(2)})`);
check('L10', gain > 60, `the door opening brightens in the frame (Σ RGB +${gain.toFixed(0)})`);
running = true; last = performance.now(); loop();

// ---- L11: highlightHit — ring centre at ground level and the ghost bench's top (+0.9 m) → that rec's index
rig.setView({ t: [1, 1.0, 6], th: 0.0, ph: 1.2, r: 12 }, true);
await sleep(400);
const ringA = { x: -3, y: 0, z: 13 }, ringB = { x: 1, y: 0.025, z: 6.2 };
A.highlight({ cells: [ringA, ringB], ghost: { t: 'bench', x: 0, y: 0, z: 2, r: 0, m: 'wood' } });
step(1 / 60);
const pa = project(v3(ringA.x, ringA.y, ringA.z)), pg = project(v3(1, 0.025 + 0.9, 5));
const hA = A.highlightHit(pa.x, pa.y), hG = A.highlightHit(pg.x, pg.y);
// 40 px beyond the far edge of ring A (left of it) and off the ghost
const edge = project(v3(ringA.x - 0.9, ringA.y, ringA.z));
const hOff = A.highlightHit(edge.x - 40, edge.y);
const wallBehind = app.builder.pickPiece(pg.x, pg.y);
info.L11 = { hA, hG, hOff, ghostScreen: pg, wall: wallBehind?.entry?.p?.t };
check('L11', hA === 0, `ring centre → index ${hA} (0)`);
check('L11', hG === 1, `ghost bench top → index ${hG} (1)${wallBehind ? ', with ' + wallBehind.entry.p.t + ' behind it' : ''}`);
check('L11', hOff === -1, `40 px off → ${hOff} (−1)`);
A.highlight(null);

// ---- L6: window.__townNoPatch → plain material, no errors, ≤ 13 calls
window.__townNoPatch = true;
let l6 = null;
try {
  const B = createActors(app);
  await B.compile(camera);
  const mB = makeModels();
  B.sync(mB);
  A.setVisible(false);
  B.setVisible(false); const b0 = measure();
  B.setVisible(true);
  for (let i = 0; i < 40; i++) B.update(1 / 60, clock + i / 60, frameCtx());
  const b1 = measure();
  l6 = { patched: B.render.patched, calls: b1.calls - b0.calls, stats: B.stats() };
  scene.remove(B.group);
  A.setVisible(true);
} catch (e) { l6 = { error: String(e) }; }
delete window.__townNoPatch;
info.L6 = l6;
check('L6', l6 && l6.patched === false && l6.calls >= 8 && l6.calls <= 13 && !l6.error, `plain material fallback: patched ${l6?.patched}, ${l6?.calls} calls (bodies drawn), ${l6?.stats?.instances} instances`);

// ---- L7: gifts
const GIDS = Object.keys(D.GIFTS);
const defs = GIDS.map((id) => catalog.getDef(id));
const meta = GIDS.map((id, i) => {
  const d = defs[i], G = D.GIFTS[id];
  const okSeats = JSON.stringify(d?.seats || []) === JSON.stringify(G.seats);
  return d && d.name === G.name && (d.gift?.job ?? null) === G.job && d.walk === G.walk && d.cat === 'garden' && d.slot === 'cell' && d.layer === 'I' && okSeats;
});
check('L7', meta.every(Boolean), `defs equal GIFTS (ids, names, gift.job, walk, seats, garden / cell / I): ${GIDS.filter((_, i) => !meta[i]).join(',') || 'all'}`);
check('L7', unlockProbe && unlockProbe.gnome === false && unlockProbe.cart === true, `KEYS.unlocks ["gift_gnome"] → gnome hidden ${unlockProbe?.gnome}, others hidden ${unlockProbe?.cart}`);
// seat anchors within 2 cm of the built seat surfaces (raycast down onto the built piece, on grass)
const ray = new THREE.Raycaster();
const seatBad = [];
for (const id of GIDS) {
  const seats = D.GIFTS[id].seats;
  if (!seats.length) continue;
  const obj = world.buildLocal({ t: id, x: 500, y: 0, z: 500, r: 0 });       // off the lot: on grass, as thumbs build
  obj.updateMatrixWorld(true);
  for (const s of seats) {
    ray.set(v3(s[0], 3, s[2]), v3(0, -1, 0));
    const hit = ray.intersectObject(obj, true)[0];
    const surf = -0.25 + s[1];
    if (!hit || Math.abs(hit.point.y - surf) > 0.02) seatBad.push(`${id} seat ${s.join(',')} hit ${hit ? hit.point.y.toFixed(3) : 'none'} vs ${surf.toFixed(3)}`);
  }
}
check('L7', !seatBad.length, `seat anchors on the built seats${seatBad.length ? ': ' + seatBad.join('; ') : ''}`);
// each gift on grass, path, deck, a Floor-2 floor and a flat roof (ground-only gifts: the ground surfaces)
world.clear({ record: false });
const SURF = [
  { name: 'grass', y: 0, setup: () => {} },
  { name: 'path', y: 0.025, setup: (x, z) => put({ t: 'path', x, y: 0, z }) },
  { name: 'deck', y: 0.25, setup: (x, z) => put({ t: 'deck', x, y: 0, z }) },
  { name: 'floor2', y: 0.25 + 2.5 + 0.006, lv: 1, setup: (x, z) => { put({ t: 'foundation', x, y: 0, z }); put({ t: 'floor', x, y: 1, z }); } },
  { name: 'flatroof', y: 0.25 + 2.5 + 0.166, lv: 1, setup: (x, z) => put({ t: 'roof_flat', x, y: 1, z, h: 0 }) },
];
const placeBad = [], lowBad = [], triBad = [], sigBad = [];
let gx = -9;
for (const id of GIDS) {
  const d = catalog.getDef(id);
  let gz = -9;
  for (const S of SURF) {
    if (S.lv && d.levels[1] < S.lv) continue;
    S.setup(gx, gz);
    const rec = { t: id, x: gx, y: S.lv || 0, z: gz, r: 0, m: d.mats?.[0] };
    const e = put(rec);
    if (!e) { placeBad.push(`${id}@${S.name}: ${world.validate(world.normalize(rec))?.reason || 'rejected'}`); gz += 2; continue; }
    e.obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(e.obj);
    if (Math.abs(box.min.y - S.y) > 0.02) lowBad.push(`${id}@${S.name} low ${box.min.y.toFixed(3)} vs ${S.y.toFixed(3)}`);
    gz += 2;
  }
  let tris = 0;
  world.buildLocal({ t: id, x: 0, y: 0, z: 0, r: 0 }).traverse((o) => { if (o.isMesh) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
  if (tris > 1500) triBad.push(`${id} ${tris}`);
  // deterministic: same signature twice, and two raw builds give the same vertices
  const r0 = { t: id, x: 1, y: 0, z: 1, r: 0 };
  const sum = () => { let s = 0, n = 0; const g = d.build(world.normalize(r0), world.ctxFor(world.normalize(r0), d)); g.updateMatrixWorld(true); g.traverse((o) => { if (o.isMesh) { const p = o.geometry.attributes.position; for (let i = 0; i < p.count; i += 7) { s += p.getX(i) * 3 + p.getY(i) * 5 + p.getZ(i) * 7; n++; } } }); return s.toFixed(4) + ':' + n; };
  if (world.signature(r0) !== world.signature(r0) || sum() !== sum()) sigBad.push(id);
  gx += 2;
}
info.L7place = { placeBad, lowBad, triBad, sigBad };
check('L7', !placeBad.length, `placed on grass, path, deck, Floor 2 and a flat roof${placeBad.length ? ': ' + placeBad.join('; ') : ''}`);
check('L7', !lowBad.length, `lowest point within 2 cm of the surface${lowBad.length ? ': ' + lowBad.join('; ') : ''}`);
check('L7', !triBad.length, `≤ 1.5k triangles${triBad.length ? ': ' + triBad.join('; ') : ''}`);
check('L7', !sigBad.length, `deterministic builds${sigBad.length ? ': ' + sigBad.join(',') : ''}`);
world.batcher.flush();
world.batcher.bakeNow();
await sleep(900);
world.batcher.bakeNow();
const notBaked = [...world.entries.values()].filter((e) => e.def.gift && !world.batcher.isBaked(e)).map((e) => e.p.t + '@' + e.p.x + ',' + e.p.z);
check('L7', !notBaked.length, `every placed gift is baked after flush + settle${notBaked.length ? ': ' + notBaked.slice(0, 6).join(', ') : ''}`);
// no new material: warm the mat() cache with every other piece's default look (4 variants) and every blueprint,
// then building all ten gifts at their default look creates no THREE.Material and uses only names already seen
const seen = new Set();
const collect = (o, set) => o.traverse((m) => { if (m.isMesh) set.add(m.material.name); });
for (const d of catalog.allDefs()) {
  if (d.gift) continue;
  for (let x = 0; x < 4; x++) {
    const rec = { t: d.id, x, y: 0, z: 0, r: 0, a: 'x', m: d.mats?.[0], ...(d.thumb || {}) };   // x 0..3: the 4 variants
    if (d.layer === 'R') rec.h = rec.h || 0;
    try { collect(world.buildLocal(rec), seen); } catch { /* a piece that can't build in isolation */ }
  }
}
for (const b of app.blueprints.list()) for (const p of app.blueprints.get(b.id).pieces) { try { collect(world.buildLocal(p), seen); } catch { /* skip */ } }
// (mat() caches by name 'id|colour', so a gift name not seen above would be a new cache entry; a Material-id probe
// can't be used: three's Mesh.clone() constructs a throwaway default material)
const giftMats = new Set();
for (const id of GIDS) for (const s of ['g', 'p', 'f']) {
  const rec = { t: id, x: s === 'g' ? 7 : 8, y: 0, z: 7, r: 0, m: catalog.getDef(id).mats?.[0] };
  collect(world.buildLocal(rec), giftMats);
}
const newNames = [...giftMats].filter((n) => !seen.has(n));
info.L7mats = { gift: [...giftMats].sort(), newNames, baseline: seen.size };
check('L7', !newNames.length, `building all ten gifts uses only (material, colour) pairs other pieces already made (${giftMats.size} pairs; new: ${newNames.join(', ') || 'none'})`);
// the bread oven adds one smoke emitter
const envE = app.env?.env;
if (envE) {
  world.clear({ record: false });
  await sleep(100);
  const n0 = envE.emitters.length;
  put({ t: 'gift_bread_oven', x: 0, y: 0, z: 0, r: 0 });
  await sleep(200);
  const n1 = envE.emitters.length;
  check('L7', n1 === n0 + 1, `the bread oven adds one smoke emitter (${n0} → ${n1})`);
}
// ?showcase=all uses allDefs: the ten gifts are in it (main.js must load gifts.js with the other piece modules)
const inAll = catalog.allDefs().filter((d) => d.gift).length;
check('L7', inAll === 10, `catalog.allDefs() (the showcase=all list) holds ${inAll} gifts`);
info.giftsAtBoot = giftsAtBoot;

running = false;
return { fails, passed: passed.length, passedList: passed, info };
