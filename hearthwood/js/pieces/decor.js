// Hearthwood — the cozy things: furniture (cat 'interior') and garden items (cat 'garden').
//
// Every piece is a layer-'I' cell piece (rot 'four', local +Z = front). Wall-hugging furniture
// (bed, bookshelf, dresser, kitchen, piano, fireplace…) puts its back on the local −Z side.
//
// Standing height is contextual: all decor looks at the F-layer piece in its own cell.
//   level 0, no platform → stands on the GROUND (local y = −BASE_Y)
//   level 0, garden path → on the path stones (just above the ground)
//   level 0, foundation / deck / floor → on the floor top (local y = 0)
//   upper levels → on the floor top (+LIFT); on a flat roof laid on that level (a roof terrace) → on its deck
//   (world.validate keeps cozy & garden things off upper levels with nothing under them)
// So a bench on the porch deck, a plant on the lawn and a chair in the parlour all sit right.
// contextKey = that one-letter surface code (+ an optional neighbour code), so templates stay cached.
// A few pieces also read their neighbours (def.nb → part of contextKey):
//   chair      facing a table in the next cell → tucks right up to it (further on the table's long side)
//   nightstand beside a bed (local ±X) → slides over next to it
// Per-position variety (flower mixes, book shelves, tree shapes…) uses def.cacheExtra = variant 0..3.
// Materials: only mat() ids; fabric/ceramic/paintedWood take per-piece colours (few per piece).
// Builds return small-box/sphere/lathe assemblies; world.mergeByMaterial flattens them per material.

import * as THREE from 'three';
import { registerPiece } from '../catalog.js';
import { BASE_Y, LEVEL_H, WALL_T, K, DIRS } from '../config.js';
import { mat } from '../materials.js';
import { boxGeo, cylGeo, sphereGeo, coneGeo, prismGeo, cached, add } from '../geom.js';

const PI = Math.PI;
const TAU = PI * 2;
const r3 = (n) => Math.round(n * 1000) / 1000;
const BACK = -1 + WALL_T / 2 + 0.02;     // furniture backs stand just off a wall on the local −Z edge

// ====================================================================== standing surface

const SURF_Y = { g: -BASE_Y, p: -BASE_Y + 0.025, f: 0, u: 0.006, r: 0.166 };   // r: on a flat roof's deck (0.16 thick)

function surface(p, ctx) {
  if (p.y > 0) {
    const f = ctx.get(K.F(p.x, p.y, p.z));
    if (f && f.t !== 'pergola') return 'u';
    return ctx.defOf(ctx.get(K.R(p.x, 2 * p.y, p.z)))?.roof?.kind === 'flat' ? 'r' : 'u';
  }
  const f = ctx.get(K.F(p.x, 0, p.z));
  if (!f) return 'g';
  if (f.t === 'path') return 'p';
  if (f.t === 'steps') return 'g';
  return 'f';
}

const variantOf = (p) => ((p.x * 7 + p.z * 13) % 4 + 4) % 4;
const variantKey = (p) => String(variantOf(p));

/** Small deterministic PRNG (xorshift). */
function rng(seed) {
  let s = ((seed + 1) * 2654435761) >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

const _ca = new THREE.Color(), _cb = new THREE.Color();
/** Lighten (f > 0) or darken (f < 0) a hex colour. */
function tint(hex, f) {
  _ca.set(hex);
  _cb.set(f >= 0 ? '#fff8ec' : '#1a1210');
  _ca.lerp(_cb, Math.min(1, Math.abs(f)));
  return '#' + _ca.getHexString();
}

// ====================================================================== palette & materials

const COL = {
  linen: '#f3ece0', pillow: '#fbf7ee', wax: '#f6eedc', cream: '#efe3c8', mustard: '#e9c46a',
  terracotta: '#c0643f', apple: '#c8382e', red: '#b4473a', rust: '#c96a5a', sage: '#9cae6b',
  teal: '#7fa7a3', denim: '#5d7fa3', navy: '#2f4a66', plum: '#6b5b8e', charcoal: '#2f2a28',
  mirror: '#cfe0e4', paper: '#fbf6ea', pink: '#e7a0a0', soot: '#2a2522',
};
const fab = (c) => mat('fabric', c);
const cer = (c) => mat('ceramic', c);
/** Main furniture material: paintedWood takes the paint colour (or a per-piece default). */
const woodOf = (p, def = '#efe3c8') => (p.m === 'paintedWood' ? mat('paintedWood', p.c || def) : mat(p.m || 'wood'));
const BOOK_COLS = ['#8e3b32', '#2f4a66', '#4f7a6a', '#d9a441', '#6b5b8e', '#efe3c8'];

// ====================================================================== geometry helpers (all cached)

/** Average normals of coincident vertices (sphere seams & poles) so displaced shapes shade smoothly. */
function smoothSeams(g) {
  const pos = g.attributes.position, nor = g.attributes.normal;
  const groups = new Map();
  for (let i = 0; i < pos.count; i++) {
    const k = Math.round(pos.getX(i) * 1e4) + '|' + Math.round(pos.getY(i) * 1e4) + '|' + Math.round(pos.getZ(i) * 1e4);
    let a = groups.get(k);
    if (!a) groups.set(k, (a = []));
    a.push(i);
  }
  const n = new THREE.Vector3();
  for (const a of groups.values()) {
    if (a.length < 2) continue;
    n.set(0, 0, 0);
    for (const i of a) { n.x += nor.getX(i); n.y += nor.getY(i); n.z += nor.getZ(i); }
    if (n.lengthSq() < 1e-12) continue;
    n.normalize();
    for (const i of a) nor.setXYZ(i, n.x, n.y, n.z);
  }
}

function finish(g, us = 1, vs = 1) {
  g.computeVertexNormals();
  smoothSeams(g);
  const uv = g.attributes.uv;
  if (uv) for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * us, uv.getY(i) * vs);
  return g;
}

/** Superellipsoid "cushion": a rounded box w×h×d centred at the origin (e: 1 = ellipsoid, →0 = box). */
function puffGeo(w, h, d, e = 0.35, ws = 12, hs = 8) {
  return cached(`dc-puff|${r3(w)}|${r3(h)}|${r3(d)}|${e}|${ws}|${hs}`, () => {
    const g = new THREE.SphereGeometry(1, ws, hs);
    const pos = g.attributes.position;
    const sp = (v) => Math.sign(v) * Math.pow(Math.abs(v), e);
    for (let i = 0; i < pos.count; i++) pos.setXYZ(i, sp(pos.getX(i)) * w / 2, sp(pos.getY(i)) * h / 2, sp(pos.getZ(i)) * d / 2);
    return finish(g, w + d, h);
  });
}

/** Lumpy sphere for foliage (deterministic per seed). Underside slightly tucked. */
function blobGeo(r, seed = 0, amp = 0.13, ws = 11, hs = 8) {
  return cached(`dc-blob|${r3(r)}|${seed}|${amp}|${ws}|${hs}`, () => {
    const g = new THREE.SphereGeometry(r, ws, hs);
    const pos = g.attributes.position;
    const s = seed * 1.731;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) / r, y = pos.getY(i) / r, z = pos.getZ(i) / r;
      const n = 0.55 * Math.sin(3.1 * x + 1.7 * y + s) * Math.cos(2.6 * z - 1.1 * y + s * 0.7)
        + 0.3 * Math.sin(5.3 * y + 2.2 * z + s * 1.9)
        + 0.2 * Math.cos(6.1 * x - 4.3 * z + s * 2.3);
      const k = 1 + amp * n;
      let yy = y * k;
      if (yy < 0) yy *= 0.8;
      pos.setXYZ(i, x * k * r, yy * r, z * k * r);
    }
    return finish(g, TAU * r, PI * r);
  });
}

/** Lathe from [radius, y] profile points; UVs in meters. */
function latheGeo(key, pts, seg = 14) {
  return cached(`dc-lathe|${key}|${seg}`, () => {
    const g = new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);
    let len = 0, rmax = 0;
    for (let i = 0; i < pts.length; i++) {
      rmax = Math.max(rmax, pts[i][0]);
      if (i) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    }
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * TAU * rmax, uv.getY(i) * len);
    return g;
  });
}

const torusGeo = (R, r, rs = 6, ts = 16, arc = TAU) =>
  cached(`dc-torus|${r3(R)}|${r3(r)}|${rs}|${ts}|${r3(arc)}`, () => new THREE.TorusGeometry(R, r, rs, ts, arc));

/** Tapered tube through points (Catmull-Rom), radius r0 → r1. */
function tubeGeo(key, pts, r0, r1 = r0, segs = 12, rad = 6) {
  return cached(`dc-tube|${key}`, () => {
    const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
    const g = new THREE.TubeGeometry(curve, segs, 1, rad, false);
    const pos = g.attributes.position;
    const c = new THREE.Vector3();
    for (let i = 0; i <= segs; i++) {
      curve.getPointAt(i / segs, c);
      const rr = r0 + (r1 - r0) * (i / segs);
      for (let j = 0; j <= rad; j++) {
        const k = i * (rad + 1) + j;
        pos.setXYZ(k, c.x + (pos.getX(k) - c.x) * rr, c.y + (pos.getY(k) - c.y) * rr, c.z + (pos.getZ(k) - c.z) * rr);
      }
    }
    return g;
  });
}

/** Ribbed, squat pumpkin. */
function pumpkinGeo(r, ribs = 8) {
  return cached(`dc-pumpkin|${r3(r)}|${ribs}`, () => {
    const g = new THREE.SphereGeometry(r, ribs * 2, 9);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const a = Math.atan2(z, x);
      const rib = 1 - 0.09 * Math.pow(Math.abs(Math.sin((a * ribs) / 2)), 0.8);
      const rho = Math.hypot(x, z) / r;
      const dimple = 0.22 * r * Math.max(0, 1 - rho / 0.45);
      const yy = y * 0.72 - Math.sign(y) * dimple;
      pos.setXYZ(i, x * rib, yy, z * rib);
    }
    return finish(g, TAU * r, PI * r);
  });
}

/** A jagged, puffy cone tier for pine trees (apex up, drooping star-shaped skirt). */
function pineTierGeo(r, h, seed = 0, n = 11) {
  return cached(`dc-pine|${r3(r)}|${r3(h)}|${seed}|${n}`, () => {
    const R = rng(seed + 5);
    const pos = [];
    const ring = (frac, rad, y, jag, droop) => {
      const pts = [];
      for (let i = 0; i < n * 2; i++) {
        const a = (i / (n * 2)) * TAU + seed;
        const tip = i % 2 === 0;
        const rr = rad * (tip ? 1 : 1 - jag) * (0.94 + R() * 0.1);
        pts.push([Math.cos(a) * rr, y - (tip ? droop : 0), Math.sin(a) * rr]);
      }
      return pts;
    };
    const apex = [0, h, 0];
    const mid = ring(0.5, r * 0.62, h * 0.42, 0.08, 0);
    const rim = ring(1, r, 0, 0.22, h * 0.06);
    const under = [0, h * 0.22, 0];
    const tri = (a, b, c) => pos.push(...a, ...b, ...c);
    const m = n * 2;
    for (let i = 0; i < m; i++) {
      const j = (i + 1) % m;
      tri(apex, mid[j], mid[i]);
      tri(mid[i], mid[j], rim[j]);
      tri(mid[i], rim[j], rim[i]);
      tri(under, rim[i], rim[j]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const uv = [];
    for (let i = 0; i < pos.length; i += 3) uv.push(Math.atan2(pos[i + 2], pos[i]) * r, pos[i + 1]);
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    return g;
  });
}

// ---------------------------------------------------------------------- mesh helpers

/** Box from extents. */
function bxe(g, m, x0, x1, y0, y1, z0, z1) {
  const w = Math.abs(x1 - x0), h = Math.abs(y1 - y0), d = Math.abs(z1 - z0);
  if (w < 0.002 || h < 0.002 || d < 0.002) return null;
  return add(g, boxGeo(w, h, d), m, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
}
/** Box w×h×d centred at (x, y, z). */
const bc = (g, m, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) => add(g, boxGeo(w, h, d), m, x, y, z, rx, ry, rz);
/** Cylinder standing with its bottom at y. */
const cyl = (g, m, rt, rb, h, x, y, z, seg = 12) => add(g, cylGeo(rt, rb, h, seg), m, x, y + h / 2, z);
/** Cylinder centred at (x, y, z), optionally rotated. */
const cylc = (g, m, rt, rb, h, x, y, z, seg = 12, rx = 0, ry = 0, rz = 0) => add(g, cylGeo(rt, rb, h, seg), m, x, y, z, rx, ry, rz);
/** Scaled sphere. */
function ball(g, m, r, x, y, z, sx = 1, sy = 1, sz = 1, ws = 8, hs = 6, rx = 0, ry = 0, rz = 0) {
  const o = add(g, sphereGeo(r, ws, hs), m, x, y, z, rx, ry, rz);
  o.scale.set(sx, sy, sz);
  return o;
}
/** Rounded cushion centred at (x, y, z). */
const puff = (g, m, w, h, d, x, y, z, e = 0.35, rx = 0, ry = 0, rz = 0, ws = 12, hs = 8) =>
  add(g, puffGeo(w, h, d, e, ws, hs), m, x, y, z, rx, ry, rz);
const blob = (g, m, r, x, y, z, seed = 0, sy = 1, amp = 0.13, ws = 0, hs = 0) => {
  if (!ws) { ws = r >= 0.9 ? 13 : r >= 0.45 ? 11 : 9; hs = r >= 0.9 ? 9 : r >= 0.45 ? 8 : 6; }
  const o = add(g, blobGeo(r, seed % 7, amp, ws, hs), m, x, y, z, 0, seed * 0.9, 0);
  if (sy !== 1) o.scale.set(1, sy, 1);
  return o;
};
const cone = (g, m, r, h, x, y, z, seg = 8, rx = 0, ry = 0, rz = 0) => add(g, coneGeo(r, h, seg), m, x, y + h / 2, z, rx, ry, rz);

const _va = new THREE.Vector3(), _vb = new THREE.Vector3(), _Y = new THREE.Vector3(0, 1, 0);
/** Cylinder from point a (radius ra) to point b (radius rb). */
function rod(g, m, a, b, ra, rb = ra, seg = 6) {
  _va.set(a[0], a[1], a[2]); _vb.set(b[0], b[1], b[2]);
  const len = _va.distanceTo(_vb);
  const o = add(g, cylGeo(rb, ra, len, seg), m, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  o.quaternion.setFromUnitVectors(_Y, _vb.sub(_va).normalize());
  return o;
}
/** Extruded XY polygon, depth along Z, centred at (x, y, z) and rotated about Y. */
const poly = (g, m, pts, depth, x = 0, y = 0, z = 0, ry = 0, holes = []) => add(g, prismGeo(pts, depth, holes), m, x, y, z, 0, ry, 0);
/** Side profile polygon given in (z, y) pairs, extruded along X (thickness t) at x. */
const side = (g, m, pts, t, x) => add(g, prismGeo(pts, t), m, x, 0, 0, 0, -PI / 2, 0);

function heartPts(cx, cy, s, n = 18) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * TAU;
    pts.push([cx + s * 16 * Math.pow(Math.sin(t), 3) / 17, cy + s * (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) / 17]);
  }
  return pts;
}

/** Arched-top panel outline (x from −w/2..w/2, y0 → shoulder ys, crown yc). */
function archPanel(w, y0, ys, yc, n = 10) {
  const pts = [[-w / 2, y0], [w / 2, y0]];
  for (let i = 0; i <= n; i++) {
    const x = w / 2 - (i / n) * w;
    pts.push([x, ys + (yc - ys) * Math.cos((x / (w / 2)) * (PI / 2))]);
  }
  return pts;
}

// ====================================================================== little props (shared)

function candle(g, x, y, z, h = 0.14) {
  cyl(g, mat('iron'), 0.05, 0.055, 0.018, x, y, z, 10);
  cyl(g, cer(COL.wax), 0.022, 0.022, h, x, y + 0.018, z, 8);
  ball(g, mat('lampGlow'), 0.024, x, y + 0.018 + h + 0.03, z, 1, 1.7, 1, 6, 4);
}

const VASE = [[0.001, 0], [0.05, 0.005], [0.07, 0.06], [0.06, 0.12], [0.035, 0.16], [0.04, 0.185], [0.033, 0.19]];
const PETALS = ['petalPink', 'petalYellow', 'petalWhite', 'petalPurple'];
/** Two petal materials picked by seed (keeps draw calls down). */
const petalPair = (seed) => [mat(PETALS[seed % 4]), mat(PETALS[(seed + 1 + (seed >> 2) % 3) % 4])];

function vase(g, x, y, z, seed = 0, color = COL.teal, indoor = true) {
  add(g, latheGeo('vase', VASE, 10), cer(color), x, y, z);
  const r = rng(seed + 11);
  const heads = petalPair(seed);
  const stem = mat(indoor ? 'leavesDark' : 'leaves');
  for (let i = 0; i < 5; i++) {
    const a = i * 1.26 + r() * 0.5, d = 0.05 + r() * 0.04;
    const top = [x + Math.cos(a) * d, y + 0.27 + r() * 0.08, z + Math.sin(a) * d];
    rod(g, stem, [x + Math.cos(a) * 0.012, y + 0.15, z + Math.sin(a) * 0.012], top, 0.006, 0.006, 4);
    ball(g, heads[i % 2], 0.034, top[0], top[1], top[2], 1, 0.75, 1, 6, 5);
  }
  ball(g, stem, 0.06, x, y + 0.2, z, 1.2, 0.6, 1.2, 7, 5);
}

const BOWL = [[0.001, 0], [0.06, 0.004], [0.11, 0.035], [0.135, 0.075], [0.125, 0.075], [0.1, 0.04], [0.001, 0.02]];
function fruitBowl(g, x, y, z, color = COL.cream, fruit = COL.apple) {
  add(g, latheGeo('bowl', BOWL, 12), cer(color), x, y, z);
  const fm = cer(fruit);
  for (const [dx, dz, dy] of [[-0.045, 0.02, 0.07], [0.05, 0.03, 0.07], [0.0, -0.05, 0.07], [0.01, 0.01, 0.12]]) {
    ball(g, fm, 0.048, x + dx, y + dy, z + dz, 1, 0.92, 1, 8, 6);
  }
}

function teapot(g, x, y, z, color = COL.denim) {
  const m = cer(color);
  ball(g, m, 0.09, x, y + 0.075, z, 1, 0.85, 1, 10, 7);
  cyl(g, m, 0.045, 0.05, 0.02, x, y + 0.14, z, 10);
  ball(g, m, 0.018, x, y + 0.17, z, 1, 1, 1, 6, 4);
  rod(g, m, [x + 0.07, y + 0.06, z], [x + 0.15, y + 0.13, z], 0.02, 0.012, 6);
  add(g, torusGeo(0.05, 0.012, 4, 10, PI * 1.2), m, x - 0.085, y + 0.085, z, 0, 0, PI * 0.4);
}

function cup(g, x, y, z, color = COL.cream) {
  const m = cer(color);
  cyl(g, m, 0.04, 0.03, 0.065, x, y, z, 10);
  add(g, torusGeo(0.022, 0.007, 4, 8, PI * 1.4), m, x + 0.04, y + 0.035, z, 0, 0, -PI * 0.7);
}

function bookStack(g, x, y, z, n = 3, seed = 0, ry = 0) {
  const r = rng(seed + 3);
  let h = y;
  for (let i = 0; i < n; i++) {
    const t = 0.035 + r() * 0.025, w = 0.2 + r() * 0.06, d = 0.15 + r() * 0.04;
    bc(g, fab(BOOK_COLS[(seed + i * 2) % BOOK_COLS.length]), w, t, d, x + (r() - 0.5) * 0.02, h + t / 2, z, 0, ry + (r() - 0.5) * 0.3, 0);
    h += t;
  }
  return h;
}

const SHADE = [[0.1, 0], [0.1, 0.004], [0.065, 0.13], [0.06, 0.13], [0.093, 0.004]];
function tableLamp(g, x, y, z, color = COL.cream) {
  add(g, latheGeo('lampbase', [[0.001, 0], [0.06, 0], [0.065, 0.02], [0.07, 0.07], [0.05, 0.13], [0.015, 0.16], [0.001, 0.17]], 10), cer(color), x, y, z);
  cyl(g, mat('iron'), 0.007, 0.007, 0.1, x, y + 0.16, z, 5);
  add(g, latheGeo('lampshade', SHADE, 12), mat('lampGlow'), x, y + 0.2, z);
}

function photoFrame(g, x, y, z, ry = 0) {
  bc(g, mat('timber'), 0.14, 0.17, 0.02, x, y + 0.085, z, -0.18, ry, 0);
  bc(g, cer(COL.paper), 0.1, 0.12, 0.022, x, y + 0.087, z + 0.002, -0.18, ry, 0);
}

const POT = [[0.001, 0], [0.13, 0], [0.15, 0.02], [0.18, 0.26], [0.205, 0.27], [0.21, 0.33], [0.19, 0.335], [0.18, 0.29], [0.001, 0.29]];
const SMALLPOT = [[0.001, 0], [0.05, 0], [0.065, 0.09], [0.075, 0.095], [0.075, 0.115], [0.066, 0.115], [0.001, 0.1]];
function smallPlant(g, x, y, z, seed = 0, color = COL.terracotta) {
  add(g, latheGeo('smallpot', SMALLPOT, 10), cer(color), x, y, z);
  const lm = mat('leavesDark');
  const r = rng(seed + 21);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + r();
    const len = 0.1 + r() * 0.06;
    ball(g, lm, 0.06, x + Math.cos(a) * 0.05, y + 0.14 + r() * 0.04, z + Math.sin(a) * 0.05, 0.5, 0.25, 1.1 * len / 0.12, 7, 5, 0.5, -a + PI / 2, 0);
  }
  ball(g, lm, 0.06, x, y + 0.15, z, 1, 0.8, 1, 7, 5);
}

/** Leafy indoor plant rising from y (leaves fan out on stems). */
function leafyPlant(g, x, y, z, height = 0.7, seed = 0, n = 8) {
  const lm = mat('leavesDark');
  const r = rng(seed + 31);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU * 1.618 + r() * 0.4;
    const t = i / (n - 1);
    const hy = y + height * (0.45 + 0.55 * (1 - t) * (0.7 + r() * 0.3));
    const out = 0.12 + 0.18 * t + r() * 0.06;
    const tip = [x + Math.cos(a) * out, hy, z + Math.sin(a) * out];
    rod(g, lm, [x + Math.cos(a) * 0.02, y, z + Math.sin(a) * 0.02], tip, 0.008, 0.006, 4);
    // leaf blade: flattened ellipsoid tilted outward
    const len = 0.13 + 0.05 * r();
    const lo = ball(g, lm, 1, tip[0] + Math.cos(a) * len * 0.6, tip[1] + 0.02, tip[2] + Math.sin(a) * len * 0.6, len * 0.62, 0.016, len, 8, 5);
    lo.rotation.set(0, -a + PI / 2, 0);
    lo.rotateX(-0.45 - r() * 0.3);
  }
}

