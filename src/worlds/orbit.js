import * as THREE from 'three';
import { NOISE_GLSL, STARS_GLSL } from '../core/noise.js';
import { SPACE_SKY_GLSL } from './space.js';
import { lerp, smoothstep, range, easeInOut, toScreen, skyDome, SKY_VS } from '../core/util.js';

const R = 100;
const SUN = new THREE.Vector3(0.22, 0.06, -1).normalize();

export class OrbitWorld {
  constructor(ctx) {
    this.ctx = ctx;
    this.range = [856, 944];
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.3, 200000);
    this.U = { uTime: { value: 0 }, uSun: { value: SUN } };

    const sky = new THREE.ShaderMaterial({
      uniforms: { uTime: this.U.uTime },
      vertexShader: SKY_VS,
      fragmentShader: /* glsl */ `
        uniform float uTime; varying vec3 vDir;
        ${NOISE_GLSL}
        ${STARS_GLSL}
        ${SPACE_SKY_GLSL}
        void main(){ gl_FragColor = vec4(spaceSky(normalize(vDir), 0.18), 1.0); }
      `,
      side: THREE.BackSide, depthWrite: false,
    });
    this.scene.add(skyDome(sky, 50000));

    const earth = new THREE.Mesh(new THREE.SphereGeometry(R, 160, 120), new THREE.ShaderMaterial({
      uniforms: this.U,
      vertexShader: /* glsl */ `varying vec3 vN, vW; void main(){ vN = normalize(position); vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `
        ${NOISE_GLSL}
        uniform float uTime; uniform vec3 uSun;
        varying vec3 vN, vW;
        void main(){
          vec3 n = normalize(vN);
          float rot = uTime * 0.006;
          vec3 sp = vec3(n.x * cos(rot) - n.z * sin(rot), n.y, n.x * sin(rot) + n.z * cos(rot));
          float cont = fbm3(sp * 1.7 + 2.0) + 0.3 * fbm3(sp * 6.0);
          float land = smoothstep(0.05, 0.08, cont);
          float coast = smoothstep(-0.05, 0.05, cont) * (1.0 - land);
          vec3 ocean = mix(vec3(0.004, 0.018, 0.06), vec3(0.02, 0.09, 0.16), coast);
          float dry = smoothstep(0.1, 0.55, fbm3lo(sp * 3.0 + 5.0));
          vec3 ground = mix(vec3(0.05, 0.11, 0.035), vec3(0.3, 0.24, 0.13), dry);
          ground = mix(ground, vec3(0.2, 0.18, 0.16), smoothstep(0.25, 0.4, cont) * 0.6);
          vec3 base = mix(ocean, ground, land);
          float ice = smoothstep(0.8, 0.88, abs(sp.y) + fbm3lo(sp * 5.0) * 0.06);
          base = mix(base, vec3(0.8, 0.85, 0.9), ice);
          float NdL = dot(n, uSun);
          float day = smoothstep(-0.06, 0.2, NdL);
          vec3 V = normalize(cameraPosition - vW);
          vec3 H = normalize(uSun + V);
          float spec = pow(max(dot(n, H), 0.0), 70.0) * (1.0 - land) * (1.0 - ice) * day;
          float cl = smoothstep(0.02, 0.5, fbm3(sp * 3.1 + vec3(uTime * 0.003, 0.0, 0.0)));
          // city lights clustered on land, only at night
          float cluster = smoothstep(0.1, 0.5, fbm3lo(sp * 9.0));
          float dots = step(0.82, fract(sin(dot(floor(sp * 420.0), vec3(12.9898, 78.233, 37.719))) * 43758.5453));
          float lights = land * (1.0 - ice) * (1.0 - day) * (cluster * 0.6 * (0.35 + dots) + dots * 0.15);
          vec3 col = base * max(NdL, 0.0) * 1.7;
          col += vec3(1.0, 0.85, 0.7) * spec * 1.2;
          col = mix(col, vec3(1.0) * max(NdL, 0.0) * 1.6 + vec3(0.02, 0.025, 0.04), cl * 0.85);
          col += vec3(2.4, 1.4, 0.6) * lights * (1.0 - cl * 0.75);
          float fres = pow(1.0 - max(dot(n, V), 0.0), 3.0);
          col += vec3(0.25, 0.5, 1.1) * fres * smoothstep(-0.3, 0.4, NdL) * 1.3;
          col += vec3(1.3, 0.45, 0.15) * exp(-pow(NdL / 0.07, 2.0)) * (0.25 + fres) * 0.6;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    }));
    this.scene.add(earth);

    const atmo = new THREE.Mesh(new THREE.SphereGeometry(R * 1.035, 96, 64), new THREE.ShaderMaterial({
      uniforms: this.U,
      vertexShader: /* glsl */ `varying vec3 vN, vW; void main(){ vN = normalize(position); vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uSun; varying vec3 vN, vW;
        void main(){
          vec3 V = normalize(cameraPosition - vW);
          vec3 n = normalize(vN);
          float limb = pow(max(0.0, 1.0 - abs(dot(n, V))), 2.0);
          float edge = smoothstep(0.0, 0.25, abs(dot(n, V)));
          float lit = smoothstep(-0.35, 0.3, dot(n, uSun));
          float fwd = pow(max(dot(-V, uSun), 0.0), 6.0);
          vec3 col = mix(vec3(1.4, 0.5, 0.18), vec3(0.3, 0.6, 1.4), smoothstep(-0.1, 0.35, dot(n, uSun)));
          col *= limb * lit * edge * 2.2;
          col += vec3(2.5, 1.2, 0.5) * fwd * limb * 3.0 * smoothstep(-0.3, 0.1, dot(n, uSun));
          gl_FragColor = vec4(col, 1.0);
        }
      `,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.BackSide,
    }));
    this.scene.add(atmo);

    this.sunMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        void main(){
          vec2 c = vUv - 0.5; float r = length(c);
          float core = smoothstep(0.035, 0.03, r) * 30.0;
          float glow = exp(-r * 18.0) * 3.0 + exp(-r * 6.0) * 0.4;
          float streak = exp(-abs(c.y) * 220.0) * exp(-abs(c.x) * 3.0) * 1.5;
          gl_FragColor = vec4(vec3(1.0, 0.9, 0.75) * (core + glow + streak), 1.0);
        }
      `,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.sunMesh.position.copy(SUN).multiplyScalar(60000);
    this.sunMesh.scale.setScalar(16000);
    this.scene.add(this.sunMesh);
    this.look = new THREE.Vector3();
  }

  update(u, time, dt) {
    this.U.uTime.value = time;
    const cam = this.camera;
    const t = range(u, 862, 926);
    const e = easeInOut(t);
    const d0 = R * 1.035, d1 = 52000;
    const dist = d0 * Math.exp(Math.pow(t, 1.6) * Math.log(d1 / d0));
    const dir0 = new THREE.Vector3(0, 0.985, 0.17).normalize();
    const dir1 = new THREE.Vector3(0.5, 0.32, -0.6).normalize(); // swing round to the day side: a pale blue dot
    const dir = dir0.clone().lerp(dir1, smoothstep(0.05, 0.6, t)).normalize();
    cam.position.copy(dir).multiplyScalar(dist);
    const ahead = new THREE.Vector3(0, R * 0.9, -R * 2.2);
    const look = ahead.lerp(new THREE.Vector3(0, 0, 0), smoothstep(0.08, 0.42, t));
    this.look.copy(look);
    cam.up.set(0, 1, 0);
    cam.lookAt(this.look);
    cam.fov = lerp(62, 50, e);
    cam.updateProjectionMatrix();
    this.sunMesh.lookAt(cam.position);
  }

  post(out) {
    const s = toScreen(SUN.clone().multiplyScalar(60000), this.camera);
    if (s) out.sun = s;
    const f = new THREE.Vector3();
    this.camera.getWorldDirection(f);
    out.rays = s ? 0.5 * smoothstep(0.4, 0.9, f.dot(SUN)) : 0;
    out.rayTint = [1.0, 0.85, 0.7];
    out.exposure = 1;
  }
}
