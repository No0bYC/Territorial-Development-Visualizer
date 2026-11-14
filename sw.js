/* TDV — service worker : met l'application en cache pour un lancement rapide et hors-ligne.
   À chaque mise en ligne d'une nouvelle version, incrémenter VERSION. */
const VERSION = 'tdv-v0.1.0';
const SHELL = ['/', '/index.html', '/css/app.css', '/js/config.js', '/js/app.js', '/vendor/maplibre-gl.js', '/vendor/maplibre-gl.css',
  '/manifest.webmanifest', '/icons/apple-touch-icon.png', '/icons/icon-192.png', '/icons/favicon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
/* Code et données : réseau d'abord (toujours la dernière version), cache en secours */
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then((r) => { const copy = r.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); return r; })
      .catch(() => caches.match(e.request).then((m) => m || caches.match('/index.html')))
  );
});
