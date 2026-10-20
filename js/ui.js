import { G, formatMass, formatDistance, formatSpeed, formatDuration, formatRate, formatTemp } from './units.js';
import { CATALOG, REAL_OBJECTS, typeName, isLuminous, makeBody, reclassify } from './bodies.js';
import { orbitOf } from './physics.js';
import { PRESETS } from './presets.js';
import { Book } from './book.js';
import { tempZones, localTemp, localHab, listReasons, exoticLife } from './thermal.js';
import { lifetime } from './stellar.js';
import { atmosphereOptics } from './optics.js';
import { interiorOf, formatPressure } from './interior.js';
import { renderThumb, category } from './thumbs.js';
import { CHALLENGES } from './challenges.js';

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
// Shares: whole percents, then decimals (0.04%), then parts per million or billion (CH₄ 1.9 ppm).
const pct = (f) => {
  const n = (x) => +x.toPrecision(2);
  return f >= 0.1 ? Math.round(f * 100) + '%' : f >= 1e-4 ? n(f * 100) + '%' : f >= 1e-7 ? n(f * 1e6) + ' ppm' : n(f * 1e9) + ' ppb';
};

// Swatch shown on catalogue chips: a CSS radial gradient approximating the body.
function swatch(item) {
  if (item.kind === 'dust') return 'radial-gradient(circle at 50% 50%, rgba(220,190,150,.9) 0 1px, transparent 2px) 0 0/6px 6px, radial-gradient(circle, rgba(190,160,128,.45), transparent 70%)';
  if (item.kind === 'bh') return 'radial-gradient(circle, #000 0 38%, #ffd7a0 42%, rgba(255,140,60,.55) 52%, transparent 72%)';
  if (item.kind === 'nebula') return 'radial-gradient(circle at 48% 50%, rgba(120,210,255,.8), transparent 26%), radial-gradient(ellipse 50% 40% at 44% 54%, rgba(240,70,110,.85), transparent 72%), radial-gradient(circle, rgba(170,40,90,.4), transparent 72%)';
  const b = makeBody({ kind: item.kind, m: item.m, r: item.r, color: item.color, band: item.band });
  reclassify(b);
  const [r, g, bl] = b.color;
  if (isLuminous(b)) return `radial-gradient(circle, #fff 0 18%, rgb(${r},${g},${bl}) 40%, rgba(${r},${g},${bl},.25) 60%, transparent 72%)`;
  return `radial-gradient(circle at 35% 35%, rgb(${Math.min(255, r + 50)},${Math.min(255, g + 50)},${Math.min(255, bl + 50)}), rgb(${r},${g},${bl}) 45%, rgb(${r * 0.25 | 0},${g * 0.25 | 0},${bl * 0.25 | 0}) 70%, transparent 71%)`;
}

