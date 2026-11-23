// Saving & loading builds (localStorage) plus shareable build codes.
//
// Everything read back (autosave, slots, pasted codes) goes through sanitize(): any JSON value is
// accepted and turned into { pieces: [clean records…], …meta } or null, never throws, never returns
// more than MAX_PIECES records, and only keeps well-typed fields (see ARCHITECTURE.md "Piece records").
// Codes are decoded with a hard output cap (no decompression bombs) and a small pure-JS inflate, so
// they open on every browser (CompressionStream 'deflate-raw' is only used to MAKE codes, when present).

import { GRID_MIN, GRID_MAX, MAX_LEVEL } from './config.js';
import { getDef, allDefs } from './catalog.js';
import { events } from './state.js';

const AUTO = 'hearthwood.autosave.v1';
const SLOT = (n) => `hearthwood.slot.${n}.v1`;
export const SLOT_COUNT = 6;
/**
 * Most pieces a save / code may hold: the number of distinct slots on the lot (F, I, D per cell and level;
 * W, B per edge and level; P per vertex and level; R per cell and roof half-step 0..2 * MAX_LEVEL + MAX_H) = 25 005.
 * A real build can never exceed it, so the cap only ever trims junk (duplicates are pointless: one piece per slot).
 */
const N_ = GRID_MAX - GRID_MIN + 1, L_ = MAX_LEVEL + 1;
// highest roof / gable h a record may carry: a roof over the top floor's walls is y = MAX_LEVEL lifted a storey
// (h = 2 + its rows), so world.validate accepts roof bases up to hs = 2 * MAX_LEVEL + MAX_H
const MAX_H = 12;
export const MAX_PIECES = 3 * N_ * N_ * L_ + 4 * N_ * (N_ + 1) * L_ + (N_ + 1) * (N_ + 1) * L_ + N_ * N_ * (2 * MAX_LEVEL + MAX_H + 1);
const MAX_CODE_CHARS = 4_000_000;          // longer pastes are not build codes
const MAX_JSON_BYTES = 8 * 1024 * 1024;    // decoded JSON cap (a full lot is ≈ 1.5 MB)

const warned = new Set();
function safeGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function safeSet(k, v) {
  try { localStorage.setItem(k, v); return true; } catch (e) {
    if (!warned.has(k)) {
      warned.add(k);
      console.warn('save failed', k, e?.name || e);
      // tell the player once that autosave isn't working (storage full / blocked) instead of losing work silently
      if (k === AUTO) events.emit('toast', { text: '⚠️ Can’t autosave — this browser’s storage is full or blocked. Save a share code to keep your home.', kind: 'warn', ms: 6000 });
    }
    return false;
  }
}
function safeParse(raw) {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

// ------------------------------------------------------------------ validation

const ID_RE = /^[A-Za-z0-9_-]{1,48}$/;
const COLOR_RE = /^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
/** Integer in [lo, hi] (numbers or numeric strings), else null. */
function int(v, lo, hi) {
  const n = typeof v === 'number' ? v : (typeof v === 'string' && /^\s*-?\d+\s*$/.test(v) ? Number(v) : NaN);
  return Number.isInteger(n) && n >= lo && n <= hi ? n : null;
}
const num = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : null);

/**
 * One piece record → a clean copy (only known, well-typed fields) or null. Coordinates must lie on the
 * lot (edges / corners may sit on the far boundary line), levels in 0..MAX_LEVEL. Unknown piece types are
 * kept (world.normalize skips them) so a save made with a piece module that failed to load survives.
 */
export function sanitizeRecord(rec) {
  if (!isObj(rec) || typeof rec.t !== 'string' || !ID_RE.test(rec.t)) return null;
  const def = getDef(rec.t);
  const hiXZ = def && def.slot === 'cell' ? GRID_MAX : GRID_MAX + 1;
  const x = int(rec.x, GRID_MIN, hiXZ), z = int(rec.z, GRID_MIN, hiXZ), y = int(rec.y ?? 0, 0, MAX_LEVEL);
  if (x === null || z === null || y === null) return null;
  const o = { t: rec.t, x, y, z };
  if (rec.a === 'x' || rec.a === 'z') o.a = rec.a;
  const r = int(rec.r, 0, 3); if (r) o.r = r;
  const h = int(rec.h, 0, MAX_H); if (h) o.h = h;
  const s = int(rec.s, 1, 2); if (s) o.s = s;
  if (typeof rec.m === 'string' && ID_RE.test(rec.m)) o.m = rec.m;
  if (typeof rec.c === 'string' && COLOR_RE.test(rec.c)) o.c = rec.c;
  if (typeof rec.k === 'string' && COLOR_RE.test(rec.k)) o.k = rec.k;
  return o;
}

