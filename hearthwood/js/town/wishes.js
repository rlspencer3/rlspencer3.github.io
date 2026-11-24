// Hearthwood — Living Town: wish templates, eligibility, completion and the spot finder (docs/LIVING.md §7, §3.7).
// Pure: every rule only reads the WorldModel. Any placement that satisfies `done` grants a wish, not only the
// suggested one. Strings come from data.js (WISH_TEXT).

import { CELL } from '../config.js';
import { TUNE, SETS, JOBS, TRAITS, JOB_FAVOURS, WISH_TEXT, GIFTS, HINT_TEXT } from './data.js';
import { ck, ci, cx, cz, inNav, inLot, dist, edgeKey, EC, FK, NN, DIR4, packFoot, unpackFoot } from './homes.js';
import { unitsIn, insideSet } from './recipes.js';

const S = Object.fromEntries(Object.entries(SETS).map(([k, v]) => [k, new Set(v)]));
const DX = [0, 1, 0, -1], DZ = [1, 0, -1, 0];
const PATHY_FK = new Set([FK.path, FK.steps, FK.deck]);
const ids = (...a) => new Set(a.flat());
const SOLID = new Set(SETS.SOLID);

// ============================================================================================== context
/**
 * wishCtx(world, town, v) → Ctx. world: WorldModel; town: { villagers, homes?, population, campers, freeBeds,
 * travellerDue, clock, homeOf(v) }; v: VillagerModel (with homeId). Lazily caches what the rules need.
 */
export function wishCtx(world, town = {}, v = null) {
  const index = world.index, nav = world.nav;
  const homeId = v?.homeId || null;
  const home = homeId ? world.buildings.find((b) => b.id === homeId) || null : null;
  const inside = world._inside || (world._inside = insideSet(world.buildings));
  const ctx = {
    world, index, nav, town, v, home, inside,
    job: v?.job || null, trait: v?.trait || null,
    FOOT: home ? home.foot : [], DOOR: home ? home.doors.map((d) => d.step) : [],
    DOOR1: home ? (home.doors.find((d) => d.main) || home.doors[0])?.step || null : null,
    INSIDE: home ? home.cells : new Set(), lo: home ? home.lo : 0,
    _cache: new Map(),
  };
  ctx.memo = (k, f) => { if (!ctx._cache.has(k)) ctx._cache.set(k, f()); return ctx._cache.get(k); };
  ctx.outs = () => ctx.memo('outs', () => index.items.filter((p) => !inside.has(ck(p.x, p.y, p.z))));
  ctx.ins = () => ctx.memo('ins', () => index.items.filter((p) => ctx.INSIDE.has(ck(p.x, p.y, p.z))));
  ctx.out = (set) => ctx.outs().filter((p) => set.has(p.t) || unitsOfSet(set, p.t));
  ctx.inn = (set) => ctx.ins().filter((p) => set.has(p.t));
  ctx.homes = world.homes;
  return ctx;
}
// a set given as a SETS name gets gift counts (cart = 2 BLOOM, hen house FARM, festoon LAMP)
const SET_NAME = new Map(Object.entries(S).map(([k, v]) => [v, k]));
const unitsOfSet = (set, t) => { const nm = SET_NAME.get(set); return nm ? unitsIn(nm, t) : 0; };
const units = (set, p) => { const nm = SET_NAME.get(set); return nm ? unitsIn(nm, p.t) : set.has(p.t) ? 1 : 0; };
const within = (recs, cells, R, min = 0) => recs.filter((p) => { const d = dist(p.x, p.z, cells); return d <= R && d >= min; });
const sumUnits = (set, recs) => recs.reduce((a, p) => a + units(set, p), 0);
const cheb = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));

// PATHY components on level 0 (4-connected), lazily per ctx
function pathComps(ctx) {
  return ctx.memo('pathComps', () => {
    const comp = new Int16Array(NN).fill(-1), size = [];
    const fk = ctx.index.fk;
    let id = 0;
    const q = new Int16Array(NN);
    for (let s = 0; s < NN; s++) {
      if (comp[s] >= 0 || !PATHY_FK.has(fk[s])) continue;
      let n = 0; q[n++] = s; comp[s] = id;
      for (let h = 0; h < n; h++) {
        const i = q[h], x = cx(i), z = cz(i);
        for (let d = 0; d < 4; d++) {
          const nx = x + DX[d], nz = z + DZ[d];
          if (!inNav(nx, nz)) continue;
          const j = ci(nx, nz);
          if (comp[j] >= 0 || !PATHY_FK.has(fk[j])) continue;
          comp[j] = id; q[n++] = j;
        }
      }
      size.push(n); id++;
    }
    return { comp, size };
  });
}
const compsNear = (ctx, cell, R = 1) => {
  const { comp } = pathComps(ctx), out = new Set();
  if (!cell) return out;
  for (let a = -R; a <= R; a++) for (let b = -R; b <= R; b++) {
    const x = cell[0] + a, z = cell[1] + b;
    if (inNav(x, z) && comp[ci(x, z)] >= 0) out.add(comp[ci(x, z)]);
  }
  return out;
};
const joined = (ctx, a, b) => { const A = compsNear(ctx, a), B = compsNear(ctx, b); for (const c of A) if (B.has(c)) return true; return false; };
function doorChain(ctx) {            // largest PATHY component containing a DOOR cell
  const { comp, size } = pathComps(ctx);
  let best = 0;
  for (const [x, z] of ctx.DOOR) if (inNav(x, z) && comp[ci(x, z)] >= 0) best = Math.max(best, size[comp[ci(x, z)]]);
  return best;
}
// deck components (level 0) for the porch / dock rules
function deckAt(ctx, x, z) { return inNav(x, z) && ctx.index.fk[ci(x, z)] === FK.deck; }
function deckChainAtDoor(ctx) {
  let best = 0;
  for (const [x, z] of ctx.DOOR) {
    if (!deckAt(ctx, x, z)) continue;
    const seen = new Set([x * 64 + z]), q = [[x, z]];
    for (let h = 0; h < q.length; h++) for (let d = 0; d < 4; d++) {
      const a = q[h][0] + DX[d], b = q[h][1] + DZ[d];
      if (!seen.has(a * 64 + b) && deckAt(ctx, a, b)) { seen.add(a * 64 + b); q.push([a, b]); }
    }
    best = Math.max(best, q.length);
  }
  return best;
}

// friend (w_path_friend): the nearest other home with a resident whose DOOR1 is ≤ 12 cells away
function friendOf(ctx) {
  return ctx.memo('friend', () => {
    if (!ctx.DOOR1) return null;
    let best = null, bd = Infinity;
    for (const u of ctx.town.villagers || []) {
      if (!u || u.id === ctx.v?.id || !u.homeId || u.homeId === ctx.home?.id || u.status !== 'resident') continue;
      const h = ctx.world.buildings.find((b) => b.id === u.homeId);
      const d1 = h && (h.doors.find((d) => d.main) || h.doors[0]);
      if (!d1) continue;
      const d = Math.max(Math.abs(d1.step[0] - ctx.DOOR1[0]), Math.abs(d1.step[1] - ctx.DOOR1[1]));
      if (d <= 12 && (d < bd || (d === bd && u.id < best.v.id))) { bd = d; best = { v: u, home: h, door: d1.step }; }
    }
    return best;
  });
}
const friendFromWish = (ctx, wish) => {
  if (wish?.friend) {
    const u = (ctx.town.villagers || []).find((x) => x.id === wish.friend);
    const h = u && ctx.world.buildings.find((b) => b.id === u.homeId);
    const d1 = h && (h.doors.find((d) => d.main) || h.doors[0]);
    if (d1) return { v: u, home: h, door: d1.step };
  }
  return friendOf(ctx);
};

// work pieces of the job (WORK)
const workPond = (ctx) => ctx.memo('pond', () => {
  const ps = within(ctx.out(ids('pond')), ctx.FOOT, 6);
  ps.sort((a, b) => dist(a.x, a.z, ctx.FOOT) - dist(b.x, b.z, ctx.FOOT) || ci(a.x, a.z) - ci(b.x, b.z));
  return ps[0] || null;
});
const workHive = (ctx) => ctx.memo('hive', () => {
  const hs = within(ctx.out(ids('beehive')), ctx.FOOT, 4);
  let best = null, bn = -1;
  for (const h of hs) { const n = sumUnits(S.BLOOM, within(ctx.out(S.BLOOM), [[h.x, h.z]], 2)); if (n > bn) { bn = n; best = h; } }
  return best;
});

/** ROUTE (§2.1): nav cells from WORK (or the nearest hangout) to DOOR1. */
export function routeOf(ctx) {
  return ctx.memo('route', () => {
    if (!ctx.DOOR1) return [];
    const nav = ctx.nav;
    let from = null;
    const job = ctx.job && JOBS[ctx.job];
    if (job) {
      const tm = job.terms[0];
      const set = tm.set ? S[tm.set] : ids(tm.id);
      const cand = tm.where === 'inside' ? [] : within(ctx.out(set), tm.where === 'door' ? ctx.DOOR : ctx.FOOT, tm.R || 6);
      cand.sort((a, b) => ci(a.x, a.z) - ci(b.x, b.z));
      if (cand[0]) from = nav.nearestFree(cand[0].x, cand[0].z, 2, true);
    }
    if (!from) {
      let best = null, bd = Infinity;
      for (const h of ctx.world.hangouts) { const s = h.spots[0]; const d = dist(s.approach[0], s.approach[1], [ctx.DOOR1]); if (d < bd) { bd = d; best = s.approach; } }
      from = best;
    }
    if (!from) return [];
    const p = nav.path(from, ctx.DOOR1);
    return (p.cells || []).map((i) => [cx(i), cz(i)]);
  });
}

// ============================================================================================== templates
const T = (id, o) => ({ id, ...WISH_TEXT[id], where: 'foot', band: [1, 3], layer: 'I', base: null, freeze: null, ...o });
const one = (f) => (ctx, v, w) => [f(ctx, v, w) ? 1 : 0];
const capN = (n, x) => Math.max(0, Math.min(n, x));

/** have-at-anchor helper for `near` parts: items of the part within band of an anchor record / rec (same level). */
function nearCount(ctx, part, anchor, set) {
  if (!anchor) return 0;
  const [lo, hi] = part.band || [1, 1];
  const pool = part.inside ? ctx.ins() : ctx.outs();
  let n = 0;
  for (const p of pool) {
    if (!set.has(p.t) && !unitsOfSet(set, p.t)) continue;
    if (part.inside && (p.y | 0) !== (anchor.y | 0)) continue;
    const d = Math.max(Math.abs(p.x - anchor.x), Math.abs(p.z - anchor.z));
    if (d >= lo && d <= hi) n += units(set, p) || 1;
  }
  return n;
}

