// Satellite models for js/satmodels.js, from NASA's 3D Resources (https://science.nasa.gov/3d-resources/, public
// domain): the .glb files (Draco-compressed meshes, decoded with Google's Draco glTF decoder, tools/vendor/draco,
// Apache 2.0), every node's transform applied, each part coloured by its material's base colour, then simplified
// by vertex clustering to about MAX_TRIS triangles and stored quantised (positions int16, colours 8-bit sRGB).
// The page shades them flat (one normal per triangle, from screen-space derivatives), so no normals are kept.
// Usage: node tools/make_sat_models.cjs <dir with iss.glb hubble.glb jwst.glb landsat8.glb terra.glb chandra.glb>
// Sources (2026-10-20): International Space Station (ISS) (A), Hubble Space Telescope (B), James Webb Space
// Telescope (A), Landsat 8, Terra, Chandra X-ray Observatory, Voyager 3D Model, Parker Solar Probe, Lunar Reconnaissance
// Orbiter (A), Juno (A), Pioneer 10.
const fs = require('fs'), path = require('path');
const createDecoder = require('./vendor/draco/draco_decoder_gltf_nodejs.cjs');

const MAX_TRIS = 9000;
// name -> real longest dimension (m): ISS truss 109 m; Hubble 13.2 m long; Webb's sunshield 21.2 m; Chandra 19.5 m
// across its solar arrays; Terra 6.8 m long with its array ~11 m; Landsat 8 ~9.8 m with its array deployed.
// Voyager 13 m across its magnetometer boom; Parker Solar Probe 3 m tall; LRO ~4 m with its array; Juno 20 m across its
// three arrays; Pioneer 10 2.7 m dish, 6.6 m with its RTG booms.
const MODELS = { iss: 109, hubble: 13.2, jwst: 21.2, landsat8: 9.8, terra: 11, chandra: 19.5, voyager: 13, parker: 3, lro: 4, pioneer: 6.6 };

const srgb = (c) => Math.round(255 * Math.min(1, c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055));
// Materials known only by a texture: a colour by name.
function guessColor(name = '') {
  const n = name.toLowerCase();
  if (/gold|bronze|kapton|mli/.test(n)) return [0.55, 0.38, 0.09];
  if (/silver|foil|alum|metal/.test(n)) return [0.6, 0.6, 0.63];
  if (/solar|panel|cell/.test(n)) return [0.03, 0.04, 0.25];
  if (/black|dark/.test(n)) return [0.05, 0.05, 0.05];
  return [0.55, 0.55, 0.55];
}

