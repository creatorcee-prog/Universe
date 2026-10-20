"""Real star sky: the Yale Bright Star Catalogue, 5th revised edition (Hoffleit & Warren 1991; CDS catalogue
V/50, public domain): the ~9,100 stars down to magnitude ~6.5, all those the eye can see.

Each star's J2000 position goes from equatorial to ecliptic coordinates (obliquity 23.4392911°) and then to
the app's world frame (x the vernal equinox, y ecliptic north, z = -ecliptic y: presets.js kepler), so the
stars stand where they really are relative to the planets. Packed into assets/maps/stars.png, two RGB pixels
per star (no alpha, so nothing is premultiplied): direction as longitude and latitude in 16 bits each,
V magnitude and B-V colour index in 8 bits each:
  pixel 1: R, G = longitude (0..65535 over 0..2π), B = latitude high byte
  pixel 2: R = latitude low byte (latitude 0..65535 over -π/2..π/2), G = (V + 2) * 25, B = (B-V + 0.5) * 100
Also prints the galactic north pole and centre in the world frame (for the Milky Way panorama).
Usage: python3 tools/make_stars.py   (reads tools/data/bsc5-catalog.gz)
"""
import gzip, math, struct, zlib

EPS = math.radians(23.4392911)

def eq_to_world(ra, dec):
    x, y, z = math.cos(dec) * math.cos(ra), math.cos(dec) * math.sin(ra), math.sin(dec)
    xe, ye, ze = x, y * math.cos(EPS) + z * math.sin(EPS), -y * math.sin(EPS) + z * math.cos(EPS)
    return (xe, ze, -ye)

stars = []
for line in gzip.open('tools/data/bsc5-catalog.gz', 'rt', encoding='latin-1'):
    try:
        rah, ram, ras = int(line[75:77]), int(line[77:79]), float(line[79:83])
        sgn = -1 if line[83] == '-' else 1
        ded, dem, des = int(line[84:86]), int(line[86:88]), int(line[88:90])
        v = float(line[102:107])
    except ValueError:
        continue          # (a few entries are novae or non-stellar objects with no position or magnitude)
    bvs = line[109:114].strip()
    bv = float(bvs) if bvs else 0.6
    ra = math.radians((rah + ram / 60 + ras / 3600) * 15)
    dec = math.radians(sgn * (ded + dem / 60 + des / 3600))
    stars.append((eq_to_world(ra, dec), v, bv))

stars.sort(key=lambda s: s[1])     # brightest first
W = 128
rows = (len(stars) * 2 + W - 1) // W
px = bytearray(W * rows * 3)
for i, ((x, y, z), v, bv) in enumerate(stars):
    lon = math.atan2(z, x) % (2 * math.pi)
    lat = math.asin(max(-1, min(1, y)))
    L = min(65535, round(lon / (2 * math.pi) * 65535))
    B = min(65535, round((lat / math.pi + 0.5) * 65535))
    o = i * 6
    px[o:o + 6] = bytes([L >> 8, L & 255, B >> 8, B & 255, max(0, min(255, round((v + 2) * 25))), max(0, min(255, round((bv + 0.5) * 100)))])

def png(w, h, data):
    raw = b''.join(b'\0' + bytes(data[y * w * 3:(y + 1) * w * 3]) for y in range(h))
    chunk = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')

open('assets/maps/stars.png', 'wb').write(png(W, rows, px))
print(len(stars), 'stars,', W, 'x', rows, 'px; brightest', stars[0][1], 'faintest', stars[-1][1])
# Galactic frame (J2000: north pole RA 192.85948°, Dec 27.12825°; centre RA 266.40500°, Dec -28.93617°).
gn = eq_to_world(math.radians(192.85948), math.radians(27.12825))
gc = eq_to_world(math.radians(266.40500), math.radians(-28.93617))
l90 = eq_to_world(math.radians(318.0042), math.radians(48.3297))   # galactic longitude 90°, latitude 0
cr = (gn[1] * gc[2] - gn[2] * gc[1], gn[2] * gc[0] - gn[0] * gc[2], gn[0] * gc[1] - gn[1] * gc[0])
print('galN', [round(c, 6) for c in gn], 'galC', [round(c, 6) for c in gc], 'dot', round(sum(a * b for a, b in zip(gn, gc)), 6))
print('cross(N, C) . l90 =', round(sum(a * b for a, b in zip(cr, l90)), 4), '(+1: N x C points to l = 90)')
