// Hearthwood — synthesized audio. Everything is generated with the Web Audio API (no files).
//
//  • Sound effects for building & UI          events.on('sfx', {name, flavor, opts?: {pitch, gain, pan}})
//  • Villagers (docs/LIVING.md §11): wish / move-in / gift chimes, a babble on the villager card, a hop "oop!",
//    and ambient chatter + work foley near the camera target, read from app.town.audible()
//  • Ambience: soft wind, daytime birdsong, night crickets & owls, rain, fire crackle near a
//    fireplace / stove / fire pit, frogs by a pond at night, leaf rustles in autumn weather
//  • Generative music: kalimba / music-box melody over warm pad chords in F major pentatonic,
//    ~70 bpm by day, slower, lower and softer at night
//
// Graph (one per AudioContext, built by makeKit):
//
//   voice ─► bus.inp ─┬─► bus.fader ─────────────────────────┐
//                     └─► send ─► bus.sendFader ─► reverb ───┤─► master ─► compressor ─► out
//   voice ─► bus.dry ─────► bus.fader ───────────────────────┘
//
// Buses: sfx, amb, music. state.sound fades sfx + amb, state.music fades music. The context
// is created lazily on the first user gesture, suspended while the page is hidden and when
// everything is switched off. Notes and ambient events use a lookahead scheduler driven by
// AudioContext.currentTime (setInterval + update()), never per-note setTimeout chains.
// Every short sound is a Voice that disconnects its nodes once its sources have ended.

const LOOKAHEAD = 0.3;          // seconds scheduled ahead of currentTime
const TICK_MS = 50;             // scheduler interval
const LEVEL = { master: 0.8, sfx: 0.8, amb: 0.8, music: 0.6 };
const SEND = { sfx: 0.25, amb: 0.35, music: 0.55 };
const MAX_SFX_VOICES = 18;

// Every chime, jingle and melody shares one key so effects harmonize with the music.
const KEY = 65;                               // F4
const SCALE = [0, 2, 4, 5, 7, 9, 11];         // major
const PENT = [0, 2, 4, 7, 9];                 // major pentatonic (pitch classes rel. to KEY)
const isPent = (m) => PENT.includes((((m - KEY) % 12) + 12) % 12);

const FIRE_IDS = new Set(['fireplace', 'wood_stove', 'fire_pit']);
const BIRD_IDS = new Set(['birdhouse', 'birdbath']);
const POND_IDS = new Set(['pond']);

// Minimum gap between repeats of the same effect (seconds) — draw mode can fire many quickly.
const GAP = {
  place: 0.045, replace: 0.05, remove: 0.05, paint: 0.06, rotate: 0.045, click: 0.035, open: 0.07,
  close: 0.07, undo: 0.06, level: 0.09, error: 0.22, success: 0.25, camera: 0.3,
  'blueprint-step': 0.07, 'blueprint-done': 0.8,
  wish: 0.5, 'wish-granted': 0.6, 'move-in': 1.0, gift: 1.0, villager: 0.2, hop: 0.15,
};

const SEASON_BIRDS = { spring: 1.3, summer: 1, autumn: 0.6, winter: 0.25 };
const SEASON_CRICKETS = { spring: 0.5, summer: 1, autumn: 0.75, winter: 0 };

// ------------------------------------------------------------------ small helpers

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const expRand = (mean) => -Math.log(1 - Math.random()) * mean;
function weighted(pairs) {
  let s = 0;
  for (const p of pairs) s += p[1];
  let r = Math.random() * s;
  for (const p of pairs) { r -= p[1]; if (r <= 0) return p[0]; }
  return pairs[pairs.length - 1][0];
}

/** Blend the `xf` samples after `len` into the head so the buffer loops without a click. */
function loopify(d, len, xf) {
  for (let i = 0; i < xf; i++) {
    const a = (i / xf) * Math.PI * 0.5;
    d[i] = d[i] * Math.sin(a) + d[len + i] * Math.cos(a);
  }
}
function normalize(d, peak) {
  let m = 0;
  for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > m) m = v; }
  if (m > 0) { const k = peak / m; for (let i = 0; i < d.length; i++) d[i] *= k; }
}

// ------------------------------------------------------------------ generated buffers

function pinkData(n) {
  const d = new Float32Array(n);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
    d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
    b6 = w * 0.115926;
  }
  return d;
}

function makeLoopBuffer(ctx, seconds, channels, fill) {
  const sr = ctx.sampleRate, len = Math.floor(sr * seconds), xf = Math.floor(sr * 0.08);
  const buf = ctx.createBuffer(channels, len, sr);
  for (let ch = 0; ch < channels; ch++) {
    const d = fill(len + xf, sr, ch);
    loopify(d, len, xf);
    buf.getChannelData(ch).set(d.subarray(0, len));
  }
  return buf;
}

function makeWhite(ctx) {
  const sr = ctx.sampleRate, buf = ctx.createBuffer(1, sr, sr);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

function makePink(ctx) {
  return makeLoopBuffer(ctx, 3.3, 2, (n) => { const d = pinkData(n); normalize(d, 0.95); return d; });
}

/** Stereo impulse response: short pre-delay, a few early reflections, a tail that darkens as it decays. */
function makeIR(ctx, seconds) {
  const sr = ctx.sampleRate, len = Math.floor(sr * seconds), pre = Math.floor(sr * 0.014);
  const buf = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = pre; i < len; i++) {
      const x = (i - pre) / (len - pre);
      const a = 0.2 + 0.72 * x;
      lp += (1 - a) * ((Math.random() * 2 - 1) - lp);
      d[i] = lp * Math.exp(-x * 5.5) * (1 - x);
    }
    for (let r = 0; r < 7; r++) {
      const i = pre + Math.floor(sr * rnd(0.003, 0.07));
      if (i < len) d[i] += rnd(-0.4, 0.4) * (1 - r / 8);
    }
  }
  return buf;
}

/** Fire: a soft flickering roar plus random crackles and the occasional snap. */
function makeCrackle(ctx) {
  return makeLoopBuffer(ctx, 4.3, 1, (n, sr) => {
    const d = new Float32Array(n);
    let b = 0, flick = 0.6, flickT = 0.6;
    for (let i = 0; i < n; i++) {
      if (i % 700 === 0) flickT = rnd(0.25, 1);
      flick += (flickT - flick) * 0.0008;
      b = b * 0.982 + (Math.random() * 2 - 1) * 0.05;
      d[i] = b * 0.55 * flick;
    }
    let i = 0;
    while (i < n) {
      i += Math.floor(sr * expRand(1 / 10));
      const big = Math.random() < 0.13;
      const amp = big ? rnd(0.45, 1) : Math.pow(Math.random(), 1.6) * 0.45;
      const dec = sr * (big ? rnd(0.003, 0.009) : rnd(0.0006, 0.0025));
      const len = Math.floor(dec * 6);
      let prev = 0;
      for (let j = 0; j < len && i + j < n; j++) {
        const w = Math.random() * 2 - 1;
        d[i + j] += (w - prev) * amp * Math.exp(-j / dec) * 0.5;
        prev = w;
      }
    }
    normalize(d, 0.9);
    return d;
  });
}

/** Rain: soft hiss + hundreds of tiny drop transients + a few brighter plips per second. */
function makeRain(ctx) {
  return makeLoopBuffer(ctx, 3.1, 2, (n, sr) => {
    const d = new Float32Array(n);
    let lp = 0, lp2 = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      lp += 0.45 * (w - lp);
      lp2 += 0.04 * (lp - lp2);
      d[i] = (lp - lp2) * 0.35;
    }
    const drop = (i, amp, dec) => {
      let prev = 0;
      const len = Math.floor(dec * 6);
      for (let j = 0; j < len && i + j < n; j++) {
        const w = Math.random() * 2 - 1;
        d[i + j] += (w - prev) * amp * Math.exp(-j / dec);
        prev = w;
      }
    };
    for (let i = 0; i < n;) { i += Math.floor(sr * expRand(1 / 380)); drop(i, Math.pow(Math.random(), 3) * 0.7, sr * rnd(0.0004, 0.0016)); }
    for (let i = 0; i < n;) {
      i += Math.floor(sr * expRand(1 / 5));
      const f = rnd(1600, 4200), len = Math.floor(sr * rnd(0.008, 0.016)), amp = rnd(0.05, 0.18);
      let ph = 0;
      for (let j = 0; j < len && i + j < n; j++) {
        ph += (2 * Math.PI * f * (1 + j / len * 0.5)) / sr;
        d[i + j] += Math.sin(ph) * amp * Math.exp(-j / (len * 0.25));
      }
    }
    normalize(d, 0.9);
    return d;
  });
}

/** One cricket: `periods` chirps of `pulses` short pulses of a ~4.5 kHz tone. Ends in silence (seamless loop). */
function makeCricket(ctx, { f, pulses, pulseLen, pulseGap, period, periods }) {
  const sr = ctx.sampleRate, len = Math.floor(sr * period * periods);
  const buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  for (let p = 0; p < periods; p++) {
    if (p > 0 && Math.random() < 0.1) continue;
    const amp = rnd(0.55, 1), ff = f * rnd(0.996, 1.004);
    for (let k = 0; k < pulses; k++) {
      const s0 = Math.floor(sr * (p * period + k * pulseGap + rnd(0, 0.002)));
      const m = Math.floor(sr * pulseLen);
      const ka = k === pulses - 1 ? 0.7 : 1;
      for (let j = 0; j < m && s0 + j < len; j++) {
        const e = Math.sin((Math.PI * j) / m) ** 2;
        const ph = (2 * Math.PI * ff * j) / sr;
        d[s0 + j] += amp * ka * e * (Math.sin(ph) + 0.08 * Math.sin(2 * ph)) * 0.85;
      }
    }
  }
  return buf;
}

// ------------------------------------------------------------------ kit (per AudioContext)

function periodic(ctx, amps) {
  const real = new Float32Array(amps.length), imag = new Float32Array(amps);
  return ctx.createPeriodicWave(real, imag);
}

