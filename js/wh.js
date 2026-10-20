// A faster integrator for swarms: dozens to hundreds of bodies around one dominant star (Planet Formation).
// IAS15 steps everything together and evaluates every pair's pull 15 to 22 times a step; with 160 bodies that is
// most of a frame. This is the hybrid of REBOUND's MERCURIUS (Rein, Hernandez, Tamayo et al. 2019, MNRAS 485,
// 5490): a Wisdom-Holman step (Wisdom & Holman 1991, AJ 102, 1528) in democratic heliocentric coordinates
// (Duncan, Levison & Lee 1998, AJ 116, 2067). Each body follows its exact Kepler orbit about the star between
// kicks from the others' pulls: one force evaluation a step, and symplectic (its energy error stays bounded).
// A pair's pull is split smoothly by distance: the far part goes into the kicks; the near part (within a few
// Hill radii) is integrated with the bodies' Kepler motion by an adaptive Runge-Kutta (Dormand-Prince 5(4))
// for only the bodies in that encounter, so a close pass or a collision is followed closely while the rest of
// the swarm takes long steps. Contacts found during an encounter are handed to the collision code.
// The star's first post-Newtonian pull (Mercury's 43"/century) is kept, as an extra kick.
import { G, C_AU_YR } from './units.js';

const MIN_BODIES = 40, DOMINANT = 1000, HILLFAC = 3;

function stumpff(psi, out) {
  if (psi > 1e-6) { const s = Math.sqrt(psi); out[0] = (1 - Math.cos(s)) / psi; out[1] = (s - Math.sin(s)) / (psi * s); }
  else if (psi < -1e-6) { const s = Math.sqrt(-psi); out[0] = (1 - Math.cosh(s)) / psi; out[1] = (Math.sinh(s) - s) / (-psi * s); }
  else { out[0] = 0.5 - psi / 24 + (psi * psi) / 720; out[1] = 1 / 6 - psi / 120 + (psi * psi) / 5040; }
}

// Kepler orbit about mu for dt, in universal variables (Danby 1988), for q, p at offset o.
const CS = [0, 0];
function kepler(q, p, o, mu, dt) {
  const x = q[o], y = q[o + 1], z = q[o + 2], vx = p[o], vy = p[o + 1], vz = p[o + 2];
  const r0 = Math.sqrt(x * x + y * y + z * z), v2 = vx * vx + vy * vy + vz * vz, sm = Math.sqrt(mu);
  const alpha = 2 / r0 - v2 / mu, s0 = (x * vx + y * vy + z * vz) / sm;
  let chi = sm * dt * (alpha > 0 ? alpha : 1 / r0), r = r0;
  for (let it = 0; it < 40; it++) {
    const psi = alpha * chi * chi;
    stumpff(psi, CS);
    const c2 = CS[0], c3 = CS[1];
    r = chi * chi * c2 + s0 * chi * (1 - psi * c3) + r0 * (1 - psi * c2);
    const F = chi * chi * chi * c3 + s0 * chi * chi * c2 + r0 * chi * (1 - psi * c3) - sm * dt;
    const d = F / r;
    chi -= d;
    if (Math.abs(d) < 1e-15 * Math.max(1, Math.abs(chi))) break;
  }
  const psi = alpha * chi * chi;
  stumpff(psi, CS);
  const c2 = CS[0], c3 = CS[1];
  r = chi * chi * c2 + s0 * chi * (1 - psi * c3) + r0 * (1 - psi * c2);
  const f = 1 - (chi * chi * c2) / r0, g = dt - (chi * chi * chi * c3) / sm;
  const fd = (sm / (r * r0)) * chi * (psi * c3 - 1), gd = 1 - (chi * chi * c2) / r;
  q[o] = f * x + g * vx; q[o + 1] = f * y + g * vy; q[o + 2] = f * z + g * vz;
  p[o] = fd * x + gd * vx; p[o + 1] = fd * y + gd * vy; p[o + 2] = fd * z + gd * vz;
}

// The changeover: the share of a pair's pull in the kicks, from 0 inside a tenth of the critical distance to 1
// beyond it, smooth to the second derivative (MERCURIUS's default, L_mercury).
function L(r, rc) {
  const y = (r - 0.1 * rc) / (0.9 * rc);
  if (y <= 0) return 0;
  if (y >= 1) return 1;
  return y * y * y * (10 - 15 * y + 6 * y * y);
}

