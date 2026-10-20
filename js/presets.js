import { G, EARTH_MASS, MOON_MASS, KPC_AU, DAY_YR, SUN_RADIUS, km, kms, massFromGM } from './units.js';
import { makeBody } from './bodies.js';
import { PK, circularSpeed } from './physics.js';
import { MOONS } from './moons.js';

const D2R = Math.PI / 180;
const LUNAR_A = 381815; // km, starting osculating semi-major axis (see solarSystem)
const rand = Math.random;
const between = (a, b) => a + (b - a) * rand();
function gauss() {
  return Math.sqrt(-2 * Math.log(rand() || 1e-9)) * Math.cos(2 * Math.PI * rand());
}

// State vector from Keplerian elements. Orbits are prograde about world +y (the ecliptic is the x-z plane).
function kepler(mu, a, e, iDeg, nodeDeg, periDeg, MDeg) {
  const M = MDeg * D2R;
  let E = e < 0.8 ? M : Math.PI;
  for (let k = 0; k < 20; k++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  const cosE = Math.cos(E), sinE = Math.sin(E);
  const sq = Math.sqrt(1 - e * e);
  const xo = a * (cosE - e), yo = a * sq * sinE;
  const n = Math.sqrt(mu / (a * a * a));
  const k = (n * a) / (1 - e * cosE);
  const vxo = -sinE * k, vyo = sq * cosE * k;
  const i = iDeg * D2R, O = nodeDeg * D2R, w = periDeg * D2R;
  const cO = Math.cos(O), sO = Math.sin(O), ci = Math.cos(i), si = Math.sin(i), cw = Math.cos(w), sw = Math.sin(w);
  const r11 = cO * cw - sO * sw * ci, r12 = -cO * sw - sO * cw * ci;
  const r21 = sO * cw + cO * sw * ci, r22 = -sO * sw + cO * cw * ci;
  const r31 = sw * si, r32 = cw * si;
  const X = r11 * xo + r12 * yo, Y = r21 * xo + r22 * yo, Z = r31 * xo + r32 * yo;
  const VX = r11 * vxo + r12 * vyo, VY = r21 * vxo + r22 * vyo, VZ = r31 * vxo + r32 * vyo;
  // Map orbital frame (X, Y, Z=angular momentum) onto world (x, y=up, z).
  return [X, Z, -Y, VX, VZ, -VY];
}

// Place body on an orbit about parent. With pair = true (moons), the parent's previous state becomes the
// pair's centre of mass, so adding a moon does not change the planet-moon system's own orbit.
function orbit(world, parent, body, a, e = 0, i = 0, node = 0, peri = 0, M = rand() * 360, pair = false) {
  const s = kepler(G * (parent.m + body.m), a, e, i, node, peri, M);
  body.x = parent.x + s[0]; body.y = parent.y + s[1]; body.z = parent.z + s[2];
  body.vx = parent.vx + s[3]; body.vy = parent.vy + s[4]; body.vz = parent.vz + s[5];
  if (pair) {
    const f = body.m / (parent.m + body.m);
    for (const k of ['x', 'y', 'z']) { body[k] -= f * s['xyz'.indexOf(k)]; parent[k] -= f * s['xyz'.indexOf(k)]; }
    for (const [k, j] of [['vx', 3], ['vy', 4], ['vz', 5]]) { body[k] -= f * s[j]; parent[k] -= f * s[j]; }
  }
  return world.addBody(body);
}

function particleOrbit(world, parent, a, e, i, kind, m = 0) {
  const s = kepler(G * parent.m, a, e, i, rand() * 360, rand() * 360, rand() * 360);
  world.addParticle(parent.x + s[0], parent.y + s[1], parent.z + s[2], parent.vx + s[3], parent.vy + s[4], parent.vz + s[5], m, kind);
}

export function ring(world, host, rIn, rOut, count, tiltDeg, kind) {
  const t = tiltDeg * D2R;
  for (let k = 0; k < count; k++) {
    // Denser toward the middle, with a Cassini-like gap.
    let r = between(rIn, rOut);
    const f = (r - rIn) / (rOut - rIn);
    if (f > 0.62 && f < 0.68) r = rIn + (rOut - rIn) * (rand() < 0.5 ? 0.6 : 0.7);
    world.addRingParticle(host, r, rand() * Math.PI * 2, 1, 0, 0, 0, Math.sin(t), -Math.cos(t), kind);
  }
}

// Move to the centre-of-mass frame: total momentum zero and the barycentre at the origin.
function toBarycenter(bodies) {
  let M = 0, px = 0, py = 0, pz = 0, cx = 0, cy = 0, cz = 0;
  for (const b of bodies) { M += b.m; px += b.vx * b.m; py += b.vy * b.m; pz += b.vz * b.m; cx += b.x * b.m; cy += b.y * b.m; cz += b.z * b.m; }
  for (const b of bodies) { b.vx -= px / M; b.vy -= py / M; b.vz -= pz / M; b.x -= cx / M; b.y -= cy / M; b.z -= cz / M; }
}

function sun(name = 'Sun', age = 4.6e9) {
  const s = makeBody({ kind: 'star', m: 1, r: SUN_RADIUS, name });
  s.age = age; // the Sun is about 4.6 billion years old
  return s;
}

// J2000 mean orbital elements (JPL, E. M. Standish, "Keplerian Elements for Approximate Positions of the
// Major Planets", Table 1, valid 1800-2050): a (AU), e, I (deg), mean longitude L, longitude of perihelion ϖ,
// longitude of ascending node Ω (deg), heliocentric, ecliptic and equinox of J2000. Earth's row is the
// Earth-Moon barycentre. Masses: DE440 GM (km³/s²) of each planetary system (planet plus its moons).
const PLANETS = [
  // name, a, e, I, L, ϖ, Ω, GM, radius (km), kind, colour, band, atmosphere
  ['Mercury', 0.38709927, 0.20563593, 7.00497902, 252.25032350, 77.45779628, 48.33076593, 22031.868551, 2440, 'rocky', [168, 160, 150]],
  ['Venus', 0.72333566, 0.00677672, 3.39467605, 181.97909950, 131.60246718, 76.67984255, 324858.592, 6052, 'rocky', [232, 204, 150], null, [255, 230, 180]],
  ['Earth', 1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0.0, 398600.435507, 6371, 'rocky', [64, 118, 214], null, [120, 180, 255]],
  ['Mars', 1.52371034, 0.09339410, 1.84969142, -4.55343205, -23.94362959, 49.55953891, 42828.375816, 3390, 'rocky', [200, 104, 62]],
  ['Jupiter', 5.20288700, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909, 126712764.1, 69911, 'gas', [216, 182, 136], [170, 112, 74]],
  ['Saturn', 9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448, 37940584.8418, 58232, 'gas', [228, 208, 162], [190, 160, 110]],
  ['Uranus', 19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.95427630, 74.01692503, 5794556.4, 25362, 'gas', [168, 222, 232], [140, 204, 218], [190, 240, 250]],
  ['Neptune', 30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574, 6836527.10058, 24622, 'gas', [84, 124, 222], [60, 92, 190], [140, 180, 255]],
];

// Their rates per Julian century (same table): ȧ, ė, İ, L̇, ϖ̇, Ω̇. The Solar System starts at today's date
// (epochNow), the elements carried forward from J2000 with these.
const RATES = {
  Mercury: [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081],
  Venus: [0.00000390, -0.00004107, -0.00078890, 58517.81538729, 0.00268329, -0.27769418],
  Earth: [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0.0],
  Mars: [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343],
  Jupiter: [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106],
  Saturn: [-0.00125060, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794],
  Uranus: [-0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589],
  Neptune: [0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.00508664],
  Pluto: [-0.00031596, 0.00005170, 0.00004818, 145.20780515, -0.04062942, -0.01183482],
};
// Julian years from J2000 (2000 January 1, 12:00 TT ~ UTC) to now (window.__EPOCH, a Date.parse-able string,
// fixes it for tests).
const J2000_MS = Date.UTC(2000, 0, 1, 12);
export function epochNow() {
  const fixed = typeof window !== 'undefined' && window.__EPOCH;
  return ((fixed ? Date.parse(fixed) : Date.now()) - J2000_MS) / (365.25 * 86400e3);
}
// An orbit's mean anomaly carried forward by dt years along the unperturbed orbit about the Sun.
const advanceM = (M, a, dt) => M + (360 * dt) / Math.pow(a, 1.5);

const DAY_HOURS = { Mercury: 1407.6, Venus: -5832.5, Earth: 23.93, Mars: 24.62, Jupiter: 9.93, Saturn: 10.66, Uranus: -17.24, Neptune: 16.11 };

// Orbit from mean longitude L, longitude of perihelion ϖ and node Ω: ω = ϖ − Ω, M = L − ϖ.
function orbitLW(world, parent, body, a, e, I, L, w, O, pair = false) {
  return orbit(world, parent, body, a, e, I, O, w - O, L - w, pair);
}

// Dwarf planets. Orbits: JPL SBDB. Masses: from their moons' orbits where they have one (Eris: Holler et al.
// 2021; Haumea: Ragozzine & Brown 2009; Gonggong: Kiss et al. 2019; Quaoar: Morgado et al. 2023; Orcus: Brown &
// Butler 2023), else from size at 2 g/cm³ (Makemake ~3.1e21 kg, Sedna). Sizes from stellar occultations and
// thermal data (Sicardy et al. 2011, Ortiz et al. 2012 and 2017, Braga-Ribas et al. 2013, Pál et al. 2012).
// Colours: Eris is one of the brightest surfaces known (albedo 0.96); Sedna, Gonggong and Quaoar are very red.
const DWARFS = [
  // name, a (AU), e, i, Ω, ω, M at J2000 (deg), GM (km³/s²), mean radius (km), colour, day (h), tilt (deg)
  ['Ceres', 2.765553, 0.079692, 10.588, 80.2486, 73.2942, 5.203, 62.6284, 469.7, [150, 144, 136], 9.074, 4],
  ['Eris', 67.933947, 0.438239, 43.9258, 36.0048, 150.7949, 194.778, 1099.0, 1163, [236, 236, 238], 378.9, 78],
  ['Haumea', 43.06029, 0.194443, 28.2085, 121.7861, 240.6905, 189.531, 267.4, 798, [226, 226, 232], 3.9155, 126],
  ['Makemake', 45.570933, 0.158889, 29.0279, 79.2948, 297.0923, 139.003, 206.9, 715, [214, 176, 146], 22.83, 30],
  ['Gonggong', 66.866666, 0.504251, 30.8991, 336.8383, 206.6233, 94.26, 116.8, 615, [190, 116, 86], 22.4, 83],
  ['Quaoar', 43.156176, 0.0352, 7.9916, 188.9191, 163.209, 259.282, 80.1, 555, [172, 112, 92], 17.68, 14],
  ['Orcus', 39.376865, 0.220524, 20.5568, 268.4054, 73.5685, 150.583, 36.6, 455, [160, 160, 166], 13.19, 105],
  ['Sedna', 543.719529, 0.859882, 11.9253, 144.5062, 311.0988, 357.845, 69.8, 498, [192, 92, 62], 10.27, 30],
];

// Famous comets on their real orbits (JPL Small-Body Database elements, ecliptic J2000, rounded; mean anomaly
// carried back to J2000 from the perihelion date): name, a (AU), e, i, Ω, ω, M (deg), nucleus radius (km).
// Masses from the radius at ~500 kg/m³ (67P: 1.0e13 kg measured by Rosetta, Pätzold et al. 2016).
const COMETS = [
  ['Encke', 2.2152, 0.8471, 11.78, 334.57, 186.54, 284.7, 2.4],
  ['67P/Churyumov–Gerasimenko', 3.4630, 0.6410, 7.04, 50.14, 12.78, 213.0, 1.65],
  ['Tempel 1', 3.1246, 0.5175, 10.47, 68.94, 178.84, 359.7, 3.0],
  ['Wild 2', 3.4509, 0.5378, 3.24, 136.10, 41.70, 149.4, 2.0],
  ['Hartley 2', 3.4723, 0.6938, 13.62, 219.76, 181.21, 113.0, 0.6],
  ['Swift–Tuttle', 26.092, 0.9632, 113.45, 139.38, 152.98, 19.0, 13],
  ['Hale–Bopp', 186.0, 0.99509, 89.43, 282.47, 130.59, 0.39, 30],
];

// Asteroids and a Kuiper belt object that spacecraft have visited, each drawn with its measured shape
// (render3d.js SHAPES). Elements from the JPL Small-Body Database (ecliptic J2000; mean anomaly carried back
// to J2000 by two-body motion, so the near-Earth ones are only roughly where they were): name, a (AU), e, i,
// Ω, ω, M (deg), mean radius (km), mass (kg), rotation (h), colour, composition.
// Masses from SBDB's GM (Bennu: OSIRIS-REx; Ryugu: Hayabusa2; Eros: NEAR; Itokawa: Hayabusa; Lutetia:
// Rosetta); Šteins from its volume at ~1.8 g/cm³, Arrokoth at ~0.25 g/cm³ (Keane et al. 2022), both unmeasured.
const VISITED = [
  ['Bennu', 1.126391, 0.203745, 6.0349, 2.0609, 66.2231, 29.43, 0.245, 7.33e10, 4.296, [72, 70, 68], 'asteroid'],
  ['Ryugu', 1.190919, 0.191073, 5.8664, 251.2897, 211.609, 299.91, 0.448, 4.5e11, 7.633, [74, 70, 66], 'asteroid'],
  ['Eros', 1.458244, 0.222878, 10.8285, 304.268, 178.9181, 58.28, 8.42, 6.687e15, 5.27, [164, 142, 116], 'asteroid'],
  ['Itokawa', 1.324052, 0.280178, 1.6209, 69.0745, 162.8409, 44.38, 0.165, 3.15e10, 12.13, [154, 140, 120], 'asteroid'],
  ['Lutetia', 2.434431, 0.16477, 3.0645, 80.8386, 249.8803, 313.34, 49.1, 1.7e18, 8.166, [142, 136, 128], 'asteroid'],
  ['Šteins', 2.363142, 0.146787, 9.9247, 55.2936, 251.4371, 175.75, 2.63, 1.37e14, 6.049, [178, 172, 162], 'asteroid'],
  ['Arrokoth', 44.052578, 0.035557, 2.4506, 159.0377, 188.8507, 278.44, 9.05, 7.8e14, 15.92, [172, 102, 80], 'asteroid'],   // (uniformly red, no bright frost)
];

// Moons of the dwarf planets, in their planet's equator (the planets' tilts above are set to the moons'
// orbit planes): [planet, name, a (km), e, i, node, ω, M, 'Q', 0, GM (km³/s²), radius (km)].
// Dysnomia: Holler et al. 2021, Brown & Butler 2023; Hiʻiaka and Namaka: Ragozzine & Brown 2009; Weywot:
// Morgado et al. 2023; Vanth: Brown & Butler 2023; Xiangliu: Kiss et al. 2017. Phases are arbitrary.
const DWARF_MOONS = [
  ['Eris', 'Dysnomia', 37273, 0.0062, 0, 0, 0, 40, 'Q', 0, 5.47, 307],
  ['Haumea', 'Hiʻiaka', 49880, 0.0513, 0, 0, 154, 120, 'Q', 0, 1.195, 160],
  ['Haumea', 'Namaka', 25657, 0.249, 13, 0, 179, 300, 'Q', 0, 0.1195, 85],
  ['Quaoar', 'Weywot', 13289, 0.02, 0, 0, 0, 200, 'Q', 0, 0.027, 40],
  ['Orcus', 'Vanth', 9000, 0.007, 0, 0, 0, 90, 'Q', 0, 5.81, 221],
  ['Gonggong', 'Xiangliu', 24021, 0.29, 0, 0, 0, 10, 'Q', 0, 0.052, 50],
];

// Axial tilts the 3D view gives the planets (render3d.js LOOKS); moons in a planet's equator or local
// Laplace plane are placed in that same frame, so they line up with its rings and equator.
const AXIS = { Mars: 25.2, Jupiter: 3.1, Saturn: 26.7, Uranus: 97.8, Neptune: 28.3, Pluto: 122.5 };

// State of a moon relative to its planet. Ecliptic elements (irregular moons) are used as they are. Elements in
// the planet's equator ('Q') or local Laplace plane ('L', tilted from the planet's pole toward its orbit's pole
// by `lap`; JPL gives 180° for Uranus's moons, whose IAU north pole is the south one) are turned into the
// frame of the planet's tilted pole.
function moonState(host, row, mu) {
  const [, , akm, e, i, node, w, M, f, lap] = row;
  const o = kepler(mu, km(akm), e, i, node, w, M);
  if (f === 'E') return o;
  const T = host.tiltDeg !== undefined ? host.tiltDeg : AXIS[host.ident || host.name] || 0;
  const L = f === 'L' ? (lap > 90 ? 180 - lap : lap) : 0;
  const th = (T - L) * D2R, c = Math.cos(th), sn = Math.sin(th);
  // Orbit-plane coordinates (x, y, z = pole) from kepler's world mapping [X, Z, −Y], then onto the basis
  // e1 = x, e2 = (0, sin θ, −cos θ), e3 = (0, cos θ, sin θ).
  const map = (X, Y, Z) => [X, Y * sn + Z * c, -Y * c + Z * sn];
  return [...map(o[0], -o[2], o[1]), ...map(o[3], -o[5], o[4])];
}

const IRREGULAR = [102, 94, 88], ICY = [214, 216, 222], GREY = [150, 144, 138];
const MOON_COLORS = { Amalthea: [176, 92, 62], Iapetus: [160, 150, 132], Hyperion: [190, 176, 158], Phoebe: [70, 66, 62], Nereid: [150, 150, 150], Proteus: [96, 92, 90], Umbriel: [110, 108, 108], Rhea: [222, 222, 224], Dione: [226, 226, 228], Tethys: [232, 232, 234], Mimas: [204, 204, 206], Miranda: [196, 196, 198], Ariel: [210, 210, 212], Titania: [188, 180, 172], Oberon: [170, 160, 152] };
const NOT_ROUND = new Set(['Proteus', 'Hyperion', 'Nereid']);

// Every named moon. They ride on their planet (minors.js); Charon and Vanth are heavy enough to pull their
// planet round a shared centre of mass, and Pluto's four small moons circle that centre.
function addMoons(world, made) {
  const pluto = made.Pluto;
  const bary = pluto ? { x: pluto.x, y: pluto.y, z: pluto.z, vx: pluto.vx, vy: pluto.vy, vz: pluto.vz, m: pluto.m } : null;
  for (const row of [...MOONS, ...DWARF_MOONS]) {
    const [pn, name, akm, , , , , , f, , gm, rkm] = row;
    const host = made[pn];
    if (!host) continue;
    const m = massFromGM(gm), rgm = row[0] === 'Pluto';
    const icy = !['Mars', 'Jupiter'].includes(pn) || ['Europa', 'Ganymede', 'Callisto'].includes(name);
    const b = makeBody({ name, kind: 'rocky', m, r: km(rkm), color: MOON_COLORS[name] || (f === 'E' ? IRREGULAR : icy ? ICY : GREY), compKey: COMP_KEYS[name] || (f === 'E' ? 'darkmoon' : icy ? 'icemoon' : 'asteroid') });
    if (rkm > 190 && !NOT_ROUND.has(name)) b.round = true;
    if (f !== 'E') {
      // Regular moons are tidally locked, spinning once per orbit about their planet's pole.
      b.dayH = (2 * Math.PI * Math.sqrt(km(akm) ** 3 / (G * (host.m + m)))) * 8766;
      b.tiltDeg = host.tiltDeg !== undefined ? host.tiltDeg : AXIS[pn] || 0;
    }
    if (rgm) { b.minor = true; b.host = host; }
    if (rgm && name === 'Charon') {
      // The Pluto row above holds the pair's mass: give Pluto its own (GM 869.3, JPL PLU060) and split.
      host.m = massFromGM(869.3);
      const st = moonState(host, row, G * (host.m + m));
      const fr = m / (host.m + m);
      b.x = bary.x + st[0] * (1 - fr); b.y = bary.y + st[1] * (1 - fr); b.z = bary.z + st[2] * (1 - fr);
      b.vx = bary.vx + st[3] * (1 - fr); b.vy = bary.vy + st[4] * (1 - fr); b.vz = bary.vz + st[5] * (1 - fr);
      host.x = bary.x - st[0] * fr; host.y = bary.y - st[1] * fr; host.z = bary.z - st[2] * fr;
      host.vx = bary.vx - st[3] * fr; host.vy = bary.vy - st[4] * fr; host.vz = bary.vz - st[5] * fr;
      world.addBody(b);
      continue;
    }
    const centre = rgm ? bary : host;
    const st = moonState(host, row, G * (centre.m + m));
    b.x = centre.x + st[0]; b.y = centre.y + st[1]; b.z = centre.z + st[2];
    b.vx = centre.vx + st[3]; b.vy = centre.vy + st[4]; b.vz = centre.vz + st[5];
    b.minor = true; b.host = host;
    world.addBody(b);
  }
}

const COMP_KEYS = { Io: 'Io', Europa: 'Europa', Ganymede: 'Ganymede', Callisto: 'Callisto', Titan: 'Titan', Triton: 'Triton', Phobos: 'asteroid', Deimos: 'asteroid' };

function solarSystem(world, { belts = true, moon = true, moons = true } = {}) {
  const s = world.addBody(sun());
  const made = {};
  // Where everything is today: the clock shows the date from here (ui.js).
  const dt = epochNow(), T = dt / 100;
  world.epoch = J2000_MS + dt * 365.25 * 86400e3;
  const now = (name, el) => el.map((v, k) => v + RATES[name][k] * T);
  for (const [name, ...row] of PLANETS) {
    const [a, e, i, L, w, O] = now(name, row.slice(0, 6)), [gm, rkm, kind, color, band, atmo] = row.slice(6);
    // With the Moon simulated separately, Earth's own mass goes here and the pair shares the barycentre orbit.
    const b = makeBody({ name, kind, m: massFromGM(gm), r: km(rkm), color, band, atmo });
    b.dayH = DAY_HOURS[name]; // sidereal rotation period (NASA fact sheets)
    made[name] = orbitLW(world, s, b, a, e, i, L, w, O);
  }
  // Pluto: Standish's earlier table (J2000); system GM 975.5 km³/s² (Pluto plus Charon).
  const pluto = makeBody({ name: 'Pluto', kind: 'rocky', m: massFromGM(975.5), r: km(1188), color: [214, 190, 160] });
  pluto.dwarf = true; pluto.round = true;
  made.Pluto = orbitLW(world, s, pluto, ...now('Pluto', [39.48211675, 0.24882730, 17.14001206, 238.92903833, 224.06891629, 110.30393684]));
  pluto.minor = true; pluto.host = s;
  // Ceres and the other dwarf planets: JPL Small-Body Database orbits (2026 solutions, mean anomaly carried
  // back to J2000 along the unperturbed orbit).
  for (const [name, a, e, i, O, w, M, gm, rkm, color, dayH, tiltDeg] of DWARFS) {
    const b = makeBody({ name, kind: 'rocky', m: massFromGM(gm), r: km(rkm), color, compKey: name === 'Ceres' ? 'Ceres' : 'kbo' });
    b.dayH = dayH; b.tiltDeg = tiltDeg; b.round = true; b.dwarf = true;
    made[name] = orbit(world, s, b, a, e, i, O, w, advanceM(M, a, dt));
    b.minor = true; b.host = s;
  }
  if (moons) addMoons(world, made);
  // The comets ride on the Sun the same way (planets' tides as kicks).
  for (const [name, a, e, i, O, w, M, rkm] of COMETS) {
    const r = rkm * 1e3, mass = (4 / 3) * Math.PI * r * r * r * 500 / 1.98847e30;
    const c = makeBody({ name, kind: 'rocky', comet: true, compKey: 'comet', m: name.startsWith('67P') ? 1.0e13 / 1.98847e30 : mass, r: km(rkm), color: [196, 204, 214] });
    orbit(world, s, c, a, e, i, O, w, advanceM(M, a, dt));
    c.minor = true; c.host = s;
  }
  for (const [name, a, e, i, O, w, M, rkm, kg, dayH, color, compKey] of VISITED) {
    const v = makeBody({ name, kind: 'rocky', compKey, m: kg / 1.98847e30, r: km(rkm), color });
    v.dayH = dayH;
    orbit(world, s, v, a, e, i, O, w, advanceM(M, a, dt));
    v.minor = true; v.host = s;
  }
  // Halley's real orbit (retrograde, i = 162°), where it is today: perihelion 1986 February 9 (JD 2446470.5),
  // a 75.3-year orbit, so past aphelion (December 2023) and coming back for 2061.
  const halley = makeBody({ name: "Halley's Comet", kind: 'rocky', comet: true, m: 1.1e-16, r: km(5.5), color: [196, 204, 214] });
  orbit(world, s, halley, 17.83, 0.967, 162.3, 58.4, 111.3, advanceM(0, 17.83, dt + 13.894));
  if (moon) {
    // The Earth row above is the Earth-Moon barycentre: give Earth its own mass, then split the pair.
    made.Earth.m = EARTH_MASS;
    const m = makeBody({ name: 'Moon', kind: 'rocky', m: MOON_MASS, r: km(1737.4), color: [184, 182, 176] });
    // Mean lunar elements at J2000 (Meeus, Astronomical Algorithms ch. 47; NASA Moon fact sheet):
    // e 0.0549, i 5.145°, Ω 125.0445°, ϖ 83.3532°, L 218.3165°. Mean elements already include the Sun's
    // perturbations, so the starting (osculating) semi-major axis is calibrated, 381,815 km, so the
    // simulated mean sidereal month matches the measured 27.32166 days (mean distance stays ~384,400 km).
    // (carried to today with Meeus's mean rates per century: L 481267.881°, ϖ 4069.014°, Ω −1934.136°)
    orbitLW(world, made.Earth, m, km(LUNAR_A), 0.0549, 5.145, 218.3165 + 481267.88123421 * T, 83.3532 + 4069.0137287 * T, 125.0445 - 1934.1362891 * T, true);
    // It rides on Earth (minors.js: the pair's centre of mass moves in the main integrator, the Moon on its
    // Kepler orbit about Earth, kicked by the Sun's and planets' tides), so its 27-day month no longer sets the
    // step for every planet: the Solar System runs ~2x faster at the same accuracy.
    m.host = made.Earth; m.minor = true;
  }
  ring(world, made.Saturn, km(74500), km(136800), 24000, 26.7, PK.ICE);
  if (belts) {
    for (let k = 0; k < 1500; k++) particleOrbit(world, s, between(2.1, 3.3), rand() * 0.15, rand() * 12, PK.ROCK);
    for (let k = 0; k < 700; k++) particleOrbit(world, s, between(39, 48), rand() * 0.12, rand() * 12, PK.ICE);
  }
  toBarycenter(world.bodies);
  return made;
}

function galaxy(world, name, cx, cy, cz, vx, vy, vz, tiltX, tiltZ, n, spin, palette) {
  const core = world.addBody(makeBody({ kind: 'core', name, m: 1e11, r: 2e5, soft: 2 * KPC_AU, color: palette }));
  core.x = cx; core.y = cy; core.z = cz; core.vx = vx; core.vy = vy; core.vz = vz;
  const ctx = Math.cos(tiltX), stx = Math.sin(tiltX), ctz = Math.cos(tiltZ), stz = Math.sin(tiltZ);
  const rot = (x, y, z) => {
    const y1 = y * ctx - z * stx, z1 = y * stx + z * ctx;
    return [x * ctz - y1 * stz, x * stz + y1 * ctz, z1];
  };
  for (let k = 0; k < n; k++) {
    const R = Math.min(15, 0.8 + -Math.log(rand() || 1e-6) * 3.2) * KPC_AU;
    const arm = rand() < 0.5 ? 0 : Math.PI;
    const th = arm + Math.log(R / KPC_AU) * 2.4 + gauss() * 0.38;
    const h = gauss() * 0.15 * KPC_AU;
    const vc = circularSpeed(core, R) * (1 + gauss() * 0.04);
    const cs = Math.cos(th), sn = Math.sin(th);
    const p = rot(R * cs, h, -R * sn);
    const v = rot(-vc * sn * spin, 0, -vc * cs * spin);
    const kind = R < 3 * KPC_AU || rand() < 0.15 ? PK.STAR_GOLD : PK.STAR_BLUE;
    world.addParticle(cx + p[0], cy + p[1], cz + p[2], vx + v[0], vy + v[1], vz + v[2], 0, kind);
  }
  return core;
}

export const PRESETS = [
  {
    id: 'solar', name: 'Solar System',
    blurb: 'The Sun, eight planets, nine dwarf planets, all 175 named moons, eight famous comets, Saturn\'s rings and both asteroid belts.',
    speed: 1 / 12,
    camera: { follow: 'Sun', dist: 3.4, pitch: 0.55, yaw: 0.4 },
    build(w) { solarSystem(w); },
  },
  {
    id: 'nursery', name: 'Stellar Nursery',
    blurb: 'A young dusty world, a few light-years from the glowing cloud its star was born in. The nebula is red with hydrogen, blue-green with oxygen near its hot heart, and crossed by dark lanes of dust. Try the infrared view (Settings), where the dust shines instead.',
    speed: DAY_YR / 4,
    camera: { follow: 'Ember', dist: km(4600 * 1.32), pitch: 0.1, yaw: 0 },
    build(w) {
      // A young Sun-like star; its planet sits on the far side from the nebula so its lit face looks toward it.
      const s = w.addBody(sun('Young Sun', 3e7));
      const a = 1.1, v = Math.sqrt(G * s.m / a);
      // Ember: Mars-sized, with thin, dusty CO2 air (80 mbar), so its limb glows orange as Mars's does
      // (optics.js: dusty air; thicker air would scatter blue).
      const e = makeBody({ name: 'Ember', kind: 'rocky', m: 0.15 * EARTH_MASS, r: km(4600), color: [200, 104, 62], compKey: 'Mars',
        comp: { iron: 0.25, rock: 0.75, water: 0, rockAlbedo: 0.27, atm: { gases: { co2: 0.075, n2: 0.005 } } } });
      e.x = 0; e.y = 0; e.z = -a; e.vx = v; e.vy = 0; e.vz = 0;
      w.addBody(e).host = s;
      // The nebula: ~1,500 M☉ in a cloud 4 light-years across, ~7 light-years away, high above the horizon
      // of Ember's starting view
      // (63,241 AU per light-year).
      const LY = 63241;
      const n = makeBody({ name: 'Ember Nebula', kind: 'nebula', m: 1500, r: 2 * LY, color: [235, 90, 110] });
      n.x = 0; n.y = 5.6 * LY; n.z = -4.5 * LY;
      w.addBody(n);
    },
  },
  {
    id: 'trappist', name: 'TRAPPIST-1',
    blurb: 'A red dwarf a tenth the Sun\'s mass with seven Earth-sized planets, all closer to it than Mercury is to the Sun. From the innermost the star looks about ten times wider than our Sun, a deep orange-red. Three planets lie in the habitable zone.',
    speed: 1 / 8766 * 2,
    camera: { follow: 'TRAPPIST-1b', dist: km(7118 * 1.6), pitch: 0.6, yaw: 0 },
    build(w) {
      // Agol et al. 2021 (Planet. Sci. J. 2, 1): star 0.0898 M☉, 0.1192 R☉, 2,566 K, ~7.6 billion years old;
      // planets' masses and radii (Earth = 1) and orbits (AU). Compositions after JWST: b and c show no thick
      // air (Greene et al. 2023, Nature 618, 39; Zieba et al. 2023, Nature 620, 746); e-g lie in the habitable zone.
      const st = w.addBody(makeBody({ kind: 'star', m: 0.0898, r: km(82930), name: 'TRAPPIST-1' }));
      st.age = 7.6e9;
      const P = [
        ['b', 0.01154, 1.374, 1.116, 'Mercury', [150, 120, 110]], ['c', 0.0158, 1.308, 1.097, 'Mercury', [140, 115, 100]],
        ['d', 0.02227, 0.388, 0.788, 'Mars', [176, 120, 90]], ['e', 0.02925, 0.692, 0.92, 'Earth', [90, 110, 150]],
        ['f', 0.03849, 1.039, 1.045, 'oceanworld', [190, 200, 215]], ['g', 0.04683, 1.321, 1.129, 'oceanworld', [200, 210, 220]],
        ['h', 0.06189, 0.326, 0.755, 'icemoon', [214, 220, 228]],
      ];
      for (const [k, a, mE, rE, compKey, color] of P) {
        const b = makeBody({ name: 'TRAPPIST-1' + k, kind: 'rocky', m: mE * EARTH_MASS, r: km(6371 * rE), compKey, color });
        // (b starts on the far side, so the default view looks past its limb at the star.)
        orbit(w, st, b, a, 0, 0, 0, 0, k === 'b' ? 270 : rand() * 360).host = st;
      }
    },
  },
  {
    id: 'oceanmoon', name: 'Ocean Moon',
    blurb: 'A moon covered by one ocean, close around a giant banded cream and rose. It keeps one face to the giant, so from that side the giant hangs in the same place in the sky, a third of the sky wide, while the Sun crosses it. Stand on Pelagia and choose "Facing Rhodon".',
    speed: DAY_YR / 24,
    camera: { follow: 'Pelagia', dist: km(5600 * 9), pitch: 0.15, yaw: 2.2 },
    build(w) {
      // Made up, within physics: a Jupiter-sized giant (1.6 Jupiter masses) at 1 AU from a Sun-like star; its
      // moon, a little smaller than Earth with 18% water (a world-wide ocean) under Earth-like air, on a
      // circular orbit at 3.4 giant radii: outside the Roche limit (~1.5 radii for rock), close enough that the
      // giant spans ~34° of its sky, and circular so it is not tidally heated as Io is. It goes round in ~15
      // hours, starting ~60° from the Sun's side of the giant, so from the side facing the giant both are up.
      const s = w.addBody(sun());
      const g = makeBody({ name: 'Rhodon', kind: 'gas', m: 1.6 * massFromGM(126686531.9), r: km(72000), color: [252, 214, 192], band: [234, 80, 118] });
      orbit(w, s, g, 1.0, 0, 0, 0, 0, 0).host = s;
      const m = makeBody({ name: 'Pelagia', kind: 'rocky', m: 0.6 * EARTH_MASS, r: km(5600), color: [70, 110, 180], atmo: [140, 190, 255], compKey: 'oceanworld',
        comp: { iron: 0.2, rock: 0.62, water: 0.18, atm: { gases: { n2: 0.78, o2: 0.21, co2: 0.0004 } } } });
      // (orbit's phase counts from the giant's own orbital position: 180° + 60° puts it on the Sun's side, 60° round)
      orbit(w, g, m, km(72000 * 3.4), 0, 0, 0, 0, 240, true).host = g;
      toBarycenter(w.bodies);
    },
  },
  {
    id: 'ringmoon', name: 'Ringed Sky',
    blurb: 'A grassland moon of a ringed giant. Its orbit is tilted to the rings, so from its hills they arc open across the sky, bright in sunlight, while the giant behind them fades into the blue by day. Stand on Elysia and choose "Facing Kyklos".',
    speed: DAY_YR / 24,
    camera: { follow: 'Elysia', dist: km(5300 * 9), pitch: 0.15, yaw: 2.2 },
    build(w) {
      // Made up, within physics: a giant of half Jupiter's mass with Saturn-like icy rings (out to 2.3 of its
      // radii, inside its Roche limit for ice), at 1 AU from a Sun-like star; its moon, a little under half
      // Earth's mass, with less water than Earth (continents, a few seas) under Earth-like air and with life.
      // The moon orbits at 13 giant radii (832,000 km; a seventh of the giant's Hill sphere, ~8 million km, so
      // stable), about 6.9 days round; from there the giant spans ~9° and the rings ~20°. The rings lie over the
      // giant's equator, tilted 30° to its orbit; the moon orbits near the plane of that orbit, so it sees
      // the rings open by up to 30°. (A moon in the ring plane, as Saturn's inner moons are, sees them edge-on as
      // a line. Far enough out, a moon's orbit follows the planet's orbital plane rather than its equator,
      // like Saturn's Iapetus; for a giant at 1 AU that changeover, the Laplace radius, falls near 13 radii:
      // Tremaine, Touma & Namouni 2009, AJ 137, 3706.)
      const s = w.addBody(sun());
      const g = makeBody({ name: 'Kyklos', kind: 'gas', m: 0.5 * massFromGM(126686531.9), r: km(64000), color: [236, 226, 204], band: [196, 178, 150] });
      // (Started where the rings' sunlit face points between the Sun and the moon: seen from the giant, the Sun
      // and the moon 90° apart, each ~21° above the ring plane, so the moon sees the lit face open.)
      orbit(w, s, g, 1.0, 0, 0, 0, 0, 135).host = s;
      const m = makeBody({ name: 'Elysia', kind: 'rocky', m: 0.45 * EARTH_MASS, r: km(5300), color: [150, 140, 96], atmo: [130, 180, 255],
        comp: { iron: 0.3, rock: 0.7, water: 1.6e-4, life: true, atm: { gases: { n2: 0.78, o2: 0.21, co2: 0.0004 } } } });
      orbit(w, g, m, km(64000 * 13), 0, 0, 0, 0, 225, true).host = g;
      ring(w, g, km(77000), km(147000), 24000, 30, PK.ICE);
      toBarycenter(w.bodies);
    },
  },
  {
    id: 'saturn', name: 'Saturn\'s Rings',
    blurb: 'Saturn, its 63 named moons and its rings. With WebGPU on (Settings), the rings are 250,000 orbiting chunks, and up close a field of individual rocks. Zoom in to skim the ring plane.',
    speed: DAY_YR / 24,
    camera: { follow: 'Saturn', dist: 0.0015, pitch: 0.2, yaw: -1.4 },
    build(w) { solarSystem(w); },
  },
  {
    id: 'earthmoon', name: 'Earth & Moon',
    blurb: 'Watch the Moon wax and wane as it circles Earth, lit by the Sun 1 AU away.',
    speed: DAY_YR,
    camera: { follow: 'Earth', dist: 0.009, pitch: 0.45, yaw: 0.2 },
    build(w) {
      const s = w.addBody(sun());
      const e = makeBody({ name: 'Earth', kind: 'rocky', m: EARTH_MASS + MOON_MASS, r: km(6371), color: [64, 118, 214], atmo: [120, 180, 255] });
      orbitLW(w, s, e, 1.00000261, 0.01671123, 0, 100.46457166, 102.93768193, 0);
      e.m = EARTH_MASS;
      orbitLW(w, e, makeBody({ name: 'Moon', kind: 'rocky', m: MOON_MASS, r: km(1737.4), color: [184, 182, 176] }), km(LUNAR_A), 0.0549, 5.145, 218.3165, 83.3532, 125.0445, true).host = e;
      toBarycenter(w.bodies);
    },
  },
  {
    id: 'jupiter', name: 'Jupiter\'s Moons',
    blurb: 'Io, Europa and Ganymede lock into a 1 : 2 : 4 orbital resonance. Callisto drifts outside it.',
    speed: DAY_YR,
    camera: { follow: 'Jupiter', dist: 0.03, pitch: 0.6, yaw: 0.3 },
    build(w) {
      const s = w.addBody(sun());
      // Jupiter alone (GM 126,686,531.9 km³/s²) on its J2000 orbit; moon GMs from JPL's JUP365 solution.
      const j = makeBody({ name: 'Jupiter', kind: 'gas', m: massFromGM(126712764.1), r: km(69911), color: [216, 182, 136], band: [170, 112, 74] });
      orbitLW(w, s, j, 5.20288700, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909);
      j.m = massFromGM(126686531.9);
      const moons = [
        ['Io', 421700, massFromGM(5959.916), 1821, [226, 204, 110]],
        ['Europa', 671034, massFromGM(3202.739), 1560, [210, 196, 176]],
        ['Ganymede', 1070412, massFromGM(9887.834), 2634, [160, 150, 138]],
        ['Callisto', 1882709, massFromGM(7179.289), 2410, [110, 100, 92]],
      ];
      // Phases chosen to respect the Laplace relation λIo − 3λEuropa + 2λGanymede = 180°.
      const phase = [0, 180, 0, 90];
      moons.forEach(([name, akm, m, r, color], k) => {
        orbit(w, j, makeBody({ name, kind: 'rocky', m, r: km(r), color }), km(akm), 0.002, 0.2, 0, 0, phase[k], true).host = j;
      });
      toBarycenter(w.bodies);
    },
  },
  {
    id: 'impact', name: 'Moon-Forming Impact',
    blurb: 'A Mars-sized protoplanet, Theia, strikes the young Earth at 45°. Debris forms a disk, and over about a month it clumps into the Moon. Speed up with » after the impact.',
    speed: 0.5 / 8766,
    camera: { follow: 'Proto-Earth', dist: 0.0011, pitch: 0.7, yaw: 0.6 },
    build(w) {
      const s = w.addBody(sun());
      const e = orbit(w, s, makeBody({ name: 'Proto-Earth', kind: 'rocky', m: 0.9 * EARTH_MASS, r: km(6150), color: [150, 100, 80] }), 1, 0, 0, 0, 0, 0);
      const t = makeBody({ name: 'Theia', kind: 'rocky', m: 0.1 * EARTH_MASS, r: km(3390), color: [190, 160, 130] });
      const d = km(60000);
      // Offset so that, after gravitational focusing, Theia hits at about 45° (Canup 2004's canonical case).
      t.x = e.x + d; t.y = e.y + km(1500); t.z = e.z + km(13300);
      t.vx = e.vx - kms(10.5); t.vy = e.vy; t.vz = e.vz - kms(0.8);
      t.noRoche = true;
      w.addBody(t);
    },
  },
  {
    id: 'formation', name: 'Planet Formation',
    blurb: '160 planetesimals around a young star collide and grow into a handful of planets.',
    speed: 0.4,
    camera: { follow: 'Young Sun', dist: 7, pitch: 0.95, yaw: 0 },
    build(w) {
      const s = w.addBody(sun('Young Sun', 2e6));
      for (let k = 0; k < 160; k++) {
        const a = 0.45 + Math.pow(rand(), 1.3) * 3.4;
        const p = makeBody({ kind: 'rocky', m: between(0.05, 0.4) * EARTH_MASS, r: 0.0035, name: 'Planetesimal ' + (k + 1) });
        p.noRoche = true;
        orbit(w, s, p, a, rand() * 0.04, rand() * 1.5, rand() * 360, rand() * 360);
      }
      for (let k = 0; k < 1500; k++) particleOrbit(w, s, between(0.4, 4.2), rand() * 0.05, rand() * 3, PK.DUST);
      toBarycenter(w.bodies);
    },
  },
  {
    id: 'binary', name: 'Binary Star',
    blurb: 'Two suns in a tight orbit with circumbinary planets. The innermost planet is too close to stay: within a year or so it is flung out, or falls into one of the stars.',
    speed: 0.15,
    camera: { follow: null, dist: 5, pitch: 0.7, yaw: 0 },
    build(w) {
      const a = makeBody({ kind: 'star', m: 1.1, name: 'Kepler A' });
      const b = makeBody({ kind: 'star', m: 0.65, name: 'Kepler B' });
      w.addBody(a);
      orbit(w, a, b, 0.24, 0.15, 0, 0, 0, 0);
      toBarycenter(w.bodies); // the binary's centre of mass is now at rest at the origin
      const bary = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, m: a.m + b.m };
      orbit(w, bary, makeBody({ name: 'Tatooine', kind: 'rocky', m: 1.6 * EARTH_MASS, r: km(7400), color: [214, 176, 120] }), 1.05, 0.02, 0.5);
      orbit(w, bary, makeBody({ name: 'Hoth', kind: 'gas', m: 22 * EARTH_MASS, r: km(25000), color: [170, 210, 230], band: [130, 180, 210] }), 1.9, 0.03, 1.5);
      orbit(w, bary, makeBody({ name: 'Doomed', kind: 'rocky', m: 0.5 * EARTH_MASS, r: km(5000), color: [200, 120, 90] }), 0.42, 0.05, 2);
      toBarycenter(w.bodies);
    },
  },
  {
    id: 'bhmerger', name: 'Black Hole Merger',
    blurb: 'Two black holes like those LIGO first heard in 2015 (36 and 29 M☉), 22,000 km apart, losing orbital energy to gravitational waves. They spiral together and merge within a day.',
    speed: 1 / 8766, // an hour per second
    camera: { follow: null, dist: 0.0006, pitch: 0.9, yaw: 0 },
    build(w) {
      // Circular relative orbit; the gravitational-wave inspiral comes from the 2.5PN radiation reaction.
      const m1 = 36, m2 = 29, M = m1 + m2, d = km(22000), v = Math.sqrt((G * M) / d);
      const a = makeBody({ kind: 'bh', m: m1, name: 'Black hole A' }), b = makeBody({ kind: 'bh', m: m2, name: 'Black hole B' });
      a.x = (-d * m2) / M; b.x = (d * m1) / M;
      a.vz = (-v * m2) / M; b.vz = (v * m1) / M;
      w.addBody(a); w.addBody(b);
    },
  },
  {
    id: 'rogue', name: 'Rogue Black Hole',
    blurb: 'A 5 M☉ black hole wanders through the Solar System at 20 km/s.',
    speed: 1,
    camera: { follow: 'Sun', dist: 58, pitch: 0.8, yaw: 0.9 },
    build(w) {
      solarSystem(w, { moon: false, moons: false });
      const bh = makeBody({ kind: 'bh', m: 5, name: 'Rogue' });
      bh.x = -36; bh.y = 5; bh.z = 10;
      const tx = 3, ty = 0, tz = 1.5;
      const dl = Math.hypot(tx - bh.x, ty - bh.y, tz - bh.z);
      const v = kms(20);
      bh.vx = ((tx - bh.x) / dl) * v; bh.vy = ((ty - bh.y) / dl) * v; bh.vz = ((tz - bh.z) / dl) * v;
      w.addBody(bh);
    },
  },
  {
    id: 'tde', name: 'Tidal Disruption',
    blurb: 'A Sun-like star dives toward a million-solar-mass black hole and is shredded by its tides. Half the debris escapes; speed up time to watch the rest fall back.',
    speed: 6 / 8766,
    camera: { follow: 'Black hole', dist: 30, pitch: 0.95, yaw: 1.75 },
    build(w) {
      const bh = w.addBody(makeBody({ kind: 'bh', m: 1e6, name: 'Black hole' }));
      // Parabolic orbit with periapsis 0.4 AU, inside the star's 0.59 AU Roche radius
      // but ~20 Schwarzschild radii out, where Newtonian gravity is still a fair approximation.
      const q = 0.4, r0 = 7, mu = G * bh.m;
      const nu = -Math.acos((2 * q) / r0 - 1); // negative true anomaly: still approaching
      const vp = Math.sqrt(mu / (2 * q));
      const st = makeBody({ kind: 'star', m: 1, name: 'S-star' });
      st.x = r0 * Math.cos(nu); st.y = 0; st.z = -r0 * Math.sin(nu);
      st.vx = -vp * Math.sin(nu); st.vy = 0; st.vz = -vp * (1 + Math.cos(nu));
      w.addBody(st);
    },
  },
  {
    id: 'jtde', name: 'Jetted Tidal Disruption',
    blurb: 'The rare kind: a fast-spinning black hole shreds a star and launches a pair of jets at nearly light speed, as Swift J1644+57 did in 2011 (only about 1 in 100 tidal disruptions does this). The jets switch on when the debris falls back, about 40 days after the star is torn apart.',
    speed: 2 / 365.25,
    camera: { follow: 'Black hole', dist: 40, pitch: 0.3, yaw: 1.75 },
    build(w) {
      const bh = w.addBody(makeBody({ kind: 'bh', m: 1e6, name: 'Black hole' }));
      bh.spinA = 0.9; bh.jetAlways = true;
      // The same plunge as Tidal Disruption: parabolic, periapsis 0.4 AU.
      const q = 0.4, r0 = 7, mu = G * bh.m;
      const nu = -Math.acos((2 * q) / r0 - 1);
      const vp = Math.sqrt(mu / (2 * q));
      const st = makeBody({ kind: 'star', m: 1, name: 'S-star' });
      st.x = r0 * Math.cos(nu); st.y = 0; st.z = -r0 * Math.sin(nu);
      st.vx = -vp * Math.sin(nu); st.vy = 0; st.vz = -vp * (1 + Math.cos(nu));
      w.addBody(st);
    },
  },
  {
    id: 'ptde', name: 'Repeating Tidal Disruption',
    blurb: 'A Sun-like star on a tight 20-day orbit grazes a million-solar-mass black hole. Each pass tears off part of it in a stream that wraps around the hole and lights its disk, piece by piece, as for the star in ASASSN-14ko, which flares every 114 days.',
    speed: 2 / 365.25,
    camera: { follow: 'Black hole', dist: 22, pitch: 1.05, yaw: 1.75 },
    build(w) {
      const bh = w.addBody(makeBody({ kind: 'bh', m: 1e6, name: 'Black hole' }));
      // Periapsis 1.2 times the distance at which the star would be destroyed outright (~0.53 AU for this young
      // Sun, 0.9 R☉), so each pass strips about a fifth of it (Guillochon & Ramirez-Ruiz 2013).
      // Period 20 days: a = 14.4 AU, e = 0.96.
      const st = makeBody({ kind: 'star', m: 1, name: 'S-star' });
      const mu = G * bh.m, P = 20 / 365.25, a = Math.cbrt((mu * P * P) / (4 * Math.PI * Math.PI));
      // (0.9: the young star's radius, set on its first step)
      const q = 1.2 * 0.9 * st.r * Math.cbrt((2 * bh.m) / st.m), e = 1 - q / a;
      const nu = -2.2;   // still on its way in
      const p = a * (1 - e * e), r = p / (1 + e * Math.cos(nu)), h = Math.sqrt(mu * p);
      st.x = r * Math.cos(nu); st.y = 0; st.z = -r * Math.sin(nu);
      const vr = (mu / h) * e * Math.sin(nu), vt = (mu / h) * (1 + e * Math.cos(nu));
      st.vx = vr * Math.cos(nu) - vt * Math.sin(nu); st.vy = 0; st.vz = -(vr * Math.sin(nu) + vt * Math.cos(nu));
      w.addBody(st);
    },
  },
  {
    id: 'supernova', name: 'Supernova',
    blurb: 'A red supergiant like Betelgeuse, 18 times the Sun\'s mass, is about a year from collapse. Watch its core implode and the shell of hydrogen, oxygen, silicon and iron fly out.',
    speed: 0.08,
    camera: { follow: 'Betelgeuse', dist: 45, pitch: 0.5, yaw: 0.3 },
    build(w) {
      const s = makeBody({ kind: 'star', m: 18, name: 'Betelgeuse' });
      s.age = 1e10 * Math.pow(18, -2.5) - 1; // one year left
      w.addBody(s);
      orbit(w, s, makeBody({ name: 'Cinder', kind: 'gas', m: 2 * 317.8 * EARTH_MASS, r: km(80000), color: [200, 140, 110], band: [150, 90, 70] }), 120, 0.05, 2);
      for (let k = 0; k < 600; k++) particleOrbit(w, s, between(300, 500), rand() * 0.1, rand() * 20, PK.ICE);
    },
  },
  {
    id: 'galaxies', name: 'Galaxy Collision',
    blurb: 'Two spiral galaxies of 100 billion suns each pass through one another and throw out tidal tails.',
    speed: 2e7,
    camera: { follow: null, dist: 85 * KPC_AU, pitch: 0.95, yaw: 0.3 },
    build(w) {
      const r0 = 50 * KPC_AU;
      const mu = G * 2e11;
      const qd = 9 * KPC_AU;
      const vtot = 0.92 * Math.sqrt((2 * mu) / r0);
      const vt = Math.sqrt(2 * mu * qd) / r0;
      const vr = Math.sqrt(Math.max(0, vtot * vtot - vt * vt));
      galaxy(w, 'Galaxy A', -r0 / 2, 0, 0, vr / 2, 0, -vt / 2, 0.15, 0, 4200, 1, [255, 226, 180]);
      galaxy(w, 'Galaxy B', r0 / 2, 0, 0, -vr / 2, 0, vt / 2, 1.0, 0.5, 4200, 1, [200, 220, 255]);
    },
  },
  {
    id: 'empty', name: 'Empty Star',
    blurb: 'A lone Sun-like star. Add planets, moons, stars or black holes and see what happens.',
    speed: 0.1,
    camera: { follow: 'Sun', dist: 3, pitch: 0.6, yaw: 0 },
    build(w) { w.addBody(sun()); },
  },
];
