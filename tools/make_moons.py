# Builds js/moons.js: every named moon of the planets, from
#   elem.html   JPL SSD "Planetary Satellite Mean Elements" (ssd.jpl.nasa.gov/sats/elem/): a, e, ω, M, i, node,
#               the reference frame (ecliptic, the local Laplace plane, or the planet's equator) and the
#               Laplace plane's tilt from the planet's pole
#   phys.html   JPL SSD "Planetary Satellite Physical Parameters" (ssd.jpl.nasa.gov/sats/phys_par/): GM, radius
#   List_of_natural_satellites.wiki   Wikipedia's list (raw wikitext), for the mean radius of small moons
#               JPL gives no physical data for (mostly Sheppard's discovery estimates at albedo 0.04)
# Masses of moons without a measured GM come from their radius at 1.5 g/cm³.
# Usage: python3 tools/make_moons.py <source-dir>
import sys, os, re, html, json, unicodedata

SRC = sys.argv[1]
G = 6.6743e-20  # km³ kg⁻¹ s⁻²

def cells(r):
    return [re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', c))).strip() for c in re.findall(r'<t[hd][^>]*>(.*?)</t[hd]>', r, re.S)]

s = open(os.path.join(SRC, 'elem.html')).read()
i = s.find('<table id="sat_elem"')
rows = [cells(r) for r in re.findall(r'<tr[^>]*>(.*?)</tr>', s[i:s.find('</table>', i)], re.S)][1:]
s = open(os.path.join(SRC, 'phys.html')).read()
phys = {}
for r in (cells(r) for r in re.findall(r'<tr[^>]*>(.*?)</tr>', s, re.S)):
    if len(r) >= 6 and r[2].isdigit():
        num = lambda c: float(c.split()[0]) if c and re.match(r'[\d.]', c) else 0.0
        phys[(r[0], r[1])] = (num(r[3]), num(r[4]))

def norm(n):
    n = re.sub(r'<!--.*?-->', '', n).replace('Æ', 'Ae').replace('æ', 'ae').replace('ʻ', '').replace("'", '')
    return ''.join(c for c in unicodedata.normalize('NFD', n) if unicodedata.category(c) != 'Mn').strip().lower()

def clean(c):
    c = re.sub(r'<ref[^>]*/>', '', c); c = re.sub(r'<ref.*?</ref>', '', c, flags=re.S)
    m = re.search(r'\{\{(?:sort|val)\|([^|}]*)\|?([^}]*)\}\}', c)
    if m: c = m.group(2) if c.startswith('{{sort') else m.group(1)
    c = re.sub(r'\{\{[^}]*\}\}', '', c); c = re.sub(r'\[\[(?:[^|\]]*\|)?([^\]]*)\]\]', r'\1', c)
    return c.strip()

wiki = {}
w = open(os.path.join(SRC, 'List_of_natural_satellites.wiki')).read()
for r in w[w.find('! style="width:10%;" | Name'):].split('\n|-')[1:]:
    cs = []
    for l in r.split('\n'):
        if l.startswith('|') and not l.startswith('|-') and not l.startswith('|}'):
            cs += [clean(re.sub(r'^\s*style="[^"]*"\s*\|', '', c)) for c in l[1:].split('||')]
    if len(cs) >= 9:
        try: wiki[norm(cs[0])] = float(cs[5].replace(',', '').lstrip('<~').strip())
        except ValueError: pass

FIX = {'Magaclite': 'Megaclite', 'Philophrosyn': 'Philophrosyne'}
seen, out = set(), []
for r in rows:
    planet, name, frame = r[1], FIX.get(r[2], r[2]), r[5]
    if re.match(r'^S/?\d{4}', name) or planet == 'Earth' or (planet, name) in seen: continue
    seen.add((planet, name))
    a, e, w_, M, inc, node = (float(x) for x in r[7:13])
    tilt = float(r[18]) if r[18] else 0.0
    gm, rad = phys.get((planet, r[2]), (0.0, 0.0))
    if rad <= 0:
        rad = wiki.get(norm(name))
        if rad is None: raise SystemExit('no radius for ' + name)
    if gm <= 0: gm = G * 1500e9 * 4 / 3 * 3.14159265 * rad ** 3
    f = {'ecliptic': 'E', 'Laplace': 'L', 'equatorial': 'Q'}[frame]
    out.append([planet, name, round(a), e, inc, node, w_, M, f, tilt, float('%.6g' % gm), float('%.4g' % rad)])

with open('js/moons.js', 'w') as fo:
    fo.write('// Every named moon of the planets (built by tools/make_moons.py from JPL SSD satellite mean elements and\n')
    fo.write('// physical parameters, with radii of the small moons from Wikipedia\'s list of natural satellites).\n')
    fo.write('// [planet, name, a (km), e, i, node, ω, M (deg), frame, Laplace-plane tilt from the planet\'s pole (deg),\n')
    fo.write('//  GM (km³/s²), mean radius (km)]. Frames: E ecliptic, L local Laplace plane, Q the planet\'s equator.\n')
    fo.write('export const MOONS = [\n')
    for m in out: fo.write('  ' + json.dumps(m, ensure_ascii=False) + ',\n')
    fo.write('];\n')
print(len(out), 'moons')
