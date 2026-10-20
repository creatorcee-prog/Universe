import { PK } from './physics.js';
import { isLuminous, tempToRGB, schwarzschild } from './bodies.js';
import { transientLum } from './stellar.js';
import { EARTH_MASS, KPC_AU } from './units.js';
import { starCatalog, bvToTemp, GAL_N, GAL_C } from './stars.js';
import { ATMO_FS, BODY_FS, BODY_VS, DISK_FS, DISK_VS, LINES_FS, LINES_VS, POINTS_FS, POINTS_VS, SKY_FS, SKY_VS, GALGLOW_VS, GALGLOW_FS, GALCOMP_FS, SPRITE_FS, SPRITE_VS, FULL_VS, MILKYWAY_FS, DOWN_FS, UP_FS, COMPOSITE_FS, PIXEL_FS, SURFACE_SKY_FS, TEMP_FIELD_FS, RIM_FS, TERRAIN_VS, TERRAIN_FS, RING_FS, CLOUD_FS, GEN_FS, SURFACE_CLOUD_FS, WEATHER_FS, NEBULA_FS, BLIT_FS } from './shaders.js';
import { atmosphereOptics, giantOptics, setOpticsUniforms, stretchOptics, atmosphereTop, shellTop, groundLight } from './optics.js';
import { heatOutput } from './thermal.js';
import { earthMap, moonMap } from './geography.js';

let EARTH_MAP = null, MOON_MAP = null; // built once, on first use

// Image maps (equirectangular, 0° longitude at the centre, east to the right), stored as brightness
// relative to the map's mean (0.5 = average) so the shaders keep their own physically chosen colours:
//   mode 3 — Venus: Magellan radar mosaic (shown in false orange in the source). Radar brightness
//            tracks roughness and elevation (tesserae and highlands bright, smooth lava plains dark),
//            so it shades the ground and its relief; the rock colour stays dark basalt.
//   mode 4 — Titan: brightness of the haze top (darker northern polar hood); tints the haze only.
// Colour maps (the image is the surface colour itself):
//   mode 5 — rocky worlds: Mars (Viking MDIM colour mosaic), Io (Galileo/Voyager), Pluto (New Horizons).
//   mode 6 — giant planets: Jupiter (Cassini) and Saturn cloud tops, in place of the band tables.
//   mode 7 — greyscale mosaics (Voyager/Galileo for Callisto, Europa, Ganymede; Viking for Phobos and
//            Deimos), as brightness relative to the mean: tinted with the world's own colours, the darker
//            material (Europa's lineae, Ganymede's old dark terrain) in the darker one.
//   mode 9 — the Sun: a brightness pattern of active regions, applied lightly (the visible Sun is nearly
//            uniform; its colour, limb darkening, granulation and spots come from the physics).
// (Mode 8, kept for a partial map:)
//   mode 8 — the Moon: as mode 7, brightness relative to the highlands, from a full-Moon photograph
//            (LRO) reprojected onto the near side; G marks where it covers (fading out 63–80° from the
//            sub-Earth point), the rest is the hand-placed maria and far-side basins.
// Mars's and Io's sources covered only the central 320° of longitude; the missing 40° around 180° is
// filled by blending the two edges (so it holds no real features).
const PHOTO = [
  [/^Venus( \d+)?$/, 'venus', 3, 'rocky'], [/^Titan( \d+)?$/, 'titan', 4, 'rocky'],
  [/^Mars( \d+)?$/, 'mars', 5, 'rocky'], [/^Io( \d+)?$/, 'io', 5, 'rocky'], [/^Pluto( \d+)?$/, 'pluto', 5, 'rocky'],
  [/^Jupiter( \d+)?$/, 'jupiter', 6, 'gas'], [/^Saturn( \d+)?$/, 'saturn', 6, 'gas'],
  [/^Charon( \d+)?$/, 'charon', 5, 'rocky'], [/^Moon( \d+)?$/, 'moon', 5, 'rocky'], [/^Mercury( \d+)?$/, 'mercury', 5, 'rocky'],
  [/^Uranus( \d+)?$/, 'uranus', 6, 'gas'], [/^Neptune( \d+)?$/, 'neptune', 6, 'gas'], [/^Sun( \d+)?$/, 'sun', 9, 'star'],
  ...['Callisto', 'Europa', 'Ganymede', 'Phobos', 'Deimos'].map((n) => [new RegExp(`^${n}( \\d+)?$`), n.toLowerCase(), 7, 'rocky']),
];
const photoImg = {};
let contextGen = 0; // see Renderer3D's gen
const gl0 = (gl, u) => gl.uniform4f(u.uFlare, 0, 0, 0, 1);   // lens flare off
function loadImage(file, ext = 'jpg') {
  let e = photoImg[file];
  if (!e) {
    e = photoImg[file] = { img: null };
    const inline = typeof window !== 'undefined' && window.__MAPS__ && window.__MAPS__[file];
    const im = new Image();
    im.onload = () => { e.img = im; };
    im.src = inline || `assets/maps/${file}.${ext}`;
  }
  return e.img;
}
// The Surface view's ground materials (groundMats), in the order of TERRAIN_FS's uGSoil..uGGrass, and the
// texture units they take.
const GROUND_MATS = ['soil', 'sand', 'rock', 'regolith', 'grass'];
const GROUND_UNITS = [1, 2, 4, 6, 9];
function photoMap(b) {
  const p = PHOTO.find(([re, , , kind]) => re.test(b.name) && b.kind === kind);
  if (!p) return null;
  const img = loadImage(p[1], p[4]);
  return img ? { mode: p[2], img, W: img.width, H: img.height, ver: 1, file: p[1] } : null;
}
// Close-up maps (tools/make_maps_4k.py), 4096 x 2048: swapped in while the world is large on screen and
// released when it is not, so at most one or two (~45 MB each on the GPU with mipmaps) are ever held.
const HI_MAPS = new Set(['moon', 'mars', 'mercury']);
function hiMap(sm, shownPx) {
  if (!sm || !sm.img) return sm;
  if (sm.hi) {
    if (shownPx >= 150) return sm;
    delete photoImg[sm.lo.file + '-4k'];   // (let the large image go; the browser keeps the file cached)
    return sm.lo;
  }
  if (!HI_MAPS.has(sm.file) || shownPx < 300) return sm;   // (shownPx: the radius on screen, CSS pixels)
  const img = loadImage(sm.file + '-4k');
  return img ? { ...sm, img, W: img.width, H: img.height, ver: sm.ver + 1, hi: true, lo: sm } : sm;
}
// Donor maps: a world with no map of its own (one you create, or a random planetesimal) borrows the
// brightness pattern of a real one of its type (cratered highlands, ice, dust, volcanic plains, small
// moons, giant-planet cloud bands), turned to a random orientation and tinted with its own colours
// and climate. So each new world gets realistic detail of its own kind, and no two look the same.
const DONORS = { cratered: ['moon', 'callisto', 'ganymede'], icy: ['europa', 'ganymede', 'charon', 'pluto'], dusty: ['mars'], volcanic: ['io'], small: ['phobos', 'deimos'], giant: ['jupiter', 'saturn'] };
const donorMean = new Map(); // image -> mean luminance
function donorFor(b, l) {
  if (LOOKS[b.name] || PHOTO.some(([re]) => re.test(b.name)) || /^(Earth|Moon)( \d+)?$/.test(b.name)) return null;
  let type;
  if (l.kind === 1) type = 'giant';
  else if (l.kind !== 0) return null;
  else if (l.lumpy) type = 'small';
  else if (l.volc) type = 'volcanic';
  else if (l.lineae || b.compKey === 'icemoon') type = 'icy';
  else if (l.ocean > 0 || b.life) return null; // ocean worlds keep their own continents
  else if (l.atmo || (b.color && b.color[0] > 1.3 * b.color[1])) type = 'dusty'; // thin air, or rust-red
  else type = 'cratered';
  const r = seeded(b.id), r2 = seeded(b.id * 7 + 3), r3 = seeded(b.id * 13 + 5);
  const list = DONORS[type], file = list[Math.floor(r * list.length) % list.length];
  const img = loadImage(file);
  if (!img) return null;
  if (!donorMean.has(img)) {
    let m = 0.5;
    try {
      const c = document.createElement('canvas'); c.width = 64; c.height = 32;
      const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0, 64, 32);
      const d = g.getImageData(0, 0, 64, 32).data; let s = 0;
      for (let i = 0; i < d.length; i += 4) s += (0.3 * d[i] + 0.55 * d[i + 1] + 0.15 * d[i + 2]) / 255;
      m = s / (d.length / 4);
    } catch { /* keep 0.5 */ }
    donorMean.set(img, Math.max(0.05, m));
  }
  // Orientation: any for solid worlds; giants only spin about their axis (and may flip north-south),
  // so the bands stay parallel to the equator.
  const a = r2 * Math.PI * 2, bt = type === 'giant' ? (r3 > 0.5 ? Math.PI : 0) : (r3 - 0.5) * Math.PI, c = type === 'giant' ? 0 : r * Math.PI * 2;
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(bt), sb = Math.sin(bt), cc = Math.cos(c), sc = Math.sin(c);
  // R = Ry(a) * Rx(bt) * Ry(c), column-major for GLSL
  const Ry = (co, si) => [co, 0, -si, 0, 1, 0, si, 0, co], Rx = (co, si) => [1, 0, 0, 0, co, si, 0, -si, co];
  const mul = (A, B) => { const o = new Array(9); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) o[j * 3 + i] = A[i] * B[j * 3] + A[3 + i] * B[j * 3 + 1] + A[6 + i] * B[j * 3 + 2]; return o; };
  const rot = new Float32Array(mul(mul(Ry(ca, sa), Rx(cb, sb)), Ry(cc, sc)));
  return { img, file, rot, mean: donorMean.get(img), k: type === 'giant' ? 0.85 : type === 'small' ? 0.9 : 0.8 };
}

// Real elevation (assets/maps/<file>-height.png, tools/make_heights.py), decoded to metres. Worlds with a
// donor borrow the heights of a real world of their type, scaled for gravity (relief goes roughly as
// 1/g: the same rock supports mountains twice as tall at half the gravity).
// (Pluto and Charon: New Horizons, about half of each mapped; the rest is Moon-like relief, see make_heights.py.)
const HEIGHTS = { Earth: 'earth', Moon: 'moon', Mars: 'mars', Venus: 'venus', Mercury: 'mercury', Pluto: 'pluto', Charon: 'charon' };
const HEIGHT_G = { earth: 9.81, moon: 1.62, mars: 3.71, venus: 8.87, mercury: 3.70, pluto: 0.62, charon: 0.29 };   // surface gravity, m/s²
// donor pattern -> [height map, relief relative to it] (flat icy Europa, softer icy relief on Callisto)
const DONOR_HEIGHT = { moon: ['moon', 1], callisto: ['moon', 0.6], ganymede: ['moon', 0.6], europa: ['moon', 0.2], charon: ['moon', 0.7], pluto: ['moon', 0.7], mars: ['mars', 1], io: ['venus', 0.5], phobos: ['moon', 1], deimos: ['moon', 1] };
const heightImg = {};
function heightMap(file) {
  let e = heightImg[file];
  if (!e) {
    e = heightImg[file] = { data: null };
    const im = new Image();
    im.onload = () => {
      try {
        const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
        const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(im, 0, 0);
        const d = g.getImageData(0, 0, im.width, im.height).data, f = new Float32Array(im.width * im.height);
        for (let i = 0; i < f.length; i++) f[i] = d[i * 4] * 256 + d[i * 4 + 1] - 32768;
        e.data = f; e.W = im.width; e.H = im.height;
      } catch { /* unreadable: no heights */ }
    };
    const inline = typeof window !== 'undefined' && window.__MAPS__ && window.__MAPS__[file + '-height'];
    im.src = inline || `assets/maps/${file}-height.png`;
  }
  return e.data ? e : null;
}
const IDENT3 = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);

// Real shapes of small bodies (assets/maps/shape-<name>.png, tools/make_shapes.py). Named bodies use
// their own; other small bodies (created asteroids and comets, planetesimals, Halley) borrow one of their
// kind at a random orientation. Above ~400 km bodies are pulled round by their own gravity.
const SHAPES = { Phobos: 'phobos', Deimos: 'deimos', Vesta: 'vesta', Haumea: 'haumea', Bennu: 'bennu', Ryugu: 'ryugu', Eros: 'eros',
  Itokawa: 'itokawa', Lutetia: 'lutetia', 'Šteins': 'steins', Arrokoth: 'arrokoth', '67P/Churyumov–Gerasimenko': '67p' };
const ASTEROID_SHAPES = ['eros', 'itokawa', 'bennu', 'kleopatra', 'geographos', 'toutatis', 'mithra', 'golevka', 'hw1', 'phobos', 'deimos', 'ryugu', 'lutetia', 'steins'];
const shapeImg = {};
function shapeMap(file) {
  let e = shapeImg[file];
  if (!e) {
    e = shapeImg[file] = { data: null };
    const im = new Image();
    im.onload = () => {
      try {
        const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
        const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(im, 0, 0);
        const d = g.getImageData(0, 0, im.width, im.height).data, f = new Float32Array(im.width * im.height);
        for (let i = 0; i < f.length; i++) f[i] = (d[i * 4] * 256 + d[i * 4 + 1]) / 16384;
        e.data = f; e.W = im.width; e.H = im.height;
      } catch { /* unreadable: stays round */ }
    };
    const inline = typeof window !== 'undefined' && window.__MAPS__ && window.__MAPS__['shape-' + file];
    im.src = inline || `assets/maps/shape-${file}.png`;
  }
  return e.data ? e : null;
}
function shapeFor(b) {
  if (b.kind !== 'rocky') return null;
  const own = SHAPES[b.name.replace(/ \d+$/, '')];
  if (own) return { file: own, rot: IDENT3 };
  const rkm = b.r * 1.495978707e8;
  if (b.round || rkm > 400 || /^(Earth|Moon|Mars|Venus|Mercury)( \d+)?$/.test(b.name)) return null;
  const small = b.comet || b.m / EARTH_MASS < 1e-4 || b.name.startsWith('Planetesimal');
  if (!small) return null;
  const r = seeded(b.id * 3 + 1), r2 = seeded(b.id * 5 + 2), r3 = seeded(b.id * 11 + 7);
  // (Planetesimals, the building blocks of planets, now and then take Arrokoth's two-lobed shape.)
  const pool = b.name.startsWith('Planetesimal') && r > 0.75 ? ['arrokoth'] : ASTEROID_SHAPES;
  const file = b.comet ? '67p' : rkm > 200 ? 'vesta' : pool[Math.floor(r * pool.length) % pool.length];
  const a = r2 * Math.PI * 2, t = (r3 - 0.5) * Math.PI, cA = Math.cos(a), sA = Math.sin(a), cT = Math.cos(t), sT = Math.sin(t);
  // Ry(a) * Rx(t), column-major
  const rot = new Float32Array([cA, 0, -sA, sA * sT, cT, cA * sT, sA * cT, -sT, cA * cT]);
  return { file, rot };
}

// Earth: land, sea depth, mountains and ice decoded from a NASA hypsometric relief map (the hand-traced
// geography fills the 40° of longitude the source lacked), in the same channels as earthMap(). Read back
// to pixels because painting edits it. Until it has loaded, the hand-traced map stands in.
let EARTH_REAL = null;
function earthReal() {
  if (EARTH_REAL) return EARTH_REAL;
  const img = loadImage('earth', 'png');
  if (!img) return null;
  try {
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    EARTH_REAL = { W: img.width, H: img.height, data: new Uint8Array(g.getImageData(0, 0, img.width, img.height).data.buffer) };
  } catch { EARTH_REAL = { W: 0 }; }
  return EARTH_REAL;
}

// A unit icosphere: the icosahedron's 12 corners, each face split into 4 per subdivision, pushed out to the sphere.
function icosphere(sub) {
  const t = (1 + Math.sqrt(5)) / 2;
  let pos = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]];
  let faces = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  const norm = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
  pos = pos.map(norm);
  for (let s = 0; s < sub; s++) {
    const mid = new Map(), next = [];
    const m = (a, b) => { const k = a < b ? a + ',' + b : b + ',' + a; if (!mid.has(k)) { mid.set(k, pos.length); pos.push(norm(pos[a].map((x, i) => (x + pos[b][i]) / 2))); } return mid.get(k); };
    for (const [a, b, c] of faces) { const ab = m(a, b), bc = m(b, c), ca = m(c, a); next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]); }
    faces = next;
  }
  return { pos: new Float32Array(pos.flat()), idx: faces.flat() };
}

// Realistic view: WebGL2 spheres with procedural, physically driven surfaces.
// Positions are taken relative to the camera in double precision before going to the GPU,
// so the same scene works from a few kilometres up to galaxy scale.

const D2R = Math.PI / 180;
const HOUR_YR = 1 / 8766;
const MAX_SPIN = Math.PI * 2 * 0.2; // visual cap: at most 0.2 turns per real second, so fast time doesn't strobe

const c3 = (r, g, b) => [r / 255, g / 255, b / 255];

// Appearance of named real bodies. tilt: axial tilt (deg); day: rotation period (hours).
const LOOKS = {
  Sun: { kind: 2, spots: 1, tilt: 7.25, day: 609 },
  Mercury: { colA: c3(128, 122, 115), colB: c3(92, 87, 82), craters: 1, tilt: 0.03, day: 1407.6 },
  // Venus's rock is dark grey basalt; the orange in lander photos is the light filtered by the air.
  Venus: { colA: c3(118, 108, 96), colB: c3(84, 78, 72), cloud: 1, colC: c3(236, 214, 160), atmo: c3(255, 220, 150), atmoK: 0.7, tilt: 177.4, day: 5832.5 },
  Earth: { aurora: 1, colA: c3(120, 100, 70), colB: c3(150, 130, 95), ocean: 0.7, life: 1, cloud: 0.62, atmo: c3(90, 150, 255), atmoK: 1, tilt: 23.4, day: 23.93 },
  Moon: { colA: c3(160, 156, 150), colB: c3(92, 90, 88), craters: 1, tilt: 6.7, day: 655.7, locked: 1 },
  Mars: { profile: 5, aurora: 0, colA: c3(196, 112, 64), colB: c3(150, 82, 48), craters: 0.35, atmo: c3(230, 140, 90), atmoK: 0.25, tilt: 25.2, day: 24.6 },
  Ceres: { colA: c3(118, 115, 110), colB: c3(84, 82, 80), craters: 1, lumpy: 0.03, day: 9.07 },
  Jupiter: { kind: 1, profile: 1, aurora: 2, colA: c3(234, 218, 190), colB: c3(176, 126, 88), bands: 7, storm: [0.92, -0.38, 0.1, 0.07], colC: c3(196, 104, 72), atmo: c3(230, 210, 170), atmoK: 0.2, tilt: 3.1, day: 9.93 },
  Saturn: { kind: 1, profile: 2, aurora: 2, colA: c3(240, 228, 196), colB: c3(214, 192, 148), bands: 9, bandK: 0.45, atmo: c3(240, 220, 170), atmoK: 0.2, tilt: 26.7, day: 10.7, hex: 1 },
  Uranus: { kind: 1, profile: 3, colA: c3(170, 226, 232), colB: c3(150, 210, 220), bands: 3, atmo: c3(180, 240, 255), atmoK: 0.4, tilt: 97.8, day: 17.24 },
  Neptune: { kind: 1, profile: 4, colA: c3(76, 112, 226), colB: c3(56, 88, 196), bands: 4, storm: [0.6, -0.5, 0.6, 0.12], colC: c3(62, 88, 140), atmo: c3(150, 195, 235), atmoK: 0.45, tilt: 28.3, day: 16.1 },
  Pluto: { colA: c3(214, 190, 160), colB: c3(140, 100, 76), craters: 0.3, tilt: 122.5, day: 153.3 },
  Io: { colA: c3(232, 214, 110), colB: c3(190, 140, 60), volc: 1, day: 42.5, locked: 1 },
  // The Ocean Moon scenario (made up): a warm giant banded cream and rose, and its ocean moon, locked to it.
  Rhodon: { kind: 1, colA: c3(236, 222, 210), colB: c3(196, 136, 140), bands: 8, colC: c3(214, 96, 122), atmo: c3(250, 214, 200), atmoK: 0.25, tilt: 2, day: 10.6 },
  Kyklos: { kind: 1, colA: c3(236, 228, 210), colB: c3(204, 188, 160), bands: 10, colC: c3(190, 170, 140), atmo: c3(236, 226, 206), atmoK: 0.22, tilt: 30, day: 10.2 },
  Elysia: { colA: c3(150, 128, 90), colB: c3(120, 104, 76), cloud: 0.4, ocean: 0.5, life: 1, atmo: c3(130, 180, 255), atmoK: 0.9, day: 166, locked: 1 },
  Pelagia: { colA: c3(70, 110, 180), colB: c3(52, 84, 140), cloud: 0.55, ocean: 1, atmo: c3(140, 190, 255), atmoK: 0.8, day: 14.9, locked: 1 },
  Europa: { colA: c3(226, 218, 204), colB: c3(170, 130, 100), lineae: 1, day: 85.2, locked: 1 },
  Ganymede: { colA: c3(150, 140, 126), colB: c3(98, 88, 78), craters: 0.6, day: 171.7, locked: 1 },
  Callisto: { colA: c3(104, 94, 82), colB: c3(70, 62, 54), craters: 1, day: 400.5, locked: 1 },
  "Halley's Comet": { colA: c3(48, 44, 40), colB: c3(30, 28, 26), lumpy: 0.45, craters: 0.5, day: 52.8 },
  Titan: { colA: c3(150, 110, 60), colB: c3(110, 80, 50), cloud: 1, colC: c3(214, 150, 70), atmo: c3(230, 160, 70), atmoK: 1, day: 382.7, locked: 1 },
  Enceladus: { colA: c3(244, 246, 250), colB: c3(214, 222, 232), lineae: 0.6, craters: 0.3, day: 32.9, locked: 1 },
  Triton: { colA: c3(226, 204, 198), colB: c3(190, 160, 150), craters: 0.2, lineae: 0.3, day: -141, locked: 1 },
  Charon: { colA: c3(170, 166, 160), colB: c3(120, 100, 90), craters: 0.6, day: 153.3, locked: 1 },
  // Phobos and Deimos are among the darkest bodies known (geometric albedo ~0.07, about half the Moon's).
  Phobos: { colA: c3(74, 68, 62), colB: c3(50, 46, 42), lumpy: 0.25, craters: 1, day: 7.65, locked: 1 },
  Deimos: { colA: c3(80, 72, 64), colB: c3(56, 50, 45), lumpy: 0.2, craters: 0.6, day: 30.3, locked: 1 },
  Vesta: { colA: c3(160, 150, 140), colB: c3(110, 102, 96), lumpy: 0.12, craters: 1, day: 5.34 },
  'Proto-Earth': { colA: c3(90, 50, 36), colB: c3(60, 34, 26), day: 5 },
  Theia: { colA: c3(140, 115, 96), colB: c3(100, 82, 70), craters: 0.5, day: 12 },
};

