/*
 * KAVOX service worker: makes the site installable and quick to open.
 * - The app's files (/assets/*, named after their content) are kept once fetched: they never change.
 * - Pages are always fetched fresh; without a connection, the last page seen (or a short offline
 *   page) is shown instead.
 * - Nothing else is cached: the API, videos, files and the admin always go to the network.
 */
const VERSION = 'kavox-v1';
// The offline page (offline.html, served at /offline: the site drops the .html).
const OFFLINE = '/offline';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll([OFFLINE, '/assets/icons/icon-192.png', '/assets/kavox-logo.svg'])).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // A page: the network first; the last copy of the home page, then the offline page, without it.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok && url.pathname === '/') {
            const copy = response.clone();
            caches.open(VERSION).then((cache) => cache.put('/', copy));
          }
          return response;
        })
        .catch(async () => (url.pathname === '/' ? (await caches.match('/')) : null) || (await caches.match(OFFLINE))),
    );
    return;
  }

  // The app's own files: from the cache when there, else fetched and kept.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(VERSION).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
  }
  // Everything else (the API, videos, files): straight to the network.
});