/** A saved camera view { t: [x, y, z], th, ph, r } with finite, sane numbers — else null. */
export function sanitizeCam(cam) {
  if (!isObj(cam) || !Array.isArray(cam.t) || cam.t.length < 3) return null;
  // ranges match what the camera rig itself allows (target on the lot, phi above the ground)
  const t = [num(cam.t[0], -40, 40), num(cam.t[1], 0, 30), num(cam.t[2], -40, 40)];
  const th = typeof cam.th === 'number' && Number.isFinite(cam.th) ? cam.th % (Math.PI * 2) : null, ph = num(cam.ph, 0.1, 1.5), r = num(cam.r, 3, 120);
  if (t.includes(null) || th === null || ph === null || r === null) return null;
  return { t, th, ph, r };
}

/**
 * Any parsed value → { pieces, …meta } with clean records (at most MAX_PIECES), or null when it is not a
 * build at all. An array is taken as a bare piece list. Keeps name, thumb, date, cam (validated), app, v.
 * `dropped` counts records that were thrown away (bad / over the cap) so callers can tell the player.
 */
export function sanitize(data) {
  try {
    if (Array.isArray(data)) data = { pieces: data };
    if (!isObj(data) || !Array.isArray(data.pieces)) return null;
    const pieces = [];
    let dropped = 0;
    const list = data.pieces;
    for (let i = 0; i < list.length; i++) {
      if (pieces.length >= MAX_PIECES) { dropped += list.length - i; break; }
      const p = sanitizeRecord(list[i]);
      if (p) pieces.push(p); else dropped++;
    }
    const out = { app: 'hearthwood', v: int(data.v, 0, 1e6) ?? 1, pieces };
    if (typeof data.name === 'string') out.name = data.name.slice(0, 80);
    if (typeof data.thumb === 'string' && data.thumb.startsWith('data:image/') && data.thumb.length < 2_000_000) out.thumb = data.thumb;
    const date = num(data.date, 0, 1e15); if (date !== null) out.date = date;
    const cam = sanitizeCam(data.cam); if (cam) out.cam = cam;
    if (dropped) out.dropped = dropped;
    return out;
  } catch (e) {
    console.warn('bad build data', e);
    return null;
  }
}

// ------------------------------------------------------------------ storage

