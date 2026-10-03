// Virtual scroll: the wheel moves a target along the timeline, the camera glides to it.
// Speed is capped (maxLead) so nobody can skip a world in one flick, and "resist" zones
// make the scroll a little heavier around the big moments.
// Autopilot (middle mouse button) advances on its own at a cinematic pace.

export class Scroll {
  constructor(total, { speed = 0.026, maxLead = 18, damping = 2.3, resist = () => 1, autoSpeed = 4.5, autoStop = total } = {}) {
    this.total = total;
    this.speed = speed;
    this.maxLead = maxLead;
    this.damping = damping;
    this.resist = resist;
    this.autoSpeed = autoSpeed;
    this.autoStop = autoStop;
    this.auto = false;
    this.onAuto = null;
    this.target = 0;
    this.pos = 0;
    this.vel = 0;
    this.enabled = false;
    this.touchY = null;
    this.idle = 0;

    window.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (!this.enabled) return;
      let d = e.deltaY;
      if (e.deltaMode === 1) d *= 33;
      else if (e.deltaMode === 2) d *= window.innerHeight;
      d = Math.max(-160, Math.min(160, d));
      // scrolling back takes the wheel away from the autopilot
      if (d < 0 && this.auto) this.setAuto(false);
      this.push(d);
    }, { passive: false });

    window.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      const k = e.key;
      if (k === 'ArrowDown' || k === 'PageDown' || k === ' ') this.push(140);
      else if (k === 'ArrowUp' || k === 'PageUp') this.push(-140);
    });

    // middle button toggles the autopilot (and suppresses the browser's own autoscroll)
    window.addEventListener('mousedown', (e) => {
      if (e.button !== 1) return;
      e.preventDefault();
      if (this.enabled) this.setAuto(!this.auto);
    });
    window.addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); });

    window.addEventListener('touchstart', (e) => { this.touchY = e.touches[0].clientY; }, { passive: true });
    window.addEventListener('touchmove', (e) => {
      if (!this.enabled || this.touchY === null) return;
      const y = e.touches[0].clientY;
      this.push((this.touchY - y) * 2.5);
      this.touchY = y;
    }, { passive: true });
  }

  setAuto(on) {
    on = on && this.pos < this.autoStop - 0.5;
    if (on === this.auto) return;
    this.auto = on;
    this.idle = 0;
    if (this.onAuto) this.onAuto(on);
  }

  // big moments still feel heavier, but never like dragging a boulder
  weight(u) {
    return 0.55 + 0.45 * this.resist(u);
  }

  push(d) {
    this.target += d * this.speed * this.weight(this.pos);
    this.idle = 0;
    this.clamp();
  }

  clamp() {
    this.target = Math.min(this.total, Math.max(0, this.target));
    this.target = Math.min(this.pos + this.maxLead, Math.max(this.pos - this.maxLead, this.target));
  }

  jump(u) {
    this.pos = this.target = Math.min(this.total, Math.max(0, u));
  }

  update(dt) {
    this.idle += dt;
    if (this.auto && this.enabled) {
      this.idle = 0;
      // the autopilot slows down for the big moments
      this.target = Math.max(this.target, this.pos) + dt * this.autoSpeed * (0.45 + 0.55 * this.resist(this.pos));
      this.target = Math.min(this.target, this.autoStop);
      this.clamp();
      if (this.pos >= this.autoStop - 0.05) this.setAuto(false);
    }
    const prev = this.pos;
    const k = 1 - Math.exp(-dt * this.damping);
    this.pos += (this.target - this.pos) * k;
    if (Math.abs(this.target - this.pos) < 1e-4) this.pos = this.target;
    this.vel = (this.pos - prev) / Math.max(dt, 1e-4);
  }
}