/** Mixed little flowers (for planters, wheelbarrows, mailbox posts). */
function posy(g, x, y, z, rad, n, seed, outdoor = true) {
  const r = rng(seed + 41);
  const heads = petalPair(seed);
  const lm = mat(outdoor ? 'leaves' : 'leavesDark');
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU + r();
    blob(g, lm, rad * 0.45, x + Math.cos(a) * rad * 0.35, y + rad * 0.15, z + Math.sin(a) * rad * 0.35, seed + i, 0.7, 0.15, 7, 5);
  }
  for (let i = 0; i < n; i++) {
    const a = r() * TAU, d = Math.sqrt(r()) * rad * 0.8;
    ball(g, heads[i % 2], 0.035 + r() * 0.015, x + Math.cos(a) * d, y + rad * 0.35 + r() * rad * 0.25, z + Math.sin(a) * d, 1, 0.75, 1, 6, 4);
  }
}

const capGeo = (r, seg = 7) => cached(`dc-cap|${r3(r)}|${seg}`, () => new THREE.CircleGeometry(r, seg));
/** Short bark log lying along X (rotated by ry about Y) with light end-grain caps. ~28 triangles. */
function log(g, x, y, z, len, r, ry = 0) {
  const grp = new THREE.Group();
  grp.position.set(x, y, z);
  grp.rotation.y = ry;
  g.add(grp);
  add(grp, cylGeo(r, r, len, 7, true), mat('bark'), 0, 0, 0, 0, 0, PI / 2);
  const end = mat('wood');
  add(grp, capGeo(r), end, len / 2 - 0.004, 0, 0, 0, PI / 2, 0);
  add(grp, capGeo(r), end, -len / 2 + 0.004, 0, 0, 0, -PI / 2, 0);
  return grp;
}

// ====================================================================== registration

/**
 * Register a decor piece. build(g, p, o) fills group g whose origin is already lifted to the standing
 * surface; o = { s: surface code, b: base y, v: variant 0..3, nb: neighbour code }.
 */
const DEFS = [];
function decor(def) { DEFS.push(def); }

/** Wrap a decor def into a full piece def (contextual standing surface + optional neighbour key). */
function register(def) {
  const { build, nb } = def;
  const key = (p, ctx) => surface(p, ctx) + (nb ? nb(p, ctx) : '');
  registerPiece({
    slot: 'cell', layer: 'I', rot: 'four', contextual: true,
    ...def,
    contextKey: key,
    build(p, ctx) {
      const root = new THREE.Group();
      const g = new THREE.Group();
      const s = surface(p, ctx);
      g.position.y = SURF_Y[s];
      root.add(g);
      build(g, p, { s, b: SURF_Y[s], v: variantOf(p), nb: nb ? nb(p, ctx) : '' });
      return root;
    },
  });
}

/** I-layer record in the cell at local offset (lx = local +X steps, lz = local +Z steps) from p. */
function nbI(p, ctx, lx, lz) {
  const f = DIRS[p.r & 3], sd = DIRS[(p.r + 1) & 3];
  return ctx.get(K.I(p.x + lx * sd[0] + lz * f[0], p.y, p.z + lx * sd[1] + lz * f[1]));
}
const TABLES = new Set(['table']);
const BEDS = new Set(['bed']);

const FURN = ['wood', 'timber', 'paintedWood'];

// ====================================================================== INTERIOR

// ---------------------------------------------------------------- bed
decor({
  id: 'bed', name: 'Quilted Bed', cat: 'interior', icon: '🛏️', sound: 'soft',
  mats: ['wood', 'timber', 'trim'], matGroup: 'bed', paintAlways: true,
  desc: 'A big cosy bed with a patchwork quilt and heart headboard. Paint the quilt any colour.',
  build(g, p) {
    const fm = mat(p.m);
    const qc = p.c || COL.red;
    const quilt = fab(qc), patch = fab(tint(qc, 0.42)), linen = fab(COL.linen);
    const W = 0.72, Z0 = BACK + 0.05, Z1 = 0.93;
    // posts with ball finials
    for (const sx of [-1, 1]) {
      for (const [z, h] of [[Z0, 1.1], [Z1, 0.74]]) {
        cyl(g, fm, 0.045, 0.05, h, sx * W, 0, z, 10);
        ball(g, fm, 0.062, sx * W, h + 0.04, z, 1, 1, 1, 8, 6);
      }
    }
    // headboard & footboard: arched panels with a heart cut-out
    poly(g, fm, archPanel(2 * W - 0.04, 0.3, 0.9, 1.04), 0.04, 0, 0, Z0, 0, [heartPts(0, 0.78, 0.08)]);
    poly(g, fm, archPanel(2 * W - 0.04, 0.3, 0.6, 0.68), 0.04, 0, 0, Z1, 0, [heartPts(0, 0.5, 0.055)]);
    // side rails
    for (const sx of [-1, 1]) bxe(g, fm, sx * (W - 0.025), sx * (W + 0.02), 0.24, 0.4, Z0, Z1);
    // mattress + pillows
    const mz0 = Z0 + 0.03, mz1 = Z1 - 0.03;
    puff(g, linen, 2 * W - 0.06, 0.24, mz1 - mz0, 0, 0.52, (mz0 + mz1) / 2, 0.25, 0, 0, 0, 12, 6);
    for (const sx of [-1, 1]) puff(g, linen, 0.58, 0.17, 0.36, sx * 0.33, 0.71, Z0 + 0.24, 0.55, -0.35, sx * 0.05, 0, 10, 6);
    // quilt: top, side drapes, folded-back sheet, patchwork
    const qz0 = Z0 + 0.5, qz1 = Z1 - 0.04, ql = qz1 - qz0, qzc = (qz0 + qz1) / 2;
    puff(g, quilt, 2 * W + 0.04, 0.07, ql, 0, 0.66, qzc, 0.15, 0, 0, 0, 12, 6);
    for (const sx of [-1, 1]) bxe(g, quilt, sx * (W + 0.025), sx * (W + 0.055), 0.4, 0.68, qz0, qz1 - 0.04);
    cylc(g, linen, 0.045, 0.045, 2 * W + 0.06, 0, 0.675, qz0, 10, 0, 0, PI / 2);
    const cols = 4, rows = 3, pw = (2 * W - 0.1) / cols, pd = (ql - 0.12) / rows;
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      if ((i + j) % 2) continue;
      bc(g, patch, pw - 0.02, 0.012, pd - 0.02, -W + 0.05 + pw * (i + 0.5), 0.69, qz0 + 0.07 + pd * (j + 0.5));
    }
    // folded knitted throw at the foot
    puff(g, fab(qc === COL.mustard ? COL.teal : COL.mustard), 2 * W - 0.1, 0.05, 0.3, 0, 0.715, Z1 - 0.24, 0.3, 0, 0, 0, 10, 6);
  },
});

// ---------------------------------------------------------------- table
/** Turned leg: square block under the top, then one lathe-turned shaft with bulbs and a little foot. */
function turnedLeg(g, m, x, z, h, r = 0.04) {
  bxe(g, m, x - r - 0.005, x + r + 0.005, h - 0.13, h, z - r - 0.005, z + r + 0.005);
  const top = h - 0.13, mid = Math.max(0.33, h - 0.36);
  const prof = [[0.001, 0], [0.6, 0], [0.78, 0.035], [0.6, 0.08], [1.1, 0.15], [1.15, 0.2], [0.9, 0.26], [0.62, 0.32],
    [0.66, mid], [0.78, top - 0.17], [1.2, top - 0.11], [1.2, top - 0.06], [0.85, top - 0.01], [0.85, top]];
  add(g, latheGeo(`leg|${r3(h)}|${r3(r)}`, prof.map(([a, b]) => [a * r, b]), 8), m, x, 0, z);
}

decor({
  id: 'table', name: 'Farmhouse Table', cat: 'interior', icon: '🍽️', sound: 'wood',
  mats: FURN, matGroup: 'furniture', paint: true, cacheExtra: variantKey,
  desc: 'A big plank table for long suppers. Chairs pull right up to it.',
  build(g, p, o) {
    const m = woodOf(p);
    const TW = 1.8, TD = 1.2, TY = 0.76, T = 0.06;
    const n = 4, bw = TD / n;
    for (let i = 0; i < n; i++) bc(g, m, TW, T, bw - 0.008, 0, TY - T / 2, -TD / 2 + bw * (i + 0.5));
    for (const s of [-1, 1]) {
      bxe(g, m, -TW / 2 + 0.1, TW / 2 - 0.1, TY - T - 0.12, TY - T, s * (TD / 2 - 0.12) - 0.015, s * (TD / 2 - 0.12) + 0.015);
      bxe(g, m, s * (TW / 2 - 0.12) - 0.015, s * (TW / 2 - 0.12) + 0.015, TY - T - 0.12, TY - T, -TD / 2 + 0.1, TD / 2 - 0.1);
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) turnedLeg(g, m, sx * (TW / 2 - 0.12), sz * (TD / 2 - 0.12), TY - T, 0.045);
    // a little something on the table
    const v = o.v;
    if (v === 0) {
      bc(g, fab(COL.cream), 1.3, 0.006, 0.34, 0, TY + 0.003, 0);
      candle(g, -0.18, TY, 0, 0.16); candle(g, 0.18, TY, 0, 0.12);
    } else if (v === 1) fruitBowl(g, 0.1, TY, -0.05);
    else if (v === 2) { vase(g, 0, TY, 0, 2); cup(g, 0.5, TY, 0.3); }
    else { teapot(g, -0.1, TY, 0); cup(g, 0.25, TY, 0.18, COL.cream); cup(g, -0.4, TY, -0.2, COL.cream); }
  },
});

// ---------------------------------------------------------------- chair
// Sits toward the front of its cell so it tucks up to a table in the next cell.
decor({
  id: 'chair', name: 'Ladder-back Chair', cat: 'interior', icon: '🪑', sound: 'wood',
  mats: FURN, matGroup: 'furniture', paint: true,
  desc: 'A farmhouse chair with a cushion. Face it toward a table and it tucks right in.',
  // facing a table: tuck in — further when facing its long side (the table is 1.8 m × 1.2 m)
  nb(p, ctx) {
    const t = nbI(p, ctx, 0, 1);
    if (!t || !TABLES.has(t.t)) return '';
    return ((p.r - (t.r || 0)) & 1) ? 'x' : 'z';
  },
  build(g, p, o) {
    ladderChair(g, woodOf(p), o.nb === 'z' ? 0.9 : o.nb === 'x' ? 0.66 : 0.05);
  },
});

/** Ladder-back chair facing +Z with its seat centred at z = CZ. */
function ladderChair(g, m, CZ) {
  const W = 0.46, D = 0.44, SY = 0.46;
  const zf = CZ + D / 2 - 0.035, zb = CZ - D / 2 + 0.035, xl = W / 2 - 0.035;
  for (const sx of [-1, 1]) {
    cyl(g, m, 0.024, 0.02, SY, sx * xl, 0, zf, 7);
    cyl(g, m, 0.026, 0.022, 1.0, sx * xl, 0, zb, 7);
    ball(g, m, 0.034, sx * xl, 1.02, zb, 1, 1.1, 1, 7, 5);
    rod(g, m, [sx * xl, 0.16, zb], [sx * xl, 0.16, zf], 0.012);
  }
  rod(g, m, [-xl, 0.22, zf], [xl, 0.22, zf], 0.012);
  bc(g, m, W, 0.04, D, 0, SY - 0.02, CZ);
  for (const y of [0.64, 0.78, 0.92]) bc(g, m, W - 0.08, 0.06, 0.025, 0, y, zb);
  puff(g, fab(COL.rust), W - 0.04, 0.06, D - 0.04, 0, SY + 0.025, CZ + 0.01, 0.4, 0, 0, 0, 10, 6);
}

// ---------------------------------------------------------------- armchair & sofa
function upholstered(g, p, W, colour) {
  const fc = p.c || colour;
  const cush = fab(fc), body = fab(tint(fc, -0.14)), feet = mat('timber');
  const zb = -0.5, zf = 0.38, zc = (zb + zf) / 2, D = zf - zb;
  const hw = W / 2;
  for (const sx of [-1, 1]) for (const z of [zb + 0.08, zf - 0.08]) cyl(g, feet, 0.035, 0.025, 0.1, sx * (hw - 0.08), 0, z, 8);
  if (W > 1.4) for (const z of [zb + 0.08, zf - 0.08]) cyl(g, feet, 0.035, 0.025, 0.1, 0, 0, z, 8);
  puff(g, body, W, 0.3, D, 0, 0.25, zc, 0.22, 0, 0, 0, 12, 6);
  // back, tilted a little
  puff(g, body, W - 0.02, 0.66, 0.22, 0, 0.68, zb + 0.12, 0.3, -0.1, 0, 0, 12, 6);
  // rolled arms
  for (const sx of [-1, 1]) {
    puff(g, body, 0.17, 0.28, D - 0.04, sx * (hw - 0.085), 0.48, zc + 0.01, 0.3, 0, 0, 0, 10, 6);
    cylc(g, body, 0.092, 0.092, D - 0.02, sx * (hw - 0.085), 0.62, zc + 0.01, 12, PI / 2, 0, 0);
  }
  // seat & back cushions
  const inner = W - 0.34, n = W > 1.4 ? 2 : 1, cw = inner / n;
  for (let i = 0; i < n; i++) {
    const cx = -inner / 2 + cw * (i + 0.5);
    puff(g, cush, cw - 0.02, 0.15, D - 0.2, cx, 0.47, zc + 0.08, 0.45, 0, 0, 0, 12, 6);
    puff(g, cush, cw - 0.03, 0.44, 0.16, cx, 0.79, zb + 0.27, 0.5, -0.16, 0, 0, 12, 6);
  }
  return { cush, body, zb, zf, hw };
}

decor({
  id: 'armchair', name: 'Reading Armchair', cat: 'interior', icon: '🛋️', sound: 'soft', paintAlways: true,
  desc: 'A squashy wingback armchair with rolled arms. Perfect with a book.',
  build(g, p) {
    const { zb, hw } = upholstered(g, p, 1.0, COL.rust);
    puff(g, fab(p.c === COL.cream ? COL.mustard : COL.cream), 0.3, 0.28, 0.1, 0.16, 0.7, zb + 0.4, 0.6, -0.25, -0.35, 0.15);
    // knitted blanket over one arm
    const kc = fab(COL.mustard);
    bc(g, kc, 0.22, 0.03, 0.34, -(hw - 0.085), 0.715, 0.02, 0, 0, 0);
    bc(g, kc, 0.03, 0.3, 0.34, -(hw + 0.01), 0.56, 0.02, 0, 0, -0.08);
  },
});

decor({
  id: 'sofa', name: 'Cosy Sofa', cat: 'interior', icon: '🛋️', sound: 'soft', paintAlways: true,
  desc: 'A deep two-seater sofa with throw pillows.',
  build(g, p) {
    const fc = p.c || COL.sage;
    const { zb, hw } = upholstered(g, p, 1.92, COL.sage);
    puff(g, fab(fc === COL.mustard ? COL.rust : COL.mustard), 0.32, 0.3, 0.11, -(hw - 0.34), 0.7, zb + 0.4, 0.6, -0.25, 0.4, -0.15);
    puff(g, fab(COL.cream), 0.32, 0.3, 0.11, hw - 0.34, 0.7, zb + 0.4, 0.6, -0.25, -0.4, 0.15);
  },
});

// ---------------------------------------------------------------- rocking chair
function rockerPts(z0, z1, R, t, n = 12) {
  const bottom = [], top = [];
  for (let i = 0; i <= n; i++) {
    const z = z0 + ((z1 - z0) * i) / n;
    const y = R - Math.sqrt(R * R - z * z);
    bottom.push([z, y]);
    top.unshift([z, y + t * (1 - 0.35 * Math.abs(z) / Math.max(-z0, z1))]);
  }
  return [...bottom, ...top];
}

decor({
  id: 'rocking_chair', name: 'Rocking Chair', cat: 'interior', icon: '🪑', sound: 'wood',
  mats: FURN, matGroup: 'furniture', paint: true,
  desc: 'Grandma’s spindle-back rocker with a knitted blanket.',
  build(g, p) {
    const m = woodOf(p);
    const xs = 0.25, SY = 0.44;
    for (const sx of [-1, 1]) {
      side(g, m, rockerPts(-0.62, 0.5, 1.3, 0.055), 0.045, sx * xs);
      rod(g, m, [sx * xs, 0.08, 0.26], [sx * 0.23, SY, 0.2], 0.022, 0.02);
      rod(g, m, [sx * xs, 0.1, -0.3], [sx * 0.23, SY, -0.2], 0.022, 0.02);
      rod(g, m, [sx * 0.23, SY - 0.02, -0.22], [sx * 0.25, 1.12, -0.38], 0.026, 0.022, 7);
      ball(g, m, 0.032, sx * 0.25, 1.14, -0.385, 1, 1.1, 1, 7, 5);
      rod(g, m, [sx * 0.25, SY, 0.18], [sx * 0.27, 0.66, 0.2], 0.02, 0.02);
      bc(g, m, 0.06, 0.03, 0.56, sx * 0.27, 0.665, -0.03, 0.08, 0, 0);
      rod(g, m, [sx * 0.23, 0.2, -0.22], [sx * 0.23, 0.2, 0.2], 0.012);
    }
    bc(g, m, 0.5, 0.04, 0.46, 0, SY, -0.01);
    bc(g, m, 0.56, 0.1, 0.04, 0, 1.09, -0.37, -0.22, 0, 0);
    for (let i = 0; i < 5; i++) {
      const x = -0.16 + i * 0.08;
      rod(g, m, [x, SY + 0.02, -0.2], [x * 1.05, 1.04, -0.355], 0.011, 0.011, 5);
    }
    puff(g, fab(COL.rust), 0.44, 0.06, 0.42, 0, SY + 0.045, 0.0, 0.4);
    // knitted blanket over the back rail
    const kc = fab(COL.cream);
    puff(g, kc, 0.42, 0.44, 0.035, 0.02, 0.86, -0.4, 0.5, -0.22, 0, 0.04);
    cylc(g, kc, 0.035, 0.035, 0.44, 0.02, 1.1, -0.385, 8, 0, 0, PI / 2);
  },
});

// ---------------------------------------------------------------- bookshelf
decor({
  id: 'bookshelf', name: 'Bookshelf', cat: 'interior', icon: '📚', sound: 'wood',
  mats: FURN, matGroup: 'furniture', paint: true, cacheExtra: variantKey,
  desc: 'A tall bookcase stuffed with well-loved books.',
  build(g, p, o) {
    const m = woodOf(p);
    const W = 1.3, D = 0.34, H = 1.94, z0 = BACK, z1 = BACK + D, zc = (z0 + z1) / 2;
    for (const sx of [-1, 1]) bxe(g, m, sx * (W / 2 - 0.04), sx * W / 2, 0, H, z0, z1);
    bxe(g, m, -W / 2 - 0.03, W / 2 + 0.03, H, H + 0.04, z0, z1 + 0.03);
    bxe(g, m, -W / 2 - 0.05, W / 2 + 0.05, H + 0.04, H + 0.07, z0, z1 + 0.05);
    bxe(g, m, -W / 2 + 0.04, W / 2 - 0.04, 0, 0.1, z1 - 0.04, z1 - 0.02);
    bxe(g, m, -W / 2 + 0.04, W / 2 - 0.04, 0.02, H, z0, z0 + 0.015);
    const shelves = [0.1, 0.56, 1.02, 1.48];
    for (const y of shelves) bxe(g, m, -W / 2 + 0.04, W / 2 - 0.04, y - 0.03, y, z0, z1 - 0.01);
    const r = rng(o.v * 17 + 5);
    const x0 = -W / 2 + 0.06, x1 = W / 2 - 0.06;
    shelves.forEach((y, row) => {
      const room = (row < 3 ? shelves[row + 1] - 0.03 : H) - y;
      let x = x0;
      const stopAt = row === 3 ? x0 + (x1 - x0) * (0.45 + r() * 0.2) : x1;
      let stackDone = row !== 1;
      while (x < stopAt - 0.04) {
        if (!stackDone && x > x0 + 0.4) {
          // a little lying stack
          const sw = 0.26;
          bookStack(g, x + sw / 2, y, zc + 0.02, 3, row + o.v, 0);
          x += sw + 0.03;
          stackDone = true;
          continue;
        }
        if (r() < 0.07) { x += 0.05 + r() * 0.05; continue; }
        const w = 0.032 + r() * 0.035, h = Math.min(room - 0.04, 0.22 + r() * 0.16), d = 0.2 + r() * 0.06;
        if (x + w > stopAt) break;
        bc(g, fab(BOOK_COLS[Math.floor(r() * BOOK_COLS.length)]), w, h, d, x + w / 2, y + h / 2, z1 - 0.03 - d / 2);
        x += w + 0.004;
      }
      if (row === 3) smallPlant(g, (stopAt + x1) / 2 + 0.03, y, zc + 0.02, o.v);
    });
  },
});