// Dormand-Prince 5(4) tableau.
const A = [[], [1 / 5], [3 / 40, 9 / 40], [44 / 45, -56 / 15, 32 / 9], [19372 / 6561, -25360 / 2187, 64448 / 6561, -212 / 729],
  [9017 / 3168, -355 / 33, 46732 / 5247, 49 / 176, -5103 / 18656], [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84]];
const B5 = [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84, 0];
const B4 = [5179 / 57600, 0, 7571 / 16695, 393 / 640, -92097 / 339200, 187 / 2100, 1 / 40];

export class WH {
  constructor() { this.n = 0; this.contacts = []; }

  // The step it takes now (up to dt), or 0 if this is not a swarm about one star.
  eligible(bs, dt) {
    const n = bs.length;
    if (n < MIN_BODIES) return 0;
    let s = 0, m2 = 0;
    for (let i = 1; i < n; i++) if (bs[i].m > bs[s].m) s = i;
    for (let i = 0; i < n; i++) if (i !== s && bs[i].m > m2) m2 = bs[i].m;
    const star = bs[s];
    if (!(star.m >= DOMINANT * m2) || star.soft > 0 || star.kind === 'core') return 0;
    let pmin = Infinity;
    for (let i = 0; i < n; i++) {
      if (i === s) continue;
      const b = bs[i], dx = b.x - star.x, dy = b.y - star.y, dz = b.z - star.z, r = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (r < 10 * (star.r + b.r)) return 0;   // (grazing the star: IAS15's small steps and its collision checks)
      const v2 = (b.vx - star.vx) ** 2 + (b.vy - star.vy) ** 2 + (b.vz - star.vz) ** 2;
      if (v2 * r > 1.9 * G * star.m) return 0;   // (escaping, or nearly: not a swarm orbit)
      const P = 2 * Math.PI * Math.sqrt((r * r * r) / (G * star.m));
      if (P < pmin) pmin = P;
    }
    this.star = s;
    // (1/25 of the shortest orbit: WHFast's usual few-percent step)
    return Math.min(dt, pmin / 25);
  }

  step(bs, h, mid) {
    const n = bs.length, s = this.star, star = bs[s];
    if (this.n < n) {
      this.n = n;
      this.Q = new Float64Array(3 * n); this.P = new Float64Array(3 * n); this.Acc = new Float64Array(3 * n);
      this.rc = new Float64Array(n); this.grp = new Int32Array(n);
    }
    const Q = this.Q, P = this.P, m0 = star.m, mu = G * m0, rc = this.rc;
    this.contacts.length = 0;
    let M = 0, cx = 0, cy = 0, cz = 0, vx = 0, vy = 0, vz = 0;
    for (const b of bs) { M += b.m; cx += b.m * b.x; cy += b.m * b.y; cz += b.m * b.z; vx += b.m * b.vx; vy += b.m * b.vy; vz += b.m * b.vz; }
    cx /= M; cy /= M; cz /= M; vx /= M; vy /= M; vz /= M;
    for (let i = 0; i < n; i++) {
      const b = bs[i], o = 3 * i;
      Q[o] = b.x - star.x; Q[o + 1] = b.y - star.y; Q[o + 2] = b.z - star.z;
      P[o] = b.vx - vx; P[o + 1] = b.vy - vy; P[o + 2] = b.vz - vz;
    }
    // Each body's critical distance: three Hill radii, or the distance it moves in 0.4 of a step, or twice its
    // radius (MERCURIUS's defaults).
    for (let i = 0; i < n; i++) {
      if (i === s) { rc[i] = 0; continue; }
      const o = 3 * i, r = Math.hypot(Q[o], Q[o + 1], Q[o + 2]);
      rc[i] = Math.max(HILLFAC * r * Math.cbrt(bs[i].m / (3 * m0)), 0.4 * Math.sqrt(mu / r) * h, 2 * bs[i].r);
    }
    this.kick(bs, h / 2);
    this.jump(bs, h / 2);
    const groups = this.encounters(bs, h);
    this.drift(bs, h / 2, groups, mu);
    if (mid) { this.place(bs, cx + vx * h / 2, cy + vy * h / 2, cz + vz * h / 2, vx, vy, vz, M); mid(); }
    this.drift(bs, h / 2, groups, mu);
    this.jump(bs, h / 2);
    this.kick(bs, h / 2);
    this.place(bs, cx + vx * h, cy + vy * h, cz + vz * h, vx, vy, vz, M);
    return h;
  }

