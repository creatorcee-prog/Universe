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
  return {
    kind, P, T, H, HM, g, mu, tauM, tauS, tauE, day,
    // per planet radius (shader units)
    betaR: betaR.map((v) => v * R), betaM: betaM.map((v) => v * R), betaA: betaA.map((v) => v * R),
    betaMa: betaMa.map((v) => v * R), hR: H / R, hM: HM / R, mieG: gM,
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
}

// Outer edge of the drawn atmosphere, in planet radii: eight scale heights of whichever layer is taller.
export function atmosphereTop(o) {
  return 1 + Math.max(0.004, Math.min(0.25, 8 * Math.max(o.hR, o.hM)));
}
