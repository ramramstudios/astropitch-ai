/**
 * AstroPitch already computes everything locally with no server calls, so
 * caching the app shell is enough to make it fully usable offline once
 * installed. Bump CACHE_NAME to invalidate old caches on the next deploy —
 * there's no build step to hash filenames automatically.
 */
const CACHE_NAME = 'astropitch-v1';

const SHELL_FILES = [
  '.',
  'index.html',
  'manifest.json',
  'favicon.ico',
  'favicon.png',
  'favicon.svg',
  'icon-192.png',
  'icon-512.png',
  'apple-touch-icon.png',
  'src/styles.css',
  'src/ui/app.js',
  'src/ui/wheel.js',
  'src/ui/starfield.js',
  'src/audio/engine.js',
  'src/audio/palettes.js',
  'src/audio/performer.js',
  'src/audio/tuning.js',
  'src/audio/voices.js',
  'src/chart.js',
  'src/ephemeris.js',
  'src/ontology.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/**
 * Network-first for navigations and same-origin GETs, falling back to the
 * cache offline — this way an online visit always gets the latest app
 * instead of a stale cached copy, and the cache only kicks in once there's
 * no connection. Non-GET requests and cross-origin requests pass straight
 * through untouched.
 */
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone();
        // Tied to the fetch event's own lifetime — without this the browser
        // can terminate the worker right after respondWith() resolves,
        // before an unawaited cache write actually finishes.
        event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)));
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached ?? caches.match('index.html')))
  );
});
