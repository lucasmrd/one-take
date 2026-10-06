import * as THREE from 'three';
import { FOG_PARS } from './fog.js';

// Octant-ring impostors: each scanned tree was photographed from 12 azimuths x 2 elevations.
// At runtime a camera-facing quad blends the four nearest photos and relights the baked normals.

function shaderParts(meta, shadow) {
  const AZ = meta.az.toFixed(1);
  const ROWS = (meta.variants.length * meta.els.length).toFixed(1);
  const EL1 = THREE.MathUtils.degToRad(meta.els[1]).toFixed(5);
  const vertex = /* glsl */ `
    attribute vec4 iA;   // x, ground y, z, scale
    attribute vec2 iB;   // rotation, variant
    uniform vec4 uMeta[${meta.variants.length}];
    uniform vec3 uLightDir;
    uniform float uTime, uWind;
    varying vec2 vUv0, vUv1, vUv2, vUv3;
    varying vec4 vWt;
    varying vec3 vRight, vUp, vFwd, vWP;
    varying float vH;
    vec2 tile(float a, float row, vec2 t){ return vec2((a + t.x) / ${AZ}, 1.0 - (row + 1.0 - t.y) / ${ROWS}); }
    void main(){
      int vi = int(iB.y + 0.5);
      vec4 m = uMeta[vi];
      float s = iA.w;
      vec3 center = vec3(iA.x, iA.y + m.z * s, iA.z);
      ${shadow ? 'vec3 V = normalize(uLightDir);' : 'vec3 V = normalize(cameraPosition - center);'}
      float c = cos(-iB.x), sn = sin(-iB.x);
      vec3 Vl = vec3(c * V.x + sn * V.z, V.y, -sn * V.x + c * V.z);
      float az = atan(Vl.x, Vl.z);
      if (az < 0.0) az += 6.2831853;
      float f = az / 6.2831853 * ${AZ};
      float a0 = floor(f), t = f - a0, a1 = mod(a0 + 1.0, ${AZ});
      float el = asin(clamp(Vl.y, -1.0, 1.0));
      float r = clamp(el / ${EL1}, 0.0, 1.0);
      // quad axes built from the view direction clamped to the baked elevation range
      vec3 Vh = normalize(vec3(V.x, 0.0, V.z) + vec3(0.0001));
      float elc = clamp(el, 0.0, ${EL1});
      vec3 Vb = normalize(Vh * cos(elc) + vec3(0.0, sin(elc), 0.0));
      vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), Vb));
      vec3 up = cross(Vb, right);
      vec3 p = position;
      float sway = (sin(uTime * 0.8 + iA.x * 0.07 + iA.z * 0.05) + 0.35 * sin(uTime * 1.9 + iA.x * 0.3)) * uWind;
      vec3 wp = center + right * (p.x * m.x * s + sway * 0.012 * m.y * s * max(p.y + 0.3, 0.0)) + up * p.y * m.y * s;
      vec2 tt = p.xy * 0.5 + 0.5;
      float row0 = float(vi) * 2.0;
      vUv0 = tile(a0, row0, tt); vUv1 = tile(a1, row0, tt);
      vUv2 = tile(a0, row0 + 1.0, tt); vUv3 = tile(a1, row0 + 1.0, tt);
      vWt = vec4((1.0 - t) * (1.0 - r), t * (1.0 - r), (1.0 - t) * r, t * r);
      // rotate the bake frame back into the world for relighting
      vec3 R0 = vec3(c * right.x - sn * right.z, right.y, sn * right.x + c * right.z);
      vRight = right; vUp = up; vFwd = Vb;
      vH = tt.y;
      vWP = wp;
      gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
    }
  `;
  return vertex;
}