// What each band shows (a toast when it is chosen).
const SPECTRUM_NOTE = {
  ir: 'Infrared: everything glows by its own temperature (false colour, cold dark to hot white). Night sides show; cold cloud tops look dark.',
  uv: 'Ultraviolet: rock and ocean are dark, air glows (it scatters UV strongly), hot stars blaze and cool ones fade.',
  xray: 'X-ray: planets are nearly black; stars show their hot, patchy coronae; white dwarfs and neutron stars blaze.',
};

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
    // Every button and switch clicks, unless its handler already played a sound of its own.
    document.addEventListener('click', (e) => { if (e.target.closest('button, label, .tool-card')) setTimeout(() => this.app.audio.ui('click', true), 0); });
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
    $('paint-done').addEventListener('click', () => this.setTool('view'));
    app.brush = 'land'; app.brushSize = 6;
    document.querySelectorAll('[data-brush]').forEach((b) => b.addEventListener('click', () => { app.brush = b.dataset.brush; document.querySelectorAll('[data-brush]').forEach((x) => x.classList.toggle('on', x === b)); }));
    $('brush-size').addEventListener('input', (e) => { app.brushSize = +e.target.value; });
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
    $('btn-settings').addEventListener('click', () => { this.openSheet('sheet-settings'); this.checkGPU(); });
    $('btn-settings2').addEventListener('click', () => { this.openSheet('sheet-settings'); this.checkGPU(); });
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
    $('i-more-open').addEventListener('click', (e) => { e.stopPropagation(); if (app.state.selected) this.book.open(app.state.selected); });
    $('i-more-pages').addEventListener('click', (e) => {
      const p = e.target.closest('[data-page]');
      e.stopPropagation();
      if (p && app.state.selected) this.book.open(app.state.selected, +p.dataset.page);
    });
    $('i-book').addEventListener('click', (e) => { e.stopPropagation(); if (app.state.selected) this.book.open(app.state.selected); });
    $('btn-search').addEventListener('click', () => { this.openSheet('sheet-search'); this.renderSearch(); setTimeout(() => $('search-q').focus(), 250); });
    $('search-q').addEventListener('input', () => this.renderSearch());
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

    $('i-rings').addEventListener('click', () => {
      const b = app.state.selected;
      if (!b || app.world.ringOuter.has(b)) return;
      app.addRings(b);
      this.refreshInfo(true);
    });
    $('i-stand').addEventListener('click', () => { if (app.state.selected) app.enterSurface(app.state.selected, 'day'); });
    $('i-cutaway').addEventListener('click', () => {
      const b = app.state.selected;
      if (!b) return;
      b.cutaway = !b.cutaway;
      this.intKey = null;
      this.refreshInfo(true);
    });
    $('i-lock').addEventListener('click', () => {
      const b = app.state.selected, r = app.r3d;
      if (!b || !r) return;
      const info = r.lockInfo(app.world, b), l = r.look(b);
      if (info.locked) {
        // Unlocked: it keeps turning at the rate it had, once per orbit, from now on freely.
        const par = info.par, d = Math.hypot(par.x - b.x, par.y - b.y, par.z - b.z);
        l.day = 2 * Math.PI * Math.sqrt(d ** 3 / (G * (par.m + b.m))) * 8766;
        b.lockOverride = false; l.locked = 0;
      } else { b.lockOverride = true; l.locked = 1; }
      r.lockAt && r.lockAt.delete(b);
      this.refreshInfo(true);
    });
    $('sv-leave').addEventListener('click', () => app.exitSurface());
    document.querySelectorAll('[data-where]').forEach((btn) => btn.addEventListener('click', () => {
      if (!app.surface) return;
      app.surface.where = btn.dataset.where; app.surface.place = true; app.surface.pitch = 0.15;
      this.showSurface(app.surface);
    }));
    document.querySelectorAll('[data-ph]').forEach((b) => b.addEventListener('click', () => { this.toggleSetting(b.dataset.ph); this.syncPhotoBar(); }));
    $('ph-exit').addEventListener('click', () => app.setPhoto(false));
    $('btn-photo').addEventListener('click', () => { this.closeSheets(); app.setPhoto(true); });
    $('btn-clear').addEventListener('click', () => { app.world.clearParticles(); this.toast('Cleared all dust and debris'); });
    for (const r of document.querySelectorAll('input[name=view]')) {
      r.addEventListener('change', () => { if (r.checked) { app.setView(r.value); this.toast({ realistic: 'Realistic view', classic: 'Classic view', pixel: 'Pixel view' }[r.value]); } });
    }
    this.onView(app.settings.view);
    for (const key of ['bloom', 'flare', 'rocks', 'trails', 'labels', 'grid', 'stars', 'trailsRelative', 'collisions', 'orbits', 'magnetic', 'allTemp', 'allGrav', 'trueSize', 'sound', 'music', 'uiSound', 'soundSilent', 'bassBoost', 'sharp', 'perf', 'gpuRings', 'webgpu']) {
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
    // Light seen: visible, or false colour in other bands (render3d.js spectrumMode).
    const sp = (v) => { app.settings.spectrum = v; app.saveSettings(); document.querySelectorAll('[data-spectrum]').forEach((x) => x.classList.toggle('on', x.dataset.spectrum === v)); };
    document.querySelectorAll('[data-spectrum]').forEach((b) => b.addEventListener('click', () => { sp(b.dataset.spectrum); this.app.audio.ui('click'); if (b.dataset.spectrum !== 'visible') this.toast(SPECTRUM_NOTE[b.dataset.spectrum]); }));
    sp(app.settings.spectrum || 'visible');
    // Brightness: enhanced (every world lit about as brightly, as Universe Sandbox's Space Goggles), or
    // realistic (light falling off with distance from the star, the eye adapting partway). Tone curve: the
    // classic shoulder, or AgX (render3d.js, COMPOSITE_FS).
    const seg = (key, attr, note) => {
      const set = (v) => { app.settings[key] = v; app.saveSettings(); document.querySelectorAll(`[data-${attr}]`).forEach((x) => x.classList.toggle('on', x.dataset[attr] === v)); };
      document.querySelectorAll(`[data-${attr}]`).forEach((b) => b.addEventListener('click', () => { set(b.dataset[attr]); this.app.audio.ui('click'); if (note[b.dataset[attr]]) this.toast(note[b.dataset[attr]]); }));
      return set;
    };
    seg('brightness', 'brightness', { realistic: 'Realistic brightness: light falls off with distance from the star; the eye adapts partway, so far worlds look dim.', enhanced: 'Enhanced brightness: every world lit about as brightly, so the far ones are easy to see.' })(app.settings.brightness || 'enhanced');
    seg('tone', 'tone', { agx: 'AgX tone curve: saturated highlights roll off toward white more gently.' })(app.settings.tone || 'classic');
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
    this.toast(m === 'orbit' ? 'Orbit: tap to drop it into a circular orbit' : m === 'binary' ? 'Binary: tap to drop a pair orbiting each other' : 'Place: tap to drop it at rest; drag to fling');
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
    this.app.audio.ui('click');
    this.setSpeed(next);
    if (this.app.state.paused && dir > 0) this.setPaused(false);
  }

  togglePanel(id) {
    if (!$(id).hidden) { this.closeSheets(); return; }
    this.openSheet(id);
  }

  setTab(t) {
    if (this.tab !== t) this.app.audio.ui('sequence');
    this.tab = t;
    document.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
    document.querySelectorAll('[data-pane]').forEach((p) => { p.hidden = p.dataset.pane !== t; });
    $('info').classList.remove('collapsed');
    this.mapT = 0;
    this.refreshInfo(true);
  }

  buildScenarios() {
    // Challenges, then the plain scenarios.
    const cl = $('challenge-list'), ch = this.app.challenges;
    for (const c of CHALLENGES) {
      const b = document.createElement('button');
      b.className = 'scenario challenge' + (ch.doneSet.has(c.id) ? ' done' : '');
      b.id = 'chl-' + c.id;
      b.innerHTML = `<span class="scn-title">${c.title}</span><span class="scn-blurb">${c.goal}</span><span class="scn-meta">${c.tag}</span>`;
      b.addEventListener('click', () => { this.closeSheets(); ch.start(c); });
      cl.appendChild(b);
    }
    $('chal-x').addEventListener('click', () => ch.stop());
    $('chal-hint').addEventListener('click', () => { const m = $('chal-more'); m.hidden = false; m.textContent = ch.active ? ch.active.c.hint : ''; });
    $('chal-retry').addEventListener('click', () => ch.active && ch.start(ch.active.c));
    $('chal-answer').addEventListener('submit', (e) => { e.preventDefault(); ch.answer(parseFloat($('chal-in').value.replace(/,/g, ''))); });
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
    this.app.audio.ui('affirm');
    this.toast(p.blurb);
  }

  showSurface(sv) {
    $('surface-bar').hidden = !sv;
    $('app').classList.toggle('on-surface', !!sv);
    if (!sv) return;
    $('sv-name').textContent = sv.body.name;
    // A moon that keeps one face to its planet: a place facing it (the planet hangs fixed in that sky).
    const par = this.app.r3d ? this.app.r3d.tidalParent(this.app.world, sv.body) : null;
    $('sv-parent').hidden = !par;
    if (par) $('sv-parent').textContent = `Facing ${par.name}`;
    document.querySelectorAll('[data-where]').forEach((b) => b.classList.toggle('on', b.dataset.where === sv.where));
  }

  onView(view) {
    const r = document.getElementById('view-' + view);
    if (r) r.checked = true;
  }

  setPaused(p) {
    if (p !== this.app.state.paused) this.app.audio.ui('click');
    this.app.state.paused = p;
    $('btn-play').classList.toggle('paused', p);
    $('btn-play').setAttribute('aria-label', p ? 'Play' : 'Pause');
  }

  setTool(t) {
    const app = this.app;
    app.audio.ui('sequence');
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
    $('paintbar').hidden = t !== 'paint';
    if (t === 'paint') this.toast('Drag across a rocky world to paint it. Zoom in close for detail.');
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
    if (key === 'sound') this.app.audio.setEnabled(s.sound);
    if (key === 'music') this.app.audio.setMusic(s.music);
    if (key === 'soundSilent') this.app.audio.applySession();
    if (key === 'bassBoost') this.app.audio.setBassBoost(s.bassBoost);
    this.app.audio.ui('click');
    const el = $('set-' + key);
    if (el) el.checked = s[key];
    if (key === 'collisions') this.app.world.collisions = s.collisions;
    if (key === 'webgpu') this.app.useWebGPU(s.webgpu).then(() => this.checkGPU());
    if (key === 'gpuRings') this.checkGPU();
    this.app.saveSettings();
  }

  // Which graphics interfaces this browser offers: WebGL 2 (used now) and WebGPU (compute shaders, which
  // could move particles and gravity onto the GPU). Asks for a real adapter, not just the API's presence.
  async checkGPU() {
    const el = $('gpu-check');
    let gpu = 'not offered by this browser';
    try {
      if (navigator.gpu) {
        const a = await navigator.gpu.requestAdapter();
        gpu = a ? 'available' + (a.info && a.info.vendor ? ` (${a.info.vendor})` : '') : 'present, but no adapter was given (blocked or switched off)';
      }
    } catch (e) { gpu = 'present, but it failed: ' + e.message; }
    const g = this.app.gpuEmb || this.app.gpu;
    const state = g ? (g.lost ? 'switched off after an error' : this.app.settings.gpuRings ? 'drawing Saturn’s rings' : 'ready (turn on the rings above)') : '';
    const r = this.app.r3d, rg = r && r.webgpu ? r.gl : null;
    const diag = [...(g && g.diag || []), ...(rg ? rg.diag : []), ...(this.app.gpuError ? [this.app.gpuError] : [])];
    el.textContent = `Build ${window.__BUILD__ || 'dev'} · Graphics: ${rg ? 'WebGPU renderer in use' : 'WebGL 2 in use'} · WebGPU ${gpu}${state ? ' · ' + state : ''}.` + (diag.length ? ' Problems: ' + diag.join(' | ') : '');
  }

  // Find: every object in the scene, filtered by name or kind, biggest first; tap to fly to it.
  renderSearch() {
    const q = $('search-q').value.trim().toLowerCase();
    const list = $('search-list');
    list.textContent = '';
    const bodies = this.app.world.bodies.slice().sort((a, b) => b.m - a.m)
      .filter((b) => !q || b.name.toLowerCase().includes(q) || typeName(b).toLowerCase().includes(q)).slice(0, q ? 120 : 60);
    for (const b of bodies) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'search-item';
      const c = b.color || [200, 200, 200];
      el.innerHTML = `<i style="background:rgb(${c.join(',')})"></i><b></b><small></small>`;
      el.querySelector('b').textContent = b.name;
      el.querySelector('small').textContent = typeName(b);
      el.addEventListener('click', () => { this.closeSheets(); this.app.doubleTap(b); });
      list.appendChild(el);
    }
    if (!bodies.length) list.innerHTML = '<p class="about">Nothing matches.</p>';
  }

  syncPhotoBar() {
    document.querySelectorAll('[data-ph]').forEach((b) => b.classList.toggle('on', !!this.app.settings[b.dataset.ph]));
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
    this.closeSheets(true);
    this.app.audio.ui('sequence');
    $(id).hidden = false;
    // Side panels on wide screens leave the simulation usable; phones get a modal sheet.
    $('scrim').hidden = false;
    $('scrim').classList.toggle('soft', id !== 'sheet-scenarios');
    document.querySelectorAll('[data-panel]').forEach((b) => b.classList.toggle('on', b.dataset.panel === id));
    requestAnimationFrame(() => $(id).classList.add('open'));
  }

  closeSheets(quiet = false) {
    if (!quiet && [...document.querySelectorAll('.sheet')].some((s) => !s.hidden)) this.app.audio.ui('click');
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
    else if (oldKind !== b.kind) this.toast(`${b.name} is now a ${typeName(b).replace(/^./, (c) => c.toLowerCase())}`);
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
    if (this.moreFor !== b) {
      // Point to the book's pages for this object: its first line, then a chip per page.
      this.moreFor = b;
      const pv = Book.preview(b);
      $('i-more-text').textContent = pv.first;
      $('i-more-pages').innerHTML = pv.pages.map((t, i) => `<button type="button" data-page="${i}">${t}</button>`).join('');
    }
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
    if (lum || b.kind === 'nebula') temp = b.temp;   // (a nebula: its ionised gas, ~10,000 K)
    else if (b.kind === 'bh' || b.kind === 'core') temp = null;
    else temp = b.th ? b.th.Ts : null;
    $('i-temp').textContent = temp == null ? '—' : formatTemp(temp);
    $('i-temp-label').textContent = b.kind === 'nebula' ? 'Gas temperature' : isLuminous(b) || temp == null ? 'Temperature' : 'Surface temp.';
    const AU_M = 1.495978707e11, MSUN = 1.98847e30;
    if (b.kind === 'nebula') {
      // Atoms per cm³ (hydrogen, 1.67e-24 g each): a few hundred in a bright nebula, a near-perfect vacuum.
      const n = (b.m * MSUN * 1000) / ((4 / 3) * Math.PI * (b.r * AU_M * 100) ** 3) / 1.67e-24;
      $('i-density').textContent = `${n < 10 ? n.toPrecision(2) : Math.round(n).toLocaleString('en-US')} atoms/cm³`;
      $('i-gravity').textContent = 'No surface';
      $('i-vesc').textContent = formatSpeed(Math.sqrt((2 * G * b.m) / b.r));
    } else if (b.r > 0 && b.kind !== 'core' && b.kind !== 'bh') {
      const rho = (b.m * MSUN) / ((4 / 3) * Math.PI * (b.r * AU_M) ** 3) / 1000;
      $('i-density').textContent = rho > 1e4 ? rho.toExponential(1).replace('e+', ' × 10^') + ' g/cm³' : rho.toPrecision(3) + ' g/cm³';
      const g = (6.674e-11 * b.m * MSUN) / (b.r * AU_M) ** 2;
      $('i-gravity').textContent = g > 1e4 ? g.toExponential(1).replace('e+', ' × 10^') + ' m/s²' : g < 0.1 ? `${(g * 1000).toPrecision(3)} mm/s²` : `${g.toPrecision(3)} m/s² · ${(g / 9.81).toPrecision(2)} g`;
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
    // Tidal locking: whether it keeps one face to what it orbits, how long tides would take, and a toggle.
    const lk = $('i-lock'), ln = $('i-locknote');
    const li = app.r3d && (b.kind === 'rocky' || b.kind === 'gas') ? app.r3d.lockInfo(app.world, b) : null;
    lk.hidden = ln.hidden = !(li && li.par);
    if (li && li.par) {
      if (li.locked) $('i-day').textContent = 'one orbit (tidally locked)';
      lk.textContent = li.locked ? `Unlock from ${li.par.name}` : `Lock to ${li.par.name}`;
      const tt = li.t, yrs = tt < 1 ? 'under a year' : tt < 1e3 ? `${tt.toPrecision(2)} years` : tt < 1e6 ? `${(tt / 1e3).toPrecision(2)} thousand years` : tt < 1e9 ? `${(tt / 1e6).toPrecision(2)} million years` : tt < 1e15 ? `${(tt / 1e9).toPrecision(2)} billion years` : 'far longer than the age of the universe';
      ln.textContent = `${li.par.name}'s pull raises a tidal bulge on ${b.name}. As ${b.name} turns, the bulge is dragged ahead and pulled back, braking the spin until one face always points at ${li.par.name}. `
        + `Its tides would lock it in ${yrs}` + (tt < 4.5e9 ? ' (less than the Solar System\'s age, so it would be locked by now).' : '.')
        + (orbitOf(b, li.par).e > 0.1 ? ` On an orbit this oval it may be caught in a resonance first instead: Mercury (eccentricity 0.21) turns three times every two orbits.` : '')
        + ' (Gladman et al. 1996, Icarus 122, 166.)';
    }

    const hab = $('i-hab');
    const hv = b.th && b.th.hab && b.kind === 'rocky' ? b.th.hab : null;
    hab.hidden = !hv;
    if (hv) {
      const why = hv.reasons && hv.reasons.length ? ': ' + listReasons(hv.reasons) : '';
      hab.textContent = (hv.verdict === 'Uninhabitable' ? 'Uninhabitable' : `${hv.verdict} for life`) + why + (b.life ? ' · life present' : '');
      hab.className = 'hab ' + (hv.verdict === 'Habitable' ? 'good' : hv.verdict === 'Marginal' ? 'mid' : '');
    }
    // Life as we don't know it, kept apart from the checklist (details in the book's live page).
    const ex = hv && hv.verdict === 'Habitable' ? null : exoticLife(b), exEl = $('i-exotic');
    exEl.hidden = !ex;
    if (ex) exEl.textContent = `Exotic life: ${ex.verdict.toLowerCase()} · ${ex.ideas.map((x) => x[0].toLowerCase()).join(', ')}`;
    $('i-stand').hidden = b.kind !== 'rocky';
    $('i-rings').hidden = !(b.kind === 'rocky' || b.kind === 'gas') || app.world.ringOuter.has(b);
    // Any heat source whose zones reach beyond its own surface can show them.
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
    const opt = b.kind === 'rocky' ? atmosphereOptics(b) : null;
    $('i-press').textContent = b.kind === 'gas' ? 'No surface' : p < 1e-4 ? 'None' : (p < 0.01 ? p.toExponential(1) + ' bar' : p.toPrecision(3) + ' bar') + (opt ? ` · 99% within ${Math.round((4.605 * opt.H) / 1000)} km` : '');
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
      for (const id of ['a-mass', 'a-press', 'a-rho', 'a-sound', 'a-H', 'a-thick', 'a-lapse', 'a-mu']) set(id, rocky ? 'None' : '—');
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
    // Thickness: pressure falls by e every scale height, so 99% of the air lies below 4.6 H, and it thins to a
    // millionth of the surface pressure (near-vacuum; ~116 km on Earth, near the 100 km edge of space) by 13.8 H.
    const km = (x) => (x >= 100 ? Math.round(x).toLocaleString('en-US') : x.toPrecision(2)) + ' km';
    set('a-thick', `99% below ${km((4.605 * H) / 1000)} · a millionth left at ${km((13.82 * H) / 1000)}`);
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
    this.refreshInterior(b);
  }

  // The interior: a drawn cutaway (a wedge taken out of the globe, the layers glowing by their heat) and the
  // layers listed with their depths, plus the centre's temperature and pressure.
  refreshInterior(b) {
    const it = interiorOf(b), cv = $('int-cut'), list = $('int-layers');
    const show = !!it;
    cv.hidden = list.hidden = $('int-centre').hidden = $('i-cutaway').hidden = !show;
    if (!show) return;
    const key = b.id + ':' + it.layers.map((l) => l.key + l.r.toFixed(3)).join();
    $('i-cutaway').textContent = b.cutaway ? 'Hide the cutaway in 3D' : 'Show the cutaway in 3D';
    if (this.intKey === key) return;
    this.intKey = key;
    const Rkm = b.r * 1.495978707e8;
    const km = (f) => { const v = (1 - f) * Rkm; return v < 10 ? `${v.toFixed(1)} km` : `${Math.round(v).toLocaleString('en-US')} km`; };
    $('int-centre').textContent = `At the centre: about ${formatTemp(it.T)} and ${formatPressure(it.P)}.` + (it.known ? '' : ' (Modelled from its make-up; not measured.)');
    let prev = 0;
    list.innerHTML = it.layers.map((l) => {
      const from = prev; prev = l.r;
      const c = `rgb(${l.col.join(',')})`;
      const depth = from === 0 ? `centre to ${km(l.r)} deep` : l.r >= 0.9999 ? `top ${km(from)}` : `${km(l.r)} to ${km(from)} deep`;
      return `<li style="--c:${c}"><i></i><b>${l.name}</b><span>${depth} · ${l.what}</span></li>`;
    }).join('');
    // The drawing: the globe in its own colour, a quarter cut away toward the viewer, the layers as rings.
    const g = cv.getContext('2d'), W = cv.width, H = cv.height, cx = W / 2, cy = H / 2 + 6, R = Math.min(W, H) * 0.42;
    g.clearRect(0, 0, W, H);
    const base = b.color || [150, 150, 150];
    const sph = g.createRadialGradient(cx - R * 0.35, cy - R * 0.35, R * 0.1, cx, cy, R);
    sph.addColorStop(0, `rgb(${base.map((v) => Math.min(255, v * 1.25 + 20)).join(',')})`);
    sph.addColorStop(1, `rgb(${base.map((v) => v * 0.35).join(',')})`);
    g.fillStyle = sph; g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill();
    // the wedge: from 12 o'clock to 3 o'clock, opened toward the viewer
    const a0 = -Math.PI / 2 - 0.15, a1 = 0.15;
    for (let i = it.layers.length - 1; i >= 0; i--) {
      const l = it.layers[i], rr = R * l.r, inner = i > 0 ? R * it.layers[i - 1].r : 0;
      const gr = g.createRadialGradient(cx, cy, inner, cx, cy, Math.max(rr, inner + 0.5));
      gr.addColorStop(0, `rgb(${l.col.map((v) => Math.min(255, v * 1.1)).join(',')})`);
      gr.addColorStop(1, `rgb(${l.col.map((v) => v * 0.75).join(',')})`);
      g.fillStyle = gr;
      g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, rr, a0, a1); g.closePath(); g.fill();
    }
    // cut faces' edges and a soft glow from the hot middle
    const glow = g.createRadialGradient(cx, cy, 0, cx, cy, R * 0.6);
    glow.addColorStop(0, 'rgba(255,240,200,0.35)'); glow.addColorStop(1, 'rgba(255,200,120,0)');
    g.globalCompositeOperation = 'lighter';
    g.fillStyle = glow; g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, R, a0, a1); g.closePath(); g.fill();
    g.globalCompositeOperation = 'source-over';
    g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(cx + Math.cos(a0) * R, cy + Math.sin(a0) * R); g.lineTo(cx, cy); g.lineTo(cx + Math.cos(a1) * R, cy + Math.sin(a1) * R); g.stroke();
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

  // The active challenge's card above the dock: goal, live progress, then the outcome and the science.
  showChallenge(a) {
    const el = $('chal');
    el.hidden = !a;
    if (!a) return;
    const c = a.c, r = a.result;
    $('chal-tag').textContent = c.tag;
    $('chal-title').textContent = c.title;
    $('chal-goal').textContent = c.goal;
    el.classList.toggle('won', !!(r && r.done));
    el.classList.toggle('lost', !!(r && r.fail));
    $('chal-answer').hidden = !c.answer || !!r;
    $('chal-unit').textContent = c.answer ? c.answer.unit : '';
    $('chal-hint').hidden = !!r;
    $('chal-retry').hidden = !r;
    const more = $('chal-more');
    if (r) {
      $('chal-prog').textContent = r.done ? 'Done! ' + r.done : r.fail;
      more.hidden = false;
      more.innerHTML = '';
      if (r.done) {
        more.append(c.science + ' ');
        const a2 = document.createElement('a');
        a2.href = c.source[1]; a2.target = '_blank'; a2.rel = 'noopener'; a2.textContent = c.source[0];
        more.append(a2);
        this.toast(`Challenge complete: ${c.title}`, true);
        const card = $('chl-' + c.id);
        if (card) card.classList.add('done');
      }
    } else {
      $('chal-prog').textContent = '';
      more.hidden = true;
      $('chal-in').value = '';
    }
  }

  challengeProgress(text) { $('chal-prog').textContent = text || ''; }

  toast(text, big = false) {
    this.app.audio.ui('hint');
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
      const zoom = (55 * Math.PI) / 180 / this.app.cam.fov;
      const ecl = sv.occ && sv.sunPower < 0.999 ? ` · eclipse: ${sv.sunPower <= 1e-4 ? 'total' : Math.round((1 - sv.sunPower) * 100) + '% of the Sun covered'}` : '';
      $('sv-readout').textContent = `${Math.abs(lat)}°${lat >= 0 ? 'N' : 'S'} · ${sv.localT ? Math.round(sv.localT) + ' K (' + Math.round(sv.localT - 273.15) + ' °C)' : ''} · Sun ${Math.round((sv.elev * 180) / Math.PI)}° ${sv.elev >= 0 ? 'above' : 'below'} the horizon · air ${p < 0.001 ? 'none' : p.toPrecision(2) + ' bar'}${ecl}${zoom > 1.05 ? ` · ${zoom.toFixed(zoom < 10 ? 1 : 0)}× zoom` : ''}`;
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
