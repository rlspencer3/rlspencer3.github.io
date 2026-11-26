// Orbit camera rig with mobile-first gestures.
//   Touch:  tap = action · press & hold = aim (the aim point lifts `lift` px above the fingertip so the finger never
//           hides it, then follows the finger; lift to place there — the finger may rest on the tray meanwhile; lift
//           with the aim point over the UI, or the finger past the edge of the screen, to cancel: while it would, the
//           preview hides and the ring turns dashed — under the UI it slips beneath it). docs/SMART_BUILD.md §6.
//           1 finger drag = orbit around what's under the screen centre (or draw in draw mode)
//           2 fingers = pinch zoom / twist / slide, all anchored on the point between the fingers
//   Mouse:  left drag = orbit (or draw) · right/middle drag or shift+drag = pan · wheel = zoom toward the cursor · click = action
// Callbacks (all optional): onTap(x, y, e), onHover(x, y), onDrawStart/Move/End(x, y), onGestureStart(),
//   onPress(x, y, type)      a single pointer went down (touch preview)
//   onAimStart(fx, fy)       press-and-hold aiming started (touch / pen): the finger's own point
//   onAimMove(x, y, off)     the aim point moved: every finger move and each frame of the lift's ease; off: lifting
//                            now would cancel (the aim point over the UI or off the view, or the finger off the screen)
//   onAimEnd(x, y, cancelled, e)   the aim ended at the aim point as drawn (the lifted point; mid-ease too)
//   aimLift                  true: a touch aim lifts above the finger (main.js / builder keep it = setting && !photo)
//   aim (read-only)          null outside an aim, else { fx, fy, x, y, k, lift, off } (finger, aim point, ease 0..1, px,
//                            would a lift cancel)
//   onDrawCancel()           a draw stroke turned out to be the start of a two-finger gesture
//   pickPoint(x, y) → THREE.Vector3 | null     world point under a screen position (pinch / slide pivot)
//   orbitPoint(x, y) → THREE.Vector3 | null    point to turn around for what's under (x, y), e.g. the middle of a house

import * as THREE from 'three';
import { clamp } from './config.js';

const TAP_MOVE_TOUCH = 10;
const TAP_MOVE_MOUSE = 5;
const AIM_MS = 450;             // hold this long without moving to start aiming (a long-press)
const DRAW_GRACE_MS = 350;      // a second finger within this time of a stroke start cancels the stroke…
const DRAW_GRACE_PX = 64;       // …or before the first finger has travelled this far
const AIM_EASE_MS = 140;        // the aim point eases from the fingertip up to its lift in this long (easeOutCubic)…
const AIM_EASE_DT = 0.025;      // …advancing at most this many seconds per frame, so a slow frame never jumps it far
const AIM_TOP_PAD = 6;          // the aim point stays this far under the top bar (no room above: it leans sideways)
const AIM_TETHER_GAP = 26;      // the tether starts this far from the fingertip…
const AIM_RING_R = 9;           // …and ends at the ring's edge (18 px ring)
const AIM_TETHER_MIN = 6;       // shorter than this, it is hidden

const _ray = new THREE.Raycaster();
const _ndc = new THREE.Vector2();
const _plane = new THREE.Plane();
const _n = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _d = new THREE.Vector3();

export class CameraRig {
  constructor(camera, dom) {
    this.camera = camera;
    this.dom = dom;
    this.target = new THREE.Vector3(0, 1, 0);
    this.theta = Math.PI * 0.25;   // azimuth
    this.phi = 1.0;                // polar angle from +Y
    this.radius = 30;
    this.goal = { target: this.target.clone(), theta: this.theta, phi: this.phi, radius: this.radius };
    this.minRadius = 5;
    this.maxRadius = 80;
    this.minPhi = 0.18;
    this.maxPhi = 1.45;
    this.bounds = 36;
    this.drawMode = false;
    this.enabled = true;
    this.aimLift = true;           // a touch aim lifts above the finger (the "Preview above your finger" setting)
    this.aim = null;               // { fx, fy, x, y, k, lift } during an aim (read-only for callers)
    this._aimEl = null;            // the aim ring (created on the first lifted aim)
    this.targetY = 1;

    this.onTap = null; this.onHover = null;
    this.onDrawStart = null; this.onDrawMove = null; this.onDrawEnd = null; this.onDrawCancel = null;
    this.onGestureStart = null; this.onPress = null;
    this.onAimStart = null; this.onAimMove = null; this.onAimEnd = null;
    this.pickPoint = null;
    this.orbitPoint = null;

    this.pointers = new Map();
    this.mode = 'idle'; // idle | pending | orbit | pan | draw | aim | multi | wait
    this._aimTimer = 0;
    this._drawT = 0;
    this.multi = { dist: 1, angle: 0, mx: 0, my: 0, pivot: new THREE.Vector3(), turn: new THREE.Vector3() };
    // screen pixels covered by UI chrome (top bar, bottom tray): the view is shifted so the orbit target sits
    // in the middle of what you can actually see, not behind the tray
    this.insets = { top: 0, bottom: 0, left: 0, right: 0 };
    this._ofs = 0; this._ofx = 0; this._vw = 0; this._vh = 0; this._asp = 0;
    this._bind();
  }

