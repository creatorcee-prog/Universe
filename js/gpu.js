// WebGPU layer: work the GPU's compute shaders can do that WebGL cannot. It draws on its own transparent
// canvas laid over the WebGL view, so everything else keeps working where WebGPU is missing.
//
// First use: planetary rings as real debris. Saturn's rings are a few hundred thousand chunks, each on its own
// circular orbit at its own (Keplerian) speed, so the inner rings visibly overtake the outer ones. A compute
// shader advances every chunk's orbital phase each frame; the chunks are drawn as flat discs in the ring plane,
// sized so that their overlapping coverage gives each ring its measured optical depth τ (opacity 1 − e^−τ).
// They are lit by the Sun, dimmed on the side facing away from it, dark in the planet's shadow, and hidden
// behind the planet and its moons (an exact ray-sphere test, since this canvas has no depth buffer).

// Saturn's main rings, radius (km) and normal optical depth: D, C, B, the Cassini Division, A with the Encke and
// Keeler gaps, and the F ring (Cuzzi et al. 2010, Science 327, 1470; Cassini UVIS/RSS profiles, rounded), with
// each ring's albedo (C and the Cassini Division are darker, dustier; B is brightest).
const SATURN = [
  // r0, r1, τ, albedo
  [66900, 74490, 0.002, 0.15],
  [74490, 84000, 0.08, 0.17], [84000, 92000, 0.14, 0.2],
  [92000, 99000, 1.2, 0.5], [99000, 104500, 2.6, 0.58], [104500, 110000, 2.2, 0.6], [110000, 117580, 1.6, 0.55],
  [117580, 120000, 0.08, 0.2], [120000, 122170, 0.18, 0.25],
  [122170, 128000, 0.6, 0.45], [128000, 133423, 0.5, 0.45], [133423, 133745, 0.0, 0.4], [133745, 136485, 0.45, 0.42],
  [136485, 136530, 0.0, 0.4], [136530, 136775, 0.35, 0.42],
  [140130, 140230, 0.3, 0.5],
];

const COMPUTE = /* wgsl */`
struct CU { k: f32, dt: f32, n: u32, pad: f32 };
@group(0) @binding(0) var<storage, read> stat: array<vec4f>;
@group(0) @binding(1) var<storage, read_write> phase: array<f32>;
@group(0) @binding(2) var<uniform> cu: CU;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= cu.n) { return; }
  let r = stat[i].x;
  var p = phase[i] + cu.k * cu.dt * pow(r, -1.5);     // ω ∝ r^−3/2 (Kepler)
  p = p - 6.2831853 * floor(p / 6.2831853);
  phase[i] = p;
}`;

