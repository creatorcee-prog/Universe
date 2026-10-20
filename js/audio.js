// Sound: interface blips, and deep rumbles for cosmic events (impacts, tidal disruptions, red novae,
// supernovae) plus a drone that swells as the camera nears a black hole.
//
// The rumbles are almost entirely below 150 Hz, which a phone speaker cannot reproduce (most roll off
// below ~200–300 Hz). So they pass through a "missing fundamental" bass enhancer: a band of the low end
// is soft-clipped to generate harmonics at 2f, 3f, ..., which the ear hears as the original low pitch.
// With headphones the dry signal carries it; on the speaker the harmonics do.
//
// Web Audio needs a user gesture before it will play. On iOS only some events count: touchend, click and
// keydown do, but touchstart and pointerdown from a finger do not, so a context started there stays
// suspended and silent. Every qualifying gesture resumes the context (iOS also suspends it when the app
// is backgrounded or a call comes in) and plays a one-sample silent buffer, which is what WebKit needs
// to unlock output. By default sound plays even with the ring/silent switch on silent ("playback"
// session); Settings can switch to "ambient", which follows the switch and mixes with other audio.

// Every place a sound plays (slot), what sets it off, and the file it plays (assets/audio/<file>.mp3). The
// sound board (tools/sound-board.html, published as its own page) lists these and lets the files be swapped;
// its choices are copied back here (the user's picks of 20 October 2026; the cosmic and ambience slots unchanged).
export const SLOTS = [
  // [slot, group, what plays it, file]
  ['tap', 'Interface', 'Any button or switch with no sound of its own', 'ui-se-tone'],
  ['select', 'Interface', 'Selecting an object', 'ui-scifi-click'],
  ['pause', 'Interface', 'Pause / play', 'ui-click-soft'],
  ['speed', 'Interface', 'Faster / slower buttons', 'ui-glitch'],
  ['view-band', 'Interface', 'Choosing a spectrum (visible, infrared, UV, X-ray)', 'ui-affirm'],
  ['option', 'Interface', 'Choosing an option in a row (view, quality, ...)', 'ui-confirm-02'],
  ['star-type', 'Interface', 'Picking a star type in the star builder', 'ui-confirm-02'],
  ['setting', 'Interface', 'Turning a setting on or off', 'ui-se-tone'],
  ['open-panel', 'Interface', 'Opening a panel (Scenarios, Create, Settings, ...)', 'ui-accept-soft'],
  ['close-panel', 'Interface', 'Closing a panel', 'ui-accept-soft-b'],
  ['tab', 'Interface', 'Switching a tab in the info panel', 'ui-glitch'],
  ['tool', 'Interface', 'Choosing a tool', 'ui-se-tone'],
  ['notice', 'Interface', 'A notice pops up', 'ui-hint'],
  ['photo-mode', 'Interface', 'Photo mode on', 'ui-glitch'],
  ['scenario', 'Actions', 'Loading a scenario', 'ui-pack2-5'],
  ['place-object', 'Actions', 'Placing a new object', 'ui-se-tone'],
  ['place-dust', 'Actions', 'Spraying a dust cloud', 'ui-se-tone'],
  ['rings', 'Actions', 'Adding rings to a world', 'ui-se-tone'],
  ['delete', 'Actions', 'Deleting an object', 'ui-glitch'],
  ['descent', 'Actions', 'Starting the descent to a surface', 'ui-data-point-01'],
  ['land', 'Actions', 'Arriving in the Surface view', 'ui-data-point-05'],
  ['leave-surface', 'Actions', 'Leaving the Surface view', 'ui-data-point-01'],
  ['challenge-done', 'Actions', 'Completing a challenge', 'ui-pack2-5'],
  ['no-surface', 'Not possible', 'Surface view refused (gas world, wrong view)', 'ui-accept-soft-b'],
  ['nothing-to-lock', 'Not possible', 'Lock-on with nothing selected', 'ui-accept-soft-b'],
  ['no-paint', 'Not possible', 'Painting refused (not a rocky world, wrong view)', 'ui-accept-soft-b'],
  ['missed', 'Not possible', 'A tool missed (hold on an object)', 'ui-accept-soft-b'],
  ['denied', 'Not possible', 'The simulation refused something', 'ui-sound-off'],
  ['transform', 'Simulation', 'An object changes kind (star to giant, planet to star, ...)', 'ui-button-13'],
  ['transform-rumble', 'Simulation', 'Low rumble under that change', 'rumble4'],
  ['complete', 'Simulation', 'Something finishes (an orbit closes, a merger settles)', 'ui-swipe-soft'],
  ['impact', 'Cosmic', 'An impact (bigger: louder, deeper, longer)', 'rumble1'],
  ['swallow', 'Cosmic', 'A star or black hole swallows something', 'rumble4'],
  ['tidal', 'Cosmic', 'A world torn apart by tides', 'rumble4'],
  ['nova', 'Cosmic', 'A red nova (two stars merging): first layer', 'rumble4'],
  ['nova-2', 'Cosmic', 'A red nova: second, deeper layer', 'rumble1'],
  ['supernova', 'Cosmic', 'A supernova, collapse or new black hole (52 s)', 'decay'],
  ['star-death', 'Cosmic', 'A gentler star death (planetary nebula)', 'decay'],
  ['bh-merge', 'Cosmic', 'Two black holes merging: first layer', 'rumble4'],
  ['bh-merge-2', 'Cosmic', 'Two black holes merging: second layer', 'rumble1'],
  ['bh-drone', 'Ambience', 'Drone swelling near a black hole (loops)', 'rumbleloop'],
  ['engine-hum', 'Ambience', 'Hum while flying fast close to a world (loops)', 'amb-engine'],
  ['wind', 'Ambience', 'Wind in a thick atmosphere (loops)', 'amb-wind'],
];
const SLOT_FILE = Object.fromEntries(SLOTS.map((s) => [s[0], s[3]]));
// Loudness per file (levels the clips to about the same loudness, from their measured mean volume); files
// not listed (peak-normalised to -3 dB) play at 0.6.
const FILE_GAIN = { 'ui-click': 0.8, 'ui-sequence': 0.95, 'ui-hint': 1.15, 'ui-affirm': 1.35, 'ui-glitch': 0.9, confirm7: 0.85, complete: 1.2,
  rumble1: 1, rumble4: 1, rumbleloop: 1, decay: 1, 'amb-engine': 1, 'amb-wind': 1 };

