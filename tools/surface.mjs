// The surface view, for judging looks: stands on a world with the Sun at a chosen elevation and looks at a
// chosen angle from it.
//   node tools/surface.mjs out.png [sunElevDeg=20] [yawFromSunDeg=40] [pitchDeg=4]
// BODY=<name> stands on that Solar System world (default Earth). GIANT=1 (with TERRA) puts a gas giant in Terra's sky. TERRA=<compKey> stands on a made-up world (Terra, 1 AU from a star) instead of Earth; with MOUNTAIN=1, in its
// most mountainous land (MOUNTAIN=high: its highest). CLOUD=<0..1> overrides
// its cloud cover. WEBGPU=1 uses the WebGPU renderer. SETTLE=<ms> waits longer before the picture (the clouds
// accumulate over frames, and software rendering here is slow). FLASH=1 shows a lightning flash ahead (NOFLASH=1: none).
// LOOKAT=<name> stands where that body is ~30° up
// in daylight (NIGHT=1: at night) and faces it.
import { chromium, devices } from 'playwright';
import { writeFileSync } from 'fs';
const [out, elevS = '20', yawS = '40', pitchS = '4'] = process.argv.slice(2);
const webgpu = process.env.WEBGPU === '1';
const args = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
if (webgpu) args.push('--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader');
const browser = await chromium.launch({ args });
const ctx = await browser.newContext({ ...devices['iPhone 13'], deviceScaleFactor: 2, viewport: { width: 844, height: 390 } });
if (webgpu) await ctx.addInitScript('window.__TEST_WEBGPU = true; window.__TEST_OFFSCREEN = true;');
const page = await ctx.newPage(); const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)); });
await page.goto('http://localhost:8080/');
await page.waitForTimeout(3000);
if (webgpu) await page.waitForFunction(() => app.r3d && app.r3d.webgpu, null, { timeout: 60000 });
await page.evaluate(async ([terra, cloud, body, giant]) => {
  app.settings.labels = false; app.settings.orbits = false; app.settings.grid = false; app.settings.perf = false;
  let b;
  if (terra) {
    const B = await import('./js/bodies.js');
    app.loadPreset('empty');
    const s = app.world.bodies.find((x) => x.kind === 'star');
    b = B.makeBody({ ...B.CATALOG.find((c) => c.id === 'earth'), name: 'Terra', compKey: terra });
    b.x = s.x + 1; b.y = s.y; b.z = s.z; b.vz = 6.28; b.life = true; app.world.addBody(b);
    // GIANT=1: a gas giant (named Giant) close by, 120° from the Sun as seen from Terra, so mostly sunlit.
    if (giant) {
      const J = B.makeBody({ ...B.CATALOG.find((c) => c.id === 'jupiter'), name: 'Giant' });
      const D = 0.0035;
      J.x = b.x + D * 0.5; J.y = b.y + D * 0.06; J.z = b.z + D * 0.866; J.vz = 6.28; app.world.addBody(J);
    }
  } else { app.loadPreset('solar'); b = app.world.findByName(body || 'Earth'); }
  app.ui.setSpeed(1 / 3650);
  app.cam.focus(b, performance.now()); app.cam.dist = app.cam.distGoal = b.r * 3;
  window.__b = b;
  if (cloud !== '') setInterval(() => { if (b.th) b.th.cloud = +cloud; }, 5);
}, [process.env.TERRA || '', process.env.CLOUD ?? '', process.env.BODY || '', !!process.env.GIANT]);
await page.waitForTimeout(4000);   // climate settles
await page.evaluate(() => { app.ui.setSpeed(0); app.state.paused = true; app.enterSurface(window.__b, 'day'); });
await page.waitForTimeout(4000);
if (process.env.TERRA && process.env.MOUNTAIN) {
  // Stand in the mountains: the land point with the highest ridges in the world's generated terrain map;
  // then turn the planet until the Sun stands at the wanted elevation (morning side).
  await page.waitForFunction(() => { const m = app.r3d.genMaps && app.r3d.genMaps.get(window.__b); return m && m.done; }, null, { timeout: 120000 });
  await page.evaluate(([elev, mode]) => {
    const r = app.r3d, g = r.gl, m = r.genMaps.get(window.__b), W = 2048, H = 1024, b = window.__b;
    g.bindFramebuffer(g.FRAMEBUFFER, m.fbo);
    g.framebufferTexture2D(g.FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.TEXTURE_2D, m.tex, 0);
    const px = new Float32Array(W * H * 4); g.readPixels(0, 0, W, H, g.RGBA, g.FLOAT, px);
    g.bindFramebuffer(g.FRAMEBUFFER, null);
    const sea = 0.3 + 0.36 * (b.th ? b.th.ocean : 0.7);
    let best = -1, bi = 0;
    for (let y = H * 0.25; y < H * 0.75; y += 2) for (let x = 0; x < W; x += 2) {
      const o = (y * W + x) * 4, score = (mode === "high" ? px[o] + 0.14 * px[o + 1] : px[o + 1]) * (px[o] > sea + 0.03 ? 1 : 0);   // the most mountainous (or MOUNTAIN=high: the highest) land
      if (score > best) { best = score; bi = y * W + x; }
    }
    const u = (bi % W + 0.5) / W, v = (Math.floor(bi / W) + 0.5) / H;
    const sv = app.surface;
    sv.lat = (0.5 - v) * Math.PI; sv.lon = -(u - 0.5) * 2 * Math.PI; sv.place = false;
    const sp = r.spin.get(b);
    let bestA = sp.ang, bestE = 1e9;
    for (let k = 0; k < 360; k++) {
      sp.ang = (k / 360) * Math.PI * 2;
      app.updateSurface();
      const s = sv.sun, n = sv.up, e = Math.asin(s[0] * n[0] + s[1] * n[1] + s[2] * n[2]) * 180 / Math.PI;
      const de = Math.abs(e - elev);
      if (de < bestE) { bestE = de; bestA = sp.ang; }
    }
    sp.ang = bestA; app.updateSurface();
  }, [+elevS, process.env.MOUNTAIN]);
} else {
  // Walk away from the subsolar point until the Sun stands at the wanted elevation.
  await page.evaluate(([elev]) => {
    const sv = app.surface;
    sv.lon -= (90 - elev) * Math.PI / 180;
  }, [+elevS]);
}
await page.waitForTimeout(3000);
// LOOKAT: move around the globe to where that body stands ~30° up, with the Sun up (or down with NIGHT=1).
if (process.env.LOOKAT) await page.evaluate(([look, night]) => {
  const sv = app.surface, t = app.world.findByName(look);
  let best = null;
  for (let la = -60; la <= 60; la += 15) for (let lo = 0; lo < 360; lo += 10) {
    sv.lat = la * Math.PI / 180; sv.lon = lo * Math.PI / 180; sv.place = false;
    app.updateSurface();
    const e = app.cam.override.eye, n = sv.up, s = sv.sun;
    const v = [t.x - e[0], t.y - e[1], t.z - e[2]], l = Math.hypot(...v);
    const te = Math.asin((v[0] * n[0] + v[1] * n[1] + v[2] * n[2]) / l) * 180 / Math.PI;
    const se = Math.asin(s[0] * n[0] + s[1] * n[1] + s[2] * n[2]) * 180 / Math.PI;
    const ok = night ? se < -12 : se > 20;
    const score = Math.abs(te - 30) + (ok ? 0 : 1000);
    if (!best || score < best.score) best = { score, la, lo };
  }
  sv.lat = best.la * Math.PI / 180; sv.lon = best.lo * Math.PI / 180; app.updateSurface();
}, [process.env.LOOKAT, !!process.env.NIGHT]);
const info = await page.evaluate(([yaw, pitch, look]) => {
  const sv = app.surface, s = sv.sun, n = sv.up, N = sv.north;
  const E = [N[1] * n[2] - N[2] * n[1], N[2] * n[0] - N[0] * n[2], N[0] * n[1] - N[1] * n[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  sv.yaw = Math.atan2(dot(s, E), dot(s, N)) + yaw * Math.PI / 180; sv.pitch = pitch * Math.PI / 180;
  // LOOKAT=<name>: face that body instead.
  if (look) {
    const t = app.world.findByName(look), e = app.cam.override.eye;
    const v = [t.x - e[0], t.y - e[1], t.z - e[2]], l = Math.hypot(...v), u = v.map((x) => x / l);
    sv.yaw = Math.atan2(dot(u, E), dot(u, N)); sv.pitch = Math.asin(dot(u, n));
    // (Elongation from the Sun: near 0 the Moon is new, dark side toward us.)
    return { sunElev: Math.asin(dot(s, n)) * 180 / Math.PI, target: look, elev: sv.pitch * 180 / Math.PI, elong: Math.acos(dot(u, s)) * 180 / Math.PI, distR: l / window.__b.r };
  }
  return { sunElev: Math.asin(dot(s, n)) * 180 / Math.PI };
}, [+yawS, +pitchS, process.env.LOOKAT || '']);
// SNOW=1: snow instead of rain (as below freezing).
if (process.env.SNOW) await page.evaluate(() => { const r = app.r3d, upd = r.updateWeather.bind(r); r.updateWeather = (a, b) => { const x = upd(a, b); x.snow = true; x.flash = null; x.flashI = 0; x.next = Infinity; return x; }; });
// NOFLASH=1: no lightning.
if (process.env.NOFLASH) await page.evaluate(() => { const r = app.r3d, upd = r.updateWeather.bind(r); r.updateWeather = (a, b) => { const x = upd(a, b); x.flash = null; x.flashI = 0; x.next = Infinity; return x; }; });
// FLASH=1: strike lightning now, ahead of the camera (the picture is taken during the flash).
if (process.env.FLASH) await page.waitForTimeout(3000);   // (the camera takes the new direction on the next frame)
if (process.env.FLASH) await page.evaluate(() => {
  const r = app.r3d, w = r.weather || (r.weather = { next: 0, flash: null, flashI: 0, dir: [0, 1, 0] });
  const sv = app.surface, f = app.cam.override.f, n = sv.up;
  const h = f.map((v, i) => v - n[i] * (f[0] * n[0] + f[1] * n[1] + f[2] * n[2])), hl = Math.hypot(...h);
  const D = h.map((v, i) => (v / hl) * Math.cos(0.38) + n[i] * Math.sin(0.38));   // (2 km up, 5 km away)
  // Freeze the flash at its peak for the picture (and keep the app's own strikes away).
  const upd = r.updateWeather.bind(r);
  r.updateWeather = (sv2, now) => { const x = upd(sv2, now); x.flash = null; x.next = Infinity; x.flashI = 1; x.dir = D; return x; };
});
await page.waitForTimeout(+(process.env.SETTLE || (webgpu ? 15000 : 6000)));
const png = webgpu
  ? await page.evaluate(async () => { const { w, h, data } = await app.r3d.gl.readDefault(); const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data), w, h), 0, 0); return c.toDataURL('image/png'); })
  : await page.evaluate(() => new Promise((ok) => requestAnimationFrame(() => ok(app.r3d.canvas.toDataURL('image/png')))));
