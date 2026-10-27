// Scroll-driven motorcycle ride. The page works without this file (see ui.js and the CSS fallback).
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { AfterimagePass } from "three/addons/postprocessing/AfterimagePass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { buildBike } from "./bike.js";

const canvas = document.getElementById("scene");
const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
let PORTRAIT = innerWidth / innerHeight < 0.8;
const LITE = innerWidth < 760 || (navigator.hardwareConcurrency || 8) <= 4;
const perf = { level: 0, t: 0, n: 0, wait: 2 }; // speed governor, see governor() below

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: !LITE, powerPreference: "high-performance" });
} catch (e) {
  throw new Error("WebGL unavailable"); // CSS fallback stays visible
}
renderer.setPixelRatio(LITE ? 1 : Math.min(devicePixelRatio, 1.75));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x04050a);
scene.fog = new THREE.FogExp2(0x05060c, 0.018);
const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 400);

/* ---------------- helpers ---------------- */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const BLUE = new THREE.Color(0x4796e3), VIOLET = new THREE.Color(0x9177c7), ROSE = new THREE.Color(0xca6673);
const gem = (t, out = new THREE.Color()) => t < 0.5 ? out.copy(BLUE).lerp(VIOLET, t * 2) : out.copy(VIOLET).lerp(ROSE, (t - 0.5) * 2);
let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3();
function glowTexture() {
  const c = document.createElement("canvas"); c.width = c.height = 128; const x = c.getContext("2d");
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64); g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.2, "rgba(255,255,255,.5)"); g.addColorStop(1, "rgba(255,255,255,0)");
  x.fillStyle = g; x.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(c);
}
const GLOW = glowTexture();
const sprite = (color, size, opacity) => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false })); s.scale.setScalar(size); return s; };
function paintGradient(geo, dir) {
  const p = geo.attributes.position, v = new THREE.Vector3(); let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < p.count; i++) { const d = v.fromBufferAttribute(p, i).dot(dir); mn = Math.min(mn, d); mx = Math.max(mx, d); }
  const c = new Float32Array(p.count * 3), tc = new THREE.Color();
  for (let i = 0; i < p.count; i++) gem((v.fromBufferAttribute(p, i).dot(dir) - mn) / (mx - mn), tc).toArray(c, i * 3);
  geo.setAttribute("color", new THREE.BufferAttribute(c, 3)); return geo;
}

/* ---------------- environment: studio strips so the black paint has highlights ---------------- */
{
  const pmrem = new THREE.PMREMGenerator(renderer), env = new THREE.Scene();
  env.add(new THREE.Mesh(new THREE.SphereGeometry(30, 32, 16), new THREE.MeshBasicMaterial({ color: 0x07080e, side: THREE.BackSide })));
  [[0xffffff, 0, 14, 0, 3.2, 16, 3], [0x4796e3, -12, 5, 6, 2.6, 10, 5], [0xca6673, 12, 4, -6, 2.4, 10, 5], [0x9177c7, 0, 3, -13, 2, 14, 4], [0xffffff, 10, 6, 9, 1.6, 6, 6]].forEach(([c, x, y, z, k, w, h]) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k), side: THREE.DoubleSide }));
    m.position.set(x, y, z); m.lookAt(0, 0, 0); env.add(m);
  });
  scene.environment = pmrem.fromScene(env, 0.03).texture;
}
scene.add(new THREE.HemisphereLight(0x8fb0ff, 0x120a18, 0.4));
const moon = new THREE.DirectionalLight(0xc8d4ff, 1.4); moon.position.set(-6, 10, 8); scene.add(moon);
const rimBlue = new THREE.DirectionalLight(0x4796e3, 1.6); rimBlue.position.set(-8, 3, -6); scene.add(rimBlue);
const rimRose = new THREE.DirectionalLight(0xca6673, 0.7); rimRose.position.set(8, 2, -5); scene.add(rimRose);
// studio key light that travels with the camera, so the black bike reads like a product shot
const keyLight = new THREE.DirectionalLight(0xf2f4ff, 1.7); scene.add(keyLight, keyLight.target);

const sky = new THREE.Mesh(new THREE.SphereGeometry(300, 48, 24), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  vertexShader: "varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }",
  fragmentShader: `varying vec3 vP;
    void main(){
      vec3 c = vec3(0.012,0.014,0.03);
      c += vec3(0.10,0.25,0.55) * pow(max(0., 1. - abs(vP.y - 0.05) * 4.), 3.) * 0.35;
      c += vec3(0.45,0.28,0.65) * smoothstep(0.75, 1., dot(vP, normalize(vec3(0.6,0.25,-0.7)))) * 0.5;
      c += vec3(0.60,0.22,0.30) * smoothstep(0.8, 1., dot(vP, normalize(vec3(-0.7,0.15,-0.6)))) * 0.35;
      gl_FragColor = vec4(c * 0.45, 1.);
    }`
}));
scene.add(sky);
{
  const n = LITE ? 1200 : 2500, pos = new Float32Array(n * 3), col = new Float32Array(n * 3), tc = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const u = rnd() * 2 - 1, th = rnd() * Math.PI * 2, r = Math.sqrt(1 - u * u);
    new THREE.Vector3(r * Math.cos(th), Math.abs(u) * 0.9 + 0.05, r * Math.sin(th)).multiplyScalar(250).toArray(pos, i * 3);
    gem(rnd(), tc).lerp(new THREE.Color(1, 1, 1), 0.5).multiplyScalar(0.5 + rnd() * 0.8).toArray(col, i * 3);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  scene.add(new THREE.Points(g, new THREE.PointsMaterial({ size: 1.4, map: GLOW, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })));
}

// Neon ground grid with a road
const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600, 1, 1), new THREE.ShaderMaterial({
  transparent: true, depthWrite: false,
  uniforms: { uCam: { value: new THREE.Vector3() } },
  vertexShader: "varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }",
  fragmentShader: `varying vec3 vW; uniform vec3 uCam;
    float line(float v, float w){ float d = abs(fract(v - 0.5) - 0.5) / fwidth(v); return 1. - min(d / w, 1.); }
    void main(){
      vec2 p = vW.xz;
      float g = max(line(p.x / 2., 1.), line(p.y / 2., 1.)) * 0.35;
      float road = smoothstep(1.6, 1.5, abs(p.y)) * (1. - step(72., p.x)) * step(-30., p.x);
      float edge = line((p.y + 1.55) / 3.1, 1.6) * road;
      float dash = step(0.5, fract(p.x / 3.)) * smoothstep(0.08, 0.02, abs(p.y)) * road;
      float t = clamp((p.x + 10.) / 80., 0., 1.);
      vec3 gc = mix(vec3(0.28,0.59,0.89), mix(vec3(0.57,0.47,0.78), vec3(0.79,0.40,0.45), clamp(t*2.-1.,0.,1.)), clamp(t*2.,0.,1.));
      vec3 c = gc * g * 0.55 + gc * edge * 1.8 + vec3(0.9) * dash * 0.5 + vec3(0.02,0.025,0.05) * road;
      float fade = exp(-distance(vW, uCam) * 0.03);
      gl_FragColor = vec4(c * fade, (g * 0.6 + edge + dash + road * 0.6) * fade);
    }`
}));
ground.rotation.x = -Math.PI / 2; scene.add(ground);

