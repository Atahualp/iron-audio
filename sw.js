// Iron Audio service worker — V18.3.0
// App shell: network-first so a fresh deploy is picked up immediately.
// Exercise GIFs: cache-first in a separate bucket that survives version bumps
// (gym wifi is unreliable; a cached GIF beats a spinner every time).
const VERSION = 'v18-3-0';
const CACHE = 'iron-audio-' + VERSION;
const GIF_CACHE = 'iron-audio-gifs'; // intentionally unversioned — persists across deploys

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./'])).catch(() => {}));
  // NOTE: no skipWaiting() here — the page decides when to activate, so an
  // update can never yank the app out from under a workout in progress.
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE && k !== GIF_CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// Page → SW commands: activate a waiting worker, or warm the GIF cache.
self.addEventListener('message', (e) => {
  const data = e.data || {};
  if (data.type === 'SKIP_WAITING') self.skipWaiting();
  if (data.type === 'PRECACHE_GIFS' && Array.isArray(data.urls)) {
    e.waitUntil(precacheGifs(data.urls, e.source));
  }
});

async function precacheGifs(urls, client) {
  const cache = await caches.open(GIF_CACHE);
  let done = 0, added = 0;
  const queue = urls.slice();
  // Small concurrency window: warm the cache without saturating a phone link.
  const workers = new Array(4).fill(0).map(async () => {
    while (queue.length) {
      const url = queue.shift();
      try {
        if (!(await cache.match(url))) {
          const res = await fetch(url, { mode: 'cors' });
          if (res && (res.ok || res.type === 'opaque')) { await cache.put(url, res.clone()); added++; }
        }
      } catch (_) { /* skip failures; retried on next run */ }
      done++;
      if (client && done % 10 === 0) client.postMessage({ type: 'GIF_PROGRESS', done: done, total: urls.length });
    }
  });
  await Promise.all(workers);
  if (client) client.postMessage({ type: 'GIF_DONE', done: done, total: urls.length, added: added });
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Exercise GIFs → cache-first, then network (storing for next time).
  if (/static\.exercisedb\.dev/.test(url.href) || /\.gif($|\?)/.test(url.href)) {
    e.respondWith(
      caches.open(GIF_CACHE).then((c) =>
        c.match(req).then((hit) =>
          hit || fetch(req).then((res) => {
            if (res && (res.ok || res.type === 'opaque')) c.put(req, res.clone()).catch(() => {});
            return res;
          })
        )
      ).catch(() => fetch(req))
    );
    return;
  }

  // App shell → network-first, cache fallback.
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && url.origin === self.location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req))
  );
});

// Rest-timer notification actions (+30s / Done) handled without opening the app.
self.addEventListener('notificationclick', (e) => {
  const action = e.action;
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
      if (action === 'add30' || action === 'done') {
        for (const c of cs) { c.postMessage({ type: 'REST_ACTION', action: action }); return; }
        return self.clients.openWindow('./');
      }
      for (const c of cs) if ('focus' in c) return c.focus();
      return self.clients.openWindow('./');
    })
  );
});