  // Groups of bodies that come within a pair's critical distance during the step (straight-line relative
  // motion, a step either way, with a margin), joined into connected sets. Returns arrays of indices.
  encounters(bs, h) {
    const n = bs.length, s = this.star, Q = this.Q, P = this.P, rc = this.rc, grp = this.grp;
    for (let i = 0; i < n; i++) grp[i] = i;
    const find = (i) => { while (grp[i] !== i) { grp[i] = grp[grp[i]]; i = grp[i]; } return i; };
    let any = false;
    for (let i = 0; i < n; i++) {
      if (i === s) continue;
      const i3 = 3 * i, ri = rc[i];
      for (let j = i + 1; j < n; j++) {
        if (j === s) continue;
        const j3 = 3 * j, rcij = Math.max(ri, rc[j]) * 1.25;
        const dx = Q[j3] - Q[i3], dy = Q[j3 + 1] - Q[i3 + 1], dz = Q[j3 + 2] - Q[i3 + 2];
        const d2 = dx * dx + dy * dy + dz * dz;
        const ux = P[j3] - P[i3], uy = P[j3 + 1] - P[i3 + 1], uz = P[j3 + 2] - P[i3 + 2], u2 = ux * ux + uy * uy + uz * uz;
        const reach = rcij + Math.sqrt(u2) * h;
        if (d2 > reach * reach) continue;
        // closest approach within the step
        let t = u2 > 0 ? -(dx * ux + dy * uy + dz * uz) / u2 : 0;
        t = Math.max(0, Math.min(h, t));
        const mx = dx + ux * t, my = dy + uy * t, mz = dz + uz * t;
        if (mx * mx + my * my + mz * mz > rcij * rcij && d2 > rcij * rcij) continue;
        const a = find(i), b = find(j);
        if (a !== b) grp[a] = b;
        any = true;
      }
    }
    if (!any) return [];
    const sets = new Map();
    for (let i = 0; i < n; i++) {
      if (i === s) continue;
      const r = find(i);
      if (!sets.has(r)) sets.set(r, []);
      sets.get(r).push(i);
    }
    return [...sets.values()].filter((g) => g.length > 1);
  }

  // Kepler motion for bodies in no encounter; the rest, group by group, with the near part of their pulls.
  drift(bs, h, groups, mu) {
    const n = bs.length, s = this.star, Q = this.Q, P = this.P;
    const inGroup = this.inGroup && this.inGroup.length >= n ? this.inGroup : (this.inGroup = new Uint8Array(n * 2));
    inGroup.fill(0, 0, n);
    for (const g of groups) for (const i of g) inGroup[i] = 1;
    for (let i = 0; i < n; i++) if (i !== s && !inGroup[i]) kepler(Q, P, 3 * i, mu, h);
    for (const g of groups) this.encounter(bs, g, h, mu);
  }

