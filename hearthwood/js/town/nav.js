// Hearthwood — Living Town: nav grid, A*, string pulling, regions (docs/LIVING.md §6, §12.3).
// Pure. 22 × 22 cells on level 0 (the lot plus a 1-cell ring), typed arrays throughout. Every path query succeeds:
// hop edges and walls / blocked cells only cost extra (HOP_COST, SLIP_COST), so nothing can ever trap a villager.

import { CELL } from '../config.js';
import { TUNE, SETS, SOFT, SOFT_GIFT, GIFTS, LANE_CELL } from './data.js';
import { rng, hash32 } from './rng.js';
import { N, O, NN, ci, cx, cz, inNav, EC, FK, ck } from './homes.js';

const DX = [0, 1, 0, -1], DZ = [1, 0, -1, 0];
const SOLID = new Set(SETS.SOLID), FENCE = new Set(SETS.FENCE), PATHY_FK = new Set([FK.path, FK.steps, FK.deck]);
const BLOOMS = new Set(SETS.BLOOM);
const V = 23;                                    // vertex grid −11..11
const vi = (x, z) => (x + 11) * V + (z + 11);

/**
 * Build the nav grid (§6.1). `buildings` is detectBuildings' result (or its buildings array); `tents` are camp
 * tent cells [cx, cz]. Returns the Nav of §12.3 plus: blocked, doorstep (Uint8Array marks), cellsOf(path),
 * reachWithout(i) (lane-reach flood with one more blocked cell, for the §7.5 cut-off check).
 */
