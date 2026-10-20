import {
  G, C_AU_YR, EARTH_MASS, JUPITER_MASS, MOON_MASS, SUN_RADIUS, km,
} from './units.js';

// Body kinds. Everything that is not compact keeps a density and grows by volume when it merges.
// rocky | gas | star | wd (white dwarf) | ns (neutron star) | bh (black hole) | core (galaxy core)
export const COMPACT = new Set(['wd', 'ns', 'bh', 'core']);

const JUPITER_RADIUS = km(69911);

export function schwarzschild(m) {
  return (2 * G * m) / (C_AU_YR * C_AU_YR);
}

// Interpolation in log mass through [mass, value] pairs.
function interpLog(tab, m) {
  if (m <= tab[0][0]) return tab[0][1];
  for (let i = 1; i < tab.length; i++) {
    const [m1, v1] = tab[i];
    if (m <= m1) { const [m0, v0] = tab[i - 1], f = Math.log(m / m0) / Math.log(m1 / m0); return v0 + (v1 - v0) * f; }
  }
  return tab[tab.length - 1][1];
}
// Red dwarfs are about as many solar radii as they are solar masses (TRAPPIST-1 0.119 R☉ at 0.090 M☉,
// Proxima 0.154 at 0.122, Barnard's Star 0.196 at 0.144; Boyajian et al. 2012, ApJ 757, 112).
const M_DWARF_R = [[0.075, 0.1], [0.09, 0.119], [0.122, 0.154], [0.15, 0.19], [0.2, 0.23], [0.3, 0.32], [0.4, 0.41], [0.5, 0.52], [0.6, Math.pow(0.6, 0.8)]];
export function starRadius(m) {
  // Main-sequence mass-radius relation (piecewise power law; a table for red dwarfs).
  if (m < 0.6) return SUN_RADIUS * interpLog(M_DWARF_R, m);
  return SUN_RADIUS * (m < 1 ? Math.pow(m, 0.8) : Math.pow(m, 0.57));
}

// Main-sequence surface temperature. Below 0.7 M☉ the power law runs far too cool (it gave TRAPPIST-1, 0.09 M☉,
// 1,700 K; it is 2,566 K), so red dwarfs follow a table instead, interpolated in log mass (after Pecaut &
// Mamajek 2013, ApJS 208, 9, and its online update; joined to the power law at 0.7 M☉).
const M_DWARF_T = [[0.075, 2300], [0.09, 2560], [0.1, 2700], [0.15, 2990], [0.2, 3150], [0.3, 3350], [0.4, 3500], [0.5, 3700], [0.6, 4100], [0.7, 5772 * Math.pow(0.7, 0.505)]];
export function starTemp(m) {
  if (m >= 0.7) return 5772 * Math.pow(m, 0.505);
  return interpLog(M_DWARF_T, m);
}

export function starLuminosity(m) {
  // Red dwarfs: from their radius and temperature, L = R² T⁴ (TRAPPIST-1: 5.5e-4 L☉, as measured).
  if (m < 0.6) { const R = starRadius(m) / SUN_RADIUS, T = starTemp(m) / 5772; return R * R * T * T * T * T; }
  if (m < 2) return Math.pow(m, 4);
  if (m < 55) return 1.4 * Math.pow(m, 3.5);
  return 32000 * m;
}

// Black-body colour approximation (Tanner Helland's fit), returns [r,g,b] 0..255.
export function tempToRGB(t) {
  const k = Math.max(1000, Math.min(40000, t)) / 100;
  let r, g, b;
  if (k <= 66) {
    r = 255;
    g = 99.47 * Math.log(k) - 161.12;
    b = k <= 19 ? 0 : 138.52 * Math.log(k - 10) - 305.04;
  } else {
    r = 329.7 * Math.pow(k - 60, -0.1332);
    g = 288.12 * Math.pow(k - 60, -0.0755);
    b = 255;
  }
  const c = (v) => Math.max(0, Math.min(255, Math.round(v)));
  return [c(r), c(g), c(b)];
}

export function volumeDensity(m, r) {
  return m / ((4 / 3) * Math.PI * r * r * r);
}

export function radiusFromDensity(m, rho) {
  return Math.cbrt(m / ((4 / 3) * Math.PI * rho));
}

