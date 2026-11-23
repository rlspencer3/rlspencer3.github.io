// Geometry helpers for piece builders.
// All helpers return CACHED geometry (never dispose it) with UVs measured in
// meters, so tiled textures line up across neighbouring pieces.

import * as THREE from 'three';

const cache = new Map();

/** Cache any geometry (or other object) by a string key. */
export function cached(key, make) {
  let g = cache.get(key);
  if (!g) { g = make(); cache.set(key, g); }
  return g;
}

const r3 = (n) => Math.round(n * 1000) / 1000;

/**
 * Box centered at the origin, UVs in meters on every face.
 */
export function boxGeo(w, h, d) {
  return cached(`box|${r3(w)}|${r3(h)}|${r3(d)}`, () => {
    const g = new THREE.BoxGeometry(w, h, d);
    const uv = g.attributes.uv;
    // BoxGeometry faces: px, nx, py, ny, pz, nz (4 verts each with 1 segment)
    const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let f = 0; f < 6; f++) {
      const [su, sv] = dims[f];
      for (let i = 0; i < 4; i++) {
        const idx = f * 4 + i;
        uv.setXY(idx, uv.getX(idx) * su, uv.getY(idx) * sv);
      }
    }
    uv.needsUpdate = true;
    return g;
  });
}

/**
 * Cylinder along Y centered at origin. UV: u around circumference (meters), v along height (meters).
 */
export function cylGeo(rTop, rBot, h, seg = 12, open = false) {
  return cached(`cyl|${r3(rTop)}|${r3(rBot)}|${r3(h)}|${seg}|${open}`, () => {
    const g = new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, open);
    const uv = g.attributes.uv;
    const circ = Math.PI * 2 * Math.max(rTop, rBot);
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * circ, uv.getY(i) * h);
    uv.needsUpdate = true;
    return g;
  });
}

export function sphereGeo(r, wSeg = 12, hSeg = 8) {
  return cached(`sph|${r3(r)}|${wSeg}|${hSeg}`, () => new THREE.SphereGeometry(r, wSeg, hSeg));
}

export function coneGeo(r, h, seg = 10) {
  return cached(`cone|${r3(r)}|${r3(h)}|${seg}`, () => new THREE.ConeGeometry(r, h, seg));
}

/**
 * Extruded 2D polygon (points in the XY plane, meters), extruded along Z by depth
 * and centered on Z. Optional holes: arrays of points. UVs: caps use x/y in meters.
 */
export function prismGeo(points, depth, holes = [], key = null) {
  const k = key || `prism|${points.map((p) => r3(p[0]) + ',' + r3(p[1])).join(';')}|${r3(depth)}|${holes.map((h) => h.map((p) => r3(p[0]) + ',' + r3(p[1])).join(';')).join('/')}`;
  return cached(k, () => {
    const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
    for (const hole of holes) shape.holes.push(new THREE.Path(hole.map(([x, y]) => new THREE.Vector2(x, y))));
    const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 10 });
    g.translate(0, 0, -depth / 2);
    g.clearGroups();
    g.computeVertexNormals();
    return g;
  });
}

/**
 * Opening outline helpers for wallGeo holes. Each returns an array of [x,y] points (counter-clockwise not required).
 *   rect:  { x, y, w, h }            x = center, y = bottom
 *   arch:  { x, y, w, h }            rectangle with a semicircular top (total height h)
 *   round: { x, y, w }               circle of diameter w, y = bottom
 */
export function openingOutline(o) {
  const { x, y, w } = o;
  const h = o.h ?? w;
  const pts = [];
  if (o.shape === 'round') {
    const r = w / 2, cy = y + r, n = 20;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      pts.push([x + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
  } else if (o.shape === 'arch') {
    const r = w / 2, sy = y + h - r, n = 12;
    pts.push([x - r, y], [x + r, y], [x + r, sy]);
    for (let i = 1; i < n; i++) {
      const a = (i / n) * Math.PI;
      pts.push([x + Math.cos(a) * r, sy + Math.sin(a) * r]);
    }
    pts.push([x - r, sy]);
  } else {
    pts.push([x - w / 2, y], [x + w / 2, y], [x + w / 2, y + h], [x - w / 2, y + h]);
  }
  return pts;
}

/**
 * A wall slab: width along X (centered), height along Y (from 0), thickness along Z (centered),
 * with optional openings cut through. Optional `top` = [leftHeight, rightHeight] makes a sloped top (gables).
 */
export function wallGeo(w, h, t, openings = [], top = null) {
  const key = `wall|${r3(w)}|${r3(h)}|${r3(t)}|${JSON.stringify(openings)}|${top ? top.map(r3).join(',') : ''}`;
  return cached(key, () => {
    const hl = top ? top[0] : h, hr = top ? top[1] : h;
    const pts = [[-w / 2, 0], [w / 2, 0], [w / 2, hr], [-w / 2, hl]];
    if (hl <= 0.0001) pts.splice(3, 1);           // triangle (gable starting at zero)
    else if (hr <= 0.0001) pts.splice(2, 1);
    return prismGeo(pts, t, openings.map(openingOutline), key + '|p');
  });
}

/**
 * Create a mesh with shadows enabled. Returns the mesh (not added anywhere).
 */
export function mesh(geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  if (rx || ry || rz) m.rotation.set(rx, ry, rz);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Create a mesh and add it to a parent. Returns the mesh. */
export function add(parent, geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = mesh(geo, mat, x, y, z, rx, ry, rz);
  parent.add(m);
  return m;
}

/** Convenience: add a box of size w,h,d whose BOTTOM-center is at (x, y, z). */
export function addBox(parent, mat, w, h, d, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  return add(parent, boxGeo(w, h, d), mat, x, y + h / 2, z, rx, ry, rz);
}

/**
 * Build a BufferGeometry from raw triangles: positions = flat [x,y,z,...] (3 verts per tri),
 * uvs optional flat [u,v,...]. Normals are computed (flat shading friendly).
 */
export function triGeo(key, positions, uvs = null) {
  return cached(key, () => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    if (uvs) g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    else g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array((positions.length / 3) * 2).fill(0), 2));
    g.computeVertexNormals();
    return g;
  });
}
