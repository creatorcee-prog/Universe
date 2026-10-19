import { G, formatMass, formatDistance, formatSpeed, formatDuration, formatTemp } from './units.js';
import { typeName, isLuminous } from './bodies.js';
import { orbitOf } from './physics.js';
import { ENTRIES, TYPES, CONTENTS, typeKey } from './facts.js';
import { lifetime } from './stellar.js';
import { listReasons } from './thermal.js';

const MSUN_KG = 1.98847e30, AU_M = 1.495978707e11, G_SI = 6.674e-11;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// A sphere painted with CSS gradients, standing in for a photo of the object.
// Returns [background, round]: round portraits are clipped to a circle (planets), the rest glow freely.
function portrait(kind, color, band, comet) {
  const [r, g, b] = color || [180, 180, 180];
  if (kind === 'bh' || kind === 'smbh') return ['radial-gradient(circle, #000 0 30%, #ffe2b8 33%, rgba(255,150,70,.6) 42%, rgba(255,120,50,.15) 58%, transparent 70%)', false];
  if (kind === 'galaxy') return ['radial-gradient(ellipse 50% 22% at 50% 50%, rgba(255,236,200,.95), rgba(190,200,255,.35) 55%, transparent 70%)', false];
  if (kind === 'star' || kind === 'wd' || kind === 'ns') return [`radial-gradient(circle, #fff 0 22%, rgb(${r},${g},${b}) 42%, rgba(${r},${g},${b},.3) 58%, transparent 72%)`, false];
  if (comet) return ['radial-gradient(circle at 30% 70%, #fff 0 4%, rgba(200,225,255,.6) 12%, transparent 30%), linear-gradient(35deg, transparent 30%, rgba(160,200,255,.35) 32%, transparent 70%)', false];
  const shade = 'radial-gradient(circle at 32% 30%, rgba(255,255,255,.32), transparent 38%, rgba(2,3,8,.55) 62%, rgba(2,3,8,.92) 80%)';
  const bands = band ? `repeating-linear-gradient(172deg, transparent 0 8%, rgba(${band[0]},${band[1]},${band[2]},.6) 8% 12%), ` : '';
  return [`${shade}, ${bands}rgb(${r},${g},${b})`, true];
}

function kindFromKey(key) {
  if (['M', 'K', 'G', 'F', 'A', 'B', 'O'].includes(key)) return 'star';
  return key;
}

const KEY_COLOR = {
  M: [255, 170, 110], K: [255, 205, 150], G: [255, 240, 220], F: [250, 248, 255], A: [215, 228, 255], B: [180, 205, 255], O: [160, 190, 255],
  wd: [220, 230, 255], ns: [190, 220, 255], comet: [196, 204, 214], asteroid: [150, 140, 128], planetesimal: [170, 150, 130],
  terrestrial: [64, 118, 214], superearth: [120, 150, 120], icegiant: [90, 130, 220], gasgiant: [216, 182, 136], browndwarf: [150, 80, 60],
  moonsize: [180, 178, 172], smallrocky: [196, 110, 70],
};
const ENTRY_COLOR = {
  Sun: [255, 240, 220], Mercury: [168, 160, 150], Venus: [232, 204, 150], Earth: [64, 118, 214], Moon: [184, 182, 176], Mars: [200, 104, 62],
  Ceres: [150, 144, 136], Jupiter: [216, 182, 136], Io: [226, 204, 110], Europa: [210, 196, 176], Ganymede: [160, 150, 138], Callisto: [110, 100, 92],
  Saturn: [228, 208, 162], Uranus: [168, 222, 232], Neptune: [84, 124, 222], Pluto: [214, 190, 160], Theia: [190, 160, 130], 'Proto-Earth': [150, 100, 80],
};

export class Book {
  constructor(app) {
    this.app = app;
    this.body = null;
    this.timer = 0;
    $('book-close').addEventListener('click', () => this.close());
    $('book-tab-entry').addEventListener('click', () => this.showEntryView());
    $('book-tab-contents').addEventListener('click', () => this.showContents());
    $('book-prev').addEventListener('click', () => this.turn(-1));
    $('book-next').addEventListener('click', () => this.turn(1));
    $('book-pages').addEventListener('scroll', () => this.updateFolio(), { passive: true });
    this.buildContents();
  }

