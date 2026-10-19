// GLSL for the Realistic view (WebGL2). Every surface is procedural: noise sampled on the body's own
// rotating sphere, then coloured by physical state (temperature per point, impacts, tides) each frame.

const HEAD = `#version 300 es
precision highp float;
precision highp int;
`;

// Logarithmic depth: lets one depth buffer cover centimetres to kiloparsecs. Depth is log2(1 + K·w)
// with w in AU and K = 1e12 (one unit ≈ 15 cm): without K, 1 + w rounds to exactly 1 in 32-bit floats for
// anything closer than ~15 km, so the ground around a standing observer would all share one depth.
const LOGDEPTH_V = `out float vFragDepth;`;
const DEPTH_K = '1e12';
const LOGDEPTH_F = `in float vFragDepth; uniform float uLogDepthFC;`;
const WRITE_DEPTH = `gl_FragDepth = log2(vFragDepth) * uLogDepthFC * 0.5;`;

const NOISE = `
float hash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float vnoise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float fbm(vec3 p, int oct) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 7; i++) {
    if (i >= oct) break;
    s += a * vnoise(p);
    p = p * 2.03 + vec3(1.7, 9.2, 3.1);
    a *= 0.5;
  }
  return s;
}
float crater(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  float d = 8.0;
  for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec3 g = vec3(float(x), float(y), float(z));
    vec3 o = vec3(hash(i + g), hash(i + g + 19.1), hash(i + g + 47.7));
    vec3 r = g + o - f;
    d = min(d, dot(r, r) * (0.6 + hash(i + g + 7.3)));
  }
  return sqrt(d);
}
`;

// False colour for the other bands (Settings, Light seen). Infrared: an "inferno" scale of brightness
// temperature (black, purple, red, orange, yellow, white; 40 K to 2,000 K on a log scale, Earth at the middle).
const SPECTRUM = `
uniform int uSpectrum;      // 0 visible, 1 infrared, 2 ultraviolet, 3 X-ray
vec3 inferno(float x) {
  x = clamp(x, 0.0, 1.0);
  vec3 c = mix(vec3(0.0), vec3(0.32, 0.05, 0.45), smoothstep(0.0, 0.25, x));
  c = mix(c, vec3(0.85, 0.2, 0.25), smoothstep(0.2, 0.5, x));
  c = mix(c, vec3(1.0, 0.62, 0.1), smoothstep(0.45, 0.75, x));
  return mix(c, vec3(1.0, 1.0, 0.85), smoothstep(0.75, 1.0, x));
}
float h1n(vec3 v) { return fract(sin(dot(v, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
float irLevel(float T) { return log2(max(T, 40.0) / 40.0) / log2(50.0); }
// For worlds: stretched around room temperature, so polar cold, warm tropics and cold cloud tops separate
// (~200 K black-purple, 290 K orange, ~400 K and hotter yellow-white).
float irWorld(float T) { return clamp(0.52 + 1.15 * log2(max(T, 20.0) / 280.0), 0.0, 1.0); }
vec3 uvTint(float x) { return mix(vec3(0.05, 0.0, 0.18), vec3(0.75, 0.6, 1.0), clamp(x, 0.0, 1.0)); }
vec3 xrayTint(float x) { return mix(vec3(0.0, 0.02, 0.08), vec3(0.55, 0.8, 1.0), clamp(x, 0.0, 1.0)) * (0.6 + 0.6 * clamp(x, 0.0, 1.0)); }
`;


const BLACKBODY = `
// Black-body colour (fit after Tanner Helland), normalised to 0..1.
vec3 blackbody(float t) {
  float k = clamp(t, 1000.0, 40000.0) / 100.0;
  vec3 c;
  if (k <= 66.0) {
    c.r = 255.0;
    c.g = 99.47 * log(k) - 161.12;
    c.b = k <= 19.0 ? 0.0 : 138.52 * log(k - 10.0) - 305.04;
  } else {
    c.r = 329.7 * pow(k - 60.0, -0.1332);
    c.g = 288.12 * pow(k - 60.0, -0.0755);
    c.b = 255.0;
  }
  return clamp(c / 255.0, 0.0, 1.0);
}
`;

// Equirectangular map lookup (east-positive longitude, 0° at the centre). Fragment shaders pick the
// texture derivatives from whichever longitude parametrisation is continuous here, so the wrap at 180°
// does not drop to the smallest mip level (a visible seam line); vertex shaders read the full level.
const MAPTEX_FS = `
vec4 mapTex(sampler2D s, vec3 d) {
  vec2 uv = vec2(atan(-d.z, d.x) / 6.2831853 + 0.5, 0.5 - asin(clamp(d.y, -1.0, 1.0)) / 3.14159265);
  vec2 uv2 = vec2(fract(uv.x + 0.5), uv.y);
  vec2 gx = dFdx(uv), gy = dFdy(uv), gx2 = dFdx(uv2), gy2 = dFdy(uv2);
  if (abs(gx2.x) + abs(gy2.x) < abs(gx.x) + abs(gy.x)) { gx = gx2; gy = gy2; }
  return textureGrad(s, uv, gx, gy);
}
// Donor map (a real world's pattern borrowed by one without a map): brightness relative to its mean,
// looked up in a turned frame.
uniform sampler2D uDonor;
uniform mat3 uDonorRot;
uniform float uDonorK, uDonorMean;
float donorT(vec3 d) { return dot(mapTex(uDonor, uDonorRot * d).rgb, vec3(0.3, 0.55, 0.15)) / uDonorMean; }
// Real elevation: metres (times uHScale) in a half-float texture, looked up in a turned frame.
uniform sampler2D uHMap;
uniform mat3 uHRot;
uniform float uHMapK, uHScale, uHGlobe;
// Earth's day colours (Blue Marble), weighted by uDayK.
uniform sampler2D uDay;
uniform float uDayK;
`;
const MAPTEX_VS = `
vec4 mapTex(sampler2D s, vec3 d) {
  return textureLod(s, vec2(atan(-d.z, d.x) / 6.2831853 + 0.5, 0.5 - asin(clamp(d.y, -1.0, 1.0)) / 3.14159265), 0.0);
}
uniform sampler2D uHMap;
uniform mat3 uHRot;
uniform float uHMapK, uHScale;
`;

export const BODY_VS = HEAD + NOISE + `
layout(location = 0) in vec3 aPos;
uniform mat4 uProj;
uniform mat3 uView;
uniform vec3 uCenter;   // body centre relative to the eye, world axes
uniform mat3 uRot;      // body orientation (axial tilt and spin)
uniform float uRadius;
uniform vec3 uTideDir;  // world axes
uniform float uTide;    // prolate stretch toward the strongest tidal pull
uniform float uLumpy;   // irregular shape for small bodies
uniform sampler2D uShape; // a real shape: radius / volume-equivalent radius per direction (tools/make_shapes.py)
uniform mat3 uShapeRot;
uniform float uShapeK;
float shapeR(vec3 d) {
  vec3 q = uShapeRot * d;
  return textureLod(uShape, vec2(atan(-q.z, q.x) / 6.2831853 + 0.5, 0.5 - asin(clamp(q.y, -1.0, 1.0)) / 3.14159265), 0.0).r;
}
uniform float uSeed;
uniform vec4 uImp[16];   // impact direction (body frame) and strength
uniform vec4 uImpB[16];  // x: angular size
uniform int uImpN;
out vec3 vObj;
out vec3 vViewPos;
out vec3 vN;
` + LOGDEPTH_V + `
void main() {
  vec3 p = aPos;
  float h = 0.0;
  if (uLumpy > 0.0) h += uLumpy * (fbm(p * 1.3 + uSeed, 4) - 0.5) * 2.2;
  // Impact craters dent the surface: a bowl with a raised rim.
  for (int i = 0; i < 16; i++) {
    if (i >= uImpN) break;
    float a = acos(clamp(dot(p, uImp[i].xyz), -1.0, 1.0));
    float w = uImpB[i].x;
    float depth = 0.05 * uImp[i].w * min(w * 3.0, 1.0);
    h -= depth * exp(-a * a / (w * w * 0.5));
    h += depth * 0.45 * exp(-pow((a - w) / (w * 0.35), 2.0));
  }
  p *= 1.0 + h;
  vec3 nObj = aPos;
  if (uShapeK > 0.5) {
    // Real shape: each direction out to the measured surface; the normal from the neighbouring surface
    // points (so it stays smooth across the sphere's triangles).
    p *= shapeR(aPos);
    vec3 t1 = normalize(cross(abs(aPos.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0), aPos)), t2 = cross(aPos, t1);
    float e = 0.012;
    vec3 a1 = normalize(aPos + t1 * e), a2 = normalize(aPos + t2 * e), b1 = normalize(aPos - t1 * e), b2 = normalize(aPos - t2 * e);
    nObj = normalize(cross(a1 * shapeR(a1) - b1 * shapeR(b1), a2 * shapeR(a2) - b2 * shapeR(b2)));
    if (dot(nObj, aPos) < 0.0) nObj = -nObj;
  }
  vec3 wp = uRot * p;
  float s = dot(wp, uTideDir);
  wp = (wp - s * uTideDir) / sqrt(1.0 + uTide) + s * uTideDir * (1.0 + uTide);
  vec3 world = uCenter + wp * uRadius;
  vObj = aPos;
  vViewPos = uView * world;
  vN = uView * (uRot * nObj);
  gl_Position = uProj * vec4(vViewPos, 1.0);
  vFragDepth = 1.0 + gl_Position.w * ` + DEPTH_K + `;
}
`;

// ---------- Clouds ----------
// A cloud layer drawn on its own shell above the ground. The cloud clock (uCloudT, days) follows the
// simulation, capped so fast-forward does not strobe. Winds carry the clouds along latitude circles:
// on Earth-like worlds easterly trades near the equator, westerlies around 45°, polar easterlies; a
// planet-wide deck (Venus, Titan) super-rotates as a whole. Two copies of the field, each carried by
// the wind for one cycle and then replaced by a newly formed one, crossfade, so clouds drift, shear,
// form and dissipate without the shear growing forever.
const CLOUDS = `
uniform float uCloudT;   // days
uniform float uWind;     // angular wind speed at the deck, rad/day (U / R)
uniform float uDeck;     // 1: a planet-wide deck
uniform sampler2D uCloudTex;
uniform float uCloudTexMode; // 1: real cloud field sampled by the weather; 2: the deck's own map
uniform vec2 uCloudStats;    // the cloud field's mean and standard deviation
float windAt(float latD) {
  if (uDeck > 0.5) return cos(radians(latD));
  float a = abs(latD);
  return -0.5 * exp(-latD * latD / 300.0) + exp(-pow((a - 45.0) / 13.0, 2.0)) - 0.3 * smoothstep(62.0, 75.0, a);
}
// Raw cloud noise (about 0.5 mean) for one generation of clouds, 'age' days old.
float cloudRaw(vec3 d, float seed, float age, float gen, int oct) {
  float latD = degrees(asin(clamp(d.y, -1.0, 1.0)));
  float sh = uWind * windAt(latD) * age;
  float c = cos(sh), sn = sin(sh);
  vec3 v = vec3(d.x * c - d.z * sn, d.y, d.x * sn + d.z * c);
  float sd = seed + gen * 7.31;
  vec3 wv = vec3(fbm(v * 2.1 + sd + 1.3, 3), fbm(v * 2.1 + sd + 7.9, 3), fbm(v * 2.1 + sd + 4.4, 3)) - 0.5;
  // Storm systems: the field is twisted into spirals around a few lows (anticlockwise in the north).
  vec3 vS = v;
  float spiral = 0.0;
  for (int k = 0; k < 4; k++) {
    float fk = float(k);
    float clat = (0.6 + 0.35 * hash(vec3(fk, 1.0, sd))) * (mod(fk, 2.0) < 0.5 ? 1.0 : -1.0) * 0.9;
    float clon = 6.2831853 * hash(vec3(fk, 2.0, sd));
    vec3 cc = vec3(cos(clat) * cos(clon), sin(clat), cos(clat) * sin(clon));
    float dd = length(vS - cc);
    float ang = 5.5 * exp(-dd * dd / 0.012) * sign(cc.y) * smoothstep(0.0, 0.3, age / 3.0 + 0.3);
    vS = vS * cos(ang) + cross(cc, vS) * sin(ang) + cc * dot(cc, vS) * (1.0 - cos(ang));
    spiral += exp(-dd * dd / 0.02);
  }
  vec3 cq = vec3(vS.x * 3.2, vS.y * 5.5, vS.z * 3.2) + wv * 1.8 + sd * 1.7;
  float r = fbm(cq, oct) + 0.12 * spiral;
  if (uCloudTexMode > 0.5 && uCloudTexMode < 1.5) {
    // A real cloud field (fronts, cyclones, cloud streets) at a different longitude each generation,
    // carried by the same winds and storms, with generated detail on top.
    float ang = 6.2831853 * hash(vec3(gen, 3.7, seed));
    vec3 vt = normalize(vec3(vS.x * cos(ang) - vS.z * sin(ang), vS.y, vS.x * sin(ang) + vS.z * cos(ang)) + wv * 0.06);
    float rt = 0.5 + (mapTex(uCloudTex, vt).r - uCloudStats.x) / uCloudStats.y * 0.075;
    r = mix(r, rt + 0.035 * (fbm(cq * 2.3 + 4.0, 3) - 0.5), 0.85);
  }
  return r;
}
// x: cloud density 0..1, y: how thick (bright tops). px: the body's size on screen (detail level).
vec2 cloudField(vec3 d, float cover, float seed, float px) {
  if (uDeck > 0.5 && uCloudTexMode > 1.5) {
    // A planet-wide deck with its own map (Venus): solid, its brightness pattern turning with the winds.
    float a0 = uWind * uCloudT;
    vec3 v = vec3(d.x * cos(a0) - d.z * sin(a0), d.y, d.x * sin(a0) + d.z * cos(a0));
    float t = 2.0 * mapTex(uCloudTex, v).r;
    return vec2(1.0, clamp(0.5 + (t - 1.0) * 2.5 + 0.06 * (fbm(v * 24.0, 3) - 0.5), 0.0, 1.0));
  }
  float T = uDeck > 0.5 ? 6.0 : 2.5;
  float ph = uCloudT / T;
  float a = fract(ph), b = fract(ph + 0.5);
  int oct = px > 250.0 ? 6 : px > 60.0 ? 5 : 4;
  float wa = 1.0 - abs(2.0 * a - 1.0), wb = 1.0 - wa;
  float r1 = cloudRaw(d, seed, a * T, floor(ph), oct);
  float r2 = cloudRaw(d, seed, b * T, floor(ph + 0.5) + 0.5, oct);
  // Blend, then restore the contrast that averaging two independent fields takes away.
  float cl = 0.5 + ((r1 - 0.5) * wa + (r2 - 0.5) * wb) / sqrt(wa * wa + wb * wb);
  float lat = abs(d.y);
  float zone = 0.55 + 0.3 * exp(-lat * lat / 0.012) + 0.35 * exp(-pow(lat - 0.78, 2.0) / 0.02) - 0.35 * exp(-pow(lat - 0.45, 2.0) / 0.015);
  if (uDeck > 0.5) zone = 1.0;
  if (uCloudTexMode > 0.5) zone = mix(zone, 1.0, 0.7);   // the real field already has its latitudes
  float thr = 0.5 + (0.5 - clamp(cover * zone * 1.2, 0.0, 1.0)) * 0.34;
  float cloud = smoothstep(thr - 0.04, thr + 0.12, cl);
  // Fair-weather cumulus: fields of small puffy cells over the tropics, carried with the trade winds.
  if (px > 80.0 && uDeck < 0.5) {
    float sh = uWind * windAt(0.0) * uCloudT;
    vec3 v = vec3(d.x * cos(sh) - d.z * sin(sh), d.y, d.x * sin(sh) + d.z * cos(sh));
    float cellC = crater(v * 160.0 + seed + floor(uCloudT / 1.5) * 3.7);
    float cum = (1.0 - smoothstep(0.05, 0.42, cellC)) * smoothstep(0.56, 0.7, fbm(v * 9.0 + seed + 2.0, 4));
    cloud = max(cloud, cum * exp(-lat * lat / 0.1) * 0.55 * clamp(cover * 1.4, 0.0, 1.0) * smoothstep(80.0, 250.0, px));
  }
  // Wind-stretched texture: cloud edges are torn into streaks and wisps along the flow (east-west).
  float sh2 = uWind * windAt(degrees(asin(clamp(d.y, -1.0, 1.0)))) * uCloudT;
  vec3 vw = vec3(d.x * cos(sh2) - d.z * sin(sh2), d.y, d.x * sin(sh2) + d.z * cos(sh2));
  if (px > 120.0) {
    float wisp = fbm(vec3(vw.x * 30.0, vw.y * 95.0, vw.z * 30.0) + seed + 5.0, 4);
    float edge = cloud * (1.0 - cloud) * 4.0;
    cloud = clamp(cloud + (wisp - 0.5) * 1.3 * edge * smoothstep(120.0, 300.0, px), 0.0, 1.0);
  }
  // Close up: crisper, finer structure in the cloud edges.
  if (px > 250.0) {
    float fine = fbm(d * 60.0 + seed + 3.0 + vec3(uCloudT * 0.05), 4) - 0.5;
    cloud = smoothstep(0.15, 0.85, clamp(cloud + fine * 0.6 * cloud * (1.0 - cloud) * 4.0, 0.0, 1.0));
  }
  // Cirrus: thin, translucent streaks high up in the mid-latitude jets.
  if (uDeck < 0.5) {
    float cir = smoothstep(0.6, 0.78, fbm(vec3(vw.x * 6.0, vw.y * 34.0, vw.z * 6.0) + seed + 11.0 + floor(uCloudT / 2.5) * 1.9, 4));
    cloud = max(cloud, cir * 0.35 * exp(-pow((lat - 0.6) / 0.22, 2.0)) * clamp(cover * 2.0, 0.0, 1.0));
  }
  if (cover > 0.95) cloud = clamp(cloud + 0.75, 0.0, 1.0);
  return vec2(cloud, smoothstep(thr, thr + 0.25, cl));
}
`;

// The cloud shell itself (BODY_VS at the deck's radius).
export const CLOUD_FS = HEAD + NOISE + MAPTEX_FS + CLOUDS + SPECTRUM + `
in vec3 vObj;
in vec3 vViewPos;
in vec3 vN;
` + LOGDEPTH_F + `
uniform vec3 uL0, uLc0, uL1, uLc1, uColC;
uniform float uCloud, uSeed, uPx, uTime, uEcl;
uniform float uTempC;       // the surface temperature (K), for the cloud tops' (colder) infrared glow
out vec4 outColor;
void main() {
  vec3 V = normalize(-vViewPos);
  vec3 N = normalize(vN);
  float mu = clamp(dot(N, V), 0.0, 1.0);
  vec2 cf = cloudField(normalize(vObj), uCloud, uSeed, uPx);
  // Seen obliquely, toward the limb, the layer is crossed along a longer path and looks denser.
  float a = 1.0 - pow(1.0 - clamp(cf.x, 0.0, 0.995), 1.0 / max(mu, 0.2));
  float d0 = dot(N, uL0), d1 = dot(N, uL1);
  // Relief of the cloud tops: thick cloud stands higher. The slope of its height across the screen tilts the
  // normal (as the ground's relief does), so near the terminator storm towers catch the low Sun on one side
  // and shade the other. Up to a few km on a ~6,000 km planet, exaggerated as the eye reads it from orbit.
  float hC = (cf.x * 0.7 + cf.y * 0.3) * 0.018;
  vec3 dpx = dFdx(vViewPos), dpy = dFdy(vViewPos);
  float sc = 1.0 / max(length(dpx) + length(dpy), 1e-30);
  dpx *= sc; dpy *= sc;
  vec3 r1 = cross(dpy, N), r2 = cross(N, dpx);
  float det = dot(dpx, r1);
  vec3 grad = sign(det) * (dFdx(hC) * r1 + dFdy(hC) * r2) * (uPx / 2.0);
  vec3 Nc = normalize(N - grad * smoothstep(40.0, 150.0, uPx));
  float b0 = dot(Nc, uL0);
  float lit0 = smoothstep(-0.1, 0.12, d0) * (0.3 + 0.7 * max(mix(d0, b0, 0.85), 0.0));
  float lit1 = smoothstep(-0.1, 0.12, d1) * (0.3 + 0.7 * max(d1, 0.0));
  // Thick tops are brighter, thin edges greyer.
  vec3 col = uColC * (0.72 + 0.32 * cf.y) * (uLc0 * lit0 * (1.0 - uEcl) + uLc1 * lit1 + 0.012);
  // Lightning: brief blue-white flashes inside thick clouds on the night side.
  if (cf.x > 0.6) {
    float night = 1.0 - smoothstep(-0.1, 0.05, d0);
    vec3 g = vObj * 40.0, cell = floor(g);
    float fl = step(0.9965, hash(cell + floor(uTime * 7.0))) * smoothstep(0.5, 0.05, length(fract(g) - 0.5));
    col += vec3(0.75, 0.8, 1.0) * fl * night * 1.6 * smoothstep(80.0, 200.0, uPx);
  }
  // Infrared: cloud tops are cold (high and thick colder still), so they glow less than the ground; UV: bright
  // (clouds reflect UV well); X-ray: invisible.
  if (uSpectrum == 1) col = inferno(irWorld(uTempC - 35.0 - 45.0 * cf.y) * 0.97);
  else if (uSpectrum == 2) col = uvTint(0.55 + 0.3 * cf.y) * (0.15 + 0.85 * max(d0, 0.0));
  else if (uSpectrum == 3) a = 0.0;
  outColor = vec4(col * a, a);
  ` + WRITE_DEPTH + `
}
`;

