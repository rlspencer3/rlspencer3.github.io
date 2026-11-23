// Material library. Pieces ask for materials by id (+ optional paint colour):
//   mat('clapboard', '#f4efe6')
// Materials are cached per (id, colour) — never dispose them.
//
// Every material is a MeshStandardMaterial with a PROCEDURAL texture: each texture is painted once,
// lazily (on the first mat() call that needs it), into a small tileable RGBA DataTexture, together
// with a normal map derived from a height field (lap shadows, shingle butts, mortar joints, grain)
// and, for glowing things, an emissive map. Textures are shared by every colour variant:
//   * paintable materials (and a few tinted ones: logs, iron, grass, petals…) are painted in light
//     neutral values and material.color tints them, so one texture serves every paint colour;
//   * the others carry their own colours (brick, stone, slate, thatch, floors…) and use a white
//     material.color.
// UVs are in METRES (see ARCHITECTURE.md "Texture UVs"): texture.repeat = 1 / period, where the
// period is 2 m × 1.25 m for walls, 2 m × 2 m for floors and 1 m × 1 m (4 courses) for roofs.
// Texture rows run bottom-up (DataTexture, flipY = false): y = 0 is v = 0 (down / downhill).

import * as THREE from 'three';

// group: which picker the material appears in.
// paintable: colour picker applies (texture is tinted by colour).
// color: default/base colour.  swatch: CSS colour for UI chips.
export const MATERIALS = {
  // ---- Walls / siding ----
  log:           { name: 'Pine Logs',      group: 'wall',  paintable: false, color: '#c8955c' },
  logDark:       { name: 'Dark Logs',      group: 'wall',  paintable: false, color: '#7a5233' },
  clapboard:     { name: 'Clapboard',      group: 'wall',  paintable: true,  color: '#f3eee4' },
  boardBatten:   { name: 'Board & Batten', group: 'wall',  paintable: true,  color: '#b4473a' },
  shingleSiding: { name: 'Cedar Shingle',  group: 'wall',  paintable: true,  color: '#b98a5e' },
  plaster:       { name: 'Plaster',        group: 'wall',  paintable: true,  color: '#f0e4c8' },
  stone:         { name: 'Fieldstone',     group: 'wall',  paintable: false, color: '#9a958c' },
  brick:         { name: 'Brick',          group: 'wall',  paintable: false, color: '#a8553f' },
  planks:        { name: 'Rough Planks',   group: 'wall',  paintable: false, color: '#a07850' },
  glass:         { name: 'Glass Panels',   group: 'wall',  paintable: false, color: '#bfe3ea' },
  // ---- Roofing ----
  roofShingle:   { name: 'Wood Shingles',  group: 'roof',  paintable: false, color: '#8a6446' },
  roofSlate:     { name: 'Slate',          group: 'roof',  paintable: false, color: '#5a6470' },
  roofMetal:     { name: 'Tin Roof',       group: 'roof',  paintable: true,  color: '#a8483a' },
  roofThatch:    { name: 'Thatch',         group: 'roof',  paintable: false, color: '#c9a55e' },
  roofTile:      { name: 'Clay Tile',      group: 'roof',  paintable: false, color: '#c0643f' },
  // ---- Floors ----
  floorOak:      { name: 'Oak Boards',     group: 'floor', paintable: false, color: '#b07f4f' },
  floorPine:     { name: 'Pine Boards',    group: 'floor', paintable: false, color: '#d8b07a' },
  floorStone:    { name: 'Flagstone',      group: 'floor', paintable: false, color: '#a9a49a' },
  floorTile:     { name: 'Checker Tile',   group: 'floor', paintable: true,  color: '#e9e2d2' },
  deck:          { name: 'Deck Boards',    group: 'floor', paintable: false, color: '#9c7552' },
  // ---- Structure & trim ----
  timber:        { name: 'Dark Timber',    group: 'trim',  paintable: false, color: '#5b3f2a' },
  wood:          { name: 'Pine',           group: 'trim',  paintable: false, color: '#d2a46c' },
  trim:          { name: 'Painted Trim',   group: 'trim',  paintable: true,  color: '#f7f3ea' },
  paintedWood:   { name: 'Painted Wood',   group: 'trim',  paintable: true,  color: '#7a4b3a' },
  stoneBlock:    { name: 'Cut Stone',      group: 'trim',  paintable: false, color: '#a39e94' },
  iron:          { name: 'Iron',           group: 'trim',  paintable: false, color: '#3b3a3a' },
  // ---- Misc (not shown in pickers) ----
  windowGlass:   { name: 'Window Glass',   group: 'misc',  paintable: false, color: '#9fc8d6' },
  fabric:        { name: 'Fabric',         group: 'misc',  paintable: true,  color: '#c96a5a' },
  leaves:        { name: 'Leaves',         group: 'misc',  paintable: false, color: '#6f9a4a' },
  leavesDark:    { name: 'Pine Needles',   group: 'misc',  paintable: false, color: '#3f6b45' },
  bark:          { name: 'Bark',           group: 'misc',  paintable: false, color: '#6b4c36' },
  grass:         { name: 'Grass',          group: 'misc',  paintable: false, color: '#8fb35e' },
  dirt:          { name: 'Soil',           group: 'misc',  paintable: false, color: '#6e4f37' },
  path:          { name: 'Path Stones',    group: 'misc',  paintable: false, color: '#b9b2a3' },
  hay:           { name: 'Hay',            group: 'misc',  paintable: false, color: '#dcc06a' },
  water:         { name: 'Water',          group: 'misc',  paintable: false, color: '#6fa8c0' },
  ember:         { name: 'Fire Glow',      group: 'misc',  paintable: false, color: '#ff9a3c' },
  lampGlow:      { name: 'Lamp Glow',      group: 'misc',  paintable: false, color: '#ffe0a0' },
  petalPink:     { name: 'Pink Petals',    group: 'misc',  paintable: false, color: '#f2a0b5' },
  petalYellow:   { name: 'Yellow Petals',  group: 'misc',  paintable: false, color: '#f5d25a' },
  petalWhite:    { name: 'White Petals',   group: 'misc',  paintable: false, color: '#fbf7ee' },
  petalPurple:   { name: 'Lavender',       group: 'misc',  paintable: false, color: '#a58ad6' },
  pumpkin:       { name: 'Pumpkin',        group: 'misc',  paintable: false, color: '#e8862f' },
  ceramic:       { name: 'Ceramic',        group: 'misc',  paintable: true,  color: '#f4efe6' },
  book:          { name: 'Books',          group: 'misc',  paintable: false, color: '#8b5a4a' },
};
for (const [id, m] of Object.entries(MATERIALS)) { m.id = id; m.swatch = m.swatch || m.color; }

// Cozy paint palette for paintable materials.
export const PALETTE = [
  '#f7f3ea', '#efe3c8', '#e8d3a8', '#d9c19a', // whites & creams
  '#b4473a', '#8e3b32', '#c96a5a', '#e39a7a', // barn reds & terracotta
  '#e9c46a', '#d9a441', '#9cae6b', '#6f8f5a', // mustard, sage, moss
  '#4f7a6a', '#7fa7a3', '#9fc0d6', '#5d7fa3', // teal, duck egg, sky, denim
  '#2f4a66', '#6b5b8e', '#b9a3c9', '#e7b7c8', // navy, plum, lilac, blush
  '#7a4b3a', '#4a3a2e', '#5e5e5e', '#2b2b2b', // walnut, umber, slate, charcoal
];

export const isPaintable = (id) => !!MATERIALS[id]?.paintable;
export const matList = (group) => Object.values(MATERIALS).filter((m) => m.group === group);
export const matName = (id) => MATERIALS[id]?.name || id;

// ===================================================================== noise & painting kit

const TAU = Math.PI * 2;
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const mix = (a, b, t) => a + (b - a) * t;
/** Smoothstep from a to b (a > b gives a falling edge). */
function smooth(a, b, x) { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); }
const wrap = (x, p) => ((x % p) + p) % p;
/** Shortest signed distance on a ring of length p. */
const wrapd = (d, p) => d - p * Math.round(d / p);

