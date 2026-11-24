// Hearthwood — Living Town face (docs/LIVING.md §10, §12.4; work package 3): every piece of town DOM.
//   bubbles over villagers and homes (projected every frame, transforms only), the edge arrows of travellers and
//   passers-by, the villager card, the town card, hint / camp / vacancy cards, the gift card, the intro card, the
//   hearth chip in the top bar, the Show me checklist chip, and every town toast and one-time tip.
// Mounted by ui.js inside `.hw` (`createHud(app, { root, topLeft, toast, ask })`); styled by css/town.css.
// It imports nothing: it reads `app.town` (the TownAPI, read afresh on every call, so a test can swap in a fake) and
// listens to the bus events of §12.5. Every user-visible town string that isn't villager data lives here.
// A failure in here never stops building: the frame work and every handler are guarded; a crash hides the hud for
// the session and reports once with console.error.

// ------------------------------------------------------------------ tuning (§10.1, §15)

const BUBBLE_MAX = 6;          // tappable bubbles shown at once
const SLEEP_MAX = 3;           // 💤 bubbles shown at once
const MERGE_PX = 36;           // bubbles closer than this merge into one "×n"
const EDGE_MERGE_PX = 48;      // edge bubbles (a 48 px circle) whose edge points are closer than this merge too
const CULL_M = 45;             // hidden beyond this camera distance (m)
const WISH_REACH_M = 30;       // wish and dream edge arrows: within the rig's furthest pull-back + this (≈ the lot's half-diagonal)
const NEAR_M = 20, FAR_M = 40; // scale 1.0 at ≤ 20 m down to 0.8 at 40 m
const SLEEP_M = 25;            // 💤 only when the camera target is this close (m)
const DRAG_PX = 10;            // a press on a bubble that moves further is handed to the canvas
const EDGE_PX = 50;            // edge bubbles sit this far inside the free area (circle + arrow fit)
const EDGE_REACH = 38;         // px from an edge bubble's centre to its arrow's tip (--arrow-r 28 + half the arrow)
const OCC_EVERY = 0.25;        // s between occlusion rays per bubble
const OCC_RAYS = 2;            // occlusion rays per frame at most
const VIEW_EVERY = 0.25;       // s between view() reads (hearth, open cards)
const GIFT_DELAY = 1.5;        // s from the gift to its card (§10.4)
const GIFT_CARD_MS = 8000;     // the gift card closes itself
const FLOW_TIP_AFTER = 90;     // s after the first move-in (§10.6)
const HEARTH_TIP_AFTER = 4.5;  // s after the first move-in toast: the hearth tip, once the nameplate has gone (§4.6)
const EDGE_IN = 24;            // px: an on-screen wish / dream bubble is kept this far inside the free area's sides
const WELCOME_AWAY = 1800;     // s away before the welcome-back toast (§10.5)

/** Tappable bubble priority (§10.1): traveller > wish > camp > fix-up > almost > vacancy > dream. */
const ORDER = { traveller: 0, gift: 1, wish: 2, camp: 3, fix: 4, almost: 5, vacancy: 6, dream: 7 };
const TIERS = { quiet: 'Quiet', content: 'Content', cheerful: 'Cheerful', glowing: 'Glowing' };
const NO_PRONOUN = /\b(she|he|her|his|hers|him|they|them|their|theirs)\b/i;

// ------------------------------------------------------------------ strings (§10, never with pronouns)

const S = {
  travellerFirst: '🎒 Someone\'s coming up the lane to your new home…',
  traveller: '🎒 Someone\'s coming up the lane…',
  travellerMigration: '🎒 Word of your lovely home has spread. Someone\'s coming up the lane…',
  watch: '👀 Watch',
  movein: (v, home) => `🏡 ${v.name} the ${v.jobLabel || 'villager'} moved into ${home}!`,
  granted: (v, line, gain) => `💛 ${v.name}: “${line}” · Cozy +${gain}`,
  campThanks: (v, gain) => `💛 ${v.name}: “A real bed! Thank you!” · Cozy +${gain}`,
  gift: (from, gift) => `🎁 ${from} left you a ${gift}. Find it in 🌷 Garden`,
  placeIt: 'Place it',
  fixed: (v) => `🔨 ${v.name}: “Thank you for fixing it up!”`,
  moving: (v, home) => `📦 ${v.name} is moving into ${home}`,
  camping: (v) => `⛺ ${v.name} is camping by the lane until there's a bed free`,
  back: (v) => `🏡 ${v.name} is back home`,
  movingN: (n) => `📦 ${n} neighbours moved into the new houses`,
  campingN: (n) => `⛺ ${n} villagers are camping by the lane until there are beds`,
  backN: (n) => `🏡 ${n} neighbours are back home`,
  hint: (icon, verb, piece, who) => `${icon ? icon + ' ' : ''}Tap a glowing spot to ${verb || 'place'} ${article(piece)} ${piece}${who ? ' for ' + who : ''}`,
  welcomeBack: (name, n) => (n > 0 ? `🏡 ${name} and ${n} neighbour${n === 1 ? '' : 's'} are glad you're back` : `🏡 ${name} is glad you're back`),
  off: '🧺 Villagers are resting. Everything is kept.',
  on: '👋 The villagers are back!',
  otherTab: '🏡 Your village is open in another tab.',
  reload: 'Reload',
  saveFail: '⚠️ Can\'t save your village. This browser\'s storage is full or blocked.',
  travellerTap: (v, home) => `🎒 ${v.name}, ${article(v.jobLabel || 'villager')} ${(v.jobLabel || 'villager').toLowerCase()}, is coming to live in ${home || 'a new home'}.`,
  tips: {
    passerby: '🎒 A traveller passes by… build a home with a bed and someone might stay',
    hearth: '🔥 Your town has a hearth now. It glows brighter as the town gets cosier.',
    wish: '💭 Tap a bubble to see what someone would love',
    flow: (name) => `⏳ Let the day pass to see ${name ? name + '\'s' : 'the'} whole day`,
    flowAct: 'Let the day pass',
    almost: '🏠 Almost a home! Tap the grey bubble to see what\'s missing',
    vacancy: '🏡✨ A free bed! Tap the green bubble to see who could live here',
    camp: '⛺ Villagers without a bed camp by the lane. Add a bed and they\'ll move right in.',
  },
  resting: '🧺 Villagers are resting. Turn them on in Settings.',
  full: (n) => `The meadow is full: ${n} neighbours live here.`,
  intro: '🏡 New: villagers may move into your homes.',
  introSub: 'Walls, a roof, a door and a bed make a home. Nothing about building changes.',
  lovely: 'Lovely',
  quiet: 'Keep my meadow quiet',
  never: '🙂 Never mind, maybe another time!',
  shed: 'Just a shed 🙂',
  showMe: 'Show me',
  follow: '👀 Follow',
  cozyWhy: 'Different kinds of decor near a home count more than lots of one kind.',
  flowRow: '⏳ Let the day pass to see the whole day',
  turnOn: 'Turn on',
};

function article(word) { return /^[aeiou]/i.test(String(word || '')) ? 'an' : 'a'; }
const cap = (s) => (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : '');
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// ------------------------------------------------------------------ DOM helpers (ui.js style)

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  for (const c of kids.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}
const CLOSE_SVG = '<svg class="hw-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M17 7 7 17M7 7l10 10"/></svg>';
const HEARTH_SVG = `<svg class="hw-hearth-svg" viewBox="0 0 36 36" aria-hidden="true">
  <defs><radialGradient id="hwHearthGlow" cx="50%" cy="60%" r="50%"><stop offset="0" stop-color="#ffcf6b" stop-opacity=".95"/><stop offset="1" stop-color="#ff9a3c" stop-opacity="0"/></radialGradient></defs>
  <path d="M5.5 31.5V17.5a12.5 12.5 0 0 1 25 0v14z" fill="#d8c8b0" stroke="#7a6654" stroke-width="1.5" stroke-linejoin="round"/>
  <path d="M8.2 21.5h3.2M24.6 21.5h3.2M7.6 26.5h3.6M24.8 26.5h3.6M12.6 9.6l1.4 2.6M23.4 9.6 22 12.2M18 7.6v2.8" stroke="#9c8a74" stroke-width="1.2" stroke-linecap="round"/>
  <path d="M11.3 31.5V20.2a6.7 6.7 0 0 1 13.4 0v11.3z" fill="#3b2a20"/>
  <circle class="hw-hearth-glow" cx="18" cy="26" r="9" fill="url(#hwHearthGlow)"/>
  <g class="hw-hearth-flame">
    <path d="M18 30c-3.6 0-5-3.1-3.6-6.2.5 1.4 1.5 1.9 1.9.9.5-2.7 2-4.4 3.6-5.6-.2 2.4 2.7 3.6 2.4 6.5-.2 2.5-1.9 4.4-4.3 4.4z" fill="#f39a3d"/>
    <path d="M18 30c-1.8 0-2.6-1.5-1.8-3.2.4.7.9.9 1.1.3.3-1.4 1.1-2.3 1.9-2.9-.1 1.2 1.3 1.8 1.2 3.3-.1 1.4-1 2.5-2.4 2.5z" fill="#ffd66b"/>
  </g>
  <rect x="11.6" y="29.6" width="12.8" height="2.2" rx="1.1" fill="#8a5a3a"/>
  <rect x="3.5" y="31" width="29" height="3" rx="1.4" fill="#b4a28a" stroke="#7a6654" stroke-width="1.1"/>
</svg>`;
const ARROW_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4.5 17.5 12 8 19.5z"/></svg>';

// ==================================================================== createHud

