// Atmospheric optics from composition: what colour a sky is follows from what is in the air.
//
// Rayleigh scattering by molecules: per molecule, σ ∝ (n−1)² F_K / λ⁴, so with Earth air as the reference
//   β_R(λ) = β_R,air(λ) · Σ x_i (n_i−1)² F_i / [(n_air−1)² F_air] · N / N_air
// with refractivities (n−1) at STP and King factors F (depolarisation): N₂ 2.98e-4, 1.034;
// O₂ 2.71e-4, 1.096; CO₂ 4.49e-4, 1.15; CH₄ 4.41e-4, 1.0; H₂ 1.39e-4, 1.0; H₂O 2.56e-4, 1.0
// (Bucholtz 1995; Sneep & Ubachs 2005). Earth's sea-level β_R = (5.8, 13.5, 33.1)e-6 per metre at
// 680/550/440 nm (Bruneton & Neyret 2008). CO₂ scatters ~2.3x more per molecule than air.
//
// Absorption: ozone (Chappuis band, oxygen worlds), methane (absorbs red: why Uranus and Neptune look
// blue-green), and aerosol absorption below.
//
// Aerosols (Mie scattering), chosen by what the planet is like:
//   water haze on wet worlds (Earth, g ≈ 0.76, white);
//   dust on dry, thin-aired rocky worlds (Mars: τ ≈ 0.5, absorbs blue → butterscotch sky; scatters blue
//     more strongly forward → blue sunsets, Ehlers et al. 2014, Applied Optics 53, 2001);
//   organic haze where methane is photolysed (Titan's tholins: orange, absorbs blue);
//   sulphuric-acid clouds under very thick CO₂ (Venus: τ ≈ 30, yellowish).
// All coefficients are returned per planet radius so the shader can work in planet units.

const AIR_BR = [5.8e-6, 13.5e-6, 33.1e-6];
const AIR_K = 2.93e-4 * 2.93e-4 * 1.049;
const GAS = {
  n2: { n: 2.98e-4, F: 1.034 }, o2: { n: 2.71e-4, F: 1.096 }, co2: { n: 4.49e-4, F: 1.15 },
  ch4: { n: 4.41e-4, F: 1.0 }, h2: { n: 1.39e-4, F: 1.0 }, h2o: { n: 2.56e-4, F: 1.0 },
};
const OZONE = [0.65e-6, 1.881e-6, 0.085e-6];      // Earth's column-equivalent, per metre at sea level
const CH4_ABS = [3.0e-6, 0.35e-6, 0.03e-6];        // per metre at Earth density for pure methane (red-heavy)
const MU = { n2: 28, o2: 32, co2: 44, ch4: 16, h2: 2, h2o: 18 };

