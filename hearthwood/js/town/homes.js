// Hearthwood — Living Town: world index, buildings and homes (docs/LIVING.md §3, §12.3, §12.4).
// Pure: reads world records only (no three, no DOM). The rule of §3.1 runs on typed arrays over the 22 × 22 nav area
// (cells −11..10, levels 0..MAX_LEVEL), so a recompute stays well under a millisecond on a blueprint lot.

import { MAX_LEVEL, levelY } from '../config.js';
import { TUNE, SETS } from './data.js';

// ---------------------------------------------------------------------------------------------- grid helpers
export const N = 22, O = 11, NN = N * N, LV = MAX_LEVEL + 1;
const DX = [0, 1, 0, -1], DZ = [1, 0, -1, 0];                  // dir 0 +Z, 1 +X, 2 −Z, 3 −X (§12.3)
export const DIR4 = [[0, 1], [1, 0], [0, -1], [-1, 0]];
export const ci = (x, z) => (x + O) * N + (z + O);
export const cx = (i) => ((i / N) | 0) - O;
export const cz = (i) => (i % N) - O;
export const inNav = (x, z) => x >= -O && x < N - O && z >= -O && z < N - O;
export const inLot = (x, z) => x >= -10 && x <= 9 && z >= -10 && z <= 9;
export const ck = (x, y, z) => `${x}|${y}|${z}`;
export const dirOf = (dx, dz) => (dz === 1 ? 0 : dx === 1 ? 1 : dz === -1 ? 2 : 3);

/** The W slot key of the edge between (x, y, z) and (x + dx, y, z + dz). */
export function edgeKey(x, y, z, dx, dz) {
  if (dx === 1) return `W|z|${x + 1}|${y}|${z}`;
  if (dx === -1) return `W|z|${x}|${y}|${z}`;
  if (dz === 1) return `W|x|${x}|${y}|${z + 1}`;
  return `W|x|${x}|${y}|${z}`;
}

// F kinds
export const FK = { none: 0, foundation: 1, floor: 2, deck: 3, path: 4, steps: 5, pergola: 6, other: 7 };
const FK_OF = { foundation: 1, floor: 2, deck: 3, path: 4, steps: 5, pergola: 6 };
// edge classes (index.ec): 0 empty, 1 wall (WALLISH), 2 door (DOORWAY), 3 fence, 4 half wall / railing, 5 other
export const EC = { none: 0, wall: 1, door: 2, fence: 3, half: 4, other: 5 };

const WALLISH = new Set(SETS.WALLISH), DOORWAY = new Set(SETS.DOORWAY), FENCE = new Set(SETS.FENCE);
const HOPWALL = new Set(SETS.HOPWALL), WINDOW = new Set(SETS.WINDOW), PATHY = new Set(SETS.PATHY);
const edgeClassOf = (t) => (WALLISH.has(t) ? 1 : DOORWAY.has(t) ? 2 : FENCE.has(t) ? 3 : HOPWALL.has(t) ? 4 : 5);

// ---------------------------------------------------------------------------------------------- index
/**
 * Index the world (§12.3). `entries` is world.entries (Map key → { p, def }) or any iterable of records / entries;
 * `defOf(id)` gives a catalog def. Besides the contract's maps it carries typed accelerators:
 *   fk: Uint8Array(LV·NN) F kind per level/cell · ec: Uint8Array(LV·NN·4) edge class per level/cell/dir
 *   roofMax: Int16Array(NN) highest roof hs per column (−1 none) · low: Uint8Array(LV·NN) low-roof dir bits
 *   post0: Uint8Array(23·23) posts at level 0 · items: I and D records · lot: records outside the nav area
 */
