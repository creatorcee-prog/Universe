// Renders the same scene with the WebGL renderer and with the WebGPU one (js/glgpu.js, drawn off-screen and
// read back, since headless Chromium cannot show a WebGPU canvas), and saves both side by side.
//   node tools/render-compare.mjs <outdir> <name> <preset> <body> <distance in radii> [pitch] [yaw]
// ONLY=webgpu|webgl renders one side. EVAL='...' runs extra code in the page after the scene is set up (to switch things off while hunting a difference).
// Needs a local server on :8080 serving the repo.
import { chromium, devices } from 'playwright';
import { writeFileSync } from 'fs';

const [out, name, preset, body, dist, pitch = '0.3', yaw = '0.6'] = process.argv.slice(2);
const seed = `(() => { let s = 12345; Math.random = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x80000000; }; })();`;

async function shot(webgpu) {
  const args = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
  if (webgpu) args.push('--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader');
  const browser = await chromium.launch({ args });
  const ctx = await browser.newContext({ ...devices['iPhone 13'], deviceScaleFactor: 2 });
  await ctx.addInitScript(seed + (webgpu ? 'window.__TEST_WEBGPU = true; window.__TEST_OFFSCREEN = true;' : ''));
  const page = await ctx.newPage();
  const log = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') log.push(m.text().slice(0, 300)); });
  page.on('pageerror', (e) => log.push('PAGEERROR ' + e.message));
  await page.goto('http://localhost:8080/');
  await page.waitForTimeout(2500);
  if (webgpu) await page.waitForFunction(() => app.r3d && app.r3d.webgpu, null, { timeout: 60000 }).catch(() => log.push('webgpu renderer never started'));
  await page.evaluate(([preset, body, dist, pitch, yaw, extra]) => {
    app.settings.labels = false; app.settings.orbits = false; app.settings.trails = false; app.settings.grid = false;
    app.loadPreset(preset); app.ui.setSpeed(0);
    const b = app.world.findByName(body);
    app.cam.focus(b, performance.now());
    app.cam.dist = app.cam.distGoal = b.r * +dist; app.cam.pitch = +pitch; app.cam.yaw = +yaw;
    if (app.r3d) { app.r3d.quality = 0.7; app.r3d.resize(); }
    if (extra) (0, eval)(extra);
  }, [preset, body, dist, pitch, yaw, process.env.EVAL || '']);
  await page.waitForTimeout(+(process.env.WAIT || 6000));
  let png;
  if (webgpu) {
    const ok = await page.evaluate(async () => {
      if (!(app.r3d && app.r3d.webgpu)) return false;
      const { w, h, data } = await app.r3d.gl.readDefault();
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const id = new ImageData(new Uint8ClampedArray(data), w, h);
      c.getContext('2d').putImageData(id, 0, 0);
      window.__shot = c.toDataURL('image/png');
      return true;
    });
    if (ok) png = Buffer.from((await page.evaluate(() => window.__shot)).split(',')[1], 'base64');
    log.push(...(await page.evaluate(() => (app.r3d && app.r3d.gl.diag) || [])));
  } else {
    // Read the canvas in the same animation frame the app drew it (WebGL clears it after showing it).
    png = Buffer.from((await page.evaluate(() => new Promise((ok) => requestAnimationFrame(() => ok(app.r3d.canvas.toDataURL('image/png')))))).split(',')[1], 'base64');
  }
  await browser.close();
  return { png, log };
}

// ONLY=webgpu or ONLY=webgl renders one side.
const only = process.env.ONLY || '';
const gl = only === 'webgpu' ? { log: [] } : await shot(false);
const gp = only === 'webgl' ? { log: [] } : await shot(true);
if (gl.png) writeFileSync(`${out}/cmp-${name}-webgl.png`, gl.png);
if (gp.png) writeFileSync(`${out}/cmp-${name}-webgpu.png`, gp.png);
console.log(name, 'webgl', gl.png ? 'ok' : 'missing', gl.log.slice(0, 4));
console.log(name, 'webgpu', gp.png ? 'ok' : 'missing', gp.log.slice(0, 8));
