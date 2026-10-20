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
- (Done) Relief underfoot, lit and casting small shadows: worn small craters on airless worlds, stones and
  gravel half-sunk in the soil (irregular, in patches), sand ripples as real relief; each scale turned and
  warped so no grid shows.
- (Done) Photographed ground near the eye (Poly Haven CC0 scans of soil, sand, rock, lunar regolith and
  forest floor) as colour and relief; fine detail fades by the pixel's real footprint on the ground (the
  long axis at a slant), which removed the streaks that ran away from the eye; sand ripples in patches.
- (Done) Fixed: the ground still shook in Surface view while time ran: the planet's rotation matrix was single
  precision, so the eye, a planet's radius out, was off by up to ~15 cm (Venus) differently each frame; now
  double precision (eye height steady to micrometres; consecutive frames identical).
- (Done) Trails, orbit lines, comet tails and labels are hidden behind worlds and below the horizon (a sight-line
  test against each world big enough to hide something, and the ground you stand on).
- (Done) No rays from the Sun or stars: the lens flare keeps only its round parts (core, halo, ghosts); stars
  are round glows.
- (Done) Updates arrive on one reload (code network-first, the offline cache as fallback); the readout shows
  the build (date and commit) on the website.
- (Done) Cliffs: rock textured from the side as well as from above (triplanar), fine noise in 3D, detail
  faded by the pixel's footprint up the face as well as across the map (no vertical streaks); mesa cliff
  edges no sharper than the ground mesh can draw there (no comb teeth).
- (Done) Cloud types by region and climate: stratus, stratocumulus, cumulus (flat bases, rounded heads,
  deeper in unstable air), cumulonimbus towers with downwind anvils; a closed blanket deck with a wave-churned
  base (asperitas, WMO 2017) on thick-atmosphere worlds (found per pixel, not marched: smooth) and with
  storms on Earth. Marching: coarse steps through clear air, fine ones in cloud (Nubis), so small clouds
  are sampled densely instead of by luck (they were dots of grain). Multiple-scattering light.
- (Done) Smoother clouds: read through a cubic B-spline (Catmull-Rom showed the low-resolution buffer's
  pixels). The sea: a wind sea of 20 directional wave trains (60 m to 0.2 m, deep-water speeds, in groups,
  crests bent) plus capillary ripples; trains finer than a few pixels fade (no sparkle), their slope kept
  as roughness that spreads the Sun's glitter into a path; the footprint exact from distance and angle.