// ---------------------------------------------------------------- dresser
function topProps(g, v, x0, x1, y, z) {
  const xm = (x0 + x1) / 2, xa = x0 + 0.14, xb = x1 - 0.14;
  if (v === 0) { tableLamp(g, xb, y, z); photoFrame(g, xa, y, z + 0.02, 0.2); }
  else if (v === 1) { vase(g, xa, y, z, 1, COL.cream); bookStack(g, xb, y, z, 2, 4, 0.3); }
  else if (v === 2) { bookStack(g, xa, y, z, 3, 2, -0.2); candle(g, xb, y, z, 0.14); }
  else { smallPlant(g, xb, y, z, 3, COL.cream); photoFrame(g, xa, y, z + 0.02, -0.25); }
  return xm;
}

decor({
  id: 'dresser', name: 'Chest of Drawers', cat: 'interior', icon: '🗄️', sound: 'wood',
  mats: FURN, matGroup: 'furniture', paint: true, cacheExtra: variantKey,
  desc: 'A sturdy dresser with an oval mirror and keepsakes on top.',
  build(g, p, o) {
    const m = woodOf(p, COL.cream);
    const W = 1.2, D = 0.5, z0 = BACK, z1 = BACK + D, zc = (z0 + z1) / 2, TOP = 0.92;
    const knob = cer(p.m === 'paintedWood' ? '#d9a441' : COL.pillow);
    for (const sx of [-1, 1]) for (const z of [z0 + 0.08, z1 - 0.08]) ball(g, m, 0.06, sx * (W / 2 - 0.08), 0.06, z, 1, 1, 1, 8, 6);
    bxe(g, m, -W / 2 + 0.03, W / 2 - 0.03, 0.1, TOP - 0.03, z0 + 0.02, z1 - 0.02);
    bxe(g, m, -W / 2 + 0.01, W / 2 - 0.01, 0.1, 0.15, z0 + 0.01, z1);
    bxe(g, m, -W / 2, W / 2, TOP - 0.035, TOP, z0, z1 + 0.025);
    const rows = [[0.68, 0.84, 2], [0.43, 0.65, 1], [0.18, 0.4, 1]];
    const xa = -W / 2 + 0.06, xb = W / 2 - 0.06;
    for (const [y0, y1, n] of rows) {
      const w = (xb - xa) / n;
      for (let i = 0; i < n; i++) {
        const dx0 = xa + w * i + 0.012, dx1 = xa + w * (i + 1) - 0.012;
        bxe(g, m, dx0, dx1, y0, y1, z1 - 0.02, z1 + 0.012);
        const kx = (dx0 + dx1) / 2;
        if (n === 1) for (const s of [-1, 1]) ball(g, knob, 0.022, kx + s * 0.22, (y0 + y1) / 2, z1 + 0.03, 1, 1, 1, 6, 5);
        else ball(g, knob, 0.022, kx, (y0 + y1) / 2, z1 + 0.03, 1, 1, 1, 6, 5);
      }
    }
    // oval mirror on little stands
    const my = TOP + 0.44, mz = z0 + 0.08;
    const mo = add(g, torusGeo(0.24, 0.025, 5, 22), m, 0, my, mz);
    mo.scale.set(1, 1.3, 1);
    const gl = cylc(g, cer(COL.mirror), 0.235, 0.235, 0.012, 0, my, mz - 0.004, 22, PI / 2, 0, 0);
    gl.scale.set(1, 1, 1.3);
    for (const sx of [-1, 1]) { bxe(g, m, sx * 0.25 - 0.02, sx * 0.25 + 0.02, TOP, my + 0.05, mz - 0.03, mz + 0.03); }
    bxe(g, m, -0.3, 0.3, TOP, TOP + 0.03, mz - 0.05, mz + 0.05);
    topProps(g, o.v, -W / 2 + 0.02, W / 2 - 0.02, TOP, zc + 0.06);
  },
});

// ---------------------------------------------------------------- kitchen
// Full cell width (2 m) so a row of kitchen pieces forms one continuous counter.
function cabinetRun(g, p, o, { sink = false } = {}) {
  const cm = woodOf(p, COL.sage);
  const top = mat(p.m === 'wood' ? 'timber' : 'wood');
  const plinth = mat('timber');
  const pull = mat('iron');
  const Z0 = BACK - 0.02, Z1 = BACK + 0.6, TOP = 0.9;
  bxe(g, plinth, -1, 1, 0, 0.1, Z0, Z1 - 0.06);
  bxe(g, cm, -1, 1, 0.1, TOP - 0.05, Z0, Z1 - 0.02);
  const door = (x0, x1, y0, y1, hx) => {
    bxe(g, cm, x0, x1, y0, y1, Z1 - 0.02, Z1);
    bxe(g, cm, x0 + 0.06, x1 - 0.06, y0 + 0.06, y1 - 0.06, Z1, Z1 + 0.012);
    if (hx !== undefined) bc(g, pull, 0.016, 0.1, 0.02, hx, y1 - 0.12, Z1 + 0.02);
  };
  const drawer = (x0, x1, y0, y1) => {
    bxe(g, cm, x0, x1, y0, y1, Z1 - 0.02, Z1 + 0.005);
    bc(g, pull, 0.12, 0.018, 0.02, (x0 + x1) / 2, (y0 + y1) / 2, Z1 + 0.018);
  };
  const secs = sink ? [[-0.98, -0.35], [0.35, 0.98]] : [[-0.98, -0.01], [0.01, 0.98]];
  for (const [a, b] of secs) {
    drawer(a, b, 0.66, 0.82);
    const mid = (a + b) / 2;
    if (b - a > 0.8) { door(a, mid - 0.006, 0.13, 0.63, mid - 0.06); door(mid + 0.006, b, 0.13, 0.63, mid + 0.06); }
    else door(a, b, 0.13, 0.63, a < 0 ? b - 0.07 : a + 0.07);
  }
  if (!sink) { bxe(g, top, -1, 1, TOP - 0.05, TOP, Z0, Z1 + 0.03); return { TOP, Z0, Z1, top }; }
  // farmhouse apron sink in the middle
  const white = cer(COL.pillow);
  door(-0.33, -0.006, 0.13, 0.57, -0.06); door(0.006, 0.33, 0.13, 0.57, 0.06);
  const sx0 = -0.32, sx1 = 0.32, sz0 = Z0 + 0.12, SB = 0.66;
  bxe(g, top, -1, sx0, TOP - 0.05, TOP, Z0, Z1 + 0.03);
  bxe(g, top, sx1, 1, TOP - 0.05, TOP, Z0, Z1 + 0.03);
  bxe(g, top, sx0, sx1, TOP - 0.05, TOP, Z0, sz0);
  bxe(g, white, sx0, sx1, 0.6, TOP - 0.005, Z1 - 0.04, Z1 + 0.02);       // apron
  bxe(g, white, sx0, sx1, SB - 0.04, SB, sz0, Z1 - 0.04);                  // basin floor
  bxe(g, white, sx0, sx0 + 0.04, SB, TOP - 0.005, sz0, Z1 - 0.04);
  bxe(g, white, sx1 - 0.04, sx1, SB, TOP - 0.005, sz0, Z1 - 0.04);
  bxe(g, white, sx0, sx1, SB, TOP - 0.005, sz0, sz0 + 0.04);
  // gooseneck tap
  const fz = Z0 + 0.06;
  cyl(g, pull, 0.022, 0.028, 0.2, 0, TOP, fz, 8);
  add(g, torusGeo(0.08, 0.017, 6, 12, PI), pull, 0, TOP + 0.2, fz + 0.08, 0, -PI / 2, 0);
  cyl(g, pull, 0.018, 0.018, 0.05, 0, TOP + 0.15, fz + 0.16, 8);
  for (const s of [-1, 1]) {
    cyl(g, pull, 0.012, 0.012, 0.05, s * 0.1, TOP, fz, 6);
    bc(g, pull, 0.06, 0.012, 0.012, s * 0.1, TOP + 0.055, fz, 0, s * 0.6, 0);
  }
  return { TOP, Z0, Z1, top };
}

decor({
  id: 'kitchen', name: 'Kitchen Sink', cat: 'interior', icon: '🚰', sound: 'wood',
  mats: ['paintedWood', 'wood', 'timber'], matGroup: 'kitchen', paint: true, cacheExtra: variantKey,
  desc: 'A full-width counter with a farmhouse sink and cabinets. Line them up for a whole kitchen.',
  build(g, p, o) {
    const { TOP, Z0, Z1 } = cabinetRun(g, p, o, { sink: true });
    kitchenProps(g, o.v, TOP, Z0, Z1, true);
  },
});

decor({
  id: 'kitchen_counter', name: 'Kitchen Counter', cat: 'interior', icon: '🥖', sound: 'wood',
  mats: ['paintedWood', 'wood', 'timber'], matGroup: 'kitchen', paint: true, cacheExtra: variantKey,
  desc: 'Butcher-block counter with drawers and cupboards, full of kitchen clutter.',
  build(g, p, o) {
    const { TOP, Z0, Z1 } = cabinetRun(g, p, o, { sink: false });
    kitchenProps(g, (o.v + 1) % 4, TOP, Z0, Z1, false);
  },
});

function kitchenProps(g, v, TOP, Z0, Z1, sink) {
  const z = (Z0 + Z1) / 2 + 0.02;
  const left = sink ? -0.66 : -0.5, right = sink ? 0.66 : 0.5;
  const items = {
    board: (x) => {
      bc(g, mat('wood'), 0.38, 0.025, 0.26, x, TOP + 0.0125, z, 0, 0.15, 0);
      ball(g, mat('hay'), 0.08, x + 0.02, TOP + 0.075, z, 1.5, 0.75, 0.9, 10, 7, 0, 0.15, 0);
    },
    crock: (x) => {
      cyl(g, cer(COL.cream), 0.07, 0.065, 0.18, x, TOP, z - 0.08, 10);
      for (let i = 0; i < 3; i++) rod(g, mat('wood'), [x, TOP + 0.1, z - 0.08], [x + (i - 1) * 0.04, TOP + 0.32, z - 0.1 + (i % 2) * 0.03], 0.008, 0.012, 4);
    },
    jars: (x) => {
      const c = ['#d9a441', '#b4473a', '#9cae6b'];
      for (let i = 0; i < 3; i++) {
        const h = 0.16 - i * 0.025;
        cyl(g, cer(c[i]), 0.05, 0.05, h, x + (i - 1) * 0.12, TOP, z - 0.12, 10);
        cyl(g, mat('wood'), 0.053, 0.053, 0.022, x + (i - 1) * 0.12, TOP + h, z - 0.12, 10);
      }
    },
    bowl: (x) => fruitBowl(g, x, TOP, z),
    kettle: (x) => teapot(g, x, TOP, z, COL.red),
    herbs: (x) => smallPlant(g, x, TOP, z - 0.1, 7, COL.terracotta),
    pie: (x) => {
      cyl(g, cer(COL.pillow), 0.17, 0.15, 0.02, x, TOP, z, 14);
      cyl(g, mat('hay'), 0.15, 0.14, 0.05, x, TOP + 0.02, z, 14);
    },
  };
  const sets = [['board', 'crock'], ['jars', 'herbs'], ['bowl', 'kettle'], ['pie', 'jars']];
  const [L, R] = sets[v];
  items[L](left);
  items[R](right);
}

// ---------------------------------------------------------------- wood stove
decor({
  id: 'wood_stove', name: 'Wood Stove', cat: 'interior', icon: '🔥', sound: 'metal',
  thumb: { h: 1 },
  desc: 'A little cast-iron stove with a glowing window, a kettle and a stovepipe to the ceiling.',
  build(g, p, o) {
    const iron = mat('iron'), ember = mat('ember');
    bxe(g, mat('stoneBlock'), -0.65, 0.65, 0, 0.04, BACK, 0.26);
    const y0 = 0.04, zc = -0.4;
    for (const sx of [-1, 1]) for (const z of [zc - 0.22, zc + 0.22]) cyl(g, iron, 0.03, 0.018, 0.15, sx * 0.25, y0, z, 6);
    const yb = y0 + 0.15;
    bxe(g, iron, -0.34, 0.34, yb, yb + 0.03, zc - 0.29, zc + 0.29);
    bxe(g, iron, -0.31, 0.31, yb + 0.03, yb + 0.53, zc - 0.26, zc + 0.26);
    bxe(g, iron, -0.35, 0.35, yb + 0.53, yb + 0.57, zc - 0.3, zc + 0.3);
    const zf = zc + 0.26;
    bxe(g, iron, -0.22, 0.22, yb + 0.1, yb + 0.44, zf, zf + 0.03);
    bxe(g, ember, -0.16, 0.16, yb + 0.16, yb + 0.38, zf + 0.03, zf + 0.04);
    bxe(g, iron, -0.012, 0.012, yb + 0.16, yb + 0.38, zf + 0.03, zf + 0.05);
    rod(g, iron, [0.17, yb + 0.27, zf + 0.04], [0.26, yb + 0.27, zf + 0.06], 0.012);
    bxe(g, iron, -0.26, 0.26, yb + 0.03, yb + 0.07, zf, zf + 0.06);
    // stovepipe up to the ceiling (short in thumbnails)
    const ytop = yb + 0.57;
    const pipeTop = p.h === 1 ? ytop + 0.7 : LEVEL_H - o.b + 0.02;
    const pz = zc - 0.12;
    cyl(g, iron, 0.075, 0.075, pipeTop - ytop, 0, ytop, pz, 12);
    cyl(g, iron, 0.09, 0.09, 0.05, 0, ytop, pz, 12);
    cyl(g, iron, 0.083, 0.083, 0.04, 0, ytop + 0.55, pz, 12);
    rod(g, iron, [-0.13, ytop + 0.35, pz], [0.13, ytop + 0.35, pz], 0.01);
    if (p.h !== 1) cyl(g, iron, 0.12, 0.12, 0.03, 0, LEVEL_H - o.b - 0.2, pz, 12);
    // red enamel kettle
    const km = cer(COL.red);
    const kx = 0.15, kz = zc + 0.08;
    ball(g, km, 0.1, kx, ytop + 0.08, kz, 1, 0.8, 1, 10, 7);
    ball(g, km, 0.02, kx, ytop + 0.165, kz, 1, 1, 1, 6, 4);
    rod(g, km, [kx - 0.07, ytop + 0.07, kz + 0.03], [kx - 0.15, ytop + 0.14, kz + 0.06], 0.02, 0.011, 6);
    add(g, torusGeo(0.065, 0.009, 4, 10, PI), iron, kx, ytop + 0.14, kz, 0, 0, 0);
    // log basket
    const bx0 = 0.32, bx1 = 0.62, bz0 = -0.12, bz1 = 0.18;
    const hay = mat('hay');
    bxe(g, hay, bx0, bx1, 0.04, 0.06, bz0, bz1);
    for (const [a, b, c, d] of [[bx0, bx1, bz0, bz0 + 0.02], [bx0, bx1, bz1 - 0.02, bz1], [bx0, bx0 + 0.02, bz0, bz1], [bx1 - 0.02, bx1, bz0, bz1]]) bxe(g, hay, a, b, 0.04, 0.24, c, d);
    log(g, 0.47, 0.13, -0.05, 0.4, 0.05, PI / 2);
    log(g, 0.42, 0.13, 0.08, 0.4, 0.05, PI / 2 + 0.1);
    log(g, 0.5, 0.21, 0.02, 0.42, 0.048, PI / 2 - 0.08);
  },
});

// ---------------------------------------------------------------- fireplace
decor({
  id: 'fireplace', name: 'Stone Fireplace', cat: 'interior', icon: '🔥', sound: 'stone',
  desc: 'A crackling fieldstone hearth with a timber mantel. Its back goes against a wall.',
  build(g, p, o) {
    const stone = mat('stone'), block = mat('stoneBlock'), tim = mat('timber'), iron = mat('iron');
    const ember = mat('ember'), glow = mat('lampGlow');
    const Z0 = BACK - 0.02, D = 0.52, zf = Z0 + D;
    bxe(g, block, -0.95, 0.95, 0, 0.07, Z0, zf + 0.42);
    // surround with an arched opening (extruded front-to-back)
    const hole = [[-0.42, 0.07], [0.42, 0.07], [0.42, 0.62]];
    for (let i = 1; i < 10; i++) { const x = 0.42 - (i / 10) * 0.84; hole.push([x, 0.62 + 0.18 * (1 - (x / 0.42) ** 2)]); }
    hole.push([-0.42, 0.62]);
    poly(g, stone, [[-0.84, 0.07], [0.84, 0.07], [0.84, 1.12], [-0.84, 1.12]], D, 0, 0, Z0 + D / 2, 0, [hole]);
    bxe(g, mat('iron'), -0.44, 0.44, 0.07, 0.84, Z0 + 0.04, Z0 + 0.08);
    // mantel beam & corbels
    bxe(g, tim, -0.98, 0.98, 1.12, 1.26, Z0, zf + 0.07);
    for (const sx of [-1, 1]) bxe(g, tim, sx * 0.7 - 0.06, sx * 0.7 + 0.06, 0.98, 1.12, zf - 0.02, zf + 0.05);
    // chimney breast to the ceiling
    const top = LEVEL_H - o.b + 0.01;
    bxe(g, stone, -0.66, 0.66, 1.26, top, Z0, Z0 + 0.38);
    // dressed stones: voussoirs round the arch, jamb blocks, quoins up the breast
    for (let i = 0; i <= 8; i++) {
      const x = -0.42 + (i / 8) * 0.84;
      const yv = 0.62 + 0.18 * (1 - (x / 0.42) ** 2);
      const ang = Math.atan(-0.36 * x / 0.1764 * 0.5);
      const big = i === 4;
      bc(g, block, big ? 0.13 : 0.1, big ? 0.17 : 0.13, 0.04, x + Math.sin(-ang) * 0.06, yv + Math.cos(ang) * 0.07, zf + 0.012, 0, 0, ang);
    }
    for (const sx of [-1, 1]) {
      for (let k = 0; k < 4; k++) bc(g, block, k % 2 ? 0.12 : 0.17, 0.12, 0.04, sx * (0.48 + (k % 2 ? 0.02 : 0.045)), 0.14 + k * 0.135, zf + 0.012);
      for (let y = 1.33, k = 0; y < top - 0.08; y += 0.27, k++) bc(g, block, k % 2 ? 0.14 : 0.24, 0.13, 0.03, sx * (0.66 - (k % 2 ? 0.07 : 0.12)), y, Z0 + 0.39);
    }
    // the fire: grate, logs, embers, flames
    const fz = Z0 + 0.3;
    bxe(g, ember, -0.3, 0.3, 0.07, 0.095, fz - 0.12, fz + 0.12);
    for (const sx of [-1, 1]) bxe(g, iron, sx * 0.27 - 0.015, sx * 0.27 + 0.015, 0.07, 0.2, fz - 0.15, fz + 0.15);
    bxe(g, iron, -0.3, 0.3, 0.12, 0.14, fz + 0.13, fz + 0.15);
    log(g, 0, 0.15, fz - 0.04, 0.55, 0.055, 0.12);
    log(g, 0.02, 0.15, fz + 0.08, 0.5, 0.05, -0.1);
    log(g, -0.04, 0.24, fz + 0.02, 0.45, 0.045, 0.25);
    cone(g, ember, 0.11, 0.36, 0, 0.17, fz + 0.02, 7);
    cone(g, ember, 0.08, 0.27, -0.15, 0.16, fz + 0.04, 6, 0, 0, 0.18);
    cone(g, ember, 0.075, 0.25, 0.15, 0.16, fz, 6, 0, 0, -0.15);
    cone(g, glow, 0.06, 0.2, 0.01, 0.18, fz + 0.06, 6);
    cone(g, glow, 0.04, 0.13, -0.12, 0.18, fz + 0.07, 5);
    // mantel things
    const my = 1.26, mz = Z0 + 0.47;
    candle(g, -0.78, my, mz, 0.16); candle(g, -0.66, my, mz, 0.11);
    candle(g, 0.78, my, mz, 0.13);
    const ck = mat('wood');
    poly(g, ck, archPanel(0.2, 0, 0.18, 0.26, 6), 0.09, 0, my, mz);
    cylc(g, cer(COL.wax), 0.065, 0.065, 0.012, 0, my + 0.15, mz + 0.047, 14, PI / 2, 0, 0);
    bc(g, iron, 0.008, 0.05, 0.004, 0, my + 0.17, mz + 0.054, 0, 0, 0);
    bc(g, iron, 0.035, 0.008, 0.004, 0.012, my + 0.15, mz + 0.054, 0, 0, 0);
    candle(g, 0.4, my, mz, 0.09);
  },
});

