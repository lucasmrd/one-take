import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Scroll } from './core/scroll.js';
import { createCompositeMaterial, createGradeMaterial } from './core/post.js';
import { AudioEngine } from './core/audio.js';
import { lerp, smoothstep, bump, range } from './core/util.js';
import { Overlay } from './ui/overlay.js';
import { t, applyStatic, setLang } from './i18n.js';
import { TOTAL, TRANSITIONS, CAPTIONS, EVENTS, resist, soloAt } from './timeline.js';
import { AnimalModel } from './animals/animal.js';
import { loadAssets } from './core/assets.js';
import { SPECS } from './animals/specs.js';
import { ForestWorld } from './worlds/forest.js';
import { EyeWorld } from './worlds/eye.js';
import { SpaceWorld } from './worlds/space.js';
import { MagicWorld } from './worlds/magic.js';
import { CityWorld } from './worlds/city.js';
import { OrbitWorld } from './worlds/orbit.js';

const params = new URLSearchParams(location.search);
applyStatic();
document.querySelectorAll('#langs [data-lang]').forEach((b) => b.addEventListener('click', () => {
  setLang(b.dataset.lang);
  const busy = document.getElementById('loader').style.display !== 'none';
  if (busy && bootStep >= 0) document.getElementById('loader-text').textContent = t('steps')[bootStep];
}));
let bootStep = -1;
const overlay = new Overlay();
const canvas = document.getElementById('gl');

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, preserveDrawingBuffer: params.has('skip') });
  if (!renderer.capabilities.isWebGL2) throw new Error('no webgl2');
} catch (e) {
  overlay.noGL();
  throw e;
}
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.info.autoReset = false;
renderer.setClearColor(0x000000, 1);

const ctx = {
  renderer,
  uPR: { value: 1 },
  aspect: 1,
  mouse: new THREE.Vector2(),
  models: null,
};
const mouseTarget = new THREE.Vector2();
window.addEventListener('pointermove', (e) => {
  mouseTarget.set((e.clientX / window.innerWidth) * 2 - 1, -((e.clientY / window.innerHeight) * 2 - 1));
});

// ------------------------------------------------------------------ pipeline
const rtOpts = { type: THREE.HalfFloatType, samples: 4, depthBuffer: true };
const rtA = new THREE.WebGLRenderTarget(4, 4, rtOpts);
const rtB = new THREE.WebGLRenderTarget(4, 4, rtOpts);
const composer = new EffectComposer(renderer);
const compositeMat = createCompositeMaterial();
compositeMat.uniforms.tA.value = rtA.texture;
compositeMat.uniforms.tB.value = rtB.texture;
const compositePass = new ShaderPass(compositeMat);
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.8, 0.55, 0.9);
const gradeMat = createGradeMaterial();
const gradePass = new ShaderPass(gradeMat, 'tDiffuse');
composer.addPass(compositePass);
composer.addPass(bloom);
composer.addPass(gradePass);
composer.addPass(new OutputPass());

const maxPR = Math.min(window.devicePixelRatio || 1, 1.5);
let pr = params.has('pr') ? parseFloat(params.get('pr')) : Math.min(1, maxPR);
const worlds = {};

let sizeW = 0, sizeH = 0;
function resize() {
  const W = window.innerWidth, H = window.innerHeight;
  if (!W || !H) return;
  sizeW = W; sizeH = H;
  // keep the shaded pixel count sane on very large screens
  const cap = Math.sqrt((2560 * 1440) / (W * H));
  const p = Math.min(pr, cap);
  renderer.setPixelRatio(p);
  renderer.setSize(W, H, false);
  composer.setPixelRatio(p);
  composer.setSize(W, H);
  rtA.setSize(Math.floor(W * p), Math.floor(H * p));
  rtB.setSize(Math.floor(W * p), Math.floor(H * p));
  ctx.aspect = W / H;
  ctx.uPR.value = p * (H / 1080);
  compositeMat.uniforms.uAspect.value = ctx.aspect;
  gradeMat.uniforms.uAspect.value = ctx.aspect;
  gradeMat.uniforms.uRes.value.set(W * p, H * p);
  for (const w of Object.values(worlds)) {
    if (w.camera.isPerspectiveCamera) { w.camera.aspect = ctx.aspect; w.camera.updateProjectionMatrix(); }
  }
}
window.addEventListener('resize', resize);
resize();

