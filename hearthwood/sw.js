// Hearthwood service worker: network-first with offline cache fallback.
// Online players always get the latest files; after one visit the game also works offline.
const CACHE = 'hearthwood-v1';
const CORE = [
  './', './index.html', './css/style.css', './css/ui.css', './manifest.webmanifest', './icons/icon.svg', './icons/icon-192.png',
  './js/main.js', './js/config.js', './js/state.js', './js/catalog.js', './js/geom.js', './js/materials.js', './js/world.js',
  './js/camera.js', './js/builder.js', './js/effects.js', './js/storage.js', './js/thumbs.js',
  './js/env.js', './js/audio.js', './js/ui.js', './js/blueprints.js',
  './js/pieces/floors.js', './js/pieces/walls.js', './js/pieces/roof.js', './js/pieces/decor.js',
  './js/vendor/three.module.min.js', './js/vendor/addons/BufferGeometryUtils.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.allSettled(CORE.map((u) => c.add(u)))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('./index.html'))),
  );
});