export function buildNav(index, buildings, { tents = [] } = {}) {
  const blds = Array.isArray(buildings) ? buildings : (buildings?.buildings || []);
  const cost = new Float32Array(NN), surface = new Float32Array(NN), blocked = new Uint8Array(NN);
  const edge = new Uint8Array(NN * 4), region = new Int16Array(NN).fill(-1), doorstep = new Uint8Array(NN);
  const S = TUNE.SURF;
  for (let i = 0; i < NN; i++) {
    const x = cx(i), z = cz(i);
    const ring = x < -10 || x > 9 || z < -10 || z > 9;
    let c = ring ? TUNE.COST_RING : TUNE.COST_GRASS, s = S.grass;
    switch (index.fk[i]) {
      case FK.path: c = TUNE.COST_PATH; s = S.path; break;
      case FK.deck: c = TUNE.COST_DECK; s = S.deck; break;
      case FK.steps: c = TUNE.COST_STEPS; s = S.steps; break;
      case FK.foundation: case FK.floor: c = TUNE.COST_FOUNDATION; s = S.foundation; break;
      default: break;
    }
    cost[i] = c; surface[i] = s;
    if (index.roofMax[i] >= 0 && index.roofMax[i] <= 1) blocked[i] = 1;            // a roof panel down at the ground
  }
  // indoors is never walked: level-0 cells of every building
  for (const b of blds) for (const k of b.cells) {
    const [x, y, z] = k.split('|');
    if (+y === 0) blocked[ci(+x, +z)] = 1;
  }
  // items at level 0
  for (const p of index.items) {
    if ((p.y | 0) !== 0 || !inNav(p.x, p.z)) continue;
    const i = ci(p.x, p.z);
    const def = index.defOf ? index.defOf(p.t) : null;
    if (def && def.layer === 'D') continue;                                           // rugs: nothing
    const g = GIFTS[p.t];
    if (g) { if (g.walk === 'soft') cost[i] += SOFT_GIFT; else blocked[i] = 1; continue; }
    if (SOFT[p.t] !== undefined) { cost[i] += SOFT[p.t]; continue; }
    if (SOLID.has(p.t) || (def && def.cat === 'interior') || (def && def.cat === 'frame')) blocked[i] = 1;
  }
  for (const t of tents) if (inNav(t[0], t[1])) blocked[ci(t[0], t[1])] = 1;
  // walkers keep a little off flower beds, so feet don't wade through overhanging blooms (once per cell)
  const nb = new Uint8Array(NN);
  for (const p of index.items) {
    if ((p.y | 0) !== 0 || !inNav(p.x, p.z) || !BLOOMS.has(p.t)) continue;
    for (const [dx, dz] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
      const x = p.x + dx, z = p.z + dz;
      if (inNav(x, z) && !nb[ci(x, z)]) { nb[ci(x, z)] = 1; cost[ci(x, z)] += TUNE.COST_NEAR_BLOOM; }
    }
  }
  // doorsteps (for gates)
  const steps = [];
  for (const b of blds) for (const d of b.doors || []) if (inNav(d.step[0], d.step[1])) { doorstep[ci(d.step[0], d.step[1])] = 1; steps.push(d.step); }
  const nearStep = (i) => {
    if (doorstep[i]) return true;
    const x = cx(i), z = cz(i);
    for (let d = 0; d < 4; d++) { const nx = x + DX[d], nz = z + DZ[d]; if (inNav(nx, nz) && doorstep[ci(nx, nz)]) return true; }
    return false;
  };
  const laneI = ci(LANE_CELL[0], LANE_CELL[1]);
  const pathy = (i) => i === laneI || PATHY_FK.has(index.fk[i]);
  // edges at level 0: 0 open (incl. gates), 1 hop, 2 wall
  const vmark = new Uint8Array(V * V);
  for (let i = 0; i < NN; i++) {
    const x = cx(i), z = cz(i);
    for (let d = 0; d < 4; d++) {
      const c = index.ec[i * 4 + d];
      let e = 0;
      if (c === EC.wall) e = 2;
      else if (c === EC.fence || c === EC.half) {
        e = 1;
        if (c === EC.fence) {
          const nx = x + DX[d], nz = z + DZ[d];
          if (inNav(nx, nz)) {
            const j = ci(nx, nz);
            if ((pathy(i) && pathy(j)) || nearStep(i) || nearStep(j)) e = 0;     // a gate
          }
        }
      }
      edge[i * 4 + d] = e;
      if (e) {
        // the two end vertices of this edge block corner cutting (posts and wall ends, §6.1)
        let ax, az, bx, bz;
        if (d === 0) { ax = x; az = z + 1; bx = x + 1; bz = z + 1; }
        else if (d === 2) { ax = x; az = z; bx = x + 1; bz = z; }
        else if (d === 1) { ax = x + 1; az = z; bx = x + 1; bz = z + 1; }
        else { ax = x; az = z; bx = x; bz = z + 1; }
        vmark[vi(ax, az)] = 1; vmark[vi(bx, bz)] = 1;
      }
    }
  }
  for (let k = 0; k < V * V; k++) if (index.post0[k]) vmark[k] = 1;
  // regions: flood over open AND hop edges (§6.1)
  let nreg = 0;
  const q = new Int16Array(NN);
  for (let s = 0; s < NN; s++) {
    if (blocked[s] || region[s] >= 0) continue;
    let n = 0; q[n++] = s; region[s] = nreg;
    for (let h = 0; h < n; h++) {
      const i = q[h], x = cx(i), z = cz(i);
      for (let d = 0; d < 4; d++) {
        if (edge[i * 4 + d] === 2) continue;
        const nx = x + DX[d], nz = z + DZ[d];
        if (!inNav(nx, nz)) continue;
        const j = ci(nx, nz);
        if (blocked[j] || region[j] >= 0) continue;
        region[j] = nreg; q[n++] = j;
      }
    }
    nreg++;
  }
  const mainRegion = region[laneI];
  const baseCost = Float32Array.from(cost);
  for (let i = 0; i < NN; i++) if (blocked[i]) cost[i] = Infinity;          // the contract's cost: Infinity = blocked

  const nav = {
    N, O, cost, baseCost, surface, edge, region, mainRegion, laneCell: [LANE_CELL[0], LANE_CELL[1]], blocked, doorstep, steps,
    regions: nreg, vmark,
    idx: ci,
    isFree: (x, z) => inNav(x, z) && !blocked[ci(x, z)],
    inMain: (x, z) => inNav(x, z) && !blocked[ci(x, z)] && region[ci(x, z)] === mainRegion,
    cellOf: (x, z) => [clampCell(Math.floor(x / CELL)), clampCell(Math.floor(z / CELL))],
    centre: (x, z) => [(x + 0.5) * CELL, inNav(x, z) ? surface[ci(x, z)] : 0, (z + 0.5) * CELL],
    surfaceAt: (x, z) => { const c = Math.floor(x / CELL), d = Math.floor(z / CELL); return inNav(c, d) ? surface[ci(c, d)] : 0; },
    nearestFree: (x, z, maxCells = 3, sameRegion = true) => nearestFree(nav, x, z, maxCells, sameRegion),
    path: (from, to, seed) => findPath(nav, from, to, seed),
    reachWithout: (extra) => reachFrom(nav, laneI, extra),
    stats: { plans: 0, slips: 0 },
  };
  return nav;
}

