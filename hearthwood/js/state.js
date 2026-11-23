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
  timeFlow: false,      // let the day pass by itself
  season: 'summer',     // 'spring' | 'summer' | 'autumn' | 'winter'
  weather: 'clear',     // 'clear' | 'rain' | 'snow' | 'leaves'
  sound: true,
  music: true,
  shadows: true,
  quality: 'auto',      // 'low' | 'high' | 'auto'
  photoMode: false,
  blueprint: null,      // active blueprint id when in guided mode
  slot: 1,              // current save slot
};

const PERSIST = ['time', 'timeFlow', 'season', 'weather', 'sound', 'music', 'shadows', 'quality', 'mats', 'colors', 'accent', 'slot'];

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    const out = {};
    for (const k of PERSIST) if (k in obj) out[k] = obj[k];
    return out;
  } catch { return {}; }
}

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
    if (changed.some((k) => PERSIST.includes(k))) this.save();
    for (const fn of listeners) {
      try { fn(changed, this); } catch (e) { console.error(e); }
    }
  },

  // Subscribe to changes. Returns an unsubscribe function.
  on(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  save() {
    try {
      const obj = {};
      for (const k of PERSIST) obj[k] = this[k];
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(obj));
    } catch { /* storage may be unavailable */ }
  },
};

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
