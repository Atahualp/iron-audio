// Iron Audio (iOS) service worker — v1.1.0
// Scoped to /iron-audio/ios/ so it cannot collide with the Android build's
// worker at /iron-audio/. Network-first so a deploy is picked up immediately;
// cache fallback keeps the app openable on gym wifi.
const CACHE     = 'iron-audio-ios-v2';
const GIF_CACHE = 'iron-audio-ios-gifs'; // version-independent: never re-fetch on a deploy

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./'])).catch(() => {}));
  // NO skipWaiting() here. The worker must not self-activate — a deploy landing
  // mid-workout would swap the app out from under an active session. The page
  // calls SKIP_WAITING from the update banner when the user taps it.
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
  if (d.type === 'SKIP_WAITING') { self.skipWaiting(); return; }
  if (d.type === 'PRECACHE_GIFS' && Array.isArray(d.urls)) {
    e.waitUntil(warmGifCache(d.urls));
  }
});

// Warm the offline GIF cache in small batches. iOS caps total origin storage
// harder than Android, so failures here are expected and must not abort the run.
async function warmGifCache(urls) {
  const total = urls.length;
  let done = 0;
  const cache = await caches.open(GIF_CACHE);
  const BATCH = 4;

  for (let i = 0; i < total; i += BATCH) {
    await Promise.all(
      urls.slice(i, i + BATCH).map(async (u) => {
        try {
          if (!(await cache.match(u))) {
            const res = await fetch(u, { mode: 'cors' });
            if (res && (res.ok || res.type === 'opaque')) await cache.put(u, res);
          }
        } catch (err) { /* one bad GIF, or a quota stop, must not kill the run */ }
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

  // +30s / Done from the notification. iOS only surfaces action buttons on an
  // expanded notification inside an installed PWA — harmless where it doesn't.
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