/** Small seeded PRNG (mulberry32) → () => [0, 1). */
function rng(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer hash → [0, 1). */
function hash(x, y, s) {
  let h = (s | 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (x | 0), 0x85ebca6b); h ^= h >>> 13;
  h = Math.imul(h ^ (y | 0), 0xc2b2ae35); h ^= h >>> 16;
  h = Math.imul(h, 0x27d4eb2d); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

// Value-noise lattice: a 512×512 random table (faster than hashing every corner).
const NT_BITS = 9, NM = (1 << NT_BITS) - 1;
let NTAB = null;
function initNoise() {
  if (NTAB) return;
  NTAB = new Float32Array(1 << (NT_BITS * 2));
  const R = rng(20240611);
  for (let i = 0; i < NTAB.length; i++) NTAB[i] = R();
}

/** Periodic value noise: lattice period px × py cells (integers), seed s (integer). */
function vnoise(x, y, px, py, s) {
  let xi = Math.floor(x), yi = Math.floor(y);
  let fx = x - xi, fy = y - yi;
  xi %= px; if (xi < 0) xi += px;
  yi %= py; if (yi < 0) yi += py;
  const x1 = xi + 1 === px ? 0 : xi + 1, y1 = yi + 1 === py ? 0 : yi + 1;
  const sx = s * 97, sy = s * 61;
  const r0 = ((yi + sy) & NM) << NT_BITS, r1 = ((y1 + sy) & NM) << NT_BITS;
  const c0 = (xi + sx) & NM, c1 = (x1 + sx) & NM;
  const a = NTAB[r0 | c0], b = NTAB[r0 | c1], c = NTAB[r1 | c0], d = NTAB[r1 | c1];
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  return a + (b - a) * fx + (c - a + (a - b - c + d) * fx) * fy;
}

/**
 * Tileable fractal noise over the texture (u, v ∈ [0, 1)): fx × fy lattice cells per tile for the
 * first octave (integers — anisotropic counts give streaks/grain), doubling per octave. ≈ 0.5 mean.
 */
function fbm(u, v, fx, fy, oct, s) {
  let sum = 0, amp = 0.5, norm = 0;
  for (let o = 0; o < oct; o++) {
    sum += amp * vnoise(u * fx, v * fy, fx, fy, s + o * 101);
    norm += amp; amp *= 0.5; fx *= 2; fy *= 2;
  }
  return sum / norm;
}

/** A texture being painted: colours (sRGB 0..1), height (metres), optional emission (0..1). */
function newTex(W, H, pu, pv) {
  return { W, H, pu, pv, col: new Float32Array(W * H * 3), hgt: new Float32Array(W * H), em: null };
}
function put(T, i, r, g, b, h) { const j = i * 3; T.col[j] = r; T.col[j + 1] = g; T.col[j + 2] = b; T.hgt[i] = h; }

/** Visit every texel: fn(i, x, y, u, v, um, vm) with u, v ∈ [0,1) and um, vm in metres. */
function each(T, fn) {
  const { W, H, pu, pv } = T;
  for (let y = 0, i = 0; y < H; y++) {
    const v = (y + 0.5) / H, vm = v * pv;
    for (let x = 0; x < W; x++, i++) {
      const u = (x + 0.5) / W;
      fn(i, x, y, u, v, u * pu, vm);
    }
  }
}

// ---- rows of pieces (boards, shingles, blocks) that tile seamlessly along U

/** Random widths in [minW, maxW] that fill `total` exactly, starting at a random offset. */
function makeRow(R, total, minW, maxW) {
  const ws = [];
  let sum = 0;
  while (sum < total - minW * 0.5) { const w = minW + R() * (maxW - minW); ws.push(w); sum += w; }
  const k = total / sum, edges = [0];
  let acc = 0;
  for (const w of ws) { acc += w * k; edges.push(acc); }
  edges[edges.length - 1] = total;
  return { off: R() * total, edges, n: ws.length };
}
function jointGap(a, b, total) {
  let g = total;
  for (let i = 0; i < a.n; i++) for (let j = 0; j < b.n; j++) {
    g = Math.min(g, Math.abs(wrapd(a.off + a.edges[i] - b.off - b.edges[j], total)));
  }
  return g;
}
/** A row whose joints keep at least minGap away from the previous row's joints (best of a few tries). */
function staggeredRow(R, total, minW, maxW, prev, minGap) {
  let best = null, bestGap = -1;
  for (let t = 0; t < 16; t++) {
    const r = makeRow(R, total, minW, maxW);
    if (!prev || minGap <= 0) return r;
    const g = jointGap(r, prev, total);
    if (g > bestGap) { best = r; bestGap = g; }
    if (g >= minGap) break;
  }
  return best;
}
/** Per-row, per-column lookup: piece index and distances to its left/right edges (metres). */
function rowLookup(rows, W, pu) {
  const n = rows.length, K = new Int16Array(n * W), D0 = new Float32Array(n * W), D1 = new Float32Array(n * W);
  for (let c = 0; c < n; c++) {
    const r = rows[c], E = r.edges;
    for (let x = 0; x < W; x++) {
      const xx = wrap((x + 0.5) / W * pu - r.off, pu);
      let k = 0;
      while (k < r.n - 1 && E[k + 1] <= xx) k++;
      const j = c * W + x;
      K[j] = k; D0[j] = xx - E[k]; D1[j] = E[k + 1] - xx;
    }
  }
  return { K, D0, D1 };
}
/** Give every piece of every row a few random properties. */
function decorate(R, rows, jit = 0) {
  for (const r of rows) {
    r.tone = []; r.seed = []; r.jit = []; r.pick = [];
    for (let k = 0; k < r.n; k++) {
      r.tone.push(R()); r.seed.push((R() * 50000) | 0); r.jit.push((R() - 0.5) * 2 * jit); r.pick.push(R());
    }
  }
}

const SC = { c: 0, k: 0, row: null, dv: 0, dn: 0, du0: 0, du1: 0, w: 0, ch: 0, u: 0, v: 0, um: 0, vm: 0 };

/**
 * Overlapping courses (shingles, slates, clapboard-like laps, thatch bundles, tiles): `n` courses per
 * tile along V, each a row of pieces along U whose butt (lower edge) may be jittered per piece.
 * Upper courses lie over lower ones. shade(T, i, S) paints a texel with S describing its piece:
 *   S.dv distance above the piece's own butt, S.dn distance below the next course's butt,
 *   S.du0 / S.du1 distances to the piece's sides, S.w piece width, S.ch course height.
 */
function courses(T, o, shade) {
  const { W, H, pu, pv } = T, n = o.n, ch = pv / n;
  const R = rng(o.seed);
  const rows = [];
  for (let c = 0; c < n; c++) rows.push(o.row ? o.row(R, c) : staggeredRow(R, pu, o.minW, o.maxW, rows[c - 1], o.minGap || 0));
  decorate(R, rows, o.jit || 0);
  const { K, D0, D1 } = rowLookup(rows, W, pu);
  const butt = (c, x) => { const cw = wrap(c, n); return c * ch + rows[cw].jit[K[cw * W + x]]; };
  const S = SC;
  S.ch = ch;
  for (let y = 0; y < H; y++) {
    const v = (y + 0.5) / H, vm = v * pv, c0 = Math.floor(vm / ch);
    for (let x = 0; x < W; x++) {
      let c = c0 + 1, b = butt(c, x);
      if (vm < b) { c = c0; b = butt(c, x); if (vm < b) { c = c0 - 1; b = butt(c, x); } }
      const cw = wrap(c, n), j = cw * W + x;
      S.c = cw; S.k = K[j]; S.row = rows[cw];
      S.dv = vm - b; S.dn = butt(c + 1, x) - vm;
      S.du0 = D0[j]; S.du1 = D1[j]; S.w = D0[j] + D1[j];
      S.u = (x + 0.5) / W; S.v = v; S.um = S.u * pu; S.vm = vm;
      shade(T, y * W + x, S);
    }
  }
}

/** Dart-throwing scatter of discs on the torus (big ones first). sy stretches distances along V. */
function scatter(R, pu, pv, rmin, rmax, tries, sy = 1, pack = 0.8) {
  const X = [], Y = [], Rr = [];
  for (let t = 0; t < tries; t++) {
    const r = mix(rmax, rmin, t / tries) * (0.85 + 0.3 * R());
    const x = R() * pu, y = R() * pv;
    let ok = true;
    for (let j = 0; j < X.length; j++) {
      const dx = wrapd(x - X[j], pu), dy = wrapd(y - Y[j], pv) * sy, m = (r + Rr[j]) * pack;
      if (dx * dx + dy * dy < m * m) { ok = false; break; }
    }
    if (ok) { X.push(x); Y.push(y); Rr.push(r); }
  }
  return { X, Y, R: Rr, n: X.length };
}

/**
 * Jittered-grid "cells" (leaves, tufts, clumps, pebbles): for texel (u, v) finds the nearest feature
 * point of a gx × gy periodic grid. Writes CELL.{id, dx, dy, d, d2} (dx/dy in cell units).
 */
const CELL = { id: 0, dx: 0, dy: 0, d: 0, d2: 0, cx: 0, cy: 0 };
const cellPts = [];
function cellJitter(gx, gy, s, jit) {
  for (const c of cellPts) if (c.gx === gx && c.gy === gy && c.s === s && c.jit === jit) return c.J;
  const J = new Float32Array(gx * gy * 2);
  for (let cy = 0; cy < gy; cy++) for (let cx = 0; cx < gx; cx++) {
    J[(cy * gx + cx) * 2] = 0.5 + (hash(cx, cy, s) - 0.5) * jit;
    J[(cy * gx + cx) * 2 + 1] = 0.5 + (hash(cx, cy, s + 7) - 0.5) * jit;
  }
  cellPts.push({ gx, gy, s, jit, J });
  return J;
}
function cellular(u, v, gx, gy, s, jit = 0.9) {
  const J = cellJitter(gx, gy, s, jit);
  const x = u * gx, y = v * gy, xi = Math.floor(x), yi = Math.floor(y);
  let b1 = 1e9, b2 = 1e9;
  for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
    const cx = wrap(xi + ox, gx), cy = wrap(yi + oy, gy), o = (cy * gx + cx) * 2;
    const px = xi + ox + J[o], py = yi + oy + J[o + 1];
    const dx = x - px, dy = y - py, d = dx * dx + dy * dy;
    if (d < b1) { b2 = b1; b1 = d; CELL.id = cy * gx + cx; CELL.dx = dx; CELL.dy = dy; CELL.cx = cx; CELL.cy = cy; } else if (d < b2) b2 = d;
  }
  CELL.d = Math.sqrt(b1); CELL.d2 = Math.sqrt(b2);
  return CELL;
}

/** Per-cell random numbers for jittered-grid features: tab[((cy * G + cx) * NL + l) * K + k]. */
function cellTable(G, NL, K, seed, step) {
  const tab = new Float32Array(G * G * NL * K);
  for (let cy = 0; cy < G; cy++) for (let cx = 0; cx < G; cx++) for (let l = 0; l < NL; l++) {
    for (let k = 0; k < K; k++) tab[((cy * G + cx) * NL + l) * K + k] = hash(cx, cy, seed + l * step + k);
  }
  return tab;
}

// ---- encoding

function colourBytes(T) {
  const N = T.W * T.H, out = new Uint8Array(N * 4), c = T.col;
  for (let i = 0; i < N; i++) {
    const j = i * 3, k = i * 4;
    out[k] = clamp01(c[j]) * 255 + 0.5; out[k + 1] = clamp01(c[j + 1]) * 255 + 0.5; out[k + 2] = clamp01(c[j + 2]) * 255 + 0.5; out[k + 3] = 255;
  }
  return out;
}
function greyBytes(T, a) {
  const N = T.W * T.H, out = new Uint8Array(N * 4);
  for (let i = 0; i < N; i++) { const g = clamp01(a[i]) * 255 + 0.5, k = i * 4; out[k] = out[k + 1] = out[k + 2] = g; out[k + 3] = 255; }
  return out;
}
/** Tangent-space normal map from the height field (metres), seamless (wraps), times `strength`. */
function normalBytes(T, strength) {
  const { W, H, hgt } = T, out = new Uint8Array(W * H * 4);
  const kx = (W / T.pu) * 0.5 * strength, ky = (H / T.pv) * 0.5 * strength;
  for (let y = 0; y < H; y++) {
    const yu = (y + 1) % H, yd = (y - 1 + H) % H;
    for (let x = 0; x < W; x++) {
      const xr = (x + 1) % W, xl = (x - 1 + W) % W;
      const dx = (hgt[y * W + xr] - hgt[y * W + xl]) * kx, dy = (hgt[yu * W + x] - hgt[yd * W + x]) * ky;
      const il = 1 / Math.sqrt(dx * dx + dy * dy + 1), k = (y * W + x) * 4;
      out[k] = (-dx * il * 0.5 + 0.5) * 255 + 0.5;
      out[k + 1] = (-dy * il * 0.5 + 0.5) * 255 + 0.5;
      out[k + 2] = (il * 0.5 + 0.5) * 255 + 0.5;
      out[k + 3] = 255;
    }
  }
  return out;
}

const ANISO = 4;
function toTexture(bytes, T, srgb) {
  const t = new THREE.DataTexture(bytes, T.W, T.H, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / T.pu, 1 / T.pv);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = ANISO;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

// ===================================================================== texture painters
// Each painter fills T.col (sRGB) and T.hgt (metres); `v` is an optional variant (season).

// ---------------------------------------------------------------- walls

/** Lap siding: 0.25 m boards, soft shadow under each lap, faint painted grain and butt joints. */
function paintClapboard(T) {
  const R = rng(101), BH = 0.25, nb = Math.round(T.pv / BH);
  const joints = [];
  for (let b = 0; b < nb; b++) joints.push(R() < 0.7 ? R() * T.pu : -1);
  each(T, (i, x, y, u, v, um, vm) => {
    const bf = vm / BH, b = Math.floor(bf), t = bf - b;          // t: 0 = lower (butt) edge .. 1 = under the next lap
    const grain = fbm(u, v, 3, 160, 3, 7 + b * 13);
    const weather = fbm(u, v, 5, 4, 3, 3);
    let L = 0.965 + 0.045 * (grain - 0.5) + 0.05 * (weather - 0.5);
    const s = smooth(0.72, 1.0, t);
    L *= 1 - 0.36 * s * s;                                        // shadow under the board above
    if (t < 0.03) L *= 0.8;                                       // butt edge faces down
    else L *= 1 + 0.03 * (1 - smooth(0.03, 0.12, t));             // rounded lip catches light
    let h = 0.016 * (1 - t) - 0.005 * (1 - smooth(0, 0.06, t)) + 0.0004 * grain;
    const jx = joints[b % nb];
    if (jx >= 0) {
      const dj = Math.abs(wrapd(um - jx, T.pu));
      if (dj < 0.005) { L *= 0.88 + 0.12 * (dj / 0.005); h -= 0.001 * (1 - dj / 0.005); }
    }
    put(T, i, L, L * 0.995, L * 0.985, h);
  });
}

/**
 * Board & batten: wide vertical boards, 0.4 m apart. walls.js adds the battens as real geometry at
 * local x ≡ 0 (mod 0.4), so the texture only draws the board seams there plus their soft shadow.
 */
function paintBoardBatten(T) {
  const P = 0.4, NB = Math.round(T.pu / P), R = rng(111);
  const tones = [];
  for (let k = 0; k < NB; k++) tones.push(0.9 + 0.1 * R());
  each(T, (i, x, y, u, v, um) => {
    const kb = Math.round(um / P), d = Math.abs(um - kb * P);    // distance from the seam / batten centre
    const board = Math.floor(um / P) % NB;
    const weather = fbm(u, v, 24, 2, 3, 5);
    const g = fbm(u, v, 220, 3, 3, 21 + board * 7);
    const ring = Math.pow(0.5 + 0.5 * Math.cos(TAU * (u * 60 + 2.0 * fbm(u, v, 6, 2, 2, 23 + board))), 8);
    let L = tones[board] * (0.95 + 0.07 * (g - 0.5) - 0.03 * ring) * (0.97 + 0.06 * (weather - 0.5));
    L *= 1 - 0.16 * smooth(0.06, 0.03, d);                       // soft shade beside the batten
    if (d < 0.003) L *= 0.6;                                      // board seam
    put(T, i, L, L * 0.995, L * 0.985, 0.0008 * g - 0.0004 * ring - (d < 0.003 ? 0.002 : 0));
  });
}

/** Staggered cedar shingles (8 courses per 1.25 m). */
function paintShingleSiding(T) {
  courses(T, { n: 8, minW: 0.075, maxW: 0.2, jit: 0.005, minGap: 0.03, seed: 121 }, (T, i, S) => {
    const r = S.row, k = S.k, sd = r.seed[k];
    const tone = 0.82 + 0.18 * r.tone[k];
    const grain = fbm(S.u, S.v, 180, 4, 3, sd);
    const side = Math.min(S.du0, S.du1);
    const key = smooth(0.0012, 0.0045, side);
    const shadow = 1 - 0.42 * Math.exp(-S.dn / 0.007);
    let L = tone * (0.9 + 0.2 * (grain - 0.5) * 1.6) * shadow * (S.dv < 0.004 ? 0.84 : 1);
    L *= 0.3 + 0.7 * key;
    const h = 0.012 * (1 - 0.75 * S.dv / S.ch) + 0.0012 * grain - 0.006 * (1 - key);
    put(T, i, L, L * 0.99, L * 0.97, h);
  });
}

/** Soft, slightly uneven lime plaster with trowel swirls. */
function paintPlaster(T) {
  each(T, (i, x, y, u, v) => {
    const big = fbm(u, v, 4, 3, 4, 31);
    const w = fbm(u, v, 5, 4, 2, 33);
    const trowel = fbm(wrap(u + 0.12 * w, 1), v, 9, 7, 3, 35);
    const fine = fbm(u, v, 80, 50, 2, 37);
    const L = 0.955 + 0.05 * (big - 0.5) + 0.05 * (trowel - 0.5) + 0.04 * (fine - 0.5);
    put(T, i, L, L * 0.995, L * 0.985, 0.004 * big + 0.003 * trowel + 0.0005 * fine);
  });
}

/** Rounded fieldstones of mixed colours set in pale mortar. */
function paintFieldstone(T) {
  const R = rng(51), SY = 1.35, MW = 0.012;
  const P = scatter(R, T.pu, T.pv, 0.07, 0.2, 800, SY, 0.82);
  const pal = [[0.63, 0.61, 0.57], [0.71, 0.66, 0.57], [0.55, 0.52, 0.48], [0.58, 0.59, 0.6], [0.7, 0.62, 0.5],
    [0.5, 0.48, 0.46], [0.67, 0.64, 0.61], [0.6, 0.55, 0.5], [0.64, 0.6, 0.55]];
  const col = [], tone = [], rl = [], sd = [];
  for (let j = 0; j < P.n; j++) {
    col.push(pal[(R() * pal.length) | 0]); tone.push(0.88 + 0.22 * R()); rl.push(1.08 + 0.3 * R()); sd.push((R() * 9999) | 0);
  }
  const cand = new Int32Array(P.n);
  const { W, H, pu, pv } = T;
  for (let y = 0; y < H; y++) {
    const v = (y + 0.5) / H, vm = v * pv;
    let nc = 0;
    for (let j = 0; j < P.n; j++) if (Math.abs(wrapd(vm - P.Y[j], pv)) * SY < 0.6) cand[nc++] = j;
    for (let x = 0; x < W; x++) {
      const u = (x + 0.5) / W, um = u * pu, i = y * W + x;
      let b1 = 1e9, b2 = 1e9, b3 = 1e9, j1 = 0, j2 = 0, j3 = 0;
      for (let q = 0; q < nc; q++) {
        const j = cand[q];
        const dx = wrapd(um - P.X[j], pu), dy = wrapd(vm - P.Y[j], pv) * SY;
        const d = dx * dx + dy * dy - P.R[j] * P.R[j];
        if (d < b1) { b3 = b2; j3 = j2; b2 = b1; j2 = j1; b1 = d; j1 = j; } else if (d < b2) { b3 = b2; j3 = j2; b2 = d; j2 = j; } else if (d < b3) { b3 = d; j3 = j; }
      }
      // distances to the two nearest cell borders, blended so stone corners come out rounded
      const e2 = (b2 - b1) / (2 * Math.hypot(wrapd(P.X[j2] - P.X[j1], pu), wrapd(P.Y[j2] - P.Y[j1], pv) * SY) + 1e-6);
      const e3 = (b3 - b1) / (2 * Math.hypot(wrapd(P.X[j3] - P.X[j1], pu), wrapd(P.Y[j3] - P.Y[j1], pv) * SY) + 1e-6);
      const kk = 0.05, hh = clamp01(0.5 + 0.5 * (e3 - e2) / kk), e = mix(e3, e2, hh) - kk * hh * (1 - hh);
      const r1 = P.R[j1], rd = Math.sqrt(Math.max(0, b1 + r1 * r1)) / r1;
      const n1 = fbm(u, v, 20, 12, 2, 57);
      const inside = Math.min(e - MW, (rl[j1] - rd) * r1) + (n1 - 0.5) * 0.016;
      if (inside > 0) {
        const surf = fbm(u, v, 16, 10, 3, sd[j1]);
        const ao = 0.6 + 0.4 * smooth(0, 0.045, inside);
        const top = 1 + 0.06 * clamp01(wrapd(vm - P.Y[j1], pv) / r1);   // a little sky light on the top
        const L = tone[j1] * (0.86 + 0.32 * (surf - 0.5) * 1.6) * ao * top;
        const c = col[j1];
        put(T, i, c[0] * L, c[1] * L, c[2] * L, 0.012 + 0.03 * Math.sqrt(smooth(0, 0.07, inside)) + 0.004 * surf);
      } else {
        const m = fbm(u, v, 64, 40, 2, 59);
        const L = (0.86 + 0.18 * (m - 0.5)) * (1 - 0.3 * smooth(-0.014, 0, inside));
        put(T, i, 0.68 * L, 0.65 * L, 0.59 * L, 0.003 * m);
      }
    }
  }
}

/** Running-bond brick: 8 bricks per 2 m, 14 courses per 1.25 m, mixed reds, recessed mortar. */
function paintBrick(T) {
  const NC = 14, CH = T.pv / NC, BW = 0.25, NB = Math.round(T.pu / BW), MW = 0.0055, RC = 0.007;
  const pal = [[0.69, 0.33, 0.24], [0.74, 0.4, 0.28], [0.62, 0.29, 0.22], [0.6, 0.32, 0.25], [0.79, 0.48, 0.35],
    [0.67, 0.37, 0.3], [0.5, 0.27, 0.22], [0.72, 0.36, 0.26]];
  each(T, (i, x, y, u, v, um, vm) => {
    const c = Math.floor(vm / CH), ty = vm - c * CH;
    const xs = um + (c % 2) * BW / 2, k = Math.floor(xs / BW), tx = xs - k * BW, kw = k % NB;
    const qx = Math.abs(tx - BW / 2) - (BW / 2 - MW - RC), qy = Math.abs(ty - CH / 2) - (CH / 2 - MW - RC);
    const sd = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - RC;
    const inside = -sd + (fbm(u, v, 48, 30, 2, 61) - 0.5) * 0.005;
    if (inside > 0) {
      const id = hash(kw, c, 63), cc = pal[(id * pal.length) | 0];
      const speck = fbm(u, v, 200, 120, 1, 65), mottle = fbm(u, v, 24, 16, 2, 67 + kw);
      const flash = 1 - 0.18 * hash(kw, c, 69) * smooth(0.06, 0, Math.min(tx, BW - tx)); // darker ends
      const L = (0.9 + 0.2 * hash(kw, c, 71)) * (0.9 + 0.25 * (mottle - 0.5)) * (1 - 0.14 * smooth(0.3, 0.2, speck)) * flash *
        (0.72 + 0.28 * smooth(0, 0.006, inside));
      put(T, i, cc[0] * L, cc[1] * L, cc[2] * L, 0.011 * smooth(0, 0.005, inside) + 0.0012 * mottle);
    } else {
      const m = fbm(u, v, 96, 64, 2, 73);
      const L = (0.88 + 0.16 * (m - 0.5)) * (1 - 0.25 * smooth(-0.004, 0, inside));
      put(T, i, 0.8 * L, 0.77 * L, 0.71 * L, 0.002 * m);
    }
  });
}

/** Rough sawn vertical boards of uneven widths with gaps, knots and nail heads. */
function paintPlanks(T) {
  const R = rng(81);
  const rows = [makeRow(R, T.pu, 0.16, 0.3)];
  decorate(R, rows);
  const { K, D0, D1 } = rowLookup(rows, T.W, T.pu);
  const row = rows[0];
  const pal = [[0.64, 0.48, 0.32], [0.6, 0.44, 0.29], [0.67, 0.52, 0.36], [0.58, 0.47, 0.36], [0.66, 0.47, 0.3]];
  const knots = [];
  for (let k = 0; k < row.n; k++) knots.push(R() < 0.6 ? { f: 0.25 + 0.5 * R(), v: R() * T.pv, r: 0.012 + 0.012 * R() } : null);
  each(T, (i, x, y, u, v, um, vm) => {
    const k = K[x], du0 = D0[x], du1 = D1[x], w = du0 + du1, e = Math.min(du0, du1);
    const sd = row.seed[k], c = pal[(row.pick[k] * pal.length) | 0];
    const streak = fbm(u, v, 260, 3, 3, sd);
    let rc = (du0 / w) * 6 + 1.6 * fbm(u, v, 5, 4, 2, sd + 3);
    const kn = knots[k];
    let knot = 0;
    if (kn) {
      const ax = (du0 - kn.f * w) / kn.r, ay = wrapd(vm - kn.v, T.pv) / (kn.r * 1.7);
      const dk = Math.hypot(ax, ay);
      knot = smooth(1.0, 0.6, dk);
      rc += 1.4 / (1 + dk * dk) * Math.sign(ax || 1);
    }
    const ring = Math.pow(0.5 + 0.5 * Math.cos(TAU * rc), 6);
    let L = (0.85 + 0.25 * row.tone[k]) * (0.93 + 0.2 * (streak - 0.5) * 1.5 - 0.12 * ring);
    L *= 1 - 0.45 * knot;
    L *= 0.55 + 0.45 * smooth(0.002, 0.012, e);                     // rounded, shadowed board edges
    let h = 0.012 * smooth(0.002, 0.01, e) + 0.0012 * streak - 0.0006 * ring;
    // nails (two per board at the girts)
    for (const nv of [0.09, 0.72]) {
      for (const nf of [0.28, 0.72]) {
        const dn = Math.hypot(du0 - nf * w, wrapd(vm - nv, T.pv));
        if (dn < 0.006) { L *= 0.35 + 0.5 * (dn / 0.006); h += 0.001; }
      }
    }
    if (e < 0.003) { put(T, i, 0.13, 0.09, 0.06, 0); return; }
    put(T, i, c[0] * L, c[1] * L, c[2] * L, h);
  });
}

/** Peeled log surface (one 0.25 m course, logs centred at v = 0.5): lengthwise grain, checks. */
function paintLog(T) {
  const R = rng(91), cracks = [];
  for (let n = 0; n < 7; n++) cracks.push({ t: 0.28 + 0.44 * R(), u0: R(), len: 0.06 + 0.18 * R(), w: 0.006 + 0.008 * R(), a: (R() - 0.5) * 0.04 });
  each(T, (i, x, y, u, v) => {
    const fine = fbm(u, v, 6, 48, 3, 81);
    const broad = fbm(u, v, 4, 3, 2, 83);
    const ring = Math.pow(0.5 + 0.5 * Math.cos(TAU * (v * 7 + 1.3 * fbm(u, v, 5, 3, 2, 85))), 5);
    let L = (0.9 + 0.16 * (fine - 0.5) * 1.6 + 0.08 * (broad - 0.5)) * (1 - 0.08 * ring);
    L *= 0.82 + 0.18 * smooth(0, 0.16, v) * smooth(1, 0.84, v);   // tucked against the chinking
    let h = 0.0018 * fine + 0.003 * broad - 0.0006 * ring;
    for (const c of cracks) {
      const du = wrap(u - c.u0, 1);
      if (du > c.len) continue;
      const taper = Math.sin(Math.PI * du / c.len);
      const dv = Math.abs(v - (c.t + c.a * du / c.len)) - c.w * taper * 0.5;
      if (dv < 0.012) { const k = smooth(0.012, 0, dv) * taper; L *= 1 - 0.4 * k; h -= 0.002 * k; }
    }
    put(T, i, L, L * 0.99, L * 0.96, h);
  });
}

// ---------------------------------------------------------------- roofs (1 m tiles, 4 courses)

function paintRoofShingle(T) {
  const pal = [[0.56, 0.41, 0.29], [0.6, 0.44, 0.31], [0.52, 0.39, 0.29], [0.61, 0.46, 0.33], [0.54, 0.42, 0.33], [0.58, 0.4, 0.28]];
  courses(T, { n: 4, minW: 0.09, maxW: 0.22, jit: 0.007, minGap: 0.035, seed: 201 }, (T, i, S) => {
    const r = S.row, k = S.k, sd = r.seed[k], c = pal[(r.pick[k] * pal.length) | 0];
    const grain = fbm(S.u, S.v, 200, 5, 3, sd);
    const coarse = fbm(S.u, S.v, 36, 3, 2, sd + 5);
    const side = Math.min(S.du0, S.du1);
    const key = smooth(0.0015, 0.005, side);
    const shadow = 1 - 0.55 * Math.exp(-S.dn / 0.01);
    const split = hash(k, S.c, 207) < 0.25 ? Math.abs(S.du0 - S.w * (0.3 + 0.4 * hash(k, S.c, 209))) : 1;
    let L = (0.9 + 0.14 * r.tone[k]) * (0.88 + 0.36 * (grain - 0.5) + 0.1 * (coarse - 0.5)) * shadow;
    if (S.dv < 0.006) L *= 0.82;
    if (split < 0.002) L *= 0.55;
    L *= 0.25 + 0.75 * key;
    const moss = smooth(0.6, 0.72, fbm(S.u, S.v, 6, 6, 3, 211)) * (1 - smooth(0.0, 0.1, S.dv)) * 0.6;
    const h = 0.006 + 0.013 * (1 - S.dv / S.ch) + 0.0025 * grain - 0.008 * (1 - key) - (split < 0.002 ? 0.002 : 0);
    put(T, i, mix(c[0], 0.42, moss) * L, mix(c[1], 0.5, moss) * L, mix(c[2], 0.26, moss) * L, h);
  });
}

function paintRoofSlate(T) {
  const pal = [[0.37, 0.41, 0.47], [0.41, 0.4, 0.46], [0.38, 0.41, 0.44], [0.32, 0.34, 0.39], [0.45, 0.47, 0.52], [0.42, 0.43, 0.49]];
  courses(T, { n: 4, minW: 0.21, maxW: 0.29, jit: 0.003, minGap: 0.075, seed: 221 }, (T, i, S) => {
    const r = S.row, k = S.k, sd = r.seed[k], c = pal[(r.pick[k] * pal.length) | 0];
    const side = Math.min(S.du0, S.du1), RC = 0.022;
    let edge = side;
    if (side < RC && S.dv < RC) edge = RC - Math.hypot(RC - side, RC - S.dv);   // clipped butt corners
    const cleft = fbm(S.u, S.v, 4, 48, 3, sd);
    const speck = fbm(S.u, S.v, 96, 96, 2, sd + 3);
    const shadow = 1 - 0.55 * Math.exp(-S.dn / 0.008);
    let L = (0.86 + 0.26 * r.tone[k]) * (0.9 + 0.22 * (cleft - 0.5) + 0.12 * (speck - 0.5)) * shadow;
    L *= 1 + 0.05 * (1 - S.dv / S.ch);
    if (S.dv < 0.004) L *= 0.82;
    const gap = smooth(0.0008, 0.003, edge);
    L *= 0.3 + 0.7 * gap;
    const h = 0.004 + 0.009 * (1 - S.dv / S.ch) + 0.0012 * cleft - 0.006 * (1 - gap);
    put(T, i, c[0] * L, c[1] * L, c[2] * L, h);
  });
}

/** Painted standing-seam metal (the seams themselves are geometry at u ≡ 0.25 mod 0.5). */
function paintRoofMetal(T) {
  each(T, (i, x, y, u, v, um) => {
    const brushed = fbm(u, v, 120, 2, 2, 231);
    const canning = fbm(u, v, 4, 3, 3, 233);
    const streaks = fbm(u, v, 40, 2, 3, 235);
    const ds = Math.abs(wrapd(um - 0.25, 0.5));                   // distance to the nearest seam
    const pc = Math.abs(wrapd(um, 0.5));                           // distance to the pan centre
    const rib = Math.exp(-Math.pow((Math.abs(pc - 0.085)) / 0.006, 2));
    let L = 0.95 + 0.03 * (brushed - 0.5) + 0.05 * (canning - 0.5) - 0.025 * smooth(0.55, 0.75, streaks);
    L *= 1 - 0.12 * smooth(0.04, 0.0, ds);
    L *= 1 + 0.035 * rib;
    put(T, i, L, L, L, 0.003 * rib + 0.002 * canning + 0.0003 * brushed);
  });
}

/** Thatch: narrow straw bundles with ragged butts, 4 courses per metre. */
function paintThatch(T) {
  const pal = [[0.9, 0.75, 0.45], [0.95, 0.82, 0.55], [0.84, 0.67, 0.4], [0.8, 0.68, 0.47], [0.9, 0.72, 0.43], [0.93, 0.79, 0.5]];
  courses(T, { n: 4, minW: 0.006, maxW: 0.018, jit: 0.024, seed: 241 }, (T, i, S) => {
    const r = S.row, k = S.k, c = pal[(r.pick[k] * pal.length) | 0];
    const strand = fbm(S.u, S.v, 256, 6, 2, (r.seed[k] & 1023) + 3);
    const across = Math.sin(Math.PI * clamp01(S.du0 / S.w));
    const weather = fbm(S.u, S.v, 4, 4, 3, 251);
    const shadow = 1 - 0.55 * Math.exp(-S.dn / 0.028);
    let L = (0.82 + 0.22 * r.tone[k]) * (0.82 + 0.3 * (strand - 0.5) * 2) * (0.82 + 0.18 * across) * shadow;
    if (S.dv < 0.014) L *= 1.06;                                   // cut ends catch the light
    L *= 0.92 + 0.16 * (weather - 0.5);
    const grey = 0.35 * smooth(0.55, 0.7, weather);                // weathered, silvery patches
    const h = 0.02 * (1 - 0.7 * S.dv / S.ch) + 0.003 * strand + 0.002 * across + 0.006 * weather;
    put(T, i, mix(c[0], 0.62, grey) * L, mix(c[1], 0.58, grey) * L, mix(c[2], 0.5, grey) * L, h);
  });
}

/** Terracotta barrel tiles: alternating caps and pans in columns, 4 courses per metre. */
function paintRoofTile(T) {
  const pal = [[0.77, 0.41, 0.26], [0.81, 0.48, 0.31], [0.71, 0.36, 0.23], [0.75, 0.45, 0.32], [0.67, 0.34, 0.23], [0.83, 0.53, 0.35]];
  const row = () => {
    const edges = [];
    for (let q = 0; q <= 8; q++) edges.push(q * 0.125);
    return { off: 1 - 0.0625, edges, n: 8 };                        // even pieces = caps centred on u = 0, 0.25, …
  };
  courses(T, { n: 4, row, jit: 0.004, seed: 261 }, (T, i, S) => {
    const r = S.row, k = S.k, cap = (k & 1) === 0, c = pal[(r.pick[k] * pal.length) | 0];
    const f = clamp01(S.du0 / S.w), q = 2 * f - 1, round = Math.sqrt(Math.max(0, 1 - q * q));
    const prof = cap ? 0.03 + 0.026 * round : 0.012 + 0.018 * q * q;
    const speck = fbm(S.u, S.v, 80, 80, 2, r.seed[k]);
    const mottle = fbm(S.u, S.v, 12, 12, 2, r.seed[k] + 9);
    const shadow = 1 - (cap ? 0.42 : 0.6) * Math.exp(-S.dn / (cap ? 0.01 : 0.016));
    let L = (0.88 + 0.2 * r.tone[k]) * (0.9 + 0.18 * (mottle - 0.5) + 0.1 * (speck - 0.5)) * shadow;
    if (!cap) L *= 0.66 + 0.26 * round;                            // pans sit in the caps' shade
    else L *= 0.8 + 0.26 * round * (0.7 + 0.3 * (1 - q));          // rounded caps, lit from one side
    if (S.dv < 0.007) L *= cap ? 0.6 : 0.82;                        // open end of the cap / pan lip
    const lichen = smooth(0.74, 0.8, fbm(S.u, S.v, 12, 12, 3, 271)) * 0.4;
    const h = prof + 0.012 * (1 - S.dv / S.ch) + 0.0008 * speck;
    put(T, i, mix(c[0], 0.74, lichen) * L, mix(c[1], 0.7, lichen) * L, mix(c[2], 0.46, lichen) * L, h);
  });
}

// ---------------------------------------------------------------- floors (2 m tiles, planks along U)

/** Wide floor planks (8 rows of 0.25 m) with staggered joints; row 0 is one full-length plank. */
function paintBoards(T, o) {
  const R = rng(o.seed), NR = 8, CH = T.pv / NR, rows = [];
  for (let c = 0; c < NR; c++) {
    rows.push(c === 0 ? { off: 0, edges: [0, T.pu], n: 1 } : staggeredRow(R, T.pu, 0.6, 1.35, rows[c - 1], 0.22));
  }
  decorate(R, rows);
  const { K, D0, D1 } = rowLookup(rows, T.W, T.pu);
  const knots = [];
  for (const r of rows) knots.push(r.tone.map(() => (R() < o.knots ? { f: 0.15 + 0.7 * R(), t: 0.3 + 0.4 * R(), r: 0.01 + 0.01 * R() } : null)));
  each(T, (i, x, y, u, v, um, vm) => {
    const c = Math.min(NR - 1, Math.floor(vm / CH)), ty = vm - c * CH, j = c * T.W + x;
    const r = rows[c], k = K[j], du0 = D0[j], du1 = D1[j], w = du0 + du1;
    const sd = r.seed[k], pc = o.pal[(r.pick[k] * o.pal.length) | 0];
    const e = Math.min(du0, du1, ty, CH - ty);
    const streak = fbm(u, v, 5, 360, 3, sd);
    let rc = (ty / CH) * o.rings + 1.1 * fbm(u, v, 2, 6, 2, sd + 1) + 0.2 * fbm(u, v, 6, 16, 2, sd + 2) + r.tone[k] * 3;
    const kn = knots[c][k];
    let knot = 0;
    if (kn) {
      const ax = (du0 - kn.f * w) / (kn.r * 2.2), ay = (ty - kn.t * CH) / kn.r;
      const dk = Math.hypot(ax, ay);
      knot = smooth(1, 0.55, dk);
      rc += 1.2 / (1 + dk * dk);
    }
    const ring = 0.5 + 0.5 * Math.cos(TAU * rc);
    let L = (0.88 + 0.22 * r.tone[k]) * (0.94 + 0.16 * (streak - 0.5) * 1.6 - o.ringK * Math.pow(ring, 5) - 0.05 * ring * ring);
    L *= 1 - 0.5 * knot;
    L *= 0.5 + 0.5 * smooth(0.0008, 0.006, e);
    const h = 0.004 * smooth(0.0008, 0.005, e) + 0.0005 * streak - 0.0003 * ring;
    put(T, i, pc[0] * L, pc[1] * L, pc[2] * L, h);
  });
}

/** Rectangular flagstones in courses of varying height, with worn, slightly irregular edges. */
function paintFlagstone(T) {
  const R = rng(301), hs = [];
  let tot = 0;
  while (tot < T.pv - 0.2) { const h = 0.36 + 0.3 * R(); hs.push(h); tot += h; }
  const kk = T.pv / tot, ys = [0];
  for (const h of hs) ys.push(ys[ys.length - 1] + h * kk);
  ys[ys.length - 1] = T.pv;
  const rows = [];
  for (let c = 0; c < hs.length; c++) rows.push(staggeredRow(R, T.pu, 0.38, 0.85, rows[c - 1], 0.12));
  decorate(R, rows);
  const { K, D0, D1 } = rowLookup(rows, T.W, T.pu);
  const pal = [[0.66, 0.64, 0.6], [0.6, 0.6, 0.6], [0.7, 0.66, 0.58], [0.58, 0.56, 0.52], [0.62, 0.62, 0.64], [0.68, 0.63, 0.56]];
  const MW = 0.007;
  let c = 0;
  each(T, (i, x, y, u, v, um, vm) => {
    if (x === 0) { c = 0; while (c < rows.length - 1 && ys[c + 1] <= vm) c++; }
    const j = c * T.W + x, k = K[j], r = rows[c], sd = r.seed[k];
    const dy = Math.min(vm - ys[c], ys[c + 1] - vm), dx = Math.min(D0[j], D1[j]);
    const RC = 0.02;
    let e = Math.min(dx, dy);
    if (dx < RC && dy < RC) e = RC - Math.hypot(RC - dx, RC - dy);
    e -= MW;
    e += (fbm(u, v, 24, 24, 2, 303) - 0.5) * 0.01;
    if (e > 0) {
      const pc = pal[(r.pick[k] * pal.length) | 0];
      const surf = fbm(u, v, 12, 12, 3, sd), pits = fbm(u, v, 128, 128, 2, sd + 1);
      const L = (0.88 + 0.2 * r.tone[k]) * (0.9 + 0.24 * (surf - 0.5) + 0.06 * (pits - 0.5)) * (0.72 + 0.28 * smooth(0, 0.012, e));
      put(T, i, pc[0] * L, pc[1] * L, pc[2] * L, 0.008 * smooth(0, 0.012, e) + 0.002 * surf);
    } else {
      const m = fbm(u, v, 128, 128, 2, 305), L = 0.9 + 0.15 * (m - 0.5);
      put(T, i, 0.47 * L, 0.44 * L, 0.4 * L, 0.001 * m);
    }
  });
}

/** Checker tiles (0.25 m) with thin grout: light tile tinted by paint, dark tile a deep shade of it. */
function paintCheckerTile(T) {
  const N = Math.round(T.pu / 0.25), GW = 0.0035;
  each(T, (i, x, y, u, v, um, vm) => {
    const ix = Math.floor(um / 0.25), iy = Math.floor(vm / 0.25);
    const tx = um - ix * 0.25, ty = vm - iy * 0.25;
    const e = Math.min(tx, 0.25 - tx, ty, 0.25 - ty) - GW;
    const dark = ((ix + iy) & 1) === 1;
    if (e < 0) { const g = 0.62 + 0.05 * fbm(u, v, 128, 128, 1, 311); put(T, i, g, g * 0.98, g * 0.95, 0); return; }
    const id = hash(ix % N, iy % N, 313);
    const glaze = fbm(u, v, 16, 16, 2, 315);
    let L = (dark ? 0.4 : 0.985) * (0.97 + 0.05 * id) * (0.97 + 0.06 * (glaze - 0.5));
    L *= 0.82 + 0.18 * smooth(0, 0.004, e);
    put(T, i, L, L, L, 0.002 * smooth(0, 0.004, e) + 0.0002 * glaze);
  });
}

/** Weathered porch boards: 8 rows of 0.25 m with dark gaps (the deck piece's real boards line up). */
function paintDeck(T) {
  const R = rng(321), NR = 8, CH = T.pv / NR, G = 0.011;
  const pal = [[0.62, 0.46, 0.32], [0.58, 0.43, 0.3], [0.66, 0.5, 0.35], [0.6, 0.5, 0.41], [0.64, 0.47, 0.32], [0.57, 0.45, 0.34]];
  const rows = [];
  for (let c = 0; c < NR; c++) rows.push({ c: pal[(R() * pal.length) | 0], tone: 0.9 + 0.16 * R(), sd: (R() * 9999) | 0 });
  rows[0].c = pal[0]; rows[0].tone = 1;
  each(T, (i, x, y, u, v, um, vm) => {
    const c = Math.min(NR - 1, Math.floor(vm / CH)), ty = vm - c * CH, r = rows[c];
    const e = Math.min(ty, CH - ty) - G;
    if (e < 0) { put(T, i, 0.14, 0.11, 0.08, 0); return; }
    const streak = fbm(u, v, 4, 320, 3, r.sd);
    const weather = fbm(u, v, 10, 40, 3, r.sd + 1);
    const ring = Math.pow(0.5 + 0.5 * Math.cos(TAU * ((ty / CH) * 5 + 1.6 * fbm(u, v, 3, 8, 2, r.sd + 2))), 5);
    let L = r.tone * (0.92 + 0.2 * (streak - 0.5) * 1.6 + 0.1 * (weather - 0.5) - 0.09 * ring);
    L *= 0.55 + 0.45 * smooth(0, 0.007, e);
    let h = 0.004 * smooth(0, 0.006, e) + 0.0006 * streak;
    if (Math.abs(ty - 0.055) < 0.006 || Math.abs(ty - 0.195) < 0.006) {
      for (const nu of [0.3, 1.0, 1.7]) {
        for (const nt of [0.055, 0.195]) {
          const dn = Math.hypot(wrapd(um - nu, T.pu), ty - nt);
          if (dn < 0.0055) { L *= 0.4 + 0.45 * dn / 0.0055; h -= 0.0005; }
        }
      }
    }
    const grey = 0.25 * smooth(0.45, 0.7, weather);
    put(T, i, mix(r.c[0], 0.6, grey) * L, mix(r.c[1], 0.55, grey) * L, mix(r.c[2], 0.5, grey) * L, h);
  });
}

// ---------------------------------------------------------------- structure & trim (1 m tiles)

/** Generic wood grain along U. o: { base, dark, rings, ringK, streakK, seed, adze }. */
function paintGrain(T, o) {
  each(T, (i, x, y, u, v) => {
    const streak = fbm(u, v, 6, o.fine || 96, 3, o.seed);
    const rc = v * o.rings + 1.1 * fbm(u, v, 2, 3, 2, o.seed + 1) + 0.25 * fbm(u, v, 5, 9, 2, o.seed + 4);
    const ring = Math.pow(0.5 + 0.5 * Math.cos(TAU * rc), 5);
    const adze = o.adze ? 0.5 + 0.5 * Math.cos(TAU * (u * 9 + 0.8 * fbm(u, v, 4, 3, 2, o.seed + 2))) : 0;
    const t = clamp01(0.5 + o.streakK * (streak - 0.5) * 2 + o.ringK * ring + 0.06 * adze);
    const L = 1 + 0.18 * (fbm(u, v, 6, 6, 3, o.seed + 3) - 0.5);
    put(T, i, mix(o.base[0], o.dark[0], t) * L, mix(o.base[1], o.dark[1], t) * L, mix(o.base[2], o.dark[2], t) * L,
      0.0015 * streak - 0.0008 * ring + (o.adze ? 0.0025 * adze : 0));
  });
}

function paintTrim(T) {
  each(T, (i, x, y, u, v) => {
    const brush = fbm(u, v, 3, 48, 2, 401);
    const L = 0.975 + 0.025 * (brush - 0.5) + 0.015 * (fbm(u, v, 6, 6, 2, 403) - 0.5);
    put(T, i, L, L, L * 0.995, 0.0004 * brush);
  });
}

function paintPaintedWood(T) {
  each(T, (i, x, y, u, v) => {
    const streak = fbm(u, v, 5, 80, 3, 411);
    const ring = Math.pow(0.5 + 0.5 * Math.cos(TAU * (v * 9 + 1.1 * fbm(u, v, 2, 3, 2, 413))), 6);
    const wear = smooth(0.66, 0.78, fbm(u, v, 10, 10, 3, 415));
    const L = (0.94 + 0.06 * (streak - 0.5) - 0.05 * ring) * (1 + 0.04 * wear);
    put(T, i, L, L * 0.995, L * 0.985, 0.0008 * streak - 0.0006 * ring);
  });
}

/** Ashlar: cut stone blocks in 0.25 m courses with fine pale joints and a tooled face. */
function paintStoneBlock(T) {
  const R = rng(421), NR = Math.round(T.pv / 0.25), CH = T.pv / NR, rows = [];
  for (let c = 0; c < NR; c++) rows.push(staggeredRow(R, T.pu, 0.32, 0.66, rows[c - 1], 0.1));
  decorate(R, rows);
  const { K, D0, D1 } = rowLookup(rows, T.W, T.pu);
  const pal = [[0.68, 0.65, 0.6], [0.63, 0.62, 0.59], [0.7, 0.66, 0.58], [0.6, 0.59, 0.56], [0.66, 0.62, 0.55], [0.64, 0.64, 0.62]];
  const MW = 0.0045, RC = 0.012;
  each(T, (i, x, y, u, v, um, vm) => {
    const c = Math.min(NR - 1, Math.floor(vm / CH)), ty = vm - c * CH, j = c * T.W + x;
    const r = rows[c], k = K[j], dx = Math.min(D0[j], D1[j]) - MW, dy = Math.min(ty, CH - ty) - MW;
    let e = Math.min(dx, dy);
    if (dx < RC && dy < RC) e = RC - Math.hypot(RC - dx, RC - dy);
    e += (fbm(u, v, 40, 20, 2, 423) - 0.5) * 0.004;
    if (e > 0) {
      const pc = pal[(r.pick[k] * pal.length) | 0], sd = r.seed[k];
      const tool = fbm(u, v, 160, 80, 2, sd), surf = fbm(u, v, 12, 6, 3, sd + 1);
      const L = (0.9 + 0.16 * r.tone[k]) * (0.92 + 0.08 * (tool - 0.5) + 0.16 * (surf - 0.5)) * (0.82 + 0.18 * smooth(0, 0.01, e)) *
        (1 + 0.04 * clamp01((ty - CH * 0.5) / (CH * 0.5)));
      put(T, i, pc[0] * L, pc[1] * L, pc[2] * L, 0.008 * smooth(0, 0.01, e) + 0.0008 * tool + 0.0015 * surf);
    } else {
      const m = fbm(u, v, 128, 64, 2, 425), L = (0.9 + 0.12 * (m - 0.5)) * (1 - 0.18 * smooth(-0.004, 0, e));
      put(T, i, 0.7 * L, 0.68 * L, 0.64 * L, 0.0005 * m);
    }
  });
}

/** Forged iron: hammer dimples and a little mottling (tinted dark by the material colour). */
function paintIron(T) {
  each(T, (i, x, y, u, v) => {
    const C = cellular(u, v, 18, 18, 431, 0.85);
    const dimple = smooth(0, 0.7, C.d);
    const m = fbm(u, v, 8, 8, 3, 433);
    const L = 0.84 + 0.14 * (m - 0.5) * 2 + 0.06 * dimple;
    put(T, i, L, L, L, 0.0012 * dimple + 0.0008 * m);
  });
}

/** Soft plain weave (tinted): 16 threads per 0.25 m tile. */
function paintFabric(T) {
  const N = 16;
  each(T, (i, x, y, u, v) => {
    const a = u * N, b = v * N, ia = Math.floor(a), ib = Math.floor(b), fa = a - ia, fb = b - ib;
    const pa = Math.sin(Math.PI * fa), pb = Math.sin(Math.PI * fb);
    const warp = ((ia + ib) & 1) === 0;
    const prof = warp ? pa * (0.7 + 0.3 * pb) : pb * (0.7 + 0.3 * pa);
    const heather = fbm(u, v, 16, 16, 2, 441), slub = fbm(u, v, warp ? 32 : 2, warp ? 2 : 32, 2, 443);
    const L = (0.8 + 0.18 * prof) * (0.95 + 0.1 * (heather - 0.5) + 0.06 * (slub - 0.5));
    put(T, i, L, L, L, 0.0015 * prof);
  });
}

// ---------------------------------------------------------------- nature

/** Leaf structure shared by every season: three overlapping oval leaves per cell of a 12×12 grid. */
let leafCache = null;
function leafStructure(W, H) {
  if (leafCache && leafCache.W === W && leafCache.H === H) return leafCache;
  const N = W * H, id = new Int32Array(N), dome = new Float32Array(N), vein = new Float32Array(N), up = new Float32Array(N);
  const G = 12, NL = 3, TB = cellTable(G, NL, 6, 501, 17), NF = G * G * NL;
  const CA = new Float32Array(NF), SA = new Float32Array(NF), LEN = new Float32Array(NF), WID = new Float32Array(NF);
  for (let f = 0; f < NF; f++) {
    const o = f * 6, ang = TB[o + 2] * Math.PI;
    CA[f] = Math.cos(ang); SA[f] = Math.sin(ang);
    LEN[f] = 0.5 + 0.35 * TB[o + 3]; WID[f] = LEN[f] * (0.4 + 0.15 * TB[o + 4]);
  }
  for (let y = 0, i = 0; y < H; y++) {
    const v = (y + 0.5) / H, gy = v * G, yi = Math.floor(gy);
    for (let x = 0; x < W; x++, i++) {
      const u = (x + 0.5) / W, gx = u * G, xi = Math.floor(gx);
      let best = -1, bz = -1e9, bd = 0, bv = 0, bu = 0;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const cx = wrap(xi + ox, G), cy = wrap(yi + oy, G);
        for (let l = 0; l < NL; l++) {
          const f = (cy * G + cx) * NL + l, o = f * 6;
          const dx = gx - (xi + ox + TB[o]), dy = gy - (yi + oy + TB[o + 1]);
          if (dx * dx + dy * dy > 0.81) continue;
          const a = (dx * CA[f] + dy * SA[f]) / LEN[f], b = (-dx * SA[f] + dy * CA[f]) / WID[f];
          if (a <= -1 || a >= 1) continue;
          const r = a * a + b * b * (1 + 0.55 * a);                    // egg-shaped leaf
          if (r >= 1) continue;
          const z = TB[o + 5] + (1 - r) * 0.35;
          if (z > bz) { bz = z; best = f; bd = Math.sqrt(1 - r); bv = Math.abs(b); bu = dy / LEN[f]; }
        }
      }
      id[i] = best; dome[i] = bd; vein[i] = best >= 0 ? smooth(0.12, 0.0, bv) : 0; up[i] = bu;
    }
  }
  leafCache = { W, H, id, dome, vein, up };
  return leafCache;
}

const LEAF_PAL = {
  spring: { leaf: [[0.5, 0.74, 0.32], [0.58, 0.8, 0.36], [0.45, 0.68, 0.3], [0.64, 0.83, 0.4], [0.54, 0.76, 0.3]],
    bg: [0.2, 0.34, 0.15], bloom: [[0.99, 0.74, 0.84], [1.0, 0.95, 0.94], [0.98, 0.83, 0.89], [0.99, 0.66, 0.78]] },
  summer: { leaf: [[0.3, 0.52, 0.22], [0.36, 0.58, 0.25], [0.26, 0.46, 0.2], [0.44, 0.64, 0.28], [0.33, 0.55, 0.26]], bg: [0.13, 0.24, 0.11] },
  autumn: { leaf: [[0.93, 0.55, 0.18], [0.84, 0.31, 0.15], [0.96, 0.74, 0.26], [0.76, 0.44, 0.19], [0.68, 0.6, 0.25], [0.9, 0.45, 0.2]],
    bg: [0.32, 0.18, 0.1] },
  winter: { leaf: [[0.28, 0.4, 0.28], [0.33, 0.44, 0.3], [0.25, 0.36, 0.26], [0.36, 0.42, 0.3]], bg: [0.1, 0.14, 0.1], frost: true },
};

function paintLeaves(T, season) {
  const P = LEAF_PAL[season] || LEAF_PAL.summer;
  const L0 = leafStructure(T.W, T.H);
  each(T, (i, x, y, u, v) => {
    const clump = fbm(u, v, 3, 3, 3, 521);
    const light = 0.8 + 0.42 * (clump - 0.5) * 1.6;
    const lid = L0.id[i];
    let keep = lid >= 0;
    if (keep && P.keep !== undefined) keep = hash(lid, 7, 523) < P.keep;
    let r, g, b, h;
    if (!keep) {
      // gaps between leaves: soft deep shade (winter: bare grey-brown twigs)
      const c = P.bg, L = (0.82 + 0.36 * (fbm(u, v, 24, 24, 2, 525) - 0.5)) * light;
      r = c[0] * L; g = c[1] * L; b = c[2] * L; h = -0.003;
      if (P.frost) {
        const t1 = Math.abs(fbm(u, v, 4, 4, 3, 527) - 0.5), t2 = Math.abs(fbm(u, v, 8, 8, 2, 528) - 0.5), t3 = Math.abs(fbm(u, v, 14, 14, 2, 529) - 0.5);
        const twig = Math.max(smooth(0.03, 0.01, t1), 0.85 * smooth(0.024, 0.008, t2), 0.7 * smooth(0.02, 0.006, t3));
        r = mix(r, 0.3, twig); g = mix(g, 0.24, twig); b = mix(b, 0.2, twig); h += 0.004 * twig;
      }
    } else {
      const c = P.leaf[(hash(lid, 3, 531) * P.leaf.length) | 0], d = L0.dome[i];
      const L = (0.7 + 0.36 * d) * light * (1 + 0.1 * L0.vein[i]) * (0.92 + 0.16 * hash(lid, 5, 533));
      r = c[0] * L; g = c[1] * L; b = c[2] * L; h = 0.005 * d + 0.003 * hash(lid, 9, 535);
      if (P.frost) {
        const f = smooth(0.2, 0.55, L0.up[i]) * 0.85;            // a cap of snow on the upper rim of each leaf
        r = mix(r, 0.92, f); g = mix(g, 0.95, f); b = mix(b, 0.98, f);
      }
    }
    if (P.frost) {
      // rime: a fine sparkle of frost over everything
      const rime = 0.12 * smooth(0.45, 0.75, fbm(u, v, 12, 12, 2, 553));
      r = mix(r, 0.93, rime); g = mix(g, 0.95, rime); b = mix(b, 0.99, rime);
    }
    if (P.bloom) {
      // a hint of blossom: little five-petal flowers scattered over the leaves
      const C = cellular(u, v, 9, 9, 541, 0.8);
      if (hash(C.id, 1, 543) < 0.42) {
        const R = 0.26 + 0.1 * hash(C.id, 2, 545), th = Math.atan2(C.dy, C.dx) + hash(C.id, 3, 547) * 3;
        const edge = R * (0.7 + 0.3 * Math.abs(Math.cos(2.5 * th)));
        if (C.d < edge) {
          const pc = P.bloom[(hash(C.id, 4, 549) * P.bloom.length) | 0], k = 0.88 + 0.14 * (1 - C.d / edge);
          if (C.d < R * 0.26) { r = 0.98; g = 0.84; b = 0.38; } else { r = pc[0] * k; g = pc[1] * k; b = pc[2] * k; }
          h = 0.008 + 0.002 * (1 - C.d / edge);
        }
      }
    }
    put(T, i, r, g, b, h);
  });
}

/** Pine needles: radiating needle tufts (leavesDark). */
function paintNeedles(T, season) {
  const G = 7, NL = 2, TB = cellTable(G, NL, 4, 601, 13);
  each(T, (i, x, y, u, v) => {
    const gx = u * G, gy = v * G, xi = Math.floor(gx), yi = Math.floor(gy);
    let bz = -1e9, bd = 0, bn = 0, br = 0, bdy = 0, bdx = 0, bs = 0;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      const cx = wrap(xi + ox, G), cy = wrap(yi + oy, G);
      for (let l = 0; l < NL; l++) {
        const o = ((cy * G + cx) * NL + l) * 4;
        const rad = 0.55 + 0.35 * TB[o + 2];
        const dx = gx - (xi + ox + TB[o]), dy = gy - (yi + oy + TB[o + 1]), rr = Math.sqrt(dx * dx + dy * dy) / rad;
        if (rr >= 1) continue;
        const z = TB[o + 3] + (1 - rr) * 0.5;
        if (z > bz) { bz = z; bd = 1 - rr * rr; br = rr; bdy = dy / rad; bdx = dx / rad; bs = 601 + l * 13 + cy * G + cx; }
      }
    }
    if (bz > -1e8) bn = vnoise((Math.atan2(bdy, bdx) / TAU + 0.5) * 48, br * 3, 48, 4096, bs);
    const clump = fbm(u, v, 3, 3, 3, 611);
    const light = 0.7 + 0.5 * (clump - 0.5) * 1.6;
    if (bz < -1e8) { const L = 0.8 * light; put(T, i, 0.1 * L, 0.18 * L, 0.12 * L, -0.004); return; }
    const needle = smooth(0.35, 0.75, bn);
    let L = (0.55 + 0.4 * bd) * (0.75 + 0.4 * needle) * light;
    let c = [0.26, 0.46, 0.31];
    if (season === 'spring') { const tip = smooth(0.6, 0.95, br); c = [mix(0.26, 0.5, tip), mix(0.46, 0.72, tip), mix(0.31, 0.34, tip)]; }
    if (season === 'autumn') c = [0.3, 0.44, 0.29];
    let r = c[0] * L, g = c[1] * L, b = c[2] * L;
    if (season === 'winter') {
      const f = smooth(0.0, 0.6, bdy) * smooth(0.3, 0.9, br) * 0.8 + 0.25 * smooth(0.6, 0.7, fbm(u, v, 40, 40, 2, 613));
      r = mix(r, 0.9, f); g = mix(g, 0.94, f); b = mix(b, 0.98, f);
    }
    put(T, i, r, g, b, 0.006 * bd + 0.0015 * needle + 0.004 * clump);
  });
}

