// Hearthwood — bootstrap. Creates the renderer, world and controllers, then loads
// the feature modules (pieces, environment, audio, UI, blueprints). Feature modules are
// loaded with dynamic import so one failing module never blanks the whole game.

import * as THREE from 'three';
import { CELL, LEVEL_H, STEP, levelY, MAX_LEVEL, clamp } from './config.js';
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

/** Dev URL params, validated: a missing or malformed value gives undefined (and is then ignored). */
const NUM_RE = /^\s*-?(?:\d+\.?\d*|\.\d+)\s*$/;
function numParam(name) {
  const s = params.get(name);
  return s !== null && NUM_RE.test(s) ? Number(s) : undefined;
}
function intParam(name, lo = -Infinity, hi = Infinity) {
  const n = numParam(name);
  return Number.isInteger(n) && n >= lo && n <= hi ? n : undefined;
}

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

// ?batch=0 turns static batching off (A/B checks); ?batchsize=n (1..20) sets the shadow-proxy region edge in
// cells; ?batchglass=1 also merges transparent materials (fewer draw calls, but glass is then sorted per batch)
const world = new World(scene, {
  batch: params.get('batch') === '0' ? false : {
    size: intParam('batchsize', 1, 20),
    batchTransparent: params.get('batchglass') === '1',
  },
});
// phones keep fewer unused piece templates (undo / repaint / ghost looks) around: less memory in long sessions
if (MOBILE) world.maxIdleTemplates = lowEnd ? 60 : 80;
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
  /** Load build data (pieces) and its camera view; data without one (share codes) gets a view framing the build. */
  loadBuild(data, { record = false } = {}) {
    const n = world.load(data, { record });
    state.set({ level: 0, seeAll: true, hOffset: 0 });
    const view = data?.cam || frameView();
    if (view) rig.setView(view);
    return n;
  },
  newBuild() {
    world.clear({ record: true });
  },
};
window.__hw = app;

/**
 * A view of the build (its house: garden scenery is left out when there is anything else) from the usual
 * three-quarter angle, as close as keeps its grid box inside the part of the screen the UI leaves free.
 * null when the lot is empty.
 */
