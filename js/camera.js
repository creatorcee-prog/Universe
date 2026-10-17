// Orbit camera: looks at a target point (usually a followed body) from yaw/pitch/distance.
const ease = (k) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);

export class Camera {
  constructor() {
    this.tx = 0; this.ty = 0; this.tz = 0;
    this.yaw = 0; this.pitch = 0.5;
    this.dist = 3; this.distGoal = 3;
    this.fov = (55 * Math.PI) / 180;
    this.follow = null;
    this.W = 1; this.H = 1;
    this.trans = null; // smooth hand-off between targets
    this.update();
  }

  setViewport(w, h) {
    this.W = w; this.H = h;
    this.F = h / 2 / Math.tan(this.fov / 2);
  }

  focus(body, now) {
    if (!body) { this.follow = null; return; }
    this.trans = { x: this.tx, y: this.ty, z: this.tz, t0: now, dur: 650 };
    this.follow = body;
  }

  zoomTo(d) {
    this.distGoal = Math.min(1e13, Math.max(1e-9, d));
  }

  tick(now, dtReal) {
    if (this.follow) {
      const b = this.follow;
      if (this.trans) {
        const k = Math.min(1, (now - this.trans.t0) / this.trans.dur);
        const e = ease(k);
        this.tx = this.trans.x + (b.x - this.trans.x) * e;
        this.ty = this.trans.y + (b.y - this.trans.y) * e;
        this.tz = this.trans.z + (b.z - this.trans.z) * e;
        if (k >= 1) this.trans = null;
      } else {
        this.tx = b.x; this.ty = b.y; this.tz = b.z;
      }
    }
    if (this.distGoal !== this.dist) {
      const k = 1 - Math.exp(-dtReal * 12);
      const l = Math.log(this.dist) + (Math.log(this.distGoal) - Math.log(this.dist)) * k;
      this.dist = Math.abs(l - Math.log(this.distGoal)) < 1e-4 ? this.distGoal : Math.exp(l);
    }
    this.update();
  }

  update() {
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch), cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    // Offset from target to camera.
    this.ox = this.dist * cp * sy; this.oy = this.dist * sp; this.oz = this.dist * cp * cy;
    const fx = -cp * sy, fy = -sp, fz = -cp * cy; // forward
    let rx = -fz, rz = fx; // right = forward × up
    const rl = Math.hypot(rx, rz) || 1;
    rx /= rl; rz /= rl;
    this.fx = fx; this.fy = fy; this.fz = fz;
    this.rx = rx; this.ry = 0; this.rz = rz;
    // up = right × forward
    this.ux = -rz * fy; this.uy = rz * fx - rx * fz; this.uz = rx * fy;
  }

  // Projects a world point. Writes screen x, y and pixels-per-AU into out; returns depth (<=0 means behind).
  project(x, y, z, out) {
    const dx = x - this.tx - this.ox, dy = y - this.ty - this.oy, dz = z - this.tz - this.oz;
    const cz = dx * this.fx + dy * this.fy + dz * this.fz;
    if (cz <= this.dist * 1e-6) return -1;
    const cx = dx * this.rx + dz * this.rz;
    const cy = dx * this.ux + dy * this.uy + dz * this.uz;
    const s = this.F / cz;
    out.x = this.W / 2 + cx * s;
    out.y = this.H / 2 - cy * s;
    out.s = s;
    return cz;
  }

  // Camera-space components of a direction vector.
  dirToCam(x, y, z, out) {
    out.x = x * this.rx + z * this.rz;
    out.y = x * this.ux + y * this.uy + z * this.uz;
    out.z = x * this.fx + y * this.fy + z * this.fz;
    return out;
  }

  // World-space ray direction through screen point.
  ray(sx, sy) {
    const cx = (sx - this.W / 2) / this.F, cy = -(sy - this.H / 2) / this.F;
    const x = this.fx + cx * this.rx + cy * this.ux;
    const y = this.fy + cy * this.uy;
    const z = this.fz + cx * this.rz + cy * this.uz;
    const l = Math.hypot(x, y, z);
    return [x / l, y / l, z / l];
  }

  // Where the screen point meets the horizontal plane through the target.
  // Falls back to a point at the target's depth when the plane is edge-on or behind.
  pick(sx, sy) {
    const d = this.ray(sx, sy);
    const px = this.tx + this.ox, py = this.ty + this.oy, pz = this.tz + this.oz;
    if (Math.abs(d[1]) > 1e-6) {
      const t = (this.ty - py) / d[1];
      if (t > 0 && t < this.dist * 8) return [px + d[0] * t, this.ty, pz + d[2] * t];
    }
    const t = this.dist / (d[0] * this.fx + d[1] * this.fy + d[2] * this.fz);
    return [px + d[0] * t, py + d[1] * t, pz + d[2] * t];
  }
}
