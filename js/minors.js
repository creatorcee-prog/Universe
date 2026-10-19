// Small moons on their own integrator. Hundreds of moons, some circling their planet in 7 hours, would
// force the shared N-body step down to minutes of simulated time. Instead each small moon ("minor" body)
// moves in its planet's frame with a Wisdom-Holman style kick-drift-kick (Wisdom & Holman 1991, AJ 102,
// 1528): the drift is its exact Kepler orbit about the planet, the kicks add the tidal pull of the other
// large bodies (the Sun, other planets) and the direct pull of the planet's big moons. Their positions come
// from the main integrator's dense output, so a frame of any length costs only a few kicks per moon.
// The dwarf planets ride on the Sun the same way, with the planets' tides as kicks (heliocentric
// Wisdom-Holman), and their own moons ride on them.
// Minor moons do not pull on anything (the largest, Titan, is 1/4000 of Saturn). A moon is handed to the
// full integrator ("promoted") when something other than its planet pulls on it strongly, when it is no
// longer bound, when it touches another body, or when its planet is gone.

import { G } from './units.js';

const MAX_SUB = 64;         // kicks per moon per frame
const pertBuf = [], sibBuf = [];   // scratch lists (see pertFor)
const SIB_GM = 2.5e-13;     // moons above ~0.03 km³/s² (Epimetheus, Janus, Amalthea and up) pull on their neighbours (M☉ units):
                            // their mutual pull is what makes Janus and Epimetheus swap orbits every four years
// The planets' flattening, J2 (Jacobson; Iess et al. 2019 for Saturn): it makes close moons' orbits precess
// and sets co-orbitals like Janus and Epimetheus apart. Along the planet's pole, as the moon frames use it
// (presets.js moonState: tilt about the x axis).
const J2 = { Earth: 1.0826e-3, Mars: 1.9566e-3, Jupiter: 1.4736e-2, Saturn: 1.6298e-2, Uranus: 3.343e-3, Neptune: 3.411e-3 };
const TILT = { Earth: 23.44, Mars: 25.2, Jupiter: 3.1, Saturn: 26.7, Uranus: 97.8, Neptune: 28.3 };

// Kepler drift of (r, v) about mass mu = GM for time dt, elliptic orbits (f and g functions in the change of
// eccentric anomaly; Danby, Fundamentals of Celestial Mechanics §6.8). Writes into s = [x, y, z, vx, vy, vz].
// Returns false if the orbit is not bound.
function kepler(s, mu, dt) {
  const x = s[0], y = s[1], z = s[2], vx = s[3], vy = s[4], vz = s[5];
  const r0 = Math.sqrt(x * x + y * y + z * z), v2 = vx * vx + vy * vy + vz * vz;
  const ia = 2 / r0 - v2 / mu;                       // 1/a
  if (!(ia > 0)) return false;
  const a = 1 / ia, n = Math.sqrt(mu * ia * ia * ia);
  const P = (2 * Math.PI) / n;
  const t = dt - Math.floor(dt / P) * P;             // whole orbits change nothing (f and g are periodic)
  const sig = (x * vx + y * vy + z * vz) / Math.sqrt(mu * a);  // e sin E0
  const ec = 1 - r0 * ia;                            // e cos E0
  // Solve Kepler's equation from the starting eccentric anomaly E0 (e sin E0 = sig, e cos E0 = ec).
  const e = Math.sqrt(ec * ec + sig * sig), E0 = Math.atan2(sig, ec);
  const Ma = E0 - sig + n * t;
  let Ea = Ma + 0.85 * e * Math.sign(Math.sin(Ma));
  for (let k = 0; k < 40; k++) {
    const dE = (Ea - e * Math.sin(Ea) - Ma) / (1 - e * Math.cos(Ea));
    Ea -= dE;
    if (Math.abs(dE) < 1e-13) break;
  }
  const E = Ea - E0;
  const sE = Math.sin(E), cE = Math.cos(E);
  const r = a * (1 - ec * cE + sig * sE);
  const f = 1 - (a / r0) * (1 - cE), g = t + (sE - E) / n;
  const fd = (-Math.sqrt(mu * a) * sE) / (r * r0), gd = 1 - (a / r) * (1 - cE);
  s[0] = f * x + g * vx; s[1] = f * y + g * vy; s[2] = f * z + g * vz;
  s[3] = fd * x + gd * vx; s[4] = fd * y + gd * vy; s[5] = fd * z + gd * vz;
  return true;
}