writeFileSync(out, Buffer.from(png.split(',')[1], 'base64'));
console.log(JSON.stringify(info), errs.slice(0, 3), process.env.DBG ? await page.evaluate(() => JSON.stringify({ w: app.r3d.weather, clouds: app.r3d.cloudsNow, ang: (() => { const f = app.cam.override.f, d = app.r3d.weather.dir, n = app.surface.up; return [Math.acos(f[0]*d[0]+f[1]*d[1]+f[2]*d[2]) * 57.3, Math.asin(d[0]*n[0]+d[1]*n[1]+d[2]*n[2]) * 57.3, Math.asin(f[0]*n[0]+f[1]*n[1]+f[2]*n[2]) * 57.3]; })(), fl: (() => { const r = app.r3d, g = r.gl; g.useProgram(r.pComp.p); const f = Array.from(g.getUniform(r.pComp.p, r.pComp.u.uFlare)); const p = r.post; g.bindFramebuffer(g.FRAMEBUFFER, p.scene.fbo); const out = []; for (let dy = -6; dy <= 6; dy += 3) { const px = new Float32Array(4); g.readPixels(Math.round(f[0] * p.W), Math.round(f[1] * p.H) + dy, 1, 1, g.RGBA, g.FLOAT, px); out.push(px[0].toFixed(2)); } g.bindFramebuffer(g.FRAMEBUFFER, null); return f.concat(out); })(), uf: (() => { const r = app.r3d, g = r.gl; g.useProgram(r.pSurfSky.p); return [r.pSurfSky.u.uFlash ? Array.from(g.getUniform(r.pSurfSky.p, r.pSurfSky.u.uFlash)) : 'noloc', r.pSurfSky.u.uRes ? Array.from(g.getUniform(r.pSurfSky.p, r.pSurfSky.u.uRes)) : 'noloc']; })(), T: app.surface.localT, th: { c: window.__b.th.cloud, l: window.__b.th.liquid } })) : '');
await browser.close();
