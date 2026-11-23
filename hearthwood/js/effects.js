// Small juicy effects: pop-in scale animation, dust puffs, sparkles.
// Call effects.update(dt) once per frame.

import * as THREE from 'three';

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.tweens = [];
    this.particles = [];
    this.pool = [];
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(32, 32, 2, 32, 32, 30);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.5, 'rgba(255,255,255,0.55)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    this.puffTex = new THREE.CanvasTexture(c);
    this.puffTex.colorSpace = THREE.SRGBColorSpace;
  }

  /** Bouncy scale-in for a freshly placed object. */
  popIn(obj, duration = 0.38) {
    obj.scale.setScalar(0.001);
    this.tweens.push({ obj, t: 0, d: duration, kind: 'pop' });
  }

  /** Shrink-out then call done(). */
  popOut(obj, done, duration = 0.18) {
    this.tweens.push({ obj, t: 0, d: duration, kind: 'out', done });
  }

  /** Soft dust puff at a world position. */
  puff(pos, color = 0xf3ead8, count = 10, spread = 0.9) {
    for (let i = 0; i < count; i++) {
      const s = this.pool.pop() || new THREE.Sprite(new THREE.SpriteMaterial({ map: this.puffTex, transparent: true, depthWrite: false }));
      s.material.color.set(color);
      s.material.opacity = 0.8;
      s.position.copy(pos);
      const a = Math.random() * Math.PI * 2;
      const sp = spread * (0.5 + Math.random() * 0.8);
      s.userData.v = new THREE.Vector3(Math.cos(a) * sp, 0.6 + Math.random() * 0.9, Math.sin(a) * sp);
      s.userData.life = 0;
      s.userData.max = 0.55 + Math.random() * 0.35;
      s.userData.size = 0.35 + Math.random() * 0.35;
      s.scale.setScalar(s.userData.size);
      this.scene.add(s);
      this.particles.push(s);
    }
  }

  /** Little upward sparkles (e.g. blueprint piece completed). */
  sparkle(pos, color = 0xffe7a3, count = 14) {
    this.puff(pos, color, count, 1.4);
  }

  update(dt) {
    for (let i = this.tweens.length - 1; i >= 0; i--) {
      const tw = this.tweens[i];
      tw.t += dt;
      const k = Math.min(1, tw.t / tw.d);
      if (tw.kind === 'pop') {
        // easeOutBack
        const c1 = 1.9, c3 = c1 + 1;
        const e = 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2);
        tw.obj.scale.setScalar(Math.max(0.001, e));
      } else if (tw.kind === 'out') {
        tw.obj.scale.setScalar(Math.max(0.001, 1 - k));
      }
      if (k >= 1) {
        if (tw.kind === 'pop') tw.obj.scale.setScalar(1);
        this.tweens.splice(i, 1);
        tw.done?.();
      }
    }
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const s = this.particles[i];
      const u = s.userData;
      u.life += dt;
      const k = u.life / u.max;
      if (k >= 1) {
        this.scene.remove(s);
        this.particles.splice(i, 1);
        this.pool.push(s);
        continue;
      }
      s.position.addScaledVector(u.v, dt);
      u.v.multiplyScalar(1 - dt * 2.5);
      s.scale.setScalar(u.size * (1 + k * 1.2));
      s.material.opacity = 0.8 * (1 - k);
    }
  }
}