export const storage = {
  MAX_PIECES,
  sanitize,

  autosave(data, camView = null) {
    return safeSet(AUTO, JSON.stringify({ ...data, cam: camView, date: Date.now() }));
  },
  loadAutosave() { return sanitize(safeParse(safeGet(AUTO))); },
  clearAutosave() { try { localStorage.removeItem(AUTO); } catch { /* ignore */ } },

  /** Save to a numbered slot (1..SLOT_COUNT). meta: { name, thumb (dataURL), cam } */
  saveSlot(n, data, meta = {}) {
    const rec = { ...data, name: meta.name || `House ${n}`, thumb: meta.thumb || null, cam: meta.cam || null, date: Date.now() };
    let ok = safeSet(SLOT(n), JSON.stringify(rec));
    if (!ok && rec.thumb) { rec.thumb = null; ok = safeSet(SLOT(n), JSON.stringify(rec)); }
    return ok;
  },
  loadSlot(n) { return sanitize(safeParse(safeGet(SLOT(n)))); },
  deleteSlot(n) { try { localStorage.removeItem(SLOT(n)); } catch { /* ignore */ } },
  /** [{ n, empty, name, date, count, thumb }] */
  listSlots() {
    const out = [];
    for (let n = 1; n <= SLOT_COUNT; n++) {
      const d = this.loadSlot(n);
      out.push(d ? { n, empty: false, name: d.name, date: d.date, count: d.pieces.length, thumb: d.thumb } : { n, empty: true });
    }
    return out;
  },

  /** Encode a build as a compact shareable text code ('HW1:' deflate-raw + base64url, else 'HW0:' plain). */
  async exportCode(data) {
    const json = JSON.stringify({ app: 'hearthwood', v: 1, pieces: data.pieces });
    try {
      if (typeof CompressionStream !== 'undefined') {
        const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('deflate-raw'));
        const buf = new Uint8Array(await new Response(stream).arrayBuffer());
        // never hand out a code this game can't read back
        if (new TextDecoder().decode(inflateRaw(buf, MAX_JSON_BYTES)) === json) return 'HW1:' + b64(buf);
      }
    } catch { /* fall through */ }
    return 'HW0:' + b64(new TextEncoder().encode(json));
  },

  /**
   * Decode a build code (or raw JSON). Tolerates text around the code (e.g. a pasted chat message) and
   * line breaks inside it. Resolves to sanitized data with at least one piece (see sanitize), or null for
   * anything that holds no home (garbage, an empty build); never rejects.
   */
  async importCode(code) {
    try {
      if (typeof code !== 'string' || code.length > MAX_CODE_CHARS) return null;
      code = code.trim();
      // pieces this game doesn't know are dropped (a code from a newer version still opens), and a code
      // with no usable pieces at all (an empty list, or every piece rejected) is not a build: never replace
      // the player's home with nothing
      const ok = (d) => {
        if (!d) return null;
        if (allDefs().length) {
          const n = d.pieces.length;
          d.pieces = d.pieces.filter((p) => getDef(p.t));
          if (d.pieces.length < n) d.dropped = (d.dropped || 0) + n - d.pieces.length;
        }
        return d.pieces.length ? d : null;
      };
      if (code.startsWith('{') || code.startsWith('[')) return ok(sanitize(JSON.parse(code)));
      // the code may have been wrapped onto several lines; text may follow it on later lines
      const m = /HW([01]):\s*([A-Za-z0-9_\-+/=]+(?:[ \t]*\r?\n[ \t]*[A-Za-z0-9_\-+/=]+)*)/.exec(code);
      if (!m) return null;
      const lines = m[2].split(/\s+/);
      let err = null;
      for (let n = lines.length; n >= 1 && n > lines.length - 3; n--) {
        try { return ok(sanitize(JSON.parse(await decodeBody(m[1], lines.slice(0, n).join(''))))); } catch (e) { err = e; }
      }
      throw err;
    } catch (e) { console.warn('bad code', e?.message || e); }
    return null;
  },
};

