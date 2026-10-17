import { G } from './units.js';
import { World, circularSpeed, captureRadius, PK } from './physics.js';
import { makeBody, catalogItem, reclassify } from './bodies.js';
import { thermalStep } from './thermal.js';
import { PRESETS } from './presets.js';
import { Camera } from './camera.js';
import { Renderer } from './render.js';
import { Renderer3D } from './render3d.js';
import { Input } from './input.js';
import { UI } from './ui.js';

const SETTINGS_KEY = 'universe-pocket-settings';

function loadSettings() {
  const defaults = { trails: true, labels: true, grid: true, stars: true, trailsRelative: true, collisions: true, view: 'realistic', bloom: true };
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
    this.state = { tool: 'view', addItem: 'earth', selected: null, paused: false, speed: 0.1, preset: null };
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
    if (view === 'realistic' && !this.r3d) {
      try {
        this.r3d = new Renderer3D(this.glCanvas, this.world, this.cam, this.settings);
      } catch (err) {
        console.warn(err);
        if (!quiet) this.ui.toast('The Realistic view needs WebGL 2, which this browser does not offer. Using Classic.', true);
        view = 'classic';
      }
    }
    const real = view === 'realistic';
    this.settings.view = view;
    this.renderer.overlay = real;
    this.glCanvas.hidden = !real;
    if (real) this.r3d.resize();
    this.saveSettings();
    this.ui?.onView?.(view);
  }

  saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings)); } catch { /* storage unavailable */ }
  }

  loadPreset(id) {
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
      for (let k = 0; k < 600; k++) {
        const u = Math.random() * 2 - 1, t = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u), r = R * Math.cbrt(Math.random());
        const j = sp * 0.04;
        this.world.addParticle(x + s * Math.cos(t) * r, y + u * r * 0.3, z + s * Math.sin(t) * r,
          vx + (Math.random() - 0.5) * j, vy + (Math.random() - 0.5) * j, vz + (Math.random() - 0.5) * j, 0, PK.DUST);
      }
      this.ui.toast('Released a dust cloud');
      return;
    }
    const b = makeBody({ kind: item.kind, m: item.m, r: item.r, color: item.color, band: item.band, atmo: item.atmo, comet: item.comet, compKey: item.compKey });
    b.x = x; b.y = y; b.z = z; b.vx = vx; b.vy = vy; b.vz = vz;
    reclassify(b);
    this.world.addBody(b);
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
      if (parent && d > 0) {
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
    const dtReal = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const w = this.world;
    let done = 0;
    if (!this.state.paused && dtReal > 0) {
      const want = this.state.speed * Math.min(dtReal, 1 / 20);
      done = w.advance(want, 8);
      this.rate = this.rate * 0.9 + (done / Math.min(dtReal, 1 / 20)) * 0.1;
      if (done > 0) this.renderer.sampleTrails();
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
    this.cam.tick(now, dtReal);
    this.updateAddPreview();
    const a = this.adding;
    const preview = a && a.v ? { x: a.P[0], y: a.P[1], z: a.P[2], path: a.path, bound: a.bound, hit: a.hit, dragTo: a.dragTo } : a ? { x: a.P[0], y: a.P[1], z: a.P[2] } : null;
    const ui = { selected: this.state.selected, preview };
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
