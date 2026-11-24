// Tiny observable app state shared by UI, builder, environment and audio.
// state.set({...}) merges and emits 'change' with the list of changed keys.

const listeners = new Set();

const SETTINGS_KEY = 'hearthwood.settings.v1';

const defaults = {
  tool: 'build',        // 'build' | 'erase' | 'paint' | 'pick'
  pieceId: 'foundation',
  category: 'base',
  level: 0,             // active build level (0..MAX_LEVEL)
  rot: 0,               // rotation for cell pieces (0..3); edge pieces use 0|2 (flip)
  hOffset: 0,           // manual roof height nudge in half steps (added to auto height)
  drawMode: false,      // false: one-finger drag orbits; true: one-finger drag paints pieces
  seeAll: true,         // show levels above the active one (stepping down a level turns this off = cutaway)
  // Remembered material / colours, keyed by def.matGroup (e.g. 'wall', 'roof')
  mats: {},
  colors: {},
  accent: '#7a4b3a',    // accent colour for doors, shutters, window frames
  paintMat: null,       // paint tool: material to apply (null = keep)
  paintTarget: 'main',  // paint tool: 'main' colour/material or 'accent' colour
  paintColor: null,     // paint tool: colour to apply (null = keep)
  // Environment & settings (persisted)
  time: 0.42,           // 0..1 day cycle (0.25 sunrise, 0.5 noon, 0.75 sunset, 0/1 midnight)
  timeFlow: true,       // let the day pass by itself (on by default, so village life can be watched: LIVING.md §0.4)
  season: 'summer',     // 'spring' | 'summer' | 'autumn' | 'winter'
  weather: 'clear',     // 'clear' | 'rain' | 'snow' | 'leaves'
  sound: true,
  music: true,
  village: true,        // villagers & wishes (js/town/); off = a quiet build-only meadow, nothing is lost
  chatter: true,        // villagers' ambient babble (its own switch: the sound most likely to annoy)
  shadows: true,
  quality: 'auto',      // 'low' | 'high' | 'auto'
  photoMode: false,
  blueprint: null,      // active blueprint id when in guided mode
  slot: 1,              // current save slot
};

const PERSIST = ['time', 'timeFlow', 'season', 'weather', 'sound', 'music', 'shadows', 'quality', 'mats', 'colors', 'accent', 'slot', 'village', 'chatter'];

// Saved settings are checked before use: an old version, a hand-edited value or a NaN written by a bad
// URL parameter must never reach the game (a null `mats` would break every placement).
const ENUMS = {
  season: ['spring', 'summer', 'autumn', 'winter'],
  weather: ['clear', 'rain', 'snow', 'leaves'],
  quality: ['low', 'high', 'auto'],
};
const COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;
const ID_RE = /^[A-Za-z0-9_-]{1,48}$/;
const isMap = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
/** Keep only string → string entries whose values pass `ok`. */
function cleanMap(v, ok) {
  const out = {};
  for (const [k, x] of Object.entries(v)) if (typeof x === 'string' && ok(x) && k.length <= 48) out[k] = x;
  return out;
}
function cleanSetting(k, v) {
  if (ENUMS[k]) return ENUMS[k].includes(v) ? v : undefined;
  switch (k) {
    case 'time': return typeof v === 'number' && Number.isFinite(v) ? ((v % 1) + 1) % 1 : undefined;
    case 'slot': return Number.isInteger(v) && v >= 1 && v <= 99 ? v : undefined;
    case 'accent': return typeof v === 'string' && COLOR_RE.test(v) ? v : undefined;
    case 'mats': return isMap(v) ? cleanMap(v, (x) => ID_RE.test(x)) : undefined;
    case 'colors': return isMap(v) ? cleanMap(v, (x) => COLOR_RE.test(x)) : undefined;
    default: return typeof v === typeof defaults[k] ? v : undefined;
  }
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    if (!isMap(obj)) return {};
    const out = {};
    for (const k of PERSIST) {
      if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
      const v = cleanSetting(k, obj[k]);
      if (v !== undefined) out[k] = v;
    }
    return out;
  } catch { return {}; }
}

// Settings are written at most every SAVE_MS (time flow and the time slider change `time` many times a
// second; localStorage writes are synchronous) and flushed when the page is hidden or closed.
const SAVE_MS = 600;
let saveTimer = 0;

export const state = {
  ...defaults,
  ...loadSettings(),

  set(patch) {
    const changed = [];
    for (const [k, v] of Object.entries(patch)) {
      if (typeof this[k] === 'function') continue;
      if (this[k] !== v) { this[k] = v; changed.push(k); }
    }
    if (!changed.length) return;
    if (!saveTimer && changed.some((k) => PERSIST.includes(k))) saveTimer = setTimeout(() => this.save(), SAVE_MS);
    for (const fn of listeners) {
      try { fn(changed, this); } catch (e) { console.error(e); }
    }
  },

  // Subscribe to changes. Returns an unsubscribe function.
  on(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  /** Write the persisted settings now (normally debounced automatically after set()). */
  save() {
    clearTimeout(saveTimer);
    saveTimer = 0;
    try {
      const obj = {};
      for (const k of PERSIST) obj[k] = this[k];
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(obj));
    } catch { /* storage may be unavailable */ }
  },
};

if (typeof window !== 'undefined') {
  const flush = () => { if (saveTimer) state.save(); };
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
}

// Lightweight global event bus for one-off notifications
// (e.g. 'placed', 'removed', 'toast', 'blueprint-progress').
const bus = new EventTarget();
export const events = {
  emit(type, detail) { bus.dispatchEvent(new CustomEvent(type, { detail })); },
  on(type, fn) {
    const h = (e) => fn(e.detail);
    bus.addEventListener(type, h);
    return () => bus.removeEventListener(type, h);
  },
};
