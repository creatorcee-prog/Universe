# Builds assets/maps/<body>-height.png: real elevation, 1440x720 equirectangular (0° longitude at the centre,
# east to the right), as 16-bit metres + 32768 split across R (high byte) and G (low byte), lossless.
# js/render3d.js decodes it into a half-float texture (~8 m precision at 10 km).
# Usage: python3 tools/make_heights.py <source-dir>, with:
#   ldem_4.tif                  Moon, LRO LOLA (NASA SVS CGI Moon Kit), km, 1440x720, 0° at the centre
#   megt90n000cb.img            Mars, MGS MOLA MEGDR 4 px/deg (PDS), big-endian int16 m, 0°E at the left
#   venus_topo.tif              Venus, Magellan global topography 4641 m (USGS), int16 m (no-data -32768)
#   merc_dem_1024.jpg           Mercury, MESSENGER global DEM 665 m browse (USGS), 8-bit stretched,
#                               0°E at the left; range -5380..+4480 m (Becker et al. 2016)
import sys, os
import numpy as np
from PIL import Image, ImageFile
ImageFile.LOAD_TRUNCATED_IMAGES = True
SRC = sys.argv[1]
OUT = 'assets/maps'
W, H = 1440, 720

def resize(a, size=(W, H)):
    return np.asarray(Image.fromarray(a.astype('float32'), 'F').resize(size, Image.BOX)).astype(float)

def fill_nodata(a):
    """Fill NaN by repeatedly averaging valid neighbours (Magellan has small gaps)."""
    a = a.copy()
    for _ in range(200):
        bad = np.isnan(a)
        if not bad.any(): break
        s = np.zeros_like(a); n = np.zeros_like(a)
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            b = np.roll(np.roll(a, dy, 0), dx, 1)
            ok = ~np.isnan(b); s[ok] += b[ok]; n[ok] += 1
        fix = bad & (n > 0); a[fix] = s[fix] / n[fix]
    return np.nan_to_num(a, nan=0.0)

def save(h, name):
    h = h - np.median(h)                       # relative to the typical surface level
    v = np.clip(np.round(h) + 32768, 0, 65535).astype(np.uint16)
    rgb = np.stack([v >> 8, v & 255, np.zeros_like(v)], -1).astype(np.uint8)
    p = os.path.join(OUT, name + '-height.png')
    Image.fromarray(rgb, 'RGB').save(p, optimize=True)
    print(name, 'min %.0f max %.0f m' % (h.min(), h.max()), os.path.getsize(p) // 1024, 'KB')

moon = np.asarray(Image.open(os.path.join(SRC, 'ldem_4.tif'))).astype(float) * 1000
save(resize(moon), 'moon')

mars = np.fromfile(os.path.join(SRC, 'megt90n000cb.img'), dtype='>i2').reshape(720, 1440).astype(float)
save(np.roll(resize(mars), W // 2, axis=1), 'mars')

raw = np.fromfile(os.path.join(SRC, 'venus_topo.tif'), dtype=np.uint8)
off = raw.size - 8192 * 4096 * 2           # header first, then the raw strips: the data is the tail
v = np.frombuffer(raw[off:off + 8192 * 4096 * 2].tobytes(), dtype='<i2').reshape(4096, 8192).astype(float)
v[v < -30000] = np.nan
v = resize(fill_nodata(resize(v, (2880, 1440))))
save(v, 'venus')

m = np.asarray(Image.open(os.path.join(SRC, 'merc_dem_1024.jpg')).convert('L')).astype(float) / 255
m = -5380 + m * (4480 + 5380)
save(np.roll(resize(m), W // 2, axis=1), 'mercury')