function makeKit(ctx) {
  const kit = { ctx, voices: 0, nodes: 0, created: 0, sfxVoices: 0, bus: {}, buf: {}, wave: {}, layerNodes: 0 };
  const master = ctx.createGain();
  master.gain.value = LEVEL.master;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14; comp.knee.value = 12; comp.ratio.value = 3;
  comp.attack.value = 0.004; comp.release.value = 0.2;
  master.connect(comp);
  comp.connect(ctx.destination);

  const verb = ctx.createConvolver();          // impulse response is generated when idle (see kit.lazy)
  const verbIn = ctx.createBiquadFilter();       // keep the tail soft: clicks shouldn't splash
  verbIn.type = 'lowpass'; verbIn.frequency.value = 4200; verbIn.Q.value = 0.5;
  const verbOut = ctx.createGain();
  verbOut.gain.value = 0.8;
  verbIn.connect(verb); verb.connect(verbOut); verbOut.connect(master);

  for (const name of ['sfx', 'amb', 'music']) {
    const inp = ctx.createGain(), dry = ctx.createGain(), fader = ctx.createGain();
    const send = ctx.createGain(), sendFader = ctx.createGain();
    fader.gain.value = 0; sendFader.gain.value = 0; send.gain.value = SEND[name];
    inp.connect(fader); dry.connect(fader); fader.connect(master);
    inp.connect(send); send.connect(sendFader); sendFader.connect(verbIn);
    kit.bus[name] = { inp, dry, fader, sendFader, level: 0 };
  }
  kit.master = master;
  kit.comp = comp;
  kit.buf.white = makeWhite(ctx);
  kit.wave.warm = periodic(ctx, [0, 1, 0.42, 0.2, 0.11, 0.06, 0.035, 0.02]);
  kit.wave.bass = periodic(ctx, [0, 1, 0.55, 0.25, 0.1]);
  kit.wave.reed = periodic(ctx, [0, 1, 0.22, 0.07, 0.03]);
  // Bigger buffers are generated on demand: kit.want(name) queues it for an idle moment (so the
  // first tap / a weather change never stalls a frame), kit.lazy(name) builds it right now.
  kit.lazy = (name) => {
    if (!kit.buf[name]) {
      if (name === 'pink') kit.buf.pink = makePink(ctx);
      else if (name === 'ir') { kit.buf.ir = makeIR(ctx, 2.1); verb.buffer = kit.buf.ir; }
      else if (name === 'rain') kit.buf.rain = makeRain(ctx);
      else if (name === 'crackle') kit.buf.crackle = makeCrackle(ctx);
      else if (name === 'cricketA') kit.buf.cricketA = makeCricket(ctx, { f: 4650, pulses: 3, pulseLen: 0.017, pulseGap: 0.034, period: 0.6, periods: 5 });
      else if (name === 'cricketB') kit.buf.cricketB = makeCricket(ctx, { f: 4200, pulses: 4, pulseLen: 0.014, pulseGap: 0.028, period: 0.82, periods: 4 });
    }
    return kit.buf[name];
  };
  const pending = new Set();
  const idle = (fn) => (typeof requestIdleCallback === 'function' ? requestIdleCallback(fn, { timeout: 400 }) : setTimeout(fn, 16));
  kit.want = (name) => {
    if (kit.buf[name]) return true;
    if (!pending.has(name)) idle(() => { pending.delete(name); kit.lazy(name); });
    pending.add(name);
    return false;
  };
  kit.prepareAll = () => { for (const n of ['pink', 'ir', 'rain', 'crackle', 'cricketA', 'cricketB']) kit.lazy(n); };
  return kit;
}

/** Fade a bus (dry + reverb send) to `level`. tc = 0 → instant. */
function setBus(kit, name, level, t, tc) {
  const b = kit.bus[name];
  if (b.level === level && tc) return;
  b.level = level;
  for (const p of [b.fader.gain, b.sendFader.gain]) {
    if (tc) p.setTargetAtTime(level, t, tc);
    else { p.cancelScheduledValues(t); p.setValueAtTime(level, t); }
  }
}

// ------------------------------------------------------------------ voices

/** A short-lived group of nodes; disconnects everything once all its sources have ended. */
class Voice {
  constructor(kit, kind) {
    this.kit = kit; this.ctx = kit.ctx; this.kind = kind;
    this.nodes = []; this.live = 0; this.end = 0; this.closed = false;
    kit.voices++; kit.created++;
    if (kind === 'sfx') kit.sfxVoices++;
  }
  add(n) { this.nodes.push(n); this.kit.nodes++; return n; }
  gain(v, dest) {
    const g = this.add(this.ctx.createGain());
    g.gain.value = v;
    if (dest) g.connect(dest);
    return g;
  }
  filter(type, f, q, dest) {
    const n = this.add(this.ctx.createBiquadFilter());
    n.type = type; n.frequency.value = f; n.Q.value = q;
    if (dest) n.connect(dest);
    return n;
  }
  pan(p, dest) {
    if (!this.ctx.createStereoPanner) return this.gain(1, dest);
    const s = this.add(this.ctx.createStereoPanner());
    s.pan.value = clamp(p, -1, 1);
    if (dest) s.connect(dest);
    return s;
  }
  osc(wave, type) {
    const o = this.add(this.ctx.createOscillator());
    if (wave) o.setPeriodicWave(wave); else o.type = type || 'sine';
    return o;
  }
  play(src, t0, t1, offset = 0) {
    this.live++;
    src.onended = () => { if (--this.live <= 0) this.done(); };
    if (offset > 0) src.start(t0, offset); else src.start(t0);
    src.stop(t1);
    if (t1 > this.end) this.end = t1;
  }
  done() {
    if (this.closed) return;
    this.closed = true;
    for (const n of this.nodes) { try { n.disconnect(); } catch { /* already */ } }
    this.kit.nodes -= this.nodes.length;
    this.nodes.length = 0;
    this.kit.voices--;
    if (this.kind === 'sfx') this.kit.sfxVoices--;
  }
}

/** Oscillator with an attack / exponential-decay envelope (and optional pitch glide). */
function tone(v, dest, t, f, o) {
  const a = o.a ?? 0.003, d = o.d ?? 0.2, g = o.g ?? 0.2;
  const osc = v.osc(o.wave, o.type);
  osc.frequency.setValueAtTime(f, t);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + (o.glide ?? 0.05));
  if (o.detune) osc.detune.value = o.detune;
  const e = v.gain(0, dest);
  e.gain.setValueAtTime(0, t);
  e.gain.linearRampToValueAtTime(g, t + a);
  e.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  osc.connect(e);
  v.play(osc, t, t + a + d + 0.02);
  return osc;
}

/** Filtered noise burst. o.env === false leaves the gain at 0 for a custom envelope (returned). */
function noise(v, dest, t, o) {
  const a = o.a ?? 0.002, d = o.d ?? 0.1, g = o.g ?? 0.3;
  const name = o.buf || 'white';
  const buf = v.kit.buf[name] || v.kit.lazy(name);
  const len = (o.dur ?? a + d) + 0.03;
  const s = v.add(v.ctx.createBufferSource());
  s.buffer = buf;
  if (len > buf.duration) s.loop = true;
  let node = s;
  if (o.type) {
    const f = v.add(v.ctx.createBiquadFilter());
    f.type = o.type; f.Q.value = o.q ?? 0.8;
    f.frequency.setValueAtTime(o.f, t);
    if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, t + (o.sweep ?? a + d));
    s.connect(f);
    node = f;
  }
  const e = v.gain(0, dest);
  if (o.env !== false) {
    e.gain.setValueAtTime(0, t);
    e.gain.linearRampToValueAtTime(g, t + a);
    e.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }
  node.connect(e);
  const maxOff = buf.duration - len;
  v.play(s, t, t + len, maxOff > 0 ? Math.random() * maxOff : 0);
  return e;
}

/** Soft chime: sine + octave + a short two-octave sparkle. */
function chime(v, dest, t, f, g, d) {
  tone(v, dest, t, f, { a: 0.002, d, g });
  tone(v, dest, t, f * 2, { a: 0.002, d: d * 0.45, g: g * 0.28 });
  if (f * 4 < 12000) tone(v, dest, t, f * 4.01, { a: 0.001, d: d * 0.12, g: g * 0.09 });
}

const pentNote = (lo, i) => { // i-th pentatonic note at/above MIDI lo
  let m = lo, n = -1;
  while (true) { if (isPent(m)) { n++; if (n >= i) return m; } m++; }
};

// ------------------------------------------------------------------ sound effects

// Placement "flavors" — (voice, dry out, wet out, time, pitch mult, gain)
const PLACE = {
  wood(v, out, wet, t, p, g) {   // warm knock / thunk with a small settling "tock"
    const lp = v.filter('lowpass', 3400, 0.5, out);
    tone(v, lp, t, 190 * p, { to: 118 * p, glide: 0.05, a: 0.002, d: 0.18, g: 0.48 * g });                   // thump
    tone(v, lp, t, 390 * p, { type: 'triangle', to: 330 * p, glide: 0.04, a: 0.001, d: 0.09, g: 0.36 * g }); // hollow body (phones)
    noise(v, lp, t, { type: 'bandpass', f: 1400 * p, q: 1.3, a: 0.001, d: 0.035, g: 0.5 * g });              // contact
    tone(v, lp, t + 0.06, 520 * p, { type: 'triangle', to: 470 * p, glide: 0.03, a: 0.002, d: 0.06, g: 0.1 * g });
    noise(v, lp, t + 0.06, { type: 'bandpass', f: 2100 * p, q: 2, a: 0.001, d: 0.02, g: 0.14 * g });
  },
  stone(v, out, wet, t, p, g) {  // soft clack
    tone(v, out, t, 150 * p, { to: 105 * p, glide: 0.06, a: 0.002, d: 0.13, g: 0.42 * g });
    tone(v, out, t, 330 * p, { type: 'triangle', to: 290 * p, glide: 0.04, a: 0.001, d: 0.05, g: 0.12 * g });
    noise(v, out, t, { type: 'bandpass', f: 2600 * p, q: 2.5, a: 0.0008, d: 0.03, g: 0.6 * g });
    noise(v, out, t + 0.022, { type: 'bandpass', f: 3300 * p, q: 3, a: 0.0008, d: 0.025, g: 0.26 * g });
    tone(v, out, t, 1180 * p, { a: 0.001, d: 0.05, g: 0.05 * g });
  },
  soft(v, out, wet, t, p, g) {   // cushy thud
    tone(v, out, t, 125 * p, { to: 66 * p, glide: 0.1, a: 0.008, d: 0.24, g: 0.5 * g });
    tone(v, out, t, 270 * p, { type: 'triangle', to: 190 * p, glide: 0.08, a: 0.01, d: 0.11, g: 0.26 * g });
    noise(v, out, t, { buf: 'pink', type: 'lowpass', f: 700 * p, to: 240, q: 0.7, a: 0.012, d: 0.16, g: 0.5 * g });
  },
  glass(v, out, wet, t, p, g) {  // window frame knock + a little clink in key
    PLACE.wood(v, out, wet, t, p * 1.12, g * 0.7);
    const f = mtof(pentNote(KEY + 28, (Math.random() * 3) | 0));
    tone(v, wet, t + 0.014, f, { a: 0.001, d: 0.5, g: 0.12 * g });
    tone(v, wet, t + 0.014, f * 2.32, { a: 0.001, d: 0.26, g: 0.055 * g });
    tone(v, wet, t + 0.014, f * 4.25, { a: 0.001, d: 0.1, g: 0.022 * g });
    tone(v, wet, t + 0.085, f * 1.335, { a: 0.001, d: 0.28, g: 0.035 * g });
  },
  metal(v, out, wet, t, p, g) {  // small thud + ting
    tone(v, out, t, 165 * p, { to: 120 * p, glide: 0.05, a: 0.002, d: 0.12, g: 0.42 * g });
    tone(v, out, t, 360 * p, { type: 'triangle', to: 320 * p, glide: 0.04, a: 0.001, d: 0.06, g: 0.16 * g });
    noise(v, out, t, { type: 'bandpass', f: 1900 * p, q: 2, a: 0.001, d: 0.02, g: 0.34 * g });
    const f = mtof(pentNote(KEY + 24, (Math.random() * 4) | 0));
    tone(v, wet, t + 0.01, f, { a: 0.001, d: 0.7, g: 0.08 * g });
    tone(v, wet, t + 0.01, f * 1.004, { a: 0.001, d: 0.7, g: 0.055 * g });
    tone(v, wet, t + 0.01, f * 2.76, { a: 0.001, d: 0.24, g: 0.03 * g });
    tone(v, wet, t + 0.01, f * 5.4, { a: 0.001, d: 0.07, g: 0.016 * g });
  },
  leaf(v, out, wet, t, p, g) {   // soft set-down + rustle of micro-bursts
    tone(v, out, t, 150 * p, { to: 92 * p, glide: 0.08, a: 0.004, d: 0.1, g: 0.3 * g });
    tone(v, out, t, 310 * p, { type: 'triangle', to: 260 * p, glide: 0.05, a: 0.003, d: 0.06, g: 0.1 * g });
    const e = noise(v, out, t, { type: 'bandpass', f: 4000 * p, to: 3000 * p, q: 0.6, env: false, dur: 0.3 });
    let tt = t;
    for (let i = 0; i < 7; i++) {
      const pk = rnd(0.16, 0.4) * g * (1 - i * 0.09);
      e.gain.setValueAtTime(0, tt);
      e.gain.linearRampToValueAtTime(pk, tt + 0.004);
      e.gain.exponentialRampToValueAtTime(0.0001, tt + 0.03);
      tt += rnd(0.031, 0.042);     // never before the last burst's ramp ends: overlapping ramps spiked past 0 dBFS
    }
  },
};

