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
`;
const MAPTEX_VS = `
vec4 mapTex(sampler2D s, vec3 d) {
  return textureLod(s, vec2(atan(-d.z, d.x) / 6.2831853 + 0.5, 0.5 - asin(clamp(d.y, -1.0, 1.0)) / 3.14159265), 0.0);
}
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
  vec3 wp = uRot * p;
  float s = dot(wp, uTideDir);
  wp = (wp - s * uTideDir) / sqrt(1.0 + uTide) + s * uTideDir * (1.0 + uTide);
  vec3 world = uCenter + wp * uRadius;
  vObj = aPos;
  vViewPos = uView * world;
  vN = uView * (uRot * aPos);
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
  return fbm(cq, oct) + 0.12 * spiral;
}
// x: cloud density 0..1, y: how thick (bright tops). px: the body's size on screen (detail level).
vec2 cloudField(vec3 d, float cover, float seed, float px) {
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
export const CLOUD_FS = HEAD + NOISE + CLOUDS + `
in vec3 vObj;
in vec3 vViewPos;
in vec3 vN;
` + LOGDEPTH_F + `
uniform vec3 uL0, uLc0, uL1, uLc1, uColC;
uniform float uCloud, uSeed, uPx, uTime, uEcl;
out vec4 outColor;
void main() {
  vec3 V = normalize(-vViewPos);
  vec3 N = normalize(vN);
  float mu = clamp(dot(N, V), 0.0, 1.0);
  vec2 cf = cloudField(normalize(vObj), uCloud, uSeed, uPx);
  // Seen obliquely, toward the limb, the layer is crossed along a longer path and looks denser.
  float a = 1.0 - pow(1.0 - clamp(cf.x, 0.0, 0.995), 1.0 / max(mu, 0.2));
  float d0 = dot(N, uL0), d1 = dot(N, uL1);
  float lit0 = smoothstep(-0.1, 0.12, d0) * (0.3 + 0.7 * max(d0, 0.0));
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
  outColor = vec4(col * a, a);
  ` + WRITE_DEPTH + `
}
`;

export const BODY_FS = HEAD + NOISE + BLACKBODY + MAPTEX_FS + CLOUDS + `
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
uniform float uCity;       // night-side city lights (Earth)
uniform float uDeckH;      // cloud deck height (body radii), for the shadows
uniform sampler2D uNight;  // where they are (Black Marble), when uNightMap = 1
uniform float uNightMap;
uniform vec4 uOcc[4];      // bodies that can eclipse this one: centre relative to the eye (world axes), radius
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
float eclipse(vec3 P, vec3 L) {
  float s = 0.0;
  for (int i = 0; i < 4; i++) {
    if (i >= uOccN) break;
    vec3 C = uView * uOcc[i].xyz;
    float t = dot(C - P, L);
    if (t <= 0.0) continue;
    float d = length(C - P - L * t);
    float pen = t * uSunAng;
    s = max(s, smoothstep(uOcc[i].w + pen, uOcc[i].w - pen, d));
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
      float I = (0.5 + 0.5 * sqrt(mu)) * (0.9 + 0.2 * gran) * (1.0 - 0.75 * spot) * (1.0 - big * (0.4 * lanes - 0.12)) * (1.0 + big * 0.25 * (warpN - 0.5));
      vec3 col = limb * I * (1.05 + 0.25 * facula) + c * glow * 1.5;
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
      if (cmap) col = mapTex(uMap, vObj).rgb;
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
    // Terrain: continents from low-frequency noise, ridged mountain ranges on land, fine detail.
    float h = fbm(q, 6);
    float sea = 0.3 + 0.36 * uOcean; // fbm is roughly 0.3-0.7, so this tracks the ocean fraction
    // Elevation above sea level, in noise units; dry worlds measure it from their mean surface instead.
    float e = uOcean > 0.0 ? h - sea : h - 0.56;
    float rg = 1.0 - abs(2.0 * vnoise(q * 3.1 + 11.0) - 1.0);
    float rg2 = 1.0 - abs(2.0 * vnoise(q * 7.3 + 3.0) - 1.0);
    float mtn = rg * rg * (0.65 + 0.35 * rg2) * smoothstep(0.0, 0.1, e);
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
      else if (uMapMode > 2.5 && uMapMode < 3.5) mapH = 0.3 * (MP.r - 0.5);
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
      vec3 Nb = normalize(abs(det) * N - grad * 0.05 * uRelief);
      N = normalize(mix(N, Nb, landMask * clamp(uRelief, 0.0, 1.0)));
      day = max(dot(N, uL0), 0.0);
    }
    // Climate zones: wet tropics, dry subtropical belts near 25-30° (Hadley cells), wetter mid-latitudes.
    float desert = exp(-pow(lat - 0.45, 2.0) / 0.012);
    float moist = fbm(q * 1.3 + 31.0, 4) + 0.18 * exp(-lat * lat / 0.02) - 0.3 * desert;
    vec3 land = mix(uColA, uColB, smoothstep(0.32, 0.68, fbm(q * 2.4 + 7.0, 4)));
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
    // Colour map: the real surface colours (with life or seas still drawn on top if the world gets them).
    bool cmapR = uMapMode > 4.5 && uMapMode < 8.5;
    if (uMapMode > 4.5 && uMapMode < 5.5) land = MP.rgb;
    if (uMapMode > 6.5 && uMapMode < 8.5) { float t = 2.0 * MP.r; land = mix(uColB, uColA, clamp(t, 0.0, 1.0)) * t; }
    // Donor map: the borrowed world's light and dark terrain, over this world's own (climate) colours.
    if (uDonorK > 0.0) land *= mix(1.0, clamp(donorT(vObj), 0.15, 2.2), uDonorK);
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
  float ecl = uOccN > 0 ? eclipse(Pc + uView * uCenter, uL0) : 0.0;
  vec3 lit = vec3(0.015) + uLc0 * lightTerm(N, uL0) * (1.0 - 0.85 * rs) * (1.0 - ecl) + uLc1 * lightTerm(N, uL1);
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
  vec3 outc = col * lit + spec * uLc0 * (1.0 - rs) * (1.0 - ecl);
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
uniform vec2 uLocal;        // offset of this spot in the small-scale noise (varies with location)
// Planet-scale elevation at object-space direction d, as on the globe: x = elevation (noise units, 0 at
// sea level), y = mountain ridges 0..1.
vec2 bigTerrain(vec3 d) {
  vec3 q = d * 1.7 + uSeed;
  float h = fbm(q, 6);
  float sea = 0.3 + 0.36 * uOcean;
  float e = uOcean > 0.0 ? h - sea : h - 0.56;
  float rg = 1.0 - abs(2.0 * vnoise(q * 3.1 + 11.0) - 1.0);
  float rg2 = 1.0 - abs(2.0 * vnoise(q * 7.3 + 3.0) - 1.0);
  float mtn = rg * rg * (0.65 + 0.35 * rg2) * smoothstep(0.0, 0.1, e);
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
` + LOGDEPTH_V + `
float terrainH(vec3 d, vec2 p, float res, out vec2 em) {
  em = bigTerrain(d);
  return bigHeight(em) + smallHeight(p, clamp(em.y * 1.5 + 0.15, 0.0, 1.0), res);
}
void main() {
  float r = aPolar.x;
  vec2 p = vec2(cos(aPolar.y), sin(aPolar.y)) * r;
  vec3 d = normalize(uObs + (uEast * p.x + uNorth * p.y) / uRm);
  float res = 0.1 * r + 0.05;            // the mesh's spacing here (rings ~10% apart)
  vec2 em, em0;
  float H = terrainH(d, p, res, em);
  float H0 = terrainH(uObs, vec2(0.0), 0.05, em0);
  float sea = uSeaOK > 0.5 ? 0.0 : -1e9;
  float Href = max(H0, sea);             // stand on the ground, or on the water if it's sea here
  float Hs = max(H, sea);
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
  float gx = (max(terrainH(dxp, p + vec2(ep, 0.0), res, emx), sea) - Hs) / ep;
  float gy = (max(terrainH(dyp, p + vec2(0.0, ep), res, emy), sea) - Hs) / ep;
  vNrm = uView * (uRot * normalize(uObs - uEast * gx - uNorth * gy));
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
` + LOGDEPTH_F + `
uniform vec3 uL0, uSunCol, uAmb;       // sun direction (view), sunlight reaching the ground, sky light
uniform vec3 uEastV, uNorthV, uUpV;    // local axes in view space
uniform vec3 uColA, uColB, uVeg;
uniform float uLife, uTemp, uLatSpan, uIce, uBoil, uSeaOK, uLapse, uTime, uPxAng, uSnowLat;
uniform vec3 uFogExt;                  // ground-level extinction per metre (per channel)
uniform float uFogH;                   // scale height of that haze (m)
uniform vec3 uFogSun, uFogAnti, uSkyZen; // sky colour at the horizon toward / away from the sun, zenith
out vec4 outColor;
void main() {
  float H = vInfo.x, mtnBig = vInfo.y, dist = vInfo.z;
  vec3 V = normalize(-vViewPos);
  float res = max(0.002, dist * uPxAng);            // metres per pixel here
  bool water = uSeaOK > 0.5 && H < 0.0;
  float lat = abs(vDir.y);
  // Temperature here: latitude, then air cooling with height (lapse rate).
  float T = uTemp + uLatSpan * (0.33 - lat * lat) - uLapse * max(H, 0.0) * 0.001;
  vec3 col; vec3 N;
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
    float fres = 0.02 + 0.98 * pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 5.0);
    // Light scattered back up from inside the water: deep blue-green (open ocean reflects ~5-7%).
    vec3 deep = vec3(0.012, 0.05, 0.075) * (uSunCol * max(dot(uUpV, uL0), 0.0) + uAmb);
    col = mix(deep, sky, fres);
    // Sun glitter: the sun's reflection broken up by the waves.
    vec3 Hh = normalize(uL0 + V);
    col += uSunCol * pow(max(dot(N, Hh), 0.0), 600.0) * 6.0 * step(0.0, dot(uUpV, uL0));
    if (frozen > 0.0) {
      vec3 iceCol = vec3(0.8, 0.86, 0.92) * (0.85 + 0.15 * vnoise(vec3(q / 7.0, 1.0)));
      vec3 Ni = uUpV;
      col = mix(col, iceCol * (uSunCol * max(dot(Ni, uL0), 0.0) + uAmb), frozen);
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
    float snow = max(cap, cold) * (1.0 - smoothstep(0.45, 0.7, slope));
    col = mix(col, vec3(0.9, 0.93, 0.97), snow);
    col *= tex;
    // Lambert with a little wrap, sky light from above, and the planet's own heat when molten.
    float ndl = max(dot(N, uL0), 0.0);
    col = col * (uSunCol * ndl + uAmb * (0.55 + 0.45 * dot(N, uUpV)));
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
// Hue-preserving exposure: compress by the brightest channel so bright skies keep their colour.
vec3 tone(vec3 x) {
  float m = max(max(x.r, x.g), max(x.b, 1e-9));
  return x * (1.0 - exp(-m)) / m;
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
out vec4 outColor;
void main() {
  vec3 d = normalize(vViewPos);
  vec3 o = -uCenterV / uPR;
  vec2 top = sphereHit(o, d, uTop);
  if (top.y <= 0.0) discard;
  float t0 = max(top.x, 0.0);
  vec2 ground = sphereHit(o, d, 1.0);
  bool hit = ground.x > 0.0;
  float t1 = hit ? ground.x : top.y;
  vec3 T;
  vec3 L = scatter(o + d * t0, d, t1 - t0, uL0, 1.0, T);
  vec3 col = tone(max(L, 0.0) * uExpo);
  float a = clamp(1.0 - dot(T, vec3(0.3333)), 0.0, 1.0);
  col += uHot * a;
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
uniform int uType;      // 0 star glow, 1 soft bulge, 2 photon ring, 3 pulsar beam
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
out vec4 outColor;
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
` + LOGDEPTH_V + `
void main() {
  vec3 vp = uView * aPos;
  gl_Position = uProj * vec4(vp, 1.0);
  float px = 2.0 * aSize * uF / max(-vp.z, 1e-30);
  vPx = px;
  gl_PointSize = clamp(px, uMinPx, uMaxPx);
  vCol = aCol;
  vShade = aShade;
  vFragDepth = 1.0 + gl_Position.w * ` + DEPTH_K + `;
}
`;

export const POINTS_FS = HEAD + `
in vec3 vCol;
in float vShade;
in float vPx;
` + LOGDEPTH_F + `
uniform int uGlow;
uniform vec3 uLight;   // view space
out vec4 outColor;
void main() {
  vec2 pc = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(pc, pc);
  if (r2 > 1.0) discard;
  if (uGlow == 1) {
    outColor = vec4(vCol * exp(-r2 * 2.5), 1.0);
  } else {
    vec3 n = vec3(pc.x, -pc.y, sqrt(1.0 - r2));
    float lit = vPx < 3.0 ? 0.75 : 0.18 + 0.82 * max(dot(n, uLight), 0.0);
    outColor = vec4(vCol * lit * mix(0.12, 1.0, vShade), 1.0);
  }
  ` + WRITE_DEPTH + `
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

// Procedural Milky Way: a band of unresolved starlight with a brighter bulge toward the galactic
// centre, dark dust lanes along the mid-plane, faint emission nebulae and a dusting of faint stars.
export const MILKYWAY_FS = HEAD + NOISE + LENS + `
in vec2 vUV;
uniform mat3 uView;
uniform vec2 uTan;       // tan(fov/2) * aspect, tan(fov/2)
uniform vec3 uGalN, uGalC;
uniform float uBright;
out vec4 outColor;
void main() {
  vec3 dv = normalize(vec3((vUV.x * 2.0 - 1.0) * uTan.x, (vUV.y * 2.0 - 1.0) * uTan.y, -1.0));
  vec3 d = transpose(uView) * dv;
  bool hidden;
  d = lensSource(d, hidden);
  if (hidden) { outColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
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
export const COMPOSITE_FS = HEAD + FINITE + `
in vec2 vUV;
uniform sampler2D uScene, uBloom;
uniform float uBloomK;
out vec4 outColor;
void main() {
  vec3 c = finite(texture(uScene, vUV).rgb) + finite(texture(uBloom, vUV).rgb) * uBloomK;
  float l = max(c.r, max(c.g, c.b));
  if (l > 0.82) {
    float m = 0.82 + 0.18 * (1.0 - exp(-(l - 0.82) / 0.18));
    c *= m / l;
    c = mix(c, vec3(m), clamp((l - 1.8) / 6.0, 0.0, 0.3));
  }
  outColor = vec4(c, 1.0);
}
`;

// Pixel view: nearest-neighbour upscale of a low-resolution render, posterised to a small palette
// with 4x4 ordered (Bayer) dithering, like hand-made pixel art.
export const PIXEL_FS = HEAD + FINITE + `
in vec2 vUV;
uniform sampler2D uScene, uBloom;
uniform vec2 uLow;
uniform float uScale, uBloomK, uLevels;
out vec4 outColor;
const float BAYER[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
void main() {
  vec2 p = floor(gl_FragCoord.xy / uScale);
  vec2 uv = (p + 0.5) / uLow;
  vec3 c = finite(texelFetch(uScene, ivec2(min(p, uLow - 1.0)), 0).rgb) + finite(texture(uBloom, uv).rgb) * uBloomK;
  float l = max(c.r, max(c.g, c.b));
  if (l > 0.82) { float m = 0.82 + 0.18 * (1.0 - exp(-(l - 0.82) / 0.18)); c *= m / l; }
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
uniform vec3 uRingN;         // ring plane normal (world); zero for no rings
uniform vec2 uRingR;         // inner, outer radius (planet radii)
uniform float uRingProf[16];
uniform vec3 uRingCol;
out vec4 outColor;
void main() {
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
  vec3 Lall = L + (Lring * ringA + Lsun) * T;
  vec3 col = tone(Lall * uExpo);
  float alpha = clamp(max(col.r, max(col.g, col.b)) * 1.4, 0.0, 1.0);
  alpha = max(alpha, ringA * dot(T, vec3(0.3333)));
  // Cloud deck overhead: a flat layer seen in perspective, drifting with the wind, lit by the sunlight
  // that got through the air (so it glows orange-pink at sunset), faint at night.
  if (uCloud > 0.0 && h > 0.02) {
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
  }
  outColor = vec4(col, alpha);
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
