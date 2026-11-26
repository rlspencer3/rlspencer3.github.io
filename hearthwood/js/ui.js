// Hearthwood — all DOM UI.
//   top bar (menu · piece counter · floor control · undo/redo), tool rail (build / erase / paint / pick,
//   draw-vs-look, see-all floors), bottom build tray (context row, category tabs, piece cards, paint panel),
//   colour popovers & piece info, toasts, blueprint guide HUD, menu sheet (new · saves · blueprints · share ·
//   photo · settings · help), confirm dialogs, photo mode and the first-run welcome card.
// Everything is data-driven from the app object (docs/ARCHITECTURE.md). Mounted inside #ui, which has
// pointer-events:none — only the interactive bits below opt back in, so the canvas keeps every other touch.

import { MAX_LEVEL } from './config.js';
import { SLOT_COUNT } from './storage.js';
import { turnable } from './facing.js';

const LS_WELCOMED = 'hearthwood.welcomed';
const LS_TRAY = 'hearthwood.ui.trayCollapsed';
const LS_NAME = 'hearthwood.ui.buildName';

const SHORT_CAT = { base: 'Floors', walls: 'Walls', openings: 'Windows', roof: 'Roofs', frame: 'Frame', interior: 'Cozy', garden: 'Garden' };

const TOOLS = [
  { id: 'build', icon: '🔨', label: 'Build', key: 'B', hint: '' },
  { id: 'erase', icon: '🧽', label: 'Erase', key: 'E', hint: 'Tap a piece to tidy it away' },
  { id: 'paint', icon: '🎨', label: 'Paint', key: 'P', hint: 'Tap pieces to paint them' },
  { id: 'pick', icon: '💧', label: 'Pick', key: 'I', hint: 'Tap a piece to copy its style' },
];

const SEASONS = [
  { id: 'spring', icon: '🌸', label: 'Spring' },
  { id: 'summer', icon: '☀️', label: 'Summer' },
  { id: 'autumn', icon: '🍂', label: 'Autumn' },
  { id: 'winter', icon: '❄️', label: 'Winter' },
];
const WEATHER = [
  { id: 'clear', icon: '🌤️', label: 'Clear' },
  { id: 'rain', icon: '🌧️', label: 'Rain' },
  { id: 'snow', icon: '☃️', label: 'Snow' },
  { id: 'leaves', icon: '🍃', label: 'Breezy' },
];
const QUALITY = [
  { id: 'low', label: 'Low' },
  { id: 'auto', label: 'Auto' },
  { id: 'high', label: 'High' },
];

const PAINT_GROUPS = [
  { id: 'wall', label: 'Walls' },
  { id: 'roof', label: 'Roof' },
  { id: 'floor', label: 'Floors' },
  { id: 'trim', label: 'Trim' },
];

// Stroke icons (24×24, drawn with currentColor)
const ICON = {
  menu: '<path d="M4.5 7h15M4.5 12h15M4.5 17h15"/>',
  undo: '<path d="M9 14.5 4.5 10 9 5.5"/><path d="M4.5 10h10a5 5 0 0 1 0 10H11"/>',
  redo: '<path d="m15 14.5 4.5-4.5L15 5.5"/><path d="M19.5 10h-10a5 5 0 0 0 0 10H13"/>',
  up: '<path d="m6.5 14.5 5.5-5.5 5.5 5.5"/>',
  down: '<path d="m6.5 9.5 5.5 5.5 5.5-5.5"/>',
  back: '<path d="m14.5 18-6-6 6-6"/>',
  close: '<path d="M17 7 7 17M7 7l10 10"/>',
  rotate: '<path d="M19.5 12.5a7.5 7.5 0 1 1-2.2-5.8l2.2 2.1"/><path d="M19.7 4.5v4.6h-4.6"/>',
  flip: '<path d="M8 4.5 4.5 8 8 11.5"/><path d="M4.5 8h15"/><path d="m16 12.5 3.5 3.5-3.5 3.5"/><path d="M19.5 16h-15"/>',
  check: '<path d="M19 7 10 16.5 5 11.5"/>',
  info: '<path d="M12 11v5.5"/><path d="M12 7.6v.1"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2.5"/><path d="M15.5 8.5v-2a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2"/>',
  share: '<path d="M12 15V4.5"/><path d="m8 8 4-4 4 4"/><path d="M6 12v6a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-6"/>',
  trash: '<path d="M5 7h14"/><path d="M10 7V5h4v2"/><path d="M7 7l1 12h8l1-12"/>',
  plus: '<path d="M12 6v12M6 12h12"/>',
  minus: '<path d="M6 12h12"/>',
  none: '<circle cx="12" cy="12" r="7"/><path d="m7 17 10-10"/>',
};

// Material swatch patterns (pure CSS, no textures): hints at the real texture in a tiny chip.
const PATTERN = {
  log: 'logs', logDark: 'logs', clapboard: 'lap', boardBatten: 'batten', shingleSiding: 'shingle',
  plaster: 'plaster', stone: 'stone', brick: 'brick', planks: 'planksH', glass: 'glass',
  roofShingle: 'shingle', roofSlate: 'slate', roofMetal: 'ribs', roofThatch: 'thatch', roofTile: 'tile',
  floorOak: 'planks', floorPine: 'planks', floorStone: 'stone', floorTile: 'checker', deck: 'planks',
  timber: 'grain', wood: 'grain', trim: 'smooth', paintedWood: 'smooth', stoneBlock: 'blocks', iron: 'smooth',
  leaves: 'leaf', leavesDark: 'leaf', hay: 'thatch', path: 'stone', bark: 'grain',
};