const SFX = {
  place(v, out, wet, t, o) { (PLACE[o.flavor] || PLACE.wood)(v, out, wet, t, o.p, o.g); },

  replace(v, out, wet, t, o) {
    noise(v, out, t, { buf: 'pink', type: 'bandpass', f: 900 * o.p, to: 2600 * o.p, q: 1, a: 0.03, d: 0.07, g: 0.14 * o.g });
    (PLACE[o.flavor] || PLACE.wood)(v, out, wet, t + 0.045, o.p, o.g * 0.95);
  },

  remove(v, out, wet, t, o) {    // soft poof
    noise(v, out, t, { buf: 'pink', type: 'lowpass', f: 1700 * o.p, to: 260, sweep: 0.26, q: 1.2, a: 0.01, d: 0.3, g: 0.6 * o.g });
    tone(v, out, t, 300 * o.p, { to: 150 * o.p, glide: 0.12, a: 0.006, d: 0.14, g: 0.16 * o.g });
    noise(v, out, t + 0.02, { type: 'highpass', f: 3500, q: 0.7, a: 0.02, d: 0.12, g: 0.05 * o.g });
  },

  paint(v, out, wet, t, o) {     // brush swish + a tiny wet bloop
    noise(v, out, t, { type: 'bandpass', f: 650 * o.p, to: 2600 * o.p, sweep: 0.2, q: 1.6, a: 0.05, d: 0.16, g: 0.75 * o.g });
    noise(v, out, t + 0.14, { type: 'bandpass', f: 2200 * o.p, to: 1200 * o.p, sweep: 0.12, q: 1.6, a: 0.03, d: 0.1, g: 0.38 * o.g });
    tone(v, wet, t + 0.07, mtof(KEY + 7), { to: mtof(KEY + 12), glide: 0.05, a: 0.004, d: 0.12, g: 0.08 * o.g });
  },

  rotate(v, out, wet, t, o) {    // wooden ratchet tick-tock
    const tick = (tt, p, g) => {
      tone(v, out, tt, 1600 * p, { type: 'triangle', a: 0.0008, d: 0.028, g: 0.2 * g });
      tone(v, out, tt, 430 * p, { a: 0.001, d: 0.04, g: 0.14 * g });
      noise(v, out, tt, { type: 'bandpass', f: 3200 * p, q: 2.2, a: 0.0006, d: 0.014, g: 0.3 * g });
    };
    tick(t, o.p, o.g);
    tick(t + 0.05, o.p * 0.82, o.g * 0.7);
  },

  click(v, out, wet, t, o) {     // soft UI pop
    tone(v, out, t, 560 * o.p, { to: 840 * o.p, glide: 0.03, a: 0.002, d: 0.06, g: 0.18 * o.g });
    noise(v, out, t, { type: 'bandpass', f: 2400 * o.p, q: 1.5, a: 0.0005, d: 0.01, g: 0.08 * o.g });
  },

  open(v, out, wet, t, o) { whoosh(v, out, wet, t, true, o); },
  close(v, out, wet, t, o) { whoosh(v, out, wet, t, false, o); },

  undo(v, out, wet, t, o) {      // reverse swish (swells in, cuts off) + a little glide
    const fwd = !!o.redo;
    const e = noise(v, out, t, { buf: 'pink', type: 'bandpass', f: (fwd ? 900 : 2300) * o.p, to: (fwd ? 2300 : 900) * o.p, sweep: 0.2, q: 1.1, env: false, dur: 0.22 });
    e.gain.setValueAtTime(0.0001, t);
    e.gain.exponentialRampToValueAtTime(0.62 * o.g, t + 0.17);
    e.gain.linearRampToValueAtTime(0, t + 0.205);
    const [m0, m1] = fwd ? [KEY + 12, KEY + 16] : [KEY + 16, KEY + 12];
    tone(v, wet, t + 0.12, mtof(m0), { to: mtof(m1), glide: 0.1, a: 0.004, d: 0.18, g: 0.07 * o.g });
  },

  level(v, out, wet, t, o) {     // two-note chime, up or down
    const [a, b] = o.dir < 0 ? [KEY + 19, KEY + 12] : [KEY + 12, KEY + 19];
    chime(v, wet, t, mtof(a), 0.13 * o.g, 0.7);
    chime(v, wet, t + 0.12, mtof(b), 0.13 * o.g, 0.9);
  },

  error(v, out, wet, t, o) {     // gentle low "uh-oh" boop
    const lp = v.filter('lowpass', 900, 0.6, out);
    tone(v, lp, t, mtof(KEY - 8), { type: 'triangle', a: 0.015, d: 0.14, g: 0.17 * o.g });
    tone(v, lp, t, mtof(KEY - 8), { a: 0.015, d: 0.14, g: 0.08 * o.g });
    tone(v, lp, t + 0.15, mtof(KEY - 12), { type: 'triangle', to: mtof(KEY - 13), glide: 0.22, a: 0.018, d: 0.22, g: 0.15 * o.g });
    tone(v, lp, t + 0.15, mtof(KEY - 12), { to: mtof(KEY - 13), glide: 0.22, a: 0.018, d: 0.22, g: 0.07 * o.g });
  },

  success(v, out, wet, t, o) {   // cheerful rising arpeggio
    [KEY + 12, KEY + 16, KEY + 19, KEY + 24].forEach((m, i) => chime(v, wet, t + i * 0.075, mtof(m), 0.13 * o.g * (1 - i * 0.1), 0.6 + i * 0.15));
  },

  camera(v, out, wet, t, o) {    // shutter "ka-chick"
    noise(v, out, t, { type: 'highpass', f: 2200, q: 0.7, a: 0.0005, d: 0.014, g: 0.32 * o.g });
    tone(v, out, t, 190, { to: 120, glide: 0.03, a: 0.001, d: 0.04, g: 0.16 * o.g });
    noise(v, out, t + 0.012, { type: 'bandpass', f: 1300, q: 3, a: 0.01, d: 0.06, g: 0.1 * o.g });
    noise(v, out, t + 0.085, { type: 'highpass', f: 3000, q: 0.7, a: 0.0005, d: 0.02, g: 0.28 * o.g });
    tone(v, out, t + 0.085, 2400, { type: 'triangle', a: 0.0005, d: 0.02, g: 0.08 * o.g });
  },

  'blueprint-step'(v, out, wet, t, o) {  // tiny chime that climbs the scale as the build progresses
    const i = o.progress >= 0 ? Math.round(o.progress * 7) : (Math.random() * 6) | 0;
    const m = pentNote(KEY + 12, i);
    chime(v, wet, t, mtof(m), 0.15 * o.g, 0.8);
    if (Math.random() < 0.3) chime(v, wet, t + 0.07, mtof(pentNote(m + 1, 0)), 0.05 * o.g, 0.6);
  },

  'blueprint-done'(v, out, wet, t, o) {  // warm arpeggio over a pad swell
    [KEY, KEY + 4, KEY + 7, KEY + 12, KEY + 16, KEY + 19, KEY + 24].forEach((m, i) => {
      chime(v, wet, t + i * 0.09, mtof(m), 0.085 * o.g * (1 - i * 0.05), 1.1);
    });
    chime(v, wet, t + 0.8, mtof(KEY + 28), 0.05 * o.g, 1.4);
    const lp = v.filter('lowpass', 1400, 0.6, wet);
    const e = v.gain(0, lp);
    e.gain.setValueAtTime(0, t);
    e.gain.linearRampToValueAtTime(0.035 * o.g, t + 0.4);
    e.gain.setValueAtTime(0.035 * o.g, t + 1.3);
    e.gain.linearRampToValueAtTime(0, t + 3.2);
    for (const m of [KEY - 12, KEY - 5, KEY, KEY + 4]) {
      for (const det of [-7, 7]) {
        const osc = v.osc(v.kit.wave.warm);
        osc.frequency.value = mtof(m); osc.detune.value = det;
        osc.connect(e);
        v.play(osc, t, t + 3.25);
      }
    }
  },

  // ---- villagers (docs/LIVING.md §11.1)
  wish(v, out, wet, t, o) {      // two soft rising blips, very quiet (only while the bubble is on screen)
    tone(v, wet, t, mtof(KEY + 12), { a: 0.008, d: 0.16, g: 0.075 * o.g });
    tone(v, wet, t, mtof(KEY + 24), { a: 0.004, d: 0.06, g: 0.012 * o.g });
    tone(v, wet, t + 0.11, mtof(KEY + 19), { a: 0.008, d: 0.24, g: 0.07 * o.g });
  },

  'wish-granted'(v, out, wet, t, o) {   // music-box arpeggio over a soft bell, shimmer tail (brighter than success)
    tone(v, wet, t, mtof(KEY), { a: 0.012, d: 1.5, g: 0.055 * o.g });                 // bell
    tone(v, wet, t, mtof(KEY) * 2.76, { a: 0.004, d: 0.55, g: 0.016 * o.g });
    tone(v, wet, t, mtof(KEY) * 5.4, { a: 0.002, d: 0.2, g: 0.008 * o.g });
    [KEY + 12, KEY + 16, KEY + 19, KEY + 24].forEach((m, i) => {
      const tt = t + i * 0.085;
      chime(v, wet, tt, mtof(m), 0.135 * o.g * (1 - i * 0.07), 0.65 + i * 0.16);
      tone(v, wet, tt, mtof(m) * 3.01, { a: 0.001, d: 0.11, g: 0.022 * o.g });        // the tine's tick
    });
    for (let i = 0; i < 6; i++) {                                                       // shimmer tail
      tone(v, wet, t + 0.4 + i * 0.05, mtof(pentNote(KEY + 31, i)), { a: 0.001, d: 0.28, g: 0.024 * o.g * (1 - i * 0.12) });
    }
  },

  'move-in'(v, out, wet, t, o) {   // two wood knocks at the door, then a warm 4-note jingle over a short pad swell
    PLACE.wood(v, out, wet, t, 1.28, 0.55 * o.g);
    PLACE.wood(v, out, wet, t + 0.18, 1.22, 0.48 * o.g);
    const t1 = t + 0.95;                                                                 // lights on (§4.6)
    [KEY + 7, KEY + 12, KEY + 16, KEY + 19].forEach((m, i) => chime(v, wet, t1 + i * 0.13, mtof(m), 0.12 * o.g * (1 - i * 0.05), 0.9 + i * 0.12));
    chime(v, wet, t1 + 0.62, mtof(KEY + 24), 0.06 * o.g, 1.2);
    const lp = v.filter('lowpass', 1300, 0.6, wet);
    const e = v.gain(0, lp);
    e.gain.setValueAtTime(0, t1);
    e.gain.linearRampToValueAtTime(0.03 * o.g, t1 + 0.35);
    e.gain.setValueAtTime(0.03 * o.g, t1 + 0.8);
    e.gain.linearRampToValueAtTime(0, t1 + 1.9);
    for (const m of [KEY - 12, KEY - 5, KEY, KEY + 4]) {
      const osc = v.osc(v.kit.wave.warm);
      osc.frequency.value = mtof(m); osc.detune.value = m % 2 ? 6 : -6;
      osc.connect(e);
      v.play(osc, t1, t1 + 1.95);
    }
  },

  gift(v, out, wet, t, o) {      // ribbon rustle (crinkly band-passed noise) + a rising glissando chime
    let tt = t;
    for (let i = 0; i < 9; i++) {   // separate little bursts: no envelope ever overlaps another's automation
      noise(v, out, tt, { type: 'bandpass', f: 2800 + i * 260 + rnd(-200, 200), q: 1.1, a: 0.004, d: 0.035, g: rnd(0.16, 0.32) * o.g * (1 - i * 0.06) });
      tt += rnd(0.03, 0.052);
    }
    for (let i = 0; i < 7; i++) chime(v, wet, t + 0.34 + i * 0.05, mtof(pentNote(KEY + 12, i)), 0.085 * o.g * (0.75 + i * 0.05), 0.45 + i * 0.09);
  },

  villager(v, out, wet, t, o) {  // a 3-syllable babble in the villager's voice (opts.pitch 0.85–1.25)
    babbleOn(v, out, t, clamp(Number(o.pitch) || 1, 0.6, 1.6), 0.2 * o.g, 3, 1100);
  },

  hop(v, out, wet, t, o) {       // tiny "oop!"
    const p = clamp(Number(o.pitch) || 1, 0.6, 1.6);
    tone(v, out, t, 430 * p, { type: 'triangle', to: 660 * p, glide: 0.06, a: 0.004, d: 0.09, g: 0.2 * o.g });
    tone(v, out, t + 0.075, 610 * p, { type: 'triangle', to: 390 * p, glide: 0.05, a: 0.004, d: 0.08, g: 0.11 * o.g });
  },
};

