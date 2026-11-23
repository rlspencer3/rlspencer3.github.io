// Hearthwood — floors, foundations & the structural frame.
//
//   cat 'base' : foundation · floor · deck · path · steps
//   cat 'frame': post · beam · stairs · stairs_spiral · ladder · pergola
//
// Conventions (see docs/ARCHITECTURE.md):
//  * Cell pieces are built around the cell centre at levelY(y); the cell spans local X,Z ∈ [-1, 1].
//    At level 0 the ground is local y = -BASE_Y.
//  * Upper floors/decks put their walking surface LIFT (6 mm) above levelY(y) so that the tops of
//    the walls / beams / posts of the storey below (which end exactly at levelY(y)) are tucked
//    under the boards instead of z-fighting with them. Items standing at local y = 0 are fine.
//  * Floor tops use planar UVs in local metres (u = x, v = -z), so the 2 m floor textures tile
//    seamlessly across cells (planks run along local X).
//  * Everything uses shared cached geometry and shared materials; the world merges by material.

import * as THREE from 'three';
import { registerPiece } from '../catalog.js';
import { LEVEL_H, BASE_Y, FLOOR_T, MAX_LEVEL, DIRS, K } from '../config.js';
import { mat } from '../materials.js';
import { boxGeo, cylGeo, sphereGeo, add, addBox, cached } from '../geom.js';

const LIFT = 0.006;                 // upper walking surfaces sit this far above levelY(y)
const FLOOR_MATS = ['floorOak', 'floorPine', 'floorStone', 'floorTile', 'deck'];
const PLATFORM = new Set(['foundation', 'floor', 'deck', 'steps']);   // level-0 pieces that fill a cell up to the floor
const STAIRS = new Set(['stairs', 'stairs_spiral', 'ladder']);         // pieces that need an opening in the floor above
const NB8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

const r3 = (n) => Math.round(n * 1000) / 1000;
const _up = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();

// ------------------------------------------------------------------ geometry helpers

/**
 * Axis-aligned box from min/max corners with planar UVs taken from the actual local coordinates
 * (metres), so neighbouring cells line up their textures. Cached.
 */
function pbox(x0, x1, y0, y1, z0, z1) {
  const key = `fl:pbox|${r3(x0)},${r3(x1)},${r3(y0)},${r3(y1)},${r3(z0)},${r3(z1)}`;
  return cached(key, () => {
    const pos = [], nor = [], uv = [], idx = [];
    const face = (v, n, t) => {
      const b = pos.length / 3;
      for (let i = 0; i < 4; i++) { pos.push(...v[i]); nor.push(...n); uv.push(...t[i]); }
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    };
    face([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], [1, 0, 0], [[-z1, y0], [-z0, y0], [-z0, y1], [-z1, y1]]);
    face([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0], [[z0, y0], [z1, y0], [z1, y1], [z0, y1]]);
    face([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], [0, 1, 0], [[x0, -z1], [x1, -z1], [x1, -z0], [x0, -z0]]);
    face([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [0, -1, 0], [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]);
    face([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1], [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
    face([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], [0, 0, -1], [[-x1, y0], [-x0, y0], [-x0, y1], [-x1, y1]]);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeBoundingSphere();
    return g;
  });
}
const pb = (parent, m, x0, x1, y0, y1, z0, z1) => add(parent, pbox(x0, x1, y0, y1, z0, z1), m);

/**
 * Flat extruded polygon lying in the XZ plane (points are [x, z] pairs), bottom at y = 0, top at y = t.
 * Cap UVs are local metres. Cached.
 */
function flatPoly(pts, t) {
  const key = 'fl:flat|' + pts.map(([x, z]) => r3(x) + ',' + r3(z)).join(';') + '|' + r3(t);
  return cached(key, () => {
    const shape = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z)));
    const g = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false, curveSegments: 4 });
    g.rotateX(-Math.PI / 2);         // extrusion axis (+Z) becomes +Y; shape (x, -z) lands on (x, z)
    g.clearGroups();
    g.computeVertexNormals();
    return g;
  });
}

/**
 * Side profile extruded across X: points are [z, y] pairs in the local YZ plane, thickness w centred on x = xc.
 */
function sideProfile(parent, m, pts, w, xc = 0) {
  const key = 'fl:side|' + pts.map(([z, y]) => r3(z) + ',' + r3(y)).join(';') + '|' + r3(w);
  const geo = cached(key, () => {
    const shape = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(z, y)));
    const g = new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false });
    g.translate(0, 0, -w / 2);
    g.rotateY(-Math.PI / 2);         // shape x -> local z, extrusion -> local x
    g.clearGroups();
    g.computeVertexNormals();
    return g;
  });
  return add(parent, geo, m, xc, 0, 0);
}

/** Profile in the local XY plane (points [x, y]) extruded along Z by depth d, centred on z = zc. */
function frontProfile(parent, m, pts, d, zc = 0) {
  const key = 'fl:front|' + pts.map(([x, y]) => r3(x) + ',' + r3(y)).join(';') + '|' + r3(d);
  const geo = cached(key, () => {
    const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
    const g = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false });
    g.translate(0, 0, -d / 2);
    g.clearGroups();
    g.computeVertexNormals();
    return g;
  });
  return add(parent, geo, m, 0, 0, zc);
}

