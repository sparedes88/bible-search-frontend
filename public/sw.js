/**
 * Service Worker for Aggressive Caching
 * Makes images load instantly on repeat visits
 */

const CACHE_NAME = 'bible-search-v1';
const IMAGE_CACHE = 'images-v1';
const MAX_CACHE_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days

// Install event - cache critical resources
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Get base path for production
      const basePath = self.location.pathname.split('/').slice(0, -1).join('/') || '';
      return cache.addAll([
        basePath + '/',
        basePath + '/img/image-fallback.svg',
        basePath + '/img/image-placeholder.png',
        basePath + '/img/logo-fallback.svg',
        basePath + '/img/banner-fallback.svg'
      ].filter(Boolean));
    }).catch((err) => {
      console.log('Cache install failed:', err);
      // Continue even if cache fails
    })
  );
  self.skipWaiting();
});

// Activate event - clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME && cacheName !== IMAGE_CACHE) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch event - aggressive image caching
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // Cache images aggressively
  if (event.request.destination === 'image' || 
      url.pathname.match(/\.(jpg|jpeg|png|gif|webp|svg)$/i)) {
    event.respondWith(
      caches.open(IMAGE_CACHE).then((cache) => {
        return cache.match(event.request).then((cachedResponse) => {
          // Return cached image if available
          if (cachedResponse) {
            return cachedResponse;
          }
          
          // Fetch and cache new image
          return fetch(event.request).then((response) => {
            // Only cache successful responses
            if (response.status === 200) {
              cache.put(event.request, response.clone());
            }
            return response;
          }).catch(() => {
            // Return fallback image on error
            const basePath = self.location.pathname.split('/').slice(0, -1).join('/') || '';
            return caches.match(basePath + '/img/image-fallback.svg').catch(() => {
              // If fallback not in cache, return empty response
              return new Response('', { status: 404 });
            });
          });
        });
      })
    );
    return;
  }
  
  // For other requests, try network first, then cache
  event.respondWith(
    fetch(event.request).catch(() => {
      return caches.match(event.request);
    })
  );
});

