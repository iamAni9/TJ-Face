const CACHE_NAME = 'tj-assistant-v1';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './icon.svg'
];

self.addEventListener('install', (e) => {
  self.skipWaiting(); // Force the service worker to activate immediately
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
});

self.addEventListener('fetch', (e) => {
  e.respondWith(
    fetch(e.request)
      .then((networkResponse) => {
        // If we have internet, ALWAYS use the fresh file and update the cache
        return caches.open(CACHE_NAME).then((cache) => {
          cache.put(e.request, networkResponse.clone());
          return networkResponse;
        });
      })
      .catch(() => {
        // If we have NO internet, fall back to the old cached file
        return caches.match(e.request);
      })
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(clients.claim());
});
