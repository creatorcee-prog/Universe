import { G, EARTH_MASS, KPC_AU, DAY_YR, SUN_RADIUS, km, kms } from './units.js';
import { makeBody } from './bodies.js';
import { PK, circularSpeed } from './physics.js';

const D2R = Math.PI / 180;
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

function orbit(world, parent, body, a, e = 0, i = 0, node = 0, peri = 0, M = rand() * 360) {
  const s = kepler(G * (parent.m + body.m), a, e, i, node, peri, M);
  body.x = parent.x + s[0]; body.y = parent.y + s[1]; body.z = parent.z + s[2];
  body.vx = parent.vx + s[3]; body.vy = parent.vy + s[4]; body.vz = parent.vz + s[5];
  return world.addBody(body);
}

function particleOrbit(world, parent, a, e, i, kind, m = 0) {
  const s = kepler(G * parent.m, a, e, i, rand() * 360, rand() * 360, rand() * 360);
  world.addParticle(parent.x + s[0], parent.y + s[1], parent.z + s[2], parent.vx + s[3], parent.vy + s[4], parent.vz + s[5], m, kind);
}

function ring(world, host, rIn, rOut, count, tiltDeg, kind) {
  const t = tiltDeg * D2R;
  for (let k = 0; k < count; k++) {
    // Denser toward the middle, with a Cassini-like gap.
    let r = between(rIn, rOut);
    const f = (r - rIn) / (rOut - rIn);
    if (f > 0.62 && f < 0.68) r = rIn + (rOut - rIn) * (rand() < 0.5 ? 0.6 : 0.7);
    world.addRingParticle(host, r, rand() * Math.PI * 2, 1, 0, 0, 0, Math.sin(t), -Math.cos(t), kind);
  }
}

function toBarycenter(bodies) {
  let M = 0, px = 0, py = 0, pz = 0;
  for (const b of bodies) { M += b.m; px += b.vx * b.m; py += b.vy * b.m; pz += b.vz * b.m; }
  for (const b of bodies) { b.vx -= px / M; b.vy -= py / M; b.vz -= pz / M; }
}

function sun(name = 'Sun', age = 4.6e9) {
  const s = makeBody({ kind: 'star', m: 1, r: SUN_RADIUS, name });
  s.age = age; // the Sun is about 4.6 billion years old
  return s;
}

const PLANETS = [
  // name, a (AU), e, i (deg), mean longitude at J2000 (deg), mass (M⊕), radius (km), kind, colour, band
  ['Mercury', 0.387, 0.206, 7.0, 252.25, 0.0553, 2440, 'rocky', [168, 160, 150]],
  ['Venus', 0.723, 0.007, 3.39, 181.98, 0.815, 6052, 'rocky', [232, 204, 150], null, [255, 230, 180]],
  ['Earth', 1.0, 0.017, 0.0, 100.46, 1, 6371, 'rocky', [64, 118, 214], null, [120, 180, 255]],
  ['Mars', 1.524, 0.093, 1.85, 355.45, 0.107, 3390, 'rocky', [200, 104, 62]],
  ['Jupiter', 5.203, 0.048, 1.3, 34.4, 317.8, 69911, 'gas', [216, 182, 136], [170, 112, 74]],
  ['Saturn', 9.537, 0.054, 2.49, 49.94, 95.2, 58232, 'gas', [228, 208, 162], [190, 160, 110]],
  ['Uranus', 19.19, 0.047, 0.77, 313.23, 14.5, 25362, 'gas', [168, 222, 232], [140, 204, 218], [190, 240, 250]],
  ['Neptune', 30.07, 0.009, 1.77, 304.88, 17.1, 24622, 'gas', [84, 124, 222], [60, 92, 190], [140, 180, 255]],
];