export function indexWorld(entries, defOf, version = 0) {
  const F = new Map(), I = new Map(), D = new Map(), P = new Set(), W = new Map(), R = new Map(), byType = new Map();
  const fk = new Uint8Array(LV * NN), ec = new Uint8Array(LV * NN * 4), roofMax = new Int16Array(NN).fill(-1);
  const low = new Uint8Array(LV * NN), post0 = new Uint8Array(23 * 23);
  const items = [];
  const src = entries && typeof entries.values === 'function' && !Array.isArray(entries) ? entries.values() : (entries || []);
  for (const e of src) {
    const p = e && e.p ? e.p : e;
    if (!p || typeof p.t !== 'string') continue;
    const def = (e && e.def) || (defOf && defOf(p.t));
    if (!def) continue;
    let list = byType.get(p.t);
    if (!list) byType.set(p.t, (list = []));
    list.push(p);
    const y = p.y | 0;
    switch (def.layer) {
      case 'F': {
        const k = ck(p.x, y, p.z);
        F.set(k, p);
        if (inNav(p.x, p.z) && y >= 0 && y < LV) fk[y * NN + ci(p.x, p.z)] = FK_OF[p.t] || FK.other;
        break;
      }
      case 'I': I.set(ck(p.x, y, p.z), p); items.push(p); break;
      case 'D': D.set(ck(p.x, y, p.z), p); items.push(p); break;
      case 'P': {
        P.add(ck(p.x, y, p.z));
        if (y === 0 && p.x >= -11 && p.x <= 11 && p.z >= -11 && p.z <= 11) post0[(p.x + 11) * 23 + (p.z + 11)] = 1;
        break;
      }
      case 'W': {
        const key = `W|${p.a}|${p.x}|${y}|${p.z}`;
        W.set(key, p);
        if (y < 0 || y >= LV) break;
        const c = edgeClassOf(p.t);
        // axis 'x' at (x, z): between (x, z − 1) [its +Z side] and (x, z) [its −Z side]
        // axis 'z' at (x, z): between (x − 1, z) [its +X side] and (x, z) [its −X side]
        let ax, az, bx = p.x, bz = p.z, da, db;
        if (p.a === 'z') { ax = p.x - 1; az = p.z; da = 1; db = 3; } else { ax = p.x; az = p.z - 1; da = 0; db = 2; }
        if (inNav(ax, az)) ec[(y * NN + ci(ax, az)) * 4 + da] = c;
        if (inNav(bx, bz)) ec[(y * NN + ci(bx, bz)) * 4 + db] = c;
        break;
      }
      case 'R': {
        const hs = 2 * y + (p.h | 0), r = (p.r | 0) & 3, kind = def.roof?.kind || 'flat', rise = def.roof?.rise || 0;
        const k = p.x + '|' + p.z;
        let col = R.get(k);
        if (!col) R.set(k, (col = []));
        col.push({ hs, r, kind, rise, t: p.t, m: p.m, p });
        if (!inNav(p.x, p.z)) break;
        const i = ci(p.x, p.z);
        if (hs > roofMax[i]) roofMax[i] = hs;
        // low side bits: a slope's downhill side is local −Z = −DIRS[r] (dir r + 2); a corner is low on −Z and −X
        let bits = 0;
        if (kind === 'slope') bits = 1 << ((r + 2) & 3);
        else if (kind === 'corner') bits = (1 << ((r + 2) & 3)) | (1 << ((r + 3) & 3));
        if (bits) for (let yy = Math.max(0, Math.ceil((hs - 1) / 2)); yy < LV; yy++) low[yy * NN + i] |= bits;
        break;
      }
      default: break;   // B (beams): not used by the town
    }
  }
  return { version, defOf, F, I, D, P, W, R, byType, edgeKey, fk, ec, roofMax, low, post0, items };
}

// ---------------------------------------------------------------------------------------------- detection (§3.1)
const roofedAt = (ix, y, i) => {
  if (y + 1 < LV) { const a = ix.fk[(y + 1) * NN + i]; if (a === FK.floor || a === FK.deck) return true; }
  return ix.roofMax[i] >= 2 * y;
};
const ecAt = (ix, y, i, d) => ix.ec[(y * NN + i) * 4 + d];
const isLowAt = (ix, y, i, d) => (ix.low[y * NN + i] >> d) & 1;

function tallGable(ix, x, y, z, d) {
  for (let yy = y - 1; yy >= 0; yy--) {
    const g = ix.W.get(edgeKey(x, yy, z, DX[d], DZ[d]));
    if (g && (g.t === 'gable' || g.t === 'gable_window') && ((g.h | 0) + (g.s | 0)) >= 2 * (y - yy) + 1) return true;
  }
  return false;
}

/**
 * Step 1(a), open doorways (T1.1): an unsealed level-0 edge that is the only way from the ring into an enclosure of
 * ≤ POCKET_MAX lot cells (a bridge of the lot graph over unsealed edges, the ring merged into one root) counts as
 * sealed for the pocket flood, so walls on grass with an open doorway still enclose their unroofed cells. The cells
 * behind such a bridge are cleared from `seen`; the pocket grouping then runs as before. Iterative Tarjan, O(cells).
 */
