const CACHE_NAME = 'cityride-offline-v1';
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/driver.html',
    '/driver-login.html',
    '/driver-register.html',
    '/style.css',
    '/app.js',
    '/config.js',
    '/logo.png',
    '/icon_background.png',
    '/splash_icon.png'
];

// Install event: cache static assets
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            console.log('[ServiceWorker] Caching App Shell');
            return cache.addAll(STATIC_ASSETS);
        }).then(() => self.skipWaiting())
    );
});

// Activate event: clean up old caches
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.filter(name => name !== CACHE_NAME)
                          .map(name => caches.delete(name))
            );
        }).then(() => self.clients.claim())
    );
});

// Fetch event: Network first, falling back to cache if offline
self.addEventListener('fetch', event => {
    // Skip cross-origin requests
    if (!event.request.url.startsWith(self.location.origin)) {
        return;
    }

    // Do not intercept or cache dynamic backend API requests; let the app offline logic handle those.
    if (event.request.url.includes('/api/')) {
        return;
    }

    event.respondWith(
        fetch(event.request)
            .then(response => {
                // If network is successful, update cache with latest version
                const responseClone = response.clone();
                caches.open(CACHE_NAME).then(cache => {
                    cache.put(event.request, responseClone);
                });
                return response;
            })
            .catch(() => {
                // If network fails (offline), serve the cached local version
                return caches.match(event.request);
            })
    );
});
