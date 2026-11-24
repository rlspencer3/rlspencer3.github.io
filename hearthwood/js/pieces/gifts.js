// Hearthwood — the villagers' thank-you gifts (docs/LIVING.md §8.2, §8.3, §12.4). WP2.
//
// Ten garden pieces (cat 'garden', slot 'cell', layer 'I'), registered hidden until a villager gives them. Ids, names,
// the giver's job, nav `walk` and seat anchors come from js/town/data.js GIFTS (the single source of truth); the
// geometry here is built round those seat anchors. Unlocks are read at registration from two device keys (the tiny
// KEYS.unlocks mirror and the town save's `unlocks`), in try/catch, so an unlocked gift stays in the tray even when
// the town module fails to load, villagers are off, or the page is a showcase (§8.3). world.validate ignores
// `hidden`, so saves, share codes and Pick work with gifts whether or not they are unlocked here.
//
// Look rules (as decor.js): standing surface from the F piece in the cell (grass, path stones, floor/deck, upstairs
// floor, flat-roof terrace) — contextual, contextKey = that surface code; only existing mat() ids, and for every fixed
// colour a (material, colour) pair some piece module already uses, so the gifts add no material and no batch render
// unit (§8.2, L7). Each ≤ 1.5k triangles, deterministic.

import * as THREE from 'three';
import { registerPiece } from '../catalog.js';
import { BASE_Y, K, MAX_LEVEL } from '../config.js';
import { mat } from '../materials.js';
import { boxGeo, cylGeo, sphereGeo, coneGeo, prismGeo, cached, add } from '../geom.js';
import { GIFTS, KEYS } from '../town/data.js';

const PI = Math.PI;
const TAU = PI * 2;
const r3 = (n) => Math.round(n * 1000) / 1000;

// ====================================================================== standing surface (decor.js's rule, §8.2)

const SURF_Y = { g: -BASE_Y, p: -BASE_Y + 0.025, f: 0, u: 0.006, r: 0.166 };

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

// ====================================================================== colours (pairs existing pieces already use)

const COL = {
  linen: '#f3ece0', pillow: '#fbf7ee', wax: '#f6eedc', cream: '#efe3c8', mustard: '#e9c46a', terracotta: '#c0643f',
  apple: '#c8382e', red: '#b4473a', sage: '#9cae6b', teal: '#7fa7a3', denim: '#5d7fa3', navy: '#2f4a66',
  charcoal: '#2f2a28', paper: '#fbf6ea', pink: '#e7a0a0', gold: '#d9a441', walnut: '#7a4b3a', crust: '#c9a46a',
};
const fab = (c) => mat('fabric', c);
const cer = (c) => mat('ceramic', c);
const pw = (c) => mat('paintedWood', c);

// ====================================================================== little mesh helpers (all geometry cached)

