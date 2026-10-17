import { G, formatMass, formatDistance, formatSpeed, formatDuration, formatRate, formatTemp } from './units.js';
import { CATALOG, REAL_OBJECTS, typeName, isLuminous, makeBody, reclassify } from './bodies.js';
import { orbitOf } from './physics.js';
import { PRESETS } from './presets.js';
import { Book } from './book.js';
import { tempZones, localTemp, localHab } from './thermal.js';
import { lifetime } from './stellar.js';
import { renderThumb, category } from './thumbs.js';

// Time-speed slider spans 1 second per second to 300 million years per second (log scale).
const MIN_EXP = Math.log10(1 / 3.15576e7);
const MAX_EXP = Math.log10(3e8);
const toSlider = (yr) => Math.round(((Math.log10(yr) - MIN_EXP) / (MAX_EXP - MIN_EXP)) * 1000);
const fromSlider = (v) => Math.pow(10, MIN_EXP + (v / 1000) * (MAX_EXP - MIN_EXP));

const $ = (id) => document.getElementById(id);

// Speed steps for the « » buttons, in years per second: 1 s/s up to 100 Myr/s.
const MIN_S = 1 / 3.15576e7;
const LADDER = [MIN_S, 10 * MIN_S, 60 * MIN_S, 600 * MIN_S, 1 / 8766, 6 / 8766, 1 / 365.25, 7 / 365.25, 1 / 12, 0.25, 1, 10, 100, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8];

// Colour scales for the surface maps.
const TEMP_STOPS = [[0, [40, 40, 160]], [0.25, [40, 150, 230]], [0.45, [80, 210, 160]], [0.6, [240, 220, 80]], [0.78, [240, 120, 40]], [0.92, [200, 40, 40]], [1, [255, 240, 230]]];
const HAB_STOPS = [[0, [14, 26, 60]], [0.35, [60, 90, 70]], [0.7, [190, 190, 90]], [1, [40, 170, 70]]];
function ramp(stops, t) {
  t = Math.max(0, Math.min(1, t));
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [t0, a] = stops[i - 1], [t1, b] = stops[i], k = (t - t0) / (t1 - t0);
      return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
    }
  }
  return stops[stops.length - 1][1];
}
const gradientCss = (stops) => `linear-gradient(90deg, ${stops.map(([t, c]) => `rgb(${c.map((v) => v | 0)}) ${t * 100}%`).join(', ')})`;

const COMP_COLORS = { iron: '#9a8f86', rock: '#b07a4f', water: '#3f7fd6', ice: '#bfe3ff', gas: '#e6c48d' };
const COMP_NAMES = { iron: 'Iron', rock: 'Rock', water: 'Water', ice: 'Ices', gas: 'H/He gas' };
const GAS_COLORS = { n2: '#7e9bd8', o2: '#7fd6a0', co2: '#e0a060', ch4: '#e07a50', h2: '#d8d0ff', steam: '#f0f0f0' };
const GAS_NAMES = { n2: 'N₂', o2: 'O₂', co2: 'CO₂', ch4: 'CH₄', h2: 'H₂', steam: 'Steam' };
const pct = (f) => (f >= 0.1 ? Math.round(f * 100) : f >= 0.001 ? (f * 100).toPrecision(2) : (f * 100).toExponential(0)) + '%';

// Swatch shown on catalogue chips: a CSS radial gradient approximating the body.
function swatch(item) {
  if (item.kind === 'dust') return 'radial-gradient(circle at 50% 50%, rgba(220,190,150,.9) 0 1px, transparent 2px) 0 0/6px 6px, radial-gradient(circle, rgba(190,160,128,.45), transparent 70%)';
  if (item.kind === 'bh') return 'radial-gradient(circle, #000 0 38%, #ffd7a0 42%, rgba(255,140,60,.55) 52%, transparent 72%)';
  const b = makeBody({ kind: item.kind, m: item.m, r: item.r, color: item.color, band: item.band });
  reclassify(b);
  const [r, g, bl] = b.color;
  if (isLuminous(b)) return `radial-gradient(circle, #fff 0 18%, rgb(${r},${g},${bl}) 40%, rgba(${r},${g},${bl},.25) 60%, transparent 72%)`;
  return `radial-gradient(circle at 35% 35%, rgb(${Math.min(255, r + 50)},${Math.min(255, g + 50)},${Math.min(255, bl + 50)}), rgb(${r},${g},${bl}) 45%, rgb(${r * 0.25 | 0},${g * 0.25 | 0},${bl * 0.25 | 0}) 70%, transparent 71%)`;
}

export class UI {
  constructor(app) {
    this.app = app;
    this.infoT = 0;
    this.toastTimer = 0;
    this.book = new Book(app);
    this.tab = 'overview';
    this.mapMode = 'temp';
    this.buildCreate();
    this.buildScenarios();
    this.bind();
  }

