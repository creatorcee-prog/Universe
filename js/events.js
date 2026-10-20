// Real sky events for the dated Solar System scenario (presets.js epochNow): the annual meteor showers and the next
// solar eclipses, so the app can say what is happening tonight and show it from the ground.
// Showers: International Meteor Organization, Meteor Shower Calendar (imo.net): peak (month, day; the peak falls at
// a fixed solar longitude, within about a day of the same date each year), ZHR (the rate one observer would see
// with the radiant overhead under a perfectly dark sky), radiant (RA h, Dec deg), entry speed (km/s), the active
// window (month, day to month, day) and the profile's width (days, the rate falling as e^(-|days from peak|/w)).
// Parents: the comets (or rock comets) whose dust Earth crosses.
export const SHOWERS = [
  { name: 'Quadrantids', peak: [1, 3], zhr: 80, ra: 15.33, dec: 49, v: 41, from: [12, 28], to: [1, 12], w: 0.4, parent: '2003 EH1, probably a dead comet' },
  { name: 'Lyrids', peak: [4, 22], zhr: 18, ra: 18.07, dec: 34, v: 49, from: [4, 14], to: [4, 30], w: 1, parent: 'Comet Thatcher (C/1861 G1)' },
  { name: 'Eta Aquariids', peak: [5, 6], zhr: 50, ra: 22.53, dec: -1, v: 66, from: [4, 19], to: [5, 28], w: 4, parent: "Halley's Comet" },
  { name: 'Southern Delta Aquariids', peak: [7, 30], zhr: 25, ra: 22.67, dec: -16, v: 41, from: [7, 12], to: [8, 23], w: 4, parent: 'Comet 96P/Machholz' },
  { name: 'Perseids', peak: [8, 12], zhr: 100, ra: 3.2, dec: 58, v: 59, from: [7, 17], to: [8, 24], w: 1.5, parent: 'Comet Swift–Tuttle (109P)' },
  { name: 'Draconids', peak: [10, 8], zhr: 10, ra: 17.47, dec: 54, v: 20, from: [10, 6], to: [10, 10], w: 0.5, parent: 'Comet Giacobini–Zinner (21P)' },
  { name: 'Southern Taurids', peak: [10, 10], zhr: 5, ra: 2.13, dec: 9, v: 27, from: [9, 10], to: [11, 20], w: 15, parent: 'Comet Encke (2P)' },
  { name: 'Orionids', peak: [10, 21], zhr: 20, ra: 6.33, dec: 16, v: 66, from: [10, 2], to: [11, 7], w: 3, parent: "Halley's Comet" },
  { name: 'Northern Taurids', peak: [11, 12], zhr: 5, ra: 3.87, dec: 22, v: 29, from: [10, 20], to: [12, 10], w: 15, parent: 'Comet Encke (2P)' },
  { name: 'Leonids', peak: [11, 17], zhr: 15, ra: 10.2, dec: 22, v: 71, from: [11, 6], to: [11, 30], w: 1, parent: 'Comet Tempel–Tuttle (55P)' },
  { name: 'Geminids', peak: [12, 14], zhr: 150, ra: 7.47, dec: 33, v: 35, from: [12, 4], to: [12, 20], w: 1, parent: '3200 Phaethon, a "rock comet"' },
  { name: 'Ursids', peak: [12, 22], zhr: 10, ra: 14.47, dec: 76, v: 33, from: [12, 17], to: [12, 26], w: 0.7, parent: 'Comet Tuttle (8P)' },
];

// The next solar eclipses (NASA eclipse web site, Espenak): date, kind, where.
export const ECLIPSES = [
  ['2027-02-06', 'Annular solar eclipse', 'South America, the Atlantic, West Africa'],
  ['2027-08-02', 'Total solar eclipse', 'Spain, North Africa, Egypt, Arabia: up to 6 min 23 s of totality'],
  ['2028-01-26', 'Annular solar eclipse', 'Ecuador, Brazil, Spain, Portugal'],
  ['2028-07-22', 'Total solar eclipse', 'Australia and New Zealand'],
];

const DAY = 86400e3;
// The shower's peak nearest to the time ms, and the days from it.
function nearestPeak(s, ms) {
  const y = new Date(ms).getUTCFullYear();
  let best = null;
  for (const yy of [y - 1, y, y + 1]) {
    const t = Date.UTC(yy, s.peak[0] - 1, s.peak[1], 12);
    if (!best || Math.abs(t - ms) < Math.abs(best - ms)) best = t;
  }
  return { t: best, days: (ms - best) / DAY };
}
// Is ms inside the shower's active window (which may wrap the new year)?
function activeAt(s, ms) {
  const d = new Date(ms), md = (d.getUTCMonth() + 1) * 100 + d.getUTCDate(), a = s.from[0] * 100 + s.from[1], b = s.to[0] * 100 + s.to[1];
  return a <= b ? md >= a && md <= b : md >= a || md <= b;
}
// The rate now (ZHR) of every shower active at ms, strongest first.
export function showersAt(ms) {
  const out = [];
  for (const s of SHOWERS) {
    if (!activeAt(s, ms)) continue;
    const p = nearestPeak(s, ms), zhr = s.zhr * Math.exp(-Math.abs(p.days) / s.w);
    out.push({ s, zhr, days: p.days, peakT: p.t });
  }
  return out.sort((a, b) => b.zhr - a.zhr);
}
// Coming up within `days` days: showers (by peak) and eclipses, soonest first.
export function upcoming(ms, days = 90) {
  const out = [];
  for (const s of SHOWERS) {
    const p = nearestPeak(s, ms);
    let t = p.t;
    if (t < ms - 2 * DAY) { const n = new Date(t); t = Date.UTC(n.getUTCFullYear() + 1, s.peak[0] - 1, s.peak[1], 12); }
    if (t - ms < days * DAY) out.push({ t, kind: 'shower', s, text: `${s.name} peak: up to ${s.zhr} meteors an hour, from ${s.parent}` });
  }
  for (const [d, kind, where] of ECLIPSES) {
    const t = Date.parse(d + 'T12:00Z');
    if (t >= ms - DAY) out.push({ t, kind: 'eclipse', text: `${kind}: ${where}` });
  }
  return out.sort((a, b) => a.t - b.t);
}
// The radiant's direction in the app's world frame (ecliptic J2000: x, y = ecliptic north, z = -ecliptic y).
export function radiantDir(s) {
  const E = (23.4393 * Math.PI) / 180, a = (s.ra * 15 * Math.PI) / 180, d = (s.dec * Math.PI) / 180;
  const x = Math.cos(d) * Math.cos(a), y = Math.cos(d) * Math.sin(a), z = Math.sin(d);
  const Y = y * Math.cos(E) + z * Math.sin(E), Z = -y * Math.sin(E) + z * Math.cos(E);
  return [x, Z, -Y];
}