export function atmosphereOptics(b) {
  const th = b.th, atm = b.atm;
  if (!th || !atm || b.kind !== 'rocky') return null;
  const gases = { ...atm.gases };
  if (th.steam > 0) gases.h2o = (gases.h2o || 0) + th.steam;
  const P = Object.values(gases).reduce((s, v) => s + v, 0); // bar
  if (!(P > 1e-5)) return null;
  const T = Math.max(40, th.Ts);
  const AU_M = 1.495978707e11, MSUN = 1.98847e30;
  const R = b.r * AU_M, g = (6.674e-11 * b.m * MSUN) / (R * R);
  let mu = 0, kmix = 0;
  for (const [k, p] of Object.entries(gases)) {
    const f = p / P, G = GAS[k] || GAS.n2;
    mu += f * (MU[k] || 28);
    kmix += f * G.n * G.n * G.F;
  }
  const H = (8.314 * T) / ((mu / 1000) * g);               // scale height (m)
  // A scale height that is a sizeable fraction of the radius means the gas is not bound (it escapes as
  // fast as it is made): small moons like Phobos have no atmosphere to draw.
  if (H > 0.2 * R) return null;
  const dens = (P / 1.01325) * (288 / T);                 // number density relative to Earth sea level
  const betaR = AIR_BR.map((v) => v * (kmix / AIR_K) * dens);
  const betaA = [0, 0, 0];
  const o2 = (gases.o2 || 0) / P;
  if (o2 > 0.02) for (let i = 0; i < 3; i++) betaA[i] += OZONE[i] * (o2 / 0.21) * Math.min(1, dens) * 1.2;
  const ch4 = (gases.ch4 || 0) / P;
  if (ch4 > 0) for (let i = 0; i < 3; i++) betaA[i] += CH4_ABS[i] * ch4 * dens;
  // Aerosols. tauM = vertical optical depth; HM = aerosol scale height (m).
  let tauM = 0, HM = 1200, alb = [0.9, 0.9, 0.9], gM = [0.76, 0.76, 0.76], kind = 'none';
  const wet = th.liquid > 0.01 || th.steam > 0.01;
  if (P > 10 && (gases.co2 || 0) / P > 0.5) { kind = 'sulphuric'; tauM = 30; HM = H * 1.5; alb = [0.9995, 0.998, 0.985]; gM = [0.82, 0.83, 0.85]; }
  else if (ch4 > 0.01 && P > 0.1) { kind = 'tholin'; tauM = 2.5 + 2.5 * Math.min(1, ch4 / 0.05); HM = H * 1.6; alb = [0.96, 0.87, 0.68]; gM = [0.62, 0.62, 0.62]; }
  else if (wet) { kind = 'water'; tauM = 0.1 * Math.min(3, Math.sqrt(P)); HM = 1200; alb = [0.92, 0.92, 0.92]; gM = [0.76, 0.76, 0.76]; }
  else if (P < 1) { kind = 'dust'; tauM = 0.5 * Math.min(1, P / 0.006); HM = H; alb = [0.98, 0.91, 0.76]; gM = [0.65, 0.72, 0.84]; }
  const betaM = alb.map((a) => (tauM / HM) * a);              // aerosol scattering
  const betaMa = alb.map((a) => (tauM / HM) * (1 - a));       // aerosol absorption
  // Vertical column optical depths: scattering, total extinction.
  const tauS = [0, 1, 2].map((i) => betaR[i] * H + betaM[i] * HM);
  const tauE = [0, 1, 2].map((i) => tauS[i] + betaA[i] * H + betaMa[i] * HM);
  // Daylight reaching the ground with the star overhead (direct + diffuse, two-stream estimate), used to
  // set the eye's exposure: under Venus's clouds it is ~2% of the sunlight at the top.
  let day = 0;
  for (let i = 0; i < 3; i++) {
    const w = tauS[i] / Math.max(tauE[i], 1e-12), gE = (betaM[i] * HM * gM[i]) / Math.max(tauS[i], 1e-12);
    const k = Math.sqrt(3 * (1 - w) * (1 - w * gE));
    day += (Math.exp(-tauE[i]) + (1 - Math.exp(-tauS[i])) * Math.exp(-k * tauE[i]) / (1 + 0.75 * (1 - gE) * tauS[i])) / 3;
  }
  // Titan's detached haze layer: ~500 km up, ~40 km thick, faintly blue (Porco et al. 2005, Nature 434, 159;
  // West et al. 2011). Its tangent optical depth is set to ~0.3, so it shows at the limb as in Cassini images.
  let det = [0, 0, 0, 0];
  if (kind === 'tholin') {
    const hD = 500e3 / R, wD = 40e3 / R, path = 1.81 * Math.sqrt(2 * (1 + hD) * wD);   // grazing path through it
    det = [hD, wD, 0.3 / Math.max(path, 1e-9), 1];
  }
  return {
    kind, P, T, H, HM, g, mu, tauM, tauS, tauE, day, det,
    // per planet radius (shader units)
    betaR: betaR.map((v) => v * R), betaM: betaM.map((v) => v * R), betaA: betaA.map((v) => v * R),
    betaMa: betaMa.map((v) => v * R), hR: H / R, hM: HM / R, mieG: gM,
  };
}

