// Builds dist/sound-board.html: every sound slot of the app (js/audio.js SLOTS) with what sets it off and
// the file it plays, each file playable, and a picker per slot. The published board keeps its choices in its
// `db` store (collection "slots", one document per slot: { file, note }); they are copied back into SLOTS.
// Usage: node tools/make_sound_board.mjs   (then publish dist/sound-board.html with assets/audio/* as sounds/*)
import { readdirSync, writeFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { SLOTS } from '../js/audio.js';

const NEW = new Set(['ui-accept-soft', 'ui-accept-soft-b', 'ui-swipe-soft', 'ui-glass-ping', 'ui-sound-on', 'ui-sound-off', 'ui-pack2-5', 'ui-scifi-click', 'ui-button-13', 'ui-click-soft', 'ui-button-click-5', 'ui-se-tone']);
const PACK = new Set(['ui-bleep-01', 'ui-bleep-04', 'ui-bleep-06', 'ui-bleep-07', 'ui-click-03', 'ui-confirm-02', 'ui-confirm-05', 'ui-data-point-01', 'ui-data-point-05', 'ui-denied-02', 'ui-denied-03', 'ui-execute-02']);
const LOOPS = new Set(['rumbleloop', 'amb-engine', 'amb-wind']);
const files = readdirSync('assets/audio').filter((f) => f.endsWith('.mp3') && !f.startsWith('music-')).map((f) => f.slice(0, -4)).sort();
const lib = files.map((f) => {
  const d = +execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', `assets/audio/${f}.mp3`]).toString();
  const used = SLOTS.filter((s) => s[3] === f).length;
  return { f, d: +d.toFixed(2), tag: NEW.has(f) ? 'new' : PACK.has(f) ? 'pack' : used ? 'in use' : 'spare', loop: LOOPS.has(f), cosmic: d > 3 };
});
const data = { slots: SLOTS.map(([id, group, what, file]) => ({ id, group, what, file })), lib };
const tpl = String.raw`<title>Pocket Universe Sound Board</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@500;600&family=IBM+Plex+Sans:wght@400;500&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
/* Layout: a console. Slots as rows of a patch bay (trigger | file | play), the sound library docked beside on wide screens, below on phones. */
:root {
  --bg: #07090c; --panel: #0e1217; --line: #1e252e; --fg: #dfe6ee; --dim: #7f8b98; --accent: #4fb3ff; --new: #ffb547; --ok: #57d68d;
  --display: "Chakra Petch", "Segoe UI", system-ui, sans-serif; --body: "IBM Plex Sans", system-ui, sans-serif; --mono: "IBM Plex Mono", ui-monospace, monospace;
  color-scheme: dark;
}
body { background: var(--bg); color: var(--fg); font: 14px/1.45 var(--body); }
.wrap { padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); padding-block: 20px 40px; max-width: 1280px; margin: 0 auto; display: grid; gap: 18px; }
header { display: flex; flex-wrap: wrap; align-items: end; justify-content: space-between; gap: 12px; border-bottom: 1px solid var(--line); padding-bottom: 14px; }
h1 { font: 600 22px/1.1 var(--display); letter-spacing: .06em; text-transform: uppercase; margin: 0; }
h2 { font: 600 13px/1 var(--display); letter-spacing: .14em; text-transform: uppercase; color: var(--dim); margin: 0; }
.sub { color: var(--dim); max-width: 62ch; margin: 6px 0 0; }
.status { font: 12px var(--mono); color: var(--dim); display: flex; gap: 8px; align-items: center; }
.dot { width: 8px; height: 8px; background: var(--dim); display: inline-block; }
.dot.on { background: var(--ok); } .dot.busy { background: var(--new); }
.grid { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 18px; align-items: start; }
@media (max-width: 900px) { .grid { grid-template-columns: minmax(0, 1fr); } }
.group { border: 1px solid var(--line); background: var(--panel); }
.group > h2 { padding: 12px 14px; border-bottom: 1px solid var(--line); display: flex; justify-content: space-between; }
.row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(170px, 230px) auto; gap: 10px; align-items: center; padding: 10px 14px; border-top: 1px solid var(--line); }
.row:first-of-type { border-top: 0; }
.row.changed { box-shadow: inset 3px 0 0 var(--accent); }
@media (max-width: 560px) { .row { grid-template-columns: minmax(0, 1fr) auto; } .row .what { grid-column: 1 / -1; } }
.what b { display: block; font-weight: 500; }
.what code { font: 11px var(--mono); color: var(--dim); }
.what .was { font: 11px var(--mono); color: var(--accent); }
select, input[type=text] { width: 100%; background: var(--bg); color: var(--fg); border: 1px solid var(--line); border-radius: 0; font: 12px var(--mono); padding: 7px 8px; }
select:focus, input:focus, button:focus-visible { outline: 1px solid var(--accent); outline-offset: 1px; }
button { background: var(--bg); color: var(--fg); border: 1px solid var(--line); border-radius: 0; font: 600 11px var(--display); letter-spacing: .1em; text-transform: uppercase; padding: 7px 10px; cursor: pointer; }
button:hover { border-color: var(--accent); color: var(--accent); }
.play { width: 34px; height: 32px; padding: 0; display: grid; place-items: center; }
.play svg { width: 12px; height: 12px; fill: currentColor; }
.lib { border: 1px solid var(--line); background: var(--panel); position: sticky; top: calc(env(safe-area-inset-top, 0px) + 12px); }
.lib > h2 { padding: 12px 14px; border-bottom: 1px solid var(--line); }
.lib ul { list-style: none; margin: 0; padding: 0; max-height: 70vh; overflow: auto; }
.lib li { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 7px 14px; border-top: 1px solid var(--line); }
.lib li:first-child { border-top: 0; }
.lib .name { font: 12px var(--mono); overflow-wrap: anywhere; }
.lib .meta { font: 11px var(--mono); color: var(--dim); font-variant-numeric: tabular-nums; text-align: right; }
.tag { font: 600 10px var(--display); letter-spacing: .1em; text-transform: uppercase; padding: 1px 5px; border: 1px solid currentColor; margin-left: 6px; }
.tag.new { color: var(--new); } .tag.pack { color: var(--accent); } .tag.use { color: var(--ok); }
.note { grid-column: 1 / -1; }
.note input { font-family: var(--body); }
.legend { font-size: 12px; color: var(--dim); padding: 10px 14px; border-top: 1px solid var(--line); }
.warn { color: var(--new); font: 11px var(--mono); }
@media (prefers-reduced-motion: no-preference) { button, .row { transition: border-color .15s, color .15s, box-shadow .15s; } }
</style>
<div class="wrap">
  <header>
    <div>
      <h1>Sound Board</h1>
      <p class="sub">Every place Pocket Universe plays a sound, what sets it off, and the file it plays. Pick a file for any slot and it saves here; Claude copies your choices into the app.</p>
    </div>
    <div class="status"><span id="dot" class="dot"></span><span id="state">Connecting…</span></div>
  </header>
  <div class="grid">
    <main id="slots" style="display:grid;gap:18px;min-width:0"></main>
    <aside class="lib">
      <h2>Library · <span id="libn"></span> files</h2>
      <ul id="lib"></ul>
      <div class="legend"><span class="tag new">new</span> today's uploads · <span class="tag pack">pack</span> your earlier pack, unused · <span class="tag use">in use</span> playing somewhere now. Loops are cut to repeat seamlessly; a one-shot in a loop slot will click at each repeat.</div>
    </aside>
  </div>
</div>
<script>
const DATA = __DATA__;
const byFile = Object.fromEntries(DATA.lib.map((x) => [x.f, x]));
const choice = {}; // slot -> { file, note } saved on the board
let db = null;
const $ = (s) => document.querySelector(s);
const status = (t, k) => { $('#state').textContent = t; $('#dot').className = 'dot ' + (k || ''); };

let audio = null;
function play(f) { try { if (audio) audio.pause(); audio = new Audio('sounds/' + f + '.mp3'); audio.play().catch(() => {}); } catch (e) {} }
const PLAY = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 1l9 5-9 5z"/></svg>';

function fileOptions(sel, slotIsLoop) {
  return DATA.lib.map((x) => '<option value="' + x.f + '"' + (x.f === sel ? ' selected' : '') + '>' + x.f + (x.tag === 'new' ? '  (new)' : '') + (x.loop ? '  (loop)' : '') + '  ' + x.d.toFixed(1) + ' s</option>').join('');
}

function render() {
  const groups = [...new Set(DATA.slots.map((s) => s.group))];
  $('#slots').innerHTML = groups.map((g) => {
    const rows = DATA.slots.filter((s) => s.group === g);
    return '<section class="group"><h2><span>' + g + '</span><span>' + rows.length + '</span></h2>' + rows.map((s) => {
      const c = choice[s.id], file = (c && c.file) || s.file, changed = file !== s.file;
      const loopSlot = byFile[s.file] && byFile[s.file].loop, warn = loopSlot && byFile[file] && !byFile[file].loop;
      return '<div class="row' + (changed ? ' changed' : '') + '" data-slot="' + s.id + '">' +
        '<div class="what"><b></b><code>' + s.id + '</code>' + (changed ? ' <span class="was">was ' + s.file + '</span>' : '') + (warn ? ' <span class="warn">not a loop: will click</span>' : '') + '</div>' +
        '<select id="sel-' + s.id + '" aria-label="Sound for ' + s.id + '">' + fileOptions(file) + '</select>' +
        '<button class="play" title="Play" aria-label="Play">' + PLAY + '</button>' +
        '<div class="note"><input type="text" id="note-' + s.id + '" placeholder="Note for Claude (optional): louder, quieter, trim…"></div>' +
        '</div>';
    }).join('') + '</section>';
  }).join('');
  for (const s of DATA.slots) {
    const row = document.querySelector('[data-slot="' + s.id + '"]');
    row.querySelector('.what b').textContent = s.what;
    row.querySelector('input').value = (choice[s.id] && choice[s.id].note) || '';
    row.querySelector('select').addEventListener('change', (e) => { save(s.id, { file: e.target.value }); play(e.target.value); });
    row.querySelector('.play').addEventListener('click', () => play(row.querySelector('select').value));
    let t; row.querySelector('input').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => save(s.id, { note: e.target.value }), 700); });
  }
  renderLib();
}

function renderLib() {
  const used = new Set(DATA.slots.map((s) => (choice[s.id] && choice[s.id].file) || s.file));
  $('#libn').textContent = DATA.lib.length;
  $('#lib').innerHTML = DATA.lib.map((x) => {
    const tag = x.tag === 'new' ? '<span class="tag new">new</span>' : used.has(x.f) ? '<span class="tag use">in use</span>' : x.tag === 'pack' ? '<span class="tag pack">pack</span>' : '';
    return '<li><button class="play" data-f="' + x.f + '" aria-label="Play ' + x.f + '">' + PLAY + '</button><span class="name">' + x.f + tag + '</span><span class="meta">' + x.d.toFixed(2) + ' s' + (x.loop ? ' · loop' : '') + '</span></li>';
  }).join('');
  document.querySelectorAll('#lib .play').forEach((b) => b.addEventListener('click', () => play(b.dataset.f)));
}

const pending = {};
async function save(id, patch) {
  choice[id] = { ...(choice[id] || {}), ...patch };
  const row = document.querySelector('[data-slot="' + id + '"]');
  if (patch.file !== undefined) { const keepNote = row.querySelector('input').value; render(); document.getElementById('note-' + id).value = keepNote; }
  if (!db) { status('Not saved: this view cannot reach the board\'s storage', ''); return; }
  pending[id] = (pending[id] || Promise.resolve()).then(async () => {
    status('Saving…', 'busy');
    try { await db.doc('slots/' + id).set({ file: choice[id].file || DATA.slots.find((s) => s.id === id).file, note: choice[id].note || '' }); status('Saved', 'on'); }
    catch (e) { status('Not saved: ' + ((e && e.message) || 'storage refused the write'), ''); }
  });
}

render();
(async () => {
  db = await (window.claude && window.claude.use ? window.claude.use('db') : null);
  if (!db) { status('Read-only here: open it signed in to save choices', ''); return; }
  status('Live', 'on');
  db.collection('slots').onSnapshot((snap) => {
    let any = false;
    for (const d of snap.docs) { const v = d.data(); if (!v) continue; const c = choice[d.id]; if (!c || c.file !== v.file || c.note !== v.note) { choice[d.id] = { file: v.file, note: v.note || '' }; any = true; } }
    if (any && !document.activeElement.matches('input')) render();
  }, () => status('Live updates stopped; reload to see others\' changes', ''));
})();
</script>
`;
writeFileSync('dist/sound-board.html', tpl.replace('__DATA__', JSON.stringify(data)));
console.log('dist/sound-board.html', SLOTS.length, 'slots', lib.length, 'files');