// Roadside light posts
{
  const N = 2 * 34;
  const posts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.03, 0.04, 2.2, 8).translate(0, 1.1, 0), new THREE.MeshStandardMaterial({ color: 0x1b1f2e, metalness: 0.8, roughness: 0.3 }), N);
  const caps = new THREE.InstancedMesh(new THREE.SphereGeometry(0.09, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }), N);
  const d = new THREE.Object3D(), tc = new THREE.Color();
  for (let i = 0; i < N; i++) {
    const side = i % 2 ? 1 : -1, x = -24 + Math.floor(i / 2) * 3;
    if (Math.abs(x) < 4.5) { d.position.set(0, -50, 0); d.updateMatrix(); posts.setMatrixAt(i, d.matrix); caps.setMatrixAt(i, d.matrix); continue; } // keep the showroom spot clear
    d.position.set(x, 0, side * 3.2); d.updateMatrix(); posts.setMatrixAt(i, d.matrix);
    d.position.y = 2.25; d.updateMatrix(); caps.setMatrixAt(i, d.matrix); caps.setColorAt(i, gem((x + 24) / 100, tc).multiplyScalar(2.2));
  }
  scene.add(posts, caps);
}

// Ramp and landing pad
{
  const s = new THREE.Shape(); s.moveTo(0, 0); s.lineTo(6, 1.2); s.lineTo(6, 0); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 2.6, bevelEnabled: false }); g.translate(0, 0, -1.3);
  const ramp = new THREE.Group();
  ramp.add(new THREE.Mesh(g, new THREE.MeshPhysicalMaterial({ color: 0x10131f, metalness: 0.5, roughness: 0.35, clearcoat: 1 })));
  ramp.add(new THREE.LineSegments(new THREE.EdgesGeometry(g), new THREE.LineBasicMaterial({ color: new THREE.Color(0x9177c7).multiplyScalar(2) })));
  ramp.position.x = 26; scene.add(ramp);
}
const pad = new THREE.Mesh(new THREE.RingGeometry(1.4, 1.55, 64), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xca6673).multiplyScalar(2), transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
pad.rotation.x = -Math.PI / 2; pad.position.set(46, 0.01, 0); scene.add(pad);

// Sparkle monument in the drift circle
const sparkleGeo = (() => {
  const s = new THREE.Shape(), k = 0.13; s.moveTo(0, 1); s.quadraticCurveTo(k, k, 1, 0); s.quadraticCurveTo(k, -k, 0, -1); s.quadraticCurveTo(-k, -k, -1, 0); s.quadraticCurveTo(-k, k, 0, 1);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.25, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.05, bevelSegments: 5, curveSegments: 40 }); g.center();
  return paintGradient(g, new THREE.Vector3(1, -1, 0).normalize());
})();
const iri = () => new THREE.MeshPhysicalMaterial({ color: 0xffffff, vertexColors: true, metalness: 0.3, roughness: 0.15, clearcoat: 1, iridescence: 0.8, emissive: 0x2a2050, emissiveIntensity: 0.6, envMapIntensity: 1.5 });
const CIRCLE = new THREE.Vector3(52, 0, -7), R = 7;
const monument = new THREE.Mesh(sparkleGeo, iri()); monument.scale.setScalar(2.6); monument.position.set(CIRCLE.x, 3.4, CIRCLE.z); scene.add(monument);
const monGlow = sprite(0x8a7fe0, 14, 0.5); monGlow.position.copy(monument.position); scene.add(monGlow);
const monLight = new THREE.PointLight(0x9177c7, 60, 30, 1.6); monLight.position.copy(monument.position); scene.add(monLight);
{
  const track = new THREE.Mesh(new THREE.RingGeometry(R - 1.5, R + 1.5, 128), new THREE.MeshBasicMaterial({ color: 0x0b0d18, transparent: true, opacity: 0.9 }));
  track.rotation.x = -Math.PI / 2; track.position.set(CIRCLE.x, 0.005, CIRCLE.z); scene.add(track);
  [R - 1.5, R + 1.5].forEach((r, i) => { const m = new THREE.Mesh(new THREE.RingGeometry(r - 0.04, r + 0.04, 160), new THREE.MeshBasicMaterial({ color: (i ? ROSE : BLUE).clone().multiplyScalar(2.2) })); m.rotation.x = -Math.PI / 2; m.position.set(CIRCLE.x, 0.01, CIRCLE.z); scene.add(m); });
}
const floaters = [];
for (let i = 0; i < (LITE ? 7 : 14); i++) { const m = new THREE.Mesh(sparkleGeo, iri()); m.scale.setScalar(0.4 + rnd() * 0.9); m.position.set(-20 + rnd() * 100, 3 + rnd() * 9, -14 - rnd() * 22); scene.add(m); floaters.push(m); }

/* ---------------- the motorcycle ---------------- */
const bike = new THREE.Group(); bike.rotation.order = "YZX"; scene.add(bike);
let B = buildBike(); bike.add(B.bike);
const body = B.bike; // everything that follows the bike lives in its (scaled) space

const ledGlow = sprite(0xdfe8ff, 0.45, 0); ledGlow.position.set(1.02, 0.75, 0); body.add(ledGlow);
const beam = new THREE.Mesh(new THREE.ConeGeometry(1.1, 5.5, 32, 1, true).translate(0, -2.75, 0), new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  uniforms: { uI: { value: 0 } },
  vertexShader: "varying float vY; void main(){ vY = position.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }",
  fragmentShader: "varying float vY; uniform float uI; void main(){ float a = smoothstep(-5.5, 0., vY) * 0.13 * uI; gl_FragColor = vec4(vec3(0.75,0.85,1.) * a, a); }"
}));
beam.rotation.z = Math.PI / 2 + 0.08; beam.position.set(1.04, 0.75, 0); body.add(beam);
const spot = new THREE.SpotLight(0xdfe8ff, 0, 30, 0.45, 0.6, 1.2); spot.position.set(1.04, 0.76, 0); body.add(spot); spot.target.position.set(6, 0, 0); body.add(spot.target);
const tailGlow = sprite(0xff3355, 0.5, 0.7); tailGlow.position.set(-1.0, 1.01, 0); body.add(tailGlow);
const under = new THREE.PointLight(0x7d84a6, 2.2, 4, 2); under.position.set(0, 0.2, 0); body.add(under);
const underGlow = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.8), new THREE.MeshBasicMaterial({ map: GLOW, color: new THREE.Color(0x9177c7).multiplyScalar(1.4), transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false }));
underGlow.rotation.x = -Math.PI / 2; underGlow.position.y = 0.01; body.add(underGlow);