// ---------------------------------------------------------------- rugs
decor({
  id: 'rug', name: 'Rug', cat: 'interior', icon: '🟥', sound: 'soft', paintAlways: true, layer: 'D',
  desc: 'A soft woven rug with a border and fringed ends. Furniture can stand on it.',
  build(g, p) {
    const c = p.c || '#8e3b32';
    const base = fab(c), edge = fab(COL.cream), dark = fab(tint(c, -0.35));
    const W = 1.8, D = 1.26, y = 0.003;
    bc(g, base, W, 0.012, D, 0, y + 0.006, 0);
    const frame = (inset, bw, m, h) => {
      const x = W / 2 - inset, z = D / 2 - inset;
      bxe(g, m, -x, x, y, y + h, z - bw, z);
      bxe(g, m, -x, x, y, y + h, -z, -z + bw);
      bxe(g, m, -x, -x + bw, y, y + h, -z + bw, z - bw);
      bxe(g, m, x - bw, x, y, y + h, -z + bw, z - bw);
    };
    frame(0.08, 0.07, edge, 0.016);
    frame(0.2, 0.035, dark, 0.016);
    // centre medallion
    poly(g, edge, [[0, -0.28], [0.36, 0], [0, 0.28], [-0.36, 0]], 0.016, 0, y + 0.008, 0, 0).rotation.set(PI / 2, 0, 0);
    poly(g, dark, [[0, -0.16], [0.2, 0], [0, 0.16], [-0.2, 0]], 0.02, 0, y + 0.01, 0, 0).rotation.set(PI / 2, 0, 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) bc(g, edge, 0.12, 0.016, 0.12, sx * 0.55, y + 0.008, sz * 0.33, 0, PI / 4, 0);
    // fringe
    for (const sx of [-1, 1]) for (let i = 0; i < 11; i++) bc(g, edge, 0.06, 0.006, 0.022, sx * (W / 2 + 0.03), y + 0.003, -D / 2 + 0.08 + i * ((D - 0.16) / 10));
  },
});

decor({
  id: 'rug_round', name: 'Braided Rug', cat: 'interior', icon: '🟠', sound: 'soft', paintAlways: true, layer: 'D',
  desc: 'An oval rag-braided rug in cosy rings. Furniture can stand on it.',
  build(g, p) {
    const c = p.c || COL.denim;
    const ms = [fab(c), fab(COL.cream), fab(tint(c, -0.3)), fab(tint(c, 0.25))];
    const rings = [0.95, 0.82, 0.69, 0.56, 0.43, 0.3, 0.17];
    const order = [0, 1, 2, 0, 3, 1, 2];
    rings.forEach((r, i) => {
      const h = 0.012 + i * 0.0015;
      const o = cyl(g, ms[order[i]], r, r, h, 0, 0.002, 0, 28);
      o.scale.set(1, 1, 0.72);
    });
    const t = add(g, torusGeo(0.95, 0.013, 4, 32), ms[0], 0, 0.012, 0, PI / 2, 0, 0);
    t.scale.set(1, 0.72, 1);
  },
});

// ---------------------------------------------------------------- floor lamp
decor({
  id: 'floor_lamp', name: 'Floor Lamp', cat: 'interior', icon: '💡', sound: 'metal',
  mats: ['iron', 'wood', 'timber'], matGroup: 'lamp',
  desc: 'A tall reading lamp with a warm glowing shade.',
  build(g, p) {
    const m = mat(p.m);
    add(g, latheGeo('floorlampbase', [[0.001, 0], [0.17, 0], [0.18, 0.015], [0.16, 0.04], [0.06, 0.07], [0.03, 0.1], [0.001, 0.1]], 16), m, 0, 0, 0);
    cyl(g, m, 0.018, 0.022, 1.38, 0, 0.08, 0, 8);
    ball(g, m, 0.035, 0, 0.62, 0, 1, 1.3, 1, 8, 6);
    ball(g, mat('lampGlow'), 0.06, 0, 1.42, 0, 1, 1.2, 1, 8, 6);
    add(g, latheGeo('floorshade', [[0.27, 0], [0.27, 0.01], [0.17, 0.3], [0.16, 0.3], [0.255, 0.012]], 16), mat('lampGlow'), 0, 1.3, 0);
    for (const [r, y] of [[0.272, 1.305], [0.168, 1.6]]) add(g, torusGeo(r, 0.012, 4, 18), fab(COL.rust), 0, y, 0, PI / 2, 0, 0);
  },
});

// ---------------------------------------------------------------- house plant
decor({
  id: 'plant_pot', name: 'House Plant', cat: 'interior', icon: '🪴', sound: 'leaf', cacheExtra: variantKey,
  desc: 'A big leafy plant in a terracotta pot.',
  build(g, p, o) {
    add(g, latheGeo('pot', POT, 16), cer(COL.terracotta), 0, 0, 0);
    cyl(g, mat('dirt'), 0.18, 0.18, 0.02, 0, 0.29, 0, 14);
    leafyPlant(g, 0, 0.3, 0, 0.75 + o.v * 0.05, o.v, 9);
    leafyPlant(g, 0.02, 0.3, -0.01, 0.45, o.v + 9, 5);
  },
});

// ---------------------------------------------------------------- bathtub
const TUB_OUT = [[0.001, 0.1], [0.28, 0.1], [0.34, 0.14], [0.38, 0.28], [0.405, 0.48], [0.42, 0.6]];
const TUB_IN = [[0.42, 0.6], [0.44, 0.615], [0.445, 0.64], [0.43, 0.658], [0.405, 0.655], [0.385, 0.6], [0.36, 0.42], [0.32, 0.26], [0.26, 0.2], [0.001, 0.19]];
decor({
  id: 'bathtub', name: 'Clawfoot Tub', cat: 'interior', icon: '🛁', sound: 'metal', paintAlways: true,
  desc: 'A deep clawfoot bath full of bubbles (and a rubber duck). Paint the outside.',
  build(g, p) {
    const outer = cer(p.c || COL.teal), white = cer(COL.pillow), iron = mat('iron');
    const zc = -0.42, SX = 2.05;
    add(g, latheGeo('tubout', TUB_OUT, 18), outer, 0, 0, zc).scale.set(SX, 1, 1);
    add(g, latheGeo('tubin', TUB_IN, 18), white, 0, 0, zc).scale.set(SX, 1, 1);
    const water = cylc(g, mat('water'), 0.37, 0.37, 0.01, 0, 0.5, zc, 18);
    water.scale.set(SX * 0.98, 1, 0.98);
    // bubbles
    const r = rng(7);
    for (let i = 0; i < 10; i++) {
      const a = r() * TAU, d = Math.sqrt(r());
      ball(g, white, 0.06 + r() * 0.05, -0.35 + Math.cos(a) * d * 0.32, 0.51, zc + Math.sin(a) * d * 0.22, 1, 0.6, 1, 7, 4);
    }
    // rubber duck
    const duck = mat('petalYellow');
    ball(g, duck, 0.07, 0.3, 0.535, zc + 0.05, 1.2, 0.8, 1, 8, 6);
    ball(g, duck, 0.045, 0.36, 0.6, zc + 0.05, 1, 1, 1, 8, 6);
    cone(g, mat('pumpkin'), 0.02, 0.04, 0.41, 0.595, zc + 0.05, 5, 0, 0, -PI / 2);
    // claw feet
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const fx = sx * 0.55, fz = zc + sz * 0.2;
      ball(g, iron, 0.05, fx, 0.04, fz, 1, 0.8, 1, 6, 4);
      rod(g, iron, [fx, 0.05, fz], [fx * 0.9, 0.16, fz - sz * 0.02], 0.03, 0.04, 6);
    }
    // tap at the far end
    const tx = -0.72;
    cyl(g, iron, 0.018, 0.018, 0.22, tx, 0.62, zc, 6);
    add(g, torusGeo(0.06, 0.015, 5, 10, PI), iron, tx + 0.06, 0.84, zc, 0, 0, 0);
    for (const s of [-1, 1]) ball(g, white, 0.022, tx, 0.74, zc + s * 0.06, 1, 1, 1, 6, 4);
    // towel over the rim
    const towel = fab(COL.rust);
    bc(g, towel, 0.3, 0.02, 0.1, 0.25, 0.665, zc + 0.39, 0, 0, 0);
    bc(g, towel, 0.3, 0.32, 0.02, 0.25, 0.5, zc + 0.445, 0, 0, 0);
  },
});

// ---------------------------------------------------------------- piano
decor({
  id: 'piano', name: 'Upright Piano', cat: 'interior', icon: '🎹', sound: 'wood',
  mats: ['timber', 'wood', 'paintedWood'], matGroup: 'piano', paint: true,
  desc: 'An old upright piano with a bench and a stack of sheet music.',
  build(g, p) {
    const m = woodOf(p, COL.cream);
    const white = cer(COL.pillow), black = cer(COL.charcoal), brass = mat('iron');
    const W = 1.46, z0 = BACK, zb = BACK + 0.5, H = 1.3;
    bxe(g, m, -W / 2 + 0.04, W / 2 - 0.04, 0.05, 0.66, z0, zb - 0.06);               // lower case
    bxe(g, m, -W / 2 + 0.04, W / 2 - 0.04, 0.0, 0.06, z0, zb - 0.02);                 // toe rail
    bxe(g, m, -W / 2 + 0.04, W / 2 - 0.04, 0.82, H, z0, zb);                         // upper case
    bxe(g, m, -W / 2 - 0.01, W / 2 + 0.01, H, H + 0.04, z0, zb + 0.03);              // lid
    const zk = zb + 0.26;
    for (const sx of [-1, 1]) {
      bxe(g, m, sx * W / 2 - 0.04, sx * W / 2, 0, H, z0, zb);                       // side cheeks
      bxe(g, m, sx * W / 2 - 0.05, sx * W / 2, 0.66, 0.8, zb, zk);                  // key cheeks
      turnedLeg(g, m, sx * (W / 2 - 0.08), zk - 0.05, 0.66, 0.035);
    }
    bxe(g, m, -W / 2, W / 2, 0.62, 0.7, zb - 0.06, zk);                               // keybed
    bxe(g, white, -W / 2 + 0.05, W / 2 - 0.05, 0.7, 0.725, zb, zk - 0.02);
    const nW = 36, kw = (W - 0.1) / nW;
    for (let i = 0; i < nW - 1; i++) {
      const n = i % 7;
      if (n === 2 || n === 6) continue;
      bxe(g, black, -W / 2 + 0.05 + kw * (i + 1) - kw * 0.3, -W / 2 + 0.05 + kw * (i + 1) + kw * 0.3, 0.725, 0.75, zb, zb + 0.1);
    }
    bc(g, m, W - 0.1, 0.14, 0.03, 0, 0.82, zb + 0.01, -0.35, 0, 0);                   // fallboard
    bc(g, m, 0.6, 0.2, 0.025, 0, 0.98, zb + 0.02, -0.15, 0, 0);                       // music desk
    bc(g, cer(COL.paper), 0.42, 0.26, 0.012, -0.02, 1.02, zb + 0.04, -0.15, 0.04, 0);
    bc(g, cer(COL.paper), 0.4, 0.25, 0.012, 0.04, 1.02, zb + 0.045, -0.15, -0.06, 0);
    for (const sx of [-1, 1]) {
      rod(g, brass, [sx * 0.05, 0.03, zb - 0.04], [sx * 0.05, 0.05, zb + 0.06], 0.012, 0.012, 5);
      candle(g, sx * (W / 2 - 0.12), H + 0.04, z0 + 0.2, 0.13);
    }
    photoFrame(g, -0.3, H + 0.04, z0 + 0.22, 0.15);
    photoFrame(g, -0.12, H + 0.04, z0 + 0.18, -0.1);
    cone(g, m, 0.075, 0.22, 0.3, H + 0.04, z0 + 0.22, 4, 0, PI / 4, 0);
    rod(g, cer(COL.paper), [0.3, H + 0.08, z0 + 0.28], [0.33, H + 0.22, z0 + 0.28], 0.006, 0.006, 3);
    // bench
    const bz = zk + 0.4;
    bxe(g, m, -0.42, 0.42, 0.44, 0.5, bz - 0.17, bz + 0.17);
    puff(g, fab(COL.red), 0.78, 0.05, 0.3, 0, 0.52, bz, 0.35);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) cyl(g, m, 0.025, 0.02, 0.44, sx * 0.36, 0, bz + sz * 0.13, 7);
  },
});

// ---------------------------------------------------------------- sleeping cat
const CUSHION = [[0.001, 0], [0.3, 0], [0.355, 0.015], [0.38, 0.05], [0.375, 0.085], [0.345, 0.118], [0.28, 0.135], [0.001, 0.14]];

/** Thin ellipsoid band across an ellipsoid body (for tabby stripes), clipped to its cross-section at dx. */
function stripe(g, m, cx, cy, cz, rx, ry, rz, dx, w) {
  const k = Math.sqrt(Math.max(0, 1 - (dx / rx) ** 2)) * 1.04 + 0.01;
  ball(g, m, 1, cx + dx, cy, cz, w, ry * k, rz * k, 9, 6);
}

decor({
  id: 'cat', name: 'Sleepy Cat', cat: 'interior', icon: '🐈', sound: 'soft', paintAlways: true,
  desc: 'A cat curled up asleep on a round cushion, with a ball of yarn. Paint its fur — ginger, grey, black, cream…',
  build(g, p) {
    const fc = p.c || '#e0924a';
    const fur = fab(fc), dark = fab(tint(fc, -0.32)), cream = fab(COL.pillow);
    const pink = cer(COL.pink), lid = cer(COL.charcoal);
    add(g, latheGeo('cushion', CUSHION, 16), fab(COL.teal), 0, 0, 0);
    add(g, torusGeo(0.378, 0.014, 3, 22), fab(COL.cream), 0, 0.068, 0, PI / 2, 0, 0);
    const c = new THREE.Group();
    c.position.set(0.02, 0.125, -0.02);
    c.rotation.y = 0.2;
    g.add(c);
    // body loaf + haunch, with tabby bands
    const B = [0.03, 0.1, -0.03, 0.22, 0.125, 0.175];
    ball(c, fur, 1, B[0], B[1], B[2], B[3], B[4], B[5], 12, 8);
    ball(c, fur, 0.12, 0.13, 0.11, -0.08, 1, 0.95, 1, 10, 7);
    for (const dx of [-0.07, 0.02, 0.11]) stripe(c, dark, B[0], B[1], B[2], B[3], B[4], B[5], dx, 0.022);
    // tail wrapping round the front, darker tip
    const tail = [[0.2, 0.05, -0.12], [0.26, 0.04, 0.04], [0.14, 0.035, 0.17], [-0.05, 0.035, 0.2], [-0.2, 0.04, 0.15]];
    add(c, tubeGeo('cattail2', tail, 0.042, 0.03, 12, 6), fur, 0, 0, 0);
    ball(c, dark, 0.032, -0.2, 0.04, 0.15, 1.3, 1, 1, 7, 5, 0, -0.5, 0);
    // front paws
    ball(c, cream, 0.042, -0.15, 0.03, 0.1, 1.25, 0.7, 1, 7, 5, 0, 0.4, 0);
    ball(c, cream, 0.042, -0.07, 0.03, 0.13, 1.25, 0.7, 1, 7, 5, 0, 0.2, 0);
    // head resting on the paws, face to the front
    const head = new THREE.Group();
    head.position.set(-0.16, 0.115, 0.07);
    head.rotation.set(0.2, 0.25, 0.28);
    c.add(head);
    ball(head, fur, 0.11, 0, 0, 0, 1.12, 0.9, 1, 12, 8);
    for (const s of [-1, 1]) {
      cone(head, fur, 0.046, 0.085, s * 0.066, 0.055, -0.012, 5, 0, 0, -s * 0.38);
      cone(head, pink, 0.026, 0.05, s * 0.064, 0.068, 0.006, 4, 0, 0, -s * 0.38);
      bc(head, lid, 0.038, 0.009, 0.01, s * 0.045, 0.012, 0.096, -0.15, s * 0.2, -s * 0.22);
    }
    ball(head, cream, 0.045, 0, -0.04, 0.078, 1.3, 0.8, 0.8, 8, 6);
    ball(head, pink, 0.013, 0, -0.016, 0.108, 1.3, 0.8, 1, 6, 4);
    // ball of yarn with a loose strand
    const yarn = fab(COL.rust);
    ball(g, yarn, 0.065, 0.42, 0.065, 0.36, 1, 1, 1, 9, 6);
    add(g, torusGeo(0.064, 0.008, 3, 14), yarn, 0.42, 0.065, 0.36, 0.5, 0.3, 0);
    add(g, tubeGeo('yarn', [[0.4, 0.02, 0.3], [0.33, 0.006, 0.2], [0.36, 0.006, 0.08], [0.3, 0.06, 0.0]], 0.006, 0.006, 10, 3), yarn, 0, 0, 0);
  },
});

// ---------------------------------------------------------------- dog bed
decor({
  id: 'dog_bed', name: 'Dog Bed', cat: 'interior', icon: '🐕', sound: 'soft', paintAlways: true,
  desc: 'A plump bolster bed with a sleepy golden pup (and a bone).',
  build(g, p) {
    const bcol = p.c || COL.plum;
    const fur = fab('#d9a066'), ear = fab('#a8703f'), muzzle = fab('#f1d9b0'), black = cer(COL.charcoal);
    const t = add(g, torusGeo(0.42, 0.105, 6, 20), fab(bcol), 0, 0.105, 0, PI / 2, 0, 0);
    t.scale.set(1.08, 0.72, 1);
    puff(g, fab(tint(bcol, 0.45)), 0.86, 0.1, 0.56, 0, 0.05, 0, 0.5, 0, 0, 0, 14, 6);
    const d = new THREE.Group();
    d.position.set(0.03, 0.08, -0.02);
    g.add(d);
    ball(d, fur, 1, 0.08, 0.12, -0.02, 0.26, 0.13, 0.17, 12, 8);
    ball(d, fur, 0.15, 0.25, 0.11, -0.03, 1, 0.85, 1, 10, 7);
    ball(d, fur, 0.075, 0.25, 0.05, 0.12, 1.5, 0.6, 0.9, 8, 6);
    add(d, tubeGeo('dogtail2', [[0.38, 0.07, -0.05], [0.42, 0.05, 0.08], [0.33, 0.04, 0.19]], 0.034, 0.02, 10, 6), fur, 0, 0, 0);
    const a = -0.75;
    for (const [px, pz] of [[-0.27, 0.12], [-0.16, 0.18]]) ball(d, fur, 1, px, 0.04, pz, 0.045, 0.034, 0.1, 8, 6, 0, a, 0);
    const head = new THREE.Group();
    head.position.set(-0.24, 0.13, 0.08);
    head.rotation.set(0.12, a, 0.05);
    d.add(head);
    ball(head, fur, 0.12, 0, 0, 0, 1, 0.9, 1.05, 12, 8);
    ball(head, muzzle, 1, 0, -0.035, 0.12, 0.065, 0.052, 0.1, 10, 7);
    ball(head, black, 0.025, 0, -0.008, 0.215, 1.1, 0.85, 1, 6, 5);
    for (const s of [-1, 1]) {
      ball(head, ear, 1, s * 0.11, -0.03, -0.01, 0.025, 0.085, 0.05, 8, 6, 0, 0, s * 0.25);
      bc(head, black, 0.034, 0.009, 0.01, s * 0.05, 0.035, 0.105, 0, 0, -s * 0.15);
    }
    // a bone
    const bone = cer(COL.pillow);
    const bx = 0.45, bz = 0.42, ba = 0.6;
    cylc(g, bone, 0.018, 0.018, 0.16, bx, 0.03, bz, 7, 0, ba, PI / 2);
    for (const s of [-1, 1]) for (const k of [-1, 1]) {
      ball(g, bone, 0.026, bx + s * 0.08 * Math.cos(ba) + k * 0.02 * Math.sin(ba), 0.03, bz - s * 0.08 * Math.sin(ba) + k * 0.02 * Math.cos(ba), 1, 1, 1, 6, 5);
    }
  },
});

// ---------------------------------------------------------------- crates & barrel
function crate(g, m, x, y, z, w, h, d, ry = 0) {
  const c = new THREE.Group();
  c.position.set(x, y, z);
  c.rotation.y = ry;
  g.add(c);
  const t = 0.022, post = 0.045;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) bxe(c, m, sx * w / 2 - (sx > 0 ? post : 0), sx * w / 2 + (sx < 0 ? post : 0), 0, h, sz * d / 2 - (sz > 0 ? post : 0), sz * d / 2 + (sz < 0 ? post : 0));
  const nS = 3, sh = (h - 0.02) / nS;
  for (let i = 0; i < nS; i++) {
    const y0 = 0.01 + i * sh + 0.012, y1 = 0.01 + (i + 1) * sh - 0.012;
    for (const sz of [-1, 1]) bxe(c, m, -w / 2 + 0.01, w / 2 - 0.01, y0, y1, sz * d / 2 - t / 2, sz * d / 2 + t / 2);
    for (const sx of [-1, 1]) bxe(c, m, sx * w / 2 - t / 2, sx * w / 2 + t / 2, y0, y1, -d / 2 + 0.01, d / 2 - 0.01);
  }
  bxe(c, m, -w / 2 + 0.02, w / 2 - 0.02, 0.01, 0.03, -d / 2 + 0.02, d / 2 - 0.02);
  return c;
}

decor({
  id: 'crate_stack', name: 'Crates', cat: 'interior', icon: '📦', sound: 'wood',
  mats: ['wood', 'timber'], matGroup: 'crates', cacheExtra: variantKey,
  desc: 'Stacked slatted crates — the top one full of harvest.',
  build(g, p, o) {
    const m = mat(p.m);
    const w = 0.62, h = 0.4, d = 0.44;
    crate(g, m, -0.34, 0, -0.1, w, h, d, 0.04);
    crate(g, m, 0.33, 0, -0.05, w, h, d, -0.08);
    const top = crate(g, m, -0.05, h, -0.08, w, h, d, 0.12 + o.v * 0.05);
    const fill = [cer(COL.apple), mat('pumpkin'), mat('leaves'), cer('#c9a46a')][o.v];
    const r = rng(o.v + 50);
    const rr = o.v === 2 ? 0.1 : 0.065;
    for (let i = 0; i < 9; i++) {
      const fx = -w / 2 + 0.1 + (i % 3) * (w - 0.2) / 2 + (r() - 0.5) * 0.04;
      const fz = -d / 2 + 0.1 + Math.floor(i / 3) * (d - 0.2) / 2 + (r() - 0.5) * 0.04;
      ball(top, fill, rr, fx, h - 0.06 + r() * 0.03, fz, 1, o.v === 2 ? 0.8 : 0.9, 1, 7, 5);
    }
    crate(g, m, 0.42, 0, 0.42, w * 0.8, h * 0.7, d * 0.8, 0.5);
  },
});

