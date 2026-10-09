// Service worker for UrbanoFlashCar. Makes the app installable and usable
// offline for the shell. Strategy:
//   - API requests (/api/...) always go to the network, never cached, so auth
//     and ride data are never stale or served to the wrong session.
//   - Static shell (HTML/CSS/JS/icons/manifest) is cached; served cache-first
//     with a network update, and a navigation falls back to the cached shell
//     when offline.

// The version is injected by the server (see the /sw.js route) so the worker's
// bytes — and the cache name — change on every release. That guarantees the
// installed PWA re-fetches the whole shell and updates with the platform. When
// the file is served statically without substitution, it falls back to 'dev'.
const APP_VERSION = '__APP_VERSION__'.includes('APP_VERSION') ? 'dev' : '__APP_VERSION__';
const CACHE = `ufc-shell-${APP_VERSION}`;
const SHELL = [
  '/',
  '/index.html',
  '/app.js',
  '/styles.css',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/maskable-512.png',
  '/icons/apple-touch-icon.png',
  '/icons/favicon-32.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never cache the API: always hit the network.
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(request));
    return;
  }

  // Navigations: try the network, fall back to the cached shell when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/index.html').then((r) => r || caches.match('/'))),
    );
    return;
  }

  // Other static assets: cache-first, refreshing the cache in the background.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