  // One encounter group over h: the star's pull (Kepler) and the near part of the members' pulls on each other,
  // by Dormand-Prince 5(4) with adaptive steps; notes pairs that touch.
  encounter(bs, g, h, mu) {
    const k = g.length, N = 6 * k, Q = this.Q, P = this.P, rc = this.rc;
    const y = new Float64Array(N), y5 = new Float64Array(N), tmp = new Float64Array(N), K = [];
    for (let s = 0; s < 7; s++) K.push(new Float64Array(N));
    for (let a = 0; a < k; a++) { const o = 3 * g[a]; for (let c = 0; c < 3; c++) { y[6 * a + c] = Q[o + c]; y[6 * a + 3 + c] = P[o + c]; } }
    const m = g.map((i) => bs[i].m), rad = g.map((i) => bs[i].r), rcs = g.map((i) => rc[i]);
    const touched = new Set();
    const f = (yy, out) => {
      for (let a = 0; a < k; a++) {
        const o = 6 * a, x = yy[o], yv = yy[o + 1], z = yy[o + 2], r2 = x * x + yv * yv + z * z, r = Math.sqrt(r2), k3 = -mu / (r2 * r);
        out[o] = yy[o + 3]; out[o + 1] = yy[o + 4]; out[o + 2] = yy[o + 5];
        out[o + 3] = k3 * x; out[o + 4] = k3 * yv; out[o + 5] = k3 * z;
      }
      for (let a = 0; a < k; a++) for (let b = a + 1; b < k; b++) {
        const oa = 6 * a, ob = 6 * b;
        const dx = yy[ob] - yy[oa], dy = yy[ob + 1] - yy[oa + 1], dz = yy[ob + 2] - yy[oa + 2];
        const d2 = dx * dx + dy * dy + dz * dz + 1e-300, d = Math.sqrt(d2), rr = rad[a] + rad[b];
        if (d < rr) touched.add(a * 1000 + b);
        const w = 1 - L(d, Math.max(rcs[a], rcs[b]));
        if (w <= 0) continue;
        const inv3 = (d >= rr ? 1 / (d2 * d) : 1 / (rr * rr * rr)) * G * w;
        out[oa + 3] += dx * m[b] * inv3; out[oa + 4] += dy * m[b] * inv3; out[oa + 5] += dz * m[b] * inv3;
        out[ob + 3] -= dx * m[a] * inv3; out[ob + 4] -= dy * m[a] * inv3; out[ob + 5] -= dz * m[a] * inv3;
      }
    };
    // tolerance: relative to the orbit's size and speed
    let rs = 0, vs = 0;
    for (let a = 0; a < k; a++) { rs = Math.max(rs, Math.hypot(y[6 * a], y[6 * a + 1], y[6 * a + 2])); vs = Math.max(vs, Math.hypot(y[6 * a + 3], y[6 * a + 4], y[6 * a + 5])); }
    const tol = 1e-12;
    let t = 0, dt = h / 8;
    for (let it = 0; it < 20000 && t < h; it++) {
      if (t + dt > h) dt = h - t;
      f(y, K[0]);
      for (let st = 1; st < 7; st++) {
        for (let q = 0; q < N; q++) { let sum = 0; const a = A[st]; for (let r = 0; r < a.length; r++) sum += a[r] * K[r][q]; tmp[q] = y[q] + dt * sum; }
        f(tmp, K[st]);
      }
      let err = 0;
      for (let q = 0; q < N; q++) {
        let s5 = 0, s4 = 0;
        for (let r = 0; r < 7; r++) { s5 += B5[r] * K[r][q]; s4 += B4[r] * K[r][q]; }
        y5[q] = y[q] + dt * s5;
        const sc = (q % 6) < 3 ? rs : vs;
        err = Math.max(err, Math.abs(dt * (s5 - s4)) / (sc || 1));
      }
      if (err <= tol || dt < h * 1e-9) {
        t += dt;
        y.set(y5);
      }
      dt *= Math.min(5, Math.max(0.2, 0.9 * Math.pow(tol / (err || 1e-30), 0.2)));
    }
    for (let a = 0; a < k; a++) { const o = 3 * g[a]; for (let c = 0; c < 3; c++) { Q[o + c] = y[6 * a + c]; P[o + c] = y[6 * a + 3 + c]; } }
    for (const key of touched) this.contacts.push([bs[g[Math.floor(key / 1000)]], bs[g[key % 1000]]]);
  }

  place(bs, cx, cy, cz, vx, vy, vz, M) {
    const n = bs.length, s = this.star, Q = this.Q, P = this.P, m0 = bs[s].m;
    let qx = 0, qy = 0, qz = 0, px = 0, py = 0, pz = 0;
    for (let i = 0; i < n; i++) {
      if (i === s) continue;
      const m = bs[i].m, o = 3 * i;
      qx += m * Q[o]; qy += m * Q[o + 1]; qz += m * Q[o + 2];
      px += m * P[o]; py += m * P[o + 1]; pz += m * P[o + 2];
    }
    const x0 = cx - qx / M, y0 = cy - qy / M, z0 = cz - qz / M, star = bs[s];
    star.x = x0; star.y = y0; star.z = z0;
    star.vx = vx - px / m0; star.vy = vy - py / m0; star.vz = vz - pz / m0;
    for (let i = 0; i < n; i++) {
      if (i === s) continue;
      const b = bs[i], o = 3 * i;
      b.x = Q[o] + x0; b.y = Q[o + 1] + y0; b.z = Q[o + 2] + z0;
      b.vx = P[o] + vx; b.vy = P[o + 1] + vy; b.vz = P[o + 2] + vz;
    }
  }

