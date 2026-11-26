// Smart facing: which way a piece should face, worked out from what is around its spot (docs/SMART_BUILD.md §4).
// Pure: imports constants and the piece registry only, reads the world through ctx.get(slotKey) (world.get, or a
// masked getter in tests) and never scans it — local slot-key lookups around the spot, at most 168 cells of ring
// search. builder.resolve() calls autoFacing() for every new placement (behind a one-entry memo); facing is decided
// once, when a piece is placed: loading, undo, stamping and contextual rebuilds never call this.
//
//   autoFacing(def, p, ctx) → { r, rule, tie, fallback, scores, why, order }   (order: best first, null with no signal)
//     ctx = { get(key) → record | undefined, cam: [x, z] (unit vector target → camera), fallback: 0..3 (state.rot),
//             roofLevel (roofs: the level whose floor plane is the wall tops), lift (roofs: extra half-steps) }
//   faceGroup(def)   rule group ('wallEdge', 'slope', 'back', … ; null for rot 'none')
//   symOf(def)       1 (every facing looks alike) | 2 (r ≡ r + 2) | 4
//   turnable(def)    can a tap again / Turn change how it looks
//   turnOf(def, r, dir)   the next facing (+90° for four-way pieces, a flip for edge pieces): Turn / R
//   nextFacing(def, r, order, cont)   the facing a tap again gives: the rules' best first, then on round `order`
//   sameFacing(def, a, b) equal up to the piece's symmetry
//   roofHeight(get, def, x, z, r, L)   builder.autoRoofHeight over a getter
//   clearPath(get, x0, z0, x1, z1, y) an L path between two cells crosses no solid wall
//
// Conventions (config.js): r 0..3 turns a piece r·90° about +Y; its local +Z ("front") points along DIRS[r]
// (r 0 → +Z, 1 → +X, 2 → −Z, 3 → −X). Edge pieces flip (r 0 | 2): at r 0 local +Z is world +Z (axis x) or +X (axis z).

import { K, DIRS } from './config.js';
import { getDef } from './catalog.js';

const DX = [0, 1, 0, -1], DZ = [1, 0, -1, 0];
const opp = (d) => (d + 2) & 3;
const yaw4 = (dx, dz) => (Math.abs(dx) >= Math.abs(dz) ? (dx >= 0 ? 1 : 3) : (dz >= 0 ? 0 : 2));
const EPS = 1e-9;

// ---------------------------------------------------------------- rule groups (§3, §4.5)
/** Rule group per piece id (walls & openings, roofs and gables are found by category / kind, see faceGroup). */
export const FACE = {};
const put = (g, ids) => { for (const id of ids) FACE[id] = g; };
put('back', ['bed', 'nightstand', 'wardrobe', 'dresser', 'bookshelf', 'fireplace', 'wood_stove', 'piano', 'grandfather_clock',
  'kitchen', 'kitchen_counter', 'kitchen_range', 'desk', 'washstand', 'bathtub', 'chimney', 'dog_bed', 'crate_stack', 'barrel', 'cat']);
put('seat', ['sofa', 'armchair', 'rocking_chair']);
put('chair', ['chair']);
put('table', ['table', 'picnic_table', 'gift_tea_table']);
put('rug', ['rug', 'rug_round']);
put('bench', ['bench']);
put('front', ['mailbox', 'birdhouse', 'doghouse', 'scarecrow', 'beehive', 'woodpile', 'wheelbarrow', 'well', 'lamp_post',
  'clothesline', 'veggie_bed', 'hay_bale', 'gift_flower_cart', 'gift_hen_house', 'gift_carved_bear', 'gift_rowboat',
  'gift_honey_stand', 'gift_bread_oven', 'gift_festoon', 'gift_signpost', 'gift_gnome']);
put('free', ['tree_oak', 'tree_pine', 'tree_birch', 'tree_apple', 'bush', 'flowers', 'lavender', 'sunflowers', 'pumpkins',
  'boulders', 'pond', 'chickens', 'plant_pot', 'floor_lamp', 'fire_pit', 'birdbath']);
put('climb', ['stairs', 'stairs_spiral', 'ladder']);
put('steps', ['steps']);
put('deck', ['deck']);
put('pergola', ['pergola']);
put('fence', ['fence_picket', 'fence_rail', 'hedge']);
put('canon', ['railing', 'beam']);

/** Pieces whose look repeats every half turn (2: the rules answer 0 or 1) or never changes (1: railings). */
export const SYM = { deck: 2, pergola: 2, rug: 2, rug_round: 2, table: 2, floor_lamp: 2, railing: 1 };
const TALL = new Set(['wardrobe', 'bookshelf', 'grandfather_clock', 'fireplace', 'wood_stove', 'kitchen_range', 'chimney', 'washstand']);
const KITCHEN = new Set(['kitchen', 'kitchen_counter', 'kitchen_range']);
const HEARTH = new Set(['fireplace', 'wood_stove', 'chimney']);
const FOCAL = new Set(['pond', 'fire_pit', 'birdbath', 'well', 'gift_tea_table']);
const TABLES = new Set(['table', 'picnic_table', 'gift_tea_table']);
const LOW_ITEMS = new Set(['rug', 'rug_round', 'cat', 'plant_pot']);           // nothing to bump into at a stair foot
const FRONT_OK = new Set(['rug', 'rug_round', 'cat', 'plant_pot', 'chair']);   // fine in front of a wall piece

