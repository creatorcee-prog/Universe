// Stellar evolution and stellar deaths: main sequence, giant phase, planetary nebulae and supernovae.
//
// Lifetimes follow t ≈ 10 Gyr × (M/M☉)^-2.5. In the last 10% of its life a star swells into a red giant
// (or supergiant) and loses mass. Then:
//   M < 8 M☉   -> sheds a planetary nebula and leaves a white dwarf
//   M ≥ 8 M☉   -> core-collapse (Type II) supernova, leaving a neutron star (M < 20 M☉) or black hole
//   white dwarf pushed past 1.44 M☉ -> Type Ia supernova, nothing left behind
// Ejecta are particles of separate materials (hydrogen gas, oxygen, silicon, iron) with mass, which
// enrich whatever they land on. The explosion's light is a transient source that heats nearby planets.

import { G, SUN_RADIUS, km, kms } from './units.js';
import { starRadius, starTemp, starLuminosity, tempToRGB, schwarzschild } from './bodies.js';

// Particle material kinds for ejecta (continue the numbering in physics.js PK).
export const SN = { H: 8, O: 9, SI: 10, FE: 11 };

const GIANT_START = 0.9; // fraction of the lifetime at which the giant phase begins

export function lifetime(m) {
  return 1e10 * Math.pow(m, -2.5);
}

// Final white-dwarf mass for a low-mass star (initial-final mass relation, roughly).
function wdMass(m0) {
  return Math.min(1.35, 0.5 + 0.09 * m0);
}

// Update a star's radius, temperature, luminosity and mass for its age. Returns 'die' when it is time.
export function evolveStar(b, dtYears) {
  if (b.kind === 'wd') {
    // White dwarfs are born hot (~100 L☉) and fade: about 1 L☉ after a few million years, then dimmer.
    b.wdAge = (b.wdAge ?? 1e9) + dtYears;
    b.lum = Math.max(1e-4, 100 * Math.pow(1 + b.wdAge / 3e4, -1.3));
    b.temp = Math.max(4000, 100000 * Math.pow(1 + b.wdAge / 3e4, -0.35));
    b.color = tempToRGB(Math.min(b.temp, 30000));
    return null;
  }
  if (b.kind !== 'star') return null;
  if (b.age === undefined) b.age = 0;
  if (b.m0 === undefined) b.m0 = b.m;
  if (b.m > b.m0 * 1.001) {
    // Gaining mass (merger or edit): keep the same fraction of life lived, at the new mass's pace.
    b.age *= lifetime(b.m) / lifetime(b.m0);
    b.m0 = b.m;
  }
  b.age += dtYears;
  const life = lifetime(b.m0);
  const f = b.age / life;
  const ms = { r: starRadius(b.m), T: starTemp(b.m), L: starLuminosity(b.m) };
  if (f < GIANT_START) {
    // Main sequence: stars slowly brighten (the Sun is ~30% brighter now than at birth).
    // Normalised so a Sun-like star at 46% of its life (today's Sun) has today's luminosity and size.
    const k = 1 + 0.65 * (f - 0.46);
    b.r = ms.r * (1 + 0.2 * (f - 0.46)); b.temp = ms.T; b.lum = ms.L * k; b.giant = 0;
  } else {
    const g = Math.min(1, (f - GIANT_START) / (1 - GIANT_START));
    const massive = b.m0 >= 8;
    // Red giants reach ~200 R☉ (the Sun's will engulf Venus); red supergiants top out near 1,000 R☉.
    const Rg = (massive ? 1000 : 200 * Math.pow(b.m0, 0.3)) * SUN_RADIUS;
    b.r = ms.r + (Rg - ms.r) * g * g;
    b.temp = ms.T + (3500 - ms.T) * Math.min(1, g * 1.5);
    // Red supergiants peak near 1e5 L☉ (Betelgeuse, ~18 M☉: ~1.3e5 L☉); the Sun's red-giant tip is ~2,000-3,000 L☉.
    const Lg = massive ? 1e5 * Math.pow(b.m0 / 15, 1.5) : 2000 * Math.pow(b.m0, 0.5);
    b.lum = ms.L + (Math.max(Lg, ms.L) - ms.L) * g;
    b.giant = g;
    // Giants lose their outer layers in winds; lighter stars lose up to their white-dwarf mass.
    const target = massive ? b.m0 * 0.75 : wdMass(b.m0) + 0.25 * (b.m0 - wdMass(b.m0));
    b.m = b.m0 + (target - b.m0) * g;
  }
  b.color = tempToRGB(b.temp);
  return f >= 1 ? 'die' : null;
}

const rand = Math.random;
function dir() {
  const u = rand() * 2 - 1, t = rand() * Math.PI * 2, s = Math.sqrt(1 - u * u);
  return [s * Math.cos(t), u, s * Math.sin(t)];
}

