/* 扑通 · Service Worker：静态外壳离线可用，/api/* 一律走网络 */
const CACHE = 'putong-v2';
const PRECACHE = ['/', '/index.html', '/icon.svg', '/icon-mask.svg', '/manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // 模型与推送接口不走缓存
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).then((r) => { caches.open(CACHE).then((c) => c.put('/', r.clone())).catch(() => {}); return r; }).catch(() => caches.match('/index.html')));
    return;
  }
  e.respondWith(
    caches.match(e.request).then((hit) => {
      const net = fetch(e.request).then((r) => {
        if (r.ok) caches.open(CACHE).then((c) => c.put(e.request, r.clone())).catch(() => {});
        return r;
      }).catch(() => hit);
      return hit || net;
    }),
  );
});

/* Web Push：挂念到期 & 每日扑通提醒 */
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { /* ignore */ }
  e.waitUntil(self.registration.showNotification(d.title || '扑通', {
    body: d.body || '扑通在窗台等你。',
    icon: '/icon.svg',
    badge: '/icon-mask.svg',
    tag: d.tag || 'putong',
    renotify: !!d.tag,
    data: d,
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
      for (const c of cs) { if (c.url.includes(self.location.origin)) { return c.focus(); } }
      return self.clients.openWindow('/');
    }),
  );
});
