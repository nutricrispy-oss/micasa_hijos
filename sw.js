// Service Worker – Mi Casa
const VERSION = 'micasa-v1.0.0';
const SHELL = [
  './', 'index.html', 'manifest.json', 'css/styles.css',
  'js/app.js', 'js/config.js', 'js/logic.js', 'js/ui.js', 'js/store-local.js', 'js/store-supabase.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/badge-96.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Datos y fotos de Supabase: siempre en línea (privados, nunca se guardan en caché)
  if (url.hostname.endsWith('supabase.co') || url.hostname.endsWith('supabase.in')) return;
  // Librería de Supabase desde el CDN: primero caché
  if (url.hostname === 'cdn.jsdelivr.net') {
    e.respondWith(caches.open(VERSION).then(async c => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    }));
    return;
  }
  if (url.origin !== location.origin) return;
  // Archivos de la app: primero red (para recibir actualizaciones), si no hay conexión usa la caché
  e.respondWith(fetch(req).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
    return res;
  }).catch(async () => (await caches.match(req, { ignoreSearch: true })) || caches.match('index.html')));
});

// Notificaciones push (enviadas por la función send-push de Supabase)
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: 'Mi Casa', body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Mi Casa', {
    body: d.body || '', tag: d.tag || 'micasa', renotify: true,
    icon: 'icons/icon-192.png', badge: 'icons/badge-96.png', data: { tab: d.tab || 'home' },
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) { c.postMessage({ type: 'open-tab', tab: e.notification.data?.tab || 'home' }); return c.focus(); }
    return self.clients.openWindow('./');
  }));
});
