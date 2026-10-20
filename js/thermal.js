// Planetary thermal model: composition, energy balance, ice, oceans and steam.
//
// Surface temperature comes from absorbed starlight (set by distance and albedo), heat radiated to
// space (reduced by the atmosphere's greenhouse effect), and internal heat (from impacts) leaking out
// through the surface. Albedo, ice cover, oceans and clouds are then derived from that temperature
// and the body's composition, which feeds back into the next step (so ice-albedo runaways happen).

import { isLuminous } from './bodies.js';
import { transientLum } from './stellar.js';

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
  Venus: { iron: 0.3, rock: 0.7, water: 1e-8, atm: { gases: { co2: 89, n2: 3.2 }, rockCO2: 0 } },
  Earth: { iron: 0.32, rock: 0.68, water: 2.3e-4, life: true, atm: { gases: { n2: 0.78, o2: 0.21, co2: 0.0004, ch4: 1.9e-6 } } },
  Moon: { iron: 0.02, rock: 0.98, rockAlbedo: 0.12 },
  Mars: { iron: 0.25, rock: 0.75, water: 7.8e-6, rockAlbedo: 0.27, atm: { gases: { co2: 0.0057, n2: 0.00016 } } },
  Ceres: { rock: 0.75, water: 0.25, rockAlbedo: 0.09, lag: true },
  Jupiter: { gas: 0.9, rock: 0.05, ice: 0.05, tint: 99 },
  Io: { iron: 0.2, rock: 0.8, rockAlbedo: 0.6 },
  Europa: { iron: 0.1, rock: 0.82, water: 0.08 },
  Ganymede: { iron: 0.1, rock: 0.45, water: 0.45, rockAlbedo: 0.25, iceMax: 0.5 },
  Callisto: { iron: 0.05, rock: 0.5, water: 0.45, rockAlbedo: 0.15, iceMax: 0.15 },
  Saturn: { gas: 0.88, rock: 0.06, ice: 0.06, tint: 76 },
  Uranus: { gas: 0.15, water: 0.6, ice: 0.15, rock: 0.1, tint: 0 },
  Neptune: { gas: 0.15, water: 0.6, ice: 0.15, rock: 0.1, tint: 51 },
  // Titan: 1.47 bar, ~95% N2 and ~5% CH4 at the surface (Huygens; Niemann et al. 2005).
  Titan: { rock: 0.55, water: 0.45, iceMax: 0.6, atm: { gases: { n2: 1.4, ch4: 0.07 } } },
  Pluto: { rock: 0.68, water: 0.3, ice: 0.02, atm: { gases: { n2: 1e-5, ch4: 5e-8 } } },
  "Halley's Comet": { rock: 0.5, water: 0.4, ice: 0.1, rockAlbedo: 0.04, lag: true },
  Theia: { iron: 0.3, rock: 0.7 },
  'Proto-Earth': { iron: 0.32, rock: 0.68, water: 2.3e-4, atm: { gases: { co2: 0.3, n2: 0.7 } }, dT0: 1200 },
  // Catalogue templates
  oceanworld: { iron: 0.15, rock: 0.55, water: 0.3, atm: { gases: { n2: 1.98, co2: 0.02 } } },
  icemoon: { iron: 0.05, rock: 0.5, water: 0.45 },
  asteroid: { iron: 0.1, rock: 0.9, rockAlbedo: 0.1 },
  comet: { rock: 0.5, water: 0.4, ice: 0.1, rockAlbedo: 0.04, lag: true },
  // Irregular moons: captured, very dark (albedo ~0.04-0.06; Grav et al. 2015) rock and carbon.
  darkmoon: { iron: 0.1, rock: 0.9, rockAlbedo: 0.05 },
  // Kuiper-belt dwarf planets: rock and ice under frozen nitrogen and methane.
  kbo: { rock: 0.65, water: 0.33, ice: 0.02 },
  // Triton: a thin nitrogen atmosphere, 14 μbar (Voyager 2; Tyler et al. 1989).
  Triton: { rock: 0.7, water: 0.28, ice: 0.02, atm: { gases: { n2: 1.4e-5, ch4: 2e-9 } } },
};