export const BODY_FS = HEAD + NOISE + BLACKBODY + MAPTEX_FS + CLOUDS + SPECTRUM + `
in vec3 vObj;
in vec3 vViewPos;
in vec3 vN;
` + LOGDEPTH_F + `
uniform int uKind;        // 0 rocky, 1 gas/ice giant, 2 star, 3 white dwarf / neutron star, 4 black-hole shadow
uniform vec3 uColA, uColB, uColC;
uniform float uSeed, uOcean, uCloud, uCraters, uLife, uBands, uVolc, uLineae, uSpots, uFacet;
uniform float uDayNight;
uniform float uBandK;    // band contrast // day-night temperature swing: large for airless worlds, small where air and oceans store heat
uniform float uTemp;      // surface temperature before day/night variation (K)
uniform float uSnowLat;   // latitude (as sin) where ice caps begin
uniform float uIce;       // 1 when the thermal model says there is surface ice
uniform float uLatSpan;   // equator-to-pole temperature difference (K)
uniform float uBoil;      // boiling point of water at this surface pressure (K)
uniform float uHeat;      // global heating from impacts, 0..1.5
uniform float uCrack;     // tidal stress near the Roche limit
uniform float uTime;
uniform vec4 uStorm;      // body-frame direction and size of a great storm
uniform vec3 uL0, uLc0, uL1, uLc1;   // two strongest lights: view-space direction, colour * intensity
uniform vec3 uL2, uLc2;   // light reflected by the planet this body orbits (earthshine, Saturnshine)
uniform vec3 uAtmo;
uniform float uAtmoK;
uniform vec4 uImp[16];
uniform vec4 uImpB[16];    // x: angular size, y: age (s)
uniform int uImpN;
uniform mat3 uView;        // shared with the vertex stage
uniform mat3 uRot;
uniform vec3 uCenter;
uniform float uRadius;
uniform vec3 uVeg;         // vegetation colour (depends on the star's light and the age of life)
uniform float uRelief;     // terrain relief: real topography scales roughly as 1/surface gravity
uniform float uHex;        // Saturn's north-polar hexagon
uniform vec3 uRingN;       // ring-plane normal (view space); zero when there are no rings
uniform vec2 uRingR;       // ring inner/outer radius in planet radii
uniform float uRingProf[16]; // ring opacity profile from the actual ring particles
uniform sampler2D uMap;    // surface map: 1 = land/mountains/ice (Earth, painted worlds), 2 = albedo (lunar maria)
uniform float uMapMode;
uniform sampler2D uGen;   // generated terrain map (GEN_FS), where uGenK is 1
uniform float uGenK;
uniform float uCity;       // night-side city lights (Earth)
uniform float uDeckH;      // cloud deck height (body radii), for the shadows
uniform sampler2D uNight;  // where they are (Black Marble), when uNightMap = 1
uniform float uNightMap;
uniform vec4 uOcc[4];      // bodies that can eclipse this one: centre relative to the eye (world axes), radius
uniform float uOccAtm[4];  // how much red light each one's atmosphere bends into its shadow (0 airless, 1 Earth)
uniform int uOccN;
uniform float uSunAng;     // angular radius of the light source seen from here (penumbra width)
uniform float uGran;       // star convection-cell frequency (fewer, larger cells for bigger stars)
uniform float uProfile;    // giant planets with measured band layouts: 1 Jupiter, 2 Saturn, 3 Uranus, 4 Neptune
uniform float uPx;         // the body's radius on screen (pixels): more detail octaves when it is large
uniform float uAurora;     // 1 Earth-like (oxygen green/red), 2 giant planet (H2, violet-pink)
out vec4 outColor;

// Belts and zones by latitude (degrees): Jupiter after Voyager/Cassini/Juno maps (north polar region,
// north temperate belt, NEB 7-18°N, the Equatorial Zone, SEB 7-20°S, the South Tropical Zone that holds
// the Great Red Spot, ...); Saturn's pale golden bands after Cassini.
vec3 bandTable(float lat, float which) {
  float E[12]; vec3 C[13];
  if (which < 1.5) {
    E = float[12](55.0, 43.0, 35.0, 27.0, 18.0, 7.0, -7.0, -20.0, -27.0, -34.0, -43.0, -55.0);
    C = vec3[13](vec3(0.55, 0.52, 0.49), vec3(0.74, 0.67, 0.58), vec3(0.88, 0.83, 0.74), vec3(0.6, 0.45, 0.35),
                 vec3(0.95, 0.91, 0.84), vec3(0.55, 0.35, 0.24), vec3(0.94, 0.87, 0.74), vec3(0.58, 0.40, 0.28),
                 vec3(0.96, 0.92, 0.85), vec3(0.66, 0.52, 0.41), vec3(0.88, 0.82, 0.73), vec3(0.68, 0.61, 0.53),
                 vec3(0.55, 0.52, 0.49));
  } else {
    E = float[12](70.0, 60.0, 47.0, 38.0, 28.0, 20.0, -20.0, -28.0, -38.0, -47.0, -60.0, -70.0);
    C = vec3[13](vec3(0.66, 0.66, 0.62), vec3(0.79, 0.73, 0.59), vec3(0.86, 0.80, 0.66), vec3(0.79, 0.71, 0.55),
                 vec3(0.90, 0.84, 0.70), vec3(0.83, 0.75, 0.57), vec3(0.95, 0.89, 0.72), vec3(0.84, 0.76, 0.57),
                 vec3(0.91, 0.85, 0.70), vec3(0.81, 0.73, 0.57), vec3(0.86, 0.80, 0.66), vec3(0.77, 0.71, 0.59),
                 vec3(0.68, 0.65, 0.60));
  }
  vec3 col = C[0];
  for (int i = 0; i < 12; i++) col = mix(col, C[i + 1], smoothstep(E[i] + 0.9, E[i] - 0.9, lat));
  return col;
}

// Fraction of the light blocked by other bodies (eclipses, moons' shadows on giant planets), with a
// penumbra as wide as the Sun's disc seen from the surface.
// red: the share of the shadow that an atmosphere fills with refracted red sunlight (a lunar eclipse's
// copper Moon: Earth's air bends the sunset light of its whole rim into the umbra).
float eclipse(vec3 P, vec3 L, out float red) {
  float s = 0.0;
  red = 0.0;
  for (int i = 0; i < 4; i++) {
    if (i >= uOccN) break;
    vec3 C = uView * uOcc[i].xyz;
    float t = dot(C - P, L);
    if (t <= 0.0) continue;
    float d = length(C - P - L * t);
    float pen = t * uSunAng;
    float si = smoothstep(uOcc[i].w + pen, uOcc[i].w - pen, d);
    s = max(s, si);
    red = max(red, si * uOccAtm[i]);
  }
  return s;
}

// Shadow cast by the planet's ring onto its surface (fraction of light blocked).
float ringShadow(vec3 P, vec3 L) {
  if (dot(uRingN, uRingN) < 0.5) return 0.0;
  float den = dot(uRingN, L);
  if (abs(den) < 1e-4) return 0.0;
  float t = -dot(uRingN, P) / den;
  if (t <= 0.0) return 0.0;
  float r = length(P + L * t) / uRadius;
  if (r < uRingR.x || r > uRingR.y) return 0.0;
  int k = int(clamp((r - uRingR.x) / (uRingR.y - uRingR.x) * 16.0, 0.0, 15.0));
  return uRingProf[k];
}


// Crisp terminator, softened slightly where there is an atmosphere to scatter light.
uniform float uSoft;
float lightTerm(vec3 N, vec3 L) {
  float d = dot(N, L);
  return smoothstep(-0.03 - uSoft, 0.1 + uSoft, d) * (0.22 + 0.78 * max(d, 0.0));
}

void main() {
  vec3 V = normalize(-vViewPos);
  vec3 N = normalize(vN);
  float hsh = 1.0;   // sunlight left after the shadows the ground casts on itself (from its elevation map)
  if (uFacet > 0.0) {
    // In units of the body's radius: in AU, a small moon's per-pixel steps (~1e-10) underflow the cross
    // product, and normalising the denormal result gives NaN (drawn black).
    vec3 pr = vViewPos / uRadius;
    vec3 cx = cross(dFdx(pr), dFdy(pr));
    vec3 Nd = dot(cx, cx) > 0.0 ? normalize(cx) : N;
    if (dot(Nd, V) < 0.0) Nd = -Nd;
    N = normalize(mix(N, Nd, uFacet));
  }
  float mu = clamp(dot(N, V), 0.0, 1.0); // clamped above too: pow(1 - mu, ..) of a negative is NaN on Apple GPUs

  // Impacts: fresh ones glow, all leave a scar. Around each: a scorched basin with a lighter rim,
  // radial ejecta rays, a shock ring racing outward, and a plume of vapour over the site.
  float glow = 0.0, scar = 0.0, rays = 0.0, rimL = 0.0, shock = 0.0, plume = 0.0, core = 0.0;
  for (int i = 0; i < 16; i++) {
    if (i >= uImpN) break;
    vec3 dI = uImp[i].xyz;
    float a = acos(clamp(dot(vObj, dI), -1.0, 1.0));
    float w = uImpB[i].x, t = uImpB[i].y, e = uImp[i].w;
    // Ragged edge: the basin outline wobbles with azimuth.
    vec3 t1 = normalize(cross(dI, abs(dI.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
    vec3 t2 = cross(dI, t1);
    float az = atan(dot(vObj, t2), dot(vObj, t1));
    float rag = 1.0 + 0.18 * (vnoise(vec3(cos(az) * 3.0, sin(az) * 3.0, float(i) * 7.0 + uSeed)) - 0.5);
    float aa = a / rag;
    scar += e * smoothstep(w * 1.15, w * 0.55, aa);
    rimL += e * exp(-pow((aa - w * 1.05) / (w * 0.16), 2.0));
    float ray = pow(vnoise(vec3(az * 5.0, float(i) * 3.1, uSeed)), 3.0);
    rays += e * ray * smoothstep(w * 3.2, w * 1.1, a) * step(w, a);
    glow += e * exp(-a * a / (w * w * 0.7)) * exp(-t / 6.0);
    core += e * exp(-aa * aa / (w * w * 0.12)) * exp(-t / 45.0);
    float rr = w + 0.5 * t;
    shock += e * exp(-pow((a - rr) / (0.02 + 0.03 * t), 2.0)) * exp(-t / 2.2);
    float pr = w * (1.3 + 0.35 * sqrt(t));
    plume += e * smoothstep(pr, pr * 0.3, a) * smoothstep(0.0, 0.8, t) * exp(-t / 30.0);
  }
  scar = clamp(scar, 0.0, 1.0);
  rays = clamp(rays, 0.0, 1.0);
  rimL = clamp(rimL, 0.0, 1.0);

  if (uKind == 4) { outColor = vec4(0.0, 0.0, 0.0, 1.0); ` + WRITE_DEPTH + ` return; }

  if (uKind == 2 || uKind == 3) {
    vec3 c = blackbody(uTemp);
    if (uKind == 3) {
      vec3 col = mix(c, vec3(1.0), 0.55) * (0.65 + 0.35 * mu) * 1.25;
      // (White dwarfs and neutron stars: hot surfaces that blaze in UV and X-rays.)
      if (uSpectrum == 1) col = inferno(irLevel(uTemp) * 0.85) * (0.65 + 0.35 * mu);
      else if (uSpectrum == 2) col = uvTint(0.4 + 0.6 * clamp(uTemp / 20000.0, 0.0, 1.0)) * 1.4;
      else if (uSpectrum == 3) col = xrayTint(clamp(uTemp / 30000.0, 0.3, 1.0)) * 1.6;
      outColor = vec4(col + glow, 1.0);
    } else {
      // Convection cells: bright upwelling centres, dark lanes of sinking gas. Their size relative to the
      // star grows with its radius: invisible-small on the Sun at this scale, a few huge cells on a red
      // supergiant (as imaged on Betelgeuse and R Doradus).
      float cellC = crater(vObj * uGran + vec3(uTime * 0.02, 0.0, uTime * 0.013) + uSeed);
      float warpN = fbm(vObj * uGran * 2.5 + uSeed + vec3(uTime * 0.03), 4);
      float lanes = smoothstep(0.25, 0.7, cellC + 0.35 * (warpN - 0.5));
      float gran = fbm(vObj * 26.0 + vec3(uTime * 0.12, uTime * 0.07, 0.0), 4) * (1.0 - lanes * 0.6) + (1.0 - lanes) * 0.25 * step(uGran, 24.0);
      // Sunspots: groups of small dark umbrae with lighter penumbrae, only in the activity belts between
      // ~5° and ~35° latitude, and only where an active region is (patchy, slowly changing).
      float latS = abs(vObj.y);
      float actReg = smoothstep(0.5, 0.64, fbm(vObj * 3.0 + uSeed + vec3(uTime * 0.002), 3)) * smoothstep(0.06, 0.12, latS) * smoothstep(0.6, 0.45, latS);
      float sd = crater(vObj * 34.0 + uSeed * 1.3);
      float umbra = (1.0 - smoothstep(0.06, 0.1, sd)) * actReg;
      float penum = (1.0 - smoothstep(0.1, 0.2, sd)) * actReg;
      float spot = (umbra * 0.85 + penum * 0.45) * uSpots;
      // Faculae: bright magnetic patches around actReg regions, visible near the limb.
      float facula = actReg * smoothstep(0.35, 0.6, fbm(vObj * 40.0 + uSeed, 3)) * (1.0 - mu) * uSpots;
      // Limb darkening: the edge shows cooler, higher layers, so it is dimmer and redder.
      vec3 limb = blackbody(uTemp * (0.7 + 0.3 * sqrt(mu)));
      // Giant cells stand out strongly on supergiants (bright plumes, dark cool lanes).
      float big = smoothstep(26.0, 6.0, uGran);
      float act = uMapMode > 8.5 ? mix(1.0, 2.0 * mapTex(uMap, vObj).r, 0.18) : 1.0;
      float I = act * (0.5 + 0.5 * sqrt(mu)) * (0.9 + 0.2 * gran) * (1.0 - 0.75 * spot) * (1.0 - big * (0.4 * lanes - 0.12)) * (1.0 + big * 0.25 * (warpN - 0.5));
      vec3 col = limb * I * (1.05 + 0.25 * facula) + c * glow * 1.5;
      if (uSpectrum == 1) col = inferno(irLevel(uTemp * (0.7 + 0.3 * sqrt(mu))) * 0.92) * (0.85 + 0.15 * gran);
      // Ultraviolet: hot stars bright, cool ones faint (a blackbody's UV share falls steeply with temperature);
      // the bright active regions stand out, the limb is not darkened as much.
      else if (uSpectrum == 2) col = uvTint(clamp(pow(uTemp / 9000.0, 2.0), 0.05, 1.0) * (0.75 + 0.35 * facula / max(uSpots, 0.01) + 0.6 * actReg)) * (0.8 + 0.2 * mu) * 1.3;
      // X-ray: the hot corona above active regions (the photosphere itself is dark): bright patches, brightest
      // at the limb where the line of sight runs through more corona.
      else if (uSpectrum == 3) col = xrayTint((0.08 + 1.4 * actReg + 0.3 * smoothstep(0.4, 0.75, fbm(vObj * 6.0 + uSeed, 3))) * (0.6 + 0.8 * (1.0 - mu))) * (uTemp < 2500.0 ? 0.3 : 1.0);
      outColor = vec4(col, 1.0);
    }
    ` + WRITE_DEPTH + `
    return;
  }

  vec3 q = vObj * 1.7 + uSeed;
  float lat = abs(vObj.y);
  float day = max(dot(N, uL0), 0.0);
  // Local temperature: day side warmer, poles cooler, plus impact and global heat.
  float T = uTemp + uLatSpan * (0.33 - lat * lat) + uTemp * uDayNight * (sqrt(day) - 0.45);
  T += glow * 2600.0 + uHeat * 1700.0;
  vec3 col;
  float water = 0.0, frozen = 0.0, boiled = 0.0;
  float cityLand = 0.0, cityE = 1.0, cityIce = 0.0; // passed from the surface block to the night lights

  if (uKind == 1) {
    float turb = fbm(vec3(vObj.x * 2.0, vObj.y * 7.0, vObj.z * 2.0) + uSeed, 5);
    float b = vObj.y * uBands + turb * 0.9;
    float band = 0.5 + 0.5 * sin(b * 6.2831853);
    float edgeW = 1.0 - abs(sin(b * 6.2831853));
    if (uProfile > 0.5) {
      // Real giants: latitude profile, displaced by turbulence that is stretched east-west by the jets.
      float latD = degrees(asin(clamp(vObj.y, -1.0, 1.0)));
      float lon = atan(vObj.z, vObj.x);
      vec3 sp = vec3(cos(lon), sin(lon), 0.0);  // longitude on a circle (no seam)
      float tq = uProfile < 2.5 ? 1.0 : 0.45;   // Saturn, Uranus, Neptune are calmer
      float warp = (fbm(vec3(sp.xy * 1.6, latD * 0.16) + uSeed + vec3(uTime * 0.004, 0.0, 0.0), 5) - 0.5) * 3.2 * tq
                 + (fbm(vec3(sp.xy * 6.0, latD * 0.7) + uSeed + 3.0, 4) - 0.5) * 1.3 * tq;
      // Waviness at the band edges at smaller scales too (chevrons and scallops seen in close-ups).
      float dOct = uPx > 300.0 ? 4.0 : uPx > 120.0 ? 3.0 : 2.0;
      warp += (fbm(vec3(sp.xy * 18.0, latD * 1.6) + uSeed + 9.0, int(dOct)) - 0.5) * 0.9 * tq;
      float lp = latD + warp;
      bool cmap = uMapMode > 5.5;
      // Flowing bands: each latitude slides with its jet (alternating east and west every ~7°, as on Jupiter and
      // Saturn), so neighbouring bands visibly shear past each other. A flow map: two copies at different ages,
      // cross-faded, each reset while it is faded out, so the shear never grows without limit.
      float jet = sin(radians(latD) * 26.0) * (1.0 - 0.5 * abs(vObj.y)) * tq;
      float FT = 30.0, fph = uTime / FT, fa = fract(fph), fb = fract(fph + 0.5);
      float wA = 1.0 - abs(2.0 * fa - 1.0);
      float shA = jet * fa * 0.12, shB = jet * fb * 0.12;     // radians of longitude over a cycle
      vec3 vA = vec3(vObj.x * cos(shA) - vObj.z * sin(shA), vObj.y, vObj.x * sin(shA) + vObj.z * cos(shA));
      vec3 vB = vec3(vObj.x * cos(shB) - vObj.z * sin(shB), vObj.y, vObj.x * sin(shB) + vObj.z * cos(shB));
      if (cmap) col = mix(mapTex(uMap, vB).rgb, mapTex(uMap, vA).rgb, wA);
      else if (uProfile < 2.5) col = bandTable(lp, uProfile);
      else if (uProfile < 3.5) {
        // Uranus: almost featureless cyan haze; faint bands and a brighter polar hood.
        col = vec3(0.66, 0.86, 0.9) * (0.97 + 0.04 * sin(lp * 0.12)) + vec3(0.06, 0.05, 0.03) * smoothstep(55.0, 75.0, abs(lp));
      } else {
        // Neptune: pale greenish blue, only a little bluer than Uranus. The deep blue of the familiar
        // Voyager images came from contrast-stretched processing (Irwin et al. 2024, MNRAS 527, 11521).
        // A darker band near 60°S, lighter towards the equator.
        col = mix(vec3(0.49, 0.68, 0.86), vec3(0.56, 0.75, 0.9), exp(-lp * lp / 600.0));
        col = mix(col, vec3(0.38, 0.55, 0.75), exp(-pow((lp + 60.0) / 7.0, 2.0)) * 0.8);
        // Bright methane-ice cirrus streaks, long and thin, near 25°N and 40°S.
        float st = smoothstep(0.62, 0.85, fbm(vec3(sp.xy * 3.0, latD * 0.9) + uSeed + 7.0, 4));
        col = mix(col, vec3(0.92, 0.95, 1.0), st * (exp(-pow((latD + 42.0) / 3.5, 2.0)) + exp(-pow((latD - 26.0) / 3.0, 2.0))) * 0.85);
      }
      // Cloud texture: two-level domain-warped noise in (longitude, latitude), sheared east-west, so it
      // forms streaks, swirls and filaments like the real cloud decks.
      float lonF = lon + mix(shB, shA, wA);                   // (the noise flows with the bands too)
      sp = vec3(cos(lonF), sin(lonF), 0.0);
      vec3 fp = vec3(sp.xy * 10.0, latD * 0.55);
      int fo = int(dOct) + 1;
      vec3 w1 = vec3(fbm(fp + uSeed, fo), fbm(fp + uSeed + 5.2, fo), 0.0);
      vec3 w2 = vec3(fbm(fp + w1 * 3.0 + 1.7, fo), fbm(fp + w1 * 3.0 + 9.2, fo), 0.0);
      float flow = fbm(fp + vec3(w2.x * 3.5, w2.y * 0.8, 0.0) + vec3(uTime * 0.006, 0.0, 0.0), fo + 1);
      // Belts (dark) are torn by white turbulent rifts; zones (light) carry faint orange-brown filaments.
      float lum = dot(col, vec3(0.3, 0.55, 0.15));
      float belt = 1.0 - smoothstep(0.62, 0.84, lum);
      float flow2 = fbm(fp * 2.1 + vec3(w1.y * 2.0, 0.0, 0.0) + 13.0, fo);
      if (uProfile < 1.5 && !cmap) {
        col = mix(col, vec3(0.93, 0.88, 0.8), belt * smoothstep(0.5, 0.72, flow) * 0.6);
        col = mix(col, col * vec3(0.82, 0.7, 0.6), (1.0 - belt) * smoothstep(0.55, 0.75, flow2) * 0.45);
      }
      col *= cmap ? 0.93 + 0.14 * flow : 0.88 + 0.26 * flow * (uProfile < 2.5 ? 1.0 : 0.4);
      col *= 0.97 + 0.06 * vnoise(vec3(sp.xy * 48.0, latD * 4.0) + uSeed);
      float grad = length(bandTable(lp + 0.6, uProfile) - bandTable(lp - 0.6, uProfile));
      float eddy = fbm(vec3(sp.xy * 9.0, latD * 0.9) + uSeed + vec3(uTime * 0.01, 0.0, 0.0), 4);
      if (uProfile < 2.5 && !cmap) col = mix(col, col * (0.8 + 0.4 * eddy), clamp(grad * 4.0, 0.0, 1.0) * tq);
      if (uProfile < 1.5 && !cmap) {
        // Festoons: dark blue-grey plumes hooking from the NEB's southern edge into the Equatorial Zone.
        float fe = smoothstep(0.62, 0.9, 0.5 + 0.5 * sin(lon * 11.0 + 2.4 * fbm(vec3(sp.xy * 2.0, latD * 0.25) + uSeed, 3) + (latD - 7.0) * 0.4));
        col = mix(col, vec3(0.37, 0.39, 0.45), fe * exp(-pow((latD - 5.5) / 2.2, 2.0)) * 0.6);
        // White ovals in the south temperate belt (and Oval BA, a little redder).
        for (int k = 0; k < 3; k++) {
          float ol = 0.6 + 2.1 * float(k), olat = -33.0 + float(k) * 0.8;
          float dl = atan(sin(lon - ol), cos(lon - ol));
          float od = length(vec2(dl / 0.045, (latD - olat) / 1.6));
          vec3 oc = k == 1 ? vec3(0.86, 0.66, 0.58) : vec3(0.95, 0.94, 0.9);
          float sw = fbm(vec3(dl * 30.0, latD * 0.8, float(k)) + uSeed, 3);
          col = mix(col, oc, smoothstep(1.25, 0.35, od + 0.25 * (sw - 0.5)) * 0.75);
          col *= 1.0 - 0.1 * exp(-pow((od - 1.2) / 0.25, 2.0));
        }
      }
      if (uProfile < 1.5) {
        // The polar regions: a mottled field of cyclones (Juno).
        float pc = smoothstep(62.0, 75.0, abs(latD)) * smoothstep(0.25, 0.45, crater(vObj * 22.0 + uSeed));
        col = mix(col, col * vec3(0.8, 0.82, 0.88), pc * 0.6);
      }
    } else {
      col = mix(uColA, uColB, band * uBandK);
      if (uDonorK > 0.0) {
        // A real giant's band and storm pattern, recoloured with this planet's own two colours.
        float t = donorT(vObj);
        col = mix(col, mix(uColB, uColA, smoothstep(0.65, 1.3, t)) * (0.8 + 0.2 * t), uDonorK);
      }
      col *= 0.94 + 0.12 * vnoise(vec3(vObj.x * 3.0, vObj.y * 46.0, vObj.z * 3.0) + uSeed);
      // Eddies and filaments where neighbouring jets shear past each other (band edges).
      float eddy = fbm(vec3(vObj.x * 6.0, vObj.y * 24.0, vObj.z * 6.0) + turb * 2.5 + uSeed + vec3(uTime * 0.01, 0.0, 0.0), 5);
      col = mix(col, mix(uColA * 1.06, uColB * 0.78, step(0.52, eddy)), edgeW * 0.45 * smoothstep(0.38, 0.68, eddy) * uBandK);
    }
    if (uStorm.w > 0.0 && dot(vObj, normalize(uStorm.xyz)) > 0.0) {
      // A great storm (Jupiter's Great Red Spot, Neptune's Dark Spot): an anticyclone about twice as
      // wide as it is tall, its clouds spiralling inward, ringed by a pale collar, with a turbulent wake.
      vec3 sd = normalize(uStorm.xyz);
      vec3 east = normalize(cross(vec3(0.0, 1.0, 0.0), sd));
      vec3 north = cross(sd, east);
      vec2 uv = vec2(dot(vObj, east), dot(vObj, north)) / uStorm.w;
      float er = length(vec2(uv.x / 1.5, uv.y)); // GRS ~16,000 x 11,000 km (Juno, 2017-19)
      float sw = 2.6 * (1.0 - smoothstep(0.0, 1.3, er));
      vec2 ruv = mat2(cos(sw), -sin(sw), sin(sw), cos(sw)) * uv;
      float swirlN = fbm(vec3(ruv * 5.0, uSeed), 4);
      float inside = smoothstep(1.05, 0.85, er);
      vec3 spot = mix(mix(uColC, col, 0.25) * 1.1, uColC * 0.8 + vec3(0.1, 0.05, 0.02), smoothstep(0.85, 0.2, er)) * (0.8 + 0.45 * swirlN);
      if (uProfile > 3.5) {
        // Neptune's Great Dark Spot: soft-edged, with bright companion clouds along its southern side.
        col = mix(col, uColC, smoothstep(1.1, 0.5, er) * 0.85);
        float comp = exp(-pow((uv.y + 1.25) / 0.25, 2.0)) * smoothstep(1.6, 0.4, abs(uv.x)) * smoothstep(0.4, 0.75, swirlN);
        col = mix(col, vec3(0.95, 0.97, 1.0), comp);
      } else {
        col = mix(col, spot, inside);
        col = mix(col, vec3(0.93, 0.9, 0.84), exp(-pow((er - 1.12) / 0.09, 2.0)) * 0.7);
      }
      float wake = smoothstep(1.2, 2.6, -uv.x) * smoothstep(1.4, 0.3, abs(uv.y)) * smoothstep(5.0, 2.5, -uv.x);
      col = mix(col, col * (0.75 + 0.5 * fbm(vec3(uv * 3.0, uSeed + 4.0), 4)), wake);
    }
    // Saturn's north-polar hexagon: a six-sided jet stream around a bluish polar vortex (Cassini).
    if (uHex > 0.0 && vObj.y > 0.7) {
      float a = atan(vObj.z, vObj.x);
      float rr = length(vObj.xz);
      float hr = 0.24 / cos(mod(a + 0.3, 1.0472) - 0.5236);
      float inside = smoothstep(hr + 0.02, hr - 0.02, rr);
      col = mix(col, vec3(0.6, 0.66, 0.68) * (0.92 + 0.12 * fbm(vObj * 40.0, 3)), inside * 0.32);
      col *= 1.0 - 0.12 * exp(-pow((rr - hr) / 0.01, 2.0));
      col = mix(col, vec3(0.45, 0.5, 0.55), smoothstep(0.05, 0.0, rr) * 0.45);
    }
    col = mix(col, vec3(0.1, 0.07, 0.06), scar * 0.8);
  } else {
    // Terrain: continents from low-frequency noise, ridged mountain ranges on land, fine detail; from the
    // generated map where the world has one (far richer noise than can be run here every frame).
    vec4 GEN = uGenK > 0.5 ? mapTex(uGen, vObj) : vec4(0.0);
    float h = uGenK > 0.5 ? GEN.r : fbm(q, 6);
    float sea = 0.3 + 0.36 * uOcean; // fbm is roughly 0.3-0.7, so this tracks the ocean fraction
    // Elevation above sea level, in noise units; dry worlds measure it from their mean surface instead.
    float e = uOcean > 0.0 ? h - sea : h - 0.56;
    float rg = 1.0 - abs(2.0 * vnoise(q * 3.1 + 11.0) - 1.0);
    float rg2 = uGenK > 0.5 ? GEN.a : 1.0 - abs(2.0 * vnoise(q * 7.3 + 3.0) - 1.0);
    float mtn = (uGenK > 0.5 ? GEN.g : rg * rg * (0.65 + 0.35 * rg2)) * smoothstep(0.0, 0.1, e);
    float landMask = uOcean > 0.0 ? smoothstep(sea, sea + 0.012, h) : 1.0;
    // Surface map (equirectangular, east-positive longitude): real or painted geography.
    vec4 MP = vec4(0.0);
    float coast = 0.5, mapW = 0.0, mapH = 0.0;
    if (uMapMode > 0.5) {
      MP = mapTex(uMap, vObj);
      if (uMapMode < 1.5) {
        mapW = MP.a;
        // Coastline at 0.5, made fractal by noise at several scales (bays, headlands, island chains).
        float nearCoast = 1.0 - smoothstep(0.12, 0.42, abs(MP.r - 0.5));
        coast = MP.r + (h - 0.5) * 0.5 + (fbm(q * 9.0 + 2.0, 4) - 0.5) * 0.4
              + ((fbm(q * 40.0 + 5.0, 3) - 0.5) * 0.45 + (vnoise(q * 130.0) - 0.5) * 0.2) * nearCoast;
        // A (alpha) says where the map sets land and sea; mountains (G) and ice (B) apply anywhere,
        // so painting them onto a procedural world keeps its own coastlines.
        landMask = mix(landMask, smoothstep(0.48, 0.52, coast), mapW);
        e = mix(e, min((coast - 0.5) * 0.12, 0.05), mapW) + 0.22 * MP.g;
        mtn = max(mtn, rg * rg * (0.35 + 0.65 * rg2) * MP.g * 1.7);
        landMask = max(landMask, smoothstep(0.15, 0.35, MP.g));
      }
      // Radar map (Venus): bright = rough highlands, dark = smooth plains; R is brightness / (2 × mean).
      else if (uMapMode > 2.5 && uMapMode < 3.5) mapH = 0.3 * (MP.r - 0.5) * (1.0 - uHMapK);
    }
    float Hgt = (uOcean > 0.0 ? max(e, 0.0) : h - 0.5) + 0.14 * mtn + 0.006 * vnoise(q * 38.0) + mapH;
    // Relief shading: tilt the normal by the slope of the height field (screen-space bump mapping),
    // so mountain ranges and valleys show, most of all near the terminator.
    {
      // Positions in units of the radius, so the products below stay far from float underflow on small
      // bodies (in AU they reach ~1e-40, and normalising that gives NaN).
      vec3 dpx = dFdx(vViewPos / uRadius), dpy = dFdy(vViewPos / uRadius);
      float dhx = dFdx(Hgt), dhy = dFdy(Hgt);
      vec3 r1 = cross(dpy, N), r2 = cross(N, dpx);
      float det = dot(dpx, r1);
      vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
      // Real elevation, where there is a height map: its slopes, in units of the radius.
      vec3 gradR = vec3(0.0);
      if (uHMapK > 0.5) {
        float hR = mapTex(uHMap, uHRot * vObj).r * uHGlobe;
        if (uOcean > 0.0) hR = max(hR, 0.0);        // the sea surface is flat over the sea floor
        gradR = sign(det) * (dFdx(hR) * r1 + dFdy(hR) * r2);
        // Long shadows near the terminator: walk toward the Sun over the elevation map. Ground rising above
        // the line to the Sun (which climbs at the Sun's elevation, plus x²/2 as the sphere curves away)
        // shades this point, softly over the width of the Sun's disc. Heights at their true scale (the
        // slope shading above doubles them).
        vec3 Lo = transpose(uRot) * (transpose(uView) * uL0);
        vec3 P0 = normalize(vObj);
        float sE = dot(P0, Lo);
        if (uPx > 40.0 && sE > -0.02 && sE < 0.3) {
          vec3 T = normalize(Lo - P0 * sE);
          float tE = sE / sqrt(max(1.0 - sE * sE, 1e-4));
          float h0 = hR * 0.5, x = 0.0015, sun = max(uSunAng, 0.0047);
          for (int i = 0; i < 10; i++) {
            vec3 d = uHRot * normalize(P0 + T * x);
            float hx = textureLod(uHMap, vec2(atan(-d.z, d.x) / 6.2831853 + 0.5, 0.5 - asin(clamp(d.y, -1.0, 1.0)) / 3.14159265), 0.0).r * uHGlobe * 0.5;
            if (uOcean > 0.0) hx = max(hx, 0.0);
            float ray = h0 + x * tE + 0.5 * x * x;
            hsh = min(hsh, clamp(0.5 + (ray - hx) / (2.0 * x * sun), 0.0, 1.0));
            x *= 1.6;
          }
        }
      }
      vec3 Nb = normalize(abs(det) * N - grad * 0.05 * uRelief * (1.0 - 0.8 * uHMapK) - gradR);
      N = normalize(mix(N, Nb, max(landMask * clamp(uRelief, 0.0, 1.0), uHMapK * (uOcean > 0.0 ? landMask : 1.0))));
      day = max(dot(N, uL0), 0.0);
    }
    // Climate zones: wet tropics, dry subtropical belts near 25-30° (Hadley cells), wetter mid-latitudes.
    float desert = exp(-pow(lat - 0.45, 2.0) / 0.012);
    float moist = (uGenK > 0.5 ? GEN.b : fbm(q * 1.3 + 31.0, 4)) + 0.18 * exp(-lat * lat / 0.02) - 0.3 * desert;
    vec3 land = mix(uColA, uColB, smoothstep(0.32, 0.68, uGenK > 0.5 ? GEN.a : fbm(q * 2.4 + 7.0, 4)));
    land = mix(land, land * vec3(1.12, 1.0, 0.82), desert * 0.5);
    // Mountains: bare rock, darker and greyer with height.
    land = mix(land, vec3(0.36, 0.34, 0.32) * (0.8 + 0.4 * rg2), smoothstep(0.05, 0.16, e + 0.08 * mtn) * 0.75);
    if (uLife > 0.0) {
      // Biomes, as seen from orbit: deserts tan, steppe and savanna olive-brown, temperate forest green,
      // dark tropical rainforest near the equator, dark boreal forest at 50-65°, grey-brown tundra beyond.
      float warm = smoothstep(255.0, 280.0, T) * smoothstep(335.0, 305.0, T);
      float wet = smoothstep(0.38, 0.6, moist);
      float lowland = 1.0 - smoothstep(0.08, 0.2, e + 0.1 * mtn);
      vec3 sand = vec3(0.78, 0.66, 0.47) * (0.9 + 0.2 * vnoise(q * 20.0));
      vec3 steppe = vec3(0.52, 0.47, 0.31);
      vec3 forest = uVeg * (0.65 + 0.4 * vnoise(q * 9.0));
      vec3 rain = uVeg * vec3(0.5, 0.62, 0.45);
      vec3 boreal = uVeg * vec3(0.55, 0.6, 0.55) + vec3(0.02, 0.02, 0.0);
      vec3 tundra = vec3(0.45, 0.42, 0.36);
      float latB = lat;
      vec3 bio = mix(steppe, forest, smoothstep(0.4, 0.6, moist));
      bio = mix(bio, rain, exp(-latB * latB / 0.025) * smoothstep(0.45, 0.6, moist));
      bio = mix(bio, boreal, smoothstep(0.7, 0.8, latB) * (1.0 - smoothstep(0.88, 0.94, latB)));
      bio = mix(bio, tundra, smoothstep(0.88, 0.95, latB));
      // The great deserts sit under the subtropical highs, and spread where it is dry.
      bio = mix(bio, sand, clamp(desert * 1.3 - wet * 0.9, 0.0, 1.0));
      land = mix(land, bio, uLife * warm * lowland + uLife * 0.35 * (1.0 - lowland));
    }
    // Mountain chains from the generated map: bare rock along the ridges, streaked light and dark like eroded
    // slopes, with snow on the high peaks where it is cold.
    if (uGenK > 0.5) {
      float ridgeC = smoothstep(0.28, 0.7, GEN.g) * smoothstep(0.0, 0.025, e);
      float streak = vnoise(q * 60.0 + GEN.g * 8.0);
      vec3 rock = mix(vec3(0.3, 0.27, 0.24), vec3(0.58, 0.53, 0.47), clamp(GEN.a * 1.4 - 0.2 + 0.3 * (streak - 0.5), 0.0, 1.0));
      land = mix(land, rock, ridgeC * 0.75);
      land = mix(land, vec3(0.88, 0.9, 0.94), smoothstep(0.62, 0.85, GEN.g) * smoothstep(0.02, 0.06, e) * smoothstep(290.0, 268.0, T) * 0.9);
    }
    // Colour map: the real surface colours (with life or seas still drawn on top if the world gets them).
    bool cmapR = uMapMode > 4.5 && uMapMode < 8.5;
    if (uMapMode > 4.5 && uMapMode < 5.5) land = MP.rgb;
    if (uMapMode > 6.5 && uMapMode < 8.5) { float t = 2.0 * MP.r; land = mix(uColB, uColA, clamp(t, 0.0, 1.0)) * t; }
    // Donor map: the borrowed world's light and dark terrain, over this world's own (climate) colours.
    if (uDonorK > 0.0) land *= mix(1.0, clamp(donorT(vObj), 0.15, 2.2), uDonorK);
    if (uDayK > 0.0) land = mix(land, mapTex(uDay, vObj).rgb * 0.92, uDayK);
    // Close up, land shows finer texture (fields of terrain and vegetation patches).
    if (uPx > 250.0) land *= 0.86 + 0.28 * fbm(q * 70.0 + 3.0, 3);
    if (uProfile > 4.5 && uProfile < 5.5 && !cmapR) {
      // Mars: albedo features at their real places (lat, east lon in degrees). Dark: Syrtis Major, Mare
      // Acidalium, Solis Lacus, the dark southern highlands band; bright: Hellas and Argyre basins, Tharsis.
      float mlat = degrees(asin(clamp(vObj.y, -1.0, 1.0)));
      float mlon = degrees(atan(-vObj.z, vObj.x));
      float dark = 0.0, bright = 0.0;
      #define MF(LAT, LON, A, B) exp(-pow((mlat - (LAT)) / (A), 2.0) - pow(degrees(atan(sin(radians(mlon - (LON))), cos(radians(mlon - (LON))))) / (B), 2.0))
      dark += MF(8.0, 70.0, 12.0, 9.0) + MF(20.0, 64.0, 10.0, 6.0);          // Syrtis Major
      dark += MF(45.0, -30.0, 10.0, 22.0);                                   // Mare Acidalium
      dark += MF(-25.0, -85.0, 5.0, 7.0) * 0.8;                              // Solis Lacus
      dark += MF(-15.0, 20.0, 10.0, 40.0) * 0.7 + MF(-20.0, -10.0, 8.0, 25.0) * 0.6 + MF(-25.0, 110.0, 9.0, 30.0) * 0.6; // southern dark band
      bright += MF(-42.0, 70.0, 12.0, 15.0) + MF(-50.0, -43.0, 7.0, 9.0) * 0.7;  // Hellas, Argyre
      bright += MF(5.0, -110.0, 18.0, 30.0) * 0.5;                           // Tharsis (dusty, bright)
      float fn = fbm(q * 4.0 + 5.0, 4);
      land = mix(land, land * vec3(0.45, 0.4, 0.38), clamp(dark * (0.8 + 0.6 * fn), 0.0, 0.9));
      land = mix(land, land * vec3(1.18, 1.12, 1.05), clamp(bright * (0.7 + 0.5 * fn), 0.0, 0.7));
      // Valles Marineris: a 4,000 km canyon system along ~8°S from 30° to 90°W, darker and shadowed.
      float vm = exp(-pow((mlat + 8.0 + 3.0 * sin(radians(mlon) * 9.0)) / 1.3, 2.0)) * smoothstep(-95.0, -85.0, mlon) * smoothstep(-25.0, -40.0, mlon);
      land = mix(land, land * 0.55, vm * 0.8);
      // Olympus Mons and the three Tharsis volcanoes: bright aureoles with a dark central caldera.
      float om = MF(18.0, -134.0, 4.0, 4.5), tv = MF(-1.0, -112.0, 2.0, 2.2) + MF(-9.0, -121.0, 2.0, 2.2) + MF(12.0, -104.0, 2.0, 2.2);
      land = mix(land, land * 1.2, (om + tv) * 0.6);
      land = mix(land, land * 0.6, (MF(18.0, -134.0, 0.9, 1.0) + 0.0) * 0.8);
      #undef MF
    }
    if (uLineae > 0.0) {
      float l = 1.0 - smoothstep(0.0, 0.025, abs(vnoise(q * 5.0) - 0.5));
      land = mix(land, uColB * 0.7, l * uLineae);
    }
    frozen = smoothstep(272.0, 260.0, T);
    boiled = smoothstep(uBoil, uBoil + 30.0, T);
    // Oceans: deep blue, turquoise over shallow shelves near the coast.
    float depth = mix(sea - h, (0.5 - coast) * 0.45, mapW);
    vec3 ocean = mix(vec3(0.01, 0.045, 0.15), vec3(0.03, 0.17, 0.36), smoothstep(0.14, 0.02, depth));
    ocean = mix(ocean, vec3(0.06, 0.34, 0.40), smoothstep(0.035, 0.0, depth) * 0.75);
    vec3 seabed = mix(uColB * 0.55, uColA * 0.45, h);
    vec3 ice = vec3(0.86, 0.9, 0.96);
    vec3 seaCol = mix(mix(ocean, ice, frozen), seabed, boiled);
    water = (1.0 - landMask) * (1.0 - frozen) * (1.0 - boiled) * (1.0 - scar);
    col = mix(seaCol, land, landMask);
    // Ice caps creep toward the equator as the planet cools.
    float snow = smoothstep(uSnowLat, uSnowLat + 0.07, lat + 0.12 * (fbm(q * 3.0, 3) - 0.5));
    // A colour map already shows the world's own ice (Mars's caps, Pluto's nitrogen plains).
    col = mix(col, ice, snow * smoothstep(290.0, 268.0, T) * uIce * (cmapR ? 0.0 : 1.0));
    cityLand = landMask; cityE = e; cityIce = MP.b;
    // Mapped ice sheets (Greenland, Antarctica) and painted ice.
    col = mix(col, ice * (0.92 + 0.08 * rg2), (uMapMode < 1.5 ? 1.0 : 0.0) * smoothstep(0.35, 0.6, MP.b));
    if (uMapMode > 2.5 && uMapMode < 3.5) col *= 0.6 + 0.8 * MP.r;
    // Albedo maps: dark basaltic maria and bright ray systems on the Moon.
    if (uMapMode > 1.5 && uMapMode < 2.5) {
      // Maria: irregular, lobed edges and darker and lighter lava flows within; ray systems on top.
      float mare = smoothstep(0.15, 0.8, MP.r + (fbm(q * 5.0 + 1.0, 4) - 0.5) * 0.35 + (vnoise(q * 30.0) - 0.5) * 0.1);
      vec3 mc = mix(vec3(0.21, 0.21, 0.22), vec3(0.31, 0.3, 0.29), fbm(q * 9.0 + 4.0, 3));
      col = mix(col, mc, mare * 0.8);
      col = mix(col, vec3(0.78, 0.77, 0.75), MP.b * 0.55);
      // The highlands are saturated with craters of every size.
      float hc = crater(vObj * 28.0 + uSeed);
      col *= mix(1.0, 0.95 + 0.07 * smoothstep(0.15, 0.4, hc) + 0.1 * (fbm(q * 14.0, 3) - 0.5), 1.0 - mare);
    }
    // Snow on high peaks: air cools with height (about 6.5 K per km on Earth).
    // Only worlds with a water cycle (liquid oceans) get snow-capped peaks.
    float Tz = T - 40.0 * max(e, 0.0) - 85.0 * mtn * mtn;
    col = mix(col, ice * (0.9 + 0.1 * rg2), smoothstep(266.0, 256.0, Tz) * landMask * step(0.001, uOcean) * smoothstep(0.03, 0.1, e));
    if (uCraters > 0.0) {
      float c = crater(vObj * 4.0 + uSeed);
      float c2 = crater(vObj * 11.0 + uSeed * 2.0);
      float bowl = smoothstep(0.18, 0.45, c) * 0.7 + 0.3 * smoothstep(0.15, 0.4, c2);
      float rim = smoothstep(0.42, 0.5, c) * smoothstep(0.6, 0.5, c);
      if (uMapMode > 7.5 && uMapMode < 8.5) {
        // The Moon beyond the photograph (G is where it covers): highlands saturated with small and
        // mid-sized craters, no large ringed ones (those read as bullseyes at this scale).
        float hc = crater(vObj * 28.0 + uSeed), hc2 = crater(vObj * 60.0 + uSeed * 3.0);
        float sat = 0.93 + 0.06 * smoothstep(0.15, 0.4, hc) + 0.04 * smoothstep(0.12, 0.35, hc2) + 0.08 * (fbm(q * 14.0, 3) - 0.5) + 0.04 * (bowl - 0.5);
        col *= mix(1.0, sat, 1.0 - MP.g);
      } else col *= mix(1.0, 0.84 + 0.18 * bowl + 0.1 * rim, uCraters);
    }
    // Scorched basin: charred brown with radial streaks, a light ejecta rim, and rays splashed outward.
    vec3 burnt = mix(vec3(0.09, 0.06, 0.045), vec3(0.26, 0.17, 0.11), vnoise(q * 18.0) * 0.6 + rays * 0.4);
    col = mix(col, burnt, scar * 0.85);
    col = mix(col, vec3(0.55, 0.48, 0.4), rimL * 0.35);
    col = mix(col, col * 0.6 + vec3(0.12, 0.1, 0.08), rays * 0.5);
  }

  // Lighting, with the shadow of the planet's own rings.
  vec3 Pc = vViewPos - uView * uCenter;
  float rs = ringShadow(Pc, uL0);
  float eclRed = 0.0;
  float ecl = uOccN > 0 ? eclipse(Pc + uView * uCenter, uL0, eclRed) : 0.0;
  vec3 lit = vec3(0.015) + uLc0 * lightTerm(N, uL0) * (1.0 - 0.85 * rs) * ((1.0 - ecl) * hsh + eclRed * vec3(0.3, 0.085, 0.03))
           + uLc1 * lightTerm(N, uL1) + uLc2 * max(dot(N, uL2), 0.0);
  // Ringshine: the rings' sunlit face lights the night side of the hemisphere it faces, as in Cassini's
  // images of Saturn. Seen from the cloud tops the rings fill most sky at mid-latitudes (none at the equator,
  // where they are edge-on, little near the pole): view factor ~ sin 2·latitude. Their brightness falls as
  // the Sun drops toward the ring plane (gone at equinox). Strength ~0.1 × that of sunlight, compressed as
  // the planetshine is (see planetshine in render3d.js).
  if (dot(uRingN, uRingN) > 0.5) {
    float sB = dot(uRingN, uL0), z = dot(normalize(Pc), uRingN) * sign(sB);
    if (z > 0.0) {
      float tau = 0.0;
      for (int i = 0; i < 16; i++) tau += uRingProf[i];
      float g = 0.12 * 2.0 * z * sqrt(max(1.0 - z * z, 0.0)) * (tau / 16.0) * min(1.0, 4.0 * abs(sB));
      float night = 1.0 - smoothstep(-0.15, 0.25, dot(normalize(Pc), uL0));
      lit += uLc0 * vec3(1.0, 0.9, 0.74) * 0.55 * pow(max(g, 0.0), 0.25) * night * max(0.3 + 0.7 * dot(N, normalize(Pc)), 0.0);
    }
  }
  // Giant planets darken toward the limb (sunlight there is scattered in the haze above the clouds).
  if (uKind == 1) lit *= 0.55 + 0.45 * pow(mu, 0.45);
  // The clouds themselves are drawn on their own layer above (CLOUD_FS); here only their shadows,
  // cast toward the light's opposite side by the deck's height.
  float cloud = 0.0;
  if (uCloud > 0.0 && uCloud < 0.95) {
    vec3 Lo = transpose(uRot) * (transpose(uView) * uL0);
    float cs = cloudField(normalize(vObj + Lo * uDeckH), uCloud, uSeed, min(uPx, 60.0)).x;
    col *= 1.0 - 0.45 * cs * smoothstep(-0.05, 0.2, dot(N, uL0));
  }
  vec3 Hv = normalize(uL0 + V);
  float spec = pow(max(dot(N, Hv), 0.0), 90.0) * 0.4 * water * (1.0 - cloud);
  // Sunglint on water widens and brightens toward the limb (Fresnel).
  spec += pow(max(dot(N, Hv), 0.0), 12.0) * 0.12 * water * (1.0 - cloud) * pow(1.0 - mu, 3.0);
  vec3 outc = col * lit + spec * uLc0 * (1.0 - rs) * (1.0 - ecl) * hsh;
  // City lights on the night side: clustered along coasts and in lowlands, absent from ice and desert.
  if (uCity > 0.0 && uKind == 0) {
    float night = 1.0 - smoothstep(-0.12, 0.08, dot(N, uL0));
    // Metropolitan areas (clusters) made of many small points of light, with a faint glow between.
    float metro = smoothstep(0.42, 0.62, fbm(q * 7.0 + 3.0, 3));
    float dots = 1.0 - smoothstep(0.03, 0.11, crater(q * 240.0));
    float cl0 = metro * (dots * smoothstep(0.25, 0.55, vnoise(q * 40.0)) + 0.35 * smoothstep(0.55, 0.85, vnoise(q * 60.0)));
    float coastal = 1.0 - smoothstep(0.0, 0.12, cityE);
    float lights = cl0 * (0.35 + 0.65 * coastal) * cityLand * (1.0 - smoothstep(0.3, 0.6, cityIce / 1.0)) * (1.0 - frozen) * smoothstep(0.0, 0.4, 1.0 - lat);
    if (uNightMap > 0.5) {
      // The real distribution of lights, broken into points of light when seen close up.
      float Lm = mapTex(uNight, vObj).r;
      float fine = mix(1.0, 0.25 + 1.5 * dots * smoothstep(0.2, 0.6, vnoise(q * 40.0)) + 0.3 * metro, smoothstep(250.0, 900.0, uPx));
      lights = Lm * 1.4 * fine * cityLand * (1.0 - frozen);
    }
    outc += vec3(1.0, 0.7, 0.36) * lights * night * 1.7 * (1.0 - cloud * 0.7);
  }

  // Aurorae: an oval of light around each magnetic pole (about 23° from it on Earth, tilted ~11° from the
  // spin axis), brightest on the night side. Oxygen gives Earth's green, with red higher up; giant planets'
  // hydrogen glows faintly violet-pink. The curtains ripple along the oval.
  if (uAurora > 0.0) {
    vec3 mAx = normalize(vec3(0.19, 0.98, 0.0));
    float night = 1.0 - smoothstep(-0.15, 0.1, dot(N, uL0));
    for (int hemi = 0; hemi < 2; hemi++) {
      vec3 ax = hemi == 0 ? mAx : -mAx;
      float colat = degrees(acos(clamp(dot(vObj, ax), -1.0, 1.0)));
      vec3 e1 = normalize(cross(ax, vec3(0.0, 0.0, 1.0))), e2 = cross(ax, e1);
      float az = atan(dot(vObj, e2), dot(vObj, e1));
      float ring = uAurora < 1.5 ? 22.0 : 14.0;
      float wob = 2.0 * (fbm(vec3(cos(az) * 2.0, sin(az) * 2.0, uTime * 0.03 + float(hemi) * 5.0), 3) - 0.5);
      float band = exp(-pow((colat - ring - wob) / 1.6, 2.0));
      float curtain = 0.4 + 0.6 * smoothstep(0.35, 0.8, vnoise(vec3(az * 40.0, uTime * 0.25, float(hemi))));
      vec3 ac = uAurora < 1.5 ? mix(vec3(0.2, 1.0, 0.45), vec3(0.9, 0.2, 0.25), smoothstep(0.0, 2.5, ring - colat + wob) * 0.6) : vec3(0.65, 0.45, 1.0);
      outc += ac * band * curtain * night * (uAurora < 1.5 ? 0.9 : 0.35) * smoothstep(40.0, 120.0, uPx);
    }
  }

  // Heat. Rocky worlds grow a dark basalt crust broken by pools of glowing lava; the pools spread
  // and merge as the temperature climbs until the whole surface is molten. Gas giants glow in bands.
  float hot = smoothstep(700.0, 1400.0, T);
  if (hot > 0.0) {
    if (uKind == 1) {
      // Hot giants glow by their own heat through turbulent bands, broken by dark, cooler vortices.
      vec3 wv2 = vec3(fbm(vObj * 2.3 + uSeed, 3), fbm(vObj * 2.3 + uSeed + 5.1, 3), 0.0) - 0.5;
      float tb = fbm(vec3(vObj.x * 2.5, vObj.y * 8.0, vObj.z * 2.5) + wv2 * 2.2 + vec3(uTime * 0.02, 0.0, 0.0), 5);
      float storms = smoothstep(0.52, 0.72, fbm(vObj * 3.0 + wv2 * 3.0 + uSeed * 2.0, 4));
      float pole = smoothstep(0.75, 0.95, abs(vObj.y)) * (0.6 + 0.4 * tb);
      float dim = clamp(storms * 0.75 + pole * 0.6, 0.0, 0.9);
      outc = mix(outc, outc * 0.3, hot);
      outc += blackbody(T * (0.62 + 0.62 * tb)) * hot * (0.35 + 1.3 * tb * tb) * (1.0 - dim) * 1.35;
    } else {
      float melt = smoothstep(800.0, 2800.0, T);
      float flow = fbm(q * 1.15 + vec3(0.0, uTime * 0.012, uTime * 0.008), 5);
      float lo = 0.63 - 0.42 * melt;
      float lava = smoothstep(lo, lo + 0.035, flow);
      float rim = smoothstep(lo - 0.06, lo, flow) - lava;
      float core = smoothstep(lo + 0.03, lo + 0.14, flow);
      // Cooled basalt crust, faintly lit by the lava beside it.
      vec3 crust = vec3(0.15, 0.16, 0.2) * (lit + 0.05) + vec3(0.5, 0.16, 0.04) * rim * 0.6;
      outc = mix(outc, crust, hot);
      // Pools are yellow-white at the centre and orange at the edges.
      vec3 lc = blackbody(clamp(T * (0.75 + 0.45 * core), 1100.0, 4200.0));
      outc += lc * hot * (lava * (1.4 + 1.4 * core) + rim * 0.9) * (0.85 + 0.15 * fbm(q * 6.0 + uTime * 0.05, 2));
    }
  }
  // Fresh impact sites glow white-hot and fade to a dull red as they cool; the molten centre lingers.
  if (glow > 0.01) {
    float g = clamp(glow, 0.0, 1.0);
    outc += blackbody(1200.0 + 3000.0 * g) * g * 2.6;
  }
  if (core > 0.01 && uKind == 0) {
    float c = clamp(core, 0.0, 1.0);
    outc += blackbody(1000.0 + 900.0 * c) * c * (1.2 + 0.4 * vnoise(q * 9.0 + uTime * 0.3));
  }
  // Shock ring racing across the surface.
  outc += vec3(1.0, 0.85, 0.65) * clamp(shock, 0.0, 1.0) * 1.4;
  // Vapour plume: rock vapour and, where there is water, a billowing steam cloud lit by the Sun.
  if (plume > 0.01) {
    float pf = clamp(plume, 0.0, 1.0) * smoothstep(0.35, 0.7, fbm(vObj * 9.0 + uSeed + vec3(0.0, uTime * 0.05, 0.0), 4));
    vec3 pc = mix(vec3(0.75, 0.68, 0.6), vec3(0.95), clamp(uOcean * 1.5, 0.0, 1.0));
    outc = mix(outc, pc * (lightTerm(N, uL0) * 0.9 + 0.12) * uLc0 + pc * 0.04, pf * 0.85);
  }
  // Tidal stress opens glowing fissures before the body breaks apart.
  if (uCrack > 0.0) {
    float cr = 1.0 - smoothstep(0.0, 0.035, abs(vnoise(q * 8.0) - 0.5));
    outc += vec3(1.0, 0.42, 0.1) * cr * uCrack * 1.4;
  }
  if (uVolc > 0.0 && uMapMode > 4.5 && uMapMode < 5.5) {
    // With a real map (Io): hot lava sits in its dark paterae, and at visible wavelengths it only shows
    // against the night side (as Galileo and New Horizons saw it).
    vec3 mc = mapTex(uMap, vObj).rgb;
    float pat = smoothstep(0.22, 0.1, dot(mc, vec3(0.3, 0.55, 0.15)));
    float nightV = 1.0 - smoothstep(-0.1, 0.05, dot(N, uL0));
    outc += vec3(1.0, 0.42, 0.1) * pat * nightV * uVolc * 0.5 * (0.7 + 0.3 * sin(uTime * 3.0 + q.x * 9.0));
  } else if (uVolc > 0.0) {
    float v = smoothstep(0.86, 0.93, vnoise(q * 7.0));
    outc = mix(outc, vec3(0.05), v * 0.6 * uVolc);
    outc += vec3(1.0, 0.45, 0.12) * smoothstep(0.91, 0.95, vnoise(q * 7.0)) * uVolc * (0.6 + 0.4 * sin(uTime * 3.0 + q.x * 9.0));
  }
  // Atmosphere: a lit haze at the limb.
  float fres = pow(1.0 - mu, 2.6);
  outc += uAtmo * uAtmoK * fres * (lightTerm(N, uL0) * 0.9 + 0.08);
  // Other bands. Infrared: the world's own thermal glow by its local temperature (day and night alike), a
  // little cooler toward the limb (seen through colder upper air). Ultraviolet: surfaces reflect little; ice and
  // cloud tops some. X-ray: almost nothing (a faint fluorescence of the sunlit side).
  // (Giant planets: the 5-micron view, heat from deep down escaping where the clouds are thin: the dark belts
  // glow, the bright zones are cool; as in Gemini and Juno images of Jupiter.)
  if (uSpectrum == 1 && uKind == 1) outc = inferno(0.22 + 0.62 * (1.0 - smoothstep(0.25, 0.85, dot(col, vec3(0.3, 0.55, 0.15)))) * (0.75 + 0.25 * mu));
  else if (uSpectrum == 1) outc = inferno(irWorld(T * (0.94 + 0.06 * mu) + uHeat * 400.0) * 0.97 + 0.02 * (h1n(vObj) - 0.5));
  else if (uSpectrum == 2) outc = uvTint(dot(outc, vec3(0.3, 0.55, 0.15)) * 0.6 + frozen * 0.3) * (0.15 + 0.85 * lightTerm(N, uL0));
  else if (uSpectrum == 3) outc = xrayTint(0.05 * lightTerm(N, uL0)) * 0.3;
  outColor = vec4(outc, 1.0);
  ` + WRITE_DEPTH + `
}
`;

