// Hearthwood — Living Town look (docs/LIVING.md §2.3, §3.6, §12.8). WP2, internal to the town body.
//
// Procedural, vertex-coloured, no textures:
//   * villagerGeometry(job)  one merged geometry per job (≤ 900 triangles incl. hat, tool, pack and the optional bits),
//                            1.25 m to the top of the head, origin at the feet, facing local +Z;
//   * tentGeometry()         the lane camp's canvas A-frame (door toward +X);
//   * lanternGeometry()      the shared glowing lantern (drawn with mat('lampGlow'), hangs below its origin);
//   * villagerMaterial()     the ONE shared MeshStandardMaterial, patched with onBeforeCompile (limb swing, per-villager
//                            colours, hidden accessories, dither fade); fallbackMaterial() is the plain one;
//   * glyphAtlas()           the 4 × 4 FX glyph atlas, drawn with canvas paths at boot; blob / spill / ring textures.
//
// Vertex attribute `aPart` packs three small integers (render-internal, §12.8):
//     aPart = part + 16 × tint + 128 × round(shade × 32)
//   part  0..15  how the vertex moves / hides (PART below: legs swing about the hip, arms and what they hold about the
//                shoulder, the head and what it wears about the neck; accessories collapse to their pivot when hidden)
//   tint  0..7   what colours it (TINT: 0 = its own vertex colour, 1 outfit, 2 skin, 3 hair, 4 cheek = skin + rose)
//   shade        brightness of a tinted vertex (0..1.97), so one tint can carry darker trim, checks and pleats.
// The vertex colour of a tinted vertex is its default look (the job colour, a middle skin and hair), which is what
// the plain fallback material shows.
//
// Per-instance attributes (render.js sets them; names and meaning per §12.8):
//   iOutfit, iSkin, iHair  vec3 linear colours
//   iAnim   vec4  leg swing, left arm pitch, right arm pitch, head yaw            (radians; negative pitch = forward)
//   iAnim2  vec4  sit 0..1 (−1 kneels), tool raise (about the hand), bob (m, upper body), head pitch (negative = up)
//   iFlags  vec4  fade 0..1 (Bayer dither), tool shown, pack shown, extra bits (BIT below)

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/BufferGeometryUtils.js';

const PI = Math.PI;
const TAU = PI * 2;

/** Motion / visibility classes of the `aPart` attribute. 1–3 are optional bits worn by everyone. */
export const PART = {
  FIXED: 0, BLANKET: 1, BUN: 2, BEARD: 3, LEG_L: 4, LEG_R: 5, ARM_L: 6, ARM_R: 7, HEAD: 8, TOOL: 9, PACK: 10,
  HAT: 11, BASKET: 12, BOOK: 13, STICK: 14,
};
export const TINT = { NONE: 0, OUTFIT: 1, SKIN: 2, HAIR: 3, CHEEK: 4 };
/** iFlags.w bits. */
export const BIT = { BASKET: 1, BOOK: 2, HATOFF: 4, LIE: 8, BEARD: 16, BUN: 32 };

/** Rig constants (metres, villager space, origin at the feet). The shader and limbPoint() share them. */
export const RIG = {
  HIP_Y: 0.42, HIP_X: 0.1, SHOULDER_Y: 0.82, SHOULDER_X: 0.255, NECK_Y: 0.92,
  HAND_L: [-0.296, 0.49, 0.0], HAND_R: [0.296, 0.49, 0.0],
  HEAD_Y: 1.0, HEAD_R: 0.25, HEIGHT: 1.25, SEAT_DROP: 0.31, SPLAY: 0.35, SIT_BEND: -1.4,
};

/** Job palette (§2.2, the same colours as data.js JOBS[job].color; look.js imports only three, §12.1). */
export const JOB_COLOR = {
  gardener: '#9cae6b', farmer: '#5d7fa3', woodcutter: '#b4473a', fisher: '#2f4a66',
  beekeeper: '#e9b949', baker: '#c96a5a', lamplighter: '#2f4a66', postie: '#8e3b32',
};
export const JOBS = Object.keys(JOB_COLOR);
/** §2.3 (the same lists as data.js LOOK). */
export const SKIN = ['#f3d2b3', '#e8b894', '#c98f66', '#a86b4a', '#7d4e34', '#5a3a28'];
export const HAIR = ['#2b2018', '#5a3a22', '#8a5a2b', '#c98a3a', '#d9c08a', '#b9b2a6'];
/** Top of each job's hat above the feet (bubble anchors sit above it). */
export const HAT_TOP = {
  gardener: 1.39, farmer: 1.33, woodcutter: 1.44, fisher: 1.37, beekeeper: 1.38, baker: 1.57, lamplighter: 1.56, postie: 1.32,
};
/** Rest-pose tip of the long tools (the Lamplighter's glowing pole end). */
export const TOOL_TIP = { lamplighter: [0.335, 2.08, -0.06] };
/** How each job carries its tool while walking: right-arm swing scale and a fixed right-arm pitch. */
export const CARRY = {
  gardener: { swing: 0.45, armR: -0.1 }, farmer: { swing: 0.0, armR: 0.0 }, woodcutter: { swing: 0.35, armR: -0.05 },
  fisher: { swing: 0.05, armR: -0.25 }, beekeeper: { swing: 0.6, armR: -0.1 }, baker: { swing: 0.8, armR: 0 },
  lamplighter: { swing: 0.05, armR: -0.2 }, postie: { swing: 0.8, armR: 0 },
};

/** Lighten (f > 0) or darken (f < 0) a hex colour, as decor.js does (toward warm white / warm black). */
const _ta = new THREE.Color(), _tb = new THREE.Color();
export function tintHex(hex, f) {
  _ta.set(hex);
  _tb.set(f >= 0 ? '#fff8ec' : '#1a1210');
  _ta.lerp(_tb, Math.min(1, Math.abs(f)));
  return '#' + _ta.getHexString();
}

// ====================================================================== geometry kit

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
/** Matrix from position, Euler XYZ rotation and scale. */
function M(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  return new THREE.Matrix4().compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz));
}
/** Rotation rx about the X axis through (0, cy, cz). */
function aboutX(cy, cz, rx) {
  return new THREE.Matrix4().makeTranslation(0, cy, cz).multiply(new THREE.Matrix4().makeRotationX(rx)).multiply(new THREE.Matrix4().makeTranslation(0, -cy, -cz));
}
const _up = new THREE.Vector3(0, 1, 0), _za = new THREE.Vector3(), _zb = new THREE.Vector3();
/** Matrix putting a Y-axis shape (centred) between points a and b. */
function between(a, b, sx = 1, sz = 1) {
  _za.set(a[0], a[1], a[2]); _zb.set(b[0], b[1], b[2]);
  const len = _za.distanceTo(_zb);
  _q.setFromUnitVectors(_up, _zb.clone().sub(_za).normalize());
  return { m: new THREE.Matrix4().compose(_za.add(_zb).multiplyScalar(0.5), _q, _s.set(sx, 1, sz)), len };
}