const B_ROOT = NN;
const bDisc = new Int16Array(NN + 1), bLow = new Int16Array(NN + 1), bPre = new Int16Array(NN + 1);
const bPar = new Int16Array(NN + 1), bIt = new Int16Array(NN + 1), bSkip = new Uint8Array(NN + 1);
const bStack = new Int16Array(NN + 2), bAdj = new Int16Array(NN * 4), bRoot = new Int16Array(NN * 2);
function unseeBridged(sealed0, seen) {
  let rootN = 0;
  bAdj.fill(-1);
  for (let i = 0; i < NN; i++) {
    const x = cx(i), z = cz(i), lot = inLot(x, z);
    for (let d = 0; d < 4; d++) {
      const nx = x + DX[d], nz = z + DZ[d];
      if (!inNav(nx, nz)) continue;
      const nLot = inLot(nx, nz);
      if (!lot && !nLot) continue;
      if (sealed0(i, d)) continue;
      if (lot) bAdj[i * 4 + d] = nLot ? ci(nx, nz) : B_ROOT;
      else bRoot[rootN++] = ci(nx, nz);
    }
  }
  bDisc.fill(-1); bSkip.fill(0); bIt.fill(0);
  let time = 0, sp = 0;
  bDisc[B_ROOT] = bLow[B_ROOT] = time; bPre[time++] = B_ROOT; bPar[B_ROOT] = -1; bStack[sp++] = B_ROOT;
  while (sp) {
    const v = bStack[sp - 1];
    const deg = v === B_ROOT ? rootN : 4;
    if (bIt[v] < deg) {
      const w = v === B_ROOT ? bRoot[bIt[v]] : bAdj[v * 4 + bIt[v]];
      bIt[v]++;
      if (w < 0) continue;
      if (w === bPar[v] && !bSkip[v]) { bSkip[v] = 1; continue; }     // the tree edge (a parallel one is a back edge)
      if (bDisc[w] < 0) { bDisc[w] = bLow[w] = time; bPre[time++] = w; bPar[w] = v; bStack[sp++] = w; }
      else if (bDisc[w] < bLow[v]) bLow[v] = bDisc[w];
      continue;
    }
    sp--;
    const p = bPar[v];
    if (p < 0) continue;
    if (bLow[v] < bLow[p]) bLow[p] = bLow[v];
    const size = time - bDisc[v];                                       // the subtree is contiguous in pre-order
    if (bLow[v] > bDisc[p] && size <= TUNE.POCKET_MAX) for (let t = bDisc[v]; t < time; t++) seen[bPre[t]] = 0;
  }
}

/**
 * Buildings, homes, shells and verandas (§3.1). Returns { buildings, shells, verandas } as in §12.3, plus
 * `roomOf` (Int32Array(LV·NN) room id or −1), `rooms` and `bOf` (Int32Array(LV·NN) building index or −1) for nav,
 * recipes and the spot finder.
 */
