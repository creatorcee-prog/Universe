// IAS15: a 15th-order adaptive Gauss-Radau integrator for the N-body problem.
// Rein, H. & Spiegel, D. S. (2015), "IAS15: a fast, adaptive, high-order integrator for gravitational
// dynamics, accurate to machine precision over a billion orbits", MNRAS 446, 1424. Based on Everhart (1985).
// It is the default integrator of the REBOUND N-body code.
//
// The acceleration over a step is a degree-7 polynomial in h = t/dt:
//   a(h) = a0 + b0 h + b1 h² + ... + b6 h⁷
// whose coefficients are found by predictor-corrector iteration at 7 Gauss-Radau nodes. The step size
// is chosen so the last coefficient, b6, stays below 1e-9 of the acceleration (error ~ dt^16).
// All coefficients are derived below from the Radau nodes rather than typed in.

import { G, C_AU_YR } from './units.js';

// ---------- constants derived at load time ----------

function legendre(n, x) {
  let p0 = 1, p1 = x;
  if (n === 0) return 1;
  for (let k = 2; k <= n; k++) { const p2 = ((2 * k - 1) * x * p1 - (k - 1) * p0) / k; p0 = p1; p1 = p2; }
  return p1;
}

// Gauss-Radau nodes on [0, 1] with the left end fixed: h0 = 0 plus the 7 roots of P7(t) + P8(t) in (-1, 1].
const H = (() => {
  const f = (t) => legendre(7, t) + legendre(8, t);
  const roots = [];
  const N = 20000;
  let ta = -1 + 1e-9, fa = f(ta);
  for (let i = 1; i <= N; i++) {
    const tb = -1 + (2 * i) / N, fb = f(tb);
    if (fa === 0 || fa * fb < 0) {
      let lo = ta, hi = tb;
      for (let k = 0; k < 200; k++) { const mid = 0.5 * (lo + hi); if (f(lo) * f(mid) <= 0) hi = mid; else lo = mid; }
      roots.push(0.5 * (lo + hi));
    }
    ta = tb; fa = fb;
  }
  return [0, ...roots.filter((t) => t > -1 + 1e-6).map((t) => (t + 1) / 2)];
})();

// C[k][m]: coefficient of h^(m+1) in h·(h-h1)(h-h2)...(h-hk), linking the divided differences g to b.
const C = (() => {
  const out = [];
  let poly = [1]; // coefficients of (h-h1)...(h-hk), lowest power first
  for (let k = 0; k < 7; k++) {
    if (k > 0) {
      const next = new Array(poly.length + 1).fill(0);
      for (let i = 0; i < poly.length; i++) { next[i + 1] += poly[i]; next[i] -= poly[i] * H[k]; }
      poly = next;
    }
    out.push(poly.slice());
  }
  return out; // out[k][m], m = 0..k
})();

const BINOM = (n, k) => { let r = 1; for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i; return r; };
// BIN[k][m] = C(k+1, m+1), used to re-expand the polynomial for the next step.
const BIN = Array.from({ length: 7 }, (_, k) => Array.from({ length: 7 }, (_, m) => (m <= k ? BINOM(k + 1, m + 1) : 0)));

const EPS = 1e-9;      // accuracy parameter (REBOUND default)
const SAFETY = 0.25;   // reject a step if the next one must shrink by more than this; grow at most 4x

export const IAS15_NODES = H;

// ---------- forces ----------