function b64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64(str) {
  const s = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** Body of an 'HW0:' / 'HW1:' code → JSON text (throws when it isn't one). */
async function decodeBody(kind, body) {
  const bytes = unb64(body);
  if (kind === '0') {
    if (bytes.length > MAX_JSON_BYTES) throw new Error('code too large');
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  }
  let raw;
  try { raw = inflateRaw(bytes, MAX_JSON_BYTES); } catch (e) {
    raw = await nativeInflate(bytes, MAX_JSON_BYTES);    // a second opinion before giving up
    if (!raw) throw e;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(raw);
}

/** Browser DecompressionStream with an output cap; null when unavailable or the data is bad. */
async function nativeInflate(bytes, maxOut) {
  if (typeof DecompressionStream === 'undefined') return null;
  try {
    const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
    const parts = [];
    let n = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      n += value.length;
      if (n > maxOut) { reader.cancel().catch(() => {}); return null; }
      parts.push(value);
    }
    const out = new Uint8Array(n);
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  } catch { return null; }
}

// ------------------------------------------------------------------ raw DEFLATE decoder (RFC 1951)
// Small, synchronous and bounded: throws on malformed input or when the output would exceed maxOut.

const LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEXT = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DBASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DEXT = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

/** Canonical Huffman table from code lengths (puff.c layout). Over-subscribed sets are rejected. */
function huff(lengths, n) {
  const count = new Uint16Array(16), offs = new Uint16Array(16), sym = new Uint16Array(n);
  for (let i = 0; i < n; i++) count[lengths[i]]++;
  count[0] = 0;
  let left = 1;
  for (let len = 1; len < 16; len++) { left = (left << 1) - count[len]; if (left < 0) throw new Error('inflate: bad code lengths'); }
  for (let len = 1; len < 15; len++) offs[len + 1] = offs[len] + count[len];
  for (let i = 0; i < n; i++) if (lengths[i]) sym[offs[lengths[i]]++] = i;
  return { count, sym };
}

let FIXED = null;
function fixedTables() {
  if (FIXED) return FIXED;
  const l = new Uint8Array(288);
  for (let i = 0; i < 288; i++) l[i] = i < 144 ? 8 : i < 256 ? 9 : i < 280 ? 7 : 8;
  FIXED = { lit: huff(l, 288), dist: huff(new Uint8Array(30).fill(5), 30) };
  return FIXED;
}

export function inflateRaw(src, maxOut = MAX_JSON_BYTES) {
  if (!(src instanceof Uint8Array)) src = new Uint8Array(src);
  let out = new Uint8Array(Math.min(maxOut, Math.max(1024, src.length * 6)));
  let op = 0, pos = 0, bitbuf = 0, bitcnt = 0;
  const bits = (n) => {
    while (bitcnt < n) {
      if (pos >= src.length) throw new Error('inflate: truncated');
      bitbuf |= src[pos++] << bitcnt;
      bitcnt += 8;
    }
    const v = bitbuf & ((1 << n) - 1);
    bitbuf >>>= n;
    bitcnt -= n;
    return v;
  };
  const room = (n) => {
    if (op + n <= out.length) return;
    if (op + n > maxOut) throw new Error('inflate: output too large');
    const next = new Uint8Array(Math.min(maxOut, Math.max(out.length * 2, op + n)));
    next.set(out.subarray(0, op));
    out = next;
  };
  const decode = (h) => {
    let code = 0, first = 0, index = 0;
    for (let len = 1; len < 16; len++) {
      code |= bits(1);
      const c = h.count[len];
      if (code - c < first) return h.sym[index + (code - first)];
      index += c; first = (first + c) << 1; code <<= 1;
    }
    throw new Error('inflate: bad code');
  };
  const block = (lit, dist) => {
    for (;;) {
      let s = decode(lit);
      if (s < 256) { room(1); out[op++] = s; continue; }
      if (s === 256) return;
      s -= 257;
      if (s >= 29) throw new Error('inflate: bad length');
      const len = LBASE[s] + bits(LEXT[s]);
      const ds = decode(dist);
      if (ds >= 30) throw new Error('inflate: bad distance');
      const d = DBASE[ds] + bits(DEXT[ds]);
      if (d > op) throw new Error('inflate: distance too far');
      room(len);
      for (let i = 0; i < len; i++, op++) out[op] = out[op - d];
    }
  };
  let last = 0;
  while (!last) {
    last = bits(1);
    const type = bits(2);
    if (type === 0) {
      bitbuf = 0; bitcnt = 0;                       // stored: skip to the byte boundary
      if (pos + 4 > src.length) throw new Error('inflate: truncated');
      const len = src[pos] | (src[pos + 1] << 8), nlen = src[pos + 2] | (src[pos + 3] << 8);
      pos += 4;
      if (len !== (~nlen & 0xffff)) throw new Error('inflate: bad stored block');
      if (pos + len > src.length) throw new Error('inflate: truncated');
      room(len);
      out.set(src.subarray(pos, pos + len), op);
      op += len; pos += len;
    } else if (type === 1) {
      const f = fixedTables();
      block(f.lit, f.dist);
    } else if (type === 2) {
      const nlen = bits(5) + 257, ndist = bits(5) + 1, ncode = bits(4) + 4;
      if (nlen > 286 || ndist > 30) throw new Error('inflate: bad counts');
      const cl = new Uint8Array(19);
      for (let i = 0; i < ncode; i++) cl[CL_ORDER[i]] = bits(3);
      const clh = huff(cl, 19);
      const lens = new Uint8Array(nlen + ndist);
      for (let i = 0; i < nlen + ndist;) {
        const s = decode(clh);
        if (s < 16) { lens[i++] = s; continue; }
        let v = 0, rep;
        if (s === 16) { if (!i) throw new Error('inflate: repeat without length'); v = lens[i - 1]; rep = 3 + bits(2); }
        else if (s === 17) rep = 3 + bits(3);
        else rep = 11 + bits(7);
        if (i + rep > nlen + ndist) throw new Error('inflate: too many lengths');
        while (rep--) lens[i++] = v;
      }
      if (!lens[256]) throw new Error('inflate: no end-of-block code');
      block(huff(lens, nlen), huff(lens.subarray(nlen), ndist));
    } else throw new Error('inflate: bad block type');
  }
  return out.subarray(0, op);
}
