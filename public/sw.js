/*
 * Offline support. The app is a handful of hashed static files, so:
 *  - navigations: network first (pick up new deploys), fall back to the cached shell
 *  - everything else (hashed JS/CSS, icons, fonts): cache first, filled as it's fetched
 * Bump VERSION to drop old caches.
 */
const VERSION = 'dusk-ops-v1';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'];

// Precache the shell plus every hashed asset index.html references, so the very
// first visit is enough for offline play (those assets loaded before this worker
// took control, so the fetch handler never saw them).
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION).then(async (c) => {
      await c.addAll(SHELL);
      const html = await (await fetch('./index.html', { cache: 'no-store' })).text();
      const assets = [...html.matchAll(/(?:src|href)="(\.\/assets\/[^"]+)"/g)].map((m) => m[1]);
      const preloads = [...html.matchAll(/href="(\.\/assets\/[^"]+\.js)"/g)].map((m) => m[1]);
      await c.addAll([...new Set([...assets, ...preloads])]);
    }).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const fonts = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (!sameOrigin && !fonts) return;

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html')),
    );
    return;
  }

  e.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok || res.type === 'opaque') {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