/** A box of cross-section w × d whose long axis runs from point a to point b. */
function seg(parent, m, a, b, w, d = w) {
  _dir.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = _dir.length();
  const o = add(parent, boxGeo(w, len, d), m, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  o.quaternion.setFromUnitVectors(_up, _dir.normalize());
  return o;
}

/** A round rod of radius r from a to b. */
function rod(parent, m, a, b, r, segs = 6) {
  _dir.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = _dir.length();
  const o = add(parent, cylGeo(r, r, len, segs), m, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  o.quaternion.setFromUnitVectors(_up, _dir.normalize());
  return o;
}

/** Small deterministic PRNG. */
function rng(seed) {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
const variantOf = (p) => ((p.x * 7 + p.z * 13) % 4 + 4) % 4;
// Templates are cached by t|m|c|k|h|s (+contextKey +cacheExtra) — NOT by level — so anything that
// differs between ground level and upper levels must be keyed by this.
const lvl = (p) => (p.y === 0 ? 'g' : 'u');
const variantKey = (p) => String(variantOf(p));

// ------------------------------------------------------------------ neighbour helpers

/** World cell offset of a local (lx, lz) step for a cell piece with rotation r. */
function cellOff(r, lx, lz) {
  const f = DIRS[r & 3], s = DIRS[(r + 1) & 3];
  return [lx * s[0] + lz * f[0], lx * s[1] + lz * f[1]];
}
function platformAt(ctx, x, z, y = 0) {
  const q = ctx.get(K.F(x, y, z));
  return !!q && PLATFORM.has(q.t);
}
/** Neighbour lookup in the piece's LOCAL frame: n(lx, lz) -> bool. */
function localNb(p, test) {
  return (lx, lz) => { const [dx, dz] = cellOff(p.r || 0, lx, lz); return test(p.x + dx, p.z + dz); };
}

// ====================================================================== BASE

// ---------------------------------------------------------------- foundation
// Cut-stone plinth from below the ground up to the floor; the floor material is the top surface.
// Outer sides get a plinth that steps out under the walls plus a stone cap lip; shared sides are
// skipped. Corner ownership: ±X strips own convex corner squares, ±Z strips are trimmed at concave
// corners — so neighbouring strips never overlap (no z-fighting) and never leave gaps.

const FD = { y0: -BASE_Y - 0.12, top: 0.05, cap: 0.07, PL: 0.1, CL: 0.14 };

registerPiece({
  id: 'foundation', name: 'Stone Foundation', cat: 'base', slot: 'cell', layer: 'F', rot: 'none',
  mats: FLOOR_MATS, matGroup: 'floor', paint: true, levels: [0, 0], contextual: true,
  icon: '🟫', sound: 'stone', desc: 'A cut-stone plinth with a floor on top. Start every house here.',
  contextKey(p, ctx) {
    let s = '';
    for (const [dx, dz] of NB8) s += platformAt(ctx, p.x + dx, p.z + dz) ? '1' : '0';
    return s;
  },
  build(p, ctx) {
    const g = new THREE.Group();
    const n = (dx, dz) => platformAt(ctx, p.x + dx, p.z + dz);
    const stone = mat('stoneBlock');
    const { y0, top, cap, PL, CL } = FD;
    pb(g, mat(p.m, p.c), -1, 1, -top, 0, -1, 1);
    pb(g, stone, -1, 1, y0, -top, -1, 1);
    // strips: [extent, yBottom, yTop]
    const layers = [[PL, y0, -cap], [CL, -cap, 0]];
    for (const sx of [-1, 1]) {
      if (n(sx, 0)) continue;
      for (const [L, ya, yb] of layers) {
        const ext = (ez) => !n(0, ez) && !n(sx, ez);
        const z0 = ext(-1) ? -1 - L : -1, z1 = ext(1) ? 1 + L : 1;
        const xa = sx > 0 ? 1 : -1 - L, xb = sx > 0 ? 1 + L : -1;
        pb(g, stone, xa, xb, ya, yb, z0, z1);
      }
    }
    for (const sz of [-1, 1]) {
      if (n(0, sz)) continue;
      for (const [L, ya, yb] of layers) {
        const x0 = n(-1, sz) ? -1 + L : -1, x1 = n(1, sz) ? 1 - L : 1;
        const za = sz > 0 ? 1 : -1 - L, zb = sz > 0 ? 1 + L : -1;
        pb(g, stone, x0, x1, ya, yb, za, zb);
      }
    }
    return g;
  },
});

// ---------------------------------------------------------------- floor
// Slab: floor boards on top, ceiling planks + joists (wood) underneath. Level 0: a timber skirt
// down to the ground. If stairs / a ladder rise into this cell from below, the floor becomes a
// stairwell: an open hole with a trimmed edge and a little railing (open toward the stair exit).

const JOISTS = [-2 / 3, 0, 2 / 3];

function stairBelow(p, ctx) {
  if (p.y < 1) return null;
  const q = ctx.get(K.I(p.x, p.y - 1, p.z));
  return q && STAIRS.has(q.t) ? q : null;
}
/** Which sides of the cell (world dir index 0..3 = +Z,+X,-Z,-X) already have a wall-like piece at this level. */
function edgeKeys(p) {
  return [K.W('x', p.x, p.y, p.z + 1), K.W('z', p.x + 1, p.y, p.z), K.W('x', p.x, p.y, p.z), K.W('z', p.x, p.y, p.z)];
}

registerPiece({
  id: 'floor', name: 'Floor', cat: 'base', slot: 'cell', layer: 'F', rot: 'none',
  mats: FLOOR_MATS, matGroup: 'floor', paint: true, contextual: true,
  icon: '▫️', sound: 'wood', desc: 'Floor boards — and the beamed ceiling of the room below.',
  thumb: { y: 1 },
  contextKey(p, ctx) {
    const s = stairBelow(p, ctx);
    if (!s) return lvl(p);
    return 'h' + s.r + edgeKeys(p).map((k) => (ctx.get(k) ? '1' : '0')).join('');
  },
  build(p, ctx) {
    const g = new THREE.Group();
    const fm = mat(p.m, p.c), wood = mat('wood');
    const T = p.y > 0 ? LIFT : 0;
    const BL = -0.045;                     // bottom of the board layer
    if (p.y === 0) {
      // a dark timber skirt down to the ground with a chunky kick board (one extra material only)
      const tim = mat('timber');
      pb(g, fm, -1, 1, BL, T, -1, 1);
      pb(g, tim, -1, 1, -BASE_Y - 0.06, BL, -1, 1);
      pb(g, tim, -1.03, 1.03, -BASE_Y - 0.06, -BASE_Y + 0.06, -1.03, 1.03);
      return g;
    }
    const st = stairBelow(p, ctx);
    if (!st) {
      pb(g, fm, -1, 1, BL, T, -1, 1);
      pb(g, wood, -1, 1, -FLOOR_T, BL, -1, 1);
      for (const jx of JOISTS) pb(g, wood, jx - 0.05, jx + 0.05, -FLOOR_T - 0.1, -FLOOR_T, -1, 1);
      return g;
    }
    // ---- stairwell: border trim on the non-exit sides + railing
    const exit = st.r & 3;                 // world dir index the stairs climb toward
    const walls = edgeKeys(p).map((k) => !!ctx.get(k));
    const B = 0.08;
    const rail = mat('wood'), post = mat('timber');
    const posts = new Set();
    const sideBox = (d, a0, a1, y0, y1, inset0, inset1, m) => {
      // d: 0 +Z, 1 +X, 2 -Z, 3 -X ; a0..a1 along the side ; inset0..inset1 measured from the edge inward
      if (d === 0) pb(g, m, a0, a1, y0, y1, 1 - inset1, 1 - inset0);
      else if (d === 2) pb(g, m, a0, a1, y0, y1, -1 + inset0, -1 + inset1);
      else if (d === 1) pb(g, m, 1 - inset1, 1 - inset0, y0, y1, a0, a1);
      else pb(g, m, -1 + inset0, -1 + inset1, y0, y1, a0, a1);
    };
    const at = (d, a, inset) => {
      if (d === 0) return [a, 1 - inset];
      if (d === 2) return [a, -1 + inset];
      if (d === 1) return [1 - inset, a];
      return [-1 + inset, a];
    };
    for (let d = 0; d < 4; d++) {
      if (d === exit) continue;
      // trim along this side; sides adjacent to the exit run the full length, the opposite side sits between them
      const opp = (exit + 2) & 3;
      const a0 = d === opp ? -1 + B : -1, a1 = d === opp ? 1 - B : 1;
      sideBox(d, a0, a1, BL, T, 0, B, fm);
      sideBox(d, a0, a1, -FLOOR_T, BL, 0, B, wood);
      if (walls[d]) continue;
      // railing along this side
      const ra = d === opp ? -1 + B : -1 + 0.05, rb = d === opp ? 1 - B : 1 - 0.05;
      const ends = [ra + 0.035, rb - 0.035];
      for (const a of ends) {
        const [x, z] = at(d, a, B / 2);
        const k = `${r3(x)},${r3(z)}`;
        if (posts.has(k)) continue;
        posts.add(k);
        addBox(g, post, 0.075, 0.98, 0.075, x, T, z);
      }
      // top rail
      sideBox(d, ends[0], ends[1], T + 0.86, T + 0.93, B / 2 - 0.035, B / 2 + 0.035, rail);
      sideBox(d, ends[0], ends[1], T + 0.08, T + 0.13, B / 2 - 0.025, B / 2 + 0.025, rail);
      const len = ends[1] - ends[0], nb = Math.max(2, Math.round(len / 0.22));
      for (let i = 1; i < nb; i++) {
        const [x, z] = at(d, ends[0] + (len * i) / nb, B / 2);
        addBox(g, rail, 0.035, 0.73, 0.035, x, T + 0.13, z);
      }
    }
    return g;
  },
});

// ---------------------------------------------------------------- deck
// Boards with small gaps along local X on joists; a rim joist on open sides. Level 0: little
// stone piers under the rim at open corners and side mid-points.

const DECK_BOARDS = 8;

registerPiece({
  id: 'deck', name: 'Porch Deck', cat: 'base', slot: 'cell', layer: 'F', rot: 'four',
  mats: ['deck', 'floorPine', 'floorOak'], matGroup: 'deck', contextual: true,
  icon: '🟧', sound: 'wood', desc: 'Gappy porch boards on little stone piers. Rotate to turn the boards.',
  contextKey(p, ctx) {
    const n = localNb(p, (x, z) => platformAt(ctx, x, z, p.y));
    return lvl(p) + [n(1, 0), n(-1, 0), n(0, 1), n(0, -1)].map((b) => (b ? 1 : 0)).join('');
  },
  build(p, ctx) {
    const g = new THREE.Group();
    const bm = mat(p.m), tim = mat('timber');
    const n = localNb(p, (x, z) => platformAt(ctx, x, z, p.y));
    const open = { px: !n(1, 0), nx: !n(-1, 0), pz: !n(0, 1), nz: !n(0, -1) };
    const T = p.y > 0 ? LIFT : 0;
    const BT = 0.04, pitch = 2 / DECK_BOARDS, bw = pitch - 0.02;
    for (let i = 0; i < DECK_BOARDS; i++) {          // planar UVs: each board shows its own grain
      const zc = -1 + pitch * (i + 0.5);
      pb(g, bm, -1, 1, T - BT, T, zc - bw / 2, zc + bw / 2);
    }
    const jb = T - BT;                                  // underside of boards
    const RH = p.y === 0 ? 0.12 : 0.18;                 // rim height
    // dark underlay so the board gaps read as shadow lines instead of flickering see-through slits
    pb(g, tim, -1, 1, jb - 0.012, jb - 0.002, -1, 1);
    for (const jx of [-0.7, 0, 0.7]) pb(g, tim, jx - 0.03, jx + 0.03, jb - RH + 0.02, jb - 0.012, -1, 1);
    const RT = 0.045;
    if (open.px) pb(g, tim, 1 - RT, 1, jb - RH, jb, -1, 1);
    if (open.nx) pb(g, tim, -1, -1 + RT, jb - RH, jb, -1, 1);
    const xa = open.nx ? -1 + RT : -1, xb = open.px ? 1 - RT : 1;
    if (open.pz) pb(g, tim, xa, xb, jb - RH, jb, 1 - RT, 1);
    if (open.nz) pb(g, tim, xa, xb, jb - RH, jb, -1, -1 + RT);
    if (p.y === 0) {
      const stone = mat('stoneBlock');
      const piers = [];
      const E = 0.8;
      if (open.px) piers.push([E, 0]);
      if (open.nx) piers.push([-E, 0]);
      if (open.pz) piers.push([0, E]);
      if (open.nz) piers.push([0, -E]);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        if ((sx > 0 ? open.px : open.nx) && (sz > 0 ? open.pz : open.nz)) piers.push([sx * E, sz * E]);
      }
      for (const [x, z] of piers) pb(g, stone, x - 0.11, x + 0.11, -BASE_Y - 0.08, jb - RH + 0.01, z - 0.11, z + 0.11);
    }
    return g;
  },
});

// ---------------------------------------------------------------- path
// Garden path at ground level (level 0 only), top ≈ 2 cm above the ground.
//   path       — chunky stepping-stone crazy paving with grass between
//   floorStone — squared flagstones in a random ashlar layout
//   brick      — basket-weave brick pavers with a soldier-course edging on open sides

const GROUND = -BASE_Y;

function chamfered(poly, c) {
  // cut every corner of a convex polygon by c (or less on short edges)
  const out = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[(i + n - 1) % n], b = poly[i], d = poly[(i + 1) % n];
    const l1 = Math.hypot(a[0] - b[0], a[1] - b[1]), l2 = Math.hypot(d[0] - b[0], d[1] - b[1]);
    const c1 = Math.min(c, l1 * 0.3), c2 = Math.min(c, l2 * 0.3);
    out.push([b[0] + ((a[0] - b[0]) * c1) / l1, b[1] + ((a[1] - b[1]) * c1) / l1]);
    out.push([b[0] + ((d[0] - b[0]) * c2) / l2, b[1] + ((d[1] - b[1]) * c2) / l2]);
  }
  return out;
}
function inset(poly, d) {
  // shrink a convex polygon toward its centroid by roughly d metres
  let cx = 0, cz = 0;
  for (const [x, z] of poly) { cx += x; cz += z; }
  cx /= poly.length; cz /= poly.length;
  return poly.map(([x, z]) => {
    const dx = x - cx, dz = z - cz, l = Math.hypot(dx, dz) || 1;
    const k = Math.max(0, (l - d * 1.25) / l);
    return [cx + dx * k, cz + dz * k];
  });
}

function crazyPaving(g, m, v) {
  const R = rng(101 + v * 17);
  // 3x3 grid; border vertices fixed so neighbouring cells line up, interior vertices jittered
  const N = 3, xs = [];
  for (let i = 0; i <= N; i++) {
    xs.push([]);
    for (let j = 0; j <= N; j++) {
      let x = -1 + (2 * i) / N, z = -1 + (2 * j) / N;
      if (i > 0 && i < N) x += (R() - 0.5) * 0.36;
      if (j > 0 && j < N) z += (R() - 0.5) * 0.36;
      if (i > 0 && i < N && j > 0 && j < N) { x += (R() - 0.5) * 0.12; z += (R() - 0.5) * 0.12; }
      xs[i].push([x, z]);
    }
  }
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const quad = [xs[i][j], xs[i + 1][j], xs[i + 1][j + 1], xs[i][j + 1]];
    const poly = chamfered(inset(quad, 0.05), 0.09);
    const top = GROUND + 0.014 + R() * 0.014;
    add(g, flatPoly(poly, 0.07), m, 0, top - 0.07, 0);
  }
}

