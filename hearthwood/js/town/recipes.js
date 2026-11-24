// Hearthwood — Living Town: recipes, job choice, charm and hangout spots (docs/LIVING.md §2.2, §4.3, §5.5, §9.1).
// Pure. Distances are Chebyshev cell distances (x/z only, any level) as in §2.1.

import { CELL } from '../config.js';
import { TUNE, SETS, JOBS, JOB_ORDER, GIFTS, SPOT_DEFS } from './data.js';
import { ck, ci, inNav, dist, DIR4, NN } from './homes.js';

const BLOOM = new Set(SETS.BLOOM), SETS_ = {};
for (const [k, v] of Object.entries(SETS)) SETS_[k] = new Set(v);
const DECOR_OUT = new Set(SETS.DECOR_OUT), COZY_IN = new Set(SETS.COZY_IN);
const LAMP = new Set(SETS.LAMP), PATHY = new Set(SETS.PATHY);

/** Units an item counts for in a set (the flower cart counts as 2 BLOOM, gifts by their `counts`). */
export function unitsIn(setName, t) {
  const g = GIFTS[t];
  if (g) return g.counts?.[setName] || 0;
  return SETS_[setName]?.has(t) ? 1 : 0;
}

const matches = (term, t) => (term.set ? unitsIn(term.set, t) : t === term.id ? 1 : 0);

/** Records (I layer, any level) that are outdoors: not in any building cell. `inside` = Set of 'x|y|z' building cells. */
function outdoorItems(index, inside) {
  const out = [];
  for (const p of index.items) if (!inside.has(ck(p.x, p.y, p.z))) out.push(p);
  return out;
}

/** All building cells of a WorldModel-ish object: { buildings } → Set. */
export function insideSet(buildings) {
  const s = new Set();
  for (const b of buildings || []) for (const k of b.cells) s.add(k);
  return s;
}

/**
 * evalRecipes(index, home, town) → { fit, met, missing } (§2.2). town = { homes: number, inside?: Set of all building
 * cells }. fit[job] = min over terms of found / need, capped at 2 (0 when a term is unmet); missing[job] lists
 * the unmet terms as { what, have, need, text, piece, where, R }.
 */
export function evalRecipes(index, home, town = {}) {
  const inside = town.inside || home.cells;
  const outs = outdoorItems(index, inside);
  const FOOT = home.foot, DOOR = home.doors.map((d) => d.step);
  const fit = {}, met = [], missing = {}, found = {};
  for (const job of JOB_ORDER) {
    const terms = JOBS[job].terms;
    const counts = [];
    let anchors = null;
    for (let k = 0; k < terms.length; k++) {
      const tm = terms[k];
      let n = 0;
      if (tm.where === 'town') n = town.homes || 0;
      else if (tm.where === 'inside') { for (const p of index.items) if (home.cells.has(ck(p.x, p.y, p.z))) n += matches(tm, p.t); }
      else if (tm.where === 'hive') {
        // the best hive of term `of` (most blooms within R of it)
        let best = 0;
        for (const h of anchors || []) {
          let c = 0;
          for (const p of outs) { const u = matches(tm, p.t); if (u && Math.max(Math.abs(p.x - h.x), Math.abs(p.z - h.z)) <= tm.R) c += u; }
          if (c > best) best = c;
        }
        n = best;
      } else {
        const cells = tm.where === 'door' ? DOOR : FOOT;
        const hits = [];
        for (const p of outs) { const u = matches(tm, p.t); if (u && dist(p.x, p.z, cells) <= tm.R) { n += u; hits.push(p); } }
        if (k === 0 || tm.id === 'beehive') anchors = hits;
      }
      counts.push(n);
    }
    found[job] = counts;
    let f = Infinity;
    const miss = [];
    terms.forEach((tm, k) => {
      f = Math.min(f, counts[k] / tm.need);
      if (counts[k] < tm.need) miss.push({ what: tm.set || tm.id || tm.what, have: counts[k], need: tm.need, text: tm.text, piece: tm.piece, where: tm.where, R: tm.R, term: k });
    });
    const ok = f >= 1;
    fit[job] = ok ? Math.min(2, f) : 0;
    if (ok) met.push(job);
    missing[job] = miss;
  }
  return { fit, met, missing, found };
}

