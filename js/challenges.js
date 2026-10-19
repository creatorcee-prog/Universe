// Challenges: goals to reach inside a scenario, in the spirit of Universe Sandbox's, and famous calculations
// done with the simulation's own numbers. Each names a scenario, a goal, a hint, a check run a few times a
// second (returning progress, done or failed), and the real science behind it with a source.

import { orbitOf } from './physics.js';
import { makeBody, isLuminous } from './bodies.js';
import { G } from './units.js';

const KM = 1 / 1.495978707e8;            // AU per km
const EARTH_MASS = 3.003e-6;             // M☉
const wiki = (page) => ['Wikipedia: ' + decodeURIComponent(page).replace(/_/g, ' '), 'https://en.wikipedia.org/wiki/' + page];

const find = (w, name) => { const b = w.findByName(name); return b && b.alive ? b : null; };

// The body pulling hardest on b (its host), among the others.
function hostOf(w, b) {
  let best = null, bf = 0;
  for (const h of w.bodies) {
    if (h === b || h.m <= b.m) continue;
    const f = h.m / ((h.x - b.x) ** 2 + (h.y - b.y) ** 2 + (h.z - b.z) ** 2);
    if (f > bf) { bf = f; best = h; }
  }
  return best;
}

export const CHALLENGES = [
  {
    id: 'moon', tag: 'Sandbox', title: 'Give Earth a second moon', preset: 'earthmoon',
    goal: 'Get anything besides the Moon to go once all the way around Earth.',
    hint: 'Open Create (+), pick something small such as an asteroid and tap near Earth: new objects start on a circular orbit around whatever pulls hardest there. Keep clear of the Moon, whose pull would fling it away.',
    check(w, st) {
      const E = find(w, 'Earth'), S = w.bodies.find((b) => b.kind === 'star');
      if (!E) return { fail: 'Earth is gone.' };
      const hill = S ? Math.hypot(E.x - S.x, E.y - S.y, E.z - S.z) * Math.cbrt(E.m / (3 * S.m)) : Infinity;
      let best = null;
      for (const b of w.bodies) {
        if (b === E || b.name === 'Moon' || isLuminous(b) || b.m >= E.m) continue;
        const o = orbitOf(b, E);
        if (!(o.bound && o.a * (1 + o.e) < 0.5 * hill)) { st.since.delete(b); continue; }
        if (!st.since.has(b)) st.since.set(b, w.t);
        const k = (w.t - st.since.get(b)) / o.period;
        if (k >= 1) return { done: `${b.name} completed an orbit of Earth.` };
        if (!best || k > best.k) best = { b, k };
      }
      return { progress: best ? `${best.b.name}: ${Math.round(best.k * 100)}% of the way around` : 'Nothing is orbiting Earth yet besides the Moon' };
    },
    science: 'Earth really does catch small "minimoons" now and then: asteroids 2006 RH120 and 2020 CD3 circled it for months before the Sun pulled them away. A capture only lasts if something takes energy away, which is why most real moons formed where they are, or from giant impacts.',
    source: wiki('Temporary_satellite'),
  },
  {
    id: 'kepler', tag: 'Famous law', title: 'A planet with a two-year year', preset: 'solar',
    goal: 'Add a planet that takes two Earth years (±5%) to go around the Sun.',
    hint: 'Kepler found that a planet\'s year squared equals its distance from the Sun cubed, in years and AU (P² = a³). Work out the distance for P = 2, then Create a planet there: grid lines are 1 AU apart, and the Motion tab shows its period.',
    check(w, st) {
      const S = find(w, 'Sun');
      if (!S) return { fail: 'The Sun is gone.' };
      let near = null;
      for (const b of w.bodies) {
        if (st.initial.has(b) || isLuminous(b) || hostOf(w, b) !== S) continue;
        const o = orbitOf(b, S);
        if (!o.bound) continue;
        if (Math.abs(o.period - 2) < 0.1) return { done: `${b.name}'s year is ${o.period.toFixed(2)} Earth years, at ${o.a.toFixed(2)} AU.` };
        if (!near || Math.abs(o.period - 2) < Math.abs(near.period - 2)) near = { name: b.name, period: o.period, a: o.a };
      }
      return { progress: near ? `${near.name}: ${near.period.toFixed(2)} years at ${near.a.toFixed(2)} AU` : 'No new planet yet' };
    },
    science: 'P² = a³ is Kepler\'s third law (Harmonices Mundi, 1619): a two-year orbit lies at 2^(2/3) = 1.59 AU, between Mars and the asteroid belt. Newton later showed it follows from gravity, with the Sun\'s mass setting the constant.',
    source: wiki('Kepler%27s_laws_of_planetary_motion'),
  },
  {
    id: 'weigh', tag: 'Famous calculation', title: 'Weigh Jupiter using Io', preset: 'solar', follow: 'Jupiter',
    goal: 'From Io\'s distance and orbital period (tap Io, then Motion), work out Jupiter\'s mass in Earth masses, within 5%.',
    answer: { unit: 'Earth masses', truth: (w) => { const J = find(w, 'Jupiter'); return J ? J.m / EARTH_MASS : NaN; } },
    hint: 'Newton\'s form of Kepler\'s law: M = 4π² a³ / (G T²). With the distance a in km and the period T in days, that is M ≈ 1.33 × 10⁻¹⁴ × a³ / T² Earth masses.',
    check(w) {
      if (!find(w, 'Jupiter') || !find(w, 'Io')) return { fail: 'Jupiter or Io is gone.' };
      return { progress: 'Enter your answer below' };
    },
    science: 'Newton did exactly this in the Principia (1687), weighing Jupiter and Saturn against the Sun by their moons. Only ratios were possible until Henry Cavendish measured G with lead balls in 1798; then masses came out in kilograms, and the Earth itself was "weighed" at 6 × 10²⁴ kg.',
    source: wiki('Cavendish_experiment'),
  },
  {
    id: 'roche', tag: 'Famous law', title: 'Tear the Moon apart', preset: 'earthmoon',
    goal: 'Let Earth\'s tides break the Moon into pieces.',
    hint: 'Tides stretch a moon because its near side is pulled harder than its far side. Inside the Roche limit, about 9,500 km from Earth\'s centre for a solid moon (18,000 km for a fluid one), they win over the Moon\'s own gravity. Bring the Moon in close, or make Earth far heavier (Mass ×2, again and again) so its limit reaches the Moon.',
    check(w, st) {
      if (st.torn.has('Moon')) return { done: 'The Moon crossed the Roche limit and broke apart.' };
      if (!find(w, 'Moon')) return { fail: 'The Moon crashed or merged before tides could tear it apart.' };
      const E = find(w, 'Earth'), M = find(w, 'Moon');
      const d = E ? Math.hypot(E.x - M.x, E.y - M.y, E.z - M.z) / KM : 0;
      // (As physics.js applies it: R_moon (2 M_planet / m_moon)^(1/3), the solid-body limit.)
      const lim = E ? M.r * Math.cbrt((2 * E.m) / M.m) * (M.formed ? 1.5 : 1) / KM : 0;
      return { progress: E ? `Moon ${Math.round(d).toLocaleString('en-US')} km out · Roche limit ${Math.round(lim).toLocaleString('en-US')} km` : 'Earth is gone' };
    },
    science: 'Édouard Roche worked out the limit in 1848. Saturn\'s rings lie inside Saturn\'s, which may be why they never gathered into a moon, and Mars\'s moon Phobos is spiralling in and should break into a ring in 30–50 million years.',
    source: wiki('Roche_limit'),
  },
  {
    id: 'sl9', tag: 'Famous event', title: 'Shoemaker–Levy 9', preset: 'solar', follow: 'Jupiter', speed: 1 / 365.25 / 4,
    goal: 'A comet is falling toward Jupiter, as one did in 1992. Watch Jupiter\'s tides tear it apart.',
    hint: 'Just let time run (it passes closest in a few days). To see the breakup, zoom in on Jupiter and look for the comet\'s label.',
    setup(w) {
      // A comet bound to Jupiter, 40 Jupiter radii out and falling in, to pass 1.3 radii from its centre
      // (closer than Jupiter's Roche limit for a weak comet; SL9 passed ~1.3 radii out on 7 July 1992).
      const J = find(w, 'Jupiter');
      if (!J) return;
      const mu = G * J.m, rp = 1.3 * J.r, ra = 400 * J.r, a = (rp + ra) / 2, e = (ra - rp) / (ra + rp), r0 = 40 * J.r;
      const v = Math.sqrt(mu * (2 / r0 - 1 / a)), vt = Math.sqrt(mu * a * (1 - e * e)) / r0, vr = -Math.sqrt(Math.max(0, v * v - vt * vt));
      const sl = Math.hypot(J.x, J.y, J.z), ux = J.x / sl, uy = J.y / sl, uz = J.z / sl;     // away from the Sun
      const jv = Math.hypot(J.vx, J.vy, J.vz), tx = J.vx / jv, ty = J.vy / jv, tz = J.vz / jv; // along Jupiter's motion
      const c = makeBody({ name: 'Shoemaker–Levy 9', kind: 'rocky', comet: true, compKey: 'comet', m: 1e13 / 1.98847e30, r: 1.5 * KM, color: [196, 204, 214] });
      c.x = J.x + ux * r0; c.y = J.y + uy * r0; c.z = J.z + uz * r0;
      c.vx = J.vx + ux * vr + tx * vt; c.vy = J.vy + uy * vr + ty * vt; c.vz = J.vz + uz * vr + tz * vt;
      w.addBody(c);
    },
    check(w, st) {
      if (st.torn.has('Shoemaker–Levy 9')) return { done: 'Jupiter\'s tides tore the comet into a string of fragments.' };
      const c = find(w, 'Shoemaker–Levy 9'), J = find(w, 'Jupiter');
      if (!c) return { fail: 'The comet hit Jupiter whole: it did not pass the Roche limit first.' };
      return { progress: J ? `${(Math.hypot(c.x - J.x, c.y - J.y, c.z - J.z) / J.r).toFixed(1)} Jupiter radii from Jupiter` : '' };
    },
    science: 'Comet Shoemaker–Levy 9 broke into about 21 pieces when it passed Jupiter in July 1992; the "string of pearls" came back and hit Jupiter from 16 to 22 July 1994, leaving dark scars bigger than Earth. It was the first collision between two Solar System bodies ever watched.',
    source: wiki('Comet_Shoemaker%E2%80%93Levy_9'),
  },
  {
    id: 'habitable', tag: 'Sandbox', title: 'A second home', preset: 'solar',
    goal: 'Make a world other than Earth habitable for life as we know it.',
    hint: 'Life needs liquid water at about 250–330 K, enough air and a world big enough to keep it. Tap the Sun and "Show temperature zones" to see the habitable zone, then put a world there (Create, or move one), and give it water and air.',
    check(w) {
      for (const b of w.bodies) {
        if (b.kind !== 'rocky' || /^Earth( \d+)?$/.test(b.name)) continue;
        if (b.th && b.th.hab && b.th.hab.verdict === 'Habitable') return { done: `${b.name} is habitable.` };
      }
      return { progress: 'No other habitable world yet' };
    },
    science: 'The habitable zone around the Sun runs from about 0.95 to 1.7 AU for an Earth-like planet (Kasting et al. 1993; Kopparapu et al. 2013). Of the thousands of known exoplanets a few dozen orbit in their star\'s, such as TRAPPIST-1e and Proxima Centauri b.',
    source: wiki('Habitable_zone'),
  },
  {
    id: 'destroy', tag: 'Sandbox', title: 'Destroy the Earth', preset: 'solar',
    goal: 'Break the Earth apart, by impact, tides or heat.',
    hint: 'The Laser (Tools) pours energy in until Earth boils away; or Create something big, a planet or a star, and drop it on Earth.',
    check(w) {
      return find(w, 'Earth') ? { progress: 'Earth is still in one piece' } : { done: 'The Earth is no more.' };
    },
    science: 'Taking Earth fully apart needs its gravitational binding energy, about 2.2 × 10³² J: the Sun\'s entire output for about a week, or 10⁸ times the impact that ended the dinosaurs.',
    source: wiki('Gravitational_binding_energy'),
  },
];

