// Hearthwood — wall-like edge pieces (layer W): walls, half walls, arches, gables,
// windows, doors, railings, fences and hedges.
//
// Every wall is built from its MATERIAL, not just tinted:
//   log / logDark  real stacked logs with chinking; openings cut cleanly with plank bucks;
//                  L-corners get crossing log ends (x- and z-walls offset half a log so they interlock).
//   plaster        half-timbered: timber sill/top plates, posts and braces on both faces.
//   glass          slim timber mullion/transom grid with big glowing panes (sunroom / A-frame).
//   others         textured slab + cheap relief (base trim, battens, corner boards, quoins, stone sills).
// Corners: walls look up their W-layer neighbours at both end vertices (contextual + contextKey).
// At an L-corner the taller wall (tie: the axis-'x' wall) owns the corner: it extends by WALL_T/2
// and adds the corner trim; the other wall retracts by WALL_T/2 so nothing overlaps or z-fights.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/BufferGeometryUtils.js';
import { registerPiece } from '../catalog.js';
import { LEVEL_H, STEP, BASE_Y, WALL_T, K } from '../config.js';
import { mat } from '../materials.js';
import { boxGeo, cylGeo, sphereGeo, coneGeo, prismGeo, openingOutline, cached, add } from '../geom.js';

const T = WALL_T, HT = WALL_T / 2, H = LEVEL_H;
const WALL_MATS = ['clapboard', 'log', 'logDark', 'boardBatten', 'shingleSiding', 'plaster', 'stone', 'brick', 'planks', 'glass'];
const LOGS = new Set(['log', 'logDark']);
const BOARDED = new Set(['clapboard', 'shingleSiding', 'boardBatten', 'planks']);
const MASONRY = new Set(['stone', 'brick']);
const DEFAULT_ACCENT = '#7a4b3a';
const LIN = 0.045;            // opening frame (lining) width
const CW = 0.09;              // casing board width
const CT = 0.028;             // casing board thickness
const LOG_R = 0.12;           // log radius
const LOG_P = 0.25;           // log course height (10 courses per storey)
const LOG_OUT = 0.27;         // how far crossing log ends stick out past the corner vertex
const LOG_SEG = 10;
const CHINK_D = 0.13;         // chinking slab depth (shows between round logs)
const EPS = 1e-4;
const CHINK_COLOR = '#ebe0c8';
const THUMB_AT = { x: 4000, z: 4000 };   // thumbnails are built far from any neighbours

// ------------------------------------------------------------------ small geometry helpers

const area = (pts) => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length];
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
};

function tidy(pts) {
  const out = [];
  for (const p of pts) {
    const q = [Math.round(p[0] * 1e4) / 1e4, Math.round(p[1] * 1e4) / 1e4];
    const l = out[out.length - 1];
    if (!l || Math.abs(l[0] - q[0]) > 2e-4 || Math.abs(l[1] - q[1]) > 2e-4) out.push(q);
  }
  while (out.length > 2 && Math.abs(out[0][0] - out[out.length - 1][0]) < 2e-4 && Math.abs(out[0][1] - out[out.length - 1][1]) < 2e-4) out.pop();
  return out;
}