const clampCell = (c) => Math.max(-O, Math.min(N - O - 1, c));

function nearestFree(nav, x, z, maxCells, sameRegion) {
  x = clampCell(x | 0); z = clampCell(z | 0);
  for (let r = 0; r <= maxCells; r++) {
    let best = null, bd = Infinity, bi = Infinity;
    for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) {
      if (Math.max(Math.abs(a), Math.abs(b)) !== r) continue;
      const nx = x + a, nz = z + b;
      if (!inNav(nx, nz)) continue;
      const i = ci(nx, nz);
      if (nav.blocked[i]) continue;
      if (sameRegion && nav.region[i] !== nav.mainRegion) continue;
      const d = a * a + b * b;
      if (d < bd || (d === bd && i < bi)) { bd = d; bi = i; best = [nx, nz]; }
    }
    if (best) return best;
  }
  return null;
}

function reachFrom(nav, start, extra = -1) {
  const seen = new Uint8Array(NN), q = new Int16Array(NN);
  let n = 0;
  if (extra !== -1 && typeof extra === 'object') {             // several extra blocked cells (array / Set of indices)
    for (const e of extra) seen[e] = 2;
    extra = -1;
  }
  if (nav.blocked[start] || start === extra || seen[start]) return seen;
  q[n++] = start; seen[start] = 1;
  for (let h = 0; h < n; h++) {
    const i = q[h], x = cx(i), z = cz(i);
    for (let d = 0; d < 4; d++) {
      if (nav.edge[i * 4 + d] === 2) continue;
      const nx = x + DX[d], nz = z + DZ[d];
      if (!inNav(nx, nz)) continue;
      const j = ci(nx, nz);
      if (seen[j] || nav.blocked[j] || j === extra) continue;
      seen[j] = 1; q[n++] = j;
    }
  }
  return seen;
}

// ---------------------------------------------------------------------------------------------- A*
const G = new Float32Array(NN), F = new Float32Array(NN), H = new Float32Array(NN);
const CAME = new Int16Array(NN), STATE = new Uint8Array(NN), HEAP = new Int16Array(NN * 4 + 8);
const MOVE = new Uint8Array(NN);                // 0 walk, 1 hop, 2 slip (how the cell was entered)

function less(a, b) {
  if (F[a] !== F[b]) return F[a] < F[b];
  if (H[a] !== H[b]) return H[a] < H[b];
  return a < b;
}

function astar(nav, s, t) {
  STATE.fill(0);
  const tx = cx(t), tz = cz(t), hmin = TUNE.COST_PATH;
  let hn = 0;
  const push = (i) => {
    let k = hn++; HEAP[k] = i;
    while (k > 0) { const p = (k - 1) >> 1; if (!less(HEAP[k], HEAP[p])) break; const tmp = HEAP[k]; HEAP[k] = HEAP[p]; HEAP[p] = tmp; k = p; }
  };
  const pop = () => {
    const top = HEAP[0]; hn--;
    if (hn > 0) {
      HEAP[0] = HEAP[hn];
      let k = 0;
      for (;;) {
        const l = 2 * k + 1, r = l + 1;
        let m = k;
        if (l < hn && less(HEAP[l], HEAP[m])) m = l;
        if (r < hn && less(HEAP[r], HEAP[m])) m = r;
        if (m === k) break;
        const tmp = HEAP[k]; HEAP[k] = HEAP[m]; HEAP[m] = tmp; k = m;
      }
    }
    return top;
  };
  G[s] = 0; H[s] = hmin * (Math.abs(cx(s) - tx) + Math.abs(cz(s) - tz)); F[s] = H[s]; CAME[s] = -1; MOVE[s] = 0;
  STATE[s] = 1; push(s);
  while (hn > 0) {
    const i = pop();
    if (STATE[i] === 2) continue;
    STATE[i] = 2;
    if (i === t) break;
    const x = cx(i), z = cz(i);
    for (let d = 0; d < 4; d++) {
      const nx = x + DX[d], nz = z + DZ[d];
      if (!inNav(nx, nz)) continue;
      const j = ci(nx, nz);
      if (STATE[j] === 2) continue;
      const e = nav.edge[i * 4 + d];
      let c, mv = 0;
      if (nav.blocked[j]) { c = TUNE.COST_GRASS + TUNE.SLIP_COST; mv = 2; } else c = nav.cost[j];
      if (e === 1) { c += TUNE.HOP_COST; if (!mv) mv = 1; } else if (e === 2) { c += TUNE.SLIP_COST; mv = 2; }
      const g = G[i] + c;
      if (STATE[j] === 1 && g >= G[j]) continue;
      G[j] = g; H[j] = hmin * (Math.abs(nx - tx) + Math.abs(nz - tz)); F[j] = g + H[j]; CAME[j] = i; MOVE[j] = mv;
      STATE[j] = 1; push(j);
    }
  }
  const cells = [], moves = [];
  for (let i = t; i >= 0; i = CAME[i]) { cells.push(i); moves.push(MOVE[i]); if (i === s) break; }
  cells.reverse(); moves.reverse();
  return { cells, moves, cost: G[t] };
}