/**
 * A little babble: syllables of a triangle voice through a moving vowel formant (band-pass) plus a soft low body.
 * Used by the villager card's `villager` sfx and the ambient chatter. Returns the end time.
 */
function babbleOn(v, dest, t, voice, g, syllables, formant = 0) {
  const e = v.gain(0);
  const bp = v.filter('bandpass', formant || rnd(700, 1800), 4);
  const bpOut = v.gain(3.2, dest);              // the formant keeps little of a triangle: bring it back up
  const lp = v.filter('lowpass', 900, 0.7);
  const lpOut = v.gain(0.55, dest);
  e.connect(bp); bp.connect(bpOut);
  e.connect(lp); lp.connect(lpOut);
  const o = v.osc(null, 'triangle');
  o.connect(e);
  let f = rnd(180, 340) * voice, tt = t;
  for (let i = 0; i < syllables; i++) {
    const d = rnd(0.06, 0.12);
    o.frequency.setValueAtTime(f, tt);
    o.frequency.linearRampToValueAtTime(f * rnd(0.86, 1.14), tt + d);
    bp.frequency.setValueAtTime(formant ? formant * rnd(0.75, 1.3) : rnd(700, 1800), tt);
    e.gain.setValueAtTime(0, tt);
    e.gain.linearRampToValueAtTime(g, tt + 0.01);
    e.gain.setValueAtTime(g, tt + Math.max(0.011, d - 0.06));
    e.gain.exponentialRampToValueAtTime(0.0001, tt + d + 0.06);
    tt += d + rnd(0.02, 0.05);
    f = clamp(f * rnd(0.88, 1.13), 170 * voice, 360 * voice);
  }
  v.play(o, t, tt + 0.08);
  return tt + 0.08;
}

// Work foley near the camera target (docs/LIVING.md §11.2). (voice, out, time, gain)
const FOLEY = {
  chop(v, out, t, g) {           // axe "tok"
    tone(v, out, t, 250, { to: 165, glide: 0.04, a: 0.001, d: 0.1, g: 0.32 * g });
    tone(v, out, t + 0.004, 780, { type: 'triangle', to: 640, glide: 0.03, a: 0.001, d: 0.045, g: 0.12 * g });
    noise(v, out, t, { type: 'bandpass', f: 1900, q: 2.2, a: 0.0008, d: 0.03, g: 0.45 * g });
  },
  splash(v, out, t, g) {         // a plip and a little spray
    tone(v, out, t, 880, { to: 1750, glide: 0.035, a: 0.001, d: 0.06, g: 0.1 * g });
    noise(v, out, t + 0.018, { type: 'bandpass', f: 2600, to: 900, sweep: 0.3, q: 0.8, a: 0.006, d: 0.28, g: 0.3 * g });
  },
  cluck(v, out, t, g) {          // "buk-buk-bawk"
    for (let i = 0; i < 3; i++) {
      const tt = t + i * 0.12 + (i === 2 ? 0.06 : 0), f = (i === 2 ? 720 : 560) * rnd(0.95, 1.05);
      const bp = v.filter('bandpass', 1300, 2.5, out);
      tone(v, bp, tt, f, { type: 'sawtooth', to: f * (i === 2 ? 0.8 : 0.9), glide: 0.05, a: 0.003, d: i === 2 ? 0.14 : 0.05, g: 0.2 * g });
    }
  },
  hum(v, out, t, g) {            // a hummed kalimba phrase (Cheerful and up)
    let m = pentNote(KEY + 5, (Math.random() * 3) | 0);
    for (let i = 0; i < 4; i++) {
      chime(v, out, t + i * 0.24, mtof(m), 0.07 * g * (1 - i * 0.1), 0.55);
      m = pentNote(m + 1, Math.random() < 0.55 ? 0 : 1) - (Math.random() < 0.3 ? 12 : 0);
      if (m < KEY) m += 12;
    }
  },
};

function whoosh(v, out, wet, t, up, o) {     // paper whoosh up / down
  noise(v, out, t, { buf: 'pink', type: 'bandpass', f: (up ? 500 : 2600) * o.p, to: (up ? 2600 : 450) * o.p, sweep: 0.24, q: 0.9, a: 0.1, d: 0.15, g: 0.62 * o.g });
  noise(v, out, t + 0.03, { type: 'highpass', f: 5000, q: 0.7, a: 0.05, d: 0.1, g: 0.05 * o.g });
  if (up) tone(v, wet, t + 0.13, mtof(KEY + 24), { a: 0.002, d: 0.35, g: 0.03 * o.g });
}

/** Play an effect on a kit. Returns the voice. */
function playSfxOn(kit, name, t, o) {
  const fn = SFX[name];
  if (!fn) return null;
  const v = new Voice(kit, 'sfx');
  try {
    // optional opts from the bus: gain (0..2) and pan (-1..1), e.g. a villager's hop beside the camera target
    const vol = (o.vol ?? 1) * (Number.isFinite(o.gain) ? clamp(o.gain, 0, 2) : 1);
    const pan = Number.isFinite(o.pan) ? clamp(o.pan, -1, 1) : 0;
    const out = v.gain(vol, pan ? v.pan(pan, kit.bus.sfx.dry) : kit.bus.sfx.dry);
    const wet = v.gain(vol, pan ? v.pan(pan, kit.bus.sfx.inp) : kit.bus.sfx.inp);
    fn(v, out, wet, t, o);
  } finally {
    if (v.live === 0) v.done();
  }
  return v;
}

// ------------------------------------------------------------------ ambience

/** A long-running looped layer (wind, rain, crickets, fire) that starts/stops its sources on demand. */
class Layer {
  constructor(kit, dest, build, needs) {
    this.kit = kit; this.build = build; this.needs = needs; this.refs = null;
    this.level = 0; this.offSince = -1;
    this.g = kit.ctx.createGain();
    this.g.gain.value = 0;
    this.g.connect(dest);
  }
  get playing() { return !!this.refs; }
  set(level, now, tc) {
    if (level > 1e-4) {
      this.offSince = -1;
      if (!this.refs) {
        let ready = true;
        for (const n of this.needs) if (!this.kit.want(n)) ready = false;   // buffers still being made
        if (!ready) return;
        this.refs = this.build(this.kit, this.g, now);
        this.kit.layerNodes += this.refs.nodes.length;
      }
    }
    if (Math.abs(level - this.level) > 1e-4) {
      this.g.gain.setTargetAtTime(level, now, tc);
      this.level = level;
    }
    if (level <= 1e-4 && this.refs) {
      if (this.offSince < 0) this.offSince = now;
      else if (now - this.offSince > tc * 6) this.stop();
    }
  }
  stop() {
    if (!this.refs) return;
    for (const s of this.refs.srcs) { try { s.stop(); } catch { /* not started */ } }
    for (const n of this.refs.nodes) { try { n.disconnect(); } catch { /* already */ } }
    this.kit.layerNodes -= this.refs.nodes.length;
    this.refs = null;
    this.level = 0;
    this.g.gain.cancelScheduledValues(0);
    this.g.gain.value = 0;
  }
}

function loopSrc(kit, buf, t, rate = 1) {
  const s = kit.ctx.createBufferSource();
  s.buffer = buf; s.loop = true; s.playbackRate.value = rate;
  s.start(t, Math.random() * buf.duration * 0.9);
  return s;
}
function biquad(ctx, type, f, q) {
  const b = ctx.createBiquadFilter();
  b.type = type; b.frequency.value = f; b.Q.value = q;
  return b;
}
function panNode(ctx, p) {
  if (!ctx.createStereoPanner) return ctx.createGain();
  const s = ctx.createStereoPanner();
  s.pan.value = p;
  return s;
}