  _bind() {
    const d = this.dom;
    d.style.touchAction = 'none';
    d.addEventListener('pointerdown', (e) => this._down(e));
    window.addEventListener('pointermove', (e) => this._move(e));
    window.addEventListener('pointerup', (e) => this._up(e));
    window.addEventListener('pointercancel', (e) => this._up(e, true));
    d.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (!this.enabled) return;
      const f = Math.exp(clamp(e.deltaY, -120, 120) * 0.0015);
      const p = this._local(e);
      this._zoomAbout(f, this._pivotAt(p.x, p.y, _a) ? _a : null);
    }, { passive: false });
    d.addEventListener('contextmenu', (e) => e.preventDefault());
    d.addEventListener('pointerleave', () => { if (this.onHover && this.mode === 'idle') this.onHover(null, null); });
  }

  _local(e) {
    const r = this.dom.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  // ---------------------------------------------------------------- picking helpers

  _rayAt(sx, sy) {
    const w = this.dom.clientWidth || 1, h = this.dom.clientHeight || 1;
    _ndc.set((sx / w) * 2 - 1, -(sy / h) * 2 + 1);
    _ray.setFromCamera(_ndc, this.camera);
    return _ray.ray;
  }

  /** Point on the horizontal plane at height y under a screen position (null if the ray misses it). */
  _planeAt(sx, sy, y, out) {
    const ray = this._rayAt(sx, sy);
    _plane.set(_n, -y);
    const hit = ray.intersectPlane(_plane, out);
    if (!hit) return null;
    // ignore near-horizon hits: they explode with tiny finger moves
    if (hit.distanceTo(ray.origin) > this.maxRadius * 2.5) return null;
    return hit;
  }

  /** World point a gesture should pivot on: the piece / ground under the screen point, else the target plane. */
  _pivotAt(sx, sy, out) {
    let p = null;
    try { p = this.pickPoint?.(sx, sy) || null; } catch { p = null; }
    if (p && p.distanceTo(this.camera.position) <= this.maxRadius * 1.5) return out.copy(p);
    return this._planeAt(sx, sy, this.goal.target.y, out);
  }

  // ---------------------------------------------------------------- pointer handling

  _down(e) {
    if (!this.enabled) return;
    this.dom.setPointerCapture?.(e.pointerId);
    const pos = this._local(e);
    this.pointers.set(e.pointerId, { ...pos, sx: pos.x, sy: pos.y, t: performance.now(), type: e.pointerType, button: e.button, shift: e.shiftKey });
    if (this.pointers.size === 1) {
      if (e.pointerType === 'mouse' && (e.button === 1 || e.button === 2 || e.shiftKey)) this.mode = 'pan';
      else {
        this.mode = 'pending';
        if (e.pointerType !== 'mouse') {
          this.onPress?.(pos.x, pos.y, e.pointerType);
          clearTimeout(this._aimTimer);
          const id = e.pointerId;
          this._aimTimer = setTimeout(() => this._startAim(id), AIM_MS);
        }
      }
    } else if (this.pointers.size === 2) {
      clearTimeout(this._aimTimer);
      if (this.mode === 'draw') {
        // a pinch whose first finger slid a little: undo the accidental stroke instead of keeping it
        const first = [...this.pointers.values()][0];
        const travel = first ? Math.hypot(first.x - first.sx, first.y - first.sy) : 0;
        if ((performance.now() - this._drawT < DRAW_GRACE_MS || travel < DRAW_GRACE_PX) && this.onDrawCancel) this.onDrawCancel();
        else this.onDrawEnd?.(pos.x, pos.y);
      } else if (this.mode === 'aim') {
        const a = this.aim;
        this._endAim();
        this.onAimEnd?.(a ? a.x : pos.x, a ? a.y : pos.y, true);
      }
      this.mode = 'multi';
      this._initMulti();
      this.onGestureStart?.();
    }
  }

  _startAim(id) {
    const ptr = this.pointers.get(id);
    if (!ptr || this.mode !== 'pending' || this.pointers.size !== 1 || !this.enabled) return;
    if (this.drawMode) return;          // in draw mode a held finger simply starts the stroke when it moves
    this.mode = 'aim';
    // the aim point starts at the fingertip (k = 0) and eases up to its lift in update(); the ring fades in with it
    this.aim = { fx: ptr.x, fy: ptr.y, x: ptr.x, y: ptr.y, k: 0, lift: this._liftPx(ptr.type), off: false };
    this.onAimStart?.(ptr.x, ptr.y);
    this._drawAim();
  }

  /** Would lifting now cancel the aim? The finger past the edge of the view, or the aim point (the lifted point, or the
   *  finger itself when nothing lifts) off the view or over the UI (elementFromPoint there is not the canvas). Judged at
   *  the point the ring marks, so a finger resting on the tray still places where the ring is over the view. */
  _aimOff(a = this.aim) {
    if (!a) return true;
    const r = this.dom.getBoundingClientRect();
    const inside = (x, y) => x >= 0 && x < r.width && y >= 0 && y < r.height;
    if (!inside(a.fx, a.fy) || !inside(a.x, a.y)) return true;
    if (typeof document === 'undefined' || typeof document.elementFromPoint !== 'function') return false;
    return document.elementFromPoint(r.left + a.x, r.top + a.y) !== this.dom;
  }

  /** How far a press-and-hold aim lifts above the finger, in px: 62 on an iPhone (either way up), 52 on a 320 px
   *  phone, 72 on a tablet. Touch only (a stylus tip or a mouse hides nothing); 0 with the setting off. */
  _liftPx(type = 'touch') {
    if (!this.aimLift || type !== 'touch') return 0;
    const w = window.innerWidth || this.dom.clientWidth || 0, h = window.innerHeight || this.dom.clientHeight || 0;
    return clamp(Math.round(Math.min(w, h) * 0.16), 52, 72);
  }

  /** Put the aim point where it is drawn now: `lift × ease` above the finger, kept under the top bar (leaning toward
   *  the middle of the screen when there is no room above) and on the screen. Returns true if it moved ≥ 0.5 px. */
  _placeAim() {
    const a = this.aim;
    if (!a) return false;
    const k = a.k, e = 1 - (1 - k) * (1 - k) * (1 - k);
    const L = a.lift * e, w = this.dom.clientWidth || 1;
    let x = a.fx, y = a.fy;
    if (L > 0) {
      const top = this.insets.top + AIM_TOP_PAD;
      const dy = Math.min(L, Math.max(0, a.fy - top));
      const dx = Math.sqrt(Math.max(0, L * L - dy * dy)) * (a.fx < w / 2 ? 1 : -1);
      x = clamp(a.fx + dx, 2, w - 2);
      y = a.fy - dy;
    }
    const moved = Math.abs(x - a.x) >= 0.5 || Math.abs(y - a.y) >= 0.5;
    a.x = x; a.y = y;
    return moved;
  }

  /** The ring at the aim point and its tether toward the fingertip (DOM, transforms only; never takes a touch). */
  _drawAim() {
    const a = this.aim;
    if (!a || !(a.lift > 0)) { if (this._aimEl) this._aimEl.style.display = 'none'; return; }
    let el = this._aimEl;
    if (!el) {
      const parent = this.dom.parentElement;
      if (!parent || typeof document === 'undefined') return;
      el = document.createElement('div');
      el.className = 'hw-aim';
      el.setAttribute('aria-hidden', 'true');
      el.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;pointer-events:none;display:none;opacity:0;z-index:1';
      const tether = document.createElement('div');
      tether.className = 'hw-aim-tether';
      tether.style.cssText = 'position:absolute;left:0;top:0;width:2px;height:1px;background:rgba(255,255,255,.55);transform-origin:0 0;pointer-events:none';
      const ring = document.createElement('div');
      ring.className = 'hw-aim-ring';
      ring.style.cssText = `position:absolute;left:${-AIM_RING_R}px;top:${-AIM_RING_R}px;width:${AIM_RING_R * 2}px;height:${AIM_RING_R * 2}px;box-sizing:border-box;`
        + 'border:2px solid #fff;border-radius:50%;box-shadow:0 0 0 1px rgba(60,40,20,.45);pointer-events:none';
      const dot = document.createElement('div');
      dot.style.cssText = 'position:absolute;left:50%;top:50%;width:4px;height:4px;margin:-2px 0 0 -2px;border-radius:50%;background:#fff;box-shadow:0 0 0 1px rgba(60,40,20,.45)';
      ring.append(dot);
      el.append(tether, ring);
      parent.append(el);
      this._aimEl = el;
      this._aimRing = ring;
      this._aimTether = tether;
    }
    const e = 1 - (1 - a.k) * (1 - a.k) * (1 - a.k);
    // the canvas fills #game, so canvas px are the ring's px (offset kept in case it ever doesn't)
    const ox = this.dom.offsetLeft || 0, oy = this.dom.offsetTop || 0;
    el.style.display = 'block';
    el.style.opacity = (e * (a.off ? 0.6 : 1)).toFixed(3);
    // over the UI (a lift there cancels): a dashed, dimmer ring and no preview (the builder hides it)
    if (this._aimRing._off !== !!a.off) {
      this._aimRing._off = !!a.off;
      this._aimRing.style.borderStyle = a.off ? 'dashed' : 'solid';
      el.classList.toggle('hw-aim-off', !!a.off);
    }
    this._aimRing.style.transform = `translate(${(a.x + ox).toFixed(1)}px,${(a.y + oy).toFixed(1)}px)`;
    const vx = a.x - a.fx, vy = a.y - a.fy, d = Math.hypot(vx, vy);
    const len = d - AIM_TETHER_GAP - AIM_RING_R;
    if (len < AIM_TETHER_MIN) this._aimTether.style.display = 'none';
    else {
      const ux = vx / d, uy = vy / d;
      const sx = a.fx + ux * AIM_TETHER_GAP + ox, sy = a.fy + uy * AIM_TETHER_GAP + oy;
      const ang = Math.atan2(-ux, uy);
      this._aimTether.style.display = 'block';
      this._aimTether.style.transform = `translate(${sx.toFixed(1)}px,${sy.toFixed(1)}px) rotate(${ang.toFixed(4)}rad) translateX(-1px) scaleY(${len.toFixed(1)})`;
    }
  }

  /** The aim is over (lifted, cancelled, or a second finger came down): forget it and hide the ring. */
  _endAim() {
    this.aim = null;
    if (this._aimEl) this._aimEl.style.display = 'none';
  }

  _initMulti() {
    const [a, b] = [...this.pointers.values()];
    const m = this.multi;
    m.dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    m.angle = Math.atan2(b.y - a.y, b.x - a.x);
    m.mx = (a.x + b.x) / 2; m.my = (a.y + b.y) / 2;
    m.hasPivot = !!this._pivotAt(m.mx, m.my, m.pivot);
    // twisting turns the house about its middle (not about the wall face under the fingers)
    let t = null;
    try { t = this.orbitPoint?.(m.mx, m.my) || null; } catch { t = null; }
    if (t) m.turn.copy(t); else if (m.hasPivot) m.turn.copy(m.pivot);
    m.hasTurn = !!(t || m.hasPivot);
  }

  _move(e) {
    const ptr = this.pointers.get(e.pointerId);
    const pos = this._local(e);
    if (!ptr) {
      if (e.pointerType === 'mouse' && this.pointers.size === 0 && e.target === this.dom) this.onHover?.(pos.x, pos.y);
      return;
    }
    const dx = pos.x - ptr.x, dy = pos.y - ptr.y;
    ptr.x = pos.x; ptr.y = pos.y;
    if (!this.enabled) return;

    if (this.mode === 'pending') {
      const moved = Math.hypot(pos.x - ptr.sx, pos.y - ptr.sy);
      const lim = ptr.type === 'mouse' ? TAP_MOVE_MOUSE : TAP_MOVE_TOUCH;
      if (moved > lim) {
        clearTimeout(this._aimTimer);
        if (this.drawMode && (ptr.type !== 'mouse' || ptr.button === 0)) {
          this.mode = 'draw';
          this._drawT = performance.now();
          this.onDrawStart?.(ptr.sx, ptr.sy);
          this.onDrawMove?.(pos.x, pos.y);
        } else {
          this.mode = 'orbit';
          this.onGestureStart?.();
          this._reanchor();
        }
      } else if (ptr.type === 'mouse') {
        this.onHover?.(pos.x, pos.y);
      }
      return;
    }
    if (this.mode === 'orbit') {
      this.goal.theta -= dx * 0.0075;
      this.goal.phi = clamp(this.goal.phi - dy * 0.0065, this.minPhi, this.maxPhi);
    } else if (this.mode === 'pan') {
      this._pan(dx, dy);
    } else if (this.mode === 'draw') {
      this.onDrawMove?.(pos.x, pos.y);
    } else if (this.mode === 'aim') {
      const a = this.aim;
      if (a) { a.fx = pos.x; a.fy = pos.y; this._placeAim(); a.off = this._aimOff(a); this._drawAim(); }
      this.onAimMove?.(a ? a.x : pos.x, a ? a.y : pos.y, !!a?.off);
    } else if (this.mode === 'multi' && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const m = this.multi;
      const piv = m.hasPivot ? m.pivot : null;
      // slide: keep the ground under the fingers under the fingers
      this._grab(m.mx, m.my, mx, my, piv ? piv.y : this.goal.target.y);
      // pinch: zoom about the point between the fingers
      this._zoomAbout(m.dist / dist, piv);
      // twist: turn the view around that point
      let da = angle - m.angle;
      if (da > Math.PI) da -= Math.PI * 2;
      if (da < -Math.PI) da += Math.PI * 2;
      this._turnAbout(-da, m.hasTurn ? m.turn : null);
      m.dist = dist; m.angle = angle; m.mx = mx; m.my = my;
    }
  }

  _up(e, cancelled = false) {
    const ptr = this.pointers.get(e.pointerId);
    if (!ptr) return;
    this.pointers.delete(e.pointerId);
    clearTimeout(this._aimTimer);
    const pos = this._local(e);
    if (this.mode === 'pending' && !cancelled) {
      if (ptr.type !== 'mouse' || ptr.button === 0) this.onTap?.(pos.x, pos.y, e);
      this.mode = 'idle';
    } else if (this.mode === 'pending' && cancelled) {
      this.onGestureStart?.();
      this.mode = 'idle';
    } else if (this.mode === 'aim') {
      // it places at the aim point as drawn right now (the lifted point, also mid-ease), not at the finger; lifting
      // with that point over the UI, or with the finger past the edge of the view, cancels (_aimOff)
      const a = this.aim;
      if (a) { a.fx = pos.x; a.fy = pos.y; this._placeAim(); }
      const off = cancelled || this._aimOff(a || { fx: pos.x, fy: pos.y, x: pos.x, y: pos.y });
      this._endAim();
      this.onAimEnd?.(a ? a.x : pos.x, a ? a.y : pos.y, off, e);
      this.mode = 'idle';
    } else if (this.mode === 'draw') {
      this.onDrawEnd?.(pos.x, pos.y);
      this.mode = 'idle';
    } else if (this.mode === 'multi') {
      // wait until all fingers lift before starting a new gesture
      this.mode = this.pointers.size ? 'wait' : 'idle';
    } else if (this.pointers.size === 0) {
      this.mode = 'idle';
    }
    if (this.pointers.size === 0) this.mode = 'idle';
    if (this.aim && this.mode !== 'aim') this._endAim();
  }

  // ---------------------------------------------------------------- camera moves

  /** Move the orbit pivot onto (the middle of) whatever is under the view centre without moving the camera. */
  _reanchor() {
    if (!this.orbitPoint) return;
    const w = this.dom.clientWidth, h = this.dom.clientHeight;
    let p = null;
    try { p = this.orbitPoint(w / 2 - this._ofx, h / 2 - this._ofs); } catch { p = null; }
    if (!p) return;
    _b.copy(p);
    const d = _b.distanceTo(this.camera.position);
    if (d < this.minRadius || d > this.maxRadius) return;
    if (Math.abs(_b.x) > this.bounds || Math.abs(_b.z) > this.bounds || _b.y < -1) return;
    // keep any motion still in flight (goal − current) on top of the new anchor
    _d.copy(this.goal.target).sub(this.target);
    const rr = this.goal.radius / (this.radius || 1);
    this.target.copy(_b);
    this.radius = d;
    this.goal.target.copy(_b).add(_d);
    this.goal.radius = clamp(d * rr, this.minRadius, this.maxRadius);
    this._apply();
  }

  /** Zoom by factor f (<1 = closer). With a pivot, the pivot stays put on screen. */
  _zoomAbout(f, pivot) {
    const g = this.goal;
    const r = clamp(g.radius * f, this.minRadius, this.maxRadius);
    const k = r / g.radius;
    if (pivot && k !== 1) {
      g.target.sub(pivot).multiplyScalar(k).add(pivot);
      this._clampTarget();
    }
    g.radius = r;
  }

  /** Turn the view by dTheta about a vertical axis through pivot (or the target). */
  _turnAbout(dTheta, pivot) {
    if (!dTheta) return;
    const g = this.goal;
    g.theta += dTheta;
    if (pivot) {
      const x = g.target.x - pivot.x, z = g.target.z - pivot.z;
      const c = Math.cos(dTheta), s = Math.sin(dTheta);
      g.target.x = pivot.x + x * c + z * s;
      g.target.z = pivot.z - x * s + z * c;
      this._clampTarget();
    }
  }

  /** Two-finger slide: move the target so the plane point under (x0,y0) ends up under (x1,y1). */
  _grab(x0, y0, x1, y1, planeY) {
    if (x0 === x1 && y0 === y1) return;
    const p0 = this._planeAt(x0, y0, planeY, _a);
    const p1 = p0 && this._planeAt(x1, y1, planeY, _b);
    if (!p0 || !p1) { this._pan(x1 - x0, y1 - y0); return; }
    _d.copy(p0).sub(p1);
    _d.y = 0;
    const max = this.goal.radius * 0.25;     // one event never jumps further than this
    if (_d.length() > max) _d.setLength(max);
    this.goal.target.add(_d);
    this._clampTarget();
  }

  _clampTarget() {
    const t = this.goal.target;
    t.x = clamp(t.x, -this.bounds, this.bounds);
    t.z = clamp(t.z, -this.bounds, this.bounds);
    t.y = clamp(t.y, 0, 30);
  }

  _pan(dx, dy) {
    const s = this.goal.radius * 0.0016;
    const sin = Math.sin(this.goal.theta), cos = Math.cos(this.goal.theta);
    // camera right (in XZ) and forward (toward target, in XZ)
    const rx = cos, rz = -sin;
    const fx = -sin, fz = -cos;
    const t = this.goal.target;
    t.x += (-dx * rx + dy * fx) * s;
    t.z += (-dx * rz + dy * fz) * s;
    t.x = clamp(t.x, -this.bounds, this.bounds);
    t.z = clamp(t.z, -this.bounds, this.bounds);
  }

  /** Smoothly move focus. */
  focus(x, y, z, radius = null) {
    this.goal.target.set(x, y, z);
    if (radius) this.goal.radius = clamp(radius, this.minRadius, this.maxRadius);
  }

  setTargetY(y) { this.goal.target.y = y; }

  rotateBy(dTheta) { this.goal.theta += dTheta; }
  zoomBy(f) { this.goal.radius = clamp(this.goal.radius * f, this.minRadius, this.maxRadius); }

  /** Tell the rig how much of the screen the UI covers (px from the top / bottom edge). Backward compatible: optional. */
  setInsets(top = 0, bottom = 0, left = 0, right = 0) {
    const I = this.insets;
    I.top = Math.max(0, +top || 0); I.bottom = Math.max(0, +bottom || 0);
    I.left = Math.max(0, +left || 0); I.right = Math.max(0, +right || 0);
  }

  /** Ease the projection offset toward the middle of the uncovered area (cheap: a few compares per frame). */
  _applyOffset(dt) {
    const w = this.dom.clientWidth, h = this.dom.clientHeight;
    if (!w || !h) return;
    const I = this.insets;
    const wy = clamp((I.bottom - I.top) / 2, -h * 0.25, h * 0.25);
    const wx = clamp((I.right - I.left) / 2, -w * 0.15, w * 0.15);
    let ny = wy, nx = wx;
    if (dt !== null) {
      const k = 1 - Math.exp(-dt * 8);
      if (Math.abs(wy - this._ofs) > 0.5) ny = this._ofs + (wy - this._ofs) * k;
      if (Math.abs(wx - this._ofx) > 0.5) nx = this._ofx + (wx - this._ofx) * k;
    }
    if (ny === this._ofs && nx === this._ofx && w === this._vw && h === this._vh && this.camera.aspect === this._asp) return;
    this._ofs = ny; this._ofx = nx; this._vw = w; this._vh = h; this._asp = this.camera.aspect;
    if (Math.abs(ny) < 0.5 && Math.abs(nx) < 0.5) { if (this.camera.view?.enabled) this.camera.clearViewOffset(); }
    else this.camera.setViewOffset(w, h, nx, ny, w, h);
  }

  /** True while a finger / button is down on the canvas. */
  get busy() { return this.pointers.size > 0; }

  /** Jump immediately (no smoothing). */
  snap() {
    this.target.copy(this.goal.target);
    this.theta = this.goal.theta; this.phi = this.goal.phi; this.radius = this.goal.radius;
    this._applyOffset(null);
    this._apply();
  }

  update(dt) {
    this._applyOffset(dt);
    this._easeAim(dt);
    const k = 1 - Math.exp(-dt * 10);
    this.target.lerp(this.goal.target, k);
    this.theta += (this.goal.theta - this.theta) * k;
    this.phi += (this.goal.phi - this.phi) * k;
    this.radius += (this.goal.radius - this.radius) * k;
    this._apply();
  }

  /** Ease the aim point up from the fingertip (k 0 → 1 over AIM_EASE_MS); tell the builder only when it moved. */
  _easeAim(dt) {
    const a = this.aim;
    if (!a) return;
    if (this.mode !== 'aim') { this._endAim(); return; }
    if (a.lift > 0 && !this.aimLift) a.lift = 0;      // the setting (or photo mode) turned off mid-aim: back to the finger
    else if (a.k >= 1) return;
    else a.k = Math.min(1, a.k + (Math.min(Math.max(dt, 0), AIM_EASE_DT) * 1000) / AIM_EASE_MS);
    const moved = this._placeAim();
    if (moved) a.off = this._aimOff(a);
    this._drawAim();
    if (moved) this.onAimMove?.(a.x, a.y, a.off);
  }

  _apply() {
    const sp = Math.sin(this.phi);
    this.camera.position.set(
      this.target.x + this.radius * sp * Math.sin(this.theta),
      this.target.y + this.radius * Math.cos(this.phi),
      this.target.z + this.radius * sp * Math.cos(this.theta),
    );
    if (this.camera.position.y < 0.6) this.camera.position.y = 0.6;
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
  }

  /** Serializable view for saves / photo presets. */
  getView() { const g = this.goal; return { t: [g.target.x, g.target.y, g.target.z], th: g.theta, ph: g.phi, r: g.radius }; }
  /** Apply a view ({t:[x,y,z], th, ph, r}); malformed / non-finite views are ignored, values clamped to the rig's limits. */
  setView(v, immediate = false) {
    if (!v || !Array.isArray(v.t) || v.t.length < 3) return;
    const ok = (n) => typeof n === 'number' && Number.isFinite(n);
    if (![v.t[0], v.t[1], v.t[2], v.th, v.ph, v.r].every(ok)) return;
    this.goal.target.set(v.t[0], v.t[1], v.t[2]);
    this._clampTarget();
    this.goal.theta = v.th;
    this.goal.phi = clamp(v.ph, this.minPhi, this.maxPhi);
    this.goal.radius = clamp(v.r, this.minRadius, this.maxRadius);
    if (immediate) this.snap();
  }
}
