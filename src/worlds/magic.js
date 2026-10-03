import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Simplex, mulberry32, NOISE_GLSL, STARS_GLSL } from '../core/noise.js';
import { makeFogUniforms, FOG_PARS } from '../core/fog.js';
import { Rig, createRunePoints, createGlyphAtlas } from '../animals/animal.js';
import { DEER } from '../animals/specs.js';
import { lerp, smoothstep, range, bump, Track, skyDome, SKY_VS, easeInOut } from '../core/util.js';

const CENTER = new THREE.Vector3(0, 0, -700);
const PLANET = new THREE.Vector3(-0.5, 0.42, -1).normalize();

export class MagicWorld {
  constructor(ctx) {
    this.ctx = ctx;
    this.range = [508, 730];
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(58, 1, 0.3, 20000);
    this.S = new Simplex(7);
    this.rnd = mulberry32(777);
    this.U = {
      ...makeFogUniforms({ color: [0.07, 0.045, 0.13], sun: [0.32, 0.16, 0.28], sunDir: PLANET.toArray(), density: 0.0016 }),
      uTime: { value: 0 },
    };
    this.particles = 0;
    this.buildSky();
    this.buildIslands();
    this.buildCentral();
    this.buildWaterfalls();
    this.buildCrystals();
    this.buildMotes();
    this.buildDeer();

    this.curve = new THREE.CatmullRomCurve3([
      [0, 95, 380], [-40, 72, 230], [30, 46, 95], [72, 32, -60], [22, 26, -220], [-48, 22, -380], [-62, 18, -530], [-45, 16, -655],
    ].map((p) => new THREE.Vector3(...p)), false, 'centripetal');
    this.trackS = new Track([[508, 0], [530, 0.06], [560, 0.22], [600, 0.55], [630, 0.82], [645, 1.0]]);
    this.look = new THREE.Vector3();
  }

