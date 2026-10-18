# Builds assets/maps/shape-<name>.png for bodies known only as triaxial ellipsoids, in the format of
# tools/make_shapes.py (r / r_eq x 16384, 16-bit across R and G, 256x128, body-fixed, north up).
#   Haumea: semi-axes 1161 x 852 x 513 km (Ortiz et al. 2017, Nature 550, 219, from a stellar occultation)
import os
import numpy as np
from PIL import Image

W, H = 256, 128

def ellipsoid(name, a, b, c):
    lon = ((np.arange(W) + 0.5) / W - 0.5) * 2 * np.pi
    lat = (0.5 - (np.arange(H) + 0.5) / H) * np.pi
    lo, la = np.meshgrid(lon, lat)
    x, y, z = np.cos(la) * np.cos(lo), np.cos(la) * np.sin(lo), np.sin(la)
    r = 1 / np.sqrt((x / a) ** 2 + (y / b) ** 2 + (z / c) ** 2)
    r /= (a * b * c) ** (1 / 3)
    v = np.clip(np.round(r * 16384), 0, 65535).astype(np.uint16)
    Image.fromarray(np.stack([v >> 8, v & 255, np.zeros_like(v)], -1).astype(np.uint8), 'RGB').save(os.path.join('assets/maps', 'shape-' + name + '.png'), optimize=True)
    print(name, 'r/r_eq %.2f..%.2f' % (r.min(), r.max()))

ellipsoid('haumea', 1161, 852, 513)
