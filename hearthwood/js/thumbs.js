// Palette thumbnails: renders a single piece into a small image (dataURL), cached.
// Uses one small offscreen WebGL renderer shared by all thumbnails.
//
// Memory: the cache keeps at most MAX_CACHED pictures (least recently used go first; the UI asks again
// for a look whenever the material / colour in hand changes). A look the world already has a template
// for is drawn from that template; any other look is built just for the picture and its merged geometry
// is disposed right after (so trying colours in the palette doesn't grow world.templates).

import * as THREE from 'three';
import { getDef } from './catalog.js';
import { mergeByMaterial } from './world.js';
import { withoutSnow } from './materials.js';

const SIZE = 128;
const MAX_CACHED = 400;
let renderer = null, scene = null, camera = null;
let failed = false;      // no WebGL for thumbnails on this device: always resolve ''
let lost = false;        // context lost (e.g. the tab was backgrounded on a phone): retry later
const cache = new Map(); // key -> Promise<dataURL>, in least-recently-used order
const queue = [];
let busy = false;

function setup() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); lost = true; });
  canvas.addEventListener('webglcontextrestored', () => { lost = false; });
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(SIZE, SIZE, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xfff4e0, 0x8a7a66, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(3, 5, 4);
  scene.add(sun);
  camera = new THREE.PerspectiveCamera(30, 1, 0.05, 100);
}

/**
 * Get a thumbnail for a piece type. `rec` may override fields (m, c, k, r, h, s).
 * Resolves to a dataURL string (or '' if rendering is unavailable). Never rejects.
 */
export function thumbnail(world, id, rec = {}) {
  const key = id + '|' + JSON.stringify(rec);
  const hit = cache.get(key);
  if (hit) { cache.delete(key); cache.set(key, hit); return hit; }      // mark as recently used
  const pr = new Promise((resolve) => { queue.push({ world, id, rec, key, resolve }); pump(); });
  cache.set(key, pr);
  while (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value);
  return pr;
}

function pump() {
  if (busy || !queue.length) return;
  busy = true;
  const run = () => {
    const start = performance.now();
    while (queue.length && performance.now() - start < 12) {
      const job = queue.shift();
      let url = '';
      try { url = renderOne(job.world, job.id, job.rec); } catch (e) { console.warn('thumb failed', job.id, e); }
      // a failed picture is not remembered: the next request for this look tries again
      if (!url && cache.get(job.key)) cache.delete(job.key);
      job.resolve(url);
    }
    if (queue.length) requestAnimationFrame(run);
    else busy = false;
  };
  requestAnimationFrame(run);
}

const _box = new THREE.Box3();
const _size = new THREE.Vector3();
const _center = new THREE.Vector3();
const _dir = new THREE.Vector3();

/** Local-space object for a record: the world's cached template if it has one, else a throwaway build. */
function lookFor(world, p, def) {
  const ctx = world.ctxFor(p, def);
  const sig = world.signature(p, def, ctx);
  const tpl = sig && world.templates?.get(sig);
  if (tpl) return { obj: tpl.clone(), own: null };
  const raw = def.build(p, ctx);
  const shared = new Set();
  raw.traverse((o) => { if (o.geometry) shared.add(o.geometry); });
  const obj = mergeByMaterial(raw);
  const own = [];
  obj.traverse((o) => { if (o.geometry && !shared.has(o.geometry)) own.push(o.geometry); });
  return { obj, own };
}

function renderOne(world, id, rec) {
  if (failed) return '';
  const def = getDef(id);
  if (!def) return '';
  if (!renderer) {
    try { setup(); } catch (e) { failed = true; console.warn('thumbnails unavailable', e); return ''; }
  }
  if (lost) return '';
  // far outside the lot so contextual pieces see no neighbours
  const p = world.normalize({ t: id, x: 500, y: 0, z: 500, a: 'x', ...(def.thumb || {}), ...rec });
  if (!p) return '';
  const { obj, own } = lookFor(world, p, def);
  try {
    obj.rotation.y = (p.r || 0) * Math.PI / 2;   // def.thumb.r turns a piece to face the camera
    scene.add(obj);
    _box.setFromObject(obj);
    if (_box.isEmpty()) return '';
    _box.getSize(_size);
    _box.getCenter(_center);
    const radius = Math.max(_size.length() * 0.5, 0.3);
    const dist = radius / Math.sin((camera.fov * Math.PI) / 360) * 1.02;
    if (def.slot === 'edge') _dir.set(0.55, 0.35, 1.3).normalize();
    else _dir.set(0.9, 0.62, 1.25).normalize();
    camera.position.copy(_center).addScaledVector(_dir, dist);
    camera.near = dist / 20; camera.far = dist * 4;
    camera.updateProjectionMatrix();
    camera.lookAt(_center);
    withoutSnow(() => renderer.render(scene, camera));   // palette pictures show the roofing, not winter snow
    return lost ? '' : renderer.domElement.toDataURL('image/png');
  } finally {
    scene.remove(obj);
    if (own) for (const g of own) g.dispose();
  }
}