/** The rule group of a piece (a registered def may name its own with `face`); null when it never turns. */
export function faceGroup(def) {
  if (!def || def.rot === 'none') return null;
  if (def.face) return def.face;
  if (def.autoGable) return 'gable';
  if (def.layer === 'R') { const k = def.roof?.kind; return k === 'corner' ? 'hip' : k === 'inner' ? 'valley' : 'slope'; }
  if (FACE[def.id]) return FACE[def.id];
  if (def.layer === 'W' && (def.cat === 'walls' || def.cat === 'openings')) return 'wallEdge';
  return def.slot === 'edge' ? 'canon' : 'front';
}
/** 1: every facing looks the same · 2: a half turn looks the same · 4: every facing differs. */
export function symOf(def) {
  if (!def) return 4;
  return def.sym ?? SYM[def.id] ?? 4;
}
/** Does turning this piece change it (rot four / flip, not a gable fitted to its roof, not a railing)? */
export function turnable(def) {
  return !!def && def.rot !== 'none' && !def.autoGable && symOf(def) !== 1;
}
/** The facing after one turn: +dir quarter turns for four-way pieces, the other side for edge pieces. */
export function turnOf(def, r, dir = 1) {
  r = (r | 0) & 3;
  if (def?.rot === 'flip') return r >= 2 ? 0 : 2;
  return (r + (dir < 0 ? 3 : 1)) & 3;
}
/** Are two facings the same up to the piece's symmetry? */
export function sameFacing(def, a, b) {
  a = (a | 0) & 3; b = (b | 0) & 3;
  if (symOf(def) === 1) return true;
  if (def?.rot === 'flip') return (a >= 2) === (b >= 2);
  if (symOf(def) === 2) return (a & 1) === (b & 1);
  return a === b;
}

// ---------------------------------------------------------------- lookups (all ctx.get by slot key, §4.3)
const defOf = (rec) => (rec ? getDef(rec.t) : null);
const eKey = (x, y, z, d) => (d === 0 ? K.W('x', x, y, z + 1) : d === 1 ? K.W('z', x + 1, y, z) : d === 2 ? K.W('x', x, y, z) : K.W('z', x, y, z));
const bKey = (x, y, z, d) => (d === 0 ? K.B('x', x, y, z + 1) : d === 1 ? K.B('z', x + 1, y, z) : d === 2 ? K.B('x', x, y, z) : K.B('z', x, y, z));
const solidEdge = (c) => c === 'wall' || c === 'window' || c === 'half';
const holdsRoof = (def) => !!def && (def.layer === 'B' || def.cat === 'walls' || def.cat === 'openings');

function makeLook(get) {
  /** Class of the W piece on the edge of cell (x, z) toward d: wall | window | door | half | rail | fence | null. */
  const edge = (x, y, z, d) => {
    const dd = defOf(get(eKey(x, y, z, d)));
    if (!dd) return null;
    if (dd.cat === 'openings') return dd.id.startsWith('wall_door') ? 'door' : 'window';
    if (dd.id === 'wall_arch') return 'door';
    if (dd.id === 'wall_half') return 'half';
    if (dd.cat === 'walls') return 'wall';
    if (dd.id === 'railing') return 'rail';
    return 'fence';
  };
  const beam = (x, y, z, d) => !!get(bKey(x, y, z, d));
  /** Floor kind of a cell: foundation / floor → 'room', else the piece id (deck, path, steps, pergola); null. */
  const fk = (x, y, z) => {
    const q = get(K.F(x, y, z));
    if (!q) return null;
    return q.t === 'foundation' || q.t === 'floor' ? 'room' : q.t;
  };
  const item = (x, y, z) => get(K.I(x, y, z)) || null;
  const roofAt = (x, z, hs) => get(K.R(x, hs, z)) || null;
  /** A sloped panel over this cell that comes down inside this storey (an A-frame's roof is its wall): its downhill dir. */
  const roofWall = (x, y, z) => {
    for (let hs = 2 * y; hs <= 2 * y + 1; hs++) {
      const q = roofAt(x, z, hs), dd = defOf(q);
      if (dd?.roof && (dd.roof.kind || 'slope') === 'slope') return opp((q.r | 0) & 3);
    }
    return -1;
  };
  const roofed = (x, y, z) => { for (let hs = 2 * y; hs <= 2 * y + 12; hs++) if (roofAt(x, z, hs)) return true; return false; };
  const room = (x, y, z) => fk(x, y, z) === 'room';
  return { get, edge, beam, fk, item, roofAt, roofWall, roofed, room };
}

/** How "inside" a cell is (rooms > porches > garden). */
function insideness(L, x, y, z) {
  let s = 0;
  const f = L.fk(x, y, z);
  if (f === 'room') s += 3; else if (f === 'deck') s += 1;
  if (L.roofed(x, y, z)) s += 1;
  const up = L.fk(x, y + 1, z);
  if (up === 'room' || up === 'deck') s += 1;
  return s;
}
const anyWall = (c) => c === 'wall' || c === 'window' || c === 'half' || c === 'door';
/** Cells from (x, z) to the first edge toward d that passes `test` on level y (0 = its own edge), or Infinity. */
function wallDist(L, x, y, z, d, max = 3, test = anyWall) {
  let cx = x, cz = z;
  for (let k = 0; k <= max; k++) {
    if (test(L.edge(cx, y, cz, d))) return k;
    cx += DX[d]; cz += DZ[d];
  }
  return Infinity;
}
/** 'room' (a foundation / floor), 'wall' (a wall / window / door on one of its edges) or null. */
function bldKind(L, x, y, z) {
  if (L.room(x, y, z)) return 'room';
  for (let d = 0; d < 4; d++) { const c = L.edge(x, y, z, d); if (c === 'wall' || c === 'window' || c === 'door') return 'wall'; }
  return null;
}
/**
 * Where the nearest building lies seen from a centre (fx, fz) in cell units (cell (i, j) spans [i, i+1] × [j, j+1]).
 * Ring k = 1..rad holds the cells whose centre is at Chebyshev distance k − 1 < d ≤ k; the first ring with a hit
 * decides: the mean offset (centroid) of its room cells, else of its wall cells. Never scan order. → { dx, dz, k, kind }
 */
