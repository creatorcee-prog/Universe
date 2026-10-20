// Encodes raw RGBA8 images to KTX2 (Basis Universal ETC1S, sRGB, full mip chain) with the Basis encoder
// compiled to wasm (tools/vendor/basisu, from ktx2-encoder 0.6.0, Apache 2.0 / MIT). Build-time only.
// Usage: node tools/encode_ktx2.mjs <in.rgba> <width> <height> <out.ktx2> [quality 1..255]
import { readFileSync, writeFileSync } from 'fs';
import BASIS from './vendor/basisu/basis_encoder.js';

const [inp, w, h, out, q = '200'] = process.argv.slice(2);
const W = +w, H = +h, rgba = new Uint8Array(readFileSync(inp));
if (rgba.length !== W * H * 4) throw new Error(`expected ${W * H * 4} bytes, got ${rgba.length}`);
const m = await BASIS({ wasmBinary: readFileSync(new URL('./vendor/basisu/basis_encoder.wasm', import.meta.url)) });
m.initializeBasis();
const e = new m.BasisEncoder();
if (process.env.DBG) e.setDebug(true);
e.setCreateKTX2File(true);
e.setUASTC(false);
e.setMipGen(true);
e.setQualityLevel(+q);
(e.setETC1SCompressionLevel || e.setCompressionLevel).call(e, +(process.env.EFFORT || 2));
(e.setKTX2AndBasisSRGBTransferFunc || e.setKTX2SRGBTransferFunc).call(e, true);
e.setPerceptual(true);
if (!e.setSliceSourceImage(0, rgba, W, H, 0)) throw new Error('setSliceSourceImage failed');
const buf = new Uint8Array(Math.max(W * H, 1 << 20));
const n = e.encode(buf);
if (!n) throw new Error('encode failed');
writeFileSync(out, buf.subarray(0, n));
e.delete();
console.log(out, (n / 1048576).toFixed(2), 'MB');