// Exhaust flames: three nested noise cones, a flickering light and embers
const flameMat = (inner) => new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  uniforms: { uT: { value: 0 }, uP: { value: 0 }, uInner: { value: inner } },
  vertexShader: `varying vec2 vUv; uniform float uT, uP;
    void main(){ vUv = uv; vec3 p = position; float k = 1. - uv.y;
      p.xz *= 1. + 0.25 * sin(uT * 40. + uv.y * 12.) * k;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.); }`,
  fragmentShader: `varying vec2 vUv; uniform float uT, uP, uInner;
    float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
      return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
    void main(){
      float along = 1. - vUv.y;                       // 0 at the pipe, 1 at the tip
      float fl = n(vec2(vUv.x * 6., along * 5. - uT * 9.)) * 0.6 + n(vec2(vUv.x * 13., along * 11. - uT * 15.)) * 0.4;
      float a = smoothstep(1., 0.15, along + fl * 0.45) * uP;
      vec3 hot = mix(vec3(0.45, 0.65, 1.6), vec3(1.8, 1.25, 0.6), smoothstep(0.0, 0.35, along));
      vec3 c = mix(hot, vec3(1.5, 0.35, 0.08), smoothstep(0.3, 0.9, along + fl * 0.2));
      c = mix(c, vec3(0.6, 0.8, 2.0), uInner * (1. - smoothstep(0., 0.4, along)));
      gl_FragColor = vec4(c * a, a);
    }`
});
const flames = new THREE.Group(); body.add(flames);
const flameLayers = [[0.09, 0.9, 0], [0.065, 0.65, 0.5], [0.04, 0.42, 1]].map(([r, len, inner]) => {
  const m = new THREE.Mesh(new THREE.ConeGeometry(r, len, 24, 8, true).translate(0, -len / 2, 0), flameMat(inner));
  m.userData.len = len; flames.add(m); return m;
});
{
  const tip = B.exhaustTip.getWorldPosition(new THREE.Vector3()); body.worldToLocal(tip);
  flames.position.copy(tip);
  flames.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), B.exhaustDir.clone().normalize());
}
const flameLight = new THREE.PointLight(0xff7a2a, 0, 6, 2); flames.add(flameLight); flameLight.position.set(0, -0.2, 0);
const flameGlow = sprite(0xff8a3a, 1.4, 0); flames.add(flameGlow); flameGlow.position.set(0, -0.25, 0);

