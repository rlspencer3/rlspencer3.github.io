// Hearthwood — Living Town spine (docs/LIVING.md §12, work package 4). `init(app)` → TownAPI, which main.js publishes as
// `app.town`. It wires the town brain (WP1: data, store, model, recipes, wishes, sim), body (WP2: actors) and face
// (WP3: js/town/hud.js, which ui.js mounts and which reads only this API and the bus) into the game: dev params, the
// two clocks, recompute scheduling, the `ready` restore, input (rig wrapping), follow, Show me, persistence and the
// debug API (`app.town.debug`, §12.13).
//
//   * The brain ticks on fixed TICK steps of the town clock, which runs only while the page is visible, villagers are
//     on, the module is healthy and the restore recompute has run (§5.1). Sim events become `town-*` bus events
//     (villager ids → VillagerViews), cues go to the actors (FX) and to audio (sfx, foley).
//   * The body draws every frame at the render clock (town clock + the part of a tick not yet run).
//   * A failure in this file or in the brain / body never stops building: every entry point is guarded; an exception
//     (or a sim.lastError) disables the town for the session and is reported once with console.error.
//   * With ?town=0 or a showcase nothing but data.js loads, the rig is not wrapped and nothing recomputes (§12.12).

const TICK = 0.25;                       // fixed sim step, town seconds (sim.TICK)
const MAX_TICKS_PER_FRAME = 64;          // townspeed 120 at a capped 0.1 s frame is 48 ticks
const RECOMPUTE_QUIET = 300;             // ms after the last world change (§3.8)
const RECOMPUTE_GAP = 500;               // ms between recomputes (≤ 2 Hz)
const VIEW_EVERY = 250;                  // ms: view() is rebuilt at most 4×/s
const SAVE_SOON = 2000;                  // ms after a town change (§12.9)
const SAVE_EVERY = 30;                   // town seconds between cadence saves (§12.9)
const HEAD = 0.35;                       // bubble anchor above the head (m)
const NEAR_SFX = 25;                     // m from the camera target: hop sfx (§12.5)
const NEAR_TALK = 35;                    // m from the camera target: chatter and foley fade out here (§11.2)
const FULL_TALK = 12;                    // m: full gain up to here
const NAMEPLATE_MS = 4000;               // the move-in nameplate (§4.6)
const GIFT_BUBBLE_MS = 4000;             // the 🎁 over the granter (§10.1)
const SKY_JUMP = 0.05;                   // |Δ sky| between ticks that counts as a slider jump (§5.4)

/** Used until js/town/data.js is there (the values are the spec's, §12.4 / §15). */
const FALLBACK = {
  JOB_ORDER: ['gardener', 'farmer', 'woodcutter', 'fisher', 'beekeeper', 'baker', 'lamplighter', 'postie'],
  KEYS: { town: 'hearthwood.town.v1', unlocks: 'hearthwood.unlocks.v1' },
  LANE_FALLBACK: [[-20.5, -2], [-28, -3.5], [-37, -8]],
  TUNE: { WARMTH_START: 10, MAX_VILLAGERS: 20, RESEAT_DELAY: 0.4 },
  DAY_SECONDS: 600,
};

/** Brain / body modules index.js uses, with the exports it needs from each (§12.4). */
const PARTS = {
  data: { path: './data.js', need: ['TUNE', 'JOB_ORDER', 'JOBS', 'TRAITS', 'KEYS', 'GIFTS', 'LANE_FALLBACK', 'STATUS_TEXT', 'ROW_TEXT', 'SHOWME_VERB'] },
  store: { path: './store.js', need: ['loadTown', 'saveTown', 'freshTown', 'sanitizeTown', 'saveUnlock'] },
  model: { path: './model.js', need: ['buildWorldModel'] },
  nav: { path: './nav.js', need: ['asciiMap'] },
  recipes: { path: './recipes.js', need: ['evalRecipes', 'chooseJob', 'charmOf', 'insideSet'] },
  wishes: { path: './wishes.js', need: ['TEMPLATES', 'TEMPLATE', 'findSpots', 'hintSpots'] },
  sim: { path: './sim.js', need: ['createSim', 'TICK'] },
  actors: { path: './actors.js', need: ['createActors'] },
};
/** Everything is wired (M1): boot imports all of it; a module that is missing or incomplete turns the town off. */
const BOOT_PARTS = Object.keys(PARTS);

// ------------------------------------------------------------------ params (§12.12)

const NUM_RE = /^\s*-?(?:\d+\.?\d*|\.\d+)\s*$/;
const JOB_RE = /^[a-z]{2,16}$/;
const TPL_RE = /^(?:w|J)_[A-Za-z0-9_]{1,40}$/;
const GIFT_RE = /^gift_[a-z_]{1,32}$/;

/**
 * Town dev params, validated like main.js's: a missing or malformed value is ignored (null / the default).
 * → { town: '0'|'1'|'fresh'|null, render, seed, speed, spawn: { jobs }|{ n }|null, wish, cozy, unlock: 'all'|id[]|null,
 *     nav, hud, log }
 */
export function parseParams(params, jobOrder = FALLBACK.JOB_ORDER) {
  const get = (k) => (params && typeof params.get === 'function' ? params.get(k) : null);
  const num = (k, lo, hi) => {
    const s = get(k);
    if (s === null || !NUM_RE.test(s)) return null;
    const n = Number(s);
    return n >= lo && n <= hi ? n : null;
  };
  const t = get('town');
  const out = {
    town: t === '0' || t === '1' || t === 'fresh' ? t : null,
    render: get('townrender') !== '0',
    seed: null, speed: 1, spawn: null, wish: null, cozy: null, unlock: null,
    nav: get('townnav') === '1', hud: get('townhud') === '1', log: get('townlog') === '1',
  };
  const seed = num('townseed', 0, 4294967295);
  if (seed !== null && Number.isInteger(seed)) out.seed = seed;
  const speed = num('townspeed', 1, 120);
  if (speed !== null) out.speed = speed;
  const sp = get('spawn');
  if (sp !== null) {
    if (/^\s*\d{1,2}\s*$/.test(sp)) {
      const n = Number(sp);
      if (n >= 1 && n <= 20) out.spawn = { n };
    } else {
      const jobs = sp.split(',').map((s) => s.trim()).filter((s) => JOB_RE.test(s) && jobOrder.includes(s)).slice(0, 20);
      if (jobs.length) out.spawn = { jobs };
    }
  }
  const w = get('wish');
  if (w !== null && TPL_RE.test(w)) out.wish = w;
  out.cozy = num('cozy', 0, 100);
  const u = get('unlock');
  if (u === 'all') out.unlock = 'all';
  else if (u !== null) {
    const ids = [...new Set(u.split(',').map((s) => s.trim()).filter((s) => GIFT_RE.test(s)))];
    if (ids.length) out.unlock = ids;
  }
  return out;
}

// ------------------------------------------------------------------ sky phases (steady schedule, §5.2)

const PHASE_MID = { morning: 7.0, day: 12.75, evening: 19.25, home: 22.25, night: 2.25 };   // hours
/** The steady villager's phase at sky time t (0..1). */
export function phaseAt(t) {
  const h = (((t % 1) + 1) % 1) * 24;
  if (h >= 23 || h < 5.5) return 'night';
  if (h < 8.5) return 'morning';
  if (h < 17) return 'day';
  if (h < 21.5) return 'evening';
  return 'home';
}

const clampN = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const tierOf = (v) => (v >= 75 ? 'glowing' : v >= 50 ? 'cheerful' : v >= 25 ? 'content' : 'quiet');
const wrap01 = (t) => (((t % 1) + 1) % 1);
const skyDiff = (a, b) => { let d = a - b; d -= Math.round(d); return d; };     // shortest signed difference on the 0..1 dial
const fill = (s, o) => String(s || '').replace(/\{(\w+)\}/g, (m, k) => (o[k] !== undefined && o[k] !== null ? String(o[k]) : m));
const cap = (s) => (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : '');

// ------------------------------------------------------------------ init

