import { G, EARTH_MASS, km } from './units.js';
import { World, circularSpeed, captureRadius, PK } from './physics.js';
import { makeBody, catalogItem, reclassify } from './bodies.js';
import { thermalStep, localTemp } from './thermal.js';
import { PRESETS, ring } from './presets.js';
import { lifetime } from './stellar.js';
import { Camera } from './camera.js';
import { Renderer } from './render.js';
import { Renderer3D } from './render3d.js';
import { Input } from './input.js';
import { UI } from './ui.js';

const SETTINGS_KEY = 'universe-pocket-settings';

function loadSettings() {
  const defaults = { trails: true, labels: true, grid: true, stars: true, trailsRelative: true, collisions: true, view: 'realistic', bloom: true, trailColor: 'body', orbits: false, trueSize: false };
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
  } catch {
    return defaults;
  }
}

class App {
  constructor() {
    this.canvas = document.getElementById('view');
    this.world = new World();
    this.cam = new Camera();
    this.settings = loadSettings();
    this.renderer = new Renderer(this.canvas, this.world, this.cam, this.settings);
    this.zones = new Set(); // heat sources showing their temperature zones
    this.state = { tool: 'view', addItem: 'earth', selected: null, paused: false, speed: 0.1, preset: null, addMethod: 'orbit' };
    this.adding = null;
    this.rate = 0;
    this.ui = new UI(this);
    this.input = new Input(this.canvas, this);
    this.glCanvas = document.getElementById('gl');
    this.r3d = null;
    window.addEventListener('resize', () => { this.renderer.resize(); this.r3d?.resize(); });
    this.renderer.resize();
    this.setView(this.settings.view, true);
    this.loadPreset('solar');
    this.last = performance.now();
    this.frame = this.frame.bind(this);
    requestAnimationFrame(this.frame);
  }

  // Realistic: WebGL draws the scene and the 2D canvas overlays trails, labels and markers.
  // Classic: the 2D canvas draws everything.
  setView(view, quiet = false) {
    if (this.surface && view === 'classic') this.exitSurface();
    if ((view === 'realistic' || view === 'pixel') && !this.r3d) {
      try {
        this.r3d = new Renderer3D(this.glCanvas, this.world, this.cam, this.settings);
      } catch (err) {
        console.warn(err);
        if (!quiet) this.ui.toast('The Realistic view needs WebGL 2, which this browser does not offer. Using Classic.', true);
        view = 'classic';
      }
    }
    const real = view === 'realistic' || view === 'pixel';
    this.settings.view = view;
    this.renderer.overlay = real;
    this.glCanvas.hidden = !real;
    if (real) this.r3d.resize();
    this.saveSettings();
    this.ui?.onView?.(view);
  }

  // ---------- surface view ----------

  enterSurface(b, where = 'day') {
    if (!this.r3d || !this.renderer.overlay) { this.ui.toast('Switch to the Realistic or Pixel view to stand on a surface.'); return; }
    if (b.kind !== 'rocky') { this.ui.toast(`${b.name} has no solid surface to stand on.`); return; }
    const keep = this.surface ? this.surface.prevSpeed : this.state.speed;
    this.surface = { body: b, where, lat: 0, lon: 0, yaw: 0, pitch: 0.15, place: true, up: [0, 1, 0], sun: [1, 0, 0], sunPower: 0, prevSpeed: keep };
    // Slow time so one local day lasts about two minutes and the Sun can be watched crossing the sky.
    const day = Math.abs(this.r3d.look(b).day || 24) / 8766;
    this.ui.setSpeed(Math.min(keep, day / 120));
    this.cam.follow = b;
    this.select(null);
    this.ui.showSurface(this.surface);
  }

  exitSurface() {
    const b = this.surface && this.surface.body;
    if (this.surface) this.ui.setSpeed(this.surface.prevSpeed);
    this.surface = null;
    this.cam.override = null;
    if (b && b.alive) { this.cam.follow = b; this.cam.dist = this.cam.distGoal = b.r * 6; }
    this.cam.update();
    this.ui.showSurface(null);
  }