const ASHLAR = [
  [[0.8, 0.6, 0.6], [0.5, 0.9, 0.6], [0.7, 0.7, 0.6], [1.0, 1.0]],
  [[0.6, 0.8, 0.6], [1.0, 0.5, 0.5], [0.5, 0.8, 0.7], [0.7, 0.6, 0.7]],
  [[1.0, 1.0], [0.7, 0.6, 0.7], [0.5, 0.9, 0.6], [0.6, 0.7, 0.7]],
  [[0.5, 0.7, 0.8], [0.8, 0.6, 0.6], [1.0, 1.0], [0.6, 0.8, 0.6]],
];
function flagstones(g, m, v) {
  const R = rng(300 + v * 31);
  const rows = ASHLAR[v], rh = 2 / rows.length, gap = 0.035;
  rows.forEach((row, ri) => {
    let x = -1;
    const z0 = -1 + ri * rh;
    for (const w of row) {
      const t = 0.045 + R() * 0.01;
      add(g, pbox(x + gap / 2, x + w - gap / 2, GROUND - 0.03, GROUND - 0.03 + t, z0 + gap / 2, z0 + rh - gap / 2), m);
      x += w;
    }
  });
}

function brickPaving(g, m, open, parity) {
  // basket weave of 0.4 m squares, each two 0.4 x 0.2 bricks; borders replaced by soldier courses.
  // 5 squares per cell is odd, so the weave flips with the cell's (x + z) parity to stay continuous.
  const B = 0.12;                                     // edging band
  const x0 = open.nx ? -1 + B : -1, x1 = open.px ? 1 - B : 1;
  const z0 = open.nz ? -1 + B : -1, z1 = open.pz ? 1 - B : 1;
  const gap = 0.014, top = GROUND + 0.02, bot = GROUND - 0.03;
  for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) {
    const sx = -1 + i * 0.4, sz = -1 + j * 0.4;
    for (let k = 0; k < 2; k++) {
      let a0, a1, b0, b1;
      if ((i + j + parity) % 2 === 0) { a0 = sx; a1 = sx + 0.4; b0 = sz + k * 0.2; b1 = b0 + 0.2; }
      else { a0 = sx + k * 0.2; a1 = a0 + 0.2; b0 = sz; b1 = sz + 0.4; }
      // clip to the field inside the edging
      const ca0 = Math.max(a0, x0), ca1 = Math.min(a1, x1), cb0 = Math.max(b0, z0), cb1 = Math.min(b1, z1);
      if (ca1 - ca0 < 0.06 || cb1 - cb0 < 0.06) continue;
      const lift = (((i * 5 + j) * 7 + k * 3) % 5) * 0.0015;
      pb(g, m, ca0 + gap / 2, ca1 - gap / 2, bot, top + lift, cb0 + gap / 2, cb1 - gap / 2);
    }
  }
  // soldier courses: bricks on end along open sides, a touch proud of the field
  const st = GROUND + 0.035;
  const course = (horiz, c0, c1, p0, p1) => {
    const n = Math.max(1, Math.round((c1 - c0) / 0.2));
    const w = (c1 - c0) / n;
    for (let i = 0; i < n; i++) {
      const a = c0 + i * w + gap / 2, b = c0 + (i + 1) * w - gap / 2;
      if (horiz) pb(g, m, a, b, bot, st, p0, p1);
      else pb(g, m, p0, p1, bot, st, a, b);
    }
  };
  if (open.pz) course(true, -1, 1, 1 - B + gap / 2, 1 - gap / 2);
  if (open.nz) course(true, -1, 1, -1 + gap / 2, -1 + B - gap / 2);
  if (open.px) course(false, z0, z1, 1 - B + gap / 2, 1 - gap / 2);
  if (open.nx) course(false, z0, z1, -1 + gap / 2, -1 + B - gap / 2);
}

