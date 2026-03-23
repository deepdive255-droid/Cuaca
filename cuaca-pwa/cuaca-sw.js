const CACHE_NAME = 'cuaca-v2';
const WEATHER_CACHE = 'cuaca-data-v2';

// File lokal yang wajib di-cache
const STATIC_ASSETS = [
  './cuaca.html',
  './cuaca-manifest.json',
  './cuaca-icon.svg'
];

// CDN eksternal — di-cache terpisah, gagal tidak blok install
const CDN_ASSETS = [
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap'
];

// ===== INSTALL =====
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(async (cache) => {
        // File lokal wajib berhasil
        await cache.addAll(STATIC_ASSETS);

        // CDN opsional, gagal tidak apa-apa
        await Promise.allSettled(
          CDN_ASSETS.map(url =>
            fetch(url, { mode: 'cors' })
              .then(res => { if (res.ok) cache.put(url, res); })
              .catch(() => {})
          )
        );
      })
      .then(() => self.skipWaiting())
  );
});

// ===== ACTIVATE =====
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(k => k !== CACHE_NAME && k !== WEATHER_CACHE)
          .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ===== FETCH =====
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Abaikan non-http
  if (!url.protocol.startsWith('http')) return;

  // Weather & Geocoding API: network-first, fallback cache
  if (
    url.hostname.includes('open-meteo.com') ||
    url.hostname.includes('nominatim.openstreetmap.org')
  ) {
    event.respondWith(networkFirstWithCache(event.request, WEATHER_CACHE));
    return;
  }

  // Map tiles: cache-first
  if (url.hostname.includes('tile.openstreetmap.org')) {
    event.respondWith(cacheFirstWithNetwork(event.request, CACHE_NAME));
    return;
  }

  // File lokal & CDN: cache-first, fallback network
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;

      return fetch(event.request)
        .then(response => {
          if (response && response.status === 200 && response.type !== 'opaque') {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => {
          if (event.request.mode === 'navigate') {
            return caches.match('./cuaca.html');
          }
          return new Response('', { status: 503, statusText: 'Offline' });
        });
    })
  );
});

// ===== HELPERS =====

async function networkFirstWithCache(request, cacheName) {
  try {
    const response = await fetch(request.clone());
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response(JSON.stringify({ error: 'offline' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

async function cacheFirstWithNetwork(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('', { status: 503 });
  }
}

// ===== NOTIFIKASI HUJAN =====
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
        if (!res) continue;
        const data = await res.json();
        const hourly = data.hourly;
        if (hourly?.precipitation_probability) {
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
  } catch {}
}

// ===== KLIK NOTIFIKASI =====
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then(clientList => {
      for (const client of clientList) {
        if (client.url.includes('cuaca') && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow('./cuaca.html');
    })
  );
});
