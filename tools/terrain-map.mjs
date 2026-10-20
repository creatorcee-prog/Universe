// Picture of a made-up world's generated terrain map (render3d.js genStep), coloured by height: sea blue by
// depth (sea level for 71% ocean), land green or tan by moisture, mountains lighter.
//   node tools/terrain-map.mjs out.png
import { chromium, devices } from 'playwright';
import { writeFileSync } from 'fs';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext({ ...devices['iPhone 13'] })).newPage();
await page.goto('http://localhost:8080/');
await page.waitForTimeout(3000);
const png = await page.evaluate(async () => {
  const B = await import('./js/bodies.js');
  app.loadPreset('lonestar'); app.ui.setSpeed(0);
  const s = app.world.bodies.find((x) => x.kind === 'star');
  const b = B.makeBody({ ...B.CATALOG.find((c) => c.id === 'earth'), name: 'Terra', compKey: 'Earth' });
  b.x = s.x + 1; b.y = s.y; b.z = s.z; app.world.addBody(b);
  app.cam.focus(b, performance.now()); app.cam.dist = app.cam.distGoal = b.r * 3;
  const r = app.r3d;
  // Speed up generation: run strips back to back.
  for (let i = 0; i < 400 && !(r.genMaps && [...r.genMaps.values()].every((m) => m.done)); i++) { await new Promise((ok) => setTimeout(ok, 50)); r.genStep(); }
  const m = r.genMaps.get(b), g = r.gl, W = 2048, H = 1024;
  g.bindFramebuffer(g.FRAMEBUFFER, m.fbo);
  // (after generateMipmap the texture changed; re-attach level 0)
  g.framebufferTexture2D(g.FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.TEXTURE_2D, m.tex, 0);
  const p = new Float32Array(W * H * 4); g.readPixels(0, 0, W, H, g.RGBA, g.FLOAT, p);
  g.bindFramebuffer(g.FRAMEBUFFER, null);
  const c = document.createElement('canvas'); c.width = W / 2; c.height = H / 2;
  const id = c.getContext('2d').createImageData(W / 2, H / 2), sea = 0.3 + 0.36 * 0.71;
  for (let y = 0; y < H / 2; y++) for (let x = 0; x < W / 2; x++) {
    const o = ((y * 2) * W + x * 2) * 4, h = p[o], mt = p[o + 1], mo = p[o + 2];
    let col;
    if (h < sea) { const d = Math.min(1, (sea - h) / 0.12); col = [10 + 30 * (1 - d), 40 + 80 * (1 - d), 120 + 80 * (1 - d)]; }
    else { const e = Math.min(1, (h - sea) / 0.15); const gr = mo > 0.5 ? [70, 120, 50] : [170, 150, 100]; col = gr.map((v, i) => v * (1 - e * 0.4) + 140 * mt * e); }
    const q = (y * (W / 2) + x) * 4; id.data[q] = col[0]; id.data[q + 1] = col[1]; id.data[q + 2] = col[2]; id.data[q + 3] = 255;
  }
  c.getContext('2d').putImageData(id, 0, 0);
  return c.toDataURL('image/png');
});
writeFileSync(process.argv[2], Buffer.from(png.split(',')[1], 'base64'));
await browser.close();