const SEAT_DOOR = ids('bench', 'rocking_chair', 'gift_tea_table');
const LAMPS = S.LAMP, TREES = S.TREE, BLOOMS = S.BLOOM;
const FENCES = S.FENCE;

function fenceEdgesQualifying(ctx) {
  const foot = ctx.FOOT, fset = new Set(foot.map(([x, z]) => x * 64 + z));
  let n = 0;
  for (const p of ctx.index.W.values()) {
    if ((p.y | 0) !== 0 || !FENCES.has(p.t)) continue;
    const [a, b] = p.a === 'x' ? [[p.x, p.z - 1], [p.x, p.z]] : [[p.x - 1, p.z], [p.x, p.z]];
    if (fset.has(a[0] * 64 + a[1]) !== fset.has(b[0] * 64 + b[1])) continue;     // on FOOT's boundary
    if (Math.min(dist(a[0], a[1], foot), dist(b[0], b[1], foot)) <= 3) n++;
  }
  return n;
}

function shuttersOnHome(ctx) {
  let n = 0;
  for (const e of homeEdges(ctx)) if (e.rec?.t === 'wall_window_shutters') n++;
  return n;
}
function homeEdges(ctx) {
  return ctx.memo('homeEdges', () => {
    const out = [];
    if (!ctx.home) return out;
    for (const k of ctx.home.cells) {
      const [x, y, z] = k.split('|').map(Number);
      if (y !== ctx.lo) continue;
      for (let d = 0; d < 4; d++) {
        if (ctx.home.cells.has(ck(x + DX[d], y, z + DZ[d]))) continue;
        const key = edgeKey(x, y, z, DX[d], DZ[d]);
        out.push({ key, x, y, z, d, rec: ctx.index.W.get(key) || null });
      }
    }
    out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    return out;
  });
}

const seatsWithoutLamp = (ctx) => ctx.memo('seatsNoLamp', () => {
  const seats = within(ctx.out(ids('bench', 'picnic_table', 'fire_pit', 'gift_tea_table')), ctx.FOOT, 8);
  const lamps = ctx.out(LAMPS);
  return seats.filter((s) => !lamps.some((l) => cheb(l, s) <= 1));
});
const pondsNear = (ctx, R) => within(ctx.out(ids('pond')), ctx.FOOT, R);