const ROCKY_COLORS = [
  [176, 162, 146], [196, 128, 92], [140, 138, 134], [214, 184, 140], [120, 108, 98], [182, 92, 60],
];
const GAS_COLORS = [
  [[216, 180, 130], [176, 120, 80]], [[226, 206, 160], [190, 160, 110]],
  [[150, 200, 220], [110, 160, 200]], [[90, 130, 220], [60, 90, 190]], [[220, 150, 110], [160, 90, 70]],
];

const NAMES = [
  'Aster', 'Brimo', 'Caelum', 'Dione', 'Eos', 'Faro', 'Gaia', 'Helike', 'Ixion', 'Juno', 'Kore', 'Lethe',
  'Mira', 'Nyx', 'Orcus', 'Pallas', 'Quaoar', 'Rhea', 'Sedna', 'Tethys', 'Umbra', 'Vesta', 'Weywot',
  'Xanthe', 'Ymir', 'Zephyr', 'Atlas', 'Borea', 'Ceto', 'Doris', 'Elara', 'Fenrir', 'Halimede', 'Iapetus',
];
let nameCounter = 0;
export function generateName(kind) {
  nameCounter++;
  if (kind === 'star') return 'HD ' + (1000 + Math.floor(Math.random() * 98000));
  if (kind === 'bh') return 'BH-' + (100 + Math.floor(Math.random() * 900));
  if (kind === 'ns') return 'PSR J' + (1000 + Math.floor(Math.random() * 8999));
  if (kind === 'wd') return 'WD ' + (100 + Math.floor(Math.random() * 900));
  if (kind === 'nebula') return 'NGC ' + (1000 + Math.floor(Math.random() * 6800));
  return NAMES[Math.floor(Math.random() * NAMES.length)] + ' ' + nameCounter;
}

// Templates the player can drop into the scene.
export const CATALOG = [
  { id: 'comet', label: 'Comet', kind: 'rocky', comet: true, compKey: 'comet', m: 1.1e-16, r: km(5.5), color: [196, 204, 214] },
  { id: 'asteroid', label: 'Asteroid', kind: 'rocky', compKey: 'asteroid', m: 4.7e-10, r: km(470), color: [150, 140, 128] },
  { id: 'icemoon', label: 'Ice moon', kind: 'rocky', compKey: 'icemoon', m: 2.5e-8, r: km(2000), color: [214, 220, 228] },
  { id: 'moon', label: 'Moon', kind: 'rocky', compKey: 'Moon', m: MOON_MASS, r: km(1737), color: [180, 178, 172] },
  { id: 'mars', label: 'Mars', kind: 'rocky', compKey: 'Mars', m: 0.107 * EARTH_MASS, r: km(3390), color: [196, 110, 70] },
  { id: 'earth', label: 'Earth', kind: 'rocky', compKey: 'Earth', m: EARTH_MASS, r: km(6371), color: [64, 118, 214], atmo: [120, 180, 255] },
  { id: 'oceanworld', label: 'Ocean world', kind: 'rocky', compKey: 'oceanworld', m: 2 * EARTH_MASS, r: km(9500), color: [70, 110, 180], atmo: [140, 190, 255] },
  { id: 'neptune', label: 'Ice giant', kind: 'gas', compKey: 'Neptune', m: 17.1 * EARTH_MASS, r: km(24622), color: [90, 130, 220], band: [60, 90, 190], atmo: [140, 180, 255] },
  { id: 'jupiter', label: 'Jupiter', kind: 'gas', compKey: 'Jupiter', m: JUPITER_MASS, r: JUPITER_RADIUS, color: [216, 180, 130], band: [170, 112, 74] },
  { id: 'reddwarf', label: 'Red dwarf', kind: 'star', m: 0.2 },
  { id: 'sun', label: 'Sun', kind: 'star', m: 1 },
  { id: 'bluegiant', label: 'Blue giant', kind: 'star', m: 20 },
  { id: 'wd', label: 'White dwarf', kind: 'wd', m: 0.6, r: km(8700) },
  { id: 'ns', label: 'Neutron star', kind: 'ns', m: 1.4, r: km(12) },
  { id: 'bh', label: 'Black hole', kind: 'bh', m: 10 },
  { id: 'smbh', label: 'Super\u00admassive', kind: 'bh', m: 4.3e6 },
  { id: 'dust', label: 'Dust cloud', kind: 'dust', m: 0 },
  // A stellar nursery the size of the Orion Nebula's bright core: ~1,000 M☉ of gas and dust, 3 light years
  // across its glowing part (63,241 AU per light year).
  { id: 'nebula', label: 'Nebula', kind: 'nebula', m: 1000, r: 1.5 * 63241, color: [235, 90, 110] },
];

