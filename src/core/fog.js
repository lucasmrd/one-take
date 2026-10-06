import * as THREE from 'three';

const BLANK = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
BLANK.needsUpdate = true;

// Directional fog (warmer towards the sun) + low-lying mist. Shared by every lit material of a world.
// With a sky photo (uSkyMix = 1) the fog takes the real colour of the sky at the horizon in each direction.
export function makeFogUniforms({ color, sun, sunDir, density, mist = 0, mistBase = 0, mistFall = 0.2 }) {
  return {
    uFogColor: { value: new THREE.Color(...color) },
    uFogSun: { value: new THREE.Color(...sun) },
    uSunDir: { value: new THREE.Vector3(...sunDir).normalize() },
    uFogDensity: { value: density },
    uMist: { value: mist },
    uMistBase: { value: mistBase },
    uMistFall: { value: mistFall },
    uSkyTex: { value: BLANK },
    uSkyYaw: { value: 0 },
    uSkyExp: { value: 1 },
    uSkyMix: { value: 0 },
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
uniform sampler2D uSkyTex;
uniform float uSkyYaw;
uniform float uSkyExp;
uniform float uSkyMix;
vec3 skyPhoto(vec3 d){
  float c = cos(uSkyYaw), s = sin(uSkyYaw);
  vec3 h = vec3(d.x * c - d.z * s, d.y, d.x * s + d.z * c);
  vec2 uv = vec2(atan(h.z, h.x) * 0.15915494 + 0.5, asin(clamp(h.y, -1.0, 1.0)) * 0.31830989 + 0.5);
  return texture2D(uSkyTex, uv).rgb * uSkyExp;
}
float fogAmount(vec3 wpos, out vec3 fc){
  vec3 vd = wpos - cameraPosition;
  float dist = length(vd);
  vd /= max(dist, 1e-4);
  float f = 1.0 - exp(-uFogDensity*uFogDensity*dist*dist);
  float mist = uMist * exp(-max(wpos.y - uMistBase, 0.0)*uMistFall) * (1.0 - exp(-dist*0.012));
  fc = mix(uFogColor, uFogSun, pow(max(dot(vd, uSunDir), 0.0), 5.0));
  if (uSkyMix > 0.0) {
    vec3 hz = skyPhoto(normalize(vec3(vd.x, 0.035, vd.z)));
    fc = mix(fc, hz, uSkyMix);
  }
  return clamp(f + mist, 0.0, 1.0);
}
vec3 applyFog(vec3 col, vec3 wpos){
  vec3 fc;
  float f = fogAmount(wpos, fc);
  return mix(col, fc, f);
}
`;

// Inject the fog into a built-in material (MeshStandardMaterial etc.).
// Hooks: vertex displacement (wind), colour tweaks, and arbitrary chunk replacements.
export function patchMaterial(mat, U, { vertexPars = '', vertexHook = '', fragmentPars = '', fragmentHook = '', vertexReplace = [], fragmentReplace = [] } = {}) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    let vs = sh.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vFogW;\n${vertexPars}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${vertexHook}`)
      .replace('#include <fog_vertex>', `#include <fog_vertex>
        vec4 fogW = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          fogW = instanceMatrix * fogW;
        #endif
        vFogW = (modelMatrix * fogW).xyz;`);
    for (const [a, b] of vertexReplace) vs = vs.replace(a, b);
    let fs = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vFogW;\n${FOG_PARS}\n${fragmentPars}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${fragmentHook}`)
      .replace('#include <fog_fragment>', `gl_FragColor.rgb = applyFog(gl_FragColor.rgb, vFogW);`);
    for (const [a, b] of fragmentReplace) fs = fs.replace(a, b);
    sh.vertexShader = vs;
    sh.fragmentShader = fs;
  };
  // the hooks differ per material, so they must not share a cached program
  const key = `fog|${vertexPars}|${vertexHook}|${fragmentPars.length}|${fragmentHook}|${vertexReplace.map((r) => r[1]).join('|').length}|${fragmentReplace.map((r) => r[1]).join('|')}`;
  mat.customProgramCacheKey = () => key;
  return mat;
}
