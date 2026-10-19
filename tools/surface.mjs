// The surface view, for judging looks: stands on a world with the Sun at a chosen elevation and looks at a
// chosen angle from it.
//   node tools/surface.mjs out.png [sunElevDeg=20] [yawFromSunDeg=40] [pitchDeg=4]
// TERRA=<compKey> stands on a made-up world (Terra, 1 AU from a star) instead of Earth; with MOUNTAIN=1, in its
// most mountainous land (MOUNTAIN=high: its highest). CLOUD=<0..1> overrides
// its cloud cover. WEBGPU=1 uses the WebGPU renderer. SETTLE=<ms> waits longer before the picture (the clouds
// accumulate over frames, and software rendering here is slow).
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
await page.goto('http://localhost:8080/');
await page.waitForTimeout(3000);
if (webgpu) await page.waitForFunction(() => app.r3d && app.r3d.webgpu, null, { timeout: 60000 });
await page.evaluate(async ([terra, cloud]) => {
  app.settings.labels = false; app.settings.orbits = false; app.settings.grid = false; app.settings.perf = false;
  let b;
  if (terra) {
    const B = await import('./js/bodies.js');
    app.loadPreset('empty');
    const s = app.world.bodies.find((x) => x.kind === 'star');
    b = B.makeBody({ ...B.CATALOG.find((c) => c.id === 'earth'), name: 'Terra', compKey: terra });
    b.x = s.x + 1; b.y = s.y; b.z = s.z; b.vz = 6.28; b.life = true; app.world.addBody(b);
  } else { app.loadPreset('solar'); b = app.world.findByName('Earth'); }
  app.ui.setSpeed(1 / 3650);
  app.cam.focus(b, performance.now()); app.cam.dist = app.cam.distGoal = b.r * 3;
  window.__b = b;
  if (cloud !== '') setInterval(() => { if (b.th) b.th.cloud = +cloud; }, 5);
}, [process.env.TERRA || '', process.env.CLOUD ?? '']);
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
const info = await page.evaluate(([yaw, pitch]) => {
  const sv = app.surface, s = sv.sun, n = sv.up, N = sv.north;
  const E = [N[1] * n[2] - N[2] * n[1], N[2] * n[0] - N[0] * n[2], N[0] * n[1] - N[1] * n[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  sv.yaw = Math.atan2(dot(s, E), dot(s, N)) + yaw * Math.PI / 180; sv.pitch = pitch * Math.PI / 180;
  return { sunElev: Math.asin(dot(s, n)) * 180 / Math.PI };
}, [+yawS, +pitchS]);
await page.waitForTimeout(+(process.env.SETTLE || (webgpu ? 15000 : 6000)));
const png = webgpu
  ? await page.evaluate(async () => { const { w, h, data } = await app.r3d.gl.readDefault(); const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data), w, h), 0, 0); return c.toDataURL('image/png'); })
  : await page.evaluate(() => new Promise((ok) => requestAnimationFrame(() => ok(app.r3d.canvas.toDataURL('image/png')))));
writeFileSync(out, Buffer.from(png.split(',')[1], 'base64'));
console.log(JSON.stringify(info), errs.slice(0, 3));
await browser.close();