// ---------------------------------------------------------------------------------------------- line of sight
function crossOk(nav, i, j) {
  if (i === j) return true;
  const x0 = cx(i), z0 = cz(i), x1 = cx(j), z1 = cz(j), ddx = x1 - x0, ddz = z1 - z0;
  if (Math.abs(ddx) + Math.abs(ddz) === 1) return nav.edge[i * 4 + (ddz === 1 ? 0 : ddx === 1 ? 1 : ddz === -1 ? 2 : 3)] === 0;
  if (Math.abs(ddx) === 1 && Math.abs(ddz) === 1) {
    const a = ci(x0 + ddx, z0), b = ci(x0, z0 + ddz);
    const dX = ddx === 1 ? 1 : 3, dZ = ddz === 1 ? 0 : 2;
    const viaA = !nav.blocked[a] && nav.edge[i * 4 + dX] === 0 && nav.edge[a * 4 + dZ] === 0;
    const viaB = !nav.blocked[b] && nav.edge[i * 4 + dZ] === 0 && nav.edge[b * 4 + dX] === 0;
    return viaA && viaB;
  }
  return false;
}

function los(nav, ax, az, bx, bz, maxCost) {
  const len = Math.hypot(bx - ax, bz - az);
  const n = Math.max(1, Math.ceil(len / TUNE.LOS_STEP));
  let prev = -1;
  const r2 = TUNE.LOS_VERTEX * TUNE.LOS_VERTEX;
  for (let k = 0; k <= n; k++) {
    const x = ax + (bx - ax) * (k / n), z = az + (bz - az) * (k / n);
    const c = Math.floor(x / CELL), d = Math.floor(z / CELL);
    if (!inNav(c, d)) return false;
    const i = ci(c, d);
    if (nav.blocked[i] || nav.cost[i] > maxCost + 1e-4) return false;
    if (prev >= 0 && !crossOk(nav, prev, i)) return false;
    prev = i;
    // blocking vertices: the 4 corners of this cell
    for (let a = 0; a <= 1; a++) for (let b = 0; b <= 1; b++) {
      const vx = c + a, vz = d + b;
      if (vx < -11 || vx > 11 || vz < -11 || vz > 11 || !nav.vmark[vi(vx, vz)]) continue;
      const ex = x - vx * CELL, ez = z - vz * CELL;
      if (ex * ex + ez * ez < r2) return false;
    }
  }
  return true;
}

