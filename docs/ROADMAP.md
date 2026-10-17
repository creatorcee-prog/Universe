# Roadmap

## Archived for later: "NASA models" view

A third view (listed in Settings as *planned*) that swaps selected objects for real 3D models.

**Sources.** NASA publishes free models in glTF/GLB, OBJ and STL at
https://science.nasa.gov/3d-resources/ : asteroid and comet shape models from spacecraft data
(Bennu from OSIRIS-REx, Eros from NEAR Shoemaker, Itokawa, comet 67P from Rosetta) and spacecraft
(Voyager, Cassini, Juno, JWST, the ISS). NASA media is generally not copyrighted, but each model page
should be checked, and every model credited in the book's sources page.

**Plan.**
1. Add a small glTF 2.0 loader to the WebGL renderer: binary `.glb`, positions, normals and one base-colour
   texture are enough for these assets.
2. Map catalogue entries to models (Asteroid, Comet) and add spacecraft as a new kind of object:
   massless, follows gravity, cannot merge.
3. Keep the procedural effects: impact glow, heat colour and tidal stretching are applied in the vertex and
   fragment shaders, so they can be reused on loaded meshes.
4. Load models lazily and cache them in the service worker; they total tens of MB, so don't put them in
   the single-file build.

**Open questions.** Per-asset licence checks; download size on mobile data; level of detail for
complex models such as the ISS.

## To do (from the October 2026 request)

Done in this round: Pixel view and Photo mode, gravity fixes (particles now fall into black holes and
stars), sim time that keeps pace at low frame rates, stellar evolution and supernovae with separate
material ejecta, dynamic atmospheres, habitability and life, and a first Surface view.

Still open:

- **"Primordial" look.** The Pixel view is a guess: I can't see the other project. A screenshot or a
  description of its palette, pixel size and dithering would let the Pixel view match it.
- **Surface view, next steps.**
  - Close-up terrain: hills, craters and rocks at metre-to-kilometre scale, from a tiled noise heightmap
    near the camera. The ground currently uses the planet-scale texture, so up close it looks smooth.
  - Clouds overhead, rain, snow and fog.
  - ~~Physically based sky scattering~~ (done: js/optics.js and SCATTER in shaders.js).
  - Showing other bodies' apparent sizes properly: the Moon from Earth, Jupiter from Europa. (Rings across the
    sky: done.)
  - Ocean surfaces where there is liquid water, and lava where the ground is molten.
- **Long timescales.** The N-body step is limited by the fastest orbit (a moon going round in days), so
  stellar evolution and the 300-Myr life clock can't be fast-forwarded in a full Solar System. Fix:
  - a Kepler "secular" mode that advances unperturbed orbits analytically;
  - or an option to freeze short-period moons onto their parents while time warps past a threshold.
- **Orbit and gravity checks.** Add an on-screen orbit readout (period, eccentricity) so speeds can be
  compared directly with NASA values.
- **Supernova details.**
  - Neutron-star kicks.
  - A shock wave that strips nearby planets' atmospheres.
  - Remnant nebula glow lasting thousands of years.
  - r-process elements from neutron-star mergers.
- **Atmospheres.**
  - Clouds as their own layer (H₂SO₄ on Venus, ammonia on the giants).
  - Hazes changing colour with the gas mix.
  - Ozone and UV for the life model.
  - Tidal heating, for example Io's volcanoes and Europa's ocean.
- **Life.** Complex life stages (oxygenation, multicellular, intelligence) with their own timers and
  needs.
- **Sound.** Deferred at your request.
- **NASA models view.** Archived above.
- **UI.** A Universe-Sandbox-style bottom control bar, and undo.

## To do (from the Universe Sandbox UI references)

Done: bottom bar with « » speed steps and Create/Sim/View/Tools panels, a thumbnail gallery with Orbit/Place
methods, a tabbed object panel with surface temperature and habitability maps, Seed/Kill life, the laser tool,
the temperature field, velocity- and temperature-coloured trails, surface lock, and richer impacts: scorched
basins, rays, shock rings, steam plumes and meteor craters.

Still open:

- **Create gallery.** Named presets per category, like Universe Sandbox's lists of real moons, planets and
  stars (Phobos, Io, Europa and so on), plus "Random moon" generators and a search box.
- **Placement methods.** *Binary* (two bodies orbiting each other) and *Launch* (aim and power), and a
  "Balance motion" option that keeps the total momentum at zero.
- **Debris.** Tumbling, glowing rock chunks as meshes instead of points; impact plumes as true 3D volumes.
- **Overlays.** Measurement lines between bodies with distances; orbit ellipses (not just trails); a search
  tool.
- **Data views.** More surface maps: elevation, ocean depth, life species.
- **Laser.** Beam radius, wavelength and intensity settings, plus ablation pushing the target harder than
  light pressure.
- **Photo mode toolbar.** Toggles for labels, trails, orbits, zones, grid, background, light and colours
  without leaving Photo mode.

## Gravity: what is left after the IAS15 upgrade

- **Exact starting states**: JPL Horizons state vectors instead of mean elements (Horizons was not reachable
  from the build environment). This would close the last 0.5% on Mercury's precession and the 5-minute
  difference in Earth's year.
- **Oblateness (J2)** of the Sun, Earth, Jupiter and Saturn: moon orbital precession and ring alignment.
- **Strong-field gravity near black holes**: the innermost stable circular orbit, and gravitational-wave
  inspiral for compact binaries (Peters 1964).
- **Particle accretion**: dense particle clumps merging into new bodies, so dust clouds and debris disks can
  build moons and planets.