// ---------- Surface-view terrain ----------
// A local mesh around the observer: rings from 0.3 m out past the horizon (~150 km), heights from the
// same continental noise the globe uses (so coasts and mountain ranges line up with the view from orbit)
// plus metre-to-kilometre hills, dunes and craters. Positions are built in a local east/north/up frame in
// metres, so there is no float cancellation against the planet's radius.
const TERRAIN_COMMON = `
uniform float uSeed, uOcean, uMapMode, uRelief, uCraters, uRough;
uniform sampler2D uMap;
uniform sampler2D uGen;     // the globe's generated terrain map, where uGenK is 1 (so the ground matches it)
uniform float uGenK;
uniform vec2 uLocal;        // offset of this spot in the small-scale noise (varies with location)
// Planet-scale elevation at object-space direction d, as on the globe: x = elevation (noise units, 0 at
// sea level), y = mountain ridges 0..1.
vec2 bigTerrain(vec3 d) {
  vec3 q = d * 1.7 + uSeed;
  vec4 GEN = uGenK > 0.5 ? mapTex(uGen, d) : vec4(0.0);
  float h = uGenK > 0.5 ? GEN.r : fbm(q, 6);
  float sea = 0.3 + 0.36 * uOcean;
  float e = uOcean > 0.0 ? h - sea : h - 0.56;
  float rg = 1.0 - abs(2.0 * vnoise(q * 3.1 + 11.0) - 1.0);
  float rg2 = 1.0 - abs(2.0 * vnoise(q * 7.3 + 3.0) - 1.0);
  float mtn = (uGenK > 0.5 ? GEN.g : rg * rg * (0.65 + 0.35 * rg2)) * smoothstep(0.0, 0.1, e);
  if (uMapMode > 0.5 && uMapMode < 1.5) {
    vec4 MP = mapTex(uMap, d);
    float coast = MP.r + (h - 0.5) * 0.5;
    e = mix(e, (coast - 0.5) * 0.12, MP.a) + 0.22 * MP.g;
    mtn = max(mtn, rg * rg * (0.35 + 0.65 * rg2) * MP.g * 1.7);
  }
  if (uMapMode > 2.5 && uMapMode < 3.5) e += 0.25 * (mapTex(uMap, d).r - 0.5);
  return vec2(e, mtn);
}
// Height above sea level (m). Real topography scales roughly as 1/g (uRelief: ~4 km on Earth).
float bigHeight(vec2 em) {
  float e = em.x, mtn = em.y;
  if (uOcean > 0.0) return e > 0.0 ? uRelief * (5.0 * e + 0.9 * mtn) : uRelief * 6.0 * e;
  return uRelief * (4.0 * e + 0.9 * mtn);
}
// Ridged noise: sharp crests, rounded valleys.
float ridge(vec3 p) { return 1.0 - abs(2.0 * vnoise(p) - 1.0); }
// Local relief at planar position p (m): rolling hills, ridges and, on airless worlds, craters. Octaves
// finer than the sampling 'res' (m) fade out to avoid aliasing. rough: 0 plains .. 1 mountains.
// A field of simple craters (one per cell, random size and place): a bowl ~a fifth as deep as it is wide,
// a raised rim, and ejecta thinning outward. Neighbouring craters add, so the surface stays continuous.
float crater2(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  float h = 0.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y));
    vec3 hc = vec3(i + g, 3.7);
    if (hash(hc + 2.9) < 0.35) continue;                 // not every cell has a crater
    vec2 o = vec2(hash(hc), hash(hc + 11.3));
    float r = 0.12 + 0.3 * hash(hc + 5.1);
    float d = length(g + o - f) / r;
    // rim height 0.25 at d = 1, bowl floor -0.6 at the centre, smooth through the rim
    h += d < 1.0 ? -0.6 + 0.85 * d * d * (3.0 - 2.0 * d) : 0.25 * exp(-(d - 1.0) * 5.0) * smoothstep(2.4, 1.6, d);
  }
  return h;
}
// Relief finer than the mesh can carry (from about meshRes down to the pixel size res): added in the
// fragment shader as shading. Same spectrum as smallHeight (amplitude proportional to wavelength).
float fineDetail(vec2 p, float rough, float res, float meshRes) {
  vec2 pp = p + uLocal;
  float k = uRelief * (0.012 + 0.04 * rough) * uRough / 2400.0, h = 0.0, lam = meshRes * 2.0;
  for (int i = 0; i < 5; i++) {
    float f = smoothstep(res * 2.0, res * 5.0, lam);
    if (f <= 0.0) break;
    h += k * lam * 1.15 * (vnoise(vec3(pp / lam, float(i) * 1.7 + 40.0 + uSeed)) - 0.5) * f;
    lam *= 0.45;
  }
  return h;
}
// Mountain ranges between the map's scale (~20 km a pixel) and the hills: ridged multifractal noise from
// 24 km down to ~2 km wavelength, crests sharpening where the range is already high; up to ~1.8 km of relief
// where the map says mountains (mtn), gentle swells elsewhere.
float rangeHeight(vec2 p, float mtn, float res) {
  vec2 pp = p + uLocal;
  float h = 0.0, amp = uRelief * (0.06 + 0.45 * mtn), lam = 24000.0, w = 1.0;
  for (int i = 0; i < 4; i++) {
    float f = smoothstep(res * 2.5, res * 6.0, lam);
    if (f <= 0.0) break;
    float n = ridge(vec3(pp / lam, float(i) * 5.3 + uSeed + 70.0));
    n = n * n * w;
    w = clamp(n * 1.8, 0.0, 1.0);
    h += amp * (n - 0.3) * f;
    lam *= 0.45; amp *= 0.45;
  }
  return h;
}
// Valley floors of those ranges, 0..1: where they are low, between their crests (for the mist).
float rangeValley(vec2 p) {
  // At the scales of the valleys in view (the ranges' 2nd and 3rd octaves, ~11 and ~5 km). (Value noise
  // clusters about 0.5, so a ridge value is mostly high; the floors are its lower third.)
  vec2 pp = p + uLocal;
  float n = 0.5 * (ridge(vec3(pp / 10800.0, uSeed + 75.3)) + ridge(vec3(pp / 4860.0, uSeed + 80.6)));
  return 1.0 - smoothstep(0.45, 0.75, n);
}
uniform float uDunes;   // dune strength: 1 on dry worlds with thin air; little under Venus's (few dunes seen there)
float smallHeight(vec2 p, float rough, float res) {
  vec2 pp = p + uLocal;
  float h = 0.0, amp = uRelief * (0.012 + 0.04 * rough) * uRough, lam = 2400.0;
  for (int i = 0; i < 9; i++) {
    float f = smoothstep(res * 2.5, res * 6.0, lam);
    if (f <= 0.0) break;
    vec3 nq = vec3(pp / lam, float(i) * 3.1 + uSeed);
    // Rolling hills everywhere; sharp ridges only in mountain country (and rounded off at the crest).
    float r0 = ridge(nq);
    float n = mix(vnoise(nq), r0 * r0, i < 3 ? rough * 0.8 : 0.0) - 0.5;
    h += amp * n * f;
    lam *= 0.42; amp *= i < 3 ? 0.42 : 0.38;
  }
  // Dune fields on dry, flat ground: transverse dunes ~60 m apart and a few metres high, crests bent by the
  // wind's eddies, gentle on the windward side and steep on the lee; only within fields (patchy).
  if (uOcean <= 0.0 && uCraters < 0.5) {
    float field = smoothstep(0.45, 0.65, vnoise(vec3(pp / 4000.0, 44.0))) * (1.0 - smoothstep(0.2, 0.5, rough));
    if (field > 0.0) {
      float f = smoothstep(res * 2.5, res * 6.0, 60.0);
      float ph = (pp.x * 0.8 + pp.y * 0.6) / 60.0 + 1.2 * vnoise(vec3(pp / 300.0, 45.0)) + 0.4 * vnoise(vec3(pp / 80.0, 46.0));
      float t = fract(ph), dune = t < 0.75 ? t / 0.75 : (1.0 - t) / 0.25;   // long windward slope, short slip face
      h += uRelief * 0.0012 * dune * dune * field * f * uDunes;
    }
  }
  if (uCraters > 0.0) {
    // Simple craters are about a fifth as deep as they are wide (crater2's bowl reaches -0.6 at the centre
    // of a crater up to ~0.9 cells across).
    float c = 0.0, cl = 900.0;
    for (int i = 0; i < 4; i++) {
      float f = smoothstep(res * 4.0, res * 10.0, cl);
      if (f <= 0.0) break;
      c += crater2(pp / cl + float(i) * 17.0) * 0.25 * cl * f;
      cl *= 0.3;
    }
    h += c * uCraters;
  }
  return h;
}
`;

