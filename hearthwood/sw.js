// Hearthwood service worker: offline play and install-to-home-screen.
// Paths are relative to this file, so the game works from any subpath (e.g. GitHub Pages /hearthwood/).
//
// The game is ~30 ES modules that must all come from the SAME version: a page that mixes old and new modules
// can fail to start (a missing export is a link error). So:
// * Each page load uses ONE source, chosen when the page itself is requested:
//   - online (the page arrived from the network within NET_TIMEOUT_MS): every file of that load comes from the
//     network, revalidated with the server (cache: 'no-cache', so a stale HTTP-cache copy can't sneak in);
//     a file falls back to the offline copy only if the network fails outright;
//   - offline or stalled (no network, or no answer in time): every file comes from the offline copy.
// * The offline copy is always one complete set (CORE). It is written whole at install (an install that can't
//   fetch every file fails, and the previous worker and its copy stay), and refreshed whole a few seconds after
//   the network answers a page load: every CORE file is fetched first and only stored if all of them arrived,
//   so a dropped connection never leaves half-old, half-new modules behind.
//
// Bump VERSION when the CORE list changes (old caches are deleted on activate). File contents need no bump:
// online loads always get the server's files and the offline copy refreshes itself after them.
// CORE must list every file the game requests (index.html, css, every js module incl. js/pieces and the
// vendored three.js + addons, the manifest and its icons) and nothing that doesn't exist.
const VERSION = 4;
const CACHE = `hearthwood-v${VERSION}`;
const NET_TIMEOUT_MS = 6000;       // the page itself: a stalled connection plays from the offline copy after this
const REFRESH_DELAY_MS = 4000;     // let the page finish loading before refreshing the offline copy
const REFRESH_EVERY_MS = 60000;    // at most one refresh a minute
const CORE = [
  './index.html', './css/style.css', './css/ui.css', './manifest.webmanifest',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png',
  './js/main.js', './js/config.js', './js/state.js', './js/catalog.js', './js/geom.js', './js/materials.js',
  './js/world.js', './js/batcher.js', './js/camera.js', './js/builder.js', './js/effects.js', './js/storage.js',
  './js/thumbs.js', './js/env.js', './js/audio.js', './js/ui.js', './js/blueprints.js',
  './js/pieces/floors.js', './js/pieces/walls.js', './js/pieces/roof.js', './js/pieces/decor.js',
  './js/vendor/three.module.min.js', './js/vendor/addons/BufferGeometryUtils.js',
];
const SCOPE = new URL('./', self.location).href;
const INDEX = new URL('./index.html', self.location).href;
const URLS = CORE.map((u) => new URL(u, self.location).href);
const MATCH = { ignoreVary: true };

