// The real star sky: the ~9,100 stars of the Yale Bright Star Catalogue (all the eye can see, to magnitude
// ~6.5), packed by tools/make_stars.py into assets/maps/stars.png in the app's world frame (ecliptic J2000).
// starCatalog() starts loading it and returns it once loaded: { n, dir (x, y, z per star), mag (V), bv
// (B-V colour index) }, brightest first; null until then.
let cat = null, loading = false;

export function starCatalog() {
  if (cat || loading || typeof Image === 'undefined') return cat;
  loading = true;
  const im = new Image();
  im.onload = () => {
    const c = document.createElement('canvas');
    c.width = im.width; c.height = im.height;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(im, 0, 0);
    const px = g.getImageData(0, 0, im.width, im.height).data;
    const total = Math.floor((im.width * im.height) / 2);
    const dir = new Float32Array(total * 3), mag = new Float32Array(total), bv = new Float32Array(total);
    let n = 0;
    for (let i = 0; i < total; i++) {
      const a = i * 8, b = a + 4;   // two RGBA pixels per star (their alpha is always 255)
      const m = px[b + 1] / 25 - 2;
      if (px[b + 1] === 0 && px[a] === 0 && px[a + 1] === 0) continue;   // (the padding after the last star)
      const lon = ((px[a] * 256 + px[a + 1]) / 65535) * 2 * Math.PI;
      const lat = ((px[a + 2] * 256 + px[b]) / 65535 - 0.5) * Math.PI;
      dir[n * 3] = Math.cos(lat) * Math.cos(lon); dir[n * 3 + 1] = Math.sin(lat); dir[n * 3 + 2] = Math.cos(lat) * Math.sin(lon);
      mag[n] = m; bv[n] = px[b + 2] / 100 - 0.5;
      n++;
    }
    cat = { n, dir, mag, bv };
  };
  const inline = window.__MAPS__ && window.__MAPS__.stars;
  im.src = inline || 'assets/maps/stars.png';
  return null;
}

// A star's surface temperature from its B-V colour index (Ballesteros 2012, EPL 97, 34008).
export function bvToTemp(bv) {
  const b = Math.max(-0.4, Math.min(2.0, bv));
  return 4600 * (1 / (0.92 * b + 1.7) + 1 / (0.92 * b + 0.62));
}

// The galactic north pole and centre in the world frame (J2000; tools/make_stars.py): the Milky Way panorama
// is laid out by them, and longitude 90° lies along north × centre.
export const GAL_N = [-0.867666, 0.497147, 0.000352];
export const GAL_C = [-0.054875, -0.096477, 0.993821];
