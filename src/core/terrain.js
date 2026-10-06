import * as THREE from 'three';
import { patchMaterial } from './fog.js';

// Physically based terrain blending five scanned material sets.
// Geometry carries a `layers` attribute: x = mud, y = rock, z = leaves, w = sand (ground is the rest).
export function createTerrainMaterial(T, U, envMap) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, envMap, envMapIntensity: 0.9 });
  const tex = {
    gD: T.ground_diff, gN: T.ground_nor, gA: T.ground_arm,
    mD: T.mud_diff, mN: T.mud_nor,
    rD: T.rock_diff, rN: T.rock_nor,
    lD: T.leaves_diff, lN: T.leaves_nor,
  };
  const uniforms = { ...U };
  for (const [k, v] of Object.entries(tex)) uniforms['t' + k] = { value: v };
  const samplers = Object.keys(tex).map((k) => `uniform sampler2D t${k};`).join('\n');

  return patchMaterial(mat, uniforms, {
    vertexPars: 'attribute vec4 layers; varying vec4 vLayers; varying vec3 vNW;',
    vertexHook: 'vLayers = layers; vNW = normalize(mat3(modelMatrix) * objectNormal);',
    fragmentPars: `${samplers}
      varying vec4 vLayers; varying vec3 vNW;
      float tHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float tNoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(tHash(i), tHash(i + vec2(1, 0)), f.x), mix(tHash(i + vec2(0, 1)), tHash(i + vec2(1, 1)), f.x), f.y); }
      vec3 tAlb; vec3 tNrm; vec3 tArm;
      void tLayer(sampler2D d, sampler2D n, vec2 uv, float w, vec3 arm){
        if (w < 0.004) return;
        tAlb += texture2D(d, uv).rgb * w;
        tNrm += (texture2D(n, uv).xyz * 2.0 - 1.0) * w;
        tArm += arm * w;
      }`,
    fragmentHook: `
      {
        vec2 w2 = vFogW.xz;
        vec4 L = vLayers;
        // break up the layer borders so they read like nature, not paint
        float bn = tNoise(w2 * 0.35) * 0.5 + tNoise(w2 * 1.3) * 0.25;
        L = clamp(L * (0.75 + bn * 0.6), 0.0, 1.0);
        float lsum = L.x + L.y + L.z + L.w;
        if (lsum > 1.0) L /= lsum;
        float g = max(0.0, 1.0 - (L.x + L.y + L.z + L.w));
        tAlb = vec3(0.0); tNrm = vec3(0.0); tArm = vec3(0.0);
        // two scales of the main ground hide the tiling
        float m = tNoise(w2 * 0.06);
        vec3 gArm = texture2D(tgA, w2 / 2.6).rgb;
        tLayer(tgD, tgN, w2 / 2.6, g * m, gArm);
        tLayer(tgD, tgN, w2 / 4.3 + 0.37, g * (1.0 - m), texture2D(tgA, w2 / 4.3 + 0.37).rgb);
        tLayer(tmD, tmN, w2 / 2.4, L.x, vec3(0.9, 0.55, 0.0));
        tLayer(trD, trN, w2 / 9.0, L.y, vec3(0.85, 0.8, 0.0));
        tLayer(tlD, tlN, w2 / 2.0, L.z, vec3(gArm.r, 0.85, 0.0));
        // riverbed: the mud set, coarser and wetter
        tLayer(tmD, tmN, w2 / 1.6 + 0.5, L.w, vec3(0.8, 0.35, 0.0));
        float macro = 0.78 + 0.44 * tNoise(w2 * 0.018) * tNoise(w2 * 0.05 + 3.0);
        diffuseColor.rgb *= tAlb * macro;
      }`,
    fragmentReplace: [
      ['#include <roughnessmap_fragment>', 'float roughnessFactor = clamp(tArm.g, 0.35, 1.0);'],
      ['#include <normal_fragment_maps>', `
        {
          vec3 Nw = normalize(vNW);
          vec3 Tw = normalize(vec3(1.0, 0.0, 0.0) - Nw * Nw.x);
          vec3 Bw = cross(Tw, Nw);
          vec3 nts = normalize(vec3(tNrm.xy * 1.2, max(tNrm.z, 0.2)));
          vec3 nW = normalize(Tw * nts.x + Bw * nts.y + Nw * nts.z);
          normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
        }`],
      ['#include <aomap_fragment>', `#include <aomap_fragment>
        { float ao = mix(1.0, tArm.r, 0.85); reflectedLight.indirectDiffuse *= ao; reflectedLight.indirectSpecular *= ao; reflectedLight.directDiffuse *= mix(1.0, ao, 0.35); }`],
    ],
  });
}
