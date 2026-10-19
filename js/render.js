import { PK } from './physics.js';
import { G } from './units.js';
import { isLuminous } from './bodies.js';
import { tempZones } from './thermal.js';
import { gravZones } from './gravzones.js';

const TRAIL_LEN = 360;

const PARTICLE_RGB = {
  [PK.DEBRIS]: [196, 150, 116], [PK.HOT]: [255, 196, 130], [PK.STAR_BLUE]: [168, 196, 255], [PK.STAR_GOLD]: [255, 218, 168],
  [PK.ICE]: [214, 220, 232], [PK.DUST]: [190, 160, 128], [PK.GAS]: [214, 184, 146], [PK.ROCK]: [164, 148, 132],
  [PK.SN_H]: [255, 80, 100], [PK.SN_O]: [80, 230, 210], [PK.SN_SI]: [255, 205, 90], [PK.SN_FE]: [230, 228, 255],
};

// On-screen radius in device pixels that both views give a body (tiny bodies get a minimum size).
export function shownRadius(b, p, dpr, trueSize = false) {
  const R = b.r * p.s;
  // True sizes: planets and moons are drawn at their real size however small (a marker ring finds them).
  if (trueSize && (b.kind === 'rocky' || b.kind === 'gas')) return Math.max(R, 0.5 * dpr);
  switch (b.kind) {
    case 'star': case 'wd': case 'ns': return Math.max(R, 3 * dpr);
    case 'bh': return Math.max(R * 2.6, 4.5 * dpr);
    case 'core': return Math.min(Math.max(b.soft * p.s * 0.9, 6 * dpr) * 0.3, 14 * dpr);
    default: return R < 1.6 * dpr ? (b.m > 1e-7 ? 2.4 : 1.6) * dpr : R;
  }
}

const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const mix = (c, k) => [Math.round(c[0] * k), Math.round(c[1] * k), Math.round(c[2] * k)];
const lighten = (c, k) => [Math.round(c[0] + (255 - c[0]) * k), Math.round(c[1] + (255 - c[1]) * k), Math.round(c[2] + (255 - c[2]) * k)];

// Cool-to-hot ramp used by colour-coded trails: blue, cyan, green, yellow, red.
function heatRamp(t) {
  t = Math.max(0, Math.min(1, t));
  const stops = [[0, [60, 110, 255]], [0.3, [40, 220, 230]], [0.55, [80, 235, 90]], [0.78, [250, 225, 60]], [1, [255, 70, 50]]];
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [t0, a] = stops[i - 1], [t1, c] = stops[i], k = (t - t0) / (t1 - t0);
      return [a[0] + (c[0] - a[0]) * k | 0, a[1] + (c[1] - a[1]) * k | 0, a[2] + (c[2] - a[2]) * k | 0];
    }
  }
  return stops[stops.length - 1][1];
}

