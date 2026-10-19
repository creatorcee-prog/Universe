// Thumbnails for the Create panel: small lit spheres drawn per pixel on a 2D canvas, with surface
// detail by kind (continents, craters, gas bands, ice, star granulation, black-hole disks).

import { makeBody, reclassify, isLuminous } from './bodies.js';

function hash(x, y, z) {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

function vnoise(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const l = (a, b, t) => a + (b - a) * t;
  return l(
    l(l(hash(ix, iy, iz), hash(ix + 1, iy, iz), u), l(hash(ix, iy + 1, iz), hash(ix + 1, iy + 1, iz), u), v),
    l(l(hash(ix, iy, iz + 1), hash(ix + 1, iy, iz + 1), u), l(hash(ix, iy + 1, iz + 1), hash(ix + 1, iy + 1, iz + 1), u), v),
    w,
  );
}

function fbm(x, y, z, o = 4) {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < o; i++) { s += a * vnoise(x * f, y * f, z * f); f *= 2.03; a *= 0.5; }
  return s / (1 - Math.pow(0.5, o));
}

const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const sm = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

// Surface colour (0..1 rgb) at unit-sphere point (x, y, z) for a catalogue item.
function surface(item, col, x, y, z, seed) {
  const c = col.map((v) => v / 255);
  const id = item.id;
  if (item.kind === 'gas') {
    const band = 0.5 + 0.5 * Math.sin((y * (id === 'jupiter' ? 9 : id === 'saturn' ? 11 : 5) + fbm(x * 2 + seed, y * 6, z * 2, 3) * 1.2) * 6.283);
    const b2 = (item.band || col).map((v) => v / 255);
    let s = mix(c, b2, band * (id === 'jupiter' ? 0.8 : id === 'uranus' ? 0.08 : 0.35));
    if (id === 'jupiter') { const dx = x - 0.45, dy = y + 0.35; if (dx * dx * 0.6 + dy * dy * 3 < 0.012 && z > 0) s = mix(s, [0.75, 0.38, 0.25], 0.8); }
    return s;
  }
  const h = fbm(x * 1.8 + seed, y * 1.8, z * 1.8, 5);
  if (id === 'earth' || id === 'oceanworld') {
    const sea = id === 'earth' ? 0.53 : 0.66;
    const ocean = mix([0.02, 0.08, 0.24], [0.06, 0.25, 0.5], sm(sea - 0.15, sea, h));
    const land = mix([0.22, 0.36, 0.14], [0.6, 0.5, 0.33], sm(0.5, 0.7, fbm(x * 4 + 3, y * 4, z * 4, 3)));
    let s = h > sea ? land : ocean;
    if (Math.abs(y) > 0.86 + 0.06 * (h - 0.5)) s = [0.9, 0.93, 0.97];
    const cl = sm(0.55, 0.75, fbm(x * 2.6 + 9, y * 5, z * 2.6, 4));
    return mix(s, [0.95, 0.96, 1], cl * 0.8);
  }
  if (id === 'venus' || id === 'titan') {
    const sw = fbm(x * 2.5 + seed, y * 6, z * 2.5, 4);
    return id === 'venus' ? mix([0.86, 0.78, 0.6], [0.95, 0.9, 0.76], sw) : mix([0.72, 0.45, 0.18], [0.86, 0.6, 0.28], sw);
  }
  if (id === 'io') {
    let s = mix([0.85, 0.78, 0.38], [0.92, 0.88, 0.6], sm(0.3, 0.7, h));
    if (vnoise(x * 7 + seed, y * 7, z * 7) > 0.75) s = [0.25, 0.12, 0.06];
    return s;
  }
  if (id === 'pluto') {
    let s = mix([0.62, 0.48, 0.36], [0.85, 0.75, 0.62], sm(0.3, 0.7, h));
    const dx = x + 0.15, dy = y + 0.1; if (dx * dx + dy * dy < 0.12 && z > 0) s = [0.95, 0.92, 0.88];
    return s;
  }
  if (id === 'mars') {
    let s = mix([0.55, 0.24, 0.12], [0.78, 0.45, 0.28], sm(0.35, 0.65, h));
    if (Math.abs(y) > 0.9) s = [0.93, 0.9, 0.88];
    return s;
  }
  if (id === 'icemoon' || id === 'comet') {
    let s = mix([0.62, 0.66, 0.72], [0.93, 0.95, 0.98], sm(0.35, 0.65, h));
    const l = 1 - sm(0, 0.03, Math.abs(vnoise(x * 5 + seed, y * 5, z * 5) - 0.5));
    if (id === 'icemoon') s = mix(s, [0.62, 0.45, 0.35], l * 0.7);
    else s = mix([0.3, 0.29, 0.28], [0.5, 0.48, 0.45], sm(0.3, 0.7, h));
    return s;
  }
  // Moon, asteroid: grey with craters.
  let s = mix(c.map((v) => v * 0.6), c.map((v) => Math.min(1, v * 1.15)), sm(0.3, 0.7, h));
  const cr = vnoise(x * 6 + seed, y * 6, z * 6);
  if (cr > 0.72) s = s.map((v) => v * (0.75 + 0.25 * sm(0.72, 0.8, cr)));
  return s;
}

