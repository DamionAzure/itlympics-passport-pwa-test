const CACHE_NAME = 'itlympics-passport-v24';
const APP_SHELL = [
  './', './login.html', './index.html', './booth.html', './testing.html', './skills.html', './entrance.html', './vote.html', './dashboard.html',
  './shared.js', './shared.css',
  './vendor/jsQR.js', './vendor/qrcode.min.js', './vendor/supabase.js',
  './manifest.json', './icon-192.png', './icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Same-origin: cache-first, fall back to network, then update cache.
// Cross-origin (fonts, QR libs, Supabase client): try cache first for instant offline
// loads, but refresh the cache in the background whenever a network is available.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const isSameOrigin = new URL(req.url).origin === self.location.origin;

  if (isSameOrigin) {
    event.respondWith(
      // ignoreSearch: guarded pages redirect to login.html?next=…, which must
      // still resolve to the cached login.html when offline.
      caches.match(req, {ignoreSearch: true}).then((cached) => {
        const network = fetch(req).then((res) => {
          if (res && res.ok) caches.open(CACHE_NAME).then((c) => c.put(req, res.clone()));
          return res;
        }).catch(() => cached || new Response('Offline', {status: 503}));
        return cached || network;
      })
    );
  } else {
    event.respondWith(
      caches.match(req).then((cached) => {
        const network = fetch(req).then((res) => {
          caches.open(CACHE_NAME).then((c) => c.put(req, res.clone()));
          return res;
        }).catch(() => cached);
        return cached || network;
      })
    );
  }
});