// ------------------------------------------------------------------ small DOM helpers

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'value' || k === 'checked') el[k] = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  for (const c of kids.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

const svg = (name, cls = '') => `<svg class="hw-ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICON[name] || ''}</svg>`;
const ico = (name, cls = '') => h('span', { class: 'hw-ico', html: svg(name, cls) });

function hexToRgb(hex) {
  let s = String(hex || '#cccccc').replace('#', '');
  if (s.length === 3) s = s.split('').map((c) => c + c).join('');
  const n = parseInt(s.slice(0, 6), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
/** Mix a colour toward white (f > 0) or black (f < 0). */
function shade(hex, f) {
  const [r, g, b] = hexToRgb(hex);
  const t = f < 0 ? 0 : 255, a = Math.abs(f);
  const m = (c) => Math.round(c + (t - c) * a);
  return `rgb(${m(r)},${m(g)},${m(b)})`;
}
function isLight(hex) {
  const [r, g, b] = hexToRgb(hex);
  return r * 0.299 + g * 0.587 + b * 0.114 > 150;
}

function swatchBg(id, col) {
  const c = col || '#cbbba6';
  const l = shade(c, 0.24), d = shade(c, -0.2), dd = shade(c, -0.38);
  switch (PATTERN[id] || 'smooth') {
    case 'logs': return `linear-gradient(180deg, ${l} 0%, ${c} 40%, ${d} 82%, ${dd} 100%) 0 0 / 100% 8px`;
    case 'lap': return `linear-gradient(180deg, ${l} 0 62%, ${c} 62% 80%, ${dd} 80% 100%) 0 0 / 100% 6px`;
    case 'batten': return `linear-gradient(90deg, ${c} 0 68%, ${l} 68% 78%, ${dd} 78% 100%) 0 0 / 9px 100%`;
    case 'shingle': return `radial-gradient(circle at 50% 0, ${c} 0 58%, ${dd} 60% 68%, transparent 70%) 0 0 / 8px 7px, radial-gradient(circle at 50% 0, ${c} 0 58%, ${dd} 60% 68%, transparent 70%) 4px 3.5px / 8px 7px, ${d}`;
    case 'plaster': return `radial-gradient(circle at 30% 28%, ${l}, ${c} 55%, ${d})`;
    case 'stone': return `radial-gradient(circle at 26% 28%, ${l} 0 17%, transparent 19%), radial-gradient(circle at 72% 40%, ${c} 0 20%, transparent 22%), radial-gradient(circle at 38% 78%, ${c} 0 19%, transparent 21%), radial-gradient(circle at 82% 86%, ${l} 0 13%, transparent 15%), ${dd}`;
    case 'brick': return `linear-gradient(0deg, ${l} 0 1.5px, transparent 1.5px) 0 0 / 100% 7px, linear-gradient(90deg, ${l} 0 1.5px, transparent 1.5px) 0 0 / 11px 7px, ${c}`;
    case 'planks': return `linear-gradient(90deg, ${l} 0 12%, ${c} 12% 84%, ${dd} 84% 100%) 0 0 / 8px 100%`;
    case 'planksH': return `linear-gradient(180deg, ${l} 0 12%, ${c} 12% 84%, ${dd} 84% 100%) 0 0 / 100% 8px`;
    case 'glass': return `linear-gradient(135deg, ${l} 0 28%, ${c} 28% 52%, ${l} 52% 60%, ${c} 60% 100%)`;
    case 'slate': return `linear-gradient(0deg, ${dd} 0 1.5px, transparent 1.5px) 0 0 / 100% 6px, linear-gradient(90deg, ${dd} 0 1.5px, transparent 1.5px) 0 0 / 9px 100%, linear-gradient(160deg, ${l}, ${c} 60%)`;
    case 'ribs': return `linear-gradient(90deg, ${l} 0 22%, ${c} 22% 68%, ${dd} 68% 100%) 0 0 / 7px 100%`;
    case 'thatch': return `repeating-linear-gradient(100deg, ${c} 0 2px, ${d} 2px 3px, ${l} 3px 5px)`;
    case 'tile': return `radial-gradient(circle at 50% 100%, ${l} 0 30%, ${c} 32% 58%, ${dd} 60%) 0 0 / 8px 6px`;
    case 'checker': return `conic-gradient(${c} 25%, ${dd} 0 50%, ${c} 0 75%, ${dd} 0) 0 0 / 12px 12px`;
    case 'grain': return `repeating-linear-gradient(92deg, ${c} 0 3px, ${d} 3px 4px, ${l} 4px 6px, ${c} 6px 9px)`;
    case 'blocks': return `linear-gradient(0deg, ${dd} 0 1.5px, transparent 1.5px) 0 0 / 100% 9px, linear-gradient(90deg, ${dd} 0 1.5px, transparent 1.5px) 0 0 / 14px 100%, ${c}`;
    case 'leaf': return `radial-gradient(circle at 30% 30%, ${l} 0 22%, transparent 24%) 0 0 / 9px 9px, ${c}`;
    default: return `radial-gradient(circle at 34% 30%, ${l}, ${c} 55%, ${d})`;
  }
}

function fmtDate(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  if (diff < 60e3) return 'Just now';
  if (diff < 3600e3) return `${Math.max(1, Math.round(diff / 60e3))} min ago`;
  const d = new Date(ts), now = new Date();
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return `Today, ${time}`;
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `Yesterday, ${time}`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function fmtTime(t) {
  const mins = Math.round((((t % 1) + 1) % 1) * 24 * 60) % (24 * 60);
  const hr = Math.floor(mins / 60), mn = mins % 60;
  const h12 = hr % 12 === 0 ? 12 : hr % 12;
  return `${h12}:${String(mn).padStart(2, '0')} ${hr < 12 ? 'am' : 'pm'}`;
}
function timeIcon(t) {
  const x = ((t % 1) + 1) % 1;
  if (x < 0.22 || x > 0.8) return '🌙';
  if (x < 0.3) return '🌅';
  if (x > 0.72) return '🌇';
  return '☀️';
}

const COLOR_NAMES = {
  '#f7f3ea': 'Cream', '#efe3c8': 'Linen', '#e8d3a8': 'Wheat', '#d9c19a': 'Oat',
  '#b4473a': 'Barn red', '#8e3b32': 'Brick red', '#c96a5a': 'Terracotta', '#e39a7a': 'Peach',
  '#e9c46a': 'Mustard', '#d9a441': 'Honey', '#9cae6b': 'Sage', '#6f8f5a': 'Moss',
  '#4f7a6a': 'Teal', '#7fa7a3': 'Duck egg', '#9fc0d6': 'Sky', '#5d7fa3': 'Denim',
  '#2f4a66': 'Navy', '#6b5b8e': 'Plum', '#b9a3c9': 'Lilac', '#e7b7c8': 'Blush',
  '#7a4b3a': 'Walnut', '#4a3a2e': 'Umber', '#5e5e5e': 'Slate', '#2b2b2b': 'Charcoal',
};
const colorName = (c) => COLOR_NAMES[String(c).toLowerCase()] || String(c);

const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

// ==================================================================== init

export function init(app) {
  const { state, events, catalog, materials, storage, world } = app;
  const builder = app.builder;
  const MATERIALS = materials.MATERIALS || {};
  const PALETTE = materials.PALETTE || [];
  const isPaintable = materials.isPaintable || ((id) => !!MATERIALS[id]?.paintable);
  const matList = materials.matList || ((g) => Object.values(MATERIALS).filter((m) => m.group === g));
  const matName = (id) => MATERIALS[id]?.name || id;
  const matColor = (id) => MATERIALS[id]?.swatch || MATERIALS[id]?.color || '#cbbba6';
  const params = app.params || new URLSearchParams(location.search);
  const coarse = matchMedia('(pointer: coarse)').matches;

  const host = document.getElementById('ui') || document.body;
  const root = h('div', { class: 'hw' });
  host.append(root);

  const sfx = (name) => events.emit('sfx', { name });
  const getDef = (id) => catalog.getDef(id);
  let townHud = null;        // the town's face (js/town/hud.js), mounted after first paint when app.town exists
  /** The town's word on a gift piece: { from, isNew } or null (no town, or not a gift). */
  const giftInfo = (id) => { try { return app.town?.giftInfo?.(id) || null; } catch { return null; } };
  let giftDot = false;       // a gift was unlocked: the Garden tab shows a dot until it is opened
  const curDef = () => getDef(state.pieceId);

  /** A button that plays a click and runs fn. */
  function btn(cls, label, content, fn, extra = {}) {
    return h('button', {
      type: 'button', class: cls, 'aria-label': label, title: extra.title ?? label, ...extra.attrs,
      onclick: (e) => { if (extra.sound !== false) sfx(extra.sound || 'click'); fn(e); },
    }, content);
  }

  // ------------------------------------------------------------------ top bar

  const countNum = h('b', null, String(world.count || 0));
  const counter = h('div', { class: 'hw-count', title: 'Pieces placed', 'aria-label': 'Pieces placed' }, h('span', { class: 'hw-count-ic' }, '🪵'), countNum);
  const btnMenu = btn('hw-rbtn hw-menu-btn', 'Menu', ico('menu'), () => openSheet('main'), { sound: false, title: 'Menu (M)' });

  const floorToast = () => toast(state.level === 0 ? '🪜 Floor 1 — building on the ground' : `🪜 Floor ${state.level + 1} — the grid now sits on top of Floor ${state.level}`, 'info', 2000);
  const lvDown = btn('hw-lv-btn', 'Down a floor', ico('down'), () => { const l = state.level; builder.setLevel(l - 1); if (state.level !== l) floorToast(); }, { sound: false, title: 'Down a floor (−)' });
  const lvUp = btn('hw-lv-btn', 'Up a floor', ico('up'), () => { const l = state.level; builder.setLevel(l + 1); if (state.level !== l) floorToast(); }, { sound: false, title: 'Up a floor (+)' });
  const lvBars = [];
  const lvStack = h('span', { class: 'hw-lv-stack', 'aria-hidden': 'true' });
  for (let i = MAX_LEVEL; i >= 0; i--) { const b = h('i'); lvBars[i] = b; lvStack.append(b); }
  const lvName = h('span', { class: 'hw-lv-name' });
  const level = h('div', { class: 'hw-level', role: 'group', 'aria-label': 'Floor' }, lvDown, h('div', { class: 'hw-lv-label' }, lvStack, lvName), lvUp);

  const btnUndo = btn('hw-rbtn', 'Undo', ico('undo'), () => builder.undo(), { sound: false, title: 'Undo (Ctrl+Z)' });
  const btnRedo = btn('hw-rbtn', 'Redo', ico('redo'), () => builder.redo(), { sound: false, title: 'Redo (Ctrl+Shift+Z)' });

  const top = h('div', { class: 'hw-top hw-hide-photo' },
    h('div', { class: 'hw-top-l' }, btnMenu, counter),
    level,
    h('div', { class: 'hw-top-r' }, btnUndo, btnRedo));
  root.append(top);

  function renderLevel() {
    lvName.textContent = `Floor ${state.level + 1}`;
    lvBars.forEach((b, i) => { b.className = i === state.level ? 'on' : i < state.level ? 'below' : ''; });
    lvDown.disabled = state.level <= 0;
    lvUp.disabled = state.level >= MAX_LEVEL;
    level.classList.remove('bump'); void level.offsetWidth; level.classList.add('bump');
  }
  let canU = null, canR = null;
  function renderHistory() {
    canU = world.canUndo();
    canR = world.canRedo();
    btnUndo.disabled = !canU;
    btnRedo.disabled = !canR;
  }
  // batched to one DOM write per frame: loads and blueprint stamps fire hundreds of world-change events
  let countQueued = false;
  function renderCount() {
    if (countQueued) return;
    countQueued = true;
    requestAnimationFrame(() => {
      countQueued = false;
      const s = String(world.count || 0);
      if (countNum.textContent === s) return;
      countNum.textContent = s;
      counter.classList.remove('bump'); void counter.offsetWidth; counter.classList.add('bump');
    });
  }

  // ------------------------------------------------------------------ tool rail

  const toolBtns = {};
  const railTools = h('div', { class: 'hw-rail-group' });
  for (const t of TOOLS) {
    const b = btn('hw-tool', t.label, [h('span', { class: 'hw-tool-ic' }, t.icon), h('span', { class: 'hw-tool-lb' }, t.label)], () => {
      state.set({ tool: state.tool === t.id && t.id !== 'build' ? 'build' : t.id });
    }, { title: `${t.label} (${t.key})`, attrs: { 'data-tool': t.id } });
    toolBtns[t.id] = b;
    railTools.append(b);
  }
  const drawIc = h('span', { class: 'hw-tool-ic' }), drawLb = h('span', { class: 'hw-tool-lb' });
  const btnDraw = btn('hw-tool hw-draw', 'Drag mode', [drawIc, drawLb], () => {
    state.set({ drawMode: !state.drawMode });
    const what = state.tool === 'erase' ? 'tidy away a row of pieces' : state.tool === 'paint' ? 'paint many pieces' : 'place pieces in a row';
    toast(state.drawMode ? `✏️ Draw: drag a finger to ${what} · pinch to move the view` : '✋ Look: drag a finger to look around', 'info', 2600);
  }, { title: 'Draw / Look (D)' });
  const seeIc = h('span', { class: 'hw-tool-ic' }), seeLb = h('span', { class: 'hw-tool-lb' });
  const btnSee = btn('hw-tool hw-see', 'Show all floors', [seeIc, seeLb], () => {
    state.set({ seeAll: !state.seeAll });
    toast(state.seeAll ? '👁️ Showing every floor' : '✂️ Cutaway: floors above are hidden', 'info', 2000);
  }, { title: 'Show all floors / cutaway (V)' });
  // The rail box spans from under the top bar down to the tray; the groups sit at its bottom. When that room
  // gets short (small phones, the taller paint tray) css/ui.css shortens the tools, then (portrait) moves
  // Look / All beside them, so the rail never climbs over Undo / Redo.
  const rail = h('div', { class: 'hw-rail hw-hide-photo' }, h('div', { class: 'hw-rail-in' }, railTools, h('div', { class: 'hw-rail-group' }, btnDraw, btnSee)));
  root.append(rail);

  function renderRail() {
    for (const t of TOOLS) {
      const on = state.tool === t.id;
      toolBtns[t.id].classList.toggle('is-on', on);
      toolBtns[t.id].setAttribute('aria-pressed', String(on));
    }
    drawIc.textContent = state.drawMode ? '✏️' : '✋';
    drawLb.textContent = state.drawMode ? 'Draw' : 'Look';
    btnDraw.classList.toggle('is-on', !!state.drawMode);
    btnDraw.setAttribute('aria-pressed', String(!!state.drawMode));
    seeIc.textContent = state.seeAll ? '👁️' : '✂️';
    seeLb.textContent = state.seeAll ? 'All' : 'Cutaway';
    btnSee.classList.toggle('is-on', !state.seeAll);
    btnSee.setAttribute('aria-pressed', String(!state.seeAll));
    modeChip.classList.toggle('is-on', !!state.drawMode && state.tool !== 'pick');
    chipTx.textContent = state.tool === 'erase' ? 'drag to tidy many' : state.tool === 'paint' ? 'drag to paint many' : 'drag to place in a row';
  }

  // ------------------------------------------------------------------ build tray

  const tray = h('div', { class: 'hw-tray hw-hide-photo' });
  const handle = h('button', { type: 'button', class: 'hw-handle', 'aria-label': 'Hide pieces', title: 'Hide / show pieces' }, ico('down'));
  const ctx = h('div', { class: 'hw-ctx' });
  const tabs = h('div', { class: 'hw-tabs', role: 'tablist', 'aria-label': 'Piece categories' });
  const cards = h('div', { class: 'hw-cards hw-scroll', role: 'listbox', 'aria-label': 'Pieces' });
  const paintPanel = h('div', { class: 'hw-paint' });
  // landscape phones fold the tabs into this one button beside the cards (css/ui.css); it opens a picker
  const catIc = h('span', { class: 'hw-catbtn-ic' }), catLb = h('span', { class: 'hw-catbtn-lb' });
  const catBtn = btn('hw-catbtn', 'Piece categories', [catIc, catLb, h('span', { class: 'hw-catbtn-more', html: svg('up') })], () => openCatPicker(), { title: 'Categories', attrs: { 'aria-haspopup': 'true', 'data-act': 'cats' } });
  tray.append(handle, ctx, catBtn, tabs, cards, paintPanel);
  root.append(tray);

  let collapsed = lsGet(LS_TRAY) === '1';
  handle.addEventListener('click', () => setCollapsed(!collapsed));
  /** The handle says what a tap does: also right after a reload with the tray restored collapsed. */
  const labelHandle = () => {
    handle.setAttribute('aria-label', collapsed ? 'Show pieces' : 'Hide pieces');
    handle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  };
  function setCollapsed(v, sound = true) {
    collapsed = v;
    lsSet(LS_TRAY, v ? '1' : '0');
    tray.classList.toggle('is-collapsed', v);
    labelHandle();
    if (sound) sfx(v ? 'close' : 'open');
    closePop();
    renderCtx();
  }
  tray.classList.toggle('is-collapsed', collapsed);
  labelHandle();

  // keep the rail & popovers clear of the tray
  const syncTrayH = () => {
    const r = tray.getBoundingClientRect();
    root.style.setProperty('--tray-h', `${Math.round(Math.max(0, window.innerHeight - r.top))}px`);
    syncInsets();
  };
  // let the camera centre the view in the part of the screen the bars don't cover
  function syncInsets() {
    const rig = app.rig;
    if (!rig?.setInsets) return;
    if (state.photoMode) { rig.setInsets(0, 0, 0, 0); return; }
    let tb = top.getBoundingClientRect().bottom;
    const hudEl = root.querySelector('.hw-hud.is-open');
    if (hudEl) tb = Math.max(tb, hudEl.getBoundingClientRect().bottom);
    const tr = tray.getBoundingClientRect().top;
    const rl = railTools.getBoundingClientRect().left;   // the tools column runs down the whole right edge
    const right = rl > window.innerWidth * 0.6 ? Math.round(window.innerWidth - rl) : 0;
    rig.setInsets(Math.max(0, Math.round(tb)), Math.max(0, Math.round(window.innerHeight - tr)), 0, right);
  }
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(syncTrayH).observe(tray);
  window.addEventListener('resize', syncTrayH);

  // horizontal wheel scrolling for mouse users
  function wheelScroll(el) {
    el.addEventListener('wheel', (e) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && el.scrollWidth > el.clientWidth) {
        el.scrollLeft += e.deltaY;
        e.preventDefault();
      }
    }, { passive: false });
  }
  wheelScroll(cards);

  // ---- category tabs
  const tabEls = new Map();
  function renderTabs() {
    tabs.textContent = '';
    tabEls.clear();
    for (const cat of catalog.CATEGORIES) {
      const n = catalog.piecesIn(cat.id).length;
      if (!n) continue;
      const short = SHORT_CAT[cat.id] || cat.name.split(/[ &]/)[0];
      const b = btn('hw-tab', cat.name, [h('span', { class: 'hw-tab-ic' }, cat.icon), h('span', { class: 'hw-tab-lb' }, short), h('span', { class: 'hw-tab-full' }, cat.name),
        cat.id === 'garden' && giftDot ? h('span', { class: 'hw-tab-dot', 'aria-hidden': 'true' }) : null], () => {
        openCategory(cat.id);
      }, { title: cat.name, attrs: { role: 'tab', 'data-cat': cat.id } });
      tabEls.set(cat.id, b);
      tabs.append(b);
    }
    markTab();
  }
  // a tab hands you a piece from that category straight away (the last one you used there, else the first),
  // so a new player never builds foundations while looking at the Walls tab. Upstairs it hands over one that
  // can go on this floor (floor tiles, not a foundation); garden things walk you back down by themselves.
  const lastInCat = {};
  function openCategory(id) {
    const cur = curDef();
    if (cur && cur.cat === id) { if (state.category !== id) state.set({ category: id }); return; }
    const list = catalog.piecesIn(id);
    const fits = (d) => state.level >= (d.levels?.[0] ?? 0) && state.level <= (d.levels?.[1] ?? MAX_LEVEL);
    const last = list.find((d) => d.id === lastInCat[id]);
    const want = (last && (fits(last) || last.cat === 'garden') ? last : null) || list.find(fits) || last || list[0];
    if (want) builder.selectPiece(want.id);
    else state.set({ category: id });
  }
  function markTab() {
    for (const [id, b] of tabEls) {
      const on = id === state.category;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-selected', String(on));
    }
    const cat = catalog.CATEGORIES.find((c) => c.id === state.category);
    catIc.textContent = cat?.icon || '🧺';
    catLb.textContent = cat ? (SHORT_CAT[cat.id] || cat.name.split(/[ &]/)[0]) : 'Pieces';
    catBtn.setAttribute('aria-label', cat ? `${cat.name} — pick a category` : 'Piece categories');
    const dot = catBtn.querySelector('.hw-tab-dot');
    if (giftDot && state.category !== 'garden') { if (!dot) catBtn.append(h('span', { class: 'hw-tab-dot', 'aria-hidden': 'true' })); }
    else dot?.remove();
  }
  /** Opening the Garden tab clears the new-gift dot. */
  function seenGarden() {
    if (!giftDot || state.category !== 'garden') return;
    giftDot = false;
    for (const d of root.querySelectorAll('.hw-tab-dot')) d.remove();
  }
  /** The 🎁 New ribbon on gift cards the player hasn't placed yet. */
  function markGifts() {
    for (const c of cardEls.values()) c.el.classList.toggle('hw-card-gift', !!(c.def.gift && giftInfo(c.def.id)?.isNew));
  }
  function openCatPicker() {
    const grid = h('div', { class: 'hw-catpick', role: 'group', 'aria-label': 'Piece categories' });
    for (const cat of catalog.CATEGORIES) {
      if (!catalog.piecesIn(cat.id).length) continue;
      const on = cat.id === state.category;
      grid.append(btn('hw-catopt' + (on ? ' is-on' : ''), cat.name, [h('span', { class: 'hw-tab-ic' }, cat.icon), h('span', { class: 'hw-catopt-lb' }, SHORT_CAT[cat.id] || cat.name.split(/[ &]/)[0]),
        cat.id === 'garden' && giftDot ? h('span', { class: 'hw-tab-dot', 'aria-hidden': 'true' }) : null], () => {
        closePop();
        openCategory(cat.id);
      }, { title: cat.name, attrs: { 'data-cat': cat.id, 'aria-pressed': String(on) } }));
    }
    showPop(catBtn, grid, 'hw-pop-cats');
  }

  // ---- piece cards
  const cardEls = new Map(); // id -> { el, img, def, key }
  let cardsCat = null;

  function thumbRec(def) {
    const rec = {};
    const m = builder.materialFor(def);
    if (m) rec.m = m;
    const c = builder.colorFor(def, m);
    if (c) rec.c = c;
    if (def.accent && state.accent) rec.k = state.accent;
    return rec;
  }
  function loadThumb(card) {
    const rec = thumbRec(card.def);
    const key = JSON.stringify(rec);
    if (card.key === key) return;
    card.key = key;
    let pr;
    try { pr = app.thumbnail?.(card.def.id, rec); } catch { pr = null; }
    if (!pr || !pr.then) return;
    pr.then((url) => {
      if (card.key !== key || !url) return;
      card.img.src = url;
      card.el.classList.add('has-img');
    }, () => {});
  }

  function renderCards(force = false) {
    if (!force && cardsCat === state.category) { markCard(); return; }
    cardsCat = state.category;
    cards.textContent = '';
    cardEls.clear();
    const defs = catalog.piecesIn(state.category);
    for (const def of defs) {
      const img = h('img', { alt: '', draggable: 'false', decoding: 'async' });
      const info = h('span', { class: 'hw-card-info', role: 'button', 'aria-label': `About ${def.name}`, html: svg('info') });
      const el = h('div', {
        class: 'hw-card', role: 'option', tabindex: '0', 'data-id': def.id, title: def.desc || def.name,
      }, h('span', { class: 'hw-card-thumb' }, h('span', { class: 'hw-card-emoji' }, def.icon || '◻️'), img), h('span', { class: 'hw-card-name' }, def.name), info);
      const card = { el, img, def, key: null };
      if (def.gift && giftInfo(def.id)?.isNew) el.classList.add('hw-card-gift');
      cardEls.set(def.id, card);
      wireCard(card, info);
      cards.append(el);
      loadThumb(card);
    }
    cards.scrollLeft = 0;
    markCard(true);
  }

  function wireCard(card, info) {
    const { el, def } = card;
    let timer = null, sx = 0, sy = 0, longed = false;
    const cancel = () => { clearTimeout(timer); timer = null; };
    el.addEventListener('pointerdown', (e) => {
      longed = false; sx = e.clientX; sy = e.clientY;
      cancel();
      timer = setTimeout(() => { longed = true; timer = null; showInfo(def, el); if (navigator.vibrate) try { navigator.vibrate(8); } catch { /* ignore */ } }, 480);
    });
    el.addEventListener('pointermove', (e) => { if (timer && Math.hypot(e.clientX - sx, e.clientY - sy) > 8) cancel(); });
    el.addEventListener('pointerup', cancel);
    el.addEventListener('pointercancel', cancel);
    el.addEventListener('pointerleave', cancel);
    el.addEventListener('contextmenu', (e) => { e.preventDefault(); cancel(); longed = true; showInfo(def, el); });
    info.addEventListener('click', (e) => { e.stopPropagation(); sfx('click'); showInfo(def, el); });
    el.addEventListener('click', () => {
      if (longed) { longed = false; return; }
      choosePiece(def.id);
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); choosePiece(def.id); }
    });
  }

  function choosePiece(id) {
    sfx('click');
    builder.selectPiece(id);
  }

  function markCard(instant = false) {
    let sel = null;
    for (const [id, c] of cardEls) {
      const on = id === state.pieceId;
      c.el.classList.toggle('is-sel', on);
      c.el.setAttribute('aria-selected', String(on));
      if (on) sel = c.el;
    }
    if (sel) ensureVisible(cards, sel, !instant, true);
  }

  /** Scroll a horizontal scroller so `el` is fully visible (optionally centred). */
  function ensureVisible(scroller, el, smooth = true, center = false) {
    if (!scroller || !el || !scroller.clientWidth) return;
    const sr = scroller.getBoundingClientRect(), er = el.getBoundingClientRect();
    const pad = 12;
    if (er.left >= sr.left + pad - 2 && er.right <= sr.right - pad + 2) return;
    const x = er.left - sr.left + scroller.scrollLeft;   // element position inside the scroll content
    const left = center ? x - (scroller.clientWidth - er.width) / 2 : (er.left < sr.left + pad ? x - pad : x + er.width - scroller.clientWidth + pad);
    const max = scroller.scrollWidth - scroller.clientWidth;
    scroller.scrollTo({ left: Math.max(0, Math.min(max, left)), behavior: smooth ? 'smooth' : 'auto' });
  }

  // Picking a material chip re-renders its strip: the chip gains its name and the one picked before loses its own,
  // so everything after that one shifts. The tapped chip is put back where the finger left it, then the strip
  // moves only as far as it takes to show it whole (with its group's label, if that was already peeking in).
  let chipAnchor = null;   // { strip: class of the strip, key: the chip's data-key, x: its offset from the strip's left }
  function anchorChip(el) {
    const strip = el?.closest('.hw-scroll');
    if (!strip || !el.dataset.key) { chipAnchor = null; return; }
    chipAnchor = { strip: strip.classList[0], key: el.dataset.key, x: el.getBoundingClientRect().left - strip.getBoundingClientRect().left, t: performance.now() };
  }
  /** Put the anchored chip of this (freshly rendered) strip back in place. False when there is none to place. */
  function restoreAnchor(strip) {
    const a = chipAnchor;
    if (a && performance.now() - a.t > 600) chipAnchor = null;   // a tap that changed nothing: forget it
    if (!chipAnchor || !strip.isConnected || !strip.classList.contains(a.strip)) return false;
    chipAnchor = null;
    const el = [...strip.querySelectorAll('[data-key]')].find((c) => c.dataset.key === a.key);
    if (!el || !strip.clientWidth) return false;
    strip.scrollLeft += el.getBoundingClientRect().left - strip.getBoundingClientRect().left - a.x;
    let lead = el.previousElementSibling;      // the group label this chip sits under (paint strip)
    while (lead && !lead.classList.contains('hw-group-lb')) lead = lead.previousElementSibling;
    reveal(strip, el, lead);
    return true;
  }
  /** Scroll a strip the least it takes to show `el` whole, and `lead` too when it is already partly in view. */
  function reveal(strip, el, lead = null) {
    const sr = strip.getBoundingClientRect(), er = el.getBoundingClientRect();
    const padL = 4, padR = 16;   // the strip fades out over its last 18 px
    let lo = er.left;
    const hi = er.right;
    if (lead) {
      const lr = lead.getBoundingClientRect();
      if (lr.right > sr.left + 2 && hi - lr.left <= sr.width - padL - padR) lo = Math.min(lo, lr.left);
    }
    let d = 0;
    if (lo < sr.left + padL) d = lo - sr.left - padL;
    else if (hi > sr.right - padR) d = Math.min(hi - sr.right + padR, lo - sr.left - padL);
    if (Math.abs(d) < 1) return;
    const max = strip.scrollWidth - strip.clientWidth;
    strip.scrollTo({ left: Math.max(0, Math.min(max, strip.scrollLeft + d)), behavior: 'smooth' });
  }

  function refreshThumbs() {
    for (const c of cardEls.values()) loadThumb(c);
    if (curBadgeImg) loadCurBadge();
  }

  // low-priority warm-up of every category's thumbnails so tab switches feel instant
  function prefetchThumbs() {
    const ids = [];
    for (const cat of catalog.CATEGORIES) for (const d of catalog.piecesIn(cat.id)) ids.push(d);
    let i = 0;
    const step = () => {
      if (i >= ids.length) return;
      const def = ids[i++];
      try { const pr = app.thumbnail?.(def.id, thumbRec(def)); if (pr?.then) pr.then(next, next); else next(); } catch { next(); }
    };
    const next = () => setTimeout(step, 30);
    step();
  }

  // ---- context row (selected piece options / tool hints)
  let curBadgeImg = null;
  let curBadgeKey = null;
  function loadCurBadge() {
    const def = curDef();
    if (!def || !curBadgeImg) return;
    const rec = thumbRec(def);
    const key = def.id + JSON.stringify(rec);
    if (key === curBadgeKey) return;
    curBadgeKey = key;
    const img = curBadgeImg;
    app.thumbnail?.(def.id, rec)?.then?.((url) => { if (url && img === curBadgeImg) { img.src = url; img.parentNode?.classList.add('has-img'); } }, () => {});
  }

  // the Turn icon spins a quarter turn (Flip: a half) per turn it makes — feedback, not a stored angle (facing is
  // automatic: SMART_BUILD.md §5.2)
  let rotSpin = 0, turnPtr = null, turnTapAt = -1e9;
  function colorKeyFor(def, m) { return m || def.id; }
  function paintableFor(def, m) { return !!(def.paintAlways || (def.paint && isPaintable(m))); }

  function renderCtx() {
    const keepScroll = ctx.querySelector('.hw-mats')?.scrollLeft || 0;
    ctx.textContent = '';
    curBadgeImg = null; curBadgeKey = null;
    const tool = state.tool;
    ctx.classList.remove('is-bare');
    tray.classList.toggle('mode-paint', tool === 'paint');
    tray.classList.toggle('mode-hint', tool === 'erase' || tool === 'pick');

    if (tool !== 'build') {
      const t = TOOLS.find((x) => x.id === tool) || TOOLS[0];
      let hint = t.hint;
      if (tool === 'erase' && state.drawMode) hint = 'Drag across pieces to tidy many';
      if (tool === 'paint' && state.drawMode) hint = 'Drag across pieces to paint many';
      ctx.append(h('div', { class: 'hw-hint' }, h('span', { class: 'hw-hint-ic' }, t.icon), h('span', { class: 'hw-hint-tx' }, h('b', null, t.label), ' · ', hint)));
      ctx.append(btn('hw-pill hw-done', 'Back to building', [ico('check'), h('span', null, 'Done')], () => state.set({ tool: 'build' })));
      return;
    }

    const def = curDef();
    if (!def) return;
    const m = builder.materialFor(def);

    if (collapsed) {
      curBadgeImg = h('img', { alt: '', draggable: 'false' });
      ctx.append(btn('hw-cur', `${def.name} — show pieces`, [h('span', { class: 'hw-cur-thumb' }, h('span', { class: 'hw-card-emoji' }, def.icon || '◻️'), curBadgeImg)], () => setCollapsed(false), { sound: false }));
      loadCurBadge();
    }

    const mats = def.mats || [];
    if (mats.length > 1) {
      const row = h('div', { class: 'hw-mats hw-scroll', role: 'radiogroup', 'aria-label': 'Material' });
      for (const id of mats) {
        const sel = id === m;
        const col = isPaintable(id) ? (state.colors[id] || matColor(id)) : matColor(id);
        const chip = btn('hw-chip' + (sel ? ' is-sel' : ''), matName(id), [
          h('span', { class: 'hw-sw', style: { background: swatchBg(id, col) } }),
          sel ? h('span', { class: 'hw-chip-name' }, matName(id)) : null,
        ], (e) => { anchorChip(e.currentTarget); state.set({ mats: { ...state.mats, [def.matGroup]: id } }); }, { attrs: { role: 'radio', 'aria-checked': String(sel), 'data-key': id } });
        row.append(chip);
      }
      wheelScroll(row);
      ctx.append(row);
      requestAnimationFrame(() => {
        if (!row.isConnected || restoreAnchor(row)) return;
        row.scrollLeft = keepScroll;
        ensureVisible(row, row.querySelector('.is-sel'), false);
      });
    } else {
      ctx.append(h('div', { class: 'hw-ctx-name' }, h('b', null, def.name), def.desc ? h('small', null, def.desc) : null));
    }

    const acts = h('div', { class: 'hw-acts' });
    if (paintableFor(def, m)) {
      const key = colorKeyFor(def, m);
      const cur = state.colors[key] || (m ? matColor(m) : null);
      const dot = cur ? h('span', { class: 'hw-dot', style: { background: cur } }) : h('span', { class: 'hw-dot hw-dot-def', html: svg('none') });
      const b = btn('hw-dotbtn', 'Colour', dot, (e) => {
        openPalette(e.currentTarget, {
          title: `${m ? matName(m) : def.name} colour`,
          value: state.colors[key] || null,
          allowDefault: true,
          onPick: (c) => {
            const next = { ...state.colors };
            if (c) next[key] = c; else delete next[key];
            state.set({ colors: next });
          },
        });
      }, { title: 'Colour' });
      acts.append(labelled(b, 'Colour'));
    }
    if (def.accent) {
      const b = btn('hw-dotbtn hw-accent', 'Accent colour', h('span', { class: 'hw-dot', style: { background: state.accent } }), (e) => {
        openPalette(e.currentTarget, {
          title: 'Accent (doors, frames, shutters)',
          value: state.accent,
          onPick: (c) => state.set({ accent: c }),
        });
      }, { title: 'Accent colour' });
      acts.append(labelled(b, 'Accent'));
    }
    if (def.layer === 'R') {
      const off = state.hOffset || 0;
      const g = h('div', { class: 'hw-raise', role: 'group', 'aria-label': 'Roof height' },
        btn('hw-raise-btn', 'Lower roof piece', ico('down'), () => builder.raise(-1), { sound: false, title: 'Lower ([)' }),
        h('span', { class: 'hw-raise-val' + (off ? ' is-set' : '') }, off === 0 ? 'Auto' : (off > 0 ? `+${off}` : `${off}`)),
        btn('hw-raise-btn', 'Raise roof piece', ico('up'), () => builder.raise(1), { sound: false, title: 'Raise (])' }));
      acts.append(labelled(g, 'Height'));
    }
    if (turnable(def)) {
      // (railings and gables have nothing to turn: no button)
      const flip = def.rot === 'flip';
      const ic = h('span', { class: 'hw-rot-ic', style: { transform: `rotate(${rotSpin}deg)` }, html: svg(flip ? 'flip' : 'rotate') });
      const b = btn('hw-rbtn hw-rot', flip ? 'Flip' : 'Turn', ic, () => { if (performance.now() - turnTapAt > 700) builder.rotate(1); },
        { sound: false, title: "Turn what you're pointing at, or the piece you just placed (R)" });
      // a finger tapping Turn while another one aims (press and hold on the view) gets no click from the browser: the
      // tap acts on its own pointerup (its click, if one follows, is then ignored)
      b.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') turnPtr = e.pointerId; });
      b.addEventListener('pointerup', (e) => {
        if (e.pointerId !== turnPtr) return;
        turnPtr = null;
        const r = b.getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return;
        turnTapAt = performance.now();
        builder.rotate(1);
      });
      acts.append(labelled(b, flip ? 'Flip' : 'Turn'));
    }
    if (acts.childNodes.length) ctx.append(acts);
    ctx.classList.toggle('is-bare', mats.length <= 1 && !acts.childNodes.length && !collapsed);
  }

  function labelled(el, text) {
    return h('div', { class: 'hw-lbl' }, el, h('span', { class: 'hw-lbl-tx' }, text));
  }

  function seg(options, value, onPick, cls = '') {
    const wrap = h('div', { class: `hw-seg ${cls}`, role: 'radiogroup' });
    for (const o of options) {
      const on = o.id === value;
      wrap.append(btn('hw-seg-btn' + (on ? ' is-on' : ''), o.label, [o.icon ? h('span', { class: 'hw-seg-ic' }, o.icon) : null, h('span', null, o.label)], () => onPick(o.id), { attrs: { role: 'radio', 'aria-checked': String(on) } }));
    }
    return wrap;
  }

  // ---- paint panel (paint tool)
  // The material strip holds every group (walls, roof, floors, trim): a row of group buttons jumps it
  // straight to one, lights up as the strip scrolls, and the strip opens on the group that suits the
  // brush's material, else the piece in hand (roof pieces → roof materials …).
  let pmJump = null;     // 'sel' | group id: where the material strip should start on its next layout
  function paintGroupFor() {
    const def = curDef();
    let m = null;
    try { m = def ? builder.materialFor(def) : null; } catch { m = null; }
    const g = MATERIALS[m]?.group;
    return PAINT_GROUPS.some((x) => x.id === g && matList(g).length) ? g : (PAINT_GROUPS.find((x) => matList(x.id).length)?.id || null);
  }
  function renderPaint() {
    if (state.tool !== 'paint') { paintPanel.textContent = ''; return; }
    const keepA = paintPanel.querySelector('.hw-pm')?.scrollLeft || 0;
    const keepB = paintPanel.querySelector('.hw-pc')?.scrollLeft || 0;
    paintPanel.textContent = '';
    const accent = state.paintTarget === 'accent';

    const matsRow = h('div', { class: 'hw-pm hw-scroll' });
    const groupEls = new Map(), jumpBtns = new Map();
    matsRow.append(btn('hw-chip hw-keep' + (state.paintMat ? '' : ' is-sel'), 'Keep material', [ico('none'), h('span', { class: 'hw-chip-name' }, 'Keep')],
      (e) => { anchorChip(e.currentTarget); state.set({ paintMat: null }); }, { attrs: { 'data-key': '-keep' } }));
    for (const g of PAINT_GROUPS) {
      const list = matList(g.id);
      if (!list.length) continue;
      const lb = h('span', { class: 'hw-group-lb', 'data-group': g.id }, g.label);
      groupEls.set(g.id, lb);
      matsRow.append(lb);
      for (const mm of list) {
        const sel = state.paintMat === mm.id;
        const col = mm.paintable && state.paintColor ? state.paintColor : (mm.swatch || mm.color);
        matsRow.append(btn('hw-chip' + (sel ? ' is-sel' : ''), mm.name, [
          h('span', { class: 'hw-sw', style: { background: swatchBg(mm.id, col) } }),
          sel ? h('span', { class: 'hw-chip-name' }, mm.name) : null,
        ], (e) => { anchorChip(e.currentTarget); state.set({ paintMat: sel ? null : mm.id, paintTarget: 'main' }); }, { attrs: { 'data-key': mm.id } }));
      }
    }
    wheelScroll(matsRow);

    const jump = h('div', { class: 'hw-pjump', role: 'group', 'aria-label': 'Jump to a material group' });
    let spyHold = 0;
    const markJump = (id) => {
      for (const [gid, b] of jumpBtns) { b.classList.toggle('is-on', gid === id); b.setAttribute('aria-pressed', String(gid === id)); }
    };
    const groupLeft = (id) => {
      const lb = groupEls.get(id);
      if (!lb || id === groupEls.keys().next().value) return 0;     // the first group starts the strip (with Keep)
      const x = lb.getBoundingClientRect().left - matsRow.getBoundingClientRect().left + matsRow.scrollLeft - 4;
      return Math.max(0, Math.min(matsRow.scrollWidth - matsRow.clientWidth, x));
    };
    const scrollToGroup = (id, smooth) => {
      if (!groupEls.has(id)) return;
      markJump(id);
      spyHold = performance.now() + (smooth ? 700 : 0);
      matsRow.scrollTo({ left: groupLeft(id), behavior: smooth ? 'smooth' : 'auto' });
    };
    // light up the group the strip is showing (its label at the left edge; the last one once scrolled to the end)
    const spy = () => {
      if (performance.now() < spyHold || !matsRow.clientWidth) return;
      const max = matsRow.scrollWidth - matsRow.clientWidth;
      let cur = null;
      for (const id of groupEls.keys()) if (groupLeft(id) <= matsRow.scrollLeft + 24) cur = id;
      if (max > 0 && matsRow.scrollLeft >= max - 4) {
        // at the very end the last groups can't reach the left edge: pick the one taking most of the view
        const r = matsRow.getBoundingClientRect();
        for (const [id, lb] of groupEls) if (lb.getBoundingClientRect().left < r.left + r.width * 0.5) cur = id;
      }
      markJump(cur || groupEls.keys().next().value);
    };
    matsRow.addEventListener('scroll', spy, { passive: true });
    for (const g of PAINT_GROUPS) {
      if (!groupEls.has(g.id)) continue;
      const b = btn('hw-pj', `${g.label} materials`, g.label, () => scrollToGroup(g.id, true), { title: `Jump to ${g.label.toLowerCase()} materials`, attrs: { 'data-group': g.id, 'aria-pressed': 'false' } });
      jumpBtns.set(g.id, b);
      jump.append(b);
    }

    const colRow = h('div', { class: 'hw-pc hw-scroll' });
    if (!accent) colRow.append(btn('hw-chip hw-keep' + (state.paintColor ? '' : ' is-sel'), 'Keep colour', [ico('none'), h('span', { class: 'hw-chip-name' }, 'Keep')], () => state.set({ paintColor: null })));
    for (const c of PALETTE) {
      const sel = state.paintColor === c;
      colRow.append(btn('hw-pdot' + (sel ? ' is-sel' : ''), colorName(c), h('span', { class: 'hw-dot', style: { background: c } }, sel ? h('span', { class: 'hw-dot-ck' + (isLight(c) ? ' dark' : ''), html: svg('check') }) : null), () => state.set({ paintColor: c })));
    }
    wheelScroll(colRow);

    // header: what to paint + a preview of the current brush
    const pm = state.paintMat, pc = state.paintColor;
    const brush = accent
      ? (pc ? `Accent · ${colorName(pc)}` : 'Pick an accent colour')
      : [pm ? matName(pm) : null, pc ? colorName(pc) : null].filter(Boolean).join(' · ') || 'Pick a material or colour';
    const prevBg = !accent && pm ? swatchBg(pm, MATERIALS[pm]?.paintable && pc ? pc : matColor(pm)) : (pc || 'repeating-linear-gradient(135deg, #f4ecdc 0 4px, #e9dcc3 4px 8px)');
    paintPanel.append(h('div', { class: 'hw-phead' },
      seg([{ id: 'main', label: 'Main' }, { id: 'accent', label: 'Accent' }], accent ? 'accent' : 'main', (v) => state.set({ paintTarget: v }), 'hw-seg-sm'),
      h('div', { class: 'hw-brush' }, h('span', { class: 'hw-sw' + (accent ? ' hw-sw-acc' : ''), style: { background: prevBg } }), h('span', null, brush)),
      btn('hw-pill hw-phead-done', 'Back to building', [ico('check'), h('span', null, 'Done')], () => state.set({ tool: 'build' }))));
    if (!accent) paintPanel.append(h('div', { class: 'hw-prow hw-prow-m' }, h('div', { class: 'hw-prow-head' }, h('span', { class: 'hw-prow-lb' }, 'Material'), jump), matsRow));
    paintPanel.append(h('div', { class: 'hw-prow' }, h('span', { class: 'hw-prow-lb' }, accent ? 'Accent colour · doors, frames & shutters' : 'Colour'), colRow));
    requestAnimationFrame(() => {
      if (!matsRow.isConnected) return;     // re-rendered meanwhile: the newer strip takes the jump
      colRow.scrollLeft = keepB;
      if (accent) return;
      const want = pmJump;
      pmJump = null;
      if (want === 'sel') ensureVisible(matsRow, matsRow.querySelector('.hw-chip.is-sel'), false, true);
      else if (want) scrollToGroup(want, false);
      else if (restoreAnchor(matsRow)) {
        // a chip just picked stays under the finger, and its group's button lights up
        let lb = matsRow.querySelector('.hw-chip.is-sel:not(.hw-keep)');
        while (lb && !lb.classList.contains('hw-group-lb')) lb = lb.previousElementSibling;
        if (lb) { markJump(lb.dataset.group); spyHold = performance.now() + 800; }
      } else matsRow.scrollLeft = keepA;
      spy();
    });
  }

  // ------------------------------------------------------------------ popovers (palette, piece info)

  const catcher = h('div', { class: 'hw-catcher' });
  const pop = h('div', { class: 'hw-pop', role: 'dialog' });
  root.append(catcher, pop);
  catcher.addEventListener('pointerdown', (e) => { e.preventDefault(); closePop(); });
  window.addEventListener('resize', () => closePop());
  let popOpen = false;

  function placePop(anchor) {
    const r = anchor.getBoundingClientRect();
    pop.style.left = '0px'; pop.style.top = '0px';
    const pw = pop.offsetWidth, ph = pop.offsetHeight;
    const vw = window.innerWidth;
    let left = r.left + r.width / 2 - pw / 2;
    left = Math.max(8, Math.min(vw - pw - 8, left));
    let topY = r.top - ph - 12;
    if (topY < 8) topY = Math.min(window.innerHeight - ph - 8, r.bottom + 12);
    pop.style.left = `${Math.round(left)}px`;
    pop.style.top = `${Math.round(topY)}px`;
    pop.style.setProperty('--arrow-x', `${Math.round(r.left + r.width / 2 - left)}px`);
    pop.classList.toggle('below', topY > r.top);
  }

  function showPop(anchor, content, cls = '') {
    pop.className = `hw-pop ${cls}`;
    pop.textContent = '';
    pop.append(content);
    pop.classList.add('is-open');
    catcher.classList.add('is-open');
    popOpen = true;
    placePop(anchor);
  }
  function closePop() {
    if (!popOpen) return;
    popOpen = false;
    pop.classList.remove('is-open');
    catcher.classList.remove('is-open');
  }

  function openPalette(anchor, { title, value, onPick, allowDefault = false }) {
    const grid = h('div', { class: 'hw-palette' });
    const natural = allowDefault
      ? btn('hw-pill hw-natural' + (!value ? ' is-sel' : ''), 'Natural colour', [ico('none'), h('span', null, 'Natural')], () => { onPick(null); closePop(); }, { title: 'Back to the natural colour' })
      : null;
    for (const c of PALETTE) {
      const sel = value && value.toLowerCase() === c.toLowerCase();
      grid.append(btn('hw-pdot' + (sel ? ' is-sel' : ''), colorName(c), h('span', { class: 'hw-dot', style: { background: c } }, sel ? h('span', { class: 'hw-dot-ck' + (isLight(c) ? ' dark' : ''), html: svg('check') }) : null), () => { onPick(c); closePop(); }));
    }
    showPop(anchor, h('div', null, h('div', { class: 'hw-pop-head' }, h('span', { class: 'hw-pop-title' }, title), natural), grid), 'hw-pop-palette');
  }

  function showInfo(def, anchor) {
    const tags = [];
    tags.push(def.slot === 'edge' ? 'Sits on grid lines' : def.slot === 'corner' ? 'Sits on corners' : def.layer === 'R' ? 'Stacks into roofs' : 'Fills a square');
    if (def.mats?.length > 1) tags.push(`${def.mats.length} materials`);
    if (def.paint || def.paintAlways) tags.push('Paintable');
    if (def.accent) tags.push('Accent colour');
    const [lo, hi] = def.levels || [0, MAX_LEVEL];
    if (lo === hi) tags.push(`Floor ${lo + 1} only`);
    else if (lo > 0) tags.push(`Floor ${lo + 1}+`);
    const img = h('img', { alt: '' });
    const thumb = h('span', { class: 'hw-info-thumb' }, h('span', { class: 'hw-card-emoji' }, def.icon || '◻️'), img);
    app.thumbnail?.(def.id, thumbRec(def))?.then?.((u) => { if (u) { img.src = u; thumb.classList.add('has-img'); } }, () => {});
    const gi = def.gift ? giftInfo(def.id) : null;
    const body = h('div', { class: 'hw-info' }, thumb,
      h('div', { class: 'hw-info-tx' },
        h('b', null, def.name),
        h('p', null, def.desc || 'A lovely piece for your home.'),
        gi?.from ? h('p', { class: 'hw-info-gift' }, `🎁 A thank-you from ${gi.from}`) : null,
        h('div', { class: 'hw-tags' }, tags.map((t) => h('span', null, t))),
        state.pieceId !== def.id ? btn('hw-pill hw-pill-primary hw-info-use', `Use ${def.name}`, h('span', null, 'Use this piece'), () => { builder.selectPiece(def.id); closePop(); }) : null));
    showPop(anchor, body, 'hw-pop-info');
  }

  // ------------------------------------------------------------------ top stack: blueprint HUD + toasts

  const topStack = h('div', { class: 'hw-topstack' });
  const hud = h('div', { class: 'hw-hud hw-hide-photo', role: 'status' });
  const toasts = h('div', { class: 'hw-toasts', 'aria-live': 'polite' });
  // while Draw is on, say so (and offer the way back) right where the eye is
  const chipTx = h('small');
  const modeChip = btn('hw-modechip hw-hide-photo', 'Back to look mode', [h('span', { class: 'hw-modechip-ic' }, '✏️'), h('b', null, 'Draw'), chipTx, ico('close')],
    () => { state.set({ drawMode: false }); toast('✋ Look: drag a finger to look around', 'info', 1800); }, { attrs: { 'data-act': 'draw-off' }, title: 'Back to look mode (D)' });
  topStack.append(hud, toasts);
  root.append(topStack, modeChip);
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => syncInsets()).observe(hud);

  const live = new Map(); // text -> { el, timer }
  /** A toast; with `action: { label, fn }` it carries a button (and takes taps: .has-act has pointer events). */
  function toast(text, kind = 'info', ms = 2400, action = null) {
    if (!text) return;
    const existing = live.get(text);
    if (existing) {
      clearTimeout(existing.timer);
      existing.el.classList.remove('pulse'); void existing.el.offsetWidth; existing.el.classList.add('pulse');
      existing.timer = setTimeout(() => dropToast(text), ms);
      return;
    }
    const act = action && typeof action.fn === 'function' && action.label
      ? h('button', {
        type: 'button', class: 'hw-toast-act', 'aria-label': String(action.label),
        onclick: (e) => {
          e.stopPropagation();
          sfx('click');
          dropToast(text);
          try { action.fn(); } catch (err) { console.error('[ui] toast action', err); }
        },
      }, String(action.label))
      : null;
    const el = act
      ? h('div', { class: `hw-toast is-${kind} has-act` }, h('span', null, text), act)
      : h('div', { class: `hw-toast is-${kind}` }, text);
    toasts.append(el);
    requestAnimationFrame(() => el.classList.add('in'));
    const rec = { el, timer: setTimeout(() => dropToast(text), ms) };
    live.set(text, rec);
    while (toasts.children.length > 3) {
      const first = toasts.firstElementChild;
      for (const [k, v] of live) if (v.el === first) { clearTimeout(v.timer); live.delete(k); }
      first.remove();
    }
  }
  function dropToast(text) {
    const rec = live.get(text);
    if (!rec) return;
    live.delete(text);
    rec.el.classList.remove('in');
    rec.el.classList.add('out');
    setTimeout(() => rec.el.remove(), 260);
  }

  // ---- blueprint guide HUD
  let bp = null;       // last progress {id, done, total, stage, stageName}
  let hudHide = null;
  function bpInfo(id) {
    const B = app.blueprints;
    if (!B || !id) return null;
    try { return B.get?.(id) || B.list?.().find((b) => b.id === id) || null; } catch { return null; }
  }
  const hudEmoji = h('span', { class: 'hw-hud-emoji' });
  const hudName = h('b'), hudStage = h('small');
  const hudNum = h('span', { class: 'hw-hud-num' });
  const hudFill = h('i');
  const hudNext = btn('hw-pill hw-pill-primary', 'Next piece', h('span', null, 'Next piece'), () => {
    try { app.blueprints?.selectNext?.(); } catch (e) { console.warn(e); }
  }, { attrs: { 'data-act': 'next' } });
  const hudStopLb = h('span', null, 'Stop');
  const hudStop = btn('hw-pill', 'Stop guides', hudStopLb, () => stopGuides(), { attrs: { 'data-act': 'stop' } });
  hud.append(hudEmoji, h('div', { class: 'hw-hud-tx' }, hudName, hudStage), hudNum, h('div', { class: 'hw-bar' }, hudFill), h('div', { class: 'hw-hud-acts' }, hudNext, hudStop));

  function renderHud() {
    const id = bp?.id || state.blueprint;
    if (!id) { hud.classList.remove('is-open'); return; }
    const info = bpInfo(id) || {};
    const done = bp?.done || 0, total = bp?.total || info.count || 0;
    const finished = total > 0 && done >= total;
    const frac = total ? Math.min(1, done / total) : 0;
    const stage = bp?.stageName ? `${bp.stage !== undefined && bp.stage !== null ? `Step ${Number(bp.stage) + 1}: ` : ''}${bp.stageName}` : 'Follow the glowing guides';
    hud.classList.toggle('is-done', finished);
    hudEmoji.textContent = info.emoji || info.icon || '📐';
    hudName.textContent = info.name || 'Blueprint';
    // finished: the card folds into one small row (CSS .is-done) that is also the "welcome home" note. Two
    // phrases (inline blocks): a narrow phone wraps it as "All done —" / "welcome home! 🎉", and only a very
    // narrow one breaks inside a phrase — never cut off
    if (finished) hudStage.replaceChildren(h('span', null, 'All done —'), ' ', h('span', null, 'welcome home!\u00a0🎉'));
    else hudStage.textContent = stage;
    hudNum.textContent = total ? `${done}/${total}` : '';
    hudFill.style.width = `${(frac * 100).toFixed(1)}%`;
    hudNext.style.display = !finished && typeof app.blueprints?.selectNext === 'function' ? '' : 'none';
    hudStopLb.textContent = finished ? 'Close' : 'Stop';
    hudStop.setAttribute('aria-label', finished ? 'Close' : 'Stop guides');
    hud.classList.add('is-open');
    clearTimeout(hudHide);
    if (finished) hudHide = setTimeout(() => { if (bp && bp.done >= bp.total) { hud.classList.remove('is-open'); tuckForGuides(false); } }, 6000);
  }
  const shortMQ = matchMedia('(orientation: landscape) and (max-height: 540px)');
  let autoTucked = false;
  function tuckForGuides(on) {
    if (on && shortMQ.matches && !collapsed) { autoTucked = true; setCollapsed(true, false); }
    else if (!on && autoTucked) { autoTucked = false; if (collapsed) setCollapsed(false, false); }
  }
  function stopGuides() {
    try { app.blueprints?.stop?.(); } catch (e) { console.warn(e); }
    bp = null;
    if (state.blueprint) state.set({ blueprint: null });
    hud.classList.remove('is-open');
    tuckForGuides(false);
  }

  // ------------------------------------------------------------------ menu sheet

  const sheetWrap = h('div', { class: 'hw-sheet-wrap' });
  const backdrop = h('div', { class: 'hw-backdrop' });
  const sheetTitle = h('h2', null);
  const sheetBack = btn('hw-rbtn hw-sheet-back', 'Back', ico('back'), () => goPage('main'));
  const sheetClose = btn('hw-rbtn hw-sheet-close', 'Close', ico('close'), () => closeSheet(), { sound: false });
  const sheetHead = h('header', { class: 'hw-sheet-head' }, h('div', { class: 'hw-grip' }), sheetBack, sheetTitle, sheetClose);
  const sheetBody = h('div', { class: 'hw-sheet-body' });
  const sheet = h('div', { class: 'hw-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Menu' }, sheetHead, sheetBody);
  sheetWrap.append(backdrop, sheet);
  root.append(sheetWrap);
  backdrop.addEventListener('click', () => closeSheet());

  let page = null;
  let pageRefs = {};
  const PAGES = {
    main: { title: 'Hearthwood', render: pageMain },
    saves: { title: 'Save & Load', render: pageSaves },
    blueprints: { title: 'Blueprints', render: pageBlueprints },
    share: { title: 'Share a build', render: pageShare },
    settings: { title: 'Settings', render: pageSettings },
    help: { title: 'How to play', render: pageHelp },
  };

  function openSheet(name = 'main') {
    closePop();
    hideWelcome(false);
    const wasOpen = sheetWrap.classList.contains('is-open');
    goPage(name, false);
    if (!wasOpen) {
      sheetWrap.classList.add('is-open');
      root.classList.add('sheet-open');
      sfx('open');
      builder.hideGhost?.();
    }
  }
  function closeSheet(sound = true) {
    if (!sheetWrap.classList.contains('is-open')) return;
    sheetWrap.classList.remove('is-open');
    root.classList.remove('sheet-open');
    page = null;
    pageRefs = {};
    if (sound) sfx('close');
  }
  function goPage(name, sound = true) {
    const P = PAGES[name] || PAGES.main;
    page = name;
    pageRefs = {};
    sheetTitle.textContent = P.title;
    sheetBack.style.visibility = name === 'main' ? 'hidden' : 'visible';
    sheetBody.textContent = '';
    sheetBody.scrollTop = 0;
    sheetBody.append(P.render());
    sheet.dataset.page = name;
    if (sound && name !== 'main') sfx('click');
  }
  function refreshPage() { if (page) { const st = sheetBody.scrollTop; goPage(page, false); sheetBody.scrollTop = st; } }

  // swipe the sheet header down to close
  {
    let sy = null, dy = 0;
    const dialogMQ = matchMedia('(min-width: 760px) and (min-height: 560px)');
    sheetHead.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button') || dialogMQ.matches) return;
      sy = e.clientY; dy = 0;
      sheetHead.setPointerCapture?.(e.pointerId);
      sheet.style.transition = 'none';
    });
    sheetHead.addEventListener('pointermove', (e) => {
      if (sy === null) return;
      dy = Math.max(0, e.clientY - sy);
      sheet.style.transform = `translateY(${dy}px)`;
    });
    const end = () => {
      if (sy === null) return;
      sy = null;
      sheet.style.transition = '';
      sheet.style.transform = '';
      if (dy > 90) closeSheet();
    };
    sheetHead.addEventListener('pointerup', end);
    sheetHead.addEventListener('pointercancel', end);
  }

  // ---- main menu
  function pageMain() {
    const tiles = [
      { id: 'new', icon: '🌱', title: 'New build', sub: 'A fresh, empty meadow', fn: newBuild },
      { id: 'saves', icon: '💾', title: 'Save & Load', sub: `${SLOT_COUNT} cozy slots`, fn: () => goPage('saves') },
      { id: 'blueprints', icon: '📐', title: 'Blueprints', sub: 'Cabins, A-frames & farmhouses', fn: () => goPage('blueprints') },
      { id: 'share', icon: '💌', title: 'Share', sub: 'Swap build codes', fn: () => goPage('share') },
      { id: 'photo', icon: '📸', title: 'Photo mode', sub: 'Hide the buttons & snap', fn: startPhoto },
      { id: 'settings', icon: '⚙️', title: 'Settings', sub: 'Sound, time & seasons', fn: () => goPage('settings') },
      { id: 'help', icon: '🧭', title: 'How to play', sub: 'Gestures & shortcuts', fn: () => goPage('help') },
    ];
    const n = world.count;
    const town = townTile();
    return h('div', { class: 'hw-page hw-page-main' },
      h('div', { class: 'hw-hero' },
        h('div', { class: 'hw-hero-house', html: HOUSE_SVG }),
        h('div', null,
          h('b', null, n ? `Your home has ${n} piece${n === 1 ? '' : 's'}` : 'Your meadow is waiting'),
          h('small', null, n ? 'Every board placed with love.' : 'Start with a foundation, then walls and a roof.'))),
      h('div', { class: 'hw-tiles' }, town, tiles.map((t) => btn(`hw-tile hw-tile-${t.id}`, t.title, [
        h('span', { class: 'hw-tile-ic' }, t.icon),
        h('span', { class: 'hw-tile-tx' }, h('b', null, t.title), h('small', null, t.sub)),
      ], t.fn, { sound: 'click', attrs: { 'data-page': t.id } }))));
  }

  /** Menu's first row while the villagers are on, at every width (the hearth chip hides on the narrowest phones). */
  function townTile() {
    const t = app.town;
    let on = false, cz = null, V = null;
    try { on = !!t?.enabled?.(); if (on) { cz = t.cozy?.() || null; V = t.view?.() || null; } } catch { on = false; }
    if (!on || !townHud) return null;
    const tier = { quiet: 'Quiet', content: 'Content', cheerful: 'Cheerful', glowing: 'Glowing' }[cz?.tier] || '';
    const folk = (V?.villagers || []).filter((v) => v && v.status !== 'traveller').length;
    const wishes = Number(V?.openWishes) || 0;
    const sub = [cz ? `Cozy ${Math.round(Number(cz.value) || 0)}${tier ? ' · ' + tier : ''}` : null,
      folk ? `${folk} neighbour${folk === 1 ? '' : 's'}` : 'No neighbours yet', wishes ? `${wishes} wish${wishes === 1 ? '' : 'es'} open` : null].filter(Boolean).join(' · ');
    return btn('hw-tile hw-tile-town', 'Town', [
      h('span', { class: 'hw-tile-ic' }, '🔥'),
      h('span', { class: 'hw-tile-tx' }, h('b', null, 'Town'), h('small', null, sub)),
    ], () => { closeSheet(false); townHud?.openTown(); }, { sound: 'click', attrs: { 'data-page': 'town' } });
  }

  async function newBuild() {
    if (world.count && !onlyWelcome()) {
      const ok = await ask({ icon: '🌱', title: 'Start a new build?', text: 'The meadow will be cleared. You can still undo it.', buttons: [{ label: 'Clear the meadow', value: 'yes', kind: 'danger' }] });
      if (ok !== 'yes') return;
    }
    if (app.blueprints?.active?.()) stopGuides();
    if (app.newBuild) app.newBuild(); else world.clear({ record: true });
    state.set({ level: 0, seeAll: true, hOffset: 0, tool: 'build' });
    // hand the player what the toast tells them to start with, and frame the middle of the meadow
    if (catalog.getDef('foundation')) builder.selectPiece('foundation');
    const g = app.rig?.goal;
    if (g) app.rig.focus(0, 1, 2, Math.max(18, Math.min(32, g.radius)));
    closeSheet(false);
    sfx('success');
    toast('🌱 Fresh meadow — start with a foundation!', 'success');
  }

  // ---- saves
  function currentName() { return lsGet(LS_NAME) || 'My Cozy Home'; }
  function pageSaves() {
    const nameIn = h('input', { class: 'hw-input', type: 'text', maxlength: '40', value: currentName(), 'aria-label': 'Build name', placeholder: 'Name your home', enterkeyhint: 'done', autocomplete: 'off' });
    nameIn.addEventListener('change', () => lsSet(LS_NAME, nameIn.value.trim() || 'My Cozy Home'));
    nameIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') nameIn.blur(); });
    pageRefs.nameIn = nameIn;
    const slots = storage.listSlots();
    const grid = h('div', { class: 'hw-slots' });
    for (const s of slots) grid.append(slotCard(s));
    return h('div', { class: 'hw-page' },
      h('label', { class: 'hw-field' }, h('span', null, 'Name'), nameIn),
      h('p', { class: 'hw-note' }, 'Your build also autosaves as you go. Slots keep extra copies safe.'),
      grid);
  }
  function slotCard(s) {
    const cur = state.slot === s.n && !s.empty;
    const img = s.thumb ? h('img', { src: s.thumb, alt: '' }) : h('span', { class: 'hw-slot-empty' }, s.empty ? '🌾' : '🏡');
    return h('div', { class: 'hw-slot' + (s.empty ? ' is-empty' : '') + (cur ? ' is-cur' : ''), 'data-slot': s.n },
      h('div', { class: 'hw-slot-img' }, img, h('span', { class: 'hw-slot-n' }, String(s.n))),
      h('div', { class: 'hw-slot-meta' },
        h('b', null, s.empty ? 'Empty slot' : s.name || `House ${s.n}`),
        h('small', null, s.empty ? 'Ready for a new home' : `${fmtDate(s.date)} · ${s.count} piece${s.count === 1 ? '' : 's'}`)),
      h('div', { class: 'hw-slot-acts' },
        btn('hw-pill hw-pill-primary hw-save', `Save to slot ${s.n}`, h('span', null, 'Save'), () => saveTo(s), { attrs: { 'data-act': 'save' } }),
        s.empty ? null : btn('hw-pill hw-load', `Load slot ${s.n}`, h('span', null, 'Load'), () => loadFrom(s), { attrs: { 'data-act': 'load' } }),
        s.empty ? null : btn('hw-rbtn hw-rbtn-sm hw-del', `Delete slot ${s.n}`, ico('trash'), () => delSlot(s), { attrs: { 'data-act': 'delete' } })));
  }
  async function saveTo(s) {
    if (!world.count) { toast('Build something first 🙂', 'warn'); return; }
    const name = (pageRefs.nameIn?.value || '').trim() || currentName();
    lsSet(LS_NAME, name);
    if (!s.empty) {
      const ok = await ask({ icon: '💾', title: `Replace “${s.name}”?`, text: `Slot ${s.n} will be overwritten with “${name}”.`, buttons: [{ label: 'Replace', value: 'yes', kind: 'primary' }] });
      if (ok !== 'yes') return;
    }
    let thumb = null;
    try { thumb = captureThumb(); } catch (e) {
      try { thumb = app.snapshot?.(320, 'image/jpeg', 0.8) || null; } catch { thumb = null; }
    }
    const ok = storage.saveSlot(s.n, world.serialize(), { name, thumb, cam: app.rig?.getView?.() });
    if (ok) {
      state.set({ slot: s.n });
      sfx('success');
      toast(`💾 Saved “${name}” to slot ${s.n}`, 'success');
    } else toast('Could not save — storage is full', 'warn');
    if (page === 'saves') refreshPage();
  }
  /** True when the meadow only holds the first-visit scenery (nothing the player built). */
  const onlyWelcome = () => app.welcomeLot !== undefined && world.version === app.welcomeLot;

  /**
   * Swap the meadow for loaded data (a slot or a friend's code) as ONE undo step, so a mistaken
   * confirm is never final. Undoing it also brings back the view and slot the player had before.
   */
  let loadMark = null;     // { depth, view, slot } of the last load
  const undoDepth = () => (Array.isArray(world.undoStack) ? world.undoStack.length : -1);
  function swapInBuild(data) {
    const view = app.rig?.getView?.() || null, slot = state.slot;
    if (app.blueprints?.active?.()) stopGuides();
    app.loadBuild(data, { record: true });
    const depth = undoDepth();
    loadMark = depth > 0 && world.canUndo() ? { depth, view, slot } : null;
  }
  // the load's undo step was just undone: return to the old view (and slot marker) along with the old build
  function afterUndo() {
    const m = loadMark;
    if (!m || undoDepth() !== m.depth - 1) return;
    loadMark = null;
    if (m.view) app.rig?.setView?.(m.view);
    if (state.slot !== m.slot) state.set({ slot: m.slot });
  }

  async function loadFrom(s) {
    const data = storage.loadSlot(s.n);
    if (!data || !data.pieces.length) { toast('That slot is empty', 'warn'); return; }
    if (world.count && !onlyWelcome()) {
      const ok = await ask({ icon: '🏡', title: `Load “${data.name || `House ${s.n}`}”?`, text: 'Your current build will be replaced. Changed your mind? Undo brings it back.', buttons: [{ label: 'Load it', value: 'yes', kind: 'primary' }] });
      if (ok !== 'yes') return;
    }
    swapInBuild(data);
    state.set({ slot: s.n, tool: 'build' });
    if (data.name) lsSet(LS_NAME, data.name);
    closeSheet(false);
    sfx('success');
    toast(data.dropped
      ? `🏡 Welcome back to ${data.name || `House ${s.n}`} (${data.dropped} piece${data.dropped === 1 ? '' : 's'} couldn’t be used)`
      : `🏡 Welcome back to ${data.name || `House ${s.n}`}`, data.dropped ? 'info' : 'success', data.dropped ? 3600 : 2400);
  }
  async function delSlot(s) {
    const ok = await ask({ icon: '🗑️', title: `Delete “${s.name}”?`, text: `Slot ${s.n} will be emptied. This can’t be undone.`, buttons: [{ label: 'Delete', value: 'yes', kind: 'danger' }] });
    if (ok !== 'yes') return;
    storage.deleteSlot(s.n);
    sfx('remove');
    toast(`Slot ${s.n} is empty now`);
    if (page === 'saves') refreshPage();
  }

  /** Small landscape snapshot of the visible 3D area (between the top bar and the tray). */
  function captureThumb(w = 320, ht = 200) {
    const r = app.renderer, cv = r.domElement;
    const grid = builder.grid;
    const gridVis = grid ? grid.visible : false;
    if (grid) grid.visible = false;
    builder.hideGhost?.();
    r.render(app.scene, app.camera);
    if (grid) grid.visible = gridVis;
    const W = cv.width, H = cv.height;
    const sc = H / Math.max(1, cv.clientHeight || window.innerHeight);
    const topY = Math.max(0, top.getBoundingClientRect().bottom) * sc;
    const trayTop = tray.getBoundingClientRect().top;
    const botY = Math.min(H, (trayTop > 0 ? trayTop : window.innerHeight) * sc);
    const vh = Math.max(H * 0.3, botY - topY);
    const cy = topY + vh / 2;
    let sw = W, sh = sw * (ht / w);
    if (sh > vh) { sh = vh; sw = sh * (w / ht); }
    const sx = (W - sw) / 2, sy = Math.max(0, Math.min(H - sh, cy - sh / 2));
    const c = document.createElement('canvas');
    c.width = w; c.height = ht;
    c.getContext('2d').drawImage(cv, sx, sy, sw, sh, 0, 0, w, ht);
    return c.toDataURL('image/jpeg', 0.8);
  }

  // ---- blueprints
  function pageBlueprints() {
    const B = app.blueprints;
    let list = [];
    try { list = B?.list?.() || []; } catch (e) { console.warn(e); }
    if (!B || !list.length) {
      return h('div', { class: 'hw-page hw-empty' }, h('div', { class: 'hw-empty-ic' }, '📐'), h('b', null, 'Blueprints are still being drawn'), h('p', null, 'Check back soon — for now, free build to your heart’s content!'));
    }
    return h('div', { class: 'hw-page' },
      h('p', { class: 'hw-note' }, 'Follow the glowing guides piece by piece, or place a whole house at once and make it your own.'),
      h('div', { class: 'hw-bps' }, list.map((b) => bpCard(b))));
  }
  function difficulty(d) {
    if (d === undefined || d === null || d === '') return null;
    if (typeof d === 'number') return ['Easy', 'Easy', 'Medium', 'Tricky', 'Big project'][Math.max(0, Math.min(4, Math.round(d)))];
    const s = String(d);
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  function bpCard(b) {
    const count = b.count ?? b.pieceCount ?? (Array.isArray(b.pieces) ? b.pieces.length : null);
    const diff = difficulty(b.difficulty);
    const diffLevel = typeof b.difficulty === 'number' ? b.difficulty : ({ easy: 1, medium: 2, hard: 3, tricky: 3, cozy: 1, handy: 2, crafty: 3 })[String(b.difficulty).toLowerCase()] || 0;
    return h('div', { class: 'hw-bp', 'data-bp': b.id },
      h('div', { class: 'hw-bp-art' }, b.thumb ? h('img', { src: b.thumb, alt: '' }) : h('span', null, b.emoji || b.icon || '🏠')),
      h('div', { class: 'hw-bp-tx' },
        h('b', null, b.name || b.id),
        h('div', { class: 'hw-tags' },
          diff ? h('span', { class: `hw-diff d${diffLevel}` }, diff) : null,
          count ? h('span', null, `${count} pieces`) : null,
          b.style ? h('span', null, b.style) : null),
        h('p', null, b.desc || b.description || '')),
      h('div', { class: 'hw-bp-acts' },
        B_HAS('startGuided') ? btn('hw-pill hw-pill-primary', `Build ${b.name} with guides`, h('span', null, 'Build it with guides'), () => startBlueprint(b, 'guided'), { attrs: { 'data-act': 'guided' } }) : null,
        B_HAS('stamp') ? btn('hw-pill', `Place ${b.name} instantly`, h('span', null, 'Place it instantly'), () => startBlueprint(b, 'stamp'), { attrs: { 'data-act': 'stamp' } }) : null));
  }
  const B_HAS = (fn) => typeof app.blueprints?.[fn] === 'function';

  async function startBlueprint(b, how) {
    // the scenery lot a brand-new player starts with doesn't count as "their build"
    if (onlyWelcome()) world.clear({ record: false });
    else if (world.count) {
      const v = await ask({
        icon: b.emoji || '📐', title: 'Your meadow isn’t empty',
        text: how === 'guided' ? 'Clear it first so the guides have room, or build around what’s there?' : 'Clear it first, or place the house alongside your build?',
        buttons: [{ label: 'Clear & start', value: 'clear', kind: 'primary' }, { label: 'Keep my build', value: 'keep' }],
      });
      if (!v) return;
      if (v === 'clear') { if (app.newBuild) app.newBuild(); else world.clear({ record: true }); }
    }
    closeSheet(false);
    state.set({ tool: 'build', level: 0 });
    try {
      if (how === 'guided') {
        app.blueprints.startGuided(b.id);
        bp = (bp && bp.id === b.id) ? bp : { id: b.id, done: 0, total: b.count ?? b.pieceCount ?? 0, stage: 0, stageName: '' };
        renderHud();
        tuckForGuides(true);
        sfx('open');
      } else {
        app.blueprints.stamp(b.id, { animate: true, record: true });
        sfx('success');
        toast(`${b.emoji || '🏡'} ${b.name} is going up!`, 'success');
      }
    } catch (e) {
      console.error('[ui] blueprint failed', e);
      toast('That blueprint got smudged — try another', 'warn');
    }
  }

  // ---- share
  function pageShare() {
    const out = h('textarea', { class: 'hw-code', readonly: true, rows: '3', placeholder: 'Your build code will appear here', 'aria-label': 'Your build code', spellcheck: 'false' });
    const inp = h('textarea', { class: 'hw-code', rows: '3', placeholder: 'Paste a friend’s code here (HW1:…)', 'aria-label': 'Paste a build code', spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off' });
    pageRefs.out = out; pageRefs.inp = inp;
    const copyBtn = btn('hw-pill', 'Copy code', [ico('copy'), h('span', null, 'Copy')], async () => {
      if (!out.value) await makeCode();
      if (!out.value) return;
      const ok = await copyText(out.value, out);
      toast(ok ? '📋 Code copied!' : 'Select the code and copy it', ok ? 'success' : 'info');
    }, { attrs: { 'data-act': 'copy' } });
    const shareBtn = navigator.share ? btn('hw-pill', 'Share code', [ico('share'), h('span', null, 'Share')], async () => {
      if (!out.value) await makeCode();
      if (!out.value) return;
      try { await navigator.share({ title: 'My Hearthwood home', text: out.value }); } catch { /* cancelled */ }
    }) : null;
    async function makeCode() {
      if (!world.count) { toast('Build something first 🙂', 'warn'); return; }
      try {
        out.value = await storage.exportCode(world.serialize());
        out.classList.add('is-filled');
      } catch (e) { console.warn(e); toast('Could not make a code', 'warn'); }
    }
    return h('div', { class: 'hw-page' },
      h('section', { class: 'hw-card-sec' },
        h('h3', null, '💌 Send your home'),
        h('p', { class: 'hw-note' }, 'Turn your build into a little code that friends can paste into their game.'),
        out,
        h('div', { class: 'hw-row' }, btn('hw-pill hw-pill-primary', 'Create code', h('span', null, 'Create code'), makeCode, { attrs: { 'data-act': 'export' } }), copyBtn, shareBtn)),
      h('section', { class: 'hw-card-sec' },
        h('h3', null, '📬 Open a friend’s home'),
        inp,
        h('div', { class: 'hw-row' }, btn('hw-pill hw-pill-primary', 'Load this build', h('span', null, 'Load this build'), () => importBuild(inp.value), { attrs: { 'data-act': 'import' } }))));
  }
  async function importBuild(code) {
    if (!code || !code.trim()) { toast('Paste a code first', 'warn'); return; }
    const data = await storage.importCode(code);
    // garbage, or a code with no pieces in it: never swap the player's home for an empty meadow
    if (!data || !Array.isArray(data.pieces) || !data.pieces.length) { toast('🤔 Hmm, there’s no home in that code — check it was copied whole', 'warn', 3200); return; }
    const n = data.pieces.length, piecesTxt = `${n} piece${n === 1 ? '' : 's'}`;
    if (world.count && !onlyWelcome()) {
      const ok = await ask({ icon: '📬', title: 'Open this home?', text: `It has ${piecesTxt}. Your current build will be replaced — Undo brings it back.`, buttons: [{ label: 'Open it', value: 'yes', kind: 'primary' }] });
      if (ok !== 'yes') return;
    }
    swapInBuild(data);
    closeSheet(false);
    sfx('success');
    toast(data.dropped
      ? `📬 Opened a home with ${piecesTxt} (${data.dropped} couldn’t be used)`
      : `📬 Opened a home with ${piecesTxt}`, data.dropped ? 'info' : 'success', data.dropped ? 3600 : 2400);
  }
  async function copyText(text, ta) {
    try { await navigator.clipboard.writeText(text); return true; } catch { /* fall back */ }
    try { ta.focus(); ta.select(); return document.execCommand('copy'); } catch { return false; }
  }

  // ---- settings
  function toggle(key, label, icon) {
    const on = !!state[key];
    const b = btn('hw-switch' + (on ? ' is-on' : ''), label, h('i'), () => state.set({ [key]: !state[key] }), { attrs: { role: 'switch', 'aria-checked': String(on), 'data-key': key } });
    pageRefs[key] = b;
    // the whole row is the target (the switch itself is small)
    const row = h('div', { class: 'hw-set-row hw-set-tap' }, h('span', { class: 'hw-set-ic' }, icon), h('span', { class: 'hw-set-lb' }, label), b);
    row.addEventListener('click', (e) => { if (!e.target.closest('button')) b.click(); });
    return row;
  }
  function syncSettings(changed) {
    if (page !== 'settings') return;
    for (const k of ['sound', 'music', 'shadows', 'timeFlow', 'village', 'chatter', 'aimLift']) {
      if (!changed.includes(k) || !pageRefs[k]) continue;
      pageRefs[k].classList.toggle('is-on', !!state[k]);
      pageRefs[k].setAttribute('aria-checked', String(!!state[k]));
    }
    if (changed.includes('time') && pageRefs.time) {
      if (document.activeElement !== pageRefs.time && Math.abs(+pageRefs.time.value - state.time) > 0.0015) pageRefs.time.value = String(state.time);
      const lb = fmtTime(state.time), ic = timeIcon(state.time);
      if (pageRefs.timeLb.textContent !== lb) pageRefs.timeLb.textContent = lb;
      if (pageRefs.timeIc.textContent !== ic) pageRefs.timeIc.textContent = ic;
    }
    if (['quality', 'season', 'weather'].some((k) => changed.includes(k))) refreshPage();
  }
  /** Settings → Village (docs/LIVING.md §10.7): only when the town module loaded. With ?town=0 (or a showcase) the
   *  switches show the saved value, noted as off for this page. */
  function villageSection() {
    if (!app.town) return null;
    const offHere = params.get('town') === '0' || params.has('showcase');
    const rowV = toggle('village', 'Villagers & wishes', '🧺');
    const rowC = toggle('chatter', 'Villager chatter', '💬');
    if (offHere) for (const r of [rowV, rowC]) r.querySelector('.hw-set-lb')?.append(' ', h('span', { class: 'hw-set-off' }, '(off for this page)'));
    return h('section', { class: 'hw-card-sec hw-village', 'data-sec': 'village' },
      h('h3', null, 'Village'),
      rowV,
      h('p', { class: 'hw-set-note' }, 'Off: a quiet build-only meadow. Nothing is lost.'),
      rowC);
  }
  function pageSettings() {
    const time = h('input', { class: 'hw-range hw-time', type: 'range', min: '0', max: '1', step: '0.001', value: String(state.time), 'aria-label': 'Time of day' });
    time.addEventListener('input', () => state.set({ time: +time.value }));
    const timeLb = h('b', null, fmtTime(state.time));
    const timeIc = h('span', { class: 'hw-time-ic' }, timeIcon(state.time));
    Object.assign(pageRefs, { time, timeLb, timeIc });
    const presets = [
      { t: 0.27, ic: '🌅', lb: 'Dawn' }, { t: 0.42, ic: '🌤️', lb: 'Morning' }, { t: 0.55, ic: '☀️', lb: 'Noon' }, { t: 0.74, ic: '🌇', lb: 'Sunset' }, { t: 0.9, ic: '🌙', lb: 'Night' },
    ];
    return h('div', { class: 'hw-page hw-settings' },
      h('section', { class: 'hw-card-sec' },
        h('h3', null, 'Time of day'),
        h('div', { class: 'hw-time-row' }, timeIc, timeLb, h('span', { class: 'hw-time-ends' }, '🌙 · ☀️ · 🌙')),
        time,
        h('div', { class: 'hw-chips5' }, presets.map((p) => btn('hw-mini', p.lb, [h('span', null, p.ic), h('small', null, p.lb)], () => state.set({ time: p.t, timeFlow: false })))),
        toggle('timeFlow', 'Let the day pass', '⏳')),
      h('section', { class: 'hw-card-sec' },
        h('h3', null, 'Season'),
        h('div', { class: 'hw-chips4' }, SEASONS.map((s) => btn('hw-mini' + (state.season === s.id ? ' is-on' : ''), s.label, [h('span', null, s.icon), h('small', null, s.label)], () => state.set({ season: s.id }), { attrs: { 'data-season': s.id } }))),
        h('h3', null, 'Weather'),
        h('div', { class: 'hw-chips4' }, WEATHER.map((s) => btn('hw-mini' + (state.weather === s.id ? ' is-on' : ''), s.label, [h('span', null, s.icon), h('small', null, s.label)], () => state.set({ weather: s.id }), { attrs: { 'data-weather': s.id } })))),
      h('section', { class: 'hw-card-sec' },
        h('h3', null, 'Sound & look'),
        toggle('sound', 'Sound effects', '🔔'),
        toggle('music', 'Music', '🎵'),
        toggle('shadows', 'Soft shadows', '🌗'),
        h('div', { class: 'hw-set-row' }, h('span', { class: 'hw-set-ic' }, '✨'), h('span', { class: 'hw-set-lb' }, 'Quality'), seg(QUALITY, state.quality, (v) => state.set({ quality: v }), 'hw-seg-sm'))),
      h('section', { class: 'hw-card-sec', 'data-sec': 'building' },
        h('h3', null, 'Building'),
        toggle('aimLift', 'Preview above your finger', '👆'),
        h('p', { class: 'hw-set-note' }, 'Press and hold: the piece previews just above your fingertip, so your finger never hides where it lands.')),
      villageSection(),
      h('section', { class: 'hw-card-sec' },
        h('div', { class: 'hw-row' },
          btn('hw-pill', 'Show the welcome again', h('span', null, '👋 Show welcome'), () => { closeSheet(false); showWelcome(); }),
          btn('hw-pill', 'How to play', h('span', null, '🧭 How to play'), () => goPage('help')))));
  }

  // ---- help
  function pageHelp() {
    const gestures = [
      ['👆', 'Tap', 'Place the selected piece on the glowing spot.'],
      ['✋', 'Press & hold', 'Preview the piece just above your finger (a small ring marks the spot) — slide to adjust, lift to place it there. To cancel, slide the ring down onto the tray and lift.'],
      ['☝️', 'Drag', 'Look around your home (in Look mode).'],
      ['🤏', 'Pinch', 'Zoom in close or out wide.'],
      ['✌️', 'Two-finger drag', 'Slide the view across the meadow.'],
      ['🔄', 'Twist two fingers', 'Turn the view around.'],
    ];
    const tips = [
      ['✏️', 'Draw mode', 'Switch the rail from Look to Draw and one-finger drags place pieces in a row — perfect for long walls and fences. Pinch and twist still move the camera.'],
      ['🪟', 'Swap walls for windows', 'Pick a window or door and tap an existing wall — it swaps right in.'],
      ['↻', 'Facing', 'Pieces face the right way by themselves — beds against a wall, chairs to the table, doors outward. To turn one, tap it again with the same piece in hand (or press Turn).'],
      ['🏠', 'Roofs', 'Tap the top of your walls — roof slopes settle on them, run down toward the eaves and stack toward the ridge by themselves. Height ▲▼ nudges.'],
      ['🔺', 'Gables', 'Pick a Gable Wall and tap the open triangle at either end of the roof — it fits itself to the slope.'],
      ['🪜', 'Upstairs', 'Use the Floor buttons at the top to build higher. Going down shows a cutaway.'],
      ['💧', 'Pick', 'Tap a placed piece to copy its piece, material and colours.'],
    ];
    const keys = [
      ['R', 'Turn what you point at (Shift+R back)'], ['B', 'Build'], ['E', 'Erase'], ['P', 'Paint'], ['I', 'Pick'],
      ['D', 'Draw / Look'], ['V', 'Show all floors'], ['+  −', 'Floor up / down'], ['[  ]', 'Roof height'],
      ['Q  ⇧W', 'Turn the view'], ['1–7', 'Categories'], ['Ctrl Z', 'Undo'], ['Ctrl ⇧Z', 'Redo'], ['M', 'Menu'], ['Esc', 'Cancel / close'],
    ];
    if (app.town) keys.splice(keys.length - 2, 0, ['T', 'Town & Cozy'], ['J', 'Next wish']);
    const village = [
      ['🏡', 'Homes', 'Walls, a roof, a door and a bed make a home, and someone may move in.'],
      ['💭', 'Wishes', 'Tap a bubble over a villager, then Show me: a glowing spot shows where.'],
      ['🔥', 'Cozy', 'The hearth by the piece counter glows as the town gets cosier.'],
      ['🧺', 'Quiet meadow', 'Turn villagers off in Settings for a build-only meadow. Nothing is lost.'],
    ];
    return h('div', { class: 'hw-page hw-help' },
      h('section', { class: 'hw-card-sec' }, h('h3', null, 'Gestures'),
        h('div', { class: 'hw-helps' }, gestures.map(([i, t, d]) => h('div', { class: 'hw-help' }, h('span', { class: 'hw-help-ic' }, i), h('div', null, h('b', null, t), h('small', null, d)))))),
      h('section', { class: 'hw-card-sec' }, h('h3', null, 'Building tips'),
        h('div', { class: 'hw-helps' }, tips.map(([i, t, d]) => h('div', { class: 'hw-help' }, h('span', { class: 'hw-help-ic' }, i), h('div', null, h('b', null, t), h('small', null, d)))))),
      app.town ? h('section', { class: 'hw-card-sec', 'data-sec': 'villagers' }, h('h3', null, 'Villagers'),
        h('div', { class: 'hw-helps' }, village.map(([i, t, d]) => h('div', { class: 'hw-help' }, h('span', { class: 'hw-help-ic' }, i), h('div', null, h('b', null, t), h('small', null, d)))))) : null,
      coarse && !matchMedia('(any-pointer: fine)').matches ? null : h('section', { class: 'hw-card-sec' }, h('h3', null, 'Keyboard & mouse'),
        h('p', { class: 'hw-note' }, 'Left-drag to look · right-drag or Shift-drag to slide · wheel to zoom.'),
        h('div', { class: 'hw-keys' }, keys.map(([k, d]) => h('div', { class: 'hw-key' }, h('kbd', null, k), h('span', null, d))))));
  }

  // ------------------------------------------------------------------ confirm dialog

  const dlgWrap = h('div', { class: 'hw-dlg-wrap' });
  root.append(dlgWrap);
  let dlgResolve = null;
  function ask({ icon = '🏡', title, text = '', buttons = [] }) {
    if (dlgResolve) dlgResolve(null);
    return new Promise((resolve) => {
      dlgResolve = resolve;
      const done = (v) => {
        if (dlgResolve !== resolve) return;
        dlgResolve = null;
        dlgWrap.classList.remove('is-open');
        resolve(v);
      };
      dlgWrap.textContent = '';
      const acts = h('div', { class: 'hw-dlg-acts' },
        ...buttons.map((b) => btn(`hw-pill ${b.kind === 'primary' ? 'hw-pill-primary' : b.kind === 'danger' ? 'hw-pill-danger' : ''}`, b.label, h('span', null, b.label), () => done(b.value), { attrs: { 'data-value': b.value } })),
        btn('hw-pill hw-pill-ghost', 'Cancel', h('span', null, 'Cancel'), () => done(null), { attrs: { 'data-value': 'cancel' } }));
      const dlg = h('div', { class: 'hw-dlg', role: 'alertdialog', 'aria-label': title },
        h('div', { class: 'hw-dlg-ic' }, icon), h('b', null, title), text ? h('p', null, text) : null, acts);
      const bd = h('div', { class: 'hw-dlg-bd' });
      bd.addEventListener('click', () => done(null));
      dlgWrap.append(bd, dlg);
      dlgWrap.classList.add('is-open');
      sfx('open');
      dlg.querySelector('.hw-pill')?.focus({ preventScroll: true });
    });
  }

  // ------------------------------------------------------------------ photo mode

  const flash = h('div', { class: 'hw-flash' });
  const shutter = h('button', { type: 'button', class: 'hw-shutter', 'aria-label': 'Take photo', title: 'Take photo' }, h('i'));
  const photoExit = btn('hw-rbtn hw-photo-exit', 'Leave photo mode', ico('close'), () => state.set({ photoMode: false }), { title: 'Leave photo mode (Esc)' });
  // photo mode shows the whole house, roof and all; this peeks inside (the cutaway) for a photo of the rooms
  const photoSeeIc = h('span', { class: 'hw-photo-see-ic' }), photoSeeTx = h('span');
  const photoSee = btn('hw-pill hw-photo-see', 'Peek inside', [photoSeeIc, photoSeeTx], () => setSeeAll(!state.seeAll), { attrs: { 'aria-pressed': 'false' } });
  const photoBar = h('div', { class: 'hw-photo' }, photoExit, photoSee, shutter);
  root.append(flash, photoBar);
  shutter.addEventListener('click', () => capturePhoto());

  /** Every floor / the cutaway, without moving the camera (the floor view would re-aim it at the floor's height). */
  function setSeeAll(v) {
    const t = app.rig?.goal?.target;
    const y = t?.y;
    state.set({ seeAll: v });
    if (t && Number.isFinite(y)) t.y = y;
  }
  let photoSeeQueued = false;
  function renderPhotoSee() {
    if (!state.photoMode || photoSeeQueued) return;
    photoSeeQueued = true;
    requestAnimationFrame(() => {
      photoSeeQueued = false;
      const cut = !state.seeAll;
      // only offered when the cutaway hides something (floors above, a roof)
      let above = cut;
      if (!above) for (const e of world.entries.values()) if (e.level > state.level) { above = true; break; }
      photoSee.classList.toggle('is-off', !above);
      photoSeeIc.textContent = cut ? '🏠' : '✂️';
      photoSeeTx.textContent = cut ? 'Whole house' : 'Peek inside';
      photoSee.setAttribute('aria-label', cut ? 'Show the whole house' : 'Peek inside');
      photoSee.setAttribute('aria-pressed', String(cut));
      photoSee.title = cut ? 'Show the whole house (V)' : 'Peek inside (V)';
    });
  }

  function startPhoto() {
    closeSheet(false);
    state.set({ photoMode: true });
  }
  async function capturePhoto() {
    sfx('camera');
    flash.classList.remove('go'); void flash.offsetWidth; flash.classList.add('go');
    let url;
    try { url = app.snapshot(); } catch (e) { console.error(e); toast('Could not take the photo', 'warn'); return; }
    const d = new Date();
    const name = `hearthwood-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}.png`;
    if (coarse && navigator.canShare && typeof File !== 'undefined') {
      try {
        const blob = await (await fetch(url)).blob();
        const file = new File([blob], name, { type: 'image/png' });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: 'My Hearthwood home' });
          return;
        }
      } catch (e) {
        if (e && e.name === 'AbortError') return;
      }
    }
    const a = h('a', { href: url, download: name, style: { display: 'none' } });
    document.body.append(a);
    a.click();
    a.remove();
    toast('📸 Photo saved', 'success', 1800);
  }

  // ------------------------------------------------------------------ welcome card

  const welcome = h('div', { class: 'hw-welcome-wrap' });
  root.append(welcome);
  // tapping the meadow around the card just lets you in (e.g. to open the menu and paste a friend's code)
  welcome.addEventListener('click', (e) => { if (e.target === welcome) hideWelcome(); });
  function showWelcome() {
    welcome.textContent = '';
    const card = h('div', { class: 'hw-welcome', role: 'dialog', 'aria-label': 'Welcome to Hearthwood' },
      h('div', { class: 'hw-welcome-art', html: HOUSE_SVG }),
      h('h2', null, 'Welcome to Hearthwood'),
      h('p', null, 'Build a cozy home board by board — every wall, window, door and roof panel.'),
      townOn() ? h('p', { class: 'hw-welcome-town' }, 'Build a home with a bed and someone may move in.') : null,
      h('div', { class: 'hw-welcome-acts' },
        B_HAS('list') && B_HAS('startGuided')
          ? btn('hw-big hw-big-primary', 'Follow a blueprint', [h('span', { class: 'hw-big-ic' }, '📐'), h('span', null, h('b', null, 'Follow a blueprint'), h('small', null, 'Glowing guides show the way'))], () => { hideWelcome(); openSheet('blueprints'); }, { attrs: { 'data-act': 'blueprint' } })
          : null,
        btn('hw-big', 'Free build', [h('span', { class: 'hw-big-ic' }, '🔨'), h('span', null, h('b', null, 'Free build'), h('small', null, 'Start with a foundation'))], () => {
          hideWelcome();
          builder.selectPiece(catalog.getDef('foundation') ? 'foundation' : (catalog.piecesIn('base')[0]?.id || state.pieceId));
          toast('👆 Tap the meadow to lay your first foundation', 'info', 3200);
        }, { attrs: { 'data-act': 'free' } })),
      h('div', { class: 'hw-coach' },
        h('div', null, h('span', null, '👆'), h('b', null, 'Tap'), h('small', null, 'to place')),
        h('div', null, h('span', null, '☝️'), h('b', null, 'Drag'), h('small', null, 'to look around')),
        h('div', null, h('span', null, '🤏'), h('b', null, 'Pinch'), h('small', null, 'to zoom'))));
    welcome.append(card);
    welcome.classList.add('is-open');
    sfx('open');
  }
  const townOn = () => { try { return !!app.town?.enabled?.(); } catch { return false; } };
  function hideWelcome(sound = true) {
    if (!welcome.classList.contains('is-open')) return;
    welcome.classList.remove('is-open');
    lsSet(LS_WELCOMED, '1');
    if (sound) sfx('close');
  }

  // ------------------------------------------------------------------ wiring

  state.on((changed) => {
    const has = (...ks) => ks.some((k) => changed.includes(k));
    if (has('level')) renderLevel();
    if (has('tool', 'drawMode', 'seeAll')) renderRail();
    if (has('category')) { seenGarden(); markTab(); renderCards(); }
    if (has('pieceId')) {
      markCard();
      if (popOpen && pop.classList.contains('hw-pop-info')) closePop();
      const d = curDef();
      if (d) lastInCat[d.cat] = d.id;
    }
    if (has('mats', 'colors', 'accent')) refreshThumbs();
    if (has('pieceId', 'tool', 'mats', 'colors', 'accent', 'rot', 'hOffset', 'drawMode', 'paintTarget')) {
      if (popOpen && pop.classList.contains('hw-pop-palette') && has('pieceId', 'tool')) closePop();
      renderCtx();
    }
    // the paint panel just opened (or its material strip came back): start the strip on a useful group
    if (state.tool === 'paint' && (has('tool') || (has('paintTarget') && state.paintTarget !== 'accent'))) pmJump = state.paintMat ? 'sel' : paintGroupFor();
    if (has('tool', 'paintMat', 'paintColor', 'paintTarget')) renderPaint();
    if (has('tool') && state.tool === 'paint' && !state.paintMat && !state.paintColor) {
      queueMicrotask(() => state.set({ paintColor: PALETTE[4] || '#b4473a' }));
    }
    if (has('photoMode')) setPhotoMode(state.photoMode);
    else if (has('seeAll', 'level')) renderPhotoSee();
    if (has('blueprint')) {
      if (!state.blueprint) { if (!bp || bp.done < bp.total) { bp = null; hud.classList.remove('is-open'); } }
      else if (!bp || bp.id !== state.blueprint) { bp = { id: state.blueprint, done: 0, total: 0 }; renderHud(); }
    }
    syncSettings(changed);
  });

  events.on('world-change', (d) => {
    renderHistory();
    renderCount();
    if (d?.kind === 'undo') afterUndo();
    if (page === 'main' && d?.kind !== 'add' && d?.kind !== 'remove') refreshPage();
    renderPhotoSee();   // (photo mode only; once a frame)
  });
  events.on('toast', (d) => {
    if (!d) return;
    if (typeof d === 'string') toast(d);
    else toast(d.text, d.kind || 'info', d.ms || 2400, d.action || null);
  });
  // a thank-you gift was unlocked (docs/LIVING.md §8.3): its card appears in the Garden tray with a ribbon
  events.on('town-gift', () => {
    giftDot = state.category !== 'garden';
    renderTabs();
    renderCards(true);
  });
  events.on('placed', (d) => { if (d?.def?.gift) setTimeout(markGifts, 0); });   // after the town marks it seen
  events.on('turned', (d) => {
    rotSpin += (curDef()?.rot === 'flip' ? 180 : 90) * (d?.dir < 0 ? -1 : 1);
    const ic = ctx.querySelector('.hw-rot-ic');
    if (ic) ic.style.transform = `rotate(${rotSpin}deg)`;
  });
  events.on('blueprint-progress', (d) => {
    if (!d) return;
    const was = bp && bp.id === d.id ? bp.done : -1;
    bp = { ...d };
    renderHud();
    // finished: show the whole house (roof on) for the celebration
    if (d.total && d.done >= d.total && was >= 0 && was < d.total && !state.seeAll) state.set({ seeAll: true });
  });

  // The keepsake photo shows the whole house (every floor, roof on) even when you were peeking inside;
  // leaving photo mode brings back the floor and cutaway you had.
  let photoPrev = null;   // { level, seeAll } from before photo mode
  function setPhotoMode(on) {
    root.classList.toggle('photo', !!on);
    closePop();
    syncInsets();
    setTimeout(syncInsets, 420);   // after the bars finish sliding
    if (on) {
      closeSheet(false);
      hideWelcome(false);
      if (!photoPrev) photoPrev = { level: state.level, seeAll: state.seeAll };
      if (!state.seeAll) setSeeAll(true);
      renderPhotoSee();
      toast('📸 Frame your shot, then tap the shutter', 'info', 2600);
    } else if (photoPrev) {
      const prev = photoPrev;
      photoPrev = null;
      if (prev.level !== state.level) state.set({ level: prev.level, seeAll: prev.seeAll });
      else if (prev.seeAll !== state.seeAll) setSeeAll(prev.seeAll);
    }
  }

  // iOS Safari ignores user-scalable=no: stop pinches on the UI chrome from zooming the whole page
  for (const t of ['gesturestart', 'gesturechange']) document.addEventListener(t, (e) => e.preventDefault(), { passive: false });

  // keyboard: menu / help / escape (builder.js owns the building shortcuts)
  window.addEventListener('keydown', (e) => {
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') {
      if (e.key === 'Escape') e.target.blur();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Escape') {
      if (dlgResolve) { dlgResolve(null); dlgResolve = null; dlgWrap.classList.remove('is-open'); }
      else if (townHud?.isOpen()) townHud.close();
      else if (popOpen) closePop();
      else if (sheetWrap.classList.contains('is-open')) closeSheet();
      else if (welcome.classList.contains('is-open')) hideWelcome();
      else if (state.photoMode) state.set({ photoMode: false });
      else { try { if (app.town?.showing?.()) app.town.endShowMe(); } catch { /* the town reports its own failures */ } }
      return;
    }
    const k = e.key.toLowerCase();
    if (k === 'm') { if (sheetWrap.classList.contains('is-open')) closeSheet(); else openSheet('main'); }
    else if (k === '?' || k === 'h') openSheet('help');
    else if ((k === 't' || k === 'j') && townHud && !state.photoMode && !dlgResolve) {
      // T: the town card; J: jump to the next open wish (camera + card). builder.js uses neither key.
      closePop();
      closeSheet(false);
      hideWelcome(false);
      if (k === 't') townHud.openTown(); else townHud.nextWish();
    }
  });

  // ------------------------------------------------------------------ first paint

  renderTabs();
  renderCards(true);
  renderLevel();
  renderRail();
  renderHistory();
  renderCount();
  renderCtx();
  if (state.tool === 'paint') pmJump = state.paintMat ? 'sel' : paintGroupFor();
  renderPaint();
  if (state.photoMode) setPhotoMode(true);
  try { if (app.blueprints?.active?.()) { const a = app.blueprints.active(); bp = { id: typeof a === 'string' ? a : (a?.id || state.blueprint), done: 0, total: 0 }; renderHud(); } } catch { /* ignore */ }
  requestAnimationFrame(syncTrayH);

  // First-run welcome: only for brand-new players (no autosave yet), never for dev/test URLs.
  const hadSave = !!storage.loadAutosave?.()?.pieces?.length;
  const devUrl = ['showcase', 'bp', 'clean', 'cam'].some((k) => params.has(k));
  const wantWelcome = params.get('welcome') === '1' || (!hadSave && !devUrl && !lsGet(LS_WELCOMED));
  const onReady = () => {
    // a piece module may have failed to load: fall back to the first category that has pieces
    if (!catalog.piecesIn(state.category).length) {
      const first = catalog.CATEGORIES.find((c) => catalog.piecesIn(c.id).length);
      if (first) state.set({ category: first.id });
    }
    renderTabs();
    renderCards(true);
    renderHistory();
    renderCount();
    if (wantWelcome && !state.photoMode) setTimeout(showWelcome, 350);
    setTimeout(prefetchThumbs, 2500);
  };
  if (window.__hwReady) onReady(); else events.on('ready', onReady);

  // The town's face (docs/LIVING.md §10): bubbles, cards, the hearth. Loaded after first paint, only when the town
  // module is there; a failure here never takes the building UI with it.
  if (app.town) {
    requestAnimationFrame(() => {
      import('./town/hud.js').then((m) => {
        if (!app.town || townHud) return;
        townHud = m.createHud(app, { root, topLeft: top.querySelector('.hw-top-l'), toast, ask });
        if (page === 'main' || page === 'settings' || page === 'help') refreshPage();
      }).catch((e) => console.error('[hearthwood] town hud failed to load:', e));
    });
  }

  return {
    update(dt) {
      // world.endBatch() (draw strokes, stamped blueprints) commits undo steps without a
      // world-change event, so keep the undo/redo buttons honest with two cheap reads per frame.
      if (world.canUndo() !== canU || world.canRedo() !== canR) renderHistory();
      if (townHud) {
        try { townHud.update(dt); } catch (e) { console.error('[hearthwood] town hud:', e); try { townHud.destroy?.(); } catch { /* ignore */ } townHud = null; }
      }
    },
    toast,
    open: openSheet,
    close: closeSheet,
    showWelcome,
    ask,
    /** The town's hud (js/town/hud.js) once mounted, else null. */
    get hud() { return townHud; },
  };
}

const HOUSE_SVG = `<svg viewBox="0 0 96 80" aria-hidden="true">
  <ellipse cx="48" cy="74" rx="40" ry="5" fill="#8fae7a" opacity=".45"/>
  <rect x="62" y="12" width="9" height="18" rx="1.5" fill="#a8553f"/>
  <path d="M10 40 L48 12 L86 40" fill="#b4473a" stroke="#8e3b32" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>
  <rect x="20" y="38" width="56" height="34" rx="3" fill="#fbf3e2" stroke="#5b3f2a" stroke-width="3"/>
  <rect x="42" y="50" width="13" height="22" rx="2" fill="#7a4b3a"/>
  <circle cx="52" cy="62" r="1.3" fill="#e9c46a"/>
  <rect x="26" y="46" width="11" height="11" rx="1.5" fill="#ffd27a" stroke="#5b3f2a" stroke-width="2"/>
  <rect x="60" y="46" width="11" height="11" rx="1.5" fill="#ffd27a" stroke="#5b3f2a" stroke-width="2"/>
  <path d="M65 8c3-3 1-6 4-8" fill="none" stroke="#cfc6b8" stroke-width="2.5" stroke-linecap="round"/>
</svg>`;
