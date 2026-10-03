import * as THREE from 'three';
import { preparePrims, makeSDF, boundsOf, surfaceNets, primDist } from './sdf.js';
import { NOISE_GLSL, mulberry32 } from '../core/noise.js';
import { FOG_PARS } from '../core/fog.js';

// ---------------------------------------------------------------------------
// Model: mesh the SDF once, compute 2-bone skin weights, offer surface samples.
// ---------------------------------------------------------------------------
export class AnimalModel {
  constructor(spec) {
    this.spec = spec;
    const prims = preparePrims(spec.prims.map((p) => ({ ...p })));
    const boneIndex = new Map(spec.bones.map((b, i) => [b.name, i]));
    for (const p of prims) {
      p.bi = boneIndex.get(p.bone);
      if (p.bi === undefined) throw new Error(`bone ${p.bone} missing in ${spec.name}`);
    }
    const sdf = makeSDF(prims, spec.k);
    const { min, max } = boundsOf(prims, spec.k * 0.5 + spec.h * 2);
    const { positions, normals, indices } = surfaceNets(sdf, min, max, spec.h);

    const n = positions.length / 3;
    const nb = spec.bones.length;
    const skinIdx = new Float32Array(n * 2);
    const skinW = new Float32Array(n);
    const bd = new Float32Array(nb);
    const s = spec.h * 2.5;
    for (let v = 0; v < n; v++) {
      const x = positions[v * 3], y = positions[v * 3 + 1], z = positions[v * 3 + 2];
      bd.fill(1e9);
      for (const p of prims) {
        const d = primDist(x, y, z, p);
        if (d < bd[p.bi]) bd[p.bi] = d;
      }
      let b1 = 0, b2 = 0, d1 = 1e9, d2 = 1e9;
      for (let b = 0; b < nb; b++) {
        if (bd[b] < d1) { d2 = d1; b2 = b1; d1 = bd[b]; b1 = b; }
        else if (bd[b] < d2) { d2 = bd[b]; b2 = b; }
      }
      skinIdx[v * 2] = b1;
      skinIdx[v * 2 + 1] = b2;
      skinW[v] = d2 > 1e8 ? 1 : 1 / (1 + Math.exp(-(d2 - d1) / s));
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    g.setAttribute('skinIdx', new THREE.BufferAttribute(skinIdx, 2));
    g.setAttribute('skinW', new THREE.BufferAttribute(skinW, 1));
    g.setIndex(new THREE.BufferAttribute(indices, 1));
    g.computeBoundingSphere();
    g.boundingSphere.radius *= 2.2; // poses move limbs around
    this.geometry = g;
    this.min = min;
    this.max = max;
    this.height = max[1];
    this.vertexCount = n;
    this.triangleCount = indices.length / 3;

    // cumulative triangle areas for surface sampling
    const tri = indices.length / 3;
    const cum = new Float64Array(tri);
    let acc = 0;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (let t = 0; t < tri; t++) {
      a.fromArray(positions, indices[t * 3] * 3);
      b.fromArray(positions, indices[t * 3 + 1] * 3);
      c.fromArray(positions, indices[t * 3 + 2] * 3);
      acc += b.sub(a).cross(c.sub(a)).length() * 0.5;
      cum[t] = acc;
    }
    this.cum = cum;
    this.area = acc;
  }

  // area-weighted surface points carrying skin data
  sample(count, seed = 7) {
    const rnd = mulberry32(seed);
    const P = this.geometry.attributes.position.array;
    const N = this.geometry.attributes.normal.array;
    const SI = this.geometry.attributes.skinIdx.array;
    const SW = this.geometry.attributes.skinW.array;
    const I = this.geometry.index.array;
    const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3);
    const si = new Float32Array(count * 2), sw = new Float32Array(count), r4 = new Float32Array(count * 4);
    const cum = this.cum, total = this.area;
    for (let i = 0; i < count; i++) {
      const target = rnd() * total;
      let lo = 0, hi = cum.length - 1;
      while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < target) lo = m + 1; else hi = m; }
      const i0 = I[lo * 3], i1 = I[lo * 3 + 1], i2 = I[lo * 3 + 2];
      let u = rnd(), v = rnd();
      if (u + v > 1) { u = 1 - u; v = 1 - v; }
      const w = 1 - u - v;
      for (let k = 0; k < 3; k++) {
        pos[i * 3 + k] = P[i0 * 3 + k] * w + P[i1 * 3 + k] * u + P[i2 * 3 + k] * v;
        nor[i * 3 + k] = N[i0 * 3 + k] * w + N[i1 * 3 + k] * u + N[i2 * 3 + k] * v;
      }
      const dom = w >= u && w >= v ? i0 : u >= v ? i1 : i2;
      si[i * 2] = SI[dom * 2]; si[i * 2 + 1] = SI[dom * 2 + 1]; sw[i] = SW[dom];
      r4[i * 4] = rnd(); r4[i * 4 + 1] = rnd(); r4[i * 4 + 2] = rnd(); r4[i * 4 + 3] = rnd();
    }
    return { pos, nor, si, sw, r4 };
  }

  pointsGeometry(count, seed) {
    const s = this.sample(count, seed);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(s.pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(s.nor, 3));
    g.setAttribute('skinIdx', new THREE.BufferAttribute(s.si, 2));
    g.setAttribute('skinW', new THREE.BufferAttribute(s.sw, 1));
    g.setAttribute('rnd', new THREE.BufferAttribute(s.r4, 4));
    g.boundingSphere = this.geometry.boundingSphere.clone();
    return g;
  }
}