const BARREL = [[0.001, 0.02], [0.25, 0.02], [0.27, 0.0], [0.3, 0.2], [0.315, 0.42], [0.3, 0.64], [0.27, 0.84], [0.25, 0.82], [0.001, 0.82]];
decor({
  id: 'barrel', name: 'Barrel', cat: 'interior', icon: '🛢️', sound: 'wood',
  mats: ['wood', 'timber'], matGroup: 'crates',
  desc: 'An oak barrel with iron hoops, and a little keg beside it.',
  build(g, p) {
    const m = mat(p.m), iron = mat('iron');
    add(g, latheGeo('barrel', BARREL, 14), m, -0.15, 0, -0.1);
    for (const [y, r] of [[0.08, 0.284], [0.26, 0.305], [0.58, 0.305], [0.76, 0.284]]) cyl(g, iron, r, r, 0.04, -0.15, y - 0.02, -0.1, 14);
    add(g, torusGeo(0.255, 0.018, 4, 14), m, -0.15, 0.83, -0.1, PI / 2, 0, 0);
    // keg on a little cradle
    const k = add(g, latheGeo('keg', [[0.001, 0.0], [0.15, 0.0], [0.18, 0.12], [0.19, 0.22], [0.18, 0.32], [0.15, 0.44], [0.001, 0.44]], 12), m, 0.48, 0.24, 0.25, 0, 0, PI / 2);
    k.position.x = 0.7;
    for (const y of [0.09, 0.35]) cylc(g, iron, 0.183, 0.183, 0.03, 0.7 - y, 0.24, 0.25, 12, 0, 0, PI / 2);
    for (const x of [0.38, 0.62]) bxe(g, mat('timber'), x - 0.03, x + 0.03, 0, 0.1, 0.1, 0.4);
    cylc(g, mat('iron'), 0.02, 0.02, 0.06, 0.28, 0.24, 0.25, 6, 0, 0, PI / 2);
  },
});

// ====================================================================== GARDEN

const GROUND_LEVEL = [0, 0];

// ---------------------------------------------------------------- trees
decor({
  id: 'tree_oak', name: 'Oak Tree', cat: 'garden', icon: '🌳', sound: 'leaf', levels: GROUND_LEVEL, cacheExtra: variantKey,
  desc: 'A big round shady oak. Every one grows a little differently.',
  build(g, p, o) {
    const bark = mat('bark'), leaves = mat('leaves');
    const r = rng(o.v * 13 + 1);
    const rot = o.v * 1.57 + 0.4;
    cyl(g, bark, 0.2, 0.28, 2.35, 0, -0.06, 0, 9);
    cyl(g, bark, 0.27, 0.42, 0.34, 0, -0.06, 0, 9);
    for (let i = 0; i < 4; i++) {
      const a = rot + (i / 4) * TAU + 0.3;
      rod(g, bark, [Math.cos(a) * 0.18, 0.22, Math.sin(a) * 0.18], [Math.cos(a) * 0.56, -0.04, Math.sin(a) * 0.56], 0.15, 0.07, 6);
    }
    const blobs = [[0, 3.95, 0, 1.55]];
    const n = 6;
    for (let i = 0; i < n; i++) {
      const a = rot + (i / n) * TAU + (r() - 0.5) * 0.5;
      const d = 1.3 + r() * 0.35;
      blobs.push([Math.cos(a) * d, 3.3 + r() * 0.65, Math.sin(a) * d, 0.95 + r() * 0.3]);
    }
    for (let i = 0; i < 3; i++) {
      const a = rot + (i / 3) * TAU + 0.5;
      blobs.push([Math.cos(a) * 0.65, 4.75 + r() * 0.3, Math.sin(a) * 0.65, 0.95 + r() * 0.2]);
    }
    for (let i = 1; i <= 5; i += 2) {
      const [bx, by, bz] = blobs[i];
      rod(g, bark, [0, 2.0, 0], [bx * 0.55, by - 0.5, bz * 0.55], 0.13, 0.06, 6);
    }
    blobs.forEach(([x, y, z, rr], i) => blob(g, leaves, rr, x, y, z, i + o.v * 3, 0.9, 0.1));
  },
});

decor({
  id: 'tree_pine', name: 'Pine Tree', cat: 'garden', icon: '🌲', sound: 'leaf', levels: GROUND_LEVEL, cacheExtra: variantKey,
  desc: 'A tall evergreen pine, green all year round.',
  build(g, p, o) {
    const bark = mat('bark'), needles = mat('leavesDark');
    const s = 0.92 + o.v * 0.05;
    cyl(g, bark, 0.1, 0.22, 2.2, 0, -0.06, 0, 8);
    const tiers = [[1.75, 1.85, 0.85], [1.5, 1.7, 1.95], [1.22, 1.5, 3.0], [0.92, 1.35, 3.95], [0.62, 1.2, 4.85], [0.34, 1.05, 5.7]];
    tiers.forEach(([r, h, y], i) => add(g, pineTierGeo(r * s, h * s, o.v * 7 + i), needles, 0, y * s, 0, 0, i * 0.7 + o.v, 0));
  },
});

decor({
  id: 'tree_birch', name: 'Birch Trees', cat: 'garden', icon: '🌳', sound: 'leaf', levels: GROUND_LEVEL, cacheExtra: variantKey,
  desc: 'A clump of slender white birches with airy, fluttering leaves.',
  build(g, p, o) {
    const bark = mat('plaster', '#ece7dc'), mark = mat('timber'), leaves = mat('leaves');
    const r = rng(o.v * 5 + 3);
    const trunks = [[0, 0, 5.2, 0.15, 0.25], [0.45, 0.25, 4.4, 0.12, 0.45], [-0.32, 0.4, 3.9, 0.11, 0.55]];
    trunks.forEach(([bx, bz, h, rad, lean], ti) => {
      const a = o.v * 1.3 + ti * 2.1;
      const tx = bx + Math.cos(a) * lean, tz = bz + Math.sin(a) * lean;
      rod(g, bark, [bx, -0.06, bz], [tx, h, tz], rad, rad * 0.4, 7);
      for (let k = 0; k < 7; k++) {
        const t = 0.08 + k * 0.12 + r() * 0.05;
        const ma = r() * TAU;
        const rr = rad * (1 - 0.6 * t) * 0.97;
        const mx = bx + (tx - bx) * t + Math.cos(ma) * rr, my = -0.06 + (h + 0.06) * t, mz = bz + (tz - bz) * t + Math.sin(ma) * rr;
        bc(g, mark, 0.07 + r() * 0.06, 0.03, 0.025, mx, my, mz, 0, -ma + PI / 2, 0);
      }
      const nb = ti === 0 ? 6 : 4;
      for (let k = 0; k < nb; k++) {
        const t = 0.5 + (k / (nb - 1)) * 0.5;
        const ba = a + k * 2.4 + r() * 0.6;
        const d = 0.15 + 0.5 * (1 - t) + r() * 0.15;
        const cx = bx + (tx - bx) * t, cz = bz + (tz - bz) * t;
        const bxk = cx + Math.cos(ba) * d, bzk = cz + Math.sin(ba) * d, byk = h * t + 0.05;
        if (k % 2 === 0 && d > 0.3) rod(g, bark, [cx, byk - 0.35, cz], [bxk * 0.8 + cx * 0.2, byk, bzk * 0.8 + cz * 0.2], rad * 0.3, rad * 0.15, 4);
        blob(g, leaves, 0.42 + 0.22 * (1 - t) + r() * 0.1, bxk, byk + 0.1, bzk, ti * 9 + k, 1.2, 0.13);
      }
    });
  },
});

decor({
  id: 'tree_apple', name: 'Apple Tree', cat: 'garden', icon: '🍎', sound: 'leaf', levels: GROUND_LEVEL, cacheExtra: variantKey,
  desc: 'A little orchard apple tree, heavy with red apples (a few have fallen).',
  build(g, p, o) {
    const bark = mat('bark'), leaves = mat('leaves'), apple = cer(COL.apple);
    const r = rng(o.v * 11 + 7);
    const rot = o.v * 1.1;
    rod(g, bark, [0, -0.06, 0], [0.06, 1.25, 0.03], 0.19, 0.14, 8);
    const crown = [];
    for (let i = 0; i < 6; i++) {
      const a = rot + (i / 6) * TAU + (r() - 0.5) * 0.4;
      const d = 1.15 + r() * 0.25;
      crown.push([Math.cos(a) * d, 2.45 + r() * 0.35, Math.sin(a) * d, 0.82 + r() * 0.2]);
    }
    crown.push([0, 2.85, 0, 1.25]);
    crown.push([Math.cos(rot) * 0.45, 3.45, Math.sin(rot) * 0.45, 0.78]);
    crown.push([Math.cos(rot + 2.6) * 0.45, 3.4, Math.sin(rot + 2.6) * 0.45, 0.72]);
    for (let i = 0; i < 6; i += 2) {
      const [bx, by, bz] = crown[i];
      rod(g, bark, [0.05, 1.15, 0.02], [bx * 0.6, by - 0.35, bz * 0.6], 0.11, 0.06, 6);
    }
    crown.forEach(([x, y, z, rr], i) => blob(g, leaves, rr, x, y, z, i + o.v * 2, 0.88, 0.08));
    for (let i = 0; i < 21; i++) {
      const k = i % 7;
      const [bx, by, bz, br] = crown[k];
      const out = k < 6 ? Math.atan2(bz, bx) : r() * TAU;
      const a = out + (r() - 0.5) * 1.5, el = -0.35 + r() * 0.85;
      const ce = Math.cos(el), rr = br * 1.03;
      ball(g, apple, 0.09, bx + Math.cos(a) * ce * rr, by + Math.sin(el) * rr * 0.88, bz + Math.sin(a) * ce * rr, 1, 0.92, 1, 6, 4);
    }
    for (let i = 0; i < 3; i++) {
      const a = r() * TAU, d = 0.5 + r() * 0.6;
      ball(g, apple, 0.08, Math.cos(a) * d, 0.07, Math.sin(a) * d, 1, 0.9, 1, 6, 4);
    }
  },
});

// ---------------------------------------------------------------- bushes & flowers
decor({
  id: 'bush', name: 'Bush', cat: 'garden', icon: '🌿', sound: 'leaf', cacheExtra: variantKey,
  desc: 'A round leafy shrub — some burst into blossom.',
  build(g, p, o) {
    const leaves = mat('leaves');
    const r = rng(o.v * 3 + 2);
    const bl = [[0, 0.5, 0, 0.55]];
    for (let i = 0; i < 4; i++) {
      const a = o.v + (i / 4) * TAU + r() * 0.5;
      bl.push([Math.cos(a) * 0.42, 0.34 + r() * 0.1, Math.sin(a) * 0.42, 0.36 + r() * 0.12]);
    }
    bl.forEach(([x, y, z, rr], i) => blob(g, leaves, rr, x, y, z, i + o.v, 0.9, 0.14, 10, 7));
    if (o.v % 2) {
      const pm = mat(o.v === 1 ? 'petalWhite' : 'petalPink');
      for (let i = 0; i < 16; i++) {
        const [bx, by, bz, br] = bl[i % bl.length];
        const a = r() * TAU, el = -0.1 + r() * 1.1;
        ball(g, pm, 0.06, bx + Math.cos(a) * Math.cos(el) * br, by + Math.sin(el) * br * 0.9, bz + Math.sin(a) * Math.cos(el) * br, 1, 0.8, 1, 6, 4);
      }
    }
  },
});

const FLOWER_MIX = [
  ['petalPink', 'petalWhite', 'petalYellow'],
  ['petalPurple', 'petalYellow', 'petalWhite'],
  ['petalPink', 'petalPurple', 'petalWhite'],
  ['petalYellow', 'petalPink', 'petalPurple'],
];

function flowerHead(g, m, kind, x, y, z) {
  if (kind === 0) {           // daisy-like: flat petals + a golden button
    ball(g, m, 0.07, x, y, z, 1, 0.32, 1, 7, 4);
    ball(g, mat('petalYellow') === m ? mat('pumpkin') : mat('petalYellow'), 0.028, x, y + 0.018, z, 1, 0.7, 1, 5, 3);
  } else if (kind === 1) {    // tulip cup
    ball(g, m, 0.05, x, y + 0.02, z, 1, 1.35, 1, 6, 4);
  } else {                    // pompom
    ball(g, m, 0.055, x, y, z, 1, 0.9, 1, 6, 4);
  }
}

decor({
  id: 'flowers', name: 'Flower Patch', cat: 'garden', icon: '🌷', sound: 'leaf', cacheExtra: variantKey,
  desc: 'A cottage-garden tangle of daisies, tulips and pompoms. Each patch is a different mix.',
  build(g, p, o) {
    const leaves = mat('leaves');
    const r = rng(o.v * 29 + 9);
    const mix = FLOWER_MIX[o.v].map((id) => mat(id));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + r(), d = 0.2 + r() * 0.5;
      blob(g, leaves, 0.22 + r() * 0.1, Math.cos(a) * d, 0.06, Math.sin(a) * d, i + o.v, 0.55, 0.2, 9, 6);
    }
    for (let i = 0; i < 26; i++) {
      const a = r() * TAU, d = Math.sqrt(r()) * 0.78;
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      const h = 0.25 + r() * 0.3 - d * 0.1;
      rod(g, leaves, [x * 0.9, 0.02, z * 0.9], [x, h, z], 0.009, 0.007, 3);
      flowerHead(g, mix[i % 3], (i + o.v) % 3, x, h, z);
    }
  },
});

decor({
  id: 'lavender', name: 'Lavender', cat: 'garden', icon: '💜', sound: 'leaf', cacheExtra: variantKey,
  desc: 'Mounds of fragrant lavender with purple spikes.',
  build(g, p, o) {
    const leaves = mat('leaves'), purple = mat('petalPurple');
    const r = rng(o.v * 7 + 4);
    const spots = [[-0.55, -0.32], [0.05, -0.38], [0.6, -0.28], [-0.3, 0.35], [0.35, 0.36]];
    spots.forEach(([cx, cz], ci) => {
      cx += (r() - 0.5) * 0.1; cz += (r() - 0.5) * 0.1;
      blob(g, leaves, 0.27, cx, 0.1, cz, ci + o.v, 0.55, 0.2, 9, 6);
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * TAU + r() * 0.6, spread = 0.12 + r() * 0.22;
        const base = [cx + Math.cos(a) * 0.06, 0.15, cz + Math.sin(a) * 0.06];
        const h = 0.48 + r() * 0.2;
        const mid = [cx + Math.cos(a) * spread * 0.75, h - 0.12, cz + Math.sin(a) * spread * 0.75];
        const tip = [cx + Math.cos(a) * spread, h + 0.04, cz + Math.sin(a) * spread];
        rod(g, leaves, base, mid, 0.006, 0.006, 3);
        rod(g, purple, mid, tip, 0.03, 0.01, 4);
      }
    });
  },
});

// ---------------------------------------------------------------- vegetable bed
decor({
  id: 'veggie_bed', name: 'Vegetable Bed', cat: 'garden', icon: '🥕', sound: 'wood', cacheExtra: variantKey,
  mats: ['wood', 'timber'], matGroup: 'garden_wood',
  desc: 'A raised bed of cabbages, carrots and lettuces (or tomatoes on canes).',
  build(g, p, o) {
    const m = mat(p.m), dirt = mat('dirt'), leaves = mat('leaves'), pale = mat('grass');
    const X = 0.88, Z = 0.55, H = 0.32;
    for (const s of [-1, 1]) {
      bxe(g, m, -X, X, -0.04, H, s * Z - 0.025, s * Z + 0.025);
      bxe(g, m, s * X - 0.025, s * X + 0.025, -0.04, H, -Z + 0.025, Z - 0.025);
      for (const t of [-1, 1]) bxe(g, m, s * X - 0.045, s * X + 0.045, -0.04, H + 0.06, t * Z - 0.045, t * Z + 0.045);
    }
    bxe(g, dirt, -X + 0.025, X - 0.025, -0.04, H - 0.04, -Z + 0.025, Z - 0.025);
    const top = H - 0.04;
    const r = rng(o.v * 3 + 1);
    // cabbages
    for (let i = 0; i < 4; i++) {
      const x = -0.6 + i * 0.4, z = -0.3;
      ball(g, pale, 0.11, x, top + 0.09, z, 1, 0.9, 1, 7, 5);
      for (let k = 0; k < 4; k++) {
        const a = k * (PI / 2) + i;
        ball(g, leaves, 0.11, x + Math.cos(a) * 0.08, top + 0.06, z + Math.sin(a) * 0.08, 0.95, 0.4, 0.7, 6, 4, 0, -a, 0.5);
      }
    }
    // carrots
    for (let i = 0; i < 7; i++) {
      const x = -0.66 + i * 0.22, z = 0.02;
      cone(g, mat('pumpkin'), 0.035, 0.08, x, top - 0.04, z, 6, PI, 0, 0);
      for (let k = 0; k < 3; k++) cone(g, leaves, 0.03, 0.2, x + (k - 1) * 0.03, top + 0.02, z + (r() - 0.5) * 0.04, 4, 0, 0, (k - 1) * 0.35);
    }
    // lettuces or tomato canes
    if (o.v % 2 === 0) {
      for (let i = 0; i < 4; i++) {
        const x = -0.6 + i * 0.4, z = 0.32;
        blob(g, pale, 0.13, x, top + 0.05, z, i, 0.6, 0.22, 8, 5);
        blob(g, leaves, 0.1, x + 0.03, top + 0.07, z - 0.02, i + 3, 0.7, 0.25, 7, 5);
      }
    } else {
      const tom = cer('#d2452f');
      for (let i = 0; i < 3; i++) {
        const x = -0.55 + i * 0.55, z = 0.32;
        rod(g, mat('wood'), [x, top - 0.05, z], [x, top + 0.75, z], 0.012, 0.012, 4);
        for (let k = 0; k < 3; k++) blob(g, leaves, 0.12, x + (r() - 0.5) * 0.12, top + 0.2 + k * 0.2, z + (r() - 0.5) * 0.1, k + i, 1, 0.2, 7, 5);
        for (let k = 0; k < 4; k++) ball(g, tom, 0.045, x + (r() - 0.5) * 0.22, top + 0.18 + r() * 0.45, z + 0.08 + r() * 0.04, 1, 0.9, 1, 6, 4);
      }
    }
  },
});

// ---------------------------------------------------------------- pumpkins
decor({
  id: 'pumpkins', name: 'Pumpkin Patch', cat: 'garden', icon: '🎃', sound: 'leaf', cacheExtra: variantKey,
  desc: 'Fat orange pumpkins (and one pale one) on curly vines.',
  build(g, p, o) {
    const pm = mat('pumpkin'), pale = cer('#efe3c8'), stem = mat('bark'), leaves = mat('leaves');
    const spots = [[-0.25, -0.2, 0.33, pm], [0.45, 0.2, 0.25, pm], [-0.5, 0.5, 0.18, pm], [0.35, -0.5, 0.2, pale]];
    const rot = o.v * (PI / 2);
    const c = Math.cos(rot), s = Math.sin(rot);
    const pts = spots.map(([x, z, rr, m], i) => {
      const X = x * c - z * s, Z = x * s + z * c;
      add(g, pumpkinGeo(rr), m, X, rr * 0.66, Z, 0, i * 0.7, 0.04 * (i - 1));
      rod(g, stem, [X, rr * 1.2, Z], [X + 0.03, rr * 1.36 + 0.05, Z + 0.02], 0.028, 0.02, 5);
      return [X, 0.04, Z];
    });
    add(g, tubeGeo(`vine${o.v}`, [[-0.9 * c, 0.03, -0.9 * s], pts[0], [0, 0.05, 0.1], pts[1], [0.8 * c - 0.6 * s, 0.03, 0.8 * s + 0.6 * c]], 0.018, 0.012, 24, 4), leaves, 0, 0, 0);
    add(g, tubeGeo(`vine2${o.v}`, [pts[2], [-0.1, 0.04, 0.2], pts[3]], 0.015, 0.01, 14, 4), leaves, 0, 0, 0);
    const r = rng(o.v + 70);
    for (let i = 0; i < 6; i++) {
      const a = r() * TAU, d = 0.5 + r() * 0.35;
      ball(g, leaves, 0.17, Math.cos(a) * d, 0.04, Math.sin(a) * d, 1, 0.22, 0.85, 8, 5, 0, a, 0);
    }
  },
});

// ---------------------------------------------------------------- hay, firewood, well
function bale(g, x, y, z, ry) {
  const b = new THREE.Group();
  b.position.set(x, y, z);
  b.rotation.y = ry;
  g.add(b);
  puff(b, mat('hay'), 1.0, 0.42, 0.52, 0, 0.21, 0, 0.22, 0, 0, 0, 12, 8);
  for (const bx of [-0.25, 0.25]) bc(b, fab('#8a6a3a'), 0.03, 0.43, 0.53, bx, 0.21, 0);
  return b;
}

decor({
  id: 'hay_bale', name: 'Hay Bales', cat: 'garden', icon: '🌾', sound: 'soft',
  desc: 'Three golden straw bales — a farmyard seat with a view.',
  build(g) {
    bale(g, -0.32, 0, -0.25, 0.06);
    bale(g, 0.38, 0, 0.18, -0.25);
    bale(g, 0.02, 0.41, -0.05, 0.4);
    const hay = mat('hay');
    for (const [x, z, a] of [[-0.75, 0.15, 0.4], [0.9, -0.2, -0.6], [-0.2, 0.55, 1.2]]) {
      cone(g, hay, 0.02, 0.3, x, 0, z, 4, 0, a, 1.35);
      cone(g, hay, 0.02, 0.26, x + 0.05, 0, z + 0.04, 4, 0, a + 0.4, 1.45);
    }
  },
});