function solarSystem(world, { belts = true, moon = true } = {}) {
  const s = world.addBody(sun());
  const made = {};
  for (const [name, a, e, i, L, me, rkm, kind, color, band, atmo] of PLANETS) {
    const b = makeBody({ name, kind, m: me * EARTH_MASS, r: km(rkm), color, band, atmo });
    made[name] = orbit(world, s, b, a, e, i, 0, 0, L);
  }
  const pluto = makeBody({ name: 'Pluto', kind: 'rocky', m: 0.00218 * EARTH_MASS, r: km(1188), color: [214, 190, 160] });
  orbit(world, s, pluto, 39.48, 0.2488, 17.16, 110.3, 113.8, 14.5);
  const ceres = makeBody({ name: 'Ceres', kind: 'rocky', m: 4.7e-10, r: km(470), color: [150, 144, 136] });
  orbit(world, s, ceres, 2.77, 0.0785, 10.6, 80.3, 73.6, 95);
  // Halley's real orbit (retrograde, i = 162°), placed shortly before perihelion so its tail is on show.
  const halley = makeBody({ name: "Halley's Comet", kind: 'rocky', comet: true, m: 1.1e-16, r: km(5.5), color: [196, 204, 214] });
  orbit(world, s, halley, 17.83, 0.967, 162.3, 58.4, 111.3, 357);
  if (moon) {
    const m = makeBody({ name: 'Moon', kind: 'rocky', m: 0.0123 * EARTH_MASS, r: km(1737), color: [184, 182, 176] });
    orbit(world, made.Earth, m, 0.00257, 0.055, 5.1);
  }
  ring(world, made.Saturn, km(74500), km(136800), 9000, 26.7, PK.ICE);
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
    blurb: 'The Sun, eight planets, Pluto, the Moon, Saturn\'s rings and both asteroid belts.',
    speed: 1 / 12,
    camera: { follow: 'Sun', dist: 3.4, pitch: 0.55, yaw: 0.4 },
    build(w) { solarSystem(w); },
  },
  {
    id: 'earthmoon', name: 'Earth & Moon',
    blurb: 'Watch the Moon wax and wane as it circles Earth, lit by the Sun 1 AU away.',
    speed: DAY_YR,
    camera: { follow: 'Earth', dist: 0.009, pitch: 0.45, yaw: 0.2 },
    build(w) {
      const s = w.addBody(sun());
      const e = orbit(w, s, makeBody({ name: 'Earth', kind: 'rocky', m: EARTH_MASS, r: km(6371), color: [64, 118, 214], atmo: [120, 180, 255] }), 1, 0, 0, 0, 0, 0);
      orbit(w, e, makeBody({ name: 'Moon', kind: 'rocky', m: 0.0123 * EARTH_MASS, r: km(1737), color: [184, 182, 176] }), 0.00257, 0.055, 5.1, 0, 0, 90);
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
      const j = orbit(w, s, makeBody({ name: 'Jupiter', kind: 'gas', m: 317.8 * EARTH_MASS, r: km(69911), color: [216, 182, 136], band: [170, 112, 74] }), 5.203, 0, 0, 0, 0, 0);
      const moons = [
        ['Io', 421700, 4.49e-8, 1821, [226, 204, 110]],
        ['Europa', 671034, 2.41e-8, 1560, [210, 196, 176]],
        ['Ganymede', 1070412, 7.45e-8, 2634, [160, 150, 138]],
        ['Callisto', 1882709, 5.42e-8, 2410, [110, 100, 92]],
      ];
      // Phases chosen to respect the Laplace relation λIo − 3λEuropa + 2λGanymede = 180°.
      const phase = [0, 180, 0, 90];
      moons.forEach(([name, akm, m, r, color], k) => {
        orbit(w, j, makeBody({ name, kind: 'rocky', m, r: km(r), color }), km(akm), 0.002, 0.2, 0, 0, phase[k]);
      });
      toBarycenter(w.bodies);
    },
  },
  {
    id: 'impact', name: 'Moon-Forming Impact',
    blurb: 'A Mars-sized protoplanet, Theia, strikes the young Earth at a glancing angle.',
    speed: 0.5 / 8766,
    camera: { follow: 'Proto-Earth', dist: 0.0011, pitch: 0.7, yaw: 0.6 },
    build(w) {
      const s = w.addBody(sun());
      const e = orbit(w, s, makeBody({ name: 'Proto-Earth', kind: 'rocky', m: 0.9 * EARTH_MASS, r: km(6150), color: [150, 100, 80] }), 1, 0, 0, 0, 0, 0);
      const t = makeBody({ name: 'Theia', kind: 'rocky', m: 0.1 * EARTH_MASS, r: km(3390), color: [190, 160, 130] });
      const d = km(60000);
      t.x = e.x + d; t.y = e.y + km(1500); t.z = e.z + km(9000);
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
    blurb: 'Two suns in a tight orbit with circumbinary planets. The innermost planet is doomed.',
    speed: 0.15,
    camera: { follow: null, dist: 5, pitch: 0.7, yaw: 0 },
    build(w) {
      const a = makeBody({ kind: 'star', m: 1.1, name: 'Kepler A' });
      const b = makeBody({ kind: 'star', m: 0.65, name: 'Kepler B' });
      w.addBody(a);
      orbit(w, a, b, 0.24, 0.15, 0, 0, 0, 0);
      toBarycenter(w.bodies);
      const bary = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, m: a.m + b.m };
      orbit(w, bary, makeBody({ name: 'Tatooine', kind: 'rocky', m: 1.6 * EARTH_MASS, r: km(7400), color: [214, 176, 120] }), 1.05, 0.02, 0.5);
      orbit(w, bary, makeBody({ name: 'Hoth', kind: 'gas', m: 22 * EARTH_MASS, r: km(25000), color: [170, 210, 230], band: [130, 180, 210] }), 1.9, 0.03, 1.5);
      orbit(w, bary, makeBody({ name: 'Doomed', kind: 'rocky', m: 0.5 * EARTH_MASS, r: km(5000), color: [200, 120, 90] }), 0.42, 0.05, 2);
      toBarycenter(w.bodies);
    },
  },
  {
    id: 'rogue', name: 'Rogue Black Hole',
    blurb: 'A 5 M☉ black hole wanders through the Solar System at 20 km/s.',
    speed: 1,
    camera: { follow: 'Sun', dist: 58, pitch: 0.8, yaw: 0.9 },
    build(w) {
      solarSystem(w, { moon: false });
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
