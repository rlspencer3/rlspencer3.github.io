#!/usr/bin/env node
// Dev tool: serve the game, open it in headless Chromium, run optional JS, screenshot,
// and print console errors.  Usage examples:
//   node tools/shot.mjs --query "showcase=walls" --out /tmp/walls.png
//   node tools/shot.mjs --query "bp=farmhouse&ui=0" --out /tmp/farm.png --w 1280 --h 800
//   node tools/shot.mjs --mobile --query "clean=1" --out /tmp/phone.png
//   node tools/shot.mjs --query "clean=1" --eval "__hw.world.add({t:'wall',x:0,y:0,z:0,a:'x'})" --out /tmp/a.png
//   node tools/shot.mjs --query "clean=1" --script my-test.js     (file evaluated in the page; may be async)
// Options: --query  --out  --w  --h  --mobile  --wait ms  --eval js  --script file  --cam th,ph,r,tx,ty,tz
// Exit code 1 if page errors were seen (unless --allow-errors).

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith('--')) {
    const next = arr[i + 1];
    acc.push([a.slice(2), next && !next.startsWith('--') ? next : true]);
  }
  return acc;
}, []));

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  let file = path.join(root, url === '/' ? 'index.html' : url);
  if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const url = `http://127.0.0.1:${port}/index.html${args.query ? '?' + args.query : ''}`;

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctxOpts = args.mobile
  ? { ...devices['iPhone 13'], deviceScaleFactor: 1 }
  : { viewport: { width: +(args.w || 1280), height: +(args.h || 800) }, deviceScaleFactor: 1 };
if (args.mobile && args.landscape) ctxOpts.viewport = { width: 844, height: 390 };
const context = await browser.newContext(ctxOpts);
const page = await context.newPage();
const problems = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') problems.push(`[console.${m.type()}] ${m.text()}`);
  else if (args.verbose) console.log(`[console.${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`));

await page.goto(url);
try {
  await page.waitForFunction(() => window.__hwReady === true, null, { timeout: +(args.timeout || 45000) });
} catch {
  problems.push('[timeout] game did not report ready');
}
if (args.cam) {
  await page.evaluate((c) => {
    const [th, ph, r, tx, ty, tz] = c.split(',').map(Number);
    window.__hw.rig.setView({ t: [tx, ty, tz], th, ph, r }, true);
  }, args.cam);
}
if (args.eval) {
  const out = await page.evaluate(async (code) => { const v = await eval(code); try { return JSON.stringify(v); } catch { return String(v); } }, args.eval);
  console.log('eval result:', out);
}
if (args.script) {
  const code = fs.readFileSync(args.script, 'utf8');
  const out = await page.evaluate(async (c) => { const fn = new Function('return (async () => {' + c + '\n})()'); const v = await fn(); try { return JSON.stringify(v); } catch { return String(v); } }, code);
  console.log('script result:', out);
}
await page.waitForTimeout(+(args.wait || 1200));
if (args.out) {
  await page.screenshot({ path: args.out });
  console.log('screenshot:', args.out);
}
const hwErrors = await page.evaluate(() => (window.__hw?.errors || []).map((e) => `[hw] ${e.where}: ${e.message}`)).catch(() => []);
problems.push(...hwErrors);
const stats = await page.evaluate(() => ({ pieces: window.__hw?.world?.count, fps: Math.round(window.__hw?.fps || 0), calls: window.__hw?.renderer?.info?.render?.calls, tris: window.__hw?.renderer?.info?.render?.triangles })).catch(() => ({}));
console.log('stats:', JSON.stringify(stats));
if (problems.length) {
  console.log('PROBLEMS:');
  for (const p of [...new Set(problems)]) console.log('  ' + p);
} else console.log('no console errors');
await browser.close();
server.close();
process.exit(problems.some((p) => !p.startsWith('[console.warning]')) && !args['allow-errors'] ? 1 : 0);