function nearestBuilding(L, fx, fz, y, rad = 6) {
  for (let k = 1; k <= rad; k++) {
    const i0 = Math.ceil(fx - k - 0.5), i1 = Math.floor(fx + k - 0.5), j0 = Math.ceil(fz - k - 0.5), j1 = Math.floor(fz + k - 0.5);
    let rn = 0, rx = 0, rz = 0, wn = 0, wx = 0, wz = 0;
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const ox = i + 0.5 - fx, oz = j + 0.5 - fz;
        if (Math.max(Math.abs(ox), Math.abs(oz)) <= k - 1 + EPS) continue;     // an inner ring: already looked at
        const b = bldKind(L, i, y, j);
        if (b === 'room') { rn++; rx += ox; rz += oz; } else if (b === 'wall') { wn++; wx += ox; wz += oz; }
      }
    }
    if (rn) return { dx: rx / rn, dz: rz / rn, k, kind: 'room' };
    if (wn) return { dx: wx / wn, dz: wz / wn, k, kind: 'wall' };
  }
  return null;
}
/** The house right beside a cell: the sum of its own sides holding a wall / window / door → { dx, dz } | null. */
function ownWalls(L, x, y, z) {
  let dx = 0, dz = 0, n = 0;
  for (let d = 0; d < 4; d++) { const c = L.edge(x, y, z, d); if (c === 'wall' || c === 'window' || c === 'door') { dx += DX[d]; dz += DZ[d]; n++; } }
  return n && (dx || dz) ? { dx, dz, own: true } : null;
}
/** Facing(s) whose front points away from a building offset; both axes on a diagonal; [] when it sits on it. */
function awayFrom(dx, dz) {
  const ax = Math.abs(dx), az = Math.abs(dz);
  if (ax < 0.25 && az < 0.25) return [];
  if (Math.abs(ax - az) < 0.25) return [dx > 0 ? 3 : 1, dz > 0 ? 2 : 0];
  return [yaw4(-dx, -dz)];
}
/** Is there an L path (x first, or z first) between two cells on level y that crosses no solid edge? */
function visible(L, x0, z0, x1, z1, y) {
  const walk = (xFirst) => {
    let x = x0, z = z0;
    for (let s = 0; s < 2; s++) {
      const ax = (s === 0) === xFirst;
      while (ax ? x !== x1 : z !== z1) {
        const d = ax ? (x1 > x ? 1 : 3) : (z1 > z ? 0 : 2);
        if (solidEdge(L.edge(x, y, z, d))) return false;
        x += DX[d]; z += DZ[d];
      }
    }
    return true;
  };
  return walk(true) || walk(false);
}
/** clearPath for the builder (tap again: is the picked piece's floor in view from the tapped cell?). */
export function clearPath(get, x0, z0, x1, z1, y) { return visible(makeLook(get), x0, z0, x1, z1, y); }

/** The best candidate: highest score; ties → the camera, then the lowest r. No signal at all → null. */
function pick(S, cands, camPref) {
  let max = -Infinity, signal = false;
  for (const r of cands) { if (S[r] > max) max = S[r]; if (S[r] !== 0) signal = true; }
  if (!signal) return null;
  const top = cands.filter((r) => Math.abs(S[r] - max) < EPS);
  if (top.length === 1) return { r: top[0], tie: false };
  let best = top[0], bv = -Infinity;
  for (const r of top) { const v = camPref(r); if (v > bv + EPS) { bv = v; best = r; } }
  return { r: best, tie: true };
}

/** A collinear neighbour on the same line (same layer, optional def test) → { r } | null. */
function collinear(L, p, layer, test = () => true) {
  const k = layer === 'B' ? K.B : K.W;
  const keys = p.a === 'x' ? [k('x', p.x - 1, p.y, p.z), k('x', p.x + 1, p.y, p.z)] : [k('z', p.x, p.y, p.z - 1), k('z', p.x, p.y, p.z + 1)];
  for (const key of keys) {
    const q = L.get(key), dd = defOf(q);
    if (dd && test(dd)) return { r: q.r | 0 };
  }
  return null;
}
/** Cells from (x, z) to the edge of the roofed footprint toward d: walls / beams of level lv − 1, or the platform's edge. */
function roofReach(L, x, lv, z, d, max = 10) {
  const b = lv - 1;
  const onPlat = (cx, cz) => (b >= 0 && !!L.fk(cx, b, cz)) || !!L.fk(cx, lv, cz);
  const plat = onPlat(x, z);
  let cx = x, cz = z;
  for (let k = 0; k <= max; k++) {
    if (b >= 0) {
      const w = L.get(eKey(cx, b, cz, d));
      if ((w && holdsRoof(defOf(w))) || L.get(bKey(cx, b, cz, d))) return k;
    }
    const nx = cx + DX[d], nz = cz + DZ[d];
    if (plat && !onPlat(nx, nz)) return k;            // the platform's edge (an A-frame's roof rests on its foundation)
    cx = nx; cz = nz;
  }
  return Infinity;
}
/** Axis of the doors round a footprint: 0 doors only on the ±Z walls, 1 only on ±X, −1 none / both. */
function doorAxis(L, x, y, z, dist) {
  const has = [false, false];
  for (let d = 0; d < 4; d++) {
    if (!Number.isFinite(dist[d])) continue;
    const cx = x + DX[d] * dist[d], cz = z + DZ[d] * dist[d], s = (d + 1) & 3;
    for (let k = -8; k <= 8; k++) if (L.edge(cx + DX[s] * k, y, cz + DZ[s] * k, d) === 'door') { has[d % 2] = true; break; }
  }
  return has[0] === has[1] ? -1 : has[0] ? 0 : 1;
}

