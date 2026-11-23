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
const MOBILE = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
  || (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 900);
const lowEnd = MOBILE && ((navigator.hardwareConcurrency || 4) <= 4 || (navigator.deviceMemory || 4) <= 2);

/** Device-pixel cap per quality setting: 'low' renders at CSS resolution, others at most 2× (1.5× on weak phones). */
function pixelRatioFor(q = state.quality) {
  const dpr = window.devicePixelRatio || 1;
  if (q === 'low') return Math.min(dpr, 1);
  if (q === 'high') return Math.min(dpr, 2);
  return Math.min(dpr, lowEnd ? 1.5 : 2);
}
// MSAA can only be chosen when the context is created: a quality change applies to antialiasing on next load.
const antialias = state.quality === 'high' || (state.quality !== 'low' && !lowEnd);
const renderer = new THREE.WebGLRenderer({ antialias, powerPreference: 'high-performance', preserveDrawingBuffer: false });
renderer.setPixelRatio(pixelRatioFor());
renderer.setSize(container.clientWidth, container.clientHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = state.shadows;
renderer.shadowMap.type = THREE.PCFShadowMap; // r187 removed PCFSoftShadowMap; PCF + shadow.radius stays soft
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

// ?batch=0 turns static batching off (A/B checks); ?batchsize=n sets the shadow-proxy region edge in cells;
// ?batchglass=1 also merges transparent materials (fewer draw calls, but glass is then sorted per batch)
const world = new World(scene, {
  batch: params.get('batch') === '0' ? false : {
    size: parseInt(params.get('batchsize'), 10) || undefined,
    batchTransparent: params.get('batchglass') === '1',
  },
});
const rig = new CameraRig(camera, renderer.domElement);
rig.drawMode = state.drawMode;
const effects = new Effects(scene);
world.batcher.effects = effects;                                 // tweening pieces stay unbatched
world.onRemount = (from, to) => effects.retarget(from, to);      // a rebuilt piece keeps its pop-in

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
    state.set({ level: 0, seeAll: true, hOffset: 0 });
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
  world.batcher.flush();     // starting content: bake on the next frames (no quiet period)
  // dev URL params (validated: a bad value is ignored rather than poisoning state)
  const tq = parseFloat(params.get('time'));
  if (Number.isFinite(tq)) state.set({ time: ((tq % 1) + 1) % 1 });
  const sq = params.get('season');
  if (['spring', 'summer', 'autumn', 'winter'].includes(sq)) state.set({ season: sq });
  if (params.get('level')) state.set({ level: Math.max(0, Math.min(MAX_LEVEL, parseInt(params.get('level'), 10) || 0)) });
  if (params.get('seeAll')) state.set({ seeAll: params.get('seeAll') === '1' });
  if (params.get('cam')) {
    const [th, ph, r, tx, ty, tz] = params.get('cam').split(',').map(Number);
    rig.setView({ t: [tx || 0, ty || 1, tz || 0], th, ph, r }, true);   // non-finite values: ignored by setView
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
  const all = cat === 'all';
  const defs = all ? catalog.allDefs() : catalog.piecesIn(cat);
  const pieces = [];
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  const put = (def, m, x, z) => {
    const p = { t: def.id, x, y: 0, z, m, r: 0, a: 'x', ...(def.showcase || {}) };
    if (def.layer === 'R') p.h = 0;
    pieces.push(p);
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
  };
  const ROWS = 10;                 // rows per block: z = -9 … 9 stays on the lot
  if (all) {
    // contact sheet: every piece once (default material), 10 per row, 2 cells apart, all on the lot
    // (the category showcases cover every material)
    defs.forEach((def, i) => put(def, def.mats?.[0], -9 + (i % ROWS) * 2, -9 + Math.floor(i / ROWS) * 2));
  } else {
    // rows = pieces, columns = materials, 2 cells apart from cell (-9, -9); a category with more than
    // ROWS pieces wraps into side-by-side blocks (centred on the lot when they don't fit from x = -9)
    const blocks = [];
    for (let b = 0; b < defs.length; b += ROWS) {
      const list = defs.slice(b, b + ROWS);
      blocks.push({ list, w: 2 * Math.max(...list.map((d) => (d.mats && d.mats.length) || 1)) });
    }
    const total = blocks.reduce((a, b) => a + b.w + 1, -1);
    let bx = total <= 19 ? -9 : -Math.floor(total / 2);
    for (const { list, w } of blocks) {
      list.forEach((def, r) => {
        const mats = def.mats && def.mats.length ? def.mats : [undefined];
        mats.forEach((m, i) => put(def, m, bx + i * 2, -9 + r * 2));
      });
      bx += w + 1;
    }
  }
  world.load({ pieces });
  state.set({ seeAll: true, level: 0 });
  app.showcase = { cat, rows: all ? Math.ceil(defs.length / ROWS) : defs.length, pieces: pieces.length };
  // frame the layout: the closest view (from the usual angle) that keeps every corner of its box on screen
  if (!pieces.length) return;
  const X0 = x0 * CELL, X1 = (x1 + 1) * CELL, Z0 = z0 * CELL, Z1 = (z1 + 1) * CELL;
  const t = [(X0 + X1) / 2, 1, (Z0 + Z1) / 2], v = new THREE.Vector3();
  for (let r = 14; ; r *= 1.05) {
    rig.setView({ t, th: 0.6, ph: 0.95, r }, true);
    let inside = true;
    for (let i = 0; i < 8 && inside; i++) {
      v.set(i & 1 ? X1 : X0, i & 2 ? 2.5 : 0, i & 4 ? Z1 : Z0).project(camera);
      inside = Math.abs(v.x) < 0.9 && Math.abs(v.y) < 0.94;   // tall pieces stick out of the box a little
    }
    if (inside || r >= rig.maxRadius) break;
  }
}

// ------------------------------------------------------------------ loop

function resize() {
  const w = container.clientWidth, h = container.clientHeight;
  const pr = pixelRatioFor();
  if (renderer.getPixelRatio() !== pr) renderer.setPixelRatio(pr);
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
window.visualViewport?.addEventListener('resize', resize);

state.on((changed) => {
  if (changed.includes('quality')) resize();
  if (changed.includes('shadows')) {
    renderer.shadowMap.enabled = state.shadows;
    scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
  }
});

let lastT = performance.now();
let fpsAcc = 0, fpsFrames = 0;
app.fps = 60;
function frame() {
  const now = performance.now();
  const dt = Math.min((now - lastT) / 1000, 0.1);
  lastT = now;
  rig.update(dt);
  effects.update(dt);
  try { app.env?.update?.(dt); } catch (e) { reportError('env.update', e); app.env.update = null; }
  try { app.audio?.update?.(dt); } catch (e) { reportError('audio.update', e); app.audio.update = null; }
  try { app.blueprints?.update?.(dt); } catch (e) { reportError('blueprints.update', e); app.blueprints.update = null; }
  try { app.ui?.update?.(dt); } catch (e) { reportError('ui.update', e); app.ui.update = null; }
  try { if (world.tick(dt)) renderer.shadowMap.needsUpdate = true; } catch (e) { reportError('world.tick', e); world.batcher.setEnabled(false); }
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
