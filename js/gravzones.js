// Gravity zones around a body: where it is deadly, where moons are torn apart, where they can orbit for
// good, and where its pull gives way to its parent's. Distances in AU from the body's centre.
//   Event horizon r_s = 2GM/c², photon sphere 1.5 r_s, innermost stable circular orbit (ISCO) 3 r_s
//     (Schwarzschild, non-spinning).
//   Deadly tides for a person: head-to-foot stretch 2GM·L/r³ above 10 g (L = 2 m).
//   Roche limit for a fluid / rubble moon of density 3000 kg/m³: 2.456 (3M / 4πρ)^(1/3) (Chandrasekhar 1969).
//   Sun-like stars torn apart (tidal disruption) at R☉ (M / M☉)^(1/3).
//   Hill sphere r_H = d (m / 3M_parent)^(1/3). Prograde moons stay bound out to about half of it
//     (Domingos, Winter & Yokoyama 2006, MNRAS 373, 1227: 0.49 r_H at low eccentricity).

import { schwarzschild } from './bodies.js';

const AU_M = 1.495978707e11;
const MSUN_KG = 1.98847e30;
const G_SI = 6.6743e-11;

export function gravZones(b, hier) {
  if (!(b.m > 0)) return null;
  const M = b.m * MSUN_KG;
  const z = [];
  if (b.kind === 'bh') {
    const rs = schwarzschild(b.m);
    z.push({ name: 'Event horizon: no escape, even for light', r: rs, col: [170, 90, 255] });
    z.push({ name: 'Photon sphere: light orbits', r: 1.5 * rs, col: [255, 200, 90] });
    z.push({ name: 'Plunge zone: no stable orbits', r: 3 * rs, col: [255, 80, 50] });
  }
  // Tidal disruption of a Sun-like star, r_t = R☉ (M / M☉)^(1/3) (Hills 1975, Nature 254, 295). Above
  // ~10⁸ M☉ it lies inside the horizon, so such black holes swallow stars whole.
  if (b.kind === 'bh' || b.kind === 'ns') z.push({ name: 'Stars torn apart', r: 0.00465047 * Math.cbrt(b.m), col: [255, 110, 70] });
  const rTide = Math.cbrt((2 * G_SI * M * 2) / 98) / AU_M;
  z.push({ name: 'Deadly tides for a person', r: rTide, col: [255, 70, 130] });
  const rRoche = (2.456 * Math.cbrt((3 * M) / (4 * Math.PI * 3000))) / AU_M;
  z.push({ name: 'Roche limit: moons torn into rings', r: rRoche, col: [255, 150, 60] });
  const info = hier && hier.get(b);
  if (info && info.parent && isFinite(info.rH)) {
    z.push({ name: 'Stable orbits for moons', r: 0.49 * info.rH, col: [90, 220, 120], a: 0.12 });
    z.push({ name: `Weakly held: moons drift off to ${info.parent.name}`, r: info.rH, col: [240, 210, 90], fade: true });
  }
  // Nest the zones from the inside out: each starts where the previous one ends, and anything inside
  // the body itself is dropped (a white dwarf's deadly-tide radius lies under its surface).
  const min = b.kind === 'bh' ? 0 : b.r * 1.02;
  const out = [];
  let rin = 0;
  for (const q of z) {
    const rout = q.r;
    if (rout <= Math.max(rin, min)) continue;
    out.push({ name: q.name, col: q.col, a: q.a, fade: q.fade, g: true, rin: Math.max(rin, min), rout });
    rin = rout;
  }
  return out.length ? { zones: out } : null;
}