  // What the book holds for a live body, for the info panel's pointer to it: the lede's first sentence and the
  // page titles, in the order renderBody lays them out.
  static preview(b) {
    const entry = ENTRIES[b.name] || null, type = TYPES[typeKey(b)];
    const text = entry ? entry.summary : type.text;
    const first = (text.match(/^.*?[.!?](?=\s|$)/) || [text])[0];
    const pages = ['Overview'];
    if (entry && entry.facts.length) pages.push(`${entry.facts.length} facts`);
    pages.push('Live numbers', type.title, 'Sources');
    return { first, pages, real: !!entry };
  }

  get isOpen() { return !$('book').hidden; }

  // Open on a live body, or on a reference entry / type key when browsing the contents.
  // page: start on that page (an index into preview(body).pages).
  open(body, page = 0) {
    this.body = body || null;
    this.startPage = page;
    this.ref = null;
    $('book').hidden = false;
    requestAnimationFrame(() => $('book').classList.add('open'));
    if (body) this.renderBody(body); else this.showContents();
    clearInterval(this.timer);
    this.timer = setInterval(() => this.refreshLive(), 500);
  }

  close() {
    $('book').classList.remove('open');
    $('book').hidden = true;
    clearInterval(this.timer);
  }

  showEntryView() {
    if (!this.body && !this.ref) return;
    $('book-contents').hidden = true;
    $('book-pages').hidden = false;
    $('book-foot').hidden = false;
    $('book-tab-entry').classList.add('on');
    $('book-tab-contents').classList.remove('on');
  }

  showContents() {
    $('book-contents').hidden = false;
    $('book-pages').hidden = true;
    $('book-foot').hidden = true;
    $('book-tab-contents').classList.add('on');
    $('book-tab-entry').classList.remove('on');
    $('book-tab-entry').disabled = !this.body && !this.ref;
    for (const el of document.querySelectorAll('.toc-item')) {
      el.classList.toggle('in-sim', !!this.app.world.findByName(el.dataset.name));
    }
  }

  buildContents() {
    const wrap = $('book-contents');
    let html = '<p class="toc-intro">Every entry in this book. Entries marked with a dot are in the current scenario; open one to see its live numbers too.</p>';
    for (const [group, keys] of CONTENTS) {
      html += `<h3 class="toc-group">${esc(group)}</h3><div class="toc-list">`;
      for (const k of keys) {
        const isType = !!TYPES[k];
        const label = isType ? TYPES[k].title : k;
        const sub = isType ? 'Kind of object' : ENTRIES[k].kicker;
        html += `<button class="toc-item" type="button" data-key="${esc(k)}" data-name="${isType ? '' : esc(k)}"><span class="toc-title">${esc(label)}</span><span class="toc-sub">${esc(sub)}</span></button>`;
      }
      html += '</div>';
    }
    wrap.innerHTML = html;
    wrap.addEventListener('click', (e) => {
      const b = e.target.closest('.toc-item');
      if (!b) return;
      const key = b.dataset.key;
      const live = !TYPES[key] && this.app.world.findByName(key);
      if (live) this.renderBody(live); else this.renderRef(key);
    });
  }

  renderBody(b) {
    this.body = b;
    this.ref = null;
    const entry = ENTRIES[b.name] || null;
    const tk = typeKey(b);
    const type = TYPES[tk];
    const pages = [];
    pages.push(this.coverPage({
      kicker: entry ? entry.kicker : typeName(b),
      title: b.name,
      summary: entry ? entry.summary : type.text,
      portrait: portrait(b.kind === 'bh' && b.m > 1e5 ? 'smbh' : b.kind === 'core' ? 'galaxy' : b.kind, b.color, b.band, b.comet),
      stats: entry ? entry.stats : null,
      statsTitle: entry ? 'In the real universe' : null,
      note: entry ? null : 'This object was made in the simulation, so it has no real-world record. The pages that follow describe objects of its kind and its live numbers.',
    }));
    if (entry && entry.facts.length) pages.push(this.listPage('Did you know?', entry.facts));
    pages.push(this.livePage(b));
    pages.push(this.typePage(type));
    pages.push(this.sourcesPage([...(entry ? entry.sources : []), ...type.sources]));
    this.mount(pages);
    this.refreshLive();
  }

