// Planetary thermal model: composition, energy balance, ice, oceans and steam.
//
// Surface temperature comes from absorbed starlight (set by distance and albedo), heat radiated to
// space (reduced by the atmosphere's greenhouse effect), and internal heat (from impacts) leaking out
// through the surface. Albedo, ice cover, oceans and clouds are then derived from that temperature
// and the body's composition, which feeds back into the next step (so ice-albedo runaways happen).

import { isLuminous } from './bodies.js';

const SIGMA = 5.670374e-8;      // Stefan-Boltzmann, W m^-2 K^-4
const L_SUN = 3.828e26;         // W
const AU_M = 1.495978707e11;
const MSUN_KG = 1.98847e30;
const YEAR_S = 3.15576e7;
const AUYR_MS = AU_M / YEAR_S;  // 1 AU/yr in m/s (4.74 km/s)
const G_SI = 6.674e-11;

// Specific heat (J kg^-1 K^-1) of each material.
const CP = { iron: 450, rock: 1000, water: 3000, ice: 1500, gas: 12000 };

// Mass fractions and atmospheres. p: surface pressure (bar) excluding steam; co2: CO2 share of p.
// Water fractions are the surface inventory (oceans and ice), not water locked in rock.
// Sources: NASA Planetary Fact Sheets; values rounded.
export const COMPOSITIONS = {
  Mercury: { iron: 0.7, rock: 0.3, rockAlbedo: 0.07 },
  Venus: { iron: 0.3, rock: 0.7, water: 1e-8, atm: { p: 92, co2: 0.965 } },
  Earth: { iron: 0.32, rock: 0.68, water: 2.3e-4, atm: { p: 1, co2: 0.0004 } },
  Moon: { iron: 0.02, rock: 0.98, rockAlbedo: 0.12 },
  Mars: { iron: 0.25, rock: 0.75, water: 7.8e-6, rockAlbedo: 0.27, atm: { p: 0.006, co2: 0.95 } },
  Ceres: { rock: 0.75, water: 0.25, rockAlbedo: 0.09, lag: true },
  Jupiter: { gas: 0.9, rock: 0.05, ice: 0.05, tint: 99 },
  Io: { iron: 0.2, rock: 0.8, rockAlbedo: 0.6 },
  Europa: { iron: 0.1, rock: 0.82, water: 0.08 },
  Ganymede: { iron: 0.1, rock: 0.45, water: 0.45, rockAlbedo: 0.25, iceMax: 0.5 },
  Callisto: { iron: 0.05, rock: 0.5, water: 0.45, rockAlbedo: 0.15, iceMax: 0.15 },
  Saturn: { gas: 0.88, rock: 0.06, ice: 0.06, tint: 76 },
  Uranus: { gas: 0.15, water: 0.6, ice: 0.15, rock: 0.1, tint: 0 },
  Neptune: { gas: 0.15, water: 0.6, ice: 0.15, rock: 0.1, tint: 51 },
  Pluto: { rock: 0.68, water: 0.3, ice: 0.02, atm: { p: 1e-5, co2: 0 } },
  "Halley's Comet": { rock: 0.5, water: 0.4, ice: 0.1, rockAlbedo: 0.04, lag: true },
  Theia: { iron: 0.3, rock: 0.7 },
  'Proto-Earth': { iron: 0.32, rock: 0.68, water: 2.3e-4, atm: { p: 1, co2: 0.3 }, dT0: 1200 },
  // Catalogue templates
  oceanworld: { iron: 0.15, rock: 0.55, water: 0.3, atm: { p: 2, co2: 0.01 } },
  icemoon: { iron: 0.05, rock: 0.5, water: 0.45 },
  asteroid: { iron: 0.1, rock: 0.9, rockAlbedo: 0.1 },
  comet: { rock: 0.5, water: 0.4, ice: 0.1, rockAlbedo: 0.04, lag: true },
};