// Real objects for the Create gallery. Masses and mean radii: NASA planetary and satellite fact sheets
// (nssdc.gsfc.nasa.gov); stars: Proxima Centauri (Kervella et al. 2017), Sirius A/B (Bond et al. 2017),
// Betelgeuse (Joyce et al. 2020). `style` picks the thumbnail look; `named` keeps the real name.
const KG = 1 / 1.98847e30;
const real = (id, label, kind, kg, rkm, extra = {}) => ({ id, label, kind, m: kg * KG, r: rkm ? km(rkm) : 0, named: true, real: true, ...extra });
export const REAL_OBJECTS = [
  real('r-mercury', 'Mercury', 'rocky', 3.3011e23, 2439.7, { compKey: 'Mercury', color: [168, 160, 150], style: 'moon' }),
  real('r-venus', 'Venus', 'rocky', 4.8675e24, 6051.8, { compKey: 'Venus', color: [232, 204, 150], style: 'venus', atmo: [255, 230, 180] }),
  real('r-earth', 'Earth', 'rocky', 5.9722e24, 6371, { compKey: 'Earth', color: [64, 118, 214], atmo: [120, 180, 255], style: 'earth' }),
  real('r-moon', 'Moon', 'rocky', 7.342e22, 1737.4, { compKey: 'Moon', color: [184, 182, 176], style: 'moon' }),
  real('r-mars', 'Mars', 'rocky', 6.4171e23, 3389.5, { compKey: 'Mars', color: [200, 104, 62], style: 'mars' }),
  real('r-phobos', 'Phobos', 'rocky', 1.0659e16, 11.27, { compKey: 'asteroid', color: [110, 100, 90], style: 'asteroid' }),
  real('r-deimos', 'Deimos', 'rocky', 1.4762e15, 6.2, { compKey: 'asteroid', color: [140, 128, 112], style: 'asteroid' }),
  real('r-ceres', 'Ceres', 'rocky', 9.3835e20, 469.7, { compKey: 'Ceres', color: [150, 144, 136], style: 'asteroid' }),
  real('r-vesta', 'Vesta', 'rocky', 2.59076e20, 262.7, { compKey: 'asteroid', color: [160, 150, 140], style: 'asteroid' }),
  real('r-jupiter', 'Jupiter', 'gas', 1.89813e27, 69911, { compKey: 'Jupiter', color: [216, 182, 136], band: [170, 112, 74], style: 'jupiter' }),
  real('r-io', 'Io', 'rocky', 8.931938e22, 1821.6, { compKey: 'Io', color: [226, 204, 110], style: 'io' }),
  real('r-europa', 'Europa', 'rocky', 4.799844e22, 1560.8, { compKey: 'Europa', color: [210, 196, 176], style: 'icemoon' }),
  real('r-ganymede', 'Ganymede', 'rocky', 1.4819e23, 2634.1, { compKey: 'Ganymede', color: [160, 150, 138], style: 'moon' }),
  real('r-callisto', 'Callisto', 'rocky', 1.075938e23, 2410.3, { compKey: 'Callisto', color: [110, 100, 92], style: 'moon' }),
  real('r-saturn', 'Saturn', 'gas', 5.6834e26, 58232, { compKey: 'Saturn', color: [228, 208, 162], band: [190, 160, 110], style: 'saturn', rings: true }),
  real('r-titan', 'Titan', 'rocky', 1.3452e23, 2574.7, { compKey: 'Titan', color: [210, 150, 70], style: 'titan', atmo: [230, 160, 70] }),
  real('r-enceladus', 'Enceladus', 'rocky', 1.08022e20, 252.1, { compKey: 'icemoon', color: [240, 244, 248], style: 'icemoon' }),
  real('r-uranus', 'Uranus', 'gas', 8.681e25, 25362, { compKey: 'Uranus', color: [168, 222, 232], band: [140, 204, 218], style: 'uranus' }),
  real('r-neptune', 'Neptune', 'gas', 1.02413e26, 24622, { compKey: 'Neptune', color: [84, 124, 222], band: [60, 92, 190], style: 'neptune' }),
  real('r-triton', 'Triton', 'rocky', 2.139e22, 1353.4, { compKey: 'Pluto', color: [220, 200, 196], style: 'icemoon' }),
  real('r-pluto', 'Pluto', 'rocky', 1.303e22, 1188.3, { compKey: 'Pluto', color: [214, 190, 160], style: 'pluto' }),
  real('r-charon', 'Charon', 'rocky', 1.586e21, 606, { compKey: 'icemoon', color: [170, 166, 160], style: 'moon' }),
  { id: 'r-proxima', label: 'Proxima Centauri', kind: 'star', m: 0.1221, named: true, real: true },
  { id: 'r-trappist', label: 'TRAPPIST-1', kind: 'star', m: 0.0898, named: true, real: true },
  // M42: ~2,000 M☉ within ~12 light years (its glowing part; the molecular cloud behind is far bigger).
  { id: 'r-orion', label: 'Orion Nebula', kind: 'nebula', m: 2000, r: 12 * 63241, color: [235, 90, 110], named: true, real: true },
  { id: 'r-sun', label: 'Sun', kind: 'star', m: 1, named: true, real: true },
  { id: 'r-sirius', label: 'Sirius A', kind: 'star', m: 2.063, named: true, real: true },
  { id: 'r-betelgeuse', label: 'Betelgeuse', kind: 'star', m: 18, named: true, real: true, ageFrac: 0.995 },
  { id: 'r-siriusb', label: 'Sirius B', kind: 'wd', m: 1.018, r: km(5840), named: true, real: true },
  { id: 'r-sgra', label: 'Sagittarius A*', kind: 'bh', m: 4.3e6, named: true, real: true },
];

