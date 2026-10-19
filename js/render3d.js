import { PK } from './physics.js';
import { isLuminous, tempToRGB, schwarzschild } from './bodies.js';
import { transientLum } from './stellar.js';
import { EARTH_MASS } from './units.js';
import { ATMO_FS, BODY_FS, BODY_VS, DISK_FS, DISK_VS, LINES_FS, LINES_VS, POINTS_FS, POINTS_VS, SKY_FS, SKY_VS, SPRITE_FS, SPRITE_VS, FULL_VS, MILKYWAY_FS, DOWN_FS, UP_FS, COMPOSITE_FS, PIXEL_FS, SURFACE_SKY_FS, TEMP_FIELD_FS, RIM_FS, TERRAIN_VS, TERRAIN_FS, RING_FS, CLOUD_FS, GEN_FS, SURFACE_CLOUD_FS } from './shaders.js';
import { atmosphereOptics, setOpticsUniforms, stretchOptics, atmosphereTop, groundLight } from './optics.js';
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
function photoMap(b) {
  const p = PHOTO.find(([re, , , kind]) => re.test(b.name) && b.kind === kind);
  if (!p) return null;
  const img = loadImage(p[1], p[4]);
  return img ? { mode: p[2], img, W: img.width, H: img.height, ver: 1 } : null;
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
const HEIGHTS = { Earth: 'earth', Moon: 'moon', Mars: 'mars', Venus: 'venus', Mercury: 'mercury' };
const HEIGHT_G = { earth: 9.81, moon: 1.62, mars: 3.71, venus: 8.87, mercury: 3.70 };   // surface gravity, m/s²
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
const SHAPES = { Phobos: 'phobos', Deimos: 'deimos', Vesta: 'vesta', Haumea: 'haumea' };
const ASTEROID_SHAPES = ['eros', 'itokawa', 'bennu', 'kleopatra', 'geographos', 'toutatis', 'mithra', 'golevka', 'hw1', 'phobos', 'deimos'];
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
  const file = b.comet ? '67p' : rkm > 200 ? 'vesta' : ASTEROID_SHAPES[Math.floor(r * ASTEROID_SHAPES.length) % ASTEROID_SHAPES.length];
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
  return new Float32Array([ca, st * sa, -ct * sa, 0, ct, st, sa, -st * ca, ct * ca]);
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
      this.mapTex = new Map(); this.dTex = null; this.nightTex = null; this.tMesh = null; this.post = null; this.genMaps = null; this.noiseTex = null; this.cloudRTs = null;
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
      gl.uniform1f(px.u.uLevels, 5);
      this.fullscreen(px, null, this.canvas.width, this.canvas.height);
    } else {
      gl.useProgram(this.pComp.p);
      this.bindTex(0, p.scene.tex, this.pComp.u.uScene);
      this.bindTex(1, p.up[0].tex, this.pComp.u.uBloom);
      gl.uniform1f(this.pComp.u.uBloomK, bloom ? (this.hdr ? 0.32 : 0.22) : 0);
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
  drawSurfaceSky(sv) {
    const gl = this.gl, p = this.pSurfSky, u = p.u, cam = this.cam, b = sv.body, th = b.th;
    const optics = atmosphereOptics(b);
    const t = Math.tan(cam.fov / 2);
    // Under a thick haze (Venus, Titan) the sky is a uniform overcast: no separate cloud deck.
    const cover = th && !(optics && optics.tauM > 3) ? th.cloud : 0;
    const clouds = cover > 0.001 && this.drawSurfaceClouds(sv, optics, cover, t);
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
    const dusk = 1 + (1 / Math.sqrt(0.08 + 0.92 * Math.max(0, Math.sin(el))) - 1) * Math.max(0, Math.min(1, (el + 0.2) / 0.15));
    gl.uniform1f(u.uExpo, (22 * dusk) / Math.pow(Math.max(0.01, Math.min(1, optics ? optics.day : 1)), 0.6));
    gl.uniform1f(u.uSunPower, sv.sunPower);
    gl.uniform1f(u.uSunAng, sv.sunAng || 0.00465);
    gl.uniform3fv(u.uSunCol, tempToRGB(sv.sunTemp || 5772).map((v) => v / 255));
    gl.uniform1f(u.uCloud, cover);
    gl.uniform1f(u.uCloudBuf, clouds ? 1 : 0);
    if (clouds) this.bindTex(13, this.cloudRT.tex, u.uClouds);
    gl.uniform3fv(u.uCloudCol, this.look(b).colC || [0.95, 0.96, 1]);
    gl.uniform1f(u.uTime, performance.now() / 1000);
    gl.uniform3fv(u.uNorth, sv.north || [0, 0, 1]);
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

  // The cloud deck seen from the ground (SURFACE_CLOUD_FS), into a quarter-resolution buffer the sky reads.
  // Base and thickness follow the air's scale height (Earth: 8.5 km, so about 2 to 4.5 km up).
  drawSurfaceClouds(sv, optics, cover, t) {
    const gl = this.gl, p = this.pSurfCloud, u = p.u, b = sv.body;
    const w = Math.max(16, Math.ceil(this.sceneW / 4)), h = Math.max(16, Math.ceil(this.sceneH / 4));
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
    gl.uniform1f(u.uTime, performance.now() / 1000);
    gl.uniform3fv(u.uCloudCol, this.look(b).colC || [0.95, 0.96, 1]);
    gl.uniform3f(u.uCloudH, (0.24 * Hkm) / Rkm, (0.3 * Hkm) / Rkm, Rkm);
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
    // Same galactic plane as the background star band.
    gl.uniform3f(u.uGalN, 0, Math.cos(1.05), Math.sin(1.05));
    gl.uniform3f(u.uGalC, 1, 0, 0);
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
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(idx), gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    this.tMesh = { vao, n: idx.length };
    return this.tMesh;
  }

  // The ground around the observer in the Surface view. Lit by the sunlight that reaches the ground and
  // the sky's own light, and hazed with distance, all from the same atmosphere model as the sky.
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
    if (!this.gLight || now - this.gLight.t > 300 || this.gLight.b !== b) {
      const el = sv.elev || 0, day = optics ? optics.day : 1;
      const dusk = 1 + (1 / Math.sqrt(0.08 + 0.92 * Math.max(0, Math.sin(el))) - 1) * Math.max(0, Math.min(1, (el + 0.2) / 0.15));
      const expo = (22 * dusk) / Math.pow(Math.max(0.01, Math.min(1, day)), 0.6);
      // Without air the eye adapts to the sunlit ground itself (as in the Apollo photographs).
      const adapt = optics ? expo / 22 : 1.4;
      const g = optics ? groundLight(optics, sunUp, expo) : null;
      this.gLight = { t: now, b, g, adapt, optics };
    }
    const { g, adapt } = this.gLight;
    const sunT = g ? g.sunT : [1, 1, 1];
    const sunCol = [0, 1, 2].map((i) => ld[1][i] * sunT[i] * adapt * (sunUp > -0.02 ? 1 : 0));
    // Sky light: from the model, or (airless) only faint light from the stars and the ground around.
    // (The model's eight-direction sky average comes out dim, most of all with a low Sun, when shaded slopes go
    // black; measured skylight at sunrise is ~5-10% of noon sunlight, and the eye adapts to it. Boosted to
    // match: x1.6 at noon, up to x3 near the horizon.)
    const ambK = 1.6 + 1.4 * (1 - Math.max(0, Math.min(1, (sunUp - 0.05) / 0.45)));
    const amb = g ? g.amb.map((v, i) => v * adapt * ambK * (ld[1][i] > 0 ? 1 : 0) + 0.004) : sunCol.map((v) => v * 0.04 * Math.max(0, sunUp) + 0.002);
    const ext = optics ? [0, 1, 2].map((i) => (optics.betaR[i] + optics.betaA[i] + optics.betaM[i] + optics.betaMa[i]) / Rm) : [0, 0, 0];
    const fogH = optics ? ((optics.betaR[1] * optics.hR + optics.betaM[1] * optics.hM) / Math.max(1e-9, optics.betaR[1] + optics.betaM[1])) * Rm : 1;
    const gr = (6.674e-11 * b.m * 1.98847e30) / (Rm * Rm);
    const reliefK = Math.max(0.25, Math.min(1.6, (0.8 * 9.81) / Math.max(gr, 0.1)));
    const liquid = th && th.liquid > 0.005;
    gl.useProgram(p.p);
    gl.uniformMatrix4fv(u.uProj, false, this.P);
    gl.uniformMatrix3fv(u.uView, false, this.V);
    gl.uniformMatrix3fv(u.uRot, false, rot);
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
    gl.uniform1f(u.uRelief, 4000 * reliefK);
    gl.uniform1f(u.uCraters, l.craters ? Math.min(1, l.craters * 2.5) : 0);
    gl.uniform1f(u.uRough, 1);
    const fr = (x) => x - Math.floor(x);
    gl.uniform2f(u.uLocal, fr(sv.lat * 977.3) * 800, fr(sv.lon * 613.7) * 800);
    gl.uniform3fv(u.uL0, ld[0]);
    gl.uniform3fv(u.uSunCol, sunCol);
    {
      // The Sun in the body's own frame, and its angular size, for the shadows the terrain casts.
      const P = lights && lights.primary;
      const wd = P && P.d > 0 ? [P.dx / P.d, P.dy / P.d, P.dz / P.d] : [0, 1, 0];
      gl.uniform3f(u.uSunO, rot[0] * wd[0] + rot[1] * wd[1] + rot[2] * wd[2], rot[3] * wd[0] + rot[4] * wd[1] + rot[5] * wd[2], rot[6] * wd[0] + rot[7] * wd[1] + rot[8] * wd[2]);
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
    // Haze and mist from how wet the world is (its ocean cover) and its air pressure. Humid haze: visibility
    // (3.9 / extinction) from ~100 km in dry air to ~20 km in humid air, 1.5 km deep. Valley mist: ~60 m deep,
    // pooled in valleys, thickest at dawn and dusk and where it is cool, none in thin air.
    const humid = th && liquid ? Math.min(1, th.ocean * 1.2) : 0, Pbar = optics ? optics.P : 0;
    const airK = Math.min(1.5, Math.sqrt(Math.max(Pbar, 0)));
    const dawn = 0.35 + 0.65 * Math.max(0, Math.min(1, (0.4 - Math.sin(sv.elev || 0)) / 0.35));
    const cool = th ? Math.max(0, Math.min(1, (305 - temp) / 25)) : 0;
    gl.uniform4f(u.uHaze, 4e-5 * (0.3 + 1.7 * humid) * airK, 1500, Pbar > 0.05 ? 1.2e-3 * humid * dawn * (0.3 + 0.7 * cool) * airK : 0, 0);
    if (window.__tdbg) window.__tdbg = { n, eyeH, wr, br: b.r, upWorld: [rot[0] * n[0] + rot[3] * n[1] + rot[6] * n[2], rot[1] * n[0] + rot[4] * n[1] + rot[7] * n[2], rot[2] * n[0] + rot[5] * n[1] + rot[8] * n[2]], svUp: sv.up, upV, ex: [this.ex, this.ey, this.ez], b: [b.x, b.y, b.z] };
    const m = this.terrainMesh();
    gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(m.vao);
    gl.drawElements(gl.TRIANGLES, m.n, gl.UNSIGNED_INT, 0);
    gl.enable(gl.CULL_FACE);
  }

  makeSky() {
    const set = this.dynamicSet();
    const n = 2200;
    this.ensure(set, n);
    for (let i = 0; i < n; i++) {
      let x, y, z;
      if (i % 5 < 2) {
        const t = Math.random() * Math.PI * 2, lat = (Math.random() + Math.random() + Math.random() - 1.5) * 0.22;
        x = Math.cos(t) * Math.cos(lat); y = Math.sin(lat); z = Math.sin(t) * Math.cos(lat);
        const tilt = 1.05, y2 = y * Math.cos(tilt) - z * Math.sin(tilt);
        z = y * Math.sin(tilt) + z * Math.cos(tilt); y = y2;
      } else {
        const u = Math.random() * 2 - 1, t = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
        x = s * Math.cos(t); y = u; z = s * Math.sin(t);
      }
      const b = Math.pow(Math.random(), 3), tint = Math.random();
      const col = tint < 0.2 ? [0.7, 0.78, 1] : tint < 0.85 ? [0.92, 0.92, 0.95] : [1, 0.85, 0.7];
      const k = 0.25 + b * 0.75;
      set.pos.set([x, y, z], i * 3);
      set.col.set(col.map((v) => v * k), i * 3);
      set.size[i] = 1 + b * 2.4;
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

  draw(now, ui, dtReal, simDt) {
    if (this.lost) return;
    this.adaptQuality(dtReal, now);
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
    if (this.surface) this.drawSurfaceSky(this.surface);
    if (ui.zones && ui.zones.size && !this.surface) this.drawTempField(world, ui.zones);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);

    // Spin bodies (capped so fast time-warp doesn't strobe).
    for (const b of world.bodies) {
      const l = this.look(b);
      let s = this.spin.get(b);
      if (!s) { s = { ang: seeded(b.id) * 6.28 }; this.spin.set(b, s); }
      if (l.locked) {
        // Tidally locked: the same face (body +x, longitude 0) always points at the parent planet,
        // the one closest in tidal terms (smallest distance / cube root of mass).
        let par = null, best = Infinity;
        for (const o of world.bodies) {
          if (o === b || o.m <= b.m) continue;
          const k = Math.hypot(o.x - b.x, o.y - b.y, o.z - b.z) / Math.cbrt(o.m);
          if (k < best) { best = k; par = o; }
        }
        if (par) { s.ang = Math.atan2(-(par.z - b.z), par.x - b.x); continue; }
      }
      const w = (Math.PI * 2) / Math.max(l.day * HOUR_YR, 1e-9);
      s.ang += Math.min(w * simDt, MAX_SPIN * dtReal) * Math.sign(l.day);
    }
    // Cloud clock (days): follows the simulation, at most 0.4 days per real second so fast-forward
    // churns the weather without strobing.
    if (dtReal > 0 && dtReal < 1) this.cloudT = (this.cloudT || 0) + Math.min(Math.max(simDt || 0, 0) * 365.25, 0.4 * dtReal);

    // Ring geometry per planet, measured from its ring particles: plane, extent and a 16-bin opacity
    // profile (so gaps such as the Cassini Division show in the shadow the rings cast on the planet).
    // The rings change slowly: measured every 30 frames, or at once when particles are added or lost.
    this.ringFrame = (this.ringFrame || 0) + 1;
    if (!this.ringInfo || this.ringNr !== world.nr || this.ringWorld !== world || this.ringFrame >= 30) {
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
    for (const b of world.bodies) this.drawBody(b, now, glows);
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
    this.drawParticles(false);
    if (this.settings.grid && !this.surface) this.drawGrid();

    // Additive passes: atmospheres, disks, glows, hot particles.
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    for (const g of glows) g();
    this.drawParticles(true);
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
      // Light falls off as 1/d² in reality; a softer curve keeps the outer planets visible.
      const I = 1.2 * Math.min(1.3, Math.max(0.55, Math.pow(l.f, 0.08)));
      out.push(this.viewOf(l.dx / l.d, l.dy / l.d, l.dz / l.d), rgb.map((v) => v * I));
    }
    return { dirs: out, flux, primary: L[0] };
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
    if (this.surface && this.surface.body === b && l.kind === 0) { this.drawTerrain(b, l, rot, lights, temp); return; }

    const p = this.pBody, u = p.u;
    gl.useProgram(p.p);
    gl.uniformMatrix4fv(u.uProj, false, this.P);
    gl.uniformMatrix3fv(u.uView, false, this.V);
    gl.uniform3f(u.uCenter, x, y, z);
    gl.uniformMatrix3fv(u.uRot, false, rot);
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
    gl.uniform1f(u.uProfile, l.profile || 0);
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
    const sm = b.surfaceMap;
    if (sm) {
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
        } else if (t.ver < 0 || !sm.dirtyRows || t.W !== sm.W || t.sm !== sm) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, sm.W, sm.H, 0, gl.RGBA, gl.UNSIGNED_BYTE, sm.data);
        else {
          const [y0, y1] = sm.dirtyRows;
          gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, y0, sm.W, y1 - y0 + 1, gl.RGBA, gl.UNSIGNED_BYTE, sm.data.subarray(y0 * sm.W * 4, (y1 + 1) * sm.W * 4));
        }
        sm.dirtyRows = null;
        t.ver = sm.ver; t.W = sm.W; t.sm = sm; // (a new map object, e.g. a photo replacing its stand-in, is always re-uploaded)
      }
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
          if (o === b || !(o.r > 0) || isLuminous(o) || o.kind === 'core') continue;
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
    const bounce = lights ? this.planetshine(b, ld[1]) : null;
    gl.uniform3fv(u.uL2, bounce ? bounce[0] : [0, 1, 0]); gl.uniform3fv(u.uLc2, bounce ? bounce[1] : [0, 0, 0]);
    // Atmosphere. Worlds with a surface get physically based scattering from their gas mix (js/optics.js);
    // giant planets keep a rim glow in their look's colour.
    const optics = l.kind === 0 ? atmosphereOptics(b) : null;
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
        gl.uniformMatrix3fv(cu.uRot, false, rot);
        gl.uniform1f(cu.uRadius, R * (1 + deckH));
        gl.uniform3fv(cu.uTideDir, tide.dir);
        gl.uniform1f(cu.uTide, Math.min(0.45, 1.5 * tide.tau));
        gl.uniform1i(cu.uImpN, 0);
        gl.uniform1f(cu.uLumpy, 0);
        gl.uniform1f(cu.uLogDepthFC, this.logFC);
        gl.uniform3fv(cu.uL0, lc[0]); gl.uniform3fv(cu.uLc0, lc[1]); gl.uniform3fv(cu.uL1, lc[2]); gl.uniform3fv(cu.uLc1, lc[3]);
        gl.uniform3fv(cu.uColC, colC);
        gl.uniform1f(cu.uCloud, cover); gl.uniform1f(cu.uSeed, seeded(b.id) * 40); gl.uniform1f(cu.uPx, shownPx);
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
      const top = optics ? atmosphereTop(opt) : l.kind === 1 ? 1.015 : 1.035;
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
        gl.uniformMatrix3fv(au.uRot, false, rot);
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
          gl.uniform1f(au.uExpo, 5.5 * (ld[1][0] + ld[1][1] + ld[1][2] > 0 ? 1 : 0));
          gl.uniform3fv(au.uHot, [1, 0.45, 0.15].map((v) => v * hotK * 0.6));
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
    if (ring && shownPx > 2 && !(this.gpuHosts && this.gpuHosts.has(b))) {
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
      // Diffraction spikes only while the star is a point; a resolved disc doesn't show them.
      const spikes = Math.max(0, Math.min(1, 1.6 - shownPx / 25));
      glows.push(() => this.sprite(vp, glowPx / pxPerAU, rgb.map((v) => v * (this.post ? 0.75 : 1.1)), 0, 0, spikes));
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
    const gl = this.gl, s = this.pSky, u = s.u;
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(s.p);
    gl.uniformMatrix4fv(u.uProj, false, this.P);
    gl.uniformMatrix3fv(u.uView, false, this.V);
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
        const a = kind === PK.HOT ? 0.45 : kind >= PK.SN_H ? 1.1 : 0.55;
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