export const TEMPLATES = [
  // ---- general (§7.3 #1–32)
  T('w_door_flowers', { size: 'M', where: 'door', band: [1, 2],
    parts: [{ piece: 'flowers', alt: [...BLOOMS], n: 2, set: BLOOMS }],
    offer: (c) => sumUnits(BLOOMS, within(c.out(BLOOMS), c.DOOR, 2)) < 2,
    done: (c) => sumUnits(BLOOMS, within(c.out(BLOOMS), c.DOOR, 2)) >= 2,
    have: (c) => [capN(2, sumUnits(BLOOMS, within(c.out(BLOOMS), c.DOOR, 2)))] }),
  T('w_door_bench', { size: 'S', where: 'door', band: [1, 2],
    parts: [{ piece: 'bench', alt: ['rocking_chair', 'gift_tea_table'], n: 1, face: 'away', set: SEAT_DOOR }],
    offer: (c) => !within(c.out(SEAT_DOOR), c.DOOR, 2).length,
    done: (c) => within(c.out(SEAT_DOOR), c.DOOR, 2).length > 0,
    have: one((c) => within(c.out(SEAT_DOOR), c.DOOR, 2).length > 0) }),
  T('w_door_lamp', { size: 'S', where: 'door', band: [1, 2],
    parts: [{ piece: 'lamp_post', n: 1, set: LAMPS }],
    offer: (c) => !within(c.out(LAMPS), c.DOOR, 2).length,
    done: (c) => within(c.out(LAMPS), c.DOOR, 2).length > 0,
    have: one((c) => within(c.out(LAMPS), c.DOOR, 2).length > 0) }),
  T('w_route_lamp', { size: 'S', where: 'route', band: [1, 1],
    parts: [{ piece: 'lamp_post', n: 1, set: LAMPS }],
    offer: (c) => { const r = routeOf(c); return r.length >= 5 && !within(c.out(LAMPS), r, 1).length; },
    freeze: (c) => ({ route: routeOf(c).slice(0, 64) }),
    done: (c, v, w) => { const r = w?.frozen?.route || routeOf(c); return c.out(LAMPS).some((p) => dist(p.x, p.z, r) <= 1 && dist(p.x, p.z, c.DOOR) >= 3); },
    have: one((c, v, w) => { const r = w?.frozen?.route || routeOf(c); return c.out(LAMPS).some((p) => dist(p.x, p.z, r) <= 1 && dist(p.x, p.z, c.DOOR) >= 3); }) }),
  T('w_door_path', { size: 'M', where: 'door1', layer: 'F',
    parts: [{ piece: 'path', n: 3, kind: 'chain', chain: 'door' }],
    offer: (c) => c.DOOR.length > 0 && doorChain(c) < 3,
    done: (c) => doorChain(c) >= 3,
    have: (c) => [capN(3, doorChain(c))] }),
  T('w_path_friend', { size: 'L', where: 'friend', layer: 'F',
    parts: [{ piece: 'path', n: (c, v, w) => chainRoute(c, w).length, kind: 'chain', chain: 'friend' }],
    offer: (c) => { if (c.homes.length < 2) return false; const f = friendOf(c); return !!f && !joined(c, c.DOOR1, f.door); },
    freeze: null,
    done: (c, v, w) => { const f = friendFromWish(c, w); return !!f && joined(c, c.DOOR1, f.door); },
    have: (c, v, w) => [chainRoute(c, w).filter(([x, z]) => PATHY_FK.has(c.index.fk[ci(x, z)])).length] }),
  T('w_mailbox', { size: 'S', where: 'door', band: [1, 2],
    parts: [{ piece: 'mailbox', n: 1, set: ids('mailbox'), ok: (c, x, z) => mailboxMine(c, x, z) }],
    offer: (c) => !within(c.out(ids('mailbox')), c.DOOR, 2).length,
    done: (c) => c.out(ids('mailbox')).some((p) => dist(p.x, p.z, c.DOOR) <= 2 && mailboxMine(c, p.x, p.z)),
    have: one((c) => c.out(ids('mailbox')).some((p) => dist(p.x, p.z, c.DOOR) <= 2 && mailboxMine(c, p.x, p.z))) }),
  T('w_shade_tree', { size: 'S', where: 'foot', band: [1, 3],
    parts: [{ piece: 'tree_oak', alt: [...TREES], n: 1, set: TREES }],
    offer: (c) => !within(c.out(TREES), c.FOOT, 3).length,
    done: (c) => within(c.out(TREES), c.FOOT, 3, 1).length > 0,
    have: one((c) => within(c.out(TREES), c.FOOT, 3, 1).length > 0) }),
  T('w_apple_tree', { size: 'S', where: 'foot', band: [1, 5],
    parts: [{ piece: 'tree_apple', n: 1, set: ids('tree_apple') }],
    offer: (c) => !within(c.out(ids('tree_apple')), c.FOOT, 5).length,
    done: (c) => within(c.out(ids('tree_apple')), c.FOOT, 5).length > 0,
    have: one((c) => within(c.out(ids('tree_apple')), c.FOOT, 5).length > 0) }),
  T('w_birds', { size: 'S', where: 'foot', band: [1, 3],
    parts: [{ piece: 'birdhouse', alt: ['birdbath'], n: 1, set: ids('birdhouse', 'birdbath') }],
    offer: (c) => !within(c.out(ids('birdhouse', 'birdbath')), c.FOOT, 3).length,
    done: (c) => within(c.out(ids('birdhouse', 'birdbath')), c.FOOT, 3).length > 0,
    have: one((c) => within(c.out(ids('birdhouse', 'birdbath')), c.FOOT, 3).length > 0) }),
  T('w_window_boxes', { size: 'S', where: 'edges', layer: 'W',
    parts: [{ piece: 'wall_window_shutters', n: 1, kind: 'edge', edge: 'window' }],
    offer: (c) => homeEdges(c).some((e) => e.rec && (e.rec.t === 'wall' || (S.WINDOW.has(e.rec.t) && e.rec.t !== 'wall_window_shutters' && e.rec.t !== 'gable_window'))),
    base: (c) => shuttersOnHome(c),
    done: (c, v, w) => shuttersOnHome(c) >= (w?.base ?? shuttersOnHome(c)) + 1,
    have: (c, v, w) => [capN(1, shuttersOnHome(c) - (w?.base ?? shuttersOnHome(c)))] }),
  T('w_reading_nook', { size: 'M', where: 'inside',
    parts: [{ piece: 'armchair', alt: [...S.SEAT_IN], n: 1, inside: true, set: S.SEAT_IN, face: 'wall' },
      { piece: 'bookshelf', alt: ['floor_lamp'], n: 1, near: 0, band: [1, 1], inside: true, set: ids('bookshelf', 'floor_lamp'), face: 'wall' }],
    offer: (c) => !!c.home && !nookDone(c),
    done: (c) => nookDone(c),
    have: (c) => { const a = bestAnchor(c, S.SEAT_IN, 1, ids('bookshelf', 'floor_lamp')); return [a.anchor ? 1 : 0, a.count ? 1 : 0]; } }),
  T('w_hearth', { size: 'S', where: 'inside',
    parts: [{ piece: 'fireplace', alt: ['wood_stove'], n: 1, inside: true, set: ids('fireplace', 'wood_stove'), face: 'wall' }],
    offer: (c) => !!c.home && !c.inn(ids('fireplace', 'wood_stove')).length,
    done: (c) => c.inn(ids('fireplace', 'wood_stove')).length > 0,
    have: one((c) => c.inn(ids('fireplace', 'wood_stove')).length > 0) }),
  T('w_kitchen', { size: 'M', where: 'inside',
    parts: [{ piece: 'kitchen_range', n: 1, inside: true, set: ids('kitchen_range'), face: 'wall' },
      { piece: 'kitchen_counter', alt: ['kitchen'], n: 1, near: 0, band: [1, 1], inside: true, set: ids('kitchen', 'kitchen_counter'), face: 'wall' }],
    offer: (c) => !!c.home && !kitchenDone(c),
    done: (c) => kitchenDone(c),
    have: (c) => { const a = bestAnchor(c, ids('kitchen_range'), 1, ids('kitchen', 'kitchen_counter')); return [a.anchor ? 1 : 0, a.count ? 1 : 0]; } }),
  T('w_supper_table', { size: 'M', where: 'inside',
    parts: [{ piece: 'table', n: 1, inside: true, set: ids('table'), face: 'door1' },
      { piece: 'chair', n: 2, near: 0, band: [1, 1], inside: true, set: ids('chair'), face: 'anchor' }],
    offer: (c) => !!c.home && !supperDone(c),
    done: (c) => supperDone(c),
    have: (c) => { const a = bestAnchor(c, ids('table'), 1, ids('chair')); return [a.anchor ? 1 : 0, capN(2, a.count)]; } }),
  T('w_soft_rug', { size: 'S', where: 'inside', layer: 'D',
    parts: [{ piece: 'rug', alt: ['rug_round'], n: 1, inside: true, set: ids('rug', 'rug_round'), layer: 'D' }],
    offer: (c) => !!c.home && !c.inn(ids('rug', 'rug_round')).length,
    done: (c) => c.inn(ids('rug', 'rug_round')).length > 0,
    have: one((c) => c.inn(ids('rug', 'rug_round')).length > 0) }),
  T('w_pet', { size: 'S', where: 'inside',
    parts: [{ piece: 'cat', alt: ['dog_bed', 'doghouse'], n: 1, inside: true, set: ids('cat', 'dog_bed') }],
    offer: (c) => !!c.home && !petDone(c),
    done: (c) => petDone(c),
    have: one((c) => petDone(c)) }),
  T('w_bath', { size: 'S', where: 'inside',
    parts: [{ piece: 'bathtub', alt: ['washstand'], n: 1, inside: true, set: ids('bathtub', 'washstand'), face: 'wall' }],
    offer: (c) => !!c.home && !c.inn(ids('bathtub', 'washstand')).length,
    done: (c) => c.inn(ids('bathtub', 'washstand')).length > 0,
    have: one((c) => c.inn(ids('bathtub', 'washstand')).length > 0) }),
  T('w_porch', { size: 'M', where: 'door', layer: 'F',
    parts: [{ piece: 'deck', n: 2, kind: 'chain', chain: 'porch' }],
    offer: (c) => c.DOOR.length > 0 && deckChainAtDoor(c) < 2,
    done: (c) => deckChainAtDoor(c) >= 2,
    have: (c) => [capN(2, deckChainAtDoor(c))] }),
  T('w_garden_fence', { size: 'M', where: 'boundary', layer: 'W',
    parts: [{ piece: 'fence_picket', alt: [...FENCES], n: 4, kind: 'edge', edge: 'fence' }],
    offer: (c) => fenceEdgesQualifying(c) < 2,
    done: (c) => fenceEdgesQualifying(c) >= 4,
    have: (c) => [capN(4, fenceEdgesQualifying(c))] }),
  T('w_pond', { size: 'S', where: 'foot', band: [1, 4],
    parts: [{ piece: 'pond', n: 1, set: ids('pond') }],
    offer: (c) => !pondsNear(c, 6).length,
    done: (c) => pondsNear(c, 4).length > 0,
    have: one((c) => pondsNear(c, 4).length > 0) }),
  T('w_water_bench', { size: 'S', where: 'pond', band: [1, 1],
    parts: [{ piece: 'bench', alt: ['boulders'], n: 1, face: 'pond', set: ids('bench', 'boulders') }],
    offer: (c) => pondsNear(c, 8).some((p) => !c.out(ids('bench', 'boulders')).some((s) => cheb(s, p) <= 1)),
    done: (c) => pondsNear(c, 8).some((p) => c.out(ids('bench', 'boulders')).some((s) => cheb(s, p) <= 1)),
    have: one((c) => pondsNear(c, 8).some((p) => c.out(ids('bench', 'boulders')).some((s) => cheb(s, p) <= 1))) }),
  T('w_fire_circle', { size: 'M', where: 'foot', band: [2, 8],
    parts: [{ piece: 'fire_pit', n: 1, set: ids('fire_pit') },
      { piece: 'bench', alt: [...S.SEAT_OUT], n: 2, near: 0, band: [1, 2], set: S.SEAT_OUT, face: 'anchor' }],
    offer: (c) => !fireDone(c),
    done: (c) => fireDone(c),
    have: (c) => { const a = bestAnchor(c, ids('fire_pit'), 2, S.SEAT_OUT, 8); return [a.anchor ? 1 : 0, capN(2, a.count)]; } }),
  T('w_picnic_shade', { size: 'M', where: 'foot', band: [1, 6],
    parts: [{ piece: 'picnic_table', n: 1, set: ids('picnic_table'), prefer: (c, x, z) => c.out(TREES).some((t) => Math.max(Math.abs(t.x - x), Math.abs(t.z - z)) <= 1) },
      { piece: 'tree_oak', alt: [...TREES], n: 1, near: 0, band: [1, 1], set: TREES }],
    offer: (c) => !picnicDone(c),
    done: (c) => picnicDone(c),
    have: (c) => { const a = bestAnchor(c, ids('picnic_table'), 1, TREES, 6); return [a.anchor ? 1 : 0, a.count ? 1 : 0]; } }),
  T('w_lamp_seat', { size: 'S', where: 'seat', band: [1, 1],
    parts: [{ piece: 'lamp_post', n: 1, set: LAMPS }],
    offer: (c) => seatsWithoutLamp(c).length > 0,
    done: (c) => within(c.out(ids('bench', 'picnic_table', 'fire_pit', 'gift_tea_table')), c.FOOT, 8).some((s) => c.out(LAMPS).some((l) => cheb(l, s) <= 1)),
    have: one((c) => within(c.out(ids('bench', 'picnic_table', 'fire_pit', 'gift_tea_table')), c.FOOT, 8).some((s) => c.out(LAMPS).some((l) => cheb(l, s) <= 1))) }),
  T('w_well', { size: 'S', where: 'foot', band: [2, 8],
    parts: [{ piece: 'well', n: 1, set: ids('well') }],
    offer: (c) => !(c.index.byType.get('well') || []).length,
    done: (c) => within(c.out(ids('well')), c.FOOT, 8).length > 0,
    have: one((c) => within(c.out(ids('well')), c.FOOT, 8).length > 0) }),
  T('w_washing_line', { size: 'S', where: 'foot', band: [1, 4],
    parts: [{ piece: 'clothesline', n: 1, set: ids('clothesline') }],
    offer: (c) => !within(c.out(ids('clothesline')), c.FOOT, 4).length,
    done: (c) => within(c.out(ids('clothesline')), c.FOOT, 4).length > 0,
    have: one((c) => within(c.out(ids('clothesline')), c.FOOT, 4).length > 0) }),
  T('w_veg_patch', { size: 'S', where: 'foot', band: [1, 4],
    parts: [{ piece: 'veggie_bed', alt: ['pumpkins'], n: 1, set: ids('veggie_bed', 'pumpkins') }],
    offer: (c) => !within(c.out(ids('veggie_bed', 'pumpkins')), c.FOOT, 4).length,
    done: (c) => within(c.out(ids('veggie_bed', 'pumpkins')), c.FOOT, 4).length > 0,
    have: one((c) => within(c.out(ids('veggie_bed', 'pumpkins')), c.FOOT, 4).length > 0) }),
  T('w_chickens', { size: 'S', where: 'foot', band: [1, 5],
    parts: [{ piece: 'chickens', n: 1, set: ids('chickens') }],
    offer: (c) => !within(c.out(ids('chickens')), c.FOOT, 5).length,
    done: (c) => within(c.out(ids('chickens')), c.FOOT, 5).length > 0,
    have: one((c) => within(c.out(ids('chickens')), c.FOOT, 5).length > 0) }),
  T('w_hive', { size: 'S', where: 'foot', band: [1, 4],
    parts: [{ piece: 'beehive', n: 1, set: ids('beehive') }],
    offer: (c) => !within(c.out(ids('beehive')), c.FOOT, 4).length,
    done: (c) => within(c.out(ids('beehive')), c.FOOT, 4).length > 0,
    have: one((c) => within(c.out(ids('beehive')), c.FOOT, 4).length > 0) }),
  T('w_bloom_riot', { size: 'M', where: 'foot', band: [1, 3], trait: 'florist',
    parts: [{ piece: 'flowers', n: 1, set: ids(...BLOOMS, 'bush') }, { piece: 'lavender', n: 1, set: ids(...BLOOMS, 'bush') },
      { piece: 'sunflowers', n: 1, set: ids(...BLOOMS, 'bush') }],
    offer: () => true,
    base: (c) => riotCount(c),
    done: (c, v, w) => riotCount(c) >= (w?.base ?? riotCount(c)) + 3,
    have: (c, v, w) => { const k = riotCount(c) - (w?.base ?? riotCount(c)); return [k >= 1 ? 1 : 0, k >= 2 ? 1 : 0, k >= 3 ? 1 : 0]; } }),
  T('w_neighbour', { size: 'L', where: 'lot', layer: 'F',
    parts: AREA_PARTS(),
    offer: (c) => (c.town.population ?? 0) < TUNE.MAX_VILLAGERS && !(c.town.campers > 0) && !(c.town.freeBeds > 0) && !c.town.travellerDue,
    freeze: (c) => { const a = freeArea(c); return a ? { area: a } : null; },
    done: (c) => c.homes.some((h) => h.capacity > (c.town.residentsOf ? c.town.residentsOf(h.id) : 0)),
    have: (c, v, w) => areaHave(c, w) }),
  // ---- job wishes (§7.3 J1–J11)
  T('J_garden', { size: 'M', job: 'gardener', where: 'foot', band: [1, 4],
    parts: [{ piece: 'flowers', alt: [...BLOOMS], n: 2, set: BLOOMS }],
    offer: () => true,
    base: (c) => sumUnits(BLOOMS, within(c.out(BLOOMS), c.FOOT, 4)),
    done: (c, v, w) => sumUnits(BLOOMS, within(c.out(BLOOMS), c.FOOT, 4)) >= (w?.base ?? Infinity) + 2,
    have: (c, v, w) => [capN(2, sumUnits(BLOOMS, within(c.out(BLOOMS), c.FOOT, 4)) - (w?.base ?? sumUnits(BLOOMS, within(c.out(BLOOMS), c.FOOT, 4))))] }),
  T('J_farm_crow', { size: 'S', job: 'farmer', where: 'beds', band: [1, 2],
    parts: [{ piece: 'scarecrow', n: 1, set: ids('scarecrow') }],
    offer: (c) => { const beds = vegBeds(c); return beds.length > 0 && !beds.some((b) => c.out(ids('scarecrow')).some((s) => cheb(s, b) <= 2)); },
    done: (c) => vegBeds(c).some((b) => c.out(ids('scarecrow')).some((s) => cheb(s, b) <= 2)),
    have: one((c) => vegBeds(c).some((b) => c.out(ids('scarecrow')).some((s) => cheb(s, b) <= 2))) }),
  T('J_farm_more', { size: 'S', job: 'farmer', where: 'foot', band: [1, 5],
    parts: [{ piece: 'veggie_bed', alt: ['pumpkins'], n: 1, set: ids('veggie_bed', 'pumpkins') }],
    offer: () => true,
    base: (c) => vegBeds(c).length,
    done: (c, v, w) => vegBeds(c).length >= (w?.base ?? Infinity) + 1,
    have: (c, v, w) => [capN(1, vegBeds(c).length - (w?.base ?? vegBeds(c).length))] }),
  T('J_wood_sapling', { size: 'S', job: 'woodcutter', where: 'foot', band: [1, 6],
    parts: [{ piece: 'tree_pine', alt: [...TREES], n: 1, set: TREES }],
    offer: () => true,
    base: (c) => within(c.out(TREES), c.FOOT, 6).length,
    done: (c, v, w) => within(c.out(TREES), c.FOOT, 6).length >= (w?.base ?? Infinity) + 1,
    have: (c, v, w) => [capN(1, within(c.out(TREES), c.FOOT, 6).length - (w?.base ?? within(c.out(TREES), c.FOOT, 6).length))] }),
  T('J_wood_pile', { size: 'S', job: 'woodcutter', where: 'foot', band: [1, 3],
    parts: [{ piece: 'woodpile', n: (c, v, w) => pileTarget(c, w), set: ids('woodpile') }],
    offer: (c) => woodpiles(c) < 2,
    base: (c) => woodpiles(c),
    done: (c, v, w) => woodpiles(c) >= pileTarget(c, w),
    have: (c, v, w) => [capN(pileTarget(c, w), woodpiles(c))] }),
  T('J_fish_perch', { size: 'S', job: 'fisher', where: 'pond', band: [1, 1],
    parts: [{ piece: 'boulders', n: 1, face: 'pond', set: ids('boulders') }],
    offer: (c) => !!workPond(c) && !c.out(ids('boulders')).some((b) => cheb(b, workPond(c)) <= 1),
    done: (c) => !!workPond(c) && c.out(ids('boulders')).some((b) => cheb(b, workPond(c)) <= 1),
    have: one((c) => !!workPond(c) && c.out(ids('boulders')).some((b) => cheb(b, workPond(c)) <= 1)) }),
  T('J_fish_dock', { size: 'M', job: 'fisher', where: 'pond', band: [1, 1], layer: 'F',
    parts: [{ piece: 'deck', n: 2, kind: 'cellF', set: ids('deck') }],
    offer: (c) => !!workPond(c) && dockCount(c) < 2,
    done: (c) => dockCount(c) >= 2,
    have: (c) => [capN(2, dockCount(c))] }),
  T('J_bee_blooms', { size: 'M', job: 'beekeeper', where: 'hive', band: [1, 2],
    parts: [{ piece: 'lavender', alt: [...BLOOMS], n: 2, set: BLOOMS }],
    offer: (c) => !!workHive(c),
    base: (c) => hiveBlooms(c),
    done: (c, v, w) => hiveBlooms(c) >= (w?.base ?? Infinity) + 2,
    have: (c, v, w) => [capN(2, hiveBlooms(c) - (w?.base ?? hiveBlooms(c)))] }),
  T('J_bake_table', { size: 'S', job: 'baker', where: 'door', band: [1, 3],
    parts: [{ piece: 'picnic_table', n: 1, set: ids('picnic_table') }],
    offer: (c) => !within(c.out(ids('picnic_table')), c.DOOR, 3).length,
    done: (c) => within(c.out(ids('picnic_table')), c.DOOR, 3).length > 0,
    have: one((c) => within(c.out(ids('picnic_table')), c.DOOR, 3).length > 0) }),
  T('J_lamp_more', { size: 'S', job: 'lamplighter', where: 'foot', band: [2, 6],
    parts: [{ piece: 'lamp_post', n: 1, set: LAMPS, ok: (c, x, z) => !c.out(LAMPS).some((l) => Math.max(Math.abs(l.x - x), Math.abs(l.z - z)) <= 1) }],
    offer: () => true,
    base: (c) => lampsOnLot(c),
    done: (c, v, w) => lampsOnLot(c) >= (w?.base ?? Infinity) + 1,
    have: (c, v, w) => [capN(1, lampsOnLot(c) - (w?.base ?? lampsOnLot(c)))] }),
  T('J_post_paths', { size: 'L', job: 'postie', where: 'door1', layer: 'F',
    parts: [{ piece: 'path', n: (c) => postRoutes(c).cells.length, kind: 'chain', chain: 'post' }],
    offer: (c) => c.homes.length >= 2 && !allJoined(c),
    done: (c) => c.homes.length >= 2 && allJoined(c),
    have: (c) => [postRoutes(c).cells.filter(([x, z]) => PATHY_FK.has(c.index.fk[ci(x, z)])).length] }),
];
export const TEMPLATE = Object.fromEntries(TEMPLATES.map((t) => [t.id, t]));
// a part's `set` defaults to its piece + alts
for (const t of TEMPLATES) for (const p of t.parts) if (!p.set) p.set = ids(p.piece, p.alt || []);

