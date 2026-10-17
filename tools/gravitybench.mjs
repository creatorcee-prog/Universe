// Gravity accuracy benchmark: run the Solar System and compare with measured values.
//   node tools/gravitybench.mjs [years=100]
// Reference values:
//   Earth sidereal year 365.256363 d, Moon sidereal month 27.321662 d (NASA fact sheets),
//   lunar nodal regression period 18.6 yr,
//   Mercury perihelion advance in an inertial frame: ~532"/century from the planets
//   (Newtonian) plus 42.98"/century from general relativity (Clemence 1947; Park et al. 2017, AJ 153, 121).
import { World } from '../js/physics.js';
import { PRESETS } from '../js/presets.js';
import { G } from '../js/units.js';

const years = +(process.argv[2] || 100);
const w = new World();
if (process.env.ETA) w.eta = +process.env.ETA;
if (process.env.NOGR) w.integ.gr = false;
PRESETS.find((p) => p.id === 'solar').build(w);
w.clearParticles();
w.nr = 0;
const get = (n) => w.findByName(n);
const sun = get('Sun'), earth = get('Earth'), moon = get('Moon'), merc = get('Mercury');

function energy() {
  let k = 0, u = 0;
  const b = w.bodies;
  for (let i = 0; i < b.length; i++) {
    k += 0.5 * b[i].m * (b[i].vx ** 2 + b[i].vy ** 2 + b[i].vz ** 2);
    for (let j = i + 1; j < b.length; j++) u -= (G * b[i].m * b[j].m) / Math.hypot(b[i].x - b[j].x, b[i].y - b[j].y, b[i].z - b[j].z);
  }
  return k + u;
}

// Longitude in the ecliptic (x-z plane; orbits are prograde about +y, so angle = atan2(-z, x)).
const lon = (a, c) => Math.atan2(-(a.z - c.z), a.x - c.x);
// Longitude of perihelion from the Laplace-Runge-Lenz vector of a about c.
function periLon(a, c) {
  const rx = a.x - c.x, ry = a.y - c.y, rz = a.z - c.z, vx = a.vx - c.vx, vy = a.vy - c.vy, vz = a.vz - c.vz;
  const mu = G * (a.m + c.m), r = Math.hypot(rx, ry, rz);
  const hx = ry * vz - rz * vy, hy = rz * vx - rx * vz, hz = rx * vy - ry * vx;
  const ex = (vy * hz - vz * hy) / mu - rx / r, ey = (vz * hx - vx * hz) / mu - ry / r, ez = (vx * hy - vy * hx) / mu - rz / r;
  // Convert to ecliptic coordinates (X = x, Y = -z, Z = y): ϖ = Ω + ω, the quantity astronomers quote.
  const HX = hx, HY = -hz, HZ = hy, EX = ex, EY = -ez, EZ = ey;
  const O = Math.atan2(HX, -HY); // node: n = Z × h = (-HY, HX, 0)
  const nx = Math.cos(O), ny = Math.sin(O), hl = Math.hypot(HX, HY, HZ);
  const cosw = nx * EX + ny * EY;
  const sinw = (EZ) / Math.sin(Math.acos(HZ / hl)) ;
  return O + Math.atan2(sinw / Math.hypot(EX, EY, EZ), cosw / Math.hypot(EX, EY, EZ));
}
// Longitude of the ascending node of a about c (from the angular momentum vector).
function nodeLon(a, c) {
  const rx = a.x - c.x, ry = a.y - c.y, rz = a.z - c.z, vx = a.vx - c.vx, vy = a.vy - c.vy, vz = a.vz - c.vz;
  const hx = ry * vz - rz * vy, hz = rx * vy - ry * vx;
  // node direction = y_up × h, in (x, -z) ecliptic coordinates
  return Math.atan2(-hx, -hz) ;
}

const unwrap = () => { let prev = null, acc = 0; return (a) => { if (prev !== null) { let d = a - prev; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; acc += d; } prev = a; return acc; }; };
const uE = unwrap(), uM = unwrap(), uP = unwrap(), uN = unwrap();
const T = [], LE = [], LM = [], PM = [], NM = [];
const fit = (x, y) => { const n = x.length, mx = x.reduce((s, v) => s + v, 0) / n, my = y.reduce((s, v) => s + v, 0) / n; let sxy = 0, sxx = 0; for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; } return sxy / sxx; };

const e0 = energy();
const step = 1 / 365.25;
const t0 = performance.now();
let steps = 0;
const n = Math.round(years / step);
for (let i = 0; i <= n; i++) {
  T.push(w.t); LE.push(uE(lon(earth, sun))); LM.push(uM(lon(moon, earth))); PM.push(uP(periLon(merc, sun))); NM.push(uN(nodeLon(moon, earth)));
  if (i < n) w.advance(step, 1e9);
}
const ms = performance.now() - t0;
const dE = (energy() - e0) / Math.abs(e0);
const nE = fit(T, LE), nM = fit(T, LM), pM = fit(T, PM), nN = fit(T, NM);
const AS = (180 / Math.PI) * 3600;
const row = (name, model, real, unit) => console.log(`${name.padEnd(30)} ${model.padStart(14)}   real ${real.padStart(12)} ${unit}`);
console.log(`Solar System, ${years} years, ${(ms / 1000).toFixed(1)} s`);
row('Earth sidereal year', ((2 * Math.PI) / nE * 365.25).toFixed(4), '365.2564', 'days');
row('Moon sidereal month', ((2 * Math.PI) / nM * 365.25).toFixed(4), '27.3217', 'days');
row('Moon nodal regression', (-(2 * Math.PI) / nN).toFixed(2), '18.61', 'years');
row('Mercury perihelion advance', (pM * AS * 100).toFixed(1), '532 + 43 GR', '"/century');
console.log(`Energy drift ${dE.toExponential(2)}`);
