// Simulation units: distance in AU, mass in solar masses, time in years.
// With these units G = 4π² exactly (Kepler's third law: P² = a³ for 1 M☉).
export const G = 4 * Math.PI * Math.PI;
export const AU_KM = 1.495978707e8;
export const LY_AU = 63241.077;
export const KPC_AU = 2.0626e8;
export const C_AU_YR = 63241.077; // speed of light in AU/yr (1 ly per yr)
export const EARTH_MASS = 3.0035e-6; // in M☉
export const JUPITER_MASS = 9.5458e-4;
export const MOON_MASS = 3.694e-8;
export const SUN_RADIUS = 6.957e5 / AU_KM;
export const EARTH_RADIUS = 6371 / AU_KM;
export const YEAR_S = 3.15576e7;
export const DAY_YR = 1 / 365.25;
export const KM_S_TO_AU_YR = YEAR_S / AU_KM; // multiply km/s by this

export const km = (v) => v / AU_KM;
export const kms = (v) => v * KM_S_TO_AU_YR;

function fmt(v, digits = 3) {
  if (!isFinite(v)) return '∞';
  const a = Math.abs(v);
  if (a !== 0 && (a < 1e-3 || a >= 1e6)) return v.toExponential(2).replace('e+', 'e');
  return Number(v.toPrecision(digits)).toLocaleString('en-US', { maximumFractionDigits: 3 });
}

export function formatDistance(au) {
  const a = Math.abs(au);
  if (a < 0.01) return fmt(au * AU_KM) + ' km';
  if (a < 5000) return fmt(au) + ' AU';
  const ly = au / LY_AU;
  if (ly < 1e5) return fmt(ly) + ' ly';
  return fmt(au / KPC_AU) + ' kpc';
}

export function formatMass(msun) {
  const e = msun / EARTH_MASS;
  if (e < 0.01) return fmt(msun * 1.98847e30) + ' kg';
  if (e < 1000) return fmt(e) + ' M⊕';
  if (msun < 0.05) return fmt(msun / JUPITER_MASS) + ' M♃';
  return fmt(msun) + ' M☉';
}

export function formatSpeed(auPerYr) {
  return fmt(auPerYr / KM_S_TO_AU_YR) + ' km/s';
}

export function formatDuration(yr) {
  const a = Math.abs(yr);
  if (a < 1 / 8766) return fmt(yr * YEAR_S / 60, 2) + ' min';
  if (a < 2 / 365.25) return fmt(yr * 8766, 2) + ' hr';
  if (a < 0.25) return fmt(yr * 365.25, 2) + ' days';
  if (a < 1e3) return fmt(yr, 3) + ' yr';
  if (a < 1e6) return fmt(yr / 1e3, 3) + ' kyr';
  if (a < 1e9) return fmt(yr / 1e6, 3) + ' Myr';
  return fmt(yr / 1e9, 3) + ' Gyr';
}

export function formatRate(yrPerSec) {
  return formatDuration(yrPerSec) + '/s';
}

export function formatTemp(k) {
  return fmt(k, 4) + ' K';
}
