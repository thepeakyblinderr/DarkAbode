// Abode Service Worker v2.0
// !! Bump CACHE version on every deploy to bust old cache !!
const CACHE = 'abode-v2';

const ASSETS = [
  './',
  './index.html',
  './moneymate.html',
  './wealth.html',
  './docvault.html',
  './wanderplan.html',
  './manifest.json'
];

// Install — pre-cache all files, skip waiting immediately
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// Activate — delete ALL old caches, claim clients right away
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => {
          console.log('[SW] Deleting old cache:', k);
          return caches.delete(k);
        })
      ))
      .then(() => self.clients.claim())
  );
});

// Message — allow pages to trigger skipWaiting
self.addEventListener('message', e => {
  if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

// Fetch strategy:
//   HTML pages  → network first (always fresh on deploy)
//   Other assets → cache first + background revalidate
self.addEventListener('fetch', e => {
  if (!e.request.url.startsWith(self.location.origin)) return;

  const isHTML = e.request.mode === 'navigate'
    || e.request.destination === 'document'
    || e.request.url.endsWith('.html');

  if (isHTML) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          if (res.status === 200) {
            caches.open(CACHE).then(c => c.put(e.request, res.clone()));
          }
          return res;
        })
        .catch(() => caches.match(e.request))
    );
  } else {
    e.respondWith(
      caches.match(e.request).then(cached => {
        const networkFetch = fetch(e.request).then(res => {
          if (res.status === 200) {
            caches.open(CACHE).then(c => c.put(e.request, res.clone()));
          }
          return res;
        });
        return cached || networkFetch;
      })
    );
  }
});
