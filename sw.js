// Offline support: cache the app shell, serve it cache-first, refresh in the background.
const CACHE = 'pocket-universe-v16';
const SHELL = [
  './', 'index.html', 'css/style.css', 'manifest.webmanifest',
  'js/main.js', 'js/units.js', 'js/bodies.js', 'js/physics.js', 'js/presets.js',
  'js/camera.js', 'js/render.js', 'js/input.js', 'js/ui.js', 'js/facts.js', 'js/book.js', 'js/shaders.js', 'js/render3d.js', 'js/thermal.js', 'js/stellar.js', 'js/thumbs.js', 'js/geography.js', 'js/ias15.js', 'js/tree.js', 'js/coagulate.js', 'js/optics.js', 'js/audio.js',
  ...['click', 'bleep1', 'bleep4', 'bleep6', 'bleep7', 'data1', 'data5', 'confirm2', 'confirm5', 'confirm7', 'denied2', 'denied3', 'execute', 'complete', 'seq3', 'seq6', 'rumble1', 'rumble4', 'rumbleloop', 'decay'].map((n) => `assets/audio/${n}.mp3`),
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then((hit) => {
      const net = fetch(e.request).then((res) => {
        if (res.ok && (new URL(e.request.url).origin === location.origin || e.request.url.includes('fonts.g'))) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      }).catch(() => hit);
      return hit || net;
    }),
  );
});