// The sea's waves by Fourier synthesis (J. Tessendorf, "Simulating Ocean Water", SIGGRAPH course notes
// 2001): a 32 m patch, 64 x 64 wave components drawn from the Phillips spectrum of a 9 m/s wind, each moving
// at the deep-water speed (ω = √(g k)); every frame an inverse FFT turns them into the slopes of the
// surface, which repeat seamlessly across the sea. (Thousands of waves instead of a few dozen trains.)
class OceanFFT {
  constructor(N = 64, L = 32, wind = 9, dir = [0.9, 0.436]) {
    this.N = N; this.L = L;
    const g = 9.81, Lw = wind * wind / g, n = N * N;
    this.kx = new Float32Array(n); this.kz = new Float32Array(n); this.w = new Float32Array(n);
    this.h0r = new Float32Array(n); this.h0i = new Float32Array(n);
    let s = 0x5eed1234;
    const rnd = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) + 0.5) / 4294967296; };
    const gauss = () => Math.sqrt(-2 * Math.log(rnd())) * Math.cos(2 * Math.PI * rnd());
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const o = j * N + i, fx = i < N / 2 ? i : i - N, fz = j < N / 2 ? j : j - N;
      const kx = (2 * Math.PI * fx) / L, kz = (2 * Math.PI * fz) / L, k = Math.hypot(kx, kz);
      this.kx[o] = kx; this.kz[o] = kz; this.w[o] = Math.sqrt(g * k);
      if (k < 1e-6) continue;
      const c = (kx * dir[0] + kz * dir[1]) / k;
      // Phillips: k⁻⁴ e^(-1/(k Lw)²), mostly along the wind (cos²), the shortest waves damped.
      const P = Math.exp(-1 / (k * Lw) ** 2) / k ** 4 * c * c * (c < 0 ? 0.25 : 1) * Math.exp(-((k * 0.05) ** 2));
      const a = Math.sqrt(P / 2);
      this.h0r[o] = gauss() * a; this.h0i[o] = gauss() * a;
    }
    this.re = new Float32Array(n); this.im = new Float32Array(n);
    this.px = new Uint8Array(n * 4);
    this.scale = 0;   // normalises the slopes (set on the first step: RMS slope ~0.13, a fresh breeze)
  }
  fft(re, im, off, stride) {   // in-place inverse FFT of N values (radix 2)
    const N = this.N;
    for (let i = 1, j = 0; i < N; i++) {
      let bit = N >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { const a = off + i * stride, b = off + j * stride; let t = re[a]; re[a] = re[b]; re[b] = t; t = im[a]; im[a] = im[b]; im[b] = t; }
    }
    for (let len = 2; len <= N; len <<= 1) {
      const ang = (2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < N; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < len / 2; k++) {
          const a = off + (i + k) * stride, b = off + (i + k + len / 2) * stride;
          const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
          re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
          const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
        }
      }
    }
  }
  step(t) {
    const N = this.N, { re, im, kx, kz, w, h0r, h0i } = this;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const o = j * N + i, m = ((N - j) % N) * N + ((N - i) % N);
      const c = Math.cos(w[o] * t), s = Math.sin(w[o] * t);
      // H = h0(k) e^(iωt) + conj(h0(-k)) e^(-iωt): real heights.
      const Hr = h0r[o] * c - h0i[o] * s + h0r[m] * c - h0i[m] * s;
      const Hi = h0r[o] * s + h0i[o] * c - h0r[m] * s - h0i[m] * c;
      // Both slopes at once: i kx H + i (i kz H) transforms to sx + i sz.
      re[o] = -kx[o] * Hi - kz[o] * Hr; im[o] = kx[o] * Hr - kz[o] * Hi;
    }
    for (let j = 0; j < N; j++) this.fft(re, im, j * N, 1);
    for (let i = 0; i < N; i++) this.fft(re, im, i, N);
    if (!this.scale) {
      let s2 = 0;
      for (let o = 0; o < N * N; o++) s2 += re[o] * re[o] + im[o] * im[o];
      this.scale = 0.13 / Math.sqrt(s2 / (N * N) / 2 || 1);
    }
    // (stored as 0.5 + slope, slopes within ±0.5)
    for (let o = 0; o < N * N; o++) {
      this.px[o * 4] = Math.max(0, Math.min(255, Math.round((0.5 + re[o] * this.scale) * 255)));
      this.px[o * 4 + 1] = Math.max(0, Math.min(255, Math.round((0.5 + im[o] * this.scale) * 255)));
      this.px[o * 4 + 3] = 255;
    }
    return this.px;
  }
}

function seeded(id) {
  let x = Math.sin(id * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

// Appearance for any body: a named look, or one derived from its kind, mass and colour.
function lookFor(b) {
  const named = LOOKS[b.name];
  const r = seeded(b.id);
  const base = b.color ? b.color.map((v) => v / 255) : [0.6, 0.6, 0.6];
  const band = b.band ? b.band.map((v) => v / 255) : base.map((v) => v * 0.75);
  if (b.kind === 'star') return { kind: 2, spots: b.temp < 6500 ? 1 : 0, tilt: 0, day: 600, ...(named || {}) };
  if (b.kind === 'wd' || b.kind === 'ns') return { kind: 3, tilt: 0, day: b.kind === 'ns' ? 0.001 : 2 };
  if (b.kind === 'bh') return { kind: 4, tilt: 0, day: 1 };
  // Real moons and dwarf planets carry their own spin and tilt (locked moons turn once per orbit).
  const own = (l) => { if (b.dayH && !(named && named.day)) l.day = b.dayH; if (b.tiltDeg !== undefined && !(named && named.tilt !== undefined)) l.tilt = b.tiltDeg; return l; };
  if (named) return own({ kind: 0, colA: base, colB: band, colC: [0.96, 0.97, 1], ...named });
  const me = b.m / EARTH_MASS;
  if (b.kind === 'gas') {
    const ice = me < 50;
    return { kind: 1, colA: base, colB: band, bands: ice ? 3 + r * 2 : 6 + r * 4, atmo: base, atmoK: 0.25, tilt: r * 30, day: 10 + r * 8 };
  }
  // Rocky worlds.
  const look = { kind: 0, colA: base, colB: base.map((v) => v * 0.7), colC: [0.96, 0.97, 1], tilt: r * 30, day: 8 + r * 40 };
  // (Moons big enough to have pulled themselves round, like Mimas, are cratered spheres, not lumpy rocks.)
  if (b.round && me < 1e-4) Object.assign(look, { craters: 1, colB: base.map((v) => v * 0.78) });
  else if (b.comet || me < 1e-4 || b.name.startsWith('Planetesimal')) Object.assign(look, { lumpy: b.comet ? 0.45 : 0.3, craters: 0.8, colA: base.map((v) => v * 0.8), day: 6 + r * 20 });
  else if (me < 0.05) look.craters = 1;
  else if (b.atmo) Object.assign(look, { ocean: 0.55 + r * 0.2, cloud: 0.5, atmo: b.atmo.map((v) => v / 255), atmoK: 0.8, colA: [0.45, 0.38, 0.28], colB: [0.6, 0.52, 0.4] });
  else if (me > 0.3) Object.assign(look, { ocean: r > 0.5 ? r * 0.6 : 0, craters: 0.25, atmoK: 0.3, atmo: [0.7, 0.75, 0.85] });
  else look.craters = 0.6;
  return own(look);
}

// How long tides would take to stop a body's own spin relative to its orbit (years): t ≈ 6 a⁶ R μ / (m M²) ×
// 10¹⁰ yr, SI units, rigidity μ = 3×10¹⁰ Pa (Gladman et al. 1996, Icarus 122, 166, from Peale's formula with
// Q = 100 and an initial spin of a 12-hour day). The tide the partner raises on the body lags behind as it
// turns; the partner's pull on that tilted bulge brakes the spin until the bulge stays put: one face toward it.
function lockTime(b, par) {
  const AU = 1.495978707e11, MSUN = 1.98847e30;
  const a = Math.hypot(par.x - b.x, par.y - b.y, par.z - b.z) * AU, R = b.r * AU, m = b.m * MSUN, M = par.m * MSUN;
  return (6 * a ** 6 * R * 3e10) / (m * M * M) * 1e10;
}

// ---------- tiny matrix helpers (column-major, as WebGL expects) ----------

function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
}

// Rotation for axial tilt (about x) then spin (about the body's own pole), as a column-major mat3.
function tiltSpin(tilt, ang) {
  const ct = Math.cos(tilt), st = Math.sin(tilt), ca = Math.cos(ang), sa = Math.sin(ang);
  // Rx(tilt) * Ry(ang), row-major:
  // [ ca,      0,    sa     ]
  // [ st*sa,   ct,  -st*ca  ]
  // [-ct*sa,   st,   ct*ca  ]
  // (Double precision: the surface view places the eye a planet's radius out along this; single precision's
  // error, ~3e-8, is 15 cm on Venus, and the ground bobbed by that from frame to frame.)
  return new Float64Array([ca, st * sa, -ct * sa, 0, ct, st, sa, -st * ca, ct * ca]);
}

// Vegetation colour. Early life is purple (retinal-based phototrophs may have dominated before
// chlorophyll: DasSarma & Schwieterman 2018, Int. J. Astrobiology 20, 241). Mature plant life is tuned to
// its star's light (Kiang et al. 2007, Astrobiology 7, 252): blue-green under hot F stars, green under the
// Sun, olive-orange under K stars, near-black under red dwarfs, absorbing as much of the dim light as possible.
function vegetationColor(b, lights) {
  const T = lights && lights.primary && lights.primary.s ? lights.primary.s.temp || 5772 : 5772;
  const stops = [[3000, [0.06, 0.04, 0.07]], [3900, [0.1, 0.07, 0.07]], [4800, [0.28, 0.26, 0.09]], [5772, [0.13, 0.3, 0.11]], [6600, [0.08, 0.27, 0.3]]];
  let mature = stops[stops.length - 1][1];
  for (let i = 1; i < stops.length; i++) {
    if (T <= stops[i][0]) {
      const [t0, a] = stops[i - 1], [t1, c] = stops[i], k = Math.max(0, (T - t0) / (t1 - t0));
      mature = [a[0] + (c[0] - a[0]) * k, a[1] + (c[1] - a[1]) * k, a[2] + (c[2] - a[2]) * k];
      break;
    }
  }
  const age = b.lifeAge ?? 4e9;
  const k = Math.max(0, Math.min(1, (age - 5e8) / 1e9)); // purple for the first ~0.5 Gyr, then shifts
  const purple = [0.34, 0.17, 0.37];
  return [purple[0] + (mature[0] - purple[0]) * k, purple[1] + (mature[1] - purple[1]) * k, purple[2] + (mature[2] - purple[2]) * k];
}

function sphere(seg, rings) {
  const big = (seg + 1) * (rings + 1) > 65535;
  const pos = [], idx = [];
  for (let j = 0; j <= rings; j++) {
    const v = j / rings, th = v * Math.PI;
    for (let i = 0; i <= seg; i++) {
      const ph = (i / seg) * Math.PI * 2;
      pos.push(Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph));
    }
  }
  for (let j = 0; j < rings; j++) for (let i = 0; i < seg; i++) {
    const a = j * (seg + 1) + i, b = a + seg + 1;
    idx.push(a, a + 1, b, b, a + 1, b + 1);
  }
  return { pos: new Float32Array(pos), idx: big ? new Uint32Array(idx) : new Uint16Array(idx), big };
}

const PARTICLE_RGB = {
  [PK.DEBRIS]: c3(150, 120, 96), [PK.HOT]: c3(255, 170, 90), [PK.STAR_BLUE]: c3(150, 180, 255), [PK.STAR_GOLD]: c3(255, 214, 160),
  [PK.ICE]: c3(214, 206, 190), [PK.DUST]: c3(150, 126, 100), [PK.GAS]: c3(214, 184, 146), [PK.ROCK]: c3(120, 112, 104),
  // Supernova and nebula materials, coloured like their emission lines: hydrogen-alpha red,
  // oxygen teal, silicon/sulfur gold, iron white-hot.
  [PK.SN_H]: c3(255, 70, 90), [PK.SN_O]: c3(70, 230, 210), [PK.SN_SI]: c3(255, 200, 80), [PK.SN_FE]: c3(230, 225, 255),
};
const GLOW_KINDS = new Set([PK.HOT, PK.STAR_BLUE, PK.STAR_GOLD, PK.SN_H, PK.SN_O, PK.SN_SI, PK.SN_FE]);

export class Renderer3D {
  static supported() {
    try {
      const c = document.createElement('canvas');
      return !!c.getContext('webgl2');
    } catch { return false; }
  }