// ---------------------------------------------------------------------------
// Rig: bone matrices from a pose { offset, rot: { bone: [x,y,z] } }
// ---------------------------------------------------------------------------
const _e = new THREE.Euler(), _r = new THREE.Matrix4(), _t1 = new THREE.Matrix4(), _t2 = new THREE.Matrix4(), _o = new THREE.Matrix4();
export class Rig {
  constructor(model) {
    this.bones = model.spec.bones;
    this.world = this.bones.map(() => new THREE.Matrix4());
    this.array = new Float32Array(16 * 16);
    for (let i = 0; i < 16; i++) new THREE.Matrix4().toArray(this.array, i * 16);
    this.uniform = { value: this.array };
    this.apply({});
  }
  apply(pose) {
    const rot = pose.rot || {};
    for (let i = 0; i < this.bones.length; i++) {
      const b = this.bones[i];
      const r = rot[b.name];
      _e.set(r ? r[0] : 0, r ? r[1] : 0, r ? r[2] : 0, 'YXZ');
      _r.makeRotationFromEuler(_e);
      _t1.makeTranslation(b.p[0], b.p[1], b.p[2]);
      _t2.makeTranslation(-b.p[0], -b.p[1], -b.p[2]);
      const m = this.world[i];
      m.multiplyMatrices(_t1, _r).multiply(_t2);
      if (b.parent < 0) {
        if (pose.offset) { _o.makeTranslation(pose.offset[0], pose.offset[1], pose.offset[2]); m.premultiply(_o); }
      } else {
        m.premultiply(this.world[b.parent]);
      }
      m.toArray(this.array, i * 16);
    }
  }
  // world-space position of a rest-pose point carried by bone `name`
  point(name, p, object, out = new THREE.Vector3()) {
    const i = this.bones.findIndex((b) => b.name === name);
    out.set(p[0], p[1], p[2]).applyMatrix4(this.world[i]);
    if (object) { object.updateMatrixWorld(); out.applyMatrix4(object.matrixWorld); }
    return out;
  }
}

