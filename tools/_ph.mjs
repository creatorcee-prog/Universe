import { World } from '../js/physics.js';
import { PRESETS } from '../js/presets.js';
const w = new World();
PRESETS.find((p) => p.id === 'solar').build(w);
const step = 30 / 365.25 / 60; // 30 days/s at 60 fps
let acc = 0, n = 0, worst = 0, yr = 0;
for (let f = 0; f < 60 * 120; f++) {
  const t = performance.now(); w.advance(step, 8); const ms = performance.now() - t;
  acc += ms; n++; worst = Math.max(worst, ms);
  if (w.t - yr >= 0.25) { console.log(w.t.toFixed(2), 'yr', (acc / n).toFixed(2), 'ms avg', worst.toFixed(1), 'worst', w.bodies.length, 'bodies'); acc = n = worst = 0; yr = w.t; }
}
