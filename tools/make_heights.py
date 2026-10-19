# Builds assets/maps/<body>-height.png: real elevation, 1440x720 equirectangular (0° longitude at the centre,
# east to the right), as 16-bit metres + 32768 split across R (high byte) and G (low byte), lossless.
# js/render3d.js decodes it into a half-float texture (~8 m precision at 10 km).
# Usage: python3 tools/make_heights.py <source-dir>, with:
#   ldem_4.tif                  Moon, LRO LOLA (NASA SVS CGI Moon Kit), km, 1440x720, 0° at the centre
#   megt90n000cb.img            Mars, MGS MOLA MEGDR 4 px/deg (PDS), big-endian int16 m, 0°E at the left
#   venus_topo.tif              Venus, Magellan global topography 4641 m (USGS), int16 m (no-data -32768)
#   etopo5.npy                  Earth, NOAA ETOPO 2022 surface (ice-top) elevation, every 5th 1' point
#                               (fetched by OPeNDAP: .../ETOPO_2022_v1_60s_N90W180_surface.nc.dods?
#                               z.z[0:5:10799][0:5:21599]), m, south at row 0, -180° at the left
#   merc_dem_1024.jpg           Mercury, MESSENGER global DEM 665 m browse (USGS), 8-bit stretched,
#                               0°E at the left; range -5380..+4480 m (Becker et al. 2016)
#   pluto.tif, charon.tif       New Horizons global DEMs, 300 m/px (Schenk et al. 2018, Icarus 314, 400; USGS
#                               Pluto/Charon_NewHorizons_Global_DEM_300m_Jul2017_16bit.tif), int16 m, -32768
#                               where unmapped (~54%: the hemispheres seen only from afar). Pluto 0°E at the
#                               left, Charon at the centre. The gaps get the Moon's relief, scaled to the
#                               mapped part's spread and feathered in: plausible, not measured.
# Only the sources present in <source-dir> are (re)built.
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

def save(h, name, sea_level=False):
    if not sea_level: h = h - np.median(h)    # relative to the typical surface level (Earth: to the sea)
    v = np.clip(np.round(h) + 32768, 0, 65535).astype(np.uint16)
    rgb = np.stack([v >> 8, v & 255, np.zeros_like(v)], -1).astype(np.uint8)
    p = os.path.join(OUT, name + '-height.png')
    Image.fromarray(rgb, 'RGB').save(p, optimize=True)
    print(name, 'min %.0f max %.0f m' % (h.min(), h.max()), os.path.getsize(p) // 1024, 'KB')

have = lambda f: os.path.exists(os.path.join(SRC, f))
if have('ldem_4.tif'):
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

    save(resize(np.load(os.path.join(SRC, 'etopo5.npy'))[::-1].astype(float)), 'earth', sea_level=True)

    m = np.asarray(Image.open(os.path.join(SRC, 'merc_dem_1024.jpg')).convert('L')).astype(float) / 255
    m = -5380 + m * (4480 + 5380)
    save(np.roll(resize(m), W // 2, axis=1), 'mercury')

def blur(a, n):
    """Box blur, n passes of 3x3 (wrapping in longitude, clamped at the poles)."""
    for _ in range(n):
        p = np.pad(a, ((1, 1), (0, 0)), mode='edge')
        a = sum(np.roll(p, dx, 1)[1 + dy:p.shape[0] - 1 + dy] for dy in (-1, 0, 1) for dx in (-1, 0, 1)) / 9
    return a

def new_horizons(f, w, h, name, centred):
    path = os.path.join(SRC, f)
    a = np.memmap(path, dtype='<i2', mode='r', offset=os.path.getsize(path) - w * h * 2, shape=(h, w))
    # Mean of the mapped pixels in each output cell.
    rows = (np.arange(h) * H // h); cols = (np.arange(w) * W // w)
    tot = np.zeros((H, W)); cnt = np.zeros((H, W))
    for r0 in range(0, h, 512):
        blk = np.asarray(a[r0:r0 + 512]).astype(float)
        ok = blk > -32000
        rr = np.repeat(rows[r0:r0 + 512][:, None], w, 1)
        cc = np.repeat(cols[None, :], blk.shape[0], 0)
        np.add.at(tot, (rr[ok], cc[ok]), blk[ok])
        np.add.at(cnt, (rr[ok], cc[ok]), 1)
    real = np.where(cnt > 0, tot / np.maximum(cnt, 1), np.nan)
    if not centred: real = np.roll(real, W // 2, axis=1)
    mapped = cnt > 0
    if not centred: mapped = np.roll(mapped, W // 2, axis=1)
    # The Moon's relief (already built) where nothing was mapped, matched to the mapped part's level and spread.
    mp = np.asarray(Image.open(os.path.join(OUT, 'moon-height.png')).convert('RGB')).astype(float)
    moonh = mp[..., 0] * 256 + mp[..., 1] - 32768
    rv = real[mapped]
    fill = (moonh - moonh.mean()) / moonh.std() * rv.std() + np.median(rv)
    fill = np.clip(fill, np.percentile(rv, 1), np.percentile(rv, 99))   # (the Moon's deep basins would overshoot)
    wgt = blur(mapped.astype(float), 12)                  # feather ~12 px (~3°) into the real data
    out = np.where(mapped, real, wgt * fill_nodata(np.where(mapped, real, np.nan)) + (1 - wgt) * fill)
    print(name, 'mapped %.0f%%' % (mapped.mean() * 100))
    save(out, name)

if have('pluto.tif'): new_horizons('pluto.tif', 24888, 12444, 'pluto', False)
if have('charon.tif'): new_horizons('charon.tif', 12693, 6347, 'charon', True)
