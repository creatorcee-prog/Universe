# Builds assets/maps/shape-<name>.png: the shape of a small body as its surface's distance from the
# centre of mass in every direction (256x128 equirectangular, body-fixed: 0° longitude at the centre,
# east to the right, north up), relative to the volume-equivalent radius, as 16-bit (ratio x 16384)
# split across R (high byte) and G (low byte). js/render3d.js displaces the body's sphere by it.
# Where a ray from the centre crosses the surface more than once (67P's neck), the outermost hit is kept.
# Usage: python3 tools/make_shapes.py <source-dir>, with the models from:
#   Phobos   NAIF generic_kernels/dsk/satellites/phobos_2014_09_22.bds (Ernst et al.), SPICE DSK type 2
#   Deimos   NAIF MEX/kernels/dsk/DEIMOS_K005_THO_V02.OBJ (Thomas)
#   67P      PDS SBN ro-c-multi-5-67p-shape-v2.0, spc_esa mtp019 cshp_dv_130_01_lores_obj.obj
#   Eros, Itokawa, Vesta  NAIF generic_kernels/dsk/asteroids (NEAR MSI 64q, Hayabusa AMICA 64q, Gaskell 256)
#   Ryugu    JAXA DARTS, data.darts.isas.jaxa.jp/pub/hayabusa2/paper/Watanabe_2019/SHAPE_SFM_49k_v20180804.obj
#            (Watanabe et al. 2019, Science 364, 268)
#   Lutetia, Steins  NAIF generic_kernels/dsk/asteroids/{lutetia,steins}/a_old_versions,
#            ro-a-osinac_osiwac-5-lutetia-shape-v1_0_006k.bds, ...-steins-shape-v1_0_20k.bds (Rosetta OSIRIS)
#   Arrokoth two flattened ellipsoids, just touching, with the lobe sizes of Spencer et al. 2020 (Science 367,
#            eaay3999): Wenu 20.6 x 19.9 x 9.4 km, Weeyo 15.4 x 13.8 x 9.8 km (its shape model is on PDS SBN)
#   other asteroids  NASA 3D Resources (github.com/nasa/NASA-3D-Resources, "3D Printing"): STL models
#   (that repository's Eros, Itokawa and Vesta files are flat relief tiles for printing, not whole shapes)
import sys, os, struct
import numpy as np
from PIL import Image

SRC = sys.argv[1]
OUT = 'assets/maps'
W, H = 256, 128

def read_stl(p):
    b = open(p, 'rb').read()
    if b[:5] == b'solid' and b.find(b'facet') > 0 and b.count(b'\n') > 10:
        v = [list(map(float, l.split()[1:4])) for l in b.decode('latin1').splitlines() if l.strip().startswith('vertex')]
        tri = np.array(v).reshape(-1, 3, 3)
    else:
        n = struct.unpack('<I', b[80:84])[0]
        rec = np.frombuffer(b[84:84 + n * 50], dtype=np.dtype([('n', '<3f4'), ('v', '<9f4'), ('a', '<u2')]))
        tri = rec['v'].reshape(-1, 3, 3).astype(float)
    return tri

def read_obj(p):
    V, F = [], []
    for l in open(p, errors='ignore'):
        s = l.split()
        if not s: continue
        if s[0] == 'v': V.append([float(x) for x in s[1:4]])
        elif s[0] == 'f': F.append([int(x.split('/')[0]) - 1 for x in s[1:4]])
    return np.array(V)[np.array(F)]

def read_dsk(p):
    """SPICE DSK (DAS file) with one type-2 segment: vertices and plates."""
    b = open(p, 'rb').read()
    nresvr, nresvc, ncomr, ncomc = struct.unpack('<4i', b[68:84])
    d = np.frombuffer(b[(1 + nresvr + ncomr) * 1024:][:1024], dtype='<i4')
    start = (2 + nresvr + ncomr) * 1024
    ndp, nint = d[9], d[10]                   # record counts: double cluster, then integer cluster
    dp = np.frombuffer(b[start:start + ndp * 1024], dtype='<f8')
    it = np.frombuffer(b[start + ndp * 1024:start + (ndp + nint) * 1024], dtype='<i4')
    ibase, dbase = it[5], it[7]
    nv, npl = it[ibase], it[ibase + 1]
    V = dp[dbase + 34:dbase + 34 + 3 * nv].reshape(nv, 3)
    F = it[ibase + 10:ibase + 10 + 3 * npl].reshape(npl, 3) - 1
    return V[F]