export function renderThumb(item, size = 128) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  const R = size * 0.4, c0 = size / 2;
  if (item.kind === 'dust') {
    for (let i = 0; i < 260; i++) {
      const a = Math.random() * 6.283, r = R * Math.sqrt(Math.random()) * 1.1;
      ctx.fillStyle = `rgba(${200 + Math.random() * 40 | 0},${170 + Math.random() * 30 | 0},${130 + Math.random() * 30 | 0},${0.3 + Math.random() * 0.6})`;
      ctx.fillRect(c0 + Math.cos(a) * r, c0 + Math.sin(a) * r * 0.75, size / 80 + 1, size / 80 + 1);
    }
    return cv;
  }
  if (item.kind === 'nebula') {
    // Red hydrogen glow with a blue-green heart, crossed by a dark dust lane.
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * 6.283, r = R * 0.75 * Math.sqrt(Math.random());
      const x = c0 + Math.cos(a) * r, y = c0 + Math.sin(a) * r * 0.8, rr = R * (0.25 + Math.random() * 0.35);
      const g = ctx.createRadialGradient(x, y, 0, x, y, rr);
      const blue = r < R * 0.25 && Math.random() < 0.6;
      g.addColorStop(0, blue ? 'rgba(90,200,255,0.22)' : 'rgba(235,60,95,0.2)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(x - rr, y - rr, rr * 2, rr * 2);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = 'rgba(12,8,14,0.55)'; ctx.lineWidth = R * 0.18;
    ctx.beginPath(); ctx.moveTo(c0 - R * 0.2, c0 - R); ctx.quadraticCurveTo(c0 + R * 0.1, c0, c0 - R * 0.05, c0 + R); ctx.stroke();
    return cv;
  }
  if (item.kind === 'bh') {
    const g = ctx.createRadialGradient(c0, c0, R * 0.3, c0, c0, R * 1.2);
    g.addColorStop(0, 'rgba(255,220,170,1)'); g.addColorStop(0.35, 'rgba(255,150,60,.9)'); g.addColorStop(1, 'rgba(255,90,20,0)');
    ctx.save(); ctx.translate(c0, c0); ctx.scale(1, 0.32); ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, R * 1.2, 0, 6.283); ctx.fill(); ctx.restore();
    ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(c0, c0, R * 0.42, 0, 6.283); ctx.fill();
    ctx.strokeStyle = 'rgba(255,210,150,.9)'; ctx.lineWidth = size / 60; ctx.beginPath(); ctx.arc(c0, c0, R * 0.45, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke();
    return cv;
  }
  const b = makeBody({ kind: item.kind, m: item.m, r: item.r, color: item.color, band: item.band });
  reclassify(b);
  const col = b.color || [180, 180, 180];
  const lum = isLuminous(b);
  const img = ctx.createImageData(size, size);
  const seed = item.id.length * 3.7;
  const L = [-0.55, 0.45, 0.7];
  const ll = Math.hypot(...L); L[0] /= ll; L[1] /= ll; L[2] /= ll;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const dx = (px + 0.5 - c0) / R, dy = -(py + 0.5 - c0) / R;
      const r2 = dx * dx + dy * dy;
      const i = (py * size + px) * 4;
      if (r2 > 1) {
        // Glow for stars, thin atmosphere halo for air worlds.
        const d = Math.sqrt(r2);
        let a = 0, gc = col;
        if (lum) a = Math.max(0, 1 - (d - 1) / 0.45) ** 2 * 0.8;
        else if (item.atmo) { a = Math.max(0, 1 - (d - 1) / 0.06) * 0.6; gc = item.atmo; }
        if (a > 0) { img.data[i] = gc[0]; img.data[i + 1] = gc[1]; img.data[i + 2] = gc[2]; img.data[i + 3] = a * 255; }
        continue;
      }
      const z = Math.sqrt(1 - r2);
      // Tilt the globe a little so poles show.
      const ty = dy * 0.94 + z * 0.34, tz = -dy * 0.34 + z * 0.94;
      let rgb;
      if (lum) {
        const mu = z;
        const gran = fbm(dx * 14 + seed, ty * 14, tz * 14, 3);
        const I = (0.55 + 0.45 * Math.sqrt(mu)) * (0.9 + 0.2 * gran);
        rgb = col.map((v) => Math.min(1, (v / 255) * I * 1.15 + 0.15 * mu));
      } else {
        const s = surface(item, col, dx, ty, tz, seed);
        const ndl = Math.max(0, dx * L[0] + dy * L[1] + z * L[2]);
        const lit = 0.06 + 0.94 * ndl;
        rgb = s.map((v) => v * lit);
        if (item.atmo) { const f = Math.pow(1 - z, 3) * 0.7; rgb = mix(rgb, item.atmo.map((v) => (v / 255) * (0.2 + ndl)), f); }
      }
      img.data[i] = Math.min(255, rgb[0] * 255);
      img.data[i + 1] = Math.min(255, rgb[1] * 255);
      img.data[i + 2] = Math.min(255, rgb[2] * 255);
      img.data[i + 3] = 255 * Math.min(1, (1 - Math.sqrt(r2)) * R * 1.5); // soft edge
    }
  }
  if (item.id === 'saturn') {
    // Rings: drawn as a tilted ellipse in front of and behind the globe.
    ctx.save(); ctx.translate(c0, c0); ctx.rotate(-0.35); ctx.scale(1, 0.28);
    ctx.strokeStyle = 'rgba(214,196,160,0.85)'; ctx.lineWidth = R * 0.32;
    ctx.beginPath(); ctx.arc(0, 0, R * 1.62, Math.PI, Math.PI * 2); ctx.stroke(); ctx.restore();
  }
  // putImageData ignores compositing; draw via a second canvas so the glow blends.
  const tmp = document.createElement('canvas');
  tmp.width = tmp.height = size;
  tmp.getContext('2d').putImageData(img, 0, 0);
  ctx.drawImage(tmp, 0, 0);
  if (item.id === 'saturn') {
    ctx.save(); ctx.translate(c0, c0); ctx.rotate(-0.35); ctx.scale(1, 0.28);
    ctx.strokeStyle = 'rgba(214,196,160,0.9)'; ctx.lineWidth = R * 0.32;
    ctx.beginPath(); ctx.arc(0, 0, R * 1.62, 0, Math.PI); ctx.stroke(); ctx.restore();
  }
  return cv;
}

// Category of a catalogue item in the Create panel.
export function category(item) {
  if (['comet', 'asteroid', 'icemoon', 'moon', 'dust'].includes(item.id)) return 'small';
  if (item.kind === 'rocky' || item.kind === 'gas') return 'planet';
  if (item.kind === 'star') return 'star';
  return 'exotic';
}
