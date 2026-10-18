# Pocket Universe

A gravity sandbox for the iPhone, inspired by [Universe Sandbox](https://universesandbox.com/). It is an
original, dependency-free web app (HTML5 canvas + plain JavaScript) that installs to the home screen and
runs offline. It is not affiliated with Giant Army or Universe Sandbox.

You can fling planets into stars, drop a black hole into the Solar System, shred a star with tides, or
collide two galaxies. All of it runs on real Newtonian N-body gravity, at true scale.

## Play it on an iPhone

1. Host the folder on any static HTTPS host. This repo ships a GitHub Pages workflow
   (`.github/workflows/pages.yml`): in the repo's **Settings → Pages**, set **Source** to **GitHub Actions**,
   then push to `main`. The site appears at `https://<user>.github.io/<repo>/`.
2. Open the URL in **Safari**, tap **Share → Add to Home Screen**.
3. Launch it from the home screen. It runs full-screen and keeps working offline (service worker).

No host? `npm run build` writes `dist/pocket-universe.html`, a single self-contained file that runs anywhere,
including straight from the Files app in some browsers.

## Controls

| Gesture | Action |
| --- | --- |
| One-finger drag | Orbit the camera |
| Pinch | Zoom (from kilometres to kiloparsecs) |
| Two-finger drag / twist | Pan / turn |
| Tap | Inspect an object: mass, radius, temperature, orbit, period, eccentricity |
| Double-tap | Lock the camera on an object and zoom to it |
| Lock chip (top) | Unlock. While locked, two-finger drags never pull the view off the object, and you can't zoom inside it. **Surface lock** turns the camera with the planet so the ground stays still |
| **Read** (object panel) or book button | Open the book: real-world facts and figures, live numbers from your simulation, an explainer for its kind of object, and sources |

The layout follows Universe Sandbox's:

- **Bottom bar**
  - Play/pause.
  - Elapsed time and time speed, with « » to step the speed.
  - **＋ Create**, **Sim**, **View** and **Tools**.

  On phones the panels open as sheets above the bar; on tablets and desktops they open as a side panel, so the
  simulation stays usable.
- **Create**: a gallery of every object with rendered thumbnails, filtered by category.
  - Pick one, then tap the view.
  - **Orbit** drops it into a circular orbit around whatever dominates that spot; **Place** drops it at rest
    relative to that body.
  - Drag instead of tapping to fling it. A dashed line predicts its path; a red X marks an impact.
- **Sim**: the fine time-speed slider (1 second per second up to 300 million years per second), collisions,
  restart, clear debris and scenarios.
- **Find** (magnifier, top right): search the scene by name or kind and fly to an object.
- **Create → Real objects**: 28 real bodies with NASA fact-sheet masses and radii, from Phobos to
  Sagittarius A*. Saturn comes with its rings and Betelgeuse in its supergiant phase. A third placement
  method, **Binary**, drops a pair on a mutual orbit.
- **View**: orbit lines (each body's predicted ellipse) and true sizes (no minimum dot size, so you can see
  whether things really touch). Photo mode has a small toolbar for labels, trails, orbits, grid, stars and
  glow.
- **Surface tab**:
  - *Atmosphere*: mass, pressure in kPa, density, speed of sound, scale height, dry lapse rate, elevation
    range and mean molecular mass, from ideal-gas physics. These agree with NASA's values for Earth, Mars
    and Venus to within a few percent.
  - *Sea level*: a slider sets ocean coverage and the climate model responds.
- **View**: style (Realistic, Classic, Pixel), glow, trails, trail colours (by object, orbital velocity or
  temperature), labels, grid, stars, camera lock and reset, and Photo mode.
- **Tools**:
  - Select and look.
  - Create.
  - **Laser**: hold on an object to pour 10¹⁵–10³² W into it. It heats up and melts, its light pushes it
    gently (F = P/c), and once it absorbs more energy than its gravitational binding energy (3GM²/5R) it blows
    apart.
  - Delete.
  - Surface view.
- **Object panel tabs**:
  - *Overview*: mass, radius, temperature, density, surface gravity, escape velocity, and actions.
  - *Motion*: orbit and day length.
  - *Surface* (planets):
    - a live equirectangular map of local temperature or habitability, with the sub-solar point marked;
    - pressure, albedo, oceans and ice;
    - **Seed life** and **Kill all life** buttons.
  - *Composition*: interior and atmosphere as stacked bars.
  - *Star*: luminosity, age, stage, time left and fate.

On a desktop browser: mouse drag, wheel zoom, shift-drag or right-drag to pan, <kbd>Space</kbd> pause,
<kbd>A</kbd> add tool, <kbd>L</kbd> lock camera, <kbd>B</kbd> open the book, <kbd>,</kbd>/<kbd>.</kbd> slower/faster, <kbd>Delete</kbd> removes the selection.

## Scenarios

Solar System (with Saturn's rings, the asteroid and Kuiper belts, Ceres and Halley's Comet) · Earth & Moon · Jupiter's Moons ·
Moon-Forming Impact · Planet Formation · Binary Star · Rogue Black Hole · Tidal Disruption · Supernova ·
Galaxy Collision · Empty Star.

## Views

Switch in the **View** panel.

- **Realistic** (default): WebGL 2 spheres with procedural surfaces that react to the simulation, worked out
  for every point on the surface each frame:
  - *Temperature and ice*: driven by the climate model below. Day sides warm, poles cool, ice caps sit where
    it is colder than −10 °C (limited by the water available), oceans freeze, or boil off at the
    pressure-dependent boiling point, and rock and gas glow at their black-body colour above about 800 K.
  - *Impacts*: each hit dents the surface at the exact spot it landed, glows white-hot, cools to red over a
    few seconds, and leaves a dark scar that turns with the planet.
  - *Tides*: a body stretches toward whatever pulls on it hardest, and glowing fissures open as it nears
    its Roche limit.
  - *Spin*: real axial tilts and rotation periods. The spin rate is capped on screen so fast time-warp
    doesn't strobe.
  - *Saturn's rings*: 9,000 sunlit debris grains, shadowed by the planet. Fly something into them and they
    break loose as free-flying debris.
  - The scene renders into a 4× antialiased HDR buffer, then gets bloom (bright and hot things glow
    into their surroundings; switchable in Settings) and a soft tone curve. The sky is a procedural
    Milky Way with star clouds, dust lanes and faint nebulae.
  - Hot rocky worlds grow a dark basalt crust broken by lava pools that spread as the temperature rises.
  - Stars show granulation, limb darkening and sunspots; black holes have a Doppler-brightened
    accretion disk that flares when they feed.
- **Pixel**: the Realistic scene rendered at low resolution with a limited palette and ordered (Bayer)
  dithering, for screenshots. **Photo mode** (Settings, or the `p` key) hides every control; tap to bring
  them back.
- **Black hole mergers**: black holes and neutron stars emit gravitational waves (the 2.5PN radiation
  reaction, Kidder 1995), so close pairs spiral together at the rate Peters (1964) predicts (checked to
  0.2%) and merge. About 5% of the mass is radiated (4.8% for equal masses), and unequal pairs recoil at
  up to ~175 km/s (González et al. 2007). The *Black Hole Merger* scenario re-creates GW150914: 36 + 29 M☉
  become a 61.9 M☉ hole after radiating 3.06 M☉ (LIGO measured 62 and 3.0). Pairs orbiting faster
  than the screen can show are drawn as smooth ellipses about their centre of mass instead of trails. The
  holes merge when their capture zones touch (15,000 km for stellar holes), not at their real horizons
  (~200 km), because the final orbits last milliseconds.
- **Gravitational lensing**: black holes and neutron stars bend the light of the background sky. Light
  passing at angle θ is deflected by θE²/θ (θE² = 2r_s/D, the point-mass deflection 4GM/c²b); near the
  shadow the strong-deflection limit takes over (Bozza 2002), so a thin photon ring of the whole sky
  forms at the shadow's edge. Stars get two images each, either side of the Einstein ring, with point-lens
  magnifications. The Milky Way is stretched into arcs around the hole. Only the background is lensed:
  planets, particles and the accretion disk behind a hole are drawn unbent for now (the disk has its own
  approximate lensed image).
- **Background music** (Settings → Background music): five ambient tracks, shuffled (each plays once
  before any repeats, never the same twice in a row), fading in over 6 s and out over 8 s, with 30 s of
  silence between them. Loudness-matched (EBU R128, -20 LUFS) and streamed rather than decoded, so they
  use little memory. Pauses when the app is in the background.
- **Sound** (Settings → Sound effects): interface blips, and deep rumbles for giant impacts, tidal
  disruptions, star mergers and supernovae, loud when they happen where you're looking and faint far away.
  A drone swells as you approach a black hole (deeper for heavier holes, louder while it feeds). Close to
  other objects there is ambience: a low engine-like hum near rocky worlds, white dwarfs and neutron stars
  and a deep wind near gas giants and stars, rising as the object fills more of the view; on the ground of
  a world with air the wind's level follows its surface pressure. Interface sounds (Settings → Interface
  sounds, on by default): click for taps, a short sequence for opening panels and placing, a hint when a
  notice appears, an affirmation for loading scenarios or landing, a glitch when something isn't possible.
  Ambience and interface sounds are from Mixkit (free licence, mixkit.co/license). The
  rumbles are almost all below 150 Hz, which phone speakers can't play, so a harmonic bass enhancer adds
  overtones the ear hears as the low pitch (+14 dB in the 200 Hz–1 kHz band). It is off by default (for
  headphones); Settings → "Bass boost for the phone speaker" turns it on.
  Sound starts on the first tap (a browser rule). It plays even with the iPhone on silent, unless
  Settings → "Quiet when the iPhone is on silent" is on (that mode also lets your music keep playing).