def radial_map(tri):
    # Centre of mass and volume of the closed mesh (signed tetrahedra from the origin).
    a, b, c = tri[:, 0], tri[:, 1], tri[:, 2]
    vol = np.einsum('ij,ij->i', a, np.cross(b, c)) / 6
    com = (vol[:, None] * (a + b + c) / 4).sum(0) / vol.sum()
    req = (3 * abs(vol.sum()) / (4 * np.pi)) ** (1 / 3)
    tri = (tri - com) / req
    # Sample each triangle densely enough to cover the grid, keep the largest radius per cell.
    ang = np.max(np.linalg.norm(tri - tri.mean(1, keepdims=True), axis=2), axis=1) / np.maximum(np.linalg.norm(tri.mean(1), axis=1), 1e-3)
    k = int(np.clip(np.ceil(np.percentile(ang, 95) / (np.pi / H) * 2), 1, 12))
    us, vs = np.meshgrid(np.arange(k + 1), np.arange(k + 1)); m = us + vs <= k
    bary = np.stack([us[m], vs[m], k - us[m] - vs[m]], 1) / k
    best = np.zeros(W * H)
    for i in range(0, len(tri), 20000):
        t = tri[i:i + 20000]
        pts = np.einsum('bk,tkj->tbj', bary, t).reshape(-1, 3)
        x, y, z = pts.T                         # body-fixed: x to 0° longitude, z north
        r = np.sqrt(x * x + y * y + z * z)
        lon = np.arctan2(y, x); lat = np.arcsin(np.clip(z / np.maximum(r, 1e-9), -1, 1))
        col = np.clip(((lon / (2 * np.pi) + 0.5) * W).astype(int), 0, W - 1)
        row = np.clip(((0.5 - lat / np.pi) * H).astype(int), 0, H - 1)
        np.maximum.at(best, row * W + col, r)
    best = best.reshape(H, W)
    # Fill any empty cells from their neighbours.
    for _ in range(50):
        z = best == 0
        if not z.any(): break
        acc = np.zeros_like(best); n = np.zeros_like(best)
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            s = np.roll(np.roll(best, dy, 0), dx, 1); ok = s > 0; acc[ok] += s[ok]; n[ok] += 1
        best[z & (n > 0)] = acc[z & (n > 0)] / n[z & (n > 0)]
    return best, req

def save(best, name, req):
    v = np.clip(np.round(best * 16384), 0, 65535).astype(np.uint16)
    Image.fromarray(np.stack([v >> 8, v & 255, np.zeros_like(v)], -1).astype(np.uint8), 'RGB').save(os.path.join(OUT, 'shape-' + name + '.png'), optimize=True)
    print('%-10s r_eq %8.3f  r/r_eq %.2f..%.2f' % (name, req, best.min(), best.max()))

S = lambda f: os.path.join(SRC, f)
# Only the models present in <source-dir> are (re)built.
def have(f): return os.path.exists(S(f))
for name, f, rd in [('ryugu', 'ryugu.obj', read_obj), ('lutetia', 'lutetia.bds', read_dsk), ('steins', 'steins.bds', read_dsk)]:
    if have(f):
        best, req = radial_map(rd(S(f)))
        save(best, name, req)

def ellipsoid(c, ax, n=96):
    u, v = np.meshgrid(np.linspace(0, 2 * np.pi, 2 * n + 1), np.linspace(0, np.pi, n + 1))
    P = np.stack([np.cos(u) * np.sin(v), np.sin(u) * np.sin(v), np.cos(v)], -1) * np.array(ax) + np.array(c)
    a, b, cc, d = P[:-1, :-1], P[:-1, 1:], P[1:, :-1], P[1:, 1:]
    t = np.concatenate([np.stack([a, cc, b], -2).reshape(-1, 3, 3), np.stack([b, cc, d], -2).reshape(-1, 3, 3)])
    return t[np.linalg.norm(np.cross(t[:, 1] - t[:, 0], t[:, 2] - t[:, 0]), axis=1) > 1e-12]
if 'arrokoth' in sys.argv[2:]:
    # The union's surface seen from its centre of mass: the outermost of the two lobes' surfaces each way.
    big, small = (10.3, 9.95, 4.7), (7.7, 6.9, 4.9)
    tri = np.concatenate([ellipsoid((-7.7, 0, 0), big), ellipsoid((10.3, 0, 0), small)])
    best, req = radial_map(tri)
    save(best, 'arrokoth', req)

for name, tri in [] if not have('phobos.bds') else [('phobos', read_dsk(S('phobos.bds'))), ('deimos', read_obj(S('deimos.obj'))), ('67p', read_obj(S('67p.obj'))),
                  ('eros', read_dsk(S('eros.bds'))), ('itokawa', read_dsk(S('itokawa.bds'))), ('vesta', read_dsk(S('vesta.bds')))]:
    best, req = radial_map(tri)
    save(best, name, req)
for name, f in [] if not have('Asteroid 101955 Bennu.stl') else [('bennu', 'Asteroid 101955 Bennu.stl'), ('kleopatra', 'Asteroid 216 Kleopatra.stl'), ('geographos', 'Asteroid 1620 Geographos.stl'),
                ('toutatis', 'Asteroid 4179 Toutatis.stl'), ('mithra', 'Asteroid 4486 Mithra.stl'), ('golevka', 'Asteroid 6489 Golevka.stl'),
                ('hw1', 'Asteroid 8567 1996 HW1.stl')]:
    best, req = radial_map(read_stl(S(f)))
    save(best, name, req)