self.addEventListener('install', (e) => {
  // all or nothing; 'no-cache' revalidates with the server, so the copy never captures a stale HTTP-cache file
  e.waitUntil(caches.open(CACHE)
    .then((c) => c.addAll(URLS.map((u) => new Request(u, { cache: 'no-cache' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('hearthwood-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// ------------------------------------------------------------------ which source each page load uses

const modes = new Map();       // client id -> 'net' | 'cache'
let lastNav = null;            // { mode, t }: for browsers that don't report a navigation's resultingClientId
function remember(id, mode) {
  if (!id) return;
  modes.delete(id);
  modes.set(id, mode);
  if (modes.size > 40) modes.delete(modes.keys().next().value);
}
function modeOf(id) {
  let m = id ? modes.get(id) : undefined;
  if (!m && lastNav && Date.now() - lastNav.t < 30000) { m = lastNav.mode; remember(id, m); }
  return m;
}

const fromCache = (req) => caches.open(CACHE).then((c) => c.match(req, MATCH)).catch(() => undefined);
const revalidated = (req) => { try { return new Request(req, { cache: 'no-cache' }); } catch { return req; } };
const delay = (ms) => new Promise((ok) => setTimeout(ok, ms));
/**
 * What the page gets is marked no-cache: otherwise the browser's own memory / HTTP cache may reuse a module for
 * up to the server's max-age (10 min on GitHub Pages) on a reload without asking this worker, which is how a
 * reload right after an update could run old and new modules side by side.
 */
function forPage(res) {
  if (!res || res.type !== 'basic') return res;
  const headers = new Headers(res.headers);
  headers.set('Cache-Control', 'no-cache');
  const empty = res.status === 204 || res.status === 304;
  return new Response(empty ? null : res.body, { status: res.status, statusText: res.statusText, headers });
}

// ------------------------------------------------------------------ keeping the offline copy whole

let refreshing = null, refreshedAt = 0;
/** Fetch every CORE file; store the ones that changed, but only once all of them have arrived. */
function refresh() {
  if (refreshing) return refreshing;
  if (Date.now() - refreshedAt < REFRESH_EVERY_MS) return Promise.resolve();
  refreshing = (async () => {
    const fresh = await Promise.all(URLS.map(async (u) => {
      const res = await fetch(new Request(u, { cache: 'no-cache' }));
      if (!res.ok || res.type !== 'basic' || res.redirected) throw new Error(`${u}: ${res.status}`);
      return res;
    }));
    const cache = await caches.open(CACHE);
    const old = await Promise.all(URLS.map((u) => cache.match(u, MATCH)));
    const same = (a, b) => {
      if (!a) return false;
      const tag = (r) => r.headers.get('etag') || r.headers.get('last-modified');
      return !!tag(b) && tag(a) === tag(b) && a.headers.get('content-length') === b.headers.get('content-length');
    };
    await Promise.all(fresh.map((res, i) => (same(old[i], res) ? undefined : cache.put(URLS[i], res))));
    refreshedAt = Date.now();
  })().catch(() => { /* offline again, or a file is missing: keep the copy we have */ })
    .finally(() => { refreshing = null; });
  return refreshing;
}

// ------------------------------------------------------------------ requests

/** The game page (any ?query): the network if it answers in time, else the offline copy. */
function openGame(e) {
  const id = e.resultingClientId;
  const net = fetch(new Request(e.request.url, { cache: 'no-cache', credentials: 'same-origin' }));
  // the network answered (even late): refresh the offline copy once the page has loaded
  e.waitUntil(net.then((res) => (res.ok ? delay(REFRESH_DELAY_MS).then(refresh) : undefined), () => {}));
  return new Promise((resolve) => {
    let done = false;
    const finish = (res, mode) => {
      if (done) return;
      done = true;
      remember(id, mode);
      lastNav = { mode, t: Date.now() };
      resolve(forPage(res));
    };
    const offline = () => fromCache(INDEX).then((hit) => { if (hit) finish(hit, 'cache'); return !!hit; });
    // a first visit has no copy yet: it keeps waiting for the network however slow it is
    const timer = setTimeout(offline, NET_TIMEOUT_MS);
    net.then((res) => {
      clearTimeout(timer);
      if (res.ok) finish(res.redirected ? Response.redirect(res.url, 302) : res, 'net');
      else offline().then((had) => { if (!had) finish(res, 'net'); });   // a server error: play offline if we can
    }, () => {
      clearTimeout(timer);
      offline().then((had) => { if (!had) finish(Response.error(), 'cache'); });
    });
  });
}

/** Any other file of the game. */
function asset(e) {
  return pickAsset(e).then(forPage);
}
function pickAsset(e) {
  const req = e.request;
  const mode = modeOf(e.clientId);
  if (mode === 'cache') return fromCache(req).then((hit) => hit || fetch(req));
  const net = fetch(revalidated(req));
  if (mode === 'net') return net.catch(() => fromCache(req).then((hit) => hit || Response.error()));
  // no known page (the browser fetching the manifest / icons, or a page opened before this worker ran):
  // the network, with the offline copy after NET_TIMEOUT_MS or when it fails
  return new Promise((resolve) => {
    let done = false;
    const finish = (res) => { if (!done && res) { done = true; resolve(res); } };
    const timer = setTimeout(() => fromCache(req).then(finish), NET_TIMEOUT_MS);
    net.then((res) => { clearTimeout(timer); finish(res); },
      () => { clearTimeout(timer); fromCache(req).then((hit) => finish(hit || Response.error())); });
  });
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  const url = req.url.split('#')[0];
  if (!url.startsWith(SCOPE)) return;                  // other origins and other folders: not ours
  if (req.mode === 'navigate') {
    const path = url.split('?')[0];
    if (path === SCOPE || path === INDEX) e.respondWith(openGame(e));
    return;                                            // other pages in the folder (docs…): left to the browser
  }
  e.respondWith(asset(e));
});
