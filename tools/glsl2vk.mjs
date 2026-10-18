// GLSL ES 3.00 (WebGL2) -> Vulkan-flavoured GLSL 4.50, for translation to WGSL (tools/make_wgsl.mjs).
//   - loose uniforms of both stages go into one std140 block (binding 0), shared by both stages, plus the
//     emulation's own uGPUViewport (pixels), uGPUTargetH (the target's height, for gl_FragCoord) and uGPUFlip (±1: render targets are drawn upside down so they
//     read back the way WebGL stores them);
//   - each sampler2D becomes a texture2D and a sampler (bindings 1, 2, 3, ...); helper functions taking a
//     sampler2D take the pair instead, since a combined sampler may only be built where it is used;
//   - varyings get explicit locations, matched by name;
//   - point sprites (gl_PointSize / gl_PointCoord) become quads: each point is an instance of a 4-vertex strip;
//   - main is wrapped to map clip-space depth from WebGL's [-w, w] to WebGPU's [0, w] and apply the flip.

const TYPES = new Set(['float', 'int', 'uint', 'bool', 'vec2', 'vec3', 'vec4', 'ivec2', 'ivec3', 'ivec4', 'mat2', 'mat3', 'mat4']);

function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, '');
}

// Split the top level of a shader into statements: declarations end with ';' at depth 0, functions with
// their closing brace. Preprocessor lines are kept as their own statements.
function topLevel(src) {
  const out = [];
  let cur = '', depth = 0;
  const lines = src.split('\n');
  for (const line of lines) {
    if (depth === 0 && /^\s*#/.test(line)) { if (cur.trim()) { out.push(cur); cur = ''; } out.push(line); continue; }
    for (const ch of line + '\n') {
      cur += ch;
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) { out.push(cur); cur = ''; } }
      else if (ch === ';' && depth === 0) { out.push(cur); cur = ''; }
    }
  }
  if (cur.trim()) out.push(cur);
  return out;
}

const DECL = /^\s*(layout\s*\(([^)]*)\)\s*)?((?:flat|smooth|centroid)\s+)?(in|out|uniform)\s+(?:(?:highp|mediump|lowp)\s+)?(\w+)\s+([^;]+);\s*$/s;

function parseStage(src) {
  const decls = { ins: [], outs: [], uniforms: [], samplers: [] };
  const body = [];
  for (const st of topLevel(stripComments(src))) {
    const t = st.trim();
    if (!t) continue;
    if (/^#version/.test(t) || /^precision\s/.test(t)) continue;
    const m = t.match(DECL);
    if (!m) { body.push(st); continue; }
    const [, , layout, interp, q, type, names] = m;
    for (let n of names.split(',')) {
      n = n.trim();
      const am = n.match(/^(\w+)\s*(?:\[\s*(\d+)\s*\])?$/);
      if (!am) throw new Error('cannot parse declaration: ' + t);
      const d = { name: am[1], type, count: am[2] ? +am[2] : 0, layout: layout || '', flat: !!(interp && interp.startsWith('flat')) };
      if (q === 'uniform') (type === 'sampler2D' ? decls.samplers : decls.uniforms).push(d);
      else if (q === 'in') decls.ins.push(d);
      else decls.outs.push(d);
    }
  }
  return { decls, body: body.join('\n') };
}

// Rewrite sampler use: builtins get sampler2D(t, s); user helpers get (t, s) as two arguments.
function rewriteSamplers(code, samplerNames) {
  const BUILTIN = 'texture|textureLod|textureGrad|textureSize|texelFetch|textureOffset|textureLodOffset';
  // Helper parameters declared as sampler2D, scoped to their function.
  code = code.replace(/(\w+\s+\w+\s*\()([^)]*\bsampler2D\b[^)]*)(\)\s*\{)/g, (all, head, params, tail) => {
    const pnames = [];
    const np = params.replace(/\bsampler2D\s+(\w+)/g, (_, p) => { pnames.push(p); return `texture2D ${p}_t, sampler ${p}_s`; });
    return head + np + tail + `/*SAMPLER_PARAMS:${pnames.join(',')}*/`;
  });
  // Inside each such function body, rewrite its parameters' uses.
  code = code.replace(/\/\*SAMPLER_PARAMS:([\w,]*)\*\/([\s\S]*?\n\})/g, (all, list, fnBody) => {
    for (const p of list.split(',').filter(Boolean)) fnBody = useSampler(fnBody, p);
    return fnBody;
  });
  for (const n of samplerNames) code = useSampler(code, n);
  return code;
  function useSampler(c, n) {
    c = c.replace(new RegExp(`\\b(${BUILTIN})\\s*\\(\\s*${n}\\b`, 'g'), `$1(sampler2D(${n}_t, ${n}_s)`);
    // Remaining uses are arguments to helpers (but not the already-rewritten sampler2D(n_t, n_s)).
    return c.replace(new RegExp(`(?<![\\w.])${n}(?![\\w_])(?!_[ts])`, 'g'), (m, off, str) => {
      const before = str.slice(Math.max(0, off - 12), off);
      if (/sampler2D\($/.test(before)) return m;
      return `${n}_t, ${n}_s`;
    });
  }
}

