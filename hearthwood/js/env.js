// Hearthwood — the cozy world around the lot.
//
//   * Sky: a gradient dome (shader) that follows the camera, with a sun disc + glow, a moon,
//     twinkling stars (Points) and soft billboard clouds drifting by (one draw call).
//   * Light: a HemisphereLight + one DirectionalLight that is the sun by day and the moon by night,
//     warm at golden hour, cool and dim (but readable) at night. Its shadow camera is fitted tightly
//     around what is actually built (never more than the lot), and the shadow map is only re-rendered
//     when something changes. Fog and the exposure follow the sky.
//   * Ground: one meadow mesh (mowed lot, country lane, pond shore, rolling hills ring) shaded in
//     world space, a pond with lilies & reeds, instanced trees, bushes, rocks, flowers and grass tufts —
//     all scenery stays outside the buildable lot.
//   * Seasons recolour everything; weather (rain / snow / falling leaves) is one GPU-animated Points
//     system around the camera; fireflies, butterflies and birds share another; chimney smoke is a third.
//
// Exports init(app) → { update(dt) }.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/BufferGeometryUtils.js';
import { CELL, GRID_MIN, GRID_MAX, LEVEL_H, STEP, levelY, clamp, lerp } from './config.js';

// ===================================================================== constants

const TAU = Math.PI * 2;
const LOT_LO = GRID_MIN * CELL;                       // -20
const LOT_HI = (GRID_MAX + 1) * CELL;                 //  20
const LOT_HALF = Math.max(-LOT_LO, LOT_HI);
const KEEP = LOT_HALF + 2.5;                          // scenery only where max(|x|,|z|) > KEEP
const DAY_SECONDS = 600;                              // a full day takes 10 minutes when time flows
const SKY_R = 300;
const STAR_R = 260;
const GROUND_R = 430;
const MAX_EMIT = 8;                                   // smoke emitters drawn at once
const SMOKE_PER = 22;                                 // puffs per emitter
const WEATHER_MAX = 1800;
const WX_KEYS = ['rain', 'snow', 'leaves'];
const DEFAULT_EMIT = [0, 1, 0];
const MOBILE = typeof navigator !== 'undefined' && (/Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
  || (navigator.maxTouchPoints > 1 && Math.min(screen.width, screen.height) < 900));

// Country lane (polyline, world XZ) from the lot's west edge winding off to the north-west horizon.
const LANE = [[-20.5, -2], [-28, -3.5], [-37, -8], [-46, -16], [-54, -27], [-64, -40], [-78, -52], [-96, -63],
  [-118, -78], [-144, -98], [-176, -122], [-215, -148], [-262, -176]];
// Pond (ellipse with a wobbly shore) behind the lot.
const POND = { x: -4, z: -45, rx: 9.5, rz: 6.2, rot: 0.3 };
const POND_C = Math.cos(POND.rot), POND_S = Math.sin(POND.rot);

// ===================================================================== small math kit

const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

function hash2(ix, iz, s) {
  let h = Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iz | 0, 0x165667b1) ^ Math.imul(s | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x, z, s) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, s), b = hash2(ix + 1, iz, s), c = hash2(ix, iz + 1, s), d = hash2(ix + 1, iz + 1, s);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}
function fbm(x, z, s, oct = 3) {
  let sum = 0, amp = 0.5, norm = 0;
  for (let o = 0; o < oct; o++) {
    sum += vnoise(x, z, s + o * 17) * amp; norm += amp;
    x = x * 2.03 + 11.7; z = z * 2.03 - 5.3; amp *= 0.5;
  }
  return sum / norm;
}
/** Seeded PRNG (mulberry32) → () => [0, 1). */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const t = clamp(((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz), 0, 1);
  const ex = px - (ax + dx * t), ez = pz - (az + dz * t);
  return Math.sqrt(ex * ex + ez * ez);
}
function laneDist(x, z) {
  let d = 1e9;
  for (let i = 0; i < LANE.length - 1; i++) d = Math.min(d, segDist(x, z, LANE[i][0], LANE[i][1], LANE[i + 1][0], LANE[i + 1][1]));
  return d;
}
const pondWobble = (th) => 1 + 0.1 * Math.sin(3 * th + 1) + 0.06 * Math.sin(5 * th + 2);
/** Normalised pond distance: < 1 inside the water, 1 on the shore. */
function pondS(x, z) {
  const dx = x - POND.x, dz = z - POND.z;
  const u = (dx * POND_C + dz * POND_S) / POND.rx, v = (-dx * POND_S + dz * POND_C) / POND.rz;
  return Math.sqrt(u * u + v * v) / pondWobble(Math.atan2(v, u));
}
/** World position of pond-local polar coords (s = 1 is the shore). */
function pondPoint(s, th, out) {
  const w = s * pondWobble(th), u = Math.cos(th) * w * POND.rx, v = Math.sin(th) * w * POND.rz;
  out[0] = POND.x + u * POND_C - v * POND_S;
  out[1] = POND.z + u * POND_S + v * POND_C;
  return out;
}

/** Terrain height. Exactly 0 over the lot (and a margin), gentle swells beyond, hills ringing the horizon. */
export function heightAt(x, z) {
  const sq = Math.max(Math.abs(x), Math.abs(z));
  if (sq < 26) return 0;
  const r = Math.sqrt(x * x + z * z);
  let h = smooth(26, 58, sq) * (fbm(x * 0.03, z * 0.03, 101, 2) - 0.42) * 2.2;
  const ring = smooth(66, 145, r);
  if (ring > 0) {
    const n = fbm(x * 0.011, z * 0.011, 211, 3);
    h += ring * (3 + 30 * n * n + 2.5 * Math.sin(Math.atan2(z, x) * 4 + 0.7));
  }
  h *= lerp(0.12, 1, smooth(3, 34, laneDist(x, z)));
  const ps = pondS(x, z);
  if (ps < 2.4) h *= smooth(1.2, 2.4, ps);
  return h;
}

// ===================================================================== palettes

// Sky keyframes by sun elevation (sin of the sun's altitude). At night `sun*` is the moonlight.
//  zen/hor: sky zenith & horizon · glow: sun halo & sunset band · sun/si: directional light colour & intensity
//  hs/hg/hi: hemisphere sky/ground/intensity · cl/cs: cloud lit/shade · ex: exposure · st: stars
const KEYS = [
  { y: -1.0, zen: '#060a20', hor: '#1a2248', glow: '#2b3866', sun: '#b4c0e8', si: 0.38, hs: '#56628c', hg: '#22242e', hi: 0.95, cl: '#2e3860', cs: '#141a32', ex: 1.12, st: 1 },
  { y: -0.3, zen: '#08102a', hor: '#1d2852', glow: '#2e3c70', sun: '#b4c0e8', si: 0.38, hs: '#56628c', hg: '#22242e', hi: 0.95, cl: '#323c66', cs: '#161c36', ex: 1.12, st: 1 },
  { y: -0.13, zen: '#141d4c', hor: '#40467e', glow: '#8a6a9a', sun: '#b0b8e8', si: 0.42, hs: '#6a6c9c', hg: '#2a2834', hi: 0.85, cl: '#5a5482', cs: '#262a52', ex: 1.1, st: 0.75 },
  { y: -0.03, zen: '#2f417c', hor: '#d38c7c', glow: '#ff9466', sun: '#ff9a6a', si: 0.75, hs: '#b49cc4', hg: '#54443e', hi: 1.05, cl: '#f2a28a', cs: '#5c5280', ex: 1.1, st: 0.12 },
  { y: 0.06, zen: '#5379bd', hor: '#ffb57c', glow: '#ffb25a', sun: '#ffb070', si: 1.8, hs: '#f4c8a8', hg: '#6c5a46', hi: 1.05, cl: '#ffd2a4', cs: '#a8879c', ex: 1.03, st: 0 },
  { y: 0.2, zen: '#6a9edb', hor: '#ffdcb4', glow: '#ffd48e', sun: '#ffd49a', si: 2.4, hs: '#f6e6d0', hg: '#7c7856', hi: 1.15, cl: '#fff2e0', cs: '#bcb0bc', ex: 1.0, st: 0 },
  { y: 0.45, zen: '#5c9be0', hor: '#d2e8f3', glow: '#fff4dc', sun: '#fff2df', si: 2.6, hs: '#e4f0ff', hg: '#8c9a6c', hi: 1.22, cl: '#ffffff', cs: '#c8d2de', ex: 1.0, st: 0 },
  { y: 1.0, zen: '#4f93dc', hor: '#d0e8f5', glow: '#fff6e6', sun: '#fff6ea', si: 2.7, hs: '#e4f0ff', hg: '#8c9a6c', hi: 1.22, cl: '#ffffff', cs: '#c8d2de', ex: 1.0, st: 0 },
];
const KEY_COLORS = ['zen', 'hor', 'glow', 'sun', 'hs', 'hg', 'cl', 'cs'];
const KEY_NUMS = ['si', 'hi', 'ex', 'st'];
for (const k of KEYS) for (const c of KEY_COLORS) k[c] = new THREE.Color(k[c]);

// Season looks. Albedos are sRGB hex; `hill` is a linear multiplier for high ground.
const SEASON_PAL = {
  spring: { a: '#9dcc62', b: '#77ae51', mow: '#a8d56f', dirt: '#9c7f5e', shore: '#71793f', hill: [0.92, 0.98, 0.84],
    leaf: '#f7c3d2', leafAmt: 0.1, tuft: '#8fc458', bounce: '#8faa66', rock: '#a8a297', reed: '#79a64a', water: '#438093',
    blob: '#26361c', petals: ['#f8c6d6', '#fde9ee', '#f2a7c0'] },
  summer: { a: '#8fbb58', b: '#6a9a47', mow: '#98c362', dirt: '#957657', shore: '#686c3c', hill: [0.9, 0.95, 0.8],
    leaf: '#000000', leafAmt: 0, tuft: '#80ae4b', bounce: '#86985e', rock: '#a39d92', reed: '#6f9a40', water: '#3f7a8c',
    blob: '#243418', petals: ['#7fb04a', '#a2c45a', '#5f8f3a'] },
  autumn: { a: '#b8ab5c', b: '#8f8146', mow: '#b6b36a', dirt: '#8c6c4d', shore: '#6c5e3a', hill: [1.0, 0.92, 0.78],
    leaf: '#d0702c', leafAmt: 0.55, tuft: '#b9a259', bounce: '#9a8a5a', rock: '#a29a8e', reed: '#a8904e', water: '#44707e',
    blob: '#33281a', petals: ['#e2762c', '#c9452a', '#f0b23a'] },
  winter: { a: '#f2f6f9', b: '#dfe7ef', mow: '#eaf0f5', dirt: '#ab9d8f', shore: '#d2dbe1', hill: [1.0, 1.0, 1.0],
    leaf: '#000000', leafAmt: 0, tuft: '#dfe6e2', bounce: '#c4ccd6', rock: '#b9b6b2', reed: '#cbb88a', water: '#d4e6ee',
    blob: '#3c4864', petals: ['#8a6a4a', '#a7865a', '#6e5238'] },
};

// ===================================================================== textures (generated once)

function dataTex(data, w, h) {
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

/** 2×2 atlas of fluffy clouds: R = self-shadowing light (top lit), A = coverage. */
function makeCloudTexture() {
  const S = 128, W = 256;
  const data = new Uint8Array(W * W * 4);
  const R = rng(4242);
  for (let v = 0; v < 4; v++) {
    const ox = (v % 2) * S, oy = Math.floor(v / 2) * S;
    const blobs = [];
    const n = 6 + Math.floor(R() * 4);
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n, mid = 1 - Math.abs(t - 0.5) * 2;
      const r = 0.075 + 0.085 * mid + R() * 0.04;
      blobs.push([0.17 + t * 0.66 + (R() - 0.5) * 0.05, 0.4 + r * 0.6 + R() * 0.04, r]);
    }
    for (let i = 0; i < 3; i++) { const r = 0.08 + R() * 0.06; blobs.push([0.32 + R() * 0.36, 0.52 + R() * 0.1, r]); }
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const px = (x + 0.5) / S, py = (y + 0.5) / S;
        let dens = 0, light = 0;
        for (const [cx, cy, r] of blobs) {
          const dx = (px - cx) / r, dy = (py - cy) / r;
          const w = Math.exp(-(dx * dx + dy * dy) * 1.7);
          dens += w;
          light += w * clamp(0.5 + 0.6 * dy, 0, 1);
        }
        const fl = (fbm(px * 10 + v * 7, py * 10, 61, 3) - 0.5) * 0.55;
        let a = smooth(0.3, 0.8, dens + fl) * smooth(0.36, 0.45, py);
        a *= smooth(0.0, 0.06, px) * smooth(1.0, 0.94, px) * smooth(1.0, 0.94, py);
        const L = dens > 1e-4 ? clamp(light / dens + (py - 0.5) * 0.25, 0, 1) : 0.5;
        const i4 = ((oy + y) * W + ox + x) * 4;
        data[i4] = data[i4 + 1] = data[i4 + 2] = Math.round(L * 255);
        data[i4 + 3] = Math.round(a * 255);
      }
    }
  }
  return dataTex(data, W, W);
}