decor({
  id: 'woodpile', name: 'Woodpile', cat: 'garden', icon: '🪵', sound: 'wood',
  desc: 'Split logs stacked in a little lean-to rack, with a chopping block and axe.',
  build(g) {
    const tim = mat('timber');
    const zb = -0.55;
    for (const s of [-1, 1]) bxe(g, tim, -0.85, 0.85, -0.03, 0.08, zb + s * 0.24 - 0.04, zb + s * 0.24 + 0.04);
    for (const sx of [-1, 1]) {
      bxe(g, tim, sx * 0.82 - 0.04, sx * 0.82 + 0.04, -0.03, 1.38, zb + 0.22, zb + 0.3);
      bxe(g, tim, sx * 0.82 - 0.04, sx * 0.82 + 0.04, -0.03, 1.22, zb - 0.3, zb - 0.22);
    }
    bxe(g, tim, -0.9, 0.9, 1.3, 1.38, zb + 0.22, zb + 0.3);
    bxe(g, tim, -0.9, 0.9, 1.14, 1.22, zb - 0.3, zb - 0.22);
    bc(g, mat('roofShingle'), 1.95, 0.05, 0.86, 0, 1.33, zb, Math.atan2(-0.16, 0.6), 0, 0);
    const lr = 0.075, step = 0.165;
    for (let row = 0; row < 7; row++) {
      const y = 0.08 + lr + row * lr * 1.75;
      const off = row % 2 ? step / 2 : 0;
      for (let i = 0; i < 9; i++) {
        const x = -0.66 + off + i * step;
        if (x > 0.7) continue;
        log(g, x, y, zb + (i % 2 ? 0.02 : -0.01), 0.5, lr * (0.9 + ((i * 7 + row) % 3) * 0.06), PI / 2);
      }
    }
    // chopping block with an axe
    const sx = 0.45, sz = 0.45;
    cyl(g, mat('bark'), 0.21, 0.24, 0.4, sx, -0.03, sz, 9);
    add(g, capGeo(0.21, 9), mat('wood'), sx, 0.371, sz, -PI / 2, 0, 0);
    bc(g, mat('iron'), 0.16, 0.1, 0.03, sx - 0.02, 0.4, sz, 0, 0.3, 0);
    rod(g, mat('wood'), [sx - 0.02, 0.42, sz], [sx - 0.36, 0.78, sz + 0.12], 0.018, 0.022, 5);
    log(g, -0.3, 0.06, 0.45, 0.42, 0.07, 0.4);
    log(g, -0.1, 0.06, 0.6, 0.42, 0.07, -0.3);
  },
});

const WELL_RING = [[0.62, -0.04], [0.62, 0.66], [0.66, 0.68], [0.67, 0.74], [0.64, 0.78], [0.46, 0.78], [0.44, 0.74], [0.44, 0.0]];
decor({
  id: 'well', name: 'Wishing Well', cat: 'garden', icon: '🪣', sound: 'stone', levels: GROUND_LEVEL,
  desc: 'A fieldstone well with a little shingled roof, crank and bucket. Make a wish!',
  build(g) {
    const stone = mat('stone'), tim = mat('timber'), wood = mat('wood'), iron = mat('iron');
    add(g, latheGeo('wellring', WELL_RING, 16), stone, 0, 0, 0);
    cyl(g, mat('water'), 0.45, 0.45, 0.02, 0, 0.3, 0, 16);
    cyl(g, cer(COL.soot), 0.45, 0.45, 0.02, 0, 0.1, 0, 16);
    for (const sx of [-1, 1]) {
      bxe(g, tim, sx * 0.72 - 0.06, sx * 0.72 + 0.06, -0.04, 2.02, -0.06, 0.06);
      rod(g, tim, [sx * 0.7, 1.55, 0], [sx * 0.7, 1.95, sx * 0 + 0.35], 0.03);
      rod(g, tim, [sx * 0.7, 1.55, 0], [sx * 0.7, 1.95, -0.35], 0.03);
    }
    // crank & rope
    cylc(g, wood, 0.06, 0.06, 1.38, 0, 1.5, 0, 10, 0, 0, PI / 2);
    rod(g, iron, [0.79, 1.5, 0], [0.84, 1.36, 0.06], 0.018);
    rod(g, iron, [0.84, 1.36, 0.06], [0.95, 1.36, 0.06], 0.02);
    for (let i = 0; i < 3; i++) add(g, torusGeo(0.068, 0.014, 4, 10), fab('#c9a46a'), -0.08 + i * 0.03, 1.5, 0, 0, PI / 2, 0);
    rod(g, fab('#c9a46a'), [0, 1.45, 0.06], [0, 1.02, 0.06], 0.01, 0.01, 4);
    // bucket hanging inside
    const bk = latheGeo('bucket', [[0.001, 0], [0.11, 0], [0.135, 0.22], [0.12, 0.22], [0.1, 0.02], [0.001, 0.02]], 12);
    add(g, bk, wood, 0, 0.8, 0.06);
    for (const y of [0.84, 0.98]) cyl(g, iron, 0.125 + (y - 0.8) * 0.1, 0.12 + (y - 0.8) * 0.1, 0.02, 0, y, 0.06, 12);
    add(g, torusGeo(0.13, 0.008, 4, 10, PI), iron, 0, 1.02, 0.06, 0, PI / 2, 0);
    // shingled gable roof
    const rise = 0.42, half = 0.8, len = Math.hypot(rise, half), ang = Math.atan2(rise, half);
    for (const s of [-1, 1]) bc(g, mat('roofShingle'), 1.8, 0.05, len, 0, 2.02 + rise / 2 + 0.04, s * half / 2, s * ang, 0, 0);
    for (const sx of [-1, 1]) side(g, wood, [[-0.7, 2.02], [0.7, 2.02], [0, 2.02 + rise * 0.86]], 0.04, sx * 0.72);
    cylc(g, tim, 0.05, 0.05, 1.9, 0, 2.02 + rise + 0.05, 0, 8, 0, 0, PI / 2);
  },
});

// ---------------------------------------------------------------- mailbox, lamp post, birdhouse
decor({
  id: 'mailbox', name: 'Mailbox', cat: 'garden', icon: '📬', sound: 'metal', paintAlways: true, cacheExtra: variantKey,
  desc: 'A country mailbox on a post with its little flag up. Paint it!',
  build(g, p, o) {
    const post = mat('wood'), body = mat('paintedWood', p.c || COL.denim), flag = cer(COL.apple);
    bxe(g, post, -0.05, 0.05, -0.05, 1.0, -0.05, 0.05);
    bxe(g, post, -0.045, 0.045, 0.94, 1.0, -0.25, 0.25);
    rod(g, post, [0, 0.62, 0], [0, 0.94, 0.2], 0.022);
    bxe(g, body, -0.12, 0.12, 1.0, 1.14, -0.25, 0.25);
    cylc(g, body, 0.12, 0.12, 0.5, 0, 1.14, 0, 14, PI / 2, 0, 0);
    cylc(g, mat('paintedWood', tint(p.c || COL.denim, -0.2)), 0.125, 0.125, 0.02, 0, 1.14, 0.25, 14, PI / 2, 0, 0);
    bxe(g, mat('paintedWood', tint(p.c || COL.denim, -0.2)), -0.125, 0.125, 1.0, 1.14, 0.24, 0.26);
    ball(g, mat('iron'), 0.02, 0, 1.2, 0.27, 1, 1, 1, 6, 4);
    rod(g, flag, [0.13, 1.06, 0.1], [0.13, 1.36, 0.1], 0.01, 0.01, 4);
    bxe(g, flag, 0.125, 0.135, 1.25, 1.36, 0.1, 0.24);
    posy(g, 0.0, 0, 0.05, 0.3, 9, o.v);
  },
});

decor({
  id: 'lamp_post', name: 'Lamp Post', cat: 'garden', icon: '🏮', sound: 'metal',
  desc: 'A black iron lantern post that glows warmly at night.',
  build(g) {
    const iron = mat('iron'), glow = mat('lampGlow');
    cyl(g, iron, 0.17, 0.2, 0.1, 0, -0.04, 0, 8);
    cyl(g, iron, 0.09, 0.14, 0.3, 0, 0.06, 0, 8);
    cyl(g, iron, 0.045, 0.06, 2.0, 0, 0.36, 0, 8);
    for (const y of [0.4, 1.3]) cyl(g, iron, 0.07, 0.07, 0.05, 0, y, 0, 8);
    cyl(g, iron, 0.08, 0.05, 0.08, 0, 2.3, 0, 8);
    cyl(g, iron, 0.13, 0.13, 0.03, 0, 2.38, 0, 6);
    cyl(g, glow, 0.135, 0.1, 0.32, 0, 2.41, 0, 6);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      rod(g, iron, [Math.cos(a) * 0.1, 2.41, Math.sin(a) * 0.1], [Math.cos(a) * 0.138, 2.73, Math.sin(a) * 0.138], 0.008, 0.008, 3);
    }
    cyl(g, iron, 0.2, 0.2, 0.025, 0, 2.73, 0, 6);
    cone(g, iron, 0.2, 0.2, 0, 2.755, 0, 6);
    ball(g, iron, 0.04, 0, 2.98, 0, 1, 1, 1, 6, 4);
    // a little hook with a hanging flower basket
    rod(g, iron, [0, 1.9, 0], [0.38, 1.9, 0], 0.012, 0.012, 4);
    rod(g, iron, [0.38, 1.9, 0], [0.38, 1.72, 0], 0.006, 0.006, 3);
    add(g, latheGeo('hbasket', [[0.001, 0], [0.08, 0.01], [0.13, 0.07], [0.14, 0.12], [0.001, 0.11]], 10), mat('hay'), 0.38, 1.58, 0);
    posy(g, 0.38, 1.62, 0, 0.2, 6, 3);
  },
});

decor({
  id: 'birdhouse', name: 'Birdhouse', cat: 'garden', icon: '🐦', sound: 'wood', paintAlways: true,
  desc: 'A painted birdhouse on a pole, with a bluebird on the roof.',
  build(g, p) {
    const post = mat('wood'), body = mat('paintedWood', p.c || COL.mustard), roof = mat('paintedWood', COL.red);
    bxe(g, post, -0.04, 0.04, -0.05, 1.45, -0.04, 0.04);
    bxe(g, post, -0.17, 0.17, 1.42, 1.45, -0.17, 0.17);
    for (const [a, b] of [[[0, 1.2, 0], [0.14, 1.42, 0]], [[0, 1.2, 0], [-0.14, 1.42, 0]]]) rod(g, post, a, b, 0.015);
    bxe(g, body, -0.13, 0.13, 1.45, 1.7, -0.13, 0.13);
    poly(g, body, [[-0.13, 1.7], [0.13, 1.7], [0, 1.83]], 0.26, 0, 0, 0);
    const len = Math.hypot(0.16, 0.16);
    for (const s of [-1, 1]) bc(g, roof, len, 0.025, 0.34, s * 0.075, 1.775, 0, 0, 0, -s * PI / 4);
    cylc(g, cer(COL.soot), 0.038, 0.038, 0.01, 0, 1.61, 0.131, 12, PI / 2, 0, 0);
    rod(g, post, [0, 1.53, 0.13], [0, 1.53, 0.2], 0.008, 0.008, 4);
    // bluebird
    const blue = fab(COL.denim), breast = fab('#e39a5a');
    const bx = 0.02, by = 1.87, bz = 0.03;
    ball(g, blue, 0.05, bx, by, bz, 0.85, 0.85, 1.25, 8, 6);
    ball(g, breast, 0.036, bx, by - 0.012, bz + 0.03, 0.9, 0.9, 1, 7, 5);
    ball(g, blue, 0.034, bx, by + 0.04, bz + 0.05, 1, 1, 1, 7, 5);
    cone(g, mat('iron'), 0.01, 0.03, bx, by + 0.035, bz + 0.085, 4, PI / 2, 0, 0);
    bc(g, blue, 0.04, 0.012, 0.07, bx, by + 0.01, bz - 0.075, 0.4, 0, 0);
    posy(g, 0, 0, 0.05, 0.28, 7, 2);
  },
});

// ---------------------------------------------------------------- bench & picnic table
decor({
  id: 'bench', name: 'Garden Bench', cat: 'garden', icon: '🪑', sound: 'wood',
  mats: ['wood', 'paintedWood', 'timber'], matGroup: 'bench', paint: true,
  desc: 'A slatted garden bench for watching the sunset.',
  build(g, p) {
    const m = woodOf(p, COL.sage);
    const X = 0.76;
    for (const sx of [-1, 1]) {
      const x = sx * X;
      bxe(g, m, x - 0.035, x + 0.035, -0.03, 0.66, 0.17, 0.24);
      rod(g, m, [x, -0.03, -0.24], [x, 0.98, -0.36], 0.035, 0.03, 6);
      bxe(g, m, x - 0.04, x + 0.04, 0.64, 0.68, -0.3, 0.28);
      bxe(g, m, x - 0.03, x + 0.03, 0.34, 0.4, -0.28, 0.24);
      bxe(g, m, x - 0.025, x + 0.025, 0.1, 0.15, -0.26, 0.22);
    }
    for (let i = 0; i < 4; i++) bc(g, m, 2 * X + 0.06, 0.035, 0.1, 0, 0.42, -0.19 + i * 0.12);
    for (const y of [0.56, 0.71, 0.86]) bc(g, m, 2 * X + 0.06, 0.08, 0.025, 0, y, -0.24 - (y / 0.98) * 0.11, -0.11, 0, 0);
    puff(g, fab(COL.cream), 0.32, 0.3, 0.1, 0.45, 0.6, -0.15, 0.6, -0.2, -0.3, 0.1);
  },
});

decor({
  id: 'picnic_table', name: 'Picnic Table', cat: 'garden', icon: '🧺', sound: 'wood',
  mats: ['wood', 'timber'], matGroup: 'garden_wood',
  desc: 'A classic picnic table with a gingham cloth and a basket of goodies.',
  build(g, p) {
    const m = mat(p.m);
    for (let i = 0; i < 5; i++) bc(g, m, 1.8, 0.045, 0.145, 0, 0.76, -0.32 + i * 0.16);
    for (const s of [-1, 1]) for (const k of [0, 1]) bc(g, m, 1.8, 0.04, 0.13, 0, 0.45, s * (0.55 + k * 0.15));
    const L = Math.hypot(0.74, 0.55), ang = Math.atan2(0.55, 0.74);
    for (const sx of [-1, 1]) {
      const x = sx * 0.62;
      for (const s of [-1, 1]) bc(g, m, 0.07, L, 0.1, x, 0.37, s * 0.45, -s * ang, 0, 0);
      bc(g, m, 0.07, 0.08, 0.78, x, 0.7, 0);
      bc(g, m, 0.07, 0.06, 1.5, x, 0.4, 0);
    }
    // gingham cloth
    const red = fab(COL.red), white = fab(COL.pillow);
    bc(g, red, 1.0, 0.008, 0.84, 0, 0.787, 0);
    for (let i = 0; i < 6; i++) for (let j = 0; j < 5; j++) if ((i + j) % 2 === 0) bc(g, white, 1.0 / 6 - 0.004, 0.01, 0.84 / 5 - 0.004, -0.5 + (i + 0.5) / 6, 0.788, -0.42 + (j + 0.5) * 0.84 / 5);
    // basket & pie
    const hay = mat('hay');
    bxe(g, hay, -0.42, -0.08, 0.79, 0.97, -0.2, 0.06);
    bc(g, fab(COL.red), 0.36, 0.02, 0.15, -0.25, 0.975, -0.07, 0.2, 0.1, 0);
    add(g, torusGeo(0.16, 0.013, 4, 12, PI), mat('wood'), -0.25, 0.97, -0.07);
    cyl(g, cer(COL.pillow), 0.17, 0.15, 0.015, 0.3, 0.79, 0.05, 14);
    cyl(g, hay, 0.15, 0.14, 0.045, 0.3, 0.805, 0.05, 14);
    for (let i = 0; i < 3; i++) bc(g, mat('pumpkin'), 0.26, 0.008, 0.02, 0.3, 0.852, 0.0 + i * 0.05, 0, 0.4, 0);
  },
});

// ---------------------------------------------------------------- wheelbarrow
decor({
  id: 'wheelbarrow', name: 'Wheelbarrow', cat: 'garden', icon: '🛞', sound: 'wood', cacheExtra: variantKey,
  mats: ['paintedWood', 'wood'], matGroup: 'barrow', paint: true,
  desc: 'A trusty wheelbarrow, full of flowers, pumpkins or firewood.',
  build(g, p, o) {
    const m = woodOf(p, COL.red), wood = mat('wood'), iron = mat('iron');
    const y0 = 0.32;
    const sideP = [[-0.38, y0], [0.3, y0], [0.48, y0 + 0.26], [-0.44, y0 + 0.26]];
    for (const sx of [-1, 1]) side(g, m, sideP, 0.03, sx * 0.27);
    bxe(g, m, -0.27, 0.27, y0 - 0.02, y0 + 0.01, -0.38, 0.3);
    bc(g, m, 0.57, 0.03, 0.32, 0, y0 + 0.13, 0.39, Math.atan2(0.18, 0.26) + PI / 2, 0, 0);
    bxe(g, m, -0.285, 0.285, y0, y0 + 0.26, -0.45, -0.42);
    // frame, legs, handles
    for (const sx of [-1, 1]) {
      rod(g, wood, [sx * 0.08, 0.2, 0.62], [sx * 0.24, 0.3, -0.4], 0.025);
      rod(g, wood, [sx * 0.24, 0.3, -0.4], [sx * 0.3, 0.55, -0.95], 0.025);
      rod(g, wood, [sx * 0.3, 0.55, -0.95], [sx * 0.31, 0.58, -1.08], 0.032);
      rod(g, wood, [sx * 0.23, 0.31, -0.3], [sx * 0.25, 0, -0.36], 0.025);
    }
    // wheel
    const wz = 0.62, wy = 0.2;
    add(g, torusGeo(0.165, 0.04, 6, 18), iron, 0, wy, wz, 0, PI / 2, 0);
    cylc(g, iron, 0.04, 0.04, 0.2, 0, wy, wz, 8, 0, 0, PI / 2);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * PI;
      rod(g, wood, [0, wy + Math.sin(a) * 0.16, wz + Math.cos(a) * 0.16], [0, wy - Math.sin(a) * 0.16, wz - Math.cos(a) * 0.16], 0.013, 0.013, 4);
    }
    // load
    const ly = y0 + 0.2;
    if (o.v % 2 === 0) {
      bxe(g, mat('dirt'), -0.25, 0.25, y0, ly, -0.4, 0.36);
      posy(g, -0.02, ly - 0.05, -0.15, 0.3, 7, o.v);
      posy(g, 0.03, ly - 0.05, 0.18, 0.26, 6, o.v + 1);
    } else if (o.v === 1) {
      add(g, pumpkinGeo(0.17), mat('pumpkin'), -0.05, ly + 0.08, -0.18, 0, 0.3, 0.1);
      add(g, pumpkinGeo(0.14), mat('pumpkin'), 0.08, ly + 0.05, 0.18, 0, 1.1, -0.1);
    } else {
      for (let i = 0; i < 6; i++) log(g, -0.13 + (i % 3) * 0.13, y0 + 0.08 + Math.floor(i / 3) * 0.12, -0.04, 0.55, 0.06, PI / 2 + (i % 2 ? 0.05 : -0.05));
    }
  },
});

// ---------------------------------------------------------------- chickens
function hen(g, x, z, ry, pose, colour) {
  const h = new THREE.Group();
  h.position.set(x, 0, z);
  h.rotation.y = ry;
  g.add(h);
  const body = fab(colour), wing = body, red = fab('#d23b2e'), beak = mat('pumpkin'), eye = cer(COL.charcoal);
  const sit = pose === 'sit';
  const by = sit ? 0.15 : 0.3;
  const tilt = pose === 'peck' ? 0.45 : 0;
  const b = new THREE.Group();
  b.position.set(0, by, 0);
  b.rotation.x = tilt;
  h.add(b);
  ball(b, body, 0.16, 0, 0, 0, 0.82, 0.85, 1.15, 9, 6);
  ball(b, body, 0.1, 0, 0.07, 0.11, 0.9, 1, 0.9, 7, 5);
  cone(b, body, 0.085, 0.2, 0, 0.02, -0.15, 6, -0.75, 0, 0);
  for (const s of [-1, 1]) ball(b, wing, 0.1, s * 0.115, 0.0, -0.02, 0.35, 0.7, 1.15, 6, 4, 0.15, 0, 0);
  const hy = pose === 'peck' ? 0.1 : 0.22, hz = pose === 'peck' ? 0.24 : 0.16;
  ball(b, body, 0.075, 0, hy, hz, 0.9, 1, 1, 7, 5);
  ball(b, red, 0.045, 0, hy + 0.075, hz - 0.005, 0.3, 0.8, 1.1, 5, 4);
  ball(b, red, 0.022, 0, hy - 0.06, hz + 0.06, 0.7, 1.2, 0.8, 6, 4);
  cone(b, beak, 0.02, 0.055, 0, hy - 0.01, hz + 0.06, 5, PI / 2, 0, 0);
  for (const s of [-1, 1]) ball(b, eye, 0.011, s * 0.058, hy + 0.02, hz + 0.03, 1, 1, 1, 5, 4);
  if (!sit) {
    for (const s of [-1, 1]) {
      rod(h, beak, [s * 0.05, 0.2, 0.0], [s * 0.06, 0.01, 0.02], 0.012, 0.01, 4);
      bc(h, beak, 0.05, 0.012, 0.07, s * 0.06, 0.006, 0.04);
    }
  }
  return h;
}