  // gl: a WebGL 2 context, or the WebGPU emulation of one (js/glgpu.js); by default a WebGL 2 context on canvas.
  constructor(canvas, world, cam, settings, glIn = null) {
    this.canvas = canvas;
    this.world = world;
    this.cam = cam;
    this.settings = settings;
    // Antialiasing is done in our own multisampled HDR buffer, so the default framebuffer doesn't need it.
    const gl = glIn || canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 unavailable');
    this.webgpu = !!glIn;
    this.gl = gl;
    this.looks = new Map();
    this.spin = new Map();
    this.mapTex = new Map(); // body -> surface-map texture
    this.dpr = 1;
    this.lost = false;
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.lost = true; });
    // On restore every GL object is gone: rebuild, and drop the caches holding the old ones (the context
    // generation `gen` marks textures cached on shared objects such as shape and height maps). It is unique
    // across renderers too: switching between WebGL and WebGPU makes a new one, which must not pick up
    // the other's textures.
    this.gen = ++contextGen;
    canvas.addEventListener('webglcontextrestored', () => {
      this.gen = ++contextGen;
      this.mapTex = new Map(); this.dTex = null; this.nightTex = null; this.tMesh = null; this.rMesh = null; this.gMesh = null; this.shTarget = null; this.gMats = null; this.sea = null; this.seaT = null; this.post = null; this.genMaps = null; this.noiseTex = null; this.cloudRTs = null; this.skyLayer = null; this.nebRT = null; this.galRT = null; this.galSet = null;
      this.init(); this.lost = false;
    });
    this.init();
  }

  init() {
    const gl = this.gl;
    this.pBody = this.program(BODY_VS, BODY_FS);
    this.pAtmo = this.program(BODY_VS, ATMO_FS);
    this.pRim = this.program(BODY_VS, RIM_FS);
    this.pCloud = this.program(BODY_VS, CLOUD_FS);
    this.pSprite = this.program(SPRITE_VS, SPRITE_FS);
    this.pDisk = this.program(DISK_VS, DISK_FS);
    this.pPoints = this.program(POINTS_VS, POINTS_FS);
    this.pLines = this.program(LINES_VS, LINES_FS);
    this.pSky = this.program(SKY_VS, SKY_FS);
    this.pGalGlow = this.program(GALGLOW_VS, GALGLOW_FS);
    this.pGalComp = this.program(FULL_VS, GALCOMP_FS);
    // Level-of-detail spheres; the last (very fine) one is only used for the ground in the surface view.
    this.spheres = [sphere(16, 12), sphere(40, 28), sphere(96, 64), sphere(400, 260)].map((g) => {
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      const vb = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vb);
      gl.bufferData(gl.ARRAY_BUFFER, g.pos, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      const ib = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, g.idx, gl.STATIC_DRAW);
      gl.bindVertexArray(null);
      return { vao, n: g.idx.length, type: g.big ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT };
    });
    this.quad = gl.createVertexArray();
    gl.bindVertexArray(this.quad);
    const qb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, qb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.dyn = this.dynamicSet(); // particles
    this.dynGlow = this.dynamicSet();
    this.dynLines = this.dynamicSet();
    this.sky = this.makeSky();
    this.pMilky = this.program(FULL_VS, MILKYWAY_FS);
    this.pDown = this.program(FULL_VS, DOWN_FS);
    this.pUp = this.program(FULL_VS, UP_FS);
    this.pComp = this.program(FULL_VS, COMPOSITE_FS);
    this.pPixel = this.program(FULL_VS, PIXEL_FS);
    this.pSurfSky = this.program(FULL_VS, SURFACE_SKY_FS);
    this.pTerrain = this.program(TERRAIN_VS, TERRAIN_FS);
    this.pRing = this.program(DISK_VS, RING_FS);
    this.pField = this.program(FULL_VS, TEMP_FIELD_FS);
    this.pGen = this.program(FULL_VS, GEN_FS);
    this.pSurfCloud = this.program(FULL_VS, SURFACE_CLOUD_FS);
    this.pWeather = this.program(FULL_VS, WEATHER_FS);
    this.pNebula = this.program(FULL_VS, NEBULA_FS);
    this.pBlit = this.program(FULL_VS, BLIT_FS);
    this.hdr = !!gl.getExtension('EXT_color_buffer_float');
    this.post = null;
  }

  // ---------- off-screen buffers ----------

  makeTarget(w, h) {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    if (this.hdr) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { tex, fbo, w, h };
  }

  // Multisampled HDR scene buffer, its resolved copy, and the bloom chain. Falls back to 8-bit
  // colour if the device can't render to half-float.
  buildPost(W, H) {
    const gl = this.gl;
    this.freePost();
    if (this.samples === undefined) this.samples = 4;
    const samples = Math.min(this.samples, gl.getParameter(gl.MAX_SAMPLES) || 0);
    for (const tryHdr of this.hdr ? [true, false] : [false]) {
      this.hdr = tryHdr;
      const ms = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, ms);
      const color = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, color);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, tryHdr ? gl.RGBA16F : gl.RGBA8, W, H);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, color);
      const depth = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH_COMPONENT24, W, H);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        gl.deleteFramebuffer(ms); gl.deleteRenderbuffer(color); gl.deleteRenderbuffer(depth);
        continue;
      }
      const scene = this.makeTarget(W, H);
      const down = [], up = [];
      let w = W, h = H;
      for (let i = 0; i < 6; i++) {
        w = Math.max(1, w >> 1); h = Math.max(1, h >> 1);
        down.push(this.makeTarget(w, h));
        up.push(this.makeTarget(w, h));
      }
      this.post = { W, H, ms, color, depth, scene, down, up };
      break;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  freePost() {
    const gl = this.gl, p = this.post;
    if (!p) return;
    gl.deleteFramebuffer(p.ms); gl.deleteRenderbuffer(p.color); gl.deleteRenderbuffer(p.depth);
    for (const t of [p.scene, ...p.down, ...p.up]) { gl.deleteFramebuffer(t.fbo); gl.deleteTexture(t.tex); }
    this.post = null;
  }

  fullscreen(prog, target, w, h) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target);
    gl.viewport(0, 0, w, h);
    gl.useProgram(prog.p);
    gl.bindVertexArray(this.quad);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  bindTex(unit, tex, loc) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(loc, unit);
  }

  // Resolve the multisampled scene, bloom it, and tone-map onto the screen.
  finish() {
    const gl = this.gl, p = this.post;
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.depthMask(false);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, p.ms);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, p.scene.fbo);
    gl.blitFramebuffer(0, 0, p.W, p.H, 0, 0, p.W, p.H, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    const bloom = this.settings.bloom !== false;
    if (bloom) {
      let src = p.scene;
      p.down.forEach((t, i) => {
        gl.useProgram(this.pDown.p);
        this.bindTex(0, src.tex, this.pDown.u.uTex);
        gl.uniform2f(this.pDown.u.uTexel, 0.5 / src.w, 0.5 / src.h);
        gl.uniform1i(this.pDown.u.uFirst, i === 0 ? 1 : 0);
        gl.uniform1f(this.pDown.u.uThreshold, this.hdr ? 0.95 : 0.8);
        this.fullscreen(this.pDown, t.fbo, t.w, t.h);
        src = t;
      });
      let low = p.down[p.down.length - 1];
      for (let i = p.down.length - 2; i >= 0; i--) {
        const dst = p.up[i];
        gl.useProgram(this.pUp.p);
        this.bindTex(0, low.tex, this.pUp.u.uLow);
        this.bindTex(1, p.down[i].tex, this.pUp.u.uHigh);
        gl.uniform2f(this.pUp.u.uTexel, 1 / low.w, 1 / low.h);
        this.fullscreen(this.pUp, dst.fbo, dst.w, dst.h);
        low = dst;
      }
    }
    if (this.pixelScale > 1) {
      const px = this.pPixel;
      gl.useProgram(px.p);
      this.bindTex(0, p.scene.tex, px.u.uScene);
      this.bindTex(1, p.up[0].tex, px.u.uBloom);
      gl.uniform2f(px.u.uLow, p.W, p.H);
      gl.uniform1f(px.u.uScale, this.pixelScale);
      gl.uniform1f(px.u.uBloomK, bloom ? 0.4 : 0);
      gl.uniform3fv(px.u.uWB, this.whiteBalance());
      this.toneUniforms(px.u);
      this.setFlare(px.u);
      gl.uniform1f(px.u.uLevels, 5);
      this.fullscreen(px, null, this.canvas.width, this.canvas.height);
    } else {
      gl.useProgram(this.pComp.p);
      this.bindTex(0, p.scene.tex, this.pComp.u.uScene);
      this.bindTex(1, p.up[0].tex, this.pComp.u.uBloom);
      gl.uniform1f(this.pComp.u.uBloomK, bloom ? (this.hdr ? 0.32 : 0.22) : 0);
      gl.uniform3fv(this.pComp.u.uWB, this.whiteBalance());
      this.toneUniforms(this.pComp.u);
      // (sharpening while the resolution is reduced to keep the frame rate: AMD's contrast-adaptive sharpening)
      gl.uniform1f(this.pComp.u.uSharp, this.quality < 1 ? Math.min(1, (1 - this.quality) * 2.5) : 0);
      this.setFlare(this.pComp.u);
      this.fullscreen(this.pComp, null, p.W, p.H);
    }
    gl.depthMask(true);
  }

  // Orientation (object -> world) the 3D view gives a body: axial tilt and current spin.
  bodyRotation(b) {
    const l = this.look(b), s = this.spin.get(b);
    return tiltSpin((l.tilt || 0) * D2R, s ? s.ang : 0);
  }

  // Atmospheric sky over the surface view, blended over the stars by its brightness.
  // veil: drawn again to composite the planets and moons in the sky (drawn on their own into skyLayer) seen
  // through the air: dimmed by it, the air's light in front; with this frame's clouds.
  drawSurfaceSky(sv, veil = false) {
    const gl = this.gl, p = this.pSurfSky, u = p.u, cam = this.cam, b = sv.body, th = b.th;
    const optics = atmosphereOptics(b);
    const t = Math.tan(cam.fov / 2);
    // Under a thick haze (Venus, Titan) the sky is a uniform overcast: no separate cloud deck.
    const cover = th && !(optics && optics.tauM > 3) ? th.cloud : 0;
    if (!veil) this.updateWeather(sv, performance.now());
    // Cirrus: with the weather clouds; on dry worlds with thin air a faint veil of ice cloud (Mars's water-ice
    // cirrus, seen by the rovers, ~10-30 km up).
    const wetAir = th && th.liquid > 0.005;
    this.cirrus = optics && !(optics.tauM > 3) ? (cover > 0.001 ? Math.min(1, cover * 1.6) : !wetAir && optics.P > 0.002 ? 0.25 : 0) : 0;
    // (Under a thick atmosphere the blanket deck: closed, its base in waves; see SURFACE_CLOUD_FS.)
    const blanket = optics && optics.tauM > 3;
    const clouds = veil ? this.cloudsNow : (cover > 0.001 || this.cirrus > 0 || blanket) && this.drawSurfaceClouds(sv, optics, blanket ? 1 : cover, t);
    this.cloudsNow = clouds;
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // shader output is premultiplied
    gl.useProgram(p.p);
    gl.uniformMatrix3fv(u.uView, false, this.V);
    gl.uniform2f(u.uTan, t * (this.canvas.width / this.canvas.height), t);
    gl.uniform3fv(u.uUp, sv.up);
    gl.uniform3fv(u.uSun, sv.sun);
    gl.uniform1f(u.uAir, optics ? 1 : 0);
    if (optics) setOpticsUniforms(gl, u, optics, 20);
    // The eye adapts: dim, hazy worlds are shown brighter than their true daylight, but not all the way.
    // Also opens up a little at dusk.
    const el = sv.elev || 0;
    const dusk = 1 + (1 / Math.sqrt(0.3 + 0.7 * Math.max(0, Math.sin(el))) - 1) * Math.max(0, Math.min(1, (el + 0.2) / 0.15));
    // (The eye adapts as an eclipse dims the day.)
    gl.uniform1f(u.uExpo, (22 * dusk) / Math.pow(Math.max(1e-4, Math.min(1, (optics ? optics.day : 1) * sv.sunPower)), 0.6));
    gl.uniform4f(u.uOccS, sv.occ ? sv.occ.dir[0] : 0, sv.occ ? sv.occ.dir[1] : 0, sv.occ ? sv.occ.dir[2] : 0, sv.occ ? sv.occ.ang : 0);
    gl.uniform1f(u.uSunPower, sv.sunPower);
    gl.uniform1f(u.uSunAng, sv.sunAng || 0.00465);
    gl.uniform3fv(u.uSunCol, tempToRGB(sv.sunTemp || 5772).map((v) => v / 255));
    gl.uniform1f(u.uCloud, cover);
    gl.uniform1f(u.uCloudBuf, clouds ? 1 : 0);
    if (clouds) this.bindTex(13, this.cloudRT.tex, u.uClouds);
    gl.uniform1f(u.uVeil, veil ? 1 : 0);
    if (veil) this.bindTex(12, this.skyLayer.tex, u.uBodies);
    const fl = this.weather && this.weather.flashI > 0 ? this.weather : null;
    gl.uniform4f(u.uFlash, fl ? fl.dir[0] : 0, fl ? fl.dir[1] : 1, fl ? fl.dir[2] : 0, fl ? fl.flashI : 0);
    gl.uniform2f(u.uRes, this.sceneW, this.sceneH);
    gl.uniform3fv(u.uCloudCol, this.look(b).colC || [0.95, 0.96, 1]);
    gl.uniform1f(u.uTime, performance.now() / 1000);
    gl.uniform3fv(u.uNorth, sv.north || [0, 0, 1]);
    // Venus-like overcast (sulphuric deck ~48 km up; features of ~120 km, about the smallest the ~50 km of
    // scattering air below leaves visible); none elsewhere.
    const Rkm = b.r * 1.495978707e8;
    gl.uniform3f(u.uDeck, optics && optics.kind === 'sulphuric' ? 0.5 : 0, 48 / Rkm, 120 / Rkm);
    const ring = this.ringInfo && this.ringInfo.get(b);
    if (ring) {
      gl.uniform3fv(u.uRingN, ring.n);
      gl.uniform2f(u.uRingR, ring.rin / b.r, ring.rout / b.r);
      gl.uniform1fv(u.uRingProf, ring.prof);
      gl.uniform3fv(u.uRingCol, ring.ice ? [0.86, 0.8, 0.7] : [0.5, 0.45, 0.4]);
    } else gl.uniform3f(u.uRingN, 0, 0, 0);
    gl.bindVertexArray(this.quad);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.disable(gl.BLEND);
    gl.activeTexture(gl.TEXTURE0);
  }

  // Lens flare (COMPOSITE_FS lensFlare): where the brightest star is on screen, and how strong its flare is.
  // Strength by how bright the star looks from here (the Sun from Earth: 1; from Neptune: ~0.2), off-screen
  // stars none. Whether it is hidden is found by the shader from the scene itself.
  setFlare(u) {
    const S = this.surface ? this.surface.star : this.lumList && this.lumList[0];
    if (this.settings.flare === false || !S || !S.alive) { gl0(this.gl, u); return; }
    const vp = this.viewOf(S.x - this.ex, S.y - this.ey, S.z - this.ez);
    if (vp[2] >= 0) { gl0(this.gl, u); return; }
    const P = this.P, x = P[0] * vp[0] / -vp[2], y = P[5] * vp[1] / -vp[2];
    if (Math.abs(x) > 1.3 || Math.abs(y) > 1.3) { gl0(this.gl, u); return; }
    const d2 = vp[0] * vp[0] + vp[1] * vp[1] + vp[2] * vp[2];
    let k = Math.min(1.2, Math.pow(Math.max(S.lum, 1e-6) / Math.max(d2, 1e-9), 0.25));
    if (this.surface) k *= Math.sqrt(this.surface.sunPower ?? 1);   // (an eclipse leaves a smaller glare)
    // In space: hidden by any body between us and the star (its disc over the star's centre).
    if (!this.surface) {
      const sd = Math.sqrt(d2), ux = (S.x - this.ex) / sd, uy = (S.y - this.ey) / sd, uz = (S.z - this.ez) / sd;
      for (const b of this.world.bodies) {
        if (b === S || !(b.r > 0) || isLuminous(b)) continue;
        const bx = b.x - this.ex, by = b.y - this.ey, bz = b.z - this.ez, t = bx * ux + by * uy + bz * uz;
        if (t <= 0 || t >= sd) continue;
        const px = bx - ux * t, py = by - uy * t, pz = bz - uz * t;
        if (px * px + py * py + pz * pz < b.r * b.r) { k = 0; break; }
      }
    }
    this.gl.uniform1f(u.uFlareThr, this.surface ? 2.5 : 0.6);
    if (!this.surface) k *= 0.3;   // (against black space a flare stands out far more than against a bright sky)
    this.gl.uniform4f(u.uFlare, x * 0.5 + 0.5, y * 0.5 + 0.5, k, this.canvas.width / this.canvas.height);
    this.gl.uniform3fv(u.uFlareCol, tempToRGB(S.temp || 5772).map((v) => v / 255));
  }

  // The band of light shown: 0 visible, 1 infrared, 2 ultraviolet, 3 X-ray (Settings, Light seen).
  spectrumMode() { return { ir: 1, uv: 2, xray: 3 }[this.settings.spectrum] || 0; }

  // White balance on the ground: the eye (or a camera) partly adapts to the colour of the light, so a sunset
  // reads orange-gold rather than the deep red the light really is (at 1° up, red is ~4x green). A fifth-power
  // root of the sunlight's colour, at most 1.6x on a channel, scaled to keep the brightness. In space: none.
  whiteBalance() {
    const g = this.surface && this.gLight && this.gLight.g;
    if (!g) return [1, 1, 1];
    // Relative to the light with the star overhead: a world's own colour of light (Mars's dusty, ruddy day)
    // is kept; only the extra reddening of a low sun is adapted to.
    const gl0 = this.gLight;
    if (!gl0.zenT) gl0.zenT = gl0.optics ? groundLight(gl0.optics, 1, 1).sunT : [1, 1, 1];
    const T = g.sunT.map((v, i) => v / Math.max(gl0.zenT[i], 1e-6)), m = Math.max(T[0], T[1], T[2]);
    if (!(m > 1e-6)) return [1, 1, 1];
    const wb = T.map((v) => Math.min(1.6, Math.pow(Math.max(v / m, 1e-4), -0.2)));
    const y = 0.3 * wb[0] + 0.55 * wb[1] + 0.15 * wb[2];
    return wb.map((v) => v / y);
  }

  // How stormy it is where you stand: rain from thick cloud on a world with liquid water and real air (snow
  // below freezing), and in warm, heavy rain, lightning every few to ~20 s, with thunder after the light (sound
  // travels ~3 s per km). Updated every frame from the climate (render3d's weather; the sky and the ground
  // read it too).
  updateWeather(sv, now) {
    const b = sv.body, th = b.th, optics = atmosphereOptics(b);
    const P = optics ? optics.P : 0, cover = th && !(optics && optics.tauM > 3) ? th.cloud : 0;
    const wet = th && th.liquid > 0.005 && P > 0.05;
    const T = sv.localT || (th ? th.Ts : 0);
    const rain = wet ? Math.max(0, Math.min(1, (cover - 0.55) / 0.3)) : 0;
    const w = (this.weather ||= { next: now + 4000, flash: null, flashI: 0, dir: [0, 1, 0] });
    w.rain = rain; w.snow = T < 272;
    w.flashI = 0;
    if (rain > 0.6 && T > 283) {
      if (!w.flash && now > w.next) {
        // Its top where the cloud base (~2 km up) is, seen from 1 to 10 km away.
        const km = 1 + Math.random() * 9, az = Math.random() * Math.PI * 2, el = Math.atan2(2, km);
        const n = sv.up, N = sv.north || [0, 0, 1];
        const E = [N[1] * n[2] - N[2] * n[1], N[2] * n[0] - N[0] * n[2], N[0] * n[1] - N[1] * n[0]];
        const c = Math.cos(el);
        w.dir = [0, 1, 2].map((i) => n[i] * Math.sin(el) + c * (Math.cos(az) * N[i] + Math.sin(az) * E[i]));
        w.flash = { t0: now, km };
        w.next = now + 3000 + Math.random() * 15000 / rain;
        const a = typeof window !== 'undefined' && window.app ? window.app.audio : null;
        if (a) setTimeout(() => a.rumble(Math.random() < 0.5 ? 'rumble1' : 'rumble4', 0.7 / Math.sqrt(km), 0.55 + Math.random() * 0.2, 6), km * 2900);
      }
    }
    if (w.flash) {
      const t = (now - w.flash.t0) / 1000;
      // A stroke and its return strokes: two or three flickers within half a second.
      w.flashI = Math.exp(-(((t - 0.02) / 0.035) ** 2)) + 0.75 * Math.exp(-(((t - 0.13) / 0.03) ** 2)) + 0.5 * Math.exp(-(((t - 0.3) / 0.05) ** 2));
      if (t > 0.6) w.flash = null;
    }
    return w;
  }

  // Rain, snow and lightning over the surface view (WEATHER_FS).
  drawWeather(sv, now) {
    const w = this.weather;
    if (!w) return;
    if (!(w.rain > 0.01) && !(w.flashI > 0.01)) return;
    const gl = this.gl, p = this.pWeather, u = p.u, t = Math.tan(this.cam.fov / 2);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(p.p);
    gl.uniformMatrix3fv(u.uView, false, this.V);
    gl.uniform2f(u.uTan, t * (this.canvas.width / this.canvas.height), t);
    gl.uniform2f(u.uRes, this.sceneW, this.sceneH);
    gl.uniform3fv(u.uUp, sv.up);
    gl.uniform3fv(u.uNorth, sv.north || [0, 0, 1]);
    gl.uniform1f(u.uTime, now / 1000);
    gl.uniform1f(u.uRain, w.rain);
    gl.uniform1f(u.uSnow, w.snow ? 1 : 0);
    const g = this.gLight && this.gLight.g;
    const sky = g ? g.zen.map((v, i) => 0.6 * v + 0.4 * g.horAnti[i]) : [0.2, 0.2, 0.22];
    gl.uniform3fv(u.uLightC, sky.map((v) => Math.max(v, 0.03) + 0.4 * w.flashI));
    gl.uniform4f(u.uFlash, w.dir[0], w.dir[1], w.dir[2], w.flashI);
    gl.bindVertexArray(this.quad);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST);
  }

  // The planets and moons in the sky, seen from the ground, are drawn into their own buffer (with its own
  // depth): their light in rgb, and alpha 1 where a solid body is (glows add light but leave alpha alone).
  bindSkyLayer() {
    const gl = this.gl, W = this.sceneW, H = this.sceneH;
    let L = this.skyLayer;
    if (!L || L.w !== W || L.h !== H) {
      if (L) { gl.deleteTexture(L.tex); gl.deleteFramebuffer(L.fbo); gl.deleteRenderbuffer(L.depth); }
      L = this.makeTarget(W, H);
      L.depth = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, L.depth);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, W, H);
      gl.bindFramebuffer(gl.FRAMEBUFFER, L.fbo);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, L.depth);
      this.skyLayer = L;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, L.fbo);
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 0);
    gl.clearDepth(1);
    gl.colorMask(true, true, true, true);
    gl.depthMask(true);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  }

  // Random values for SURFACE_CLOUD_FS's texture noise: R at random, G = R shifted by (-37, -239), wrapping.
  cloudNoise() {
    if (this.noiseTex) return this.noiseTex;
    const gl = this.gl, N = 256, R = new Uint8Array(N * N), px = new Uint8Array(N * N * 4);
    let x = 0x2545f491;
    for (let i = 0; i < R.length; i++) { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; R[i] = (x >>> 0) & 255; }
    for (let y = 0; y < N; y++) for (let i = 0; i < N; i++) {
      const o = (y * N + i) * 4;
      px[o] = R[y * N + i];
      px[o + 1] = R[(((y - 239) % N + N) % N) * N + (((i - 37) % N + N) % N)];
      px[o + 3] = 255;
    }
    this.noiseTex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.noiseTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, N, N, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    return this.noiseTex;
  }

  // Nebulae (NEBULA_FS): ray-marched at quarter resolution into their own buffer (they are smooth; the noise
  // is the costly part), then laid over the target behind everything else: anything in front of a nebula
  // hides it, and its dust dims the stars behind.
  drawNebulae(world, fbo, W, H) {
    const gl = this.gl, cam = this.cam;
    const list = [];
    for (const b of world.bodies) {
      if (b.kind !== 'nebula' || !b.alive) continue;
      const vp = this.viewOf(...this.rel(b));
      if (-vp[2] < -b.r) continue;                                    // wholly behind the camera
      list.push([b, vp]);
    }
    // Supernova remnants: expanding freely at the ejecta's speed for ~200 years, then slowed as the shell sweeps up
    // more gas than it threw out (the Sedov-Taylor phase, radius ~ t^0.4); brightening over the first decades as
    // the reverse shock heats the ejecta (Cas A, ~350 years old, is ~5 light-years across), fading over ~10^4 years.
    for (const rm of world.remnants || []) {
      const age = world.t - rm.t0;
      if (!(age > 0)) continue;
      const tST = 200, r = age < tST ? rm.v * age : rm.v * tST * Math.pow(age / tST, 0.4);
      const glow = (0.35 + 0.65 * Math.min(1, age / 30)) * Math.exp(-age / 3e4);
      const pseudo = { x: rm.x, y: rm.y, z: rm.z, r, id: Math.round(rm.seed * 1000), glow, rem: rm.type };
      const vp = this.viewOf(...this.rel(pseudo));
      if (-vp[2] < -r) continue;
      list.push([pseudo, vp]);
    }
    if (!list.length) return;
    // (Quarter resolution; half for a remnant, whose knots and filaments are fine.)
    const div = list.some((e) => e[0].rem) ? 2 : 4;
    const w = Math.max(16, Math.ceil(W / div)), h = Math.max(16, Math.ceil(H / div));
    if (!this.nebRT || this.nebRT.w !== w || this.nebRT.h !== h) {
      if (this.nebRT) { gl.deleteTexture(this.nebRT.tex); gl.deleteFramebuffer(this.nebRT.fbo); }
      this.nebRT = this.makeTarget(w, h);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.nebRT.fbo);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const p = this.pNebula, u = p.u, t = Math.tan(cam.fov / 2);
    gl.useProgram(p.p);
    gl.uniformMatrix3fv(u.uView, false, this.V);
    gl.uniform2f(u.uTan, t * (this.canvas.width / this.canvas.height), t);
    gl.uniform1i(u.uBand, this.spectrumMode());
    // Farthest first, so nearer nebulae lie over farther ones.
    list.sort((a, c) => a[1][2] - c[1][2]);
    for (const [b, vp] of list) {
      gl.uniform3fv(u.uC, vp);
      gl.uniform1f(u.uR, b.r);
      gl.uniform1f(u.uSeed, (b.id % 97) * 0.13);
      gl.uniform1f(u.uBright, b.glow === undefined ? 1 : b.glow);
      gl.uniform1i(u.uRem, b.rem || 0);
      gl.bindVertexArray(this.quad);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, W, H);
    gl.useProgram(this.pBlit.p);
    this.bindTex(0, this.nebRT.tex, this.pBlit.u.uTex);
    gl.bindVertexArray(this.quad);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.disable(gl.BLEND);
  }

  // Galaxies' diffuse light and dust (GALGLOW_VS): the star particles splatted soft and wide into a
  // quarter-resolution buffer, composited over the scene. Only when there are galaxy stars in the world.
  drawGalaxyGlow() {
    const gl = this.gl, world = this.world, cam = this.cam;
    let n = 0;
    for (let i = 0; i < world.np; i++) if (world.pk[i] === PK.STAR_GOLD || world.pk[i] === PK.STAR_BLUE) n++;
    if (!n || this.surface) return;
    const set = (this.galSet ||= this.dynamicSet());
    this.ensure(set, n);
    const tx = cam.tx + cam.ox, ty = cam.ty + cam.oy, tz = cam.tz + cam.oz;
    let k = 0;
    for (let i = 0; i < world.np; i++) {
      const kind = world.pk[i];
      if (kind !== PK.STAR_GOLD && kind !== PK.STAR_BLUE) continue;
      set.pos[k * 3] = world.px[i] - tx; set.pos[k * 3 + 1] = world.py[i] - ty; set.pos[k * 3 + 2] = world.pz[i] - tz;
      const c = PARTICLE_RGB[kind], g = kind === PK.STAR_GOLD ? 0.05 : 0.05;
      set.col[k * 3] = c[0] * g; set.col[k * 3 + 1] = c[1] * g; set.col[k * 3 + 2] = c[2] * g;
      // (dust in the disc, on a third of its particles, so lanes follow the arms)
      set.shade[k] = kind === PK.STAR_BLUE && world.pid[i] % 3 === 0 ? 0.11 : 0;
      set.size[k] = 0;
      k++;
    }
    set.n = k;
    this.upload(set);
    const W = this.sceneW, H = this.sceneH, w = Math.max(16, Math.ceil(W / 4)), h = Math.max(16, Math.ceil(H / 4));
    if (!this.galRT || this.galRT.w !== w || this.galRT.h !== h) {
      if (this.galRT) { gl.deleteTexture(this.galRT.tex); gl.deleteFramebuffer(this.galRT.fbo); }
      this.galRT = this.makeTarget(w, h);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.galRT.fbo);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    const p = this.pGalGlow, u = p.u;
    gl.useProgram(p.p);
    gl.uniformMatrix4fv(u.uProj, false, this.P);
    gl.uniformMatrix3fv(u.uView, false, this.V);
    gl.uniform1f(u.uF, this.F / 4);
    gl.uniform1f(u.uSize, 0.8 * KPC_AU);
    gl.uniform1f(u.uMaxPx, 160);
    gl.bindVertexArray(set.vao);
    gl.drawArrays(gl.POINTS, 0, set.n);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFB);
    gl.viewport(0, 0, W, H);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.pGalComp.p);
    this.bindTex(0, this.galRT.tex, this.pGalComp.u.uTex);
    gl.bindVertexArray(this.quad);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.enable(gl.DEPTH_TEST);
  }

  // The cloud deck seen from the ground (SURFACE_CLOUD_FS), into a quarter-resolution buffer the sky reads.
  // Base and thickness follow the air's scale height (Earth: 8.5 km, so about 2 to 4.5 km up).
  drawSurfaceClouds(sv, optics, cover, t) {
    const gl = this.gl, p = this.pSurfCloud, u = p.u, b = sv.body;
    // (Half resolution under a closed blanket: no march there, and its wave edges are sharp.)
    const div = optics && optics.tauM > 3 ? 2 : 4;
    const w = Math.max(16, Math.ceil(this.sceneW / div)), h = Math.max(16, Math.ceil(this.sceneH / div));
    // Two buffers in turn: this frame's, and last frame's to blend in.
    if (!this.cloudRTs || this.cloudRTs[0].w !== w || this.cloudRTs[0].h !== h) {
      if (this.cloudRTs) for (const r of this.cloudRTs) { gl.deleteTexture(r.tex); gl.deleteFramebuffer(r.fbo); }
      this.cloudRTs = [this.makeTarget(w, h), this.makeTarget(w, h)];
      this.cloudHist = null;
    }
    this.cloudFrame = (this.cloudFrame || 0) + 1;
    const prev = this.cloudRTs[this.cloudFrame & 1];
    this.cloudRT = this.cloudRTs[(this.cloudFrame + 1) & 1];
    // The planet's orientation (object -> world, column-major) and the view from its frame (V · R).
    const R = this.bodyRotation(b), V = this.V, VB = new Float32Array(9);
    for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) VB[c * 3 + r] = V[r] * R[c * 3] + V[3 + r] * R[c * 3 + 1] + V[6 + r] * R[c * 3 + 2];
    const RT = new Float32Array([R[0], R[3], R[6], R[1], R[4], R[7], R[2], R[5], R[8]]);
    const upB = [0, 1, 2].map((i) => R[i * 3] * sv.up[0] + R[i * 3 + 1] * sv.up[1] + R[i * 3 + 2] * sv.up[2]);
    // History is good if it was drawn last frame, on this world, from this spot, with this field of view.
    const H0 = this.cloudHist;
    const hist = H0 && H0.frame === this.frameNo - 1 && H0.body === b && Math.abs(H0.t - t) < 1e-3 && Math.hypot(H0.up[0] - upB[0], H0.up[1] - upB[1], H0.up[2] - upB[2]) < 2e-6;
    const Rkm = b.r * 1.495978707e8;
    const Hkm = optics ? Math.min(60, Math.max(2, optics.hR * Rkm)) : 8.5;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.cloudRT.fbo);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST);
    gl.useProgram(p.p);
    gl.uniformMatrix3fv(u.uView, false, this.V);
    gl.uniform2f(u.uTan, t * (this.canvas.width / this.canvas.height), t);
    gl.uniform3fv(u.uUp, sv.up);
    gl.uniform3fv(u.uSun, sv.sun);
    gl.uniform3fv(u.uNorth, sv.north || [0, 0, 1]);
    gl.uniform1f(u.uAir, optics ? 1 : 0);
    if (optics) setOpticsUniforms(gl, u, optics, 8);
    gl.uniform1f(u.uSunPower, sv.sunPower);
    gl.uniform1f(u.uCloud, cover);
    // The wind's clock: simulated seconds, so clouds race by with time sped up and stop when paused, at most
    // 120x real time (a 15 m/s wind then crosses the sky in seconds; faster would only flicker).
    const nowS = performance.now() / 1000, simT = this.world ? this.world.t * 3.15576e7 : nowS;
    if (this.windAt !== this.frameNo) {
      const dr = Math.min(0.25, Math.max(0, nowS - (this.windReal ?? nowS)));
      this.windT = (this.windT || 0) + Math.min(Math.max(0, simT - (this.windSim ?? simT)), dr * 120);
      this.windReal = nowS; this.windSim = simT; this.windAt = this.frameNo;
    }
    gl.uniform1f(u.uTime, this.windT);
    gl.uniform3fv(u.uCloudCol, this.look(b).colC || [0.95, 0.96, 1]);
    gl.uniform3f(u.uCloudH, (0.24 * Hkm) / Rkm, (0.3 * Hkm) / Rkm, Rkm);
    gl.uniform1f(u.uStorm, this.weather ? this.weather.rain || 0 : 0);
    gl.uniform1f(u.uCirrus, this.cirrus || 0);
    gl.uniform1f(u.uHs, Hkm / 8.5);
    gl.uniform1f(u.uBlanket, optics && optics.tauM > 3 ? 1 : 0);
    gl.uniform1f(u.uFluff, optics && optics.kind === 'tholin' ? 1 : 0);
    const wnd = this.windOf(b, optics), wdir = this.windDir(b);
    gl.uniform2f(u.uWindV, (wdir[0] * wnd.cloud) / 1000, (wdir[1] * wnd.cloud) / 1000);
    // How convective the weather is here: warm, wet air builds cumulus and storm towers; cold or dry air,
    // flat sheets.
    const th = b.th, Tloc = sv.localT || (th ? th.Ts : 0), wetC = th && th.liquid > 0.005;
    gl.uniform1f(u.uConv, wetC ? Math.max(0, Math.min(1, (Tloc - 278) / 22)) * (0.35 + 0.65 * Math.min(1, cover * 1.6)) : 0.1);
    gl.uniform1f(u.uFrame, this.cloudFrame % 1000);
    gl.uniform1f(u.uHist, hist ? 1 : 0);
    gl.uniformMatrix3fv(u.uPrevView, false, hist ? H0.VB : VB);
    gl.uniformMatrix3fv(u.uRotT, false, RT);
    this.bindTex(14, prev.tex, u.uPrev);
    this.bindTex(15, this.cloudNoise(), u.uNoiseTex);
    gl.bindVertexArray(this.quad);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.activeTexture(gl.TEXTURE0);
    this.cloudHist = { frame: this.frameNo, body: b, t, VB, up: upB };
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFB);
    gl.viewport(0, 0, this.sceneW, this.sceneH);
    return true;
  }

  // Temperature field across the plane of the first chosen source, from the eight strongest heat sources.
  drawTempField(world, zones) {
    const gl = this.gl, p = this.pField, u = p.u, cam = this.cam;
    const src = [];
    for (const b of world.bodies) { const L = heatOutput(b); if (L) src.push([b, L]); }
    if (!src.length) return;
    src.sort((a, b) => b[1] - a[1]);
    const n = Math.min(8, src.length), arr = new Float32Array(32);
    for (let i = 0; i < n; i++) {
      const [b, L] = src[i];
      arr.set([b.x - this.ex, b.y - this.ey, b.z - this.ez, L], i * 4);
    }
    const ref = zones.values().next().value;
    // Habitable-zone fluxes for the brightest star's temperature (Kopparapu et al. 2013).
    const T = Math.max(2600, Math.min(7200, src[0][0].temp || 5780)) - 5780;
    const hz = (s0, a, b2, c, d) => s0 + a * T + b2 * T * T + c * T ** 3 + d * T ** 4;
    const t = Math.tan(cam.fov / 2);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(p.p);
    gl.uniformMatrix3fv(u.uView, false, this.V);
    gl.uniform2f(u.uTan, t * (this.canvas.width / this.canvas.height), t);
    gl.uniform1f(u.uPlaneY, ref.y - this.ey);
    gl.uniform4fv(u.uSrc, arr);
    gl.uniform1i(u.uN, n);
    gl.uniform2f(u.uHZ, hz(1.107, 1.332e-4, 1.58e-8, -8.308e-12, -1.931e-15), hz(0.356, 6.171e-5, 1.698e-9, -3.198e-12, -5.575e-16));
    gl.uniform1f(u.uAlpha, 0.85);
    gl.bindVertexArray(this.quad);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.disable(gl.BLEND);
  }

  // The (up to) four black holes and neutron stars bending the background most, seen from the eye.
  findLenses(world) {
    const ex = this.ex, ey = this.ey, ez = this.ez; // the eye (set in draw)
    const L = [];
    for (const b of world.bodies) {
      if (b.kind !== 'bh' && b.kind !== 'ns') continue;
      const dx = b.x - ex, dy = b.y - ey, dz = b.z - ez, D = Math.hypot(dx, dy, dz);
      const rs = schwarzschild(b.m);
      if (!(D > 3 * Math.max(rs, b.r))) continue;
      const e2 = (2 * rs) / D;
      if (e2 < 1e-10) continue; // Einstein ring under ~0.002″: nothing visible
      // A black hole shows its shadow (2.6 r_s); a neutron star simply covers its own disc.
      const sh = b.kind === 'bh' ? (2.598 * rs) / D : Math.asin(Math.min(1, b.r / D));
      L.push({ x: dx / D, y: dy / D, z: dz / D, e2, sh });
    }
    L.sort((a, b) => b.e2 - a.e2);
    this.lenses = L.slice(0, 4);
  }

  setLensUniforms(u) {
    const gl = this.gl, L = this.lenses || [];
    const v = new Float32Array(16), sh = new Float32Array(4);
    L.forEach((l, i) => { v.set([l.x, l.y, l.z, l.e2], i * 4); sh[i] = l.sh; });
    gl.uniform4fv(u.uLens, v);
    gl.uniform1fv(u.uLensSh, sh);
    gl.uniform1i(u.uLensN, L.length);
  }

  drawMilkyWay() {
    const gl = this.gl, s = this.pMilky, u = s.u, cam = this.cam;
    const t = Math.tan(cam.fov / 2);
    gl.useProgram(s.p);
    gl.uniformMatrix3fv(u.uView, false, this.V);
    gl.uniform2f(u.uTan, t * (this.canvas.width / this.canvas.height), t);
    // The real galactic frame (stars.js), as the catalogue stars.
    gl.uniform3fv(u.uGalN, GAL_N);
    gl.uniform3fv(u.uGalC, GAL_C);
    gl.uniform1f(u.uBright, 1);
    // The real panorama (ESO/Solar System Scope) when loaded; the generated band until then.
    const mw = loadImage('milkyway');
    gl.uniform1f(u.uMWK, mw ? 1 : 0);
    if (mw) { gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, this.donorTex(mw)); gl.uniform1i(u.uMW, 5); gl.activeTexture(gl.TEXTURE0); }
    this.setLensUniforms(u);
    gl.bindVertexArray(this.quad);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  program(vs, fs) {
    const gl = this.gl;
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('Shader compile failed: ' + gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Shader link failed: ' + gl.getProgramInfoLog(p));
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i);
      u[info.name.replace('[0]', '')] = gl.getUniformLocation(p, info.name);
    }
    return { p, u };
  }

  // A VAO with four streaming attributes (position, colour, size, shade).
  dynamicSet() {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const bufs = [3, 3, 1, 1].map((size, loc) => {
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
      return b;
    });
    gl.bindVertexArray(null);
    return { vao, bufs, cap: 0, pos: null, col: null, size: null, shade: null, n: 0 };
  }

  ensure(set, n) {
    if (set.cap >= n) return;
    set.cap = Math.max(n, set.cap * 2, 256);
    set.pos = new Float32Array(set.cap * 3);
    set.col = new Float32Array(set.cap * 3);
    set.size = new Float32Array(set.cap);
    set.shade = new Float32Array(set.cap);
  }

  upload(set) {
    const gl = this.gl;
    gl.bindVertexArray(set.vao);
    const n = set.n;
    gl.bindBuffer(gl.ARRAY_BUFFER, set.bufs[0]); gl.bufferData(gl.ARRAY_BUFFER, set.pos.subarray(0, n * 3), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, set.bufs[1]); gl.bufferData(gl.ARRAY_BUFFER, set.col.subarray(0, n * 3), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, set.bufs[2]); gl.bufferData(gl.ARRAY_BUFFER, set.size.subarray(0, n), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, set.bufs[3]); gl.bufferData(gl.ARRAY_BUFFER, set.shade.subarray(0, n), gl.DYNAMIC_DRAW);
  }

  // Ring mesh for the Surface view: 190 rings from 0.3 m to 150 km (spaced geometrically, so detail
  // is where you look closely), 240 segments around.
  terrainMesh() {
    if (this.tMesh) return this.tMesh;
    const gl = this.gl, NR = 190, NS = 320, r0 = 0.3, r1 = 1.5e5;
    const k = Math.pow(r1 / r0, 1 / (NR - 1));
    const v = new Float32Array((NR * NS + 1) * 2);
    v[0] = 0; v[1] = 0;
    for (let i = 0; i < NR; i++) for (let j = 0; j < NS; j++) { const o = (1 + i * NS + j) * 2; v[o] = r0 * Math.pow(k, i); v[o + 1] = (j / NS) * Math.PI * 2; }
    const idx = [];
    for (let j = 0; j < NS; j++) idx.push(0, 1 + j, 1 + ((j + 1) % NS));
    for (let i = 0; i < NR - 1; i++) for (let j = 0; j < NS; j++) {
      const a = 1 + i * NS + j, b2 = 1 + i * NS + ((j + 1) % NS), c = a + NS, d = b2 + NS;
      idx.push(a, c, b2, b2, c, d);
    }
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const vb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, v, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    // (The rock attributes, all zero for the ground: see rockMesh.)
    const zb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, zb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array((v.length / 2) * 4), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 0, 0);
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(idx), gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    this.tMesh = { vao, n: idx.length };
    return this.tMesh;
  }

  // The sea's slope texture (OceanFFT), stepped to time t (s) at most once a frame.
  seaTex(t, wind = 9) {
    const gl = this.gl;
    // (A new sea when the wind changes by over a fifth: the spectrum's scale follows the wind, U²/g.)
    if (this.sea && Math.abs(this.sea.wind - wind) > 0.2 * this.sea.wind) { this.sea = null; gl.deleteTexture(this.seaT); }
    if (!this.sea) {
      this.sea = new OceanFFT(64, 32, wind);
      this.sea.wind = wind;
      this.seaT = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.seaT);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 64, 64, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
      this.seaFrame = -1;
    }
    if (this.seaFrame !== this.frameNo) {
      this.seaFrame = this.frameNo;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.seaT);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 64, 64, gl.RGBA, gl.UNSIGNED_BYTE, this.sea.step(t));
      gl.generateMipmap(gl.TEXTURE_2D);
    }
    return this.seaT;
  }

  // The rocks' shadow map: 1024² (about 8 cm per texel over 80 m), distance packed into the colour channels
  // (TERRAIN_FS shDecode), so read without filtering; with its own depth buffer.
  // Photographed ground materials for the Surface view (Poly Haven, CC0): colour, with the scan's height in
  // alpha (two JPEGs each, joined here), mipmapped and repeating. Null until all have loaded.
  groundMats() {
    if (this.gMats) return this.gMats;
    const imgs = GROUND_MATS.map((k) => [loadImage('ground-' + k), loadImage('ground-' + k + '-h')]);
    if (imgs.some(([c, h]) => !c || !h)) return null;
    const gl = this.gl, cv = document.createElement('canvas'), cx = cv.getContext('2d', { willReadFrequently: true });
    this.gMats = imgs.map(([c, h]) => {
      const W = c.width, H = c.height;
      cv.width = W; cv.height = H;
      cx.drawImage(c, 0, 0); const px = cx.getImageData(0, 0, W, H).data;
      cx.drawImage(h, 0, 0, W, H); const hx = cx.getImageData(0, 0, W, H).data;
      for (let i = 3; i < px.length; i += 4) px[i] = hx[i - 1];
      const t = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(px.buffer));
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
      this.aniso(8);
      return t;
    });
    return this.gMats;
  }

  shadowTarget() {
    if (this.shTarget) return this.shTarget;
    const gl = this.gl, T = this.makeTarget(1024, 1024);
    gl.bindTexture(gl.TEXTURE_2D, T.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    T.depth = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, T.depth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, 1024, 1024);
    gl.bindFramebuffer(gl.FRAMEBUFFER, T.fbo);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, T.depth);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFB);
    this.shTarget = T;
    return T;
  }

  // Rocks around the observer, drawn by the terrain program (TERRAIN_VS places each on the ground there and
  // decides, from how rocky the ground is, whether it shows). Each is a once-subdivided icosahedron (42
  // corners) that the shader makes lumpy, flattened and turned. Placed more densely near the observer;
  // sizes follow a steep power law (mostly fist-sized stones, a few boulders), and only bigger ones farther
  // out, where small ones would be under a pixel.
  rockMesh() {
    if (this.rMesh) return this.rMesh;
    const gl = this.gl, N = 1800, ico = icosphere(1), nv = ico.pos.length / 3;
    const rock = new Float32Array(N * nv * 4), local = new Float32Array(N * nv * 3), idx = new Uint32Array(N * ico.idx.length);
    let seed = 12345;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    for (let k = 0; k < N; k++) {
      const r = 1.6 + 220 * Math.pow(rnd(), 2.8), a = rnd() * Math.PI * 2;
      const size = (0.04 + 0.55 * Math.pow(rnd(), 5)) * (1 + r / 90);
      const x = Math.cos(a) * r, y = Math.sin(a) * r, s = rnd() * 0.999 + 0.0005;
      for (let i = 0; i < nv; i++) {
        const o = k * nv + i;
        rock.set([x, y, size, s], o * 4);
        local.set([ico.pos[i * 3], ico.pos[i * 3 + 1], ico.pos[i * 3 + 2]], o * 3);
      }
      for (let i = 0; i < ico.idx.length; i++) idx[k * ico.idx.length + i] = k * nv + ico.idx[i];
    }
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const zb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, zb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(N * nv * 2), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const rb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, rb);
    gl.bufferData(gl.ARRAY_BUFFER, rock, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
    const lb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, lb);
    gl.bufferData(gl.ARRAY_BUFFER, local, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 0, 0);
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    this.rMesh = { vao, n: idx.length };
    return this.rMesh;
  }

  // Grass around the observer, drawn by the terrain program like the rocks (TERRAIN_VS plants each blade on the
  // ground and decides, from the same rules as the ground's vegetation, whether it grows there). Each blade is a
  // strap of two segments tapering to a point (5 corners). Denser near the observer (out to 20 m); farther
  // blades are drawn wider, each standing for a tuft, and the ground's own grass colour fills in between.
  grassMesh() {
    if (this.gMesh) return this.gMesh;
    const gl = this.gl, N = 48000, corner = [[-1, 0], [1, 0], [-1, 0.55], [1, 0.55], [0, 1]], tri = [0, 1, 2, 1, 3, 2, 2, 3, 4];
    const z = new Float32Array(N * 5 * 2), blade = new Float32Array(N * 5 * 4), local = new Float32Array(N * 5 * 3), idx = new Uint32Array(N * 9);
    let seed = 777;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    for (let k = 0; k < N; k++) {
      const r = 0.25 + 20 * Math.pow(rnd(), 2.2), a = rnd() * Math.PI * 2;
      const h = 0.25 + 0.55 * rnd() * rnd() + 0.25 * rnd(), s = rnd() * 0.999 + 0.0005;
      for (let i = 0; i < 5; i++) {
        const o = k * 5 + i;
        blade.set([Math.cos(a) * r, Math.sin(a) * r, -h, s], o * 4);
        local.set([corner[i][0], corner[i][1], 0], o * 3);
      }
      for (let i = 0; i < 9; i++) idx[k * 9 + i] = k * 5 + tri[i];
    }
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    [[z, 2], [blade, 4], [local, 3]].forEach(([data, n], loc) => {
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, n, gl.FLOAT, false, 0, 0);
    });
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    this.gMesh = { vao, n: idx.length };
    return this.gMesh;
  }

  // Typical winds on a world (m/s): near the ground (grass, waves) and at cloud height (the clouds' drift).
  // Measured: Earth ~5 at 10 m over land and sea, ~10 at low cloud; Venus ~0.5-1 at the surface (Venera 9/10
  // anemometers) but ~60 at the base of its cloud deck, which super-rotates round the planet in ~4 days (100
  // m/s at the tops); Mars 2-10 (Viking, Perseverance's MEDA), clouds ~15; Titan ~0.3-1 at the surface,
  // a few m/s through its lower 20 km (Huygens's descent: Bird et al. 2005, Nature 438, 800). Elsewhere from
  // the air's density: thinner air is moved faster by the same heating (~1/sqrt of the density), and a thick
  // deck on a slow-turning world super-rotates as Venus's does.
  windOf(b, optics) {
    const name = b.name.replace(/ \d+$/, '');
    const KNOWN = { Earth: [5, 10], Venus: [0.7, 60], Mars: [5, 15], Titan: [0.6, 2.5] };
    if (KNOWN[name]) return { ground: KNOWN[name][0], cloud: KNOWN[name][1] };
    if (!optics) return { ground: 0, cloud: 0 };
    const rho = optics.P * (288 / Math.max(optics.T || 288, 40)) * ((optics.mu || 29) / 29);   // density, Earth = 1
    const ground = Math.max(0.3, Math.min(15, 5 / Math.sqrt(Math.max(rho, 0.01))));
    const day = Math.abs(this.look(b).day || 24);
    const cloud = optics.P > 10 && day > 500 ? 60 : Math.min(40, ground * 2);
    return { ground, cloud };
  }
  // The wind's direction, which turns slowly (a few degrees a minute of simulated time), per world.
  windDir(b) {
    const a = seeded(b.id * 7 + 1) * 6.283 + 0.6 * Math.sin((this.windT || 0) / 3000);
    return [Math.cos(a), Math.sin(a)];
  }

  // The ground around the observer in the Surface view. Lit by the sunlight that reaches the ground and
  // the sky's own light, and hazed with distance, all from the same atmosphere model as the sky.
  // How arid the ground where the observer stands is, 0..1, for mesas (TERRAIN mesaH): none without air (they
  // are carved by wind and water) or under Venus-thick air; dry worlds everywhere; worlds with seas in the
  // subtropical desert belts; Earth where its satellite photo is tan rock and sand rather than green, sea or ice.
  aridity(b, sv, optics) {
    if (!optics || optics.P > 10) return 0;
    const th = b.th, latA = Math.abs(sv.lat);
    if (/^Earth( \d+)?$/.test(b.name)) {
      const img = loadImage('earth-day');
      if (!img) return 0;
      if (!this.earthDayPx) {
        try {
          const c = document.createElement('canvas'); c.width = 512; c.height = 256;
          const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0, 512, 256);
          this.earthDayPx = g.getImageData(0, 0, 512, 256).data;
        } catch { this.earthDayPx = new Uint8ClampedArray(512 * 256 * 4); }
      }
      // (Equirectangular, 0° longitude at the centre.) Average a few nearby pixels (~70 km each).
      let ar = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const x = ((Math.floor((0.5 + sv.lon / (2 * Math.PI)) * 512) + dx) % 512 + 512) % 512;
        const y = Math.max(0, Math.min(255, Math.floor((0.5 - sv.lat / Math.PI) * 256) + dy));
        const o = (y * 512 + x) * 4, r = this.earthDayPx[o], g = this.earthDayPx[o + 1], bl = this.earthDayPx[o + 2];
        const tan = Math.max(0, Math.min(1, (r - bl - 8) / 30)) * (r >= g * 0.98 ? 1 : 0.2) * (r + g + bl < 640 ? 1 : 0);   // (Blue Marble's deserts are pale: Sahara ~209,188,173)
        ar += tan / 9;
      }
      return Math.min(1, ar * 2.5);   // (the photo averages ~200 km here: semi-arid country already has mesas)
    }
    if (!th) return 0;
    if (th.liquid < 0.01) return 1;
    return Math.max(0, Math.exp(-((latA - 0.45) ** 2) / 0.012) * (1 - th.liquid));
  }

  drawTerrain(b, l, rot, lights, temp) {
    const gl = this.gl, sv = this.surface, p = this.pTerrain, u = p.u, th = b.th;
    const AU = 1.495978707e11, Rm = b.r * AU;
    // Build the terrain around where the eye really is (the planet may have turned a little since the
    // camera was placed this frame): the eye's direction from the centre, in the body's own frame.
    const wx = this.ex - b.x, wy = this.ey - b.y, wz = this.ez - b.z, wr = Math.hypot(wx, wy, wz);
    const n = [(rot[0] * wx + rot[1] * wy + rot[2] * wz) / wr, (rot[3] * wx + rot[4] * wy + rot[5] * wz) / wr, (rot[6] * wx + rot[7] * wy + rot[8] * wz) / wr];
    const eyeH = Math.max(0.5, wr * AU - Rm);
    let north = [-n[1] * n[0], 1 - n[1] * n[1], -n[1] * n[2]];
    let nl = Math.hypot(...north);
    if (nl < 1e-6) { north = [1, 0, 0]; nl = 1; }
    north = north.map((v) => v / nl);
    const east = [north[1] * n[2] - north[2] * n[1], north[2] * n[0] - north[0] * n[2], north[0] * n[1] - north[1] * n[0]];
    const toV = (o) => { const w = [rot[0] * o[0] + rot[3] * o[1] + rot[6] * o[2], rot[1] * o[0] + rot[4] * o[1] + rot[7] * o[2], rot[2] * o[0] + rot[5] * o[1] + rot[8] * o[2]]; return this.viewOf(w[0], w[1], w[2]); };
    const ld = lights ? lights.dirs : [[0, 1, 0], [0, 0, 0], [0, 1, 0], [0, 0, 0]];
    const upV = toV(n);
    const sunUp = ld[0][0] * upV[0] + ld[0][1] * upV[1] + ld[0][2] * upV[2];
    // Light and haze from the sky model, refreshed a few times a second.
    const optics = atmosphereOptics(b);
    const now = performance.now();
    if (!this.gLight || now - this.gLight.t > 300 || this.gLight.b !== b || Math.abs(this.gLight.sp - (sv.sunPower ?? 1)) > 0.02) {
      const el = sv.elev || 0, day = optics ? optics.day : 1, sp = sv.sunPower === undefined ? 1 : sv.sunPower;
      const dusk = 1 + (1 / Math.sqrt(0.3 + 0.7 * Math.max(0, Math.sin(el))) - 1) * Math.max(0, Math.min(1, (el + 0.2) / 0.15));
      // (An eclipse dims the sunlight by sp; the eye adapts, as the sky's exposure does.)
      const expo = (22 * dusk) / Math.pow(Math.max(1e-4, Math.min(1, day * sp)), 0.6);
      // Without air the eye adapts to the sunlit ground itself (as in the Apollo photographs).
      const adapt = (optics ? expo / 22 : 1.4) * sp;
      const g = optics ? groundLight(optics, sunUp, expo * sp) : null;
      this.gLight = { t: now, b, g, adapt, optics, sp };
    }
    const { g, adapt } = this.gLight;
    const sunT = g ? g.sunT : [1, 1, 1];
    // (Under the overcast of rain little direct sunlight gets through.)
    const storm = this.weather ? this.weather.rain || 0 : 0;
    const sunCol = [0, 1, 2].map((i) => ld[1][i] * sunT[i] * adapt * (sunUp > -0.02 ? 1 : 0) * (1 - 0.85 * storm));
    // Sky light: from the model, or (airless) only faint light from the stars and the ground around.
    // (The model's eight-direction sky average comes out dim, most of all with a low Sun, when shaded slopes go
    // black; measured skylight at sunrise is ~5-10% of noon sunlight, and the eye adapts to it. Boosted to
    // match: x1.6 at noon, up to x3 near the horizon.)
    const ambK = 1.6 + 1.4 * (1 - Math.max(0, Math.min(1, (sunUp - 0.05) / 0.45)));
    // (Its colour half from the zenith and the horizon away from the Sun: the few sample rays overweight the bright
    // glow around the Sun, which on Mars is blue (its dust scatters blue forward) though the sky is butterscotch.)
    let ambG = g ? g.amb : null;
    if (g) {
      // (With the Sun low, the bright horizon around it lights the ground too: warm on Earth at sunset.)
      const ws = Math.max(0, Math.min(1, (0.25 - sunUp) / 0.2)) * 0.4;
      const c = [0, 1, 2].map((i) => (0.5 - ws / 2) * g.zen[i] + (0.5 - ws / 2) * g.horAnti[i] + ws * g.horSun[i]), cl = 0.3 * c[0] + 0.55 * c[1] + 0.15 * c[2];
      const al = 0.3 * g.amb[0] + 0.55 * g.amb[1] + 0.15 * g.amb[2];
      if (cl > 1e-9) ambG = c.map((v, i) => 0.5 * (v / cl) * al + 0.5 * g.amb[i]);
    }
    let amb = g ? ambG.map((v, i) => v * adapt * ambK * (ld[1][i] > 0 ? 1 : 0) + 0.004) : sunCol.map((v) => v * 0.04 * Math.max(0, sunUp) + 0.002);
    // By day, no more skylight than the air can scatter down: of the sunlight it takes out of the beam,
    // 1 - e^(-τ/μ), the share scattered rather than absorbed (single-scattering albedo, τ_scatter/τ_total), about
    // 0.7 of it downward; with 2.5x headroom for the boost above (Earth's stays as it was). Mars's dusty sky
    // otherwise lit the ground more than the Sun did, and blue, though its dust absorbs blue: its skylight is
    // ~40% of the light at noon and butterscotch (Lemmon et al. 2004, Science 306, 1753).
    if (g && optics && sunUp > 0.05) {
      const mu = Math.max(sunUp, 0.1);
      amb = amb.map((v, i) => {
        const w = optics.tauE[i] > 0 ? optics.tauS[i] / optics.tauE[i] : 1;
        const cap = 2.5 * ld[1][i] * adapt * mu * (1 - Math.exp(-optics.tauE[i] / mu)) * w * 0.7;
        return Math.min(v, Math.max(cap, 0.004));
      });
    }
    // Under a thick overcast (Venus, Titan) nearly all light is the sky's: a uniform sky of radiance L gives
    // irradiance πL, so a surface of albedo A looks A times as bright as the sky above it (Venera's photos show
    // the ground plainly lit). Taken from the sky as it is shown (g.zen, already in screen units), and scaled for
    // the map colours being brighter than real dark basalt (albedo ~0.1): rock a few times darker than the sky.
    if (g && optics.tauM > 3 && sunUp > -0.1) amb = g.zen.map((v) => v * 0.9 + 0.004);
    const ext = optics ? [0, 1, 2].map((i) => (optics.betaR[i] + optics.betaA[i] + optics.betaM[i] + optics.betaMa[i]) / Rm) : [0, 0, 0];
    const fogH = optics ? ((optics.betaR[1] * optics.hR + optics.betaM[1] * optics.hM) / Math.max(1e-9, optics.betaR[1] + optics.betaM[1])) * Rm : 1;
    const gr = (6.674e-11 * b.m * 1.98847e30) / (Rm * Rm);
    const reliefK = Math.max(0.25, Math.min(1.6, (0.8 * 9.81) / Math.max(gr, 0.1)));
    const liquid = th && th.liquid > 0.005;
    gl.useProgram(p.p);
    gl.uniformMatrix4fv(u.uProj, false, this.P);
    gl.uniformMatrix3fv(u.uView, false, this.V);
    gl.uniformMatrix3fv(u.uRot, false, new Float32Array(rot));
    gl.uniform3fv(u.uObs, n); gl.uniform3fv(u.uEast, east); gl.uniform3fv(u.uNorth, north);
    gl.uniform1f(u.uRm, Rm); gl.uniform1f(u.uEyeH, eyeH); gl.uniform1f(u.uAU, AU);
    gl.uniform1f(u.uSeaOK, liquid ? 1 : 0);
    gl.uniform1f(u.uLogDepthFC, this.logFC);
    gl.uniform1f(u.uSeed, seeded(b.id) * 40);
    gl.uniform1f(u.uOcean, th ? th.ocean : 0);
    gl.uniform1f(u.uMapMode, b.surfaceMap && this.mapTex.get(b) ? b.surfaceMap.mode : 0);
    if (b.surfaceMap && this.mapTex.get(b)) { gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, this.mapTex.get(b).tex); gl.uniform1i(u.uMap, 5); gl.activeTexture(gl.TEXTURE0); }
    this.bindDonor(u, b, l);
    this.bindEarthDay(u, b, th);
    this.bindHeight(u, b, false);
    this.bindGen(u, b, Infinity);
    // (Capped at ~2.5% of the radius on small worlds: the 1/g rule would raise peaks a fifth of the radius high on
    // a 60 km moon; Epimetheus's own ~10 km departures from a sphere are its overall shape, not local peaks.)
    gl.uniform1f(u.uRelief, Math.min(4000 * reliefK, 0.025 * b.r * 1.495978707e11));
    gl.uniform1f(u.uCraters, l.craters ? Math.min(1, l.craters * 2.5) : 0);
    // Venus-thick air: few dunes (Magellan found only two fields), and broken basalt slabs and rubble
    // underfoot, as in the Venera 13 and 14 panoramas.
    const thickAir = optics && optics.P > 10;
    gl.uniform1f(u.uRough, thickAir ? 1.8 : 1);
    gl.uniform1f(u.uDunes, !optics ? 0 : thickAir ? 0.15 : 1);   // (and none without air: dunes need wind)
    gl.uniform1f(u.uArid, this.aridity(b, sv, optics));
    const fr = (x) => x - Math.floor(x);
    gl.uniform2f(u.uLocal, fr(sv.lat * 977.3) * 800, fr(sv.lon * 613.7) * 800);
    gl.uniform3fv(u.uL0, ld[0]);
    gl.uniform3fv(u.uSunCol, sunCol);
    let sunO = [0, 0, 1];
    {
      // The Sun in the body's own frame, and its angular size, for the shadows the terrain casts.
      const P = lights && lights.primary;
      const wd = P && P.d > 0 ? [P.dx / P.d, P.dy / P.d, P.dz / P.d] : [0, 1, 0];
      sunO = [rot[0] * wd[0] + rot[1] * wd[1] + rot[2] * wd[2], rot[3] * wd[0] + rot[4] * wd[1] + rot[5] * wd[2], rot[6] * wd[0] + rot[7] * wd[1] + rot[8] * wd[2]];
      gl.uniform3fv(u.uSunO, sunO);
      gl.uniform1f(u.uSunAngT, P && P.s && P.s.r ? P.s.r / P.d : 0.00465);
    }
    gl.uniform3fv(u.uAmb, amb);
    gl.uniform3fv(u.uUpV, upV); gl.uniform3fv(u.uEastV, toV(east)); gl.uniform3fv(u.uNorthV, toV(north));
    gl.uniform3fv(u.uColA, l.colA || [0.6, 0.6, 0.6]);
    gl.uniform3fv(u.uColB, l.colB || [0.4, 0.4, 0.4]);
    gl.uniform3fv(u.uVeg, vegetationColor(b, lights));
    gl.uniform1f(u.uLife, b.life ? 1 : 0);
    gl.uniform1f(u.uTemp, temp);
    gl.uniform1f(u.uLatSpan, th ? th.latSpan : 50);
    gl.uniform1f(u.uIce, th && th.ice > 0.003 ? 1 : 0);
    gl.uniform1f(u.uSnowLat, th ? (th.ice > 0.97 ? -0.3 : 1 - th.ice) : 1.3);
    gl.uniform1f(u.uBoil, th ? th.boil : 373);
    gl.uniform1f(u.uLapse, optics && optics.P > 0.1 ? 6.5 : 0);
    gl.uniform1f(u.uTime, now / 1000);
    gl.uniform1f(u.uPxAng, (2 * Math.tan(this.cam.fov / 2)) / Math.max(1, this.Hcur || 800));
    gl.uniform3fv(u.uFogExt, ext);
    gl.uniform1f(u.uFogH, fogH);
    gl.uniform3fv(u.uFogSun, g ? g.horSun : [0, 0, 0]);
    gl.uniform3fv(u.uFogAnti, g ? g.horAnti : [0, 0, 0]);
    gl.uniform3fv(u.uSkyZen, g ? g.zen : [0, 0, 0]);
    // The clouds drawn for this frame's sky, for the water to mirror.
    const tf = Math.tan(this.cam.fov / 2);
    gl.uniform2f(u.uTan, tf * (this.canvas.width / this.canvas.height), tf);
    gl.uniform1f(u.uCloudOn, this.cloudsNow && this.cloudRT ? 1 : 0);
    if (this.cloudsNow && this.cloudRT) { this.bindTex(13, this.cloudRT.tex, u.uClouds); gl.activeTexture(gl.TEXTURE0); }
    // Haze and mist from how wet the world is (its ocean cover) and its air pressure. Humid haze: visibility
    // (3.9 / extinction) from ~100 km in dry air to ~20 km in humid air, 1.5 km deep. Valley mist: ~60 m deep,
    // pooled in valleys, thickest at dawn and dusk and where it is cool, none in thin air.
    const humid = th && liquid ? Math.min(1, th.ocean * 1.2) : 0, Pbar = optics ? optics.P : 0;
    const airK = Math.min(1.5, Math.sqrt(Math.max(Pbar, 0)));
    const dawn = 0.35 + 0.65 * Math.max(0, Math.min(1, (0.4 - Math.sin(sv.elev || 0)) / 0.35));
    const cool = th ? Math.max(0, Math.min(1, (305 - temp) / 25)) : 0;
    const rainK = this.weather ? this.weather.rain || 0 : 0;   // (rain cuts visibility to a few km)
    gl.uniform4f(u.uHaze, 4e-5 * (0.3 + 1.7 * humid) * airK * (1 + 12 * rainK), 1500, Pbar > 0.05 ? 1.2e-3 * humid * dawn * (0.3 + 0.7 * cool) * airK : 0, 0);
    if (window.__tdbg) window.__tdbg = { n, eyeH, wr, br: b.r, upWorld: [rot[0] * n[0] + rot[3] * n[1] + rot[6] * n[2], rot[1] * n[0] + rot[4] * n[1] + rot[7] * n[2], rot[2] * n[0] + rot[5] * n[1] + rot[8] * n[2]], svUp: sv.up, upV, ex: [this.ex, this.ey, this.ez], b: [b.x, b.y, b.z] };
    // Rocks, and their shadow map: the rocks within ~40 m drawn as seen from the Sun (orthographic, in the
    // observer's east/north/up frame), so the ground and the rocks themselves can tell whether a rock stands
    // between them and the Sun.
    const rockiness = !optics ? 1 : optics.P > 10 ? 0.9 : th && th.liquid > 0.05 ? 0.35 : th && th.ice > 0.5 ? 0.6 : 0.85;
    const rocksOn = rockiness > 0 && !(this.settings.rocks === false);
    // Relief underfoot: regolith and small craters where nothing erodes them (no air), and how stony the soil
    // is. No small craters on Io (its volcanoes resurface it faster than impacts mark it: none are known) or
    // on Europa's young, cracked ice (very few).
    const youngSurface = l.volc || (l.lineae || 0) >= 1;
    gl.uniform3f(u.uMicro, !optics ? 1 : 0, 0.03 + 0.07 * rockiness, !optics && !youngSurface ? 1 : 0);
    const gm = this.groundMats();
    GROUND_MATS.forEach((k, i) => this.bindTex(GROUND_UNITS[i], gm ? gm[i] : this.cloudNoise(), u['uG' + k[0].toUpperCase() + k.slice(1)]));
    gl.uniform1f(u.uGroundOn, gm ? 1 : 0);
    // The sea's waves (OceanFFT), where there is liquid.
    const seaOn = !!liquid && this.settings.view !== 'pixel';
    // (wind 10 m up, as sea-state models take it: ~1.3x that at eye height over the ground's roughness)
    const wndG = this.windOf(b, optics).ground;
    this.bindTex(11, seaOn ? this.seaTex(now / 1000, Math.max(2, Math.min(25, wndG * 1.3))) : this.cloudNoise(), u.uSea);
    gl.uniform1f(u.uWindG, wndG);
    gl.uniform1f(u.uSeaFFT, seaOn ? 1 : 0);
    const sh = this.shadowTarget();
    // (While drawing into the map, the program's map sampler holds something else: reading the texture being
    // drawn is a feedback loop WebGL refuses.)
    this.bindTex(3, this.cloudNoise(), u.uShTex);
    gl.activeTexture(gl.TEXTURE0);
    let shOn = 0;
    if (rocksOn && sunUp > 0.03) {
      const dot = (a, c) => a[0] * c[0] + a[1] * c[1] + a[2] * c[2];
      let L = [dot(sunO, east), dot(sunO, north), dot(sunO, n)];
      const ll = Math.hypot(...L); L = L.map((x) => x / ll);
      let U = [-L[1], L[0], 0];   // L × up: level, across the sunlight
      const ul = Math.hypot(...U);
      U = ul > 1e-4 ? U.map((x) => x / ul) : [1, 0, 0];
      const V = [L[1] * U[2] - L[2] * U[1], L[2] * U[0] - L[0] * U[2], L[0] * U[1] - L[1] * U[0]];
      gl.uniform3fv(u.uShU, U); gl.uniform3fv(u.uShV, V); gl.uniform3fv(u.uShL, L);
      gl.uniform2f(u.uShSize, 40, 160);
      gl.bindFramebuffer(gl.FRAMEBUFFER, sh.fbo);
      gl.viewport(0, 0, sh.w, sh.h);
      gl.clearColor(1, 1, 1, 1);
      gl.clearDepth(1);
      gl.depthMask(true);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LESS);
      gl.disable(gl.BLEND);
      gl.uniform1f(u.uShadowPass, 1);
      gl.uniform1f(u.uLogDepthFC, 2);
      gl.uniform1f(u.uRocks, rockiness);
      const rm = this.rockMesh();
      gl.bindVertexArray(rm.vao);
      gl.drawElements(gl.TRIANGLES, rm.n, gl.UNSIGNED_INT, 0);
      gl.uniform1f(u.uShadowPass, 0);
      gl.uniform1f(u.uLogDepthFC, this.logFC);
      gl.uniform1f(u.uRocks, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFB);
      gl.viewport(0, 0, this.sceneW, this.sceneH);
      gl.depthFunc(gl.LEQUAL);
      gl.clearColor(0, 0, 0, 0);
      shOn = 1;
      this.bindTex(3, sh.tex, u.uShTex);
      gl.activeTexture(gl.TEXTURE0);
    }
    gl.uniform1f(u.uShOn, shOn);
    const m = this.terrainMesh();
    gl.uniform1f(u.uRefl, 0);
    gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(m.vao);
    gl.drawElements(gl.TRIANGLES, m.n, gl.UNSIGNED_INT, 0);
    // Rocks: how rocky the ground is. Bare, dry worlds are strewn with them (the Moon, Mars, Venus's slabs);
    // Earth's are mostly under soil and plants; icy worlds have blocks of ice (Titan's rounded "rocks" at the
    // Huygens site are water ice).
    if (rocksOn) {
      const rm = this.rockMesh();
      gl.uniform1f(u.uRocks, rockiness);
      gl.bindVertexArray(rm.vao);
      gl.drawElements(gl.TRIANGLES, rm.n, gl.UNSIGNED_INT, 0);
      gl.uniform1f(u.uRocks, 0);
    }
    // Grass, on any world with plant life (the vertex shader keeps the blades where plants grow).
    if (b.life && !(this.settings.rocks === false) && this.settings.view !== 'pixel') {
      const gm2 = this.grassMesh();
      gl.bindVertexArray(gm2.vao);
      gl.drawElements(gl.TRIANGLES, gm2.n, gl.UNSIGNED_INT, 0);
    }
    // Water mirrors the frame: copy it out (resolved), then draw the water again reading its reflection there,
    // over the same pixels (depth EQUAL).
    const post = this.post;
    if (liquid && post && this.sceneFB === post.ms) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, post.ms);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, post.scene.fbo);
      gl.blitFramebuffer(0, 0, post.W, post.H, 0, 0, post.W, post.H, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, post.ms);
      gl.viewport(0, 0, post.W, post.H);
      gl.useProgram(p.p);
      this.bindTex(14, post.scene.tex, u.uSceneTex);
      gl.uniform1f(u.uRefl, 1);
      gl.depthFunc(gl.EQUAL);
      gl.depthMask(false);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawElements(gl.TRIANGLES, m.n, gl.UNSIGNED_INT, 0);
      gl.disable(gl.BLEND);
      gl.depthMask(true);
      gl.depthFunc(gl.LEQUAL);
      gl.uniform1f(u.uRefl, 0);
      gl.activeTexture(gl.TEXTURE0);
    }
    gl.enable(gl.CULL_FACE);
  }

  // The star sky: the real stars (stars.js), once their catalogue has loaded (empty until then). Brightness
  // from the V magnitude: the light (10^-0.4 m, Sirius at -1.46 the brightest) compressed toward the faint end
  // as the eye's response is (the faintest still show), HDR at the bright end so the bloom haloes the brightest;
  // brighter stars a little larger. Colour from B-V through the black-body colours of its temperature.
  makeSky() {
    const set = this.dynamicSet();
    const cat = starCatalog();
    set.fromCatalog = !!cat;
    const n = cat ? cat.n : 0;
    this.ensure(set, Math.max(n, 1));
    for (let i = 0; i < n; i++) {
      const f = Math.pow(10, -0.4 * (cat.mag[i] + 1.46));
      const k = Math.min(8, Math.max(0.05, 4.5 * Math.pow(f, 0.5)));
      const rgb = tempToRGB(bvToTemp(cat.bv[i])), mx = Math.max(rgb[0], rgb[1], rgb[2]) || 1;
      set.pos.set([cat.dir[i * 3], cat.dir[i * 3 + 1], cat.dir[i * 3 + 2]], i * 3);
      set.col.set([(rgb[0] / mx) * k, (rgb[1] / mx) * k, (rgb[2] / mx) * k], i * 3);
      set.size[i] = (1.3 + 2.6 * Math.pow(f, 0.25)) * Math.max(1, this.dpr || 1);
      set.shade[i] = 1;
    }
    set.n = n;
    this.upload(set);
    return set;
  }

  resize() {
    this.dpr = Math.min(2, window.devicePixelRatio || 1) * (this.quality ?? 1);
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
  }

  // Anisotropic filtering on the bound texture where the device offers it: maps seen at a slant (toward a
  // planet's limb, the ground stretching to the horizon) stay sharp instead of blurring to a coarse mip level.
  aniso(n) {
    const gl = this.gl;
    if (this.anisoExt === undefined) this.anisoExt = gl.getExtension('EXT_texture_filter_anisotropic') || null;
    const e = this.anisoExt;
    if (!e) return;
    gl.texParameterf(gl.TEXTURE_2D, e.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(n, gl.getParameter(e.MAX_TEXTURE_MAX_ANISOTROPY_EXT) || 1));
  }

  // One texture per donor image, shared by every world that borrows it.
  donorTex(img) {
    const gl = this.gl;
    this.dTex ||= new Map();
    let t = this.dTex.get(img);
    if (!t) {
      t = gl.createTexture();
      gl.activeTexture(gl.TEXTURE7);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.aniso(8);
      gl.activeTexture(gl.TEXTURE0);
      this.dTex.set(img, t);
    }
    return t;
  }

  // Earth's real colours (Blue Marble), while its climate and life are Earth-like; otherwise the colours
  // come from the climate model (deserts, ice ages, a dead or a greenhouse world).
  bindEarthDay(u, b, th) {
    const gl = this.gl;
    let k = 0;
    if (/^Earth( \d+)?$/.test(b.name) && b.kind === 'rocky' && b.life && (b.lifeAge || 0) > 1e9 && th) {
      const img = loadImage('earth-day');
      if (img) {
        k = Math.max(0, Math.min(1, 1 - Math.abs(th.Ts - 288) / 18)) * Math.min(1, th.ocean * 2.5 || 0);
        gl.activeTexture(gl.TEXTURE8);
        gl.bindTexture(gl.TEXTURE_2D, this.donorTex(img));
        gl.uniform1i(u.uDay, 8);
        gl.activeTexture(gl.TEXTURE0);
      }
    }
    gl.uniform1f(u.uDayK, k);
  }

  // Cloud texture for a cloud layer: 1 = Earth's real cloud field, sampled by the generated weather;
  // 2 = a planet-wide deck's own map (Venus), turning with the super-rotation. 0 = none.
  bindCloudTex(u, b, deck) {
    const gl = this.gl;
    const file = deck ? (/^Venus( \d+)?$/.test(b.name) ? 'venus-clouds' : null) : 'earth-clouds';
    const img = file && loadImage(file);
    gl.uniform1f(u.uCloudTexMode, img ? (deck ? 2 : 1) : 0);
    if (!img) return;
    gl.activeTexture(gl.TEXTURE9);
    gl.bindTexture(gl.TEXTURE_2D, this.donorTex(img));
    gl.uniform1i(u.uCloudTex, 9);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform2f(u.uCloudStats, 0.2784, 0.2456); // earth-clouds.jpg mean and standard deviation (tools/make_maps.py)
  }

  // A small body's real (or borrowed) shape; replaces the generated lumpiness.
  bindShape(u, b) {
    const gl = this.gl;
    if (b.shape === undefined) b.shape = shapeFor(b);
    const sh = b.shape && shapeMap(b.shape.file);
    gl.uniform1f(u.uShapeK, sh ? 1 : 0);
    if (!sh) return;
    if (!sh.tex || sh.gen !== this.gen) {
      sh.gen = this.gen;
      sh.tex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE11);
      gl.bindTexture(gl.TEXTURE_2D, sh.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, sh.W, sh.H, 0, gl.RED, gl.FLOAT, sh.data);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    gl.activeTexture(gl.TEXTURE11);
    gl.bindTexture(gl.TEXTURE_2D, sh.tex);
    gl.uniform1i(u.uShape, 11);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniformMatrix3fv(u.uShapeRot, false, b.shape.rot);
    gl.uniform1f(u.uLumpy, 0);
    gl.uniform1f(u.uFacet, 0);
  }

  // A world's real (or borrowed) elevation: texture, orientation and metres-per-unit. globeK: shading
  // exaggeration on the globe, in units of the radius (0 for the surface view).
  // Generated terrain maps (GEN_FS) for worlds without a real map: equirectangular, 2048 × 1024, half-float
  // where it can be rendered to. Made once per world, 64 rows a frame at the start of a frame (genStep), and
  // only sampled after; the four most recently seen are kept. Until its map is done a world draws as before.
  bindGen(u, b, shownPx) {
    const gl = this.gl;
    let k = 0;
    // (Not where a real or painted map sets the geography: Earth, Mars, Tatooine ... keep theirs.)
    if (b.kind === 'rocky' && !b.donor && !b.surfaceMap && shownPx > 6) {
      this.genMaps ||= new Map();
      let m = this.genMaps.get(b);
      if (!m) { m = { b, seed: seeded(b.id) * 40, row: 0, done: false, used: 0 }; this.genMaps.set(b, m); }
      m.used = this.frameNo || 0;
      if (m.done) {
        k = 1;
        gl.activeTexture(gl.TEXTURE12);
        gl.bindTexture(gl.TEXTURE_2D, m.tex);
        gl.uniform1i(u.uGen, 12);
        gl.activeTexture(gl.TEXTURE0);
      }
    }
    gl.uniform1f(u.uGenK, k);
  }

  // The generated map's coarse copy for world b, with its sea level (as bigTerrain sets it), or null.
  genLand(b) {
    const m = this.genMaps && this.genMaps.get(b);
    if (!m || !m.cpu) return null;
    return { ...m.cpu, sea: 0.3 + 0.36 * (b.th ? b.th.ocean : 0) };
  }

  genStep() {
    this.frameNo = (this.frameNo || 0) + 1;
    if (!this.genMaps || !this.genMaps.size) return;
    const gl = this.gl, W = 2048, H = 1024, ROWS = 64;
    // Forget maps not drawn for a while, beyond the four most recent.
    if (this.genMaps.size > 4) {
      const old = [...this.genMaps.values()].sort((a, c) => a.used - c.used);
      for (const m of old.slice(0, this.genMaps.size - 4)) {
        if (m.tex) gl.deleteTexture(m.tex);
        if (m.fbo) gl.deleteFramebuffer(m.fbo);
        this.genMaps.delete(m.b);
      }
    }
    const m = [...this.genMaps.values()].find((x) => !x.done && x.b.alive);
    if (!m) return;
    if (!m.tex) {
      m.tex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, m.tex);
      if (this.hdr) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, W, H, 0, gl.RGBA, gl.HALF_FLOAT, null);
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      m.fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, m.fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, m.tex, 0);
    }
    gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
    const p = this.pGen;
    gl.bindFramebuffer(gl.FRAMEBUFFER, m.fbo);
    // Rows count from the bottom in GL; the map's row 0 (v = 0) is the north edge, as in the photo maps.
    gl.viewport(0, m.row, W, ROWS);
    gl.useProgram(p.p);
    gl.uniform1f(p.u.uSeed, m.seed);
    gl.uniform2f(p.u.uRows, m.row / H, ROWS / H);
    gl.bindVertexArray(this.quad);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    m.row += ROWS;
    if (m.row >= H) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, m.tex);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      m.done = true;
      // A coarse copy for the CPU (512 × 256: elevation, mountains), so the Surface view can choose dry land
      // to stand on (main.js nearestLand).
      try {
        gl.bindFramebuffer(gl.FRAMEBUFFER, m.fbo);
        const f = this.hdr, px = f ? new Float32Array(W * H * 4) : new Uint8Array(W * H * 4);
        gl.readPixels(0, 0, W, H, gl.RGBA, f ? gl.FLOAT : gl.UNSIGNED_BYTE, px);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        const w = 512, h = 256, e = new Float32Array(w * h * 2), k = f ? 1 : 1 / 255;
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const o = ((y * 4) * W + x * 4) * 4;
          e[(y * w + x) * 2] = px[o] * k; e[(y * w + x) * 2 + 1] = px[o + 1] * k;
        }
        m.cpu = { W: w, H: h, e };
        if (gl.getError() !== gl.NO_ERROR) m.cpu = null;
      } catch { m.cpu = null; gl.bindFramebuffer(gl.FRAMEBUFFER, null); }
    }
  }

  bindHeight(u, b, globe) {
    const gl = this.gl;
    let file = null, k = 1, rot = IDENT3;
    const name = b.name.replace(/ \d+$/, '');
    if (b.kind === 'rocky' && HEIGHTS[name]) file = HEIGHTS[name];
    else if (b.donor && DONOR_HEIGHT[b.donor.file]) { [file, k] = DONOR_HEIGHT[b.donor.file]; rot = b.donor.rot; }
    const hm = file && heightMap(file);
    gl.uniform1f(u.uHMapK, hm ? 1 : 0);
    if (!hm) return;
    if (!hm.tex || hm.gen !== this.gen) {
      hm.gen = this.gen;
      hm.tex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE10);
      gl.bindTexture(gl.TEXTURE_2D, hm.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, hm.W, hm.H, 0, gl.RED, gl.FLOAT, hm.data);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    gl.activeTexture(gl.TEXTURE10);
    gl.bindTexture(gl.TEXTURE_2D, hm.tex);
    gl.uniform1i(u.uHMap, 10);
    gl.activeTexture(gl.TEXTURE0);
    if (HEIGHTS[name] !== file) {
      const gB = (6.674e-11 * b.m * 1.98847e30) / (b.r * 1.495978707e11) ** 2;
      k *= Math.max(0.25, Math.min(4, HEIGHT_G[file] / Math.max(gB, 0.05)));
      // (and never more than ~5% of the radius: the Moon's ±9 km would otherwise stand ±40 km high on a 60 km
      // moon such as Epimetheus, whose whole shape departs from a sphere by ~6 km)
      k = Math.min(k, (0.05 * b.r * 1.495978707e11) / 9000);
    }
    gl.uniformMatrix3fv(u.uHRot, false, rot);
    gl.uniform1f(u.uHScale, k);
    // Globe shading: slopes exaggerated 2x so relief reads at planet scale, as in most planetary renders.
    gl.uniform1f(u.uHGlobe, globe ? (2 * k) / (b.r * 1.495978707e11) : 0);
  }

  // Bind a world's donor map (or switch it off) for the current program.
  bindDonor(u, b, l) {
    const gl = this.gl;
    if (b.donor === undefined || (b.donor === null && !b.donorTried)) { b.donor = donorFor(b, l); b.donorTried = !!b.donor || (b.donorTries = (b.donorTries || 0) + 1) > 120; }
    const d = b.donor;
    gl.uniform1f(u.uDonorK, d ? d.k : 0);
    if (!d) return;
    gl.activeTexture(gl.TEXTURE7);
    gl.bindTexture(gl.TEXTURE_2D, this.donorTex(d.img));
    gl.uniform1i(u.uDonor, 7);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniformMatrix3fv(u.uDonorRot, false, d.rot);
    gl.uniform1f(u.uDonorMean, d.mean);
  }

  look(b) {
    let l = this.looks.get(b);
    if (!l || l.kindAt !== b.kind) {
      l = lookFor(b);
      l.kindAt = b.kind;
      if (b.lockOverride !== undefined) l.locked = b.lockOverride ? 1 : 0;   // (set from the info panel)
      this.looks.set(b, l);
    }
    return l;
  }

  // ---------- per-frame ----------

  // Dynamic resolution: when frames take longer than 1/40 s, first drop multisampling, then render at
  // a lower resolution (down to 55%); climb back when there is headroom. Checked every 1.5 s.
  adaptQuality(dtReal, now) {
    if (!(dtReal > 0) || dtReal > 0.5) return; // ignore pauses (tab switches, alerts)
    this.ft = this.ft ? this.ft * 0.92 + dtReal * 0.08 : dtReal;
    if (now - (this.qT || 0) < 1500) return;
    this.qT = now;
    if (this.quality === undefined) this.quality = 1;
    const prevQ = this.quality, prevS = this.samples;
    // Settings → Full resolution: never trade sharpness for frame rate.
    if (this.settings.sharp) { this.quality = 1; if (this.samples === 0) this.samples = 4; }
    else if (this.ft > 1 / 40) {
      if (this.samples > 0) this.samples = 0;
      else this.quality = Math.max(0.7, this.quality - 0.15);
    } else if (this.ft < 1 / 56 && now - (this.qUp || 0) > 4000) {
      this.qUp = now;
      if (this.quality < 1) this.quality = Math.min(1, this.quality + 0.1);
      else if (this.samples === 0) this.samples = 4;
    }
    if (this.quality !== prevQ) this.resize();
    if (this.samples !== prevS) this.freePost(); // rebuilt at the next draw
  }

  // The planet a tidally locked moon keeps one face toward: the one closest in tidal terms (smallest
  // distance / cube root of mass). Null for a world that is not locked.
  // Worlds without a set look are locked when tides would have locked them in the age of the Solar System:
  // a moon of a planet (not a planet of a star: Mercury's tides hold it in a 3:2 spin instead), with the
  // despinning time t ≈ 6 a⁶ R μ / (m M²) × 10¹⁰ yr (SI units, rigidity μ = 3×10¹⁰ Pa; Gladman et al.
  // 1996, Icarus 122, 166) under 4.5 billion years. That locks nearly every regular moon (Epimetheus in
  // centuries, our Moon in a few million years) and none of the far, irregular ones such as Phoebe (~10¹³ yr).
  // Rechecked every few seconds; moons do not move far enough to change it sooner.
  // For the info panel: what b would lock to (the body pulling hardest in tidal terms, a star too), how long
  // its tides would take, and whether it is locked now.
  lockInfo(world, b) {
    let par = null, best = Infinity;
    for (const o of world.bodies) {
      if (o === b || o.m <= b.m || o.kind === 'nebula' || !o.alive) continue;
      const k = Math.hypot(o.x - b.x, o.y - b.y, o.z - b.z) / Math.cbrt(o.m);
      if (k < best) { best = k; par = o; }
    }
    return { par, t: par && b.r > 0 ? lockTime(b, par) : Infinity, locked: !!this.tidalParent(world, b) };
  }

  tidalParent(world, b) {
    const l = this.look(b);
    if (l.locked === 0) return null;
    this.lockAt ||= new Map();
    const now = performance.now(), c = this.lockAt.get(b);
    if (!l.locked && c && now - c.t < 3000 && c.n === world.bodies.length) return c.par && c.par.alive !== false ? c.par : null;
    let par = null, best = Infinity;
    for (const o of world.bodies) {
      if (o === b || o.m <= b.m || o.kind === 'nebula') continue;
      const k = Math.hypot(o.x - b.x, o.y - b.y, o.z - b.z) / Math.cbrt(o.m);
      if (k < best) { best = k; par = o; }
    }
    if (l.locked) return par;
    let locked = null;
    if (par && b.kind === 'rocky' && !isLuminous(par) && par.kind !== 'bh' && par.kind !== 'wd' && par.kind !== 'ns' && b.r > 0) {
      if (lockTime(b, par) < 4.5e9) locked = par;
    }
    this.lockAt.set(b, { t: now, n: world.bodies.length, par: locked });
    return locked;
  }

  // Spin bodies (capped so fast time-warp doesn't strobe). Called by the main loop before the surface view
  // places its camera, so the camera and the ground below it turn together (it used to run here, after the
  // camera was set: the view lagged the ground by one frame's spin, which jittered with the frame time).
  stepSpins(world, simDt, dtReal, now) {
    this.spunAt = now;
    for (const b of world.bodies) {
      const l = this.look(b);
      let s = this.spin.get(b);
      if (!s) { s = { ang: seeded(b.id) * 6.28 }; this.spin.set(b, s); }
      if (l.locked || (l.locked === undefined && b.kind === 'rocky')) {
        // Tidally locked: the same face (body +x, longitude 0) always points at the parent planet.
        const par = this.tidalParent(world, b);
        if (par) { s.ang = Math.atan2(-(par.z - b.z), par.x - b.x); continue; }
      }
      const w = (Math.PI * 2) / Math.max(l.day * HOUR_YR, 1e-9);
      s.ang += Math.min(w * simDt, MAX_SPIN * dtReal) * Math.sign(l.day);
    }
  }

  draw(now, ui, dtReal, simDt) {
    if (this.lost) return;
    this.adaptQuality(dtReal, now);
    this.adaptEye(dtReal);
    this.genStep();
    const gl = this.gl, cam = this.cam, world = this.world;
    // The Pixel view renders at a fraction of the resolution and is upscaled with hard edges.
    const scale = this.settings.view === 'pixel' ? Math.max(2, Math.round(3 * this.dpr)) : 1;
    this.pixelScale = scale;
    const W = Math.max(1, Math.floor(this.canvas.width / scale)), H = Math.max(1, Math.floor(this.canvas.height / scale));
    if (this.canvas.width === 0 || this.canvas.height === 0) return;
    const dprSave = this.dpr;
    if (scale > 1) this.dpr = Math.max(0.5, this.dpr / scale);
    this.Hcur = H;
    try {
    if (!this.post || this.post.W !== W || this.post.H !== H) this.buildPost(W, H);
    this.sceneFB = this.post ? this.post.ms : null; this.sceneW = W; this.sceneH = H;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFB);
    gl.viewport(0, 0, W, H);
    gl.clearColor(0.004, 0.006, 0.013, 1);
    gl.clearDepth(1);
    gl.depthMask(true);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // Standing on a surface the ground starts at your feet: clip at 5 cm.
    const near = ui.surface ? 3.3e-13 : Math.max(1e-12, cam.dist * 1e-6), far = 1e15;
    this.P = perspective(cam.fov, W / H, near, far);
    this.V = new Float32Array([cam.rx, cam.ux, -cam.fx, cam.ry, cam.uy, -cam.fy, cam.rz, cam.uz, -cam.fz]);
    this.F = H / 2 / Math.tan(cam.fov / 2);
    this.logFC = 2 / Math.log2(far * 1e12 + 1); // matches DEPTH_K in shaders.js
    this.ex = cam.tx + cam.ox; this.ey = cam.ty + cam.oy; this.ez = cam.tz + cam.oz;

    this.surface = ui.surface || null;
    this.findLenses(world);
    if (this.settings.stars || this.surface) {
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);
      this.drawMilkyWay();
      this.drawSky();
    }
    if (!this.surface) this.drawNebulae(world, this.sceneFB, this.sceneW, this.sceneH);
    if (this.surface) this.drawSurfaceSky(this.surface);
    if (ui.zones && ui.zones.size && !this.surface) this.drawTempField(world, ui.zones);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);

    if (this.spunAt !== now) this.stepSpins(world, simDt, dtReal, now);
    // Cloud clock (days): follows the simulation, at most 0.4 days per real second so fast-forward
    // churns the weather without strobing.
    if (dtReal > 0 && dtReal < 1) this.cloudT = (this.cloudT || 0) + Math.min(Math.max(simDt || 0, 0) * 365.25, 0.4 * dtReal);

    // Ring geometry per planet, measured from its ring particles: plane, extent and a 16-bin opacity
    // profile (so gaps such as the Cassini Division show in the shadow the rings cast on the planet).
    // The rings change slowly: measured every 30 frames, or at once when particles are added or lost.
    this.ringFrame = (this.ringFrame || 0) + 1;
    // (Also when the ringed bodies are new ones: a reloaded preset has as many ring particles as before.)
    const stale = world.nr > 0 && this.ringInfo && !this.ringInfo.has(world.rHost[0]);
    if (!this.ringInfo || stale || this.ringNr !== world.nr || this.ringWorld !== world || this.ringFrame >= 30) {
      this.ringFrame = 0; this.ringNr = world.nr; this.ringWorld = world;
      this.ringInfo = new Map();
      const tmp = new Map();
      for (let i = 0; i < world.nr; i++) {
        const h = world.rHost[i];
        let r = tmp.get(h);
        if (!r) {
          const o = i * 6, B = world.rBasis;
          const n = [B[o + 1] * B[o + 5] - B[o + 2] * B[o + 4], B[o + 2] * B[o + 3] - B[o] * B[o + 5], B[o] * B[o + 4] - B[o + 1] * B[o + 3]];
          r = { n, rin: Infinity, rout: 0, ice: world.rk[i] === PK.ICE, counts: new Float32Array(16) };
          tmp.set(h, r);
        }
        const rad = world.rRad[i];
        if (rad < r.rin) r.rin = rad;
        if (rad > r.rout) r.rout = rad;
      }
      for (let i = 0; i < world.nr; i++) {
        const r = tmp.get(world.rHost[i]);
        r.counts[Math.min(15, Math.floor(((world.rRad[i] - r.rin) / (r.rout - r.rin + 1e-30)) * 16))]++;
      }
      for (const [h, r] of tmp) {
        let mx = 0;
        for (const c of r.counts) mx = Math.max(mx, c);
        r.prof = r.counts.map((c) => Math.min(0.92, (c / (mx || 1)) * 0.92));
        this.ringInfo.set(h, r);
      }
    }
    const glows = [];
    this.lumList = world.bodies.filter(isLuminous).sort((a, c) => c.lum - a.lum);
    // From the ground: the sky's bodies and their glows on their own (skyLayer), then composited through the
    // air (the veil), then the ground.
    const ground = this.surface ? this.surface.body : null;
    if (ground) {
      this.bindSkyLayer();
      // Nebulae in the sky, behind its bodies, seen through the air like them.
      if (world.bodies.some((x) => x.kind === 'nebula') || (world.remnants && world.remnants.length)) { this.drawNebulae(world, this.skyLayer.fbo, this.sceneW, this.sceneH); }
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
    }
    // (The star lighting the sky is drawn by the sky shader itself, at its full brightness.)
    const skyStar = ground ? this.surface.star : null;
    for (const b of world.bodies) if (b !== ground && b !== skyStar) this.drawBody(b, now, glows);
    if (ground) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.depthMask(false);
      gl.disable(gl.CULL_FACE);
      gl.colorMask(true, true, true, false);
      for (const g of glows) g();
      gl.colorMask(true, true, true, true);
      glows.length = 0;
      gl.depthMask(true);
      gl.disable(gl.BLEND);
      // Particles too (ring chunks, debris, gas): in the sky, seen through the air like the bodies (Saturn's
      // rings edge-on from Titan are hidden by its haze with Saturn).
      gl.enable(gl.DEPTH_TEST);
      this.drawParticles(false);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.depthMask(false);
      this.drawParticles(true);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFB);
      gl.viewport(0, 0, this.sceneW, this.sceneH);
      this.drawSurfaceSky(this.surface, true);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      this.drawBody(ground, now, glows);
      this.drawWeather(this.surface, now);
    }
    // Supernova light: a blinding point that fades over weeks.
    for (const t of world.transients) {
      const L = transientLum(t, world.t);
      const [x, y, z] = [(t.x - cam.tx) - cam.ox, (t.y - cam.ty) - cam.oy, (t.z - cam.tz) - cam.oz];
      const vp = this.viewOf(x, y, z);
      const depth = -vp[2];
      if (depth <= 0) continue;
      const px = Math.min(this.Hcur * 0.6, (12 + 14 * Math.log10(1 + L)) * this.dpr);
      const rgb = tempToRGB(t.temp).map((v) => (v / 255) * 1.6);
      glows.push(() => this.sprite(vp, (px * depth) / this.F, rgb, 0, 0, 1));
    }
    if (!ground) this.drawParticles(false);
    if (this.settings.grid && !this.surface) this.drawGrid();

    // Additive passes: atmospheres, disks, glows, hot particles.
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    for (const g of glows) g();
    if (!ground) this.drawParticles(true);
    this.drawGalaxyGlow();
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    if (this.post) this.finish();
    } finally {
      this.dpr = dprSave;
    }
  }

  rel(b) {
    return [(b.x - this.cam.tx) - this.cam.ox, (b.y - this.cam.ty) - this.cam.oy, (b.z - this.cam.tz) - this.cam.oz];
  }

  viewOf(x, y, z) {
    const V = this.V;
    return [V[0] * x + V[3] * y + V[6] * z, V[1] * x + V[4] * y + V[7] * z, V[2] * x + V[5] * y + V[8] * z];
  }

  // A sub-pixel world as a dot, brighter the more of its lit side faces us. Moons sitting on their planet's
  // dot are drawn smaller, so a planet seen from far away is not lost in a cluster of its moons.
  queueDot(b, vp, depth, l, minPx, glows) {
    const S = this.lumList && this.lumList[0];
    let k = 0.6;
    if (S && S !== b) {
      const L = this.viewOf(S.x - b.x, S.y - b.y, S.z - b.z), Ll = Math.hypot(L[0], L[1], L[2]) || 1, vl = Math.hypot(vp[0], vp[1], vp[2]) || 1;
      k = 0.5 * (1 - (L[0] * vp[0] + L[1] * vp[1] + L[2] * vp[2]) / (Ll * vl));
    }
    const c = l.colA || [0.6, 0.6, 0.6];
    const I = 0.25 + 0.9 * k;
    let px = minPx * 0.9;
    if (b.minor && b.host) {
      const h = b.host, hv = this.viewOf(h.x - b.x, h.y - b.y, h.z - b.z);
      const sep = (Math.hypot(hv[0], hv[1]) * this.F) / depth;  // pixels from its planet on screen
      px *= Math.max(0.45, Math.min(1, sep / (12 * this.dpr)));
    }
    const rgb = [c[0] * I, c[1] * I, c[2] * I];
    glows.push(() => this.sprite(vp, (px * depth) / this.F, rgb, 5, 0, 0));
  }

  // Planetshine: sunlight reflected by the planet a moon orbits lights its night side (earthshine on the
  // Moon, Saturnshine on Mimas). Its true strength, albedo × the planet's lit fraction seen from the moon ×
  // (R/d)², is ~1e-4 of sunlight for the Moon and ~3% for Mimas; it is compressed (to the power ¼) much as
  // the eye adapts, so it shows as the faint glow seen in photos (5% of daylight on the Moon, 23% on Mimas).
  // Returns [view direction, colour] or null.
  planetshine(b, sunCol) {
    const P = b.host && this.world.resolve(b.host), S = this.lumList && this.lumList[0];
    if (!P || !P.alive || isLuminous(P) || !S || P.r < 2 * b.r) return null;
    const dx = P.x - b.x, dy = P.y - b.y, dz = P.z - b.z, d = Math.hypot(dx, dy, dz);
    const sx = S.x - P.x, sy = S.y - P.y, sz = S.z - P.z, sd = Math.hypot(sx, sy, sz) || 1;
    const k = 0.5 * (1 - (sx * dx + sy * dy + sz * dz) / (sd * d));   // lit fraction of the planet facing b
    const alb = P.th && P.th.albedo ? P.th.albedo : P.kind === 'gas' ? 0.5 : 0.3;
    const g = alb * k * (P.r / d) ** 2;
    if (!(g > 1e-7)) return null;
    const c = (P.color || [200, 200, 200]).map((v) => v / 255), m = Math.max(c[0], c[1], c[2]) || 1;
    const I = 0.55 * Math.pow(g, 0.25);
    return [this.viewOf(dx / d, dy / d, dz / d), [sunCol[0] * I * c[0] / m, sunCol[1] * I * c[1] / m, sunCol[2] * I * c[2] / m]];
  }

  // Moonlight: the brightest moon's reflected sunlight on its planet's night side, by the same measure
  // (full Moon on Earth: albedo 0.12 × (1737/384400 km)² ≈ 2.5e-6 of sunlight, ~0.25 lux; shown at ~2% of
  // daylight after the compression, enough for moonlit clouds and seas as in night photos from orbit).
  moonshine(b, sunCol) {
    const S = this.lumList && this.lumList[0];
    if (!S || isLuminous(b)) return null;
    let best = null, bg = 1e-7;
    for (const m of this.world.bodies) {
      if (m.host !== b || !m.alive || isLuminous(m)) continue;
      const dx = m.x - b.x, dy = m.y - b.y, dz = m.z - b.z, d = Math.hypot(dx, dy, dz);
      const sx = S.x - m.x, sy = S.y - m.y, sz = S.z - m.z, sd = Math.hypot(sx, sy, sz) || 1;
      const k = 0.5 * (1 - (sx * dx + sy * dy + sz * dz) / (sd * d));   // lit fraction of the moon facing b
      const alb = m.th && m.th.albedo ? m.th.albedo : 0.2;
      const g = alb * k * (m.r / d) ** 2;
      if (g > bg) { bg = g; best = { m, dx, dy, dz, d }; }
    }
    if (!best) return null;
    const c = (best.m.color || [200, 200, 200]).map((v) => v / 255), mx = Math.max(c[0], c[1], c[2]) || 1;
    const I = 0.55 * Math.pow(bg, 0.25), d = best.d;
    return [this.viewOf(best.dx / d, best.dy / d, best.dz / d), [sunCol[0] * I * c[0] / mx, sunCol[1] * I * c[1] / mx, sunCol[2] * I * c[2] / mx]];
  }

  // The two brightest light sources seen from body b: view-space directions and colour * intensity.
  lightsFor(b) {
    const L = [];
    let flux = 0;
    for (const s of this.lumList || this.world.bodies) {
      if (s === b || !isLuminous(s)) continue;
      const dx = s.x - b.x, dy = s.y - b.y, dz = s.z - b.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      const f = s.lum / Math.max(d2, 1e-18);
      flux += f;
      L.push({ f, dx, dy, dz, d: Math.sqrt(d2), s });
    }
    for (const t of this.world.transients) {
      const dx = t.x - b.x, dy = t.y - b.y, dz = t.z - b.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      const f = transientLum(t, this.world.t) / Math.max(d2, 1e-18);
      flux += f;
      L.push({ f, dx, dy, dz, d: Math.sqrt(d2), s: { temp: t.temp } });
    }
    L.sort((a, c) => c.f - a.f);
    const out = [];
    for (let i = 0; i < 2; i++) {
      const l = L[i];
      if (!l) { out.push([0, 1, 0], [0, 0, 0]); continue; }
      const rgb = tempToRGB(l.s.temp || 5800).map((v) => 0.5 + 0.5 * (v / 255));
      // Light falls off as 1/d². Enhanced brightness: a much softer curve keeps the outer planets visible.
      // Realistic: the true falloff, times the eye's adaptation (eyeK, see adaptEye).
      const I = this.settings.brightness === 'realistic' ? 1.2 * l.f * (this.eyeK || 1)
        : 1.2 * Math.min(1.3, Math.max(0.55, Math.pow(l.f, 0.08)));
      out.push(this.viewOf(l.dx / l.d, l.dy / l.d, l.dz / l.d), rgb.map((v) => v * I));
    }
    return { dirs: out, flux, primary: L[0] };
  }

  // The tone curve (Settings): classic, or AgX with the scene's mid-tones placed where AgX expects mid-grey.
  toneUniforms(u) {
    const gl = this.gl;
    gl.uniform1f(u.uAgX, this.settings.tone === 'agx' ? 1 : 0);
    gl.uniform1f(u.uAgXExp, window.__agxExp || 0.8);
  }

  // Realistic brightness: the eye adapts to the starlight falling where the camera looks (on the body it
  // follows, else at the camera), partway (exposure ∝ flux^-0.7: a world far out still looks dimmer, ∝ flux^0.3,
  // Neptune ~13% of Earth), easing over about half a second as eyes and cameras do.
  adaptEye(dtReal) {
    if (this.settings.brightness !== 'realistic') { this.eyeK = 1; return; }
    const c = this.cam, t = c.follow && !this.surface ? c.follow : null;
    const px = t ? t.x : c.tx + c.ox, py = t ? t.y : c.ty + c.oy, pz = t ? t.z : c.tz + c.oz;
    const sb = this.surface ? this.surface.body : null;
    let flux = 0;
    for (const s of this.lumList || this.world.bodies) {
      if (!(s.lum > 0) || s === t) continue;
      const qx = (sb || { x: px }).x - s.x, qy = (sb || { y: py }).y - s.y, qz = (sb || { z: pz }).z - s.z;
      flux += s.lum / Math.max(qx * qx + qy * qy + qz * qz, 1e-18);
    }
    const target = Math.log(Math.min(1e4, Math.max(1e-3, Math.pow(Math.max(flux, 1e-12), -0.7))));
    const k = 1 - Math.exp(-Math.min(dtReal || 0.016, 0.25) / 0.6);
    this.eyeLog = this.eyeLog === undefined ? target : this.eyeLog + (target - this.eyeLog) * k;
    this.eyeK = Math.exp(this.eyeLog);
  }

  // Strongest tidal pull on b, as (Roche radius / distance)^3.
  tideFor(b) {
    let best = 0, dir = [0, 1, 0];
    for (const o of this.world.bodies) {
      if (o === b || o.m < 30 * b.m) continue;
      const dx = o.x - b.x, dy = o.y - b.y, dz = o.z - b.z;
      const d = Math.hypot(dx, dy, dz);
      const roche = b.r * Math.cbrt((2 * o.m) / b.m);
      const tau = Math.pow(roche / d, 3);
      if (tau > best) { best = tau; dir = [dx / d, dy / d, dz / d]; }
    }
    return { tau: best, dir };
  }

  // The world's surface map on the GPU (texture unit 5), uploaded when it changes (a photo replacing its
  // stand-in, a close-up map swapped in or out, painted rows).
  syncMapTex(b) {
    const gl = this.gl, sm = b.surfaceMap;
    if (!sm) return;
    let t = this.mapTex.get(b);
    if (!t) {
      t = { tex: gl.createTexture(), ver: -1 };
      this.mapTex.set(b, t);
      gl.bindTexture(gl.TEXTURE_2D, t.tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    if (t.ver !== sm.ver || t.sm !== sm) {
      if (sm.img) {
        // Image maps are only ever shown whole, often small on screen: mipmapped against shimmer.
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sm.img);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        this.aniso(8);
      } else if (t.ver < 0 || !sm.dirtyRows || t.W !== sm.W || t.sm !== sm) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, sm.W, sm.H, 0, gl.RGBA, gl.UNSIGNED_BYTE, sm.data);
      else {
        const [y0, y1] = sm.dirtyRows;
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, y0, sm.W, y1 - y0 + 1, gl.RGBA, gl.UNSIGNED_BYTE, sm.data.subarray(y0 * sm.W * 4, (y1 + 1) * sm.W * 4));
      }
      sm.dirtyRows = null;
      t.ver = sm.ver; t.W = sm.W; t.sm = sm; // (a new map object, e.g. a photo replacing its stand-in, is always re-uploaded)
    }
  }

  drawBody(b, now, glows) {
    const gl = this.gl, cam = this.cam;
    const [x, y, z] = this.rel(b);
    const vp = this.viewOf(x, y, z);
    const depth = -vp[2];
    const l = this.look(b);
    const dpr = this.dpr;
    const pxPerAU = this.F / Math.max(depth, 1e-30);
    let R = b.r;
    const minPx = l.kind === 2 || l.kind === 3 ? 3 * dpr : l.kind === 4 ? 4.5 * dpr : this.settings.trueSize ? 0.5 * dpr : (b.m > 1e-7 ? 2.4 : 1.6) * dpr;
    if (l.kind === 4) R = b.r * 2.6;
    if (b.kind === 'star') R *= 1 + 0.25 * Math.min(1, b.heat);
    if (b.kind === 'core') { this.queueCoreGlow(b, vp, depth, glows); return; }
    if (b.kind === 'nebula') return;   // (drawn before the bodies: drawNebulae)
    if (depth < -R * 2) return;
    const Rpx = R * pxPerAU;
    if (Rpx < minPx) R = minPx / pxPerAU;
    const shownPx = Math.max(Rpx, minPx);
    // Far smaller than a pixel: a lit dot shows all a full draw would (most of the moons, most of the time).
    if (l.kind === 0 && Rpx < 0.6 * dpr && depth > 0 && !(this.surface && this.surface.body === b)) { this.queueDot(b, vp, depth, l, minPx, glows); return; }
    const lod = this.surface && this.surface.body === b ? 3 : shownPx > (b.impacts ? 60 : 140) ? 2 : shownPx > 22 ? 1 : 0;

    const spin = this.spin.get(b);
    const rot = tiltSpin((l.tilt || 0) * D2R, spin ? spin.ang : 0);
    const lights = l.kind === 0 || l.kind === 1 ? this.lightsFor(b) : null;
    const tide = l.kind === 0 || l.kind === 1 || l.kind === 2 ? this.tideFor(b) : { tau: 0, dir: [0, 1, 0] };

    // Impacts: convert new hits into the body's own rotating frame so the scar turns with the surface.
    const imp = new Float32Array(64), impB = new Float32Array(64);
    let nImp = 0;
    if (b.impacts) {
      for (const h of b.impacts) {
        if (h.ox === undefined) {
          // inverse rotation = transpose; rot is column-major so row i of R is (rot[i], rot[i+3], rot[i+6])
          h.ox = rot[0] * h.x + rot[1] * h.y + rot[2] * h.z;
          h.oy = rot[3] * h.x + rot[4] * h.y + rot[5] * h.z;
          h.oz = rot[6] * h.x + rot[7] * h.y + rot[8] * h.z;
        }
        imp.set([h.ox, h.oy, h.oz, h.e], nImp * 4);
        impB.set([h.size, (now - h.t) / 1000, 0, 0], nImp * 4);
        nImp++;
      }
    }

    // Climate comes from the thermal model (distance, impacts, composition); see thermal.js.
    const th = b.th;
    const temp = th ? th.Ts : b.temp;
    const snowLat = th ? (th.ice > 0.97 ? -0.3 : 1 - th.ice) : 1.3; // caps cover the area above this sine of latitude
    const crack = l.kind === 0 ? Math.max(0, Math.min(1, (tide.tau - 0.3) / 0.5)) : 0;

    // Standing on this body: draw the local terrain instead of the globe.
    if (this.surface && this.surface.body === b && l.kind === 0) {
      // (standing on it: its close-up map, if it has one)
      if (b.surfaceMap && (b.surfaceMap.hi || b.surfaceMap.img)) { b.surfaceMap = hiMap(b.surfaceMap, 1e9); this.syncMapTex(b); }
      this.drawTerrain(b, l, rot, lights, temp);
      return;
    }

    const p = this.pBody, u = p.u;
    gl.useProgram(p.p);
    gl.uniformMatrix4fv(u.uProj, false, this.P);
    gl.uniformMatrix3fv(u.uView, false, this.V);
    gl.uniform3f(u.uCenter, x, y, z);
    gl.uniformMatrix3fv(u.uRot, false, new Float32Array(rot));
    gl.uniform1f(u.uRadius, R);
    gl.uniform3fv(u.uTideDir, tide.dir);
    gl.uniform1f(u.uTide, Math.min(0.45, 1.5 * tide.tau));
    gl.uniform1f(u.uLumpy, l.lumpy || 0);
    gl.uniform1f(u.uSeed, seeded(b.id) * 40);
    gl.uniform4fv(u.uImp, imp);
    gl.uniform4fv(u.uImpB, impB);
    gl.uniform1i(u.uImpN, nImp);
    gl.uniform1f(u.uLogDepthFC, this.logFC);
    gl.uniform1i(u.uKind, l.kind);
    gl.uniform1i(u.uSpectrum, this.spectrumMode());
    gl.uniform3fv(u.uColA, l.colA || [0.6, 0.6, 0.6]);
    gl.uniform3fv(u.uColB, l.colB || [0.4, 0.4, 0.4]);
    gl.uniform3fv(u.uColC, l.colC || [0.95, 0.96, 1]);
    gl.uniform1f(u.uOcean, th ? th.ocean : 0);
    // Giants show their bands, not a rocky planet's cloud deck. A haze too thick to see through (Titan's,
    // optical depth ~5) hides the ground from space just as a full cloud deck does.
    let cover = th && l.kind === 0 ? th.cloud : 0;
    const opt0 = l.kind === 0 ? atmosphereOptics(b) : null;
    if (l.kind === 0 && cover < 1 && opt0 && opt0.tauM > 3) cover = 1;
    gl.uniform1f(u.uCloud, cover);
    // The cloud deck: low (about 1.2 scale heights) for weather clouds, high (~4.4, Venus's tops at
    // ~70 km) for a planet-wide deck, which super-rotates (~100 m/s; Earth's winds aloft ~20 m/s).
    const deck = cover >= 0.95 ? 1 : 0;
    const Rm = b.r * 1.495978707e11;
    // (A planet-wide deck hides the ground anyway, so it sits just above it, where the air's glow is fitted.)
    const deckH = deck ? 0.0006 : Math.max(0.0015, Math.min(0.02, opt0 ? (1.2 * opt0.H) / Rm : 0.002));
    const wind = ((deck ? 100 : 20) / Rm) * 86400;
    gl.uniform1f(u.uCloudT, this.cloudT || 0); gl.uniform1f(u.uWind, wind); gl.uniform1f(u.uDeck, deck); gl.uniform1f(u.uDeckH, deckH);
    if (cover > 0.001) this.bindCloudTex(u, b, deck);
    // An image map already shows the real craters and lineae; procedural ones would double them.
    const imgMap = b.surfaceMap && b.surfaceMap.mode >= 5 && b.surfaceMap.mode !== 8;
    gl.uniform1f(u.uCraters, imgMap ? 0 : l.craters || 0);
    gl.uniform1f(u.uLife, b.life ? 1 : 0);
    gl.uniform1f(u.uBands, l.bands || 6);
    gl.uniform1f(u.uBandK, l.bandK ?? 0.7);
    gl.uniform1f(u.uVolc, l.volc || 0);
    gl.uniform1f(u.uLineae, imgMap ? 0 : l.lineae || 0);
    gl.uniform1f(u.uSpots, l.spots || 0);
    gl.uniform1f(u.uProfile, l.profile || (l.kind === 1 ? 5 : 0));   // (giants without a measured layout: the layered style)
    gl.uniform1f(u.uTintBands, l.tintBands ? 1 : 0);
    gl.uniform1f(u.uAurora, l.aurora || 0);
    gl.uniform1f(u.uPx, shownPx);
    gl.uniform1f(u.uSoft, l.atmo && l.kind === 0 ? 0.08 : 0.02);
    gl.uniform1f(u.uDayNight, l.kind === 1 ? 0.02 : l.atmo ? (l.cloud >= 1 ? 0.01 : 0.06) : 0.35);
    gl.uniform1f(u.uFacet, l.lumpy ? 0.85 : nImp ? 0.12 : 0);
    this.bindShape(u, b);
    gl.uniform1f(u.uTemp, temp);
    gl.uniform1f(u.uSnowLat, snowLat);
    gl.uniform1f(u.uIce, th && th.ice > 0.003 ? 1 : 0);
    gl.uniform1f(u.uLatSpan, th ? th.latSpan : 50);
    gl.uniform1f(u.uBoil, th ? th.boil : 373);
    gl.uniform1f(u.uHeat, 0); // impact heat is already part of the surface temperature
    gl.uniform3fv(u.uVeg, vegetationColor(b, lights));
    {
      // Topographic relief scales roughly as 1/g: Mars's volcanoes are 2.5x taller than Earth's mountains.
      const g = (6.674e-11 * b.m * 1.98847e30) / (b.r * 1.495978707e11) ** 2;
      gl.uniform1f(u.uRelief, Math.max(0.25, Math.min(1.6, (0.8 * 9.81) / Math.max(g, 0.1))));
    }
    gl.uniform1f(u.uHex, l.hex || 0);
    // Convection cells: ~40 across the Sun's disc (shown as fine texture), a handful on supergiants.
    gl.uniform1f(u.uGran, Math.max(3.5, Math.min(40, 40 / Math.sqrt(Math.max(1, b.r / 0.00465)))));
    // Surface maps: Earth's geography and the Moon's maria are built in; painting adds one to any world.
    if (/^Earth( \d+)?$/.test(b.name) && b.kind === 'rocky') {
      const er = earthReal();
      // The real map replaces the stand-in as soon as it is ready, unless the stand-in was painted.
      if (er && er.W && (!b.surfaceMap || (b.surfaceMap.standIn && b.surfaceMap.ver === 1))) b.surfaceMap = { mode: 1, W: er.W, H: er.H, data: er.data.slice(), ver: 2 };
      else if (!b.surfaceMap) b.surfaceMap = { mode: 1, W: 512, H: 256, data: (EARTH_MAP ||= earthMap()).slice(), ver: 1, standIn: true };
    }
    if (/^Moon( \d+)?$/.test(b.name) && b.kind === 'rocky') {
      // The LRO global map; the hand-placed maria stand in until it loads.
      const pm = photoMap(b);
      if (pm && (!b.surfaceMap || b.surfaceMap.standIn)) b.surfaceMap = pm;
      else if (!b.surfaceMap) b.surfaceMap = { mode: 2, W: 512, H: 256, data: (MOON_MAP ||= moonMap()).slice(), ver: 1, standIn: true };
    }
    if (!b.surfaceMap) b.surfaceMap = photoMap(b) || undefined;
    if (b.surfaceMap && (b.surfaceMap.hi || b.surfaceMap.img)) b.surfaceMap = hiMap(b.surfaceMap, shownPx / Math.max(this.dpr || 1, 0.5));
    const sm = b.surfaceMap;
    if (sm) {
      this.syncMapTex(b);
      gl.activeTexture(gl.TEXTURE5);
      gl.bindTexture(gl.TEXTURE_2D, this.mapTex.get(b).tex);
      gl.uniform1i(u.uMap, 5);
      gl.activeTexture(gl.TEXTURE0);
    }
    gl.uniform1f(u.uMapMode, sm ? sm.mode : 0);
    this.bindDonor(u, b, l);
    this.bindEarthDay(u, b, th);
    this.bindHeight(u, b, true);
    this.bindGen(u, b, shownPx);
    // A donor already brings real craters; keep only a trace of the generated ring-shaped ones.
    if (b.donor && !imgMap) gl.uniform1f(u.uCraters, (l.craters || 0) * 0.3);
    const city = /^Earth( \d+)?$/.test(b.name) && b.life && (b.lifeAge || 0) > 3.7e9;
    gl.uniform1f(u.uCity, city ? 1 : 0);
    // Where the lights are: NASA Black Marble (city lights only, the moonlit ground and snow removed).
    const night = city ? loadImage('earth-night') : null;
    if (night) {
      if (!this.nightTex) {
        this.nightTex = gl.createTexture();
        gl.activeTexture(gl.TEXTURE6);
        gl.bindTexture(gl.TEXTURE_2D, this.nightTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, night);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      }
      gl.activeTexture(gl.TEXTURE6);
      gl.bindTexture(gl.TEXTURE_2D, this.nightTex);
      gl.uniform1i(u.uNight, 6);
      gl.activeTexture(gl.TEXTURE0);
    }
    gl.uniform1f(u.uNightMap, night ? 1 : 0);
    // Eclipses: up to four bodies that sit between this one and its light, nearest the light path first.
    {
      const P = lights && lights.primary;
      let nOcc = 0;
      const occ = this.occBuf || (this.occBuf = new Float32Array(16));
      if (P && P.d > 0) {
        const Lx = P.dx / P.d, Ly = P.dy / P.d, Lz = P.dz / P.d;
        const sunR = P.s && P.s.r ? P.s.r : 0.00465;
        const sunAng = sunR / P.d;
        gl.uniform1f(u.uSunAng, sunAng);
        const cand = [];
        for (const o of this.world.bodies) {
          if (o === b || !(o.r > 0) || isLuminous(o) || o.kind === 'core' || o.kind === 'nebula') continue;
          const ox = o.x - b.x, oy = o.y - b.y, oz = o.z - b.z;
          const t = ox * Lx + oy * Ly + oz * Lz;
          if (t <= 0 || t > P.d) continue;
          const lat2 = ox * ox + oy * oy + oz * oz - t * t;
          const reach = b.r + o.r + t * sunAng;
          if (lat2 < reach * reach) cand.push([lat2, o]);
        }
        cand.sort((a, c) => a[0] - c[0]);
        const atmB = this.occAtm || (this.occAtm = new Float32Array(4));
        for (const [, o] of cand.slice(0, 4)) {
          occ.set([o.x - this.ex, o.y - this.ey, o.z - this.ez, o.r], nOcc * 4);
          // Air bends sunset-red light into the shadow: fully for Earth's 1 bar or a giant's deep atmosphere.
          atmB[nOcc] = o.kind === 'gas' ? 0.6 : o.atm && o.atm.p > 0 ? Math.min(1, Math.sqrt(o.atm.p)) : 0;
          nOcc++;
        }
        gl.uniform1fv(u.uOccAtm, atmB);
      }
      gl.uniform4fv(u.uOcc, occ);
      gl.uniform1i(u.uOccN, nOcc);
    }
    const ring = this.ringInfo && this.ringInfo.get(b);
    if (ring) {
      const nv = this.viewOf(ring.n[0], ring.n[1], ring.n[2]);
      gl.uniform3f(u.uRingN, nv[0], nv[1], nv[2]);
      gl.uniform2f(u.uRingR, ring.rin / b.r, ring.rout / b.r);
      gl.uniform1fv(u.uRingProf, ring.prof);
    } else gl.uniform3f(u.uRingN, 0, 0, 0);
    gl.uniform1f(u.uCrack, crack);
    gl.uniform1f(u.uTime, now / 1000);
    // A colour map already holds the real storms (the Great Red Spot, the white ovals).
    gl.uniform4fv(u.uStorm, l.storm && !(sm && sm.mode === 6) ? l.storm : [0, 0, 1, 0]);
    const ld = lights ? lights.dirs : [[0, 1, 0], [0, 0, 0], [0, 1, 0], [0, 0, 0]];
    gl.uniform3fv(u.uL0, ld[0]); gl.uniform3fv(u.uLc0, ld[1]);
    gl.uniform3fv(u.uL1, ld[2]); gl.uniform3fv(u.uLc1, ld[3]);
    const bounce = lights ? this.planetshine(b, ld[1]) || this.moonshine(b, ld[1]) : null;
    gl.uniform3fv(u.uL2, bounce ? bounce[0] : [0, 1, 0]); gl.uniform3fv(u.uLc2, bounce ? bounce[1] : [0, 0, 0]);
    // Atmosphere: physically based scattering from the gas mix (js/optics.js); for giant planets, the
    // hydrogen and haze above their cloud tops.
    const optics = l.kind === 0 ? atmosphereOptics(b) : l.kind === 1 ? giantOptics(b) : null;
    let atmo = optics ? null : l.atmo || null, atmoK = l.atmoK ?? 0.5;
    if (!optics && b.atm && l.kind === 0) atmo = null;
    // A hot world's atmosphere glows orange.
    const hotK = Math.min(1, Math.max(0, (temp - 600) / 900));
    if (atmo && hotK > 0) atmo = atmo.map((v, i) => v + ([1, 0.45, 0.15][i] - v) * hotK);
    gl.uniform3fv(u.uAtmo, atmo || [0, 0, 0]);
    gl.uniform1f(u.uAtmoK, atmo ? atmoK : 0);
    const g = this.spheres[lod];
    gl.bindVertexArray(g.vao);
    gl.drawElements(gl.TRIANGLES, g.n, g.type, 0);

    // The cloud layer: its own shell just above the ground, alpha-blended, under the atmosphere's glow.
    if (cover > 0.001 && shownPx > 3 && !(this.surface && this.surface.body === b) && Math.hypot(x, y, z) > R * (1 + deckH) * 1.0005) {
      const lc = ld.map((v) => Array.from(v)), colC = l.colC || [0.95, 0.96, 1];
      glows.push(() => {
        const c = this.pCloud, cu = c.u;
        gl.enable(gl.CULL_FACE);
        gl.cullFace(gl.BACK);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.useProgram(c.p);
        gl.uniformMatrix4fv(cu.uProj, false, this.P);
        gl.uniformMatrix3fv(cu.uView, false, this.V);
        gl.uniform3f(cu.uCenter, x, y, z);
        gl.uniformMatrix3fv(cu.uRot, false, new Float32Array(rot));
        gl.uniform1f(cu.uRadius, R * (1 + deckH));
        gl.uniform3fv(cu.uTideDir, tide.dir);
        gl.uniform1f(cu.uTide, Math.min(0.45, 1.5 * tide.tau));
        gl.uniform1i(cu.uImpN, 0);
        gl.uniform1f(cu.uLumpy, 0);
        gl.uniform1f(cu.uLogDepthFC, this.logFC);
        gl.uniform3fv(cu.uL0, lc[0]); gl.uniform3fv(cu.uLc0, lc[1]); gl.uniform3fv(cu.uL1, lc[2]); gl.uniform3fv(cu.uLc1, lc[3]);
        gl.uniform3fv(cu.uColC, colC);
        gl.uniform1f(cu.uCloud, cover); gl.uniform1f(cu.uSeed, seeded(b.id) * 40); gl.uniform1f(cu.uPx, shownPx);
        gl.uniform1i(cu.uSpectrum, this.spectrumMode()); gl.uniform1f(cu.uTempC, temp);
        gl.uniform1f(cu.uTime, performance.now() / 1000); gl.uniform1f(cu.uEcl, 0);
        gl.uniform1f(cu.uCloudT, this.cloudT || 0); gl.uniform1f(cu.uWind, wind); gl.uniform1f(cu.uDeck, deck);
        this.bindCloudTex(cu, b, deck);
        gl.bindVertexArray(g.vao);
        gl.drawElements(gl.TRIANGLES, g.n, g.type, 0);
        gl.blendFunc(gl.ONE, gl.ONE);
        gl.disable(gl.CULL_FACE);
      });
    }
    // Glows and other additive layers, drawn after all solid bodies.
    if ((atmo || optics) && shownPx > 3 && !(this.surface && this.surface.body === b)) {
      // Seen from afar a real atmosphere is thinner than a pixel (Earth's is 1% of its radius): stretch it to
      // stay about 2.5 pixels wide, keeping its colours (see stretchOptics). Close up it is drawn to scale.
      const thick = optics ? (atmosphereTop(optics) - 1) * shownPx : 0;
      const opt = optics && thick > 0 && thick < 2.5 * dpr ? stretchOptics(optics, Math.min(30, (2.5 * dpr) / thick)) : optics;
      const top = optics ? shellTop(opt) : l.kind === 1 ? 1.015 : 1.035;
      // Inside the shell (low orbit): draw its far side without depth testing; the shader stops rays at
      // the ground itself. Outside: the near side, depth tested so moons in front hide it.
      const inside = Math.hypot(x, y, z) < R * top;
      glows.push(() => {
        const a = optics ? this.pAtmo : this.pRim, au = a.u;
        gl.enable(gl.CULL_FACE);
        gl.cullFace(inside ? gl.FRONT : gl.BACK);
        if (inside) gl.disable(gl.DEPTH_TEST);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.useProgram(a.p);
        gl.uniformMatrix4fv(au.uProj, false, this.P);
        gl.uniformMatrix3fv(au.uView, false, this.V);
        gl.uniform3f(au.uCenter, x, y, z);
        gl.uniformMatrix3fv(au.uRot, false, new Float32Array(rot));
        gl.uniform1f(au.uRadius, R * top);
        gl.uniform3fv(au.uTideDir, tide.dir);
        gl.uniform1f(au.uTide, Math.min(0.45, 1.5 * tide.tau));
        gl.uniform1i(au.uImpN, 0);
        gl.uniform1f(au.uLumpy, 0);
        gl.uniform1f(au.uLogDepthFC, this.logFC);
        gl.uniform3fv(au.uL0, ld[0]);
        if (optics) {
          setOpticsUniforms(gl, au, opt, 14);
          gl.uniform3fv(au.uCenterV, this.viewOf(x, y, z));
          gl.uniform1f(au.uPR, R);
          // (Other bands: air scatters ultraviolet strongly and glows faintly in infrared; X-rays pass unseen.)
          const band = this.spectrumMode(), bandK = [1, 0.25, 2.2, 0][band];
          gl.uniform1f(au.uExpo, 5.5 * bandK * (ld[1][0] + ld[1][1] + ld[1][2] > 0 ? 1 : 0));
          gl.uniform3fv(au.uHot, [1, 0.45, 0.15].map((v) => v * hotK * 0.6));
          gl.uniform1f(au.uDiscK, l.kind === 1 ? 0.25 : 1);
          // Airglow at night-photo exposure, as the city lights are; brighter in the infrared (the hydroxyl
          // bands outshine the green line there), faint in ultraviolet.
          const gk = [1, 3, 0.3, 0][band], gw = opt.glow;
          gl.uniform4f(au.uGlow, gw ? gw[0] * gk : 0, gw ? gw[1] * gk : 0, gw ? gw[2] * gk : 0, gw ? gw[3] : 0);
          gl.uniform1f(au.uGlowW, gw ? gw[4] : 1);
        } else {
          gl.uniform3fv(au.uAtmo, atmo);
          gl.uniform1f(au.uAtmoK, atmoK);
        }
        gl.bindVertexArray(g.vao);
        gl.drawElements(gl.TRIANGLES, g.n, g.type, 0);
        gl.blendFunc(gl.ONE, gl.ONE);
        gl.enable(gl.DEPTH_TEST);
        gl.cullFace(gl.BACK);
        gl.disable(gl.CULL_FACE);
      });
    }
    // Rings drawn by the ring layer inside this frame (WebGPU renderer: same target, same depth buffer).
    if (ring && shownPx > 2 && this.ringHook && this.gpuHosts && this.gpuHosts.has(b)) glows.push(() => this.ringHook(b));
    // Rings as a smooth sheet (the particles are shown too when the camera is among them).
    // With the GPU chunks it fills in only close up, where they fade (uChunkPx).
    const chunkR = this.gpuHosts && this.gpuHosts.has(b) && this.chunkR ? this.chunkR.get(b) || 0 : 0;
    if (ring && shownPx > 2 && (!(this.gpuHosts && this.gpuHosts.has(b)) || chunkR > 0)) {
      glows.push(() => {
        const rp = this.pRing, ru = rp.u, n = ring.n;
        const a0 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
        let ux = [n[1] * a0[2] - n[2] * a0[1], n[2] * a0[0] - n[0] * a0[2], n[0] * a0[1] - n[1] * a0[0]];
        const ul = Math.hypot(...ux); ux = ux.map((v) => v / ul);
        const vx = [n[1] * ux[2] - n[2] * ux[1], n[2] * ux[0] - n[0] * ux[2], n[0] * ux[1] - n[1] * ux[0]];
        const ro = ring.rout * 1.01;
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.useProgram(rp.p);
        gl.uniformMatrix4fv(ru.uProj, false, this.P);
        gl.uniform3fv(ru.uCenter, vp);
        gl.uniform3fv(ru.uAxU, this.viewOf(ux[0] * ro, ux[1] * ro, ux[2] * ro));
        gl.uniform3fv(ru.uAxV, this.viewOf(vx[0] * ro, vx[1] * ro, vx[2] * ro));
        gl.uniform3fv(ru.uNv, this.viewOf(n[0], n[1], n[2]));
        gl.uniform3fv(ru.uL0, ld[0]);
        gl.uniform3fv(ru.uLight, ld[1]);
        gl.uniform3fv(ru.uPlanetV, vp);
        gl.uniform1f(ru.uPR, b.r);
        gl.uniform1f(ru.uRin, ring.rin / ro);
        gl.uniform1fv(ru.uProf, ring.prof);
        gl.uniform3fv(ru.uTint, ring.ice ? [0.84, 0.79, 0.7] : [0.5, 0.46, 0.42]);
        gl.uniform1f(ru.uSaturn, /^Saturn( \d+)?$/.test(b.name) ? 1 : 0);
        // The four biggest moons within reach of the rings, for their shadows on them.
        const moons = [];
        for (const m of this.world.bodies) {
          if (m === b || !m.alive || !(m.r > 0) || isLuminous(m) || m.kind === 'nebula' || Math.hypot(m.x - b.x, m.y - b.y, m.z - b.z) > ring.rout * 10) continue;
          moons.push(m);
        }
        moons.sort((p, q) => q.r - p.r);
        const ms = new Float32Array(16);
        for (let i = 0; i < Math.min(4, moons.length); i++) {
          const m = moons[i];
          ms.set([...this.viewOf(m.x - this.ex, m.y - this.ey, m.z - this.ez), m.r], i * 4);
        }
        gl.uniform4fv(ru.uMoonS, ms);
        gl.uniform1i(ru.uMoonN, Math.min(4, moons.length));
        gl.uniform1f(ru.uChunkPx, (chunkR * this.F) / this.dpr);
        gl.uniform1f(ru.uLogDepthFC, this.logFC);
        gl.bindVertexArray(this.quad);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.blendFunc(gl.ONE, gl.ONE);
      });
    }
    if (l.kind === 2 || l.kind === 3) {
      const L = Math.max(b.lum, 1e-4);
      const glowPx = Math.max(shownPx * 3.2, (6 + 4.5 * Math.log10(1 + L * 10)) * dpr) * (1 + 0.6 * Math.min(1, b.heat));
      const rgb = tempToRGB(b.temp).map((v) => v / 255);
      // (No diffraction spikes: stars show as round glows.)
      glows.push(() => this.sprite(vp, glowPx / pxPerAU, rgb.map((v) => v * (this.post ? 0.75 : 1.1)), 0, 0, 0));
      if (b.kind === 'ns') {
        const ang = now * 0.004;
        glows.push(() => this.sprite(vp, (glowPx * 2.6) / pxPerAU, [0.6, 0.75, 1], 3, ang, 0));
      }
    }
    if (l.kind === 4) {
      const heat = Math.min(1, b.heat);
      glows.push(() => {
        this.disk(vp, R, heat, now);
        this.sprite(vp, R * 1.9, [1, 0.75, 0.45].map((v) => v * (0.7 + 0.4 * heat)), 2, 0, 1 / 1.9);
        // Lensed far side of the disk and the photon ring, oriented by the disk's axis on screen.
        const n = this.viewOf(0, 1, 0);
        const edgeOn = 1 - Math.min(1, Math.abs(n[2]));
        this.sprite(vp, R * 3.8, [1, 0.86, 0.68].map((v) => v * (0.55 + 0.5 * heat)), 4, Math.atan2(n[1], n[0]) - Math.PI / 2, edgeOn);
      });
    }
  }

  queueCoreGlow(b, vp, depth, glows) {
    const pxPerAU = this.F / Math.max(depth, 1e-30);
    const size = Math.max(b.soft * 0.9 * pxPerAU, 6 * this.dpr) / pxPerAU;
    const col = (b.color || [255, 226, 180]).map((v) => (v / 255) * 0.9);
    glows.push(() => this.sprite(vp, size, col, 1, 0, 0));
    glows.push(() => this.sprite(vp, size * 0.12, [1, 0.95, 0.85], 0, 0, 1));
  }

  sprite(vp, size, color, type, angle, inner) {
    const gl = this.gl, s = this.pSprite, u = s.u;
    gl.useProgram(s.p);
    gl.uniformMatrix4fv(u.uProj, false, this.P);
    gl.uniform3fv(u.uCenter, vp);
    gl.uniform1f(u.uSize, size);
    gl.uniform1f(u.uAngle, angle);
    gl.uniform3fv(u.uColor, color);
    gl.uniform1i(u.uType, type);
    gl.uniform1f(u.uInner, inner);
    gl.uniform1f(u.uLogDepthFC, this.logFC);
    gl.bindVertexArray(this.quad);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  // Accretion disk in the black hole's equatorial plane (world x-z), sized from the shadow radius.
  disk(vp, shadow, heat, now) {
    const gl = this.gl, d = this.pDisk, u = d.u;
    const outer = shadow * 3.4;
    const ax = this.viewOf(outer, 0, 0), az = this.viewOf(0, 0, outer);
    gl.useProgram(d.p);
    gl.uniformMatrix4fv(u.uProj, false, this.P);
    gl.uniform3fv(u.uCenter, vp);
    gl.uniform3fv(u.uAxU, ax);
    gl.uniform3fv(u.uAxV, az);
    gl.uniform1f(u.uInner, 1.25 / 3.4);
    gl.uniform1f(u.uTime, now / 1000);
    gl.uniform1f(u.uHeat, 0.35 + heat);
    gl.uniform1f(u.uLogDepthFC, this.logFC);
    gl.bindVertexArray(this.quad);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  drawSky() {
    if (!this.sky.fromCatalog && starCatalog()) this.sky = this.makeSky();   // (the catalogue has arrived)
    const gl = this.gl, s = this.pSky, u = s.u;
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(s.p);
    gl.uniformMatrix4fv(u.uProj, false, this.P);
    gl.uniformMatrix3fv(u.uView, false, this.V);
    // (realistic brightness: the dark-adapted eye sees the stars a little brighter far from any sun)
    gl.uniform1f(u.uStarK, Math.min(3, Math.max(1, Math.pow(this.eyeK || 1, 0.2))));
    this.setLensUniforms(u);
    gl.bindVertexArray(this.sky.vao);
    gl.uniform1i(u.uImage, 0);
    gl.drawArrays(gl.POINTS, 0, this.sky.n);
    // Second images, inside the Einstein rings.
    if (this.lenses && this.lenses.length) { gl.uniform1i(u.uImage, 1); gl.drawArrays(gl.POINTS, 0, this.sky.n); }
    gl.disable(gl.BLEND);
    gl.depthMask(true);
  }

  // Free particles and ring debris. Solid chunks are lit and shadowed; hot gas and stars glow.
  drawParticles(glowPass) {
    const gl = this.gl;
    const set = glowPass ? this.dynGlow : this.dyn;
    if (!glowPass) this.buildParticles();
    if (set.n === 0) return;
    this.upload(set);
    const p = this.pPoints, u = p.u;
    gl.useProgram(p.p);
    gl.uniformMatrix4fv(u.uProj, false, this.P);
    gl.uniformMatrix3fv(u.uView, false, this.V);
    gl.uniform1f(u.uF, this.F);
    gl.uniform1f(u.uMinPx, (glowPass ? 2 : 1.1) * this.dpr);
    gl.uniform1f(u.uMaxPx, 64 * this.dpr);
    gl.uniform1i(u.uGlow, glowPass ? 1 : 0);
    gl.uniform3fv(u.uLight, this.particleLight || [0, 0, 1]);
    gl.uniform1f(u.uLogDepthFC, this.logFC);
    gl.bindVertexArray(set.vao);
    gl.drawArrays(gl.POINTS, 0, set.n);
  }

  buildParticles() {
    const world = this.world, cam = this.cam;
    const solid = this.dyn, glow = this.dynGlow;
    const total = world.np + world.nr;
    this.ensure(solid, total);
    this.ensure(glow, total);
    let ns = 0, ng = 0;
    const tx = cam.tx + cam.ox, ty = cam.ty + cam.oy, tz = cam.tz + cam.oz;
    const add = (x, y, z, kind, size, shade, k) => {
      const c = PARTICLE_RGB[kind];
      const v = 0.82 + 0.36 * ((k * 0.61803) % 1);
      if (GLOW_KINDS.has(kind)) {
        glow.pos[ng * 3] = x; glow.pos[ng * 3 + 1] = y; glow.pos[ng * 3 + 2] = z;
        // (Supernova ejecta: faint knots once the remnant's own volume draws the shell; bright before it.)
        const a = kind === PK.HOT ? 0.45 : kind >= PK.SN_H ? (world.remnants && world.remnants.length ? 0.3 : 1.1) : 0.55;
        glow.col[ng * 3] = c[0] * a * v; glow.col[ng * 3 + 1] = c[1] * a * v; glow.col[ng * 3 + 2] = c[2] * a * v;
        glow.size[ng] = kind === PK.HOT ? size : 0;
        glow.shade[ng] = 1;
        ng++;
      } else {
        solid.pos[ns * 3] = x; solid.pos[ns * 3 + 1] = y; solid.pos[ns * 3 + 2] = z;
        solid.col[ns * 3] = c[0] * v; solid.col[ns * 3 + 1] = c[1] * v; solid.col[ns * 3 + 2] = c[2] * v;
        solid.size[ns] = size;
        solid.shade[ns] = shade;
        ns++;
      }
    };
    const px = world.px, py = world.py, pz = world.pz, pm = world.pm, pk = world.pk;
    // From the ground only what is near the world shows (debris of an impact overhead): the sky's own light
    // lies in front of anything far, and drawn over it a sunlit asteroid would be a dark speck in the blue.
    const sb = this.surface ? this.surface.body : null, reach2 = sb ? (50 * sb.r) ** 2 : 0;
    for (let i = 0; i < world.np; i++) {
      if (sb && (px[i] - sb.x) ** 2 + (py[i] - sb.y) ** 2 + (pz[i] - sb.z) ** 2 > reach2) continue;
      const m = pm[i];
      const h = ((i * 2654435761) >>> 0) / 4294967296;
      // Chunk radius from its mass at rock density; massless belt particles get 30-120 km.
      const size = m > 0 ? Math.cbrt(m * 2.567e-8) : (2e-7 + h * 6e-7);
      add(px[i] - tx, py[i] - ty, pz[i] - tz, pk[i], size, 1, i);
    }
    // Ring debris: shadowed where the planet blocks the Sun.
    const tmp = [0, 0, 0, 0, 0, 0];
    const hostLight = new Map();
    this.particleLight = null;
    // Standing on a ringed world, the sky shader draws its rings as a smooth arc instead.
    const skip = this.surface ? this.surface.body : null;
    // Far from a ring the smooth ring sheet stands in for its particles.
    const far = new Map();
    for (let i = 0; i < world.nr; i++) {
      const host = world.rHost[i];
      if (host === skip || (this.gpuHosts && this.gpuHosts.has(host))) continue;   // drawn by the WebGPU layer
      let f = far.get(host);
      if (f === undefined) {
        const ri = this.ringInfo && this.ringInfo.get(host);
        f = !!ri && Math.hypot(host.x - this.ex, host.y - this.ey, host.z - this.ez) > 1.25 * ri.rout;
        far.set(host, f);
      }
      if (f) continue;
      let hl = hostLight.get(host);
      if (!hl) {
        const L = this.lightsFor(host).primary;
        hl = L ? [L.dx / L.d, L.dy / L.d, L.dz / L.d] : [0, 1, 0];
        hostLight.set(host, hl);
        if (!this.particleLight) this.particleLight = this.viewOf(hl[0], hl[1], hl[2]);
      }
      world.ringPosition(i, tmp);
      const rx = tmp[0] - host.x, ry = tmp[1] - host.y, rz = tmp[2] - host.z;
      const along = rx * hl[0] + ry * hl[1] + rz * hl[2];
      let shade = 1;
      if (along < 0) {
        const perp2 = rx * rx + ry * ry + rz * rz - along * along;
        if (perp2 < host.r * host.r) shade = 0;
      }
      const h = ((i * 2246822519) >>> 0) / 4294967296;
      add(tmp[0] - tx, tmp[1] - ty, tmp[2] - tz, world.rk[i], 1.5e-7 + h * h * h * 9e-7, shade, i + 7);
    }
    if (!this.particleLight) {
      const L = world.bodies.find(isLuminous);
      if (L) {
        const dx = L.x - cam.tx, dy = L.y - cam.ty, dz = L.z - cam.tz, d = Math.hypot(dx, dy, dz) || 1;
        this.particleLight = this.viewOf(dx / d, dy / d, dz / d);
      }
    }
    solid.n = ns;
    glow.n = ng;
  }

  drawGrid() {
    const gl = this.gl, cam = this.cam;
    const l = Math.log10(cam.dist / 1.5);
    const s = Math.pow(10, Math.floor(l));
    const N = 10, ext = N * s, SEG = 10;
    const cx = Math.round(cam.tx / s) * s, cz = Math.round(cam.tz / s) * s, y = cam.ty;
    const set = this.dynLines;
    const segs = (2 * N + 1) * 2 * SEG * 2;
    this.ensure(set, segs * 2);
    let n = 0;
    const ex = this.ex, ey = this.ey, ez = this.ez;
    const push = (x, z, a, major) => {
      set.pos[n * 3] = x - ex; set.pos[n * 3 + 1] = y - ey; set.pos[n * 3 + 2] = z - ez;
      const k = a * (major ? 0.2 : 0.1);
      set.col[n * 3] = 0.47 * k; set.col[n * 3 + 1] = 0.6 * k; set.col[n * 3 + 2] = 0.86 * k;
      n++;
    };
    for (let i = -N; i <= N; i++) {
      const majorX = Math.round((cx + i * s) / s) % 10 === 0;
      const majorZ = Math.round((cz + i * s) / s) % 10 === 0;
      for (let k = 0; k < SEG * 2; k++) {
        const a = -ext + (k * ext) / SEG, b = a + ext / SEG;
        const fa = Math.max(0, 1 - Math.hypot(i * s, a) / ext), fb = Math.max(0, 1 - Math.hypot(i * s, b) / ext);
        if (fa <= 0 && fb <= 0) continue;
        push(cx + i * s, cz + a, fa, majorX); push(cx + i * s, cz + b, fb, majorX);
        const fa2 = Math.max(0, 1 - Math.hypot(a, i * s) / ext), fb2 = Math.max(0, 1 - Math.hypot(b, i * s) / ext);
        push(cx + a, cz + i * s, fa2, majorZ); push(cx + b, cz + i * s, fb2, majorZ);
      }
    }
    set.n = n;
    this.upload(set);
    const p = this.pLines, u = p.u;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.depthMask(false);
    gl.useProgram(p.p);
    gl.uniformMatrix4fv(u.uProj, false, this.P);
    gl.uniformMatrix3fv(u.uView, false, this.V);
    gl.uniform1f(u.uLogDepthFC, this.logFC);
    gl.bindVertexArray(set.vao);
    gl.drawArrays(gl.LINES, 0, n);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }
}