const RENDER = /* wgsl */`
struct RU {
  proj: mat4x4f,
  host: vec4f,     // planet centre, view space (AU); w: planet radius (AU)
  bu: vec4f, bw: vec4f,
  bn: vec4f,       // ring plane basis, view space; bn.w: chunk radius (planet radii)
  sun: vec4f,      // sunlight colour × intensity (rgb)
  sunO: vec4f,     // direction to the Sun in ring coordinates (u, w, n)
  eyeO: vec4f,     // eye position in ring coordinates (planet radii)
  vp: vec4f,       // x: focal length (px), y, z: viewport (px), w: pixel ratio
  nsph: vec4f,     // x: occluders in use
  sph: array<vec4f, 16>,  // occluders: centre (view space, AU), radius
  xf: vec4f,       // drawn inside the WebGPU renderer: x: ±1 (render targets are upside down), y: its log-depth factor
};
@group(0) @binding(0) var<storage, read> stat: array<vec4f>;   // r, height, size factor, albedo
@group(0) @binding(1) var<storage, read> phase: array<f32>;
@group(0) @binding(2) var<uniform> u: RU;
struct VO { @builtin(position) pos: vec4f, @location(0) uv: vec2f, @location(1) col: vec4f, @location(2) dw: f32 };
// The renderer's logarithmic depth (shaders.js WRITE_DEPTH), so the chunks are hidden by what is in front.
struct FO { @location(0) c: vec4f, @builtin(frag_depth) d: f32 };
fn logDepth(w: f32, fc: f32) -> f32 { return log2(1.0 + w * 1e12) * fc * 0.5; }
fn hash(n: u32) -> f32 { var x = n * 747796405u + 2891336453u; x = ((x >> ((x >> 28u) + 4u)) ^ x) * 277803737u; return f32((x >> 22u) ^ x) / 4294967295.0; }
@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VO {
  var o: VO;
  o.pos = vec4f(2.0, 2.0, 2.0, 1.0);                  // off screen unless drawn
  let s = stat[ii];
  let ph = phase[ii];
  let c = vec2f(f32(vi & 1u) * 2.0 - 1.0, f32((vi >> 1u) & 1u) * 2.0 - 1.0);
  o.uv = c;
  let po = vec3f(s.x * cos(ph), s.x * sin(ph), s.y);   // ring coordinates, planet radii
  let R = u.host.w;
  let pv = u.host.xyz + R * (po.x * u.bu.xyz + po.y * u.bw.xyz + po.z * u.bn.xyz);
  let dist = length(pv);
  if (-pv.z <= 0.0) { return o; }
  // Hidden behind the planet or a moon: the ray from the eye meets the sphere before the chunk.
  let d = pv / dist;
  for (var k = 0u; k < 16u; k++) {
    if (f32(k) >= u.nsph.x) { break; }
    let sc = u.sph[k];
    let b = dot(sc.xyz, d);
    let q = b * b - (dot(sc.xyz, sc.xyz) - sc.w * sc.w);
    if (q > 0.0) { let t0 = b - sqrt(q); if (t0 > 0.0 && t0 < dist) { return o; } }
  }
  // Near the camera the swarm of rocks takes over (nsph.y: its radius in planet radii, about the camera's
  // position in the ring plane, eyeO.xy).
  let swR = u.nsph.y;
  var near = 1.0;
  if (swR > 0.0) { near = smoothstep(swR * 0.55, swR * 0.95, length(po.xy - u.eyeO.xy)); if (near <= 0.0) { return o; } }
  let rad = u.bn.w * s.z;                              // chunk radius, planet radii
  let spx = rad * R * u.vp.x / (-pv.z);               // its radius on screen (px)
  var a = 1.0;
  var clip: vec4f;
  let DOT = 1.6 * u.vp.w;                             // smallest drawn dot (px): wide enough to blend smoothly
  if (spx >= DOT) {
    // Big enough to see: a flat disc in the ring plane.
    clip = u.proj * vec4f(pv + R * rad * (c.x * u.bu.xyz + c.y * u.bw.xyz), 1.0);
  } else {
    // Smaller: a soft dot of DOT px carrying the disc's true coverage (its area seen at this angle), so many
    // overlapping dots average into a smooth ring instead of speckle.
    clip = u.proj * vec4f(pv, 1.0);
    let cosv = abs(dot(u.bn.xyz, d));
    a = min(1.0, spx * spx * max(cosv, 0.02) / (DOT * DOT * 0.5));
    clip = vec4f(clip.xy + c * DOT * 2.0 / u.vp.yz * clip.w, clip.zw);
  }
  if (clip.w <= 0.0) { return o; }
  o.pos = vec4f(clip.x, clip.y * u.xf.x, 0.5 * clip.w, clip.w);
  o.dw = clip.w;
  // Light: sunlit face, or the faint glow through the ring from the unlit side; dark in the planet's shadow.
  let L = u.sunO.xyz;
  let tL = dot(po, L);
  let shadow = select(1.0, 0.0, tL < 0.0 && length(po - L * tL) < 1.0);
  let lit = sign(L.z) == sign(u.eyeO.z);
  let v = 0.82 + 0.36 * hash(ii);
  // (A thick ring scatters light many times, so its lit face stays bright even with the Sun low over it.)
  let I = 1.7 * s.w * v * select(0.2, 1.0, lit) * (0.55 + 0.45 * sqrt(abs(L.z))) * shadow;
  let tint = vec3f(0.92, 0.84, 0.71);
  o.col = vec4f(min(u.sun.rgb * tint * I + 0.012, vec3f(1.0)), a * near);
  return o;
}
fn shade(i: VO) -> vec4f {
  let r2 = dot(i.uv, i.uv);
  if (r2 > 1.0) { discard; }
  let a = i.col.a * (1.0 - smoothstep(0.25, 1.0, r2));
  return vec4f(i.col.rgb * a, a);
}
// fs: on the ring layer's own canvas (no depth buffer); fsD: inside the renderer, writing its depth.
@fragment fn fs(i: VO) -> @location(0) vec4f { return shade(i); }
@fragment fn fsD(i: VO) -> FO { return FO(shade(i), logDepth(i.dw, u.xf.y)); }`;


