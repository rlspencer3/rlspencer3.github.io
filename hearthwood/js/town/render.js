// Hearthwood — Living Town rendering (docs/LIVING.md §12.8). WP2, internal: only actors.js uses it.
//
// Everything lives under one THREE.Group named 'town' (added to app.scene by actors.js): layer 0 only, never inside
// world.root, no shadow casting, no effects tweens. Draw calls (main pass only):
//   bodies  one InstancedMesh per job present (capacity 24), the shared patched material      ≤ 8
//   glow    lanterns, the Lamplighter's pole tips, camp lanterns — mat('lampGlow'), 32          1
//   blobs   soft contact shadows, 32                                                          1
//   spill   warm light pools at doors / windows and the move-in opening glow, 128             1
//   fx      one THREE.Points ring buffer of 256 glyph particles                               1
//   camp    canvas tents, 10 (the villager material)                                          0–1
//   rings   Show me highlight rings, 24 (+ the ghost, baked into one mesh: +1)               +1
// Instances are rewritten every frame from the actors (no slot bookkeeping): begin() → body() / glow() / blob() → end().

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/BufferGeometryUtils.js';
import { mat, blueprintMat } from '../materials.js';
import {
  villagerGeometry, villagerMaterial, fallbackMaterial, patchSupported, tentGeometry, lanternGeometry,
  glyphAtlas, softTexture, GLYPH, JOBS,
} from './look.js';

export const CAP = { body: 24, glow: 32, blob: 32, spill: 128, fx: 256, camp: 10, ring: 24 };

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

/** Add the per-instance attributes the patched villager material reads to an instanced geometry. */
function instanceAttrs(geo, cap) {
  const mk = (name, n) => {
    const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * n), n);
    a.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute(name, a);
    return a;
  };
  return { iOutfit: mk('iOutfit', 3), iSkin: mk('iSkin', 3), iHair: mk('iHair', 3), iAnim: mk('iAnim', 4), iAnim2: mk('iAnim2', 4), iFlags: mk('iFlags', 4) };
}

/** Flat (XZ) quad of size 1 × 1 centred at the origin. */
function flatQuad() {
  const g = new THREE.PlaneGeometry(1, 1);
  g.rotateX(-Math.PI / 2);
  return g;
}

// ---------------------------------------------------------------------------------------------- FX points

const FX_V = /* glsl */`
attribute vec4 aVel;    // xyz velocity (m/s), w vertical acceleration (m/s²)
attribute vec4 aInfo;   // birth time, glyph, life (s), size (m)
attribute vec4 aMore;   // growth, sway (m), orbit radius (m), phase
uniform float uTime;
uniform float uPx;
varying float vAlpha;
varying vec2 vCell;
void main() {
	float age = uTime - aInfo.x;
	if ( age < 0.0 || age > aInfo.z ) { gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 ); gl_PointSize = 0.0; vAlpha = 0.0; vCell = vec2( 0.0 ); return; }
	vec3 p = position + aVel.xyz * age + vec3( 0.0, 0.5 * aVel.w * age * age, 0.0 );
	p.x += sin( age * 3.1 + aMore.w ) * aMore.y;
	p.z += cos( age * 2.7 + aMore.w ) * aMore.y;
	if ( aMore.z > 0.0 ) {
		float a = aMore.w + age * 3.4;
		p.x += cos( a ) * aMore.z; p.z += sin( a ) * aMore.z; p.y += sin( age * 5.0 + aMore.w ) * 0.07;
	}
	vec4 mv = modelViewMatrix * vec4( p, 1.0 );
	gl_Position = projectionMatrix * mv;
	float k = age / aInfo.z;
	gl_PointSize = clamp( aInfo.w * ( 1.0 + aMore.x * k ) * uPx / max( 0.2, -mv.z ), 0.0, 320.0 );
	vAlpha = smoothstep( 0.0, 0.08, k ) * ( 1.0 - smoothstep( 0.62, 1.0, k ) );
	vCell = vec2( mod( aInfo.y, 4.0 ), floor( aInfo.y / 4.0 ) );
}`;
const FX_F = /* glsl */`
uniform sampler2D uAtlas;
varying float vAlpha;
varying vec2 vCell;
void main() {
	vec2 uv = vec2( ( vCell.x + gl_PointCoord.x ) / 4.0, ( 4.0 - vCell.y - gl_PointCoord.y ) / 4.0 );
	vec4 c = texture2D( uAtlas, uv );
	c.a *= vAlpha;
	if ( c.a < 0.02 ) discard;
	gl_FragColor = c;
	#include <colorspace_fragment>
}`;

