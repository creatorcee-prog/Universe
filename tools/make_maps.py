# Builds assets/maps from 2048x1024 equirectangular source maps (Solar System Scope / NASA, CC BY 4.0).
# Usage: python3 tools/make_maps.py <source-dir> ; the sources are named <body>.jpg in that directory
# (mercury, venus, venus-clouds, mars, jupiter, saturn, uranus, neptune, earth-day, earth-night,
# earth-clouds, sun, moon, and eso0932a.jpg for the Milky Way), plus earth-relief.png (the land/relief map decoded from NASA's
# hypsometric map, the previous assets/maps/earth.png). Writes assets/maps/*.jpg and assets/maps/earth.png, and prints the
# cloud-map statistics that js/render3d.js uses (CLOUD_STATS).
import sys, os
import numpy as np
from PIL import Image, ImageFilter

SRC = sys.argv[1]
OUT = 'assets/maps'

def load(name, size=(2048, 1024)):
    im = Image.open(os.path.join(SRC, name + '.jpg')).convert('RGB')
    if im.size != size: im = im.resize(size, Image.LANCZOS)
    return np.asarray(im).astype(float) / 255

def lat_of(H):
    return 90 - (np.arange(H) + 0.5) / H * 180

def finish(a, poles=84.0):
    """Feather the 180° wrap and blend the smeared last rows at the poles into their zonal mean."""
    a = a.copy()
    H, W = a.shape[:2]
    k = max(8, W // 128)
    edge = (a[:, :1] + a[:, -1:]) / 2
    for i in range(k):
        t = (1 - i / k) ** 2
        a[:, i] = a[:, i] * (1 - t) + edge[:, 0] * t
        a[:, -1 - i] = a[:, -1 - i] * (1 - t) + edge[:, 0] * t
    lat = lat_of(H)
    w = np.clip((np.abs(lat) - poles) / (89.5 - poles), 0, 1); w = w * w * (3 - 2 * w)
    zm = a.mean(1, keepdims=True)
    shape = (-1,) + (1,) * (a.ndim - 1)
    return a * (1 - w.reshape(shape)) + zm * w.reshape(shape)

def lum(a):
    return a @ np.array([0.3, 0.55, 0.15])

def save(a, name, q=88, size=None):
    im = Image.fromarray((np.clip(a, 0, 1) * 255).round().astype('uint8'))
    if size: im = im.resize(size, Image.LANCZOS)
    im.save(os.path.join(OUT, name + '.jpg'), quality=q)
    print(name, im.size, os.path.getsize(os.path.join(OUT, name + '.jpg')) // 1024, 'KB')

def gray_rel(a, name, **kw):
    """Brightness relative to the map's mean, stored as 0.5 = mean (modes 3 and 7)."""
    g = lum(a); g = np.clip(g / g.mean() * 0.5, 0, 1)
    save(finish(g), name, **kw)

def recolour(a, target, contrast=1.0):
    """Per-channel gains to a target mean colour, contrast about the mean scaled."""
    m = a.reshape(-1, 3).mean(0)
    return np.array(target) * (1 + contrast * (a / m - 1))

# Grey worlds: brightness only, tinted in the shader with each world's own colours.
save(finish(load('mercury')), 'mercury')
save(finish(load('moon')), 'moon')
gray_rel(load('venus'), 'venus')             # Magellan radar (false orange): roughness, not colour
gray_rel(load('venus-clouds'), 'venus-clouds', size=(1024, 512))
gray_rel(load('sun'), 'sun', size=(1024, 512))

# Colour maps, used as supplied. Neptune alone is recoloured: its source keeps the Voyager contrast
# stretch, and the real planet is pale blue (Irwin et al. 2024).
save(finish(load('mars')), 'mars')
save(finish(load('jupiter')), 'jupiter')
save(finish(load('saturn')), 'saturn')
save(finish(load('uranus')), 'uranus', size=(1024, 512))
save(finish(recolour(load('neptune'), [0.42, 0.62, 0.90], 0.6)), 'neptune', size=(1024, 512))

# Earth: the day map's colours, and a new land / sea / mountain / ice map from it (full 360°).
day = load('earth-day')
save(day, 'earth-day', q=86)
H, W = 512, 1024
d = np.asarray(Image.fromarray((day * 255).astype('uint8')).resize((W, H), Image.LANCZOS)).astype(float) / 255
hsv = np.asarray(Image.fromarray((d * 255).astype('uint8')).convert('HSV')).astype(float) / 255
sea = (hsv[..., 0] * 360 > 190) & (hsv[..., 0] * 360 < 250) & (hsv[..., 1] > 0.35) & (d[..., 2] > d[..., 0] + 0.12)
old = np.asarray(Image.open(os.path.join(SRC, 'earth-relief.png')).convert('RGBA').resize((W, H), Image.BILINEAR)).astype(float) / 255
# White polar areas are land only where the relief map has land too (sea ice is not land).
white0 = (lum(d) > 0.6) & (hsv[..., 1] < 0.25)
land = ((~sea) & ~(white0 & (old[..., 0] < 0.5) & (np.abs(lat_of(H))[:, None] > 55))).astype(float)
Lb = np.asarray(Image.fromarray((land * 255).astype('uint8')).filter(ImageFilter.GaussianBlur(1.0))).astype(float) / 255
depth = np.clip((0.5 - old[..., 0]) * 2, 0.04, 1)     # keep the shelves decoded from the relief map
# Coast field: 0.5 at the shore, ramping over ~1.5° inland (the shader roughens the coastline by about
# that much, so the ramp must be wider than one pixel).
Lw = np.asarray(Image.fromarray((land * 255).astype('uint8')).filter(ImageFilter.GaussianBlur(4.0))).astype(float) / 255
R = np.where(Lb >= 0.5, 0.52 + 0.48 * np.clip((Lw - 0.5) * 2.2, 0, 1), np.minimum(np.minimum(Lb, Lw), 0.5 - 0.5 * depth))
G = old[..., 1] * (Lb >= 0.5)
white = (lum(d) > 0.72) & (hsv[..., 1] < 0.18)
lat = lat_of(H)[:, None]
B = (white & (Lb >= 0.5) & (np.abs(lat) > 58)).astype(float)
B = np.asarray(Image.fromarray((B * 255).astype('uint8')).filter(ImageFilter.GaussianBlur(1.0))).astype(float) / 255
G = np.where(B > 0.5, np.minimum(G, 0.35), G)
Image.fromarray((np.stack([R, G, B, np.ones_like(R)], -1).clip(0, 1) * 255).round().astype('uint8'), 'RGBA').save(os.path.join(OUT, 'earth.png'), optimize=True)
print('earth.png land fraction', round(float((Lb >= 0.5).mean()), 3))

# City lights only: warm points, minus the bluish moonlit ground.
n = load('earth-night')
L = np.clip((lum(n) - 1.4 * np.maximum(0, n[..., 2] - n[..., 0]) - 0.06) / 0.5, 0, 1)
save(L, 'earth-night', q=90)

# Clouds: a real cloud field that the generated weather samples (turned and sheared), not a fixed layer.
c = lum(load('earth-clouds'))
save(c, 'earth-clouds')
print('CLOUD_STATS mean %.4f std %.4f' % (c.mean(), c.std()))

# Milky Way: ESO's all-sky panorama (eso0932a, S. Brunier; CC BY 4.0), galactic coordinates, north up.
# Point stars are removed (a median filter), so only the glow, dust lanes, nebulae and the Magellanic
# Clouds remain; the app draws its own sharp stars over it.
mw = Image.open(os.path.join(SRC, 'eso0932a.jpg')).convert('RGB')
mw = mw.filter(ImageFilter.MedianFilter(5)).resize((4096, 2048), Image.LANCZOS)
mw.save(os.path.join(OUT, 'milkyway.jpg'), quality=90)
print('milkyway', mw.size, os.path.getsize(os.path.join(OUT, 'milkyway.jpg')) // 1024, 'KB')