export async function init(app) {
  const { state, events, rig, world } = app;
  const P = parseParams(app.params);
  const param = (k) => app.params?.get?.(k) ?? null;
  const showcase = !!param('showcase');
  const forcedOff = P.town === '0' || showcase;              // off for this load, whatever the setting
  const forcedOn = P.town === '1' || P.town === 'fresh';     // on for this load, whatever the setting
  const freshLoad = P.town === 'fresh';                      // an in-memory town; the saved one is untouched
  const nosave = param('nosave') === '1';
  const devPage = showcase || !!param('bp') || param('clean') === '1';

  // ---------------------------------------------------------------- health
  let healthy = true;
  let failure = null;
  const report = (where, e) => {
    console.error(`[hearthwood] town ${where}: the villagers are off for this session.`, e);
    app.errors?.push?.({ where: `town.${where}`, message: String(e?.message || e) });
  };
  function fail(where, e) {
    if (!healthy) return;
    healthy = false;
    failure = { where, message: String(e?.message || e) };
    report(where, e);
    try { followId = null; show = null; hudEl?.remove(); hudEl = null; } catch { /* ignore */ }
    try { actors?.highlight?.(null); actors?.setVisible?.(false); } catch { /* ignore */ }
    try { noteEnabled(); } catch { /* ignore */ }
  }
  /** fn guarded at the module boundary: unhealthy → fallback; an exception → fail() + fallback. */
  const guard = (where, fn, fallback) => (...args) => {
    const fb = () => (typeof fallback === 'function' ? fallback(...args) : fallback);
    if (!healthy) return fb();
    try { return fn(...args); } catch (e) { fail(where, e); return fb(); }
  };
  /** The brain swallows its own exceptions into sim.lastError: surface the first one as a town failure. */
  function checkSim(where) {
    if (sim && sim.lastError) { const e = sim.lastError; sim.lastError = null; fail(where, e); return false; }
    return healthy;
  }

  // ---------------------------------------------------------------- state of the spine
  let parts = {};                    // name → { ok, mod, missing, error }
  const use = (name) => (parts[name]?.ok ? parts[name].mod : null);
  const C = () => use('data') || FALLBACK;
  const TUNE = () => ({ ...FALLBACK.TUNE, ...(use('data')?.TUNE || {}) });
  const envMod = () => app.modules?.env || null;
  const DAY = () => Number(envMod()?.DAY_SECONDS) || FALLBACK.DAY_SECONDS;

  let D = null, store = null, sim = null, actors = null;
  let model = null;                  // the last WorldModel
  let ready = false;                 // the restore recompute ran (§3.8)
  let dirty = false, lastChangeAt = 0, lastRecomputeAt = -1e9, lastVersion = -1;
  let acc = 0, ticks = 0;
  let speed = P.speed;
  let guided = false, guideActive = false;
  let lastEnabled = null;
  let skyExtra = 0, skyAt = 0, skySelf = 0;  // townspeed: extra sky time not yet applied / applied since the last tick
  let lastSky = null;                // sky at the last real tick (slider-jump detection, §5.4)
  let scrubUntil = 0, reseatAt = 0;  // the slider fade and the re-seat after it (performance.now() ms)
  let followId = null, followAt = null;
  let show = null;                   // the Show me in progress (§7.6)
  let THREE_ = null, frameRay = null; // three (already loaded by the game) for Show me's occlusion rays (T1.3)
  let selfSet = 0;                   // > 0 while index.js itself changes pieceId / tool / level (Show me)
  let crashNext = null;              // debug.crash(): throw at the next update
  const editQueue = [];              // debug.edit(fn) jobs, run at the next tick boundary
  let viewCache = null, viewAt = -1e9;
  let hvCache = null, hvTick = -1, hvAt = -1e9;   // sim.homeViews(), cached (≤ 4 Hz) and dropped on recompute
  let hudEl = null, hudAt = 0, coverAt = -1e9;
  let readOnly = false, saveAt = null, lastSaveClock = 0, savedOnce = false;
  let introPending = false, awaySeconds = null, autosavePieces = 0;
  let pendingWish = null;            // ?wish=: given to the first villager
  const nameplates = new Map();      // villager id → { homeId, until }
  let giftBubble = null;             // { id, villager, until }: the 🎁 over a granter (§10.1)
  const foley = [];                  // cues → audible().foley
  let lightLevel = new Map();        // home id → spill level (§5.6)
  let homesSig = '', syncKey = '';
  const perf = { updateMs: 0, tickMs: 0, recomputeMs: 0, recomputes: 0, maxFrameMs: 0, lastFrameAt: 0, modelMs: 0, actorMs: 0, setWorldMs: 0, afterMs: 0 };

  // ?town=1 / fresh turn villagers on for the load even if the setting is off; the player's own switch in Settings
  // still wins during the session (forceOn drops on the first `village` change)
  let forceOn = forcedOn;
  const enabled = () => healthy && !forcedOff && (forceOn || !!state.village);
  const visible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';
  const running = () => ready && enabled() && visible();
  const live = () => healthy && !state.photoMode && enabled() && ready;
  const canWrite = () => healthy && !!sim && !nosave && !showcase && !forcedOff && !freshLoad && !readOnly && !sim.readOnly;

  function emit(type, detail = {}) {
    if (P.log) console.log(`[town] ${type}`, detail);
    events.emit(type, detail);
  }
  const sfx = (name, opts) => events.emit('sfx', opts ? { name, opts } : { name });
  function noteEnabled() {
    const on = enabled();
    if (lastEnabled === null) { lastEnabled = on; return; }
    if (on === lastEnabled) return;
    lastEnabled = on;
    viewCache = null;
    try { actors?.setVisible?.(on); } catch { /* ignore */ }
    if (!on) { followId = null; endShowMe(); }
    else {
      dirty = dirty || world.version !== lastVersion;    // catch up on edits made while off
      if (ready && sim) { sim.reseat(); lastSky = null; }  // everyone where their schedule puts them now (§12.10)
    }
    emit('town-enabled', { on });
  }

  // ---------------------------------------------------------------- views (§12.4)
  const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const emptyCozy = () => {
    const w = Number(TUNE().WARMTH_START) || 10;
    const value = clampN(Math.round(w), 0, 100);
    return { value, tier: tierOf(value), warmth: w, charm: 0, floor: 0, frac: value / 100 };
  };
  const cozyNow = () => (sim?.cozy ? { ...sim.cozy } : emptyCozy());
  /** sim.homeViews(), rebuilt at most 4×/s (and after every recompute or status change). */
  function homeViews() {
    if (!sim || !model) return [];
    const now = nowMs();
    if (!hvCache || (hvTick !== ticks && now - hvAt >= VIEW_EVERY)) { hvCache = sim.homeViews(); hvTick = ticks; hvAt = now; }
    return hvCache;
  }
  const homeView = (id) => (id ? homeViews().find((h) => h.id === id) || null : null);
  const pieceName = (id) => app.catalog.getDef(id)?.name || id;
  const findV = (id) => {
    if (!sim || id === null || id === undefined) return null;
    const k = String(id);
    const t = sim.traveller;
    return sim.villagers.find((u) => u.id === k || u.name === k) || (t && (t.id === k || t.name === k) ? t : null);
  };
  /** VillagerView (§12.4) of a VillagerModel. */
  function villagerView(v) {
    if (!v || !D) return null;
    const J = D.JOBS[v.job] || {}, Tr = D.TRAITS[v.trait] || {};
    const hv = v.homeId ? homeView(v.homeId) : null;
    const target = v.status === 'traveller' ? homeView(v._target || v.homeId) : null;
    const homeName = hv?.theName || target?.theName || null;
    const ST = D.STATUS_TEXT;
    let statusText = '';
    if (v.status === 'resident') statusText = fill(ST.resident, { home: homeName || '' });
    else if (v.status === 'waiting') statusText = fill(ST.waiting, { home: cap(homeName || ''), missing: (hv?.missing?.[0]?.text || '').replace(/^./, (c) => c.toLowerCase()) });
    else if (v.status === 'camping') statusText = ST.camping;
    else if (v.status === 'traveller') statusText = fill(ST.traveller, { home: homeName || '' });
    const w = v.wish;
    return {
      id: v.id, name: v.name, job: v.job, jobLabel: J.label || v.job, jobIcon: J.icon || '', color: J.color || '#9cae6b',
      trait: v.trait, traitLabel: Tr.label || v.trait, traitIcon: Tr.icon || '', status: v.status, statusText,
      homeId: v.homeId || null, homeName,
      wish: w ? { tpl: w.tpl, text: w.text, label: w.label, icon: w.icon, piece: w.piece, pieceName: pieceName(w.piece), size: w.size, dream: !!w.dream } : null,
      fadedWish: v.status === 'traveller' ? false : !!sim.fadedWish(v.id), line: v.status === 'traveller' ? '' : sim.line(v.id) || '',
      grants: v.grants || 0, voice: v.voice || 1,
    };
  }
  const VV = (id) => villagerView(findV(id)) || (id ? { id: String(id), name: String(id) } : null);
  function rows() {
    if (!sim || !D) return [];
    const out = [];
    for (const r of sim.couldMoveIn()) {
      const J = D.JOBS[r.job] || {};
      if (r.kind === 'bed') {
        const who = r.name ? `${r.name} the ${J.label}` : `a ${String(J.label || r.job).toLowerCase()}`;
        const tx = r.camper ? (D.ROW_TEXT.bedCamp || D.ROW_TEXT.bed) : D.ROW_TEXT.bed;
        out.push({ homeId: r.homeId, homeName: r.homeName, icon: '🛏️', text: cap(fill(tx, { home: r.homeName, who: r.camper ? r.name : who })), target: { home: r.homeId, hint: 'bed' }, job: r.job, camper: r.camper || undefined });
      } else {
        const m = (r.missing || [])[0];
        out.push({ homeId: r.homeId, homeName: r.homeName, icon: J.icon || '', text: fill(D.ROW_TEXT.free, { job: J.label || r.job, missing: m?.text || '' }), target: { home: r.homeId, job: r.job }, job: r.job });
      }
    }
    return out;
  }
  function buildView() {
    const cz = cozyNow();
    if (!sim || !D) {
      return { day: 0, cozy: cz, villagers: [], homes: [], couldMoveIn: [], almost: [], campers: 0, openWishes: 0, granted: 0,
        full: false, timeFlow: !!state.timeFlow, enabled: enabled(), note: null, intro: false, away: awaySeconds };
    }
    const hv = homeViews();
    const vill = sim.villagers.map(villagerView);
    return {
      day: sim.day, cozy: cz, villagers: vill,
      homes: hv.map((h) => ({ ...h, name: h.theName })),
      couldMoveIn: rows(),
      almost: hv.filter((h) => !h.home && (h.almost || h.listed || h.status === 'fix')).map((h) => ({ ...h, name: h.theName })),
      campers: sim.villagers.filter((u) => u.status === 'camping').length,
      openWishes: sim.villagers.filter((u) => u.wish).length,
      granted: sim.stats?.granted || 0,
      full: sim.villagers.length >= (TUNE().MAX_VILLAGERS || 20),
      timeFlow: !!state.timeFlow, enabled: enabled(), note: sim.note || null, intro: introPending, away: awaySeconds,
    };
  }
  /** Where a villager's head is now (actors), else their logical spot. → [x, y, z] | null */
  function headOf(v) {
    const p = actors?.positionOf?.(v.id);
    if (p && Number.isFinite(p.x)) return { at: [p.x, (p.headY ?? p.y + 1.25) + HEAD, p.z], visible: !!p.visible };
    const q = v._pos;
    return q ? { at: [q[0], q[1] + 1.25 + HEAD, q[2]], visible: false } : null;
  }
  const roofOf = (homeId) => homeView(homeId)?.roofAnchor || null;
  /** BubbleView[] (§12.4): world anchors; the hud projects them. */
  function bubbleList() {
    if (!sim || !ready || !enabled() || !model) return [];
    const out = [];
    const dim = guided;
    for (const v of sim.villagers) {
      if (!v.wish || v.status !== 'resident') continue;
      const roof = roofOf(v.homeId);
      const hd = headOf(v);
      const inside = v._loc === 'in' || v.plan?.kind === 'inside' || v.plan?.kind === 'gone' || !hd || !hd.visible;
      const dream = !!v.wish.dream;
      const at = dream || inside ? roof : hd.at;
      if (!at) continue;
      out.push({ key: `w:${v.id}`, kind: dream ? 'dream' : 'wish', icon: v.wish.icon, label: v.wish.label, at, roof: !dream && !inside ? roof || undefined : undefined,
        villager: v.id, home: v.homeId, tappable: true, priority: dream ? 1 : 3, arrow: false, dim });
    }
    const t = sim.traveller;
    if (t && t.plan?.kind !== 'gone') {
      const hd = headOf(t);
      if (hd) out.push({ key: `t:${t.id}`, kind: 'traveller', icon: '🎒', label: '', at: hd.at, villager: t.id, home: t._target || t.homeId, tappable: !t.leaving, priority: 5, arrow: true, dim });
    }
    const pb = sim.passerby;
    if (pb && pb.plan?.kind !== 'gone') {
      const hd = headOf(pb);
      if (hd) out.push({ key: `p:${pb.id}`, kind: 'passerby', icon: '👣', label: '', at: hd.at, villager: pb.id, tappable: false, priority: 0, arrow: true, dim });
    }
    const camp = sim.campWish?.();
    if (camp) {
      const tc = sim.tents()[0] || [-11, 0];
      out.push({ key: 'camp', kind: 'camp', icon: camp.icon, text: String(camp.n), label: camp.text, at: [(tc[0] + 0.5) * 2, 2.1, (tc[1] + 0.5) * 2], tappable: true, priority: 4, arrow: false, dim });
    }
    const now = nowMs();
    for (const h of homeViews()) {
      if (h.bubble && h.roofAnchor) {
        const m = h.missing?.[0];
        const icon = h.bubble === 'fix' ? '🔨' : h.bubble === 'vacancy' ? '🏡✨' : m?.icon || '🏠';
        out.push({ key: `${h.bubble}:${h.id}`, kind: h.bubble, icon, label: h.bubble === 'vacancy' ? '' : m?.text || '', at: h.roofAnchor, home: h.id, tappable: true, priority: 2, arrow: false, dim });
      }
      if (h.home && h.asleep && h.residents?.length && h.roofAnchor) out.push({ key: `z:${h.id}`, kind: 'sleep', icon: '💤', at: h.roofAnchor, home: h.id, tappable: false, priority: 0, arrow: false, dim });
    }
    // a 🎁 over the granter for 4 s after a thank-you gift (§10.1); a tap opens the gift card
    if (giftBubble && now < giftBubble.until) {
      const v = findV(giftBubble.villager);
      const hd = v && headOf(v);
      const at = hd && hd.visible && v._loc !== 'in' ? hd.at : v ? roofOf(v.homeId) : null;
      if (at) out.push({ key: `g:${giftBubble.id}`, kind: 'gift', icon: '🎁', label: `A thank-you from ${v.name}`, at, villager: v.id, home: v.homeId, tappable: true, priority: 6, arrow: false, dim });
    } else giftBubble = null;
    for (const [id, np] of nameplates) {
      if (now > np.until) { nameplates.delete(id); continue; }
      const v = findV(id), roof = roofOf(np.homeId);
      if (!v || !roof) continue;
      out.push({ key: `n:${id}`, kind: 'nameplate', icon: '', text: `${v.name} ${D.JOBS[v.job]?.icon || ''}`.trim(), label: v.name, at: [roof[0], roof[1] + 0.5, roof[2]], villager: id, home: np.homeId, tappable: false, priority: 0, arrow: false, dim });
    }
    return out;
  }

  // ---------------------------------------------------------------- recompute (§3.8)
  function modelInputs() {
    const env = envMod();
    return {
      entries: world.entries,
      defOf: (id) => app.catalog.getDef(id),
      version: world.version,
      lane: Array.isArray(env?.LANE) ? env.LANE : C().LANE_FALLBACK || FALLBACK.LANE_FALLBACK,
      heightAt: typeof app.env?.heightAt === 'function' ? app.env.heightAt : typeof env?.heightAt === 'function' ? env.heightAt : () => 0,
      tents: sim ? sim.tents() : [],
      // the spot finder hands over raw records ({ t, x, y, z, r } or edge recs with `a`): normalize before asking the world
      validate: (rec) => { try { return world.validate(world.normalize?.(rec) || rec); } catch { return { ok: false, reason: 'invalid' }; } },
      isFree: (rec) => { try { const n = world.normalize?.(rec) || rec; const k = world.keyOf(n); return !k || !world.get(k); } catch { return false; } },
    };
  }
  function recompute({ restore = false } = {}) {
    const t0 = nowMs();
    dirty = false;
    lastRecomputeAt = t0;
    lastVersion = world.version;
    model = use('model').buildWorldModel(modelInputs());
    const t1 = nowMs();
    perf.modelMs = t1 - t0;
    sim.setWorld(model, { restore });
    if (!checkSim('recompute')) return;
    const t2 = nowMs();
    perf.setWorldMs = t2 - t1;
    hvCache = null;
    afterWorld();
    drain();
    perf.afterMs = nowMs() - t2;
    perf.recomputeMs = nowMs() - t0;
    perf.recomputes++;
    viewCache = null;
    if (show) retarget();
  }
  /** Presentation that follows a new world model: camp tents, light spill, the nav overlay, `town-homes`. */
  function afterWorld() {
    const tents = sim.tents();
    actors?.setCamp?.(tents.map(([cx, cz]) => ({ x: (cx + 0.5) * 2, z: (cz + 0.5) * 2 })));
    actors?.setSpill?.(spillLights(), (id) => lightLevel.get(id) || 0);
    refreshLights();
    if (P.nav) actors?.debugNav?.(model);
    const hv = homeViews();
    const sig = hv.map((h) => `${h.id}:${h.status}:${h.free}:${h.bubble || ''}`).join(',');
    if (sig !== homesSig) {
      const first = homesSig === '';
      homesSig = sig;
      if (ready && !first) emit('town-homes', { homes: hv.filter((h) => h.home).map((h) => ({ ...h, name: h.theName })) });
    }
  }
  /** Spill quads outside every lowest-level door and window of a Home (§5.6, §12.8). */
  function spillLights() {
    const out = [], floors = [];
    if (!model) return out;
    const nav = model.nav;
    const lvY = (y) => (y > 0 ? 0.25 + 2.5 * y : 0.25);
    const mid = (key) => {
      const [, a, xs, ys, zs] = key.split('|');
      const x = +xs, y = +ys, z = +zs;
      return a === 'x' ? { x: (x + 0.5) * 2, z: z * 2, y } : { x: x * 2, z: (z + 0.5) * 2, y };
    };
    for (const b of model.homes) {
      const add = (key, out2, opening) => {
        if (!key || !out2) return;
        const m = mid(key), [nx, nz] = out2;
        const gx = m.x + nx * 0.75, gz = m.z + nz * 0.75;
        const gy = (nav.surfaceAt ? nav.surfaceAt(gx, gz) : 0) + 0.03;
        out.push({ kind: 'ground', x: gx, y: gy, z: gz, nx, nz, w: 1.6, h: 1.2, homeId: b.id });
        out.push({ kind: 'opening', x: m.x + nx * 0.11, y: lvY(m.y) + opening.mid, z: m.z + nz * 0.11, nx, nz, w: opening.w, h: opening.h, homeId: b.id });
      };
      for (const d of b.doors || []) add(d.key, d.out, { mid: 1.0, w: 1.0, h: 1.95 });
      for (const w of b.windows || []) add(w.key, w.out, { mid: 1.45, w: 1.0, h: 1.0 });
      // indoors: a soft lamp-lit glow on the lowest floor, so a sleeper reads in the night cutaway (§5.6)
      const foot = b.foot || [];
      if (foot.length) {
        let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
        for (const [x, z] of foot) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
        const lo = b.lo | 0;
        const fy = lo > 0 ? lvY(lo) : model.index?.F?.get?.(`${foot[0][0]}|0|${foot[0][1]}`) ? 0.25 : 0;
        const w = Math.min(8, (x1 - x0 + 1) * 2 * 0.8), h = Math.min(8, (z1 - z0 + 1) * 2 * 0.8);
        floors.push({ kind: 'floor', x: (x0 + x1 + 1), y: fy + 0.04, z: (z0 + z1 + 1), nx: 0, nz: 1, w, h, homeId: b.id });
      }
    }
    return [...out.slice(0, 128 - floors.length), ...floors].slice(0, 128);
  }
  /** Spill level per home (§5.6): 1 someone inside awake · SPILL_ASLEEP all inside asleep · 0 nobody home. */
  function refreshLights() {
    const m = lightLevel;
    m.clear();
    const asleep = TUNE().SPILL_ASLEEP ?? 0.15;
    for (const v of sim.villagers) {
      if (v._loc !== 'in' || v.plan?.kind !== 'inside') continue;
      const id = v.plan.homeId || v._inHome || v.homeId;
      const L = v.plan.pose === 'sleep' ? asleep : 1;
      if ((m.get(id) || 0) < L) m.set(id, L);
    }
  }
  function onReady() {
    if (!healthy || forcedOff || ready || !sim) return;
    try {
      primeSim();
      recompute({ restore: true });                 // the silent restore, always, even when nothing changed
      if (!healthy) return;
      ready = true;
      lastSaveClock = sim.time;
      // dev params that act on the restored town (§12.12)
      if (P.spawn) {
        const order = D.JOB_ORDER;
        const jobs = P.spawn.jobs || Array.from({ length: P.spawn.n }, (_, i) => order[i % order.length]);
        for (const j of jobs) sim.debug.spawn(j);
        recompute();                                // camp tents block nav
      }
      if (P.cozy !== null) sim.debug.setCozy(P.cozy);
      if (P.wish) pendingWish = P.wish;
      applyPendingWish();
      // §0.4: the day passes by default; an existing player who pinned it before villagers existed gets it once
      if (loadedFresh && !freshLoad && !devPage && !nosave && enabled() && !sim.tips.flowDefault) {
        sim.tips.flowDefault = 1;
        if (!state.timeFlow) {
          state.set({ timeFlow: true });
          setTimeout(() => events.emit('toast', { text: D.STATUS_TEXT.flowDefault, kind: 'info', ms: 6000 }), 1500);
        }
        saveSoon();
      }
      if (introPending) sim.intro = true;
      viewCache = null;
      emit('town-ready', { away: awaySeconds });
      if (introPending) emit('town-intro', {});
    } catch (e) { fail('ready', e); }
  }
  /** The sim places everyone by its last tick's context: give it the real sky (and guided state) before a restore. */
  function primeSim() {
    guided = guidedNow();
    sim.tick(0, { sky: skyNow(), flowing: !!state.timeFlow, guided, night: nightNow() });
    lastSky = skyNow();
  }
  function applyPendingWish() {
    if (!pendingWish || !sim) return;
    const v = sim.villagers.find((u) => u.status === 'resident');
    if (!v) return;
    const tpl = pendingWish;
    pendingWish = null;
    const r = sim.debug.wish(v.id, tpl);
    if (!r.ok) console.warn(`[town] ?wish=${tpl}: ${r.reason || 'not possible here'}`);
    drain();
  }

  // ---------------------------------------------------------------- sim events, cues (§12.5)
  function drain() {
    if (!sim) return;
    let tents = false;
    for (const e of sim.drainEvents()) if (onSimEvent(e)) tents = true;
    for (const c of sim.drainCues()) onCue(c);
    if (tents) recompute();                         // camp tents changed: they block nav (§3.6)
  }
  /** One sim event → the bus. Returns true when the camp tents changed. */
  function onSimEvent(e) {
    const { type, ...d } = e;
    switch (type) {
      case 'work': return false;                    // the Phase 2 hook (§16), not for the bus
      case 'camp': hvCache = null; viewCache = null; return true;
      case 'passerby': emit('town-passerby', { id: d.id }); return false;
      case 'traveller': emit('town-traveller', { ...d, villager: VV(d.villager) }); return false;
      case 'movein': {
        nameplates.set(d.villager, { homeId: d.homeId, until: nowMs() + NAMEPLATE_MS });
        hvCache = null; viewCache = null;
        emit('town-movein', { ...d, villager: VV(d.villager) });
        applyPendingWish();
        saveSoon();
        return false;
      }
      case 'wish': {
        viewCache = null;
        emit('town-wish', { villager: VV(d.villager), wish: d.wish });
        const v = findV(d.villager);
        if (v && onScreen(d.wish?.dream ? roofOf(v.homeId) : headOf(v)?.at)) sfx('wish');
        saveSoon();
        return false;
      }
      case 'granted': {
        viewCache = null;
        emit('town-granted', { ...d, villager: VV(d.villager) });
        sfx('wish-granted');
        if (show && show.villager === d.villager && !d.camp) endShowMe(true);
        if (show && show.camp && d.camp) endShowMe(true);
        saveSoon();
        return false;
      }
      case 'expired': {
        viewCache = null;
        emit('town-expired', { villager: VV(d.villager), wish: d.wish });
        if (show && show.villager === d.villager) endShowMe(false);
        saveSoon();
        return false;
      }
      case 'gift': {
        giftBubble = { id: d.id, villager: d.from, until: nowMs() + GIFT_BUBBLE_MS };
        if (canWrite()) store.saveUnlock(d.id);     // the tiny mirror key first (§8.3)
        try { app.catalog.setHidden?.(d.id, false); } catch { /* ignore */ }
        emit('town-gift', d);
        sfx('gift');
        saveNow();
        return false;
      }
      case 'cozy': emit('town-cozy', d); saveSoon(); return false;
      case 'status': {
        viewCache = null; hvCache = null;
        const changes = (d.changes || []).map((c) => ({ ...c, villager: VV(c.villager) }));
        emit('town-status', { changes });
        if (show && show.villager && (d.changes || []).some((c) => c.villager === show.villager)) endShowMe(false);
        saveSoon();
        return false;
      }
      case 'fixed': emit('town-fixed', { ...d, villager: VV(d.villager) }); saveSoon(); return false;
      case 'day': emit('town-day', { day: d.day }); return false;
      default: emit(`town-${type}`, d); return false;
    }
  }
  function onCue(c) {
    try { actors?.cue?.(c); } catch (e) { fail('cue', e); return; }
    if (c.kind === 'hop' && c.id) {
      const t = sim.traveller;
      if (t && c.id === t.id && t.plan?.kind === 'pose' && t.plan.pose === 'knock') { sfx('move-in', panGain(c.at)); return; }
      const v = findV(c.id);
      const at = c.at || (v && headOf(v)?.at);
      if (at && nearTarget(at, NEAR_SFX)) sfx('hop', panGain(at));
      return;
    }
    if (c.kind === 'chop' || c.kind === 'splash' || c.kind === 'cluck' || c.kind === 'hum') {
      const v = c.id ? findV(c.id) : null;
      const at = c.at || (v && headOf(v)?.at);
      if (at && nearTarget(at, NEAR_TALK)) { foley.push({ kind: c.kind, at }); if (foley.length > 8) foley.shift(); }
    }
  }
  const camTarget = () => rig.target || rig.goal?.target || { x: 0, y: 0, z: 0 };
  function nearTarget(at, R) { const t = camTarget(); return Math.hypot(at[0] - t.x, at[2] - t.z) <= R; }
  /** sfx / audio opts for a world point: pan from the camera's right, gain from the distance to the camera target. */
  function panGain(at, R = NEAR_TALK) {
    if (!at) return undefined;
    const cam = app.camera, t = camTarget();
    const dx = at[0] - cam.position.x, dz = at[2] - cam.position.z;
    const fx = t.x - cam.position.x, fz = t.z - cam.position.z;
    const fl = Math.hypot(fx, fz) || 1;
    const rx = -fz / fl, rz = fx / fl;               // the camera's right on the ground
    const dl = Math.hypot(dx, dz) || 1;
    const pan = clampN((dx * rx + dz * rz) / dl, -1, 1) * 0.8;
    const d = Math.hypot(at[0] - t.x, at[2] - t.z);
    const gain = clampN(R === NEAR_TALK ? 1 - (d - FULL_TALK) / (NEAR_TALK - FULL_TALK) : 1 - d / R, 0, 1);
    return { pan: +pan.toFixed(3), gain: +gain.toFixed(3) };
  }
  function onScreen(at) {
    if (!at || !app.THREE) return false;
    const v = new app.THREE.Vector3(at[0], at[1], at[2]).project(app.camera);
    return v.z < 1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1;
  }

  // ---------------------------------------------------------------- clocks
  const skyNow = () => (Number.isFinite(app.env?.env?.t) ? app.env.env.t : Number(state.time) || 0);
  const nightNow = () => clampN(Number(app.env?.night) || 0, 0, 1);
  function guidedNow() {
    const bp = app.blueprints;
    const active = !!bp?.active?.();
    const p = bp?.progress?.();
    if (active && !guideActive && show) endShowMe(false);   // a guide starting ends Show me (§7.6)
    guideActive = active;
    return !!(active && p && p.done < p.total);
  }
  /** One sim tick. `vsky` is the sky for a virtual (debug.advance) tick; real ticks read the sky and spot slider jumps. */
  function tickOnce(vsky = null) {
    const t0 = nowMs();
    while (editQueue.length) runEdit(editQueue.shift());
    guided = guidedNow();
    let sky;
    if (vsky === null) {
      sky = skyNow();
      if (lastSky !== null && Math.abs(skyDiff(sky, lastSky) - skySelf) > SKY_JUMP) {   // the player moved the slider
        scrubUntil = t0 + (TUNE().RESEAT_DELAY || 0.4) * 1000;
        reseatAt = scrubUntil;
      }
      lastSky = sky; skySelf = 0;
    } else sky = vsky;
    sim.tick(TICK, { sky, flowing: !!state.timeFlow, guided, night: nightNow() });
    if (!checkSim('tick')) return;
    ticks++;
    drain();
    if (vsky === null && speed > 1 && state.timeFlow) skyExtra += ((speed - 1) * (TICK / speed)) / DAY();
    perf.tickMs = perf.tickMs * 0.9 + (nowMs() - t0) * 0.1;
  }
  /** townspeed: the sky flows ×n too (§12.12); applied at most 4×/s. */
  function applySky(now) {
    if (!skyExtra || now - skyAt < 250) return;
    skyAt = now;
    const t = skyNow();
    const next = wrap01(t + skyExtra);
    skySelf += skyExtra;
    skyExtra = 0;
    state.set({ time: Math.round(next * 1e5) / 1e5 });
  }
  function runEdit(job) {
    try {
      job.fn(world);
      recompute();
      job.resolve(world.version);
    } catch (e) { job.reject(e); }
  }
  /** Deterministic ticks (debug.advance / step): with time flowing the sky moves with the town clock. */
  function advanceTicks(n) {
    let vsky = skyNow();
    const flow = !!state.timeFlow;
    for (let i = 0; i < n && healthy; i++) {
      if (flow) vsky = wrap01(vsky + TICK / DAY());
      tickOnce(vsky);
    }
    if (flow && n > 0) { state.set({ time: Math.round(vsky * 1e5) / 1e5 }); }
    lastSky = null;                                   // not a slider jump
    acc = 0;
    viewCache = null; hvCache = null;
    return sim ? sim.time : 0;
  }

  // ---------------------------------------------------------------- follow (§10.2, §12.7)
  const positionOf = (id) => (actors && typeof actors.positionOf === 'function' ? actors.positionOf(id) : null);
  function endFollow() {
    followId = null;
    followAt = null;
    const g = rig.goal?.target, b = rig.bounds;
    if (g && Number.isFinite(b)) { g.x = clampN(g.x, -b, b); g.z = clampN(g.z, -b, b); }
  }
  function follow(id) {
    if (!id) { if (followId) endFollow(); return; }
    followId = String(id);
    followAt = null;
  }
  function updateFollow() {
    if (!followId) return;
    const g = rig.goal?.target;
    if (!g) return endFollow();
    if (followAt && Math.hypot(g.x - followAt.x, g.y - followAt.y, g.z - followAt.z) > 0.05) return endFollow();
    const p = positionOf(followId);
    if (!p || state.photoMode || !enabled()) return endFollow();
    rig.focus(p.x, p.y + 0.8, p.z);
    followAt = { x: g.x, y: g.y, z: g.z };
  }

  // ---------------------------------------------------------------- input (§12.7)
  function hitTest(sx, sy, pad = 24) {
    if (!actors || !P.render || !live() || typeof actors.hitTest !== 'function') return null;
    const h = actors.hitTest(sx, sy, pad);
    if (!h) return null;
    const pk = app.builder?.pickPiece?.(sx, sy);          // occlusion: a piece nearer the camera hides the villager
    if (pk?.point && app.camera.position.distanceTo(pk.point) < h.dist - 0.3) return null;
    return h.id;
  }
  const highlightHit = (sx, sy) => (actors && P.render && show && typeof actors.highlightHit === 'function' ? actors.highlightHit(sx, sy) : -1);
  /** A tap on a Show me ring / ghost with its piece in hand builds exactly there (§12.7). */
  function snapToHighlight(sx, sy) {
    if (!show || state.tool !== 'build' || guided) return false;
    const i = highlightHit(sx, sy);
    if (i < 0) return false;
    const e = show.hits[i];
    if (!e) return false;
    const want = e.rec.t;
    const alts = show.alts || [];
    if (state.pieceId !== want && !alts.includes(state.pieceId)) return false;
    const def = app.catalog.getDef(state.pieceId);
    if (!def) return false;
    const m = app.builder.materialFor(def);
    const c = app.builder.colorFor(def, m);
    const k = def.accent ? state.accent : undefined;
    const rec = { ...fullRec(e), t: state.pieceId };
    if (m !== undefined) rec.m = m; else delete rec.m;
    if (c !== undefined) rec.c = c; else delete rec.c;
    if (k !== undefined) rec.k = k; else delete rec.k;
    const n = world.normalize?.(rec) || rec;
    const key = world.keyOf(n);
    // a rec whose slot holds another piece is a swap (window boxes turn a wall_window into wall_window_shutters, the
    // door hint turns a wall into a wall_door): builder.place replaces it as one undo step, as the builder's own tap
    // does. Only a slot that already holds the wanted piece has nothing to build (R3 T3.5)
    const cur = key ? world.get(key) : null;
    if (cur && cur.t === n.t) return false;
    if (!world.validate(n)?.ok) return false;
    return !!app.builder.place(rec);
  }
  function wrapRig() {
    const tap = rig.onTap, press = rig.onPress, aimEnd = rig.onAimEnd;
    const pad = () => (state.tool === 'build' ? 12 : 24);
    rig.onTap = (x, y, ...rest) => {
      let handled = false;
      if (healthy) {
        try {
          if (live()) {
            if (snapToHighlight(x, y)) handled = true;            // a Show me spot: build exactly there
            // with the Build tool a Show me spot always wins over a villager standing on it (§12.7, R3 T3.5): a tap
            // there that could not snap (another piece in hand) goes to the builder, never to the villager card
            else if (!(state.tool === 'build' && highlightHit(x, y) >= 0)) {
              const id = hitTest(x, y, pad());
              if (id) { emit('town-select', { id }); handled = true; }
            }
          }
          if (!handled) follow(null);
        } catch (e) { fail('tap', e); handled = false; }
      }
      if (!handled) tap?.call(rig, x, y, ...rest);
    };
    rig.onPress = (x, y, ...rest) => {
      let swallow = false;
      if (healthy) {
        try { swallow = live() && highlightHit(x, y) < 0 && !!hitTest(x, y, pad()); } catch (e) { fail('press', e); swallow = false; }
      }
      if (!swallow) press?.call(rig, x, y, ...rest);
    };
    rig.onAimEnd = (x, y, cancelled, ...rest) => {
      let handled = false;
      if (healthy) {
        try { handled = !cancelled && live() && snapToHighlight(x, y); } catch (e) { fail('aimEnd', e); handled = false; }
      }
      if (handled) { try { app.builder?.hideGhost?.(); } catch { /* ignore */ } return; }
      aimEnd?.call(rig, x, y, cancelled, ...rest);
    };
    wrapFollowGestures();
    return { tap, press, aimEnd };
  }
  /**
   * Follow keeps orbit and zoom round the villager (§10.2, T1.4). camera.js anchors a pinch and a twist on the point
   * between the fingers and re-anchors a one-finger orbit on what is under the view centre, which moves goal.target
   * and would end Follow. While following (and only then), the rig's own instance gets thin wrappers: a two-finger
   * zoom / twist turns about the target, the orbit start keeps the target, and the two-finger slide only moves the view
   * (ending Follow, as a pan does) once the finger midpoint has slid SLIDE_PX more than half the pinch's own change.
   * camera.js itself is untouched; a wheel zoom toward the cursor still ends Follow.
   */
  function wrapFollowGestures() {
    const SLIDE_PX = 24;
    const zoom0 = rig._zoomAbout, turn0 = rig._turnAbout, grab0 = rig._grab, re0 = rig._reanchor, init0 = rig._initMulti;
    if ([zoom0, turn0, grab0, init0].some((f) => typeof f !== 'function')) return;
    const following = () => healthy && !!followId && rig.mode === 'multi';
    let sx = 0, sy = 0, dd = 0, slid = false, lastDist = null;
    rig._initMulti = function (...a) {
      const r = init0.apply(this, a);
      sx = 0; sy = 0; dd = 0; slid = false; lastDist = this.multi?.dist ?? null;
      return r;
    };
    rig._zoomAbout = function (f, pivot) { return zoom0.call(this, f, following() ? null : pivot); };
    rig._turnAbout = function (dTheta, pivot) { return turn0.call(this, dTheta, following() ? null : pivot); };
    rig._grab = function (x0, y0, x1, y1, planeY) {
      if (!following()) return grab0.call(this, x0, y0, x1, y1, planeY);
      sx += x1 - x0; sy += y1 - y0;
      const m = this.multi, pts = [...(this.pointers?.values?.() || [])];
      const dist = pts.length >= 2 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : m?.dist ?? lastDist;
      if (Number.isFinite(dist) && Number.isFinite(lastDist)) dd += Math.abs(dist - lastDist);
      lastDist = dist;
      if (!slid && Math.hypot(sx, sy) <= SLIDE_PX + dd / 2) return undefined;
      // a real slide: the whole drift so far at once (Follow then ends at its next frame, as for a pan)
      const ax = slid ? x0 : x1 - sx, ay = slid ? y0 : y1 - sy;
      slid = true;
      return grab0.call(this, ax, ay, x1, y1, planeY);
    };
    if (typeof re0 === 'function') rig._reanchor = function (...a) { if (healthy && followId) return undefined; return re0.apply(this, a); };
  }

  // ---------------------------------------------------------------- Show me (§7.6)
  /** Changes index.js makes itself (they never end the Show me they belong to). */
  function selfChange(fn) { selfSet++; try { return fn(); } finally { selfSet--; } }
  /** A plan rec ready for the world: roof heights filled in (§3.7). */
  function fullRec(e) {
    const rec = { ...e.rec };
    const def = app.catalog.getDef(rec.t);
    // a plan rec without a rotation would build a ghost with a NaN matrix (and a NaN hit box that claims every tap, T2.1)
    if (!Number.isFinite(rec.r)) rec.r = 0;
    if (def?.layer === 'R' && (rec.h === null || rec.h === undefined)) {
      try { rec.h = app.builder.autoRoofHeight(def, rec.x, rec.z, rec.r | 0, rec.y | 0); } catch { rec.h = 0; }
    }
    return rec;
  }
  function normTarget(target) {
    if (!target || typeof target !== 'object') return null;
    if (target.villager) { const v = findV(target.villager); return v ? { villager: v.id } : null; }
    if (target.camp) return { camp: true };
    if (target.home && target.job) return { home: target.home, job: target.job };
    if (target.home && target.hint) {
      let hint = target.hint;
      if (hint === true || !['bed', 'door', 'gaps', 'roof'].includes(hint)) hint = homeView(target.home)?.missing?.[0]?.kind || 'bed';
      return { home: target.home, hint };
    }
    if (target.home) { const k = homeView(target.home)?.missing?.[0]?.kind; return k ? { home: target.home, hint: k } : null; }
    return null;
  }
  /** The plan for a target, with its first missing part and the recs of that part. */
  function planOf(tg) {
    const r = sim.planFor(tg);
    const plan = r?.plan;
    if (!plan || !Array.isArray(plan.recs) || !plan.recs.length) return null;
    const partIdx = plan.recs[0].part | 0;
    const cur = plan.recs.filter((e) => (e.part | 0) === partIdx);
    const later = plan.recs.filter((e) => (e.part | 0) !== partIdx);
    return { r, plan, partIdx, cur, later };
  }
  /** A piece's icon for town text: its emoji, or one for its layer when the catalog icon is a plain glyph (▭). */
  const EMOJI = /\p{Extended_Pictographic}/u;
  function pieceIcon(def) {
    if (!def) return '';
    if (def.icon && EMOJI.test(def.icon)) return def.icon;
    return { R: '🏠', W: '🧱', F: '🟫', P: '🪵' }[def.layer] || def.icon || '';
  }
  function partsOf(plan) {
    return (plan.parts || []).map((p) => {
      const def = app.catalog.getDef(p.piece);
      return { piece: p.piece, icon: pieceIcon(def), name: def?.name || p.piece, n: p.n | 0, have: Math.min(p.n | 0, p.have | 0) };
    });
  }
  function altsOf(tg, partIdx) {
    if (!tg.villager) return [];
    const v = findV(tg.villager);
    const part = v?.wish && use('wishes')?.TEMPLATE?.[v.wish.tpl]?.parts?.[partIdx];
    return Array.isArray(part?.alt) ? part.alt.slice() : [];
  }
  /** Hand over the piece of a rec (and its look, as Pick does), in the right rotation. */
  function handOver(e) {
    const rec = fullRec(e);
    const def = app.catalog.getDef(rec.t);
    if (!def) return null;
    selfChange(() => {
      app.builder.selectPiece(rec.t);
      const patch = { tool: 'build' };
      if (def.rot === 'four' || def.rot === 'flip') patch.rot = rec.r | 0;
      if (def.mats && rec.m && def.mats.includes(rec.m)) patch.mats = { ...state.mats, [def.matGroup]: rec.m };
      if ((def.paint || def.paintAlways) && rec.c) patch.colors = { ...state.colors, [rec.m || def.id]: rec.c };
      if (def.accent && rec.k) patch.accent = rec.k;
      if (def.layer === 'R') {
        try { patch.hOffset = (rec.h || 0) - app.builder.autoRoofHeight(def, rec.x, rec.z, rec.r | 0, rec.y | 0); } catch { patch.hOffset = 0; }
      }
      state.set(patch);
    });
    return rec.t;
  }
  function highlightOf(po) {
    const cells = [], edges = [], hits = [];
    for (const e of po.cur) if (!e.edge) { cells.push({ x: e.x, y: e.y, z: e.z }); hits.push(e); }
    for (const e of po.cur) if (e.edge) { edges.push(e.edge); hits.push(e); }
    // the later parts' cells, faint, only where they could be tapped later from this view (R3 T3.1): on the current
    // part's level and never a roof (a ring floating over the plan at roof height was a decoy that no tap could reach)
    // and never on a cell that already has a ring (a bed over a foundation ring)
    const lv = po.cur[0].level | 0, faint = [];
    const ringed = (x, z) => cells.some((c) => Math.hypot(c.x - x, c.z - z) < 0.6) || faint.some((c) => Math.hypot(c.x - x, c.z - z) < 0.6);
    for (const e of po.later) {
      if (e.edge || (e.level | 0) !== lv || app.catalog.getDef(e.rec.t)?.layer === 'R' || ringed(e.x, e.z)) continue;
      faint.push({ x: e.x, y: e.y, z: e.z });
    }
    const g = fullRec(po.cur[0]);
    const def = app.catalog.getDef(g.t);
    if (def && g.m === undefined) { const m = app.builder.materialFor(def); if (m !== undefined) g.m = m; }
    return { h: { cells, edges, faint, ghost: g }, hits };
  }
  /** Is the spot at pt hidden from a camera at cam by a piece in between (a wall, a pine)? world.pick honours the
   *  level cutaway, so the view must be set first. */
  function occludedFrom(cam, pt) {
    if (!THREE_ || typeof world.pick !== 'function') return false;
    if (!frameRay) frameRay = new THREE_.Raycaster();
    const dx = pt[0] - cam[0], dy = pt[1] - cam[1], dz = pt[2] - cam[2];
    const d = Math.hypot(dx, dy, dz);
    if (d < 1) return false;
    frameRay.set(new THREE_.Vector3(cam[0], cam[1], cam[2]), new THREE_.Vector3(dx / d, dy / d, dz / d));
    frameRay.near = 0; frameRay.far = d - 0.7;                 // the spot's own floor and neighbours don't count
    try { return !!world.pick(frameRay); } catch { return false; }
  }
  /**
   * Frame a spot (§7.6 step 3). Outdoors the camera faces the spot from the home's centre (it looks at the house past
   * the spot); an INSIDE spot is seen from the far side of the home, over the far wall, so the wall nearest the spot
   * is not in the way (T1.3). Then a few ray tests: the preferred angle (kept at the current one when within 1.2 rad),
   * a steeper look down (phi 0.6), then a quarter / half turn, until the spot is not hidden behind a piece.
   */
  function frameSpot(e, inside, homeId) {
    const hv = homeId ? homeView(homeId) : null;
    let cx = e.x, cz = e.z;
    if (hv?.foot) {
      const cells = String(hv.foot).split(';').map((s) => s.split(',').map(Number));
      cx = (cells.reduce((a, c) => a + c[0], 0) / cells.length + 0.5) * 2;
      cz = (cells.reduce((a, c) => a + c[1], 0) / cells.length + 0.5) * 2;
    }
    const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
    const cur = rig.goal.theta;
    const dx = e.x - cx, dz = e.z - cz;
    // (an inside spot within 1.5 m of the middle has no near wall to dodge: the current angle stays first)
    const off2 = dx * dx + dz * dz;
    const pref = inside ? (off2 > 2.25 ? Math.atan2(-dx, -dz) : cur) : (off2 > 0.25 ? Math.atan2(dx, dz) : cur);
    const first = Math.abs(wrap(pref - cur)) <= 1.2 ? cur : cur + wrap(pref - cur);
    const thetas = [first];
    for (const a of [pref, pref + Math.PI / 2, pref - Math.PI / 2, pref + Math.PI]) {
      const th = cur + wrap(a - cur);
      if (!thetas.some((t) => Math.abs(wrap(t - th)) < 0.05)) thetas.push(th);
    }
    const phi0 = inside ? Math.min(rig.goal.phi, 0.9) : rig.goal.phi;
    const phis = [phi0, 0.6, 0.38].filter((p, k, a) => k === 0 || (p < phi0 - 0.05 && !a.slice(0, k).includes(p)));
    const r = clampN(rig.goal.radius, 14, 26);
    const ty = e.y + 0.5;
    // the ghost's middle and four points of its ring: the view that sees most of them wins (ties: the order above,
    // so the current angle and the usual look-down stay first); stops at the first view that sees all of them
    const pts = [[e.x, e.y + 0.35, e.z], [e.x + 0.8, e.y + 0.1, e.z], [e.x - 0.8, e.y + 0.1, e.z], [e.x, e.y + 0.1, e.z + 0.8], [e.x, e.y + 0.1, e.z - 0.8]];
    let best = null;
    const t0 = nowMs();
    search: for (const th of thetas) {
      for (const ph of phis) {
        const sp = Math.sin(ph);
        const cam = [e.x + r * sp * Math.sin(th), Math.max(0.6, ty + r * Math.cos(ph)), e.z + r * sp * Math.cos(th)];
        let seen = 0;
        for (const p of pts) if (!occludedFrom(cam, p)) seen++;
        if (!best || seen > best.seen) best = { th, ph, seen };
        if (seen === pts.length || nowMs() - t0 > 60) break search;     // a slow phone stops looking after 60 ms
      }
    }
    if (!best) best = { th: first, ph: inside ? Math.min(phi0, 0.6) : phi0 };
    rig.goal.theta = best.th;
    rig.goal.phi = best.ph;
    rig.focus(e.x, ty, e.z, r);
  }
  function showMe(target) {
    if (!live() || !sim || !model) return false;
    const tg = normTarget(target);
    if (!tg) return false;
    const po = planOf(tg);
    if (!po) return false;
    const e0 = po.cur[0];
    const inside = !!po.r.inside;
    const homeId = tg.home || findV(tg.villager)?.homeId || null;
    // 1. the view first, so the builder's own floor logic finds nothing to change (and sends no toast)
    selfChange(() => state.set({ level: clampN(e0.level | 0, 0, 4), seeAll: inside ? false : po.r.seeAll ? true : state.seeAll }));
    // 3. the camera (in guided mode Show me only frames the spot)
    if (guided) { frameSpot(e0, inside, homeId); return true; }
    endShowMe(false, true);
    // 2. the piece in hand
    const handed = handOver(e0);
    if (state.level !== (e0.level | 0)) selfChange(() => state.set({ level: clampN(e0.level | 0, 0, 4) }));
    frameSpot(e0, inside, homeId);
    // 4. the highlight
    const hl = highlightOf(po);
    actors?.highlight?.(hl.h);
    app.builder.setHints?.(hl.hits.map((e) => fullRec(e)));      // the builder's preview there: the wish's facing
    const v = tg.villager ? findV(tg.villager) : null;
    show = {
      target: tg, villager: tg.villager || null, home: tg.home || null, camp: !!tg.camp, tpl: v?.wish?.tpl || null, born: v?.wish?.born ?? null,
      plan: po.plan, partIdx: po.partIdx, hits: hl.hits, handed, alts: altsOf(tg, po.partIdx), inside, homeId, base: hintBase(tg),
    };
    // 5. the hint toast and the checklist
    emitShow(false);
    return true;
  }
  function emitShow(update) {
    if (!show) return;
    const e0 = show.hits[0];
    const piece = e0?.rec?.t || show.handed;
    const def = app.catalog.getDef(piece);
    emit('town-showme', {
      villager: show.villager || undefined, home: show.home || undefined, camp: show.camp || undefined, piece, pieceName: def?.name || piece,
      icon: pieceIcon(def), verb: D.SHOWME_VERB[piece] || 'place', inside: show.inside, parts: partsOf(show.plan), update: !!update,
    });
  }
  /** What a hint / camp Show me started from, so retarget() can tell when it is resolved (§7.6 step 8, T1.2). */
  const campersNow = () => sim.villagers.filter((u) => u.status === 'camping').length;
  const homeCap = () => homeViews().reduce((a, h) => a + (h.home ? h.capacity | 0 : 0), 0);
  function hintBase(tg) {
    if (tg.hint) { const hv = homeView(tg.home); return { beds: hv?.beds | 0, home: !!hv?.home }; }
    if (tg.camp) return { cap: homeCap(), campers: campersNow() };
    return null;
  }
  /** A hint resolves when what it asked for is there: the bed a full Home lacked (the town card's "one more bed" row),
   *  the missing kind of an almost / fix-up building (or it became a Home), or beds for every camper. The spot finder
   *  always finds another free cell or wall, so the plan alone never runs out (T1.2). */
  function hintDone(s) {
    if (s.target.hint) {
      const hv = homeView(s.target.home);
      if (!hv) return false;                                   // gone: planOf decides
      if (s.target.hint === 'bed' && s.base?.home) return (hv.beds | 0) > (s.base.beds | 0);
      return !!hv.home || !(hv.missing || []).some((m) => m.kind === s.target.hint);
    }
    if (s.camp && s.base) return campersNow() === 0 || homeCap() - s.base.cap >= Math.max(1, s.base.campers);
    return false;
  }
  /** After every recompute while Show me is up (§7.6 step 6): new plan, next part, rings and ghost move. */
  function retarget() {
    if (!show) return;
    if (show.villager) {
      const v = findV(show.villager);
      if (!v || !v.wish || v.wish.tpl !== show.tpl || v.wish.born !== show.born) { endShowMe(false); return; }
    }
    if (hintDone(show)) { endShowMe(true); return; }
    const po = planOf(show.target);
    if (!po) { endShowMe(false); return; }
    const before = JSON.stringify([show.partIdx, show.hits.map((e) => [e.x, e.z, e.rec.t])]);
    if (po.partIdx !== show.partIdx) {
      if (state.pieceId === show.handed || show.alts.includes(state.pieceId)) show.handed = handOver(po.cur[0]);
      show.alts = altsOf(show.target, po.partIdx);
    }
    const hl = highlightOf(po);
    show.plan = po.plan; show.partIdx = po.partIdx; show.hits = hl.hits;
    actors?.highlight?.(hl.h);
    app.builder.setHints?.(hl.hits.map((e) => fullRec(e)));
    const after = JSON.stringify([show.partIdx, show.hits.map((e) => [e.x, e.z, e.rec.t])]);
    if (after !== before || true) emitShow(true);
  }
  function showing() {
    if (!show) return null;
    const parts = partsOf(show.plan);
    const v = show.villager ? findV(show.villager) : null;
    const label = v?.wish?.label || (show.camp ? sim.campWish?.()?.label : null) || parts[0]?.name || '';
    return { label, parts, done: parts.every((p) => p.have >= p.n) };
  }
  function endShowMe(granted = false, quiet = false) {
    if (!show) return;
    show = null;
    try { actors?.highlight?.(null); } catch { /* ignore */ }
    try { app.builder.setHints?.(null); } catch { /* ignore */ }
    if (!quiet) emit('town-showme-end', { granted: !!granted });
  }

  // ---------------------------------------------------------------- persistence (§12.9)
  function saveNow() {
    saveAt = null;
    if (!canWrite() || !ready) return false;
    lastSaveClock = sim.time;
    const ok = store.saveTown(sim.serialize(), () => emit('town-savefail', {}));
    if (ok) savedOnce = true;
    return ok;
  }
  function saveSoon() { if (canWrite() && saveAt === null) saveAt = nowMs() + SAVE_SOON; }

  // ---------------------------------------------------------------- audio (§11.2)
  function audible() {
    const out = { talkers: [], foley: [] };
    if (!sim || !ready || !enabled() || !visible()) { foley.length = 0; return out; }
    const t = camTarget();
    const list = [];
    for (const v of sim.villagers) {
      if (v._loc !== 'out') continue;
      const hd = headOf(v);
      if (!hd || !hd.visible) continue;
      const d = Math.hypot(hd.at[0] - t.x, hd.at[2] - t.z);
      if (d > NEAR_TALK) continue;
      list.push({ d, v, at: hd.at });
    }
    list.sort((a, b) => a.d - b.d);
    for (const { v, at } of list.slice(0, 8)) {
      const pg = panGain(at);
      out.talkers.push({ pitch: v.voice || 1, pan: pg.pan, gain: pg.gain, chatty: v.trait === 'chatty' ? 1.5 : v.trait === 'shy' ? 0.5 : 1 });
    }
    for (const f of foley.splice(0)) { const pg = panGain(f.at); out.foley.push({ kind: f.kind, pan: pg.pan, gain: pg.gain }); }
    return out;
  }

  // ---------------------------------------------------------------- dev HUD (townhud=1)
  function updateHud(now) {
    if (!P.hud || now - hudAt < 250 || typeof document === 'undefined') return;
    hudAt = now;
    if (!hudEl) {
      hudEl = document.createElement('div');
      hudEl.className = 'hw-townhud hw-hide-photo';
      hudEl.style.cssText = 'position:fixed;left:8px;top:calc(60px + env(safe-area-inset-top,0px));z-index:50;'
        + 'pointer-events:none;font:11px/1.35 ui-monospace,Menlo,monospace;color:#2b2018;background:rgba(255,250,240,.82);'
        + 'padding:4px 6px;border-radius:6px;white-space:pre-wrap;max-width:min(560px,64vw)';
      document.body.appendChild(hudEl);
    }
    hudEl.style.display = state.photoMode ? 'none' : '';
    const cz = cozyNow(), h = skyNow() * 24;
    const st = sim?.debug?.stats?.() || { tickMs: 0, slips: 0 };
    const as = actors?.stats?.() || { calls: 0, tris: 0, instances: 0, updateMs: 0 };
    const clock = sim ? sim.time : 0;
    const vill = sim ? sim.villagers : [];
    const t = sim?.traveller;
    hudEl.textContent = [
      `town ${enabled() ? 'on' : 'off'}${ready ? '' : ' (waiting for ready)'}${guided ? ' · guided' : ''}${readOnly ? ' · read-only' : ''} · villagers ${vill.length}`
        + `${t ? ` + traveller ${t.name}${t.leaving ? ' (turning back)' : ''}` : ''}${sim?.passerby ? ' + passer-by' : ''} · wishes ${vill.filter((u) => u.wish).length}`,
      `hearth: Cozy ${cz.value} ${cz.tier} (warmth ${(+cz.warmth).toFixed(1)} + charm ${(+cz.charm).toFixed(1)}, floor ${cz.floor}) · clock ${clock.toFixed(1)} s · day ${sim?.day ?? 0} · ×${speed}`,
      `sky ${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')} ${phaseAt(skyNow())}${state.timeFlow ? '' : ' (pinned)'} · outdoors ${Math.round((sim?.debug?.outdoorsShare?.() || 0) * 100)}% · slips ${st.slips}`,
      `recompute ${perf.recomputeMs.toFixed(2)} ms (model ${perf.modelMs.toFixed(2)}) · tick ${(st.tickMs || 0).toFixed(3)} ms · actors ${(+as.updateMs || 0).toFixed(3)} ms · update ${perf.updateMs.toFixed(3)} ms · calls ${as.calls} · tris ${as.tris}`,
      `homes ${model?.homes?.length ?? 0} of ${model?.buildings?.length ?? 0} buildings · ${vill.map((u) => `${u.name}:${u.status[0]}${u._act ? '/' + u._act : ''}`).join(' ')}`,
    ].join('\n');
  }

  // ---------------------------------------------------------------- update (main.js frame hook)
  function update(dt) {
    const t0 = nowMs();
    if (perf.lastFrameAt) perf.maxFrameMs = Math.max(perf.maxFrameMs, t0 - perf.lastFrameAt);
    perf.lastFrameAt = t0;
    if (!ready || !sim) return;                      // nothing drawn or ticked before the restore recompute
    if (enabled() !== lastEnabled) noteEnabled();
    if (!enabled()) { if (editQueue.length) runQueuedNow(); return; }
    if (dirty && t0 - lastChangeAt >= RECOMPUTE_QUIET && t0 - lastRecomputeAt >= RECOMPUTE_GAP) {
      if (world.version !== lastVersion) recompute(); else dirty = false;
    }
    if (!healthy) return;
    if (t0 - coverAt >= 250 && typeof document !== 'undefined') {   // a card over the meadow holds the passer-by (§4.7)
      coverAt = t0;
      sim.holdPasserby = !!document.querySelector('.hw-welcome-wrap.is-open, .hw-dlg-wrap.is-open, .hw.sheet-open');
    }
    if (running()) {
      acc += Math.min(Math.max(Number(dt) || 0, 0), 0.1) * speed;
      let n = 0;
      while (acc >= TICK && n < MAX_TICKS_PER_FRAME && healthy) { acc -= TICK; tickOnce(); n++; }
      if (n === MAX_TICKS_PER_FRAME) acc = 0;
      if (n) refreshLights();
      applySky(t0);
      if (sim.time - lastSaveClock >= SAVE_EVERY) saveNow();
    } else if (editQueue.length) runQueuedNow();
    if (!healthy) return;
    if (reseatAt && t0 >= reseatAt) { reseatAt = 0; sim.reseat(); checkSim('reseat'); }
    if (saveAt !== null && t0 >= saveAt) saveNow();
    updateFollow();
    if (actors) {
      const a0 = nowMs();
      const tr = sim.traveller, pb = sim.passerby;
      const key = `${sim.villagers.length}|${tr ? tr.id : ''}|${pb ? pb.id : ''}|${ticks}`;
      if (key !== syncKey) {                         // the roster or a plan may have changed (both only at ticks)
        syncKey = key;
        const models = sim.villagers.slice();
        if (tr) models.push(tr);
        if (pb) models.push(pb);
        actors.sync(models);
      }
      const g = camTarget();
      actors.update(dt, sim.time + acc, {
        night: nightNow(), viewLevel: world.viewLevel, seeAll: world.seeAll, photo: !!state.photoMode,
        camTarget: [g.x, g.y, g.z], scrub: t0 < scrubUntil,
      });
      perf.actorMs = perf.actorMs * 0.9 + (nowMs() - a0) * 0.1;
    }
    updateHud(t0);
    perf.updateMs = perf.updateMs * 0.9 + (nowMs() - t0) * 0.1;
  }
  function runQueuedNow() { while (editQueue.length) runEdit(editQueue.shift()); }

  // ---------------------------------------------------------------- brain / body modules
  /** Import parts (dynamic and defensive) → the debug.parts() report. A part already loaded is not loaded again. */
  async function loadParts(names) {
    const list = names.filter((n) => PARTS[n] && !parts[n]?.ok);
    const loaded = await Promise.all(list.map(async (name) => {
      const spec = PARTS[name];
      const rec = { name, path: spec.path, ok: false, mod: null, missing: [], error: null };
      try {
        rec.mod = await import(spec.path);
        rec.missing = spec.need.filter((k) => rec.mod[k] === undefined);
        rec.ok = rec.missing.length === 0;
      } catch (e) { rec.error = String(e?.message || e); }
      return rec;
    }));
    for (const r of loaded) parts[r.name] = r;
    return debug.parts();
  }

  // ---------------------------------------------------------------- debug API (§12.13)
  const homeRows = () => { hvCache = null; return homeRowsNow(); };   // fresh (debug output never depends on frame timing)
  const homeRowsNow = () => (model?.buildings || []).map((b) => {
    const hv = homeView(b.id);
    return {
      id: b.id, name: b.name, cells: b.cells?.size ?? 0, ground: b.ground ?? 0, levels: b.levels || [], rooms: b.rooms ?? null,
      beds: b.beds?.length ?? 0, capacity: b.capacity ?? 0, residents: hv?.residents || [], home: !!b.home, reasons: b.reasons || [],
      flaws: b.flaws ?? 0, doors: b.doors?.length ?? 0, doorway: (b.doors || []).some((d) => d.doorway), gaps: b.gaps?.length ?? 0,
      unroofed: b.unroofed?.length ?? 0, doorsteps: (b.doors || []).map((d) => d.step), fit: hv?.fit || null, best: hv?.best || null,
    };
  });
  function recipeRows() {
    if (!model) return [];
    hvCache = null;
    const R = use('recipes');
    const inside = R.insideSet(model.buildings);
    return model.homes.map((h) => {
      const ev = R.evalRecipes(model.index, h, { homes: model.homes.length, inside });
      const hv = homeView(h.id);
      return { id: h.id, name: h.name, met: ev.met, fit: ev.fit, missing: ev.missing, best: hv?.best ?? null, runnersUp: hv?.runnersUp || [] };
    });
  }
  const vState = (v) => (v ? {
    id: v.id, name: v.name, job: v.job, trait: v.trait, status: v.status, homeId: v.homeId || null, bed: v.bed || null,
    feet: (v.feet || []).slice(), grants: v.grants || 0, leaving: !!v.leaving, cell: v._cell ? [v._cell[0], v._cell[1]] : null,
    loc: v._loc || null, plan: v.plan?.kind || null, pose: v.plan?.pose || null, act: v._act || null,
    wish: v.wish ? { tpl: v.wish.tpl, born: v.wish.born, size: v.wish.size, dream: !!v.wish.dream } : null,
  } : null);
  /** Places a villager's wish plan rec by rec (the real path: world.add + recompute after each) → { granted, placed }. */
  function grantByBuilding(who) {
    const v = findV(who);
    if (!v || !v.wish) return { granted: false, placed: 0, reason: 'no open wish' };
    const tpl = v.wish.tpl, born = v.wish.born;
    const g0 = sim.stats.granted;
    let placed = 0;
    for (let i = 0; i < 24; i++) {
      const w = findV(v.id)?.wish;
      if (!w || w.tpl !== tpl || w.born !== born) break;
      const po = planOf({ villager: v.id });
      if (!po) break;
      const rec = fullRec(po.cur[0]);
      const def = app.catalog.getDef(rec.t);
      if (def && rec.m === undefined) { const m = app.builder.materialFor(def); if (m !== undefined) rec.m = m; }
      const entry = world.add(rec, { record: true });
      if (!entry) break;
      placed++;
      recompute();
    }
    return { granted: sim.stats.granted > g0, placed };
  }
  const debug = {
    state: () => ({
      ready, enabled: enabled(), healthy, failure, clock: sim ? sim.time : 0, day: sim ? sim.day : 0, guided, speed,
      roster: sim ? sim.villagers.map(vState) : [], traveller: vState(sim?.traveller), passerby: vState(sim?.passerby),
      homes: homeRows(), wishes: sim ? sim.villagers.filter((u) => u.wish).map((u) => ({ id: u.id, tpl: u.wish.tpl, born: u.wish.born, dream: !!u.wish.dream })) : [],
      cozy: cozyNow(), unlocks: sim ? Object.keys(sim.unlocks).sort() : [], stats: sim ? { ...sim.stats } : null,
      tents: sim ? sim.tents() : [], note: sim?.note || null, readOnly, params: { ...P },
    }),
    homes: () => homeRows(),
    recipes: () => recipeRows(),
    spawn: (job, opts = {}) => {
      if (!sim || !model) return null;
      const id = sim.debug.spawn(job || null, opts || {});
      if (id && !(opts && opts.travel)) recompute();   // a camper's tent blocks nav
      else drain();
      viewCache = null;
      saveSoon();
      return id;
    },
    traveller: (job) => { if (!sim || !model) return null; const id = sim.debug.traveller(job || null); drain(); return id; },
    passerby: () => { if (!sim || !model) return null; const id = sim.debug.passerby(); drain(); return id; },
    wish: (who, tpl) => {
      if (!sim || !model) return { ok: false, reason: 'the town is not ready', plan: null };
      const v = findV(who);
      if (!v) return { ok: false, reason: 'no such villager', plan: null };
      const r = sim.debug.wish(v.id, tpl);
      drain();
      return r;
    },
    plan: (who) => { const v = findV(who); return v && sim ? sim.planFor({ villager: v.id })?.plan || null : null; },
    grant: (who, opts = {}) => {
      if (!sim || !model) return { granted: false, placed: 0 };
      if (opts && opts.build) return grantByBuilding(who);
      const v = findV(who);
      const r = v ? sim.debug.grant(v.id) : null;
      drain();
      return { granted: !!r, placed: 0, ...(r || {}) };
    },
    /** Runs fn(world) at the next tick boundary (at once while the town isn't ticking), recomputes synchronously and
     *  resolves to the new world.version. */
    edit: (fn) => new Promise((resolve, reject) => {
      if (typeof fn !== 'function') { reject(new TypeError('debug.edit(fn): fn must be a function')); return; }
      editQueue.push({ fn, resolve, reject });
      if (!running()) runQueuedNow();
    }),
    expire: (who) => { const v = findV(who); const r = !!(v && sim?.debug.expire(v.id)); drain(); return r; },
    cozy: (n) => { if (!sim) return emptyCozy().value; if (Number.isFinite(+n)) sim.debug.setCozy(clampN(+n, 0, 100)); drain(); viewCache = null; return sim.cozy.value; },
    speed: (k) => { const n = Number(k); if (Number.isFinite(n) && n >= 1 && n <= 120) speed = n; return speed; },
    unlock: (id) => {
      if (!sim || !sim.debug.unlock(id)) return false;
      if (canWrite()) store.saveUnlock(id);
      try { app.catalog.setHidden?.(id, false); } catch { /* ignore */ }
      saveSoon();
      return true;
    },
    unlockAll: () => { const ids = (sim?.debug.unlockAll() || []); for (const id of ids) { try { app.catalog.setHidden?.(id, false); } catch { /* ignore */ } } saveSoon(); return ids; },
    /** Deterministic ticks with the current context (the sky moves with the clock while time flows) → the town clock. */
    advance: (seconds) => { if (!sim || !ready) return sim ? sim.time : 0; return advanceTicks(Math.max(0, Math.round((Number(seconds) || 0) / TICK))); },
    step: (n = 1) => { if (!sim || !ready) return sim ? sim.time : 0; return advanceTicks(Math.max(0, Math.round(Number(n) || 0))); },
    phase: (name) => { if (!(name in PHASE_MID)) return false; state.set({ time: PHASE_MID[name] / 24 }); lastSky = null; return state.time; },
    nav: () => (model && use('nav') ? use('nav').asciiMap(model.nav, sim ? sim.tents() : []) : ''),
    path: (a, b) => {
      const nav = model?.nav;
      if (!nav || typeof nav.path !== 'function') return null;
      const r = nav.path(a, b);
      return r ? { len: r.len, hops: r.hops?.length ?? 0, slips: r.slips?.length ?? 0 } : null;
    },
    stuck: () => (sim ? sim.debug.stuck() : []),
    outdoors: () => (sim ? sim.debug.outdoorsShare() : 0),
    select: (who) => { const v = findV(who); if (!v) return false; emit('town-select', { id: v.id }); follow(v.id); return true; },
    /** maxFrameMs is the longest frame since the previous stats() call (or load); reading it starts a new window. */
    stats: () => {
      const s = actors?.stats?.() || { calls: 0, tris: 0, instances: 0, updateMs: 0 };
      const ss = sim?.debug?.stats?.() || { tickMs: 0, slips: 0, plans: 0, ticks: 0 };
      const out = {
        calls: s.calls || 0, tris: s.tris || 0, instances: s.instances || 0, updateMs: +perf.updateMs.toFixed(4), actorMs: +(+s.updateMs || 0).toFixed(4),
        tickMs: +(+ss.tickMs || 0).toFixed(4), recomputeMs: +perf.recomputeMs.toFixed(3), plansPerSec: sim && sim.time > 0 ? +((ss.plans || 0) / sim.time).toFixed(3) : 0,
        slips: ss.slips || 0, maxFrameMs: +perf.maxFrameMs.toFixed(1), recomputes: perf.recomputes, ticks, modelMs: +perf.modelMs.toFixed(3),
        setWorldMs: +perf.setWorldMs.toFixed(3), afterMs: +perf.afterMs.toFixed(3), recomputeAt: lastRecomputeAt,
      };
      perf.maxFrameMs = 0;
      return out;
    },
    snapshot: () => (sim && store ? store.sanitizeTown(sim.serialize()) : null),
    reset: ({ keepUnlocks = true } = {}) => {
      if (!sim || !store) return false;
      const fresh = store.freshTown(P.seed ?? undefined);
      if (keepUnlocks) { fresh.unlocks = { ...sim.unlocks }; fresh.seen = sim.seen.slice(); fresh.tips = { ...sim.tips }; }
      endShowMe(false);
      sim = use('sim').createSim({ save: fresh, readOnly: sim.readOnly });
      hvCache = null; viewCache = null; homesSig = ''; syncKey = ''; followId = null;
      nameplates.clear(); foley.length = 0;
      primeSim();
      recompute({ restore: true });
      saveNow();
      return true;
    },
    parts: () => Object.fromEntries(Object.values(parts).map((p) => [p.name, { ok: p.ok, missing: p.missing, error: p.error }])),
    /** Import modules not loaded at boot (none since M1: everything is wired) → the parts() report. */
    loadParts: async (names = Object.keys(PARTS)) => loadParts(Array.isArray(names) ? names : [names]),
    /** Test hook: throw inside the town at its next update (or at once in a guarded API call, for 'api'), to check
     *  that a failure turns the town off for the session, reports once, and building carries on. */
    crash: (where = 'update') => {
      if (where === 'api') return crashApi();
      crashNext = String(where);
      return true;
    },
    /** For tests and the dev HUD (not part of the §12.13 contract). */
    following: () => followId,
    get sim() { return sim; },
    get actors() { return actors; },
    get model() { return model; },
  };
  const crashApi = guard('debug.crash', () => { throw new Error('debug.crash(api)'); }, false);

  // ---------------------------------------------------------------- TownAPI (§12.4)
  const town = {
    get ready() { return ready; },
    enabled: () => enabled(),
    clock: () => (sim ? sim.time : 0),
    day: () => (sim ? sim.day : 0),
    cozy: guard('cozy', () => cozyNow(), emptyCozy),
    view: guard('view', () => {
      const now = nowMs();
      if (!viewCache || now - viewAt >= VIEW_EVERY) { viewCache = buildView(); viewAt = now; }
      return viewCache;
    }, () => ({ day: 0, cozy: emptyCozy(), villagers: [], homes: [], couldMoveIn: [], almost: [], campers: 0, openWishes: 0, granted: 0, full: false, timeFlow: !!state.timeFlow, enabled: false, note: null, intro: false })),
    villager: guard('villager', (id) => villagerView(findV(id)), null),
    bubbles: guard('bubbles', () => bubbleList(), () => []),
    giftInfo: guard('giftInfo', (id) => {
      const def = app.catalog.getDef(id);
      if (!def?.gift || !sim) return null;
      const u = sim.unlocks[id];
      if (!u) return null;
      return { from: u.from || '', isNew: !sim.seen.includes(id) };
    }, null),
    tipOnce: guard('tipOnce', (id) => {
      const k = String(id);
      const tips = sim ? sim.tips : fallbackTips;
      if (tips[k]) return false;
      tips[k] = 1;
      saveSoon();
      return true;
    }, false),
    audible: guard('audible', () => audible(), () => ({ talkers: [], foley: [] })),
    hitTest: guard('hitTest', (sx, sy, pad = 24) => hitTest(sx, sy, pad), null),
    showMe: guard('showMe', (target) => showMe(target), false),
    showing: guard('showing', () => showing(), null),
    endShowMe: guard('endShowMe', () => endShowMe(false), undefined),
    muteHint: guard('muteHint', (homeId) => { if (sim?.muteHint(homeId)) { hvCache = null; viewCache = null; saveSoon(); } }, undefined),
    answerIntro: guard('answerIntro', (lovely) => {
      introPending = false;
      if (sim) sim.answerIntro(!!lovely);
      else fallbackTips.intro = 1;
      viewCache = null;
      if (!lovely) state.set({ village: false });      // "Keep my meadow quiet" (§1.3)
      saveSoon();
    }, undefined),
    follow: guard('follow', (id) => follow(id), undefined),
    focusHome: guard('focusHome', (homeId) => {
      const hv = homeView(homeId);
      const at = hv?.door || hv?.roofAnchor;
      if (!at) return false;
      rig.focus(at[0], (at[1] || 0) + 1, at[2], 18);
      return true;
    }, false),
    update: guard('update', (dt) => {
      if (crashNext) { const w = crashNext; crashNext = null; throw new Error(`debug.crash(${w})`); }
      update(dt);
    }, undefined),
    debug,
  };
  const fallbackTips = {};
  let loadedFresh = false;

  // ---------------------------------------------------------------- boot
  try {
    // gifts unlocked for this load by ?unlock= (not saved), applied even when the town is off for the load (§12.12)
    if (P.unlock) {
      const ids = P.unlock === 'all' ? app.catalog.allDefs().filter((d) => d.gift).map((d) => d.id) : P.unlock;
      for (const id of ids) if (app.catalog.getDef(id)?.gift) app.catalog.setHidden?.(id, false);
    }
    if (forcedOff) {
      lastEnabled = false;
      return town;                                   // town=0 / showcase: nothing loads, wraps, ticks or saves
    }
    // the brain and the body
    await loadParts(BOOT_PARTS);
    try { THREE_ = await import('three'); } catch { THREE_ = null; }   // the game's own copy (import map)
    const missing = BOOT_PARTS.filter((n) => !parts[n]?.ok);
    if (missing.length) throw new Error(`town modules missing: ${missing.map((n) => `${n}${parts[n]?.error ? ' (' + parts[n].error + ')' : parts[n]?.missing?.length ? ' (no ' + parts[n].missing.join(', ') + ')' : ''}`).join(', ')}`);
    D = use('data');
    store = use('store');
    Object.assign(P, { spawn: parseParams(app.params, D.JOB_ORDER).spawn });

    // the town save (§12.9): device-level, or a fresh one in memory for ?town=fresh
    let save;
    if (freshLoad) { save = store.freshTown(P.seed ?? undefined); loadedFresh = true; }
    else {
      const L = store.loadTown();
      save = L.save; readOnly = !!L.readOnly; loadedFresh = !!L.fresh;
      if (L.fresh && P.seed !== null) save = { ...store.freshTown(P.seed), unlocks: save.unlocks, seen: save.seen };
    }
    awaySeconds = save.lastSeen ? Math.max(0, (Date.now() - save.lastSeen) / 1000) : null;
    try { autosavePieces = app.storage?.loadAutosave?.()?.pieces?.length || 0; } catch { autosavePieces = 0; }
    sim = use('sim').createSim({ save, readOnly: readOnly || freshLoad });
    // the gifts this town unlocked show in the tray (gifts.js read them at registration too, §8.3)
    for (const id of Object.keys(sim.unlocks || {})) { try { app.catalog.setHidden?.(id, false); } catch { /* ignore */ } }
    // §1.3: an existing build meets a fresh town → the intro card asks first
    introPending = loadedFresh && !freshLoad && autosavePieces > 0 && !devPage && !sim.tips.intro && (forcedOn || !!state.village);

    // the body: compiled behind the loading screen, so the first traveller compiles no program (§12.8)
    actors = use('actors').createActors(app, { render: P.render });
    try { await actors.compile(app.camera); } catch (e) { console.warn('[town] compile', e); }

    wrapRig();
    events.on('world-change', () => { dirty = true; lastChangeAt = nowMs(); });
    events.on('ready', onReady);
    events.on('placed', (d) => {                     // a placed gift clears its tray ribbon (§8.3)
      try {
        const id = d?.def?.gift ? d.def.id : null;
        if (id && sim && !sim.seen.includes(id)) { sim.seen.push(id); saveSoon(); }
      } catch { /* ignore */ }
    });
    state.on((changed) => {
      if (!healthy) return;
      try {
        if (changed.includes('village') || changed.includes('timeFlow')) viewCache = null;
        if (changed.includes('village')) { forceOn = false; noteEnabled(); }
        if (changed.includes('photoMode') && state.photoMode) { if (followId) endFollow(); endShowMe(false); }
        // a piece or tool the town didn't hand over ends Show me (§7.6, §12.7)
        if (show && !selfSet && (changed.includes('pieceId') || changed.includes('tool'))) endShowMe(false);
      } catch (e) { fail('state', e); }
    });
    if (typeof window !== 'undefined') {
      const flush = () => { try { if (ready && enabled()) saveNow(); } catch { /* ignore */ } };
      window.addEventListener('pagehide', flush);
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
      // two tabs (§12.9): another tab wrote the town → this one stops writing it for the session
      window.addEventListener('storage', (e) => {
        try {
          if (e.key !== D.KEYS.town || readOnly || !canWrite()) return;
          readOnly = true;
          emit('town-readonly', {});
        } catch { /* ignore */ }
      });
    }
    lastEnabled = enabled();
    if (!lastEnabled) actors.setVisible(false);
  } catch (e) {
    fail('init', e);
  }
  return town;
}
