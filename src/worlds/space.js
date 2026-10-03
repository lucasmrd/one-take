import * as THREE from 'three';
import { Simplex, mulberry32, NOISE_GLSL, STARS_GLSL } from '../core/noise.js';
import { Rig, createSpiritPoints } from '../animals/animal.js';
import { WOLF, WHALE } from '../animals/specs.js';
import { lerp, smoothstep, range, bump, Track, toScreen, skyDome, SKY_VS } from '../core/util.js';

const BH = new THREE.Vector3(0, 0, -3400);
const RS = 36;

export const SPACE_SKY_GLSL = /* glsl */ `
vec3 nebula(vec3 d){
  vec3 p = d * 2.2;
  vec3 w = vec3(fbm3lo(p + 1.3), fbm3lo(p + 7.9), fbm3lo(p + 4.4));
  float n = fbm3(p + w * 1.6);
  float m = fbm3lo(p * 0.8 + w + 11.0);
  vec3 c1 = vec3(0.45, 0.08, 0.38);
  vec3 c2 = vec3(0.05, 0.32, 0.5);
  vec3 c3 = vec3(0.9, 0.42, 0.18);
  vec3 col = mix(c1, c2, smoothstep(-0.3, 0.5, m));
  col = mix(col, c3, smoothstep(0.35, 0.8, n) * 0.6);
  float dens = smoothstep(-0.15, 0.65, n) * smoothstep(-0.4, 0.3, m);
  float dark = smoothstep(0.1, 0.5, fbm3lo(p * 3.0 + w * 2.0));
  return col * dens * (1.0 - dark * 0.7) * 0.9;
}
vec3 spaceSky(vec3 d, float neb){
  vec3 col = vec3(0.004, 0.004, 0.009);
  vec3 bn = normalize(vec3(0.35, 1.0, 0.15));
  float band = exp(-pow(dot(d, bn), 2.0) * 10.0);
  col += vec3(0.32, 0.28, 0.4) * band * (0.35 + 0.65 * (fbm3lo(d * 5.0) * 0.5 + 0.5)) * 0.35;
  col += nebula(d) * neb;
  col += stars(d) * (1.0 + band);
  return col;
}
`;