decor({
  id: 'chickens', name: 'Chickens', cat: 'garden', icon: '🐔', sound: 'soft', levels: GROUND_LEVEL, cacheExtra: variantKey,
  desc: 'Three happy hens pecking about the yard.',
  build(g, p, o) {
    const r = rng(o.v + 90);
    const cols = ['#f6efe0', '#b5703c', '#4a403b'];
    const poses = ['stand', 'peck', 'sit'];
    const spots = [[-0.45, -0.25], [0.4, 0.15], [-0.05, 0.55]];
    spots.forEach(([x, z], i) => hen(g, x, z, r() * TAU, poses[(i + o.v) % 3], cols[(i + o.v) % 3]));
    const grain = mat('hay');
    for (let i = 0; i < 14; i++) bc(g, grain, 0.025, 0.01, 0.015, (r() - 0.5) * 1.2, 0.005, (r() - 0.5) * 1.2, 0, r() * 3, 0);
  },
});

// ---------------------------------------------------------------- beehive (straw skep)
const SKEP = (() => {
  const pts = [];
  const n = 26, coils = 7;
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    const r = 0.3 * Math.sqrt(Math.max(0, 1 - t * t * 0.97)) + 0.016 * Math.cos(TAU * coils * t);
    pts.push([Math.max(0.001, r), 0.52 * Math.pow(t, 0.9)]);
  }
  pts[pts.length - 1][0] = 0.001;
  return pts;
})();

decor({
  id: 'beehive', name: 'Beehive', cat: 'garden', icon: '🐝', sound: 'soft',
  desc: 'A coiled straw bee skep on a little stand, buzzing with bees.',
  build(g) {
    const wood = mat('wood');
    bxe(g, wood, -0.36, 0.36, 0.42, 0.47, -0.3, 0.3);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) bxe(g, wood, sx * 0.3 - 0.03, sx * 0.3 + 0.03, -0.04, 0.42, sz * 0.24 - 0.03, sz * 0.24 + 0.03);
    add(g, latheGeo('skep', SKEP, 14), mat('hay'), 0, 0.47, 0);
    bxe(g, cer(COL.soot), -0.06, 0.06, 0.47, 0.53, 0.25, 0.3);
    const bee = mat('petalYellow'), stripe = cer(COL.charcoal), wing = cer(COL.pillow);
    for (const [x, y, z, a] of [[0.12, 0.62, 0.42, 0.4], [-0.18, 0.78, 0.36, -0.8], [0.3, 0.9, 0.18, 1.8]]) {
      ball(g, bee, 0.024, x, y, z, 1, 0.9, 1.4, 6, 4, 0, a, 0);
      ball(g, stripe, 0.0245, x, y, z, 1.02, 0.92, 0.3, 6, 4, 0, a, 0);
      for (const s of [-1, 1]) ball(g, wing, 0.018, x + s * 0.02 * Math.cos(a), y + 0.022, z - s * 0.02 * Math.sin(a), 1, 0.25, 0.6, 5, 3, 0, a, s * 0.4);
    }
    posy(g, -0.5, 0, 0.45, 0.3, 8, 5);
  },
});

// ---------------------------------------------------------------- scarecrow
decor({
  id: 'scarecrow', name: 'Scarecrow', cat: 'garden', icon: '🧑‍🌾', sound: 'soft', paintAlways: true, levels: GROUND_LEVEL,
  desc: 'A friendly straw-stuffed scarecrow in a patched shirt (with a crow who isn’t scared at all).',
  build(g, p) {
    const wood = mat('wood'), hay = mat('hay');
    const shirt = fab(p.c || COL.red), denim = fab(COL.denim), sack = fab('#d9c19a'), dark = cer(COL.charcoal);
    bxe(g, wood, -0.04, 0.04, -0.05, 1.86, -0.12, -0.04);
    bxe(g, wood, -0.62, 0.62, 1.42, 1.48, -0.12, -0.06);
    puff(g, shirt, 0.42, 0.52, 0.24, 0, 1.24, 0, 0.5);
    bc(g, fab(COL.cream), 0.1, 0.1, 0.01, -0.08, 1.18, 0.12, 0, 0, 0.2);
    bc(g, denim, 0.08, 0.08, 0.01, 0.1, 1.33, 0.115, 0, 0, -0.3);
    for (const s of [-1, 1]) {
      cylc(g, shirt, 0.07, 0.085, 0.46, s * 0.4, 1.44, -0.02, 8, 0, 0, PI / 2);
      for (let k = 0; k < 4; k++) cone(g, hay, 0.025, 0.14, s * 0.66, 1.42, -0.02 + (k - 1.5) * 0.025, 4, (k - 1.5) * 0.3, 0, -s * (PI / 2 + 0.3));
      cylc(g, denim, 0.075, 0.07, 0.56, s * 0.1, 0.78, 0, 8, 0, 0, s * 0.06);
      for (let k = 0; k < 3; k++) cone(g, hay, 0.025, 0.14, s * 0.12 + (k - 1) * 0.025, 0.38, 0, 4, PI + (k - 1) * 0.3, 0, 0);
    }
    puff(g, denim, 0.4, 0.14, 0.24, 0, 1.03, 0, 0.5);
    // head
    ball(g, sack, 0.16, 0, 1.68, 0, 1, 1.05, 0.95, 10, 8);
    for (const s of [-1, 1]) ball(g, dark, 0.022, s * 0.055, 1.71, 0.14, 1, 1, 0.6, 6, 4);
    cone(g, mat('pumpkin'), 0.025, 0.09, 0, 1.635, 0.16, 5, PI / 2, 0, 0);
    for (let k = 0; k < 5; k++) {
      const a = -0.6 + k * 0.3;
      bc(g, dark, 0.018, 0.008, 0.01, Math.sin(a) * 0.08, 1.6 - Math.cos(a) * 0.025 + 0.01, 0.142 - Math.abs(a) * 0.02, 0, -a * 0.6, a);
    }
    // straw hat & hair
    cyl(g, hay, 0.28, 0.28, 0.025, 0, 1.79, 0, 14);
    cyl(g, hay, 0.12, 0.15, 0.16, 0, 1.81, 0, 12);
    cyl(g, shirt, 0.152, 0.152, 0.035, 0, 1.815, 0, 12);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * TAU + 0.2;
      if (Math.sin(a) > 0.6) continue;
      cone(g, hay, 0.03, 0.16, Math.cos(a) * 0.15, 1.66, Math.sin(a) * 0.15, 4, Math.sin(a) * 2.6, 0, -Math.cos(a) * 2.6);
    }
    // the crow
    const cx = -0.48, cy = 1.49, cz = -0.09;
    ball(g, dark, 0.06, cx, cy + 0.06, cz, 0.8, 0.85, 1.3, 8, 6);
    ball(g, dark, 0.04, cx, cy + 0.12, cz + 0.06, 1, 1, 1, 7, 5);
    cone(g, mat('pumpkin'), 0.012, 0.045, cx, cy + 0.115, cz + 0.1, 4, PI / 2, 0, 0);
    bc(g, dark, 0.05, 0.012, 0.09, cx, cy + 0.06, cz - 0.09, 0.4, 0, 0);
  },
});

// ====================================================================== MORE COZY THINGS (interior)

// ---------------------------------------------------------------- nightstand (snuggles up to a bed beside it)
decor({
  id: 'nightstand', name: 'Nightstand', cat: 'interior', icon: '🕯️', sound: 'wood',
  mats: FURN, matGroup: 'furniture', paint: true, cacheExtra: variantKey,
  desc: 'A bedside table with a little lamp. Put it next to a bed and it slides up close.',
  nb: (p, ctx) => (BEDS.has(nbI(p, ctx, 1, 0)?.t) ? 'r' : BEDS.has(nbI(p, ctx, -1, 0)?.t) ? 'l' : ''),
  build(g, p, o) {
    const m = woodOf(p, COL.cream);
    const cx = o.nb === 'r' ? 0.72 : o.nb === 'l' ? -0.72 : 0;
    const W = 0.46, D = 0.4, H = 0.62, z0 = BACK, z1 = BACK + D, zc = (z0 + z1) / 2;
    const x0 = cx - W / 2, x1 = cx + W / 2;
    for (const sx of [x0, x1 - 0.035]) bxe(g, m, sx, sx + 0.035, 0, H - 0.03, z0, z1);
    bxe(g, m, x0 + 0.03, x1 - 0.03, 0.04, H - 0.03, z0, z0 + 0.02);
    bxe(g, m, x0 + 0.03, x1 - 0.03, 0.06, 0.09, z0, z1 - 0.01);
    bxe(g, m, x0 + 0.03, x1 - 0.03, H - 0.22, H - 0.03, z0 + 0.02, z1 - 0.01);
    bxe(g, m, x0 - 0.015, x1 + 0.015, H - 0.03, H, z0, z1 + 0.02);
    bxe(g, m, x0 + 0.05, x1 - 0.05, H - 0.2, H - 0.06, z1 - 0.01, z1 + 0.012);
    ball(g, cer(COL.pillow), 0.02, cx, H - 0.13, z1 + 0.03, 1, 1, 1, 6, 4);
    bookStack(g, cx, 0.09, zc + 0.02, 2, o.v + 2, 0.1);
    tableLamp(g, cx + 0.07, H, zc - 0.03);
    if (o.v % 2) { cup(g, cx - 0.12, H, zc + 0.08, COL.cream); }
    else bookStack(g, cx - 0.1, H, zc + 0.06, 1, o.v, 0.5);
  },
});

// ---------------------------------------------------------------- wardrobe
decor({
  id: 'wardrobe', name: 'Wardrobe', cat: 'interior', icon: '🚪', sound: 'wood',
  mats: FURN, matGroup: 'furniture', paint: true,
  desc: 'A tall two-door wardrobe with a suitcase and a hatbox on top.',
  build(g, p) {
    const m = woodOf(p, COL.cream);
    const W = 1.3, D = 0.6, H = 2.02, z0 = BACK, z1 = BACK + D;
    for (const sx of [-1, 1]) for (const z of [z0 + 0.08, z1 - 0.08]) ball(g, m, 0.065, sx * (W / 2 - 0.09), 0.06, z, 1, 1, 1, 8, 5);
    bxe(g, m, -W / 2 + 0.02, W / 2 - 0.02, 0.1, H - 0.08, z0, z1 - 0.02);
    bxe(g, m, -W / 2, W / 2, 0.1, 0.18, z0, z1 + 0.01);
    bxe(g, m, -W / 2 - 0.02, W / 2 + 0.02, H - 0.1, H - 0.04, z0, z1 + 0.03);
    bxe(g, m, -W / 2 - 0.05, W / 2 + 0.05, H - 0.04, H, z0, z1 + 0.06);
    for (const sx of [-1, 1]) {
      const a = sx < 0 ? -W / 2 + 0.05 : 0.008, b = sx < 0 ? -0.008 : W / 2 - 0.05;
      bxe(g, m, a, b, 0.22, H - 0.14, z1 - 0.02, z1 + 0.005);
      for (const [y0, y1] of [[0.3, 0.95], [1.05, H - 0.24]]) bxe(g, m, a + 0.07, b - 0.07, y0, y1, z1 + 0.005, z1 + 0.02);
      ball(g, cer(COL.pillow), 0.025, sx * 0.05, 1.0, z1 + 0.03, 1, 1, 1, 6, 4);
    }
    // suitcase & hatbox
    const zc = (z0 + z1) / 2;
    bxe(g, fab('#8a5a3a'), -0.5, 0.08, H, H + 0.2, zc - 0.2, zc + 0.18);
    for (const x of [-0.36, -0.06]) bxe(g, fab(COL.cream), x - 0.02, x + 0.02, H - 0.005, H + 0.205, zc - 0.205, zc + 0.185);
    cyl(g, fab(COL.teal), 0.17, 0.17, 0.2, 0.32, H, zc, 14);
    cyl(g, fab(COL.pink), 0.178, 0.178, 0.05, 0.32, H + 0.17, zc, 14);
  },
});

// ---------------------------------------------------------------- writing desk (with its own chair)
decor({
  id: 'desk', name: 'Writing Desk', cat: 'interior', icon: '✒️', sound: 'wood',
  mats: FURN, matGroup: 'furniture', paint: true, cacheExtra: variantKey,
  desc: 'A little writing desk with drawers, a lamp, books — and a chair pulled up to it.',
  build(g, p, o) {
    const m = woodOf(p);
    const W = 1.3, D = 0.62, TY = 0.76, z0 = BACK, z1 = BACK + D, zc = (z0 + z1) / 2;
    bxe(g, m, -W / 2, W / 2, TY - 0.04, TY, z0, z1 + 0.02);
    // drawer pedestal (right) & legs (left)
    const px0 = W / 2 - 0.44, px1 = W / 2 - 0.02;
    bxe(g, m, px0, px1, 0.04, TY - 0.04, z0 + 0.02, z1 - 0.02);
    for (let i = 0; i < 3; i++) {
      const y0 = 0.07 + i * 0.21, y1 = y0 + 0.19;
      bxe(g, m, px0 + 0.025, px1 - 0.025, y0, y1, z1 - 0.02, z1 + 0.008);
      ball(g, mat('iron'), 0.018, (px0 + px1) / 2, (y0 + y1) / 2, z1 + 0.025, 1, 1, 1, 6, 4);
    }
    for (const z of [z0 + 0.05, z1 - 0.05]) cyl(g, m, 0.03, 0.022, TY - 0.04, -W / 2 + 0.06, 0, z, 7);
    bxe(g, m, -W / 2 + 0.04, px0, TY - 0.16, TY - 0.04, z0 + 0.02, z0 + 0.04);
    bxe(g, m, -W / 2 + 0.04, px0, TY - 0.13, TY - 0.04, z1 - 0.04, z1 - 0.02);
    // on the desk: lamp, books, open book, ink & quill
    tableLamp(g, -W / 2 + 0.16, TY, z0 + 0.16, COL.sage);
    bookStack(g, W / 2 - 0.2, TY, z0 + 0.16, 3, o.v + 1, 0.15);
    const pg = cer(COL.paper);
    bc(g, pg, 0.17, 0.012, 0.24, -0.08, TY + 0.012, zc + 0.05, 0, 0.1, 0.08);
    bc(g, pg, 0.17, 0.012, 0.24, 0.085, TY + 0.012, zc + 0.065, 0, 0.1, -0.08);
    cyl(g, cer(COL.navy), 0.03, 0.035, 0.05, 0.25, TY, zc - 0.05, 8);
    rod(g, pg, [0.25, TY + 0.04, zc - 0.05], [0.31, TY + 0.25, zc - 0.1], 0.004, 0.018, 4);
    // the chair, facing the desk
    const ch = new THREE.Group();
    ch.position.set(0.0, 0, -0.08);
    ch.rotation.y = PI;
    g.add(ch);
    ladderChair(ch, m, 0);
  },
});

// ---------------------------------------------------------------- kitchen range (with half counters each side)
function halfCounters(g, p) {
  const cm = woodOf(p, COL.sage), top = mat(p.m === 'wood' ? 'timber' : 'wood'), pull = mat('iron');
  const Z0 = BACK - 0.02, Z1 = BACK + 0.6, TOP = 0.9;
  for (const s of [-1, 1]) {
    const a = s < 0 ? -1 : 0.52, b = s < 0 ? -0.52 : 1;
    bxe(g, mat('timber'), a, b, 0, 0.1, Z0, Z1 - 0.06);
    bxe(g, cm, a, b, 0.1, TOP - 0.05, Z0, Z1 - 0.02);
    bxe(g, cm, a + 0.02, b - 0.02, 0.66, 0.82, Z1 - 0.02, Z1 + 0.005);
    bc(g, pull, 0.12, 0.018, 0.02, (a + b) / 2, 0.74, Z1 + 0.018);
    bxe(g, cm, a + 0.02, b - 0.02, 0.13, 0.63, Z1 - 0.02, Z1);
    bxe(g, cm, a + 0.08, b - 0.08, 0.19, 0.57, Z1, Z1 + 0.012);
    bc(g, pull, 0.016, 0.1, 0.02, s < 0 ? b - 0.08 : a + 0.08, 0.51, Z1 + 0.02);
    bxe(g, top, a, b, TOP - 0.05, TOP, Z0, Z1 + 0.03);
  }
  return { TOP, Z0, Z1 };
}

decor({
  id: 'kitchen_range', name: 'Cook Stove', cat: 'interior', icon: '🍲', sound: 'metal',
  mats: ['paintedWood', 'wood', 'timber'], matGroup: 'kitchen', paint: true,
  desc: 'A cream enamel cook stove with a warming shelf, a soup pot and a kettle — counters either side.',
  build(g, p) {
    const { TOP, Z0, Z1 } = halfCounters(g, p);
    const en = cer(COL.cream), iron = mat('iron');
    const a = -0.5, b = 0.5;
    bxe(g, iron, a + 0.02, b - 0.02, 0, 0.1, Z0, Z1 - 0.04);
    bxe(g, en, a, b, 0.1, TOP - 0.04, Z0, Z1);
    bxe(g, iron, a - 0.01, b + 0.01, TOP - 0.04, TOP, Z0, Z1 + 0.02);
    for (const s of [-1, 1]) {
      const d0 = s < 0 ? a + 0.05 : 0.02, d1 = s < 0 ? -0.02 : b - 0.05;
      bxe(g, iron, d0, d1, 0.2, 0.66, Z1, Z1 + 0.012);
      bxe(g, en, d0 + 0.03, d1 - 0.03, 0.23, 0.63, Z1 + 0.012, Z1 + 0.02);
      bc(g, iron, (d1 - d0) * 0.6, 0.02, 0.03, (d0 + d1) / 2, 0.58, Z1 + 0.035);
    }
    rod(g, iron, [a + 0.03, 0.75, Z1 + 0.05], [b - 0.03, 0.75, Z1 + 0.05], 0.012, 0.012, 5);
    bc(g, fab(COL.red), 0.2, 0.22, 0.012, -0.2, 0.66, Z1 + 0.058);
    for (const s of [-1, 1]) add(g, torusGeo(0.11, 0.015, 4, 14), iron, s * 0.24, TOP + 0.005, (Z0 + Z1) / 2 + 0.05, PI / 2, 0, 0);
    // warming shelf on iron posts
    for (const s of [-1, 1]) bxe(g, iron, s * 0.47 - 0.02, s * 0.47 + 0.02, TOP, 1.5, Z0 + 0.02, Z0 + 0.06);
    bxe(g, en, a, b, 1.26, 1.46, Z0, Z0 + 0.26);
    bxe(g, iron, a - 0.02, b + 0.02, 1.46, 1.49, Z0, Z0 + 0.28);
    bxe(g, iron, a + 0.04, b - 0.04, 1.3, 1.42, Z0 + 0.26, Z0 + 0.27);
    // soup pot & kettle
    const pot = cer(COL.teal);
    cyl(g, pot, 0.13, 0.12, 0.18, -0.24, TOP, (Z0 + Z1) / 2 + 0.05, 14);
    cyl(g, pot, 0.135, 0.135, 0.015, -0.24, TOP + 0.18, (Z0 + Z1) / 2 + 0.05, 14);
    ball(g, iron, 0.02, -0.24, TOP + 0.205, (Z0 + Z1) / 2 + 0.05, 1, 1, 1, 6, 4);
    teapot(g, 0.24, TOP, (Z0 + Z1) / 2 + 0.05, COL.red);
    for (let i = 0; i < 3; i++) cyl(g, cer(['#d9a441', '#b4473a', '#9cae6b'][i]), 0.045, 0.045, 0.12, -0.3 + i * 0.3, 1.49, Z0 + 0.13, 10);
  },
});

// ---------------------------------------------------------------- washstand (old-fashioned bathroom)
const BASIN = [[0.001, 0], [0.09, 0], [0.11, 0.02], [0.2, 0.08], [0.22, 0.11], [0.205, 0.115], [0.18, 0.09], [0.001, 0.03]];
const PITCHER = [[0.001, 0], [0.07, 0], [0.09, 0.06], [0.09, 0.14], [0.06, 0.22], [0.055, 0.27], [0.075, 0.31], [0.068, 0.315], [0.001, 0.26]];
decor({
  id: 'washstand', name: 'Washstand', cat: 'interior', icon: '🧼', sound: 'wood',
  mats: FURN, matGroup: 'furniture', paint: true,
  desc: 'A washstand with a china basin and jug, a mirror and a fluffy towel.',
  build(g, p) {
    const m = woodOf(p, COL.cream);
    const W = 0.95, D = 0.5, TY = 0.8, z0 = BACK, z1 = BACK + D, zc = (z0 + z1) / 2;
    for (const sx of [-1, 1]) for (const z of [z0 + 0.04, z1 - 0.04]) cyl(g, m, 0.028, 0.022, TY - 0.03, sx * (W / 2 - 0.05), 0, z, 7);
    bxe(g, m, -W / 2 + 0.04, W / 2 - 0.04, 0.18, 0.21, z0 + 0.02, z1 - 0.02);
    bxe(g, m, -W / 2 + 0.03, W / 2 - 0.03, TY - 0.15, TY - 0.03, z0 + 0.02, z1 - 0.02);
    bxe(g, m, -W / 2, W / 2, TY - 0.03, TY, z0, z1 + 0.02);
    bxe(g, m, -W / 2, W / 2, TY, TY + 0.12, z0, z0 + 0.03);
    // mirror on the splashback
    bxe(g, m, -0.26, 0.26, TY + 0.1, TY + 0.82, z0, z0 + 0.025);
    bxe(g, cer(COL.mirror), -0.21, 0.21, TY + 0.15, TY + 0.77, z0 + 0.025, z0 + 0.032);
    const white = cer(COL.pillow), blue = cer(COL.denim);
    add(g, latheGeo('basin', BASIN, 16), white, -0.05, TY, zc + 0.02);
    add(g, latheGeo('pitcher', PITCHER, 12), white, -0.04, TY + 0.03, zc + 0.02);
    add(g, torusGeo(0.06, 0.012, 4, 10, PI), white, -0.12, TY + 0.2, zc + 0.02, 0, 0, PI / 2);
    for (const y of [TY + 0.12, TY + 0.25]) add(g, torusGeo(0.07, 0.006, 3, 14), blue, -0.04, y, zc + 0.02, PI / 2, 0, 0);
    bc(g, cer('#e7b7c8'), 0.08, 0.035, 0.05, 0.3, TY + 0.018, zc + 0.05);
    // towel on a side rail
    rod(g, m, [W / 2 + 0.02, TY - 0.08, z0 + 0.08], [W / 2 + 0.02, TY - 0.08, z1 - 0.08], 0.015);
    const towel = fab(COL.teal);
    bc(g, towel, 0.04, 0.02, 0.3, W / 2 + 0.02, TY - 0.06, zc, 0, 0, 0);
    for (const s of [-1, 1]) bc(g, towel, 0.012, 0.36, 0.3, W / 2 + 0.02 + s * 0.022, TY - 0.24, zc, 0, 0, 0);
  },
});