/**
 * Auto height (half-steps above level Lv) so a roof panel continues the slope below it (builder.autoRoofHeight's body,
 * over a getter): slopes stack on the panel downhill of them, corners on the slopes / corners beside them, a valley sits
 * level with the slopes it joins or diagonally on a valley below.
 */
export function roofHeight(get, def, x, z, r, Lv) {
  const base = Lv * 2;
  const kind = def.roof?.kind || 'slope';
  if (kind === 'flat' || kind === 'cap') return 0;
  const [dx, dz] = DIRS[r];
  const [ex, ez] = DIRS[(r + 1) & 3];
  if (kind === 'inner') {
    let best = -1;
    for (let hs = base; hs <= base + 12; hs++) {
      const d = get(K.R(x - dx - ex, hs, z - dz - ez));
      const dd = d && getDef(d.t);
      if (dd?.roof?.kind === 'inner' && d.r === r) best = Math.max(best, hs + (dd.roof.rise ?? 1));
      for (const [cx, cz, rr] of [[x - dx, z - dz, (r + 1) & 3], [x - ex, z - ez, r]]) {
        const q = get(K.R(cx, hs, cz));
        const qd = q && getDef(q.t);
        if (qd?.roof && (qd.roof.kind || 'slope') === 'slope' && q.r === rr) best = Math.max(best, hs);
      }
    }
    return best < 0 ? 0 : best - base;
  }
  const probes = kind === 'slope' ? [[x - dx, z - dz]] : [[x - dx - ex, z - dz - ez], [x - dx, z - dz], [x - ex, z - ez]];
  let best = -1;
  for (const [cx, cz] of probes) {
    for (let hs = base; hs <= base + 12; hs++) {
      const q = get(K.R(cx, hs, cz));
      if (!q) continue;
      const qd = getDef(q.t);
      const qk = qd?.roof?.kind || 'slope';
      if (qk === 'flat' || qk === 'cap') continue;
      const sameDir = q.r === r;
      if (kind === 'slope' && !sameDir) continue;
      if (kind !== 'slope' && !(sameDir && qk === kind)) {
        // corners stacking diagonally need the same kind & rotation; straight probes accept slopes
        if (qk !== 'slope') continue;
        if (!(q.r === r || q.r === ((r + 1) & 3))) continue;
      }
      const top = hs + (qd.roof?.rise ?? 1);
      if (top > best) best = top;
    }
  }
  return best < 0 ? 0 : best - base;
}

// ---------------------------------------------------------------- the rules (§4.5)
/**
 * The facing a piece should take at p (p.x, p.y, p.z, p.a for edges; p.y is the record's level — for roofs the level
 * it is stored on, with ctx.roofLevel / ctx.lift as resolve() found them). Never null for a rotatable piece:
 * no signal → the fallback (ctx.fallback, the facing the player last chose), normalised for the piece.
 */