  renderRef(key) {
    this.body = null;
    this.ref = key;
    const entry = ENTRIES[key];
    const pages = [];
    if (entry) {
      pages.push(this.coverPage({ kicker: entry.kicker, title: key, summary: entry.summary, portrait: portrait(key === 'Sun' ? 'star' : 'x', ENTRY_COLOR[key], key === 'Jupiter' || key === 'Saturn' ? [170, 120, 80] : null, key === "Halley's Comet"), stats: entry.stats, statsTitle: 'In the real universe', note: 'This object is not in the current scenario. Load the Solar System to visit it.' }));
      if (entry.facts.length) pages.push(this.listPage('Did you know?', entry.facts));
      pages.push(this.sourcesPage(entry.sources));
    } else {
      const t = TYPES[key];
      pages.push(this.coverPage({ kicker: 'Kind of object', title: t.title, summary: t.text, portrait: portrait(kindFromKey(key), KEY_COLOR[key], key === 'gasgiant' ? [170, 120, 80] : null, key === 'comet') }));
      pages.push(this.listPage('Did you know?', t.facts));
      pages.push(this.sourcesPage(t.sources));
    }
    this.mount(pages);
  }

  mount(pages) {
    const el = $('book-pages');
    el.innerHTML = pages.join('');
    this.showEntryView();
    // Reset after the pages are visible; a hidden scroller ignores scroll positions.
    const left = () => (this.startPage || 0) * el.clientWidth;
    el.scrollTo({ left: left(), behavior: 'auto' });
    requestAnimationFrame(() => { el.scrollTo({ left: left(), behavior: 'auto' }); this.startPage = 0; this.updateFolio(); });
    this.updateFolio();
  }

  coverPage({ kicker, title, summary, portrait: bg, stats, statsTitle, note }) {
    let h = `<article class="page cover" data-title="Overview"><div class="page-in">`;
    h += `<div class="portrait${bg[1] ? ' round' : ''}" style="background:${bg[0]}" aria-hidden="true"></div>`;
    h += `<p class="kicker">${esc(kicker)}</p><h2 class="book-title">${esc(title)}</h2>`;
    h += `<p class="lede">${esc(summary)}</p>`;
    if (note) h += `<p class="note">${esc(note)}</p>`;
    if (stats) {
      h += `<h3 class="sec">${esc(statsTitle)}</h3><dl class="facts">`;
      for (const [k, v] of stats) h += `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`;
      h += '</dl>';
    }
    return h + '</div></article>';
  }

  listPage(title, items) {
    return `<article class="page" data-title="${esc(title)}"><div class="page-in"><h3 class="page-head">${esc(title)}</h3><ul class="dyk">${items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div></article>`;
  }

  typePage(t) {
    return `<article class="page" data-title="${esc(t.title)}"><div class="page-in"><p class="kicker">About this kind of object</p><h3 class="page-head">${esc(t.title)}</h3><p class="body-text">${esc(t.text)}</p><ul class="dyk">${t.facts.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div></article>`;
  }