// blend two poses (rotations and offsets), t in [0,1]
export function blendPose(a, b, t) {
  const rot = {};
  const keys = new Set([...Object.keys(a.rot || {}), ...Object.keys(b.rot || {})]);
  for (const k of keys) {
    const ra = (a.rot && a.rot[k]) || [0, 0, 0], rb = (b.rot && b.rot[k]) || [0, 0, 0];
    rot[k] = [ra[0] + (rb[0] - ra[0]) * t, ra[1] + (rb[1] - ra[1]) * t, ra[2] + (rb[2] - ra[2]) * t];
  }
  const oa = a.offset || [0, 0, 0], ob = b.offset || [0, 0, 0];
  return { rot, offset: [oa[0] + (ob[0] - oa[0]) * t, oa[1] + (ob[1] - oa[1]) * t, oa[2] + (ob[2] - oa[2]) * t] };
}

const SKIN_GLSL = /* glsl */ `
uniform mat4 uBones[16];
attribute vec2 skinIdx;
attribute float skinW;
vec3 skinP(vec3 p){
  mat4 a = uBones[int(skinIdx.x + 0.5)];
  mat4 b = uBones[int(skinIdx.y + 0.5)];
  return (a*vec4(p, 1.0)*skinW + b*vec4(p, 1.0)*(1.0 - skinW)).xyz;
}
vec3 skinN(vec3 n){
  mat4 a = uBones[int(skinIdx.x + 0.5)];
  mat4 b = uBones[int(skinIdx.y + 0.5)];
  return normalize(mat3(a)*n*skinW + mat3(b)*n*(1.0 - skinW));
}
`;