- **Clouds** on their own layer above the ground (about 1.2 scale heights up, ~10 km on Earth), casting
  shadows below. They move with simulation time (capped at 0.4 days per real second) on latitude-
  dependent winds: easterly trades, westerlies near 45°, polar easterlies, ~20 m/s; a planet-wide deck
  (Venus, Titan) super-rotates at ~100 m/s (Venus's clouds circle it in about 4 days). Two generations of
  cloud field crossfade every few days, so clouds form, shear and dissipate. Cover follows the climate
  model, so the weather changes as the planet warms, cools or loses its oceans.
- **Image maps** (assets/maps, 2048×1024 equirectangular, 0° longitude at the centre; Solar System Scope /
  NASA sources, CC BY 4.0; built by `tools/make_maps.py`):
  - *Colour*: Mars (brought to true colour), Jupiter (Cassini), Saturn, Uranus, Neptune (pale, as it
    really looks: Irwin et al. 2024; the deep blue of Voyager images is a contrast stretch), Io, Pluto,
    Charon.
  - *Brightness, tinted with each world's own colours*: Mercury (MESSENGER), the Moon (LRO), Callisto,
    Europa, Ganymede, Phobos, Deimos. Venus: Magellan radar brightness (roughness, not colour) for the
    ground and relief, and its own cloud map for the deck, turning with the super-rotation.
  - *Earth*: Blue Marble colours while its climate and life stay Earth-like (otherwise the climate model's
    deserts, ice and seas); land, sea, shelves, mountains and ice decoded from it and a NASA relief map;
    Black Marble city lights. Its real cloud map is not painted on: the generated weather samples it (at
    a new longitude each cloud generation, carried by the winds and storms), so clouds look real but
    still move, form and dissipate — on every world with clouds.
  - *Sun*: a light pattern of active regions; colour, limb darkening, granulation and spots stay physical.
  - *Milky Way*: ESO's 6000-px all-sky panorama (eso0932a, S. Brunier) with its point stars removed (the
    app draws sharp stars over it), 4096×2048, in galactic coordinates.
  - *Real elevation* (`tools/make_heights.py`, 1440×720, 16-bit metres): Earth (NOAA ETOPO 2022, land and
    sea floor), Moon (LRO LOLA, NASA SVS CGI
    Moon Kit), Mars (MGS MOLA MEGDR, PDS), Venus (Magellan global topography, USGS), Mercury (MESSENGER
    DEM, USGS). On the globe its slopes shade the surface (2× exaggerated, as in most planetary
    renders), so craters, basins and volcanoes show along the terminator; in the surface view the ground
    follows it, with generated hills below its resolution. Created worlds borrow the heights of a real
    world of their type, scaled for gravity (relief ~ 1/g).
  - *Real shapes* (`tools/make_shapes.py`): Phobos (NAIF DSK, Ernst et al. 2014), Deimos (Mars Express,
    Thomas), Vesta (Gaskell), and as a pool for other small bodies Eros (NEAR), Itokawa (Hayabusa),
    Bennu, Kleopatra, Geographos, Toutatis, Mithra, Golevka and 1996 HW1 (NASA 3D Resources); comets
    (Halley included) take 67P's (Rosetta). Each is the surface's distance from the centre in every
    direction; created asteroids and planetesimals under ~400 km borrow one at a random orientation
    (larger bodies are pulled round by their gravity).
  - *Donor maps for new worlds*: a world without a map of its own borrows the brightness pattern of a
    real world of its type — cratered, icy, dusty, volcanic, small or giant — at a random orientation,
    tinted with its own colours and climate, so each new world has realistic detail and no two look
    alike.
  - The artifact build loads the maps as separate files (`--external-maps`); the offline single file
    inlines them (~17 MB).
