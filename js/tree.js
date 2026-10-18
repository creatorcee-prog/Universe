// Self-gravity of particles (debris, dust, ejecta) with a Barnes-Hut octree (Barnes & Hut 1986, Nature
// 324, 446): distant groups of particles act as a single mass at their centre of mass when they span
// less than θ of their distance (θ = 0.6), so the cost grows as N log N instead of N².
// Each particle is a softened (Plummer) clump; the softening length follows the mean spacing so close
// pairs do not fling each other apart, as in collisionless N-body codes.

import { G } from './units.js';

const THETA2 = 0.6 * 0.6;
const MAX_DEPTH = 40;

export class Octree {
  constructor() { this.cap = 0; this.alloc(4096); }

  alloc(n) {
    this.cap = n;
    this.cx = new Float64Array(n); this.cy = new Float64Array(n); this.cz = new Float64Array(n); this.hs = new Float64Array(n);
    this.m = new Float64Array(n); this.mx = new Float64Array(n); this.my = new Float64Array(n); this.mz = new Float64Array(n);
    this.child = new Int32Array(n * 8); this.leaf = new Int32Array(n); this.kids = new Uint8Array(n);
  }

  newNode(cx, cy, cz, hs) {
    if (this.count >= this.cap) {
      const o = this;
      const keep = ['cx', 'cy', 'cz', 'hs', 'm', 'mx', 'my', 'mz'].map((k) => o[k]);
      const ch = o.child, lf = o.leaf, kd = o.kids, n = o.cap;
      this.alloc(n * 2);
      ['cx', 'cy', 'cz', 'hs', 'm', 'mx', 'my', 'mz'].forEach((k, i) => o[k].set(keep[i]));
      this.child.set(ch); this.leaf.set(lf); this.kids.set(kd);
    }
    const i = this.count++;
    this.cx[i] = cx; this.cy[i] = cy; this.cz[i] = cz; this.hs[i] = hs;
    this.m[i] = 0; this.mx[i] = 0; this.my[i] = 0; this.mz[i] = 0;
    this.child.fill(-1, i * 8, i * 8 + 8); this.leaf[i] = -1; this.kids[i] = 0;
    return i;
  }

