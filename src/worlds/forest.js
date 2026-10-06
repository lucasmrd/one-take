import * as THREE from 'three';
import { createTerrainMaterial } from '../core/terrain.js';
import { createImpostorForest } from '../core/impostors.js';
import { firstMesh } from '../core/assets.js';
import { Simplex, mulberry32, NOISE_GLSL } from '../core/noise.js';
import { makeFogUniforms, patchMaterial, FOG_PARS } from '../core/fog.js';
import { Rig, createFurMesh, createSpiritPoints, blendPose } from '../animals/animal.js';
import { WOLF, BEAR, DEER, WHALE } from '../animals/specs.js';
import { clamp01, lerp, smoothstep, range, bump, Track, toScreen, skyDome, SKY_VS, easeInCubic } from '../core/util.js';

const HALF = 700;         // terrain half size (m)
const DCELL = 5;          // distance-field cell (m)
const WATER_Y = -0.35;
const PATH = [[0, 440], [18, 380], [-6, 320], [-32, 255], [-18, 190], [16, 128], [30, 64], [10, 0], [-24, -64], [-30, -130], [-6, -196], [18, -256], [12, -316], [0, -380]];

export class ForestWorld {
  constructor(ctx) {
    this.ctx = ctx;
    this.range = [0, 246];
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 5000);
    this.S = new Simplex(42);
    this.rnd = mulberry32(1234);