// ---- rule helpers
function mailboxMine(c, x, z) {
  const d = dist(x, z, c.DOOR);
  for (const h of c.homes) {
    if (h.id === c.home?.id) continue;
    if (dist(x, z, h.doors.map((e) => e.step)) < d) return false;
  }
  return true;
}
function bestAnchor(c, anchorSet, R, nearSet, footR = null) {
  const inside = [...anchorSet].some((t) => S.COZY_IN.has(t) || ['table', 'kitchen_range', 'armchair', 'sofa'].includes(t));
  let pool = inside ? c.inn(anchorSet) : c.out(anchorSet);
  if (footR !== null) pool = within(pool, c.FOOT, footR);
  pool = pool.slice().sort((a, b) => ci(a.x, a.z) - ci(b.x, b.z) || a.y - b.y);
  let best = null, bn = -1;
  for (const a of pool) {
    const n = nearCount(c, { band: [1, R], inside }, a, nearSet);
    if (n > bn) { bn = n; best = a; }
  }
  return { anchor: best, count: Math.max(0, bn) };
}
const nookDone = (c) => bestAnchor(c, S.SEAT_IN, 1, ids('bookshelf', 'floor_lamp')).count >= 1;
const kitchenDone = (c) => bestAnchor(c, ids('kitchen_range'), 1, ids('kitchen', 'kitchen_counter')).count >= 1;
const supperDone = (c) => bestAnchor(c, ids('table'), 1, ids('chair')).count >= 2;
const fireDone = (c) => bestAnchor(c, ids('fire_pit'), 2, S.SEAT_OUT, 8).count >= 2;
const picnicDone = (c) => bestAnchor(c, ids('picnic_table'), 1, TREES, 6).count >= 1;
const petDone = (c) => c.inn(ids('cat', 'dog_bed')).length > 0 || within(c.out(ids('doghouse')), c.FOOT, 3).length > 0;
const riotCount = (c) => sumUnits(S.BLOOM, within(c.out(ids(...BLOOMS, 'bush')), c.FOOT, 3)) + within(c.out(ids('bush')), c.FOOT, 3).length;
const vegBeds = (c) => within(c.out(ids('veggie_bed', 'pumpkins')), c.FOOT, 5);
const woodpiles = (c) => within(c.out(ids('woodpile')), c.FOOT, 3).length;
const pileTarget = (c, w) => ((w?.base ?? woodpiles(c)) === 0 ? 1 : 2);
const dockCount = (c) => { const p = workPond(c); if (!p) return 0; let n = 0; for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) if ((a || b) && deckAt(c, p.x + a, p.z + b)) n++; return n; };
const hiveBlooms = (c) => { const h = workHive(c); return h ? sumUnits(BLOOMS, within(c.out(BLOOMS), [[h.x, h.z]], 2)) : 0; };
const lampsOnLot = (c) => sumUnits(LAMPS, c.index.items.filter((p) => LAMPS.has(p.t) || unitsIn('LAMP', p.t)));
function allJoined(c) {
  const d1 = c.homes.map((h) => (h.doors.find((d) => d.main) || h.doors[0])?.step).filter(Boolean);
  for (let a = 1; a < d1.length; a++) if (!joined(c, d1[0], d1[a])) return false;
  return true;
}

// chain routes
function chainRoute(c, wish) {
  return c.memo('friendRoute', () => {
    const f = friendFromWish(c, wish);
    if (!f || !c.DOOR1) return [];
    const p = c.nav.path(c.DOOR1, f.door);
    return trimEnds((p.cells || []).map((i) => [cx(i), cz(i)]), c.DOOR1, f.door).filter(([x, z]) => inLot(x, z));
  });
}
// a chain only has to join a cell within 1 of each DOOR1: start at the route's last cell within 1 of `a` and stop at
// its first cell within 1 of `b` after that
function trimEnds(cells, a, b) {
  const near = (c, d) => Math.max(Math.abs(c[0] - d[0]), Math.abs(c[1] - d[1])) <= 1;
  let s = 0;
  for (let k = 0; k < cells.length; k++) if (near(cells[k], a)) s = k;
  let e = cells.length - 1;
  for (let k = s; k < cells.length; k++) if (near(cells[k], b)) { e = k; break; }
  return cells.slice(s, e + 1);
}
function postRoutes(c) {
  return c.memo('postRoutes', () => {
    const cells = [], seen = new Set();
    if (!c.DOOR1) return { cells };
    const others = c.homes.filter((h) => h.id !== c.home?.id).map((h) => (h.doors.find((d) => d.main) || h.doors[0])?.step).filter(Boolean);
    others.sort((a, b) => dist(a[0], a[1], [c.DOOR1]) - dist(b[0], b[1], [c.DOOR1]) || ci(a[0], a[1]) - ci(b[0], b[1]));
    for (const o of others) {
      if (joined(c, c.DOOR1, o)) continue;
      const p = c.nav.path(o, c.DOOR1);
      for (const [x, z] of trimEnds((p.cells || []).map((i) => [cx(i), cz(i)]), o, c.DOOR1)) {
        const i = ci(x, z);
        if (!inLot(x, z) || seen.has(i)) continue;
        seen.add(i); cells.push([x, z]);
      }
    }
    return { cells };
  });
}