  // Build from the particles with mass. Returns false when there is nothing to do.
  build(px, py, pz, pm, np) {
    let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity], n = 0;
    for (let i = 0; i < np; i++) {
      if (!(pm[i] > 0)) continue;
      n++;
      if (px[i] < lo[0]) lo[0] = px[i]; if (px[i] > hi[0]) hi[0] = px[i];
      if (py[i] < lo[1]) lo[1] = py[i]; if (py[i] > hi[1]) hi[1] = py[i];
      if (pz[i] < lo[2]) lo[2] = pz[i]; if (pz[i] > hi[2]) hi[2] = pz[i];
    }
    this.n = n;
    if (n < 2) return false;
    const hs = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) * 0.5 * 1.001 + 1e-15;
    this.count = 0;
    this.newNode((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2, hs);
    for (let i = 0; i < np; i++) if (pm[i] > 0) this.insert(i, px, py, pz, pm);
    this.finish(0);
    this.size = hs * 2;
    return true;
  }

  insert(p, px, py, pz, pm) {
    let node = 0, depth = 0;
    const x = px[p], y = py[p], z = pz[p], m = pm[p];
    for (;;) {
      // accumulate mass moments on the way down
      this.m[node] += m; this.mx[node] += m * x; this.my[node] += m * y; this.mz[node] += m * z;
      const base = node * 8;
      const isLeaf = this.kids[node] === 0;
      if (isLeaf && this.leaf[node] < 0 && this.m[node] === m) { this.leaf[node] = p; return; }
      if (depth > MAX_DEPTH) return; // coincident points: keep the mass in this node
      if (isLeaf && this.leaf[node] >= 0) {
        // split: push the resident particle down one level
        const q = this.leaf[node];
        this.leaf[node] = -1;
        const oq = this.octant(node, px[q], py[q], pz[q]);
        const cq = this.makeChild(node, oq);
        this.m[cq] += pm[q]; this.mx[cq] += pm[q] * px[q]; this.my[cq] += pm[q] * py[q]; this.mz[cq] += pm[q] * pz[q];
        this.leaf[cq] = q;
      }
      const o = this.octant(node, x, y, z);
      let c = this.child[base + o];
      if (c < 0) c = this.makeChild(node, o);
      node = c;
      depth++;
    }
  }

  octant(node, x, y, z) {
    return (x > this.cx[node] ? 1 : 0) | (y > this.cy[node] ? 2 : 0) | (z > this.cz[node] ? 4 : 0);
  }

  makeChild(node, o) {
    const h = this.hs[node] / 2;
    const c = this.newNode(this.cx[node] + (o & 1 ? h : -h), this.cy[node] + (o & 2 ? h : -h), this.cz[node] + (o & 4 ? h : -h), h);
    this.child[node * 8 + o] = c;
    this.kids[node] = 1;
    return c;
  }

  finish() {
    // centre of mass = first moment / mass
    for (let i = 0; i < this.count; i++) {
      const m = this.m[i];
      if (m > 0) { this.mx[i] /= m; this.my[i] /= m; this.mz[i] /= m; }
    }
  }

  // Acceleration at (x, y, z) from all particle mass, skipping particle `self`.
  accel(x, y, z, self, eps2, out) {
    let ax = 0, ay = 0, az = 0;
    const stack = this.stack || (this.stack = new Int32Array(MAX_DEPTH * 8 + 64));
    let sp = 0;
    stack[sp++] = 0;
    while (sp > 0) {
      const nd = stack[--sp];
      const m = this.m[nd];
      if (!(m > 0)) continue;
      const lf = this.leaf[nd];
      if (lf === self && lf >= 0) continue;
      const dx = this.mx[nd] - x, dy = this.my[nd] - y, dz = this.mz[nd] - z;
      const d2 = dx * dx + dy * dy + dz * dz;
      const s = this.hs[nd] * 2;
      const base = nd * 8;
      if (this.kids[nd] === 0 || s * s < THETA2 * d2) {
        // a single particle, or a group far enough away: treat it as a point mass at its centre of mass
        const r2 = d2 + eps2;
        const inv = (G * m) / (r2 * Math.sqrt(r2));
        ax += dx * inv; ay += dy * inv; az += dz * inv;
      } else {
        for (let k = 0; k < 8; k++) { const c = this.child[base + k]; if (c >= 0) stack[sp++] = c; }
      }
    }
    out[0] = ax; out[1] = ay; out[2] = az;
  }
}

