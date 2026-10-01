/*
 * BUD-SACCO service worker.
 *
 * It exists for two reasons and does nothing else:
 *
 *   1. A browser will not offer to install a site unless a service worker with
 *      a fetch handler is registered. Without this file the "Install app"
 *      prompt can never appear, however complete the manifest is.
 *   2. The app shell's own static files - the icons, the fonts the browser has
 *      already fetched - are worth serving from a cache on a 3G connection.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * It caches no page, no API response and no navigation. This application shows
 * one member's money, behind a session, under row-level security: a cached
 * response is a copy of somebody's balance sitting in a browser store, and it
 * could be served to the next person to sign in on a shared phone. So every
 * request that is not a GET for a file under /icons/ or /brand/ goes straight
 * to the network, exactly as it would with no worker at all. There is no
 * offline page for the same reason - a stale balance is worse than an error.
 */

const CACHE = 'bnd-static-v1';

/** Only the files that are the same for everyone, for ever. */
const STATIC_PREFIXES = ['/icons/', '/brand/'];

function isStatic(url) {
  return STATIC_PREFIXES.some((p) => url.pathname.startsWith(p));
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(['/icons/icon-192.png', '/icons/icon-512.png']))
      // A failed pre-cache must not stop the worker installing; the whole point
      // of registering it is installability, and the cache is a bonus.
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
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

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  // Another origin, or anything that is not one of our own static files: let the
  // browser do exactly what it would do without a service worker.
  if (url.origin !== self.location.origin || !isStatic(url)) return;

  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ??
        fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => undefined);
          }
          return response;
        }),
    ),
  );
});