const LAYERS = {
  wind(kit, g, t) {
    const c = kit.ctx;
    const s = loopSrc(kit, kit.lazy('pink'), t);
    const bp = biquad(c, 'bandpass', 420, 0.55), lp = biquad(c, 'lowpass', 1500, 0.5);
    const gust = c.createGain();
    gust.gain.value = 0.7;
    s.connect(bp); bp.connect(lp); lp.connect(gust); gust.connect(g);
    return { srcs: [s], nodes: [s, bp, lp, gust], bp, gust };
  },
  rain(kit, g, t) {
    const c = kit.ctx;
    const s = loopSrc(kit, kit.lazy('rain'), t);
    const lp = biquad(c, 'lowpass', 6500, 0.4);
    const r = loopSrc(kit, kit.lazy('pink'), t, 0.9);
    const rl = biquad(c, 'lowpass', 280, 0.5), rg = c.createGain();
    rg.gain.value = 0.45;
    s.connect(lp); lp.connect(g);
    r.connect(rl); rl.connect(rg); rg.connect(g);
    return { srcs: [s, r], nodes: [s, lp, r, rl, rg] };
  },
  crickets(kit, g, t) {
    const c = kit.ctx, srcs = [], nodes = [];
    const spec = [['cricketA', 1, -0.55, 1, 0], ['cricketB', 1, 0.6, 0.75, 0], ['cricketA', 1.07, 0.15, 0.4, 3200]];
    for (const [buf, rate, p, lvl, lpf] of spec) {
      const s = loopSrc(kit, kit.lazy(buf), t + Math.random() * 0.4, rate * rnd(0.98, 1.02));
      const pn = panNode(c, p), gg = c.createGain();
      gg.gain.value = lvl;
      let n = s;
      if (lpf) { const f = biquad(c, 'lowpass', lpf, 0.5); s.connect(f); n = f; nodes.push(f); }
      n.connect(pn); pn.connect(gg); gg.connect(g);
      srcs.push(s); nodes.push(s, pn, gg);
    }
    return { srcs, nodes };
  },
  fire(kit, g, t) {
    const c = kit.ctx;
    const a = loopSrc(kit, kit.lazy('crackle'), t), b = loopSrc(kit, kit.lazy('crackle'), t, 0.87);
    const pn = panNode(c, 0), bg = c.createGain();
    bg.gain.value = 0.6;
    a.connect(pn); b.connect(bg); bg.connect(pn); pn.connect(g);
    return { srcs: [a, b], nodes: [a, b, pn, bg], pan: pn };
  },
};

// Birds — each call is one voice (oscillator + envelope + panner). Return end time.
const BIRDS = [
  [function chirps(v, out, t, g) {
    const o = v.osc(); const e = v.gain(0, out); o.connect(e);
    const base = rnd(2800, 4300), n = 2 + ((Math.random() * 4) | 0), up = Math.random() < 0.6;
    let tt = t;
    for (let i = 0; i < n; i++) {
      const d = rnd(0.04, 0.075), f0 = base * rnd(0.97, 1.03), f1 = f0 * rnd(1.2, 1.45);
      o.frequency.setValueAtTime(up ? f0 : f1, tt);
      o.frequency.exponentialRampToValueAtTime(up ? f1 : f0, tt + d);
      e.gain.setValueAtTime(0, tt);
      e.gain.linearRampToValueAtTime(g * rnd(0.7, 1), tt + 0.006);
      e.gain.linearRampToValueAtTime(0, tt + d);
      tt += d + rnd(0.05, 0.13);
    }
    v.play(o, t, tt);
    return tt;
  }, 4],
  [function whistle(v, out, t, g) {  // "fee-bee"
    const o = v.osc(); const e = v.gain(0, out); o.connect(e);
    const f = rnd(3300, 4100), notes = [[f, 0.22], [f * rnd(0.8, 0.86), 0.28]];
    if (Math.random() < 0.35) notes.push([notes[1][0], 0.26]);
    let tt = t;
    for (const [ff, d] of notes) {
      o.frequency.setValueAtTime(ff * 1.02, tt);
      o.frequency.linearRampToValueAtTime(ff * 0.98, tt + d);
      e.gain.setValueAtTime(0, tt);
      e.gain.linearRampToValueAtTime(g * 0.8, tt + 0.03);
      e.gain.setValueAtTime(g * 0.8, tt + d - 0.05);
      e.gain.linearRampToValueAtTime(0, tt + d);
      tt += d + rnd(0.05, 0.09);
    }
    v.play(o, t, tt);
    return tt;
  }, 2],
  [function trill(v, out, t, g) {
    const o = v.osc(); const e = v.gain(0, out); o.connect(e);
    const lfo = v.osc(null, 'sine'), lg = v.gain(rnd(250, 600));
    lfo.frequency.value = rnd(16, 28); lfo.connect(lg); lg.connect(o.frequency);
    const d = rnd(0.45, 1), f = rnd(3600, 5000);
    o.frequency.setValueAtTime(f, t);
    o.frequency.linearRampToValueAtTime(f * rnd(0.85, 1.05), t + d);
    e.gain.setValueAtTime(0, t);
    e.gain.linearRampToValueAtTime(g * 0.7, t + 0.05);
    e.gain.linearRampToValueAtTime(g * 0.45, t + d - 0.05);
    e.gain.linearRampToValueAtTime(0, t + d);
    v.play(o, t, t + d + 0.02);
    v.play(lfo, t, t + d + 0.02);
    return t + d;
  }, 1.6],
  [function warble(v, out, t, g) {
    const o = v.osc(); const e = v.gain(0, out); o.connect(e);
    const n = 5 + ((Math.random() * 5) | 0), lo = rnd(2300, 3000);
    let tt = t;
    for (let i = 0; i < n; i++) {
      const d = rnd(0.045, 0.09), f0 = lo * rnd(1, 1.9), f1 = f0 * rnd(0.75, 1.3);
      o.frequency.setValueAtTime(f0, tt);
      o.frequency.exponentialRampToValueAtTime(f1, tt + d);
      e.gain.setValueAtTime(0, tt);
      e.gain.linearRampToValueAtTime(g * rnd(0.55, 1), tt + 0.008);
      e.gain.linearRampToValueAtTime(0, tt + d);
      tt += d + rnd(0.015, 0.05);
    }
    v.play(o, t, tt);
    return tt;
  }, 2.2],
  [function dove(v, out, t, g) {     // soft low "coo-OO-oo oo"
    const lp = v.filter('lowpass', 1100, 0.5, out);
    const o = v.osc(v.kit.wave.reed); const e = v.gain(0, lp); o.connect(e);
    const f = rnd(470, 560);
    const pat = [[0, 0.26, 1, 1.12], [0.34, 0.5, 1.16, 0.95], [1.02, 0.34, 0.97, 0.93], [1.46, 0.34, 0.97, 0.93]];
    for (const [s, d, a, b] of pat) {
      const tt = t + s;
      o.frequency.setValueAtTime(f * a, tt);
      o.frequency.linearRampToValueAtTime(f * b, tt + d);
      e.gain.setValueAtTime(0, tt);
      e.gain.linearRampToValueAtTime(g * 1.3, tt + 0.07);
      e.gain.linearRampToValueAtTime(0, tt + d);
    }
    v.play(o, t, t + 1.82);
    return t + 1.82;
  }, 0.6],
];

const OWL_PATTERNS = [
  [[0, 0.34, 1], [0.6, 0.16, 1.02], [0.8, 0.16, 1.02], [1.1, 0.6, 1]],  // great horned: hoo, hoo-hoo, hooo
  [[0, 0.42, 1.04], [0.95, 0.2, 1], [1.2, 0.65, 0.98]],                   // hoo … hoo-hooo
];

function owl(kit, t, pan, g) {
  const v = new Voice(kit, 'amb');
  const out = v.pan(pan, kit.bus.amb.inp);
  const lp = v.filter('lowpass', 850, 0.5, out);
  const e = v.gain(0, lp);
  const o = v.osc(kit.wave.reed); o.connect(e);
  const br = noise(v, e, t, { type: 'bandpass', f: 420, q: 3, env: false, dur: 2.0 }); // breathy edge
  br.gain.value = 0.25;
  const f = rnd(320, 380), pat = pick(OWL_PATTERNS);
  let end = t;
  for (const [s, d, pm] of pat) {
    const ts = t + s;
    o.frequency.setValueAtTime(f * pm * 0.96, ts);
    o.frequency.linearRampToValueAtTime(f * pm, ts + d * 0.3);
    o.frequency.linearRampToValueAtTime(f * pm * 0.92, ts + d);
    e.gain.setValueAtTime(0, ts);
    e.gain.linearRampToValueAtTime(g, ts + d * 0.35);
    e.gain.linearRampToValueAtTime(0, ts + d);
    end = ts + d;
  }
  v.play(o, t, end + 0.05);
  return end;
}

function frog(kit, t, pan, g) {     // "rib-bit": two croaks of quick nasal pulses
  const v = new Voice(kit, 'amb');
  const out = v.pan(pan, kit.bus.amb.inp);
  const bp = v.filter('bandpass', rnd(650, 950), 3.5, out);
  const e = v.gain(0, bp);
  const o = v.osc(null, 'sawtooth'); o.connect(e);
  const f = rnd(170, 250);
  let tt = t;
  for (let c = 0; c < 2; c++) {
    o.frequency.setValueAtTime(f * (c ? 1.12 : 1), tt);
    const pulses = 3 + ((Math.random() * 3) | 0);
    for (let p = 0; p < pulses; p++) {
      const ts = tt + p * 0.027;
      e.gain.setValueAtTime(0, ts);
      e.gain.linearRampToValueAtTime(g * (c ? 1 : 0.8), ts + 0.006);
      e.gain.linearRampToValueAtTime(0, ts + 0.021);
    }
    tt += pulses * 0.027 + rnd(0.06, 0.1);
  }
  v.play(o, t, tt);
  return tt;
}

function drip(kit, t, pan, g) {     // a raindrop plinking off the eaves
  const v = new Voice(kit, 'amb');
  const out = v.pan(pan, kit.bus.amb.inp);
  const f = rnd(1300, 2600);
  tone(v, out, t, f, { to: f * 1.6, glide: 0.025, a: 0.001, d: 0.06, g });
  return t + 0.1;
}

function rustle(kit, t, pan, g) {   // leaves skittering in a gust
  const v = new Voice(kit, 'amb');
  const out = v.pan(pan, kit.bus.amb.dry);
  const d = rnd(0.6, 1.3);
  const e = noise(v, out, t, { type: 'bandpass', f: rnd(3000, 4500), to: rnd(2200, 3200), q: 0.5, env: false, dur: d });
  e.gain.setValueAtTime(0, t);
  e.gain.linearRampToValueAtTime(g, t + d * 0.35);
  e.gain.linearRampToValueAtTime(g * 0.5, t + d * 0.7);
  e.gain.linearRampToValueAtTime(0, t + d);
  return t + d;
}