export const TERRAIN_VS = HEAD + NOISE + MAPTEX_VS + TERRAIN_COMMON + `
layout(location = 0) in vec2 aPolar;   // distance from the observer (m), azimuth
uniform mat4 uProj;
uniform mat3 uView, uRot;              // world -> view, object -> world
uniform vec3 uObs, uEast, uNorth;      // object frame: observer's direction and local axes
uniform float uRm, uEyeH, uAU;         // planet radius (m), eye height (m), metres per AU
uniform float uSeaOK;                  // 1 when there is liquid water at sea level
out vec3 vViewPos;
out vec3 vDir;
out vec2 vPlanar;
out vec3 vInfo;                        // x: height above sea (m), y: mountains, z: distance (m)
out vec3 vNrm;                         // smooth ground normal (view space)
out float vShadow;                     // sunlight left after the terrain's own shadows
out float vEyeAlt;                     // the eye's height above sea level (m)
out vec2 vValley;                      // valley floor (0..1) here and at the eye, for the mist
uniform vec3 uSunO;                    // direction to the Sun, object frame
uniform float uSunAngT;                // the Sun's angular radius (rad)
` + LOGDEPTH_V + `
// Generated relief: continents and ranges, or with a real height map only the hills below its resolution.
float terrainH(vec3 d, vec2 p, float res, out vec2 em) {
  em = bigTerrain(d);
  if (uHMapK > 0.5) return smallHeight(p, uOcean > 0.0 ? clamp(em.y * 1.5 + 0.15, 0.0, 1.0) : 0.45, res);
  return bigHeight(em) + rangeHeight(p, clamp(em.y * 1.6, 0.0, 1.0), res) + smallHeight(p, clamp(em.y * 1.5 + 0.15, 0.0, 1.0), res);
}
float mapHeight(vec3 d) { return uHMapK > 0.5 ? mapTex(uHMap, uHRot * d).r * uHScale : 0.0; }
void main() {
  float r = aPolar.x;
  vec2 p = vec2(cos(aPolar.y), sin(aPolar.y)) * r;
  vec3 d = normalize(uObs + (uEast * p.x + uNorth * p.y) / uRm);
  float res = 0.1 * r + 0.05;            // the mesh's spacing here (rings ~10% apart)
  vec2 em, em0;
  float Hm = mapHeight(d), H0m = mapHeight(uObs);
  float Hg = terrainH(d, p, res, em);
  float H = Hg + Hm;
  float H0 = terrainH(uObs, vec2(0.0), 0.05, em0) + H0m;
  float sea = uSeaOK > 0.5 ? 0.0 : -1e9;
  float Href = max(H0, sea);             // stand on the ground, or on the water if it's sea here
  float Hs = max(H, sea);
  vEyeAlt = Href + uEyeH;
  // Valleys: low between the ranges' crests (and on any low ground near the sea).
  float coastal = uSeaOK > 0.5 ? 1.0 - smoothstep(20.0, 300.0, Hs) : 0.0;
  vValley = vec2(max(rangeValley(p), coastal), max(rangeValley(vec2(0.0)), uSeaOK > 0.5 ? 1.0 - smoothstep(20.0, 300.0, Href) : 0.0));
  float drop = dot(p, p) / (2.0 * uRm);  // the planet curving away
  vec3 rel = uEast * p.x + uNorth * p.y + uObs * (Hs - Href - drop - uEyeH);
  vec3 world = uRot * rel / uAU;
  vViewPos = uView * world;
  // Normal from the height field's slope (central differences at the mesh spacing), so lighting is smooth
  // instead of faceted triangle by triangle.
  float ep = max(res * 0.7, 0.05);
  vec2 emx, emy;
  vec3 dxp = normalize(uObs + (uEast * (p.x + ep) + uNorth * p.y) / uRm);
  vec3 dyp = normalize(uObs + (uEast * p.x + uNorth * (p.y + ep)) / uRm);
  float gx = (max(terrainH(dxp, p + vec2(ep, 0.0), res, emx) + Hm, sea) - Hs) / ep;
  float gy = (max(terrainH(dyp, p + vec2(0.0, ep), res, emy) + Hm, sea) - Hs) / ep;
  if (uHMapK > 0.5) {
    // The height map's own slope, over at least 300 m: finer steps would only measure float rounding.
    float ep2 = max(ep, 300.0);
    gx += (mapHeight(normalize(uObs + (uEast * (p.x + ep2) + uNorth * p.y) / uRm)) - Hm) / ep2;
    gy += (mapHeight(normalize(uObs + (uEast * p.x + uNorth * (p.y + ep2)) / uRm)) - Hm) / ep2;
  }
  vNrm = uView * (uRot * normalize(uObs - uEast * gx - uNorth * gy));
  // Shadows cast by the terrain: march toward the Sun over the height field. Ground rising above the line to
  // the Sun (climbing at its elevation, and by x²/2R as the planet curves away below it) shades this point,
  // softly over the width of the Sun's disc. Only with the Sun below ~27°, when shadows are long.
  vShadow = 1.0;
  float sU = dot(uSunO, d);
  vec2 sh2 = vec2(dot(uSunO, uEast), dot(uSunO, uNorth));
  float shl = length(sh2);
  if (sU > -0.035 && sU < 0.45 && shl > 1e-4) {
    vec2 hd = sh2 / shl;
    float tE = sU / shl, x = max(res, 20.0), sunA = max(uSunAngT, 0.002);
    for (int i = 0; i < 14; i++) {
      vec2 q = p + hd * x;
      vec3 dq = normalize(uObs + (uEast * q.x + uNorth * q.y) / uRm);
      vec2 emq;
      float hq = max(terrainH(dq, q, max(res, x * 0.08), emq) + mapHeight(dq), sea);
      float ray = Hs + x * tE + x * x / (2.0 * uRm);
      vShadow = min(vShadow, clamp(0.5 + (ray - hq) / (2.0 * x * sunA), 0.0, 1.0));
      x *= 1.75;
    }
  }
  vDir = d; vPlanar = p; vInfo = vec3(H, em.y, r);
  gl_Position = uProj * vec4(vViewPos, 1.0);
  vFragDepth = 1.0 + gl_Position.w * ` + DEPTH_K + `;
}
`;