function defaultComposition(b) {
  const me = b.m / 3.0035e-6;
  if (b.comet) return { ...COMPOSITIONS.comet };
  if (b.kind === 'gas') return me < 50 ? { ...COMPOSITIONS.Neptune, tint: 40 } : { ...COMPOSITIONS.Jupiter, tint: 100 * Math.pow(b.m / 9.55e-4, 0.3) };
  if (me < 1e-4) return { ...COMPOSITIONS.asteroid };
  if (b.atmo) return { ...COMPOSITIONS.Earth, atm: { ...COMPOSITIONS.Earth.atm } };
  if (me < 0.05) return { ...COMPOSITIONS.Moon };
  return { iron: 0.3, rock: 0.7, water: 1e-5, atm: { p: 0.1, co2: 0.9 } };
}

// Give a body its composition and starting thermal state (it starts at equilibrium).
export function ensureThermal(b, world) {
  if (b.th) return b.th;
  const c = b.comp || (b.compKey && COMPOSITIONS[b.compKey]) || COMPOSITIONS[b.name] || defaultComposition(b);
  const comp = { iron: 0, rock: 0, water: 0, ice: 0, gas: 0, rockAlbedo: 0.15, tint: 0, ...c };
  delete comp.atm;
  const atm = { p: 0, co2: 0, ...(c.atm || {}) };
  b.comp = comp;
  b.atm = atm;
  // Start warm: climates with oceans can have two stable states (temperate or snowball), and real
  // planets like Earth sit on the warm one.
  const th = { Ts: 320, Eint: 0, steam: 0, albedo: 0.3, ice: 0, cloud: 0, ocean: 0, liquid: 0, boil: 373, latSpan: 50, tau: 0, flux: 0 };
  b.th = th;
  if (comp.dT0) th.Eint = comp.dT0 * b.m * MSUN_KG * heatCapacity(b);
  // Iterate to a self-consistent start (temperature, ice and albedo depend on one another).
  for (let i = 0; i < 40; i++) thermalUpdate(b, world, Infinity);
  return th;
}

export function heatCapacity(b) {
  const c = b.comp;
  const tot = c.iron + c.rock + c.water + c.ice + c.gas || 1;
  return (c.iron * CP.iron + c.rock * CP.rock + c.water * CP.water + c.ice * CP.ice + c.gas * CP.gas) / tot;
}

const thermalKinds = new Set(['rocky', 'gas']);

// Advance every planet's thermal state by dtYears of simulated time.
export function thermalStep(world, dtYears) {
  for (const b of world.bodies) {
    if (!thermalKinds.has(b.kind)) continue;
    if (!b.th) ensureThermal(b, world);
    else thermalUpdate(b, world, dtYears * YEAR_S);
  }
}