export function catalogItem(id) {
  return CATALOG.find((c) => c.id === id) || REAL_OBJECTS.find((c) => c.id === id);
}

let idCounter = 1;

export function makeBody(opts) {
  const b = {
    id: idCounter++,
    name: opts.name || generateName(opts.kind),
    kind: opts.kind,
    m: opts.m,
    m0: opts.m,
    r: opts.r || 0,
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, ax: 0, ay: 0, az: 0,
    soft: opts.soft || 0,
    color: opts.color ? opts.color.slice() : null,
    band: opts.band ? opts.band.slice() : null,
    atmo: opts.atmo ? opts.atmo.slice() : null,
    comet: !!opts.comet,
    compKey: opts.compKey || null,
    comp: opts.comp || null,
    heat: 0,
    temp: 0,
    lum: 0,
    alive: true,
    mergedInto: null,
    trail: null,
    trailStart: 0,
    spin: Math.random() * Math.PI * 2,
    bhStar: opts.bhStar ? { ...opts.bhStar } : null,
  };
  if (opts.wdAge !== undefined) b.wdAge = opts.wdAge;
  if (!b.color && (b.kind === 'rocky')) b.color = ROCKY_COLORS[Math.floor(Math.random() * ROCKY_COLORS.length)].slice();
  if (!b.color && b.kind === 'gas') {
    const p = GAS_COLORS[Math.floor(Math.random() * GAS_COLORS.length)];
    b.color = p[0].slice();
    b.band = p[1].slice();
  }
  if (b.kind === 'star' && !b.r) b.r = starRadius(b.m);
  if (b.kind === 'bh') b.r = schwarzschild(b.m);
  if (b.kind === 'gas' && !b.r) b.r = gasRadius(b.m);
  if (b.kind === 'rocky' && !b.r) b.r = radiusFromDensity(b.m, 9.3e6);
  b.density = volumeDensity(b.m, Math.max(b.r, 1e-12));
  refresh(b);
  return b;
}

function gasRadius(m) {
  return JUPITER_RADIUS * Math.min(1.1, Math.pow(m / JUPITER_MASS, 0.45));
}

