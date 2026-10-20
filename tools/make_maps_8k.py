# 8192 x 4096 maps of the worlds one flies closest to (Moon, Mars, Mercury, Earth), as compressed GPU textures
# (KTX2 / Basis Universal ETC1S), swapped in while one of them fills the screen (js/render3d.js HI_MAPS).
# Sources: Solar System Scope 8k maps (from NASA data, CC BY 4.0), with the treatment of tools/make_maps_4k.py
# (the 180° wrap feathered, the poles blended); Earth's colours matched channel by channel to the shipped
# earth-day.jpg (Blue Marble), so the swap does not change its look.
# The wasm Basis encoder takes at most ~12.6 Mpix per call, so each map is cut into 4 x 2 tiles of 2048 x 2048,
# encoded one by one and stored together (format in js/ktx.js); the page fits them back into one texture.
# Usage: python3 tools/make_maps_8k.py <dir with 8k_moon.jpg, 8k_mars.jpg, 8k_mercury.jpg, 8k_earth_daymap.jpg>
import sys, os, struct, subprocess, tempfile
from concurrent.futures import ThreadPoolExecutor
import numpy as np
from PIL import Image
Image.MAX_IMAGE_PIXELS = None
SRC, OUT, W, H, T = sys.argv[1], 'assets/maps', 8192, 4096, 2048
_src = open(os.path.join(os.path.dirname(__file__), 'make_maps_4k.py')).read()
exec(_src[_src.index('def finish'):_src.index('\nfor n in')])  # finish(), shared with the 4k maps

def match(a, ref):
    # per-channel quantile mapping of a onto ref
    out = np.empty_like(a)
    q = np.linspace(0, 1, 1025)
    for c in range(3):
        out[..., c] = np.interp(a[..., c], np.quantile(a[::4, ::4, c], q), np.quantile(ref[..., c], q))
    return out

def encode(job):
    raw, out = job
    subprocess.run(['node', 'tools/encode_ktx2.mjs', raw, str(T), str(T), out, '255'], check=True, stdout=subprocess.DEVNULL)
    return out

tmp = tempfile.mkdtemp()
for n, f in [('moon', '8k_moon'), ('mars', '8k_mars'), ('mercury', '8k_mercury'), ('earth-day', '8k_earth_daymap')]:
    im = Image.open(os.path.join(SRC, f + '.jpg')).convert('RGB')
    if im.size != (W, H): im = im.resize((W, H), Image.LANCZOS)
    a = np.asarray(im).astype(np.float32) / 255
    if n == 'earth-day':
        a = match(a, np.asarray(Image.open(os.path.join(OUT, 'earth-day.jpg')).convert('RGB')).astype(np.float32) / 255)
    else:
        a = finish(a)
    a = (a.clip(0, 1) * 255).round().astype('uint8')
    jobs = []
    for ty in range(H // T):
        for tx in range(W // T):
            t = np.concatenate([a[ty * T:(ty + 1) * T, tx * T:(tx + 1) * T], np.full((T, T, 1), 255, 'uint8')], 2)
            raw = os.path.join(tmp, f'{n}-{ty}{tx}.rgba'); t.tofile(raw)
            jobs.append((raw, raw[:-5] + '.ktx2'))
    with ThreadPoolExecutor(4) as ex: outs = list(ex.map(encode, jobs))
    blobs = [open(o, 'rb').read() for o in outs]
    path = os.path.join(OUT, n + '-8k.bin')
    with open(path, 'wb') as fo:
        fo.write(b'PUK2' + struct.pack('<4I', W // T, H // T, W, H) + struct.pack(f'<{len(blobs)}I', *map(len, blobs)))
        for b in blobs: fo.write(b)
    print(n, os.path.getsize(path) // 1024, 'KB', flush=True)
