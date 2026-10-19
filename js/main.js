import { G, EARTH_MASS, km } from './units.js';
import { World, circularSpeed, captureRadius, PK } from './physics.js';
import { makeBody, catalogItem, reclassify } from './bodies.js';
import { thermalStep, localTemp } from './thermal.js';
import { PRESETS, ring } from './presets.js';
import { lifetime } from './stellar.js';
import { Camera } from './camera.js';
import { Renderer } from './render.js';
import { Renderer3D } from './render3d.js';
import { GPULayer } from './gpu.js';
import { GLonGPU } from './glgpu.js';
import { Input } from './input.js';
import { Sound } from './audio.js';
import { UI } from './ui.js';
import { Challenges } from './challenges.js';

const SETTINGS_KEY = 'universe-pocket-settings';

function loadSettings() {
  const defaults = { trails: true, labels: true, grid: true, stars: true, trailsRelative: true, collisions: true, sound: true, music: true, uiSound: true, soundSilent: false, bassBoost: false, sharp: false, perf: false, gpuRings: false, webgpu: false, v: 2, view: 'realistic', bloom: true, flare: true, trailColor: 'body', orbits: false, trueSize: false };
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    // v2: interface sounds were off in v1 while the sound set was being replaced; the new set is on.
    if ((saved.v || 1) < 2) { delete saved.uiSound; saved.v = 2; }
    return { ...defaults, ...saved };
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
    this.gzones = new Set(); // bodies showing their gravity zones
    this.state = { tool: 'view', addItem: 'earth', selected: null, paused: false, speed: 0.1, preset: null, addMethod: 'orbit' };
    this.adding = null;
    this.rate = 0;
    this.audio = new Sound(this.settings);
    this.challenges = new Challenges(this);
    this.ui = new UI(this);
    this.input = new Input(this.canvas, this);
    this.glCanvas = document.getElementById('gl');
    this.r3d = null;
    window.addEventListener('resize', () => { this.renderer.resize(); this.r3d?.resize(); });
    this.renderer.resize();
    this.setView(this.settings.view, true);
    // WebGPU, where the browser offers it: a layer over the WebGL view for compute-heavy effects.
    this.gpu = null;
    // (Not while the WebGPU renderer runs: the ring layer then lives on its device.)
    GPULayer.create(this.glCanvas).then((g) => { if (this.r3d && this.r3d.webgpu) { if (g) g.dispose(); } else this.gpu = g; });
    // If WebGL loses its context while WebGPU runs beside it (seen with some software renderers), give up
    // the WebGPU layer for this session; WebGL then restores and draws the rings itself.
    this.watchGLLoss(this.glCanvas);
    // The WebGPU renderer (beta): the same renderer, drawing through js/glgpu.js.
    if (this.settings.webgpu || window.__TEST_WEBGPU) this.useWebGPU(true);
    this.loadPreset('solar');
    this.last = performance.now();
    this.frame = this.frame.bind(this);
    document.getElementById('perf').addEventListener('click', () => this.startFpsTest());
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
    if (this.gpuCanvas) this.gpuCanvas.hidden = !real || !(this.r3d && this.r3d.webgpu);
    if (real) this.r3d.resize();
    this.saveSettings();
    this.ui?.onView?.(view);
  }

  // Switch the Realistic view between WebGL (the default) and the WebGPU renderer. Both run the same code
  // (render3d.js); WebGPU goes through GLonGPU with the shaders translated ahead of time. Any failure falls
  // back to WebGL and says why.
  // Each switch starts the other renderer afresh: turning WebGPU on releases WebGL's context (memory is
  // tight on phones, and a WebGL context left idle beside WebGPU can be lost), and turning it off destroys
  // the WebGPU device and builds WebGL again on a new canvas (a lost context cannot be had back).
  async useWebGPU(on) {
    if (!on) {
      if (this.r3d && this.r3d.webgpu) {
        const old = this.r3d;
        this.r3d = null;
        if (this.gpuCanvas) this.gpuCanvas.hidden = true;
        this.gpuEmb = null;
        try { old.gl.device.destroy(); } catch (e) { console.warn(e); }
        const dead = document.getElementById('gl'), cv = dead.cloneNode(false);
        dead.replaceWith(cv);
        this.watchGLLoss(cv);
        this.glCanvas = cv;
        this.setView(this.settings.view, true);
        // The ring layer back on its own device, over WebGL.
        if (!this.gpu) GPULayer.create(cv).then((g) => { if (!(this.r3d && this.r3d.webgpu)) this.gpu = g; else if (g) g.dispose(); });
      }
      return;
    }
    if (this.r3d && this.r3d.webgpu) return;
    try {
      if (!navigator.gpu) throw new Error('this browser has no WebGPU');
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (!adapter) throw new Error('no WebGPU adapter');
      const device = await adapter.requestDevice();
      let cv = this.gpuCanvas;
      if (!cv) {
        cv = document.createElement('canvas');
        cv.id = 'glgpu';
        cv.setAttribute('aria-hidden', 'true');
        document.getElementById('gl').insertAdjacentElement('afterend', cv);
        this.gpuCanvas = cv;
      }
      cv.hidden = false;
      const gl = new GLonGPU(device, cv, { offscreen: !!window.__TEST_OFFSCREEN });
      gl.onError = (m) => this.ui.toast('WebGPU reported a problem (Settings shows the details): ' + m, true);
      const r = new Renderer3D(cv, this.world, this.cam, this.settings, gl);
      // The ring layer moves onto this device (one GPU queue instead of two competing for the chip).
      this.gpuEmb = new GPULayer(device, null, null, null, true);
      if (this.gpu) { this.gpu.dispose(); this.gpu = null; }
      const was = this.r3d;
      document.getElementById('gl').hidden = true;
      this.glCanvas = cv;
      this.r3d = r;
      if (was && !was.webgpu) {
        this.releasingGL = true;
        try { const x = was.gl.getExtension('WEBGL_lose_context'); if (x) x.loseContext(); } catch (e) { console.warn(e); }
        this.releasingGL = false;
      }
      cv.hidden = !this.renderer.overlay;   // (Classic view: the 2D canvas draws everything)
      r.resize();
      device.lost.then((info) => { if (this.r3d === r) this.webgpuFailed(info.message || 'device lost'); });
    } catch (err) {
      console.warn(err);
      this.gpuError = String(err.message || err);
      this.ui.toast('WebGPU renderer unavailable: ' + this.gpuError + '. Using WebGL.', true);
      this.settings.webgpu = false; this.saveSettings();
      if (this.gpuCanvas) this.gpuCanvas.hidden = true;
    }
  }

  // ---------- surface view ----------

  enterSurface(b, where = 'day') {
    if (!this.r3d || !this.renderer.overlay) { this.audio.ui('glitch'); this.ui.toast('Switch to the Realistic or Pixel view to stand on a surface.'); return; }
    if (b.kind !== 'rocky') { this.audio.ui('glitch'); this.ui.toast(`${b.name} has no solid surface to stand on.`); return; }
    this.audio.ui('affirm');
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
    if (this.surface) this.audio.ui('click');
    const b = this.surface && this.surface.body;
    if (this.surface) this.ui.setSpeed(this.surface.prevSpeed);
    this.surface = null;
    this.cam.override = null;
    this.setFov((55 * Math.PI) / 180);   // (zoom is for the surface view)
    if (b && b.alive) { this.cam.follow = b; this.cam.dist = this.cam.distGoal = b.r * 6; }
    this.cam.update();
    this.ui.showSurface(null);
  }

  // Field of view (surface view zoom), kept between 2° and 75°.
  setFov(f) {
    const cam = this.cam;
    cam.fov = Math.max((2 * Math.PI) / 180, Math.min((75 * Math.PI) / 180, f));
    cam.setViewport(cam.W, cam.H);
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
    let sunAng = 0.00465, sunTemp = 5772;
    if (star) {
      const d = Math.hypot(star.x - b.x, star.y - b.y, star.z - b.z);
      sun = [(star.x - b.x) / d, (star.y - b.y) / d, (star.z - b.z) / d];
      sunAng = Math.max(0.0012, Math.min(0.6, Math.asin(Math.min(1, star.r / d))));
      sunTemp = star.temp || 5772;
    }
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
      this.nearestLand(b, sv);
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
    const h = b.r + 1.7 / 1.495978707e11; // eye 1.7 m above the ground (the terrain is built around it)
    this.cam.override = { eye: [b.x + n[0] * h, b.y + n[1] * h, b.z + n[2] * h], f, r, u };
    this.cam.dist = this.cam.distGoal = b.r * 0.01;
    sv.up = n; sv.sun = sun; sv.sunPower = star ? 1 : 0; sv.star = star; sv.north = north; sv.sunAng = sunAng; sv.sunTemp = sunTemp;
    // Eclipses: the share of the star's disc a moon or planet covers, seen from here (the overlap of two
    // discs, as angles), dims the sunlight, the sky and the ground; the biggest such body is passed on so the
    // sky draws the star's disc cut by it (a crescent Sun).
    sv.occ = null;
    if (star) {
      const eye = this.cam.override.eye, ds = Math.hypot(star.x - eye[0], star.y - eye[1], star.z - eye[2]);
      let covered = 0;
      for (const o of this.world.bodies) {
        if (o === b || o === star || !o.alive || !(o.r > 0) || o.lum > 0 || o.kind === 'nebula' || o.kind === 'core') continue;
        const ox = o.x - eye[0], oy = o.y - eye[1], oz = o.z - eye[2], d = Math.hypot(ox, oy, oz);
        if (d >= ds || d <= o.r) continue;
        const ang = Math.asin(Math.min(1, o.r / d)), c = Math.acos(Math.max(-1, Math.min(1, (ox * sun[0] + oy * sun[1] + oz * sun[2]) / d)));
        if (c >= ang + sunAng) continue;
        const a = sunAng, bb = ang;
        let A;
        if (c <= Math.abs(a - bb)) A = Math.PI * Math.min(a, bb) ** 2;
        else {
          const k1 = Math.acos(Math.max(-1, Math.min(1, (c * c + a * a - bb * bb) / (2 * c * a)))), k2 = Math.acos(Math.max(-1, Math.min(1, (c * c + bb * bb - a * a) / (2 * c * bb))));
          A = a * a * k1 + bb * bb * k2 - 0.5 * Math.sqrt(Math.max(0, (-c + a + bb) * (c + a - bb) * (c - a + bb) * (c + a + bb)));
        }
        const f = A / (Math.PI * a * a);
        if (f > covered) { covered = f; sv.occ = { dir: [ox / d, oy / d, oz / d], ang }; }
      }
      // (Even at totality the corona and the sky beyond the shadow leave ~1e-4 of the light.)
      sv.sunPower = Math.max(1e-4, 1 - covered);
    }
    // Local conditions for the readout.
    const th = b.th;
    const elev = Math.asin(Math.max(-1, Math.min(1, sun[0] * n[0] + sun[1] * n[1] + sun[2] * n[2])));
    if (th) {
      sv.localT = localTemp(b, sv.lat, Math.sin(elev));
    }
    sv.elev = elev;
  }

  // Photo mode: hide every control and label for clean screenshots; tap to come back.
  // Photo mode hides the interface; labels and the grid start off for a clean shot (restored on exit),
  // and a small toolbar toggles overlays without leaving.
  setPhoto(on) {
    if (on === this.photo) return;
    if (on) {
      this.prePhoto = { labels: this.settings.labels, grid: this.settings.grid };
      this.settings.labels = false; this.settings.grid = false;
    } else if (this.prePhoto) {
      Object.assign(this.settings, this.prePhoto);
    }
    this.photo = on;
    if (on) this.audio.ui('hint');
    this.ui.syncPhotoBar();
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
    if (this.challenges && !this.challenges.starting && this.challenges.active) this.challenges.stop();   // (another scenario ends a challenge)
    this.impactSped = false;
    this.zones.clear();
    this.gzones.clear();
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

  select(body, quiet = false) {
    if (body && !quiet && body !== this.state.selected) this.audio.ui('click');
    this.state.selected = body;
    this.ui.showInfo(body);
  }

  // Double-tap focuses: follow the body and zoom in until it (and any rings) fill a good part of the view.
  doubleTap(body) {
    if (!body) return;
    this.state.selected = body;
    this.follow(body);
    const frame = body.kind === 'core' ? body.soft * 8 : body.kind === 'nebula' ? body.r * 3 : body.kind === 'bh' ? Math.max(body.r * 40, 0.01) : body.r * 25;
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
    if (!target) { this.audio.ui('glitch'); this.ui.toast('Nothing to lock onto. Tap an object first.'); return; }
    this.follow(target);
    this.ui.toast(`Camera locked on ${target.name}`);
  }

  // Rings inside the Roche limit, in the planet's equatorial plane: ice for giants and cold worlds,
  // darker rock for warm rocky planets (as a disrupted moon would leave).
  addRings(b) {
    const tilt = this.r3d.look(b).tilt || 0;
    const icy = b.kind === 'gas' || !b.th || b.th.Ts < 170;
    ring(this.world, b, b.r * (b.kind === 'gas' ? 1.24 : 1.4), b.r * (b.kind === 'gas' ? 2.27 : 2.5), b.kind === 'gas' ? 16000 : 9000, tilt, icy ? PK.ICE : PK.ROCK);
    this.audio.ui('affirm');
    this.ui.toast(`${b.name} now has ${icy ? 'icy' : 'rocky'} rings`);
  }

  follow(body) {
    this.cam.focus(body, performance.now());
    // Frame the body nicely if we are far away from it.
    if (body) {
      const want = Math.max(body.r * 12, body.soft * 6);
      if (body.kind !== 'core' && body.kind !== 'nebula' && this.cam.distGoal > want * 4000) this.cam.zoomTo(Math.max(want, this.cam.distGoal / 50));
      else if (body.kind !== 'nebula' && this.cam.distGoal < body.r * 3) this.cam.zoomTo(body.r * 6);
    }
  }

  deleteBody(b) {
    this.audio.ui('glitch');
    if (this.cam.follow === b) this.cam.follow = null;
    if (this.state.selected === b) this.select(null);
    this.zones.delete(b);
    this.gzones.delete(b);
    this.world.removeBody(b);
    this.ui.toast(`Removed ${b.name}`);
  }

  // ---------- Paint tool ----------
  // Paints into the body's surface map (equirectangular RGBA: R land, G mountains, B ice, A land override).

  paintAt(sx, sy, first) {
    if (!this.r3d) { if (first) { this.audio.ui('glitch'); this.ui.toast('Painting needs the Realistic or Pixel view.'); } return; }
    const d = this.renderer.dpr, cam = this.cam;
    const dir = cam.ray(sx * d, sy * d);
    const E = [cam.tx + cam.ox, cam.ty + cam.oy, cam.tz + cam.oz];
    let hit = null, best = Infinity;
    for (const b of this.world.bodies) {
      if (b.kind !== 'rocky' || !(b.r > 0)) continue;
      const ox = E[0] - b.x, oy = E[1] - b.y, oz = E[2] - b.z;
      const bq = ox * dir[0] + oy * dir[1] + oz * dir[2], c = ox * ox + oy * oy + oz * oz - b.r * b.r;
      const disc = bq * bq - c;
      if (disc < 0) continue;
      const t = -bq - Math.sqrt(disc);
      if (t > 0 && t < best) { best = t; hit = b; }
    }
    if (!hit) { if (first) { this.audio.ui('glitch'); this.ui.toast('Touch a rocky world to paint it'); } return; }
    const b = hit;
    const P = [E[0] + dir[0] * best - b.x, E[1] + dir[1] * best - b.y, E[2] + dir[2] * best - b.z];
    const R = this.r3d.bodyRotation(b); // column-major object -> world; object = Rᵀ · world
    const o = [R[0] * P[0] + R[1] * P[1] + R[2] * P[2], R[3] * P[0] + R[4] * P[1] + R[5] * P[2], R[6] * P[0] + R[7] * P[1] + R[8] * P[2]];
    const ol = Math.hypot(o[0], o[1], o[2]) || 1;
    const lat = Math.asin(Math.max(-1, Math.min(1, o[1] / ol))), lon = Math.atan2(-o[2] / ol, o[0] / ol);
    if (this.brush === 'scorch') {
      // Scorching reuses the impact effects: a glowing, cooling burn scar at that spot.
      const now = performance.now();
      if (first || now - (this.lastScorch || 0) > 90) {
        this.lastScorch = now;
        const n = [P[0] / b.r, P[1] / b.r, P[2] / b.r];
        b.impacts = b.impacts || [];
        b.impacts.push({ x: n[0], y: n[1], z: n[2], e: 0.9, size: (this.brushSize * Math.PI) / 180, t: now });
        if (b.impacts.length > 16) b.impacts.shift();
      }
      return;
    }
    const sm = b.surfaceMap || (b.surfaceMap = { mode: 1, W: 512, H: 256, data: new Uint8Array(512 * 256 * 4), ver: 0 });
    if (sm.mode !== 1) return; // the Moon's albedo map is not paintable
    const W = sm.W, H = sm.H, data = sm.data;
    const rad = (this.brushSize * Math.PI) / 180;
    const y0 = Math.max(0, Math.floor(((Math.PI / 2 - lat - rad) / Math.PI) * H)), y1 = Math.min(H - 1, Math.ceil(((Math.PI / 2 - lat + rad) / Math.PI) * H));
    const sl = Math.sin(lat), cl = Math.cos(lat);
    for (let y = y0; y <= y1; y++) {
      const la = Math.PI / 2 - ((y + 0.5) / H) * Math.PI, sla = Math.sin(la), cla = Math.cos(la);
      for (let x = 0; x < W; x++) {
        const lo = ((x + 0.5) / W) * 2 * Math.PI - Math.PI;
        const cosd = sl * sla + cl * cla * Math.cos(lo - lon);
        const dist = Math.acos(Math.max(-1, Math.min(1, cosd)));
        if (dist > rad) continue;
        const f = 0.35 * (1 - (dist / rad) ** 2); // soft brush, builds up as you drag
        const i = (y * W + x) * 4;
        if (this.brush === 'land') { data[i] = Math.min(255, data[i] + 255 * f * 2); data[i + 3] = Math.min(255, data[i + 3] + 255 * f * 3); }
        else if (this.brush === 'water') { data[i] = Math.max(0, data[i] - 255 * f * 2); data[i + 1] = Math.max(0, data[i + 1] - 255 * f * 2); data[i + 3] = Math.min(255, data[i + 3] + 255 * f * 3); }
        else if (this.brush === 'ice') data[i + 2] = Math.min(255, data[i + 2] + 255 * f * 2);
        else if (this.brush === 'mountain') data[i + 1] = Math.min(255, data[i + 1] + 255 * f);
      }
    }
    sm.dirtyRows = sm.dirtyRows ? [Math.min(sm.dirtyRows[0], y0), Math.max(sm.dirtyRows[1], y1)] : [y0, y1];
    sm.ver++;
  }

  // ---------- Laser tool ----------
  // A beam from the camera pours power into the target: it heats (impact-style internal heat in the
  // climate model) and is pushed by radiation pressure, F = P / c.

  laserStart(sx, sy) {
    const d = this.renderer.dpr;
    const body = this.renderer.pickBody(sx * d, sy * d, 44);
    this.laser = { body, sx, sy };
    if (!body) { this.audio.ui('glitch'); this.ui.toast('Missed: hold on an object'); }
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
      this.audio.ui('sequence');
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
    // A nebula is placed at rest beside whatever it was dropped near, not put in orbit like a planet.
    if (b.kind === 'nebula') { const p = a.parent; b.vx = p ? p.vx : 0; b.vy = p ? p.vy : 0; b.vz = p ? p.vz : 0; }
    reclassify(b);
    this.world.addBody(b);
    // A new Saturn comes with its rings (A, B and C rings, 74,500-136,800 km, with the Cassini Division).
    if (item.rings) ring(this.world, b, km(74500), km(136800), 16000, 26.7, PK.ICE);
    if (this.state.addMethod === 'binary' && b.kind !== 'nebula') {
      // A twin on a mutual circular orbit: separation ~20 radii for planets, ~0.1 AU·√M for stars,
      // kept inside a third of the pair's Hill sphere around whatever they orbit.
      const b2 = makeBody({ kind: item.kind, m: item.m, r: item.r, color: item.color, band: item.band, atmo: item.atmo, comet: item.comet, compKey: item.compKey, name: name ? `${name} B` : undefined });
      if (item.ageFrac) b2.age = b.age;
      let sep = item.kind === 'star' ? 0.1 * Math.sqrt(item.m) : item.kind === 'bh' ? 0.005 : 20 * (b.r || 1e-5);
      if (a.parent) {
        const d = Math.hypot(x - a.parent.x, y - a.parent.y, z - a.parent.z);
        sep = Math.min(sep, (d * Math.cbrt((2 * b.m) / (3 * a.parent.m))) / 3);
      }
      const ux = this.cam.rx, uz = this.cam.rz, ul = Math.hypot(ux, uz) || 1; // horizontal, across the screen
      const dx = (ux / ul) * sep / 2, dz = (uz / ul) * sep / 2;
      const vrel = Math.sqrt((G * 2 * b.m) / sep) / 2;
      const wx = -dz / (sep / 2), wz = dx / (sep / 2); // perpendicular, in the horizontal plane
      b2.x = b.x - dx; b2.y = b.y; b2.z = b.z - dz; b2.vx = b.vx - wx * vrel; b2.vy = b.vy; b2.vz = b.vz - wz * vrel;
      b.x += dx; b.z += dz; b.vx += wx * vrel; b.vz += wz * vrel;
      reclassify(b2);
      this.world.addBody(b2);
    }
    thermalStep(this.world, 0);
    const where = a.parent ? (a.bound ? ` orbiting ${a.parent.name}` : ` on an escape path from ${a.parent.name}`) : '';
    this.audio.ui('sequence');
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

  // On a world with a land map (Earth), move to the nearest land within ~35° so you stand on the ground,
  // not in open ocean. Uses the same map and longitude convention as the shaders.
  nearestLand(b, sv) {
    const sm = b.surfaceMap;
    if (!sm || sm.mode !== 1) return;
    const land = (lat, lon) => {
      const u = (((-lon / (2 * Math.PI) + 0.5) % 1) + 1) % 1, v = 0.5 - lat / Math.PI;
      const x = Math.min(sm.W - 1, Math.floor(u * sm.W)), y = Math.max(0, Math.min(sm.H - 1, Math.floor(v * sm.H)));
      const o = (y * sm.W + x) * 4;
      return sm.data[o + 3] > 127 && sm.data[o] > 175 && sm.data[o + 2] < 128; // land, a little inland, not ice sheet
    };
    if (land(sv.lat, sv.lon)) return;
    const D = Math.PI / 180;
    for (let r = 1; r <= 35; r++) {
      let best = null;
      for (let k = 0; k < 8 * r; k++) {
        const a = (k / (8 * r)) * 2 * Math.PI;
        const lat = sv.lat + r * D * Math.sin(a), lon = sv.lon + (r * D * Math.cos(a)) / Math.max(0.2, Math.cos(sv.lat));
        if (Math.abs(lat) < 1.4 && land(lat, lon)) { best = [lat, lon]; break; }
      }
      if (best) { sv.lat = best[0]; sv.lon = best[1]; return; }
    }
  }

  // The black-hole drone swells as a hole fills more of the view, more so while it is feeding; heavier
  // holes sound deeper.
  blackHoleDrone() {
    const c = this.cam;
    let level = 0, rate = 1;
    for (const b of this.world.bodies) {
      if (b.kind !== 'bh') continue;
      const d = Math.hypot(b.x - c.tx - c.ox, b.y - c.ty - c.oy, b.z - c.tz - c.oz) || 1e-12;
      const ang = (b.r * 40) / d; // the hole with its inner disk
      const l = Math.max(0, Math.min(1, (Math.log10(ang) + 2.5) / 2)) * (0.6 + 0.4 * Math.min(1, b.heat * 3));
      if (l > level) { level = l; rate = Math.max(0.6, Math.min(1.25, 1.1 - 0.12 * Math.log10(b.m / 10))); }
    }
    this.audio.ambient(level, rate);
  }

  // Object ambience: louder the more of the view a world fills (from about 1° across to filling it).
  objectAmbience() {
    const c = this.cam, sv = this.surface;
    let hum = 0, wind = 0, rate = 1;
    if (sv && sv.body) {
      const g = sv.body.atm && sv.body.atm.gases;
      const P = g ? Object.values(g).reduce((s, v) => s + v, 0) : 0; // bar
      if (P > 1e-4) wind = Math.max(0.12, Math.min(1, 0.6 + 0.2 * Math.log10(P)));
      else hum = 0.2;
    } else {
      for (const b of this.world.bodies) {
        if (b.kind !== 'rocky' && b.kind !== 'gas' && b.kind !== 'star' && b.kind !== 'wd' && b.kind !== 'ns') continue;
        const d = Math.hypot(b.x - c.tx - c.ox, b.y - c.ty - c.oy, b.z - c.tz - c.oz) || 1e-12;
        const l = Math.max(0, Math.min(1, (Math.log10(b.r / d) + 1.7) / 1.2));
        if (l <= 0) continue;
        if (b.kind === 'gas' || b.kind === 'star') wind = Math.max(wind, l);
        else if (l > hum) { hum = l; rate = Math.max(0.85, Math.min(1.15, 1 - 0.06 * Math.log10(b.m / 3e-6))); }
      }
    }
    this.audio.nearby(hum, wind, rate);
  }

  // Settings → Show performance: frame rate, and how long physics and drawing take on the CPU each frame.
  // If the frame rate is low while both are small, the graphics chip is the bottleneck.
  perfReadout(now, dtReal, drawMs) {
    const el = document.getElementById('perf');
    if (!this.settings.perf) { if (!el.hidden) el.hidden = true; return; }
    const k = 0.1;
    this.pf = this.pf || { dt: dtReal || 0.016, ph: 0, dr: 0, t: 0 };
    const p = this.pf;
    if (dtReal > 0 && dtReal < 0.5) p.dt += (dtReal - p.dt) * k;
    p.ph += ((this.physMs || 0) - p.ph) * k;
    const pr = this.world.prof || [0, 0, 0, 0];
    p.parts = (p.parts || [0, 0, 0, 0]).map((v, i) => v + (pr[i] - v) * k);
    p.dr += (drawMs - p.dr) * k;
    if (now - p.t < 400) return;
    p.t = now;
    el.hidden = false;
    const ft = this.fpsTest;
    if (ft && ft.phase !== 'done') return;
    if (ft && now < ft.until) {
      const cap = Math.round(ft.empty), ms = ft.full;
      const verdict = cap < 50 ? `the browser holds this page at ${cap} fps even when it draws nothing, so the cap is outside the app`
        : ms > 16.7 ? `the browser allows ${cap} fps, but a frame takes ${ms.toFixed(1)} ms with the GPU (60 fps needs under 16.7)`
        : `the browser allows ${cap} fps and a frame takes ${ms.toFixed(1)} ms with the GPU: 60 fps is possible`;
      el.textContent = `Test: ${verdict}.`;
      return;
    }
    const q = this.r3d && this.renderer.overlay ? ` · res ${Math.round((this.r3d.quality ?? 1) * 100)}%${this.r3d.samples ? ' AA' : ''}` : '';
    const api = this.r3d && this.renderer.overlay ? (this.r3d.webgpu ? ' · WebGPU' : ' · WebGL') : '';
    el.textContent = `${Math.round(1 / p.dt)} fps (tap to test) · physics ${p.ph.toFixed(1)} ms (bodies ${p.parts[0].toFixed(1)}, moons ${p.parts[1].toFixed(1)}, particles ${p.parts[2].toFixed(1)}, other ${p.parts[3].toFixed(1)}) · drawing ${p.dr.toFixed(1)} ms${q}${api} · ${this.world.bodies.length} bodies, ${this.world.np + this.world.nr} particles · build ${window.__BUILD__ || 'dev'}`;
  }

  frame(now) {
    requestAnimationFrame(this.frame);
    const t = this.fpsTest;
    if (t && t.phase === 'empty') {
      // Frame-rate test, part 1: draw nothing, to see what rate the browser itself allows this page.
      t.n++;
      if (now - t.t0 > 2000) { t.empty = (t.n - 1) / ((now - t.t0) / 1000); t.phase = 'full'; t.t0 = now; t.n = 0; t.ms = 0; this.last = now; }
      return;
    }
    try {
      const a = performance.now();
      this.step(now);
      if (t && t.phase === 'full') {
        // Part 2: full frames, waiting for the GPU to finish each one, so the time includes the GPU's work.
        if (this.r3d && this.r3d.gl) this.r3d.gl.finish();
        t.ms += performance.now() - a; t.n++;
        if (now - t.t0 > 2000) {
          t.full = t.ms / Math.max(1, t.n);
          t.phase = 'done'; t.until = now + 12000;
        }
      }
      this.gpuFrameErrors = 0;
      if (this.r3d && this.r3d.webgpu && this.r3d.gl.stalled) this.webgpuFailed('the GPU stopped answering');
    } catch (err) {
      console.error(err);
      // The WebGPU renderer failing frame after frame: say why and go back to WebGL rather than freeze.
      this.gpuFrameErrors = (this.gpuFrameErrors || 0) + 1;
      if (this.r3d && this.r3d.webgpu && this.gpuFrameErrors >= 3) this.webgpuFailed(String(err && err.message || err));
    }
  }

  // If WebGL loses its context while the WebGPU ring layer runs beside it (seen with some software
  // renderers), give up that layer for this session; WebGL then restores and draws the rings itself.
  watchGLLoss(canvas) {
    canvas.addEventListener('webglcontextlost', () => {
      if (this.releasingGL || (this.r3d && this.r3d.webgpu)) return;   // (released on purpose)
      if (this.gpu) { this.gpu.dispose(); this.gpu = null; this.ui.toast('WebGPU was switched off: it clashed with WebGL in this browser.', true); }
    });
  }

  webgpuFailed(why) {
    this.gpuError = 'WebGPU renderer stopped: ' + why;
    this.ui.toast(`The WebGPU renderer stopped (${why}). Back to WebGL; Settings shows the details.`, true);
    this.settings.webgpu = false; this.saveSettings();
    const el = document.getElementById('set-webgpu');
    if (el) el.checked = false;
    this.useWebGPU(false);
  }

  // Tap the performance readout: tells apart a browser cap from the app being too slow.
  startFpsTest() {
    if (this.fpsTest && this.fpsTest.phase !== 'done') return;
    this.fpsTest = { phase: 'empty', t0: performance.now(), n: 0 };
    const el = document.getElementById('perf');
    if (el) el.textContent = 'Testing the frame rate (4 s)…';
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
      const tp = performance.now();
      done = w.advance(want, 8);
      this.physMs = performance.now() - tp;
      this.rate = this.rate * 0.85 + (done / frameDt) * 0.15;
      w.limited = w.limited || this.rate < this.state.speed * 0.9;
      if (done > 0) this.renderer.sampleTrails(done);
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
      this.select(r, true);
    }
    while (w.events.length) { const ev = w.events.shift(); this.audio.event(ev, this.cam); this.ui.event(ev); this.challenges.event(ev); }
    this.challenges.tick(performance.now());
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
    this.blackHoleDrone();
    this.objectAmbience();
    this.updateAddPreview();
    const a = this.adding;
    const preview = a && a.v ? { x: a.P[0], y: a.P[1], z: a.P[2], path: a.path, bound: a.bound, hit: a.hit, dragTo: a.dragTo } : a ? { x: a.P[0], y: a.P[1], z: a.P[2] } : null;
    for (const set of [this.zones, this.gzones]) if (set.size) for (const b of [...set]) {
      const r = this.world.resolve(b);
      set.delete(b);
      if (r && r.alive) set.add(r);
    }
    const ui = { selected: this.state.selected, preview, surface: this.surface, zones: this.zones, gzones: this.gzones, laser: this.laser && this.laser.body ? this.laser : null };
    const tr = performance.now();
    // Rings drawn as GPU debris (Realistic view only; the Pixel view and the surface keep WebGL's). With the
    // WebGPU renderer the ring layer runs inside it (gpuEmb); with WebGL, on its own canvas over it (gpu).
    const emb = this.r3d && this.r3d.webgpu ? this.gpuEmb : null;
    const layer = emb || this.gpu;
    const gpuOn = !!layer && !layer.lost && this.renderer.overlay && this.settings.view === 'realistic' && !this.surface && this.settings.gpuRings;
    const c = this.cam, gpuHosts = gpuOn ? layer.hosts(this.world, [c.tx + c.ox, c.ty + c.oy, c.tz + c.oz]) : null;
    if (this.r3d) {
      this.r3d.gpuHosts = gpuHosts && gpuHosts.size ? gpuHosts : null;
      const r = this.r3d;
      this.r3d.ringHook = gpuOn && emb ? (h) => r.gl.external((enc, t) => emb.drawInto(r, this.world, done, h, enc, t)) : null;
    }
    if (this.renderer.overlay) this.r3d.draw(now, ui, dtReal, done);
    if (this.r3d && this.r3d.webgpu) this.r3d.gl.flushFrame();
    if (this.gpu && !this.gpu.lost) {
      const own = gpuOn && !emb;
      this.gpu.canvas.hidden = !own;
      if (own) this.gpu.draw(this.r3d, this.world, done, gpuHosts);
    }
    this.renderer.draw(now, ui);
    this.perfReadout(now, dtReal, performance.now() - tr);
    this.ui.tick(now);
  }
}

const start = () => { window.app = new App(); };
if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', start);
else start();

if (!window.__SINGLE_FILE__ && 'serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* offline support unavailable */ });
}