// Apply particle self-gravity as velocity kicks, and its pull on the bodies. Particles' orbits around the
// bodies are integrated separately; this adds the mutual pull of the swarm (operator splitting).
// To stay within a phone's frame budget the tree may be rebuilt only every few frames, with the kick
// covering the time since; that interval is kept below 1% of the swarm's free-fall time.
export function particleGravity(world, dt, tree) {
  const st = world.sg || (world.sg = { acc: 0, frames: 0, every: 1, cost: 0 });
  st.acc += dt;
  st.frames++;
  const np = world.np;
  if (np < 2 || !(st.acc > 0)) { st.acc = 0; st.job = null; return; }
  const pm = world.pm;
  let total = 0, nm = 0;
  for (let i = 0; i < np; i++) if (pm[i] > 0) { total += pm[i]; nm++; }
  if (!(total > 1e-14) || nm < 2) { st.acc = 0; st.job = null; return; } // under ~2e16 kg in particles: negligible
  const px = world.px, py = world.py, pz = world.pz;
  // Free-fall time of the swarm from its last known size (refreshed at each rebuild).
  const tff = st.size ? Math.sqrt((3 * Math.PI * (st.size / 2) ** 3 * 4) / (32 * G * total * 3)) : 0;
  // On the worker unless the swarm is collapsing faster than its answers come back (the gap between its
  // kicks over 1% of the free-fall time): then here, every frame, until it has settled.
  if (gravityWorker() && !st.noWorker && !(tff > 0 && st.lag > 0.01 * tff)) { asyncGravity(world, st, nm); return; }
  st.job = null;
  if (st.frames < st.every && !(tff > 0 && st.acc > 0.01 * tff)) return;
  const t0 = performance.now();
  if (!tree.build(px, py, pz, pm, np)) { st.acc = 0; return; }
  st.size = tree.size;
  // Softening ~ a quarter of the mean particle spacing in the swarm's bounding box.
  const eps = (0.25 * tree.size) / Math.cbrt(tree.n);
  const eps2 = eps * eps;
  const out = [0, 0, 0];
  const vx = world.pvx, vy = world.pvy, vz = world.pvz, k = st.acc;
  for (let i = 0; i < np; i++) {
    if (!(pm[i] > 0)) continue; // massless tracers (e.g. the asteroid belt) only feel the bodies
    tree.accel(px[i], py[i], pz[i], i, eps2, out);
    vx[i] += out[0] * k; vy[i] += out[1] * k; vz[i] += out[2] * k;
  }
  // Bodies feel the swarm too, e.g. a debris disk tugging on its planet.
  for (const b of world.bodies) {
    tree.accel(b.x, b.y, b.z, -1, eps2 + b.r * b.r, out);
    b.vx += out[0] * k; b.vy += out[1] * k; b.vz += out[2] * k;
  }
  st.acc = 0;
  st.frames = 0;
  // Aim for about 3 ms per frame on average.
  st.cost = performance.now() - t0;
  st.every = Math.max(1, Math.min(30, Math.ceil(st.cost / 3)));
}

// ---------- On a second CPU core ----------
// The tree is built and walked in a Web Worker, so a self-gravitating cloud no longer costs the main
// thread (which runs the rest of the physics and the drawing) any time. The worker gets the positions and
// masses of the particles with mass and of the bodies; its accelerations come back a frame or two later
// and are applied as one kick covering all the time since the previous kick, which is how the pull was
// already applied (every few frames) on one core. Particles are matched by id (removals reorder them);
// one removed in the meantime has nothing to kick, one that grew by merging keeps its kick. Falls back to the main thread if workers
// are unavailable.
let worker = null, workerFailed = false;
function gravityWorker() {
  if (worker || workerFailed) return worker;
  try {
    if (typeof Worker === 'undefined' || typeof Blob === 'undefined') throw new Error('no workers');
    const src = `const G = ${G}, THETA2 = ${THETA2}, MAX_DEPTH = ${MAX_DEPTH};\n${Octree.toString()}\n` + `
const tree = new Octree();
onmessage = (e) => {
  const { id, x, y, z, m, bx, by, bz, beps2, eps2 } = e.data, n = m.length, nb = bx.length;
  const acc = new Float64Array(3 * (n + nb)), out = [0, 0, 0];
  if (tree.build(x, y, z, m, n)) {
    const e2 = eps2 * (0.25 * tree.size) ** 2 / Math.cbrt(tree.n) ** 2;
    for (let i = 0; i < n; i++) { tree.accel(x[i], y[i], z[i], i, e2, out); acc[3 * i] = out[0]; acc[3 * i + 1] = out[1]; acc[3 * i + 2] = out[2]; }
    for (let j = 0; j < nb; j++) { tree.accel(bx[j], by[j], bz[j], -1, e2 + beps2[j], out); const k = 3 * (n + j); acc[k] = out[0]; acc[k + 1] = out[1]; acc[k + 2] = out[2]; }
    postMessage({ id, acc, size: tree.size }, [acc.buffer]);
  } else postMessage({ id, acc: null });
};`;
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    worker = new Worker(url);
    worker.onerror = () => { workerFailed = true; worker = null; };
    worker.onmessage = (e) => { if (worker && worker.target && e.data.id === worker.target.id) worker.target.result = e.data; };
  } catch { workerFailed = true; worker = null; }
  return worker;
}

