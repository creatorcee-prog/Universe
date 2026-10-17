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
| Padlock button / chip | Lock onto the selection (or what's in the centre), or unlock. While locked, two-finger drags never pull the view off the object, and you can't zoom inside it |
| **Read** (info card) or book button | Open the book: real-world facts and figures, live numbers from your simulation, an explainer for its kind of object, and sources |
| **Add** tool, tap | Drop the chosen object into a circular orbit around whatever dominates that spot |
| **Add** tool, drag | Fling it. A dashed line predicts its path; a red X marks an impact |
| Time slider | 1 second per second up to 300 million years per second |

On a desktop browser: mouse drag, wheel zoom, shift-drag or right-drag to pan, <kbd>Space</kbd> pause,
<kbd>A</kbd> add tool, <kbd>L</kbd> lock camera, <kbd>B</kbd> open the book, <kbd>,</kbd>/<kbd>.</kbd> slower/faster, <kbd>Delete</kbd> removes the selection.

## Scenarios

Solar System (with Saturn's rings, the asteroid and Kuiper belts, Ceres and Halley's Comet) · Earth & Moon · Jupiter's Moons ·
Moon-Forming Impact · Planet Formation · Binary Star · Rogue Black Hole · Tidal Disruption ·
Galaxy Collision · Empty Star.

## The book

Tap **Read** on any object. Real objects (the Sun, the planets, the Moon, Jupiter's large moons, Ceres, Pluto,
Halley's Comet, Theia) get a reference entry with key figures and facts. Anything you create gets an article on its
kind of object (comet, asteroid, super-Earth, red dwarf, neutron star, supermassive black hole and so on). Every
page about a live object includes its current mass, density, surface gravity, escape velocity, temperature and
orbit, computed from the simulation. The **Contents** tab lists every entry. Text lives in `js/facts.js`, with a
source list on every entry.

## What the simulation does

- **Gravity**: direct-summation N-body, kick-drift-kick leapfrog with an adaptive step (2% of the shortest
  pairwise dynamical time). Units are AU, solar masses and years, so G = 4π². Energy drift for the Solar
  System is about 1e-8 per simulated year.
- **Collisions**: swept-sphere tests (fast bodies cannot tunnel), momentum-conserving mergers, impact
  heating, and debris whose amount scales with impact speed relative to escape speed.
- **Tides**: bodies are torn apart inside the Roche limit, d = R·(2M/m)^⅓.
- **Evolution on merge**: rocky to gas giant (> 10 M⊕), gas to star (> 0.08 M☉, hydrogen fusion), white
  dwarf to neutron star (> 1.44 M☉, the Chandrasekhar limit), neutron star to black hole (> 2.3 M☉).
- **Particles** (asteroids, rings, debris, galaxy stars, up to 16,000) feel the 24 heaviest bodies, with
  per-particle sub-stepping. Ring particles ride analytic circular orbits so they stay stable at any speed,
  and are released as free debris if their planet is destroyed.
- **Comets** grow a blue ion tail and a dust tail pointing away from the strongest star once they come within a few AU.
- **Stars** get radius, temperature, luminosity and black-body colour from main-sequence relations.

### Simplifications

Universe Sandbox also models climate, material composition, rotation and spin, and soft-body
deformation; Pocket Universe models none of these. Gravity is Newtonian, so there is no relativity,
gravitational waves or light lensing. Particles do not attract each other. Galaxies are two softened
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
stellar relations), `js/presets.js` (scenarios), `js/render.js` (canvas renderer), `js/camera.js`,
`js/input.js` (touch gestures), `js/ui.js` (panels), `js/book.js` + `js/facts.js` (the book), `js/main.js` (game loop, add tool, trajectory preview).
