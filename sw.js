// Iron Audio service worker — V19.1.0
// Network-first so a fresh deploy is picked up immediately (version hygiene);
// cache fallback keeps the app openable offline. Also required so
// showNotification() works for rest-complete alerts.
const CACHE     = 'iron-audio-v19-2';
const GIF_CACHE = 'iron-audio-gifs'; // version-independent: ~20MB, never re-fetch on a deploy

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./'])).catch(() => {}));
  // NO skipWaiting() here. The worker must NOT self-activate — a deploy landing
  // mid-workout would swap the app out from under an active session. The page
  // offers the update banner and calls SKIP_WAITING only when the user taps it.
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE && k !== GIF_CACHE) // never evict the GIF cache
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  // Precached exercise GIFs are immutable — serve cache-first, cross-origin.
  if (/\.gif($|\?)/i.test(url.pathname)) {
    e.respondWith(
      caches.open(GIF_CACHE)
        .then((c) => c.match(e.request))
        .then((hit) => hit || fetch(e.request))
        .catch(() => fetch(e.request))
    );
    return;
  }

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok && url.origin === self.location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});

self.addEventListener('message', (e) => {
  const d = e.data || {};

  // Page-controlled activation — the other half of the update banner.
  if (d.type === 'SKIP_WAITING') { self.skipWaiting(); return; }

  if (d.type === 'PRECACHE_GIFS' && Array.isArray(d.urls)) {
    e.waitUntil(warmGifCache(d.urls));
  }
});

// Warm the offline GIF cache in small batches so a few hundred cross-origin
// requests don't stall the worker or trip rate limits. Progress is reported
// back to whichever client asked.
async function warmGifCache(urls) {
  const total = urls.length;
  let done = 0;
  const cache = await caches.open(GIF_CACHE);
  const BATCH = 6;

  for (let i = 0; i < total; i += BATCH) {
    await Promise.all(
      urls.slice(i, i + BATCH).map(async (u) => {
        try {
          if (!(await cache.match(u))) {
            const res = await fetch(u, { mode: 'cors' });
            if (res && (res.ok || res.type === 'opaque')) await cache.put(u, res);
          }
        } catch (err) { /* one bad GIF must not abort the run */ }
        done++;
      })
    );
    await post({ type: 'GIF_PROGRESS', done, total });
  }
  await post({ type: 'GIF_DONE', total });
}

async function post(msg) {
  const cs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  cs.forEach((c) => c.postMessage(msg));
}

self.addEventListener('notificationclick', (e) => {
  const action = e.action;
  e.notification.close();

  // V18.3: +30s / Done are actionable from the lock screen. Relay to the page
  // and stay put — focusing the app on an action tap defeats the purpose.
  if (action === 'add30' || action === 'done') {
    e.waitUntil(post({ type: 'REST_ACTION', action }));
    return;
  }

  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
      for (const c of cs) if ('focus' in c) return c.focus();
      return self.clients.openWindow('./');
    })
  );
});
