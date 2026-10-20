// Bundles the app into one self-contained HTML file (no server or service worker needed).
// Usage: node tools/build-single.mjs [out.html] [--fragment]
//   --fragment  omit <!doctype>/<html>/<head>/<body> (for hosts that supply their own page skeleton)
//   --external-maps  load assets/maps/* from next to the page instead of inlining them
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const fragment = args.includes('--fragment');
const out = args.find((a) => !a.startsWith('--')) || join(root, 'dist', 'pocket-universe.html');
// Every shader program must have its WebGPU translation, up to date (tools/make_wgsl.mjs).
{
  const { PROGRAMS } = await import('./wgsl-programs.mjs');
  const { programKey } = await import('./glsl2vk.mjs');
  const { WGSL } = await import('../js/wgsl.js');
  const stale = PROGRAMS.filter(([, vs, fs]) => !WGSL[programKey(vs, fs)]).map(([n]) => n);
  if (stale.length) { console.error(`js/wgsl.js is out of date for: ${stale.join(', ')}. Run node tools/make_wgsl.mjs first.`); process.exit(1); }
}
const ORDER = ['units', 'bodies', 'stellar', 'thermal', 'gravzones', 'geography', 'ias15', 'tree', 'coagulate', 'minors', 'physics', 'moons', 'presets', 'camera', 'stars', 'optics', 'magnetic', 'interior', 'render', 'shaders', 'render3d', 'wgsl', 'glgpu', 'gpu', 'input', 'facts', 'book', 'thumbs', 'audio', 'challenges', 'ui', 'main'];

// Each ES module becomes a function scope; imports read from a shared registry.
// Build stamp (month-day hour:minute, UTC), shown in the performance readout and Settings.
const stamp = new Date().toISOString().replace(/^\d{4}-(\d\d)-(\d\d)T(\d\d):(\d\d).*/, '$1$2-$3$4');
let js = `window.__SINGLE_FILE__ = true;\nwindow.__BUILD__ = '${stamp}';\nconst __m = {};\n`;
// Sounds are inlined as data URIs (js/audio.js looks here first).
const audioDir = join(root, 'assets', 'audio');
const sounds = {};
for (const f of readdirSync(audioDir)) if (f.endsWith('.mp3')) sounds[f.slice(0, -4)] = 'data:audio/mpeg;base64,' + readFileSync(join(audioDir, f)).toString('base64');
js += `window.__AUDIO__ = ${JSON.stringify(sounds)};\n`;
// Image maps likewise (js/render3d.js), unless --external-maps: then the page loads them from
// assets/maps/ next to it (the artifact build, which publishes them as separate files to stay under the
// 16 MB page limit).
const external = process.argv.includes('--external-maps');
const mapDir = join(root, 'assets', 'maps');
const maps = {};
if (!external) for (const f of readdirSync(mapDir)) {
  const m = f.match(/^(.*)\.(jpg|png)$/);
  if (m && m[1].endsWith('-4k')) continue;   // (the optional close-up maps: loaded from beside the page, or not at all)
  if (m) maps[m[1]] = `data:image/${m[2] === 'png' ? 'png' : 'jpeg'};base64,` + readFileSync(join(mapDir, f)).toString('base64');
}
js += `window.__MAPS__ = ${JSON.stringify(maps)};\n`;
for (const name of ORDER) {
  let src = readFileSync(join(root, 'js', name + '.js'), 'utf8');
  src = src.replace(/^import\s*\{([\s\S]*?)\}\s*from\s*['"]\.\/([\w-]+)\.js['"];?/gm, (_, names, mod) => {
    if (!ORDER.includes(mod)) throw new Error(`${name}.js imports unknown module ${mod}`);
    // (a module must come after everything it imports, or the app fails at start in the single file only)
    if (ORDER.indexOf(mod) > ORDER.indexOf(name)) throw new Error(`${name}.js imports ${mod}, which comes after it in ORDER`);
    return `const {${names}} = __m.${mod};`;
  });
  if (/^\s*import\s/m.test(src)) throw new Error(`${name}.js has an import the bundler cannot rewrite`);
  const exported = [];
  src = src.replace(/^export\s+(const|let|function|class)\s+([A-Za-z_$][\w$]*)/gm, (_, kw, id) => {
    exported.push(id);
    return `${kw} ${id}`;
  });
  if (/^export\s/m.test(src)) throw new Error(`${name}.js has an export form the bundler does not handle`);
  js += `\n// ---- ${name}.js ----\n__m.${name} = (() => {\n${src}\nreturn { ${exported.join(', ')} };\n})();\n`;
}

const html = readFileSync(join(root, 'index.html'), 'utf8');
const css = readFileSync(join(root, 'css', 'style.css'), 'utf8');
const app = html.slice(html.indexOf('<!--APP-->') + 10, html.indexOf('<!--/APP-->'));
const fonts = html.match(/<link rel="stylesheet" href="https:\/\/fonts[^>]+>/)[0];
const title = '<title>Pocket Universe</title>';
const icon = 'data:image/png;base64,' + readFileSync(join(root, 'icons', 'icon-180.png')).toString('base64');
const head = `${title}
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<meta name="theme-color" content="#04060d">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<link rel="apple-touch-icon" href="${icon}">
${fonts}
<style>
${css}
</style>`;
const body = `${app}\n<script>\n${js}\n</script>`;
const doc = fragment ? `${head}\n${body}\n` : `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n${head}\n</head>\n<body>\n${body}\n</body>\n</html>\n`;
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, doc);
console.log(`wrote ${out} (${(doc.length / 1024).toFixed(0)} KB)`);