/**
 * chooseJob(evals, jobCounts, first) → { job, runnersUp } (§4.3). Score = 100·[no villager of this job yet] −
 * 10·(villagers of this job) + 10·fit, ties in JOB_ORDER. First friend (roster empty, no recipe met): the job with the
 * fewest missing items, counted per unmet term ("features", as the §3.2 / B2 numbers need), ties in JOB_ORDER.
 */
export function chooseJob(evals, jobCounts = {}, first = false) {
  const score = (j) => 100 * ((jobCounts[j] || 0) === 0 ? 1 : 0) - 10 * (jobCounts[j] || 0) + 10 * (evals.fit[j] || 0);
  const cand = JOB_ORDER.filter((j) => evals.met.includes(j));
  cand.sort((a, b) => score(b) - score(a) || JOB_ORDER.indexOf(a) - JOB_ORDER.indexOf(b));
  if (cand.length) return { job: cand[0], runnersUp: cand.slice(1) };
  if (!first) return { job: null, runnersUp: [] };
  return { job: closestJobs(evals)[0], runnersUp: [], firstFriend: true };
}

/** Jobs ordered by fewest missing features (unmet terms), then JOB_ORDER (the vacancy card's "3 closest"). */
export function closestJobs(evals, units = false) {
  const m = (j) => (evals.missing[j] || []).length;
  const u = (j) => (evals.missing[j] || []).reduce((a, t) => a + Math.max(0, t.need - t.have), 0);
  return JOB_ORDER.slice().sort((a, b) => m(a) - m(b) || (units ? u(a) - u(b) : 0) || JOB_ORDER.indexOf(a) - JOB_ORDER.indexOf(b));
}

/**
 * Kinds of decor a home has (§9.1): distinct DECOR_OUT ids within d ≤ 3 of FOOT (outdoors, any level; edge pieces
 * by the nearer of their two cells) + distinct COZY_IN ids INSIDE; every gift counts as 2 kinds. `inside` (all
 * building cells) decides what is outdoors; defaults to the home's own cells. The town's charm is
 * CHARM_MAX · (1 − e^(−S / CHARM_SCALE)) over the sum S of this for every lived-in home (sim).
 */
export function charmOf(index, home, inside = home.cells) {
  const kinds = new Set();
  let gifts = 0;
  const FOOT = home.foot;
  const isIn = (t) => {
    if (t === 'bed') return false;
    if (COZY_IN.has(t)) return true;
    const def = index.defOf ? index.defOf(t) : null;
    return !!def && (def.cat === 'interior' || t === 'chimney');
  };
  for (const p of index.items) {
    const k = ck(p.x, p.y, p.z);
    if (home.cells.has(k)) { if (GIFTS[p.t]) { if (!kinds.has(p.t)) gifts++; kinds.add(p.t); } else if (isIn(p.t)) kinds.add(p.t); continue; }
    if (inside.has(k)) continue;
    if (!(DECOR_OUT.has(p.t) || GIFTS[p.t])) continue;
    if (dist(p.x, p.z, FOOT) > 3) continue;
    if (GIFTS[p.t] && !kinds.has(p.t)) gifts++;
    kinds.add(p.t);
  }
  for (const [k, p] of index.F) if (PATHY.has(p.t) && p.t !== 'steps' && !inside.has(k) && dist(p.x, p.z, FOOT) <= 3) kinds.add(p.t);
  for (const p of index.W.values()) {
    if (!DECOR_OUT.has(p.t)) continue;
    const a = p.a === 'x' ? [[p.x, p.z - 1], [p.x, p.z]] : [[p.x - 1, p.z], [p.x, p.z]];
    if (Math.min(dist(a[0][0], a[0][1], FOOT), dist(a[1][0], a[1][1], FOOT)) <= 3) kinds.add(p.t);
  }
  return kinds.size + gifts * (TUNE.GIFT_COUNT_AS - 1);
}

/** Town charm from the sum of kinds (§9.1). */
export const charmFromKinds = (S) => TUNE.CHARM_MAX * (1 - Math.exp(-S / TUNE.CHARM_SCALE));

// ---------------------------------------------------------------------------------------------- hangouts (§5.5)
const yawOf = (r) => ((r & 3) * Math.PI) / 2;
const wrapYaw = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a <= -Math.PI) a += 2 * Math.PI; return a; };
/** World position of a local offset (lx, lz) in cell (x, z) with rotation r. */
export function localToWorld(x, z, r, lx, lz) {
  const f = DIR4[r & 3], s = DIR4[(r + 1) & 3];
  return [(x + 0.5) * CELL + lx * s[0] + lz * f[0], (z + 0.5) * CELL + lx * s[1] + lz * f[1]];
}
const faceTo = (fx, fz, tx, tz) => Math.atan2(tx - fx, tz - fz);