// Before the main step: each minor moon's state relative to its planet, grouped by planet.
// A moon of over 1% of its planet's mass (Charon, Vanth) is its "partner": the pair circle their common centre
// of mass, which lies outside Pluto. For the main step the planet stands in for the pair, at that centre with
// their summed mass; afterwards the pair's exact Kepler orbit puts both back on either side of it.
export function prepareMinors(world) {
  const groups = new Map();
  for (const b of world.bodies) {
    if (!b.minor) continue;
    // One level of nesting: Charon rides on Pluto, which rides on the Sun.
    const h = world.resolve(b.host);
    if (!h || !h.alive || (h.minor && !(h.host && h.host.alive && !h.host.minor))) { promote(world, b); continue; }
    b.host = h;
    let g = groups.get(h);
    if (!g) {
      g = { host: h, ms: [], partner: null };
      groups.set(h, g);
    }
    b._s = [b.x - h.x, b.y - h.y, b.z - h.z, b.vx - h.vx, b.vy - h.vy, b.vz - h.vz];
    g.ms.push(b);
    if (b.m > 0.01 * h.m && (!g.partner || b.m > g.partner.m)) g.partner = b;
  }
  for (const g of groups.values()) {
    const h = g.host, p = g.partner;
    if (p) {
      // Move the planet to the pair's centre of mass and give it the pair's mass; the other moons orbit that.
      const f = p.m / (h.m + p.m), s = p._s;
      g.f = f; g.mh = h.m;
      h.x += f * s[0]; h.y += f * s[1]; h.z += f * s[2];
      h.vx += f * s[3]; h.vy += f * s[4]; h.vz += f * s[5];
      h.m += p.m;
      if (h._s) { const q = h._s; for (let k = 0; k < 6; k++) q[k] += f * s[k]; }  // the planet rides on the Sun
      for (const m of g.ms) if (m !== p) { const q = m._s; for (let k = 0; k < 6; k++) q[k] -= f * s[k]; }
      g.ms = g.ms.filter((m) => m !== p);
    }
    g.x0 = h.x; g.y0 = h.y; g.z0 = h.z;
  }
  // Hosts that ride on another host are moved after it (the Sun's group before Pluto's).
  return new Map([...groups].sort((a, b) => (a[0].minor ? 1 : 0) - (b[0].minor ? 1 : 0)));
}

export function promote(world, b) {
  b.minor = false;
  b._s = null;
  world.dirty = true;
  world.dynStale = true;
}

