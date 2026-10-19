# Backlog

Ideas parked for later, roughly in the order they were asked for. Done items move to the README.

## Earlier list (parked October 2026)

- **Saturn's rings as debris**, as a setting: the drawn rings from afar, and real rocks you can fly
  through up close (a few thousand particles cannot fill 280,000 km of ring from a distance).
- **Collision checks off the main thread** (done differently: measured first, the cost was the algorithm, not the
  thread. Each clump searched every body through object properties and the cell hash was a JS Map; flat
  arrays and an open-addressed hash make it 10-18x faster with the same results, e.g. 116 -> 10 ms for ~9,700
  clumps in Planet Formation, 4.6 -> 0.6 ms after a giant impact. A worker would add a frame of lag to merges.)
- **Real elevation for more worlds** (done for Pluto and Charon: New Horizons DEMs, Schenk et al. 2018, about half
  of each mapped, the rest Moon-like relief matched to it). Io, Europa, Ganymede, Callisto and Titan have no
  global elevation maps (only regional stereo and Cassini's sparse altimetry), so they keep borrowed relief.
- **More real asteroid and comet shapes** (done: Ryugu, Lutetia, Šteins from mission models; Arrokoth as two
  ellipsoids with its measured lobe sizes, the PDS model being unreachable from here; Bennu, Ryugu, Eros,
  Itokawa, Lutetia, Šteins and Arrokoth now fly in the Solar System on JPL orbits, with book entries for three).
  Arrokoth's far lobe stretches the surface texture; Tempel 1, Wild 2 and Hartley 2 still borrow 67P's shape.
- Above 60 fps needs Safari with "Prefer Page Rendering Updates near 60fps" off; the app cannot change it.

## WebGPU rings (from the iPhone screenshots)

- From afar the chunks look like gravel; at that range draw a smooth, detailed ring sheet and blend the
  chunks and the rock swarm in only up close (real ring particles are cm to house-sized).
- (Fixed: the close-up rocks are lit, 3D since "Saturn's rings: 3D rocks close up"; checked headless in WebGPU.)
- (Fixed: fish-scale ovals. Chunks bigger than ~3-8 px on screen fade out and the smooth sheet fills in there.)
- (Fixed: labels behind Saturn are hidden.) Gravel from afar: fixed, the smooth sheet draws the rings there.
- Testing note: iPhone Low Power Mode caps web pages at 30 fps (yellow battery icon).

## Recreating the inspiration images (October 2026)

- (Done) 1. Planet limb against a nebula: nebulae are a new kind of object (Create, the Orion Nebula among real
  objects, book pages, info readouts, spectrum views, the classic view, soft gravity, no collisions or tides),
  and the Stellar Nursery scenario frames a dusty world against one.
- (Done) 2. Venus surface: the light under ~90 bar now comes out orange-yellow (blue ~0.1 of red, as Venera
  measured; it was ~1/400 and read pure red), the ground is lit by the overcast as it should be, the ground is
  broken rock with few dunes, and the overcast carries soft east-west streaks from the deck 48 km up. The
  image's crisp cloud texture is not physical from the ground: ~50 km of scattering air blurs anything smaller.
- (Done) 3. Desert sunset: mesas and buttes (flat cap rock over cliffs and talus) wherever the ground is arid,
  on Earth wherever its satellite photo is desert, with dunes there too; the ground takes warm light from the
  bright horizon at sunset. (The clouds' grain in headless captures is their accumulation not settling there.)
- (Done) 4. Solar eclipses from the ground: the share of the Sun a moon covers dims the sunlight, the sky, the
  ground and the glare (the eye adapting), the Sun's disc is cut into a crescent or an annulus, the corona
  shows near totality, and pinch zoom in the surface view (2-75°, a telephoto) brings the crescent close.
  The image's large Moon against blue sky beside the Sun is artistic: an unlit new Moon is invisible in daylight.
- (Done) 5. Red dwarf behind a rocky planet: the TRAPPIST-1 scenario (Agol et al. 2021 masses, radii and
  orbits; book entry; in Create's real objects), red dwarfs given real temperatures, radii and luminosities
  (the old power law made TRAPPIST-1 1,700 K; now 2,557 K and 5.4e-4 L☉), and their discs mottled by the heavy
  spotting of active M dwarfs (true granules are far too small to see).
- (Done) Surface detail: 3D rocks and stones scattered over the ground (1,800 lumpy, turned, half-buried,
  sized as a power law with few boulders and many pebbles; fewer under seas, ice and thick air; a setting),
  shadowed for real by a shadow map rendered from the Sun (rocks shade the ground, each other and themselves);
  no dunes on airless worlds. Fixed: the floor shook in Surface view (the camera was placed before the
  planet's spin advanced, so it lagged one frame).

## New list

- **Challenges** (first set done, Scenarios sheet: a second moon for Earth, Kepler's two-year planet, weighing
  Jupiter from Io as Newton did, tearing the Moon apart at the Roche limit, Shoemaker-Levy 9's breakup, a second
  habitable world, destroying the Earth; each with a hint, live progress and the real science with a source).
  Still to do: Eratosthenes (Earth's size from shadows in Surface view), a gravity slingshot, Cavendish.
- **Spectrum views** (done, first version: Settings, Light seen: infrared thermal / 5-micron giants, UV, X-ray coronae). Was: infrared (thermal glow), ultraviolet, X-ray and gamma. Most of these can come from
  per-body emission models: blackbody heat, hot coronae, accretion disks and pulsars.
- **Clearer info pages** (done: an "In the book" card on the overview with the entry's first line and a chip
  per book page that opens it there; tidier small numbers: ppm, × 10ⁿ, mm/s²; comets no longer "Moon of Sun").
- **Atmospheres, further** (done: oxygen airglow on Earth's (and faintly Venus's) night limb, a detached haze
  layer above Mars's limb, and zoom down to a low orbit, 2% of the radius up, with the view tilting to the
  horizon. Thickness readouts, rims visible from afar and Titan's detached haze were done before.)
- **More lighting** (done: ringshine from the sunlit face of a planet's rings onto its night side, fading toward
  equinox; moonlight from the brightest moon on its planet's night side, as the planetshine is; shadows of
  moons out to Titan on the rings, both the ring sheet and the WebGPU debris.)
- **Black hole heat** (done: a feeding hole shines at 0.1 Mdot c^2 up to Eddington, lights and heats its
  surroundings; a tidal disruption peaks at ~3e10 L_sun, as observed). Was: Hawking radiation is only 6 × 10⁻⁸ K × (M☉ / M) (Hawking 1974), far colder
  than the 2.7 K microwave background, so a stellar black hole absorbs more than it emits. The heat
  and X-rays come from the gas falling in (accretion disks reach millions of K). Model that disk as a
  heat and light source.
- **More comets** (done: Encke, 67P, Tempel 1, Wild 2, Hartley 2, Swift–Tuttle, Hale–Bopp beside Halley). Was: a curated set (Hale–Bopp, Encke, 67P, Shoemaker–Levy 9's parent orbit…). The named moons
  and dwarf planets are done.
- **Janus and Epimetheus swapping orbits** (done: planets' flattening J2 in the moon integrator, and moons down to
  Epimetheus's mass pull on their neighbours; they swap about every 2.3 yr against the real 4 yr, because the
  starting orbits ignore J2 and sit ~60–100 km apart instead of ~50 km).
- **Speculative life beyond Earth-like worlds** (done: an "Exotic life" line under the habitability verdict and
  a "Life as we don't know it" section with sources in the book's live page: Sagan & Salpeter's floaters,
  sinkers and hunters in giant planets, floaters in cold brown dwarfs, Venus cloud microbes, Titan's methane
  life (azotosomes, with the later doubts), oceans under the ice of moons, microbes deep under Mars-like
  worlds, and Forward's Cheela on neutron stars, labelled as fiction).

## Performance notes (iPhone)

- Near Saturn the particle step reads 3.8–5.4 ms on the iPhone (Safari's JavaScriptCore) against about 1 ms
  near Earth, but 1.1–1.4 ms in Chrome either way, and the same when called directly. Not yet explained;
  look again if it grows.

## Better-looking worlds (in progress)

1. Done: generated terrain maps for made-up rocky worlds (render3d.js genStep, shaders.js GEN_FS): warped
   continents with fractal coasts, ridged mountain belts, moisture and tone, made once per world; rock and
   snow along the mountain chains.
2. Done already: clouds for made-up worlds (generated storm clouds and their shadows on the ground). Was: a generated weather map (streaks, swirling storms), cloud shadows on the
   ground, lit cloud thickness.
3. Done (first version): gas giant bands flow: each latitude slides with an alternating jet (flow map, two
   cross-faded copies). To refine: curl-noise eddies (Bridson et al. 2007).
4. Done with the giant atmospheres and the HDR curve.
5. Done: ring debris near the camera are real 3D rocks (lumpy icosahedra, turned at random, flat-shaded, writing
   depth inside the WebGPU renderer); smaller and distant ones stay discs.

## Visual to-do from the user (ranked by impact for effort), with notes

1. Tonemap once, at the end. Done (hybrid): one curve at the end (shaders.js TONEMAP: untouched below 0.75,
   Reinhard shoulder keeping gradations to ~10x white); the sky and atmosphere keep a camera-like compression
   for ordinary brightness, but light past ~3x (the glow around the Sun) passes on to bloom. Earlier: the surface sky's Sun disc now reaches the HDR buffer at full
   brightness (capped at 16x white) and is dimmed by the air once, not twice; the sky keeps its curve. A full
   move to scene-linear output would mean retuning every shader (planets, rings, sprites are display-referred,
   tuned in 0..1). Per-channel transmittance needs dual-source blending (not in WebGL 2; optional in WebGPU).
2. Done: lens flare (Settings toggle under Glow): starburst, halo ring, six ghosts through the centre, hidden
   when the star is (sampled from the scene; in space also a ray test against bodies). Was: halo, starburst, ghosts along the Sun-to-centre line, faded by how much
   of the disc is visible (depth test) and by the air's transmittance.
3. Done: Earth day map from Blue Marble (NASA Visible Earth, July 2004) at 4096x2048, colour-matched to the old
   map per channel; anisotropic filtering on the photo maps. Was: Blue Marble Next Generation, 4096x2048 (8192 would take ~170 MB of GPU
   memory with mipmaps, risky on iPhone), mipmaps and anisotropic filtering, each file under 15 MB.
4. Done (procedural, no image files): rock strata and fractures, pebbles and grit, sand ripples underfoot;
   colour-banded strata on cliffs at any distance; snow patches in hollows near the snow line; dune fields on
   dry flats (after the user's inspiration images). Was: tiling rock, soil, sand (colour + normal), blended by slope,
   height and biome, tinted by the map colour, hash-based tiling, fading with distance.
5. Surface view: curved, lit clouds on a spherical shell at the real cloud height, normals from the noise
   gradient, bright edges toward the Sun, darker bases, a thin cirrus layer. The user also wants volumetric
   clouds and atmospheric fog here (inspiration images to come); volumetrics behind a quality setting.
6. Done: cloud relief in the planet view (bump normal from the cloud thickness's screen slope). Was: bump normal from the cloud-density gradient, so storm tops catch a
   low Sun near the terminator.
7. Done: real atmosphere on gas giants (optics.js giantOptics: H2/He + methane + haze above the cloud tops,
   full at the limb, a quarter over the face since the photo-based colours already include it). Was: Rayleigh (H2/He) + haze Mie through ATMO_FS, cloud tops as the ground,
   replacing RIM_FS's flat rim.
8. Done: mountain ranges at 2-24 km (S2). Was: ridged octaves in mountain zones, denser rings near the camera.

Also: after every shader edit, regenerate js/wgsl.js (the build now refuses otherwise) and check the frame rate
on the phone.

## Surface view (from the user's inspiration images, ranked)

- S1 done (first version): a lit cloud deck with volume (SURFACE_CLOUD_FS, quarter resolution): flat bases,
  puffy sunlit tops, dark undersides, rims near the Sun, hides the Sun when thick. To refine: fine streaks in
  cloud bases from the step count; thin high cirrus; crisper detail (temporal accumulation would allow more
  steps for the same cost).
- S2 done (first version): humid haze (visibility ~100 km dry to ~20 km humid, 1.5 km deep) and valley mist
  (pooled between the mountain ranges' crests and on low coasts, thickest at dawn and dusk), integrated along
  each view ray; mountain ranges at 2-24 km wavelengths (up to ~1.8 km relief in mountain country); more
  skylight on shaded ground (it went black at dawn). To refine: mist could drift and thin with the wind.
- S3 done: planets and moons in the sky are drawn into their own layer and composited through the air (dimmed
  by its transmittance, the air's light in front, clouds in front).
- S4 done: rain (snow below freezing) under thick cloud on worlds with water and air: streaks in four depth
  layers, the deck closing into dark overcast, dimmer sunlight, visibility down to a few km; lightning every
  few to ~20 s in warm heavy rain: a jagged forked bolt from the cloud base, the deck lit around it, the scene
  flashing, thunder after the distance's delay. To refine: splashes and wet ground, a rain sound.
- S5 done: ground detail, strata, snow patches, dunes.

## Ring fixes done
- From farther than ~4 outer ring radii the rings are the smooth sheet (no more gravel look from afar).
- Labels of bodies behind a nearer large disc (moons behind Saturn) are hidden.
- Close-up rocks are 3D (fish-scale billboards remain only for sub-3-pixel rocks).
