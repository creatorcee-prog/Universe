// Particle-particle collisions: how debris, dust and ejecta clump into moonlets and moons.
//
// Each particle with mass is a clump with a physical radius from its mass and material density. When
// two clumps touch they collide inelastically (restitution 0.3 on the normal velocity), and they stick
// together if, after the collision, they are gravitationally bound to each other, i.e. their impact
// speed is below their mutual escape speed. Inside the Roche limit of the body they orbit, tides pull
// clumps apart, so there they only bounce. This is the accretion model of moon-formation N-body studies
// (Ida, Canup & Stewart 1997, Nature 389, 353; Kokubo, Ida & Makino 2000, Icarus 148, 419).
// Clumps that grow past PROMOTE become full bodies ("moonlets") that sweep up debris and merge.

import { G } from './units.js';
import { makeBody } from './bodies.js';

const PK_GAS = 6, PK_SN_H = 8; // gas and hydrogen do not clump
const AU_M = 1.495978707e11, MSUN = 1.98847e30;
// Material density (kg/m³) by particle kind: debris/hot/rock 3000, ice 1000, dust 2000, SN O/Si/Fe.
const RHO = [3000, 3000, 3000, 3000, 1000, 2000, 1000, 3000, 1000, 2000, 2500, 7800];
const PROMOTE = 1.1e-9; // M☉ (~2.2e21 kg, 3% of the Moon): a clump this big becomes a body (moonlet)
const RESTITUTION = 0.3;

let moonletCount = 0;

function radiusAU(m, kind) {
  const kg = m * MSUN, rho = RHO[kind] || 3000;
  return Math.cbrt((3 * kg) / (4 * Math.PI * rho)) / AU_M;
}