- (Done) Ocean Moon scenario (from a user's picture, the land made sea): Pelagia, a made-up ocean moon locked
  close to Rhodon, a cream-and-rose giant that spans ~34° of its sky; "Facing <planet>" in the Surface view
  for any locked moon (stands where the planet hangs ~25° up, by daylight); Pelagia in the book.
- (Done) Descent: the flat colour flash at the hand-off is gone: the last orbit frame dissolves (1.1 s) into the
  Surface view entered 1.5 km up looking down, which glides to the ground and levels out (2.6 s). Next for a
  true single-renderer descent: the Surface view at any altitude (sky from above the air, the globe beyond the
  150 km terrain, clouds seen from above).
- (Done) Planet Formation glare (user screenshot): impact flashes ride on the body hit (they were pinned where
  the impact happened and left behind along the orbits when sped up), none for bodies falling into a star,
  at most eight at once.
- (Done) Tidal locking: Motion tab shows what a body would lock to, how long its tides would take (Gladman et al.
  1996), how the braking works, the resonance caveat for oval orbits (Mercury 3:2), and a Lock/Unlock toggle.
- (Done) Better supernovae (user references: Cas A by JWST, W49B by Chandra): a volumetric remnant
  (NEBULA_FS uRem) for core-collapse and Type Ia: faint blast-wave rim, a lopsided broken shell of shocked
  ejecta with knots and curling filaments, bubbles inside, a grey-violet dust haze; X-ray band in false colour
  (iron magenta, silicon cyan, sulphur green) like W49B. Free expansion at the ejecta speed for ~200 years,
  then Sedov-Taylor (r ~ t^0.4); brightens over decades, fades over ~10^4 years. Ejecta dots dimmed to knots.
  Light curves: Type II-P plateau ~100 days then the cobalt-56 tail; Type Ia 19-day rise.
- (Done) Magnetic fields (Settings → Magnetic fields; js/magnetic.js): measured dipoles (Connerney 1993; IGRF;
  MESSENGER; Galileo) with their tilts and offsets (Uranus 59°, Neptune 47°), dynamos assumed for giants, stars
  and quickly-turning rocky worlds over 0.3 Earth masses with iron cores; the magnetopause from Chapman-Ferraro
  pressure balance (Earth ~10 radii), the field squeezed on the wind side, drawn into a tail downwind; the
  star's field wound into Parker spirals (45° at 1 AU). Realistic brightness: following a star, the eye now
  adapts to its light (it adapted as if in the dark: a planet near Betelgeuse bloomed into a white blot).
- (Done) Zone views for everything: Settings switches show temperature zones for every heat source and gravity
  zones for the 40 heaviest bodies (each drawn where it is big enough to see), beside per-object ones.
- (Done) Interiors (js/interior.js; user's Earth cross-section as the visual aid): layers with depths, what they
  are, centre temperature and pressure (PREM for Earth, InSight for Mars, Apollo for the Moon, MESSENGER, Juno,
  Cassini, Galileo; elsewhere built from the composition, P ~ M²/R⁴); a drawn cutaway in the Composition tab and
  a 3D cutaway (an orange-segment wedge taken out, CUT_FS ray-tracing the layered faces).
- (Done) Seamless descent: the Surface view works from any height. The sky knows the eye's altitude (from above
  the air the light path starts where it enters it: black sky, the blue limb); from above ~300 m the world is
  drawn as its globe (with its cloud layer seen from above) behind its air via the veil, the terrain blended into
  it toward its 150 km edge and fading out above ~15-35 km; the clouds marched from the ground only below ~3 km.
  The descent: orbit view down to 60 km (2% of the radius on small worlds), a dissolve, then the Surface view
  gliding down geometrically in 7 s, looking down and levelling out over the second half.
- (Done) Shattering destruction (user photos): impacts above the target's binding energy per kilogram
  (Leinhardt & Stewart 2012 universal law: largest remnant 1 - Q_R/2Q*, super-catastrophic beyond 1.8 Q*)
  break rocky worlds into 5-9 fragments (bodies, with gravity; slow ones fall back together, as runs show:
  the largest regathers most of the mass within months) and massive hot debris and dust. While close, each
  fragment is drawn as its cell of the old world (the parent's own look and map), seams molten, the crust charred
  and veined with glowing cracks, the inside of the shell molten through the gaps; the camera follows the largest.
  Zone buttons in the info panel now switch that kind of zone for every object (synced with Settings).
- TODO (user, added, remainder): (none) (match a user photo to ~80%); composition
  info (core, mantle, crust) with a cutaway like the user's Earth cross-section.
- (Done) The Solar System's Moon rides on Earth (minors.js partner): the pair's centre of mass in IAS15, the
  Moon on a Kepler orbit kicked by the Sun's and planets' tides, 128 kicks an orbit (matches a full N-body run
  to ~0.05° after a year, ~0.6° after five). Its month no longer sets every planet's step: at 100x the Solar
  System keeps up (98%, was 45%). Not done: a hybrid integrator (MERCURIUS-like) for Planet Formation at 30x
  and Rogue Black Hole at 30x (30 years a second); both keep up at their default speeds.
- (Done) Mars's pinkish-white ground: its skylight came out brighter than the Sun and blue (the model's sky
  average overweights the blue glow around the Sun); now capped by what the air can scatter down (with
  headroom: Earth unchanged), butterscotch as measured. Placing a body while time runs: the tap point is held
  relative to what it will orbit (it was fixed in space while the planet moved on, so the new body was flung).
  IAS15's corrector stops at 1e-10 (~25% fewer force evaluations, same results over 50 years).
- (Done) Wind per world (user: motion should follow wind speed): windOf() gives the wind near the ground and at
  cloud height (Earth 5/10 m/s, Venus 0.7/60 with its super-rotating deck, Mars 5/15, Titan 0.6/2.5; others
  from air density). Clouds drift with it (and Titan's heaps change shape at its pace), grass sways and bends
  with it (push ~ wind²), the FFT sea's spectrum follows it. Venus's deck: waves faded by a pixel's footprint
  and flattened toward the horizon, where lines of sight grazing them folded into streaks. Storms: mammatus
  regions beside asperitas, chosen once per pixel (choosing per march sample stalled GPUs).
- (Done) Nearby objects through air: particles (ring chunks, debris) drawn in the sky layer and veiled like the
  bodies (Saturn's edge-on rings no longer show through Titan's haze); labels, orbit lines and trails hidden
  where the air passes under 3% of the light or under a closed deck. Titan's deck: soft lumpy methane cloud
  instead of the asperitas blanket, drifting on a sim-time wind clock (stops when paused, at most 120x real)
  and slowly changing shape. (Real Titan from the ground is a nearly featureless haze; its methane clouds are
  real but sparse: an artistic liberty, at the user's request.)
- (Done) Sim speed under load (user: "the sim speed gets slower and capped because of almost everything that
  happens"). An impact in the Solar System used to hold it at 7-11% of the speed asked for (Node, fast CPU): the
  frame was split into up to 24 pieces for the debris's sake, each re-running everything, and only one fitted
  the 8 ms budget. Now the pieces are as many as the budget affords (debris self-gravity skipped when they are
  far too coarse), and particle sub-steps coarsen from ~80 to ~10 an orbit while particles overrun their share:
  100% after the first second. At high speed inner moons (Daphnis, Janus, Adrastea) got under one kick an orbit,
  were knocked into the rings or inside the Roche limit, and freed all 24,000 ring particles (700 ms frames at
  100x); they now follow their Kepler orbits when kicks would be that sparse. Still slow at high speed: Planet
  Formation and Rogue Black Hole at 30x (the bodies' own IAS15 integration; a hybrid Wisdom-Holman integrator,
  as REBOUND's MERCURIUS, would be the fix).
- (Done) Small moons: tidal locking from the despin time (Gladman et al. 1996) for worlds without a set look,
  so "Facing <planet>" works on Epimetheus and the rest; exact sphere geometry for the ground under 300 km
  (it rose in spires) and relief capped to the world's size.
- (Done) Ringed Sky scenario (from a user's photo: a ringed giant in a daytime sky over golden grass): Elysia, a
  grassland moon of Kyklos, on an orbit tilted 30° to the rings so they show open (an equatorial moon sees them
  edge-on). For every world with life: 3D grass blades in the Surface view (48k, out to 20 m, swaying in gusts,
  sunlight through them from behind; with the Rocks setting) and dry grass curing to straw where it is drier.
  "Facing <planet>" and arrival on generated worlds now look for dry land (a CPU copy of the generated map),
  keeping the planet 15° up and the Sun up too.
- Not done from that photo: the Sun's horizontal lens streak (rays were removed at the user's request).
- (Done) FFT ocean (Tessendorf 2001; the user pointed to Xavier Bourry's WebGL ocean): 64 x 64 Phillips-
  spectrum waves of a 9 m/s wind on a 32 m tile, inverse-FFT'd to slopes each frame on the CPU (~1 ms),
  mipmapped; sampled at two scales, turned, with the long swell trains on top (no visible repeat).
- Next: the jagged edge of hills' shadows (shaded per vertex of the ring mesh); Earth's land up close.

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

- (Done) Cloud types from orbit too: honeycomb marine stratocumulus (open and closed cells) in the subtropics,
  storm-anvil clusters along the equator; on the ground the types apply on every world with clouds.
- (Done) Livelier giants: their jets, ovals, the Great Red Spot's turning and short-lived convective outbreaks
  (bright plumes that swell and fade over days, carried by the jets) run on the weather's clock (sim time);
  generic giants' bands flow with alternating jets; a measured layout can be recoloured (Rhodon).
- (Done) Giants in layers turning at their own rates: deeper, darker clouds through gaps in the deck (lagging),
  a high haze in fast streaks (parallax against the deck, shadows at a low Sun).
- Next: Rhodon to look more realistic (the user is finding a reference).

## Plan: towards SpaceEngine's look (from the user, ranked by visual payoff for the effort)
1. (Done: the Yale Bright Star Catalogue, 9,096 stars, tools/make_stars.py -> assets/maps/stars.png, js/stars.js;
   the Milky Way panorama now in the true galactic frame) Real star sky: a real catalogue (~9,000 naked-eye stars; the full Hipparcos ~118,000 costs more) as a data
   file beside the maps; magnitude to HDR brightness (bloom handles the bright ones), colour from B-V through
   the black-body function; lensing bends them for free.
2. (Done: Settings → Brightness (Enhanced / Realistic: true 1/d² light, the eye adapting partway to the light
   where you look; stars brighter when dark-adapted) and Tone curve (Classic default / AgX to compare)) Realistic and enhanced brightness modes: the surface view's eye adaptation in space, with a toggle like
   Universe Sandbox's Space Goggles; test an AgX curve against the current one side by side before switching.
3. (Done: CLOUD_FS cloudDepth, 3 samples through the layer + 2 toward the Sun when a planet is over ~300 px;
   it shades flanks and undersides, the crisp field keeps the coverage) Depth in orbit clouds: a few ray-march steps through the cloud shell at quarter resolution when a planet
   fills the screen, reusing the surface-cloud density and lighting.
4. (Done in part: 4096 x 2048 maps of the Moon, Mars and Mercury (tools/make_maps_4k.py) swapped in only while
   the world is over ~300 CSS px in radius or stood on, released below 150; elevation read through a cubic
   B-spline where magnified (relief smooth up close, no texel blocks). Not done: KTX2/Basis: it needs a WASM
   transcoder shipped offline and compressed-texture support in the WebGPU emulation, a large job for what the
   swap-in/out already buys; precomputed normal maps add nothing over the smooth slopes now.) 4. Sharper planets without running out of memory: higher-resolution maps (artifact files up to 15 MB), 16-bit
   heights and precomputed normal maps; compressed KTX2/Basis (ASTC on iPhone) instead of raw 8K (~180 MB each).
5. (Done, differently: GALGLOW_VS splats the galaxy star particles as soft ~1.6 kpc Gaussians into a quarter-
   resolution buffer, light adding up and disc dust adding optical depth, composited over the scene; it follows
   the collision's tails, which a fixed density field per core could not) 5. Volumetric galaxies: a density field per galaxy core (bulge, disc, spiral arms, dust lanes), marched at
   quarter resolution like the nebula; particle stars on top (the Galaxy Collision scenario).
6. (Stage A done: main.js startDescent/stepDescent, the camera swings over the landing place and dives in, fading
   through the entry colour into the surface view) 6. Seamless descent: (A) an animated descent zooming the globe and crossfading into the surface view;
   (B) a quadtree LOD globe from orbit to ground (the largest job; last).
7. (Done, differently: contrast-adaptive sharpening (AMD CAS) in the composite while the resolution is reduced.
   Temporal reprojection was not done: with planets, moons, particles and clouds all moving on their own, it
   needs per-object motion vectors to avoid ghost trails, a renderer-wide change for this gain.) 7. Keep the frame rate: temporal reprojection to recover sharpness at reduced resolution; test on the iPhone
   after every step; regenerate the WebGPU shader translations after any shader edit.

- [x] Gravity view as a warped-space grid (rubber sheet / Flamm's paraboloid shape, exaggerated depth, compressed so planets show beside the Sun); temperature and gravity switches moved to Settings beside Magnetic fields.
- [x] Tidal disruption: black holes (and other dense bodies) pull stars/planets apart piece by piece into a stream that wraps around and feeds an accretion disk and jets (user photos: NASA/CXC TDE, ESO spaghettification); more realistic black holes.
  - Done: partial disruption (gas stripped from L1/L2 each pass, Guillochon & Ramirez-Ruiz 2013; stripped stars stay puffed, Ryu et al. 2020), new Repeating Tidal Disruption preset (ASASSN-14ko-like), stream coloured by distance from the hole, disk sized/lit by Eddington ratio and tilted to the fed gas's angular momentum, super-Eddington wind as a faint haze. Not done: relativistic jets (only ~1% of TDEs launch one: Swift J1644+57).