const _c = new THREE.Color();
/**
 * Collects parts for one merged geometry. Each add() takes a THREE geometry, a matrix and a paint:
 *   { part, tint = 0, color = '#ffffff' (default look), shade = 1, face?: (cx, cy, cz) => { tint?, color?, shade? } }
 */
class Kit {
  constructor(defaults) { this.list = []; this.defaults = defaults; this.tris = 0; }
  add(geo, m, paint) {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (!g.attributes.normal) g.computeVertexNormals();
    if (m) g.applyMatrix4(m);
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    const pos = g.attributes.position, n = pos.count;
    const col = new Float32Array(n * 3), ap = new Float32Array(n);
    for (let t = 0; t < n; t += 3) {
      let p = paint;
      if (paint.face) {
        const cx = (pos.getX(t) + pos.getX(t + 1) + pos.getX(t + 2)) / 3;
        const cy = (pos.getY(t) + pos.getY(t + 1) + pos.getY(t + 2)) / 3;
        const cz = (pos.getZ(t) + pos.getZ(t + 1) + pos.getZ(t + 2)) / 3;
        p = { ...paint, ...paint.face(cx, cy, cz) };
      }
      const tint = p.tint || 0, shade = p.shade ?? 1;
      _c.set(tint ? this.defaults[tint] : (p.color || '#ffffff'));
      if (tint) _c.multiplyScalar(shade);
      const code = (p.part || 0) + 16 * tint + 128 * Math.max(0, Math.min(63, Math.round(shade * 32)));
      for (let k = t; k < t + 3; k++) {
        col[k * 3] = _c.r; col[k * 3 + 1] = _c.g; col[k * 3 + 2] = _c.b;
        ap[k] = code;
      }
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aPart', new THREE.BufferAttribute(ap, 1));
    this.list.push({ g, part: paint.part || 0 });
    this.tris += n / 3;
    return this;
  }
  build(skip = null) {
    const geos = this.list.filter((e) => !skip || !skip.has(e.part)).map((e) => e.g);
    const g = mergeGeometries(geos, false);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    g.userData.tris = g.attributes.position.count / 3;
    return g;
  }
}

const lathe = (pts, seg, phiStart = 0, phiLen = TAU) =>
  new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg, phiStart, phiLen);
const sphere = (r, w, h) => new THREE.SphereGeometry(r, w, h);
const cyl = (rt, rb, h, seg, open = false) => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);