// The swarm of rocks around the camera when it is near the rings. Generated on the fly: the ring plane under
// the camera is divided into cells (in the frame that moves with the ring material, so rocks drift with it),
// and each cell holds as many rocks as the ring's optical depth there calls for. Cell size and rock size scale
// with the camera's height above the plane, so there is always a field of debris around you.
const SWARM = /* wgsl */`
struct SU {
  proj: mat4x4f,
  et: vec4f, er: vec4f, en: vec4f,   // along-track, outward and normal axes (view space); w unused
  cam: vec4f,      // camera relative to the field origin along et, er, en (cells); w: cell size (AU)
  trk: vec4f,      // x: radius of the camera's track (planet radii), y: cell size (planet radii), z: fade, w: G
  lvl: vec4f,      // x: number of levels in use
  sunV: vec4f,     // direction to the Sun, view space; w: lit face (1) or not (0)
  sunO: vec4f,     // direction to the Sun in ring coordinates
  sun: vec4f,      // sunlight colour
  pos: vec4f,      // camera's track position in ring coordinates (planet radii); w: eye height above the plane
  vp: vec4f,
  rings: array<vec4f, 16>,   // r0, r1, τ, albedo (planet radii)
  cells: array<vec4f, 6>,    // per level: the camera's cell (along-track, radial) and its position within it
  xf: vec4f,                 // as in the rings' uniforms
};
@group(0) @binding(0) var<uniform> u: SU;
struct VO { @builtin(position) pos: vec4f, @location(0) uv: vec2f, @location(1) col: vec4f, @location(2) seed: f32, @location(3) lv: vec3f, @location(4) dw: f32 };
struct FO { @location(0) c: vec4f, @builtin(frag_depth) d: f32 };
fn logDepth(w: f32, fc: f32) -> f32 { return log2(1.0 + w * 1e12) * fc * 0.5; }
fn h3(p: vec3i) -> vec3f {
  var q = vec3u(bitcast<u32>(p.x), bitcast<u32>(p.y), bitcast<u32>(p.z)) * vec3u(1664525u, 1013904223u, 2654435761u);
  q.x += q.y * q.z; q.y += q.z * q.x; q.z += q.x * q.y;
  q ^= q >> vec3u(16u);
  q.x += q.y * q.z; q.y += q.z * q.x; q.z += q.x * q.y;
  return vec3f(q) / 4294967295.0;
}
fn ringAt(r: f32) -> vec2f {   // τ, albedo
  for (var k = 0u; k < 16u; k++) { let g = u.rings[k]; if (r >= g.x && r < g.y) { return g.zw; } }
  return vec2f(0.0, 0.0);
}
const SLOTS = 8u;
@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VO {
  var o: VO;
  o.pos = vec4f(2.0, 2.0, 2.0, 1.0);
  let G = i32(u.trk.w);
  let side = 2 * G + 1;
  let per = u32(side * side) * SLOTS;
  let lv = ii / per;                                   // level: each has cells twice as large as the last
  if (f32(lv) >= u.lvl.x) { return o; }
  let k = ii % per;
  let slot = k % SLOTS;
  let cidx = i32(k / SLOTS);
  let ca = cidx % side - G;
  let cr = cidx / side - G;
  let cl = u.cells[lv];
  let scale = exp2(f32(lv));
  let cellI = vec3i(i32(cl.x) + ca, i32(cl.y) + cr, i32(slot) + i32(lv) * 16);
  let hv = h3(cellI);
  let hw = h3(cellI + vec3i(7, 13, 101));
  let fa = f32(ca) + hv.x - cl.z;                      // cells (of this level) from the camera
  let fr = f32(cr) + hv.y - cl.w;
  let r = u.trk.x + fr * u.trk.y * scale;
  let ring = ringAt(r);
  // Rock radius: a spread around 0.32 cells; rocks per cell from τ (overlapping discs cover 1 − e^−τ).
  let size = 0.32 * (0.45 + 1.1 * hw.x * hw.x);
  let want = ring.x / (3.14159 * 0.32 * 0.32 * 1.15);
  if (f32(slot) + hw.y >= want) { return o; }
  let dist = length(vec2f(fa, fr));
  // Each level fills the annulus from half its reach (where the finer level fades out) to its edge.
  var fade = 1.0 - smoothstep(f32(G) * 0.65, f32(G) * 0.98, dist);
  if (lv > 0u) { fade *= smoothstep(f32(G) * 0.3, f32(G) * 0.48, dist); }
  if (fade <= 0.0) { return o; }
  let z = (hw.z - 0.5) * 0.25 - u.cam.z / scale;        // a slightly thick layer (cells)
  let cs = u.cam.w * scale;
  let pv = cs * (fa * u.et.xyz + fr * u.er.xyz + z * u.en.xyz);           // view space, relative to the eye
  if (-pv.z <= 0.0) { return o; }
  // Billboard of the rock's size.
  let c = vec2f(f32(vi & 1u) * 2.0 - 1.0, f32((vi >> 1u) & 1u) * 2.0 - 1.0);
  o.uv = c;
  var clip = u.proj * vec4f(pv, 1.0);
  let spx = size * cs * u.vp.x / (-pv.z);
  let px = max(spx, 1.2 * u.vp.w);
  clip = vec4f(clip.xy + c * px * 2.0 / u.vp.yz * clip.w, clip.zw);
  if (clip.w <= 0.0) { return o; }
  o.pos = vec4f(clip.x, clip.y * u.xf.x, 0.5 * clip.w, clip.w);
  o.dw = clip.w;
  // In the planet's shadow? (Track position plus this offset, in ring coordinates.)
  let po = u.pos.xyz + u.trk.y * scale * (fa * vec3f(-u.pos.y, u.pos.x, 0.0) / max(length(u.pos.xy), 1e-6) + fr * vec3f(u.pos.xy / max(length(u.pos.xy), 1e-6), 0.0));
  let L = u.sunO.xyz;
  let tL = dot(po, L);
  let shadow = select(1.0, 0.0, tL < 0.0 && length(po - L * tL) < 1.0);
  let I = 1.6 * ring.y * (0.8 + 0.4 * hv.z) * shadow;
  o.col = vec4f(u.sun.rgb * vec3f(0.92, 0.84, 0.71) * I, fade * min(1.0, (spx * spx) / (px * px) * 1.8));
  o.seed = hv.z * 50.0;
  o.lv = u.sunV.xyz;
  return o;
}
fn vnoise(p: vec2f) -> f32 {
  let i = floor(p); let f = fract(p); let w = f * f * (3.0 - 2.0 * f);
  let a = fract(sin(dot(i, vec2f(12.9898, 78.233))) * 43758.55);
  let b = fract(sin(dot(i + vec2f(1.0, 0.0), vec2f(12.9898, 78.233))) * 43758.55);
  let c = fract(sin(dot(i + vec2f(0.0, 1.0), vec2f(12.9898, 78.233))) * 43758.55);
  let d = fract(sin(dot(i + vec2f(1.0, 1.0), vec2f(12.9898, 78.233))) * 43758.55);
  return mix(mix(a, b, w.x), mix(c, d, w.x), w.y);
}
fn shade(i: VO) -> vec4f {
  // A lumpy rock: an irregular outline, and shading as if round, lit from the Sun's side.
  let ang = atan2(i.uv.y, i.uv.x);
  let edge = 0.78 + 0.22 * vnoise(vec2f(ang * 1.6 + i.seed, i.seed));
  let r = length(i.uv) / edge;
  if (r > 1.0) { discard; }
  let n = normalize(vec3f(i.uv / edge, sqrt(max(0.0, 1.0 - r * r))));
  let lam = max(dot(n, normalize(i.lv)), 0.0);
  let pits = 0.8 + 0.2 * vnoise(i.uv * 6.0 + i.seed);
  let a = i.col.a * (1.0 - smoothstep(0.85, 1.0, r));
  let c = i.col.rgb * (0.08 + 0.92 * lam) * pits;
  return vec4f(c * a, a);
}
@fragment fn fs(i: VO) -> @location(0) vec4f { return shade(i); }
@fragment fn fsD(i: VO) -> FO { return FO(shade(i), logDepth(i.dw, u.xf.y)); }`;