export function convert(vsSrc, fsSrc, { points = false } = {}) {
  const V = parseStage(vsSrc), F = parseStage(fsSrc);
  // Shared uniform block: VS uniforms, then any the FS adds.
  const uniforms = [];
  const seen = new Map();
  for (const u of [...V.decls.uniforms, ...F.decls.uniforms]) {
    const prev = seen.get(u.name);
    if (prev) { if (prev.type !== u.type || prev.count !== u.count) throw new Error('uniform type mismatch: ' + u.name); continue; }
    if (!TYPES.has(u.type)) throw new Error('uniform type not handled: ' + u.type + ' ' + u.name);
    seen.set(u.name, u); uniforms.push(u);
  }
  uniforms.push({ name: 'uGPUViewport', type: 'vec2', count: 0 }, { name: 'uGPUFlip', type: 'float', count: 0 }, { name: 'uGPUTargetH', type: 'float', count: 0 });
  const samplers = [];
  for (const s of [...V.decls.samplers, ...F.decls.samplers]) if (!samplers.includes(s.name)) samplers.push(s.name);
  const block = 'layout(set = 0, binding = 0, std140) uniform GPUU {\n' +
    uniforms.map((u) => `  ${u.type} ${u.name}${u.count ? `[${u.count}]` : ''};`).join('\n') + '\n};\n' +
    samplers.map((s, i) => `layout(set = 0, binding = ${1 + 2 * i}) uniform texture2D ${s}_t;\nlayout(set = 0, binding = ${2 + 2 * i}) uniform sampler ${s}_s;`).join('\n') + '\n';
  // Varyings: VS outputs in order; the FS reads them by name.
  const loc = new Map();
  const vOuts = V.decls.outs.filter((o) => !o.name.startsWith('gl_'));
  vOuts.forEach((o, i) => loc.set(o.name, i));
  if (points) loc.set('vGPUPc', vOuts.length);
  const vary = (d, q) => {
    if (!loc.has(d.name)) throw new Error(`varying ${d.name} is read by the fragment stage but not written by the vertex stage`);
    return `layout(location = ${loc.get(d.name)}) ${d.flat ? 'flat ' : ''}${q} ${d.type} ${d.name};`;
  };
  let vsBody = V.body, fsBody = F.body;
  // Point sprites.
  if (points) {
    vsBody = vsBody.replace(/\bgl_PointSize\b/g, 'gpPointSize').replace(/\bgl_VertexID\b/g, 'gl_InstanceIndex');
    fsBody = fsBody.replace(/\bgl_PointCoord\b/g, 'vGPUPc');
  } else vsBody = vsBody.replace(/\bgl_VertexID\b/g, 'gl_VertexIndex');
  vsBody = vsBody.replace(/\bgl_InstanceID\b/g, 'gl_InstanceIndex');
  vsBody = rewriteSamplers(vsBody, samplers);
  fsBody = rewriteSamplers(fsBody, samplers);
  // gl_FragCoord counts rows from the bottom in WebGL and from the top in WebGPU. Render targets are
  // drawn upside down, so there the two agree; on the screen, count from the bottom of the target.
  if (/\bgl_FragCoord\b/.test(fsBody)) fsBody = 'vec4 gpFragCoord() { return vec4(gl_FragCoord.x, uGPUFlip < 0.0 ? gl_FragCoord.y : uGPUTargetH - gl_FragCoord.y, gl_FragCoord.zw); }\n' +
    fsBody.replace(/\bgl_FragCoord\b/g, 'gpFragCoord()');
  // Wrap main.
  const wrapV = (b) => b.replace(/\bvoid\s+main\s*\(\s*(void)?\s*\)/, 'void gpuMain()') + `
void main() {
  gpuMain();${points ? `
  vec2 cq = vec2(float(gl_VertexIndex & 1), float((gl_VertexIndex >> 1) & 1)) * 2.0 - 1.0;
  gl_Position.xy += cq * gpPointSize / uGPUViewport * gl_Position.w;
  vGPUPc = vec2(cq.x * 0.5 + 0.5, 0.5 - cq.y * 0.5);` : ''}
  gl_Position.y *= uGPUFlip;
  gl_Position.z = (gl_Position.z + gl_Position.w) * 0.5;
}
`;
  const vs = '#version 450\n' + block +
    V.decls.ins.map((d) => { if (!/location/.test(d.layout)) throw new Error('vertex input without a location: ' + d.name); return `layout(${d.layout}) in ${d.type} ${d.name};`; }).join('\n') + '\n' +
    vOuts.map((d) => vary(d, 'out')).join('\n') + '\n' +
    (points ? `layout(location = ${loc.get('vGPUPc')}) out vec2 vGPUPc;\nfloat gpPointSize = 1.0;\n` : '') +
    wrapV(vsBody);
  const fOuts = F.decls.outs;
  const fs = '#version 450\n' + block +
    F.decls.ins.map((d) => vary(d, 'in')).join('\n') + '\n' +
    (points ? `layout(location = ${loc.get('vGPUPc')}) in vec2 vGPUPc;\n` : '') +
    fOuts.map((d, i) => `layout(location = ${i}) out ${d.type} ${d.name};`).join('\n') + '\n' +
    fsBody;
  return { vs, fs, uniforms, samplers, attributes: V.decls.ins.map((d) => ({ name: d.name, type: d.type, location: +(d.layout.match(/location\s*=\s*(\d+)/) || [])[1] })) };
}

// std140 layout of the shared block: offset, size and array stride of each member (bytes).
const BASE = { float: [4, 4], int: [4, 4], uint: [4, 4], bool: [4, 4], vec2: [8, 8], ivec2: [8, 8], vec3: [12, 16], ivec3: [12, 16], vec4: [16, 16], ivec4: [16, 16], mat2: [32, 16], mat3: [48, 16], mat4: [64, 16] };
export function std140(uniforms) {
  let off = 0;
  const out = [];
  for (const u of uniforms) {
    let [size, align] = BASE[u.type];
    let stride = 0;
    if (u.count) { align = 16; stride = Math.ceil(size / 16) * 16; size = stride * u.count; }
    off = Math.ceil(off / align) * align;
    out.push({ name: u.name, type: u.type, count: u.count, offset: off, stride });
    off += size;
  }
  return { members: out, size: Math.ceil(off / 16) * 16 };
}

// FNV-1a hash of a program's two sources: the runtime looks its translation up by it.
export function programKey(vs, fs) {
  let h = 0x811c9dc5;
  const s = vs + '\u0000' + fs;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}