/** Hair cap: a sphere whose lower edge is high at the front (forehead) and low at the back (nape). */
function hairCap(r, segs, rings) {
  const pos = [], nor = [], idx = [];
  for (let s = 0; s <= segs; s++) {
    const phi = (s / segs) * TAU;                    // 0 = front (+Z)
    const tmax = 1.5 - 0.48 * Math.cos(phi);         // front 1.02 rad (above the eyes) … back 1.98 rad (nape)
    for (let j = 0; j <= rings; j++) {
      const th = (j / rings) * tmax;
      const x = Math.sin(th) * Math.sin(phi), y = Math.cos(th), z = Math.sin(th) * Math.cos(phi);
      pos.push(x * r, y * r, z * r);
      nor.push(x, y, z);
    }
  }
  for (let s = 0; s < segs; s++) {
    for (let j = 0; j < rings; j++) {
      const a = s * (rings + 1) + j, b = (s + 1) * (rings + 1) + j;
      if (j > 0) idx.push(a, a + 1, b);            // outward winding (DoubleSide flips back-face normals)
      idx.push(b, a + 1, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

/** Superellipsoid "duvet": a rounded box w × h × d centred at the origin (e → 0 boxier, 1 = ellipsoid). */
function puffy(w, h, d, e, ws, hs) {
  const g = new THREE.SphereGeometry(1, ws, hs);
  const pos = g.attributes.position;
  const sp = (v) => Math.sign(v) * Math.pow(Math.abs(v), e);
  for (let i = 0; i < pos.count; i++) pos.setXYZ(i, sp(pos.getX(i)) * w / 2, sp(pos.getY(i)) * h / 2, sp(pos.getZ(i)) * d / 2);
  g.computeVertexNormals();
  return g;
}

/** A brim ring: inner radius ri at yi, outer radius ro(phi) at yo(phi) (phi 0 = front). */
function brimRing(segs, ri, yi, ro, yo) {
  const pos = [], idx = [];
  for (let s = 0; s <= segs; s++) {
    const phi = (s / segs) * TAU, sx = Math.sin(phi), cz = Math.cos(phi);
    pos.push(sx * ri, yi, cz * ri, sx * ro(phi), yo(phi), cz * ro(phi));
  }
  for (let s = 0; s < segs; s++) { const a = s * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }   // top faces up
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Flat disc lying on the head surface at p (head centre c), facing outward. */
function onHead(p, c = [0, RIG.HEAD_Y, 0], out = 0.004) {
  const n = new THREE.Vector3(p[0] - c[0], p[1] - c[1], p[2] - c[2]).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
  return new THREE.Matrix4().compose(new THREE.Vector3(p[0] + n.x * out, p[1] + n.y * out, p[2] + n.z * out), q, new THREE.Vector3(1, 1, 1));
}

// ====================================================================== the villager

const P = PART;
const BOOT_DARK = '#4a3a2e';
// body profiles (r, y) from the hem up; open at both ends (the neck is inside the head, the hem is never seen from below)
const BELL = [[0.282, 0.3], [0.302, 0.355], [0.268, 0.5], [0.248, 0.64], [0.226, 0.76], [0.15, 0.87]];
const JACKET = [[0.258, 0.35], [0.272, 0.405], [0.252, 0.52], [0.246, 0.64], [0.226, 0.76], [0.15, 0.87]];
const COAT = [[0.268, 0.19], [0.286, 0.25], [0.26, 0.44], [0.246, 0.62], [0.226, 0.76], [0.15, 0.87]];
/** Body radius at height y for a profile (to seat trims on its surface). */
function radiusAt(prof, y) {
  for (let i = 1; i < prof.length; i++) {
    const [r0, y0] = prof[i - 1], [r1, y1] = prof[i];
    if (y >= y0 && y <= y1) return r0 + ((y - y0) / (y1 - y0 || 1)) * (r1 - r0);
  }
  return 0.2;
}
const angleOf = (x, z) => (Math.atan2(x, z) + TAU) % TAU;
const BODY_SEG = 9;

function job(id) {
  const outfit = { part: P.FIXED, tint: TINT.OUTFIT };
  const skin = { tint: TINT.SKIN };
  const hair = { tint: TINT.HAIR };
  const k = new Kit({ [TINT.OUTFIT]: JOB_COLOR[id], [TINT.SKIN]: SKIN[1], [TINT.HAIR]: HAIR[1], [TINT.CHEEK]: '#e39a8a' });
  const S = JOB_SPEC[id];
  const prof = S.body || BELL;

  // ---- legs & boots
  for (const [part, sx] of [[P.LEG_L, -1], [P.LEG_R, 1]]) {
    const legPaint = S.legs === 'outfit' ? { part, tint: TINT.OUTFIT, shade: 0.82 } : { part, color: S.legs };
    k.add(cyl(0.07, 0.064, 0.37, 6, true), M(sx * RIG.HIP_X, 0.255, 0), legPaint);
    k.add(sphere(0.088, 6, 3), M(sx * RIG.HIP_X, 0.06, 0.03, 0, 0, 0, 1, 0.68, 1.32), { part, color: S.boots || BOOT_DARK });
  }
  // ---- body (a lathe "bell"); the job paints it (overalls, plaid, cable ribs, pleats…)
  k.add(lathe(prof, BODY_SEG), null, {
    ...outfit,
    face: (x, y, z) => {
      const bp = S.bodyPaint ? S.bodyPaint(x, y, z) : {};
      return { ...bp, shade: (bp.shade ?? 1) * (0.86 + 0.14 * Math.min(1, Math.max(0, (y - 0.3) / 0.35))) };
    },
  });
  // ---- head, hair, face
  k.add(sphere(RIG.HEAD_R, 10, 7), M(0, RIG.HEAD_Y, 0, 0, 0, 0, 1, 0.97, 0.98), { part: P.HEAD, ...skin });
  k.add(hairCap(0.266, 9, 4), M(0, RIG.HEAD_Y + 0.005, -0.004), { part: P.HEAD, ...hair });
  for (const sx of [-1, 1]) {
    k.add(sphere(0.031, 4, 3), M(sx * 0.088, 1.02, 0.226, 0, 0, 0, 1, 1.3, 0.6), { part: P.HEAD, color: '#2b2018' });
    k.add(new THREE.CircleGeometry(0.036, 8), onHead([sx * 0.15, 0.955, 0.19]), { part: P.HEAD, tint: TINT.CHEEK });
  }
  k.add(sphere(0.037, 5, 3), M(0, 0.972, 0.248, 0, 0, 0, 1, 0.9, 0.9), { part: P.HEAD, ...skin, shade: 0.94 });
  // ---- arms: one lathe each, sleeve (outfit or a shirt colour) and mitten (skin or gloves)
  const ARM = [[0.001, 0.035], [0.062, 0.012], [0.068, -0.05], [0.064, -0.235], [0.074, -0.3], [0.05, -0.37], [0.001, -0.38]];
  for (const [part, sx] of [[P.ARM_L, -1], [P.ARM_R, 1]]) {
    const sleeve = S.sleeves ? { color: S.sleeves } : { tint: TINT.OUTFIT, shade: 0.95 };
    const mitt = S.gloves ? { color: S.gloves } : { tint: TINT.SKIN };
    k.add(lathe(ARM, 6), M(sx * RIG.SHOULDER_X, RIG.SHOULDER_Y, 0, 0, 0, sx * 0.115), {
      part,
      face: (x, y, z) => {
        const p = y < 0.555 ? mitt : sleeve;
        return S.armPaint && p === sleeve ? { ...p, ...S.armPaint(x, y, z) } : p;
      },
    });
  }
  // ---- optional bits everyone has: beard, bun, blanket (lying), travel pack + stick
  k.add(sphere(1, 6, 3), M(0, 0.872, 0.162, 0.25, 0, 0, 0.19, 0.155, 0.12), { part: P.BEARD, ...hair, shade: 0.92 });
  k.add(sphere(0.098, 5, 3), M(0, 1.13, -0.215), { part: P.BUN, ...hair });
  // the blanket (lying): a puffy duvet from the toes to the chest, its top edge folded back
  k.add(puffy(0.84, 0.94, 0.58, 0.55, 6, 3), M(0, 0.36, 0.07), {
    // a quilt in the villager's own outfit colour (a lighter shade), its top edge folded back in cream
    part: P.BLANKET, face: (x, y) => (y > 0.66 ? { color: '#fbf6ea' } : { tint: TINT.OUTFIT, shade: 1.25 }),
  });
  const packZ = -radiusAt(prof, 0.62) - 0.075;
  k.add(box(0.3, 0.34, 0.15), M(0, 0.6, packZ), { part: P.PACK, color: '#6f7a45' });
  k.add(box(0.31, 0.1, 0.165), M(0, 0.74, packZ - 0.004, -0.06), { part: P.PACK, color: '#566137' });
  k.add(cyl(0.07, 0.07, 0.38, 6), M(0, 0.84, packZ + 0.01, 0, 0, PI / 2), { part: P.PACK, color: '#b4473a' });
  const stick = between([-0.31, 0.0, 0.04], [-0.31, 1.06, 0.04]);
  k.add(cyl(0.017, 0.02, stick.len, 5, true), stick.m, { part: P.STICK, color: '#8a6a3a' });
  k.add(sphere(0.035, 4, 2), M(-0.31, 1.07, 0.04), { part: P.STICK, color: '#6b4c36' });
  // ---- the job: hat, tool and trims
  S.dress(k, prof);
  const geo = k.build();
  geo.userData.job = id;
  geo.userData.fallback = k.build(new Set([P.BLANKET, P.BUN, P.BEARD, P.PACK, P.STICK, P.BASKET, P.BOOK]));
  return geo;
}

// ---------------------------------------------------------------- per-job dress (hat, tool, trims)

const HAT = (color, shade = 1) => ({ part: P.HAT, color: shade === 1 ? color : tintHex(color, shade - 1) });
const TOOL = (color) => ({ part: P.TOOL, color });
const FIX = (color) => ({ part: P.FIXED, color });
const HR = RIG.HAND_R, HL = RIG.HAND_L;

/** A rod between two points. */
function rod(k, a, b, r0, r1, seg, paint, open = true) {
  const { m, len } = between(a, b);
  k.add(cyl(r1, r0, len, seg, open), m, paint);
}
/** Front apron: a partial lathe hugging the body profile. */
function apron(k, prof, y0, y1, color, half = 1.0, out = 0.012) {
  // the 9-sided body bulges past its profile radius between corners: clear the corners (÷ cos of half a side)
  const pts = [], cl = 1 / Math.cos(Math.PI / BODY_SEG);
  for (let i = 0; i <= 3; i++) { const y = y0 + ((y1 - y0) * i) / 3; pts.push([radiusAt(prof, y) * cl + out, y]); }
  k.add(lathe(pts, 6, -half, 2 * half), null, { part: P.FIXED, color });
}
/** Brass buttons down the front. */
function buttons(k, prof, ys, color = '#d9a441') {
  for (const y of ys) k.add(sphere(0.022, 4, 2), M(0, y, radiusAt(prof, y) + 0.008), FIX(color));
}

const JOB_SPEC = {
  // 🌷 broad floppy straw sun hat · watering can · sage smock, cream apron, green wellies
  gardener: {
    legs: '#7a5a3a', boots: '#4f7a6a',
    dress(k, prof) {
      apron(k, prof, 0.33, 0.72, '#efe3c8', 0.95, 0.006);
      const straw = '#e9c46a';
      k.add(lathe([[0.17, 1.205], [0.34, 1.19], [0.455, 1.125]], 11), null, HAT(straw));
      k.add(lathe([[0.2, 1.2], [0.205, 1.3], [0.15, 1.375], [0.001, 1.39]], 7), null, HAT(straw, 1.04));
      k.add(cyl(0.209, 0.209, 0.045, 7, true), M(0, 1.228, 0), HAT('#9cae6b'));
      k.add(sphere(0.045, 4, 3), M(0.15, 1.25, 0.15), HAT('#e7a0a0'));
      // watering can hanging from the right hand, spout forward
      const can = '#8fb8c9';
      k.add(cyl(0.072, 0.08, 0.15, 6), M(HR[0] + 0.01, 0.37, 0.07), TOOL(can));
      k.add(box(0.025, 0.12, 0.13), M(HR[0] + 0.01, 0.47, 0.045), TOOL(tintHex(can, -0.15)));
      rod(k, [HR[0] + 0.01, 0.35, 0.13], [HR[0] + 0.01, 0.5, 0.33], 0.018, 0.014, 4, TOOL(can));
      k.add(cyl(0.035, 0.016, 0.05, 5), M(HR[0] + 0.01, 0.515, 0.35, 0.9, 0, 0), TOOL(tintHex(can, -0.1)));
    },
  },
  // 🥕 flat cap · pitchfork on the shoulder · denim overalls over a cream shirt
  farmer: {
    body: JACKET, legs: 'outfit', boots: '#4a3a2e', sleeves: '#efe3c8',
    bodyPaint: (x, y) => (y > 0.6 ? { tint: TINT.NONE, color: '#efe3c8' } : {}),
    dress(k, prof) {
      const r66 = radiusAt(prof, 0.68);
      k.add(box(0.25, 0.18, 0.03), M(0, 0.68, r66 - 0.006, -0.05), { part: P.FIXED, tint: TINT.OUTFIT, shade: 0.95 });
      for (const sx of [-1, 1]) {
        k.add(box(0.04, 0.03, 0.3), M(sx * 0.1, 0.835, 0.02, 0.35), { part: P.FIXED, tint: TINT.OUTFIT, shade: 0.9 });
        k.add(sphere(0.02, 4, 2), M(sx * 0.1, 0.76, r66 + 0.012), FIX('#d9a441'));
      }
      k.add(box(0.2, 0.07, 0.06), M(0, 0.875, 0.12, 0.3), FIX('#b4473a'));          // neckerchief
      const cap = '#7a5a3a';
      k.add(lathe([[0.001, 1.312], [0.17, 1.3], [0.255, 1.245], [0.262, 1.19]], 9), aboutX(1.2, 0, 0.1), HAT(cap));
      k.add(cyl(0.17, 0.17, 0.022, 6, false), M(0, 1.205, 0.2, 0.28, 0, 0, 1, 1, 0.6), HAT(cap, 0.86));
      // pitchfork resting on the right shoulder: shaft through the hand, tines up behind the head
      const a = [HR[0] + 0.01, 0.2, 0.17], b = [0.24, 1.48, -0.24];
      rod(k, a, b, 0.02, 0.02, 5, TOOL('#c8a46a'));
      const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], L = Math.hypot(...d), u = d.map((v) => v / L);
      const at = (t) => [b[0] + u[0] * t, b[1] + u[1] * t, b[2] + u[2] * t];
      const iron = '#8a8f94';
      const base = at(0.02);
      k.add(box(0.2, 0.03, 0.03), M(base[0], base[1], base[2], Math.atan2(-u[2], u[1]), 0, 0), TOOL(iron));
      for (const t of [-0.08, 0, 0.08]) rod(k, [base[0] + t, base[1], base[2]], [base[0] + t + u[0] * 0.24, base[1] + u[1] * 0.24, base[2] + u[2] * 0.24], 0.012, 0.008, 3, TOOL(iron));
    },
  },
  // 🪓 red knit beanie with bobble · axe · barn-red plaid jacket (two-tone), beard on half the seeds
  woodcutter: {
    body: JACKET, legs: '#5a4632', boots: '#3f3127',
    bodyPaint: (x, y, z) => ({ shade: ((Math.floor(angleOf(x, z) / (TAU / BODY_SEG)) + Math.floor((y - 0.3) / 0.09)) & 1) ? 0.98 : 0.6 }),
    armPaint: (x, y) => ({ shade: (Math.floor((y - 0.4) / 0.09) & 1) ? 0.98 : 0.62 }),
    dress(k, prof) {
      buttons(k, prof, [0.55, 0.68], '#3b3a3a');
      const red = '#b4473a';
      k.add(lathe([[0.268, 1.1], [0.272, 1.19], [0.238, 1.29], [0.13, 1.36], [0.001, 1.372]], 9), null, HAT(red));
      k.add(cyl(0.28, 0.282, 0.075, 9, true), M(0, 1.135, 0), HAT('#8e3b32'));
      k.add(sphere(0.068, 5, 3), M(0, 1.39, -0.02), HAT('#efe3c8'));
      // axe: handle from the hand forward and down; the head sits across the far end, its blade leading the swing
      // (the chop raises the arm overhead and brings it down forward, so the blade faces down / back at rest)
      const a = [HR[0], 0.54, -0.05], b = [HR[0] + 0.01, 0.2, 0.47];
      rod(k, a, b, 0.022, 0.02, 5, TOOL('#c8a46a'));
      const dy = b[1] - a[1], dz = b[2] - a[2], dl = Math.hypot(dy, dz), ey = -dz / dl, ez = dy / dl;   // blade direction
      const th = Math.atan2(ez, ey);
      const at = (t, u) => [b[0], b[1] + ey * t - (dy / dl) * u, b[2] + ez * t - (dz / dl) * u];
      const h1 = at(0.035, 0.03), h2 = at(0.12, 0.03);
      k.add(box(0.04, 0.12, 0.08), M(h1[0], h1[1], h1[2], th, 0, 0), TOOL('#3b3a3a'));
      k.add(box(0.026, 0.07, 0.11), M(h2[0], h2[1], h2[2], th, 0, 0), TOOL('#aab0b5'));
    },
  },
  // 🎣 yellow sou'wester with a long back brim · tall rod carried upright · navy cable jumper, yellow oilskins
  fisher: {
    body: JACKET, legs: '#e9c46a', boots: '#3f5a40',
    bodyPaint: (x, y, z) => ({ shade: (Math.floor(angleOf(x, z) / (TAU / BODY_SEG)) & 1) ? 1.0 : 0.8 }),
    dress(k) {
      const y = '#e9c46a';
      k.add(lathe([[0.268, 1.12], [0.272, 1.22], [0.2, 1.33], [0.001, 1.37]], 9), null, HAT(y));
      k.add(brimRing(12, 0.262, 1.125, (phi) => 0.34 + 0.24 * Math.pow((1 - Math.cos(phi)) / 2, 1.5), (phi) => 1.1 - 0.16 * Math.pow((1 - Math.cos(phi)) / 2, 1.5)), null, HAT(y, 0.93));
      // rod upright in the right hand (tallest silhouette), reel, line and bobber
      const a = [HR[0] + 0.005, 0.3, 0.04], tip = [0.33, 2.0, -0.12];
      rod(k, a, tip, 0.022, 0.009, 5, TOOL('#c8a46a'));
      k.add(cyl(0.045, 0.045, 0.035, 6), M(HR[0] + 0.045, 0.6, 0.035, 0, 0, PI / 2), TOOL('#6b6b6b'));
      k.add(box(0.006, 0.36, 0.006), M(tip[0], tip[1] - 0.18, tip[2]), TOOL('#e8e4da'));
      k.add(sphere(0.032, 4, 3), M(tip[0], tip[1] - 0.37, tip[2]), TOOL('#d23b2e'));
    },
  },
  // 🐝 wide white veiled hat · tin smoker · honey-mustard smock, white gloves
  beekeeper: {
    legs: '#e8e2d4', boots: '#4a3a2e', gloves: '#f4efe6',
    dress(k) {
      const w = '#f4efe6';
      k.add(lathe([[0.19, 1.19], [0.43, 1.165]], 12), null, HAT(w));
      k.add(lathe([[0.205, 1.18], [0.2, 1.3], [0.12, 1.37], [0.001, 1.38]], 8), null, HAT(w, 1.0));
      k.add(lathe([[0.415, 1.16], [0.34, 0.99], [0.3, 0.87]], 8, 0.8, TAU - 1.6), null, { part: P.HAT, color: '#d8d4c8' });
      const tin = '#a9aeb2';
      k.add(cyl(0.06, 0.062, 0.15, 6), M(HR[0] + 0.01, 0.37, 0.07), TOOL(tin));
      k.add(cyl(0.022, 0.05, 0.08, 5), M(HR[0] + 0.01, 0.485, 0.07, 0.3, 0, 0), TOOL(tintHex(tin, -0.15)));
      k.add(box(0.03, 0.13, 0.1), M(HR[0] + 0.08, 0.39, 0.04), TOOL('#7a4b3a'));
    },
  },
  // 🍞 tall puffy white toque · wicker basket (bread round) · terracotta dress, cream apron
  baker: {
    legs: '#f3ece0', boots: '#7a4b3a',
    dress(k, prof) {
      apron(k, prof, 0.31, 0.74, '#f3ece0', 1.1, 0.006);
      const wt = '#fbf7ee';
      k.add(lathe([[0.2, 1.17], [0.206, 1.25], [0.272, 1.36], [0.262, 1.47], [0.13, 1.555], [0.001, 1.57]], 8), null,
        { part: P.HAT, face: (x, y, z) => ({ color: y > 1.25 && (Math.floor(angleOf(x, z) / (TAU / 8)) & 1) ? '#ece6da' : wt }) });
      // rolling pin in the right hand
      k.add(cyl(0.032, 0.032, 0.24, 6, true), M(HR[0] + 0.01, 0.47, 0.05, 0, 0, PI / 2), TOOL('#d2a46c'));
      // basket on the left forearm, two loaves
      const bx = HL[0] - 0.05, bz = 0.06, wick = '#c9a55e';
      k.add(lathe([[0.001, 0.31], [0.13, 0.32], [0.16, 0.43]], 7), M(bx, 0, bz), { part: P.BASKET, color: wick });
      k.add(new THREE.TorusGeometry(0.15, 0.014, 2, 7, PI), M(bx, 0.43, bz, 0, PI / 2, 0), { part: P.BASKET, color: tintHex(wick, -0.2) });
      k.add(sphere(1, 4, 3), M(bx - 0.04, 0.45, bz + 0.03, 0, 0.5, 0, 0.1, 0.06, 0.06), { part: P.BASKET, color: '#c08a4a' });
      k.add(sphere(1, 4, 3), M(bx + 0.05, 0.46, bz - 0.03, 0, -0.4, 0.3, 0.09, 0.055, 0.055), { part: P.BASKET, color: '#b47a3e' });
    },
  },
  // 🏮 tall stovepipe hat · pole with a glowing tip · long navy coat
  lamplighter: {
    body: COAT, legs: '#3b3a3a', boots: '#2b2b2b',
    dress(k, prof) {
      buttons(k, prof, [0.42, 0.56, 0.7]);
      const blk = '#3b3a3a';
      k.add(lathe([[0.17, 1.205], [0.29, 1.195], [0.3, 1.18]], 10), null, HAT(blk));
      k.add(cyl(0.2, 0.19, 0.36, 8), M(0, 1.38, 0), HAT(blk, 1.08));
      k.add(cyl(0.196, 0.195, 0.05, 8, true), M(0, 1.24, 0), HAT('#8e3b32'));
      const a = [HR[0] + 0.005, 0.25, 0.06], tip = TOOL_TIP.lamplighter;
      rod(k, a, tip, 0.02, 0.016, 5, TOOL('#5b3f2a'));
      k.add(cyl(0.028, 0.03, 0.06, 5), M(tip[0], tip[1] - 0.04, tip[2]), TOOL('#d9a441'));
      k.add(box(0.012, 0.012, 0.12), M(tip[0], tip[1] - 0.12, tip[2] + 0.05), TOOL('#3b3a3a'));
    },
  },
  // ✉️ peaked navy cap with a red band · satchel across the chest (and a letter in hand) · red-brown jacket
  postie: {
    body: JACKET, legs: '#2f4a66', boots: '#2b2b2b',
    dress(k, prof) {
      buttons(k, prof, [0.5, 0.63]);
      const navy = '#2f4a66';
      k.add(lathe([[0.2, 1.17], [0.212, 1.24], [0.228, 1.3], [0.001, 1.315]], 9), null, HAT(navy));
      k.add(cyl(0.216, 0.214, 0.04, 9, true), M(0, 1.205, 0), HAT('#b4473a'));
      k.add(cyl(0.17, 0.17, 0.02, 6, false), M(0, 1.19, 0.2, 0.3, 0, 0, 1, 1, 0.55), HAT('#2b2b2b'));
      // satchel at the left hip on a strap from the right shoulder
      const leather = '#7a4b3a';
      k.add(box(0.07, 0.2, 0.24), M(-0.3, 0.45, 0.04, 0, 0, 0.05), FIX(leather));
      k.add(box(0.075, 0.09, 0.245), M(-0.305, 0.52, 0.04, 0, 0, 0.05), FIX(tintHex(leather, -0.2)));
      const s0 = [0.17, 0.86, 0.1], s1 = [-0.26, 0.5, 0.2];
      const st = between(s0, s1);
      k.add(box(0.045, st.len, 0.025), st.m, FIX(tintHex(leather, -0.15)));
      k.add(box(0.16, 0.1, 0.012), M(HR[0] + 0.02, 0.45, 0.07, 0, 0.2, 0), TOOL('#fbf6ea'));
    },
  },
};

const GEO = new Map();
/** The merged geometry of a job (cached); `.userData.fallback` drops the optional bits for the plain material. */
export function villagerGeometry(jobId) {
  const id = JOB_COLOR[jobId] ? jobId : 'gardener';
  let g = GEO.get(id);
  if (!g) { g = job(id); GEO.set(id, g); }
  return g;
}

// ====================================================================== camp tent, lantern

let tentGeo = null;
/** Canvas A-frame tent, ridge along X, door toward +X, lantern stick at its mouth (≤ 300 triangles). */
export function tentGeometry() {
  if (tentGeo) return tentGeo;
  const k = new Kit({});
  const L = 1.7, W = 0.72, H = 1.05;
  const slant = Math.hypot(W, H), ang = Math.atan2(W, H);
  const canvas = '#e8d3a8', dark = '#cdb68a';
  for (const s of [-1, 1]) {
    k.add(box(L, slant, 0.03), M(0, H / 2, (s * W) / 2, -s * ang, 0, 0), { part: P.FIXED, face: (x, y) => ({ color: y < 0.16 ? '#b4473a' : canvas }) });
  }
  const tri = (pts) => new THREE.ShapeGeometry(new THREE.Shape(pts.map(([a, b]) => new THREE.Vector2(a, b))));
  // back wall, the dark door opening and two flaps folded back
  k.add(tri([[-W, 0], [W, 0], [0, H]]), M(-L / 2, 0, 0, 0, -PI / 2, 0), FIX(dark));
  k.add(tri([[-W * 0.62, 0], [W * 0.62, 0], [0, H * 0.82]]), M(L / 2 - 0.05, 0.005, 0, 0, PI / 2, 0), FIX('#4a3a2e'));
  for (const s of [-1, 1]) k.add(tri([[0, 0], [W * 0.9, 0], [0, H * 0.95]]), M(L / 2 + 0.02, 0.01, s * 0.05, 0, PI / 2 + s * 2.2, 0), FIX(dark));
  k.add(box(L + 0.12, 0.04, 0.04), M(0, H + 0.01, 0), FIX('#5b3f2a'));
  for (const sx of [-1, 1]) k.add(box(0.035, H + 0.05, 0.035), M((sx * L) / 2, (H + 0.05) / 2, 0), FIX('#5b3f2a'));
  // guy ropes and pegs
  for (const sx of [-1, 1]) {
    rod(k, [(sx * (L / 2 + 0.06)), H, 0], [sx * (L / 2 + 0.5), 0.02, 0], 0.008, 0.008, 3, FIX('#d9c19a'));
    k.add(box(0.04, 0.08, 0.04), M(sx * (L / 2 + 0.5), 0.03, 0), FIX('#5b3f2a'));
  }
  // bedroll beside the mouth and the lantern stick (the lantern itself is a glow instance at LANTERN_AT)
  k.add(cyl(0.11, 0.11, 0.62, 7), M(L / 2 + 0.25, 0.1, -0.45, PI / 2, 0, 0), FIX('#6f7a45'));
  rod(k, [L / 2 + 0.3, 0, 0.55], [L / 2 + 0.3, 0.95, 0.55], 0.018, 0.015, 4, FIX('#5b3f2a'));
  k.add(box(0.2, 0.02, 0.02), M(L / 2 + 0.22, 0.94, 0.55), FIX('#5b3f2a'));
  tentGeo = k.build();
  tentGeo.userData.lantern = [L / 2 + 0.14, 0.93, 0.55];
  return tentGeo;
}

let lanternGeo = null;
/** Glowing lantern hanging below its origin (≈ 0.2 m tall). One material (lampGlow), so one instanced draw. */
export function lanternGeometry() {
  if (lanternGeo) return lanternGeo;
  // a square lantern (24 triangles): up to 30 of them burn at night beside 20 villagers and 10 tents, inside the
  // 20k-triangle budget (§12.11; it was a 76-triangle hexagonal one with a rim and a hook, T1.13)
  const parts = [
    new THREE.CylinderGeometry(0.056, 0.062, 0.12, 4).rotateY(Math.PI / 4).translate(0, -0.13, 0),
    new THREE.ConeGeometry(0.076, 0.06, 4).rotateY(Math.PI / 4).translate(0, -0.04, 0),
  ].map((g) => { g.deleteAttribute('uv'); return g.index ? g.toNonIndexed() : g; });
  lanternGeo = mergeGeometries(parts, false);
  lanternGeo.computeBoundingSphere();
  return lanternGeo;
}

// ====================================================================== the shared material

/** Shader anchors the patch needs (checked against this three.js before using it). */
const ANCHORS_V = ['#include <common>', '#include <color_vertex>', '#include <beginnormal_vertex>', '#include <begin_vertex>'];
const ANCHORS_F = ['#include <common>', '#include <clipping_planes_fragment>'];
const f3 = (a) => `vec3(${a.map((v) => v.toFixed(4)).join(', ')})`;

const V_COMMON = /* glsl */`
attribute float aPart;
attribute vec3 iOutfit;
attribute vec3 iSkin;
attribute vec3 iHair;
attribute vec4 iAnim;
attribute vec4 iAnim2;
attribute vec4 iFlags;
varying float vHwFade;
mat3 hwRx( float a ) { float c = cos( a ), s = sin( a ); return mat3( 1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c ); }
mat3 hwRy( float a ) { float c = cos( a ), s = sin( a ); return mat3( c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c ); }
mat3 hwRz( float a ) { float c = cos( a ), s = sin( a ); return mat3( c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0 ); }
// aPart = part + 16 tint + 128 shadeQ
void hwDecode( out int part, out float tint, out float shade ) {
	float a = aPart;
	float sq = floor( a / 128.0 );
	a -= sq * 128.0;
	tint = floor( a / 16.0 );
	part = int( a - tint * 16.0 + 0.5 );
	shade = sq / 32.0;
}`;

const V_COLOR = /* glsl */`
	{
		int hwP0; float hwTi, hwSh;
		hwDecode( hwP0, hwTi, hwSh );
		if ( hwTi > 0.5 ) {
			vec3 hwT = hwTi < 1.5 ? iOutfit : hwTi < 2.5 ? iSkin : hwTi < 3.5 ? iHair : mix( iSkin, vec3( 0.86, 0.3, 0.26 ), 0.32 );
			vColor.rgb = hwT * hwSh;
		}
		vHwFade = iFlags.x;
	}`;

const V_RIG = /* glsl */`
	int hwP; float hwTi2, hwSh2;
	hwDecode( hwP, hwTi2, hwSh2 );
	int hwB = int( iFlags.w + 0.5 );
	mat3 hwR = mat3( 1.0 );
	mat3 hwRT = mat3( 1.0 );
	vec3 hwPiv = vec3( 0.0 );
	bool hwHide = false;
	bool hwLeg = hwP == 4 || hwP == 5;
	if ( hwLeg ) {
		hwPiv = vec3( hwP == 4 ? -${RIG.HIP_X.toFixed(3)} : ${RIG.HIP_X.toFixed(3)}, ${RIG.HIP_Y.toFixed(3)}, 0.0 );
		hwR = hwRx( ( hwP == 4 ? iAnim.x : -iAnim.x ) + ${RIG.SIT_BEND.toFixed(3)} * iAnim2.x );
		hwHide = ( hwB & 8 ) != 0;
	} else if ( hwP == 6 || hwP == 12 || hwP == 13 || hwP == 14 ) {
		hwPiv = vec3( -${RIG.SHOULDER_X.toFixed(3)}, ${RIG.SHOULDER_Y.toFixed(3)}, 0.0 );
		hwR = hwRz( ${RIG.SPLAY.toFixed(3)} * clamp( -iAnim.y / 2.6, 0.0, 1.0 ) ) * hwRx( iAnim.y );
		hwHide = hwP == 12 ? ( hwB & 1 ) == 0 : hwP == 13 ? ( hwB & 2 ) == 0 : hwP == 14 ? iFlags.z < 0.5 : false;
	} else if ( hwP == 7 || hwP == 9 ) {
		hwPiv = vec3( ${RIG.SHOULDER_X.toFixed(3)}, ${RIG.SHOULDER_Y.toFixed(3)}, 0.0 );
		hwR = hwRz( -${RIG.SPLAY.toFixed(3)} * clamp( -iAnim.z / 2.6, 0.0, 1.0 ) ) * hwRx( iAnim.z );
		if ( hwP == 9 ) { hwRT = hwRx( iAnim2.y ); hwHide = iFlags.y < 0.5; }
	} else if ( hwP == 8 || hwP == 11 || hwP == 2 || hwP == 3 ) {
		hwPiv = vec3( 0.0, ${RIG.NECK_Y.toFixed(3)}, 0.0 );
		hwR = hwRy( iAnim.w ) * hwRx( iAnim2.w );
		hwHide = hwP == 11 ? ( hwB & 4 ) != 0 : hwP == 2 ? ( hwB & 32 ) == 0 : hwP == 3 ? ( hwB & 16 ) == 0 : false;
	} else if ( hwP == 10 ) {
		hwHide = iFlags.z < 0.5;
	} else if ( hwP == 1 ) {
		hwHide = ( hwB & 8 ) == 0;
	}
	objectNormal = hwR * ( hwRT * objectNormal );`;

const V_MOVE = /* glsl */`
	if ( hwHide ) transformed = hwPiv;
	else {
		if ( hwP == 9 ) transformed = hwRT * ( transformed - ${f3(RIG.HAND_R)} ) + ${f3(RIG.HAND_R)};
		transformed = hwR * ( transformed - hwPiv ) + hwPiv;
	}
	if ( !hwLeg ) transformed.y += iAnim2.z;`;

const F_COMMON = /* glsl */`
varying float vHwFade;
const float hwBayer[ 16 ] = float[ 16 ]( 0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0 );`;

const F_DITHER = /* glsl */`
	if ( vHwFade < 0.999 ) {
		vec2 hwF = mod( floor( gl_FragCoord.xy ), 4.0 );
		if ( vHwFade <= ( hwBayer[ int( hwF.x + hwF.y * 4.0 ) ] + 0.5 ) / 16.0 ) discard;
	}`;

/** True when this three.js has every chunk the patch hooks into. */
export function patchSupported() {
  try {
    const v = THREE.ShaderLib.standard.vertexShader, f = THREE.ShaderLib.standard.fragmentShader;
    return ANCHORS_V.every((a) => v.includes(a)) && ANCHORS_F.every((a) => f.includes(a));
  } catch { return false; }
}

let shared = null, plain = null;
/** The one shared, patched villager material (customProgramCacheKey 'town-villager-1'). */
export function villagerMaterial() {
  if (shared) return shared;
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
  m.name = 'town-villager';
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + V_COMMON)
      .replace('#include <color_vertex>', '#include <color_vertex>\n' + V_COLOR)
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n' + V_RIG)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + V_MOVE);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + F_COMMON)
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n' + F_DITHER);
  };
  m.customProgramCacheKey = () => 'town-villager-1';
  shared = m;
  return m;
}

/** The plain vertex-colour material (no limb swing, no per-villager colours, no fade): the safe fallback. */
export function fallbackMaterial() {
  if (!plain) {
    plain = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
    plain.name = 'town-villager-plain';
  }
  return plain;
}

// ====================================================================== CPU mirror of the rig (lanterns, pole tips)

function rotX(v, a) { const c = Math.cos(a), s = Math.sin(a), y = v.y, z = v.z; v.y = c * y - s * z; v.z = s * y + c * z; return v; }
function rotZ(v, a) { const c = Math.cos(a), s = Math.sin(a), x = v.x, y = v.y; v.x = c * x - s * y; v.y = s * x + c * y; return v; }
/**
 * Villager-space position of a point held in a hand, after the arm swing (as the shader moves it).
 * side −1 = left, +1 = right; p = rest-pose point; arm = arm pitch; tool = tool raise (right hand); bob = upper-body bob.
 */
export function handPoint(out, side, p, arm, tool = 0, bob = 0) {
  out.set(p[0], p[1], p[2]);
  if (side > 0 && tool) {
    const h = RIG.HAND_R;
    out.x -= h[0]; out.y -= h[1]; out.z -= h[2];
    rotX(out, tool);
    out.x += h[0]; out.y += h[1]; out.z += h[2];
  }
  const px = side * RIG.SHOULDER_X, py = RIG.SHOULDER_Y;
  out.x -= px; out.y -= py;
  rotX(out, arm);
  rotZ(out, -side * RIG.SPLAY * Math.min(1, Math.max(0, -arm / 2.6)));
  out.x += px; out.y += py;
  out.y += bob;
  return out;
}

// ====================================================================== textures (canvas)

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

let atlas = null;
/** FX glyph slots in the atlas (4 × 4, row-major from the top-left). */
export const GLYPH = { heart: 0, note: 1, sparkle: 2, drop: 3, chip: 4, seed: 5, puff: 6, z: 7, letter: 8, bread: 9, fish: 10, bee: 11 };

/** 4 × 4 glyph atlas (256 × 256, 64 px a cell), drawn once with canvas paths. */
export function glyphAtlas() {
  if (atlas) return atlas;
  const S = 64, c = canvas(S * 4, S * 4), g = c.getContext('2d');
  const cell = (i, fn) => { g.save(); g.translate((i % 4) * S, Math.floor(i / 4) * S); fn(g); g.restore(); };
  const outline = (w = 3, col = 'rgba(70,40,30,0.55)') => { g.lineWidth = w; g.strokeStyle = col; g.lineJoin = 'round'; g.stroke(); };
  cell(GLYPH.heart, () => {
    g.beginPath();
    g.moveTo(32, 54);
    g.bezierCurveTo(6, 36, 6, 12, 20, 11); g.bezierCurveTo(27, 10, 31, 16, 32, 20);
    g.bezierCurveTo(33, 16, 37, 10, 44, 11); g.bezierCurveTo(58, 12, 58, 36, 32, 54);
    g.fillStyle = '#ef6f7d'; g.fill(); outline(2.5, 'rgba(140,40,50,0.6)');
    g.beginPath(); g.ellipse(21, 21, 5, 3.5, -0.6, 0, TAU); g.fillStyle = 'rgba(255,255,255,0.75)'; g.fill();
  });
  cell(GLYPH.note, () => {
    g.fillStyle = '#5a3a5e'; g.strokeStyle = '#5a3a5e'; g.lineWidth = 5;
    g.beginPath(); g.ellipse(22, 46, 9, 7, -0.4, 0, TAU); g.fill();
    g.beginPath(); g.moveTo(30, 45); g.lineTo(30, 12); g.quadraticCurveTo(42, 18, 48, 28); g.stroke();
  });
  cell(GLYPH.sparkle, () => {
    g.beginPath();
    for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU - PI / 2, r = i % 2 ? 7 : 27; g.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r); }
    g.closePath(); g.fillStyle = '#ffd95a'; g.fill(); outline(2, 'rgba(160,110,20,0.6)');
    g.beginPath(); g.arc(32, 32, 5, 0, TAU); g.fillStyle = '#fffbe6'; g.fill();
  });
  cell(GLYPH.drop, () => {
    g.beginPath(); g.moveTo(32, 8); g.bezierCurveTo(40, 22, 48, 32, 48, 41); g.arc(32, 41, 16, 0, PI); g.bezierCurveTo(16, 32, 24, 22, 32, 8);
    g.fillStyle = '#6fb6e0'; g.fill(); outline(2.5, 'rgba(30,80,120,0.55)');
    g.beginPath(); g.ellipse(26, 40, 3.5, 6, 0.3, 0, TAU); g.fillStyle = 'rgba(255,255,255,0.8)'; g.fill();
  });
  cell(GLYPH.chip, () => {
    g.beginPath(); g.moveTo(12, 38); g.lineTo(28, 14); g.lineTo(52, 22); g.lineTo(46, 46); g.lineTo(22, 52); g.closePath();
    g.fillStyle = '#d8a866'; g.fill(); outline(3, 'rgba(110,70,30,0.7)');
    g.beginPath(); g.moveTo(22, 36); g.lineTo(42, 30); g.strokeStyle = 'rgba(140,90,40,0.6)'; g.lineWidth = 2.5; g.stroke();
  });
  cell(GLYPH.seed, () => {
    for (const [x, y, a] of [[22, 24, 0.5], [42, 28, -0.4], [30, 44, 0.1]]) {
      g.beginPath(); g.ellipse(x, y, 6, 9, a, 0, TAU); g.fillStyle = '#c9a46a'; g.fill(); outline(2, 'rgba(100,70,30,0.6)');
    }
  });
  cell(GLYPH.puff, () => {
    const grd = g.createRadialGradient(32, 32, 4, 32, 32, 30);
    grd.addColorStop(0, 'rgba(255,255,255,0.95)'); grd.addColorStop(0.6, 'rgba(240,240,236,0.75)'); grd.addColorStop(1, 'rgba(230,230,226,0)');
    g.fillStyle = grd;
    for (const [x, y, r] of [[24, 36, 16], [40, 34, 15], [32, 24, 15]]) { g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); }
  });
  cell(GLYPH.z, () => {
    g.font = 'bold 46px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 6; g.strokeStyle = 'rgba(255,255,255,0.9)'; g.strokeText('z', 32, 34);
    g.fillStyle = '#6b7fc4'; g.fillText('z', 32, 34);
  });
  cell(GLYPH.letter, () => {
    g.beginPath(); g.rect(10, 18, 44, 30); g.fillStyle = '#fbf3e0'; g.fill(); outline(2.5);
    g.beginPath(); g.moveTo(10, 18); g.lineTo(32, 36); g.lineTo(54, 18); outline(2.5);
    g.beginPath(); g.arc(32, 36, 5, 0, TAU); g.fillStyle = '#c8382e'; g.fill();
  });
  cell(GLYPH.bread, () => {
    g.beginPath(); g.ellipse(32, 36, 24, 15, 0, 0, TAU); g.fillStyle = '#d99a4e'; g.fill(); outline(3, 'rgba(110,60,20,0.65)');
    g.strokeStyle = 'rgba(255,230,180,0.85)'; g.lineWidth = 3;
    for (const x of [22, 32, 42]) { g.beginPath(); g.moveTo(x - 4, 30); g.lineTo(x + 4, 40); g.stroke(); }
  });
  cell(GLYPH.fish, () => {
    g.beginPath(); g.ellipse(28, 32, 18, 10, 0, 0, TAU); g.fillStyle = '#7fa7c4'; g.fill(); outline(2.5, 'rgba(40,70,100,0.6)');
    g.beginPath(); g.moveTo(44, 32); g.lineTo(56, 22); g.lineTo(56, 42); g.closePath(); g.fillStyle = '#6a92b0'; g.fill(); outline(2.5, 'rgba(40,70,100,0.6)');
    g.beginPath(); g.arc(19, 29, 2.5, 0, TAU); g.fillStyle = '#1e2a33'; g.fill();
  });
  cell(GLYPH.bee, () => {
    g.beginPath(); g.ellipse(24, 22, 9, 12, -0.5, 0, TAU); g.ellipse(40, 22, 9, 12, 0.5, 0, TAU); g.fillStyle = 'rgba(235,245,255,0.85)'; g.fill();
    g.beginPath(); g.ellipse(32, 38, 15, 11, 0, 0, TAU); g.fillStyle = '#f2c230'; g.fill(); outline(2.5, 'rgba(60,40,10,0.7)');
    g.fillStyle = '#2b2018'; for (const x of [27, 36]) g.fillRect(x - 2.5, 28, 5, 20);
  });
  atlas = new THREE.CanvasTexture(c);
  atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.generateMipmaps = true;
  atlas.minFilter = THREE.LinearMipmapLinearFilter;
  return atlas;
}