export function createImpostorForest(meta, albedo, normal, instances, U, opts = {}) {
  // instances: array of [x, y, z, scale, rotY, variant]
  const n = instances.length;
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const A = new Float32Array(n * 4), B = new Float32Array(n * 2);
  instances.forEach(([x, y, z, s, r, v], i) => { A.set([x, y, z, s], i * 4); B.set([r, v], i * 2); });
  g.setAttribute('iA', new THREE.InstancedBufferAttribute(A, 4));
  g.setAttribute('iB', new THREE.InstancedBufferAttribute(B, 2));
  g.instanceCount = n;

  const metaU = meta.variants.map((v) => new THREE.Vector4(v.halfW, v.halfH, v.centerY, v.height));
  const common = {
    uMeta: { value: metaU },
    uAlbedo: { value: albedo },
    uNormal: { value: normal },
    uLightDir: U.uSunDir,
    uTime: U.uTime,
    uWind: U.uWind || { value: 1 },
  };

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      ...U, ...common,
      uSunCol: { value: new THREE.Color(...(opts.sunCol || [2.2, 1.6, 1.1])) },
      uSkyAmb: { value: new THREE.Color(...(opts.skyAmb || [0.32, 0.36, 0.45])) },
      uGroundAmb: { value: new THREE.Color(...(opts.groundAmb || [0.12, 0.11, 0.08])) },
    },
    vertexShader: shaderParts(meta, false),
    fragmentShader: /* glsl */ `
      ${FOG_PARS}
      uniform sampler2D uAlbedo, uNormal;
      uniform vec3 uSunCol, uSkyAmb, uGroundAmb;
      varying vec2 vUv0, vUv1, vUv2, vUv3;
      varying vec4 vWt;
      varying vec3 vRight, vUp, vFwd, vWP;
      varying float vH;
      void main(){
        vec4 c = texture2D(uAlbedo, vUv0) * vWt.x + texture2D(uAlbedo, vUv1) * vWt.y + texture2D(uAlbedo, vUv2) * vWt.z + texture2D(uAlbedo, vUv3) * vWt.w;
        float a = smoothstep(0.3, 0.6, c.a);
        if (a < 0.02) discard;
        vec3 albedo = c.rgb / max(c.a, 0.001);
        vec3 nb = (texture2D(uNormal, vUv0).xyz * vWt.x + texture2D(uNormal, vUv1).xyz * vWt.y + texture2D(uNormal, vUv2).xyz * vWt.z + texture2D(uNormal, vUv3).xyz * vWt.w) * 2.0 - 1.0;
        vec3 N = normalize(vRight * nb.x + vUp * nb.y + vFwd * max(nb.z, 0.05));
        vec3 L = normalize(uSunDir);
        vec3 V = normalize(cameraPosition - vWP);
        float diff = max(dot(N, L) * 0.7 + 0.3, 0.0);
        // inner canopy is darker; edges catch the light
        float ao = mix(0.45, 1.0, smoothstep(0.0, 0.9, nb.z)) * mix(0.55, 1.0, smoothstep(0.0, 0.6, vH));
        vec3 amb = mix(uGroundAmb, uSkyAmb, N.y * 0.5 + 0.5);
        float back = pow(max(dot(-V, L), 0.0), 3.0);
        vec3 col = albedo * (amb * ao + uSunCol * diff * ao * 0.75);
        col += albedo * uSunCol * vec3(1.0, 0.9, 0.55) * back * (1.0 - nb.z * 0.6) * 0.9;
        col = applyFog(col, vWP);
        gl_FragColor = vec4(col, a);
      }
    `,
    alphaToCoverage: true,
    side: THREE.DoubleSide,
  });

  const depth = new THREE.ShaderMaterial({
    uniforms: { ...common },
    vertexShader: shaderParts(meta, true),
    fragmentShader: /* glsl */ `
      #include <packing>
      uniform sampler2D uAlbedo;
      varying vec2 vUv0, vUv1, vUv2, vUv3;
      varying vec4 vWt;
      void main(){
        float a = texture2D(uAlbedo, vUv0).a * vWt.x + texture2D(uAlbedo, vUv1).a * vWt.y + texture2D(uAlbedo, vUv2).a * vWt.z + texture2D(uAlbedo, vUv3).a * vWt.w;
        if (a < 0.5) discard;
        gl_FragColor = packDepthToRGBA(gl_FragCoord.z);
      }
    `,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(g, mat);
  mesh.customDepthMaterial = depth;
  mesh.castShadow = true;
  mesh.frustumCulled = false;
  return mesh;
}