/** Soft lumpy puff for smoke: R = light, A = coverage. */
function makePuffTexture() {
  const S = 64, data = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const px = (x + 0.5) / S - 0.5, py = (y + 0.5) / S - 0.5;
      const d = Math.sqrt(px * px + py * py) * 2;
      const n = fbm(px * 6 + 3, py * 6 + 3, 71, 3);
      const a = smooth(1.0, 0.35, d + (n - 0.5) * 0.5);
      const L = clamp(0.78 + py * 0.5 + (n - 0.5) * 0.2, 0, 1);
      const i4 = (y * S + x) * 4;
      data[i4] = data[i4 + 1] = data[i4 + 2] = Math.round(L * 255);
      data[i4 + 3] = Math.round(a * 255);
    }
  }
  return dataTex(data, S, S);
}

/** Radial soft shadow blob for the foot of trees. */
function makeBlobTexture() {
  const S = 64, data = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const px = (x + 0.5) / S - 0.5, py = (y + 0.5) / S - 0.5;
      const d = Math.sqrt(px * px + py * py) * 2;
      const a = Math.pow(smooth(1.0, 0.0, d), 1.6);
      const i4 = (y * S + x) * 4;
      data[i4] = data[i4 + 1] = data[i4 + 2] = 255;
      data[i4 + 3] = Math.round(a * 255);
    }
  }
  return dataTex(data, S, S);
}

// ===================================================================== geometry builders

/** Double-sided foliage lit like the ground: keep the (upward) normal on back faces too. */
function upNormals(m, key) {
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>',
      THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', ''));
  };
  m.customProgramCacheKey = () => key;
  return m;
}

/** Tiny vertex-coloured triangle soup builder (normals point up: lit like the ground). */
class Soup {
  constructor() { this.p = []; this.c = []; this.n = []; }
  tri(ax, ay, az, bx, by, bz, cx, cy, cz, ca, cb = ca, cc = ca, up = true) {
    this.p.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    this.c.push(ca.r, ca.g, ca.b, cb.r, cb.g, cb.b, cc.r, cc.g, cc.b);
    if (up) this.n.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
    else {
      const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
      if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
      this.n.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
    }
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.computeBoundingSphere();
    return g;
  }
}

/** Round deciduous canopy: overlapping smooth blobs, unit radius ≈ 1.3, base near y = -0.9.
 *  The far version (distant tree lines) uses three blobs instead of five. */
function canopyGeo(far = false) {
  const parts = far
    ? [[0, 0.02, 0, 1.06], [0.55, -0.16, 0.2, 0.78], [-0.5, -0.1, -0.26, 0.8]]
    : [[0, 0, 0, 1], [0.62, -0.18, 0.22, 0.72], [-0.55, -0.12, -0.28, 0.74], [0.08, 0.5, -0.12, 0.7], [-0.2, -0.2, 0.6, 0.62]];
  const geos = parts.map(([x, y, z, r]) => {
    const g = far ? new THREE.SphereGeometry(r, 7, 5) : new THREE.IcosahedronGeometry(r, 1);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 3 * r, uv.getY(i) * 1.6 * r);
    g.translate(x, y, z);
    return g;
  });
  const g = mergeGeometries(geos, false);
  geos.forEach((x) => x.dispose());
  return g;
}

/** Stylized pine: three stacked cones, unit height (0..1), unit-ish radius 0.5. */
function pineGeo() {
  const tiers = [[0.0, 0.56, 0.5], [0.26, 0.8, 0.4], [0.5, 1.0, 0.27]];
  const geos = tiers.map(([y0, y1, r], i) => {
    const g = new THREE.ConeGeometry(r, y1 - y0, 8, 1, i > 0);   // upper tiers' bases hide inside the tier below
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 3, uv.getY(i) * 2);
    g.translate(0, (y0 + y1) / 2, 0);
    return g;
  });
  const g = mergeGeometries(geos, false);
  geos.forEach((x) => x.dispose());
  return g;
}

function trunkGeo() {
  const g = new THREE.CylinderGeometry(0.15, 0.24, 1, 7, 1, true);
  g.translate(0, 0.5, 0);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 1.2, uv.getY(i) * 2);
  return g;
}

function rockGeo() {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 0.78 + 0.42 * hash2(Math.round(x * 997), Math.round(y * 991) + Math.round(z * 983) * 7, 9);
    p.setXYZ(i, x * k, Math.max(y * k * 0.62, -0.2), z * k);
  }
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  return g;
}

/** A tussock of grass blades (grey ramp, tinted per instance). */
function tuftGeo() {
  const S = new Soup(), R = rng(31);
  const lo = new THREE.Color(0.5, 0.5, 0.5), hi = new THREE.Color(1, 1, 1);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * TAU + R() * 0.6, lean = 0.12 + R() * 0.2, h = 0.6 + R() * 0.45, w = 0.045 + R() * 0.03;
    const ca = Math.cos(a), sa = Math.sin(a), bx = ca * 0.06, bz = sa * 0.06;
    const px = -sa * w, pz = ca * w;
    S.tri(bx - px, 0, bz - pz, bx + px, 0, bz + pz, bx + ca * lean, h, bz + sa * lean, lo, lo, hi);
  }
  return S.geometry();
}

/** A clump of wildflowers: stems + five-petal heads in mixed colours. */
function flowerGeo() {
  const S = new Soup(), R = rng(77);
  const COLORS = ['#f07a9c', '#f7cf3c', '#ffffff', '#a77fe0', '#f2724a', '#f59ab8', '#7fb0f0', '#ffffff', '#f7cf3c'].map((c) => new THREE.Color(c));
  const stem = new THREE.Color('#5f8a3c'), eye = new THREE.Color('#f0a92a');
  for (let i = 0; i < 10; i++) {
    const a = R() * TAU, r = Math.sqrt(R()) * 0.5;
    const x = Math.cos(a) * r, z = Math.sin(a) * r, h = 0.2 + R() * 0.28;
    const sa = R() * Math.PI, sx = Math.cos(sa) * 0.02, sz = Math.sin(sa) * 0.02;
    S.tri(x - sx, 0, z - sz, x + sx, 0, z + sz, x, h, z, stem);
    const pc = COLORS[(R() * COLORS.length) | 0], pr = 0.1 + R() * 0.05, rot = R() * TAU;
    for (let k = 0; k < 5; k++) {
      const a0 = rot + (k / 5) * TAU - 0.5, a1 = rot + (k / 5) * TAU + 0.5;
      S.tri(x, h + 0.005, z, x + Math.cos(a0) * pr, h + 0.02, z + Math.sin(a0) * pr, x + Math.cos(a1) * pr, h + 0.02, z + Math.sin(a1) * pr, eye, pc, pc);
    }
  }
  return S.geometry();
}

// ===================================================================== shaders