// Giant planets: the air above the cloud tops (taken as the ~1 bar level, the "ground" the scattering sees),
// hydrogen and helium (86:14 by number; He refractivity 3.5e-5) with a little methane, and an upper haze of
// photochemical aerosols (Jupiter and Saturn: thick, absorbing blue, why Saturn looks muted and yellow; Uranus
// and Neptune: thin, white). Cloud-top temperatures and methane from Voyager, Galileo and Cassini (Jupiter
// 165 K, 0.2%; Saturn 135 K, 0.45%; Uranus 76 K, 2.3%; Neptune 72 K, 1.5%). The methane absorption the
// planets' colours already include is applied only partly (it reddens nothing twice; it still blues the limb).
const GIANTS = {
  Jupiter: { T: 165, ch4: 0.0021, tau: 1.0, alb: [0.97, 0.9, 0.76], g: 0.65 },
  Saturn: { T: 135, ch4: 0.0045, tau: 2.0, alb: [0.98, 0.94, 0.82], g: 0.65 },
  Uranus: { T: 76, ch4: 0.023, tau: 0.3, alb: [0.97, 0.98, 0.99], g: 0.7 },
  Neptune: { T: 72, ch4: 0.015, tau: 0.2, alb: [0.97, 0.98, 0.99], g: 0.7 },
};
export function giantOptics(b) {
  if (b.kind !== 'gas') return null;
  const AU_M = 1.495978707e11, MSUN = 1.98847e30, ME = 3.003e-6;
  const name = b.name.replace(/ \d+$/, '');
  const p = GIANTS[name] || (b.m / ME < 50 ? { ...GIANTS.Neptune, T: Math.max(60, (b.th && b.th.Ts) || 72) } : { ...GIANTS.Jupiter, T: Math.max(100, (b.th && b.th.Ts) || 165) });
  const R = b.r * AU_M, g = (6.674e-11 * b.m * MSUN) / (R * R), T = p.T, mu = 2.3;
  const H = (8.314 * T) / ((mu / 1000) * g);
  const dens = (1 / 1.01325) * (288 / T);
  const kmix = 0.86 * GAS.h2.n * GAS.h2.n * GAS.h2.F + 0.14 * 3.5e-5 * 3.5e-5 + p.ch4 * GAS.ch4.n * GAS.ch4.n;
  const betaR = AIR_BR.map((v) => v * (kmix / AIR_K) * dens);
  const betaA = CH4_ABS.map((v) => v * p.ch4 * dens * 0.3);
  const HM = H, betaM = p.alb.map((a) => (p.tau / HM) * a), betaMa = p.alb.map((a) => (p.tau / HM) * (1 - a));
  const tauS = [0, 1, 2].map((i) => betaR[i] * H + betaM[i] * HM);
  const tauE = [0, 1, 2].map((i) => tauS[i] + betaA[i] * H + betaMa[i] * HM);
  return {
    kind: 'giant', P: 1, T, H, HM, g, mu, tauM: p.tau, tauS, tauE, day: 1, det: [0, 0, 0, 0],
    betaR: betaR.map((v) => v * R), betaM: betaM.map((v) => v * R), betaA: betaA.map((v) => v * R),
    betaMa: betaMa.map((v) => v * R), hR: H / R, hM: HM / R, mieG: [p.g, p.g, p.g],
  };
}

// Uniforms shared by the surface sky and the atmosphere shell (see SCATTER in shaders.js).
export function setOpticsUniforms(gl, u, o, steps = 16) {
  gl.uniform3fv(u.uBR, o.betaR); gl.uniform3fv(u.uBM, o.betaM);
  gl.uniform3fv(u.uBA, o.betaA); gl.uniform3fv(u.uBMa, o.betaMa);
  gl.uniform1f(u.uHR, o.hR); gl.uniform1f(u.uHM, o.hM);
  gl.uniform3fv(u.uG, o.mieG); gl.uniform3fv(u.uTauS, o.tauS);
  gl.uniform1f(u.uTop, atmosphereTop(o));
  gl.uniform1i(u.uSteps, steps);
  gl.uniform4fv(u.uDet, o.det || [0, 0, 0, 0]);
}

// The same atmosphere stretched k times taller with its haze spread thinner (same column optical depth, so
// the same colours), so one too thin to see from far away still shows as a rim a couple of pixels wide.
export function stretchOptics(o, k) {
  if (!(k > 1)) return o;
  const d = (v) => v.map((x) => x / k);
  return { ...o, hR: o.hR * k, hM: o.hM * k, betaR: d(o.betaR), betaM: d(o.betaM), betaA: d(o.betaA), betaMa: d(o.betaMa),
    det: o.det && o.det[3] ? [o.det[0] * k, o.det[1] * k, o.det[2] / k, 1] : o.det };
}

// Outer edge of the drawn atmosphere, in planet radii: eight scale heights of whichever layer is taller.
export function atmosphereTop(o) {
  return 1 + Math.max(0.004, Math.min(0.25, Math.max(8 * Math.max(o.hR, o.hM), o.det && o.det[3] ? o.det[0] + 3 * o.det[1] : 0)));
}

