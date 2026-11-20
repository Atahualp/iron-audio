// Iron Audio service worker — V20.1.0 (Gridiron)
// Network-first so a fresh deploy is picked up immediately (version hygiene);
// cache fallback keeps the app openable offline. Also required so
// showNotification() works for rest-complete alerts.
const CACHE     = 'iron-audio-v20-1';
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

  // V19.6: end-of-rest alarm lives here. Chrome freezes a hidden PWA page, so its
  // timers never fire; an extended message event keeps this worker alive (~5 min cap).
  if (d.type === 'REST_ARM' && typeof d.endTime === 'number') {
    const p = armRest(d.endTime, d.name);
    if (p) e.waitUntil(p);
  }
  if (d.type === 'REST_CANCEL') cancelRest();
});

const REST_MAX_MS = 290000; // stay under Chrome's 5-min extendable-event limit
let restAlarm = null;       // { timer, resolve, name }
let lastRestName = 'Next set';

function cancelRest() {
  if (!restAlarm) return;
  clearTimeout(restAlarm.timer);
  restAlarm.resolve();
  restAlarm = null;
}

function armRest(endTime, name) {
  cancelRest();
  lastRestName = String(name || lastRestName).slice(0, 80);
  const ms = endTime - Date.now();
  if (ms <= 0 || ms > REST_MAX_MS) return null;
  return new Promise((resolve) => {
    const alarm = { resolve, timer: 0 };
    alarm.timer = setTimeout(async () => {
      try {
        const cs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        // Foreground page already beeped/vibrated — don't double-alert.
        if (!cs.some((c) => c.visibilityState === 'visible')) {
          await self.registration.showNotification('\uD83C\uDFC8 Play clock \u2014 0:00', {
            body: lastRestName + ' \u2014 snap it',
            tag: 'ia-rest', renotify: true, vibrate: [100, 50, 100, 50, 300],
            icon: 'icon-192.png', badge: 'icon-192.png',
            actions: [{ action: 'add30', title: '+30s' }, { action: 'done', title: 'Done' }]
          });
        }
      } catch (err) { /* notification permission revoked */ }
      if (restAlarm === alarm) restAlarm = null;
      resolve();
    }, ms);
    restAlarm = alarm;
  });
}

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
  if (action === 'add30') {
    // Re-arm here — the page may still be frozen and can't schedule anything.
    const endTime = Date.now() + 30000;
    const p = armRest(endTime, lastRestName);
    e.waitUntil(Promise.all([post({ type: 'REST_ACTION', action, endTime }), p || Promise.resolve()]));
    return;
  }
  if (action === 'done') {
    cancelRest();
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