export const TERRAIN_FS = HEAD + NOISE + MAPTEX_FS + TERRAIN_COMMON + `
in vec3 vViewPos;
in vec3 vDir;
in vec2 vPlanar;
in vec3 vInfo;
in vec3 vNrm;
in float vShadow;
in float vEyeAlt;
in vec2 vValley;
` + LOGDEPTH_F + `
uniform vec3 uL0, uSunCol, uAmb;       // sun direction (view), sunlight reaching the ground, sky light
uniform vec3 uEastV, uNorthV, uUpV;    // local axes in view space
uniform vec3 uColA, uColB, uVeg;
uniform float uLife, uTemp, uLatSpan, uIce, uBoil, uSeaOK, uLapse, uTime, uPxAng, uSnowLat;
uniform vec3 uFogExt;                  // ground-level extinction per metre (per channel)
uniform float uFogH;                   // scale height of that haze (m)
uniform vec3 uFogSun, uFogAnti, uSkyZen; // sky colour at the horizon toward / away from the sun, zenith
uniform vec4 uHaze;                    // humid haze: extinction (per m), scale height (m); valley mist: extinction
uniform sampler2D uClouds;             // the sky's cloud buffer this frame (premultiplied), mirrored by water
uniform float uCloudOn;
uniform sampler2D uSceneTex;           // reflection pass (uRefl 1): the frame so far, mirrored by the water
uniform float uRefl;
uniform vec2 uTan;                     // tangents of the half field of view (x, y), to find a direction on screen
out vec4 outColor;
// Optical depth along a straight ray from height h0 to h1 (m), length L (m), through a layer whose density
// falls as k·exp(-(h - b)/S) (full below b): exact for the exponential, so long sloping rays are right.
float layerDepth(float k, float S, float b, float h0, float h1, float L) {
  float a0 = exp(-max(h0 - b, 0.0) / S), a1 = exp(-max(h1 - b, 0.0) / S);
  float dh = h1 - h0;
  return k * L * (abs(dh) < S * 0.01 ? 0.5 * (a0 + a1) : S * (a0 - a1) / dh);
}
void main() {
  vec3 sunC = uSunCol * vShadow;         // the Sun's light, where the terrain does not shade it
  float H = vInfo.x, mtnBig = vInfo.y, dist = vInfo.z;
  vec3 V = normalize(-vViewPos);
  float res = max(0.002, dist * uPxAng);            // metres per pixel here
  bool water = uSeaOK > 0.5 && H < 0.0;
  float lat = abs(vDir.y);
  // Temperature here: latitude, then air cooling with height (lapse rate).
  float T = uTemp + uLatSpan * (0.33 - lat * lat) - uLapse * max(H, 0.0) * 0.001;
  vec3 col; vec3 N;
  float ssrA = 0.0;                      // reflection pass: how much of the mirrored frame this water pixel shows
  if (water) {
    // Waves: two scales of drifting noise, slope only (the surface stays flat).
    vec2 q = vPlanar + uLocal;
    float t = uTime;
    float e1 = 0.0, e2 = 0.0, a = 0.35, lam = 9.0;
    for (int i = 0; i < 5; i++) {
      float f = smoothstep(res * 2.0, res * 8.0, lam);
      vec2 w = q / lam + vec2(t * 0.35, t * 0.21) / sqrt(lam);
      float n0 = vnoise(vec3(w, float(i) * 2.0));
      e1 += a * f * (vnoise(vec3(w + vec2(0.05, 0.0), float(i) * 2.0)) - n0) / 0.05;
      e2 += a * f * (vnoise(vec3(w + vec2(0.0, 0.05), float(i) * 2.0)) - n0) / 0.05;
      lam *= 0.45; a *= 0.75;
    }
    N = normalize(uUpV - (uEastV * e1 + uNorthV * e2) * 0.12);
    float frozen = smoothstep(272.0, 262.0, T);
    vec3 R = reflect(-V, N);
    float up = clamp(dot(R, uUpV), 0.0, 1.0);
    // Horizontal directions of the reflected ray and of the sun (either can be vertical: guard the normalize).
    vec3 Rh = R - uUpV * dot(R, uUpV), Sh = uL0 - uUpV * dot(uL0, uUpV);
    float az = dot(Rh, Rh) > 1e-8 && dot(Sh, Sh) > 1e-8 ? dot(normalize(Rh), normalize(Sh)) : 0.0;
    vec3 sky = mix(mix(uFogAnti, uFogSun, az * 0.5 + 0.5), uSkyZen, sqrt(up));
    // The clouds in the mirror: where the reflected ray points on screen (view space), if it is on screen.
    if (uCloudOn > 0.5 && R.z < 0.0) {
      vec2 cuv = (R.xy / -R.z) / uTan * 0.5 + 0.5;
      vec2 edge = min(cuv, 1.0 - cuv);
      float on = smoothstep(0.0, 0.06, min(edge.x, edge.y));
      if (on > 0.0) {
        vec4 cl = texture(uClouds, clamp(cuv, 0.0, 1.0));
        sky = mix(sky, sky * (1.0 - cl.a) + cl.rgb, on);
      }
    }
    // Reflection pass: everything in view mirrored (far shores, the Moon and planets, the Sun's glare, the
    // clouds). For a flat sea a distant thing's reflection lies along the mirrored ray, so the frame drawn so far
    // is read where that ray points on screen.
    if (uRefl > 0.5 && R.z < 0.0) {
      vec2 suv = (R.xy / -R.z) / uTan * 0.5 + 0.5;
      vec2 ed = min(suv, 1.0 - suv);
      ssrA = smoothstep(0.0, 0.15, min(ed.x, ed.y));
      if (ssrA > 0.0) sky = texture(uSceneTex, clamp(suv, 0.0, 1.0)).rgb;
    }
    float fres = 0.02 + 0.98 * pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 5.0);
    // Light scattered back up from inside the water: deep blue-green (open ocean reflects ~5-7%).
    vec3 deep = vec3(0.012, 0.05, 0.075) * (sunC * max(dot(uUpV, uL0), 0.0) + uAmb);
    col = mix(deep, sky, fres);
    // Sun glitter: the sun's reflection broken up by the waves.
    vec3 Hh = normalize(uL0 + V);
    col += sunC * pow(max(dot(N, Hh), 0.0), 600.0) * 6.0 * step(0.0, dot(uUpV, uL0));
    if (frozen > 0.0) {
      vec3 iceCol = vec3(0.8, 0.86, 0.92) * (0.85 + 0.15 * vnoise(vec3(q / 7.0, 1.0)));
      vec3 Ni = uUpV;
      col = mix(col, iceCol * (sunC * max(dot(Ni, uL0), 0.0) + uAmb), frozen);
      ssrA *= 1.0 - frozen;
    }
  } else {
    // Geometric normal of the mesh plus fine relief computed per pixel.
    vec3 Ng = normalize(vNrm);
    float rough = clamp(mtnBig * 1.5 + 0.15, 0.0, 1.0);
    // Fine relief below the mesh spacing, as shading only.
    float meshRes = 0.1 * dist + 0.05, pr = max(res * 1.5, 0.02);
    float h0 = fineDetail(vPlanar, rough, res, meshRes);
    float hx = fineDetail(vPlanar + vec2(pr, 0.0), rough, res, meshRes), hy = fineDetail(vPlanar + vec2(0.0, pr), rough, res, meshRes);
    N = normalize(Ng - (uEastV * (hx - h0) + uNorthV * (hy - h0)) / pr);
    float slope = 1.0 - clamp(dot(N, uUpV), 0.0, 1.0);
    // Ground cover, by the same rules as the globe: deserts in the subtropics, vegetation where it is
    // warm and wet, bare rock on steep slopes, snow where it is cold.
    vec3 q3 = vDir * 1.7 + uSeed;
    float desert = exp(-pow(lat - 0.45, 2.0) / 0.012);
    float moist = fbm(q3 * 1.3 + 31.0, 4) + 0.18 * exp(-lat * lat / 0.02) - 0.3 * desert;
    vec2 pp = vPlanar + uLocal;
    float n1 = vnoise(vec3(pp / 37.0, 4.0)), n2 = vnoise(vec3(pp / 4.1, 5.0)), n3 = vnoise(vec3(pp / 0.45, 6.0));
    float nf2 = smoothstep(res * 3.0, res * 8.0, 4.1), nf3 = smoothstep(res * 3.0, res * 8.0, 0.45);
    float tex = 0.75 + 0.3 * n1 + 0.22 * (n2 - 0.5) * nf2 + 0.18 * (n3 - 0.5) * nf3;
    vec3 soil = mix(uColA, uColB, smoothstep(0.3, 0.7, fbm(q3 * 2.4 + 7.0, 4) * 0.6 + n1 * 0.4));
    soil = mix(soil, soil * vec3(1.15, 1.0, 0.8), desert * 0.5);
    vec3 rock = mix(vec3(0.33, 0.31, 0.29), uColB * 0.85, uOcean > 0.0 ? 0.35 : 0.75) * (0.8 + 0.4 * n2);
    col = soil;
    if (uMapMode > 2.5 && uMapMode < 3.5) col *= 0.6 + 0.8 * mapTex(uMap, vDir).r;
    // Colour map: the ground takes the colour seen from orbit, varied by the local soil pattern.
    if (uDayK > 0.0) { soil = mix(soil, mapTex(uDay, vDir).rgb * (0.75 + 0.5 * n1), uDayK * 0.85); col = soil; }
    if (uDonorK > 0.0) { float t = donorT(vDir); soil *= mix(1.0, clamp(t, 0.2, 2.0), uDonorK * 0.8); rock *= mix(1.0, clamp(t, 0.4, 1.6), uDonorK * 0.5); col = soil; }
    if (uMapMode > 4.5 && uMapMode < 8.5) { vec3 mc = mapTex(uMap, vDir).rgb; if (uMapMode > 6.5) { float t = 2.0 * mc.r; mc = mix(uColB, uColA, clamp(t, 0.0, 1.0)) * t; } soil = mc * (soil / max(dot(mix(uColA, uColB, 0.5), vec3(0.333)), 0.05)) * 0.5 + mc * 0.5; rock = mix(rock, mc * 0.75, 0.6); col = soil; }
    if (uLife > 0.0) {
      float warm = smoothstep(255.0, 280.0, T) * smoothstep(335.0, 305.0, T);
      float veg = uLife * warm * smoothstep(0.36, 0.56, moist) * (1.0 - smoothstep(0.35, 0.6, slope));
      // Patchy: meadows, shrubs and darker woods.
      float clump = smoothstep(0.35, 0.65, vnoise(vec3(pp / 140.0, 8.0)) * 0.7 + n1 * 0.3);
      // Real vegetation is darker and less saturated than it looks in memory: olive grasses, darker
      // woods, dry patches.
      vec3 vg = mix(uVeg, vec3(dot(uVeg, vec3(0.33))) * vec3(1.05, 1.0, 0.7), 0.35);
      vec3 vc = mix(vg * 0.95, vg * 0.45, clump) * (0.75 + 0.45 * n2);
      vc = mix(vc, vec3(0.5, 0.45, 0.3), smoothstep(0.6, 0.85, vnoise(vec3(pp / 60.0, 12.0))) * 0.35);
      col = mix(col, vc, veg);
    }
    // Sedimentary strata: on steep rock, level bands of lighter, darker and ochre layers by height (seen from
    // kilometres away on cliffs and ranges), slightly wavy, finer bands within thicker ones.
    float hb = H + 18.0 * (vnoise(vec3(pp / 900.0, 41.0)) - 0.5);
    float band1 = sin(hb * 0.045 + 1.3 * vnoise(vec3(pp / 3000.0, 42.0))), band2 = sin(hb * 0.19 + 0.7);
    vec3 strataC = rock * (1.0 + 0.22 * band1 + 0.08 * band2 * smoothstep(res * 3.0, res * 10.0, 30.0));
    strataC = mix(strataC, strataC * vec3(1.18, 1.0, 0.78), smoothstep(0.55, 0.9, band1) * 0.6);   // ochre layers
    strataC = mix(strataC, vec3(dot(strataC, vec3(0.33))) * 1.25, smoothstep(-0.6, -0.95, band1) * 0.5);   // pale layers
    rock = mix(rock, strataC, smoothstep(0.0, 0.6, rough + 0.3));
    col = mix(col, rock, smoothstep(0.35, 0.6, slope + 0.2 * rough * n1));
    // Sand and dust collect in hollows on dry worlds.
    if (uOcean <= 0.0) col = mix(col, uColA * 1.08, smoothstep(0.45, 0.28, vnoise(vec3(pp / 220.0, 9.0))) * (1.0 - slope) * 0.6);
    // Beaches just above the waterline.
    if (uSeaOK > 0.5) col = mix(col, vec3(0.72, 0.65, 0.5), smoothstep(6.0, 1.0, H) * (1.0 - slope));
    // Snow: cold enough, and only on gentler slopes.
    // Snow: polar caps where the globe has them; on worlds with liquid water also wherever it is cold
    // enough (high peaks, winter latitudes).
    float cap = smoothstep(uSnowLat, uSnowLat + 0.05, lat + 0.03 * (n1 - 0.5)) * uIce;
    float cold = uSeaOK > 0.5 ? smoothstep(271.0, 262.0, T + 6.0 * (n1 - 0.5)) : 0.0;
    // Near the snow line, patches linger in hollows and on shaded ground instead of a uniform blanket.
    float hollow = smoothstep(0.55, 0.35, vnoise(vec3(pp / 90.0, 43.0)) * 0.7 + n1 * 0.3);
    float coolish = uSeaOK > 0.5 ? smoothstep(279.0, 271.0, T + 4.0 * (n1 - 0.5)) : 0.0;
    float snow = max(max(cap, cold), coolish * hollow * 0.95) * (1.0 - smoothstep(0.45, 0.7, slope));
    col = mix(col, vec3(0.9, 0.93, 0.97), snow);
    col *= tex;
    // Ground detail within a few hundred metres: what the material looks like underfoot, tinted by the colour
    // the ground already has (so it still matches the map). Rock: layered strata and fractures; soil: pebbles
    // and grit; sand: wind ripples. Each fades out where its pattern gets finer than a pixel.
    float near = 1.0 - smoothstep(60.0, 260.0, dist);
    if (near > 0.0) {
      float isRock = smoothstep(0.3, 0.55, slope + 0.2 * rough * n1) * (1.0 - snow);
      float isSand = (uOcean <= 0.0 ? 0.6 * uDunes : 0.0) + (uSeaOK > 0.5 ? smoothstep(6.0, 1.0, H) : 0.0) + desert * 0.6 * uDunes;
      isSand = clamp(isSand, 0.0, 1.0) * (1.0 - isRock) * (1.0 - snow);
      float isSoil = (1.0 - isRock) * (1.0 - isSand) * (1.0 - snow);
      // Rock: strata (bands along a tilted plane through the slope) broken by fractures.
      // (Strata are level bands: by height alone, varied a little along the ground; rings only where the
      // slope is gentle, and rock lies only on steep ground.)
      float strata = 0.5 + 0.35 * sin(H * 2.1 + 2.0 * vnoise(vec3(pp / 25.0, 21.0))) * smoothstep(res * 3.0, res * 9.0, 1.5)
                   + 0.15 * (vnoise(vec3(pp * 1.3, 22.0)) - 0.5);
      float frac = 1.0 - smoothstep(0.0, 0.05, abs(vnoise(vec3(pp / 3.0, 23.0)) - 0.5)) * smoothstep(res * 3.0, res * 9.0, 3.0);
      float rockD = (0.82 + 0.36 * strata) * (1.0 - 0.45 * (1.0 - frac));
      // Soil: grit, and pebbles where a cell's random stone is close.
      vec2 cp = pp / 0.35, ci = floor(cp), cf2 = fract(cp) - 0.5;
      float ph = hash(vec3(ci, 31.0)), pr = length(cf2 - (vec2(hash(vec3(ci, 32.0)), hash(vec3(ci, 33.0))) - 0.5) * 0.5);
      float pebble = step(0.72, ph) * (1.0 - smoothstep(0.12, 0.2, pr)) * smoothstep(res * 2.0, res * 6.0, 0.35);
      float grit = (vnoise(vec3(pp / 0.08, 34.0)) - 0.5) * smoothstep(res * 2.0, res * 6.0, 0.08);
      float soilD = (1.0 + 0.25 * grit) * (1.0 + 0.3 * pebble * (ph - 0.86) * 6.0);
      // Sand: ripples across the wind, with a little meander.
      float rip = sin((pp.x * 0.92 + pp.y * 0.38) * 9.0 + 3.0 * vnoise(vec3(pp / 6.0, 35.0)));
      float sandD = 1.0 + 0.12 * rip * smoothstep(res * 2.0, res * 6.0, 0.7);
      float detail = isRock * rockD + isSoil * soilD + isSand * sandD + snow;
      col *= mix(1.0, detail, near);
    }
    // Lambert with a little wrap, sky light from above, and the planet's own heat when molten.
    float ndl = max(dot(N, uL0), 0.0);
    col = col * (sunC * ndl + uAmb * (0.55 + 0.45 * dot(N, uUpV)));
    float hot = smoothstep(800.0, 1500.0, T);
    if (hot > 0.0) {
      float flow = fbm(vec3(pp / 60.0, uTime * 0.02), 4);
      float lava = smoothstep(0.55 - 0.2 * hot, 0.6 - 0.2 * hot, flow);
      vec3 glowC = mix(vec3(1.0, 0.25, 0.03), vec3(1.0, 0.75, 0.3), smoothstep(0.6, 0.8, flow));
      col = mix(col, col * 0.3, hot) + glowC * lava * hot * 1.6;
    }
  }
  // Aerial perspective: light scattered into the line of sight hides distant ground in the colour of the
  // horizon sky; the haze thins with height.
  float hAvg = max(0.0, H) * 0.5;
  vec3 Tr = exp(-uFogExt * dist * exp(-hAvg / max(uFogH, 1.0)));
  vec3 Vh = -V - uUpV * dot(-V, uUpV), Lh = uL0 - uUpV * dot(uL0, uUpV);
  float az = dot(Vh, Vh) > 1e-8 && dot(Lh, Lh) > 1e-8 ? dot(normalize(Vh), normalize(Lh)) : 0.0;
  vec3 fog = mix(uFogAnti, uFogSun, az * 0.5 + 0.5);
  col = col * Tr + fog * (1.0 - Tr);
  // Humid haze (water droplets, aerosols): grey, so distant hills fade into the horizon's own colour.
  float hx = max(H, 0.0);
  float tH = exp(-layerDepth(uHaze.x, uHaze.y, 0.0, vEyeAlt, hx, dist));
  col = col * tH + fog * (1.0 - tH);
  // Valley mist: pooled in the low ground (below the regional surface), at the far end of the view and around
  // the eye if it stands in a valley; white-grey in sunlight, glowing toward the Sun (droplets scatter
  // forward), dim in the shade of night.
  if (uHaze.z > 0.0) {
    float inMist = 0.5 * (vValley.x + vValley.y);
    float tM = exp(-uHaze.z * min(dist, 30000.0) * inMist);
    float cosS = dot(-V, uL0);
    float glow = 0.5 + 1.2 * pow(max(cosS, 0.0), 8.0);
    vec3 mist = mix(fog, vec3(dot(fog, vec3(0.33))), 0.5) * 1.05 + uSunCol * glow * 0.12 + uAmb * 0.2;
    col = col * tM + mist * (1.0 - tM);
  }
  if (uRefl > 0.5) {
    if (ssrA <= 0.0) discard;
    outColor = vec4(max(col, 0.0), ssrA);
  } else
  outColor = vec4(max(col, 0.0), 1.0);
  ` + WRITE_DEPTH + `
}
`;

// Atmospheric scattering shared by the surface sky and the atmosphere seen from space. Units are planet
// radii; coefficients come from the gas mix (js/optics.js), so the colour of a sky follows from what is
// in the air. Single scattering is ray-marched, with sunlight attenuated along its path using
// Schüler's approximation of the Chapman grazing-incidence function (GPU Pro 3, 2012). Light scattered
// more than once is added with a two-stream estimate: diffuse light at a height falls as
// exp(−kτ)/(1 + ¾(1−g)τ) with k = √(3(1−ω)(1−ωg)). This is what keeps thick hazes like Venus's and
// Titan's glowing instead of black.
const SCATTER = `
uniform vec3 uBR, uBM, uBA, uBMa;  // Rayleigh scattering, Mie scattering, gas and aerosol absorption (per radius)
uniform float uHR, uHM;            // scale heights (radii)
uniform vec3 uG;                   // Mie asymmetry per channel
uniform vec3 uTauS;                // vertical scattering optical depth of the whole column
uniform float uTop;                // atmosphere top radius
uniform int uSteps;                // ray-march samples (fewer from space, where the shell is small)
uniform vec4 uDet;                 // a detached haze layer: height, half-width (radii), scattering (per radius, green), 0 = none
const float PI = 3.14159265;
// Optical depth (in scale heights, relative to surface density) from radius r (in units of H: x),
// in direction with cosine mu to the local vertical, out to infinity.
float chapUp(float x, float mu) {
  float c = sqrt(1.5708 * x);
  return c / ((c - 1.0) * mu + 1.0);
}
float chap(float X, float x, float mu) {
  float h = x - X;
  if (mu >= 0.0) return chapUp(x, mu) * exp(-h);
  float x0 = sqrt(max(0.0, 1.0 - mu * mu)) * x;
  return 2.0 * sqrt(1.5708 * x0) * exp(X - x0) - chapUp(x, -mu) * exp(-h);
}
vec3 tauToSun(float r, float mu) {
  if (mu < 0.0 && r * sqrt(max(0.0, 1.0 - mu * mu)) < 1.0) return vec3(1e4);
  float cR = uHR * chap(1.0 / uHR, r / uHR, mu);
  float cM = uHM * chap(1.0 / uHM, r / uHM, mu);
  return (uBR + uBA) * cR + (uBM + uBMa) * cM;
}
float phaseR(float c) { return 0.0596831 * (1.0 + c * c); }
vec3 phaseM(float c) {
  vec3 g2 = uG * uG;
  return 0.1193662 * (1.0 - g2) * (1.0 + c * c) / ((2.0 + g2) * pow(max(1.0 + g2 - 2.0 * uG * c, vec3(1e-4)), vec3(1.5)));
}
// In-scattered light along o + d·t, t in [0, tMax], sunlight from direction sun (irradiance 1).
// Samples cluster toward t = 0 when bias > 1. T returns the transmittance of the whole segment.
vec3 scatter(vec3 o, vec3 d, float tMax, vec3 sun, float bias, out vec3 T) {
  const int NMAX = 24;
  int N = clamp(uSteps, 4, NMAX);
  float c = dot(d, sun);
  float pR = phaseR(c);
  vec3 pM = phaseM(c);
  vec3 L = vec3(0.0);
  vec3 tau = vec3(0.0);
  float tPrev = 0.0;
  for (int i = 0; i < NMAX; i++) {
    if (i >= N) break;
    float s = (float(i) + 1.0) / float(N);
    float t1 = tMax * pow(s, bias);
    float dt = t1 - tPrev;
    vec3 p = o + d * (tPrev + 0.5 * dt);
    tPrev = t1;
    float r = length(p);
    float h = max(r - 1.0, 0.0);
    float rhoR = exp(-h / uHR), rhoM = exp(-h / uHM);
    vec3 sR = uBR * rhoR, sM = uBM * rhoM;
    // Titan's detached haze (Cassini): a thin shell of fine particles far above the main haze, scattering
    // blue more than red; added to the molecular scattering (same phase function).
    if (uDet.w > 0.0) { float z = (h - uDet.x) / uDet.y; sR += uDet.z * vec3(0.42, 0.64, 1.0) * exp(-z * z); }
    vec3 ext = sR + sM + uBA * rhoR + uBMa * rhoM;
    float mu0 = dot(p, sun) / r;
    vec3 Ts = exp(-tauToSun(r, mu0));
    // Diffuse light at this height from the column above it.
    vec3 tS = uBR * uHR * rhoR + uBM * uHM * rhoM;
    vec3 tE = tS + uBA * uHR * rhoR + uBMa * uHM * rhoM;
    // Clamped: on GPUs that divide approximately (Apple's), x/x can come out a hair above 1, and the
    // square roots below would then return NaN.
    vec3 w = clamp(tS / max(tE, vec3(1e-9)), 0.0, 1.0);
    vec3 gE = clamp(uBM * uHM * rhoM * uG / max(tS, vec3(1e-9)), 0.0, 0.99);
    vec3 k = sqrt(max(3.0 * (1.0 - w) * (1.0 - w * gE), vec3(0.0)));
    vec3 Td = exp(-k * tE) / (1.0 + 0.75 * (1.0 - gE) * tS);
    float twi = max(mu0 + 0.08, 0.0) / 1.08;            // diffuse light lingers just after sunset
    // Absorption between scatterings tints multiply scattered light: two-stream albedo (1−s)/(1+s).
    vec3 sa = sqrt(max(1.0 - w, 0.0) / max(1.0 - w * gE, vec3(1e-4)));
    vec3 ms = (sR + sM) * (1.0 - exp(-uTauS)) * Td * (1.0 - sa) / (1.0 + sa) * twi * (0.5 / PI);
    vec3 S = sR * pR * Ts + sM * pM * Ts + ms;
    vec3 stepT = exp(-ext * dt);
    // Energy-conserving step (scattering integrated over the step's own extinction).
    L += exp(-tau) * S * (1.0 - stepT) / max(ext, vec3(1e-9));
    tau += ext * dt;
  }
  T = exp(-tau);
  return L;
}
// The sky's exposure: compressed by the brightest channel (hue kept) into the screen's range, as a camera's
// sky would be; only light far past white (the glow close around the Sun, ~3x and up) passes its excess on, so
// bloom and the composite's tone curve (TONEMAP) see a real highlight there.
vec3 skyTone(vec3 x) {
  float m = max(max(x.r, x.g), max(x.b, 1e-9));
  vec3 t = x * (1.0 - exp(-m)) / m;
  float e = max(m - 3.0, 0.0);
  return t * (1.0 + 0.12 * e * e / (e + 2.0));   // (starts with zero slope: no visible edge where it begins)
}
// Distance along o + d·t to a sphere of radius R (far root if inside, near if outside); -1 if missed.
vec2 sphereHit(vec3 o, vec3 d, float R) {
  float b = dot(o, d), c = dot(o, o) - R * R, D = b * b - c;
  if (D < 0.0) return vec2(-1.0);
  float q = sqrt(D);
  return vec2(-b - q, -b + q);
}
`;

// Atmosphere seen from space: the shell is a sphere at the top of the atmosphere, drawn from the inside
// (back faces), so each pixel marches the path through the air in front of it. In-scattered light is
// added and the planet behind is dimmed by the path's transmittance: the blue limb of Earth, Mars's thin
// dusty rim, the opaque yellow haze of Venus and orange of Titan all come out of the same equations.
export const ATMO_FS = HEAD + `
in vec3 vObj;
in vec3 vViewPos;
in vec3 vN;
` + LOGDEPTH_F + SCATTER + `
uniform vec3 uL0;
uniform vec3 uCenterV;   // planet centre relative to the eye, view axes
uniform float uPR;       // planet radius
uniform float uExpo;
uniform vec3 uHot;       // thermal glow of a molten world's air
uniform float uDiscK;    // share drawn over the planet's face (1; giant planets less, see below)
uniform vec4 uGlow;      // night airglow: colour at its brightest (seen edge-on), layer height (radii); 0 = none
uniform float uGlowW;    // the layer's half-thickness (radii)
out vec4 outColor;
// Length of o + d·t, t in [ta, tb], that lies within the spherical shell between radii r0 and r1.
float shellPath(vec3 o, vec3 d, float ta, float tb, float r0, float r1) {
  vec2 out1 = sphereHit(o, d, r1);
  if (out1.y <= ta) return 0.0;
  float a = max(out1.x, ta), b = min(out1.y, tb);
  if (b <= a) return 0.0;
  float len = b - a;
  vec2 in0 = sphereHit(o, d, r0);
  if (in0.y > in0.x) len -= max(0.0, min(in0.y, b) - max(in0.x, a));
  return max(len, 0.0);
}
void main() {
  vec3 d = normalize(vViewPos);
  vec3 o = -uCenterV / uPR;
  vec2 ground = sphereHit(o, d, 1.0);
  bool hit = ground.x > 0.0;
  vec3 col = vec3(0.0);
  float a = 0.0;
  vec2 top = sphereHit(o, d, uTop);
  if (top.y > 0.0) {
    float t0 = max(top.x, 0.0);
    float t1 = hit ? ground.x : top.y;
    vec3 T;
    vec3 L = scatter(o + d * t0, d, t1 - t0, uL0, 1.0, T);
    col = skyTone(max(L, 0.0) * uExpo);
    a = clamp(1.0 - dot(T, vec3(0.3333)), 0.0, 1.0);
    // Over a giant planet's face its photo-based colours already show the haze: only part of it again there.
    if (hit) { col *= uDiscK; a *= uDiscK; }
    col += uHot * a;
  }
  if (uGlow.w > 0.0) {
    // A thin glowing shell (it may lie above the scattering air), as bright as the path through it is long,
    // scaled so the grazing path, the limb, gives uGlow; only where that air is in darkness (by day the sky
    // outshines it).
    float r0 = 1.0 + uGlow.w - uGlowW, r1 = 1.0 + uGlow.w + uGlowW, tb = hit ? ground.x : 1e9;
    float len = shellPath(o, d, 0.0, tb, r0, r1);
    if (len > 0.0) {
      vec3 pm = o + d * clamp(-dot(o, d), 0.0, tb);
      float dark = 1.0 - smoothstep(-0.2, 0.05, dot(normalize(pm), uL0));
      col += uGlow.rgb * dark * len / (2.0 * sqrt(r1 * r1 - r0 * r0));
    }
  }
  if (a <= 0.0 && dot(col, col) <= 0.0) discard;
  outColor = vec4(col, hit ? min(a, 0.92) : a * 0.5);
  ` + WRITE_DEPTH + `
}
`;