  bind() {
    const app = this.app;
    $('speed').addEventListener('input', (e) => {
      app.state.speed = fromSlider(+e.target.value);
      this.updateSpeedLabel();
    });
    $('btn-play').addEventListener('click', () => this.setPaused(!app.state.paused));
    $('btn-slower').addEventListener('click', () => this.stepSpeed(-1));
    $('btn-faster').addEventListener('click', () => this.stepSpeed(1));
    document.querySelectorAll('[data-tool]').forEach((b) => b.addEventListener('click', () => { this.closeSheets(); this.setTool(b.dataset.tool); }));
    document.querySelectorAll('[data-panel]').forEach((b) => b.addEventListener('click', () => this.togglePanel(b.dataset.panel)));
    $('btn-create').addEventListener('click', () => this.togglePanel('sheet-create'));
    $('add-more').addEventListener('click', () => this.openSheet('sheet-create'));
    $('add-done').addEventListener('click', () => this.setTool('view'));
    $('laser-done').addEventListener('click', () => this.setTool('view'));
    $('laser-power').addEventListener('input', (e) => this.setLaserPower(+e.target.value));
    document.querySelectorAll('[data-method]').forEach((b) => b.addEventListener('click', () => this.setMethod(b.dataset.method)));
    document.querySelectorAll('[data-cat]').forEach((b) => b.addEventListener('click', () => this.filterCreate(b.dataset.cat)));
    document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); this.setTab(b.dataset.tab); }));
    document.querySelectorAll('[data-map]').forEach((b) => b.addEventListener('click', () => { this.mapMode = b.dataset.map; document.querySelectorAll('[data-map]').forEach((x) => x.classList.toggle('on', x === b)); this.mapT = 0; this.refreshInfo(true); }));
    $('btn-home').addEventListener('click', () => { app.resetCamera(); this.closeSheets(); });
    $('btn-lock').addEventListener('click', () => app.toggleLock());
    $('lock-chip').addEventListener('click', () => app.toggleLock());
    $('surf-lock').addEventListener('click', () => { app.surfaceLock = !app.surfaceLock; this.toast(app.surfaceLock ? 'Surface lock on: the camera turns with the planet' : 'Surface lock off'); });
    $('btn-menu2').addEventListener('click', () => this.openSheet('sheet-scenarios'));
    $('i-seed').addEventListener('click', () => {
      const b = app.state.selected;
      if (!b || b.kind !== 'rocky') return;
      b.life = true;
      b.lifeAge = 0; // new life starts out purple (see vegetationColor)
      if (b.th) { b.th.stress = 0; b.th.habTime = 0; }
      const ok = b.th && b.th.hab && b.th.hab.checks[0][1];
      this.toast(ok ? `Seeded simple life on ${b.name}` : `Seeded life on ${b.name}, but without liquid water it will die out within a thousand years`, !ok);
      this.refreshInfo(true);
    });
    $('sea').addEventListener('input', (e) => {
      // Set the water inventory so oceans cover the chosen fraction (coverage ∝ √(water column)).
      const b = app.state.selected;
      if (!b || !b.th || !b.comp) return;
      const f = +e.target.value / 100;
      const AU_M = 1.495978707e11, MSUN = 1.98847e30;
      const R = b.r * AU_M, M = b.m * MSUN, g = (6.674e-11 * M) / (R * R), area = 4 * Math.PI * R * R;
      const Pw = 264 * (f / 0.71) ** 2 + (b.th.steam || 0); // bar
      b.comp.water = (Pw * 1e5 * area) / (g * M);
      $('sea-out').textContent = `${Math.round(f * 100)}% ocean`;
      this.seaT = performance.now();
    });
    $('i-kill').addEventListener('click', () => {
      const b = app.state.selected;
      if (!b) return;
      b.life = false;
      if (b.th) b.th.habTime = 0;
      this.toast(`All life on ${b.name} is gone`);
      this.refreshInfo(true);
    });
    $('i-book').addEventListener('click', (e) => { e.stopPropagation(); if (app.state.selected) this.book.open(app.state.selected); });
    $('btn-book').addEventListener('click', () => this.book.open(app.state.selected));
    $('btn-scenarios').addEventListener('click', () => this.openSheet('sheet-scenarios'));
    document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => this.closeSheets()));
    $('scrim').addEventListener('click', () => this.closeSheets());
    $('i-close').addEventListener('click', (e) => { e.stopPropagation(); app.select(null); });
    document.querySelector('.info-head').addEventListener('click', () => $('info').classList.toggle('collapsed'));
    $('i-follow').addEventListener('click', () => {
      const b = app.state.selected;
      if (!b) return;
      if (app.cam.follow === b) app.toggleLock();
      else { app.follow(b); this.toast(`Camera locked on ${b.name}`); }
      this.refreshInfo(true);
    });
    $('i-death').addEventListener('click', () => {
      const b = app.state.selected;
      if (!b) return;
      app.world.killStar(b);
      if (!b.alive) app.select(null);
      this.refreshInfo(true);
    });
    $('i-half').addEventListener('click', () => this.scaleMass(0.5));
    $('i-double').addEventListener('click', () => this.scaleMass(2));
    $('i-delete').addEventListener('click', () => {
      const b = app.state.selected;
      if (!b) return;
      if (app.cam.follow === b) app.cam.follow = null;
      app.world.removeBody(b);
      app.select(null);
      this.toast(`Removed ${b.name}`);
    });
    $('btn-reset').addEventListener('click', () => { app.loadPreset(app.state.preset.id); this.closeSheets(); });
    $('i-zones').addEventListener('click', () => {
      const b = app.state.selected;
      if (!b) return;
      if (app.zones.has(b)) app.zones.delete(b); else app.zones.add(b);
      this.refreshInfo(true);
    });
    $('i-stand').addEventListener('click', () => { if (app.state.selected) app.enterSurface(app.state.selected, 'day'); });
    $('sv-leave').addEventListener('click', () => app.exitSurface());
    document.querySelectorAll('[data-where]').forEach((btn) => btn.addEventListener('click', () => {
      if (!app.surface) return;
      app.surface.where = btn.dataset.where; app.surface.place = true; app.surface.pitch = 0.15;
      this.showSurface(app.surface);
    }));
    $('btn-photo').addEventListener('click', () => { this.closeSheets(); app.setPhoto(true); });
    $('btn-clear').addEventListener('click', () => { app.world.clearParticles(); this.toast('Cleared all dust and debris'); });
    for (const r of document.querySelectorAll('input[name=view]')) {
      r.addEventListener('change', () => { if (r.checked) { app.setView(r.value); this.toast({ realistic: 'Realistic view', classic: 'Classic view', pixel: 'Pixel view' }[r.value]); } });
    }
    this.onView(app.settings.view);
    for (const key of ['bloom', 'trails', 'labels', 'grid', 'stars', 'trailsRelative', 'collisions', 'orbits', 'trueSize']) {
      const el = $('set-' + key);
      el.checked = !!app.settings[key];
      el.addEventListener('change', () => this.toggleSetting(key, el.checked));
    }
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      if (e.code === 'Space') { e.preventDefault(); this.setPaused(!app.state.paused); }
      if (e.key === 'Escape') { this.closeSheets(); app.select(null); }
      if (e.key === 'a') this.setTool(app.state.tool === 'add' ? 'view' : 'add');
      if (e.key === 'f' || e.key === 'l') app.toggleLock();
      if (e.key === 'p') app.setPhoto(!app.photo);
      if (e.key === 'b' && app.state.selected) this.book.open(app.state.selected);
      if (e.key === ',' || e.key === '.') this.stepSpeed(e.key === '.' ? 1 : -1);
      if ((e.key === 'Delete' || e.key === 'Backspace') && app.state.selected) $('i-delete').click();
    });
    this.setLaserPower(26);
    const tc = (v) => { app.settings.trailColor = v; app.saveSettings(); document.querySelectorAll('[data-tcolor]').forEach((x) => x.classList.toggle('on', x.dataset.tcolor === v)); };
    document.querySelectorAll('[data-tcolor]').forEach((b) => b.addEventListener('click', () => { tc(b.dataset.tcolor); if (!app.settings.trails) this.toggleSetting('trails', true); }));
    tc(app.settings.trailColor || 'body');
    const dockH = () => document.getElementById('app').style.setProperty('--dock-h', document.querySelector('.bar-main').getBoundingClientRect().height + 20 + 'px');
    dockH(); window.addEventListener('resize', dockH);
    $('map-bar').style.background = gradientCss(TEMP_STOPS);
    setTimeout(() => this.hideHint(), 9000);
  }

  buildCreate() {
    const grid = $('create-grid');
    for (const item of [...CATALOG, ...REAL_OBJECTS]) {
      const b = document.createElement('button');
      b.className = 'card';
      b.type = 'button';
      b.id = 'add-' + item.id;
      b.dataset.item = item.id;
      b.dataset.cat = item.real ? 'real' : category(item);
      b.innerHTML = `<span>${item.label}</span>`;
      try {
        const cv = renderThumb({ ...item, id: item.style || item.id }, 128);
        b.prepend(cv);
        item.thumb = cv.toDataURL();
      } catch (e) {
        const sw = document.createElement('i'); sw.className = 'swatch'; sw.style.cssText = `width:64px;height:64px;border-radius:50%;background:${swatch(item)}`; b.prepend(sw);
      }
      b.addEventListener('click', () => { this.setAddItem(item.id); this.closeSheets(); });
      grid.appendChild(b);
    }
    this.setAddItem(this.app.state.addItem, false);
  }

  filterCreate(cat) {
    document.querySelectorAll('[data-cat]').forEach((b) => { if (b.tagName === 'BUTTON' && !b.classList.contains('card')) b.classList.toggle('on', b.dataset.cat === cat); });
    document.querySelectorAll('.card').forEach((c) => { c.hidden = cat !== 'all' && c.dataset.cat !== cat; });
  }

  setMethod(m) {
    this.app.state.addMethod = m;
    document.querySelectorAll('[data-method]').forEach((b) => b.classList.toggle('on', b.dataset.method === m));
    this.toast(m === 'orbit' ? 'Orbit: tap to drop it into a circular orbit' : 'Place: tap to drop it at rest; drag to fling');
  }

  setLaserPower(v) {
    this.app.laserPower = Math.pow(10, v);
    $('laser-power').value = v;
    // Power in watts as mantissa × 10^n, using the SI prefixes Universe Sandbox shows (PW … YW).
    const units = [[24, 'YW'], [21, 'ZW'], [18, 'EW'], [15, 'PW']];
    const u = units.find(([p]) => v >= p && v < p + 3);
    const sup = (n) => String(n).replace(/./g, (c) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[c]);
    $('laser-label').textContent = u ? `${Math.pow(10, v - u[0]).toPrecision(2)} ${u[1]}` : `${Math.pow(10, v - Math.floor(v)).toFixed(1)}×10${sup(Math.floor(v))} W`;
  }

  stepSpeed(dir) {
    const cur = this.app.state.speed;
    let next;
    if (dir > 0) next = LADDER.find((v) => v > cur * 1.01) ?? LADDER[LADDER.length - 1];
    else next = [...LADDER].reverse().find((v) => v < cur * 0.99) ?? LADDER[0];
    this.setSpeed(next);
    if (this.app.state.paused && dir > 0) this.setPaused(false);
  }

  togglePanel(id) {
    if (!$(id).hidden) { this.closeSheets(); return; }
    this.openSheet(id);
  }

  setTab(t) {
    this.tab = t;
    document.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
    document.querySelectorAll('[data-pane]').forEach((p) => { p.hidden = p.dataset.pane !== t; });
    $('info').classList.remove('collapsed');
    this.mapT = 0;
    this.refreshInfo(true);
  }

  buildScenarios() {
    const list = $('scenario-list');
    for (const p of PRESETS) {
      const b = document.createElement('button');
      b.className = 'scenario';
      b.id = 'scn-' + p.id;
      b.innerHTML = `<span class="scn-title">${p.name}</span><span class="scn-blurb">${p.blurb}</span><span class="scn-meta">Starts at ${formatRate(p.speed)}</span>`;
      b.addEventListener('click', () => { this.app.loadPreset(p.id); this.closeSheets(); });
      list.appendChild(b);
    }
  }

  onPreset(p) {
    $('scn-name').textContent = p.name;
    $('speed').value = toSlider(p.speed);
    this.updateSpeedLabel();
    this.showInfo(null);
    document.querySelectorAll('.scenario').forEach((el) => el.classList.toggle('current', el.id === 'scn-' + p.id));
    this.toast(p.blurb);
  }

  showSurface(sv) {
    $('surface-bar').hidden = !sv;
    $('app').classList.toggle('on-surface', !!sv);
    if (!sv) return;
    $('sv-name').textContent = sv.body.name;
    document.querySelectorAll('[data-where]').forEach((b) => b.classList.toggle('on', b.dataset.where === sv.where));
  }

  onView(view) {
    const r = document.getElementById('view-' + view);
    if (r) r.checked = true;
  }

  setPaused(p) {
    this.app.state.paused = p;
    $('btn-play').classList.toggle('paused', p);
    $('btn-play').setAttribute('aria-label', p ? 'Play' : 'Pause');
  }

  setTool(t) {
    const app = this.app;
    if (t === 'surface') {
      const b = app.state.selected;
      if (b && b.kind === 'rocky') app.enterSurface(b, 'day');
      else this.toast('Select a rocky world first, then choose Surface view.');
      t = 'view';
    }
    app.state.tool = t;
    app.laser = null;
    document.querySelectorAll('.tool-card').forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
    $('tray').hidden = t !== 'add';
    $('laserbar').hidden = t !== 'laser';
    $('btn-create').classList.toggle('on', t === 'add');
    if (t === 'add') this.toast(app.state.addMethod === 'place' ? 'Tap to place it at rest. Drag to fling it.' : 'Tap to drop into orbit. Drag to fling it.');
    if (t === 'laser') this.toast('Hold your finger on an object to fire the laser at it.');
    if (t === 'delete') this.toast('Tap objects to delete them. Pick another tool to stop.');
    document.getElementById('app').classList.toggle('tool-delete', t === 'delete');
  }

  setAddItem(id, activate = true) {
    this.app.state.addItem = id;
    document.querySelectorAll('.card').forEach((c) => c.classList.toggle('active', c.dataset.item === id));
    const item = CATALOG.find((c) => c.id === id) || REAL_OBJECTS.find((c) => c.id === id);
    $('add-current').textContent = item.label;
    $('add-swatch').style.background = item.thumb ? `center/cover url(${item.thumb})` : swatch(item);
    if (activate && this.app.state.tool !== 'add') this.setTool('add');
  }

  toggleSetting(key, value) {
    const s = this.app.settings;
    s[key] = value === undefined ? !s[key] : value;
    const el = $('set-' + key);
    if (el) el.checked = s[key];
    if (key === 'collisions') this.app.world.collisions = s.collisions;
    this.app.saveSettings();
  }

  setSpeed(yr) {
    this.app.state.speed = yr;
    $('speed').value = toSlider(yr);
    this.updateSpeedLabel();
  }

  updateSpeedLabel() {
    const t = formatRate(this.app.state.speed);
    $('speed-label').textContent = t;
    $('speed-label2').textContent = t;
  }

  openSheet(id) {
    this.closeSheets();
    $(id).hidden = false;
    // Side panels on wide screens leave the simulation usable; phones get a modal sheet.
    $('scrim').hidden = false;
    $('scrim').classList.toggle('soft', id !== 'sheet-scenarios');
    document.querySelectorAll('[data-panel]').forEach((b) => b.classList.toggle('on', b.dataset.panel === id));
    requestAnimationFrame(() => $(id).classList.add('open'));
  }

  closeSheets() {
    document.querySelectorAll('.sheet').forEach((s) => { s.classList.remove('open'); s.hidden = true; });
    document.querySelectorAll('[data-panel]').forEach((b) => b.classList.remove('on'));
    $('scrim').hidden = true;
  }

  hideHint() {
    $('hint').classList.add('gone');
  }

  scaleMass(k) {
    const b = this.app.state.selected;
    if (!b) return;
    const oldKind = b.kind;
    if (b.kind === 'rocky' || b.kind === 'gas') b.r *= Math.cbrt(k);
    b.m *= k;
    const ev = reclassify(b);
    b.density = b.m / ((4 / 3) * Math.PI * b.r ** 3);
    this.app.world.dirty = true;
    if (ev) this.event({ text: `${b.name}: ${ev}`, big: true });
    else if (oldKind !== b.kind) this.toast(`${b.name} is now a ${typeName(b).toLowerCase()}`);
    this.refreshInfo(true);
  }

  showInfo(b) {
    $('info').hidden = !b;
    if (b) this.refreshInfo(true);
  }

  refreshInfo(force) {
    const b = this.app.state.selected;
    if (!b) return;
    const now = performance.now();
    if (!force && now - this.infoT < 250) return;
    this.infoT = now;
    const app = this.app, w = app.world;
    $('i-name').textContent = b.name;
    $('i-type').textContent = typeName(b);
    // Which tabs apply to this object.
    const lum = b.kind === 'star' || b.kind === 'wd' || b.kind === 'ns';
    const planet = !!b.th && (b.kind === 'rocky' || b.kind === 'gas');
    $('tab-surface').hidden = !planet;
    $('tab-comp').hidden = !b.comp;
    $('tab-star').hidden = !lum;
    if ((this.tab === 'surface' && !planet) || (this.tab === 'comp' && !b.comp) || (this.tab === 'star' && !lum)) { this.setTab('overview'); return; }

    // Overview
    $('i-mass').textContent = formatMass(b.m);
    $('i-radius').textContent = b.kind === 'core' ? formatDistance(b.soft) + ' bulge' : formatDistance(b.r);
    let temp;
    if (lum) temp = b.temp;
    else if (b.kind === 'bh' || b.kind === 'core') temp = null;
    else temp = b.th ? b.th.Ts : null;
    $('i-temp').textContent = temp == null ? '—' : formatTemp(temp);
    $('i-temp-label').textContent = isLuminous(b) || temp == null ? 'Temperature' : 'Surface temp.';
    const AU_M = 1.495978707e11, MSUN = 1.98847e30;
    if (b.r > 0 && b.kind !== 'core' && b.kind !== 'bh') {
      const rho = (b.m * MSUN) / ((4 / 3) * Math.PI * (b.r * AU_M) ** 3) / 1000;
      $('i-density').textContent = rho > 1e4 ? rho.toExponential(1).replace('e+', ' × 10^') + ' g/cm³' : rho.toPrecision(3) + ' g/cm³';
      const g = (6.674e-11 * b.m * MSUN) / (b.r * AU_M) ** 2;
      $('i-gravity').textContent = g > 1e4 ? g.toExponential(1).replace('e+', ' × 10^') + ' m/s²' : `${g.toPrecision(3)} m/s² · ${(g / 9.81).toPrecision(2)} g`;
      $('i-vesc').textContent = formatSpeed(Math.sqrt((2 * G * b.m) / b.r));
    } else {
      $('i-density').textContent = '—'; $('i-gravity').textContent = '—';
      $('i-vesc').textContent = b.kind === 'bh' ? 'Light speed at the horizon' : '—';
    }

    // Motion
    const hier = w.hierarchy();
    const parent = hier.get(b)?.parent;
    if (parent) {
      const o = orbitOf(b, parent);
      $('i-parent').textContent = parent.name;
      $('i-dist').textContent = formatDistance(o.r);
      $('i-speed').textContent = formatSpeed(o.v);
      $('i-period').textContent = o.bound && parent.soft === 0 ? formatDuration(o.period) : o.bound ? '—' : 'Escaping';
      $('i-ecc').textContent = o.bound ? o.e.toFixed(3) : o.e.toFixed(2);
    } else {
      $('i-parent').textContent = '—';
      $('i-dist').textContent = '—';
      $('i-speed').textContent = formatSpeed(Math.hypot(b.vx, b.vy, b.vz));
      $('i-period').textContent = '—';
      $('i-ecc').textContent = '—';
    }
    const look = app.r3d ? app.r3d.look(b) : null;
    $('i-day').textContent = look && look.day ? formatDuration(Math.abs(look.day) / 8766) + (look.day < 0 ? ' (retrograde)' : '') : '—';

    const hab = $('i-hab');
    const hv = b.th && b.th.hab && b.kind === 'rocky' ? b.th.hab : null;
    hab.hidden = !hv;
    if (hv) {
      hab.textContent = `${hv.verdict} for life${b.life ? ' · life present' : ''}`;
      hab.className = 'hab ' + (hv.verdict === 'Habitable' ? 'good' : hv.verdict === 'Marginal' ? 'mid' : '');
    }
    $('i-stand').hidden = b.kind !== 'rocky';
    // Any heat source whose zones reach beyond its own surface can show them.
    const zb = $('i-zones'), canZone = !!tempZones(b);
    if (!canZone) app.zones.delete(b);
    zb.hidden = !canZone;
    zb.classList.toggle('on', app.zones.has(b));
    zb.textContent = app.zones.has(b) ? 'Hide temperature zones' : 'Show temperature zones';
    const following = app.cam.follow === b;
    $('i-follow').textContent = following ? 'Unlock' : 'Lock view';
    $('i-follow').classList.toggle('on', following);

    if (this.tab === 'surface' && planet) this.refreshSurface(b, now, force);
    if (this.tab === 'comp' && b.comp) this.refreshComp(b);
    if (this.tab === 'star' && lum) this.refreshStar(b);
  }

  refreshSurface(b, now, force) {
    const th = b.th, atm = b.atm;
    const p = (atm ? atm.p : 0) + th.steam;
    $('i-press').textContent = b.kind === 'gas' ? 'No surface' : p < 1e-4 ? 'None' : p < 0.01 ? p.toExponential(1) + ' bar' : p.toPrecision(3) + ' bar';
    $('i-albedo').textContent = Math.round(th.albedo * 100) + '%';
    $('i-ocean').textContent = th.liquid > 0.001 ? pct(th.liquid) : th.steam > 1 ? 'Boiled off' : '—';
    $('i-icecov').textContent = th.ice > 0.001 ? pct(th.ice) : '—';
    const rocky = b.kind === 'rocky';
    $('i-seed').hidden = !rocky; $('i-kill').hidden = !rocky;
    $('i-seed').classList.toggle('life-on', !!b.life);
    $('i-seed').textContent = b.life ? 'Life present' : 'Seed life';
    this.refreshAtmosphere(b);
    if (!force && now - (this.mapT || 0) < 600) return;
    this.mapT = now;
    this.drawMap(b);
  }

  // Atmospheric properties from the gas mix, surface temperature and gravity (ideal gas):
  //   density ρ = Pμ/(RT), scale height H = RT/(μg), speed of sound c = √(γRT/μ),
  //   column mass = P·4πR²/g, dry adiabatic lapse rate Γ = g/cp.
  refreshAtmosphere(b) {
    const th = b.th, atm = b.atm;
    const AU_M = 1.495978707e11, MSUN = 1.98847e30, Rg = 8.314;
    const R = b.r * AU_M, M = b.m * MSUN, g = (6.674e-11 * M) / (R * R);
    const set = (id, t) => { $(id).textContent = t; };
    const rocky = b.kind === 'rocky';
    $('sea-row').hidden = !rocky || !b.comp;
    if (rocky && b.comp && !(performance.now() - (this.seaT || 0) < 1500)) {
      const v = Math.round(Math.min(1, th.ocean || 0) * 100);
      $('sea').value = v; $('sea-out').textContent = `${v}% ocean`;
    }
    // Relief scales roughly as g^-0.6 (Earth 19.8 km from Everest to the Challenger Deep; Mars ~29 km).
    set('a-relief', rocky ? `~${Math.round(19.8 * Math.pow(9.81 / g, 0.6))} km` : '—');
    const gases = atm ? { ...atm.gases } : {};
    if (th.steam > 0) gases.h2o = th.steam;
    const P = Object.values(gases).reduce((s, v) => s + v, 0); // bar
    if (!(P > 1e-6) || !rocky) {
      for (const id of ['a-mass', 'a-press', 'a-rho', 'a-sound', 'a-H', 'a-lapse', 'a-mu']) set(id, rocky ? 'None' : '—');
      return;
    }
    const MU = { n2: 28.01, o2: 32.0, co2: 44.01, ch4: 16.04, h2: 2.016, h2o: 18.02 };
    const GAMMA = { n2: 1.4, o2: 1.4, co2: 1.29, ch4: 1.31, h2: 1.41, h2o: 1.33 };
    const CP = { n2: 1040, o2: 918, co2: 844, ch4: 2220, h2: 14300, h2o: 1860 };
    let mu = 0, gam = 0, cpm = 0, mass = 0;
    for (const [k, p] of Object.entries(gases)) { const f = p / P; mu += f * (MU[k] || 28); gam += f * (GAMMA[k] || 1.4); mass += f * (MU[k] || 28); }
    for (const [k, p] of Object.entries(gases)) cpm += ((p / P) * (MU[k] || 28) / mass) * (CP[k] || 1000);
    const T = th.Ts, Pa = P * 1e5, muKg = mu / 1000;
    const rho = (Pa * muKg) / (Rg * T), H = (Rg * T) / (muKg * g), c = Math.sqrt((gam * Rg * T) / muKg);
    const colMass = (Pa * 4 * Math.PI * R * R) / g; // kg
    set('a-mass', `${(colMass / 5.15e18).toPrecision(3)} × Earth's`);
    set('a-press', Pa >= 1e5 ? `${(Pa / 1e3).toPrecision(4)} kPa` : `${(Pa / 1e3).toPrecision(3)} kPa`);
    set('a-rho', `${rho.toPrecision(3)} kg/m³`);
    set('a-sound', `${(c / 1000).toPrecision(3)} km/s`);
    set('a-H', `${(H / 1000).toPrecision(3)} km`);
    set('a-lapse', `${((g / cpm) * 1000).toPrecision(3)} K/km`);
    set('a-mu', `${mu.toPrecision(3)} g/mol`);
  }

  // Equirectangular map of the planet in its own (rotating) frame: local temperature from sunlight,
  // latitude and air, or a habitability score per spot.
  drawMap(b) {
    const cv = $('i-map'), ctx = cv.getContext('2d');
    const W = cv.width, H = cv.height;
    const app = this.app, w = app.world;
    let star = null, best = 0;
    for (const s of w.bodies) {
      if (s === b || !(s.lum > 0)) continue;
      const f = s.lum / ((s.x - b.x) ** 2 + (s.y - b.y) ** 2 + (s.z - b.z) ** 2);
      if (f > best) { best = f; star = s; }
    }
    let so = [1, 0, 0];
    if (star) {
      const d = Math.hypot(star.x - b.x, star.y - b.y, star.z - b.z);
      const v = [(star.x - b.x) / d, (star.y - b.y) / d, (star.z - b.z) / d];
      const R = app.r3d ? app.r3d.bodyRotation(b) : [1, 0, 0, 0, 1, 0, 0, 0, 1];
      so = [R[0] * v[0] + R[1] * v[1] + R[2] * v[2], R[3] * v[0] + R[4] * v[1] + R[5] * v[2], R[6] * v[0] + R[7] * v[1] + R[8] * v[2]];
    }
    const T = new Float32Array(W * H);
    let lo = Infinity, hi = -Infinity;
    for (let j = 0; j < H; j++) {
      const lat = (0.5 - (j + 0.5) / H) * Math.PI, cl = Math.cos(lat), sl = Math.sin(lat);
      for (let i = 0; i < W; i++) {
        const lon = ((i + 0.5) / W) * 2 * Math.PI - Math.PI;
        const se = star ? cl * Math.cos(lon) * so[0] + sl * so[1] + cl * Math.sin(lon) * so[2] : -1;
        const t = localTemp(b, lat, se);
        T[j * W + i] = t;
        if (t < lo) lo = t; if (t > hi) hi = t;
      }
    }
    const img = ctx.createImageData(W, H);
    const hab = this.mapMode === 'hab' && b.kind === 'rocky';
    // Fixed temperature scale (50 K to 1,000 K, log) so maps of different worlds compare directly.
    const tScale = (t) => Math.log(t / 50) / Math.log(1000 / 50);
    for (let k = 0; k < W * H; k++) {
      const c = hab ? ramp(HAB_STOPS, localHab(b, T[k])) : ramp(TEMP_STOPS, tScale(T[k]));
      img.data[k * 4] = c[0]; img.data[k * 4 + 1] = c[1]; img.data[k * 4 + 2] = c[2]; img.data[k * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    // Sub-solar point.
    if (star) {
      const lat = Math.asin(Math.max(-1, Math.min(1, so[1]))), lon = Math.atan2(so[2], so[0]);
      const x = ((lon + Math.PI) / (2 * Math.PI)) * W, y = (0.5 - lat / Math.PI) * H;
      ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x, y, 5, 0, 6.283); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - 9, y); ctx.lineTo(x - 6, y); ctx.moveTo(x + 6, y); ctx.lineTo(x + 9, y); ctx.moveTo(x, y - 9); ctx.lineTo(x, y - 6); ctx.moveTo(x, y + 6); ctx.lineTo(x, y + 9); ctx.stroke();
    }
    if (b.kind === 'gas' && this.mapMode === 'hab') this.mapMode = 'temp';
    $('map-bar').style.background = gradientCss(hab ? HAB_STOPS : TEMP_STOPS);
    if (hab) { $('map-lo').textContent = '0'; $('map-hi').textContent = '100% habitable'; }
    else { $('map-lo').textContent = '50 K'; $('map-hi').textContent = `1,000 K · here ${Math.round(lo)}–${Math.round(hi)} K`; }
    document.querySelector('[data-map=hab]').hidden = b.kind !== 'rocky';
  }

  refreshComp(b) {
    const c = b.comp;
    const keys = ['iron', 'rock', 'water', 'ice', 'gas'];
    const tot = keys.reduce((s, k) => s + (c[k] || 0), 0) || 1;
    const bar = (el, legend, entries, colors, names) => {
      const sum = entries.reduce((s, [, v]) => s + v, 0);
      if (!(sum > 0)) { $(el).innerHTML = ''; $(legend).textContent = 'None'; return; }
      $(el).innerHTML = entries.filter(([, v]) => v / sum > 0.002).map(([k, v]) => `<i style="width:${(v / sum) * 100}%;background:${colors[k]}"></i>`).join('');
      $(legend).innerHTML = entries.filter(([, v]) => v > 0).sort((a, z) => z[1] - a[1]).map(([k, v]) => `<span style="--c:${colors[k]}">${names[k]} ${pct(v / sum)}</span>`).join('');
    };
    bar('comp-bar', 'comp-legend', keys.map((k) => [k, (c[k] || 0) / tot]), COMP_COLORS, COMP_NAMES);
    if (b.atm) {
      const g = b.atm.gases;
      const entries = Object.keys(GAS_NAMES).filter((k) => k !== 'steam').map((k) => [k, g[k] || 0]);
      if (b.th && b.th.steam > 0) entries.push(['steam', b.th.steam]);
      bar('atm-bar', 'atm-legend', entries, GAS_COLORS, GAS_NAMES);
      const p = entries.reduce((s, [, v]) => s + v, 0);
      if (p > 0) $('atm-legend').insertAdjacentHTML('beforeend', `<span style="--c:transparent">Total ${p < 0.01 ? p.toExponential(1) : p.toPrecision(3)} bar</span>`);
    } else {
      $('atm-bar').innerHTML = ''; $('atm-legend').textContent = b.kind === 'gas' ? 'The whole planet is mostly gas' : 'None';
    }
  }

  refreshStar(b) {
    $('i-lum').textContent = `${b.lum >= 1e4 ? b.lum.toExponential(2).replace('e+', ' × 10^') : b.lum.toPrecision(3)} L☉`;
    const death = $('i-death');
    death.hidden = !(b.kind === 'star' || b.kind === 'wd');
    if (b.kind === 'star') {
      const m0 = b.m0 || b.m, life = lifetime(m0);
      $('i-age').textContent = b.age !== undefined ? formatDuration(b.age) : '—';
      $('i-stage').textContent = b.giant > 0 ? (m0 >= 8 ? 'Red supergiant' : 'Red giant') : 'Main sequence';
      $('i-left').textContent = b.age !== undefined ? formatDuration(Math.max(0, life - b.age)) : '—';
      $('i-fate').textContent = 'Fate: ' + (m0 >= 8 ? (m0 >= 20 ? 'core-collapse supernova, leaving a black hole.' : 'core-collapse supernova, leaving a neutron star.') : 'sheds a planetary nebula and leaves a white dwarf.');
      death.textContent = m0 >= 8 ? 'Go supernova' : 'End of life (planetary nebula)';
    } else {
      $('i-age').textContent = b.kind === 'wd' && b.wdAge !== undefined ? formatDuration(b.wdAge) + ' as a white dwarf' : '—';
      $('i-stage').textContent = b.kind === 'wd' ? 'White dwarf, cooling' : 'Neutron star';
      $('i-left').textContent = '—';
      $('i-fate').textContent = b.kind === 'wd' ? 'Fate: fades slowly for trillions of years, unless it gains enough mass to pass 1.44 M☉ and detonate.' : 'Fate: cools for billions of years; above about 2.3 M☉ it would collapse into a black hole.';
      death.textContent = 'Detonate (Type Ia supernova)';
    }
  }

  toast(text, big = false) {
    const t = $('toast');
    t.textContent = text;
    t.classList.toggle('big', big);
    t.hidden = false;
    t.classList.remove('show');
    void t.offsetWidth;
    t.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => { t.classList.remove('show'); }, big ? 5200 : 3400);
  }

  event(ev) {
    if (/supernova/.test(ev.text) && ev.body) this.app.snZoom = { body: ev.body, t0: this.app.world.t, v: 2500, limit: 2e5 };
    // Routine collisions can arrive many per second; let them through at most every 1.5 s.
    const now = performance.now();
    if (!ev.big && now - (this.lastEvent || 0) < 1500) return;
    this.lastEvent = now;
    this.toast(ev.text, !!ev.big);
  }

  tick(now) {
    const app = this.app;
    const sv = app.surface;
    if (sv && now - (this.svT || 0) > 300) {
      this.svT = now;
      const p = sv.body.atm ? sv.body.atm.p + (sv.body.th ? sv.body.th.steam : 0) : 0;
      const lat = Math.round((sv.lat * 180) / Math.PI);
      $('sv-readout').textContent = `${Math.abs(lat)}°${lat >= 0 ? 'N' : 'S'} · ${sv.localT ? Math.round(sv.localT) + ' K (' + Math.round(sv.localT - 273.15) + ' °C)' : ''} · Sun ${Math.round((sv.elev * 180) / Math.PI)}° ${sv.elev >= 0 ? 'above' : 'below'} the horizon · air ${p < 0.001 ? 'none' : p.toPrecision(2) + ' bar'}`;
    }
    $('sim-time').textContent = formatDuration(app.world.t);
    const lim = $('limit');
    const limited = app.world.limited && !app.state.paused;
    lim.hidden = !limited;
    if (limited) lim.textContent = 'Running at ' + formatRate(app.rate);
    this.refreshInfo(false);
    const locked = app.cam.follow;
    if (locked !== this.lockShown) {
      this.lockShown = locked;
      $('lock-chip').hidden = !locked;
      if (locked) $('lock-name').textContent = locked.name;
      $('btn-lock').textContent = locked ? 'Unlock camera' : 'Lock camera';
      $('btn-lock').setAttribute('aria-pressed', locked ? 'true' : 'false');
    }
    const canSL = !!(locked && app.r3d && app.renderer.overlay && !app.surface && (locked.kind === 'rocky' || locked.kind === 'gas' || locked.kind === 'star'));
    $('surf-lock').hidden = !canSL;
    $('surf-lock').classList.toggle('on', !!app.surfaceLock);
    $('surf-lock').setAttribute('aria-pressed', app.surfaceLock ? 'true' : 'false');
    $('stat-objects').textContent = `${app.world.bodies.length} bodies · ${(app.world.np + app.world.nr).toLocaleString('en-US')} particles`;
    if (app.settings.grid) $('stat-grid').textContent = 'Grid ' + formatDistance(app.renderer.gridSpacing);
    else $('stat-grid').textContent = '';
  }
}