- **Surface view terrain**: standing on a world you see real ground around you, a mesh from your feet to
  ~150 km built from the same continental noise as the globe (Earth's real continents line up), with
  rolling hills, mountain ridges, dunes and crater fields. Ground cover follows the globe's climate
  rules (deserts, vegetation, bare rock on slopes, beaches, polar snow); oceans have waves, sky
  reflections and sun glitter; molten worlds show lava. Distant ground fades into the horizon sky colour
  (aerial perspective), lit by the same scattering model as the sky. On Earth you are placed on the
  nearest land.
- **Planets from space**: Jupiter, Saturn, Uranus and Neptune use measured band layouts (Jupiter's NEB,
  EZ, SEB, the Great Red Spot's zone, festoons, white ovals, polar cyclones) with sheared, domain-warped
  cloud texture and limb darkening; Saturn's rings are a smooth lit sheet with the measured gaps and the
  planet's shadow. Earth gets fractal coastlines, biome colours (rainforest, savanna, desert, boreal
  forest, tundra), spiral storm systems, cumulus fields, aurorae, lightning and point-like city lights.
  Mars shows Syrtis Major, Hellas, Valles Marineris and the Tharsis volcanoes; the Moon irregular maria;
  the Sun sunspot groups with penumbrae and faculae.
- **Surface view**: select a rocky world and tap **Stand on the surface** (Realistic or Pixel view). You stand
  on the ground and turn with the planet; pick the day side, night side or either pole, and drag to look
  around. Time slows so a local day lasts about two minutes. The sky is computed from what is in the
  air (js/optics.js). Each gas scatters light in proportion to its refractivity squared times its King
  factor, and to 1/λ⁴, scaled by the number density from pressure and temperature (CO₂ scatters about 2.3×
  more per molecule than air). Aerosols are chosen by world type: water haze on wet worlds; dust on dry,
  thin-aired ones, which absorbs blue and scatters it more strongly forward; tholin haze where methane is
  photolysed; sulphuric-acid cloud under thick CO₂. Ozone and methane absorb. A ray-marched single-scattering
  model, with a two-stream estimate for multiple scattering, gives Earth's blue sky and red sunsets, Mars's
  butterscotch day and blue sunset, Titan's orange haze and Venus's dim orange murk. The eye adapts to dim
  worlds and at dusk. The same model draws the atmosphere seen from space, and rings arc across the sky
  with the planet's shadow on them (**Add rings** in the info panel puts rings on any planet).
  The readout shows latitude, local temperature, the Sun's height and air pressure. Local temperature uses
  the planet's mean temperature plus latitude, with day/night swings that are small under thick air and large
  on airless ground (the Moon goes from about 390 K at noon to 95 K at night).
- **Surfaces** (Realistic view):
  - *Terrain*: rocky worlds have continents and ridged mountain ranges with relief shading, so slopes catch
    the light near the terminator. Relief scales with 1/g, as real topography does.
  - *Climate*: dry subtropical belts sit near 25–30° (Hadley cells). Coasts have turquoise shelves, and
    worlds with oceans get snow-capped peaks.
  - *Clouds*: swirled and stretched by the winds, heaviest along the equator and the mid-latitude storm
    tracks, and they cast shadows on the ground.
  - *Vegetation*: its colour follows the star (Kiang et al. 2007: blue-green under F stars, green under the
    Sun, olive under K stars, near-black under red dwarfs). New life starts out purple, after the "purple
    Earth" hypothesis (DasSarma & Schwieterman 2018).
  - *Saturn*: the polar hexagon, and its rings cast a shadow on the planet that follows the real ring
    density, Cassini Division included.
  - *Hot giants*: they glow through turbulent bands with dark vortices.
  - *Surface view*: a moving cloud deck overhead, lit white by day and pink-orange at sunset.
- **Earth's real geography**:
  - *Coastlines*: hand-traced continents and major islands (about 2–5° accurate), roughened by noise.
  - *Relief and ice*: the Himalaya, Andes, Rockies, Alps and other ranges, plus the Greenland and Antarctic
    ice sheets.
  - *City lights*: on the night side, clustered along coasts.
- **The Moon's real face**: the maria at their real selenographic positions, Tycho's and Copernicus's
  ray systems, and tidal locking. The Moon and the large moons of Jupiter, Saturn, Neptune and Pluto keep
  the same face toward their planet.
- **Eclipses and transits**: moons and planets cast shadows on each other, with a penumbra as wide as the
  Sun's disc seen from there. Io's shadow crosses Jupiter, and the Moon can eclipse the Sun on Earth.
- **The Great Red Spot**: a spiralling anticyclone at its measured size (about 16,000 km), with a pale
  collar and a turbulent wake. Jupiter's band edges carry sheared eddies and filaments.
- **Stars**: convection cells scale with the star's size. They're fine texture on the Sun, and a few giant
  mottled cells on red supergiants, as imaged on Betelgeuse.
- **Black holes**: the accretion disk's far side is lensed into arcs above and below the shadow, with a
  thin photon ring at the shadow's edge (after Luminet 1979).
- **Paint tool** (Tools → Paint): brush land, water, ice, mountains or scorch marks onto any rocky world.
  Painted water freezes on a cold planet like Mars, and scorch marks glow and cool like impact scars.
- **Classic**: the original 2D canvas renderer. Lighter on battery and older phones.
- **NASA models**: planned, see [docs/ROADMAP.md](docs/ROADMAP.md).

The renderer is written directly against WebGL 2 with no 3D library, so it works offline and adds
about 50 KB.

## Climate model (`js/thermal.js`)

Every planet has a **composition** (mass fractions of iron, silicate rock, water, other ices and
hydrogen/helium) and an **atmosphere** (surface pressure, CO₂ share). Mergers mix compositions by mass.

- **Sunlight**: summed from every star, falling off as 1/d², so distance sets the climate.
- **Albedo**: built from the surface. Ice reflects about 60%, ocean 6%, rock 4–60% depending on the
  material, clouds 55–77%. Polar ice counts for less, because sunlight is weaker there.
- **Greenhouse**: an optical depth from CO₂ (linear when it dominates a thick atmosphere, logarithmic as a
  trace gas), other gases, water vapour (which grows with temperature while there is liquid water), and
  steam.
- **Impacts**: 30% of the collision's kinetic energy becomes heat, divided by the body's heat capacity
  (water about 4× rock per kg, iron about half). The heat leaks out through the surface: quickly while it is
  molten, slowly once a crust forms.
- **Water**: boils at a pressure-dependent point (Clausius–Clapeyron: 373 K at 1 bar, about 570 K at
  Venus's 92 bar), becoming a steam atmosphere that raises the greenhouse further, and rains back out once
  it cools.

- **Atmospheres** are a mix of N₂, O₂, CO₂, CH₄ and H₂, tracked as partial pressures, and they change over
  time:
  - *Escape*: each gas leaks to space according to its Jeans parameter, the ratio of gravitational binding to
    thermal energy for that molecule. Small or hot worlds lose light gases first, which is why the Moon and
    Mercury have none.
  - *Condensation*: CO₂, N₂ and CH₄ freeze onto the cold poles below their frost points and sublimate back as
    it warms, as Mars's and Pluto's do.
  - *Volcanoes and weathering*: young or impact-heated worlds outgas CO₂. Liquid water weathers it into
    rock faster when it is warm, the carbonate–silicate thermostat that keeps Earth temperate.
  - *Life*: living worlds make O₂ and methane, and that oxygen decays without life.
  - Comets and supernova ejecta deliver water, ices, gas and metals.
- **Habitability** checks seven conditions:
  - liquid water;
  - 250–330 K;
  - 0.01–100 bar;
  - enough gravity to keep air;
  - 0.2–3× Earth's sunlight;
  - a solid surface;
  - rock, water and carbon.

  Simple life appears after 300 million years of continuous liquid water and dies out after a thousand years
  without it. The book's live page lists each check. The info card names what fails, most telling first, e.g.
  "Uninhabitable due to too cold and air too thin" for Mars.

Feedbacks happen on their own: move Earth inward past about 0.9 AU and it enters a runaway greenhouse; out
to 1.25 AU and ice-albedo feedback freezes it into a snowball. Climate studies put the real thresholds in
roughly the same places.

Calibration (model / measured mean surface temperature, K): Mercury 419/440, Venus 732/737, Earth 291/288,
Moon 269/250, Mars 220/210, Ceres 161/168, Jupiter 127/124, Saturn 95/95, Uranus 58/59, Neptune 58/59,
Pluto 40/44. Measured values: NASA Planetary Fact Sheets. Threshold references: Kasting et al. (1993),
*Icarus* 101, 108; Kopparapu et al. (2013), *ApJ* 765, 131.

## The book

Tap **Read** on any object. Real objects (the Sun, the planets, the Moon, Jupiter's large moons, Ceres, Pluto,
Halley's Comet, Theia) get a reference entry with key figures and facts. Anything you create gets an article on its
kind of object (comet, asteroid, super-Earth, red dwarf, neutron star, supermassive black hole and so on). Every
page about a live object includes its current mass, density, surface gravity, escape velocity, temperature and
orbit, computed from the simulation. The **Contents** tab lists every entry. Text lives in `js/facts.js`, with a
source list on every entry.

## What the simulation does

- **Gravity**: direct-summation N-body. Every body pulls on every other with the exact inverse-square law;
  by the shell theorem this is exact for spheres that aren't touching.
  - *Integrator*: **IAS15** (Rein & Spiegel 2015, *MNRAS* 446, 1424), the default of the REBOUND research
    code. It is a 15th-order adaptive Gauss–Radau method that keeps errors near the limit of
    double-precision arithmetic. Its step size follows Pham, Rein & Spiegel (2024, *Open Journal of
    Astrophysics*).
  - *General relativity*: a first post-Newtonian (1PN) correction from stars and compact objects, which adds
    Mercury's 43″ per century and the precession of orbits around black holes.
  - *Units and constants*: AU (IAU 2012), solar masses and Julian years, with the Sun's gravitational
    parameter GM☉ = 1.32712440041×10²⁰ m³/s² from JPL DE440, so G = 39.4769 rather than 4π².
  - *Starting orbits*: planets start on JPL's J2000 orbital elements (Standish), with masses from DE440
    (Park et al. 2021, *AJ* 161, 105). Moons are placed so the planet–moon pair keeps its orbit about the
    Sun.

  Measured over 100 simulated years (`node tools/gravitybench.mjs`):

  | Quantity | Simulation | Real |
  | --- | --- | --- |
  | Earth's sidereal year | 365.2601 d | 365.2564 d |
  | Moon's sidereal month | 27.3219 d | 27.3217 d |
  | Lunar nodal cycle | 18.63 yr | 18.61 yr |
  | Mercury's perihelion advance, total | 572″/century | ~575″/century |
  | Mercury's perihelion advance, from relativity | 42.9″/century | 42.98″/century |
  | Energy error | 2×10⁻⁹ | — |

  The remaining differences come from starting with averaged orbital elements rather than JPL's exact state
  vectors, which this build environment could not download.
- **Collisions**: swept-sphere tests (fast bodies cannot tunnel), momentum-conserving mergers, impact
  heating, and debris whose amount scales with impact speed relative to escape speed.
- **Tides**: bodies are torn apart inside the Roche limit, d = R·(2M/m)^⅓. Rubble moonlets that formed from
  debris break up 1.5× further out, partway to the fluid limit (2.456 vs 1.26).
- **Clumping**: debris, dust and ejecta particles have physical sizes from their mass and material density.
  - *Collisions*: touching clumps collide inelastically (restitution 0.3). They stick if the collision leaves
    them gravitationally bound, but not inside the host's Roche limit, where tides pull them apart. This is the
    accretion rule of moon-formation N-body studies (Ida, Canup & Stewart 1997, *Nature* 389, 353).
  - *Moonlets*: clumps above about 3% of the Moon's mass become moonlets, which sweep up debris and merge.
  - *Frame length*: long frames are split so tight disks are followed accurately on slow devices too.
- **Tides**: moons migrate as da/dt = 3(k₂/Q)(m/M)(R/a)⁵na: outward when the planet spins faster than the
  moon orbits, inward otherwise.
  - *Earth–Moon*: recedes 3.73 cm/yr (measured: 3.82, by lunar laser ranging).
  - *Phobos*: falls 1.89 cm/yr (measured: about 1.8).
- **Star mergers** become luminous red novae (V1309 Sco, V838 Mon): a flash of about 10⁵ L☉ that fades over
  months, a shell of gas, and a remnant that stays swollen and cool for decades.
- **Giant impacts**: oblique hits between rocky bodies put part of the debris straight into an orbiting disk,
  up to about 7 planet radii. This stands in for the torques and vapour pressure seen in fluid simulations
  (Canup & Asphaug 2001; Canup 2004), which a point-mass planet can't produce; ballistic debris alone always
  falls back.
  - *Result*: in the Moon-Forming Impact scenario (45°, as in Canup's canonical case) the disk clumps into a
    Moon in about two weeks.
  - *Size*: usually 0.5–0.9 lunar masses at 3.5–4 Earth radii, often with a smaller outer moon. Outcomes vary
    between runs, as they do in the published simulations.
- **Evolution on merge**: rocky to gas giant (> 10 M⊕), gas to star (> 0.08 M☉, hydrogen fusion), white
  dwarf to neutron star (> 1.44 M☉, the Chandrasekhar limit), neutron star to black hole (> 2.3 M☉).
- **Particles** (asteroids, rings, debris, galaxy stars, up to 16,000) feel the 24 heaviest bodies, with
  per-particle sub-stepping.
  - *Self-gravity*: particles that carry mass (impact debris, ejecta, dust clouds) also pull on each other
    and on the bodies. This uses a Barnes–Hut tree (θ = 0.6, about 1% force error) with softening about a
    quarter of the mean particle spacing.
  - *Check*: a cold dust cloud collapses on the analytic free-fall schedule. The simulation reaches 0.84 and
    0.54 of its starting radius at 0.5 and 0.8 of the free-fall time; theory gives 0.837 and 0.531. Ring particles ride analytic circular orbits so they stay stable at any speed,
  and are released as free debris if their planet is destroyed.
- **Comets** grow a blue ion tail and a dust tail pointing away from the strongest star once they come within a few AU.
- **Stars** get radius, temperature, luminosity and black-body colour from main-sequence relations, and they
  age:
  - *Lifetime*: about 10 Gyr × M^−2.5. Main-sequence stars brighten slowly; the Sun is about 30% brighter
    than at birth.
  - *Giant phase*: in the last 10% of their lives stars swell into red giants (about 200 R☉, about 2,000 L☉
    for the Sun) or supergiants (up to about 1,000 R☉ and 10⁵ L☉), losing mass in winds.
  - *Below 8 M☉*: the star sheds a planetary nebula and leaves a white dwarf that cools from about 100 L☉.
  - *8 M☉ and above*: the core collapses in a Type II supernova, leaving a neutron star (below about 20 M☉)
    or a black hole.
  - *White dwarf pushed past 1.44 M☉*: it detonates as a Type Ia supernova and leaves nothing.
  - *Ejecta*: thousands of particles of hydrogen, oxygen, silicon and iron, each with mass. The fast hydrogen
    flies outside and the slower heavy elements stay inside, as in real remnants, and the ejecta enrich
    whatever they hit.
  - *The flash*: its light peaks around 10⁹ L☉ and fades over months, heating any planets nearby.

  Select a star and use **Go supernova** to skip ahead.
- **Temperature zones**: select a star, or any object glowing with its own heat (for example a planet melted
  by a giant impact), and tap **Show temperature zones**. In the Realistic and Pixel views this paints a
  temperature field across the orbital plane, adding up the light of every heat source, so binary stars give
  correctly shaped zones: red too hot, green habitable, blue cold. Rings in the orbital plane show:
  - *molten rock*: equilibrium temperature above 1,400 K;
  - *too hot for liquid water*;
  - *the habitable zone*: Kopparapu et al. 2013 edges, adjusted for the star's temperature, 0.95–1.68 AU for
    the Sun;
  - *cold*;
  - *the water snow line*: 170 K, about 2.7 AU for the Sun (Hayashi 1981);
  - *the ice zone*: out to where nitrogen freezes, about 40 K.

  Zones scale with the source's brightness and update as it ages. A hot planet's zones only appear while its
  heat reaches beyond its own surface, and vanish as it cools.
- **Gravity zones**: select any object and tap **Show gravity zones**. Rings in the orbital plane show, from
  the inside out (zones that lie under the surface are left out):
  - for black holes, *the event horizon* (2GM/c²), *the photon sphere* (1.5×) and *the plunge zone* inside the
    innermost stable orbit (3×, non-spinning);
  - for black holes and neutron stars, where *Sun-like stars are torn apart*: R☉ (M/M☉)^⅓ (Hills 1975), which
    falls inside the horizon above about 10⁸ M☉;
  - *deadly tides for a person*: over 10 g of head-to-foot stretch;
  - *the Roche limit* for a rubble moon of 3 g/cm³ (2.456 (3M/4πρ)^⅓), about 19,000 km for Earth;
  - *stable moon orbits*, out to 0.49 of the Hill sphere (Domingos et al. 2006);
  - *weakly held*, out to the Hill sphere itself (about 1.5 million km for Earth, 0.35 AU for Jupiter), beyond
    which the parent's pull wins.

- **Particle self-gravity on a second core.** The Barnes–Hut tree for debris, dust and ejecta is built
  and walked in a Web Worker; its pull comes back a frame or two later and is applied as one kick over
  the time since the last (particles matched by id). While a swarm collapses faster than that (the gap
  between kicks over 1% of its free-fall time) it is computed on the main thread every frame, so clumping
  is unchanged; falls back to the main thread where workers are unavailable (e.g. opened as a local file).

### Simplifications

Climate, composition and stellar evolution are simple parametric models, not radiative-transfer or
stellar-structure codes. Rotation is visual only (no spin dynamics or tidal locking), and there is no
soft-body deformation.

Gravity is Newtonian plus a first-order relativistic correction:
- It doesn't model strong-field effects such as the innermost stable orbit, gravitational waves or light
  lensing.
- Particles don't feel relativity.
- Planets are spheres, with no oblateness (J2).
- Particles orbiting bodies are stepped separately from their mutual pull, which is applied as frame-level
  kicks.

Galaxies are two softened
mass points with test-particle disks, not self-gravitating dark-matter halos. Planetesimals in
*Planet Formation* are given inflated radii so they collide on a watchable timescale.

## Data sources

- Planet masses, radii and orbital elements: NASA Planetary Fact Sheet,
  https://nssdc.gsfc.nasa.gov/planetary/factsheet/ ; J2000 mean longitudes from JPL
  "Approximate Positions of the Planets", https://ssd.jpl.nasa.gov/planets/approx_pos.html
- Galilean moons: NASA/JPL Solar System Dynamics, https://ssd.jpl.nasa.gov/sats/elem/
- Roche limit (rigid-body form): https://en.wikipedia.org/wiki/Roche_limit
- Mass–luminosity relation: https://en.wikipedia.org/wiki/Mass%E2%80%93luminosity_relation
- Hill sphere (for picking an object's parent): https://en.wikipedia.org/wiki/Hill_sphere
- Tidal disruption, roughly half the stellar debris bound: Rees (1988), *Nature* 333, 523,
  https://doi.org/10.1038/333523a0
- Black-body colour fit: Tanner Helland, "How to Convert Temperature (K) to RGB",
  https://tannerhelland.com/2012/09/18/convert-temperature-rgb-algorithm-code.html

## Development

```sh
npm start          # serve at http://localhost:8080 (ES modules need http, not file://)
npm test           # headless physics checks (orbits, energy drift, impacts, disruption)
npm run build      # single-file build in dist/
npm run icons      # regenerate icons (needs Python + Pillow)
```

Code map: `js/physics.js` (integrator, collisions, particles), `js/bodies.js` (object catalogue and
stellar relations), `js/presets.js` (scenarios), `js/render.js` (Classic 2D renderer, and the overlay for trails and labels), `js/render3d.js` + `js/shaders.js` (Realistic WebGL view), `js/camera.js`,
`js/input.js` (touch gestures), `js/ui.js` (panels), `js/book.js` + `js/facts.js` (the book), `js/main.js` (game loop, add tool, trajectory preview).
