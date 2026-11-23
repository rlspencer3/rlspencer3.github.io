// Hearthwood — bootstrap. Creates the renderer, world and controllers, then loads
// the feature modules (pieces, environment, audio, UI, blueprints). Feature modules are
// loaded with dynamic import so one failing module never blanks the whole game.

import * as THREE from 'three';
import { CELL, levelY, MAX_LEVEL } from './config.js';
import { state, events } from './state.js';
import * as catalog from './catalog.js';
import * as materials from './materials.js';
import { World } from './world.js';
import { CameraRig } from './camera.js';
import { Effects } from './effects.js';
import { Builder } from './builder.js';
import { storage } from './storage.js';
import { thumbnail } from './thumbs.js';

const params = new URLSearchParams(location.search);
const errors = [];

function reportError(where, e) {
  console.error(`[hearthwood] ${where}:`, e);
  errors.push({ where, message: String(e?.message || e) });
}
window.addEventListener('error', (e) => reportError('window', e.error || e.message));
window.addEventListener('unhandledrejection', (e) => reportError('promise', e.reason));

// ------------------------------------------------------------------ renderer

const container = document.getElementById('game');
const lowEnd = (navigator.hardwareConcurrency || 4) <= 4 && /Mobi|Android/i.test(navigator.userAgent);
const renderer = new THREE.WebGLRenderer({ antialias: !lowEnd, powerPreference: 'high-performance', preserveDrawingBuffer: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lowEnd ? 1.5 : 2));
renderer.setSize(container.clientWidth, container.clientHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = state.shadows;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#bfe0ee');
scene.fog = new THREE.Fog('#cfe6ee', 60, 160);

const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 400);

// Fallback lighting (replaced by env.js when it loads)
const fallbackLights = new THREE.Group();
fallbackLights.add(new THREE.HemisphereLight(0xfff4e0, 0x7a8a5a, 1.4));
const fbSun = new THREE.DirectionalLight(0xfff0d8, 2.0);
fbSun.position.set(20, 30, 12);
fallbackLights.add(fbSun);
scene.add(fallbackLights);
const fallbackGround = new THREE.Mesh(new THREE.CircleGeometry(90, 48), new THREE.MeshStandardMaterial({ color: '#8fb35e', roughness: 1 }));
fallbackGround.rotation.x = -Math.PI / 2;
fallbackGround.receiveShadow = true;
scene.add(fallbackGround);

const world = new World(scene);
const rig = new CameraRig(camera, renderer.domElement);
rig.drawMode = state.drawMode;
const effects = new Effects(scene);

const app = {
  THREE, scene, camera, renderer, world, rig, effects, state, events, catalog, materials, storage,
  params, errors, modules: {},
  builder: null, env: null, audio: null, ui: null, blueprints: null,
  thumbnail: (id, rec) => thumbnail(world, id, rec),
  fallback: { lights: fallbackLights, ground: fallbackGround },
  /** Render one frame and return a PNG dataURL (optionally downscaled to maxWidth). */
  snapshot(maxWidth = 0, type = 'image/png', quality = 0.9) {
    renderer.render(scene, camera);
    const src = renderer.domElement;
    if (!maxWidth || src.width <= maxWidth) return src.toDataURL(type, quality);
    const c = document.createElement('canvas');
    c.width = maxWidth;
    c.height = Math.round((src.height / src.width) * maxWidth);
    c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
    return c.toDataURL(type, quality);
  },
  /** Load build data (pieces) and optionally a camera view. */
  loadBuild(data, { record = false } = {}) {
    const n = world.load(data, { record });
    if (data?.cam) rig.setView(data.cam);
    return n;
  },
  newBuild() {
    world.clear({ record: true });
  },
};
window.__hw = app;

app.builder = new Builder(app);

// ------------------------------------------------------------------ modules

async function loadModule(name, path, initArg = true) {
  try {
    const mod = await import(path);
    app.modules[name] = mod;
    if (initArg && typeof mod.init === 'function') {
      const res = await mod.init(app);
      return res ?? mod;
    }
    return mod;
  } catch (e) {
    reportError(`module ${name}`, e);
    return null;
  }
}

function setLoading(text, frac) {
  const el = document.getElementById('loading-text');
  if (el) el.textContent = text;
  const bar = document.getElementById('loading-bar');
  if (bar && frac !== undefined) bar.style.width = `${Math.round(frac * 100)}%`;
}