registerPiece({
  id: 'path', name: 'Garden Path', cat: 'base', slot: 'cell', layer: 'F', rot: 'none',
  mats: ['path', 'floorStone', 'brick'], matGroup: 'path', levels: [0, 0], contextual: true,
  icon: '🪨', sound: 'stone', desc: 'Stepping stones, flagstones or brick pavers for the garden.',
  cacheExtra: variantKey,
  contextKey(p, ctx) {
    if (p.m !== 'brick') return '';
    const n = (dx, dz) => ctx.get(K.F(p.x + dx, 0, p.z + dz))?.t === 'path';
    return [n(1, 0), n(-1, 0), n(0, 1), n(0, -1)].map((b) => (b ? 1 : 0)).join('');
  },
  build(p, ctx) {
    const g = new THREE.Group();
    const m = mat(p.m);
    const v = variantOf(p);
    if (p.m === 'floorStone') flagstones(g, m, v);
    else if (p.m === 'brick') {
      const n = (dx, dz) => ctx.get(K.F(p.x + dx, 0, p.z + dz))?.t === 'path';
      brickPaving(g, m, { px: !n(1, 0), nx: !n(-1, 0), pz: !n(0, 1), nz: !n(0, -1) }, v % 2);   // v % 2 == (x + z) % 2
    } else crazyPaving(g, m, v);
    return g;
  },
});