// ---- free 6 × 6 area and the SMALL_HOME layout (w_neighbour, the camp wish)
function AREA_PARTS() {
  return [
    { piece: 'foundation', n: 4, kind: 'area', layer: 'F', set: ids('foundation') },
    { piece: 'wall', n: 7, kind: 'area', layer: 'W', set: ids(...SETS.WALLISH) },
    { piece: 'wall_door', n: 1, kind: 'area', layer: 'W', set: ids(...SETS.DOORWAY) },
    { piece: 'roof_flat', n: 4, kind: 'area', layer: 'R', set: ids('roof_flat') },
    { piece: 'bed', n: 1, kind: 'area', set: ids('bed') },
  ];
}
/** A free 6 × 6 area of the lot nearest the villager's home (else the lot centre): { x0, z0 } or null. */
export function freeArea(c) {
  const ix = c.index, nav = c.nav;
  const occupied = new Uint8Array(NN);
  for (const k of ix.F.keys()) { const [x, y, z] = k.split('|').map(Number); if (y === 0 && inNav(x, z)) occupied[ci(x, z)] = 1; }
  for (const p of ix.items) if (inNav(p.x, p.z)) occupied[ci(p.x, p.z)] = 1;
  for (const p of ix.W.values()) if (inNav(p.x, p.z)) { occupied[ci(p.x, p.z)] = 1; if (p.a === 'x' && inNav(p.x, p.z - 1)) occupied[ci(p.x, p.z - 1)] = 1; if (p.a === 'z' && inNav(p.x - 1, p.z)) occupied[ci(p.x - 1, p.z)] = 1; }
  for (const k of ix.R.keys()) { const [x, z] = k.split('|').map(Number); if (inNav(x, z)) occupied[ci(x, z)] = 1; }
  for (let i = 0; i < NN; i++) if (nav.blocked[i] || nav.doorstep[i]) occupied[i] = 1;
  const ref = c.FOOT.length ? c.FOOT : [[0, 0]];
  let best = null, bd = Infinity;
  for (let x0 = -10; x0 <= 4; x0++) for (let z0 = -10; z0 <= 4; z0++) {
    let ok = true;
    for (let a = 0; a < 6 && ok; a++) for (let b = 0; b < 6; b++) if (occupied[ci(x0 + a, z0 + b)]) { ok = false; break; }
    if (!ok) continue;
    const d = dist(x0 + 2.5, z0 + 2.5, ref);
    if (d < bd - 1e-9) { bd = d; best = { x0, z0 }; }
  }
  return best;
}
/** The SMALL_HOME layout (§13.4) in the middle of a 6 × 6 area: recs in part order. */
export function areaLayout(area) {
  const x0 = area.x0 + 2, z0 = area.z0 + 2;
  const F = [], Wl = [], D = [], R = [], B = [];
  for (let z = z0; z <= z0 + 1; z++) for (let x = x0; x <= x0 + 1; x++) { F.push({ t: 'foundation', x, y: 0, z, r: 0 }); R.push({ t: 'roof_flat', x, y: 1, z, h: 0, r: 0 }); }
  for (let x = x0; x <= x0 + 1; x++) {
    Wl.push({ t: 'wall', a: 'x', x, y: 0, z: z0, r: 2 });
    if (x === x0) D.push({ t: 'wall_door', a: 'x', x, y: 0, z: z0 + 2, r: 0 }); else Wl.push({ t: 'wall', a: 'x', x, y: 0, z: z0 + 2, r: 0 });
  }
  for (let z = z0; z <= z0 + 1; z++) { Wl.push({ t: 'wall', a: 'z', x: x0, y: 0, z, r: 2 }); Wl.push({ t: 'wall', a: 'z', x: x0 + 2, y: 0, z, r: 0 }); }
  B.push({ t: 'bed', x: x0, y: 0, z: z0, r: 0 });
  return [F, Wl, D, R, B];
}
const slotKeyOf = (c, rec) => {
  const def = c.index.defOf ? c.index.defOf(rec.t) : null;
  const L = def?.layer || 'I';
  if (L === 'W') return `W|${rec.a}|${rec.x}|${rec.y}|${rec.z}`;
  if (L === 'R') return `R|${rec.x}|${2 * rec.y + (rec.h | 0)}|${rec.z}`;
  return `${L}|${rec.x}|${rec.y}|${rec.z}`;
};
const recAt = (c, key) => {
  const [L, a, b, cc, d] = key.split('|');
  if (L === 'W') return c.index.W.get(key);
  if (L === 'F') return c.index.F.get(ck(a, b, cc));
  if (L === 'I') return c.index.I.get(ck(a, b, cc));
  if (L === 'D') return c.index.D.get(ck(a, b, cc));
  if (L === 'R') return (c.index.R.get(a + '|' + cc) || []).find((r) => r.hs === +b)?.p;
  return undefined;
};
function areaHave(c, w) {
  const area = w?.frozen?.area || freeArea(c);
  if (!area) return [0, 0, 0, 0, 0];
  return areaLayout(area).map((list, k) => list.filter((rec) => { const p = recAt(c, slotKeyOf(c, rec)); return p && AREA_PARTS()[k].set.has(p.t); }).length);
}

// ============================================================================================== eligibility & choice
/** Is the template offered and possible for ctx.v now (§7.4; cooldown / recent are checked when ctx.clock is set)? */
export function eligible(tpl, ctx) {
  const v = ctx.v;
  if (!v || !ctx.home) return false;
  if (tpl.job && tpl.job !== v.job) return false;
  if (tpl.trait && tpl.trait !== v.trait) return false;
  if (typeof ctx.clock === 'number') {
    if ((v.cool?.[tpl.id] ?? -Infinity) > ctx.clock) return false;
    if ((v.recent || []).slice(-TUNE.WISH_RECENT).includes(tpl.id)) return false;
  }
  try {
    if (!tpl.offer(ctx, v)) return false;
    if (tpl.done(ctx, v, null)) return false;
    const plan = findSpots(tpl, ctx, null);
    return plan.complete;
  } catch (e) {
    return false;
  }
}

export function isDone(tpl, ctx, wish) {
  try { return !!tpl.done(ctx, ctx.v, wish); } catch { return false; }
}

export function baseline(tpl, ctx) {
  return tpl.base ? tpl.base(ctx, ctx.v) : null;
}

/** Weight of an eligible template for v (§7.4) given the lot fit of its first part. */
export function weightOf(tpl, ctx, { odd = false, sameHeld = false, lotSpots = 3 } = {}) {
  const v = ctx.v;
  let w = TUNE.WISH_BASE[tpl.size] || 1;
  if (tpl.job) w *= TUNE.WISH_JOB_ONLY;
  else if ((JOB_FAVOURS[v.job] || []).includes(tpl.id)) w *= TUNE.WISH_FAVOURED;
  if (odd && JOBS[v.job]?.oddWish === tpl.id) w *= TUNE.WISH_ODD_JOB;
  const tf = TRAITS[v.trait]?.favours?.[tpl.id];
  if (tf) w *= tf;
  w *= Math.min(1, lotSpots / 3);
  if (sameHeld) w *= TUNE.WISH_SAME_TPL;
  return w;
}

/** A Wish object for v (§12.3) at town time `clock`. */
export function createWish(tpl, ctx, clock, { dream = false } = {}) {
  const base = baseline(tpl, ctx);
  let friend = null;
  if (tpl.id === 'w_path_friend') friend = friendOf(ctx)?.v?.id || null;
  const frozen = tpl.freeze ? tpl.freeze(ctx, ctx.v) : null;
  return {
    tpl: tpl.id, born: clock, size: tpl.size, dream: !!dream, base, friend, homeId: ctx.home?.id || null,
    frozen, piece: tpl.parts[0].piece, ...textOf(tpl.id, ctx, friend),
  };
}

/** icon / text / label of a template, with {friend} filled in. */
export function textOf(id, ctx, friendId) {
  const t = WISH_TEXT[id] || { icon: '💭', text: '', label: '' };
  let name = '';
  if (friendId) name = (ctx?.town?.villagers || []).find((u) => u.id === friendId)?.name || '';
  return { icon: t.icon, text: t.text.replace('{friend}', name), label: t.label.replace('{friend}', name) };
}

// ============================================================================================== the spot finder (§7.5)
const yaw4 = (dx, dz) => (Math.abs(dx) >= Math.abs(dz) ? (dx >= 0 ? 1 : 3) : (dz >= 0 ? 0 : 2));
const layerOf = (c, t) => (c.index.defOf ? c.index.defOf(t)?.layer : null) || 'I';
const rotKind = (c, t) => (c.index.defOf ? c.index.defOf(t)?.rot : null) || 'four';
const solidPiece = (c, t) => {
  if (GIFTS[t]) return GIFTS[t].walk !== 'soft';
  if (SOLID.has(t)) return true;
  const d = c.index.defOf ? c.index.defOf(t) : null;
  return !!d && (d.cat === 'interior' || d.cat === 'frame') && !['plant_pot', 'chair', 'rocking_chair', 'armchair', 'cat', 'dog_bed'].includes(t);
};
const surfaceOut = (c, x, z) => (inNav(x, z) ? c.nav.surface[ci(x, z)] : 0);

function anchorCells(c, where, wish) {
  switch (where) {
    case 'door': return c.DOOR;
    case 'door1': return c.DOOR1 ? [c.DOOR1] : [];
    case 'foot': return c.FOOT;
    case 'route': return wish?.frozen?.route || routeOf(c);
    case 'pond': {
      if (c.job === 'fisher' && workPond(c)) return [[workPond(c).x, workPond(c).z]];
      return pondsNear(c, 8).filter((p) => !c.out(ids('bench', 'boulders')).some((s) => cheb(s, p) <= 1)).map((p) => [p.x, p.z]);
    }
    case 'hive': { const h = workHive(c); return h ? [[h.x, h.z]] : []; }
    case 'seat': return seatsWithoutLamp(c).map((p) => [p.x, p.z]);
    case 'beds': return vegBeds(c).map((p) => [p.x, p.z]);
    case 'lot': return [[0, 0]];
    default: return c.FOOT;
  }
}

