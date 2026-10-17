"""Draws the app icon (a star with an orbiting planet) at the sizes iOS and the web manifest need."""
import math
import sys
from PIL import Image, ImageDraw, ImageFilter

def icon(size):
    s = size * 4  # supersample
    img = Image.new('RGB', (s, s), (4, 6, 13))
    d = ImageDraw.Draw(img)
    # Faint background stars.
    import random
    random.seed(7)
    for _ in range(90):
        x, y = random.random() * s, random.random() * s
        r = random.random() * s * 0.004 + s * 0.001
        c = int(120 + random.random() * 100)
        d.ellipse([x - r, y - r, x + r, y + r], fill=(c, c, min(255, c + 30)))
    glow = Image.new('RGB', (s, s), (0, 0, 0))
    g = ImageDraw.Draw(glow)
    cx, cy = s * 0.5, s * 0.5
    for k in range(40, 0, -1):
        r = s * 0.012 * k
        a = int(255 * (1 - k / 40) ** 2.2)
        g.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(a, int(a * 0.72), int(a * 0.36)))
    glow = glow.filter(ImageFilter.GaussianBlur(s * 0.02))
    img = Image.composite(img, img, Image.new('L', (s, s), 255))
    img = Image.blend(img, glow, 0.0)
    from PIL import ImageChops
    img = ImageChops.add(img, glow)
    d = ImageDraw.Draw(img)
    # Orbit ellipse.
    bbox = [s * 0.12, s * 0.36, s * 0.88, s * 0.64]
    orbit = Image.new('L', (s, s), 0)
    od = ImageDraw.Draw(orbit)
    od.ellipse(bbox, outline=255, width=int(s * 0.012))
    orbit = orbit.rotate(24, center=(cx, cy), resample=Image.BICUBIC)
    img.paste((255, 184, 92), mask=orbit.point(lambda v: int(v * 0.8)))
    # Star core.
    r = s * 0.1
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(255, 238, 210))
    # Planet on the orbit.
    t = math.radians(-35)
    a, b = s * 0.38, s * 0.14
    px, py = a * math.cos(t), b * math.sin(t)
    rot = math.radians(-24)
    X = cx + px * math.cos(rot) - py * math.sin(rot)
    Y = cy + px * math.sin(rot) + py * math.cos(rot)
    pr = s * 0.055
    d.ellipse([X - pr, Y - pr, X + pr, Y + pr], fill=(70, 124, 222))
    d.pieslice([X - pr, Y - pr, X + pr, Y + pr], 120, 300, fill=(24, 40, 80))
    return img.resize((size, size), Image.LANCZOS)

out = sys.argv[1] if len(sys.argv) > 1 else 'icons'
for n in (180, 192, 512):
    icon(n).save(f'{out}/icon-{n}.png', optimize=True)
