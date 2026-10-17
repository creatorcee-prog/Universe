import { G } from './units.js';
import { reclassify, refresh, isLuminous } from './bodies.js';
import { thermalStep, mergeThermal, finishMerge, accreteHeat, accreteMaterial } from './thermal.js';
import { evolveStar, stellarDeath, transientLum } from './stellar.js';
import { IAS15, IAS15_NODES } from './ias15.js';
import { Octree, particleGravity } from './tree.js';
import { coagulate } from './coagulate.js';

// Particle kinds (purely visual categories; particles carry mass but do not attract each other).
export const PK = { DEBRIS: 0, HOT: 1, STAR_BLUE: 2, STAR_GOLD: 3, ICE: 4, DUST: 5, GAS: 6, ROCK: 7, SN_H: 8, SN_O: 9, SN_SI: 10, SN_FE: 11 };

const PCAP = 16000; // free particles
const RCAP = 12000; // ring particles locked to a host body
const MAX_STEPS = 3000; // body substeps per frame
const MAX_ATTRACTORS = 24; // bodies that pull on particles
const PRIORITY = { rocky: 0, gas: 1, star: 2, wd: 3, ns: 4, bh: 5, core: 6 };

const rand = Math.random;

function randUnit() {
  const u = rand() * 2 - 1;
  const t = rand() * Math.PI * 2;
  const s = Math.sqrt(1 - u * u);
  return [s * Math.cos(t), u, s * Math.sin(t)];
}

// Does the segment from (ax,ay,az) to (bx,by,bz) pass within sqrt(r2) of (cx,cy,cz)?
function segHit(ax, ay, az, bx, by, bz, cx, cy, cz, r2) {
  const ex = bx - ax, ey = by - ay, ez = bz - az;
  const wx = cx - ax, wy = cy - ay, wz = cz - az;
  const e2 = ex * ex + ey * ey + ez * ez;
  const t = e2 > 0 ? Math.max(0, Math.min(1, (wx * ex + wy * ey + wz * ez) / e2)) : 0;
  const dx = wx - ex * t, dy = wy - ey * t, dz = wz - ez * t;
  return dx * dx + dy * dy + dz * dz < r2;
}

export function captureRadius(b) {
  // Black holes swallow anything that passes inside a few Schwarzschild radii
  // (the innermost stable orbit is 3 rs); a small floor keeps stellar black holes hittable.
  if (b.kind === 'bh') return Math.max(3 * b.r, 5e-5);
  return b.r;
}

export class World {
  constructor() {
    this.px = new Float64Array(PCAP); this.py = new Float64Array(PCAP); this.pz = new Float64Array(PCAP);
    this.pvx = new Float64Array(PCAP); this.pvy = new Float64Array(PCAP); this.pvz = new Float64Array(PCAP);
    this.pm = new Float64Array(PCAP);
    this.ptl = new Float64Array(PCAP); // local dynamical timescale from the previous frame
    this.pk = new Uint8Array(PCAP);
    this.rHost = new Array(RCAP);
    this.rRad = new Float64Array(RCAP); this.rPhase = new Float64Array(RCAP);
    this.rBasis = new Float64Array(RCAP * 6); this.rk = new Uint8Array(RCAP); this.rm = new Float64Array(RCAP);
    this.cp = null;
    this.reset();
  }

  reset() {
    this.bodies = [];
    this.t = 0;
    this.np = 0;
    this.nr = 0;
    this.pending = [];
    this.ringOuter = new Map(); // host body -> outer ring radius
    this.transients = []; // supernova light, fading
    this.events = [];
    this.flashes = [];
    this.dirty = true;
    this.dtMax = Infinity;
    this.collisions = true;
    this.eta = 0.02;
    this.integ = new IAS15();
    this.tree = new Octree();
    this.limited = false;
  }

  get particleCapacity() { return PCAP; }

  addBody(b) {
    this.bodies.push(b);
    this.dirty = true;
    return b;
  }

  removeBody(b) {
    b.alive = false;
    b.mergedInto = null;
    this.bodies = this.bodies.filter((o) => o !== b);
    this.dirty = true;
  }

  findByName(name) {
    return this.bodies.find((b) => b.name === name) || null;
  }

  // Follow a merged body to whatever absorbed it.
  resolve(b) {
    while (b && !b.alive) b = b.mergedInto;
    return b;
  }

  // ---------- particles ----------

  addParticle(x, y, z, vx, vy, vz, m, kind) {
    if (this.np >= PCAP) return -1;
    const i = this.np++;
    this.px[i] = x; this.py[i] = y; this.pz[i] = z;
    this.pvx[i] = vx; this.pvy[i] = vy; this.pvz[i] = vz;
    this.pm[i] = m; this.pk[i] = kind; this.ptl[i] = 0;
    return i;
  }

  // Particles created during a frame's substeps are held back and drifted to the frame's end time.
  spawnParticle(x, y, z, vx, vy, vz, m, kind) {
    if (this.np + this.pending.length >= PCAP) return;
    this.pending.push([x, y, z, vx, vy, vz, m, kind, this.t]);
  }

  removeParticle(i) {
    const j = --this.np;
    if (i === j) return;
    this.px[i] = this.px[j]; this.py[i] = this.py[j]; this.pz[i] = this.pz[j];
    this.pvx[i] = this.pvx[j]; this.pvy[i] = this.pvy[j]; this.pvz[i] = this.pvz[j];
    this.pm[i] = this.pm[j]; this.pk[i] = this.pk[j]; this.ptl[i] = this.ptl[j];
  }

  clearParticles() {
    this.np = 0;
    this.nr = 0;
    this.pending.length = 0;
    this.ringOuter.clear();
  }

  // A ring particle rides a circular orbit around its host, computed analytically.
  // This keeps planetary rings stable at any time speed for almost no cost.
  addRingParticle(host, radius, phase, ux, uy, uz, wx, wy, wz, kind, m = 0) {
    if (this.nr >= RCAP) return;
    const i = this.nr++;
    this.ringOuter.set(host, Math.max(this.ringOuter.get(host) || 0, radius));
    this.rHost[i] = host; this.rRad[i] = radius; this.rPhase[i] = phase; this.rk[i] = kind; this.rm[i] = m;
    const o = i * 6;
    this.rBasis[o] = ux; this.rBasis[o + 1] = uy; this.rBasis[o + 2] = uz;
    this.rBasis[o + 3] = wx; this.rBasis[o + 4] = wy; this.rBasis[o + 5] = wz;
  }

