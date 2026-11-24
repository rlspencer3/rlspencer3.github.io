// Hearthwood — Living Town: the device-level town save `hearthwood.town.v1` (docs/LIVING.md §12.9).
// fresh, sanitize (never throws), versioned load, guarded save, and the tiny unlock mirror `hearthwood.unlocks.v1`.
// localStorage is touched only behind `typeof localStorage !== 'undefined'` and try/catch, so this imports in Node.

import { KEYS, TUNE, JOBS, TRAITS, GIFTS, WISH_TEXT, WISH_SIZE } from './data.js';

// villager wish templates (the town-level camp wish is not one)
const TEMPLATE = Object.fromEntries(Object.keys(WISH_TEXT).filter((k) => k !== 'w_camp').map((k) => [k, { size: WISH_SIZE[k] || 'S' }]));

export const KEY = KEYS.town;
export const VERSION = 1;

const TIP_IDS = ['passerby', 'hearth', 'wish', 'flow', 'almost', 'vacancy', 'camp', 'intro', 'flowDefault'];
const ID_RE = /^v\d{1,4}$/;
const BED_RE = /^I\|-?\d{1,2}\|[0-4]\|-?\d{1,2}$/;
const CAMP_RE = /^v\d{1,4}\|I\|-?\d{1,2}\|[0-4]\|-?\d{1,2}$/;
const SIZES = ['S', 'M', 'L'];
const STATUSES = ['resident', 'waiting', 'camping'];
const MAX_NUM = 1e12;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
/** An own key of a lookup table: 'toString', '__proto__' or 'constructor' are never a known job, trait, gift or
 *  template (T1.12). */
const has = (o, k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);
const num = (v, d, lo = -MAX_NUM, hi = MAX_NUM) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const int = (v, d, lo, hi) => (Number.isInteger(v) ? Math.min(hi, Math.max(lo, v)) : d);
const str = (v, max) => (typeof v === 'string' && v.length <= max ? v : null);

/** A fresh town (§12.9). seed: uint32 (random when missing). */
export function freshTown(seed) {
  const s = Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff ? seed >>> 0 : (Math.random() * 0x100000000) >>> 0;
  return {
    v: VERSION, seed: s, clock: 0, lastSeen: 0, warmth: TUNE.WARMTH_START,
    stats: { granted: 0, arrivals: 0, gifts: 0 }, nextId: 1,
    unlocks: {}, seen: [], tips: {}, muted: [], campGrants: [], villagers: [], traveller: null,
  };
}

/** A packed footprint 'x,z;…' with ≤ 400 cells in −11..10, else null. */
function cleanFoot(f) {
  if (typeof f !== 'string' || f.length > 4000) return null;
  if (f === '') return null;
  const parts = f.split(';');
  if (parts.length > 400) return null;
  for (const p of parts) {
    const m = /^(-?\d{1,2}),(-?\d{1,2})$/.exec(p);
    if (!m) return null;
    const x = +m[1], z = +m[2];
    if (x < -11 || x > 10 || z < -11 || z > 10) return null;
  }
  return f;
}

function cleanLook(l) {
  const def = [0, 0, 0, 0];
  if (!Array.isArray(l) || l.length !== 4) return def;
  const lim = [2, 5, 5, 2];
  return l.map((v, k) => int(v, 0, 0, lim[k]));
}

function cleanWish(w) {
  if (!isObj(w)) return null;
  if (!has(TEMPLATE, w.tpl)) return null;
  const out = {
    tpl: w.tpl, born: num(w.born, 0, 0), size: SIZES.includes(w.size) ? w.size : TEMPLATE[w.tpl].size,
    dream: w.dream === true, base: w.base === null || w.base === undefined ? null : num(w.base, null, -1e6, 1e6),
    friend: typeof w.friend === 'string' && ID_RE.test(w.friend) ? w.friend : null, frozen: null,
  };
  if (isObj(w.frozen)) {
    const fr = {};
    if (Array.isArray(w.frozen.route)) {
      const r = w.frozen.route.slice(0, 64).filter((c) => Array.isArray(c) && c.length === 2 && Number.isInteger(c[0]) && Number.isInteger(c[1]) && c[0] >= -11 && c[0] <= 10 && c[1] >= -11 && c[1] <= 10).map((c) => [c[0], c[1]]);
      fr.route = r;
    }
    if (isObj(w.frozen.area) && Number.isInteger(w.frozen.area.x0) && Number.isInteger(w.frozen.area.z0)
      && w.frozen.area.x0 >= -10 && w.frozen.area.x0 <= 4 && w.frozen.area.z0 >= -10 && w.frozen.area.z0 <= 4) fr.area = { x0: w.frozen.area.x0, z0: w.frozen.area.z0 };
    if (Object.keys(fr).length) out.frozen = fr;
  }
  return out;
}