/** Per-cue particle recipes (§12.3 Cue kinds). n: default count. */
const FX_KIND = {
  hearts: { g: GLYPH.heart, n: 5, life: 1.7, size: 0.3, up: 0.75, spread: 0.22, sway: 0.12, grav: 0 },
  note: { g: GLYPH.note, n: 2, life: 1.9, size: 0.26, up: 0.55, spread: 0.2, sway: 0.18, grav: 0 },
  sparkle: { g: GLYPH.sparkle, n: 6, life: 1.0, size: 0.2, up: 0.25, burst: 0.7, grav: 0 },
  drops: { g: GLYPH.drop, n: 4, life: 0.75, size: 0.13, up: 0.4, burst: 0.35, grav: -5 },
  chips: { g: GLYPH.chip, n: 5, life: 0.9, size: 0.14, up: 1.9, burst: 0.9, grav: -7 },
  seeds: { g: GLYPH.seed, n: 6, life: 0.85, size: 0.12, up: 1.2, burst: 1.2, grav: -6 },
  puff: { g: GLYPH.puff, n: 3, life: 1.7, size: 0.42, up: 0.35, spread: 0.15, grow: 1.4, grav: 0 },
  z: { g: GLYPH.z, n: 1, life: 2.3, size: 0.24, up: 0.32, spread: 0.08, sway: 0.12, grav: 0 },
  letter: { g: GLYPH.letter, n: 1, life: 1.3, size: 0.28, up: 1.1, grav: -1.2 },
  bread: { g: GLYPH.bread, n: 1, life: 1.4, size: 0.3, up: 0.8, grav: -0.6 },
  fish: { g: GLYPH.fish, n: 1, life: 1.0, size: 0.3, up: 3.0, burst: 0.5, grav: -7 },
  bees: { g: GLYPH.bee, n: 6, life: 3.2, size: 0.12, up: 0.0, orbit: 0.45, grav: 0 },
  dust: { g: GLYPH.puff, n: 4, life: 0.7, size: 0.22, up: 0.25, burst: 0.6, grow: 0.8, grav: 0 },
};