const SWARM_READY = true;

export class GPULayer {
  // Resolves to a GPULayer, or null if this browser has no usable WebGPU.
  // (headless: no canvas, for tests that render into their own texture.)
  static async create(under, headless = false) {
    try {
      if (!navigator.gpu) return null;
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (!adapter) return null;
      const device = await adapter.requestDevice();
      const canvas = document.createElement('canvas');
      canvas.id = 'gpu';
      canvas.setAttribute('aria-hidden', 'true');
      const format = navigator.gpu.getPreferredCanvasFormat();
      let ctx = null;
      if (!headless) {
        under.insertAdjacentElement('afterend', canvas);
        ctx = canvas.getContext('webgpu');
        ctx.configure({ device, format, alphaMode: 'premultiplied' });
      }
      return new GPULayer(device, ctx, format, canvas);
    } catch (e) {
      console.warn('WebGPU unavailable:', e);
      return null;
    }
  }

  // Two ways to run: on its own device and transparent canvas over the WebGL view (ctx, canvas), or inside
  // the WebGPU renderer (embedded: its device, drawing into its scene target with its depth buffer; see
  // drawInto), so the two do not compete for the GPU and the rings are hidden by whatever is in front.
  constructor(device, ctx, format, canvas, embedded = false) {
    this.device = device; this.ctx = ctx; this.canvas = canvas; this.format = format; this.embedded = embedded;
    this.lost = false;
    if (!embedded) device.lost.then(() => { this.lost = true; canvas.remove(); });
    const cm = device.createShaderModule({ code: COMPUTE });
    this.cPipe = device.createComputePipeline({ layout: 'auto', compute: { module: cm, entryPoint: 'main' } });
    this.rMod = device.createShaderModule({ code: RENDER });
    this.sMod = device.createShaderModule({ code: SWARM });
    // Shader compiler messages and GPU errors, shown in Settings so a screenshot of it tells what went wrong.
    this.diag = [];
    for (const [name, m] of [['rings', this.rMod], ['orbits', cm], ['swarm', this.sMod]]) m.getCompilationInfo?.().then((ci) => { for (const x of ci.messages) if (x.type !== 'info') this.diag.push(`${name} ${x.type} ${x.lineNum}:${x.linePos} ${x.message}`); });
    if (!embedded) device.addEventListener?.('uncapturederror', (e) => { if (this.diag.length < 8) this.diag.push(e.error.message.slice(0, 200)); });
    // Explicit layouts, so one bind group serves every pipeline variant (one per target format, sample count
    // and depth format).
    const vf = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT;
    this.rBGL = device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: vf, buffer: { type: 'uniform' } }] });
    this.sBGL = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: vf, buffer: { type: 'uniform' } }] });
    this.pipes = new Map();
    this.sU = device.createBuffer({ size: 64 + 16 * 12 + 16 * 16 + 16 * 6, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.sData = new Float32Array((64 + 16 * 12 + 16 * 16 + 16 * 6) / 4);
    this.sBind = device.createBindGroup({ layout: this.sBGL, entries: [{ binding: 0, resource: { buffer: this.sU } }] });
    this.cU = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.rU = device.createBuffer({ size: 64 + 16 * 10 + 16 * 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.rData = new Float32Array((64 + 16 * 10 + 16 * 16) / 4);
    this.rings = new Map();   // host body -> { n, stat, phase, binds }
  }

  // The ring and swarm pipelines for a target: colour format, MSAA samples, depth format (null: none).
  pipesFor(format, samples = 1, depthFormat = null) {
    const key = `${format}|${samples}|${depthFormat}`;
    let p = this.pipes.get(key);
    if (p) return p;
    const blend = { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } };
    const make = (module, bgl) => this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [bgl] }),
      vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint: depthFormat ? 'fsD' : 'fs', targets: [{ format, blend }] },
      primitive: { topology: 'triangle-strip' },
      multisample: { count: samples },
      // Tested against the scene's depth, not written (the chunks are see-through at their edges).
      depthStencil: depthFormat ? { format: depthFormat, depthWriteEnabled: false, depthCompare: 'less-equal' } : undefined,
    });
    p = { ring: make(this.rMod, this.rBGL), swarm: make(this.sMod, this.sBGL) };
    this.pipes.set(key, p);
    return p;
  }

  dispose() {
    this.lost = true;
    if (this.embedded) return;   // (the renderer owns the device)
    this.canvas.remove();
    try { this.device.destroy(); } catch { /* already gone */ }
  }

  // Build a host's ring chunks. Saturn gets its real structure; other ringed worlds are not handled here yet.
  ringFor(host, count) {
    let r = this.rings.get(host);
    if (r && r.count === count) return r;
    if (r) { r.stat.destroy(); r.phase.destroy(); }
    const Rkm = host.r * 1.495978707e8;
    // Chunks are placed with probability ∝ τ × area, then sized so that N π s² = Σ τ × area: overlapping at
    // random (Poisson), they cover each ring with its real opacity 1 − e^−τ.
    const segs = SATURN.map(([a, b, tau, alb]) => ({ a: a / Rkm, b: b / Rkm, tau, alb, w: tau * (b * b - a * a) }));
    const tot = segs.reduce((s, g) => s + g.w, 0);
    let rnd = 0x9e3779b9;
    const rand = () => { rnd ^= rnd << 13; rnd ^= rnd >>> 17; rnd ^= rnd << 5; return (rnd >>> 0) / 4294967296; };
    const stat = new Float32Array(count * 4), ph = new Float32Array(count);
    let k = 0;
    for (const g of segs) {
      const n = g === segs[segs.length - 1] ? count - k : Math.round((count * g.w) / tot);
      for (let j = 0; j < n && k < count; j++, k++) {
        // Uniform in area within the ring, with fine ringlets (the B ring's "grooves"): radii are nudged toward
        // the crests of a few overlapping waves.
        let rr = Math.sqrt(g.a * g.a + rand() * (g.b * g.b - g.a * g.a));
        rr += 0.0006 * Math.sin(rr * 2300) + 0.0004 * Math.sin(rr * 9100 + 1.3);
        stat[k * 4] = Math.min(g.b, Math.max(g.a, rr));
        stat[k * 4 + 1] = (rand() - 0.5) * 2 * (0.02 / Rkm);       // ~20 m thick
        stat[k * 4 + 2] = 0.55 + 0.9 * rand();                       // size spread (mean ~1)
        stat[k * 4 + 3] = g.alb;
        ph[k] = rand() * Math.PI * 2;
      }
    }
    const area = segs.reduce((s, g) => s + g.tau * Math.PI * (g.b * g.b - g.a * g.a), 0);
    const sRad = Math.sqrt(area / (Math.PI * count * 1.04));      // mean of s² over the size spread ≈ 1.04
    const dev = this.device;
    const mk = (arr) => { const b = dev.createBuffer({ size: arr.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }); dev.queue.writeBuffer(b, 0, arr); return b; };
    const sb = mk(stat), pb = mk(ph);
    const cBind = dev.createBindGroup({ layout: this.cPipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: sb } }, { binding: 1, resource: { buffer: pb } }, { binding: 2, resource: { buffer: this.cU } }] });
    const rBind = dev.createBindGroup({ layout: this.rBGL, entries: [{ binding: 0, resource: { buffer: sb } }, { binding: 1, resource: { buffer: pb } }, { binding: 2, resource: { buffer: this.rU } }] });
    r = { count, stat: sb, phase: pb, cBind, rBind, sRad };
    this.rings.set(host, r);
    return r;
  }

  // Uniforms for the swarm around the camera. The cells live in the frame of the ring material at the camera's
  // radius, which turns at ω(r) = √(GM/r³); the camera's cell is tracked in double precision on the CPU.
  swarmUniforms(r3d, h, ux, wx, n, d, cs, G, sunO, sunC, simDt, sRad, t, logFC) {
    const R = h.r, e = [d[40], d[41], d[42]];                          // eye in ring coordinates (planet radii)
    const rho = Math.hypot(e[0], e[1]), phi = Math.atan2(e[1], e[0]);
    const w = Math.sqrt((39.47692641 * h.m) / Math.pow(rho * R, 3));    // material's angular speed (rad/yr)
    this.mat = this.mat && this.mat.host === h ? this.mat : { host: h, ang: 0 };
    this.mat.ang = (this.mat.ang + w * Math.max(0, simDt || 0)) % (Math.PI * 2);
    // Along-track and radial cell coordinates of the camera in the material frame (camera angle minus the
    // material's turn), and its height in cells.
    const aT = ((((phi - this.mat.ang) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) * rho;   // along-track (planet radii)
    // Levels: cells doubling in size until they are as coarse as the far field's chunks.
    const nl = Math.max(1, Math.min(6, Math.ceil(Math.log2(Math.max(1, (3 * sRad) / cs))) + 1));
    const cells = [];
    for (let k = 0; k < nl; k++) {
      const c = cs * 2 ** k, A = aT / c, Rr = rho / c, ca = Math.floor(A), cr = Math.floor(Rr);
      cells.push([ca % 8388608, cr % 8388608, A - ca, Rr - cr]);  // (wrapped: floats hold integers exactly to 2^24)
    }
    const cr0 = Math.floor(rho / cs);
    // Axes at the camera's track position: along-track (direction of orbital motion), outward, normal.
    const er = [(e[0] * ux[0] + e[1] * wx[0]) / rho, (e[0] * ux[1] + e[1] * wx[1]) / rho, (e[0] * ux[2] + e[1] * wx[2]) / rho];
    const et = [n[1] * er[2] - n[2] * er[1], n[2] * er[0] - n[0] * er[2], n[0] * er[1] - n[1] * er[0]];
    const S = this.sData;
    S.set(r3d.P, 0);
    S.set([...r3d.viewOf(...et), 0], 16);
    S.set([...r3d.viewOf(...er), 0], 20);
    S.set([...r3d.viewOf(...n), 0], 24);
    S.set([0, 0, e[2] / cs, cs * R], 28);
    S.set([rho, cs, 0, G], 32);
    S.set([nl, 0, 0, 0], 36);
    const sv = r3d.viewOf(sunO[0] * ux[0] + sunO[1] * wx[0] + sunO[2] * n[0], sunO[0] * ux[1] + sunO[1] * wx[1] + sunO[2] * n[1], sunO[0] * ux[2] + sunO[1] * wx[2] + sunO[2] * n[2]);
    S.set([...sv, 0], 40);
    S.set([...sunO, 0], 44);
    S.set([...sunC, 0], 48);
    S.set([e[0], e[1], 0, Math.abs(e[2])], 52);
    S.set([r3d.F, t.w, t.h, r3d.dpr], 56);
    const Rkm = R * 1.495978707e8;
    SATURN.forEach(([r0, r1, tau, alb], i) => S.set([r0 / Rkm, r1 / Rkm, tau, alb], 60 + i * 4));
    cells.forEach((c, i) => S.set(c, 124 + i * 4));
    S.set([t.flip, logFC, 0, 0], 148);
    this.device.queue.writeBuffer(this.sU, 0, S);
    return { nl, reach: G * cs * 2 ** (nl - 1) };
  }

  // Which hosts this layer draws rings for (the WebGL view then skips its own ring particles for them).
  hosts(world) {
    const out = new Set();
    for (const h of world.ringOuter.keys()) if (h.alive && /^Saturn( \d+)?$/.test(h.name)) out.add(h);
    return out;
  }

  // r3d: the renderer, for its camera matrices and view helpers. simDt: simulated years this frame.
  // On its own canvas: clears it, then draws every host's rings.
  draw(r3d, world, simDt, hosts) {
    if (this.lost) return;
    const gl = r3d.canvas, cv = this.canvas;
    if (cv.width !== gl.width || cv.height !== gl.height) { cv.width = gl.width; cv.height = gl.height; }
    const dev = this.device, enc = dev.createCommandEncoder();
    const view = this.ctx.getCurrentTexture().createView();
    const pass0 = enc.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', clearValue: { r: 0, g: 0, b: 0, a: 0 }, storeOp: 'store' }] });
    pass0.end();
    for (const h of hosts) this.drawHost(r3d, world, simDt, h, enc, { view, format: this.format, samples: 1, depth: null, depthFormat: null, flip: 1, w: gl.width, h: gl.height }, 0);
    dev.queue.submit([enc.finish()]);
  }

  // Inside the WebGPU renderer (js/glgpu.js external()): one host's rings, recorded into the renderer's
  // command encoder and drawn into its current target t (view, format, samples, depth, flip, size).
  drawInto(r3d, world, simDt, h, enc, t) {
    if (this.lost) return;
    this.drawHost(r3d, world, simDt, h, enc, t, r3d.logFC);
  }

  drawHost(r3d, world, simDt, h, enc, t, logFC) {
    const dev = this.device;
    {
      const info = r3d.ringInfo && r3d.ringInfo.get(h);
      if (!info) return;
      const count = this.testCount || (r3d.settings.sharp ? 500000 : 250000);   // (testCount: fewer, for software GPUs in tests)
      const ring = this.ringFor(h, count);
      // Advance the orbits: ω = √(GM/R³) r^−3/2 rad per year (r in planet radii).
      const R = h.r, k = Math.sqrt((39.47692641 * h.m) / (R * R * R));
      dev.queue.writeBuffer(this.cU, 0, new Float32Array([k, Math.max(0, simDt || 0), 0, 0]));
      dev.queue.writeBuffer(this.cU, 8, new Uint32Array([count]));
      const cp = enc.beginComputePass();
      cp.setPipeline(this.cPipe); cp.setBindGroup(0, ring.cBind); cp.dispatchWorkgroups(Math.ceil(count / 256));
      cp.end();
      // Ring plane basis (world) from its normal.
      const n = info.n, a0 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
      let ux = [n[1] * a0[2] - n[2] * a0[1], n[2] * a0[0] - n[0] * a0[2], n[0] * a0[1] - n[1] * a0[0]];
      const ul = Math.hypot(...ux); ux = ux.map((v) => v / ul);
      const wx = [n[1] * ux[2] - n[2] * ux[1], n[2] * ux[0] - n[0] * ux[2], n[0] * ux[1] - n[1] * ux[0]];
      const rel = [h.x - r3d.ex, h.y - r3d.ey, h.z - r3d.ez];
      const d = this.rData;
      d.set(r3d.P, 0);
      d.set([...r3d.viewOf(...rel), R], 16);
      d.set([...r3d.viewOf(...ux), 0], 20);
      d.set([...r3d.viewOf(...wx), 0], 24);
      d.set([...r3d.viewOf(...n), ring.sRad], 28);
      const S = r3d.lumList && r3d.lumList[0];
      let sunO = [0, 0, 1], sunC = [0, 0, 0];
      if (S) {
        const sx = S.x - h.x, sy = S.y - h.y, sz = S.z - h.z, sl = Math.hypot(sx, sy, sz);
        const dot = (v) => (v[0] * sx + v[1] * sy + v[2] * sz) / sl;
        sunO = [dot(ux), dot(wx), dot(n)];
        const I = Math.min(1.3, Math.max(0.55, Math.pow(S.lum / (sl * sl), 0.08))) * 1.1;
        sunC = [I, I, I];
      }
      d.set([...sunC, 0], 32);
      d.set([...sunO, 0], 36);
      const e = [-rel[0] / R, -rel[1] / R, -rel[2] / R];
      d.set([e[0] * ux[0] + e[1] * ux[1] + e[2] * ux[2], e[0] * wx[0] + e[1] * wx[1] + e[2] * wx[2], e[0] * n[0] + e[1] * n[1] + e[2] * n[2], 0], 40);
      d.set([r3d.F, t.w, t.h, r3d.dpr], 44);
      // Occluders: the planet and the nearest large bodies around it.
      const occ = [h];
      const reach = info.rout * 4;
      for (const b of world.bodies) {
        if (b === h || !(b.r > 0) || b.kind === 'core') continue;
        if (Math.hypot(b.x - h.x, b.y - h.y, b.z - h.z) < reach) occ.push(b);
      }
      occ.sort((p, q) => q.r - p.r);
      const no = Math.min(16, occ.length);
      for (let i = 0; i < no; i++) {
        const b = occ[i];
        d.set([...r3d.viewOf(b.x - r3d.ex, b.y - r3d.ey, b.z - r3d.ez), b.r * (b === h ? 0.995 : 1)], 52 + i * 4);
      }
      // The swarm: only when the camera is near the ring plane, within the rings' span.
      const ez = d[42], rho = Math.hypot(d[40], d[41]);
      const h0 = Math.abs(ez);
      const G = 24, cs = Math.max(h0 * 0.07, 2e-7);                 // cell size (planet radii)
      const swarm = (SWARM_READY || this.forceSwarm) && h0 < 0.08 && rho > 0.9 * (66900 / (R * 1.495978707e8)) && rho < 1.1 * (140230 / (R * 1.495978707e8));
      const sw = swarm ? this.swarmUniforms(r3d, h, ux, wx, n, d, cs, G, sunO, sunC, simDt, ring.sRad, t, logFC) : null;
      d.set([no, sw ? sw.reach : 0, 0, 0], 48);
      d.set([t.flip, logFC, 0, 0], 116);
      dev.queue.writeBuffer(this.rU, 0, d);
      ring.swarm = sw;
      const pp = this.pipesFor(t.format, t.samples || 1, t.depth ? t.depthFormat : null);
      const desc = { colorAttachments: [{ view: t.view, loadOp: 'load', storeOp: 'store' }] };
      if (t.depth) desc.depthStencilAttachment = { view: t.depth, depthLoadOp: 'load', depthStoreOp: 'store' };
      const pass = enc.beginRenderPass(desc);
      pass.setPipeline(pp.ring); pass.setBindGroup(0, ring.rBind);
      pass.draw(4, count);
      if (ring.swarm) {
        pass.setPipeline(pp.swarm); pass.setBindGroup(0, this.sBind);
        pass.draw(4, (2 * 24 + 1) * (2 * 24 + 1) * 8 * ring.swarm.nl);
      }
      pass.end();
    }
  }
}