/**
 * Build the town's DOM inside the UI root.
 * @param app  the app object (reads app.town, app.camera, app.rig, app.state, app.events, app.builder, app.catalog)
 * @param mounts { root: the `.hw` element, topLeft: `.hw-top-l` (the hearth goes after the piece counter),
 *                 toast(text, kind, ms, action) (fallback when the bus has no ui), ask }
 * @returns Hud { update(dt), openTown(), openVillager(id), nextWish(), close(), isOpen(), destroy() }
 */
export function createHud(app, { root, topLeft, toast, ask } = {}) {
  const { state, events } = app;
  const THREE = app.THREE;
  root = root || document.querySelector('#ui > .hw') || document.body;
  void ask;

  let dead = false;
  let now = 0;                         // hud clock (s), advanced by update(dt)
  const offs = [];                     // unsubscribers
  const timers = [];                   // { at, fn } on the hud clock

  // ---------------------------------------------------------------- guards
  let warned = false;
  function die(where, e) {
    if (dead) return;
    console.error(`[hearthwood] town hud ${where}: the village display is off for this session.`, e);
    app.errors?.push?.({ where: `town.hud.${where}`, message: String(e?.message || e) });
    destroy();
  }
  /** TownAPI read, guarded: a throw gives the fallback (warned once). */
  function call(fn, fb) {
    try {
      const v = fn();
      return v === undefined || v === null ? fb : v;
    } catch (e) {
      if (!warned) { warned = true; console.warn('[hearthwood] town hud: a town call failed', e); }
      return fb;
    }
  }
  const T = () => (dead ? null : app.town || null);
  const ready = () => { const t = T(); return !!t && call(() => t.ready !== false, false); };
  const enabled = () => { const t = T(); return !!t && ready() && call(() => !!t.enabled(), false); };
  /** A bus listener that can never throw into the dispatcher (an uncaught error there would reach main.js). */
  function listen(type, fn) {
    offs.push(events.on(type, (d) => {
      if (dead) return;
      try { fn(d || {}); } catch (e) { die(type, e); }
    }));
  }
  function after(sec, fn) { timers.push({ at: now + sec, fn }); }

  /** Toasts go through the bus (ui.js renders them; tests count them), with the mount's toast as a fallback. */
  function say(text, kind = 'info', ms = 2400, action = null) {
    if (!text) return;
    const d = { text, kind, ms };
    if (action) d.action = action;
    events.emit('toast', d);
    void toast;
  }
  const sfx = (name, opts) => events.emit('sfx', opts ? { name, opts } : { name });

  // ---------------------------------------------------------------- views (cached at 4 Hz)
  let viewCache = null, viewAt = -1e9;
  function view(force = false) {
    const t = T();
    if (!t) return null;
    if (force || !viewCache || now - viewAt >= VIEW_EVERY) {
      viewCache = call(() => t.view(), null);
      viewAt = now;
      if (viewCache?.villagers) for (const v of viewCache.villagers) if (v && v.id) names.set(v.id, v);
    }
    return viewCache;
  }
  const names = new Map();             // villager id → last VillagerView (names for events after a change)
  /** A VillagerView from an id, a view, or a partial object; never null (name falls back to "A neighbour"). */
  function vv(x) {
    const t = T();
    if (x && typeof x === 'object') {
      if (x.name) return x;
      if (x.id) return vv(x.id);
    }
    const id = x === null || x === undefined ? '' : String(x);
    const v = id && t ? call(() => t.villager(id), null) : null;
    if (v) { names.set(id, v); return v; }
    return names.get(id) || { id, name: id && !/^v\d+$/.test(id) ? id : 'A neighbour', jobLabel: 'villager' };
  }
  const homeOf = (id) => {
    const V = view();
    return (V?.homes || []).find((x) => x.id === id) || (V?.almost || []).find((x) => x.id === id) || null;
  };

  // ---------------------------------------------------------------- live region
  const sr = h('div', { class: 'hw-sr', 'aria-live': 'polite' });
  root.append(sr);
  const announce = (text) => { sr.textContent = ''; requestAnimationFrame(() => { sr.textContent = text; }); };

  // ================================================================ hearth chip (§10.3, §9.3)
  const hearthGain = h('span', { class: 'hw-hearth-gains', 'aria-hidden': 'true' });
  const hearth = h('button', {
    type: 'button', class: 'hw-hearth hw-hide-photo', 'aria-label': 'Town and Cozy (T)', title: 'Town (T)', hidden: true,
    html: HEARTH_SVG + '<i class="hw-hearth-dot" aria-hidden="true"></i>',
  });
  hearth.append(hearthGain);
  hearth.addEventListener('click', () => { if (!dead) { sfx('click'); openTown(); } });
  if (topLeft) topLeft.append(hearth); else root.append(hearth);
  let hearthShown = false, hearthFrac = -1, hearthWish = null, hearthGlow = null, pendingGlow = false;
  function setHearth(V) {
    const on = !!V && enabled() && (V.villagers?.length || 0) > 0;
    if (on !== hearthShown) {
      hearthShown = on;
      hearth.hidden = !on;
      root.classList.toggle('has-hearth', on);
      if (on && pendingGlow) { pendingGlow = false; requestAnimationFrame(glowUp); }
    }
    if (!on) return;
    const c = call(() => T().cozy(), null) || V.cozy || {};
    const frac = Math.max(0, Math.min(1, Number.isFinite(c.frac) ? c.frac : (Number(c.value) || 0) / 100));
    if (Math.abs(frac - hearthFrac) > 0.001) { hearthFrac = frac; hearth.style.setProperty('--cozy', frac.toFixed(3)); }
    const glow = frac >= 0.75;
    if (glow !== hearthGlow) { hearthGlow = glow; hearth.classList.toggle('is-glow', glow); }
    const wish = (V.openWishes || 0) > 0;
    if (wish !== hearthWish) { hearthWish = wish; hearth.classList.toggle('has-wish', wish); }
    hearth.setAttribute('aria-label', `Town · Cozy is ${(TIERS[c.tier] || 'warm').toLowerCase()}${wish ? ' · wishes open' : ''} (T)`);
  }
  function flare(gain) {
    hearth.classList.remove('is-flare'); void hearth.offsetWidth; hearth.classList.add('is-flare');
    if (gain > 0) {
      const g = h('span', { class: 'hw-hearth-gain' }, `+${Math.round(gain)}`);
      hearthGain.append(g);
      setTimeout(() => g.remove(), 1500);
    }
  }
  function glowUp() {
    hearth.classList.remove('is-new'); void hearth.offsetWidth; hearth.classList.add('is-new');
    setTimeout(() => hearth.classList.remove('is-new'), 1400);
  }

  // ================================================================ bubbles (§10.1)
  const layer = h('div', { class: 'hw-tbubbles hw-hide-photo', role: 'group', 'aria-label': 'Village bubbles' });
  root.prepend(layer);
  const bubbles = new Map();           // key → rec { el, ic, badge, arrow, kind, b, tf, shown, ... }
  const occ = new Map();               // key → { at: next check time, hidden: bool }
  const lastPos = new Map();           // villager id → { x, y, s } of its wish/dream bubble (granted / faded ghosts)
  let layerShown = true, passive = false;
  const v3 = THREE ? new THREE.Vector3() : null;
  const v3b = THREE ? new THREE.Vector3() : null;

  function bubbleRec(b) {
    let r = bubbles.get(b.key);
    if (r && r.kind !== b.kind) { r.el.remove(); bubbles.delete(b.key); r = null; }
    if (r) return r;
    const ic = h('span', { class: 'hw-bubble-ic' });
    const badge = h('span', { class: 'hw-bubble-badge' });
    const arrow = h('span', { class: 'hw-bubble-arrow', html: ARROW_SVG });
    const tappable = isTappable(b);
    const el = h(tappable ? 'button' : 'div', { class: `hw-bubble k-${b.kind}`, type: tappable ? 'button' : null, 'data-key': b.key, 'data-kind': b.kind },
      h('span', { class: 'hw-bubble-c' }, ic, badge), arrow);
    if (!tappable) el.setAttribute('aria-hidden', 'true');
    r = { el, ic, badge, arrow, kind: b.kind, b, tf: '', shown: false, icon: null, label: null, count: 0, edge: null, text: null, dim: null };
    if (tappable) wireBubble(r);
    layer.append(el);
    bubbles.set(b.key, r);
    return r;
  }
  const isTappable = (b) => b.kind !== 'sleep' && b.kind !== 'nameplate' && b.kind !== 'passerby' && b.tappable !== false;

  /** Press on a bubble: a still tap opens it; a drag past 10 px is handed to the canvas so the view orbits (§10.1). */
  function wireBubble(r) {
    const el = r.el;
    let down = null;
    el.addEventListener('pointerdown', (e) => {
      if (dead) return;
      down = { id: e.pointerId, type: e.pointerType, button: e.button, buttons: e.buttons, x: e.clientX, y: e.clientY, handed: false };
      r.dragged = false;
      if (e.pointerType === 'mouse') { try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ } }
    });
    el.addEventListener('pointermove', (e) => {
      if (!down || down.handed || e.pointerId !== down.id) return;
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) <= DRAG_PX) return;
      down.handed = true;
      r.dragged = true;
      try { if (el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      handToCanvas(down);
    });
    const end = (e) => { if (down && e.pointerId === down.id) { if (!down.handed) r.dragged = false; down = null; } };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', (e) => { if (down && e.pointerId === down.id) { r.dragged = true; down = null; } });
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      if (dead) return;
      if (r.dragged) { r.dragged = false; return; }
      try { tapBubble(r.b); } catch (err) { die('bubble', err); }
    });
  }
  function handToCanvas(d) {
    const cv = app.renderer?.domElement;
    if (!cv || typeof PointerEvent === 'undefined') return;
    const ev = new PointerEvent('pointerdown', {
      bubbles: true, cancelable: true, composed: true, pointerId: d.id, pointerType: d.type || 'mouse', isPrimary: true,
      button: d.button ?? 0, buttons: d.buttons || 1, clientX: d.x, clientY: d.y, screenX: d.x, screenY: d.y,
    });
    try { cv.dispatchEvent(ev); } catch { /* a browser that refuses: the drag just doesn't orbit (§17) */ }
  }

  function tapBubble(b) {
    const t = T();
    if (!t || !b) return;
    sfx('click');
    switch (b.kind) {
      case 'wish': case 'dream': if (b.villager) openVillager(b.villager); break;
      case 'traveller': {
        const v = vv(b.villager);
        call(() => t.follow(b.villager), null);
        say(S.travellerTap(v, v.homeName), 'info', 3200);
        break;
      }
      case 'camp': openCamp(); break;
      case 'almost': case 'fix': case 'vacancy': if (b.home) openHint(b.kind, b.home); break;
      case 'gift': openGift(lastGift); break;
      default: if (b.villager) openVillager(b.villager);
    }
  }

  function bubbleLabel(b) {
    const v = b.villager ? vv(b.villager) : null;
    const lb = b.label || b.text || '';
    switch (b.kind) {
      case 'wish': return lb.includes(':') || !v ? lb || 'A wish' : `${v.name}'s wish: ${lb}`;
      case 'dream': return lb.includes(':') || !v ? lb || 'A dream' : `${v.name} dreams: ${lb}`;
      case 'traveller': return v ? `${v.name} is on the way · follow` : lb || 'A traveller is on the way';
      case 'camp': return lb || 'A bed for the campers';
      case 'almost': return lb ? (lb.toLowerCase().startsWith('almost') ? lb : `Almost a home: ${lb}`) : 'Almost a home';
      case 'fix': return lb || 'A home that needs fixing';
      case 'vacancy': return lb || 'A free bed: who could live here?';
      case 'gift': return lb || 'A thank-you gift';
      default: return lb;
    }
  }

  function hideAllBubbles() {
    if (!layerShown) return;
    layerShown = false;
    layer.classList.add('is-off');
  }

  /** Project world → canvas px. → { x, y, behind, cx, cy (camera-space x / y, for directions behind the camera) } */
  function project(at, out) {
    const cam = app.camera;
    v3.set(at[0], at[1], at[2]).applyMatrix4(cam.matrixWorldInverse);
    out.cx = v3.x; out.cy = v3.y;
    out.behind = v3.z > -0.05;
    v3.applyMatrix4(cam.projectionMatrix);
    out.x = (v3.x + 1) * 0.5 * out.W;
    out.y = (1 - v3.y) * 0.5 * out.H;
    return out;
  }

  let occRays = 0;
  const P = { x: 0, y: 0, W: 1, H: 1, behind: false, cx: 0, cy: 0 };
  const seenKinds = new Set();         // kinds that were on screen this session (tips)
  function layoutBubbles(t) {
    const list = call(() => t.bubbles(), []);
    const cam = app.camera, cv = app.renderer?.domElement;
    if (!cam || !cv || !v3) return;
    cam.updateMatrixWorld();
    const W = cv.clientWidth || window.innerWidth, H = cv.clientHeight || window.innerHeight;
    P.W = W; P.H = H;
    const I = app.rig?.insets || { top: 0, bottom: 0, left: 0, right: 0 };
    const fl = I.left || 0, ft = I.top || 0, fr = W - (I.right || 0), fb = H - (I.bottom || 0);
    const camPos = cam.position, tgt = app.rig?.goal?.target;
    const mode = app.rig?.mode;
    const pas = mode === 'aim' || mode === 'draw';
    if (pas !== passive) { passive = pas; layer.classList.toggle('is-passive', pas); }
    if (!layerShown) { layerShown = true; layer.classList.remove('is-off'); }
    occRays = 0;

    const taps = [], quiet = [], sleeps = [];
    const keep = new Set();
    for (const b of Array.isArray(list) ? list : []) {
      if (!b || !b.key || !Array.isArray(b.at) || b.at.length < 3 || !b.at.every(Number.isFinite)) continue;
      keep.add(b.key);
      let at = b.at;
      if (Array.isArray(b.roof) && b.roof.length >= 3 && occluded(b)) at = b.roof;
      const dist = camPos.distanceTo(v3b.set(at[0], at[1], at[2]));
      project(at, P);
      const inFree = !P.behind && P.x >= fl && P.x <= fr && P.y >= ft && P.y <= fb;
      const item = { b, at, dist, x: P.x, y: P.y, inFree, behind: P.behind, cx: P.cx, cy: P.cy, edge: null, count: 1 };
      if (b.kind === 'traveller' || b.kind === 'passerby' || b.arrow) {
        if (!inFree || (b.kind !== 'passerby' && P.y > fb)) item.edge = edgePoint(P, fl, ft, fr, fb);
        else if (b.kind === 'passerby') continue;      // a passer-by on screen has no bubble
        if (b.kind === 'passerby') { quiet.push(item); continue; }
        if (!item.edge) keepIn(item, dist, fl, ft, fr);
        taps.push(item);
        continue;
      }
      // wishes and dreams never vanish off an edge or under the bars: off-screen (but in front and within their cull
      // range) they ride the free area's edge with an arrow, like a traveller; near an edge they are kept inside it.
      // On screen they are never culled by distance, whatever the framing (the 0.8 minimum scale): a tall portrait
      // phone frames the stamped farmhouse from up to 55 m and the rig pulls back to 80 m, so the lot's far corner can
      // be 110 m away with the villager plainly in view (R3 T3.2, R4 T4.2). Off screen, the arrow's range follows the
      // rig: its furthest pull-back plus the lot's reach
      if ((b.kind === 'wish' || b.kind === 'dream') && !P.behind && (inFree || dist <= (app.rig?.maxRadius || 80) + WISH_REACH_M)) {
        if (!inFree) item.edge = edgePoint(P, fl, ft, fr, fb);
        else keepIn(item, dist, fl, ft, fr);
        taps.push(item);
        continue;
      }
      if (P.behind || dist > CULL_M || !inFree) continue;
      if (b.kind === 'sleep') {
        const td = tgt ? Math.hypot(at[0] - tgt.x, at[2] - tgt.z) : 0;
        if (td <= SLEEP_M) sleeps.push(item);
        continue;
      }
      if (b.kind === 'nameplate' || b.tappable === false) { quiet.push(item); continue; }
      keepIn(item, dist, fl, ft, fr);                // camp, fix-up, almost, vacancy, gift: clear of the bars (T1.10)
      taps.push(item);
    }
    // priority, nearest first; merge neighbours closer than 36 px; at most 6. Edge bubbles merge with each other the
    // same way when their edge points are closer than their 48 px circle (R6 T6.3): housemates indoors share the
    // roof anchor, so off screen (or in the cutaway, with the roof above the top bar) their two arrows landed on one
    // point, one hiding the other with no ×2
    taps.sort((a, c) => (ORDER[a.b.kind] ?? 9) - (ORDER[c.b.kind] ?? 9) || a.dist - c.dist);
    const shown = [];
    for (const it of taps) {
      if (shown.length >= BUBBLE_MAX) break;
      const near = it.edge ? shown.find((s) => s.edge && Math.hypot(s.edge.x - it.edge.x, s.edge.y - it.edge.y) < EDGE_MERGE_PX)
        : shown.find((s) => !s.edge && Math.hypot(s.x - it.x, s.y - it.y) < MERGE_PX);
      if (near) { near.count++; continue; }
      shown.push(it);
    }
    sleeps.sort((a, c) => a.dist - c.dist);
    // a 💤 that shares its roof anchor with a wish / dream / hint bubble moves aside so the two don't stack
    for (const z of sleeps) if (shown.some((s) => !s.edge && Math.abs(s.x - z.x) < 30 && Math.abs(s.y - z.y) < 30)) z.x += 34;
    // no tappable bubble sits under a toast (T2.2): the one-time camp tip used to cover the very bubble it was about
    // for its 4.6 s. A bubble whose box (38 × 46 px × scale, tail tip on the anchor) overlaps a toast moves just below
    // the stack while it is up, as the nameplate does; the bars' clamp (keepIn) still holds. The Show me checklist
    // chip sits in the same stack, under the toasts, for the whole Show me: the band covers it too (R3 T3.6). An edge
    // bubble (an off-screen wisher, often the one Show me has just turned the camera away from) dodges too: it rides
    // the edge of the free area below the band instead of the bars' edge while the band is up (R4 T4.1)
    const band = shown.some((it) => (it.edge ? edgeBox(it.edge).t : it.y - 46) < fb * 0.6) ? toastBand(cv) : null;
    if (band) {
      for (const it of shown) {
        if (it.edge) {
          const e = edgeBox(it.edge), ft2 = band.bottom + 4 + EDGE_REACH - EDGE_PX;
          if (e.t < band.bottom && e.b > band.top && e.r > band.left && e.l < band.right && ft2 > ft && fb - ft2 > 3 * EDGE_PX) it.edge = edgePoint(it, fl, ft2, fr, fb);
          continue;
        }
        const s = scaleAt(it.dist), half = 19 * s, top = it.y - 46 * s;
        if (top < band.bottom && it.y > band.top && it.x + half > band.left && it.x - half < band.right) it.y = Math.min(fb, band.bottom + 46 * s + 4);
      }
    }
    // the move-in nameplate never sits behind the toast stack: below it when the roof anchor is in the toast band
    if (quiet.some((q) => q.b.kind === 'nameplate')) {
      const tb = root.querySelector('.hw-toasts');
      const bottom = tb && tb.childElementCount ? tb.getBoundingClientRect().bottom : -1;
      for (const q of quiet) if (q.b.kind === 'nameplate' && bottom > 0 && q.y - 34 < bottom) q.y = bottom + 40;
    }
    const vis = new Set();
    for (const it of [...shown, ...quiet, ...sleeps.slice(0, SLEEP_MAX)]) {
      const r = bubbleRec(it.b);
      r.b = it.b;
      vis.add(it.b.key);
      placeBubble(r, it);
      if (it.b.villager && (it.b.kind === 'wish' || it.b.kind === 'dream') && !it.edge) lastPos.set(it.b.villager, { x: it.x, y: it.y, s: scaleAt(it.dist) });
      if (!it.edge && !seenKinds.has(it.b.kind) && settledOnScreen(it.b)) { seenKinds.add(it.b.kind); firstOnScreen(it.b); }
      if (it.b.kind === 'passerby' && !seenKinds.has('passerby')) { seenKinds.add('passerby'); firstOnScreen(it.b); }
    }
    for (const [key, r] of bubbles) {
      if (!keep.has(key)) { r.el.remove(); bubbles.delete(key); occ.delete(key); continue; }
      if (!vis.has(key) && r.shown) { r.shown = false; r.el.classList.add('is-hid'); r.tf = ''; }
    }
  }
  /** The top stack's busy box in canvas px: the toast stack while a toast is up, joined with the Show me checklist chip
   *  while it shows (R3 T3.6); null when neither is up. The stack's layout box, not the toasts' own: their in / out
   *  springs never move it, so a bubble below it holds still. Read only while a bubble is high enough to meet it, and
   *  before this frame's transform writes, so it forces no extra layout. */
  let toastsEl = null;
  function toastBand(cv) {
    if (!toastsEl || !toastsEl.isConnected) toastsEl = root.querySelector('.hw-toasts');
    let box = null;
    const join = (q) => {
      if (!q || q.width <= 0 || q.height <= 0) return;
      box = box ? { left: Math.min(box.left, q.left), top: Math.min(box.top, q.top), right: Math.max(box.right, q.right), bottom: Math.max(box.bottom, q.bottom) }
        : { left: q.left, top: q.top, right: q.right, bottom: q.bottom };
    };
    if (toastsEl && toastsEl.childElementCount) join(toastsEl.getBoundingClientRect());
    if (!check.hidden && check.isConnected) join(check.getBoundingClientRect());
    if (!box) return null;
    const c = cv.getBoundingClientRect();
    return { left: box.left - c.left, top: box.top - c.top, right: box.right - c.left, bottom: box.bottom - c.top };
  }
  const scaleAt = (d) => (d <= NEAR_M ? 1 : d >= FAR_M ? 0.8 : 1 - 0.2 * ((d - NEAR_M) / (FAR_M - NEAR_M)));
  /** An on-screen tappable bubble is kept EDGE_IN px (× scale) inside the free area's sides and 50 px below its top,
   *  so it never sits under the top bar, the hearth chip or the toasts (§10.1). */
  function keepIn(item, dist, fl, ft, fr) {
    const s = scaleAt(dist);
    item.x = Math.min(fr - EDGE_IN * s, Math.max(fl + EDGE_IN * s, item.x));
    item.y = Math.max(ft + 50 * s, item.y);
  }
  /** Hint bubbles give their one-time tip only once they have stayed on screen TIP_SETTLE s, so a bubble that is gone
   *  a moment later (a bed a camper is about to take) never leaves a tip behind (T1.5). */
  const TIP_SETTLE = 1;
  const seenAt = new Map();            // bubble key → hud time first laid out on screen
  function settledOnScreen(b) {
    if (b.kind !== 'vacancy' && b.kind !== 'almost') return true;
    if (!seenAt.has(b.key)) { seenAt.set(b.key, now); if (seenAt.size > 64) seenAt.delete(seenAt.keys().next().value); }
    return now - seenAt.get(b.key) >= TIP_SETTLE;
  }

  /** An edge bubble's box in canvas px: its 48 px hit circle joined with its arrow (20 px, centred --arrow-r 28 px out
   *  toward the target), so the whole of it can be kept clear of the toast / checklist band (R4 T4.1). */
  function edgeBox(e) {
    const ax = e.x + Math.cos(e.a) * 28, ay = e.y + Math.sin(e.a) * 28;
    return { l: Math.min(e.x - 24, ax - 10), t: Math.min(e.y - 24, ay - 10), r: Math.max(e.x + 24, ax + 10), b: Math.max(e.y + 24, ay + 10) };
  }
  /** Where an off-screen target's arrow sits: on the free area's edge (inset), toward the target. `p` is the target's
   *  projection (x, y, behind, cx, cy: a layout item carries them too). */
  function edgePoint(p, fl, ft, fr, fb) {
    const cx = (fl + fr) / 2, cy = (ft + fb) / 2;
    let dx, dy;
    if (p.behind) { dx = p.cx; dy = -p.cy; } else { dx = p.x - cx; dy = p.y - cy; }
    if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) dy = 1;
    const hw = Math.max(10, (fr - fl) / 2 - EDGE_PX), hh = Math.max(10, (fb - ft) / 2 - EDGE_PX);
    const k = Math.min(hw / Math.max(1e-6, Math.abs(dx)), hh / Math.max(1e-6, Math.abs(dy)));
    return { x: cx + dx * k, y: cy + dy * k, a: Math.atan2(dy, dx) };
  }

  /** Occlusion of a villager's head anchor by a piece nearer the camera (4 Hz per bubble, ≤ 2 rays a frame). */
  function occluded(b) {
    let o = occ.get(b.key);
    if (!o) { o = { at: 0, hidden: false }; occ.set(b.key, o); }
    if (now < o.at || occRays >= OCC_RAYS || !app.builder?.pickPiece) return o.hidden;
    o.at = now + OCC_EVERY;
    occRays++;
    project(b.at, P);
    if (P.behind) return (o.hidden = false);
    const pk = call(() => app.builder.pickPiece(P.x, P.y), null);
    const d = app.camera.position.distanceTo(v3b.set(b.at[0], b.at[1], b.at[2]));
    o.hidden = !!(pk?.point && app.camera.position.distanceTo(pk.point) < d - 0.3);
    return o.hidden;
  }

  function placeBubble(r, it) {
    const b = it.b, el = r.el;
    if (!r.shown) { r.shown = true; el.classList.remove('is-hid'); }
    // content (written only when it changes)
    const icon = b.kind === 'passerby' ? '👣' : b.kind === 'sleep' ? '💤' : b.kind === 'nameplate' ? '' : (b.icon || defaultIcon(b.kind));
    if (icon !== r.icon) {
      r.icon = icon;
      const sparkle = /✨/.test(icon) && icon.replace('✨', '').trim();
      r.ic.textContent = sparkle || icon;
      el.classList.toggle('has-sparkle', !!sparkle);
    }
    if (b.kind === 'nameplate') {
      const tx = b.text || b.label || '';
      if (tx !== r.text) { r.text = tx; r.ic.textContent = tx; }
    }
    const count = b.kind === 'camp' ? Number(b.text ?? b.count ?? 0) || 0 : 0;
    const badge = it.count > 1 ? `×${it.count}` : b.kind === 'dream' ? '💭' : count > 0 ? String(count) : '';
    if (badge !== r.badgeText) { r.badgeText = badge; r.badge.textContent = badge; el.classList.toggle('has-badge', !!badge); el.classList.toggle('is-merged', it.count > 1); }
    const dim = !!b.dim;
    if (dim !== r.dim) { r.dim = dim; el.classList.toggle('is-dim', dim); }
    if (isTappable(b)) {
      const lb = bubbleLabel(b) + (it.count > 1 ? ` (and ${it.count - 1} more)` : '');
      if (lb !== r.label) { r.label = lb; el.setAttribute('aria-label', lb); el.title = lb; }
    }
    // position: the tail tip sits on the anchor; an edge bubble centres on its edge point and shows its arrow
    let tf;
    if (it.edge) {
      if (r.edge !== true) { r.edge = true; el.classList.add('is-edge'); }
      const deg = (it.edge.a * 180) / Math.PI;
      const ad = Math.round(deg);
      if (ad !== r.ang) { r.ang = ad; r.arrow.style.transform = `rotate(${ad}deg) translateX(var(--arrow-r, 26px))`; }
      tf = `translate3d(${it.edge.x.toFixed(1)}px,${it.edge.y.toFixed(1)}px,0) translate(-50%,-50%)`;
    } else {
      if (r.edge !== false) { r.edge = false; el.classList.remove('is-edge'); }
      const s = b.kind === 'sleep' || b.kind === 'nameplate' ? Math.max(0.8, scaleAt(it.dist)) : scaleAt(it.dist);
      tf = `translate3d(${it.x.toFixed(1)}px,${it.y.toFixed(1)}px,0) scale(${s.toFixed(3)}) translate(-50%,-100%)`;
    }
    if (tf !== r.tf) { r.tf = tf; el.style.transform = tf; }
  }
  function defaultIcon(kind) {
    return { traveller: '🎒', camp: '⛺', fix: '🔨', vacancy: '🏡✨', gift: '🎁', almost: '🏠', wish: '💭', dream: '💭' }[kind] || '💬';
  }

  /** A bubble gone with a flourish: 💛 floating up (granted) or a shrinking 🙂 (faded, §7.1). */
  function ghost(villagerId, icon, cls) {
    const p = lastPos.get(villagerId);
    if (!p || !layerShown) return;
    const el = h('div', { class: `hw-bubble hw-bubble-ghost ${cls}`, 'aria-hidden': 'true' }, h('span', { class: 'hw-bubble-c' }, h('span', { class: 'hw-bubble-ic' }, icon)));
    el.style.transform = `translate3d(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px,0) scale(${p.s.toFixed(3)}) translate(-50%,-100%)`;
    layer.append(el);
    setTimeout(() => el.remove(), 1300);
  }

  // ---------------------------------------------------------------- one-time tips (§10.6)
  function tip(id) { const t = T(); return !!t && call(() => !!t.tipOnce(id), false); }
  function firstOnScreen(b) {
    const t = T();
    if (!t) return;
    if (b.kind === 'wish' || b.kind === 'dream') { if (tip('wish')) say(S.tips.wish, 'info', 3600); }
    else if (b.kind === 'almost') { if (tip('almost')) say(S.tips.almost, 'info', 4200); }
    else if (b.kind === 'vacancy') { if (tip('vacancy')) say(S.tips.vacancy, 'info', 4200); }
    else if (b.kind === 'camp') { if (tip('camp')) say(S.tips.camp, 'info', 4600); }
    else if (b.kind === 'passerby') {
      if (tip('passerby')) say(S.tips.passerby, 'info', 6000, { label: S.watch, fn: () => call(() => T()?.follow(b.villager), null) });
    }
  }

  // ================================================================ cards (§10.2–10.4)
  const sideMQ = matchMedia('(orientation: landscape) and (max-height: 540px)');
  const floatMQ = matchMedia('(pointer: fine) and (min-width: 900px)');
  const catcher = h('div', { class: 'hw-tcatch' });
  const cardEl = h('div', { class: 'hw-tcard hw-hide-photo', role: 'dialog', 'aria-modal': 'false', tabindex: '-1' });
  root.append(catcher, cardEl);
  catcher.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (card?.kind === 'intro') answerIntro(true);
    else closeCard();
  });
  /** The open card: { kind, id, render() → { title?, body nodes }, sig, anchor:{x,y}|null, onClose } */
  let card = null;
  let lastPointer = null;               // where the last canvas press was (desktop card placement after a tap)
  const onPointer = (e) => { if (e.target === app.renderer?.domElement) lastPointer = { x: e.clientX, y: e.clientY }; };
  window.addEventListener('pointerdown', onPointer, true);

  function openCard(kind, id, render, { anchor = null, label = 'Village', cls = '' } = {}) {
    if (dead) return;
    const wasOpen = !!card;
    card = { kind, id, render, sig: '', anchor, cls };
    cardEl.className = `hw-tcard hw-hide-photo is-open k-${kind}${cls ? ' ' + cls : ''}`;
    cardEl.setAttribute('aria-label', label);
    catcher.classList.add('is-open');
    catcher.classList.toggle('is-dim', kind === 'intro');
    root.classList.add('town-card-open');
    refreshCard(true);
    if (!wasOpen) { cardEl.classList.remove('is-in'); void cardEl.offsetWidth; cardEl.classList.add('is-in'); }
    app.builder?.hideGhost?.();
  }
  function closeCard(sound = true) {
    if (!card) return false;
    const k = card.kind;
    const was = card;
    card = null;
    cardEl.classList.remove('is-open', 'is-in');
    cardEl.style.transform = '';
    catcher.classList.remove('is-open');
    root.classList.remove('town-card-open');
    if (k === 'town' && was.noteShown) noteClosed = was.noteShown;
    if (sound) sfx('close');
    return true;
  }
  /** Re-render the open card when what it shows changed (4 Hz), and keep it laid out. */
  function refreshCard(force = false) {
    if (!card) return;
    const out = card.render();
    if (!out) { closeCard(false); return; }
    const sig = out.sig ?? '';
    if (force || sig !== card.sig) {
      card.sig = sig;
      const head = h('div', { class: 'hw-tc-head' }, out.head || null,
        h('button', { type: 'button', class: 'hw-rbtn hw-tc-x', 'aria-label': 'Close', title: 'Close (Esc)', html: CLOSE_SVG, onclick: () => closeCard() }));
      wireSwipe(head);
      cardEl.replaceChildren(head, h('div', { class: 'hw-tc-body' }, out.body));
    }
    layoutCard();
  }
  function cardMode() { return sideMQ.matches ? 'side' : floatMQ.matches ? 'float' : 'bottom'; }
  function layoutCard() {
    if (!card) return;
    const mode = cardMode();
    if (cardEl.dataset.mode !== mode) { cardEl.dataset.mode = mode; cardEl.style.left = ''; cardEl.style.top = ''; cardEl.style.maxHeight = ''; }
    if (mode !== 'float') return;
    // desktop: float beside what was tapped, kept inside the free area (it scrolls when that is short)
    const I = app.rig?.insets || { top: 0, bottom: 0, left: 0, right: 0 };
    const W = window.innerWidth, H = window.innerHeight;
    const fl = (I.left || 0) + 12, ft = (I.top || 0) + 12, fr = W - (I.right || 0) - 12, fb = H - (I.bottom || 0) - 12;
    const mh = `${Math.round(Math.max(320, fb - Math.max(ft, 8)))}px`;
    if (cardEl.style.maxHeight !== mh) cardEl.style.maxHeight = mh;
    const cw = cardEl.offsetWidth || 340, ch = cardEl.offsetHeight || 200;
    let a = card.anchor;
    if (card.kind === 'town') { const r = hearth.getBoundingClientRect(); a = r.width ? { x: r.left + r.width / 2, y: r.bottom, below: true } : null; }
    let x, y;
    if (a && a.below) { x = a.x - 24; y = a.y + 12; }
    else if (a) { x = a.x + 40; y = a.y - ch / 2; if (x + cw > fr) x = a.x - 40 - cw; }
    else { x = fl + 8; y = fb - ch; }
    x = Math.max(fl, Math.min(fr - cw, x));
    y = Math.max(a?.below ? Math.max(ft, 8) : ft, Math.min(fb - ch, y));
    const L = `${Math.round(x)}px`, Tp = `${Math.round(y)}px`;
    if (cardEl.style.left !== L) cardEl.style.left = L;
    if (cardEl.style.top !== Tp) cardEl.style.top = Tp;
  }
  /** Swipe the card's head down to close it (touch). */
  function wireSwipe(head) {
    let sy = null, dy = 0, id = null;
    head.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' || e.target.closest('button')) return;
      sy = e.clientY; dy = 0; id = e.pointerId;
      try { head.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      cardEl.style.transition = 'none';
    });
    head.addEventListener('pointermove', (e) => {
      if (sy === null || e.pointerId !== id) return;
      dy = Math.max(0, e.clientY - sy);
      cardEl.style.transform = dy ? `translateY(${dy}px)` : '';
    });
    const end = () => {
      if (sy === null) return;
      sy = null;
      cardEl.style.transition = '';
      cardEl.style.transform = '';
      if (dy > 70) { if (card?.kind === 'intro') answerIntro(true); else closeCard(); }
    };
    head.addEventListener('pointerup', end);
    head.addEventListener('pointercancel', end);
  }
  const pill = (label, fn, cls = '', attrs = {}) => h('button', {
    type: 'button', class: `hw-pill ${cls}`, 'aria-label': attrs.aria || null, 'data-act': attrs.act || null,
    onclick: (e) => { e.stopPropagation(); if (dead) return; sfx('click'); try { fn(e); } catch (err) { die('card', err); } },
  }, h('span', null, label));
  const icBtn = (icon, label, fn, act) => h('button', {
    type: 'button', class: 'hw-rbtn hw-tc-ic', 'aria-label': label, title: label, 'data-act': act || null,
    onclick: (e) => { e.stopPropagation(); if (dead) return; sfx('click'); try { fn(e); } catch (err) { die('card', err); } },
  }, icon);

  // ---------------------------------------------------------------- villager card (§10.2)
  function openVillager(id) {
    const t = T();
    if (!t || !id || state.photoMode) return false;
    const v = call(() => t.villager(String(id)), null);
    if (!v) return false;
    const anchorFrom = () => {
      const r = [...bubbles.values()].find((x) => x.shown && x.b?.villager === v.id && !x.edge);
      if (r) { const bb = r.el.getBoundingClientRect(); return { x: bb.left + bb.width / 2, y: bb.top + bb.height / 2 }; }
      return lastPointer;
    };
    openCard('villager', v.id, () => villagerCard(v.id), { anchor: anchorFrom(), label: `${v.name}, ${v.jobLabel || ''}` });
    sfx('villager', { pitch: Number.isFinite(v.voice) ? v.voice : 1 });
    announce(`${v.name}, ${v.jobLabel || ''}${v.traitLabel ? ', ' + v.traitLabel : ''}.${v.wish ? ' Wish: ' + (v.wish.label || v.wish.text) + '.' : ''}`);
    return true;
  }
  function villagerCard(id) {
    const t = T();
    if (!t) return null;
    const v = call(() => t.villager(id), null);
    if (!v) return null;
    const w = v.wish;
    const sig = JSON.stringify([v.name, v.status, v.statusText, v.homeName, w && [w.tpl, w.text, w.dream, w.pieceName], v.fadedWish, v.line, v.grants, enabled()]);
    const head = h('div', { class: 'hw-tc-who' },
      h('span', { class: 'hw-tc-av', style: { background: v.color || '#9cae6b' }, 'aria-hidden': 'true' }, v.jobIcon || '🙂'),
      h('div', { class: 'hw-tc-name' }, h('b', null, v.name),
        h('small', null, [v.jobLabel, v.traitLabel ? `${v.traitIcon || ''} ${v.traitLabel}`.trim() : null].filter(Boolean).join(' · '))));
    const rows = [];
    // status line (§10.2)
    if (v.status === 'traveller') rows.push(h('div', { class: 'hw-tc-row' }, h('span', { class: 'hw-tc-tx' }, v.statusText || `🎒 On the way to ${v.homeName || 'a new home'}`)));
    else if (v.status === 'camping') rows.push(h('div', { class: 'hw-tc-row' }, h('span', { class: 'hw-tc-tx' }, v.statusText || '⛺ Camping by the lane until there\'s a bed free')));
    else if (v.status === 'waiting') {
      const home = homeOf(v.homeId);
      const miss = home?.missing?.[0];
      rows.push(h('div', { class: 'hw-tc-row' },
        h('span', { class: 'hw-tc-tx' }, v.statusText || `🔨 ${possessive(v.name, v.homeName)} needs fixing${miss ? ': ' + lower(miss.text) : ''}`),
        v.homeId ? pill(`📍 ${S.showMe}`, () => { closeCard(false); call(() => T().showMe({ home: v.homeId, hint: miss?.kind || true }), false); }, 'hw-pill-primary hw-tc-show', { act: 'showme' }) : null));
    } else if (v.homeName) {
      rows.push(h('div', { class: 'hw-tc-row' },
        h('span', { class: 'hw-tc-tx' }, `🏡 Lives in ${v.homeName}`),
        v.homeId ? icBtn('📍', `Show ${v.homeName}`, () => { closeCard(false); call(() => T().focusHome(v.homeId), null); }, 'home') : null));
    }
    // the wish (§7)
    if (w) {
      const say1 = w.dream ? `💭 ${v.name} dreams: ${w.label || w.text}` : `💭 “${w.text || w.label}”`;
      rows.push(h('div', { class: 'hw-tc-wish' + (w.dream ? ' is-dream' : '') },
        h('span', { class: 'hw-tc-tx' }, say1),
        h('div', { class: 'hw-tc-acts' },
          w.pieceName ? h('span', { class: 'hw-tc-piece' }, `${w.icon || ''} ${w.pieceName}`.trim()) : null,
          pill(`📍 ${S.showMe}`, () => { closeCard(false); call(() => T().showMe({ villager: v.id }), false); }, 'hw-pill-primary hw-tc-show', { act: 'showme' }))));
    } else if (v.fadedWish) rows.push(h('div', { class: 'hw-tc-row hw-tc-faded' }, h('span', { class: 'hw-tc-tx' }, S.never)));
    if (v.line) rows.push(h('blockquote', { class: 'hw-tc-line' }, `❝ ${v.line} ❞`));
    const g = Math.max(0, Number(v.grants) || 0);
    rows.push(h('div', { class: 'hw-tc-row hw-tc-foot' },
      h('span', { class: 'hw-tc-tx' }, g ? `💛 ${plural(g, 'wish', 'wishes')} granted` : '💛 No wishes granted yet'),
      pill(S.follow, () => { closeCard(false); call(() => T().follow(v.id), null); }, 'hw-tc-follow', { act: 'follow' })));
    return { sig, head, body: rows };
  }
  const lower = (s) => (s ? String(s).charAt(0).toLowerCase() + String(s).slice(1) : '');
  /** "Mabel's thatched cottage" from "the thatched cottage". */
  function possessive(name, home) {
    const hn = String(home || 'home').replace(/^the\s+/i, '');
    return /'s\s/.test(hn) ? cap(hn) : `${name}'s ${hn}`;
  }

  // ---------------------------------------------------------------- town card (§10.3)
  let noteClosed = null;
  function openTown() {
    const t = T();
    if (!t || state.photoMode) return false;
    openCard('town', null, townCard, { label: 'Your town' });
    return true;
  }
  function townCard() {
    const t = T();
    if (!t) return null;
    const V = view() || {};
    const on = enabled();
    const c = call(() => t.cozy(), null) || V.cozy || { value: 0, tier: 'quiet', warmth: 0, charm: 0 };
    const value = Math.round(Number(c.value) || 0);
    const tier = TIERS[c.tier] || cap(c.tier || 'quiet');
    const vill = Array.isArray(V.villagers) ? V.villagers : [];
    const residents = vill.filter((v) => v && (v.status === 'resident' || v.status === 'waiting'));
    const campers = Number(V.campers) || vill.filter((v) => v?.status === 'camping').length;
    const note = V.note && V.note !== noteClosed ? V.note : null;
    const sig = JSON.stringify([on, value, tier, Math.round(c.warmth), Math.round(c.charm), residents.map((v) => [v.id, v.name, v.jobIcon, v.status]),
      campers, note, V.openWishes, (V.couldMoveIn || []).map((r) => r.text), (V.almost || []).map((a) => [a.id, a.missing?.[0]?.text]),
      !!state.timeFlow, V.day, V.granted, V.full]);
    const head = h('div', { class: 'hw-tc-cozy' },
      h('b', null, on ? `🔥 Cozy ${value} · ${tier}` : '🔥 Town'),
      on ? h('div', { class: 'hw-bar hw-tc-bar', role: 'meter', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(value), 'aria-label': 'Cozy' },
        h('i', { style: { width: `${Math.max(0, Math.min(100, value))}%` } })) : null);
    if (!on) return { sig, head, body: [h('p', { class: 'hw-tc-note' }, S.resting)] };
    const body = [];
    body.push(h('p', { class: 'hw-tc-sub' }, `Warmth ${Math.round(c.warmth || 0)} from neighbours and wishes · Charm ${Math.round(c.charm || 0)} from decor round homes`));
    body.push(h('p', { class: 'hw-tc-note' }, S.cozyWhy));
    // residents
    if (residents.length || campers) {
      body.push(h('div', { class: 'hw-tc-sec' }, h('h4', null, 'Residents'),
        h('div', { class: 'hw-tc-chips' },
          residents.map((v) => h('button', {
            type: 'button', class: 'hw-tc-chip', 'data-id': v.id, 'aria-label': `${v.name}, ${v.jobLabel || ''}`,
            onclick: (e) => { e.stopPropagation(); sfx('click'); openVillager(v.id); },
          }, h('span', { class: 'hw-tc-chip-av', style: { background: v.color || '#9cae6b' } }, v.jobIcon || '🙂'), h('span', null, v.name))),
          campers ? h('span', { class: 'hw-tc-camp' }, `⛺ ${campers} camping`) : null)));
    } else body.push(h('p', { class: 'hw-tc-note' }, '🌱 Build a home with a bed and someone may move in.'));
    if (note) { body.push(h('p', { class: 'hw-tc-boot' }, note)); if (card) card.noteShown = note; }
    if (V.full) body.push(h('p', { class: 'hw-tc-full' }, S.full(vill.length || 20)));
    const ow = Number(V.openWishes) || 0;
    if (ow) body.push(h('div', { class: 'hw-tc-row' }, h('span', { class: 'hw-tc-tx' }, `💭 ${plural(ow, 'wish', 'wishes')} open`),
      pill('Next ›', () => { closeCard(false); nextWish(); }, '', { act: 'next' })));
    const could = Array.isArray(V.couldMoveIn) ? V.couldMoveIn : [];
    if (could.length) {
      body.push(h('div', { class: 'hw-tc-sec' }, h('h4', null, 'Could move in'),
        could.map((r) => h('div', { class: 'hw-tc-row hw-tc-item' }, h('span', { class: 'hw-tc-tx' }, `${r.icon || '🏡'} ${r.text}`),
          r.target ? pill(S.showMe, () => { closeCard(false); call(() => T().showMe(r.target), false); }, '', { act: 'showme' }) : null))));
    }
    const almost = Array.isArray(V.almost) ? V.almost : [];
    if (almost.length) {
      body.push(h('div', { class: 'hw-tc-sec' }, h('h4', null, 'Almost homes'),
        almost.map((a) => {
          const m = a.missing?.[0];
          const what = String(m?.text || 'almost a home').replace(/^almost a home:\s*/i, '');
          return h('div', { class: 'hw-tc-row hw-tc-item' }, h('span', { class: 'hw-tc-tx' }, `${m?.icon || '🏠'} ${cap(a.name || 'a building')}: ${lower(what)}`),
            pill(S.showMe, () => { closeCard(false); call(() => T().showMe({ home: a.id, hint: m?.kind || true }), false); }, '', { act: 'showme' }));
        })));
    }
    if (!state.timeFlow) body.push(h('div', { class: 'hw-tc-row hw-tc-flow' }, h('span', { class: 'hw-tc-tx' }, S.flowRow),
      pill(S.turnOn, () => { state.set({ timeFlow: true }); refreshCard(true); }, 'hw-pill-primary', { act: 'flow' })));
    body.push(h('p', { class: 'hw-tc-day' }, `Day ${(Number(V.day) || 0) + 1} of the town · ${plural(Number(V.granted) || 0, 'wish', 'wishes')} granted`));
    return { sig, head, body };
  }

  // ---------------------------------------------------------------- hint, vacancy and camp cards (§3.7, §10.4)
  function openHint(kind, homeId) {
    const t = T();
    if (!t || state.photoMode) return false;
    const anchor = (() => {
      const r = [...bubbles.values()].find((x) => x.shown && x.b?.home === homeId && x.b.kind === kind);
      if (!r) return null;
      const bb = r.el.getBoundingClientRect();
      return { x: bb.left + bb.width / 2, y: bb.top + bb.height / 2 };
    })();
    openCard(kind, homeId, () => hintCard(kind, homeId), { anchor, label: kind === 'vacancy' ? 'Who could live here?' : 'Almost a home' });
    return true;
  }
  function hintCard(kind, homeId) {
    const V = view() || {};
    const home = homeOf(homeId);
    if (!home && kind !== 'vacancy') return null;
    const missing = Array.isArray(home?.missing) ? home.missing : [];
    const first = missing[0];
    const name = home?.name || 'this building';
    if (kind === 'vacancy') {
      const rows = (V.couldMoveIn || []).filter((r) => r.homeId === homeId).slice(0, 3);
      const sig = JSON.stringify([kind, name, rows.map((r) => r.text)]);
      return {
        sig,
        head: h('div', { class: 'hw-tc-title' }, h('span', { class: 'hw-tc-big', 'aria-hidden': 'true' }, '🏡✨'), h('div', null, h('b', null, 'Who could live here?'), h('small', null, cap(name)))),
        body: rows.length
          ? rows.map((r) => h('div', { class: 'hw-tc-row hw-tc-item' }, h('span', { class: 'hw-tc-tx' }, `${r.icon || ''} ${r.text}`.trim()),
            r.target ? pill(S.showMe, () => { closeCard(false); call(() => T().showMe(r.target), false); }, '', { act: 'showme' }) : null))
          : [h('p', { class: 'hw-tc-note' }, 'A free bed! Add what a villager loves nearby and someone will come.')],
      };
    }
    let title;
    if (kind === 'fix') {
      const who = (home.residents || []).map((id) => vv(id).name).filter(Boolean)[0];
      title = `${who ? possessive(who, name) : cap(name)} needs fixing${first ? ': ' + lower(first.text) : ''}`;
    } else title = first?.text || 'Almost a home';
    const sig = JSON.stringify([kind, name, missing.map((m) => [m.kind, m.text, m.n])]);
    const body = [];
    if (missing.length > 1 || (first && kind === 'fix')) {
      body.push(h('ul', { class: 'hw-tc-miss' }, missing.map((m) => h('li', null, `${m.icon || '•'} ${m.text}${m.n > 1 && !/\d/.test(m.text) ? ` (${m.n})` : ''}`))));
    }
    body.push(h('div', { class: 'hw-tc-acts hw-tc-acts-end' },
      kind === 'almost' ? pill(S.shed, () => { call(() => T().muteHint(homeId), null); closeCard(false); }, 'hw-tc-shed', { act: 'shed' }) : null,
      pill(`📍 ${S.showMe}`, () => { closeCard(false); call(() => T().showMe({ home: homeId, hint: first?.kind || true }), false); }, 'hw-pill-primary hw-tc-show', { act: 'showme' })));
    return {
      sig,
      head: h('div', { class: 'hw-tc-title' }, h('span', { class: 'hw-tc-big', 'aria-hidden': 'true' }, kind === 'fix' ? '🔨' : (first?.icon || '🏠')),
        h('div', null, h('b', null, title), h('small', null, cap(name)))),
      body,
    };
  }
  function openCamp() {
    const t = T();
    if (!t || state.photoMode) return false;
    openCard('camp', 'camp', campCard, { label: 'A bed for the campers' });
    return true;
  }
  function campCard() {
    const V = view() || {};
    const n = Number(V.campers) || (V.villagers || []).filter((v) => v?.status === 'camping').length;
    const names2 = (V.villagers || []).filter((v) => v?.status === 'camping').map((v) => v.name);
    const free = (V.homes || []).some((x) => (x.free || 0) > 0);
    const sig = JSON.stringify([n, names2, free]);
    return {
      sig,
      head: h('div', { class: 'hw-tc-title' }, h('span', { class: 'hw-tc-big', 'aria-hidden': 'true' }, '⛺'),
        h('div', null, h('b', null, `A bed for the campers (${n})`), names2.length ? h('small', null, names2.join(', ')) : null)),
      body: [
        h('p', { class: 'hw-tc-note' }, 'Campers move straight into any free bed in a home.' + (free ? '' : ' Or try a blueprint for a whole new home.')),
        h('div', { class: 'hw-tc-acts hw-tc-acts-end' },
          pill(`📍 ${S.showMe}`, () => { closeCard(false); call(() => T().showMe({ camp: true }), false); }, 'hw-pill-primary hw-tc-show', { act: 'showme' })),
      ],
    };
  }

  // ---------------------------------------------------------------- intro card (§1.3)
  let introShown = false;
  function openIntro() {
    if (introShown || dead) return;
    introShown = true;
    openCard('intro', 'intro', () => ({
      sig: 'intro',
      head: h('div', { class: 'hw-tc-title' }, h('span', { class: 'hw-tc-big', 'aria-hidden': 'true' }, '🏡'), h('div', null, h('b', null, S.intro.replace(/^🏡\s*/, '')))),
      body: [
        h('p', { class: 'hw-tc-note' }, S.introSub),
        h('div', { class: 'hw-tc-acts hw-tc-intro-acts' },
          pill(S.lovely, () => answerIntro(true), 'hw-pill-primary', { act: 'lovely' }),
          pill(S.quiet, () => answerIntro(false), '', { act: 'quiet' })),
      ],
    }), { label: 'Villagers', cls: 'hw-tc-intro' });
  }
  function answerIntro(lovely) {
    if (card?.kind === 'intro') closeCard(false);
    call(() => T()?.answerIntro(!!lovely), null);
  }

  // ---------------------------------------------------------------- gift card (§10.4)
  const giftEl = h('div', { class: 'hw-tgift hw-hide-photo', role: 'status', 'aria-live': 'polite' });
  root.append(giftEl);
  let lastGift = null, giftTimer = 0;
  function openGift(g) {
    if (!g || dead || !enabled()) return false;
    const def = app.catalog?.getDef?.(g.id);
    const img = h('img', { alt: '' });
    const thumb = h('span', { class: 'hw-tgift-thumb' }, h('span', { class: 'hw-card-emoji' }, def?.icon || '🎁'), img);
    try { app.thumbnail?.(g.id)?.then?.((u) => { if (u) { img.src = u; thumb.classList.add('has-img'); } }, () => {}); } catch { /* ignore */ }
    giftEl.replaceChildren(thumb,
      h('div', { class: 'hw-tgift-tx' },
        h('b', null, `🎁 A thank-you from ${g.fromName || 'a neighbour'}: ${g.name || def?.name || 'a gift'}`),
        h('small', null, 'Find it in 🌷 Garden'),
        h('div', { class: 'hw-tc-acts' },
          pill(S.placeIt, () => { placeGift(g.id); closeGift(); }, 'hw-pill-primary', { act: 'place' }),
          pill('Later', () => closeGift(), 'hw-pill-ghost', { act: 'later' }))));
    giftEl.classList.remove('is-open'); void giftEl.offsetWidth; giftEl.classList.add('is-open');
    clearTimeout(giftTimer);
    giftTimer = setTimeout(closeGift, GIFT_CARD_MS);
    return true;
  }
  function closeGift() { clearTimeout(giftTimer); giftEl.classList.remove('is-open'); }
  function placeGift(id) {
    if (!id || !app.catalog?.getDef?.(id)) return;
    if (state.tool !== 'build') state.set({ tool: 'build' });
    app.builder?.selectPiece?.(id);
  }

  // ---------------------------------------------------------------- checklist chip (§7.6, §10.4)
  const stack = root.querySelector('.hw-topstack');
  const check = h('div', { class: 'hw-tcheck hw-hide-photo', role: 'status', hidden: true });
  const checkTx = h('span', { class: 'hw-tcheck-tx' });
  const checkX = h('button', { type: 'button', class: 'hw-tcheck-x', 'aria-label': 'Stop showing', title: 'Stop showing (Esc)', html: CLOSE_SVG });
  check.append(checkTx, checkX);
  checkX.addEventListener('click', (e) => { e.stopPropagation(); if (dead) return; sfx('click'); call(() => T()?.endShowMe(), null); setChecklist(null); });
  (stack || root).append(check);
  let checkSig = '';
  function checklistText(s) {
    const parts = Array.isArray(s?.parts) ? s.parts : [];
    if (!parts.length) return '';
    const total = parts.reduce((a, p) => a + Math.max(1, Number(p.n) || 1), 0);
    if (total <= 1) return '';
    const items = parts.map((p) => {
      const n = Math.max(1, Number(p.n) || 1), have = Math.max(0, Math.min(n, Number(p.have) || 0));
      return `${p.name || p.piece} ${have >= n ? '✓' : `${have}/${n}`}`;
    });
    return `${parts[0].icon ? parts[0].icon + ' ' : ''}${items.join(' · ')}`;
  }
  function setChecklist(s) {
    const tx = s && enabled() && !state.photoMode ? checklistText(s) : '';
    if (tx === checkSig) return;
    checkSig = tx;
    check.hidden = !tx;
    checkTx.textContent = tx;
    check.setAttribute('aria-label', tx ? `Show me: ${tx}` : '');
  }

  // ---------------------------------------------------------------- next wish (key J, town card "Next ›")
  let nextIdx = -1;
  function nextWish() {
    const t = T();
    if (!t || !enabled()) return null;
    const V = view(true) || {};
    const list = (V.villagers || []).filter((v) => v && v.wish);
    if (!list.length) { say('💭 No wishes right now. Someone will think of something soon.', 'info', 2400); return null; }
    nextIdx = (nextIdx + 1) % list.length;
    const v = list[nextIdx];
    closeCard(false);
    const ok = call(() => t.showMe({ villager: v.id }), false);
    if (!ok) openVillager(v.id);
    return v.id;
  }

  // ================================================================ bus events (§12.5)
  let firstMoveAt = null, readySeen = false;
  /** The town's boot restore ran (§3.8): the intro card, the welcome-back toast. ui.js mounts the hud after first
   *  paint, which can be after `ready`, so this also runs at mount when the town is already ready (and the intro is
   *  polled from view().intro). `away` (s since the last visit) comes with town-ready or in view().away. */
  function onTownReady(d) {
    if (readySeen) return;
    readySeen = true;
    const V = view(true);
    if (V?.intro) openIntro();
    const away = Number(d?.away ?? V?.away);
    const vill = (V?.villagers || []).filter((v) => v && v.status !== 'traveller');
    if (Number.isFinite(away) && away >= WELCOME_AWAY && vill.length && enabled()) say(S.welcomeBack(vill[0].name, vill.length - 1), 'info', 3200);
    if (vill.length && firstMoveAt === null) firstMoveAt = now;      // the flow tip also reaches a returning player
  }
  listen('town-ready', (d) => onTownReady(d));
  listen('town-intro', () => openIntro());
  listen('town-select', (d) => { if (d.id) openVillager(d.id); });
  listen('town-traveller', (d) => {
    const id = typeof d.villager === 'object' ? d.villager?.id : d.villager;
    const text = d.migration ? S.travellerMigration : d.first ? S.travellerFirst : S.traveller;
    say(text, 'info', d.first || d.migration ? 5000 : 4000, { label: S.watch, fn: () => call(() => T()?.follow(id), null) });
  });
  listen('town-movein', (d) => {
    const v = vv(d.villager);
    say(S.movein(v, d.homeName || v.homeName || 'a new home'), 'success', 3200);
    view(true);
    if (d.first) {
      if (firstMoveAt === null) firstMoveAt = now;
      after(0.3, () => {                                           // the 1.5 s beat (§4.6)
        if (hearthShown) glowUp(); else pendingGlow = true;        // (glows up as it appears, if the view lags)
        setHearth(view(true));
      });
      // the one-time hearth tip waits until the 4 s nameplate has gone, so the two never stack over it (§4.6)
      after(HEARTH_TIP_AFTER, () => { if (tip('hearth')) say(S.tips.hearth, 'info', 4200); });
    } else flare(0);
  });
  listen('town-granted', (d) => {
    const v = vv(d.villager);
    const gain = Math.round(Number(d.gain ?? d.reward?.cozy) || 0);
    if (d.camp) say(S.campThanks(v, gain), 'success', 3000);
    else {
      const line = d.line || (v.line && !/^\s*$/.test(v.line) ? v.line : 'It\'s perfect. Thank you!');
      say(S.granted(v, line, gain), 'success', 3000);
      ghost(v.id, '💛', 'is-granted');
    }
    view(true);
    setHearth(viewCache);
    flare(gain);
  });
  listen('town-expired', (d) => {
    const id = typeof d.villager === 'object' ? d.villager?.id : d.villager;
    ghost(id, '🙂', 'is-faded');
  });
  listen('town-gift', (d) => {
    const g = { id: d.id, name: d.name, from: d.from, fromName: d.fromName || vv(d.from).name };
    lastGift = g;
    after(GIFT_DELAY, () => {
      if (!openGift(g) || card || state.photoMode) {
        say(S.gift(g.fromName, g.name || g.id), 'success', 6000, { label: S.placeIt, fn: () => placeGift(g.id) });
      }
    });
  });
  listen('town-cozy', () => { setHearth(view(true)); });
  listen('town-status', (d) => {
    const changes = Array.isArray(d.changes) ? d.changes : [];
    const moved = [], camped = [], back = [];
    for (const c of changes) {
      const v = vv(c.villager);
      if (c.status === 'camping') camped.push(v);
      else if (c.status === 'resident') {
        if (c.prev === 'waiting') { /* fixed up: town-fixed speaks for it (only when the fix-up bubble showed) */ }
        else if (c.back) back.push(v);              // the sim's own word: their old bed in their old home (T1.6)
        else moved.push({ v, home: c.homeName || v.homeName || 'a new home' });
      }
    }
    const parts = [];
    if (moved.length === 1) parts.push(S.moving(moved[0].v, moved[0].home)); else if (moved.length > 1) parts.push(S.movingN(moved.length));
    if (back.length === 1) parts.push(S.back(back[0])); else if (back.length > 1) parts.push(S.backN(back.length));
    if (camped.length === 1) parts.push(S.camping(camped[0])); else if (camped.length > 1) parts.push(S.campingN(camped.length));
    if (parts.length) say(parts.join(' · '), 'info', parts.length > 1 || moved.length + camped.length + back.length > 1 ? 3200 : 2800);
    view(true);
  });
  listen('town-fixed', (d) => {
    const v = vv(d.villager);
    say(S.fixed(v), 'success', 2800);
    flare(Number(d.gain) || 0);
  });
  listen('town-showme', (d) => {
    if (!d.update) {
      const who = d.villager ? vv(d.villager).name : d.camp ? 'the campers' : null;
      say(S.hint(d.icon, d.verb, d.pieceName || d.piece || 'piece', who), 'info', 3600);
    }
    setChecklist({ parts: d.parts });
  });
  listen('town-showme-end', () => setChecklist(null));
  listen('town-homes', () => { view(true); if (card && (card.kind === 'town' || card.kind === 'almost' || card.kind === 'fix' || card.kind === 'vacancy')) refreshCard(); });
  listen('town-enabled', (d) => {
    say(d.on ? S.on : S.off, 'info', 2400);
    view(true);
    if (!d.on) { if (card && card.kind !== 'town') closeCard(false); closeGift(); setChecklist(null); }
    else if (card) refreshCard(true);
  });
  // notices index.js raises whose words live here (§12.9; see the WP3 notes on the town-readonly / town-savefail events)
  listen('town-readonly', () => say(S.otherTab, 'warn', 8000, { label: S.reload, fn: () => location.reload() }));
  listen('town-savefail', () => say(S.saveFail, 'warn', 4200));
  listen('town-passerby', (d) => { void d; });                     // the tip fires when its arrow / route first shows

  offs.push(state.on((changed) => {
    if (dead) return;
    try {
      if (changed.includes('photoMode') && state.photoMode) { closeCard(false); closeGift(); setChecklist(null); }
      if (changed.includes('timeFlow') && card?.kind === 'town') refreshCard(true);
    } catch (e) { die('state', e); }
  }));
  const onResize = () => { if (card) layoutCard(); };
  window.addEventListener('resize', onResize);

  // ================================================================ per frame
  let viewTick = 0, wasEnabled = null, lastReal = 0;
  function frame(dt) {
    // the hud clock follows real time (main.js clamps dt to 0.1 s, so a slow phone would stretch "1.5 s after the
    // grant"); a gap over 1 s (a hidden tab: rAF stops) counts as 1 s. A larger dt passed in (tests) wins.
    const tNow = performance.now();
    const real = lastReal ? Math.min(1, (tNow - lastReal) / 1000) : 0;
    lastReal = tNow;
    dt = Math.max(0, Math.min(Math.max(Number(dt) || 0, real), 1));
    now += dt;
    for (let i = timers.length - 1; i >= 0; i--) if (now >= timers[i].at) { const t = timers.splice(i, 1)[0]; t.fn(); }
    const t = T();
    const on = enabled();
    if (on !== wasEnabled) { wasEnabled = on; if (!on) { hideAllBubbles(); setChecklist(null); } }
    viewTick -= dt;
    if (viewTick <= 0) {
      viewTick = VIEW_EVERY;
      const V = t ? view() : null;
      setHearth(V);
      if (V?.intro && !introShown && on) openIntro();
      if (card) refreshCard();
      if (on && t) setChecklist(call(() => t.showing(), null));
      // the "Let the day pass" tip: 90 s after the first move-in, only for players who pinned the time (§0.4, §10.6)
      if (on && firstMoveAt !== null && now - firstMoveAt >= FLOW_TIP_AFTER) {
        firstMoveAt = Infinity;
        if (!state.timeFlow && tip('flow')) {
          const first = (V?.villagers || []).find((v) => v && v.status !== 'traveller');
          say(S.tips.flow(first?.name), 'info', 8000, { label: S.tips.flowAct, fn: () => state.set({ timeFlow: true }) });
        }
      }
    }
    const blocked = root.classList.contains('sheet-open') || !!root.querySelector('.hw-dlg-wrap.is-open, .hw-welcome-wrap.is-open');
    if (!t || !on || state.photoMode || blocked) { hideAllBubbles(); return; }
    layoutBubbles(t);
  }

  function update(dt) {
    if (dead) return;
    try { frame(dt); } catch (e) { die('update', e); }
  }

  function close() {
    if (dead) return false;
    if (card?.kind === 'intro') { answerIntro(true); return true; }
    return closeCard();
  }

  function destroy() {
    if (dead) return;
    dead = true;
    for (const off of offs) { try { off(); } catch { /* ignore */ } }
    offs.length = 0;
    window.removeEventListener('pointerdown', onPointer, true);
    window.removeEventListener('resize', onResize);
    clearTimeout(giftTimer);
    for (const el of [layer, catcher, cardEl, giftEl, check, hearth, sr]) { try { el.remove(); } catch { /* ignore */ } }
    root.classList.remove('has-hearth', 'town-card-open');
    bubbles.clear();
  }

  // mounted after the town's `ready` (the usual case at boot): catch up on what town-ready would have shown
  try { if (ready()) onTownReady({}); } catch (e) { die('mount', e); }

  const guardApi = (name, fn, fb) => (...a) => { if (dead) return fb; try { return fn(...a); } catch (e) { die(name, e); return fb; } };
  return {
    update,
    openTown: guardApi('openTown', openTown, false),
    openVillager: guardApi('openVillager', openVillager, false),
    nextWish: guardApi('nextWish', nextWish, null),
    close: guardApi('close', close, false),
    isOpen: () => !dead && !!card,
    destroy,
    /** Test / dev handles (not part of the §12.4 contract). */
    debug: {
      strings: S,
      card: () => (card ? { kind: card.kind, id: card.id, mode: cardEl.dataset.mode } : null),
      bubbles: () => [...bubbles.values()].filter((r) => r.shown).map((r) => ({ key: r.b.key, kind: r.kind, edge: !!r.edge, el: r.el })),
      noPronoun: (s) => !NO_PRONOUN.test(String(s)),
      gift: (g) => openGift(g),
      get dead() { return dead; },
    },
  };
}