function defaultComposition(b) {
  const me = b.m / 3.0035e-6;
  if (b.comet) return { ...COMPOSITIONS.comet };
  if (b.kind === 'gas') return me < 50 ? { ...COMPOSITIONS.Neptune, tint: 40 } : { ...COMPOSITIONS.Jupiter, tint: 100 * Math.pow(b.m / 9.55e-4, 0.3) };
  if (me < 1e-4) return { ...COMPOSITIONS.asteroid };
  if (b.atmo) return { ...COMPOSITIONS.Earth, life: false, atm: { gases: { n2: 0.98, co2: 0.02 } } };
  if (me < 0.05) return { ...COMPOSITIONS.Moon };
  return { iron: 0.3, rock: 0.7, water: 1e-5, atm: { gases: { co2: 0.09, n2: 0.01 } } };
}

// Give a body its composition and starting thermal state (it starts at equilibrium).
export function ensureThermal(b, world) {
  if (b.th) return b.th;
  const c = b.comp || (b.compKey && COMPOSITIONS[b.compKey]) || COMPOSITIONS[b.name] || defaultComposition(b);
  const comp = { iron: 0, rock: 0, water: 0, ice: 0, gas: 0, rockAlbedo: 0.15, tint: 0, ...c };
  delete comp.atm;
  delete comp.life;
  const gases = { n2: 0, o2: 0, co2: 0, ch4: 0, h2: 0, ...((c.atm && c.atm.gases) || {}) };
  // CO2 locked in carbonate rock, released by volcanism and taken up by weathering (bar-equivalent).
  // Earth's crust holds roughly 60 bar of it.
  const rockCO2 = c.atm && c.atm.rockCO2 !== undefined ? c.atm.rockCO2 : b.kind === 'rocky' && b.m > 0.05 * 3.0035e-6 ? 60 * comp.rock : 0;
  b.comp = comp;
  b.atm = { gases, rockCO2, p: 0, co2: 0 };
  syncAtm(b.atm);
  b.life = !!c.life;
  if (b.life && b.lifeAge === undefined) b.lifeAge = 3.8e9; // Earth: life for ~3.8 billion years
  // Start warm: climates with oceans can have two stable states (temperate or snowball), and real
  // planets like Earth sit on the warm one.
  const th = { habTime: 0, stress: 0, Ts: 320, Eint: 0, steam: 0, albedo: 0.3, ice: 0, cloud: 0, ocean: 0, liquid: 0, boil: 373, latSpan: 50, tau: 0, flux: 0 };
  b.th = th;
  if (comp.dT0) th.Eint = comp.dT0 * b.m * MSUN_KG * heatCapacity(b);
  // Iterate to a self-consistent start (temperature, ice and albedo depend on one another).
  findStars(world);   // (may be called outside thermalStep)
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
// Small moons riding on their planet (minors.js) change slowly: they are updated in turn, one frame in eight,
// with the time gathered since their last update.
let thermalFrame = 0;
const starList = [];   // this frame's light sources, found once instead of per planet
function findStars(world) {
  starList.length = 0;
  for (const s of world.bodies) if (isLuminous(s)) starList.push(s);
}
export function thermalStep(world, dtYears) {
  thermalFrame++;
  findStars(world);
  for (const b of world.bodies) {
    if (!thermalKinds.has(b.kind)) continue;
    if (!b.th) { ensureThermal(b, world); continue; }
    if (b.minor) {
      b._thDt = (b._thDt || 0) + dtYears;
      if ((thermalFrame + b.id) % 8 !== 0) continue;
      thermalUpdate(b, world, b._thDt * YEAR_S);
      b._thDt = 0;
    } else thermalUpdate(b, world, dtYears * YEAR_S);
  }
}

function thermalUpdate(b, world, dt) {
  const th = b.th, c = b.comp, atm = b.atm;
  const Mkg = b.m * MSUN_KG, R = Math.max(b.r * AU_M, 1);
  const area = 4 * Math.PI * R * R;
  const g = (G_SI * Mkg) / (R * R);

  // Incoming starlight (W/m^2), summed over every star.
  let S = 0;
  for (let i = 0; i < starList.length; i++) {
    const s = starList[i];
    if (s === b) continue;
    const dx = s.x - b.x, dy = s.y - b.y, dz = s.z - b.z, d = Math.sqrt(dx * dx + dy * dy + dz * dz) * AU_M;
    S += (s.lum * L_SUN) / (4 * Math.PI * d * d);
  }
  // Supernova light: billions of suns for a few weeks.
  for (const t of world.transients || []) {
    const d = Math.hypot(t.x - b.x, t.y - b.y, t.z - b.z) * AU_M;
    S += (transientLum(t, world.t) * L_SUN) / (4 * Math.PI * d * d);
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

  // Greenhouse optical depth: CO2, methane and other gases, water vapour (rises steeply with
  // temperature while liquid water is present), and any steam atmosphere.
  const T = th.Ts || 250;
  const liquidNow = Pwater > 0 && T > 255 && T < th.boil;
  const tauVapour = liquidNow ? Math.min(3, 0.15 * Math.exp((T - 288) / 25)) : 0;
  const gs = atm.gases;
  const broad = Math.sqrt(Math.min(1, Ptot));
  // CO2: linear when it is the bulk of a thick atmosphere, logarithmic as a trace gas, and weaker in
  // thin air because there is little pressure broadening of its absorption lines.
  const tauCo2 = 1.2 * gs.co2 + 0.08 * Math.log(1 + gs.co2 / 1e-4) * broad;
  const tauCh4 = 0.03 * Math.log(1 + gs.ch4 / 1e-7) * broad;
  th.tau = tauCo2 + tauCh4 + 0.45 * Math.min(gs.n2 + gs.o2, 5) + 2 * gs.h2 + tauVapour + 1.0 * th.steam;
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
  if (dt !== Infinity && dt > 0) evolveAtmosphere(b, world, dt, Mkg, R, g, area, Pwater);
  th.hab = habitability(b);
  if (dt !== Infinity && dt > 0) evolveLife(b, world, dt);
}

const GAS = { n2: { mu: 28, frost: 77 }, o2: { mu: 32 }, co2: { mu: 44, frost: 195 }, ch4: { mu: 16, frost: 112 }, h2: { mu: 2 } };
const K_B = 1.380649e-23, AMU = 1.66054e-27;

export function syncAtm(atm) {
  const g = atm.gases;
  atm.p = g.n2 + g.o2 + g.co2 + g.ch4 + g.h2;
  atm.co2 = atm.p > 0 ? g.co2 / atm.p : 0;
}

// Jeans parameter: gravitational binding of a molecule over its thermal energy at the top of the
// atmosphere. Below about 6 a gas boils off to space in centuries; above about 40 it stays for aeons.
export function jeans(b, mu) {
  const th = b.th;
  const Texo = Math.max(300, th.Ts * 3) * Math.pow(Math.max(th.flux, 1e-3), 0.12);
  return (G_SI * b.m * MSUN_KG * mu * AMU) / (Math.max(b.r * AU_M, 1) * K_B * Texo);
}

function evolveAtmosphere(b, world, dt, Mkg, R, g, area, Pwater) {
  const th = b.th, c = b.comp, atm = b.atm, gs = atm.gases;
  const yr = YEAR_S;
  const relax = (tau) => 1 - Math.exp(-dt / tau);
  // 1. Escape to space.
  for (const k of Object.keys(gs)) {
    if (gs[k] <= 0) continue;
    const lam = jeans(b, GAS[k].mu);
    if (lam < 45) gs[k] *= Math.exp(-dt / (1e3 * yr * Math.exp(lam - 6)));
  }
  // Hydrogen from water split by sunlight escapes too, so a steam atmosphere slowly dries a planet out.
  if (th.steam > 1) c.water *= Math.exp(-dt / (3e8 * yr));
  // 2. Volatile ices: freeze out where it is cold enough, sublimate back when it warms.
  const Pice = (c.ice * Mkg * g) / area / 1e5;
  const Tcold = th.ice > 0.5 ? th.Ts : th.Ts - Math.min(0.67 * th.latSpan, 0.3 * th.Ts);
  const gasKey = Tcold > 110 ? 'co2' : 'n2';
  for (const k of ['co2', 'n2', 'ch4']) {
    const peq = Math.pow(Math.max(Tcold, 1) / GAS[k].frost, 1 / 0.06);
    if (gs[k] > peq) {
      const dp = (gs[k] - peq) * relax(yr);
      gs[k] -= dp;
      c.ice += (dp * 1e5 * area) / (g * Mkg);
    } else if (k === gasKey && Pice > 0) {
      const dp = Math.min(Pice, peq - gs[k]) * relax(yr);
      gs[k] += dp;
      c.ice = Math.max(0, c.ice - (dp * 1e5 * area) / (g * Mkg));
    }
  }
  // 3. Volcanism: a molten surface releases CO2 (and some N2) from the rock within centuries.
  if (th.exposed > 0.3 && atm.rockCO2 > 0) {
    const rel = atm.rockCO2 * relax(1e3 * yr) * th.exposed;
    atm.rockCO2 -= rel; gs.co2 += rel * 0.9; gs.n2 += rel * 0.1;
  }
  // Background volcanism on Earth-sized worlds keeps topping up CO2 (~4e-8 bar per year for Earth).
  if (b.m > 0.3 * 3.0035e-6 && atm.rockCO2 > 0) {
    const rel = atm.rockCO2 * relax(1e9 * yr);
    atm.rockCO2 -= rel; gs.co2 += rel;
  }
  // 4. Carbonate-silicate cycle: with liquid water, rain and weathering lock CO2 into rock faster when
  // warm and slower when cold. Over hundreds of thousands of years this thermostats the climate.
  if (th.liquid > 0.05 && b.m > 0.05 * 3.0035e-6) {
    const eq = Math.min(10, Math.max(1e-6, 1e-4 * Math.exp((288 - th.Ts) / 12)));
    const want = Math.min(eq, gs.co2 + atm.rockCO2);
    const dp = (want - gs.co2) * relax(1e4 * yr);
    gs.co2 += dp; atm.rockCO2 -= dp;
  }
  // 5. Oxygen exists only while life keeps making it; otherwise it reacts away into the rocks.
  if (b.life && th.liquid > 0.05) gs.o2 += (0.21 * Math.max(0.2, gs.n2 / 0.78) - gs.o2) * relax(1e7 * yr);
  else gs.o2 *= Math.exp(-dt / (1e5 * yr));
  for (const k of Object.keys(gs)) if (gs[k] < 1e-12) gs[k] = 0;
  syncAtm(atm);
}

// Can life as we know it exist here? Each requirement is checked separately.
export function habitability(b) {
  const th = b.th, c = b.comp, atm = b.atm;
  if (b.kind !== 'rocky') return { verdict: 'Uninhabitable', score: 0, reasons: ['no solid surface'], checks: [['A solid surface', false, 'Gas giant: no surface to live on']] };
  const p = atm.p + th.steam;
  const lam = jeans(b, 28);
  const molten = (th.exposed || 0) > 0.2;
  const boiled = th.steam > 1 || th.Ts > 330;  // what little water a hot world keeps is vapour, not ice
  // Each check: label, passed, detail, and the short reason it fails (for "Uninhabitable: …").
  const checks = [
    ['Liquid water', th.liquid > 0.01, th.liquid > 0.01 ? `${Math.round(th.liquid * 100)}% of the surface` : c.water <= 0 ? 'No water' : boiled ? 'Boiled into steam' : 'Frozen',
      c.water <= 0 ? 'no water' : boiled ? 'water boiled away' : 'water frozen'],
    ['Temperature', th.Ts >= 250 && th.Ts <= 330, `${Math.round(th.Ts)} K (needs about 250–330 K)`, th.Ts < 250 ? 'too cold' : 'too hot'],
    ['Air pressure', p >= 0.01 && p <= 100, `${p < 0.01 ? p.toExponential(1) : p.toPrecision(3)} bar (needs about 0.01–100)`, p < 0.01 ? 'air too thin' : 'air too thick'],
    ['Holds onto its air', lam > 30, lam > 30 ? 'Gravity strong enough' : 'Too small or hot: air escapes to space', 'gravity too weak to keep air'],
    ['Starlight', th.flux >= 0.2 && th.flux <= 3, `${th.flux < 0.01 ? th.flux.toExponential(1) : th.flux.toPrecision(2)} × Earth's`, th.flux < 0.2 ? 'too little starlight' : 'too much starlight'],
    ['Solid, cool surface', !molten, molten ? 'Molten after an impact' : 'Yes', 'molten surface'],
    ['Raw ingredients', c.rock + c.iron > 0.2 && c.water > 0 && (atm.gases.co2 > 1e-7 || atm.gases.ch4 > 1e-7 || atm.rockCO2 > 0), 'Rock, water and carbon', c.rock + c.iron <= 0.2 ? 'too little rock' : c.water <= 0 ? '' : 'no carbon'],
  ];
  const ok = checks.filter((x) => x[1]).length;
  const verdict = ok === checks.length ? 'Habitable' : ok >= checks.length - 2 && checks[0][1] ? 'Marginal' : 'Uninhabitable';
  // "Water frozen" and "too cold" say the same thing twice; keep the plainer one.
  // Most telling first: heat and light, then air, then water and ingredients.
  const order = [1, 4, 2, 3, 0, 5, 6];
  let reasons = order.map((i) => checks[i]).filter((x) => !x[1] && x[3]).map((x) => x[3]);
  if (reasons.includes('too cold')) reasons = reasons.filter((r) => r !== 'water frozen');
  if (reasons.includes('too hot')) reasons = reasons.filter((r) => r !== 'water boiled away');
  return { verdict, score: ok / checks.length, checks, reasons };
}

// Life as we don't know it: ideas scientists have put forward for places the checklist above rules out, kept
// apart from it because none is more than a hypothesis. Returns { verdict, ideas: [[name, text, source]] }
// or null when no idea applies.
const ME_THERMAL = 3.003e-6, MJ_THERMAL = 9.546e-4;
export function exoticLife(b) {
  const th = b.th, ideas = [];
  let verdict = 'Speculative';
  if (b.kind === 'ns') {
    return { verdict: 'Science fiction', ideas: [['Cheela', 'Tiny, fast-living creatures built from nuclear matter on the crust, living a lifetime in minutes: an invented biology, not a scientific proposal.', 'Robert L. Forward, Dragon\'s Egg (1980)']] };
  }
  if (!th) return null;
  if (b.kind === 'gas') {
    if (b.m > 13 * MJ_THERMAL) {
      if (th.Ts < 600) ideas.push(['Floaters in a cold brown dwarf', 'The coolest brown dwarfs have a layer of temperate air, kept warm from below, where gas-bag organisms could stay aloft for good.', 'Yates et al. 2017, ApJ 836, 184']);
    } else if (th.Ts < 400) {
      ideas.push(['Floaters, sinkers and hunters', 'Gas-bag organisms kilometres across drifting in the water-cloud layer, where the air is near room temperature: sinkers small enough to fall and breed fast, floaters that keep themselves aloft, hunters that eat them. Convection carries anything that sinks too deep down to be cooked.', 'Sagan & Salpeter 1976, ApJS 32, 737']);
    }
  } else if (b.kind === 'rocky') {
    const g = (b.atm && b.atm.gases) || {}, P = (b.atm ? b.atm.p : 0) + th.steam, c = b.comp || {};
    const icy = (c.water || 0) > 0.05 && th.Ts < 200;   // a water-rich world this cold is ice on the outside
    if (P > 10 && th.Ts > 450) {
      ideas.push(['Microbes in the clouds', 'High in the cloud deck, 50-60 km up on Venus, the air is 30-70 °C at about Earth\'s pressure: droplets of concentrated sulphuric acid could host hardy microbes. A claimed sign of them, phosphine, is disputed.', 'Morowitz & Sagan 1967, Nature 215, 1259; Seager et al. 2021, Astrobiology 21, 1206']);
    }
    if ((g.ch4 || 0) / Math.max(P, 1e-9) > 0.01 && th.Ts > 80 && th.Ts < 125 && P > 0.3) {
      ideas.push(['Life in liquid methane', 'Cells with membranes of acrylonitrile (azotosomes) instead of fats, living in methane lakes at -180 °C. Later modelling found such membranes would not form on their own.', 'Stevenson, Lunine & Clancy 2015, Sci. Adv. 1, e1400067; Sandström & Rahm 2020, Sci. Adv. 6, eaax0272']);
    }
    if (icy && b.host && b.host.kind === 'gas' && b.m > 1e-5 * ME_THERMAL) {
      verdict = 'Possible beneath the ice';
      ideas.push(['An ocean under the ice', 'Tides from its planet can keep a salty ocean liquid under the shell, in contact with rock: microbes could live off the chemistry of hydrothermal vents, as they do in Earth\'s deep sea. Enceladus\'s plume carries the hydrogen such life could feed on.', 'Waite et al. 2017, Science 356, 155; Hand et al. 2020, Space Sci. Rev. 216, 81']);
    }
    if (!icy && (c.water || 0) > 0 && P > 1e-3 && P < 0.1 && th.Ts > 150 && th.Ts < 250) {
      ideas.push(['Microbes deep underground', 'Below a cold, thin-aired surface, rock warmed from within can hold briny groundwater; radar has hinted at salty lakes under Mars\'s south polar ice, though that reading is disputed.', 'Orosei et al. 2018, Science 361, 490']);
    }
  }
  return ideas.length ? { verdict, ideas } : null;
}

// Reasons as one phrase: "too cold, air too thin and no water".
export function listReasons(r) {
  return r.length <= 1 ? r.join('') : r.slice(0, -1).join(', ') + ' and ' + r[r.length - 1];
}

// Life dies out after a thousand years without liquid water at a livable temperature, and simple life
// arises after ~300 million years of continuously habitable conditions.
function evolveLife(b, world, dt) {
  const th = b.th;
  if (b.kind !== 'rocky') return;
  const core = th.liquid > 0.01 && th.Ts > 250 && th.Ts < 340 && !((th.exposed || 0) > 0.2);
  const yr = YEAR_S;
  if (b.life) {
    b.lifeAge = (b.lifeAge || 0) + dt / yr;
    th.stress = core ? 0 : th.stress + dt;
    if (th.stress > 1e3 * yr) {
      b.life = false;
      world.events.push({ text: `Life on ${b.name} has died out`, body: b, big: true, snd: 'denied', power: 1 });
    }
  } else {
    th.habTime = core ? th.habTime + dt : 0;
    if (th.habTime > 3e8 * yr) {
      b.life = true;
      b.lifeAge = 0;
      world.events.push({ text: `Simple life has emerged on ${b.name} after 300 million habitable years`, body: b, big: true, snd: 'complete', power: 1 });
    }
  }
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
  // Pressure -> mass of air (and rock-bound CO2) per gas, so they can be added up.
  const toMass = (b, p) => (p * 1e5 * 4 * Math.PI * (b.r * AU_M) ** 2) / Math.max((G_SI * b.m * MSUN_KG) / (b.r * AU_M) ** 2, 1e-6);
  const keep = 1 - Math.min(0.5, violence * 0.3); // violent impacts blow some air away
  s._gasMass = {};
  for (const k of Object.keys(s.atm.gases)) s._gasMass[k] = (toMass(s, s.atm.gases[k]) + toMass(o, o.atm.gases[k] || 0)) * keep;
  s._rockCO2 = toMass(s, s.atm.rockCO2) + toMass(o, o.atm.rockCO2 || 0);
  s.th.Eint += o.th.Eint + impactE;
  s.th.steam = s.th.steam * w1 + o.th.steam * w2;
  s.life = s.life && violence < 0.5;
}

// Called after the survivor's mass and radius are final, to turn atmospheric mass back into pressure.
export function finishMerge(s) {
  if (!s._gasMass) return;
  const R = s.r * AU_M, g = (G_SI * s.m * MSUN_KG) / (R * R);
  const toP = (m) => (m * g) / (4 * Math.PI * R * R) / 1e5;
  for (const k of Object.keys(s._gasMass)) s.atm.gases[k] = toP(s._gasMass[k]);
  s.atm.rockCO2 = toP(s._rockCO2);
  syncAtm(s.atm);
  delete s._gasMass; delete s._rockCO2;
}

// Debris raining back down also heats the body.
export function accreteHeat(b, mSun, vrel2AUyr) {
  if (!b.th) return;
  b.th.Eint += 0.5 * mSun * MSUN_KG * vrel2AUyr * AUYR_MS * AUYR_MS * 0.5;
}

// Material raining down (debris, supernova ejecta) joins the body's composition.
// Particle kinds: 0 debris, 1 hot, 4 ice, 5 dust, 6 gas, 7 rock, 8 hydrogen, 9 oxygen, 10 silicon, 11 iron.
const KIND_MATERIAL = { 0: 'rock', 1: 'rock', 4: 'water', 5: 'rock', 6: 'gas', 7: 'rock', 8: 'gas', 9: 'water', 10: 'rock', 11: 'iron', 12: 'gas' };
export function accreteMaterial(b, mSun, kind) {
  if (!b.comp || mSun <= 0) return;
  const key = KIND_MATERIAL[kind];
  if (!key) return;
  const f = mSun / (b.m + mSun);
  for (const k of ['iron', 'rock', 'water', 'ice', 'gas']) b.comp[k] *= 1 - f;
  b.comp[key] += f;
}

export function surfaceTemp(b) {
  return b.th ? b.th.Ts : null;
}

// ---------- temperature zones around a heat source ----------

// Kopparapu et al. (2013, ApJ 765, 131; erratum 2013 ApJ 770, 82): stellar flux, in units of Earth's,
// at the habitable zone's edges as a function of the star's effective temperature.
function kopparapu(T, s0, a, b, c, d) {
  const t = Math.max(2600, Math.min(7200, T || 5780)) - 5780;
  return s0 + a * t + b * t * t + c * t ** 3 + d * t ** 4;
}

// Flux (Earth = 1) at which a dark, fast-spinning body sits at temperature T: T = 278.6 K × S^¼.
const fluxAt = (T) => Math.pow(T / 278.6, 4);

// Heat output of a body in solar luminosities: its own light for stars, or the glow of an impact-heated
// planet (σT⁴ over its surface while it holds a lot of internal heat). Null if it gives off little heat.
export function heatOutput(b) {
  if (b.lum > 0) return b.lum;
  const th = b.th;
  if (!th || th.Eint <= 0) return null;
  const dTb = th.Eint / (b.m * MSUN_KG * heatCapacity(b));
  if (dTb < 300 || th.Ts < 600) return null;
  const R = b.r * AU_M;
  return (4 * Math.PI * R * R * SIGMA * th.Ts ** 4) / L_SUN;
}

// Rings of equilibrium temperature around a source, as distances (AU) from its centre.
// Zones closer in than the body's own surface are dropped, so small emitters only show what reaches out.
export function tempZones(b) {
  const L = heatOutput(b);
  if (!L) return null;
  const T = b.lum > 0 ? b.temp : b.th.Ts;
  const d = (S) => Math.sqrt(L / S);
  const sInner = kopparapu(T, 1.107, 1.332e-4, 1.58e-8, -8.308e-12, -1.931e-15); // runaway greenhouse
  const sOuter = kopparapu(T, 0.356, 6.171e-5, 1.698e-9, -3.198e-12, -5.575e-16); // maximum greenhouse
  const zones = [
    { name: 'Molten rock', rin: 0, rout: d(fluxAt(1400)), col: [255, 90, 40] },
    { name: 'Too hot for water', rin: d(fluxAt(1400)), rout: d(sInner), col: [255, 170, 60] },
    { name: 'Habitable zone', rin: d(sInner), rout: d(sOuter), col: [90, 220, 120] },
    { name: 'Cold', rin: d(sOuter), rout: d(fluxAt(170)), col: [120, 170, 255] },
    { name: 'Water ice (beyond the snow line)', rin: d(fluxAt(170)), rout: d(fluxAt(40)), col: [160, 225, 255], fade: true },
  ];
  const min = b.r * 1.05;
  const out = [];
  for (const z of zones) {
    if (z.rout <= min) continue;
    out.push({ ...z, rin: Math.max(z.rin, min) });
  }
  return out.length ? { L, zones: out } : null;
}

// Local surface temperature at a latitude for a given sine of the Sun's elevation (negative at night).
// Air carries heat round to the night side; airless ground is near radiative balance with the Sun
// overhead (sub-solar ~1.41x the mean) and freezes at night (the Moon swings ~390 K to ~95 K).
export function localTemp(b, lat, sinElev) {
  const th = b.th;
  if (!th) return null;
  const p = (b.atm ? b.atm.p : 0) + th.steam;
  const base = th.Ts + th.latSpan * (0.33 - Math.sin(lat) ** 2);
  const se = Math.max(0, sinElev);
  const dn = p > 10 ? 0.01 : 0.06;
  const w = 1 / (1 + p / 0.004);
  return base * ((1 - w) * (1 + dn * (Math.sqrt(se) - 0.45)) + w * Math.max(0.4, 1.414 * Math.pow(se, 0.25)));
}

// Habitability of one spot, 0..1, from its local temperature and the planet-wide conditions.
export function localHab(b, T) {
  const th = b.th, c = b.comp;
  if (!th || b.kind !== 'rocky' || !c || c.water <= 0) return 0;
  const p = (b.atm ? b.atm.p : 0) + th.steam;
  if (p < 0.006 || p > 200 || (th.exposed || 0) > 0.2) return 0;
  // Peak around 288-300 K, nothing below freezing-with-brines (~250 K) or above ~330 K.
  const warm = T < 250 ? 0 : T < 288 ? (T - 250) / 38 : T < 305 ? 1 : T < 330 ? (330 - T) / 25 : 0;
  return warm * Math.min(1, p / 0.05);
}