// Newtonian gravity between spheres (exact inverse-square outside them), Plummer softening for galaxy
// cores, plus the first post-Newtonian (general relativity) correction from massive, compact or stellar
// bodies in the test-particle limit:
//   a = GM/(c² r³) [ (4GM/r − v²) r + 4 (r·v) v ]
// which gives Mercury's extra 43"/century perihelion advance (as used in e.g. REBOUNDx "gr").
let GRF = null, CPT = null, MS = null, RS = null, SS = null;   // per-body flags; mass, radius, softening²
export function accelerations(bs, x, v, a, grOn = true) {
  const n = bs.length;
  a.fill(0, 0, 3 * n);
  let minT2 = Infinity;
  const c2 = C_AU_YR * C_AU_YR;
  if (!GRF || GRF.length < n) GRF = new Uint8Array(Math.max(64, n * 2));
  if (!CPT || CPT.length < n) CPT = new Uint8Array(Math.max(64, n * 2));
  if (!MS || MS.length < n) { const k = Math.max(64, n * 2); MS = new Float64Array(k); RS = new Float64Array(k); SS = new Float64Array(k); }
  // Flat copies of what the pair loop reads (object property reads there cost more than the arithmetic,
  // above all in Safari's JavaScriptCore).
  for (let i = 0; i < n; i++) {
    const b = bs[i], k = b.kind;
    GRF[i] = grOn && (k === 'star' || k === 'wd' || k === 'ns' || k === 'bh') ? 1 : 0; CPT[i] = grOn && (k === 'ns' || k === 'bh') ? 1 : 0;
    MS[i] = b.m; RS[i] = b.r; SS[i] = b.soft * b.soft;
  }
  for (let i = 0; i < n; i++) {
    const i3 = 3 * i;
    const xi = x[i3], yi = x[i3 + 1], zi = x[i3 + 2];
    const mi = MS[i], si2 = SS[i], ri = RS[i], Gmi = G * mi;
    let ax = 0, ay = 0, az = 0;
    for (let j = i + 1; j < n; j++) {
      const j3 = 3 * j, mj = MS[j];
      const dx = x[j3] - xi, dy = x[j3 + 1] - yi, dz = x[j3 + 2] - zi;
      const rr = ri + RS[j];
      const d2 = dx * dx + dy * dy + dz * dz + si2 + SS[j] + 1e-300;
      const d = Math.sqrt(d2);
      const inv3 = d >= rr ? 1 / (d2 * d) : 1 / (rr * rr * rr);
      const fi = G * mj * inv3, fj = Gmi * inv3;
      ax += dx * fi; ay += dy * fi; az += dz * fi;
      a[j3] -= dx * fj; a[j3 + 1] -= dy * fj; a[j3 + 2] -= dz * fj;
      // Shortest pairwise timescale² r³/G(m1+m2), compared without dividing (a division per pair adds up).
      const d3 = d2 * d, gm = Gmi + G * mj;
      if (d3 < minT2 * gm) minT2 = d3 / (gm || 1e-300);
      // 1PN correction around the heavier of the pair when it is a star or compact object.
      if ((GRF[i] || GRF[j]) && d >= rr && si2 === 0 && SS[j] === 0) {
        const heavyI = mi >= mj;
        const M = heavyI ? mi : mj, mt = heavyI ? mj : mi;
        // r and v of the light body relative to the heavy one
        const s = heavyI ? 1 : -1;
        const rx = dx * s, ry = dy * s, rz = dz * s;
        const vx = (v[j3] - v[i3]) * s, vy = (v[j3 + 1] - v[i3 + 1]) * s, vz = (v[j3 + 2] - v[i3 + 2]) * s;
        const GM = G * M, v2 = vx * vx + vy * vy + vz * vz, rv = rx * vx + ry * vy + rz * vz;
        const k = GM / (c2 * d2 * d), A = 4 * GM / d - v2;
        let gx = k * (A * rx + 4 * rv * vx), gy = k * (A * ry + 4 * rv * vy), gz = k * (A * rz + 4 * rv * vz);
        // Gravitational-wave radiation reaction (2.5PN) between two black holes or neutron stars, in the
        // relative motion (Kidder 1995, eq. 2.2c, harmonic gauge):
        //   a = (8/5) η (GM)²/(c⁵ r³) [ (18v² + (2/3)GM/r − 25ṙ²) ṙ n − (6v² − 2GM/r − 15ṙ²) v ]
        // with M the total mass and η = m₁m₂/M². It drains orbital energy at the rate in Peters (1964), so
        // close binaries spiral together and merge.
        if (CPT[i] && CPT[j]) {
          const Mt = mi + mj, eta = (mi * mj) / (Mt * Mt), GMt = G * Mt;
          const rdot = rv / d, u = GMt / d;
          const kr = (1.6 * eta * GMt * GMt) / (c2 * c2 * C_AU_YR * d2 * d);
          const cn = (18 * v2 + (2 / 3) * u - 25 * rdot * rdot) * rdot / d, cv = -(6 * v2 - 2 * u - 15 * rdot * rdot);
          gx += kr * (cn * rx + cv * vx); gy += kr * (cn * ry + cv * vy); gz += kr * (cn * rz + cv * vz);
        }
        // light body gets the full correction; the heavy one the equal-and-opposite share (momentum conserved)
        const fL = M / (M + mt), fH = mt / (M + mt);
        const L3 = heavyI ? j3 : i3, H3 = heavyI ? i3 : j3;
        if (heavyI) {
          a[L3] += gx * fL; a[L3 + 1] += gy * fL; a[L3 + 2] += gz * fL;
          ax -= gx * fH; ay -= gy * fH; az -= gz * fH;
        } else {
          ax += gx * fL; ay += gy * fL; az += gz * fL;
          a[H3] -= gx * fH; a[H3 + 1] -= gy * fH; a[H3 + 2] -= gz * fH;
        }
      }
    }
    a[i3] += ax; a[i3 + 1] += ay; a[i3 + 2] += az;
  }
  return minT2;
}

