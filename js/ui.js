import { formatMass, formatDistance, formatSpeed, formatDuration, formatRate, formatTemp } from './units.js';
import { CATALOG, typeName, isLuminous, makeBody, reclassify } from './bodies.js';
import { orbitOf } from './physics.js';
import { PRESETS } from './presets.js';

// Time-speed slider spans 1 second per second to 300 million years per second (log scale).
const MIN_EXP = Math.log10(1 / 3.15576e7);
const MAX_EXP = Math.log10(3e8);
const toSlider = (yr) => Math.round(((Math.log10(yr) - MIN_EXP) / (MAX_EXP - MIN_EXP)) * 1000);
const fromSlider = (v) => Math.pow(10, MIN_EXP + (v / 1000) * (MAX_EXP - MIN_EXP));

const $ = (id) => document.getElementById(id);

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
    this.buildTray();
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
    document.querySelectorAll('[data-tool]').forEach((b) => b.addEventListener('click', () => this.setTool(b.dataset.tool)));
    $('btn-trails').addEventListener('click', () => this.toggleSetting('trails'));
    $('btn-home').addEventListener('click', () => app.resetCamera());
    $('btn-scenarios').addEventListener('click', () => this.openSheet('sheet-scenarios'));
    $('btn-settings').addEventListener('click', () => this.openSheet('sheet-settings'));
    document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => this.closeSheets()));
    $('scrim').addEventListener('click', () => this.closeSheets());
    $('i-close').addEventListener('click', (e) => { e.stopPropagation(); app.select(null); });
    document.querySelector('.info-head').addEventListener('click', () => $('info').classList.toggle('collapsed'));
    $('i-follow').addEventListener('click', () => {
      const b = app.state.selected;
      if (!b) return;
      app.follow(app.cam.follow === b ? null : b);
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
    $('btn-clear').addEventListener('click', () => { app.world.clearParticles(); this.toast('Cleared all dust and debris'); });
    for (const key of ['trails', 'labels', 'grid', 'stars', 'trailsRelative', 'collisions']) {
      const el = $('set-' + key);
      el.checked = !!app.settings[key];
      el.addEventListener('change', () => this.toggleSetting(key, el.checked));
    }
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      if (e.code === 'Space') { e.preventDefault(); this.setPaused(!app.state.paused); }
      if (e.key === 'Escape') { this.closeSheets(); app.select(null); }
      if (e.key === 'a') this.setTool(app.state.tool === 'add' ? 'view' : 'add');
      if (e.key === 'f' && app.state.selected) app.follow(app.state.selected);
      if (e.key === ',' || e.key === '.') {
        const el = $('speed');
        el.value = Math.max(0, Math.min(1000, +el.value + (e.key === '.' ? 40 : -40)));
        app.state.speed = fromSlider(+el.value);
        this.updateSpeedLabel();
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && app.state.selected) $('i-delete').click();
    });
    $('btn-trails').classList.toggle('on', app.settings.trails);
    setTimeout(() => this.hideHint(), 9000);
  }

  buildTray() {
    const tray = $('tray-list');
    for (const item of CATALOG) {
      const b = document.createElement('button');
      b.className = 'chip';
      b.id = 'add-' + item.id;
      b.dataset.item = item.id;
      b.innerHTML = `<span class="swatch" style="background:${swatch(item)}"></span><span class="chip-label">${item.label}</span>`;
      b.addEventListener('click', () => this.setAddItem(item.id));
      tray.appendChild(b);
    }
    this.setAddItem(this.app.state.addItem, false);
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

  setPaused(p) {
    this.app.state.paused = p;
    $('btn-play').classList.toggle('paused', p);
    $('btn-play').setAttribute('aria-label', p ? 'Play' : 'Pause');
  }

  setTool(t) {
    this.app.state.tool = t;
    document.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === t));
    $('tray').hidden = t !== 'add';
    if (t === 'add') this.toast('Tap to drop into orbit. Drag to fling it.');
  }

  setAddItem(id, activate = true) {
    this.app.state.addItem = id;
    document.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c.dataset.item === id));
    const item = CATALOG.find((c) => c.id === id);
    $('add-current').textContent = item.label;
    if (activate && this.app.state.tool !== 'add') this.setTool('add');
  }

  toggleSetting(key, value) {
    const s = this.app.settings;
    s[key] = value === undefined ? !s[key] : value;
    const el = $('set-' + key);
    if (el) el.checked = s[key];
    if (key === 'trails') $('btn-trails').classList.toggle('on', s.trails);
    if (key === 'collisions') this.app.world.collisions = s.collisions;
    this.app.saveSettings();
  }

  updateSpeedLabel() {
    $('speed-label').textContent = formatRate(this.app.state.speed);
  }

  openSheet(id) {
    this.closeSheets();
    $(id).hidden = false;
    $('scrim').hidden = false;
    requestAnimationFrame(() => $(id).classList.add('open'));
  }

  closeSheets() {
    document.querySelectorAll('.sheet').forEach((s) => { s.classList.remove('open'); s.hidden = true; });
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
    const w = this.app.world;
    $('i-name').textContent = b.name;
    $('i-type').textContent = typeName(b);
    $('i-mass').textContent = formatMass(b.m);
    $('i-radius').textContent = b.kind === 'core' ? formatDistance(b.soft) + ' bulge' : formatDistance(b.r);
    let temp;
    if (b.kind === 'star' || b.kind === 'wd' || b.kind === 'ns') temp = b.temp;
    else if (b.kind === 'bh' || b.kind === 'core') temp = null;
    else {
      // Equilibrium temperature for Earth-like albedo, warmed by recent impacts.
      const flux = w.totalLight(b.x, b.y, b.z);
      temp = 278.6 * Math.pow(0.7, 0.25) * Math.pow(flux, 0.25) + b.heat * 1800;
    }
    $('i-temp').textContent = temp == null ? '—' : formatTemp(temp);
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
    const following = this.app.cam.follow === b;
    $('i-follow').textContent = following ? 'Unfollow' : 'Follow';
    $('i-follow').classList.toggle('on', following);
  }

  toast(text, big = false) {
    const t = $('toast');
    document.getElementById('app').style.setProperty('--dock-h', document.querySelector('.dock').offsetHeight + 'px');
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
    // Routine collisions can arrive many per second; let them through at most every 1.5 s.
    const now = performance.now();
    if (!ev.big && now - (this.lastEvent || 0) < 1500) return;
    this.lastEvent = now;
    this.toast(ev.text, !!ev.big);
  }

  tick(now) {
    const app = this.app;
    $('sim-time').textContent = 'T + ' + formatDuration(app.world.t);
    const lim = $('limit');
    const limited = app.world.limited && !app.state.paused;
    lim.hidden = !limited;
    if (limited) lim.textContent = 'Running at ' + formatRate(app.rate);
    this.refreshInfo(false);
    $('stat-objects').textContent = `${app.world.bodies.length} bodies · ${(app.world.np + app.world.nr).toLocaleString('en-US')} particles`;
    if (app.settings.grid) $('stat-grid').textContent = 'Grid ' + formatDistance(app.renderer.gridSpacing);
    else $('stat-grid').textContent = '';
  }
}