- **Tides and spin**: tidal locking, tidal migration (the Moon receding 3.8 cm per year) and spin-orbit
  coupling.
- **Speed**: a web worker or WebAssembly force loop for scenes with hundreds of bodies.

## Merging and moon formation: follow-ups

- **Particles at extreme time speeds.** Particles in very tight orbits (inside ~2 planet radii) are lost when a
  single frame spans many of their orbits (around a week per second or more). The fix is a Kepler drift: move
  each particle on its exact orbit around its host and apply other bodies as kicks (Wisdom-Holman, as in
  REBOUND's WHFast).
- **Inner disk.** Material inside the Roche limit should spread viscously, partly falling to the planet and
  partly feeding the moon (Salmon & Canup 2012). For now it stays as a ring.
- **Tidal evolution.** Tides should push the new Moon outward, from about 4 to 60 Earth radii over billions
  of years.
- **Visual overlap vs contact.** Small bodies are drawn at a minimum dot size. Zoomed out, two dots can
  overlap while the bodies are far apart. A "true size" toggle, or a distance readout when dots overlap,
  would make this clear.

## Done in the surfaces round, and what is next

Done: terrain and relief, climate-zone colours, star-dependent and early-purple vegetation, swirled clouds
with shadows, ring shadows and Saturn's hexagon, hot-giant vortices, sky clouds in the surface view,
atmosphere data and sea level, luminous red novae, tides, dense rings, real-object gallery, binary
placement, orbit lines, true sizes, search, the photo toolbar, and particle sub-stepping up to 1024.

Next:
- **Elevation data view**: needs the shader's terrain noise mirrored in JavaScript.
- **City lights**: on the night side of worlds with advanced life.
- **Aurorae**: near the magnetic poles.
- **Lightning**: in storm clouds, as at the end of the reference video.
- **Volumetric clouds**: real 3D clouds seen at a low angle.
- **Inner disk spreading**: after a giant impact.
- **Laser settings**: beam radius and wavelength.
- **Tidal locking**: and planets' spin-down.
- **Launch placement**: aim and power.

## Earth geography, paint, eclipses: what is next

- **Real data**: a real Earth texture (NASA Blue Marble, public domain) and Natural Earth coastlines. The
  hand-traced outlines are about 2–5° accurate; downloads were blocked in the build environment.
- **Paint**: painted water and land don't yet feed the climate model's ocean inventory. Other ideas: undo,
  a vegetation brush, and paint for gas giants (storms).
- **The Moon**: a real topography and albedo map (LRO). Craters at their real positions.
- **Gas giants**: white ovals and polar cyclones (Juno). Uranus and Neptune banding.
- **Stars**: flares, prominences and starspots on M dwarfs.
- **Black holes**: true ray-traced lensing of the background stars.

## Atmospheric scattering (SpaceEngine-style skies): what is next

Done: composition-driven Rayleigh, Mie and absorption coefficients; a single-scattering ray march with
Chapman-function sunlight; two-stream multiple scattering; the same optics for the surface sky and the
limb from space; ring arcs in the sky with planet shadow; the **Add rings** action; relativistic Doppler
beaming (δ⁴) and gravitational redshift on black-hole disks.

Next:
- Aerial perspective on the distant ground and terminator reddening on the surface texture.
- A precomputed (Bruneton-style) table so the march can be cheaper and multiple scattering exact.
- Standing on moons of giant planets: the giant drawn at its true apparent size in the sky.
- Ice-crystal halos and rainbows (22° halo where cirrus clouds are present).
- Gas-giant skies (a "float in the clouds" view).

## Sound: what is next

Done: UI sounds, event rumbles scaled by impact energy and distance, a black-hole drone, bass enhancement
for phone speakers, a mute switch.

Next:
- Stereo panning by where on screen the event is.
- A quiet space ambience, and wind in the Surface view scaled by air pressure (none on airless worlds).
- Check the licence of the supplied sound packs before publishing the app widely.

## iPhone testing round (black boxes, black holes not feeding, lag)

Fixed:
- Black rectangles: NaN pixels from square roots and powers of values that rounding pushed just below
  zero. Desktop GPUs divide exactly, Apple GPUs approximately, so x/x came out a hair above 1. Clamped
  at the source (scattering, limb, faceted normals), and the bloom and composite passes now replace any
  NaN/Inf with black so one bad pixel can never spread into blocks.
- Black holes now eat tidal debris and grow: an accretion-disk step (bound debris inside twice the
  tidal radius drains in about 10 orbits there).
- Particles on close passes the sub-step can't resolve no longer gain energy (they were flung out at
  thousands of km/s); the birth-to-frame-end integrator is adaptive and has a capture test.
- Debris from a body shredded near a black hole continues on its parent's true orbit (1PN to Newtonian
  hand-off using the far-field orbital energy). Tidal disruption now leaves half the debris unbound, as
  for a parabolic orbit (Rees 1988), instead of all of it bound.
- Lag: dynamic resolution (drops 4x multisampling, then resolution down to 55%) and fewer scattering
  samples. Settings → Show performance displays frame rate, physics and drawing time.

Still to check on a real iPhone: that no black boxes remain, and how much the frame rate improves.

## Gravitational waves: what is next
Done: 2.5PN inspiral for black-hole and neutron-star pairs, radiated mass and recoil at merger, the
GW150914 scenario, ellipses for orbits too fast to trail.
Next: a chirp sound rising in pitch as the pair closes in; neutron-star mergers making a kilonova (gold and
platinum ejecta) and a short gamma-ray burst; black-hole spin (Kerr) and its effect on the remnant.