// ------------------------------------------------------------------ boot
const scroll = new Scroll(TOTAL, { resist, autoStop: 972 });
const audio = new AudioEngine();
// setTimeout (not rAF) so loading keeps going in a background tab
const nextFrame = () => new Promise((r) => setTimeout(r, 30));

async function boot() {
  const steps = [
    () => { ctx.models = {}; ctx.models.wolf = new AnimalModel(SPECS.wolf); },
    () => { ctx.models.bear = new AnimalModel(SPECS.bear); },
    () => { ctx.models.deer = new AnimalModel(SPECS.deer); },
    () => { ctx.models.whale = new AnimalModel(SPECS.whale); },
    () => { worlds.forest = new ForestWorld(ctx); },
    () => { worlds.eyeIn = new EyeWorld(ctx, 'enter'); worlds.eyeOut = new EyeWorld(ctx, 'final'); },
    () => { worlds.space = new SpaceWorld(ctx); },
    () => { worlds.magic = new MagicWorld(ctx); },
    () => { worlds.city = new CityWorld(ctx); },
    () => { worlds.orbit = new OrbitWorld(ctx); },
    () => { resize(); warmUp(); },
  ];
  bootStep = -1;
  ctx.assets = await loadAssets(renderer, (p, bytes) => {
    overlay.loading(p * 0.55, `${t('downloading')} · ${(bytes / 1e6).toFixed(0)} MB`);
  });
  for (let i = 0; i < steps.length; i++) {
    bootStep = i;
    overlay.loading(0.55 + (i / steps.length) * 0.45, t('steps')[i]);
    await nextFrame();
    steps[i]();
  }
  stats.particles = Object.values(worlds).reduce((a, w) => a + (w.particles || 0), 0)
    + (worlds.forest.grassCount || 0);
  stats.gpu = null;

  const startAt = parseFloat(params.get('t') || '0');
  if (params.has('skip')) { overlay.skip(); start(startAt); } else overlay.ready(() => start(startAt));
}

function warmUp() {
  // render every world once so shaders compile and buffers upload before the show
  for (const w of Object.values(worlds)) {
    const u = (w.range[0] + w.range[1]) / 2;
    w.update(u, 0, 1 / 60);
    renderer.setRenderTarget(rtA);
    renderer.render(w.scene, w.camera);
  }
  renderer.setRenderTarget(null);
  for (const w of Object.values(worlds)) { w.lookInit = false; }
}

function rawRenderer() {
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  } catch (e) {
    return '';
  }
}
// hardware acceleration off: the browser falls back to a CPU rasterizer
if (/swiftshader|llvmpipe|softpipe|software|basic render/i.test(rawRenderer())) {
  document.getElementById('swwarn').hidden = false;
}

function gpuName() {
  try {
    let s = rawRenderer();
    const m = /ANGLE \(([^,]+),\s*([^,(]+?)(?:\s*\(0x[0-9a-fA-F]+\))?(?:\s+Direct3D|\s+OpenGL|\s+Vulkan|,|\))/.exec(s);
    if (m) s = m[2].trim();
    s = s.replace(/\s+/g, ' ').trim();
    return s ? `${t('gpuPrefix')} ${s}` : t('gpuFallback');
  } catch (e) {
    return t('gpuFallback');
  }
}

let running = false;
let firstStart = true;
function start(u0) {
  if (!params.has('skip')) enterFS();
  // test runs (?skip) stay silent unless ?sound is given
  audio.meterOnly = params.has('meter');
  if (!params.has('skip') || params.has('sound') || params.has('meter')) audio.init();
  scroll.enabled = true;
  scroll.jump(u0);
  prevU = u0;
  if (u0 < 6) scroll.target = 6; // the drone powers on by itself
  stats.t0 = performance.now();
  if (!running) { running = true; schedule(); }
  if (autoplay > 0) { scroll.autoSpeed = autoplay; scroll.setAuto(true); }
  firstStart = false;
}

// ------------------------------------------------------------------ input extras
const muteBtn = document.getElementById('mute');
const toggleMute = () => { audio.setMuted(!audio.muted); muteBtn.classList.toggle('muted', audio.muted); };
muteBtn.addEventListener('click', toggleMute);
if (params.has('mute')) { audio.muted = true; muteBtn.classList.add('muted'); }
// browsers may suspend audio until a gesture: resume on any click or key
const wake = () => { if (audio.ctx && audio.ctx.state === 'suspended') audio.ctx.resume(); };
window.addEventListener('pointerdown', wake);
window.addEventListener('keydown', wake);
window.addEventListener('keydown', (e) => {
  if (e.key === 'm' || e.key === 'M') toggleMute();
  if ((e.key === 'f' || e.key === 'F') && running) toggleFS();
});

// fullscreen: entered on the start click (browsers only allow it inside a user gesture)
const fsBtn = document.getElementById('fs');
const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement;
function enterFS() {
  const el = document.documentElement;
  const fn = el.requestFullscreen || el.webkitRequestFullscreen;
  if (!fn) return;
  try { const p = fn.call(el, { navigationUI: 'hide' }); if (p && p.catch) p.catch(() => {}); } catch (e) { /* refused */ }
}
function toggleFS() {
  if (fsEl()) { (document.exitFullscreen || document.webkitExitFullscreen).call(document); } else enterFS();
}
if (!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen)) fsBtn.hidden = true;
fsBtn.addEventListener('click', toggleFS);

