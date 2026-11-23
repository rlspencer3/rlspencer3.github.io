// Orbit camera rig with mobile-first gestures.
//   Touch:  1 finger drag = orbit (or draw in draw mode) · tap = action
//           2 fingers = pinch zoom + pan + twist to rotate
//   Mouse:  left drag = orbit (or draw) · right/middle drag or shift+drag = pan · wheel = zoom · click = action
// Emits callbacks: onTap(x, y), onHover(x, y), onDrawStart/Move/End(x, y), onGestureStart().

import * as THREE from 'three';
import { clamp } from './config.js';

const TAP_MOVE_TOUCH = 10;
const TAP_MOVE_MOUSE = 5;
const TAP_TIME = 450;

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
    this.targetY = 1;

    this.onTap = null; this.onHover = null;
    this.onDrawStart = null; this.onDrawMove = null; this.onDrawEnd = null;
    this.onGestureStart = null;

    this.pointers = new Map();
    this.mode = 'idle'; // idle | pending | orbit | pan | draw | multi | wait
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
      this.goal.radius = clamp(this.goal.radius * f, this.minRadius, this.maxRadius);
    }, { passive: false });
    d.addEventListener('contextmenu', (e) => e.preventDefault());
    d.addEventListener('pointerleave', () => { if (this.onHover && this.mode === 'idle') this.onHover(null, null); });
  }

  _local(e) {
    const r = this.dom.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  _down(e) {
    if (!this.enabled) return;
    this.dom.setPointerCapture?.(e.pointerId);
    const pos = this._local(e);
    this.pointers.set(e.pointerId, { ...pos, sx: pos.x, sy: pos.y, t: performance.now(), type: e.pointerType, button: e.button, shift: e.shiftKey });
    if (this.pointers.size === 1) {
      if (e.pointerType === 'mouse' && (e.button === 1 || e.button === 2 || e.shiftKey)) this.mode = 'pan';
      else this.mode = 'pending';
    } else if (this.pointers.size === 2) {
      if (this.mode === 'draw') this.onDrawEnd?.(pos.x, pos.y);
      this.mode = 'multi';
      this._initMulti();
      this.onGestureStart?.();
    }
  }

  _initMulti() {
    const [a, b] = [...this.pointers.values()];
    this.multi = {
      dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      angle: Math.atan2(b.y - a.y, b.x - a.x),
      mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2,
    };
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
        if (this.drawMode && (ptr.type !== 'mouse' || ptr.button === 0)) {
          this.mode = 'draw';
          this.onDrawStart?.(ptr.sx, ptr.sy);
          this.onDrawMove?.(pos.x, pos.y);
        } else {
          this.mode = 'orbit';
          this.onGestureStart?.();
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
    } else if (this.mode === 'multi' && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const m = this.multi;
      this.goal.radius = clamp(this.goal.radius * (m.dist / dist), this.minRadius, this.maxRadius);
      let da = angle - m.angle;
      if (da > Math.PI) da -= Math.PI * 2;
      if (da < -Math.PI) da += Math.PI * 2;
      this.goal.theta -= da;
      this._pan(mx - m.mx, my - m.my);
      // vertical two-finger slide also tilts a little when fingers move together
      m.dist = dist; m.angle = angle; m.mx = mx; m.my = my;
    }
  }

  _up(e, cancelled = false) {
    const ptr = this.pointers.get(e.pointerId);
    if (!ptr) return;
    this.pointers.delete(e.pointerId);
    const pos = this._local(e);
    if (this.mode === 'pending' && !cancelled) {
      const dt = performance.now() - ptr.t;
      if (dt < TAP_TIME && (ptr.type !== 'mouse' || ptr.button === 0)) this.onTap?.(pos.x, pos.y, e);
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

  /** Jump immediately (no smoothing). */
  snap() {
    this.target.copy(this.goal.target);
    this.theta = this.goal.theta; this.phi = this.goal.phi; this.radius = this.goal.radius;
    this._apply();
  }

  update(dt) {
    const k = 1 - Math.exp(-dt * 10);
    this.target.lerp(this.goal.target, k);
    this.theta += (this.goal.theta - this.theta) * k;
    this.phi += (this.goal.phi - this.phi) * k;
    this.radius += (this.goal.radius - this.radius) * k;
    this._apply();
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
  }

  /** Serializable view for saves / photo presets. */
  getView() { const g = this.goal; return { t: [g.target.x, g.target.y, g.target.z], th: g.theta, ph: g.phi, r: g.radius }; }
  setView(v, immediate = false) {
    if (!v) return;
    this.goal.target.set(...v.t); this.goal.theta = v.th; this.goal.phi = v.ph; this.goal.radius = v.r;
    if (immediate) this.snap();
  }
}