export function detectBuildings(ix) {
  const fk = ix.fk;
  const floor = new Uint8Array(LV * NN);        // 1 foundation/floor, 2 ground floor (step 1)
  for (let L = 0; L < LV * NN; L++) if (fk[L] === FK.foundation || fk[L] === FK.floor) floor[L] = 1;
  // ---- step 1: ground floors at level 0
  const sealed0 = (i, d) => {
    if (ix.ec[i * 4 + d] === EC.wall || ix.ec[i * 4 + d] === EC.door) return true;
    if ((ix.low[i] >> d) & 1) return true;
    const x = cx(i) + DX[d], z = cz(i) + DZ[d];
    return inNav(x, z) && ((ix.low[ci(x, z)] >> ((d + 2) & 3)) & 1) === 1;
  };
  const seen = new Uint8Array(NN), q = new Int16Array(NN);
  let qh = 0, qt = 0;
  for (let i = 0; i < NN; i++) if (!inLot(cx(i), cz(i))) { seen[i] = 1; q[qt++] = i; }
  while (qh < qt) {
    const i = q[qh++], x = cx(i), z = cz(i);
    for (let d = 0; d < 4; d++) {
      const nx = x + DX[d], nz = z + DZ[d];
      if (!inLot(nx, nz)) continue;
      const j = ci(nx, nz);
      if (seen[j] || sealed0(i, d)) continue;
      seen[j] = 1; q[qt++] = j;
    }
  }
  unseeBridged(sealed0, seen);
  const virt = new Uint8Array(NN), mark = new Uint8Array(NN), comp = new Int16Array(NN);
  const grow = (start, ok) => {      // component across unsealed edges among lot cells passing ok → length in comp
    let n = 0; comp[n++] = start; mark[start] = 1;
    for (let h = 0; h < n; h++) {
      const i = comp[h], x = cx(i), z = cz(i);
      for (let d = 0; d < 4; d++) {
        const nx = x + DX[d], nz = z + DZ[d];
        if (!inLot(nx, nz)) continue;
        const j = ci(nx, nz);
        if (mark[j] || !ok(j) || sealed0(i, d)) continue;
        mark[j] = 1; comp[n++] = j;
      }
    }
    return n;
  };
  // (a) pockets
  for (let i = 0; i < NN; i++) {
    if (seen[i] || mark[i] || floor[i] || !inLot(cx(i), cz(i))) continue;
    const n = grow(i, (j) => !seen[j] && !floor[j]);
    if (n <= TUNE.POCKET_MAX) for (let k = 0; k < n; k++) virt[comp[k]] = 1;
  }
  // (b) roofed groups leaning on a wall or door
  mark.fill(0);
  for (let i = 0; i < NN; i++) {
    if (mark[i] || floor[i] || !inLot(cx(i), cz(i)) || !roofedAt(ix, 0, i)) continue;
    const n = grow(i, (j) => !floor[j] && roofedAt(ix, 0, j));
    if (n > TUNE.POCKET_MAX) continue;
    let touches = false;
    for (let k = 0; k < n && !touches; k++) for (let d = 0; d < 4; d++) {
      const c = ix.ec[comp[k] * 4 + d];
      if (c === EC.wall || c === EC.door) { touches = true; break; }
    }
    if (touches) for (let k = 0; k < n; k++) virt[comp[k]] = 1;
  }
  for (let i = 0; i < NN; i++) if (virt[i] && !floor[i]) floor[i] = 2;

  // ---- step 3: rooms
  const roomOf = new Int32Array(LV * NN).fill(-1);
  const rooms = [];
  const rq = new Int16Array(NN);
  for (let y = 0; y < LV; y++) {
    for (let i0 = 0; i0 < NN; i0++) {
      const L0 = y * NN + i0;
      if (!floor[L0] || roomOf[L0] >= 0) continue;
      const room = { id: rooms.length, y, cells: [], roofed: 0, beds: 0, covered: false, covered0: false, veranda: false, ownDoor: false };
      rooms.push(room);
      roomOf[L0] = room.id;
      let n = 0; rq[n++] = i0;
      for (let h = 0; h < n; h++) {
        const i = rq[h], x = cx(i), z = cz(i);
        room.cells.push(i);
        if (roofedAt(ix, y, i)) room.roofed++;
        for (let d = 0; d < 4; d++) {
          const nx = x + DX[d], nz = z + DZ[d];
          if (!inNav(nx, nz)) continue;
          const j = ci(nx, nz), Lj = y * NN + j;
          if (!floor[Lj] || roomOf[Lj] >= 0) continue;
          const c = ecAt(ix, y, i, d);
          if (c === EC.wall || c === EC.door) continue;
          roomOf[Lj] = room.id; rq[n++] = j;
        }
      }
      room.covered = room.covered0 = room.roofed * 2 >= room.cells.length;
    }
  }
  const beds = ix.byType.get('bed') || [];
  for (const p of beds) {
    if (!inNav(p.x, p.z) || p.y < 0 || p.y >= LV) continue;
    const r = roomOf[p.y * NN + ci(p.x, p.z)];
    if (r >= 0) rooms[r].beds++;
  }
  const covered0At = (y, i) => { const r = roomOf[y * NN + i]; return r >= 0 && rooms[r].covered0; };
  const closedEdge = (y, i, d) => {
    if (isLowAt(ix, y, i, d)) return true;
    const x = cx(i), z = cz(i), nx = x + DX[d], nz = z + DZ[d];
    if (y > 0 && inNav(nx, nz)) {
      const j = ci(nx, nz);
      if (!floor[y * NN + j] && covered0At(y - 1, j)) return true;
    }
    return tallGable(ix, x, y, z, d);
  };
  // ---- step 6: verandas
  for (const r of rooms) {
    if (!r.covered0 || r.beds) continue;
    let open = 0, shut = 0, ownDoor = false;
    for (const i of r.cells) {
      const x = cx(i), z = cz(i);
      for (let d = 0; d < 4; d++) {
        const nx = x + DX[d], nz = z + DZ[d];
        const j = inNav(nx, nz) ? ci(nx, nz) : -1;
        if (j >= 0 && roomOf[r.y * NN + j] === r.id) continue;
        const c = ecAt(ix, r.y, i, d);
        if (c === EC.door) { shut++; if (j < 0 || !covered0At(r.y, j)) ownDoor = true; }
        else if (c === EC.wall || closedEdge(r.y, i, d)) shut++;
        else open++;
      }
    }
    if (open >= shut || (open >= 2 && !ownDoor)) { r.veranda = true; r.covered = false; }
  }
  const coveredAt = (y, i) => { if (y < 0 || y >= LV) return false; const r = roomOf[y * NN + i]; return r >= 0 && rooms[r].covered; };
  // ---- step 7: own doors
  for (const r of rooms) {
    if (!r.covered) continue;
    for (const i of r.cells) {
      const x = cx(i), z = cz(i);
      for (let d = 0; d < 4; d++) {
        if (ecAt(ix, r.y, i, d) !== EC.door) continue;
        const nx = x + DX[d], nz = z + DZ[d];
        if (!inNav(nx, nz) || !coveredAt(r.y, ci(nx, nz))) { r.ownDoor = true; break; }
      }
      if (r.ownDoor) break;
    }
  }
  // ---- step 8: buildings (rule c first, then a and b)
  const par = rooms.map((r, i) => i);
  const find = (i) => { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; };
  const join = (a, b) => { a = find(a); b = find(b); if (a !== b) par[Math.max(a, b)] = Math.min(a, b); };
  for (const r of rooms) {
    if (!r.covered || r.y + 1 >= LV) continue;
    for (const i of r.cells) { const u = roomOf[(r.y + 1) * NN + i]; if (u >= 0 && rooms[u].covered) join(r.id, u); }
  }
  const tower = rooms.map((r) => find(r.id));
  const tDoor = new Uint8Array(rooms.length), tBed = new Uint8Array(rooms.length);
  for (const r of rooms) if (r.covered) { const t = tower[r.id]; if (r.ownDoor) tDoor[t] = 1; if (r.beds) tBed[t] = 1; }
  const keepApart = (a, b) => tDoor[tower[a]] && tDoor[tower[b]] && tBed[tower[a]] && tBed[tower[b]];
  for (const r of rooms) {
    if (!r.covered) continue;
    for (const i of r.cells) {
      const x = cx(i), z = cz(i);
      for (let d = 0; d < 4; d++) {
        const nx = x + DX[d], nz = z + DZ[d];
        if (!inNav(nx, nz)) continue;
        const o = roomOf[r.y * NN + ci(nx, nz)];
        if (o < 0 || o === r.id || !rooms[o].covered) continue;
        const c = ecAt(ix, r.y, i, d);
        if (c === EC.door) join(r.id, o);
        else if (c === EC.wall && tower[r.id] !== tower[o] && !keepApart(r.id, o)) join(r.id, o);
      }
    }
  }
  // ---- group into buildings
  const groups = new Map();
  for (const r of rooms) {
    if (!r.covered) continue;
    const root = find(r.id);
    let g = groups.get(root);
    if (!g) groups.set(root, (g = []));
    g.push(r);
  }
  const bOf = new Int32Array(LV * NN).fill(-1);
  const list = [...groups.values()];
  list.forEach((g, bi) => { for (const r of g) for (const i of r.cells) bOf[r.y * NN + i] = bi; });
  const buildings = list.map((g, bi) => finishBuilding(ix, g, bi, { floor, roomOf, rooms, bOf, coveredAt, shell: false }));
  // ---- shells: uncovered, non-veranda rooms with ≥ 50 % of their boundary walled (§3.7)
  const shells = [];
  for (const r of rooms) {
    if (r.covered || r.veranda) continue;
    let walled = 0, total = 0;
    for (const i of r.cells) {
      const x = cx(i), z = cz(i);
      for (let d = 0; d < 4; d++) {
        const nx = x + DX[d], nz = z + DZ[d];
        if (inNav(nx, nz) && roomOf[r.y * NN + ci(nx, nz)] === r.id) continue;
        total++;
        const c = ecAt(ix, r.y, i, d);
        if (c === EC.wall || c === EC.door) walled++;
      }
    }
    if (!total || walled * 2 < total) continue;
    const s = finishBuilding(ix, [r], -1, { floor, roomOf, rooms, bOf, coveredAt, shell: true });
    // a shell stacked on a building (or sharing a wall with one) is that building's roof hint (§3.2 reason override)
    for (const b of buildings) if (b.roofHint && b.roofHintRoom === r.id) s.partOf = b.id;
    shells.push(s);
  }
  // ---- verandas
  const verandas = [];
  for (const r of rooms) {
    if (!r.veranda) continue;
    const doors = [];
    for (const i of r.cells) {
      const x = cx(i), z = cz(i);
      for (let d = 0; d < 4; d++) if (ecAt(ix, r.y, i, d) === EC.door) doors.push(edgeKey(x, r.y, z, DX[d], DZ[d]));
    }
    verandas.push({ y: r.y, cells: r.cells.map((i) => [cx(i), cz(i)]).sort((a, b) => a[1] - b[1] || a[0] - b[0]), doors, room: r.id });
  }
  return { buildings, shells, verandas, roomOf, rooms, bOf, floor };
}