// autopilot: middle mouse button or the ▶ button
const autoBtn = document.getElementById('auto');
const autoBadge = document.getElementById('auto-badge');
scroll.onAuto = (on) => {
  autoBtn.classList.toggle('active', on);
  autoBtn.textContent = on ? '❚❚' : '▶';
  autoBadge.classList.toggle('on', on);
};
autoBtn.addEventListener('click', () => scroll.setAuto(!scroll.auto));
document.getElementById('again').addEventListener('click', () => {
  overlay.hideCredits();
  scroll.jump(0);
  scroll.target = 6;
  prevU = 0;
  for (const w of Object.values(worlds)) w.lookInit = false;
  stats.triangles = 0; stats.frames = 0; stats.t0 = performance.now();
});

// ------------------------------------------------------------------ frame loop
const stats = { triangles: 0, frames: 0, particles: 0, gpu: '', t0: 0 };
const post = { sun: new THREE.Vector2(0.5, 0.5), rays: 0, exposure: 1, rayTint: [1, 0.8, 0.55] };
const autoplay = parseFloat(params.get('auto') || '0');
let last = performance.now();
let time = 0;
let prevU = 0;
let frameTimeAvg = 16;
let lastPRChange = 0;
let lastSolo = null;

const BLOOM = { forest: [0.45, 0.45, 1.3], eyeIn: [0.6, 0.4, 1.1], space: [0.75, 0.6, 1.1], magic: [0.8, 0.55, 1.05], city: [0.75, 0.5, 1.15], orbit: [0.8, 0.6, 0.95], eyeOut: [0.6, 0.4, 1.1] };

function renderWorld(w, rt) {
  renderer.setRenderTarget(rt);
  renderer.clear();
  renderer.render(w.scene, w.camera);
}

function cameraFX(w, shake) {
  const c = w.camera;
  if (!c.isPerspectiveCamera) return;
  c.rotateY(-ctx.mouse.x * 0.1);
  c.rotateX(ctx.mouse.y * 0.06);
  if (shake > 0) {
    c.rotateX((Math.sin(time * 61) + Math.sin(time * 37)) * shake * 0.5);
    c.rotateY((Math.sin(time * 53) + Math.sin(time * 29)) * shake * 0.5);
    c.rotateZ(Math.sin(time * 47) * shake * 0.4);
  }
}

// debug runs (?skip) keep rendering even when the tab is hidden
const schedule = () => (params.has('skip') ? setTimeout(() => frame(performance.now()), 16) : requestAnimationFrame(frame));

