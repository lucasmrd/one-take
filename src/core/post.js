import * as THREE from 'three';
import { NOISE_GLSL } from './noise.js';

const FULL_VS = /* glsl */ `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

// Mixes two world renders with a transition mask.
// 0 single · 1 iris (circle) · 2 rune ring · 3 circuit dissolve · 4 flash cut · 5 crossfade
export function createCompositeMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      tA: { value: null },
      tB: { value: null },
      uMode: { value: 0 },
      uP: { value: 0 },
      uCenter: { value: new THREE.Vector2(0.5, 0.5) },
      uRadius: { value: 0 },
      uAspect: { value: 1 },
      uTime: { value: 0 },
      uEdge: { value: new THREE.Color(1, 0.7, 0.3) },
    },
    vertexShader: FULL_VS,
    fragmentShader: /* glsl */ `
      uniform sampler2D tA, tB;
      uniform int uMode;
      uniform float uP, uRadius, uAspect, uTime;
      uniform vec2 uCenter;
      uniform vec3 uEdge;
      varying vec2 vUv;
      ${NOISE_GLSL}

      float sdSeg(vec2 p, vec2 a, vec2 b){ vec2 pa = p-a, ba = b-a; float h = clamp(dot(pa,ba)/dot(ba,ba),0.,1.); return length(pa-ba*h); }

      // distance-like value: small on PCB traces, larger away from them
      float circuit(vec2 p){
        vec2 c = floor(p); vec2 f = fract(p);
        float h = hash12(c);
        float d = 1.0;
        // main trace through the cell, horizontal or vertical
        if (h < 0.5) d = min(d, abs(f.y - 0.5)); else d = min(d, abs(f.x - 0.5));
        // a 45 degree jog in some cells
        if (hash12(c + 4.1) > 0.55) d = min(d, sdSeg(f, vec2(0.5, 0.5), vec2(1.0, 1.0)));
        // vias
        d = min(d, abs(length(f - 0.5) - 0.12));
        return d;
      }

      void main(){
        vec4 a = texture2D(tA, vUv);
        if (uMode == 0) { gl_FragColor = a; return; }
        vec2 d = (vUv - uCenter) * vec2(uAspect, 1.0);
        float r = length(d);
        if (uMode == 1) {
          vec4 b = texture2D(tB, vUv);
          float m = 1.0 - smoothstep(uRadius*0.985 - 0.002, uRadius, r);
          gl_FragColor = mix(a, b, m);
        } else if (uMode == 2) {
          vec4 b = texture2D(tB, vUv);
          float R = uRadius;
          float m = 1.0 - smoothstep(R - 0.004, R, r);
          float ang = atan(d.y, d.x);
          float seg = floor((ang + 3.14159) / 6.28318 * 40.0 - uTime*0.6);
          float glyph = step(0.35, hash11(seg*7.13));
          float ring = exp(-pow((r - R)/0.010, 2.0)) * (1.5 + 2.5*glyph);
          float ring2 = exp(-pow((r - R*0.93)/0.004, 2.0)) * 1.2;
          float ring3 = exp(-pow((r - R*1.06)/0.003, 2.0)) * 0.8 * glyph;
          vec3 col = mix(a.rgb, b.rgb, m) + uEdge * (ring + ring2 + ring3) * smoothstep(0.0, 0.05, R) * (1.0 - smoothstep(1.2, 1.6, R));
          gl_FragColor = vec4(col, 1.0);
        } else if (uMode == 3) {
          vec4 b = texture2D(tB, vUv);
          vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0) * 7.0;
          float v = clamp(circuit(p) * 1.6, 0.0, 1.0) * 0.88 + (snoise(vec3(p*0.25, 2.0))*0.5+0.5)*0.12;
          float th = uP * 1.25 - 0.12;
          float m = 1.0 - smoothstep(th - 0.03, th, v);
          float e = exp(-pow((v - th)/0.012, 2.0)) * step(0.001, uP) * step(uP, 0.999);
          gl_FragColor = vec4(mix(a.rgb, b.rgb, m) + uEdge * e * 1.3, 1.0);
        } else if (uMode == 4) {
          vec4 b = texture2D(tB, vUv);
          float s = smoothstep(0.0, 0.5, uP) * 0.35;
          vec3 acc = vec3(0.0);
          for (int i = 0; i < 16; i++) {
            float k = float(i) / 15.0;
            acc += texture2D(tA, uCenter + (vUv - uCenter) * (1.0 - s*k)).rgb;
          }
          acc /= 16.0;
          float flash = exp(-pow((uP - 0.5)/0.09, 2.0));
          vec3 col = mix(acc, b.rgb, smoothstep(0.45, 0.62, uP));
          gl_FragColor = vec4(col + vec3(1.0, 0.86, 0.7) * flash * 6.0, 1.0);
        } else {
          vec4 b = texture2D(tB, vUv);
          gl_FragColor = mix(a, b, smoothstep(0.0, 1.0, uP));
        }
      }
    `,
    depthTest: false,
    depthWrite: false,
  });
}

// Final look: chromatic aberration, god rays, exposure, vignette, grain, fades.
export function createGradeMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      tDiffuse: { value: null },
      uSun: { value: new THREE.Vector2(0.5, 0.5) },
      uRays: { value: 0 },
      uRayTint: { value: new THREE.Color(1, 0.8, 0.55) },
      uCA: { value: 0.0025 },
      uVignette: { value: 0.9 },
      uGrain: { value: 0.035 },
      uFade: { value: 1 },
      uFlash: { value: 0 },
      uExposure: { value: 1 },
      uTime: { value: 0 },
      uAspect: { value: 1 },
      uRes: { value: new THREE.Vector2(1, 1) },
      uLetterbox: { value: 0 },
    },
    vertexShader: FULL_VS,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse;
      uniform vec2 uSun, uRes;
      uniform float uRays, uCA, uVignette, uGrain, uFade, uFlash, uExposure, uTime, uAspect, uLetterbox;
      uniform vec3 uRayTint;
      varying vec2 vUv;
      float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y)*p3.z); }
      void main(){
        vec2 uv = vUv;
        vec2 dir = uv - 0.5;
        float ca = uCA * (0.4 + dot(dir, dir) * 4.0);
        vec3 col;
        col.r = texture2D(tDiffuse, uv - dir * ca).r;
        col.g = texture2D(tDiffuse, uv).g;
        col.b = texture2D(tDiffuse, uv + dir * ca).b;

        if (uRays > 0.001) {
          vec2 delta = (uv - uSun) * (0.85 / 56.0);
          vec2 p = uv;
          float decay = 1.0;
          vec3 acc = vec3(0.0);
          float jitter = h12(uv * uRes + fract(uTime));
          p -= delta * jitter;
          for (int i = 0; i < 56; i++) {
            p -= delta;
            vec3 s = texture2D(tDiffuse, clamp(p, 0.001, 0.999)).rgb;
            float l = max(dot(s, vec3(0.3, 0.59, 0.11)) - 0.9, 0.0);
            acc += uRayTint * min(l, 6.0) * decay;
            decay *= 0.965;
          }
          col += acc / 56.0 * uRays;
        }

        col *= uExposure;
        col += uFlash;
        vec2 vd = dir * vec2(uAspect, 1.0);
        float vig = smoothstep(1.25, 0.25, length(vd));
        col *= mix(1.0, vig, uVignette);
        float g = h12(uv * uRes + fract(uTime * 7.31) * 100.0) - 0.5;
        col += g * uGrain * (0.25 + sqrt(max(col, 0.0)) * 0.6);
        col *= uFade;
        float lb = step(abs(uv.y - 0.5), 0.5 - uLetterbox);
        col *= lb;
        gl_FragColor = vec4(max(col, 0.0), 1.0);
      }
    `,
    depthTest: false,
    depthWrite: false,
  });
}