function finishBuilding(ix, g, bi, ctx) {
  const { floor, roomOf, rooms, bOf, coveredAt, shell } = ctx;
  const inB = shell ? ((y, i) => roomOf[y * NN + i] === g[0].id) : ((y, i) => y >= 0 && y < LV && bOf[y * NN + i] === bi);
  let lo = 99;
  const levels = new Set();
  for (const r of g) { lo = Math.min(lo, r.y); levels.add(r.y); }
  const cellsList = [];                                    // [y, i]
  for (const r of g) for (const i of r.cells) cellsList.push([r.y, i]);
  cellsList.sort((a, b) => a[0] - b[0] || cz(a[1]) - cz(b[1]) || cx(a[1]) - cx(b[1]));
  const cells = new Set(cellsList.map(([y, i]) => ck(cx(i), y, cz(i))));
  const gaps = [], unroofed = [], doorEdges = [], windows = [];
  let ground = 0, roofedN = 0;
  for (const [y, i] of cellsList) {
    const x = cx(i), z = cz(i);
    if (y === 0 && floor[i] === 2) ground++;
    if (roofedAt(ix, y, i)) roofedN++; else unroofed.push(ck(x, y, z));
    for (let d = 0; d < 4; d++) {
      const nx = x + DX[d], nz = z + DZ[d];
      const j = inNav(nx, nz) ? ci(nx, nz) : -1;
      if (j >= 0 && inB(y, j)) continue;
      const ek = edgeKey(x, y, z, DX[d], DZ[d]);
      const c = ecAt(ix, y, i, d);
      if (c === EC.door) {
        if (y === lo && (j < 0 || !coveredAt(y, j))) doorEdges.push({ ek, y, x, z, d, out: [nx, nz], doorway: false });
        continue;
      }
      if (c === EC.wall) {
        if (y === lo) { const w = ix.W.get(ek); if (w && WINDOW.has(w.t)) windows.push({ key: ek, t: w.t, x, z, out: [DX[d], DZ[d]] }); }
        continue;
      }
      if (isLowAt(ix, y, i, d)) continue;
      if (y > 0 && j >= 0 && !floor[y * NN + j] && inB(y - 1, j)) continue;           // gallery
      if (tallGable(ix, x, y, z, d)) continue;
      gaps.push({ ek, y, x, z, d, out: [nx, nz] });
    }
  }
  // doorway: no exterior door but a gap on lo whose outside cell is in no covered room
  let doorway = null;
  if (!doorEdges.length) {
    const cand = gaps.filter((gp) => gp.y === lo && !(inNav(gp.out[0], gp.out[1]) && coveredAt(gp.y, ci(gp.out[0], gp.out[1]))));
    const pathy = (gp) => (inNav(gp.out[0], gp.out[1]) && PATHY.has(ix.F.get(ck(gp.out[0], 0, gp.out[1]))?.t)) ? 1 : 0;
    cand.sort((a, b) => (pathy(b) - pathy(a)) || ((b.d === 0) - (a.d === 0)) || (a.ek < b.ek ? -1 : a.ek > b.ek ? 1 : 0));
    if (cand.length) {
      doorway = cand[0];
      gaps.splice(gaps.indexOf(doorway), 1);
      doorEdges.push({ ...doorway, doorway: true });
    }
  }
  // beds (any level) and the doors
  const bedKeys = [];
  for (const p of ix.byType.get('bed') || []) if (cells.has(ck(p.x, p.y, p.z))) bedKeys.push(`I|${p.x}|${p.y}|${p.z}`);
  bedKeys.sort();
  const doors = doorEdges.filter((e) => inNav(e.out[0], e.out[1])).map((e) => ({
    key: e.ek, step: [e.out[0], e.out[1]], out: [DX[e.d], DZ[e.d]], y: e.y, main: false, doorway: !!e.doorway, cell: [e.x, e.z],
  }));
  doors.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  if (doors.length) {
    const pathyStep = (dr) => PATHY.has(ix.F.get(ck(dr.step[0], 0, dr.step[1]))?.t);
    const main = doors.find(pathyStep) || doors.find((dr) => dr.out[1] === 1) || doors[0];
    main.main = true;
  }
  const flaws = gaps.length + unroofed.length;
  const reasons = [];
  let roofHint = null, roofHintRoom = -1;
  if (!doors.length) reasons.push('door');
  if (flaws > TUNE.HOME_SLACK && gaps.length) reasons.push('gaps');
  if (flaws > TUNE.HOME_SLACK && unroofed.length) reasons.push('roof');
  if (!bedKeys.length) {
    // reason override (§3.2 note): an uncovered room stacked on it, or sharing a wall with it, holds the bed
    if (!shell) {
      for (const r of rooms) {
        if (r.covered || r.veranda || !r.beds) continue;
        let hit = false;
        for (const i of r.cells) {
          if (inB(r.y - 1, i)) { hit = true; break; }
          const x = cx(i), z = cz(i);
          for (let d = 0; d < 4 && !hit; d++) {
            const nx = x + DX[d], nz = z + DZ[d];
            if (inNav(nx, nz) && inB(r.y, ci(nx, nz)) && ecAt(ix, r.y, i, d) === EC.wall) hit = true;
          }
          if (hit) break;
        }
        if (hit) { roofHint = r.cells.map((i) => ck(cx(i), r.y, cz(i))); roofHintRoom = r.id; break; }
      }
    }
    if (roofHint) { if (!reasons.includes('roof')) reasons.push('roof'); } else reasons.push('bed');
  }
  const foot = cellsList.filter(([y]) => y === lo).map(([, i]) => [cx(i), cz(i)]);
  const first = cellsList[0];
  const b = {
    id: 'b:' + ck(cx(first[1]), first[0], cz(first[1])),
    cells, lo, levels: [...levels].sort((a, c) => a - c), foot,
    doors, windows, gaps: gaps.map((gp) => gp.ek), unroofed, flaws,
    beds: bedKeys, capacity: Math.min(bedKeys.length, TUNE.BEDS_PER_HOME_MAX),
    home: !shell && bedKeys.length >= 1 && doors.length >= 1 && flaws <= TUNE.HOME_SLACK,
    reasons, name: '', shell, ground, roofedFrac: cellsList.length ? roofedN / cellsList.length : 0,
    rooms: g.length, roofHint, roofHintRoom, gapEdges: gaps,
  };
  b.name = nameOf(b, ix);
  return b;
}

