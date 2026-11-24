// Hearthwood — Living Town actors (docs/LIVING.md §12.4, §12.8, §5.6, §5.7, §6.4, §6.5). WP2: the only body API
// index.js uses.
//
// Presentation only. The sim (WP1) owns where everyone is and what they do (VillagerModel.plan, §12.3); actors draw
// it at the render clock: walks interpolated along their points (with fence hops, slips through walls and corners
// rounded by a short look-ahead), poses animated procedurally (watering, chopping, fishing, reading, waving…),
// indoor poses shown only on visible floors, doors and slips dither-faded, small jumps between plans eased and big
// ones cross-faded. Cosmetic separation steering keeps walkers out of each other, and draws apart two villagers posed
// on one spot (never changing the logical position). Cues become FX, hops, waves and the move-in glow. Nothing here feeds back into the sim.
//
// createActors(app[, { render = true }]) → Actors:
//   sync(models) · update(dt, clock, frame) · cue(c) · positionOf(id) · hitTest(sx, sy, pad) · setSpill(lights, levelOf)
//   setCamp(tents) · highlight(h) · highlightHit(sx, sy) · compile(camera) · debugNav(nav) · setVisible(b) · stats()
// frame = { night, viewLevel, seeAll, photo, camTarget:[x,y,z], scrub? } — `scrub: true` (optional) fades everyone out
// while the time slider moves (§5.4); they fade back in where their next plans put them.

import * as THREE from 'three';
import { createRender } from './render.js';
import { RIG, BIT, JOB_COLOR, SKIN, HAIR, HAT_TOP, TOOL_TIP, CARRY, tintHex, handPoint, tentGeometry } from './look.js';

// §15 (data.js TUNE) — actors.js imports only three and the body modules (§12.1), so the few numbers it needs are here
const SPILL_GAIN = 0.55, MOVEIN_GLOW = 0.7, MOVEIN_GLOW_LEN = 2.5, MOVEIN_EASE = 0.8;
const GAIT = [0.9, 1.0, 1.15, 1.25];        // §9.2 walk bob per Cozy tier (Quiet … Glowing)
const WAVE_P = [0.2, 0.4, 0.6, 0.8];        // §9.2 chance of a wave when passing another villager
const FLOOR_GLOW = 0.7;           // an occupied home's indoor floor glow at night (×0.6 while all inside sleep)
const OUTFIT_SHIFT = [0, 0.15, -0.15];                         // §2.3 outfit 0..2
const BUILD = [[0.92, 1, 0.92], [1.12, 1, 1.12], [1, 1.06, 1]];  // §2.3 build 0..2: slim, round, tall
const SEATED_MIN = 0.28;           // a pose spot this far above its floor is a seat (bench 0.42, log 0.30, stool 0.40)
const STRIDE = 0.9;                // metres per full walk cycle (two steps)
const HIT_R = 0.3;                 // hit capsule radius (§12.4)
const POSE_SEP = 0.45;             // m: two posed villagers nearer than this are drawn apart (a backstop, R4 T4.4)
const TENT_LANTERN = tentGeometry().userData.lantern;
const PKEYS = ['armL', 'armR', 'sit', 'tool', 'hy', 'hp', 'lean', 'twist', 'rock', 'seat'];
const FOLEY = new Set(['chop', 'splash', 'cluck', 'hum']);
const FX_KINDS = new Set(['hearts', 'note', 'sparkle', 'drops', 'chips', 'seeds', 'puff', 'z', 'letter', 'bread', 'fish', 'bees']);

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const wrapPi = (a) => a - TAU * Math.round(a / TAU);
const floorY = (lv) => (lv > 0 ? 0.25 + 2.5 * lv : 0);
const ease = (dt, rate) => 1 - Math.exp(-dt * rate);
const sm = (t) => t * t * (3 - 2 * t);

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _v = new THREE.Vector3(), _w = new THREE.Vector3();
const _s = new THREE.Vector3(), _X = new THREE.Vector3(1, 0, 0), _Y = new THREE.Vector3(0, 1, 0);
const _ray = new THREE.Raycaster(), _ndc = new THREE.Vector2(), _a = new THREE.Vector3(), _b = new THREE.Vector3();

