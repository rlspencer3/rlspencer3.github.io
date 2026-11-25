// Hearthwood — Living Town, WP3 acceptance (docs/LIVING.md §13.4 H1–H15). A tools/shot.mjs --script body: it runs in
// the real page, swaps a fake TownAPI in for app.town (the hud reads app.town afresh on every call), drives the hud
// that ui.js mounted, and emits bus events by hand. Run it on the three profiles:
//   node tools/shot.mjs --mobile --query "bp=cottage&nosave=1&town=0" --script tools/town-hud.js
//   node tools/shot.mjs --mobile --landscape --query "bp=cottage&nosave=1&town=0" --script tools/town-hud.js
//   node tools/shot.mjs --query "bp=cottage&nosave=1&town=0" --script tools/town-hud.js
// (any --w / --h too: H4 checks the layout of whatever viewport it runs in). Returns { fails: [], passes: [], … }.
// H10's real import failure (Playwright routing js/town/index.js to a 500) and H11's real touch need a Node runner;
// this script covers the in-page halves (app.town = null at runtime; synthetic mouse pointer events).
const app = window.__hw;
const { state, events, THREE } = app;
const fails = [], passes = [], notes = {};
const fail = (id, msg) => fails.push(`${id}: ${msg}`);
const pass = (id, msg = '') => passes.push(msg ? `${id}: ${msg}` : id);
const check = (id, ok, msg) => (ok ? pass(id, msg) : fail(id, msg));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const frames = (n = 2) => new Promise((r) => { const f = () => (--n <= 0 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
/** Wait until fn() is truthy (the hud refreshes at 4 Hz of frame time, slow on a loaded machine), at most ms. */
/** Wait for an element's (and its children's) finite CSS animations and transitions to finish (slow renders). */
const settle = async (el, ms = 3000) => {
  const t0 = performance.now();
  while (el && performance.now() - t0 < ms) {
    const a = el.getAnimations({ subtree: true }).filter((x) => x.playState === 'running' && x.effect?.getTiming?.().iterations !== Infinity);
    if (!a.length) return;
    await sleep(50);
  }
};
const until = async (fn, ms = 2500) => { const t0 = performance.now(); while (performance.now() - t0 < ms) { try { if (fn()) return true; } catch { /* not yet */ } await sleep(50); } return false; };
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const W = innerWidth, H = innerHeight;
notes.viewport = `${W}x${H}`;

// wait for the hud ui.js mounts after first paint
for (let i = 0; i < 60 && !app.ui?.hud; i++) await sleep(100);
const hud = app.ui?.hud;
if (!hud) return { fails: ['setup: ui.js mounted no hud (is app.town there?)'], passes };
await sleep(600);          // the camera settles on the stamped cottage

// ------------------------------------------------------------------ the fake TownAPI (§13.2)
const calls = { showMe: [], follow: [], muteHint: [], answerIntro: [], endShowMe: 0, focusHome: [], tipOnce: [] };
const tips = new Set();
const V = {
  v1: { id: 'v1', name: 'Mabel', job: 'gardener', jobLabel: 'Gardener', jobIcon: '🌷', color: '#9cae6b', trait: 'early', traitLabel: 'Early riser', traitIcon: '🌅',
    status: 'resident', statusText: null, homeId: 'b:1', homeName: 'the thatched cottage', voice: 0.96,
    wish: { tpl: 'w_door_bench', text: 'A bench by my door, for morning tea.', label: 'a bench by the door', icon: '🪑', piece: 'bench', pieceName: 'Garden Bench', size: 'S', dream: false },
    fadedWish: false, line: 'Up before the sun again. The lavender smells like summer.', grants: 3 },
  v2: { id: 'v2', name: 'Bram', job: 'woodcutter', jobLabel: 'Woodcutter', jobIcon: '🪓', color: '#b4473a', trait: 'owl', traitLabel: 'Night owl', traitIcon: '🦉',
    status: 'resident', statusText: null, homeId: 'b:2', homeName: 'the log cabin', voice: 0.88, wish: null, fadedWish: true, line: 'Measure twice, chop once.', grants: 1 },
  v3: { id: 'v3', name: 'Posy', job: 'beekeeper', jobLabel: 'Beekeeper', jobIcon: '🐝', color: '#e9b949', trait: 'bookish', traitLabel: 'Bookish', traitIcon: '📚',
    status: 'resident', statusText: null, homeId: 'b:1', homeName: 'the thatched cottage', voice: 1.18,
    wish: { tpl: 'w_apple_tree', text: 'An apple tree. Imagine the pies!', label: 'an apple tree', icon: '🍎', piece: 'tree_apple', pieceName: 'Apple Tree', size: 'S', dream: true },
    fadedWish: false, line: 'Just one more chapter.', grants: 0 },
  v4: { id: 'v4', name: 'Hazel', job: 'baker', jobLabel: 'Baker', jobIcon: '🍞', color: '#c96a5a', trait: 'chatty', traitLabel: 'Chatty', traitIcon: '💬',
    status: 'camping', statusText: '⛺ Camping by the lane until there\'s a bed free', homeId: null, homeName: null, voice: 1.05, wish: null, fadedWish: false,
    line: 'The lane is lovely at night. A bed would be lovelier.', grants: 2 },
  v5: { id: 'v5', name: 'Wendell', job: 'fisher', jobLabel: 'Fisher', jobIcon: '🎣', color: '#2f4a66', trait: 'shy', traitLabel: 'Shy', traitIcon: '🌿',
    status: 'traveller', statusText: '🎒 On the way to the slate-roofed house', homeId: 'b:5', homeName: 'the slate-roofed house', voice: 0.9, wish: null, fadedWish: false, line: '', grants: 0 },
  v6: { id: 'v6', name: 'Otis', job: 'farmer', jobLabel: 'Farmer', jobIcon: '🥕', color: '#5d7fa3', trait: 'homebody', traitLabel: 'Homebody', traitIcon: '🏡',
    status: 'waiting', statusText: null, homeId: 'b:3', homeName: 'the shingled hut', voice: 0.92, wish: null, fadedWish: false, line: 'A little fixing up and it\'ll be good as new.', grants: 0 },
};
const HOMES = [
  { id: 'b:1', name: 'the thatched cottage', door: [0, 0, 4], beds: 2, capacity: 2, residents: ['v1', 'v3'], free: 0, status: 'full', missing: [] },
  { id: 'b:2', name: 'the log cabin', door: [-8, 0, 4], beds: 2, capacity: 2, residents: ['v2'], free: 1, status: 'vacancy', missing: [] },
  { id: 'b:3', name: 'the shingled hut', door: [8, 0, -6], beds: 1, capacity: 1, residents: ['v6'], free: 0, status: 'fix', missing: [{ kind: 'roof', text: 'A hole in the roof (1 cell)', icon: '🏠', n: 1 }, { kind: 'gaps', text: 'A gap in the walls (1)', icon: '🧱', n: 1 }] },
];
const ALMOST = [{ id: 'b:4', name: 'the little hut', door: [6, 0, 6], beds: 0, capacity: 0, residents: [], free: 0, status: 'almost', missing: [{ kind: 'bed', text: 'Almost a home: add a bed', icon: '🛏️', n: 1 }] }];
const COULD = [
  { homeId: 'b:1', homeName: 'the thatched cottage', text: 'The thatched cottage: one more bed and Posy the Beekeeper would come', icon: '🛏️', target: { home: 'b:1', job: 'beekeeper' } },
  { homeId: 'b:2', homeName: 'the log cabin', text: 'Fisher: a Lily Pond within 6 cells', icon: '🎣', target: { home: 'b:2', job: 'fisher' } },
  { homeId: 'b:2', homeName: 'the log cabin', text: 'Lamplighter: 2 lamp posts within 6 cells', icon: '🏮', target: { home: 'b:2', job: 'lamplighter' } },
];
const fake = {
  ready: true,
  on: true,
  enabled() { return this.on; },
  clock: () => 2100, day: () => 3,
  cz: { value: 62, tier: 'cheerful', warmth: 38, charm: 24, floor: 23, frac: 0.62 },
  cozy() { return this.cz; },
  view() {
    return {
      day: 3, cozy: this.cz, villagers: ['v1', 'v2', 'v3', 'v4', 'v6'].map((k) => V[k]), homes: HOMES, couldMoveIn: COULD, almost: ALMOST,
      campers: 1, openWishes: this.wishes, granted: 7, full: false, timeFlow: !!state.timeFlow, enabled: this.on, note: '⛺ 1 neighbour is camping by the lane', intro: false,
    };
  },
  wishes: 2,
  villager(id) { return V[id] || null; },
  list: [],
  bubbles() { return this.list; },
  gift: {},
  giftInfo(id) { return this.gift[id] || null; },
  tipOnce(id) { calls.tipOnce.push(id); if (tips.has(id)) return false; tips.add(id); return true; },
  audible() { return { talkers: [], foley: [] }; },
  hitTest() { return null; },
  showMe(t) { calls.showMe.push(t); return true; },
  sh: null,
  showing() { return this.sh; },
  endShowMe() { calls.endShowMe++; this.sh = null; },
  muteHint(id) { calls.muteHint.push(id); },
  answerIntro(l) { calls.answerIntro.push(l); },
  follow(id) { calls.follow.push(id); },
  focusHome(id) { calls.focusHome.push(id); return true; },
  update() {},
  debug: {},
};
const realTown = app.town;
app.town = fake;

const toasts = [];
const offToast = events.on('toast', (d) => toasts.push(d));
const pronounRe = /\b(she|he|her|his|hers|him|they|them|their|theirs)\b/i;   // "they'll" (the camp tip, villagers plural) is not a villager pronoun
const townTexts = [];          // every town string the hud showed (pronoun check)
const noteText = (s) => { if (s) townTexts.push(String(s)); };

// ------------------------------------------------------------------ placing fake bubbles on screen
const cam = app.camera, cv = app.renderer.domElement;
const insets = () => app.rig.insets || { top: 0, bottom: 0, left: 0, right: 0 };
function worldAt(sx, sy, dist = 16) {
  cam.updateMatrixWorld();
  const v = new THREE.Vector3((sx / cv.clientWidth) * 2 - 1, -(sy / cv.clientHeight) * 2 + 1, 0.5).unproject(cam);
  const dir = v.sub(cam.position).normalize();
  return cam.position.clone().addScaledVector(dir, dist).toArray();
}
function projectAt(at) {
  cam.updateMatrixWorld();
  const v = new THREE.Vector3(...at).project(cam);
  return { x: (v.x + 1) / 2 * cv.clientWidth, y: (1 - v.y) / 2 * cv.clientHeight };
}
const I0 = insets();
const fl = I0.left, ft = I0.top, fr = W - I0.right, fb = H - I0.bottom;
notes.freeArea = { l: fl, t: ft, r: fr, b: fb };
// 8 anchors on a 4 × 2 grid inside the free area (≥ 36 px apart, so none merge)
const gx = (i) => fl + 30 + ((fr - fl - 60) * i) / 3, gy = (j) => ft + Math.min(110, (fb - ft) * 0.45) + j * Math.min(110, (fb - ft) * 0.4);
const pts = [];
for (let j = 0; j < 2; j++) for (let i = 0; i < 4; i++) pts.push([gx(i), gy(j)]);
const KINDS = ['traveller', 'gift', 'wish', 'camp', 'fix', 'almost', 'vacancy', 'dream'];
const BUBBLES = KINDS.map((kind, i) => {
  const b = { key: `k${i}-${kind}`, kind, at: worldAt(...pts[i], 14 + i), tappable: true, priority: i, arrow: kind === 'traveller', dim: false };
  if (kind === 'traveller') Object.assign(b, { villager: 'v5', icon: '🎒', label: 'Wendell is on the way' });
  if (kind === 'gift') Object.assign(b, { villager: 'v1', icon: '🎁', label: 'A thank-you gift' });
  if (kind === 'wish') Object.assign(b, { villager: 'v1', icon: '🪑', label: 'a bench by the door' });
  if (kind === 'camp') Object.assign(b, { icon: '⛺', text: '1', label: 'A bed for the campers (1)' });
  if (kind === 'fix') Object.assign(b, { home: 'b:3', icon: '🔨', label: 'Otis\'s shingled hut needs fixing' });
  if (kind === 'almost') Object.assign(b, { home: 'b:4', icon: '🛏️', label: 'add a bed' });
  if (kind === 'vacancy') Object.assign(b, { home: 'b:2', icon: '🏡✨', label: 'A free bed: who could live here?' });
  if (kind === 'dream') Object.assign(b, { villager: 'v3', icon: '🍎', label: 'an apple tree' });
  return b;
});
const shownBubbles = () => $$('.hw-tbubbles:not(.is-off) .hw-bubble:not(.is-hid):not(.hw-bubble-ghost)');
const bubbleEl = (key) => $(`.hw-bubble[data-key="${key}"]`);
const isShown = (key) => { const el = bubbleEl(key); return !!el && !el.classList.contains('is-hid') && !$('.hw-tbubbles').classList.contains('is-off'); };
const tip = (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.bottom }; };
const cardOpen = () => $('.hw-tcard.is-open');
const cardKind = () => hud.debug?.card()?.kind || null;
const closeAll = async () => { hud.close(); await frames(2); };

try {
  // ==================================================================== H1 bubbles
  fake.list = BUBBLES.slice();
  await until(() => shownBubbles().length >= 5);
  await sleep(100);
  {
    const shown = shownBubbles().filter((el) => el.matches('button'));
    check('H1a', shown.length <= 6 && shown.length >= 5, `${shown.length} tappable bubbles shown of 8 (≤ 6)`);
    const want = ['traveller', 'gift', 'wish', 'camp', 'fix', 'almost'];
    const kinds = shown.map((el) => el.dataset.kind).sort();
    check('H1b', JSON.stringify(kinds) === JSON.stringify(want.slice().sort()), `priority keeps ${kinds.join(',')} (vacancy and dream wait)`);
    // the tail tip sits on the projected anchor, except (R2 T2.2) a bubble whose box there meets the toast stack (the
    // one-time tips these first bubbles raise): it sits just below the stack. Tips arrive a frame after the bubbles
    // they are about and the dodge a frame after that, so give it a few frames to settle
    const cvR = () => cv.getBoundingClientRect();
    const expected = (el, b) => {
      const p = projectAt(b.at), r = el.getBoundingClientRect(), c = cvR();
      const tb = $('.hw-toasts');
      const q = tb && tb.childElementCount ? tb.getBoundingClientRect() : null;
      const band = q && q.height > 0 ? { l: q.left - c.left, t: q.top - c.top, r: q.right - c.left, b: q.bottom - c.top } : null;
      const w = r.width, h = r.height;
      if (band && p.y - h < band.b && p.y > band.t && p.x + w / 2 > band.l && p.x - w / 2 < band.r) return { x: p.x + c.left, y: Math.min(fb, band.b + h + 4) + c.top, dodged: true };
      return { x: p.x + c.left, y: p.y + c.top, dodged: false };
    };
    let worst = Infinity, dodged = 0;
    for (let k = 0; k < 12 && worst > 2; k++) {
      if (k) await frames(2);
      worst = 0; dodged = 0;
      for (const el of shown) {
        const b = fake.list.find((x) => x.key === el.dataset.key);
        const e = expected(el, b), t = tip(el);
        if (e.dodged) dodged++;
        worst = Math.max(worst, Math.hypot(e.x - t.x, e.y - t.y));
      }
    }
    check('H1c', worst <= 2, `every tail tip within ${worst.toFixed(2)} px of its projected anchor, or just below the toast stack when its box there meets a toast (${dodged} of ${shown.length}) (≤ 2)`);
    for (const el of shown) noteText(el.getAttribute('aria-label'));
  }
  // behind the camera
  {
    cam.updateMatrixWorld();
    const fwd = new THREE.Vector3(); cam.getWorldDirection(fwd);
    const behind = cam.position.clone().addScaledVector(fwd, -6).toArray();
    fake.list = [{ key: 'kb-wish', kind: 'wish', villager: 'v1', icon: '🪑', label: 'a bench by the door', at: behind, tappable: true }];
    await sleep(200);
    check('H1d', !isShown('kb-wish'), 'an anchor behind the camera is hidden');
  }
  // photo mode, enabled() false, dim
  fake.list = BUBBLES.slice(0, 4);
  await sleep(200);
  state.set({ photoMode: true });
  await sleep(250);
  check('H1e', shownBubbles().length === 0 || getComputedStyle($('.hw-tbubbles')).visibility === 'hidden', 'photo mode hides every bubble');
  state.set({ photoMode: false });
  await sleep(600);
  fake.on = false;
  await until(() => shownBubbles().length === 0 && $('.hw-hearth').hidden);
  check('H1f', shownBubbles().length === 0, 'enabled() = false → no bubbles');
  check('H1f2', $('.hw-hearth').hidden, 'enabled() = false → no hearth');
  fake.on = true;
  fake.list = BUBBLES.slice(0, 4).map((b) => ({ ...b, dim: b.kind === 'wish' }));
  // (the dim fades in over 0.25 s; on a loaded software-GL box frames can be slow, so wait for it rather than a fixed time)
  await until(() => { const e = bubbleEl(fake.list[2].key); return e && Math.abs(parseFloat(getComputedStyle(e).opacity) - 0.4) < 0.01; }, 3000);
  {
    const el = bubbleEl(fake.list[2].key);
    const op = el ? getComputedStyle(el).opacity : 'none';
    check('H1g', el && Math.abs(parseFloat(op) - 0.4) < 0.01, `dim: true → opacity ${op}`);
  }
  // merging: two anchors of one kind 12 px apart → one bubble "×2"; of two kinds (a wish and a dream under one roof,
  // R8): side by side, so both cards can be opened
  {
    const [x, y] = pts[1];
    fake.list = [
      { key: 'm1', kind: 'wish', villager: 'v1', icon: '🪑', label: 'a bench by the door', at: worldAt(x, y, 15), tappable: true },
      { key: 'm2', kind: 'wish', villager: 'v3', icon: '🍎', label: 'an apple tree', at: worldAt(x + 12, y, 15.5), tappable: true },
    ];
    await sleep(250);
    const a = bubbleEl('m1');
    check('H1h', isShown('m1') && !isShown('m2') && a?.querySelector('.hw-bubble-badge')?.textContent === '×2', `two wishes 12 px apart merge into one "×2" (${a?.querySelector('.hw-bubble-badge')?.textContent})`);
    fake.list = [
      { key: 'm3', kind: 'wish', villager: 'v1', icon: '🪑', label: 'a bench by the door', at: worldAt(x, y, 15), tappable: true },
      { key: 'm4', kind: 'dream', villager: 'v3', icon: '🍎', label: 'an apple tree', at: worldAt(x + 12, y, 15.5), tappable: true },
    ];
    await sleep(250);
    const r3 = bubbleEl('m3')?.getBoundingClientRect(), r4 = bubbleEl('m4')?.getBoundingClientRect();
    check('H1h', isShown('m3') && isShown('m4') && !!r3 && !!r4 && Math.abs(r3.left - r4.left) >= 36, `a wish and a dream 12 px apart sit side by side (${r3 && r4 ? Math.round(Math.abs(r3.left - r4.left)) : '?'} px)`);
  }
  // off-screen traveller → edge arrow inside the free area; passer-by: arrow only while off-screen
  {
    const off = worldAt(fr + 300, (ft + fb) / 2, 15);
    fake.list = [
      { key: 'tr', kind: 'traveller', villager: 'v5', icon: '🎒', label: 'Wendell', at: off, tappable: true, arrow: true },
      { key: 'pb', kind: 'passerby', villager: 'p1', at: worldAt(fl - 300, (ft + fb) / 2, 15), tappable: false, arrow: true },
    ];
    await sleep(300);
    const tr = bubbleEl('tr'), pb = bubbleEl('pb');
    const r = tr?.getBoundingClientRect();
    check('H1i', tr && tr.classList.contains('is-edge') && r.right <= fr + 1 && r.left >= fl - 1 && r.top >= ft - 1 && r.bottom <= fb + 1,
      `an off-screen traveller rides the free area's edge with an arrow (${r && [r.left, r.top, r.right, r.bottom].map(Math.round)})`);
    check('H1j', pb && isShown('pb') && pb.classList.contains('is-edge'), 'an off-screen passer-by shows only its edge arrow');
    const passerTip = toasts.find((d) => /A traveller passes by/.test(d.text));
    check('H1k', !!passerTip?.action, 'the passer-by tip toast has a Watch button');
    if (passerTip?.action) { passerTip.action.fn(); check('H1l', calls.follow.includes('p1'), 'Watch follows the passer-by'); }
    fake.list = [{ key: 'pb', kind: 'passerby', villager: 'p1', at: worldAt(pts[0][0], pts[0][1], 15), tappable: false, arrow: true }];
    await sleep(250);
    check('H1m', !isShown('pb'), 'a passer-by on screen has no bubble');
  }

  // ==================================================================== H2 villager card
  fake.list = BUBBLES.slice(2, 3);              // the wish
  await sleep(250);
  {
    const el = bubbleEl(fake.list[0].key);
    calls.showMe.length = 0;
    el.click();
    await frames(2);
    const c = cardOpen();
    const tx = c?.textContent || '';
    noteText(tx);
    check('H2a', cardKind() === 'villager' && /Mabel/.test(tx) && /Gardener/.test(tx) && /Early riser/.test(tx) && /A bench by my door/.test(tx) && /Up before the sun/.test(tx),
      'a click on the wish bubble opens the card: name, job, trait, wish text and line');
    check('H2b', !pronounRe.test(tx), 'no pronoun on the card');
    $('.hw-tcard [data-act="showme"]').click();
    await frames(2);
    check('H2c', calls.showMe.length === 1 && calls.showMe[0].villager === 'v1' && !cardOpen(), `Show me → showMe({ villager: 'v1' }) once (${JSON.stringify(calls.showMe)}) and the card closes`);
    hud.openVillager('v1');
    await frames(2);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await frames(2);
    check('H2d', !cardOpen(), 'Esc closes the card');
    events.emit('town-select', { id: 'v2' });
    await frames(2);
    const tx2 = cardOpen()?.textContent || '';
    noteText(tx2);
    check('H2e', cardKind() === 'villager' && /Bram/.test(tx2) && /Never mind, maybe another time!/.test(tx2), 'town-select opens the card (Bram, with the faded wish line)');
    // card variants: camping, waiting (with Show me), traveller, dream
    for (const id of ['v4', 'v6', 'v5', 'v3']) {
      hud.openVillager(id);
      await frames(2);
      const t3 = cardOpen()?.textContent || '';
      noteText(t3);
      if (id === 'v4') check('H2f', /Camping by the lane/.test(t3), 'camper status line');
      if (id === 'v6') check('H2g', /Otis's shingled hut needs fixing: a hole in the roof/.test(t3) && !!$('.hw-tcard [data-act="showme"]'), `waiting status line with Show me ("${t3.match(/🔨[^❝]*/)?.[0]}")`);
      if (id === 'v5') check('H2h', /On the way to the slate-roofed house/.test(t3), 'traveller status line');
      if (id === 'v3') check('H2i', /Posy dreams: an apple tree/.test(t3), 'a dream on the card');
    }
    await closeAll();
  }

  // ==================================================================== H3 hearth and town card
  {
    const hearth = $('.hw-hearth');
    const cozyVar = () => parseFloat(hearth.style.getPropertyValue('--cozy'));
    fake.cz = { value: 20, tier: 'quiet', warmth: 12, charm: 5, floor: 17, frac: 0.2 };
    await until(() => Math.abs(cozyVar() - 0.2) < 0.002);
    const c1 = cozyVar();
    fake.cz = { value: 90, tier: 'glowing', warmth: 55, charm: 35, floor: 25, frac: 0.9 };
    await until(() => Math.abs(cozyVar() - 0.9) < 0.002);
    const c2 = cozyVar();
    check('H3a', Math.abs(c1 - 0.2) < 0.002 && Math.abs(c2 - 0.9) < 0.002 && hearth.classList.contains('is-glow'), `--cozy follows cozy().frac (${c1} → ${c2}), embers shimmer at 0.9`);
    fake.wishes = 2;
    await until(() => hearth.classList.contains('has-wish'));
    const dot = $('.hw-hearth-dot');
    check('H3b', hearth.classList.contains('has-wish') && getComputedStyle(dot).display !== 'none' && !/\d/.test(hearth.textContent.replace(/\+\d+/g, '')),
      'an open wish lights the ember dot; no number on the chip');
    fake.wishes = 0;
    await until(() => !hearth.classList.contains('has-wish'));
    check('H3c', !hearth.classList.contains('has-wish'), 'no open wish → no ember dot');
    fake.wishes = 2;
    events.emit('town-granted', { villager: 'v1', wish: V.v1.wish, reward: { cozy: 5, gift: null }, gain: 5, cozy: { before: 60, after: 65 }, camp: false, line: 'It\'s perfect. Thank you!' });
    await frames(2);
    check('H3d', hearth.classList.contains('is-flare') && !!$('.hw-hearth-gain'), 'town-granted makes the hearth flare (+5 floats up)');
    const gToast = toasts.find((d) => /^💛 Mabel: “It's perfect\. Thank you!” · Cozy \+5$/.test(d.text));
    check('H3e', !!gToast && gToast.kind === 'success', `granted toast (${toasts[toasts.length - 1]?.text})`);
    fake.cz = { value: 62, tier: 'cheerful', warmth: 38, charm: 24, floor: 23, frac: 0.62 };
    await until(() => Math.abs(cozyVar() - 0.62) < 0.002);
    hearth.click();
    await frames(2);
    const tx = cardOpen()?.textContent || '';
    noteText(tx);
    check('H3f', cardKind() === 'town' && /Cozy 62 · Cheerful/.test(tx) && $$('.hw-tcard .hw-tc-chip').length === 4 && /Could move in/.test(tx) && /Almost homes/.test(tx)
      && /one more bed and Posy the Beekeeper would come/.test(tx) && /little hut: add a bed/i.test(tx) && /Warmth 38/.test(tx) && /Charm 24/.test(tx) && /Day 4 of the town · 7 wishes granted/.test(tx),
      'tap → town card with Cozy, resident chips, could-move-in and almost rows');
    check('H3g', /1 neighbour is camping by the lane/.test(tx) && /⛺ 1 camping/.test(tx), 'the boot note and the camper count');
    const prevFlow = state.timeFlow;
    state.set({ timeFlow: false });
    await sleep(300);
    const turnOn = $('.hw-tcard [data-act="flow"]');
    turnOn?.click();
    await frames(2);
    check('H3h', !!turnOn && state.timeFlow === true, '"Turn on" sets state.timeFlow = true');
    state.set({ timeFlow: prevFlow });
    // a resident chip opens that villager's card; a could-move-in row's Show me sends its target
    $('.hw-tcard .hw-tc-chip[data-id="v2"]').click();
    await frames(2);
    check('H3i', cardKind() === 'villager' && /Bram/.test(cardOpen()?.textContent || ''), 'a resident chip opens the villager card');
    hud.openTown();
    await frames(2);
    calls.showMe.length = 0;
    $$('.hw-tcard .hw-tc-item [data-act="showme"]')[0].click();
    await frames(2);
    check('H3j', calls.showMe.length === 1 && calls.showMe[0].home === 'b:1' && calls.showMe[0].job === 'beekeeper' && !cardOpen(), 'a could-move-in row\'s Show me sends its target');
    // villagers off: only the resting line
    fake.on = false;
    hud.openTown();
    await until(() => /Villagers are resting/.test(cardOpen()?.textContent || ''));
    const tx3 = cardOpen()?.textContent || '';
    check('H3k', /Villagers are resting\. Turn them on in Settings\./.test(tx3) && !/Residents/.test(tx3), 'villagers off → the card only says they are resting');
    fake.on = true;
    await closeAll();
  }

  // ==================================================================== H4 layout (this viewport)
  {
    const portrait = H > W;
    const landPhone = W > H && H <= 540;
    fake.list = BUBBLES.slice(2, 3);
    await sleep(250);
    hud.openVillager('v1');
    await sleep(450);
    await settle(cardOpen());
    const card = cardOpen().getBoundingClientRect();
    const tray = $('.hw-tray').getBoundingClientRect();
    const railRects = $$('.hw-rail-group').map((e) => e.getBoundingClientRect());
    const mode = hud.debug.card().mode;
    notes.cardMode = mode;
    if (landPhone) {
      const railL = Math.min(...railRects.map((r) => r.left));
      check('H4a', mode === 'side' && card.left < W / 2 && card.right <= railL && card.bottom <= tray.top + 1, `landscape: a ${Math.round(card.width)} px side card on the left (right ${Math.round(card.right)} ≤ rail ${Math.round(railL)}), above the tray`);
    } else if (mode === 'bottom') {
      check('H4a', card.bottom <= tray.top + 1 && card.width <= 421 && card.top >= 0, `portrait: card bottom ${Math.round(card.bottom)} ≤ tray top ${Math.round(tray.top)} + 1, ${Math.round(card.width)} px wide`);
    } else {
      const I = insets();
      check('H4a', card.left >= I.left - 1 && card.right <= W - I.right + 1 && card.top >= I.top - 1 && card.bottom <= H - I.bottom + 1, `desktop: a floating card inside the free area (${[card.left, card.top, card.right, card.bottom].map(Math.round)})`);
    }
    // every button in the card ≥ 44 px (or a hit area that big)
    const small = [];
    const hitOk = (el) => {
      const r = el.getBoundingClientRect();
      if (r.width >= 43.5 && r.height >= 43.5) return true;
      const cx = r.left + r.width / 2, cy = el.classList.contains('hw-bubble') ? r.top + 19 : r.top + r.height / 2;   // a bubble's hit circle is round its disc
      return [[21.5, 0], [-21.5, 0], [0, 21.5], [0, -21.5]].every(([dx, dy]) => {
        const x = Math.min(W - 1, Math.max(0, cx + dx)), y = Math.min(H - 1, Math.max(0, cy + dy));
        const hit = document.elementFromPoint(x, y);
        const ok = hit && (hit === el || el.contains(hit));
        if (!ok) notes.hitMiss = (notes.hitMiss || []).concat(`${el.className.split(' ')[0]}@${Math.round(dx)},${Math.round(dy)}→${hit?.className || hit?.tagName}`);
        return ok;
      });
    };
    for (const b of $$('.hw-tcard button')) if (!hitOk(b)) small.push(b.textContent.trim() || b.getAttribute('aria-label'));
    await closeAll();
    hud.openTown();
    await sleep(350);
    await settle(cardOpen());
    for (const b of $$('.hw-tcard button')) if (!hitOk(b)) small.push(b.textContent.trim() || b.getAttribute('aria-label'));
    const town = cardOpen().getBoundingClientRect();
    check('H4b', landPhone ? town.right <= Math.min(...railRects.map((r) => r.left)) : (mode !== 'bottom' || town.bottom <= tray.top + 1), `the town card fits too (${[town.left, town.top, town.right, town.bottom].map(Math.round)})`);
    await closeAll();
    // bubbles (48 px hit area) and the hearth (44 px) first, then the checklist ✕ and a toast action (they sit
    // in the top stack, which could cover a bubble)
    fake.list = [{ ...BUBBLES[2], at: worldAt((fl + fr) / 2, (ft + fb) / 2 + 30, 15) }];
    await sleep(700);
    const hearthEl = $('.hw-hearth');
    const sized = [bubbleEl(fake.list[0].key)];
    if (!hearthEl.hidden && getComputedStyle(hearthEl).display !== 'none') sized.push(hearthEl);
    fake.sh = { label: 'Supper table', parts: [{ piece: 'table', icon: '🍽️', name: 'Table', n: 1, have: 1 }, { piece: 'chair', icon: '🪑', name: 'Chairs', n: 2, have: 1 }], done: false };
    for (const el of sized) if (el && !hitOk(el)) small.push(el.className);
    events.emit('toast', { text: 'Size check', kind: 'info', ms: 4000, action: { label: 'OK', fn: () => {} } });
    await sleep(450);
    await settle($('.hw-topstack'));
    for (const el of [$('.hw-tcheck-x'), $('.hw-toast.has-act .hw-toast-act')]) if (el && !hitOk(el)) small.push(el.className);
    check('H4c', small.length === 0, small.length ? `under 44 px: ${small.join(' | ')}` : 'every town button is ≥ 44 px (or has a hit area that big)');
    fake.sh = null;
    await sleep(300);
    // the top bar: menu, counter, hearth, floor control, undo / redo — no overlap, nothing wrapped
    const topEls = [$('.hw-menu-btn'), $('.hw-count'), hearthEl, $('.hw-level'), ...$$('.hw-top-r .hw-rbtn')]
      .filter((e) => e && getComputedStyle(e).display !== 'none' && !e.hidden);
    const rs = topEls.map((e) => ({ c: e.className.split(' ')[0], r: e.getBoundingClientRect() }));
    const overl = [];
    for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
      const a = rs[i].r, b = rs[j].r;
      if (a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5) overl.push(`${rs[i].c}/${rs[j].c}`);
    }
    const wrapped = rs.filter((x) => x.r.height > 50 || x.r.right > W + 0.5 || x.r.left < -0.5).map((x) => x.c);
    const lvName = $('.hw-lv-name').getBoundingClientRect();
    if (lvName.height > 24) wrapped.push('hw-lv-name');
    notes.topBar = rs.map((x) => `${x.c}:${Math.round(x.r.left)}-${Math.round(x.r.right)}`).join(' ');
    if (W >= 320) check('H4d', !overl.length && !wrapped.length, overl.length || wrapped.length ? `overlap ${overl.join(',')} wrapped ${wrapped.join(',')} (${notes.topBar})` : `top bar clear at ${W} px (${notes.topBar})`);
    const hearthVisible = !hearthEl.hidden && getComputedStyle(hearthEl).display !== 'none';
    check('H4e', W <= 300 ? !hearthVisible : hearthVisible, `the hearth ${hearthVisible ? 'shows' : 'hides'} at ${W} px (hides only at ≤ 300)`);
    // the piece counter stays beside the hearth (§10.3, D19): only ui.css's own ≤ 370 px rule hides it (T1.8)
    const cnt = $('.hw-count'), countVisible = !!cnt && getComputedStyle(cnt).display !== 'none' && cnt.getBoundingClientRect().width > 0;
    check('H4h', W <= 370 ? !countVisible : countVisible, `the piece counter ${countVisible ? 'shows' : 'hides'} beside the hearth at ${W} px (hides only at ≤ 370)`);
    // the Town row in Menu
    app.ui.open('main');
    await sleep(400);
    const row = $('.hw-sheet [data-page="town"]');
    check('H4f', !!row && /Cozy 62 · Cheerful/.test(row.textContent), `Menu has the 🔥 Town row (${row?.textContent})`);
    row?.click();
    await sleep(350);
    check('H4g', cardKind() === 'town' && !$('.hw-sheet-wrap.is-open'), 'the Town row opens the town card');
    await closeAll();
  }

  // ==================================================================== H5 settings
  {
    const prev = { village: state.village, chatter: state.chatter };
    app.ui.open('settings');
    await sleep(400);
    const sec = $('.hw-sheet .hw-village');
    const sw = sec ? $$('.hw-switch', sec) : [];
    const keys = sw.map((s) => s.dataset.key);
    check('H5a', sw.length === 2 && keys.includes('village') && keys.includes('chatter') && /Off: a quiet build-only meadow\. Nothing is lost\./.test(sec.textContent), `the Village section has two switches (${keys})`);
    check('H5a2', /\(off for this page\)/.test(sec?.textContent || ''), 'with ?town=0 the rows say "(off for this page)"');
    $('.hw-switch[data-key="village"]', sec).click();
    $('.hw-switch[data-key="chatter"]', sec).click();
    await frames(2);
    const v1 = state.village, c1 = state.chatter;
    const sync = $('.hw-switch[data-key="village"]').getAttribute('aria-checked') === String(v1);
    state.save();
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem('hearthwood.settings.v1') || '{}'); } catch { saved = {}; }
    check('H5b', v1 === !prev.village && c1 === !prev.chatter && sync && saved.village === v1 && saved.chatter === c1,
      `toggles set state.village=${v1} / chatter=${c1}; saved ${JSON.stringify({ village: saved.village, chatter: saved.chatter })}`);
    state.set(prev);
    state.save();
    app.ui.close();
    await sleep(300);
  }

  // ==================================================================== H6 toast actions
  {
    let ran = 0;
    events.emit('toast', { text: '🧪 Action toast', kind: 'info', ms: 5000, action: { label: 'Do it', fn: () => { ran++; } } });
    events.emit('toast', { text: '🧪 Plain toast', kind: 'info', ms: 5000 });
    await sleep(400);
    const at = $$('.hw-toast').find((e) => /Action toast/.test(e.textContent));
    const plain = $$('.hw-toast').find((e) => /Plain toast/.test(e.textContent));
    const btn = at?.querySelector('.hw-toast-act');
    const r = btn?.getBoundingClientRect();
    const hit = r ? document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) : null;
    check('H6a', btn && (hit === btn || btn.contains(hit)), `elementFromPoint at the action button returns it (${hit?.className})`);
    btn?.click();
    await frames(2);
    check('H6b', ran === 1, 'a click runs the action');
    check('H6c', plain && getComputedStyle(plain).pointerEvents === 'none', `a toast without an action keeps pointer-events: none (${plain && getComputedStyle(plain).pointerEvents})`);
  }

  // ==================================================================== H7 keys
  {
    const key = (k) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
    key('t');
    await frames(2);
    check('H7a', cardKind() === 'town', 'T opens the town card');
    key('Escape');
    await frames(2);
    check('H7b', !cardOpen(), 'Esc closes it');
    calls.showMe.length = 0;
    key('j');
    await frames(2);
    key('j');
    await frames(2);
    check('H7c', calls.showMe.length === 2 && calls.showMe[0].villager === 'v1' && calls.showMe[1].villager === 'v3', `J calls showMe for the next open wish (${JSON.stringify(calls.showMe)})`);
    fake.sh = { label: 'x', parts: [{ piece: 'flowers', icon: '🌷', name: 'Flower Patch', n: 2, have: 0 }], done: false };
    await until(() => !$('.hw-tcheck').hidden);
    const before = calls.endShowMe;
    key('Escape');
    await frames(2);
    check('H7d', calls.endShowMe === before + 1, 'Esc with no card open ends the Show me');
    fake.sh = null;
  }

  // ==================================================================== H8 gifts in the tray
  {
    const giftDef = app.catalog.getDef('gift_gnome');
    let def = giftDef, faked = false;
    if (!def) { def = app.catalog.getDef('birdbath'); faked = true; def.gift = { job: null }; }
    const wasHidden = def.hidden;
    app.catalog.setHidden?.(def.id, false);
    fake.gift[def.id] = { from: 'Mabel', isNew: true };
    if (state.category === 'garden') state.set({ category: 'base' });
    await frames(2);
    events.emit('town-gift', { id: def.id, name: def.name, from: 'v1', fromName: 'Mabel' });
    await sleep(200);
    const tabDot = $(`.hw-tab[data-cat="garden"] .hw-tab-dot`) || $('.hw-catbtn .hw-tab-dot');
    check('H8a', !!tabDot, 'a Garden tab dot after the unlock');
    app.builder.selectPiece(def.id);              // like tapping the Garden tab and the card
    await sleep(250);
    const cardEl = $(`.hw-card[data-id="${def.id}"]`);
    check('H8b', cardEl?.classList.contains('hw-card-gift') && getComputedStyle(cardEl, '::before').content.includes('New'), 'the gift card in the Garden tray wears the 🎁 New ribbon');
    check('H8c', !$('.hw-tab-dot'), 'opening the Garden tab clears the dot');
    cardEl?.querySelector('.hw-card-info')?.click();
    await sleep(250);
    const pop = $('.hw-pop.is-open')?.textContent || '';
    check('H8d', /A thank-you from Mabel/.test(pop), `the ⓘ card says "A thank-you from Mabel"`);
    document.querySelector('.hw-catcher.is-open')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    // the gift card 1.5 s after the gift
    await until(() => $('.hw-tgift.is-open'), 4000);
    const gc = $('.hw-tgift.is-open');
    noteText(gc?.textContent);
    check('H8e', gc && /A thank-you from Mabel/.test(gc.textContent) && /Find it in 🌷 Garden/.test(gc.textContent), 'the gift card slides up with Place it / Later');
    state.set({ pieceId: 'foundation' });
    gc?.querySelector('[data-act="place"]')?.click();
    await frames(2);
    check('H8f', state.pieceId === def.id && !$('.hw-tgift.is-open'), 'Place it hands the gift over');
    fake.gift[def.id] = { from: 'Mabel', isNew: false };
    events.emit('placed', { def, p: { t: def.id } });
    await sleep(100);
    check('H8g', !$(`.hw-card[data-id="${def.id}"]`)?.classList.contains('hw-card-gift'), 'placing it takes the ribbon off');
    if (faked) delete def.gift;
    app.catalog.setHidden?.(def.id, wasHidden);
    app.builder.selectPiece('foundation');
  }

  // ==================================================================== H9 audio
  {
    const A = app.audio;
    const out = {};
    for (const n of ['wish', 'wish-granted', 'move-in', 'gift', 'villager', 'hop']) {
      const r = await A.render(n, { seconds: n === 'move-in' ? 3.2 : 2, pitch: 1 });
      out[n] = { peakDb: r.peakDb, clipped: r.clipped, voicesLeft: r.voicesLeft };
      check(`H9-${n}`, r.peakDb >= -30 && r.peakDb <= -1 && r.clipped === 0 && r.voicesLeft === 0, `${n}: peak ${r.peakDb} dBFS, clipped ${r.clipped}, voices left ${r.voicesLeft}`);
    }
    notes.sfx = out;
    const talkers = [0, 1, 2, 3].map((i) => ({ pitch: 0.9 + i * 0.1, pan: -0.6 + i * 0.4, gain: 1, chatty: i === 0 }));
    const env = (t) => ({ wind: 0, talkers: t });
    const prevChat = state.chatter;
    state.set({ chatter: true });
    const quiet = await A.render('ambience', { seconds: 6, env: env([]) });
    const loud = await A.render('ambience', { seconds: 6, env: env(talkers) });
    const qd = Number.isFinite(quiet.activeRmsDb) ? quiet.activeRmsDb : -200, ld = Number.isFinite(loud.activeRmsDb) ? loud.activeRmsDb : -200;
    check('H9-chatter', ld >= qd + 3, `ambience with 4 talkers: active RMS ${loud.activeRmsDb} dB vs ${quiet.activeRmsDb} dB without (peak ${loud.peakDb})`);
    // and over the default breeze (louder bed): still adds energy
    const qw = await A.render('ambience', { seconds: 6, env: { talkers: [] } });
    const lw = await A.render('ambience', { seconds: 6, env: { talkers } });
    notes.chatterOverWind = { without: qw.activeRmsDb, with: lw.activeRmsDb };
    state.set({ chatter: false });
    const off = await A.render('ambience', { seconds: 6, env: env(talkers) });
    check('H9-off', off.activeRmsDb === quiet.activeRmsDb && off.peak === quiet.peak, `chatter off: ${off.activeRmsDb} dB = ${quiet.activeRmsDb} dB`);
    state.set({ chatter: prevChat });
    const st = A.stats();
    check('H9-stats', st.amb === null || typeof st.amb.chatter === 'number', `stats().amb.chatter counter (${st.amb ? st.amb.chatter : 'no context yet'})`);
  }

  // ==================================================================== H10 no town (in-page half)
  {
    app.town = null;
    await until(() => $('.hw-hearth').hidden && shownBubbles().length === 0);
    check('H10a', $('.hw-hearth').hidden && shownBubbles().length === 0, 'app.town = null → no hearth, no bubbles');
    app.ui.open('settings');
    await sleep(350);
    check('H10b', !$('.hw-sheet .hw-village'), 'app.town = null → no Village section');
    app.ui.open('help');
    await sleep(300);
    check('H10c', !$('.hw-sheet [data-sec="villagers"]'), 'app.town = null → no Villagers help');
    app.ui.close();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 't', bubbles: true }));
    await frames(2);
    check('H10d', !cardOpen() && !hud.debug.dead, 'T with no town does nothing');
    app.town = fake;
    await sleep(300);
    app.ui.open('help');
    await sleep(300);
    const hs = $('.hw-sheet [data-sec="villagers"]')?.textContent || '';
    check('H10e', /Homes/.test(hs) && /Wishes/.test(hs) && /Cozy/.test(hs) && /Quiet meadow/.test(hs), 'How to play has the Villagers section');
    const keysTx = $('.hw-sheet .hw-keys')?.textContent || '';
    if ($('.hw-sheet .hw-keys')) check('H10f', /Town/.test(keysTx) && /Next wish/.test(keysTx), 'the keys table lists T and J');
    app.ui.close();
    await sleep(300);
  }

  // ==================================================================== H11 bubbles and gestures (synthetic mouse)
  {
    fake.list = BUBBLES.slice(2, 3);
    await sleep(300);
    const el = bubbleEl(fake.list[0].key);
    const r = el.getBoundingClientRect();
    const x0 = r.left + r.width / 2, y0 = r.top + 19;
    const th0 = app.rig.goal.theta;
    const pe = (type, target, x, y, o = {}) => target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: x, clientY: y, ...o }));
    pe('pointerdown', el, x0, y0);
    for (let i = 1; i <= 8; i++) { pe('pointermove', el, x0 + i * 5, y0); }
    for (let i = 1; i <= 4; i++) pe('pointermove', window, x0 + 40 + i * 2, y0);
    pe('pointerup', window, x0 + 48, y0);
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x0 + 48, clientY: y0 }));
    await frames(3);
    const th1 = app.rig.goal.theta;
    check('H11a', Math.abs(th1 - th0) > 0.05 && !cardOpen(), `a 40 px drag that starts on a bubble orbits (θ ${th0.toFixed(3)} → ${th1.toFixed(3)}) and opens no card`);
    app.rig.goal.theta = th0;
    await sleep(300);
    const r2 = bubbleEl(fake.list[0].key).getBoundingClientRect();
    const x1 = r2.left + r2.width / 2, y1 = r2.top + 19;
    pe('pointerdown', bubbleEl(fake.list[0].key), x1, y1);
    pe('pointerup', bubbleEl(fake.list[0].key), x1, y1);
    bubbleEl(fake.list[0].key).click();
    await frames(2);
    check('H11b', cardKind() === 'villager', 'a still tap opens the card');
    await closeAll();
    for (const m of ['aim', 'draw']) {
      const prevMode = app.rig.mode;
      app.rig.mode = m;
      await frames(3);
      const rr = bubbleEl(fake.list[0].key).getBoundingClientRect();
      const hit = document.elementFromPoint(rr.left + rr.width / 2, rr.top + 19);
      check(`H11c-${m}`, hit === cv, `while rig.mode is ${m}, elementFromPoint over the bubble gives the canvas (${hit?.tagName}.${hit?.className})`);
      app.rig.mode = prevMode;
      await frames(2);
    }
  }

  // ==================================================================== H12 checklist
  {
    calls.endShowMe = 0;
    fake.sh = { label: 'A table for supper with friends', parts: [{ piece: 'table', icon: '🍽️', name: 'Table', n: 1, have: 1 }, { piece: 'chair', icon: '🪑', name: 'Chairs', n: 2, have: 1 }], done: false };
    await until(() => !$('.hw-tcheck').hidden);
    const chip = $('.hw-tcheck');
    check('H12a', chip && !chip.hidden && chip.textContent.trim() === '🍽️ Table ✓ · Chairs 1/2', `the chip reads "${chip?.textContent.trim()}"`);
    for (let i = 0; i < 480; i++) hud.update(0.25);         // 120 s of hud time: no timer ends it
    await frames(2);
    check('H12b', !chip.hidden && chip.textContent.trim() === '🍽️ Table ✓ · Chairs 1/2', 'still there 120 s later');
    $('.hw-tcheck-x').click();
    await until(() => $('.hw-tcheck').hidden);
    check('H12c', calls.endShowMe === 1 && chip.hidden, `✕ calls endShowMe once (${calls.endShowMe}) and the chip goes`);
    // driven by events too: town-showme (hint toast, first time only) and town-showme-end
    const n0 = toasts.length;
    fake.sh = { label: 'Some flowers by my door would be lovely.', parts: [{ piece: 'flowers', icon: '🌷', name: 'Flower Patch', n: 2, have: 1 }], done: false };
    events.emit('town-showme', { villager: 'v1', piece: 'flowers', pieceName: 'Flower Patch', icon: '🌷', verb: 'plant', inside: false, parts: [{ piece: 'flowers', icon: '🌷', name: 'Flower Patch', n: 2, have: 0 }], update: false });
    events.emit('town-showme', { villager: 'v1', piece: 'flowers', pieceName: 'Flower Patch', icon: '🌷', verb: 'plant', inside: false, parts: [{ piece: 'flowers', icon: '🌷', name: 'Flower Patch', n: 2, have: 1 }], update: true });
    await frames(2);
    const hints = toasts.slice(n0).map((d) => d.text);
    check('H12d', hints.length === 1 && hints[0] === '🌷 Tap a glowing spot to plant a Flower Patch for Mabel' && chip.textContent.trim() === '🌷 Flower Patch 1/2',
      `one hint toast ("${hints[0]}"), the chip updates ("${chip.textContent.trim()}")`);
    fake.sh = null;
    events.emit('town-showme-end', { granted: true });
    await frames(2);
    check('H12e', chip.hidden, 'town-showme-end removes the chip');
  }

  // ==================================================================== H13 intro card
  {
    const M = await import('/js/town/hud.js');
    calls.answerIntro.length = 0;
    events.emit('town-intro', {});
    await frames(2);
    const tx = cardOpen()?.textContent || '';
    noteText(tx);
    check('H13a', cardKind() === 'intro' && /villagers may move into your homes/.test(tx) && /Lovely/.test(tx) && /Keep my meadow quiet/.test(tx), 'town-intro shows the intro card');
    $('.hw-tcard [data-act="quiet"]').click();
    await frames(2);
    check('H13b', JSON.stringify(calls.answerIntro) === '[false]' && !cardOpen(), 'Keep my meadow quiet → answerIntro(false)');
    events.emit('town-intro', {});
    await frames(2);
    check('H13c', !cardOpen(), 'shown once');
    // fresh mounts for the other two answers (the ui's hud has shown its intro)
    for (const how of ['lovely', 'outside']) {
      const r2 = document.createElement('div');
      r2.className = 'hw';
      $('#ui').append(r2);
      const h2 = M.createHud(app, { root: r2, topLeft: null });
      calls.answerIntro.length = 0;
      events.emit('town-intro', {});
      await frames(2);
      if (how === 'lovely') $('.hw-tcard [data-act="lovely"]', r2).click();
      else $('.hw-tcatch', r2).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
      await frames(2);
      check(`H13-${how}`, JSON.stringify(calls.answerIntro) === '[true]' && !$('.hw-tcard.is-open', r2), `${how === 'lovely' ? 'Lovely' : 'a tap outside'} → answerIntro(true)`);
      h2.destroy();
      r2.remove();
    }
  }

  // ==================================================================== H14 hint cards
  {
    fake.list = BUBBLES.filter((b) => ['almost', 'fix', 'vacancy', 'camp'].includes(b.kind));
    await sleep(350);
    await until(() => fake.list.every((b) => bubbleEl(b.key)), 3000);     // slow software-GL frames: wait for them
    const open = async (kind) => { bubbleEl(fake.list.find((b) => b.kind === kind).key).click(); await frames(2); return cardOpen()?.textContent || ''; };
    calls.muteHint.length = 0;
    const ta = await open('almost');
    noteText(ta);
    const shed = $('.hw-tcard [data-act="shed"]');
    check('H14a', cardKind() === 'almost' && /Almost a home: add a bed/.test(ta) && !!shed && !!$('.hw-tcard [data-act="showme"]'), 'the almost card: what is missing, Show me and Just a shed 🙂');
    shed?.click();
    await frames(2);
    check('H14b', JSON.stringify(calls.muteHint) === '["b:4"]' && !cardOpen(), 'Just a shed → muteHint(homeId)');
    const tf = await open('fix');
    noteText(tf);
    check('H14c', cardKind() === 'fix' && /Otis's shingled hut needs fixing: a hole in the roof/.test(tf) && !$('.hw-tcard [data-act="shed"]') && /A gap in the walls/.test(tf), 'the fix-up card lists what is missing, no Just a shed');
    calls.showMe.length = 0;
    $('.hw-tcard [data-act="showme"]').click();
    await frames(2);
    check('H14d', calls.showMe[0]?.home === 'b:3' && calls.showMe[0]?.hint === 'roof', `its Show me sends { home, hint } (${JSON.stringify(calls.showMe[0])})`);
    const tv = await open('vacancy');
    noteText(tv);
    check('H14e', cardKind() === 'vacancy' && /Who could live here\?/.test(tv) && /Fisher: a Lily Pond within 6 cells/.test(tv) && !$('.hw-tcard [data-act="shed"]') && $$('.hw-tcard [data-act="showme"]').length === 2,
      'the vacancy card: who could live here, a Show me per job, no Just a shed');
    await closeAll();
    const tc = await open('camp');
    noteText(tc);
    calls.showMe.length = 0;
    $('.hw-tcard [data-act="showme"]')?.click();
    await frames(2);
    check('H14f', /A bed for the campers \(1\)/.test(tc) && calls.showMe[0]?.camp === true, 'the camp card: "A bed for the campers (1)" + Show me');
  }

  // ==================================================================== H15 status summaries and the other town toasts
  {
    const take = async (fn) => { const n0 = toasts.length; fn(); await frames(2); return toasts.slice(n0); };
    let t = await take(() => events.emit('town-status', { changes: ['v1', 'v2', 'v3', 'v6'].map((v) => ({ villager: v, status: 'camping', prev: 'resident', homeName: null })) }));
    check('H15a', t.length === 1 && t[0].text === '⛺ 4 villagers are camping by the lane until there are beds', `4 campers → one toast ("${t.map((d) => d.text).join(' | ')}")`);
    t = await take(() => events.emit('town-status', { changes: [{ villager: 'v2', status: 'resident', prev: 'resident', homeName: 'the slate-roofed house' }] }));
    check('H15b', t.length === 1 && t[0].text === '📦 Bram is moving into the slate-roofed house', `one move → "${t[0]?.text}"`);
    t = await take(() => events.emit('town-status', { changes: [{ villager: 'v4', status: 'camping', prev: 'resident' }] }));
    check('H15c', t.length === 1 && t[0].text === '⛺ Hazel is camping by the lane until there\'s a bed free', `one camper → "${t[0]?.text}"`);
    t = await take(() => events.emit('town-status', { changes: [{ villager: 'v1', status: 'resident', prev: 'camping', homeName: 'the thatched cottage' }, { villager: 'v3', status: 'resident', prev: 'camping', homeName: 'the thatched cottage' }, { villager: 'v4', status: 'camping', prev: 'resident' }] }));
    check('H15d', t.length === 1 && /neighbours are back home|neighbours moved into the new houses/.test(t[0].text) && /Hazel is camping/.test(t[0].text), `mixed → one toast ("${t[0]?.text}")`);
    t = await take(() => events.emit('town-status', { changes: [{ villager: 'v6', status: 'resident', prev: 'waiting', homeName: 'the shingled hut' }] }));
    check('H15e', t.length === 0, 'a quick fix-up (waiting → resident) says nothing');
    t = await take(() => events.emit('town-traveller', { villager: 'v5', homeId: 'b:5', first: true, migration: false }));
    check('H15f', t.length === 1 && t[0].text === '🎒 Someone\'s coming up the lane to your new home…' && t[0].action?.label === '👀 Watch' && t[0].ms === 5000, `traveller toast with 👀 Watch ("${t[0]?.text}")`);
    calls.follow.length = 0; t[0]?.action?.fn();
    check('H15g', calls.follow[0] === 'v5', 'Watch follows the traveller');
    t = await take(() => events.emit('town-traveller', { villager: 'v5', homeId: 'b:5', first: true, migration: true }));
    check('H15h', t[0]?.text === '🎒 Word of your lovely home has spread. Someone\'s coming up the lane…', `migration traveller ("${t[0]?.text}")`);
    t = await take(() => events.emit('town-movein', { villager: 'v1', homeId: 'b:1', homeName: 'the thatched cottage', first: false }));
    check('H15i', t[0]?.text === '🏡 Mabel the Gardener moved into the thatched cottage!' && t[0].kind === 'success', `move-in toast ("${t[0]?.text}")`);
    t = await take(() => events.emit('town-fixed', { villager: 'v6', homeId: 'b:3', gain: 3 }));
    check('H15j', t[0]?.text === '🔨 Otis: “Thank you for fixing it up!”', `fixed-up toast ("${t[0]?.text}")`);
    t = await take(() => events.emit('town-granted', { villager: 'v4', wish: { tpl: 'w_camp' }, reward: { cozy: 12, gift: null }, gain: 12, cozy: { before: 40, after: 52 }, camp: true }));
    check('H15k', t[0]?.text === '💛 Hazel: “A real bed! Thank you!” · Cozy +12', `camp thank-you ("${t[0]?.text}")`);
    t = await take(() => events.emit('town-enabled', { on: false }));
    check('H15l', t[0]?.text === '🧺 Villagers are resting. Everything is kept.', `villagers off toast ("${t[0]?.text}")`);
    t = await take(() => events.emit('town-enabled', { on: true }));
    check('H15m', t[0]?.text === '👋 The villagers are back!', `villagers on toast ("${t[0]?.text}")`);
    t = await take(() => events.emit('town-readonly', {}));
    check('H15n', t[0]?.kind === 'warn' && t[0]?.action?.label === 'Reload' && t[0].ms === 8000, `other-tab toast with Reload ("${t[0]?.text}")`);
    for (const d of toasts) noteText(d.text);
  }

  // ==================================================================== pronouns in every town string shown
  {
    const bad = townTexts.filter((s) => pronounRe.test(s) && !/they'll move right in/.test(s));
    check('H2-pronouns', bad.length === 0, bad.length ? `pronouns in: ${bad.slice(0, 3).join(' | ')}` : `no her / his / their in ${townTexts.length} town strings`);
  }
  notes.tips = calls.tipOnce;
} catch (e) {
  fail('crash', `${e && e.stack ? e.stack.split('\n').slice(0, 3).join(' / ') : e}`);
} finally {
  offToast();
  fake.list = [];
  fake.sh = null;
  try { hud.close(); } catch { /* ignore */ }
  app.town = realTown;
  await sleep(200);
}
return { fails, passes: passes.length, passed: passes, notes, toasts: toasts.length };