// ---------------------------------------------------------------------------------------------- regions, feet, names
/** Home regions (§2.1): FOOT [x,z][] · DOOR doorsteps · DOOR1 the main doorstep (or null) · INSIDE Set · WIN windows. */
export function regions(b, index, nav) {
  let DOOR = b.doors.map((d) => d.step);
  if (nav) DOOR = DOOR.filter(([x, z]) => inNav(x, z));
  const main = b.doors.find((d) => d.main);
  return { FOOT: b.foot, DOOR, DOOR1: main ? main.step : null, INSIDE: b.cells, WIN: b.windows };
}

/** 'x,z;x,z;…' (sorted z then x). */
export function packFoot(foot) {
  const a = (foot || []).map(([x, z]) => [x | 0, z | 0]);
  a.sort((p, q) => p[1] - q[1] || p[0] - q[0]);
  return a.map(([x, z]) => x + ',' + z).join(';');
}

export function unpackFoot(str) {
  if (typeof str !== 'string' || !str) return [];
  const out = [];
  for (const part of str.split(';')) {
    const [a, b] = part.split(',');
    const x = Number(a), z = Number(b);
    if (Number.isInteger(x) && Number.isInteger(z)) out.push([x, z]);
  }
  return out;
}

const footSet = (f) => {
  const s = new Set();
  for (const [x, z] of (typeof f === 'string' ? unpackFoot(f) : f || [])) s.add(x * 64 + z);
  return s;
};