/** Box from extents. */
function bxe(g, m, x0, x1, y0, y1, z0, z1) {
  return add(g, boxGeo(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0)), m, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
}
/** Box w × h × d centred at (x, y, z). */
const bc = (g, m, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) => add(g, boxGeo(w, h, d), m, x, y, z, rx, ry, rz);
/** Cylinder standing with its bottom at y. */
const cyl = (g, m, rt, rb, h, x, y, z, seg = 10) => add(g, cylGeo(rt, rb, h, seg), m, x, y + h / 2, z);
/** Cylinder centred at (x, y, z), rotated. */
const cylc = (g, m, rt, rb, h, x, y, z, seg = 10, rx = 0, ry = 0, rz = 0) => add(g, cylGeo(rt, rb, h, seg), m, x, y, z, rx, ry, rz);
function ball(g, m, r, x, y, z, sx = 1, sy = 1, sz = 1, ws = 8, hs = 6, rx = 0, ry = 0, rz = 0) {
  const o = add(g, sphereGeo(r, ws, hs), m, x, y, z, rx, ry, rz);
  o.scale.set(sx, sy, sz);
  return o;
}
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
/** Lathe from [radius, y] points (UVs in metres). */
function latheGeo(key, pts, seg = 12) {
  return cached(`gf-lathe|${key}|${seg}`, () => {
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
const lathe = (g, m, key, pts, seg, x = 0, y = 0, z = 0) => add(g, latheGeo(key, pts, seg), m, x, y, z);
const torusGeo = (R, r, rs = 4, ts = 14, arc = TAU) =>
  cached(`gf-torus|${r3(R)}|${r3(r)}|${rs}|${ts}|${r3(arc)}`, () => new THREE.TorusGeometry(R, r, rs, ts, arc));
/** Extruded XY polygon (depth along Z), centred at (x, y, z), turned ry about Y. */
const poly = (g, m, pts, depth, x = 0, y = 0, z = 0, ry = 0) => add(g, prismGeo(pts, depth), m, x, y, z, 0, ry, 0);
const discGeo = (r, seg) => cached(`gf-disc|${r3(r)}|${seg}`, () => new THREE.CircleGeometry(r, seg));

/** Arched outline (x from −w/2..w/2, y0 → spring line ys, crown yc). */
function archPts(w, y0, ys, yc, n = 8) {
  const pts = [[-w / 2, y0], [w / 2, y0]];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * PI;
    pts.push([Math.cos(a) * w / 2, ys + Math.sin(a) * (yc - ys)]);
  }
  return pts;
}

/** Terracotta pot with a posy of blooms (≈ 150 triangles). */
const POT = [[0.001, 0], [0.085, 0], [0.1, 0.015], [0.12, 0.17], [0.135, 0.18], [0.135, 0.21], [0.001, 0.2]];
function pottedBloom(g, x, y, z, petal, s = 1, seed = 0) {
  const o = lathe(g, cer(COL.terracotta), 'pot', POT, 8, x, y, z);
  o.scale.set(s, s, s);
  ball(g, mat('leaves'), 0.13 * s, x, y + 0.24 * s, z, 1.05, 0.75, 1.05, 6, 4);
  const pm = mat(petal);
  for (let i = 0; i < 3; i++) {
    const a = seed * 1.7 + (i / 3) * TAU;
    ball(g, pm, 0.06 * s, x + Math.cos(a) * 0.07 * s, y + (0.3 + (i % 2) * 0.04) * s, z + Math.sin(a) * 0.07 * s, 1, 0.8, 1, 5, 3);
  }
}

// ====================================================================== the ten gifts

const BUILD = {
  // 🌸 Flower Cart (Gardener): a little wooden handcart on two spoked wheels, heaped with potted blooms. 2 × BLOOM.
  gift_flower_cart(g) {
    const wood = mat('wood'), tim = mat('timber');
    const by = 0.46;                                       // top of the cart bed
    bxe(g, wood, -0.56, 0.56, by - 0.06, by, -0.36, 0.36);
    for (const s of [-1, 1]) {
      bxe(g, wood, -0.56, 0.56, by, by + 0.17, s * 0.36 - 0.02, s * 0.36 + 0.02);
      bxe(g, tim, -0.58, 0.58, by + 0.17, by + 0.2, s * 0.36 - 0.025, s * 0.36 + 0.025);
      bxe(g, wood, s * 0.56 - 0.02, s * 0.56 + 0.02, by, by + 0.15, -0.34, 0.34);
    }
    // wheels (rim, six spokes, hub) on an axle under the bed
    const wx = 0.08, wr = 0.32, wy = wr + 0.035;
    for (const s of [-1, 1]) {
      const wz = s * 0.45;
      add(g, torusGeo(wr, 0.035, 3, 12), tim, wx, wy, wz);
      for (let k = 0; k < 3; k++) bc(g, wood, 0.03, wr * 2 - 0.04, 0.03, wx, wy, wz, 0, 0, (k / 3) * PI);
      cylc(g, tim, 0.055, 0.055, 0.09, wx, wy, wz, 8, PI / 2, 0, 0);
    }
    cylc(g, tim, 0.025, 0.025, 0.94, wx, wy, 0, 6, PI / 2, 0, 0);
    // handles and a prop leg at the back
    for (const s of [-1, 1]) {
      rod(g, tim, [-0.5, by - 0.03, s * 0.26], [-0.97, by + 0.2, s * 0.26], 0.025);
      bxe(g, wood, -0.49, -0.43, 0, by - 0.06, s * 0.26 - 0.03, s * 0.26 + 0.03);
    }
    // a step at the back for the second row of pots
    bxe(g, wood, -0.5, 0.05, by, by + 0.12, -0.3, 0.3);
    pottedBloom(g, -0.3, by + 0.12, -0.17, 'petalPink', 1, 0);
    pottedBloom(g, -0.3, by + 0.12, 0.17, 'petalYellow', 1, 1);
    pottedBloom(g, 0.22, by, -0.18, 'petalWhite', 1.05, 2);
    pottedBloom(g, 0.24, by, 0.17, 'petalPink', 0.95, 3);
    pottedBloom(g, 0.42, by, 0, 'petalYellow', 0.9, 4);
  },

  // 🐓 Hen House (Farmer): a little A-frame coop on stubby legs, a cleated ramp, a nesting box with straw. FARM.
  gift_hen_house(g, p) {
    const body = pw(p.c || COL.red), trim = pw(COL.pillow), wood = mat('wood'), roof = mat('roofShingle'), hay = mat('hay');
    const fy = 0.3, ridge = 1.14, half = 0.46, zf = 0.42;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) bxe(g, wood, sx * 0.36 - 0.035, sx * 0.36 + 0.035, 0, fy, sz * 0.3 - 0.035, sz * 0.3 + 0.035);
    bxe(g, wood, -0.48, 0.48, fy, fy + 0.05, -0.42, 0.42);
    // gable ends (front with a little arched door and a round window), shingled slopes, ridge board
    const tri = [[-half, 0], [half, 0], [0, ridge - fy]];
    poly(g, body, tri, 0.04, 0, fy, zf);
    poly(g, body, tri, 0.04, 0, fy, -zf);
    poly(g, mat('timber'), archPts(0.2, 0, 0.16, 0.26), 0.02, 0, fy + 0.04, zf + 0.025);
    cylc(g, mat('timber'), 0.05, 0.05, 0.02, 0, fy + 0.46, zf + 0.025, 10, PI / 2, 0, 0);
    add(g, torusGeo(0.055, 0.012, 3, 10), trim, 0, fy + 0.46, zf + 0.035);
    const slope = Math.hypot(half + 0.06, ridge - fy + 0.04), ang = Math.atan2(half + 0.06, ridge - fy + 0.04);
    for (const s of [-1, 1]) bc(g, roof, 0.045, slope, 1.0, s * (half + 0.06) / 2, fy + (ridge - fy + 0.04) / 2 - 0.02, 0, 0, 0, s * ang);
    bc(g, trim, 0.07, 0.05, 1.04, 0, ridge + 0.02, 0);
    for (const s of [-1, 1]) rod(g, trim, [s * half, fy + 0.02, zf + 0.03], [0, ridge, zf + 0.03], 0.018, 0.018, 4);
    // ramp with cleats down to the grass
    const r0 = [0, fy + 0.04, zf + 0.04], r1 = [0, 0.012, zf + 0.5];
    const rl = Math.hypot(r1[1] - r0[1], r1[2] - r0[2]), ra = Math.atan2(r0[1] - r1[1], r1[2] - r0[2]);
    bc(g, wood, 0.2, 0.024, rl, 0, (r0[1] + r1[1]) / 2, (r0[2] + r1[2]) / 2, ra, 0, 0);
    for (let i = 1; i <= 3; i++) {
      const t = i / 4;
      bc(g, mat('timber'), 0.2, 0.022, 0.022, 0, r0[1] + (r1[1] - r0[1]) * t + 0.02, r0[2] + (r1[2] - r0[2]) * t, ra, 0, 0);
    }
    // nesting box on the side, straw poking out
    bxe(g, body, -0.74, -0.48, fy + 0.04, fy + 0.26, -0.22, 0.22);
    bc(g, roof, 0.32, 0.03, 0.5, -0.61, fy + 0.3, 0, 0, 0, -0.32);
    for (const [z, h] of [[-0.12, 0.07], [0.02, 0.09], [0.13, 0.06]]) cone(g, hay, 0.05, h, -0.7, fy + 0.2, z, 5, 0, 0, 0.6);
    for (const x of [-0.08, 0.07]) cone(g, hay, 0.05, 0.08, x, fy + 0.04, zf + 0.06, 5, 0.8, 0, 0);
    // a hen on the ramp
    const hen = fab(COL.pillow);
    ball(g, hen, 0.08, 0.02, 0.27, zf + 0.25, 0.85, 0.85, 1.2, 7, 5);
    ball(g, hen, 0.045, 0.02, 0.36, zf + 0.33, 1, 1, 1, 6, 4);
    ball(g, cer(COL.apple), 0.022, 0.02, 0.405, zf + 0.33, 0.5, 1, 1.2, 5, 3);
    cone(g, mat('pumpkin'), 0.015, 0.035, 0.02, 0.345, zf + 0.38, 4, PI / 2, 0, 0);
  },

  // 🐻 Carved Bear (Woodcutter): a chunky bear carved from a log, one paw waving, sitting on a ringed stump.
  gift_carved_bear(g) {
    const wood = mat('wood'), bark = mat('bark');
    const sh = 0.34;
    cyl(g, bark, 0.3, 0.34, sh, 0, 0, 0, 12);
    add(g, discGeo(0.3, 12), wood, 0, sh + 0.002, 0, -PI / 2, 0, 0);
    add(g, torusGeo(0.24, 0.008, 3, 14), bark, 0, sh + 0.004, 0, PI / 2, 0, 0);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + 0.4;
      cone(g, bark, 0.07, 0.14, Math.cos(a) * 0.33, 0.006, Math.sin(a) * 0.33, 5, Math.sin(a) * 0.4, 0, -Math.cos(a) * 0.4);
    }
    // the bear, sitting (feet forward over the stump's edge)
    const by = sh;
    ball(g, wood, 0.24, 0, by + 0.24, -0.02, 1.0, 1.1, 0.9, 10, 7);
    ball(g, wood, 0.15, 0, by + 0.2, 0.13, 1.0, 1.1, 0.6, 8, 5);           // tummy
    ball(g, wood, 0.17, 0, by + 0.6, 0.02, 1, 0.95, 0.95, 10, 7);           // head
    ball(g, wood, 0.075, 0, by + 0.56, 0.16, 1.1, 0.8, 1, 7, 5);            // snout
    ball(g, bark, 0.03, 0, by + 0.59, 0.235, 1.2, 0.9, 0.8, 5, 3);          // nose
    for (const s of [-1, 1]) {
      ball(g, bark, 0.022, s * 0.065, by + 0.66, 0.15, 1, 1, 0.6, 4, 3); // eyes
      ball(g, wood, 0.06, s * 0.12, by + 0.74, -0.01, 1, 1, 0.6, 6, 4);   // ears
      ball(g, bark, 0.032, s * 0.12, by + 0.745, 0.015, 1, 1, 0.4, 5, 3);
      ball(g, wood, 0.085, s * 0.12, by + 0.06, 0.2, 0.9, 0.75, 1.3, 7, 5); // feet
      ball(g, bark, 0.045, s * 0.12, by + 0.06, 0.31, 0.9, 0.9, 0.4, 5, 3); // pads
    }
    // left paw resting, right paw raised in a wave
    ball(g, wood, 0.07, -0.21, by + 0.24, 0.1, 0.8, 1.5, 0.9, 7, 5, 0.3, 0, 0.3);
    rod(g, wood, [0.18, by + 0.38, 0.0], [0.3, by + 0.64, 0.06], 0.065, 0.06, 7);
    ball(g, wood, 0.075, 0.31, by + 0.68, 0.07, 1, 1, 0.75, 7, 5);
    ball(g, bark, 0.035, 0.315, by + 0.68, 0.12, 1, 1, 0.4, 5, 3);
    // carved grooves on the back
    for (const y of [0.18, 0.3, 0.42]) add(g, torusGeo(0.2, 0.008, 3, 10, PI * 0.9), bark, 0, by + y, -0.02, PI / 2, 0, PI * 1.05);
  },

  // 🛶 Little Rowboat (Fisher): pale blue outside, white inside, resting on the grass with crossed oars and a coil of
  // rope. Seat: GIFTS.seats[0] (the top of the stern thwart).
  gift_rowboat(g, p, seats) {
    const paint = pw(p.c || COL.teal), wood = mat('wood'), tim = mat('timber');
    const H = 0.34;                                          // gunwale height (the thwarts sit just below it)
    add(g, hullGeo(false), paint, 0, H, 0);
    add(g, hullGeo(true), pw(COL.pillow), 0, H, 0);                 // painted inside (white), as boats are
    const rim = add(g, torusGeo(1, 0.03, 3, 22), paint, 0, H, 0.0, PI / 2, 0, 0);
    rim.scale.set(0.425, 0.9, 1);
    // thwarts: the seat anchor is the top of the stern thwart (y = seat[1])
    const st = seats[0] || [0, 0.32, -0.15, 0];
    bxe(g, wood, -0.36, 0.36, st[1] - 0.04, st[1], st[2] - 0.09, st[2] + 0.09);
    bxe(g, wood, -0.33, 0.33, st[1] - 0.04, st[1], 0.4, 0.54);
    bxe(g, tim, -0.04, 0.04, 0.02, st[1] - 0.04, 0.43, 0.51);
    bxe(g, tim, -0.04, 0.04, 0.02, st[1] - 0.04, st[2] - 0.04, st[2] + 0.04);
    // crossed oars resting on the bow thwart, blades over the gunwale
    for (const s of [-1, 1]) {
      const a = [s * -0.32, st[1] + 0.03, 0.98], b = [s * 0.42, st[1] + 0.03, 0.02];
      rod(g, wood, a, b, 0.02, 0.02, 6);
      const d = Math.atan2(b[0] - a[0], b[2] - a[2]);
      bc(g, wood, 0.12, 0.018, 0.32, b[0] + Math.sin(d) * 0.14, b[1] + 0.005, b[2] + Math.cos(d) * 0.14, 0, d, 0);
    }
    // a coil of rope in the bow
    const rope = fab(COL.cream);
    for (let i = 0; i < 2; i++) add(g, torusGeo(0.1 - i * 0.025, 0.022, 4, 12), rope, 0.04, 0.07 + i * 0.035, 0.16, PI / 2, 0, 0);
  },

  // 🍯 Honey Stand (Beekeeper): slatted stand, gingham cloth, rows of honey jars, a little painted sign.
  gift_honey_stand(g) {
    const wood = mat('wood'), tim = mat('timber');
    const ty = 0.78;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) bxe(g, wood, sx * 0.6 - 0.03, sx * 0.6 + 0.03, 0, ty, sz * 0.26 - 0.03, sz * 0.26 + 0.03);
    bxe(g, wood, -0.66, 0.66, ty, ty + 0.04, -0.32, 0.32);
    bxe(g, wood, -0.6, 0.6, 0.3, 0.34, -0.28, 0.28);
    for (const y of [0.1, 0.48]) bxe(g, tim, -0.6, 0.6, y, y + 0.06, 0.25, 0.29);
    // gingham cloth with a short drape at the front
    const red = fab(COL.red), white = fab(COL.pillow);
    bxe(g, red, -0.62, 0.62, ty + 0.04, ty + 0.05, -0.3, 0.33);
    bxe(g, red, -0.62, 0.62, ty - 0.1, ty + 0.05, 0.33, 0.34);
    for (let i = 0; i < 5; i++) for (let j = 0; j < 3; j++) if ((i + j) % 2 === 0) bxe(g, white, -0.62 + i * 0.248 + 0.004, -0.62 + (i + 1) * 0.248 - 0.004, ty + 0.05, ty + 0.056, -0.3 + j * 0.21 + 0.004, -0.3 + (j + 1) * 0.21 - 0.004);
    // honey jars: wax glass, mustard cloth lids, paper labels
    const jar = (x, y, z, s = 1) => {
      cyl(g, cer(COL.wax), 0.055 * s, 0.06 * s, 0.12 * s, x, y, z, 8);
      cyl(g, fab(COL.mustard), 0.07 * s, 0.072 * s, 0.025 * s, x, y + 0.12 * s, z, 8);
      ball(g, fab(COL.mustard), 0.03 * s, x, y + 0.15 * s, z, 1, 0.6, 1, 5, 3);
      bc(g, cer(COL.paper), 0.07 * s, 0.05 * s, 0.01, x, y + 0.06 * s, z + 0.058 * s);
    };
    for (let i = 0; i < 5; i++) jar(-0.44 + i * 0.22, ty + 0.056, 0.08 + (i % 2) * 0.05, 1);
    for (let i = 0; i < 3; i++) jar(-0.25 + i * 0.25, 0.34, 0.02, 1.1);
    // the sign: a walnut board with a mustard honeycomb, on two posts at the back
    for (const sx of [-1, 1]) bxe(g, tim, sx * 0.42 - 0.025, sx * 0.42 + 0.025, ty + 0.04, ty + 0.62, -0.29, -0.24);
    bxe(g, pw(COL.walnut), -0.48, 0.48, ty + 0.36, ty + 0.64, -0.29, -0.25);
    const hex = [];
    for (let k = 0; k < 6; k++) { const a = (k / 6) * TAU; hex.push([Math.cos(a) * 0.06, Math.sin(a) * 0.06]); }
    for (const [hx, hy] of [[-0.1, 0], [0, 0.06], [0.1, 0], [0, -0.06], [-0.2, 0.06], [0.2, 0.06]]) poly(g, pw(COL.mustard), hex, 0.012, hx, ty + 0.5 + hy, -0.24);
  },

  // 🥖 Bread Oven (Baker): a domed clay oven on a stone plinth, its arched mouth glowing at night, a peel leaning.
  gift_bread_oven(g) {
    const clay = cer(COL.terracotta), stone = mat('stoneBlock'), ember = mat('ember'), wood = mat('wood');
    const py = 0.56;
    bxe(g, stone, -0.7, 0.7, 0, py, -0.6, 0.6);
    bxe(g, stone, -0.74, 0.74, py - 0.06, py, -0.64, 0.64);
    lathe(g, clay, 'oven-dome', [[0.56, 0], [0.56, 0.08], [0.52, 0.24], [0.42, 0.38], [0.26, 0.5], [0.001, 0.55]], 12, 0, py, -0.1);
    // arched mouth (glowing) in a stone arch, a little clay hood
    poly(g, stone, archPts(0.46, 0, 0.22, 0.42, 8), 0.12, 0, py, 0.42);
    poly(g, ember, archPts(0.3, 0, 0.16, 0.3, 8), 0.02, 0, py + 0.005, 0.485);
    // chimney: the smoke emitter sits on its top (def.emitterOffset [0, 1.3, −0.2], §8.2)
    cyl(g, clay, 0.07, 0.085, 0.4, 0, 0.88, -0.2, 8);
    add(g, torusGeo(0.075, 0.018, 3, 8), clay, 0, 1.28, -0.2, PI / 2, 0, 0);
    // loaves cooling on the ledge
    for (const [x, z, r] of [[-0.46, 0.38, 0.2], [-0.47, 0.14, -0.3], [0.48, 0.32, 0.4]]) {
      ball(g, cer(COL.crust), 0.12, x, py + 0.05, z, 0.8, 0.5, 1.15, 8, 5, 0, r, 0);
    }
    // a bread peel leaning on the plinth, firewood at its foot
    rod(g, wood, [0.96, 0.24, 0.38], [0.74, 1.12, 0.3], 0.022);
    bc(g, wood, 0.03, 0.34, 0.3, 0.98, 0.17, 0.39, 0, 0, -0.24);
    for (const [z, y] of [[-0.25, 0.07], [0.0, 0.07], [-0.12, 0.2]]) {
      cylc(g, mat('bark'), 0.07, 0.07, 0.5, -0.94, y, z, 7, 0, 0, PI / 2);
      for (const s of [-1, 1]) add(g, discGeo(0.07, 7), wood, -0.94 + s * 0.251, y, z, 0, s * PI / 2, 0);
    }
  },

  // ✨ Festoon Lights (Lamplighter): two slim posts with a sagging string of seven warm bulbs. LAMP.
  gift_festoon(g) {
    const tim = mat('timber'), iron = mat('iron'), glow = mat('lampGlow');
    const X = 0.84, top = 2.15, hang = 1.98;
    for (const s of [-1, 1]) {
      bxe(g, tim, s * X - 0.13, s * X + 0.13, 0, 0.1, -0.13, 0.13);
      bxe(g, tim, s * X - 0.045, s * X + 0.045, 0.1, top, -0.045, 0.045);
      cone(g, tim, 0.07, 0.09, s * X, top, 0, 4, 0, PI / 4, 0);
      bxe(g, iron, s * X - s * 0.12, s * X, hang - 0.015, hang + 0.015, -0.015, 0.015);
    }
    const sag = 0.36, n = 16, pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, x = -X + 0.12 + t * (2 * X - 0.24);
      pts.push(new THREE.Vector3(x, hang - sag * 4 * t * (1 - t), 0));
    }
    add(g, cached('gf-festoon-string', () => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.008, 4, false)), iron, 0, 0, 0);
    for (let i = 0; i < 7; i++) {
      const t = (i + 0.5) / 7, x = -X + 0.12 + t * (2 * X - 0.24), y = hang - sag * 4 * t * (1 - t);
      cyl(g, iron, 0.018, 0.022, 0.04, x, y - 0.045, 0, 6);
      ball(g, glow, 0.05, x, y - 0.09, 0, 1, 1.25, 1, 7, 5);
    }
  },

  // 🪧 Signpost (Postie): a timber fingerpost with three painted arrow boards and a tiny roof cap.
  gift_signpost(g) {
    const tim = mat('timber');
    bxe(g, tim, -0.1, 0.1, 0, 0.08, -0.1, 0.1);
    bxe(g, tim, -0.055, 0.055, 0.08, 2.0, -0.055, 0.055);
    for (const s of [-1, 1]) bc(g, tim, 0.22, 0.025, 0.2, s * 0.075, 2.05, 0, 0, 0, -s * 0.6);
    const arrow = [[-0.28, -0.065], [0.2, -0.065], [0.29, 0], [0.2, 0.065], [-0.28, 0.065]];
    const boards = [[1.72, 0.35, COL.pillow], [1.47, 2.7, COL.sage], [1.22, -0.95, COL.red]];
    for (const [y, yaw, col] of boards) {
      const off = 0.2, cx = Math.cos(yaw) * off, cz = -Math.sin(yaw) * off;
      poly(g, pw(col), arrow, 0.03, cx, y, cz, yaw);
      for (const dy of [-0.025, 0.02]) bc(g, tim, 0.3, 0.012, 0.035, cx - Math.cos(yaw) * 0.02, y + dy, cz + Math.sin(yaw) * 0.02, 0, yaw, 0);
    }
  },

  // 🧙 Garden Gnome (anyone): 40 cm, red pointy hat (paint it), white beard, blue coat, a tiny lantern.
  gift_gnome(g, p) {
    const coat = cer(COL.denim), face = cer(COL.cream), beard = cer(COL.pillow), boot = cer(COL.charcoal);
    for (const s of [-1, 1]) ball(g, boot, 0.045, s * 0.05, 0.03, 0.02, 1, 0.65, 1.4, 6, 4);
    lathe(g, coat, 'gnome-coat', [[0.11, 0.03], [0.12, 0.06], [0.1, 0.16], [0.085, 0.22], [0.05, 0.25], [0.001, 0.26]], 10);
    cylc(g, boot, 0.1, 0.105, 0.025, 0, 0.12, 0, 10);
    bc(g, cer(COL.gold), 0.035, 0.03, 0.012, 0, 0.12, 0.103);
    ball(g, face, 0.075, 0, 0.29, 0.005, 1, 1, 1, 8, 6);
    ball(g, cer(COL.pink), 0.025, 0, 0.29, 0.08, 1, 0.9, 1, 5, 4);
    for (const s of [-1, 1]) ball(g, boot, 0.009, s * 0.03, 0.31, 0.066, 1, 1.2, 0.6, 4, 3);
    // beard: a soft cone pointing down over the chest
    add(g, coneGeo(0.075, 0.16, 8), beard, 0, 0.2, 0.04, PI, 0, 0).scale.set(1, 1, 0.55);
    // hat: a tall floppy point (paintable fabric)
    const hat = fab(p.c || COL.red);
    cylc(g, hat, 0.083, 0.086, 0.03, 0, 0.335, 0, 10);
    rod(g, hat, [0, 0.34, 0], [0.02, 0.48, -0.02], 0.08, 0.04, 8);
    rod(g, hat, [0.02, 0.48, -0.02], [0.07, 0.55, -0.06], 0.04, 0.008, 6);
    // arms: one holding a lantern out
    rod(g, coat, [-0.085, 0.2, 0], [-0.11, 0.12, 0.04], 0.028, 0.024, 5);
    ball(g, face, 0.025, -0.115, 0.11, 0.05, 1, 1, 1, 5, 3);
    rod(g, coat, [0.085, 0.2, 0], [0.13, 0.17, 0.08], 0.028, 0.024, 5);
    ball(g, face, 0.025, 0.135, 0.165, 0.09, 1, 1, 1, 5, 3);
    const iron = mat('iron');
    rod(g, iron, [0.135, 0.18, 0.09], [0.135, 0.145, 0.09], 0.004, 0.004, 3);
    cyl(g, iron, 0.022, 0.026, 0.01, 0.135, 0.075, 0.09, 6);
    cyl(g, mat('lampGlow'), 0.02, 0.02, 0.05, 0.135, 0.085, 0.09, 6);
    cone(g, iron, 0.028, 0.025, 0.135, 0.135, 0.09, 6);
  },

  // 🫖 Tea Table (anyone): a round table with a lace cloth, teapot, two cups, a cake stand and two stools.
  // Seats: GIFTS.seats (the stools' cushion tops).
  gift_tea_table(g, p, seats) {
    const wood = mat('wood'), lace = fab(COL.pillow);
    const ty = 0.62;
    lathe(g, wood, 'tea-ped', [[0.17, 0], [0.16, 0.03], [0.05, 0.06], [0.04, 0.3], [0.06, 0.4], [0.04, 0.5], [0.05, ty - 0.04], [0.001, ty - 0.03]], 8);
    cylc(g, wood, 0.36, 0.36, 0.035, 0, ty - 0.0175, 0, 16);
    // bottom-up profile so the faces point out and up (FrontSide)
    lathe(g, lace, 'tea-lace', [[0.4, ty - 0.11], [0.395, ty - 0.03], [0.38, ty + 0.004], [0.001, ty + 0.004]], 16);
    // teapot, cups and saucers, a cake on a stand
    const pot = cer(COL.denim), py = ty + 0.006;
    ball(g, pot, 0.085, 0.04, py + 0.07, -0.08, 1, 0.85, 1, 9, 6);
    cyl(g, pot, 0.04, 0.045, 0.02, 0.04, py + 0.13, -0.08, 8);
    ball(g, pot, 0.016, 0.04, py + 0.155, -0.08, 1, 1, 1, 5, 3);
    rod(g, pot, [0.04, py + 0.06, -0.01], [0.04, py + 0.12, 0.07], 0.018, 0.01, 5);
    add(g, torusGeo(0.045, 0.011, 3, 8, PI * 1.2), pot, 0.04, py + 0.08, -0.16, 0, PI / 2, PI * 0.4);
    for (const s of [-1, 1]) {
      cyl(g, cer(COL.paper), 0.06, 0.05, 0.01, s * 0.22, py, 0.05, 10);
      cyl(g, cer(COL.cream), 0.035, 0.028, 0.055, s * 0.22, py + 0.01, 0.05, 8);
    }
    const sx = -0.06, sz = 0.16;
    cyl(g, cer(COL.paper), 0.012, 0.03, 0.09, sx, py, sz, 6);
    cyl(g, cer(COL.paper), 0.1, 0.09, 0.012, sx, py + 0.09, sz, 12);
    cyl(g, cer(COL.pink), 0.065, 0.065, 0.06, sx, py + 0.102, sz, 10);
    cyl(g, cer(COL.pillow), 0.067, 0.067, 0.015, sx, py + 0.162, sz, 10);
    ball(g, cer(COL.apple), 0.018, sx, py + 0.185, sz, 1, 1, 1, 6, 4);
    // two stools; their cushion tops are the seat anchors
    for (const st of seats) {
      const [x, y, z] = st;
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * TAU + 0.5;
        rod(g, wood, [x + Math.cos(a) * 0.12, 0, z + Math.sin(a) * 0.12], [x + Math.cos(a) * 0.07, y - 0.08, z + Math.sin(a) * 0.07], 0.02, 0.018, 5);
      }
      cylc(g, wood, 0.15, 0.14, 0.04, x, y - 0.06, z, 12);
      const c = add(g, sphereGeo(1, 10, 5), fab(COL.mustard), x, y - 0.04 - 0.002, z);
      c.scale.set(0.15, 0.042, 0.15);
    }
  },
};