async function boot() {
  setLoading('Gathering timber…', 0.15);
  // sequential so palette order is deterministic
  for (const name of ['floors', 'walls', 'roof', 'decor']) await loadModule(name, `./pieces/${name}.js`, false);
  setLoading('Planting the meadow…', 0.45);
  app.env = await loadModule('env', './env.js');
  if (app.env) { scene.remove(fallbackLights); scene.remove(fallbackGround); }
  app.audio = await loadModule('audio', './audio.js');
  setLoading('Drawing blueprints…', 0.7);
  app.blueprints = await loadModule('blueprints', './blueprints.js');
  setLoading('Lighting the hearth…', 0.85);
  if (params.get('ui') !== '0') app.ui = await loadModule('ui', './ui.js');

  // starting content
  const showcase = params.get('showcase');
  const bp = params.get('bp');
  if (showcase) buildShowcase(showcase);
  else if (bp && app.blueprints?.stamp) {
    app.blueprints.stamp(bp, { animate: false, record: false });
  } else if (params.get('clean') !== '1') {
    const saved = storage.loadAutosave();
    if (saved?.pieces?.length) app.loadBuild(saved);
    else if (app.blueprints?.welcome) app.blueprints.welcome();
  }
  if (params.get('time')) state.set({ time: parseFloat(params.get('time')) });
  if (params.get('season')) state.set({ season: params.get('season') });
  if (params.get('level')) state.set({ level: parseInt(params.get('level'), 10) || 0 });
  if (params.get('seeAll')) state.set({ seeAll: params.get('seeAll') === '1' });
  if (params.get('cam')) {
    const [th, ph, r, tx, ty, tz] = params.get('cam').split(',').map(Number);
    rig.setView({ t: [tx || 0, ty || 1, tz || 0], th, ph, r }, true);
  }
  rig.snap();

  // autosave (debounced)
  let saveTimer = null;
  events.on('world-change', () => {
    if (showcase || params.get('nosave') === '1') return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => storage.autosave(world.serialize(), rig.getView()), 800);
  });

  setLoading('Welcome home', 1);
  const loading = document.getElementById('loading');
  if (loading) { loading.classList.add('done'); setTimeout(() => loading.remove(), 700); }
  window.__hwReady = true;
  events.emit('ready', app);
}

// ------------------------------------------------------------------ dev showcase

function buildShowcase(cat) {
  const defs = cat === 'all' ? catalog.allDefs() : catalog.piecesIn(cat);
  let row = 0;
  const pieces = [];
  for (const def of defs) {
    const mats = def.mats && def.mats.length ? def.mats : [undefined];
    mats.forEach((m, i) => {
      const x = -9 + i * 2, z = -9 + row * 2;
      const p = { t: def.id, x, y: 0, z, m, r: def.slot === 'cell' ? 0 : 0, a: 'x', ...(def.showcase || {}) };
      if (def.layer === 'R') p.h = 0;
      pieces.push(p);
    });
    row++;
  }
  world.load({ pieces });
  state.set({ seeAll: true, level: 0 });
  rig.setView({ t: [-4, 1, -4 + row], th: 0.6, ph: 0.95, r: 22 + row * 1.2 }, true);
  app.showcase = { cat, rows: row, pieces: pieces.length };
}

// ------------------------------------------------------------------ loop

function resize() {
  const w = container.clientWidth, h = container.clientHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
window.visualViewport?.addEventListener('resize', resize);

state.on((changed) => {
  if (changed.includes('shadows')) {
    renderer.shadowMap.enabled = state.shadows;
    scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
  }
});

const clock = new THREE.Clock();
let fpsAcc = 0, fpsFrames = 0;
app.fps = 60;
function frame() {
  const dt = Math.min(clock.getDelta(), 0.1);
  rig.update(dt);
  effects.update(dt);
  try { app.env?.update?.(dt); } catch (e) { reportError('env.update', e); app.env.update = null; }
  try { app.audio?.update?.(dt); } catch (e) { reportError('audio.update', e); app.audio.update = null; }
  try { app.blueprints?.update?.(dt); } catch (e) { reportError('blueprints.update', e); app.blueprints.update = null; }
  try { app.ui?.update?.(dt); } catch (e) { reportError('ui.update', e); app.ui.update = null; }
  renderer.render(scene, camera);
  fpsAcc += dt; fpsFrames++;
  if (fpsAcc > 1) { app.fps = fpsFrames / fpsAcc; fpsAcc = 0; fpsFrames = 0; }
  requestAnimationFrame(frame);
}
rig.snap();
requestAnimationFrame(frame);
boot();

// Service worker for offline / install-to-home-screen
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

export default app;
