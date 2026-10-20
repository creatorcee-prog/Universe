// Particles on the GPU. Each frame the free particles (debris, a torn star's gas, supernova ejecta, dust) take
// up to 1,024 small leapfrog steps each through the bodies' gravity; done one by one on the CPU that is most of
// a frame with thousands of them. Here a WebGL2 vertex shader takes every particle's steps at once (transform
// feedback: the shader writes each particle's new state to a buffer instead of drawing it), and the results
// are read back. The CPU keeps the master copy in double precision, and everything else (swallowing, clumping,
// disks, the particles' own gravity) still works on it.
//
// It is the same integrator as World.stepParticles (physics.js), line for line: sub-steps from each particle's
// dynamical time, the bodies' positions through the frame interpolated from the frame's own steps, the host
// held fixed after the first sub-step, the two-body energy restored on unresolved close passes, swept capture.
//
// Graphics chips work in single precision (7 digits): an AU to ~15 km. So each particle travels in the frame of
// the body that pulls on it hardest (its "host": a planet for its debris, the black hole for a stream), moving
// with that body's average velocity over the frame: its position is a small number there, precise to metres.
// The other bodies are placed in that frame from offsets computed on the CPU in double precision.
import { G } from './units.js';

const MAXA = 24;   // (physics.js MAX_ATTRACTORS)

const VS = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
layout(location = 0) in vec4 aPos;   // position in the host's frame; w: dynamical time (0: unknown)
layout(location = 1) in vec4 aVel;   // velocity in the host's frame; w: the host's index
uniform sampler2D uDisp;   // (j, a): body a's displacement since the frame began, at time j/S of it; w: mass
uniform sampler2D uOffs;   // (a, h): body a's position minus body h's, as the frame began
uniform int uNa, uS, uCompact;
uniform float uSpan, uG, uPK;
uniform float uCap2[${MAXA}], uSoft2[${MAXA}];
uniform vec3 uVF[${MAXA}], uVE[${MAXA}];   // each body's mean velocity over the frame; its velocity at the end
out vec4 oPos;
out vec4 oVel;

