// WebGL 2 on WebGPU: the subset of the WebGL 2 API that render3d.js uses, carried out with WebGPU. The
// renderer keeps its code; its shaders were translated ahead of time (js/wgsl.js, built by
// tools/make_wgsl.mjs) and are looked up by the hash of their GLSL source.
//
// How WebGL's state machine maps onto WebGPU:
//   - uniforms: each program keeps one std140 block in memory; every draw copies it into a per-frame ring
//     buffer and binds it with a dynamic offset;
//   - textures and samplers: WebGL's sampling state lives on the texture, so each texture gets a sampler;
//   - draws go into render passes, begun lazily on the bound framebuffer and ended when it changes, on
//     clear(), or on a blit; pipelines are cached by program, vertex layout and blend / depth / cull state;
//   - render targets are drawn upside down (the shaders' uGPUFlip), so textures read back in WebGL's row
//     order; the screen is drawn the right way up;
//   - point sprites are drawn as 4-vertex strips, one instance per point;
//   - everything recorded during a frame is submitted by flushFrame().

import { WGSL } from './wgsl.js';

const UBUF = 4 << 20;      // uniform ring buffer per frame (bytes)
const UALIGN = 256;        // dynamic-offset alignment

function programKey(vs, fs) {
  let h = 0x811c9dc5;
  const s = vs + '\u0000' + fs;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

// Float32 -> float16 bits (round to nearest).
const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
function toHalf(v) {
  f32[0] = v;
  const x = u32[0], s = (x >>> 16) & 0x8000, e = ((x >>> 23) & 0xff) - 112, m = x & 0x7fffff;
  if (e <= 0) return s | (e < -10 ? 0 : ((m | 0x800000) >> (1 - e + 13)));
  if (e >= 31) return s | 0x7c00 | (((x >>> 23) & 0xff) === 0xff && m ? 0x200 : 0);
  return s | (e << 10) | ((m + 0x1000) >> 13);
}

let nextId = 1;

const CFMT = { 0x9274: 'etc2-rgb8unorm', 0x8e8c: 'bc7-rgba-unorm', 0x83f0: 'bc1-rgba-unorm', 0x93b0: 'astc-4x4-unorm' };
const CBYTES = { 0x9274: 8, 0x8e8c: 16, 0x83f0: 8, 0x93b0: 16 };

export class GLonGPU {
  // device: a GPUDevice. canvas: where frames go (configured here), unless offscreen (tests), when the
  // default framebuffer is a texture that readDefault() returns.
  constructor(device, canvas, { offscreen = false } = {}) {
    for (const k of Object.getOwnPropertyNames(WebGL2RenderingContext)) if (/^[A-Z0-9_]+$/.test(k)) this[k] = WebGL2RenderingContext[k];
    this.device = device;
    this.canvas = canvas;
    this.offscreen = offscreen;
    this.canvasFormat = navigator.gpu.getPreferredCanvasFormat();
    if (!offscreen) {
      this.ctx = canvas.getContext('webgpu');
      this.ctx.configure({ device, format: this.canvasFormat, alphaMode: 'opaque' });
    }
    this.diag = [];
    device.addEventListener?.('uncapturederror', (e) => {
      if (this.diag.length < 12) this.diag.push(e.error.message.slice(0, 300));
      console.warn('WebGPU:', e.error.message);
      if (this.onError && this.diag.length === 1) this.onError(e.error.message.slice(0, 160));
    });
    this.ubuf = device.createBuffer({ size: UBUF, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.ustage = new ArrayBuffer(UBUF);
    this.uoff = 0;
    this.frame = 1;
    this.pipelines = new Map();
    this.samplers = new Map();
    this.bgl = new Map();
    this.state = { array: null, vao: null, unit: 0, units: [], program: null, drawFB: null, readFB: null,
      viewport: [0, 0, canvas.width, canvas.height], blend: false, bsrc: 1, bdst: 0, depth: false, dfunc: 0x0203, dmask: true,
      cull: false, cface: 0x0405, clearColor: [0, 0, 0, 0], clearDepth: 1, rb: null };
    this.defaultVao = this.createVertexArray();
    this.state.vao = this.defaultVao;
    this.dummy = this.makeTex(1, 1, 'rgba8unorm', 1);
    device.queue.writeTexture({ texture: this.dummy }, new Uint8Array([0, 0, 0, 255]), { bytesPerRow: 4 }, [1, 1]);
    this.encoder = null;
    this.pass = null;
  }

  // ---------- frame and passes ----------

  enc() { return this.encoder || (this.encoder = this.device.createCommandEncoder()); }

  endPass() { if (this.pass) { this.pass.end(); this.pass = null; this.passFB = undefined; } }

  // What a framebuffer draws into: colour view and format, depth view, sample count, flip.
  target(fb) {
    if (!fb) {
      if (!this.frameTex) {
        if (this.offscreen) {
          const w = this.canvas.width, h = this.canvas.height;
          if (!this.offTex || this.offTex.width !== w || this.offTex.height !== h) this.offTex = this.device.createTexture({ size: [w, h], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
          this.frameTex = this.offTex;
        } else this.frameTex = this.ctx.getCurrentTexture();
      }
      return { view: this.frameTex.createView(), format: this.offscreen ? 'rgba8unorm' : this.canvasFormat, depth: null, depthFormat: null, samples: 1, flip: 1, w: this.frameTex.width, h: this.frameTex.height };
    }
    const c = fb.color, d = fb.depth;
    return { view: c.view, format: c.format, depth: d ? d.view : null, depthFormat: d ? d.format : null, samples: c.samples || 1, flip: -1, w: c.w, h: c.h, colorObj: c };
  }

  beginPass(clearMask = 0) {
    this.endPass();
    const fb = this.state.drawFB, t = this.target(fb);
    const cc = this.state.clearColor;
    const desc = { colorAttachments: [{ view: t.view, loadOp: clearMask & this.COLOR_BUFFER_BIT ? 'clear' : 'load', storeOp: 'store', clearValue: { r: cc[0], g: cc[1], b: cc[2], a: cc[3] } }] };
    if (t.depth) desc.depthStencilAttachment = { view: t.depth, depthLoadOp: clearMask & this.DEPTH_BUFFER_BIT ? 'clear' : 'load', depthStoreOp: 'store', depthClearValue: this.state.clearDepth };
    this.pass = this.enc().beginRenderPass(desc);
    this.passFB = fb;
    this.passT = t;
  }

  // Submit everything recorded: uniforms first (queue writes run before the command buffer), then commands.
  flushFrame() {
    this.endPass();
    if (this.uoff > 0) this.device.queue.writeBuffer(this.ubuf, 0, new Uint8Array(this.ustage, 0, this.uoff));
    if (this.encoder) {
      this.device.queue.submit([this.encoder.finish()]);
      // Watchdog: one probe at a time on when the GPU finishes; see stalled.
      if (!this.waiting) {
        const t = (this.waiting = performance.now());
        this.waitFrames = 0;
        this.device.queue.onSubmittedWorkDone().then(() => { if (this.waiting === t) this.waiting = 0; });
      } else this.waitFrames++;
    }
    this.encoder = null;
    // Replaced textures and buffers: destroying them now lets the submitted work finish first.
    if (this.retired) { for (const r of this.retired) r.destroy(); this.retired = null; }
    this.uoff = 0;
    this.frameTex = null;
    this.frame++;
  }

  // The GPU has been working on one submission for over 10 s while 60 more frames were sent after it: hung,
  // or far too slow to use. (Not in the off-screen test mode, where nothing makes the page wait for the GPU.
  // Counting frames keeps a page that was itself busy, e.g. building a preset, from
  // looking like a stalled GPU; the first frames compile every pipeline and are not counted either.)
  get stalled() { return !this.offscreen && this.frame > 120 && this.waiting > 0 && this.waitFrames > 60 && performance.now() - this.waiting > 10000; }

  finish() { this.flushFrame(); }

  // Native WebGPU work in the middle of the frame (the ring layer, js/gpu.js): fn(encoder, target) records its
  // own passes into this frame's encoder, drawing into the framebuffer bound now (its view, format, sample
  // count, depth view and format, flip, size). Later draws start a new pass that keeps what it drew.
  external(fn) {
    this.endPass();
    fn(this.enc(), this.target(this.state.drawFB));
  }
  flush() {}

  // Test helper: the offscreen default framebuffer's pixels (RGBA, top row first).
  async readDefault() {
    this.flushFrame();
    const t = this.offTex, w = t.width, h = t.height, bpr = Math.ceil((w * 4) / 256) * 256;
    const buf = this.device.createBuffer({ size: bpr * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const e = this.device.createCommandEncoder();
    e.copyTextureToBuffer({ texture: t }, { buffer: buf, bytesPerRow: bpr }, [w, h]);
    this.device.queue.submit([e.finish()]);
    await buf.mapAsync(GPUMapMode.READ);
    const src = new Uint8Array(buf.getMappedRange()), out = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) out.set(src.subarray(y * bpr, y * bpr + w * 4), y * w * 4);
    buf.unmap();
    return { w, h, data: out };
  }

  // ---------- misc state ----------

  getExtension(name) {
    // Compressed formats (js/ktx.js), as the device's features allow: the WebGL constant -> WebGPU format.
    const f = this.device.features, cx = { WEBGL_compressed_texture_etc: ['texture-compression-etc2', { COMPRESSED_RGB8_ETC2: 0x9274 }],
      EXT_texture_compression_bptc: ['texture-compression-bc', { COMPRESSED_RGBA_BPTC_UNORM_EXT: 0x8e8c }],
      WEBGL_compressed_texture_s3tc: ['texture-compression-bc', { COMPRESSED_RGB_S3TC_DXT1_EXT: 0x83f0 }],
      WEBGL_compressed_texture_astc: ['texture-compression-astc', { COMPRESSED_RGBA_ASTC_4x4_KHR: 0x93b0 }] }[name];
    if (cx) return f && f.has(cx[0]) ? cx[1] : null;
    if (/texture_filter_anisotropic/.test(name)) return { TEXTURE_MAX_ANISOTROPY_EXT: 0x84fe, MAX_TEXTURE_MAX_ANISOTROPY_EXT: 0x84ff };
    return /color_buffer_float|color_buffer_half_float|float_blend|texture_float_linear/.test(name) ? {} : null;
  }
  getParameter(p) { return p === this.MAX_SAMPLES ? 4 : p === this.MAX_TEXTURE_SIZE ? 8192 : p === 0x84ff ? 16 : 0; }
  isContextLost() { return false; }
  getContextAttributes() { return { alpha: false, antialias: false, depth: false }; }
  enable(c) { this.setCap(c, true); }
  disable(c) { this.setCap(c, false); }
  setCap(c, v) { const s = this.state; if (c === this.BLEND) s.blend = v; else if (c === this.DEPTH_TEST) s.depth = v; else if (c === this.CULL_FACE) s.cull = v; }
  blendFunc(a, b) { this.state.bsrc = a; this.state.bdst = b; }
  depthFunc(f) { this.state.dfunc = f; }
  depthMask(m) { this.state.dmask = !!m; }
  cullFace(f) { this.state.cface = f; }
  viewport(x, y, w, h) { this.state.viewport = [x, y, w, h]; }
  clearColor(r, g, b, a) { this.state.clearColor = [r, g, b, a]; }
  clearDepth(d) { this.state.clearDepth = d; }
  clear(mask) { this.beginPass(mask); }
  pixelStorei() {}
  colorMask(r, g, b, a) { this.state.cmask = (r ? 1 : 0) | (g ? 2 : 0) | (b ? 4 : 0) | (a ? 8 : 0); }
  scissor() {}

  // ---------- buffers and vertex arrays ----------

  createBuffer() { return { id: nextId++, gpu: null, size: 0, used: 0 }; }
  deleteBuffer(b) { if (b && b.gpu) this.retire(b.gpu); }
  bindBuffer(target, b) {
    if (target === this.ARRAY_BUFFER) this.state.array = b;
    else this.state.vao.elem = b;
  }
  bufferData(target, data, usage) {
    const b = target === this.ARRAY_BUFFER ? this.state.array : this.state.vao.elem;
    const bytes = typeof data === 'number' ? data : data.byteLength;
    const size = Math.max(4, Math.ceil(bytes / 4) * 4);
    // A buffer already drawn from this frame is replaced, not overwritten (queue writes would land before
    // the earlier draws ran).
    if (!b.gpu || b.size < size || b.used === this.frame) {
      if (b.gpu) this.retire(b.gpu);
      b.gpu = this.device.createBuffer({ size: Math.max(size, b.size || 0), usage: GPUBufferUsage.VERTEX | GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
      b.size = b.gpu.size;
      b.used = 0;
    }
    b.bytes = bytes;
    if (typeof data !== 'number' && bytes > 0) {
      const src = new Uint8Array(data.buffer, data.byteOffset, bytes);
      if (bytes % 4) { const pad = new Uint8Array(size); pad.set(src); this.device.queue.writeBuffer(b.gpu, 0, pad); }
      else this.device.queue.writeBuffer(b.gpu, 0, src);
    }
  }
  bufferSubData(target, off, data) {
    const b = target === this.ARRAY_BUFFER ? this.state.array : this.state.vao.elem;
    this.device.queue.writeBuffer(b.gpu, off, data);
  }
  createVertexArray() { return { id: nextId++, attribs: new Map(), elem: null }; }
  deleteVertexArray() {}
  bindVertexArray(v) { this.state.vao = v || this.defaultVao; }
  enableVertexAttribArray(loc) { const a = this.state.vao.attribs.get(loc) || {}; a.on = true; this.state.vao.attribs.set(loc, a); }
  disableVertexAttribArray(loc) { const a = this.state.vao.attribs.get(loc); if (a) a.on = false; }
  vertexAttribPointer(loc, size, type, norm, stride, offset) {
    const a = this.state.vao.attribs.get(loc) || { on: false };
    Object.assign(a, { buf: this.state.array, size, type, norm, stride, offset });
    this.state.vao.attribs.set(loc, a);
  }

  // ---------- textures, renderbuffers, framebuffers ----------

  makeTex(w, h, format, mips, samples = 1) {
    let usage = GPUTextureUsage.RENDER_ATTACHMENT;
    if (samples === 1) usage |= GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC;
    return this.device.createTexture({ size: [w, h], format, mipLevelCount: mips, sampleCount: samples, usage });
  }
  createTexture() { return { id: nextId++, gpu: null, view: null, w: 0, h: 0, format: null, mips: 1, minF: this.NEAREST_MIPMAP_LINEAR, magF: this.LINEAR, wrapS: this.REPEAT, wrapT: this.REPEAT }; }
  deleteTexture(t) { if (t && t.gpu) this.retire(t.gpu); }
  activeTexture(u) { this.state.unit = u - this.TEXTURE0; }
  bindTexture(target, t) { this.state.units[this.state.unit] = t; }
  texParameteri(target, p, v) {
    const t = this.state.units[this.state.unit];
    if (!t) return;
    if (p === this.TEXTURE_MIN_FILTER) t.minF = v; else if (p === this.TEXTURE_MAG_FILTER) t.magF = v;
    else if (p === this.TEXTURE_WRAP_S) t.wrapS = v; else if (p === this.TEXTURE_WRAP_T) t.wrapT = v;
    else if (p === this.TEXTURE_MAX_LEVEL) t.maxLevel = v;
    else if (p === 0x84fe) t.aniso = Math.max(1, Math.min(16, Math.round(v)));
  }
  texParameterf(target, p, v) { this.texParameteri(target, p, v); }
  allocTex(t, w, h, format) {
    if (t.gpu && t.w === w && t.h === h && t.format === format && t.mips === 1) return;
    if (t.gpu) this.retire(t.gpu);
    t.gpu = this.makeTex(w, h, format, 1); t.view = t.gpu.createView();
    t.w = w; t.h = h; t.format = format; t.mips = 1; t.samples = 1;
  }
  fmt(internal, type) {
    if (internal === this.RGBA16F) return 'rgba16float';
    if (internal === this.R16F || internal === this.R32F) return 'r16float';
    return 'rgba8unorm';
  }
  texImage2D(target, level, internal, a, b, c, d, e, f) {
    const t = this.state.units[this.state.unit];
    if (level !== 0) return;
    if (arguments.length === 6) {
      // (target, level, internalformat, format, type, source)
      const src = c, w = src.naturalWidth || src.videoWidth || src.width, h = src.naturalHeight || src.videoHeight || src.height;
      this.allocTex(t, w, h, 'rgba8unorm');
      this.device.queue.copyExternalImageToTexture({ source: src }, { texture: t.gpu }, [w, h]);
      return;
    }
    // (target, level, internalformat, width, height, border, format, type, data)
    const w = a, h = b, type = e, data = f, format = this.fmt(internal, type);
    this.allocTex(t, w, h, format);
    if (data) this.upload(t, 0, 0, w, h, data, type);
  }
  // Compressed textures (js/ktx.js): allocated whole with a given number of levels, filled block by block.
  compressedTexImage2D(target, level, internal, w, h, border, data) {
    const t = this.state.units[this.state.unit], format = CFMT[internal];
    if (!t || !format) return;
    if (level === 0) {
      if (t.gpu) this.retire(t.gpu);
      t.mips = t.maxLevel != null ? t.maxLevel + 1 : Math.floor(Math.log2(Math.max(w, h))) + 1;
      t.gpu = this.device.createTexture({ size: [w, h], format, mipLevelCount: t.mips, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
      t.view = t.gpu.createView(); t.w = w; t.h = h; t.format = format; t.samples = 1;
    }
    if (data && data.byteLength) this.compressedTexSubImage2D(target, level, 0, 0, w, h, internal, data);
  }
  compressedTexSubImage2D(target, level, x, y, w, h, internal, data) {
    const t = this.state.units[this.state.unit];
    if (!t || !t.gpu || level >= t.mips) return;
    const bw = Math.ceil(w / 4), bh = Math.ceil(h / 4), bpb = CBYTES[internal];
    this.device.queue.writeTexture({ texture: t.gpu, mipLevel: level, origin: [x, y] }, data, { bytesPerRow: bw * bpb, rowsPerImage: bh }, [bw * 4, bh * 4]);
  }
  texSubImage2D(target, level, x, y, w, h, format, type, data) {
    const t = this.state.units[this.state.unit];
    if (level !== 0 || !t || !t.gpu) return;
    this.upload(t, x, y, w, h, data, type);
  }
  upload(t, x, y, w, h, data, type) {
    if (t.format === 'r16float') {
      const half = new Uint16Array(w * h);
      if (type === this.HALF_FLOAT) half.set(data); else for (let i = 0; i < half.length; i++) half[i] = toHalf(data[i]);
      this.device.queue.writeTexture({ texture: t.gpu, origin: [x, y] }, half, { bytesPerRow: w * 2 }, [w, h]);
    } else if (t.format === 'rgba16float') {
      const half = type === this.HALF_FLOAT ? data : Uint16Array.from(data, toHalf);
      this.device.queue.writeTexture({ texture: t.gpu, origin: [x, y] }, half, { bytesPerRow: w * 8 }, [w, h]);
    } else {
      const bytes = data instanceof Uint8Array || data instanceof Uint8ClampedArray ? data : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      this.device.queue.writeTexture({ texture: t.gpu, origin: [x, y] }, bytes, { bytesPerRow: w * 4 }, [w, h]);
    }
  }
  // Mipmaps: re-create the texture with a full chain, copy level 0, then halve level by level with a blit.
  generateMipmap() {
    const t = this.state.units[this.state.unit];
    if (!t || !t.gpu) return;
    const levels = Math.floor(Math.log2(Math.max(t.w, t.h))) + 1;
    this.endPass();
    const old = t.gpu;
    const nt = this.makeTex(t.w, t.h, t.format, levels);
    const e = this.enc();
    e.copyTextureToTexture({ texture: old }, { texture: nt }, [t.w, t.h]);
    const pipe = this.blitPipeline(t.format);
    const smp = this.device.createSampler({ minFilter: 'linear', magFilter: 'linear' });
    for (let i = 1; i < levels; i++) {
      const bg = this.device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: nt.createView({ baseMipLevel: i - 1, mipLevelCount: 1 }) }, { binding: 1, resource: smp }] });
      const p = e.beginRenderPass({ colorAttachments: [{ view: nt.createView({ baseMipLevel: i, mipLevelCount: 1 }), loadOp: 'clear', storeOp: 'store' }] });
      p.setPipeline(pipe); p.setBindGroup(0, bg); p.draw(3); p.end();
    }
    this.retire(old);
    t.gpu = nt; t.view = nt.createView(); t.mips = levels;
  }
  // Destroy a texture once the commands using it have run.
  retire(tex) { (this.retired ||= []).push(tex); }
  blitPipeline(format) {
    this.blits ||= new Map();
    let p = this.blits.get(format);
    if (p) return p;
    const m = this.device.createShaderModule({ code: `
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var smp: sampler;
struct VO { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> VO {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  var o: VO; o.pos = vec4f(p * 2.0 - 1.0, 0.0, 1.0); o.uv = vec2f(p.x, 1.0 - p.y); return o;
}
@fragment fn fs(i: VO) -> @location(0) vec4f { return textureSample(src, smp, i.uv); }` });
    p = this.device.createRenderPipeline({ layout: 'auto', vertex: { module: m, entryPoint: 'vs' }, fragment: { module: m, entryPoint: 'fs', targets: [{ format }] }, primitive: { topology: 'triangle-list' } });
    this.blits.set(format, p);
    return p;
  }

  createRenderbuffer() { return { id: nextId++, gpu: null, view: null }; }
  deleteRenderbuffer(r) { if (r && r.gpu) this.retire(r.gpu); }
  bindRenderbuffer(target, r) { this.state.rb = r; }
  renderbufferStorage(target, internal, w, h) { this.renderbufferStorageMultisample(target, 0, internal, w, h); }
  renderbufferStorageMultisample(target, samples, internal, w, h) {
    const r = this.state.rb;
    const depth = internal === this.DEPTH_COMPONENT24 || internal === this.DEPTH_COMPONENT16 || internal === this.DEPTH_COMPONENT32F || internal === this.DEPTH24_STENCIL8;
    const format = depth ? 'depth24plus' : this.fmt(internal);
    const n = samples > 1 ? 4 : 1;
    if (r.gpu) this.retire(r.gpu);
    r.gpu = this.device.createTexture({ size: [w, h], format, sampleCount: n, usage: GPUTextureUsage.RENDER_ATTACHMENT | (n === 1 && !depth ? GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC : 0) });
    r.view = r.gpu.createView(); r.format = format; r.samples = n; r.w = w; r.h = h;
  }
  createFramebuffer() { return { id: nextId++, color: null, depth: null }; }
  deleteFramebuffer() {}
  bindFramebuffer(target, fb) {
    if (target === this.READ_FRAMEBUFFER) this.state.readFB = fb;
    else if (target === this.DRAW_FRAMEBUFFER) this.state.drawFB = fb;
    else { this.state.drawFB = fb; this.state.readFB = fb; }
  }
  framebufferTexture2D(target, attach, tt, t) { const fb = this.state.drawFB; fb.color = t; }
  framebufferRenderbuffer(target, attach, rt, r) { const fb = this.state.drawFB; if (attach === this.DEPTH_ATTACHMENT || attach === this.DEPTH_STENCIL_ATTACHMENT) fb.depth = r; else fb.color = r; }
  checkFramebufferStatus() { return this.FRAMEBUFFER_COMPLETE; }
  // Only the multisample resolve render3d needs (same size), or a plain copy.
  blitFramebuffer(sx0, sy0, sx1, sy1, dx0, dy0, dx1, dy1, mask) {
    const src = this.state.readFB, dst = this.state.drawFB;
    if (!(mask & this.COLOR_BUFFER_BIT) || !src || !dst) return;
    this.endPass();
    const s = src.color, d = dst.color, e = this.enc();
    if ((s.samples || 1) > 1) {
      const p = e.beginRenderPass({ colorAttachments: [{ view: s.view, resolveTarget: d.view, loadOp: 'load', storeOp: 'store' }] });
      p.end();
    } else e.copyTextureToTexture({ texture: s.gpu }, { texture: d.gpu }, [Math.min(s.w, d.w), Math.min(s.h, d.h)]);
  }

  // ---------- programs and uniforms ----------

  createShader(type) { return { type, src: '' }; }
  shaderSource(s, src) { s.src = src; }
  compileShader() {}
  getShaderParameter() { return true; }
  getShaderInfoLog() { return ''; }
  deleteShader() {}
  createProgram() { return { id: nextId++, shaders: [] }; }
  attachShader(p, s) { p.shaders.push(s); }
  deleteProgram() {}
  linkProgram(p) {
    const vs = p.shaders.find((s) => s.type === this.VERTEX_SHADER).src, fs = p.shaders.find((s) => s.type === this.FRAGMENT_SHADER).src;
    const info = WGSL[programKey(vs, fs)];
    if (!info) { p.error = 'no WGSL translation for this program (run tools/make_wgsl.mjs)'; return; }
    p.info = info;
    p.vs = this.device.createShaderModule({ code: info.vs });
    p.fs = this.device.createShaderModule({ code: info.fs });
    for (const [st, m] of [['vertex', p.vs], ['fragment', p.fs]]) m.getCompilationInfo?.().then((ci) => { for (const x of ci.messages) if (x.type === 'error') this.diag.push(`${info.name} ${st}: ${x.message}`); });
    p.data = new ArrayBuffer(info.size);
    p.f = new Float32Array(p.data); p.i = new Int32Array(p.data);
    p.members = new Map(info.uniforms.map((m) => [m.name, m]));
    p.units = {};
    p.layout = this.layoutFor(info.samplers.length);
    p.attrs = info.attributes;
  }
  getProgramParameter(p, what) {
    if (what === this.LINK_STATUS) return !p.error;
    if (what === this.ACTIVE_UNIFORMS) return p.info ? p.info.uniforms.filter((m) => !m.name.startsWith('uGPU')).length + p.info.samplers.length : 0;
    return 0;
  }
  getProgramInfoLog(p) { return p.error || ''; }
  getActiveUniform(p, i) {
    const us = p.info.uniforms.filter((m) => !m.name.startsWith('uGPU'));
    if (i < us.length) return { name: us[i].count ? us[i].name + '[0]' : us[i].name };
    return { name: p.info.samplers[i - us.length] };
  }
  getUniformLocation(p, name) {
    name = name.replace('[0]', '');
    const m = p.members.get(name);
    if (m) return { p, m };
    if (p.info.samplers.includes(name)) return { p, sampler: name };
    return null;
  }
  useProgram(p) { this.state.program = p; }
  // Writes `n` components per element into a member (arrays: one element per 16-byte stride).
  put(loc, v, n) {
    if (!loc) return;
    const { p, m } = loc;
    const base = m.offset >> 2;
    if (m.count) {
      const step = m.stride >> 2, els = Math.min(m.count, Math.floor(v.length / n));
      for (let e = 0; e < els; e++) for (let k = 0; k < n; k++) p.f[base + e * step + k] = v[e * n + k];
    } else for (let k = 0; k < n; k++) p.f[base + k] = v[k];
  }
  uniform1f(l, x) { if (l && l.m) l.p.f[l.m.offset >> 2] = x; }
  uniform2f(l, x, y) { this.put(l, [x, y], 2); }
  uniform3f(l, x, y, z) { this.put(l, [x, y, z], 3); }
  uniform4f(l, x, y, z, w) { this.put(l, [x, y, z, w], 4); }
  uniform1fv(l, v) { this.put(l, v, 1); }
  uniform2fv(l, v) { this.put(l, v, 2); }
  uniform3fv(l, v) { this.put(l, v, 3); }
  uniform4fv(l, v) { this.put(l, v, 4); }
  uniform1i(l, x) {
    if (!l) return;
    if (l.sampler) { l.p.units[l.sampler] = x; return; }
    l.p.i[l.m.offset >> 2] = x;
  }
  uniform1iv(l, v) { if (l && l.m) for (let e = 0; e < v.length && e < (l.m.count || 1); e++) l.p.i[(l.m.offset >> 2) + e * ((l.m.stride || 16) >> 2)] = v[e]; }
  uniformMatrix3fv(l, tr, v) {
    if (!l || !l.m) return;
    const b = l.m.offset >> 2, f = l.p.f;
    for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) f[b + c * 4 + r] = v[c * 3 + r];
  }
  uniformMatrix4fv(l, tr, v) { if (l && l.m) l.p.f.set(v, l.m.offset >> 2); }

  // ---------- drawing ----------

  layoutFor(nTex) {
    let l = this.bgl.get(nTex);
    if (l) return l;
    const vis = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT;
    const entries = [{ binding: 0, visibility: vis, buffer: { type: 'uniform', hasDynamicOffset: true } }];
    for (let i = 0; i < nTex; i++) {
      entries.push({ binding: 1 + 2 * i, visibility: vis, texture: { sampleType: 'float' } });
      entries.push({ binding: 2 + 2 * i, visibility: vis, sampler: { type: 'filtering' } });
    }
    const bgl = this.device.createBindGroupLayout({ entries });
    l = { bgl, pl: this.device.createPipelineLayout({ bindGroupLayouts: [bgl] }) };
    this.bgl.set(nTex, l);
    return l;
  }
  samplerFor(t) {
    const mip = t.mips > 1 && (t.minF === this.LINEAR_MIPMAP_LINEAR || t.minF === this.NEAREST_MIPMAP_LINEAR || t.minF === this.LINEAR_MIPMAP_NEAREST);
    const min = t.minF === this.NEAREST || t.minF === this.NEAREST_MIPMAP_LINEAR || t.minF === this.NEAREST_MIPMAP_NEAREST ? 'nearest' : 'linear';
    const wrap = (w) => (w === this.CLAMP_TO_EDGE ? 'clamp-to-edge' : w === this.MIRRORED_REPEAT ? 'mirror-repeat' : 'repeat');
    // (WebGPU allows anisotropy only with linear filtering throughout.)
    const an = mip && min === 'linear' && t.magF !== this.NEAREST ? t.aniso || 1 : 1;
    const key = `${min}|${t.magF}|${mip}|${t.wrapS}|${t.wrapT}|${an}`;
    let s = this.samplers.get(key);
    if (!s) {
      s = this.device.createSampler({ minFilter: min, magFilter: t.magF === this.NEAREST ? 'nearest' : 'linear', mipmapFilter: mip ? 'linear' : 'nearest',
        addressModeU: wrap(t.wrapS), addressModeV: wrap(t.wrapT), lodMaxClamp: mip ? 32 : 0, maxAnisotropy: an });
      this.samplers.set(key, s);
    }
    return s;
  }
  blendFactor(f) {
    switch (f) {
      case this.ONE: return 'one'; case this.ZERO: return 'zero';
      case this.SRC_ALPHA: return 'src-alpha'; case this.ONE_MINUS_SRC_ALPHA: return 'one-minus-src-alpha';
      case this.DST_ALPHA: return 'dst-alpha'; case this.ONE_MINUS_DST_ALPHA: return 'one-minus-dst-alpha';
      case this.SRC_COLOR: return 'src'; case this.ONE_MINUS_SRC_COLOR: return 'one-minus-src';
      case this.DST_COLOR: return 'dst'; case this.ONE_MINUS_DST_COLOR: return 'one-minus-dst';
      default: return 'one';
    }
  }
  depthCompare(f) {
    switch (f) {
      case this.LESS: return 'less'; case this.LEQUAL: return 'less-equal'; case this.GREATER: return 'greater';
      case this.GEQUAL: return 'greater-equal'; case this.EQUAL: return 'equal'; case this.ALWAYS: return 'always';
      case this.NEVER: return 'never'; default: return 'less';
    }
  }

  draw(mode, first, count, indexType, indexOffset) {
    const p = this.state.program, s = this.state;
    if (!p || !p.info || count <= 0) return;
    if (!this.pass || this.passFB !== s.drawFB) this.beginPass(0);
    const t = this.passT;
    const points = p.info.points && mode === this.POINTS;
    // Vertex buffers: one slot per GL buffer feeding the program's attributes.
    const vao = s.vao, slots = [], slotOf = new Map();
    for (const at of p.attrs) {
      const a = vao.attribs.get(at.location);
      if (!a || !a.on || !a.buf || !a.buf.gpu) return;      // incomplete: WebGL would draw garbage, skip
      let sl = slotOf.get(a.buf);
      if (!sl) { sl = { buf: a.buf, stride: a.stride || 0, attrs: [], min: Infinity }; slotOf.set(a.buf, sl); slots.push(sl); }
      const fmt = a.type === this.FLOAT ? ['float32', 'float32x2', 'float32x3', 'float32x4'][a.size - 1]
        : a.type === this.UNSIGNED_BYTE ? (a.norm ? ['unorm8x2', 'unorm8x2', 'unorm8x4', 'unorm8x4'][a.size - 1] : ['uint8x2', 'uint8x2', 'uint8x4', 'uint8x4'][a.size - 1]) : 'float32';
      const bytes = a.type === this.FLOAT ? 4 * a.size : a.size <= 2 ? 2 : 4;
      sl.attrs.push({ shaderLocation: at.location, format: fmt, offset: a.offset || 0, bytes });
      sl.min = Math.min(sl.min, a.offset || 0);
    }
    for (const sl of slots) {
      // Tightly packed if no stride was given; attribute offsets become relative to the slot's own base.
      if (!sl.stride) sl.stride = sl.attrs.reduce((m, a) => Math.max(m, a.offset - sl.min + a.bytes), 0);
      for (const a of sl.attrs) a.rel = a.offset - sl.min;
    }
    const topo = points ? 'triangle-strip' : mode === this.TRIANGLE_STRIP ? 'triangle-strip' : mode === this.LINES ? 'line-list' : mode === this.LINE_STRIP ? 'line-strip' : mode === this.POINTS ? 'point-list' : 'triangle-list';
    const depthOn = !!t.depth;
    const key = [p.id, slots.map((sl) => sl.stride + ':' + sl.attrs.map((a) => a.shaderLocation + a.format + a.rel).join(',')).join(';'), topo, points ? 'i' : 'v',
      s.blend ? s.bsrc + '/' + s.bdst : 'nb', depthOn ? (s.depth ? s.dfunc + (s.dmask ? 'w' : 'r') : 'off') : 'nd', s.cull ? s.cface : 'nc', t.format, t.depthFormat, t.samples, t.flip,
      indexType && topo === 'triangle-strip' ? indexType : '', s.cmask ?? 15].join('|');
    let pipe = this.pipelines.get(key);
    if (!pipe) {
      const blend = s.blend ? { color: { srcFactor: this.blendFactor(s.bsrc), dstFactor: this.blendFactor(s.bdst), operation: 'add' }, alpha: { srcFactor: this.blendFactor(s.bsrc), dstFactor: this.blendFactor(s.bdst), operation: 'add' } } : undefined;
      const desc = {
        layout: p.layout.pl,
        vertex: { module: p.vs, entryPoint: 'main', buffers: slots.map((sl) => ({ arrayStride: sl.stride, stepMode: points ? 'instance' : 'vertex', attributes: sl.attrs.map((a) => ({ shaderLocation: a.shaderLocation, format: a.format, offset: a.rel })) })) },
        fragment: { module: p.fs, entryPoint: 'main', targets: [{ format: t.format, blend, writeMask: s.cmask ?? 15 }] },
        primitive: { topology: topo, cullMode: s.cull ? (s.cface === this.FRONT ? 'front' : 'back') : 'none', frontFace: t.flip < 0 ? 'cw' : 'ccw',
          stripIndexFormat: indexType && topo === 'triangle-strip' ? (indexType === this.UNSIGNED_INT ? 'uint32' : 'uint16') : undefined },
        multisample: { count: t.samples },
      };
      if (depthOn) desc.depthStencil = { format: t.depthFormat, depthWriteEnabled: s.depth && s.dmask, depthCompare: s.depth ? this.depthCompare(s.dfunc) : 'always' };
      pipe = this.device.createRenderPipeline(desc);
      this.pipelines.set(key, pipe);
    }
    // Uniforms: this draw's copy of the block, with the emulation's own two values.
    const vp = s.viewport;
    const mv = p.members.get('uGPUViewport'), mf = p.members.get('uGPUFlip'), mh = p.members.get('uGPUTargetH');
    if (mh) p.f[mh.offset >> 2] = t.h;
    if (mv) { p.f[mv.offset >> 2] = vp[2]; p.f[(mv.offset >> 2) + 1] = vp[3]; }
    if (mf) p.f[mf.offset >> 2] = t.flip;
    if (this.uoff + p.data.byteLength > UBUF) { this.flushFrame(); this.beginPass(0); }
    const off = this.uoff;
    new Uint8Array(this.ustage, off, p.data.byteLength).set(new Uint8Array(p.data));
    this.uoff = Math.ceil((off + p.data.byteLength) / UALIGN) * UALIGN;
    // Textures, by the unit each sampler uniform names.
    const entries = [{ binding: 0, resource: { buffer: this.ubuf, size: Math.max(16, p.data.byteLength) } }];
    p.info.samplers.forEach((name, i) => {
      const tex = s.units[p.units[name] || 0];
      const ok = tex && tex.gpu && tex !== t.colorObj;     // (never sample the texture being drawn into)
      entries.push({ binding: 1 + 2 * i, resource: ok ? tex.view : this.dummyView || (this.dummyView = this.dummy.createView()) });
      entries.push({ binding: 2 + 2 * i, resource: ok ? this.samplerFor(tex) : this.samplerFor({ minF: this.LINEAR, magF: this.LINEAR, mips: 1, wrapS: this.CLAMP_TO_EDGE, wrapT: this.CLAMP_TO_EDGE }) });
    });
    const bg = this.device.createBindGroup({ layout: p.layout.bgl, entries });
    const pass = this.pass;
    pass.setPipeline(pipe);
    pass.setBindGroup(0, bg, [off]);
    // WebGL's viewport counts from the bottom; render targets are stored that way, the screen is not.
    const vy = t.flip < 0 ? vp[1] : t.h - vp[1] - vp[3];
    pass.setViewport(vp[0], Math.max(0, vy), Math.min(vp[2], t.w), Math.min(vp[3], t.h), 0, 1);
    slots.forEach((sl, i) => { pass.setVertexBuffer(i, sl.buf.gpu, sl.min); sl.buf.used = this.frame; });
    if (indexType) {
      const eb = vao.elem;
      eb.used = this.frame;
      const bytes = indexType === this.UNSIGNED_INT ? 4 : 2;
      pass.setIndexBuffer(eb.gpu, bytes === 4 ? 'uint32' : 'uint16');
      pass.drawIndexed(count, 1, (indexOffset || 0) / bytes, 0, 0);
    } else if (points) pass.draw(4, count, 0, first);
    else pass.draw(count, 1, first, 0);
  }
  drawArrays(mode, first, count) { this.draw(mode, first, count, 0, 0); }
  drawElements(mode, count, type, offset) { this.draw(mode, 0, count, type, offset); }
}
