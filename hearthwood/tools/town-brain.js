// Hearthwood — Living Town, WP1 acceptance (docs/LIVING.md §13.4 B1–B12). A tools/shot.mjs --script body: it runs in
// the real page, imports the town brain by absolute path and uses the real world, catalog and blueprints.
//   node tools/shot.mjs --query "clean=1&nosave=1&ui=0&town=0" --script tools/town-brain.js --wait 200
// Returns { fails: [], report: {…} } (fails is empty when every check passes).
const app = window.__hw;
const { world, catalog, blueprints } = app;
const M = await import('/js/town/model.js');
const H = await import('/js/town/homes.js');
const Rc = await import('/js/town/recipes.js');
const Wm = await import('/js/town/wishes.js');
const Sm = await import('/js/town/sim.js');
const St = await import('/js/town/store.js');
const D = await import('/js/town/data.js');
const fails = [], report = {};
const fail = (id, msg) => fails.push(`${id}: ${msg}`);
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const lane = app.modules?.env?.LANE || D.LANE_FALLBACK;
const heightAt = app.env?.heightAt || (() => 0);
const norm = (r) => world.normalize(r) || r;
const model = (tents = []) => M.buildWorldModel({
  entries: world.entries, defOf: catalog.getDef, version: world.version, lane, heightAt, tents,
  validate: (r) => world.validate(norm(r)), isFree: (r) => { const n = world.normalize(r); return !n || world.get(world.keyOf(n)) === undefined; },
});
const CTX = { sky: 0.42, flowing: false, guided: false, night: 0 };
const now = () => performance.now();