function cleanVillager(o) {
  if (!isObj(o)) return null;
  if (typeof o.id !== 'string' || !ID_RE.test(o.id)) return null;
  const name = str(o.name, 24);
  if (!name || !name.trim()) return null;
  if (!has(JOBS, o.job) || !has(TRAITS, o.trait)) return null;
  const v = {
    id: o.id, name, job: o.job, trait: o.trait, look: cleanLook(o.look), voice: num(o.voice, 1, 0.85, 1.25),
    seed: int(o.seed, 1, 0, 0xffffffff), status: STATUSES.includes(o.status) ? o.status : 'camping', home: null,
    since: num(o.since, 0, 0), arrived: num(o.arrived, 0, 0), grants: int(o.grants, 0, 0, 1e6), wish: cleanWish(o.wish),
    nextWishAt: num(o.nextWishAt, 0, 0), recent: [], cool: {},
  };
  if (isObj(o.home)) {
    const feet = Array.isArray(o.home.feet) ? o.home.feet.map(cleanFoot).filter(Boolean).slice(0, TUNE.FEET_KEPT) : [];
    const bed = typeof o.home.bed === 'string' && BED_RE.test(o.home.bed) ? o.home.bed : null;
    if (feet.length || bed) v.home = { feet, bed };
  }
  if (Array.isArray(o.recent)) v.recent = o.recent.filter((t) => has(TEMPLATE, t)).slice(-5);
  if (isObj(o.cool)) {
    const es = Object.entries(o.cool).filter(([k, t]) => has(TEMPLATE, k) && typeof t === 'number' && Number.isFinite(t)).slice(0, 10);
    for (const [k, t] of es) v.cool[k] = num(t, 0, 0);
  }
  return v;
}

function cleanTraveller(t) {
  if (!isObj(t)) return null;
  const name = str(t.name, 24);
  if (!name || !has(JOBS, t.job) || !has(TRAITS, t.trait)) return null;
  return {
    job: t.job, name, trait: t.trait, look: cleanLook(t.look), voice: num(t.voice, 1, 0.85, 1.25),
    seed: int(t.seed, 1, 0, 0xffffffff), foot: cleanFoot(t.foot), due: t.due === null ? null : num(t.due, null, 0),
  };
}

function cleanUnlocks(u) {
  const out = {};
  if (!isObj(u)) return out;
  for (const [id, x] of Object.entries(u)) {
    if (!has(GIFTS, id)) continue;
    const e = isObj(x) ? x : {};
    out[id] = { at: num(e.at, 0, 0), from: str(e.from, 24) || '', job: has(JOBS, e.job) ? e.job : (GIFTS[id].job || null) };
  }
  return out;
}
const cleanSeen = (s) => (Array.isArray(s) ? [...new Set(s.filter((id) => has(GIFTS, id)))] : []);

/** Sanitize anything into a valid TownSave (§12.9). Never throws. */
export function sanitizeTown(obj) {
  try {
    if (typeof obj === 'string') { try { obj = JSON.parse(obj); } catch { obj = null; } }
    if (!isObj(obj)) return freshTown();
    const out = freshTown(int(obj.seed, undefined, 0, 0xffffffff));
    out.v = VERSION;                                   // the sanitized object is a v1 save; loadTown reports newer ones read-only
    out.clock = num(obj.clock, 0, 0, 1e10);
    out.lastSeen = num(obj.lastSeen, 0, 0, 1e15);
    out.warmth = num(obj.warmth, TUNE.WARMTH_START, 0, TUNE.WARMTH_MAX);
    if (isObj(obj.stats)) out.stats = { granted: int(obj.stats.granted, 0, 0, 1e6), arrivals: int(obj.stats.arrivals, 0, 0, 1e6), gifts: int(obj.stats.gifts, 0, 0, 1e6) };
    out.unlocks = cleanUnlocks(obj.unlocks);
    out.seen = cleanSeen(obj.seen);
    if (isObj(obj.tips)) for (const k of TIP_IDS) if (obj.tips[k]) out.tips[k] = 1;
    if (Array.isArray(obj.muted)) out.muted = [...new Set(obj.muted.map(cleanFoot).filter(Boolean))].slice(0, TUNE.MUTED_MAX);
    if (Array.isArray(obj.campGrants)) out.campGrants = [...new Set(obj.campGrants.filter((s) => typeof s === 'string' && CAMP_RE.test(s)))].slice(0, TUNE.CAMP_GRANTS_MAX);
    const seen = new Set();
    let maxId = 0;
    if (Array.isArray(obj.villagers)) {
      for (const o of obj.villagers) {
        if (out.villagers.length >= TUNE.MAX_VILLAGERS) break;
        const v = cleanVillager(o);
        if (!v || seen.has(v.id)) continue;
        seen.add(v.id);
        maxId = Math.max(maxId, +v.id.slice(1));
        out.villagers.push(v);
      }
    }
    out.nextId = Math.max(int(obj.nextId, 1, 1, 99999), maxId + 1);
    out.traveller = cleanTraveller(obj.traveller);
    return out;
  } catch {
    return freshTown();
  }
}

