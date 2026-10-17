// Headless checks of the physics: run with `node tools/simtest.mjs`.
import { World, orbitOf } from '../js/physics.js';
import { PRESETS } from '../js/presets.js';
import { G } from '../js/units.js';

function energy(w) {
  let k = 0, u = 0;
  const b = w.bodies;
  for (let i = 0; i < b.length; i++) {
    k += 0.5 * b[i].m * (b[i].vx ** 2 + b[i].vy ** 2 + b[i].vz ** 2);
    for (let j = i + 1; j < b.length; j++) u -= (G * b[i].m * b[j].m) / Math.hypot(b[i].x - b[j].x, b[i].y - b[j].y, b[i].z - b[j].z);
  }
  return k + u;
}

function run(id, years, frames = 600) {
  const w = new World();
  PRESETS.find((p) => p.id === id).build(w);
  const t0 = performance.now();
  const e0 = energy(w);
  let done = 0;
  for (let f = 0; f < frames; f++) done += w.advance(years / frames, 1e9);
  return { w, ms: performance.now() - t0, dE: (energy(w) - e0) / Math.abs(e0), done };
}

let r = run('solar', 1);
const earth = r.w.findByName('Earth'), sun = r.w.findByName('Sun'), moon = r.w.findByName('Moon');
console.log('solar 1yr', r.ms.toFixed(0) + 'ms', 'dE', r.dE.toExponential(2), 'bodies', r.w.bodies.length, 'particles', r.w.np, 'ring', r.w.nr);
console.log('  earth orbit', orbitOf(earth, sun), '\n  moon', orbitOf(moon, earth).period * 365.25, 'days');
r = run('impact', 6 / 8766, 300);
console.log('impact', r.ms.toFixed(0) + 'ms', 'bodies', r.w.bodies.map((b) => b.name), 'particles', r.w.np, r.w.events.map((e) => e.text));
r = run('tde', 3 / 365.25, 600);
console.log('tde', r.ms.toFixed(0) + 'ms', 'bodies', r.w.bodies.map((b) => b.name), 'particles', r.w.np, r.w.events.map((e) => e.text));
r = run('formation', 200, 600);
console.log('formation', r.ms.toFixed(0) + 'ms', 'bodies', r.w.bodies.length, 'events', r.w.events.length, 'dE', r.dE.toExponential(2));
r = run('galaxies', 6e8, 300);
console.log('galaxies', r.ms.toFixed(0) + 'ms', 'bodies', r.w.bodies.length, 'particles', r.w.np);
r = run('rogue', 40, 600);
console.log('rogue', r.ms.toFixed(0) + 'ms', 'bodies', r.w.bodies.length, r.w.events.map((e) => e.text));
r = run('binary', 30, 600);
console.log('binary', r.ms.toFixed(0) + 'ms', 'bodies', r.w.bodies.map((b) => b.name), r.w.events.map((e) => e.text));
r = run('jupiter', 30 / 365.25, 600);
console.log('jupiter', r.ms.toFixed(0) + 'ms', 'dE', r.dE.toExponential(2), r.w.bodies.length);