// ---------------------------------------------------------------- steps
// A little stoop: climbs from the ground at local −Z to the foundation top (y = 0) at local +Z.

const STEP_Z = [-0.5, -0.1, 0.3, 1.0];     // fronts of step 1, step 2, landing, and the back
const STEP_W = 0.78;                       // half width

registerPiece({
  id: 'steps', name: 'Porch Steps', cat: 'base', slot: 'cell', layer: 'F', rot: 'four',
  mats: ['stoneBlock', 'deck', 'wood'], matGroup: 'steps', levels: [0, 0], thumb: { r: 2 },
  icon: '🪜', sound: 'stone', desc: 'A welcoming stoop up to the front door. Rotate so it climbs toward the house.',
  build(p) {
    const g = new THREE.Group();
    const n = STEP_Z.length - 1, rise = BASE_Y / n, W = STEP_W;
    const bot = -BASE_Y - 0.06;
    if (p.m === 'stoneBlock') {
      const stone = mat('stoneBlock');
      for (let k = 0; k < n; k++) {
        const top = -BASE_Y + rise * (k + 1);
        const za = STEP_Z[k], zb = STEP_Z[k + 1];
        pb(g, stone, -W, W, bot, top - 0.045, za, zb);
        // tread slab with a small nosing over the front and sides
        pb(g, stone, -W - 0.025, W + 0.025, top - 0.045, top, za - 0.03, zb);
      }
      return g;
    }
    const tm = mat(p.m), wood = mat(p.m === 'wood' ? 'timber' : 'wood');
    // side stringers: stepped profile plates
    const prof = [[STEP_Z[0], bot]];
    for (let k = 0; k < n; k++) {
      const top = -BASE_Y + rise * (k + 1) - 0.04;
      prof.push([STEP_Z[k], top], [STEP_Z[k + 1], top]);
    }
    prof.push([STEP_Z[n], bot]);
    for (const sx of [-1, 1]) sideProfile(g, wood, prof, 0.05, sx * (W - 0.025));
    for (let k = 0; k < n; k++) {
      const top = -BASE_Y + rise * (k + 1);
      const za = STEP_Z[k], zb = STEP_Z[k + 1];
      // riser board
      pb(g, wood, -W + 0.05, W - 0.05, bot + 0.04, top - 0.04, za + 0.01, za + 0.04);
      // tread boards (two or more boards with a hairline gap), small nosing
      const depth = zb - za + 0.03, nbd = Math.max(2, Math.round(depth / 0.2));
      const bwid = depth / nbd;
      for (let i = 0; i < nbd; i++) {
        const z0 = za - 0.03 + i * bwid;
        pb(g, tm, -W - 0.02, W + 0.02, top - 0.04, top, z0 + 0.006, z0 + bwid - 0.006);
      }
    }
    return g;
  },
});

// ====================================================================== FRAME

// ---------------------------------------------------------------- post

const POST_TOP = LEVEL_H - 0.01;
const BEAM_H = 0.26;
const beamTop = (axis) => LEVEL_H - 0.01 - (axis === 'z' ? 0.025 : 0);

/** For a vertex: which of the 4 edges (+X, -X, +Z, -Z) carry a beam but no wall (so a knee brace fits). */
function braceDirs(p, ctx) {
  const e = [
    [K.B('x', p.x, p.y, p.z), K.W('x', p.x, p.y, p.z)],
    [K.B('x', p.x - 1, p.y, p.z), K.W('x', p.x - 1, p.y, p.z)],
    [K.B('z', p.x, p.y, p.z), K.W('z', p.x, p.y, p.z)],
    [K.B('z', p.x, p.y, p.z - 1), K.W('z', p.x, p.y, p.z - 1)],
  ];
  return e.map(([b, w]) => !!ctx.get(b) && !ctx.get(w));
}
const BRACE_DIR = [[1, 0, 'x'], [-1, 0, 'x'], [0, 1, 'z'], [0, -1, 'z']];