  ringPosition(i, out) {
    const h = this.rHost[i];
    const r = this.rRad[i];
    const w = Math.sqrt((G * h.m) / (r * r * r));
    const th = this.rPhase[i] + w * this.t;
    const c = Math.cos(th) * r, s = Math.sin(th) * r;
    const o = i * 6, B = this.rBasis;
    out[0] = h.x + c * B[o] + s * B[o + 3];
    out[1] = h.y + c * B[o + 1] + s * B[o + 4];
    out[2] = h.z + c * B[o + 2] + s * B[o + 5];
    // velocity
    const vc = -Math.sin(th) * r * w, vs = Math.cos(th) * r * w;
    out[3] = h.vx + vc * B[o] + vs * B[o + 3];
    out[4] = h.vy + vc * B[o + 1] + vs * B[o + 4];
    out[5] = h.vz + vc * B[o + 2] + vs * B[o + 5];
  }

  // Ring particles whose host was destroyed or swallowed become free particles.
  releaseOrphanRings(forceHost = null) {
    const tmp = [0, 0, 0, 0, 0, 0];
    for (let i = this.nr - 1; i >= 0; i--) {
      const h = this.rHost[i];
      if (h.alive && h !== forceHost) continue;
      this.ringPosition(i, tmp);
      this.addParticle(tmp[0], tmp[1], tmp[2], tmp[3], tmp[4], tmp[5], this.rm[i], this.rk[i]);
      const j = --this.nr;
      if (i !== j) {
        this.rHost[i] = this.rHost[j]; this.rRad[i] = this.rRad[j]; this.rPhase[i] = this.rPhase[j];
        this.rk[i] = this.rk[j]; this.rm[i] = this.rm[j];
        for (let k = 0; k < 6; k++) this.rBasis[i * 6 + k] = this.rBasis[j * 6 + k];
      }
      this.rHost[j] = null;
    }
    for (const h of this.ringOuter.keys()) if (!h.alive || h === forceHost) this.ringOuter.delete(h);
  }

  // Ring particles ride analytic orbits only while nothing disturbs them. A body that enters the
  // ring zone frees them as ordinary particles, so they scatter, get swept up or rain onto the planet.
  disturbRings() {
    for (const [host, outer] of this.ringOuter) {
      if (!host.alive) continue;
      const lim = outer * 1.4;
      for (const b of this.bodies) {
        if (b === host) continue;
        const d = Math.hypot(b.x - host.x, b.y - host.y, b.z - host.z);
        if (d < lim + b.r) {
          this.releaseOrphanRings(host);
          this.events.push({ text: `${b.name} ploughed into ${host.name}'s rings. The debris is now flying free.`, body: host, big: true });
          break;
        }
      }
    }
  }

  // ---------- gravity ----------

  computeAcc() {
    const bs = this.bodies, n = bs.length;
    for (let i = 0; i < n; i++) { const b = bs[i]; b.ax = 0; b.ay = 0; b.az = 0; }
    let minT2 = Infinity;
    for (let i = 0; i < n; i++) {
      const a = bs[i];
      const ax0 = a.x, ay0 = a.y, az0 = a.z, am = a.m, as2 = a.soft * a.soft, ar = a.r;
      let aax = 0, aay = 0, aaz = 0;
      for (let j = i + 1; j < n; j++) {
        const b = bs[j];
        const dx = b.x - ax0, dy = b.y - ay0, dz = b.z - az0;
        const rr = ar + b.r;
        // Exact inverse-square law between spheres (shell theorem) while they are apart. Galaxy cores use
        // Plummer softening at their own scale; once two bodies overlap (about to merge) the pull falls off
        // linearly inside, as it does within a uniform sphere, instead of diverging.
        const d2 = dx * dx + dy * dy + dz * dz + as2 + b.soft * b.soft + 1e-300;
        const d = Math.sqrt(d2);
        const inv3 = d >= rr ? 1 / (d2 * d) : 1 / (rr * rr * rr);
        const fa = G * b.m * inv3, fb = G * am * inv3;
        aax += dx * fa; aay += dy * fa; aaz += dz * fa;
        b.ax -= dx * fb; b.ay -= dy * fb; b.az -= dz * fb;
        const t2 = (d2 * d) / (G * (am + b.m));
        if (t2 < minT2) minT2 = t2;
      }
      a.ax += aax; a.ay += aay; a.az += aaz;
    }
    this.dtMax = n > 1 ? this.eta * Math.sqrt(minT2) : Infinity;
    this.dirty = false;
  }

  substep(dt) {
    const bs = this.bodies, n = bs.length, h = dt * 0.5;
    for (let i = 0; i < n; i++) {
      const b = bs[i];
      b.vx += b.ax * h; b.vy += b.ay * h; b.vz += b.az * h;
      b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
    }
    this.computeAcc();
    for (let i = 0; i < n; i++) {
      const b = bs[i];
      b.vx += b.ax * h; b.vy += b.ay * h; b.vz += b.az * h;
    }
    this.t += dt;
    this.handleContacts(dt);
  }