// Legacy rim glow for giant planets (no surface to stand on; their colour comes from the body shader).
export const RIM_FS = HEAD + `
in vec3 vObj;
in vec3 vViewPos;
in vec3 vN;
` + LOGDEPTH_F + `
uniform vec3 uAtmo, uL0;
uniform float uAtmoK;
out vec4 outColor;
void main() {
  vec3 V = normalize(-vViewPos);
  vec3 N = normalize(vN);
  float rim = pow(clamp(1.0 - abs(dot(N, V)), 0.0, 1.0), 3.0);
  float lit = clamp(dot(N, uL0) + 0.35, 0.0, 1.0);
  outColor = vec4(uAtmo * uAtmoK * rim * lit * 1.3, 0.0);
  ` + WRITE_DEPTH + `
}
`;

// Camera-facing quads for glows, the photon ring and pulsar beams.
export const SPRITE_VS = HEAD + `
layout(location = 0) in vec2 aCorner;
uniform mat4 uProj;
uniform vec3 uCenter;   // view space
uniform float uSize;    // half-size, view units
uniform float uAngle;
out vec2 vC;
` + LOGDEPTH_V + `
void main() {
  vC = aCorner;
  float c = cos(uAngle), s = sin(uAngle);
  vec2 r = vec2(c * aCorner.x - s * aCorner.y, s * aCorner.x + c * aCorner.y);
  vec3 p = uCenter + vec3(r * uSize, 0.0);
  gl_Position = uProj * vec4(p, 1.0);
  vFragDepth = 1.0 + gl_Position.w * ` + DEPTH_K + `;
}
`;

export const SPRITE_FS = HEAD + `
in vec2 vC;
` + LOGDEPTH_F + `
uniform vec3 uColor;
uniform int uType;      // 0 star glow, 1 soft bulge, 2 photon ring, 3 pulsar beam, 4 lensed disk, 5 dot
uniform float uInner;
out vec4 outColor;
void main() {
  float r = length(vC);
  float a = 0.0;
  if (uType == 0) {
    a = exp(-r * r * 9.0) * 0.9 + 0.08 / (1.0 + r * r * 60.0);
    a += (max(0.0, 1.0 - abs(vC.y) * 70.0) + max(0.0, 1.0 - abs(vC.x) * 70.0)) * (1.0 - r) * 0.18 * uInner;
  } else if (uType == 1) {
    a = exp(-r * r * 5.0) * 0.8;
  } else if (uType == 2) {
    a = exp(-pow((r - uInner) / 0.05, 2.0)) * 0.9 + exp(-pow((r - uInner) / 0.25, 2.0)) * 0.25;
  } else if (uType == 4) {
    // Gravitationally lensed image of the accretion disk: light from the far side of the disk is bent
    // over and under the shadow, so an edge-on disk shows bright arcs above and below the black hole
    // (as in Luminet 1979 and the Interstellar renders), plus a thin photon ring at the shadow's edge.
    // vC.y points along the disk's projected axis; uInner = how edge-on the disk is (0 face-on, 1 edge-on).
    float cphi = abs(vC.y) / max(r, 1e-4);
    float arc = exp(-pow((r - 0.36) / (0.05 + 0.05 * cphi), 2.0)) * (0.35 + 0.9 * pow(cphi, 1.2) * uInner + 0.5 * (1.0 - uInner));
    float photon = exp(-pow((r - 0.265) / 0.012, 2.0)) * 0.9;
    a = arc * 0.85 + photon;
  } else if (uType == 5) {
    a = 1.0 - smoothstep(0.55, 1.0, r);   // a world too small to show its disc: a plain lit dot
  } else {
    a = exp(-vC.y * vC.y * 500.0) * (1.0 - abs(vC.x)) * 0.5;
  }
  if (r > 1.0 && uType != 3) discard;
  outColor = vec4(uColor * a, 1.0);
  ` + WRITE_DEPTH + `
}
`;

// Accretion disk: a flat annulus in the black hole's equatorial plane, with Doppler beaming.
export const DISK_VS = HEAD + `
layout(location = 0) in vec2 aCorner;
uniform mat4 uProj;
uniform vec3 uCenter, uAxU, uAxV;  // view space; axes scaled to the outer radius
out vec2 vC;
out vec3 vViewPos;
` + LOGDEPTH_V + `
void main() {
  vC = aCorner;
  vViewPos = uCenter + aCorner.x * uAxU + aCorner.y * uAxV;
  gl_Position = uProj * vec4(vViewPos, 1.0);
  vFragDepth = 1.0 + gl_Position.w * ` + DEPTH_K + `;
}
`;

// Planetary rings as a smooth sheet. Radial structure: the opacity profile measured from the ring
// particles (so the Cassini Division and other gaps are where the particles are), plus fine ringlets.
// Lit side: Lommel-Seeliger reflection, I ∝ μ₀/(μ₀ + μ), as for an optically thick particle layer; seen
// from the unlit side the rings glow faintly by light diffusing through them. The planet's shadow falls
// across them.
export const RING_FS = HEAD + NOISE + `
in vec2 vC;
in vec3 vViewPos;
` + LOGDEPTH_F + `
uniform vec3 uNv, uL0, uPlanetV, uLight;   // ring normal, sun direction, planet centre (view space), sunlight
uniform float uRin, uPR;                    // inner radius / outer radius; planet radius (AU)
uniform float uProf[16];
uniform vec3 uTint;
uniform float uSaturn;                      // 1: Saturn's C/B/A ring colours
uniform vec4 uMoonS[4];                     // the biggest moons nearby: centre (view space), radius
uniform float uChunkPx;                     // with GPU ring chunks: their mean radius × focal length / pixel ratio
uniform int uMoonN;
out vec4 outColor;
// Shadows of moons on the rings: a moon between the point and the Sun, softened over the penumbra the Sun's
// disc gives (~0.0005 rad at Saturn). They show near equinox, when they stretch long across the rings.
float moonShadow(vec3 p, vec3 L) {
  float s = 1.0;
  for (int i = 0; i < 4; i++) {
    if (i >= uMoonN) break;
    vec3 rel = uMoonS[i].xyz - p;
    float b = dot(rel, L);
    if (b <= 0.0) continue;
    float pen = 0.0005 * b + 0.02 * uMoonS[i].w;
    s *= smoothstep(uMoonS[i].w - pen, uMoonS[i].w + pen, length(rel - L * b));
  }
  return s;
}
void main() {
  float r = length(vC);
  if (r > 1.0 || r < uRin) discard;
  float f = (r - uRin) / (1.0 - uRin);
  float fi = f * 16.0 - 0.5;
  int i0 = int(clamp(floor(fi), 0.0, 15.0)), i1 = min(i0 + 1, 15);
  float op = mix(uProf[i0], uProf[i1], clamp(fi - floor(fi), 0.0, 1.0));
  // Ringlets: many narrow bands of slightly different density.
  op *= 0.75 + 0.25 * vnoise(vec3(f * 260.0, 0.5, 0.0)) + 0.1 * (vnoise(vec3(f * 900.0, 1.5, 0.0)) - 0.5);
  op *= smoothstep(0.0, 0.01, f) * smoothstep(1.0, 0.99, f);
  // Alongside the GPU chunks the sheet shows only where they are too big on screen and fade (gpu.js).
  if (uChunkPx > 0.0) op *= smoothstep(3.0, 8.0, uChunkPx / max(-vViewPos.z, 1e-30));
  vec3 col = uTint;
  if (uSaturn > 0.5) {
    // C ring dusky grey, B ring bright and slightly warm, A ring a little darker.
    col = mix(vec3(0.5, 0.47, 0.44), vec3(0.88, 0.8, 0.66), smoothstep(0.18, 0.28, f));
    col = mix(col, vec3(0.78, 0.72, 0.62), smoothstep(0.62, 0.7, f));
    op = clamp(op * mix(0.45, 1.25, smoothstep(0.18, 0.3, f)), 0.0, 0.97);
  }
  vec3 V = normalize(-vViewPos);
  float mu0 = abs(dot(uNv, uL0)), mu = abs(dot(uNv, V));
  bool litSide = dot(uNv, uL0) * dot(uNv, V) > 0.0;
  float I = litSide ? 2.0 * mu0 / (mu0 + mu + 1e-3) : 0.5 * (1.0 - op) * (0.4 + 1.6 * pow(max(dot(-V, uL0), 0.0), 6.0));
  // The planet's shadow.
  vec3 pc = vViewPos - uPlanetV;
  float b = dot(pc, uL0), c = dot(pc, pc) - uPR * uPR;
  float sh = (b < 0.0 && b * b - c > 0.0) ? 1.0 : 0.0;
  if (uMoonN > 0) sh = max(sh, 1.0 - moonShadow(vViewPos, uL0));
  vec3 lit = col * uLight * I * (1.0 - sh) * 0.95 + col * 0.006;
  outColor = vec4(lit * op, op);
  ` + WRITE_DEPTH + `
}
`;

export const DISK_FS = HEAD + NOISE + `
in vec2 vC;
in vec3 vViewPos;
` + LOGDEPTH_F + `
uniform vec3 uAxU, uAxV;
uniform float uInner, uTime, uHeat;
out vec4 outColor;
void main() {
  float r = length(vC);
  if (r > 1.0 || r < uInner) discard;
  float ang = atan(vC.y, vC.x);
  float t = 1.0 - (r - uInner) / (1.0 - uInner);
  float swirl = vnoise(vec3(r * 16.0, ang * 3.0 + uTime * 1.5 / (r * r + 0.05), 0.0));
  float swirl2 = vnoise(vec3(r * 40.0, ang * 7.0 + uTime * 2.2 / (r * r + 0.05), 3.0));
  // Relativistic beaming: gas orbits at β = √(r_s / 2(r − r_s)) (half light speed at the innermost stable
  // orbit, 3 r_s, taken as the inner edge). Seen with Doppler factor δ = √(1−β²)/(1 − β cosθ), intensity
  // scales as δ⁴ and colour temperature as δ: the approaching side is brighter and bluer, the receding
  // side dim and red. Gravitational redshift √(1 − 1.5 r_s/r) dims the innermost ring further.
  float rs = 3.0 * r / uInner;
  float beta = sqrt(0.5 / max(rs - 1.0, 0.5));
  vec3 tang = normalize(-sin(ang) * normalize(uAxU) + cos(ang) * normalize(uAxV));
  float delta = sqrt(1.0 - beta * beta) / (1.0 - beta * dot(tang, normalize(-vViewPos)));
  float grav = sqrt(max(1.0 - 1.5 / rs, 0.05));
  float shift = delta * grav;
  vec3 hotc = mix(vec3(0.95, 0.38, 0.1), vec3(1.0, 0.94, 0.82), clamp(pow(t, 1.4) * shift, 0.0, 1.0));
  hotc = mix(hotc, vec3(0.75, 0.85, 1.0), clamp((shift - 1.15) * 0.8, 0.0, 0.6));
  float beam = pow(shift, 3.5) * 0.7;
  float I = pow(t, 1.3) * (0.45 + 0.4 * swirl + 0.25 * swirl2) * (0.3 + 0.7 * clamp(uHeat, 0.0, 1.0)) * beam;
  I *= smoothstep(uInner, uInner + 0.06, r) * smoothstep(1.0, 0.8, r);
  outColor = vec4(hotc * I * 1.2, 1.0);
  ` + WRITE_DEPTH + `
}
`;

// Particles: solid, sunlit rock and ice chunks (rings, belts, debris), or additive glowing points (stars, hot gas).
export const POINTS_VS = HEAD + `
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aCol;
layout(location = 2) in float aSize;   // world radius
layout(location = 3) in float aShade;  // 0 in a planet's shadow, 1 in sunlight
uniform mat4 uProj;
uniform mat3 uView;
uniform float uF, uMinPx, uMaxPx;
out vec3 vCol;
out float vShade;
out float vPx;
flat out float vSeed;
out float vW, vDepthR;  // clip w, and the rock's radius in the same units (for its depth relief)
` + LOGDEPTH_V + `
void main() {
  vec3 vp = uView * aPos;
  gl_Position = uProj * vec4(vp, 1.0);
  float px = 2.0 * aSize * uF / max(-vp.z, 1e-30);
  vPx = px;
  gl_PointSize = clamp(px, uMinPx, uMaxPx);
  vCol = aCol;
  vShade = aShade;
  vSeed = fract(float(gl_VertexID) * 0.6180339887) * 97.0;
  vW = gl_Position.w;
  vDepthR = aSize * min(1.0, gl_PointSize / max(px, 1e-6));
  vFragDepth = 1.0 + gl_Position.w * ` + DEPTH_K + `;
}
`;

export const POINTS_FS = HEAD + NOISE + `
in vec3 vCol;
in float vShade;
in float vPx;
flat in float vSeed;
in float vW, vDepthR;
` + LOGDEPTH_F + `
uniform int uGlow;
uniform vec3 uLight;   // view space
out vec4 outColor;
void main() {
  vec2 pc = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(pc, pc);
  if (uGlow == 1) {
    if (r2 > 1.0) discard;
    outColor = vec4(vCol * exp(-r2 * 2.5), 1.0);
    ` + WRITE_DEPTH + `
    return;
  }
  if (vPx < 5.0) {
    // Too small to show a shape: a dot.
    if (r2 > 1.0) discard;
    outColor = vec4(vCol * 0.75 * mix(0.12, 1.0, vShade), 1.0);
    ` + WRITE_DEPTH + `
    return;
  }
  // A rock: each particle its own elongation, orientation and lumpy outline (from its seed), with
  // bumps and pits on its surface and its own depth relief, so neighbours cut into each other in 3D.
  float s = vSeed;
  float ang = hash(vec3(s, 1.0, 2.0)) * 6.2831853, el = 0.55 + 0.45 * hash(vec3(s, 3.0, 4.0));
  vec2 q = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * pc;
  q.y /= el;
  float a = atan(q.y, q.x);
  float R = 0.82 + 0.1 * sin(a * 2.0 + s) + 0.06 * sin(a * 3.0 + s * 1.7) + 0.05 * sin(a * 5.0 + s * 2.3) + 0.04 * (vnoise(vec3(cos(a), sin(a), s) * 3.0) - 0.5);
  float rq = length(q) / R;
  if (rq > 1.0) discard;
  float h = sqrt(max(1.0 - rq * rq, 0.0));
  vec3 n = normalize(vec3(pc.x, -pc.y, h * 0.9 + 0.1));
  // Surface relief: knobs and small craters.
  vec3 sp = vec3(q * 2.2, s);
  float k1 = vnoise(sp * 1.0), k2 = vnoise(sp * 2.6 + 5.0), cr = crater(sp * 1.6 + 9.0);
  vec2 g = vec2(vnoise(sp + vec3(0.07, 0.0, 0.0)) - k1, vnoise(sp + vec3(0.0, 0.07, 0.0)) - k1) / 0.07;
  n = normalize(n + vec3(g.x, -g.y, 0.0) * 0.18 * h + vec3(q, 0.0) * 0.25 * smoothstep(0.35, 0.1, cr));
  float lit = 0.12 + 0.88 * max(dot(n, uLight), 0.0);
  float tone = (0.82 + 0.3 * hash(vec3(s, 7.0, 1.0))) * (0.9 + 0.2 * k2) * mix(0.75, 1.0, smoothstep(0.1, 0.3, cr));
  outColor = vec4(vCol * lit * tone * mix(0.12, 1.0, vShade), 1.0);
  // Depth: nearer where the rock bulges toward the viewer.
  float w = max(vW - h * vDepthR, vW * 0.5);
  gl_FragDepth = log2(1.0 + w * ` + DEPTH_K + `) * uLogDepthFC * 0.5;
}
`;

export const LINES_VS = HEAD + `
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aCol;
uniform mat4 uProj;
uniform mat3 uView;
out vec3 vCol;
` + LOGDEPTH_V + `
void main() {
  vCol = aCol;
  gl_Position = uProj * vec4(uView * aPos, 1.0);
  vFragDepth = 1.0 + gl_Position.w * ` + DEPTH_K + `;
}
`;

export const LINES_FS = HEAD + `
in vec3 vCol;
` + LOGDEPTH_F + `
out vec4 outColor;
void main() {
  outColor = vec4(vCol, 1.0);
  ` + WRITE_DEPTH + `
}
`;

// Background stars: directions only, drawn at infinity before everything else.
// Gravitational lensing of the background sky by black holes and neutron stars. Each lens is given by
// its direction from the eye, its Einstein angle² θE² = 2r_s/D (light from infinity passing at angle θ is
// bent by α = 4GM/(c²b) = θE²/θ), and its shadow radius θm = (3√3/2) r_s/D. Near the shadow the weak-field
// formula fails; there the strong-deflection limit takes over (Bozza 2002, Schwarzschild):
// α = −ln(θ/θm − 1) − 0.40, which diverges at the photon sphere, so light that loops round the hole
// paints a thin ring of the whole sky at the shadow's edge.
const LENS = `
uniform vec4 uLens[4];     // xyz: world direction to the lens; w: θE²
uniform float uLensSh[4];  // shadow (or surface) angular radius
uniform int uLensN;
float lensAngle(vec3 a, vec3 b) { return atan(length(cross(a, b)), dot(a, b)); } // accurate for tiny angles
float deflection(float th, float e2, float tm) {
  float x = th / tm - 1.0;
  return max(e2 / th, x > 0.0 ? -log(x) - 0.40 : 1e3);
}
// The direction the light seen along d came from; hidden: d ends on a black hole's shadow.
vec3 lensSource(vec3 d, out bool hidden) {
  hidden = false;
  vec3 s = d;
  for (int i = 0; i < 4; i++) {
    if (i >= uLensN) break;
    vec3 L = uLens[i].xyz;
    float th = lensAngle(s, L);
    if (th < uLensSh[i]) { hidden = true; return s; }
    vec3 t = s - L * dot(s, L);
    float tl = length(t);
    if (tl < 1e-12) continue;
    t /= tl;
    float beta = th - deflection(th, uLens[i].w, uLensSh[i]);
    s = L * cos(beta) + t * sin(beta);
  }
  return s;
}
`;

// Background stars. Near a lens each star has two images (Refsdal 1964): outside the Einstein ring at
// θ₊ = (β + √(β² + 4θE²))/2 and inside it, on the far side, at θ₋ = (β − √(β² + 4θE²))/2, magnified by
// μ± = (u² + 2)/(2u√(u² + 4)) ± ½ with u = β/θE. uImage picks which image this pass draws.
export const SKY_VS = HEAD + LENS + `
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aCol;
layout(location = 2) in float aSize;
uniform mat4 uProj;
uniform mat3 uView;
uniform int uImage;
out vec3 vCol;
void main() {
  vec3 s = normalize(aPos);
  vec3 dir = s;
  float mag = 1.0;
  // The lens that affects this star most (smallest β/θE).
  int best = -1; float bu = 1e9;
  for (int i = 0; i < 4; i++) {
    if (i >= uLensN) break;
    float u = lensAngle(s, uLens[i].xyz) / sqrt(uLens[i].w);
    if (u < bu) { bu = u; best = i; }
  }
  bool show = uImage == 0;
  if (best >= 0) {
    vec3 L = uLens[best].xyz;
    float e2 = uLens[best].w, beta = lensAngle(s, L), u = max(bu, 1e-4);
    float root = sqrt(beta * beta + 4.0 * e2);
    float th = uImage == 0 ? 0.5 * (beta + root) : 0.5 * (beta - root);
    mag = (u * u + 2.0) / (2.0 * u * sqrt(u * u + 4.0)) + (uImage == 0 ? 0.5 : -0.5);
    show = abs(th) > uLensSh[best] && mag > 0.02;
    vec3 t = s - L * dot(s, L);
    float tl = length(t);
    t = tl > 1e-12 ? t / tl : normalize(cross(L, vec3(0.31, 0.83, 0.47)));
    dir = L * cos(th) + t * sin(th);
  }
  vec4 p = uProj * vec4(uView * dir * 1e6, 1.0);
  gl_Position = show ? p.xyww : vec4(2.0, 2.0, 2.0, 1.0);
  mag = min(mag, 30.0);
  gl_PointSize = aSize * clamp(sqrt(mag), 1.0, 3.0);
  vCol = aCol * mag / clamp(mag, 1.0, 9.0); // brighter images also get bigger, so share the gain
}
`;

export const SKY_FS = HEAD + `
in vec3 vCol;
out vec4 outColor;
void main() {
  vec2 pc = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(pc, pc);
  if (r2 > 1.0) discard;
  outColor = vec4(vCol * (1.0 - r2), 1.0);
}
`;

// ---------- post-processing and sky ----------

export const FULL_VS = HEAD + `
layout(location = 0) in vec2 aCorner;
out vec2 vUV;
void main() {
  vUV = aCorner * 0.5 + 0.5;
  gl_Position = vec4(aCorner, 0.0, 1.0);
}
`;

// An emission nebula (a stellar nursery like the Orion or Lagoon nebulae), ray-marched through its sphere
// at quarter resolution. Hydrogen ionised by the young stars inside glows red (H-alpha, 656 nm); the hotter
// core, where doubly ionised oxygen shines at 501 nm, is blue-green; cold dust in lanes and pillars blocks
// the light behind it. Turbulent, filamentary structure from domain-warped noise. Colour in each band:
// infrared shows the dust itself, warm and bright (as Spitzer and Webb see it); ultraviolet the hot, ionised
// gas; X-rays only the faint hot bubbles blown by the stars.
export const NEBULA_FS = HEAD + NOISE + `
in vec2 vUV;
uniform mat3 uView;
uniform vec2 uTan;
uniform vec3 uC;         // centre, view space (AU)
uniform float uR;        // radius (AU)
uniform float uSeed;
uniform float uBright;
uniform int uBand;       // 0 visible, 1 infrared, 2 ultraviolet, 3 X-ray
out vec4 outColor;
void main() {
  vec3 d = normalize(vec3((vUV.x * 2.0 - 1.0) * uTan.x, (vUV.y * 2.0 - 1.0) * uTan.y, -1.0));
  // Unit-sphere coordinates in the nebula's own (world-aligned) frame.
  mat3 W = transpose(uView);
  vec3 o = W * (-uC) / uR, dw = W * d;
  float b = dot(o, dw), c = dot(o, o) - 1.0, D = b * b - c;
  if (D <= 0.0) { outColor = vec4(0.0); return; }
  float q = sqrt(D), t0 = max(-b - q, 0.0), t1 = -b + q;
  if (t1 <= 0.0) { outColor = vec4(0.0); return; }
  const int N = 26;
  float dt = (t1 - t0) / float(N);
  vec3 sd = vec3(uSeed * 17.0, uSeed * 31.0, uSeed * 7.0);
  vec3 col = vec3(0.0);
  float T = 1.0;
  for (int i = 0; i < N; i++) {
    vec3 p = o + dw * (t0 + (float(i) + 0.5) * dt);
    float r = length(p);
    float shell = 1.0 - smoothstep(0.45, 1.0, r);
    if (shell <= 0.0) continue;
    // Domain-warped turbulence: wispy filaments rather than round blobs.
    vec3 w = vec3(fbm(p * 1.6 + sd, 3), fbm(p * 1.6 + sd + 5.2, 3), fbm(p * 1.6 + sd + 9.7, 3));
    float n = fbm(p * 2.8 + w * 2.0 + sd, 4);
    // Bright, thin filaments (ridges of warped noise) over the broad glow.
    float fil = pow(1.0 - abs(2.0 * vnoise(p * 7.0 + w * 3.0 + sd + 1.0) - 1.0), 8.0);
    float gas = shell * (smoothstep(0.34, 0.78, n) * 1.3 + fil * smoothstep(0.3, 0.6, n) * 1.6);
    // Oxygen glows where the gas is hottest, nearest the central stars.
    float ox = (1.0 - smoothstep(0.1, 0.8, r)) * smoothstep(0.25, 0.6, vnoise(p * 1.8 + sd + 2.0));
    // Dust: ridged noise makes lanes and dark pillars.
    float ridge = 1.0 - abs(2.0 * vnoise(p * 3.2 + w * 1.2 + sd + 4.0) - 1.0);
    float dust = shell * (smoothstep(0.66, 0.92, ridge) * smoothstep(0.3, 0.6, n) + 0.35 * smoothstep(0.55, 0.75, w.x));
    vec3 e;
    float ext = dust * 14.0;
    if (uBand == 1) { e = vec3(1.0, 0.7, 0.4) * (dust * 0.9 + gas * 0.08); ext *= 0.08; }        // warm dust glows
    else if (uBand == 2) e = vec3(0.6, 0.75, 1.0) * gas * (0.4 + 1.6 * ox);                   // hot, ionised gas
    else if (uBand == 3) { e = vec3(0.7, 0.8, 1.0) * ox * gas * 0.25; ext *= 0.2; }           // faint hot bubbles
    else e = mix(vec3(1.0, 0.1, 0.17), vec3(0.2, 0.55, 1.0), ox) * gas + vec3(0.25, 0.16, 0.3) * gas * gas;
    col += T * e * dt * 2.0 * uBright;
    T *= exp(-ext * dt);
    if (T < 0.02) break;
  }
  outColor = vec4(col, 1.0 - T);
}
`;