  sourcesPage(list) {
    const seen = new Set();
    const items = list.filter(([, u]) => !seen.has(u) && seen.add(u));
    return `<article class="page" data-title="Sources"><div class="page-in"><h3 class="page-head">Sources</h3><p class="body-text">Real-world figures come from these references. Numbers in the live pages come from the simulation itself.</p><ul class="sources">${items.map(([l, u]) => `<li><a href="${esc(u)}" target="_blank" rel="noopener">${esc(l)}</a><span class="url">${esc(u.replace(/^https:\/\//, ''))}</span></li>`).join('')}</ul></div></article>`;
  }

  livePage() {
    return `<article class="page" data-title="In your universe"><div class="page-in"><p class="kicker">Live from the simulation</p><h3 class="page-head">In your universe</h3><p class="body-text" id="live-lede"></p><dl class="facts live" id="live-facts"></dl></div></article>`;
  }

  // Physical quantities for the live page, converted to everyday units.
  refreshLive() {
    if (!this.isOpen || !this.body) return;
    const w = this.app.world;
    let b = this.body;
    if (!b.alive) {
      const r = w.resolve(b);
      const lede = $('live-lede');
      if (lede) lede.textContent = r ? `${b.name} merged into ${r.name}.` : `${b.name} no longer exists. It was destroyed in the simulation.`;
      const f = $('live-facts');
      if (f) f.innerHTML = '';
      return;
    }
    const rows = [];
    const Mkg = b.m * MSUN_KG, Rm = b.r * AU_M;
    rows.push(['Type', typeName(b)]);
    rows.push(['Mass', formatMass(b.m)]);
    if (b.kind === 'core') rows.push(['Bulge radius', formatDistance(b.soft)]);
    else rows.push([b.kind === 'bh' ? 'Event-horizon radius' : 'Radius', formatDistance(b.r)]);
    if (b.kind !== 'bh' && b.kind !== 'core' && Rm > 0) {
      const rho = Mkg / ((4 / 3) * Math.PI * Rm ** 3);
      rows.push(['Mean density', rho > 1e7 ? rho.toExponential(2).replace('e+', ' × 10^') + ' kg/m³' : Math.round(rho).toLocaleString('en-US') + ' kg/m³']);
      const g = (G_SI * Mkg) / (Rm * Rm);
      rows.push(['Surface gravity', g > 1e5 ? g.toExponential(2).replace('e+', ' × 10^') + ' m/s²' : `${g.toPrecision(3)} m/s² (${(g / 9.81).toPrecision(3)} g)`]);
      rows.push(['Escape velocity', formatSpeed(Math.sqrt((2 * G * b.m) / b.r))]);
    }
    if (b.kind === 'bh' && b.lum > 0) {
      rows.push(['Accretion disk', `${b.lum.toPrecision(3)} × the Sun's light, from gas falling in (about 10% of its mass-energy)`]);
      rows.push(['Feeding', `${(b.mdot / 3.003e-6).toPrecision(3)} Earth masses a year`]);
    } else if (isLuminous(b)) {
      rows.push(['Surface temperature', formatTemp(b.temp)]);
      rows.push(['Luminosity', `${b.lum.toPrecision(3)} × the Sun`]);
      if (b.kind === 'star' && b.age !== undefined) {
        const life = lifetime(b.m0 || b.m);
        rows.push(['Age', `${formatDuration(b.age)} of about ${formatDuration(life)}`]);
        rows.push(['Stage', b.giant > 0 ? (b.m0 >= 8 ? 'Red supergiant' : 'Red giant') : 'Main sequence (fusing hydrogen)']);
        rows.push(['Fate', (b.m0 || b.m) >= 8 ? (b.m0 >= 20 ? 'Supernova, then a black hole' : 'Supernova, then a neutron star') : 'Planetary nebula, then a white dwarf']);
      }
    } else if (b.th) {
      const th = b.th, c = b.comp, atm = b.atm;
      rows.push(['Surface temperature', `${formatTemp(th.Ts)} (${Math.round(th.Ts - 273.15)} °C)`]);
      rows.push(['Sunlight received', `${th.flux < 0.01 ? th.flux.toExponential(1) : th.flux.toPrecision(3)} × Earth's`]);
      rows.push(['Albedo (reflectivity)', `${Math.round(th.albedo * 100)}%`]);
      const tot = c.iron + c.rock + c.water + c.ice + c.gas || 1;
      const parts = [['hydrogen/helium', c.gas], ['rock', c.rock], ['iron', c.iron], ['water', c.water], ['other ices', c.ice]]
        .filter(([, f]) => f > 0).sort((a, z) => z[1] - a[1])
        .map(([n, f]) => { const p = (f / tot) * 100; return `${p >= 1 ? Math.round(p) : p >= 0.01 ? p.toPrecision(2) : p.toExponential(0)}% ${n}`; });
      rows.push(['Composition', parts.join(', ')]);
      if (b.kind === 'rocky') {
        const p = atm.p + th.steam;
        const g = atm.gases;
        const names = { n2: 'N₂', o2: 'O₂', co2: 'CO₂', ch4: 'CH₄', h2: 'H₂' };
        const total = p;
        const mix = Object.entries({ ...g, steam: th.steam }).filter(([, v]) => v > 0 && v / total > 1e-6).sort((a, z) => z[1] - a[1])
          .map(([k, v]) => { const pc = (v / total) * 100; return `${pc >= 1 ? Math.round(pc) : pc >= 0.01 ? pc.toPrecision(2) : pc.toExponential(0)}% ${k === 'steam' ? 'H₂O' : names[k]}`; });
        rows.push(['Atmosphere', p < 1e-6 ? 'None' : `${p < 0.01 ? p.toExponential(1) : p.toPrecision(3)} bar: ${mix.join(', ')}`]);
        if (th.tau > 0.01) rows.push(['Greenhouse optical depth', th.tau.toPrecision(3)]);
        if (c.water > 0) {
          const state = th.steam > 1 && th.liquid < 0.01 ? 'Boiled off into the atmosphere'
            : th.ocean === 0 ? (th.ice < 0.3 ? 'None; its water is locked in polar ice' : 'Frozen over')
            : `${Math.round(th.liquid * 100)}% of surface liquid`;
          rows.push(['Oceans', state]);
          rows.push(['Ice cover', `${Math.round(th.ice * 100)}% of surface`]);
          rows.push(['Water boils at', formatTemp(th.boil)]);
        }
        const dT = th.Eint / (b.m * 1.98847e30 * 900);
        if (dT > 5) rows.push(['Stored impact heat', `≈ ${Math.round(dT).toLocaleString('en-US')} K above normal (cooling)`]);
      }
    }
    const hier = w.hierarchy();
    const parent = hier.get(b)?.parent;
    const the = (o) => (o.name === 'Sun' || o.name === 'Moon' ? 'the ' + o.name : o.name);
    let lede = `${b.name} is a ${typeName(b).replace(/^./, (c) => c.toLowerCase())} in the ${this.app.state.preset.name} scenario.`;
    if (parent) {
      const o = orbitOf(b, parent);
      rows.push(['Orbiting', parent.name]);
      rows.push(['Distance', formatDistance(o.r)]);
      rows.push(['Orbital speed', formatSpeed(o.v)]);
      if (o.bound && parent.soft === 0) rows.push(['Orbital period', formatDuration(o.period)]);
      rows.push(['Eccentricity', o.bound ? o.e.toFixed(3) : `${o.e.toFixed(2)} (escaping)`]);
      lede += o.bound ? ` It is in orbit around ${the(parent)}.` : ` It is on an escape path away from ${the(parent)}.`;
    }
    const kids = [];
    for (const [c, info] of hier) if (info.parent === b) kids.push(c);
    if (kids.length) rows.push(['Orbited by', kids.length <= 4 ? kids.map((c) => c.name).join(', ') : `${kids.length} bodies`]);
    if (b.th && b.kind === 'rocky') lede += ' Its temperature, ice and oceans come from its distance to its star, its composition and atmosphere, and the heat left by impacts.';
    if (b.heat > 0.05) rows.push(['Impact heating', `${Math.round(b.heat * 100)}% (cooling)`]);
    const entry = ENTRIES[b.name];
    if (entry && b.m0 && Math.abs(b.m / b.m0 - 1) > 0.01) lede += ` Its mass is now ${(b.m / b.m0).toPrecision(3)}× what it started with.`;
    rows.push(['Simulation time', 'T + ' + formatDuration(w.t)]);
    // Habitability checklist.
    if (b.th && b.th.hab && b.kind === 'rocky') {
      const h = b.th.hab;
      const why = h.reasons && h.reasons.length ? ': ' + listReasons(h.reasons) : '';
      rows.push(['Can life exist here?', `${h.verdict}${why}${b.life ? ' · life present' : ''}`]);
      for (const [label, ok, detail] of h.checks) rows.push([`${ok ? '✓' : '✗'} ${label}`, detail]);
    }
    const lEl = $('live-lede'), fEl = $('live-facts');
    if (!lEl || !fEl) return;
    lEl.textContent = lede;
    fEl.innerHTML = rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');
  }

  turn(dir) {
    const el = $('book-pages');
    el.scrollTo({ left: el.scrollLeft + dir * el.clientWidth, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }

  updateFolio() {
    const el = $('book-pages');
    const pages = el.querySelectorAll('.page');
    if (!pages.length) return;
    const i = Math.max(0, Math.min(pages.length - 1, Math.round(el.scrollLeft / Math.max(1, el.clientWidth))));
    $('book-folio').textContent = `${i + 1} / ${pages.length} · ${pages[i].dataset.title}`;
    $('book-prev').disabled = i === 0;
    $('book-next').disabled = i === pages.length - 1;
  }
}
