// Offline support: cache the app shell, serve it cache-first, refresh in the background.
const CACHE = 'pocket-universe-v93';
const SHELL = [
  './', 'index.html', 'css/style.css', 'manifest.webmanifest',
  'js/main.js', 'js/units.js', 'js/bodies.js', 'js/physics.js', 'js/presets.js',
  'js/camera.js', 'js/render.js', 'js/input.js', 'js/ui.js', 'js/facts.js', 'js/book.js', 'js/shaders.js', 'js/render3d.js', 'js/thermal.js', 'js/stellar.js', 'js/thumbs.js', 'js/geography.js', 'js/ias15.js', 'js/tree.js', 'js/coagulate.js', 'js/optics.js', 'js/audio.js', 'js/gravzones.js', 'js/minors.js', 'js/moons.js', 'js/gpu.js', 'js/glgpu.js', 'js/wgsl.js', 'js/challenges.js',
  ...['venus', 'titan', 'mars', 'io', 'pluto', 'jupiter', 'saturn', 'earth-night', 'charon', 'callisto', 'europa', 'ganymede', 'phobos', 'deimos', 'mercury', 'uranus', 'neptune', 'sun', 'venus-clouds', 'earth-day', 'earth-clouds', 'milkyway'].map((n) => `assets/maps/${n}.jpg`), 'assets/maps/earth.png', ...['67p','bennu','deimos','eros','geographos','golevka','hw1','itokawa','kleopatra','mithra','phobos','toutatis','vesta','haumea','ryugu','lutetia','steins','arrokoth'].map((n) => `assets/maps/shape-${n}.png`), ...['earth', 'moon', 'mars', 'venus', 'mercury', 'pluto', 'charon'].map((n) => `assets/maps/${n}-height.png`),
  ...['ui-click', 'ui-sequence', 'ui-hint', 'ui-affirm', 'ui-glitch', 'confirm7', 'complete', 'amb-engine', 'amb-wind', 'rumble1', 'rumble4', 'rumbleloop', 'decay', 'music-relax-beat', 'music-drone', 'music-vastness', 'music-space', 'music-valley-sunset'].map((n) => `assets/audio/${n}.mp3`),
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