// A lower-resolution layer stretched over the view (premultiplied colour and coverage).
export const BLIT_FS = HEAD + `
in vec2 vUV;
uniform sampler2D uTex;
out vec4 outColor;
void main() { outColor = texture(uTex, vUV); }
`;

// Generated terrain map of a world without a real one (render3d.js genStep): equirectangular, the same
// layout as the photo maps, made once in strips and then only sampled. Far more noise than could be run per
// pixel every frame: continents and coasts bent by domain warping (Quilez, iquilezles.org/articles/warp),
// mountain chains of ridged multifractal noise (Musgrave, in Ebert et al., Texturing & Modeling, 2003)
// along belts like plate edges. R: height (fbm-like, ~0.3-0.7), G: mountains 0..1, B: moisture, A: tone.
export const GEN_FS = HEAD + NOISE + `
in vec2 vUV;
uniform float uSeed;
uniform vec2 uRows;     // this strip: first row and height, as fractions of the map
out vec4 outColor;
float ridged(vec3 p) {
  float s = 0.0, a = 0.5, w = 1.0;
  for (int i = 0; i < 6; i++) {
    float n = 1.0 - abs(2.0 * vnoise(p) - 1.0);
    n *= n * w;
    w = clamp(n * 1.6, 0.0, 1.0);   // crests sharpen where the chain is already high
    s += n * a;
    p = p * 2.07 + vec3(5.1, 1.3, 7.7);
    a *= 0.5;
  }
  return s;
}
void main() {
  float v = uRows.x + vUV.y * uRows.y;
  float lon = (vUV.x - 0.5) * 6.2831853, lat = (0.5 - v) * 3.14159265;
  vec3 d = vec3(cos(lat) * cos(lon), sin(lat), -cos(lat) * sin(lon));   // (inverse of mapTex's lookup)
  vec3 q = d * 1.7 + uSeed;
  vec3 w = vec3(fbm(q * 0.8 + vec3(1.7, 9.2, 3.1), 4), fbm(q * 0.8 + vec3(8.3, 2.8, 5.5), 4), fbm(q * 0.8 + vec3(4.1, 6.6, 1.3), 4)) - 0.5;
  vec3 qw = q + w * 1.2;
  // Continents, plus finer octaves for fractal coasts: bays, headlands, island arcs. The fine layer is warped
  // again at its own scale, so coasts curl rather than just roughen.
  vec3 qd = qw * 6.0 + w * 4.0;
  vec3 w2 = vec3(fbm(qd + vec3(3.3, 7.1, 2.2), 3), fbm(qd + vec3(9.4, 1.6, 6.8), 3), 0.0) - 0.5;
  float h = fbm(qw, 6) + (fbm(qd + w2 * 1.5 + 13.0, 6) - 0.5) * 0.17;
  float belt = smoothstep(0.45, 0.65, fbm(qw * 1.3 + 21.0, 3));
  float m = clamp(ridged(qw * 2.6 + 11.0) * (0.35 + 0.65 * belt) * 1.3, 0.0, 1.0);
  outColor = vec4(h, m, fbm(qw * 1.3 + 31.0, 6), fbm(qw * 2.4 + 7.0, 6));
}
`;

// Procedural Milky Way: a band of unresolved starlight with a brighter bulge toward the galactic
// centre, dark dust lanes along the mid-plane, faint emission nebulae and a dusting of faint stars.
export const MILKYWAY_FS = HEAD + NOISE + LENS + `
in vec2 vUV;
uniform mat3 uView;
uniform vec2 uTan;       // tan(fov/2) * aspect, tan(fov/2)
uniform vec3 uGalN, uGalC;
uniform float uBright;
uniform sampler2D uMW;   // panorama in galactic coordinates (north up, longitude increasing to the left)
uniform float uMWK;
out vec4 outColor;
void main() {
  vec3 dv = normalize(vec3((vUV.x * 2.0 - 1.0) * uTan.x, (vUV.y * 2.0 - 1.0) * uTan.y, -1.0));
  vec3 d = transpose(uView) * dv;
  bool hidden;
  d = lensSource(d, hidden);
  if (hidden) { outColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  if (uMWK > 0.5) {
    vec3 e0 = normalize(cross(uGalN, uGalC));
    float l = atan(dot(d, e0), dot(d, uGalC)), bb = asin(clamp(dot(d, uGalN), -1.0, 1.0));
    vec2 uv = vec2(fract(0.5 - l / 6.2831853), 0.5 - bb / 3.14159265);
    // Derivatives from a seam-free parametrisation so the 180° wrap keeps its detail.
    vec2 uv2 = vec2(fract(uv.x + 0.5), uv.y);
    vec2 gx = dFdx(uv), gy = dFdy(uv), gx2 = dFdx(uv2), gy2 = dFdy(uv2);
    if (abs(gx2.x) + abs(gy2.x) < abs(gx.x) + abs(gy.x)) { gx = gx2; gy = gy2; }
    vec3 m = textureGrad(uMW, uv, gx, gy).rgb;
    vec3 col = pow(m, vec3(2.2)) * 1.3;
    // Faint unresolved stars, denser where the band is bright (the panorama's own stars were removed).
    vec3 g = d * 520.0;
    vec3 cell = floor(g);
    float h = hash(cell);
    float thr = 0.993 - 0.02 * clamp(dot(m, vec3(0.33)) * 3.0, 0.0, 1.0);
    if (h > thr) {
      float f = length(fract(g) - 0.5);
      col += mix(vec3(0.75, 0.82, 1.0), vec3(1.0, 0.9, 0.78), hash(cell + 3.1)) * smoothstep(0.32, 0.0, f) * (h - thr) / (1.0 - thr) * 0.7;
    }
    outColor = vec4(vec3(0.004, 0.006, 0.013) + col * uBright, 1.0);
    return;
  }
  float b = dot(d, uGalN);
  vec3 e = normalize(cross(uGalN, uGalC));
  float lon = atan(dot(d, e), dot(d, uGalC));
  float core = exp(-pow(lon / 0.75, 2.0));
  float band = exp(-b * b / (0.008 + 0.028 * core));
  float cloud = fbm(d * 3.5 + 2.0, 4);
  float clump = fbm(d * 11.0 + 5.0, 3);
  float grain = fbm(d * 34.0 + 1.0, 3);
  float glow = band * (0.2 + 0.8 * cloud) * (0.55 + 0.9 * clump * clump) * (0.5 + 0.6 * grain) * (0.45 + 1.0 * core);
  float dust = smoothstep(0.48, 0.66, fbm(d * 6.0 + 9.0, 4)) * exp(-b * b / 0.003);
  glow *= 1.0 - 0.8 * dust;
  vec3 col = mix(vec3(0.52, 0.58, 0.75), vec3(1.0, 0.8, 0.58), core * 0.85) * glow * 0.42;
  float neb = smoothstep(0.6, 0.78, fbm(d * 2.2 + 17.0, 3)) * (0.3 + band);
  col += mix(vec3(0.45, 0.08, 0.12), vec3(0.2, 0.12, 0.35), fbm(d * 1.3, 2)) * neb * 0.09;
  // Faint unresolved stars, denser in the band.
  vec3 g = d * 520.0;
  vec3 cell = floor(g);
  float h = hash(cell);
  float thr = 0.993 - 0.012 * band;
  if (h > thr) {
    float f = length(fract(g) - 0.5);
    col += mix(vec3(0.75, 0.82, 1.0), vec3(1.0, 0.9, 0.78), hash(cell + 3.1)) * smoothstep(0.32, 0.0, f) * (h - thr) / (1.0 - thr) * 0.7;
  }
  outColor = vec4(vec3(0.004, 0.006, 0.013) + col * uBright, 1.0);
}
`;

// Bloom: bright parts are downsampled through a chain of half-size images, then blurred back up.
// Replace NaN/Inf with black. Tested on the bit pattern because isnan() can be optimised away under
// fast-math. Without this one bad pixel is smeared by the bloom passes into black rectangles.
const FINITE = `
vec3 finite(vec3 c) {
  uvec3 b = floatBitsToUint(c) & 0x7f800000u;
  return vec3(b.r == 0x7f800000u ? 0.0 : c.r, b.g == 0x7f800000u ? 0.0 : c.g, b.b == 0x7f800000u ? 0.0 : c.b);
}
`;

export const DOWN_FS = HEAD + FINITE + `
in vec2 vUV;
uniform sampler2D uTex;
uniform vec2 uTexel;
uniform int uFirst;
uniform float uThreshold;
out vec4 outColor;
void main() {
  vec3 c = 0.25 * (texture(uTex, vUV + uTexel * vec2(-1.0, -1.0)).rgb + texture(uTex, vUV + uTexel * vec2(1.0, -1.0)).rgb
                 + texture(uTex, vUV + uTexel * vec2(-1.0, 1.0)).rgb + texture(uTex, vUV + uTexel * vec2(1.0, 1.0)).rgb);
  if (uFirst == 1) {
    c = 0.25 * (finite(texture(uTex, vUV + uTexel * vec2(-1.0, -1.0)).rgb) + finite(texture(uTex, vUV + uTexel * vec2(1.0, -1.0)).rgb)
              + finite(texture(uTex, vUV + uTexel * vec2(-1.0, 1.0)).rgb) + finite(texture(uTex, vUV + uTexel * vec2(1.0, 1.0)).rgb));
    c = min(c, vec3(1e4));
    float l = max(c.r, max(c.g, c.b));
    float soft = clamp(l - uThreshold + 0.25, 0.0, 0.5);
    float k = max(soft * soft / 0.5, l - uThreshold) / max(l, 1e-4);
    c *= max(k, 0.0);
  }
  outColor = vec4(c, 1.0);
}
`;

export const UP_FS = HEAD + `
in vec2 vUV;
uniform sampler2D uLow, uHigh;
uniform vec2 uTexel;   // texel of the low-resolution image
out vec4 outColor;
void main() {
  vec3 s = texture(uLow, vUV).rgb * 4.0;
  s += (texture(uLow, vUV + vec2(uTexel.x, 0.0)).rgb + texture(uLow, vUV - vec2(uTexel.x, 0.0)).rgb
      + texture(uLow, vUV + vec2(0.0, uTexel.y)).rgb + texture(uLow, vUV - vec2(0.0, uTexel.y)).rgb) * 2.0;
  s += texture(uLow, vUV + uTexel).rgb + texture(uLow, vUV - uTexel).rgb
     + texture(uLow, vUV + vec2(uTexel.x, -uTexel.y)).rgb + texture(uLow, vUV + vec2(-uTexel.x, uTexel.y)).rgb;
  outColor = vec4(texture(uHigh, vUV).rgb + s / 16.0, 1.0);
}
`;

// Final image: scene plus bloom, with a soft shoulder so bright lava and stars roll off to white
// instead of clipping.
// The one tone curve, at the very end (composite and pixel view): the scene is in linear light, with
// highlights up to ~10x white (the Sun, its glare, sunlit horizons, bright limbs). Below 0.75 it is untouched
// (planets, rings and sprites were tuned in 0..1); above, a Reinhard shoulder on the excess keeps gradations to
// ~10 instead of clipping at ~1.5; light past ~3x turns towards white.
const TONEMAP = `
vec3 shoulder(vec3 v) { vec3 x = max(v - 0.75, 0.0); return min(v, vec3(0.75)) + x / (1.0 + x / 0.25); }
vec3 tonemap(vec3 c) {
  float l = max(c.r, max(c.g, c.b));
  if (l > 0.75) {
    float x = l - 0.75, m = 0.75 + x / (1.0 + x / 0.25);
    // Half by the brightest channel (hue kept), half per channel, as film and camera sensors respond: a bright
    // red sunset slides toward orange and gold instead of staying pure red.
    c = mix(c * (m / l), shoulder(c), 0.5);
    c = mix(c, vec3(max(c.r, max(c.g, c.b))), clamp((l - 3.0) / 10.0, 0.0, 0.35));
  }
  return c;
}
`;

const FLARE = `
uniform vec4 uFlare;         // lens flare: the star's position (uv), strength, aspect ratio (w/h); z 0 = off
uniform vec3 uFlareCol;
uniform float uFlareThr;     // brightness that counts as the star showing (the surface sky's Sun is far past white)
// Lens flare, as a camera's lens makes it: a halo ring and a starburst around the star, and ghosts (images of
// the aperture reflected between the lens's surfaces) strung along the line from the star through the centre,
// tinted by the coatings. It fades with how much of the star is seen: the scene is sampled right at the star,
// so a planet, a hill or a cloud in front of it hides the flare.
vec3 lensFlare(vec2 uv) {
  vec2 sp = uFlare.xy;
  vec2 tx = 1.5 / vec2(textureSize(uScene, 0));
  float vis = 0.0;
  for (int i = 0; i < 5; i++) {
    vec2 o = vec2(i == 1 ? 1.0 : i == 2 ? -1.0 : 0.0, i == 3 ? 1.0 : i == 4 ? -1.0 : 0.0);
    vec3 s = finite(texture(uScene, sp + o * tx).rgb);
    vis += smoothstep(uFlareThr * 0.4, uFlareThr, max(s.r, max(s.g, s.b))) * 0.2;
  }
  if (vis <= 0.0) return vec3(0.0);
  vec2 asp = vec2(uFlare.w, 1.0);
  vec2 d = (uv - sp) * asp;
  float r = length(d);
  vec3 c = vec3(0.0);
  // Starburst: thin rays from the aperture's blades, and a soft core.
  float ang = atan(d.y, d.x);
  // Four long thin spikes (diffraction from the camera's vanes), and faint finer rays between them.
  float rays = pow(abs(cos(ang * 2.0)), 900.0) * 2.0 + 0.35 * pow(abs(cos(ang * 4.0 + 0.785)), 60.0);
  // (Rays shorter in space: uFlareThr < 1 there; against a bright sky the faint outer part does not show anyway.)
  c += uFlareCol * rays * exp(-r * (uFlareThr < 1.0 ? 9.0 : 7.0)) * 1.2;
  c += uFlareCol * exp(-r * 22.0) * 0.6;
  // Halo: a faint rainbow-edged ring.
  float ring = exp(-pow((r - 0.32) / 0.012, 2.0));
  c += vec3(0.25, 0.45, 0.9) * ring * 0.07 + vec3(0.9, 0.5, 0.3) * exp(-pow((r - 0.335) / 0.012, 2.0)) * 0.05;
  // Ghosts along the line through the centre.
  vec2 axis = vec2(0.5) - sp;
  for (int i = 0; i < 6; i++) {
    float k = i == 0 ? 0.45 : i == 1 ? 0.8 : i == 2 ? 1.15 : i == 3 ? 1.4 : i == 4 ? 1.75 : 2.2;
    float sz = i == 0 ? 0.03 : i == 1 ? 0.06 : i == 2 ? 0.018 : i == 3 ? 0.09 : i == 4 ? 0.04 : 0.13;
    vec3 tint = i == 0 ? vec3(0.9, 0.6, 0.3) : i == 1 ? vec3(0.3, 0.8, 0.5) : i == 2 ? vec3(1.0, 0.8, 0.5)
              : i == 3 ? vec3(0.4, 0.5, 1.0) : i == 4 ? vec3(0.9, 0.4, 0.7) : vec3(0.5, 0.7, 1.0);
    float gr = length((uv - (sp + axis * k)) * asp);
    float disc = smoothstep(sz, sz * 0.75, gr) * (0.5 + 0.5 * smoothstep(sz * 0.4, sz, gr));   // brighter rim
    c += tint * disc * (i == 5 ? 0.04 : 0.08);
  }
  // Weaker as the star nears the screen's edge (less light reaches the inner surfaces).
  float edge = 1.0 - smoothstep(0.35, 0.75, length((sp - 0.5) * asp));
  return c * vis * uFlare.z * (0.4 + 0.6 * edge);
}
`;

export const COMPOSITE_FS = HEAD + FINITE + TONEMAP + `
in vec2 vUV;
uniform sampler2D uScene, uBloom;
uniform float uBloomK;
uniform vec3 uWB;            // white balance: the eye partly adapting to the light's colour (1 = none)
out vec4 outColor;
` + FLARE + `
void main() {
  vec3 c = finite(texture(uScene, vUV).rgb) + finite(texture(uBloom, vUV).rgb) * uBloomK;
  if (uFlare.z > 0.0) c += lensFlare(vUV);
  outColor = vec4(tonemap(c * uWB), 1.0);
}
`;

// Pixel view: nearest-neighbour upscale of a low-resolution render, posterised to a small palette
// with 4x4 ordered (Bayer) dithering, like hand-made pixel art.
export const PIXEL_FS = HEAD + FINITE + TONEMAP + `
in vec2 vUV;
uniform sampler2D uScene, uBloom;
uniform vec2 uLow;
uniform float uScale, uBloomK, uLevels;
uniform vec3 uWB;            // white balance (see COMPOSITE_FS)
out vec4 outColor;
` + FLARE + `
const float BAYER[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
void main() {
  vec2 p = floor(gl_FragCoord.xy / uScale);
  vec2 uv = (p + 0.5) / uLow;
  vec3 c = finite(texelFetch(uScene, ivec2(min(p, uLow - 1.0)), 0).rgb) + finite(texture(uBloom, uv).rgb) * uBloomK;
  if (uFlare.z > 0.0) c += lensFlare(uv);
  c = tonemap(c * uWB);
  int i = int(mod(p.y, 4.0)) * 4 + int(mod(p.x, 4.0));
  float d = BAYER[i] / 16.0; // 0..0.94: near-black stays black, so the sky has no dot grid
  c = pow(max(c, 0.0), vec3(0.85));
  c = max(c - 0.05, 0.0) * 1.05; // faint glow (Milky Way, bloom haze) drops to black instead of dithering into dots
  c = floor(c * uLevels + d) / uLevels;
  outColor = vec4(pow(c, vec3(1.0 / 0.85)), 1.0);
}
`;