/** Version chain for later phases (v1 → v2 …). A save newer than VERSION is loaded as far as it's understood. */
function migrate(obj) {
  return obj;
}

const hasLS = () => {
  try { return typeof localStorage !== 'undefined' && localStorage !== null; } catch { return false; }
};

/** → { save, readOnly, fresh } (§12.9). A newer-version save loads read-only; non-JSON gives a fresh town but salvages unlocks / seen. */
export function loadTown() {
  let raw = null;
  if (hasLS()) { try { raw = localStorage.getItem(KEY); } catch { raw = null; } }
  if (raw === null || raw === undefined) {
    const save = freshTown();
    salvageMirror(save);
    return { save, readOnly: false, fresh: true };
  }
  let obj = null;
  try { obj = JSON.parse(raw); } catch { obj = null; }
  if (!isObj(obj)) {
    const save = freshTown();
    // salvage unlocks / seen from a broken string where possible
    try {
      const mU = /"unlocks"\s*:\s*(\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\})/.exec(String(raw));
      if (mU) save.unlocks = cleanUnlocks(JSON.parse(mU[1]));
    } catch { /* nothing to salvage */ }
    try {
      const mS = /"seen"\s*:\s*(\[[^\]]*\])/.exec(String(raw));
      if (mS) save.seen = cleanSeen(JSON.parse(mS[1]));
    } catch { /* nothing to salvage */ }
    salvageMirror(save);
    return { save, readOnly: false, fresh: true };
  }
  const v = Number.isInteger(obj.v) ? obj.v : 1;
  const save = sanitizeTown(migrate(obj));
  salvageMirror(save);
  return { save, readOnly: v > VERSION, fresh: false };
}

function salvageMirror(save) {
  // gifts unlocked through the tiny mirror key (e.g. the town save failed to write) count as unlocked
  if (!hasLS()) return;
  try {
    const arr = JSON.parse(localStorage.getItem(KEYS.unlocks) || '[]');
    if (Array.isArray(arr)) for (const id of arr) if (has(GIFTS, id) && !has(save.unlocks, id)) save.unlocks[id] = { at: 0, from: '', job: GIFTS[id].job || null };
  } catch { /* ignore */ }
}

let warned = false;
/** Write the town save; onFail is called once per session on the first failed write. → true on success. */
export function saveTown(save, onFail) {
  if (!hasLS()) return false;
  try {
    const out = { ...save, v: VERSION, lastSeen: Date.now() };
    if (save && typeof save === 'object') save.lastSeen = out.lastSeen;
    localStorage.setItem(KEY, JSON.stringify(out));
    return true;
  } catch {
    if (!warned) { warned = true; try { onFail?.(); } catch { /* ignore */ } }
    return false;
  }
}

/** Add a gift id to the tiny unlock mirror key (written first, before the town save, §8.3). */
export function saveUnlock(id) {
  if (!has(GIFTS, id) || !hasLS()) return false;
  try {
    let arr = [];
    try { arr = JSON.parse(localStorage.getItem(KEYS.unlocks) || '[]'); } catch { arr = []; }
    if (!Array.isArray(arr)) arr = [];
    arr = arr.filter((x) => has(GIFTS, x));
    if (!arr.includes(id)) arr.push(id);
    localStorage.setItem(KEYS.unlocks, JSON.stringify(arr));
    return true;
  } catch {
    return false;
  }
}