/** Path between cells (§6.2): A* → string pulling → seeded lane offsets. Always succeeds. */
function findPath(nav, from, to, seed) {
  const fx = clampCell(from[0] | 0), fz = clampCell(from[1] | 0), tx = clampCell(to[0] | 0), tz = clampCell(to[1] | 0);
  const s = ci(fx, fz), t = ci(tx, tz);
  nav.stats.plans++;
  const { cells, moves } = s === t ? { cells: [s], moves: [0] } : astar(nav, s, t);
  // runs between hop / slip crossings
  const ptsX = [], ptsZ = [], ptsY = [], hops = [], slips = [];
  const centre = (i) => [(cx(i) + 0.5) * CELL, (cz(i) + 0.5) * CELL];
  const r = rng(seed !== undefined ? seed >>> 0 : hash32(s, t, 'lane'));
  const pushPt = (x, z, i) => { ptsX.push(x); ptsZ.push(z); ptsY.push(nav.surface[i]); };
  let runStart = 0;
  const pullRun = (a, b) => {          // cells[a..b] walkable among themselves
    let k = a;
    const [x0, z0] = centre(cells[a]);
    if (!ptsX.length) pushPt(x0, z0, cells[a]);
    while (k < b) {
      let best = k + 1, maxC = Math.max(nav.cost[cells[k]], nav.cost[cells[k + 1]]);
      let mc = maxC;
      for (let m = k + 2; m <= b; m++) {
        mc = Math.max(mc, nav.cost[cells[m]]);
        const [ax, az] = centre(cells[k]), [bx, bz] = centre(cells[m]);
        if (los(nav, ax, az, bx, bz, mc)) best = m;
      }
      const [ax, az] = centre(cells[k]), [bx, bz] = centre(cells[best]);
      // seeded lateral lane offset on runs longer than 3 cells
      const L = Math.hypot(bx - ax, bz - az);
      if (L > 3 * CELL) {
        const o = (r() * 2 - 1) * TUNE.LANE_OFFSET, ux = (bz - az) / L, uz = -(bx - ax) / L;
        const p1 = [ax + (bx - ax) * 0.25 + ux * o, az + (bz - az) * 0.25 + uz * o];
        const p2 = [ax + (bx - ax) * 0.75 + ux * o, az + (bz - az) * 0.75 + uz * o];
        let mcs = 0;
        for (let m = k; m <= best; m++) mcs = Math.max(mcs, nav.cost[cells[m]]);
        if (los(nav, ax, az, p1[0], p1[1], mcs) && los(nav, p1[0], p1[1], p2[0], p2[1], mcs) && los(nav, p2[0], p2[1], bx, bz, mcs)) {
          const i1 = ci(Math.floor(p1[0] / CELL), Math.floor(p1[1] / CELL)), i2 = ci(Math.floor(p2[0] / CELL), Math.floor(p2[1] / CELL));
          pushPt(p1[0], p1[1], i1); pushPt(p2[0], p2[1], i2);
        }
      }
      pushPt(bx, bz, cells[best]);
      k = best;
    }
  };
  for (let k = 1; k < cells.length; k++) {
    if (moves[k] === 0) continue;
    pullRun(runStart, k - 1);
    const [bx, bz] = centre(cells[k]);
    (moves[k] === 1 ? hops : slips).push(ptsX.length - 1);       // segment index: last point → the next one
    pushPt(bx, bz, cells[k]);
    runStart = k;
  }
  pullRun(runStart, cells.length - 1);
  const n = ptsX.length, pts = new Float32Array(n * 3);
  let len = 0;
  for (let k = 0; k < n; k++) {
    pts[k * 3] = ptsX[k]; pts[k * 3 + 1] = ptsY[k]; pts[k * 3 + 2] = ptsZ[k];
    if (k) len += Math.hypot(ptsX[k] - ptsX[k - 1], ptsZ[k] - ptsZ[k - 1]);
  }
  if (slips.length) nav.stats.slips += slips.length;
  return { pts, len, hops, slips, ok: true, cells };
}

/**
 * ASCII map of the nav grid for town.debug.nav() (§12.13): one row per z (−11 at the top), two characters per cell:
 * the cell ('#' blocked, 'D' doorstep, 'T' tent, 'L' lane cell, '.' free, 'o' free but outside mainRegion) and its
 * +X edge ('|' wall, '~' hop, ' ' open).
 */
export function asciiMap(nav, tents = []) {
  const tent = new Set(tents.map(([x, z]) => x * 64 + z));
  const rows = [];
  for (let z = -O; z < N - O; z++) {
    let row = '';
    for (let x = -O; x < N - O; x++) {
      const i = ci(x, z);
      let c = nav.blocked[i] ? '#' : nav.region[i] === nav.mainRegion ? '.' : 'o';
      if (tent.has(x * 64 + z)) c = 'T';
      else if (x === nav.laneCell[0] && z === nav.laneCell[1]) c = 'L';
      else if (nav.doorstep[i]) c = 'D';
      const e = nav.edge[i * 4 + 1];
      row += c + (e === 2 ? '|' : e === 1 ? '~' : ' ');
    }
    rows.push(row);
  }
  return rows.join('\n');
}

/** Grid key helper re-exported for callers that only import nav. */
export { ci, cx, cz, inNav, ck };