// Spray ejecta: each entry is [kind, mass fraction, min km/s, max km/s].
function eject(world, s, mass, mix, count, remnantMass) {
  const free = world.particleCapacity - world.np - world.pending.length;
  count = Math.max(0, Math.min(count, free));
  // A few large plumes make the shell clumpy, like real remnants.
  const plumes = Array.from({ length: 7 }, () => dir());
  for (let i = 0; i < count; i++) {
    let r = rand(), pick = mix[mix.length - 1];
    for (const m of mix) { if ((r -= m[1]) <= 0) { pick = m; break; } }
    let d = dir();
    if (rand() < 0.45) {
      const p = plumes[(rand() * plumes.length) | 0];
      d = [p[0] + d[0] * 0.35, p[1] + d[1] * 0.35, p[2] + d[2] * 0.35];
      const l = Math.hypot(d[0], d[1], d[2]); d = d.map((v) => v / l);
    }
    const r0 = s.r * (1 + rand() * 0.5);
    // Never slower than escape: a nebula launched from a small star would otherwise fall straight back.
    const vesc = Math.sqrt((2 * G * remnantMass) / r0);
    const v = Math.max(kms(pick[2] + (pick[3] - pick[2]) * rand()), vesc * (1.15 + 0.3 * rand()));
    world.spawnParticle(s.x + d[0] * r0, s.y + d[1] * r0, s.z + d[2] * r0, s.vx + d[0] * v, s.vy + d[1] * v, s.vz + d[2] * v, mass / count, pick[0]);
  }
}

// Kill a star (or white dwarf) according to its mass. Returns a description of what happened.
export function stellarDeath(world, s, reason) {
  const flash = (r, color, life) => world.flashes.push({ x: s.x, y: s.y, z: s.z, r, born: performance.now(), life, color });
  if (s.kind === 'wd') {
    // Type Ia: a carbon-oxygen white dwarf detonates completely.
    eject(world, s, s.m, [[SN.FE, 0.6, 6000, 11000], [SN.SI, 0.3, 8000, 13000], [SN.O, 0.1, 10000, 15000]], 3000, 0);
    world.transients.push({ x: s.x, y: s.y, z: s.z, vx: s.vx, vy: s.vy, vz: s.vz, t0: world.t, peak: 5e9, decay: 0.08, temp: 11000 });
    flash(Math.max(s.r * 4000, 0.02), [255, 250, 235], 5000);
    s.alive = false; s.mergedInto = null;
    return `${s.name} detonated as a Type Ia supernova and was completely destroyed`;
  }
  if (s.kind !== 'star') return null;
  const m0 = s.m0 || s.m;
  if (m0 < 8) {
    const wd = wdMass(m0);
    const shed = Math.max(0, s.m - wd);
    eject(world, s, shed, [[SN.H, 0.85, 15, 40], [SN.O, 0.15, 10, 30]], 1600, wd);
    s.kind = 'wd'; s.m = wd; s.r = km(8700 * Math.cbrt(0.6 / wd)); s.temp = 100000; s.lum = 100; s.color = tempToRGB(25000); s.wdAge = 0;
    s.giant = 0;
    flash(s.r * 400, [190, 220, 255], 2500);
    return `${s.name} ${reason || 'reached the end of its life'}: it shed its outer layers as a planetary nebula and left a white dwarf`;
  }
  // Core collapse.
  const rem = m0 < 20 ? 1.4 : Math.max(3, 0.25 * s.m);
  const ej = Math.max(0, s.m - rem);
  eject(world, s, ej, [[SN.H, 0.7, 6000, 12000], [SN.O, 0.15, 2000, 5000], [SN.SI, 0.08, 1500, 4000], [SN.FE, 0.07, 1000, 3000]], 3200, rem);
  world.transients.push({ x: s.x, y: s.y, z: s.z, vx: s.vx, vy: s.vy, vz: s.vz, t0: world.t, peak: 1e9, decay: 0.12, temp: 9000 });
  flash(Math.max(s.r * 40, 0.02), [255, 240, 220], 6000);
  s.giant = 0;
  if (rem < 3) { s.kind = 'ns'; s.m = rem; s.r = km(12); s.temp = 600000; s.lum = 0.05; s.color = [190, 220, 255]; }
  else { s.kind = 'bh'; s.m = rem; s.r = schwarzschild(rem); s.lum = 0; s.temp = 0; s.color = [255, 170, 90]; }
  return `${s.name} exploded as a core-collapse supernova, leaving a ${s.kind === 'ns' ? 'neutron star' : 'black hole'}`;
}

// Light from an explosion, fading over weeks to months.
export function transientLum(t, now) {
  return t.peak * Math.exp(-(now - t.t0) / t.decay);
}
