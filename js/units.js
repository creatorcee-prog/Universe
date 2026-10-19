// Simulation units: distance in AU (IAU 2012: 149,597,870,700 m exactly), mass in solar masses,
// time in Julian years (365.25 days). G is the Sun's gravitational parameter in these units:
// GM☉ = 1.32712440041279419e20 m³/s² (JPL DE440, Park et al. 2021, AJ 161, 105), which gives
// G ≈ 39.4769 AU³/(M☉·yr²), close to but not exactly 4π² (a 1 AU orbit takes 365.2569 days, not 365.25).
export const GM_SUN_SI = 1.32712440041279419e20;
export const G = (GM_SUN_SI * 3.15576e7 * 3.15576e7) / (1.495978707e11 ** 3);
export const AU_KM = 1.495978707e8;
export const LY_AU = 63241.077;
export const KPC_AU = 2.0626e8;
export const C_AU_YR = 63241.077; // speed of light in AU/yr (1 ly per yr)
// Masses as ratios of DE440 gravitational parameters (km³/s²) to the Sun's (1.32712440041279419e11).
const GMS = 132712440041.279419;
export const EARTH_MASS = 398600.435507 / GMS;   // 3.00349e-6 M☉
export const JUPITER_MASS = 126686531.9 / GMS;   // planet alone, without its moons
export const MOON_MASS = 4902.800118 / GMS;
export const massFromGM = (gmKm3s2) => gmKm3s2 / GMS;
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
  if (a !== 0 && (a < 1e-3 || a >= 1e6)) {
    const [m, e] = v.toExponential(2).split('e');
    return `${m} × 10${String(+e).replace(/./g, (c) => '⁻⁰¹²³⁴⁵⁶⁷⁸⁹'['-0123456789'.indexOf(c)])}`;
  }
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
