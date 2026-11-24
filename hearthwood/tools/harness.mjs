#!/usr/bin/env node
// Hearthwood test harness (side-effect free: importing it starts nothing and never exits). Carved unchanged out of
// tools/batch-regress.mjs (docs/LIVING.md §12.6, §13.1) so other Node runners (tools/town-regress.mjs) can share it:
//   import { ROOT, startServer, launch, openGame, saveDataURL, helpers, helpers2, injectHelpers } from './harness.mjs';
//   startServer()            static server for the game at ROOT → { server, base } (base = …/index.html)
//   launch()                 headless Chromium with SwiftShader WebGL
//   openGame(browser, base, query, { mobile, w, h })  new context + page, waits for window.__hwReady
//                            → { ctx, page, problems } (problems: console errors / warnings and page errors)
//   saveDataURL(file, url)   write a data: URL (e.g. app.snapshot()) to a file
//   helpers, helpers2        page scripts defining window.__t (settle, toScreen, pixels, cmpOnOff, invariants, …)
//   injectHelpers(page)      adds both to a page
// HW_ROOT points the server at a game checkout somewhere else.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(process.env.HW_ROOT || path.join(HERE, '..'));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
export async function startServer() {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    let file = path.join(ROOT, url === '/' ? 'index.html' : url);
    if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end('nf'); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(data);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, base: `http://127.0.0.1:${server.address().port}/index.html` };
}
export async function launch() {
  return chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
}
export async function openGame(browser, base, query, { mobile = false, w = 1280, h = 800 } = {}) {
  const ctx = await browser.newContext(mobile ? { ...devices['iPhone 13'], deviceScaleFactor: 1 } : { viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const problems = [];
  page.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !/GPU stall|ReadPixels/.test(m.text())) problems.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`));
  await page.goto(`${base}?${query}`);
  await page.waitForFunction(() => window.__hwReady === true, null, { timeout: 60000 });
  return { ctx, page, problems };
}
export function saveDataURL(file, url) { fs.writeFileSync(file, Buffer.from(url.split(',')[1], 'base64')); }

export const helpers = "// Helpers injected into the page (window.__t).\nwindow.__t = {\n  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),\n  async settle(maxMs = 15000) {\n    const hw = __hw, b = hw.world.batcher, t0 = performance.now();\n    await this.sleep(150);\n    while (performance.now() - t0 < maxMs) {\n      if (!hw.effects.tweens.length && !b.dirty.size && !b.job && !b.pending.size) { await this.sleep(60); if (!b.dirty.size && !b.job && !b.pending.size) return performance.now() - t0; }\n      await this.sleep(80);\n    }\n    return -1;\n  },\n  toScreen(v) {\n    const hw = __hw, el = hw.renderer.domElement;\n    const p = v.clone().project(hw.camera);\n    return { x: (p.x + 1) / 2 * el.clientWidth, y: (1 - p.y) / 2 * el.clientHeight, inside: Math.abs(p.x) < 0.95 && Math.abs(p.y) < 0.95 && p.z < 1 };\n  },\n  render() { const hw = __hw, R = hw.renderer; R.shadowMap.needsUpdate = true; R.render(hw.scene, hw.camera); return R.info.render.calls; },\n  pixels() {\n    const hw = __hw, R = hw.renderer; this.render();\n    const src = R.domElement, W = src.width, H = src.height;\n    const c = this._c || (this._c = document.createElement('canvas'));\n    c.width = W; c.height = H;\n    const g = c.getContext('2d', { willReadFrequently: true });\n    g.drawImage(src, 0, 0);\n    return g.getImageData(0, 0, W, H).data;\n  },\n  /** Same frame with batching on vs off: fraction of differing pixels. */\n  cmpOnOff() {\n    const hw = __hw, b = hw.world.batcher;\n    hw.builder.hideGhost();\n    const a = this.pixels(), callsOn = hw.renderer.info.render.calls;\n    b.setEnabled(false);\n    const o = this.pixels(), callsOff = hw.renderer.info.render.calls;\n    b.setEnabled(true); b.bakeNow();\n    let n = 0, n32 = 0;\n    for (let i = 0; i < a.length; i += 4) {\n      const d = Math.max(Math.abs(a[i] - o[i]), Math.abs(a[i + 1] - o[i + 1]), Math.abs(a[i + 2] - o[i + 2]));\n      if (d > 0) n++; if (d > 32) n32++;\n    }\n    const N = a.length / 4;\n    return { pct: +(100 * n / N).toFixed(3), pct32: +(100 * n32 / N).toFixed(4), callsOn, callsOff };\n  },\n  /** Region pixel sum around a screen point (CSS px), for \"did it change?\" checks. */\n  region(x, y, r = 6) {\n    const hw = __hw, R = hw.renderer; const d = this.pixels(); const W = R.domElement.width, H = R.domElement.height;\n    const s = R.getPixelRatio(); const cx = Math.round(x * s), cy = Math.round(y * s);\n    let sum = 0; for (let yy = cy - r; yy <= cy + r; yy++) for (let xx = cx - r; xx <= cx + r; xx++) { const i = (yy * W + xx) * 4; sum += d[i] + d[i + 1] + d[i + 2]; }\n    return sum;\n  },\n  /** A plain wall on level `lv` whose centre is on screen and picks as itself. */\n  findWall(lv = 0, ids = ['wall']) {\n    const hw = __hw, THREE = hw.THREE;\n    for (const e of hw.world.entries.values()) {\n      if (e.def.layer !== 'W' || e.p.y !== lv || !ids.includes(e.def.id)) continue;\n      const c = e.obj.position.clone(); c.y += 1.25;\n      const s = this.toScreen(c);\n      if (!s.inside) continue;\n      const pk = hw.builder.pickPiece(s.x, s.y);\n      if (pk && pk.entry === e) return { key: e.key, x: s.x, y: s.y };\n    }\n    return null;\n  },\n  bakedState(entry) {\n    const b = __hw.world.batcher;\n    return { baked: b.isBaked(entry), units: b.unitsOf(entry).map((u) => ({ k: u.kind, baked: u.baked, dirty: u.dirty })) };\n  },\n};\n";
// More helpers (window.__t): batcher invariants and same-frame batched / unbatched comparisons that don't force a
// rebake, for checks in the middle of a blueprint cascade.
export const helpers2 = String.raw`Object.assign(window.__t, {
  /** Per-mesh batching invariants right now. */
  invariants() {
    const hw = __hw, b = hw.world.batcher, anim = new Set(hw.effects.tweens.map((t) => t.obj));
    const unitOf = new Map();
    for (const u of b.units.values()) {
      if (u.kind !== 'r') continue;
      for (const obj of u.objs) {
        const rec = b.recs.get(obj);
        for (let i = 0; rec && i < rec.length; i += 2) if (rec[i] === u) { const parts = rec[i + 1]; for (let j = 0; j < parts.length; j += 3) unitOf.set(parts[j], u); }
      }
    }
    const o = { doubleDraw: 0, lost: 0, unsettledBaked: 0, shadowless: 0, bakedEntries: 0 };
    for (const e of hw.world.entries.values()) {
      const s = e.obj.scale, still = s.x === 1 && s.y === 1 && s.z === 1 && e.obj.children[0]?.visible !== false && !anim.has(e.obj);
      let any = false;
      e.obj.traverse((m) => {
        if (!m.isMesh) return;
        const onBaked = m.layers.mask === 2, u = unitOf.get(m);
        if (onBaked && !u) o.lost++;                 // hidden from the camera but in no batch
        if (!onBaked && u) o.doubleDraw++;           // drawn by a batch and on its own
        if (onBaked) { any = true; if (!still) o.unsettledBaked++; if (u && u.mode === 'p' && !b.inProxy.has(m)) o.shadowless++; }
      });
      if (any) o.bakedEntries++;
    }
    return o;
  },
  /** The current frame with batching on vs off, without forcing a rebake afterwards (units rebake as usual). */
  cmpLive() {
    const hw = __hw, b = hw.world.batcher;
    hw.builder.hideGhost();
    const a = this.pixels(); b.setEnabled(false); const o = this.pixels(); b.setEnabled(true);
    let n = 0, n32 = 0;
    for (let i = 0; i < a.length; i += 4) {
      const d = Math.max(Math.abs(a[i] - o[i]), Math.abs(a[i + 1] - o[i + 1]), Math.abs(a[i + 2] - o[i + 2]));
      if (d > 0) n++; if (d > 32) n32++;
    }
    const N = a.length / 4;
    return { pct: +(100 * n / N).toFixed(3), pct32: +(100 * n32 / N).toFixed(4) };
  },
  /** pickPiece on a screen grid with batching on vs off (same frame): number of grid points that differ. */
  pickDiff() {
    const hw = __hw, b = hw.world.batcher, el = hw.renderer.domElement, W = el.clientWidth, H = el.clientHeight;
    const pts = []; for (let i = 1; i < 16; i++) for (let j = 1; j < 10; j++) pts.push([W * i / 16, H * j / 10]);
    const run = () => pts.map(([x, y]) => { const p = hw.builder.pickPiece(x, y); return p ? p.entry.key : null; });
    const a = run(); b.setEnabled(false); const o = run(); b.setEnabled(true);
    let diff = 0, hits = 0; for (let i = 0; i < a.length; i++) { if (a[i] !== o[i]) diff++; if (a[i]) hits++; }
    return { diff, hits, n: pts.length };
  },
});`;

/** Add both helper scripts (window.__t) to an open game page. */
export async function injectHelpers(page) {
  await page.addScriptTag({ content: helpers });
  await page.addScriptTag({ content: helpers2 });
}