  updateSurface() {
    const sv = this.surface;
    const b = this.world.resolve(sv.body);
    if (!b || b.kind !== 'rocky') { this.ui.toast('The ground you were standing on is gone.', true); this.exitSurface(); return; }
    sv.body = b;
    const R = this.r3d.bodyRotation(b); // column-major object -> world
    const toW = (v) => [R[0] * v[0] + R[3] * v[1] + R[6] * v[2], R[1] * v[0] + R[4] * v[1] + R[7] * v[2], R[2] * v[0] + R[5] * v[1] + R[8] * v[2]];
    const toO = (v) => [R[0] * v[0] + R[1] * v[1] + R[2] * v[2], R[3] * v[0] + R[4] * v[1] + R[5] * v[2], R[6] * v[0] + R[7] * v[1] + R[8] * v[2]];
    // Brightest star as seen from here.
    let star = null, best = 0;
    for (const s of this.world.bodies) {
      if (s === b || !(s.lum > 0)) continue;
      const f = s.lum / ((s.x - b.x) ** 2 + (s.y - b.y) ** 2 + (s.z - b.z) ** 2);
      if (f > best) { best = f; star = s; }
    }
    let sun = [1, 0, 0];
    if (star) { const d = Math.hypot(star.x - b.x, star.y - b.y, star.z - b.z); sun = [(star.x - b.x) / d, (star.y - b.y) / d, (star.z - b.z) / d]; }
    if (sv.place) {
      sv.place = false;
      const so = toO(sun);
      if (sv.where === 'north') { sv.lat = 1.3; sv.lon = 0; }
      else if (sv.where === 'south') { sv.lat = -1.3; sv.lon = 0; }
      else {
        const sgn = sv.where === 'night' ? -1 : 1;
        sv.lat = Math.asin(Math.max(-1, Math.min(1, so[1] * sgn)));
        sv.lon = Math.atan2(so[2] * sgn, so[0] * sgn);
        // Face the Sun's side of the sky on the day side, away from it at night.
        sv.yaw = 0;
      }
    }
    const no = [Math.cos(sv.lat) * Math.cos(sv.lon), Math.sin(sv.lat), Math.cos(sv.lat) * Math.sin(sv.lon)];
    const n = toW(no);
    const pole = toW([0, 1, 0]);
    const dp = pole[0] * n[0] + pole[1] * n[1] + pole[2] * n[2];
    let north = [pole[0] - dp * n[0], pole[1] - dp * n[1], pole[2] - dp * n[2]];
    let nl = Math.hypot(...north);
    if (nl < 1e-6) { north = toW([1, 0, 0]); nl = Math.hypot(...north); }
    north = north.map((v) => v / nl);
    const east = [north[1] * n[2] - north[2] * n[1], north[2] * n[0] - north[0] * n[2], north[0] * n[1] - north[1] * n[0]];
    const cp = Math.cos(sv.pitch), sp = Math.sin(sv.pitch), cy = Math.cos(sv.yaw), sy = Math.sin(sv.yaw);
    const f = [0, 1, 2].map((i) => cp * (cy * north[i] + sy * east[i]) + sp * n[i]);
    let r = [f[1] * n[2] - f[2] * n[1], f[2] * n[0] - f[0] * n[2], f[0] * n[1] - f[1] * n[0]];
    const rl = Math.hypot(...r) || 1; r = r.map((v) => v / rl);
    const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
    const h = b.r * 1.0012; // eye a little above the ground
    this.cam.override = { eye: [b.x + n[0] * h, b.y + n[1] * h, b.z + n[2] * h], f, r, u };
    this.cam.dist = this.cam.distGoal = b.r * 0.01;
    sv.up = n; sv.sun = sun; sv.sunPower = star ? 1 : 0; sv.north = north;
    // Local conditions for the readout.
    const th = b.th;
    const elev = Math.asin(Math.max(-1, Math.min(1, sun[0] * n[0] + sun[1] * n[1] + sun[2] * n[2])));
    if (th) {
      sv.localT = localTemp(b, sv.lat, Math.sin(elev));
    }
    sv.elev = elev;
  }

  // Photo mode: hide every control and label for clean screenshots; tap to come back.
  setPhoto(on) {
    this.photo = on;
    document.getElementById('app').classList.toggle('photo', on);
    this.renderer.photo = on;
    if (on) {
      const h = document.getElementById('photo-hint');
      h.classList.remove('fade');
      void h.offsetWidth;
      h.classList.add('fade');
    }
  }

  saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings)); } catch { /* storage unavailable */ }
  }

  loadPreset(id) {
    this.impactSped = false;
    this.zones.clear();
    if (this.surface) this.exitSurface();
    const p = PRESETS.find((x) => x.id === id) || PRESETS[0];
    this.world.reset();
    this.world.collisions = this.settings.collisions;
    p.build(this.world);
    thermalStep(this.world, 0); // every planet starts in climate equilibrium
    this.state.preset = p;
    this.state.selected = null;
    this.state.speed = p.speed;
    this.adding = null;
    this.renderer.resetTrails();
    if (this.r3d) { this.r3d.looks.clear(); this.r3d.spin.clear(); }
    this.resetCamera();
    this.ui.onPreset(p);
  }

  resetCamera() {
    const c = this.state.preset.camera;
    const f = c.follow ? this.world.findByName(c.follow) : null;
    this.cam.follow = f;
    this.cam.trans = null;
    if (f) { this.cam.tx = f.x; this.cam.ty = f.y; this.cam.tz = f.z; } else { this.cam.tx = 0; this.cam.ty = 0; this.cam.tz = 0; }
    this.cam.dist = this.cam.distGoal = c.dist;
    this.cam.pitch = c.pitch;
    this.cam.yaw = c.yaw;
    this.cam.update();
  }

  interacted() {
    this.ui.hideHint();
  }

  select(body) {
    this.state.selected = body;
    this.ui.showInfo(body);
  }

  // Double-tap focuses: follow the body and zoom in until it (and any rings) fill a good part of the view.
  doubleTap(body) {
    if (!body) return;
    this.state.selected = body;
    this.follow(body);
    const frame = body.kind === 'core' ? body.soft * 8 : body.kind === 'bh' ? Math.max(body.r * 40, 0.01) : body.r * 25;
    this.cam.zoomTo(frame);
    this.ui.showInfo(body);
  }

  // The lock button: lock onto the selection (or whatever is nearest the screen centre), or release.
  toggleLock() {
    if (this.cam.follow) {
      const name = this.cam.follow.name;
      this.cam.follow = null;
      this.ui.toast(`Camera unlocked from ${name}. Two fingers now pan freely.`);
      return;
    }
    let target = this.state.selected;
    if (!target) {
      const d = this.renderer.dpr;
      target = this.renderer.pickBody((this.canvas.clientWidth / 2) * d, (this.canvas.clientHeight / 2) * d, 2000);
    }
    if (!target) { this.ui.toast('Nothing to lock onto. Tap an object first.'); return; }
    this.follow(target);
    this.ui.toast(`Camera locked on ${target.name}`);
  }

  follow(body) {
    this.cam.focus(body, performance.now());
    // Frame the body nicely if we are far away from it.
    if (body) {
      const want = Math.max(body.r * 12, body.soft * 6);
      if (body.kind !== 'core' && this.cam.distGoal > want * 4000) this.cam.zoomTo(Math.max(want, this.cam.distGoal / 50));
      else if (this.cam.distGoal < body.r * 3) this.cam.zoomTo(body.r * 6);
    }
  }

  deleteBody(b) {
    if (this.cam.follow === b) this.cam.follow = null;
    if (this.state.selected === b) this.select(null);
    this.zones.delete(b);
    this.world.removeBody(b);
    this.ui.toast(`Removed ${b.name}`);
  }

  // ---------- Laser tool ----------
  // A beam from the camera pours power into the target: it heats (impact-style internal heat in the
  // climate model) and is pushed by radiation pressure, F = P / c.

  laserStart(sx, sy) {
    const d = this.renderer.dpr;
    const body = this.renderer.pickBody(sx * d, sy * d, 44);
    this.laser = { body, sx, sy };
    if (!body) this.ui.toast('Missed: hold on an object');
  }

  laserMove(sx, sy) {
    if (!this.laser) return;
    this.laser.sx = sx; this.laser.sy = sy;
    if (!this.laser.body) {
      const d = this.renderer.dpr;
      this.laser.body = this.renderer.pickBody(sx * d, sy * d, 44);
    }
  }

  laserStop() {
    this.laser = null;
  }

  laserStep(dtYears) {
    const L = this.laser;
    if (!L || !L.body) return;
    const b = this.world.resolve(L.body);
    if (!b || !b.alive) { this.laser = null; return; }
    L.body = b;
    const P = this.laserPower || 1e26;
    const dt = dtYears * 3.15576e7;
    if (dt <= 0) return;
    const mKg = b.m * 1.98847e30;
    if (b.th) {
      b.th.Eint += P * dt;
      const R = b.r * 1.495978707e11, Eb = (0.6 * 6.674e-11 * mKg * mKg) / R;
      if (b.th.Eint > Eb) { this.world.vaporize(b, b.th.Eint - Eb, 'was vaporised by the laser'); this.laser = null; return; }
    }
    // Radiation pressure along the beam (camera forward), m/s converted to AU/yr.
    const dv = ((P / 2.998e8) / mKg) * dt / 4740.47;
    const c = this.cam;
    b.vx += c.fx * dv; b.vy += c.fy * dv; b.vz += c.fz * dv;
    L.firing = true;
  }

  // ---------- Add tool ----------

  addBegin(sx, sy) {
    const d = this.renderer.dpr;
    const P = this.cam.pick(sx * d, sy * d);
    this.adding = { P, sx, sy, cx: sx, cy: sy, dirty: true };
  }

  addMove(sx, sy) {
    if (!this.adding) return;
    this.adding.cx = sx; this.adding.cy = sy; this.adding.dirty = true;
  }

  addCancel() {
    this.adding = null;
  }

  addEnd(sx, sy) {
    if (!this.adding) return;
    this.addMove(sx, sy);
    this.updateAddPreview();
    const a = this.adding;
    this.adding = null;
    const item = catalogItem(this.state.addItem);
    const [x, y, z] = a.P;
    const [vx, vy, vz] = a.v;
    if (item.kind === 'dust') {
      const R = this.cam.dist * 0.05;
      const sp = Math.hypot(vx - (a.parent?.vx || 0), vy - (a.parent?.vy || 0), vz - (a.parent?.vz || 0));
      // A cloud of 0.01 Earth masses (about a sixth of the Moon's) in 600 clumps; it pulls itself together.
      const mEach = (0.01 * EARTH_MASS) / 600;
      for (let k = 0; k < 600; k++) {
        const u = Math.random() * 2 - 1, t = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u), r = R * Math.cbrt(Math.random());
        const j = sp * 0.04;
        this.world.addParticle(x + s * Math.cos(t) * r, y + u * r * 0.3, z + s * Math.sin(t) * r,
          vx + (Math.random() - 0.5) * j, vy + (Math.random() - 0.5) * j, vz + (Math.random() - 0.5) * j, mEach, PK.DUST);
      }
      this.ui.toast('Released a dust cloud');
      return;
    }
    let name;
    if (item.named) {
      // Real objects keep their name (numbered if one is already in the scene).
      name = item.label;
      for (let k = 2; this.world.findByName(name); k++) name = `${item.label} ${k}`;
    }
    const b = makeBody({ kind: item.kind, m: item.m, r: item.r, color: item.color, band: item.band, atmo: item.atmo, comet: item.comet, compKey: item.compKey, name });
    if (item.ageFrac) b.age = lifetime(item.m) * item.ageFrac;
    b.x = x; b.y = y; b.z = z; b.vx = vx; b.vy = vy; b.vz = vz;
    reclassify(b);
    this.world.addBody(b);
    // A new Saturn comes with its rings (A, B and C rings, 74,500-136,800 km, with the Cassini Division).
    if (item.rings) ring(this.world, b, km(74500), km(136800), 6000, 26.7, PK.ICE);
    thermalStep(this.world, 0);
    const where = a.parent ? (a.bound ? ` orbiting ${a.parent.name}` : ` on an escape path from ${a.parent.name}`) : '';
    this.ui.toast(`Added ${b.name}${where}. Tap it for details.`);
  }

  // Velocity from the drag gesture plus a predicted path, integrated against the current (frozen) bodies.
  updateAddPreview() {
    const a = this.adding;
    if (!a || !a.dirty) return;
    a.dirty = false;
    const item = catalogItem(this.state.addItem);
    const m = item.m || 0;
    const [x, y, z] = a.P;
    const hier = this.world.hierarchy();
    const parent = this.world.parentAt(x, y, z, m, null, hier);
    a.parent = parent;
    const drag = Math.hypot(a.cx - a.sx, a.cy - a.sy);
    let vx = parent ? parent.vx : 0, vy = parent ? parent.vy : 0, vz = parent ? parent.vz : 0;
    let rx = 0, ry = 0, rz = 0, d = 0;
    if (parent) { rx = x - parent.x; ry = y - parent.y; rz = z - parent.z; d = Math.hypot(rx, ry, rz); }
    const ref = parent && d > 0 ? circularSpeed(parent, d, m) : (this.cam.dist / Math.max(this.state.speed, 1e-12)) / 6;
    if (drag < 12) {
      if (parent && d > 0 && this.state.addMethod !== 'place') {
        // Tap without dragging: circular orbit, prograde about world "up".
        let tx = rz, tz = -rx;
        const tl = Math.hypot(tx, tz);
        if (tl < 1e-12 * d) { tx = 1; tz = 0; } else { tx /= tl; tz /= tl; }
        vx += tx * ref; vz += tz * ref;
      }
      a.dragTo = null;
    } else {
      const dp = this.renderer.dpr;
      const Q = this.cam.pick(a.cx * dp, a.cy * dp);
      let dx = Q[0] - x, dy = Q[1] - y, dz = Q[2] - z;
      let l = Math.hypot(dx, dy, dz);
      if (!(l > 0)) {
        const sx = a.cx - a.sx, sy = a.cy - a.sy;
        dx = sx * this.cam.rx - sy * this.cam.ux; dy = -sy * this.cam.uy; dz = sx * this.cam.rz - sy * this.cam.uz;
        l = Math.hypot(dx, dy, dz) || 1;
      }
      const short = Math.min(window.innerWidth, window.innerHeight);
      const speed = ref * (drag / (0.3 * short));
      vx += (dx / l) * speed; vy += (dy / l) * speed; vz += (dz / l) * speed;
      a.dragTo = [a.cx * dp, a.cy * dp];
    }
    a.v = [vx, vy, vz];
    this.predict(a, parent, m, item.r || 0);
  }

  predict(a, parent, m, r) {
    const bs = this.world.bodies;
    const px = parent ? parent.x : 0, py = parent ? parent.y : 0, pz = parent ? parent.z : 0;
    const pax = parent ? parent.ax : 0, pay = parent ? parent.ay : 0, paz = parent ? parent.az : 0;
    let x = a.P[0] - px, y = a.P[1] - py, z = a.P[2] - pz;
    let vx = a.v[0] - (parent ? parent.vx : 0), vy = a.v[1] - (parent ? parent.vy : 0), vz = a.v[2] - (parent ? parent.vz : 0);
    let horizon = this.state.speed * 8;
    a.bound = false;
    if (parent) {
      const rr = Math.hypot(x, y, z), v2 = vx * vx + vy * vy + vz * vz;
      const mu = G * (parent.m + m);
      const s2 = parent.soft * parent.soft;
      const eps = v2 / 2 - mu / Math.sqrt(rr * rr + s2);
      if (eps < 0) {
        a.bound = true;
        const sma = -mu / (2 * eps);
        horizon = 2 * Math.PI * Math.sqrt((sma * sma * sma) / mu) * 1.02;
        if (parent.soft > 0) horizon = (2 * Math.PI * rr) / Math.max(Math.sqrt(v2), 1e-30) * 1.05;
      } else {
        horizon = Math.max(horizon, (rr * 6) / Math.sqrt(v2));
      }
    }
    const out = [];
    let t = 0;
    a.hit = false;
    const accel = () => {
      let ax = -pax, ay = -pay, az = -paz, tmin = Infinity;
      for (const b of bs) {
        const dx = b.x - px - x, dy = b.y - py - y, dz = b.z - pz - z;
        const d2 = dx * dx + dy * dy + dz * dz;
        const cr = captureRadius(b) + r;
        if (d2 < cr * cr) return null;
        const s2 = d2 + b.soft * b.soft;
        const dd = Math.sqrt(s2);
        const f = (G * b.m) / (s2 * dd);
        ax += dx * f; ay += dy * f; az += dz * f;
        const tt = (s2 * dd) / (G * b.m);
        if (tt < tmin) tmin = tt;
      }
      return [ax, ay, az, Math.sqrt(tmin)];
    };
    let acc = accel();
    for (let i = 0; i < 1500 && acc && t < horizon; i++) {
      const dt = Math.min(horizon / 160, 0.03 * acc[3]);
      vx += acc[0] * dt * 0.5; vy += acc[1] * dt * 0.5; vz += acc[2] * dt * 0.5;
      x += vx * dt; y += vy * dt; z += vz * dt;
      acc = accel();
      if (!acc) { a.hit = true; out.push(x + px, y + py, z + pz); break; }
      vx += acc[0] * dt * 0.5; vy += acc[1] * dt * 0.5; vz += acc[2] * dt * 0.5;
      t += dt;
      if (i % 2 === 0) out.push(x + px, y + py, z + pz);
    }
    a.path = out;
  }

  // ---------- main loop ----------

  frame(now) {
    requestAnimationFrame(this.frame);
    try {
      this.step(now);
    } catch (err) {
      console.error(err);
    }
  }

  step(now) {
    const dtReal = Math.min(0.25, (now - this.last) / 1000);
    this.last = now;
    const w = this.world;
    let done = 0;
    if (!this.state.paused && dtReal > 0) {
      // Simulated time follows real time even at low frame rates, so the time-speed label stays true.
      const frameDt = Math.min(dtReal, 0.25);
      const want = this.state.speed * frameDt;
      done = w.advance(want, 8);
      this.rate = this.rate * 0.85 + (done / frameDt) * 0.15;
      w.limited = w.limited || this.rate < this.state.speed * 0.9;
      if (done > 0) this.renderer.sampleTrails();
      this.laserStep(done);
    } else {
      w.limited = false;
    }
    const fade = Math.exp(-dtReal / 5);
    for (const b of w.bodies) if (b.heat > 0) b.heat = b.heat < 0.01 ? 0 : b.heat * fade;
    if (this.cam.follow && !this.cam.follow.alive) {
      const lost = this.cam.follow;
      const r = w.resolve(lost);
      this.cam.follow = r;
      if (r) this.ui.toast(`${lost.name} merged into ${r.name}. Camera now locked on ${r.name}.`);
      else this.ui.toast(`${lost.name} was destroyed. Camera unlocked.`, true);
    }
    if (this.state.selected && !this.state.selected.alive) {
      const r = w.resolve(this.state.selected);
      this.select(r);
    }
    while (w.events.length) this.ui.event(w.events.shift());
    // Moon-forming impact: once Theia has hit, speed up so the disk can be watched clumping into the Moon
    // (about two weeks), at a rate where the debris orbits are still followed accurately.
    if (this.state.preset && this.state.preset.id === 'impact' && !this.impactSped && !w.findByName('Theia')) {
      this.impactSped = true;
      if (this.state.speed < 0.5 / 365.25) {
        this.ui.setSpeed(0.5 / 365.25);
        this.ui.toast('Impact! Speeding up to 12 hours per second to watch the debris disk clump into a moon.', true);
      }
    }
    // After a supernova, pull the camera back to keep the expanding shell in view.
    if (this.snZoom && this.cam.follow === this.snZoom.body) {
      const age = w.t - this.snZoom.t0;
      if (age > 0) this.cam.distGoal = Math.max(this.cam.distGoal, Math.min(this.snZoom.limit, 3 * this.snZoom.v * age));
      if (age > 50) this.snZoom = null;
    }
    if (this.surface) this.updateSurface();
    // Surface lock: turn the camera with the locked body's spin so its surface stays put.
    const fb = this.cam.follow;
    if (this.surfaceLock && fb && this.r3d && !this.surface) {
      const sp = this.r3d.spin.get(fb);
      if (sp && this.slBody === fb && this.slAng !== undefined) this.cam.yaw += sp.ang - this.slAng;
      this.slBody = fb; this.slAng = sp ? sp.ang : undefined;
    } else this.slBody = null;
    this.cam.tick(now, dtReal);
    this.updateAddPreview();
    const a = this.adding;
    const preview = a && a.v ? { x: a.P[0], y: a.P[1], z: a.P[2], path: a.path, bound: a.bound, hit: a.hit, dragTo: a.dragTo } : a ? { x: a.P[0], y: a.P[1], z: a.P[2] } : null;
    if (this.zones.size) for (const b of [...this.zones]) {
      const r = this.world.resolve(b);
      this.zones.delete(b);
      if (r && r.alive) this.zones.add(r);
    }
    const ui = { selected: this.state.selected, preview, surface: this.surface, zones: this.zones, laser: this.laser && this.laser.body ? this.laser : null };
    if (this.renderer.overlay) this.r3d.draw(now, ui, dtReal, done);
    this.renderer.draw(now, ui);
    this.ui.tick(now);
  }
}

const start = () => { window.app = new App(); };
if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', start);
else start();

if (!window.__SINGLE_FILE__ && 'serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* offline support unavailable */ });
}
