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

Switch in **Settings → View**.

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
- **Surface view**: select a rocky world and tap **Stand on the surface** (Realistic or Pixel view). You stand
  on the ground and turn with the planet; pick the day side, night side or either pole, and drag to look
  around. Time slows so a local day lasts about two minutes. The sky's colour and brightness come from the
  atmosphere model: blue Rayleigh skies for nitrogen and oxygen, a butterscotch haze for thick CO₂, a dusty
  pink for thin CO₂, orange for methane haze, white for steam, and black with stars where there is no air.
  The readout shows latitude, local temperature, the Sun's height and air pressure. Local temperature uses
  the planet's mean temperature plus latitude, with day/night swings that are small under thick air and large
  on airless ground (the Moon goes from about 390 K at noon to 95 K at night).
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
  without it. The book's live page lists each check.

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
- **Tides**: bodies are torn apart inside the Roche limit, d = R·(2M/m)^⅓.
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