// ---------------------------------------------------------------- grandfather clock
decor({
  id: 'grandfather_clock', name: 'Grandfather Clock', cat: 'interior', icon: '🕰️', sound: 'wood',
  mats: ['timber', 'wood', 'paintedWood'], matGroup: 'clock', paint: true,
  desc: 'A tall tick-tocking longcase clock with a brass pendulum.',
  build(g, p) {
    const m = woodOf(p, COL.sage), z0 = BACK, brass = mat('petalYellow'), iron = mat('iron');
    bxe(g, m, -0.27, 0.27, 0, 0.08, z0, z0 + 0.38);
    bxe(g, m, -0.25, 0.25, 0.08, 0.55, z0, z0 + 0.36);
    bxe(g, m, -0.27, 0.27, 0.55, 0.6, z0, z0 + 0.38);
    bxe(g, m, -0.2, 0.2, 0.6, 1.5, z0, z0 + 0.32);
    bxe(g, cer(COL.soot), -0.12, 0.12, 0.72, 1.4, z0 + 0.32, z0 + 0.33);
    rod(g, brass, [0, 1.38, z0 + 0.335], [0, 0.92, z0 + 0.335], 0.006, 0.006, 4);
    cylc(g, brass, 0.06, 0.06, 0.02, 0, 0.9, z0 + 0.34, 12, PI / 2, 0, 0);
    bxe(g, m, -0.25, 0.25, 1.5, 1.55, z0, z0 + 0.38);
    bxe(g, m, -0.24, 0.24, 1.55, 2.02, z0, z0 + 0.36);
    poly(g, m, archPanel(0.52, 0, 0.0, 0.16, 8), 0.38, 0, 2.02, z0 + 0.19);
    for (const sx of [-1, 0, 1]) ball(g, brass, 0.035, sx * 0.22, sx ? 2.06 : 2.22, z0 + 0.19, 1, 1.2, 1, 6, 4);
    cylc(g, cer(COL.paper), 0.17, 0.17, 0.02, 0, 1.79, z0 + 0.365, 18, PI / 2, 0, 0);
    add(g, torusGeo(0.175, 0.012, 4, 18), brass, 0, 1.79, z0 + 0.375);
    bc(g, iron, 0.012, 0.12, 0.008, 0.0, 1.83, z0 + 0.38, 0, 0, 0.5);
    bc(g, iron, 0.012, 0.09, 0.008, 0.02, 1.775, z0 + 0.382, 0, 0, -1.9);
  },
});

// ====================================================================== MORE GARDEN

// ---------------------------------------------------------------- fire pit (smokes)
decor({
  id: 'fire_pit', name: 'Fire Pit', cat: 'garden', icon: '🔥', sound: 'stone', levels: GROUND_LEVEL,
  // a thin wisp that starts above head height, so whoever sits round the fire stays in view (Living Town feel check)
  emitter: 'smoke', emitterOffset: [0, 1.0, 0], smokeAlpha: 0.45,
  desc: 'A ring of stones round a crackling campfire, with log seats for toasting marshmallows.',
  build(g) {
    const stone = mat('path'), ember = mat('ember'), glow = mat('lampGlow');
    for (let i = 0; i < 11; i++) {
      const a = (i / 11) * TAU;
      blob(g, stone, 0.13, Math.cos(a) * 0.45, 0.05, Math.sin(a) * 0.45, i, 0.7, 0.18, 8, 5);
    }
    cyl(g, mat('dirt'), 0.4, 0.42, 0.03, 0, -0.01, 0, 14);
    cyl(g, ember, 0.26, 0.3, 0.03, 0, 0.01, 0, 12);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU + 0.3;
      rod(g, mat('bark'), [Math.cos(a) * 0.3, 0.02, Math.sin(a) * 0.3], [Math.cos(a) * 0.03, 0.42, Math.sin(a) * 0.03], 0.04, 0.03, 6);
    }
    cone(g, ember, 0.17, 0.42, 0, 0.03, 0, 7);
    cone(g, ember, 0.1, 0.3, 0.09, 0.03, 0.06, 6, 0.1, 0, -0.2);
    cone(g, ember, 0.09, 0.28, -0.08, 0.03, -0.05, 6, -0.1, 0, 0.2);
    cone(g, glow, 0.09, 0.26, 0, 0.04, 0.02, 6);
    // log seats
    log(g, 0, 0.13, -0.85, 1.1, 0.13, 0);
    log(g, 0.85, 0.13, 0.05, 1.0, 0.13, PI / 2 + 0.15);
    // marshmallow stick
    rod(g, mat('wood'), [-0.65, 0.02, 0.6], [-0.2, 0.42, 0.18], 0.008, 0.008, 3);
    ball(g, cer(COL.pillow), 0.025, -0.2, 0.43, 0.18, 1, 1.2, 1, 6, 4);
  },
});

// ---------------------------------------------------------------- pond (with a duck)
decor({
  id: 'pond', name: 'Lily Pond', cat: 'garden', icon: '🦆', sound: 'stone', levels: GROUND_LEVEL, cacheExtra: variantKey,
  desc: 'A little pond with lily pads, cattails, mossy stones — and a duck.',
  build(g, p, o) {
    const n = 16, pts = [], inner = [];
    const ph = o.v * 1.3;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      const r = 0.74 * (1 + 0.1 * Math.sin(3 * a + ph) + 0.06 * Math.cos(5 * a + ph * 0.7));
      pts.push([Math.cos(a) * r, Math.sin(a) * r]);
      inner.push([Math.cos(a) * r * 0.97, Math.sin(a) * r * 0.97]);
    }
    const flat = (m, outline, y, d) => add(g, prismGeo(outline.map(([x, z]) => [x, -z]), d), m, 0, y, 0, -PI / 2, 0, 0);
    flat(cer('#2f4a46'), inner, 0.006, 0.012);
    flat(mat('water'), pts, 0.03, 0.012);
    const stone = mat('path');
    pts.forEach(([x, z], i) => {
      const k = 1.07 + (i % 3) * 0.03;
      blob(g, stone, 0.1 + (i % 4) * 0.025, x * k, 0.03, z * k, i + o.v, 0.6, 0.18, 7, 5);
    });
    const leaves = mat('leaves');
    for (const [x, z, r] of [[-0.3, 0.15, 0.12], [-0.15, 0.32, 0.1], [0.25, -0.3, 0.13], [0.38, -0.08, 0.09]]) cyl(g, leaves, r, r, 0.012, x, 0.035, z, 9);
    for (const [x, z] of [[-0.3, 0.15], [0.25, -0.3]]) ball(g, mat('petalPink'), 0.045, x + 0.02, 0.07, z, 1, 0.8, 1, 6, 4);
    // cattails on one side
    for (let i = 0; i < 6; i++) {
      const x = -0.6 + (i % 3) * 0.1, z = -0.45 + Math.floor(i / 3) * 0.12 + (i % 2) * 0.04;
      const h = 0.55 + (i % 3) * 0.15;
      rod(g, leaves, [x, 0, z], [x + 0.03, h, z - 0.02], 0.01, 0.006, 3);
      if (i % 2 === 0) cylc(g, mat('bark'), 0.022, 0.022, 0.12, x + 0.028, h - 0.1, z - 0.018, 6);
    }
    // the duck
    const dx = 0.12, dz = 0.12, white = fab(COL.pillow);
    ball(g, white, 0.11, dx, 0.08, dz, 0.75, 0.6, 1.15, 8, 6, 0, 0.6, 0);
    ball(g, white, 0.055, dx + 0.07, 0.17, dz + 0.1, 1, 1, 1, 7, 5);
    cone(g, mat('pumpkin'), 0.022, 0.06, dx + 0.1, 0.155, dz + 0.15, 4, PI / 2, 0.6, 0);
    for (const s of [-1, 1]) ball(g, cer(COL.charcoal), 0.009, dx + 0.07 + s * 0.04, 0.185, dz + 0.12 - s * 0.02, 1, 1, 1, 4, 3);
    cone(g, white, 0.04, 0.08, dx - 0.07, 0.11, dz - 0.1, 4, -1.1, 0.6, 0);
  },
});

// ---------------------------------------------------------------- sunflowers
decor({
  id: 'sunflowers', name: 'Sunflowers', cat: 'garden', icon: '🌻', sound: 'leaf', cacheExtra: variantKey,
  desc: 'Tall, cheerful sunflowers turning their faces to the sun.',
  build(g, p, o) {
    const leaves = mat('leaves'), petal = mat('petalYellow'), seed = mat('bark');
    const r = rng(o.v * 5 + 77);
    const spots = [[-0.45, -0.3], [0.1, -0.45], [0.5, -0.1], [-0.2, 0.2], [0.3, 0.4]];
    spots.forEach(([x, z], i) => {
      const h = 1.4 + r() * 0.7;
      const tx = x + (r() - 0.5) * 0.15, tz = z + 0.08;
      rod(g, leaves, [x, -0.02, z], [tx, h, tz], 0.03, 0.022, 5);
      for (let k = 0; k < 3; k++) {
        const t = 0.3 + k * 0.2, a = k * 2.3 + i;
        ball(g, leaves, 1, x + (tx - x) * t + Math.cos(a) * 0.12, h * t, z + (tz - z) * t + Math.sin(a) * 0.12, 0.12, 0.02, 0.17, 7, 4, 0.3, -a + PI / 2, 0);
      }
      const head = new THREE.Group();
      head.position.set(tx, h, tz);
      head.rotation.set(PI / 2 - 0.4 - r() * 0.2, (r() - 0.5) * 0.6, 0);
      g.add(head);
      cyl(head, petal, 0.22, 0.2, 0.025, 0, -0.012, 0, 14);
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * TAU;
        ball(head, petal, 1, Math.cos(a) * 0.22, 0, Math.sin(a) * 0.22, 0.06, 0.012, 0.03, 5, 3, 0, -a, 0);
      }
      cyl(head, seed, 0.11, 0.12, 0.05, 0, 0, 0, 12);
    });
  },
});

// ---------------------------------------------------------------- boulders
decor({
  id: 'boulders', name: 'Mossy Boulders', cat: 'garden', icon: '🪨', sound: 'stone', cacheExtra: variantKey,
  desc: 'A few big round stones with moss and ferny tufts.',
  build(g, p, o) {
    const stone = mat('path'), leaves = mat('leaves');
    const rot = o.v * 1.4;
    const rocks = [[0.0, 0.0, 0.5, 0.62], [0.55, 0.35, 0.3, 0.7], [-0.5, 0.4, 0.22, 0.75]];
    rocks.forEach(([x, z, r, sy], i) => {
      const X = x * Math.cos(rot) - z * Math.sin(rot), Z = x * Math.sin(rot) + z * Math.cos(rot);
      blob(g, stone, r, X, r * sy * 0.55, Z, i + o.v * 3, sy, 0.16);
      if (i === 0) blob(g, leaves, r * 0.55, X - 0.08, r * sy * 1.05, Z + 0.05, i + 4, 0.3, 0.2);
    });
    for (let i = 0; i < 5; i++) {
      const a = rot + i * 1.3, d = 0.55 + (i % 2) * 0.2;
      for (let k = 0; k < 3; k++) cone(g, leaves, 0.035, 0.22, Math.cos(a) * d, -0.02, Math.sin(a) * d, 4, (k - 1) * 0.35, a, (k - 1) * 0.2);
    }
  },
});

// ---------------------------------------------------------------- birdbath
const BIRDBATH = [[0.001, 0], [0.22, 0], [0.23, 0.05], [0.14, 0.1], [0.09, 0.2], [0.075, 0.45], [0.1, 0.6], [0.3, 0.7], [0.36, 0.76], [0.35, 0.8], [0.31, 0.8], [0.26, 0.75], [0.001, 0.71]];
decor({
  id: 'birdbath', name: 'Birdbath', cat: 'garden', icon: '🐦', sound: 'stone',
  desc: 'A stone birdbath with a robin stopping by for a splash.',
  build(g) {
    add(g, latheGeo('birdbath', BIRDBATH, 16), mat('stoneBlock'), 0, -0.02, 0);
    cyl(g, mat('water'), 0.3, 0.3, 0.01, 0, 0.74, 0, 16);
    const brown = fab('#8a6a4a'), breast = fab('#d9653a');
    const bx = 0.3, by = 0.79, bz = 0.08;
    ball(g, brown, 0.045, bx, by + 0.04, bz, 0.85, 0.85, 1.2, 7, 5, 0, -1.2, 0);
    ball(g, breast, 0.032, bx - 0.03, by + 0.035, bz + 0.01, 1, 1, 1, 6, 4);
    ball(g, brown, 0.03, bx - 0.05, by + 0.08, bz + 0.015, 1, 1, 1, 6, 4);
    cone(g, mat('iron'), 0.008, 0.025, bx - 0.085, by + 0.075, bz + 0.02, 4, 0, 0, PI / 2);
    bc(g, brown, 0.06, 0.01, 0.035, bx + 0.06, by + 0.05, bz - 0.01, 0, -1.2, 0.4);
    posy(g, -0.3, 0, 0.25, 0.3, 7, 9);
  },
});

// ---------------------------------------------------------------- clothesline
decor({
  id: 'clothesline', name: 'Washing Line', cat: 'garden', icon: '👕', sound: 'soft', levels: GROUND_LEVEL,
  desc: 'Sheets and shirts flapping on the line, with a wicker basket below.',
  build(g) {
    const wood = mat('wood'), line = fab(COL.cream);
    for (const sx of [-1, 1]) {
      bxe(g, wood, sx * 0.85 - 0.04, sx * 0.85 + 0.04, -0.05, 1.75, -0.04, 0.04);
      bxe(g, wood, sx * 0.85 - 0.04, sx * 0.85 + 0.04, 1.65, 1.72, -0.22, 0.22);
    }
    for (const z of [-0.18, 0.18]) {
      rod(g, line, [-0.85, 1.7, z], [0, 1.64, z], 0.006, 0.006, 3);
      rod(g, line, [0, 1.64, z], [0.85, 1.7, z], 0.006, 0.006, 3);
    }
    const sag = (x) => 1.64 + Math.abs(x) / 0.85 * 0.06;
    const pin = (x, z) => bc(g, wood, 0.015, 0.06, 0.02, x, sag(x) - 0.005, z);
    // a big sheet, a shirt, a towel, socks
    const z = 0.18;
    bc(g, fab(COL.pillow), 0.6, 0.75, 0.012, -0.45, sag(-0.45) - 0.38, z, 0, 0, 0.02);
    pin(-0.7, z); pin(-0.2, z);
    const shirt = fab(COL.denim), sx = 0.22;
    bc(g, shirt, 0.3, 0.38, 0.014, sx, sag(sx) - 0.2, z, 0, 0, -0.02);
    for (const s of [-1, 1]) bc(g, shirt, 0.16, 0.08, 0.014, sx + s * 0.2, sag(sx) - 0.06, z, 0, 0, s * -0.6);
    pin(sx - 0.1, z); pin(sx + 0.1, z);
    bc(g, fab(COL.red), 0.22, 0.4, 0.012, 0.6, sag(0.6) - 0.2, z, 0, 0, 0.03);
    pin(0.52, z); pin(0.68, z);
    const z2 = -0.18;
    for (const [x, c] of [[-0.3, COL.mustard], [-0.15, COL.mustard], [0.3, COL.sage]]) {
      bc(g, fab(c), 0.06, 0.18, 0.012, x, sag(x) - 0.09, z2);
      bc(g, fab(c), 0.1, 0.05, 0.012, x + 0.03, sag(x) - 0.19, z2);
      pin(x, z2);
    }
    // wicker basket with folded laundry
    const hay = mat('hay');
    const bxp = 0.35, bzp = 0.6;
    bxe(g, hay, bxp - 0.25, bxp + 0.25, 0, 0.03, bzp - 0.17, bzp + 0.17);
    for (const [a, b, c, d] of [[-0.25, 0.25, -0.17, -0.15], [-0.25, 0.25, 0.15, 0.17], [-0.25, -0.23, -0.17, 0.17], [0.23, 0.25, -0.17, 0.17]]) bxe(g, hay, bxp + a, bxp + b, 0, 0.2, bzp + c, bzp + d);
    puff(g, fab(COL.teal), 0.42, 0.08, 0.28, bxp, 0.2, bzp, 0.5, 0, 0, 0, 10, 6);
    puff(g, fab(COL.pillow), 0.36, 0.06, 0.24, bxp + 0.02, 0.26, bzp, 0.5, 0, 0.1, 0, 10, 6);
  },
});

// ---------------------------------------------------------------- doghouse
decor({
  id: 'doghouse', name: 'Doghouse', cat: 'garden', icon: '🦴', sound: 'wood', paintAlways: true,
  desc: 'A snug little kennel with a shingled roof, a name plate and a full bowl.',
  build(g, p) {
    const body = mat('paintedWood', p.c || COL.red), trim = mat('paintedWood', COL.pillow), roof = mat('roofShingle');
    const W = 0.95, D = 1.05, H = 0.72, zc = -0.2, z1 = zc + D / 2;
    bxe(g, mat('timber'), -W / 2 - 0.02, W / 2 + 0.02, -0.03, 0.06, zc - D / 2 - 0.02, z1 + 0.02);
    const door = [[-0.2, 0.06], [0.2, 0.06], [0.2, 0.36]];
    for (let i = 1; i < 8; i++) { const a = (i / 8) * PI; door.push([0.2 * Math.cos(a), 0.36 + 0.2 * Math.sin(a)]); }
    door.push([-0.2, 0.36]);
    const front = [[-W / 2, 0.06], [W / 2, 0.06], [W / 2, H], [0, H + 0.38], [-W / 2, H]];
    poly(g, body, front, 0.04, 0, 0, z1 - 0.02, 0, [door]);
    poly(g, body, front, 0.04, 0, 0, zc - D / 2 + 0.02, 0);
    for (const sx of [-1, 1]) bxe(g, body, sx * W / 2 - 0.02, sx * W / 2 + 0.02, 0.06, H, zc - D / 2, z1);
    bxe(g, cer(COL.soot), -W / 2 + 0.03, W / 2 - 0.03, 0.06, H, zc - D / 2 + 0.05, zc - D / 2 + 0.06);
    bxe(g, cer(COL.soot), -W / 2 + 0.03, W / 2 - 0.03, 0.06, 0.07, zc - D / 2 + 0.04, z1 - 0.04);
    // door trim, name plate
    for (let i = 0; i <= 8; i++) { const a = (i / 8) * PI; bc(g, trim, 0.06, 0.04, 0.02, 0.22 * Math.cos(a), 0.36 + 0.22 * Math.sin(a), z1 + 0.005, 0, 0, a + PI / 2); }
    for (const s of [-1, 1]) bxe(g, trim, s * 0.22 - 0.02, s * 0.22 + 0.02, 0.06, 0.36, z1 - 0.005, z1 + 0.015);
    bxe(g, mat('wood'), -0.15, 0.15, 0.66, 0.76, z1, z1 + 0.02);
    // roof
    const half = W / 2 + 0.12, rise = 0.38 * (half / (W / 2)), len = Math.hypot(half, rise), ang = Math.atan2(0.38, W / 2);
    for (const s of [-1, 1]) bc(g, roof, len, 0.05, D + 0.16, s * half / 2, H + 0.38 / 2 + 0.03, zc, 0, 0, -s * ang);
    cylc(g, trim, 0.035, 0.035, D + 0.2, 0, H + 0.42, zc, 8, PI / 2, 0, 0);
    // bowl with kibble
    add(g, latheGeo('bowl', BOWL, 12), cer(COL.teal), 0.55, 0, 0.55);
    cyl(g, mat('bark'), 0.1, 0.1, 0.02, 0.55, 0.045, 0.55, 10);
  },
});

// ====================================================================== registration order (palette order)

const ORDER = [
  // bedroom & living room
  'bed', 'nightstand', 'wardrobe', 'dresser', 'sofa', 'armchair', 'rocking_chair', 'rug', 'rug_round', 'floor_lamp',
  'bookshelf', 'fireplace', 'wood_stove', 'piano', 'grandfather_clock', 'plant_pot', 'cat', 'dog_bed',
  // kitchen, dining, study, bath, storage
  'table', 'chair', 'kitchen', 'kitchen_counter', 'kitchen_range', 'desk', 'bathtub', 'washstand', 'crate_stack', 'barrel',
  // garden
  'tree_oak', 'tree_pine', 'tree_birch', 'tree_apple', 'bush', 'flowers', 'lavender', 'sunflowers', 'veggie_bed', 'pumpkins',
  'boulders', 'pond', 'bench', 'picnic_table', 'fire_pit', 'lamp_post', 'mailbox', 'birdhouse', 'birdbath', 'well',
  'woodpile', 'hay_bale', 'wheelbarrow', 'clothesline', 'chickens', 'beehive', 'doghouse', 'scarecrow',
];
const done = new Set();
for (const id of ORDER) {
  const d = DEFS.find((x) => x.id === id);
  if (d) { register(d); done.add(id); }
}
for (const d of DEFS) if (!done.has(d.id)) register(d);
