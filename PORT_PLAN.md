# Moving the renderer to WebGPU

The app draws with WebGL 2 today, plus a WebGPU layer laid over it (js/gpu.js, Saturn's rings). The goal is a
WebGPU renderer for everything, with the WebGL one kept as the fallback for browsers without WebGPU.

## Why

- One depth buffer for everything: rings, particles and bodies hide each other properly (the overlay layer has
  to test spheres by hand and gets none of the WebGL post-processing).
- Compute shaders everywhere: particles, gravity and collisions on the GPU (hundreds of thousands to a million
  particles instead of 16,000), precomputed atmosphere tables, GPU-side culling.
- Safari 26 (iOS 26) and every iPhone browser built on it, Brave included, have WebGPU.

## What stays on the CPU

Planet and moon positions need double precision (positions to the metre over billions of km); GPUs work in
32-bit floats. The CPU keeps the N-body integrator, the moon integrator (minors.js), and hands the GPU
positions relative to the camera, as now.

## Stages

Each stage ships behind a Settings switch ("Renderer: WebGPU (beta)"), so the working version is never broken.

1. **Foundation** — WebGPU device and canvas as the main view; shared camera matrices; a reversed-Z 32-bit
   depth buffer (replaces the logarithmic depth trick); an HDR target with the same bloom and tone mapping as
   now; a shader-module system for WGSL; automatic fallback to WebGL on any device error.
2. **Bodies** — port BODY_VS / BODY_FS (planets, moons, stars, surface maps, height and shape maps, eclipses,
   planetshine, terminator shadows), the cloud layer, the dots for tiny bodies, the Milky Way and stars.
3. **Particles and rings** — the existing ring compute and swarm move in; asteroid belts and debris as GPU
   particles; the particle "rocks" look.
4. **Atmospheres** — the scattering shell and sky, with transmittance and scattering tables built once by a
   compute pass (faster than marching every pixel).
5. **Surface view** — terrain mesh with cast shadows, ground and sky.
6. **Exotic** — black-hole lensing and accretion disks, temperature and gravity fields, sprites and glows.
7. **GPU physics** — particle gravity from the bodies, collisions on a spatial grid, and particle self-gravity
   (GPU Barnes–Hut or a particle-mesh solver), for dust clouds and impacts with far more particles.

## How we test

- Shader logic: headless Chrome with software WebGPU, rendering into an off-screen texture
  (tools/gpu-test.html, tools/gpu-shot.mjs), since this machine cannot show a WebGPU canvas.
- Look and speed: screenshots from the iPhone (Brave and Safari). Settings shows WebGPU's state and any
  shader or device errors, so a screenshot of it says what went wrong.
