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
  - Physically based sky scattering (Rayleigh and Mie per wavelength) instead of the per-gas colour table.
  - Showing other bodies' apparent sizes properly: the Moon from Earth, Jupiter from Europa, Saturn's rings
    across the sky.
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