function rotFor(c, part, x, y, z, anchor) {
  if (rotKind(c, part.piece) === 'none') return 0;
  const face = part.face || 'door1';
  if (face === 'pond' || face === 'anchor') {
    if (anchor) return yaw4(anchor.x - x, anchor.z - z);
  }
  if (face === 'pond') {
    const ps = c.out(ids('pond')).slice().sort((a, b) => Math.max(Math.abs(a.x - x), Math.abs(a.z - z)) - Math.max(Math.abs(b.x - x), Math.abs(b.z - z)));
    if (ps[0]) return yaw4(ps[0].x - x, ps[0].z - z);
  }
  if (face === 'wall' || part.inside) {
    // back to a wall (local −Z), facing into the room
    let best = 0, bs = -1;
    for (let d = 0; d < 4; d++) {
      const back = (d + 2) & 3;
      const e = inNav(x, z) && y < 5 ? c.index.ec[(y * NN + ci(x, z)) * 4 + back] : 0;
      let s = (e === EC.wall ? 3 : e === EC.door ? 0 : 0);
      if (c.INSIDE.has(ck(x + DX[d], y, z + DZ[d]))) s += 1;
      if (face === 'door1' && c.DOOR1) s += 0;
      if (s > bs) { bs = s; best = d; }
    }
    return best;
  }
  if (face === 'away') {
    // a seat by a door faces away from the nearest wall edge or house cell, toward open space
    let best = 0, bs = -Infinity;
    const cen = c.FOOT.length ? [c.FOOT.reduce((a, f) => a + f[0], 0) / c.FOOT.length, c.FOOT.reduce((a, f) => a + f[1], 0) / c.FOOT.length] : [x, z];
    for (let d = 0; d < 4; d++) {
      const fx = x + DX[d], fz = z + DZ[d], bx = x - DX[d], bz = z - DZ[d];
      let s = 0;
      if (c.nav.isFree(fx, fz)) s += 2;
      const behindWall = c.index.ec[ci(x, z) * 4 + ((d + 2) & 3)] === EC.wall || (inNav(bx, bz) && c.world.det.bOf[ci(bx, bz)] >= 0);
      if (behindWall) s += 3;
      if (c.home && c.home.cells.has(ck(fx, 0, fz))) s -= 5;
      s += ((fx - cen[0]) * DX[d] + (fz - cen[1]) * DZ[d] > 0 ? 1 : 0);
      if (s > bs) { bs = s; best = d; }
    }
    return best;
  }
  if (c.DOOR1) return yaw4(c.DOOR1[0] - x, c.DOOR1[1] - z);
  return 0;
}

function specRec(c, t, x, y, z, r, extra) {
  return { t, x, y, z, r, ...(extra || {}) };
}

function okOutdoorCell(c, t, x, z, planned, solidPlanned) {
  if (!inLot(x, z)) return false;
  const i = ci(x, z);
  if (c.world.det.bOf[i] >= 0) return false;                       // never on a covered-room floor
  if (c.nav.blocked[i] || c.nav.region[i] !== c.nav.mainRegion) return false;
  const L = layerOf(c, t);
  const key = `${L}|${x}|0|${z}`;
  if (planned.has(key)) return false;
  const rec = { t, x, y: 0, z, r: 0 };
  if (!c.world.isFree(rec)) return false;
  if (!c.world.validate(rec).ok) return false;
  if (solidPiece(c, t)) {
    if (c.nav.doorstep[i]) return false;
    if (solidPlanned.some((j) => j === i)) return false;
    // does blocking it (with the earlier solid recs) cut a doorstep off from mainRegion?
    const reach = c.nav.reachWithout([...solidPlanned, i]);
    for (const [sx, sz] of c.nav.steps) {
      const si = ci(sx, sz);
      if (c.nav.blocked[si] || c.nav.region[si] !== c.nav.mainRegion) continue;
      if (reach[si] !== 1) return false;
    }
  }
  return true;
}

function cellCandidates(c, anchors, band) {
  const [lo, hi] = band;
  const out = [];
  if (!anchors.length) return out;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of anchors) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  for (let x = Math.max(-10, x0 - hi); x <= Math.min(9, x1 + hi); x++) {
    for (let z = Math.max(-10, z0 - hi); z <= Math.min(9, z1 + hi); z++) {
      const d = dist(x, z, anchors);
      if (d >= lo && d <= hi) out.push([x, z, d]);
    }
  }
  out.sort((a, b) => a[2] - b[2] || ci(a[0], a[1]) - ci(b[0], b[1]));
  return out;
}

function insideCandidates(c, anchorRec, band) {
  const cells = [];
  for (const k of c.INSIDE) { const [x, y, z] = k.split('|').map(Number); cells.push([x, y, z]); }
  const levels = new Map();
  for (const [x, y, z] of cells) { const L = levels.get(y) || { sx: 0, sz: 0, n: 0 }; L.sx += x; L.sz += z; L.n++; levels.set(y, L); }
  const out = [];
  for (const [x, y, z] of cells) {
    if (anchorRec) {
      if (y !== (anchorRec.y | 0)) continue;
      const d = Math.max(Math.abs(x - anchorRec.x), Math.abs(z - anchorRec.z));
      if (d < band[0] || d > band[1]) continue;
      out.push([x, y, z, d]);
    } else {
      const L = levels.get(y);
      out.push([x, y, z, Math.hypot(x - L.sx / L.n, z - L.sz / L.n)]);
    }
  }
  out.sort((a, b) => a[1] - b[1] || a[3] - b[3] || ci(a[0], a[2]) - ci(b[0], b[2]));
  if (anchorRec) out.sort((a, b) => a[3] - b[3] || ci(a[0], a[2]) - ci(b[0], b[2]));
  return out;
}

function recEntry(c, part, k, rec) {
  const L = layerOf(c, rec.t);
  let x, y, z, cell, edge;
  if (L === 'W') {
    edge = { a: rec.a, x: rec.x, z: rec.z, y: rec.y };
    x = rec.a === 'x' ? (rec.x + 0.5) * CELL : rec.x * CELL;
    z = rec.a === 'x' ? rec.z * CELL : (rec.z + 0.5) * CELL;
    y = rec.y > 0 ? 0.25 + rec.y * 2.5 : 0;
    cell = rec.a === 'x' ? [rec.x, rec.z] : [rec.x, rec.z];
  } else {
    x = (rec.x + 0.5) * CELL; z = (rec.z + 0.5) * CELL; cell = [rec.x, rec.z];
    if (L === 'R') y = 0.25 + (rec.y - 1) * 2.5 + 2.5;
    else if (rec.y > 0) y = 0.25 + rec.y * 2.5;
    else y = c.INSIDE.has(ck(rec.x, 0, rec.z)) ? (c.index.F.get(ck(rec.x, 0, rec.z)) ? 0.25 : 0) : surfaceOut(c, rec.x, rec.z);
  }
  const out = { part: k, rec, x, y, z, r: rec.r | 0, cell, level: rec.y | 0 };
  if (edge) out.edge = edge;
  return out;
}

/**
 * findSpots(tpl, ctx, wish = null) → SpotPlan (§7.5): { parts:[{ piece, n, have }], recs:[{ part, rec, x, y, z, r,
 * cell, edge?, level }], complete, spots0 } — recs ordered part by part (placing them in order completes the wish);
 * x, y, z are world metres of the spot (y = its surface), `level` the piece level; spots0 counts (up to 3) the
 * candidate spots of the first part (the §7.4 lot fit).
 */