registerPiece({
  id: 'post', name: 'Post', cat: 'frame', slot: 'corner', layer: 'P',
  mats: ['timber', 'wood', 'log', 'stoneBlock', 'trim'], matGroup: 'frame', paint: true, contextual: true,
  icon: '🪵', sound: 'wood', desc: 'A sturdy corner post. Add beams on top and it grows knee braces.',
  contextKey(p, ctx) {
    if (p.m === 'stoneBlock' || p.m === 'trim') return lvl(p);
    return lvl(p) + braceDirs(p, ctx).map((b) => (b ? 1 : 0)).join('');
  },
  build(p, ctx) {
    const g = new THREE.Group();
    const m = mat(p.m, p.c);
    const ground = p.y === 0;
    const base = ground ? -0.02 : 0;
    if (ground && p.m !== 'stoneBlock') {
      // stone footing from below the ground up to just under the floor surface
      pb(g, mat('stoneBlock'), -0.17, 0.17, -BASE_Y - 0.08, -0.02, -0.17, 0.17);
    }
    let braceR = 0;
    if (p.m === 'stoneBlock') {
      // stacked stone column with alternating courses and a cap slab
      const y0 = ground ? -BASE_Y - 0.08 : 0;
      const capY = 2.1;
      const courses = 7, ch = (capY - y0) / courses;
      for (let i = 0; i < courses; i++) {
        const w = i % 2 ? 0.17 : 0.185;
        pb(g, m, -w, w, y0 + i * ch, y0 + (i + 1) * ch, -w, w);
      }
      pb(g, m, -0.22, 0.22, capY, capY + 0.1, -0.22, 0.22);
      pb(g, m, -0.15, 0.15, capY + 0.1, POST_TOP, -0.15, 0.15);
      return g;
    }
    if (p.m === 'trim') {
      // painted porch column: plinth, tapered square shaft, capital
      addBox(g, m, 0.3, 0.24 - base, 0.3, 0, base, 0);
      addBox(g, m, 0.26, 0.04, 0.26, 0, 0.24, 0);
      const sh = 1.82;
      add(g, cylGeo(0.081 * Math.SQRT2, 0.1 * Math.SQRT2, sh, 4), m, 0, 0.28 + sh / 2, 0, 0, Math.PI / 4, 0);
      addBox(g, m, 0.22, 0.04, 0.22, 0, 2.08, 0);
      addBox(g, m, 0.3, 0.09, 0.3, 0, 2.12, 0);
      addBox(g, m, 0.17, POST_TOP - 2.21, 0.17, 0, 2.21, 0);
      return g;
    }
    if (p.m === 'log') {
      add(g, cylGeo(0.12, 0.135, POST_TOP - base, 10), m, 0, base + (POST_TOP - base) / 2, 0);
      // a saddle collar near the top
      add(g, cylGeo(0.15, 0.15, 0.08, 10), m, 0, 2.15, 0);
      braceR = 0.05;
    } else {
      // square timber: shaft, base block, capital
      addBox(g, m, 0.22, POST_TOP - base, 0.22, 0, base, 0);
      addBox(g, m, 0.28, 0.08, 0.28, 0, 0, 0);
      addBox(g, m, 0.25, 0.03, 0.25, 0, 0.08, 0);
      addBox(g, m, 0.25, 0.03, 0.25, 0, 2.07, 0);
      addBox(g, m, 0.29, 0.1, 0.29, 0, 2.1, 0);
    }
    // knee braces toward beams (no wall in the way)
    const dirs = braceDirs(p, ctx);
    dirs.forEach((on, i) => {
      if (!on) return;
      const [dx, dz, axis] = BRACE_DIR[i];
      const yb = beamTop(axis) - BEAM_H;
      const a = [dx * 0.06, yb - 0.62, dz * 0.06], b = [dx * 0.66, yb + 0.04, dz * 0.66];
      if (braceR) rod(g, m, a, b, braceR, 8);
      else seg(g, m, a, b, 0.09, 0.09);
    });
    return g;
  },
});

// ---------------------------------------------------------------- beam
// A chunky beam just under the top of the storey. Free ends overhang the vertex with a cut end;
// ends that continue into a collinear beam stop exactly at the vertex. Beams along world Z sit
// 2.5 cm lower so crossing overhangs interlock without z-fighting.

function beamEnds(p, ctx) {
  // returns [hasNeighbourAtLocal+X, hasNeighbourAtLocal-X]
  const s = (p.a === 'x' ? 1 : -1) * (p.r === 2 ? -1 : 1);
  if (p.a === 'x') return [!!ctx.get(K.B('x', p.x + s, p.y, p.z)), !!ctx.get(K.B('x', p.x - s, p.y, p.z))];
  return [!!ctx.get(K.B('z', p.x, p.y, p.z + s)), !!ctx.get(K.B('z', p.x, p.y, p.z - s))];
}

registerPiece({
  id: 'beam', name: 'Beam', cat: 'frame', slot: 'edge', layer: 'B',
  mats: ['timber', 'wood', 'log', 'trim'], matGroup: 'frame', paint: true, contextual: true,
  icon: '➖', sound: 'wood', desc: 'A beam along the top of the storey — porches, timber frames, open lofts.',
  contextKey(p, ctx) {
    const [a, b] = beamEnds(p, ctx);
    return p.a + (a ? 1 : 0) + (b ? 1 : 0);
  },
  build(p, ctx) {
    const g = new THREE.Group();
    const m = mat(p.m, p.c);
    const [cp, cn] = beamEnds(p, ctx);
    const OH = 0.17, yT = beamTop(p.a), yB = yT - BEAM_H;
    const xR = cp ? 1 : 1 + OH, xL = cn ? -1 : -1 - OH;
    if (p.m === 'log') {
      const r = 0.13, yc = yT - r;
      add(g, cylGeo(r, r, xR - xL, 10), m, (xR + xL) / 2, yc, 0, 0, 0, Math.PI / 2);
      return g;
    }
    const c = 0.11;
    const pts = [];
    if (cn) pts.push([xL, yB]); else pts.push([xL, yT - 0.08], [xL + c, yB]);
    if (cp) pts.push([xR, yB]); else pts.push([xR - c, yB], [xR, yT - 0.08]);
    pts.push([xR, yT], [xL, yT]);
    frontProfile(g, m, pts, p.m === 'trim' ? 0.2 : 0.22);
    return g;
  },
});

