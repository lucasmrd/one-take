// Virtual scroll: the wheel moves a target along the timeline, the camera glides to it.
// Speed is capped (maxLead) so nobody can skip a world in one flick, and "resist" zones
// make the scroll heavier around the big moments.

export class Scroll {
  constructor(total, { speed = 0.0085, maxLead = 7, damping = 2.0, resist = () => 1 } = {}) {
    this.total = total;
    this.speed = speed;
    this.maxLead = maxLead;
    this.damping = damping;
    this.resist = resist;
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
      this.push(d);
    }, { passive: false });

    window.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      const k = e.key;
      if (k === 'ArrowDown' || k === 'PageDown' || k === ' ') this.push(140);
      else if (k === 'ArrowUp' || k === 'PageUp') this.push(-140);
    });

    window.addEventListener('touchstart', (e) => { this.touchY = e.touches[0].clientY; }, { passive: true });
    window.addEventListener('touchmove', (e) => {
      if (!this.enabled || this.touchY === null) return;
      const y = e.touches[0].clientY;
      this.push((this.touchY - y) * 2.5);
      this.touchY = y;
    }, { passive: true });
  }

  push(d) {
    this.target += d * this.speed * this.resist(this.pos);
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
    const prev = this.pos;
    const k = 1 - Math.exp(-dt * this.damping);
    this.pos += (this.target - this.pos) * k;
    if (Math.abs(this.target - this.pos) < 1e-4) this.pos = this.target;
    this.vel = (this.pos - prev) / Math.max(dt, 1e-4);
  }
}
