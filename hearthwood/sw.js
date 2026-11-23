// Hearthwood service worker: network-first with offline cache fallback.
// Online players always get the latest files; after one visit the game also works offline.
// Paths are relative to this file, so the game works from any subpath (e.g. GitHub Pages /hearthwood/).
//
// Bump VERSION whenever the file list changes (old caches are deleted on activate). Contents need no
// bump: every successful network response refreshes its cached copy.
const VERSION = 3;
const CACHE = `hearthwood-v${VERSION}`;
const NET_TIMEOUT_MS = 6000;     // a stalled mobile connection falls back to the cached copy after this
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

self.addEventListener('install', (e) => {
  // 'reload' skips the HTTP cache so the precache never captures a stale file
  e.waitUntil(caches.open(CACHE)
    .then((c) => Promise.allSettled(CORE.map((u) => c.add(new Request(u, { cache: 'reload' })))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('hearthwood-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

/** Cache key: navigations to the game page (any ?query) share one entry, the game's index. */
function cacheKey(req) {
  if (req.mode === 'navigate') {
    const u = new URL(req.url);
    if (u.href.split(/[?#]/)[0] === SCOPE || u.href.split(/[?#]/)[0] === INDEX) return INDEX;
  }
  return req;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !url.href.startsWith(SCOPE)) return;
  const key = cacheKey(req);
  const nav = req.mode === 'navigate';
  const cached = () => caches.match(key, { ignoreSearch: nav })
    .then((hit) => hit || (nav ? caches.match(INDEX) : undefined))
    .catch(() => undefined);
  const net = fetch(req);
  // refresh the cached copy (registered before the page reads the body, so the clone is taken first)
  e.waitUntil(net.then((res) => {
    if (res.status !== 200 || res.type !== 'basic') return undefined;
    const copy = res.clone();
    return caches.open(CACHE).then((c) => c.put(key, copy));
  }).catch(() => {}));
  e.respondWith(new Promise((resolve) => {
    let settled = false;
    const done = (res) => { if (!settled) { settled = true; resolve(res); } };
    // network first; a stalled connection falls back to the cached copy (when there is one) after
    // NET_TIMEOUT_MS, but a first visit keeps waiting for the network however slow it is
    const timer = setTimeout(() => { cached().then((hit) => { if (hit) done(hit); }); }, NET_TIMEOUT_MS);
    net.then((res) => { clearTimeout(timer); done(res); }, () => {
      clearTimeout(timer);
      cached().then((hit) => done(hit || Response.error()));
    });
  }));
});