const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const SKY_FRAG = /* glsl */`
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGlow;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform float uSunAmt;
uniform float uBand;
uniform vec3 uMoonDir;
uniform vec3 uMoonCol;
uniform float uMoonAmt;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = d.y, hp = max(h, 0.0);
  vec3 col = mix(uHorizon, uZenith, pow(smoothstep(0.0, 1.0, hp), 0.6));
  // warm band hugging the horizon on the sun's side (sunrise / sunset)
  vec2 dh = normalize(d.xz + vec2(1e-4, 0.0));
  vec2 sh = normalize(uSunDir.xz + vec2(1e-4, 0.0));
  float side = dot(dh, sh) * 0.5 + 0.5;
  col = mix(col, uGlow, clamp(pow(side, 2.2) * exp(-hp * 5.5) * uBand, 0.0, 0.85));
  // sun halo + disc
  float sd = max(dot(d, uSunDir), 0.0);
  col += uGlow * (pow(sd, 12.0) * 0.22 + pow(sd, 160.0) * 0.55) * uSunAmt;
  col = mix(col, uSunCol, smoothstep(0.99962, 0.99976, sd) * uSunAmt);
  // moon: a softly shaded gibbous disc with a halo
  float md = dot(d, uMoonDir);
  col += uMoonCol * pow(max(md, 0.0), 90.0) * 0.14 * uMoonAmt;
  if (md > 0.995 && uMoonAmt > 0.0) {
    vec3 mr = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)));
    vec3 mu = cross(mr, uMoonDir);
    vec2 mp = vec2(dot(d, mr), dot(d, mu)) / 0.034;
    float r2 = dot(mp, mp);
    float disc = 1.0 - smoothstep(0.86, 1.0, r2);
    vec3 n = vec3(mp, sqrt(max(1.0 - r2, 0.0)));
    float lit = smoothstep(-0.2, 0.3, dot(n, normalize(vec3(-0.7, 0.25, 0.6))));
    float mare = 0.86 + 0.14 * sin(mp.x * 4.0 + 1.3) * sin(mp.y * 3.3 - 0.4) - 0.1 * smoothstep(0.25, 0.0, length(mp - vec2(0.25, 0.2)));
    vec3 mc = uMoonCol * mix(0.16, 1.0, lit) * mare;
    col = mix(col, mc, disc * uMoonAmt);
  }
  // below the horizon: the haze colour (fog matches it, so distant ground melts away)
  col = mix(col, uHorizon, smoothstep(0.0, -0.03, h));
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

const STAR_VERT = /* glsl */`
attribute float aSize;
attribute float aPhase;
uniform float uTime;
uniform float uAmt;
uniform float uPR;
varying float vA;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float tw = 0.6 + 0.4 * sin(uTime * (1.3 + aPhase * 2.2) + aPhase * 40.0);
  vA = uAmt * tw * smoothstep(0.03, 0.22, normalize(position).y);
  gl_PointSize = aSize * uPR;
}`;

const STAR_FRAG = /* glsl */`
varying float vA;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = vA * smoothstep(0.5, 0.05, d);
  if (a < 0.004) discard;
  gl_FragColor = vec4(vec3(1.0, 0.96, 0.86) * a * 1.3, a);
  #include <colorspace_fragment>
}`;

const CLOUD_VERT = /* glsl */`
attribute vec2 aCorner;
attribute vec4 aInfo;   // size, atlas index, aspect, coverage rank
uniform float uDrift;
uniform float uCover;
uniform vec3 uCam;
varying vec2 vUv;
varying float vA;
void main() {
  vec3 c = position;
  c.x = mod(c.x + uDrift + 280.0, 560.0) - 280.0;
  float fade = 1.0 - smoothstep(235.0, 275.0, length(c.xz));
  vec4 mv = modelViewMatrix * vec4(c, 1.0);
  mv.xy += aCorner * vec2(aInfo.x, aInfo.x * aInfo.z);
  gl_Position = projectionMatrix * mv;
  vUv = (vec2(mod(aInfo.y, 2.0), floor(aInfo.y / 2.0)) + aCorner + 0.5) * 0.5;
  float elev = normalize(c - uCam).y;
  vA = fade * smoothstep(0.0, 0.08, elev) * smoothstep(aInfo.w - 0.12, aInfo.w, uCover);
}`;

const CLOUD_FRAG = /* glsl */`
uniform sampler2D uTex;
uniform vec3 uLit;
uniform vec3 uShade;
uniform float uOpacity;
varying vec2 vUv;
varying float vA;
void main() {
  vec4 t = texture2D(uTex, vUv);
  float a = t.a * vA * uOpacity;
  if (a < 0.01) discard;
  gl_FragColor = vec4(mix(uShade, uLit, t.r), a);
  #include <colorspace_fragment>
}`;

// Weather: one Points system, positions animated on the GPU and wrapped in a box around the view.
const WX_VERT = /* glsl */`
attribute vec4 aSeed;
uniform vec3 uCenter;
uniform vec3 uBox;
uniform float uTime;
uniform float uFall;
uniform float uSway;
uniform vec2 uWind;
uniform float uSize;
uniform float uScale;
varying vec4 vS;
varying float vRot;
void main() {
  vec3 p = aSeed.xyz * uBox;
  float k = 0.75 + 0.5 * aSeed.w;
  p.y -= uTime * uFall * k;
  p.xz += uWind * uTime * k;
  p.x += sin(uTime * (0.7 + aSeed.w) + aSeed.x * 40.0) * uSway;
  p.z += cos(uTime * (0.6 + aSeed.y) + aSeed.z * 40.0) * uSway;
  p = uCenter + mod(p - uCenter + uBox * 0.5, uBox) - uBox * 0.5;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = min(uSize * (0.7 + 0.6 * aSeed.w) * uScale / max(-mv.z, 0.5), 150.0);
  vS = aSeed;
  vRot = uTime * (1.0 + aSeed.y * 3.0) + aSeed.z * 6.28;
}`;

const WX_FRAG = /* glsl */`
uniform float uKind;     // 0 rain, 1 snow, 2 leaves
uniform float uAlpha;
uniform float uLight;
uniform vec3 uLeaf0;
uniform vec3 uLeaf1;
uniform vec3 uLeaf2;
varying vec4 vS;
varying float vRot;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  vec3 col;
  float a;
  if (uKind < 0.5) {
    p.x += p.y * 0.18;                                    // a little wind slant
    a = (1.0 - smoothstep(0.012, 0.04, abs(p.x))) * smoothstep(0.5, 0.15, abs(p.y)) * 0.5;
    col = vec3(0.78, 0.83, 0.9);
  } else if (uKind < 1.5) {
    a = smoothstep(0.5, 0.18, length(p)) * 0.95;
    col = vec3(1.0);
  } else {
    float c = cos(vRot), s = sin(vRot);
    vec2 q = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
    float e = (q.x * q.x) / 0.19 + (q.y * q.y) / (0.045 * (1.0 - q.x * q.x * 3.0) + 0.002);
    a = 1.0 - smoothstep(0.8, 1.0, e);
    col = vS.w < 0.33 ? uLeaf0 : (vS.w < 0.66 ? uLeaf1 : uLeaf2);
    col *= 0.75 + 0.3 * sin(vRot * 1.7) + 0.15 * (1.0 - smoothstep(0.0, 0.02, abs(q.y)));
  }
  a *= uAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(col * uLight, a);
  #include <colorspace_fragment>
}`;

// Ambient life: 0 = firefly, 1 = butterfly, 2 = bird. Premultiplied output: fireflies add light.
const LIFE_VERT = /* glsl */`
attribute vec3 aCenter;
attribute vec4 aSeed;
attribute float aType;
uniform float uTime;
uniform float uScale;
uniform float uFire;
uniform float uFly;
uniform float uBird;
varying float vType;
varying vec4 vS;
varying float vFlap;
varying float vA;
void main() {
  vec3 p = aCenter;
  float t = uTime, sz = 0.2;
  vFlap = 0.0;
  if (aType < 0.5) {
    p += vec3(sin(t * 0.31 + aSeed.x * 30.0) * 2.6, sin(t * 0.73 + aSeed.y * 30.0) * 0.5, cos(t * 0.27 + aSeed.z * 30.0) * 2.6);
    float pulse = pow(0.5 + 0.5 * sin(t * (1.4 + aSeed.w * 1.4) + aSeed.x * 50.0), 3.0);
    vA = uFire * (0.15 + 0.85 * pulse);
    sz = 0.5;
  } else if (aType < 1.5) {
    float a = t * (0.3 + 0.25 * aSeed.w) + aSeed.x * 6.28;
    float rr = 1.6 + aSeed.y * 2.2;
    p += vec3(cos(a) * rr + sin(a * 2.3) * 0.7, 0.45 + sin(t * 1.9 + aSeed.z * 9.0) * 0.3 + sin(a * 3.1) * 0.2, sin(a) * rr);
    vFlap = abs(sin(t * 11.0 + aSeed.z * 20.0));
    vA = uFly;
    sz = 0.3;
  } else {
    float a = t * 0.06 + aSeed.x * 0.22;
    p = vec3(cos(a) * 58.0 - 15.0, 21.0 + aSeed.y * 6.0, sin(a) * 58.0 - 15.0) + aCenter;
    p.y += sin(t * 0.9 + aSeed.z * 6.0) * 0.9;
    vFlap = sin(t * (5.5 + aSeed.w * 2.5) + aSeed.z * 10.0);
    vA = uBird;
    sz = 1.3;
  }
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = vA > 0.002 ? clamp(sz * uScale / max(-mv.z, 0.5), 2.0, 64.0) : 0.0;
  vType = aType;
  vS = aSeed;
}`;

const LIFE_FRAG = /* glsl */`
varying float vType;
varying vec4 vS;
varying float vFlap;
varying float vA;
void main() {
  vec2 q = (gl_PointCoord - 0.5) * 2.0;
  q.y = -q.y;
  if (vType < 0.5) {
    float d = length(q);
    float core = smoothstep(1.0, 0.0, d);
    float glow = core * core * (0.35 + 0.65 * smoothstep(0.35, 0.0, d));
    vec3 c = vec3(1.0, 0.92, 0.45) * glow * vA * 1.4;
    gl_FragColor = vec4(c, 0.0);
  } else if (vType < 1.5) {
    float w = 0.2 + 0.8 * vFlap;
    vec2 p = vec2(abs(q.x) / w, q.y);
    float up = length((p - vec2(0.48, 0.22)) / vec2(0.48, 0.42));
    float lo = length((p - vec2(0.36, -0.32)) / vec2(0.34, 0.3));
    float wing = 1.0 - smoothstep(0.85, 1.0, min(up, lo));
    float body = (1.0 - smoothstep(0.06, 0.1, abs(q.x))) * (1.0 - smoothstep(0.5, 0.6, abs(q.y)));
    vec3 c = vS.w < 0.25 ? vec3(1.0, 0.98, 0.92) : (vS.w < 0.5 ? vec3(1.0, 0.86, 0.3) : (vS.w < 0.75 ? vec3(0.98, 0.6, 0.25) : vec3(0.55, 0.72, 1.0)));
    c *= 0.85 + 0.15 * (1.0 - up);
    float a = max(wing, body) * vA;
    vec3 col = mix(c, vec3(0.2, 0.16, 0.14), body);
    if (a < 0.01) discard;
    gl_FragColor = vec4(col * a, a);
  } else {
    float lift = 0.08 + 0.34 * vFlap;
    vec2 p = vec2(abs(q.x), q.y + 0.1);
    vec2 b = vec2(0.92, lift);
    float h = clamp(dot(p, b) / dot(b, b), 0.0, 1.0);
    float d = length(p - b * h);
    float a = (1.0 - smoothstep(0.07, 0.13, d)) * vA;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vec3(0.22, 0.22, 0.27) * a, a);
  }
  #include <colorspace_fragment>
}`;

// Chimney smoke: particle i belongs to emitter (i % 8); emitter positions come in as uniforms.
const SMOKE_VERT = /* glsl */`
attribute vec4 aSeed;
attribute float aIdx;
uniform vec4 uEmit[${MAX_EMIT}];
uniform float uTime;
uniform vec2 uWind;
uniform float uScale;
varying float vA;
varying float vRot;
void main() {
  vec4 e = uEmit[int(aIdx)];
  float life = 7.0 + aSeed.y * 2.0;
  float age = fract(uTime / life + aSeed.x);
  vec3 p = e.xyz;
  p.y += age * 4.2 + age * age * 1.2;
  p.x += uWind.x * age * age * 5.0 + sin(uTime * 0.6 + aSeed.y * 6.28) * 0.3 * age;
  p.z += uWind.y * age * age * 5.0 + cos(uTime * 0.5 + aSeed.z * 6.28) * 0.3 * age;
  float size = mix(0.35, 2.3, sqrt(age)) * (0.8 + 0.4 * aSeed.w);
  vA = e.w * smoothstep(0.0, 0.07, age) * (1.0 - smoothstep(0.4, 1.0, age));
  vRot = aSeed.z * 6.28 + age * (aSeed.w - 0.5) * 2.0;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = vA > 0.002 ? min(size * uScale / max(-mv.z, 0.5), 220.0) : 0.0;
}`;

const SMOKE_FRAG = /* glsl */`
uniform sampler2D uTex;
uniform vec3 uCol;
uniform vec3 uShade;
uniform float uOpacity;
varying float vA;
varying float vRot;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  p.y = -p.y;
  float c = cos(vRot), s = sin(vRot);
  vec2 q = vec2(c * p.x - s * p.y, s * p.x + c * p.y) + 0.5;
  vec4 t = texture2D(uTex, q);
  float a = t.a * vA * uOpacity;
  if (a < 0.01) discard;
  gl_FragColor = vec4(mix(uShade, uCol, t.r), a);
  #include <colorspace_fragment>
}`;

// Ground: world-space shading on top of the shared grass texture.
const GROUND_HEAD = /* glsl */`
varying vec3 vGW;
uniform vec3 uGrassA;
uniform vec3 uGrassB;
uniform vec3 uMowed;
uniform vec3 uDirt;
uniform vec3 uShore;
uniform vec3 uHill;
uniform vec3 uLeafCol;
uniform float uLeafAmt;
uniform float uNightG;
uniform float uTexAmt;
uniform float uWet;
uniform vec2 uLane[${LANE.length}];
uniform vec4 uPond;
uniform vec2 uPondRot;
float gHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float gNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(gHash(i), gHash(i + vec2(1.0, 0.0)), u.x), mix(gHash(i + vec2(0.0, 1.0)), gHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float gLane(vec2 p) {
  float d = 1e4;
  for (int i = 0; i < ${LANE.length - 1}; i++) {
    vec2 a = uLane[i], ba = uLane[i + 1] - a, pa = p - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    d = min(d, length(pa - ba * h));
  }
  return d;
}
float gPond(vec2 p) {
  vec2 q = p - uPond.xy;
  q = vec2(q.x * uPondRot.x + q.y * uPondRot.y, -q.x * uPondRot.y + q.y * uPondRot.x) / uPond.zw;
  float th = atan(q.y, q.x);
  return length(q) / (1.0 + 0.1 * sin(3.0 * th + 1.0) + 0.06 * sin(5.0 * th + 2.0));
}`;

const GROUND_BODY = /* glsl */`
{
  vec2 wp = vGW.xz;
  diffuseColor.rgb = mix(vec3(0.9), diffuseColor.rgb, uTexAmt);
  float nA = gNoise(wp * 0.03);
  float nB = gNoise(wp * 0.13 + 17.0);
  float nC = gNoise(wp * 0.8 + 5.0);
  vec3 g = mix(uGrassA, uGrassB, smoothstep(0.25, 0.8, nA * 0.6 + nB * 0.4) * 0.8);
  // the lot: a softly mown lawn with faint one-cell stripes and rounded, ragged edges
  vec2 lq = abs(wp) - vec2(${(LOT_HALF - 2).toFixed(1)});
  float lotD = length(max(lq, 0.0)) + min(max(lq.x, lq.y), 0.0) - 3.0;
  float mow = 1.0 - smoothstep(-0.5, 2.5, lotD + (nB - 0.5) * 2.5);
  float stripe = step(0.5, fract(wp.x * ${(1 / (2 * CELL)).toFixed(4)})) - 0.5;
  g = mix(g, uMowed * (1.0 + stripe * 0.05 + (nC - 0.5) * 0.06), mow);
  g *= mix(vec3(1.0), uHill, smoothstep(1.0, 22.0, vGW.y));
  if (uLeafAmt > 0.0) {
    float lf = smoothstep(0.68, 0.8, gNoise(wp * 2.3 + 3.0)) * (0.35 + 0.65 * nB) * (1.0 - 0.6 * mow);
    g = mix(g, uLeafCol * (0.8 + 0.4 * nC), lf * uLeafAmt);
  }
  float ps = gPond(wp);
  g = mix(g, uShore * (0.85 + 0.3 * nC), (1.0 - smoothstep(1.0, 1.32, ps)) * 0.85);
  if (wp.x < ${(LOT_LO + 6).toFixed(1)} && wp.y < 8.0) {
    float ld = gLane(wp) + (nC - 0.5) * 0.45;
    float lane = (1.0 - smoothstep(1.1, 1.7, ld)) * smoothstep(${(LOT_LO + 0.5).toFixed(1)}, ${(LOT_LO - 1.5).toFixed(1)}, wp.x);
    float strip = 1.0 - smoothstep(0.2, 0.42, ld);
    vec3 dirt = uDirt * (0.8 + 0.38 * nC);
    g = mix(g, mix(dirt, g * 0.92, strip * 0.8), lane);
  }
  g *= 1.0 - uWet;
  g = mix(g, vec3(dot(g, vec3(0.3, 0.59, 0.11))) * vec3(0.78, 0.9, 1.3), uNightG);
  diffuseColor.rgb *= g;
}`;

// ===================================================================== the environment

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _c = new THREE.Color();
const _c2 = new THREE.Color();
const _box = new THREE.Box3();
const _sz = new THREE.Vector2();
const _e = new THREE.Euler();

class Env {
  constructor(app) {
    this.app = app;
    this.mats = app.materials;
    const { scene, renderer, state } = app;
    this.root = new THREE.Group();
    this.root.name = 'environment';
    scene.add(this.root);

    // r187 removed PCFSoftShadowMap; PCF with a radius gives the soft look without the warning.
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = true;

    this.fog = scene.fog && scene.fog.isFog ? scene.fog : new THREE.Fog(0xcfe6ee, 70, 300);
    scene.fog = this.fog;
    this.bg = new THREE.Color(0xcfe6ee);
    scene.background = this.bg;

    // live values
    this.t = Number.isFinite(state.time) ? ((state.time % 1) + 1) % 1 : 0.42;
    this.clock = 0;
    this.flowAcc = 0;
    this.selfTime = false;
    this.night = -1;
    this.nightApplied = -1;
    this.sunDir = new THREE.Vector3(0, 1, 0);
    this.moonDir = new THREE.Vector3(0, 1, 0);
    this.moonLight = new THREE.Vector3(0, 1, 0);
    this.lightDir = new THREE.Vector3(0.3, 0.9, 0.3).normalize(); // applied (shadow-casting) light direction
    this.wantDir = new THREE.Vector3(0, 1, 0);
    this.lastSkyT = -1;
    this.skyDirty = true;
    this.wx = { rain: 0, snow: 0, leaves: 0 };        // smoothed weather amounts
    this.wxGoal = { rain: 0, snow: 0, leaves: 0 };
    this.bounce = new THREE.Color();
    this.wxKind = -1;
    this.wxShown = 0;
    this.season = state.season;
    this.seasonPal = SEASON_PAL[state.season] || SEASON_PAL.summer;
    this.density = 1;
    this.casterMin = new THREE.Vector3(-6, 0, -6);
    this.casterMax = new THREE.Vector3(6, 6, 6);
    this.casterTimer = 0;
    this.shadowHot = 1;
    this.shadowTick = 0;
    this.emitters = [];
    this.slotEntry = new Array(MAX_EMIT).fill(null);
    this.slotFade = new Float32Array(MAX_EMIT);
    this.mix = {};                                    // interpolated palette (colours + numbers)
    for (const c of KEY_COLORS) this.mix[c] = new THREE.Color();
    this.ovZen = new THREE.Color();
    this.ovHor = new THREE.Color();

    this._buildLights();
    this._buildSky();
    this._buildStars();
    this._buildClouds();
    this._buildGround();
    this._buildWater();
    this._buildScenery();
    this._buildWeather();
    this._buildLife();
    this._buildSmoke();

    // dev: ?weather=rain
    const pw = app.params?.get?.('weather');
    if (pw && ['clear', 'rain', 'snow', 'leaves'].includes(pw)) state.set({ weather: pw });

    this.applySeason();
    this.applyQuality();
    this._snapWeather();
    this._updateSky();
    this._scanEmitters();

    state.on((changed) => this._onState(changed));
    app.events.on('world-change', (d) => this._onWorldChange(d));
    app.events.on('placed', () => { this.shadowHot = 1.5; });
  }

  // ------------------------------------------------------------------ lights & shadows

  _buildLights() {
    const { state } = this.app;
    this.hemi = new THREE.HemisphereLight(0xe4f0ff, 0x8c9a6c, 1.3);
    this.sun = new THREE.DirectionalLight(0xfff2df, 2.8);
    this.sun.castShadow = !!state.shadows;
    const sh = this.sun.shadow;
    sh.mapSize.set(2048, 2048);
    sh.normalBias = 0.035;
    sh.radius = 2;
    sh.camera.near = 1;
    sh.camera.far = 200;
    this.sun.target.position.set(0, 0, 0);
    this.root.add(this.hemi, this.sun, this.sun.target);
  }

  /** Fit the sun's orthographic shadow camera around the caster box as seen from the light. */
  _fitShadow() {
    const d = this.lightDir, D = 120;
    // light view basis (as Matrix4.lookAt(eye, target, up) builds it): z = d, x = up × z, y = z × x
    let xx = d.z, xz = -d.x;
    const xl = Math.hypot(xx, xz);
    if (xl < 1e-6) { xx = 1; xz = 0; } else { xx /= xl; xz /= xl; }
    const yx = d.y * xz, yy = d.z * xx - d.x * xz, yz = -d.y * xx;
    const ex = d.x * D, ey = d.y * D, ez = d.z * D;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    const mn = this.casterMin, mx = this.casterMax;
    for (let i = 0; i < 8; i++) {
      const cx = (i & 1 ? mx.x : mn.x) - ex, cy = (i & 2 ? mx.y : mn.y) - ey, cz = (i & 4 ? mx.z : mn.z) - ez;
      const vx = cx * xx + cz * xz, vy = cx * yx + cy * yy + cz * yz, vz = cx * d.x + cy * d.y + cz * d.z;
      if (vx < x0) x0 = vx; if (vx > x1) x1 = vx;
      if (vy < y0) y0 = vy; if (vy > y1) y1 = vy;
      if (vz < z0) z0 = vz; if (vz > z1) z1 = vz;
    }
    const cam = this.sun.shadow.camera;
    cam.left = x0; cam.right = x1; cam.bottom = y0; cam.top = y1;
    cam.near = Math.max(0.5, -z1 - 2);
    cam.far = -z0 + 45;                       // long shadows may fall beyond the caster box
    cam.updateProjectionMatrix();
    const range = cam.far - cam.near;
    const sh = this.sun.shadow;
    sh.bias = -0.012 / range;
    const texel = Math.max(x1 - x0, y1 - y0) / sh.mapSize.x;
    sh.radius = clamp(0.045 / texel, 1.2, 3.5);
    sh.normalBias = clamp(texel * 1.6, 0.02, 0.05);
    this.sun.position.set(ex, ey, ez);
    this.shadowHot = Math.max(this.shadowHot, 0.05);
  }

  /** Bounds of everything built, clamped to the lot (plus a margin for eaves and tall things). */
  _computeCasterBox() {
    const world = this.app.world;
    world.root.updateMatrixWorld(true);
    _box.makeEmpty();
    for (const e of world.entries.values()) if (e.obj) _box.expandByObject(e.obj);
    if (_box.isEmpty()) _box.min.set(-6, 0, -6), _box.max.set(6, 6, 6);
    const L = LOT_HALF + 3;
    this.casterMin.set(Math.max(_box.min.x - 0.8, -L), Math.max(_box.min.y - 0.3, -0.5), Math.max(_box.min.z - 0.8, -L));
    this.casterMax.set(Math.min(_box.max.x + 0.8, L), Math.min(Math.max(_box.max.y + 0.5, 3), 26), Math.min(_box.max.z + 0.8, L));
    this._fitShadow();
  }

  _onWorldChange(d) {
    this._scanEmitters();
    this.shadowHot = 1.5;
    // grow the caster box right away (conservatively) and re-measure once pop-in tweens settle
    const p = d && d.p;
    if (p && d.kind === 'add') {
      const L = LOT_HALF + 3;
      const top = levelY(p.y || 0) + LEVEL_H + (p.h || 0) * STEP + 6;
      const mn = this.casterMin, mx = this.casterMax;
      mn.x = Math.max(Math.min(mn.x, p.x * CELL - 3), -L); mn.z = Math.max(Math.min(mn.z, p.z * CELL - 3), -L);
      mx.x = Math.min(Math.max(mx.x, (p.x + 1) * CELL + 3), L); mx.z = Math.min(Math.max(mx.z, (p.z + 1) * CELL + 3), L);
      mx.y = Math.min(Math.max(mx.y, top), 26); mn.y = Math.min(mn.y, -0.5);
      this._fitShadow();
    }
    this.casterTimer = 0.6;
  }

  // ------------------------------------------------------------------ sky, stars, clouds

  _buildSky() {
    this.skyU = {
      uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uGlow: { value: new THREE.Color() },
      uSunDir: { value: this.sunDir }, uSunCol: { value: new THREE.Color(1, 0.97, 0.9) }, uSunAmt: { value: 1 }, uBand: { value: 0 },
      uMoonDir: { value: this.moonDir }, uMoonCol: { value: new THREE.Color(0.95, 0.95, 0.88) }, uMoonAmt: { value: 0 },
    };
    const m = new THREE.ShaderMaterial({
      uniforms: this.skyU, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG,
      side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(SKY_R, 32, 16), m);
    this.sky.name = 'sky';
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1000;
    this.root.add(this.sky);
  }

  _buildStars() {
    const N = 720, R = rng(9001);
    const pos = new Float32Array(N * 3), size = new Float32Array(N), phase = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const y = 0.04 + Math.pow(R(), 0.8) * 0.96, a = R() * TAU, r = Math.sqrt(1 - y * y);
      pos[i * 3] = Math.cos(a) * r * STAR_R; pos[i * 3 + 1] = y * STAR_R; pos[i * 3 + 2] = Math.sin(a) * r * STAR_R;
      size[i] = R() < 0.1 ? 3.0 + R() * 1.6 : 1.4 + R() * 1.4;
      phase[i] = R();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    g.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    this.starU = { uTime: { value: 0 }, uAmt: { value: 0 }, uPR: { value: 1 } };
    const m = new THREE.ShaderMaterial({
      uniforms: this.starU, vertexShader: STAR_VERT, fragmentShader: STAR_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    });
    this.stars = new THREE.Points(g, m);
    this.stars.name = 'stars';
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -900;
    this.starsFull = N;
    this.root.add(this.stars);
  }

  _buildClouds() {
    const R = rng(777);
    const N = 24, quads = [];
    for (let i = 0; i < N; i++) {
      const a = (i / N) * TAU + R() * 0.25, far = i % 4 !== 0;
      const r = far ? 150 + R() * 85 : 60 + R() * 80;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const y = far ? 34 + r * 0.08 + R() * 16 : 70 + R() * 30;
      const size = (far ? 44 : 36) + R() * 30, rank = R();
      // two overlapping puffs per cloud for depth
      quads.push([x, y, z, size, (R() * 4) | 0, 0.62, rank]);
      quads.push([x + (R() - 0.5) * size * 0.5, y + 3 + R() * 5, z + (R() - 0.5) * 12, size * (0.55 + R() * 0.25), (R() * 4) | 0, 0.7, rank]);
    }
    const n = quads.length, V = n * 4;
    const pos = new Float32Array(V * 3), corner = new Float32Array(V * 2), info = new Float32Array(V * 4), idx = [];
    const C = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
    quads.forEach((q, i) => {
      for (let k = 0; k < 4; k++) {
        const v = i * 4 + k;
        pos.set([q[0], q[1], q[2]], v * 3);
        corner.set(C[k], v * 2);
        info.set([q[3], q[4], q[5], q[6]], v * 4);
      }
      idx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aCorner', new THREE.BufferAttribute(corner, 2));
    g.setAttribute('aInfo', new THREE.BufferAttribute(info, 4));
    g.setIndex(idx);
    this.cloudU = {
      uTex: { value: makeCloudTexture() }, uLit: { value: new THREE.Color(1, 1, 1) }, uShade: { value: new THREE.Color(0.8, 0.82, 0.86) },
      uOpacity: { value: 0.9 }, uDrift: { value: 0 }, uCover: { value: 0.65 }, uCam: { value: new THREE.Vector3() },
    };
    const m = new THREE.ShaderMaterial({
      uniforms: this.cloudU, vertexShader: CLOUD_VERT, fragmentShader: CLOUD_FRAG,
      transparent: true, depthWrite: false, fog: false,
    });
    this.clouds = new THREE.Mesh(g, m);
    this.clouds.name = 'clouds';
    this.clouds.frustumCulled = false;
    this.clouds.renderOrder = -800;
    this.root.add(this.clouds);
  }

  /** Interpolate the sky palette for the current sun elevation, blend in weather, push to everything. */
  _updateSky() {
    const t = this.t;
    const th = (t - 0.25) * TAU;
    // the sun arcs east (+X) → south (+Z, high) → west (-X); the moon trails half a day behind
    this.sunDir.set(Math.cos(th), Math.sin(th), 0.55).normalize();
    // the moon rises at dusk in the north-east, sails low across the northern sky (so the orbit camera can
    // see it) and sets at dawn; its light falls from high in the south so fronts stay readable at night
    const tm = (((t + 0.25) % 1) - 0.02) * TAU;
    this.moonDir.set(Math.cos(tm), Math.sin(tm) * 0.26, -0.8).normalize();
    this.moonLight.set(Math.cos(tm) * 0.6, 0.85, 0.5).normalize();
    const sy = this.sunDir.y;

    // palette
    let i = 0;
    while (i < KEYS.length - 2 && sy > KEYS[i + 1].y) i++;
    const A = KEYS[i], B = KEYS[i + 1];
    const f = smooth(A.y, B.y, sy);
    const M = this.mix;
    for (const c of KEY_COLORS) M[c].lerpColors(A[c], B[c], f);
    for (const n of KEY_NUMS) M[n] = lerp(A[n], B[n], f);

    // weather: overcast greys the sky, dims the sun, pulls the fog in
    const rain = this.wx.rain, snow = this.wx.snow;
    const ov = clamp(rain + snow * 0.65, 0, 1);
    const day = smooth(-0.15, 0.25, sy);
    if (ov > 0.001) {
      const lumZ = 0.3 * M.zen.r + 0.59 * M.zen.g + 0.11 * M.zen.b;
      const lumH = 0.3 * M.hor.r + 0.59 * M.hor.g + 0.11 * M.hor.b;
      const cool = snow > rain ? 1.04 : 1.0;
      this.ovZen.setRGB(lumZ * 0.82, lumZ * 0.88, lumZ * 0.98 * cool).multiplyScalar(lerp(1, 1.25, day));
      this.ovHor.setRGB(lumH * 0.86, lumH * 0.9, lumH * 0.95 * cool);
      M.zen.lerp(this.ovZen, ov * 0.85);
      M.hor.lerp(this.ovHor, ov * 0.8);
      M.glow.lerp(M.hor, ov * 0.7);
      _c.setRGB(0.55, 0.58, 0.62).multiplyScalar(lerp(0.2, 1, day));
      M.cl.lerp(_c, ov * 0.75);
      _c.setRGB(0.36, 0.39, 0.44).multiplyScalar(lerp(0.25, 1, day));
      M.cs.lerp(_c, ov * 0.8);
      M.si *= 1 - 0.62 * ov;
      M.hi *= 1 - 0.12 * ov;
      _c.setRGB(0.78, 0.82, 0.88);
      M.hs.lerp(_c, ov * 0.6);
      M.sun.lerp(_c, ov * 0.5);
      M.ex *= 1 - 0.08 * rain;
      M.st *= 1 - ov;
    }

    // sky dome
    const U = this.skyU;
    U.uZenith.value.copy(M.zen);
    U.uHorizon.value.copy(M.hor);
    U.uGlow.value.copy(M.glow);
    U.uSunAmt.value = smooth(-0.05, 0.02, sy) * (1 - ov);
    U.uSunCol.value.setRGB(1.0, 0.97, 0.88).lerp(M.glow, 0.6 * (1 - smooth(0.04, 0.3, sy))).multiplyScalar(1.5);
    U.uBand.value = (smooth(-0.2, -0.02, sy) * (1 - smooth(0.06, 0.32, sy)) * 0.95 + 0.08) * (1 - ov * 0.8);
    const nightAmt = 1 - smooth(-0.16, 0.06, sy);
    U.uMoonAmt.value = smooth(-0.02, 0.08, this.moonDir.y) * lerp(0.12, 1, nightAmt) * (1 - ov);
    this.starU.uAmt.value = M.st;

    // fog & background follow the horizon
    this.fog.color.copy(M.hor);
    this.bg.copy(M.hor);
    this.fog.near = lerp(70, 45, ov);
    this.fog.far = lerp(310, 175, ov);

    // clouds
    this.cloudU.uLit.value.copy(M.cl);
    this.cloudU.uShade.value.copy(M.cs);
    this.cloudU.uOpacity.value = lerp(0.88, 0.97, ov);
    this.cloudU.uCover.value = lerp(0.62, 1.05, ov);

    // lights: sun by day, moon by night (with a brief dip at the hand-over so the shadow flip is soft)
    const useSun = sy > -0.035;
    const src = useSun ? this.sunDir : this.moonLight;
    const minY = useSun ? 0.26 : 0.4;
    let ly = Math.max(src.y, minY);
    const hl = Math.hypot(src.x, src.z) || 1, hs = Math.sqrt(1 - ly * ly);
    this.wantDir.set((src.x / hl) * hs, ly, (src.z / hl) * hs);
    const dip = 0.15 + 0.85 * smooth(0.0, 0.05, Math.abs(sy + 0.035));
    this.sun.color.copy(M.sun);
    this.sun.intensity = M.si * dip;
    this.hemi.color.copy(M.hs);
    _c.copy(this.bounce).multiplyScalar(lerp(0.25, 1, day));
    this.hemi.groundColor.copy(M.hg).lerp(_c, 0.35);
    this.hemi.intensity = M.hi;
    this.app.renderer.toneMappingExposure = M.ex;
    if (this.wantDir.angleTo(this.lightDir) > 0.0025 || this.lastSkyT < 0) {
      this.lightDir.copy(this.wantDir);
      this._fitShadow();
    }

    // night glow for windows & lamps (rain makes a cozy dim afternoon too)
    const night = Math.max(nightAmt, ov * 0.3 * day);
    if (Math.abs(night - this.nightApplied) > 0.002 || (night === 0) !== (this.nightApplied === 0)) {
      this.mats.setNight(night);
      this.nightApplied = night;
    }
    this.night = night;
    this.day = day;
    this.groundU.uNightG.value = nightAmt * 0.6;
    this.groundU.uWet.value = rain * (this.season === 'winter' ? 0.05 : 0.2);
    this.sun.shadow.intensity = lerp(1, 0.55, nightAmt) * (1 - 0.4 * ov);

    // water mirrors the sky a little
    if (this.waterSky) {
      this.waterSky.value.copy(M.hor).lerp(M.zen, 0.5).multiplyScalar(this.season === 'winter' ? 0.5 : 0.45);
    }
    // smoke & particle light
    if (this.smokeU) {
      // pale by day (tinted by the sky), soft moonlit grey-blue by night — never sooty
      _c2.copy(M.cl).lerp(_c.setRGB(0.92, 0.9, 0.88), 0.35);
      this.smokeU.uCol.value.setRGB(0.17, 0.19, 0.26).lerp(_c2, day);
      _c2.copy(M.cs).lerp(_c.setRGB(0.72, 0.72, 0.74), 0.3);
      this.smokeU.uShade.value.setRGB(0.08, 0.09, 0.13).lerp(_c2, day);
    }
    if (this.wxU) this.wxU.uLight.value = lerp(0.42, 1, day) * (1 - 0.18 * rain);
    this.lastSkyT = t;
    this.skyDirty = false;
  }

  // ------------------------------------------------------------------ ground & pond

  _buildGround() {
    const RADII = [0, 23, 26.5, 30, 34, 38, 43, 48, 54, 60, 67, 75, 84, 94, 105, 117, 130, 145, 162, 182, 206, 236, 272, 320, 375, GROUND_R];
    const SEG = 160, NR = RADII.length;
    const nv = 1 + (NR - 1) * SEG;
    const pos = new Float32Array(nv * 3), uv = new Float32Array(nv * 2);
    pos[0] = 0; pos[1] = 0; pos[2] = 0;
    let v = 1;
    for (let r = 1; r < NR; r++) {
      for (let s = 0; s < SEG; s++, v++) {
        const a = (s / SEG) * TAU + (r % 2) * (Math.PI / SEG);
        const x = Math.cos(a) * RADII[r], z = Math.sin(a) * RADII[r];
        pos[v * 3] = x; pos[v * 3 + 1] = heightAt(x, z); pos[v * 3 + 2] = z;
      }
    }
    for (let i = 0; i < nv; i++) { uv[i * 2] = pos[i * 3]; uv[i * 2 + 1] = -pos[i * 3 + 2]; }
    const idx = [];
    for (let s = 0; s < SEG; s++) idx.push(0, 1 + ((s + 1) % SEG), 1 + s);
    for (let r = 1; r < NR - 1; r++) {
      const a0 = 1 + (r - 1) * SEG, b0 = 1 + r * SEG;
      for (let s = 0; s < SEG; s++) {
        const s1 = (s + 1) % SEG;
        idx.push(a0 + s, a0 + s1, b0 + s, a0 + s1, b0 + s1, b0 + s);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();

    const grass = this.mats.mat('grass');
    const pal = this.seasonPal;
    this.groundU = {
      uGrassA: { value: new THREE.Color(pal.a) }, uGrassB: { value: new THREE.Color(pal.b) }, uMowed: { value: new THREE.Color(pal.mow) },
      uDirt: { value: new THREE.Color(pal.dirt) }, uShore: { value: new THREE.Color(pal.shore) }, uHill: { value: new THREE.Color().setRGB(...pal.hill) },
      uLeafCol: { value: new THREE.Color(pal.leaf) }, uLeafAmt: { value: pal.leafAmt }, uNightG: { value: 0 }, uTexAmt: { value: 1 }, uWet: { value: 0 },
      uLane: { value: LANE.map(([x, z]) => new THREE.Vector2(x, z)) },
      uPond: { value: new THREE.Vector4(POND.x, POND.z, POND.rx, POND.rz) }, uPondRot: { value: new THREE.Vector2(POND_C, POND_S) },
    };
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, map: grass.map, normalMap: grass.normalMap || null, roughness: 1, metalness: 0 });
    m.name = 'env|ground';
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.groundU);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vGW;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvGW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\n' + GROUND_HEAD)
        .replace('#include <map_fragment>', '#include <map_fragment>\n' + GROUND_BODY);
    };
    m.customProgramCacheKey = () => 'hw-env-ground';
    this.ground = new THREE.Mesh(g, m);
    this.ground.name = 'ground';
    this.ground.receiveShadow = true;
    this.root.add(this.ground);
  }

  _buildWater() {
    const SEG = 64, RINGS = [0.3, 0.62, 0.86, 1.0], shade = [0.5, 0.58, 0.74, 0.92, 1.15];
    const pos = [], col = [], uv = [], idx = [];
    const pt = [0, 0];
    pos.push(POND.x, 0.05, POND.z); col.push(shade[0], shade[0], shade[0]); uv.push(POND.x, -POND.z);
    for (let r = 0; r < RINGS.length; r++) {
      for (let s = 0; s < SEG; s++) {
        pondPoint(RINGS[r] * 1.03, (s / SEG) * TAU, pt);
        pos.push(pt[0], 0.05, pt[1]);
        col.push(shade[r + 1], shade[r + 1], shade[r + 1]);
        uv.push(pt[0], -pt[1]);
      }
    }
    for (let s = 0; s < SEG; s++) idx.push(0, 1 + ((s + 1) % SEG), 1 + s);
    for (let r = 0; r < RINGS.length - 1; r++) {
      const a0 = 1 + r * SEG, b0 = 1 + (r + 1) * SEG;
      for (let s = 0; s < SEG; s++) {
        const s1 = (s + 1) % SEG;
        idx.push(a0 + s, a0 + s1, b0 + s, a0 + s1, b0 + s1, b0 + s);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const src = this.mats.mat('water');
    let nrm = null;
    if (src.normalMap) {
      nrm = src.normalMap.clone();
      nrm.wrapS = nrm.wrapT = THREE.RepeatWrapping;
      nrm.repeat.set(0.3, 0.3);
    }
    this.waterNormal = nrm;
    this.waterMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(this.seasonPal.water), vertexColors: true, roughness: 0.16, metalness: 0,
      normalMap: nrm, normalScale: new THREE.Vector2(0.45, 0.45), emissive: new THREE.Color(0x000000),
    });
    this.waterMat.name = 'env|water';
    this.waterSky = { value: new THREE.Color(0.5, 0.7, 0.9) };
    this.waterMat.onBeforeCompile = (sh) => {
      sh.uniforms.uSkyRefl = this.waterSky;
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uSkyRefl;')
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          float fr = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 3.0);
          totalEmissiveRadiance += uSkyRefl * (0.12 + 0.88 * fr);
        }`);
    };
    this.waterMat.customProgramCacheKey = () => 'hw-env-water';
    this.water = new THREE.Mesh(g, this.waterMat);
    this.water.name = 'pond';
    this.water.receiveShadow = true;
    this.root.add(this.water);

    // lily pads & reeds: one merged, vertex-coloured mesh
    const S = new Soup(), P = new Soup(), R = rng(515);
    const pad = new THREE.Color('#5d8f45'), padDark = new THREE.Color('#4a7638'), bloom = new THREE.Color('#f5b3c8'), bloomEye = new THREE.Color('#f7dc78');
    for (let i = 0; i < 11; i++) {
      pondPoint(0.25 + R() * 0.55, R() * TAU, pt);
      const r = 0.35 + R() * 0.3, rot = R() * TAU, y = 0.075;
      const n = 11;
      for (let k = 1; k < n; k++) {                        // a notched disc
        const a0 = rot + (k / n) * TAU, a1 = rot + ((k + 1) / n) * TAU;
        P.tri(pt[0], y, pt[1], pt[0] + Math.cos(a1) * r, y, pt[1] + Math.sin(a1) * r, pt[0] + Math.cos(a0) * r, y, pt[1] + Math.sin(a0) * r, padDark, pad, pad);
      }
      if (R() < 0.45) {
        const fx = pt[0] + Math.cos(rot + 2) * r * 0.3, fz = pt[1] + Math.sin(rot + 2) * r * 0.3;
        for (let k = 0; k < 6; k++) {
          const a0 = (k / 6) * TAU, a1 = a0 + 0.7;
          P.tri(fx, y + 0.04, fz, fx + Math.cos(a0) * 0.13, y + 0.1, fz + Math.sin(a0) * 0.13, fx + Math.cos(a1) * 0.13, y + 0.1, fz + Math.sin(a1) * 0.13, bloomEye, bloom, bloom);
        }
      }
    }
    const reedLo = new THREE.Color('#4f7432'), reedHi = new THREE.Color('#9cbc62'), tail = new THREE.Color('#6a4428');
    for (let c = 0; c < 6; c++) {
      const th0 = R() * TAU;
      for (let i = 0; i < 12; i++) {
        pondPoint(0.92 + R() * 0.2, th0 + (R() - 0.5) * 0.7, pt);
        const h = 0.8 + R() * 0.9, a = R() * TAU, w = 0.035 + R() * 0.02, lean = (R() - 0.5) * 0.25;
        const px = -Math.sin(a) * w, pz = Math.cos(a) * w, tx = pt[0] + Math.cos(a) * lean, tz = pt[1] + Math.sin(a) * lean;
        S.tri(pt[0] - px, 0, pt[1] - pz, pt[0] + px, 0, pt[1] + pz, tx, h, tz, reedLo, reedLo, reedHi);
        if (R() < 0.4) {                                   // cattail head
          const hy = h * 0.8, hx = pt[0] + (tx - pt[0]) * 0.8, hz = pt[1] + (tz - pt[1]) * 0.8, ww = 0.032;
          for (const [ux, uz] of [[Math.cos(a), Math.sin(a)], [-Math.sin(a), Math.cos(a)]]) {
            S.tri(hx - ux * ww, hy - 0.15, hz - uz * ww, hx + ux * ww, hy - 0.15, hz + uz * ww, hx + ux * ww, hy + 0.13, hz + uz * ww, tail);
            S.tri(hx - ux * ww, hy - 0.15, hz - uz * ww, hx + ux * ww, hy + 0.13, hz + uz * ww, hx - ux * ww, hy + 0.13, hz - uz * ww, tail);
          }
        }
      }
    }
    this.reedMat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.9 });
    this.reedMat.name = 'env|reeds';
    upNormals(this.reedMat, 'hw-env-up');
    this.pondDecor = new THREE.Mesh(S.geometry(), this.reedMat);
    this.pondDecor.name = 'pond-reeds';
    this.root.add(this.pondDecor);
    this.padMat = upNormals(new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.6 }), 'hw-env-up');
    this.padMat.name = 'env|lilypads';
    this.pads = new THREE.Mesh(P.geometry(), this.padMat);
    this.pads.name = 'lily-pads';
    this.root.add(this.pads);
  }

  // ------------------------------------------------------------------ trees, rocks, flowers, tufts

  _buildScenery() {
    const R = rng(1234);
    const forest = (x, z) => fbm(x * 0.017, z * 0.017, 401, 3);
    const trees = [];   // { kind: 0 oak | 1 pine | 2 bush, x, y, z, s, th, rot, rank, v }
    const want = { oak: 150, pine: 170, bush: 46 };
    let nOak = 0, nPine = 0, nBush = 0;
    const RMIN = 36, RMAX = 185;
    for (let i = 0; i < 12000 && (nOak < want.oak || nPine < want.pine); i++) {
      const r = Math.sqrt(R() * (RMAX * RMAX - RMIN * RMIN) + RMIN * RMIN), a = R() * TAU;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (Math.max(Math.abs(x), Math.abs(z)) < KEEP + 4) continue;
      if (laneDist(x, z) < 5.5 || pondS(x, z) < 1.7) continue;
      const fo = forest(x, z);
      const dens = smooth(0.42, 0.6, fo) * smooth(36, 75, r) * 0.95 + 0.07;
      if (R() > dens) continue;
      const h = heightAt(x, z);
      const pineP = 0.3 + smooth(3, 16, h) * 0.45 + (fbm(x * 0.03, z * 0.03, 433, 2) - 0.5) * 0.8;
      if (R() < pineP) {
        if (nPine >= want.pine) continue;
        nPine++;
        const H = 6.5 + R() * 6 + smooth(80, 160, r) * 3;
        trees.push({ kind: 1, x, y: h, z, s: H, th: 0.9 + R() * 0.6, rot: R() * TAU, rank: R(), v: R() });
      } else {
        if (nOak >= want.oak) continue;
        nOak++;
        trees.push({ kind: 0, x, y: h, z, s: 2.2 + R() * 1.4 + smooth(90, 170, r) * 0.8, th: 1.6 + R() * 1.2, rot: R() * TAU, rank: R(), v: R() });
      }
    }
    for (let i = 0; i < 4000 && nBush < want.bush; i++) {
      const r = 26 + R() * 22, a = R() * TAU;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const s = 0.8 + R() * 0.7;
      if (Math.max(Math.abs(x), Math.abs(z)) < KEEP + s + 0.5) continue;
      if (laneDist(x, z) < 3.5 || pondS(x, z) < 1.35) continue;
      if (R() > 0.25 + smooth(0.45, 0.6, forest(x, z)) * 0.75) continue;
      nBush++;
      trees.push({ kind: 2, x, y: heightAt(x, z), z, s, th: 0, rot: R() * TAU, rank: R(), v: R() });
    }
    this.trees = trees;

    const leaves = this.mats.mat('leaves'), needles = this.mats.mat('leavesDark'), bark = this.mats.mat('bark');
    const FAR = 88;
    for (const t of trees) t.far = t.kind === 0 && Math.hypot(t.x, t.z) > FAR;
    const nFar = trees.filter((t) => t.far).length;
    const nTrunk = nOak + nPine, nCanopy = nOak + nBush - nFar;
    this.trunkMesh = new THREE.InstancedMesh(trunkGeo(), bark, nTrunk);
    this.canopyMesh = new THREE.InstancedMesh(canopyGeo(), leaves, nCanopy);
    this.canopyFarMesh = new THREE.InstancedMesh(canopyGeo(true), leaves, Math.max(nFar, 1));
    this.pineMesh = new THREE.InstancedMesh(pineGeo(), needles, nPine);
    // soft blob shadows at the foot of trees and bushes
    const blobGeo = new THREE.PlaneGeometry(1, 1);
    blobGeo.rotateX(-Math.PI / 2);
    this.blobMat = new THREE.MeshBasicMaterial({
      map: makeBlobTexture(), color: new THREE.Color(this.seasonPal.blob), transparent: true, opacity: 0.42,
      depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    this.blobMat.name = 'env|blob';
    this.blobMesh = new THREE.InstancedMesh(blobGeo, this.blobMat, trees.length);
    this.blobMesh.renderOrder = 1;

    // rocks
    const rocks = [];
    for (let i = 0; i < 5000 && rocks.length < 80; i++) {
      const r = 25 + Math.pow(R(), 1.4) * 150, a = R() * TAU;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const s = 0.25 + Math.pow(R(), 2.5) * 1.6 + smooth(80, 160, r) * R() * 1.5;
      if (Math.max(Math.abs(x), Math.abs(z)) < KEEP + s * 1.2) continue;
      if (laneDist(x, z) < 2.2 + s || pondS(x, z) < 1.05) continue;
      if (R() > 0.35 + smooth(0.5, 0.62, fbm(x * 0.05, z * 0.05, 551, 2)) * 0.65) continue;
      rocks.push({ x, y: heightAt(x, z), z, s, rot: R() * TAU, tilt: (R() - 0.5) * 0.4, rank: R(), v: R() });
    }
    for (let i = 0; i < 9; i++) {                       // a few stones on the pond shore
      const pt = pondPoint(1.04 + R() * 0.12, R() * TAU, [0, 0]);
      rocks.push({ x: pt[0], y: 0, z: pt[1], s: 0.22 + R() * 0.35, rot: R() * TAU, tilt: 0, rank: R() * 0.3, v: R() });
    }
    this.rocks = rocks;
    this.rockMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(this.seasonPal.rock), roughness: 0.92, metalness: 0, flatShading: true });
    this.rockMat.name = 'env|rock';
    this.rockMesh = new THREE.InstancedMesh(rockGeo(), this.rockMat, rocks.length);

    // grass tufts & flowers
    this.plantMat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.92, metalness: 0 });
    this.plantMat.name = 'env|plants';
    upNormals(this.plantMat, 'hw-env-up');
    const tufts = [];
    for (let i = 0; i < 20000 && tufts.length < 1700; i++) {
      const r = KEEP + Math.pow(R(), 1.3) * 80, a = R() * TAU;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const sq = Math.max(Math.abs(x), Math.abs(z));
      if (sq < KEEP + 0.4) continue;
      if (laneDist(x, z) < 1.9 || pondS(x, z) < 1.02) continue;
      const p = 0.25 + 0.75 * smooth(0.35, 0.65, fbm(x * 0.08, z * 0.08, 601, 2)) * smooth(KEEP, KEEP + 14, sq);
      if (R() > p) continue;
      tufts.push({ x, y: heightAt(x, z), z, s: 0.45 + R() * 0.5, rot: R() * TAU, rank: R(), v: R() });
    }
    this.tufts = tufts;
    this.tuftMesh = new THREE.InstancedMesh(tuftGeo(), this.plantMat, tufts.length);

    const flowers = [];
    for (let i = 0; i < 20000 && flowers.length < 300; i++) {
      const r = KEEP + Math.pow(R(), 1.6) * 70, a = R() * TAU;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (Math.max(Math.abs(x), Math.abs(z)) < KEEP + 0.8) continue;
      const ld = laneDist(x, z), ps = pondS(x, z);
      if (ld < 2.0 || ps < 1.1) continue;
      const near = (ld < 6 ? 0.5 : 0) + (ps < 2 ? 0.4 : 0);
      const p = smooth(0.52, 0.66, fbm(x * 0.06, z * 0.06, 701, 2)) * 0.9 + near + 0.03;
      if (R() > p) continue;
      flowers.push({ x, y: heightAt(x, z), z, s: 0.8 + R() * 0.6, rot: R() * TAU, rank: R(), v: R() });
    }
    this.flowers = flowers;
    this.flowerMesh = new THREE.InstancedMesh(flowerGeo(), this.plantMat, flowers.length);

    for (const m of this.instanced()) {
      m.castShadow = false;
      m.receiveShadow = false;
      this.root.add(m);
    }
    this.trunkMesh.name = 'tree-trunks'; this.canopyMesh.name = 'tree-canopies'; this.pineMesh.name = 'pines';
    this.canopyFarMesh.name = 'tree-canopies-far';
    this.blobMesh.name = 'tree-blobs'; this.rockMesh.name = 'rocks'; this.tuftMesh.name = 'grass-tufts'; this.flowerMesh.name = 'wildflowers';
    // butterflies like flowers
    this.flowerSpots = flowers.filter((f) => Math.hypot(f.x, f.z) < 48).slice(0, 14);
  }

  instanced() {
    return [this.trunkMesh, this.canopyMesh, this.canopyFarMesh, this.pineMesh, this.blobMesh, this.rockMesh, this.tuftMesh, this.flowerMesh];
  }

  /** (Re)write instance matrices for the current density. Rank < density keeps an instance. */
  _fillScenery() {
    const dens = this.density, winter = this.season === 'winter';
    let nt = 0, nc = 0, nf = 0, np = 0, nb = 0;
    for (const t of this.trees) {
      if (t.rank > dens) continue;
      _q.setFromAxisAngle(_up, t.rot);
      if (t.kind === 0) {
        _s.set(0.9 + t.v * 0.4, t.th + 0.9, 0.9 + t.v * 0.4);
        _m.compose(_v.set(t.x, t.y - 0.15, t.z), _q, _s);
        this.trunkMesh.setMatrixAt(nt++, _m);
        _s.set(t.s, t.s * (0.85 + t.v * 0.2), t.s);
        _m.compose(_v.set(t.x, t.y + t.th + t.s * 0.82, t.z), _q, _s);
        if (t.far) {
          this.canopyFarMesh.setMatrixAt(nf, _m);
          this.canopyFarMesh.setColorAt(nf++, this._foliageTint(t, _c));
        } else {
          this.canopyMesh.setMatrixAt(nc, _m);
          this.canopyMesh.setColorAt(nc++, this._foliageTint(t, _c));
        }
      } else if (t.kind === 1) {
        _s.set(0.55 + t.v * 0.25, t.th + 0.6, 0.55 + t.v * 0.25);
        _m.compose(_v.set(t.x, t.y - 0.15, t.z), _q, _s);
        this.trunkMesh.setMatrixAt(nt++, _m);
        const w = t.s * (0.27 + t.v * 0.07);
        _s.set(w * 2, t.s, w * 2);
        _m.compose(_v.set(t.x, t.y + t.th * 0.55, t.z), _q, _s);
        this.pineMesh.setMatrixAt(np, _m);
        _c.setRGB(0.88 + t.v * 0.2, 0.92 + t.v * 0.14, 0.9 + t.v * 0.12);
        this.pineMesh.setColorAt(np++, _c);
      } else {
        _s.set(t.s, t.s * 0.78, t.s);
        _m.compose(_v.set(t.x, t.y + t.s * 0.55, t.z), _q, _s);
        this.canopyMesh.setMatrixAt(nc, _m);
        this.canopyMesh.setColorAt(nc++, this._foliageTint(t, _c));
      }
      // blob shadow aligned to the slope
      const e = 1.2;
      _v2.set(heightAt(t.x - e, t.z) - heightAt(t.x + e, t.z), 2 * e, heightAt(t.x, t.z - e) - heightAt(t.x, t.z + e)).normalize();
      _q.setFromUnitVectors(_up, _v2);
      const bs = t.kind === 1 ? t.s * 0.62 : t.kind === 0 ? t.s * 2.3 : t.s * 2.4;
      _s.set(bs, 1, bs);
      _m.compose(_v.set(t.x, t.y + 0.06, t.z), _q, _s);
      this.blobMesh.setMatrixAt(nb++, _m);
    }
    this.trunkMesh.count = nt; this.canopyMesh.count = nc; this.canopyFarMesh.count = nf; this.pineMesh.count = np; this.blobMesh.count = nb;

    let nr = 0;
    for (const r of this.rocks) {
      if (r.rank > dens) continue;
      _q.setFromEuler(_e.set(r.tilt, r.rot, r.tilt * 0.5));
      _s.set(r.s * (1 + r.v * 0.4), r.s, r.s);
      _m.compose(_v.set(r.x, r.y - r.s * 0.12, r.z), _q, _s);
      this.rockMesh.setMatrixAt(nr, _m);
      const k = 0.86 + r.v * 0.24;
      _c.setRGB(k, k * (0.98 + r.v * 0.03), k * (0.95 + r.v * 0.04));
      this.rockMesh.setColorAt(nr++, _c);
    }
    this.rockMesh.count = nr;

    const tuftKeep = dens * (winter ? 0.4 : 1);
    _c2.set(this.seasonPal.tuft);
    let nu = 0;
    for (const t of this.tufts) {
      if (t.rank > tuftKeep) continue;
      _q.setFromAxisAngle(_up, t.rot);
      _s.set(t.s, t.s * (0.8 + t.v * 0.4), t.s);
      _m.compose(_v.set(t.x, t.y - 0.02, t.z), _q, _s);
      this.tuftMesh.setMatrixAt(nu, _m);
      const k = 0.82 + t.v * 0.3;
      _c.setRGB(_c2.r * k, _c2.g * k, _c2.b * (0.9 + t.v * 0.25));
      this.tuftMesh.setColorAt(nu++, _c);
    }
    this.tuftMesh.count = nu;

    const fKeep = dens * (this.season === 'spring' ? 1 : this.season === 'summer' ? 0.7 : 0);
    nf = 0;
    for (const f of this.flowers) {
      if (f.rank > fKeep) continue;
      _q.setFromAxisAngle(_up, f.rot);
      _s.set(f.s, f.s, f.s);
      _m.compose(_v.set(f.x, f.y - 0.02, f.z), _q, _s);
      this.flowerMesh.setMatrixAt(nf, _m);
      _c.setRGB(0.9 + f.v * 0.15, 0.9 + (1 - f.v) * 0.12, 0.92 + f.v * 0.1);
      this.flowerMesh.setColorAt(nf++, _c);
    }
    this.flowerMesh.count = nf;
    this.flowerMesh.visible = nf > 0;

    for (const m of this.instanced()) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      m.computeBoundingSphere();
    }
  }

  _foliageTint(t, out) {
    const v = t.v;
    switch (this.season) {
      case 'autumn': {
        // some trees blaze red, others glow gold
        const k = v < 0.33 ? [1.08, 0.78, 0.7] : v < 0.66 ? [1.05, 1.0, 0.82] : [0.95, 0.92, 0.88];
        return out.setRGB(k[0], k[1], k[2]);
      }
      case 'winter': return out.setRGB(0.95 + v * 0.08, 0.97 + v * 0.06, 1.0);
      case 'spring': return out.setRGB(0.95 + v * 0.1, 0.98 + v * 0.06, 0.92 + v * 0.1);
      default: return out.setRGB(0.86 + v * 0.22, 0.9 + v * 0.16, 0.84 + v * 0.18);
    }
  }

  // ------------------------------------------------------------------ weather particles

  _buildWeather() {
    const R = rng(2024);
    const seed = new Float32Array(WEATHER_MAX * 4);
    for (let i = 0; i < seed.length; i++) seed[i] = R();
    const g = new THREE.BufferGeometry();
    // position is unused by the shader but three needs it for the draw count
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(WEATHER_MAX * 3), 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    g.setDrawRange(0, 0);
    this.wxU = {
      uCenter: { value: new THREE.Vector3() }, uBox: { value: new THREE.Vector3(46, 34, 46) }, uTime: { value: 0 },
      uFall: { value: 9 }, uSway: { value: 0 }, uWind: { value: new THREE.Vector2(0.6, 0.3) }, uSize: { value: 0.9 },
      uScale: { value: 500 }, uKind: { value: 0 }, uAlpha: { value: 0 }, uLight: { value: 1 },
      uLeaf0: { value: new THREE.Color() }, uLeaf1: { value: new THREE.Color() }, uLeaf2: { value: new THREE.Color() },
    };
    const m = new THREE.ShaderMaterial({
      uniforms: this.wxU, vertexShader: WX_VERT, fragmentShader: WX_FRAG,
      transparent: true, depthWrite: false, fog: false,
    });
    this.weather = new THREE.Points(g, m);
    this.weather.name = 'weather';
    this.weather.frustumCulled = false;
    this.weather.visible = false;
    this.weather.renderOrder = 20;
    this.root.add(this.weather);
  }

  _wxTarget() {
    const w = this.app.state.weather, tg = this.wxGoal;
    tg.rain = w === 'rain' ? 1 : 0; tg.snow = w === 'snow' ? 1 : 0; tg.leaves = w === 'leaves' ? 1 : 0;
    return tg;
  }

  _snapWeather() {
    const tg = this._wxTarget();
    this.wx.rain = tg.rain; this.wx.snow = tg.snow; this.wx.leaves = tg.leaves;
  }

  _updateWeather(dt) {
    const tg = this._wxTarget();
    const k = 1 - Math.exp(-dt * 0.9);
    let moving = false;
    for (const key of WX_KEYS) {
      const d = tg[key] - this.wx[key];
      if (Math.abs(d) > 0.0005) { this.wx[key] += d * k; moving = true; } else this.wx[key] = tg[key];
    }
    // which particle kind is shown: the strongest one
    const { rain, snow, leaves } = this.wx;
    const kind = rain >= snow && rain >= leaves ? 0 : snow >= leaves ? 1 : 2;
    const amt = Math.max(rain, snow, leaves);
    const U = this.wxU;
    const low = this.density < 0.6;
    if (kind !== this.wxKind) {
      this.wxKind = kind;
      U.uKind.value = kind;
      if (kind === 0) { U.uFall.value = 11; U.uSway.value = 0; U.uSize.value = 0.85; U.uWind.value.set(0.9, 0.4); }
      else if (kind === 1) { U.uFall.value = 1.1; U.uSway.value = 0.6; U.uSize.value = 0.11; U.uWind.value.set(0.35, 0.15); }
      else { U.uFall.value = 1.4; U.uSway.value = 1.1; U.uSize.value = 0.34; U.uWind.value.set(0.7, 0.25); }
    }
    const full = kind === 0 ? (low ? 900 : 1800) : kind === 1 ? (low ? 650 : 1300) : (low ? 130 : 260);
    const n = Math.round(full * clamp(amt * 1.2, 0, 1));
    if (n !== this.wxShown) { this.weather.geometry.setDrawRange(0, n); this.wxShown = n; }
    U.uAlpha.value = smooth(0, 0.35, amt);
    this.weather.visible = n > 0;
    return moving;
  }

  // ------------------------------------------------------------------ fireflies, butterflies, birds

  _buildLife() {
    // order: birds, butterflies, then fireflies last so 'low' quality can trim fireflies via the draw range
    const R = rng(3131);
    const FF = 70, BF = 12, BD = 7, N = FF + BF + BD;
    const center = new Float32Array(N * 3), seed = new Float32Array(N * 4), type = new Float32Array(N);
    let i = 0;
    for (let k = 0; k < BD; k++, i++) {
      center.set([(R() - 0.5) * 10, (R() - 0.5) * 3, (R() - 0.5) * 10], i * 3);
      seed.set([R(), R(), R(), R()], i * 4);
      type[i] = 2;
    }
    const spots = this.flowerSpots.length ? this.flowerSpots : [{ x: -30, y: 0, z: 10 }];
    for (let k = 0; k < BF; k++, i++) {
      const s = spots[k % spots.length];
      center.set([s.x, s.y, s.z], i * 3);
      seed.set([R(), R(), R(), R()], i * 4);
      type[i] = 1;
    }
    for (let k = 0; k < FF; k++, i++) {
      let x = 0, z = 0;
      for (let tries = 0; tries < 40; tries++) {
        if (k % 5 === 0) { const pt = pondPoint(1.1 + R() * 0.6, R() * TAU, [0, 0]); x = pt[0]; z = pt[1]; }
        else { const r = KEEP + 1 + R() * 26, a = R() * TAU; x = Math.cos(a) * r; z = Math.sin(a) * r; }
        if (Math.max(Math.abs(x), Math.abs(z)) > KEEP) break;
      }
      center.set([x, heightAt(x, z) + 0.6 + R() * 1.6, z], i * 3);
      seed.set([R(), R(), R(), R()], i * 4);
      type[i] = 0;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    g.setAttribute('aCenter', new THREE.BufferAttribute(center, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    g.setAttribute('aType', new THREE.BufferAttribute(type, 1));
    this.lifeU = { uTime: { value: 0 }, uScale: { value: 500 }, uFire: { value: 0 }, uFly: { value: 0 }, uBird: { value: 0 } };
    const m = new THREE.ShaderMaterial({
      uniforms: this.lifeU, vertexShader: LIFE_VERT, fragmentShader: LIFE_FRAG,
      transparent: true, depthWrite: false, fog: false,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    this.life = new THREE.Points(g, m);
    this.life.name = 'ambient-life';
    this.life.frustumCulled = false;
    this.life.renderOrder = 15;
    this.lifeFF = FF;
    this.root.add(this.life);
  }

  // ------------------------------------------------------------------ smoke

  _buildSmoke() {
    const R = rng(4545), N = MAX_EMIT * SMOKE_PER;
    const seed = new Float32Array(N * 4), idx = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      seed.set([(i / MAX_EMIT | 0) / SMOKE_PER + R() * 0.02, R(), R(), R()], i * 4);
      idx[i] = i % MAX_EMIT;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    g.setAttribute('aIdx', new THREE.BufferAttribute(idx, 1));
    this.smokeU = {
      uEmit: { value: Array.from({ length: MAX_EMIT }, () => new THREE.Vector4(0, -100, 0, 0)) },
      uTime: { value: 0 }, uWind: { value: new THREE.Vector2(0.35, 0.12) }, uScale: { value: 500 },
      uTex: { value: makePuffTexture() }, uCol: { value: new THREE.Color(0.95, 0.94, 0.92) }, uShade: { value: new THREE.Color(0.7, 0.72, 0.76) },
      uOpacity: { value: 0.5 },
    };
    const m = new THREE.ShaderMaterial({
      uniforms: this.smokeU, vertexShader: SMOKE_VERT, fragmentShader: SMOKE_FRAG,
      transparent: true, depthWrite: false, fog: false,
    });
    this.smoke = new THREE.Points(g, m);
    this.smoke.name = 'smoke';
    this.smoke.frustumCulled = false;
    this.smoke.visible = false;
    this.smoke.renderOrder = 10;
    this.root.add(this.smoke);
  }

  _scanEmitters() {
    this.emitters.length = 0;
    for (const e of this.app.world.entries.values()) if (e.def && e.def.emitter === 'smoke') this.emitters.push(e);
  }

  _updateSmoke(dt) {
    const U = this.smokeU.uEmit.value;
    let k = 0, any = false;
    for (let i = 0; i < this.emitters.length && k < MAX_EMIT; i++) {
      const e = this.emitters[i], o = e.obj;
      if (!o || !o.visible || !o.parent) continue;
      // a piece may move its emitter with its shape (a chimney grown through a tall roof)
      const off = o.children[0]?.userData.emitterOffset || e.def.emitterOffset || DEFAULT_EMIT;
      o.updateWorldMatrix(true, false);
      _v.set(off[0], off[1], off[2]);
      o.localToWorld(_v);
      if (this.slotEntry[k] !== e) { this.slotEntry[k] = e; this.slotFade[k] = 0; }
      this.slotFade[k] = Math.min(1, this.slotFade[k] + dt * 0.5);
      U[k].set(_v.x, _v.y, _v.z, this.slotFade[k]);
      any = true;
      k++;
    }
    for (; k < MAX_EMIT; k++) { this.slotEntry[k] = null; this.slotFade[k] = 0; U[k].w = 0; }
    this.smoke.visible = any;
  }

  // ------------------------------------------------------------------ seasons & quality

  applySeason() {
    const s = SEASON_PAL[this.app.state.season] ? this.app.state.season : 'summer';
    this.season = s;
    const pal = this.seasonPal = SEASON_PAL[s];
    this.mats.setSeason(s);
    this.bounce.set(pal.bounce);
    const G = this.groundU;
    G.uGrassA.value.set(pal.a); G.uGrassB.value.set(pal.b); G.uMowed.value.set(pal.mow);
    G.uDirt.value.set(pal.dirt); G.uShore.value.set(pal.shore); G.uHill.value.setRGB(...pal.hill);
    G.uLeafCol.value.set(pal.leaf); G.uLeafAmt.value = pal.leafAmt;
    G.uTexAmt.value = s === 'winter' ? 0.3 : 1;
    this.pads.visible = s !== 'winter';
    this.rockMat.color.set(pal.rock);
    this.reedMat.color.set(pal.reed).multiplyScalar(1.25);
    this.blobMat.color.set(pal.blob);
    this.blobMat.opacity = s === 'winter' ? 0.3 : 0.42;
    this.waterMat.color.set(pal.water);
    this.waterMat.roughness = s === 'winter' ? 0.42 : 0.16;
    this.waterMat.normalScale.setScalar(s === 'winter' ? 0.12 : 0.45);
    this.wxU.uLeaf0.value.set(pal.petals[0]); this.wxU.uLeaf1.value.set(pal.petals[1]); this.wxU.uLeaf2.value.set(pal.petals[2]);
    this._fillScenery();
    this.skyDirty = true;
  }

  applyQuality() {
    const q = this.app.state.quality;
    const lowShadow = q === 'low' || MOBILE;
    const size = lowShadow ? 1024 : 2048;
    const sh = this.sun.shadow;
    if (sh.mapSize.x !== size) {
      sh.mapSize.set(size, size);
      if (sh.map) { sh.map.dispose(); sh.map = null; }
    }
    this.density = q === 'low' ? 0.45 : (q === 'auto' && MOBILE) ? 0.72 : 1;
    this.stars.geometry.setDrawRange(0, Math.round(this.starsFull * (q === 'low' ? 0.5 : 1)));
    this.life.geometry.setDrawRange(0, this.life.geometry.attributes.aType.count - (q === 'low' ? Math.round(this.lifeFF * 0.5) : 0));
    this._fillScenery();
    this.wxShown = -1;
    this._fitShadow();
    this.shadowHot = 0.5;
  }

  _onState(changed) {
    const st = this.app.state;
    if (changed.includes('time') && !this.selfTime && Number.isFinite(st.time)) { this.t = ((st.time % 1) + 1) % 1; this.skyDirty = true; }
    if (changed.includes('season') && st.season !== this.season) this.applySeason();
    if (changed.includes('weather')) this.skyDirty = true;
    if (changed.includes('shadows')) { this.sun.castShadow = !!st.shadows; this.shadowHot = 0.5; }
    if (changed.includes('quality')) this.applyQuality();
    if (changed.includes('level') || changed.includes('seeAll')) this.shadowHot = Math.max(this.shadowHot, 0.6);
  }

  // ------------------------------------------------------------------ per frame

  update(dt) {
    dt = Math.min(Math.max(dt || 0, 0), 0.1);
    const { state: st, camera, renderer, rig } = this.app;
    this.clock += dt;

    // the day passes by itself (a whole day ≈ 10 minutes); other modules hear about it twice a second
    if (st.timeFlow) {
      this.t = (this.t + dt / DAY_SECONDS) % 1;
      this.flowAcc += dt;
      this.skyDirty = true;
      if (this.flowAcc >= 0.5) {
        this.flowAcc = 0;
        this.selfTime = true;
        try { st.set({ time: Math.round(this.t * 10000) / 10000 }); } finally { this.selfTime = false; }
      }
    }

    if (this._updateWeather(dt)) this.skyDirty = true;
    if (this.skyDirty) this._updateSky();

    // sky things follow the camera
    const cp = camera.position;
    this.sky.position.copy(cp);
    this.stars.position.copy(cp);
    this.stars.rotation.y = this.t * TAU * 0.5;

    // pixel scale for world-sized points
    renderer.getDrawingBufferSize(_sz);
    const scale = _sz.y / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    const pr = renderer.getPixelRatio();
    const T = this.clock % 3600;
    this.starU.uTime.value = T;
    this.starU.uPR.value = pr;
    this.cloudU.uDrift.value = (this.clock * 1.6) % 560;
    this.cloudU.uCam.value.copy(cp);

    // weather box sits between the camera and what it looks at
    if (this.weather.visible) {
      const tgt = rig ? rig.target : _v2.set(0, 0, 0);
      this.wxU.uCenter.value.copy(tgt).sub(cp).multiplyScalar(0.42).add(cp);
      this.wxU.uTime.value = this.clock % 600;
      this.wxU.uScale.value = scale;
    }

    // ambient life
    const L = this.lifeU;
    const s = this.season, ov = clamp(this.wx.rain + this.wx.snow, 0, 1);
    const warm = s === 'summer' ? 1 : s === 'spring' ? 0.45 : s === 'autumn' ? 0.15 : 0;
    L.uFire.value = smooth(0.45, 0.85, this.night) * warm * (1 - ov);
    L.uFly.value = smooth(0.35, 0.7, this.day) * (s === 'spring' || s === 'summer' ? 1 : 0) * (1 - ov) * (1 - this.night);
    L.uBird.value = smooth(0.3, 0.6, this.day) * (s === 'winter' ? 0.5 : 1) * (1 - ov) * (1 - this.night);
    this.life.visible = L.uFire.value + L.uFly.value + L.uBird.value > 0.002;
    L.uTime.value = T;
    L.uScale.value = scale;

    // water ripples
    if (this.waterNormal && this.season !== 'winter') {
      this.waterNormal.offset.set((this.clock * 0.013) % 1, (this.clock * 0.008) % 1);
    }

    // chimney smoke
    if (this.emitters.length) {
      this._updateSmoke(dt);
      this.smokeU.uTime.value = this.clock % 3600;
      this.smokeU.uScale.value = scale;
      this.smokeU.uWind.value.set(0.35 + 0.5 * ov, 0.12);
    } else if (this.smoke.visible) this.smoke.visible = false;

    // shadow caster bounds settle after pop-in animations
    if (this.casterTimer > 0) {
      this.casterTimer -= dt;
      if (this.casterTimer <= 0) this._computeCasterBox();
    }

    // shadow map: only re-render when something may have changed (plus a slow safety net)
    if (renderer.shadowMap.enabled && this.sun.castShadow) {
      this.shadowTick++;
      const tweening = this.app.effects?.tweens?.length > 0;
      if (this.shadowHot > 0 || tweening || this.shadowTick >= 12) {
        renderer.shadowMap.needsUpdate = true;
        this.shadowTick = 0;
      }
    }
    if (this.shadowHot > 0) this.shadowHot -= dt;
  }
}

export function init(app) {
  const env = new Env(app);
  return {
    update: (dt) => env.update(dt),
    heightAt,
    get sunDir() { return env.sunDir; },
    get night() { return env.night; },
    env,
  };
}
