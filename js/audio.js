// Sound: interface blips, and deep rumbles for cosmic events (impacts, tidal disruptions, red novae,
// supernovae) plus a drone that swells as the camera nears a black hole.
//
// The rumbles are almost entirely below 150 Hz, which a phone speaker cannot reproduce (most roll off
// below ~200–300 Hz). So they pass through a "missing fundamental" bass enhancer: a band of the low end
// is soft-clipped to generate harmonics at 2f, 3f, ..., which the ear hears as the original low pitch.
// With headphones the dry signal carries it; on the speaker the harmonics do.
//
// Web Audio needs a user gesture before it will play (iOS especially), so the context is created and the
// sounds decoded on the first tap. The audio session is set to "ambient": it mixes with music the user
// is playing and respects the silent switch.

const UI = {
  // name: [file, gain] — gains level the clips to about the same loudness (measured mean volume).
  click: ['click', 0.55], bleep1: ['bleep1', 1.1], bleep4: ['bleep4', 1.1], bleep6: ['bleep6', 1.0],
  bleep7: ['bleep7', 0.8], data1: ['data1', 1.0], data5: ['data5', 0.65], confirm2: ['confirm2', 1.1],
  confirm5: ['confirm5', 0.42], confirm7: ['confirm7', 0.85], denied2: ['denied2', 0.36], denied3: ['denied3', 0.32],
  execute: ['execute', 0.85], complete: ['complete', 1.2], seq3: ['seq3', 2.2], seq6: ['seq6', 1.1],
};
const COSMIC = ['rumble1', 'rumble4', 'rumbleloop', 'decay'];

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
    this.drone = null;
    const unlock = () => { this.start(); };
    window.addEventListener('pointerdown', unlock, { capture: true });
    window.addEventListener('keydown', unlock, { capture: true });
  }

  get on() { return this.settings.sound !== false; }

  start() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { if (navigator.audioSession) navigator.audioSession.type = 'ambient'; } catch { /* not supported */ }
    const ctx = (this.ctx = new AC());
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
    const wet = ctx.createGain(); wet.gain.value = 0.22;
    this.fx.connect(band); band.connect(drive); drive.connect(shaper); shaper.connect(hp); hp.connect(lp); lp.connect(wet); wet.connect(comp);
    comp.connect(this.master);
    for (const [name, [file]] of Object.entries(UI)) this.load(name, file);
    for (const name of COSMIC) this.load(name, name);
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

  setEnabled(on) {
    if (on) this.start();
    if (!this.master) return;
    this.master.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.05);
  }

  // Interface sound. Calls within 40 ms of each other collapse to the first. The generic click is a
  // fallback, played a tick after the tap, and skipped if the tap's handler already made a sound.
  ui(name, fallback = false) {
    const now = performance.now();
    if (now - this.lastUI < (fallback ? 120 : 40)) return;
    this.lastUI = now;
    if (!this.on || !this.ctx || !this.buf[name]) return;
    const s = this.ctx.createBufferSource();
    s.buffer = this.buf[name];
    const g = this.ctx.createGain();
    g.gain.value = UI[name] ? UI[name][1] : 1;
    s.connect(g); g.connect(this.uiBus);
    s.start();
  }

  // A rumble: gain 0..1, playbackRate for pitch (lower = bigger), and how long before it fades
  // (the source clips run 12–52 s; small events are cut short).
  rumble(name, gain, rate = 1, hold = 30) {
    const b = this.buf[name];
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
        this.rumble('rumble1', 0.25 + 0.75 * p, 1.15 - 0.3 * p, 4 + 18 * p);
        break;
      case 'swallow':
        if (!ready('swallow', 1500)) return;
        this.rumble('rumble4', 0.3 + 0.6 * p, 0.8, 5 + 6 * p);
        break;
      case 'tidal':
        if (!ready('tidal', 2000)) return;
        this.rumble('rumble4', 0.4 + 0.6 * p, 1, 13);
        break;
      case 'nova':
        if (!ready('nova', 3000)) return;
        this.rumble('rumble4', 0.9 * p + 0.1, 0.9, 13);
        this.rumble('rumble1', 0.5 * p, 0.7, 20);
        break;
      case 'death': {
        if (!ready('death', 4000)) return;
        const sn = /supernova|collapse|black hole|neutron/i.test(ev.text);
        // Supernovae get the full 52 s decay; gentler deaths (planetary nebulae) a shorter, higher one.
        if (sn) this.rumble('decay', 0.25 + 0.75 * p, 1, 52);
        else this.rumble('decay', 0.2 + 0.4 * p, 1.25, 14);
        break;
      }
      case 'transform':
        if (!ready('transform', 3000)) return;
        this.rumble('rumble4', 0.2 + 0.4 * p, 1.2, 6);
        this.ui('confirm7');
        break;
      case 'complete': this.ui('complete'); break;
      case 'denied': this.ui('denied2'); break;
    }
  }

  // Black-hole drone, every frame: level 0..1 from how large the nearest hole looks, pitch from its mass.
  ambient(level, rate) {
    if (!this.ctx || !this.buf.rumbleloop) return;
    const t = this.ctx.currentTime;
    if (!this.drone && level > 0.01 && this.on) {
      const s = this.ctx.createBufferSource();
      const b = this.buf.rumbleloop;
      s.buffer = b;
      s.loop = true;
      // Skip the MP3 encoder's padding at the ends so the loop doesn't click.
      const d = b.getChannelData(0);
      let a = 0, z = d.length - 1;
      while (a < d.length && Math.abs(d[a]) < 1e-4) a++;
      while (z > a && Math.abs(d[z]) < 1e-4) z--;
      s.loopStart = a / b.sampleRate; s.loopEnd = z / b.sampleRate;
      const g = this.ctx.createGain(); g.gain.value = 0;
      s.connect(g); g.connect(this.fx);
      s.start(t, s.loopStart);
      this.drone = { s, g };
    }
    if (!this.drone) return;
    this.drone.g.gain.setTargetAtTime(this.on ? level * 0.8 : 0, t, 0.6);
    this.drone.s.playbackRate.setTargetAtTime(rate, t, 0.8);
    if (level <= 0.01 && this.drone.g.gain.value < 0.005) {
      try { this.drone.s.stop(); } catch { /* already stopped */ }
      this.drone = null;
    }
  }
}
