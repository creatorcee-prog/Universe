// Pointer handling for touch and mouse.
// One finger: orbit the camera (or place/fling an object with the Add tool).
// Two fingers: pinch to zoom, drag to pan, twist to turn. Tap selects, double-tap follows.
export class Input {
  constructor(canvas, app) {
    this.canvas = canvas;
    this.app = app;
    this.pointers = new Map();
    this.mode = 'idle';
    this.lastTap = null;
    canvas.addEventListener('pointerdown', (e) => this.down(e));
    canvas.addEventListener('pointermove', (e) => this.move(e));
    canvas.addEventListener('pointerup', (e) => this.up(e));
    canvas.addEventListener('pointercancel', (e) => this.cancel(e));
    canvas.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    // Cancelling the touch events stops the browser's synthesized click, which would otherwise land on
    // whatever UI appears under the finger (e.g. the Delete button of a freshly opened info card).
    for (const ev of ['touchstart', 'touchmove', 'touchend']) canvas.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
    // iOS Safari: stop page-level pinch zoom and double-tap zoom.
    for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, (e) => e.preventDefault());
  }

  pos(e) {
    const r = this.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  down(e) {
    e.preventDefault();
    if (this.app.photo) { this.app.setPhoto(false); return; }
    this.canvas.setPointerCapture?.(e.pointerId);
    const [x, y] = this.pos(e);
    this.pointers.set(e.pointerId, { x, y, x0: x, y0: y, t0: performance.now() });
    this.app.interacted();
    if (this.pointers.size === 1) {
      if (e.button === 2 || (e.pointerType === 'mouse' && e.shiftKey)) {
        this.mode = 'pan';
      } else if (this.app.state.tool === 'add') {
        this.mode = 'add';
        this.app.addBegin(x, y);
      } else if (this.app.state.tool === 'paint') {
        this.mode = 'paint';
        this.app.paintAt(x, y, true);
      } else if (this.app.state.tool === 'laser') {
        this.mode = 'laser';
        this.app.laserStart(x, y);
      } else {
        this.mode = 'tap';
      }
    } else if (this.pointers.size === 2) {
      if (this.mode === 'add') this.app.addCancel();
      if (this.mode === 'laser') this.app.laserStop();
      this.startPinch();
    }
  }

  startPinch() {
    const [a, b] = [...this.pointers.values()];
    this.mode = 'pinch';
    this.pinch = {
      d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, fov0: this.app.cam.fov,
      ang0: Math.atan2(b.y - a.y, b.x - a.x),
      mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2,
      dist0: this.app.cam.dist, yaw0: this.app.cam.yaw, panned: 0,
    };
  }

  move(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    e.preventDefault();
    const [x, y] = this.pos(e);
    const dx = x - p.x, dy = y - p.y;
    p.x = x; p.y = y;
    const cam = this.app.cam;
    if (this.mode === 'tap' && Math.hypot(x - p.x0, y - p.y0) > 6) this.mode = 'rotate';
    if (this.mode === 'rotate' && this.app.surface) {
      // Surface view: drag to look around.
      const sv = this.app.surface;
      const k = 0.005 * (cam.fov / ((55 * Math.PI) / 180));   // (finer when zoomed in)
      sv.yaw -= dx * k;
      sv.pitch = Math.max(-0.7, Math.min(1.5, sv.pitch + dy * k));
    } else if (this.mode === 'rotate') {
      cam.yaw -= dx * 0.006;
      cam.pitch = Math.max(-1.54, Math.min(1.54, cam.pitch + dy * 0.006));
    } else if (this.mode === 'pan') {
      this.pan(dx, dy);
    } else if (this.mode === 'add') {
      this.app.addMove(x, y);
    } else if (this.mode === 'laser') {
      this.app.laserMove(x, y);
    } else if (this.mode === 'paint') {
      this.app.paintAt(x, y, false);
    } else if (this.mode === 'pinch' && this.app.surface && this.pointers.size >= 2) {
      // Standing on a surface, pinching zooms like a camera lens: the field of view, 2° (a telephoto, the Moon
      // filling a good part of the view) to 75°.
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      this.app.setFov(this.pinch.fov0 * (this.pinch.d0 / d));
    } else if (this.mode === 'pinch' && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const pc = this.pinch;
      cam.dist = cam.distGoal = cam.zoomFrom(pc.dist0, pc.d0 / d);
      cam.yaw = pc.yaw0 + (ang - pc.ang0);
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const mdx = mx - pc.mx, mdy = my - pc.my;
      pc.mx = mx; pc.my = my;
      pc.panned += Math.hypot(mdx, mdy);
      // While the camera is locked, two fingers only zoom and turn; they never drag it off the object.
      if (pc.panned > 30 && !cam.follow) this.pan(mdx, mdy);
    }
  }

  pan(dx, dy) {
    const cam = this.app.cam;
    if (cam.follow) return; // locked
    const k = (cam.dist / cam.F) * this.app.renderer.dpr;
    cam.tx -= (dx * cam.rx - dy * cam.ux) * k;
    cam.ty -= -dy * cam.uy * k;
    cam.tz -= (dx * cam.rz - dy * cam.uz) * k;
  }

  up(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const [x, y] = this.pos(e);
    this.pointers.delete(e.pointerId);
    if (this.mode === 'tap' && performance.now() - p.t0 < 400) this.tap(x, y);
    if (this.mode === 'add') this.app.addEnd(x, y);
    if (this.mode === 'laser') this.app.laserStop();
    if (this.pointers.size === 0) this.mode = 'idle';
    else if (this.mode === 'pinch') this.mode = 'rotate'; // keep orbiting with the remaining finger
  }

  cancel(e) {
    this.pointers.delete(e.pointerId);
    if (this.mode === 'add') this.app.addCancel();
    if (this.mode === 'laser') this.app.laserStop();
    if (this.pointers.size === 0) this.mode = 'idle';
  }

  tap(x, y) {
    const now = performance.now();
    const body = this.app.renderer.pickBody(x * this.app.renderer.dpr, y * this.app.renderer.dpr, 26);
    if (this.app.state.tool === 'delete') { if (body) this.app.deleteBody(body); return; }
    const lt = this.lastTap;
    if (lt && now - lt.t < 330 && Math.hypot(x - lt.x, y - lt.y) < 32) {
      this.lastTap = null;
      this.app.doubleTap(body || lt.body);
      return;
    }
    this.lastTap = { t: now, x, y, body };
    this.app.select(body);
  }

  wheel(e) {
    e.preventDefault();
    const cam = this.app.cam;
    if (this.app.surface) { this.app.setFov(cam.fov * Math.exp(e.deltaY * 0.0015)); return; }
    cam.distGoal = cam.zoomFrom(cam.distGoal, Math.exp(e.deltaY * 0.0015));
    this.app.interacted();
  }
}
