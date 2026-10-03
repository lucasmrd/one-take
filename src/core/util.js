import * as THREE from 'three';

export const clamp01 = (x) => Math.min(1, Math.max(0, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
export const range = (u, a, b) => clamp01((u - a) / (b - a));
// rises a→b, falls c→d
export const bump = (u, a, b, c, d) => smoothstep(a, b, u) * (1 - smoothstep(c, d, u));
export const easeInCubic = (t) => t * t * t;
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

// Monotone cubic interpolation through [x, y] keys — smooth camera tracks without overshoot.
export class Track {
  constructor(keys) {
    this.x = keys.map((k) => k[0]);
    this.y = keys.map((k) => k[1]);
    const n = keys.length;
    const d = [], m = new Array(n).fill(0);
    for (let i = 0; i < n - 1; i++) d.push((this.y[i + 1] - this.y[i]) / (this.x[i + 1] - this.x[i]));
    m[0] = d[0]; m[n - 1] = d[n - 2];
    for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
    for (let i = 0; i < n - 1; i++) {
      if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
      const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
      if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
    }
    this.m = m;
  }
  at(x) {
    const X = this.x, Y = this.y, n = X.length;
    if (x <= X[0]) return Y[0];
    if (x >= X[n - 1]) return Y[n - 1];
    let i = 0;
    while (x > X[i + 1]) i++;
    const h = X[i + 1] - X[i], t = (x - X[i]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * Y[i] + (t3 - 2 * t2 + t) * h * this.m[i] + (-2 * t3 + 3 * t2) * Y[i + 1] + (t3 - t2) * h * this.m[i + 1];
  }
}

const _v = new THREE.Vector3();
// screen-space uv of a world point (null if behind the camera)
export function toScreen(p, camera, out = new THREE.Vector2()) {
  _v.copy(p).project(camera);
  out.set(_v.x * 0.5 + 0.5, _v.y * 0.5 + 0.5);
  return _v.z < 1 ? out : null;
}

// a big sphere that follows the camera, for skies
export function skyDome(material, radius = 3000) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 24), material);
  m.frustumCulled = false;
  m.renderOrder = -10;
  return m;
}

export const SKY_VS = /* glsl */ `
varying vec3 vDir;
void main(){
  vDir = normalize(position);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * viewMatrix * wp;
  gl_Position.z = gl_Position.w * 0.99999;
}
`;