class Ambience {
  constructor(kit) {
    this.kit = kit;
    const dry = kit.bus.amb.dry;
    this.wind = new Layer(kit, dry, LAYERS.wind, ['pink']);
    this.rain = new Layer(kit, dry, LAYERS.rain, ['pink', 'rain']);
    this.crickets = new Layer(kit, dry, LAYERS.crickets, ['cricketA', 'cricketB']);
    this.fire = new Layer(kit, dry, LAYERS.fire, ['crackle']);
    this.next = { bird: -1, owl: -1, frog: -1, drip: -1, rustle: -1, gust: 0, chat: -1, foley: 0 };
    this.count = { bird: 0, owl: 0, frog: 0, drip: 0, rustle: 0, chatter: 0, foley: 0 };
  }
  get active() { return this.wind.playing || this.rain.playing || this.crickets.playing || this.fire.playing; }

  /** Continuous layers (called ~4×/s). */
  update(now, E) {
    this.wind.set(0.15 * E.wind, now, 1.5);
    this.rain.set(0.2 * E.rain, now, 1.8);
    this.crickets.set(0.06 * E.crickets, now, 2.5);
    this.fire.set(0.32 * E.fire * (0.65 + 0.35 * E.night), now, 0.5);
    if (this.fire.refs?.pan?.pan) this.fire.refs.pan.pan.setTargetAtTime(E.firePan, now, 0.3);
    if (this.wind.refs && now >= this.next.gust) {             // gusts: drift level & colour
      const tc = rnd(0.8, 2.2);
      this.wind.refs.gust.gain.setTargetAtTime(rnd(0.4, 1.15), now, tc);
      this.wind.refs.bp.frequency.setTargetAtTime(rnd(280, 650) * (E.snow ? 0.7 : 1), now, tc);
      this.next.gust = now + rnd(2.5, 7);
    }
  }

  /** Discrete events (birds, owls, frogs, drips, rustles) in [now, until). */
  schedule(now, until, E) {
    const n = this.next, k = this.kit, floor = now + 0.02;
    // never start an event in the past (after a main-thread stall) — it would begin mid-envelope
    if (n.bird >= 0 && n.bird < floor) n.bird = floor;
    if (n.owl >= 0 && n.owl < floor) n.owl = floor;
    if (n.frog >= 0 && n.frog < floor) n.frog = floor;
    if (n.drip >= 0 && n.drip < floor) n.drip = floor;
    if (n.rustle >= 0 && n.rustle < floor) n.rustle = floor;
    if (n.chat >= 0 && n.chat < floor) n.chat = floor;
    // birds
    if (E.birdRate > 0.002) {
      if (n.bird < 0) n.bird = now + rnd(0.3, 2.5);
      while (n.bird < until) {
        const fn = weighted(BIRDS);
        const pan = rnd(-0.85, 0.85), g = 0.055 * rnd(0.3, 1);
        let end = this._call(fn, n.bird, pan, g);
        if (Math.random() < 0.3) end = this._call(fn, end + rnd(0.3, 1.1), -pan * rnd(0.5, 1), g * rnd(0.5, 0.9)); // a reply
        n.bird = Math.max(end + 0.3, n.bird + expRand(1 / E.birdRate));
      }
    } else n.bird = -1;
    // owl
    if (E.owl) {
      if (n.owl < 0) n.owl = now + rnd(6, 18);
      if (n.owl < until) { owl(k, n.owl, rnd(-0.7, 0.7), 0.075 * rnd(0.6, 1)); this.count.owl++; n.owl += rnd(22, 55); }
    } else n.owl = -1;
    // frogs by the pond
    if (E.frogs) {
      if (n.frog < 0) n.frog = now + rnd(1, 5);
      while (n.frog < until) {
        let end = frog(k, n.frog, rnd(-0.6, 0.6), 0.05 * rnd(0.5, 1));
        if (Math.random() < 0.35) end = frog(k, end + rnd(0.1, 0.5), rnd(-0.8, 0.8), 0.035 * rnd(0.5, 1));
        this.count.frog++;
        n.frog = end + rnd(1.5, 7);
      }
    } else n.frog = -1;
    // drips off the eaves while raining
    if (E.rain) {
      if (n.drip < 0) n.drip = now + rnd(0.5, 2);
      while (n.drip < until) { drip(k, n.drip, rnd(-0.6, 0.6), 0.03 * rnd(0.4, 1)); this.count.drip++; n.drip += 0.15 + expRand(0.9); }
    } else n.drip = -1;
    // skittering leaves
    if (E.leaves) {
      if (n.rustle < 0) n.rustle = now + rnd(1, 3);
      if (n.rustle < until) { rustle(k, n.rustle, rnd(-0.8, 0.8), 0.05 * rnd(0.4, 1)); this.count.rustle++; n.rustle += rnd(1.8, 5); }
    } else n.rustle = -1;
    // villager chatter (docs/LIVING.md §11.2): talkers near the camera target, faded with distance and at night
    const talk = Array.isArray(E.talkers) ? E.talkers : [];
    let rate = 0;
    if (talk.length) {
      let chatty = 0;
      for (const tk of talk) chatty += tk && tk.chatty ? 1.5 : 1;
      rate = Math.min(0.8, 0.06 * talk.length) * (E.evening ? 1.5 : 1) * (chatty / talk.length) * (1 - 0.8 * (E.night || 0));
    }
    if (rate > 0.002) {
      if (n.chat < 0) n.chat = now + rnd(0.2, 1.2);     // someone pipes up soon after villagers come near
      while (n.chat < until) {
        const end = chatter(k, n.chat, pickTalker(talk));
        this.count.chatter++;
        n.chat = Math.max(end + 0.12, n.chat + expRand(1 / rate));
      }
    } else n.chat = -1;
    // work foley: at most one every 1.5 s, from the town's queue
    const fq = E.foley;
    if (Array.isArray(fq) && fq.length && now + 0.02 >= n.foley) {
      const f = fq.shift();
      if (f && FOLEY[f.kind]) {
        const v = new Voice(k, 'amb');
        const out = v.pan(clamp(Number(f.pan) || 0, -1, 1), k.bus.amb.inp);
        FOLEY[f.kind](v, out, Math.max(now + 0.02, floor), clamp(Number(f.gain) || 0, 0, 1) * 0.5);
        if (v.live === 0) v.done();
        this.count.foley++;
        n.foley = now + 1.5;
      }
    }
  }

  _call(fn, t, pan, g) {
    const v = new Voice(this.kit, 'amb');
    const out = v.pan(pan, this.kit.bus.amb.inp);
    this.count.bird++;
    return fn(v, out, t, g);
  }

  stop() {
    this.wind.stop(); this.rain.stop(); this.crickets.stop(); this.fire.stop();
    for (const key of Object.keys(this.next)) this.next[key] = -1;
  }
}

// ------------------------------------------------------------------ generative music

const DEG_NAMES = ['I', 'ii', 'iii', 'IV', 'V', 'vi'];
// Markov chord transitions (degree → [[next, weight]]) — I–vi–IV–V-ish, with ii and iii for colour.
const NEXT = [
  [[5, 3], [3, 3.5], [4, 1], [2, 0.8], [1, 1.2]],
  [[4, 5], [3, 2], [5, 1.2], [0, 1]],
  [[5, 5], [3, 4]],
  [[0, 3.2], [4, 3.2], [1, 1.2], [5, 2]],
  [[0, 5], [5, 3], [3, 1.5]],
  [[3, 4.5], [1, 2], [4, 2], [2, 1]],
];
// Melodic movement in pentatonic scale steps.
const STEP_W = [[-3, 0.04], [-2, 0.13], [-1, 0.3], [0, 0.07], [1, 0.28], [2, 0.13], [3, 0.05]];
// Onsets in eighth-note steps over a 2-bar phrase (16 steps).
const RHYTHM_DAY = [
  [0, 2, 4, 6, 8, 12], [0, 3, 4, 8, 11, 12], [0, 1, 2, 4, 8, 10], [0, 4, 6, 8], [0, 2, 3, 4, 6, 8, 14],
  [0, 6, 8, 9, 10, 12], [0, 2, 4, 8, 10, 12, 14], [0, 4, 8, 12], [0, 3, 6, 8, 10],
];
const RHYTHM_NIGHT = [[0, 4, 8], [0, 6, 8, 12], [0, 2, 4, 8], [0, 8, 10], [0, 4, 6, 12], [0, 3, 8]];

class Music {
  constructor(kit) {
    this.kit = kit;
    this.playing = false;
    this.plan = new Array(16).fill(null);
    this.chord = 0; this.cycle = 0; this.chords = 0; this.notes = 0;
    this.motif = null; this.energy = 0.7; this.pos = 0; this.nextTime = 0; this.needChord = false;
    this.setMode(false);
  }

  setMode(night) {
    this.night = night;
    this.bpm = night ? 54 : 70;
    this.stepDur = 60 / this.bpm / 2;
    const lo = night ? KEY - 5 : KEY + 2, hi = night ? KEY + 14 : KEY + 22;
    this.pent = [];
    for (let m = lo; m <= hi; m++) if (isPent(m)) this.pent.push(m);
    this.padCenter = night ? KEY - 10 : KEY - 6;
    this.idx = this.pent.length >> 1;
  }

  start(t, intro = true) {
    this.playing = true; this.nextTime = t; this.pos = 0; this.cycle = 0; this.intro = intro;
  }
  stop() { this.playing = false; }

  schedule(now, until, E) {
    if (!this.playing) return;
    if (this.nextTime < now - 0.1) {             // main thread stalled: skip ahead on the grid
      const skip = Math.ceil((now - this.nextTime) / this.stepDur);
      for (let i = 0; i < skip; i++) { this.pos = (this.pos + 1) & 15; if (this.pos === 0) this.needChord = true; }
      this.nextTime += skip * this.stepDur;
    }
    while (this.nextTime < until) {
      this._step(this.nextTime, E);
      this.nextTime += this.stepDur;
      this.pos = (this.pos + 1) & 15;
    }
  }

  _step(t, E) {
    if (this.pos === 0 || this.needChord) { this.needChord = false; this._newChord(t, E, 16 - this.pos); }
    if ((this.pos & 7) === 0) this._bass(t, this.pos === 0);
    const n = this.plan[this.pos];
    if (n) this._note(t + rnd(0, 0.014), n.m, n.v);
  }

  _newChord(t, E, steps) {
    const wantNight = (E?.night ?? 0) > 0.5;
    if (wantNight !== this.night && this.pos === 0) { this.setMode(wantNight); this.cycle = 0; this.motif = null; }
    let deg;
    if (this.cycle === 0) deg = this.night ? weighted([[5, 5], [0, 4], [3, 1]]) : weighted([[0, 7], [3, 1], [5, 1.5]]);
    else if (this.cycle === 3) deg = weighted(NEXT[this.chord].map(([d, w]) => [d, d === 4 ? w * 2 : d === 3 ? w * 1.5 : w]));
    else deg = weighted(NEXT[this.chord]);
    this.chord = deg;
    this.cycle = (this.cycle + 1) & 3;
    this.chords++;
    this.energy = clamp(this.energy + rnd(-0.2, 0.2), 0.3, 1);
    this._pad(t, steps * this.stepDur, deg);
    this._planMelody(deg);
  }

