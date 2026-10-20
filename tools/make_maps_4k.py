# 4096 x 2048 maps of the rocky worlds one flies close to (Moon, Mars, Mercury), loaded only while one of them
# is large on screen (js/render3d.js HI_MAPS). Same sources and treatment as tools/make_maps.py (Solar System
# Scope 8k maps, from NASA data, CC BY 4.0; the 180° wrap feathered and the poles blended), at twice the size.
# Usage: python3 tools/make_maps_4k.py <dir with moon.jpg, mars.jpg, mercury.jpg>
import sys, os
import numpy as np
from PIL import Image

SRC, OUT, SIZE = sys.argv[1], 'assets/maps', (4096, 2048)

def finish(a, poles=84.0):
    a = a.copy()
    H, W = a.shape[:2]
    k = max(8, W // 128)
    edge = (a[:, :1] + a[:, -1:]) / 2
    for i in range(k):
        t = (1 - i / k) ** 2
        a[:, i] = a[:, i] * (1 - t) + edge[:, 0] * t
        a[:, -1 - i] = a[:, -1 - i] * (1 - t) + edge[:, 0] * t
    lat = 90 - (np.arange(H) + 0.5) / H * 180
    w = np.clip((np.abs(lat) - poles) / (89.5 - poles), 0, 1); w = w * w * (3 - 2 * w)
    zm = a.mean(1, keepdims=True)
    return a * (1 - w[:, None, None]) + zm * w[:, None, None]

for n in ['moon', 'mars', 'mercury']:
    im = Image.open(os.path.join(SRC, n + '.jpg')).convert('RGB').resize(SIZE, Image.LANCZOS)
    a = finish(np.asarray(im).astype(np.float32) / 255)
    Image.fromarray((a.clip(0, 1) * 255).round().astype('uint8')).save(os.path.join(OUT, n + '-4k.jpg'), quality=86, optimize=True)
    print(n, os.path.getsize(os.path.join(OUT, n + '-4k.jpg')) // 1024, 'KB')