// ---------------------------------------------------------------- stairs (straight)
// 10 risers of 0.25 m inside one cell, bottom at local −Z, top tread at local +Z level with the
// floor above. Treads + stringers + a handrail on the local +X side. Stone = solid steps.

const ST_N = 10, ST_RISE = LEVEL_H / ST_N, ST_RUN = 2 / ST_N, ST_W = 0.76;

registerPiece({
  id: 'stairs', name: 'Stairs', cat: 'frame', slot: 'cell', layer: 'I', rot: 'four',
  mats: ['wood', 'timber', 'floorOak', 'stoneBlock'], matGroup: 'stairs', levels: [0, MAX_LEVEL - 1], thumb: { r: 2 },
  icon: '🪜', sound: 'wood', desc: 'A straight staircase up one storey. The floor above opens into a stairwell.',
  cacheExtra: lvl,
  build(p) {
    const g = new THREE.Group();
    const stone = p.m === 'stoneBlock';
    const tm = mat(p.m);
    const sm = mat(p.m === 'floorOak' ? 'wood' : p.m === 'stoneBlock' ? 'stoneBlock' : p.m);
    const rm = mat(p.m === 'timber' ? 'wood' : 'timber');
    const base = p.y === 0 ? -BASE_Y : 0;
    const topOf = (i) => (i === ST_N ? LEVEL_H + LIFT : i * ST_RISE);
    for (let i = 1; i <= ST_N; i++) {
      const za = -1 + (i - 1) * ST_RUN, zb = za + ST_RUN, y = topOf(i);
      if (stone) {
        pb(g, tm, -ST_W, ST_W, base, y - 0.05, za, zb);
        pb(g, tm, -ST_W - 0.025, ST_W + 0.025, y - 0.05, y, za - (i === 1 ? 0.02 : 0.035), zb);
      }
      else pb(g, tm, -ST_W + 0.01, ST_W - 0.01, y - 0.045, y, za - (i === 1 ? 0 : 0.03), zb);
    }
    if (!stone) {
      // stringers: plates following the nosing line, with a foot on the floor and cut flush at the top
      const k = ST_RISE / ST_RUN;
      const topEdge = (z) => ST_RISE + 0.07 + (z + 1) * k;
      const botEdge = (z) => (z + 1) * k - 0.12;
      const yCut = LEVEL_H - 0.02, zf = -0.85;
      const zt = (yCut - ST_RISE - 0.07) / k - 1;
      const prof = [[-1, base], [zf, base], [zf, botEdge(zf)], [1, botEdge(1)], [1, yCut], [zt, yCut], [-1, topEdge(-1)]];
      for (const sx of [-1, 1]) sideProfile(g, sm, prof, 0.05, sx * (ST_W + 0.025));
    }
    // handrail on +X: newel posts + sloped rail + balusters
    const hx = ST_W + 0.05, H = 0.88;
    const zN0 = -0.92, zN1 = 0.9;
    const nose = (z) => ST_RISE * Math.ceil((z + 1) / ST_RUN - 1e-6);
    const y0 = nose(zN0), y1 = topOf(ST_N);
    addBox(g, rm, 0.09, H + 0.12 + (y0 - base), 0.09, hx, base, zN0);
    addBox(g, rm, 0.09, H + 0.12 + (y1 - 2.3), 0.09, hx, 2.3, zN1);
    addBox(g, rm, 0.11, 0.05, 0.11, hx, y0 + H + 0.12, zN0);
    addBox(g, rm, 0.11, 0.05, 0.11, hx, y1 + H + 0.12, zN1);
    seg(g, rm, [hx, y0 + H, zN0], [hx, y1 + H, zN1], 0.06, 0.06);
    for (let i = 2; i < ST_N; i += 1) {
      const zc = -1 + (i - 0.5) * ST_RUN;
      const yt = topOf(i);
      const yr = y0 + H + ((zc - zN0) / (zN1 - zN0)) * (y1 - y0);
      addBox(g, rm, 0.03, yr - yt, 0.03, hx, yt, zc);
    }
    return g;
  },
});

// ---------------------------------------------------------------- spiral stairs
// Around a central pole: 11 wedge treads sweep 270° from the +X side round to the −X side, then a
// landing fills the +Z quarter of the cell at the next floor's height.

const SP_N = 11, SP_R = 0.92, SP_RISE = LEVEL_H / (SP_N + 1), SP_SWEEP = Math.PI * 1.5;
const SP_D = SP_SWEEP / SP_N, SP_A0 = Math.PI / 4;
const polar = (a, r) => [Math.sin(a) * r, Math.cos(a) * r];      // angle 0 = +Z, π/2 = +X

function wedge(r0, r1, a0, a1, t) {
  const pts = [];
  const n = 4;
  for (let i = 0; i <= n; i++) pts.push(polar(a0 + ((a1 - a0) * i) / n, r1));
  pts.push(polar(a1, r0), polar(a0, r0));
  return flatPoly(pts, t);
}

