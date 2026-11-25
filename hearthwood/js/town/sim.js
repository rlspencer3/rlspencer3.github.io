// Hearthwood — Living Town: the deterministic town model (docs/LIVING.md §3.5–§9, §12.4).
// Roster, statuses with settling, schedules and activity plans, arrivals and the traveller, the passer-by, the camp,
// wishes, Cozy and gifts. Pure logic on fixed TICK steps: no three, no DOM, no window, never any camera data, and
// every random choice goes through rng.js seeded from the town seed and the villager seed.

import { CELL, levelY, CHAIR_SEAT_Z, chairTuck } from '../config.js';
import {
  TUNE, JOBS, JOB_ORDER, TRAITS, TRAIT_ORDER, NAMES, LINES, GIFTS, GIFT_IDS, CAMP_CELLS, SETS, SPOT_DEFS, STATUS_TEXT,
  WISH_TEXT, HINT_TEXT, LOOK,
} from './data.js';
import { rng, hash32, range, pick, weighted, int } from './rng.js';
import { packFoot, unpackFoot, footOverlap, ck, ci, inNav, dist } from './homes.js';
import { evalRecipes, chooseJob, charmOf, charmFromKinds, closestJobs, insideSet, doorStandPoint, localToWorld, unitsIn } from './recipes.js';
import { TEMPLATES, TEMPLATE, wishCtx, findSpots, hintSpots, createWish, weightOf, termSpots, textOf, isDone } from './wishes.js';
import { freshTown, sanitizeTown, VERSION } from './store.js';

export const TICK = TUNE.TICK;

const S = Object.fromEntries(Object.entries(SETS).map(([k, v]) => [k, new Set(v)]));
const TIERS = ['quiet', 'content', 'cheerful', 'glowing'];
const tierOf = (v) => (v >= TUNE.TIERS[2] ? 3 : v >= TUNE.TIERS[1] ? 2 : v >= TUNE.TIERS[0] ? 1 : 0);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const wrapH = (h) => ((h % 24) + 24) % 24;
const yawTo = (fx, fz, tx, tz) => Math.atan2(tx - fx, tz - fz);
const GONE = Object.freeze({ kind: 'gone' });
const SAVE_V_FIELDS = ['id', 'name', 'job', 'trait', 'look', 'voice', 'seed', 'status', 'home', 'since', 'arrived', 'grants', 'wish', 'nextWishAt', 'recent', 'cool'];

/**
 * createSim({ save, readOnly }) → Sim (§12.4). `save` is a sanitized TownSave (a fresh town when missing).
 * Extras beyond the contract (all read-only views): homeViews(), tents(), campWish(), line(id), fadedWish(id), seen / tips / unlocks /
 * muted (live save fields index.js may update), intro (set true while the intro card is open), day, population.
 */