export function coagulate(world, dt) {
  const np = world.np;
  if (np < 2 || !(dt > 0) || !world.collisions) return;
  const pm = world.pm, pk = world.pk, px = world.px, py = world.py, pz = world.pz, vx = world.pvx, vy = world.pvy, vz = world.pvz;
  const idx = [];
  // Solid material only, and only clumps below the moonlet size: the coarse chunks of a whole shredded
  // planet are a numerical sampling, not real fragments, and must not each turn into a body.
  for (let i = 0; i < np; i++) if (pm[i] > 0 && pm[i] < PROMOTE && pk[i] !== PK_GAS && pk[i] !== PK_SN_H && pk[i] !== 2 && pk[i] !== 3) idx.push(i);
  const n = idx.length;
  if (n < 2) return;
  const bodies = world.bodies;
  // Host (strongest pull) and physical radius per clump.
  const rad = new Float64Array(n), host = new Int32Array(n), rocheOK = new Uint8Array(n);
  let rmax = 0, smax = 0;
  for (let k = 0; k < n; k++) {
    const i = idx[k];
    rad[k] = radiusAU(pm[i], pk[i]);
    if (rad[k] > rmax) rmax = rad[k];
    let best = -1, bf = 0, bd = 0;
    for (let h = 0; h < bodies.length; h++) {
      const b = bodies[h];
      const d2 = (b.x - px[i]) ** 2 + (b.y - py[i]) ** 2 + (b.z - pz[i]) ** 2;
      const f = b.m / d2;
      if (f > bf) { bf = f; best = h; bd = d2; }
    }
    host[k] = best;
    let s = 0;
    if (best >= 0) {
      const b = bodies[best];
      s = Math.hypot(vx[i] - b.vx, vy[i] - b.vy, vz[i] - b.vz);
      // Roche limit for a fluid/rubble satellite: a_R = 2.456 R (ρ_host / ρ_clump)^(1/3).
      const rhoHost = b.r > 0 ? (b.m * MSUN) / ((4 / 3) * Math.PI * (b.r * AU_M) ** 3) : 1e18;
      const aR = 2.456 * b.r * Math.cbrt(rhoHost / (RHO[pk[i]] || 3000));
      rocheOK[k] = Math.sqrt(bd) > aR ? 1 : 0;
    } else rocheOK[k] = 1;
    if (s > smax) smax = s;
  }
  // Spatial hash. Cells must hold any pair that could have touched during the frame.
  const reach = 2 * rmax + Math.min(smax * dt * 0.25, 2e-3);
  const cell = Math.max(reach, 1e-12);
  const grid = new Map();
  const key = (a, b, c) => a * 73856093 ^ b * 19349663 ^ c * 83492791;
  const cx = new Int32Array(n), cy = new Int32Array(n), cz = new Int32Array(n);
  for (let k = 0; k < n; k++) {
    const i = idx[k];
    cx[k] = Math.floor(px[i] / cell); cy[k] = Math.floor(py[i] / cell); cz[k] = Math.floor(pz[i] / cell);
    const h = key(cx[k], cy[k], cz[k]);
    let l = grid.get(h);
    if (!l) { l = []; grid.set(h, l); }
    l.push(k);
  }
  const dead = new Uint8Array(n);
  let merges = 0;
  for (let k = 0; k < n; k++) {
    if (dead[k]) continue;
    for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) for (let oz = -1; oz <= 1; oz++) {
      const l = grid.get(key(cx[k] + ox, cy[k] + oy, cz[k] + oz));
      if (!l) continue;
      for (const q of l) {
        if (q <= k || dead[q] || dead[k]) continue;
        const i = idx[k], j = idx[q];
        const dx = px[j] - px[i], dy = py[j] - py[i], dz = pz[j] - pz[i];
        const dvx = vx[j] - vx[i], dvy = vy[j] - vy[i], dvz = vz[j] - vz[i];
        const rr = rad[k] + rad[q];
        // Closest approach during the frame (straight-line relative motion, looking back over dt).
        const dv2 = dvx * dvx + dvy * dvy + dvz * dvz;
        let tau = dv2 > 0 ? -(dx * dvx + dy * dvy + dz * dvz) / dv2 : 0;
        tau = Math.max(-dt, Math.min(0, tau));
        const mx = dx + dvx * tau, my = dy + dvy * tau, mz = dz + dvz * tau;
        if (mx * mx + my * my + mz * mz > rr * rr) continue;
        const mi = pm[i], mj = pm[j], M = mi + mj;
        const vesc2 = (2 * G * M) / rr;
        // Normal component of the relative velocity after an inelastic bounce.
        const d = Math.hypot(dx, dy, dz) || rr;
        const nx = dx / d, ny = dy / d, nz = dz / d;
        const vn = dvx * nx + dvy * ny + dvz * nz;
        const after2 = dv2 - vn * vn * (1 - RESTITUTION * RESTITUTION);
        if (after2 < vesc2 && rocheOK[k] && rocheOK[q]) {
          // Stick: conserve mass and momentum, keep the bigger clump's kind.
          px[i] = (px[i] * mi + px[j] * mj) / M; py[i] = (py[i] * mi + py[j] * mj) / M; pz[i] = (pz[i] * mi + pz[j] * mj) / M;
          vx[i] = (vx[i] * mi + vx[j] * mj) / M; vy[i] = (vy[i] * mi + vy[j] * mj) / M; vz[i] = (vz[i] * mi + vz[j] * mj) / M;
          if (mj > mi) pk[i] = pk[j];
          pm[i] = M;
          rad[k] = radiusAU(M, pk[i]);
          dead[q] = 1;
          merges++;
        } else if (vn < 0) {
          // Approaching: bounce with restitution (dissipates energy, which lets a disk settle and clump).
          const J = (1 + RESTITUTION) * vn / M; // impulse per unit mass, along n
          vx[i] += J * mj * nx; vy[i] += J * mj * ny; vz[i] += J * mj * nz;
          vx[j] -= J * mi * nx; vy[j] -= J * mi * ny; vz[j] -= J * mi * nz;
        }
      }
    }
  }
  // Promote big clumps to bodies, then remove merged and promoted particles (highest index first).
  const remove = [];
  for (let k = 0; k < n; k++) {
    const i = idx[k];
    if (dead[k]) { remove.push(i); continue; }
    if (pm[i] >= PROMOTE) {
      const kind = pk[i];
      const b = makeBody({
        kind: 'rocky', name: `Moonlet ${++moonletCount}`, m: pm[i], r: radiusAU(pm[i], kind),
        color: kind === 4 ? [214, 220, 228] : [176, 168, 158], compKey: kind === 4 ? 'icemoon' : 'Moon',
      });
      b.x = px[i]; b.y = py[i]; b.z = pz[i]; b.vx = vx[i]; b.vy = vy[i]; b.vz = vz[i];
      b.formed = true;
      world.addBody(b);
      if (moonletCount === 1 || moonletCount % 5 === 0) world.events.push({ text: `Debris clumped into ${b.name}`, body: b });
      remove.push(i);
    }
  }
  // A moonlet that has grown past a quarter of a lunar mass and orbits a planet is announced (once) as a moon.
  for (const b of world.bodies) {
    if (!b.formed || b.announced || b.m < 9.2e-9) continue;
    let host = null, bf = 0;
    for (const h of world.bodies) { if (h === b || h.m < b.m * 10) continue; const f = h.m / ((h.x - b.x) ** 2 + (h.y - b.y) ** 2 + (h.z - b.z) ** 2); if (f > bf) { bf = f; host = h; } }
    if (!host || host.kind !== 'rocky') continue;
    b.announced = true;
    const d = Math.hypot(host.x - b.x, host.y - b.y, host.z - b.z) / host.r;
    const oldName = b.name;
    if (/Earth/.test(host.name) && !world.findByName('Moon')) b.name = 'Moon';
    world.events.push({ text: `${oldName} has grown into a moon of ${host.name}${b.name !== oldName ? ', now called the Moon' : ''}: ${(b.m / 3.694e-8).toFixed(2)} lunar masses, ${d.toFixed(1)} ${host.name} radii out`, body: b, big: true, snd: 'complete', power: 1 });
  }
  remove.sort((a, b) => b - a);
  for (const i of remove) world.removeParticle(i);
  return merges;
}

export function resetMoonletNames() { moonletCount = 0; }
