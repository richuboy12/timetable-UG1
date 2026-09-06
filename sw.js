const CACHE_NAME = 'ug1-timetable-v1';
const URLS_TO_CACHE = [
  '/',
  '/index.html',
  '/manifest.json'
];

// Install event - cache essential files
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(URLS_TO_CACHE).catch(() => {
        // Fail silently if offline during install
        console.log('Cache setup failed - offline or files not available');
      });
    })
  );
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch event - network first, cache fallback
self.addEventListener('fetch', (event) => {
  // Only handle GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  // Always try network first for GitHub CSV files
  if (event.request.url.includes('raw.githubusercontent.com')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (!response || response.status !== 200) {
            return caches.match(event.request);
          }
          // Cache the response
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
          return response;
        })
        .catch(() => {
          // Network failed, try cache
          return caches.match(event.request);
        })
    );
    return;
  }

  // For HTML, CSS, JS - cache first, network fallback
  event.respondWith(
    caches.match(event.request).then((response) => {
      return (
        response ||
        fetch(event.request).then((response) => {
          if (!response || response.status !== 200) {
            return response;
          }
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
          return response;
        })
      );
    })
  );
});

// Background sync for data updates (optional)
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-timetable') {
    event.waitUntil(
      fetch('https://raw.githubusercontent.com/richuboy12/timetable-UG1/main/data/timetable.csv')
        .then((response) => {
          if (response.ok) {
            return caches.open(CACHE_NAME).then((cache) => {
              return cache.put(
                'https://raw.githubusercontent.com/richuboy12/timetable-UG1/main/data/timetable.csv',
                response
              );
            });
          }
        })
        .catch(() => {
          // Sync failed, will retry later
          console.log('Background sync failed');
        })
    );
  }
});