export function autoFacing(def, p, ctx) {
  const g = faceGroup(def);
  if (!g) return { r: 0, rule: null, fallback: false, tie: false, scores: [0, 0, 0, 0], why: [] };
  const L = makeLook(ctx.get);
  const cam = ctx.cam || [0, 1];
  const fb = ctx.fallback | 0;
  const faceCam = (r) => DX[r] * cam[0] + DZ[r] * cam[1];           // the front (local +Z) toward the camera
  const longCam = (r) => (r === 0 ? Math.abs(cam[1]) - Math.abs(cam[0]) : Math.abs(cam[0]) - Math.abs(cam[1]));
  const { x, y, z } = p;
  const S = [0, 0, 0, 0], why = [];
  let cands = [0, 1, 2, 3], camPref = faceCam;

  switch (g) {
    // -------------------------------------------------- walls, windows, doors (local +Z outdoors), fences, railings
    case 'wallEdge': case 'gable': case 'fence': case 'canon': {
      cands = [0, 2];
      const plusD = p.a === 'x' ? 0 : 1;                           // world dir of local +Z at r 0
      const px = x, pz = z, mx = p.a === 'x' ? x : x - 1, mz = p.a === 'x' ? z - 1 : z;
      camPref = (r) => { const d = r === 0 ? plusD : opp(plusD); return DX[d] * cam[0] + DZ[d] * cam[1]; };
      if (g === 'canon') {
        // a railing's flip is invisible, a beam's only mirrors its end cuts: r 0, or a collinear neighbour's
        const nb = collinear(L, p, def.layer);
        if (nb) { S[nb.r === 2 ? 2 : 0] += 4; why.push('collinear'); } else { S[0] += 1; why.push('canonical 0'); }
        break;
      }
      if (g !== 'fence') {
        const inP = insideness(L, px, y, pz), inM = insideness(L, mx, y, mz);
        // the side with an opposite wall within 8 cells is a room
        const encP = wallDist(L, px, y, pz, plusD, 8, solidEdge) < Infinity ? 1 : 0;
        const encM = wallDist(L, mx, y, mz, opp(plusD), 8, solidEdge) < Infinity ? 1 : 0;
        const s = (inM + encM) - (inP + encP);                    // > 0: the plus side is outdoors → r 0
        if (s) { S[0] += s; S[2] -= s; why.push(`inside +${inP + encP} −${inM + encM}`); } else {
          const nb = collinear(L, p, 'W', (dd) => dd.cat === 'walls' || dd.cat === 'openings');
          if (nb) { S[nb.r === 2 ? 2 : 0] += 1; why.push('collinear'); }
        }
        break;
      }
      // fences & hedges: the good face (pickets) toward the street — a path beside the fence, else away from the house
      const isPath = (c) => c === 'path' || c === 'steps';
      const pathSide = (cx, cz, d) => isPath(L.fk(cx, y, cz)) || isPath(L.fk(cx + DX[d], y, cz + DZ[d]));
      const pP = pathSide(px, pz, plusD), pM = pathSide(mx, mz, opp(plusD));
      if (pP !== pM) { S[pP ? 0 : 2] += 5; why.push(pP ? 'path on +' : 'path on −'); }
      // the edge's midpoint: (x + .5, z) for axis x, (x, z + .5) for axis z
      const nb = nearestBuilding(L, p.a === 'x' ? x + 0.5 : x, p.a === 'x' ? z : z + 0.5, y, 6);
      if (nb) {
        const off = plusD === 0 ? nb.dz : nb.dx;                   // > 0: the house is on the plus side
        if (off >= 1) { S[2] += 3; why.push('house on +'); } else if (off <= -1) { S[0] += 3; why.push('house on −'); }
      }
      const cn = collinear(L, p, 'W', (dd) => dd.id === def.id);
      if (cn) { S[cn.r === 2 ? 2 : 0] += 1; why.push('collinear'); }
      break;
    }
    // -------------------------------------------------- roofs: downhill toward the nearest eave, rows continue
    case 'slope': case 'hip': case 'valley': {
      const lv = ctx.roofLevel ?? y;
      const dist = [0, 1, 2, 3].map((d) => roofReach(L, x, lv, z, d));
      // the reach toward d ends at a wall the roof LEANS ON rather than an eave: the wall carries on up through level
      // lv (a taller house beside a lean-to), or this cell's floor is not a room and the wall has a room behind it
      const startRoom = L.fk(x, lv - 1, z) === 'room';
      const up = [0, 1, 2, 3].map((d) => {
        if (!Number.isFinite(dist[d]) || lv < 1) return false;
        const cx = x + DX[d] * dist[d], cz = z + DZ[d] * dist[d];
        const wd = defOf(L.get(eKey(cx, lv - 1, cz, d)));
        if (!wd || wd.layer !== 'W' || !(wd.cat === 'walls' || wd.cat === 'openings')) return false;
        const above = defOf(L.get(eKey(cx, lv, cz, d)));
        if (above && (above.cat === 'walls' || above.cat === 'openings') && !above.autoGable) return true;
        return !startRoom && L.fk(cx + DX[d], lv - 1, cz + DZ[d]) === 'room';
      });
      const spanX = dist[1] + dist[3] + 1, spanZ = dist[0] + dist[2] + 1;
      const rise = def.roof?.rise ?? 1;
      let doorAx;                                                 // (lazy: only a square footprint asks)
      camPref = (r) => -faceCam(r);                               // the slope's face (downhill) toward the camera
      for (const r of cands) {
        const hs = 2 * y + roofHeight(L.get, def, x, z, r, lv) + (ctx.lift || 0);   // this panel's slot if facing r
        if (g === 'slope') {
          const D = opp(r);
          // continue a row: a panel beside it (along the row) at the same height, facing the same way
          for (const sd of [(r + 1) & 3, (r + 3) & 3]) {
            const q = L.roofAt(x + DX[sd], z + DZ[sd], hs), qd = defOf(q);
            if (qd?.roof && (qd.roof.kind || 'slope') !== 'flat' && (q.r | 0) === r) { S[r] += 8; why.push(`row r${r}`); }
          }
          // stacked on the panel below it (downhill), facing the same way
          {
            const q = L.roofAt(x + DX[D], z + DZ[D], hs - rise), qd = defOf(q);
            if (qd?.roof && (q.r | 0) === r) { S[r] += 6; why.push(`stack r${r}`); }
          }
          // meets its partner at the ridge; never back to back with the panel downhill of it
          {
            const q = L.roofAt(x + DX[r], z + DZ[r], hs), qd = defOf(q);
            if (qd?.roof && (qd.roof.kind || 'slope') === 'slope' && (q.r | 0) === opp(r)) { S[r] += 4; why.push(`ridge r${r}`); }
            const b = L.roofAt(x + DX[D], z + DZ[D], hs), bd = defOf(b);
            if (bd?.roof && (bd.roof.kind || 'slope') === 'slope' && (b.r | 0) === D) { S[r] -= 6; why.push(`back-to-back r${r}`); }
          }
          // a lean-to: uphill toward the wall it leans on, whatever its depth
          if (up[r] !== up[D]) { S[r] += up[r] ? 5 : -5; why.push(`lean r${r}`); }
          if (Number.isFinite(dist[D]) && Number.isFinite(dist[r])) {
            if (!(up[r] || up[D])) {
              // downhill toward the nearer eave
              if (dist[D] < dist[r]) S[r] += 3; else if (dist[D] > dist[r]) S[r] -= 3;
              else {
                const bD = insideness(L, x + DX[D] * (dist[D] + 1), lv - 1, z + DZ[D] * (dist[D] + 1));
                const bU = insideness(L, x + DX[r] * (dist[r] + 1), lv - 1, z + DZ[r] * (dist[r] + 1));
                if (bD < bU) S[r] += 1; else if (bD > bU) S[r] -= 1;
              }
            }
            // the ridge along the longer axis (like a gable); a square: the gable end over the door
            const across = D % 2 === 0 ? spanZ : spanX, along = D % 2 === 0 ? spanX : spanZ;
            if (across < along) S[r] += 2; else if (across > along) S[r] -= 2;
            else {
              if (doorAx === undefined) doorAx = doorAxis(L, x, lv - 1, z, dist);
              if (doorAx >= 0 && D % 2 !== doorAx) S[r] += 1;
            }
          }
        } else if (g === 'hip') {
          const lo1 = opp(r), lo2 = (r + 3) & 3;                    // low on local −Z and −X
          if (Number.isFinite(dist[lo1]) && Number.isFinite(dist[lo2])) {
            S[r] += 6 - Math.min(6, dist[lo1] + dist[lo2]) - (dist[r] < dist[lo1] ? 3 : 0) - (dist[(r + 1) & 3] < dist[lo2] ? 3 : 0);
          }
          // the slope rows it closes: along local +X a slope facing r, along local +Z one facing r + 1
          const a = L.roofAt(x + DX[(r + 1) & 3], z + DZ[(r + 1) & 3], hs), b = L.roofAt(x + DX[r], z + DZ[r], hs);
          if (a && (a.r | 0) === r) S[r] += 6;
          if (b && (b.r | 0) === ((r + 1) & 3)) S[r] += 6;
        } else {
          // valley: joins a slope facing r + 1 on its local −Z side and one facing r on its local −X side
          const a = L.roofAt(x + DX[opp(r)], z + DZ[opp(r)], hs), b = L.roofAt(x + DX[(r + 3) & 3], z + DZ[(r + 3) & 3], hs);
          if (a && (a.r | 0) === ((r + 1) & 3)) S[r] += 6;
          if (b && (b.r | 0) === r) S[r] += 6;
          // its low corner points into the notch of an L: that diagonal cell is open, the two beside it covered
          const lx = opp(r), lz = (r + 3) & 3;
          const cov = (cx, cz) => L.fk(cx, lv - 1, cz) === 'room' || [0, 1, 2, 3].every((d) => Number.isFinite(roofReach(L, cx, lv, cz, d, 8)));
          if (cov(x + DX[lx], z + DZ[lx]) && cov(x + DX[lz], z + DZ[lz]) && !cov(x + DX[lx] + DX[lz], z + DZ[lx] + DZ[lz])) S[r] += 4;
        }
      }
      break;
    }
    // -------------------------------------------------- stairs, spiral stairs, loft ladder: climb onto the floor above
    case 'climb': {
      camPref = (r) => -faceCam(r);                               // the foot toward the camera
      let anyUp = false;
      for (let d = 0; d < 4; d++) if (L.fk(x + DX[d], y + 1, z + DZ[d])) anyUp = true;
      for (const r of cands) {
        const up = L.fk(x + DX[r], y + 1, z + DZ[r]), bx = x - DX[r], bz = z - DZ[r];
        if (anyUp) S[r] += up === 'room' || up === 'deck' ? 6 : -6;
        if (solidEdge(L.edge(x, y + 1, z, r))) S[r] -= 3;          // a wall where you step off upstairs
        if (def.id === 'ladder') {
          if (L.beam(x, y, z, r)) S[r] += 3;                       // leans on the loft's beam
          else if (solidEdge(L.edge(x, y, z, r))) S[r] += 2;       // or on a wall
          if (solidEdge(L.edge(x, y, z, opp(r)))) S[r] -= 2;
        } else {
          if (solidEdge(L.edge(x, y, z, (r + 1) & 3)) || solidEdge(L.edge(x, y, z, (r + 3) & 3))) S[r] += 3;   // along a wall
          const back = L.edge(x, y, z, opp(r)), shut = solidEdge(back) || back === 'door';
          if (shut) S[r] -= 6;                                     // you can't walk in at the foot
          const it = shut ? null : L.item(bx, y, bz);              // (a woodpile outside, behind that wall, is no matter)
          if (it && !LOW_ITEMS.has(it.t)) S[r] -= 4;
          if (L.room(bx, y, bz)) S[r] += 1;
        }
      }
      break;
    }
    // -------------------------------------------------- porch steps: climb toward the platform
    case 'steps': {
      camPref = (r) => -faceCam(r);
      let sig = false;
      for (const r of cands) {
        const f = L.fk(x + DX[r], 0, z + DZ[r]);
        if (f === 'room' || f === 'deck') { S[r] += 6 + (f === 'deck' ? 1 : 0); sig = true; }
        if (f && [0, 1, 2, 3].some((d) => L.edge(x + DX[r], 0, z + DZ[r], d) === 'door')) S[r] += 1;   // a door on that platform cell
      }
      // no platform beside it yet (steps laid before the porch): climb toward the nearest house
      if (!sig) {
        const nb = nearestBuilding(L, x + 0.5, z + 0.5, 0, 6);
        if (nb) for (const r of awayFrom(nb.dx, nb.dz)) { S[opp(r)] += 3; sig = true; why.push('toward the house'); }
      }
      // the foot: a path to it, nothing in the way — free ground counts only once something above scored (steps in the
      // open meadow have no signal at all, so they take the facing the player last chose, D4)
      for (const r of cands) {
        const b = L.fk(x - DX[r], 0, z - DZ[r]);
        if (b === 'path') S[r] += 2; else if (b) S[r] -= 2; else if (sig) S[r] += 1;
      }
      break;
    }
    // -------------------------------------------------- deck boards & pergola rafters (half-turn symmetric)
    case 'deck': case 'pergola': {
      cands = [0, 1];
      camPref = longCam;
      for (let d = 0; d < 4; d++) {
        const q = L.get(K.F(x + DX[d], y, z + DZ[d]));
        if (q && q.t === def.id) { S[(q.r | 0) & 1] += 6; why.push('neighbour'); }
      }
      if (g === 'deck') {
        // boards run away from the house (the house on ±Z → boards along Z, r 1); the second row out counts it too
        for (let d = 0; d < 4; d++) {
          const nx = x + DX[d], nz = z + DZ[d], ax = d % 2 === 0 ? 1 : 0;
          if (L.room(nx, y, nz) || solidEdge(L.edge(x, y, z, d)) || L.edge(x, y, z, d) === 'door') S[ax] += 3;
          else {
            const nf = L.fk(nx, y, nz), far = L.edge(nx, y, nz, d);
            if ((!nf || nf === 'deck') && (L.room(nx + DX[d], y, nz + DZ[d]) || solidEdge(far) || far === 'door')) S[ax] += 2;
          }
        }
      } else {
        // rafters (local Z) rest across the beams under its sides
        for (let d = 0; d < 4; d++) if (L.beam(x, y - 1, z, d) || solidEdge(L.edge(x, y - 1, z, d))) S[d % 2 === 0 ? 0 : 1] += 3;
      }
      break;
    }
    // -------------------------------------------------- furniture & seats: back to a wall, chairs to a table, benches
    case 'back': case 'seat': case 'chair': case 'bench': {
      const low = !TALL.has(def.id);
      if (g === 'seat' || g === 'bench') {
        // a hearth to gather round (only from in front of its firebox) / a pond, fire pit, well… to look at
        let best = null;
        for (let dx = -2; dx <= 2; dx++) {
          for (let dz = -2; dz <= 2; dz++) {
            if (!dx && !dz) continue;
            const it = L.item(x + dx, y, z + dz);
            if (!it || !(g === 'seat' ? HEARTH : FOCAL).has(it.t) || !visible(L, x, z, x + dx, z + dz, y)) continue;
            if (g === 'seat') { const hf = DIRS[(it.r | 0) & 3]; if (-dx * hf[0] - dz * hf[1] < 1) continue; }
            const d2 = dx * dx + dz * dz;
            if (!best || d2 < best.d2) best = { dx, dz, d2 };
          }
        }
        if (best) { S[yaw4(best.dx, best.dz)] += 12; why.push('focal'); }
      }
      if (g === 'chair') {
        // tuck in at a table (never a desk: it brings its own chair)
        for (let d = 0; d < 4; d++) {
          const it = L.item(x + DX[d], y, z + DZ[d]);
          if (it && TABLES.has(it.t) && !solidEdge(L.edge(x, y, z, d))) { S[d] += 20; why.push('table'); }
        }
      }
      if (g === 'bench' || (g === 'seat' && !L.room(x, y, z))) {
        // outdoors: the house at your back (on a porch up to 2 cells off), a path to watch, else face the house
        const porch = L.fk(x, y, z) === 'deck';
        for (let d = 0; d < 4; d++) {
          const k = wallDist(L, x, y, z, opp(d), porch ? 2 : 0, (c) => c === 'wall' || c === 'window' || c === 'door');
          if (k < Infinity) S[d] += [8, 5, 3][k];
        }
        if (g === 'bench') {
          for (let d = 0; d < 4; d++) for (let k = 1; k <= 2; k++) if (L.fk(x + DX[d] * k, y, z + DZ[d] * k) === 'path') { S[d] += 6 / k; break; }
          for (let d = 0; d < 4; d++) { const c = L.edge(x, y, z, opp(d)); if (c === 'fence' || c === 'rail' || c === 'half') S[d] += 2; }
          if (!S.some((v) => v)) {
            const nb = ownWalls(L, x, y, z) || nearestBuilding(L, x + 0.5, z + 0.5, y, 6);
            if (nb) for (const r of awayFrom(nb.dx, nb.dz)) { S[opp(r)] += 3; why.push('face the house'); }
          }
        }
        // villagers walk up to a bench / rocker from its front cell: +1 per free front, once something has scored
        if (S.some((v) => v)) {
          for (let d = 0; d < 4; d++) {
            const it = L.item(x + DX[d], y, z + DZ[d]);
            if ((!it || it.t === 'flowers' || it.t === 'lavender') && !L.edge(x, y, z, d)) S[d] += 1;
          }
        }
        break;
      }
      // indoors (and seats with no hearth): the back to the best wall, the front into the room
      const rw = L.roofWall(x, y, z);
      // furniture with something to stand against on one of its cell's own edges (a wall, window, half wall, railing,
      // fence; a door is not one) or an A-frame's roof coming down over it backs onto one of those: the "wall a cell or
      // more away" fallback is for a cell with none (repair round 2, S2.4: with a table in front, a stove on a window
      // wall scored 4.5 − 2 against the 3.5 of a wall a cell to its side and turned its back to open floor again).
      // Seats and chairs keep it: their hearth / table term faces them away from a wall on purpose
      let own = false;
      if (g === 'back') {
        own = rw >= 0;
        for (let d = 0; d < 4 && !own; d++) { const c = L.edge(x, y, z, d); if (c && c !== 'door') own = true; }
      }
      for (let f = 0; f < 4; f++) {
        const b = opp(f), c = L.edge(x, y, z, b);
        let s = 0;
        // (a TALL piece would rather not stand in front of a window: a plain wall beside it wins, 10 > 4.5)
        if (c === 'wall') s = 10;
        else if (c === 'window') s = def.id === 'desk' ? 11 : low ? 8 : 4.5;
        else if (c === 'half') s = 6;
        else if (c === 'door') s = -20;
        else if (c === 'rail' || c === 'fence') s = 4;
        else if (rw === b) s = 7;
        else {
          if (!own) {
            const k = wallDist(L, x, y, z, b, 3, solidEdge);
            if (k < Infinity) s = Math.max(0.5, 5 - 1.5 * k);
            else if (L.roofWall(x + DX[b], y, z + DZ[b]) === b) s = 4;    // an A-frame's roof coming down next door
          }
          const bi = L.item(x + DX[b], y, z + DZ[b]);
          if (bi && !LOW_ITEMS.has(bi.t)) s -= 2;                          // its back pressed against another piece
        }
        if ((c === 'wall' || c === 'window') && HEARTH.has(def.id) && !L.room(x + DX[b], y, z + DZ[b])) s += 2;   // an outside wall for the flue
        if (solidEdge(L.edge(x, y, z, f))) s -= 8;
        const fi = L.item(x + DX[f], y, z + DZ[f]);
        if (fi && !FRONT_OK.has(fi.t)) s -= 2;
        if (L.room(x + DX[f], y, z + DZ[f])) s += 0.5;
        // keep company: a run of kitchen pieces, a nightstand beside its bed
        for (const sd of [(f + 1) & 3, (f + 3) & 3]) {
          const n = L.item(x + DX[sd], y, z + DZ[sd]);
          if (!n || ((n.r | 0) & 3) !== f) continue;
          if (KITCHEN.has(def.id) && KITCHEN.has(n.t)) s += 4;
          if ((def.id === 'nightstand' && n.t === 'bed') || (def.id === 'bed' && n.t === 'nightstand')) s += 6;
        }
        S[f] += s;
      }
      break;
    }
    // -------------------------------------------------- tables & rugs: the long axis
    case 'table': case 'rug': {
      const sym2 = symOf(def) === 2;
      const ax = [0, 0];                                          // [long axis X (r 0), long axis Z (r 1)]
      for (let d = 0; d < 4; d++) {
        const it = solidEdge(L.edge(x, y, z, d)) ? null : L.item(x + DX[d], y, z + DZ[d]);   // same room only
        if (g === 'table' && it && it.t === def.id) ax[d % 2 === 0 ? 1 : 0] += 6;              // a long table
        if (g === 'rug' && it) ax[d % 2 === 0 ? 1 : 0] += 1;                                   // toward the furniture
      }
      const dz = wallDist(L, x, y, z, 0, 8, solidEdge) + wallDist(L, x, y, z, 2, 8, solidEdge);
      const dx = wallDist(L, x, y, z, 1, 8, solidEdge) + wallDist(L, x, y, z, 3, 8, solidEdge);
      if (Number.isFinite(dx) && Number.isFinite(dz) && dx !== dz) ax[dx > dz ? 0 : 1] += 0.5;   // the room's longer span
      if (sym2) { cands = [0, 1]; S[0] = ax[0]; S[1] = ax[1]; camPref = longCam; } else { S[0] = S[2] = ax[0]; S[1] = S[3] = ax[1]; }
      break;
    }
    // -------------------------------------------------- garden things with a front: away from the house
    case 'front': {
      const nb = ownWalls(L, x, y, z) || nearestBuilding(L, x + 0.5, z + 0.5, y, 6);
      if (nb) for (const r of awayFrom(nb.dx, nb.dz)) { S[r] += 6; why.push(nb.own ? 'away from the wall' : 'away from the house'); }
      for (let d = 0; d < 4; d++) {
        const n = L.item(x + DX[d], y, z + DZ[d]);
        if (n && n.t === def.id) { S[(n.r | 0) & 3] += 4; why.push('row'); }
      }
      if (S.some((v) => v)) for (let d = 0; d < 4; d++) if (!L.item(x + DX[d], y, z + DZ[d]) && !solidEdge(L.edge(x, y, z, d))) S[d] += 0.5;
      break;
    }
    default: break;                                               // 'free': no rule, the fallback
  }
  const res = pick(S, cands, camPref);
  if (!res) {
    const r = def.rot === 'flip' || (cands.length === 2 && cands[1] === 2) ? (fb & 3) >= 2 ? 2 : 0 : symOf(def) === 2 ? fb & 1 : fb & 3;
    return { r, rule: g, tie: false, fallback: true, scores: S, why, order: null };
  }
  // (tables: the rule knows only the long axis, and a picnic table turned half way looks the same: a tap turns it +90°)
  const order = g === 'table' && cands.length === 4 ? null : orderOf(S, cands, camPref, res.r, g === 'slope');
  return { r: res.r, rule: g, tie: res.tie, fallback: false, scores: S, why, order };
}