const texCache = {};
/**
 * Soft canvas textures: 'blob' (black, alpha falloff), 'spill' (warm, a rounded pool), 'ring' (a soft golden ring
 * peaking at 80 % of the half-size).
 */
export function softTexture(kind) {
  if (texCache[kind]) return texCache[kind];
  const N = 64, c = canvas(N, N), g = c.getContext('2d'), img = g.createImageData(N, N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = ((x + 0.5) / N) * 2 - 1, v = ((y + 0.5) / N) * 2 - 1, i = (y * N + x) * 4;
      let a = 0, r = 255, gg = 255, b = 255;
      if (kind === 'blob') {
        const d = Math.hypot(u, v);
        a = d >= 1 ? 0 : Math.pow(1 - d * d, 1.6);
        r = gg = b = 0;
      } else if (kind === 'spill') {
        const d = Math.pow(Math.pow(Math.abs(u), 3) + Math.pow(Math.abs(v), 3), 1 / 3);
        a = d >= 1 ? 0 : Math.pow(1 - d, 1.4);
      } else {
        const d = Math.hypot(u, v);
        a = Math.max(0, 1 - Math.abs(d - 0.8) / 0.18);
        a = a * a * (3 - 2 * a);
        if (d < 0.8) a = Math.max(a, 0.12 * (1 - Math.abs(d - 0.8) / 0.8));
      }
      img.data[i] = r; img.data[i + 1] = gg; img.data[i + 2] = b; img.data[i + 3] = Math.round(a * 255);
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  texCache[kind] = t;
  return t;
}