  // Collisions (swept, so fast bodies cannot tunnel through each other) and Roche-limit disruption.
  handleContacts(dt) {
    const bs = this.bodies, n = bs.length;
    let changed = false;
    // Conservative per-body bounds let most pairs be rejected with one distance test:
    // contact needs d < reachA + reachB, tidal disruption needs d < the smaller body's widest Roche radius.
    let mMax = 0;
    for (let i = 0; i < n; i++) if (bs[i].m > mMax) mMax = bs[i].m;
    for (let i = 0; i < n; i++) {
      const b = bs[i];
      b._reach = captureRadius(b) + Math.sqrt(b.vx * b.vx + b.vy * b.vy + b.vz * b.vz) * dt;
      const eligible = !b.noRoche && (b.kind === 'rocky' || b.kind === 'gas' || b.kind === 'star') && mMax > 30 * b.m;
      // Rubble piles assembled from debris break up further out than solid moons: between the rigid (1.26) and
      // fluid (2.456) Roche coefficients, since their own gravity and friction hold them partly together.
      b._roche = eligible ? b.r * Math.cbrt((2 * mMax) / b.m) * (b.formed ? 1.5 : 1) : 0;
    }
    for (let i = 0; i < n; i++) {
      const a = bs[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < n; j++) {
        const b = bs[j];
        if (!b.alive || !a.alive) continue;
        const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        const lim = Math.max(a._reach + b._reach, a._roche, b._roche);
        if (d2 > lim * lim) continue;
        // Roche limit: a much heavier body tears a fluid/rubble body apart.
        let big = a, small = b;
        if (b.m > a.m) { big = b; small = a; }
        if (!small.noRoche && big.m > 30 * small.m && (small.kind === 'rocky' || small.kind === 'gas' || small.kind === 'star')) {
          const rRoche = small.r * Math.cbrt((2 * big.m) / small.m) * (small.formed ? 1.5 : 1);
          const contact = captureRadius(big) + small.r;
          if (d2 < rRoche * rRoche && d2 > contact * contact) {
            this.disrupt(small, big);
            changed = true;
            continue;
          }
        }
        if (!this.collisions) continue;
        const rr = captureRadius(a) + captureRadius(b);
        let hit = d2 < rr * rr;
        if (!hit) {
          // Closest approach during the step, assuming straight-line relative motion.
          const vx = b.vx - a.vx, vy = b.vy - a.vy, vz = b.vz - a.vz;
          const v2 = vx * vx + vy * vy + vz * vz;
          if (v2 > 0) {
            const x0 = dx - vx * dt, y0 = dy - vy * dt, z0 = dz - vz * dt;
            let s = -(x0 * vx + y0 * vy + z0 * vz) / v2;
            if (s > 0 && s < dt) {
              const cx = x0 + vx * s, cy = y0 + vy * s, cz = z0 + vz * s;
              hit = cx * cx + cy * cy + cz * cz < rr * rr;
            }
          }
        }
        if (hit) {
          this.merge(a, b);
          changed = true;
        }
      }
    }
    if (changed) {
      this.bodies = this.bodies.filter((b) => b.alive);
      this.dirty = true;
    }
  }

