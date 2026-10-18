import { chromium, devices } from 'playwright';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext({ ...devices['iPhone 13'] })).newPage(); const errs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text().slice(0, 300)); });
await page.goto('http://localhost:8080/');
await page.waitForTimeout(3000);
await page.evaluate(() => { app.loadPreset('binary'); const b = app.world.findByName('Tatooine'); app.cam.focus(b, performance.now()); app.cam.dist = app.cam.distGoal = b.r * 3; });
await page.waitForTimeout(12000);
console.log(await page.evaluate(() => {
  const r = app.r3d, g = r.gl, out = [];
  for (const m of (r.genMaps || new Map()).values()) {
    g.bindFramebuffer(g.FRAMEBUFFER, m.fbo);
    const p = new Float32Array(4); const px = [];
    for (const [x, y] of [[100, 100], [1000, 500], [1500, 900]]) { g.readPixels(x, y, 1, 1, g.RGBA, g.FLOAT, p); px.push([...p].map((v) => v.toFixed(3)).join(',')); }
    out.push({ name: m.b.name, row: m.row, done: m.done, px, err: g.getError() });
  }
  g.bindFramebuffer(g.FRAMEBUFFER, null);
  const b = app.world.findByName('Tatooine');
  return JSON.stringify({ out, hdr: r.hdr, th: b.th && { Ts: b.th.Ts, ocean: b.th.ocean, ice: b.th.ice, cloud: b.th.cloud } });
}), errs.slice(0, 5));
await browser.close();