  jump(bs, h) {
    const n = bs.length, s = this.star, Q = this.Q, P = this.P, m0 = bs[s].m;
    let px = 0, py = 0, pz = 0;
    for (let i = 0; i < n; i++) { if (i === s) continue; const m = bs[i].m, o = 3 * i; px += m * P[o]; py += m * P[o + 1]; pz += m * P[o + 2]; }
    const k = h / m0;
    for (let i = 0; i < n; i++) { if (i === s) continue; const o = 3 * i; Q[o] += px * k; Q[o + 1] += py * k; Q[o + 2] += pz * k; }
  }

  // The far part of the bodies' pulls on each other (spheres: inverse square outside, as ias15.js), and the
  // star's 1PN correction (test-particle limit, as there), as a kick of length h.
  kick(bs, h) {
    const n = bs.length, s = this.star, Q = this.Q, P = this.P, Ac = this.Acc, rc = this.rc, star = bs[s];
    Ac.fill(0, 0, 3 * n);
    for (let i = 0; i < n; i++) {
      if (i === s) continue;
      const i3 = 3 * i, mi = bs[i].m, ri = bs[i].r, rci = rc[i];
      const xi = Q[i3], yi = Q[i3 + 1], zi = Q[i3 + 2];
      let ax = 0, ay = 0, az = 0;
      for (let j = i + 1; j < n; j++) {
        if (j === s) continue;
        const j3 = 3 * j, mj = bs[j].m;
        const dx = Q[j3] - xi, dy = Q[j3 + 1] - yi, dz = Q[j3 + 2] - zi;
        const d2 = dx * dx + dy * dy + dz * dz + 1e-300, d = Math.sqrt(d2), rr = ri + bs[j].r;
        const rcij = rci > rc[j] ? rci : rc[j];
        const w = d >= rcij ? 1 : L(d, rcij);
        if (w === 0) continue;
        const inv3 = (d >= rr ? 1 / (d2 * d) : 1 / (rr * rr * rr)) * w;
        const fi = G * mj * inv3, fj = G * mi * inv3;
        ax += dx * fi; ay += dy * fi; az += dz * fi;
        Ac[j3] -= dx * fj; Ac[j3 + 1] -= dy * fj; Ac[j3 + 2] -= dz * fj;
      }
      Ac[i3] += ax; Ac[i3 + 1] += ay; Ac[i3 + 2] += az;
    }
    const gr = star.kind === 'star' || star.kind === 'wd' || star.kind === 'ns' || star.kind === 'bh';
    const c2 = C_AU_YR * C_AU_YR, GM = G * star.m;
    let svx = 0, svy = 0, svz = 0;
    for (let i = 0; i < n; i++) { if (i === s) continue; const o = 3 * i, m = bs[i].m; svx -= m * P[o]; svy -= m * P[o + 1]; svz -= m * P[o + 2]; }
    svx /= star.m; svy /= star.m; svz /= star.m;
    for (let i = 0; i < n; i++) {
      if (i === s) continue;
      const o = 3 * i;
      let ax = Ac[o], ay = Ac[o + 1], az = Ac[o + 2];
      const rx = Q[o], ry = Q[o + 1], rz = Q[o + 2], r2 = rx * rx + ry * ry + rz * rz, r = Math.sqrt(r2);
      if (gr) {
        const vx = P[o] - svx, vy = P[o + 1] - svy, vz = P[o + 2] - svz;
        const v2 = vx * vx + vy * vy + vz * vz, rv = rx * vx + ry * vy + rz * vz;
        const k = GM / (c2 * r2 * r), Aa = (4 * GM) / r - v2;
        ax += k * (Aa * rx + 4 * rv * vx); ay += k * (Aa * ry + 4 * rv * vy); az += k * (Aa * rz + 4 * rv * vz);
      }
      P[o] += ax * h; P[o + 1] += ay * h; P[o + 2] += az * h;
      // (the acceleration others read, e.g. to put a moon in orbit: the star's pull plus the kicks)
      const b = bs[i], k3 = GM / (r2 * r);
      b.ax = ax - k3 * rx; b.ay = ay - k3 * ry; b.az = az - k3 * rz;
    }
  }
}