/** Rowboat hull: a half ellipsoid with a narrower bow and a raised sheer; inner = the wooden inside (faces inward). */
function hullGeo(inner) {
  return cached(`gf-hull|${inner ? 1 : 0}`, () => {
    const W = inner ? 0.385 : 0.42, D = inner ? 0.3 : 0.34, L = inner ? 0.84 : 0.9;
    const g = new THREE.SphereGeometry(1, 14, 6, 0, TAU, PI / 2, PI / 2);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const zz = z * L;
      const narrow = z > 0 ? 1 - 0.55 * z * z : 1 - 0.18 * z * z;
      const sheer = z > 0 ? 0.07 * z * z : 0.02 * z * z;
      pos.setXYZ(i, x * W * narrow, y * D + sheer + (inner ? 0.004 : 0), zz);
    }
    if (inner) {
      const idx = g.index.array;
      for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
    }
    g.computeVertexNormals();
    return g;
  });
}

// ====================================================================== registration

const META = {
  gift_flower_cart: { icon: '🌸', sound: 'wood', levels: [0, MAX_LEVEL], desc: 'A little handcart heaped with potted blooms. Counts as two flowers.' },
  gift_hen_house: { icon: '🐓', sound: 'wood', levels: [0, 0], mats: ['paintedWood'], paint: true, matGroup: 'gift_hen_house', desc: 'A snug A-frame coop with a ramp and a straw-filled nesting box. Paint it!' },
  gift_carved_bear: { icon: '🐻', sound: 'wood', levels: [0, MAX_LEVEL], desc: 'A chunky bear carved from a log, waving from its stump.' },
  gift_rowboat: { icon: '🛶', sound: 'wood', levels: [0, 0], mats: ['paintedWood'], paint: true, matGroup: 'gift_rowboat', thumb: { r: 1 }, desc: 'A little rowboat resting on the grass, with oars and a coil of rope. Paint it!' },
  gift_honey_stand: { icon: '🍯', sound: 'wood', levels: [0, MAX_LEVEL], desc: 'A gingham-topped stand with rows of honey jars and a painted sign.' },
  gift_bread_oven: { icon: '🥖', sound: 'stone', levels: [0, 0], emitter: 'smoke', emitterOffset: [0, 1.3, -0.2], desc: 'A domed clay oven on a stone plinth. Its mouth glows at night.' },
  gift_festoon: { icon: '💡', sound: 'metal', levels: [0, MAX_LEVEL], desc: 'Two posts with a sagging string of warm bulbs that light up at dusk.' },
  gift_signpost: { icon: '🪧', sound: 'wood', levels: [0, MAX_LEVEL], desc: 'A timber fingerpost with three painted arrows pointing every which way.' },
  gift_gnome: { icon: '🧙', sound: 'stone', levels: [0, MAX_LEVEL], paintAlways: true, desc: 'A cheerful garden gnome with a tiny lantern. Paint the hat!' },
  gift_tea_table: { icon: '🫖', sound: 'wood', levels: [0, MAX_LEVEL], desc: 'A lace-covered table set for tea, with two little stools.' },
};