function mat4mul(a, b) {
  const o = new Array(16).fill(0);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) o[j * 4 + i] += a[k * 4 + i] * b[j * 4 + k];
  return o;
}
function nodeMatrix(n) {
  if (n.matrix) return n.matrix;
  const [tx, ty, tz] = n.translation || [0, 0, 0], [x, y, z, w] = n.rotation || [0, 0, 0, 1], [sx, sy, sz] = n.scale || [1, 1, 1];
  return [(1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0, tx, ty, tz, 1];
}

(async () => {
  const D = await createDecoder({ wasmBinary: fs.readFileSync(path.join(__dirname, 'vendor/draco/draco_decoder_gltf.wasm')) });
  const dir = process.argv[2], out = {};
  for (const [name, size] of Object.entries(MODELS)) {
    const buf = fs.readFileSync(path.join(dir, name + '.glb'));
    const jl = buf.readUInt32LE(12), j = JSON.parse(buf.slice(20, 20 + jl).toString());
    const binStart = 20 + jl + 8, bin = buf.slice(binStart);
    const view = (bv) => { const v = j.bufferViews[bv]; return bin.slice(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength); };
    const accessor = (ai) => {
      const a = j.accessors[ai], v = j.bufferViews[a.bufferView], comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
      const T = { 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array, 5121: Uint8Array }[a.componentType];
      const off = (v.byteOffset || 0) + (a.byteOffset || 0), stride = v.byteStride || comps * T.BYTES_PER_ELEMENT, o = new Float64Array(a.count * comps);
      for (let i = 0; i < a.count; i++) for (let c = 0; c < comps; c++) {
        const p = off + i * stride + c * T.BYTES_PER_ELEMENT;
        o[i * comps + c] = T === Float32Array ? bin.readFloatLE(p) : T === Uint32Array ? bin.readUInt32LE(p) : T === Uint16Array ? bin.readUInt16LE(p) : bin.readUInt8(p);
      }
      return o;
    };
    const P = [], C = [], I = [];
    const prim = (pr, M) => {
      let pos, idx;
      const dr = pr.extensions && pr.extensions.KHR_draco_mesh_compression;
      if (dr) {
        const dec = new D.Decoder(), db = new D.DecoderBuffer(), data = view(dr.bufferView);
        db.Init(new Int8Array(data.buffer, data.byteOffset, data.byteLength), data.byteLength);
        const mesh = new D.Mesh();
        if (!dec.DecodeBufferToMesh(db, mesh).ok()) throw new Error(name + ': draco decode failed');
        const att = dec.GetAttributeByUniqueId(mesh, dr.attributes.POSITION), np = mesh.num_points();
        const fa = new D.DracoFloat32Array(); dec.GetAttributeFloatForAllPoints(mesh, att, fa);
        pos = new Float64Array(np * 3); for (let i = 0; i < np * 3; i++) pos[i] = fa.GetValue(i);
        const nf = mesh.num_faces(), ia = new D.DracoInt32Array(); idx = new Uint32Array(nf * 3);
        for (let f = 0; f < nf; f++) { dec.GetFaceFromMesh(mesh, f, ia); idx[f * 3] = ia.GetValue(0); idx[f * 3 + 1] = ia.GetValue(1); idx[f * 3 + 2] = ia.GetValue(2); }
        D.destroy(fa); D.destroy(ia); D.destroy(mesh); D.destroy(db); D.destroy(dec);
      } else {
        pos = accessor(pr.attributes.POSITION);
        idx = pr.indices !== undefined ? accessor(pr.indices) : Uint32Array.from({ length: pos.length / 3 }, (_, i) => i);
      }
      if ((pr.mode ?? 4) !== 4) return;
      const m = j.materials && j.materials[pr.material], pbr = (m && m.pbrMetallicRoughness) || {};
      const col = pbr.baseColorFactor ? pbr.baseColorFactor.slice(0, 3) : guessColor(m && m.name);
      const c8 = col.map(srgb), base = P.length / 3;
      for (let i = 0; i < pos.length; i += 3) {
        const x = pos[i], y = pos[i + 1], z = pos[i + 2];
        P.push(M[0] * x + M[4] * y + M[8] * z + M[12], M[1] * x + M[5] * y + M[9] * z + M[13], M[2] * x + M[6] * y + M[10] * z + M[14]);
        C.push(...c8);
      }
      for (const k of idx) I.push(base + k);
    };
    const walk = (ni, parent) => {
      const n = j.nodes[ni], M = mat4mul(parent, nodeMatrix(n));
      if (n.mesh !== undefined) for (const pr of j.meshes[n.mesh].primitives) prim(pr, M);
      for (const c of n.children || []) walk(c, M);
    };
    const I4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    for (const r of j.scenes[j.scene || 0].nodes) walk(r, I4);
    // Bounds, then vertex clustering at the finest grid that stays within MAX_TRIS.
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < P.length; i += 3) for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], P[i + c]); hi[c] = Math.max(hi[c], P[i + c]); }
    const ext = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]), mid = lo.map((v, c) => (v + hi[c]) / 2);
    const cluster = (G) => {
      const cell = ext / G, key = new Map(), sum = [], cnt = [], csum = [], vmap = new Int32Array(P.length / 3);
      for (let i = 0; i < P.length / 3; i++) {
        const k = Math.floor((P[i * 3] - lo[0]) / cell) + ',' + Math.floor((P[i * 3 + 1] - lo[1]) / cell) + ',' + Math.floor((P[i * 3 + 2] - lo[2]) / cell);
        let v = key.get(k);
        if (v === undefined) { v = cnt.length; key.set(k, v); cnt.push(0); sum.push(0, 0, 0); csum.push(0, 0, 0); }
        vmap[i] = v; cnt[v]++;
        for (let c = 0; c < 3; c++) { sum[v * 3 + c] += P[i * 3 + c]; csum[v * 3 + c] += C[i * 3 + c]; }
      }
      const tris = new Set(), T = [];
      for (let t = 0; t < I.length; t += 3) {
        const a = vmap[I[t]], b = vmap[I[t + 1]], c = vmap[I[t + 2]];
        if (a === b || b === c || a === c) continue;
        const s = [a, b, c].sort((x, y) => x - y).join(',');
        if (tris.has(s)) continue;
        tris.add(s); T.push(a, b, c);
      }
      return { n: cnt.length, P: sum.map((v, i) => v / cnt[Math.floor(i / 3)]), C: csum.map((v, i) => Math.round(v / cnt[Math.floor(i / 3)])), T };
    };
    let G = 400, r = cluster(G);
    while (r.T.length / 3 > MAX_TRIS && G > 16) { G = Math.floor(G * 0.85); r = cluster(G); }
    if (r.n > 65535) throw new Error(name + ': too many vertices');
    const q = new Int16Array(r.n * 3);
    for (let i = 0; i < r.n * 3; i++) q[i] = Math.round(((r.P[i] - mid[i % 3]) / (ext / 2)) * 32767);
    out[name] = { size, n: r.n, pos: Buffer.from(q.buffer).toString('base64'), col: Buffer.from(Uint8Array.from(r.C)).toString('base64'), idx: Buffer.from(Uint16Array.from(r.T).buffer).toString('base64') };
    console.log(name, 'source', I.length / 3, 'tris ->', r.T.length / 3, 'tris,', r.n, 'verts, grid', G);
  }
  const js = `// Generated by tools/make_sat_models.cjs from NASA's 3D Resources (public domain). Each model: real longest\n// dimension (m), vertex count, and base64 arrays: positions (int16, x/y/z scaled to ±half the size), colours (sRGB\n// bytes), triangles (uint16).\nexport const SAT_MODELS = ${JSON.stringify(out)};\n`;
  fs.writeFileSync(path.join(__dirname, '..', 'js', 'satmodels.js'), js);
  console.log('js/satmodels.js', Math.round(js.length / 1024), 'KB');
})();
