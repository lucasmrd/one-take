import * as THREE from 'three';
import { mulberry32, NOISE_GLSL, STARS_GLSL } from '../core/noise.js';
import { makeFogUniforms, FOG_PARS } from '../core/fog.js';
import { Rig, createHoloMesh } from '../animals/animal.js';
import { WHALE } from '../animals/specs.js';
import { lerp, smoothstep, range, bump, easeInOut, skyDome, SKY_VS } from '../core/util.js';

const BLOCK = 48;
const CLOUD_Y = 340;

export class CityWorld {
  constructor(ctx) {
    this.ctx = ctx;
    this.range = [700, 882];
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(58, 1, 0.3, 30000);
    this.rnd = mulberry32(4242);
    this.U = {
      ...makeFogUniforms({ color: [0.035, 0.03, 0.07], sun: [0.25, 0.08, 0.2], sunDir: [0, 0.2, -1], density: 0.0011 }),
      uTime: { value: 0 },
      uCity: { value: 0 },
      uRise: { value: 0 },
    };
    this.particles = 0;
    this.buildSky();
    this.buildGround();
    this.buildBuildings();
    this.buildCars();
    this.buildRain();
    this.buildBeams();
    this.buildClouds();
    this.buildWhale();
    this.look = new THREE.Vector3();
  }