  merge(a, b) {
    // Survivor keeps its identity: the more "dominant" kind wins, then the heavier body.
    let s = a, o = b;
    const pa = PRIORITY[a.kind] ?? 0, pb = PRIORITY[b.kind] ?? 0;
    if (pb > pa || (pb === pa && b.m > a.m)) { s = b; o = a; }
    const M = s.m + o.m;
    const dvx = o.vx - s.vx, dvy = o.vy - s.vy, dvz = o.vz - s.vz;
    const vrel2 = dvx * dvx + dvy * dvy + dvz * dvz;
    const rsum = s.r + o.r;
    const vesc2 = (2 * G * M) / Math.max(rsum, 1e-12);
    let nx = o.x - s.x, ny = o.y - s.y, nz = o.z - s.z;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;
    const ix = s.x + nx * s.r, iy = s.y + ny * s.r, iz = s.z + nz * s.r;

    const cmx = (s.x * s.m + o.x * o.m) / M, cmy = (s.y * s.m + o.y * o.m) / M, cmz = (s.z * s.m + o.z * o.m) / M;
    const cvx = (s.vx * s.m + o.vx * o.m) / M, cvy = (s.vy * s.m + o.vy * o.m) / M, cvz = (s.vz * s.m + o.vz * o.m) / M;

    // Ejected debris: more for violent, near-equal impacts. Black holes eject nothing.
    const q = Math.min(4, vrel2 / vesc2);
    const ratio = o.m / M;
    // Gentle mergers (impact speed near zero) simply accrete; violent ones splash.
    const violence = Math.max(0, q - 0.25);
    let count = 0;
    let debrisMass = 0;
    if (s.kind !== 'bh' && s.kind !== 'core' && ratio > 1e-9 && violence > 0) {
      count = Math.round(Math.min(700, 2200 * Math.sqrt(ratio) * Math.min(1.5, violence)));
      // Up to ~13% of the impactor per unit of violence: a 45° Theia-like hit ejects ~2 lunar masses,
      // in line with SPH results (Canup 2004: disks of 1.5-2.4 lunar masses).
      debrisMass = Math.min(0.3, 0.13 * violence) * o.m;
    }
    // Tangential part of the impact velocity throws debris sideways, which lets some of it reach orbit.
    const dvn = dvx * nx + dvy * ny + dvz * nz;
    const tvx = dvx - dvn * nx, tvy = dvy - dvn * ny, tvz = dvz - dvn * nz;
    const vesc = Math.sqrt(vesc2);
    const kind = s.kind === 'star' || o.kind === 'star' || s.kind === 'ns' || s.kind === 'wd' ? PK.HOT : PK.DEBRIS;
    // Giant oblique impacts between rocky bodies put part of the debris straight into orbit as a disk.
    // In fluid (SPH) simulations this comes from gravitational torques by the distorted, spinning
    // post-impact body and from vapour pressure, which a point-mass planet cannot exert; ballistic ejecta
    // alone always fall back. Disk share grows with obliquity (Canup & Asphaug 2001, Nature 412, 708;
    // Canup 2004, Icarus 168, 433: a 45° impact leaves ~1.5-2 lunar masses within ~6 Earth radii).
    let nDisk = 0, diskMass = 0;
    const lx = ny * dvz - nz * dvy, ly = nz * dvx - nx * dvz, lz = nx * dvy - ny * dvx;
    const ll = Math.hypot(lx, ly, lz);
    if (count > 0 && s.kind === 'rocky' && o.kind === 'rocky' && ratio > 0.01 && ll > 0) {
      const sinTheta = ll / Math.sqrt(vrel2);
      const fDisk = Math.min(0.85, 1.2 * sinTheta);
      nDisk = Math.round(count * fDisk);
      diskMass = debrisMass * fDisk;
      const Lx = lx / ll, Ly = ly / ll, Lz = lz / ll;
      // e1 = impact direction projected into the disk plane, e2 = L × e1
      let ex1 = nx - (nx * Lx + ny * Ly + nz * Lz) * Lx, ey1 = ny - (nx * Lx + ny * Ly + nz * Lz) * Ly, ez1 = nz - (nx * Lx + ny * Ly + nz * Lz) * Lz;
      const el1 = Math.hypot(ex1, ey1, ez1) || 1; ex1 /= el1; ey1 /= el1; ez1 /= el1;
      const ex2 = Ly * ez1 - Lz * ey1, ey2 = Lz * ex1 - Lx * ez1, ez2 = Lx * ey1 - Ly * ex1;
      const rNew = Math.cbrt(s.r ** 3 + o.r ** 3), Mk = M - debrisMass;
      const g = () => Math.sqrt(-2 * Math.log(rand() || 1e-9)) * Math.cos(2 * Math.PI * rand());
      for (let k = 0; k < nDisk; k++) {
        // Surface density ∝ 1/r² from 1.15 to 7 planet radii (uniform in log r).
        const r = rNew * Math.exp(Math.log(1.15) + rand() * Math.log(7 / 1.15));
        const ph = rand() * Math.PI * 2, c = Math.cos(ph), sn = Math.sin(ph), h = 0.02 * r * g();
        const rx = (c * ex1 + sn * ex2) * r + Lx * h, ry = (c * ey1 + sn * ey2) * r + Ly * h, rz = (c * ez1 + sn * ez2) * r + Lz * h;
        const vc = Math.sqrt((G * Mk) / r) * (1 + 0.03 * g()), vr = 0.02 * vc * g();
        const tx = -sn * ex1 + c * ex2, ty = -sn * ey1 + c * ey2, tz = -sn * ez1 + c * ez2;
        this.spawnParticle(cmx + rx, cmy + ry, cmz + rz,
          cvx + tx * vc + (c * ex1 + sn * ex2) * vr, cvy + ty * vc + (c * ey1 + sn * ey2) * vr, cvz + tz * vc + (c * ez1 + sn * ez2) * vr,
          diskMass / nDisk, rand() < 0.25 ? PK.HOT : PK.DEBRIS);
      }
      count -= nDisk;
    }
    for (let k = 0; k < count; k++) {
      const u = randUnit();
      // Spray out of the impact site, mostly away from the survivor's centre.
      let ex = nx * (0.4 + rand()) + u[0] * 0.8, ey = ny * (0.4 + rand()) + u[1] * 0.8, ez = nz * (0.4 + rand()) + u[2] * 0.8;
      const el = Math.hypot(ex, ey, ez) || 1;
      const sp = vesc * (0.35 + rand() * 0.85);
      ex /= el; ey /= el; ez /= el;
      const off = o.r * rand();
      this.spawnParticle(
        ix + ex * (s.r * 0.05 + off), iy + ey * (s.r * 0.05 + off), iz + ez * (s.r * 0.05 + off),
        cvx + ex * sp + tvx * 0.5, cvy + ey * sp + tvy * 0.5, cvz + ez * sp + tvz * 0.5,
        (debrisMass - diskMass) / count, rand() < 0.3 ? PK.HOT : kind,
      );
    }
    const keep = M - debrisMass;

    if ((s.kind === 'rocky' || s.kind === 'gas') && (o.kind === 'rocky' || o.kind === 'gas')) mergeThermal(s, o, vrel2, violence, this);
    let r = s.r;
    if (!['bh', 'ns', 'wd', 'core'].includes(s.kind)) r = Math.cbrt(s.r * s.r * s.r + o.r * o.r * o.r);
    s.x = cmx; s.y = cmy; s.z = cmz;
    s.vx = cvx; s.vy = cvy; s.vz = cvz;
    s.m = keep;
    s.r = r;
    s.heat = Math.min(1.5, s.heat + Math.min(1, 6 * ratio * (0.2 + q)));
    o.alive = false;
    o.mergedInto = s;
    finishMerge(s);
    // Remember where the hit landed so the 3D view can scar and heat that patch of surface.
    // Direction is in world axes from the survivor's centre; size is the impactor's angular radius.
    if (s.kind !== 'bh' && s.kind !== 'core') {
      s.impacts = s.impacts || [];
      s.impacts.push({
        x: nx, y: ny, z: nz,
        e: Math.min(1, 0.2 + 8 * ratio * (0.2 + q)),
        size: Math.min(1.2, Math.asin(Math.min(1, o.r / Math.max(s.r, 1e-12))) * 1.4 + 0.04),
        t: performance.now(),
      });
      if (s.impacts.length > 16) s.impacts.shift();
    }
    const ev = reclassify(s);
    this.flashes.push({ x: ix, y: iy, z: iz, r: Math.max(o.r * 4, s.r * Math.min(3, 0.5 + 8 * ratio)), born: performance.now(), life: 900 + 1400 * Math.min(1, ratio * 10), color: kind === PK.HOT ? [255, 230, 190] : [255, 170, 90] });
    const what = s.kind === 'bh' ? 'swallowed' : 'collided with';
    this.events.push({ text: `${s.name} ${what} ${o.name}`, body: s });
    if (ev) this.events.push({ text: `${s.name}: ${ev}`, body: s, big: true });
  }

  disrupt(small, big) {
    const free = PCAP - this.np - this.pending.length;
    // Rubble moonlets break back into a few clumps; planets and stars into a fine spray.
    const count = Math.min(free, small.formed ? Math.max(6, Math.min(40, Math.round(small.m / 2.5e-10))) : small.kind === 'star' ? 1400 : small.m > 1e-7 ? 900 : 300);
    // A shredded star is hydrogen plasma (glows, never clumps); planets break into gas or rock.
    const kind = small.kind === 'star' ? PK.SN_H : small.kind === 'gas' ? PK.GAS : PK.ROCK;
    const vesc = Math.sqrt((2 * G * small.m) / small.r);
    for (let k = 0; k < count; k++) {
      const u = randUnit();
      const rr = small.r * Math.cbrt(rand());
      const sp = vesc * 0.15 * rand();
      this.spawnParticle(
        small.x + u[0] * rr, small.y + u[1] * rr, small.z + u[2] * rr,
        small.vx + u[0] * sp, small.vy + u[1] * sp, small.vz + u[2] * sp,
        small.m / Math.max(1, count), kind,
      );
    }
    small.alive = false;
    small.mergedInto = null;
    this.flashes.push({ x: small.x, y: small.y, z: small.z, r: small.r * 6, born: performance.now(), life: 1500, color: [255, 210, 160] });
    this.events.push({ text: `${small.name} crossed ${big.name}'s Roche limit and was torn apart by tides`, body: big, big: true });
  }