// ---------- the same scattering on the CPU (a few rays), for lighting the Surface-view ground ----------
// Mirrors SCATTER in shaders.js. Units: planet radii; sunlight irradiance 1.
const chapUp = (x, mu) => { const c = Math.sqrt(1.5708 * x); return c / ((c - 1) * mu + 1); };
const chap = (X, x, mu) => {
  const h = x - X;
  if (mu >= 0) return chapUp(x, mu) * Math.exp(-h);
  const x0 = Math.sqrt(Math.max(0, 1 - mu * mu)) * x;
  return 2 * Math.sqrt(1.5708 * x0) * Math.exp(X - x0) - chapUp(x, -mu) * Math.exp(-h);
};
export function tauToSun(o, r, mu) {
  if (mu < 0 && r * Math.sqrt(Math.max(0, 1 - mu * mu)) < 1) return [1e4, 1e4, 1e4];
  const cR = o.hR * chap(1 / o.hR, r / o.hR, mu), cM = o.hM * chap(1 / o.hM, r / o.hM, mu);
  return [0, 1, 2].map((i) => (o.betaR[i] + o.betaA[i]) * cR + (o.betaM[i] + o.betaMa[i]) * cM);
}
function scatterRay(o, oo, d, tMax, sun, bias) {
  const N = 24, c = d[0] * sun[0] + d[1] * sun[1] + d[2] * sun[2];
  const pR = 0.0596831 * (1 + c * c);
  const pM = o.mieG.map((g) => (0.1193662 * (1 - g * g) * (1 + c * c)) / ((2 + g * g) * Math.pow(Math.max(1e-4, 1 + g * g - 2 * g * c), 1.5)));
  const L = [0, 0, 0], tau = [0, 0, 0];
  let tPrev = 0;
  for (let i = 0; i < N; i++) {
    const s = (i + 1) / N, t1 = tMax * Math.pow(s, bias), dt = t1 - tPrev, tm = tPrev + 0.5 * dt;
    tPrev = t1;
    const p = [0, 1, 2].map((k) => oo[k] + d[k] * tm), r = Math.hypot(p[0], p[1], p[2]), h = Math.max(r - 1, 0);
    const rR = Math.exp(-h / o.hR), rM = Math.exp(-h / o.hM);
    const mu0 = (p[0] * sun[0] + p[1] * sun[1] + p[2] * sun[2]) / r;
    const Ts = tauToSun(o, r, mu0).map((v) => Math.exp(-v));
    const twi = Math.max(mu0 + 0.08, 0) / 1.08;
    for (let k = 0; k < 3; k++) {
      const sR = o.betaR[k] * rR, sM = o.betaM[k] * rM, ext = sR + sM + o.betaA[k] * rR + o.betaMa[k] * rM;
      const tS = o.betaR[k] * o.hR * rR + o.betaM[k] * o.hM * rM, tE = tS + o.betaA[k] * o.hR * rR + o.betaMa[k] * o.hM * rM;
      const w = Math.min(1, tS / Math.max(tE, 1e-9)), gE = Math.min(0.99, (o.betaM[k] * o.hM * rM * o.mieG[k]) / Math.max(tS, 1e-9));
      const kk = Math.sqrt(Math.max(3 * (1 - w) * (1 - w * gE), 0)), Td = Math.exp(-kk * tE) / (1 + 0.75 * (1 - gE) * tS);
      const sa = Math.sqrt(Math.max(1 - w, 0) / Math.max(1 - w * gE, 1e-4));
      const ms = (sR + sM) * (1 - Math.exp(-o.tauS[k])) * Td * ((1 - sa) / (1 + sa)) * twi * (0.5 / Math.PI);
      const S = sR * pR * Ts[k] + sM * pM[k] * Ts[k] + ms;
      L[k] += (Math.exp(-tau[k]) * S * (1 - Math.exp(-ext * dt))) / Math.max(ext, 1e-9);
      tau[k] += ext * dt;
    }
  }
  return L;
}

// Colours the ground needs, in the same exposure as the sky shader: the sky at the horizon toward and away
// from the sun, at the zenith, sunlight reaching the ground (transmittance), and the diffuse sky light.
// sunUp: sine of the sun's elevation. expo: the sky's exposure.
export function groundLight(o, sunUp, expo) {
  const top = atmosphereTop(o), oo = [0, 1.00002, 0];
  const se = Math.max(-1, Math.min(1, sunUp)), sun = [Math.sqrt(1 - se * se), se, 0];
  const ray = (el, azDeg) => {
    const e = (el * Math.PI) / 180, a = (azDeg * Math.PI) / 180;
    const d = [Math.cos(e) * Math.cos(a), Math.sin(e), Math.cos(e) * Math.sin(a)];
    const b = oo[0] * d[0] + oo[1] * d[1] + oo[2] * d[2], c = 1.00002 ** 2 - top * top;
    return scatterRay(o, oo, d, -b + Math.sqrt(b * b - c), sun, 2.2);
  };
  // (As the sky shader's skyTone, without its highlight excess: the horizon's colour for the haze.)
  const ex = (L) => { const x = L.map((v) => v * expo), m = Math.max(x[0], x[1], x[2], 1e-9), k = (1 - Math.exp(-m)) / m; return x.map((v) => v * k); };
  const horSun = ex(ray(2, 0)), horAnti = ex(ray(2, 180)), zen = ex(ray(90, 0));
  // Diffuse light on a horizontal surface: average of the sky over the hemisphere (a few directions),
  // in units where full sunlight is 1.
  let amb = [0, 0, 0];
  const dirs = [[90, 0], [45, 0], [45, 90], [45, 180], [45, 270], [15, 0], [15, 120], [15, 240]];
  for (const [el, az] of dirs) { const L = ray(el, az), w = Math.sin((el * Math.PI) / 180); for (let k = 0; k < 3; k++) amb[k] += L[k] * w; }
  amb = amb.map((v) => (v / dirs.length) * Math.PI * 2);
  const T = tauToSun(o, 1.00002, se).map((v) => Math.exp(-v));
  return { horSun, horAnti, zen, sunT: T, amb };
}