// Recompute derived quantities (temperature, luminosity, colour) after mass changes.
export function refresh(b) {
  if (b.kind === 'star' && b.bhStar) {
    // A "black hole star" (Naidu et al. 2025, the "Cliff"; de Graaff et al. 2025): a black hole buried in a
    // cocoon of dense gas that it lights from inside, near its Eddington limit (3.2e4 L☉ per M☉). The
    // cocoon's photosphere is cool, ~4,500 K (the Balmer break and red colour of JWST's "little red dots"),
    // so for that much light it is enormous: R = √L (5,772 K / T)² R☉, hundreds to thousands of AU.
    const T = b.bhStar.T || 4500;
    b.temp = T;
    b.lum = 3.2e4 * b.m;
    b.r = Math.sqrt(b.lum) * (5772 / T) ** 2 * SUN_RADIUS;
    b.color = tempToRGB(T);
  } else if (b.kind === 'star') {
    b.temp = starTemp(b.m);
    b.lum = starLuminosity(b.m);
    b.color = tempToRGB(b.temp);
  } else if (b.kind === 'wd') {
    if (b.wdAge === undefined) { b.temp = 25000; b.lum = 0.01; b.color = tempToRGB(b.temp); }
  } else if (b.kind === 'ns') {
    b.temp = 600000; b.lum = 0.05; b.color = [190, 220, 255];
  } else if (b.kind === 'bh') {
    b.temp = 0; b.lum = 0; b.color = [255, 170, 90];
    b.r = schwarzschild(b.m);
  } else if (b.kind === 'core') {
    b.lum = 0; b.color = b.color || [255, 226, 180];
  } else if (b.kind === 'nebula') {
    // Its glow is drawn by the renderer (NEBULA_FS); as a light source for planets it is negligible.
    b.lum = 0; b.temp = 10000; b.color = b.color || [235, 90, 110];
  } else {
    b.lum = 0;
  }
}

// After a merge or mass edit, decide whether the body changed class
// (rocky -> gas giant -> star, white dwarf -> neutron star -> black hole).
// Returns a string describing a dramatic transition, or null.
export function reclassify(b) {
  let event = null;
  const before = b.kind;
  if (b.kind === 'wd' && b.m > 1.44) { b.pendingDeath = 'Passed the Chandrasekhar limit of 1.44 M☉'; }
  if (b.kind === 'ns' && b.m > 2.3) { b.kind = 'bh'; event = 'Neutron star collapsed into a black hole'; }
  if (b.kind === 'star' && b.m > 150 && !b.bhStar) { b.kind = 'bh'; event = 'Star too massive: collapsed into a black hole'; }
  if (b.kind === 'rocky' && b.m > 10 * EARTH_MASS) { b.kind = 'gas'; b.r = Math.max(b.r, gasRadius(b.m)); if (!b.band) { b.color = [200, 170, 130]; b.band = [160, 110, 80]; } }
  if ((b.kind === 'gas' || b.kind === 'rocky') && b.m >= 0.08) { b.kind = 'star'; b.r = starRadius(b.m); event = 'Mass passed 0.08 M☉: hydrogen fusion ignited, a new star is born'; }
  if (b.kind !== before) {
    b.density = volumeDensity(b.m, Math.max(b.r, 1e-12));
  }
  if (b.kind === 'star' && !b.bhStar) b.r = starRadius(b.m);
  refresh(b);
  return event;
}

