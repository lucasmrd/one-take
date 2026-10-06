import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

// Everything the realistic worlds need, loaded up front with a byte-level progress callback.
const BASE = 'assets/';

export const MANIFEST = {
  gltf: {
    rock1: 'models/rock_moss_set_01.glb',
    rock2: 'models/rock_moss_set_02.glb',
    boulder: 'models/boulder_01.glb',
    trunk: 'models/dead_tree_trunk.glb',
    roots: 'models/pine_roots.glb',
    fern: 'models/fern_02.glb',
    cliff: 'models/mountainside.glb',
  },
  tex: {
    trees_albedo: 'impostors/trees_albedo.webp',
    trees_normal: 'impostors/trees_normal.webp',
    sky: 'sky/dawn_sky.webp',
    ground_diff: 'tex/forrest_ground_01_diff.webp', ground_nor: 'tex/forrest_ground_01_nor.webp', ground_arm: 'tex/forrest_ground_01_arm.webp',
    mud_diff: 'tex/brown_mud_leaves_01_diff.webp', mud_nor: 'tex/brown_mud_leaves_01_nor.webp', mud_arm: 'tex/brown_mud_leaves_01_arm.webp',
    rock_diff: 'tex/aerial_rocks_02_diff.webp', rock_nor: 'tex/aerial_rocks_02_nor.webp', rock_arm: 'tex/aerial_rocks_02_arm.webp',
    leaves_diff: 'tex/forest_leaves_02_diff.webp', leaves_nor: 'tex/forest_leaves_02_nor.webp', leaves_arm: 'tex/forest_leaves_02_arm.webp',
    earth_day: 'earth/earth_day.webp',
    earth_night: 'earth/earth_night.webp',
  },
  json: {
    trees: 'impostors/trees.json',
  },
  hdr: {
    env: 'sky/dawn_env.hdr',
  },
};

// textures holding colour (sRGB) vs data (normals, roughness...)
const COLOR = /(_diff|albedo|sky|earth_)/;

export async function loadAssets(renderer, onProgress) {
  const files = [];
  for (const [k, p] of Object.entries(MANIFEST.gltf)) files.push({ kind: 'gltf', key: k, url: BASE + p });
  for (const [k, p] of Object.entries(MANIFEST.tex)) files.push({ kind: 'tex', key: k, url: BASE + p });
  for (const [k, p] of Object.entries(MANIFEST.json)) files.push({ kind: 'json', key: k, url: BASE + p });
  for (const [k, p] of Object.entries(MANIFEST.hdr)) files.push({ kind: 'hdr', key: k, url: BASE + p });

  const loaded = new Map(), totals = new Map();
  const report = () => {
    let a = 0, b = 0;
    for (const f of files) { a += loaded.get(f.url) || 0; b += totals.get(f.url) || 1e6; }
    onProgress && onProgress(Math.min(1, a / b), a);
  };
  const progress = (url) => (e) => { loaded.set(url, e.loaded); if (e.total) totals.set(url, e.total); report(); };

  const manager = new THREE.LoadingManager();
  const gltfLoader = new GLTFLoader(manager).setMeshoptDecoder(MeshoptDecoder);
  const texLoader = new THREE.TextureLoader(manager);
  const fileLoader = new THREE.FileLoader(manager);
  const hdrLoader = new HDRLoader(manager);
  const maxAniso = renderer.capabilities.getMaxAnisotropy();

  const out = { gltf: {}, tex: {}, json: {}, hdr: {} };
  await Promise.all(files.map(async (f) => {
    if (f.kind === 'gltf') out.gltf[f.key] = await gltfLoader.loadAsync(f.url, progress(f.url));
    else if (f.kind === 'json') out.json[f.key] = JSON.parse(await fileLoader.loadAsync(f.url, progress(f.url)));
    else if (f.kind === 'hdr') { const t = await hdrLoader.loadAsync(f.url, progress(f.url)); t.mapping = THREE.EquirectangularReflectionMapping; out.hdr[f.key] = t; }
    else {
      // TextureLoader has no progress: count the file as done when it lands
      const t = await texLoader.loadAsync(f.url);
      t.colorSpace = COLOR.test(f.key) ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.anisotropy = maxAniso;
      if (!/trees_|sky|earth_/.test(f.key)) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
      out.tex[f.key] = t;
      loaded.set(f.url, 1); totals.set(f.url, 1);
    }
    report();
  }));

  // prefiltered environment for physically based lighting
  const pmrem = new THREE.PMREMGenerator(renderer);
  out.envMap = pmrem.fromEquirectangular(out.hdr.env).texture;
  pmrem.dispose();
  return out;
}

// first mesh of a glTF scene (geometry + material) for instancing
export function firstMesh(gltf) {
  let mesh = null;
  gltf.scene.traverse((o) => { if (!mesh && o.isMesh) mesh = o; });
  mesh.updateWorldMatrix(true, false);
  const g = mesh.geometry.clone();
  g.applyMatrix4(mesh.matrixWorld);
  return { geometry: g, material: mesh.material };
}

export function allMeshes(gltf) {
  const list = [];
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    list.push({ geometry: g, material: o.material });
  });
  return list;
}