let jobId = 0;
function asyncGravity(world, st, nm) {
  const job = st.job;
  if (job && job.result) {
    // Apply the finished job's pull over the time accumulated since the last kick.
    const r = job.result, k = st.acc;
    st.lag = k;
    if (r.acc) {
      const vx = world.pvx, vy = world.pvy, vz = world.pvz, n = job.idx.length;
      // The pull was worked out for the positions at the snapshot, a frame or two ago; it is applied over
      // the time since the last kick, centred later than that. Project it forward with its rate of
      // change between this result and the previous one (per particle), so the delay does not let a
      // collapsing cloud overshoot and puff up.
      const tc = world.t - k / 2, prev = st.prev;
      let f = 0, pmap = null;
      if (prev && job.ts > prev.ts) { f = Math.max(0, Math.min(2, (tc - job.ts) / (job.ts - prev.ts))); pmap = prev.map; }
      const map = new Map();
      // Where each particle is now: removals move the last particle into the freed slot.
      const now = new Map(), pid = world.pid;
      for (let i = 0; i < world.np; i++) if (world.pm[i] > 0) now.set(pid[i], i);
      for (let j = 0; j < n; j++) {
        const id = job.id32[j], i = now.get(id);
        let ax = r.acc[3 * j], ay = r.acc[3 * j + 1], az = r.acc[3 * j + 2];
        map.set(id, j);
        if (pmap && f > 0) {
          const q = pmap.get(id);
          if (q !== undefined) { ax += (ax - prev.acc[3 * q]) * f; ay += (ay - prev.acc[3 * q + 1]) * f; az += (az - prev.acc[3 * q + 2]) * f; }
        }
        if (i === undefined) continue; // merged into another clump or removed since the snapshot
        vx[i] += ax * k; vy[i] += ay * k; vz[i] += az * k;
      }
      st.prev = { ts: job.ts, acc: r.acc, map };
      job.bodies.forEach((b, j) => {
        if (!world.bodies.includes(b)) return;
        const q = 3 * (n + j);
        b.vx += r.acc[q] * k; b.vy += r.acc[q + 1] * k; b.vz += r.acc[q + 2] * k;
      });
      st.size = r.size;
    }
    st.acc = 0;
    st.job = null;
  } else if (job) {
    // Still computing. If it is taking far too long (a stalled worker), go back to the main thread.
    if (performance.now() - job.t > 1000) { st.noWorker = true; st.job = null; }
    return;
  }
  // Send the next snapshot.
  const np = world.np, pm = world.pm, px = world.px, py = world.py, pz = world.pz;
  const x = new Float64Array(nm), y = new Float64Array(nm), z = new Float64Array(nm), m = new Float64Array(nm), idx = new Int32Array(nm), id32 = new Uint32Array(nm);
  let c = 0;
  for (let i = 0; i < np; i++) if (pm[i] > 0) { x[c] = px[i]; y[c] = py[i]; z[c] = pz[i]; m[c] = pm[i]; idx[c] = i; id32[c] = world.pid[i]; c++; }
  const bodies = world.bodies.slice(), nb = bodies.length;
  const bx = new Float64Array(nb), by = new Float64Array(nb), bz = new Float64Array(nb), beps2 = new Float64Array(nb);
  bodies.forEach((b, j) => { bx[j] = b.x; by[j] = b.y; bz[j] = b.z; beps2[j] = b.r * b.r; });
  st.job = { id: ++jobId, idx, id32, bodies, t: performance.now(), ts: world.t, result: null };
  worker.target = st.job;
  // eps2 = 1 here: the worker scales it to (a quarter of the mean spacing)², as on the main thread.
  worker.postMessage({ id: st.job.id, x, y, z, m, bx, by, bz, beps2, eps2: 1 }, [x.buffer, y.buffer, z.buffer, m.buffer, bx.buffer, by.buffer, bz.buffer, beps2.buffer]);
}