registerPiece({
  id: 'stairs_spiral', name: 'Spiral Stairs', cat: 'frame', slot: 'cell', layer: 'I', rot: 'four',
  mats: ['wood', 'timber', 'iron'], matGroup: 'stairs', levels: [0, MAX_LEVEL - 1],
  icon: '🌀', sound: 'wood', desc: 'A space-saving spiral around a pole, landing on the +Z side upstairs.',
  cacheExtra: lvl,
  build(p) {
    const g = new THREE.Group();
    const iron = p.m === 'iron';
    const tm = mat(iron ? 'wood' : p.m);
    const fm = mat(iron ? 'iron' : 'timber');
    const base = p.y === 0 ? -BASE_Y : 0;
    const top = LEVEL_H + LIFT;
    // pole + finial
    add(g, cylGeo(0.065, 0.065, top + 0.95 - base, 10), fm, 0, (top + 0.95 + base) / 2, 0);
    add(g, sphereGeo(0.085, 10, 8), fm, 0, top + 0.99, 0);
    add(g, cylGeo(0.16, 0.18, 0.05, 12), fm, 0, 0.025 + Math.max(base, 0), 0);
    const tread = wedge(0.05, SP_R, -0.012, SP_D + 0.02, 0.05);
    const rail = [];
    for (let k = 1; k <= SP_N; k++) {
      const a = SP_A0 + (k - 1) * SP_D;
      const y = k * SP_RISE;
      add(g, tread, tm, 0, y - 0.05, 0, 0, a, 0);
      // baluster at the outer edge
      const ab = a + SP_D * 0.5;
      const [bx, bz] = polar(ab, SP_R - 0.05);
      addBox(g, fm, 0.035, 0.86, 0.035, bx, y, bz);
      rail.push([bx, y + 0.86, bz]);
    }
    // landing: +Z quarter, out to the cell edge
    add(g, flatPoly([[0, 0], [SP_R, SP_R], [SP_R, 1], [-SP_R, 1], [-SP_R, SP_R]], 0.06), tm, 0, top - 0.06, 0);
    // helical handrail through the baluster tops, then up to the landing rail
    const aEnd = SP_A0 + SP_SWEEP;
    const [ex, ez] = polar(aEnd, SP_R - 0.05);
    rail.push([ex, top + 0.9, ez]);
    for (let i = 0; i < rail.length - 1; i++) seg(g, fm, rail[i], rail[i + 1], 0.05, 0.05);
    // landing guard along the open edge above the first treads (pole -> +X+Z corner)
    const c = [SP_R - 0.03, SP_R - 0.03];
    addBox(g, fm, 0.06, 0.95, 0.06, c[0], top, c[1]);
    addBox(g, fm, 0.06, 0.95, 0.06, ex, top, ez);
    seg(g, fm, [0.06, top + 0.9, 0.06], [c[0], top + 0.9, c[1]], 0.05, 0.05);
    for (let i = 1; i < 4; i++) {
      const t = i / 4;
      addBox(g, fm, 0.03, 0.9, 0.03, c[0] * t + 0.06 * (1 - t), top, c[1] * t + 0.06 * (1 - t));
    }
    return g;
  },
});

// ---------------------------------------------------------------- ladder
// Leans against the local +Z side of the cell and pokes up past the floor above for a handhold.

registerPiece({
  id: 'ladder', name: 'Loft Ladder', cat: 'frame', slot: 'cell', layer: 'I', rot: 'four',
  mats: ['wood', 'timber'], matGroup: 'ladder', levels: [0, MAX_LEVEL - 1],
  icon: '🪜', sound: 'wood', desc: 'A simple wooden ladder up to a cosy loft.',
  cacheExtra: lvl,
  build(p) {
    const g = new THREE.Group();
    const m = mat(p.m);
    const s = 0.27;                                  // lean: dz per metre of height
    const zAt = (y) => 0.93 + (y - LEVEL_H) * s;
    const yb = p.y === 0 ? -BASE_Y : 0, yt = LEVEL_H + 0.6;
    for (const x of [-0.25, 0.25]) seg(g, m, [x, yb, zAt(yb)], [x, yt, zAt(yt)], 0.055, 0.075);
    for (let y = 0.3; y < LEVEL_H + 0.05; y += 0.3) {
      rod(g, m, [-0.27, y, zAt(y) - 0.005], [0.27, y, zAt(y) - 0.005], 0.022, 6);
    }
    return g;
  },
});

// ---------------------------------------------------------------- pergola (extra)
// Open slatted roof that sits on beams at the top of a storey (place it one level up, like a floor).
// Rafters run along local Z and overhang with cut tails on open ends; light purlins run across.

function pergolaNb(p, ctx) {
  return localNb(p, (x, z) => {
    const q = ctx.get(K.F(x, p.y, z));
    return !!q && (q.t === 'pergola' || q.t === 'floor' || q.t === 'deck');
  });
}

registerPiece({
  id: 'pergola', name: 'Pergola Top', cat: 'frame', slot: 'cell', layer: 'F', rot: 'four',
  mats: ['wood', 'timber', 'trim'], matGroup: 'frame', paint: true, levels: [1, MAX_LEVEL], contextual: true,
  icon: '🌿', sound: 'wood', desc: 'Open rafters over a patio or porch — dappled shade. Place one level up, on beams.',
  thumb: { y: 1 }, showcase: { y: 1 },
  contextKey(p, ctx) {
    const n = pergolaNb(p, ctx);
    return (n(0, 1) ? 1 : 0) + '' + (n(0, -1) ? 1 : 0);
  },
  build(p, ctx) {
    const g = new THREE.Group();
    const m = mat(p.m, p.c);
    const n = pergolaNb(p, ctx);
    const OH = 0.28, RH = 0.16, RW = 0.07;
    const zp = n(0, 1) ? 1 : 1 + OH, zn = n(0, -1) ? -1 : -1 - OH;
    for (const x of [-0.75, -0.25, 0.25, 0.75]) {
      const pts = [];
      // profile in (z, y): cut tails slope down-and-in on free ends
      if (zn < -1) pts.push([zn, RH], [zn, RH * 0.55], [zn + 0.12, 0]); else pts.push([zn, RH], [zn, 0]);
      if (zp > 1) pts.push([zp - 0.12, 0], [zp, RH * 0.55], [zp, RH]); else pts.push([zp, 0], [zp, RH]);
      sideProfile(g, m, pts, RW, x);
    }
    for (let i = 0; i < 5; i++) {
      const z = -0.8 + i * 0.4;
      pb(g, m, -1, 1, RH, RH + 0.045, z - 0.025, z + 0.025);
    }
    return g;
  },
});