/** |a ∩ b| / min(|a|, |b|); a and b are [x,z][] or packed strings. */
export function footOverlap(a, b) {
  const A = footSet(a), B = footSet(b);
  if (!A.size || !B.size) return 0;
  let n = 0;
  const [s, l] = A.size <= B.size ? [A, B] : [B, A];
  for (const k of s) if (l.has(k)) n++;
  return n / Math.min(A.size, B.size);
}

const ROOF_ADJ = { roofThatch: 'thatched', roofSlate: 'slate-roofed', roofMetal: 'tin-roofed', roofShingle: 'shingled', roofTile: 'red-tiled' };
const ROOF_ORDER = ['roofThatch', 'roofSlate', 'roofMetal', 'roofShingle', 'roofTile'];

/** §3.4: "thatched cottage" (no article). */
export function nameOf(b, index) {
  const cols = new Set();
  for (const k of b.cells) { const [x, , z] = k.split('|'); cols.add(x + '|' + z); }
  const mats = new Map();
  let panels = 0, flat = 0, steep = 0;
  for (const c of cols) {
    for (const rf of index.R.get(c) || []) {
      panels++;
      if (rf.kind === 'flat') flat++;
      if (rf.rise >= 2) steep++;
      if (rf.m) mats.set(rf.m, (mats.get(rf.m) || 0) + 1);
    }
  }
  let adj = '';
  if (panels && flat === panels) adj = 'flat-roofed';
  else if (mats.size) {
    let best = null, bn = -1;
    for (const m of ROOF_ORDER) if ((mats.get(m) || 0) > bn) { bn = mats.get(m) || 0; best = m; }
    adj = ROOF_ADJ[best] || '';
  }
  // wall material majority over its boundary walls and doors
  const wm = new Map();
  let walls = 0;
  for (const k of b.cells) {
    const [x, y, z] = k.split('|').map(Number);
    for (let d = 0; d < 4; d++) {
      const nk = ck(x + DX[d], y, z + DZ[d]);
      if (b.cells.has(nk)) continue;
      const w = index.W.get(edgeKey(x, y, z, DX[d], DZ[d]));
      if (!w || !(WALLISH.has(w.t) || DOORWAY.has(w.t))) continue;
      walls++;
      if (w.m) wm.set(w.m, (wm.get(w.m) || 0) + 1);
    }
  }
  const logs = (wm.get('log') || 0) + (wm.get('logDark') || 0);
  let noun;
  if (walls && logs * 2 > walls) noun = 'log cabin';
  else if (panels && steep * 2 > panels) noun = 'A-frame';
  else if (b.levels.length >= 2) noun = 'farmhouse';
  else if (b.cells.size <= 8) noun = 'hut';
  else if (b.cells.size <= 24) noun = 'cottage';
  else noun = 'house';
  return adj ? `${adj} ${noun}` : noun;
}

// ---------------------------------------------------------------------------------------------- small shared helpers
/** Chebyshev cell distance from (x, z) to the nearest of cells ([x,z][]); Infinity for an empty set. */
export function dist(x, z, cells) {
  let m = Infinity;
  for (const c of cells) { const d = Math.max(Math.abs(c[0] - x), Math.abs(c[1] - z)); if (d < m) m = d; }
  return m;
}

/** Floor height of a home cell (furniture surface): levelY(y), or the ground (0) for a ground floor (§3.1). */
export function floorY(index, x, y, z) {
  if (y > 0) return levelY(y);
  const f = index.F.get(ck(x, 0, z));
  return f ? levelY(0) : 0;
}

/** Is the record outdoors (not in any building cell)? bOf from detectBuildings. */
export function outdoors(det, p) {
  if (!inNav(p.x, p.z) || p.y < 0 || p.y >= LV) return true;
  return det.bOf[p.y * NN + ci(p.x, p.z)] < 0;
}