function frameView() {
  let all = null, house = null;
  const grow = (b, x0, x1, z0, z1, y1) => {
    if (!b) return { x0, x1, z0, z1, y1 };
    b.x0 = Math.min(b.x0, x0); b.x1 = Math.max(b.x1, x1); b.z0 = Math.min(b.z0, z0); b.z1 = Math.max(b.z1, z1);
    b.y1 = Math.max(b.y1, y1);
    return b;
  };
  for (const { p, def } of world.entries.values()) {
    const x0 = p.x * CELL, z0 = p.z * CELL;
    const x1 = x0 + (def.slot === 'cell' || (def.slot === 'edge' && p.a !== 'z') ? CELL : 0);
    const z1 = z0 + (def.slot === 'cell' || (def.slot === 'edge' && p.a === 'z') ? CELL : 0);
    const rise = def.roof ? def.roof.rise || 0 : p.s || 0;                 // roofs and gables reach higher
    const y1 = levelY(p.y) + Math.max(LEVEL_H, ((p.h || 0) + rise) * STEP);
    all = grow(all, x0, x1, z0, z1, y1);
    if (def.cat !== 'garden') house = grow(house, x0, x1, z0, z1, y1);
  }
  const b = house || all;
  if (!b) return null;
  const T = new THREE.Vector3((b.x0 + b.x1) / 2, clamp(b.y1 * 0.4, 1, 6), (b.z0 + b.z1) / 2);
  // look at the front (+Z, as the blueprints do), turning the short way round from the current view
  const TAU = Math.PI * 2;
  const th = 0.55 + TAU * Math.round((rig.goal.theta - 0.55) / TAU), ph = 1.1;
  // the screen area the UI leaves free, in NDC of the camera without the rig's view offset (camera.js shifts
  // the view so the target sits in the middle of that area), less a small margin
  const w = renderer.domElement.clientWidth || 1, h = renderer.domElement.clientHeight || 1;
  const I = rig.insets || { top: 0, bottom: 0, left: 0, right: 0 };
  const oy = clamp((I.bottom - I.top) / 2, -h * 0.25, h * 0.25), ox = clamp((I.right - I.left) / 2, -w * 0.15, w * 0.15);
  let yHi = 1 - (2 * (I.top + oy)) / h, yLo = -1 + (2 * (I.bottom - oy)) / h;
  let xHi = 1 - (2 * (I.right - ox)) / w, xLo = -1 + (2 * (I.left + ox)) / w;
  const my = (yHi - yLo) * 0.06, mx = (xHi - xLo) * 0.06;
  yHi -= my; yLo += my; xHi -= mx; xLo += mx;
  const cam = camera.clone();
  cam.clearViewOffset();
  const v = new THREE.Vector3(), sp = Math.sin(ph);
  let r = rig.minRadius;
  for (; r < rig.maxRadius; r *= 1.05) {
    cam.position.set(T.x + r * sp * Math.sin(th), Math.max(0.6, T.y + r * Math.cos(ph)), T.z + r * sp * Math.cos(th));
    cam.lookAt(T);
    cam.updateMatrixWorld();
    let inside = true;
    for (let i = 0; i < 8 && inside; i++) {
      v.set(i & 1 ? b.x1 : b.x0, i & 2 ? b.y1 : 0, i & 4 ? b.z1 : b.z0).project(cam);
      inside = v.z < 1 && v.x > xLo && v.x < xHi && v.y > yLo && v.y < yHi;
    }
    if (inside) break;
  }
  return { t: [T.x, T.y, T.z], th, ph, r };
}

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
  let restored = false;      // the autosave was loaded
  if (showcase) buildShowcase(showcase);
  else if (bp && app.blueprints?.stamp) {
    app.blueprints.stamp(bp, { animate: false, record: false });
  } else if (params.get('clean') !== '1') {
    const saved = storage.loadAutosave();
    if (saved?.pieces?.length) { app.loadBuild(saved); restored = true; }
    else if (app.blueprints?.welcome) app.blueprints.welcome();
  }
  world.batcher.flush();     // starting content: bake on the next frames (no quiet period)
  // dev URL params (validated: a malformed value is ignored rather than poisoning state)
  const tq = numParam('time');
  if (tq !== undefined) state.set({ time: ((tq % 1) + 1) % 1 });
  const sq = params.get('season');
  if (['spring', 'summer', 'autumn', 'winter'].includes(sq)) state.set({ season: sq });
  const lq = intParam('level');
  if (lq !== undefined) state.set({ level: clamp(lq, 0, MAX_LEVEL) });
  if (params.get('seeAll')) state.set({ seeAll: params.get('seeAll') === '1' });
  if (params.get('cam')) {
    // theta,phi,radius[,tx,ty,tz]: a malformed view is ignored by setView (and clamped to the rig's limits)
    const c = params.get('cam').split(',').map((s) => (NUM_RE.test(s) ? Number(s) : NaN));
    const or = (n, d) => (Number.isFinite(n) ? n : d);
    rig.setView({ t: [or(c[3], 0), or(c[4], 1), or(c[5], 0)], th: c[0], ph: c[1], r: c[2] }, true);
  }
  rig.snap();

  // autosave: debounced after world changes, and flushed (with the camera view) when the page is hidden or
  // closed, so a piece placed just before the player leaves, or a new look at the house, is never lost
  if (!showcase && params.get('nosave') !== '1') {
    let saveTimer = null;
    let savedView = restored ? JSON.stringify(rig.getView()) : null;   // view in the stored autosave
    const saveNow = () => {
      clearTimeout(saveTimer);
      saveTimer = null;
      try {
        const view = rig.getView();
        if (storage.autosave(world.serialize(), view)) savedView = JSON.stringify(view);   // storage full / blocked: warned once
      } catch (e) { reportError('autosave', e); }
    };
    events.on('world-change', () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(saveNow, 800);
    });
    // a camera-only change is written too, but only over an autosave of this build (never over the first-visit lot)
    const flush = () => { if (saveTimer !== null || (savedView !== null && JSON.stringify(rig.getView()) !== savedView)) saveNow(); };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  }

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
  // frame the layout: the closest view that keeps every corner of its box on screen — from the usual angle, else
  // a little higher up (uses a tall portrait screen) or squarer on (the box's width instead of its diagonal); a
  // layout still too wide for a narrow phone lets this dev page zoom out further than play allows (a top-down view
  // would fit sooner but hide the pieces' faces)
  if (!pieces.length) return;
  const X0 = x0 * CELL, X1 = (x1 + 1) * CELL, Z0 = z0 * CELL, Z1 = (z1 + 1) * CELL;
  const t = [(X0 + X1) / 2, 1, (Z0 + Z1) / 2], v = new THREE.Vector3();
  const fits = (th, ph, r) => {
    rig.setView({ t, th, ph, r }, true);
    for (let i = 0; i < 8; i++) {
      v.set(i & 1 ? X1 : X0, i & 2 ? 2.5 : 0, i & 4 ? Z1 : Z0).project(camera);
      if (Math.abs(v.x) >= 0.9 || Math.abs(v.y) >= 0.94) return false;   // tall pieces stick out of the box a little
    }
    return true;
  };
  const closest = (th, ph) => {
    for (let r = 14; r < rig.maxRadius * 1.05; r *= 1.05) if (fits(th, ph, Math.min(r, rig.maxRadius))) return true;
    return false;
  };
  if (closest(0.6, 0.95) || closest(0.6, 0.78) || closest(0.25, 0.85)) return;
  rig.maxRadius = Math.max(rig.maxRadius, 150);
  closest(0.25, 0.85);
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
