import * as THREE from 'three';

// Directional fog (warmer towards the sun) + low-lying mist. Shared by every lit material of a world.
export function makeFogUniforms({ color, sun, sunDir, density, mist = 0, mistBase = 0, mistFall = 0.2 }) {
  return {
    uFogColor: { value: new THREE.Color(...color) },
    uFogSun: { value: new THREE.Color(...sun) },
    uSunDir: { value: new THREE.Vector3(...sunDir).normalize() },
    uFogDensity: { value: density },
    uMist: { value: mist },
    uMistBase: { value: mistBase },
    uMistFall: { value: mistFall },
  };
}

export const FOG_PARS = /* glsl */ `
uniform vec3 uFogColor;
uniform vec3 uFogSun;
uniform vec3 uSunDir;
uniform float uFogDensity;
uniform float uMist;
uniform float uMistBase;
uniform float uMistFall;
float fogAmount(vec3 wpos, out vec3 fc){
  vec3 vd = wpos - cameraPosition;
  float dist = length(vd);
  vd /= max(dist, 1e-4);
  float f = 1.0 - exp(-uFogDensity*uFogDensity*dist*dist);
  float mist = uMist * exp(-max(wpos.y - uMistBase, 0.0)*uMistFall) * (1.0 - exp(-dist*0.012));
  fc = mix(uFogColor, uFogSun, pow(max(dot(vd, uSunDir), 0.0), 5.0));
  return clamp(f + mist, 0.0, 1.0);
}
vec3 applyFog(vec3 col, vec3 wpos){
  vec3 fc;
  float f = fogAmount(wpos, fc);
  return mix(col, fc, f);
}
`;

// Inject the fog into a built-in material (MeshStandardMaterial etc.).
// `vertexHook` lets callers add vertex displacement (wind).
export function patchMaterial(mat, U, { vertexPars = '', vertexHook = '', fragmentPars = '', fragmentHook = '' } = {}) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vFogW;\n${vertexPars}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${vertexHook}`)
      .replace('#include <fog_vertex>', `#include <fog_vertex>
        vec4 fogW = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          fogW = instanceMatrix * fogW;
        #endif
        vFogW = (modelMatrix * fogW).xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vFogW;\n${FOG_PARS}\n${fragmentPars}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${fragmentHook}`)
      .replace('#include <fog_fragment>', `gl_FragColor.rgb = applyFog(gl_FragColor.rgb, vFogW);`);
  };
  // the hooks differ per material, so they must not share a cached program
  const key = `fog|${vertexPars}|${vertexHook}|${fragmentPars.length}|${fragmentHook}`;
  mat.customProgramCacheKey = () => key;
  return mat;
}