/** Gift ids unlocked on this device: the tiny mirror key and the town save's `unlocks` (§8.3). Never throws. */
export function unlockedGifts() {
  const ids = new Set();
  // blocked site data (a sandboxed frame, "block all cookies") makes even reading `localStorage` throw a
  // SecurityError: the gifts still register (hidden), whatever the storage state (§0.1 guardrail 6)
  let ls = null;
  try { ls = typeof localStorage === 'undefined' ? null : localStorage; } catch { ls = null; }
  if (!ls) return ids;
  const known = (id) => typeof id === 'string' && Object.prototype.hasOwnProperty.call(GIFTS, id);
  try {
    const a = JSON.parse(ls.getItem(KEYS.unlocks) || '[]');
    if (Array.isArray(a)) for (const id of a) if (known(id)) ids.add(id);
  } catch { /* unreadable: nothing unlocked from this key */ }
  try {
    const t = JSON.parse(ls.getItem(KEYS.town) || 'null');
    if (t && t.unlocks && typeof t.unlocks === 'object') for (const id of Object.keys(t.unlocks)) if (known(id)) ids.add(id);
  } catch { /* unreadable town save */ }
  return ids;
}

const unlocked = unlockedGifts();
for (const [id, G] of Object.entries(GIFTS)) {
  const meta = META[id] || {};
  const make = BUILD[id];
  const seats = (G.seats || []).map((s) => s.slice());
  registerPiece({
    id, name: G.name, cat: 'garden', slot: 'cell', layer: 'I', rot: 'four', contextual: true,
    hidden: !unlocked.has(id),
    gift: { job: G.job ?? null },
    walk: G.walk,
    seats,
    counts: { ...(G.counts || {}) },
    ...meta,
    contextKey: (p, ctx) => surface(p, ctx),
    build(p, ctx) {
      const root = new THREE.Group();
      const g = new THREE.Group();
      const s = surface(p, ctx);
      g.position.y = SURF_Y[s];
      root.add(g);
      make(g, p, seats);
      if (meta.emitterOffset) root.userData.emitterOffset = [meta.emitterOffset[0], SURF_Y[s] + meta.emitterOffset[1], meta.emitterOffset[2]];
      return root;
    },
  });
}