/** Furrowed bark with vertical plates (cylinder trunks: u around, v up). */
function paintBark(T) {
  each(T, (i, x, y, u, v) => {
    const warp = fbm(u, v, 3, 2, 2, 701);
    const ridge = fbm(wrap(u + 0.06 * (warp - 0.5), 1), v, 10, 3, 3, 703);
    const plate = smooth(0.4, 0.62, ridge);
    const cross = smooth(0.62, 0.7, fbm(u, v, 6, 12, 2, 705));
    const fine = fbm(u, v, 48, 64, 2, 707);
    const top = plate * (1 - 0.7 * cross);
    const L = 0.85 + 0.3 * (fine - 0.5);
    const lichen = smooth(0.7, 0.78, fbm(u, v, 8, 8, 3, 709)) * top * 0.6;
    const r = mix(0.2, 0.47, top) * L, g = mix(0.14, 0.36, top) * L, b = mix(0.1, 0.27, top) * L;
    put(T, i, mix(r, 0.6, lichen), mix(g, 0.62, lichen), mix(b, 0.5, lichen), 0.014 * top + 0.0015 * fine);
  });
}

/** Grass (tinted by season): clumpy blade speckle, neutral greens. */
function paintGrass(T) {
  each(T, (i, x, y, u, v) => {
    const clump = fbm(u, v, 6, 6, 3, 801);
    const blades = fbm(u, v, 160, 48, 2, 803);
    const fine = fbm(u, v, 96, 96, 1, 805);
    const fleck = hash(i, 0, 807) > 0.985 ? 0.12 : 0;
    const L = 0.8 + 0.1 * (clump - 0.5) * 1.6 + 0.16 * (blades - 0.5) * 1.6 + 0.06 * (fine - 0.5) + fleck;
    const warm = smooth(0.5, 0.7, fbm(u, v, 8, 8, 2, 809)) * 0.05;
    put(T, i, L * (1 + warm), L, L * (0.95 - warm), 0.004 * blades + 0.003 * clump);
  });
}

