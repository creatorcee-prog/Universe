// Compressed close-up maps (tools/make_maps_8k.py): 8192 x 4096, Basis Universal ETC1S in KTX2, cut into
// 4 x 2 tiles of 2048 x 2048 (the wasm encoder takes ~12.6 Mpix at most). File: 'PUK2', then u32 cols, rows,
// width, height, then one u32 byte length per tile (rows top first), then the KTX2 files.
// A worker transcodes them (js/vendor/basis_transcoder.*, from three.js; Basis Universal, Apache 2.0) to a
// format this GPU samples directly, ETC2 (the exact ETC1 blocks, 4 bits a texel) or BC7, ASTC or BC1, and the
// renderer fits the tiles back into one texture, level by level down to 4 x 4 a tile. So a map that would take
// ~170 MB as RGBA with mipmaps takes ~22-45 MB, and none of it if the GPU has no such format (then the
// 4096 x 2048 JPEG stays).

// Preferred first: [WebGL extension, constant name, transcoder format (BASIS transcoder_texture_format)].
const TARGETS = [
  ['WEBGL_compressed_texture_etc', 'COMPRESSED_RGB8_ETC2', 0],
  ['EXT_texture_compression_bptc', 'COMPRESSED_RGBA_BPTC_UNORM_EXT', 6],
  ['WEBGL_compressed_texture_astc', 'COMPRESSED_RGBA_ASTC_4x4_KHR', 10],
  ['WEBGL_compressed_texture_s3tc', 'COMPRESSED_RGB_S3TC_DXT1_EXT', 2],
];

const WORKER = `
let M;
onmessage = async ({ data: { url, base, tf } }) => {
  try {
    if (!M) M = (async () => {
      importScripts(base + 'basis_transcoder.js');
      const wasmBinary = await (await fetch(base + 'basis_transcoder.wasm')).arrayBuffer();
      const m = await BASIS({ wasmBinary });
      m.initializeBasis();
      return m;
    })();
    const m = await M;
    const res = await fetch(url);
    if (!res.ok) throw new Error(res.status + ' ' + url);
    const buf = new Uint8Array(await res.arrayBuffer()), dv = new DataView(buf.buffer);
    if (String.fromCharCode(...buf.subarray(0, 4)) !== 'PUK2') throw new Error('not a tiled map');
    const cols = dv.getUint32(4, true), rows = dv.getUint32(8, true), W = dv.getUint32(12, true), H = dv.getUint32(16, true);
    const TW = W / cols, TH = H / rows, nLev = Math.log2(Math.min(TW, TH)) - 1;
    const levels = [], moved = [];
    for (let l = 0; l < nLev; l++) levels.push({ w: W >> l, h: H >> l, tiles: [] });
    let off = 20 + 4 * cols * rows;
    for (let i = 0; i < cols * rows; i++) {
      const len = dv.getUint32(20 + 4 * i, true), k = new m.KTX2File(buf.subarray(off, off + len));
      off += len;
      try {
        if (!k.isValid() || k.getLevels() < nLev || !k.startTranscoding()) throw new Error('bad tile ' + i);
        for (let l = 0; l < nLev; l++) {
          const d = new Uint8Array(k.getImageTranscodedSizeInBytes(l, 0, 0, tf));
          if (!k.transcodeImage(d, l, 0, 0, tf, 0, -1, -1)) throw new Error('transcode failed');
          levels[l].tiles.push({ x: (i % cols) * (TW >> l), y: Math.floor(i / cols) * (TH >> l), w: TW >> l, h: TH >> l, data: d });
          moved.push(d.buffer);
        }
      } finally { k.close(); k.delete(); }
    }
    postMessage({ url, W, H, levels }, moved);
  } catch (e) { postMessage({ url, error: String(e && e.message || e) }); }
};`;

let worker = null, broken = false;
const maps = new Map();   // file -> { state: 'loading' | 'ready' | 'failed', W, H, levels }

// The compressed format to use on this context, or null (none, or no texture this large).
const fmtCache = new WeakMap();
export function ktxFormat(gl) {
  if (fmtCache.has(gl)) return fmtCache.get(gl);
  let f = null;
  if ((gl.getParameter(gl.MAX_TEXTURE_SIZE) || 0) >= 8192) {
    for (const [ext, name, tf] of TARGETS) {
      const e = gl.getExtension(ext);
      if (e && e[name]) { f = { gl: e[name], tf, name }; break; }
    }
  }
  fmtCache.set(gl, f);
  return f;
}

// The map `file` (assets/maps/<file>.bin) transcoded for gl, or null while it loads (or if it cannot).
export function ktxMap(file, gl) {
  const f = ktxFormat(gl);
  if (!f || broken || typeof Worker === 'undefined') return null;
  let e = maps.get(file);
  if (!e) {
    e = { state: 'loading', tf: f.tf };
    maps.set(file, e);
    try {
      if (!worker) {
        worker = new Worker(URL.createObjectURL(new Blob([WORKER], { type: 'text/javascript' })));
        worker.onmessage = ({ data }) => {
          const m = [...maps.values()].find((x) => x.url === data.url);
          if (!m) return;
          if (data.error) { m.state = 'failed'; console.warn('Close-up map:', data.error); return; }
          Object.assign(m, { state: 'ready', W: data.W, H: data.H, levels: data.levels });
        };
        worker.onerror = (ev) => { broken = true; console.warn('Close-up map worker:', ev.message); };
      }
      // (the artifact build names them .bin.wasm, a type its host serves: tools/build-single.mjs)
      e.url = new URL(`assets/maps/${file}${(typeof window !== 'undefined' && window.__KTX_EXT__) || '.bin'}`, location.href).href;
      worker.postMessage({ url: e.url, base: new URL('js/vendor/', location.href).href, tf: f.tf });
    } catch (err) { e.state = 'failed'; console.warn('Close-up map:', err); }
  }
  return e.state === 'ready' ? e : null;
}

// Fill the texture bound to TEXTURE_2D from a ready map. The transcoded data is then let go (the file stays
// in the browser's cache, so loading it again is quick).
export function uploadKtx(gl, e) {
  const f = ktxFormat(gl);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, e.levels.length - 1);
  e.levels.forEach((L, l) => {
    gl.compressedTexImage2D(gl.TEXTURE_2D, l, f.gl, L.w, L.h, 0, emptyLevel(f, L));
    for (const t of L.tiles) gl.compressedTexSubImage2D(gl.TEXTURE_2D, l, t.x, t.y, t.w, t.h, f.gl, t.data);
  });
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const bytes = e.levels.reduce((s, L) => s + L.tiles.reduce((a, t) => a + t.data.byteLength, 0), 0);
  forget(e); e.levels = null;
  return bytes;
}
// (WebGL needs a level defined, with data of its full size, before blocks can be written into it.)
function emptyLevel(f, L) {
  const bpb = f.tf === 0 || f.tf === 2 ? 8 : 16;
  return new Uint8Array(Math.ceil(L.w / 4) * Math.ceil(L.h / 4) * bpb);
}
function forget(e) { for (const [k, v] of maps) if (v === e) maps.delete(k); }