/* ---------------- trail, sparks, smoke, embers ---------------- */
const TRAIL = 110, trailPts = [];
const trailGeo = new THREE.BufferGeometry();
const trailPos = new Float32Array(TRAIL * 2 * 3), trailCol = new Float32Array(TRAIL * 2 * 3);
trailGeo.setAttribute("position", new THREE.BufferAttribute(trailPos, 3)); trailGeo.setAttribute("color", new THREE.BufferAttribute(trailCol, 3));
{ const idx = []; for (let i = 0; i < TRAIL - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } trailGeo.setIndex(idx); }
const trail = new THREE.Mesh(trailGeo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
trail.frustumCulled = false; scene.add(trail);

const SP = LITE ? 300 : 700, spPos = new Float32Array(SP * 3), spCol = new Float32Array(SP * 3), sparks = [];
for (let i = 0; i < SP; i++) sparks.push({ p: new THREE.Vector3(0, -99, 0), v: new THREE.Vector3(), life: 0, ember: false });
const spGeo = new THREE.BufferGeometry(); spGeo.setAttribute("position", new THREE.BufferAttribute(spPos, 3)); spGeo.setAttribute("color", new THREE.BufferAttribute(spCol, 3));
const spPoints = new THREE.Points(spGeo, new THREE.PointsMaterial({ size: 0.09, map: GLOW, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
spPoints.frustumCulled = false; scene.add(spPoints);
let spNext = 0;
function spawnSparks(at, n, dir, spread, speed, ember = false) {
  for (let k = 0; k < n; k++) {
    const s = sparks[spNext++ % SP]; s.p.copy(at); s.ember = ember;
    s.v.set(dir.x + (rnd() - 0.5) * spread, dir.y + rnd() * spread, dir.z + (rnd() - 0.5) * spread).normalize().multiplyScalar(speed * (0.4 + rnd()));
    s.life = ember ? 0.25 + rnd() * 0.4 : 0.4 + rnd() * 0.7;
  }
}
const SM = LITE ? 35 : 70, smoke = [];
for (let i = 0; i < SM; i++) { const s = sprite(0x8890b0, 1, 0); s.material.blending = THREE.NormalBlending; scene.add(s); smoke.push({ s, life: 0, max: 1, v: new THREE.Vector3() }); }
let smNext = 0;
function spawnSmoke(at, n) {
  for (let k = 0; k < n; k++) { const o = smoke[smNext++ % SM]; o.s.position.copy(at).add(tmpV2.set((rnd() - 0.5) * 0.3, 0.1, (rnd() - 0.5) * 0.3)); o.v.set((rnd() - 0.5) * 0.8, 0.5 + rnd() * 0.6, (rnd() - 0.5) * 0.8); o.max = o.life = 1.2 + rnd(); }
}

/* ---------------- post-processing ---------------- */
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const afterimage = new AfterimagePass(0); if (!LITE && !REDUCED) composer.addPass(afterimage);
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.75, 0.5, 0.55); composer.addPass(bloom);
const fx = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uAb: { value: 0 } },
  vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }",
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uAb; varying vec2 vUv;
    void main(){ vec2 d = vUv - .5; float r = dot(d,d);
      vec3 c; c.r = texture2D(tDiffuse, vUv + d * uAb * r * 2.).r; c.g = texture2D(tDiffuse, vUv).g; c.b = texture2D(tDiffuse, vUv - d * uAb * r * 2.).b;
      c *= 1. - r * 0.9; gl_FragColor = vec4(c, 1.); }`
});
composer.addPass(fx);
composer.addPass(new OutputPass());

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false); composer.setSize(w, h);
  if (LITE || perf.level) bloom.resolution.set(w / (perf.level > 1 ? 4 : 2), h / (perf.level > 1 ? 4 : 2));
  camera.aspect = w / h; PORTRAIT = w / h < 0.8;
  camera.fov = w / h < 0.8 ? 55 : 42; // portrait phones need a wider view
  camera.updateProjectionMatrix();
}
resize(); addEventListener("resize", resize);

/* ---------------- choreography ----------------
   p runs from 0 to 4 down the page. Whole numbers are the parked spots (hero, about, projects, skills,
   contact): the bike sits on the ground there. Each step between two spots is one full stunt that lands. */
const easeIO = (u) => u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
const RAMP_A = Math.atan2(1.2, 6);
const REST = [{ x: 0, yaw: -2.25 }, { x: 14, yaw: -0.5 }, { x: 48, yaw: 0.45 }, { x: 57, yaw: -0.5 }, { x: 64.5, yaw: -Math.PI / 2 }];
const LAST = REST.length - 1;
// camera and look-at for each parked spot, relative to the bike
function restOffsets(i, cam, look) {
  if (PORTRAIT && i < LAST) { cam.set(0, 1.5, 7.6); look.set(0, 0.7, 0); return; } // phone: bike centred; the view shift parks it under the words
  if (i === 0) { cam.set(-1.3, 1.35, 6.8); look.set(-1.75, 0.75, 0); return; }
  if (i === LAST) { cam.set(0, 1.6, 6.6); look.set(0, PORTRAIT ? 1.7 : 2.0, 0); return; }
  cam.set(-1.2, 1.6, 7.2); look.set(i === 2 ? -1.2 : -2.0, i === 2 ? -0.3 : 0.7, 0);
}
const oc0 = new THREE.Vector3(), ol0 = new THREE.Vector3(), oc1 = new THREE.Vector3(), ol1 = new THREE.Vector3();
function ride(p, t) {
  const S = { pos: new THREE.Vector3(), yaw: 0, pitch: 0, roll: 0, speed: 0, rpm: 1250, throttle: 0, smoke: 0, sparks: 0, seg: "R", cam: new THREE.Vector3(), look: new THREE.Vector3(), boost: 0, air: false, rest: false, high: 0 };
  p = clamp(p, 0, LAST);
  const i = Math.min(LAST - 1, Math.floor(p)), u = p - i;
  if (u < 1e-4 || p >= LAST - 1e-4) { // parked
    const k = p >= LAST - 1e-4 ? LAST : i, r = REST[k];
    S.rest = true; S.pos.set(r.x, 0, 0); S.yaw = r.yaw + Math.sin(t * 0.6) * 0.03;
    restOffsets(k, S.cam, S.look); S.cam.add(S.pos); S.look.add(S.pos);
    return S;
  }
  if (i === 0) { // burnout spin, then a wheelie launch
    S.seg = "A";
    const a = smooth(0, 0.35, u), b = clamp((u - 0.35) / 0.65, 0, 1);
    S.yaw = -2.25 + (2.25 + Math.PI * 2) * easeIO(a) + REST[1].yaw * smooth(0.85, 1, u);
    S.pos.x = 14 * easeIO(b);
    const wheelie = 0.5 * smooth(0.05, 0.2, b) * (1 - smooth(0.5, 0.75, b));
    S.pos.y = 0.75 * Math.sin(wheelie); S.pitch = wheelie;
    if (u < 0.35) { S.speed = 0.35 * Math.sin(Math.PI * a); S.rpm = 1250 + 7000 * Math.sin(Math.PI * a); S.throttle = Math.sin(Math.PI * a); S.smoke = a > 0.02 && a < 0.98 ? 1 : 0; S.boost = 0.6 * Math.sin(Math.PI * a); }
    else { const g = b * 3, f = g - Math.floor(g); S.speed = Math.sin(Math.PI * b); S.rpm = 5200 + 5000 * Math.pow(f, 0.7) * (1 - b * 0.6); S.throttle = b < 0.6 ? 1 : 0.2; S.boost = Math.sin(Math.PI * b); S.sparks = wheelie > 0.3 ? 0.4 : 0; }
  } else if (i === 1) { // up the ramp, backflip, land
    if (u < 0.38) {
      S.seg = "B"; const s = u / 0.38;
      S.pos.x = 14 + 18 * s * s; S.yaw = REST[1].yaw * (1 - smooth(0, 0.2, s));
      const on = clamp((S.pos.x - 26) / 6, 0, 1); S.pos.y = 1.2 * on; S.pitch = on > 0 ? RAMP_A : 0;
      S.speed = 0.4 + 0.6 * s; S.rpm = 6000 + 5000 * s; S.throttle = 1; S.boost = smooth(0, 0.3, s);
    } else if (u < 0.8) {
      S.seg = "C"; S.air = true; const v = (u - 0.38) / 0.42;
      S.pos.set(32 + 14 * v, 1.2 * (1 - v) + 6 * Math.sin(Math.PI * v), 0);
      S.pitch = RAMP_A * (1 - smooth(0, 0.15, v)) + Math.PI * 2 * smooth(0.1, 0.88, v);
      S.yaw = 0.35 * Math.sin(Math.PI * v) ** 2; S.roll = -0.25 * Math.sin(2 * Math.PI * v);
      S.speed = 0.9; S.rpm = 11800 - 2500 * v; S.throttle = 0.3; S.boost = 1 - v * 0.7;
    } else {
      S.seg = "B"; const q = (u - 0.8) / 0.2;
      S.pos.x = 46 + 2 * (1 - (1 - q) * (1 - q)); S.yaw = REST[2].yaw * smooth(0.3, 1, q);
      S.speed = 0.9 * (1 - q); S.rpm = 1250 + 8000 * (1 - q); S.throttle = 0.2 * (1 - q);
      S.smoke = q < 0.45 ? 1 : 0; S.sparks = q < 0.4 ? 0.6 : 0;
    }
  } else if (i === 2) { // drift a full circle round the sparkle
    S.seg = "D"; S.high = smooth(0, 0.15, u) * (1 - smooth(0.85, 1, u));
    if (u < 0.1) { const s = u / 0.1; S.pos.x = 48 + 4 * s; S.yaw = REST[2].yaw * (1 - s); }
    else if (u < 0.85) {
      const al = Math.PI * 2 * (u - 0.1) / 0.75, env = smooth(0.1, 0.22, u) * (1 - smooth(0.73, 0.85, u));
      S.pos.set(CIRCLE.x + R * Math.sin(al), 0, CIRCLE.z + R * Math.cos(al));
      S.yaw = al + 0.55 * env; S.roll = -0.62 * env; S.smoke = env > 0.4 ? 1 : 0; S.sparks = env > 0.6 ? 0.25 : 0;
    } else { const q = (u - 0.85) / 0.15; S.pos.x = 52 + 5 * (1 - (1 - q) * (1 - q)); S.yaw = Math.PI * 2 + REST[3].yaw * smooth(0.4, 1, q); }
    S.speed = 0.75 * (u > 0.85 ? 1 - (u - 0.85) / 0.15 : 1); S.rpm = 1250 + 7400 * S.speed / 0.75 + 600 * Math.sin(u * 38); S.throttle = 0.8 * S.speed / 0.75; S.boost = 0.45 * S.speed / 0.75;
  } else { // power-slide to a stop, facing you
    S.seg = "E";
    if (u < 0.4) { const s = u / 0.4; S.pos.x = 57 + 3 * s * s; S.yaw = REST[3].yaw * (1 - smooth(0, 1, s)); S.speed = 0.3 + 0.45 * s; S.rpm = 5000 + 4000 * s; S.throttle = 1; S.boost = 0.6 * s; }
    else {
      const q = (u - 0.4) / 0.6, k = 1 - (1 - q) * (1 - q);
      S.pos.x = 60 + 4.5 * k; S.yaw = -(Math.PI / 2) * smooth(0.05, 0.6, q); S.roll = 0.38 * Math.sin(Math.PI * smooth(0, 0.6, q));
      S.speed = 0.75 * (1 - k); S.rpm = 1250 + 7200 * (1 - k); S.throttle = 0.2 * (1 - k);
      S.smoke = q > 0.03 && q < 0.6 ? 1 : 0; S.sparks = q > 0.03 && q < 0.5 ? 1 : 0;
    }
  }
  // camera follows the bike, blending from this spot's framing to the next one's
  const e = easeIO(u);
  restOffsets(i, oc0, ol0); restOffsets(i + 1, oc1, ol1);
  S.cam.copy(oc0).lerp(oc1, e).add(S.pos); S.look.copy(ol0).lerp(ol1, e).add(S.pos);
  S.cam.y -= S.pos.y * 0.4; S.look.y -= S.pos.y * 0.2;
  if (S.air) { const v = (u - 0.38) / 0.42, sw = Math.sin(Math.PI * v); S.cam.x += 4 * sw; S.cam.z += 3 * sw; S.cam.y += 2.2 * sw; }
  if (S.high > 0 && PORTRAIT) {
    // phones are too narrow for the whole ring: ride along just outside it, looking in at the bike
    const dx = S.pos.x - CIRCLE.x, dz = S.pos.z - CIRCLE.z, l = Math.hypot(dx, dz) || 1;
    tmpV.set(CIRCLE.x + dx / l * (R + 6.5), 3.2, CIRCLE.z + dz / l * (R + 6.5)); S.cam.lerp(tmpV, S.high);
    S.look.lerp(tmpV.set(S.pos.x, 0.6, S.pos.z), S.high);
  } else if (S.high > 0) {
    const b = -0.5 + u;
    tmpV.set(CIRCLE.x + 13 * Math.sin(b), 11.5, CIRCLE.z + 13 * Math.cos(b)); S.cam.lerp(tmpV, S.high);
    S.look.lerp(tmpV.set(CIRCLE.x, 0.6, CIRCLE.z), S.high);
  }
  return S;
}

/* ---------------- sound: one bike, one recording ----------------
   Everything comes from a single take of a ZX-6R (Mani's "Kawasaki Ninja Burnout" upload), cut into short
   loops at four engine speeds. Like a racing game, the revs pick the two nearest loops, blend them and
   re-pitch them to match, so the same engine idles, blips and climbs. The revs rise fast and fall back slower,
   the way a real throttle does, and the tone opens up under load. Each loop file has 0.15 s of its own wrap as
   padding either side, so it loops cleanly whatever start delay the decoder adds. Nothing downloads until
   sound is turned on. */
const AUDIO = "assets/audio/engine-";
const ENGINE = [["idle", 1230, 0.75], ["mid", 5340, 0.95], ["high", 8900, 0.65], ["top", 12300, 0.9]]; // loop, rpm it was recorded at (inline four: 30 x firing Hz), loop length
const snd = { ctx: null, on: false, layers: [], rpm: 1230, load: 0, last: 0 };
function initAudio() {
  const ctx = new (window.AudioContext || window.webkitAudioContext)(); snd.ctx = ctx;
  const master = ctx.createGain(); master.gain.value = 0; snd.master = master;
  const tone = ctx.createBiquadFilter(); tone.type = "lowpass"; tone.frequency.value = 2000; tone.Q.value = 0.5; snd.tone = tone;
  tone.connect(master).connect(ctx.destination);
  snd.ready = Promise.all(ENGINE.map(([n, , len]) => fetch(AUDIO + n + ".mp3").then((r) => r.arrayBuffer())
    .then((a) => new Promise((ok, no) => ctx.decodeAudioData(a, ok, no))).then((buf) => {
      const src = ctx.createBufferSource(), g = ctx.createGain();
      src.buffer = buf; src.loop = true; src.loopStart = 0.15; src.loopEnd = 0.15 + len;
      g.gain.value = 0; src.connect(g).connect(tone); src.start(0, 0.15);
      return { src, g };
    }))).then((l) => { snd.layers = l; }).catch(() => {});
}
function audioTick(S) {
  if (!snd.on || !snd.layers.length) return;
  const now = snd.ctx.currentTime, dt = clamp(now - snd.last, 0, 0.5); snd.last = now;
  const want = clamp(S.rpm, 1100, 12800);
  snd.rpm += (want - snd.rpm) * (1 - Math.exp(-dt * (want > snd.rpm ? 9 : 3.2))); // up in ~0.2 s, down in ~0.8 s
  snd.load += (clamp(S.throttle, 0, 1) - snd.load) * (1 - Math.exp(-dt * 8));
  // the two loops either side of the revs, blended evenly on a log scale; each re-pitched to the revs
  let i = 0; while (i < ENGINE.length - 2 && snd.rpm > ENGINE[i + 1][1]) i++;
  const x = clamp(Math.log(snd.rpm / ENGINE[i][1]) / Math.log(ENGINE[i + 1][1] / ENGINE[i][1]), 0, 1);
  snd.layers.forEach((l, k) => {
    const g = k === i ? Math.cos(x * Math.PI / 2) : k === i + 1 ? Math.sin(x * Math.PI / 2) : 0;
    l.want = g; l.g.gain.setTargetAtTime(g, now, 0.03);
    l.src.playbackRate.setTargetAtTime(clamp(snd.rpm / ENGINE[k][1], 0.5, 2.5), now, 0.03);
  });
  snd.tone.frequency.setTargetAtTime(1200 + 5500 * snd.load + snd.rpm * 0.3, now, 0.05);
  snd.master.gain.setTargetAtTime(0.9 * (0.55 + 0.45 * snd.load), now, 0.08);
}
const soundBtn = document.getElementById("sound");
if (soundBtn) {
  soundBtn.hidden = false;
  soundBtn.addEventListener("click", () => {
    if (!snd.ctx) initAudio();
    snd.on = !snd.on; snd.ctx.resume();
    if (!snd.on) snd.master.gain.setTargetAtTime(0, snd.ctx.currentTime, 0.1);
    soundBtn.setAttribute("aria-pressed", String(snd.on));
    soundBtn.querySelector("span").textContent = snd.on ? "Sound on" : "Sound off";
  });
  document.addEventListener("visibilitychange", () => { if (!snd.ctx) return; if (document.hidden) snd.ctx.suspend(); else if (snd.on) snd.ctx.resume(); });
}

/* ---------------- scroll → progress: parked spots at the hero, about, projects and skills tops and the page bottom ---------------- */
const stopEls = ["hero", "about", "projects", "skills"].map((id) => document.getElementById(id)).filter(Boolean);
let marks = [];
function measure() {
  const y0 = scrollY;
  marks = stopEls.map((s) => s.getBoundingClientRect().top + y0);
  marks.push(Math.max(marks[marks.length - 1] + 1, document.documentElement.scrollHeight - innerHeight));
}
function progressAt(y) {
  if (marks.length < 2) return 0;
  let p = LAST;
  for (let i = 0; i < marks.length - 1; i++) if (y < marks[i + 1]) { p = clamp(i + (y - marks[i]) / Math.max(1, marks[i + 1] - marks[i]), 0, LAST); break; }
  return Math.abs(p - Math.round(p)) < 0.004 ? Math.round(p) : p; // within a few pixels of a section = parked there
}
measure(); addEventListener("resize", measure); addEventListener("load", measure);
new ResizeObserver(measure).observe(document.body);

// Gentle scrolling revs the parked bike (ui.js decides gentle vs hard)
let revTarget = 0, rev = 0, lastRev = -1e9;
window.__rideRev = (amount) => { revTarget = clamp(revTarget + amount, -1, 1); lastRev = performance.now(); };

let scrollP = progressAt(scrollY), smoothP = scrollP, lastScroll = performance.now();
addEventListener("scroll", () => { scrollP = progressAt(scrollY); lastScroll = performance.now(); }, { passive: true });
const pointer = { x: 0, y: 0 };
addEventListener("pointermove", (e) => { pointer.x = e.clientX / innerWidth * 2 - 1; pointer.y = -(e.clientY / innerHeight * 2 - 1); }, { passive: true });

/* ---------------- frame ---------------- */
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
let shake = 0, lastSeg = null, wasAir = false, wasRest = null, ignite = 0, idleW = 0, orbitA = 0, firstFrame = true, blip = 0, nextBlip = 1.5, flash = 0;
const flashEl = document.getElementById("flash");
let lastState = null, lastFrameMs = performance.now(), viewShift = 0, modelReady = false, modelHolder = null;

// Riding back up the page: instead of reversing, the bike swings round to face the way it's going, rides the
// route forward-facing (flips and wheelies still read right, since the spin and the heading both reverse),
// then turns back to its parked angle as it arrives.
const back = { on: null, from: 0, sign: 0, yaw: 0 };
const wrapA = (a) => Math.atan2(Math.sin(a), Math.cos(a));
function turnBack(S, p) {
  if (S.rest) { back.on = null; back.from = p; back.sign = 0; return; }
  if (back.on === null) { back.on = scrollP < p - 1e-4; back.yaw = S.yaw + Math.PI; } // decided once per ride
  if (!back.on) return;
  const to = Math.min(p, typeof window.__rideTo === "number" ? progressAt(window.__rideTo) : scrollP), q = clamp((back.from - p) / Math.max(1e-3, back.from - to), 0, 1);
  const a = ride(Math.max(0, p - 0.004), 0).pos, m = tmpV2.subVectors(a, S.pos).setY(0);
  if (m.lengthSq() > 1e-6) back.yaw = Math.atan2(-m.z, m.x); // heading of travel (moving toward smaller p)
  const w = smooth(0, 0.12, q) * (1 - smooth(0.86, 1, q));
  let d = wrapA(back.yaw - S.yaw);
  if (!back.sign) back.sign = Math.sign(d) || 1;
  if (Math.abs(d) > 2.4 && Math.sign(d) !== back.sign) d += back.sign * Math.PI * 2; // keep turning the same way round
  S.yaw += d * w;
  S.roll -= back.sign * 0.32 * (Math.sin(Math.PI * clamp(q / 0.12, 0, 1)) + Math.sin(Math.PI * clamp((q - 0.86) / 0.14, 0, 1))); // lean into the turns
}

function frame(t, dt, p) {
  ignite = clamp(ignite + dt * 1.6, 0, 1);
  // snap the last tiny bit so the bike settles exactly on its parked spot
  if (scrollP === Math.round(scrollP) && Math.abs(scrollP - p) < 0.006) p = scrollP;
  const S = ride(p, t);
  turnBack(S, p);

  // Rev: rolls the parked bike back and forth with throttle, flames and smoke
  const nowMs = performance.now(), rdt = Math.min((nowMs - lastFrameMs) / 1000, 0.25); lastFrameMs = nowMs; // wall-clock, so rev settles on time on slow devices too
  if (nowMs - lastRev > 250) revTarget *= Math.exp(-rdt * 5);
  rev += ((S.rest ? revTarget : 0) - rev) * (1 - Math.exp(-rdt * 9));
  if (Math.abs(rev) > 0.01) {
    const fw = tmpV.set(Math.cos(S.yaw), 0, -Math.sin(S.yaw)).multiplyScalar(rev * 1.8);
    S.pos.add(fw); S.cam.addScaledVector(fw, 0.45); S.look.addScaledVector(fw, 0.7);
    const a = Math.abs(rev);
    S.speed = Math.max(S.speed, a * 0.8); S.rpm = Math.max(S.rpm, 1250 + 9500 * a); S.throttle = Math.max(S.throttle, a);
    S.boost = Math.max(S.boost, Math.max(0, rev) * 1.1); S.pitch += 0.28 * smooth(0.55, 1, rev);
    if (a > 0.8) S.smoke = 1;
  }

  // Parked: the camera circles the bike like a showroom; the engine idles quietly with the odd blip
  const idle = !REDUCED && S.rest && nowMs - lastScroll > 700 && nowMs - lastRev > 900 && Math.abs(rev) < 0.02;
  idleW += ((idle ? 1 : 0) - idleW) * (1 - Math.exp(-dt * (idle ? 0.9 : 4)));
  if (idleW < 0.01) orbitA = Math.atan2(camPos.x - S.pos.x, camPos.z - S.pos.z);
  orbitA += dt * 0.32 * idleW;
  if (idle && S.speed < 0.5) {
    nextBlip -= dt;
    if (nextBlip < 0) { blip = 0.6; nextBlip = 5 + rnd() * 4; }
  }
  blip *= Math.exp(-dt * 3.5);
  S.rpm += blip * 6000 * idleW; S.throttle = Math.max(S.throttle, blip * idleW);

  // events
  if (wasAir && !S.air) { shake = 0.35; spawnSparks(tmpV.copy(S.pos).setY(0.05), 140, new THREE.Vector3(-1, 0.6, 0), 1.6, 9); spawnSmoke(S.pos, 10); flash = 0.18; }
  wasAir = S.air; wasRest = S.rest; lastSeg = S.seg;

  // bike transform
  bike.position.copy(S.pos);
  bike.rotation.set(S.roll, S.yaw, S.pitch);
  body.position.y = (1 - S.speed) * 0.006 * Math.sin(t * 90) + S.rpm / 12000 * 0.004 * Math.sin(t * 140);
  const roll = (S.speed * 26 * (rev < -0.05 && S.rest ? -1 : 1) + 2) * dt; B.wheels[0].rotation.z -= roll; B.wheels[1].rotation.z -= roll * (S.smoke ? 2.2 : 1);

  // lights
  const lamp = ignite;
  ledGlow.material.opacity = lamp * 0.6; beam.material.uniforms.uI.value = lamp; spot.intensity = lamp * 40;
  tailGlow.material.opacity = 0.5 + (S.rest ? 0.35 : 0) + 0.3 * clamp(rev, 0, 1);

  // flames: steady with boost, plus random crackle and blips
  const crackle = (S.throttle > 0.5 && rnd() < 0.08) ? 0.6 : 0;
  const power = clamp(S.boost * 0.9 + crackle + blip * idleW * 1.2, 0, 1.4);
  flameLayers.forEach((m, i) => {
    m.material.uniforms.uT.value = t; m.material.uniforms.uP.value = power * (1.1 - i * 0.15);
    m.scale.set(1, 0.35 + power * (0.9 + 0.2 * Math.sin(t * 50 + i)), 1);
  });
  flameLight.intensity = power * 22 * (0.8 + 0.2 * Math.sin(t * 70)); flameGlow.material.opacity = power * 0.75;
  if (power > 0.3 && rnd() < power * 0.7) {
    const tip = flames.getWorldPosition(tmpV);
    const dir = tmpV2.copy(B.exhaustDir).applyQuaternion(body.getWorldQuaternion(new THREE.Quaternion()));
    spawnSparks(tip, 2, dir, 0.8, 3 + power * 4, true);
  }

  // tail-light trail
  bike.updateMatrixWorld();
  const tp = B.tail.getWorldPosition(new THREE.Vector3());
  if (firstFrame) for (let i = 0; i < TRAIL; i++) trailPts.push(tp.clone());
  trailPts.unshift(tp); trailPts.length = TRAIL;
  const tc = new THREE.Color(), red = new THREE.Color(1, 0.3, 0.4);
  for (let i = 0; i < TRAIL; i++) {
    const f = i / (TRAIL - 1), w = 0.05 * (1 - f) + 0.006, a = (1 - f) * clamp(S.speed * 1.4, 0, 1);
    const q = trailPts[i]; trailPos.set([q.x, q.y + w, q.z], i * 6); trailPos.set([q.x, q.y - w, q.z], i * 6 + 3);
    gem(f, tc).lerp(red, 1 - f).multiplyScalar(a * 1.2); tc.toArray(trailCol, i * 6); tc.toArray(trailCol, i * 6 + 3);
  }
  trailGeo.attributes.position.needsUpdate = true; trailGeo.attributes.color.needsUpdate = true;

  // particles
  const rear = B.wheels[1].getWorldPosition(new THREE.Vector3()).setY(0.06);
  if (S.smoke && rnd() < 0.8) spawnSmoke(rear, 1);
  if (S.sparks && rnd() < S.sparks) spawnSparks(rear, 6, tmpV.set(-Math.cos(S.yaw), 0.5, Math.sin(S.yaw)), 1.2, 6);
  for (let i = 0; i < SP; i++) {
    const s = sparks[i];
    if (s.life > 0) { s.life -= dt; s.v.y -= (s.ember ? 2 : 14) * dt; s.p.addScaledVector(s.v, dt); if (s.p.y < 0.02) { s.p.y = 0.02; s.v.y *= -0.35; s.v.x *= 0.7; s.v.z *= 0.7; } }
    const l = clamp(s.life * (s.ember ? 2.5 : 1), 0, 1);
    spPos[i * 3] = s.p.x; spPos[i * 3 + 1] = s.life > 0 ? s.p.y : -99; spPos[i * 3 + 2] = s.p.z;
    spCol[i * 3] = 2.6 * l; spCol[i * 3 + 1] = (s.ember ? 0.9 : 1.4) * l * l; spCol[i * 3 + 2] = (s.ember ? 0.2 : 0.5) * l * l * l;
  }
  spGeo.attributes.position.needsUpdate = true; spGeo.attributes.color.needsUpdate = true;
  smoke.forEach((o) => { if (o.life > 0) { o.life -= dt; o.s.position.addScaledVector(o.v, dt); o.v.multiplyScalar(0.97); const f = 1 - o.life / o.max; o.s.scale.setScalar(0.6 + f * 3.2); o.s.material.opacity = Math.sin(Math.PI * f) * 0.22; } else o.s.material.opacity = 0; });

  // world
  monument.rotation.y = t * 0.5; monument.rotation.x = Math.sin(t * 0.3) * 0.15;
  floaters.forEach((m, i) => { m.rotation.y = t * (0.3 + i * 0.03); });
  pad.material.opacity = 0.5 + 0.4 * Math.sin(t * 4);

  // camera: the ride's camera, blended into a slow orbit while idle
  const orbitR = 6.2, orbitH = 1.5;
  tmpV.set(S.pos.x + Math.sin(orbitA) * orbitR, Math.max(0.6, S.pos.y + orbitH), S.pos.z + Math.cos(orbitA) * orbitR);
  const want = tmpV2.copy(S.cam).lerp(tmpV, idleW);
  const lookWant = new THREE.Vector3().copy(S.look).lerp(new THREE.Vector3(S.pos.x, S.pos.y + 0.7, S.pos.z), idleW);
  const fast = S.rest ? 4.2 : PORTRAIT && S.high > 0 ? 24 : 14; // phones: hug the bike round the drift
  camPos.lerp(want, firstFrame ? 1 : 1 - Math.exp(-rdt * fast));
  camLook.lerp(lookWant, firstFrame ? 1 : 1 - Math.exp(-rdt * (S.rest ? 6 : PORTRAIT && S.high > 0 ? 30 : 18)));
  shake *= Math.exp(-dt * 5);
  camera.position.copy(camPos).add(tmpV.set(Math.sin(t * 73) * shake, Math.sin(t * 91) * shake, 0));
  camera.position.x += pointer.x * 0.15; camera.position.y += pointer.y * 0.1;
  camera.lookAt(camLook);
  keyLight.position.copy(camera.position).add(tmpV.set(-1.5, 3.5, 0)); keyLight.target.position.copy(bike.position);
  // phones: shift the picture down so the parked bike sits below the words, not behind them
  const shiftWant = PORTRAIT ? (S.rest && p < LAST - 0.5 ? 0.26 : 0.08) : 0;
  viewShift += (shiftWant - viewShift) * (firstFrame ? 1 : 1 - Math.exp(-dt * 2.5));
  if (viewShift > 0.001) camera.setViewOffset(innerWidth, innerHeight, 0, -viewShift * innerHeight, innerWidth, innerHeight);
  else if (camera.view && camera.view.enabled) camera.clearViewOffset();
  ground.material.uniforms.uCam.value.copy(camera.position);

  // post
  afterimage.uniforms.damp.value = 0.55 * smooth(0.55, 1, S.speed) + (S.seg === "C" ? 0.25 : 0);
  fx.uniforms.uAb.value = REDUCED ? 0 : 0.004 + S.speed * 0.012 + shake * 0.05;
  bloom.strength = 0.7 + S.boost * 0.2;
  flash *= 0.85; if (flashEl) flashEl.style.opacity = flash.toFixed(3);

  audioTick(S);
  composer.render(dt);
  firstFrame = false;
  lastState = S;
  return S;
}

/* ---------------- real model: data-model="assets/models/bike.glb" on the canvas ----------------
   A bike.json next to it (optional) turns the model to face +x, places the flames, tail light and headlight
   ("x,y,z" in bike units: ~2.05 long, ground at y = 0) and gives each material a look, so any model can be
   blacked out to match the site. */
const LOOKS = {
  paint: () => new THREE.MeshPhysicalMaterial({ color: 0x141519, metalness: 0.35, roughness: 0.36, clearcoat: 0.85, clearcoatRoughness: 0.16, envMapIntensity: 1.2 }),
  satin: () => new THREE.MeshStandardMaterial({ color: 0x1a1b1f, metalness: 0.4, roughness: 0.45, side: THREE.DoubleSide }),
  matte: () => new THREE.MeshStandardMaterial({ color: 0x0d0d0f, metalness: 0.05, roughness: 0.85 }),
  rubber: () => new THREE.MeshStandardMaterial({ color: 0x0b0b0c, metalness: 0, roughness: 0.92 }),
  disc: () => new THREE.MeshStandardMaterial({ color: 0x8d929c, metalness: 1, roughness: 0.32 }),
  metal: () => new THREE.MeshStandardMaterial({ color: 0x2a2c31, metalness: 1, roughness: 0.35 }),
  engine: () => new THREE.MeshStandardMaterial({ color: 0x18191c, metalness: 0.8, roughness: 0.45 }),
  glass: () => new THREE.MeshPhysicalMaterial({ color: 0x2b3038, metalness: 0, roughness: 0.05, transparent: true, opacity: 0.45, clearcoat: 1, side: THREE.DoubleSide, depthWrite: false }),
  taillight: () => new THREE.MeshStandardMaterial({ color: 0x3a0508, emissive: 0xff2233, emissiveIntensity: 1.4, roughness: 0.4 }),
  amber: () => new THREE.MeshStandardMaterial({ color: 0x3a2205, emissive: 0xff8a1a, emissiveIntensity: 0.6, roughness: 0.4 })
};
function loadBikeModel(url) {
  const cfgUrl = url.replace(/\.glb$/i, ".json");
  fetch(cfgUrl).then((r) => (r.ok ? r.json() : {})).catch(() => ({})).then((cfg) => {
    new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).load(url, (gltf) => { fitModel(gltf.scene, cfg); ready(); },
      (e) => { if (e.total) loading(0.12 + 0.8 * e.loaded / e.total); }, ready); // no model: keep the coded bike
  });
}
function fitModel(m, cfg) {
  const vec = (v) => Array.isArray(v) && new THREE.Vector3(...v);
  m.rotation.y = Number(cfg.yaw || 0);
  m.updateMatrixWorld();
  // fit: longest horizontal side → 2.05 bike units, wheels on the ground, centred
  const box = new THREE.Box3().setFromObject(m), size = box.getSize(new THREE.Vector3());
  m.scale.multiplyScalar(2.05 / Math.max(size.x, size.z));
  m.updateMatrixWorld(); box.setFromObject(m); const c = box.getCenter(new THREE.Vector3());
  m.position.sub(new THREE.Vector3(c.x, box.min.y, c.z));
  const holder = new THREE.Group(); holder.add(m); holder.updateMatrixWorld(true); // holder space = bike units

  // looks: every material is swapped for one of ours (unlisted ones get cfg.look), so the bike is blacked out
  const made = {}, mats = cfg.materials || {};
  const look = (name) => { const k = LOOKS[mats[name]] ? mats[name] : LOOKS[cfg.look] ? cfg.look : null; return k && (made[k] = made[k] || LOOKS[k]()); };
  // wheels: round, upright parts low at the front and back; each axle gets a pivot so it can spin
  const parts = [], bb = new THREE.Box3(), sz = new THREE.Vector3(), ce = new THREE.Vector3();
  m.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    const nm = look(o.material.name); if (nm) o.material = nm;
    bb.setFromObject(o); bb.getSize(sz); bb.getCenter(ce);
    if (sz.y > 0.15 && Math.abs(sz.x - sz.y) < 0.03 && Math.abs(ce.x) > 0.45 && ce.y < 0.45) parts.push({ o, c: ce.clone() });
  });
  const axles = [1, -1].map((side) => {
    const mine = parts.filter((p) => Math.sign(p.c.x) === side);
    if (!mine.length) return null;
    const ref = mine.reduce((a, p) => (p.c.y > a.c.y ? p : a)).c; // the tyre's centre is the axle
    const pivot = new THREE.Group(); pivot.position.set(ref.x, ref.y, 0); holder.add(pivot); pivot.updateMatrixWorld();
    mine.filter((p) => Math.hypot(p.c.x - ref.x, p.c.y - ref.y) < 0.03).forEach((p) => pivot.attach(p.o));
    return pivot;
  });
  if (axles[0] && axles[1]) B.wheels = axles;
  modelReady = true; modelHolder = holder;
  // swap: hide the coded bodywork (lights, flames and anchors stay)
  B.bike.children.forEach((ch) => { if (ch.isGroup && ch !== flames) ch.visible = false; });
  body.add(holder);

  // move the anchors onto the model
  const ex = vec(cfg.exhaust), tail = vec(cfg.tail), head = vec(cfg.head);
  if (ex) flames.position.copy(ex);
  if (tail) { B.tail = new THREE.Object3D(); B.tail.position.copy(tail); body.add(B.tail); tailGlow.position.copy(tail); }
  if (head) { ledGlow.position.copy(head); beam.position.copy(head); spot.position.copy(head); spot.target.position.set(head.x + 5, 0, 0); }
}
// loading screen (inline script in index.html): real download progress, then done once the bike is on screen
function loading(k) { if (window.__load) window.__load.set(k); }
function ready() { requestAnimationFrame(() => requestAnimationFrame(() => window.__load && window.__load.done())); }
loading(0.1);
if (canvas.dataset.model) loadBikeModel(canvas.dataset.model); else ready();

/* ---------------- speed governor: older phones and laptops drop to lighter effects on their own ----------------
   After the page has loaded, the average frame time is checked every 2 s. Too slow (under ~38 fps), and it steps
   down: first fewer pixels and no motion trail, then fewer pixels again and a cheaper glow. It never steps back up. */
function governor(raw) {
  if (perf.level >= 2 || raw > 0.5) return; // a long gap is a background tab, not a slow device
  if (!document.documentElement.classList.contains("is-loaded")) return; // loading is always slow; judge the ride
  if (perf.wait > 0) { perf.wait -= raw; return; }
  perf.t += raw; perf.n++;
  if (perf.t < 2) return;
  const ms = perf.t / perf.n * 1000; perf.t = perf.n = 0;
  if (ms < 26) return;
  perf.level++; perf.wait = 1.5;
  afterimage.enabled = false;
  renderer.setPixelRatio(perf.level === 1 ? Math.min(renderer.getPixelRatio(), 1) : 0.7);
  bloom.resolution.set(innerWidth / (perf.level === 1 ? 2 : 4), innerHeight / (perf.level === 1 ? 2 : 4));
  resize();
}

/* ---------------- drive ---------------- */
document.documentElement.classList.add("has-gl");
const clock = new THREE.Clock();
if (REDUCED) {
  const still = () => { firstFrame = true; ignite = 1; frame(1.2, 1 / 60, 0); };
  still(); addEventListener("resize", still);
} else {
  (function loop() {
    const raw = clock.getDelta(), dt = Math.min(raw, 0.05), t = clock.elapsedTime;
    // progress follows real time (not the capped dt) so a slow device still lands on schedule
    const follow = document.documentElement.classList.contains("quick-ride") ? 10 : 5; // nav shortcuts play the stunts fast
    smoothP += (scrollP - smoothP) * (1 - Math.exp(-Math.min(raw, 0.25) * follow));
    if (!document.hidden) { frame(t, dt, smoothP); governor(raw); }
    requestAnimationFrame(loop);
  })();
}
window.__ride = { audio: () => ({ on: snd.on, state: snd.ctx && snd.ctx.state, rpm: Math.round(snd.rpm), load: +snd.load.toFixed(2), layers: Object.fromEntries(snd.layers.map((l, k) => [ENGINE[k][0], [+(l.want || 0).toFixed(3), +l.src.playbackRate.value.toFixed(2)]])) }), get green() { let n = 0; modelHolder && modelHolder.traverse((o) => { if (o.isMesh && o.material.color) { const h = {}; o.material.color.getHSL(h); if (h.s > 0.3 && h.l > 0.08) n++; } }); return modelHolder ? n : -1; }, frame, setP: (p) => { scrollP = smoothP = p; }, idle: () => { lastScroll = -1e9; }, state: () => lastState && { scr: (() => { const v = lastState.pos.clone().setY(0.6).project(camera); return [Math.round((v.x + 1) / 2 * innerWidth), Math.round((1 - v.y) / 2 * innerHeight)]; })(), model: modelReady, wheels: B.wheels[0].parent && B.wheels[0].parent.type, p: smoothP, sp: scrollP, marks, y: lastState.pos.y, x: lastState.pos.x, rest: lastState.rest, air: lastState.air, rev, yaw: lastState.yaw, back: !!back.on }, perf: () => ({ level: perf.level, ratio: renderer.getPixelRatio() }) };