function paintDirt(T) {
  each(T, (i, x, y, u, v) => {
    const C = cellular(u, v, 14, 14, 811, 0.9);
    const clod = smooth(0.75, 0.1, C.d);
    const m = fbm(u, v, 8, 8, 3, 813), fine = fbm(u, v, 96, 96, 2, 815);
    let r = 0.43, g = 0.31, b = 0.22;
    let L = (0.8 + 0.3 * clod) * (0.9 + 0.25 * (m - 0.5)) * (0.9 + 0.2 * (fine - 0.5));
    let h = 0.006 * clod + 0.002 * fine;
    const P = cellular(u, v, 22, 22, 817, 0.8);
    const pr = 0.12 + 0.14 * hash(P.id, 1, 819);
    if (hash(P.id, 2, 821) < 0.12 && P.d < pr) {
      const k = Math.sqrt(1 - (P.d / pr) ** 2), t = 0.42 + 0.2 * hash(P.id, 3, 823);
      r = t * 1.1; g = t; b = t * 0.85; L = 0.8 + 0.3 * k; h += 0.004 * k;
    }
    put(T, i, r * L, g * L, b * L, h);
  });
}

function paintPathStone(T) {
  each(T, (i, x, y, u, v) => {
    const m = fbm(u, v, 6, 6, 4, 831), grain = fbm(u, v, 128, 128, 1, 833), pit = fbm(u, v, 48, 48, 2, 835);
    let L = (0.9 + 0.22 * (m - 0.5) * 1.6) * (0.95 + 0.1 * (grain - 0.5)) * (1 - 0.1 * smooth(0.36, 0.26, pit));
    if (hash(x, y, 837) > 0.993) L *= 0.8;
    const lich = smooth(0.7, 0.76, fbm(u, v, 10, 10, 3, 839)) * 0.45;
    put(T, i, mix(0.73, 0.74, lich) * L, mix(0.7, 0.73, lich) * L, mix(0.64, 0.5, lich) * L, 0.003 * m + 0.0008 * grain - 0.0006 * smooth(0.36, 0.26, pit));
  });
}