function thermalUpdate(b, world, dt) {
  const th = b.th, c = b.comp, atm = b.atm;
  const Mkg = b.m * MSUN_KG, R = Math.max(b.r * AU_M, 1);
  const area = 4 * Math.PI * R * R;
  const g = (G_SI * Mkg) / (R * R);

  // Incoming starlight (W/m^2), summed over every star.
  let S = 0;
  for (const s of world.bodies) {
    if (!isLuminous(s) || s === b) continue;
    const d = Math.hypot(s.x - b.x, s.y - b.y, s.z - b.z) * AU_M;
    S += (s.lum * L_SUN) / (4 * Math.PI * d * d);
  }
  th.flux = S / 1361;

  if (b.kind === 'gas') {
    // Gas giants: cloud-top temperature from sunlight plus their own internal heat.
    th.albedo = 0.33;
    const Teq4 = ((1 - th.albedo) * S) / (4 * SIGMA);
    const dTb = th.Eint / (Mkg * heatCapacity(b));
    th.Ts = Math.pow(Teq4 + Math.pow(c.tint || 0, 4) + Math.pow(dTb, 4), 0.25);
    th.ice = 0; th.ocean = 0; th.liquid = 0; th.cloud = 1; th.latSpan = 8;
    coolInterior(b, th, area, dt);
    return;
  }

  // Water inventory as an equivalent surface pressure (Earth's oceans ≈ 264 bar).
  const Pwater = (c.water * Mkg * g) / area / 1e5;
  const Ptot = atm.p + th.steam;
  th.boil = 1 / (1 / 373.15 - Math.log(Math.max(Ptot, 0.006)) / 4890); // Clausius-Clapeyron
  th.latSpan = Ptot > 10 ? 5 : Ptot > 0.05 ? 50 : 90;

  // Greenhouse optical depth: CO2 and other gases, water vapour (rises steeply with temperature
  // while liquid water is present), and any steam atmosphere.
  const T = th.Ts || 250;
  const liquidNow = Pwater > 0 && T > 255 && T < th.boil;
  const tauVapour = liquidNow ? Math.min(3, 0.15 * Math.exp((T - 288) / 25)) : 0;
  // CO2: linear when it is the bulk of a thick atmosphere, logarithmic as a trace gas, and weaker in
  // thin air because there is little pressure broadening of its absorption lines.
  const pco2 = atm.p * atm.co2;
  const tauCo2 = 1.2 * pco2 + 0.08 * Math.log(1 + pco2 / 1e-4) * Math.sqrt(Math.min(1, Ptot));
  th.tau = tauCo2 + 0.45 * Math.min(atm.p * (1 - atm.co2), 5) + tauVapour + 1.0 * th.steam;
  const eps = 1 / (1 + th.tau);

  // Ice: where the latitude is below freezing, limited by how much water there is to freeze.
  const coverage = Pwater > 0 ? Math.min(1, 0.71 * Math.sqrt(Math.max(0, Pwater - th.steam) / 264)) : 0;
  const span = th.latSpan;
  // Permanent ice needs an annual mean below about -10 °C (263 K).
  const coldArea = 1 - Math.sqrt(Math.min(1, Math.max(0, (T + span * 0.33 - 263) / span)));
  const allFrozen = T + span * 0.33 < 263;
  th.ice = Pwater > 0 ? Math.min(coldArea, Math.min(1, coverage * 1.4)) : 0;
  if (c.ice > 0.005 && T < 150) th.ice = Math.max(th.ice, 0.9); // nitrogen and CO2 frosts
  // Comets and bodies like Ceres keep their ice under a dark crust of dust left behind as it sublimates.
  if (c.lag) th.ice *= 0.1;
  if (c.iceMax !== undefined) th.ice = Math.min(th.ice, c.iceMax); // dirty ice mixed with rock
  th.ocean = allFrozen ? 0 : coverage;
  th.liquid = T < th.boil && !allFrozen ? coverage * (1 - th.ice) : 0;
  th.cloud = Ptot > 10 ? 1 : th.liquid > 0 && Ptot > 0.1 ? 0.4 + 0.2 * coverage : 0;

  const cloudAlb = Ptot > 10 ? 0.77 : 0.55;
  const land = Math.max(0, 1 - th.ice - th.liquid);
  // Polar ice sits where sunlight is weakest, so small caps reflect less than their area suggests.
  const iceW = 0.45 + 0.55 * th.ice;
  const surfAlb = th.ice * 0.6 * iceW + th.liquid * 0.06 + land * c.rockAlbedo + th.ice * (1 - iceW) * c.rockAlbedo;
  th.albedo = th.cloud * cloudAlb + (1 - th.cloud) * surfAlb;

  // Equilibrium with sunlight, plus interior heat showing through (fully once the crust melts).
  const Teq4 = ((1 - th.albedo) * S) / (4 * SIGMA * eps);
  const dTb = th.Eint / (Mkg * heatCapacity(b));
  const exposed = 0.02 + 0.98 * smooth(900, 1500, Math.pow(Teq4, 0.25) + dTb);
  const target = Math.pow(Teq4 + exposed * Math.pow(dTb, 4), 0.25);

  // Surface relaxes toward the target: years for an ocean, weeks for bare rock.
  const Cs = th.liquid > 0.05 ? 4e8 : 2e7; // J m^-2 K^-1
  const tauT = Cs / (4 * SIGMA * eps * Math.pow(Math.max(target, 30), 3));
  th.Ts = !th.Ts || dt === Infinity ? target : th.Ts + (target - th.Ts) * (1 - Math.exp(-dt / tauT));

  // Steam: oceans boil off above the boiling point and rain back out below it (about a decade).
  const tauSteam = 10 * YEAR_S;
  if (Pwater > 0) {
    const want = th.Ts > th.boil ? Pwater : th.Ts < th.boil - 15 ? 0 : th.steam;
    th.steam += (want - th.steam) * (dt === Infinity ? 1 : 1 - Math.exp(-dt / tauSteam));
  } else th.steam = 0;

  th.exposed = exposed;
  coolInterior(b, th, area, dt, exposed);
}

