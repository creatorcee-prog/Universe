// Magnetic fields: each world's dipole (strength, tilt, offset from the centre) and the magnetosphere the star's
// wind shapes from it. Measured dipoles: Connerney 1993 (J. Geophys. Res. 98, 18659) for the giants, IGRF for
// Earth, MESSENGER for Mercury (Anderson et al. 2011, Science 333, 1859), Galileo for Ganymede (Kivelson et al.
// 1996). Elsewhere a dynamo is assumed where one is likely: giant planets (metallic hydrogen or ionic water
// deep down), stars (convection), and rocky worlds over ~0.3 Earth masses with an iron core that still turn
// quickly enough (Venus, turning once in 243 days, has none; Mars, small, lost its dynamo).
import { isLuminous } from './bodies.js';

const ME = 3.003e-6;
// B0: equatorial surface field (T); tilt of the dipole from the spin axis (deg); offset of its centre (planet
// radii, along the spin axis and across it).
const KNOWN = {
  Mercury: { B0: 1.95e-7, tilt: 0.8, off: [0.2, 0] },
  Earth: { B0: 3.05e-5, tilt: 9.4, off: [0, 0.07] },
  Jupiter: { B0: 4.17e-4, tilt: 9.6, off: [0, 0.07] },
  Saturn: { B0: 2.1e-5, tilt: 0.1, off: [0.04, 0] },
  Uranus: { B0: 2.3e-5, tilt: 59, off: [-0.1, 0.3] },
  Neptune: { B0: 1.42e-5, tilt: 47, off: [0.2, 0.5] },
  Ganymede: { B0: 7.2e-7, tilt: 4, off: [0, 0] },
  Sun: { B0: 1e-4, tilt: 7, off: [0, 0] },
};

export function fieldOf(b) {
  if (!b || !b.alive || !(b.r > 0)) return null;
  const name = (b.ident || b.name).replace(/ \d+$/, '');
  if (KNOWN[name]) return KNOWN[name];
  if (b.kind === 'star') return { B0: 1e-4, tilt: 8, off: [0, 0] };
  if (b.kind === 'gas') return { B0: b.m / ME > 50 ? 2e-4 : 2e-5, tilt: 10, off: [0, 0] };
  if (b.kind === 'rocky' && b.m > 0.3 * ME) {
    const iron = b.comp ? b.comp.iron || 0 : 0.3;
    const day = Math.abs(b.dayH || 24);
    if (iron > 0.15 && day < 200) return { B0: 3e-5 * Math.sqrt(b.m / ME), tilt: 10, off: [0, 0] };
  }
  return null;
}

// Where the field stops the star's wind: the magnetopause, at the distance where the field's pressure B²/2μ0
// (doubled by the currents at the boundary) equals the wind's ram pressure ρv² (Chapman & Ferraro 1931), in the
// world's radii: Earth's comes out ~10, Jupiter's ~45 (measured 50-100: its spinning plasma inflates it).
// The Sun's wind: ~5 protons/cm³ at 1 AU falling as 1/d², 400 km/s; other stars scaled by luminosity.
export function magnetopause(b, f, world) {
  let best = null, flux = 0;
  for (const s of world.bodies) {
    if (s === b || !isLuminous(s)) continue;
    const d2 = (s.x - b.x) ** 2 + (s.y - b.y) ** 2 + (s.z - b.z) ** 2, fl = s.lum / d2;
    if (fl > flux) { flux = fl; best = s; }
  }
  if (!best) return { R: 30, star: null };
  const d = Math.sqrt((best.x - b.x) ** 2 + (best.y - b.y) ** 2 + (best.z - b.z) ** 2);
  const rho = 5e6 * 1.67e-27 * Math.max(0.1, best.lum) / (d * d), v = 4e5;
  const R = Math.pow((2 * f.B0 * f.B0) / (4e-7 * Math.PI * rho * v * v), 1 / 6);
  return { R: Math.max(1.2, Math.min(200, R)), star: best };
}

