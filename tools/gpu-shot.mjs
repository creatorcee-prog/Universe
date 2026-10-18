// Screenshots of tools/gpu-test.html in headless Chromium with software WebGPU:
// node tools/gpu-shot.mjs <outdir> name:query [name:query ...]   e.g.  far:d=6&p=0.35
import { chromium } from 'playwright';
const out = process.argv[2];
const browser = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const msgs = [];
page.on('console', (m) => { if (!m.text().includes('experimental')) msgs.push(m.text().slice(0, 400)); });
page.on('pageerror', (e) => msgs.push(e.message));
for (const arg of process.argv.slice(3)) {
  const [name, qs] = arg.split(':');
  await page.goto('http://localhost:8080/tools/gpu-test.html?' + qs);
  await page.waitForFunction(() => window.done, null, { timeout: 300000 }).catch(() => msgs.push('timeout'));
  await page.screenshot({ path: `${out}/gt-${name}.png` });
  if (process.env.DUMP) require_dump: { const fs = await import('fs'); fs.writeFileSync(out + '/sdata.json', JSON.stringify(await page.evaluate(() => ({ s: window.sData, sw: window.swarm })))); }
  console.log(name, await page.evaluate(() => window.res), await page.evaluate(() => window.log.slice(0, 3)));
}
console.log(msgs.slice(0, 6));
await browser.close();
