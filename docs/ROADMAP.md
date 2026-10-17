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
