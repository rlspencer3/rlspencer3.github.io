// Hearthwood — roofs: slopes, steep A-frame panels, hip corners, valleys, flat roofs, skylights,
// pyramid caps and the chimney.
//
// Every roof panel is described by a HEIGHT FIELD over its cell (local u = x, v = z ∈ [-1, 1]):
//   slope  : rise·(v+1)/2                 corner (hip) : rise·min(u+1, v+1)/2
//   inner  : rise·max(u+1, v+1)/2          flat         : 0          pyramid : rise·(1 − max|u|,|v|)
// The underside follows the field exactly (see ARCHITECTURE.md "Roofs"); the top surface is the
// field + a vertical thickness Tv that depends only on the roofing material, so every joint (stacked,
// side-by-side, gentle-on-steep) meets flush. Panel ends are cut vertically on the cell boundary, so
// neighbouring panels meet without gaps or overlap; side faces hidden inside a joint are not built.
//
// Contextual finishing: each of the four sides is compared with the roof panels in the neighbouring
// cell (any hs within ±4 half-steps). If a neighbour's field meets ours along the shared edge the side
// is JOINED (or a RIDGE when both sides are high edges). Unmatched sides are finished:
//   low edge  → eave: overhang (EAVE) + fascia board        sloped edge → gable verge + barge board
//   high edge → top board                                    flat edge   → overhang + raised lip
// The ridge cap is drawn by only one of the two panels (the one whose neighbour lies toward +Z / +X).
// Eaves that run into a valley panel are mitred so the two wings' overhangs meet on the diagonal.
//
// Texture contract: roof textures repeat every 1 m and hold 4 courses (0.25 m) along V. Top UVs use
// U = metres along the eave and V = whole courses up the slope (each panel holds an integer number of
// courses; V starts where the panel below ended, so courses run on across stacked panels).

import * as THREE from 'three';
import { registerPiece } from '../catalog.js';
import { STEP, ROOF_T, EAVE, BASE_Y, DIRS, K } from '../config.js';
import { mat } from '../materials.js';
import { boxGeo, cylGeo, sphereGeo, coneGeo, add } from '../geom.js';

const ROOF_MATS = ['roofShingle', 'roofSlate', 'roofMetal', 'roofThatch', 'roofTile'];
const VERGE = 0.24;      // side overhang at gable ends
const FT = 0.05;         // fascia / barge board thickness
const OUT = 0.014;       // boards stand this far proud of the roof edge
const LIP = 0.04;        // roofing visible above the boards
const INSET = 0.035;     // (flat roofs) fascia set-in under the overhang
const DROP = 0.09;       // boards hang this far below the roof underside
const COURSE = 0.25;     // texture course height
const PLINTH_EAVE = 0.1; // overhang of a level-0 eave that lands on a foundation plinth
const EPS = 1e-4;
const UP = [0, 1, 0], DOWN = [0, -1, 0];

// Per-material look. t = perpendicular thickness of the roofing; cap = ridge/hip style.
const STYLE = {
  roofShingle: { t: ROOF_T, trim: 'trim', cap: 'v', valley: true },
  roofSlate:   { t: ROOF_T, trim: 'trim', cap: 'v', valley: true },
  roofMetal:   { t: ROOF_T, trim: 'trim', cap: 'v', valley: null, seams: true },
  roofThatch:  { t: 0.3, trim: null, cap: 'roll', valley: null, round: true },
  roofTile:    { t: ROOF_T, trim: 'trim', cap: 'round', valley: true },
};
const styleOf = (m) => STYLE[m] || STYLE.roofShingle;
// Vertical slab thickness: the material thickness measured square to a GENTLE slope. Using one vertical
// thickness for every rise means stacked/joined panels always meet flush (gentle-on-steep included).
const TV_FACTOR = Math.hypot(2, STEP) / 2;
const tvOf = (m) => styleOf(m).t * TV_FACTOR;

const r4 = (n) => Math.round(n * 1e4) / 1e4;

// ===================================================================== small geometry kit

/** Collects triangles per material bucket; emits one mesh per bucket. Flat normals. */
class Mesher {
  constructor() { this.b = new Map(); }
  _bucket(k) {
    let b = this.b.get(k);
    if (!b) { b = { pos: [], uv: [] }; this.b.set(k, b); }
    return b;
  }
  tri(k, A, B, C, ta, tb, tc, want) {
    const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2];
    const vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (nx * nx + ny * ny + nz * nz < 1e-12) return;          // degenerate
    if (want && nx * want[0] + ny * want[1] + nz * want[2] < 0) { [B, C] = [C, B]; [tb, tc] = [tc, tb]; }
    const b = this._bucket(k);
    b.pos.push(A[0], A[1], A[2], B[0], B[1], B[2], C[0], C[1], C[2]);
    b.uv.push(ta[0], ta[1], tb[0], tb[1], tc[0], tc[1]);
  }
  /** Convex polygon (3D points) as a fan. */
  poly(k, P, T, want) { for (let i = 1; i + 1 < P.length; i++) this.tri(k, P[0], P[i], P[i + 1], T[0], T[i], T[i + 1], want); }
  quad(k, A, B, C, D, ta, tb, tc, td, want) { this.tri(k, A, B, C, ta, tb, tc, want); this.tri(k, A, C, D, ta, tc, td, want); }
  emit(group, mats) {
    for (const [k, b] of this.b) {
      if (!b.pos.length || !mats[k]) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
      g.computeVertexNormals();
      add(group, g, mats[k]);
    }
  }
}

/** Clip a convex polygon ([[u,v]…]) to the half-plane nu·u + nv·v ≤ d. */
function clipPoly(poly, [nu, nv, d]) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const A = poly[i], B = poly[(i + 1) % poly.length];
    const da = nu * A[0] + nv * A[1] - d, db = nu * B[0] + nv * B[1] - d;
    if (da <= EPS) out.push(A);
    if ((da < -EPS && db > EPS) || (da > EPS && db < -EPS)) {
      const t = da / (da - db);
      out.push([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t]);
    }
  }
  // drop near-duplicates
  const res = [];
  for (const p of out) {
    const q = res[res.length - 1];
    if (!q || Math.abs(q[0] - p[0]) > EPS || Math.abs(q[1] - p[1]) > EPS) res.push(p);
  }
  if (res.length > 1) {
    const a = res[0], z = res[res.length - 1];
    if (Math.abs(a[0] - z[0]) < EPS && Math.abs(a[1] - z[1]) < EPS) res.pop();
  }
  return res.length >= 3 ? res : [];
}
const clipAll = (poly, clips) => clips.reduce((p, c) => (p.length ? clipPoly(p, c) : p), poly);