  buildSky() {
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: this.U.uTime, uCity: this.U.uCity },
      vertexShader: SKY_VS,
      fragmentShader: /* glsl */ `
        uniform float uTime, uCity; varying vec3 vDir;
        ${NOISE_GLSL}
        ${STARS_GLSL}
        void main(){
          vec3 d = normalize(vDir);
          vec3 col = mix(vec3(0.35, 0.08, 0.25), vec3(0.01, 0.01, 0.035), smoothstep(-0.02, 0.35, d.y));
          col += stars(d) * smoothstep(0.2, 0.6, d.y) * 0.5;
          gl_FragColor = vec4(col * uCity, 1.0);
        }
      `,
      side: THREE.BackSide, depthWrite: false,
    });
    this.scene.add(skyDome(mat, 20000));
  }

  buildGround() {
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...this.U },
      vertexShader: /* glsl */ `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `
        ${NOISE_GLSL}
        ${FOG_PARS}
        uniform float uTime, uCity, uRise;
        varying vec3 vW;
        void main(){
          vec2 w = vW.xz;
          vec2 g = w / ${BLOCK.toFixed(1)};
          vec2 cell = floor(g);
          vec2 f = fract(g);
          vec2 sd2 = min(f, 1.0 - f) * ${BLOCK.toFixed(1)};
          float sd = min(sd2.x, sd2.y);
          float aa = fwidth(sd) + 0.02;
          float onX = step(sd2.y, sd2.x); // street running along x
          // --- PCB
          float trace = 1.0 - smoothstep(0.35, 0.35 + aa, sd);
          vec2 sg = w / 6.0; vec2 sc = floor(sg); vec2 sf = fract(sg);
          float hh = hash12(sc);
          float sub = hh < 0.33 ? abs(sf.y - 0.5) : (hh < 0.66 ? abs(sf.x - 0.5) : 1.0);
          float subT = (1.0 - smoothstep(0.035, 0.035 + fwidth(sub) + 0.01, sub)) * step(6.0, sd);
          float via = 1.0 - smoothstep(0.02, 0.05, abs(length(sf - 0.5) - 0.14));
          via *= step(0.86, hash12(sc + 3.0)) * step(6.0, sd);
          float along = onX > 0.5 ? w.x : w.y;
          float lane = onX > 0.5 ? cell.y : cell.x;
          float pulse = smoothstep(0.92, 1.0, fract(along / 40.0 - uTime * 0.7 + hash11(lane) * 7.0));
          vec3 board = vec3(0.008, 0.03, 0.02) + vec3(0.0, 0.02, 0.012) * hash12(floor(w / 2.0));
          vec3 gold = vec3(1.3, 0.85, 0.3);
          vec3 pcb = board + gold * (trace * 0.9 + subT * 0.55 + via * 0.8) + vec3(3.0, 2.0, 0.7) * pulse * trace;
          // --- city
          float street = 1.0 - smoothstep(4.0, 4.0 + aa, sd);
          float centre = 1.0 - smoothstep(0.15, 0.15 + aa, sd);
          float dash = step(0.5, fract(along / 6.0));
          float lanes = (1.0 - smoothstep(0.12, 0.12 + aa, abs(sd - 2.0))) * dash;
          vec3 neon = mix(vec3(0.2, 1.2, 2.2), vec3(2.2, 0.3, 1.5), step(0.5, hash11(lane * 1.7)));
          float carGlow = smoothstep(0.96, 1.0, fract(along / 70.0 - uTime * (0.4 + hash11(lane) * 0.6) * sign(hash11(lane + 3.0) - 0.5) + hash11(lane + 9.0))) * street;
          vec3 city = mix(vec3(0.02, 0.02, 0.03), vec3(0.008, 0.008, 0.012), street);
          city += neon * centre * 1.5 + vec3(0.6) * lanes * street * 0.4 + vec3(2.5, 1.6, 1.0) * carGlow * 1.5;
          vec3 col = mix(pcb, city, uCity);
          col = applyFog(col, vW);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    const g = new THREE.PlaneGeometry(9000, 9000, 1, 1);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, mat);
    m.position.set(0, 0, -1200);
    this.scene.add(m);
  }

  buildBuildings() {
    const rnd = this.rnd;
    const list = [];
    const R = 36;
    for (let j = -R; j <= R; j++) for (let i = -R; i <= R; i++) {
      const cx = (i + 0.5) * BLOCK, cz = (j + 0.5) * BLOCK - 1200;
      const d = Math.hypot(cx, cz + 1200);
      if (Math.hypot(i, j) > R) continue;
      const lots = rnd() < 0.35 ? 1 : rnd() < 0.6 ? 2 : 4;
      const inner = BLOCK - 10;
      const sub = lots === 1 ? [[0, 0, inner, inner]] : lots === 2 ? [[-inner / 4, 0, inner / 2 - 2, inner], [inner / 4, 0, inner / 2 - 2, inner]] : [[-inner / 4, -inner / 4, inner / 2 - 2, inner / 2 - 2], [inner / 4, -inner / 4, inner / 2 - 2, inner / 2 - 2], [-inner / 4, inner / 4, inner / 2 - 2, inner / 2 - 2], [inner / 4, inner / 4, inner / 2 - 2, inner / 2 - 2]];
      for (const [ox, oz, w, dd] of sub) {
        const x = cx + ox, z = cz + oz;
        if (Math.abs(x) < 34) continue; // the grand avenue
        const avenue = 1 - smoothstep(30, 140, Math.abs(x));
        const downtown = 1 - smoothstep(300, 1500, Math.hypot(x, z + 1100));
        let h = 14 + Math.pow(rnd(), 2.2) * 90 + downtown * Math.pow(rnd(), 1.5) * 230 + avenue * rnd() * 160;
        if (rnd() < 0.03) h += 200;
        const shrink = 0.75 + rnd() * 0.25;
        list.push([x, z, w * shrink, dd * shrink, h, rnd(), rnd(), d]);
      }
    }
    const n = list.length;
    const box = new THREE.BoxGeometry(1, 1, 1);
    box.translate(0, 0.5, 0);
    const g = new THREE.InstancedBufferGeometry();
    g.index = box.index;
    g.setAttribute('position', box.attributes.position);
    g.setAttribute('normal', box.attributes.normal);
    const A = new Float32Array(n * 4), B = new Float32Array(n * 4);
    list.forEach(([x, z, w, d, h, r1, r2, dist], k) => { A.set([x, z, w, d], k * 4); B.set([h, r1, r2, dist], k * 4); });
    g.setAttribute('iA', new THREE.InstancedBufferAttribute(A, 4));
    g.setAttribute('iB', new THREE.InstancedBufferAttribute(B, 4));
    g.instanceCount = n;
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...this.U },
      vertexShader: /* glsl */ `
        attribute vec4 iA, iB;
        uniform float uRise;
        varying vec3 vW, vN, vL;
        varying float vH, vR, vR2;
        void main(){
          float rise = smoothstep(0.0, 1.0, (uRise * 2300.0 - iB.w) / 420.0);
          float h = mix(0.6, iB.x, rise);
          vec3 p = vec3(iA.x + position.x * iA.z, position.y * h, iA.y + position.z * iA.w);
          vW = p; vN = normal; vL = position; vH = h; vR = iB.y; vR2 = iB.z;
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        ${NOISE_GLSL}
        ${FOG_PARS}
        uniform float uTime, uCity;
        varying vec3 vW, vN, vL;
        varying float vH, vR, vR2;
        void main(){
          vec3 N = normalize(vN);
          vec3 V = normalize(cameraPosition - vW);
          vec3 neon = vR2 < 0.4 ? vec3(0.2, 1.4, 2.6) : (vR2 < 0.75 ? vec3(2.6, 0.3, 1.7) : vec3(2.6, 1.3, 0.3));
          vec3 col;
          float edge = max(abs(vL.x), abs(vL.z));
          if (N.y > 0.5) {
            // roof / chip
            col = vec3(0.012, 0.012, 0.016);
            float rimL = smoothstep(0.46, 0.49, edge);
            float chip = 1.0 - smoothstep(2.0, 6.0, vH);
            float along = abs(vL.x) > abs(vL.z) ? vL.z : vL.x;
            float pins = step(0.5, fract(along * 14.0)) * smoothstep(0.44, 0.47, edge) * (1.0 - smoothstep(0.495, 0.5, edge));
            col += vec3(1.2, 1.0, 0.7) * pins * chip * 0.6;
            col += neon * rimL * step(0.55, vR) * (1.0 - chip) * 0.7;
            col += vec3(0.05) * (1.0 - smoothstep(0.0, 0.1, abs(edge - 0.3))) * chip;
          } else {
            vec2 t = vec2(-N.z, N.x);
            vec2 fuv = vec2(dot(vW.xz, t), vW.y);
            vec2 wc = floor(fuv / vec2(2.2, 3.4));
            vec2 wf = fract(fuv / vec2(2.2, 3.4));
            float win = step(0.22, wf.x) * step(wf.x, 0.78) * step(0.3, wf.y) * step(wf.y, 0.72);
            float lit = step(0.74 - vR2 * 0.18, hash13(vec3(wc, floor(vR * 977.0))));
            float flick = step(0.995, hash13(vec3(wc, floor(uTime * 3.0)))) ;
            vec3 wcol = mix(vec3(1.4, 0.95, 0.55), vec3(0.6, 0.85, 1.5), step(0.62, hash13(vec3(wc.y, vR * 51.0, 2.0))));
            float fres = pow(1.0 - max(dot(N, V), 0.0), 4.0);
            col = vec3(0.014, 0.016, 0.03) + vec3(0.25, 0.08, 0.3) * fres * 0.4;
            col += wcol * win * lit * (1.0 - flick) * 0.75 * step(2.5, vW.y) * smoothstep(4.0, 12.0, vH);
            // corner neon strips and crown
            float side = abs(vL.x) > 0.499 ? abs(vL.z) : abs(vL.x);
            float corner = smoothstep(0.47, 0.495, side);
            col += neon * corner * step(0.72, vR) * 1.3;
            float crown = smoothstep(0.965, 0.985, vL.y) * step(0.45, vR) * step(30.0, vH);
            col += neon * crown * 1.4;
            float bandY = step(0.88, vR) * (1.0 - smoothstep(0.0, 0.8, abs(fract(vW.y / 22.0) - 0.5) * 22.0 - 0.2));
            col += neon * bandY * 1.2;
          }
          col = applyFog(col, vW);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    const mesh = new THREE.Mesh(g, mat);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    this.buildingCount = n;
    this.towers = list.filter((b) => b[4] > 180).slice(0, 10);
  }

  buildCars() {
    const n = 3200;
    const box = new THREE.BoxGeometry(1.1, 0.45, 2.8);
    const g = new THREE.InstancedBufferGeometry();
    g.index = box.index;
    g.setAttribute('position', box.attributes.position);
    const L = new Float32Array(n * 4), C = new Float32Array(n * 3);
    const rnd = this.rnd;
    const palette = [[2, 2, 2.2], [2.4, 0.2, 0.1], [0.25, 1.6, 2.4], [2.2, 1.0, 0.2], [2.0, 0.3, 1.6]];
    for (let i = 0; i < n; i++) {
      const axis = rnd() < 0.35 ? 1 : 0;              // 0: along z (avenue), 1: along x
      const laneIdx = Math.round((rnd() * 2 - 1) * 12);
      const coord = axis === 0 ? (rnd() < 0.55 ? (rnd() < 0.5 ? -1 : 1) * (14 + rnd() * 14) : laneIdx * BLOCK + (rnd() - 0.5) * 6) : laneIdx * BLOCK - 1200 + (rnd() - 0.5) * 6;
      const h = 30 + rnd() * 160;
      const speed = (rnd() < 0.5 ? -1 : 1) * (40 + rnd() * 70);
      L.set([axis, coord, h, speed], i * 4);
      C.set(palette[Math.floor(rnd() * palette.length)], i * 3);
    }
    g.setAttribute('iL', new THREE.InstancedBufferAttribute(L, 4));
    g.setAttribute('iC', new THREE.InstancedBufferAttribute(C, 3));
    const off = new Float32Array(n); for (let i = 0; i < n; i++) off[i] = rnd() * 3000;
    g.setAttribute('iO', new THREE.InstancedBufferAttribute(off, 1));
    g.instanceCount = n;
    this.carU = { uTime: this.U.uTime, uCam: { value: new THREE.Vector3() }, uAmt: { value: 0 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.carU,
      vertexShader: /* glsl */ `
        attribute vec4 iL; attribute vec3 iC; attribute float iO;
        uniform float uTime, uAmt; uniform vec3 uCam;
        varying vec3 vC;
        void main(){
          float axis = iL.x;
          float camAlong = axis < 0.5 ? uCam.z : uCam.x;
          float along = camAlong + mod(iO + uTime * iL.w - camAlong, 3000.0) - 1500.0;
          vec3 lp = position;
          lp.z *= 1.0 + abs(iL.w) * 0.02;
          vec3 p = axis < 0.5 ? vec3(iL.y + lp.x, iL.z + lp.y, along + lp.z) : vec3(along + lp.z, iL.z + lp.y, iL.y + lp.x);
          p.y -= (1.0 - uAmt) * 400.0;
          vC = iC * uAmt;
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `varying vec3 vC; void main(){ gl_FragColor = vec4(vC, 1.0); }`,
    });
    const m = new THREE.Mesh(g, mat);
    m.frustumCulled = false;
    this.scene.add(m);
    this.particles += n;
  }

  buildRain() {
    const n = 26000;
    const pos = new Float32Array(n * 6), seed = new Float32Array(n * 6), end = new Float32Array(n * 2);
    const rnd = this.rnd;
    for (let i = 0; i < n; i++) {
      const s = [rnd(), rnd(), rnd()];
      seed.set([...s, ...s], i * 6);
      end[i * 2] = 0; end[i * 2 + 1] = 1;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('seed', new THREE.BufferAttribute(seed, 3));
    g.setAttribute('end', new THREE.BufferAttribute(end, 1));
    this.rainU = { uTime: this.U.uTime, uCam: this.carU.uCam, uAmt: { value: 0 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.rainU,
      vertexShader: /* glsl */ `
        attribute vec3 seed; attribute float end;
        uniform float uTime, uAmt; uniform vec3 uCam;
        varying float vA;
        void main(){
          vec3 box = vec3(90.0, 70.0, 90.0);
          vec3 p = seed * box - vec3(0.0, uTime * (55.0 + seed.x * 10.0), 0.0);
          p = uCam + mod(p - uCam, box) - box * 0.5;
          p += vec3(0.25, 1.0, 0.1) * end * 1.6;
          vA = uAmt * (0.04 + end * 0.1);
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `varying float vA; void main(){ gl_FragColor = vec4(vec3(0.7, 0.8, 1.2), vA); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const m = new THREE.LineSegments(g, mat);
    m.frustumCulled = false;
    this.scene.add(m);
    this.particles += n;
  }

  buildBeams() {
    this.beams = [];
    this.beamU = { uTime: this.U.uTime, uAmt: { value: 0 } };
    const geo = new THREE.CylinderGeometry(0.5, 26, 900, 24, 1, true);
    geo.translate(0, 450, 0);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.beamU,
      vertexShader: /* glsl */ `varying float vY; varying vec3 vN, vW; void main(){ vY = position.y / 900.0; vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `
        uniform float uAmt; varying float vY; varying vec3 vN, vW;
        void main(){ vec3 V = normalize(cameraPosition - vW); float f = pow(abs(dot(normalize(vN), V)), 1.5); gl_FragColor = vec4(vec3(0.6, 0.7, 1.2) * f * (1.0 - vY) * 0.22 * uAmt, 1.0); }
      `,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    this.towers.forEach((t, i) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(t[0], t[4], t[1]);
      this.scene.add(m);
      this.beams.push({ m, ph: i * 1.3 });
    });
  }

  buildClouds() {
    this.cloudU = { uTime: this.U.uTime, uAmt: { value: 1 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.cloudU,
      vertexShader: /* glsl */ `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `
        ${NOISE_GLSL}
        uniform float uTime, uAmt; varying vec3 vW;
        void main(){
          vec2 p = vW.xz * 0.0016 + vec2(uTime * 0.004, 0.0);
          float d = fbm3(vec3(p, uTime * 0.01));
          float a = smoothstep(-0.15, 0.45, d);
          float below = step(vW.y, cameraPosition.y) * 0.0 + step(cameraPosition.y, vW.y);
          vec3 lit = mix(vec3(0.35, 0.18, 0.32), vec3(0.75, 0.55, 0.8), smoothstep(0.0, 0.6, d));
          float dist = length(vW - cameraPosition);
          float fade = 1.0 - smoothstep(3000.0, 9000.0, dist);
          gl_FragColor = vec4(lit * (0.6 + 0.4 * below), a * 0.9 * fade * uAmt);
        }
      `,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    const g = new THREE.PlaneGeometry(24000, 24000, 1, 1);
    g.rotateX(-Math.PI / 2);
    for (let k = 0; k < 3; k++) {
      const m = new THREE.Mesh(g, mat);
      m.position.set(0, CLOUD_Y + k * 14, -1600);
      this.scene.add(m);
    }
  }

  buildWhale() {
    this.whaleRig = new Rig(this.ctx.models.whale);
    this.whale = createHoloMesh(this.ctx.models.whale, this.whaleRig, { uTime: this.U.uTime });
    this.whale.scale.setScalar(13);
    this.scene.add(this.whale);
  }

  update(u, time, dt) {
    const U = this.U;
    U.uTime.value = time;
    const cam = this.camera;
    U.uRise.value = range(u, 734, 778);
    U.uCity.value = smoothstep(742, 772, u);

    const look = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    if (u < 760) {
      const k = easeInOut(range(u, 722, 760));
      const h = 23 * Math.exp(k * Math.log(430 / 23));
      cam.position.set(0, h, 0);
      look.set(0, 0, -0.01);
      up.set(0, 0, -1);
    } else if (u < 792) {
      const k = easeInOut(range(u, 760, 792));
      cam.position.set(0, lerp(430, 150, k), lerp(0, -520, k));
      look.set(0, 0, -0.01).lerp(new THREE.Vector3(0, 90, -1500), k);
      up.set(0, 0, -1).lerp(new THREE.Vector3(0, 1, 0), smoothstep(0.0, 0.6, k)).normalize();
    } else if (u < 852) {
      const k = range(u, 792, 852);
      const z = lerp(-520, -1950, k);
      const h = 150 - Math.sin(k * Math.PI) * 85;
      cam.position.set(Math.sin(k * 6.0) * 9, h, z);
      look.set(Math.sin((k + 0.08) * 6.0) * 9, h - 18, z - 300);
    } else {
      const k = easeInOut(range(u, 852, 880));
      const z = lerp(-1950, -2150, k);
      cam.position.set(0, lerp(150, CLOUD_Y + 120, k), z);
      look.set(0, lerp(132, CLOUD_Y + 900, k), z - lerp(300, 120, k));
    }
    // the hologram whale crosses the avenue
    const wk = range(u, 794, 846);
    // crosses the avenue diagonally so we read its silhouette
    this.whale.position.set(lerp(-110, 90, wk), cam.position.y + lerp(34, 20, wk), cam.position.z - lerp(420, 60, wk));
    this.whale.rotation.set(-0.05, Math.atan2(200, 360) + 0.1 * Math.sin(time * 0.5), 0);
    this.whaleRig.apply(WHALE.swim(time * 1.3, 1));
    this.whale.material.uniforms.uAlpha.value = bump(u, 796, 802, 840, 846);
    this.whale.visible = u > 794 && u < 848;
    look.lerp(this.whale.position, bump(u, 806, 814, 828, 838) * 0.4);

    if (!this.lookInit || u < 792) { this.look.copy(look); this.lookInit = true; }
    this.look.lerp(look, 1 - Math.exp(-dt * 4));
    cam.up.copy(up);
    cam.lookAt(this.look);
    cam.fov = 58 + bump(u, 800, 812, 840, 850) * 8;
    cam.updateProjectionMatrix();

    this.carU.uCam.value.copy(cam.position);
    this.carU.uAmt.value = smoothstep(768, 785, u);
    this.rainU.uAmt.value = smoothstep(775, 795, u) * (1 - smoothstep(858, 866, u));
    this.beamU.uAmt.value = smoothstep(770, 790, u);
    this.beams.forEach(({ m, ph }) => { m.rotation.set(Math.sin(time * 0.3 + ph) * 0.35, 0, Math.cos(time * 0.23 + ph) * 0.35); });

    // inside the clouds everything goes soft
    const inCloud = bump(cam.position.y, CLOUD_Y - 40, CLOUD_Y, CLOUD_Y + 30, CLOUD_Y + 70);
    U.uFogDensity.value = lerp(0.0011, 0.02, inCloud);
    U.uFogColor.value.setRGB(lerp(0.035, 0.6, inCloud), lerp(0.03, 0.45, inCloud), lerp(0.07, 0.65, inCloud));
    this.inCloud = inCloud;
  }

  post(out) {
    out.rays = 0;
    out.exposure = 1 + (this.inCloud || 0) * 0.3;
  }
}
