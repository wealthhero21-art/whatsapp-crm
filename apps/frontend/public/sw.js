// Service worker — minimal first version. Strategy:
//   * /api/*, /auth/*, /webhook/*, /api/events  → network only, never cache
//   * Built static assets (hashed filenames under /assets/*) → cache-first
//   * Everything else (SPA shell) → network-first with cache fallback so the
//     app loads when offline.
//
// We bump CACHE_VERSION to evict stale shells.

const CACHE_VERSION = 'crm-v1';
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const ASSET_CACHE = `${CACHE_VERSION}-assets`;

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((k) => !k.startsWith(CACHE_VERSION)).map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Same-origin only.
  if (url.origin !== self.location.origin) return;

  // API / auth / webhook / SSE → never cache.
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/auth/') ||
    url.pathname.startsWith('/webhook/') ||
    url.pathname === '/health'
  ) {
    return;
  }

  // Hashed static assets — cache-first.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(req, ASSET_CACHE));
    return;
  }

  // Everything else (SPA HTML + manifest + icons) — network-first.
  event.respondWith(networkFirst(req, SHELL_CACHE));
});

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    const hit = await cache.match(req);
    if (hit) return hit;
    // Last-resort offline page: return /index.html if cached so SPA still renders.
    const index = await cache.match('/');
    if (index) return index;
    return Response.error();
  }
}