/** Segment of the line {p : n·p = c} inside a convex polygon: [[u,v],[u,v]] or null. */
function chord(poly, n, c) {
  const hits = [];
  for (let i = 0; i < poly.length; i++) {
    const A = poly[i], B = poly[(i + 1) % poly.length];
    const da = n[0] * A[0] + n[1] * A[1] - c, db = n[0] * B[0] + n[1] * B[1] - c;
    if (Math.abs(da) <= EPS) hits.push(A);
    if ((da < -EPS && db > EPS) || (da > EPS && db < -EPS)) {
      const t = da / (da - db);
      hits.push([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t]);
    }
  }
  if (hits.length < 2) return null;
  const dir = [-n[1], n[0]];
  hits.sort((p, q) => (p[0] * dir[0] + p[1] * dir[1]) - (q[0] * dir[0] + q[1] * dir[1]));
  const a = hits[0], b = hits[hits.length - 1];
  if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.01) return null;
  return [a, b];
}

const centroid = (poly) => {
  let u = 0, v = 0;
  for (const p of poly) { u += p[0]; v += p[1]; }
  return [u / poly.length, v / poly.length];
};

/**
 * Closed prism over a convex footprint (plan points [u,v]) with per-vertex bottom/top heights.
 * Top/bottom faces must be planar (heights linear over the footprint).
 */
function prism(M, k, pts, bot, top, opts = {}) {
  const n = pts.length;
  const P3t = pts.map((p, i) => [p[0], top[i], p[1]]);
  const P3b = pts.map((p, i) => [p[0], bot[i], p[1]]);
  const uvT = opts.uvTop ? pts.map(opts.uvTop) : pts.map((p) => [p[0], -p[1]]);
  M.poly(k, P3t, uvT, UP);
  if (!opts.noBottom) M.poly(k, P3b, pts.map((p) => [p[0], p[1]]), DOWN);
  const c = centroid(pts);
  for (let i = 0; i < n; i++) {
    if (opts.skip && opts.skip.includes(i)) continue;
    const j = (i + 1) % n;
    const A = pts[i], B = pts[j];
    let nx = B[1] - A[1], nz = -(B[0] - A[0]);
    const mx = (A[0] + B[0]) / 2 - c[0], mz = (A[1] + B[1]) / 2 - c[1];
    if (nx * mx + nz * mz < 0) { nx = -nx; nz = -nz; }
    const L = Math.hypot(B[0] - A[0], B[1] - A[1]);
    const s0 = A[0] * -nz + A[1] * nx;   // along-edge coordinate for UVs
    M.quad(k, [A[0], bot[i], A[1]], [B[0], bot[j], B[1]], [B[0], top[j], B[1]], [A[0], top[i], A[1]],
      [s0, bot[i]], [s0 + L, bot[j]], [s0 + L, top[j]], [s0, top[i]], [nx, 0, nz]);
  }
}