export function findSpots(tpl, ctx, wish = null) {
  const c = ctx, v = c.v;
  const haveArr = tpl.have(c, v, wish) || [];
  const parts = tpl.parts.map((p, k) => ({ piece: p.piece, n: typeof p.n === 'function' ? p.n(c, v, wish) : p.n, have: haveArr[k] | 0 }));
  const recs = [];
  const planned = new Set(), solidPlanned = [];
  let complete = true, spots0 = 0;
  const anchorRecOf = [];               // per part: the existing or planned anchor record (for `near` parts)
  for (let k = 0; k < tpl.parts.length; k++) {
    const part = tpl.parts[k], P = parts[k];
    const kind = part.kind || 'cell';
    let need = Math.max(0, P.n - P.have);
    // an anchored part counts what already stands round its anchor (existing anchor or the planned one)
    if (part.near !== undefined) {
      const anc = anchorRecOf[part.near];
      if (anc) {
        const have = Math.min(P.n, nearCount(c, part, anc, part.set));
        if (anc.planned) need = Math.max(0, P.n - have);
        else need = Math.max(0, P.n - Math.max(have, P.have));
      }
    }
    if (kind === 'area') {
      const area = wish?.frozen?.area || c.memo('area', () => freeArea(c));
      if (!area) { complete = false; continue; }
      const list = areaLayout(area)[k];
      for (const rec of list) {
        const key = slotKeyOf(c, rec), cur = recAt(c, key);
        if (cur && part.set.has(cur.t)) continue;
        if (cur || !c.world.validate(rec).ok) { complete = false; continue; }
        recs.push(recEntry(c, part, k, rec));
        if (k === 0) spots0 = Math.min(3, spots0 + 1);
      }
      continue;
    }
    if (kind === 'edge') {
      const found = edgeSpots(c, part, need, planned);
      if (k === 0) spots0 = Math.min(3, found.count);
      for (const rec of found.recs) recs.push(recEntry(c, part, k, rec));
      if (found.recs.length < need) complete = false;
      continue;
    }
    if (kind === 'chain') {
      const found = chainSpots(c, part, wish, planned);
      if (k === 0) spots0 = found.recs.length || (found.ok ? 3 : 0);
      for (const rec of found.recs) recs.push(recEntry(c, part, k, rec));
      if (!found.ok) complete = false;
      continue;
    }
    // ---- cell pieces (outdoor level 0, or INSIDE)
    if (need === 0) {
      if (part.near === undefined) anchorRecOf[k] = existingAnchor(c, part, tpl);
      if (k === 0) spots0 = 3;
      continue;
    }
    const L = part.layer || layerOf(c, part.piece);
    let got = 0;
    if (part.inside) {
      const anc = part.near !== undefined ? anchorRecOf[part.near] : null;
      if (part.near !== undefined && !anc) { complete = false; continue; }
      for (const [x, y, z] of insideCandidates(c, anc, part.band || [1, 1])) {
        if (got >= need) { if (k === 0 && spots0 < 3) { spots0++; continue; } break; }
        const key = `${L}|${x}|${y}|${z}`;
        if (planned.has(key)) continue;
        const rec0 = { t: part.piece, x, y, z, r: 0 };
        if (!c.world.isFree(rec0) || !c.world.validate(rec0).ok) continue;
        if (L === 'I' && c.index.I.has(ck(x, y, z))) continue;
        const r = rotFor(c, part, x, y, z, anc);
        const rec = specRec(c, part.piece, x, y, z, r);
        planned.add(key); got++;
        if (k === 0) spots0 = Math.min(3, spots0 + 1);
        recs.push(recEntry(c, part, k, rec));
        if (!anchorRecOf[k]) anchorRecOf[k] = { ...rec, planned: true };
      }
    } else {
      let anchors;
      const anc = part.near !== undefined ? anchorRecOf[part.near] : null;
      if (part.near !== undefined) { if (!anc) { complete = false; continue; } anchors = [[anc.x, anc.z]]; }
      else anchors = anchorCells(c, part.where || tpl.where, wish);
      const band = part.band || tpl.band;
      let cands = cellCandidates(c, anchors, band);
      if (tpl.id === 'w_route_lamp') cands = cands.filter(([x, z]) => dist(x, z, c.DOOR) >= 3);
      // seats round a fire pit or table: straight on, on different sides (behind it facing the camera first, then
      // the sides, then in front), before any diagonal cell, so they read as a circle facing the anchor
      if (anc && part.face === 'anchor') {
        const SIDES = [[0, -1], [1, 0], [-1, 0], [0, 1]];
        const rank = (x, z) => {
          const dx = x - anc.x, dz = z - anc.z;
          const k = SIDES.findIndex(([a, b]) => a === dx && b === dz);
          return k >= 0 ? k : 4 + (dx && dz ? 3 : 0) + Math.max(Math.abs(dx), Math.abs(dz));
        };
        cands = cands.slice().sort((a, b) => rank(a[0], a[1]) - rank(b[0], b[1]) || ci(a[0], a[1]) - ci(b[0], b[1]));
      }
      // a solid piece that isn't itself a path goes beside a path or stepping stones, not on them, when the band has
      // another cell (the mailbox stays off the front path, T1.9); decks stay fine for seats. Stable: order kept
      if (solidPiece(c, part.piece) && L !== 'F') {
        const walk = (x, z) => { const f = c.index.fk[ci(x, z)]; return f === FK.path || f === FK.steps ? 1 : 0; };
        cands = cands.slice().sort((a, b) => walk(a[0], a[1]) - walk(b[0], b[1]));
      }
      if (part.prefer) cands.sort((a, b) => (part.prefer(c, b[0], b[1]) ? 1 : 0) - (part.prefer(c, a[0], a[1]) ? 1 : 0) || a[2] - b[2] || ci(a[0], a[1]) - ci(b[0], b[1]));
      for (const [x, z] of cands) {
        if (got >= need && (k !== 0 || spots0 >= 3)) break;
        if (part.ok && !part.ok(c, x, z)) continue;
        if (!okOutdoorCell(c, part.piece, x, z, planned, solidPlanned)) continue;
        if (got >= need) { spots0++; continue; }
        const r = rotFor(c, part, x, 0, z, anc || nearestOf(c, part, x, z, anchors));
        const rec = specRec(c, part.piece, x, 0, z, r);
        planned.add(`${L}|${x}|0|${z}`); got++;
        if (solidPiece(c, part.piece)) solidPlanned.push(ci(x, z));
        if (k === 0) spots0 = Math.min(3, spots0 + 1);
        recs.push(recEntry(c, part, k, rec));
        if (!anchorRecOf[k]) anchorRecOf[k] = { ...rec, planned: true };
      }
    }
    if (got < need) complete = false;
  }
  if (recs.length > TUNE.WISH_MAX_RECS) { recs.length = TUNE.WISH_MAX_RECS; complete = false; }
  return { parts, recs, complete, spots0: Math.min(3, spots0) };
}

function nearestOf(c, part, x, z, anchors) {
  let best = null, bd = Infinity;
  for (const [ax, az] of anchors) { const d = Math.max(Math.abs(ax - x), Math.abs(az - z)); if (d < bd) { bd = d; best = { x: ax, z: az }; } }
  return best;
}

function existingAnchor(c, part, tpl) {
  // the existing piece a later `near` part anchors on: the one with the most of that part already round it
  const nearPart = tpl.parts.find((p) => p.near !== undefined);
  const pool = part.inside ? c.inn(part.set) : (tpl.where === 'foot' ? within(c.out(part.set), c.FOOT, (tpl.band || [1, 8])[1]) : c.out(part.set));
  const sorted = pool.slice().sort((a, b) => ci(a.x, a.z) - ci(b.x, b.z) || a.y - b.y);
  if (!nearPart) return sorted[0] || null;
  let best = null, bn = -1;
  for (const a of sorted) {
    const n = nearCount(c, nearPart, a, nearPart.set);
    // prefer an anchor that still has room round it
    let room = 0;
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if ((dx || dz) && (part.inside ? c.INSIDE.has(ck(a.x + dx, a.y, a.z + dz)) : c.nav.isFree(a.x + dx, a.z + dz))) room++;
    const s = n * 10 + Math.min(room, 3);
    if (s > bn) { bn = s; best = a; }
  }
  return best;
}

// ---- edges
function edgeSpots(c, part, need, planned) {
  const recs = [];
  if (part.edge === 'window') {
    const main = c.home ? (c.home.doors.find((d) => d.main) || c.home.doors[0]) : null;
    const outDir = main ? (main.out[1] === 1 ? 0 : main.out[0] === 1 ? 1 : main.out[1] === -1 ? 2 : 3) : 0;
    const es = homeEdges(c).filter((e) => e.rec && (e.rec.t === 'wall' || (S.WINDOW.has(e.rec.t) && e.rec.t !== 'wall_window_shutters' && e.rec.t !== 'gable_window')));
    es.sort((a, b) => ((b.d === outDir) - (a.d === outDir)) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    for (const e of es) {
      if (recs.length >= need) break;
      const [, a, xs, ys, zs] = e.key.split('|');
      // shutters face outward: r 0 when the outside is +Z (axis x) / +X (axis z)
      const r = (a === 'x' ? e.d === 0 : e.d === 1) ? 0 : 2;
      const rec = { t: 'wall_window_shutters', a, x: +xs, y: +ys, z: +zs, r };
      if (e.rec.m) rec.m = e.rec.m;
      if (e.rec.c) rec.c = e.rec.c;
      if (e.rec.k) rec.k = e.rec.k;
      if (!c.world.validate(rec).ok) continue;
      recs.push(rec);
    }
    return { recs, count: Math.min(3, es.length) };
  }
  // fence: free level-0 edges on the ring 2–3 round FOOT, the next `need` in a line (back of the house first)
  const foot = c.FOOT;
  if (!foot.length) return { recs, count: 0 };
  const fset = new Set(foot.map(([x, z]) => x * 64 + z));
  const cand = [];
  const seenE = new Set();
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of foot) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  for (let x = x0 - 4; x <= x1 + 4; x++) for (let z = z0 - 4; z <= z1 + 4; z++) {
    for (const a of ['x', 'z']) {
      const key = `W|${a}|${x}|0|${z}`;
      if (seenE.has(key)) continue;
      seenE.add(key);
      const [A, B] = a === 'x' ? [[x, z - 1], [x, z]] : [[x - 1, z], [x, z]];
      if (fset.has(A[0] * 64 + A[1]) || fset.has(B[0] * 64 + B[1])) continue;
      const dA = dist(A[0], A[1], foot), dB = dist(B[0], B[1], foot);
      const m = Math.min(dA, dB);
      if (m < 2 || m > 3 || Math.max(dA, dB) !== m + 1) continue;
      if (c.index.W.has(key) || planned.has(key)) continue;
      const rec = { t: part.piece, a, x, y: 0, z, r: 0 };
      if (!c.world.validate(rec).ok) continue;
      // don't fence across a doorstep's front
      cand.push({ key, a, x, z, rec, side: (a === 'x' ? (z <= z0 ? 0 : 3) : (x <= x0 ? 1 : 2)) });
    }
  }
  cand.sort((p, q) => p.side - q.side || (p.a < q.a ? -1 : p.a > q.a ? 1 : 0) || (p.a === 'x' ? p.z - q.z || p.x - q.x : p.x - q.x || p.z - q.z));
  // the first run of `need` collinear neighbours
  const has = new Set(cand.map((e) => e.key));
  for (const e of cand) {
    const run = [e];
    for (let s = 1; run.length < need; s++) {
      const k2 = e.a === 'x' ? `W|x|${e.x + s}|0|${e.z}` : `W|z|${e.x}|0|${e.z + s}`;
      if (!has.has(k2)) break;
      run.push(cand.find((q) => q.key === k2));
    }
    if (run.length >= need) { for (const r of run) { recs.push(r.rec); planned.add(r.key); } return { recs, count: Math.min(3, cand.length) }; }
  }
  // no straight run: take the first ones
  for (const e of cand) { if (recs.length >= need) break; recs.push(e.rec); planned.add(e.key); }
  return { recs, count: Math.min(3, cand.length) };
}