// Interior heat leaks out through the surface: dE/dt = -A σ k ΔT^4, solved exactly over the step.
function coolInterior(b, th, area, dt, exposed = 1) {
  if (th.Eint <= 0 || dt === Infinity) return;
  const C = b.m * MSUN_KG * heatCapacity(b);
  const k = (area * SIGMA * exposed) / Math.pow(C, 4);
  const E0 = th.Eint;
  th.Eint = E0 / Math.cbrt(1 + 3 * k * E0 * E0 * E0 * dt);
}

function smooth(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// Collisions: half the impact's kinetic energy stays in the survivor as heat. Compositions mix by
// mass, atmospheres add up, and violent impacts blow some of the air away.
export function mergeThermal(s, o, vrel2AUyr, violence, world) {
  ensureThermal(s, world);
  ensureThermal(o, world);
  const m1 = s.m * MSUN_KG, m2 = o.m * MSUN_KG;
  const mu = (m1 * m2) / (m1 + m2);
  const v2 = vrel2AUyr * AUYR_MS * AUYR_MS;
  // About 30% of the kinetic energy stays as heat; the rest leaves with vapour and radiation during the impact.
  const impactE = 0.5 * mu * v2 * 0.3;
  const w1 = s.m / (s.m + o.m), w2 = 1 - w1;
  const cs = s.comp, co = o.comp;
  for (const k of ['iron', 'rock', 'water', 'ice', 'gas', 'rockAlbedo', 'tint']) cs[k] = (cs[k] || 0) * w1 + (co[k] || 0) * w2;
  const atmMass = (b) => (b.atm.p * 4 * Math.PI * (b.r * AU_M) ** 2) / Math.max((G_SI * b.m * MSUN_KG) / (b.r * AU_M) ** 2, 1e-6);
  const a1 = atmMass(s), a2 = atmMass(o);
  const co2 = a1 + a2 > 0 ? (s.atm.co2 * a1 + o.atm.co2 * a2) / (a1 + a2) : 0;
  s.th.Eint += o.th.Eint + impactE;
  s.th.steam = s.th.steam * w1 + o.th.steam * w2;
  s._atmMass = (a1 + a2) * (1 - Math.min(0.5, violence * 0.3));
  s._atmCo2 = co2;
}

// Called after the survivor's mass and radius are final, to turn atmospheric mass back into pressure.
export function finishMerge(s) {
  if (s._atmMass === undefined) return;
  const R = s.r * AU_M, g = (G_SI * s.m * MSUN_KG) / (R * R);
  s.atm.p = (s._atmMass * g) / (4 * Math.PI * R * R);
  s.atm.co2 = s._atmCo2;
  delete s._atmMass; delete s._atmCo2;
}

// Debris raining back down also heats the body.
export function accreteHeat(b, mSun, vrel2AUyr) {
  if (!b.th) return;
  b.th.Eint += 0.5 * mSun * MSUN_KG * vrel2AUyr * AUYR_MS * AUYR_MS * 0.5;
}

export function surfaceTemp(b) {
  return b.th ? b.th.Ts : null;
}