/** Hay: crossing golden straws (three integer-slope directions keep the tile seamless). */
function paintHay(T) {
  const dirs = [[1, 0], [4, 1], [4, -1], [3, 1]];
  each(T, (i, x, y, u, v) => {
    let best = 0, bl = 0;
    for (let d = 0; d < dirs.length; d++) {
      const [a, b] = dirs[d];
      const along = wrap(u * a + v * b, 1), across = wrap(-u * b + v * a, 1);
      const s = vnoise(along * 6, across * 160, 6, 160, 851 + d * 7);
      const t = smooth(0.52, 0.8, s) * (1 - d * 0.08);
      if (t > best) { best = t; bl = s; }
    }
    const m = fbm(u, v, 6, 6, 2, 861);
    const L = (0.55 + 0.55 * best) * (0.9 + 0.2 * (m - 0.5));
    const green = smooth(0.6, 0.75, m) * 0.15;
    put(T, i, mix(0.9, 0.75, green) * L, mix(0.78, 0.8, green) * L, mix(0.44, 0.4, green) * L, 0.004 * best + 0.001 * bl);
  });
}

function paintWater(T) {
  each(T, (i, x, y, u, v) => {
    const a = fbm(u, v, 6, 6, 3, 901), b = fbm(u, v, 16, 10, 2, 903);
    const rip = a * 0.7 + b * 0.3;
    const L = 0.9 + 0.12 * smooth(0.55, 0.7, rip);
    put(T, i, L, L, L, 0.01 * rip);
  });
}