export function createActors(app, opts = {}) {
  const renderOn = opts.render !== false;
  let R = createRender(app);
  if (renderOn) app.scene.add(R.group);

  const actors = new Map();         // id → actor
  let gen = 0;
  let time = 0;                     // cosmetic time (s, real)
  let lastFrame = { night: 0, viewLevel: 4, seeAll: true, photo: false, camTarget: [0, 0, 0] };
  let ema = 0, nUpdates = 0;
  let visible = true;

  // ------------------------------------------------------------------ actor records

  function skin(a, m) {
    const L = m.look || {};
    const job = JOB_COLOR[m.job] ? m.job : 'gardener';
    const key = [job, L.outfit, L.skin, L.hair, L.build].join('|');
    if (a.lookKey === key) return;
    a.lookKey = key;
    a.job = job;
    a.outfit = new THREE.Color(tintHex(JOB_COLOR[job], OUTFIT_SHIFT[clamp(L.outfit | 0, 0, 2)]));
    a.skin = new THREE.Color(SKIN[clamp(L.skin | 0, 0, 5)]);
    a.hair = new THREE.Color(HAIR[clamp(L.hair | 0, 0, 5)]);
    a.scale = BUILD[clamp(L.build | 0, 0, 2)];
    const s = Number.isFinite(m.seed) ? m.seed >>> 0 : hashStr(String(m.id));
    a.seed = s;
    a.bits = (job === 'woodcutter' ? (s & 1) : (s >>> 3) % 7 === 0) ? BIT.BEARD : 0;
    if ((s >>> 5) % 3 === 0) a.bits |= BIT.BUN;
  }

  function makeActor(m) {
    const a = {
      id: m.id, model: m, seen: gen, lookKey: null,
      plan: undefined, planId: undefined, cum: null, cumFor: null, seg: 0, puffKey: null,
      x: 0, y: 0, z: 0, yaw: 0, ox: 0, oy: 0, oz: 0, lat: 0, sepX: 0, sepZ: 0, jump: null,
      appear: 0, removing: false, scrub: 1, drawn: false, fade: 0,
      walkAmp: 0, walkDist: 0, lpx: 0, lpz: 0, hasLast: false,
      p: { armL: 0, armR: 0, sit: 0, tool: 0, hy: 0, hp: 0, bob: 0, lean: 0, twist: 0, rock: 0, seat: 0 },
      look: { t: 0, hy: 0, hp: 0 }, hopT: -9, waveUntil: -9, skipAt: 0, met: null,
      tg: { x: 0, y: 0, z: 0, yaw: 0, kind: 'gone', pose: 'stand', seated: false, lie: false, kneel: false, inside: false,
        speed: 0, fade: 1, hopY: 0, tuck: 0, level: 0, visible: false, hurry: false, ground: 0, at: null },
      anim: [0, 0, 0, 0], anim2: [0, 0, 0, 0], flags: [0, 0, 0, 0],
      matrix: new THREE.Matrix4(), headY: 0, lantern: null,
    };
    skin(a, m);
    return a;
  }

  // ------------------------------------------------------------------ plan evaluation (at the render clock)

  function cumOf(a, p) {
    if (a.cumFor === p) return a.cum;
    const pts = p.pts, n = Math.max(1, (pts.length / 3) | 0);
    const cum = new Float32Array(n);
    for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(pts[i * 3] - pts[i * 3 - 3], pts[i * 3 + 2] - pts[i * 3 - 1]);
    a.cum = cum; a.cumFor = p; a.seg = 0;
    return cum;
  }
  /** Point at distance d along a walk → out [x, y, z]; returns the segment index. */
  function along(a, p, d, out) {
    const cum = a.cum, pts = p.pts, n = cum.length;
    if (n === 1) { out[0] = pts[0]; out[1] = pts[1]; out[2] = pts[2]; return 0; }
    let i = clamp(a.seg, 0, n - 2);
    while (i < n - 2 && cum[i + 1] < d) i++;
    while (i > 0 && cum[i] > d) i--;
    const L = cum[i + 1] - cum[i], f = L > 1e-6 ? clamp((d - cum[i]) / L, 0, 1) : 1;
    out[0] = pts[i * 3] + (pts[i * 3 + 3] - pts[i * 3]) * f;
    out[1] = pts[i * 3 + 1] + (pts[i * 3 + 4] - pts[i * 3 + 1]) * f;
    out[2] = pts[i * 3 + 2] + (pts[i * 3 + 5] - pts[i * 3 + 2]) * f;
    return i;
  }
  const P0 = [0, 0, 0], P1 = [0, 0, 0];

  function evalPlan(a, p, clock, frame) {
    const tg = a.tg;
    tg.fade = 1; tg.hopY = 0; tg.tuck = 0; tg.speed = 0; tg.seated = false; tg.lie = false; tg.kneel = false;
    tg.inside = false; tg.level = 0; tg.visible = true; tg.hurry = false; tg.pose = 'stand'; tg.at = null;
    const kind = p ? p.kind : 'gone';
    tg.kind = kind;
    if (!p || kind === 'gone') { tg.visible = false; return tg; }
    if (kind === 'walk') {
      if (!p.pts || p.pts.length < 3) { tg.visible = false; return tg; }
      const cum = cumOf(a, p), total = cum[cum.length - 1];
      const T = p.t1 - p.t0;
      const u = T > 0 ? clamp((clock - p.t0) / T, 0, 1) : 1;
      const d = u * total;
      const i = along(a, p, d, P0);
      a.seg = i;
      tg.x = P0[0]; tg.y = P0[1]; tg.z = P0[2];
      tg.speed = u < 1 && T > 0 ? total / T : 0;
      tg.hurry = !!p.hurry;
      along(a, p, Math.min(total, d + 0.45), P1);
      let dx = P1[0] - P0[0], dz = P1[2] - P0[2];
      if (dx * dx + dz * dz < 1e-6 && cum.length > 1) {
        const j = Math.max(0, Math.min(i, cum.length - 2));
        dx = p.pts[j * 3 + 3] - p.pts[j * 3]; dz = p.pts[j * 3 + 5] - p.pts[j * 3 + 2];
      }
      tg.yaw = dx * dx + dz * dz > 1e-8 ? Math.atan2(dx, dz) : a.yaw;
      tg.ground = tg.y;
      // hop over a fence / hedge in the middle of its segment; slip (fade, puff, fade) through a wall
      const segL = cum.length > 1 ? cum[Math.min(i + 1, cum.length - 1)] - cum[i] : 0;
      if (segL > 1e-3 && tg.speed > 0) {
        const f = (d - cum[i]) / segL;
        const w = clamp((0.25 * tg.speed) / segL, 0.05, 0.5);
        if (p.hops && p.hops.includes(i) && Math.abs(f - 0.5) < w) {
          const k = (f - 0.5 + w) / (2 * w);
          tg.hopY = 0.5 * Math.sin(Math.PI * k);
          tg.tuck = Math.sin(Math.PI * k);
        }
        if (p.slips && p.slips.includes(i)) {
          tg.fade = clamp(Math.abs(f - 0.5) / w, 0, 1);
          const key = a.planId + ':' + i;
          if (f >= 0.5 && a.puffKey !== key) {
            a.puffKey = key;
            R.spawn('dust', tg.x, tg.y + 0.4, tg.z, 6);
          }
        }
      }
      return tg;
    }
    if (kind === 'pose' || kind === 'inside') {
      const at = p.at || [0, 0, 0];
      tg.x = at[0]; tg.y = at[1]; tg.z = at[2]; tg.yaw = Number.isFinite(p.face) ? p.face : a.yaw;
      tg.at = at;
      tg.level = p.level | 0;
      if (kind === 'inside') {
        tg.inside = true;
        tg.visible = frame.seeAll || tg.level <= frame.viewLevel;
        tg.pose = p.pose === 'sleep' ? 'lie' : p.pose === 'sit' ? 'sit' : 'stand';
        if (tg.pose === 'lie') { tg.lie = true; tg.lieIn = true; } else tg.lieIn = false;
        if (tg.pose === 'sit') tg.seated = true;
      } else {
        tg.pose = p.pose || 'stand';
        tg.lieIn = false;
        if (tg.pose === 'lie') tg.lie = true;
        else if (tg.pose === 'kneel') tg.kneel = true;
        else if (tg.pose === 'sit' || tg.pose === 'rock' || at[1] - floorY(tg.level) >= SEATED_MIN) tg.seated = true;
      }
      tg.ground = tg.seated ? Math.max(floorY(tg.level), at[1] - 0.45) : at[1];
      return tg;
    }
    if (kind === 'door') {
      const at = p.at || [0, 0, 0], f = Number.isFinite(p.face) ? p.face : 0;
      const T = p.t1 - p.t0, u = T > 0 ? clamp((clock - p.t0) / T, 0, 1) : 1;
      const fx = Math.sin(f) * 0.4, fz = Math.cos(f) * 0.4;
      const inn = p.dir !== 'out';
      const s0 = inn ? 0 : -1, s1 = inn ? 1 : 0;
      const k = s0 + (s1 - s0) * u;
      tg.x = at[0] + fx * k; tg.y = at[1]; tg.z = at[2] + fz * k; tg.yaw = f;
      tg.fade = inn ? 1 - u : u;
      tg.speed = T > 0 && u < 1 ? 0.4 / T : 0;
      tg.ground = at[1];
      return tg;
    }
    if (kind === 'hop' || kind === 'slip') {
      const f0 = p.from || [0, 0, 0], f1 = p.to || f0;
      const T = p.t1 - p.t0, u = T > 0 ? clamp((clock - p.t0) / T, 0, 1) : 1;
      const dx = f1[0] - f0[0], dz = f1[2] - f0[2];
      if (dx * dx + dz * dz > 1e-6) tg.yaw = Math.atan2(dx, dz); else tg.yaw = a.yaw;
      if (kind === 'hop') {
        tg.x = f0[0] + dx * u; tg.y = f0[1] + (f1[1] - f0[1]) * u; tg.z = f0[2] + dz * u;
        tg.hopY = 0.45 * Math.sin(Math.PI * u);
        tg.tuck = Math.sin(Math.PI * u);
        const key = 'h' + a.planId;
        if (a.puffKey !== key) { a.puffKey = key; R.spawn('dust', f0[0], f0[1] + 0.1, f0[2], 4); }
      } else {
        const second = u >= 0.5;
        const q = second ? f1 : f0;
        tg.x = q[0]; tg.y = q[1]; tg.z = q[2];
        tg.fade = second ? (u - 0.5) * 2 : 1 - u * 2;
        const key = 's' + a.planId;
        if (second && a.puffKey !== key) { a.puffKey = key; R.spawn('dust', (f0[0] + f1[0]) / 2, (f0[1] + f1[1]) / 2 + 0.4, (f0[2] + f1[2]) / 2, 8); }
      }
      tg.ground = tg.y;
      return tg;
    }
    tg.visible = false;
    return tg;
  }

  // ------------------------------------------------------------------ poses (targets for the smoothed rig)

  const T = { armL: 0, armR: 0, sit: 0, tool: 0, hy: 0, hp: 0, bob: 0, lean: 0, twist: 0, rock: 0, seat: 0, book: false, toolOff: false };
  /** Targets for a pose at pose-time τ (town seconds since the plan began) and cosmetic time t. */
  function poseTargets(a, tg, tau, t) {
    T.armL = 0.06; T.armR = 0.06; T.sit = 0; T.tool = 0; T.hy = a.look.hy; T.hp = a.look.hp; T.bob = 0.006 * Math.sin(t * 2.1 + a.seed);
    T.lean = 0; T.twist = 0; T.rock = 0; T.book = false; T.toolOff = false;
    T.seat = tg.seated ? 1 : tg.kneel ? -1 : 0;        // how far the body sits down (1 on a seat, −1 kneeling)
    const seated = tg.seated, cyc = (period) => ((tau % period) + period) % period / period;
    if (seated) { T.sit = 1; T.armL = -0.55; T.armR = -0.55; }
    switch (tg.pose) {
      case 'stand': case 'sit': break;
      case 'rock': T.sit = 1; T.rock = 0.07 * Math.sin(t * 2.2 + a.seed); break;
      case 'lie': T.hy = 0.35 * Math.sin(a.seed); T.hp = 0; T.armL = 0; T.armR = 0; T.bob = 0.008 * Math.sin(t * 1.4); T.toolOff = true; break;
      case 'kneel': T.sit = -1; T.armL = -0.8; T.armR = -0.95 + 0.12 * Math.sin(t * 3); T.hp = 0.35; break;
      case 'chat': {
        const g = Math.sin(t * 1.3 + a.seed) > 0.2;
        T.armR = g ? -0.75 + 0.3 * Math.sin(t * 5.5) : (seated ? -0.55 : 0.08);
        T.hp = 0.06 * Math.sin(t * 6.3 + a.seed) - 0.04;
        T.bob += 0.012 * Math.abs(Math.sin(t * 6.3));
        break;
      }
      case 'wave': T.armR = -2.7 + 0.32 * Math.sin(t * 13); T.hp = -0.08; T.hy = 0; break;
      case 'admire': T.armL = -0.5; T.armR = -0.5; T.hp = 0.28; T.hy = 0.25 * Math.sin(t * 0.7 + a.seed); T.twist = 0.06 * Math.sin(t * 1.1); break;
      case 'cheer': T.armL = -2.8; T.armR = -2.8; T.bob += 0.08 * Math.abs(Math.sin(t * 8)); T.hp = -0.15; break;
      case 'stretch': { const k = 0.5 - 0.5 * Math.cos(cyc(4) * TAU); T.armL = -2.9 * k; T.armR = -2.9 * k; T.hp = -0.3 * k; break; }
      case 'lookup': T.hp = -0.75; T.armL = seated ? -0.4 : 0.15; T.armR = seated ? -0.4 : 0.15; break;
      case 'warm': T.armL = -1.15 + 0.08 * Math.sin(t * 6); T.armR = -1.15 - 0.08 * Math.sin(t * 6); T.hp = 0.12; T.twist = 0.04 * Math.sin(t * 1.3); T.toolOff = true; break;
      case 'water': T.armR = -0.95; T.tool = 0.55 + 0.15 * Math.sin(t * 2.4); T.armL = -0.2; T.hp = 0.32; break;
      case 'hoe': case 'fork': {
        const per = tg.pose === 'hoe' ? 1.2 : 1.5, c = cyc(per);
        const up = c < 0.7 ? sm(c / 0.7) : 1 - sm((c - 0.7) / 0.3);
        T.armR = -0.5 - (tg.pose === 'hoe' ? 1.6 : 1.0) * up; T.armL = T.armR + 0.1; T.tool = 0.8 + 0.4 * up;
        T.hp = 0.3; T.bob -= 0.03 * (1 - up); T.lean = 0.08 * (1 - up);
        break;
      }
      case 'scatter': T.armR = -0.9 + 0.5 * Math.sin(t * 4); T.armL = -0.6; T.hp = 0.25; T.toolOff = a.job !== 'farmer'; break;
      case 'pat': T.armR = -1.3 + 0.12 * Math.abs(Math.sin(t * 8)); T.hp = 0.1; break;
      case 'chop': {
        const c = cyc(1.6);
        let k;
        if (c < 0.55) k = sm(c / 0.55);              // wind up overhead
        else if (c < 0.7) k = 1 - sm((c - 0.55) / 0.15);  // strike
        else k = 0;
        T.armR = -0.75 - 2.15 * k; T.armL = T.armR + 0.05; T.tool = -0.25 + 0.55 * k;
        T.hp = 0.22 - 0.25 * k; T.bob -= c >= 0.55 && c < 0.8 ? 0.03 : 0; T.lean = 0.06 * (1 - k);
        break;
      }
      case 'knock': T.armR = -1.45 + 0.18 * Math.abs(Math.sin(t * 9)); T.hp = -0.45; T.toolOff = true; break;
      case 'fish': T.armR = -0.85 + 0.04 * Math.sin(t * 1.7); T.tool = 1.75 + 0.06 * Math.sin(t * 1.7 + 1); T.armL = -0.6; T.hp = 0.1; break;
      case 'catch': { const c = clamp(tau / 1.0, 0, 1); T.armR = -0.85 - 1.0 * Math.sin(Math.PI * c); T.tool = 1.75 - 0.9 * Math.sin(Math.PI * c); T.armL = -1.6 * Math.sin(Math.PI * c); T.hp = -0.2; break; }
      case 'smoke': T.armR = -1.0; T.tool = 0.1 * Math.sin(t * 9.4); T.armL = -0.5; T.hp = 0.18; break;
      case 'knead': { const k = 0.5 + 0.5 * Math.sin(t * 8.2); T.armL = -1.0 - 0.4 * k; T.armR = -1.0 - 0.4 * k; T.bob -= 0.02 * k; T.hp = 0.3; T.lean = 0.06 * k; T.toolOff = true; break; }
      case 'polish': T.armR = -1.45 + 0.15 * Math.sin(t * 7); T.armL = -0.3; T.hp = -0.25; T.twist = 0.05 * Math.sin(t * 7); T.toolOff = a.job !== 'lamplighter'; break;
      case 'post': { const c = cyc(2); T.armR = -0.5 - 0.9 * Math.sin(Math.PI * clamp(c / 0.6, 0, 1)); T.hp = 0.15; break; }
      case 'sort': T.armL = -1.0 + 0.1 * Math.sin(t * 3); T.armR = -1.0 + 0.1 * Math.sin(t * 3 + 2); T.hp = 0.4; break;
      case 'read': T.armL = -1.15; T.armR = -1.05; T.hp = 0.38; T.hy = 0.08 * Math.sin(t * 0.4); T.book = true; T.toolOff = true; break;
      case 'sweep': T.armL = -0.7; T.armR = -0.75; T.twist = 0.28 * Math.sin(t * 3.1); T.hp = 0.3; T.toolOff = true; break;
      default: break;
    }
    if (tg.kind === 'walk' && tg.speed > 0) { T.sit = tg.tuck * 0.6; T.lean = tg.hurry ? 0.1 : 0.05; }
    else if (tg.tuck) T.sit = tg.tuck * 0.6;
    if (time < a.waveUntil) { T.armR = -2.7 + 0.32 * Math.sin(t * 13); T.hp = -0.08; }
    return T;
  }

  // ------------------------------------------------------------------ the frame

  const others = [];
  function update(dt, clock, frame = {}) {
    const t0 = performance.now();
    dt = Math.max(0, Math.min(0.1, dt || 0));
    time += dt;
    lastFrame = frame;
    const night = clamp(frame.night || 0, 0, 1);
    R.begin();
    // remove faded-out actors
    for (const [id, a] of actors) if (a.removing && a.appear <= 0.001) actors.delete(id);
    // pass 1: plans → targets, smoothing, positions
    others.length = 0;
    for (const a of actors.values()) {
      const m = a.model, p = m.plan;
      if (p !== a.plan || m.planId !== a.planId) {
        const wasDrawn = a.drawn;
        a.plan = p; a.planId = m.planId;
        const tg = evalPlan(a, p, clock, frame);
        if (wasDrawn && tg.visible) {
          const dx = a.x - tg.x, dy = a.y - tg.y, dz = a.z - tg.z, d = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (d < 1.6) { a.ox = dx; a.oy = dy; a.oz = dz; }
          else { a.jump = { x: a.x, y: a.y, z: a.z, yaw: a.yaw, t: 0 }; a.ox = a.oy = a.oz = 0; }
        } else { a.ox = a.oy = a.oz = 0; a.yaw = tg.yaw; a.hasLast = false; }
      } else evalPlan(a, p, clock, frame);
      const tg = a.tg;
      const k = Math.exp(-dt / 0.2);
      a.ox *= k; a.oy *= k; a.oz *= k;
      // appear / remove / scrub fades
      a.appear = clamp(a.appear + (a.removing ? -dt / 0.3 : dt / 0.35), 0, 1);
      a.scrub = clamp(a.scrub + (frame.scrub ? -dt / 0.15 : dt / 0.35), 0, 1);
      let jf = 1;
      let px = tg.x + a.ox, py = tg.y + a.oy, pz = tg.z + a.oz;
      if (a.jump) {
        a.jump.t += dt;
        if (a.jump.t < 0.18) { px = a.jump.x; py = a.jump.y; pz = a.jump.z; jf = 1 - a.jump.t / 0.18; }
        else { jf = clamp((a.jump.t - 0.18) / 0.25, 0, 1); if (a.jump.t > 0.43) a.jump = null; else if (jf < 0.05) a.yaw = tg.yaw; }
      }
      a.fade = tg.fade * a.appear * a.scrub * jf;
      a.vis = tg.visible && a.fade > 0.01;
      // facing
      const target = a.jump && a.jump.t < 0.18 ? a.jump.yaw : tg.yaw;
      a.yaw = wrapPi(a.yaw + wrapPi(target - a.yaw) * ease(dt, tg.kind === 'walk' ? 9 : 6));
      a.x = px; a.y = py; a.z = pz;
      // walk cycle from the distance actually travelled
      if (a.hasLast) {
        const ddx = a.x - a.lpx, ddz = a.z - a.lpz, step = Math.sqrt(ddx * ddx + ddz * ddz);
        if (step < 1.5) a.walkDist += step;
      }
      a.lpx = a.x; a.lpz = a.z; a.hasLast = true;
      a.walkAmp += ((tg.kind === 'walk' && tg.speed > 0.05 && !tg.hopY ? 1 : 0) - a.walkAmp) * ease(dt, 8);
      if (a.vis && !tg.inside && !tg.lie) others.push(a);
    }
    // pass 2: cosmetic separation (lateral only, ≤ 0.3 m) and heads turning to neighbours
    for (const a of others) {
      let push = 0, near = null, nd = 1.6;
      const fx = Math.sin(a.yaw), fz = Math.cos(a.yaw);
      for (const b of others) {
        if (b === a) continue;
        const dx = b.x - a.x, dz = b.z - a.z, d = Math.sqrt(dx * dx + dz * dz);
        if (d < nd) { nd = d; near = b; }
        if (a.walkAmp > 0.3 && d < 0.55 && d > 1e-4) {
          const side = dx * fz - dz * fx;       // > 0: b is on a's local +X side (its left); push away from it
          push += (side > 0 ? -1 : 1) * (0.55 - d) / 0.55;
        }
      }
      a.lat += (clamp(push * 0.3, -0.3, 0.3) - a.lat) * ease(dt, a.walkAmp > 0.3 ? 4 : 2);
      // the backstop for two villagers posed on one spot (the sim books places so it never happens, R4 T4.4): drawn
      // apart to POSE_SEP, so they never read as one figure with two hats. Coincident ones split along the lower id's
      // left–right axis, the lower id to its left
      let sx = 0, sz = 0;
      if (a.walkAmp < 0.3 && a.tg.kind === 'pose') {
        for (const b of others) {
          if (b === a || b.walkAmp >= 0.3 || b.tg.kind !== 'pose' || Math.abs(b.y - a.y) > 0.6) continue;
          const dx = a.x - b.x, dz = a.z - b.z, d = Math.sqrt(dx * dx + dz * dz);
          if (d >= POSE_SEP) continue;
          let ux = 0, uz = 0;
          if (d > 1e-3) { ux = dx / d; uz = dz / d; } else {
            const lo = a.id < b.id ? a : b, sg = lo === a ? 1 : -1;
            ux = Math.cos(lo.yaw) * sg; uz = -Math.sin(lo.yaw) * sg;
          }
          sx += ux * (POSE_SEP - d) / 2; sz += uz * (POSE_SEP - d) / 2;
        }
      }
      a.sepX += (sx - a.sepX) * ease(dt, 4); a.sepZ += (sz - a.sepZ) * ease(dt, 4);
      // passing another villager: a wave, more often in a cosier town (§9.2: 20 / 40 / 60 / 80 %), once per meeting
      if (near && near !== a.met && nd < 1.6 && (a.walkAmp > 0.3 || near.walkAmp > 0.3) && a.model.status !== 'passerby') {
        if (Math.random() < WAVE_P[a.model.mood | 0] && time > a.waveUntil + 4) a.waveUntil = time + 1.4;
      }
      if (!near || nd > 2.4) a.met = null; else a.met = near;
      a.near = near;
    }
    // pass 3: rig, matrices, instances
    for (const a of actors.values()) {
      const tg = a.tg;
      a.drawn = false;
      if (!a.vis) continue;
      a.drawn = true;
      // idle glances
      if (time > a.look.t) {
        a.look.t = time + 2.5 + Math.random() * 3.5;
        a.look.hy = (Math.random() * 2 - 1) * 0.6;
        a.look.hp = (Math.random() * 2 - 1) * 0.1;
      }
      if (a.near && (tg.pose === 'stand' || tg.pose === 'chat' || tg.pose === 'sit' || tg.kind === 'walk')) {
        const want = wrapPi(Math.atan2(a.near.x - a.x, a.near.z - a.z) - a.yaw);
        if (Math.abs(want) < 1.6) a.look.hy = clamp(want, -1.0, 1.0);
      }
      // two villagers standing or sitting within 1.6 m of each other chat (§5.5: gestures and bounces, heads turned)
      if (a.near && tg.kind === 'pose' && a.near.tg.kind === 'pose' && (tg.pose === 'stand' || tg.pose === 'sit')
        && Math.hypot(a.near.x - a.x, a.near.z - a.z) < 1.6) tg.pose = 'chat';
      const tau = a.plan && Number.isFinite(a.plan.t0) ? clock - a.plan.t0 : time;
      const PT = poseTargets(a, tg, tau, time + (a.seed % 100));
      const P = a.p, k = ease(dt, 10);
      for (let i = 0; i < PKEYS.length; i++) { const key = PKEYS[i]; P[key] += (PT[key] - P[key]) * k; }
      P.bob = PT.bob;
      // walk swing on top of the pose
      const m = a.model, fl = m.flags || {};
      const toolShown = !PT.toolOff && !tg.lie && (m.flags ? !!fl.tool : true);
      const pack = !!fl.pack && !tg.lie, basket = !!fl.basket && !tg.lie;
      const lanternOn = !!fl.lantern && !tg.lie && !tg.inside;
      const lanternSide = pack || basket ? 1 : -1;
      const carry = CARRY[a.job] || { swing: 0.6, armR: 0 };
      const ph = (a.walkDist / STRIDE) * TAU, s = Math.sin(ph), W = a.walkAmp;
      const legAmp = (tg.hurry ? 0.62 : 0.55) * W;
      let swingL = 0.45, swingR = 0.45, baseR = 0, baseL = 0;
      if (toolShown && !(lanternOn && lanternSide > 0)) { swingR *= carry.swing; baseR = carry.armR; }
      if (pack) swingL = 0.18;
      if (basket) { swingL = 0.25; baseL = -0.2; }
      if (lanternOn) { if (lanternSide < 0) { swingL = 0.12; baseL = -0.35; } else { swingR = 0.12; baseR = -0.35; } }
      const armL = P.armL * (1 - W) + (baseL - swingL * s) * W;
      const armR = P.armR * (1 - W) + (baseR + swingR * s) * W;
      // the gait follows Cozy (§9.2): calmer when Quiet, bouncier when Cheerful / Glowing, with an occasional skip
      const mood = a.model.mood | 0;
      const bob = P.bob + W * 0.028 * GAIT[mood] * (2 * Math.abs(Math.cos(ph)) - 1);
      if (mood >= 3 && W > 0.6 && !tg.hurry && time > a.skipAt) {
        if (a.skipAt > 0 && Math.random() < 0.5) a.hopT = time;
        a.skipAt = time + 6 + Math.random() * 6;
      }
      a.anim[0] = legAmp * s; a.anim[1] = armL; a.anim[2] = armR; a.anim[3] = P.hy;
      a.anim2[0] = P.sit; a.anim2[1] = P.tool; a.anim2[2] = bob; a.anim2[3] = P.hp;
      let bits = a.bits | (basket ? BIT.BASKET : 0) | (PT.book || fl.book ? BIT.BOOK : 0);
      if (tg.lie) bits |= BIT.LIE | BIT.HATOFF;
      a.flags[0] = a.fade; a.flags[1] = toolShown && !(lanternOn && lanternSide > 0) ? 1 : 0; a.flags[2] = pack ? 1 : 0; a.flags[3] = bits;
      // instance matrix
      const sc = a.scale;
      const hop = (tg.hopY || 0) + (time - a.hopT < 0.35 ? 0.28 * Math.sin(Math.PI * (time - a.hopT) / 0.35) : 0);
      const yaw = a.yaw + P.twist;
      let ox = a.x + Math.cos(a.yaw) * a.lat + a.sepX, oz = a.z - Math.sin(a.yaw) * a.lat + a.sepZ, oy = a.y;
      if (tg.lie) {
        // on the back, head toward +face (§12.3: for 'sleep' the bed's local −Z, its headboard), the body centre at
        // the spot: the feet (the body's origin) 0.6 m back along −face
        const c = 0.6 * sc[1], up = tg.lieIn ? 0.2 : 0.27;
        ox -= Math.sin(a.yaw) * c; oz -= Math.cos(a.yaw) * c; oy += up;
        _q.setFromAxisAngle(_Y, yaw + Math.PI).multiply(_q2.setFromAxisAngle(_X, -Math.PI / 2));
        a.headY = oy + 0.35;
      } else {
        oy -= RIG.SEAT_DROP * sc[1] * clamp(P.seat, 0, 1) + 0.3 * sc[1] * clamp(-P.seat, 0, 1);
        oy += hop;
        _q.setFromAxisAngle(_Y, yaw).multiply(_q2.setFromAxisAngle(_X, P.lean + P.rock));
        a.headY = oy + (HAT_TOP[a.job] || 1.4) * sc[1];
      }
      a.ox3 = ox; a.oy3 = oy; a.oz3 = oz;
      a.matrix.compose(_v.set(ox, oy, oz), _q, _s.set(sc[0], sc[1], sc[2]));
      R.body(a.job, a.matrix, a.outfit, a.skin, a.hair, a.anim, a.anim2, a.flags);
      // contact shadow
      if (!tg.lie && a.fade > 0.05) R.blob(ox, tg.ground + (a.oy || 0), oz, a.fade * (1 - clamp(hop / 0.8, 0, 0.6)));
      // lantern in hand, the Lamplighter's pole tip
      if (lanternOn && a.fade > 0.2) {
        const side = lanternSide;
        handPoint(_w, side, side > 0 ? RIG.HAND_R : RIG.HAND_L, side > 0 ? armR : armL, 0, bob);
        _w.y -= 0.03;
        _w.applyMatrix4(a.matrix);
        R.glowAt(_w.x, _w.y, _w.z, a.yaw, 1, 0.12 * Math.sin(time * 4 + a.seed) * W);
        lanternLight(_w.x, _w.y - 0.12, _w.z, tg.ground, night * a.fade, 1);
      }
      if (a.job === 'lamplighter' && a.flags[1] && a.fade > 0.2) {
        handPoint(_w, 1, TOOL_TIP.lamplighter, armR, P.tool, bob);
        _w.applyMatrix4(a.matrix);
        R.glowAt(_w.x, _w.y - 0.06, _w.z, a.yaw, 0.7);
        lanternLight(_w.x, _w.y - 0.14, _w.z, null, night * a.fade, 0.6);
      }
    }
    // camp (with its lanterns' light), spill, rings, FX
    updateCamp(dt);
    for (const t of tents) if (t.fade > 0.3) lanternLight(t.x + TENT_LANTERN[0], TENT_LANTERN[1] - 0.12, t.z + TENT_LANTERN[2], 0, night * t.fade, 1);
    updateSpill(dt, night);
    updateRings(frame);
    R.end(night);
    R.updateFx(dt, app.camera);
    // update cost, EMA (the first frames build the job meshes, so they are left out)
    if (++nUpdates > 10) ema = ema ? ema * 0.9 + (performance.now() - t0) * 0.1 : performance.now() - t0;
  }

  // ------------------------------------------------------------------ cues

  function cue(c) {
    if (!c || !c.kind) return;
    const k = c.kind;
    if (k === 'pulse') { if (c.home != null) pulses.set(c.home, time); return; }
    if (FOLEY.has(k)) return;
    const a = c.id != null ? actors.get(c.id) : null;
    if (k === 'hop') {
      if (a) { a.hopT = time; R.spawn('dust', a.x, a.y + 0.05, a.z, 3); }
      return;
    }
    if (k === 'wave') { if (a) a.waveUntil = time + 2.2; return; }
    if (!FX_KINDS.has(k)) return;
    let x, y, z, dir = null;
    if (Array.isArray(c.at)) [x, y, z] = c.at;
    else if (a && a.drawn) {
      const fx = Math.sin(a.yaw), fz = Math.cos(a.yaw);
      x = a.x; z = a.z; y = a.headY + 0.1;
      if (k === 'drops') { x += fx * 0.45 + Math.cos(a.yaw) * 0.3; z += fz * 0.45 - Math.sin(a.yaw) * 0.3; y = a.y + 0.45; dir = [fx, fz]; }
      else if (k === 'chips' || k === 'seeds') { x += fx * 0.55; z += fz * 0.55; y = a.y + 0.25; }
      else if (k === 'fish') { x += fx * 1.0; z += fz * 1.0; y = a.y + 0.1; }
      else if (k === 'bees') { y = a.y + 1.0; }
      else if (k === 'puff') { y = a.y + 0.2; }
    } else return;
    R.spawn(k, x, y, z, c.n, dir);
  }

  // ------------------------------------------------------------------ light spill & the move-in glow

  let lights = [];
  let levelOf = null;
  let eased = new Float32Array(0);
  const pulses = new Map();          // homeId → start time
  const levelsOut = [];
  function setSpill(list, fn) {
    const old = new Map(lights.map((L, i) => [lightKey(L), eased[i]]));
    lights = Array.isArray(list) ? list.slice(0, 128) : [];
    levelOf = typeof fn === 'function' ? fn : null;
    eased = new Float32Array(lights.length);
    lights.forEach((L, i) => { eased[i] = old.get(lightKey(L)) || 0; });
    R.setSpill(lights);
  }
  const lightKey = (L) => `${L.homeId}|${L.kind}|${(+L.x).toFixed(2)}|${(+L.z).toFixed(2)}`;
  const homeLevels = new Map();
  function updateSpill(dt, night) {
    homeLevels.clear();
    const k = ease(dt, 1.5);
    let anyPulse = false;
    for (let i = 0; i < lights.length; i++) {
      const L = lights[i], h = L.homeId;
      let lv = homeLevels.get(h);
      if (lv === undefined) {
        try { lv = levelOf ? clamp(+levelOf(h) || 0, 0, 1) : 0; } catch { lv = 0; }
        homeLevels.set(h, lv);
      }
      eased[i] += (lv - eased[i]) * k;
      // ground spill outside; indoors a soft lamp-lit floor (dimmer once everyone is asleep), seen in the cutaway
      let b = L.kind === 'ground' ? night * SPILL_GAIN * eased[i]
        : L.kind === 'floor' ? night * FLOOR_GLOW * Math.min(1, eased[i] >= 0.5 ? eased[i] : eased[i] * 4) : 0;
      const p0 = pulses.get(h);
      if (p0 !== undefined) {
        const age = time - p0;
        if (age < MOVEIN_GLOW_LEN) {
          anyPulse = true;
          const env = Math.min(1, age / 0.12) * (age < MOVEIN_GLOW_LEN - MOVEIN_EASE ? 1 : 1 - sm((age - (MOVEIN_GLOW_LEN - MOVEIN_EASE)) / MOVEIN_EASE));
          b = Math.max(b, Math.max(night, MOVEIN_GLOW) * env);
        }
      }
      levelsOut[i] = b;
    }
    for (const [h, p0] of pulses) if (time - p0 >= MOVEIN_GLOW_LEN) pulses.delete(h);
    levelsOut.length = lights.length;
    if ((lights.length && (night >= 0.02 || anyPulse)) || nDyn) R.spillLevels(levelsOut, dynOut(nDyn));
    else { R.spillLevels(levelsOut, null); R.spill.visible = false; }
    nDyn = 0;
  }

  // lanterns light the ground round them (a warm pool) and glow (a soft halo facing the camera): extra quads in the
  // spill mesh, so no extra draw call (§5.6, §12.8). Only after dusk.
  const dyn = [];
  let nDyn = 0;
  const dynOut = (n) => { dyn.length = n; return dyn; };
  function lanternLight(x, y, z, ground, k, s) {
    if (k < 0.12) return;
    const cam = app.camera.position;
    const halo = dyn[nDyn] || (dyn[nDyn] = {});
    nDyn++;
    halo.kind = 'halo'; halo.x = x; halo.y = y; halo.z = z; halo.s = 0.75 * s; halo.b = 0.32 * k; halo.yaw = Math.atan2(cam.x - x, cam.z - z);
    if (ground === null) return;
    const pool = dyn[nDyn] || (dyn[nDyn] = {});
    nDyn++;
    pool.kind = 'pool'; pool.x = x; pool.y = ground + 0.035; pool.z = z; pool.s = 2.0 * s; pool.b = 0.4 * k; pool.yaw = 0;
  }

  // ------------------------------------------------------------------ camp

  let tents = [];                  // { key, x, z, fade, gone }
  function setCamp(list) {
    const want = new Map();
    for (const t of Array.isArray(list) ? list : []) if (Number.isFinite(t?.x) && Number.isFinite(t?.z)) want.set(`${t.x}|${t.z}`, t);
    for (const t of tents) t.gone = !want.has(t.key);
    for (const [key, t] of want) if (!tents.some((q) => q.key === key)) tents.push({ key, x: t.x, z: t.z, fade: 0, gone: false });
  }
  function updateCamp(dt) {
    let n = 0;
    for (const t of tents) {
      t.fade = clamp(t.fade + (t.gone ? -dt / 0.4 : dt / 0.6), 0, 1);
      if (!(t.gone && t.fade <= 0)) tents[n++] = t;
    }
    tents.length = n;
    R.setTents(tents);
  }

  // ------------------------------------------------------------------ Show me highlight

  let hl = null;                   // { rings:[{x,y,z,b,sx,sz,yaw,hit,idx}], ghostIdx, box }
  const FAINT = { b: 0.22, s: 0.5 };   // a later part's ring: brightness and size against a current one
  function highlight(h) {
    R.setGhost(null);
    hl = null;
    if (!h) { R.setRings([]); return; }
    const list = [];
    let idx = 0;
    for (const c of h.cells || []) list.push({ x: c.x, y: (c.y || 0) + 0.035, z: c.z, b: 1, hit: true, idx: idx++ });
    for (const e of h.edges || []) {
      const wx = e.a === 'z' ? e.x * 2 : (e.x + 0.5) * 2, wz = e.a === 'z' ? (e.z + 0.5) * 2 : e.z * 2;
      list.push({ x: wx, y: floorY(e.y | 0) + 0.035, z: wz, b: 1, sx: 1.25, sz: 0.7, yaw: e.a === 'z' ? Math.PI / 2 : 0, hit: true, idx: idx++, edge: e });
    }
    // the later parts' spots: a small, dim, still ring, so they never read as a spot to tap now. The ring texture is
    // additive and saturates on sunny grass at any brightness, so size and stillness carry the difference (R3 T3.1)
    for (const c of h.faint || []) list.push({ x: c.x, y: (c.y || 0) + 0.03, z: c.z, b: FAINT.b, sx: FAINT.s, sz: FAINT.s, hit: false, idx: -1 });
    hl = { rings: list, ghostIdx: -1, box: null };
    if (h.ghost) {
      let obj = null;
      try { obj = app.world.buildPlaced(h.ghost); } catch (e) { console.warn('[town] ghost', e); }
      // the baked ghost mesh (one draw call, T2.4); null when the piece has nothing drawable or its placement is not
      // finite, and then the rings alone mark the spot
      const mesh = obj ? R.setGhost(obj) : null;
      if (mesh) {
        mesh.updateMatrixWorld(true);
        hl.box = new THREE.Box3().setFromObject(mesh).expandByScalar(0.05);
        // a broken ghost must never claim the whole screen (a NaN box passes ray.intersectsBox, T2.1)
        const b = hl.box;
        if (b.isEmpty() || ![b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z].every(Number.isFinite)) { hl.box = null; R.setGhost(null); }
      }
      if (hl.box) {
        // a gentle bob so the ghost reads as a ghost; small, low pieces (a fire pit, flowers) bob higher
        hl.bob = hl.box.max.y - hl.box.min.y < 1.2 ? 0.16 : 0.06;
        // which highlighted rec the ghost stands for: the ring nearest its slot
        const g = h.ghost;
        const def = app.catalog?.getDef?.(g.t);
        let gx = (g.x + 0.5) * 2, gz = (g.z + 0.5) * 2;
        if (def?.slot === 'edge') { gx = g.a === 'z' ? g.x * 2 : (g.x + 0.5) * 2; gz = g.a === 'z' ? (g.z + 0.5) * 2 : g.z * 2; }
        let best = Infinity;
        for (const r of list) {
          if (!r.hit) continue;
          const d = Math.hypot(r.x - gx, r.z - gz);
          if (d < best) { best = d; hl.ghostIdx = r.idx; }
        }
        if (hl.ghostIdx < 0) hl.ghostIdx = 0;
      }
    }
  }
  const ringBuf = [];
  function updateRings(frame) {
    if (!hl || frame.photo) { R.setRings([]); if (R.ghost) R.ghostHolder.visible = !frame.photo && !!hl; return; }
    R.ghostHolder.visible = true;
    R.ghostHolder.position.y = (hl.bob || 0) * (0.5 + 0.5 * Math.sin(time * 2.4));
    const pulse = 1 + 0.06 * Math.sin(time * 5.2), br = 0.8 + 0.2 * Math.sin(time * 5.2);
    ringBuf.length = hl.rings.length;
    hl.rings.forEach((r, i) => {
      const o = ringBuf[i] || (ringBuf[i] = {});
      const k = r.hit ? pulse : 1;                     // faint rings hold still
      o.x = r.x; o.y = r.y; o.z = r.z; o.b = r.hit ? r.b * br : r.b; o.sx = (r.sx || 1) * k; o.sz = (r.sz || 1) * k; o.yaw = r.yaw || 0;
    });
    R.setRings(ringBuf);
  }

  function rayAt(sx, sy) {
    const el = app.renderer.domElement;
    _ndc.set((sx / (el.clientWidth || 1)) * 2 - 1, -(sy / (el.clientHeight || 1)) * 2 + 1);
    _ray.setFromCamera(_ndc, app.camera);
    return _ray.ray;
  }

  function highlightHit(sx, sy) {
    if (!renderOn || !hl || !visible) return -1;
    const ray = rayAt(sx, sy);
    let best = -1, bestD = Infinity;
    for (const r of hl.rings) {
      if (!r.hit || Math.abs(ray.direction.y) < 1e-5) continue;
      const t = (r.y - ray.origin.y) / ray.direction.y;
      if (t <= 0) continue;
      const px = ray.origin.x + ray.direction.x * t - r.x, pz = ray.origin.z + ray.direction.z * t - r.z;
      const c = Math.cos(r.yaw || 0), s = Math.sin(r.yaw || 0);
      const u = (px * c - pz * s) / (r.sx || 1), v = (px * s + pz * c) / (r.sz || 1);
      const d = Math.hypot(u, v);
      if (d <= 0.9 && d < bestD) { bestD = d; best = r.idx; }
    }
    if (best >= 0) return best;
    if (hl.box && ray.intersectsBox(hl.box)) return hl.ghostIdx;
    return -1;
  }

  // ------------------------------------------------------------------ queries

  function positionOf(id) {
    const a = actors.get(id);
    if (!a) return null;
    if (a.tg.lie) return { x: a.x, y: a.y, z: a.z, headY: a.headY, visible: !!a.drawn && visible };   // the body centre
    return { x: a.ox3 ?? a.x, y: a.oy3 ?? a.y, z: a.oz3 ?? a.z, headY: a.headY, visible: !!a.drawn && visible };
  }

  function hitTest(sx, sy, pad = 24) {
    if (!renderOn || !visible) return null;
    const cam = app.camera, el = app.renderer.domElement;
    const W = el.clientWidth || 1, H = el.clientHeight || 1;
    const f = cam.projectionMatrix.elements[5] * H / 2;
    let best = null;
    for (const a of actors.values()) {
      if (!a.drawn || a.fade < 0.3 || a.model.status === 'passerby') continue;
      _a.set(0, 0.3, 0).applyMatrix4(a.matrix);
      _b.set(0, 0.95, 0).applyMatrix4(a.matrix);
      const da = _w.copy(_a).applyMatrix4(cam.matrixWorldInverse).z, db = _v.copy(_b).applyMatrix4(cam.matrixWorldInverse).z;
      if (da > -0.1 || db > -0.1) continue;                    // behind the camera
      const depth = -(da + db) / 2;
      _a.project(cam); _b.project(cam);
      const ax = (_a.x + 1) / 2 * W, ay = (1 - _a.y) / 2 * H, bx = (_b.x + 1) / 2 * W, by = (1 - _b.y) / 2 * H;
      const r = HIT_R * f / depth;
      const vx = bx - ax, vy = by - ay, L2 = vx * vx + vy * vy;
      const t = L2 > 1e-6 ? clamp(((sx - ax) * vx + (sy - ay) * vy) / L2, 0, 1) : 0;
      const d = Math.hypot(sx - (ax + vx * t), sy - (ay + vy * t));
      if (d <= r + pad) {
        const dist = Math.hypot(cam.position.x - a.ox3, cam.position.y - (a.oy3 + 0.6), cam.position.z - a.oz3);
        if (!best || dist < best.dist) best = { id: a.id, dist };
      }
    }
    return best;
  }

  // ------------------------------------------------------------------ nav overlay (townnav=1)

  function debugNav(src) {
    if (!src) { R.setOverlay(null); return; }
    const nav = src.nav && src.nav.cost ? src.nav : src;
    if (!nav.cost) { R.setOverlay(null); return; }
    const N = nav.N || 22, O = nav.O || 11, S = 10;
    const cv = document.createElement('canvas');
    cv.width = cv.height = N * S;
    const g = cv.getContext('2d');
    const ci = (x, z) => (x + O) * N + (z + O);
    for (let x = -O; x < N - O; x++) {
      for (let z = -O; z < N - O; z++) {
        const i = ci(x, z), c = nav.cost[i];
        let col;
        if (!Number.isFinite(c)) col = 'rgba(200,50,50,0.6)';
        else {
          const k = clamp((c - 0.55) / 3, 0, 1);
          col = `rgba(${Math.round(80 + 175 * k)},${Math.round(200 - 120 * k)},80,0.42)`;
        }
        g.fillStyle = col;
        g.fillRect((x + O) * S, (z + O) * S, S, S);
        if (nav.region && nav.region[i] >= 0 && nav.region[i] !== nav.mainRegion) { g.fillStyle = 'rgba(150,60,200,0.35)'; g.fillRect((x + O) * S, (z + O) * S, S, S); }
        if (nav.edge) {
          for (let d = 0; d < 4; d++) {
            const e = nav.edge[i * 4 + d];
            if (!e) continue;
            g.strokeStyle = e === 2 ? 'rgba(30,20,20,0.95)' : 'rgba(40,200,230,0.95)';
            g.lineWidth = e === 2 ? 2 : 1.5;
            const X0 = (x + O) * S, Z0 = (z + O) * S;
            g.beginPath();
            if (d === 0) { g.moveTo(X0, Z0 + S); g.lineTo(X0 + S, Z0 + S); }
            else if (d === 1) { g.moveTo(X0 + S, Z0); g.lineTo(X0 + S, Z0 + S); }
            else if (d === 2) { g.moveTo(X0, Z0); g.lineTo(X0 + S, Z0); }
            else { g.moveTo(X0, Z0); g.lineTo(X0, Z0 + S); }
            g.stroke();
          }
        }
      }
    }
    const cell = (x, z, col, inset = 0) => { g.fillStyle = col; g.fillRect((x + O) * S + inset, (z + O) * S + inset, S - 2 * inset, S - 2 * inset); };
    for (const b of src.homes || []) for (const [x, z] of b.foot || []) { g.strokeStyle = 'rgba(60,200,90,0.95)'; g.lineWidth = 1.5; g.strokeRect((x + O) * S + 1, (z + O) * S + 1, S - 2, S - 2); }
    for (const b of src.shells || []) for (const [x, z] of b.foot || []) { g.strokeStyle = 'rgba(240,170,40,0.95)'; g.lineWidth = 1.5; g.strokeRect((x + O) * S + 1, (z + O) * S + 1, S - 2, S - 2); }
    for (const b of [...(src.homes || []), ...(src.buildings || [])]) for (const d of b.doors || []) cell(d.step[0], d.step[1], 'rgba(60,110,240,0.9)', 2);
    for (const sp of src.spots || []) {
      if (!sp.at) continue;
      g.fillStyle = 'rgba(255,255,255,0.95)';
      g.beginPath(); g.arc((sp.at[0] / 2 + O) * S, (sp.at[2] / 2 + O) * S, 1.6, 0, TAU); g.fill();
    }
    if (nav.laneCell) cell(nav.laneCell[0], nav.laneCell[1], 'rgba(250,240,90,0.9)', 3);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    R.setOverlay(tex);
  }

  // ------------------------------------------------------------------ compile, visibility, stats

  async function compile(camera = app.camera) {
    if (!renderOn) return;
    let ok = true;
    try { ok = await R.compile(camera); } catch (e) { console.warn('[town] compile', e); ok = false; }
    if (!ok && R.patched) {
      // the patched program didn't link: rebuild the layer on the plain material (no limb swing, L6)
      console.warn('[town] villager shader patch failed; using the plain material');
      app.scene.remove(R.group);
      window.__townNoPatch = true;
      R = createRender(app);
      app.scene.add(R.group);
      R.group.visible = visible;
      try { await R.compile(camera); } catch { /* the plain material is the floor */ }
    }
  }

  function setVisible(b) {
    visible = !!b;
    R.group.visible = visible;
  }

  function sync(models) {
    gen++;
    for (const m of Array.isArray(models) ? models : []) {
      if (!m || m.id == null) continue;
      let a = actors.get(m.id);
      if (!a) { a = makeActor(m); actors.set(m.id, a); }
      a.removing = false;
      a.model = m;
      a.seen = gen;
      skin(a, m);
    }
    for (const a of actors.values()) if (a.seen !== gen) a.removing = true;
  }

  function stats() {
    const s = R.stats();
    return { calls: s.calls, tris: s.tris, instances: s.instances, updateMs: +ema.toFixed(4) };
  }

  return {
    sync, update, cue, positionOf, hitTest, setSpill, setCamp, highlight, highlightHit, compile, debugNav, setVisible, stats,
    /** For tests and the dev HUD (not part of the §12.4 contract). */
    get group() { return R.group; },
    get render() { return R; },
    get frame() { return lastFrame; },
    actor: (id) => actors.get(id) || null,
  };
}