// ---------- integrator ----------

export class IAS15 {
  constructor() {
    this.n = -1;
    this.dt = 0;        // suggested next step (0 = unknown)
    this.gr = true;
  }

  reset() { this.n = -1; }

  alloc(n) {
    const D = 3 * n;
    const mk = () => Array.from({ length: 7 }, () => new Float64Array(D));
    this.D = D; this.n = n;
    this.x0 = new Float64Array(D); this.v0 = new Float64Array(D); this.a0 = new Float64Array(D);
    this.x = new Float64Array(D); this.v = new Float64Array(D); this.at = new Float64Array(D);
    this.b = mk(); this.g = mk(); this.e = mk(); this.bOld = mk();
    // positions at the substep nodes of the last accepted step, for dense output
    this.sub = Array.from({ length: 8 }, () => new Float64Array(D));
  }

  // Advance the bodies by up to dtTry (never more). Returns the step taken.
  step(bs, dtTry) {
    const n = bs.length;
    if (n !== this.n) { this.alloc(n); this.dt = 0; }
    const D = this.D, x0 = this.x0, v0 = this.v0, a0 = this.a0, x = this.x, v = this.v, at = this.at;
    const b = this.b, g = this.g, e = this.e;
    for (let i = 0; i < n; i++) {
      const o = 3 * i, p = bs[i];
      x0[o] = p.x; x0[o + 1] = p.y; x0[o + 2] = p.z;
      v0[o] = p.vx; v0[o + 1] = p.vy; v0[o + 2] = p.vz;
    }
    this.minT2 = accelerations(bs, x0, v0, a0, this.gr);
    let dt = dtTry;
    for (let attempt = 0; attempt < 20; attempt++) {
      // Predictor: divided differences from the predicted b.
      for (let k = 0; k < 7; k++) this.bOld[k].set(b[k]);
      for (let i = 0; i < D; i++) {
        for (let m = 6; m >= 0; m--) {
          let s = b[m][i];
          for (let k = m + 1; k < 7; k++) s -= C[k][m] * g[k][i];
          g[m][i] = s; // C[m][m] = 1
        }
      }
      let prevErr = Infinity;
      for (let it = 0; it < 12; it++) {
        let maxDb6 = 0, maxAt = 0;
        for (let nn = 1; nn <= 7; nn++) {
          const h = H[nn];
          for (let i = 0; i < D; i++) {
            const b0 = b[0][i], b1 = b[1][i], b2 = b[2][i], b3 = b[3][i], b4 = b[4][i], b5 = b[5][i], b6 = b[6][i];
            const hdt = h * dt;
            x[i] = x0[i] + hdt * (v0[i] + hdt * (a0[i] / 2 + h * (b0 / 6 + h * (b1 / 12 + h * (b2 / 20 + h * (b3 / 30 + h * (b4 / 42 + h * (b5 / 56 + h * b6 / 72))))))));
            v[i] = v0[i] + hdt * (a0[i] + h * (b0 / 2 + h * (b1 / 3 + h * (b2 / 4 + h * (b3 / 5 + h * (b4 / 6 + h * (b5 / 7 + h * b6 / 8)))))));
          }
          accelerations(bs, x, v, at, this.gr);
          this.sub[nn - 1].set(x);
          const gk = g[nn - 1], Ck = C[nn - 1];
          for (let i = 0; i < D; i++) {
            let tmp = (at[i] - a0[i]) / h;
            for (let k = 0; k < nn - 1; k++) tmp = (tmp - g[k][i]) / (h - H[k + 1]);
            const delta = tmp - gk[i];
            gk[i] = tmp;
            for (let m = 0; m < nn; m++) b[m][i] += Ck[m] * delta;
            if (nn === 7) {
              const ad = Math.abs(Ck[6] * delta);
              if (ad > maxDb6) maxDb6 = ad;
              const aa = Math.abs(at[i]);
              if (aa > maxAt) maxAt = aa;
            }
          }
        }
        const err = maxAt > 0 ? maxDb6 / maxAt : 0;
        if (err < 1e-16 || (it > 1 && err >= prevErr)) break;
        prevErr = err;
      }
      // Step-size control from the size of the last term.
      // Step size from each body's own timescale (Pham, Rein & Spiegel 2024, "Solving the IAS15 timestep
      // criterion", REBOUND's default): with acceleration a, jerk and snap at the end of the step,
      //   τ² = 2|a|² / (|ȧ|² + √(|ä|²|a|²)),  dt_new = τ · dt · (5040 ε)^(1/7).
      // Unlike the original |b6|/|a| ratio it is not fooled by round-off in tiny accelerations.
      let minTs2 = Infinity;
      for (let p = 0; p < n; p++) {
        let y2 = 0, y3 = 0, y4 = 0;
        for (let c = 0; c < 3; c++) {
          const i = 3 * p + c;
          const b0 = b[0][i], b1 = b[1][i], b2 = b[2][i], b3 = b[3][i], b4 = b[4][i], b5 = b[5][i], b6 = b[6][i];
          const aEnd = a0[i] + b0 + b1 + b2 + b3 + b4 + b5 + b6;
          const jerk = b0 + 2 * b1 + 3 * b2 + 4 * b3 + 5 * b4 + 6 * b5 + 7 * b6;
          const snap = 2 * b1 + 6 * b2 + 12 * b3 + 20 * b4 + 30 * b5 + 42 * b6;
          y2 += aEnd * aEnd; y3 += jerk * jerk; y4 += snap * snap;
        }
        if (!(y2 > 0) || !isFinite(y2)) continue;
        const ts2 = (2 * y2) / (y3 + Math.sqrt(y4 * y2));
        if (ts2 < minTs2) minTs2 = ts2;
      }
      let dtNew = isFinite(minTs2) && minTs2 > 0 ? Math.sqrt(minTs2) * dt * Math.pow(EPS * 5040, 1 / 7) : dt / SAFETY;
      if (!(dtNew > 0) || !isFinite(dtNew)) dtNew = dt * SAFETY;
      if (dtNew < dt * SAFETY && attempt < 19) {
        // Reject: shrink and retry from the same start, rescaling the polynomial guess.
        const q = dtNew / dt;
        for (let k = 0; k < 7; k++) { const s = Math.pow(q, k + 1); for (let i = 0; i < D; i++) { b[k][i] *= s; e[k][i] = b[k][i]; } }
        dt = dtNew;
        continue;
      }
      if (dtNew > dt / SAFETY) dtNew = dt / SAFETY;
      // Accept: positions and velocities at the end of the step.
      for (let i = 0; i < D; i++) {
        const b0 = b[0][i], b1 = b[1][i], b2 = b[2][i], b3 = b[3][i], b4 = b[4][i], b5 = b[5][i], b6 = b[6][i];
        x[i] = x0[i] + dt * v0[i] + dt * dt * (a0[i] / 2 + b0 / 6 + b1 / 12 + b2 / 20 + b3 / 30 + b4 / 42 + b5 / 56 + b6 / 72);
        v[i] = v0[i] + dt * (a0[i] + b0 / 2 + b1 / 3 + b2 / 4 + b3 / 5 + b4 / 6 + b5 / 7 + b6 / 8);
      }
      this.sub[7].set(x);
      for (let i = 0; i < n; i++) {
        const o = 3 * i, p = bs[i];
        p.x = x[o]; p.y = x[o + 1]; p.z = x[o + 2];
        p.vx = v[o]; p.vy = v[o + 1]; p.vz = v[o + 2];
      }
      // Predict the next step's polynomial: re-expand a(1 + q h') and keep last step's correction.
      const q = dtNew / dt;
      const qp = [q, q * q, q ** 3, q ** 4, q ** 5, q ** 6, q ** 7];
      const br = new Float64Array(7);
      for (let i = 0; i < D; i++) {
        for (let k = 0; k < 7; k++) br[k] = b[k][i] - e[k][i];
        for (let m = 0; m < 7; m++) {
          let s = 0;
          for (let k = m; k < 7; k++) s += b[k][i] * BIN[k][m];
          e[m][i] = s * qp[m];
        }
        for (let k = 0; k < 7; k++) b[k][i] = e[k][i] + br[k];
      }
      this.dt = dtNew;
      return dt;
    }
    return 0;
  }

  // Forget the acceleration history (after a merger, a mass change or a new body).
  invalidate() {
    if (this.n < 0) return;
    for (let k = 0; k < 7; k++) { this.b[k].fill(0); this.e[k].fill(0); this.g[k].fill(0); }
  }
}