  // Blow a body apart when it holds more heat than its gravitational binding energy (3/5 GM²/R):
  // the excess becomes the debris' outward speed.
  vaporize(b, excessJ, cause) {
    const free = PCAP - this.np - this.pending.length;
    const count = Math.min(free, b.m > 1e-7 ? 1200 : 400);
    const vesc = Math.sqrt((2 * G * b.m) / b.r);
    const vEx = Math.sqrt((2 * Math.max(excessJ, 0)) / (b.m * 1.98847e30)) / 4740.47; // m/s -> AU/yr
    const vmax = Math.min(Math.max(vEx, vesc * 1.2), 0.05 * 63241); // at most 5% of light speed
    for (let k = 0; k < count; k++) {
      const u = randUnit();
      const rr = b.r * Math.cbrt(rand());
      const sp = vmax * (0.4 + 0.6 * rand());
      this.spawnParticle(b.x + u[0] * rr, b.y + u[1] * rr, b.z + u[2] * rr, b.vx + u[0] * sp, b.vy + u[1] * sp, b.vz + u[2] * sp, b.m / Math.max(1, count), rand() < 0.6 ? PK.HOT : PK.ROCK);
    }
    b.alive = false;
    b.mergedInto = null;
    this.flashes.push({ x: b.x, y: b.y, z: b.z, r: b.r * 10, born: performance.now(), life: 2500, color: [255, 230, 200] });
    this.events.push({ text: `${b.name} ${cause}: it absorbed more energy than holds it together and blew apart`, body: b, big: true });
  }

  // ---------- time stepping ----------

  // Advance by simDt years, spending at most budgetMs of wall-clock time.
  // Returns the simulated time actually covered (less than simDt when the sim cannot keep up).
  advance(simDt, budgetMs) {
    if (simDt <= 0) return 0;
    // Massive particles in tight orbits (a debris disk) need frames shorter than their local dynamical
    // time for collisions and clumping to be followed; long frames (slow devices, high speed) are split.
    let chunk = Infinity;
    const np = this.np, pm = this.pm, ptl = this.ptl;
    for (let i = 0; i < np; i++) if (pm[i] > 0 && ptl[i] > 0 && ptl[i] < chunk) chunk = ptl[i];
    // Not with many bodies: re-running the N-body step 24 times a frame would cost more than it buys.
    if (simDt > chunk * 1.5 && this.bodies.length <= 30) {
      const start = performance.now();
      const n = Math.min(24, Math.ceil(simDt / chunk));
      const h = simDt / n;
      let done = 0;
      for (let k = 0; k < n; k++) {
        const left = budgetMs - (performance.now() - start);
        if (left <= 0) break;
        const d = this.advanceCore(h, left);
        done += d;
        if (d < h * 0.999) break;
      }
      this.limited = done < simDt * 0.999;
      return done;
    }
    return this.advanceCore(simDt, budgetMs);
  }

  advanceCore(simDt, budgetMs) {
    if (simDt <= 0) return 0;
    const start = performance.now();
    const t0 = this.t;

    // Particles feel only the heaviest bodies; record their path through this frame.
    const att = this.bodies.slice().sort((a, b) => b.m - a.m).slice(0, MAX_ATTRACTORS).filter((b) => b.m > 0);
    const na = att.length;
    const stride = na * 4;
    if (!this.cp || this.cp.length < (MAX_STEPS + 1) * MAX_ATTRACTORS * 4) {
      this.cp = new Float64Array((MAX_STEPS + 1) * MAX_ATTRACTORS * 4);
      this.cpT = new Float64Array(MAX_STEPS + 1);
    }
    const cp = this.cp, cpT = this.cpT;
    const record = (k) => {
      cpT[k] = this.t;
      const o = k * stride;
      for (let a = 0; a < na; a++) {
        const b = this.resolve(att[a]);
        const q = o + a * 4;
        if (b) { cp[q] = b.x; cp[q + 1] = b.y; cp[q + 2] = b.z; cp[q + 3] = b.m; } else { cp[q + 3] = 0; }
      }
    };
    record(0);

    let remaining = simDt;
    let steps = 0;
    const integ = this.integ;
    while (remaining > 0) {
      if (this.dirty) { this.computeAcc(); integ.invalidate(); }
      if (this.bodies.length === 0) { this.t += remaining; remaining = 0; record(++steps); break; }
      // IAS15 picks its own step; it is also capped at a fraction of the shortest pairwise orbital
      // timescale so swept collision tests and particle checkpoints stay fine-grained.
      const cap = 0.3 * this.dtMax / this.eta;
      let dt = Math.min(remaining, integ.dt > 0 ? integ.dt : this.dtMax, cap);
      if (remaining - dt < dt * 1e-3) dt = remaining;
      const t0s = this.t;
      const taken = integ.step(this.bodies, dt);
      if (!(taken > 0)) break;
      this.dtMax = this.eta * Math.sqrt(integ.minT2);
      // Dense output: bodies' positions at the 7 Gauss-Radau nodes and the end of the step.
      const idxs = att.map((x) => { const bb = this.resolve(x); return bb ? this.bodies.indexOf(bb) : -1; });
      for (let k = 0; k < 8 && steps < MAX_STEPS; k++) {
        const hk = k < 7 ? IAS15_NODES[k + 1] : 1;
        this.t = t0s + hk * taken;
        steps++;
        cpT[steps] = this.t;
        const o = steps * stride, xs = integ.sub[k];
        for (let a = 0; a < na; a++) {
          const q = o + a * 4, idx = idxs[a];
          if (idx >= 0) { cp[q] = xs[3 * idx]; cp[q + 1] = xs[3 * idx + 1]; cp[q + 2] = xs[3 * idx + 2]; cp[q + 3] = this.bodies[idx].m; } else cp[q + 3] = 0;
        }
      }
      this.t = t0s + taken;
      remaining -= taken;
      for (const bb of this.bodies) { bb.ax = 0; bb.ay = 0; bb.az = 0; }
      const at = integ.at;
      for (let i = 0; i < this.bodies.length; i++) { const bb = this.bodies[i]; bb.ax = at[3 * i]; bb.ay = at[3 * i + 1]; bb.az = at[3 * i + 2]; }
      this.handleContacts(taken);
      if (steps >= MAX_STEPS - 8) break;
      if (performance.now() - start > budgetMs) break;
    }
    if (remaining < simDt * 1e-9) remaining = 0;
    const done = simDt - remaining;
    this.limited = remaining > 0;

    this.stepParticles(att, steps, t0, done);
    // Particles with mass pull on each other and on the bodies (Barnes-Hut tree).
    particleGravity(this, done, this.tree);
    // Touching clumps bounce or stick; big clumps become moonlets.
    coagulate(this, done);
    this.flushPending();
    this.evolveStars(done);
    thermalStep(this, done);
    this.releaseOrphanRings();
    if (this.ringOuter.size) this.disturbRings();
    return done;
  }

