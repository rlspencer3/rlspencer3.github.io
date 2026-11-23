// Palette thumbnails: renders a single piece into a small image (dataURL), cached.
// Uses one small offscreen WebGL renderer shared by all thumbnails.

import * as THREE from 'three';
import { getDef } from './catalog.js';

const SIZE = 128;
let renderer = null, scene = null, camera = null;
const cache = new Map();
const queue = [];
let busy = false;

function setup() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
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
 * Resolves to a dataURL string (or '' if rendering is unavailable).
 */
export function thumbnail(world, id, rec = {}) {
  const key = id + '|' + JSON.stringify(rec);
  if (cache.has(key)) return cache.get(key);
  const pr = new Promise((resolve) => { queue.push({ world, id, rec, resolve }); pump(); });
  cache.set(key, pr);
  return pr;
}

function pump() {
  if (busy || !queue.length) return;
  busy = true;
  const run = () => {
    const start = performance.now();
    while (queue.length && performance.now() - start < 12) {
      const job = queue.shift();
      try { job.resolve(renderOne(job.world, job.id, job.rec)); } catch (e) { console.warn('thumb failed', job.id, e); job.resolve(''); }
    }
    if (queue.length) requestAnimationFrame(run);
    else busy = false;
  };
  requestAnimationFrame(run);
}

const _box = new THREE.Box3();
const _size = new THREE.Vector3();
const _center = new THREE.Vector3();

function renderOne(world, id, rec) {
  const def = getDef(id);
  if (!def) return '';
  if (!renderer) setup();
  // far outside the lot so contextual pieces see no neighbours
  const p = world.normalize({ t: id, x: 500, y: 0, z: 500, a: 'x', ...(def.thumb || {}), ...rec });
  if (!p) return '';
  const obj = world.buildLocal(p);
  scene.add(obj);
  _box.setFromObject(obj);
  _box.getSize(_size);
  _box.getCenter(_center);
  const radius = Math.max(_size.length() * 0.5, 0.3);
  const dist = radius / Math.sin((camera.fov * Math.PI) / 360) * 1.02;
  const dir = new THREE.Vector3(0.9, 0.62, 1.25).normalize();
  if (def.slot === 'edge') dir.set(0.55, 0.35, 1.3).normalize();
  camera.position.copy(_center).addScaledVector(dir, dist);
  camera.near = dist / 20; camera.far = dist * 4;
  camera.updateProjectionMatrix();
  camera.lookAt(_center);
  renderer.render(scene, camera);
  scene.remove(obj);
  return renderer.domElement.toDataURL('image/png');
}
