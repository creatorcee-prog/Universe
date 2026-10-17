// Bundles the app into one self-contained HTML file (no server or service worker needed).
// Usage: node tools/build-single.mjs [out.html] [--fragment]
//   --fragment  omit <!doctype>/<html>/<head>/<body> (for hosts that supply their own page skeleton)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const fragment = args.includes('--fragment');
const out = args.find((a) => !a.startsWith('--')) || join(root, 'dist', 'pocket-universe.html');
const ORDER = ['units', 'bodies', 'stellar', 'thermal', 'physics', 'presets', 'camera', 'render', 'shaders', 'render3d', 'input', 'facts', 'book', 'ui', 'main'];

// Each ES module becomes a function scope; imports read from a shared registry.
let js = 'window.__SINGLE_FILE__ = true;\nconst __m = {};\n';
for (const name of ORDER) {
  let src = readFileSync(join(root, 'js', name + '.js'), 'utf8');
  src = src.replace(/^import\s*\{([\s\S]*?)\}\s*from\s*['"]\.\/([\w-]+)\.js['"];?/gm, (_, names, mod) => {
    if (!ORDER.includes(mod)) throw new Error(`${name}.js imports unknown module ${mod}`);
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