/** Build the town render layer. */
export function createRender(app) {
  const { renderer } = app;
  const group = new THREE.Group();
  group.name = 'town';
  const patched = !(typeof window !== 'undefined' && window.__townNoPatch) && patchSupported();
  const vmat = patched ? villagerMaterial() : fallbackMaterial();

  // ---------------------------------------------------------------- bodies (one InstancedMesh per job, made on use)
  const bodies = new Map();       // job → { mesh, attrs, n }
  function bodyOf(job) {
    let b = bodies.get(job);
    if (b) return b;
    const base = villagerGeometry(job);
    const geo = (patched ? base : base.userData.fallback).clone();
    const attrs = patched ? instanceAttrs(geo, CAP.body) : null;
    const mesh = new THREE.InstancedMesh(geo, vmat, CAP.body);
    mesh.name = 'town-body-' + job;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.count = 0;
    mesh.visible = false;
    group.add(mesh);
    b = { mesh, attrs, list: attrs ? Object.values(attrs) : [], n: 0, tris: geo.attributes.position.count / 3 };
    bodies.set(job, b);
    return b;
  }

  // ---------------------------------------------------------------- glow (lanterns, pole tips, camp lanterns)
  const glow = new THREE.InstancedMesh(lanternGeometry(), mat('lampGlow'), CAP.glow);
  glow.name = 'town-glow';
  Object.assign(glow, { frustumCulled: false, castShadow: false, receiveShadow: false });
  glow.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  glow.count = 0; glow.visible = false;
  group.add(glow);

  // ---------------------------------------------------------------- blob shadows, spill, rings (one basic program)
  const basic = (tex, additive) => new THREE.MeshBasicMaterial({
    map: tex, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, toneMapped: !additive, fog: !additive,
  });
  const blobMat = basic(softTexture('blob'), false);
  blobMat.name = 'town-blob';
  const blobs = new THREE.InstancedMesh(flatQuad(), blobMat, CAP.blob);
  blobs.name = 'town-blobs';
  Object.assign(blobs, { frustumCulled: false, castShadow: false, receiveShadow: false, renderOrder: 1 });
  blobs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  for (let i = 0; i < CAP.blob; i++) blobs.setColorAt(i, _c.setRGB(0, 0, 0));
  blobs.count = 0; blobs.visible = false;
  group.add(blobs);

  const spillMat = basic(softTexture('spill'), true);
  spillMat.name = 'town-spill';
  const spill = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), spillMat, CAP.spill);
  spill.name = 'town-spill';
  Object.assign(spill, { frustumCulled: false, castShadow: false, receiveShadow: false, renderOrder: 2 });
  spill.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  for (let i = 0; i < CAP.spill; i++) spill.setColorAt(i, _c.setRGB(0, 0, 0));
  spill.instanceColor.setUsage(THREE.DynamicDrawUsage);
  spill.count = 0; spill.visible = false;
  group.add(spill);

  const ringMat = basic(softTexture('ring'), true);
  ringMat.name = 'town-ring';
  const rings = new THREE.InstancedMesh(flatQuad(), ringMat, CAP.ring);
  rings.name = 'town-rings';
  Object.assign(rings, { frustumCulled: false, castShadow: false, receiveShadow: false, renderOrder: 3 });
  rings.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  for (let i = 0; i < CAP.ring; i++) rings.setColorAt(i, _c.setRGB(0, 0, 0));
  rings.instanceColor.setUsage(THREE.DynamicDrawUsage);
  rings.count = 0; rings.visible = false;
  group.add(rings);

  // ---------------------------------------------------------------- camp tents (the villager material)
  const tentGeo = tentGeometry().clone();
  const tentAttrs = patched ? instanceAttrs(tentGeo, CAP.camp) : null;
  const tentList = tentAttrs ? Object.values(tentAttrs) : [];
  const camp = new THREE.InstancedMesh(tentGeo, vmat, CAP.camp);
  camp.name = 'town-camp';
  Object.assign(camp, { frustumCulled: false, castShadow: false, receiveShadow: true });
  camp.count = 0; camp.visible = false;
  group.add(camp);

  // ---------------------------------------------------------------- FX points
  const N = CAP.fx;
  const fxGeo = new THREE.BufferGeometry();
  const fxPos = new THREE.BufferAttribute(new Float32Array(N * 3), 3);
  const fxVel = new THREE.BufferAttribute(new Float32Array(N * 4), 4);
  const fxInfo = new THREE.BufferAttribute(new Float32Array(N * 4).fill(-1e6), 4);
  const fxMore = new THREE.BufferAttribute(new Float32Array(N * 4), 4);
  for (const a of [fxPos, fxVel, fxInfo, fxMore]) a.setUsage(THREE.DynamicDrawUsage);
  for (let i = 0; i < N; i++) fxInfo.array[i * 4 + 2] = 0.001;
  fxGeo.setAttribute('position', fxPos);
  fxGeo.setAttribute('aVel', fxVel);
  fxGeo.setAttribute('aInfo', fxInfo);
  fxGeo.setAttribute('aMore', fxMore);
  fxGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
  const fxMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPx: { value: 400 }, uAtlas: { value: glyphAtlas() } },
    vertexShader: FX_V, fragmentShader: FX_F, transparent: true, depthWrite: false, toneMapped: false,
  });
  fxMat.name = 'town-fx';
  const fx = new THREE.Points(fxGeo, fxMat);
  fx.name = 'town-fx';
  Object.assign(fx, { frustumCulled: false, renderOrder: 4, visible: false });
  group.add(fx);
  let fxHead = 0, fxUntil = -1, fxTime = 0;

  // ---------------------------------------------------------------- ghost holder & debug overlay
  const ghostHolder = new THREE.Group();
  ghostHolder.name = 'town-ghost';
  group.add(ghostHolder);
  let overlay = null;

  // ================================================================ frame writers
  let nGlow = 0, nBlob = 0;
  const begin = () => {
    for (const b of bodies.values()) b.n = 0;
    nGlow = 0; nBlob = 0;
  };
  /**
   * One villager: matrix (THREE.Matrix4), colours (THREE.Color linear), anim/anim2/flags: 4-number arrays.
   * Without the patch (fallback) only matrices are written and faded-out villagers are skipped.
   */
  const body = (job, matrix, outfit, skin, hair, anim, anim2, flags) => {
    if (!patched && flags[0] < 0.5) return;
    const b = bodyOf(job);
    if (b.n >= CAP.body) return;
    const i = b.n++;
    b.mesh.setMatrixAt(i, matrix);
    if (!b.attrs) return;
    const A = b.attrs, j = i * 3, k = i * 4;
    const o = A.iOutfit.array, sk = A.iSkin.array, h = A.iHair.array, a1 = A.iAnim.array, a2 = A.iAnim2.array, f = A.iFlags.array;
    o[j] = outfit.r; o[j + 1] = outfit.g; o[j + 2] = outfit.b;
    sk[j] = skin.r; sk[j + 1] = skin.g; sk[j + 2] = skin.b;
    h[j] = hair.r; h[j + 1] = hair.g; h[j + 2] = hair.b;
    for (let q = 0; q < 4; q++) { a1[k + q] = anim[q]; a2[k + q] = anim2[q]; f[k + q] = flags[q]; }
  };
  /** A lantern / glowing tip at a world point (the lantern hangs below it), yaw and scale. */
  const glowAt = (x, y, z, yaw = 0, s = 1, tilt = 0) => {
    if (nGlow >= CAP.glow) return;
    _q.setFromAxisAngle(UP, yaw);
    if (tilt) _q.multiply(_q2.setFromAxisAngle(_v.set(1, 0, 0), tilt));
    _m.compose(_v.set(x, y, z), _q, _s.set(s, s, s));
    glow.setMatrixAt(nGlow++, _m);
  };
  /** A soft contact shadow at a surface point (diameter 0.9 m × s). */
  const blob = (x, y, z, s = 1) => {
    if (nBlob >= CAP.blob || s <= 0.02) return;
    _m.makeScale(0.9 * s, 1, 0.9 * s).setPosition(x, y + 0.01, z);
    blobs.setMatrixAt(nBlob++, _m);
  };
  const end = (night) => {
    for (const b of bodies.values()) {
      b.mesh.count = b.n;
      b.mesh.visible = b.n > 0;
      if (b.n > 0) {
        b.mesh.instanceMatrix.needsUpdate = true;
        for (let i = 0; i < b.list.length; i++) b.list[i].needsUpdate = true;
      }
    }
    glow.count = nGlow; glow.visible = nGlow > 0;
    if (nGlow) glow.instanceMatrix.needsUpdate = true;
    blobs.count = nBlob; blobs.visible = nBlob > 0;
    if (nBlob) blobs.instanceMatrix.needsUpdate = true;
    blobMat.opacity = 0.35 * (1 - 0.5 * night);
  };

  // ================================================================ spill & opening glow
  /** lights: [{ kind, x, y, z, nx, nz, w, h }] (world metres; ground quads lie flat, openings stand facing n). */
  let nStatic = 0;
  function setSpill(lights) {
    const n = Math.min(lights.length, CAP.spill);
    nStatic = n;
    for (let i = 0; i < n; i++) {
      const L = lights[i];
      const yaw = Math.atan2(L.nx || 0, L.nz || 1);
      _q.setFromAxisAngle(UP, yaw);
      const flat = L.kind === 'ground' || L.kind === 'floor';      // 'floor': the warm glow on an occupied home's floor
      if (flat) _q.multiply(_q2.setFromAxisAngle(_v.set(1, 0, 0), -Math.PI / 2));
      const w = L.w || (flat ? 1.6 : 0.9), h = L.h || (flat ? 1.2 : 1.6);
      _m.compose(_v.set(L.x, L.y, L.z), _q, _s.set(w, h, 1));
      spill.setMatrixAt(i, _m);
      spill.setColorAt(i, _c.setRGB(0, 0, 0));
    }
    spill.count = n;
    spill.instanceMatrix.needsUpdate = true;
    spill.instanceColor.needsUpdate = true;
  }
  const WARM = new THREE.Color('#ffb25e');
  /**
   * Brightness per static light (0..1+), plus this frame's dynamic quads appended after them (lantern pools on the
   * ground and soft halos facing the camera: { kind: 'pool'|'halo', x, y, z, s, b, yaw }). Hides the mesh when
   * nothing is lit. One draw call for all of it.
   */
  function spillLevels(levels, dyn) {
    let any = false;
    for (let i = 0; i < nStatic; i++) {
      const b = levels[i] || 0;
      if (b > 0.004) any = true;
      spill.setColorAt(i, _c.copy(WARM).multiplyScalar(b));
    }
    const nd = dyn ? Math.min(dyn.length, CAP.spill - nStatic) : 0;
    for (let j = 0; j < nd; j++) {
      const d = dyn[j], i = nStatic + j;
      _q.setFromAxisAngle(UP, d.yaw || 0);
      if (d.kind === 'pool') _q.multiply(_q2.setFromAxisAngle(_v.set(1, 0, 0), -Math.PI / 2));
      _m.compose(_v.set(d.x, d.y, d.z), _q, _s.set(d.s, d.s, 1));
      spill.setMatrixAt(i, _m);
      spill.setColorAt(i, _c.copy(WARM).multiplyScalar(d.b));
      if (d.b > 0.004) any = true;
    }
    if (nd || spill.count !== nStatic) spill.instanceMatrix.needsUpdate = true;
    spill.count = nStatic + nd;
    spill.instanceColor.needsUpdate = true;
    spill.visible = any;
  }

  // ================================================================ camp
  const tentLantern = tentGeometry().userData.lantern;
  /** tents: [{ x, y, z, fade }] → draws tents and returns their lantern points. */
  function setTents(tents) {
    const n = Math.min(tents.length, CAP.camp);
    let k = 0;
    for (let i = 0; i < n; i++) {
      const t = tents[i];
      if (!patched && t.fade < 0.5) continue;
      _m.makeTranslation(t.x, t.y || 0, t.z);
      camp.setMatrixAt(k, _m);
      if (tentAttrs) {
        const f = tentAttrs.iFlags.array;
        f[k * 4] = t.fade; f[k * 4 + 1] = 0; f[k * 4 + 2] = 0; f[k * 4 + 3] = 0;
      }
      if (t.fade > 0.3) glowAt(t.x + tentLantern[0], (t.y || 0) + tentLantern[1], t.z + tentLantern[2], 0, 1);
      k++;
    }
    camp.count = k;
    camp.visible = k > 0;
    if (k) {
      camp.instanceMatrix.needsUpdate = true;
      if (tentAttrs) for (const a of tentList) a.needsUpdate = true;
    }
  }

  // ================================================================ rings
  /** list: [{ x, y, z, b (brightness), sx, sz, yaw }] */
  function setRings(list) {
    const n = Math.min(list.length, CAP.ring);
    for (let i = 0; i < n; i++) {
      const r = list[i];
      _q.setFromAxisAngle(UP, r.yaw || 0);
      _m.compose(_v.set(r.x, r.y, r.z), _q, _s.set(2.25 * (r.sx || 1), 1, 2.25 * (r.sz || 1)));
      rings.setMatrixAt(i, _m);
      rings.setColorAt(i, _c.setRGB(1.0, 0.78, 0.36).multiplyScalar(r.b));
    }
    rings.count = n;
    rings.visible = n > 0;
    if (n) { rings.instanceMatrix.needsUpdate = true; rings.instanceColor.needsUpdate = true; }
  }

  // ================================================================ FX
  /** Spawn n particles of a cue kind at a world point; dir (optional [x, z]) aims sprays such as water drops. */
  function spawn(kind, x, y, z, n, dir) {
    const K = FX_KIND[kind];
    if (!K) return 0;
    const count = Math.max(1, Math.min(64, n || K.n));
    const ring = kind === 'puff' && count >= 6;
    for (let k = 0; k < count; k++) {
      const i = fxHead;
      fxHead = (fxHead + 1) % N;
      const a = ring ? (k / count) * Math.PI * 2 : Math.random() * Math.PI * 2;
      const sp = (K.spread || 0) * Math.sqrt(Math.random());
      fxPos.array[i * 3] = x + Math.cos(a) * sp;
      fxPos.array[i * 3 + 1] = y + (Math.random() - 0.5) * 0.1;
      fxPos.array[i * 3 + 2] = z + Math.sin(a) * sp;
      const burst = ring ? 0.55 : (K.burst || 0) * (0.5 + Math.random() * 0.5);
      let vx = Math.cos(a) * burst, vz = Math.sin(a) * burst;
      if (dir) { vx += dir[0] * 0.6; vz += dir[1] * 0.6; }
      fxVel.array.set([vx, (K.up || 0) * (0.8 + Math.random() * 0.4), vz, K.grav || 0], i * 4);
      fxInfo.array.set([fxTime + k * (ring ? 0 : 0.05), K.g, K.life * (0.85 + Math.random() * 0.3), K.size * (0.85 + Math.random() * 0.3)], i * 4);
      fxMore.array.set([K.grow || 0, K.sway || 0, K.orbit ? K.orbit * (0.6 + Math.random() * 0.6) : 0, Math.random() * 6.28], i * 4);
      fxUntil = Math.max(fxUntil, fxTime + K.life * 1.2 + 0.3);
    }
    fxPos.needsUpdate = true; fxVel.needsUpdate = true; fxInfo.needsUpdate = true; fxMore.needsUpdate = true;
    return count;
  }
  function updateFx(dt, camera) {
    fxTime += dt;
    fxMat.uniforms.uTime.value = fxTime;
    const h = renderer.domElement.height || renderer.getDrawingBufferSize?.(new THREE.Vector2()).y || 800;
    fxMat.uniforms.uPx.value = 0.5 * h * camera.projectionMatrix.elements[5];
    fx.visible = fxTime < fxUntil;
  }

  // ================================================================ ghost & overlay
  let ghost = null, ghostGeo = null;
  const _inv = new THREE.Matrix4(), _gm = new THREE.Matrix4();
  const finite = (a) => { for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) return false; return true; };
  /**
   * Bake a built piece into ONE geometry in the piece's own frame (T2.4): every part gets the same blueprint
   * material, so one mesh draws the whole ghost in one call whatever the piece (a birdhouse has 10 parts). Only
   * position and normal are kept; hidden parts are skipped. null when there is nothing to draw or the placement is
   * not finite (a NaN rotation would also give a NaN hit box, T2.1).
   */
  function bakeGhost(obj) {
    obj.updateMatrix();
    obj.updateMatrixWorld(true);
    if (!finite(obj.matrix.elements) || !finite(obj.matrixWorld.elements)) return null;
    _inv.copy(obj.matrixWorld).invert();
    const geos = [];
    obj.traverseVisible((o) => {
      if (!o.isMesh || !o.geometry?.attributes?.position) return;
      const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
      if (!g.attributes.normal) g.computeVertexNormals();
      g.morphAttributes = {};
      g.clearGroups();
      g.applyMatrix4(_gm.multiplyMatrices(_inv, o.matrixWorld));
      geos.push(g);
    });
    if (!geos.length) return null;
    const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
    if (merged !== geos[0]) for (const g of geos) g.dispose();
    if (!merged) return null;
    if (!finite(merged.attributes.position.array)) { merged.dispose(); return null; }
    merged.computeBoundingBox();
    merged.computeBoundingSphere();
    return merged;
  }
  /** Show a built piece as the Show me ghost (null clears it). Returns the drawn mesh, or null when there is none. */
  function setGhost(obj) {
    if (ghost) ghostHolder.remove(ghost);
    if (ghostGeo) { ghostGeo.dispose(); ghostGeo = null; }   // only the baked copy: template geometry stays shared (§12.8)
    ghost = null;
    if (!obj) return null;
    const geo = bakeGhost(obj);
    if (!geo) return null;                    // nothing drawable (or a broken placement): the rings alone show the spot
    ghostGeo = geo;
    ghost = new THREE.Mesh(geo, blueprintMat(true));
    ghost.name = 'town-ghost-piece';
    ghost.position.copy(obj.position); ghost.quaternion.copy(obj.quaternion); ghost.scale.copy(obj.scale);   // where the piece stands
    ghost.castShadow = false; ghost.receiveShadow = false;
    ghost.renderOrder = 5;
    ghost.layers.set(0);
    ghost.raycast = () => {};
    ghostHolder.add(ghost);
    return ghost;
  }
  function setOverlay(tex) {
    if (!tex) { if (overlay) overlay.visible = false; return; }
    if (!overlay) {
      overlay = new THREE.Mesh(flatQuad(), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, opacity: 0.85 }));
      overlay.name = 'town-nav-overlay';
      overlay.scale.set(44, 1, 44);
      overlay.position.set(0, 0.07, 0);
      overlay.renderOrder = 6;
      group.add(overlay);
    }
    if (overlay.material.map && overlay.material.map !== tex) overlay.material.map.dispose();
    overlay.material.map = tex;
    overlay.material.needsUpdate = true;
    overlay.visible = true;
  }

  // ================================================================ compile (no first-use stutter, §12.8)
  /** One hidden instance of every town mesh → compile their programs now (behind the loading screen). */
  async function compile(camera) {
    const keep = [];
    const show = (o, n) => { keep.push([o, o.visible, o.count]); o.visible = true; if (n !== undefined) o.count = n; };
    _m.makeScale(0.001, 0.001, 0.001).setPosition(0, -50, 0);
    for (const job of JOBS) {
      const b = bodyOf(job);
      b.mesh.setMatrixAt(0, _m);
      if (b.attrs) b.attrs.iFlags.array.set([0, 0, 0, 0], 0);
      show(b.mesh, 1);
    }
    for (const o of [glow, blobs, spill, rings, camp]) { o.setMatrixAt(0, _m); show(o, 1); }
    show(fx);
    const dummy = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.01, 0.01), blueprintMat(true));
    dummy.position.set(0, -50, 0);
    group.add(dummy);
    const scene = app.scene;
    const detached = !group.parent;
    if (detached) scene.add(group);
    try {
      if (renderer.compileAsync && renderer.extensions?.has?.('KHR_parallel_shader_compile')) await renderer.compileAsync(group, camera, scene);
      else renderer.compile(group, camera, scene);
    } finally {
      group.remove(dummy);
      dummy.geometry.dispose();
      for (const [o, vis, count] of keep) { o.visible = vis; if (count !== undefined) o.count = count; }
      if (detached) scene.remove(group);
    }
    // a patch that compiled into a broken program falls back to the plain material (L6)
    if (patched) {
      const prog = renderer.properties.get(vmat)?.currentProgram;
      if (prog && prog.diagnostics && prog.diagnostics.runnable === false) return false;
    }
    return true;
  }

  // ================================================================ stats
  function stats() {
    let calls = 0, tris = 0, instances = 0;
    // nothing is drawn while the group is hidden (villagers off) or was never added (townrender=0): count only what
    // the renderer really submits (T1.14); `instances` still reports what the town holds
    const drawn = group.visible && !!group.parent;
    const add = (o, triPer, n) => { if (o.visible && n > 0) { calls++; tris += triPer * n; instances += n; } };
    for (const b of bodies.values()) add(b.mesh, b.tris, b.mesh.count);
    add(glow, lanternGeometry().attributes.position.count / 3, glow.count);
    add(blobs, 2, blobs.count);
    add(spill, 2, spill.count);
    add(rings, 2, rings.count);
    add(camp, tentGeo.attributes.position.count / 3, camp.count);
    if (fx.visible) { calls++; instances += N; }
    if (ghost && ghostHolder.visible) ghost.traverse((o) => { if (o.isMesh && o.visible) { calls++; tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; } });
    if (overlay?.visible) calls++;
    return drawn ? { calls, tris: Math.round(tris), instances } : { calls: 0, tris: 0, instances };
  }

  return {
    group, patched, bodies, glow, blobs, spill, rings, camp, fx, ghostHolder,
    begin, body, glowAt, blob, end,
    setSpill, spillLevels, setTents, setRings, spawn, updateFx, setGhost, setOverlay, compile, stats,
    get ghost() { return ghost; },
  };
}