// After the main step: advance every minor moon by `span`, using the attractors' positions recorded at
// cpT[0..steps] (cp holds x, y, z, m per attractor, `att` in the same order).
// Per planet, the big moons (above SIB_GM, which pull on their neighbours) move together in lockstep and their
// states are kept at every kick. Each small moon then moves on its own: as many kicks as its own orbit needs,
// and only the pulls that matter to it (the Sun's and other planets' tides above 1e-8 of its planet's pull, a
// big moon's above 1e-6). Most small moons feel none, and drift on their exact Kepler orbit in one step.
export function stepMinors(world, groups, att, cp, cpT, steps, t0, span) {
  if (!groups.size) return;   // (with span 0 too: a partner's planet must still be put back)
  const na = att.length, stride = na * 4;
  let seg = 0;
  // Position of attractor a at time t (linear between the recorded nodes); returns its mass.
  const at = (a, t, out) => {
    while (seg < steps - 1 && cpT[seg + 1] < t) seg++;
    while (seg > 0 && cpT[seg] > t) seg--;
    const tb = cpT[Math.min(seg + 1, steps)], ta = cpT[seg];
    const f = tb > ta ? Math.min(1, Math.max(0, (t - ta) / (tb - ta))) : 1;
    const qa = seg * stride + a * 4, qb = Math.min(seg + 1, steps) * stride + a * 4;
    out[0] = cp[qa] + (cp[qb] - cp[qa]) * f;
    out[1] = cp[qa + 1] + (cp[qb + 1] - cp[qa + 1]) * f;
    out[2] = cp[qa + 2] + (cp[qb + 2] - cp[qa + 2]) * f;
    return cp[qb + 3];
  };
  const hp = [0, 0, 0], kp = [0, 0, 0];
  const period = (r, M) => 2 * Math.PI * Math.sqrt((r * r * r) / (G * M));
  const kicks = (P) => Math.max(1, Math.min(MAX_SUB, Math.ceil(span / (P / 8))));
  for (const g of groups.values()) {
    const h = g.host, ms = g.ms, muH = G * h.m;
    const hi = att.indexOf(h);
    const hostAt = (t) => {
      if (hi >= 0) at(hi, t, hp);
      else { const f = (t - t0) / span; hp[0] = g.x0 + (h.x - g.x0) * f; hp[1] = g.y0 + (h.y - g.y0) * f; hp[2] = g.z0 + (h.z - g.z0) * f; }
    };
    // Other large bodies whose tide at distance r (from the planet) is above 1e-8 of the planet's pull.
    const Ds = att.map((b) => (b === h || !(b.m > 0) ? 0 : Math.hypot(b.x - h.x, b.y - h.y, b.z - h.z)));
    // (One list, reused: each moon's is used up before the next is asked for.)
    const pertFor = (r) => {
      const out = pertBuf;
      out.length = 0;
      for (let a = 0; a < na; a++) {
        const D = Ds[a];
        if (D > 0 && (D < 4 * r || 2 * (att[a].m / h.m) * (r / D) ** 3 > 1e-8)) out.push(a);
      }
      return out;
    };
    // Pull of the attractors in `pert` on a moon at s (relative to the planet), tidal form; adds into acc.
    const pullAtt = (pert, t, s, m, acc) => {
      for (let i = 0; i < pert.length; i++) {
        const a = pert[i];
        const mk = at(a, t, kp) * G;
        if (!(mk > 0)) continue;
        const sx = kp[0] - hp[0], sy = kp[1] - hp[1], sz = kp[2] - hp[2];
        const S2 = sx * sx + sy * sy + sz * sz, S3 = S2 * Math.sqrt(S2);
        const dx = sx - s[0], dy = sy - s[1], dz = sz - s[2];
        const d2 = dx * dx + dy * dy + dz * dz, d = Math.sqrt(d2);
        if (d < (att[a].r + m.r) * 2) m._hit = true;
        const i3 = 1 / (d2 * d);
        acc[0] += mk * (dx * i3 - sx / S3); acc[1] += mk * (dy * i3 - sy / S3); acc[2] += mk * (dz * i3 - sz / S3);
      }
    };
    // Pull of a big moon at so (relative to the planet), with the planet's own share taken out.
    const pullSib = (o, so, s, m, acc) => {
      const mo = G * o.m, ro = Math.hypot(so[0], so[1], so[2]), ro3 = ro * ro * ro;
      const dx = so[0] - s[0], dy = so[1] - s[1], dz = so[2] - s[2];
      // (Two small moons that touch pass through each other: without the planet's flattening, the co-orbital
      // pair Janus and Epimetheus can come closer than their real ~10,000 km before swapping orbits.)
      const d2 = Math.max(dx * dx + dy * dy + dz * dz, (m.r + o.r) ** 2), d = Math.sqrt(d2);
      const i3 = 1 / (d2 * d);
      acc[0] += mo * (dx * i3 - so[0] / ro3); acc[1] += mo * (dy * i3 - so[1] / ro3); acc[2] += mo * (dz * i3 - so[2] / ro3);
    };
    const apply = (m, acc, w) => {
      const s = m._s, r2 = s[0] * s[0] + s[1] * s[1] + s[2] * s[2];
      // Promote a moon whose other pulls are twice its planet's (an encounter, or it is drifting away). The
      // Sun's tide on the outer irregular moons reaches about 0.9 of it at their farthest (Neso, Psamathe).
      if ((acc[0] * acc[0] + acc[1] * acc[1] + acc[2] * acc[2]) * r2 * r2 > 4 * muH * muH) m._hit = true;
      s[3] += acc[0] * w; s[4] += acc[1] * w; s[5] += acc[2] * w;
    };
    const drift = (m, dt) => {
      const s = m._s;
      if (m._stop) return;
      if (!kepler(s, G * (h.m + m.m), dt)) { m._hit = true; m._stop = true; return; }
      // Touching the planet: stop here; the full integrator merges them next frame.
      if (s[0] * s[0] + s[1] * s[1] + s[2] * s[2] < (h.r + m.r) ** 2) { m._hit = true; m._stop = true; }
    };
    const rOf = (m) => Math.hypot(m._s[0], m._s[1], m._s[2]);
    // Oblateness: a = -(3/2) J2 GM R² / r^5 [(1 - 5 z²/r²) r + 2 z pole], z along the pole.
    const pname = h.name.replace(/ \d+$/, ''), j2 = J2[pname] || 0;
    const tl = ((h.tiltDeg !== undefined ? h.tiltDeg : TILT[pname] || 0) * Math.PI) / 180;
    const pole = [0, Math.cos(tl), Math.sin(tl)], jk = 1.5 * j2 * muH * h.r * h.r;
    const pullJ2 = (s, acc) => {
      if (!j2) return;
      const r2 = s[0] * s[0] + s[1] * s[1] + s[2] * s[2], r = Math.sqrt(r2), z = s[0] * pole[0] + s[1] * pole[1] + s[2] * pole[2];
      const k = jk / (r2 * r2 * r), f = 1 - (5 * z * z) / r2;
      acc[0] -= k * (f * s[0] + 2 * z * pole[0]); acc[1] -= k * (f * s[1] + 2 * z * pole[1]); acc[2] -= k * (f * s[2] + 2 * z * pole[2]);
    };
    // Matters (above 1e-6 of the planet's pull) within ~130 radii for Saturn.
    const j2Matters = (r) => j2 * (h.r / r) ** 2 > 1e-6;

    // 1. The big moons, together. Their positions at each kick are kept for the small ones.
    const core = ms.filter((m) => m.m > SIB_GM);
    let snaps = null, nc = 0, dtc = span;
    if (core.length) {
      let pMin = Infinity, rMax = 0;
      for (const m of core) { const r = rOf(m); pMin = Math.min(pMin, period(r, h.m + m.m)); rMax = Math.max(rMax, r); }
      nc = kicks(pMin); dtc = span / nc;
      const pert = pertFor(rMax);
      snaps = new Float64Array((nc + 1) * core.length * 6);
      const keep = (k) => { for (let j = 0; j < core.length; j++) { const s = core[j]._s, q = (k * core.length + j) * 6; for (let c = 0; c < 6; c++) snaps[q + c] = s[c]; } };
      const acc = [0, 0, 0];
      const kick = (t, w) => {
        hostAt(t);
        for (const m of core) {
          acc[0] = acc[1] = acc[2] = 0;
          pullAtt(pert, t, m._s, m, acc);
          for (const o of core) if (o !== m) pullSib(o, o._s, m._s, m, acc);
          pullJ2(m._s, acc);
          m._acc = m._acc || [0, 0, 0];
          m._acc[0] = acc[0]; m._acc[1] = acc[1]; m._acc[2] = acc[2];
        }
        for (const m of core) apply(m, m._acc, w);
      };
      keep(0);
      kick(t0, dtc / 2);
      for (let k = 0; k < nc; k++) {
        for (const m of core) drift(m, dtc);
        keep(k + 1);
        kick(t0 + (k + 1) * dtc, k === nc - 1 ? dtc / 2 : dtc);
      }
    }
    // Big moon j's position at time t: cubic Hermite between the kept states (positions and velocities), so
    // it follows the curve of its orbit (a straight line would cut inside it by up to 8% of its radius).
    const sibAt = (j, t, out) => {
      const u = Math.min(nc, Math.max(0, (t - t0) / dtc)), k = Math.min(nc - 1, Math.floor(u)), f = u - k;
      const qa = (k * core.length + j) * 6, qb = ((k + 1) * core.length + j) * 6;
      const f2 = f * f, f3 = f2 * f;
      const h00 = 2 * f3 - 3 * f2 + 1, h10 = (f3 - 2 * f2 + f) * dtc, h01 = -2 * f3 + 3 * f2, h11 = (f3 - f2) * dtc;
      for (let c = 0; c < 3; c++) out[c] = h00 * snaps[qa + c] + h10 * snaps[qa + 3 + c] + h01 * snaps[qb + c] + h11 * snaps[qb + 3 + c];
      return out;
    };

    // 2. The small moons, each on its own.
    const so = [0, 0, 0], acc = [0, 0, 0];
    const smallKick = (m, pert, sibs, t, w) => {
      hostAt(t);
      acc[0] = acc[1] = acc[2] = 0;
      pullAtt(pert, t, m._s, m, acc);
      for (let i = 0; i < sibs.length; i++) pullSib(core[sibs[i]], sibAt(sibs[i], t, so), m._s, m, acc);
      if (m._j2) pullJ2(m._s, acc);
      apply(m, acc, w);
    };
    for (const m of ms) {
      if (m.m > SIB_GM) continue;
      const r = rOf(m), M = h.m + m.m;
      const pert = pertFor(r);
      // Big moons whose pull here is above 1e-6 of the planet's (by their nearest radial approach).
      const sibs = sibBuf;
      sibs.length = 0;
      for (let j = 0; j < core.length; j++) {
        const o = core[j], dr = Math.max(Math.abs(rOf(o) - r), 0.01 * r);
        if ((o.m / h.m) * (r / dr) ** 2 > 1e-6) sibs.push(j);
      }
      // (J2 alone only slowly precesses an orbit: it is added to moons that take kicks anyway, rather than making
      // every inner moon take them.)
      m._j2 = j2Matters(r);
      if (!pert.length && !sibs.length) { drift(m, span); continue; }
      const n = kicks(period(r, M)), dt = span / n;
      smallKick(m, pert, sibs, t0, dt / 2);
      for (let k = 0; k < n; k++) {
        drift(m, dt);
        smallKick(m, pert, sibs, t0 + (k + 1) * dt, k === n - 1 ? dt / 2 : dt);
      }
    }
    // The partner: the pair's relative orbit is an exact two-body Kepler orbit; split it about the centre.
    const p = g.partner;
    if (p) {
      h.m = g.mh;
      if (!kepler(p._s, G * (h.m + p.m), span) || !h.alive) p._hit = true;
      const s = p._s, f = g.f;
      for (const m of ms) { const q = m._s; for (let k = 0; k < 6; k++) q[k] += f * s[k]; }
      ms.push(p);
      h.x -= f * s[0]; h.y -= f * s[1]; h.z -= f * s[2];
      h.vx -= f * s[3]; h.vy -= f * s[4]; h.vz -= f * s[5];
    }
    for (const m of ms) {
      const s = m._s;
      m.x = h.x + s[0]; m.y = h.y + s[1]; m.z = h.z + s[2];
      m.vx = h.vx + s[3]; m.vy = h.vy + s[4]; m.vz = h.vz + s[5];
      if (m._hit) promote(world, m);
      m._hit = false; m._stop = false; m._s = null;
    }
  }
}