export class Renderer {
  constructor(canvas, world, cam, settings) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.overlay = false; // true when the 3D view draws the scene and this canvas only adds trails, labels and markers
    this.world = world;
    this.cam = cam;
    this.settings = settings;
    this.screen = new Map(); // body -> {x, y, r} from the last frame, for picking
    this.trails = new Map();
    this.g = 0; // global trail sample counter
    this.dpr = 1;
    this.makeStars();
    this.tmp = { x: 0, y: 0, s: 0 };
    this.tmp2 = { x: 0, y: 0, s: 0 };
    this.dir = { x: 0, y: 0, z: 0 };
    this.gridSpacing = 1;
  }

  resize() {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.cam.setViewport(this.canvas.width, this.canvas.height);
  }

  makeStars() {
    const n = 1400;
    this.stars = new Float32Array(n * 5);
    for (let i = 0; i < n; i++) {
      let x, y, z;
      if (i % 5 < 2) {
        // A Milky Way band: concentrate stars near a tilted great circle.
        const t = Math.random() * Math.PI * 2;
        const lat = (Math.random() + Math.random() + Math.random() - 1.5) * 0.22;
        x = Math.cos(t) * Math.cos(lat); y = Math.sin(lat); z = Math.sin(t) * Math.cos(lat);
        const tilt = 1.05;
        const y2 = y * Math.cos(tilt) - z * Math.sin(tilt);
        z = y * Math.sin(tilt) + z * Math.cos(tilt); y = y2;
      } else {
        const u = Math.random() * 2 - 1, t = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
        x = s * Math.cos(t); y = u; z = s * Math.sin(t);
      }
      const o = i * 5;
      this.stars[o] = x; this.stars[o + 1] = y; this.stars[o + 2] = z;
      this.stars[o + 3] = Math.pow(Math.random(), 3); // brightness
      this.stars[o + 4] = Math.random(); // tint
    }
  }

  resetTrails() {
    this.trails.clear();
  }

  // frameDt: simulated time this frame covered. A body that orbits in less than ~8 frames can't be traced
  // by a once-per-frame trail (it would draw a starburst of chords, as for two black holes orbiting every
  // few seconds while time runs at an hour per second), so it is flagged, its trail dropped, and its orbit
  // drawn as a smooth ellipse instead (see drawOrbits).
  sampleTrails(frameDt = 0) {
    const g = ++this.g;
    const slot = g % TRAIL_LEN;
    if (frameDt > 0 && g % 10 === 0) {
      const hier = this.world.hierarchy();
      for (const b of this.world.bodies) { b._fastOrbit = false; b._fastOwn = false; }
      for (const b of this.world.bodies) {
        const par = hier.get(b)?.parent;
        if (!par || par === b) continue;
        const r = Math.hypot(b.x - par.x, b.y - par.y, b.z - par.z), mu = G * (b.m + par.m);
        const v2 = (b.vx - par.vx) ** 2 + (b.vy - par.vy) ** 2 + (b.vz - par.vz) ** 2, en = v2 / 2 - mu / r;
        if (en < 0 && 2 * Math.PI * Math.sqrt((-mu / (2 * en)) ** 3 / mu) < 8 * frameDt) {
          b._fastOrbit = true; b._fastOwn = true;
          if (b.m > 0.05 * par.m) par._fastOrbit = true; // a binary: the partner swings round just as fast
        }
      }
    }
    for (const b of this.world.bodies) {
      let t = this.trails.get(b);
      if (!t || b._fastOrbit) { t = { buf: new Float64Array(TRAIL_LEN * 3), start: g }; this.trails.set(b, t); }
      t.buf[slot * 3] = b.x; t.buf[slot * 3 + 1] = b.y; t.buf[slot * 3 + 2] = b.z;
    }
    if (g % 120 === 0) for (const b of this.trails.keys()) if (!b.alive) this.trails.delete(b);
  }

  pickBody(sx, sy, radius) {
    let best = null, bestD = Infinity;
    for (const [b, p] of this.screen) {
      const d = Math.hypot(p.x - sx, p.y - sy) - p.r;
      const lim = radius * this.dpr;
      if (d < lim && d < bestD) { best = b; bestD = d; }
    }
    return best;
  }

  draw(now, ui) {
    const { ctx, cam, world } = this;
    const W = this.canvas.width, H = this.canvas.height, dpr = this.dpr;
    this.selected = ui.selected;
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    if (this.overlay) {
      ctx.clearRect(0, 0, W, H);
      this.gridSpacing = Math.pow(10, Math.floor(Math.log10(cam.dist / 1.5)));
      if (this.settings.trails) this.drawTrails();
      this.drawOrbits(ui, !this.settings.orbits);
      this.drawZones(ui);
      this.drawBodies(now, ui);
      this.drawFlashes(now);
      if (ui.laser) this.drawLaser(ui.laser, now);
      if (ui.preview && !this.photo) this.drawPreview(ui.preview);
      if (this.settings.labels) this.drawLabels(ui);
      return;
    }
    const bg = ctx.createRadialGradient(W * 0.5, H * 0.45, 0, W * 0.5, H * 0.5, Math.max(W, H) * 0.8);
    bg.addColorStop(0, '#0a0e1a');
    bg.addColorStop(1, '#03040a');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    if (this.settings.stars) this.drawStars();
    if (this.settings.grid) this.drawGrid();
    if (this.settings.trails) this.drawTrails();
    this.drawOrbits(ui, !this.settings.orbits);
    this.drawZones(ui);
    this.drawParticles();
    this.drawBodies(now, ui);
    this.drawFrontRings();
    this.drawFlashes(now);
    if (ui.laser) this.drawLaser(ui.laser, now);
    if (ui.preview && !this.photo) this.drawPreview(ui.preview);
    if (this.settings.labels) this.drawLabels(ui);
  }

  drawStars() {
    const { ctx, cam } = this;
    const W = this.canvas.width, H = this.canvas.height, F = cam.F, st = this.stars, d = this.dir;
    ctx.globalCompositeOperation = 'lighter';
    const paths = [new Path2D(), new Path2D(), new Path2D()];
    const sz = this.dpr;
    for (let i = 0; i < st.length; i += 5) {
      cam.dirToCam(st[i], st[i + 1], st[i + 2], d);
      if (d.z <= 0.05) continue;
      const x = W / 2 + (d.x / d.z) * F, y = H / 2 - (d.y / d.z) * F;
      if (x < 0 || y < 0 || x > W || y > H) continue;
      const b = st[i + 3];
      const s = sz * (0.6 + b * 1.6);
      paths[st[i + 4] < 0.2 ? 0 : st[i + 4] < 0.85 ? 1 : 2].rect(x, y, s, s);
    }
    ctx.fillStyle = 'rgba(170,190,255,0.55)'; ctx.fill(paths[0]);
    ctx.fillStyle = 'rgba(230,232,240,0.5)'; ctx.fill(paths[1]);
    ctx.fillStyle = 'rgba(255,210,170,0.55)'; ctx.fill(paths[2]);
  }

  // Segment from a to b (world), clipped against the camera near plane.
  segment(path, ax, ay, az, bx, by, bz) {
    const cam = this.cam, p = this.tmp, q = this.tmp2;
    const near = cam.dist * 0.15; // keeps grid lines from smearing across the screen near the camera
    const depth = (x, y, z) => (x - cam.tx - cam.ox) * cam.fx + (y - cam.ty - cam.oy) * cam.fy + (z - cam.tz - cam.oz) * cam.fz;
    let da = depth(ax, ay, az), db = depth(bx, by, bz);
    if (da < near && db < near) return;
    if (da < near) { const k = (near - da) / (db - da); ax += (bx - ax) * k; ay += (by - ay) * k; az += (bz - az) * k; }
    else if (db < near) { const k = (near - db) / (da - db); bx += (ax - bx) * k; by += (ay - by) * k; bz += (az - bz) * k; }
    if (cam.project(ax, ay, az, p) <= 0 || cam.project(bx, by, bz, q) <= 0) return;
    path.moveTo(p.x, p.y);
    path.lineTo(q.x, q.y);
  }

  drawGrid() {
    const { ctx, cam } = this;
    const l = Math.log10(cam.dist / 1.5);
    const s = Math.pow(10, Math.floor(l));
    const f = l - Math.floor(l);
    this.gridSpacing = s;
    const N = 10, ext = N * s;
    const cx = Math.round(cam.tx / s) * s, cz = Math.round(cam.tz / s) * s, y = cam.ty;
    const buckets = [new Path2D(), new Path2D(), new Path2D(), new Path2D()];
    const majors = [new Path2D(), new Path2D(), new Path2D(), new Path2D()];
    const SEG = 10;
    for (let i = -N; i <= N; i++) {
      const major = Math.round((cx + i * s) / s) % 10 === 0;
      const majorZ = Math.round((cz + i * s) / s) % 10 === 0;
      for (let k = 0; k < SEG * 2; k++) {
        const a = -ext + (k * ext) / SEG, b = a + ext / SEG;
        const m = (a + b) / 2;
        // Fade toward the edge of the grid patch.
        const r1 = Math.hypot(i * s, m) / ext;
        if (r1 >= 1) continue;
        const bi = Math.min(3, Math.floor(r1 * 4));
        this.segment(major ? majors[bi] : buckets[bi], cx + i * s, y, cz + a, cx + i * s, y, cz + b);
        this.segment(majorZ ? majors[bi] : buckets[bi], cx + a, y, cz + i * s, cx + b, y, cz + i * s);
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.lineWidth = this.dpr;
    const fade = 1 - f * 0.6;
    for (let k = 0; k < 4; k++) {
      const a = (1 - k / 4) * 0.13;
      ctx.strokeStyle = `rgba(120,150,210,${a * fade})`;
      ctx.stroke(buckets[k]);
      ctx.strokeStyle = `rgba(140,170,230,${a * 1.8})`;
      ctx.stroke(majors[k]);
    }
  }

  // Temperature and gravity zones: flat rings in the orbital (x-z) plane around each chosen body.
  drawZones(ui) {
    if (ui.surface || !((ui.zones && ui.zones.size) || (ui.gzones && ui.gzones.size))) return;
    const { ctx, cam, dpr } = this;
    const N = 160, p = this.tmp;
    const W = this.canvas.width, H = this.canvas.height;
    const list = [];
    if (ui.zones) for (const b of ui.zones) list.push([b, tempZones(b)]);
    if (ui.gzones && ui.gzones.size) {
      const hier = this.world.hierarchy();
      for (const b of ui.gzones) list.push([b, gravZones(b, hier)]);
    }
    for (const [b, z] of list) {
      if (!z) continue;
      // Points of a circle of radius r, or null if much of it is behind the camera.
      const circle = (r) => {
        const pts = [];
        for (let i = 0; i < N; i++) {
          const a = (i / N) * Math.PI * 2;
          if (cam.project(b.x + r * Math.cos(a), b.y, b.z + r * Math.sin(a), p) <= 0) return null;
          pts.push(p.x, p.y);
        }
        return pts;
      };
      const addRing = (path, pts, rev) => {
        for (let k = 0; k < N; k++) {
          const i = (rev ? N - 1 - k : k) * 2;
          if (k === 0) path.moveTo(pts[i], pts[i + 1]); else path.lineTo(pts[i], pts[i + 1]);
        }
        path.closePath();
      };
      ctx.globalCompositeOperation = 'source-over';
      ctx.font = `600 ${11 * dpr}px Inter, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      for (const zone of z.zones) {
        const outer = circle(zone.rout);
        if (!outer) continue;
        // Skip rings far smaller than a pixel or so large they fill the whole screen.
        let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity, low = 0;
        for (let i = 0; i < outer.length; i += 2) {
          minx = Math.min(minx, outer[i]); maxx = Math.max(maxx, outer[i]);
          miny = Math.min(miny, outer[i + 1]);
          if (outer[i + 1] > maxy) { maxy = outer[i + 1]; low = i; }
        }
        if (maxx - minx < 3 * dpr) continue;
        const inner = zone.rin > 0 ? circle(zone.rin) : null;
        const path = new Path2D();
        addRing(path, outer, false);
        if (inner) addRing(path, inner, true);
        const [r, g, bl] = zone.col;
        ctx.fillStyle = `rgba(${r},${g},${bl},${zone.a || (zone.fade ? 0.05 : zone.name === 'Habitable zone' ? 0.16 : 0.1)})`;
        if (!this.overlay || zone.g) ctx.fill(path, 'evenodd'); // the 3D view draws its own temperature field
        ctx.strokeStyle = `rgba(${r},${g},${bl},0.55)`;
        ctx.lineWidth = dpr;
        ctx.setLineDash(zone.fade ? [4 * dpr, 4 * dpr] : []);
        const edge = new Path2D();
        addRing(edge, outer, false);
        ctx.stroke(edge);
        ctx.setLineDash([]);
        // Label the zone at the bottom of its outer edge, if it is on screen and not too cramped.
        const lx = outer[low], ly = outer[low + 1];
        const w = inner ? Math.abs(ly - inner[low + 1]) : maxy - miny;
        if (lx > 0 && lx < W && ly > H * 0.12 && ly < H * 0.78 && (maxx - minx) > 60 * dpr && w > 4 * dpr) {
          ctx.fillStyle = `rgba(${r},${g},${bl},0.9)`;
          ctx.fillText(zone.name, lx, ly - 4 * dpr);
        }
      }
    }
  }

  // Laser beam from the bottom of the screen (the "tool position") to the target, with a hot spot.
  drawLaser(L, now) {
    const { ctx, cam, dpr } = this;
    const b = L.body, p = this.tmp;
    if (!b || cam.project(b.x, b.y, b.z, p) <= 0) return;
    const W = this.canvas.width, H = this.canvas.height;
    const sx = W * 0.5, sy = H + 10 * dpr;
    const sc = this.screen.get(b);
    const rr = sc ? sc.r : 4 * dpr;
    // End the beam on the near face of the object.
    const dx = p.x - sx, dy = p.y - sy, l = Math.hypot(dx, dy) || 1;
    const ex = p.x - (dx / l) * rr * 0.6, ey = p.y - (dy / l) * rr * 0.6;
    const flick = 0.85 + 0.15 * Math.sin(now / 37);
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (const [w, a, c] of [[14, 0.12, '255,40,30'], [6, 0.35, '255,60,40'], [2, 0.95, '255,210,200']]) {
      ctx.strokeStyle = `rgba(${c},${a * flick})`;
      ctx.lineWidth = w * dpr;
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
    }
    const g = ctx.createRadialGradient(ex, ey, 0, ex, ey, 26 * dpr);
    g.addColorStop(0, `rgba(255,240,220,${0.95 * flick})`);
    g.addColorStop(0.3, 'rgba(255,120,60,.55)');
    g.addColorStop(1, 'rgba(255,40,20,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(ex, ey, 26 * dpr, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }

  // Orbit lines: the Kepler ellipse each body would follow around what it orbits (its osculating orbit),
  // or the near part of a hyperbola for escaping bodies.
  // Predicted orbit ellipses (Settings → Orbit lines), and always for bodies orbiting too fast for trails.
  // A fast pair (a binary) is drawn as two ellipses about its centre of mass, each scaled by the other's
  // mass share, which is where the two bodies really move.
  drawOrbits(ui, fastOnly = false) {
    const { ctx, cam, dpr, world } = this;
    if (fastOnly && !world.bodies.some((b) => b._fastOrbit)) return;
    const hier = world.hierarchy();
    const p = this.tmp;
    let list = fastOnly ? world.bodies.filter((b) => b._fastOwn) : world.bodies;
    if (list.length > 80) {
      // Too many to draw them all: the 80 heaviest of those whose orbits show on screen (over a few pixels
      // across), so zooming in on Pluto shows its small moons' orbits even with hundreds of moons elsewhere.
      const ex = cam.tx + cam.ox, ey = cam.ty + cam.oy, ez = cam.tz + cam.oz;
      list = list.filter((b) => {
        const par = hier.get(b)?.parent;
        if (!par) return false;
        const r = Math.hypot(b.x - par.x, b.y - par.y, b.z - par.z), D = Math.hypot(par.x - ex, par.y - ey, par.z - ez);
        return (r * cam.F) / Math.max(D, 1e-12) > 3 * dpr;
      });
      if (list.length > 80) list = list.sort((a, b) => b.m - a.m).slice(0, 80);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.lineWidth = dpr;
    for (const b of list) {
      const par = hier.get(b)?.parent;
      if (!par || b === par) continue;
      const rx = b.x - par.x, ry = b.y - par.y, rz = b.z - par.z, vx = b.vx - par.vx, vy = b.vy - par.vy, vz = b.vz - par.vz;
      const r = Math.hypot(rx, ry, rz), mu = G * (par.m + b.m), v2 = vx * vx + vy * vy + vz * vz;
      const hx = ry * vz - rz * vy, hy = rz * vx - rx * vz, hz = rx * vy - ry * vx, h = Math.hypot(hx, hy, hz);
      if (!(h > 0)) continue;
      const rv = rx * vx + ry * vy + rz * vz;
      let ex = ((v2 - mu / r) * rx - rv * vx) / mu, ey = ((v2 - mu / r) * ry - rv * vy) / mu, ez = ((v2 - mu / r) * rz - rv * vz) / mu;
      const e = Math.hypot(ex, ey, ez), sl = (h * h) / mu; // semi-latus rectum
      let Px, Py, Pz;
      if (e > 1e-6) { Px = ex / e; Py = ey / e; Pz = ez / e; } else { Px = rx / r; Py = ry / r; Pz = rz / r; }
      const Qx = (hy * Pz - hz * Py) / h, Qy = (hz * Px - hx * Pz) / h, Qz = (hx * Py - hy * Px) / h;
      const thMax = e < 1 ? Math.PI : Math.min(Math.acos(-1 / e) * 0.97, Math.PI);
      // Comparable masses: draw both bodies' paths about the centre of mass.
      const M = par.m + b.m, binary = b._fastOrbit && b.m > 0.05 * par.m;
      const cx = binary ? (par.x * par.m + b.x * b.m) / M : par.x, cy = binary ? (par.y * par.m + b.y * b.m) / M : par.y, cz = binary ? (par.z * par.m + b.z * b.m) / M : par.z;
      const shapes = binary ? [[b, par.m / M], [par, -b.m / M]] : [[b, 1]];
      for (const [who, k] of shapes) {
        const N = 128, path = new Path2D();
        let pen = false;
        for (let j = 0; j <= N; j++) {
          const th = -thMax + (2 * thMax * j) / N;
          const rr = sl / (1 + e * Math.cos(th));
          if (!(rr > 0) || rr > 50 * r) { pen = false; continue; }
          const c = Math.cos(th) * rr * k, s = Math.sin(th) * rr * k;
          if (cam.project(cx + c * Px + s * Qx, cy + c * Py + s * Qy, cz + c * Pz + s * Qz, p) <= 0) { pen = false; continue; }
          if (pen) path.lineTo(p.x, p.y); else path.moveTo(p.x, p.y);
          pen = true;
        }
        const col = who.color || [180, 190, 210];
        ctx.strokeStyle = rgba(col, who === ui.selected ? 0.75 : e < 1 ? (b._fastOrbit ? 0.5 : 0.32) : 0.2);
        ctx.stroke(path);
      }
    }
  }

  drawTrails() {
    const { ctx, cam } = this;
    const G = this.g, p = this.tmp;
    const rel = this.settings.trailsRelative && cam.follow ? this.trails.get(cam.follow) : null;
    const f = cam.follow;
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = 1.3 * this.dpr;
    ctx.lineJoin = 'round';
    const CH = 6;
    // With crowded scenes, only the heaviest bodies (plus the selection) keep a trail.
    let list = this.world.bodies;
    // Optional colour coding (like Universe Sandbox): orbital speed or surface temperature.
    const mode = this.settings.trailColor || 'body';
    const hier = mode === 'velocity' ? this.world.hierarchy() : null;
    const colorOf = (b) => {
      if (mode === 'velocity') {
        const par = hier.get(b)?.parent;
        const v = Math.hypot(b.vx - (par ? par.vx : 0), b.vy - (par ? par.vy : 0), b.vz - (par ? par.vz : 0)) / 0.2108; // km/s
        // 0.3 km/s (slow, blue) to 100 km/s (fast, red), log scale.
        return heatRamp(Math.log10(Math.max(v, 0.3) / 0.3) / Math.log10(100 / 0.3));
      }
      if (mode === 'temperature') {
        const T = b.th ? b.th.Ts : b.temp || 0;
        return heatRamp(T > 0 ? Math.log10(Math.max(T, 30) / 30) / Math.log10(3000 / 30) : 0);
      }
      return b.kind === 'bh' ? [255, 160, 90] : b.color || [200, 200, 200];
    };
    if (list.length > 80) list = list.slice().sort((a, b) => b.m - a.m).slice(0, 80).concat(this.selected ? [this.selected] : []);
    for (const b of list) {
      const t = this.trails.get(b);
      if (!t || b === f) continue;
      let g0 = Math.max(t.start, G - TRAIL_LEN + 1);
      if (rel) g0 = Math.max(g0, rel.start);
      if (G - g0 < 2) continue;
      const col = colorOf(b);
      const span = G - g0;
      for (let c = 0; c < CH; c++) {
        const ga = g0 + Math.floor((span * c) / CH), gb = g0 + Math.floor((span * (c + 1)) / CH);
        const path = new Path2D();
        let pen = false;
        for (let g = ga; g <= gb; g++) {
          const o = (g % TRAIL_LEN) * 3;
          let x = t.buf[o], y = t.buf[o + 1], z = t.buf[o + 2];
          if (rel) { x += f.x - rel.buf[o]; y += f.y - rel.buf[o + 1]; z += f.z - rel.buf[o + 2]; }
          if (cam.project(x, y, z, p) <= 0) { pen = false; continue; }
          if (pen) path.lineTo(p.x, p.y); else path.moveTo(p.x, p.y);
          pen = true;
        }
        if (c === CH - 1 && pen && cam.project(b.x, b.y, b.z, p) > 0) path.lineTo(p.x, p.y);
        ctx.strokeStyle = rgba(col, 0.06 + 0.5 * ((c + 1) / CH) ** 2);
        ctx.stroke(path);
      }
    }
  }

  drawParticles() {
    const { ctx, cam, world } = this;
    const W = this.canvas.width, H = this.canvas.height, p = this.tmp;
    this.front = null;
    if (world.np === 0 && world.nr === 0) return;
    const paths = {};
    for (const k in PARTICLE_RGB) paths[k] = new Path2D();
    const sz = 1.3 * this.dpr;
    const px = world.px, py = world.py, pz = world.pz, pk = world.pk;
    for (let i = 0; i < world.np; i++) {
      if (cam.project(px[i], py[i], pz[i], p) <= 0) continue;
      if (p.x < -2 || p.y < -2 || p.x > W || p.y > H) continue;
      paths[pk[i]].rect(p.x, p.y, sz, sz);
    }
    // Ring particles on the near side of their planet are drawn after the planet.
    const r6 = [0, 0, 0, 0, 0, 0];
    const hostDepth = new Map();
    this.front = {};
    for (let i = 0; i < world.nr; i++) {
      world.ringPosition(i, r6);
      const z = cam.project(r6[0], r6[1], r6[2], p);
      if (z <= 0) continue;
      if (p.x < -2 || p.y < -2 || p.x > W || p.y > H) continue;
      const h = world.rHost[i];
      let hz = hostDepth.get(h);
      if (hz === undefined) { hz = cam.project(h.x, h.y, h.z, this.tmp2); hostDepth.set(h, hz); }
      const k = world.rk[i];
      if (z < hz) (this.front[k] ||= new Path2D()).rect(p.x, p.y, sz, sz);
      else paths[k].rect(p.x, p.y, sz, sz);
    }
    ctx.globalCompositeOperation = 'lighter';
    for (const k in paths) {
      ctx.fillStyle = rgba(PARTICLE_RGB[k], k == PK.STAR_BLUE || k == PK.STAR_GOLD ? 0.55 : 0.75);
      ctx.fill(paths[k]);
    }
  }

  drawFrontRings() {
    if (!this.front) return;
    this.ctx.globalCompositeOperation = 'lighter';
    for (const k in this.front) {
      this.ctx.fillStyle = rgba(PARTICLE_RGB[k], 0.75);
      this.ctx.fill(this.front[k]);
    }
  }

  // Strongest light source for a body, as a camera-space unit vector.
  lightFor(b) {
    let best = null, bf = 0;
    for (const s of this.world.bodies) {
      if (s === b || !isLuminous(s)) continue;
      const d2 = (s.x - b.x) ** 2 + (s.y - b.y) ** 2 + (s.z - b.z) ** 2;
      const f = s.lum / d2;
      if (f > bf) { bf = f; best = s; }
    }
    if (!best) return null;
    const dx = best.x - b.x, dy = best.y - b.y, dz = best.z - b.z;
    const l = Math.hypot(dx, dy, dz);
    return this.cam.dirToCam(dx / l, dy / l, dz / l, { x: 0, y: 0, z: 0 });
  }

  drawBodies(now, ui) {
    const { ctx, cam, world, dpr } = this;
    const list = [];
    this.screen.clear();
    for (const b of world.bodies) {
      const p = { x: 0, y: 0, s: 0 };
      const z = cam.project(b.x, b.y, b.z, p);
      if (z <= 0) continue;
      list.push([z, b, p]);
    }
    list.sort((a, b) => b[0] - a[0]);
    // Projected world-up, used to orient gas-giant bands and accretion disks.
    const up = cam.dirToCam(0, 1, 0, { x: 0, y: 0, z: 0 });
    const upAng = Math.atan2(-up.y, up.x);
    for (const [z, b, p] of list) {
      const R = b.r * p.s;
      let shown = R;
      if (ui.surface && ui.surface.body === b) continue; // the ground we are standing on
      if (this.overlay) {
        shown = shownRadius(b, p, dpr, this.settings.trueSize);
        if (b.comet) this.drawCometTail(b, p);
      } else switch (b.kind) {
        case 'star': case 'wd': case 'ns': shown = this.drawStar(b, p, R, now); break;
        case 'bh': shown = this.drawBlackHole(b, p, R, up, upAng); break;
        case 'core': shown = this.drawCore(b, p); break;
        default:
          if (b.comet) this.drawCometTail(b, p);
          shown = this.drawPlanet(b, p, R, upAng);
      }
      this.screen.set(b, { x: p.x, y: p.y, r: shown, z, R });
      if (this.settings.trueSize && shown < 2 * dpr && (b.kind === 'rocky' || b.kind === 'gas')) {
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = 'rgba(200,215,255,0.35)';
        ctx.lineWidth = dpr;
        ctx.beginPath(); ctx.arc(p.x, p.y, 6 * dpr, 0, Math.PI * 2); ctx.stroke();
      }
      if (!this.photo && (b === ui.selected || b === cam.follow)) {
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = b === ui.selected ? 'rgba(255,190,90,0.95)' : 'rgba(150,180,255,0.55)';
        ctx.lineWidth = 1.5 * dpr;
        ctx.setLineDash(b === ui.selected ? [4 * dpr, 4 * dpr] : []);
        ctx.lineDashOffset = -now / 60;
        ctx.beginPath();
        ctx.arc(p.x, p.y, shown + 7 * dpr, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  drawStar(b, p, R, now) {
    const { ctx, dpr } = this;
    const c = b.color;
    const L = Math.max(b.lum, 1e-4);
    const glow = Math.max(R * 3.2, (6 + 4.5 * Math.log10(1 + L * 10)) * dpr);
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, glow);
    g.addColorStop(0, rgba(lighten(c, 0.8), 1));
    g.addColorStop(0.12, rgba(lighten(c, 0.3), 0.7));
    g.addColorStop(0.35, rgba(c, 0.18));
    g.addColorStop(1, rgba(c, 0));
    ctx.fillStyle = g;
    ctx.fillRect(p.x - glow, p.y - glow, glow * 2, glow * 2);
    // Faint diffraction spikes.
    if (R < glow * 0.3) {
      ctx.strokeStyle = rgba(lighten(c, 0.5), 0.22);
      ctx.lineWidth = dpr;
      ctx.beginPath();
      const sl = glow * 1.5;
      ctx.moveTo(p.x - sl, p.y); ctx.lineTo(p.x + sl, p.y);
      ctx.moveTo(p.x, p.y - sl); ctx.lineTo(p.x, p.y + sl);
      ctx.stroke();
    }
    if (b.kind === 'ns') {
      const a = now * 0.004;
      ctx.strokeStyle = 'rgba(170,210,255,0.35)';
      ctx.lineWidth = 2 * dpr;
      ctx.beginPath();
      const bl = glow * 2.4;
      ctx.moveTo(p.x - Math.cos(a) * bl, p.y - Math.sin(a) * bl * 0.4);
      ctx.lineTo(p.x + Math.cos(a) * bl, p.y + Math.sin(a) * bl * 0.4);
      ctx.stroke();
    }
    if (R > 1.5) {
      ctx.globalCompositeOperation = 'source-over';
      const d = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, R);
      d.addColorStop(0, rgba(lighten(c, 0.85), 1));
      d.addColorStop(0.75, rgba(lighten(c, 0.35), 1));
      d.addColorStop(1, rgba(mix(c, 0.85), 1));
      ctx.fillStyle = d;
      ctx.beginPath(); ctx.arc(p.x, p.y, R, 0, Math.PI * 2); ctx.fill();
    }
    return Math.max(R, 3 * dpr);
  }

  drawBlackHole(b, p, R, up, upAng) {
    const { ctx, dpr } = this;
    const shadow = Math.max(R * 2.6, 4.5 * dpr);
    const heat = Math.min(1, b.heat);
    ctx.globalCompositeOperation = 'lighter';
    // Accretion disk seen at the angle between the view and the disk's axis.
    const tilt = Math.max(0.12, Math.abs(up.z));
    const outer = shadow * 3.4, inner = shadow * 1.25;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(upAng + Math.PI / 2);
    ctx.scale(1, tilt);
    const g = ctx.createRadialGradient(0, 0, inner, 0, 0, outer);
    g.addColorStop(0, `rgba(255,236,200,${0.35 + 0.6 * heat})`);
    g.addColorStop(0.3, `rgba(255,150,70,${0.18 + 0.5 * heat})`);
    g.addColorStop(1, 'rgba(160,50,20,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, outer, 0, Math.PI * 2); ctx.arc(0, 0, inner, 0, Math.PI * 2, true); ctx.fill();
    ctx.restore();
    // Lensed glow and photon ring.
    const halo = ctx.createRadialGradient(p.x, p.y, shadow * 0.9, p.x, p.y, shadow * 1.9);
    halo.addColorStop(0, `rgba(255,190,120,${0.55 + 0.4 * heat})`);
    halo.addColorStop(1, 'rgba(255,120,60,0)');
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(p.x, p.y, shadow * 1.9, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.arc(p.x, p.y, shadow, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = `rgba(255,214,160,${0.7 + 0.3 * heat})`;
    ctx.lineWidth = Math.max(1, shadow * 0.08);
    ctx.beginPath(); ctx.arc(p.x, p.y, shadow, 0, Math.PI * 2); ctx.stroke();
    return shadow;
  }

  drawCore(b, p) {
    const { ctx, dpr } = this;
    const R = Math.max(b.soft * p.s * 0.9, 6 * dpr);
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, R);
    g.addColorStop(0, rgba(lighten(b.color, 0.7), 0.95));
    g.addColorStop(0.2, rgba(b.color, 0.35));
    g.addColorStop(1, rgba(b.color, 0));
    ctx.fillStyle = g;
    ctx.fillRect(p.x - R, p.y - R, R * 2, R * 2);
    return Math.min(R * 0.3, 14 * dpr);
  }

  drawPlanet(b, p, R, upAng) {
    const { ctx, dpr } = this;
    const c = b.color || [180, 180, 180];
    const light = this.lightFor(b);
    // Glow from the thermal model (molten surfaces) or a fresh impact flash.
    const heat = Math.min(1, Math.max(b.heat, b.th ? (b.th.Ts - 800) / 1500 : 0));
    if (R < 1.6 * dpr) {
      // Too small to resolve: a dot, dimmed on the night side.
      const lit = light ? 0.35 + 0.65 * (0.5 - 0.5 * light.z) : 0.5;
      const s = (b.m > 1e-7 ? 2.4 : 1.6) * dpr;
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = rgba(lighten(mix(c, lit), 0.15), 1);
      ctx.beginPath(); ctx.arc(p.x, p.y, s, 0, Math.PI * 2); ctx.fill();
      if (heat > 0.03) this.heatGlow(p, s * 2.5, heat);
      return s;
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.save();
    ctx.beginPath(); ctx.arc(p.x, p.y, R, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = rgba(c, 1);
    ctx.fillRect(p.x - R, p.y - R, R * 2, R * 2);
    if (b.band && R > 3 * dpr) {
      ctx.translate(p.x, p.y);
      ctx.rotate(upAng + Math.PI / 2);
      ctx.fillStyle = rgba(b.band, 0.55);
      const bands = [-0.62, -0.38, -0.12, 0.2, 0.45, 0.7];
      bands.forEach((y, k) => ctx.fillRect(-R, y * R, R * 2, R * (0.08 + 0.05 * ((k * 7 + b.id) % 3))));
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    } else if (b.kind === 'rocky' && R > 3 * dpr) {
      // A few darker maria/continents, fixed per body.
      ctx.fillStyle = rgba(mix(c, 0.78), 0.8);
      for (let k = 0; k < 5; k++) {
        const a = b.id * 2.3 + k * 1.9, rr = 0.18 + ((b.id * 13 + k * 7) % 10) / 40;
        ctx.beginPath();
        ctx.arc(p.x + Math.cos(a) * R * 0.5, p.y + Math.sin(a * 1.3) * R * 0.45, R * rr, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // Day/night shading from the dominant star.
    let lx = 0, ly = 0, lz = -1;
    if (light) { lx = light.x; ly = -light.y; lz = light.z; }
    const cx = p.x + lx * R, cy = p.y + ly * R;
    const reach = R * (0.35 + 1.65 * (0.5 - 0.5 * lz));
    const sh = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(reach, 1));
    if (light) {
      sh.addColorStop(0, 'rgba(255,255,255,0.12)');
      sh.addColorStop(0.55, 'rgba(0,0,0,0.05)');
      sh.addColorStop(1, 'rgba(2,3,8,0.94)');
    } else {
      sh.addColorStop(0, 'rgba(0,0,0,0.5)');
      sh.addColorStop(1, 'rgba(0,0,0,0.85)');
    }
    ctx.fillStyle = sh;
    ctx.fillRect(p.x - R, p.y - R, R * 2, R * 2);
    ctx.restore();
    if (b.atmo) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = rgba(b.atmo, 0.28);
      ctx.lineWidth = Math.max(1, R * 0.07);
      ctx.beginPath(); ctx.arc(p.x, p.y, R * 1.02, 0, Math.PI * 2); ctx.stroke();
    }
    if (heat > 0.03) this.heatGlow(p, R * 1.6, heat);
    return R;
  }

  // Comet coma and tails. Ice starts sublimating inside a few AU of a star; both tails point away from it,
  // the blue ion tail straight down-sun, the dust tail curving back along the orbit.
  drawCometTail(b, p) {
    let star = null, best = 0;
    for (const s of this.world.bodies) {
      if (!isLuminous(s)) continue;
      const f = s.lum / ((s.x - b.x) ** 2 + (s.y - b.y) ** 2 + (s.z - b.z) ** 2);
      if (f > best) { best = f; star = s; }
    }
    if (!star) return;
    const dx = b.x - star.x, dy = b.y - star.y, dz = b.z - star.z;
    const d = Math.hypot(dx, dy, dz);
    const reach = 5 * Math.sqrt(Math.max(star.lum, 1e-3)); // AU at which activity starts, scaled by brightness
    if (d > reach) return;
    const act = Math.min(1, (reach - d) / (reach * 0.6));
    const L = Math.min(1.2, (0.35 * reach) / Math.max(d, 0.05)) * act; // tail length in AU
    const ux = dx / d, uy = dy / d, uz = dz / d;
    let vx = b.vx - star.vx, vy = b.vy - star.vy, vz = b.vz - star.vz;
    const vl = Math.hypot(vx, vy, vz) || 1;
    vx /= vl; vy /= vl; vz /= vl;
    const { ctx, cam, dpr } = this;
    const tip = { x: 0, y: 0, s: 0 };
    ctx.globalCompositeOperation = 'lighter';
    const tails = [
      [ux, uy, uz, [150, 196, 255], 0.55, 1.0],
      [ux * 0.8 - vx * 0.45, uy * 0.8 - vy * 0.45, uz * 0.8 - vz * 0.45, [255, 238, 210], 0.45, 0.7],
    ];
    for (const [tx, ty, tz, col, alpha, len] of tails) {
      const tl = Math.hypot(tx, ty, tz) || 1;
      if (cam.project(b.x + (tx / tl) * L * len, b.y + (ty / tl) * L * len, b.z + (tz / tl) * L * len, tip) <= 0) continue;
      const ex = tip.x - p.x, ey = tip.y - p.y;
      const el = Math.hypot(ex, ey);
      if (el < 2) continue;
      const nx = -ey / el, ny = ex / el;
      const w0 = 1.5 * dpr, w1 = Math.max(3 * dpr, el * 0.12);
      const g = ctx.createLinearGradient(p.x, p.y, tip.x, tip.y);
      g.addColorStop(0, rgba(col, alpha * act * Math.min(1, (500 * dpr) / el)));
      g.addColorStop(1, rgba(col, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(p.x + nx * w0, p.y + ny * w0);
      ctx.lineTo(tip.x + nx * w1, tip.y + ny * w1);
      ctx.lineTo(tip.x - nx * w1, tip.y - ny * w1);
      ctx.lineTo(p.x - nx * w0, p.y - ny * w0);
      ctx.closePath();
      ctx.fill();
    }
    // Up close the coma surrounds the camera; fade it so it doesn't wash out the view.
    const cr = Math.max(4 * dpr, 0.01 * L * p.s);
    const near = Math.min(1, (60 * dpr) / cr);
    const coma = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, cr * 2.5);
    coma.addColorStop(0, rgba([235, 245, 255], 0.9 * act * near));
    coma.addColorStop(1, rgba([150, 200, 255], 0));
    ctx.fillStyle = coma;
    ctx.fillRect(p.x - cr * 2.5, p.y - cr * 2.5, cr * 5, cr * 5);
  }

  heatGlow(p, R, heat) {
    const ctx = this.ctx;
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, R);
    g.addColorStop(0, `rgba(255,200,120,${0.85 * heat})`);
    g.addColorStop(0.5, `rgba(255,90,30,${0.5 * heat})`);
    g.addColorStop(1, 'rgba(200,40,10,0)');
    ctx.fillStyle = g;
    ctx.fillRect(p.x - R, p.y - R, R * 2, R * 2);
  }

  drawFlashes(now) {
    const { ctx, cam, world, dpr } = this;
    const p = this.tmp;
    world.flashes = world.flashes.filter((f) => now - f.born < f.life);
    ctx.globalCompositeOperation = 'lighter';
    for (const f of world.flashes) {
      if (cam.project(f.x, f.y, f.z, p) <= 0) continue;
      const k = Math.max(0, (now - f.born) / f.life);
      const R = Math.max(f.r * p.s, 14 * dpr) * (0.6 + 2.2 * Math.sqrt(k));
      const a = (1 - k) * (1 - k);
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, R);
      g.addColorStop(0, rgba([255, 250, 240], a));
      g.addColorStop(0.25, rgba(f.color, a * 0.6));
      g.addColorStop(1, rgba(f.color, 0));
      ctx.fillStyle = g;
      ctx.fillRect(p.x - R, p.y - R, R * 2, R * 2);
    }
  }

  drawPreview(pv) {
    const { ctx, cam, dpr } = this;
    const p = this.tmp;
    ctx.globalCompositeOperation = 'source-over';
    if (pv.path && pv.path.length > 3) {
      const path = new Path2D();
      let pen = false;
      for (let i = 0; i < pv.path.length; i += 3) {
        if (cam.project(pv.path[i], pv.path[i + 1], pv.path[i + 2], p) <= 0) { pen = false; continue; }
        if (pen) path.lineTo(p.x, p.y); else path.moveTo(p.x, p.y);
        pen = true;
      }
      ctx.strokeStyle = pv.bound ? 'rgba(255,190,90,0.85)' : 'rgba(255,120,90,0.85)';
      ctx.lineWidth = 1.5 * dpr;
      ctx.setLineDash([5 * dpr, 5 * dpr]);
      ctx.stroke(path);
      ctx.setLineDash([]);
      if (pv.hit) {
        const n = pv.path.length - 3;
        if (cam.project(pv.path[n], pv.path[n + 1], pv.path[n + 2], p) > 0) {
          ctx.strokeStyle = 'rgba(255,110,80,0.95)';
          ctx.lineWidth = 2 * dpr;
          const s = 6 * dpr;
          ctx.beginPath();
          ctx.moveTo(p.x - s, p.y - s); ctx.lineTo(p.x + s, p.y + s);
          ctx.moveTo(p.x + s, p.y - s); ctx.lineTo(p.x - s, p.y + s);
          ctx.stroke();
        }
      }
    }
    if (cam.project(pv.x, pv.y, pv.z, p) > 0) {
      ctx.strokeStyle = 'rgba(255,190,90,0.95)';
      ctx.fillStyle = 'rgba(255,190,90,0.25)';
      ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath(); ctx.arc(p.x, p.y, 9 * dpr, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      if (pv.dragTo) {
        const [ex, ey] = pv.dragTo;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(ex, ey); ctx.stroke();
        const a = Math.atan2(ey - p.y, ex - p.x), h = 10 * dpr;
        ctx.beginPath();
        ctx.moveTo(ex, ey);
        ctx.lineTo(ex - Math.cos(a - 0.4) * h, ey - Math.sin(a - 0.4) * h);
        ctx.moveTo(ex, ey);
        ctx.lineTo(ex - Math.cos(a + 0.4) * h, ey - Math.sin(a + 0.4) * h);
        ctx.stroke();
      }
    }
  }

  drawLabels(ui) {
    const { ctx, dpr } = this;
    const fs = 11 * dpr;
    ctx.globalCompositeOperation = 'source-over';
    ctx.font = `600 ${fs}px "Saira Semi Condensed", "Avenir Next Condensed", system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    const cell = 28 * dpr;
    const used = new Set();
    const entries = [...this.screen.entries()].sort((a, b) => {
      const pa = a[0] === ui.selected || a[0] === this.cam.follow ? 1 : 0;
      const pb = b[0] === ui.selected || b[0] === this.cam.follow ? 1 : 0;
      return pb - pa || b[0].m - a[0].m;
    });
    // Discs big enough to hide something behind them (a moon behind Saturn has no label showing through it).
    const discs = entries.filter(([, p]) => p.R > 6 * dpr);
    const hidden = (b, p) => discs.some(([c, q]) => c !== b && q.z < p.z && Math.hypot(p.x - q.x, p.y - q.y) < q.R * 0.98);
    let n = 0;
    for (const [b, p] of entries) {
      if (n > 40) break;
      if (b !== ui.selected && hidden(b, p)) continue;
      if (b.name.startsWith('Planetesimal') && b !== ui.selected) continue;
      const key = Math.floor(p.x / (cell * 3)) + ',' + Math.floor(p.y / cell);
      if (used.has(key) && b !== ui.selected) continue;
      used.add(key);
      n++;
      const x = p.x + p.r + 6 * dpr, y = p.y;
      ctx.fillStyle = 'rgba(3,5,12,0.7)';
      ctx.fillText(b.name, x + dpr, y + dpr);
      ctx.fillStyle = b === ui.selected ? 'rgba(255,200,120,1)' : 'rgba(222,228,242,0.82)';
      ctx.fillText(b.name, x, y);
    }
  }
}