// Field lines of b as polylines (world coordinates): its dipole's closed loops, squeezed on the side facing the
// star's wind toward the magnetopause and drawn out on the far side into a tail, where the outer lines open.
// rot: the body's orientation (object -> world, column-major), whose y axis is its spin axis.
export function fieldLines(b, f, world, rot) {
  const mp = magnetopause(b, f, world), R = b.r;
  const out = [];
  const col = (i) => [rot[i * 3], rot[i * 3 + 1], rot[i * 3 + 2]];
  const X = col(0), Y = col(1), Z = col(2);
  const tl = (f.tilt * Math.PI) / 180;
  // The dipole axis (tilted from the spin axis toward the body's own x) and two axes across it.
  const m = [0, 1, 2].map((i) => Y[i] * Math.cos(tl) + X[i] * Math.sin(tl));
  const e1 = [0, 1, 2].map((i) => X[i] * Math.cos(tl) - Y[i] * Math.sin(tl));
  const e2 = [m[1] * e1[2] - m[2] * e1[1], m[2] * e1[0] - m[0] * e1[2], m[0] * e1[1] - m[1] * e1[0]];
  const c0 = [0, 1, 2].map((i) => (Y[i] * f.off[0] + X[i] * f.off[1]) * R);
  let sd = null;
  if (mp.star) {
    const s = mp.star, d = Math.hypot(s.x - b.x, s.y - b.y, s.z - b.z);
    sd = [(s.x - b.x) / d, (s.y - b.y) / d, (s.z - b.z) / d];
  }
  const Rmp = mp.R;
  const shells = [1.35, 1.8, 2.6, 3.8, 5.5, 8, 12].map((k) => 1 + (k - 1) * Math.max(0.3, (Rmp - 1) / 10)).filter((L) => L < Rmp * 1.6);
  for (const L of shells) {
    for (let j = 0; j < 8; j++) {
      const ph = (j / 8) * Math.PI * 2 + 0.2;
      const cph = Math.cos(ph), sph = Math.sin(ph);
      const th0 = Math.asin(Math.min(1, Math.sqrt(1 / L)));
      const pts = [];
      let open = false;
      const n = 40;
      for (let k = 0; k <= n; k++) {
        const th = th0 + ((Math.PI - 2 * th0) * k) / n;
        const r = L * Math.sin(th) ** 2;
        // magnetic frame -> world (radii), about the dipole's centre
        let p = [0, 1, 2].map((i) => c0[i] / R + r * (Math.sin(th) * (cph * e1[i] + sph * e2[i]) + Math.cos(th) * m[i]));
        if (sd) {
          const pl = Math.hypot(p[0], p[1], p[2]), xs = p[0] * sd[0] + p[1] * sd[1] + p[2] * sd[2];
          if (xs > 0) {
            // squeezed against the magnetopause on the side facing the wind: the distance toward the star
            // flattens smoothly onto it, and the lines spread less across (a blunt bullet nose)
            const xn = 0.95 * Rmp * Math.tanh(xs / (0.95 * Rmp)), k3 = 1 / (1 + 0.35 * (pl / Rmp) ** 2 * (xs / pl));
            p = p.map((v, i) => (v - sd[i] * xs) * k3 + sd[i] * xn);
          } else {
            // drawn out downwind into the tail (Earth's reaches ~1000 radii): the farther out and the more
            // downwind, the more; the outermost lines open and stream away instead of closing
            const st = Math.min(8 * Rmp, 6 * (-xs / pl) * Math.pow(pl / Rmp, 2) * pl);
            p = p.map((v, i) => v - sd[i] * st);
            if (L > Rmp * 0.7) open = true;
          }
        }
        pts.push(b.x + p[0] * R, b.y + p[1] * R, b.z + p[2] * R);
      }
      out.push({ pts, open, L });
    }
  }
  return { lines: out, Rmp, star: mp.star };
}

// The star's own field carried out by its wind: Parker spirals in its equatorial plane, wound by its turning
// (25.4 days for the Sun) against the wind's 400 km/s: 45° from radial at 1 AU (Parker 1958, ApJ 128, 664).
export function parkerSpirals(s, rot, reach) {
  const Y = [rot[3], rot[4], rot[5]], X = [rot[0], rot[1], rot[2]];
  const Z = [Y[1] * X[2] - Y[2] * X[1], Y[2] * X[0] - Y[0] * X[2], Y[0] * X[1] - Y[1] * X[0]];
  const k = 1.07;   // rad per AU: Ω/v
  const out = [];
  for (let j = 0; j < 12; j++) {
    const a0 = (j / 12) * Math.PI * 2, pts = [];
    const r0 = s.r * 3;
    for (let i = 0; i <= 120; i++) {
      const r = r0 * Math.pow(reach / r0, i / 120);
      const a = a0 - k * r;
      pts.push(s.x + (X[0] * Math.cos(a) + Z[0] * Math.sin(a)) * r, s.y + (X[1] * Math.cos(a) + Z[1] * Math.sin(a)) * r, s.z + (X[2] * Math.cos(a) + Z[2] * Math.sin(a)) * r);
    }
    out.push(pts);
  }
  return out;
}
