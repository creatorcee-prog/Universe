// For scripts and AI testers: window.pocket, a small command set over the app (the simulation itself is one
// canvas, which an agent reading the page can't see into), and links that open a scenario directly:
//   ?scenario=solar&focus=Earth&speed=0.01&watch=Orionids   (?view=<scenario id> works too)
import { PRESETS } from './presets.js';
import { SHOWERS } from './events.js';

export function installAgentAPI(app) {
  const find = (name) => {
    if (!name) return null;
    const b = app.world.findByName(name);
    if (b) return b;
    const n = String(name).toLowerCase();
    return app.world.bodies.find((x) => x.alive !== false && String(x.ident || x.name).toLowerCase() === n) || null;
  };
  const summary = (b) => b && { name: b.ident || b.name, kind: b.kind, mass: b.m, radius: b.r, x: b.x, y: b.y, z: b.z };
  const api = {
    help: () => 'pocket.scenarios() · pocket.load(id) · pocket.bodies() · pocket.select(name) · pocket.focus(name) · ' +
      'pocket.where(name) -> {x, y} in CSS pixels, to tap · pocket.tap(x, y) · pocket.speed(yearsPerSecond) · pocket.pause(bool) · ' +
      'pocket.tool(view|add|paint|laser|delete) · pocket.view(realistic|pixel|...) · pocket.surface(name) · pocket.watch(showerName) · pocket.state()',
    scenarios: () => PRESETS.filter((p) => !p.hidden).map((p) => ({ id: p.id, name: p.name, cat: p.cat || 'scenario' })),
    load: (id) => { app.loadPreset(id); return api.state(); },
    bodies: () => app.world.bodies.filter((b) => b.alive !== false).map(summary),
    select: (name) => { const b = find(name); app.select(b); return summary(b); },
    focus: (name) => { const b = find(name); if (b) app.doubleTap(b); return summary(b); },
    where: (name) => {
      const b = find(name), o = {};
      if (!b || app.cam.project(b.x, b.y, b.z, o) === -1) return null;
      const d = app.renderer.dpr || 1;
      return { x: o.x / d, y: o.y / d };
    },
    tap: (x, y) => { app.input.tap(x, y); return summary(app.state.selected); },
    speed: (yr) => { app.ui.setSpeed(yr); return app.state.speed; },
    pause: (p = true) => { app.ui.setPaused(p); return app.state.paused; },
    tool: (t) => { app.ui.setTool(t); return app.state.tool; },
    view: (v) => { app.setView(v); return v; },
    surface: (name) => { const b = find(name); if (b) app.enterSurface(b); return !!app.surface; },
    watch: (name) => { const s = SHOWERS.find((x) => x.name.toLowerCase() === String(name).toLowerCase()); if (s) app.watchShower(s); return !!s; },
    state: () => ({
      scenario: app.state.preset && app.state.preset.id, simYears: app.world.t, speed: app.state.speed, paused: app.state.paused,
      tool: app.state.tool, selected: summary(app.state.selected), following: summary(app.cam.follow), bodies: app.world.bodies.length,
      surface: app.surface ? (app.surface.body.ident || app.surface.body.name) : null,
    }),
  };
  window.pocket = api;

  // Links: the bot's (and anyone's) way into a scenario.
  let q;
  try { q = new URLSearchParams(location.search); } catch { return; }
  const id = q.get('scenario') || q.get('view');
  if (id && PRESETS.some((p) => p.id === id)) app.loadPreset(id);
  const f = q.get('focus');
  if (f) setTimeout(() => api.focus(f), 300);
  const sp = parseFloat(q.get('speed'));
  if (isFinite(sp) && sp > 0) app.ui.setSpeed(sp);
  const w = q.get('watch');
  if (w) setTimeout(() => api.watch(w), 600);
}