  // Particles born during this frame's substeps are integrated from their birth time to the frame's end
  // (against the bodies' end-of-frame positions, which is accurate because the gap is under one frame).
  flushPending() {
    if (this.pending.length === 0) return;
    const att = this.bodies.slice().sort((a, b) => b.m - a.m).slice(0, MAX_ATTRACTORS);
    const acc = (s, out) => {
      let ax = 0, ay = 0, az = 0, tmin = Infinity;
      for (const b of att) {
        const dx = b.x - s[0], dy = b.y - s[1], dz = b.z - s[2];
        const d2 = dx * dx + dy * dy + dz * dz + b.soft * b.soft + 1e-30;
        const d = Math.sqrt(d2);
        const f = (G * b.m) / (d2 * d);
        ax += dx * f; ay += dy * f; az += dz * f;
        const t2 = (d2 * d) / (G * b.m);
        if (t2 < tmin) tmin = t2;
      }
      out[0] = ax; out[1] = ay; out[2] = az; out[3] = Math.sqrt(tmin);
      return out;
    };
    const a = [0, 0, 0, 0];
    for (const p of this.pending) {
      const dtp = this.t - p[8];
      if (dtp > 0 && att.length) {
        acc(p, a);
        const n = Math.min(256, Math.max(1, Math.ceil(dtp / (0.05 * a[3]))));
        const h = dtp / n;
        for (let k = 0; k < n; k++) {
          p[3] += a[0] * h * 0.5; p[4] += a[1] * h * 0.5; p[5] += a[2] * h * 0.5;
          p[0] += p[3] * h; p[1] += p[4] * h; p[2] += p[5] * h;
          acc(p, a);
          p[3] += a[0] * h * 0.5; p[4] += a[1] * h * 0.5; p[5] += a[2] * h * 0.5;
        }
      }
      this.addParticle(p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7]);
    }
    this.pending.length = 0;
  }

  stepParticles(att, steps, t0, span) {
    const np = this.np;
    if (np === 0 || span <= 0) return;
    const na = att.length, stride = na * 4;
    const cp = this.cp, cpT = this.cpT;
    // Precompute attractor states at the midpoints used by 1, 2, 4, ... 32 sub-steps.
    const LEVELS = 8; // up to 128 sub-steps for particles diving close to compact objects
    if (!this.samp || this.samp.length < 256 * MAX_ATTRACTORS * 4) this.samp = new Float64Array(256 * MAX_ATTRACTORS * 4);
    const samp = this.samp;
    const levelOff = [];
    let off = 0, seg = 0;
    for (let L = 0; L < LEVELS; L++) {
      levelOff.push(off);
      const ns = 1 << L;
      seg = 0;
      for (let k = 0; k < ns; k++) {
        const tt = t0 + ((k + 0.5) / ns) * span;
        while (seg < steps - 1 && cpT[seg + 1] < tt) seg++;
        const ta = cpT[seg], tb = cpT[Math.min(seg + 1, steps)];
        const f = tb > ta ? (tt - ta) / (tb - ta) : 0;
        const oa = seg * stride, ob = Math.min(seg + 1, steps) * stride;
        for (let a = 0; a < na; a++) {
          const q = off + a * 4;
          const qa = oa + a * 4, qb = ob + a * 4;
          if (cp[qa + 3] === 0 || cp[qb + 3] === 0) { samp[q + 3] = 0; continue; }
          samp[q] = cp[qa] + (cp[qb] - cp[qa]) * f;
          samp[q + 1] = cp[qa + 1] + (cp[qb + 1] - cp[qa + 1]) * f;
          samp[q + 2] = cp[qa + 2] + (cp[qb + 2] - cp[qa + 2]) * f;
          samp[q + 3] = cp[qb + 3];
        }
        off += na * 4;
      }
    }
    const cap2 = new Float64Array(na), soft2 = new Float64Array(na);
    for (let a = 0; a < na; a++) {
      const c = captureRadius(att[a]);
      cap2[a] = c * c;
      soft2[a] = att[a].soft * att[a].soft + 1e-30;
    }
    // Compact objects (black holes, neutron stars, white dwarfs) get the finest sub-steps,
    // but only for particles that are actually close to one.
    const compact = [];
    for (let a = 0; a < na; a++) {
      const k = att[a].kind;
      if (k === 'bh' || k === 'ns' || k === 'wd') compact.push(a);
    }
    const px = this.px, py = this.py, pz = this.pz, vx = this.pvx, vy = this.pvy, vz = this.pvz, ptl = this.ptl;
    const absorbed = [];
    for (let i = 0; i < np; i++) {
      let x = px[i], y = py[i], z = pz[i], ux = vx[i], uy = vy[i], uz = vz[i];
      let tl = ptl[i];
      if (tl <= 0) {
        tl = Infinity;
        for (let a = 0; a < na; a++) {
          const q = a * 4;
          if (cp[q + 3] === 0) continue;
          const dx = cp[q] - x, dy = cp[q + 1] - y, dz = cp[q + 2] - z;
          const d2 = dx * dx + dy * dy + dz * dz + soft2[a];
          const t2 = (d2 * Math.sqrt(d2)) / (G * cp[q + 3]);
          if (t2 < tl) tl = t2;
        }
        tl = Math.sqrt(tl);
      }
      let L = Math.ceil(Math.log2(span / (0.08 * tl)));
      if (!(L > 0)) L = 0;
      let Lmax = 5;
      for (const a of compact) {
        const dx = cp[a * 4] - x, dy = cp[a * 4 + 1] - y, dz = cp[a * 4 + 2] - z;
        if (dx * dx + dy * dy + dz * dz < cap2[a] * 4e6) { Lmax = LEVELS - 1; break; }
      }
      if (L > Lmax) L = Lmax;
      const ns = 1 << L, hh = span / ns;
      let minT2 = Infinity, hitA = -1;
      // First sub-step sums every attractor and notes the dominant one (the "host").
      // When many sub-steps are needed, the particle is deep in its host's well: later sub-steps
      // re-evaluate only the host and hold the other bodies' (nearly uniform) pull fixed.
      let host = -1, extx = 0, exty = 0, extz = 0;
      for (let k = 0; k < ns && hitA < 0; k++) {
        const sx = x, sy = y, sz = z;
        x += ux * hh * 0.5; y += uy * hh * 0.5; z += uz * hh * 0.5;
        const mx = x, my = y, mz = z;
        const base = levelOff[L] + k * na * 4;
        let ax = 0, ay = 0, az = 0;
        if (k === 0 || host < 0) {
          let best = 0, hx = 0, hy = 0, hz = 0;
          for (let a = 0; a < na; a++) {
            const q = base + a * 4;
            const m = samp[q + 3];
            if (m === 0) continue;
            const dx = samp[q] - x, dy = samp[q + 1] - y, dz = samp[q + 2] - z;
            const r2 = dx * dx + dy * dy + dz * dz;
            if (r2 < cap2[a]) { hitA = a; break; }
            const d2 = r2 + soft2[a];
            const d = Math.sqrt(d2);
            const f = (G * m) / (d2 * d);
            ax += dx * f; ay += dy * f; az += dz * f;
            if (f * d > best) { best = f * d; host = a; hx = dx * f; hy = dy * f; hz = dz * f; }
            const t2 = (d2 * d) / (G * m);
            if (t2 < minT2) minT2 = t2;
          }
          extx = ax - hx; exty = ay - hy; extz = az - hz;
        } else {
          const q = base + host * 4;
          const m = samp[q + 3];
          if (m !== 0) {
            const dx = samp[q] - x, dy = samp[q + 1] - y, dz = samp[q + 2] - z;
            const r2 = dx * dx + dy * dy + dz * dz;
            if (r2 < cap2[host]) { hitA = host; break; }
            const d2 = r2 + soft2[host];
            const d = Math.sqrt(d2);
            const f = (G * m) / (d2 * d);
            ax = dx * f + extx; ay = dy * f + exty; az = dz * f + extz;
            const t2 = (d2 * d) / (G * m);
            if (t2 < minT2) minT2 = t2;
          } else { ax = extx; ay = exty; az = extz; }
        }
        ux += ax * hh; uy += ay * hh; uz += az * hh;
        x += ux * hh * 0.5; y += uy * hh * 0.5; z += uz * hh * 0.5;
        // Swept capture: did this sub-step's path pass through the host (or, on the first
        // sub-step, any attractor)? Without this, fast particles skip over small black holes.
        if (hitA < 0) {
          const a0 = k === 0 || host < 0 ? 0 : host, a1 = k === 0 || host < 0 ? na : host + 1;
          for (let a = a0; a < a1 && hitA < 0; a++) {
            const q = base + a * 4;
            const m = samp[q + 3];
            if (m === 0) continue;
            const hx = samp[q], hy = samp[q + 1], hz = samp[q + 2];
            // Cheap reject: nothing to hit if the target is further away than this step can travel.
            const qx = mx - hx, qy = my - hy, qz = mz - hz;
            const reach = Math.sqrt(ux * ux + uy * uy + uz * uz) * hh + Math.sqrt(cap2[a]);
            if (qx * qx + qy * qy + qz * qz > 4 * reach * reach && qx * qx + qy * qy + qz * qz > cap2[a] * 1e6) continue;
            // Both legs of the kick-drift-kick path.
            if (segHit(sx, sy, sz, mx, my, mz, hx, hy, hz, cap2[a]) || segHit(mx, my, mz, x, y, z, hx, hy, hz, cap2[a])) { hitA = a; break; }
            // Falling in faster than the step can resolve: if the orbit's closest approach lies inside
            // the capture radius and the particle reaches it within this step, it is swallowed.
            // Use the velocity relative to the attractor: planets move at tens of km/s.
            const rx = x - hx, ry = y - hy, rz = z - hz;
            const at = att[a], wx = ux - at.vx, wy = uy - at.vy, wz = uz - at.vz;
            const r = Math.sqrt(rx * rx + ry * ry + rz * rz);
            const rv = rx * wx + ry * wy + rz * wz;
            if (rv < 0 && r < 1e3 * Math.sqrt(cap2[a])) {
              const mu = G * m, v2 = wx * wx + wy * wy + wz * wz;
              const hxv = ry * wz - rz * wy, hyv = rz * wx - rx * wz, hzv = rx * wy - ry * wx;
              const h2 = hxv * hxv + hyv * hyv + hzv * hzv;
              const en = v2 / 2 - mu / r;
              const ecc = Math.sqrt(Math.max(0, 1 + (2 * en * h2) / (mu * mu)));
              const peri = h2 / (mu * (1 + ecc));
              if (peri < Math.sqrt(cap2[a]) && r / Math.sqrt(v2) < hh * 2) { hitA = a; break; }
            }
          }
        }
      }
      px[i] = x; py[i] = y; pz[i] = z; vx[i] = ux; vy[i] = uy; vz[i] = uz;
      ptl[i] = minT2 < Infinity ? Math.sqrt(minT2) : tl;
      if (hitA >= 0) absorbed.push(i, hitA);
    }
    // Absorb from the end so swap-removal does not disturb unprocessed indices.
    const touched = new Set();
    for (let k = absorbed.length - 2; k >= 0; k -= 2) {
      const i = absorbed[k];
      const b = this.resolve(att[absorbed[k + 1]]);
      if (b) {
        const m = this.pm[i];
        const M = b.m + m;
        const dvx = this.pvx[i] - b.vx, dvy = this.pvy[i] - b.vy, dvz = this.pvz[i] - b.vz;
        accreteHeat(b, m, dvx * dvx + dvy * dvy + dvz * dvz);
        accreteMaterial(b, m, this.pk[i]);
        // Meteors leave craters too (rate-limited so a shower doesn't wipe older scars at once).
        if (b.kind === 'rocky' && this.pk[i] !== PK.GAS && this.pk[i] !== PK.SN_H) {
          const now = performance.now();
          const recent = b.impacts ? b.impacts.filter((h) => now - h.t < 400).length : 0;
          if (recent < 6) {
            const nx = this.px[i] - b.x, ny = this.py[i] - b.y, nz = this.pz[i] - b.z, d = Math.hypot(nx, ny, nz) || 1;
            const ratio = m / b.m, v2 = dvx * dvx + dvy * dvy + dvz * dvz, ve2 = (2 * G * b.m) / b.r;
            b.impacts = b.impacts || [];
            b.impacts.push({ x: nx / d, y: ny / d, z: nz / d, e: Math.min(1, 0.55 + 2e4 * ratio * (1 + v2 / ve2)), size: 0.03 + Math.min(0.3, 15 * Math.cbrt(ratio)), t: now });
            if (b.impacts.length > 16) b.impacts.shift();
          }
        }
        b.vx = (b.vx * b.m + this.pvx[i] * m) / M;
        b.vy = (b.vy * b.m + this.pvy[i] * m) / M;
        b.vz = (b.vz * b.m + this.pvz[i] * m) / M;
        if (b.kind === 'rocky' || b.kind === 'gas') b.r = Math.cbrt(b.r * b.r * b.r * (M / b.m));
        b.m = M;
        if (b.kind === 'bh') b.heat = Math.min(1.5, b.heat + 0.01);
        touched.add(b);
      }
      this.removeParticle(i);
    }
    for (const b of touched) {
      const ev = reclassify(b);
      if (ev) this.events.push({ text: `${b.name}: ${ev}`, body: b, big: true });
      this.dirty = true;
    }
  }

  // ---------- stars ----------

  evolveStars(dt) {
    let died = false;
    for (const b of this.bodies) {
      if (!b.alive) continue;
      const before = b.m;
      const due = b.pendingDeath || (evolveStar(b, dt) === 'die' ? null : false);
      if (b.m !== before) this.dirty = true;
      if (due !== false) {
        const text = stellarDeath(this, b, typeof due === 'string' ? due : null);
        delete b.pendingDeath;
        if (text) this.events.push({ text, body: b.alive ? b : null, big: true });
        died = true;
      }
    }
    if (died) {
      this.bodies = this.bodies.filter((b) => b.alive);
      this.dirty = true;
      this.flushPending();
    }
    this.transients = this.transients.filter((t) => transientLum(t, this.t) > t.peak * 1e-4);
    for (const t of this.transients) { t.x += t.vx * dt; t.y += t.vy * dt; t.z += t.vz * dt; }
  }

  // Trigger a star's death now (the "End of life" button).
  killStar(b) {
    if (b.kind !== 'star' && b.kind !== 'wd') return null;
    const text = stellarDeath(this, b, 'was pushed to the end of its life');
    if (!b.alive) this.bodies = this.bodies.filter((o) => o.alive);
    this.dirty = true;
    this.flushPending();
    if (text) this.events.push({ text, body: b.alive ? b : null, big: true });
    return text;
  }

  // ---------- orbital helpers ----------

  // Each body's gravitational parent: the lightest heavier body whose Hill sphere contains it.
  hierarchy() {
    const sorted = this.bodies.slice().sort((a, b) => b.m - a.m);
    const info = new Map();
    for (let i = 0; i < sorted.length; i++) {
      const b = sorted[i];
      let best = null, bestR = Infinity;
      for (let j = 0; j < i; j++) {
        const p = sorted[j];
        const pi = info.get(p);
        const d = Math.hypot(b.x - p.x, b.y - p.y, b.z - p.z);
        if (d < pi.rH && (!best || pi.rH < bestR)) { best = p; bestR = pi.rH; }
      }
      let rH = Infinity;
      if (best) {
        const d = Math.hypot(b.x - best.x, b.y - best.y, b.z - best.z);
        rH = Math.max(d * Math.cbrt(b.m / (3 * best.m)), b.soft * 2, b.r * 2);
      }
      info.set(b, { parent: best, rH });
    }
    return info;
  }

  // Parent for an arbitrary point (e.g. where the player is placing a new object of mass m).
  parentAt(x, y, z, m, exclude = null, hier = null) {
    hier = hier || this.hierarchy();
    let best = null, bestR = Infinity;
    for (const [b, hi] of hier) {
      if (b === exclude || b.m < m) continue;
      const d = Math.hypot(x - b.x, y - b.y, z - b.z);
      if (d < hi.rH && (!best || hi.rH < bestR)) { best = b; bestR = hi.rH; }
    }
    return best;
  }

  totalLight(x, y, z) {
    let flux = 0;
    for (const b of this.bodies) {
      if (!isLuminous(b)) continue;
      const d2 = (b.x - x) ** 2 + (b.y - y) ** 2 + (b.z - z) ** 2;
      flux += b.lum / Math.max(d2, 1e-12);
    }
    return flux;
  }
}

