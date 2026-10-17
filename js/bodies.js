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

export function starRadius(m) {
  // Main-sequence mass-radius relation (piecewise power law).
  return SUN_RADIUS * (m < 1 ? Math.pow(m, 0.8) : Math.pow(m, 0.57));
}

export function starTemp(m) {
  return 5772 * Math.pow(m, 0.505);
}

export function starLuminosity(m) {
  if (m < 0.43) return 0.23 * Math.pow(m, 2.3);
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
  };
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
  if (b.kind === 'star') {
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
  if (b.kind === 'star' && b.m > 150) { b.kind = 'bh'; event = 'Star too massive: collapsed into a black hole'; }
  if (b.kind === 'rocky' && b.m > 10 * EARTH_MASS) { b.kind = 'gas'; b.r = Math.max(b.r, gasRadius(b.m)); if (!b.band) { b.color = [200, 170, 130]; b.band = [160, 110, 80]; } }
  if ((b.kind === 'gas' || b.kind === 'rocky') && b.m >= 0.08) { b.kind = 'star'; b.r = starRadius(b.m); event = 'Mass passed 0.08 M☉: hydrogen fusion ignited, a new star is born'; }
  if (b.kind !== before) {
    b.density = volumeDensity(b.m, Math.max(b.r, 1e-12));
  }
  if (b.kind === 'star') b.r = starRadius(b.m);
  refresh(b);
  return event;
}

export function typeName(b) {
  const me = b.m / EARTH_MASS;
  switch (b.kind) {
    case 'rocky':
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
      const t = b.temp;
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
    default: return b.kind;
  }
}

export function isLuminous(b) {
  return b.kind === 'star' || b.kind === 'wd' || b.kind === 'ns';
}
