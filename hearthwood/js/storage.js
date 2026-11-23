// Saving & loading builds (localStorage) plus shareable build codes.

const AUTO = 'hearthwood.autosave.v1';
const SLOT = (n) => `hearthwood.slot.${n}.v1`;
export const SLOT_COUNT = 6;

function safeGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function safeSet(k, v) {
  try { localStorage.setItem(k, v); return true; } catch (e) { console.warn('save failed', e); return false; }
}

export const storage = {
  autosave(data, camView = null) {
    return safeSet(AUTO, JSON.stringify({ ...data, cam: camView, date: Date.now() }));
  },
  loadAutosave() {
    const raw = safeGet(AUTO);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  },
  clearAutosave() { try { localStorage.removeItem(AUTO); } catch { /* ignore */ } },

  /** Save to a numbered slot (1..SLOT_COUNT). meta: { name, thumb (dataURL), cam } */
  saveSlot(n, data, meta = {}) {
    const rec = { ...data, name: meta.name || `House ${n}`, thumb: meta.thumb || null, cam: meta.cam || null, date: Date.now() };
    let ok = safeSet(SLOT(n), JSON.stringify(rec));
    if (!ok && rec.thumb) { rec.thumb = null; ok = safeSet(SLOT(n), JSON.stringify(rec)); }
    return ok;
  },
  loadSlot(n) {
    const raw = safeGet(SLOT(n));
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  },
  deleteSlot(n) { try { localStorage.removeItem(SLOT(n)); } catch { /* ignore */ } },
  /** [{ n, empty, name, date, count, thumb }] */
  listSlots() {
    const out = [];
    for (let n = 1; n <= SLOT_COUNT; n++) {
      const d = this.loadSlot(n);
      out.push(d ? { n, empty: false, name: d.name, date: d.date, count: d.pieces?.length || 0, thumb: d.thumb } : { n, empty: true });
    }
    return out;
  },

  /** Encode a build as a compact shareable text code. */
  async exportCode(data) {
    const json = JSON.stringify({ app: 'hearthwood', v: 1, pieces: data.pieces });
    try {
      if (typeof CompressionStream !== 'undefined') {
        const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('deflate-raw'));
        const buf = new Uint8Array(await new Response(stream).arrayBuffer());
        return 'HW1:' + b64(buf);
      }
    } catch { /* fall through */ }
    return 'HW0:' + b64(new TextEncoder().encode(json));
  },

  /** Decode a build code (or raw JSON). Returns data or null. */
  async importCode(code) {
    code = (code || '').trim();
    try {
      if (code.startsWith('{')) return JSON.parse(code);
      if (code.startsWith('HW1:')) {
        const bytes = unb64(code.slice(4));
        const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        return JSON.parse(await new Response(stream).text());
      }
      if (code.startsWith('HW0:')) return JSON.parse(new TextDecoder().decode(unb64(code.slice(4))));
    } catch (e) { console.warn('bad code', e); }
    return null;
  },
};

function b64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64(str) {
  const s = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