// ---------------------------------------------------------------------------------------------- fixtures (§13.4, Appendix A)
function SMALL_HOME(x0, z0, o = {}) {
  const P = [];
  for (let x = x0; x <= x0 + 1; x++) for (let z = z0; z <= z0 + 1; z++) { if (!o.noFound) P.push({ t: 'foundation', x, y: 0, z }); if (!o.noRoof) P.push({ t: 'roof_flat', x, y: 1, z, h: 0 }); }
  for (let x = x0; x <= x0 + 1; x++) { if (!(o.noBack && x === x0)) P.push({ t: 'wall', a: 'x', x, y: 0, z: z0 }); if (!(o.gapDoor && x === x0)) P.push({ t: x === x0 && !o.noDoor ? 'wall_door' : 'wall', a: 'x', x, y: 0, z: z0 + 2 }); }
  for (let z = z0; z <= z0 + 1; z++) { P.push({ t: 'wall', a: 'z', x: x0, y: 0, z }); P.push({ t: 'wall', a: 'z', x: x0 + 2, y: 0, z }); }
  if (!o.noBed) P.push({ t: 'bed', x: x0, y: 0, z: z0 });
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
const roofFlat = (cells, y = 1) => cells.map(([x, z]) => ({ t: 'roof_flat', x, y, z, h: 0 }));
function ring(x0, z0, x1, z1, t) {
  const P = [];
  for (let x = x0; x <= x1; x++) { P.push({ t, a: 'x', x, y: 0, z: z0 }); P.push({ t, a: 'x', x, y: 0, z: z1 + 1 }); }
  for (let z = z0; z <= z1; z++) { P.push({ t, a: 'z', x: x0, y: 0, z }); P.push({ t, a: 'z', x: x1 + 1, y: 0, z }); }
  return P;
}
function semis(bedR = true, rightDoor = true) {
  const P = [];
  for (let x = 0; x < 4; x++) for (let z = 0; z < 2; z++) P.push({ t: 'foundation', x, y: 0, z });
  for (let x = 0; x < 4; x++) { P.push({ t: x === 1 || (x === 2 && rightDoor) ? 'wall_door' : 'wall', a: 'x', x, y: 0, z: 2 }); P.push({ t: 'wall', a: 'x', x, y: 0, z: 0, r: 2 }); }
  for (let z = 0; z < 2; z++) { P.push({ t: 'wall', a: 'z', x: 0, y: 0, z, r: 2 }); P.push({ t: 'wall', a: 'z', x: 4, y: 0, z }); P.push({ t: 'wall', a: 'z', x: 2, y: 0, z }); }
  for (let x = 0; x < 4; x++) for (let z = 0; z < 2; z++) P.push({ t: 'roof_flat', x, y: 1, z, h: 0 });
  P.push({ t: 'bed', x: 0, y: 0, z: 0 }); if (bedR) P.push({ t: 'bed', x: 3, y: 0, z: 0 });
  return P;
}
const FIXTURES = {
  V1: () => [...SMALL_HOME(0, 0), { t: 'foundation', x: 0, y: 0, z: 2 }, { t: 'foundation', x: 1, y: 0, z: 2 }, ...roofFlat([[0, 2], [1, 2]])],
  V2: () => [...SMALL_HOME(0, 0), { t: 'deck', x: 0, y: 0, z: 2 }, { t: 'deck', x: 1, y: 0, z: 2 }, ...roofFlat([[0, 2], [1, 2]])],
  V3: () => [...FIXTURES.V1(), { t: 'wall_half', a: 'x', x: 0, y: 0, z: 3 }, { t: 'wall_half', a: 'x', x: 1, y: 0, z: 3 }, { t: 'wall_half', a: 'z', x: 0, y: 0, z: 2 }, { t: 'wall_half', a: 'z', x: 2, y: 0, z: 2 }],
  V4: () => {
    const P = SMALL_HOME(0, 0, { noRoof: true });
    P.push({ t: 'foundation', x: 0, y: 0, z: 2 }, { t: 'foundation', x: 1, y: 0, z: 2 }, { t: 'post', x: 0, y: 0, z: 3 }, { t: 'post', x: 2, y: 0, z: 3 });
    for (let x = 0; x <= 1; x++) for (let z = 0; z <= 2; z++) P.push({ t: 'floor', x, y: 1, z });
    for (let x = 0; x <= 1; x++) P.push({ t: 'wall', a: 'x', x, y: 1, z: 0 }, { t: 'wall', a: 'x', x, y: 1, z: 3 });
    for (let z = 0; z <= 2; z++) P.push({ t: 'wall', a: 'z', x: 0, y: 1, z }, { t: 'wall', a: 'z', x: 2, y: 1, z });
    P.push(...roofFlat([[0, 0], [1, 0], [0, 1], [1, 1], [0, 2], [1, 2]], 2));
    return P;
  },
  V4b: () => FIXTURES.V4().filter((p) => !(p.t === 'foundation' && p.z === 2)),
  V5: () => {
    const P = SMALL_HOME(0, 0, { noRoof: true });
    for (let x = 0; x <= 1; x++) for (let z = 0; z <= 1; z++) P.push({ t: 'floor', x, y: 1, z });
    for (let x = 0; x <= 1; x++) P.push({ t: 'wall', a: 'x', x, y: 1, z: 0 }, { t: x === 0 ? 'wall_door' : 'wall', a: 'x', x, y: 1, z: 2 });
    for (let z = 0; z <= 1; z++) P.push({ t: 'wall', a: 'z', x: 0, y: 1, z }, { t: 'wall', a: 'z', x: 2, y: 1, z });
    P.push({ t: 'post', x: 0, y: 0, z: 3 }, { t: 'post', x: 2, y: 0, z: 3 }, { t: 'floor', x: 0, y: 1, z: 2 }, { t: 'floor', x: 1, y: 1, z: 2 });
    P.push({ t: 'railing', a: 'x', x: 0, y: 1, z: 3 }, { t: 'railing', a: 'x', x: 1, y: 1, z: 3 }, { t: 'railing', a: 'z', x: 0, y: 1, z: 2 }, { t: 'railing', a: 'z', x: 2, y: 1, z: 2 });
    P.push(...roofFlat([[0, 0], [1, 0], [0, 1], [1, 1], [0, 2], [1, 2]], 2));
    return P;
  },
  A1: () => {
    const P = SMALL_HOME(0, 0);
    for (let x = 0; x <= 1; x++) for (let z = -2; z <= -1; z++) P.push({ t: 'foundation', x, y: 0, z }, { t: 'roof_flat', x, y: 1, z, h: 0 });
    for (let z = -2; z <= -1; z++) P.push({ t: 'wall', a: 'z', x: 0, y: 0, z }, { t: 'wall', a: 'z', x: 2, y: 0, z });
    P.push({ t: 'wall_door', a: 'x', x: 0, y: 0, z: -2 }, { t: 'wall', a: 'x', x: 1, y: 0, z: -2 }, { t: 'kitchen_range', x: 1, y: 0, z: -1 });
    return P;
  },
  S1: () => semis(true),
  S1b: () => semis(true, false),
  S2: () => semis(false),
  S3: () => {
    const P = [];
    for (let x = 0; x < 4; x++) for (let z = 0; z < 2; z++) P.push({ t: 'foundation', x, y: 0, z }, { t: 'floor', x, y: 1, z }, { t: 'roof_flat', x, y: 2, z, h: 0 });
    for (const y of [0, 1]) {
      for (let x = 0; x < 4; x++) { P.push({ t: y === 0 && (x === 1 || x === 2) ? 'wall_door' : 'wall', a: 'x', x, y, z: 2 }); P.push({ t: 'wall', a: 'x', x, y, z: 0 }); }
      for (let z = 0; z < 2; z++) { P.push({ t: 'wall', a: 'z', x: 0, y, z }); P.push({ t: 'wall', a: 'z', x: 4, y, z }); P.push({ t: 'wall', a: 'z', x: 2, y, z }); }
    }
    P.push({ t: 'bed', x: 0, y: 1, z: 0 }, { t: 'bed', x: 3, y: 1, z: 0 });
    return P;
  },
  G1: () => SMALL_HOME(0, 0, { noFound: true }),
  G2: () => SMALL_HOME(0, 0, { noFound: true, noBack: true }),
  G3: () => SMALL_HOME(0, 0, { noFound: true }).filter((p) => !(p.t === 'roof_flat' && p.x === 1 && p.z === 1)),
  G4: () => SMALL_HOME(0, 0, { gapDoor: true }),
  G5: () => SMALL_HOME(0, 0, { noFound: true, gapDoor: true }),
  G6: () => SMALL_HOME(0, 0, { noDoor: true }),
  G7: () => [{ t: 'wall', a: 'x', x: 0, y: 0, z: 0 }, { t: 'wall', a: 'x', x: 1, y: 0, z: 0 }, { t: 'wall', a: 'z', x: 0, y: 0, z: 0 }, { t: 'wall', a: 'z', x: 2, y: 0, z: 0 }, ...roofFlat([[0, 0], [1, 0]])],
  G8: () => [{ t: 'post', x: 0, y: 0, z: 0 }, { t: 'post', x: 2, y: 0, z: 0 }, { t: 'post', x: 0, y: 0, z: 2 }, { t: 'post', x: 2, y: 0, z: 2 }, ...roofFlat([[0, 0], [1, 0], [0, 1], [1, 1]]), { t: 'bench', x: 0, y: 0, z: 0 }],
  G9: () => {
    const P = SMALL_HOME(0, 0);
    for (let x = 3; x <= 5; x++) P.push({ t: 'wall', a: 'x', x, y: 0, z: 0 }, { t: x === 4 ? 'wall_door' : 'wall', a: 'x', x, y: 0, z: 3 });
    for (let z = 0; z <= 2; z++) P.push({ t: 'wall', a: 'z', x: 3, y: 0, z }, { t: 'wall', a: 'z', x: 6, y: 0, z });
    return P;
  },
  // T1.1: walls on grass, an open doorway and one roof panel missing (the inside cell, then the doorway's own cell)
  G10: () => SMALL_HOME(0, 0, { noFound: true, gapDoor: true }).filter((p) => !(p.t === 'roof_flat' && p.x === 1 && p.z === 1)),
  G11: () => SMALL_HOME(0, 0, { noFound: true, gapDoor: true }).filter((p) => !(p.t === 'roof_flat' && p.x === 0 && p.z === 1)),
  // a walled 3 × 3 grass yard with one open gap and no roof stays outdoors (an uncovered room, no building)
  G12: () => { const r = ring(3, 0, 5, 2, 'wall'); return r.filter((p) => !(p.a === 'x' && p.z === 3 && p.x === 4)); },
  N1: () => [...SMALL_HOME(0, 0), ...ring(-2, -2, 3, 4, 'fence_picket')],
  N2: () => [...SMALL_HOME(0, 0), ...ring(-10, -10, 9, 9, 'hedge')],
  N3: () => { const r = ring(-2, -2, 3, 4, 'wall_half'); r[r.findIndex((p) => p.a === 'x' && p.z === 5 && p.x === 0)].t = 'wall_arch'; return [...SMALL_HOME(0, 0), ...r]; },
  N4: () => [...SMALL_HOME(0, 0), ...ring(-2, -2, 3, 4, 'fence_picket'), ...[2, 3, 4, 5].map((z) => ({ t: 'path', x: 0, y: 0, z }))],
  N5: () => [...SMALL_HOME(0, 0), ...ring(-2, -2, 3, 4, 'fence_picket').filter((p) => !(p.a === 'x' && p.z === 5)), ...[-1, 0, 1].map((x) => ({ t: 'fence_picket', a: 'x', x, y: 0, z: 3 }))],
};
function build(pieces) {
  world.clear({ record: false });
  const bad = [];
  for (const p of pieces) if (!world.add(p, { record: false })) bad.push(`${p.t}@${p.a || ''}${p.x},${p.y},${p.z}`);
  return bad;
}
const stamp = (id) => { world.clear({ record: false }); blueprints.stamp(id, { animate: false, record: false }); };
const walls0 = () => [...world.entries.values()].filter((e) => e.p.t === 'wall' && e.p.y === 0);
const VARIANTS = {
  'cottage -1 back wall': () => { stamp('cottage'); world.remove(walls0().find((e) => e.p.a === 'x' && e.p.z === -2).key, { record: false }); },
  'cottage -2 back walls': () => { stamp('cottage'); const ws = walls0().filter((e) => e.p.a === 'x' && e.p.z === -2); world.remove(ws[0].key, { record: false }); world.remove(ws[1].key, { record: false }); },
  'cottage door->wall': () => { stamp('cottage'); const d = [...world.entries.values()].find((e) => e.p.t === 'wall_door'); world.add({ ...d.p, t: 'wall' }, { record: false }); },
  'cottage -1 roof panel': () => { stamp('cottage'); const pn = [...world.entries.values()].find((e) => e.def.layer === 'R' && e.p.x === 0 && e.p.z === 0); world.remove(pn.key, { record: false }); },
  'cottage -1 panel -1 wall': () => { stamp('cottage'); const pn = [...world.entries.values()].find((e) => e.def.layer === 'R' && e.p.x === 0 && e.p.z === 0); world.remove(pn.key, { record: false }); world.remove(walls0().find((e) => e.p.a === 'x' && e.p.z === -2).key, { record: false }); },
  'cottage front half of roof': () => { stamp('cottage'); for (const e of [...world.entries.values()].filter((q) => q.def.layer === 'R' && q.p.z >= 0)) world.remove(e.key, { record: false }); },
  'cottage + patio': () => { stamp('cottage'); for (let x = -1; x <= 1; x++) for (let z = 2; z <= 3; z++) { for (const k of [`I|${x}|0|${z}`, `F|${x}|0|${z}`]) if (world.get(k)) world.remove(k, { record: false }); world.add({ t: 'foundation', x, y: 0, z }, { record: false }); } },
  'cottage no bed': () => { stamp('cottage'); world.remove([...world.entries.values()].find((e) => e.p.t === 'bed').key, { record: false }); },
  'farmhouse roof removed': () => { stamp('farmhouse'); for (const e of [...world.entries.values()].filter((q) => q.def.layer === 'R')) world.remove(e.key, { record: false }); },
};

// ================================================================================================ B1 home rule
{
  const T = (cells, levels, rooms, beds, doors, gaps, unroofed, home, reasons, steps, extra = {}) => ({ cells, levels, rooms, beds, doors, gaps, unroofed, home, reasons, steps, ...extra });
  const EXP = {
    starter: { b: [T(4, [0], 1, 0, 1, 0, 0, false, ['bed'], [[-1, 1]])], ver: [] },
    aframe: { b: [T(24, [0, 1], 2, 1, 1, 0, 0, true, [], [[-1, 2]])], ver: [] },
    logcabin: { b: [T(16, [0], 1, 1, 1, 0, 0, true, [], [[-1, 1]])], ver: [4] },
    cottage: { b: [T(20, [0], 1, 1, 1, 0, 0, true, [], [[0, 2]])], ver: [] },
    farmhouse: { b: [T(40, [0, 1], 2, 1, 2, 0, 0, true, [], [[0, -4], [0, 1]])], ver: [5] },
    'cottage -1 back wall': { b: [T(20, [0], 1, 1, 1, 1, 0, true, [], [[0, 2]])] },
    'cottage -2 back walls': { b: [T(20, [0], 1, 1, 1, 2, 0, false, ['gaps'], [[0, 2]])] },
    'cottage door->wall': { b: [T(20, [0], 1, 1, 0, 0, 0, false, ['door'], [])] },
    'cottage -1 roof panel': { b: [T(20, [0], 1, 1, 1, 0, 1, true, [], [[0, 2]])] },
    'cottage -1 panel -1 wall': { b: [T(20, [0], 1, 1, 1, 1, 1, false, ['gaps', 'roof'], [[0, 2]])] },
    'cottage front half of roof': { b: [T(20, [0], 1, 1, 1, 0, 10, false, ['roof'], [[0, 2]])] },
    'cottage + patio': { b: [T(20, [0], 1, 1, 1, 0, 0, true, [], [[0, 2]])] },
    'cottage no bed': { b: [T(20, [0], 1, 0, 1, 0, 0, false, ['bed'], [[0, 2]])] },
    'farmhouse roof removed': { b: [T(20, [0], 1, 0, 2, 0, 0, false, ['roof'], [[0, -4], [0, 1]])] },
    V1: { b: [T(4, [0], 1, 1, 1, 0, 0, true, [], [[0, 2]])], ver: [2] },
    V2: { b: [T(4, [0], 1, 1, 1, 0, 0, true, [], [[0, 2]])], ver: [2] },
    V3: { b: [T(4, [0], 1, 1, 1, 0, 0, true, [], [[0, 2]])], ver: [2] },
    V4: { b: [T(10, [0, 1], 2, 1, 1, 0, 0, true, [], [[0, 2]])], ver: [2] },
    V4b: { b: [T(10, [0, 1], 2, 1, 1, 0, 0, true, [], [[0, 2]])], ver: [2] },
    V5: { b: [T(8, [0, 1], 2, 1, 1, 0, 0, true, [], [[0, 2]])], ver: [2, 2] },
    A1: { b: [T(8, [0], 2, 1, 2, 0, 0, true, [], [[0, -3], [0, 2]])] },
    S1: { b: [T(4, [0], 1, 1, 1, 0, 0, true, [], [[1, 2]]), T(4, [0], 1, 1, 1, 0, 0, true, [], [[2, 2]])] },
    S1b: { b: [T(8, [0], 2, 2, 1, 0, 0, true, [], [[1, 2]])] },
    S2: { b: [T(8, [0], 2, 1, 2, 0, 0, true, [], [[1, 2], [2, 2]])] },
    S3: { b: [T(8, [0, 1], 2, 1, 1, 0, 0, true, [], [[1, 2]]), T(8, [0, 1], 2, 1, 1, 0, 0, true, [], [[2, 2]])] },
    G1: { b: [T(4, [0], 1, 1, 1, 0, 0, true, [], [[0, 2]], { ground: 4 })] },
    G2: { b: [T(4, [0], 1, 1, 1, 1, 0, true, [], [[0, 2]], { ground: 4 })] },
    G3: { b: [T(4, [0], 1, 1, 1, 0, 1, true, [], [[0, 2]], { ground: 4 })] },
    G4: { b: [T(4, [0], 1, 1, 1, 0, 0, true, [], [[0, 2]], { doorway: true })] },
    G5: { b: [T(4, [0], 1, 1, 1, 0, 0, true, [], [[0, 2]], { ground: 4, doorway: true })] },
    G6: { b: [T(4, [0], 1, 1, 0, 0, 0, false, ['door'], [])] },
    G7: { b: [], ver: [2] },
    G8: { b: [] },
    G9: { b: [T(4, [0], 1, 1, 1, 0, 0, true, [], [[0, 2]])] },
    G10: { b: [T(4, [0], 1, 1, 1, 0, 1, true, [], [[0, 2]], { ground: 4, doorway: true })] },
    G11: { b: [T(4, [0], 1, 1, 1, 0, 1, true, [], [[0, 2]], { ground: 4, doorway: true })] },
    G12: { b: [], ver: [] },
  };
  const rows = {};
  for (const [label, exp] of Object.entries(EXP)) {
    if (['starter', 'aframe', 'logcabin', 'cottage', 'farmhouse'].includes(label)) stamp(label);
    else if (VARIANTS[label]) VARIANTS[label]();
    else { const bad = build(FIXTURES[label]()); if (bad.length) fail('B1', `${label}: adds failed ${bad.join(' ')}`); }
    const m = model();
    const got = m.buildings.map((b) => ({
      cells: b.cells.size, levels: b.levels, rooms: b.rooms, beds: b.beds.length, doors: b.doors.length, gaps: b.gaps.length, unroofed: b.unroofed.length,
      home: b.home, reasons: b.reasons, steps: b.doors.map((d) => d.step).sort((p, q) => p[0] - q[0] || p[1] - q[1]), ground: b.ground, doorway: b.doors.some((d) => d.doorway),
    })).sort((p, q) => p.steps.length && q.steps.length ? p.steps[0][0] - q.steps[0][0] : 0);
    rows[label] = got.map((g) => `${g.cells}c${g.ground ? `(${g.ground}g)` : ''} L${g.levels.join('+')} r${g.rooms} b${g.beds} d${g.doors}${g.doorway ? 'w' : ''} gap${g.gaps} un${g.unroofed} ${g.home ? 'HOME' : 'no:' + g.reasons.join('+')} @${g.steps.map((s) => s.join(',')).join(' ')}`).join(' | ') + (m.verandas.length ? ` ver:${m.verandas.map((v) => `y${v.y}:${v.cells.length}`).join(',')}` : '');
    if (got.length !== exp.b.length) { fail('B1', `${label}: ${got.length} buildings, want ${exp.b.length}`); continue; }
    exp.b.forEach((e, k) => {
      const g = got[k];
      for (const f of ['cells', 'levels', 'rooms', 'beds', 'doors', 'gaps', 'unroofed', 'home', 'reasons']) if (!eq(g[f], e[f])) fail('B1', `${label}[${k}].${f} = ${JSON.stringify(g[f])}, want ${JSON.stringify(e[f])}`);
      const es = e.steps.slice().sort((p, q) => p[0] - q[0] || p[1] - q[1]);
      if (!eq(g.steps, es)) fail('B1', `${label}[${k}] doorsteps ${JSON.stringify(g.steps)}, want ${JSON.stringify(es)}`);
      if (e.ground !== undefined && g.ground !== e.ground) fail('B1', `${label}[${k}] ground ${g.ground}, want ${e.ground}`);
      if (e.doorway && !g.doorway) fail('B1', `${label}[${k}] expected a doorway`);
    });
    if (exp.ver) { const vs = m.verandas.map((v) => v.cells.length).sort(); if (!eq(vs, exp.ver.slice().sort())) fail('B1', `${label} verandas ${JSON.stringify(vs)}, want ${JSON.stringify(exp.ver)}`); }
  }
  report.B1 = rows;
}

// ================================================================================================ B2 recipes
{
  const want = { cottage: { gardener: 2, beekeeper: 1, baker: 1 }, farmhouse: { gardener: 1.33, farmer: 1.5 }, logcabin: { woodcutter: 1 }, aframe: { woodcutter: 1 } };
  const job = { cottage: 'gardener', farmhouse: 'farmer', logcabin: 'woodcutter', aframe: 'woodcutter' };
  const out = {};
  for (const id of Object.keys(want)) {
    stamp(id);
    const m = model();
    const h = m.homes[0];
    const ev = Rc.evalRecipes(m.index, h, { homes: m.homes.length, inside: Rc.insideSet(m.buildings) });
    const fits = Object.fromEntries(Object.entries(ev.fit).filter(([, f]) => f > 0).map(([j, f]) => [j, Math.round(f * 100) / 100]));
    out[id] = fits;
    if (!eq(fits, want[id])) fail('B2', `${id} fit ${JSON.stringify(fits)}, want ${JSON.stringify(want[id])}`);
    const c = Rc.chooseJob(ev, {}, true);
    if (c.job !== job[id]) fail('B2', `${id} chooseJob ${c.job}, want ${job[id]}`);
  }
  build(FIXTURES.S1());
  const m = model();
  const ev = Rc.evalRecipes(m.index, m.homes[0], { homes: m.homes.length, inside: Rc.insideSet(m.buildings) });
  const c = Rc.chooseJob(ev, {}, true);
  out.semis = c.job;
  if (c.job !== 'gardener' || ev.met.length) fail('B2', `semis first friend ${c.job} (met ${ev.met}), want gardener`);
  report.B2 = out;
}

// ================================================================================================ B3 nav
{
  const out = {};
  const check = (label, { hops, lenRange = null, bench = false }) => {
    const m = model();
    const nav = m.nav;
    const steps = m.buildings.flatMap((b) => b.doors.map((d) => d.step));
    for (const [x, z] of steps) if (!nav.inMain(x, z)) fail('B3', `${label}: doorstep ${x},${z} not in mainRegion`);
    let outside = 0;
    for (let i = 0; i < 484; i++) if (!nav.blocked[i] && nav.region[i] !== nav.mainRegion) outside++;
    if (outside) fail('B3', `${label}: ${outside} free cells outside mainRegion`);
    const h = m.homes[0];
    const d1 = h.doors.find((d) => d.main).step;
    const p = nav.path(nav.laneCell, d1);
    if (!p.ok || p.slips.length) fail('B3', `${label}: path ok=${p.ok} slips=${p.slips.length}`);
    if (p.hops.length !== hops) fail('B3', `${label}: ${p.hops.length} hops, want ${hops}`);
    if (lenRange && (p.len < lenRange[0] || p.len > lenRange[1])) fail('B3', `${label}: path ${p.len.toFixed(1)} m outside ${lenRange}`);
    let benchOk = null;
    if (bench) {
      const v = { id: 'v1', job: 'gardener', trait: 'early', homeId: h.id, status: 'resident', cool: {}, recent: [] };
      const ctx = Wm.wishCtx(m, { villagers: [v] }, v);
      const plan = Wm.findSpots(Wm.TEMPLATE.w_door_bench, ctx, null);
      benchOk = plan.complete;
      if (!plan.complete) fail('B3', `${label}: w_door_bench plan incomplete`);
      else {
        const r = plan.recs[0].rec;
        const reach = nav.reachWithout(H.ci(r.x, r.z));
        for (const [x, z] of steps) if (reach[H.ci(x, z)] !== 1) fail('B3', `${label}: bench at ${r.x},${r.z} cuts doorstep ${x},${z} off`);
      }
    }
    out[label] = `len ${p.len.toFixed(1)} m, hops ${p.hops.length}, slips ${p.slips.length}${bench ? `, bench plan ${benchOk}` : ''}`;
  };
  for (const id of ['aframe', 'logcabin', 'cottage', 'farmhouse']) { stamp(id); check(id, { hops: 0, lenRange: [18, 45] }); }
  build(FIXTURES.N1()); check('N1', { hops: 1, bench: true });
  build(FIXTURES.N2()); check('N2', { hops: 1, bench: true });
  build(FIXTURES.N3()); check('N3', { hops: 0, bench: true });
  build(FIXTURES.N4()); check('N4', { hops: 0, bench: true });
  build(FIXTURES.N5()); check('N5', { hops: 0, bench: true });
  build(FIXTURES.V3()); check('V3', { hops: 1 });
  VARIANTS['cottage -1 roof panel']();
  { const m = model(); let pocket = 0; for (let i = 0; i < 484; i++) if (!m.nav.blocked[i] && m.nav.region[i] !== m.nav.mainRegion) pocket++; if (pocket) fail('B3', `cottage -1 roof panel: ${pocket} free pocket cells`); out['cottage -1 roof panel pocket cells'] = pocket; }
  report.B3 = out;
}

// ================================================================================================ B4 every template
{
  const FIX = {
    cottage: () => stamp('cottage'),
    pond: () => { stamp('cottage'); world.add({ t: 'pond', x: 5, y: 0, z: 4 }, { record: false }); },
    two: () => { stamp('cottage'); for (const p of SMALL_HOME(6, -8)) world.add(p, { record: false }); },
    small: () => build(SMALL_HOME(0, 0)),
    farmhouse: () => stamp('farmhouse'),
  };
  const ok = [];
  for (const tpl of Wm.TEMPLATES) {
    let tested = false;
    const notes = [];
    for (const fx of ['cottage', 'pond', 'two', 'small', 'farmhouse']) {
      FIX[fx]();
      let m = model();
      const h0 = fx === 'small' ? m.homes[0] : (m.homes.find((h) => /thatched|tin-roofed/.test(h.name)) || m.homes[0]);
      const otherIds = m.homes.filter((h) => h !== h0).map((h) => h.id);
      const mk = () => {
        const v = { id: 'v1', name: 'Mabel', job: tpl.job || 'gardener', trait: tpl.trait || 'early', homeId: h0.id, status: 'resident', cool: {}, recent: [] };
        const others = otherIds.map((id, k) => ({ id: 'v' + (k + 2), name: 'Otis', job: 'farmer', trait: 'shy', homeId: id, status: 'resident', cool: {}, recent: [] }));
        const vs = [v, ...others];
        const town = { villagers: vs, population: vs.length, campers: 0, freeBeds: 0, travellerDue: false, residentsOf: (hid) => vs.filter((u) => u.homeId === hid).length };
        return { v, ctx: Wm.wishCtx(m, town, v) };
      };
      let { v, ctx } = mk();
      let offered = false;
      try { offered = tpl.offer(ctx, v) && !tpl.done(ctx, v, null); } catch (e) { fail('B4', `${tpl.id}@${fx}: offer threw ${e.message}`); break; }
      if (!offered) { notes.push(`${fx}: not offered`); continue; }
      if (Wm.isDone(tpl, ctx, null)) { fail('B4', `${tpl.id}@${fx}: done before`); break; }
      const wish = Wm.createWish(tpl, ctx, 0);
      const plan = Wm.findSpots(tpl, ctx, wish);
      if (!plan.complete) { notes.push(`${fx}: incomplete plan (${plan.recs.length} recs)`); continue; }
      tested = true;
      const sum = (a) => a.reduce((x, y) => x + y, 0);
      let have = sum(plan.parts.map((p) => p.have));
      let step = 0, bad = null;
      for (const r of plan.recs) {
        const rec = { ...r.rec }; if (rec.h === null) rec.h = 0;
        if (!world.add(rec, { record: false })) { bad = `world.add failed for ${JSON.stringify(r.rec)}`; break; }
        m = model(); ({ v, ctx } = mk());
        step++;
        const done = Wm.isDone(tpl, ctx, wish);
        const h2 = sum(tpl.have(ctx, v, wish));
        if (!done && h2 !== have + 1) { bad = `checklist ${have} → ${h2} after placing ${rec.t} (${step}/${plan.recs.length})`; break; }
        have = h2;
        if (done && step < plan.recs.length) { bad = `done after ${step} of ${plan.recs.length} recs`; break; }
      }
      if (bad) { fail('B4', `${tpl.id}@${fx}: ${bad}`); break; }
      if (!Wm.isDone(tpl, ctx, wish)) { fail('B4', `${tpl.id}@${fx}: not done after its ${plan.recs.length} recs`); break; }
      ok.push(`${tpl.id}@${fx}(${plan.recs.length})`);
      break;
    }
    if (!tested && !fails.some((f) => f.startsWith(`B4: ${tpl.id}@`))) fail('B4', `${tpl.id}: no fixture offers it with a complete plan (${notes.join('; ')})`);
  }
  report.B4 = `${ok.length}/${Wm.TEMPLATES.length} templates: ${ok.join(' ')}`;
}

// ---------------------------------------------------------------------------------------------- sim helpers
function runSim(sim, seconds, ctx = CTX, onTick = null) {
  const n = Math.round(seconds / Sm.TICK);
  const evs = [];
  for (let k = 0; k < n; k++) {
    sim.tick(Sm.TICK, ctx);
    if (onTick) onTick(sim, k);
    evs.push(...sim.drainEvents());
    sim.drainCues();
  }
  return evs;
}
function newSim(seed = 42, save = null) {
  const sim = Sm.createSim({ save: save || St.freshTown(seed) });
  sim.setWorld(model(sim.tents()), { restore: true });
  sim.drainEvents();
  return sim;
}
const recompute = (sim) => sim.setWorld(model(sim.tents()));
const roofKeys = () => [...world.entries.values()].filter((e) => e.def.layer === 'R').map((e) => e.p);

// ================================================================================================ B5 determinism
{
  const run = (flowing) => {
    stamp('cottage');
    const sim = newSim(42);
    let sky = 0.42;
    const ctxAt = () => ({ sky, flowing, guided: false, night: 0 });
    const n = Math.round(3600 / Sm.TICK);
    let removed = null;
    for (let k = 0; k < n; k++) {
      const t = k * Sm.TICK;
      if (t === 100) { removed = roofKeys().filter((p) => p.z >= 0); world.beginBatch(); for (const p of removed) world.remove(world.keyOf(p)); world.endBatch(); recompute(sim); }
      if (t === 160) { world.undo(); recompute(sim); }
      if (t === 300) { world.add({ t: 'bed', x: -2, y: 0, z: 0 }, { record: false }); recompute(sim); }
      if (flowing) sky = (sky + Sm.TICK / 600) % 1;
      sim.tick(Sm.TICK, ctxAt());
      sim.drainEvents(); sim.drainCues();
    }
    return JSON.stringify(sim.serialize());
  };
  const a = run(false), b = run(false);
  if (a !== b) fail('B5', 'pinned: two seed-42 sims differ after advance(3600)');
  const c = run(true), d = run(true);
  if (c !== d) fail('B5', 'flowing: two seed-42 sims differ after advance(3600)');
  const sv = JSON.parse(a);
  report.B5 = `pinned ${a === b ? 'identical' : 'DIFFERENT'} (${sv.villagers.length} villagers, ${sv.stats.granted} granted, clock ${sv.clock}); flowing ${c === d ? 'identical' : 'DIFFERENT'}`;
}

// ================================================================================================ B6 never stuck
{
  const out = {};
  const setup = (pieces) => {
    if (pieces) build(pieces); else stamp('cottage');
    const sim = newSim(7);
    const id = sim.debug.spawn('gardener');
    const v = sim.villagers.find((u) => u.id === id);
    for (let k = 0; k < 20; k++) { sim.reseat(); if (sim.debug.inner(id).loc === 'out' && v.plan.kind === 'pose') break; sim.tick(Sm.TICK, CTX); }
    return { sim, v };
  };
  // walled in on 4 edges
  {
    const { sim, v } = setup();
    const [x, z] = sim.debug.inner(v.id).cell;
    for (const w of [{ a: 'x', x, z }, { a: 'x', x, z: z + 1 }, { a: 'z', x, z }, { a: 'z', x: x + 1, z }]) world.add({ t: 'wall', ...w, y: 0 }, { record: false });
    recompute(sim); sim.tick(Sm.TICK, CTX);
    const st = sim.debug.stuck();
    if (st.length) fail('B6', `walled-in: stuck ${st}`);
    if (v.plan.kind !== 'slip') fail('B6', `walled-in: plan ${v.plan.kind}, want slip`);
    out.walled = `cell ${x},${z} → ${v.plan.kind} to ${sim.debug.inner(v.id).cell}`;
  }
  // a pond dropped on a villager
  {
    const { sim, v } = setup();
    const [x, z] = sim.debug.inner(v.id).cell;
    const k = `I|${x}|0|${z}`; if (world.get(k)) world.remove(k, { record: false });
    const added = world.add({ t: 'pond', x, y: 0, z }, { record: false });
    recompute(sim); sim.tick(Sm.TICK, CTX);
    const c2 = sim.debug.inner(v.id).cell;
    if (!added) fail('B6', `pond: could not place a pond at ${x},${z}`);
    if (sim.debug.stuck().length) fail('B6', `pond: stuck ${sim.debug.stuck()}`);
    if (v.plan.kind !== 'hop') fail('B6', `pond: plan ${v.plan.kind}, want hop`);
    if (Math.max(Math.abs(c2[0] - x), Math.abs(c2[1] - z)) > 2) fail('B6', `pond: hopped ${c2} from ${x},${z} (> 2 cells)`);
    out.pond = `cell ${x},${z} → ${v.plan.kind} to ${c2}`;
  }
  // a fence ring around a villager: no hop / slip
  {
    const { sim, v } = setup();
    const [x, z] = sim.debug.inner(v.id).cell;
    for (const w of [{ a: 'x', x, z }, { a: 'x', x, z: z + 1 }, { a: 'z', x, z }, { a: 'z', x: x + 1, z }]) world.add({ t: 'fence_picket', ...w, y: 0 }, { record: false });
    const pid = v.planId;
    recompute(sim); sim.tick(Sm.TICK, CTX);
    if (sim.debug.stuck().length) fail('B6', `fence ring: stuck ${sim.debug.stuck()}`);
    if (v.plan.kind === 'hop' || v.plan.kind === 'slip') fail('B6', `fence ring: got a ${v.plan.kind} plan`);
    out.fence = `cell ${x},${z}: plan ${v.plan.kind} (planId ${pid} → ${v.planId})`;
  }
  // villagers living in N1 / N2 for 10 town minutes: no hop or slip, never stuck
  for (const nm of ['N1', 'N2']) {
    const { sim } = setup(FIXTURES[nm]());
    let bad = 0, stuck = 0;
    sim.debug.resetStats();
    runSim(sim, 600, CTX, (s) => { for (const u of s.villagers) if (u.plan.kind === 'hop' || u.plan.kind === 'slip') bad++; stuck += s.debug.stuck().length; });
    const slips = sim.debug.stats().slips;
    if (bad) fail('B6', `${nm}: ${bad} ticks with hop / slip plans`);
    if (stuck) fail('B6', `${nm}: stuck ${stuck} ticks`);
    if (slips) fail('B6', `${nm}: ${slips} slips on ordinary routes`);
    out[nm] = `hop/slip ticks ${bad}, stuck ${stuck}, slips ${slips}`;
  }
  report.B6 = out;
}

// ================================================================================================ B7 store
{
  const valid = (s) => {
    const errs = [];
    if (!s || s.v !== 1) errs.push('v');
    if (!(Number.isInteger(s.seed) && s.seed >= 0 && s.seed <= 0xffffffff)) errs.push('seed');
    if (!(Number.isFinite(s.clock) && s.clock >= 0)) errs.push('clock');
    if (!(s.warmth >= 0 && s.warmth <= 60)) errs.push('warmth');
    if (!Array.isArray(s.villagers) || s.villagers.length > 20) errs.push('villagers');
    const ids = new Set();
    for (const v of s.villagers || []) {
      if (!/^v\d{1,4}$/.test(v.id) || ids.has(v.id)) errs.push('vid'); ids.add(v.id);
      if (typeof v.name !== 'string' || v.name.length > 24 || !v.name.trim()) errs.push('name');
      if (!D.JOBS[v.job] || !D.TRAITS[v.trait]) errs.push('job/trait');
      if (v.home && v.home.bed !== null && !/^I\|-?\d{1,2}\|[0-4]\|-?\d{1,2}$/.test(v.home.bed)) errs.push('bed');
      if (v.home && (v.home.feet.length > 3 || v.home.feet.some((f) => f.split(';').length > 400))) errs.push('feet');
      if (v.wish && !Wm.TEMPLATE[v.wish.tpl]) errs.push('tpl');
      if (v.wish?.frozen?.route && v.wish.frozen.route.length > 64) errs.push('route');
      if (v.recent.length > 5 || Object.keys(v.cool).length > 10) errs.push('recent/cool');
    }
    if (s.muted.length > 30 || s.campGrants.length > 60) errs.push('muted/campGrants');
    for (const id of Object.keys(s.unlocks)) if (!D.GIFTS[id]) errs.push('unlock');
    return errs;
  };
  const base = {
    v: 1, seed: 2862933555, clock: 5321.5, lastSeen: 1764000000000, warmth: 31.5, stats: { granted: 7, arrivals: 4, gifts: 2 }, nextId: 5,
    unlocks: { gift_flower_cart: { at: 2810, from: 'Mabel', job: 'gardener' } }, seen: ['gift_flower_cart'], tips: { hearth: 1, wish: 1, flow: 1, intro: 1 },
    muted: ['3,4;4,4;3,5;4,5'], campGrants: ['v3|I|2|0|-2'],
    villagers: [{ id: 'v1', name: 'Mabel', job: 'gardener', trait: 'early', look: [1, 2, 4, 0], voice: 0.96, seed: 912733, status: 'resident',
      home: { feet: ['-2,-2;-1,-2;0,-2', '1,1;2,1'], bed: 'I|2|0|-2' }, since: 812, arrived: 812, grants: 3,
      wish: { tpl: 'w_route_lamp', born: 5200, size: 'S', dream: false, base: null, friend: null, frozen: { route: [[0, 2], [0, 3], [0, 4]] } },
      nextWishAt: 5480, recent: ['w_door_bench'], cool: { w_door_bench: 6400 } },
    { id: 'v2', name: 'Otis', job: 'farmer', trait: 'shy', look: [0, 1, 2, 1], voice: 1.1, seed: 5, status: 'camping', home: null, since: 9, arrived: 9, grants: 0, wish: null, nextWishAt: 0, recent: [], cool: {} }],
    traveller: { job: 'baker', name: 'Hazel', trait: 'sweet', look: [0, 0, 0, 0], voice: 1, seed: 3, foot: '0,0;1,0', due: 40 },
  };
  const r = Math.random;
  const junk = () => [null, undefined, -1, 1e99, NaN, 'x', '', [], {}, true, 'I|99|9|9', 'v99999', '1,2;3', { route: 'no' }, [[1, 2]], 'gift_bogus', 'w_bogus', Infinity][Math.floor(r() * 18)];
  const mutate = (o, depth = 0) => {
    if (Array.isArray(o)) { const a = o.slice(); if (a.length && r() < 0.5) a[Math.floor(r() * a.length)] = r() < 0.5 ? junk() : mutate(a[Math.floor(r() * a.length)], depth + 1); else if (r() < 0.3) a.push(junk()); else if (r() < 0.3) a.length = 0; else for (let k = 0; k < 70; k++) a.push(a[0] ?? junk()); return a; }
    if (o && typeof o === 'object') { const c = { ...o }; const ks = Object.keys(c); const k = ks[Math.floor(r() * ks.length)]; if (r() < 0.6) c[k] = depth < 3 && typeof c[k] === 'object' ? mutate(c[k], depth + 1) : junk(); else delete c[k]; if (r() < 0.2) c['bogus' + Math.floor(r() * 9)] = junk(); return c; }
    return junk();
  };
  let threw = 0, invalid = 0, nonIdem = 0;
  for (let i = 0; i < 2000; i++) {
    let m = JSON.parse(JSON.stringify(base));
    for (let k = 0; k < 1 + Math.floor(r() * 4); k++) m = mutate(m);
    let s;
    try { s = St.sanitizeTown(m); } catch (e) { threw++; continue; }
    const errs = valid(s);
    if (errs.length) { invalid++; if (invalid < 3) fail('B7', `invalid save after mutation: ${errs.join(',')}`); }
    if (JSON.stringify(St.sanitizeTown(JSON.parse(JSON.stringify(s)))) !== JSON.stringify(s)) nonIdem++;
  }
  if (threw) fail('B7', `sanitizeTown threw ${threw} times`);
  if (nonIdem) fail('B7', `sanitize not idempotent ${nonIdem} times`);
  for (const bad of ['not json', '[]', 'null', '{"v":', 42]) { const s = St.sanitizeTown(bad); if (valid(s).length) fail('B7', `bad input ${bad} → invalid save`); }
  // serialize → sanitize → createSim → serialize
  stamp('cottage');
  const sim = newSim(3);
  sim.debug.spawn('gardener'); sim.debug.spawn('baker');
  runSim(sim, 400);
  const s1 = sim.serialize();
  const sim2 = Sm.createSim({ save: St.sanitizeTown(JSON.parse(JSON.stringify(s1))) });
  const s2 = sim2.serialize();
  if (JSON.stringify(s1) !== JSON.stringify(s2)) fail('B7', 'serialize → sanitize → createSim → serialize differs');
  // a v2 save loads read-only (written to this page's own localStorage, then restored)
  const prev = localStorage.getItem(St.KEY);
  localStorage.setItem(St.KEY, JSON.stringify({ ...base, v: 2, future: { x: 1 } }));
  const lt = St.loadTown();
  if (!lt.readOnly || lt.fresh) fail('B7', `v2 save: readOnly ${lt.readOnly} fresh ${lt.fresh}`);
  if (lt.save.villagers.length !== 2) fail('B7', `v2 save kept ${lt.save.villagers.length} villagers`);
  localStorage.setItem(St.KEY, 'garbage{"unlocks":{"gift_gnome":{"at":1}},"seen":["gift_gnome"]');
  const lg = St.loadTown();
  if (!lg.fresh || !lg.save.unlocks.gift_gnome || !lg.save.seen.includes('gift_gnome')) fail('B7', 'non-JSON save did not salvage unlocks / seen');
  if (prev === null) localStorage.removeItem(St.KEY); else localStorage.setItem(St.KEY, prev);
  const size = JSON.stringify(s1).length;
  report.B7 = `2000 mutations: threw ${threw}, invalid ${invalid}, non-idempotent ${nonIdem}; round trip ${JSON.stringify(s1) === JSON.stringify(s2) ? 'identical' : 'DIFFERENT'}; v2 readOnly ${lt.readOnly}; save ${size} B`;
}

// ================================================================================================ B8 re-binding & settling
{
  const out = {};
  const statusEvents = (evs) => evs.filter((e) => e.type === 'status');
  // (a) clear → camp after 3 s of quiet → undo → same bed
  {
    stamp('cottage');
    const sim = newSim(11);
    const id = sim.debug.spawn('gardener');
    const v = sim.villagers.find((u) => u.id === id);
    const bed = v.bed;
    runSim(sim, 10);
    world.clear(); recompute(sim);
    let evs = runSim(sim, 2.5);
    if (statusEvents(evs).length || v.status !== 'resident') fail('B8a', `changed before 3 s: ${v.status}, ${statusEvents(evs).length} events`);
    evs = runSim(sim, 1);
    const se = statusEvents(evs);
    if (se.length !== 1 || v.status !== 'camping') fail('B8a', `after 3 s: status ${v.status}, ${se.length} status events`);
    world.undo(); recompute(sim);
    evs = runSim(sim, 4);
    if (v.status !== 'resident' || v.bed !== bed) fail('B8a', `after undo: ${v.status} bed ${v.bed}, want ${bed}`);
    out.a = `camping after clear (1 event), back in ${v.bed} after undo`;
  }
  // (b) roof off and back within 2 s → 0 events
  {
    stamp('cottage');
    const sim = newSim(12);
    sim.debug.spawn('gardener');
    runSim(sim, 10);
    world.beginBatch(); for (const p of roofKeys()) world.remove(world.keyOf(p)); world.endBatch(); recompute(sim);
    let evs = runSim(sim, 1.5);
    world.undo(); recompute(sim);
    evs = evs.concat(runSim(sim, 6));
    if (statusEvents(evs).length) fail('B8b', `${statusEvents(evs).length} status events`);
    out.b = `${statusEvents(evs).length} status events`;
  }
  // (c) roof off 20 s → waiting → back → resident, no fixed, warmth not raised; (d) 70 s → fixed + COZY_FIX
  for (const [label, secs] of [['c', 20], ['d', 70]]) {
    stamp('cottage');
    const sim = newSim(13);
    const id = sim.debug.spawn('gardener');
    const v = sim.villagers.find((u) => u.id === id);
    runSim(sim, 10);
    world.beginBatch(); for (const p of roofKeys()) world.remove(world.keyOf(p)); world.endBatch(); recompute(sim);
    runSim(sim, secs);
    if (v.status !== 'waiting') fail('B8' + label, `after ${secs} s: ${v.status}, want waiting`);
    const w0 = sim.cozy.warmth;
    world.undo(); recompute(sim);
    const evs = runSim(sim, 4);
    const fixed = evs.filter((e) => e.type === 'fixed');
    if (v.status !== 'resident') fail('B8' + label, `after the fix: ${v.status}`);
    if (label === 'c') {
      if (fixed.length) fail('B8c', 'a quick remodel gave a fixed event');
      if (sim.cozy.warmth > w0) fail('B8c', `warmth rose ${w0} → ${sim.cozy.warmth}`);
      out.c = `waiting → resident, fixed events ${fixed.length}, warmth ${w0.toFixed(2)} → ${sim.cozy.warmth.toFixed(2)}`;
    } else {
      const want = Math.max(1, Math.round(D.TUNE.COZY_FIX * (1 - w0 / 60)));
      if (fixed.length !== 1) fail('B8d', `${fixed.length} fixed events`);
      else if (fixed[0].gain !== want) fail('B8d', `fixed gain ${fixed[0].gain}, want ${want}`);
      out.d = `fixed events ${fixed.length}, gain ${fixed[0]?.gain}, warmth ${w0.toFixed(2)} → ${sim.cozy.warmth.toFixed(2)}`;
    }
  }
  // (e) an open wish is dropped on commit; the next wish 60 s after the commit
  {
    stamp('cottage');
    const sim = newSim(14);
    const id = sim.debug.spawn('gardener');
    const v = sim.villagers.find((u) => u.id === id);
    runSim(sim, 5);
    const r = sim.debug.wish(id, 'w_door_lamp');
    if (!r.ok) fail('B8e', `could not set a wish: ${r.reason}`);
    world.beginBatch(); for (const p of roofKeys()) world.remove(world.keyOf(p)); world.endBatch(); recompute(sim);
    let commitAt = null;
    const evs = runSim(sim, 5, CTX, (s) => { if (commitAt === null && v.status === 'waiting') commitAt = s.time; });
    if (v.wish) fail('B8e', 'wish still open after the commit');
    if (evs.some((e) => e.type === 'expired')) fail('B8e', 'an expired event fired');
    if (v.cool.w_door_lamp) fail('B8e', 'the template went on cooldown');
    if (commitAt === null || Math.abs(v.nextWishAt - (commitAt + 60)) > 0.01) fail('B8e', `nextWishAt ${v.nextWishAt}, commit at ${commitAt}`);
    out.e = `dropped silently; next wish at commit + ${(v.nextWishAt - commitAt).toFixed(2)} s`;
  }
  // (f) load the farmhouse → move into it; load the cottage again → back in the cottage bed
  {
    stamp('farmhouse'); const farm = world.serialize();
    stamp('cottage'); const cot = world.serialize();
    const sim = newSim(15);
    const id = sim.debug.spawn('gardener');
    const v = sim.villagers.find((u) => u.id === id);
    const bed0 = v.bed;
    runSim(sim, 5);
    world.load(farm, { record: true }); recompute(sim);
    let evs = runSim(sim, 4);
    const inFarm = v.status === 'resident' && v.bed === 'I|0|1|-3';
    if (!inFarm) fail('B8f', `after loading the farmhouse: ${v.status} ${v.bed}`);
    world.load(cot, { record: true }); recompute(sim);
    evs = evs.concat(runSim(sim, 4));
    if (v.status !== 'resident' || v.bed !== bed0) fail('B8f', `after loading the cottage again: ${v.status} ${v.bed}, want ${bed0}`);
    out.f = `farmhouse bed ${inFarm}, back to ${v.bed}; feet ${v.feet.length}; status events ${statusEvents(evs).length}`;
  }
  // (g) two villagers, one bed → the later one camps; a new bed → one camp thank-you, never twice for the same bed
  {
    stamp('cottage');
    const sim = newSim(16);
    const a = sim.debug.spawn('gardener'), b = sim.debug.spawn('baker');
    const vb = sim.villagers.find((u) => u.id === b);
    if (vb.status !== 'camping') fail('B8g', `second villager is ${vb.status}, want camping`);
    runSim(sim, 70);
    world.add({ t: 'bed', x: -2, y: 0, z: 0 }, { record: false }); recompute(sim);
    let evs = runSim(sim, 4);
    let thanks = evs.filter((e) => e.type === 'granted' && e.camp);
    if (vb.status !== 'resident' || thanks.length !== 1) fail('B8g', `after the bed: ${vb.status}, ${thanks.length} camp thank-yous`);
    const want = 'I|-2|0|0';
    for (let k = 0; k < 2; k++) {
      world.remove(want, { record: false }); recompute(sim); evs = runSim(sim, 70);
      world.add({ t: 'bed', x: -2, y: 0, z: 0 }, { record: false }); recompute(sim); evs = evs.concat(runSim(sim, 4));
      thanks = evs.filter((e) => e.type === 'granted' && e.camp);
      if (thanks.length) fail('B8g', `bed moved back: ${thanks.length} more camp thank-yous`);
    }
    out.g = `${a} resident, ${b} camped then moved in (+1 thank-you), no second one`;
  }
  // (h) a traveller whose target vanishes turns back, never on the roster, never camps
  {
    build(SMALL_HOME(0, 0));
    const sim = newSim(17);
    let tv = null, camped = false, rostered = false;
    runSim(sim, 8, CTX, (s) => { if (s.traveller) tv = s.traveller; });
    if (!tv) fail('B8h', 'no traveller came');
    world.remove('I|0|0|0', { record: false }); recompute(sim);
    runSim(sim, 120, CTX, (s) => { if (s.villagers.length) rostered = true; if (s.traveller && s.traveller.status === 'camping') camped = true; });
    if (rostered) fail('B8h', 'the traveller joined the roster');
    if (camped) fail('B8h', 'the traveller camped');
    if (sim.traveller) fail('B8h', `still on stage (${sim.traveller.leaving ? 'leaving' : 'not leaving'})`);
    out.h = `traveller ${tv?.name} turned back; roster ${sim.villagers.length}; saved for later: ${!!sim.serialize().traveller}`;
  }
  report.B8 = out;
}

// ================================================================================================ B9 timing
{
  const out = {};
  stamp('farmhouse');
  for (let k = 0; k < 20; k++) model();
  let t0;
  // On a shared, loaded machine one batch can be twice as slow as the next (T1.15): the budget is checked against the
  // fastest of seven 20-run batches (the cost without the noise), and the median and a same-page calibration loop are
  // reported so a slow run can be told from a slow machine. The owner's phone profiling keeps the absolute numbers.
  const calib = () => { const c0 = now(); let a = 0; for (let k = 0; k < 2e6; k++) a = (a + k * 7) % 1000003; return [now() - c0, a]; };
  out.calibMs = +Math.min(...[0, 1, 2].map(() => calib()[0])).toFixed(2);
  const batches = [];
  for (let b = 0; b < 7; b++) { t0 = now(); for (let k = 0; k < 20; k++) model(); batches.push((now() - t0) / 20); }
  const sorted = batches.slice().sort((a, b) => a - b);
  const farm = sorted[0];
  out.farmhouse = +farm.toFixed(3);
  out.farmhouseMedian = +sorted[3].toFixed(3);
  out.farmhouseBatches = batches.map((x) => +x.toFixed(3));
  if (farm > 1.5) fail('B9', `buildWorldModel farmhouse ${farm.toFixed(2)} ms > 1.5`);
  // a 1,000-piece lot: PERF_TOWN plus paths and flowers on every free cell
  build(PERF_TOWN());
  for (let x = -10; x <= 9 && world.count < 1000; x++) for (let z = -10; z <= 9 && world.count < 1000; z++) {
    if (world.get(`F|${x}|0|${z}`)) continue;
    world.add({ t: 'path', x, y: 0, z }, { record: false });
    if (world.count < 1000 && (x + z) % 2 === 0) world.add({ t: 'flowers', x, y: 0, z }, { record: false });
    else if (world.count < 1000 && (x * 3 + z) % 5 === 0) world.add({ t: 'lamp_post', x, y: 0, z }, { record: false });
  }
  for (let z = -9; z <= 9 && world.count < 1000; z++) for (let x = -10; x <= 9 && world.count < 1000; x++) {
    if (!world.get(`W|x|${x}|0|${z}`)) world.add({ t: 'fence_picket', a: 'x', x, y: 0, z }, { record: false });
  }
  if (world.count < 1000) fail('B9', `the big lot has only ${world.count} pieces`);
  out.pieces = world.count;
  for (let k = 0; k < 10; k++) model();
  const bb = [];
  for (let b = 0; b < 5; b++) { t0 = now(); for (let k = 0; k < 10; k++) model(); bb.push((now() - t0) / 10); }
  const big = Math.min(...bb);
  out.lot1000 = +big.toFixed(3);
  if (big > 4) fail('B9', `buildWorldModel 1,000 pieces ${big.toFixed(2)} ms > 4`);
  // recompute = buildWorldModel + re-binding + wish checks, on a blueprint lot with villagers
  stamp('cottage');
  const simR = newSim(20);
  simR.debug.spawn('gardener');
  runSim(simR, 5);
  simR.debug.wish(simR.villagers[0].id, 'w_door_lamp');
  const rb = [];
  for (let b = 0; b < 5; b++) { t0 = now(); for (let k = 0; k < 20; k++) simR.setWorld(model(simR.tents())); rb.push((now() - t0) / 20); }
  out.recompute = +Math.min(...rb).toFixed(3);
  if (out.recompute > 1.5) fail('B9', `recompute ${out.recompute} ms > 1.5`);
  // tick with 20 villagers
  build(PERF_TOWN());
  const sim = newSim(21);
  for (let k = 0; k < 20; k++) sim.debug.spawn(D.JOB_ORDER[k % 8]);
  sim.reseat();
  runSim(sim, 60);
  // the same 600 s of town as one run, judged like the budgets above (R5 T5.3): five 120 s batches, each its own mean
  // tick, the budget checked against the fastest (one sample flaked on a loaded machine, on HEAD too); the median,
  // every batch and the wall clock per tick are reported, with calibMs above
  const tb = [];
  let wall = 0;
  for (let b = 0; b < 5; b++) {
    sim.debug.resetStats();
    t0 = now();
    runSim(sim, 120);
    wall += now() - t0;
    tb.push(sim.debug.stats().tickMs);
  }
  const ts = tb.slice().sort((a, b) => a - b), tick = ts[0];
  out.tick20 = +tick.toFixed(4);
  out.tick20Median = +ts[2].toFixed(4);
  out.tick20Batches = tb.map((x) => +x.toFixed(4));
  out.tick20wall = +(wall / (600 / Sm.TICK)).toFixed(4);
  if (tick > 0.1) fail('B9', `tick with 20 villagers ${tick.toFixed(3)} ms > 0.1 (fastest of ${tb.length} batches; median ${ts[2].toFixed(3)})`);
  report.B9 = out;
}

// ================================================================================================ B10 purity (static scan; the Node import is checked by the runner)
{
  const files = ['data', 'rng', 'homes', 'nav', 'recipes', 'wishes', 'model', 'sim', 'store'];
  const bad = [];
  for (const f of files) {
    const src = await (await fetch(`/js/town/${f}.js`)).text();
    const code = src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    if (/from\s+['"]three/.test(code)) bad.push(`${f}: imports three`);
    if (/\bdocument\./.test(code)) bad.push(`${f}: document`);
    if (/\bwindow\s*[.[]|typeof\s+window/.test(code)) bad.push(`${f}: window`);
    if (f !== 'store' && /localStorage/.test(code)) bad.push(`${f}: localStorage`);
    if (f !== 'store' && /Math\.random/.test(code)) bad.push(`${f}: Math.random`);
  }
  for (const b of bad) fail('B10', b);
  report.B10 = bad.length ? bad : 'no three / DOM / window; Math.random only in store.freshTown (seed); see the Node import check';
}

// ================================================================================================ B11 restore
{
  build([...SMALL_HOME(-6, 0), ...SMALL_HOME(3, 0)]);
  const sim = newSim(30);
  sim.debug.spawn('gardener'); sim.debug.spawn('farmer');
  runSim(sim, 30);
  const save = sim.serialize();
  const binds = (s) => s.villagers.map((u) => `${u.id}:${u.status}:${u.bed}:${u.homeId ? 'h' : '-'}`).join(' ');
  const b0 = binds(sim);
  const sim2 = Sm.createSim({ save: St.sanitizeTown(save) });
  sim2.setWorld(model(), { restore: true });
  const ev2 = sim2.drainEvents();
  if (ev2.length) fail('B11', `restore emitted ${ev2.map((e) => e.type)}`);
  if (binds(sim2) !== b0) fail('B11', `bindings ${binds(sim2)} vs ${b0}`);
  // erase one home: its resident camps at once, silently, with a note
  const gone = sim.villagers.find((u) => u.bed === 'I|3|0|0');
  for (const p of SMALL_HOME(3, 0)) world.remove(world.keyOf(p), { record: false });
  const sim3 = Sm.createSim({ save: St.sanitizeTown(save) });
  sim3.setWorld(model(), { restore: true });
  const ev3 = sim3.drainEvents().filter((e) => e.type !== 'camp');
  const v3 = sim3.villagers.find((u) => u.id === gone?.id);
  if (!v3 || v3.status !== 'camping') fail('B11', `erased home: ${v3?.status}, want camping`);
  if (ev3.length) fail('B11', `erased home: events ${ev3.map((e) => e.type)}`);
  if (!sim3.note || !sim3.note.includes(v3?.name || '#')) fail('B11', `note ${JSON.stringify(sim3.note)}`);
  report.B11 = `restore: 0 events, bindings ${binds(sim2) === b0 ? 'identical' : 'DIFFERENT'}; erased: ${v3?.name} ${v3?.status}, note "${sim3.note}"`;
}

// ================================================================================================ B12 Cozy
{
  const out = {};
  // the formula of §9.1 (S = 20 → 32; S, M, M → 50)
  const gain = (w, r) => Math.max(1, Math.round(r * (1 - w / 60)));
  let w = 10; w += gain(w, 4);
  const c1 = Math.round(w + Rc.charmFromKinds(20));
  for (const r of [6, 8, 8]) w += gain(w, r);
  const c2 = Math.round(w + Rc.charmFromKinds(23));
  if (c1 !== 32 || c2 !== 50) fail('B12', `formula: ${c1} / ${c2}, want 32 / 50`);
  out.formula = `S 20 → ${c1}; S, M, M (warmth ${w}) with S 23 → ${c2}`;
  // the real stamped cottage: the first traveller's move-in
  stamp('cottage');
  const sim = newSim(40);
  const evs = runSim(sim, 70);
  const mv = evs.find((e) => e.type === 'movein');
  if (!mv) fail('B12', 'no move-in on the cottage within 70 s');
  const kinds = Rc.charmOf(sim.world.index, sim.world.homes[0], Rc.insideSet(sim.world.buildings));
  const wantC = Math.round(13 + Rc.charmFromKinds(kinds));
  out.cottage = `move-in: warmth ${sim.cozy.warmth} (want 13); kinds S = ${kinds} on the real stamped cottage (the §9.1 example assumed 20), charm ${sim.cozy.charm.toFixed(2)}, Cozy ${sim.cozy.value} (${sim.cozy.tier}); with S = 20 it would be ${c1}`;
  if (sim.cozy.warmth !== 13) fail('B12', `cottage move-in warmth ${sim.cozy.warmth}, want 13`);
  if (sim.cozy.value !== wantC) fail('B12', `cottage move-in Cozy ${sim.cozy.value}, want round(13 + charm(${kinds})) = ${wantC}`);
  // three grants S, M, M on it
  const id = sim.villagers[0].id;
  const order = [['w_door_lamp', 'S'], ['J_garden', 'M'], ['w_reading_nook', 'M']];
  const got = [];
  for (const [tpl] of order) { const r = sim.debug.wish(id, tpl); if (r.ok) got.push(sim.debug.grant(id)?.gain); else got.push('x:' + r.reason); }
  out.grants = `gains ${got.join(', ')} → warmth ${sim.cozy.warmth}, Cozy ${sim.cozy.value}`;
  if (got.join(',') !== '5,6,5' || sim.cozy.warmth !== 29) fail('B12', `S, M, M gains ${got}, warmth ${sim.cozy.warmth}, want 5,6,5 → 29`);
  if (sim.cozy.value !== Math.round(29 + Rc.charmFromKinds(kinds))) fail('B12', `after S, M, M: Cozy ${sim.cozy.value}`);
  // a bare self-built home with only a bed: the floor of 17
  build(SMALL_HOME(0, 0));
  const sb = newSim(41);
  runSim(sb, 70);
  out.bare = `warmth ${sb.cozy.warmth}, charm ${sb.cozy.charm.toFixed(2)}, floor ${sb.cozy.floor}, Cozy ${sb.cozy.value}`;
  if (sb.cozy.value !== 17 || sb.cozy.floor !== 17) fail('B12', `bare home Cozy ${sb.cozy.value} floor ${sb.cozy.floor}, want 17`);
  // 600 s with warmth 60 and no grants: loses 13–16
  stamp('cottage');
  const sd = newSim(42);
  sd.debug.spawn('gardener');
  for (const u of sd.villagers) u.nextWishAt = 1e9;
  sd.debug.setCozy(100);
  const c0 = sd.cozy.value, w0 = sd.cozy.warmth;
  runSim(sd, 600);
  const loss = c0 - sd.cozy.value;
  out.drift = `warmth ${w0} → ${sd.cozy.warmth.toFixed(2)}, Cozy ${c0} → ${sd.cozy.value} (−${loss})`;
  if (w0 !== 60 || loss < 13 || loss > 16) fail('B12', `drift: −${loss} from warmth ${w0}`);
  report.B12 = out;
}

world.clear({ record: false });
// a console error makes tools/shot.mjs exit 1, so a failing run is visible to scripts as well as in the report
if (fails.length) console.error(`town-brain: ${fails.length} check(s) failed: ${fails.slice(0, 5).join(' · ')}`);
return { fails, report };