export function typeName(b) {
  const me = b.m / EARTH_MASS;
  if (b.craft) return b.craft;   // (spacecraft: presets.js CRAFT)
  switch (b.kind) {
    case 'rocky':
      if (b.dwarf) return 'Dwarf planet';
      if (b.host && b.host.alive && b.host.kind !== 'star') return 'Moon of ' + b.host.name;   // (comets and asteroids keep the Sun as host)
      if (b.comet && me < 1e-4) return 'Comet';
      if (me < 1e-4) return 'Asteroid';
      if (me < 0.03) return 'Moon-sized body';
      if (me < 0.3) return 'Small rocky planet';
      if (me < 2) return 'Terrestrial planet';
      return 'Super-Earth';
    case 'gas':
      if (b.m > 13 * JUPITER_MASS) return 'Brown dwarf';
      if (me < 50) return 'Ice giant';
      return 'Gas giant';
    case 'star': {
      if (b.bhStar) return 'Black hole star';
      const t = b.temp;
      // Swollen stars, past the main sequence (stellar.js evolveStar: b.giant from 0 to 1).
      if (b.giant > 0.05) {
        if ((b.m0 || b.m) >= 8) return t > 9000 ? 'Blue supergiant' : t > 5200 ? 'Yellow supergiant' : 'Red supergiant';
        return t > 5200 ? 'Subgiant' : 'Red giant';
      }
      if (t < 3700) return 'Red dwarf · M-type';
      if (t < 5200) return 'Orange star · K-type';
      if (t < 6000) return 'Yellow star · G-type';
      if (t < 7500) return 'White star · F-type';
      if (t < 10000) return 'White star · A-type';
      if (t < 30000) return 'Blue star · B-type';
      return 'Blue giant · O-type';
    }
    case 'wd': return 'White dwarf';
    case 'ns': return 'Neutron star';
    case 'bh': return b.m > 1e5 ? 'Supermassive black hole' : 'Black hole';
    case 'core': return 'Galaxy core';
    case 'nebula': return 'Emission nebula';
    default: return b.kind;
  }
}

export function isLuminous(b) {
  return b.kind === 'star' || b.kind === 'wd' || b.kind === 'ns' || (b.kind === 'bh' && b.lum > 0);   // (a feeding hole)
}

// Rotation for axial tilt (about x) then spin (about the body's own pole), as a column-major mat3.
export function tiltSpin(tilt, ang) {
  // (The pole leans toward world -z, ecliptic +Y: Earth's toward ecliptic longitude 90°, so the June solstice
  // falls when the Sun is there, as it really does. It leaned the other way until October 2026, which put
  // northern summer in December once the Solar System started on today's date.)
  const ct = Math.cos(tilt), st = -Math.sin(tilt), ca = Math.cos(ang), sa = Math.sin(ang);
  // Rx(tilt) * Ry(ang), row-major:
  // [ ca,      0,    sa     ]
  // [ st*sa,   ct,  -st*ca  ]
  // [-ct*sa,   st,   ct*ca  ]
  // (Double precision: the surface view places the eye a planet's radius out along this; single precision's
  // error, ~3e-8, is 15 cm on Venus, and the ground bobbed by that from frame to frame.)
  return new Float64Array([ca, st * sa, -ct * sa, 0, ct, st, sa, -st * ca, ct * ca]);
}

// The spin angle (for tiltSpin) that puts body-frame longitude lonDeg (east positive, 0 at the map's centre:
// direction (cos λ, 0, -sin λ)) under the world direction u. Real worlds use it to start turned to the real time
// of day (Earth: render3d.js stepSpins), and geostationary satellites to sit over their longitudes.
export function spinFacing(tiltRad, u, lonDeg) {
  const l = (lonDeg * Math.PI) / 180, d = [Math.cos(l), 0, -Math.sin(l)];
  let best = 0, bestDot = -2;
  const dot = (a) => { const M = tiltSpin(tiltRad, a); return (M[0] * d[0] + M[3] * d[1] + M[6] * d[2]) * u[0] + (M[1] * d[0] + M[4] * d[1] + M[7] * d[2]) * u[1] + (M[2] * d[0] + M[5] * d[1] + M[8] * d[2]) * u[2]; };
  for (let k = 0; k < 360; k++) { const a = (k / 360) * 2 * Math.PI, v = dot(a); if (v > bestDot) { bestDot = v; best = a; } }
  for (let h = Math.PI / 360; h > 1e-7; h /= 2) { const a1 = dot(best - h), a2 = dot(best + h); if (a1 > bestDot) { bestDot = a1; best -= h; } else if (a2 > bestDot) { bestDot = a2; best += h; } }
  return best;
}
// The longitude (deg) where the Sun stands overhead at a UTC time (ms): noon at Greenwich, less the equation of
// time (the Sun runs up to 16 minutes ahead of or behind the clock: Spencer's series, NOAA).
export function subsolarLon(ms) {
  const d = new Date(ms), day = (ms - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400e3, g = (2 * Math.PI / 365) * day;
  const eot = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));   // minutes
  const utcMin = d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60;
  let lon = -((utcMin + eot) / 4 - 180);
  return ((lon + 540) % 360) - 180;
}