/**
 * The order a tap again steps through the facings at a spot (§5.1): the rules' best first, then the others from the
 * next best down (equal scores: the camera, then the lowest r, as pick() breaks ties). A roof slope's opposite comes
 * right after its best: a wrong slope guess is the other side of the ridge far more often than a sideways panel.
 */
function orderOf(S, cands, camPref, best, oppFirst) {
  const rest = cands.filter((r) => r !== best).sort((a, b) => (Math.abs(S[b] - S[a]) > EPS ? S[b] - S[a] : Math.abs(camPref(b) - camPref(a)) > EPS ? camPref(b) - camPref(a) : a - b));
  if (oppFirst) { const i = rest.indexOf(opp(best)); if (i > 0) rest.unshift(rest.splice(i, 1)[0]); }
  return [best, ...rest];
}
/**
 * The facing a tap again gives a placed piece now facing r, from `order` (autoFacing's, at its spot, now): a first tap
 * on a piece that is not facing the rules' best goes to the best (the room may have changed since it was placed, or a
 * tie went the camera's way — repair round 2, S2.2); a first tap on one already facing the best goes to the next; `cont`
 * (this tap carries on a run of taps on the same piece, nothing else changed) goes to the one after r, so a run visits
 * every facing. With no order (the rules have no opinion there) the plain turnOf.
 */
export function nextFacing(def, r, order, cont = false) {
  if (!Array.isArray(order) || order.length < 2) return turnOf(def, r);
  const i = order.findIndex((o) => sameFacing(def, o, r));
  if (!cont && i !== 0) return order[0];
  return i < 0 ? turnOf(def, r) : order[(i + 1) % order.length];
}