// Sky seen from a planet's surface, from the same scattering as the view from space: Earth's blue
// (Rayleigh, ∝ 1/λ⁴) with red sunsets, Mars's butterscotch dust with a blue glow around the setting
// Sun (dust scatters blue more strongly forward), Titan's orange tholin haze, Venus's dim yellow murk.
// Airless worlds show a black sky. Planetary rings arc across it, lit or in the planet's shadow.
export const SURFACE_SKY_FS = HEAD + NOISE + SCATTER + `
in vec2 vUV;
uniform mat3 uView;
uniform vec2 uTan;
uniform vec3 uUp, uSun;      // world directions: local up, toward the brightest star
uniform float uAir;          // 1 with an atmosphere, 0 airless
uniform float uExpo;         // eye adaptation
uniform float uSunPower;     // sunlight strength (0 with no star)
uniform float uSunAng;       // angular radius of the star (rad)
uniform vec3 uSunCol;        // star colour
uniform float uCloud;        // cloud cover 0..1 from the climate model
uniform vec3 uCloudCol;
uniform float uTime;
uniform vec3 uNorth;         // local north (world), for the cloud deck's coordinates
uniform vec3 uDeck;          // overcast under a thick haze (Venus): contrast, deck height (radii), feature size (radii)
uniform vec3 uRingN;         // ring plane normal (world); zero for no rings
uniform vec2 uRingR;         // inner, outer radius (planet radii)
uniform float uRingProf[16];
uniform vec3 uRingCol;
uniform sampler2D uClouds;   // the cloud deck drawn by SURFACE_CLOUD_FS at a quarter of the resolution
uniform float uCloudBuf;     // 1 when it was drawn this frame
uniform float uVeil;         // 1: compositing the planets and moons in the sky (see the end)
uniform vec4 uFlash;         // lightning: direction of the bolt's top (world), brightness: lights the clouds
uniform vec2 uRes;           // target size (px), for the bolt's width
uniform sampler2D uBodies;   // ... drawn on their own: light (rgb) and where they are solid (a)
out vec4 outColor;
// Catmull-Rom bicubic upscaling in 9 bilinear reads (the weights of each pair folded into one offset read).
vec4 catmullRom(sampler2D t, vec2 uv) {
  vec2 size = vec2(textureSize(t, 0)), sp = uv * size, tp1 = floor(sp - 0.5) + 0.5, f = sp - tp1;
  vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f)), w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f)), w3 = f * f * (-0.5 + 0.5 * f);
  vec2 w12 = w1 + w2, t0 = (tp1 - 1.0) / size, t3 = (tp1 + 2.0) / size, t12 = (tp1 + w2 / w12) / size;
  vec4 r = (texture(t, vec2(t0.x, t0.y)) * w0.x + texture(t, vec2(t12.x, t0.y)) * w12.x + texture(t, vec2(t3.x, t0.y)) * w3.x) * w0.y
         + (texture(t, vec2(t0.x, t12.y)) * w0.x + texture(t, vec2(t12.x, t12.y)) * w12.x + texture(t, vec2(t3.x, t12.y)) * w3.x) * w12.y
         + (texture(t, vec2(t0.x, t3.y)) * w0.x + texture(t, vec2(t12.x, t3.y)) * w12.x + texture(t, vec2(t3.x, t3.y)) * w3.x) * w3.y;
  return clamp(r, 0.0, 64.0);
}
void main() {
  vec4 B = vec4(0.0);
  if (uVeil > 0.5) {
    B = texture(uBodies, vUV);
    if (B.a < 0.002 && max(B.r, max(B.g, B.b)) < 0.002) discard;   // (nothing there: the sky as drawn stays)
  }
  vec3 dv = normalize(vec3((vUV.x * 2.0 - 1.0) * uTan.x, (vUV.y * 2.0 - 1.0) * uTan.y, -1.0));
  vec3 d = transpose(uView) * dv;
  float h = dot(d, uUp);
  float e = dot(uSun, uUp);
  vec3 o = uUp * 1.00002;
  vec3 L = vec3(0.0), T = vec3(1.0), Tsun = vec3(1.0);
  bool ground = h < 0.0 && sphereHit(o, d, 1.0).x > 0.0;
  if (uAir > 0.0 && uSunPower > 0.0) {
    float tMax = ground ? sphereHit(o, d, 1.0).x : sphereHit(o, d, uTop).y;
    L = scatter(o, d, tMax, uSun, 2.2, T);
    Tsun = exp(-tauToSun(1.00002, e));
    // Under Venus's deck the overcast is brighter under thin cloud and darker under thick: features smaller
    // than the ~50 km of air below are blurred away by the scattering, but the broad streaks the
    // super-rotation shears east-west (hundreds of km) still show, softly.
    if (uDeck.x > 0.0 && !ground && h > 0.0) {
      vec3 east = normalize(cross(uNorth, uUp));
      vec3 q = d * (uDeck.y / max(h, 0.04));
      vec2 c = vec2(dot(q, east), dot(q, uNorth)) / uDeck.z;
      float w = fbm(vec3(c * 0.35, 1.3), 3);
      float n = fbm(vec3(c.x * 0.25 + w * 1.6 + uTime * 0.004, c.y * 1.4 + w * 0.6, 7.1), 4);
      float k = uDeck.x * (n - 0.5) * 2.0 * smoothstep(0.03, 0.35, h);
      L *= 1.0 + k * vec3(0.85, 1.0, 1.15);   // thicker cloud: darker and a little more orange
    }
  }
  // The star's disc, dimmed and reddened by the air in front of it.
  float cosA = dot(d, uSun);
  float disc = smoothstep(cos(uSunAng * 1.08), cos(uSunAng * 0.92), cosA) * uSunPower;
  vec3 Lsun = uSunCol * disc * 60.0 * (ground ? vec3(0.0) : T);
  // Rings: where the view ray crosses the ring plane.
  vec3 Lring = vec3(0.0); float ringA = 0.0;
  if (dot(uRingN, uRingN) > 0.5 && !ground) {
    float dn = dot(d, uRingN);
    float t = -dot(o, uRingN) / (abs(dn) > 1e-5 ? dn : 1e-5);
    if (t > 0.0) {
      vec3 q = o + d * t;
      float rr = length(q);
      if (rr > uRingR.x && rr < uRingR.y) {
        float f = (rr - uRingR.x) / (uRingR.y - uRingR.x) * 16.0;
        int i0 = int(clamp(floor(f - 0.5), 0.0, 15.0)), i1 = min(i0 + 1, 15);
        float op = mix(uRingProf[i0], uRingProf[i1], clamp(f - 0.5 - float(i0), 0.0, 1.0));
        op *= 0.85 + 0.15 * vnoise(vec3(rr * 300.0, 0.0, 0.0));        // fine ringlets
        float side = sign(dot(o, uRingN)) * sign(dot(uSun, uRingN));
        float lit = side > 0.0 ? 0.35 + 0.65 * sqrt(abs(dot(uSun, uRingN))) : 0.25 * (1.0 - op);
        vec2 sh = sphereHit(q, uSun, 1.0);
        if (sh.x > 0.0) lit = 0.0;                                       // planet's shadow on the ring
        Lring = uRingCol * lit * 0.07 * uSunPower;
        ringA = op;
      }
    }
  }
  vec3 Lall = L + Lring * ringA * T;
  vec3 col = skyTone(Lall * uExpo);
  // (How much the sky hides the stars behind it: a twilight sky at a tenth of daylight already hides most.)
  float alpha = clamp(max(col.r, max(col.g, col.b)) * 5.0, 0.0, 1.0);
  alpha = max(alpha, ringA * dot(T, vec3(0.3333)));
  // The star's disc at its full brightness (dimmed once by the air in front of it), not squeezed by the curve
  // above: in the HDR buffer it is far brighter than the sky, so bloom spreads its glare (the composite's
  // curve brings it to the screen's range at the end).
  // (Capped at 16x white: the real ratio, ~10^5, would only flood the screen with bloom.)
  vec3 sunHDR = Lsun * uExpo;
  sunHDR *= min(1.0, 16.0 / max(max(sunHDR.r, max(sunHDR.g, sunHDR.b)), 1e-6));
  // The cloud deck (premultiplied colour and coverage), over the sky and the star's disc.
  if (uCloudBuf > 0.5) {
    // (Upscaled from a quarter of the resolution with a Catmull-Rom bicubic: smooth, but sharper than a blur.)
    // (Catmull-Rom overshoots near sharp edges: coverage is kept in 0..1, or 1 - a < 0 makes pow() NaN and
    // blacks out the sky around the Sun.)
    vec4 cl = catmullRom(uClouds, vUV);
    cl.a = clamp(cl.a, 0.0, 1.0);
    cl.rgb = min(cl.rgb, vec3(4.0));
    col = col * (1.0 - cl.a) + cl.rgb;
    alpha = alpha * (1.0 - cl.a) + cl.a;
    if (uFlash.w > 0.0) col += cl.a * vec3(0.75, 0.8, 1.0) * uFlash.w * (0.15 + 0.6 * exp((dot(d, normalize(uFlash.xyz)) - 1.0) / 0.03));
    sunHDR *= pow(max(1.0 - cl.a, 0.0), 8.0);   // (16x white: a thick cloud must hide it, not just dim it)
  }
  // Fallback: a flat layer seen in perspective, drifting with the wind, lit by the sunlight that got through
  // the air (so it glows orange-pink at sunset), faint at night.
  else if (uCloud > 0.0 && h > 0.02) {
    vec3 east = normalize(cross(uNorth, uUp));
    vec2 p = vec2(dot(d, east), dot(d, uNorth)) / max(h, 0.05) * 1.6 + vec2(uTime * 0.02, uTime * 0.007);
    float n = fbm(vec3(p, 1.7), 5) + 0.1 * (vnoise(vec3(p * 5.0, 3.1)) - 0.5);
    float thr = 0.5 + (0.5 - clamp(uCloud * 1.2, 0.0, 1.0)) * 0.34;
    float c = smoothstep(thr - 0.05, thr + 0.14, n) * smoothstep(0.02, 0.2, h);
    // Sunlight through the air plus the blue skylight around it.
    vec3 Lc = Tsun * max(e, 0.0) + (1.0 - exp(-uTauS)) * 0.5 * max(e + 0.08, 0.0);
    float m = max(Lc.r, max(Lc.g, Lc.b));
    vec3 lightCol = m > 1e-4 ? Lc / m : vec3(1.0);
    float lit = 0.05 + 0.95 * smoothstep(-0.1, 0.15, e) * uSunPower * pow(m, 0.25);
    vec3 cc = uCloudCol * lightCol * lit * (0.75 + 0.35 * smoothstep(thr, thr + 0.3, n));
    cc = mix(cc, col, 1.0 - smoothstep(0.02, 0.35, h));                 // distant clouds fade into the haze
    col = col * (1.0 - c) + cc * c;
    alpha = alpha * (1.0 - c) + c;
    sunHDR *= pow(1.0 - c, 8.0);
  }
  // Lightning: a jagged channel from the cloud base (uFlash.xyz points at its top) down to the ground, with a
  // fork, in front of the clouds; bright enough for bloom. The ground drawn after hides its foot behind hills.
  if (uFlash.w > 0.0 && uVeil < 0.5) {
    vec3 east = normalize(cross(uNorth, uUp));
    vec3 f = normalize(uFlash.xyz);
    float el = asin(clamp(h, -1.0, 1.0)), az = atan(dot(d, east), dot(d, uNorth));
    float el0 = asin(clamp(dot(f, uUp), -1.0, 1.0)), az0 = atan(dot(f, east), dot(f, uNorth));
    float px = 2.0 * uTan.y / uRes.y;
    float t = clamp(el / max(el0, 1e-3), 0.0, 1.0);
    float w0 = el0 * 0.35;                                          // wander scales with the bolt's size
    float x = az0 + w0 * (fbm(vec3(el / el0 * 6.0, f.x * 40.0, 1.0), 4) - 0.5) + w0 * 0.25 * (vnoise(vec3(el / el0 * 60.0, f.y * 30.0, 2.0)) - 0.5);
    float dist = abs(atan(sin(az - x), cos(az - x))) * cos(el) / px;
    float inside = smoothstep(-0.02, 0.0, el) * (1.0 - smoothstep(el0 * 0.97, el0, el));
    float bolt = exp(-dist * dist / 1.2) * 6.0 + exp(-dist / 5.0) * 0.4;
    // A fork: leaves the channel two thirds of the way down and wanders off to one side.
    float xf = x + w0 * 0.8 * (0.66 - t) * sign(f.z - 0.0001) + w0 * 0.2 * (vnoise(vec3(el / el0 * 40.0, 7.0, 3.0)) - 0.5);
    float df = abs(atan(sin(az - xf), cos(az - xf))) * cos(el) / px;
    bolt += exp(-df * df / 0.8) * 1.6 * smoothstep(0.66, 0.6, t) * smoothstep(0.25, 0.4, t);
    vec3 bc = vec3(0.85, 0.88, 1.0) * uFlash.w * bolt * inside * 2.5;
    col += bc;
    alpha = max(alpha, clamp(max(bc.r, max(bc.g, bc.b)), 0.0, 1.0));
  }
  // The veil: the planets and moons in the sky, seen through the air. Where one is solid, the sky behind it
  // gives way to the air's own light in front of it (and the clouds), plus the body dimmed by the air's
  // transmittance: a pale Moon by day, a giant planet fading into the blue, a reddened Moon low down. Light
  // from glows (rings, atmospheres, small dots) is dimmed the same way and added. No star disc: a moon in
  // front of the Sun hides it.
  if (uVeil > 0.5) {
    vec3 Tv = ground ? vec3(0.0) : T;
    float cloudA = uCloudBuf > 0.5 ? clamp(catmullRom(uClouds, vUV).a, 0.0, 1.0) : 0.0;
    float a = clamp(B.a, 0.0, 1.0);
    outColor = vec4(col * a + Tv * (1.0 - cloudA) * B.rgb, a);
    return;
  }
  // The star's disc, over the sky and behind the clouds (see above).
  col += sunHDR;
  alpha = max(alpha, clamp(max(sunHDR.r, max(sunHDR.g, sunHDR.b)) * 1.4, 0.0, 1.0));
  outColor = vec4(col, alpha);
}
`;

// Weather from the ground, over everything (render3d.js drawWeather): falling rain (or snow) as streaks in
// four depth layers, from big near drops to fine far ones, slanted by the wind, lit by the sky; a grey veil of
// rain in the distance; and the scene lit up by a lightning flash.
export const WEATHER_FS = HEAD + NOISE + `
in vec2 vUV;
uniform mat3 uView;
uniform vec2 uTan, uRes;
uniform vec3 uUp, uNorth;
uniform float uTime, uRain, uSnow;
uniform vec3 uLightC;       // light on the drops (the sky's light)
uniform vec4 uFlash;        // lightning: direction of the bolt's top (world), brightness 0..1
out vec4 outColor;
float h1(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  vec3 dv = normalize(vec3((vUV.x * 2.0 - 1.0) * uTan.x, (vUV.y * 2.0 - 1.0) * uTan.y, -1.0));
  vec3 d = transpose(uView) * dv;
  vec3 east = normalize(cross(uNorth, uUp));
  float el = asin(clamp(dot(d, uUp), -1.0, 1.0));
  float az = atan(dot(d, east), dot(d, uNorth));
  float px = 2.0 * uTan.y / uRes.y;                 // radians per pixel
  float acc = 0.0;
  for (int i = 0; i < 4; i++) {
    float k = float(i) / 3.0;
    float colW = px * mix(46.0, 9.0, k);             // spacing of the columns of drops
    float wid = px * mix(2.6, 1.0, k) * (uSnow > 0.5 ? 1.6 : 1.0);   // streak (or flake) width
    float len = uSnow > 0.5 ? wid * 1.6 : px * mix(110.0, 16.0, k);   // streak length
    float speed = uSnow > 0.5 ? px * mix(110.0, 30.0, k) : len * 9.0;  // fall (rad/s)
    float u = (az * cos(el) + el * (uSnow > 0.5 ? 0.05 : 0.14)) / colW + k * 17.0;
    float c = floor(u);
    float y = (el + uTime * speed) / (len * 3.2) + h1(vec2(c, k * 9.0)) * 50.0;
    float r = floor(y), fy = fract(y) * 3.2;
    if (h1(vec2(c * 1.7 + r, k)) > uRain * mix(0.7, 1.0, k) * (uSnow > 0.5 ? 0.45 : 1.0)) continue;
    float x0 = 0.2 + 0.6 * h1(vec2(c, r + 3.0));
    if (uSnow > 0.5) x0 += 0.12 * sin(uTime * 1.7 + r * 4.0 + c);
    float dx = (fract(u) - x0) * colW;
    float along = uSnow > 0.5 ? (fy - 0.5) * len * 3.2 / max(len, 1e-6) : fy;
    float shape = uSnow > 0.5 ? exp(-(dx * dx) / (wid * wid) - along * along * 0.5)
                              : exp(-(dx * dx) / (wid * wid)) * smoothstep(0.0, 0.2, fy) * (1.0 - smoothstep(0.6, 1.0, fy));
    acc += shape * mix(0.55, 0.3, k);
  }
  acc *= 1.0 - smoothstep(0.9, 1.3, abs(el));       // (the azimuth mapping breaks down overhead)
  vec3 grey = vec3(dot(uLightC, vec3(0.33)));
  vec3 dropC = uSnow > 0.5 ? mix(uLightC, grey, 0.8) * 1.6 : mix(uLightC, grey, 0.6) * 0.38;
  float veil = uRain * 0.28 * (1.0 - smoothstep(0.0, 0.5, abs(el)));
  vec3 col = dropC * acc + uLightC * 0.55 * veil;
  float a = clamp(veil + acc * 0.25, 0.0, 1.0);
  // The whole scene lit up by the flash (the bolt itself is drawn by the sky, behind the hills).
  if (uFlash.w > 0.0) col += vec3(0.85, 0.88, 1.0) * uFlash.w * 0.1;
  outColor = vec4(col, a);
}
`;

// The cloud deck seen from the ground, at a quarter of the screen's resolution (render3d.js drawSurfaceSky):
// a layer between uCloudH.x and uCloudH.x + uCloudH.y above the ground (radii; on Earth about 2 to 4.5 km),
// on the curved shell, marched through its thickness (6 steps a frame, accumulated over frames). Its density is a wind-blown fractal coverage field,
// thresholded by the climate's cloud cover and eroded by finer 3D noise, with flat bases and puffy tops. Each
// sample is lit by the sunlight that reaches it through the cloud above it toward the Sun (Beer-Lambert, a
// "powder" darkening of thin edges, and forward scattering that rims clouds near the Sun with light), plus
// the blue skylight. Far clouds fade into the horizon haze.
export const SURFACE_CLOUD_FS = HEAD + NOISE + SCATTER + `
in vec2 vUV;
uniform mat3 uView;
uniform vec2 uTan;
uniform vec3 uUp, uSun, uNorth;
uniform float uAir, uSunPower, uCloud, uTime;
uniform vec3 uCloudCol;
uniform float uStorm;       // 0..1: rain; the deck closes into thick, dark overcast
uniform float uCirrus;      // cirrus cover 0..1 (thin ice cloud high up; also on dry worlds, such as Mars)
uniform vec3 uCloudH;       // base height, thickness (radii), planet radius (km)
uniform sampler2D uPrev;    // last frame's result, blended in (see the end)
uniform mat3 uPrevView;     // last frame's rotation from the planet's frame to its view
uniform mat3 uRotT;         // world -> the planet's own frame (the clouds turn with the ground)
uniform float uHist;        // 1 when uPrev holds a usable last frame
uniform float uFrame;       // frame counter, for the sample offset
uniform sampler2D uNoiseTex; // 256 x 256 random values; G is R shifted by (37, 239) (see tnoise)
out vec4 outColor;
// Value noise from a texture: one filtered read gives two neighbouring z slices of the lattice (the slice
// z = k is stored shifted by k·(37, 239)), instead of eight hashes. The technique is common on Shadertoy;
// explained in M. Heckel, "Real-time dreamy Cloudscapes with Volumetric Raymarching" (2023).
float tnoise(vec3 x) {
  vec3 p = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  vec2 uv = p.xy + vec2(37.0, 239.0) * p.z + f.xy;
  vec2 rg = textureLod(uNoiseTex, (uv + 0.5) / 256.0, 0.0).yx;
  return mix(rg.x, rg.y, f.z);
}
float tfbm(vec3 p, int oct) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 5; i++) {
    if (i >= oct) break;
    s += a * tnoise(p);
    p = p * 2.03 + vec3(1.7, 9.2, 3.1);
    a *= 0.5;
  }
  return s;
}
float hg(float c, float g) { float g2 = g * g; return (1.0 - g2) / pow(1.0 + g2 - 2.0 * g * c, 1.5); }
// Density 0..1 at P (km, planet-centred) with z the height within the layer (0 base .. 1 top).
float dens(vec3 P, float z) {
  // Cells about 4 km across (cumulus is ~1 km, gathered in fields), in fields and clear spells ~30 km wide.
  // Wind about 15 m/s (P is in km, uTime in seconds).
  vec3 w = (P + vec3(uTime * 0.015, 0.0, uTime * 0.006)) * 0.22;
  float field = tfbm(P * 0.03 + 5.0, 2);
  float cov = tfbm(w, 4) + 0.12 * (tnoise(w * 4.0 + 3.0) - 0.5) + (field - 0.5) * 0.5;
  float thr = 0.64 - clamp(uCloud, 0.0, 1.0) * 0.36 - uStorm * 0.3;
  float base = smoothstep(thr, thr + 0.16, cov);
  float top = 0.3 + 0.7 * base;                                   // thick where the cover is dense
  float prof = smoothstep(0.0, 0.07, z) * (1.0 - smoothstep(top * 0.55, top, z));
  vec3 Pw = P + vec3(uTime * 0.015, 0.0, uTime * 0.006);
  float det = tnoise(Pw * 1.4 + vec3(0.0, uTime * 0.01, 0.0)) * 0.65 + tnoise(Pw * 3.2) * 0.35;
  return clamp(base * prof * 1.4 - 0.45 * det * (1.0 - 0.6 * base), 0.0, 1.0);
}
void main() {
  vec3 dv = normalize(vec3((vUV.x * 2.0 - 1.0) * uTan.x, (vUV.y * 2.0 - 1.0) * uTan.y, -1.0));
  // Everything in the planet's own frame: the clouds ride with the ground and move only with the wind.
  vec3 d = uRotT * (transpose(uView) * dv), up = uRotT * uUp, sun = uRotT * uSun;
  float h = dot(d, up);
  if (h < -0.01 || (uCloud <= 0.0 && uCirrus <= 0.0)) { outColor = vec4(0.0); return; }
  vec4 cur = vec4(0.0);
  float z0 = 2e-5, zb = uCloudH.x, zt = uCloudH.x + uCloudH.y, Rkm = uCloudH.z;
  float r0 = 1.0 + z0;
  // Distance to the shell of height z, from below (exact in differences, so float precision holds).
  #define SHELL(z) (-r0 * h + sqrt(r0 * r0 * h * h + ((z) - z0) * (2.0 + (z) + z0)))
  float tIn = SHELL(zb), tOut = SHELL(zt);
  float far = tIn * Rkm;                                          // km to the cloud base along the view
  float fade = exp(-far / 160.0) * smoothstep(0.0, 0.05, h);
  if (fade >= 0.01 && uCloud > 0.001) {
  // Light on the clouds: the sunlight that reaches their height through the air (orange-gold at sunset, and
  // still there after the Sun has set on the ground: tauToSun is blocked only by the planet itself), and the
  // skylight.
  float e = dot(sun, up);
  vec3 Tsun = uAir > 0.0 ? exp(-tauToSun(1.0 + zb, e)) : vec3(step(-0.05, e));
  float m = max(Tsun.r, max(Tsun.g, Tsun.b));
  vec3 lightCol = m > 1e-4 ? Tsun / m : vec3(1.0);
  float sunK = uSunPower * pow(max(m, 0.0), 0.35);
  vec3 sunL = uCloudCol * lightCol * sunK * 1.25 * (1.0 - 0.75 * uStorm);
  vec3 skyL = uCloudCol * mix(vec3(0.5, 0.58, 0.75), lightCol, 0.4) * (0.1 + 0.55 * smoothstep(-0.15, 0.3, e)) * max(uSunPower, 0.15);
  float cs = dot(d, sun);
  float ph = mix(hg(cs, 0.6), hg(cs, -0.15), 0.35) * 0.55;
  // 6 steps, over at most 16 km of the layer (beyond that it is opaque or lost in haze).
  const int N = 6;
  float len = min(tOut - tIn, 16.0 / Rkm), ds = len / float(N);
  // Start offset: interleaved gradient noise (Jimenez 2014), fixed per pixel, so the steps band less and
  // nothing shimmers; the sky's read of this buffer (a 3 x 3 blur) smooths it.
  float jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))) + uFrame * 0.618034);
  vec3 C = vec3(0.0);
  float Tr = 1.0;
  float SIG = 1.1 * (1.0 + 1.5 * uStorm);                         // extinction per km at full density
  float lstep = 0.35 / Rkm;                                       // light-march step (radii)
  for (int i = 0; i < N; i++) {
    float t = tIn + (float(i) + jit) * ds;
    vec3 P = up * r0 + d * t;
    float z = (length(P) - 1.0 - zb) / uCloudH.y;
    float rho = dens(P * Rkm, z);
    if (rho <= 0.002) continue;
    // Toward the Sun through the cloud above this point.
    float od = 0.0;
    for (int k = 1; k <= 3; k++) {
      vec3 Q = P + sun * lstep * float(k * k);
      float zq = (length(Q) - 1.0 - zb) / uCloudH.y;
      if (zq > 1.0) break;
      od += dens(Q * Rkm, zq) * SIG * 0.35 * float(2 * k - 1);
    }
    float beer = exp(-od), powder = 1.0 - exp(-od * 2.0 - 0.15);
    vec3 L = sunL * beer * mix(1.0, powder, 0.5) * (0.55 + ph) + skyL * (0.45 + 0.55 * z);
    float a = 1.0 - exp(-rho * SIG * ds * Rkm);
    C += Tr * a * L;
    Tr *= 1.0 - a;
    if (Tr < 0.02) break;
  }
  cur = vec4(C * fade, (1.0 - Tr) * fade);
  }
  // Cirrus: a thin high layer (~3.6x the deck's base, about 8 km on Earth) of fine streaks drawn out by the
  // wind, behind the deck. Thin ice scatters strongly forward: it glows around the Sun and, lit from below at
  // sunset, turns gold and red across the sky.
  if (h > 0.0) {
    float e = dot(sun, up), cs = dot(d, sun);
    vec3 skyL = uCloudCol * vec3(0.5, 0.58, 0.75) * (0.1 + 0.55 * smoothstep(-0.15, 0.3, e)) * max(uSunPower, 0.15);
    float zc = zb * 3.6;
    float tc = SHELL(zc);
    vec3 Pc = (up * r0 + d * tc) * Rkm;
    float farC = tc * Rkm;
    vec3 wc = Pc + vec3(uTime * 0.03, 0.0, uTime * 0.012);
    vec3 warp = vec3(tfbm(wc * 0.01 + 3.0, 3), tfbm(wc * 0.01 + 9.0, 3), 0.0) - 0.5;
    vec3 sq = vec3(wc.x * 0.008, wc.y * 0.11, wc.z * 0.11) + warp * vec3(0.8, 3.0, 3.0);   // stretched along the wind
    float n = tfbm(sq, 5) + 0.25 * (tnoise(sq * vec3(1.0, 4.0, 4.0) + 7.0) - 0.5);           // fine fibres
    float cov = uCirrus * (1.0 - uStorm);
    float ci = smoothstep(0.52 - 0.08 * cov, 0.62, n) * cov * 0.6 * exp(-farC / 450.0) * smoothstep(0.0, 0.04, h);
    if (ci > 0.002) {
      vec3 Ts2 = uAir > 0.0 ? exp(-tauToSun(1.0 + zc, e)) : vec3(step(-0.05, e));
      float m2 = max(Ts2.r, max(Ts2.g, Ts2.b));
      vec3 lc2 = m2 > 1e-4 ? Ts2 / m2 : vec3(1.0);
      vec3 Lci = uCloudCol * lc2 * uSunPower * pow(max(m2, 0.0), 0.35) * (0.45 + 0.09 * hg(cs, 0.75)) + skyL * 0.8;
      float trD = 1.0 - cur.a;                                        // what the deck lets through
      // (Thin ice: it mostly adds its light; it hides only a third as much of the sky behind it.)
      cur.rgb += trD * Lci * ci;
      cur.a = 1.0 - trD * (1.0 - ci * 0.35);
    }
  }
  // Temporal accumulation: in the planet's frame the camera only turns, so last frame's clouds are found by
  // direction. Each frame starts its steps at a different offset; blended, a dozen frames act as one march
  // of 60+ steps (no banding or curtains). The wind moves the clouds slowly enough not to smear.
  if (uHist > 0.5) {
    vec3 pv = uPrevView * d;
    if (pv.z < 0.0) {
      vec2 puv = (pv.xy / -pv.z) / uTan * 0.5 + 0.5;
      if (puv.x > 0.0 && puv.x < 1.0 && puv.y > 0.0 && puv.y < 1.0) cur = mix(texture(uPrev, puv), cur, 0.12);
    }
  }
  outColor = cur;
}
`;

// Temperature field on the orbital plane: for each pixel, intersect the view ray with the plane and add
// up the light from every heat source there (S = Σ L/d², Earth = 1). The colour shows what a dark body
// would feel: red too hot for liquid water, green habitable (Kopparapu et al. 2013 flux limits),
// blue cold, fading out where it is far colder than the snow line.
export const TEMP_FIELD_FS = HEAD + `
in vec2 vUV;
uniform mat3 uView;
uniform vec2 uTan;
uniform float uPlaneY;       // plane height relative to the eye
uniform vec4 uSrc[8];        // xyz relative to the eye (AU), w = luminosity (L☉)
uniform int uN;
uniform vec2 uHZ;            // flux at the inner and outer habitable-zone edges
uniform float uAlpha;
out vec4 outColor;
void main() {
  vec3 dv = normalize(vec3((vUV.x * 2.0 - 1.0) * uTan.x, (vUV.y * 2.0 - 1.0) * uTan.y, -1.0));
  vec3 d = transpose(uView) * dv;
  if (abs(d.y) < 1e-6) discard;
  float t = uPlaneY / d.y;
  if (t <= 0.0) discard;
  vec3 p = d * t;
  float S = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= uN) break;
    vec3 q = p - uSrc[i].xyz;
    S += uSrc[i].w / max(dot(q, q), 1e-12);
  }
  float l = log(S) / log(10.0);
  float lIn = log(uHZ.x) / log(10.0), lOut = log(uHZ.y) / log(10.0);
  vec3 col; float a;
  if (l > lIn) {
    // too hot: deep red, turning orange then white-hot where rock melts (~600x Earth's flux)
    float k = clamp((l - lIn) / 2.76, 0.0, 1.0);
    col = mix(vec3(0.55, 0.06, 0.03), vec3(1.0, 0.55, 0.15), smoothstep(0.55, 1.0, k));
    col = mix(col, vec3(1.0, 0.95, 0.85), smoothstep(0.97, 1.3, (l - lIn) / 2.76));
    a = 0.55;
  } else if (l > lOut) {
    float k = (l - lOut) / (lIn - lOut);
    col = mix(vec3(0.1, 0.55, 0.2), vec3(0.25, 0.75, 0.25), k);
    a = 0.5;
  } else {
    float k = clamp((lOut - l) / 3.0, 0.0, 1.0);
    col = mix(vec3(0.05, 0.4, 0.55), vec3(0.02, 0.06, 0.3), k);
    a = 0.5 * (1.0 - smoothstep(0.6, 1.0, k));
  }
  // Soft blend between bands.
  float edge = min(abs(l - lIn), abs(l - lOut));
  col *= 0.85 + 0.15 * smoothstep(0.0, 0.05, edge);
  outColor = vec4(col * a * uAlpha, a * uAlpha);
}
`;