function frame(now) {
  schedule();
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  time += dt;
  if (window.innerWidth !== sizeW || window.innerHeight !== sizeH) resize();
  if (!sizeW) return;

  scroll.update(dt);
  const u = scroll.pos;
  ctx.mouse.lerp(mouseTarget, 1 - Math.exp(-dt * 2.5));

  // events
  if (u > prevU) for (const [eu, name] of EVENTS) if (prevU < eu && u >= eu) audio.fire(name);
  prevU = u;

  // which worlds are on screen
  const tr = TRANSITIONS.find((t) => u >= t.start && u < t.end);
  let A, B = null, p = 0, aName, bName = null;
  if (tr) { aName = tr.from; bName = tr.to; A = worlds[aName]; B = worlds[bName]; p = (u - tr.start) / (tr.end - tr.start); }
  else { aName = soloAt(u); A = worlds[aName]; }
  if (aName !== lastSolo) { lastSolo = aName; }

  const shake = bump(u, 215.6, 216.4, 222, 228) * 0.03 + bump(u, 238.5, 239.4, 240, 243) * 0.02
    + bump(u, 500, 512, 514, 520) * 0.008 + bump(u, 660, 662, 664, 668) * 0.01;

  renderer.info.reset();
  A.update(u, time, dt);
  cameraFX(A, shake);
  renderWorld(A, rtA);
  if (B) {
    B.update(u, time, dt);
    cameraFX(B, shake);
    renderWorld(B, rtB);
  }
  renderer.setRenderTarget(null);

  // composite
  const cu = compositeMat.uniforms;
  cu.uTime.value = time;
  cu.uMode.value = tr ? tr.mode : 0;
  cu.uP.value = p;
  if (tr) {
    if (tr.mode === 4) { cu.uCenter.value.copy(worlds.forest.eyeScreen); cu.uEdge.value.setRGB(1, 0.8, 0.5); }
    if (tr.mode === 1) { const m = worlds.eyeIn.pupilMask(); cu.uCenter.value.copy(m.center); cu.uRadius.value = m.radius; }
    if (tr.mode === 2) { cu.uCenter.value.copy(worlds.space.bhScreen); cu.uRadius.value = Math.pow(p, 1.7) * 1.8; cu.uEdge.value.setRGB(2.4, 1.5, 0.5); }
    if (tr.mode === 3) { cu.uEdge.value.setRGB(1.6, 1.1, 0.35); }
  }

  // post settings from the dominant world
  const D = B && p > 0.5 ? B : A;
  const dName = B && p > 0.5 ? bName : aName;
  post.rays = 0; post.exposure = 1; post.rayTint = [1, 0.8, 0.55];
  D.post(post);
  const g = gradeMat.uniforms;
  g.uSun.value.copy(post.sun);
  g.uRays.value = lerp(g.uRays.value, post.rays * (tr && tr.mode !== 5 ? 0 : 1), 1 - Math.exp(-dt * 5));
  g.uRayTint.value.setRGB(...post.rayTint);
  g.uExposure.value = post.exposure;
  g.uTime.value = time;
  g.uCA.value = 0.0018 + shake * 0.15;
  g.uFade.value = smoothstep(0.5, 7, u) * (1 - smoothstep(968, 971, u));
  g.uFlash.value = 0;
  g.uLetterbox.value = 0.055 * Math.max(bump(u, 240, 248, 284, 294), bump(u, 930, 940, 990, 1000));
  const bl = BLOOM[dName] || BLOOM.forest;
  bloom.strength = bl[0];
  bloom.radius = bl[1];
  bloom.threshold = bl[2];

  composer.render(dt);

  // stats + adaptive resolution
  stats.triangles += renderer.info.render.triangles;
  stats.frames++;
  frameTimeAvg = lerp(frameTimeAvg, dt * 1000, 0.05);
  if (now - lastPRChange > 2500 && !params.has('pr')) {
    if (frameTimeAvg > 24 && pr > 0.55) { pr = Math.max(0.55, pr - 0.1); resize(); lastPRChange = now; }
    else if (frameTimeAvg < 14 && pr < maxPR) { pr = Math.min(maxPR, pr + 0.1); resize(); lastPRChange = now; }
  }

  // audio + UI
  const wts = {};
  wts[aName] = 1 - (B ? smoothstep(0, 1, p) : 0);
  if (B) wts[bName] = smoothstep(0, 1, p);
  audio.update(u, scroll.vel, wts, time);
  overlay.update(u, TOTAL, scroll.idle, CAPTIONS);
  if (u > 971.5) overlay.showCredits({ ...stats, gpu: gpuName(), seconds: (performance.now() - stats.t0) / 1000 });
  else if (u < 969) overlay.hideCredits();
}

// debug handle
window.OT = { scroll, worlds, stats, audio, renderer, ctx, jump: (u) => { scroll.jump(u); prevU = u; for (const w of Object.values(worlds)) w.lookInit = false; } };

boot();
