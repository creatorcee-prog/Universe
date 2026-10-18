// Picture of a planet from its lit side (the brightest of 8 views around it), for judging looks:
//   OUT=dir node tools/look.mjs <tag> preset:Name[:dist] ...   -> dir/look-<tag>-<Name>.png
// WEBGPU=1 uses the WebGPU renderer (slow on software GPUs). TERRA=<compKey> adds a made-up world, named as in
// the target, at 1 AU from the first star, with life (e.g. TERRA=Earth node tools/look.mjs a empty:Terra).
import { chromium, devices } from 'playwright';
import { writeFileSync } from 'fs';
const [tag, ...targets] = process.argv.slice(2);
const webgpu = process.env.WEBGPU === '1';
const args = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
if (webgpu) args.push('--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader');
const browser = await chromium.launch({ args });
const ctx = await browser.newContext({ ...devices['iPhone 13'], deviceScaleFactor: 2 });
if (webgpu) await ctx.addInitScript('window.__TEST_WEBGPU = true; window.__TEST_OFFSCREEN = true;');
const page = await ctx.newPage(); const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
await page.goto('http://localhost:8080/');
// A made-up world for tests: TERRA='compKey' places it at 1 AU from the first star.
if (process.env.TERRA) await page.evaluate(async (ck) => {
  const B = await import('./js/bodies.js');
  window.__extra = (name) => {
    const s = app.world.bodies.find((x) => x.kind === 'star');
    const e = B.CATALOG.find((c) => c.id === 'earth');
    const b = B.makeBody({ ...e, name, compKey: ck, color: [64, 118, 214] });
    b.x = s.x + 1; b.y = s.y; b.z = s.z; b.vx = s.vx; b.vy = s.vy; b.vz = s.vz + 6.28; b.life = true;
    app.world.addBody(b);
  };
}, process.env.TERRA);
await page.waitForTimeout(3000);
if (webgpu) await page.waitForFunction(() => app.r3d && app.r3d.webgpu, null, { timeout: 60000 });
const grab = () => page.evaluate(async (webgpu) => {
  if (webgpu) { const { w, h, data } = await app.r3d.gl.readDefault(); const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data), w, h), 0, 0); let s = 0; for (let i = 0; i < data.length; i += 64) s += data[i] + data[i + 1] + data[i + 2]; return { url: c.toDataURL('image/png'), s }; }
  return new Promise((ok) => requestAnimationFrame(() => { const c = app.r3d.canvas, url = c.toDataURL('image/png'); const g = app.r3d.gl, w = g.drawingBufferWidth, h = g.drawingBufferHeight, p = new Uint8Array(w * h * 4); g.readPixels(0, 0, w, h, g.RGBA, g.UNSIGNED_BYTE, p); let s = 0; for (let i = 0; i < p.length; i += 64) s += p[i] + p[i + 1] + p[i + 2]; ok({ url, s }); }));
}, webgpu);
for (const t of targets) {
  const [preset, name, dist = '2.6'] = t.split(':');
  await page.evaluate(([preset, name, dist]) => {
    app.settings.labels = false; app.settings.orbits = false; app.settings.grid = false; app.settings.perf = false;
    app.loadPreset(preset); app.ui.setSpeed(0);
    if (window.__extra) { window.__extra(name); app.ui.setSpeed(1 / 3650); }
    const b = app.world.findByName(name); app.cam.focus(b, performance.now());
    app.cam.dist = app.cam.distGoal = b.r * +dist; app.cam.pitch = 0.25;
    app.r3d.quality = 1; app.r3d.resize();
  }, [preset, name, dist]);
  await page.waitForTimeout(6000);
  let best = null;
  for (const yaw of [0, 0.785, 1.57, 2.36, 3.14, 3.93, 4.71, 5.5]) {
    await page.evaluate((yaw) => { app.cam.yaw = yaw; }, yaw);
    await page.waitForTimeout(webgpu ? 4000 : 1500);
    const r = await grab();
    if (!best || r.s > best.s) best = { ...r, yaw };
  }
  // Settle at the best yaw (maps may still be generating), then grab.
  await page.evaluate((yaw) => { app.cam.yaw = yaw; }, best.yaw);
  await page.waitForTimeout(webgpu ? 15000 : 5000);
  best = await grab();
  console.log(name, await page.evaluate((n) => { const b = app.world.findByName(n); return JSON.stringify({ th: b.th && { Ts: +b.th.Ts.toFixed(1), ocean: +b.th.ocean.toFixed(3), cloud: +(b.th.cloud || 0).toFixed(2), steam: b.th.steam }, gen: app.r3d.genMaps && [...app.r3d.genMaps.values()].map((m) => m.b.name + ":" + m.done) }); }, name));
  writeFileSync(`${process.env.OUT || '.'}/look-${tag}-${name}.png`, Buffer.from(best.url.split(',')[1], 'base64'));
}
console.log(tag, 'errors', errs.slice(0, 5));
await browser.close();