  buildSky() {
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: this.U.uTime, uPlanet: { value: PLANET } },
      vertexShader: SKY_VS,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform vec3 uPlanet;
        varying vec3 vDir;
        ${NOISE_GLSL}
        ${STARS_GLSL}
        void main(){
          vec3 d = normalize(vDir);
          float y = d.y;
          vec3 col = mix(vec3(0.6, 0.22, 0.34), vec3(0.035, 0.018, 0.1), smoothstep(-0.05, 0.45, y));
          col = mix(col, vec3(0.02, 0.01, 0.05), smoothstep(0.5, 1.0, y));
          col = mix(col, vec3(0.12, 0.05, 0.18), smoothstep(0.0, -0.4, y));
          col += stars(d) * smoothstep(0.05, 0.4, y) * 1.2;
          // aurora curtains
          float ay = smoothstep(0.12, 0.3, y) * (1.0 - smoothstep(0.45, 0.75, y));
          vec2 ap = d.xz / (y + 0.35);
          float curtain = fbm3lo(vec3(ap.x * 1.6 + uTime * 0.03, ap.y * 0.4, uTime * 0.05));
          float rays = pow(snoise(vec3(ap.x * 14.0, 0.0, uTime * 0.2)) * 0.5 + 0.5, 3.0);
          float aur = smoothstep(0.0, 0.5, curtain) * ay * (0.4 + rays);
          vec3 acol = mix(vec3(0.1, 1.4, 0.8), vec3(0.8, 0.3, 1.6), smoothstep(0.2, 0.5, y));
          col += acol * aur * 0.7;
          // ringed planet
          vec3 T = normalize(cross(uPlanet, vec3(0.0, 1.0, 0.0)));
          vec3 B = cross(T, uPlanet);
          vec2 q = vec2(dot(d, T), dot(d, B)) / 0.12;
          float facing = dot(d, uPlanet);
          if (facing > 0.0) {
            float r = length(q);
            vec2 rq = vec2(q.x * cos(0.35) - q.y * sin(0.35), q.x * sin(0.35) + q.y * cos(0.35));
            vec2 e = vec2(rq.x, rq.y * 4.2);
            float re = length(e);
            float ring = smoothstep(1.35, 1.4, re) * (1.0 - smoothstep(2.3, 2.35, re));
            ring *= 0.55 + 0.45 * sin(re * 40.0) * sin(re * 13.0);
            bool behind = rq.y > 0.0 && r < 1.0;
            if (r < 1.0) {
              float z = sqrt(1.0 - r * r);
              vec3 n = vec3(q, z);
              float lit = smoothstep(-0.2, 0.6, dot(n, normalize(vec3(0.6, 0.5, 0.4))));
              float bands = snoise(vec3(0.0, q.y * 7.0 + snoise(vec3(q * 3.0, 1.0)) * 0.4, 2.0)) * 0.5 + 0.5;
              vec3 pc = mix(vec3(0.5, 0.25, 0.45), vec3(1.0, 0.7, 0.55), bands);
              col = pc * (0.06 + lit * 1.3) + vec3(1.0, 0.5, 0.8) * pow(1.0 - z, 4.0) * 0.6;
            }
            if (!behind) col += vec3(1.1, 0.85, 0.75) * ring * 0.55 * smoothstep(0.0, 0.05, facing);
            col += vec3(0.9, 0.4, 0.7) * exp(-max(r - 1.0, 0.0) * 4.0) * 0.18 * step(1.0, r);
          }
          gl_FragColor = vec4(col, 1.0);
        }
      `,
      side: THREE.BackSide,
      depthWrite: false,
    });
    this.scene.add(skyDome(mat, 9000));
  }

  litMaterial(extra = {}) {
    return new THREE.ShaderMaterial({
      uniforms: { ...this.U, uGlowCol: { value: new THREE.Color(...(extra.glow ?? [0.2, 1.6, 1.8])) }, uVeins: { value: extra.veins ?? 1 } },
      vertexShader: /* glsl */ `
        attribute vec3 color;
        varying vec3 vC, vN, vW, vL;
        void main(){
          vec4 wp = modelMatrix * vec4(position, 1.0);
          #ifdef USE_INSTANCING
            wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
            vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
          #else
            vN = normalize(mat3(modelMatrix) * normal);
          #endif
          vW = wp.xyz; vC = color; vL = position;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        ${NOISE_GLSL}
        ${FOG_PARS}
        uniform vec3 uGlowCol; uniform float uVeins, uTime;
        varying vec3 vC, vN, vW, vL;
        void main(){
          vec3 N = normalize(vN);
          if (!gl_FrontFacing) N = -N;
          vec3 L = normalize(vec3(0.5, 0.6, 0.3));
          float diff = max(dot(N, L), 0.0);
          float hemi = N.y * 0.5 + 0.5;
          vec3 V = normalize(cameraPosition - vW);
          float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
          vec3 col = vC * (vec3(0.18, 0.12, 0.3) * hemi + vec3(1.15, 0.85, 0.95) * diff * 0.9);
          col += vec3(0.9, 0.4, 0.8) * rim * 0.35;
          float v = abs(snoise(vW * 0.09));
          float vein = (1.0 - smoothstep(0.0, 0.035, v)) * uVeins * smoothstep(-0.5, -4.0, vL.y);
          float pulse = 0.6 + 0.4 * sin(uTime * 1.5 + vW.y * 0.2);
          col += uGlowCol * vein * pulse * 1.6;
          col = applyFog(col, vW);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
      side: THREE.DoubleSide,
    });
  }

  islandGeo(r, seed, flat = false) {
    const S = new Simplex(seed);
    const prof = [[0.001, 0.4], [0.3, 0.45], [0.6, 0.35], [0.88, 0.15], [1.0, -0.15], [0.96, -0.32], [0.82, -0.55], [0.62, -0.85], [0.42, -1.15], [0.24, -1.45], [0.1, -1.7], [0.001, -1.85]];
    const pts = prof.map(([x, y]) => new THREE.Vector2(x * r, y * r * (y < 0 ? 1 : flat ? 0 : 0.15)));
    let g = new THREE.LatheGeometry(pts, 40);
    g.deleteAttribute('uv'); g.deleteAttribute('normal');
    g = weld(g);
    const P = g.attributes.position.array;
    const col = new Float32Array(P.length);
    for (let i = 0; i < P.length; i += 3) {
      const x = P[i], y = P[i + 1], z = P[i + 2];
      const rr = Math.hypot(x, z);
      const n = S.noise3(x * 0.12, y * 0.12, z * 0.12);
      const k = 1 + n * 0.22 + S.noise3(x * 0.4, y * 0.4, z * 0.4) * 0.06;
      if (rr > 0.01) { P[i] = x * k; P[i + 2] = z * k; }
      P[i + 1] = y + (y < 0 ? S.noise3(x * 0.2, 5, z * 0.2) * r * 0.25 : S.noise3(x * 0.15, 1, z * 0.15) * r * (flat ? 0.004 : 0.05));
      const top = smoothstep(-0.25 * r, 0.05 * r, P[i + 1]);
      const g2 = S.noise3(x * 0.3, 0, z * 0.3) * 0.5 + 0.5;
      const grass = [0.03 + g2 * 0.05, 0.13 + g2 * 0.07, 0.11];
      const rock = [0.2, 0.12, 0.22];
      for (let c = 0; c < 3; c++) col[i + c] = lerp(rock[c], grass[c], top);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    return g;
  }

  treeGeo() {
    const parts = [];
    const trunk = new THREE.CylinderGeometry(0.15, 0.3, 6, 6);
    trunk.translate(0, 3, 0);
    tint(trunk, [0.25, 0.15, 0.25]);
    parts.push(trunk.toNonIndexed());
    const rnd = mulberry32(3);
    for (let i = 0; i < 4; i++) {
      const b = new THREE.IcosahedronGeometry(1.4 + rnd() * 0.8, 1);
      b.translate((rnd() - 0.5) * 2.5, 6 + rnd() * 2.5, (rnd() - 0.5) * 2.5);
      tint(b, [0.75, 0.3, 0.65]);
      parts.push(b);
    }
    const g = mergeGeometries(parts);
    g.computeVertexNormals();
    return g;
  }

  buildIslands() {
    const mat = this.litMaterial();
    this.islands = [];
    const rnd = this.rnd;
    const treeGeo = this.treeGeo();
    const treeMat = this.litMaterial({ glow: [2.0, 0.6, 1.6], veins: 0 });
    const trees = [];
    for (let i = 0; i < 46; i++) {
      const z = 420 - rnd() * 1250;
      const side = rnd() < 0.5 ? -1 : 1;
      const x = side * (45 + Math.pow(rnd(), 0.7) * 320);
      const y = -60 + rnd() * 170;
      const r = 10 + Math.pow(rnd(), 1.6) * 38;
      const geo = this.islandGeo(r, 300 + i);
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.y = rnd() * 6;
      this.scene.add(m);
      this.islands.push({ m, r, base: y, phase: rnd() * 6 });
      const nt = Math.floor(r / 6);
      for (let k = 0; k < nt; k++) {
        const a = rnd() * 6.28, d = rnd() * r * 0.7;
        trees.push([x + Math.cos(a) * d, y + r * 0.05, z + Math.sin(a) * d, 0.6 + rnd() * 0.8, i]);
      }
    }
    this.trees = new THREE.InstancedMesh(treeGeo, treeMat, trees.length);
    this.treeData = trees;
    this.scene.add(this.trees);
  }

  buildCentral() {
    const mat = this.litMaterial({ glow: [2.2, 1.4, 0.4] });
    const g = this.islandGeo(62, 99, true);
    this.central = new THREE.Mesh(g, mat);
    this.central.position.copy(CENTER).add(new THREE.Vector3(0, -0.2, 0));
    this.scene.add(this.central);

    // rune circle
    this.circleU = { uTime: this.U.uTime, uPower: { value: 1 } };
    const cm = new THREE.ShaderMaterial({
      uniforms: this.circleU,
      vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uTime, uPower;
        varying vec2 vUv;
        float h11(float p){ p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
        float seg(vec2 p, vec2 a, vec2 b){ vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }
        float ringL(float r, float R, float w){ return 1.0 - smoothstep(w * 0.5, w, abs(r - R)); }
        float glyphBand(vec2 p, float r0, float r1, float n, float speed){
          float r = length(p);
          if (r < r0 || r > r1) return 0.0;
          float a = atan(p.y, p.x) + uTime * speed;
          float cell = floor((a + 3.14159) / 6.28318 * n);
          float fa = fract((a + 3.14159) / 6.28318 * n);
          vec2 q = vec2(fa, (r - r0) / (r1 - r0));
          float d = 1.0;
          float s = h11(cell * 3.7 + n);
          d = min(d, seg(q, vec2(0.5, 0.1), vec2(0.5, 0.9)));
          if (s > 0.3) d = min(d, seg(q, vec2(0.5, 0.5 + h11(cell) * 0.3), vec2(0.15 + h11(cell + 1.0) * 0.2, 0.2)));
          if (s > 0.55) d = min(d, seg(q, vec2(0.5, 0.35), vec2(0.85, 0.15 + h11(cell + 2.0) * 0.5)));
          if (s > 0.8) d = min(d, seg(q, vec2(0.2, 0.75), vec2(0.8, 0.75)));
          return 1.0 - smoothstep(0.04, 0.08, d * vec2(1.0, (r1 - r0) * n / 6.2832).y);
        }
        void main(){
          vec2 p = (vUv - 0.5) * 2.0;
          float r = length(p);
          float l = 0.0;
          l += ringL(r, 0.98, 0.012) + ringL(r, 0.95, 0.006) + ringL(r, 0.80, 0.008) + ringL(r, 0.77, 0.004);
          l += ringL(r, 0.56, 0.01) + ringL(r, 0.32, 0.008) + ringL(r, 0.12, 0.01);
          l += glyphBand(p, 0.815, 0.935, 36.0, 0.06);
          l += glyphBand(p, 0.6, 0.74, 24.0, -0.09);
          // hexagram
          float rot = uTime * 0.04;
          for (int k = 0; k < 6; k++) {
            float a0 = rot + float(k) * 1.0472, a1 = rot + float(k + 2) * 1.0472;
            l += 1.0 - smoothstep(0.004, 0.009, seg(p, vec2(cos(a0), sin(a0)) * 0.56, vec2(cos(a1), sin(a1)) * 0.56));
          }
          // inner triangle, counter rotating
          for (int k = 0; k < 3; k++) {
            float a0 = -rot * 2.0 + float(k) * 2.0944, a1 = -rot * 2.0 + float(k + 1) * 2.0944;
            l += 1.0 - smoothstep(0.004, 0.009, seg(p, vec2(cos(a0), sin(a0)) * 0.32, vec2(cos(a1), sin(a1)) * 0.32));
          }
          l = clamp(l, 0.0, 1.5) * step(r, 1.0);
          float pulse = 0.75 + 0.25 * sin(uTime * 2.0 - r * 6.0);
          vec3 col = mix(vec3(1.5, 0.9, 0.25), vec3(0.35, 1.3, 1.45), smoothstep(0.4, 1.0, r) * 0.35) * l * pulse * uPower;
          col += vec3(1.2, 0.6, 0.2) * exp(-r * 3.0) * 0.25 * uPower;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const circle = new THREE.Mesh(new THREE.PlaneGeometry(36, 36), cm);
    circle.rotation.x = -Math.PI / 2;
    circle.position.copy(CENTER).add(new THREE.Vector3(0, 0.45, 0));
    this.scene.add(circle);
    this.circle = circle;

    // the mage: robe, hood, staff and orb
    const robeMat = this.litMaterial({ veins: 0 });
    const robe = new THREE.LatheGeometry([[0.001, 0], [1.0, 0], [0.82, 0.7], [0.55, 1.6], [0.42, 2.35], [0.34, 2.75], [0.001, 2.8]].map(([x, y]) => new THREE.Vector2(x, y)), 24);
    tint(robe, [0.06, 0.04, 0.1]);
    const hood = new THREE.SphereGeometry(0.4, 16, 12);
    hood.scale(1, 1.15, 1); hood.translate(0, 3.05, -0.05);
    tint(hood, [0.06, 0.04, 0.1]);
    const staff = new THREE.CylinderGeometry(0.04, 0.05, 3.9, 6);
    staff.translate(0.75, 1.95, 0.25);
    tint(staff, [0.3, 0.2, 0.12]);
    const mageGeo = mergeGeometries([robe.toNonIndexed(), hood.toNonIndexed(), staff.toNonIndexed()].map((g) => { g.deleteAttribute('uv'); return g; }));
    mageGeo.computeVertexNormals();
    this.mage = new THREE.Mesh(mageGeo, robeMat);
    this.mage.position.copy(CENTER).add(new THREE.Vector3(0, 0.3, 0));
    this.mage.scale.setScalar(1.3);
    this.scene.add(this.mage);
    this.orb = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 2.6, 1.0) }));
    this.orb.position.copy(this.mage.position).add(new THREE.Vector3(0.75 * 1.3, 4.05 * 1.3, 0.25 * 1.3));
    this.scene.add(this.orb);

    // pillar of light
    this.beamU = { uTime: this.U.uTime, uAmt: { value: 0 } };
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 3000, 32, 1, true), new THREE.ShaderMaterial({
      uniforms: this.beamU,
      vertexShader: /* glsl */ `varying vec2 vUv; varying vec3 vN, vW; void main(){ vUv = uv; vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `
        ${NOISE_GLSL}
        uniform float uTime, uAmt; varying vec2 vUv; varying vec3 vN, vW;
        void main(){
          vec3 V = normalize(cameraPosition - vW);
          float core = pow(abs(dot(normalize(vN), V)), 2.0);
          float n = snoise(vec3(vUv.x * 12.0, vW.y * 0.02 - uTime * 1.5, 0.0)) * 0.5 + 0.5;
          float fade = 1.0 - smoothstep(0.0, 900.0, vW.y);
          gl_FragColor = vec4(vec3(2.4, 1.7, 0.9) * (core * 0.6 + n * 0.25) * fade * uAmt, 1.0);
        }
      `,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    }));
    beam.position.copy(CENTER).add(new THREE.Vector3(0, 1500, 0));
    this.scene.add(beam);
    this.beam = beam;
  }

  buildWaterfalls() {
    const per = 4500, falls = 9;
    const n = per * falls;
    const origin = new Float32Array(n * 3), dir = new Float32Array(n * 3), r4 = new Float32Array(n * 4);
    const rnd = this.rnd;
    const chosen = this.islands.filter((i) => i.r > 18).slice(0, falls);
    let k = 0;
    chosen.forEach((isl) => {
      const a = rnd() * 6.28;
      const o = isl.m.position.clone().add(new THREE.Vector3(Math.cos(a) * isl.r * 0.95, isl.r * 0.02, Math.sin(a) * isl.r * 0.95));
      const d = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      for (let i = 0; i < per; i++) {
        origin.set([o.x + (rnd() - 0.5) * 3, o.y, o.z + (rnd() - 0.5) * 3], k * 3);
        dir.set([d.x, 0, d.z], k * 3);
        r4.set([rnd(), rnd(), rnd(), rnd()], k * 4);
        k++;
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(origin, 3));
    g.setAttribute('dir', new THREE.BufferAttribute(dir, 3));
    g.setAttribute('rnd', new THREE.BufferAttribute(r4, 4));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: this.U.uTime, uPR: this.ctx.uPR },
      vertexShader: /* glsl */ `
        attribute vec3 dir; attribute vec4 rnd; uniform float uTime, uPR; varying float vA;
        void main(){
          float t = fract(uTime * (0.12 + rnd.x * 0.04) + rnd.y);
          float T = t * 9.0;
          vec3 side = vec3(-dir.z, 0.0, dir.x);
          vec3 p = position + dir * (2.0 + T * 3.0) + side * (rnd.z - 0.5) * (2.0 + T * 1.6) - vec3(0.0, T * T * 2.4, 0.0);
          vec4 mv = viewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp((1.0 + t * 7.0) * uPR * 40.0 / -mv.z, 1.0, 80.0);
          vA = (1.0 - t) * smoothstep(0.0, 0.05, t) * (0.25 + rnd.w * 0.5);
        }
      `,
      fragmentShader: /* glsl */ `varying float vA; void main(){ vec2 c = gl_PointCoord - 0.5; float a = exp(-dot(c, c) * 14.0); gl_FragColor = vec4(vec3(1.1, 1.5, 1.9), a * vA); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const p = new THREE.Points(g, mat);
    p.frustumCulled = false;
    this.scene.add(p);
    this.particles += n;
  }

  buildCrystals() {
    const n = 420;
    const g = new THREE.OctahedronGeometry(1, 0);
    g.scale(0.5, 1.4, 0.5);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.crystals = new THREE.InstancedMesh(g, mat, n);
    this.crystalData = [];
    const rnd = this.rnd;
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const z = 420 - rnd() * 1250;
      const x = (rnd() * 2 - 1) * 260, y = -40 + rnd() * 160;
      if (Math.abs(x) < 15 && rnd() < 0.8) continue;
      const s = 0.4 + Math.pow(rnd(), 3) * 3;
      this.crystalData.push({ p: new THREE.Vector3(x, y, z), s, ph: rnd() * 6, sp: 0.2 + rnd() * 0.5 });
      const k = rnd();
      c.setRGB(k < 0.5 ? 0.4 : 2.0, k < 0.5 ? 2.0 : 0.6, 2.2);
      this.crystals.setColorAt(this.crystalData.length - 1, c);
    }
    this.crystals.count = this.crystalData.length;
    this.scene.add(this.crystals);
  }

  buildMotes() {
    const n = 24000;
    const pos = new Float32Array(n * 3), r4 = new Float32Array(n * 4);
    const rnd = this.rnd;
    for (let i = 0; i < n; i++) {
      pos.set([(rnd() * 2 - 1) * 180, -30 + rnd() * 140, 420 - rnd() * 1250], i * 3);
      r4.set([rnd(), rnd(), rnd(), rnd()], i * 4);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('rnd', new THREE.BufferAttribute(r4, 4));
    this.motesU = { uTime: this.U.uTime, uPR: this.ctx.uPR, uSpiral: { value: 0 }, uCenter: { value: CENTER } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.motesU,
      vertexShader: /* glsl */ `
        attribute vec4 rnd; uniform float uTime, uPR, uSpiral; uniform vec3 uCenter; varying float vA; varying vec3 vC;
        void main(){
          vec3 p = position + vec3(sin(uTime * 0.3 + rnd.x * 20.0), sin(uTime * 0.4 + rnd.y * 20.0), cos(uTime * 0.25 + rnd.z * 20.0)) * 2.0;
          // some motes get drawn into a vortex around the mage
          float a = rnd.x * 6.2832 + uTime * (0.6 + rnd.y);
          float rr = 3.0 + rnd.z * 22.0;
          vec3 sp = uCenter + vec3(cos(a) * rr, fract(rnd.w + uTime * 0.05) * 60.0, sin(a) * rr);
          p = mix(p, sp, uSpiral * step(0.55, rnd.w));
          vec4 mv = viewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(uPR * (0.6 + rnd.y) * 50.0 / -mv.z, 1.0, 16.0);
          vA = 0.4 + 0.6 * sin(uTime * 2.0 + rnd.x * 30.0);
          vC = rnd.z < 0.5 ? vec3(2.4, 1.7, 0.6) : vec3(0.6, 2.0, 2.4);
        }
      `,
      fragmentShader: /* glsl */ `varying float vA; varying vec3 vC; void main(){ vec2 c = gl_PointCoord - 0.5; float a = exp(-dot(c, c) * 25.0); gl_FragColor = vec4(vC, a * vA); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const p = new THREE.Points(g, mat);
    p.frustumCulled = false;
    this.scene.add(p);
    this.particles += n;
  }

  buildDeer() {
    const M = this.ctx.models;
    this.atlas = createGlyphAtlas(5);
    this.deerRig = new Rig(M.deer);
    this.deer = createRunePoints(M.deer, this.deerRig, 7000, this.atlas, { uTime: this.U.uTime, uPR: this.ctx.uPR, size: 1.05 });
    this.deer.scale.setScalar(3.4);
    this.scene.add(this.deer);
    this.particles += 9000;
  }

  update(u, time, dt) {
    const U = this.U;
    U.uTime.value = time;
    const cam = this.camera;

    // islands bob, trees follow
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3();
    for (const isl of this.islands) isl.m.position.y = isl.base + Math.sin(time * 0.3 + isl.phase) * 1.2;
    this.treeData.forEach(([x, y, z, sc, i], k) => {
      const isl = this.islands[i];
      m4.compose(p.set(x, y + (isl.m.position.y - isl.base), z), q.identity(), s.setScalar(sc));
      this.trees.setMatrixAt(k, m4);
    });
    this.trees.instanceMatrix.needsUpdate = true;
    this.crystalData.forEach((c, k) => {
      e.set(time * c.sp, time * c.sp * 0.7 + c.ph, 0);
      m4.compose(p.copy(c.p).setY(c.p.y + Math.sin(time * 0.5 + c.ph) * 1.5), q.setFromEuler(e), s.setScalar(c.s));
      this.crystals.setMatrixAt(k, m4);
    });
    this.crystals.instanceMatrix.needsUpdate = true;

    // ---- camera
    const mageHead = this.mage.position.clone().add(new THREE.Vector3(0, 3.5, 0));
    const look = new THREE.Vector3();
    const start = this.curve.getPointAt(1);
    const off = start.clone().sub(CENTER);
    const r0 = Math.hypot(off.x, off.z), a0 = Math.atan2(off.z, off.x);
    if (u < 645) {
      const st = this.trackS.at(u);
      cam.position.copy(this.curve.getPointAt(Math.min(st, 1)));
      look.copy(this.curve.getPointAt(Math.min(st + 0.06, 1))).add(new THREE.Vector3(0, -4, 0));
      look.lerp(mageHead, smoothstep(600, 640, u) * 0.8);
      look.lerp(this.deer.position.clone().add(new THREE.Vector3(0, 2, 0)), bump(u, 540, 548, 566, 576) * 0.45);
      cam.up.set(0, 1, 0);
    } else if (u < 690) {
      const k = easeInOut(range(u, 645, 690));
      const a = a0 + k * 1.9;
      const r = lerp(r0, 34, k);
      cam.position.set(CENTER.x + Math.cos(a) * r, lerp(start.y, 34, k), CENTER.z + Math.sin(a) * r);
      look.copy(mageHead).lerp(CENTER, k * 0.6);
      cam.up.set(0, 1, 0);
    } else {
      const k = easeInOut(range(u, 690, 712));
      const a = a0 + 1.9;
      const from = new THREE.Vector3(CENTER.x + Math.cos(a) * 34, 34, CENTER.z + Math.sin(a) * 34);
      cam.position.copy(from).lerp(CENTER.clone().add(new THREE.Vector3(0, 23 - range(u, 712, 730) * 3, 0)), k);
      look.copy(CENTER).lerp(CENTER.clone().add(new THREE.Vector3(0, 0, -0.01)), k);
      // as we get above the circle, roll so "up" on screen points to -Z (matches the circuit board)
      cam.up.set(0, 1, 0).lerp(new THREE.Vector3(0, 0, -1), k).normalize();
    }
    if (!this.lookInit) { this.look.copy(look); this.lookInit = true; }
    this.look.lerp(look, 1 - Math.exp(-dt * 4));
    cam.lookAt(u >= 690 ? look : this.look);
    if (u >= 690) this.look.copy(look);
    cam.fov = 58;
    cam.updateProjectionMatrix();

    // ---- the rune deer leads the way, then leaps into the circle
    const fwd = new THREE.Vector3(); cam.getWorldDirection(fwd);
    const lead = cam.position.clone().addScaledVector(fwd.clone().setY(0).normalize(), 20).add(new THREE.Vector3(0, -6, 0));
    const jump = smoothstep(632, 652, u);
    const dpos = lead.lerp(CENTER.clone().add(new THREE.Vector3(0, 1, 0)), jump);
    dpos.y += Math.sin(jump * Math.PI) * 10;
    this.deer.position.copy(dpos);
    const yaw = Math.atan2(fwd.x, fwd.z);
    this.deer.rotation.set(0, yaw, 0);
    this.deerRig.apply(DEER.run(time * 6 + u * 0.5));
    this.deer.material.uniforms.uAlpha.value = smoothstep(530, 540, u) * (1 - smoothstep(650, 660, u));
    this.deer.material.uniforms.uScatter.value = smoothstep(648, 660, u) * 0.8;
    this.deer.visible = u > 528 && u < 662;

    // ---- the spell
    this.circleU.uPower.value = 0.35 + 0.65 * smoothstep(640, 660, u) + bump(u, 652, 656, 664, 680) * 1.2;
    this.beamU.uAmt.value = bump(u, 655, 664, 684, 696);
    this.motesU.uSpiral.value = bump(u, 645, 665, 688, 700);
    this.mage.visible = this.orb.visible = true;
  }

  post(out) {
    out.rays = 0;
    out.exposure = 1.0;
  }
}

function tint(geo, c) {
  const n = geo.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set(c, i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
}

function weld(g) {
  const P = g.attributes.position.array;
  const map = new Map(), pos = [], idx = [];
  const src = g.index ? g.index.array : null;
  const count = src ? src.length : P.length / 3;
  for (let k = 0; k < count; k++) {
    const i = (src ? src[k] : k) * 3;
    const key = `${P[i].toFixed(3)},${P[i + 1].toFixed(3)},${P[i + 2].toFixed(3)}`;
    let id = map.get(key);
    if (id === undefined) { id = pos.length / 3; map.set(key, id); pos.push(P[i], P[i + 1], P[i + 2]); }
    idx.push(id);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setIndex(idx);
  return out;
}
