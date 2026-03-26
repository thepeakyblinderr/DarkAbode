// Abode Service Worker v4.0
const CACHE = 'abode-v6';

const ASSETS = [
  './',
  './index.html',
  './moneymate.html',
  './wealth.html',
  './docvault.html',
  './wanderplan.html',
  './nutrily.html',
  './hobby.html',
  './manifest.json'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', e => {
  if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', e => {
  if (!e.request.url.startsWith(self.location.origin)) return;
  const isHTML = e.request.mode === 'navigate'
    || e.request.destination === 'document'
    || e.request.url.endsWith('.html');
  if (isHTML) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          if (res.status === 200) caches.open(CACHE).then(c => c.put(e.request, res.clone()));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
  } else {
    e.respondWith(
      caches.match(e.request).then(cached => {
        const net = fetch(e.request).then(res => {
          if (res.status === 200) caches.open(CACHE).then(c => c.put(e.request, res.clone()));
          return res;
        });
        return cached || net;
      })
    );
  }
});