  chordPcs(deg, ext) {
    const pcs = [SCALE[deg], SCALE[(deg + 2) % 7], SCALE[(deg + 4) % 7]];
    if (ext) pcs.push(deg === 4 ? SCALE[(deg + 1) % 7] : SCALE[(deg + 6) % 7]); // 7ths, add9 on V
    return pcs;
  }

  _pad(t, dur, deg) {
    const k = this.kit, v = new Voice(k, 'music');
    const pcs = this.chordPcs(deg, Math.random() < 0.55);
    const A = this.night ? 2.6 : 1.8, R = this.night ? 3.2 : 2.4;
    const lvl = (this.night ? 0.03 : 0.034) / Math.sqrt(pcs.length);
    const lp = v.filter('lowpass', 300, 0.6, k.bus.music.inp);
    lp.frequency.setValueAtTime(300, t);
    lp.frequency.exponentialRampToValueAtTime(this.night ? 750 : 1250, t + Math.min(A, dur));
    lp.frequency.exponentialRampToValueAtTime(this.night ? 520 : 850, t + dur + R);
    const e = v.gain(0, lp);
    const atk = Math.min(A, dur * 0.8);
    e.gain.setValueAtTime(0, t);
    e.gain.linearRampToValueAtTime(lvl, t + atk);
    e.gain.setValueAtTime(lvl, t + dur);
    e.gain.linearRampToValueAtTime(0, t + dur + R);
    const notes = pcs.map((pc) => {
      let m = KEY + pc;
      while (m - this.padCenter > 6) m -= 12;
      while (this.padCenter - m > 6) m += 12;
      return m;
    }).sort((a, b) => a - b);
    for (let i = 1; i < notes.length; i++) if (notes[i] - notes[i - 1] <= 1) notes[i] += 12; // open up semitone rubs
    for (const m of notes) {
      for (const det of [-6, 6]) {
        const o = v.osc(k.wave.warm);
        o.frequency.value = mtof(m); o.detune.value = det + rnd(-2, 2);
        o.connect(e);
        v.play(o, t, t + dur + R + 0.05);
      }
    }
  }

  _bass(t, first) {
    if (!first && Math.random() < 0.3) return;
    let m = KEY - 24 + SCALE[this.chord] + (first || Math.random() < 0.5 ? 0 : 7);
    while (m > KEY - 10) m -= 12;
    const v = new Voice(this.kit, 'music');
    tone(v, this.kit.bus.music.dry, t, mtof(m), { wave: this.kit.wave.bass, a: 0.05, d: 8 * this.stepDur * 1.1, g: this.night ? 0.07 : 0.085 });
  }

  _note(t, m, vel) {   // kalimba / music-box pluck
    const k = this.kit, v = new Voice(k, 'music'), out = k.bus.music.inp, f = mtof(m);
    const d = this.night ? 2.3 : 1.6, g = vel * (this.night ? 0.07 : 0.085);
    tone(v, out, t, f, { a: 0.004, d, g });
    tone(v, out, t, f * 2, { a: 0.003, d: d * 0.32, g: g * 0.2 });
    if (!this.night && f * 5.95 < 10000) tone(v, out, t, f * 5.95, { a: 0.001, d: 0.06, g: g * 0.1 });
    this.notes++;
  }

  _snap(idx, deg) {   // nearest pentatonic note that is a chord tone
    const pcs = this.chordPcs(deg, false);
    for (let r = 0; r < 4; r++) {
      for (const j of [idx - r, idx + r]) {
        if (j < 0 || j >= this.pent.length) continue;
        if (pcs.includes((((this.pent[j] - KEY) % 12) + 12) % 12)) return j;
      }
    }
    return idx;
  }

  _planMelody(deg) {
    const plan = this.plan;
    plan.fill(null);
    if (this.intro) { this.intro = false; return; }                       // first chord: pad only
    const N = this.pent.length;
    if (Math.random() < (this.night ? 0.3 : 0.17)) {                      // a resting phrase
      if (Math.random() < 0.5) plan[0] = { m: this.pent[this._snap(this.idx, deg)], v: 0.6 };
      return;
    }
    let rhythm, steps;
    if (this.motif && Math.random() < 0.4) ({ rhythm, steps } = this.motif); // repeat the motif on the new chord
    else {
      rhythm = pick(this.night ? RHYTHM_NIGHT : RHYTHM_DAY);
      steps = rhythm.map(() => weighted(STEP_W));
      this.motif = { rhythm, steps };
    }
    let idx = this.idx;
    for (let i = 0; i < rhythm.length; i++) {
      const st = rhythm[i];
      if (i > 0) idx += steps[i];
      const mid = N >> 1;                                                 // gentle pull to the middle
      if (idx > mid + 4 && Math.random() < 0.5) idx--;
      if (idx < mid - 4 && Math.random() < 0.5) idx++;
      if (idx < 0) idx = -idx;
      if (idx >= N) idx = 2 * (N - 1) - idx;
      idx = clamp(idx, 0, N - 1);
      if (st % 4 === 0) idx = this._snap(idx, deg);
      if (i > 0 && st % 2 === 1 && Math.random() > this.energy + 0.25) continue; // calmer → fewer offbeats
      plan[st] = { m: this.pent[idx], v: (st % 8 === 0 ? 1 : st % 4 === 0 ? 0.85 : 0.7) * rnd(0.85, 1.05) };
      if (!this.night && st < 15 && Math.random() < 0.1 && this.pent[idx] + 12 <= 98) {
        plan[st + 1] = { m: this.pent[idx] + 12, v: 0.3 };              // music-box sparkle echo
      }
    }
    this.idx = idx;
  }

  info() {
    return { playing: this.playing, night: this.night, bpm: this.bpm, chord: DEG_NAMES[this.chord], chords: this.chords, notes: this.notes };
  }
}

// ------------------------------------------------------------------ analysis (tests / dev)

function analyze(buf, bins = 0, from = 0) {
  let peak = 0, sum = 0, clipped = 0, loud = 0, loudSum = 0;
  const n = buf.length - from, chs = buf.numberOfChannels;
  const env = bins ? new Array(bins).fill(0) : null;
  for (let c = 0; c < chs; c++) {
    const d = buf.getChannelData(c).subarray(from);
    for (let i = 0; i < n; i++) {
      const x = d[i], a = Math.abs(x);
      if (a > peak) peak = a;
      if (a >= 0.999) clipped++;
      sum += x * x;
      if (a > 0.001) { loud++; loudSum += x * x; }
      if (env) { const b = Math.floor((i / n) * bins); if (a > env[b]) env[b] = a; }
    }
  }
  const rms = Math.sqrt(sum / (n * chs));
  const activeRms = loud ? Math.sqrt(loudSum / loud) : 0;
  const db = (x) => (x > 0 ? Math.round(20 * Math.log10(x) * 10) / 10 : -Infinity);
  return { peak, rms, activeRms, peakDb: db(peak), rmsDb: db(rms), activeRmsDb: db(activeRms), clipped, seconds: n / buf.sampleRate, env };
}

const DEFAULT_ENV = () => ({
  night: 0, rain: 0, snow: 0, leaves: 0, birdRate: 0, crickets: 0, owl: 0, frogs: 0, wind: 0.5, fire: 0, firePan: 0,
  evening: 0, talkers: [], foley: [],
});

/** One talker, the nearer (louder) ones more often. */
function pickTalker(list) {
  let s = 0;
  for (const t of list) s += Math.max(0.05, Number(t?.gain) || 0);
  let r = Math.random() * s;
  for (const t of list) { r -= Math.max(0.05, Number(t?.gain) || 0); if (r <= 0) return t; }
  return list[list.length - 1];
}
/** One utterance of ambient chatter: 3–7 syllables in the talker's voice, panned to them, on the amb bus. */
function chatter(kit, t, tk) {
  const v = new Voice(kit, 'amb');
  const out = v.pan(clamp(Number(tk?.pan) || 0, -1, 1), kit.bus.amb.inp);
  const g = 0.025 * clamp(Number(tk?.gain ?? 1), 0, 1);
  const end = babbleOn(v, out, t, clamp(Number(tk?.pitch) || 1, 0.6, 1.6), g, 3 + ((Math.random() * 5) | 0));
  return end;
}

// ------------------------------------------------------------------ runtime