function paintPetal(T) {
  each(T, (i, x, y, u, v) => {
    const vein = Math.pow(0.5 + 0.5 * Math.cos(TAU * (u * 9 + 0.6 * fbm(u, v, 3, 2, 2, 911))), 4);
    const L = 0.9 + 0.08 * (fbm(u, v, 4, 4, 2, 913) - 0.5) * 2 - 0.05 * vein;
    put(T, i, L, L, L, 0.0005 * vein);
  });
}

function paintPumpkin(T) {
  each(T, (i, x, y, u, v) => {
    const f = wrap(u * 10, 1), prof = Math.pow(Math.sin(Math.PI * f), 0.6);
    const m = fbm(u, v, 20, 6, 2, 921);
    const L = (0.68 + 0.32 * prof) * (0.94 + 0.12 * (m - 0.5));
    put(T, i, L, L * (0.96 + 0.04 * prof), L * 0.9, 0.02 * prof);
  });
}

function paintCeramic(T) {
  each(T, (i, x, y, u, v) => {
    const pool = fbm(u, v, 4, 4, 2, 931);
    let L = 0.965 + 0.04 * (pool - 0.5);
    if (hash(x, y, 933) > 0.996) L *= 0.78;
    put(T, i, L, L, L * 0.99, 0);
  });
}