const _up = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();
/** Round rod (cylinder) from a to b (3D points). */
function rod(g, m, a, b, r, segs = 8, open = false) {
  _dir.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = _dir.length();
  if (len < 1e-3) return null;
  const o = add(g, cylGeo(r4(r), r4(r), r4(len), segs, open), m, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  o.quaternion.setFromUnitVectors(_up, _dir.normalize());
  return o;
}

// ===================================================================== height fields

/** Field in half-steps (used for neighbour matching). */
function field(kind, rise, u, v) {
  if (kind === 'slope') return rise * (v + 1) / 2;
  if (kind === 'corner') return rise * Math.min(u + 1, v + 1) / 2;
  if (kind === 'inner') return rise * Math.max(u + 1, v + 1) / 2;
  return 0;
}

/** Planar facets of a panel kind: H(u,v) = a·u + b·v + c (metres), clip half-planes, uphill dir. */
function facetsOf(kind, R) {
  const h = R / 2;
  switch (kind) {
    case 'slope': return [{ a: 0, b: h, c: h, clip: [], dir: [0, 1] }];
    case 'corner': return [
      { a: 0, b: h, c: h, clip: [[-1, 1, 0]], dir: [0, 1] },     // v ≤ u : rises toward +Z
      { a: h, b: 0, c: h, clip: [[1, -1, 0]], dir: [1, 0] },     // u ≤ v : rises toward +X
    ];
    case 'inner': return [
      { a: 0, b: h, c: h, clip: [[1, -1, 0]], dir: [0, 1] },     // u ≤ v
      { a: h, b: 0, c: h, clip: [[-1, 1, 0]], dir: [1, 0] },     // v ≤ u
    ];
    case 'pyramid': return [
      { a: 0, b: -R, c: R, clip: [[1, -1, 0], [-1, -1, 0]], dir: [0, -1] },
      { a: 0, b: R, c: R, clip: [[1, 1, 0], [-1, 1, 0]], dir: [0, 1] },
      { a: -R, b: 0, c: R, clip: [[-1, 1, 0], [-1, -1, 0]], dir: [-1, 0] },
      { a: R, b: 0, c: R, clip: [[1, 1, 0], [1, -1, 0]], dir: [1, 0] },
    ];
    default: return [{ a: 0, b: 0, c: 0, clip: [], dir: [0, 1] }];
  }
}

function heightFn(kind, R) {
  const h = R / 2;
  switch (kind) {
    case 'slope': return (u, v) => h * (v + 1);
    case 'corner': return (u, v) => h * Math.min(u + 1, v + 1);
    case 'inner': return (u, v) => h * Math.max(u + 1, v + 1);
    case 'pyramid': return (u, v) => R * (1 - Math.max(Math.abs(u), Math.abs(v)));
    default: return () => 0;
  }
}
const KINKS = { corner: [[1, -1, 0]], inner: [[1, -1, 0]], pyramid: [[1, -1, 0], [1, 1, 0]] };

// ===================================================================== neighbour analysis

// local sides: 0 +Z, 1 +X, 2 −Z, 3 −X   (outward normal n, endpoints a → b)
const LS = [
  { n: [0, 1], a: [-1, 1], b: [1, 1] },
  { n: [1, 0], a: [1, -1], b: [1, 1] },
  { n: [0, -1], a: [-1, -1], b: [1, -1] },
  { n: [-1, 0], a: [-1, -1], b: [-1, 1] },
];
function toWorld(r, u, v) {
  const ez = DIRS[r & 3], ex = DIRS[(r + 1) & 3];
  return [u * ex[0] + v * ez[0], u * ex[1] + v * ez[1]];
}
function toLocal(r, dx, dz) {
  const ez = DIRS[r & 3], ex = DIRS[(r + 1) & 3];
  return [dx * ex[0] + dz * ex[1], dx * ez[0] + dz * ez[1]];
}
const roofKind = (def) => (def && def.roof ? (def.roof.kind || 'slope') : null);

/** 'S' sloped edge · 'H' high edge (surface falls into the cell) · 'L' low edge · 'F' flat. */
function sideType(F, a, b, n) {
  const ha = F(a[0], a[1]), hb = F(b[0], b[1]);
  if (Math.abs(ha - hb) > EPS) return 'S';
  const hi = F((a[0] + b[0]) / 2 - n[0] * 0.5, (a[1] + b[1]) / 2 - n[1] * 0.5);
  return hi < ha - EPS ? 'H' : hi > ha + EPS ? 'L' : 'F';
}

/**
 * Per-side state string (local +Z, +X, −Z, −X):
 *   j joined · i joined to a valley panel · 1/2 ridge (owner; partner rise) · n ridge (other owner)
 *   e eave · v verge · t open top edge · o open flat edge
 */
function sideStates(p, ctx, kind, rise) {
  const hs = 2 * p.y + (p.h || 0);
  const r = p.r || 0;
  const myTv = tvOf(p.m);
  const F = (u, v) => field(kind, rise, u, v);
  let out = '', thin = '';
  for (let i = 0; i < 4; i++) {
    const s = LS[i];
    const mine = sideType(F, s.a, s.b, s.n);
    const wn = toWorld(r, s.n[0], s.n[1]);
    const wa = toWorld(r, s.a[0], s.a[1]), wb = toWorld(r, s.b[0], s.b[1]);
    const ha = hs + F(s.a[0], s.a[1]), hb = hs + F(s.b[0], s.b[1]);
    let st = null, th = '0';
    for (let d = -4; d <= 4 && !st; d++) {
      const q = ctx.get(K.R(p.x + wn[0], hs + d, p.z + wn[1]));
      if (!q) continue;
      const qd = ctx.defOf(q);
      const qk = roofKind(qd);
      if (!qk || qk === 'cap') continue;
      const qr = q.r || 0, qrise = qd.roof.rise ?? 1;
      const G = (u, v) => field(qk, qrise, u, v);
      const la = toLocal(qr, wa[0] - 2 * wn[0], wa[1] - 2 * wn[1]);
      const lb = toLocal(qr, wb[0] - 2 * wn[0], wb[1] - 2 * wn[1]);
      if (Math.abs(hs + d + G(la[0], la[1]) - ha) > EPS || Math.abs(hs + d + G(lb[0], lb[1]) - hb) > EPS) continue;
      const qn = toLocal(qr, -wn[0], -wn[1]);
      const theirs = sideType(G, la, lb, qn);
      if (mine === 'H' && theirs === 'H') {
        const owner = (wn[0] === 0 && wn[1] === 1) || (wn[0] === 1 && wn[1] === 0);
        st = owner ? String(qrise) : 'n';
      } else st = qk === 'inner' && kind !== 'inner' ? 'i' : 'j';
      if ((qk === 'flat' ? FLAT.T : tvOf(q.m)) < myTv - EPS) th = '1';
    }
    if (!st) st = mine === 'S' ? 'v' : mine === 'L' ? 'e' : mine === 'H' ? 't' : 'o';
    out += st;
    thin += th;
  }
  return { states: out, thin };
}

/** Context string for sloped panels: side states, thinner-neighbour flags (thick roofing only), level. */
function panelKey(p, ctx, kind, rise) {
  const { states, thin } = sideStates(p, ctx, kind, rise);
  return states + (thin === '0000' ? '' : thin) + baseFlag(p, ctx);
}

/**
 * Where the eaves of a level-0 panel can reach: 'g' ground (eaves clamp to the ground), 'f' the panel
 * sits on a platform (foundation/floor/deck) — its eaves land on the plinth instead of diving through
 * it — 'u' upper levels (no clamp).
 */
function baseFlag(p, ctx) {
  if (p.y !== 0) return 'u';
  if ((p.h || 0) === 0 && ctx.get(K.F(p.x, 0, p.z))) return 'f';
  return 'g';
}

/** Same-height flat roofs on the 4 diagonals (for overhang corner ownership): '0'/'1' × 4 (++, +-, -+, --). */
function flatDiagonals(p, ctx) {
  const hs = 2 * p.y + (p.h || 0);
  let s = '';
  for (const [dx, dz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const q = ctx.get(K.R(p.x + dx, hs, p.z + dz));
    s += q && roofKind(ctx.defOf(q)) === 'flat' ? '1' : '0';
  }
  return s;
}

const isBoarded = (s) => s === 'e' || s === 'v' || s === 't';
const isJoined = (s) => s === 'j' || s === 'i' || s === 'n' || s === '1' || s === '2';
const isRidge = (s) => s === '1' || s === '2';
const groundFlag = (p) => (p.y === 0 ? 'g' : 'u');
// ===================================================================== sloped panels

/**
 * Build a sloped panel (slope / corner / inner / pyramid).
 *   states: side string from sideStates (pyramid: 'eeee')
 *   hole:   [u0, u1, v0, v1] opening (slopes only) or null
 */
function buildPanel(p, kind, rise, states, hole, opts = {}) {
  const g = new THREE.Group();
  const st = styleOf(p.m);
  const pyr = kind === 'pyramid';
  const R = rise * STEP;
  const rate = pyr ? R : R / 2;                       // metres of rise per metre of run
  const cosA = 1 / Math.hypot(1, rate);
  const Tv = tvOf(p.m);
  const H = heightFn(kind, R);
  const facets = facetsOf(kind, R);

  // ---- overhangs (eaves clamp to the ground at level 0)
  let E = EAVE;
  if (opts.platform) E = PLINTH_EAVE;
  else if (p.y === 0) {
    const room = BASE_Y + (p.h || 0) * STEP - 0.02;
    E = Math.max(0.05, Math.min(E, room / rate));
  }
  const ext = [...states].map((s) => (s === 'e' ? E : s === 'v' ? VERGE : 0));
  const x0 = -1 - ext[3], x1 = 1 + ext[1], z0 = -1 - ext[2], z1 = 1 + ext[0];
  let domain = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
  // mitre eaves that run into a valley panel: keep n_side·p + n_eave·p ≤ 2
  for (let i = 0; i < 4; i++) {
    if (states[i] !== 'i') continue;
    for (const j of [(i + 1) & 3, (i + 3) & 3]) {
      if (states[j] !== 'e') continue;
      domain = clipPoly(domain, [LS[i].n[0] + LS[j].n[0], LS[i].n[1] + LS[j].n[1], 2]);
    }
  }

  // ---- texture frame: whole courses per cell run; V continues across stacked panels
  const run = pyr ? 1 : 2;
  const N = Math.max(1, Math.round((run / cosA) / COURSE));
  const k = (N * COURSE) / run;
  const V0 = pyr ? 0 : (((p.h || 0) / rise) * N * COURSE) % 1;

  const M = new Mesher();
  const frameKey = 'frame';

  // ---- slab: top (roofing), underside (planks), sides (roofing)
  for (const f of facets) {
    let poly = clipAll(domain, f.clip);
    if (!poly.length) continue;
    const parts = hole ? splitAroundHole(poly, hole) : [poly];
    const e = [f.dir[1], -f.dir[0]];
    for (const part of parts) {
      const top = part.map(([u, v]) => [u, f.a * u + f.b * v + f.c + Tv, v]);
      const tuv = part.map(([u, v]) => [e[0] * u + e[1] * v, V0 + (f.dir[0] * u + f.dir[1] * v + 1) * k]);
      M.poly('roof', top, tuv, UP);
      const bot = part.map(([u, v]) => [u, f.a * u + f.b * v + f.c, v]);
      M.poly('under', bot, part.map(([u, v]) => [u, v]), DOWN);
    }
  }
  // outer side faces, split where the field has a kink (hip / valley lines)
  const kinks = KINKS[kind] || [];
  const c0 = centroid(domain);
  const thin = opts.thin || '0000';
  const sideOf = (A, B) => {
    if (Math.abs(A[1] - z1) < EPS && Math.abs(B[1] - z1) < EPS) return 0;
    if (Math.abs(A[0] - x1) < EPS && Math.abs(B[0] - x1) < EPS) return 1;
    if (Math.abs(A[1] - z0) < EPS && Math.abs(B[1] - z0) < EPS) return 2;
    if (Math.abs(A[0] - x0) < EPS && Math.abs(B[0] - x0) < EPS) return 3;
    return -1;
  };
  for (let i = 0; i < domain.length; i++) {
    const A = domain[i], B = domain[(i + 1) % domain.length];
    const si = sideOf(A, B);
    if (si >= 0 && isJoined(states[si]) && thin[si] !== '1') continue;   // hidden inside the neighbour
    const ts = [0, 1];
    for (const [nu, nv, d] of kinks) {
      const sa = nu * A[0] + nv * A[1] - d, sb = nu * B[0] + nv * B[1] - d;
      if ((sa < -EPS && sb > EPS) || (sa > EPS && sb < -EPS)) ts.push(sa / (sa - sb));
    }
    ts.sort((a, b) => a - b);
    let nx = B[1] - A[1], nz = -(B[0] - A[0]);
    if (nx * ((A[0] + B[0]) / 2 - c0[0]) + nz * ((A[1] + B[1]) / 2 - c0[1]) < 0) { nx = -nx; nz = -nz; }
    for (let t = 0; t + 1 < ts.length; t++) {
      const P = [A[0] + (B[0] - A[0]) * ts[t], A[1] + (B[1] - A[1]) * ts[t]];
      const Q = [A[0] + (B[0] - A[0]) * ts[t + 1], A[1] + (B[1] - A[1]) * ts[t + 1]];
      const yp = H(P[0], P[1]), yq = H(Q[0], Q[1]);
      const sp = P[0] * -nz + P[1] * nx, sq = Q[0] * -nz + Q[1] * nx;
      M.quad('roof', [P[0], yp, P[1]], [Q[0], yq, Q[1]], [Q[0], yq + Tv, Q[1]], [P[0], yp + Tv, P[1]],
        [sp, yp], [sq, yq], [sq, yq + Tv], [sp, yp + Tv], [nx, 0, nz]);
    }
  }

  // ---- edge finishing
  const sideLine = (i) => {
    // line n·p = c of side i on the (extended) domain
    const n = LS[i].n;
    const c = i === 0 ? z1 : i === 1 ? x1 : i === 2 ? -z0 : -x0;
    return { n, c };
  };
  const trimM = st.trim ? mat(st.trim) : null;

  if (st.round) {
    // thatch: soft rolled edges instead of boards, with a round bundle where two rolls meet
    const rr = st.t * 0.58, dl = rr * 0.35;
    const tm = mat(p.m, p.c);
    for (let i = 0; i < 4; i++) {
      if (!isBoarded(states[i])) continue;
      const { n, c } = sideLine(i);
      const ch = chord(domain, n, c - dl);
      if (!ch) continue;
      const [A, B] = ch;
      const yA = H(A[0], A[1]) + Tv * 0.5, yB = H(B[0], B[1]) + Tv * 0.5;
      rod(g, tm, [A[0], yA, A[1]], [B[0], yB, B[1]], rr, 10, true);
      // a mitred end (inside corner) gets a round cap; boarded corners get one below; joined ends stay open
      if (states[endSide(A, i)] === 'i') add(g, sphereGeo(rr, 9, 6), tm, A[0], yA, A[1]);
      if (states[endSide(B, i)] === 'i') add(g, sphereGeo(rr, 9, 6), tm, B[0], yB, B[1]);
      const j = (i + 1) & 3;
      if (isBoarded(states[j])) {
        const lj = sideLine(j);
        // intersection of the two inset lines (axis-aligned sides)
        const P = i & 1 ? [n[0] * (c - dl), lj.n[1] * (lj.c - dl)] : [lj.n[0] * (lj.c - dl), n[1] * (c - dl)];
        add(g, sphereGeo(rr * 1.04, 9, 6), tm, P[0], H(P[0], P[1]) + Tv * 0.5, P[1]);
      }
    }
  } else if (trimM) {
    // fascia / barge / top boards: they stand OUT proud of the roof edge and cover the slab end, leaving
    // a thin lip of roofing on top. ±Z boards own the corners (they run out to the ±X boards' outer
    // faces); ±X boards start at the ±Z boards' inner faces; mitred ends stop on the mitre line.
    for (let i = 0; i < 4; i++) {
      if (!isBoarded(states[i])) continue;
      const { n, c } = sideLine(i);
      const ch = chord(domain, n, c);
      if (!ch) continue;
      let [A, B] = ch;
      const along = [B[0] - A[0], B[1] - A[1]];
      const L = Math.hypot(along[0], along[1]);
      const d = [along[0] / L, along[1] / L];
      const shift = (P, end) => {
        const j = endSide(P, i);
        let m = 0;
        if (isBoarded(states[j])) m = i === 1 || i === 3 ? -(FT - OUT) : OUT;
        else if (states[j] === 'i' && states[i] === 'e') m = -OUT;
        return [P[0] + d[0] * m * end, P[1] + d[1] * m * end];
      };
      A = shift(A, -1); B = shift(B, 1);
      const skip = [];
      if (isJoined(states[endSide(A, i)])) skip.push(3);
      if (isJoined(states[endSide(B, i)])) skip.push(1);
      board(M, 'trim', A, B, n, H, Tv, skip);
    }
  }

  // ---- ridge caps (owner side only) & open-top cap
  for (let i = 0; i < 4; i++) {
    const s = states[i];
    if (!isRidge(s)) continue;
    const { n, c } = sideLine(i);
    const ch = chord(domain, n, c);
    if (!ch) continue;
    const skipA = isJoined(states[endSide(ch[0], i)]), skipB = isJoined(states[endSide(ch[1], i)]);
    ridgeCap(g, M, st, p, ch, n, H, Tv, rate, (+s) * STEP / 2, [skipA, skipB]);
  }

  // ---- hip / valley lines
  if (kind === 'corner' || kind === 'inner') {
    const lo = Math.max(x0, z0), hi = Math.min(x1, z1);
    if (hi - lo > 0.05) {
      const A = [lo, lo], B = [hi, hi];
      const contA = isJoined(states[2]) && isJoined(states[3]), contB = isJoined(states[0]) && isJoined(states[1]);
      if (kind === 'corner') hipCap(g, M, st, p, A, B, facets, H, Tv, [contA, contB]);
      else valleyStrip(g, M, st, A, B, facets, Tv);
    }
  } else if (pyr) {
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) hipCap(g, M, st, p, [sx * x1, sz * z1], [0, 0], facets, H, Tv);
  }

  // ---- standing seams (metal)
  if (st.seams) {
    for (const f of facets) {
      const poly = clipAll(domain, f.clip);
      if (!poly.length) continue;
      const e = [f.dir[1], -f.dir[0]];
      for (let cpos = -1.75; cpos <= 1.751; cpos += 0.5) {
        const ch = chord(poly, e, cpos);
        if (!ch) continue;
        for (const [A, B] of splitChordAroundHole(ch, hole, 0.1)) seam(M, A, B, f, Tv);
      }
    }
  }

  // ---- openings (skylight / big glass)
  if (hole) opening(g, M, p, hole, facets[0], Tv, opts.big, frameKey);

  const mats = { roof: mat(p.m, p.c), under: mat('wood'), trim: trimM, frame: mat(opts.big ? 'timber' : 'trim'), glass: mat('windowGlass') };
  M.emit(g, mats);
  return g;
}

/** Which side (0..3) an endpoint of a chord on side i lies against (for corner ownership), or -1. */
function endSide(P, i) {
  // boards on ±X sides run along v: their ends touch the ±Z sides
  if (i === 1 || i === 3) return P[1] > 0 ? 0 : 2;
  return P[0] > 0 ? 1 : 3;
}

function insideFacet(f, P) {
  for (const [nu, nv, d] of f.clip) if (nu * P[0] + nv * P[1] - d > EPS) return false;
  return true;
}

function splitAroundHole(poly, [hu0, hu1, hv0, hv1]) {
  const parts = [];
  const below = clipPoly(poly, [0, 1, hv0]);
  const above = clipPoly(poly, [0, -1, -hv1]);
  const mid = clipAll(poly, [[0, -1, -hv0], [0, 1, hv1]]);
  if (below.length) parts.push(below);
  if (above.length) parts.push(above);
  if (mid.length) {
    const l = clipPoly(mid, [1, 0, hu0]);
    const r = clipPoly(mid, [-1, 0, -hu1]);
    if (l.length) parts.push(l);
    if (r.length) parts.push(r);
  }
  return parts;
}

function splitChordAroundHole(ch, hole, pad) {
  if (!hole) return [ch];
  const [A, B] = ch;
  const [hu0, hu1, hv0, hv1] = [hole[0] - pad, hole[1] + pad, hole[2] - pad, hole[3] + pad];
  // seams on slopes run along v at constant u
  if (Math.abs(A[0] - B[0]) > EPS || A[0] < hu0 || A[0] > hu1) return [ch];
  const lo = Math.min(A[1], B[1]), hi = Math.max(A[1], B[1]);
  const out = [];
  if (hv0 > lo) out.push([[A[0], lo], [A[0], Math.min(hv0, hi)]]);
  if (hv1 < hi) out.push([[A[0], Math.max(hv1, lo)], [A[0], hi]]);
  return out;
}

/**
 * A fascia/barge board on the roof edge A→B (plan) with outward normal n: its outer face stands OUT
 * proud of the edge, it is FT thick, its top stops LIP below the roofing surface and it hangs DROP
 * below the underside.
 */
function board(M, k, A, B, n, H, Tv, skip) {
  const o = [n[0] * OUT, n[1] * OUT], ii = [-n[0] * (FT - OUT), -n[1] * (FT - OUT)];
  const Ao = [A[0] + o[0], A[1] + o[1]], Bo = [B[0] + o[0], B[1] + o[1]];
  const Ai = [A[0] + ii[0], A[1] + ii[1]], Bi = [B[0] + ii[0], B[1] + ii[1]];
  const yA = H(A[0], A[1]), yB = H(B[0], B[1]);
  const tA = yA + Tv - LIP, tB = yB + Tv - LIP;
  const bA = yA - DROP, bB = yB - DROP;
  prism(M, k, [Ao, Bo, Bi, Ai], [bA, bB, bB, bA], [tA, tB, tB, tA], { skip });
}

/**
 * Ridge cap along chord [A,B] on side normal n (pointing to the partner panel).
 * rate: our metres-of-rise per metre; rateP: partner's.
 */
function ridgeCap(g, M, st, p, [A, B], n, H, Tv, rate, rateP, [joinA, joinB]) {
  const yR = H(A[0], A[1]);
  const TvP = Tv;
  if (st.cap === 'v') {
    const w = 0.17, ct = 0.05;
    const inw = [-n[0] * w, -n[1] * w], out = [n[0] * w, n[1] * w];
    // our side
    const ours = [A, B, [B[0] + inw[0], B[1] + inw[1]], [A[0] + inw[0], A[1] + inw[1]]];
    const yo = [yR + Tv, yR + Tv, yR + Tv - w * rate, yR + Tv - w * rate];
    const skip = [0];
    if (joinB) skip.push(1);
    if (joinA) skip.push(3);
    prism(M, 'roof', ours, yo, yo.map((y) => y + ct), { skip, noBottom: true });
    const theirs = [A, B, [B[0] + out[0], B[1] + out[1]], [A[0] + out[0], A[1] + out[1]]];
    const yt = [yR + TvP, yR + TvP, yR + TvP - w * rateP, yR + TvP - w * rateP];
    prism(M, 'roof', theirs, yt, yt.map((y) => y + ct), { skip, noBottom: true });
  } else {
    // round ridge (tile) / thick ridge roll (thatch); free ends poke out a little (thatch: rounded)
    const roll = st.cap === 'roll';
    const r = roll ? 0.22 : 0.12;
    const y = yR + Math.min(Tv, TvP) - (roll ? 0.08 : 0.03);
    const ext = roll ? 0.08 : 0.04;
    const d = [B[0] - A[0], B[1] - A[1]];
    const L = Math.hypot(d[0], d[1]);
    const ea = joinA ? 0 : ext, eb = joinB ? 0 : ext;
    const a = [A[0] - d[0] / L * ea, y, A[1] - d[1] / L * ea], b = [B[0] + d[0] / L * eb, y, B[1] + d[1] / L * eb];
    const m = mat(p.m, p.c);
    rod(g, m, a, b, r, roll ? 10 : 8, roll);
    if (roll) for (const [e, P] of [[joinA, a], [joinB, b]]) if (!e) add(g, sphereGeo(r, 10, 6), m, P[0], P[1], P[2]);
  }
}

/** Hip cap along the line A→B lying between two facets. */
function hipCap(g, M, st, p, A, B, facets, H, Tv, [contA, contB] = [false, false]) {
  const d = [B[0] - A[0], B[1] - A[1]];
  const L = Math.hypot(d[0], d[1]);
  if (L < 0.05) return;
  const nrm = [-d[1] / L, d[0] / L];
  if (st.cap === 'v') {
    const w = 0.15, ct = 0.045;
    for (const s of [1, -1]) {
      const o = [nrm[0] * w * s, nrm[1] * w * s];
      const probe = [(A[0] + B[0]) / 2 + o[0] * 0.5, (A[1] + B[1]) / 2 + o[1] * 0.5];
      const f = facets.find((ff) => insideFacet(ff, probe)) || facets[0];
      const pts = [A, B, [B[0] + o[0], B[1] + o[1]], [A[0] + o[0], A[1] + o[1]]];
      const y = pts.map(([u, v]) => f.a * u + f.b * v + f.c + Tv);
      const skip = [0];
      if (contB) skip.push(1);
      if (contA) skip.push(3);
      prism(M, 'roof', pts, y, y.map((yy) => yy + ct), { skip, noBottom: true });
    }
  } else {
    const r = st.cap === 'roll' ? 0.17 : 0.1;
    const lift = Tv + (st.cap === 'roll' ? -0.05 : -0.02);
    rod(g, mat(p.m, p.c), [A[0], H(A[0], A[1]) + lift, A[1]], [B[0], H(B[0], B[1]) + lift, B[1]], r, st.cap === 'roll' ? 9 : 7);
  }
}

/** Valley flashing: a thin metal strip lying in the fold. */
function valleyStrip(g, M, st, A, B, facets, Tv) {
  if (!st.valley) return;
  const d = [B[0] - A[0], B[1] - A[1]];
  const L = Math.hypot(d[0], d[1]);
  const nrm = [-d[1] / L, d[0] / L];
  const w = 0.08, ct = 0.014;
  for (const s of [1, -1]) {
    const o = [nrm[0] * w * s, nrm[1] * w * s];
    const probe = [(A[0] + B[0]) / 2 + o[0] * 0.5, (A[1] + B[1]) / 2 + o[1] * 0.5];
    const f = facets.find((ff) => insideFacet(ff, probe)) || facets[0];
    const pts = [A, B, [B[0] + o[0], B[1] + o[1]], [A[0] + o[0], A[1] + o[1]]];
    const y = pts.map(([u, v]) => f.a * u + f.b * v + f.c + Tv);
    prism(M, 'roof', pts, y.map((yy) => yy - 0.01), y.map((yy) => yy + ct), { noBottom: true, skip: [0] });
  }
}

/** Standing seam on a facet along chord A→B. */
function seam(M, A, B, f, Tv) {
  const d = [B[0] - A[0], B[1] - A[1]];
  const L = Math.hypot(d[0], d[1]);
  if (L < 0.12) return;
  const t = [d[0] / L, d[1] / L];
  const a = [A[0] + t[0] * 0.02, A[1] + t[1] * 0.02], b = [B[0] - t[0] * 0.02, B[1] - t[1] * 0.02];
  const w = 0.018;
  const o = [-t[1] * w, t[0] * w];
  const pts = [[a[0] - o[0], a[1] - o[1]], [b[0] - o[0], b[1] - o[1]], [b[0] + o[0], b[1] + o[1]], [a[0] + o[0], a[1] + o[1]]];
  const y = pts.map(([u, v]) => f.a * u + f.b * v + f.c + Tv);
  prism(M, 'roof', pts, y.map((yy) => yy - 0.005), y.map((yy) => yy + 0.04), { noBottom: true });
}

/** Skylight / A-frame glass: hole reveal, raised frame, glass pane and muntins. */
function opening(g, M, p, [u0, u1, v0, v1], f, Tv, big, frameKey) {
  const Hf = (u, v) => f.a * u + f.b * v + f.c;
  // reveal (inside faces of the hole)
  const ring = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
  const cc = [(u0 + u1) / 2, (v0 + v1) / 2];
  for (let i = 0; i < 4; i++) {
    const A = ring[i], B = ring[(i + 1) % 4];
    const nx = cc[0] - (A[0] + B[0]) / 2, nz = cc[1] - (A[1] + B[1]) / 2;
    const ya = Hf(A[0], A[1]), yb = Hf(B[0], B[1]);
    M.quad(frameKey, [A[0], ya, A[1]], [B[0], yb, B[1]], [B[0], yb + Tv, B[1]], [A[0], ya + Tv, A[1]],
      [0, 0], [1, 0], [1, 1], [0, 1], [nx, 0, nz]);
  }
  // raised frame (curb) around the opening
  const FW = big ? 0.09 : 0.08, CH = big ? 0.06 : 0.09;
  const fr = (pts) => {
    const b = pts.map(([u, v]) => Hf(u, v) + Tv - 0.005);
    prism(M, frameKey, pts, b, b.map((y) => y + 0.005 + CH));
  };
  fr([[u0 - FW, v0 - FW], [u1 + FW, v0 - FW], [u1 + FW, v0], [u0 - FW, v0]]);
  fr([[u0 - FW, v1], [u1 + FW, v1], [u1 + FW, v1 + FW], [u0 - FW, v1 + FW]]);
  fr([[u0 - FW, v0], [u0, v0], [u0, v1], [u0 - FW, v1]]);
  fr([[u1, v0], [u1 + FW, v0], [u1 + FW, v1], [u1, v1]]);
  // glass pane (thin, visible from inside and out)
  const gy = Tv + (big ? CH * 0.4 : CH * 0.55);
  const gp = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
  const gb = gp.map(([u, v]) => Hf(u, v) + gy);
  prism(M, 'glass', gp, gb, gb.map((y) => y + 0.02));
  if (big) {
    // muntins: one upright, two cross bars
    const mw = 0.045;
    const mt = (pts) => {
      const b = pts.map(([u, v]) => Hf(u, v) + gy - 0.01);
      prism(M, frameKey, pts, b, b.map((y) => y + 0.06));
    };
    mt([[-mw, v0], [mw, v0], [mw, v1], [-mw, v1]]);
    for (const vv of [v0 + (v1 - v0) * 0.36, v0 + (v1 - v0) * 0.7]) mt([[u0, vv - mw], [u1, vv - mw], [u1, vv + mw], [u0, vv + mw]]);
  }
}

// ===================================================================== registration helpers

const PANEL_ICONS = { slope: '📐', corner: '◣', inner: '◢' };

function panel(id, name, kind, rise, extra = {}) {
  const hole = extra.hole || null;
  const big = !!extra.big;
  delete extra.hole; delete extra.big;
  registerPiece({
    id, name, cat: 'roof', slot: 'cell', layer: 'R', mats: ROOF_MATS, matGroup: 'roof', paint: true,
    roof: { rise, kind }, contextual: true, icon: PANEL_ICONS[kind] || '🏠', sound: 'wood',
    thumb: { y: 1, r: 2 }, showcase: { r: 2 },
    contextKey: (p, ctx) => panelKey(p, ctx, kind, rise),
    build(p, ctx) {
      const { states, thin } = sideStates(p, ctx, kind, rise);
      return buildPanel(p, kind, rise, states, hole, { big, thin, platform: baseFlag(p, ctx) === 'f' });
    },
    ...extra,
  });
}

// ===================================================================== pieces

panel('roof_slope', 'Roof Slope', 'slope', 1, { desc: 'A gentle roof panel. Stack them toward the ridge — eaves, gables and ridge caps finish themselves.' });
panel('roof_steep', 'Steep Roof', 'slope', 2, { icon: '🔺', desc: 'A steep A-frame panel that rises a whole storey per cell.' });
panel('roof_corner', 'Hip Corner', 'corner', 1, { desc: 'Outer corner for hip roofs: slopes down on two sides.' });
panel('roof_inner', 'Valley Corner', 'inner', 1, { desc: 'Inside corner where two roof wings meet — for L-shaped houses.' });
panel('roof_corner_steep', 'Steep Hip Corner', 'corner', 2, { desc: 'A steep outer hip corner.' });
panel('roof_inner_steep', 'Steep Valley Corner', 'inner', 2, { desc: 'A steep inside (valley) corner.' });
panel('roof_window', 'Skylight', 'slope', 1, {
  icon: '🌤️', sound: 'glass', hole: [-0.42, 0.42, -0.5, 0.36],
  desc: 'A gentle roof panel with a skylight to let the sunshine in.',
});
panel('roof_steep_window', 'A-Frame Glass', 'slope', 2, {
  icon: '🔷', sound: 'glass', hole: [-0.8, 0.8, -0.8, 0.7], big: true,
  desc: 'A steep panel that is mostly glass — perfect for cosy A-frame cabins.',
});

// ---------------------------------------------------------------- flat roof
// A slab ROOF_T+ thick with planks underneath. Open sides get a short overhang, a fascia board and a
// raised lip. Corner ownership (no overlaps): ±X strips own convex corners, ±Z strips are trimmed at
// concave (L-shaped) corners; lips meet in tidy L joints.

const FLAT = { T: 0.16, O: 0.2, LW: 0.1, LH: 0.11 };

function buildFlat(p, states, diag) {
  const g = new THREE.Group();
  const M = new Mesher();
  const { T, O, LW, LH } = FLAT;
  const open = [...states].map((s) => s === 'o');        // 0 +Z, 1 +X, 2 −Z, 3 −X
  // diag order: (+x,+z) (+x,−z) (−x,+z) (−x,−z)
  const hasDiag = (sx, sz) => diag[(sx > 0 ? 0 : 2) + (sz > 0 ? 0 : 1)] === '1';
  const sideOpen = (sx, sz) => (sx ? open[sx > 0 ? 1 : 3] : open[sz > 0 ? 0 : 2]);
  const rect = (u0, u1, v0, v1) => [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
  // rect edges: 0 = v0 side, 1 = u1 side, 2 = v1 side, 3 = u0 side
  const boxP = (k, u0, u1, y0, y1, v0, v1, skip) => prism(M, k, rect(u0, u1, v0, v1), [y0, y0, y0, y0], [y1, y1, y1, y1], { skip });
  const slab = (u0, u1, v0, v1, skip) => {
    // roofing on top and on exposed sides, planks underneath
    const pts = rect(u0, u1, v0, v1);
    prism(M, 'roof', pts, [0, 0, 0, 0], [T, T, T, T], { noBottom: true, skip });
    M.poly('under', pts.map(([u, v]) => [u, 0, v]), pts, DOWN);
  };
  slab(-1, 1, -1, 1, [0, 1, 2, 3]);
  for (const sx of [-1, 1]) {
    if (!sideOpen(sx, 0)) continue;
    const conv = (sz) => sideOpen(0, sz) && !hasDiag(sx, sz);
    const cont = (sz) => !conv(sz) && !hasDiag(sx, sz);     // the neighbour's strip carries on
    const za = conv(-1) ? -1 - O : -1, zb = conv(1) ? 1 + O : 1;
    const ua = sx > 0 ? 1 : -1 - O, ub = sx > 0 ? 1 + O : -1;
    const ends = [...(conv(-1) ? [] : [0]), ...(conv(1) ? [] : [2])];
    slab(ua, ub, za, zb, [sx > 0 ? 3 : 1, ...ends]);
    // raised lip along the outer edge (owns convex corners)
    const la = conv(-1) ? -1 - O : hasDiag(sx, -1) ? -1 + O - LW : -1;
    const lb = conv(1) ? 1 + O : hasDiag(sx, 1) ? 1 - O + LW : 1;
    const lends = [...(cont(-1) ? [0] : []), ...(cont(1) ? [2] : [])];
    boxP('trim', sx > 0 ? ub - LW : ua, sx > 0 ? ub : ua + LW, T - 0.01, T + LH, la, lb, lends);
    // fascia board under the edge
    const fa = conv(-1) ? -1 - O + INSET : hasDiag(sx, -1) ? -1 + O - INSET : -1;
    const fb = conv(1) ? 1 + O - INSET : hasDiag(sx, 1) ? 1 - O + INSET : 1;
    boxP('trim', sx > 0 ? ub - INSET - FT : ua + INSET, sx > 0 ? ub - INSET : ua + INSET + FT, -DROP, 0.04, fa, fb, lends);
  }
  for (const sz of [-1, 1]) {
    if (!sideOpen(0, sz)) continue;
    const conv = (sx) => sideOpen(sx, 0) && !hasDiag(sx, sz);
    const cont = (sx) => !conv(sx) && !hasDiag(sx, sz);
    const ua = hasDiag(-1, sz) ? -1 + O : -1, ub = hasDiag(1, sz) ? 1 - O : 1;
    const va = sz > 0 ? 1 : -1 - O, vb = sz > 0 ? 1 + O : -1;
    slab(ua, ub, va, vb, [sz > 0 ? 0 : 2, 1, 3]);
    const la = conv(-1) ? -1 - O + LW : hasDiag(-1, sz) ? -1 + O : -1;
    const lb = conv(1) ? 1 + O - LW : hasDiag(1, sz) ? 1 - O : 1;
    const lends = [...(cont(-1) ? [3] : []), ...(cont(1) ? [1] : [])];
    boxP('trim', la, lb, T - 0.01, T + LH, sz > 0 ? vb - LW : va, sz > 0 ? vb : va + LW, lends);
    const fa = conv(-1) ? -1 - O + INSET + FT : hasDiag(-1, sz) ? -1 + O - INSET : -1;
    const fb = conv(1) ? 1 + O - INSET - FT : hasDiag(1, sz) ? 1 - O + INSET : 1;
    boxP('trim', fa, fb, -DROP, 0.04, sz > 0 ? vb - INSET - FT : va + INSET, sz > 0 ? vb - INSET : va + INSET + FT, lends);
  }
  M.emit(g, { roof: mat(p.m, p.c), under: mat('wood'), trim: mat('trim') });
  return g;
}

registerPiece({
  id: 'roof_flat', name: 'Flat Roof', cat: 'roof', slot: 'cell', layer: 'R', rot: 'none',
  mats: ROOF_MATS, matGroup: 'roof', paint: true, roof: { rise: 0, kind: 'flat' }, contextual: true,
  icon: '▭', sound: 'wood', thumb: { y: 1 },
  desc: 'A flat roof deck with a neat raised edge — for porches, dormers and modern nooks.',
  contextKey: (p, ctx) => sideStates(p, ctx, 'flat', 0).states + flatDiagonals(p, ctx),
  build(p, ctx) { return buildFlat(p, sideStates(p, ctx, 'flat', 0).states, flatDiagonals(p, ctx)); },
});

// ---------------------------------------------------------------- pyramid cap

registerPiece({
  id: 'roof_pyramid', name: 'Pyramid Cap', cat: 'roof', slot: 'cell', layer: 'R', rot: 'none',
  mats: ROOF_MATS, matGroup: 'roof', paint: true, roof: { rise: 1, kind: 'cap' },
  icon: '🔼', sound: 'wood', thumb: { y: 1 },
  cacheExtra: groundFlag,
  desc: 'A pointed four-sided cap with a finial — for gazebos, towers and garden sheds.',
  build(p) {
    const g = buildPanel(p, 'pyramid', 1, 'eeee', null);
    const st = styleOf(p.m);
    const R = STEP, Tv = st.t * Math.hypot(1, R);
    const top = R + Tv;
    if (st.round) {
      add(g, sphereGeo(0.24, 12, 8), mat(p.m, p.c), 0, top - 0.12, 0);
      add(g, cylGeo(0.035, 0.05, 0.3, 6), mat('timber'), 0, top + 0.18, 0);
    } else {
      add(g, cylGeo(0.07, 0.11, 0.16, 8), mat('timber'), 0, top - 0.02, 0);
      add(g, cylGeo(0.03, 0.03, 0.26, 6), mat('timber'), 0, top + 0.19, 0);
      add(g, sphereGeo(0.075, 10, 7), mat('trim'), 0, top + 0.34, 0);
      add(g, coneGeo(0.035, 0.14, 6), mat('trim'), 0, top + 0.47, 0);
    }
    return g;
  },
});

// ---------------------------------------------------------------- chimney
// Brick or stone stack with a hearth (glowing embers at night) on its local +Z face, a corbelled crown,
// a stone cap and two clay pots. Tall enough to poke through a typical roof built above it.

const CH = { W: 0.9, H: 4.3 };

registerPiece({
  id: 'chimney', name: 'Chimney', cat: 'roof', slot: 'cell', layer: 'I',
  mats: ['brick', 'stone'], matGroup: 'chimney', icon: '🧱', sound: 'stone',
  emitter: 'smoke', emitterOffset: [0.17, CH.H + 0.16, 0],
  cacheExtra: groundFlag, thumb: { y: 1 },
  desc: 'A brick chimney with a crackling hearth. Smoke curls from its pots.',
  build(p) {
    const g = new THREE.Group();
    const m = mat(p.m);
    const cap = mat('stoneBlock');
    const W = CH.W, h2 = W / 2;
    const y0 = p.y === 0 ? -BASE_Y : 0;
    const crownY = CH.H - 0.45;
    const fbH = 1.05;                         // hearth opening height
    const ow = 0.56;                          // hearth opening width
    // base plinth + hearth stone
    add(g, boxGeo(W + 0.12, 0.12 - y0, W + 0.1), cap, 0, (y0 + 0.12) / 2, 0);
    add(g, boxGeo(W + 0.3, 0.06, 0.36), cap, 0, 0.15, h2 + 0.15);
    // firebox: side cheeks + lintel, recessed back
    const cheek = (W - ow) / 2;
    add(g, boxGeo(cheek, fbH, W), m, -(ow / 2 + cheek / 2), 0.12 + fbH / 2, 0);
    add(g, boxGeo(cheek, fbH, W), m, ow / 2 + cheek / 2, 0.12 + fbH / 2, 0);
    add(g, boxGeo(ow, fbH, W - 0.36), m, 0, 0.12 + fbH / 2, -0.18);
    add(g, boxGeo(ow, fbH - 0.02, 0.02), mat('iron'), 0, 0.12 + fbH / 2, h2 - 0.37);   // sooty back
    add(g, boxGeo(ow + 0.02, 0.02, 0.34), mat('iron'), 0, 0.13, h2 - 0.17);
    add(g, boxGeo(ow - 0.12, 0.09, 0.2), mat('ember'), 0, 0.185, h2 - 0.24);
    add(g, boxGeo(0.07, 0.07, 0.42), mat('timber'), -0.1, 0.25, h2 - 0.22, 0, 0.35, 0);
    add(g, boxGeo(0.07, 0.07, 0.42), mat('timber'), 0.1, 0.25, h2 - 0.22, 0, -0.35, 0);
    // mantel shelf
    add(g, boxGeo(W + 0.26, 0.09, 0.22), mat('timber'), 0, 0.12 + fbH + 0.045, h2 + 0.05);
    // stack
    const sy = 0.12 + fbH;
    add(g, boxGeo(W, crownY - sy, W), m, 0, (sy + crownY) / 2, 0);
    // corbelled crown + cap slab
    add(g, boxGeo(W + 0.1, 0.12, W + 0.1), m, 0, crownY + 0.06, 0);
    add(g, boxGeo(W + 0.04, 0.1, W + 0.04), m, 0, crownY + 0.17, 0);
    add(g, boxGeo(W + 0.16, 0.08, W + 0.16), cap, 0, crownY + 0.26, 0);
    // clay pots
    const pot = mat('roofTile');
    const py = crownY + 0.3;
    add(g, cylGeo(0.1, 0.12, 0.22, 10), pot, 0.17, py + 0.11, 0);
    add(g, cylGeo(0.12, 0.1, 0.04, 10), pot, 0.17, py + 0.24, 0);
    add(g, cylGeo(0.08, 0.1, 0.16, 10), pot, -0.19, py + 0.08, 0.05);
    return g;
  },
});
