# Backlog

Ideas parked for later, roughly in the order they were asked for. Done items move to the README.

## Earlier list (parked October 2026)

- **Saturn's rings as debris**, as a setting: the drawn rings from afar, and real rocks you can fly
  through up close (a few thousand particles cannot fill 280,000 km of ring from a distance).
- **Collision checks off the main thread** (about 1–3 ms a frame with a big dust cloud). This needs the
  particle storage reworked, since merging changes the list in place.
- **Real elevation for more worlds**: Io, Europa, Ganymede, Callisto, Titan, Pluto and Charon borrow
  relief from similar worlds today.
- **More real asteroid and comet shapes**, e.g. Ryugu, Arrokoth, Lutetia (NAIF / PDS SBN).
- Above 60 fps needs Safari with "Prefer Page Rendering Updates near 60fps" off; the app cannot change it.

## WebGPU rings (from the iPhone screenshots)

- From afar the chunks look like gravel; at that range draw a smooth, detailed ring sheet and blend the
  chunks and the rock swarm in only up close (real ring particles are cm to house-sized).
- The rocks of the close-up swarm render black over the lit ring (likely the Sun direction in its shader).
- Fish-scale ovals where the far chunks hand over to the swarm.
- Labels of planets far behind Saturn show through it (pre-existing).
- Testing note: iPhone Low Power Mode caps web pages at 30 fps (yellow battery icon).

## New list

- **Challenges** inspired by Universe Sandbox's, then famous experiments and calculations
  (e.g. Cavendish, Eratosthenes, Kepler's third law, the Roche limit, a slingshot, the Shoemaker–Levy 9 breakup).
- **Spectrum views**: infrared (thermal glow), ultraviolet, X-ray and gamma. Most of these can come from
  per-body emission models: blackbody heat, hot coronae, accretion disks and pulsars.
- **Clearer info pages** that point the user to the extra detail more obviously.
- **Atmospheres, further**: airglow on the night side, Mars's layered limb hazes, a low-orbit (ISS)
  camera to see Earth's thin blue horizon band. (Thickness readouts, rims visible from afar and Titan's
  detached haze are done.)
- **More lighting**: light reflected by Saturn's rings onto its night side, moonlight on Earth's night
  side, and shadows of big moons on rings. (Planetshine, red eclipses and cast terrain shadows are done.)
- **Black hole heat**. Hawking radiation is only 6 × 10⁻⁸ K × (M☉ / M) (Hawking 1974), far colder
  than the 2.7 K microwave background, so a stellar black hole absorbs more than it emits. The heat
  and X-rays come from the gas falling in (accretion disks reach millions of K). Model that disk as a
  heat and light source.
- **More comets**: a curated set (Hale–Bopp, Encke, 67P, Shoemaker–Levy 9's parent orbit…). The named moons
  and dwarf planets are done.
- **Janus and Epimetheus swapping orbits** needs the planets' flattening (J2) in the moon integrator.
- **Speculative life beyond Earth-like worlds**: Sagan & Salpeter's (1976, ApJS 32, 737)
  "floaters, sinkers and hunters" in Jupiter's clouds, and other plausible ideas from speculative
  evolution, shown as a separate "exotic life" verdict next to the Earth-like checklist.

## Performance notes (iPhone)

- Near Saturn the particle step reads 3.8–5.4 ms on the iPhone (Safari's JavaScriptCore) against about 1 ms
  near Earth, but 1.1–1.4 ms in Chrome either way, and the same when called directly. Not yet explained;
  look again if it grows.

## Better-looking worlds (in progress)

1. Done: generated terrain maps for made-up rocky worlds (render3d.js genStep, shaders.js GEN_FS): warped
   continents with fractal coasts, ridged mountain belts, moisture and tone, made once per world; rock and
   snow along the mountain chains.
2. Clouds for made-up worlds: a generated weather map (streaks, swirling storms), cloud shadows on the
   ground, lit cloud thickness.
3. Gas giants: jets, curling band edges and drifting storms, animated by advecting the pattern (curl noise,
   Bridson et al. 2007).
4. Polish: stronger rim glow for thick or hazy air, a little contrast.
5. Ring debris: real 3D rocks for the few thousand nearest the camera (now flat discs, seen as ovals).
