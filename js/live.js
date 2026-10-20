// Live data, in the copy served from the web (not the claude.ai artifact, whose page may not reach other sites): fresh
// orbital elements from CelesTrak (a few groups, filtered to the craft in presets.js) and the planetary Kp index
// from NOAA's Space Weather Prediction Center. Both send CORS headers. Kept in localStorage (elements for 6 hours,
// Kp for 15 minutes); on any failure, or offline, the last fetched or built-in data (js/livedata.js) stays.
import { LIVE_DATA } from './livedata.js';
import { gpState } from './presets.js';

const GROUPS = ['stations', 'science', 'weather', 'resource', 'gps-ops'];
const KEY = 'pu-live';
const IDS = new Map(Object.entries(LIVE_DATA.gp).map(([name, g]) => [g.id, name]));
const pick = (g) => ({ name: g.OBJECT_NAME, id: g.NORAD_CAT_ID, epoch: g.EPOCH, n: g.MEAN_MOTION, e: g.ECCENTRICITY, i: g.INCLINATION, raan: g.RA_OF_ASC_NODE, w: g.ARG_OF_PERICENTER, M: g.MEAN_ANOMALY });

function load() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } }
function save(c) { try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* private mode */ } }
async function getJSON(url, ms = 15000) {
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), ms);
  try { const r = await fetch(url, { signal: ac.signal, cache: 'no-cache' }); if (!r.ok) throw new Error(r.status); return await r.json(); }
  finally { clearTimeout(t); }
}

// Start: apply what is cached, then refresh what is stale. app.live holds the state for Settings.
export async function startLive(app) {
  app.live = { status: 'built-in data', kp: null };
  if (typeof window === 'undefined' || window.__KTX_EXT__ || !('fetch' in window)) { app.live.status = 'built-in data (live feeds need the web copy)'; return; }
  const c = load();
  if (c.gp) apply(app, c);
  const now = Date.now();
  if (!c.gpT || now - c.gpT > 6 * 3600e3) {
    try {
      const gp = {}, gps = [];
      for (const g of GROUPS) {
        const list = await getJSON(`https://celestrak.org/NORAD/elements/gp.php?GROUP=${g}&FORMAT=json`);
        for (const e of list) {
          if (g === 'gps-ops') gps.push(pick(e));
          else if (IDS.has(e.NORAD_CAT_ID)) gp[IDS.get(e.NORAD_CAT_ID)] = pick(e);
        }
      }
      if (Object.keys(gp).length || gps.length) { c.gp = { ...(c.gp || {}), ...gp }; if (gps.length) c.gps = gps; c.gpT = now; save(c); apply(app, c); }
    } catch (e) { console.warn('Live elements:', e.message || e); }
  }
  const kp = async () => {
    try {
      const rows = await getJSON('https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json');
      const last = rows[rows.length - 1];
      const v = Array.isArray(last) ? +last[1] : +last.Kp;   // (older feed: arrays with a header row; current: objects)
      if (isFinite(v)) { c.kp = v; c.kpT = Date.now(); c.kpAt = Array.isArray(last) ? last[0] : last.time_tag; save(c); applyKp(app, c); }
    } catch (e) { console.warn('Live Kp:', e.message || e); }
  };
  if (c.kp != null) applyKp(app, c);
  if (!c.kpT || now - c.kpT > 15 * 60e3) await kp();
  setInterval(kp, 15 * 60e3);
}

// Fresh elements: the next scenario load uses them (presets.js reads window.__LIVE); a dated Solar System already
// running has its craft moved to them now, at its own clock.
function apply(app, c) {
  window.__LIVE = { ...LIVE_DATA, gp: { ...LIVE_DATA.gp, ...(c.gp || {}) }, gps: c.gps && c.gps.length ? c.gps : LIVE_DATA.gps, fetched: new Date(c.gpT || Date.now()).toISOString() };
  const w = app.world;
  app.live.status = `satellites from CelesTrak, ${new Date(c.gpT).toLocaleString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} UTC`;
  if (!w.epoch || !app.state.preset || app.state.preset.id !== 'solar') return;
  const E = w.findByName('Earth'), ms = w.epoch + w.t * 365.25 * 86400e3;
  if (!E) return;
  for (const b of w.bodies) {
    const g = b.craft && b.minor && b.host === E && window.__LIVE.gp[b.name];
    if (!g) continue;
    const s = gpState(E, g, ms);
    b.x = E.x + s[0]; b.y = E.y + s[1]; b.z = E.z + s[2]; b.vx = E.vx + s[3]; b.vy = E.vy + s[4]; b.vz = E.vz + s[5];
  }
}

function applyKp(app, c) {
  app.world.kp = c.kp;
  app.live.kp = c.kp; app.live.kpAt = c.kpAt;
  if (app.ui && app.ui.skyCard) app.ui.skyCard();
}