/** Axis-aligned box given its extents (any order). */
function box(g, m, x0, x1, y0, y1, z0, z1) {
  const w = Math.abs(x1 - x0), h = Math.abs(y1 - y0), d = Math.abs(z1 - z0);
  if (w < 0.004 || h < 0.004 || d < 0.004) return null;
  return add(g, boxGeo(w, h, d), m, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
}

/** Extruded polygon (XY, metres) of the given depth centred on z. */
function poly(g, m, pts, depth, z = 0, holes = []) {
  pts = tidy(pts);
  if (pts.length < 3 || Math.abs(area(pts)) < 2e-4) return null;
  return add(g, prismGeo(pts, depth, holes.map(tidy)), m, 0, 0, z);
}

/** Clip a polygon to the half plane fn(x, y) >= 0 (fn linear). */
function clip(pts, fn) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const fa = fn(a[0], a[1]), fb = fn(b[0], b[1]);
    if (fa >= 0) out.push(a);
    if ((fa >= 0) !== (fb >= 0)) {
      const t = fa / (fa - fb);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

const rect = (x0, x1, y0, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

/** Subtract intervals from [a, b]; returns sorted list of [a, b] pieces. */
function subtract(a, b, cuts) {
  let parts = [[a, b]];
  for (const [c0, c1] of cuts) {
    const next = [];
    for (const [p0, p1] of parts) {
      if (c1 <= p0 || c0 >= p1) { next.push([p0, p1]); continue; }
      if (c0 > p0) next.push([p0, c0]);
      if (c1 < p1) next.push([c1, p1]);
    }
    parts = next;
  }
  return parts.filter(([p0, p1]) => p1 - p0 > 0.01);
}

// ------------------------------------------------------------------ openings

/** Opening spec: { shape: 'rect'|'arch'|'round', x, y, w, h }. Top y of an opening. */
const topOf = (o) => o.y + (o.shape === 'round' ? o.w : o.h);

/** Grow an opening outline by e (bottom stays on the floor for door-like openings). */
function grow(o, e) {
  const floor = o.y <= EPS;
  const h = o.shape === 'round' ? o.w : o.h;
  return { shape: o.shape, x: o.x, y: floor ? 0 : o.y - e, w: o.w + 2 * e, h: h + e + (floor ? 0 : e) };
}

/** Outline path of a floor-touching opening: bottom-left, up, over the top, down to bottom-right. */
function notchPath(o) {
  const ol = openingOutline(o);
  return [ol[0], ...ol.slice(2).reverse(), ol[1]];
}

/**
 * Outer contour + holes for a slab from x0..x1, bottom y0, top line top(x), with openings cut out.
 * Openings touching the bottom become notches in the contour (robust triangulation for doors).
 */
function slabShape(xa, xb, top, ops, y0 = 0) {
  // xa / xb: a number or end bands [{ y0, y1, x }] (stepped ends where a junction changes with height)
  const L = typeof xa === 'number' ? [{ x: xa }] : xa;
  const R = typeof xb === 'number' ? [{ x: xb }] : xb;
  const pts = [[L[0].x, y0]];
  const holes = [];
  for (const o of [...ops].sort((a, b) => a.x - b.x)) {
    if (o.y <= y0 + 0.002) pts.push(...(o.pts || notchPath({ ...o, y: y0 })));
    else holes.push(o.pts || openingOutline(o));
  }
  pts.push([R[0].x, y0]);
  for (let k = 0; k < R.length; k++) {
    if (k > 0) pts.push([R[k].x, R[k].y0]);
    if (k < R.length - 1) pts.push([R[k].x, R[k].y1]);
  }
  const xr = R[R.length - 1].x, xl = L[L.length - 1].x;
  if (top(xr) > y0 + 0.002) pts.push([xr, top(xr)]);
  if (top(xl) > y0 + 0.002) pts.push([xl, top(xl)]);
  for (let k = L.length - 1; k >= 0; k--) {
    if (k < L.length - 1) pts.push([L[k].x, L[k].y1]);
    if (k > 0) pts.push([L[k].x, L[k].y0]);
  }
  return { pts, holes };
}

/** A frame ring between an outer and an inner opening outline (U-shaped for door openings). */
function ring(g, m, outer, inner, depth, z = 0) {
  if (inner.y <= EPS) {
    return poly(g, m, [...notchPath(outer), ...notchPath(inner).reverse()], depth, z);
  }
  return poly(g, m, openingOutline(outer), depth, z, [openingOutline(inner)]);
}

// ------------------------------------------------------------------ local frame & neighbours

/**
 * World vertices at the local -X end (ends[0]) and +X end (ends[1]) of an edge piece,
 * and the world direction of local +Z (nz).
 */
function frameOf(p) {
  let L, R, nz;
  if (p.a === 'z') { L = [p.x, p.z + 1]; R = [p.x, p.z]; nz = [1, 0]; }
  else { L = [p.x, p.z]; R = [p.x + 1, p.z]; nz = [0, 1]; }
  if (p.r === 2) { [L, R] = [R, L]; nz = [-nz[0], -nz[1]]; }
  return { ends: [L, R], nz };
}

/** Top height of a wall-like record at world vertex v. */
function heightAt(q, def, v) {
  if (def.autoGable) {
    const f = frameOf(q);
    const hi = f.ends[1][0] === v[0] && f.ends[1][1] === v[1];
    return ((q.h || 0) + (hi ? (q.s || 1) : 0)) * STEP;
  }
  return def.wallH || H;
}

function neighbour(ctx, key, test) {
  const q = ctx.get(key);
  if (!q) return null;
  const d = ctx.defOf(q);
  return d && test(d) ? { q, d } : null;
}
const isWallish = (d) => !!d.wallLike;

/** Edges touching vertex v at level y: [{key, a, dir}] where dir = world direction of the edge body from v. */
function edgesAt(vx, vz, y) {
  return [
    { key: K.W('x', vx - 1, y, vz), a: 'x', dir: [-1, 0] },
    { key: K.W('x', vx, y, vz), a: 'x', dir: [1, 0] },
    { key: K.W('z', vx, y, vz - 1), a: 'z', dir: [0, -1] },
    { key: K.W('z', vx, y, vz), a: 'z', dir: [0, 1] },
  ];
}

/**
 * Junction at end i (0 = local -X, 1 = local +X) of a wall-like piece.
 *   kind 'line'  collinear wall-like neighbour continues the wall
 *        'L'     one perpendicular neighbour (corner)  -> own / sz / logX
 *        'T'     stem of a T (two perpendicular neighbours, no continuation)
 *        'free'  nothing
 */
function junction(p, ctx, i, f, myH) {
  const [vx, vz] = f.ends[i];
  const sx = i ? 1 : -1;
  const me = K.W(p.a, p.x, p.y, p.z);
  let col = null;
  const perps = [];
  for (const e of edgesAt(vx, vz, p.y)) {
    if (e.key === me) continue;
    const n = neighbour(ctx, e.key, isWallish);
    if (!n) continue;
    n.h = heightAt(n.q, n.d, [vx, vz]);
    if (n.h < 0.05) continue;
    if (e.a === p.a) col = n;
    else { n.dir = e.dir; perps.push(n); }
  }
  const start = vx === p.x && vz === p.z;
  const lineBand = (c) => {
    const same = c.q.m === p.m, nLog = LOGS.has(c.q.m);
    return { kind: 'line', same, nLog, nH: c.h, ext: 0, key: `l${start ? 1 : 0}${same ? 1 : 0}${nLog ? Math.round(c.h * 100) : ''}` };
  };
  if (myH < 0.3) {
    // low tip of a gable: nothing to close, but keep shared-post logic with a continuing gable
    const b = col ? lineBand(col) : { kind: 'free', ext: 0, key: 'f' };
    return [{ ...b, y0: 0, y1: myH, sx, start }];
  }
  // split the end into height bands wherever a neighbour stops
  const cuts = [...new Set([col, ...perps].filter(Boolean).map((n) => Math.round(n.h * 1000) / 1000)
    .filter((h) => h > 0.05 && h < myH - 0.01))].sort((a, b) => a - b);
  const ys = [0, ...cuts, myH];
  const bands = [];
  for (let k = 0; k < ys.length - 1; k++) {
    const y0 = ys[k], y1 = ys[k + 1];
    const c = col && col.h >= y1 - 0.01 ? col : null;
    const ps = perps.filter((n) => n.h >= y1 - 0.01);
    const prev = bands[bands.length - 1];
    let b;
    if (c) b = lineBand(c);
    else if (ps.length === 1) {
      const n = ps[0];
      const sz = Math.sign(n.dir[0] * f.nz[0] + n.dir[1] * f.nz[1]) || 1;
      const own = myH > n.h + 0.01 || (Math.abs(myH - n.h) <= 0.01 && p.a === 'x');
      const logX = LOGS.has(p.m) && LOGS.has(n.q.m);
      // free run along the neighbour's face before its nearest opening (limits corner trims)
      const nOps = typeof n.d.ops === 'function' ? n.d.ops(n.q) : n.d.ops || [];
      let nFree = 0.6;
      for (const o of nOps) if (o) nFree = Math.min(nFree, 1 + HT - (Math.abs(o.x) + o.w / 2 + LIN + CW + 0.06));
      nFree = Math.max(0, Math.round(nFree * 100) / 100);
      b = { kind: 'L', sz, own, logX, nFree, ext: logX ? 0 : own ? HT : -HT, key: `L${own ? 1 : 0}${sz}${logX ? 'x' : ''}${nFree < 0.6 ? '~' + nFree : ''}` };
    } else if (ps.length >= 2) b = { kind: 'T', ext: 0, key: 'T' };
    else if (prev && prev.kind === 'L' && prev.own) b = { ...prev };   // keep the owned corner going up
    else b = { kind: 'free', ext: 0, key: 'f' };
    if (prev && prev.key === b.key) { prev.y1 = y1; continue; }
    bands.push({ ...b, y0, y1, sx, start });
  }
  return bands;
}

/** The band of end i containing height y. */
const bandAt = (bands, y) => bands.find((b) => y < b.y1 - 1e-6) || bands[bands.length - 1];
const bandsKey = (bands) => bands.map((b) => b.key + (bands.length > 1 ? '@' + Math.round(b.y1 * 100) : '')).join(',');

/** Which local face (+1 / -1) is outdoors: the side without a floor/foundation. */
function outsideSide(p, ctx, f) {
  const [nx, nz] = f.nz;
  // cells on either side of the edge
  const cellPos = p.a === 'x' ? [[p.x, p.z], [p.x, p.z - 1]] : [[p.x, p.z], [p.x - 1, p.z]];
  // cellPos[0] lies on the world +Z (axis x) / +X (axis z) side
  const posIsPlusZ = (p.a === 'x' ? nz : nx) > 0;
  const has = (c) => !!ctx.get(K.F(c[0], p.y, c[1]));
  const plusHas = has(posIsPlusZ ? cellPos[0] : cellPos[1]);
  const minusHas = has(posIsPlusZ ? cellPos[1] : cellPos[0]);
  if (plusHas && !minusHas) return -1;
  return 1;
}

/** Am I the canonical owner of the shared post at vertex v among edges matching test? */
function ownsVertex(p, ctx, v, test) {
  const me = K.W(p.a, p.x, p.y, p.z);
  for (const e of edgesAt(v[0], v[1], p.y)) {
    if (e.key === me) return true;
    if (neighbour(ctx, e.key, test)) return false;
  }
  return true;
}

// ------------------------------------------------------------------ logs

/**
 * Side of a horizontal log along X, centred at the origin. half: 0 full, 1 upper half, -1 lower half.
 * UV: u = metres along the log, v = height (see below).
 */
function logSideGeo(len, half) {
  return cached(`hwlog|${Math.round(len * 1000)}|${half}`, () => {
    const t0 = half === 1 ? Math.PI : 0;
    const tl = half ? Math.PI : Math.PI * 2;
    const seg = half ? LOG_SEG / 2 : LOG_SEG;
    const g = new THREE.CylinderGeometry(LOG_R, LOG_R, len, seg, 1, true, t0, tl);
    g.rotateZ(-Math.PI / 2);
    const uv = g.attributes.uv, pos = g.attributes.position;
    // planar UVs: u along the log, v = height relative to the log centre + half a course, so a
    // stacked-log wall texture (courses every LOG_P) lands its shading on the real round log
    for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) + len / 2, pos.getY(i) + LOG_P / 2);
    if (!half) return g;
    // close the flat side of a half log (sawn face)
    const f = new THREE.PlaneGeometry(len, LOG_R * 2);
    f.rotateX(half === 1 ? Math.PI / 2 : -Math.PI / 2);
    const merged = mergeGeometries([g.toNonIndexed(), f.toNonIndexed()]);
    return merged || g;
  });
}

/** End disc of a log facing +X (dir 1) or -X (dir -1). */
function logCapGeo(dir, half) {
  return cached(`hwlogcap|${dir}|${half}`, () => {
    const t0 = half === 1 ? 0 : half === -1 ? Math.PI : 0;
    const g = new THREE.CircleGeometry(LOG_R * 0.97, half ? LOG_SEG / 2 : LOG_SEG, t0, half ? Math.PI : Math.PI * 2);
    g.rotateY(dir * Math.PI / 2);
    return g;
  });
}

/** Log course centres for a wall of the given axis. half: 1 = upper half-log (sill), -1 = lower half (plate). */
function logRows(axis, top, flat) {
  const maxT = Math.max(top(-1), top(1));
  const rows = [];
  if (axis === 'x') {
    for (let y = LOG_P / 2; y - LOG_R * 0.6 < maxT - EPS; y += LOG_P) {
      if (flat && y + LOG_R > maxT + 0.05) break;
      rows.push({ y, half: 0 });
    }
  } else {
    rows.push({ y: 0, half: 1 });
    for (let y = LOG_P; y - LOG_R * 0.6 < maxT - EPS; y += LOG_P) {
      if (flat && Math.abs(y - maxT) < 0.01) { rows.push({ y, half: -1 }); break; }
      if (flat && y + LOG_R > maxT + 0.05) break;
      rows.push({ y, half: 0 });
    }
  }
  return rows;
}
const rowLo = (r) => (r.half === 1 ? r.y : r.y - LOG_R);
const rowHi = (r) => (r.half === -1 ? r.y : r.y + LOG_R);

// ------------------------------------------------------------------ material helpers

function casingMat(m) {
  if (LOGS.has(m) || m === 'planks') return mat('wood');
  if (m === 'clapboard' || m === 'shingleSiding' || m === 'boardBatten') return mat('trim');
  return null;
}
function capMat(m) {
  if (MASONRY.has(m)) return mat('stoneBlock');
  if (m === 'plaster') return mat('timber');
  if (m === 'clapboard' || m === 'shingleSiding' || m === 'boardBatten') return mat('trim');
  return mat('wood');
}
const accentOf = (p) => p.k || DEFAULT_ACCENT;
function noShadow(m) { if (m) m.castShadow = false; return m; }

// ------------------------------------------------------------------ the wall builder

/**
 * Build any wall-like piece.
 * spec: { top(x) -> height of the top line, flat: rectangular top?, ops: [openings], extra(e), cap: bool }
 */
function buildWallish(p, ctx, spec) {
  const g = new THREE.Group();
  const m = p.m || 'clapboard';
  const top = spec.top;
  const f = frameOf(p);
  const J = [0, 1].map((i) => junction(p, ctx, i, f, top(i ? 1 : -1)));
  const isLog = LOGS.has(m);
  const ops = spec.ops || [];
  const e = {
    p, g, m, top, J, f, ctx, spec, ops, isLog,
    flat: spec.flat !== false,
    depth: isLog ? LOG_R * 2 : T,
    rough: ops.map((o) => grow(o, LIN)),
    out: spec.needsOutside ? outsideSide(p, ctx, f) : 1,
  };
  // stepped slab ends: one entry per height band of each junction
  e.ends = J.map((bands) => bands.map((b) => ({ y0: b.y0, y1: b.y1, x: b.sx * (1 + b.ext) })));
  // free run from each outer corner to the nearest opening trim (limits quoins & corner boards)
  e.free = [0, 1].map((i) => {
    let free = 2;
    for (const o of ops) {
      const half = o.w / 2 + LIN + CW + 0.06;
      free = Math.min(free, i ? (1 + HT) - (o.x + half) : (o.x - half) - (-1 - HT));
    }
    return Math.max(0, free);
  });

  if (isLog) buildLogs(e);
  else buildSlab(e);
  if (m === 'plaster' || m === 'glass') buildTimber(e);
  else if (!isLog) buildRelief(e);
  for (let i = 0; i < 2; i++) {
    for (const b of J[i]) {
      if (b.kind === 'L' && b.own && !b.logX) cornerDeco(e, i, b);
      else if (b.kind === 'free' && BOARDED.has(m)) endBoard(e, b);
    }
  }
  for (let k = 0; k < ops.length; k++) buildOpening(e, ops[k], e.rough[k]);
  if (spec.cap) buildCap(e);
  if (spec.extra) spec.extra(e);
  return g;
}

/** x at which face-mounted relief on face side fz should stop at end i. */
function faceEnd(e, i, fz) {
  const j = e.J[i][0], sx = j.sx, xe = sx;
  if (j.kind === 'L' && !j.logX) {
    if (!j.own) return xe - sx * HT;
    return fz === j.sz ? xe - sx * (HT + 0.026) : xe + sx * HT;
  }
  if (j.kind === 'T') return xe - sx * (HT + 0.026);
  return xe;
}

function buildSlab(e) {
  const { pts, holes } = slabShape(e.ends[0], e.ends[1], e.top, e.rough);
  if (e.m === 'glass') noShadow(poly(e.g, mat('windowGlass'), pts, 0.024, 0, holes));
  else poly(e.g, mat(e.m, e.p.c), pts, T, 0, holes);
}

/** Cheap relief for board sidings: base trim (clapboard, shingle), battens (board & batten). */
function buildRelief(e) {
  const { g, m, top, rough } = e;
  if ((m === 'clapboard' || m === 'shingleSiding') && e.flat && !e.spec.gable) {
    const tm = mat('trim');
    const cuts = rough.filter((o) => o.y <= EPS).map((o) => [o.x - o.w / 2 - CW, o.x + o.w / 2 + CW]);
    for (const fz of [1, -1]) {
      const a = faceEnd(e, 0, fz), b = faceEnd(e, 1, fz);
      for (const [x0, x1] of subtract(a, b, cuts)) box(g, tm, x0, x1, 0, 0.16, fz * (HT - 0.005), fz * (HT + 0.025));
    }
  }
  if (m === 'boardBatten') {
    const bm = mat(m, e.p.c);
    for (let x = -0.8; x < 0.81; x += 0.4) {
      const ht = top(x) - 0.015;
      if (ht < 0.2) continue;
      const cuts = [];
      for (const o of rough) {
        if (x + 0.03 < o.x - o.w / 2 - CW - 0.01 || x - 0.03 > o.x + o.w / 2 + CW + 0.01) continue;
        cuts.push([o.y <= EPS ? -1 : o.y - 0.12, topOf(o) + 0.17]);
      }
      for (const [y0, y1] of subtract(0, ht, cuts)) box(g, bm, x - 0.03, x + 0.03, y0, y1, -(HT + 0.022), HT + 0.022);
    }
  }
}

/** Corner trim at an owned L-corner (end i). */
function cornerDeco(e, i, j) {
  const { g, m } = e;
  const sx = j.sx, sz = j.sz, xe = sx;
  const yA = j.y0, yB = Math.min(j.y1, e.top(xe));
  if (yB - yA < 0.05) return;
  // L-shaped pair of boards/blocks wrapping the outer corner: one on my outer face (long `wa`),
  // one on the neighbour's outer face plane (`wb` measured from my outer face).
  const pair = (mm, y0, y1, tb, wa, wb) => {
    box(g, mm, xe + sx * (HT + tb), xe + sx * (HT + tb - wa), y0, y1, -sz * HT, -sz * (HT + tb));
    box(g, mm, xe + sx * HT, xe + sx * (HT + tb), y0, y1, -sz * HT, -sz * HT + sz * wb);
  };
  if (BOARDED.has(m)) {
    pair(m === 'planks' ? mat('timber') : mat('trim'), yA, yB, 0.03, Math.min(0.15, e.free[i] + 0.02), Math.max(T + 0.02, Math.min(T + 0.06, j.nFree - 0.01)));
  } else if (MASONRY.has(m)) {
    const base = m === 'brick' ? 0.25 : 0.3125;
    const n = Math.max(1, Math.round((yB - yA) / base));
    const qh = (yB - yA) / n, c0 = Math.round(yA / base);
    const sm = mat('stoneBlock');
    for (let c = 0; c < n; c++) {
      const long = (c + c0) % 2 === 0;
      const wa = Math.min(long ? 0.46 : 0.28, e.free[i] + 0.03);
      pair(sm, yA + c * qh + 0.012, yA + (c + 1) * qh - 0.012, 0.03, wa, Math.max(T + 0.02, Math.min(T + (long ? 0.2 : 0.38), j.nFree - 0.01)));
    }
  } else if (m === 'plaster' || m === 'glass') {
    const s = m === 'plaster' ? 0.02 : 0.015;
    box(g, mat('timber'), xe - HT - s, xe + HT + s, yA, yB, -HT - s, HT + s);
  }
}

/** Trim board wrapping a free (unjoined) end of a board-sided wall. */
function endBoard(e, j) {
  const sx = j.sx, xe = sx;
  const y1 = Math.min(j.y1, e.top(xe));
  if (y1 - j.y0 < 0.3) return;
  box(e.g, e.m === 'planks' ? mat('timber') : mat('trim'), xe - sx * 0.1, xe + sx * 0.025, j.y0, y1, -(HT + 0.03), HT + 0.03);
}

/** Cap rail along the top of a half wall. */
function buildCap(e) {
  const { g, J } = e;
  const hw = 0.15, y = e.top(0);
  const end = (i) => {
    const j = J[i][J[i].length - 1], sx = j.sx;
    if (j.kind === 'L') return j.own ? sx + sx * hw : sx - sx * hw;
    if (j.kind === 'T') return sx - sx * hw;
    if (j.kind === 'free') return sx + sx * 0.03;
    return sx;
  };
  box(g, capMat(e.m), end(0), end(1), y, y + 0.06, -hw, hw);
}

/** Stacked logs with chinking; openings cut out with plank bucks; crossing ends at log corners. */
function buildLogs(e) {
  const { g, p, J, top, rough } = e;
  const lm = mat(e.m), em = mat('wood');
  const rows = logRows(p.a, top, e.flat);
  const t0 = top(-1), k = (top(1) - top(-1)) / 2;
  const endFor = (i, row) => {
    const j = bandAt(J[i], rowLo(row) + 0.02);
    return { j, x: j.kind === 'L' && j.logX ? j.sx * (1 + LOG_OUT) : j.sx * (1 + j.ext) };
  };
  // Each opening cuts the courses it touches, following its shape (round / arched tops are
  // stepped course by course like a real cabin). steps[n] = [{ row, x0, x1, b, t }] bottom to top.
  const steps = rough.map((r) => {
    const hw = r.w / 2, ry0 = r.y, ry1 = topOf(r);
    const cy = r.shape === 'round' ? r.y + hw : ry1 - hw;
    const list = [];
    for (const row of rows) {
      const a = Math.max(rowLo(row), ry0), b = Math.min(rowHi(row), ry1);
      if (b <= a + 0.002) continue;
      let w = hw;
      if (r.shape !== 'rect' && !(r.shape === 'arch' && a <= cy)) {
        const dy = a > cy ? a - cy : b < cy ? cy - b : 0;
        w = Math.sqrt(Math.max(0, hw * hw - dy * dy));
      }
      list.push({ row, x0: r.x - w - 0.06, x1: r.x + w + 0.06 });
    }
    list.forEach((s, n) => {
      const next = list[n + 1];
      s.b = n === 0 ? (ry0 <= EPS ? 0 : Math.max(0, Math.min(rowLo(s.row) - 0.005, ry0 - 0.012))) : list[n - 1].t;
      s.t = next ? (rowHi(s.row) + rowLo(next.row)) / 2 : Math.max(rowHi(s.row) + 0.005, ry1 + 0.012);
      s.t = Math.min(s.t, top(s.x0) - 0.02, top(s.x1) - 0.02);
    });
    return list.filter((s) => s.t > s.b + 0.005);
  });

  for (const row of rows) {
    const E = [endFor(0, row), endFor(1, row)];
    let a = E[0].x;
    const b = E[1].x;
    const hi = rowHi(row);
    if (!e.flat && k > EPS) {
      const need = row.half === 1 ? 0.05 : row.y + LOG_R * 0.35;
      a = Math.max(a, (need - t0) / k - 1);
    }
    if (b - a < 0.06) continue;
    const cutX = [];
    for (const list of steps) for (const s of list) if (s.row === row) cutX.push([s.x0, s.x1]);
    for (const [s0, s1] of subtract(a, b, cutX)) {
      add(g, logSideGeo(s1 - s0, row.half), lm, (s0 + s1) / 2, row.y, 0);
      for (const [x, dir] of [[s0, -1], [s1, 1]]) {
        const i = dir > 0 ? 1 : 0, j = E[i].j;
        const atEnd = Math.abs(x - E[i].x) < 1e-3;
        if (atEnd && (j.kind === 'T' || (j.kind === 'line' && j.nLog && j.nH >= hi - 0.01))) continue;
        add(g, logCapGeo(dir, row.half), em, x, row.y, 0);
      }
    }
  }
  // stepped outline of each cut (left side up, right side down): a notch path or a hole
  const outlines = steps.map((list) => {
    if (!list.length) return null;
    const left = [], right = [];
    for (const s of list) { left.push([s.x0, s.b], [s.x0, s.t]); right.push([s.x1, s.b], [s.x1, s.t]); }
    return [...left, ...right.reverse()];
  });
  // chinking behind the logs (it also gives gables their exact top line)
  const chOps = [];
  outlines.forEach((pts, n) => { if (pts) chOps.push({ x: rough[n].x, y: steps[n][0].b, pts }); });
  const { pts, holes } = slabShape(e.ends[0], e.ends[1], top, chOps);
  poly(g, mat('plaster', CHINK_COLOR), pts, CHINK_D, 0, holes);
  // plank blocking between the cut log ends and the opening frame
  outlines.forEach((out, n) => {
    if (!out) return;
    const r = rough[n], pm = mat('planks'), dep = LOG_R * 2 - 0.04;
    if (r.y <= EPS) poly(g, pm, [...out, ...notchPath(r).reverse()], dep);
    else poly(g, pm, out, dep, 0, [openingOutline(r)]);
  });
}

/** Half-timbering (plaster) or a glazing grid (glass): plates, posts, jamb studs, braces / transoms. */
function buildTimber(e) {
  const { g, J, top, rough, flat } = e;
  const plaster = e.m === 'plaster';
  const tm = mat('timber');
  const pw = plaster ? 0.13 : 0.09;     // post width
  const pt = plaster ? 0.14 : 0.1;      // plate height
  const dep = T + (plaster ? 0.04 : 0.03);
  const topIn = (x) => top(x) - pt;
  const cap = topIn(1);
  const member = (pts, depth = dep) => {
    let q = clip(pts, (x, y) => topIn(x) - y);
    q = clip(q, (x, y) => cap - y);
    q = clip(q, (x, y) => y - pt);
    return poly(g, tm, q, depth);
  };

  // ends (per height band of each junction)
  const lim = [], verts = [];
  const plateOf = (j) => {
    const sx = j.sx, xe = sx;
    if (j.kind === 'L') return xe - sx * (HT + (j.own ? (plaster ? 0.02 : 0.015) : 0.022));
    if (j.kind === 'T') return xe - sx * (HT + 0.022);
    return xe;
  };
  for (let i = 0; i < 2; i++) {
    const bands = J[i];
    let inner = bands[0].sx * 99;
    for (const j of bands) {
      const sx = j.sx, xe = sx;
      let inn = plateOf(j);
      if (j.kind === 'line' && j.same) {
        if (j.start) verts.push([xe - pw / 2, xe + pw / 2, j.y0, j.y1]);
        inn = xe - sx * pw / 2;
      } else if (j.kind === 'line' || j.kind === 'free') {
        verts.push(sx < 0 ? [xe, xe + pw, j.y0, j.y1] : [xe - pw, xe, j.y0, j.y1]);
        inn = xe - sx * pw;
      }
      inner = sx < 0 ? Math.max(inner, inn) : Math.min(inner, inn);
    }
    lim.push({ bottom: plateOf(bands[0]), top: plateOf(bands[bands.length - 1]), inner });
  }

  // plates
  const doorCuts = rough.filter((o) => o.y <= EPS).map((o) => [o.x - o.w / 2, o.x + o.w / 2]);
  for (const [a, b] of subtract(lim[0].bottom, lim[1].bottom, doorCuts)) poly(g, tm, clip(rect(a, b, 0, pt), (x, y) => top(x) - y), dep);
  const L0 = lim[0].top, L1 = lim[1].top;
  poly(g, tm, clip([[L0, top(L0) - pt], [L1, top(L1) - pt], [L1, top(L1)], [L0, top(L0)]], (x, y) => y - pt), dep);

  // studs beside openings, centre post / mullions
  const zones = rough.map((o) => [o.x - o.w / 2 - pw, o.x + o.w / 2 + pw]);
  const studs = [];
  for (const o of rough) studs.push([o.x - o.w / 2 - pw, o.x - o.w / 2], [o.x + o.w / 2, o.x + o.w / 2 + pw]);
  const mids = flat ? [0] : plaster ? [0] : [-0.5, 0.5];
  for (const x of mids) {
    const iv = [x - pw / 2, x + pw / 2];
    if (topIn(x) < pt + 0.35) continue;
    if (zones.some(([a, b]) => iv[1] > a - 0.12 && iv[0] < b + 0.12)) continue;
    studs.push(iv);
  }
  for (const [a, b] of studs) {
    const a2 = Math.max(a, lim[0].inner), b2 = Math.min(b, lim[1].inner);
    if (b2 - a2 > 0.02) member(rect(a2, b2, 0, 99));
  }
  for (const [a, b, y0, y1] of verts) member(rect(a, b, y0, y1 >= Math.min(top(a), top(b)) - 0.01 ? 99 : y1));

  // rails under / over openings (the sill rail doubles as a window sill)
  for (const o of rough) {
    const x0 = o.x - o.w / 2, x1 = o.x + o.w / 2, ry1 = topOf(o);
    if (o.y > EPS) member(rect(x0, x1, o.y - pt * 0.85, o.y), dep + (plaster ? 0.04 : 0.02));
    if (ry1 + pt * 0.85 < Math.min(topIn(x0), topIn(x1)) - 0.01) member(rect(x0, x1, ry1, ry1 + pt * 0.85));
  }

  // panels: braces (plaster) or transoms (glass)
  const panels = subtract(lim[0].inner, lim[1].inner, [...verts.map((v) => [v[0], v[1]]), ...studs, ...zones]);
  for (const [a, b] of panels) {
    const w = b - a;
    if (plaster) {
      if (w < 0.36 || Math.min(topIn(a), topIn(b)) - pt < 0.5) continue;
      const bw = 0.16;
      const c = (a + b) / 2;
      const pts = c < 0
        ? [[a, pt], [a + bw, pt], [b, topIn(b)], [b - bw, topIn(b - bw)]]
        : [[b - bw, pt], [b, pt], [a + bw, topIn(a + bw)], [a, topIn(a)]];
      member(pts);
    } else {
      const ty = flat ? (top(0) >= 2 ? 2.0 : -1) : 1.25;
      if (ty < 0 || Math.max(topIn(a), topIn(b)) < ty + 0.25) continue;
      member(rect(a, b, ty, ty + 0.075));
    }
  }
}

/** Frame, casing, sill/lintel and contents of one opening. */
function buildOpening(e, o, r) {
  const { g, m, p } = e;
  const d = e.depth;
  const km = mat('trim', accentOf(p));
  const masonry = MASONRY.has(m);
  const rx0 = r.x - r.w / 2, rx1 = r.x + r.w / 2, ry1 = topOf(r);
  // lining (covers the reveal) — a stone ring for arched/round openings in masonry
  if (masonry && o.shape !== 'rect') ring(g, mat('stoneBlock'), grow(o, LIN + 0.1), o, d + 0.03);
  else ring(g, km, r, o, d + 0.02);
  // casing on both faces
  const cm = casingMat(m);
  if (cm) {
    for (const s of [1, -1]) {
      const z0 = s * (d / 2 - 0.006), z1 = s * (d / 2 + CT);
      if (o.shape === 'rect') {
        const yb = o.y <= EPS ? 0 : r.y;
        box(g, cm, rx0 - CW, rx0, yb, ry1, z0, z1);
        box(g, cm, rx1, rx1 + CW, yb, ry1, z0, z1);
        box(g, cm, rx0 - CW - 0.03, rx1 + CW + 0.03, ry1, ry1 + 0.12, z0, s * (d / 2 + CT + 0.01));
        box(g, cm, rx0 - CW - 0.05, rx1 + CW + 0.05, ry1 + 0.12, ry1 + 0.155, z0, s * (d / 2 + CT + 0.035));
      } else {
        ring(g, cm, grow(o, LIN + CW * 0.8), r, CT + 0.006, s * (d / 2 + CT / 2 - 0.003));
      }
    }
  }
  // sills & lintels
  if (o.y > EPS && o.shape !== 'round') {
    if (masonry) box(g, mat('stoneBlock'), rx0 - 0.08, rx1 + 0.08, r.y - 0.08, r.y, -(d / 2 + 0.05), d / 2 + 0.05);
    else if (cm) {
      box(g, cm, rx0 - CW - 0.05, rx1 + CW + 0.05, r.y - 0.05, r.y, -(d / 2 + 0.06), d / 2 + 0.06);
      for (const s of [1, -1]) box(g, cm, rx0 - 0.02, rx1 + 0.02, r.y - 0.15, r.y - 0.05, s * (d / 2 - 0.006), s * (d / 2 + CT - 0.008));
    }
  }
  if (masonry) {
    if (o.shape === 'rect') box(g, mat('stoneBlock'), rx0 - 0.12, rx1 + 0.12, ry1, ry1 + 0.2, -(d / 2 + 0.015), d / 2 + 0.015);
    else box(g, mat('stoneBlock'), o.x - 0.08, o.x + 0.08, ry1 - 0.06, ry1 + 0.16, -(d / 2 + 0.03), d / 2 + 0.03);
  }
  if (o.fill) o.fill(e, o, r);
}

// ------------------------------------------------------------------ opening contents

/** Sash ring + glass + muntin bars ([x0, x1, y0, y1] in opening-local coords). */
function glazing(e, o, bars = []) {
  const km = mat('trim', accentOf(e.p));
  ring(e.g, km, o, grow(o, -0.04), 0.075);
  noShadow(poly(e.g, mat('windowGlass'), openingOutline(o), 0.02));
  for (const [x0, x1, y0, y1] of bars) box(e.g, km, o.x + x0, o.x + x1, y0, y1, -0.03, 0.03);
}

const crossBars = (o, t = 0.045) => {
  const top = topOf(o), mid = (o.y + top) / 2, hw = o.w / 2;
  return [[-t / 2, t / 2, o.y, top], [-hw, hw, mid - t / 2, mid + t / 2]];
};

function doorKnob(g, x, y, zs = [1, -1], zOff = 0.03) {
  const im = mat('iron');
  for (const s of zs) {
    add(g, sphereGeo(0.035, 8, 6), im, x, y, s * (zOff + 0.045));
    add(g, cylGeo(0.012, 0.012, 0.05, 6), im, x, y, s * (zOff + 0.02), Math.PI / 2, 0, 0);
  }
}

function fillDoor(e, o) {
  const { g, p } = e;
  const dm = mat('paintedWood', accentOf(p)), km = mat('trim', accentOf(p));
  const hw = o.w / 2, ht = o.h, st = 0.13, z = 0.028;
  const split = 1.2;
  box(g, dm, -hw, hw, 0, split, -z, z);
  box(g, dm, -hw, -hw + st, split, ht, -z, z);
  box(g, dm, hw - st, hw, split, ht, -z, z);
  box(g, dm, -hw + st, hw - st, ht - 0.13, ht, -z, z);
  box(g, dm, -hw + st, hw - st, split, split + 0.06, -z, z);
  // raised panels
  for (const s of [-1, 1]) box(g, dm, s * 0.05, s * (hw - 0.12), 0.16, split - 0.12, -z - 0.012, z + 0.012);
  // little window with a cross
  noShadow(box(g, mat('windowGlass'), -hw + st, hw - st, split + 0.06, ht - 0.13, -0.01, 0.01));
  const wx = hw - st, my = (split + 0.06 + ht - 0.13) / 2;
  box(g, km, -0.02, 0.02, split + 0.06, ht - 0.13, -0.022, 0.022);
  box(g, km, -wx, wx, my - 0.02, my + 0.02, -0.022, 0.022);
  doorKnob(g, hw - 0.1, 1.0);
  box(g, mat('wood'), -hw - 0.03, hw + 0.03, 0, 0.025, -(e.depth / 2 + 0.03), e.depth / 2 + 0.03);
}

function fillFrench(e, o) {
  const { g, p } = e;
  const dm = mat('paintedWood', accentOf(p)), km = mat('trim', accentOf(p)), gm = mat('windowGlass');
  const hw = o.w / 2, ht = o.h, st = 0.085, z = 0.026;
  for (const s of [-1, 1]) {
    const xa = s < 0 ? -hw : 0.004, xb = s < 0 ? -0.004 : hw;
    box(g, dm, xa, xa + st, 0, ht, -z, z);
    box(g, dm, xb - st, xb, 0, ht, -z, z);
    box(g, dm, xa + st, xb - st, 0, 0.26, -z, z);
    box(g, dm, xa + st, xb - st, ht - 0.1, ht, -z, z);
    noShadow(box(g, gm, xa + st, xb - st, 0.26, ht - 0.1, -0.01, 0.01));
    const cx = (xa + xb) / 2, gy0 = 0.26, gy1 = ht - 0.1;
    box(g, km, cx - 0.018, cx + 0.018, gy0, gy1, -0.02, 0.02);
    for (const t of [1 / 3, 2 / 3]) {
      const y = gy0 + (gy1 - gy0) * t;
      box(g, km, xa + st, xb - st, y - 0.018, y + 0.018, -0.02, 0.02);
    }
    // lever handle
    box(g, mat('iron'), s * 0.05 - 0.012, s * 0.05 + 0.012, 0.92, 1.12, -(z + 0.03), z + 0.03);
  }
  box(g, mat('wood'), -hw - 0.03, hw + 0.03, 0, 0.025, -(e.depth / 2 + 0.03), e.depth / 2 + 0.03);
}

function fillBarn(e, o) {
  const { g, p } = e;
  const dm = mat('paintedWood', accentOf(p)), tm = mat('trim');
  const hw = o.w / 2, ht = o.h, z = 0.032, b = 0.1, tz = 0.022;
  for (const s of [-1, 1]) {
    const xa = s < 0 ? -hw : 0.006, xb = s < 0 ? -0.006 : hw;
    box(g, dm, xa, xb, 0.01, ht, -z, z);
    for (const f of [1, -1]) {
      const z0 = f * z, z1 = f * (z + tz);
      box(g, tm, xa, xa + b, 0.01, ht, z0, z1);
      box(g, tm, xb - b, xb, 0.01, ht, z0, z1);
      box(g, tm, xa + b, xb - b, ht - b, ht, z0, z1);
      box(g, tm, xa + b, xb - b, 0.01, 0.01 + b, z0, z1);
      box(g, tm, xa + b, xb - b, ht / 2 - b / 2, ht / 2 + b / 2, z0, z1);
      // Z braces in the two half panels, mirrored on the two leaves
      for (const [y0, y1] of [[0.01 + b, ht / 2 - b / 2], [ht / 2 + b / 2, ht - b]]) {
        const ia = xa + b, ib = xb - b, bw = 0.12;
        const pts = s < 0
          ? [[ia, y0], [ia + bw, y0], [ib, y1], [ib - bw, y1]]
          : [[ib - bw, y0], [ib, y0], [ia + bw, y1], [ia, y1]];
        poly(g, tm, pts, tz, f * (z + tz / 2));
      }
    }
    box(g, mat('iron'), s * 0.09 - 0.015, s * 0.09 + 0.015, 0.95, 1.2, -(z + tz + 0.03), z + tz + 0.03);
  }
}

function shuttersAndFlowers(e, o, r) {
  const { g, p } = e;
  const side = e.out, d = e.depth;
  const dm = mat('paintedWood', accentOf(p));
  const cas = casingMat(e.m) ? CW + 0.012 : 0.03;
  const y0 = r.y, y1 = topOf(r);
  const zf = side * (d / 2 + 0.006), zb = side * (d / 2 + 0.042);
  for (const s of [-1, 1]) {
    const xa = s * (r.w / 2 + cas), xb = s * (r.w / 2 + cas + 0.36);
    box(g, dm, xa, xb, y0, y1, zf, zb);
    const zr = side * (d / 2 + 0.058);
    for (const yy of [y0 + 0.09, (y0 + y1) / 2, y1 - 0.09]) box(g, dm, xa + s * 0.04, xb - s * 0.04, yy - 0.04, yy + 0.04, zb, zr);
  }
  // flower box under the sill
  const bw = r.w / 2 + 0.09, bt = r.y - 0.1, bb = bt - 0.22;
  const z0 = side * (d / 2 - 0.004), z1 = side * (d / 2 + 0.21);
  box(g, dm, -bw, bw, bb, bt, z0, z1);
  box(g, mat('dirt'), -bw + 0.03, bw - 0.03, bt, bt + 0.015, side * (d / 2 + 0.02), side * (d / 2 + 0.19));
  const petals = ['petalPink', 'petalYellow'];
  const n = 6, zc = side * (d / 2 + 0.105);
  for (let i = 0; i < n; i++) {
    const x = -bw + 0.09 + (i / (n - 1)) * (2 * bw - 0.18);
    add(g, sphereGeo(0.085, 6, 4), mat('leaves'), x, bt + 0.05, zc + side * ((i % 2) * 0.03 - 0.015));
    add(g, sphereGeo(0.05, 6, 4), mat(petals[i % 2]), x + ((i % 3) - 1) * 0.02, bt + 0.13 + (i % 2) * 0.03, zc + side * 0.03);
  }
}

/** Largest round window that fits in a gable piece (with frame & beam clearance). */
function gableRound(p) {
  const t0 = (p.h || 0) * STEP, k = (p.s || 1) * STEP / 2, nrm = Math.hypot(1, k);
  const m1 = LIN + CW * 0.8 + 0.03;
  const clear = m1 + (p.m === 'plaster' ? 0.2 : 0.1);
  for (let r = 0.42; r >= 0.13; r -= 0.02) {
    for (let cx = 0.75; cx >= -0.75; cx -= 0.05) {
      if (cx + r + m1 > 0.86 || cx - r - m1 < -0.9) continue;
      let cy = 0.3 + r + m1;
      if (t0 >= 1.2) cy = Math.max(cy, Math.min(1.45, t0 - r - clear));
      if ((t0 + k * (cx + 1) - cy) / nrm < r + clear) continue;
      return { shape: 'round', x: Math.round(cx * 100) / 100, y: Math.round((cy - r) * 100) / 100, w: Math.round(2 * r * 100) / 100, fill: (e, o) => glazing(e, o, crossBars(o, 0.04)) };
    }
  }
  return null;
}

// ------------------------------------------------------------------ registration

function registerWall(def) {
  const topFn = def.gable
    ? (p) => { const t0 = (p.h || 0) * STEP, k = (p.s || 1) * STEP / 2; return (x) => t0 + k * (x + 1); }
    : () => { const h = def.wallH || H; return () => h; };
  const opsFn = typeof def.ops === 'function' ? def.ops : () => def.ops || [];
  registerPiece({
    slot: 'edge', layer: 'W', mats: WALL_MATS, matGroup: 'wall', paint: true, contextual: true,
    sound: 'wood', ...def,
    wallLike: true,
    thumb: { ...THUMB_AT, ...(def.thumb || {}) },
    contextKey(p, ctx) {
      const f = frameOf(p), top = topFn(p);
      let key = p.a + bandsKey(junction(p, ctx, 0, f, top(-1))) + '|' + bandsKey(junction(p, ctx, 1, f, top(1)));
      if (def.needsOutside) key += '|' + outsideSide(p, ctx, f);
      return key;
    },
    build(p, ctx) {
      return buildWallish(p, ctx, {
        top: topFn(p), flat: !def.gable, gable: !!def.gable, ops: opsFn(p).filter(Boolean),
        cap: def.cap, extra: def.extra, needsOutside: def.needsOutside,
      });
    },
  });
}

const W = (shape, x, y, w, h, fill) => ({ shape, x, y, w, h, fill });

// walls
registerWall({ id: 'wall', name: 'Wall', cat: 'walls', icon: '🧱', desc: 'A full-height wall. Corners close up neatly by themselves.' });
registerWall({
  id: 'wall_half', name: 'Half Wall', cat: 'walls', icon: '▭', wallH: 1.0, cap: true,
  desc: 'A waist-high wall with a cap rail — porches, kitchens and lofts.',
});
registerWall({
  id: 'wall_arch', name: 'Archway', cat: 'walls', icon: '⛩️', accent: true,
  ops: [W('arch', 0, 0, 1.1, 2.2)], desc: 'An open arched doorway between rooms.',
});
registerWall({
  id: 'gable', name: 'Gable Wall', cat: 'walls', icon: '🔺', gable: true, autoGable: true,
  thumb: { s: 2 }, showcase: { s: 2 }, desc: 'Fills the triangle under a sloped roof. Fits itself to the roof above.',
});
registerWall({
  id: 'gable_window', name: 'Gable Window', cat: 'walls', icon: '🔼', gable: true, autoGable: true, accent: true,
  thumb: { s: 2 }, showcase: { s: 2 }, sound: 'glass',
  ops: (p) => (p.m === 'glass' ? [] : [gableRound(p)]),
  desc: 'A gable with a round window — in glass it becomes a glowing A-frame front.',
});

// windows & doors
const winFill = (bars) => (e, o) => glazing(e, o, bars(o));
registerWall({
  id: 'wall_window', name: 'Window', cat: 'openings', icon: '🪟', accent: true, sound: 'glass',
  ops: [W('rect', 0, 0.85, 0.9, 1.05, winFill((o) => crossBars(o)))], desc: 'A classic four-pane cottage window.',
});
registerWall({
  id: 'wall_window_tall', name: 'Tall Window', cat: 'openings', icon: '🚪', accent: true, sound: 'glass',
  ops: [W('rect', 0, 0.5, 0.75, 1.65, winFill((o) => {
    const mid = o.y + o.h / 2;
    return [[-0.02, 0.02, o.y, o.y + o.h], [-o.w / 2, o.w / 2, mid - 0.032, mid + 0.032]];
  }))],
  desc: 'A tall two-over-two sash window.',
});
registerWall({
  id: 'wall_window_wide', name: 'Picture Window', cat: 'openings', icon: '🖼️', accent: true, sound: 'glass',
  ops: [W('rect', 0, 0.8, 1.4, 1.15, winFill((o) => [[-o.w / 6 - 0.028, -o.w / 6 + 0.028, o.y, o.y + o.h], [o.w / 6 - 0.028, o.w / 6 + 0.028, o.y, o.y + o.h]]))],
  desc: 'A wide three-pane window for a view of the meadow.',
});
registerWall({
  id: 'wall_window_round', name: 'Round Window', cat: 'openings', icon: '⭕', accent: true, sound: 'glass',
  ops: [W('round', 0, 1.0, 0.8, 0.8, winFill((o) => crossBars(o, 0.04)))], desc: 'A round porthole window.',
});
registerWall({
  id: 'wall_window_arch', name: 'Arched Window', cat: 'openings', icon: '🌙', accent: true, sound: 'glass',
  ops: [W('arch', 0, 0.75, 0.8, 1.35, winFill((o) => {
    const sy = o.y + o.h - o.w / 2;
    return [[-0.02, 0.02, o.y, o.y + o.h], [-o.w / 2, o.w / 2, sy - 0.02, sy + 0.02]];
  }))],
  desc: 'A window with a softly arched top.',
});
registerWall({
  id: 'wall_window_shutters', name: 'Shuttered Window', cat: 'openings', icon: '🌷', accent: true, sound: 'glass', needsOutside: true,
  ops: [W('rect', 0, 0.85, 0.8, 1.05, (e, o, r) => { glazing(e, o, crossBars(o)); shuttersAndFlowers(e, o, r); })],
  desc: 'A window with painted shutters and a flower box (faces outdoors).',
});
registerWall({
  id: 'wall_door', name: 'Door', cat: 'openings', icon: '🚪', accent: true,
  ops: [W('rect', 0, 0, 0.95, 2.05, fillDoor)], desc: 'A painted wooden door with a little window.',
});
registerWall({
  id: 'wall_door_glass', name: 'French Doors', cat: 'openings', icon: '🚪', accent: true, sound: 'glass',
  ops: [W('rect', 0, 0, 1.4, 2.1, fillFrench)], desc: 'Double glazed doors onto the porch or garden.',
});
registerWall({
  id: 'wall_door_barn', name: 'Barn Door', cat: 'openings', icon: '🐄', accent: true,
  ops: [W('rect', 0, 0, 1.44, 2.1, fillBarn)], desc: 'Wide double barn doors with Z-braces.',
});

// ------------------------------------------------------------------ railings, fences, hedges

const sameKind = (kind) => (d) => d.edgeKind === kind;
const postOwners = (p, ctx, kind) => frameOf(p).ends.map((v) => ownsVertex(p, ctx, v, sameKind(kind)));
const groundBase = (p) => (p.y === 0 ? -BASE_Y : 0);
const variant = (p) => ((p.x * 7 + p.z * 13) % 4 + 4) % 4;

registerPiece({
  id: 'railing', name: 'Railing', cat: 'frame', slot: 'edge', layer: 'W', edgeKind: 'railing',
  mats: ['wood', 'trim', 'timber', 'iron'], matGroup: 'railing', paint: true, contextual: true,
  icon: '🚧', sound: 'wood', thumb: { ...THUMB_AT }, desc: 'Porch & balcony railing with turned-look balusters.',
  contextKey: (p, ctx) => postOwners(p, ctx, 'railing').map(Number).join(''),
  build(p, ctx) {
    const g = new THREE.Group();
    const iron = p.m === 'iron';
    const m = mat(p.m, p.c);
    const own = postOwners(p, ctx, 'railing');
    const pw = iron ? 0.055 : 0.1, hr = 0.95;
    for (let i = 0; i < 2; i++) {
      if (!own[i]) continue;
      const x = i ? 1 : -1;
      box(g, m, x - pw / 2, x + pw / 2, 0, hr + 0.05, -pw / 2, pw / 2);
      if (iron) add(g, sphereGeo(0.045, 8, 6), m, x, hr + 0.09, 0);
      else box(g, m, x - pw / 2 - 0.022, x + pw / 2 + 0.022, hr + 0.05, hr + 0.09, -pw / 2 - 0.022, pw / 2 + 0.022);
    }
    const ra = -1 + pw / 2, rb = 1 - pw / 2;
    if (iron) {
      box(g, m, ra, rb, hr - 0.04, hr, -0.022, 0.022);
      box(g, m, ra, rb, 0.08, 0.11, -0.014, 0.014);
      box(g, m, ra, rb, hr - 0.16, hr - 0.14, -0.012, 0.012);
      const n = 17;
      for (let k = 0; k < n; k++) {
        const x = ra + (rb - ra) * (k + 0.5) / n;
        box(g, m, x - 0.009, x + 0.009, 0.11, hr - 0.04, -0.009, 0.009);
      }
    } else {
      box(g, m, ra, rb, hr - 0.065, hr, -0.055, 0.055);
      box(g, m, ra, rb, 0.07, 0.13, -0.035, 0.035);
      const n = 13;
      for (let k = 0; k < n; k++) {
        const x = ra + (rb - ra) * (k + 0.5) / n;
        box(g, m, x - 0.022, x + 0.022, 0.13, hr - 0.065, -0.022, 0.022);
      }
    }
    return g;
  },
});

function picketGeo() {
  return prismGeo([[-0.038, 0], [0.038, 0], [0.038, 0.9], [0, 0.97], [-0.038, 0.9]], 0.022);
}

registerPiece({
  id: 'fence_picket', name: 'Picket Fence', cat: 'garden', slot: 'edge', layer: 'W', edgeKind: 'picket',
  mats: ['trim', 'wood'], matGroup: 'fence', paint: true, contextual: true,
  icon: '🏡', sound: 'wood', thumb: { ...THUMB_AT }, desc: 'A white picket fence — paint it any colour.',
  contextKey: (p, ctx) => postOwners(p, ctx, 'picket').map(Number).join(''),
  build(p, ctx) {
    const g = new THREE.Group();
    const b = groundBase(p);
    const m = mat(p.m, p.c);
    const own = postOwners(p, ctx, 'picket');
    for (let i = 0; i < 2; i++) {
      if (!own[i]) continue;
      const x = i ? 1 : -1;
      box(g, m, x - 0.05, x + 0.05, b, b + 1.12, -0.05, 0.05);
      add(g, coneGeo(0.075, 0.1, 4), m, x, b + 1.17, 0, 0, Math.PI / 4, 0);
    }
    for (const y of [0.28, 0.78]) box(g, m, -0.95, 0.95, b + y, b + y + 0.07, -0.032, 0.004);
    const geo = picketGeo();
    for (let k = 0; k < 12; k++) add(g, geo, m, -0.825 + k * 0.15, b + 0.05, 0.016);
    return g;
  },
});

function railGeo() {
  return cached('hwsplitrail', () => {
    const g = prismGeo([[-0.06, -0.04], [0.06, -0.045], [0.035, 0.035], [-0.02, 0.055]], 2.12).clone();
    g.rotateY(Math.PI / 2);
    return g;
  });
}

registerPiece({
  id: 'fence_rail', name: 'Split-Rail Fence', cat: 'garden', slot: 'edge', layer: 'W', edgeKind: 'split',
  mats: ['wood', 'timber', 'log'], matGroup: 'splitrail', contextual: true,
  icon: '🪵', sound: 'wood', thumb: { ...THUMB_AT }, desc: 'A rustic split-rail fence for the paddock.',
  contextKey: (p, ctx) => postOwners(p, ctx, 'split').map(Number).join(''),
  cacheExtra: (p) => String(variant(p)),
  build(p, ctx) {
    const g = new THREE.Group();
    const b = groundBase(p);
    const m = mat(p.m);
    const v = variant(p);
    const own = postOwners(p, ctx, 'split');
    for (let i = 0; i < 2; i++) {
      if (!own[i]) continue;
      const x = i ? 1 : -1;
      box(g, m, x - 0.075, x + 0.075, b, b + 1.18, -0.07, 0.07);
      add(g, boxGeo(0.17, 0.05, 0.16), m, x, b + 1.19, 0, 0, 0, 0.12);
    }
    const tilts = [0.014, -0.01, 0.006, -0.016];
    [0.38, 0.7, 1.0].forEach((y, k) => {
      const t = tilts[(v + k) % 4];
      add(g, railGeo(), m, 0, b + y, ((v + k) % 2 ? 0.012 : -0.012), (k - 1) * 0.3, 0, t);
    });
    return g;
  },
});

registerPiece({
  id: 'hedge', name: 'Hedge', cat: 'garden', slot: 'edge', layer: 'W', edgeKind: 'hedge',
  mats: ['leavesDark', 'leaves'], matGroup: 'hedge', contextual: true,
  icon: '🌳', sound: 'leaf', thumb: { ...THUMB_AT }, desc: 'A neatly trimmed boxwood hedge.',
  cacheExtra: (p) => String(variant(p)),
  contextKey: (p, ctx) => hedgeEnds(p, ctx).map((j) => j.key).join(''),
  build(p, ctx) {
    const g = new THREE.Group();
    const b = groundBase(p);
    const m = mat(p.m);
    const R = 0.31, Hb = 0.78;
    const J = hedgeEnds(p, ctx);
    const ends = J.map((j) => {
      const sx = j.sx;
      if (j.kind === 'L') return j.own ? sx * (1 + R) : sx * (1 - R);
      if (j.kind === 'T' || j.kind === 'free') return sx * (1 - R);
      return sx;
    });
    box(g, m, ends[0], ends[1], b, b + Hb, -R, R);
    // the rounded top runs into whatever it joins (hidden inside it), and stops short at free ends
    const ca = J[0].kind === 'free' ? ends[0] : -1;
    const cb = J[1].kind === 'free' ? ends[1] : 1;
    add(g, cylGeo(R, R, cb - ca, 14), m, (ca + cb) / 2, b + Hb, 0, 0, 0, Math.PI / 2);
    J.forEach((j, i) => {
      const sx = j.sx;
      if (j.kind === 'free') {
        add(g, cylGeo(R, R, Hb, 14), m, sx * (1 - R), b + Hb / 2, 0);
        add(g, sphereGeo(R, 14, 8), m, sx * (1 - R), b + Hb, 0);
      } else if (j.kind === 'L' && j.own) {
        add(g, sphereGeo(R, 14, 8), m, sx, b + Hb, 0);
      }
    });
    // gentle clipped bumps along the top so it reads as foliage, not a box
    const v = variant(p);
    for (let k = 0; k < 3; k++) {
      const x = -0.62 + k * 0.62 + ((v + k) % 3 - 1) * 0.07;
      if (x < ends[0] + 0.25 || x > ends[1] - 0.25) continue;
      add(g, sphereGeo(0.27, 12, 7), m, x, b + Hb + 0.06 + ((k + v) % 2) * 0.015, ((v + 2 * k) % 3 - 1) * 0.03);
    }
    return g;
  },
});

/** Hedge junctions (hedges only join hedges). */
function hedgeEnds(p, ctx) {
  const f = frameOf(p);
  const me = K.W(p.a, p.x, p.y, p.z);
  const isHedge = sameKind('hedge');
  return f.ends.map(([vx, vz], i) => {
    const sx = i ? 1 : -1;
    let col = false, perp = 0;
    for (const e of edgesAt(vx, vz, p.y)) {
      if (e.key === me || !neighbour(ctx, e.key, isHedge)) continue;
      if (e.a === p.a) col = true; else perp++;
    }
    if (col) return { kind: 'line', sx, key: 'l' };
    if (perp === 1) { const own = p.a === 'x'; return { kind: 'L', sx, own, key: own ? 'O' : 'o' }; }
    if (perp > 1) return { kind: 'T', sx, key: 'T' };
    return { kind: 'free', sx, key: 'f' };
  });
}