// ---------------------------------------------------------------------------
// Flesh: shell-textured fur with rim light and a "materialize" reveal front.
// ---------------------------------------------------------------------------
export function createFurMesh(model, rig, U, opts = {}) {
  const shells = opts.shells ?? 20;
  const base = model.geometry;
  const g = new THREE.InstancedBufferGeometry();
  g.index = base.index;
  for (const k of ['position', 'normal', 'skinIdx', 'skinW']) g.setAttribute(k, base.attributes[k]);
  const sh = new Float32Array(shells);
  for (let i = 0; i < shells; i++) sh[i] = i / (shells - 1);
  g.setAttribute('shell', new THREE.InstancedBufferAttribute(sh, 1));
  g.instanceCount = shells;
  g.boundingSphere = base.boundingSphere.clone();

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      ...U,
      uBones: rig.uniform,
      uTime: U.uTime || { value: 0 },
      uFurLen: { value: opts.length ?? 0.05 },
      uDensity: { value: opts.density ?? 90 },
      uColA: { value: new THREE.Color(...(opts.colA ?? [0.05, 0.035, 0.025])) },
      uColB: { value: new THREE.Color(...(opts.colB ?? [0.22, 0.15, 0.09])) },
      uSunCol: { value: new THREE.Color(...(opts.sunCol ?? [1.6, 1.1, 0.7])) },
      uAmb: { value: new THREE.Color(...(opts.amb ?? [0.12, 0.13, 0.16])) },
      uRim: { value: opts.rim ?? 1.0 },
      uReveal: { value: 1 },
      uHeight: { value: model.height },
      uGlow: { value: new THREE.Color(...(opts.glow ?? [3.0, 1.8, 0.6])) },
      uWind: { value: 0 },
    },
    vertexShader: /* glsl */ `
      ${SKIN_GLSL}
      attribute float shell;
      uniform float uFurLen, uTime, uWind;
      varying float vH;
      varying vec3 vRest, vRestN, vN, vW;
      void main(){
        vH = shell;
        vRest = position; vRestN = normal;
        vec3 p = position + normal * uFurLen * shell;
        p.y -= uFurLen * 0.35 * shell * shell;
        p += vec3(sin(uTime*1.3 + position.y*3.0), 0.0, cos(uTime*1.1 + position.x*3.0)) * uFurLen * 0.15 * shell * shell * (1.0 + uWind);
        vec3 sp = skinP(p);
        vN = normalize(mat3(modelMatrix) * skinN(normal));
        vec4 wp = modelMatrix * vec4(sp, 1.0);
        vW = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      ${NOISE_GLSL}
      ${FOG_PARS}
      uniform float uDensity, uRim, uReveal, uHeight, uTime;
      uniform vec3 uColA, uColB, uSunCol, uAmb, uGlow;
      varying float vH;
      varying vec3 vRest, vRestN, vN, vW;
      void main(){
        vec3 q = vRest * uDensity;
        vec3 cell = floor(q);
        vec3 f = fract(q) - 0.5;
        vec3 n = normalize(vRestN);
        vec3 ft = f - dot(f, n) * n;
        float len = 0.35 + 0.65 * hash13(cell);
        // when strands get smaller than a pixel they only alias: fall back to a soft solid coat
        float far = smoothstep(0.35, 0.9, length(fwidth(q)));
        if (vH > 0.0) {
          if (vH > mix(len, 0.4, far)) discard;
          if (far < 0.5 && length(ft) > 0.55 * (1.0 - vH / len) + 0.05) discard;
        }
        // reveal front (spirit -> flesh), grows from the ground up
        float rv = vRest.y / uHeight + snoise(vRest * 6.0) * 0.12;
        float front = uReveal * 1.35 - 0.15;
        if (rv > front) discard;
        float edge = 1.0 - smoothstep(0.0, 0.07, front - rv);

        vec3 N = normalize(vN);
        vec3 V = normalize(cameraPosition - vW);
        vec3 L = normalize(uSunDir);
        float var = snoise(vRest * 2.5) * 0.5 + 0.5;
        vec3 fur = mix(uColA, uColB, clamp(vH * 0.8 + var * 0.45, 0.0, 1.0));
        float ao = mix(0.22, 1.0, vH);
        float diff = pow(max(dot(N, L) * 0.5 + 0.5, 0.0), 2.0);
        float back = pow(max(dot(-V, L), 0.0), 2.0);
        float rim = pow(1.0 - max(dot(N, V), 0.0), 4.0) * (0.25 + 1.6 * back) * uRim;
        vec3 col = fur * (uAmb + uSunCol * diff * 0.9) * ao;
        col += uSunCol * rim * vH * vH * 0.9;
        col += uGlow * edge * 3.0;
        col = applyFog(col, vW);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  return mesh;
}

// ---------------------------------------------------------------------------
// Spirit: glowing skinned particles. uScatter > 0 dissolves them into the air.
// ---------------------------------------------------------------------------
export function createSpiritPoints(model, rig, count, opts = {}) {
  const g = model.pointsGeometry(count, opts.seed ?? 11);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uBones: rig.uniform,
      uTime: opts.uTime || { value: 0 },
      uPR: opts.uPR || { value: 1 },
      uSize: { value: opts.size ?? 1 },
      uScatter: { value: 0 },
      uAlpha: { value: 1 },
      uFlow: { value: opts.flow ?? 1 },
      uColor: { value: new THREE.Color(...(opts.color ?? [0.5, 1.4, 2.2])) },
      uColor2: { value: new THREE.Color(...(opts.color2 ?? [2.2, 2.2, 2.6])) },
    },
    vertexShader: /* glsl */ `
      ${SKIN_GLSL}
      attribute vec4 rnd;
      uniform float uTime, uSize, uScatter, uAlpha, uPR, uFlow;
      uniform vec3 uColor, uColor2;
      varying vec3 vC;
      varying float vA;
      void main(){
        float sc = length(modelMatrix[0].xyz);
        vec3 p = position + normal * (rnd.x * 0.03 + 0.02 * sin(uTime * 2.0 + rnd.y * 6.283)) * uFlow;
        vec4 wp = modelMatrix * vec4(skinP(p), 1.0);
        vec3 wn = normalize(mat3(modelMatrix) * skinN(normal));
        vec3 drift = vec3(sin(uTime * 0.7 + rnd.z * 20.0), cos(uTime * 0.9 + rnd.w * 20.0), sin(uTime * 0.8 + rnd.y * 30.0));
        wp.xyz += drift * 0.025 * sc * uFlow;
        // trailing wisps rising off the body
        float wisp = step(0.93, rnd.w);
        float wt = fract(uTime * (0.25 + rnd.x * 0.3) + rnd.y);
        wp.xyz += (wn * 0.3 + vec3(0.0, 1.0, 0.0)) * wisp * wt * 0.6 * sc * uFlow;
        float s = clamp(uScatter, 0.0, 1.0);
        vec3 dir = normalize(wn + (rnd.xyz - 0.5) * 1.8 + vec3(0.0, 0.7, 0.0));
        wp.xyz += dir * s * (0.6 + rnd.w * 2.2) * sc + vec3(0.0, 1.0, 0.0) * s * s * 1.6 * sc;
        vec4 mv = viewMatrix * wp;
        gl_Position = projectionMatrix * mv;
        float tw = 0.55 + 0.45 * sin(uTime * (2.0 + rnd.w * 3.0) + rnd.x * 40.0);
        float ps = uSize * (0.35 + rnd.y * 0.9) * uPR * (40.0 / max(-mv.z, 0.05)) * sc;
        gl_PointSize = clamp(max(ps, 1.5), 0.0, 64.0);
        // far away the same particles pile onto fewer pixels: dim them so the body never blows out
        float density = clamp(ps * ps / 6.0, 0.12, 1.0);
        vA = uAlpha * (1.0 - s) * tw * (1.0 - wisp * wt) * density;
        vC = mix(uColor, uColor2, rnd.z * rnd.z);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vC;
      varying float vA;
      void main(){
        vec2 c = gl_PointCoord - 0.5;
        float d2 = dot(c, c);
        float a = exp(-d2 * 22.0) * 0.6 + exp(-d2 * 90.0);
        if (a * vA < 0.003) discard;
        gl_FragColor = vec4(vC, a * vA * 0.55);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  return pts;
}

// ---------------------------------------------------------------------------
// Hologram: fresnel shell, scanlines and glitch bands.
// ---------------------------------------------------------------------------
export function createHoloMesh(model, rig, opts = {}) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uBones: rig.uniform,
      uTime: opts.uTime || { value: 0 },
      uAlpha: { value: 1 },
      uColor: { value: new THREE.Color(...(opts.color ?? [0.3, 1.6, 2.4])) },
      uColor2: { value: new THREE.Color(...(opts.color2 ?? [2.4, 0.4, 1.8])) },
    },
    vertexShader: /* glsl */ `
      ${SKIN_GLSL}
      uniform float uTime;
      varying vec3 vN, vW;
      varying float vGl;
      float h(float p){ p = fract(p*0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
      void main(){
        vec4 wp = modelMatrix * vec4(skinP(position), 1.0);
        float band = floor(wp.y * 0.8 + floor(uTime * 12.0) * 3.1);
        float g = step(0.965, h(band));
        wp.x += g * (h(band + 1.0) - 0.5) * 3.0;
        vGl = g;
        vW = wp.xyz;
        vN = normalize(mat3(modelMatrix) * skinN(normal));
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime, uAlpha;
      uniform vec3 uColor, uColor2;
      varying vec3 vN, vW;
      varying float vGl;
      void main(){
        vec3 V = normalize(cameraPosition - vW);
        float fr = pow(1.0 - abs(dot(normalize(vN), V)), 2.2);
        float scan = 0.5 + 0.5 * sin(vW.y * 6.0 - uTime * 5.0);
        float fine = 0.5 + 0.5 * sin(vW.y * 60.0);
        float flick = 0.85 + 0.15 * sin(uTime * 31.0) * sin(uTime * 7.0);
        vec3 col = mix(uColor, uColor2, vGl + 0.25 * scan) * (fr * 1.6 + 0.08 + scan * 0.18 * fine) * flick;
        gl_FragColor = vec4(col, uAlpha * clamp(fr + 0.25, 0.0, 1.0));
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(model.geometry, mat);
  mesh.frustumCulled = false;
  return mesh;
}

// ---------------------------------------------------------------------------
// Runes: the deer of the magic world is written in glyphs.
// ---------------------------------------------------------------------------
export function createGlyphAtlas(seed = 5) {
  const size = 512, cells = 4, cs = size / cells;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, size, size);
  const rnd = mulberry32(seed);
  g.strokeStyle = '#fff';
  g.lineCap = 'round';
  g.shadowColor = '#fff';
  g.shadowBlur = 10;
  for (let i = 0; i < cells * cells; i++) {
    const ox = (i % cells) * cs, oy = Math.floor(i / cells) * cs;
    const P = (x, y) => [ox + cs * (0.22 + x * 0.56), oy + cs * (0.12 + y * 0.76)];
    g.lineWidth = cs * 0.075;
    g.beginPath();
    // stem
    const sx = rnd() < 0.7 ? 0.5 : rnd();
    g.moveTo(...P(sx, 0)); g.lineTo(...P(sx, 1));
    const strokes = 1 + Math.floor(rnd() * 3);
    for (let s = 0; s < strokes; s++) {
      const y0 = rnd() * 0.7, y1 = y0 + 0.15 + rnd() * 0.3;
      const dir = rnd() < 0.5 ? 0 : 1;
      g.moveTo(...P(sx, y0)); g.lineTo(...P(dir, y1));
    }
    if (rnd() < 0.35) { g.moveTo(...P(0, 0.5)); g.lineTo(...P(1, 0.5)); }
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

export function createRunePoints(model, rig, count, atlas, opts = {}) {
  const g = model.pointsGeometry(count, opts.seed ?? 21);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uBones: rig.uniform,
      uTime: opts.uTime || { value: 0 },
      uPR: opts.uPR || { value: 1 },
      uSize: { value: opts.size ?? 1 },
      uAlpha: { value: 1 },
      uScatter: { value: 0 },
      uAtlas: { value: atlas },
      uColor: { value: new THREE.Color(...(opts.color ?? [2.4, 1.6, 0.6])) },
      uColor2: { value: new THREE.Color(...(opts.color2 ?? [0.6, 2.0, 2.4])) },
    },
    vertexShader: /* glsl */ `
      ${SKIN_GLSL}
      attribute vec4 rnd;
      uniform float uTime, uSize, uAlpha, uPR, uScatter;
      uniform vec3 uColor, uColor2;
      varying vec3 vC;
      varying float vA, vG;
      void main(){
        float sc = length(modelMatrix[0].xyz);
        vec4 wp = modelMatrix * vec4(skinP(position + normal * 0.02), 1.0);
        vec3 wn = normalize(mat3(modelMatrix) * skinN(normal));
        float s = clamp(uScatter, 0.0, 1.0);
        wp.xyz += normalize(wn + (rnd.xyz - 0.5)) * s * (1.0 + rnd.w * 3.0) * sc;
        vec4 mv = viewMatrix * wp;
        gl_Position = projectionMatrix * mv;
        float ps = uSize * (0.6 + rnd.y * 0.8) * uPR * (40.0 / max(-mv.z, 0.05)) * sc;
        gl_PointSize = clamp(max(ps, 2.0), 0.0, 64.0);
        float density = clamp(ps * ps / 40.0, 0.15, 1.0);
        float flip = floor(uTime * (0.5 + rnd.x) + rnd.z * 10.0);
        vG = floor(fract(rnd.w * 13.7 + flip * 0.618) * 16.0);
        float pulse = 0.5 + 0.5 * sin(uTime * 2.0 + position.z * 4.0 - position.y * 2.0);
        vA = uAlpha * (1.0 - s) * (0.45 + 0.55 * pulse) * density * 0.22;
        vC = mix(uColor, uColor2, smoothstep(0.3, 0.9, rnd.z));
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uAtlas;
      varying vec3 vC;
      varying float vA, vG;
      void main(){
        vec2 cell = vec2(mod(vG, 4.0), floor(vG / 4.0));
        float a = texture2D(uAtlas, (gl_PointCoord + cell) / 4.0).r;
        if (a * vA < 0.01) discard;
        gl_FragColor = vec4(vC, a * vA);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  return pts;
}
