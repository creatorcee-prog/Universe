// GLSL for the Realistic view (WebGL2). Every surface is procedural: noise sampled on the body's own
// rotating sphere, then coloured by physical state (temperature per point, impacts, tides) each frame.

const HEAD = `#version 300 es
precision highp float;
precision highp int;
`;

// Logarithmic depth: lets one depth buffer cover kilometres to kiloparsecs.
const LOGDEPTH_V = `out float vFragDepth;`;
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
uniform vec4 uImp[8];   // impact direction (body frame) and strength
uniform vec4 uImpB[8];  // x: angular size
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
  for (int i = 0; i < 8; i++) {
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
  vFragDepth = 1.0 + gl_Position.w;
}
`;

export const BODY_FS = HEAD + NOISE + BLACKBODY + `
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
uniform vec4 uImp[8];
uniform vec4 uImpB[8];    // x: angular size, y: age (s)
uniform int uImpN;
out vec4 outColor;

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
    vec3 Nd = normalize(cross(dFdx(vViewPos), dFdy(vViewPos)));
    if (dot(Nd, V) < 0.0) Nd = -Nd;
    N = normalize(mix(N, Nd, uFacet));
  }
  float mu = max(dot(N, V), 0.0);

  // Impacts: fresh ones glow, all leave a scar.
  float glow = 0.0, scar = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= uImpN) break;
    float a = acos(clamp(dot(vObj, uImp[i].xyz), -1.0, 1.0));
    float w = uImpB[i].x;
    scar += uImp[i].w * smoothstep(w * 1.25, w * 0.4, a);
    glow += uImp[i].w * exp(-a * a / (w * w * 0.7)) * exp(-uImpB[i].y / 6.0);
  }
  scar = clamp(scar, 0.0, 1.0);

  if (uKind == 4) { outColor = vec4(0.0, 0.0, 0.0, 1.0); ` + WRITE_DEPTH + ` return; }

  if (uKind == 2 || uKind == 3) {
    vec3 c = blackbody(uTemp);
    if (uKind == 3) {
      vec3 col = mix(c, vec3(1.0), 0.55) * (0.65 + 0.35 * mu) * 1.25;
      outColor = vec4(col + glow, 1.0);
    } else {
      float gran = fbm(vObj * 26.0 + vec3(uTime * 0.12, uTime * 0.07, 0.0), 4);
      // Sunspots: small, and only in the low-latitude belts where real ones appear.
      float sp = vnoise(vObj * 7.0 + uSeed + vec3(uTime * 0.01));
      float spot = smoothstep(0.82, 0.88, sp) * smoothstep(0.55, 0.1, abs(vObj.y)) * uSpots;
      // Limb darkening: the edge shows cooler, higher layers, so it is dimmer and redder.
      vec3 limb = blackbody(uTemp * (0.7 + 0.3 * sqrt(mu)));
      float I = (0.5 + 0.5 * sqrt(mu)) * (0.9 + 0.2 * gran) * (1.0 - 0.75 * spot);
      vec3 col = limb * I * 1.05 + c * glow * 1.5;
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

  if (uKind == 1) {
    float turb = fbm(vec3(vObj.x * 2.0, vObj.y * 7.0, vObj.z * 2.0) + uSeed, 5);
    float b = vObj.y * uBands + turb * 0.9;
    float band = 0.5 + 0.5 * sin(b * 6.2831853);
    col = mix(uColA, uColB, band * uBandK);
    col *= 0.94 + 0.12 * vnoise(vec3(vObj.x * 3.0, vObj.y * 46.0, vObj.z * 3.0) + uSeed);
    if (uStorm.w > 0.0) {
      vec3 sd = normalize(uStorm.xyz);
      vec3 d = vObj - sd * dot(vObj, sd);
      float e = length(vec2(length(d.xz) * 0.55, d.y)) / uStorm.w;
      col = mix(col, uColC, smoothstep(1.0, 0.6, e) * step(0.0, dot(vObj, sd)));
    }
    col = mix(col, vec3(0.1, 0.07, 0.06), scar * 0.8);
  } else {
    float h = fbm(q, 6);
    float sea = 0.3 + 0.36 * uOcean; // fbm is roughly 0.3-0.7, so this tracks the ocean fraction
    float landMask = uOcean > 0.0 ? smoothstep(sea, sea + 0.012, h) : 1.0;
    vec3 land = mix(uColA, uColB, smoothstep(0.32, 0.68, fbm(q * 2.4 + 7.0, 4)));
    if (uLife > 0.0) {
      float green = uLife * smoothstep(255.0, 285.0, T) * smoothstep(335.0, 300.0, T);
      land = mix(land, vec3(0.13, 0.3, 0.11), green * smoothstep(0.62, 0.48, h + 0.1 * lat) * 0.85);
    }
    if (uLineae > 0.0) {
      float l = 1.0 - smoothstep(0.0, 0.025, abs(vnoise(q * 5.0) - 0.5));
      land = mix(land, uColB * 0.7, l * uLineae);
    }
    frozen = smoothstep(272.0, 260.0, T);
    boiled = smoothstep(uBoil, uBoil + 30.0, T);
    vec3 ocean = mix(vec3(0.015, 0.06, 0.18), vec3(0.04, 0.2, 0.42), smoothstep(sea - 0.12, sea, h));
    vec3 seabed = mix(uColB * 0.55, uColA * 0.45, h);
    vec3 ice = vec3(0.86, 0.9, 0.96);
    vec3 seaCol = mix(mix(ocean, ice, frozen), seabed, boiled);
    water = (1.0 - landMask) * (1.0 - frozen) * (1.0 - boiled) * (1.0 - scar);
    col = mix(seaCol, land, landMask);
    // Ice caps creep toward the equator as the planet cools.
    float snow = smoothstep(uSnowLat, uSnowLat + 0.07, lat + 0.12 * (fbm(q * 3.0, 3) - 0.5));
    col = mix(col, ice, snow * smoothstep(290.0, 268.0, T) * uIce);
    if (uCraters > 0.0) {
      float c = crater(vObj * 4.0 + uSeed);
      float c2 = crater(vObj * 11.0 + uSeed * 2.0);
      float bowl = smoothstep(0.18, 0.45, c) * 0.7 + 0.3 * smoothstep(0.15, 0.4, c2);
      float rim = smoothstep(0.42, 0.5, c) * smoothstep(0.6, 0.5, c);
      col *= mix(1.0, 0.84 + 0.18 * bowl + 0.1 * rim, uCraters);
    }
    col *= 1.0 - 0.5 * scar;
  }

  // Lighting.
  vec3 lit = vec3(0.015) + uLc0 * lightTerm(N, uL0) + uLc1 * lightTerm(N, uL1);
  float cloud = 0.0;
  if (uCloud > 0.0) {
    cloud = smoothstep(0.5, 0.74, fbm(vObj * 2.6 + vec3(uTime * 0.03, 0.0, uTime * 0.012) + uSeed * 1.7, 5));
    cloud = clamp(cloud * uCloud * 1.4 + (uCloud > 0.95 ? 0.75 : 0.0), 0.0, 1.0) * (1.0 - boiled * 0.6);
  }
  vec3 Hv = normalize(uL0 + V);
  float spec = pow(max(dot(N, Hv), 0.0), 70.0) * 0.7 * water * (1.0 - cloud);
  col = mix(col, uColC, cloud);
  vec3 outc = col * lit + spec * uLc0;

  // Heat. Rocky worlds grow a dark basalt crust broken by pools of glowing lava; the pools spread
  // and merge as the temperature climbs until the whole surface is molten. Gas giants glow in bands.
  float hot = smoothstep(700.0, 1400.0, T);
  if (hot > 0.0) {
    if (uKind == 1) {
      outc += blackbody(T) * hot * (0.5 + 0.5 * sin(vObj.y * uBands * 6.2831853)) * 1.4;
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
  // Fresh impact sites glow white-hot and fade to a dull red as they cool.
  if (glow > 0.01) {
    float g = clamp(glow, 0.0, 1.0);
    outc += blackbody(1200.0 + 3000.0 * g) * g * 2.6;
  }
  // Tidal stress opens glowing fissures before the body breaks apart.
  if (uCrack > 0.0) {
    float cr = 1.0 - smoothstep(0.0, 0.035, abs(vnoise(q * 8.0) - 0.5));
    outc += vec3(1.0, 0.42, 0.1) * cr * uCrack * 1.4;
  }
  if (uVolc > 0.0) {
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

// Atmosphere shell: a slightly larger sphere drawn from the inside, glowing at the limb.
export const ATMO_FS = HEAD + `
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
  outColor = vec4(uAtmo * uAtmoK * rim * lit * 1.3, 1.0);
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
  vFragDepth = 1.0 + gl_Position.w;
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
    a += (max(0.0, 1.0 - abs(vC.y) * 70.0) + max(0.0, 1.0 - abs(vC.x) * 70.0)) * (1.0 - r) * 0.18;
  } else if (uType == 1) {
    a = exp(-r * r * 5.0) * 0.8;
  } else if (uType == 2) {
    a = exp(-pow((r - uInner) / 0.05, 2.0)) * 0.9 + exp(-pow((r - uInner) / 0.25, 2.0)) * 0.25;
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
  vFragDepth = 1.0 + gl_Position.w;
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
  vec3 hotc = mix(vec3(0.95, 0.38, 0.1), vec3(1.0, 0.94, 0.82), pow(t, 1.4));
  vec3 tang = normalize(-sin(ang) * normalize(uAxU) + cos(ang) * normalize(uAxV));
  float beam = 1.0 + 0.85 * dot(tang, normalize(-vViewPos));
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
  vFragDepth = 1.0 + gl_Position.w;
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
  vFragDepth = 1.0 + gl_Position.w;
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
export const SKY_VS = HEAD + `
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aCol;
layout(location = 2) in float aSize;
uniform mat4 uProj;
uniform mat3 uView;
out vec3 vCol;
void main() {
  vec4 p = uProj * vec4(uView * aPos, 1.0);
  gl_Position = p.xyww;
  gl_PointSize = aSize;
  vCol = aCol;
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
export const MILKYWAY_FS = HEAD + NOISE + `
in vec2 vUV;
uniform mat3 uView;
uniform vec2 uTan;       // tan(fov/2) * aspect, tan(fov/2)
uniform vec3 uGalN, uGalC;
uniform float uBright;
out vec4 outColor;
void main() {
  vec3 dv = normalize(vec3((vUV.x * 2.0 - 1.0) * uTan.x, (vUV.y * 2.0 - 1.0) * uTan.y, -1.0));
  vec3 d = transpose(uView) * dv;
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
export const DOWN_FS = HEAD + `
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
export const COMPOSITE_FS = HEAD + `
in vec2 vUV;
uniform sampler2D uScene, uBloom;
uniform float uBloomK;
out vec4 outColor;
void main() {
  vec3 c = texture(uScene, vUV).rgb + texture(uBloom, vUV).rgb * uBloomK;
  float l = max(c.r, max(c.g, c.b));
  if (l > 0.82) {
    float m = 0.82 + 0.18 * (1.0 - exp(-(l - 0.82) / 0.18));
    c *= m / l;
    c = mix(c, vec3(m), clamp((l - 1.8) / 6.0, 0.0, 0.3));
  }
  outColor = vec4(c, 1.0);
}
`;
