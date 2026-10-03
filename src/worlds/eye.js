import * as THREE from 'three';
import { NOISE_GLSL } from '../core/noise.js';
import { lerp, smoothstep, range, bump, easeInOut } from '../core/util.js';

// A procedural macro eye, rendered as a full-screen shader.
// mode 'enter': the bear's iris fills the screen, the pupil dilates into space.
// mode 'final': the Earth shrinks into the catchlight of the same eye, which looks back at you.
export class EyeWorld {
  constructor(ctx, mode) {
    this.ctx = ctx;
    this.mode = mode;
    this.range = mode === 'enter' ? [236, 294] : [926, 1000];
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.U = {
      uTime: { value: 0 },
      uAspect: { value: 1 },
      uZoom: { value: 1 },
      uFocus: { value: new THREE.Vector2(0, 0) },
      uLook: { value: new THREE.Vector2(0, 0) },
      uPupil: { value: 0.3 },
      uOpen: { value: 1 },
      uLight: { value: 1 },
      uEarth: { value: mode === 'final' ? 1 : 0 },
      uCatch: { value: new THREE.Vector2(-0.16, 0.17) },
      uGlow: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.U,
      vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */ `
        ${NOISE_GLSL}
        uniform float uTime, uAspect, uZoom, uPupil, uOpen, uLight, uEarth, uGlow;
        uniform vec2 uFocus, uLook, uCatch;
        varying vec2 vUv;

        const float IRIS = 0.5;

        vec3 earth(vec2 q, float r){
          // tiny planet seen as a reflection: day crescent, oceans, clouds
          vec2 p = q / r;
          float z = sqrt(max(0.0, 1.0 - dot(p, p)));
          vec3 n = vec3(p, z);
          float rot = uTime * 0.05;
          vec3 sp = vec3(n.x * cos(rot) - n.z * sin(rot), n.y, n.x * sin(rot) + n.z * cos(rot));
          float land = smoothstep(0.02, 0.1, fbm3lo(sp * 2.2));
          vec3 col = mix(vec3(0.03, 0.12, 0.45), vec3(0.18, 0.32, 0.12), land);
          float cl = smoothstep(0.15, 0.6, fbm3lo(sp * 4.0 + 3.0));
          col = mix(col, vec3(1.0), cl * 0.8);
          float day = smoothstep(-0.2, 0.4, dot(n, normalize(vec3(0.7, 0.3, 0.5))));
          col *= 0.08 + day * 2.2;
          col += vec3(0.25, 0.5, 1.3) * pow(1.0 - z, 3.0) * (0.3 + day);
          return col;
        }

        vec3 env(vec3 r){
          // what the cornea reflects: a dawn sky framed by tree silhouettes
          float y = r.y;
          vec3 sky = mix(vec3(1.0, 0.62, 0.42), vec3(0.15, 0.25, 0.5), smoothstep(-0.1, 0.8, y));
          float trees = smoothstep(0.02, -0.02, y - 0.25 - 0.15 * snoise(vec3(r.x * 9.0, 0.0, 1.0)) - 0.1 * snoise(vec3(r.x * 30.0, 2.0, 0.0)));
          return mix(sky, vec3(0.02, 0.03, 0.02), trees) * (1.0 - uEarth * 0.9);
        }

        void main(){
          vec2 sp = (vUv - 0.5) * vec2(uAspect, 1.0);
          vec2 p = uFocus + sp / uZoom;

          // eyelid opening (almond)
          float ex = p.x / 1.05;
          float lid = 0.62 * pow(max(0.0, 1.0 - ex * ex), 0.65);
          float upper = lid * uOpen - 0.02 + 0.03 * ex;
          float lower = -lid * (0.55 + 0.45 * uOpen);
          float inOpen = smoothstep(upper + 0.012, upper - 0.012, p.y) * smoothstep(lower - 0.012, lower + 0.012, p.y) * step(abs(ex), 0.995) * step(lower + 0.004, upper);

          // fur around the eye
          vec2 fp = p * vec2(1.0, 1.4);
          float fang = atan(fp.y, fp.x);
          float fr = length(fp);
          float strands = snoise(vec3(fang * 40.0, fr * 4.0, 0.0)) * 0.5 + 0.5;
          strands = mix(strands, snoise(vec3(fang * 90.0, fr * 9.0, 3.0)) * 0.5 + 0.5, 0.5);
          vec3 fur = mix(vec3(0.018, 0.011, 0.007), vec3(0.16, 0.1, 0.055), strands * strands);
          fur *= 0.6 + 0.6 * smoothstep(1.4, 0.5, fr);
          fur += vec3(0.9, 0.55, 0.25) * pow(strands, 6.0) * 0.25 * smoothstep(1.2, 0.6, fr);
          float lidDark = smoothstep(0.0, 0.08, abs(p.y - upper)) * smoothstep(0.0, 0.06, abs(p.y - lower));

          // eyeball
          vec2 q = p - uLook * 0.09;
          float r = length(q);
          float a = atan(q.y, q.x);
          float pr = IRIS * uPupil;

          // iris with radial fibres, crypts, collarette, limbal ring
          vec3 cs = vec3(cos(a), sin(a), 0.0);
          float fib = snoise(vec3(cs.xy * 26.0, r * 3.0 + uTime * 0.02)) * 0.5 + snoise(vec3(cs.xy * 60.0, r * 8.0)) * 0.3;
          float crypt = smoothstep(0.3, 0.8, snoise(vec3(cs.xy * 22.0, r * 4.5)));
          float t = clamp((r - pr) / max(IRIS - pr, 1e-3), 0.0, 1.0);
          vec3 inner = vec3(1.15, 0.5, 0.07);
          vec3 mid = vec3(0.55, 0.23, 0.035);
          vec3 outer = vec3(0.1, 0.04, 0.012);
          vec3 iris = mix(inner, mid, smoothstep(0.0, 0.35, t));
          iris = mix(iris, outer, smoothstep(0.45, 1.0, t));
          iris *= 0.35 + 1.1 * pow(fib * 0.5 + 0.5, 1.4);
          iris *= 1.0 - crypt * 0.6 * smoothstep(0.15, 0.45, t);
          float coll = exp(-pow((t - 0.3) / 0.06, 2.0));
          iris += vec3(1.3, 0.85, 0.35) * coll * (0.35 + 0.4 * fib);
          float fleck = smoothstep(0.82, 0.95, snoise(vec3(cs.xy * 40.0, r * 30.0)));
          iris += vec3(2.4, 1.6, 0.6) * fleck * 0.6 * (1.0 + uGlow * 3.0);
          iris *= smoothstep(1.02, 0.85, r / IRIS);
          iris *= 0.35 + 0.65 * smoothstep(0.0, 0.08, t);

          // sclera: dark, wet, a few vessels
          vec3 sclera = vec3(0.16, 0.08, 0.05) * (0.7 + 0.3 * snoise(vec3(p * 6.0, 1.0)));
          sclera += vec3(0.25, 0.03, 0.02) * smoothstep(0.85, 0.95, snoise(vec3(p * 18.0, 5.0)) * 0.5 + 0.5);
          vec3 ball = mix(iris, sclera, smoothstep(IRIS * 0.99, IRIS * 1.08, r));
          // pupil
          float pupil = smoothstep(pr + 0.006, pr - 0.006, r);
          ball = mix(ball, vec3(0.004, 0.003, 0.003), pupil);

          // cornea reflection
          float cr = r / (IRIS * 1.15);
          vec3 n = normalize(vec3(q / (IRIS * 1.15), sqrt(max(0.0, 1.0 - cr * cr))));
          vec3 refl = env(reflect(vec3(0.0, 0.0, -1.0), n) * vec3(1.0, -1.0, 1.0) * -1.0);
          float fres = 0.04 + 0.5 * pow(1.0 - n.z, 3.0);
          ball += refl * fres * 0.8;
          // catchlight (window) or Earth
          vec2 cq = p - uCatch;
          float win = smoothstep(0.035, 0.02, length(max(abs(cq * vec2(1.0, 1.25)) - vec2(0.025), 0.0)));
          ball += vec3(1.6, 1.4, 1.2) * win * (1.0 - uEarth) * 0.55;
          float er = 0.028;
          float ed = length(cq);
          if (uEarth > 0.0 && ed < er * 1.6) {
            vec3 e = earth(cq, er);
            ball = mix(ball, e, smoothstep(er, er * 0.96, ed) * uEarth);
            ball += vec3(0.3, 0.55, 1.3) * exp(-pow((ed - er) / 0.004, 2.0)) * uEarth * 0.6;
          }
          ball *= mix(0.25, 1.0, smoothstep(0.0, 0.1, p.y - lower)) * mix(0.15, 1.0, smoothstep(0.0, 0.14, upper - p.y));

          vec3 col = mix(fur * lidDark, ball, inOpen);
          // wet lid line
          col += vec3(1.0, 0.85, 0.7) * exp(-pow((p.y - lower - 0.008) / 0.004, 2.0)) * inOpen * 0.4;
          col *= uLight;
          // keep the earth visible while everything else is still dark
          if (uEarth > 0.0) {
            vec3 e = earth(cq, er);
            float m = smoothstep(er, er * 0.96, ed) * (1.0 - uLight);
            col = mix(col, e, m * inOpen);
          }
          gl_FragColor = vec4(col, 1.0);
        }
      `,
      depthTest: false,
      depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    quad.frustumCulled = false;
    this.scene.add(quad);
    this.look = new THREE.Vector2();
  }

  update(u, time, dt) {
    const U = this.U;
    U.uTime.value = time;
    const ctx = this.ctx;
    U.uAspect.value = ctx.aspect;
    const m = ctx.mouse;
    if (this.mode === 'enter') {
      // macro on the iris; pupil dilates and becomes a window into space
      U.uZoom.value = lerp(1.35, 2.3, range(u, 238, 292));
      U.uFocus.value.set(0, 0);
      const sacc = new THREE.Vector2(Math.sin(time * 0.7) * 0.15 + Math.sin(time * 2.3) * 0.05, Math.cos(time * 0.5) * 0.1);
      this.look.lerp(sacc.addScaledVector(new THREE.Vector2(m.x, m.y), 0.6), 1 - Math.exp(-dt * 4));
      U.uLook.value.copy(this.look).multiplyScalar(1 - range(u, 266, 280));
      const breathe = 0.02 * Math.sin(time * 1.3);
      U.uPupil.value = lerp(0.28 + breathe, 0.42, range(u, 244, 262)) + Math.pow(range(u, 276, 292), 2.5) * 0.62;
      U.uOpen.value = 1;
      U.uLight.value = 1;
      U.uGlow.value = bump(u, 250, 260, 268, 276);
    } else {
      // the pale blue dot is the catchlight of the eye
      const t = range(u, 928, 952);
      const e = easeInOut(t);
      U.uZoom.value = Math.exp(lerp(Math.log(0.1), Math.log(0.78), e));
      U.uFocus.value.copy(U.uCatch.value).lerp(new THREE.Vector2(0, 0), smoothstep(0.35, 1, t));
      U.uLight.value = smoothstep(0.15, 0.85, t);
      this.look.lerp(new THREE.Vector2(m.x, m.y), 1 - Math.exp(-dt * 3));
      U.uLook.value.copy(this.look).multiplyScalar(smoothstep(950, 956, u));
      U.uPupil.value = 0.34 + 0.03 * Math.sin(time * 1.1) - 0.08 * bump(u, 952, 956, 962, 966);
      // the blink that ends everything
      U.uOpen.value = 1 - smoothstep(965, 970.5, u) + 0.0 * bump(u, 956.5, 957, 957.2, 957.7);
      U.uGlow.value = bump(u, 950, 955, 960, 965);
    }
  }

  // pupil circle in screen space, for the iris transition
  pupilMask() {
    const U = this.U;
    const c = new THREE.Vector2(0, 0).sub(U.uFocus.value).add(U.uLook.value.clone().multiplyScalar(0.09)).multiplyScalar(U.uZoom.value);
    return { center: new THREE.Vector2(0.5 + c.x / U.uAspect.value, 0.5 + c.y), radius: 0.5 * U.uPupil.value * U.uZoom.value };
  }

  post(out) {
    out.rays = 0;
    out.exposure = 1;
  }
}