int H;
// Body a at time tau into the frame, in the host's moving frame; w: its mass (0: absent).
vec4 att(int a, float tau) {
  float fj = clamp(tau / uSpan, 0.0, 1.0) * float(uS);
  int j0 = min(int(floor(fj)), uS), j1 = min(j0 + 1, uS);
  float f = fj - float(j0);
  vec4 d0 = texelFetch(uDisp, ivec2(j0, a), 0), d1 = texelFetch(uDisp, ivec2(j1, a), 0);
  if (d0.w == 0.0 || d1.w == 0.0) return vec4(0.0);
  vec3 off = texelFetch(uOffs, ivec2(a, H), 0).xyz;
  return vec4(off + mix(d0.xyz, d1.xyz, f) - uVF[H] * tau, d1.w);
}
bool segHit(vec3 a, vec3 b, vec3 c, float r2) {
  vec3 e = b - a, w = c - a;
  float e2 = dot(e, e);
  float t = e2 > 0.0 ? clamp(dot(w, e) / e2, 0.0, 1.0) : 0.0;
  vec3 d = w - e * t;
  return dot(d, d) < r2;
}
void main() {
  H = int(aVel.w);
  vec3 p = aPos.xyz, u = aVel.xyz;
  float tl = aPos.w;
  if (tl <= 0.0) {
    tl = 1e30;
    for (int a = 0; a < ${MAXA}; a++) {
      if (a >= uNa) break;
      vec4 A = att(a, 0.0);
      if (A.w == 0.0) continue;
      vec3 d = A.xyz - p;
      float d2 = dot(d, d) + uSoft2[a];
      tl = min(tl, d2 * sqrt(d2) / (uG * A.w));
    }
    tl = sqrt(tl);
  }
  int L = int(ceil(log2(uSpan / (uPK * tl))));
  if (L < 0) L = 0;
  int Lmax = tl < uSpan ? 10 : 5;
  for (int a = 0; a < ${MAXA}; a++) {
    if (a >= uNa) break;
    if ((uCompact & (1 << a)) == 0) continue;
    vec4 A = att(a, 0.0);
    vec3 d = A.xyz - p;
    if (A.w != 0.0 && dot(d, d) < uCap2[a] * 4e6) { Lmax = 10; break; }
  }
  L = min(L, Lmax);
  int ns = 1 << L;
  float hh = uSpan / float(ns);
  float minT2 = 1e38;
  int hit = -1, host = -1;
  vec3 ext = vec3(0.0);
  for (int k = 0; k < 1024; k++) {
    if (k >= ns || hit >= 0) break;
    float tau = (float(k) + 0.5) * hh;
    vec3 s = p;
    p += u * hh * 0.5;
    vec3 m = p;
    vec3 acc = vec3(0.0);
    vec4 Hs = vec4(0.0);
    if (k == 0 || host < 0) {
      float best = 0.0;
      vec3 hacc = vec3(0.0);
      for (int a = 0; a < ${MAXA}; a++) {
        if (a >= uNa) break;
        vec4 A = att(a, tau);
        if (A.w == 0.0) continue;
        vec3 d = A.xyz - p;
        float r2 = dot(d, d);
        if (r2 < uCap2[a]) { hit = a; break; }
        float d2 = r2 + uSoft2[a], dd = sqrt(d2), f = uG * A.w / (d2 * dd);
        acc += d * f;
        if (f * dd > best) { best = f * dd; host = a; hacc = d * f; }
        if (d2 * dd < minT2 * uG * A.w) minT2 = d2 * dd / (uG * A.w);
      }
      if (hit >= 0) break;
      ext = acc - hacc;
    } else {
      vec4 A = att(host, tau);
      if (A.w != 0.0) {
        vec3 d = A.xyz - p;
        float r2 = dot(d, d);
        if (r2 < uCap2[host]) { hit = host; break; }
        float d2 = r2 + uSoft2[host], dd = sqrt(d2), f = uG * A.w / (d2 * dd);
        acc = d * f + ext;
        if (d2 * dd < minT2 * uG * A.w) minT2 = d2 * dd / (uG * A.w);
      } else acc = ext;
    }
    // Two-body energy about the host before the sub-step (restored below if the step cannot resolve a pass).
    float e0 = 0.0, e0r = 0.0, e0w = 0.0;
    bool have = false;
    vec3 hv = vec3(0.0);
    if (host >= 0) {
      Hs = att(host, tau);
      hv = uVE[host] - uVF[H];
      vec3 r = s - Hs.xyz, w = u - hv, q = m - Hs.xyz;
      float r2s = dot(r, r), w2 = dot(w, w);
      float lim = 36.0 * hh * hh * (w2 + dot(acc, acc) * hh * hh * 4.0);
      if (Hs.w != 0.0 && (r2s < lim || dot(q, q) < lim)) {
        float rr = sqrt(r2s);
        e0 = w2 / 2.0 - uG * Hs.w / sqrt(rr * rr + uSoft2[host]);
        e0r = rr; e0w = sqrt(w2); have = true;
      }
    }
    u += acc * hh;
    p += u * hh * 0.5;
    if (have) {
      vec3 r = p - Hs.xyz, w = u - hv, q = m - Hs.xyz;
      float w2 = dot(w, w), r1 = length(r);
      float rMin = min(min(e0r, r1), length(q));
      float want = 2.0 * (e0 + uG * Hs.w / sqrt(r1 * r1 + uSoft2[host]));
      if (rMin < 2.5 * hh * max(e0w, sqrt(w2)) && want > 0.0 && w2 > 0.0) u = hv + w * sqrt(want / w2);
    }
    // Swept capture: did the sub-step's path pass through the host (or, on the first sub-step, any body)?
    if (hit < 0) {
      float step = length(u) * hh;
      for (int a = 0; a < ${MAXA}; a++) {
        if (a >= uNa) break;
        if (!(k == 0 || host < 0) && a != host) continue;
        vec4 A = att(a, tau);
        if (A.w == 0.0) continue;
        vec3 q = m - A.xyz;
        float cap = sqrt(uCap2[a]), reach = step + cap;
        if (dot(q, q) > 4.0 * reach * reach && dot(q, q) > uCap2[a] * 1e6) continue;
        if (segHit(s, m, A.xyz, uCap2[a]) || segHit(m, p, A.xyz, uCap2[a])) { hit = a; break; }
        vec3 r = p - A.xyz, w = u - (uVE[a] - uVF[H]);
        float rr = length(r), rv = dot(r, w);
        if (rv < 0.0 && rr < 1e3 * cap) {
          float mu = uG * A.w, v2 = dot(w, w);
          vec3 hvec = cross(r, w);
          float h2 = dot(hvec, hvec), en = v2 / 2.0 - mu / rr;
          float ecc = sqrt(max(0.0, 1.0 + 2.0 * en * h2 / (mu * mu)));
          float peri = h2 / (mu * (1.0 + ecc));
          if (peri < cap && rr / sqrt(v2) < hh * 2.0) { hit = a; break; }
        }
      }
    }
  }
  oPos = vec4(p, minT2 < 1e37 ? sqrt(minT2) : tl);
  // w: the host for next frame (the one that pulled hardest), and what swallowed it (+1; 0 = nothing)
  oVel = vec4(u, float(max(host, 0)) + 32.0 * float(hit + 1));
}`;
const FS = `#version 300 es
precision highp float;
out vec4 o;
void main() { o = vec4(0.0); }`;

export class GpuStepper {
  constructor() {
    this.ok = false;
    try {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 1;
      const gl = cv.getContext('webgl2', { antialias: false, depth: false, stencil: false, alpha: false, powerPreference: 'high-performance' });
      if (!gl) return;
      this.gl = gl;
      cv.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.ok = false; this.lost = true; });
      const sh = (type, src) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
        return s;
      };
      const p = gl.createProgram();
      gl.attachShader(p, sh(gl.VERTEX_SHADER, VS));
      gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS));
      gl.transformFeedbackVaryings(p, ['oPos', 'oVel'], gl.INTERLEAVED_ATTRIBS);
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      this.p = p;
      this.u = {};
      for (const n of ['uDisp', 'uOffs', 'uNa', 'uS', 'uCompact', 'uSpan', 'uG', 'uPK', 'uCap2', 'uSoft2', 'uVF', 'uVE']) this.u[n] = gl.getUniformLocation(p, n);
      this.inBuf = gl.createBuffer();
      this.outBuf = gl.createBuffer();
      this.vao = gl.createVertexArray();
      gl.bindVertexArray(this.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.inBuf);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 32, 0);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 16);
      gl.bindVertexArray(null);
      this.tf = gl.createTransformFeedback();
      this.texDisp = gl.createTexture();
      this.texOffs = gl.createTexture();
      for (const t of [this.texDisp, this.texOffs]) {
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      }
      this.cap = 0;
      this.ok = true;
    } catch (e) {
      this.error = String(e && e.message || e);
      this.ok = false;
    }
  }

  // Pipelined, one frame behind: reading the GPU's answer back at once would make the CPU wait for it to finish
  // everything queued before (the last frame's drawing too), and the two would take turns instead of working
  // side by side. So each frame collects the answer to the job sent the frame before (long done by then), then
  // sends this frame's. Until collected, particles lag the bodies by a frame; the renderer draws each one
  // carried along with its host meanwhile (lagShift), and whatever the CPU did to them in between (the
  // particles' own gravity, clumping, the wind) is kept: the GPU's answer is applied as a change.

  // The answer to last frame's job, if it ended where this frame begins (t0). Applies it to the particles and
  // returns the swallowed ones as [index, body, ...]; null if there was no job to collect.
  collect(world, t0) {
    const job = this.job;
    this.job = null;
    if (!job || !this.ok) return null;
    if (Math.abs(job.t1 - t0) > 1e-9 * Math.max(1, Math.abs(t0))) return null;   // (a new scene, or time was reset)
    const gl = this.gl, n = job.np, out = this.outData;
    // (if the job is not done yet, reading waits for it: how long says whether the GPU is keeping up)
    const tw = performance.now();
    this.ready = !job.sync || gl.getSyncParameter(job.sync, gl.SYNC_STATUS) === gl.SIGNALED;
    gl.bindBuffer(gl.COPY_READ_BUFFER, this.outBuf);
    gl.getBufferSubData(gl.COPY_READ_BUFFER, 0, out, 0, n * 8);
    this.waitMs = this.ready ? 0 : performance.now() - tw;
    gl.bindBuffer(gl.COPY_READ_BUFFER, null);
    if (job.sync) { gl.deleteSync(job.sync); job.sync = null; }
    if (gl.isContextLost()) { this.ok = false; return null; }
    const px = world.px, py = world.py, pz = world.pz, vx = world.pvx, vy = world.pvy, vz = world.pvz;
    const ptl = world.ptl, phost = world.phost, pid = world.pid, plag = world.plag;
    const { A0, VF, span, att, pids, xin, hostIdx } = job;
    // (particles may have been removed or moved since: find each by its id)
    let where = null;
    const absorbed = [];
    for (let k = 0; k < n; k++) {
      let i = k;
      if (!(i < world.np && pid[i] === pids[k])) {
        if (!where) { where = new Map(); for (let j = 0; j < world.np; j++) where.set(pid[j], j); }
        i = where.get(pids[k]);
        if (i === undefined) continue;   // (gone: swallowed or merged meanwhile)
      }
      const o = k * 8, h = hostIdx[k], q = k * 6;
      const ex = A0[h * 3] + VF[h * 3] * span + out[o], ey = A0[h * 3 + 1] + VF[h * 3 + 1] * span + out[o + 1], ez = A0[h * 3 + 2] + VF[h * 3 + 2] * span + out[o + 2];
      const evx = VF[h * 3] + out[o + 4], evy = VF[h * 3 + 1] + out[o + 5], evz = VF[h * 3 + 2] + out[o + 6];
      px[i] += ex - xin[q]; py[i] += ey - xin[q + 1]; pz[i] += ez - xin[q + 2];
      vx[i] += evx - xin[q + 3]; vy[i] += evy - xin[q + 4]; vz[i] += evz - xin[q + 5];
      ptl[i] = out[o + 3];
      plag[i] = 0;
      const w = Math.round(out[o + 7]), nh = w % 32, hit = Math.floor(w / 32) - 1;
      phost[i] = att[nh] ? att[nh].id : -1;
      if (hit >= 0 && att[hit]) absorbed.push(i, att[hit]);
    }
    return absorbed;
  }

  // Send the job for the frame [t0, t0 + span] (as World.stepParticles); collected next frame.
  issue(world, att, steps, t0, span, cap2, soft2, compactMask, pK) {
    if (!this.ok) return false;
    const gl = this.gl, np = world.np, na = att.length, cp = world.cp, cpT = world.cpT;
    if (na === 0 || na > MAXA) return false;
    const stride = na * 4;
    // The bodies through the frame, resampled at S + 1 even times (from the frame's own steps).
    const S = Math.min(512, Math.max(16, 2 * steps));
    const disp = this.disp && this.disp.length >= (S + 1) * na * 4 ? this.disp : (this.disp = new Float32Array((S + 1) * MAXA * 4 * 2));
    // (buffers kept from frame to frame: last frame's job is collected before this one is sent, and fresh arrays
    // every frame would mean garbage collection pauses, felt as stutters)
    const A0 = this.A0 || (this.A0 = new Float64Array(MAXA * 3)), VF = this.VF || (this.VF = new Float64Array(MAXA * 3));
    for (let a = 0; a < na; a++) { A0[a * 3] = cp[a * 4]; A0[a * 3 + 1] = cp[a * 4 + 1]; A0[a * 3 + 2] = cp[a * 4 + 2]; }
    let seg = 0;
    for (let j = 0; j <= S; j++) {
      const tt = t0 + (j / S) * span;
      while (seg < steps - 1 && cpT[seg + 1] < tt) seg++;
      const ta = cpT[seg], tb = cpT[Math.min(seg + 1, steps)];
      const f = tb > ta ? Math.min(1, Math.max(0, (tt - ta) / (tb - ta))) : 0;
      const oa = seg * stride, ob = Math.min(seg + 1, steps) * stride;
      for (let a = 0; a < na; a++) {
        const qa = oa + a * 4, qb = ob + a * 4, o = (a * (S + 1) + j) * 4;
        if (cp[qa + 3] === 0 || cp[qb + 3] === 0 || cp[a * 4 + 3] === 0) { disp[o] = disp[o + 1] = disp[o + 2] = 0; disp[o + 3] = 0; continue; }
        disp[o] = cp[qa] + (cp[qb] - cp[qa]) * f - A0[a * 3];
        disp[o + 1] = cp[qa + 1] + (cp[qb + 1] - cp[qa + 1]) * f - A0[a * 3 + 1];
        disp[o + 2] = cp[qa + 2] + (cp[qb + 2] - cp[qa + 2]) * f - A0[a * 3 + 2];
        disp[o + 3] = cp[qb + 3];
      }
    }
    // Each body's mean velocity over the frame (its frame moves at it), in double.
    for (let a = 0; a < na; a++) {
      const qb = steps * stride + a * 4;
      const ok = cp[qb + 3] !== 0 && cp[a * 4 + 3] !== 0;
      for (let c = 0; c < 3; c++) VF[a * 3 + c] = ok ? (cp[qb + c] - A0[a * 3 + c]) / span : att[a]['v' + 'xyz'[c]];
    }
    const offs = this.offs || (this.offs = new Float32Array(MAXA * MAXA * 4));
    for (let h = 0; h < na; h++) for (let a = 0; a < na; a++) {
      const o = (h * na + a) * 4;
      offs[o] = A0[a * 3] - A0[h * 3]; offs[o + 1] = A0[a * 3 + 1] - A0[h * 3 + 1]; offs[o + 2] = A0[a * 3 + 2] - A0[h * 3 + 2]; offs[o + 3] = 0;
    }
    const ids = new Map();
    for (let a = 0; a < na; a++) ids.set(att[a].id, a);
    if (this.cap < np) {
      this.cap = Math.max(np, Math.ceil(this.cap * 1.5), 1024);
      this.inData = new Float32Array(this.cap * 8);
      this.outData = new Float32Array(this.cap * 8);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.inBuf);
      gl.bufferData(gl.ARRAY_BUFFER, this.cap * 32, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.outBuf);
      gl.bufferData(gl.ARRAY_BUFFER, this.cap * 32, gl.DYNAMIC_READ);
    }
    if (!this.pidsB || this.pidsB.length < np) { const c = Math.max(np, 1024) * 2; this.pidsB = new Int32Array(c); this.hostB = new Int32Array(c); this.xinB = new Float64Array(c * 6); }
    const D = this.inData, hostIdx = this.hostB, pids = this.pidsB, xin = this.xinB;
    const px = world.px, py = world.py, pz = world.pz, vx = world.pvx, vy = world.pvy, vz = world.pvz, ptl = world.ptl, phost = world.phost, plag = world.plag;
    for (let i = 0; i < np; i++) {
      let h = ids.get(phost[i]);
      if (h === undefined || cp[h * 4 + 3] === 0) {
        // (a new particle, or its host is gone: the body pulling hardest on it now)
        let best = -1;
        h = 0;
        for (let a = 0; a < na; a++) {
          if (cp[a * 4 + 3] === 0) continue;
          const d2 = (cp[a * 4] - px[i]) ** 2 + (cp[a * 4 + 1] - py[i]) ** 2 + (cp[a * 4 + 2] - pz[i]) ** 2 + soft2[a];
          const f = cp[a * 4 + 3] / d2;
          if (f > best) { best = f; h = a; }
        }
      }
      hostIdx[i] = h;
      phost[i] = att[h].id;
      pids[i] = world.pid[i];
      const q = i * 6;
      xin[q] = px[i]; xin[q + 1] = py[i]; xin[q + 2] = pz[i]; xin[q + 3] = vx[i]; xin[q + 4] = vy[i]; xin[q + 5] = vz[i];
      const o = i * 8;
      D[o] = px[i] - A0[h * 3]; D[o + 1] = py[i] - A0[h * 3 + 1]; D[o + 2] = pz[i] - A0[h * 3 + 2]; D[o + 3] = ptl[i];
      D[o + 4] = vx[i] - VF[h * 3]; D[o + 5] = vy[i] - VF[h * 3 + 1]; D[o + 6] = vz[i] - VF[h * 3 + 2]; D[o + 7] = h;
      plag[i] = 1;
    }
    gl.useProgram(this.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texDisp);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, S + 1, na, 0, gl.RGBA, gl.FLOAT, disp.subarray(0, (S + 1) * na * 4));
    gl.uniform1i(this.u.uDisp, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.texOffs);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, na, na, 0, gl.RGBA, gl.FLOAT, offs.subarray(0, na * na * 4));
    gl.uniform1i(this.u.uOffs, 1);
    gl.uniform1i(this.u.uNa, na);
    gl.uniform1i(this.u.uS, S);
    gl.uniform1i(this.u.uCompact, compactMask);
    gl.uniform1f(this.u.uSpan, span);
    gl.uniform1f(this.u.uG, G);
    gl.uniform1f(this.u.uPK, pK);
    const c2 = this.c2 || (this.c2 = new Float32Array(MAXA)), s2 = this.s2 || (this.s2 = new Float32Array(MAXA));
    const vf = this.vf || (this.vf = new Float32Array(MAXA * 3)), ve = this.ve || (this.ve = new Float32Array(MAXA * 3));
    for (let a = 0; a < na; a++) {
      c2[a] = cap2[a]; s2[a] = soft2[a];
      vf[a * 3] = VF[a * 3]; vf[a * 3 + 1] = VF[a * 3 + 1]; vf[a * 3 + 2] = VF[a * 3 + 2];
      ve[a * 3] = att[a].vx; ve[a * 3 + 1] = att[a].vy; ve[a * 3 + 2] = att[a].vz;
    }
    gl.uniform1fv(this.u.uCap2, c2);
    gl.uniform1fv(this.u.uSoft2, s2);
    gl.uniform3fv(this.u.uVF, vf);
    gl.uniform3fv(this.u.uVE, ve);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.inBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, D, 0, np * 8);
    gl.bindVertexArray(this.vao);
    gl.enable(gl.RASTERIZER_DISCARD);
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, this.tf);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, this.outBuf);
    gl.beginTransformFeedback(gl.POINTS);
    gl.drawArrays(gl.POINTS, 0, np);
    gl.endTransformFeedback();
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
    gl.disable(gl.RASTERIZER_DISCARD);
    gl.bindVertexArray(null);
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    this.job = { t1: t0 + span, np, A0, VF, span, att: att.slice(), pids, xin, hostIdx, sync };
    // Where each host has moved meanwhile, to carry its lagging particles along when drawn.
    const shift = new Map();
    for (let a = 0; a < na; a++) shift.set(att[a].id, [att[a].x - A0[a * 3], att[a].y - A0[a * 3 + 1], att[a].z - A0[a * 3 + 2]]);
    world.lagShift = shift;
    return true;
  }

  // Run synchronously (for tests: issue and collect at once).
  run(world, att, steps, t0, span, cap2, soft2, compactMask, pK) {
    if (!this.issue(world, att, steps, t0, span, cap2, soft2, compactMask, pK)) return null;
    const res = this.collect(world, t0 + span);
    world.lagShift = null;
    return res;
  }
}