export class SpaceWorld {
  constructor(ctx) {
    this.ctx = ctx;
    this.range = [276, 532];
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.5, 100000);
    this.U = { uTime: { value: 0 }, uPR: ctx.uPR };
    this.rnd = mulberry32(2024);
    this.buildSky();
    this.buildDust();
    this.buildConstellations();
    this.buildAsteroids();
    this.trackZ = new Track([[276, 120], [290, 40], [330, -260], [380, -700], [440, -1520], [480, -2520], [500, -3050], [512, -3290], [532, -3352]]);
    this.look = new THREE.Vector3(0, 0, -1000);
  }

  buildSky() {
    this.skyU = {
      uTime: this.U.uTime,
      uBH: { value: BH },
      uRs: { value: RS },
      uDiskN: { value: new THREE.Vector3(0.1, 1, 0.22).normalize() },
      uNeb: { value: 1 },
      uDiskGain: { value: 1 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.skyU,
      vertexShader: SKY_VS,
      fragmentShader: /* glsl */ `
        uniform vec3 uBH, uDiskN; uniform float uRs, uTime, uNeb, uDiskGain;
        varying vec3 vDir;
        ${NOISE_GLSL}
        ${STARS_GLSL}
        ${SPACE_SKY_GLSL}
        vec4 disk(vec3 p, vec3 rd){
          float r = length(p);
          vec3 N = uDiskN;
          vec3 t1 = normalize(cross(N, vec3(0.0, 0.0, 1.0)));
          vec3 t2 = cross(N, t1);
          float ang = atan(dot(p, t2), dot(p, t1));
          float a2 = ang + uTime * 2.2 / pow(r, 1.5);
          vec2 cs = vec2(cos(a2), sin(a2));
          float n = fbm3lo(vec3(cs * r * 0.8, r * 0.5)) * 0.5 + 0.5;
          float st = snoise(vec3(cs * 2.0, r * 2.4)) * 0.5 + 0.5;
          float dens = smoothstep(2.3, 3.1, r) * smoothstep(15.0, 6.5, r) * (0.3 + 0.8 * n) * (0.6 + 0.6 * st);
          float temp = pow(3.0 / r, 1.25);
          vec3 col = mix(vec3(1.3, 0.3, 0.06), vec3(1.6, 0.95, 0.5), smoothstep(0.25, 0.7, temp));
          col = mix(col, vec3(1.4, 1.4, 1.65), smoothstep(0.78, 1.1, temp));
          vec3 vdir = normalize(cross(N, p));
          float dop = 1.0 + 0.7 * dot(vdir, -rd) * sqrt(3.0 / r);
          col *= clamp(pow(max(dop, 0.15), 2.4), 0.05, 4.0) * temp * 0.9 * uDiskGain;
          return vec4(col, clamp(dens, 0.0, 1.0) * 0.93);
        }
        void main(){
          vec3 rd = normalize(vDir);
          vec3 ro = (cameraPosition - uBH) / uRs;
          float R = 42.0;
          float tca = -dot(ro, rd);
          float b2 = dot(ro, ro) - tca * tca;
          bool outside = dot(ro, ro) > R * R;
          if (b2 > R * R || (outside && tca < 0.0)) { gl_FragColor = vec4(spaceSky(rd, uNeb), 1.0); return; }
          vec3 pos = ro;
          if (outside) pos = ro + rd * (tca - sqrt(R * R - b2));
          vec3 dir = rd;
          vec3 h = cross(pos, dir);
          float h2 = dot(h, h);
          vec3 acc = vec3(0.0);
          float trans = 1.0;
          bool captured = false;
          float minR = 1e9;
          for (int i = 0; i < 240; i++) {
            float r = length(pos);
            minR = min(minR, r);
            if (r < 1.0) { captured = true; break; }
            if (r > R + 2.0 && dot(pos, dir) > 0.0) break;
            float dt = clamp(0.07 * r, 0.015, 2.5);
            vec3 prev = pos;
            dir += -1.5 * h2 * pos / pow(r, 5.0) * dt;
            pos += dir * dt;
            float s0 = dot(prev, uDiskN), s1 = dot(pos, uDiskN);
            if (s0 * s1 < 0.0) {
              vec3 cp = mix(prev, pos, s0 / (s0 - s1));
              float cr = length(cp);
              if (cr > 2.2 && cr < 15.0) {
                vec4 dc = disk(cp, normalize(dir));
                acc += trans * dc.rgb * dc.a;
                trans *= 1.0 - dc.a;
              }
            }
            if (trans < 0.02) break;
          }
          vec3 bg = captured ? vec3(0.0) : spaceSky(normalize(dir), uNeb);
          vec3 col = acc + trans * bg;
          col += vec3(1.2, 0.8, 0.5) * exp(-pow((minR - 1.55) / 0.05, 2.0)) * 0.35 * trans * (captured ? 0.0 : 1.0);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
      side: THREE.BackSide,
      depthWrite: false,
    });
    this.sky = skyDome(mat, 5000);
    this.scene.add(this.sky);
  }

  buildDust() {
    const n = 42000;
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), r4 = new Float32Array(n * 4);
    const rnd = this.rnd;
    const palette = [[0.9, 0.25, 0.8], [0.2, 0.7, 1.0], [1.0, 0.55, 0.25], [0.7, 0.7, 1.0]];
    for (let i = 0; i < n; i++) {
      const z = 150 - rnd() * 3200;
      const a = rnd() * Math.PI * 2;
      const big = rnd() < 0.18;
      const rr = big ? 40 + rnd() * 400 : 6 + Math.pow(rnd(), 0.6) * 260;
      pos.set([Math.cos(a) * rr, Math.sin(a) * rr * 0.7, z], i * 3);
      const c = palette[Math.floor(rnd() * palette.length)];
      col.set(c, i * 3);
      r4.set([rnd(), rnd(), big ? 1 : 0, rnd()], i * 4);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('rnd', new THREE.BufferAttribute(r4, 4));
    this.dustMat = new THREE.ShaderMaterial({
      uniforms: { uTime: this.U.uTime, uPR: this.ctx.uPR, uBH: { value: BH }, uAlpha: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute vec3 color; attribute vec4 rnd;
        uniform float uTime, uPR, uAlpha; uniform vec3 uBH;
        varying vec3 vC; varying float vA, vBig;
        void main(){
          vec3 p = position + vec3(sin(uTime * 0.05 + rnd.x * 9.0), cos(uTime * 0.04 + rnd.y * 9.0), 0.0) * 3.0;
          vec4 mv = viewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          float d = -mv.z;
          vBig = rnd.z;
          float size = rnd.z > 0.5 ? (40.0 + rnd.w * 80.0) : (0.6 + rnd.w * 1.2);
          gl_PointSize = clamp(size * uPR * 90.0 / max(d, 1.0), 0.0, 220.0);
          float nearFade = smoothstep(2.0, 25.0, d);
          float bhFade = smoothstep(500.0, 1100.0, length(p - uBH));
          vA = uAlpha * nearFade * bhFade * (rnd.z > 0.5 ? 0.05 : (0.4 + 0.6 * rnd.y));
          vC = rnd.z > 0.5 ? color : mix(vec3(1.0), color, 0.5) * 2.0;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vC; varying float vA, vBig;
        void main(){
          vec2 c = gl_PointCoord - 0.5; float d2 = dot(c, c);
          float a = vBig > 0.5 ? exp(-d2 * 9.0) : exp(-d2 * 40.0);
          gl_FragColor = vec4(vC, a * vA);
        }
      `,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const p = new THREE.Points(g, this.dustMat);
    p.frustumCulled = false;
    this.scene.add(p);
    this.particles = n;
  }

  // posed surface samples, spread out by farthest-point sampling
  constellationPoints(model, pose, count, seed) {
    const rig = new Rig(model);
    rig.apply(pose);
    const s = model.sample(4000, seed);
    const cand = [];
    const v = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3();
    for (let i = 0; i < 4000; i++) {
      v.fromArray(s.pos, i * 3);
      const w = s.sw[i];
      a.copy(v).applyMatrix4(rig.world[s.si[i * 2]]);
      b.copy(v).applyMatrix4(rig.world[s.si[i * 2 + 1]]);
      cand.push(a.multiplyScalar(w).add(b.multiplyScalar(1 - w)).clone());
    }
    const picked = [cand[0]];
    const dmin = cand.map((c) => c.distanceToSquared(cand[0]));
    while (picked.length < count) {
      let bi = 0;
      for (let i = 1; i < cand.length; i++) if (dmin[i] > dmin[bi]) bi = i;
      picked.push(cand[bi]);
      for (let i = 0; i < cand.length; i++) dmin[i] = Math.min(dmin[i], cand[i].distanceToSquared(cand[bi]));
    }
    // edges to the two nearest neighbours
    const edges = new Set();
    picked.forEach((p, i) => {
      const order = picked.map((q, j) => [p.distanceToSquared(q), j]).filter(([, j]) => j !== i).sort((x, y) => x[0] - y[0]);
      for (let k = 0; k < 2; k++) {
        const j = order[k][1];
        edges.add(i < j ? `${i}-${j}` : `${j}-${i}`);
      }
    });
    return { points: picked, edges: [...edges].map((e) => e.split('-').map(Number)) };
  }

  makeConstellation(model, pose, count, seed, color) {
    const { points, edges } = this.constellationPoints(model, pose, count, seed);
    const group = new THREE.Group();
    const sp = new Float32Array(points.length * 3), sr = new Float32Array(points.length);
    points.forEach((p, i) => { sp.set([p.x, p.y, p.z], i * 3); sr[i] = (p.z - Math.min(...points.map((q) => q.z))) ; });
    const zs = points.map((p) => p.z), z0 = Math.min(...zs), z1 = Math.max(...zs);
    points.forEach((p, i) => { sr[i] = 1 - (p.z - z0) / (z1 - z0); });
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    sg.setAttribute('order', new THREE.BufferAttribute(sr, 1));
    const starMat = new THREE.ShaderMaterial({
      uniforms: { uPR: this.ctx.uPR, uDraw: { value: 0 }, uAlpha: { value: 1 }, uTime: this.U.uTime, uColor: { value: new THREE.Color(...color) } },
      vertexShader: /* glsl */ `
        attribute float order; uniform float uPR, uDraw, uAlpha, uTime; varying float vA;
        void main(){
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          float on = smoothstep(order * 0.8 - 0.05, order * 0.8 + 0.1, uDraw);
          vA = on * uAlpha * (0.8 + 0.2 * sin(uTime * 3.0 + order * 40.0));
          gl_PointSize = 34.0 * uPR * (0.6 + 0.4 * on);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; varying float vA;
        void main(){
          vec2 c = gl_PointCoord - 0.5;
          float core = exp(-dot(c, c) * 160.0);
          float spike = exp(-abs(c.x) * 60.0) * exp(-abs(c.y) * 6.0) + exp(-abs(c.y) * 60.0) * exp(-abs(c.x) * 6.0);
          float halo = exp(-dot(c, c) * 25.0) * 0.25;
          gl_FragColor = vec4(uColor * 1.6, (core * 2.0 + spike * 0.6 + halo) * vA);
        }
      `,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const stars = new THREE.Points(sg, starMat);
    stars.frustumCulled = false;
    group.add(stars);

    const lp = new Float32Array(edges.length * 6), lo = new Float32Array(edges.length * 2), le = new Float32Array(edges.length * 2);
    edges.forEach(([i, j], k) => {
      lp.set([points[i].x, points[i].y, points[i].z, points[j].x, points[j].y, points[j].z], k * 6);
      const o = Math.max(sr[i], sr[j]);
      lo[k * 2] = o; lo[k * 2 + 1] = o;
      le[k * 2] = 0; le[k * 2 + 1] = 1;
    });
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(lp, 3));
    lg.setAttribute('order', new THREE.BufferAttribute(lo, 1));
    lg.setAttribute('end', new THREE.BufferAttribute(le, 1));
    const lineMat = new THREE.ShaderMaterial({
      uniforms: { uDraw: starMat.uniforms.uDraw, uAlpha: starMat.uniforms.uAlpha, uColor: starMat.uniforms.uColor },
      vertexShader: /* glsl */ `
        attribute float order; attribute float end; uniform float uDraw; varying float vOn, vEnd;
        void main(){ vOn = (uDraw - order * 0.8 - 0.08) / 0.12; vEnd = end; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform float uAlpha; varying float vOn, vEnd;
        void main(){ float a = step(vEnd, vOn) * uAlpha * 0.55; gl_FragColor = vec4(uColor * 1.2, a); }
      `,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const lines = new THREE.LineSegments(lg, lineMat);
    lines.frustumCulled = false;
    group.add(lines);
    group.userData.U = starMat.uniforms;
    return group;
  }

  buildConstellations() {
    const M = this.ctx.models;
    this.cWhale = this.makeConstellation(M.whale, WHALE.swim(0, 0), 64, 3, [0.7, 0.85, 1.4]);
    this.cWhale.position.set(-230, 110, -700);
    this.cWhale.scale.setScalar(19);
    this.cWhale.rotation.set(0.05, 2.06 + Math.PI, 0.05);
    this.scene.add(this.cWhale);

    this.cWolf = this.makeConstellation(M.wolf, WOLF.howl(1, 1, 0, 0), 46, 5, [1.0, 0.9, 1.4]);
    this.cWolf.position.set(230, -40, -720);
    this.cWolf.scale.setScalar(110);
    this.cWolf.rotation.set(0, 1.02 + Math.PI, 0);
    this.scene.add(this.cWolf);

    this.whaleRig = new Rig(M.whale);
    this.whale = createSpiritPoints(M.whale, this.whaleRig, 90000, { uTime: this.U.uTime, uPR: this.ctx.uPR, size: 1.5, color: [0.45, 0.9, 2.6], color2: [2.0, 1.5, 2.8], seed: 13, flow: 0.4 });
    this.whale.scale.setScalar(15);
    this.scene.add(this.whale);
    this.particles += 90000;
  }

  buildAsteroids() {
    const geos = [];
    for (let k = 0; k < 4; k++) {
      let g = new THREE.IcosahedronGeometry(1, 3);
      g.deleteAttribute('uv'); g.deleteAttribute('normal');
      g = mergeVerts(g);
      const S = new Simplex(100 + k);
      const P = g.attributes.position.array;
      const stretch = [1 + k * 0.25, 0.8 + (k % 2) * 0.3, 1];
      for (let i = 0; i < P.length; i += 3) {
        const x = P[i], y = P[i + 1], z = P[i + 2];
        let n = 1 + S.noise3(x * 1.2, y * 1.2, z * 1.2) * 0.35 + S.noise3(x * 3.5, y * 3.5, z * 3.5) * 0.1;
        // craters
        const c = S.noise3(x * 2.2 + 9, y * 2.2, z * 2.2);
        if (c > 0.45) n -= (c - 0.45) * 0.5;
        P[i] = x * n * stretch[0]; P[i + 1] = y * n * stretch[1]; P[i + 2] = z * n * stretch[2];
      }
      g.computeVertexNormals();
      geos.push(g);
    }
    const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.2, 0.18, 0.17), roughness: 0.96, metalness: 0.02, flatShading: false });
    this.rocks = [];
    const per = 380;
    const rnd = this.rnd;
    for (const g of geos) {
      const mesh = new THREE.InstancedMesh(g, mat, per);
      const data = [];
      for (let i = 0; i < per; i++) {
        const z = -1150 - rnd() * 1100;
        let x, y;
        do { x = (rnd() * 2 - 1) * 480; y = (rnd() * 2 - 1) * 230; } while (Math.hypot(x - this.pathX(z), (y - this.pathY(z)) * 1.4) < 22);
        const s = 0.6 + Math.pow(rnd(), 5) * 38;
        data.push({ p: new THREE.Vector3(x, y, z), s, r: new THREE.Euler(rnd() * 6, rnd() * 6, rnd() * 6), w: new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).multiplyScalar(0.4 / (1 + s * 0.1)) });
      }
      this.scene.add(mesh);
      this.rocks.push({ mesh, data });
    }
    const key = new THREE.DirectionalLight(new THREE.Color(1.7, 0.95, 0.55), 3.2);
    key.position.copy(BH).add(new THREE.Vector3(0, 200, 0));
    key.target.position.set(0, 0, -1500);
    const fill = new THREE.DirectionalLight(new THREE.Color(0.45, 0.6, 1.2), 0.9);
    fill.position.set(400, 300, 200);
    this.scene.add(key, key.target, fill, new THREE.AmbientLight(new THREE.Color(0.25, 0.2, 0.35), 0.35));
  }

  pathX(z) { return Math.sin(z * 0.0021) * 45 * (1 - smoothstep(-2600, -3200, z)); }
  pathY(z) { return Math.cos(z * 0.0017) * 18 * (1 - smoothstep(-2600, -3200, z)) + smoothstep(-2400, -3300, z) * 0.0; }

  update(u, time, dt) {
    this.U.uTime.value = time;
    const cam = this.camera;
    const z = this.trackZ.at(u);
    const near = smoothstep(-2700, -3350, z);
    const dist = BH.z - z;
    cam.position.set(this.pathX(z), this.pathY(z) + near * Math.abs(dist) * 0.09, z);

    // where to look
    const look = new THREE.Vector3(this.pathX(z - 300), this.pathY(z - 300), z - 300);
    const wPos = this.cWhale.position.clone().add(new THREE.Vector3(0, 0, 0));
    look.lerp(wPos, bump(u, 322, 332, 352, 362) * 0.85);
    const wolfC = this.cWolf.position.clone().add(new THREE.Vector3(0, 60, 0));
    look.lerp(wolfC, bump(u, 352, 360, 372, 380) * 0.85);
    look.lerp(this.whale.position, bump(u, 366, 372, 386, 394) * 0.6);
    look.lerp(BH, smoothstep(430, 470, u));
    if (!this.lookInit) { this.look.copy(look); this.lookInit = true; }
    this.look.lerp(look, 1 - Math.exp(-dt * 3));
    cam.up.set(Math.sin(u * 0.01) * 0.12 * (1 - near), 1, 0).normalize();
    cam.lookAt(this.look);
    cam.fov = lerp(60, 72, smoothstep(470, 520, u));
    cam.updateProjectionMatrix();

    // constellations draw themselves, then the whale wakes up
    const cw = this.cWhale.userData.U;
    cw.uDraw.value = range(u, 318, 346) * 1.25;
    cw.uAlpha.value = 1 - smoothstep(360, 372, u);
    this.cWhale.visible = u < 374;
    const cf = this.cWolf.userData.U;
    cf.uDraw.value = range(u, 340, 360) * 1.25;
    cf.uAlpha.value = 1 - smoothstep(392, 410, u);
    this.cWolf.visible = u < 412;

    const wake = smoothstep(354, 366, u);
    const swimT = range(u, 362, 430);
    this.whaleRig.apply(WHALE.swim(time * 1.1 + u * 0.1, wake));
    this.whale.position.copy(this.cWhale.position).add(new THREE.Vector3(swimT * 420, swimT * 40, -swimT * 1000));
    this.whale.rotation.copy(this.cWhale.rotation);
    this.whale.rotation.y += swimT * 0.4;
    this.whale.material.uniforms.uAlpha.value = 0.4 * wake * (1 - smoothstep(415, 430, u));
    this.whale.visible = u > 350 && u < 432;

    // asteroid tumble
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3();
    const active = u > 360 && u < 480;
    for (const { mesh, data } of this.rocks) {
      mesh.visible = active;
      if (!active) continue;
      for (let i = 0; i < data.length; i++) {
        const d = data[i];
        e.set(d.r.x + time * d.w.x, d.r.y + time * d.w.y, d.r.z + time * d.w.z);
        m4.compose(d.p, q.setFromEuler(e), s.setScalar(d.s));
        mesh.setMatrixAt(i, m4);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }

    this.skyU.uNeb.value = 1 - 0.5 * smoothstep(440, 510, u);
    this.skyU.uDiskGain.value = lerp(0.18, 1, smoothstep(395, 470, u));
    this.dustMat.uniforms.uAlpha.value = 1 - smoothstep(470, 505, u);
    this.bhScreen = toScreen(BH, cam) || new THREE.Vector2(0.5, 0.5);
  }

  post(out) {
    out.rays = 0;
    out.exposure = 1;
  }
}

function mergeVerts(g) {
  // tiny local vertex welder (positions only)
  const P = g.attributes.position.array;
  const map = new Map(), pos = [], idx = [];
  for (let i = 0; i < P.length; i += 3) {
    const key = `${P[i].toFixed(4)},${P[i + 1].toFixed(4)},${P[i + 2].toFixed(4)}`;
    let id = map.get(key);
    if (id === undefined) { id = pos.length / 3; map.set(key, id); pos.push(P[i], P[i + 1], P[i + 2]); }
    idx.push(id);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setIndex(idx);
  return out;
}