/**
 * findHangouts(index, nav, det) → { spots, hangouts } (§5.5, §12.3 Spot). `det` is detectBuildings' result (or the
 * buildings array). Seats and standing spots on level 0 outdoors whose approach cell is in mainRegion; porches
 * (deck / veranda cells beside a doorstep, ≤ 2 per home); plaza blocks of 2 × 2 free path cells; one doorstep spot
 * per home (fallback). hangouts: [{ id, piece, cell, spots, lamps, fire, blooms, tea, plaza }].
 */
export function findHangouts(index, nav, det) {
  const buildings = Array.isArray(det) ? det : (det?.buildings || []);
  const verandas = Array.isArray(det) ? [] : (det?.verandas || []);
  const inside = insideSet(buildings);
  const spots = [], hangouts = [];
  const items = index.items;
  const lampCells = [], bloomCells = [];
  for (const p of items) {
    if (inside.has(ck(p.x, p.y, p.z))) continue;
    if (LAMP.has(p.t) || GIFTS[p.t]?.counts?.LAMP) lampCells.push([p.x, p.z]);
    const u = unitsIn('BLOOM', p.t);
    if (u) bloomCells.push([p.x, p.z, u]);
  }
  const countNear = (list, x, z, R) => { let n = 0; for (const c of list) if (Math.max(Math.abs(c[0] - x), Math.abs(c[1] - z)) <= R) n += c[2] || 1; return n; };
  const free = (x, z) => nav.inMain(x, z);
  const approachFor = (x, z, r, mode) => {
    if (mode === 'front') { const f = DIR4[r & 3]; if (free(x + f[0], z + f[1])) return [x + f[0], z + f[1]]; }
    let best = null;
    for (let d = 0; d < 4; d++) { const a = x + DIR4[d][0], b = z + DIR4[d][1]; if (free(a, b) && nav.edge[ci(x, z) * 4 + d] !== 2) { best = [a, b]; break; } }
    return best;
  };
  for (const p of items) {
    if ((p.y | 0) !== 0 || !inNav(p.x, p.z)) continue;
    const sd = SPOT_DEFS[p.t];
    if (!sd) continue;
    if (inside.has(ck(p.x, 0, p.z))) continue;
    const r = (p.r | 0) & 3, key = `I|${p.x}|0|${p.z}`;
    const surf = nav.surface[ci(p.x, p.z)];
    const hangId = sd.hangout ? key : null;
    const hs = [];
    let n = 0;
    for (const s of sd.seats || []) {
      const ap = approachFor(p.x, p.z, r, sd.approach);
      if (!ap) continue;
      const [wx, wz] = localToWorld(p.x, p.z, r, s[0], s[2]);
      const spot = { id: `${key}#${n++}`, kind: 'seat', piece: p.t, cell: [p.x, p.z], at: [wx, surf + s[1], wz],
        face: wrapYaw(yawOf(r) + s[3]), pose: sd.pose || 'sit', approach: ap, hangout: hangId, level: 0, ground: [wx, surf, wz] };
      spots.push(spot); hs.push(spot);
    }
    if (sd.stand) {
      let k = 0;
      for (let d = 0; d < 4 && k < sd.stand; d++) {
        const a = p.x + DIR4[d][0], b = p.z + DIR4[d][1];
        if (!free(a, b)) continue;
        const [cxw, czw] = [(a + 0.5) * CELL, (b + 0.5) * CELL];
        const tx = (p.x + 0.5) * CELL, tz = (p.z + 0.5) * CELL;
        // stand 0.6 m from the piece's cell edge, facing it
        const sx = cxw - DIR4[d][0] * 0.4, sz = czw - DIR4[d][1] * 0.4;
        const spot = { id: `${key}#${n++}`, kind: 'stand', piece: p.t, cell: [a, b], at: [sx, nav.surface[ci(a, b)], sz],
          face: faceTo(sx, sz, tx, tz), pose: sd.fire ? 'warm' : 'stand', approach: [a, b], hangout: hangId, level: 0 };
        spots.push(spot); hs.push(spot); k++;
      }
    }
    if (hangId && hs.length) {
      hangouts.push({ id: hangId, piece: p.t, cell: [p.x, p.z], spots: hs, lamps: countNear(lampCells, p.x, p.z, 2),
        fire: !!sd.fire, blooms: countNear(bloomCells, p.x, p.z, 2), tea: !!sd.tea, plaza: false });
    }
  }
  // porches: deck and veranda cells next to a doorstep, ≤ 2 per home
  const verandaCell = new Set();
  for (const v of verandas) if (v.y === 0) for (const [x, z] of v.cells) verandaCell.add(x * 64 + z);
  const usedPorch = new Set();
  for (const b of buildings) {
    if (!b.home) continue;
    let k = 0;
    for (const d of b.doors) {
      const [sx, sz] = d.step;
      const cand = [[sx, sz], ...DIR4.map(([a, c]) => [sx + a, sz + c])];
      for (const [x, z] of cand) {
        if (k >= TUNE.PORCH_MAX) break;
        if (!inNav(x, z) || !free(x, z) || usedPorch.has(x * 64 + z)) continue;
        const f = index.F.get(ck(x, 0, z));
        if (!((f && f.t === 'deck') || verandaCell.has(x * 64 + z))) continue;
        if (x === sx && z === sz && b.doors.length === 1) continue;           // keep the doorstep itself clear
        usedPorch.add(x * 64 + z);
        const [wx, , wz] = nav.centre(x, z);
        spots.push({ id: `porch|${x}|${z}#0`, kind: 'porch', piece: 'deck', cell: [x, z], at: [wx, nav.surface[ci(x, z)], wz],
          face: Math.atan2(d.out[0], d.out[1]), pose: 'stand', approach: [x, z], hangout: null, level: 0, home: b.id });
        k++;
      }
    }
  }
  // plaza: path cells tiled into non-overlapping 2 × 2 blocks (index order)
  const taken = new Uint8Array(NN);
  const isFreePath = (x, z) => inNav(x, z) && free(x, z) && index.F.get(ck(x, 0, z))?.t === 'path' && !taken[ci(x, z)];
  for (let i = 0; i < NN; i++) {
    const x = ((i / 22) | 0) - 11, z = (i % 22) - 11;
    if (!isFreePath(x, z) || !isFreePath(x + 1, z) || !isFreePath(x, z + 1) || !isFreePath(x + 1, z + 1)) continue;
    const cells = [[x, z], [x + 1, z], [x, z + 1], [x + 1, z + 1]];
    for (const [a, b] of cells) taken[ci(a, b)] = 1;
    const ccx = (x + 1) * CELL, ccz = (z + 1) * CELL, id = `plaza|${x}|${z}`;
    const hs = cells.map(([a, b], k) => {
      const [wx, , wz] = nav.centre(a, b);
      const px = wx + (ccx - wx) * 0.4, pz = wz + (ccz - wz) * 0.4;
      return { id: `${id}#${k}`, kind: 'plaza', piece: 'path', cell: [a, b], at: [px, nav.surface[ci(a, b)], pz],
        face: faceTo(px, pz, ccx, ccz), pose: 'stand', approach: [a, b], hangout: id, level: 0 };
    });
    spots.push(...hs);
    hangouts.push({ id, piece: 'path', cell: [x, z], spots: hs, lamps: countNear(lampCells, x, z, 2), fire: false,
      blooms: countNear(bloomCells, x, z, 2), tea: false, plaza: true });
  }
  // own doorstep (fallback), one per home
  for (const b of buildings) {
    if (!b.home) continue;
    const d = b.doors.find((e) => e.main) || b.doors[0];
    if (!d) continue;
    const [x, z] = d.step;
    if (!inNav(x, z)) continue;
    const at = doorStandPoint(d, nav);
    spots.push({ id: `door|${b.id}#0`, kind: 'door', piece: null, cell: [x, z], at, face: Math.atan2(d.out[0], d.out[1]),
      pose: 'stand', approach: [x, z], hangout: null, level: 0, home: b.id });
  }
  return { spots, hangouts };
}

/** The point a villager stands on before going through a door: 0.6 m out from the door edge (§6.4). */
export function doorStandPoint(d, nav) {
  const [x, z] = d.step;
  const ex = (d.cell[0] + 0.5) * CELL + d.out[0] * CELL / 2, ez = (d.cell[1] + 0.5) * CELL + d.out[1] * CELL / 2;
  return [ex + d.out[0] * 0.6, nav && inNav(x, z) ? nav.surface[ci(x, z)] : 0, ez + d.out[1] * 0.6];
}
