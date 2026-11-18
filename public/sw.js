/* Glovebox Goods service worker: app shell precache, network-first for pages + API, offline fallback. */
const VERSION = 'v1';
const SHELL = `gg-shell-${VERSION}`;
const RUNTIME = `gg-runtime-${VERSION}`;
const IMAGES = `gg-img-${VERSION}`;
const SHELL_URLS = [
  '/', '/product', '/cart', '/offline', '/styles.css', '/app.js', '/manifest.webmanifest',
  '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png', '/icons/favicon-32.png',
];
// Never touch these: admin, payments, webhooks, health checks.
const BYPASS = [/^\/admin/, /^\/api\/admin/, /^\/api\/checkout/, /^\/api\/stripe/, /^\/healthz/];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_URLS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  const keep = [SHELL, RUNTIME, IMAGES];
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => !keep.includes(k)).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function networkFirst(req, cacheName, fallback) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res.ok && res.type === 'basic') cache.put(req, res.clone());
    return res;
  } catch {
    const hit = (await cache.match(req)) || (await caches.match(req, { ignoreSearch: true }));
    if (hit) return hit;
    if (fallback) return (await caches.match(fallback)) || Response.error();
    return new Response(JSON.stringify({ error: 'offline' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
  }
}
async function staleWhileRevalidate(req) {
  const cache = await caches.open(SHELL);
  const hit = await cache.match(req);
  const net = fetch(req).then(res => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => hit);
  return hit || net;
}
async function cacheFirst(req) {
  const cache = await caches.open(IMAGES);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;           // Stripe etc. go straight to network
  if (BYPASS.some(r => r.test(url.pathname))) return;
  if (req.mode === 'navigate') return e.respondWith(networkFirst(req, RUNTIME, '/offline'));
  if (url.pathname.startsWith('/api/')) return e.respondWith(networkFirst(req, RUNTIME));
  if (url.pathname.startsWith('/img/') || url.pathname.startsWith('/icons/')) return e.respondWith(cacheFirst(req));
  if (/\.(css|js|webmanifest)$/.test(url.pathname)) return e.respondWith(staleWhileRevalidate(req));
});