// Background music: shuffled, each track fading in and out, with 30 s of silence between tracks.
// file -> title (as supplied; Settings lists them and can play any one)
export const MUSIC_TITLES = {
  'music-relax-beat': 'Relax Beat', 'music-drone': 'Drone', 'music-vastness': 'Vastness', 'music-space': 'Space', 'music-valley-sunset': 'Valley Sunset',
  'music-gamma-study': 'Gamma Binaural Beats (study)', 'music-meditation': 'Meditation Background', 'music-binaural-528': 'Meditation Binaural 8 Hz / 528 Hz',
  'music-binaural-14hz': 'Binaural Wave 14 Hz', 'music-drifting-away': 'Drifting Away', 'music-binaural-marlowe': 'Binaural Beats (Marlowe)', 'music-binaural-mountain': 'Binaural Beats (The Mountain)',
};
const MUSIC = Object.keys(MUSIC_TITLES);
const FADE_IN = 6, FADE_OUT = 8, GAP_MS = 30000, MUSIC_LEVEL = 0.5;

// Inlined sounds (single-file build) become blob: URLs, which audio players stream and seek properly.
const blobUrls = {};
function streamUrl(name) {
  if (blobUrls[name]) return blobUrls[name];
  const u = url(name);
  if (!u.startsWith('data:')) return u;
  const bin = atob(u.slice(u.indexOf(',') + 1)), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return (blobUrls[name] = URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' })));
}

function url(name) {
  const inline = typeof window !== 'undefined' && window.__AUDIO__ && window.__AUDIO__[name];
  return inline || `assets/audio/${name}.mp3`;
}

export class Sound {
  constructor(settings) {
    this.settings = settings;
    this.ctx = null;
    this.buf = {};
    this.lastUI = 0;
    this.cool = {};
    this.voices = [];
    const unlock = () => { this.start(); };
    for (const ev of ['touchend', 'pointerup', 'click', 'keydown']) window.addEventListener(ev, unlock, { capture: true, passive: true });
  }

  get on() { return this.settings.sound !== false; }

  start() {
    if (this.ctx) {
      if (this.ctx.state !== 'running') { this.ctx.resume().catch(() => {}); this.kick(); }
      // A tap is the moment the player may start, if it is meant to be playing but was blocked.
      if (this.mEl && this.mState === 'idle' && this.settings.music !== false) this.nextTrack();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.applySession();
    const ctx = (this.ctx = new AC());
    ctx.resume().catch(() => {});
    this.kick();
    this.master = ctx.createGain();
    this.master.gain.value = this.on ? 1 : 0;
    this.master.connect(ctx.destination);
    this.uiBus = ctx.createGain();
    this.uiBus.gain.value = 0.35;
    this.uiBus.connect(this.master);
    // Cosmic bus: dry, plus harmonics generated from the 30–160 Hz band and kept above 180 Hz.
    this.fx = ctx.createGain();
    this.fx.gain.value = 0.8;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.ratio.value = 4; comp.attack.value = 0.02; comp.release.value = 0.4;
    this.fx.connect(comp);
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass'; band.frequency.value = 70; band.Q.value = 0.7;
    const drive = ctx.createGain(); drive.gain.value = 8;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = (i / 1023) * 2 - 1; curve[i] = Math.tanh(2.5 * x) + 0.25 * x * x; }
    shaper.curve = curve;
    shaper.oversample = '2x';
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 180; hp.Q.value = 0.7;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
    const wet = (this.wet = ctx.createGain()); wet.gain.value = this.settings.bassBoost ? 0.22 : 0;
    this.fx.connect(band); band.connect(drive); drive.connect(shaper); shaper.connect(hp); hp.connect(lp); lp.connect(wet); wet.connect(comp);
    comp.connect(this.master);
    for (const file of new Set(Object.values(SLOT_FILE))) this.load(file, file);
    this.startMusic();
  }

  // ---------- background music ----------
  // One audio player, reused for every track: it is first started inside a tap (iOS only lets a player
  // start from a user gesture), and changing its source later keeps that permission. It streams the file
  // (decoding a 4-minute track would take ~80 MB) and plays through Web Audio, because iOS ignores a
  // player's own volume, so fades need a gain node.
  startMusic() {
    if (this.mEl || !this.ctx) { if (this.mEl && this.settings.music !== false && this.mState === 'idle') this.nextTrack(); return; }
    const el = (this.mEl = new window.Audio());
    el.preload = 'auto';
    this.mGain = this.ctx.createGain();
    this.mGain.gain.value = 0;
    this.mBus = this.ctx.createGain();
    this.mBus.gain.value = this.settings.music !== false ? MUSIC_LEVEL : 0;
    try { this.ctx.createMediaElementSource(el).connect(this.mGain); } catch { /* unsupported: no music */ return; }
    this.mGain.connect(this.mBus);
    this.mBus.connect(this.ctx.destination);
    this.mBag = [];
    this.mState = 'idle';
    el.addEventListener('timeupdate', () => {
      if (this.mState !== 'playing' || !(el.duration > 0)) return;
      if (el.currentTime > el.duration - FADE_OUT) {
        this.mState = 'fading';
        const t = this.ctx.currentTime;
        this.mGain.gain.cancelScheduledValues(t);
        this.mGain.gain.setValueAtTime(this.mGain.gain.value, t);
        this.mGain.gain.linearRampToValueAtTime(0, t + Math.max(0.5, el.duration - el.currentTime));
      }
    });
    el.addEventListener('ended', () => this.afterTrack());
    el.addEventListener('error', () => this.afterTrack());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { el.pause(); clearTimeout(this.mTimer); }
      else if (this.settings.music !== false) {
        if (this.mState === 'playing' || this.mState === 'fading') el.play().catch(() => {});
        else if (this.mState === 'waiting') this.mTimer = setTimeout(() => this.nextTrack(), GAP_MS);
      }
    });
    if (this.settings.music !== false) this.nextTrack();
  }

  // Shuffle: every track once in random order, then a new order (never the same track twice in a row).
  pickTrack() {
    if (!this.mBag.length) {
      const bag = MUSIC.slice();
      for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; }
      if (bag[0] === this.mLast && bag.length > 1) [bag[0], bag[1]] = [bag[1], bag[0]];
      this.mBag = bag;
    }
    return (this.mLast = this.mBag.shift());
  }

  nextTrack() {
    if (!this.mEl || this.settings.music === false) { this.mState = 'idle'; return; }
    clearTimeout(this.mTimer);
    const el = this.mEl, name = this.mForce || this.pickTrack();
    this.mForce = null;
    el.src = streamUrl(name);
    this.mState = 'playing';
    this.mTrack = name;
    const t = this.ctx.currentTime;
    this.mGain.gain.cancelScheduledValues(t);
    this.mGain.gain.setValueAtTime(0, t);
    this.mGain.gain.linearRampToValueAtTime(1, t + FADE_IN);
    el.play().catch(() => { this.mState = 'idle'; }); // blocked: try again on the next tap
  }

  // Play one track now (Settings' track list), fading in as usual; the shuffle carries on after it.
  playTrack(name) {
    this.start();
    if (!this.mEl || !MUSIC_TITLES[name]) return;
    this.mForce = name;
    this.nextTrack();
  }

  afterTrack() {
    this.mGain.gain.setValueAtTime(0, this.ctx.currentTime);
    this.mState = 'waiting';
    clearTimeout(this.mTimer);
    this.mTimer = setTimeout(() => this.nextTrack(), GAP_MS);
  }

  setMusic(on) {
    if (!this.ctx) { if (on) this.start(); return; }
    const t = this.ctx.currentTime;
    if (this.mBus) { this.mBus.gain.cancelScheduledValues(t); this.mBus.gain.setValueAtTime(this.mBus.gain.value, t); this.mBus.gain.linearRampToValueAtTime(on ? MUSIC_LEVEL : 0, t + 1.5); }
    if (on) { if (!this.mEl) this.startMusic(); else if (this.mState === 'idle') this.nextTrack(); }
    else if (this.mEl) { clearTimeout(this.mTimer); setTimeout(() => { if (this.settings.music === false) { this.mEl.pause(); this.mState = 'idle'; } }, 1600); }
  }

  // A silent one-sample sound, started inside the gesture: WebKit only opens audio output once something
  // has been played from a user gesture.
  kick() {
    try {
      const s = this.ctx.createBufferSource();
      s.buffer = this.ctx.createBuffer(1, 1, 22050);
      s.connect(this.ctx.destination);
      s.start(0);
    } catch { /* ignore */ }
  }

  // iOS 16.4+: whether sound follows the silent switch.
  applySession() {
    try { if (navigator.audioSession) navigator.audioSession.type = this.settings.soundSilent ? 'ambient' : 'playback'; } catch { /* not supported */ }
  }

  async load(name, file) {
    try {
      const u = url(file);
      let data;
      if (u.startsWith('data:')) {
        // Inlined in the single-file build: decode the base64 directly (no fetch, so no network policy).
        const bin = atob(u.slice(u.indexOf(',') + 1));
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        data = bytes.buffer;
      } else data = await (await fetch(u)).arrayBuffer();
      const b = await new Promise((ok, fail) => this.ctx.decodeAudioData(data, ok, fail));
      this.buf[name] = b;
    } catch { /* missing or undecodable: stay silent */ }
  }

  // The harmonic bass enhancer is only for phone speakers; with headphones the dry low end is heard as is.
  setBassBoost(on) {
    if (this.wet) this.wet.gain.setTargetAtTime(on ? 0.22 : 0, this.ctx.currentTime, 0.1);
  }

  setEnabled(on) {
    if (on) this.start();
    if (!this.master) return;
    this.master.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.05);
  }

  // Interface sound. Calls within 40 ms of each other collapse to the first. The generic click is a
  // fallback, played a tick after the tap, and skipped if the tap's handler already made a sound.
  ui(name, fallback = false) {
    const now = performance.now();
    if (now - this.lastUI < (fallback ? 400 : 40)) return;
    this.lastUI = now;
    // Interface sounds are off for now (Settings → Interface sounds turns them back on).
    const file = SLOT_FILE[name];
    if (!this.on || !this.settings.uiSound || !this.ctx || !this.buf[file]) return;
    const s = this.ctx.createBufferSource();
    s.buffer = this.buf[file];
    const g = this.ctx.createGain();
    g.gain.value = FILE_GAIN[file] ?? 0.6;
    s.connect(g); g.connect(this.uiBus);
    s.start();
  }

  // A rumble: gain 0..1, playbackRate for pitch (lower = bigger), and how long before it fades
  // (the source clips run 12–52 s; small events are cut short).
  rumble(slot, gain, rate = 1, hold = 30) {
    const file = SLOT_FILE[slot], b = this.buf[file];
    gain *= FILE_GAIN[file] ?? 0.6;
    if (!this.on || !this.ctx || !b || gain < 0.02) return;
    const t = this.ctx.currentTime;
    const s = this.ctx.createBufferSource();
    s.buffer = b;
    s.playbackRate.value = rate;
    const g = this.ctx.createGain();
    const len = b.duration / rate;
    const end = Math.min(len, hold);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.03);
    if (end < len) {
      g.gain.setValueAtTime(gain, t + end * 0.6);
      g.gain.exponentialRampToValueAtTime(0.001, t + end);
    }
    s.connect(g); g.connect(this.fx);
    s.start(t);
    s.stop(t + end + 0.05);
    this.voices.push(s);
    s.onended = () => { this.voices = this.voices.filter((v) => v !== s); };
    // At most four rumbles at once: the oldest is cut.
    while (this.voices.length > 4) { const v = this.voices.shift(); try { v.stop(); } catch { /* already stopped */ } }
  }

  // A simulation event (see world.events). Distance from the camera sets loudness: events in the part of
  // space being looked at are full volume, far ones faint, and big ones (supernovae) never fully silent.
  event(ev, cam) {
    if (!ev.snd || !this.on || !this.ctx) return;
    const now = performance.now();
    let near = 1;
    if (ev.at && cam) {
      const d = Math.hypot(ev.at[0] - cam.tx, ev.at[1] - cam.ty, ev.at[2] - cam.tz);
      const x = d / Math.max(cam.dist * 3, 1e-12);
      near = 1 / (1 + x * x);
      if (ev.big) near = Math.max(near, 0.15);
    }
    const p = (ev.power ?? 1) * near;
    const ready = (k, ms) => { if (now - (this.cool[k] || 0) < ms) return false; this.cool[k] = now; return true; };
    switch (ev.snd) {
      case 'impact':
        if (p < 0.04 || !ready('impact', 900)) return;
        // Bigger impacts: louder, deeper and longer.
        this.rumble('impact', 0.25 + 0.75 * p, 1.15 - 0.3 * p, 4 + 18 * p);
        break;
      case 'swallow':
        if (!ready('swallow', 1500)) return;
        this.rumble('swallow', 0.3 + 0.6 * p, 0.8, 5 + 6 * p);
        break;
      case 'tidal':
        if (!ready('tidal', 2000)) return;
        this.rumble('tidal', 0.4 + 0.6 * p, 1, 13);
        break;
      case 'nova':
        if (!ready('nova', 3000)) return;
        this.rumble('nova', 0.9 * p + 0.1, 0.9, 13);
        this.rumble('nova-2', 0.5 * p, 0.7, 20);
        break;
      case 'death': {
        if (!ready('death', 4000)) return;
        const sn = /supernova|collapse|black hole|neutron/i.test(ev.text);
        // Supernovae get the full 52 s decay; gentler deaths (planetary nebulae) a shorter, higher one.
        if (sn) this.rumble('supernova', 0.25 + 0.75 * p, 1, 52);
        else this.rumble('star-death', 0.2 + 0.4 * p, 1.25, 14);
        break;
      }
      case 'bhmerge':
        // Two black holes becoming one: the deepest, longest rumble.
        if (!ready('bhmerge', 4000)) return;
        this.rumble('bh-merge', 1, 0.7, 13);
        this.rumble('bh-merge-2', 0.8, 0.6, 25);
        break;
      case 'transform':
        if (!ready('transform', 3000)) return;
        this.rumble('transform-rumble', 0.2 + 0.4 * p, 1.2, 6);
        this.ui('transform');
        break;
      case 'complete': this.ui('complete'); break;
      case 'denied': this.ui('denied'); break;
    }
  }

  // Looping beds, set every frame: started once audible, stopped once faded out. The MP3 encoder's
  // padding at the ends is skipped so the loop doesn't click (the files are cut to loop seamlessly).
  bed(key, slot, level, rate = 1) {
    const b = this.buf[SLOT_FILE[slot]];
    if (!this.ctx || !b) return;
    const t = this.ctx.currentTime;
    this.beds = this.beds || {};
    let v = this.beds[key];
    if (!v && level > 0.01 && this.on) {
      const s = this.ctx.createBufferSource();
      s.buffer = b;
      s.loop = true;
      const d = b.getChannelData(0);
      let a = 0, z = d.length - 1;
      while (a < d.length && Math.abs(d[a]) < 1e-4) a++;
      while (z > a && Math.abs(d[z]) < 1e-4) z--;
      s.loopStart = a / b.sampleRate; s.loopEnd = z / b.sampleRate;
      const g = this.ctx.createGain(); g.gain.value = 0;
      s.connect(g); g.connect(this.fx);
      s.start(t, s.loopStart + Math.random() * (s.loopEnd - s.loopStart) * 0.9);
      v = this.beds[key] = { s, g };
    }
    if (!v) return;
    v.g.gain.setTargetAtTime(this.on ? level : 0, t, 0.6);
    v.s.playbackRate.setTargetAtTime(rate, t, 0.8);
    if (level <= 0.01 && v.g.gain.value < 0.005) {
      try { v.s.stop(); } catch { /* already stopped */ }
      delete this.beds[key];
    }
  }

  // Black-hole drone: level 0..1 from how large the nearest hole looks, pitch from its mass.
  ambient(level, rate) { this.bed('drone', 'bh-drone', level * 0.8, rate); }

  // Object ambience: a low engine-like hum near solid worlds and stellar remnants, a deep wind near gas
  // giants and stars, and on the ground of a world with air. Levels 0..1.
  nearby(hum, wind, rate = 1) {
    this.bed('hum', 'engine-hum', hum * 0.45, rate);
    this.bed('wind', 'wind', wind * 0.4, 1);
  }
}