/** Book spines of many colours, varying heights, some with gilt bands. */
function paintBooks(T) {
  const R = rng(941);
  const rows = [makeRow(R, T.pu, 0.022, 0.05)];
  decorate(R, rows);
  const { K, D0, D1 } = rowLookup(rows, T.W, T.pu);
  const pal = [[0.6, 0.18, 0.16], [0.2, 0.4, 0.28], [0.16, 0.22, 0.4], [0.75, 0.55, 0.2], [0.45, 0.28, 0.18], [0.85, 0.8, 0.68],
    [0.2, 0.45, 0.45], [0.4, 0.2, 0.35], [0.7, 0.35, 0.25], [0.3, 0.3, 0.32]];
  const r0 = rows[0];
  each(T, (i, x, y, u, v) => {
    const k = K[x], w = D0[x] + D1[x], f = D0[x] / w, c = pal[(r0.pick[k] * pal.length) | 0];
    const top = 0.78 + 0.2 * r0.tone[k];
    if (v > top) { const L = 0.6 + 0.4 * smooth(top + 0.05, top, v); put(T, i, 0.12 * L, 0.08 * L, 0.06 * L, -0.004); return; }
    const round = Math.sin(Math.PI * f);
    let L = (0.62 + 0.45 * round) * (0.92 + 0.1 * (fbm(u, v, 40, 20, 2, 943) - 0.5));
    let cc = c;
    const s = r0.seed[k] % 4;
    const band = (b) => Math.abs(v - b * top) < 0.012;
    if (s < 2 && (band(0.12) || band(0.88) || (s === 0 && (band(0.16) || band(0.84))))) cc = [0.86, 0.7, 0.34];
    else if (s === 2 && v > 0.45 * top && v < 0.62 * top && f > 0.18 && f < 0.82) cc = [0.88, 0.84, 0.72];
    if (Math.min(D0[x], D1[x]) < 0.0015) L *= 0.4;
    put(T, i, cc[0] * L, cc[1] * L, cc[2] * L, 0.004 * round);
  });
}

// ---------------------------------------------------------------- glass & glow

/** Window glass: soft diagonal sky reflections (map) and a gently uneven interior glow (emissive). */
function paintGlass(T) {
  T.em = new Float32Array(T.W * T.H);
  each(T, (i, x, y, u, v) => {
    const q = wrap(u + v, 1);
    const wide = smooth(0.16, 0.0, Math.abs(q - 0.3)), thin = smooth(0.035, 0.0, Math.abs(q - 0.52));
    const m = fbm(u, v, 3, 3, 2, 951);
    const L = 0.8 + 0.2 * Math.max(wide, thin) + 0.05 * (m - 0.5);
    put(T, i, L, L, L, 0);
    T.em[i] = 0.78 + 0.22 * fbm(u, v, 2, 3, 2, 953);
  });
}

/** Embers: dark coals with glowing cracks (map + emissive). */
function paintEmber(T) {
  T.em = new Float32Array(T.W * T.H);
  each(T, (i, x, y, u, v) => {
    const C = cellular(u, v, 9, 6, 961, 0.9);
    const crack = smooth(0.12, 0.0, C.d2 - C.d);
    const hot = fbm(u, v, 4, 4, 3, 963);
    const L = 0.35 + 0.4 * hash(C.id, 1, 965);
    put(T, i, 0.2 * L + 0.8 * crack, 0.1 * L + 0.4 * crack, 0.06 * L + 0.1 * crack, 0.01 * smooth(0, 0.3, C.d2 - C.d));
    T.em[i] = clamp01(0.08 + 0.95 * crack + 0.5 * smooth(0.5, 0.75, hot) * (1 - crack));
  });
}

// ===================================================================== texture & material specs

// Texture definitions: size (px), period (m), painter, normal strength (0 = no normal map).
const TEX = {
  clapboard:     { w: 512, h: 320, pu: 2, pv: 1.25, ns: 1, tint: true, paint: paintClapboard },
  boardBatten:   { w: 512, h: 320, pu: 2, pv: 1.25, ns: 1, tint: true, paint: paintBoardBatten },
  shingleSiding: { w: 512, h: 320, pu: 2, pv: 1.25, ns: 1, tint: true, paint: paintShingleSiding },
  plaster:       { w: 256, h: 160, pu: 2, pv: 1.25, ns: 1, tint: true, paint: paintPlaster },
  stone:         { w: 512, h: 320, pu: 2, pv: 1.25, ns: 1, paint: paintFieldstone },
  brick:         { w: 512, h: 320, pu: 2, pv: 1.25, ns: 1, paint: paintBrick },
  planks:        { w: 512, h: 320, pu: 2, pv: 1.25, ns: 1, paint: paintPlanks },
  log:           { w: 256, h: 128, pu: 2, pv: 0.25, ns: 1, tint: true, paint: paintLog },
  roofShingle:   { w: 256, h: 256, pu: 1, pv: 1, ns: 1, paint: paintRoofShingle },
  roofSlate:     { w: 256, h: 256, pu: 1, pv: 1, ns: 1, paint: paintRoofSlate },
  roofMetal:     { w: 256, h: 256, pu: 1, pv: 1, ns: 1, tint: true, paint: paintRoofMetal },
  roofThatch:    { w: 256, h: 256, pu: 1, pv: 1, ns: 1, paint: paintThatch },
  roofTile:      { w: 256, h: 256, pu: 1, pv: 1, ns: 1, paint: paintRoofTile },
  floorOak:      { w: 384, h: 384, pu: 2, pv: 2, ns: 1, paint: (T) => paintBoards(T, { seed: 331, rings: 6, ringK: 0.14, knots: 0.06,
    pal: [[0.68, 0.48, 0.3], [0.64, 0.45, 0.28], [0.72, 0.52, 0.33], [0.6, 0.42, 0.26], [0.7, 0.5, 0.34]] }) },
  floorPine:     { w: 384, h: 384, pu: 2, pv: 2, ns: 1, paint: (T) => paintBoards(T, { seed: 341, rings: 4, ringK: 0.2, knots: 0.3,
    pal: [[0.86, 0.68, 0.45], [0.83, 0.64, 0.41], [0.88, 0.72, 0.5], [0.8, 0.62, 0.4], [0.85, 0.66, 0.42]] }) },
  floorStone:    { w: 384, h: 384, pu: 2, pv: 2, ns: 1, paint: paintFlagstone },
  floorTile:     { w: 256, h: 256, pu: 2, pv: 2, ns: 1, tint: true, cal: false, paint: paintCheckerTile },
  deck:          { w: 384, h: 384, pu: 2, pv: 2, ns: 1, paint: paintDeck },
  timber:        { w: 256, h: 256, pu: 1, pv: 1, ns: 1, paint: (T) => paintGrain(T, { seed: 351, base: [0.42, 0.3, 0.2], dark: [0.24, 0.16, 0.1],
    rings: 11, ringK: 0.12, streakK: 0.18, fine: 48, adze: true }) },
  wood:          { w: 256, h: 256, pu: 1, pv: 1, ns: 1, paint: (T) => paintGrain(T, { seed: 361, base: [0.86, 0.68, 0.46], dark: [0.66, 0.45, 0.26],
    rings: 9, ringK: 0.26, streakK: 0.3 }) },
  trim:          { w: 128, h: 128, pu: 1, pv: 1, ns: 1, tint: true, paint: paintTrim },
  paintedWood:   { w: 256, h: 256, pu: 1, pv: 1, ns: 1, tint: true, paint: paintPaintedWood },
  stoneBlock:    { w: 512, h: 256, pu: 2, pv: 1, ns: 1, paint: paintStoneBlock },
  iron:          { w: 128, h: 128, pu: 0.5, pv: 0.5, ns: 1, tint: true, paint: paintIron },
  fabric:        { w: 128, h: 128, pu: 0.25, pv: 0.25, ns: 1, tint: true, paint: paintFabric },
  leaves:        { w: 256, h: 256, pu: 0.5, pv: 0.5, ns: 0.6, calSkip: ['winter'], paint: paintLeaves },
  needles:       { w: 256, h: 256, pu: 0.5, pv: 0.5, ns: 0.6, ref: 'leavesDark', paint: paintNeedles },
  bark:          { w: 128, h: 256, pu: 0.5, pv: 1, ns: 1, paint: paintBark },
  grass:         { w: 256, h: 256, pu: 2, pv: 2, ns: 1, tint: true, paint: paintGrass },
  dirt:          { w: 256, h: 256, pu: 1, pv: 1, ns: 1, paint: paintDirt },
  path:          { w: 256, h: 256, pu: 1, pv: 1, ns: 1, paint: paintPathStone },
  hay:           { w: 256, h: 256, pu: 0.5, pv: 0.5, ns: 1, paint: paintHay },
  water:         { w: 256, h: 256, pu: 2, pv: 2, ns: 1, tint: true, paint: paintWater },
  petal:         { w: 64, h: 64, pu: 0.2, pv: 0.2, ns: 0, tint: true, paint: paintPetal },
  pumpkin:       { w: 128, h: 128, pu: 1, pv: 1, ns: 1, tint: true, paint: paintPumpkin },
  ceramic:       { w: 128, h: 128, pu: 0.5, pv: 0.5, ns: 0, tint: true, paint: paintCeramic },
  book:          { w: 256, h: 128, pu: 0.5, pv: 0.25, ns: 1, paint: paintBooks },
  glass:         { w: 128, h: 128, pu: 1, pv: 1, ns: 0, tint: true, cal: false, paint: paintGlass },
  ember:         { w: 128, h: 128, pu: 0.5, pv: 0.5, ns: 1, cal: false, paint: paintEmber },
};

