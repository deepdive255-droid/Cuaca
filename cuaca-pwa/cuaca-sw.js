const CACHE_NAME = 'cuaca-v1';
const WEATHER_CACHE = 'cuaca-data-v1';

const STATIC_ASSETS = [
  './cuaca.html',
  './cuaca-manifest.json',
  './cuaca-icon.svg',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap'
];

// Install: cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.allSettled(
        STATIC_ASSETS.map(url => cache.add(url).catch(() => {}))
      );
    }).then(() => self.skipWaiting())
  );
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME && k !== WEATHER_CACHE)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch: cache-first for static, network-first for API
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Weather API: network first, fallback to cache
  if (url.hostname.includes('open-meteo.com') || url.hostname.includes('nominatim.openstreetmap.org')) {
    event.respondWith(
      fetch(event.request.clone())
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(WEATHER_CACHE).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Static assets: cache first, fallback to network
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        // Fallback to main HTML for navigation
        if (event.request.mode === 'navigate') {
          return caches.match('./cuaca.html');
        }
      });
    })
  );
});

// Background sync: check rain notification
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'rain-check') {
    event.waitUntil(checkRainAndNotify());
  }
});

async function checkRainAndNotify() {
  try {
    const cache = await caches.open(WEATHER_CACHE);
    const keys = await cache.keys();
    for (const req of keys) {
      if (req.url.includes('open-meteo.com')) {
        const res = await cache.match(req);
        if (res) {
          const data = await res.json();
          const hourly = data.hourly;
          if (hourly && hourly.precipitation_probability) {
            const next3h = hourly.precipitation_probability.slice(0, 3);
            const maxProb = Math.max(...next3h);
            if (maxProb >= 60) {
              self.registration.showNotification('🌧️ Hujan Akan Datang!', {
                body: `Kemungkinan hujan ${maxProb}% dalam 3 jam ke depan. Siapkan payung!`,
                icon: './cuaca-icon.svg',
                badge: './cuaca-icon.svg',
                tag: 'rain-warning',
                renotify: true,
                vibrate: [200, 100, 200]
              });
            }
          }
        }
      }
    }
  } catch (e) {}
}

// Handle notification click
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes('cuaca') && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow('./cuaca.html');
    })
  );
});