// ---- chains (paths, porches, docks): free cells along the nav route outward from DOOR1
function placeableF(c, t, x, z, planned) {
  if (!inLot(x, z)) return false;
  const i = ci(x, z);
  if (c.world.det.bOf[i] >= 0) return false;
  if (planned.has(`F|${x}|0|${z}`)) return false;
  const rec = { t, x, y: 0, z, r: 0 };
  return c.world.isFree(rec) && c.world.validate(rec).ok;
}
function chainSpots(c, part, wish, planned) {
  const recs = [];
  const t = part.piece;
  const add = (x, z, r = 0) => { recs.push({ t, x, y: 0, z, r }); planned.add(`F|${x}|0|${z}`); };
  if (part.chain === 'door') {
    // from each DOOR cell (DOOR1 first) toward the lane mouth until the chain has 3 cells
    const doors = [c.DOOR1, ...c.DOOR.filter((d) => d !== c.DOOR1)].filter(Boolean);
    for (const d of doors) {
      const route = (c.nav.path(d, c.nav.laneCell).cells || []).map((i) => [cx(i), cz(i)]);
      const mine = [];
      let n = 0;
      const { comp, size } = pathComps(c);
      if (inNav(d[0], d[1]) && comp[ci(d[0], d[1])] >= 0) n = size[comp[ci(d[0], d[1])]];
      let ok = n >= 3;
      for (const [x, z] of route) {
        if (ok) break;
        if (!inLot(x, z)) break;
        if (PATHY_FK.has(c.index.fk[ci(x, z)])) continue;
        if (!placeableF(c, t, x, z, planned)) break;
        mine.push([x, z]); n++;
        if (n >= 3) ok = true;
      }
      if (ok) { for (const [x, z] of mine) add(x, z); return { recs, ok: true }; }
    }
    return { recs, ok: false };
  }
  if (part.chain === 'porch') {
    const doors = [c.DOOR1, ...c.DOOR.filter((d) => d !== c.DOOR1)].filter(Boolean);
    const dObj = (s) => c.home.doors.find((d) => d.step === s || (d.step[0] === s[0] && d.step[1] === s[1]));
    for (const s of doors) {
      const door = dObj(s);
      const mine = [];
      const isDeck = (x, z) => deckAt(c, x, z) || mine.some(([a, b]) => a === x && b === z);
      if (!isDeck(s[0], s[1])) { if (!placeableF(c, t, s[0], s[1], planned)) continue; mine.push([s[0], s[1]]); }
      const out = door ? door.out : [0, 1];
      const nb = [[s[0] + out[0], s[1] + out[1]], [s[0] + out[1], s[1] + out[0]], [s[0] - out[1], s[1] - out[0]]];
      let n2 = nb.some(([x, z]) => deckAt(c, x, z)) ? 2 : 1;
      for (const [x, z] of nb) {
        if (n2 >= 2) break;
        if (!placeableF(c, t, x, z, planned) || (c.home && c.home.cells.has(ck(x, 0, z)))) continue;
        mine.push([x, z]); n2++;
      }
      if (n2 >= 2) { for (const [x, z] of mine) add(x, z, door ? yaw4(door.out[1], door.out[0]) & 1 : 0); return { recs, ok: true }; }
      for (const m of mine) planned.delete(`F|${m[0]}|0|${m[1]}`);
    }
    return { recs, ok: false };
  }
  // friend / post routes: every route cell that isn't PATHY yet
  const cells = part.chain === 'friend' ? chainRoute(c, wish) : postRoutes(c).cells;
  if (!cells.length) return { recs, ok: false };
  let ok = true;
  for (const [x, z] of cells) {
    if (PATHY_FK.has(c.index.fk[ci(x, z)])) continue;
    if (planned.has(`F|${x}|0|${z}`)) continue;
    if (!placeableF(c, t, x, z, planned)) { ok = false; continue; }
    add(x, z);
  }
  return { recs, ok };
}

// fish dock: deck cells beside the work pond (cellF kind uses the generic outdoor path with layer F)
TEMPLATE.J_fish_dock.parts[0].kind = undefined;

// ============================================================================================== hint plans (§3.7)
/**
 * hintSpots(kind, building, world) → SpotPlan with one part (§3.7): 'door' | 'gaps' | 'roof' | 'bed'.
 * Recs carry the look to copy (m / c / k); roof recs carry h: null (index.js fills it with autoRoofHeight).
 */
export function hintSpots(kind, b, world) {
  const ix = world.index, nav = world.nav;
  const recs = [];
  const lo = b.lo;
  const nearestRec = (list, x, z) => {
    let best = null, bd = Infinity, bk = '';
    for (const p of list) { const d = Math.max(Math.abs(p.x - x), Math.abs(p.z - z)); const k = `${p.x}|${p.y}|${p.z}`; if (d < bd || (d === bd && k < bk)) { bd = d; best = p; bk = k; } }
    return best;
  };
  const ctxLike = { index: ix, nav, world, INSIDE: b.cells, home: b };
  const entry = (rec, piece) => recEntry(ctxLike, { piece }, 0, rec);
  if (kind === 'door') {
    const cand = [];
    for (const k of b.cells) {
      const [x, y, z] = k.split('|').map(Number);
      if (y !== lo) continue;
      for (let d = 0; d < 4; d++) {
        const nx = x + DX[d], nz = z + DZ[d];
        if (b.cells.has(ck(nx, y, nz))) continue;
        const key = edgeKey(x, y, z, DX[d], DZ[d]);
        const w = ix.W.get(key);
        if (!w || w.t !== 'wall') continue;
        if (!nav.inMain(nx, nz) || world.det.bOf[ci(nx, nz)] >= 0) continue;
        cand.push({ key, w, d, nx, nz });
      }
    }
    const pathy = (e) => (S.PATHY.has(ix.F.get(ck(e.nx, 0, e.nz))?.t) ? 1 : 0);
    cand.sort((p, q) => pathy(q) - pathy(p) || ((q.d === 0) - (p.d === 0)) || (p.key < q.key ? -1 : 1));
    const e = cand[0];
    if (e) {
      const [, a, xs, ys, zs] = e.key.split('|');
      const r = (a === 'x' ? e.d === 0 : e.d === 1) ? 0 : 2;
      const k = nearestRec([...SETS.DOORWAY].flatMap((t) => ix.byType.get(t) || []), +xs, +zs)?.k;
      recs.push(entry({ t: 'wall_door', a, x: +xs, y: +ys, z: +zs, r, m: e.w.m, c: e.w.c, ...(k ? { k } : {}) }, 'wall_door'));
    }
    return { parts: [{ piece: 'wall_door', n: 1, have: 0 }], recs, complete: recs.length === 1, spots0: Math.min(3, cand.length) };
  }
  if (kind === 'gaps') {
    const walls = [];
    for (const k of b.cells) {
      const [x, y, z] = k.split('|').map(Number);
      for (let d = 0; d < 4; d++) { const w = ix.W.get(edgeKey(x, y, z, DX[d], DZ[d])); if (w && S.WALLISH.has(w.t)) walls.push(w); }
    }
    for (const g of b.gapEdges || []) {
      const [, a, xs, ys, zs] = g.ek.split('|');
      const near = nearestRec(walls, +xs, +zs);
      const r = (a === 'x' ? g.d === 0 : g.d === 1) ? 0 : 2;
      recs.push(entry({ t: 'wall', a, x: +xs, y: +ys, z: +zs, r, ...(near?.m ? { m: near.m } : {}), ...(near?.c ? { c: near.c } : {}) }, 'wall'));
    }
    return { parts: [{ piece: 'wall', n: recs.length, have: 0 }], recs, complete: recs.length > 0, spots0: Math.min(3, recs.length) };
  }
  if (kind === 'roof') {
    const cells = b.roofHint || b.unroofed;
    const panels = [];
    for (const k of b.cells) { const [x, , z] = k.split('|').map(Number); for (const rf of ix.R.get(x + '|' + z) || []) panels.push({ ...rf.p, x, z }); }
    const allFlat = panels.length > 0 && panels.every((p) => ix.defOf?.(p.t)?.roof?.kind === 'flat');
    for (const k of cells) {
      const [x, y, z] = k.split('|').map(Number);
      const near = nearestRec(panels, x, z);
      const t = !near || allFlat ? 'roof_flat' : near.t;
      const rec = { t, x, y: y + 1, z, r: near ? (near.r | 0) : 0, h: null };
      if (near?.m) rec.m = near.m;
      if (near?.c) rec.c = near.c;
      const e = recEntry(ctxLike, { piece: t }, 0, { ...rec, h: 0 });
      e.rec = rec;
      recs.push(e);
    }
    return { parts: [{ piece: recs[0]?.rec.t || 'roof_flat', n: recs.length, have: 0 }], recs, complete: recs.length > 0, spots0: Math.min(3, recs.length) };
  }
  // bed: the free cell nearest the middle of the lowest level
  const cells = [];
  for (const k of b.cells) { const [x, y, z] = k.split('|').map(Number); if (y === lo) cells.push([x, y, z]); }
  const mx = cells.reduce((a, q) => a + q[0], 0) / Math.max(1, cells.length), mz = cells.reduce((a, q) => a + q[2], 0) / Math.max(1, cells.length);
  cells.sort((p, q) => Math.hypot(p[0] - mx, p[2] - mz) - Math.hypot(q[0] - mx, q[2] - mz) || ci(p[0], p[2]) - ci(q[0], q[2]));
  const bedNear = nearestRec(ix.byType.get('bed') || [], mx, mz);
  for (const [x, y, z] of cells) {
    if (ix.I.has(ck(x, y, z))) continue;
    const rec = { t: 'bed', x, y, z, r: 0 };
    if (world.validate && !world.validate(rec).ok) continue;
    const c2 = { ...ctxLike, INSIDE: b.cells, DOOR1: null };
    rec.r = rotFor(c2, { piece: 'bed', inside: true, face: 'wall' }, x, y, z, null);
    if (bedNear?.m) rec.m = bedNear.m;
    if (bedNear?.c) rec.c = bedNear.c;
    recs.push(entry(rec, 'bed'));
    break;
  }
  return { parts: [{ piece: 'bed', n: 1, have: 0 }], recs, complete: recs.length === 1, spots0: recs.length };
}

/** A plan for a recipe's first missing term near a home (§3.7 vacancy rows; Show me { home, job }). */
export function termSpots(term, b, world, ctxTown = {}) {
  const v = { id: '_', job: null, trait: null, homeId: b.id, cool: {}, recent: [] };
  const c = wishCtx(world, ctxTown, v);
  const tpl = {
    id: '_term', where: term.where === 'door' ? 'door' : term.where === 'inside' ? 'inside' : term.where === 'hive' ? 'hive' : 'foot',
    band: [1, term.R || 3], layer: 'I',
    parts: [{ piece: term.piece, n: Math.max(1, (term.need || 1) - (term.have || 0)), inside: term.where === 'inside', set: ids(term.piece) }],
    have: () => [0],
  };
  // "another home in the meadow": the SMALL_HOME layout on a free 6 × 6 area, as w_neighbour's plan
  if (term.where === 'town') { const area = freeArea(c); return findSpots(TEMPLATE.w_neighbour, c, area ? { frozen: { area } } : null); }
  return findSpots(tpl, c, null);
}

export { packFoot, unpackFoot, HINT_TEXT };