// Material look: tex (texture key), tint (material.color tints a neutral texture; otherwise the texture
// carries the colour and material.color is white), rough/metal, ns (normalScale), glow, glass.
const SPEC = {
  log:           { tex: 'log', tint: true, rough: 0.8, ns: 1 },
  logDark:       { tex: 'log', tint: true, rough: 0.84, ns: 1 },
  clapboard:     { tex: 'clapboard', tint: true, rough: 0.78, ns: 1 },
  boardBatten:   { tex: 'boardBatten', tint: true, rough: 0.8, ns: 1 },
  shingleSiding: { tex: 'shingleSiding', tint: true, rough: 0.86, ns: 1 },
  plaster:       { tex: 'plaster', tint: true, rough: 0.94, ns: 1 },
  stone:         { tex: 'stone', rough: 0.9, ns: 1 },
  brick:         { tex: 'brick', rough: 0.88, ns: 1 },
  planks:        { tex: 'planks', rough: 0.86, ns: 1 },
  glass:         { tex: 'glass', tint: true, rough: 0.06, metal: 0.1, glass: { day: 0.32, night: 0.32 } },
  roofShingle:   { tex: 'roofShingle', rough: 0.88, ns: 1 },
  roofSlate:     { tex: 'roofSlate', rough: 0.62, ns: 1 },
  roofMetal:     { tex: 'roofMetal', tint: true, rough: 0.42, metal: 0.3, ns: 1 },
  roofThatch:    { tex: 'roofThatch', rough: 0.96, ns: 1 },
  roofTile:      { tex: 'roofTile', rough: 0.72, ns: 1 },
  floorOak:      { tex: 'floorOak', rough: 0.6, ns: 1 },
  floorPine:     { tex: 'floorPine', rough: 0.64, ns: 1 },
  floorStone:    { tex: 'floorStone', rough: 0.8, ns: 1 },
  floorTile:     { tex: 'floorTile', tint: true, rough: 0.38, ns: 1 },
  deck:          { tex: 'deck', rough: 0.86, ns: 1 },
  timber:        { tex: 'timber', rough: 0.8, ns: 1 },
  wood:          { tex: 'wood', rough: 0.7, ns: 1 },
  trim:          { tex: 'trim', tint: true, rough: 0.6, ns: 1 },
  paintedWood:   { tex: 'paintedWood', tint: true, rough: 0.66, ns: 1 },
  stoneBlock:    { tex: 'stoneBlock', rough: 0.86, ns: 1 },
  iron:          { tex: 'iron', tint: true, rough: 0.48, metal: 0.5, ns: 1 },
  windowGlass:   { tex: 'glass', tint: true, rough: 0.05, metal: 0.1,
    glass: { day: 0.5, night: 0.94 }, glow: { color: '#ffae52', base: 0, night: 1.0 } },
  fabric:        { tex: 'fabric', tint: true, rough: 0.96, ns: 1 },
  leaves:        { tex: 'leaves', season: true, rough: 0.82, ns: 1 },
  leavesDark:    { tex: 'needles', season: true, rough: 0.86, ns: 1 },
  bark:          { tex: 'bark', rough: 0.95, ns: 1 },
  grass:         { tex: 'grass', tint: true, season: true, rough: 0.96, ns: 1 },
  dirt:          { tex: 'dirt', rough: 1, ns: 1 },
  path:          { tex: 'path', rough: 0.9, ns: 1 },
  hay:           { tex: 'hay', rough: 0.95, ns: 1 },
  water:         { tex: 'water', tint: true, rough: 0.12, ns: 1, water: true },
  ember:         { tex: 'ember', rough: 0.9, ns: 1, glow: { base: 0.7, night: 1.8 } },
  lampGlow:      { rough: 0.5, glow: { base: 0.6, night: 1.6 } },
  petalPink:     { tex: 'petal', tint: true, rough: 0.7 },
  petalYellow:   { tex: 'petal', tint: true, rough: 0.7 },
  petalWhite:    { tex: 'petal', tint: true, rough: 0.7 },
  petalPurple:   { tex: 'petal', tint: true, rough: 0.7 },
  pumpkin:       { tex: 'pumpkin', tint: true, rough: 0.6, ns: 1 },
  ceramic:       { tex: 'ceramic', tint: true, rough: 0.28 },
  book:          { tex: 'book', rough: 0.8, ns: 1 },
};

const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
const GRASS_TINT = { spring: '#a4cd66', summer: '#8fb35e', autumn: '#bfae62', winter: '#d3ded6' };

const texCache = new Map();

const lum = (r, g, b) => 0.3 * r + 0.59 * g + 0.11 * b;
/**
 * Keep the overall brightness of a texture honest: tinted textures average ≈ 0.93 (so a paint colour
 * looks like its swatch), colour-carrying ones average the luminance of their material's swatch.
 */
function calibrate(T, d, name, variant) {
  if (d.cal === false || (d.calSkip && d.calSkip.includes(variant))) return;
  const c = T.col, N = T.W * T.H;
  let sum = 0;
  for (let i = 0; i < N; i++) sum += lum(c[i * 3], c[i * 3 + 1], c[i * 3 + 2]);
  const mean = sum / N;
  let target = 0.93;
  const ref = MATERIALS[d.ref || name];
  if (!d.tint && ref) {
    const col = new THREE.Color(ref.color);   // linear
    col.convertLinearToSRGB();
    target = lum(col.r, col.g, col.b) * 0.98;
  }
  const k = Math.min(1.6, Math.max(0.85, target / Math.max(mean, 1e-3)));
  for (let i = 0; i < c.length; i++) c[i] *= k;
}

/** Texture set for a key ('clapboard', 'leaves:autumn', …): { map, normalMap, emissiveMap }. Lazy. */
function getTex(key) {
  let t = texCache.get(key);
  if (t) return t;
  const [name, variant] = key.split(':');
  const d = TEX[name];
  initNoise();
  const T = newTex(d.w, d.h, d.pu, d.pv);
  d.paint(T, variant);
  calibrate(T, d, name, variant);
  t = {
    map: toTexture(colourBytes(T), T, true),
    normalMap: d.ns ? toTexture(normalBytes(T, d.ns), T, false) : null,
    emissiveMap: T.em ? toTexture(greyBytes(T, T.em), T, true) : null,
  };
  t.map.name = key;
  texCache.set(key, t);
  return t;
}

// ===================================================================== materials

const cache = new Map();
const glowMats = [];
const seasonMats = [];
let night = 0;
let season = 'summer';

function applyGlow(m) {
  const u = m.userData;
  if (u.glowNight !== undefined) m.emissiveIntensity = u.glowBase + (u.glowNight - u.glowBase) * night;
  if (u.opNight !== undefined) m.opacity = u.opDay + (u.opNight - u.opDay) * night;
}

function applySeason(m, id) {
  if (id === 'grass') { m.color.set(GRASS_TINT[season] || MATERIALS.grass.color); return; }
  const t = getTex((id === 'leavesDark' ? 'needles' : 'leaves') + ':' + season);
  m.map = t.map;
  m.normalMap = t.normalMap;
}

/** Get the material for an id with an optional paint colour (hex string). */
export function mat(id, color = null) {
  const def = MATERIALS[id] || MATERIALS.wood;
  const c = def.paintable && color ? color : def.color;
  const key = id + '|' + c;
  let m = cache.get(key);
  if (m) return m;
  const s = SPEC[def.id] || { tex: 'wood', rough: 0.85 };
  const opts = { color: new THREE.Color(s.tint || !s.tex ? c : '#ffffff'), roughness: s.rough ?? 0.85, metalness: s.metal ?? 0 };
  let t = null;
  if (s.tex) {
    t = getTex(s.season && s.tex !== 'grass' ? s.tex + ':' + season : s.tex);
    opts.map = t.map;
    if (t.normalMap) { opts.normalMap = t.normalMap; opts.normalScale = new THREE.Vector2(s.ns ?? 1, s.ns ?? 1); }
  }
  if (s.glass) { opts.transparent = true; opts.opacity = s.glass.day; opts.depthWrite = false; }
  if (s.water) { opts.transparent = true; opts.opacity = 0.82; }
  m = new THREE.MeshStandardMaterial(opts);
  m.name = key;
  if (s.glow) {
    m.emissive = new THREE.Color(s.glow.color || c);
    if (t?.emissiveMap) m.emissiveMap = t.emissiveMap;
    m.userData.glowBase = s.glow.base;
    m.userData.glowNight = s.glow.night;
  }
  if (s.glass && s.glass.night !== s.glass.day) { m.userData.opDay = s.glass.day; m.userData.opNight = s.glass.night; }
  if (s.glow || m.userData.opNight !== undefined) { applyGlow(m); glowMats.push(m); }
  if (s.season) { seasonMats.push([def.id, m]); applySeason(m, def.id); }
  cache.set(key, m);
  return m;
}

/** 0 = day, 1 = full night. Windows and lamps glow warmer at night. */
export function setNight(f) {
  night = f < 0 ? 0 : f > 1 ? 1 : f;
  for (let i = 0; i < glowMats.length; i++) applyGlow(glowMats[i]);
}
export const getNight = () => night;

/** Season tint for foliage & grass: 'spring' | 'summer' | 'autumn' | 'winter'. */
export function setSeason(s) {
  if (!SEASONS.includes(s) || s === season) return;
  season = s;
  for (const [id, m] of seasonMats) applySeason(m, id);
}

const ghostCache = {};
/** Translucent material used for placement previews (softly lit, gently glowing). */
export function ghostMat(valid = true) {
  const k = valid ? 'ok' : 'bad';
  if (!ghostCache[k]) {
    const c = valid ? 0x8fe3b0 : 0xff7a6b;
    ghostCache[k] = new THREE.MeshStandardMaterial({
      color: c, emissive: c, emissiveIntensity: 0.45, roughness: 0.6, metalness: 0,
      transparent: true, opacity: 0.5, depthWrite: false,
    });
    ghostCache[k].name = 'ghost|' + k;
  }
  return ghostCache[k];
}

const bpCache = {};
/** Translucent blue "blueprint" material for guided build outlines. */
export function blueprintMat(highlight = false) {
  const k = highlight ? 'hi' : 'lo';
  if (!bpCache[k]) {
    const c = highlight ? 0x9fd4ff : 0x6fa8dc;
    bpCache[k] = new THREE.MeshStandardMaterial({
      color: c, emissive: c, emissiveIntensity: highlight ? 0.55 : 0.4, roughness: 0.7, metalness: 0,
      transparent: true, opacity: highlight ? 0.42 : 0.22, depthWrite: false,
    });
    bpCache[k].name = 'blueprint|' + k;
  }
  return bpCache[k];
}