export function init(app) {
  const { state, events, world, camera } = app;
  let ctx = null, kit = null, amb = null, music = null;
  let unlocked = false, resumePending = false, timer = 0, offTimer = 0;
  let soundOffAt = -1, musicOffAt = -1, nextEnvAt = 0, updAcc = 0;
  const E = DEFAULT_ENV();
  const lastPlay = Object.create(null);
  const counts = { played: 0, throttled: 0, dropped: 0, errors: 0 };
  let placeStreak = 0, lastPlaceAt = 0;
  let prevLevel = state.level, levelDir = 1;
  let lastWorldKind = '', lastWorldAt = 0, progress = -1;
  const fx = { version: -1, rescanAt: 0, fires: [], birds: false, pond: false };

  // ---------------------------------------------------------------- context lifecycle

  function ensureCtx() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { ctx = new AC({ latencyHint: 'interactive' }); } catch { try { ctx = new AC(); } catch { return null; } }
    kit = makeKit(ctx);
    kit.want('pink'); kit.want('ir');
    amb = new Ambience(kit);
    music = new Music(kit);
    ctx.onstatechange = () => { if (ctx.state === 'running') resumePending = false; };
    applyToggles(true);
    timer = setInterval(tick, TICK_MS);
    return ctx;
  }

  function wake() {
    if (!ctx || ctx.state === 'running' || ctx.state === 'closed' || document.hidden) return;
    resumePending = true;
    ctx.resume().then(() => { resumePending = false; }, () => { resumePending = false; });
  }

  function onGesture(force) {
    if (!state.sound && !state.music) return;
    // Only create the context with real user activation (a touch pointerdown isn't one on mobile
    // Chrome — pointerup / touchend / click are), so the browser never logs an autoplay warning.
    if (!ctx && force !== true && navigator.userActivation && !navigator.userActivation.isActive) return;
    if (!ensureCtx()) return;
    wake();
    if (!unlocked) {          // iOS: play one silent sample inside the gesture to unlock output
      unlocked = true;
      try {
        const s = ctx.createBufferSource();
        s.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
        s.connect(ctx.destination);
        s.onended = () => s.disconnect();
        s.start(0);
      } catch { /* ignore */ }
    }
  }
  for (const type of ['pointerdown', 'pointerup', 'touchend', 'keydown', 'click']) {
    window.addEventListener(type, onGesture, { capture: true, passive: true });
  }

  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) { if (ctx.state === 'running') ctx.suspend().catch(() => {}); }
    else if (state.sound || state.music) wake();
  });

  function applyToggles(initial = false) {
    if (!ctx) {
      // turning sound on from a settings tap counts as a gesture
      if ((state.sound || state.music) && navigator.userActivation?.isActive) onGesture();
      return;
    }
    const now = ctx.currentTime;
    setBus(kit, 'sfx', state.sound ? LEVEL.sfx : 0, now, initial ? 0 : 0.08);
    setBus(kit, 'amb', state.sound ? LEVEL.amb : 0, now, initial ? 1.2 : 0.6);
    setBus(kit, 'music', state.music ? LEVEL.music : 0, now, state.music ? (initial ? 1.5 : 0.8) : 0.35);
    if (state.sound) soundOffAt = -1; else if (soundOffAt < 0) soundOffAt = now;
    if (state.music) musicOffAt = -1; else if (musicOffAt < 0) musicOffAt = now;
    if (state.music && !music.playing) music.start(now + 0.15, true);
    if (state.sound || state.music) {
      clearTimeout(offTimer); offTimer = 0;
      if (unlocked) wake();
    } else if (!offTimer) {
      offTimer = setTimeout(() => {           // everything off → stop sources and sleep (battery)
        offTimer = 0;
        if (state.sound || state.music || !ctx) return;
        amb.stop(); music.stop();
        if (ctx.state === 'running') ctx.suspend().catch(() => {});
      }, 1500);
    }
  }

  state.on((changed) => {
    if (changed.includes('level')) { levelDir = state.level >= prevLevel ? 1 : -1; prevLevel = state.level; }
    if (changed.includes('sound') || changed.includes('music')) applyToggles();
  });

  // ---------------------------------------------------------------- world awareness

  events.on('world-change', (d) => { lastWorldKind = d?.kind || ''; lastWorldAt = performance.now(); });
  events.on('blueprint-progress', (d) => { progress = d && d.total ? clamp(d.done / d.total, 0, 1) : -1; });

  function rescanWorld() {
    fx.fires.length = 0; fx.birds = false; fx.pond = false;
    if (!world?.entries) return;
    for (const e of world.entries.values()) {
      const id = e.def?.id || e.p?.t;
      if (FIRE_IDS.has(id) && e.obj) fx.fires.push(e.obj.position);
      else if (BIRD_IDS.has(id)) fx.birds = true;
      else if (POND_IDS.has(id)) fx.pond = true;
    }
  }

  /** Fire loudness (0..1) & pan from the camera's distance/direction to the nearest fires. */
  function fireLevel() {
    if (!fx.fires.length || !camera) { E.fire = 0; return; }
    const cp = camera.position, me = camera.matrixWorld.elements;
    let vol = 0, best = Infinity, pan = 0;
    for (const p of fx.fires) {
      const dx = p.x - cp.x, dy = p.y + 0.6 - cp.y, dz = p.z - cp.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      vol += 1 / (1 + (d / 9) * (d / 9));
      if (d < best) { best = d; pan = (dx * me[0] + dy * me[1] + dz * me[2]) / d; }
    }
    vol = Math.min(1, vol);
    E.fire = vol < 0.04 ? 0 : vol;
    E.firePan = clamp(pan * 0.8, -0.8, 0.8);
  }

  function computeEnv() {
    const t = ((((Number(state.time) || 0) % 1) + 1) % 1);
    const night = t < 0.5 ? 1 - smooth(0.19, 0.25, t) : smooth(0.77, 0.83, t);
    const day = 1 - night;
    const dawn = Math.max(0, 1 - Math.abs(t - 0.29) / 0.07), dusk = Math.max(0, 1 - Math.abs(t - 0.73) / 0.05);
    const w = state.weather, s = state.season;
    E.night = night;
    E.rain = w === 'rain' ? 1 : 0;
    E.snow = w === 'snow' ? 1 : 0;
    E.leaves = w === 'leaves' ? 1 : 0;
    E.birdRate = 0.22 * day * (SEASON_BIRDS[s] ?? 1) * (E.rain ? 0.12 : E.snow ? 0.35 : 1)
      * (1 + 1.5 * dawn + 0.6 * dusk) * (fx.birds ? 1.4 : 1);
    E.crickets = night * (SEASON_CRICKETS[s] ?? 1) * (E.rain ? 0.3 : 1) * (E.snow ? 0 : 1);
    E.owl = night > 0.85 && !E.rain ? 1 : 0;
    E.frogs = fx.pond && night > 0.5 && s !== 'winter' && !E.snow ? 1 : 0;
    E.wind = 0.55 + 0.3 * E.rain + 0.45 * E.leaves + 0.25 * E.snow + 0.1 * night;
    fireLevel();
    // villagers (docs/LIVING.md §11.2): talkers and work foley near the camera target, from the town
    const hr = t * 24;
    E.evening = hr >= 17 && hr < 21.5 ? 1 : 0;
    let a = null;
    try { a = app.town?.audible?.() || null; } catch { a = null; }
    E.talkers = state.chatter && a && Array.isArray(a.talkers) ? a.talkers.slice(0, 8) : [];
    if (!state.sound) E.foley.length = 0;
    else if (a && Array.isArray(a.foley) && a.foley.length) {
      for (const f of a.foley) if (f && f.kind) E.foley.push(f);
      if (E.foley.length > 3) E.foley.splice(0, E.foley.length - 3);
    }
  }

  // ---------------------------------------------------------------- scheduler

  function tick() {
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    try {
      if (now >= nextEnvAt) {
        nextEnvAt = now + 0.25;
        if (world && world.version !== fx.version) { fx.version = world.version; fx.rescanAt = now + 0.4; }
        if (fx.rescanAt && now >= fx.rescanAt) { fx.rescanAt = 0; rescanWorld(); }
        computeEnv();
        if (state.sound) amb.update(now, E);
        else if (soundOffAt >= 0 && now - soundOffAt > 2.5 && amb.active) amb.stop();
        if (!state.music && musicOffAt >= 0 && now - musicOffAt > 2.5 && music.playing) music.stop();
      }
      const until = now + LOOKAHEAD;
      if (state.sound) amb.schedule(now, until, E);
      if (state.music) music.schedule(now, until, E);
    } catch (e) {
      counts.errors++;
      if (counts.errors < 4) console.warn('[audio] scheduler', e);
    }
  }

  // ---------------------------------------------------------------- sound effects

  function play(name, flavor, extra) {
    if (!state.sound || !ctx || !SFX[name]) return false;
    if (ctx.state !== 'running' && !resumePending) return false;
    const nowMs = performance.now();
    const gap = (GAP[name] ?? 0.04) * 1000;
    if (nowMs - (lastPlay[name] ?? -1e9) < gap) { counts.throttled++; return false; }
    if (kit.sfxVoices >= MAX_SFX_VOICES) { counts.dropped++; return false; }
    const quick = nowMs - (lastPlay[name] ?? -1e9) < 200;
    lastPlay[name] = nowMs;
    const o = { flavor, p: rnd(0.95, 1.05), g: rnd(0.88, 1) * (quick ? 0.8 : 1), vol: 1, dir: levelDir, progress, ...extra };
    if (name === 'place' || name === 'replace') {   // draw-mode streaks drift gently upward in pitch
      placeStreak = nowMs - lastPlaceAt < 450 ? placeStreak + 1 : 0;
      lastPlaceAt = nowMs;
      o.p *= 1 + Math.min(placeStreak, 8) * 0.014;
    }
    if (name === 'undo' && lastWorldKind === 'redo' && nowMs - lastWorldAt < 100) o.redo = true;
    try {
      playSfxOn(kit, name, ctx.currentTime + 0.004, o);
      counts.played++;
      return true;
    } catch (e) {
      counts.errors++;
      if (counts.errors < 4) console.warn('[audio] sfx', name, e);
      return false;
    }
  }

  // opts (pitch, gain, pan) merge into the play options: a villager's voice, a hop beside the camera target
  events.on('sfx', (d) => { if (d && d.name) play(d.name, d.flavor, d.opts && typeof d.opts === 'object' ? d.opts : undefined); });

  // ---------------------------------------------------------------- offline rendering (tests / dev)

  /**
   * Render a sound with an OfflineAudioContext through the same graph (buses, reverb, compressor).
   * what: an sfx name | 'music' | 'ambience'. opts: { flavor, seconds, night, env, redo, dir, keep }.
   * Resolves to analysis { peak, rms, peakDb, rmsDb, activeRmsDb, clipped, env[] } (+ buffer if keep).
   */
  async function render(what, opts = {}) {
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    // sounds start after a short settle so the master compressor (and its makeup gain) is in its
    // steady state, as it is in the live game; analysis skips the settle period
    const sr = opts.sampleRate || 44100, settle = 0.4, seconds = opts.seconds || 1.5;
    const oc = new OAC(2, Math.ceil(sr * (seconds + settle)), sr);
    const k = makeKit(oc);
    k.prepareAll();
    for (const b of ['sfx', 'amb', 'music']) setBus(k, b, LEVEL[b], 0, 0);
    const env = Object.assign(DEFAULT_ENV(), opts.env || {});
    if (opts.night) env.night = 1;
    if (!state.chatter || !Array.isArray(env.talkers)) env.talkers = [];      // the Villager chatter switch
    if (!Array.isArray(env.foley)) env.foley = [];
    if (what === 'music') {
      const m = new Music(k);
      m.start(settle, opts.intro ?? false);
      for (let t = settle; t < seconds + settle; t += 0.25) m.schedule(t, t + LOOKAHEAD, env);
    } else if (what === 'ambience') {
      const a = new Ambience(k);
      for (let t = settle; t < seconds + settle; t += 0.25) { a.update(t, env); a.schedule(t, t + LOOKAHEAD, env); }
    } else if (SFX[what]) {
      playSfxOn(k, what, settle, { flavor: opts.flavor, p: 1, g: 0.94, vol: 1, dir: opts.dir ?? 1, redo: opts.redo, progress: opts.progress ?? -1, pitch: opts.pitch ?? 1, gain: opts.gain, pan: opts.pan });
    } else throw new Error('unknown sound ' + what);
    const buf = await oc.startRendering();
    const res = analyze(buf, opts.bins ?? 120, Math.floor(settle * sr) - 64);
    res.voicesLeft = k.voices;
    if (opts.keep) { res.buffer = buf; res.from = Math.floor(settle * sr) - 64; }
    return res;
  }

  // ---------------------------------------------------------------- public API

  return {
    update(dt) {
      if (!ctx || ctx.state !== 'running') return;
      updAcc += dt;
      if (updAcc >= 0.05) { updAcc = 0; tick(); }
    },
    play,
    unlock: () => onGesture(true),
    render,
    get context() { return ctx; },
    stats() {
      return {
        ctx: ctx ? ctx.state : 'none',
        time: ctx ? +ctx.currentTime.toFixed(2) : 0,
        unlocked,
        voices: kit?.voices ?? 0, nodes: kit?.nodes ?? 0, layerNodes: kit?.layerNodes ?? 0,
        created: kit?.created ?? 0, sfxVoices: kit?.sfxVoices ?? 0,
        ...counts,
        buses: kit ? { sfx: +kit.bus.sfx.fader.gain.value.toFixed(3), amb: +kit.bus.amb.fader.gain.value.toFixed(3), music: +kit.bus.music.fader.gain.value.toFixed(3) } : null,
        music: music?.info() ?? null,
        amb: amb ? {
          wind: amb.wind.playing, rain: amb.rain.playing, crickets: amb.crickets.playing, fire: amb.fire.playing, ...amb.count,
        } : null,
        env: { ...E },
        fires: fx.fires.length,
        timer: !!timer,
      };
    },
  };
}