// Speed of a circular orbit at distance d around parent p (respects galaxy-core softening).
export function circularSpeed(p, d, m = 0) {
  const s2 = p.soft * p.soft;
  return Math.sqrt((G * (p.m + m) * d * d) / Math.pow(d * d + s2, 1.5));
}

// Orbital elements of body b relative to parent p.
export function orbitOf(b, p) {
  const rx = b.x - p.x, ry = b.y - p.y, rz = b.z - p.z;
  const vx = b.vx - p.vx, vy = b.vy - p.vy, vz = b.vz - p.vz;
  const r = Math.hypot(rx, ry, rz), v2 = vx * vx + vy * vy + vz * vz;
  const mu = G * (p.m + b.m);
  const energy = v2 / 2 - mu / r;
  const rv = rx * vx + ry * vy + rz * vz;
  const ex = ((v2 - mu / r) * rx - rv * vx) / mu;
  const ey = ((v2 - mu / r) * ry - rv * vy) / mu;
  const ez = ((v2 - mu / r) * rz - rv * vz) / mu;
  const e = Math.hypot(ex, ey, ez);
  const out = { r, v: Math.sqrt(v2), e, bound: energy < 0, a: Infinity, period: Infinity };
  if (energy < 0) {
    out.a = -mu / (2 * energy);
    out.period = 2 * Math.PI * Math.sqrt((out.a * out.a * out.a) / mu);
  }
  return out;
}

export function refreshBody(b) {
  refresh(b);
}