export function createSim({ save = null, readOnly = false } = {}) {
  const sv = save ? sanitizeTown(save) : freshTown();
  const st = {
    seed: sv.seed >>> 0, clock: sv.clock, lastSeen: sv.lastSeen, warmth: sv.warmth,
    stats: { ...sv.stats }, nextId: sv.nextId, unlocks: sv.unlocks, seen: sv.seen, tips: sv.tips,
    muted: sv.muted, campGrants: sv.campGrants, traveller: sv.traveller, v: sv.v,
  };
  let world = null, inside = new Set();
  let restored = false, lastSetWorld = -Infinity, restoredAt = 0;
  let tickN = 0, events = [], cues = [];
  let lastCtx = { sky: 0.42, flowing: false, guided: false, night: 0 };
  let lastWishAt = -Infinity, lastArrivalAt = -Infinity, lastCheck = -Infinity;
  let guidedWas = false, guidedDoneAt = -Infinity, migration = false, introAt = null;
  let pathBudget = TUNE.PATHS_PER_FRAME;
  let passers = 0, passerNext = null, nightStrollAt = null, strollRR = 0;
  let homeInfo = new Map();                          // building id → { b, evals, choice, residents, free }
  let vacancy = new Map();                           // packed foot → { since }
  let hintState = new Map();                         // packed foot → { sig, since, shownAt, shown, kind }
  let tentCells = [];
  let campArea = null;
  let reserved = new Map();                          // spot id → villager id (one place per villager: v._spot, v._spotAt)
  let outdoorT = 0, totalT = 0, slips = 0, tickMsSum = 0, tickCount = 0;
  let pending = false;
  let cozyCache = null, charm = 0, lastCozy = null;
  let traveller = null, passerby = null;
  let note = null;
  let dayWas = Math.floor(st.clock / TUNE.DAY_SECONDS);

  // ------------------------------------------------------------------------------------------ villagers from the save
  const villagers = [];
  for (const o of sv.villagers) villagers.push(fromSave(o));
  function fromSave(o) {
    const v = {
      id: o.id, name: o.name, job: o.job, trait: o.trait, voice: o.voice, seed: o.seed >>> 0,
      look: { outfit: o.look[0], skin: o.look[1], hair: o.look[2], build: o.look[3] },
      status: o.status, leaving: false, homeId: null, bed: o.home?.bed || null, feet: (o.home?.feet || []).slice(0, TUNE.FEET_KEPT),
      arrived: o.arrived, grants: o.grants, plan: GONE, planId: 0, wish: null,
      flags: { pack: false, tool: false, basket: false, book: false, lantern: false }, mood: 0,
      since: o.since, nextWishAt: o.nextWishAt, recent: o.recent.slice(), cool: { ...o.cool },
    };
    if (o.wish) v._wishSave = o.wish;
    initInner(v);
    if (v.status === 'camping') { v._lastBed = v.bed; v.bed = null; }
    return v;
  }
  function initInner(v) {
    v._loc = 'gone'; v._cell = null; v._pos = null; v._steps = []; v._act = null; v._phase = null; v._spot = null; v._spotAt = null; v._spotLie = null;
    v._jit = (rng(hash32(st.seed, v.seed, 'jit'))() * 2 - 1) * TUNE.SCHEDULE.jitter;
    v._grantUse = null; v._fadedAt = -Infinity; v._cueSched = []; v._bout = 0; v._roundAt = -Infinity;
    v._lunchAt = -Infinity; v._dreamDelay = false; v._statusAt = v.since || 0; v._deferred = false;
    v._fixShown = false; v._line = null; v._lineKey = null; v._thanks = null; v._movedAt = -Infinity; v._grantedAt = -Infinity;
    v._pinnedN = 0;
  }

  // ------------------------------------------------------------------------------------------ small helpers
  const R = (v, tag) => rng(hash32(st.seed, v ? v.seed : 0, tickN, tag));
  const Rt = (tag, n = 0) => rng(hash32(st.seed, tag, n));
  const emit = (type, detail = {}) => { events.push({ type, ...detail }); };
  const cue = (kind, o = {}) => { cues.push({ t: st.clock, kind, ...o }); };
  const B = (id) => (world && id ? world.buildings.find((b) => b.id === id) || world.shells.find((b) => b.id === id) || null : null);
  const mainDoor = (b) => (b ? b.doors.find((d) => d.main) || b.doors[0] || null : null);
  const residentsOf = (hid) => villagers.filter((u) => u.homeId === hid && u.status === 'resident');
  const roster = () => villagers;
  const isSleepPhase = (p) => p === 'night';
  const surfaceAt = (x, z) => (world ? world.nav.surfaceAt(x, z) : 0);
  const cellCentre = (c) => (world ? world.nav.centre(c[0], c[1]) : [(c[0] + 0.5) * CELL, 0, (c[1] + 0.5) * CELL]);
  const theName = (b) => {
    if (!b) return '';
    const dup = world && world.homes.filter((h) => h.name === b.name).length > 1;
    if (dup) { const r = residentsOf(b.id)[0] || villagers.find((u) => u.homeId === b.id); if (r) return `${r.name}'s ${b.name}`; }
    return `the ${b.name}`;
  };

  // ------------------------------------------------------------------------------------------ schedule & phases (§5.2)
  function hours(sky) { return wrapH(24 * sky); }
  function scheduleOf(v) {
    const sc = TUNE.SCHEDULE, sh = TRAITS[v.trait]?.shift || {};
    return { wake: sc.wake + (sh.wake || 0) + v._jit, home: sc.home + (sh.home || 0) + v._jit, sleep: sc.sleep + (sh.sleep || 0) + v._jit };
  }
  function phaseOf(v, sky) {
    const h = hours(sky), s = scheduleOf(v);
    const wake = wrapH(s.wake);
    const u = (x) => { const w = wrapH(x); return w < wake ? w + 24 : w; };
    const hh = u(h), sleep = u(s.sleep), home = u(s.home);
    if (hh >= sleep) return 'night';
    if (hh < TUNE.SCHEDULE.morningEnd) return 'morning';
    if (hh < TUNE.SCHEDULE.dayEnd) return 'day';
    if (hh < home) return 'evening';
    return 'home';
  }
  /** Hours from sky time to v's wake hour (0..24). */
  function hoursToWake(v, sky) { return wrapH(wrapH(scheduleOf(v).wake) - hours(sky)); }
  const nightSky = (sky) => sky > 0.74 || sky < 0.27;

  // ------------------------------------------------------------------------------------------ Cozy (§9)
  function computeCharm() {
    if (!world) return 0;
    let Ssum = 0;
    for (const h of world.homes) if (residentsOf(h.id).length) Ssum += charmOf(world.index, h, inside);
    return charmFromKinds(Ssum);
  }
  function cozyNow() {
    const pop = villagers.length;
    const floor = pop > 0 ? TUNE.COZY_FLOOR.base + TUNE.COZY_FLOOR.per * Math.min(pop, TUNE.COZY_FLOOR.cap) : 0;
    const value = clamp(Math.round(st.warmth + charm), floor, 100);
    const tier = TIERS[tierOf(value)];
    return { value, tier, warmth: st.warmth, charm, floor, frac: value / 100 };
  }
  function refreshCozy() {
    const c = cozyNow();
    sim.cozy = c;
    for (const v of villagers) v.mood = tierOf(c.value);
    if (lastCozy && (lastCozy.value !== c.value || lastCozy.tier !== c.tier) && restored) emit('cozy', { value: c.value, tier: c.tier, prevTier: lastCozy.tier });
    lastCozy = c;
    return c;
  }
  function gainWarmth(r) {
    const gain = Math.max(1, Math.round(r * (1 - st.warmth / TUNE.WARMTH_MAX)));
    const before = cozyNow().value;
    st.warmth = Math.min(TUNE.WARMTH_MAX, st.warmth + gain);
    const after = cozyNow().value;
    refreshCozy();
    return { gain, before, after };
  }

  // ------------------------------------------------------------------------------------------ homes & recipes
  function refreshHomes() {
    homeInfo = new Map();
    if (!world) return;
    const n = world.homes.length;
    const counts = jobCounts();
    for (const h of world.homes) {
      const evals = evalRecipes(world.index, h, { homes: n, inside });
      const res = residentsOf(h.id);
      const incoming = traveller && traveller._target === h.id ? 1 : 0;
      homeInfo.set(h.id, { b: h, evals, choice: chooseJob(evals, counts, villagers.length === 0), residents: res, free: h.capacity - res.length - incoming });
    }
  }
  function jobCounts() { const c = {}; for (const u of villagers) c[u.job] = (c[u.job] || 0) + 1; return c; }

  // ------------------------------------------------------------------------------------------ re-binding (§3.5)
  function propose() {
    const out = new Map();
    if (!world) return out;
    const homes = world.homes;
    const usable = new Map();                          // home id → bed keys (≤ capacity): beds already held first
    // a bed someone already sleeps in stays usable when a home has more beds than its capacity, so adding a bed to a
    // full home never takes one away from its resident (in key order alone, a new bed sorting first pushed one out)
    const held = new Set(villagers.filter((u) => u.status !== 'camping' && u.bed).map((u) => u.bed));
    for (const h of homes) usable.set(h.id, [...h.beds.filter((k) => held.has(k)), ...h.beds.filter((k) => !held.has(k))].slice(0, h.capacity));
    const claimed = new Set();
    const homeWithBed = (bed) => homes.find((h) => usable.get(h.id).includes(bed));
    // pass 1: keep
    for (const v of villagers) {
      if (v.status === 'camping' || !v.bed) continue;
      const h = homeWithBed(v.bed);
      if (h && v.feet.some((f) => footOverlap(h.foot, f) >= TUNE.HOME_MATCH)) { out.set(v.id, { status: 'resident', home: h, bed: v.bed, step: 1 }); claimed.add(v.bed); }
    }
    const freeBed = (h, prefer) => {
      const list = usable.get(h.id).filter((k) => !claimed.has(k));
      if (!list.length) return null;
      return prefer && list.includes(prefer) ? prefer : list[0];
    };
    // pass 2
    for (const v of villagers) {
      if (out.has(v.id)) continue;
      const prefer = v.bed || v._lastBed;
      let done = false;
      // 2. a Home overlapping a stored foot (most recent first) with a free bed
      for (const f of v.feet) {
        const hs = homes.filter((h) => footOverlap(h.foot, f) >= TUNE.HOME_MATCH && freeBed(h, prefer));
        if (hs.length) {
          hs.sort((a, c) => footOverlap(c.foot, f) - footOverlap(a.foot, f) || (a.id < c.id ? -1 : 1));
          const bed = freeBed(hs[0], prefer);
          claimed.add(bed); out.set(v.id, { status: 'resident', home: hs[0], bed, step: 2 }); done = true; break;
        }
      }
      if (done) continue;
      // 3. a building (not a Home) overlapping the most recent foot → waiting
      if (v.status !== 'camping' && v.feet[0]) {
        const cand = [...world.buildings, ...world.shells.filter((s) => !s.partOf)].filter((b) => !b.home && footOverlap(b.foot, v.feet[0]) >= TUNE.HOME_MATCH);
        if (cand.length) {
          cand.sort((a, c) => footOverlap(c.foot, v.feet[0]) - footOverlap(a.foot, v.feet[0]) || (a.id < c.id ? -1 : 1));
          out.set(v.id, { status: 'waiting', home: cand[0], bed: v.bed, step: 3 }); continue;
        }
      }
      // 4. moving day: best recipe fit, then distance
      const free = homes.filter((h) => freeBed(h, null));
      if (free.length) {
        const ref = v.feet[0] ? unpackFoot(v.feet[0]) : (v._cell ? [v._cell] : [[0, 0]]);
        const refC = ref.length ? [ref.reduce((a, c) => a + c[0], 0) / ref.length, ref.reduce((a, c) => a + c[1], 0) / ref.length] : [0, 0];
        const fitOf = (h) => evalRecipes(world.index, h, { homes: homes.length, inside }).fit[v.job] || 0;
        free.sort((a, c) => fitOf(c) - fitOf(a) || dist(refC[0], refC[1], a.foot) - dist(refC[0], refC[1], c.foot) || (a.id < c.id ? -1 : 1));
        const bed = freeBed(free[0], null);
        claimed.add(bed); out.set(v.id, { status: 'resident', home: free[0], bed, step: 4 }); continue;
      }
      out.set(v.id, { status: 'camping', home: null, bed: null, step: 5 });
    }
    return out;
  }
  const sameBinding = (v, p) => {
    if (p.status !== v.status) return false;
    if (p.status === 'resident') return p.bed === v.bed;
    if (p.status === 'waiting') return !!v.feet[0] && footOverlap(p.home.foot, v.feet[0]) >= TUNE.HOME_MATCH && v.homeId !== null;
    return true;
  };
  function refreshFoot(v, b) {
    const f = packFoot(b.foot);
    const rest = v.feet.filter((x) => x !== f && footOverlap(x, f) < TUNE.HOME_MATCH);
    v.feet = [f, ...rest].slice(0, TUNE.FEET_KEPT);
  }
  /** Apply the silent parts of a proposal (ids, feet) and return the villagers whose binding really changes. */
  function silentRefresh(prop) {
    const changes = [];
    for (const v of villagers) {
      const p = prop.get(v.id);
      if (!p) continue;
      if (sameBinding(v, p)) {
        if (p.home) { v.homeId = p.home.id; if (p.status === 'resident') refreshFoot(v, p.home); }
      } else changes.push([v, p]);
    }
    return changes;
  }
  function commit(changes, { silent = false } = {}) {
    const list = [];
    let tentsChanged = false;
    for (const [v, p] of changes) {
      const prev = v.status;
      const prevHome = v.homeId;
      const prevBed = v.bed;
      // drop the open wish silently (§3.5)
      if (v.wish) v.wish = null;
      v.nextWishAt = Math.max(v.nextWishAt, st.clock + TUNE.REWISH_AFTER_MOVE);
      let back = false;
      if (p.status === 'resident') {
        const fixed = prev === 'waiting' && p.bed === v.bed && v._fixShown;
        const fromCamp = prev === 'camping';
        // "back home" only for their own old bed in the home they last lived in (T1.6), else "moving into"
        back = fromCamp && !!v._lastBed && p.bed === v._lastBed && !!v.feet[0] && footOverlap(v.feet[0], p.home.foot) >= TUNE.HOME_MATCH;
        const campedLong = fromCamp && st.clock - v._statusAt >= TUNE.FIXUP_DELAY;
        v.status = 'resident'; v.homeId = p.home.id; v.bed = p.bed; v._lastBed = null;
        refreshFoot(v, p.home);
        if (!silent) {
          if (fixed) { const g = gainWarmth(TUNE.COZY_FIX); emit('fixed', { villager: v.id, homeId: v.homeId, gain: g.gain }); cue('hearts', { id: v.id, home: v.homeId }); }
          if (campedLong) {
            const key = `${v.id}|${p.bed}`;
            if (!st.campGrants.includes(key)) {
              st.campGrants.push(key);
              if (st.campGrants.length > TUNE.CAMP_GRANTS_MAX) st.campGrants.shift();
              const g = gainWarmth(TUNE.COZY_CAMP);
              emit('granted', { villager: v.id, wish: { tpl: 'w_camp', ...textOf('w_camp'), size: 'L' }, reward: { cozy: g.gain, gift: null }, gain: g.gain, cozy: { before: g.before, after: g.after }, camp: true });
              cue('hearts', { id: v.id });
            }
          }
        }
        if (fromCamp) tentsChanged = true;
      } else if (p.status === 'waiting') {
        v.status = 'waiting'; v.homeId = p.home.id; v._fixShown = false;
        if (prev === 'camping') tentsChanged = true;
      } else {
        if (v.bed) v._lastBed = v.bed;
        v.status = 'camping'; v.homeId = null; v.bed = null; tentsChanged = true;
      }
      v._statusAt = st.clock;
      v.since = st.clock;
      v._movedAt = st.clock;
      list.push({ villager: v.id, status: v.status, prev, homeName: v.homeId ? theName(B(v.homeId)) : null, from: prevHome, back });
      // walk to the new home (no lane, no fanfare); someone inside the same building stays posed
      if (!silent) {
        const stay = v._loc === 'in' && prevHome && v.homeId && prevHome === v.homeId;
        if (!stay) {
          endActivity(v); v._steps = []; v._act = null;
          if (v.plan.kind === 'pose' || v.plan.kind === 'inside') cutPlan(v);
        }
      }
      // still posed inside the same home with a different bed (or none), or resident ↔ waiting there: book the indoor
      // place again now, so a sleeper moves to the new bed (or a sofa / bedroll) instead of lying where the old bed was
      // until morning, and goes back to their own bed when it is theirs again (pointed at it first)
      if (v._loc === 'in' && v.plan?.kind === 'inside' && prevHome && v.homeId === prevHome && (v.bed !== prevBed || v.status !== prev)) {
        const hb = B(v.homeId);
        if (hb) {
          if (v.plan._kind === 'sleep' && (v.status === 'resident' || v.status === 'waiting') && v.bed) { const [, x, y, z] = v.bed.split('|'); v.plan._spot = `bed|${x}|${y}|${z}`; }
          recheckInside(v, hb);
        }
      }
    }
    if (tentsChanged) updateTents();
    if (!silent && list.length) emit('status', { changes: list });
    refreshHomes();
    charm = computeCharm();
    refreshCozy();
    return list;
  }
  function updateTents() {
    const n = villagers.filter((u) => u.status === 'camping').length;
    const want = Math.ceil(n / 2);
    const steps = new Set();
    if (world) for (const b of world.buildings) for (const d of b.doors) steps.add(d.step[0] * 64 + d.step[1]);
    const cells = CAMP_CELLS.filter(([x, z]) => !steps.has(x * 64 + z)).slice(0, want);
    const changed = cells.length !== tentCells.length || cells.some((c, k) => c[0] !== tentCells[k][0] || c[1] !== tentCells[k][1]);
    tentCells = cells;
    if (changed) emit('camp', { tents: tentCells.map((c) => [c[0], c[1]]) });
  }

  // ------------------------------------------------------------------------------------------ plans & steps
  function setPlan(v, plan) {
    v.plan = plan; v.planId++;
    v._cueSched = plan._cues || [];
  }
  function endActivity(v) {
    release(v);
    v.flags.tool = false; v.flags.basket = false; v.flags.book = false;
  }
  function posNow(v) {
    const p = v.plan, t = st.clock;
    if (!p || p.kind === 'gone') return v._pos || (v._cell ? cellCentre(v._cell) : null);
    if (p.kind === 'walk') {
      const f = p.t1 > p.t0 ? clamp((t - p.t0) / (p.t1 - p.t0), 0, 1) : 1;
      return pointAlong(p.pts, p.len * f);
    }
    if (p.kind === 'hop' || p.kind === 'slip') return t >= p.t1 ? p.to : p.from;
    if (p.kind === 'pose') return p.ground || p.at;
    return p.at;
  }
  function pointAlong(pts, d) {
    const n = pts.length / 3;
    let acc = 0;
    for (let k = 1; k < n; k++) {
      const ax = pts[(k - 1) * 3], az = pts[(k - 1) * 3 + 2], bx = pts[k * 3], bz = pts[k * 3 + 2];
      const L = Math.hypot(bx - ax, bz - az);
      if (acc + L >= d && L > 0) { const f = (d - acc) / L; return [ax + (bx - ax) * f, pts[(k - 1) * 3 + 1] + (pts[k * 3 + 1] - pts[(k - 1) * 3 + 1]) * f, az + (bz - az) * f]; }
      acc += L;
    }
    return [pts[(n - 1) * 3], pts[(n - 1) * 3 + 1], pts[(n - 1) * 3 + 2]];
  }
  const cellOfPos = (p) => [clamp(Math.floor(p[0] / CELL), -11, 10), clamp(Math.floor(p[2] / CELL), -11, 10)];

  /** Start one step → a plan (or null to skip, or 'defer' when the path budget is spent this tick). */
  let stepT0 = null;                                   // when the step starts: the end of the plan before it (chained)
  function startStep(v, s) {
    const t0 = stepT0 ?? st.clock;
    switch (s.k) {
      case 'call': s.fn(v); return null;
      case 'walk': {
        if (!world) return null;
        if (pathBudget <= 0) return 'defer';
        const from = v._cell || cellOfPos(v._pos || [0, 0, 0]);
        let to = s.to;
        // a doorstep is looked up again now (the world may have changed since the trip was planned)
        if (s.door) {
          const b = B(s.door), du = b && doorUse(b);
          if (du) { to = du.step; if (!du.back) { s.end = du.stand; const nx = v._steps[0]; if (nx && nx.k === 'door') { nx.at = du.stand; nx.face = du.face; } } }
        }
        if (!world.nav.inMain(to[0], to[1])) {
          // the target was built over or walled off since the trip was planned
          if (v.status === 'traveller' || v.status === 'passerby') { const f = world.nav.nearestFree(to[0], to[1], 4, true); if (f) { to = f; s.end = null; } }
          else { v._steps = []; return null; }
        }
        // the place this walk goes to is booked as it starts (a doorstep pose takes its free slot now); a place another
        // villager holds is never shared: this stop is dropped and the next step (or a fresh plan) takes over (R4 T4.4)
        const nx = v._steps[0];
        if (nx && nx.k === 'pose' && (nx.spot || nx.slot)) {
          if (!claimPose(v, nx)) { while (v._steps.length && v._steps[0].k === 'pose') v._steps.shift(); return null; }
          if (nx.slot) s.end = nx.at;
        }
        const here = v._pos || cellCentre(from);
        if (from[0] === to[0] && from[1] === to[1] && !s.end) return null;
        pathBudget--;
        const p = world.nav.path(from, to, hash32(st.seed, v.seed, tickN, 'lane'));
        const raw = Array.from(p.pts);
        // start exactly where the villager stands
        if (Math.hypot(raw[0] - here[0], raw[2] - here[2]) > 0.05) raw.unshift(here[0], here[1], here[2]);
        if (s.end) raw.push(s.end[0], s.end[1], s.end[2]);
        if (s.pre) raw.unshift(...s.pre.flat());
        const pts = new Float32Array(raw);
        let len = 0;
        for (let k = 3; k < pts.length; k += 3) len += Math.hypot(pts[k] - pts[k - 3], pts[k + 2] - pts[k - 1]);
        const shift = (raw.length - p.pts.length) / 3 - (s.end ? 1 : 0);
        const hops = p.hops.map((h) => h + shift), sl = p.slips.map((h) => h + shift);
        slips += sl.length;
        if (sl.length && sim.debug._slipLog) sim.debug._slipLog.push({ id: v.id, from, to, inMainFrom: world.nav.inMain(from[0], from[1]), inMainTo: world.nav.inMain(to[0], to[1]), act: v._act });
        let speed = s.speed || TUNE.WALK_SPEED;
        if (s.hurry) speed *= TUNE.HURRY;
        let dur = len / speed;
        if (s.maxT && dur > s.maxT) {
          // walk maxT seconds, then slip the rest of the way (§5.4: far from home at night)
          const cut = pointAlong(pts, speed * s.maxT);
          const walk = { kind: 'walk', pts: truncate(pts, speed * s.maxT), len: speed * s.maxT, t0, t1: t0 + s.maxT, hops: hops.filter((h) => h < 1e9), slips: [], hurry: !!s.hurry };
          v._cell = to;
          v._pos = s.end ? [s.end[0], s.end[1], s.end[2]] : cellCentre(to);
          v._steps.unshift({ k: 'slip', from: cut, to: v._pos.slice() });
          return walk;
        }
        v._cell = [to[0], to[1]];
        v._pos = [pts[pts.length - 3], pts[pts.length - 2], pts[pts.length - 1]];
        v._loc = s.lane ? 'lane' : 'out';
        return { kind: 'walk', pts, len, t0, t1: t0 + Math.max(0.05, dur), hops, slips: sl, hurry: !!s.hurry, _cells: p.cells, _to: to };
      }
      case 'lane': {
        // a fixed polyline (lane, passer-by route): no nav
        const pts = new Float32Array(s.pts.flat());
        let len = 0;
        for (let k = 3; k < pts.length; k += 3) len += Math.hypot(pts[k] - pts[k - 3], pts[k + 2] - pts[k - 1]);
        const speed = s.speed || TUNE.TRAVELLER_SPEED;
        v._pos = [pts[pts.length - 3], pts[pts.length - 2], pts[pts.length - 1]];
        v._cell = s.cell || cellOfPos(v._pos);
        v._loc = s.onLot ? 'out' : 'lane';
        return { kind: 'walk', pts, len, t0, t1: t0 + Math.max(0.05, len / speed), hops: [], slips: [], hurry: false };
      }
      case 'pose': {
        if ((s.spot || s.slot) && !claimPose(v, s)) return null;     // its place is someone else's now: skip it
        const dur = s.dur ?? 5;
        const plan = { kind: 'pose', at: s.at, face: s.face ?? 0, pose: s.pose || 'stand', t0, t1: dur === Infinity ? Infinity : t0 + dur, level: 0 };
        if (s.ground) plan.ground = s.ground;
        if (s.piece) plan.piece = s.piece;
        plan._cues = (s.cues || []).map((c) => ({ ...c, next: t0 + (c.first ?? c.every ?? 0) }));
        if (s.flags) Object.assign(v.flags, s.flags);
        v._pos = s.ground || [s.at[0], surfaceAt(s.at[0], s.at[2]), s.at[2]];
        if (s.cell) v._cell = s.cell;
        if (v._loc !== 'lane') v._loc = 'out';
        return plan;
      }
      case 'door': {
        const plan = { kind: 'door', at: s.at, face: s.face, dir: s.dir, t0, t1: t0 + 0.4 };
        if (s.dir === 'out') { v._loc = 'out'; v._cell = s.cell; v._pos = s.at.slice(); }
        else { v._loc = 'in'; v._inHome = s.homeId; }
        return plan;
      }
      case 'inside': {
        if (s.spot) claimInside(v, s);                   // its place, else another free one (R5 T5.1)
        else release(v);                                 // a step that names no place: the one left behind is let go
        v._loc = 'in'; v._inHome = s.homeId;
        // _kind / _rec / _spot: the place it stands for, so a recompute can check it is still there (recheckInside)
        return { kind: 'inside', homeId: s.homeId, level: s.level | 0, at: s.at, face: s.face ?? 0, pose: s.pose || 'stand', t0, t1: s.dur === Infinity ? Infinity : t0 + (s.dur ?? 30),
          _kind: s.kind || null, _rec: s.rec || null, _spot: s.spot || null };
      }
      case 'hop': {
        const to = cellCentre(s.to);
        const from = posNow(v) || to;
        v._cell = [s.to[0], s.to[1]]; v._pos = to; v._loc = 'out';
        cue('puff', { id: v.id, at: to });
        return { kind: 'hop', from, to, t0, t1: t0 + 0.35 };
      }
      case 'slip': {
        const to = s.to.length === 3 ? s.to : cellCentre(s.to);
        const from = s.from || posNow(v) || to;
        if (s.to.length === 2) v._cell = [s.to[0], s.to[1]];
        v._pos = to.slice();
        cue('puff', { id: v.id, at: to });
        return { kind: 'slip', from, to, t0, t1: t0 + 0.5 };
      }
      case 'gone': return { kind: 'gone' };
      default: return null;
    }
  }
  function truncate(pts, d) {
    const out = [pts[0], pts[1], pts[2]];
    let acc = 0;
    for (let k = 3; k < pts.length; k += 3) {
      const L = Math.hypot(pts[k] - pts[k - 3], pts[k + 2] - pts[k - 1]);
      if (acc + L >= d) { const f = L ? (d - acc) / L : 1; out.push(pts[k - 3] + (pts[k] - pts[k - 3]) * f, pts[k - 2] + (pts[k + 1] - pts[k - 2]) * f, pts[k - 1] + (pts[k + 2] - pts[k - 1]) * f); return new Float32Array(out); }
      out.push(pts[k], pts[k + 1], pts[k + 2]);
      acc += L;
    }
    return new Float32Array(out);
  }
  /** Advance v to its next plan (when the current one ended). Returns false if deferred. */
  function advance(v) {
    // chain: a step starts exactly when the previous plan ended (within the last tick), so walks and beats line up
    const p = v.plan;
    stepT0 = p && p.kind !== 'gone' && Number.isFinite(p.t1) && p.t1 <= st.clock && st.clock - p.t1 <= TICK + 1e-9 ? p.t1 : st.clock;
    try { return advanceInner(v); } finally { stepT0 = null; }
  }
  function advanceInner(v) {
    for (let guard = 0; guard < 12; guard++) {
      if (!v._steps.length) planActivity(v);
      const s = v._steps.shift();
      if (!s) { setPlan(v, { kind: 'pose', at: v._pos || [0, 0, 0], face: 0, pose: 'stand', t0: st.clock, t1: st.clock + 2, level: 0 }); return true; }
      const plan = startStep(v, s);
      if (plan === 'defer') { v._steps.unshift(s); v._deferred = true; return false; }
      if (plan) { v._deferred = false; setPlan(v, plan); return true; }
    }
    setPlan(v, { kind: 'pose', at: v._pos || [0, 0, 0], face: 0, pose: 'stand', t0: st.clock, t1: st.clock + 2, level: 0 });
    return true;
  }

  /** End the current plan where the villager stands now and start the next step at once (no snapping). */
  function cutPlan(v) {
    const pos = posNow(v);
    if (pos && (v._loc === 'out' || v._loc === 'lane')) { v._pos = [pos[0], pos[1], pos[2]]; if (v._loc === 'out') v._cell = cellOfPos(pos); }
    if (!advance(v)) setPlan(v, { kind: 'pose', at: v._pos || pos || [0, 0, 0], face: 0, pose: 'stand', t0: st.clock, t1: st.clock + TICK, level: 0 });
  }

  // ------------------------------------------------------------------------------------------ places a villager uses
  /** The building a villager calls home right now (a Home, a waiting building, or null for campers). */
  const homeB = (v) => (v.homeId ? B(v.homeId) : null);
  function tentOf(v) {
    const campers = villagers.filter((u) => u.status === 'camping');
    const k = campers.indexOf(v);
    return tentCells[Math.floor(Math.max(0, k) / 2)] || CAMP_CELLS[0];
  }
  /** Usable door of a building: { door, step, stand, face } (a free doorstep in mainRegion, else round the back). */
  function doorUse(b) {
    if (!b || !world) return null;
    const nav = world.nav;
    const doors = [mainDoor(b), ...b.doors.filter((d) => !d.main)].filter(Boolean);
    for (const d of doors) {
      if (nav.inMain(d.step[0], d.step[1])) {
        const stand = doorStandPoint(d, nav);
        return { door: d, step: d.step, stand, face: Math.atan2(-d.out[0], -d.out[1]), out: Math.atan2(d.out[0], d.out[1]), climb: b.lo > 0 };
      }
    }
    // round the back: the nearest reachable cell beside the foot
    for (const [x, z] of b.foot) for (const [dx, dz] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
      if (nav.inMain(x + dx, z + dz) && !b.cells.has(ck(x + dx, b.lo, z + dz))) {
        const c = nav.centre(x + dx, z + dz);
        return { door: null, step: [x + dx, z + dz], stand: c, face: Math.atan2(-dx, -dz), out: Math.atan2(dx, dz), back: true };
      }
    }
    return null;
  }
  function exitSteps(v) {
    if (v._loc !== 'in') return [];
    const b = B(v._inHome) || homeB(v);
    const du = doorUse(b);
    if (!du) {
      const c = world ? world.nav.nearestFree(0, 0, 11, true) : [0, 0];
      return [{ k: 'slip', to: c || [0, 0] }];
    }
    if (du.back) return [{ k: 'slip', to: du.step }];
    return [{ k: 'door', dir: 'out', at: du.stand, face: du.out, cell: du.step }];
  }
  function enterSteps(v, b, then) {
    const du = doorUse(b);
    if (!du) return [{ k: 'call', fn: () => {} }, ...then];
    if (du.back) return [{ k: 'walk', to: du.step }, { k: 'slip', to: insideSpot(v, b, 'stand').at }, ...then];
    return [{ k: 'walk', to: du.step, end: du.stand, door: b.id }, { k: 'door', dir: 'in', at: du.stand, face: du.face, homeId: b.id }, ...then];
  }
  /** Indoor place (§5.7, R5 T5.1). kind: 'sleep' | 'sit' | 'stand' | 'by' (beside a record). → { at, face, level, pose,
   *  spot }: the first place free for v (placeFree: no housemate holds it or a body near it), so housemates never share
   *  an armchair, a stand by the range or the middle of the floor. A resident sleeps in their own bed (never shared, so
   *  always theirs). Seats, then a stand in front of a range / desk / fireplace / stove (three side by side), then the
   *  free floor: the foot cells nearest the middle that hold no bed or other furniture, five stands a cell (a bedroll
   *  takes the middle or a side); when all of those are taken, the edge of one's own bed; else the middle, holding
   *  nothing (spot null). Pure: it books nothing (insideStep's step is booked by claimInside). want (a place key): that
   *  place as it stands in the world now, free or not, else null (recheckInside, R6 T6.2). */
  const BY_SLOTS = [0, -0.55, 0.55];                   // m sideways, 0.75 m in front of the piece
  const FLOOR_SLOTS = [[0, 0], [0.6, 0], [-0.6, 0], [0, 0.6], [0, -0.6]];
  const LIE_SLOTS = [[0, 0], [0.6, 0], [-0.6, 0]];     // bedrolls side by side, bodies along z
  function insideSpot(v, b, kind, rec = null, want = null) {
    const ix = world.index;
    const fy = (x, y, z) => (y > 0 ? levelY(y) : ix.F.get(ck(x, 0, z)) ? levelY(0) : 0);
    const free = want ? (sp) => sp.spot === want : (sp) => placeFree(sp.spot, sp.at, v, sp.pose === 'sleep' ? sp.face : null);
    const bedOf = (strict) => {
      if (!v.bed) return null;
      const [, x, y, z] = v.bed.split('|').map(Number);
      const bed = ix.I.get(ck(x, y, z));
      // only a real bed: a tap of another piece on the bed replaces it in one edit (the sleeper is booked again)
      return bed && bed.t === 'bed' && (!strict || b.cells.has(ck(x, y, z))) ? { bed, x, y, z } : null;
    };
    // a resident sleeps in their own bed; so does one waiting for their home to be put right (their bed is still
    // theirs), but only when that bed is inside the building they wait in: a bed upstairs in a roofless farmhouse's
    // shell is not, and a sleeper posed outside every building is walked out by the next edit anywhere
    if (kind === 'sleep' && (v.status === 'resident' || v.status === 'waiting')) {
      const o = bedOf(v.status === 'waiting');
      if (o) {
        const r = o.bed.r | 0;
        const [wx, wz] = localToWorld(o.x, o.z, r, 0, -0.10);
        const sp = { at: [wx, fy(o.x, o.y, o.z) + 0.62, wz], face: ((r + 2) & 3) * Math.PI / 2, level: o.y, pose: 'sleep', spot: `bed|${o.x}|${o.y}|${o.z}` };
        if (!want || free(sp)) return sp;
      }
    }
    const inB = (p) => b.cells.has(ck(p.x, p.y, p.z));
    const items = ix.items.filter(inB);
    const byPlace = (p) => {
      const r = (p.r | 0) & 3, face = Math.atan2(-Math.sin(r * Math.PI / 2), -Math.cos(r * Math.PI / 2));
      for (let k = 0; k < BY_SLOTS.length; k++) {
        const [wx, wz] = localToWorld(p.x, p.z, r, BY_SLOTS[k], 0.75);
        const sp = { at: [wx, fy(p.x, p.y, p.z), wz], face, level: p.y | 0, pose: 'stand', spot: `by|${p.x}|${p.y | 0}|${p.z}|${k}` };
        if (free(sp)) return sp;
      }
      return null;
    };
    if (kind === 'by' && rec) { const sp = byPlace(rec); if (sp) return sp; }
    if (kind === 'sleep' || kind === 'sit') {
      const seats = [];
      for (const p of items) {
        if (p.t === 'sofa') { seats.push([p, -0.4]); seats.push([p, 0.4]); }
        else if (p.t === 'armchair' || p.t === 'rocking_chair' || p.t === 'chair') seats.push([p, 0]);
      }
      if (kind === 'sleep') { for (const p of items) if (p.t === 'rug' || p.t === 'rug_round') seats.push([p, 0, 'rug']); }
      seats.sort((a, c) => (a[0].t === 'sofa' || a[0].t === 'armchair' ? 0 : 1) - (c[0].t === 'sofa' || c[0].t === 'armchair' ? 0 : 1) || ci(a[0].x, a[0].z) - ci(c[0].x, c[0].z) || a[1] - c[1]);
      const sleep = kind === 'sleep';
      const itemAt = (x, y, z) => ix.I.get(ck(x, y, z)) || null;
      for (const [p, lx, rug] of seats) {
        // asleep on a sofa: lying along it (head toward its local +X), centred on the whole sofa. A dining chair's seat
        // is drawn tucked up to the table in front of it (config.js CHAIR_SEAT_Z): sit there, not at the cell's middle
        const along = sleep && p.t === 'sofa';
        const lz = along ? -0.05 : p.t === 'chair' ? CHAIR_SEAT_Z[chairTuck(p, itemAt)] : 0;
        const [wx, wz] = localToWorld(p.x, p.z, p.r | 0, along ? 0 : lx, lz);
        const yaw = ((p.r | 0) & 3) * Math.PI / 2 + (along ? Math.PI / 2 : 0);
        const sp = { at: [wx, fy(p.x, p.y, p.z) + (rug ? 0.1 : 0.45), wz], face: yaw, level: p.y | 0, pose: sleep ? 'sleep' : 'sit', spot: `seat|${p.t}|${p.x}|${p.y | 0}|${p.z}|${along ? 'along' : lx}` };
        if (free(sp)) return sp;
      }
    }
    if (kind !== 'sleep') {
      // standing in front of a range (the Baker always), desk or fireplace / stove
      const pref = v.job === 'baker' ? ['kitchen_range'] : ['kitchen_range', 'desk', 'fireplace', 'wood_stove'];
      for (const t of pref) for (const p of items) if (p.t === t && p !== rec) { const sp = byPlace(p); if (sp) return sp; }
    }
    // the free floor, nearest the middle first: never a cell with a bed or other furniture on it
    const lo = b.lo | 0, mid = centrePoint(b);
    const cells = b.foot.filter(([x, z]) => b.cells.has(ck(x, lo, z)) && !ix.I.has(ck(x, lo, z)))
      .sort((p, q) => Math.hypot(p[0] + 0.5 - mid[0], p[1] + 0.5 - mid[1]) - Math.hypot(q[0] + 0.5 - mid[0], q[1] + 0.5 - mid[1]) || ci(p[0], p[1]) - ci(q[0], q[1]));
    const sleep = kind === 'sleep';
    for (const [x, z] of cells) {
      const cx = (x + 0.5) * CELL, cz = (z + 0.5) * CELL, y = fy(x, lo, z);
      const slots = sleep ? LIE_SLOTS : FLOOR_SLOTS;
      for (let k = 0; k < slots.length; k++) {
        const [ox, oz] = slots[k];
        const face = sleep || (!ox && !oz) ? 0 : yawTo(ox, oz, 0, 0);
        const sp = { at: [cx + ox, y + (sleep ? 0.1 : 0), cz + oz], face, level: lo, pose: sleep ? 'sleep' : 'stand', spot: `floor|${x}|${lo}|${z}|${sleep ? 'lie' : ''}${k}` };
        if (free(sp)) return sp;
      }
    }
    // nothing free (every floor cell furnished): awake, on the edge of one's own bed, facing out of its side
    const o = kind !== 'sleep' && v.status === 'resident' && bedOf(true);
    if (o) {
      const r = o.bed.r | 0;
      for (const sd of [0.6, -0.6]) {
        const [wx, wz] = localToWorld(o.x, o.z, r, sd, 0.25);
        const sp = { at: [wx, fy(o.x, o.y, o.z) + 0.5, wz], face: ((r + (sd > 0 ? 1 : 3)) & 3) * Math.PI / 2, level: o.y, pose: 'sit', spot: `bedside|${o.x}|${o.y}|${o.z}|${sd > 0 ? 1 : 0}` };
        if (free(sp)) return sp;
      }
    }
    if (want) return null;
    const c = centreCell(b);
    return { at: [(c[0] + 0.5) * CELL, fy(c[0], lo, c[1]) + (sleep ? 0.1 : 0), (c[1] + 0.5) * CELL], face: 0, level: lo, pose: sleep ? 'sleep' : 'stand', spot: null };
  }
  /** The building whose cells hold the indoor spot the villager is posed at (ids can change between recomputes). */
  function buildingAt(v) {
    const p = v.plan;
    if (!world) return null;
    const known = B(v._inHome);
    if (!p || (p.kind !== 'inside' && p.kind !== 'door')) return known;
    const lv = p.kind === 'inside' ? (p.level | 0) : (known ? known.lo : 0);
    const k = ck(Math.floor(p.at[0] / CELL), lv, Math.floor(p.at[2] / CELL));
    return world.buildings.find((b) => b.cells.has(k)) || (known && p.kind === 'door' ? known : null);
  }
  /** The middle of a building's FOOT, in cell units (cell x + 0.5). */
  function centrePoint(b) {
    const f = b.foot;
    return [f.reduce((a, c) => a + c[0], 0) / f.length + 0.5, f.reduce((a, c) => a + c[1], 0) / f.length + 0.5];
  }
  function centreCell(b) {
    const f = b.foot;
    const mx = f.reduce((a, c) => a + c[0], 0) / f.length, mz = f.reduce((a, c) => a + c[1], 0) / f.length;
    let best = f[0], bd = Infinity;
    for (const c of f) { const d = Math.hypot(c[0] - mx, c[1] - mz); if (d < bd) { bd = d; best = c; } }
    return best;
  }
  /** An indoor step at a free place of `kind` (insideSpot). It names its place (`spot`), so it is booked as the plan is
   *  made when it is the plan's first place, and as it starts (claimInside, which moves it to another free place of the
   *  same kind when its own was taken meanwhile). */
  function insideStep(v, b, kind, dur, rec = null) {
    const s = insideSpot(v, b, kind, rec);
    return { k: 'inside', homeId: b.id, pose: s.pose === 'sleep' ? 'sleep' : s.pose === 'sit' ? 'sit' : 'stand', at: s.at, face: s.face, level: s.level, dur, spot: s.spot, kind, rec };
  }
  /** A standing spot beside a record (free neighbour cell in mainRegion nearest the villager), facing it. */
  function standBy(v, p, pose = 'stand') {
    if (!world) return null;
    const nav = world.nav;
    const from = v._cell || [0, 0];
    const tx = (p.x + 0.5) * CELL, tz = (p.z + 0.5) * CELL;
    const spotAt = (x, z) => { const [cxw, , czw] = nav.centre(x, z); return [cxw + (tx - cxw) * 0.2, nav.surface[ci(x, z)], czw + (tz - czw) * 0.2]; };
    let best = null, bd = Infinity;
    for (const [dx, dz] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
      const x = p.x + dx, z = p.z + dz;
      if (!nav.inMain(x, z)) continue;
      if (!placeFree(`cell|${x}|${z}`, spotAt(x, z), v)) continue;
      const d = Math.abs(x - from[0]) + Math.abs(z - from[1]) + (dz === 1 ? -0.1 : 0);
      if (d < bd) { bd = d; best = [x, z]; }
    }
    if (!best) return null;
    const at = spotAt(best[0], best[1]);
    return { cell: best, at, face: yawTo(at[0], at[2], tx, tz), pose, spot: `cell|${best[0]}|${best[1]}` };
  }
  const gotoPose = (sp, pose, dur, extra = {}) => [
    { k: 'walk', to: sp.cell, end: sp.ground || sp.at, hurry: extra.hurry, speed: extra.speed },
    { k: 'pose', pose: pose || sp.pose, at: sp.at, face: sp.face, dur, cell: sp.cell, spot: sp.spot, ground: sp.ground, cues: extra.cues, flags: extra.flags, piece: extra.piece },
  ];
  const outItems = () => world.index.items.filter((p) => (p.y | 0) === 0 && !inside.has(ck(p.x, 0, p.z)));
  const within = (recs, cells, R) => recs.filter((p) => dist(p.x, p.z, cells) <= R);
  const dur = (v, key, tag) => { const [a, b] = TUNE.DUR[key]; const r = R(v, tag || key); return range(r, a, b) * (1 + (r() * 2 - 1) * TUNE.DUR_JITTER * 0.5); };
  // ---- places held (§5.5, §6.5, R3 T3.3, R4 T4.4, R5 T5.1/T5.2): a villager holds one place at a time, outdoors or
  // indoors (v._spot, its key; v._spotAt, its point; v._spotLie, the face of a lying body or null), booked when the
  // plan is made and again as the step that uses it starts. A place is free when no other villager holds its key and
  // no other villager's held body comes within SPOT_GAP of it (a standing or seated body is its point, a lying one the
  // segment LIE_HALF either side of its centre along its face), so two keys that name one point (a doorstep, a seat's
  // approach, a cell centre) can never put two villagers on it, and nobody is booked onto a sleeper: two figures posed
  // on one spot are drawn as one, with two hats
  const SPOT_GAP = 0.45;                               // m; the nearest two seats of one piece are 0.6 m apart
  const LIE_HALF = 0.55;                               // m; half a lying body, measured from its centre
  const spotPoint = (sp) => sp.ground || sp.at;
  /** The villager who holds a key; a stale entry (its holder gone, or holding another place now) is dropped. */
  function holderOf(key) {
    const id = reserved.get(key);
    if (!id) return null;
    const u = villagers.find((x) => x.id === id);
    if (u && u._spot === key) return u;
    reserved.delete(key);
    return null;
  }
  /** Ground-plane gap between two held bodies: a point (lie null) or a lying body (lie = its face). */
  function bodyGap(p, pl, q, ql) {
    if (pl == null && ql == null) return Math.hypot(p[0] - q[0], p[2] - q[2]);
    const seg = (c, f) => (f == null ? [c[0], c[2], c[0], c[2]] : [c[0] - Math.sin(f) * LIE_HALF, c[2] - Math.cos(f) * LIE_HALF, c[0] + Math.sin(f) * LIE_HALF, c[2] + Math.cos(f) * LIE_HALF]);
    const A = seg(p, pl), Bs = seg(q, ql);
    const ps = (x, z, s) => {
      const dx = s[2] - s[0], dz = s[3] - s[1], L = dx * dx + dz * dz;
      const t = L ? clamp(((x - s[0]) * dx + (z - s[1]) * dz) / L, 0, 1) : 0;
      return Math.hypot(x - s[0] - t * dx, z - s[1] - t * dz);
    };
    return Math.min(ps(A[0], A[1], Bs), ps(A[2], A[3], Bs), ps(Bs[0], Bs[1], A), ps(Bs[2], Bs[3], A));
  }
  /** Is a place (key, point, lying face or null) free for v (null: for anyone)? */
  function placeFree(key, at, v = null, lie = null) {
    const h = key ? holderOf(key) : null;
    if (h && h !== v) return false;
    if (!at) return true;
    for (const u of villagers) {
      const p = u._spotAt;
      if (u === v || !p || !u._spot) continue;
      const ul = u._spotLie ?? null, reach = SPOT_GAP + (lie != null ? LIE_HALF : 0) + (ul != null ? LIE_HALF : 0);
      if (Math.abs(p[0] - at[0]) < reach && Math.abs(p[2] - at[2]) < reach && Math.abs((p[1] || 0) - (at[1] || 0)) < 1
        && bodyGap(at, lie, p, ul) < SPOT_GAP) return false;
    }
    return true;
  }
  /** v holds a place (and lets go of the one it held); false, changing nothing, when the place is not free. */
  function hold(v, key, at, lie = null) {
    if (!placeFree(key, at, v, lie)) return false;
    if (v._spot && v._spot !== key && reserved.get(v._spot) === v.id) reserved.delete(v._spot);
    reserved.set(key, v.id); v._spot = key; v._spotAt = at ? [at[0], at[1] || 0, at[2]] : null; v._spotLie = at ? lie : null;
    return true;
  }
  function release(v) {
    if (v._spot && reserved.get(v._spot) === v.id) reserved.delete(v._spot);
    v._spot = null; v._spotAt = null; v._spotLie = null;
  }
  /** Book a pose step's place for v. A doorstep pose (`slot`: a doorUse) takes a free door slot now, and the step is
   *  moved onto it; `slot0` keeps it to the stand point itself (sweeping). A lying pose holds its whole body. An indoor
   *  step is claimInside's. false: the place is taken. */
  function claimPose(v, s) {
    if (s.k === 'inside') return claimInside(v, s);
    if (s.slot && !s.spot) {
      const sl = doorSlot(v, s.slot, !!s.slot0);
      if (!sl) return false;
      s.at = sl.at; s.spot = sl.spot; s.ground = null;
      return true;
    }
    if (!s.spot) return true;
    return hold(v, s.spot, s.ground || s.at, s.pose === 'lie' ? s.face : null);
  }
  /** Book an indoor step's place for v (R5 T5.1): its own place while it is still there and free, else a fresh free
   *  place of the same kind in the same building (the step moves there). Its place is looked up in the world as it
   *  stands now (R6 T6.2: the step may have been planned before the player furnished its floor cell, took its seat
   *  away or set a table before its chair, which moves the chair's seat). Indoor steps always run: when nothing is
   *  free (a bed whose body someone stands too near, a crammed home) the villager poses there holding nothing. */
  function claimInside(v, s) {
    if (!s.spot) return true;
    const lie = (sp) => (sp.pose === 'sleep' ? sp.face : null);
    const b = world && s.kind ? B(s.homeId) : null;
    if (!b) {
      if (hold(v, s.spot, s.at, lie(s))) return true;
      release(v);
      return false;
    }
    s.rec = liveRec(s.rec);
    const now = insideSpot(v, b, s.kind, s.rec, s.spot);
    if (now) {
      Object.assign(s, { at: now.at, face: now.face, level: now.level, pose: now.pose });
      if (hold(v, s.spot, s.at, lie(s))) return true;
    }
    const r = insideSpot(v, b, s.kind, s.rec);
    if (r.spot && r.spot !== s.spot && hold(v, r.spot, r.at, lie(r))) {
      Object.assign(s, { at: r.at, face: r.face, level: r.level, pose: r.pose, spot: r.spot });
      return true;
    }
    // nothing free: pose holding nothing, at its own place while it is still there, else where insideSpot says
    if (!now) Object.assign(s, { at: r.at, face: r.face, level: r.level, pose: r.pose, spot: r.spot });
    release(v);
    return false;
  }
  /** A record a step was planned for, as the world holds it now (the same piece in its cell), else null. */
  function liveRec(rec) {
    if (!rec || !world) return null;
    const ix = world.index, k = ck(rec.x, rec.y | 0, rec.z), q = ix.I.get(k) || ix.D.get(k);
    return q && q.t === rec.t ? q : null;
  }
  /** After a recompute (R6 T6.2): a villager posed indoors whose place is gone or has moved (its floor cell furnished,
   *  its seat, bed or piece removed or turned, a table set before its chair) is booked again at once (claimInside: the
   *  same place where it now is, else another free place of its kind) and the actor eases there. A place unchanged in
   *  the world is left alone. So furnishing a home never leaves a housemate standing inside the new piece. */
  function recheckInside(v, b) {
    const p = v.plan;
    if (!p || p.kind !== 'inside' || !p._kind || !p._spot || !b) return;
    const rec = liveRec(p._rec);
    const now = insideSpot(v, b, p._kind, rec, p._spot);
    const off = (a) => Math.abs(a[0] - p.at[0]) > 0.02 || Math.abs(a[1] - p.at[1]) > 0.02 || Math.abs(a[2] - p.at[2]) > 0.02;
    if (now && !off(now.at) && (now.level | 0) === (p.level | 0)) { p._rec = rec; return; }
    const s = { k: 'inside', homeId: b.id, kind: p._kind, rec, spot: p._spot, at: p.at, face: p.face, level: p.level, pose: p.pose };
    claimInside(v, s);
    setPlan(v, { ...p, homeId: b.id, level: s.level | 0, at: s.at, face: s.face ?? 0, pose: s.pose === 'sleep' ? 'sleep' : s.pose === 'sit' ? 'sit' : 'stand', _rec: s.rec, _spot: s.spot || null });
  }
  const freeSpot = (s) => placeFree(s.id, spotPoint(s));
  const seatSpot = (v, spots) => spots.filter(freeSpot).sort((a, b) => dist(a.approach[0], a.approach[1], [v._cell || [0, 0]]) - dist(b.approach[0], b.approach[1], [v._cell || [0, 0]]) || (a.id < b.id ? -1 : 1))[0] || null;
  /** A place to stand a while on a home's doorstep: the door's stand point, else beside it or a step further out on
   *  the same doorstep cell. Every doorstep pose takes one (lunch, a door chat, sweeping, the porch's door spot, the
   *  postie's and the baker's knock, a sweet tooth admiring the baker's door, the wave after a move-in), so two of
   *  them never share the stand point and fuse into one figure (R3 T3.3, R4 T4.4). Held at once: two housemates often
   *  plan in the same second. only0: the stand point or nothing. → { at, spot }, or null when all are taken */
  const DOOR_SLOTS = [[0, 0], [0.7, 0], [-0.7, 0], [0.35, 0.8], [-0.35, 0.8]];   // [sideways, further out] m
  function doorSlot(v, du, only0 = false) {
    if (!du || !world) return null;
    const ox = Math.sin(du.out), oz = Math.cos(du.out);
    for (let k = 0; k < (only0 ? 1 : DOOR_SLOTS.length); k++) {
      const [sd, fw] = DOOR_SLOTS[k];
      const at = [du.stand[0] - oz * sd + ox * fw, du.stand[1], du.stand[2] + ox * sd + oz * fw];
      const spot = `stand|${du.step[0]}|${du.step[1]}|${k}`;
      if (hold(v, spot, at)) return { at, spot };
    }
    return null;
  }
  /** A doorstep pose whose slot is taken when its walk starts (rounds and other plans with several stops). */
  const doorPose = (du, pose, face, dur, extra = {}) => ({ k: 'pose', pose, at: du.stand, face, dur, cell: du.step, slot: du, ...extra });
  const spotSteps = (sp, dur, pose, extra = {}) => [
    { k: 'walk', to: sp.approach, end: sp.ground || [sp.at[0], surfaceAt(sp.at[0], sp.at[2]), sp.at[2]], hurry: extra.hurry },
    { k: 'pose', pose: pose || sp.pose, at: sp.at, face: sp.face, dur, cell: sp.approach, spot: sp.id, ground: sp.ground || [sp.at[0], surfaceAt(sp.at[0], sp.at[2]), sp.at[2]], cues: extra.cues, flags: extra.flags },
  ];

  // ------------------------------------------------------------------------------------------ activities (§5.3, §2.2)
  function anchorCells(v) {
    const b = homeB(v);
    if (b) return b.foot;
    if (v.status === 'camping') return [tentOf(v)];
    return [v._cell || [0, 0]];
  }
  function homeDoorCell(v) {
    const b = homeB(v);
    const du = doorUse(b);
    if (du) return du.step;
    if (v.status === 'camping') { const t = tentOf(v); return [t[0] + 1 > 10 ? t[0] : t[0] + 1, t[1]]; }
    return v._cell || [0, 0];
  }

  /** Fill v._steps with the next activity, and book its first place at once (R4 T4.4): villagers who plan within one
   *  exit window each see the places the others have just picked. The first place is the first pose outdoors or the
   *  first indoor step (R5 T5.1: housemates going home in the same second each get their own seat or stand). A plan
   *  whose first pose names no place holds none. */
  function planActivity(v) {
    planInner(v);
    const s = v._steps.find((x) => x.k === 'pose' || x.k === 'inside');
    if (s && (s.spot || s.slot)) claimPose(v, s);       // taken (rare: every picker checks): the step start re-books it
    else release(v);
  }
  function planInner(v) {
    if (!world) { v._steps = [{ k: 'pose', pose: 'stand', at: v._pos || [0, 0, 0], dur: 2 }]; return; }
    endActivity(v);
    const ctx = lastCtx;
    const phase = phaseOf(v, ctx.sky);
    v._phase = phase;
    const steps = [];
    // granted piece first (§5.3), whatever the phase
    if (v._grantUse && st.clock < v._grantUse.until && v.status !== 'traveller') {
      const g = v._grantUse; v._grantUse = null;
      const use = useSteps(v, g);
      if (use.length) { v._act = 'use'; v._steps = [...exitIfOut(v, use), ...use]; return; }
    }
    if (v.status === 'camping') return campActivity(v, phase);
    const b = homeB(v);
    if (!b) { v._act = 'wander'; v._steps = [...exitSteps(v), ...wanderSteps(v)]; return; }
    if (phase === 'night' || (phase === 'home' && !(v.trait === 'owl'))) {
      if (phase === 'home' && v.trait === 'chatty' && R(v, 'chat')() < 0.3) {
        const other = world.homes.find((h) => h.id !== b.id && mainDoor(h) && dist(mainDoor(h).step[0], mainDoor(h).step[1], [homeDoorCell(v)]) <= 6);
        if (other && v._loc !== 'in') {
          const du = doorUse(other);
          const sl = doorSlot(v, du);
          if (sl) { v._act = 'doorchat'; v._steps = [{ k: 'walk', to: du.step, end: sl.at }, { k: 'pose', pose: 'chat', at: sl.at, face: du.face, dur: dur(v, 'chat'), cell: du.step, spot: sl.spot }]; return; }
        }
      }
      goHome(v, b, phase === 'night' ? 'sleep' : 'sit', phase);
      return;
    }
    if (phase === 'home' && v.trait === 'owl') {
      const hang = pickHangout(v, 'night', true);
      v._act = 'owl';
      if (hang && R(v, 'owl')() < 0.6) { v._steps = [...exitSteps(v), ...spotSteps(hang, dur(v, 'hangout'), null)]; return; }
      v._steps = [...exitSteps(v), ...strollSteps(v, true)];
      return;
    }
    // rounds first (flowing: once a day in their window; pinned: every 2nd / 3rd activity)
    const h = hours(ctx.sky);
    const pinnedTurn = (k) => !ctx.flowing && (v._pinnedN % k === 0);
    v._pinnedN++;
    if (v.job === 'lamplighter' && phase === 'evening' && ((ctx.flowing && h >= 17.5 && h < 19.5 && st.clock - v._roundAt > 200) || pinnedTurn(2))) {
      const r = roundSteps(v, 'lamp');
      if (r.length) { v._roundAt = st.clock; v._act = 'round'; v._steps = [...exitSteps(v), ...r]; return; }
    }
    if (v.job === 'postie' && (phase === 'morning' || phase === 'day') && ((ctx.flowing && h >= 8 && h < 11 && st.clock - v._roundAt > 200) || pinnedTurn(3))) {
      const r = roundSteps(v, 'post');
      if (r.length) { v._roundAt = st.clock; v._act = 'round'; v._steps = [...exitSteps(v), ...r]; return; }
    }
    if (v.job === 'baker' && phase === 'morning' && ((ctx.flowing && h >= 7 && h < 9 && st.clock - v._roundAt > 200) || pinnedTurn(3))) {
      const r = roundSteps(v, 'bread');
      if (r.length) { v._roundAt = st.clock; v._act = 'round'; v._steps = [...exitSteps(v), ...r]; return; }
    }
    // lunch (12:00–13:00, once a day)
    if (phase === 'day' && h >= TUNE.SCHEDULE.lunch[0] && h < TUNE.SCHEDULE.lunch[1] && st.clock - v._lunchAt > 200) {
      v._lunchAt = st.clock;
      const seats = world.spots.filter((s) => s.kind === 'seat' && S.SEAT_OUT.has(s.piece) && dist(s.approach[0], s.approach[1], [homeDoorCell(v)]) <= 10);
      const sp = seatSpot(v, seats);
      v._act = 'lunch';
      // the seat / doorstep place is reserved as the plan is made, not when the walk starts: housemates plan lunch
      // within a second of each other (R3 T3.3)
      if (sp && hold(v, sp.id, spotPoint(sp))) { v._steps = [...exitSteps(v), ...spotSteps(sp, dur(v, ctx.flowing ? 'break' : 'breakPinned'), 'sit')]; return; }
      const du = doorUse(b);
      const sl = doorSlot(v, du);
      if (sl) { v._steps = [...exitSteps(v), { k: 'walk', to: du.step, end: sl.at }, { k: 'pose', pose: 'stand', at: sl.at, face: du.out, dur: dur(v, 'break'), cell: du.step, spot: sl.spot }]; return; }
    }
    const W = activityWeights(v, phase);
    const choice = weighted(R(v, 'act'), W) || 'wander';
    let s = activitySteps(v, choice, phase);
    if (!s.length) s = wanderSteps(v);
    v._act = choice;
    v._steps = choice === 'popHome' ? s : [...exitSteps(v), ...s];
  }
  const exitIfOut = (v, steps) => (steps[0] && (steps[0].k === 'inside' || steps[0].k === 'door') ? [] : exitSteps(v));
  function activityWeights(v, phase) {
    const tp = TRAITS[v.trait]?.prefs || {};
    const hasMail = !!myMailbox(v);
    switch (phase) {
      case 'morning': return [['chore', 50], ['work', 20], ['porch', 20 * (tp.porch || 1)], ['mailbox', hasMail ? 10 : 0]];
      case 'day': return [['work', lastCtx.flowing ? 60 : 50], ['break', 15], ['visit', 10 * (tp.chat || 1)], ['stroll', 10], ['hangout', 5], ['popHome', 5 * (tp.popHome || 1)]];
      case 'evening': return [['hangout', 70], ['stroll', 15], ['porch', 15 * (tp.porch || 1)]];
      default: return [['wander', 1]];
    }
  }
  function myMailbox(v) {
    const b = homeB(v);
    if (!b) return null;
    const steps = b.doors.map((d) => d.step);
    return outItems().filter((p) => p.t === 'mailbox' && dist(p.x, p.z, steps) <= 3).sort((a, c) => ci(a.x, a.z) - ci(c.x, c.z))[0] || null;
  }
  function activitySteps(v, kind, phase) {
    const flowing = lastCtx.flowing;
    switch (kind) {
      case 'work': return workSteps(v);
      case 'chore': return choreSteps(v);
      case 'porch': {
        // a deck spot by the door, else the doorstep itself: the door's stand point is a door slot like every other
        // doorstep pose (a deck spot on that doorstep cell is left to the slots too), so a housemate sweeping there
        // or at lunch is never stood on (R4 T4.4)
        const du = doorUse(homeB(v));
        const onStep = (sp) => du && sp.cell && sp.cell[0] === du.step[0] && sp.cell[1] === du.step[1];
        const sp = world.spots.filter((s) => s.kind === 'porch' && s.home === v.homeId && !onStep(s)).filter(freeSpot)[0];
        if (sp) return spotSteps(sp, dur(v, 'break'), 'stand');
        if (!du || !world.spots.some((s) => s.kind === 'door' && s.home === v.homeId)) return [];
        const sl = doorSlot(v, du);
        return sl ? [{ k: 'walk', to: du.step, end: sl.at }, { k: 'pose', pose: 'stand', at: sl.at, face: du.out, dur: dur(v, 'break'), cell: du.step, spot: sl.spot }] : [];
      }
      case 'mailbox': {
        const m = myMailbox(v);
        const sp = m && standBy(v, m);
        return sp ? gotoPose(sp, 'post', 4, { cues: [{ kind: 'letter', first: 1, every: 99, at: [(m.x + 0.5) * CELL, 1.2, (m.z + 0.5) * CELL] }] }) : [];
      }
      case 'break': {
        const seats = world.spots.filter((s) => s.kind === 'seat');
        const sp = seatSpot(v, seats.filter((s) => dist(s.approach[0], s.approach[1], [v._cell || homeDoorCell(v)]) <= 10));
        if (!sp) return [];
        const read = v.trait === 'bookish';
        return spotSteps(sp, dur(v, flowing ? 'break' : 'breakPinned'), read ? 'read' : null, { flags: read ? { book: true } : null });
      }
      case 'hangout': {
        const sp = pickHangout(v, phase, false);
        if (!sp) return [];
        const c = cozyNow();
        const mult = phase === 'evening' ? [0.8, 1, 1.2, 1.4][tierOf(c.value)] : 1;
        return spotSteps(sp, dur(v, 'hangout') * mult, null);
      }
      case 'visit': {
        const me = posNow(v) || [0, 0, 0];
        const others = villagers.filter((u) => u !== v && u._loc === 'out' && u.status !== 'traveller' && u.plan?.kind === 'pose' && u._cell)
          .filter((u) => { const p = posNow(u); return p && Math.hypot(p[0] - me[0], p[2] - me[2]) <= TUNE.VISIT_RADIUS; });
        const u = pick(R(v, 'visit'), others);
        if (!u) return [];
        const sp = standBy(v, { x: u._cell[0], z: u._cell[1] }, 'chat');
        if (!sp) return [];
        const up = posNow(u);
        sp.face = yawTo(sp.at[0], sp.at[2], up[0], up[2]);
        return gotoPose(sp, 'chat', dur(v, 'chat'), { cues: [{ kind: 'note', first: 1, every: 6 }] });
      }
      case 'stroll': return strollSteps(v, false);
      case 'popHome': {
        const b = homeB(v);
        if (!b) return [];
        if (v._loc === 'in') return [insideStep(v, b, 'sit', dur(v, 'popHome'))];
        return enterSteps(v, b, [insideStep(v, b, 'sit', dur(v, 'popHome'))]);
      }
      default: return wanderSteps(v);
    }
  }
  function wanderSteps(v) {
    if (!world) return [];
    const r = R(v, 'wander');
    const a = anchorCells(v);
    const c = a[Math.floor(r() * a.length)] || [0, 0];
    for (let k = 0; k < 8; k++) {
      const x = c[0] + Math.round((r() * 2 - 1) * TUNE.WANDER_RADIUS), z = c[1] + Math.round((r() * 2 - 1) * TUNE.WANDER_RADIUS);
      if (world.nav.inMain(x, z)) {
        const at = world.nav.centre(x, z);
        if (!placeFree(`cell|${x}|${z}`, at, v)) continue;            // never on another villager's spot (R4 T4.4)
        return [{ k: 'walk', to: [x, z] }, { k: 'pose', pose: r() < 0.3 ? 'stretch' : 'stand', at, face: r() * 6.28 - 3.14, dur: dur(v, 'wander'), cell: [x, z], spot: `cell|${x}|${z}` }];
      }
    }
    const f = world.nav.nearestFree(c[0], c[1], 6, true);
    if (f) {
      const at = world.nav.centre(f[0], f[1]), key = `cell|${f[0]}|${f[1]}`;
      return [{ k: 'walk', to: f }, { k: 'pose', pose: 'stand', at, face: 0, dur: dur(v, 'wander'), cell: f, spot: placeFree(key, at, v) ? key : undefined }];
    }
    return [{ k: 'pose', pose: 'stand', at: v._pos || [0, 0, 0], face: 0, dur: 5 }];
  }
  function strollSteps(v, lantern) {
    const me = v._cell || homeDoorCell(v);
    if (v.trait === 'sweet' && !lantern && R(v, 'sweet')() < 0.35) {
      const baker = villagers.find((u) => u !== v && u.job === 'baker' && u.status === 'resident');
      const du = baker && doorUse(homeB(baker));
      if (du && !du.back) return [{ k: 'walk', to: du.step, end: du.stand }, doorPose(du, 'admire', du.face, dur(v, 'admire'), { cues: [{ kind: 'bread', first: 1, every: 99, at: [du.stand[0], 1.5, du.stand[2]] }] })];
    }
    const pretty = outItems().filter((p) => S.PRETTY.has(p.t) || GIFTS[p.t]).filter((p) => dist(p.x, p.z, [me]) <= 8);
    const r = R(v, 'stroll');
    const p = pick(r, pretty);
    const sp = p && standBy(v, p, 'admire');
    if (!sp) return wanderSteps(v);
    const cues = [{ kind: 'sparkle', first: 1, every: 99, at: [(p.x + 0.5) * CELL, 0.8, (p.z + 0.5) * CELL] }];
    if (v.trait === 'florist' && S.BLOOM.has(p.t)) cues.push({ kind: 'sparkle', first: 3, every: 99, at: [(p.x + 0.5) * CELL, 0.6, (p.z + 0.5) * CELL] });
    if (v.trait === 'animals' && ['chickens', 'cat', 'doghouse', 'gift_gnome', 'gift_carved_bear'].includes(p.t)) return gotoPose(sp, 'kneel', dur(v, 'admire'), { cues });
    return gotoPose(sp, 'admire', dur(v, 'admire'), { cues, flags: lantern ? { lantern: true } : null });
  }
  function pickHangout(v, phase, night) {
    const me = v._cell || homeDoorCell(v);
    const tp = TRAITS[v.trait]?.prefs || {};
    const list = [];
    for (const h of world.hangouts) {
      const free = h.spots.filter(freeSpot);
      const max = h.plaza ? TUNE.PLAZA_MAX : TUNE.HANGOUT_MAX;
      const used = h.spots.length - free.length;
      if (!free.length || used >= max) continue;
      const walk = dist(h.spots[0].approach[0], h.spots[0].approach[1], [me]) * CELL;
      let s = free.length * (1 + (phase === 'evening' ? 1.0 * Math.min(1, h.lamps) : 0)) * (1 + ((phase === 'evening' || phase === 'night') && h.fire ? 1.5 : 0))
        * (1 + (phase === 'day' ? 0.2 * Math.min(5, h.blooms) : 0)) * (h.tea ? 1.5 : 1) / (1 + walk / 15);
      if (tp.occupied) s *= Math.pow(tp.occupied, used);
      if (tp.picnic && h.piece === 'picnic_table') s *= tp.picnic;
      if (night && v.trait === 'owl' && (h.fire || h.lamps)) s *= 2;
      list.push([h, s]);
    }
    const h = weighted(R(v, 'hang'), list);
    if (!h) return null;
    return h.spots.filter(freeSpot)[0] || null;
  }
  function choreSteps(v) {
    const b = homeB(v);
    const du = doorUse(b);
    const r = R(v, 'chore');
    const x = r();
    const steps = b ? b.doors.map((d) => d.step) : [v._cell || [0, 0]];
    const blooms = outItems().filter((p) => S.BLOOM.has(p.t) && dist(p.x, p.z, steps) <= 3);
    if (x < 0.45 && blooms.length) {
      const p = pick(r, blooms), sp = standBy(v, p, 'water');
      if (sp) return gotoPose(sp, 'water', dur(v, 'chore'), { cues: [{ kind: 'drops', first: 1, every: 2, at: [(p.x + 0.5) * CELL, 0.4, (p.z + 0.5) * CELL] }], flags: { tool: v.job === 'gardener' } });
    }
    // one sweeper a door, on the stand point itself: it is a door slot, so never where a housemate stands (R4 T4.4)
    const sl = x < 0.8 && du && !du.back && b ? doorSlot(v, du, true) : null;
    if (sl) return [{ k: 'walk', to: du.step, end: sl.at }, { k: 'pose', pose: 'sweep', at: sl.at, face: du.out, dur: dur(v, 'chore'), cell: du.step, spot: sl.spot }];
    const w = wanderSteps(v);
    if (w[1]) w[1].pose = 'stretch';
    return w;
  }
  // ---- work (§2.2)
  function workSteps(v) {
    const b = homeB(v);
    if (!b) return wanderSteps(v);
    const foot = b.foot, doors = b.doors.map((d) => d.step);
    const r = R(v, 'work');
    const items = outItems();
    const flowing = lastCtx.flowing;
    const wd = () => dur(v, flowing ? 'work' : 'workPinned');
    const at = (p, y = 0.5) => [(p.x + 0.5) * CELL, y, (p.z + 0.5) * CELL];
    const tool = { tool: true };
    switch (v.job) {
      case 'gardener': {
        const blooms = within(items.filter((p) => S.BLOOM.has(p.t)), foot, 4);
        if (!blooms.length) break;
        const n = 2 + Math.floor(r() * 3);
        const out = [];
        const sorted = blooms.slice().sort((a, c) => ci(a.x, a.z) - ci(c.x, c.z));
        for (let k = 0; k < n; k++) {
          const p = sorted[(Math.floor(r() * sorted.length) + k) % sorted.length];
          const sp = standBy(v, p, 'water');
          if (!sp) continue;
          out.push(...gotoPose(sp, 'water', range(r, 8, 12), { cues: [{ kind: 'drops', first: 1, every: 2, at: at(p, 0.4) }], flags: tool }));
          out.push({ k: 'pose', pose: 'admire', at: sp.at, face: sp.face, dur: 3, cell: sp.cell, cues: [{ kind: 'sparkle', first: 0.5, every: 99, at: at(p, 0.6) }] });
        }
        if (out.length) return out;
        break;
      }
      case 'farmer': {
        const farm = within(items.filter((p) => S.FARM.has(p.t)), foot, 5).sort((a, c) => ci(a.x, a.z) - ci(c.x, c.z));
        if (!farm.length) break;
        const out = [];
        for (let k = 0; k < 2; k++) {
          const p = farm[(Math.floor(r() * farm.length) + k) % farm.length];
          const pose = p.t === 'chickens' ? 'scatter' : p.t === 'scarecrow' ? 'pat' : p.t === 'hay_bale' ? 'fork' : 'hoe';
          const kindC = pose === 'scatter' ? 'seeds' : 'chips';
          const sp = standBy(v, p, pose);
          if (!sp) continue;
          out.push(...gotoPose(sp, pose, range(r, 15, 25), { cues: [{ kind: kindC, first: 1, every: pose === 'hoe' ? 1.2 : 3, at: at(p, 0.3) }, ...(p.t === 'chickens' || p.t === 'gift_hen_house' ? [{ kind: 'cluck', first: 2, every: 9 }] : [])], flags: tool }));
        }
        if (out.length) return out;
        break;
      }
      case 'woodcutter': {
        const pile = within(items.filter((p) => p.t === 'woodpile'), foot, 3).sort((a, c) => ci(a.x, a.z) - ci(c.x, c.z))[0];
        if (!pile) break;
        v._bout++;
        if (v._bout % 3 === 0) {
          const tree = within(items.filter((p) => S.TREE.has(p.t)), foot, 6).sort((a, c) => ci(a.x, a.z) - ci(c.x, c.z));
          const tp = pick(r, tree), sp = tp && standBy(v, tp, 'knock');
          if (sp) return [...gotoPose(sp, 'knock', 2, { flags: tool }), { k: 'pose', pose: 'lookup', at: sp.at, face: sp.face, dur: 3, cell: sp.cell }];
        }
        // the woodpile's front cell (local +Z), else any free neighbour
        const f = [[0, 1], [1, 0], [0, -1], [-1, 0]][(pile.r | 0) & 3];
        let sp = null;
        if (world.nav.inMain(pile.x + f[0], pile.z + f[1])) {
          const c = world.nav.centre(pile.x + f[0], pile.z + f[1]);
          const tx = (pile.x + 0.5) * CELL, tz = (pile.z + 0.5) * CELL;
          const ax = c[0] + (tx - c[0]) * 0.2, az = c[2] + (tz - c[2]) * 0.2;
          const key = `cell|${pile.x + f[0]}|${pile.z + f[1]}`;
          if (placeFree(key, [ax, c[1], az], v)) sp = { cell: [pile.x + f[0], pile.z + f[1]], at: [ax, c[1], az], face: yawTo(ax, az, tx, tz), spot: key };
        }
        if (!sp) sp = standBy(v, pile, 'chop');
        if (sp) return gotoPose(sp, 'chop', wd(), { cues: [{ kind: 'chips', first: 1, every: 1.6, at: at(pile, 0.5) }, { kind: 'chop', first: 1, every: 1.6 }], flags: tool });
        break;
      }
      case 'fisher': {
        const pond = within(items.filter((p) => p.t === 'pond'), foot, 6).sort((a, c) => dist(a.x, a.z, foot) - dist(c.x, c.z, foot) || ci(a.x, a.z) - ci(c.x, c.z))[0];
        if (!pond) break;
        const boat = items.find((p) => p.t === 'gift_rowboat' && Math.max(Math.abs(p.x - pond.x), Math.abs(p.z - pond.z)) <= 1);
        const sp0 = boat && world.spots.find((s) => s.id.startsWith(`I|${boat.x}|0|${boat.z}#`) && freeSpot(s));
        const every = range(r, 20, 40);
        const catchCues = [{ kind: 'hop', first: every, every }, { kind: 'fish', first: every, every, at: at(pond, 0.6) }, { kind: 'splash', first: every, every, at: at(pond, 0.1) }];
        if (sp0) return spotSteps(sp0, wd(), 'fish', { cues: catchCues, flags: tool });
        const sp = standBy(v, pond, 'fish');
        if (sp) return gotoPose(sp, 'fish', wd(), { cues: catchCues, flags: tool });
        break;
      }
      case 'beekeeper': {
        const h = hours(lastCtx.sky);
        const stand = items.find((p) => p.t === 'gift_honey_stand');
        if (stand && h >= 13) { const sp = standBy(v, stand, 'stand'); if (sp) return gotoPose(sp, 'stand', range(r, 30, 60)); }
        const hive = within(items.filter((p) => p.t === 'beehive'), foot, 4).sort((a, c) => ci(a.x, a.z) - ci(c.x, c.z))[0];
        if (!hive) break;
        const sp = standBy(v, hive, 'smoke');
        if (!sp) break;
        const out = gotoPose(sp, 'smoke', range(r, 20, 40), { cues: [{ kind: 'bees', first: 0.5, every: 99, at: at(hive, 0.9), n: 6 }, { kind: 'puff', first: 1, every: 3, at: at(hive, 0.9) }], flags: tool });
        const bloom = within(items.filter((p) => S.BLOOM.has(p.t)), [[hive.x, hive.z]], 2)[0];
        const sp2 = bloom && standBy(v, bloom, 'admire');
        if (sp2) out.push(...gotoPose(sp2, 'admire', 5, { cues: [{ kind: 'sparkle', first: 1, every: 99, at: at(bloom, 0.6) }] }));
        return out;
      }
      case 'baker': {
        const oven = items.find((p) => p.t === 'gift_bread_oven');
        if (oven) { const sp = standBy(v, oven, 'knead'); if (sp) return gotoPose(sp, 'knead', wd(), { cues: [{ kind: 'bread', first: 3, every: 20, at: at(oven, 1.0) }] }); }
        const range_ = world.index.items.find((p) => p.t === 'kitchen_range' && b.cells.has(ck(p.x, p.y, p.z)));
        if (!range_) break;
        const st0 = insideStep(v, b, 'by', wd(), range_);
        if (v._loc === 'in') return [st0];
        return enterSteps(v, b, [st0]);
      }
      case 'lamplighter': {
        const lamps = within(items.filter((p) => S.LAMP.has(p.t)), foot, 6).sort((a, c) => ci(a.x, a.z) - ci(c.x, c.z));
        if (!lamps.length) break;
        const out = [];
        for (const p of lamps.slice(0, 3)) {
          const sp = standBy(v, p, 'polish');
          if (sp) out.push(...gotoPose(sp, 'polish', 6, { cues: [{ kind: 'sparkle', first: 2, every: 99, at: at(p, 1.6) }], flags: tool }));
        }
        const bench = seatSpot(v, world.spots.filter((s) => s.piece === 'bench'));
        if (bench && r() < 0.5) out.push(...spotSteps(bench, 20, 'sit', { cues: [{ kind: 'z', first: 3, every: 6 }] }));
        if (out.length) return out;
        break;
      }
      case 'postie': {
        const m = myMailbox(v);
        const sp = m && standBy(v, m, 'sort');
        if (sp) return gotoPose(sp, 'sort', wd(), { cues: [{ kind: 'letter', first: 2, every: 10, at: at(m, 1.2) }], flags: tool });
        break;
      }
      default: break;
    }
    return potterSteps(v);
  }
  /** Odd jobs (§2.2): sweep the doorstep, water the nearest bloom, stroll a path. */
  function potterSteps(v) {
    const r = R(v, 'potter');
    const x = r();
    if (x < 0.4) return choreSteps(v);
    const paths = [...world.index.F.values()].filter((p) => (p.y | 0) === 0 && p.t === 'path' && world.nav.inMain(p.x, p.z)
      && placeFree(`cell|${p.x}|${p.z}`, world.nav.centre(p.x, p.z), v));
    if (paths.length && x < 0.8) {
      const p = paths[Math.floor(r() * paths.length)];
      return [{ k: 'walk', to: [p.x, p.z] }, { k: 'pose', pose: 'admire', at: world.nav.centre(p.x, p.z), face: 0, dur: dur(v, 'admire'), cell: [p.x, p.z], spot: `cell|${p.x}|${p.z}` }];
    }
    return choreSteps(v);
  }
  function roundSteps(v, kind) {
    const b = homeB(v);
    const items = outItems();
    const out = [];
    let targets = [];
    if (kind === 'lamp') targets = items.filter((p) => S.LAMP.has(p.t)).map((p) => ({ p }));
    else if (kind === 'post') {
      for (const h of world.homes) {
        const steps = h.doors.map((d) => d.step);
        const mb = items.filter((p) => p.t === 'mailbox' && dist(p.x, p.z, steps) <= 3).sort((a, c) => ci(a.x, a.z) - ci(c.x, c.z))[0];
        if (mb) targets.push({ p: mb });
        else { const du = doorUse(h); if (du) targets.push({ door: du }); }
      }
    } else if (kind === 'bread') {
      const others = world.homes.filter((h) => h.id !== b?.id).map((h) => doorUse(h)).filter(Boolean);
      const r = R(v, 'bread');
      const n = Math.min(others.length, 1 + Math.floor(r() * 3));
      targets = others.slice(0, n).map((du) => ({ door: du }));
      if (!targets.length) return [];
    }
    // nearest-neighbour order from the villager's cell
    let cur = v._cell || homeDoorCell(v);
    const left = targets.slice();
    while (left.length) {
      left.sort((a, c) => {
        const pa = a.p ? [a.p.x, a.p.z] : a.door.step, pc = c.p ? [c.p.x, c.p.z] : c.door.step;
        return Math.abs(pa[0] - cur[0]) + Math.abs(pa[1] - cur[1]) - (Math.abs(pc[0] - cur[0]) + Math.abs(pc[1] - cur[1])) || ci(pa[0], pa[1]) - ci(pc[0], pc[1]);
      });
      const tg = left.shift();
      if (tg.p) {
        const sp = standBy({ ...v, _cell: cur }, tg.p, kind === 'lamp' ? 'polish' : 'post');
        if (!sp) continue;
        const head = [(tg.p.x + 0.5) * CELL, kind === 'lamp' ? 2.4 : 1.2, (tg.p.z + 0.5) * CELL];
        out.push(...gotoPose(sp, kind === 'lamp' ? 'polish' : 'post', kind === 'lamp' ? 2.5 : 1.5,
          { cues: kind === 'lamp' ? [{ kind: 'sparkle', first: 1, every: 99, at: head }] : [{ kind: 'letter', first: 0.5, every: 99, at: head }, { kind: 'hop', first: 1, every: 99 }], flags: { tool: true, basket: false } }));
        cur = sp.cell;
      } else {
        const du = tg.door;
        out.push({ k: 'walk', to: du.step, end: du.stand }, doorPose(du, kind === 'bread' ? 'knock' : 'post', du.face, 1.5,
          { cues: [{ kind: kind === 'bread' ? 'bread' : 'letter', first: 0.5, every: 99, at: [du.stand[0], 1.4, du.stand[2]] }], flags: { basket: kind === 'bread', tool: kind !== 'bread' } }));
        cur = du.step;
      }
    }
    if (kind === 'bread') {
      const tbl = world.spots.filter((s) => s.kind === 'seat' && (s.piece === 'bench' || s.piece === 'picnic_table'));
      const sp = seatSpot({ ...v, _cell: cur }, tbl);
      if (sp) out.push(...spotSteps(sp, 20, 'knead'));
    }
    return out;
  }
  function goHome(v, b, kind, phase) {
    const durIn = kind === 'sleep' ? Infinity : TUNE.DUR.hangout[1];
    const stepIn = insideStep(v, b, kind, durIn);
    v._act = kind === 'sleep' ? 'sleep' : 'home';
    if (v._loc === 'in' && v._inHome === b.id) { v._steps = [stepIn]; return; }
    if (v._loc === 'in') { v._steps = [...exitSteps(v), ...enterSteps(v, b, [stepIn])]; return; }
    const steps = enterSteps(v, b, [stepIn]);
    // far from home at night: walk 6 s, then slip home (§5.4)
    if (steps[0]?.k === 'walk' && lastCtx.flowing) {
      const here = v._cell || [0, 0];
      const du = doorUse(b);
      if (du && world) {
        const est = Math.abs(here[0] - du.step[0]) * CELL + Math.abs(here[1] - du.step[1]) * CELL;
        if (est / TUNE.WALK_SPEED > TUNE.SLIP_HOME_AFTER) steps[0].maxT = TUNE.SLIP_HOME_WALK;
      }
    }
    v._steps = steps;
  }
  /** A camper's place by its tent (§5.7, §6.5; R4 T4.4, R5 T5.2): tent-mates side by side across its mouth, 0.9 m
   *  apart (lying with the head into the tent, sitting or waiting facing out). When the mouth cell is built over, the
   *  same two places across the nearest free cell in sight of the tent, facing it; when both places there are taken,
   *  the next free cell's. Held at once with hold() (a lying camper holds its whole body), so nobody else is booked
   *  onto it, and two campers never share a point even when more campers than tents share CAMP_CELLS[0].
   *  → { cell, ground, face, spot } or null (nothing free within 4 cells) */
  function campPlace(v, t, pose) {
    if (!world) return null;
    const nav = world.nav, lie = pose === 'lie';
    const k = Math.max(0, villagers.filter((u) => u.status === 'camping').indexOf(v)) % 2;
    const tc = [(t[0] + 0.5) * CELL, (t[1] + 0.5) * CELL];
    const cells = [];
    for (let r = 1; r <= 4; r++) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      const x = t[0] + dx, z = t[1] + dz;
      if (nav.inMain(x, z)) cells.push([x, z]);
    }
    const mx = t[0] + 1, mz = t[1];
    const d2 = (c) => (c[0] - mx) ** 2 + (c[1] - mz) ** 2;
    // in sight of the tent first: no blocked cell (a shed, another tent) on the line from the tent to it
    const hidden = (c) => {
      for (let f = 0.25; f < 1; f += 0.25) {
        const x = Math.floor(t[0] + 0.5 + (c[0] - t[0]) * f), z = Math.floor(t[1] + 0.5 + (c[1] - t[1]) * f);
        if ((x !== t[0] || z !== t[1]) && nav.blocked[ci(x, z)]) return 1;
      }
      return 0;
    };
    const key = new Map(cells.map((c) => [c, hidden(c) * 1000 + d2(c)]));
    cells.sort((p, q) => key.get(p) - key.get(q) || ci(p[0], p[1]) - ci(q[0], q[1]));
    for (const c of cells) {
      const mouth = c[0] === mx && c[1] === mz;
      const cc = nav.centre(c[0], c[1]);
      // out of the tent: +X at its own mouth, else from the tent's centre to this cell's
      let ux = 1, uz = 0;
      if (!mouth) { const L = Math.hypot(cc[0] - tc[0], cc[2] - tc[1]) || 1; ux = (cc[0] - tc[0]) / L; uz = (cc[2] - tc[1]) / L; }
      const base = mouth ? [c[0] * CELL + (pose === 'stand' ? 0.6 : 0.3), cc[2]] : [cc[0], cc[2]];
      for (const side of [k, 1 - k]) {
        const sg = side ? 1 : -1;
        const gx = base[0] - uz * 0.45 * sg, gz = base[1] + ux * 0.45 * sg;
        const ground = [gx, surfaceAt(gx, gz), gz];
        const out = Math.atan2(ux, uz), face = lie ? out + Math.PI : out;
        const spot = `tent|${c[0]}|${c[1]}|${side}`;
        if (hold(v, spot, ground, lie ? face : null)) return { cell: c, ground, face, spot };
      }
    }
    return null;
  }
  function campActivity(v, phase) {
    const t = tentOf(v);
    if (phase === 'night' || phase === 'home') {
      v._act = 'camp';
      const pose = phase === 'night' ? 'lie' : 'sit';
      const pl = campPlace(v, t, pose);
      if (pl) {
        const g = pl.ground;
        v._steps = [{ k: 'walk', to: pl.cell, end: g }, { k: 'pose', pose, at: [g[0], g[1] + 0.05, g[2]], face: pl.face, dur: phase === 'night' ? 40 : 30, cell: pl.cell, ground: g, spot: pl.spot }];
        return;
      }
      v._steps = wanderSteps(v);
      return;
    }
    const W = activityWeights(v, phase).filter(([k]) => k !== 'work' && k !== 'popHome' && k !== 'mailbox' && k !== 'porch');
    const choice = weighted(R(v, 'campact'), W) || 'wander';
    v._act = choice;
    const s = choice === 'chore' ? wanderSteps(v) : activitySteps(v, choice, phase);
    if (s.length) { v._steps = s; return; }
    // nothing to do: wait by the tent, beside a tent-mate rather than on them (two campers share a tent; R4 T4.4)
    const pl = campPlace(v, t, 'stand');
    if (pl) { v._steps = [{ k: 'walk', to: pl.cell, end: pl.ground }, { k: 'pose', pose: 'stand', at: pl.ground, face: pl.face, dur: dur(v, 'wander'), cell: pl.cell, spot: pl.spot }]; return; }
    v._steps = wanderSteps(v);
  }
  /** Steps that use a granted piece (§5.3). */
  function useSteps(v, g) {
    const recs = g.recs || [];
    const b = homeB(v);
    for (const rec of recs) {
      const t = rec.t;
      const at = [(rec.x + 0.5) * CELL, 0.6, (rec.z + 0.5) * CELL];
      if (b && b.cells.has(ck(rec.x, rec.y | 0, rec.z))) {
        const p = world.index.I.get(ck(rec.x, rec.y | 0, rec.z)) || world.index.D.get(ck(rec.x, rec.y | 0, rec.z)) || rec;
        const seat = ['armchair', 'sofa', 'rocking_chair', 'chair'].includes(t);
        const s = seat ? insideStep(v, b, 'sit', dur(v, 'use')) : insideStep(v, b, 'by', dur(v, 'use'), p);
        return v._loc === 'in' ? [s] : enterSteps(v, b, [s]);
      }
      const seatSpots = world.spots.filter((s) => s.id.startsWith(`I|${rec.x}|0|${rec.z}#`) && freeSpot(s));
      if (seatSpots.length) {
        const sp = seatSpots[0];
        const read = v.trait === 'bookish' && sp.kind === 'seat';
        return spotSteps(sp, dur(v, 'use'), read ? 'read' : null, { flags: read ? { book: true } : null });
      }
      if ((rec.y | 0) !== 0) continue;
      if (S.LAMP.has(t)) { const sp = standBy(v, rec, 'read'); if (sp) return gotoPose(sp, 'read', dur(v, 'use'), { flags: { book: true } }); }
      if (S.BLOOM.has(t) || S.TREE.has(t)) { const sp = standBy(v, rec, S.BLOOM.has(t) ? 'water' : 'admire'); if (sp) return gotoPose(sp, sp.pose, dur(v, 'use'), { cues: [{ kind: S.BLOOM.has(t) ? 'drops' : 'sparkle', first: 1, every: 3, at }] }); }
      if (t === 'mailbox') { const sp = standBy(v, rec, 'post'); if (sp) return gotoPose(sp, 'post', 5, { cues: [{ kind: 'letter', first: 1, every: 99, at }] }); }
      if (t === 'path' || t === 'deck' || t === 'steps') {
        const at = world.nav.inMain(rec.x, rec.z) ? world.nav.centre(rec.x, rec.z) : null, key = `cell|${rec.x}|${rec.z}`;
        if (at && placeFree(key, at, v)) return [{ k: 'walk', to: [rec.x, rec.z] }, { k: 'pose', pose: 'admire', at, face: 0, dur: dur(v, 'admire'), cell: [rec.x, rec.z], spot: key }];
        continue;
      }
      const sp = standBy(v, rec, t === 'pond' ? 'stand' : 'admire');
      if (sp) return gotoPose(sp, sp.pose, dur(v, 'use'), { cues: [{ kind: 'sparkle', first: 1, every: 99, at }] });
    }
    return [];
  }

  // ------------------------------------------------------------------------------------------ placing (reseat, restore)
  function placeFor(v) {
    endActivity(v);
    v._steps = []; v._cueSched = [];
    if (!world) { setPlan(v, GONE); return; }
    const phase = phaseOf(v, lastCtx.sky);
    v._phase = phase;
    const b = homeB(v);
    const asleep = phase === 'night' || (phase === 'home' && v.trait !== 'owl');
    if (v.status === 'resident' && b && asleep) {
      v._loc = 'in'; v._inHome = b.id;
      const s = startStep(v, insideStep(v, b, phase === 'night' ? 'sleep' : 'sit', phase === 'night' ? Infinity : TUNE.DUR.hangout[1]));
      setPlan(v, s); v._act = phase === 'night' ? 'sleep' : 'home';
      const du = doorUse(b);
      v._cell = du ? du.step : null; v._pos = du ? du.stand : null;
      return;
    }
    if (v.status === 'waiting' && b && asleep) {
      v._loc = 'in'; v._inHome = b.id;
      setPlan(v, startStep(v, insideStep(v, b, 'sleep', Infinity)));
      const du = doorUse(b);
      v._cell = du ? du.step : null; v._pos = du ? du.stand : null;
      return;
    }
    // outdoors: plan the next activity and drop the villager straight onto its first pose
    v._loc = 'out';
    const anchor = v.status === 'camping' ? [tentOf(v)] : b ? [homeDoorCell(v)] : [[0, 0]];
    const c0 = world.nav.nearestFree(anchor[0][0], anchor[0][1], 6, true) || world.nav.laneCell;
    v._cell = c0; v._pos = world.nav.centre(c0[0], c0[1]);
    planActivity(v);
    const steps = v._steps;
    v._steps = [];
    // skip door/walk steps: jump to the first pose (or inside) step
    let k = 0;
    while (k < steps.length && (steps[k].k === 'walk' || steps[k].k === 'door' || steps[k].k === 'slip' || steps[k].k === 'call')) {
      if (steps[k].k === 'walk') { v._cell = steps[k].to; v._pos = steps[k].end || world.nav.centre(steps[k].to[0], steps[k].to[1]); }
      if (steps[k].k === 'door' && steps[k].dir === 'in') { v._loc = 'in'; v._inHome = steps[k].homeId; }
      if (steps[k].k === 'door' && steps[k].dir === 'out') { v._loc = 'out'; v._cell = steps[k].cell; }
      k++;
    }
    v._steps = steps.slice(k);
    if (!advance(v)) setPlan(v, { kind: 'pose', at: v._pos, face: 0, pose: 'stand', t0: st.clock, t1: st.clock + 1, level: 0 });
  }

  // ------------------------------------------------------------------------------------------ unstick (§6.3)
  function unstick() {
    if (!world) return;
    const nav = world.nav;
    for (const v of [...villagers, ...(traveller ? [traveller] : [])]) {
      if (v._loc !== 'out' || !v._cell) continue;
      const p = v.plan;
      if (p.kind === 'walk') {
        // re-plan a walk whose route now crosses a blocked cell
        if (p._cells && p._cells.some((i) => nav.blocked[i])) {
          const here = posNow(v);
          const c = cellOfPos(here);
          v._cell = c; v._pos = here;
          const to = p._to || v._cell;
          if (nav.blocked[ci(c[0], c[1])]) { const f = nav.nearestFree(c[0], c[1], 2, true); if (f) { v._steps.unshift({ k: 'walk', to }); setPlan(v, startStep(v, { k: 'hop', to: f })); continue; } }
          v._steps.unshift({ k: 'walk', to });
          cutPlan(v);
        }
        continue;
      }
      if (p.kind === 'hop' || p.kind === 'slip' || p.kind === 'door') continue;
      const [x, z] = v._cell;
      const i = ci(x, z);
      const free = !nav.blocked[i] && nav.region[i] === nav.mainRegion;
      if (free) {
        // a posed villager whose seat or spot vanished ends that activity
        if (v._spot && v._spot.startsWith('I|') && !world.spots.some((s) => s.id === v._spot)) { endActivity(v); v._steps = []; v.plan = { ...p, t1: st.clock }; }
        continue;
      }
      if (v.status === 'traveller' && v._loc === 'lane') continue;
      endActivity(v); v._steps = [];
      if (nav.blocked[i]) {
        const f = nav.nearestFree(x, z, 2, true);
        if (f) { setPlan(v, startStep(v, { k: 'hop', to: f })); continue; }
      }
      const f = nav.nearestFree(x, z, 11, true) || nav.laneCell;
      setPlan(v, startStep(v, { k: 'slip', to: f }));
    }
  }

  // ------------------------------------------------------------------------------------------ wishes (§7)
  function townForWishes() {
    let freeBeds = 0;
    for (const [, info] of homeInfo) freeBeds += Math.max(0, info.free);
    return {
      villagers, population: villagers.length, campers: villagers.filter((u) => u.status === 'camping').length, freeBeds,
      travellerDue: !!traveller || !!(st.traveller && st.traveller.due !== null), clock: st.clock,
      residentsOf: (hid) => residentsOf(hid).length,
    };
  }
  const openWishes = () => villagers.filter((u) => u.wish).length;
  function gapAfter(v, dream = false) {
    const r = rng(hash32(st.seed, v.seed, Math.floor(st.clock * 4), 'gap'));
    return range(r, TUNE.WISH_GAP[0], TUNE.WISH_GAP[1]) * (dream ? TUNE.DREAM_GAP_MULT : 1);
  }
  const isOdd = (v) => {
    const b = homeB(v);
    if (!b) return false;
    const ev = evalRecipes(world.index, b, { homes: world.homes.length, inside });
    return (ev.found[v.job]?.[0] || 0) < 1;
  };
  function tryCreateWish(v, guided, force = null) {
    const b = homeB(v);
    if (!b || v.status !== 'resident') return { ok: false, reason: 'not living in a home' };
    const town = townForWishes();
    const ctx = wishCtx(world, town, v);
    ctx.clock = force ? undefined : st.clock;
    const odd = isOdd(v);
    let chosen = null, plan = null;
    if (force) {
      const tpl = TEMPLATE[force];
      if (!tpl) return { ok: false, reason: 'unknown template' };
      if (tpl.job && tpl.job !== v.job) return { ok: false, reason: `only for a ${tpl.job}` };
      if (tpl.trait && tpl.trait !== v.trait) return { ok: false, reason: `only for trait ${tpl.trait}` };
      let offered = false;
      try { offered = tpl.offer(ctx, v) && !tpl.done(ctx, v, null); } catch { offered = false; }
      if (!offered) return { ok: false, reason: 'not offered here (already true or its condition fails)' };
      plan = findSpots(tpl, ctx, null);
      if (!plan.complete) return { ok: false, reason: 'no complete plan on this lot', plan };
      chosen = tpl;
    } else {
      const list = [];
      const held = new Set(villagers.filter((u) => u.wish).map((u) => u.wish.tpl));
      // the first friend (§4.3: the town's only villager, whose home met no recipe of their job) first asks for
      // their odd-job wish
      const met = evalRecipes(world.index, b, { homes: world.homes.length, inside }).met;
      const firstFriendOdd = v.grants === 0 && !v.recent.length && villagers.length === 1 && (odd || !met.includes(v.job));
      for (const tpl of TEMPLATES) {
        if (tpl.job && tpl.job !== v.job) continue;
        if (tpl.trait && tpl.trait !== v.trait) continue;
        if ((v.cool[tpl.id] ?? -Infinity) > st.clock) continue;
        if (v.recent.slice(-TUNE.WISH_RECENT).includes(tpl.id)) continue;
        let ok = false;
        try { ok = tpl.offer(ctx, v) && !tpl.done(ctx, v, null); } catch { ok = false; }
        if (!ok) continue;
        let p;
        try { p = findSpots(tpl, ctx, null); } catch { continue; }
        if (!p.complete) continue;
        if (firstFriendOdd && JOBS[v.job].oddWish === tpl.id) { chosen = tpl; plan = p; break; }
        list.push([tpl, weightOf(tpl, ctx, { odd, sameHeld: held.has(tpl.id), lotSpots: p.spots0 }), p]);
      }
      // a villager's first wish is a small one (§1.4: granted in 3 taps): one piece, its spot near a door
      if (!chosen && v.grants === 0 && !v.recent.length) {
        const steps = b.doors.map((d) => d.step);
        const small = list.filter(([t, , p]) => t.size === 'S' && !t.parts[0]?.inside && p.recs.length === 1 && p.recs[0].cell
          && dist(p.recs[0].cell[0], p.recs[0].cell[1], steps) <= TUNE.FIRST_WISH_NEAR);
        if (small.length) list.splice(0, list.length, ...small);
      }
      if (!chosen) {
        const r = rng(hash32(st.seed, v.seed, tickN, 'wish'));
        const pickT = weighted(r, list.map(([t, w]) => [t, w]));
        if (!pickT) return { ok: false, reason: 'nothing possible' };
        chosen = pickT; plan = list.find(([t]) => t === pickT)[2];
      }
    }
    const dream = v._loc === 'in' && phaseOf(v, lastCtx.sky) === 'night';
    const w = createWish(chosen, ctx, st.clock, { dream });
    v.wish = w;
    lastWishAt = st.clock;
    emit('wish', { villager: v.id, wish: w });
    return { ok: true, plan, wish: w };
  }
  function wishChecks(guided) {
    if (!world) return;
    // expiry
    for (const v of villagers) {
      const w = v.wish;
      if (!w) continue;
      if (st.clock - w.born >= (TUNE.WISH_LIFE[w.size] || 900)) expireWish(v);
    }
    if (guided) return;
    if (openWishes() >= TUNE.MAX_OPEN_WISHES) return;
    if (st.clock - lastWishAt < TUNE.WISH_TOWN_SPACING) return;
    const due = villagers.filter((u) => u.status === 'resident' && !u.wish && u.nextWishAt <= st.clock && u.homeId)
      .sort((a, c) => a.nextWishAt - c.nextWishAt || (a.id < c.id ? -1 : 1));
    for (const v of due) {
      const asleep = v._loc === 'in' && phaseOf(v, lastCtx.sky) === 'night';
      if (asleep && !v._dreamDelay) { v._dreamDelay = true; v.nextWishAt = st.clock + gapAfter(v); continue; }
      v._dreamDelay = false;
      const res = tryCreateWish(v, guided);
      if (res.ok) return;
      v.nextWishAt = st.clock + 60;
    }
  }
  function expireWish(v) {
    const w = v.wish;
    if (!w) return;
    v.wish = null;
    v.cool[w.tpl] = st.clock + TUNE.WISH_COOLDOWN;
    trimCool(v);
    v.recent.push(w.tpl); if (v.recent.length > 5) v.recent.shift();
    v.nextWishAt = st.clock + gapAfter(v, w.dream);
    v._fadedAt = st.clock;
    emit('expired', { villager: v.id, wish: w });
  }
  function trimCool(v) {
    const es = Object.entries(v.cool).filter(([, t]) => t > st.clock).sort((a, b) => b[1] - a[1]).slice(0, 10);
    v.cool = Object.fromEntries(es);
  }
  function grantCheck() {
    if (!world) return;
    const town = townForWishes();
    for (const v of villagers) {
      if (!v.wish || v.status !== 'resident') continue;
      const tpl = TEMPLATE[v.wish.tpl];
      if (!tpl) { v.wish = null; continue; }
      const ctx = wishCtx(world, town, v);
      if (isDone(tpl, ctx, v.wish)) grantWish(v, ctx);
    }
  }
  function grantWish(v, ctx = null) {
    const w = v.wish;
    if (!w) return null;
    const tpl = TEMPLATE[w.tpl];
    // which records satisfied it: the template's part pieces near the anchor (for the "use it" routine)
    let recs = [];
    try {
      const c = ctx || wishCtx(world, townForWishes(), v);
      const sets = tpl.parts.map((p) => p.set);
      const pool = [...c.ins(), ...c.outs()];
      const near = pool.filter((p) => sets.some((s) => s.has(p.t)));
      near.sort((a, b) => dist(a.x, a.z, c.FOOT.length ? c.FOOT : [[0, 0]]) - dist(b.x, b.z, c.FOOT.length ? c.FOOT : [[0, 0]]) || ci(a.x, a.z) - ci(b.x, b.z));
      recs = near.slice(0, 3);
      if (tpl.layer === 'F') recs = [...world.index.F.values()].filter((p) => tpl.parts.some((pt) => pt.piece === p.t) && c.DOOR.length && dist(p.x, p.z, c.DOOR) <= 2).slice(0, 2);
    } catch { recs = []; }
    v.wish = null;
    v.grants++;
    v.recent.push(w.tpl); if (v.recent.length > 5) v.recent.shift();
    v.nextWishAt = st.clock + gapAfter(v, w.dream);
    v._grantedAt = st.clock;
    st.stats.granted++;
    const g = gainWarmth(TUNE.COZY_WISH[w.size] || 6);
    let gift = null;
    if (TUNE.GIFT_AT.includes(st.stats.granted)) gift = giveGift(v);
    emit('granted', { villager: v.id, wish: w, reward: { cozy: g.gain, gift }, gain: g.gain, cozy: { before: g.before, after: g.after }, camp: false });
    // the granting moment (§7.7)
    const spot = recs[0];
    const me = posNow(v);
    const awakeOut = v._loc === 'out' && v.plan?.kind !== 'inside' && phaseOf(v, lastCtx.sky) !== 'night';
    v._grantUse = { recs, until: st.clock + TUNE.GRANT_USE };
    if (spot && awakeOut && me && Math.hypot(me[0] - (spot.x + 0.5) * CELL, me[2] - (spot.z + 0.5) * CELL) <= TUNE.GRANT_NEAR && (spot.y | 0) === 0 && world) {
      const sp = standBy(v, spot, 'cheer');
      if (sp) {
        endActivity(v);
        v._steps = [{ k: 'walk', to: sp.cell, end: sp.at, speed: TUNE.WALK_SPEED * TUNE.GRANT_RUSH },
          { k: 'pose', pose: 'cheer', at: sp.at, face: sp.face, dur: 0.6, cell: sp.cell, spot: sp.spot, cues: [{ kind: 'hop', first: 0, every: 99 }, { kind: 'hearts', first: 0.2, every: 99, at: [sp.at[0], 1.6, sp.at[2]] }] },
          { k: 'pose', pose: 'admire', at: sp.at, face: sp.face, dur: 3, cell: sp.cell }];
        cutPlan(v);
      }
    } else {
      cue('hearts', { id: v.id, home: v.homeId });
      if (v.plan.kind === 'inside' || v.plan.kind === 'pose') { endActivity(v); v._steps = []; cutPlan(v); }
    }
    return { gain: g.gain, gift };
  }
  function giveGift(v) {
    const locked = GIFT_IDS.filter((id) => !st.unlocks[id]);
    if (!locked.length) return null;
    let id = null;
    const mine = GIFT_IDS.find((g) => GIFTS[g].job === v.job);
    if (mine && !st.unlocks[mine]) id = mine;
    if (!id) {
      const present = new Set(villagers.map((u) => u.job));
      for (const j of JOB_ORDER) { const g = GIFT_IDS.find((x) => GIFTS[x].job === j); if (g && present.has(j) && !st.unlocks[g]) { id = g; break; } }
    }
    if (!id) for (const g of ['gift_gnome', 'gift_tea_table']) if (!st.unlocks[g]) { id = g; break; }
    if (!id) id = locked[0];
    st.unlocks[id] = { at: st.clock, from: v.name, job: v.job };
    st.stats.gifts++;
    emit('gift', { id, name: GIFTS[id].name, from: v.id, fromName: v.name });
    return id;
  }

  // ------------------------------------------------------------------------------------------ arrivals (§4)
  function vacancies() {
    const out = [];
    for (const [id, info] of homeInfo) {
      if (info.free <= 0) continue;
      out.push({ id, info });
    }
    return out;
  }
  function names() {
    const used = new Set(villagers.map((u) => u.name));
    if (traveller) used.add(traveller.name);
    return used;
  }
  function newTraveller(job, target, n) {
    const r = rng(hash32(st.seed, 'traveller', st.stats.arrivals, n || 0, job));
    const used = names();
    let name = NAMES.signature[job];
    if (villagers.some((u) => u.job === job) || used.has(name)) {
      const pool = NAMES.pool.filter((x) => !used.has(x));
      name = pool.length ? pool[Math.floor(r() * pool.length)] : NAMES.pool[Math.floor(r() * NAMES.pool.length)] + NAMES.suffix;
      for (let k = 0; used.has(name) && k < 50; k++) name += NAMES.suffix;
    }
    const prevTrait = villagers[villagers.length - 1]?.trait;
    const traits = TRAIT_ORDER.filter((t) => t !== prevTrait);
    const trait = traits[Math.floor(r() * traits.length)];
    return {
      job, name, trait, look: [int(r, 0, 2), int(r, 0, 5), int(r, 0, 5), int(r, 0, 2)], voice: +range(r, LOOK.voice[0], LOOK.voice[1]).toFixed(3),
      seed: hash32(st.seed, 'v', st.nextId, name), foot: target ? packFoot(target.foot) : null, due: null,
    };
  }
  function makeTravellerModel(t, target) {
    const v = {
      id: 'v' + st.nextId, name: t.name, job: t.job, trait: t.trait, voice: t.voice, seed: t.seed >>> 0,
      look: { outfit: t.look[0], skin: t.look[1], hair: t.look[2], build: t.look[3] },
      status: 'traveller', leaving: false, homeId: target.id, bed: null, feet: [], arrived: 0, grants: 0, plan: GONE, planId: 0, wish: null,
      flags: { pack: true, tool: false, basket: false, book: false, lantern: false }, mood: tierOf(cozyNow().value),
      since: st.clock, nextWishAt: 0, recent: [], cool: {},
    };
    initInner(v);
    v._target = target.id;
    return v;
  }
  function spawnTraveller(target, job, { first = false } = {}) {
    let t = st.traveller;
    if (!t || (job && t.job !== job)) t = newTraveller(job, target);
    t.foot = packFoot(target.foot);
    t.due = null;
    st.traveller = t;
    traveller = makeTravellerModel(t, target);
    lastArrivalAt = st.clock;
    const lane = world.lane;
    const du = doorUse(target);
    const last = lane[lane.length - 1];
    traveller._pos = lane[0].slice();
    traveller._loc = 'lane';
    traveller._steps = [
      { k: 'lane', pts: lane, speed: TUNE.TRAVELLER_SPEED, cell: world.nav.laneCell, onLot: true },
      { k: 'walk', to: du ? du.step : world.nav.laneCell, end: du ? du.stand : null, speed: TUNE.TRAVELLER_SPEED, door: target.id },
      { k: 'call', fn: (v) => moveInBegin(v) },
    ];
    traveller._cell = world.nav.laneCell;
    advance(traveller);
    traveller._pos = [last[0], last[1], last[2]];
    emit('traveller', { villager: traveller.id, homeId: target.id, first, migration: first && migration });
    return traveller;
  }
  function moveInBegin(v) {
    const b = B(v._target);
    const du = doorUse(b);
    if (!b || !b.home || !du) { turnBack(v); return; }
    const night = phaseOf(v, lastCtx.sky) === 'night' || nightSky(lastCtx.sky);
    v._moveIn = st.clock;
    const chimney = world.index.items.find((p) => p.t === 'chimney' && b.cells.has(ck(p.x, p.y, p.z)));
    const puffAt = chimney ? [(chimney.x + 0.5) * CELL, levelY(chimney.y) + 4.4, (chimney.z + 0.5) * CELL] : [du.stand[0], roofTop(b) + 0.5, du.stand[2]];
    v._steps = [
      { k: 'pose', pose: 'knock', at: du.stand, face: du.face, dur: TUNE.MOVEIN_ENTER, cell: du.step, cues: [{ kind: 'hop', first: 0, every: 99 }] },
      { k: 'door', dir: 'in', at: du.stand, face: du.face, homeId: b.id },
      { k: 'call', fn: () => { cue('pulse', { home: b.id }); cue('puff', { at: puffAt, n: 8, home: b.id }); cue('hearts', { at: [du.stand[0], 1.8, du.stand[2]], home: b.id }); } },
      insideStep(v, b, 'stand', TUNE.MOVEIN_TOAST - TUNE.MOVEIN_LIGHTS),
      { k: 'call', fn: (u) => joinRoster(u, b) },
      insideStep(v, b, 'stand', TUNE.MOVEIN_OUT - TUNE.MOVEIN_TOAST),
      { k: 'call', fn: (u) => moveInOut(u, night) },
    ];
    // the 1.0 s beat (lights on) lands after knock (0.6) + door (0.4)
  }
  function roofTop(b) {
    let top = levelY(b.lo) + 2.5;
    for (const k of b.cells) { const [x, , z] = k.split('|'); for (const rf of world.index.R.get(x + '|' + z) || []) top = Math.max(top, 0.25 + (rf.hs + rf.rise) * 1.25); }
    return top;
  }
  function joinRoster(v, b) {
    const free = b.beds.slice(0, b.capacity).filter((k) => !villagers.some((u) => u.bed === k));
    if (!free.length) { turnBack(v); return; }
    const first = villagers.length === 0 && st.stats.arrivals === 0;
    st.nextId++;
    st.stats.arrivals++;
    v.status = 'resident'; v.homeId = b.id; v.bed = free[0]; v.feet = [packFoot(b.foot)];
    v.arrived = st.clock; v.since = st.clock; v._statusAt = st.clock; v.flags.pack = false; v._target = null;
    v.nextWishAt = Infinity;
    villagers.push(v);
    traveller = null;
    st.traveller = null;
    v._first = first;
    emit('movein', { villager: v.id, homeId: b.id, homeName: theName(b), first });
    refreshHomes();
    charm = computeCharm();
    refreshCozy();
  }
  function moveInOut(v, night) {
    if (v.status !== 'resident') return;
    const g = gainWarmth(TUNE.COZY_MOVEIN);
    v._moveIn = null;
    v.nextWishAt = st.clock + (v._first ? TUNE.FIRST_WISH_DELAY : TUNE.LATER_WISH_DELAY);
    const b = homeB(v);
    if (night || phaseOf(v, lastCtx.sky) === 'night') { if (b) v._steps = [insideStep(v, b, 'sleep', Infinity)]; return g; }
    const ex = exitSteps(v);
    const du = doorUse(b);
    v._steps = [...ex, ...(du ? [doorPose(du, 'wave', du.out, 1.5, { cues: [{ kind: 'wave', first: 0, every: 99 }] })] : []),
      { k: 'call', fn: (u) => { if (u._steps.length === 0) u._steps = firstChoreSteps(u); } }];
    return g;
  }
  /** Right after moving in (§4.6): a chore by the door, on screen where the move-in happened (water the bloom nearest
   *  the main door within 3 cells, else sweep the doorstep), before the routine (lunch included) takes over. */
  function firstChoreSteps(v) {
    const b = homeB(v);
    const du = doorUse(b);
    if (!b || !du || !world) return [];
    const r = R(v, 'firstChore');
    const d = range(r, TUNE.FIRST_CHORE[0], TUNE.FIRST_CHORE[1]);
    v._act = 'chore';
    const blooms = outItems().filter((p) => S.BLOOM.has(p.t) && dist(p.x, p.z, [du.step]) <= 3)
      .sort((p, q) => dist(p.x, p.z, [du.step]) - dist(q.x, q.z, [du.step]) || ci(p.x, p.z) - ci(q.x, q.z));
    for (const p of blooms) {
      const sp = standBy(v, p, 'water');
      if (sp) return gotoPose(sp, 'water', d, { cues: [{ kind: 'drops', first: 1, every: 2, at: [(p.x + 0.5) * CELL, 0.4, (p.z + 0.5) * CELL] }], flags: { tool: v.job === 'gardener' } });
    }
    if (du.back) return [];
    return [{ k: 'walk', to: du.step, end: du.stand }, doorPose(du, 'sweep', du.out, d)];
  }
  function turnBack(v) {
    if (!v || v.status !== 'traveller') return;
    v.leaving = true;
    v._target = null;
    v._moveIn = null;
    const lane = world.lane;
    const back = lane.slice().reverse();
    const sit = [{ k: 'pose', pose: 'sit', at: back[0], face: -Math.PI / 2, dur: TUNE.TURN_BACK_WAIT, cell: world.nav.laneCell, ground: back[0], flags: { pack: true } },
      { k: 'lane', pts: back, speed: TUNE.WALK_SPEED }, { k: 'call', fn: travellerGone }, { k: 'gone' }];
    if (v._loc === 'lane' && v.plan.kind === 'walk') { v._steps = sit; return; }     // keep walking to the lane mouth, then sit
    v._steps = [{ k: 'walk', to: world.nav.laneCell, end: back[0] }, ...sit];
    cutPlan(v);
  }
  function travellerGone() {
    if (st.traveller) st.traveller.due = null;
  }
  function retargetTraveller() {
    const v = traveller;
    if (!v) return;
    const tgt = homeInfo.get(v._target);
    const settled = st.clock - lastSetWorld >= TUNE.SETTLE;
    if (v.leaving) {
      // a vacancy came back while sitting on the pack: go again
      const vac = bestVacancy();
      if (vac && v.plan.kind === 'pose') {
        v.leaving = false; v._target = vac.id; refreshHomes();
        const du = doorUse(vac.info.b);
        v._steps = [{ k: 'walk', to: du ? du.step : world.nav.laneCell, end: du ? du.stand : null, speed: TUNE.TRAVELLER_SPEED }, { k: 'call', fn: (u) => moveInBegin(u) }];
        cutPlan(v);
      }
      return;
    }
    if (v._moveIn) return;
    if (tgt && tgt.free >= 0 && tgt.b.home) return;
    if (!settled) return;
    const vac = bestVacancy();
    if (vac) {
      v._target = vac.id; refreshHomes();
      const du = doorUse(vac.info.b);
      const onLane = v._loc === 'lane';
      v._steps = onLane ? [v._steps[0] && v._steps[0].k === 'lane' ? v._steps[0] : null, { k: 'walk', to: du ? du.step : world.nav.laneCell, end: du ? du.stand : null, speed: TUNE.TRAVELLER_SPEED }, { k: 'call', fn: (u) => moveInBegin(u) }].filter(Boolean)
        : [{ k: 'walk', to: du ? du.step : world.nav.laneCell, end: du ? du.stand : null, speed: TUNE.TRAVELLER_SPEED }, { k: 'call', fn: (u) => moveInBegin(u) }];
      if (!onLane) cutPlan(v);
      if (st.traveller) st.traveller.foot = packFoot(vac.info.b.foot);
      return;
    }
    turnBack(v);
  }
  function bestVacancy() {
    const list = [];
    for (const { id, info } of vacancies()) {
      const job = traveller ? traveller.job : null;
      const okJob = job ? (info.evals.met.includes(job) || villagers.length === 0) : !!info.choice.job;
      if (!okJob) continue;
      const key = packFoot(info.b.foot);
      list.push({ id, info, since: vacancy.get(key)?.since ?? st.clock });
    }
    list.sort((a, c) => a.since - c.since || (a.id < c.id ? -1 : 1));
    return list[0] || null;
  }
  function arrivals(guided) {
    if (!world) return;
    // vacancy timers (oldest first), reset when a vacancy disappears once settled
    const settled = st.clock - lastSetWorld >= TUNE.SETTLE;
    const live = new Set();
    for (const { id, info } of vacancies()) {
      if (!info.choice.job) continue;
      const key = packFoot(info.b.foot);
      live.add(key);
      if (!vacancy.has(key)) vacancy.set(key, { since: st.clock });
    }
    if (settled) for (const k of [...vacancy.keys()]) if (!live.has(k)) vacancy.delete(k);
    if (traveller) { retargetTraveller(); return; }
    if (guided || sim.intro) return;
    if (villagers.length >= TUNE.MAX_VILLAGERS) return;
    if (villagers.some((u) => u.status === 'camping')) return;            // campers return first (via re-binding)
    const vac = bestVacancy();
    if (!vac) return;
    const first = villagers.length === 0 && st.stats.arrivals === 0;
    let due;
    if (guidedDoneAt > -Infinity && st.clock - guidedDoneAt < 60) due = Math.max(vac.since, guidedDoneAt) + TUNE.GUIDED_ARRIVAL_DELAY;
    else if (first) due = Math.max(vac.since, introAt ?? -Infinity) + TUNE.FIRST_ARRIVAL_DELAY;
    else {
      const c = cozyNow().value;
      const r = Rt('arrive', st.stats.arrivals);
      const delay = TUNE.ARRIVAL_BASE * lerp(TUNE.ARRIVAL_COZY[0], TUNE.ARRIVAL_COZY[1], c / 100) * range(r, TUNE.ARRIVAL_JITTER[0], TUNE.ARRIVAL_JITTER[1]);
      due = Math.max(vac.since, lastArrivalAt) + delay;
    }
    if (st.traveller) st.traveller.due = due;
    if (st.clock + 1e-9 < due) return;
    const job = st.traveller && (vac.info.evals.met.includes(st.traveller.job) || first) ? st.traveller.job : vac.info.choice.job;
    spawnTraveller(vac.info.b, job, { first });
  }

  // ------------------------------------------------------------------------------------------ passer-by (§4.7)
  function passerbyTick() {
    if (!world || !restored) return;
    if (passerby) {
      if (passerby.plan.kind === 'gone') passerby = null;
      return;
    }
    if (villagers.length || world.homes.length || traveller) return;
    if (passers >= TUNE.PASSERBY_MAX) return;
    // while a card covers the meadow (the first-visit welcome card, the menu), nobody passes: the first one comes
    // PASSERBY_FIRST after it closes, so the player sees the wave (index.js sets holdPasserby)
    if (sim.holdPasserby) { passerNext = Math.max(passerNext ?? 0, st.clock + TUNE.PASSERBY_FIRST); return; }
    if (passerNext === null) passerNext = restoredAt + TUNE.PASSERBY_FIRST;
    if (st.clock < passerNext) return;
    spawnPasserby();
  }
  function spawnPasserby() {
    if (!world) return null;
    passers++;
    passerNext = st.clock + TUNE.PASSERBY_EVERY;
    const r = Rt('passer', passers);
    const job = JOB_ORDER[Math.floor(r() * JOB_ORDER.length)];
    const v = {
      id: 'p' + passers, name: '', job, trait: 'shy', voice: 1, seed: hash32(st.seed, 'p', passers),
      look: { outfit: int(r, 0, 2), skin: int(r, 0, 5), hair: int(r, 0, 5), build: int(r, 0, 2) },
      status: 'passerby', leaving: false, homeId: null, bed: null, feet: [], arrived: 0, grants: 0, plan: GONE, planId: 0, wish: null,
      flags: { pack: true, tool: false, basket: false, book: false, lantern: false }, mood: 0, since: st.clock, nextWishAt: 0, recent: [], cool: {},
    };
    initInner(v);
    const route = world.passerby.route;
    const view = world.passerby.view;
    const end = route[route.length - 1];
    v._steps = [
      { k: 'lane', pts: route, speed: TUNE.TRAVELLER_SPEED, cell: view },
      { k: 'pose', pose: 'wave', at: end, face: 0, dur: TUNE.PASSERBY_WAVE, cell: view, cues: [{ kind: 'note', first: 0.3, every: 99 }, { kind: 'wave', first: 0, every: 99 }] },
      { k: 'pose', pose: 'admire', at: end, face: 0, dur: TUNE.PASSERBY_LOOK, cell: view },
      { k: 'lane', pts: route.slice().reverse(), speed: TUNE.TRAVELLER_SPEED },
      { k: 'gone' },
    ];
    v._pos = route[0].slice();
    advance(v);
    passerby = v;
    emit('passerby', { id: v.id });
    return v;
  }

  // ------------------------------------------------------------------------------------------ night strolls (§5.3)
  function nightStrolls() {
    if (!world) return;
    if (nightStrollAt === null) nightStrollAt = st.clock + TUNE.NIGHT_STROLL_EVERY;
    if (st.clock < nightStrollAt) return;
    nightStrollAt = st.clock + TUNE.NIGHT_STROLL_EVERY;
    // only villagers whose own night it is, with time for a stroll before they wake (flowing time: one game hour is
    // 25 s, so NIGHT_STROLL_WAKE_GAP h ≈ a stroll and the walks there and back)
    const sky = lastCtx.sky;
    const sleepers = villagers.filter((u) => u.status === 'resident' && u._loc === 'in' && u.plan?.kind === 'inside' && u.plan.pose === 'sleep' && homeB(u)
      && phaseOf(u, sky) === 'night' && (!lastCtx.flowing || hoursToWake(u, sky) >= TUNE.NIGHT_STROLL_WAKE_GAP));
    if (!sleepers.length) return;
    const pref = sleepers.filter((u) => u.trait === 'owl' || u.trait === 'stargazer');
    const v = pref.length ? pref[strollRR % pref.length] : sleepers[strollRR % sleepers.length];
    strollRR++;
    const b = homeB(v);
    const lookup = v.trait === 'stargazer' && R(v, 'star')() < 0.6;
    const ex = exitSteps(v);
    let mid;
    if (lookup) {
      const f = world.nav.nearestFree(homeDoorCell(v)[0] + 2, homeDoorCell(v)[1] + 2, 4, true);
      mid = f ? [{ k: 'walk', to: f }, { k: 'pose', pose: 'lookup', at: world.nav.centre(f[0], f[1]), face: 0, dur: TUNE.NIGHT_STROLL_LEN, cell: f }] : [];
    } else {
      const hang = pickHangout(v, 'night', true);
      mid = hang && R(v, 'ns')() < 0.5 ? spotSteps(hang, TUNE.NIGHT_STROLL_LEN, null, { flags: { lantern: true } }) : strollSteps(v, true);
      if (mid[1]) mid[1].dur = TUNE.NIGHT_STROLL_LEN;
    }
    if (!mid.length) return;
    endActivity(v);
    v._act = 'nightStroll';
    // back in bed it is an ordinary night's sleep again, which the phase change ends at the wake hour
    v._steps = [...ex, ...mid, ...enterSteps(v, b, [{ k: 'call', fn: (u) => { u._act = 'sleep'; } }, insideStep(v, b, 'sleep', Infinity)])];
    v.plan = { ...v.plan, t1: st.clock };
  }

  // ------------------------------------------------------------------------------------------ hints (§3.7)
  function hintsTick(guided) {
    if (!world) return;
    const live = new Set();
    const cand = [...world.buildings.filter((b) => !b.home), ...world.shells.filter((s) => !s.partOf)];
    let shownNow = 0;
    for (const [, h] of hintState) if (h.kind === 'almost' && h.shownAt !== null && st.clock - h.shownAt < TUNE.ALMOST_SHOW) shownNow++;
    for (const b of cand) {
      const key = packFoot(b.foot);
      live.add(key);
      const sig = b.reasons.join(',') + '|' + b.cells.size + '|' + b.flaws + '|' + b.beds.length;
      let h = hintState.get(key);
      if (!h) {
        for (const [k2, h2] of hintState) if (!live.has(k2) && footOverlap(k2, key) >= TUNE.HOME_MATCH) { h = h2; hintState.delete(k2); break; }
        if (!h) h = { sig, since: st.clock, shownAt: null, shown: false, kind: 'almost' };
        hintState.set(key, h);
      }
      if (h.sig !== sig) { h.sig = sig; h.since = st.clock; }
      const waiting = villagers.some((u) => u.status === 'waiting' && u.homeId === b.id);
      if (waiting) { h.kind = 'fix'; continue; }
      h.kind = 'almost';
      // a bed placed inside lifts the mute
      const mi = st.muted.findIndex((f) => footOverlap(f, key) >= TUNE.HOME_MATCH);
      if (mi >= 0 && b.beds.length) st.muted.splice(mi, 1);
      if (h.shown || guided) continue;
      if (!almostEligible(b)) continue;
      if (st.clock - h.since < TUNE.ALMOST_DELAY) continue;
      if (shownNow >= TUNE.ALMOST_MAX) continue;
      h.shown = true; h.shownAt = st.clock; shownNow++;
    }
    for (const k of [...hintState.keys()]) if (!live.has(k) && hintState.get(k).kind !== 'vacancy') hintState.get(k).gone = true;
    // vacancy hints on Homes with a free bed that match no recipe (after the first villager). Never while someone is
    // camping or waiting without a building, or a binding change is still settling: they take free beds first
    // (§4.2), so that bed is about to be filled and the bubble would flash and vanish (T1.5)
    const tier = cozyNow().tier;
    const bedless = pending || villagers.some((u) => u.status === 'camping' || (u.status === 'waiting' && !B(u.homeId)));
    for (const [id, info] of homeInfo) {
      const b = info.b;
      const key = 'vac|' + packFoot(b.foot);
      const vac = villagers.length > 0 && info.free > 0 && !info.choice.job && !bedless;
      let h = hintState.get(key);
      if (!vac) { if (h) h.on = false; continue; }
      const sig = JOB_ORDER.map((j) => (info.evals.missing[j] || []).map((m) => m.have).join('.')).join('|');
      if (!h) { h = { kind: 'vacancy', shownAt: st.clock, sig, tier, on: true }; hintState.set(key, h); continue; }
      if (!h.on || h.sig !== sig || h.tier !== tier) { if (h.sig !== sig || h.tier !== tier || !h.on) h.shownAt = st.clock; h.sig = sig; h.tier = tier; h.on = true; }
    }
  }
  function almostEligible(b) {
    if (b.home) return false;
    if (b.cells.size < 4 && !b.beds.length) return false;         // a bedded hut of any size gets its hint (T1.1)
    if (!b.beds.length && b.cells.size <= TUNE.SHED_CELLS) return false;
    if (villagers.some((u) => u.homeId === b.id)) return false;
    const key = packFoot(b.foot);
    if (st.muted.some((f) => footOverlap(f, key) >= TUNE.HOME_MATCH)) return false;
    return (b.roofedFrac >= 0.5 && b.doors.length > 0) || b.beds.length > 0;
  }
  /** A building the town card lists under "Almost homes" (§3.7): every almost-eligible one, and also the small bedless
   *  sheds that never get a bubble (their card line is the only hint, §14.1), unless muted. */
  function listedOnCard(b) {
    if (almostEligible(b)) return true;
    if (b.home || b.shell || (b.cells.size < 4 && !b.beds.length) || villagers.some((u) => u.homeId === b.id)) return false;
    const key = packFoot(b.foot);
    return !st.muted.some((f) => footOverlap(f, key) >= TUNE.HOME_MATCH);
  }
  function missingOf(b) {
    const out = [];
    for (const r of b.reasons) {
      const ht = HINT_TEXT[r];
      if (r === 'door') out.push({ kind: 'door', icon: ht.icon, text: ht.text, n: 1 });
      else if (r === 'gaps') out.push({ kind: 'gaps', icon: ht.icon, text: ht.text.replace('{n}', b.gaps.length), n: b.gaps.length });
      else if (r === 'roof') out.push({ kind: 'roof', icon: ht.icon, text: b.roofHint ? ht.upstairs : (b.unroofed.length === 1 ? ht.one : ht.text.replace('{n}', b.unroofed.length)), n: b.roofHint ? b.roofHint.length : b.unroofed.length });
      else if (r === 'bed') out.push({ kind: 'bed', icon: ht.icon, text: ht.text, n: 1 });
    }
    return out;
  }

  // ------------------------------------------------------------------------------------------ setWorld / tick
  function setWorld(model, { restore = false } = {}) {
    try {
      if (!model) return;
      const first = !restored;
      world = model;
      inside = insideSet(model.buildings);
      lastSetWorld = st.clock;
      charm = computeCharm();
      if (restore || first) {
        // the silent boot binding (§3.5)
        const prop = propose();
        const changes = silentRefresh(prop);
        commit(changes, { silent: true });
        for (const v of villagers) {
          if (v._wishSave) {
            const ws = v._wishSave; delete v._wishSave;
            if (v.status === 'resident' && TEMPLATE[ws.tpl] && !changes.some(([u]) => u === v)) {
              v.wish = { ...ws, homeId: v.homeId, piece: TEMPLATE[ws.tpl].parts[0].piece, ...textOf(ws.tpl, { town: { villagers } }, ws.friend) };
            }
          }
        }
        const campers = villagers.filter((u) => u.status === 'camping');
        note = campers.length === 1 ? STATUS_TEXT.noteCampOne.replace('{name}', campers[0].name) : campers.length > 1 ? STATUS_TEXT.noteCamp.replace('{n}', campers.length) : null;
        updateTents();
        refreshHomes();
        restored = true; restoredAt = st.clock;
        for (const v of villagers) placeFor(v);
        if (st.traveller) st.traveller.due = null;
        refreshCozy();
        hintsTick(lastCtx.guided);
        return;
      }
      refreshHomes();
      // nav: people built over or walled in hop / slip at once
      unstick();
      // a villager posed inside a building that no longer exists steps out at once
      for (const v of villagers) {
        if (v._loc !== 'in') continue;
        const b = buildingAt(v);
        if (b) { v._inHome = b.id; recheckInside(v, b); continue; }
        const old = v.feet[0] ? unpackFoot(v.feet[0]) : [];
        const c = old.length ? world.nav.nearestFree(old[0][0], old[0][1], 6, true) : world.nav.nearestFree(0, 0, 11, true);
        endActivity(v); v._steps = [{ k: 'pose', pose: 'lookup', at: c ? world.nav.centre(c[0], c[1]) : [0, 0, 0], face: 0, dur: 4, cell: c || [0, 0] }];
        v._loc = 'out';
        setPlan(v, startStep(v, { k: 'slip', to: c || world.nav.laneCell }));
      }
      // silent refreshes now; real changes wait for SETTLE of quiet (tick)
      const changes = silentRefresh(propose());
      pending = changes.length > 0;
      grantCheck();
      charm = computeCharm();
      refreshCozy();
    } catch (e) {
      sim.lastError = e;
    }
  }

  function tick(dt = TICK, ctx = {}) {
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    try {
      lastCtx = { sky: typeof ctx.sky === 'number' ? ctx.sky : lastCtx.sky, flowing: !!ctx.flowing, guided: !!ctx.guided, night: +ctx.night || 0 };
      st.clock += dt;
      tickN++;
      sim.time = st.clock;
      pathBudget = TUNE.PATHS_PER_FRAME;
      if (!world || !restored) return;
      const guided = lastCtx.guided;
      if (guidedWas && !guided) guidedDoneAt = st.clock;
      guidedWas = guided;
      // settle pending binding changes after SETTLE s of quiet (§3.5)
      if (pending && st.clock - lastSetWorld >= TUNE.SETTLE) {
        const changes = silentRefresh(propose());
        pending = false;
        if (changes.length) commit(changes);
        charm = computeCharm(); refreshCozy();
      }
      // town day
      const day = Math.floor(st.clock / TUNE.DAY_SECONDS);
      if (day !== dayWas) { dayWas = day; emit('day', { day }); }
      // Cozy drift (never while guided)
      if (!guided) {
        st._drift = (st._drift || 0) + dt;
        while (st._drift >= TUNE.COZY_DRIFT_EVERY) { st._drift -= TUNE.COZY_DRIFT_EVERY; st.warmth = Math.max(0, st.warmth - Math.max(1, st.warmth / TUNE.COZY_DRIFT_DIV)); refreshCozy(); }
      }
      // periodic checks (every 2 s)
      if (st.clock - lastCheck >= 2) {
        lastCheck = st.clock;
        // campers / moving: re-proposals when beds free up without a world change
        if (!pending) { const ch = silentRefresh(propose()); if (ch.length) { pending = true; } }
        refreshHomes();
        wishChecks(guided);
        hintsTick(guided);
        for (const v of villagers) if (v.status === 'waiting' && st.clock - v._statusAt >= TUNE.FIXUP_DELAY) v._fixShown = true;
      }
      arrivals(guided);                              // every tick: a due traveller appears on time
      passerbyTick();
      nightStrolls();
      // phases: flowing activities end when the phase ends
      for (const v of villagers) {
        const ph = phaseOf(v, lastCtx.sky);
        if (v._phase && ph !== v._phase && lastCtx.flowing && !v._moveIn && v._act !== 'use') {
          v._phase = ph;
          v._phaseAt = st.clock;
          endActivity(v); v._steps = [];
          if (v.plan.kind === 'pose' || v.plan.kind === 'inside') v.plan = { ...v.plan, t1: st.clock };
        }
      }
      // advance plans (deferred ones first)
      const actors = [...villagers.filter((v) => v._deferred), ...villagers.filter((v) => !v._deferred)];
      if (traveller) actors.push(traveller);
      if (passerby) actors.push(passerby);
      for (const v of actors) {
        const p = v.plan;
        if (p.kind === 'gone' && v.status !== 'passerby' && v.status !== 'traveller' && !v._steps.length && v._loc === 'gone') { placeFor(v); continue; }
        if (p.kind !== 'gone' && (p.t1 === Infinity || st.clock < p.t1)) { emitCues(v); continue; }
        if (p.kind === 'gone' && (v.status === 'passerby')) continue;
        emitCues(v);
        // Phase 2 hook (§16): one `work` sim event per finished work bout (not put on the bus in Phase 1)
        if (p.kind === 'pose' && v._act === 'work' && v.flags.tool && v.status === 'resident') emit('work', { villager: v.id, job: v.job, produces: JOBS[v.job]?.work?.produces || null });
        // trips started within HURRY_WINDOW of a phase change hurry
        if (lastCtx.flowing && v._phaseAt !== undefined && st.clock - v._phaseAt <= TUNE.HURRY_WINDOW && v._steps[0]?.k === 'walk') v._steps[0].hurry = true;
        advance(v);
        // short chained plans (doors, knocks) that already ended inside this tick hand over at once
        for (let k = 0; k < 3 && v.plan.kind !== 'gone' && Number.isFinite(v.plan.t1) && v.plan.t1 <= st.clock; k++) { emitCues(v); if (!advance(v)) break; }
        if (v.status === 'traveller' && v.plan.kind === 'gone') traveller = null;
      }
      // humming while walking in a cheerful town (§9.2): a ♪ cue and the hum foley, every 20–40 s (Cheerful) or
      // 10–20 s (Glowing) per villager
      const tier = tierOf(cozyNow().value);
      if (tier >= 2) {
        const [a, b] = tier >= 3 ? TUNE.HUM_GLOWING : TUNE.HUM_CHEERFUL;
        for (const v of villagers) {
          if (v._loc !== 'out' || v.plan.kind !== 'walk') continue;
          if (v._humAt === undefined || v._humAt > st.clock + b) v._humAt = st.clock + range(R(v, 'hum0'), a, b) * 0.5;
          if (st.clock < v._humAt) continue;
          v._humAt = st.clock + range(R(v, 'hum'), a, b);
          const at = posNow(v);
          cue('note', { id: v.id, at: at ? [at[0], at[1] + 1.7, at[2]] : undefined });
          cue('hum', { id: v.id });
        }
      }
      // presentation flags
      const night = nightSky(lastCtx.sky);
      for (const v of actors) {
        v.flags.lantern = night && v._loc !== 'in' && v.plan.kind !== 'inside' && v.plan.kind !== 'gone';
        if (v.status === 'traveller' || v.status === 'passerby') v.flags.pack = !v._moveIn || v.plan.kind === 'walk';
      }
      // town time with someone outdoors
      totalT += dt;
      if ([...villagers, ...(traveller ? [traveller] : [])].some((v) => v._loc === 'out' || v._loc === 'lane')) outdoorT += dt;
    } catch (e) {
      sim.lastError = e;
    } finally {
      if (typeof performance !== 'undefined') { tickMsSum += performance.now() - t0; tickCount++; }
    }
  }
  function emitCues(v) {
    const sch = v._cueSched;
    if (!sch || !sch.length) return;
    const p = v.plan;
    for (const c of sch) {
      while (c.next <= st.clock && c.next < (p.t1 ?? Infinity)) {
        const at = c.at || posNow(v);
        cues.push({ t: c.next, kind: c.kind, id: v.id, at, ...(c.n ? { n: c.n } : {}) });
        c.next += c.every || 1e9;
      }
    }
  }

  // ------------------------------------------------------------------------------------------ views for index.js / hud
  function homeViews() {
    if (!world) return [];
    const out = [];
    const views = [...world.buildings, ...world.shells.filter((s) => !s.partOf)];
    for (const b of views) {
      const info = homeInfo.get(b.id);
      const key = packFoot(b.foot);
      const h = hintState.get(key), hv = hintState.get('vac|' + key);
      const res = villagers.filter((u) => u.homeId === b.id).map((u) => u.id);
      const du = doorUse(b);
      let status;
      if (b.home) status = info && info.free > 0 ? (info.choice.job ? 'home' : 'vacancy') : 'full';
      else status = villagers.some((u) => u.status === 'waiting' && u.homeId === b.id) ? 'fix' : 'almost';
      let bubble = null;
      if (status === 'fix' && villagers.some((u) => u.status === 'waiting' && u.homeId === b.id && u._fixShown)) bubble = 'fix';
      else if (status === 'almost' && h && h.shownAt !== null && st.clock - h.shownAt < TUNE.ALMOST_SHOW && almostEligible(b)) bubble = 'almost';
      else if (status === 'vacancy' && hv && hv.on && st.clock - hv.shownAt < TUNE.VACANCY_SHOW) bubble = 'vacancy';
      const cen = centreCell(b);
      out.push({
        id: b.id, name: b.name, theName: theName(b), home: b.home, shell: !!b.shell, door: du ? du.stand : null, doorCell: du ? du.step : null,
        beds: b.beds.length, capacity: b.capacity, residents: res, free: info ? info.free : 0, status, bubble,
        missing: missingOf(b), reasons: b.reasons.slice(), cells: b.cells.size, almost: !b.home && almostEligible(b), listed: !b.home && listedOnCard(b),
        fit: info ? info.evals.fit : null, best: info ? info.choice.job : null, runnersUp: info ? info.choice.runnersUp : [],
        roofAnchor: [(cen[0] + 0.5) * CELL, roofTop(b) + 0.6, (cen[1] + 0.5) * CELL], foot: packFoot(b.foot),
        asleep: res.length > 0 && res.every((id) => { const u = villagers.find((x) => x.id === id); return u && u.plan?.kind === 'inside' && u.plan.pose === 'sleep'; }),
        lit: res.some((id) => { const u = villagers.find((x) => x.id === id); return u && u._loc === 'in'; }),
        // light spill level (§5.6): 1 someone inside and awake · SPILL_ASLEEP all inside asleep · 0 nobody home
        light: (() => {
          const ins = villagers.filter((u) => u._loc === 'in' && (u._inHome === b.id || u.homeId === b.id) && u.plan?.kind === 'inside');
          if (!ins.length) return 0;
          return ins.some((u) => u.plan.pose !== 'sleep') ? 1 : TUNE.SPILL_ASLEEP;
        })(),
        windows: b.windows, doors: b.doors, lo: b.lo,
      });
    }
    return out;
  }
  function couldMoveIn() {
    const rows = [];
    if (!world) return rows;
    // campers (and waiting villagers whose building is gone) take a free bed before any newcomer (§4.2): while
    // anyone waits for a bed, "one more bed" brings them, not a traveller (T1.7)
    const camper = villagers.find((u) => u.status === 'camping' || (u.status === 'waiting' && !B(u.homeId)));
    for (const [id, info] of homeInfo) {
      const b = info.b;
      if (info.free <= 0) {
        if (b.beds.length >= TUNE.BEDS_PER_HOME_MAX) continue;            // another bed would not raise its capacity
        const j = info.choice.job;
        if (camper) rows.push({ homeId: id, homeName: theName(b), kind: 'bed', job: camper.job, name: camper.name, camper: camper.id, missing: [] });
        else if (j && villagers.length < TUNE.MAX_VILLAGERS) rows.push({ homeId: id, homeName: theName(b), kind: 'bed', job: j, name: previewName(j), missing: [] });
      } else if (!info.choice.job) {
        const close = closestJobs(info.evals, true).slice(0, 3);
        for (const j of close) rows.push({ homeId: id, homeName: theName(b), kind: 'free', job: j, missing: info.evals.missing[j] || [] });
      }
    }
    return rows;
  }
  /** The name the next traveller of this job would have (the town card names every runner-up the same way). */
  function previewName(job) {
    if (st.traveller && st.traveller.job === job) return st.traveller.name;
    try { return newTraveller(job, null).name; } catch { return null; }
  }

  // ------------------------------------------------------------------------------------------ plans for Show me (§7.6, §3.7)
  function planFor(target = {}) {
    if (!world) return null;
    const town = townForWishes();
    if (target.villager) {
      const v = villagers.find((u) => u.id === target.villager || u.name === target.villager);
      if (!v || !v.wish) return null;
      const tpl = TEMPLATE[v.wish.tpl];
      const ctx = wishCtx(world, town, v);
      const plan = findSpots(tpl, ctx, v.wish);
      const r0 = plan.recs[0];
      const inside = !!(r0 && homeB(v)?.cells.has(ck(r0.rec.x, r0.rec.y | 0, r0.rec.z)) && tpl.where === 'inside');
      return { plan, inside, level: r0 ? r0.level : 0, text: v.wish.text, villager: v.id };
    }
    if (target.home && target.hint) {
      const b = B(target.home);
      if (!b) return null;
      const plan = hintSpots(target.hint, b, world);
      const r0 = plan.recs[0];
      return { plan, inside: target.hint === 'bed', level: r0 ? r0.level : b.lo, text: HINT_TEXT[target.hint]?.text || '', seeAll: target.hint === 'roof' };
    }
    if (target.home && target.job) {
      const info = homeInfo.get(target.home);
      if (!info) return null;
      const m = (info.evals.missing[target.job] || [])[0];
      if (!m) return null;
      const plan = termSpots(m, info.b, world, town);
      const r0 = plan.recs[0];
      return { plan, inside: m.where === 'inside', level: r0 ? r0.level : 0, text: m.text, job: target.job };
    }
    if (target.camp) {
      // a Home with free floor inside and capacity < 4 → a ghost bed there; else a free 6 × 6 area
      const cands = world.homes.filter((h) => h.capacity < TUNE.BEDS_PER_HOME_MAX).map((h) => ({ h, free: [...h.cells].filter((k) => !world.index.I.has(k)).length })).filter((x) => x.free > 0);
      cands.sort((a, c) => c.free - a.free || (a.h.id < c.h.id ? -1 : 1));
      for (const { h } of cands) {
        const plan = hintSpots('bed', h, world);
        if (plan.complete) return { plan, inside: true, level: plan.recs[0].level, text: WISH_TEXT.w_camp.text.replace('{n}', villagers.filter((u) => u.status === 'camping').length) };
      }
      const v = { id: '_camp', job: null, trait: null, homeId: null, cool: {}, recent: [] };
      const ctx = wishCtx(world, town, v);
      if (!campArea) campArea = TEMPLATE.w_neighbour.freeze(ctx);
      const plan = findSpots(TEMPLATE.w_neighbour, ctx, { frozen: campArea });
      return { plan, inside: false, level: 0, text: WISH_TEXT.w_camp.text.replace('{n}', villagers.filter((u) => u.status === 'camping').length), note: WISH_TEXT.w_camp.note };
    }
    return null;
  }

  // ------------------------------------------------------------------------------------------ serialize
  function serialize() {
    const out = {
      v: VERSION, seed: st.seed, clock: st.clock, lastSeen: st.lastSeen, warmth: st.warmth,
      stats: { ...st.stats }, nextId: st.nextId, unlocks: JSON.parse(JSON.stringify(st.unlocks)), seen: st.seen.slice(),
      tips: { ...st.tips }, muted: st.muted.slice(0, TUNE.MUTED_MAX), campGrants: st.campGrants.slice(-TUNE.CAMP_GRANTS_MAX),
      villagers: villagers.map((v) => {
        const w = v.wish || v._wishSave || null;
        return {
          id: v.id, name: v.name, job: v.job, trait: v.trait, look: [v.look.outfit, v.look.skin, v.look.hair, v.look.build], voice: v.voice, seed: v.seed,
          status: v.status, home: v.feet.length || v.bed || v._lastBed ? { feet: v.feet.slice(0, TUNE.FEET_KEPT), bed: v.bed || v._lastBed || null } : null,
          since: v.since, arrived: v.arrived, grants: v.grants,
          wish: w ? { tpl: w.tpl, born: w.born, size: w.size, dream: !!w.dream, base: w.base ?? null, friend: w.friend ?? null, frozen: w.frozen ?? null } : null,
          nextWishAt: Number.isFinite(v.nextWishAt) ? v.nextWishAt : st.clock + TUNE.LATER_WISH_DELAY, recent: v.recent.slice(-5), cool: { ...v.cool },
        };
      }),
      traveller: st.traveller ? { ...st.traveller, look: st.traveller.look.slice() } : null,
    };
    return out;
  }

  // ------------------------------------------------------------------------------------------ debug (§12.4)
  const who = (id) => villagers.find((u) => u.id === id || u.name === id) || (traveller && (traveller.id === id || traveller.name === id) ? traveller : null);
  const debug = {
    spawn(job = null, opts = {}) {
      if (!world) return null;
      const j = JOBS[job] ? job : JOB_ORDER[villagers.length % JOB_ORDER.length];
      if (opts.travel) {
        const vac = bestVacancy() || [...homeInfo.values()].filter((i) => i.free > 0).map((info) => ({ info }))[0];
        if (!vac || traveller) return null;
        return spawnTraveller(vac.info.b, j, { first: villagers.length === 0 && st.stats.arrivals === 0 }).id;
      }
      if (villagers.length >= TUNE.MAX_VILLAGERS) return null;
      const t = newTraveller(j, null, villagers.length + 1);
      if (opts.name) t.name = String(opts.name).slice(0, 24);
      if (TRAITS[opts.trait]) t.trait = opts.trait;
      const target = [...homeInfo.values()].filter((i) => i.free > 0).sort((a, c) => (a.b.id < c.b.id ? -1 : 1))[0];
      const v = makeTravellerModel(t, target ? target.b : { id: null, foot: [] });
      // never a pending traveller's id: it is 'v' + nextId and only takes nextId as it joins the roster, so a villager
      // spawned while one is on the way got its id, and the two models shared one actor (R6 T6.4)
      let n = st.nextId;
      while (villagers.some((u) => u.id === 'v' + n) || (traveller && traveller.id === 'v' + n)) n++;
      v.id = 'v' + n;
      st.nextId = n + 1;
      st.stats.arrivals++;
      if (target) {
        const free = target.b.beds.slice(0, target.b.capacity).filter((k) => !villagers.some((u) => u.bed === k));
        v.status = 'resident'; v.homeId = target.b.id; v.bed = free[0]; v.feet = [packFoot(target.b.foot)];
      } else { v.status = 'camping'; v.homeId = null; }
      v.flags.pack = false; v._target = null;
      v.arrived = st.clock; v.since = st.clock; v._statusAt = st.clock;
      v.nextWishAt = st.clock + (villagers.length === 0 ? TUNE.FIRST_WISH_DELAY : TUNE.LATER_WISH_DELAY);
      villagers.push(v);
      if (v.status === 'camping') updateTents();
      refreshHomes(); charm = computeCharm(); refreshCozy();
      placeFor(v);
      return v.id;
    },
    traveller(job = null) {
      if (!world || traveller) return null;
      const vac = bestVacancy() || [...homeInfo.values()].filter((i) => i.free > 0).map((info) => ({ info }))[0];
      if (!vac) return null;
      return spawnTraveller(vac.info.b, JOBS[job] ? job : vac.info.choice.job || 'gardener', { first: villagers.length === 0 && st.stats.arrivals === 0 }).id;
    },
    passerby() { return spawnPasserby()?.id || null; },
    wish(id, tpl) {
      const v = who(id);
      if (!v) return { ok: false, reason: 'no such villager' };
      if (v.wish) { v.wish = null; }
      const r = tryCreateWish(v, false, tpl);
      return { ok: r.ok, reason: r.reason || null, plan: r.plan || null };
    },
    grant(id) { const v = who(id); return v && v.wish ? grantWish(v) : null; },
    expire(id) { const v = who(id); if (v && v.wish) { expireWish(v); return true; } return false; },
    setCozy(n) { st.warmth = clamp(n - charm, 0, TUNE.WARMTH_MAX); refreshCozy(); return cozyNow(); },
    unlock(id) {
      if (!GIFTS[id] || st.unlocks[id]) return false;
      st.unlocks[id] = { at: st.clock, from: '', job: GIFTS[id].job };
      return true;
    },
    unlockAll() { for (const id of GIFT_IDS) debug.unlock(id); return GIFT_IDS.slice(); },
    advance(seconds, ctx = lastCtx) {
      const n = Math.max(0, Math.round(seconds / TICK));
      for (let k = 0; k < n; k++) tick(TICK, ctx);
      return st.clock;
    },
    stuck() {
      if (!world) return [];
      const nav = world.nav, out = [];
      for (const v of villagers) {
        if (v._loc !== 'out' || !v._cell || v.status === 'camping') continue;
        if (v.plan.kind === 'walk' || v.plan.kind === 'gone') continue;
        const [x, z] = v._cell;
        if (x === -11 && v.plan.kind === 'pose' && v._act === 'camp') continue;
        const i = ci(x, z);
        if (!inNav(x, z) || nav.blocked[i] || nav.region[i] !== nav.mainRegion) out.push(v.id);
      }
      return out;
    },
    outdoorsShare() { return totalT > 0 ? outdoorT / totalT : 0; },
    resetOutdoors() { outdoorT = 0; totalT = 0; },
    stats() { return { tickMs: tickCount ? tickMsSum / tickCount : 0, ticks: tickCount, slips, plans: world ? world.nav.stats.plans : 0 }; },
    resetStats() { tickMsSum = 0; tickCount = 0; slips = 0; },
    phaseOf: (id) => { const v = who(id); return v ? phaseOf(v, lastCtx.sky) : null; },
    inner: (id) => { const v = who(id); return v ? { loc: v._loc, cell: v._cell, act: v._act, steps: v._steps.map((s) => s.k), phase: v._phase } : null; },
  };

  // ------------------------------------------------------------------------------------------ the Sim object
  const sim = {
    time: st.clock,
    villagers,
    get traveller() { return traveller; },
    get passerby() { return passerby; },
    get world() { return world; },
    cozy: null,
    readOnly: !!readOnly,
    intro: false,
    holdPasserby: false,
    get note() { return note; },
    get day() { return Math.floor(st.clock / TUNE.DAY_SECONDS); },
    get population() { return villagers.length; },
    get unlocks() { return st.unlocks; },
    get seen() { return st.seen; },
    get tips() { return st.tips; },
    get muted() { return st.muted; },
    get stats() { return st.stats; },
    get seed() { return st.seed; },
    set lastSeen(t) { st.lastSeen = num0(t); },
    get lastSeen() { return st.lastSeen; },
    setWorld, tick,
    reseat() { for (const v of villagers) placeFor(v); },
    planFor, couldMoveIn, homeViews,
    tents: () => tentCells.map((c) => [c[0], c[1]]),
    campWish: () => { const n = villagers.filter((u) => u.status === 'camping').length; return n ? { n, icon: WISH_TEXT.w_camp.icon, text: WISH_TEXT.w_camp.text.replace('{n}', n), label: WISH_TEXT.w_camp.label } : null; },
    muteHint(homeId) {
      const b = B(homeId);
      if (!b) return false;
      const f = packFoot(b.foot);
      if (!st.muted.includes(f)) st.muted.push(f);
      while (st.muted.length > TUNE.MUTED_MAX) st.muted.shift();
      return true;
    },
    answerIntro(lovely) {
      st.tips.intro = 1;
      sim.intro = false;
      introAt = st.clock;
      migration = !!lovely;
      for (const [, h] of vacancy) h.since = Math.max(h.since, st.clock);
    },
    drainEvents() { const e = events; events = []; return e; },
    drainCues() { const c = cues; cues = []; return c; },
    serialize,
    line(id) { const v = who(id); return v ? lineFor(v) : null; },
    fadedWish(id) { const v = who(id); return !!v && st.clock - v._fadedAt < 60; },
    debug,
  };
  function num0(t) { return typeof t === 'number' && Number.isFinite(t) ? t : 0; }

  /** Flavour line (§2.6): same all town-day per situation (a thank-you: per grant); never the same twice in a row. */
  function lineFor(v) {
    const day = Math.floor(st.clock / TUNE.DAY_SECONDS);
    const c = cozyNow();
    let pool = null, sit = null;
    if (v.status === 'waiting') { pool = LINES.waiting; sit = 'waiting'; }
    else if (v.status === 'camping') { pool = LINES.camping; sit = 'camping'; }
    else if (st.clock - v._grantedAt < 60) { pool = v.trait === 'shy' ? LINES.grantedShy : LINES.granted; sit = 'granted'; }   // the thank-you wins
    else if (st.clock - v.arrived < 60) { pool = LINES.movein; sit = 'movein'; }
    else if (st.clock - v._movedAt < 60) { pool = LINES.moving; sit = 'moving'; }
    if (!pool) {
      const r = rng(hash32(st.seed, v.seed, day, 'linepick'));
      const phase = phaseOf(v, lastCtx.sky);
      const tier = tierOf(c.value);
      if ((tier === 0 || tier === 3) && r() < 0.15) { pool = tier === 0 ? LINES.quiet : LINES.glowing; sit = tier === 0 ? 'quiet' : 'glowing'; }
      else if (['morning', 'evening', 'night'].includes(phase) && r() < 0.3) { pool = LINES[phase]; sit = phase; }
      else if (r() < 0.4) { pool = LINES[v.job]; sit = v.job; }
      else { pool = LINES[v.trait]; sit = v.trait; }
    }
    // a thank-you is keyed on the grant it is for, not only the day, and never repeats the one before it, so two wishes
    // granted on the same town day get two different thank-yous (R3 T3.4)
    if (sit === 'granted') sit = `granted#${v.grants | 0}`;
    const key = `${day}|${sit}`;
    if (v._lineKey === key && v._line) return v._line;
    const r = rng(hash32(st.seed, v.seed, day, sit));
    let line = pool[Math.floor(r() * pool.length)];
    if ((line === v._line || line === v._thanks) && pool.length > 1) {
      for (let k = 1; k < pool.length && (line === v._line || line === v._thanks); k++) line = pool[(pool.indexOf(line) + 1) % pool.length];
    }
    if (pool === LINES.granted || pool === LINES.grantedShy) v._thanks = line;
    const others = villagers.filter((u) => u !== v);
    line = line.replace('{neighbour}', others.length ? others[Math.floor(r() * others.length)].name : LINES.neighbourNone);
    v._line = line; v._lineKey = key;
    return line;
  }

  sim.cozy = cozyNow();
  lastCozy = sim.cozy;
  return sim;
}