// The active challenge and the record of finished ones (kept in this browser only).
export class Challenges {
  constructor(app) {
    this.app = app;
    this.active = null;
    try { this.doneSet = new Set(JSON.parse(localStorage.getItem('pu-challenges') || '[]')); } catch { this.doneSet = new Set(); }
  }

  start(c) {
    const app = this.app;
    this.starting = true;
    app.loadPreset(c.preset);
    this.starting = false;
    if (c.setup) c.setup(app.world);
    if (c.follow) {
      const f = find(app.world, c.follow);
      if (f) { app.cam.focus(f, performance.now()); app.cam.distGoal = f.r * 40; }
    }
    if (c.speed) app.ui.setSpeed(c.speed);
    this.active = { c, st: { initial: new Set(app.world.bodies), since: new Map(), torn: new Set() }, result: null, t: 0 };
    app.ui.showChallenge(this.active);
  }

  stop() { this.active = null; this.app.ui.showChallenge(null); }

  // Bodies torn apart by tides are reported as events; the checks look for them by name.
  event(ev) { if (this.active && ev.torn) this.active.st.torn.add(ev.torn); }

  answer(v) {
    const a = this.active;
    if (!a || !a.c.answer) return;
    const truth = a.c.answer.truth(this.app.world);
    if (!(v > 0)) { this.app.ui.toast('Enter a number.'); return; }
    if (Math.abs(v / truth - 1) <= 0.05) this.finish({ done: `${v} ${a.c.answer.unit}: right (the simulation has ${truth.toPrecision(4)}).` });
    else this.app.ui.toast(`${v} is ${v > truth ? 'too high' : 'too low'}: off by ${Math.round(Math.abs(v / truth - 1) * 100)}%.`);
  }

  finish(r) {
    const a = this.active;
    a.result = r;
    if (r.done) {
      this.doneSet.add(a.c.id);
      try { localStorage.setItem('pu-challenges', JSON.stringify([...this.doneSet])); } catch { /* private mode: not remembered */ }
      this.app.audio.ui('affirm');
    }
    this.app.ui.showChallenge(a);
  }

  tick(now) {
    const a = this.active;
    if (!a || a.result || now - a.t < 300) return;
    a.t = now;
    const r = a.c.check(this.app.world, a.st);
    if (r.done || r.fail) this.finish(r);
    else this.app.ui.challengeProgress(r.progress);
  }
}
