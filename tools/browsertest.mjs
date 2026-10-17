// Drives the app in headless Chromium at iPhone size: `node tools/browsertest.mjs <url> <outdir>`.
import { chromium, devices } from 'playwright';

const url = process.argv[2] || 'http://localhost:8080/';
const out = process.argv[3] || '.';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const ctx = await browser.newContext({ ...devices['iPhone 13'], deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
await page.goto(url);
await page.waitForTimeout(2500);
const ids = process.argv[4] ? process.argv[4].split(',') : ['solar', 'earthmoon', 'jupiter', 'impact', 'formation', 'binary', 'rogue', 'tde', 'galaxies', 'empty'];
for (const id of ids) {
  await page.evaluate((id) => window.app.loadPreset(id), id);
  await page.waitForTimeout(id === 'impact' || id === 'tde' ? 9000 : 3000);
  const fps = await page.evaluate(() => new Promise((res) => {
    let n = 0; const t0 = performance.now();
    const f = () => { n++; if (performance.now() - t0 < 1000) requestAnimationFrame(f); else res(n); };
    requestAnimationFrame(f);
  }));
  const info = await page.evaluate(() => ({ b: app.world.bodies.length, p: app.world.np + app.world.nr, t: app.world.t, lim: app.world.limited, rate: app.rate }));
  console.log(id, 'fps', fps, JSON.stringify(info));
  await page.screenshot({ path: `${out}/${id}.png` });
}
console.log('errors:', errors.length ? errors : 'none');
await browser.close();