    // the real sun of the dawn sky photo, turned so it rises ahead of the drone
    const hdrSun = new THREE.Vector3(0.756, 0.081, 0.65).normalize();
    const want = Math.atan2(0.38, -0.92), have = Math.atan2(hdrSun.x, hdrSun.z);
    this.skyYaw = want - have;
    const sunDir = hdrSun.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), this.skyYaw);
    this.U = {
      ...makeFogUniforms({ color: [0.3, 0.31, 0.37], sun: [0.78, 0.52, 0.34], sunDir: sunDir.toArray(), density: 0.0031, mist: 0.18, mistBase: -1, mistFall: 0.4 }),
      uTime: { value: 0 },
      uWind: { value: 1 },
    };
    this.U.uSkyTex.value = ctx.assets.tex.sky;
    this.U.uSkyYaw.value = this.skyYaw;
    this.U.uSkyExp.value = 1.05;
    this.U.uSkyMix.value = 1;
    this.sunDir = this.U.uSunDir.value;

    this.buildPath();
    this.buildTerrain();
    this.buildSky();
    this.buildLights();
    this.buildWater();
    this.buildTrees();
    this.buildRocks();
    this.buildGrass();
    this.buildFireflies();
    this.buildEyes();
    this.buildBirds();
    this.buildAnimals();

    this.trackS = new Track([[0, 0], [20, 0.035], [40, 0.12], [70, 0.26], [100, 0.4], [130, 0.53], [160, 0.67], [182, 0.81], [198, 0.885], [208, 0.9], [246, 0.9]]);
    this.trackH = new Track([[0, 48], [12, 42], [32, 7], [46, 3.4], [100, 3.0], [130, 3.6], [160, 3.0], [190, 2.6], [214, 2.1], [246, 2.1]]);
    this.lookTarget = new THREE.Vector3();
    this.tmp = new THREE.Vector3();
  }

  // ---------------------------------------------------------------------- path & terrain
  buildPath() {
    this.curve = new THREE.CatmullRomCurve3(PATH.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal');
    this.pathLen = this.curve.getLength();
    const pts = this.curve.getSpacedPoints(320).map((p) => [p.x, p.z]);
    this.pathPts = pts;
    const riverPts = pts.slice(0, Math.floor(pts.length * 0.84));
    this.N = Math.floor((HALF * 2) / DCELL) + 1;
    this.dPath = this.distField(pts);
    this.dRiver = this.distField(riverPts);
    this.clearing = this.curve.getPointAt(0.968);
    {
      const c = this.curve.getPointAt(0.5), tan = this.curve.getTangentAt(0.5);
      this.rockSpot = new THREE.Vector3(c.x - tan.z * 14, 0, c.z + tan.x * 14);
    }
    this.camFinal = this.curve.getPointAt(0.9);
  }

  distField(pts) {
    const N = this.N, out = new Float32Array(N * N);
    const segs = [];
    for (let i = 0; i < pts.length - 1; i++) segs.push([pts[i][0], pts[i][1], pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]]);
    for (const s of segs) s.push(Math.max(1e-6, s[2] * s[2] + s[3] * s[3]));
    for (let j = 0; j < N; j++) {
      const z = -HALF + j * DCELL;
      for (let i = 0; i < N; i++) {
        const x = -HALF + i * DCELL;
        let best = 1e12;
        for (let k = 0; k < segs.length; k++) {
          const s = segs[k];
          const px = x - s[0], pz = z - s[1];
          let h = (px * s[2] + pz * s[3]) / s[4];
          h = h < 0 ? 0 : h > 1 ? 1 : h;
          const dx = px - s[2] * h, dz = pz - s[3] * h;
          const d = dx * dx + dz * dz;
          if (d < best) best = d;
        }
        out[i + j * N] = Math.sqrt(best);
      }
    }
    return out;
  }

  field(f, x, z) {
    const N = this.N;
    const fx = Math.min(N - 1.001, Math.max(0, (x + HALF) / DCELL));
    const fz = Math.min(N - 1.001, Math.max(0, (z + HALF) / DCELL));
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
    const a = f[i + j * N], b = f[i + 1 + j * N], c = f[i + (j + 1) * N], d = f[i + 1 + (j + 1) * N];
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  }

  height(x, z) {
    const S = this.S;
    const dp = this.field(this.dPath, x, z), dr = this.field(this.dRiver, x, z);
    let h = 0.8 + S.fbm2(x * 0.02 + 50, z * 0.02, 3) * 0.9;
    h += smoothstep(10, 150, dp) * (10 + S.fbm2(x * 0.0035, z * 0.0035, 4) * 24);
    h += smoothstep(230, 620, dp) * (60 + 75 * (S.fbm2(x * 0.002 + 9, z * 0.002, 5) * 0.5 + 0.5));
    h = lerp(-2.1, h, smoothstep(4.5, 15, dr));
    const dc = Math.hypot(x - this.clearing.x, z - this.clearing.z);
    h = lerp(h, 0.9 + S.noise2(x * 0.05, z * 0.05) * 0.25, (1 - smoothstep(30, 62, dc)) * 0.9);
    return h;
  }

  ground(x, z) { return Math.max(this.height(x, z), WATER_Y); }

  buildTerrain() {
    const seg = 380;
    const g = new THREE.PlaneGeometry(HALF * 2, HALF * 2, seg, seg);
    g.rotateX(-Math.PI / 2);
    const P = g.attributes.position.array;
    for (let i = 0; i < P.length; i += 3) P[i + 1] = this.height(P[i], P[i + 2]);
    g.computeVertexNormals();
    const Nn = g.attributes.normal.array;
    const layers = new Float32Array((P.length / 3) * 4);
    for (let i = 0, j = 0; i < P.length; i += 3, j += 4) {
      const x = P[i], z = P[i + 2];
      const dr = this.field(this.dRiver, x, z), dp = this.field(this.dPath, x, z);
      const slope = 1 - Nn[i + 1];
      const n = this.S.noise2(x * 0.03, z * 0.03) * 0.5 + 0.5;
      const sand = 1 - smoothstep(3, 6.5, dr);
      const mud = (1 - smoothstep(5, 12, dr)) * (1 - sand);
      const rock = Math.max(smoothstep(0.28, 0.5, slope), smoothstep(170, 330, dp) * 0.75);
      const leaves = smoothstep(9, 26, dp) * (1 - smoothstep(220, 320, dp)) * (0.25 + 0.6 * n) * (1 - rock);
      layers.set([mud, rock, leaves * (1 - mud), sand], j);
    }
    g.setAttribute('layers', new THREE.BufferAttribute(layers, 4));
    const m = new THREE.Mesh(g, createTerrainMaterial(this.ctx.assets.tex, this.U, this.ctx.assets.envMap));
    m.receiveShadow = true;
    this.scene.add(m);
    this.tris = (this.tris || 0) + seg * seg * 2;
  }

  buildSky() {
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...this.U },
      vertexShader: SKY_VS,
      fragmentShader: /* glsl */ `
        ${FOG_PARS}
        varying vec3 vDir;
        void main(){
          vec3 d = normalize(vDir);
          vec3 col = skyPhoto(vec3(d.x, max(d.y, 0.012), d.z));
          float sa = max(dot(d, normalize(uSunDir)), 0.0);
          // the photo is tone mapped: give the sun back its HDR punch for bloom and god rays
          col += vec3(1.0, 0.8, 0.55) * smoothstep(0.99955, 0.99985, sa) * 40.0;
          col += vec3(1.0, 0.72, 0.45) * pow(sa, 80.0) * 1.2;
          col = mix(col, skyPhoto(normalize(vec3(d.x, 0.03, d.z))) * 0.9, smoothstep(0.0, -0.12, d.y));
          gl_FragColor = vec4(col, 1.0);
        }
      `,
      side: THREE.BackSide,
      depthWrite: false,
    });
    this.sky = skyDome(mat, 3500);
    this.scene.add(this.sky);
  }

  buildLights() {
    const sun = new THREE.DirectionalLight(new THREE.Color(1.0, 0.78, 0.56), 3.4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    const sc = sun.shadow.camera;
    sc.left = -130; sc.right = 130; sc.top = 130; sc.bottom = -130; sc.near = 1; sc.far = 1200;
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.5;
    this.scene.add(sun, sun.target);
    this.sun = sun;
    // image based lighting from the real dawn sky
    this.scene.environment = this.ctx.assets.envMap;
    this.scene.environmentIntensity = 0.75;
    this.scene.environmentRotation.set(0, -this.skyYaw, 0);
  }

  buildWater() {
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...this.U },
      vertexShader: /* glsl */ `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `
        ${NOISE_GLSL}
        ${FOG_PARS}
        uniform float uTime;
        varying vec3 vW;
        float wave(vec2 p, float t){ return snoise(vec3(p * 1.0 + vec2(0.0, t), t * 0.3)) * 0.6 + snoise(vec3(p * 2.7 + vec2(t * 0.4, t * 1.6), t * 0.5)) * 0.3; }
        void main(){
          vec3 V = normalize(cameraPosition - vW);
          vec2 p = vW.xz * 0.35; float t = uTime * 0.6;
          float e = 0.03;
          float h0 = wave(p, t), hx = wave(p + vec2(e, 0.0), t), hz = wave(p + vec2(0.0, e), t);
          float dist = length(cameraPosition - vW);
          float k = 0.022 / (1.0 + dist * 0.02);
          vec3 N = normalize(vec3((h0 - hx) / e * k, 1.0, (h0 - hz) / e * k));
          vec3 R = reflect(-V, N);
          vec3 sky = skyPhoto(vec3(R.x, max(R.y, 0.015), R.z));
          float sa = max(dot(R, normalize(uSunDir)), 0.0);
          // the forest walls reflect as dark bands above the horizon
          float tree = smoothstep(-0.02, 0.05, R.y) * (1.0 - smoothstep(0.32, 0.55, R.y));
          sky = mix(sky, vec3(0.015, 0.025, 0.018), tree * 0.9 * (1.0 - pow(sa, 6.0)));
          float fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
          vec3 deep = vec3(0.006, 0.018, 0.016);
          vec3 col = mix(deep, sky, fres);
          col += vec3(1.6, 1.1, 0.7) * pow(sa, 600.0) * 4.0;
          col = applyFog(col, vW);
          // clear near the bank so the stones show through, mirror-like further away
          float alpha = mix(0.78, 1.0, fres);
          gl_FragColor = vec4(col, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
    });
    const g = new THREE.PlaneGeometry(HALF * 2, HALF * 2, 1, 1);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, mat);
    m.position.y = WATER_Y;
    m.renderOrder = 2;
    this.scene.add(m);
  }

  // ---------------------------------------------------------------------- trees (scanned, as impostors)
  buildTrees() {
    const A = this.ctx.assets;
    const meta = A.json.trees;
    const inst = [];
    const rnd = this.rnd;
    let tries = 0;
    const target = 19000;
    while (inst.length < target && tries < 120000) {
      tries++;
      const x = (rnd() * 2 - 1) * (HALF - 20), z = (rnd() * 2 - 1) * (HALF - 20);
      const dp = this.field(this.dPath, x, z), dr = this.field(this.dRiver, x, z);
      const corridor = 9 + this.S.noise2(x * 0.03, z * 0.03) * 4;
      if (dp < corridor || dr < 12) continue;
      if (dp > 520 && rnd() < 0.85) continue;
      const dc = Math.hypot(x - this.clearing.x, z - this.clearing.z);
      if (dc < 42 + this.S.noise2(x * 0.1, z * 0.1) * 8) continue;
      // open sky behind the howling wolf
      const rdx = x - this.rockSpot.x, rdz = z - this.rockSpot.z;
      if (Math.hypot(rdx, rdz) < 26 || (rdz < 0 && rdz > -160 && Math.abs(rdx + rdz * 0.41) < 25 - rdz * 0.25)) continue;
      const y = this.height(x, z);
      if (y < 0.2 || y > 110) continue;
      if (this.S.noise2(x * 0.012 + 3, z * 0.012) < -0.45 && rnd() < 0.6) continue;
      // firs in the valley, pines on the slopes
      const pine = rnd() < 0.3 + smoothstep(20, 160, dp) * 0.4;
      const v = (pine ? 3 : 0) + Math.floor(rnd() * 3);
      const s = 0.85 + rnd() * 0.35 + smoothstep(30, 160, dp) * 0.15;
      inst.push([x, y - 0.15, z, s, rnd() * Math.PI * 2, v]);
    }
    this.treeList = inst;
    this.trees = createImpostorForest(meta, A.tex.trees_albedo, A.tex.trees_normal, inst, this.U);
    this.scene.add(this.trees);
    this.treeCount = inst.length;
    this.tris += inst.length * 2;
  }

  // scanned ground cover: rocks, ferns, roots, fallen trunks, moss
  scatter(gltf, count, place, opts = {}) {
    const { geometry, material } = firstMesh(gltf);
    geometry.computeBoundingBox();
    const size = geometry.boundingBox.getSize(new THREE.Vector3());
    const mat = material.clone();
    mat.envMapIntensity = opts.env ?? 1;
    if (opts.alphaTest) { mat.alphaTest = opts.alphaTest; mat.transparent = false; mat.alphaToCoverage = true; mat.depthWrite = true; mat.side = THREE.DoubleSide; }
    patchMaterial(mat, this.U);
    const mesh = new THREE.InstancedMesh(geometry, mat, count);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), p = new THREE.Vector3();
    let k = 0, tries = 0;
    while (k < count && tries < count * 30) {
      tries++;
      const r = place(size);
      if (!r) continue;
      const [x, z, s, tilt = 0.08, sink = 0.05] = r;
      const y = this.height(x, z);
      e.set((this.rnd() - 0.5) * tilt, this.rnd() * Math.PI * 2, (this.rnd() - 0.5) * tilt);
      m4.compose(p.set(x, y - sink * s * size.y, z), q.setFromEuler(e), sc.setScalar(s));
      mesh.setMatrixAt(k++, m4);
    }
    mesh.count = k;
    mesh.castShadow = opts.shadow ?? true;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    this.scene.add(mesh);
    this.tris += (geometry.index ? geometry.index.count / 3 : geometry.attributes.position.count / 3) * k;
    return mesh;
  }

  nearPath(minLat, maxLat, tMax = 1) {
    const t = this.rnd() * tMax;
    const c = this.curve.getPointAt(t), tan = this.curve.getTangentAt(t);
    const lat = (this.rnd() < 0.5 ? -1 : 1) * (minLat + this.rnd() * (maxLat - minLat));
    return [c.x - tan.z * lat + (this.rnd() - 0.5) * 4, c.z + tan.x * lat + (this.rnd() - 0.5) * 4];
  }

  buildRocks() {
    const G = this.ctx.assets.gltf;
    const dryLand = (x, z) => this.field(this.dRiver, x, z) > 5.5 && this.height(x, z) > WATER_Y + 0.05;
    // river stones and mossy rock sets along the banks
    for (const key of ['rock1', 'rock2']) {
      this.scatter(G[key], 110, (size) => {
        const [x, z] = this.nearPath(3.5, 22, 0.88);
        return [x, z, (0.5 + Math.pow(this.rnd(), 2) * 1.4) * (2.2 / Math.max(size.x, size.z)), 0.4, 0.15];
      });
    }
    // ferns carpet the forest edge
    this.scatter(G.fern, 2600, (size) => {
      const [x, z] = this.nearPath(6, 40);
      if (!dryLand(x, z)) return null;
      return [x, z, (0.6 + this.rnd() * 0.6) * (1.5 / Math.max(size.x, size.z, 0.01)), 0.25, 0.0];
    }, { alphaTest: 0.45, shadow: false, env: 0.8 });
    // roots at the feet of the trees nearest the path
    const near = this.treeList.filter(([x, , z]) => this.field(this.dPath, x, z) < 40);
    this.scatter(G.roots, Math.min(180, near.length), () => {
      const tr = near[Math.floor(this.rnd() * near.length)];
      return [tr[0], tr[2], tr[3] * 1.1, 0.05, 0.02];
    });
    // fallen trunks
    this.scatter(G.trunk, 36, (size) => {
      const [x, z] = this.nearPath(9, 38, 0.95);
      if (!dryLand(x, z)) return null;
      return [x, z, (0.8 + this.rnd() * 0.5) * (9 / Math.max(size.x, size.z)), 0.06, 0.12];
    });
    // a few big boulders in the woods
    this.scatter(G.boulder, 26, (size) => {
      const [x, z] = this.nearPath(12, 60, 0.95);
      if (!dryLand(x, z)) return null;
      return [x, z, (1.2 + this.rnd() * 2.5) * (2 / Math.max(size.x, size.z)), 0.3, 0.25];
    });

    // the howling rock: a scanned boulder, scaled up into a lookout
    const t = 0.5;
    const c = this.curve.getPointAt(t), tan = this.curve.getTangentAt(t);
    const lat = 14;
    const rx = c.x - tan.z * lat, rz = c.z + tan.x * lat;
    const gy = this.height(rx, rz);
    const { geometry, material } = firstMesh(G.boulder);
    geometry.computeBoundingBox();
    const bb = geometry.boundingBox;
    const scale = 9.5 / (bb.max.y - bb.min.y);
    const mat = material.clone();
    patchMaterial(mat, this.U);
    const big = new THREE.Mesh(geometry, mat);
    big.scale.set(scale * 0.75, scale, scale * 0.85);
    big.rotation.y = Math.atan2(tan.x, tan.z);
    big.position.set(rx, gy - 0.6 - bb.min.y * scale, rz);
    big.castShadow = big.receiveShadow = true;
    this.scene.add(big);
    big.updateMatrixWorld(true);
    // stand the wolf on the real top surface of the scan
    const ray = new THREE.Raycaster(new THREE.Vector3(rx, gy + 60, rz), new THREE.Vector3(0, -1, 0));
    const hit = ray.intersectObject(big)[0];
    this.wolfRock = new THREE.Vector3(rx, hit ? hit.point.y - 0.05 : gy + 8, rz);
    this.wolfRockYaw = Math.atan2(tan.x, tan.z);
  }

  // ---------------------------------------------------------------------- grass
  buildGrass() {
    const count = 240000;
    const blade = new THREE.BufferGeometry();
    const ys = [0, 0.3, 0.6, 0.85];
    const pos = [];
    for (const y of ys) pos.push(-0.5, y, 0, 0.5, y, 0);
    pos.push(0, 1, 0);
    const idx = [];
    for (let i = 0; i < ys.length - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 3, a, a + 3, a + 2); }
    const last = (ys.length - 1) * 2;
    idx.push(last, last + 1, last + 2);
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    const iPos = new Float32Array(count * 3), iP = new Float32Array(count * 4);
    const rnd = mulberry32(77);
    let k = 0, tries = 0;
    while (k < count && tries < count * 4) {
      tries++;
      const t = rnd();
      const c = this.curve.getPointAt(t);
      const tan = this.curve.getTangentAt(t);
      const lat = (rnd() * 2 - 1) * 44;
      const x = c.x - tan.z * lat + (rnd() - 0.5) * 6, z = c.z + tan.x * lat + (rnd() - 0.5) * 6;
      const dr = this.field(this.dRiver, x, z);
      if (dr < 6.2) continue;
      const y = this.height(x, z);
      if (y < WATER_Y + 0.1) continue;
      const dense = this.S.noise2(x * 0.08, z * 0.08);
      if (dense < -0.3 && rnd() < 0.6) continue;
      iPos[k * 3] = x; iPos[k * 3 + 1] = y - 0.05; iPos[k * 3 + 2] = z;
      iP[k * 4] = rnd() * Math.PI * 2;
      iP[k * 4 + 1] = 0.35 + rnd() * 0.65 + (dense > 0.2 ? 0.3 : 0);
      iP[k * 4 + 2] = 0.05 + rnd() * 0.05;
      iP[k * 4 + 3] = rnd();
      k++;
    }
    g.setAttribute('iPos', new THREE.InstancedBufferAttribute(iPos.subarray(0, k * 3), 3));
    g.setAttribute('iP', new THREE.InstancedBufferAttribute(iP.subarray(0, k * 4), 4));
    g.instanceCount = k;
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...this.U, uSunCol: { value: new THREE.Color(1.5, 1.05, 0.7) } },
      vertexShader: /* glsl */ `
        attribute vec3 iPos; attribute vec4 iP;
        uniform float uTime, uWind;
        varying float vY, vR; varying vec3 vW;
        void main(){
          float h = iP.y, w = iP.z;
          vec3 p = vec3(position.x * w * (1.0 - position.y * 0.85), position.y * h, 0.0);
          p.z += 0.35 * position.y * position.y * h;
          float c = cos(iP.x), s = sin(iP.x);
          p = vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
          float wv = sin(uTime * 1.6 + iPos.x * 0.15 + iPos.z * 0.11) + 0.5 * sin(uTime * 3.3 + iPos.x * 0.43 + iPos.z * 0.2);
          float bend = position.y * position.y * h * uWind;
          p.x += wv * 0.16 * bend; p.z += wv * 0.07 * bend;
          vec3 wp = iPos + p;
          vW = wp; vY = position.y; vR = iP.w;
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        ${FOG_PARS}
        uniform vec3 uSunCol;
        varying float vY, vR; varying vec3 vW;
        void main(){
          vec3 base = mix(vec3(0.02, 0.045, 0.012), vec3(0.2, 0.27, 0.07), vY);
          base *= 0.7 + 0.6 * vR;
          base = mix(base, vec3(0.32, 0.28, 0.1), step(0.82, vR) * vY * 0.6);
          vec3 V = normalize(vW - cameraPosition);
          float back = pow(max(dot(V, uSunDir), 0.0), 3.0);
          vec3 col = base * (vec3(0.35, 0.38, 0.45) + uSunCol * 0.6);
          col += vec3(0.9, 0.75, 0.2) * uSunCol * back * vY * vY * 0.9;
          if (vR > 0.975 && vY > 0.8) {
            float k = fract(vR * 397.0);
            vec3 flower = k < 0.33 ? vec3(1.6, 1.5, 1.3) : k < 0.66 ? vec3(1.6, 1.1, 0.2) : vec3(0.9, 0.5, 1.5);
            col = flower * (0.6 + back);
          }
          col = applyFog(col, vW);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(g, mat);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    this.grassCount = k;
    this.tris += k * 7;
  }

  // ---------------------------------------------------------------------- small lights
  buildFireflies() {
    const n = 7000;
    const pos = new Float32Array(n * 3), rnd4 = new Float32Array(n * 4);
    const rnd = mulberry32(9);
    for (let i = 0; i < n; i++) {
      const t = 0.15 + rnd() * 0.85;
      const c = this.curve.getPointAt(t), tan = this.curve.getTangentAt(t);
      const lat = (rnd() * 2 - 1) * 30;
      const x = c.x - tan.z * lat, z = c.z + tan.x * lat;
      pos[i * 3] = x; pos[i * 3 + 1] = this.ground(x, z) + 0.3 + rnd() * 4; pos[i * 3 + 2] = z;
      rnd4.set([rnd(), rnd(), rnd(), rnd()], i * 4);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('rnd', new THREE.BufferAttribute(rnd4, 4));
    this.fireMat = new THREE.ShaderMaterial({
      uniforms: { uTime: this.U.uTime, uPR: this.ctx.uPR, uAmt: { value: 0 } },
      vertexShader: /* glsl */ `
        attribute vec4 rnd; uniform float uTime, uPR, uAmt; varying float vA;
        void main(){
          vec3 p = position + vec3(sin(uTime * 0.3 + rnd.x * 30.0), sin(uTime * 0.5 + rnd.y * 20.0) * 0.5, cos(uTime * 0.35 + rnd.z * 25.0)) * 0.8;
          vec4 mv = viewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          float blink = pow(max(sin(uTime * (0.8 + rnd.w * 1.5) + rnd.x * 60.0), 0.0), 6.0);
          vA = blink * uAmt;
          gl_PointSize = clamp(uPR * 90.0 / -mv.z, 1.0, 24.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vA;
        void main(){ vec2 c = gl_PointCoord - 0.5; float a = exp(-dot(c, c) * 30.0); gl_FragColor = vec4(vec3(2.6, 2.2, 0.7), a * vA); }
      `,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const p = new THREE.Points(g, this.fireMat);
    p.frustumCulled = false;
    this.scene.add(p);
  }

  buildEyes() {
    const pairs = 140;
    const pos = new Float32Array(pairs * 6), side = new Float32Array(pairs * 2), rnd4 = new Float32Array(pairs * 8);
    const rnd = mulberry32(31);
    for (let i = 0; i < pairs; i++) {
      const t = 0.27 + rnd() * 0.2;
      const c = this.curve.getPointAt(t), tan = this.curve.getTangentAt(t);
      const lat = (rnd() < 0.5 ? -1 : 1) * (15 + rnd() * 26);
      const x = c.x - tan.z * lat, z = c.z + tan.x * lat;
      const y = this.ground(x, z) + (rnd() < 0.3 ? 4 + rnd() * 8 : 0.4 + rnd() * 1.2);
      const r = [rnd(), rnd(), rnd(), rnd()];
      for (let s = 0; s < 2; s++) {
        const j = i * 2 + s;
        pos.set([x, y, z], j * 3);
        side[j] = s ? 1 : -1;
        rnd4.set(r, j * 4);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('side', new THREE.BufferAttribute(side, 1));
    g.setAttribute('rnd', new THREE.BufferAttribute(rnd4, 4));
    this.eyesMat = new THREE.ShaderMaterial({
      uniforms: { uTime: this.U.uTime, uPR: this.ctx.uPR, uAmt: { value: 0 } },
      vertexShader: /* glsl */ `
        attribute float side; attribute vec4 rnd; uniform float uTime, uPR, uAmt; varying float vA; varying vec3 vC;
        void main(){
          vec4 mv = viewMatrix * vec4(position, 1.0);
          mv.x += side * (0.07 + rnd.y * 0.05);
          gl_Position = projectionMatrix * mv;
          float blink = step(0.035, fract(uTime * (0.15 + rnd.z * 0.2) + rnd.x));
          float appear = smoothstep(rnd.w * 0.6, rnd.w * 0.6 + 0.3, uAmt);
          vA = blink * appear;
          vC = rnd.x < 0.6 ? vec3(3.0, 1.9, 0.5) : vec3(1.0, 3.0, 0.8);
          gl_PointSize = clamp(uPR * 7.0 / -mv.z * 6.0, 1.5, 9.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vA; varying vec3 vC;
        void main(){ vec2 c = gl_PointCoord - 0.5; float a = exp(-dot(c, c) * 18.0); gl_FragColor = vec4(vC, a * vA); }
      `,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const p = new THREE.Points(g, this.eyesMat);
    p.frustumCulled = false;
    this.scene.add(p);
  }

  buildBirds() {
    const n = 3600;
    const base = new THREE.BufferGeometry();
    base.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0, 0.3, 0, 0, -0.15, -0.65, 0.05, -0.08,
      0, 0, 0.3, 0.65, 0.05, -0.08, 0, 0, -0.15,
      0, 0.02, 0.32, -0.05, 0, -0.25, 0.05, 0, -0.25,
    ], 3));
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', base.attributes.position);
    const perch = new Float32Array(n * 3), r4 = new Float32Array(n * 4);
    const rnd = mulberry32(55);
    for (let i = 0; i < n; i++) {
      const t = 0.07 + rnd() * 0.12;
      const c = this.curve.getPointAt(t), tan = this.curve.getTangentAt(t);
      const lat = (rnd() < 0.5 ? -1 : 1) * (16 + rnd() * 40);
      const x = c.x - tan.z * lat, z = c.z + tan.x * lat;
      perch.set([x, this.ground(x, z) + 9 + rnd() * 7, z], i * 3);
      r4.set([rnd(), rnd(), rnd(), rnd()], i * 4);
    }
    g.setAttribute('iPerch', new THREE.InstancedBufferAttribute(perch, 3));
    g.setAttribute('iRnd', new THREE.InstancedBufferAttribute(r4, 4));
    g.instanceCount = n;
    this.birdMat = new THREE.ShaderMaterial({
      uniforms: { ...this.U, uFly: { value: 0 }, uScale: { value: 30 }, uCenter: { value: new THREE.Vector3() }, uDrift: { value: new THREE.Vector3(0, 0, -1) } },
      vertexShader: /* glsl */ `
        ${NOISE_GLSL}
        attribute vec3 iPerch; attribute vec4 iRnd;
        uniform float uTime, uFly, uScale; uniform vec3 uCenter, uDrift;
        varying vec3 vW;
        void main(){
          float t = clamp((uFly - iRnd.x * 0.35) / 0.45, 0.0, 1.0);
          float te = t * t * (3.0 - 2.0 * t);
          vec3 blob = normalize(iRnd.yzw * 2.0 - 1.0 + 0.001) * pow(fract(iRnd.x * 7.31 + iRnd.y * 3.1), 0.45);
          vec3 q = blob * 1.6 + vec3(uTime * 0.11, uTime * 0.07, -uTime * 0.09);
          blob += vec3(snoise(q), snoise(q + 11.3), snoise(q + 23.7)) * 0.75;
          blob *= uScale; blob.y *= 0.42;
          vec3 target = uCenter + blob;
          vec3 pos = mix(iPerch, target, te) + vec3(0.0, sin(te * 3.14159) * 12.0, 0.0);
          vec3 f0 = normalize(target - iPerch + vec3(0.0, 0.001, 0.0));
          vec3 f1 = normalize(uDrift + vec3(snoise(q + 5.0), snoise(q + 9.0) * 0.3, snoise(q + 7.0)) * 0.8);
          vec3 fwd = normalize(mix(f0, f1, te));
          vec3 right = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
          vec3 up = cross(right, fwd);
          vec3 lp = position;
          float flap = sin(uTime * (15.0 + iRnd.y * 7.0) + iRnd.z * 30.0);
          lp.y += abs(lp.x) * flap * 0.9 * step(0.001, t);
          lp *= (0.55 + iRnd.w * 0.3) * mix(0.0, 1.0, step(0.0001, t) * 0.999 + 0.001);
          vec3 wp = pos + right * lp.x + up * lp.y + fwd * lp.z;
          vW = wp;
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        ${FOG_PARS}
        varying vec3 vW;
        void main(){ vec3 fc; float f = fogAmount(vW, fc); gl_FragColor = vec4(mix(vec3(0.012, 0.01, 0.012), fc, f * 0.75), 1.0); }
      `,
      side: THREE.DoubleSide,
    });
    const m = new THREE.Mesh(g, this.birdMat);
    m.frustumCulled = false;
    this.scene.add(m);
    this.birdCount = n;
  }

  // ---------------------------------------------------------------------- animals
  buildAnimals() {
    const M = this.ctx.models;
    const U = this.U, uPR = this.ctx.uPR;
    const sunCol = [1.7, 1.15, 0.72];

    // the howling wolf (flesh) and its rising soul
    this.wolfRig = new Rig(M.wolf);
    this.wolf = createFurMesh(M.wolf, this.wolfRig, U, { shells: 26, length: 0.03, density: 150, colA: [0.04, 0.04, 0.045], colB: [0.32, 0.3, 0.29], sunCol, rim: 0.75 });
    this.wolf.scale.setScalar(1.9);
    this.scene.add(this.wolf);
    this.wolfSoul = createSpiritPoints(M.wolf, this.wolfRig, 26000, { uTime: U.uTime, uPR, size: 0.9, color: [0.4, 1.3, 2.6], color2: [1.6, 2.1, 2.8], seed: 3 });
    this.wolfSoul.scale.setScalar(1.9);
    this.scene.add(this.wolfSoul);

    // the pack of spirit wolves
    this.pack = [];
    const lats = [-3.4, 3.9, -6.8, 7.4];
    const leads = [7.5, 9.5, 12.5, 15];
    for (let i = 0; i < 4; i++) {
      const rig = new Rig(M.wolf);
      const pts = createSpiritPoints(M.wolf, rig, 22000, { uTime: U.uTime, uPR, size: 0.8, color: [0.35, 1.2, 2.6], color2: [1.4, 2.0, 2.8], seed: 40 + i });
      pts.scale.setScalar(1.75 + i * 0.08);
      this.scene.add(pts);
      this.pack.push({ rig, pts, lat: lats[i], lead: leads[i], phase: i * 1.7 });
    }

    // deer herd on the left bank
    this.herd = [];
    const rnd = mulberry32(88);
    for (let i = 0; i < 6; i++) {
      const rig = new Rig(M.deer);
      const mesh = createFurMesh(M.deer, rig, U, { shells: 9, length: 0.02, density: 140, colA: [0.1, 0.05, 0.025], colB: [0.48, 0.3, 0.16], sunCol, rim: 1.0 });
      const t = 0.158 + rnd() * 0.022;
      const c = this.curve.getPointAt(t), tan = this.curve.getTangentAt(t);
      const lat = -(10 + rnd() * 9);
      const x = c.x - tan.z * lat, z = c.z + tan.x * lat;
      const flee = new THREE.Vector3(tan.z, 0, -tan.x).multiplyScalar(-1).add(tan.clone().multiplyScalar(0.6)).normalize();
      mesh.scale.setScalar(0.95 + rnd() * 0.15);
      this.scene.add(mesh);
      this.herd.push({ rig, mesh, home: new THREE.Vector3(x, 0, z), yaw: rnd() * Math.PI * 2, flee, delay: rnd() * 2.5, g: rnd() });
    }

    // spirit whale swimming through the canopy fog
    this.whaleRig = new Rig(M.whale);
    this.whale = createSpiritPoints(M.whale, this.whaleRig, 70000, { uTime: U.uTime, uPR, size: 0.9, color: [0.45, 1.0, 2.6], color2: [1.9, 1.4, 2.8], seed: 9, flow: 0.4 });
    this.whale.scale.setScalar(1.6);
    this.scene.add(this.whale);

    // the guardian bear: spirit first, then flesh
    this.bearRig = new Rig(M.bear);
    this.bear = createFurMesh(M.bear, this.bearRig, U, { shells: 28, length: 0.085, density: 48, colA: [0.035, 0.022, 0.014], colB: [0.33, 0.21, 0.11], sunCol, rim: 1.0, glow: [3.2, 1.9, 0.6] });
    // amber eyes that catch the light
    const eyeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.1, 0.25) });
    this.bearEyes = [0, 1].map(() => { const m = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 8), eyeMat); this.scene.add(m); return m; });
    this.bear.scale.setScalar(2.0);
    this.scene.add(this.bear);
    this.bearSpirit = createSpiritPoints(M.bear, this.bearRig, 90000, { uTime: U.uTime, uPR, size: 0.6, color: [2.6, 1.4, 0.35], color2: [2.8, 2.3, 1.3], seed: 5 });
    this.bearSpirit.scale.setScalar(1.35);
    this.scene.add(this.bearSpirit);

    // bear walks from far in the clearing towards the camera's final spot
    const dir = this.clearing.clone().sub(this.camFinal).setY(0).normalize();
    this.bearDir = dir;
    const right = new THREE.Vector3(-dir.z, 0, dir.x);
    this.bearFinal = this.camFinal.clone().addScaledVector(dir, 10.5).addScaledVector(right, 1.5);
    this.bearStart = this.camFinal.clone().addScaledVector(dir, 58).addScaledVector(right, 30);
    this.particles = 26000 + 22000 * 4 + 70000 * 2 + 7000 + 3600 + 280;
  }

  // ---------------------------------------------------------------------- per frame
  place(obj, x, z, yaw, yOff = 0) {
    obj.position.set(x, this.ground(x, z) + yOff, z);
    obj.rotation.set(0, yaw, 0);
  }

  update(u, time, dt) {
    const U = this.U;
    U.uTime.value = time;
    const cam = this.camera;

    // sun rises a little during the forest
    this.sun.position.copy(cam.position).addScaledVector(this.sunDir, 400);
    this.sun.target.position.copy(cam.position);
    U.uMist.value = lerp(0.2, 0.05, range(u, 20, 110));

    // ---- camera along the river
    const s = this.trackS.at(u);
    const p = this.curve.getPointAt(Math.min(s, 1));
    const hc = this.trackH.at(u);
    const camPos = new THREE.Vector3(p.x, this.ground(p.x, p.z) + hc, p.z);
    const ahead = this.curve.getPointAt(Math.min(s + 0.03, 1));
    const look = new THREE.Vector3(ahead.x, this.ground(ahead.x, ahead.z) + hc * 0.75 - 0.6, ahead.z);
    if (u < 34) {
      const far = this.curve.getPointAt(Math.min(s + 0.12, 1));
      look.lerp(new THREE.Vector3(far.x, 26, far.z), 1 - smoothstep(14, 34, u));
    }

    // ---- birds
    const fly = range(u, 32, 44);
    this.birdMat.uniforms.uFly.value = fly;
    const fc = this.curve.getPointAt(Math.min(s + 0.07 + fly * 0.03, 1));
    this.birdMat.uniforms.uCenter.value.set(fc.x + 10, this.ground(fc.x, fc.z) + 30 + fly * 22 + range(u, 60, 95) * 80, fc.z);
    this.birdMat.uniforms.uDrift.value.copy(this.curve.getTangentAt(Math.min(s + 0.07, 1))).setY(0.1);
    this.birdMat.uniforms.uScale.value = 26 + fly * 14;

    // ---- deer
    for (const d of this.herd) {
      const alert = smoothstep(44 + d.delay * 0.4, 46.5 + d.delay * 0.4, u);
      const run = Math.max(0, u - (48.5 + d.delay * 0.8));
      const dist = run * run * 0.9 + run * 3;
      const x = d.home.x + d.flee.x * dist, z = d.home.z + d.flee.z * dist;
      let yaw = d.yaw;
      let pose;
      if (run > 0) {
        yaw = Math.atan2(d.flee.x, d.flee.z);
        pose = DEER.run(time * 9 + d.delay * 3 + u);
      } else {
        const toCam = Math.atan2(camPos.x - x, camPos.z - z);
        let rel = toCam - yaw;
        rel = Math.atan2(Math.sin(rel), Math.cos(rel));
        const graze = (1 - alert) * (0.7 + 0.3 * Math.sin(time * 0.6 + d.g * 9));
        pose = DEER.idle(graze, Math.max(-1.1, Math.min(1.1, rel)) * alert, time + d.g * 10);
      }
      d.rig.apply(pose);
      this.place(d.mesh, x, z, yaw);
      d.mesh.visible = u < 75;
    }

    // ---- spirit whale crossing above the canopy
    const wT = range(u, 60, 102);
    const ws = this.curve.getPointAt(Math.min(0.31 + wT * 0.06, 1));
    const wtan = this.curve.getTangentAt(Math.min(0.31 + wT * 0.06, 1));
    const wr = new THREE.Vector3(-wtan.z, 0, wtan.x);
    const wpos = new THREE.Vector3(ws.x, this.ground(ws.x, ws.z) + 30 - Math.sin(wT * Math.PI) * 6, ws.z).addScaledVector(wr, lerp(95, -95, wT));
    this.whale.position.copy(wpos);
    this.whale.rotation.set(0, Math.atan2(-wr.x, -wr.z) + 0.25, 0);
    this.whaleRig.apply(WHALE.swim(time * 1.2 + u * 0.15, 1));
    this.whale.material.uniforms.uAlpha.value = bump(u, 60, 68, 94, 102);
    this.whale.visible = u > 58 && u < 104;

    // ---- the wolf on the rock
    const wolfVisible = u > 80 && u < 175;
    this.wolf.visible = this.wolfSoul.visible = wolfVisible;
    const toCamW = Math.atan2(camPos.x - this.wolfRock.x, camPos.z - this.wolfRock.z);
    const sunYaw = Math.atan2(this.sunDir.x, this.sunDir.z);
    const wolfYaw = lerp(toCamW, sunYaw - 0.5, smoothstep(102, 108, u));
    const howlK = bump(u, 105.5, 108.5, 121, 125);
    let rel = toCamW - wolfYaw; rel = Math.atan2(Math.sin(rel), Math.cos(rel));
    const wolfPose = WOLF.howl(1, howlK, (1 - howlK) * Math.max(-1, Math.min(1, rel)), time);
    this.wolfRig.apply(wolfPose);
    this.wolf.position.copy(this.wolfRock);
    this.wolf.rotation.set(0, wolfYaw, 0);
    // soul rises out of the howling body (both visible at once), then leaps to the pack
    const rise = smoothstep(109, 121, u);
    const leap = smoothstep(124, 133, u);
    const soulA = smoothstep(108.5, 112, u);
    this.wolfSoul.material.uniforms.uAlpha.value = soulA * (1 - smoothstep(134, 137, u));
    this.wolfSoul.material.uniforms.uScatter.value = smoothstep(133, 137, u) * 0.8;
    this.wolfSoul.position.copy(this.wolfRock).add(new THREE.Vector3(0, rise * 2.4, 0));
    this.wolfSoul.rotation.set(0, wolfYaw, 0);
    if (leap > 0) {
      const lead = this.pack[0];
      const tgt = this.packPos(0, s, u, lead);
      this.wolfSoul.position.lerp(tgt, leap).add(new THREE.Vector3(0, Math.sin(leap * Math.PI) * 6, 0));
      this.wolfSoul.rotation.y = lerp(wolfYaw, Math.atan2(this.curve.getTangentAt(s).x, this.curve.getTangentAt(s).z), leap);
    }

    // ---- the pack runs alongside, on the water
    for (let i = 0; i < this.pack.length; i++) {
      const w = this.pack[i];
      const pos = this.packPos(i, s, u, w);
      const tanP = this.curve.getTangentAt(Math.min(s + w.lead / this.pathLen, 1));
      w.pts.position.copy(pos);
      w.pts.rotation.set(0, Math.atan2(tanP.x, tanP.z), 0);
      w.rig.apply(WOLF.run(u * 2.6 + time * 2.2 + w.phase));
      const appear = i === 0 ? smoothstep(132, 136, u) : smoothstep(126 + i * 2, 131 + i * 2, u);
      const gone = smoothstep(196 + i, 204 + i, u);
      w.pts.material.uniforms.uAlpha.value = appear;
      w.pts.material.uniforms.uScatter.value = (1 - appear) * 0.9 + gone;
      w.pts.visible = u > 124 && u < 212;
    }

    // ---- the guardian bear
    const walkT = smoothstep(160, 204, u);
    const bpos = this.bearStart.clone().lerp(this.bearFinal, walkT);
    const toCamB = Math.atan2(camPos.x - bpos.x, camPos.z - bpos.z);
    const walkDir = this.bearFinal.clone().sub(this.bearStart);
    const faceCam = smoothstep(203, 210, u);
    const yawWalk = Math.atan2(walkDir.x, walkDir.z), yawCam = Math.atan2(-this.bearDir.x, -this.bearDir.z);
    let dYaw = yawCam - yawWalk; dYaw = Math.atan2(Math.sin(dYaw), Math.cos(dYaw));
    const bearYaw = yawWalk + dYaw * faceCam;
    let relB = toCamB - bearYaw; relB = Math.atan2(Math.sin(relB), Math.cos(relB));
    const roarR = smoothstep(211, 217.5, u) * (1 - 0.45 * smoothstep(232, 246, u));
    const jaw = bump(u, 214.5, 217, 238, 246);
    const walkPose = BEAR.walk(u * 1.6 + time * 0.8, relB);
    const roarPose = BEAR.roar(roarR, jaw, relB * (1 - roarR), time);
    const stop = smoothstep(203, 209, u);
    this.bearRig.apply(blendPose(walkPose, roarPose, stop));
    this.place(this.bear, bpos.x, bpos.z, bearYaw);
    this.bearSpirit.position.copy(this.bear.position);
    this.bearSpirit.rotation.copy(this.bear.rotation);
    // the spirit is a giant that condenses into flesh as it reaches us
    this.bearSpirit.scale.setScalar(lerp(4.2, 2.0, smoothstep(186, 206, u)));
    const reveal = smoothstep(195, 211, u);
    this.bear.material.uniforms.uReveal.value = reveal;
    this.bear.visible = reveal > 0.001 && u < 246;
    this.bearEyes.forEach((m, i) => {
      this.bearRig.point('head', [i ? -0.1 : 0.1, 1.1, 1.21], this.bear, m.position);
      m.visible = reveal > 0.9 && u < 246;
    });
    this.bearSpirit.material.uniforms.uAlpha.value = 0.55 * smoothstep(150, 160, u) * (1 - smoothstep(203, 213, u));
    this.bearSpirit.material.uniforms.uFlow.value = 1 - reveal * 0.8;
    this.bearSpirit.visible = u > 148 && u < 214;

    // ---- attention: where the drone looks
    const att = (w, target) => { if (w > 0) look.lerp(target, w); };
    att(bump(u, 33, 38, 44, 50) * 0.55, this.birdMat.uniforms.uCenter.value.clone().setY(this.birdMat.uniforms.uCenter.value.y - 8));
    const herdC = this.herd[0].mesh.position.clone().add(new THREE.Vector3(0, 1.2, 0));
    att(bump(u, 42, 46, 52, 58) * 0.6, herdC);
    att(bump(u, 64, 72, 88, 98) * 0.75, wpos.clone());
    const wolfHead = this.wolfRig.point('head', [0, 0.95, 0.85], this.wolf);
    att(bump(u, 98, 104, 124, 132) * 0.8, wolfHead);
    att(bump(u, 116, 120, 126, 132) * 0.5, this.wolfSoul.position.clone().add(new THREE.Vector3(0, 1.5, 0)));
    att(bump(u, 136, 142, 150, 158) * 0.35, this.pack[1].pts.position.clone().add(new THREE.Vector3(0, 0.8, 0)));
    const bearHead = this.bearRig.point('head', [0, 1.08, 1.05], this.bear);
    att(smoothstep(160, 176, u) * 0.92, bearHead);

    // ---- final rush into the bear's eye
    const rush = easeInCubic(range(u, 224, 241));
    if (rush > 0) {
      const eye = this.bearRig.point('head', [0.1, 1.1, 1.21], this.bear);
      const away = camPos.clone().sub(eye).normalize();
      camPos.lerp(eye.clone().addScaledVector(away, 0.25), rush);
      look.lerp(eye, Math.min(1, rush * 3));
    }
    cam.position.copy(camPos);
    this.lookTarget.lerp(look, 1 - Math.exp(-dt * 6));
    if (!this.lookInit) { this.lookTarget.copy(look); this.lookInit = true; }
    cam.lookAt(this.lookTarget);
    cam.fov = lerp(55 - 19 * bump(u, 100, 107, 123, 131) - 12 * smoothstep(196, 210, u), 30, rush);
    cam.updateProjectionMatrix();
    this.eyeScreen = toScreen(this.bearRig.point('head', [0.1, 1.1, 1.21], this.bear), cam) || new THREE.Vector2(0.5, 0.5);

    // ---- ambient lights
    this.fireMat.uniforms.uAmt.value = bump(u, 50, 70, 195, 215);
    this.eyesMat.uniforms.uAmt.value = bump(u, 66, 80, 98, 108);
    U.uWind.value = 1 + bump(u, 214, 216, 226, 232) * 2.5;
  }

  packPos(i, s, u, w) {
    const ps = Math.min(s + w.lead / this.pathLen + Math.sin(u * 0.05 + i) * 0.003, 1);
    const c = this.curve.getPointAt(ps), tan = this.curve.getTangentAt(ps);
    const x = c.x - tan.z * w.lat, z = c.z + tan.x * w.lat;
    return new THREE.Vector3(x, this.ground(x, z) + 0.05, z);
  }

  post(out) {
    out.sun = toScreen(this.camera.position.clone().addScaledVector(this.sunDir, 1000), this.camera) || out.sun;
    const fwd = new THREE.Vector3();
    this.camera.getWorldDirection(fwd);
    out.rays = 0.45 * smoothstep(0.2, 0.75, fwd.dot(this.sunDir));
    out.exposure = 1.0;
    out.rayTint = [1.0, 0.78, 0.5];
  }
}

// foliage normals point away from the crown centre: soft, volumetric shading instead of facets
function softNormals(geo, center, yScale) {
  const P = geo.attributes.position.array;
  const N = new Float32Array(P.length);
  const v = new THREE.Vector3();
  for (let i = 0; i < P.length; i += 3) {
    v.set(P[i] - center.x, (P[i + 1] - center.y) * yScale + 0.4, P[i + 2] - center.z).normalize();
    N[i] = v.x; N[i + 1] = v.y; N[i + 2] = v.z;
  }
  geo.setAttribute('normal', new THREE.BufferAttribute(N, 3));
}

function paint(geo, dark, light, shadeByHeight = false) {
  const P = geo.attributes.position.array;
  let minY = Infinity, maxY = -Infinity;
  for (let i = 1; i < P.length; i += 3) { minY = Math.min(minY, P[i]); maxY = Math.max(maxY, P[i]); }
  const col = new Float32Array(P.length);
  for (let i = 0; i < P.length; i += 3) {
    const t = shadeByHeight ? (P[i + 1] - minY) / Math.max(1e-3, maxY - minY) : Math.random();
    const k = shadeByHeight ? Math.pow(t, 0.7) : t;
    const speckle = shadeByHeight ? 0.75 + Math.random() * 0.5 : 1;
    for (let c = 0; c < 3; c++) col[i + c] = (dark[c] + (light[c] - dark[c]) * k) * speckle;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
}
