// Ride mode: ride the bike yourself through six zones. The course and handling live in course.js.
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { buildBike } from "./bike.js";
import { buildCourse, newRider, step, reset, at, HALF, TUNE } from "./course.js";

const $ = (id) => document.getElementById(id);
const canvas = $("game");
const TOUCH = matchMedia("(hover: none) and (pointer: coarse)").matches;
const LITE = TOUCH || innerWidth < 760 || (navigator.hardwareConcurrency || 8) <= 4;
const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const store = { get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode: no saved bests */ } } };
let seed = 3; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

let renderer;
try { renderer = new THREE.WebGLRenderer({ canvas, antialias: !LITE, powerPreference: "high-performance" }); }
catch (e) { $("s-nogl").hidden = false; $("s-start").hidden = true; if (window.__load) window.__load.done(); throw new Error("WebGL unavailable"); }
renderer.setPixelRatio(LITE ? 1 : Math.min(devicePixelRatio, 1.5));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 0.25, 2600);

/* ---------------- zones: each one has its own sky, fog, ground, road colour and scenery ---------------- */
const LOOK = {
  city: { top: 0x02040e, hor: 0x173a7a, glow: 0xd04ad0, fog: 0x070c20, den: 0.0042, edge: 0x38d8ff, light: 0x6aa8ff, ground: 0 },
  crystal: { top: 0x06031c, hor: 0x2c1c66, glow: 0x3fe0c8, fog: 0x0c0824, den: 0.0034, edge: 0xb07cff, light: 0x9a7cff, ground: 1 },
  tunnel: { top: 0x010101, hor: 0x1a0a02, glow: 0xff8a2a, fog: 0x0c0602, den: 0.008, edge: 0xff9a3a, light: 0xffa050, ground: 0 },
  canyon: { top: 0x1c0a26, hor: 0xd8602e, glow: 0xffb35e, fog: 0x3a1a12, den: 0.0055, edge: 0xff5a3a, light: 0xffa070, ground: 2 },
  bridge: { top: 0x020e1c, hor: 0x1f7090, glow: 0x7ad8ff, fog: 0x07182a, den: 0.0028, edge: 0x5ae0ff, light: 0x80d0ff, ground: 3 },
  final: { top: 0x0d0312, hor: 0x74204e, glow: 0xffc85a, fog: 0x18061a, den: 0.0034, edge: 0xffc04a, light: 0xff9ac0, ground: 4 }
};
const C = buildCourse();
const Z = C.zones.map((z) => { const l = LOOK[z.kind]; return { ...z, top: new THREE.Color(l.top), hor: new THREE.Color(l.hor), glow: new THREE.Color(l.glow), fog: new THREE.Color(l.fog), den: l.den * (LITE ? 1.35 : 1), edge: new THREE.Color(l.edge), light: new THREE.Color(l.light), ground: l.ground }; });
const U = { uFog: { value: new THREE.Color() }, uDen: { value: 0.004 }, uTime: { value: 0 }, uCam: { value: new THREE.Vector3() } };
scene.fog = new THREE.FogExp2(0x000000, 0.004);
scene.background = new THREE.Color(0x000000);
const FOG_GLSL = "vec3 fogged(vec3 c, vec3 w){ float f = 1. - exp(-pow(distance(w, uCam) * uDen, 2.) * 1.0); return mix(c, uFog, clamp(f, 0., 1.)); }";

// image-based light so the black paint has highlights
{
  const pmrem = new THREE.PMREMGenerator(renderer), env = new THREE.Scene();
  env.add(new THREE.Mesh(new THREE.SphereGeometry(30, 32, 16), new THREE.MeshBasicMaterial({ color: 0x07080e, side: THREE.BackSide })));
  [[0xffffff, 0, 14, 0, 3.2, 16, 3], [0x4796e3, -12, 5, 6, 2.6, 10, 5], [0xca6673, 12, 4, -6, 2.4, 10, 5], [0x9177c7, 0, 3, -13, 2, 14, 4]].forEach(([c, x, y, z, k, w, h]) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k), side: THREE.DoubleSide }));
    m.position.set(x, y, z); m.lookAt(0, 0, 0); env.add(m);
  });
  scene.environment = pmrem.fromScene(env, 0.03).texture;
}
const hemi = new THREE.HemisphereLight(0x8fb0ff, 0x120a18, 0.5); scene.add(hemi);
const moon = new THREE.DirectionalLight(0xc8d4ff, 1.2); scene.add(moon, moon.target);
const keyLight = new THREE.DirectionalLight(0xf2f4ff, 1.5); scene.add(keyLight, keyLight.target);

const sky = new THREE.Mesh(new THREE.SphereGeometry(2000, 48, 24), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: { uTop: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uGlow: { value: new THREE.Color() }, uSun: { value: new THREE.Vector3(0.5, 0.18, -0.85).normalize() } },
  vertexShader: "varying vec3 vP; void main(){ vP = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.); gl_Position = p.xyww; }",
  fragmentShader: `varying vec3 vP; uniform vec3 uTop, uHor, uGlow, uSun;
    void main(){
      float y = vP.y;
      vec3 c = mix(uHor, uTop, smoothstep(-0.02, 0.45, y));
      c += uGlow * pow(max(0., dot(vP, uSun)), 24.) * 0.9 + uGlow * pow(max(0., dot(vP, uSun)), 3.) * 0.18;
      c *= smoothstep(-0.25, 0.0, y) * 0.9 + 0.1;
      gl_FragColor = vec4(c, 1.);
    }`
}));
sky.frustumCulled = false; scene.add(sky);
const GLOW = (() => {
  const c = document.createElement("canvas"); c.width = c.height = 64; const x = c.getContext("2d");
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.25, "rgba(255,255,255,.45)"); g.addColorStop(1, "rgba(255,255,255,0)");
  x.fillStyle = g; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
})();
const stars = (() => {
  const n = LITE ? 900 : 2000, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const u = rnd() * 0.95 + 0.05, th = rnd() * Math.PI * 2, r = Math.sqrt(1 - u * u); pos.set([r * Math.cos(th) * 1500, u * 1500, r * Math.sin(th) * 1500], i * 3); }
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const p = new THREE.Points(g, new THREE.PointsMaterial({ size: 3, map: GLOW, color: 0xdfe6ff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  p.frustumCulled = false; scene.add(p); return p;
})();

/* ---------------- ground: a different pattern per zone (blocks, dots, contours, water, stripes) ---------------- */
const ground = new THREE.Mesh(new THREE.PlaneGeometry(5200, 5200, 64, 64), new THREE.ShaderMaterial({
  transparent: false, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 4, /* always behind the road */ uniforms: { ...U, uW: { value: [1, 0, 0, 0, 0] }, uTint: { value: new THREE.Color() } },
  vertexShader: "varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }",
  fragmentShader: `varying vec3 vW; uniform vec3 uFog, uCam, uTint; uniform float uDen, uTime; uniform float uW[5];
    ${FOG_GLSL}
    float line(float v, float w){ float d = abs(fract(v - 0.5) - 0.5) / fwidth(v); return 1. - min(d / w, 1.); }
    float h21(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }
    float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f); return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y); }
    void main(){
      vec2 p = vW.xz; vec3 c = vec3(0.012, 0.014, 0.025);
      if (uW[0] > 0.) { float g = max(line(p.x / 24., 1.2), line(p.y / 24., 1.2)) + 0.35 * max(line(p.x / 6., 1.), line(p.y / 6., 1.)); c += uW[0] * uTint * g * 0.45; }
      if (uW[1] > 0.) { vec2 q = fract(p / 7.) - 0.5; float d = smoothstep(0.05, 0.015, length(q)) * (0.4 + 0.6 * n2(floor(p / 7.) * 0.37 + uTime * 0.2)); c += uW[1] * (uTint * d * 1.2 + vec3(0.03, 0.01, 0.06)); }
      if (uW[2] > 0.) { float e = n2(p * 0.012) * 6. + n2(p * 0.04) * 1.2; c = mix(c, vec3(0.09, 0.035, 0.03) + uTint * line(e, 1.4) * 0.35, uW[2]); }
      if (uW[3] > 0.) { float w = n2(p * 0.08 + vec2(uTime * 0.6, uTime * 0.3)) * n2(p * 0.21 - uTime * 0.4); vec3 sea = vec3(0.004, 0.02, 0.04) + uTint * pow(w, 3.) * 0.9; c = mix(c, sea, uW[3]); }
      if (uW[4] > 0.) { float s = line((p.x + p.y) / 14., 2.) * 0.6 + line((p.x - p.y) / 42., 1.) * 0.3; c += uW[4] * uTint * s * 0.4; }
      gl_FragColor = vec4(fogged(c, vW), 1.);
    }`
}));
ground.rotation.x = -Math.PI / 2; scene.add(ground);

/* ---------------- the road ---------------- */
{
  const ST = 2, n = Math.floor((C.N - 1) / ST) + 1, pos = new Float32Array(n * 2 * 3), uv = new Float32Array(n * 2 * 2), col = new Float32Array(n * 2 * 3), idx = [];
  const tc = new THREE.Color();
  for (let j = 0; j < n; j++) {
    const s = j * ST, L = at(C, s, HALF + 0.6), R = at(C, s, -HALF - 0.6), zi = C.zoneAt(s);
    // colours blend over 120 m into the next zone
    const z0 = Z[zi], z1 = Z[Math.min(Z.length - 1, zi + 1)], f = smooth(z0.e - 120, z0.e, s);
    tc.copy(z0.edge).lerp(z1.edge, f);
    pos.set([L[0], 0.05, L[1], R[0], 0.05, R[1]], j * 6); uv.set([0, s, 1, s], j * 4); tc.toArray(col, j * 6); tc.toArray(col, j * 6 + 3);
    if (j < n - 1) { const a = j * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); g.setAttribute("uv", new THREE.BufferAttribute(uv, 2)); g.setAttribute("color", new THREE.BufferAttribute(col, 3)); g.setIndex(idx);
  const road = new THREE.Mesh(g, new THREE.ShaderMaterial({
    uniforms: U, side: THREE.DoubleSide,
    vertexShader: "attribute vec3 color; varying vec2 vUv; varying vec3 vC, vW; void main(){ vUv = uv; vC = color; vec4 w = modelMatrix * vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }",
    fragmentShader: `varying vec2 vUv; varying vec3 vC, vW; uniform vec3 uFog, uCam; uniform float uDen, uTime;
      ${FOG_GLSL}
      float h21(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }
      void main(){
        float u = vUv.x, s = vUv.y;
        vec3 c = vec3(0.03, 0.032, 0.045) * (0.8 + 0.4 * h21(floor(vec2(u * 60., s * 3.))));
        float edge = smoothstep(0.022, 0.006, abs(u - 0.04)) + smoothstep(0.022, 0.006, abs(u - 0.96));
        float dash = step(0.55, fract(s / 9.)) * smoothstep(0.012, 0.004, abs(u - 0.5));
        float lanes = step(0.7, fract(s / 9.)) * (smoothstep(0.008, 0.002, abs(u - 0.27)) + smoothstep(0.008, 0.002, abs(u - 0.73))) * 0.4;
        c += vC * edge * 2.2 + vec3(0.85) * (dash + lanes) * 0.55;
        c += vC * 0.05 * smoothstep(0.5, 0.0, abs(u - 0.5)); // a faint sheen in the zone's colour
        gl_FragColor = vec4(fogged(c, vW), 1.);
      }`
  }));
  road.frustumCulled = false; scene.add(road);
}

const sparkleGeo = (() => {
  const s = new THREE.Shape(), k = 0.13; s.moveTo(0, 1); s.quadraticCurveTo(k, k, 1, 0); s.quadraticCurveTo(k, -k, 0, -1); s.quadraticCurveTo(-k, -k, -1, 0); s.quadraticCurveTo(-k, k, 0, 1);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.2, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.04, bevelSegments: 2, curveSegments: 10 }); g.center(); return g;
})();
/* ---------------- scenery ---------------- */
const dummy = new THREE.Object3D(), tcol = new THREE.Color();
const thin = (list) => (LITE ? list.filter((_, i) => i % 2 === 0) : list); // phones: half the scenery
const byType = (t) => thin(C.props.filter((p) => p.type === t));
const instanced = (geo, mat, list, place) => {
  if (!list.length) return null;
  const m = new THREE.InstancedMesh(geo, mat, list.length);
  list.forEach((o, i) => { place(o, dummy, tcol); dummy.updateMatrix(); m.setMatrixAt(i, dummy.matrix); if (m.instanceColor || place.colored) m.setColorAt(i, tcol); });
  m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true;
  m.computeBoundingSphere(); scene.add(m); return m;
};
// towers with lit windows, shaded from the instance's own size so the windows stay square
const towerMat = new THREE.ShaderMaterial({
  uniforms: U,
  vertexShader: `varying vec3 vL, vN, vW, vC; void main(){
      vec3 sc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
      vL = (position + vec3(0., 0.5, 0.)) * sc; vN = normal; vC = vec3(0.5);
      #ifdef USE_INSTANCING_COLOR
        vC = instanceColor;
      #endif
      vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
  fragmentShader: `varying vec3 vL, vN, vW, vC; uniform vec3 uFog, uCam; uniform float uDen, uTime;
    ${FOG_GLSL}
    float h21(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }
    void main(){
      vec2 f = abs(vN.x) > 0.5 ? vL.zy : vL.xy;
      vec2 cell = floor(f / vec2(2.6, 3.2)), q = fract(f / vec2(2.6, 3.2));
      float lit = step(0.62, h21(cell + floor(vW.x * 0.01) + vC.r * 17.)) * step(0.2, q.x) * step(q.x, 0.8) * step(0.25, q.y) * step(q.y, 0.75);
      vec3 c = vec3(0.018, 0.02, 0.035) + vec3(0.02) * max(0., vN.y);
      if (abs(vN.y) < 0.5) c += mix(vec3(1.0, 0.85, 0.6), vC, 0.6) * lit * (0.55 + 0.45 * h21(cell * 3.1));
      c += vC * step(0.985, fract(vL.y / 18.)) * 1.4;                         // neon bands every 18 m
      gl_FragColor = vec4(fogged(c, vW), 1.);
    }`
});
const towerPlace = Object.assign((o, d, c) => { d.position.set(o.x, o.hgt / 2, o.z); d.rotation.set(0, o.rot, 0); d.scale.set(o.w, o.hgt, o.d); c.copy(Z[o.zone].edge).lerp(Z[o.zone].glow, rnd()); }, { colored: true });
instanced(new THREE.BoxGeometry(1, 1, 1), towerMat, byType("tower"), towerPlace);
// skyline far across the water by the bridge
{
  const list = [];
  if (C.bridge) for (let s = C.bridge[0]; s < C.bridge[1]; s += LITE ? 70 : 40) for (const side of [-1, 1]) { const off = 380 + rnd() * 520, p = at(C, s, side * off), w = 18 + rnd() * 30; list.push({ x: p[0], z: p[1], w, d: w, hgt: 50 + rnd() * rnd() * 260, rot: rnd() * 3, zone: C.zoneAt(s) }); }
  instanced(new THREE.BoxGeometry(1, 1, 1), towerMat, list, towerPlace);
}
// crystals
instanced(new THREE.OctahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.2, roughness: 0.12, emissive: 0x1a1240, flatShading: true, envMapIntensity: 2 }), byType("crystal"),
  Object.assign((o, d, c) => { d.position.set(o.x, o.size * 0.9, o.z); d.rotation.set(o.tilt, o.rot, o.tilt * 0.5); d.scale.set(o.size * 0.45, o.size * 1.4, o.size * 0.45); c.setHSL(0.5 + rnd() * 0.32, 0.8, 0.6); }, { colored: true }));
// big floating sparkles over the valley
{
  const list = [], zv = C.zones.find((z) => z.kind === "crystal");
  if (zv) for (let s = zv.s + 40; s < zv.e; s += LITE ? 160 : 90) { const side = rnd() < 0.5 ? -1 : 1, p = at(C, s, side * (22 + rnd() * 70)); list.push({ x: p[0], z: p[1], y: 9 + rnd() * 22, k: 2 + rnd() * 5, r: rnd() * 6 }); }
  instanced(sparkleGeo, new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0.3, roughness: 0.15, clearcoat: 1, iridescence: 0.8, emissive: 0x2a2050, emissiveIntensity: 0.7, envMapIntensity: 1.5 }), list,
    Object.assign((o, d, c) => { d.position.set(o.x, o.y, o.z); d.rotation.set(0.2, o.r, 0.1); d.scale.setScalar(o.k); c.setHSL(0.55 + rnd() * 0.3, 0.7, 0.65); }, { colored: true }));
}
// canyon rocks
instanced(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: 0x5a2c22, roughness: 0.95, metalness: 0, flatShading: true }), byType("rock"),
  Object.assign((o, d, c) => { d.position.set(o.x, o.hgt * 0.42, o.z); d.rotation.set(rnd() * 0.4, o.rot, rnd() * 0.4); d.scale.set(o.size * 0.6, o.hgt * 0.6, o.size * 0.55); c.setHSL(0.03 + rnd() * 0.04, 0.5, 0.18 + rnd() * 0.12); }, { colored: true }));
// light posts with glowing caps in the zone colour
{
  const list = byType("post");
  instanced(new THREE.CylinderGeometry(0.06, 0.09, 4.2, 6).translate(0, 2.1, 0), new THREE.MeshStandardMaterial({ color: 0x1b1f2e, metalness: 0.8, roughness: 0.35 }), list, (o, d) => { const p = at(C, o.s, o.lat); d.position.set(p[0], 0, p[1]); d.rotation.set(0, 0, 0); d.scale.set(1, 1, 1); });
  instanced(new THREE.SphereGeometry(0.22, 10, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }), list,
    Object.assign((o, d, c) => { const p = at(C, o.s, o.lat); d.position.set(p[0], 4.3, p[1]); c.copy(Z[o.zone].edge).multiplyScalar(2.4); }, { colored: true }));
}
// the bridge: pylons, cables and glowing rails
{
  const list = byType("pylon");
  instanced(new THREE.BoxGeometry(1.6, 46, 1.6).translate(0, 23, 0), new THREE.MeshStandardMaterial({ color: 0x1a2a3a, metalness: 0.7, roughness: 0.35, emissive: 0x06121c }), list, (o, d) => { d.position.set(o.x, 0, o.z); d.rotation.set(0, o.rot, 0); d.scale.set(1, 1, 1); });
  const pts = [], cols = [], c = new THREE.Color(0x7ad8ff).multiplyScalar(1.6);
  list.forEach((o) => { for (let k = -5; k <= 5; k++) { if (!k) continue; const p = at(C, o.s + k * 11, o.side * (HALF + 1.4)); pts.push(o.x, 45, o.z, p[0], 1.2, p[1]); cols.push(c.r, c.g, c.b, c.r * 0.3, c.g * 0.3, c.b * 0.3); } });
  if (C.bridge) for (const side of [-1, 1]) for (let s = C.bridge[0]; s < C.bridge[1] - 4; s += 4) { const a = at(C, s, side * (HALF + 1.4)), b = at(C, s + 4, side * (HALF + 1.4)); pts.push(a[0], 1.1, a[1], b[0], 1.1, b[1]); cols.push(c.r, c.g, c.b, c.r, c.g, c.b); }
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3)); g.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3));
  scene.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false })));
}
// arches over the final stretch
instanced(new THREE.TorusGeometry(HALF + 3, 0.3, 8, 40, Math.PI), new THREE.MeshBasicMaterial({ color: 0xffffff }), byType("arch"),
  Object.assign((o, d, c) => { const p = at(C, o.s); d.position.set(p[0], 0, p[1]); d.rotation.set(0, p[2] + Math.PI / 2, 0); d.scale.set(1, 1, 1); c.copy(o.s % 160 < 80 ? Z[o.zone].glow : Z[o.zone].edge).multiplyScalar(2); }, { colored: true }));
// the tunnel: a lit half-tube with light rings
if (C.tunnel) {
  const [a, b] = C.tunnel, ST = 3, SEG = 18, Rr = HALF + 2.6, pos = [], uv = [], idx = [];
  let row = 0;
  for (let s = a; s <= b; s += ST, row++) {
    for (let k = 0; k <= SEG; k++) { const th = Math.PI * k / SEG, p = at(C, s, Math.cos(th) * Rr); pos.push(p[0], Math.sin(th) * Rr * 0.82, p[1]); uv.push(k / SEG, s); }
    if (s > a) for (let k = 0; k < SEG; k++) { const p0 = (row - 1) * (SEG + 1) + k, p1 = row * (SEG + 1) + k; idx.push(p0, p1, p0 + 1, p0 + 1, p1, p1 + 1); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
  const tz = Z[C.zoneAt(a + 5)];
  scene.add(new THREE.Mesh(g, new THREE.ShaderMaterial({
    side: THREE.DoubleSide, uniforms: { ...U, uC: { value: tz.edge.clone() } },
    vertexShader: "varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }",
    fragmentShader: `varying vec2 vUv; varying vec3 vW; uniform vec3 uFog, uCam, uC; uniform float uDen, uTime;
      ${FOG_GLSL}
      void main(){
        float ring = smoothstep(0.455, 0.49, abs(fract(vUv.y / 24.) - 0.5)); // a light ring every 24 m
        float strip = smoothstep(0.03, 0.0, abs(vUv.x - 0.5) - 0.02) * 0.9 + smoothstep(0.02, 0.0, abs(vUv.x - 0.2) - 0.004) * 0.5 + smoothstep(0.02, 0.0, abs(vUv.x - 0.8) - 0.004) * 0.5;
        float panel = step(0.96, fract(vUv.y / 4.)) * 0.04;
        vec3 c = vec3(0.025, 0.02, 0.018) + uC * (ring * 1.8 + strip * 0.9) + panel;
        gl_FragColor = vec4(fogged(c, vW), 1.);
      }`
  })));
}

/* ---------------- game pieces: jumps, boost pads, sparkles, checkpoints ---------------- */
const rampMat = new THREE.MeshPhysicalMaterial({ color: 0x10131f, metalness: 0.5, roughness: 0.35, clearcoat: 1 });
C.ramps.forEach((r) => {
  const s = new THREE.Shape(); s.moveTo(0, 0); s.lineTo(r.len, r.h); s.lineTo(r.len, 0); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: HALF * 2, bevelEnabled: false }); g.translate(0, 0, -HALF);
  const m = new THREE.Group(), zc = Z[C.zoneAt(r.s)];
  m.add(new THREE.Mesh(g, rampMat));
  m.add(new THREE.LineSegments(new THREE.EdgesGeometry(g), new THREE.LineBasicMaterial({ color: zc.edge.clone().multiplyScalar(2.2) })));
  const p = at(C, r.s); m.position.set(p[0], 0.02, p[1]); m.rotation.y = p[2]; scene.add(m);
});
const padMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: U,
  vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position,1.); }",
  fragmentShader: `varying vec2 vUv; uniform float uTime;
    void main(){ float chev = fract(vUv.x * 3. - abs(vUv.y - 0.5) * 1.6 - uTime * 2.2); float a = smoothstep(0.55, 0.62, chev) * (1. - smoothstep(0.85, 0.92, chev));
      float rim = step(0.92, max(abs(vUv.y - 0.5) * 2., abs(vUv.x - 0.5) * 2.)); vec3 c = mix(vec3(0.2, 0.9, 1.2), vec3(1.4, 0.5, 1.2), vUv.x);
      gl_FragColor = vec4(c * (a * 1.6 + rim * 0.9 + 0.12), 1.); }`
});
instanced(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), padMat, C.pads, (p, d) => { const q = at(C, p.s + p.len / 2, p.lat); d.position.set(q[0], 0.09, q[1]); d.rotation.set(0, q[2], 0); d.scale.set(p.len, 1, 4.4); });
const orbMesh = new THREE.InstancedMesh(sparkleGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), C.orbs.length);
C.orbs.forEach((o, i) => { orbMesh.setColorAt(i, tcol.copy(Z[C.zoneAt(o.s)].edge).lerp(new THREE.Color(1, 1, 1), 0.35).multiplyScalar(1.9)); });
orbMesh.frustumCulled = false; scene.add(orbMesh);
function placeOrbs(t, from, to) {
  for (let i = 0; i < C.orbs.length; i++) {
    const o = C.orbs[i];
    if (o.s < from || o.s > to) { if (!o.parked) { dummy.scale.setScalar(0); dummy.updateMatrix(); orbMesh.setMatrixAt(i, dummy.matrix); o.parked = true; } continue; }
    o.parked = false;
    dummy.position.set(o.x, 1.3 + Math.sin(t * 3 + i) * 0.15, o.z); dummy.rotation.set(0, t * 2.4 + i, 0); dummy.scale.setScalar(o.got ? 0 : 0.55); dummy.updateMatrix(); orbMesh.setMatrixAt(i, dummy.matrix);
  }
  orbMesh.instanceMatrix.needsUpdate = true;
}
// checkpoint and finish gates with their labels
function label(text, sub, color) {
  const c = document.createElement("canvas"); c.width = 1024; c.height = 256; const x = c.getContext("2d");
  x.fillStyle = "rgba(6,8,16,.72)"; x.fillRect(0, 0, 1024, 256);
  x.strokeStyle = color; x.lineWidth = 8; x.strokeRect(8, 8, 1008, 240);
  x.fillStyle = "#fff"; x.textAlign = "center"; x.font = "800 96px Inter, system-ui, sans-serif"; x.fillText(text, 512, 128);
  x.fillStyle = color; x.font = "600 44px Inter, system-ui, sans-serif"; x.fillText(sub, 512, 200);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const gateMeshes = [];
function gate(s, text, sub, color) {
  const g = new THREE.Group(), cc = new THREE.Color(color), mat = new THREE.MeshBasicMaterial({ color: cc.clone().multiplyScalar(2) });
  [-1, 1].forEach((side) => { const p = new THREE.Mesh(new THREE.BoxGeometry(0.6, 8, 0.6), mat); p.position.set(0, 4, side * (HALF + 1.5)); g.add(p); });
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, HALF * 2 + 3.6), mat); bar.position.y = 8; g.add(bar);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 1.6, HALF * 0.4), new THREE.MeshBasicMaterial({ map: label(text, sub, "#" + cc.getHexString()), side: THREE.DoubleSide, transparent: true }));
  sign.position.y = 9.9; sign.rotation.y = -Math.PI / 2; g.add(sign);
  const p = at(C, s); g.position.set(p[0], 0, p[1]); g.rotation.y = p[2]; scene.add(g); gateMeshes.push(g); return g;
}
gate(14, "START", "Ride mode", "#4796e3");
C.gates.forEach((s, i) => { const last = i === C.gates.length - 1, z = Z[C.zoneAt(s + 2)]; gate(s, last ? "FINISH" : "CHECKPOINT " + (i + 1), last ? "Well ridden" : "Zone " + (i + 2) + " · " + z.name, "#" + (last ? new THREE.Color(0xffc85a) : z.edge).getHexString()); });

/* ---------------- the bike ---------------- */
const bike = new THREE.Group(); bike.rotation.order = "YZX"; scene.add(bike);
const B = buildBike(); bike.add(B.bike);
const body = B.bike;
const tailGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color: 0xff3355, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false })); tailGlow.scale.setScalar(0.28); tailGlow.position.set(-1.0, 1.01, 0); body.add(tailGlow);
const headGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color: 0xdfe8ff, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false })); headGlow.scale.setScalar(0.5); headGlow.position.set(1.02, 0.75, 0); body.add(headGlow);
const spot = new THREE.SpotLight(0xdfe8ff, 60, 70, 0.42, 0.6, 1.1); spot.position.set(1.04, 0.76, 0); body.add(spot); spot.target.position.set(12, 0, 0); body.add(spot.target);
const under = new THREE.PointLight(0x7d84a6, 2.4, 5, 2); under.position.set(0, 0.25, 0); body.add(under);
// exhaust flames for nitro, pads and gear changes
const flameMat = (inner) => new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  uniforms: { uT: { value: 0 }, uP: { value: 0 }, uInner: { value: inner } },
  vertexShader: "varying vec2 vUv; uniform float uT; void main(){ vUv = uv; vec3 p = position; p.xz *= 1. + 0.25 * sin(uT * 40. + uv.y * 12.) * (1. - uv.y); gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.); }",
  fragmentShader: `varying vec2 vUv; uniform float uT, uP, uInner;
    float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
    void main(){ float along = 1. - vUv.y; float fl = n(vec2(vUv.x * 6., along * 5. - uT * 9.)) * 0.6 + n(vec2(vUv.x * 13., along * 11. - uT * 15.)) * 0.4;
      float a = smoothstep(1., 0.15, along + fl * 0.45) * uP;
      vec3 hot = mix(vec3(0.45, 0.65, 1.6), vec3(1.8, 1.25, 0.6), smoothstep(0.0, 0.35, along));
      vec3 c = mix(hot, vec3(1.5, 0.35, 0.08), smoothstep(0.3, 0.9, along + fl * 0.2)); c = mix(c, vec3(0.6, 0.8, 2.0), uInner * (1. - smoothstep(0., 0.4, along)));
      gl_FragColor = vec4(c * a, a); }`
});
const flames = new THREE.Group(); body.add(flames);
const flameLayers = [[0.09, 0.9, 0], [0.065, 0.65, 0.5], [0.04, 0.42, 1]].map(([r, len, inner]) => { const m = new THREE.Mesh(new THREE.ConeGeometry(r, len, 16, 6, true).translate(0, -len / 2, 0), flameMat(inner)); flames.add(m); return m; });
{ const tip = B.exhaustTip.getWorldPosition(new THREE.Vector3()); body.worldToLocal(tip); flames.position.copy(tip); flames.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), B.exhaustDir.clone().normalize()); }
const flameLight = new THREE.PointLight(0xff7a2a, 0, 7, 2); flames.add(flameLight); flameLight.position.set(0, -0.2, 0);

// the ghost of your best run
const ghost = new THREE.Group(); ghost.rotation.order = "YZX"; ghost.visible = false; scene.add(ghost);
const ghostMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x9a8cff).multiplyScalar(0.5), transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false });
function makeGhost(src, inBody) {
  ghost.clear(); const g = src.clone(true);
  g.traverse((o) => { if (o.isMesh) o.material = o.material.blending === THREE.AdditiveBlending ? o.material : ghostMat; if (o.isLight || o.isSprite) o.visible = false; });
  if (inBody) { g.scale.multiply(body.scale); g.position.multiply(body.scale); } // the model sits inside the scaled bike body
  ghost.add(g);
}
makeGhost(B.bike, false);

const LOOKS = {
  paint: () => new THREE.MeshPhysicalMaterial({ color: 0x141519, metalness: 0.35, roughness: 0.36, clearcoat: 0.85, clearcoatRoughness: 0.16, envMapIntensity: 1.2 }),
  satin: () => new THREE.MeshStandardMaterial({ color: 0x1a1b1f, metalness: 0.4, roughness: 0.45, side: THREE.DoubleSide }),
  matte: () => new THREE.MeshStandardMaterial({ color: 0x0d0d0f, metalness: 0.05, roughness: 0.85 }),
  rubber: () => new THREE.MeshStandardMaterial({ color: 0x0b0b0c, metalness: 0, roughness: 0.92 }),
  disc: () => new THREE.MeshStandardMaterial({ color: 0x8d929c, metalness: 1, roughness: 0.32 }),
  metal: () => new THREE.MeshStandardMaterial({ color: 0x2a2c31, metalness: 1, roughness: 0.35 }),
  engine: () => new THREE.MeshStandardMaterial({ color: 0x18191c, metalness: 0.8, roughness: 0.45 }),
  glass: () => new THREE.MeshPhysicalMaterial({ color: 0x2b3038, metalness: 0, roughness: 0.05, transparent: true, opacity: 0.45, clearcoat: 1, side: THREE.DoubleSide, depthWrite: false })
};
let modelReady = false;
// same model and settings as the home page (assets/models/bike.json), fitted to bike units the same way
function loadModel(url) {
  fetch(url.replace(/\.glb$/i, ".json")).then((r) => (r.ok ? r.json() : {})).catch(() => ({})).then((cfg) => {
    new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).load(url, (gltf) => {
      const m = gltf.scene, vec = (v) => Array.isArray(v) && new THREE.Vector3(...v);
      m.rotation.y = Number(cfg.yaw || 0); m.updateMatrixWorld();
      const box = new THREE.Box3().setFromObject(m), size = box.getSize(new THREE.Vector3());
      m.scale.multiplyScalar(2.05 / Math.max(size.x, size.z)); m.updateMatrixWorld(); box.setFromObject(m);
      const c = box.getCenter(new THREE.Vector3()); m.position.sub(new THREE.Vector3(c.x, box.min.y, c.z));
      const holder = new THREE.Group(); holder.add(m); holder.updateMatrixWorld(true);
      const made = {}, mats = cfg.materials || {};
      const look = (name) => { const k = LOOKS[mats[name]] ? mats[name] : LOOKS[cfg.look] ? cfg.look : null; return k && (made[k] = made[k] || LOOKS[k]()); };
      const parts = [], bb = new THREE.Box3(), sz = new THREE.Vector3(), ce = new THREE.Vector3();
      m.traverse((o) => {
        if (!o.isMesh) return;
        const nm = look(o.material.name); if (nm) o.material = nm;
        bb.setFromObject(o); bb.getSize(sz); bb.getCenter(ce);
        if (sz.y > 0.15 && Math.abs(sz.x - sz.y) < 0.03 && Math.abs(ce.x) > 0.45 && ce.y < 0.45) parts.push({ o, c: ce.clone() });
      });
      const axles = [1, -1].map((side) => {
        const mine = parts.filter((p) => Math.sign(p.c.x) === side); if (!mine.length) return null;
        const ref = mine.reduce((a, p) => (p.c.y > a.c.y ? p : a)).c;
        const pivot = new THREE.Group(); pivot.position.set(ref.x, ref.y, 0); holder.add(pivot); pivot.updateMatrixWorld();
        mine.filter((p) => Math.hypot(p.c.x - ref.x, p.c.y - ref.y) < 0.03).forEach((p) => pivot.attach(p.o));
        return pivot;
      });
      if (axles[0] && axles[1]) B.wheels = axles;
      B.bike.children.forEach((ch) => { if (ch.isGroup && ch !== flames) ch.visible = false; });
      body.add(holder); modelReady = true;
      const ex = vec(cfg.exhaust), tail = vec(cfg.tail), head = vec(cfg.head);
      if (ex) flames.position.copy(ex);
      if (tail) { B.tail = new THREE.Object3D(); B.tail.position.copy(tail); body.add(B.tail); tailGlow.position.copy(tail); }
      if (head) { headGlow.position.copy(head); spot.position.copy(head); spot.target.position.set(head.x + 12, 0, 0); }
      makeGhost(holder, true);
      ready();
    }, (e) => { if (e.total && window.__load) window.__load.set(0.15 + 0.8 * e.loaded / e.total); }, ready);
  });
}
function ready() { requestAnimationFrame(() => requestAnimationFrame(() => window.__load && window.__load.done())); }
if (window.__load) window.__load.set(0.1);
loadModel(canvas.dataset.model || "assets/models/bike.glb");

/* ---------------- tail-light trail and sparks ---------------- */
const TRAIL = LITE ? 50 : 90, trailPts = [];
const trailGeo = new THREE.BufferGeometry(), trailPos = new Float32Array(TRAIL * 6), trailCol = new Float32Array(TRAIL * 6);
trailGeo.setAttribute("position", new THREE.BufferAttribute(trailPos, 3)); trailGeo.setAttribute("color", new THREE.BufferAttribute(trailCol, 3));
{ const idx = []; for (let i = 0; i < TRAIL - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } trailGeo.setIndex(idx); }
const trail = new THREE.Mesh(trailGeo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
trail.frustumCulled = false; scene.add(trail);
const SP = LITE ? 250 : 600, spPos = new Float32Array(SP * 3), spCol = new Float32Array(SP * 3), sparks = [];
for (let i = 0; i < SP; i++) sparks.push({ p: new THREE.Vector3(0, -99, 0), v: new THREE.Vector3(), life: 0, c: new THREE.Color(), g: 14 });
const spGeo = new THREE.BufferGeometry(); spGeo.setAttribute("position", new THREE.BufferAttribute(spPos, 3)); spGeo.setAttribute("color", new THREE.BufferAttribute(spCol, 3));
const spPoints = new THREE.Points(spGeo, new THREE.PointsMaterial({ size: 0.14, map: GLOW, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
spPoints.frustumCulled = false; scene.add(spPoints);
let spNext = 0;
function burst(at, n, dir, spread, speed, color, life = 0.8, g = 14) {
  for (let k = 0; k < n; k++) {
    const s = sparks[spNext++ % SP]; s.p.copy(at); s.c.set(color); s.g = g;
    s.v.set(dir.x + (rnd() - 0.5) * spread, dir.y + rnd() * spread, dir.z + (rnd() - 0.5) * spread).normalize().multiplyScalar(speed * (0.4 + rnd()));
    s.life = life * (0.5 + rnd());
  }
}

/* ---------------- post-processing ---------------- */
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.8, 0.5, 0.6); composer.addPass(bloom);
const fx = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uAb: { value: 0 }, uZoom: { value: 0 } },
  vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }",
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uAb, uZoom; varying vec2 vUv;
    void main(){ vec2 d = vUv - .5; float r = dot(d, d);
      vec3 c; c.r = texture2D(tDiffuse, vUv + d * uAb * r * 2.).r; c.g = texture2D(tDiffuse, vUv).g; c.b = texture2D(tDiffuse, vUv - d * uAb * r * 2.).b;
      if (uZoom > 0.001) { vec3 z = vec3(0.); for (int i = 1; i <= 4; i++) z += texture2D(tDiffuse, vUv - d * uZoom * float(i) * 0.03).rgb; c = mix(c, z * 0.25, smoothstep(0.02, 0.2, r) * 0.8); }
      c *= 1. - r * 0.85; gl_FragColor = vec4(c, 1.); }`
});
composer.addPass(fx); composer.addPass(new OutputPass());
const perf = { level: 0, t: 0, n: 0, wait: 3, slowT: 0 };
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false); composer.setSize(w, h);
  const div = LITE || perf.level ? (perf.level > 1 ? 4 : 2) : 1; bloom.resolution.set(w / div, h / div);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
resize(); addEventListener("resize", resize);

/* ---------------- sound: the same ZX-6R loops as the home page, driven by a six-speed gearbox ---------------- */
const ENGINE = [["idle", 1230, 0.75], ["mid", 5340, 0.95], ["high", 8900, 0.65], ["top", 12300, 0.9]];
const GEARS = [24, 37, 49, 61, 74, 92]; // m/s at the redline in each gear
const snd = { ctx: null, on: store.get("ride-sound") !== false, layers: [], rpm: 1230, load: 0, last: 0 };
function initAudio() {
  if (snd.ctx) return;
  const ctx = new (window.AudioContext || window.webkitAudioContext)(); snd.ctx = ctx;
  const master = ctx.createGain(); master.gain.value = 0; snd.master = master;
  const tone = ctx.createBiquadFilter(); tone.type = "lowpass"; tone.frequency.value = 2000; tone.Q.value = 0.5; snd.tone = tone;
  tone.connect(master).connect(ctx.destination);
  Promise.all(ENGINE.map(([n, , len]) => fetch("assets/audio/engine-" + n + ".mp3").then((r) => r.arrayBuffer()).then((a) => new Promise((ok, no) => ctx.decodeAudioData(a, ok, no))).then((buf) => {
    const src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = buf; src.loop = true; src.loopStart = 0.15; src.loopEnd = 0.15 + len; g.gain.value = 0; src.connect(g).connect(tone); src.start(0, 0.15);
    return { src, g };
  }))).then((l) => { snd.layers = l; }).catch(() => {});
}
function audioTick(rpm, load) {
  snd.rpm = rpm; snd.load = load;
  if (!snd.ctx || !snd.layers.length) return;
  const now = snd.ctx.currentTime;
  let i = 0; while (i < ENGINE.length - 2 && rpm > ENGINE[i + 1][1]) i++;
  const x = clamp(Math.log(rpm / ENGINE[i][1]) / Math.log(ENGINE[i + 1][1] / ENGINE[i][1]), 0, 1);
  snd.layers.forEach((l, k) => {
    const g = k === i ? Math.cos(x * Math.PI / 2) : k === i + 1 ? Math.sin(x * Math.PI / 2) : 0;
    l.want = g; l.g.gain.setTargetAtTime(g, now, 0.03); l.src.playbackRate.setTargetAtTime(clamp(rpm / ENGINE[k][1], 0.5, 2.5), now, 0.03);
  });
  snd.tone.frequency.setTargetAtTime(1200 + 5500 * load + rpm * 0.3, now, 0.05);
  snd.master.gain.setTargetAtTime(snd.on && game.mode !== "pause" ? 0.85 * (0.55 + 0.45 * load) : 0, now, 0.08);
}
document.addEventListener("visibilitychange", () => { if (!snd.ctx) return; if (document.hidden) snd.ctx.suspend(); else snd.ctx.resume(); if (document.hidden && game.mode === "run") pause(true); });

/* ---------------- input: keyboard and touch ---------------- */
const keys = new Set(), touch = { up: 0, down: 0, left: 0, right: 0, nitro: 0 };
const KEYMAP = { KeyW: "up", ArrowUp: "up", KeyS: "down", ArrowDown: "down", KeyA: "left", ArrowLeft: "left", KeyD: "right", ArrowRight: "right", Space: "nitro", ShiftLeft: "nitro", ShiftRight: "nitro" };
addEventListener("keydown", (e) => {
  if (e.target.closest && e.target.closest("button, a") && (e.code === "Space" || e.code === "Enter")) return; // let buttons work from the keyboard
  const k = KEYMAP[e.code];
  if (k) { keys.add(k); e.preventDefault(); }
  if (e.repeat) return;
  if (e.code === "Escape" || e.code === "KeyP") { if (game.mode === "run" || game.mode === "count") pause(true); else if (game.mode === "pause") pause(false); }
  if (e.code === "KeyR" && game.mode === "run") { reset(C, R); flashMsg("Back on the road"); }
  if (e.code === "KeyM") toggleSound();
  if (e.code === "KeyC") { game.cam = (game.cam + 1) % 3; flashMsg(["Chase camera", "Far camera", "Low camera"][game.cam]); }
  if (e.code === "Enter" && game.mode === "menu") start();
});
addEventListener("keyup", (e) => { const k = KEYMAP[e.code]; if (k) keys.delete(k); });
addEventListener("blur", () => keys.clear());
document.querySelectorAll("[data-touch]").forEach((b) => {
  const k = b.dataset.touch, on = (e) => { e.preventDefault(); touch[k] = 1; b.classList.add("is-on"); if (b.setPointerCapture) b.setPointerCapture(e.pointerId); }, off = () => { touch[k] = 0; b.classList.remove("is-on"); };
  b.addEventListener("pointerdown", on); b.addEventListener("pointerup", off); b.addEventListener("pointercancel", off); b.addEventListener("lostpointercapture", off);
  b.addEventListener("contextmenu", (e) => e.preventDefault());
});
const input = () => ({ up: keys.has("up") || touch.up ? 1 : 0, down: keys.has("down") || touch.down ? 1 : 0, left: keys.has("left") || touch.left ? 1 : 0, right: keys.has("right") || touch.right ? 1 : 0, nitro: keys.has("nitro") || touch.nitro ? 1 : 0 });

/* ---------------- game state ---------------- */
let R = newRider(C);
const best = store.get("ride-best") || null; // { time, splits }
const game = { mode: "menu", time: 0, count: 0, gate: 0, splits: [], orbs: 0, top: 0, air: 0, airNow: 0, jumps: 0, cam: 0, gear: 0, rpm: 1230, shift: 0, rec: [], recT: 0, ghost: store.get("ride-ghost"), zone: -1, best };
const HUD = { zone: $("h-zone"), cp: $("h-cp"), time: $("h-time"), best: $("h-best"), orbs: $("h-orbs"), speed: $("h-speed"), gear: $("h-gear"), rpm: $("h-rpm"), nitro: $("h-nitro"), msg: $("h-msg"), big: $("h-big"), delta: $("h-delta") };
$("h-orbs-n").textContent = C.orbs.length;
const fmt = (t) => { if (t == null) return "–"; const m = Math.floor(t / 60), s = t - m * 60; return m + ":" + (s < 10 ? "0" : "") + s.toFixed(1); };
HUD.best.textContent = "Best " + fmt(best && best.time);
$("st-best").textContent = best ? "Your best: " + fmt(best.time) : "No best time yet";
$("st-length").textContent = (C.length / 1000).toFixed(1) + " km · " + C.zones.length + " zones · " + C.ramps.length + " jumps · " + C.orbs.length + " sparkles";
if (TOUCH) document.documentElement.classList.add("is-touch");
let msgTimer = 0;
function flashMsg(t, ms = 1600) { HUD.msg.textContent = t; HUD.msg.classList.add("is-on"); clearTimeout(msgTimer); msgTimer = setTimeout(() => HUD.msg.classList.remove("is-on"), ms); }
function big(t, cls = "") { HUD.big.textContent = t; HUD.big.className = "hud__big"; void HUD.big.offsetWidth; HUD.big.className = "hud__big is-on " + cls; } // re-adding the class restarts the animation
function show(id) { ["s-start", "s-pause", "s-done", "s-slow"].forEach((s) => { $(s).hidden = s !== id; }); $("hud").hidden = id === "s-start" || id === "s-done"; $("touch").hidden = !TOUCH || id !== null; }

function start() {
  initAudio(); if (snd.ctx) snd.ctx.resume();
  C.orbs.forEach((o) => { o.got = false; });
  R = newRider(C);
  Object.assign(game, { mode: "count", time: 0, count: 3.999, gate: 0, splits: [], orbs: 0, top: 0, air: 0, jumps: 0, rec: [], recT: 0, zone: -1, ghost: store.get("ride-ghost") });
  HUD.orbs.textContent = "0"; HUD.cp.textContent = "Checkpoint 0/" + (C.gates.length - 1); HUD.delta.textContent = "";
  show(null); big("3");
}
function pause(on) {
  if (on && (game.mode === "run" || game.mode === "count")) { game.before = game.mode; game.mode = "pause"; show("s-pause"); keys.clear(); Object.keys(touch).forEach((k) => (touch[k] = 0)); $("p-resume").focus(); }
  else if (!on && game.mode === "pause") { game.mode = game.before; show(null); }
}
function finish() {
  game.mode = "done";
  const t = game.time, prev = store.get("ride-best"), isBest = !prev || t < prev.time;
  if (isBest) { store.set("ride-best", { time: t, splits: game.splits }); store.set("ride-ghost", game.rec); }
  $("d-time").textContent = fmt(t);
  $("d-best").textContent = isBest ? (prev ? "New best! " + (prev.time - t).toFixed(1) + " s faster" : "First run, that's your best") : "Best " + fmt(prev.time) + " (+" + (t - prev.time).toFixed(1) + " s)";
  $("d-orbs").textContent = game.orbs + " / " + C.orbs.length;
  $("d-top").textContent = Math.round(game.top * 3.6) + " km/h";
  $("d-air").textContent = game.air.toFixed(1) + " s over " + game.jumps + " jumps";
  HUD.best.textContent = "Best " + fmt(isBest ? t : prev.time);
  game.best = isBest ? { time: t, splits: game.splits } : prev;
  const fin = at(C, C.N - 20);
  for (let k = 0; k < 6; k++) setTimeout(() => burst(new THREE.Vector3(fin[0] + (rnd() - 0.5) * 30, 16 + rnd() * 10, fin[1] + (rnd() - 0.5) * 30), 60, new THREE.Vector3(0, 0, 0), 2, 14, new THREE.Color().setHSL(rnd(), 0.8, 0.6), 1.6, 3), k * 280);
  setTimeout(() => { if (game.mode === "done") { show("s-done"); $("d-again").focus(); } }, 1800);
}
function toggleSound() {
  initAudio(); snd.on = !snd.on; store.set("ride-sound", snd.on); if (snd.ctx) snd.ctx.resume();
  document.querySelectorAll("[data-sound]").forEach((b) => { b.setAttribute("aria-pressed", String(snd.on)); b.querySelector("span").textContent = snd.on ? "Sound on" : "Sound off"; });
}
document.querySelectorAll("[data-sound]").forEach((b) => { b.setAttribute("aria-pressed", String(snd.on)); b.querySelector("span").textContent = snd.on ? "Sound on" : "Sound off"; b.addEventListener("click", toggleSound); });
$("st-go").addEventListener("click", start);
$("p-resume").addEventListener("click", () => pause(false));
$("p-restart").addEventListener("click", start);
$("d-again").addEventListener("click", start);
$("h-pause").addEventListener("click", () => pause(true));
$("slow-keep").addEventListener("click", () => { perf.ignore = true; pause(false); if (game.mode !== "pause") show(null); });

/* ---------------- minimap ---------------- */
const map = $("h-map"), mctx = map.getContext("2d"), MS = 170;
map.width = map.height = MS * 2;
let mnx = Infinity, mxx = -Infinity, mnz = Infinity, mxz = -Infinity;
for (let i = 0; i < C.N; i += 10) { mnx = Math.min(mnx, C.x[i]); mxx = Math.max(mxx, C.x[i]); mnz = Math.min(mnz, C.z[i]); mxz = Math.max(mxz, C.z[i]); }
const msc = (MS * 2 - 28) / Math.max(mxx - mnx, mxz - mnz), mox = (MS * 2 - (mxx - mnx) * msc) / 2, moz = (MS * 2 - (mxz - mnz) * msc) / 2;
const mp = (x, z) => [mox + (x - mnx) * msc, moz + (z - mnz) * msc];
function drawMap() {
  mctx.clearRect(0, 0, MS * 2, MS * 2);
  mctx.lineCap = mctx.lineJoin = "round";
  for (let zi = 0; zi < Z.length; zi++) {
    const z = Z[zi]; mctx.beginPath();
    for (let i = z.s; i <= Math.min(C.N - 1, z.e); i += 12) { const [a, b] = mp(C.x[i], C.z[i]); i === z.s ? mctx.moveTo(a, b) : mctx.lineTo(a, b); }
    mctx.strokeStyle = "#" + z.edge.getHexString(); mctx.globalAlpha = R.best >= z.s ? 0.95 : 0.3; mctx.lineWidth = 5; mctx.stroke();
  }
  mctx.globalAlpha = 1;
  C.gates.forEach((s, i) => { const [a, b] = mp(C.x[s], C.z[s]); mctx.fillStyle = i < game.gate ? "#fff" : "rgba(255,255,255,.45)"; mctx.beginPath(); mctx.arc(a, b, 5, 0, 7); mctx.fill(); });
  if (ghost.visible) { const [a, b] = mp(ghost.position.x, ghost.position.z); mctx.fillStyle = "#9a8cff"; mctx.beginPath(); mctx.arc(a, b, 6, 0, 7); mctx.fill(); }
  const [a, b] = mp(R.x, R.z);
  mctx.save(); mctx.translate(a, b); mctx.rotate(-R.yaw); mctx.fillStyle = "#fff"; mctx.shadowColor = "#fff"; mctx.shadowBlur = 10;
  mctx.beginPath(); mctx.moveTo(12, 0); mctx.lineTo(-7, -7); mctx.lineTo(-3, 0); mctx.lineTo(-7, 7); mctx.closePath(); mctx.fill(); mctx.restore();
}

/* ---------------- per-frame ---------------- */
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3(), tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();
let shake = 0, camYaw = R.yaw, firstFrame = true, menuA = 0, flamePop = 0, frameN = 0;
const zc = { top: new THREE.Color(), hor: new THREE.Color(), glow: new THREE.Color(), fog: new THREE.Color(), edge: new THREE.Color(), light: new THREE.Color(), den: 0.004, w: [1, 0, 0, 0, 0] };
function blendZone(s) {
  // looks blend over the 150 m either side of a zone change
  const i = C.zoneAt(s), a = Z[i], nx = Z[Math.min(Z.length - 1, i + 1)], pv = Z[Math.max(0, i - 1)];
  let b = a, f = 0;
  if (s > a.e - 150 && nx !== a) { b = nx; f = smooth(a.e - 150, a.e + 150, s); }
  else if (s < a.s + 150 && pv !== a) { b = pv; f = 1 - smooth(a.s - 150, a.s + 150, s); }
  ["top", "hor", "glow", "fog", "edge", "light"].forEach((k) => zc[k].copy(a[k]).lerp(b[k], f));
  zc.den = a.den + (b.den - a.den) * f;
  zc.w = [0, 0, 0, 0, 0]; zc.w[a.ground] += 1 - f; zc.w[b.ground] += f;
  return i;
}

function gearbox(dt, inp) {
  const v = Math.abs(R.v);
  if (game.mode !== "run") { // free revs before the start
    const want = 1230 + inp.up * 8800;
    game.rpm += (want - game.rpm) * (1 - Math.exp(-dt * (want > game.rpm ? 6 : 2.6)));
    game.gear = 0; return;
  }
  let g = game.gear, rpm = 1230 + 11270 * v / GEARS[g];
  if (rpm > 12100 && g < GEARS.length - 1) { while (g < GEARS.length - 1 && 1230 + 11270 * v / GEARS[g] > 12100) g++; game.shift = 0.12; flamePop = 0.7; }
  else if (g > 0 && 1230 + 11270 * v / GEARS[g - 1] < 9800) { g--; flamePop = 0.4; }
  game.gear = g;
  rpm = 1230 + 11270 * v / GEARS[g];
  if (g === 0) rpm = Math.max(rpm, 1230 + inp.up * 3200 * (1 - v / GEARS[0])); // clutch slip off the line
  if (R.air) rpm = Math.min(12500, game.rpm + (inp.up ? 9000 : -4000) * dt); // wheel spins free in the air
  if (game.shift > 0) { game.shift -= dt; rpm *= 0.93; }
  game.rpm += (clamp(rpm, 1150, 12600) - game.rpm) * (1 - Math.exp(-dt * 12));
}

function tick(dt, raw) {
  const t = performance.now() / 1000; U.uTime.value = t;
  const inp = game.mode === "run" ? input() : { up: game.mode === "pause" ? 0 : input().up, down: 0, left: 0, right: 0, nitro: 0 };
  if (game.mode === "count") {
    const before = Math.ceil(game.count); game.count -= Math.min(raw, 0.25); const now = Math.ceil(game.count); // real seconds, even on a slow device
    if (now !== before) now > 0 ? big(String(now)) : big("GO", "is-go");
    if (game.count <= 0) { game.mode = "run"; game.recT = 0; }
  }
  if (game.mode === "run") {
    game.time += dt;
    // physics in small fixed steps
    let left = dt; const ev = {};
    while (left > 1e-6) { const h = Math.min(1 / 120, left); left -= h; const e = step(C, R, inp, h); for (const k in e) ev[k] = (ev[k] || 0) + (typeof e[k] === "number" ? e[k] : 1); }
    game.top = Math.max(game.top, R.v);
    if (R.air) game.airNow += dt;
    if (ev.launch) { game.jumps++; game.airNow = 0; }
    if (ev.land) { shake = Math.max(shake, 0.25 * Math.min(1, ev.land)); burst(tmp.set(R.x, 0.1, R.z), 90, tmp2.set(-Math.cos(R.yaw), 0.5, Math.sin(R.yaw)), 1.6, 9, 0xffb070); game.air += game.airNow; if (game.airNow > 0.8) flashMsg("Air time " + game.airNow.toFixed(1) + " s"); }
    if (ev.pad) { flamePop = 1.2; shake = Math.max(shake, 0.12); flashMsg("Boost!", 900); }
    if (ev.orb) { game.orbs += ev.orb; HUD.orbs.textContent = game.orbs; burst(tmp.set(R.x, 1.3, R.z), 24, tmp2.set(0, 1, 0), 2, 5, zc.edge, 0.6, 4); }
    if (ev.hit) { shake = Math.max(shake, 0.3 * Math.min(1, ev.hit)); burst(tmp.set(R.x, 0.6, R.z), 30, tmp2.set(0, 0.6, 0), 2, 6, 0xffd0a0, 0.5); }
    if (ev.reset) flashMsg("Back on the road");
    // checkpoints
    if (game.gate < C.gates.length && R.best >= C.gates[game.gate]) {
      const last = game.gate === C.gates.length - 1, split = game.time; game.splits.push(split);
      const ref = game.best && game.best.splits && game.best.splits[game.gate];
      if (ref != null) { const d = split - ref; HUD.delta.textContent = (d < 0 ? "−" : "+") + Math.abs(d).toFixed(1) + " s"; HUD.delta.className = "hud__delta " + (d < 0 ? "is-ahead" : "is-behind"); }
      game.gate++;
      HUD.cp.textContent = "Checkpoint " + Math.min(game.gate, C.gates.length - 1) + "/" + (C.gates.length - 1);
      if (last) { big("FINISH", "is-go"); finish(); }
    }
    // record for the ghost, 10 times a second
    game.recT -= dt; if (game.recT <= 0) { game.recT += 0.1; game.rec.push([+R.x.toFixed(2), +R.z.toFixed(2), +R.yaw.toFixed(3), +R.y.toFixed(2), +R.lean.toFixed(2)]); }
    // warnings
    const wrong = R.v > 6 && Math.cos(R.yaw - C.h[R.idx]) < -0.3, lost = R.far > 0.3;
    HUD.msg.dataset.warn = wrong ? "Wrong way" : lost ? "Get back on the road" : R.off ? "Off the road" : "";
  } else if (game.mode === "done") {
    // roll to a stop past the line
    step(C, R, { up: 0, down: R.v > 8 ? 0.5 : 0, left: 0, right: 0, nitro: 0 }, dt);
  }
  gearbox(dt, inp);
  const zi = blendZone(R.idx);
  if (zi !== game.zone && game.mode !== "menu") { if (game.zone >= 0) big("Zone " + (zi + 1) + " · " + Z[zi].name, "is-zone"); game.zone = zi; HUD.zone.textContent = "Zone " + (zi + 1) + " · " + Z[zi].name; }
  else if (game.mode === "menu") HUD.zone.textContent = "Zone 1 · " + Z[0].name;
  render(t, dt, inp);
  if (++frameN % 3 === 0 || firstFrame) drawMap();
  hud();
  audioTick(game.rpm, inp.up ? 1 : R.boosting ? 0.8 : 0.15);
  firstFrame = false;
}

function render(t, dt, inp) {
  // zone looks
  sky.material.uniforms.uTop.value.copy(zc.top); sky.material.uniforms.uHor.value.copy(zc.hor); sky.material.uniforms.uGlow.value.copy(zc.glow);
  U.uFog.value.copy(zc.fog); U.uDen.value = zc.den; scene.fog.color.copy(zc.fog); scene.fog.density = zc.den * 0.9;
  ground.material.uniforms.uW.value = zc.w; ground.material.uniforms.uTint.value.copy(zc.edge);
  stars.material.opacity = 1 - zc.w[2] * 0.7; // fewer stars in the canyon's sunset
  hemi.color.copy(zc.light); moon.color.copy(zc.light).lerp(new THREE.Color(1, 1, 1), 0.5);
  const inTunnel = C.tunnel && R.idx > C.tunnel[0] && R.idx < C.tunnel[1];
  hemi.intensity += ((inTunnel ? 0.2 : 0.5) - hemi.intensity) * 0.05;

  // bike
  const wh = Math.sin(R.wheelie);
  bike.position.set(R.x, R.y + 0.75 * wh * 0.5, R.z);
  bike.rotation.set(R.lean, R.yaw, R.pitch + R.wheelie);
  const spin = R.v * dt / 0.42; B.wheels[0].rotation.z -= spin; B.wheels[1].rotation.z -= spin * (inp.up && Math.abs(R.v) < 6 && game.mode === "run" ? 1.6 : 1);
  body.position.y = 0.004 * Math.sin(t * 90) * (1 - clamp(R.v / 30, 0, 1)) + 0.003 * Math.sin(t * 140) * game.rpm / 12000;
  tailGlow.material.opacity = 0.4 + (inp.down ? 0.5 : 0); // brighter on the brakes
  // flames
  flamePop *= Math.exp(-dt * 5);
  const power = clamp((R.boosting ? 1 : 0) + flamePop + (game.mode !== "run" && inp.up ? 0.25 : 0), 0, 1.4);
  flameLayers.forEach((m, i) => { m.material.uniforms.uT.value = t; m.material.uniforms.uP.value = power * (1.1 - i * 0.15); m.scale.set(1, 0.35 + power * (0.9 + 0.2 * Math.sin(t * 50 + i)), 1); });
  flameLight.intensity = power * 22;
  if (power > 0.4 && rnd() < power * 0.6) { bike.updateMatrixWorld(); burst(flames.getWorldPosition(tmp), 2, tmp2.copy(B.exhaustDir).applyQuaternion(body.getWorldQuaternion(new THREE.Quaternion())), 0.8, 4 + power * 4, 0xff9a40, 0.35, 2); }
  // ghost
  const gr = game.ghost;
  if (gr && gr.length > 2 && (game.mode === "run" || game.mode === "done")) {
    const f = game.time / 0.1, i = Math.min(gr.length - 2, Math.floor(f)), u = Math.min(1, f - i), a = gr[i], b = gr[i + 1];
    ghost.visible = f < gr.length;
    ghost.position.set(a[0] + (b[0] - a[0]) * u, a[3] + (b[3] - a[3]) * u, a[1] + (b[1] - a[1]) * u);
    ghost.rotation.set(a[4] + (b[4] - a[4]) * u, a[2] + Math.atan2(Math.sin(b[2] - a[2]), Math.cos(b[2] - a[2])) * u, 0);
  } else ghost.visible = false;

  // trail
  bike.updateMatrixWorld();
  const tp = B.tail.getWorldPosition(new THREE.Vector3());
  if (firstFrame || trailPts.length < TRAIL) while (trailPts.length < TRAIL) trailPts.push(tp.clone());
  trailPts.unshift(tp); trailPts.length = TRAIL;
  const red = new THREE.Color(1, 0.3, 0.4), sp = clamp(Math.abs(R.v) / 40, 0, 1);
  for (let i = 0; i < TRAIL; i++) {
    const f = i / (TRAIL - 1), w = 0.06 * (1 - f) + 0.006, q = trailPts[i];
    trailPos.set([q.x, q.y + w, q.z, q.x, q.y - w, q.z], i * 6);
    tcol.copy(zc.edge).lerp(red, 1 - f).multiplyScalar((1 - f) * sp * 1.3); tcol.toArray(trailCol, i * 6); tcol.toArray(trailCol, i * 6 + 3);
  }
  trailGeo.attributes.position.needsUpdate = true; trailGeo.attributes.color.needsUpdate = true;
  // sparks and smoke-free particles
  if (R.off && Math.abs(R.v) > 8 && rnd() < 0.5) burst(tmp.set(R.x, 0.1, R.z), 2, tmp2.set(-Math.cos(R.yaw), 0.8, Math.sin(R.yaw)), 1.2, 4, 0x9a7a60, 0.5);
  for (let i = 0; i < SP; i++) {
    const s = sparks[i];
    if (s.life > 0) { s.life -= dt; s.v.y -= s.g * dt; s.p.addScaledVector(s.v, dt); if (s.p.y < 0.03) { s.p.y = 0.03; s.v.y *= -0.35; s.v.x *= 0.7; s.v.z *= 0.7; } }
    const l = clamp(s.life * 1.6, 0, 1);
    spPos[i * 3] = s.p.x; spPos[i * 3 + 1] = s.life > 0 ? s.p.y : -99; spPos[i * 3 + 2] = s.p.z;
    spCol[i * 3] = s.c.r * 2 * l; spCol[i * 3 + 1] = s.c.g * 2 * l; spCol[i * 3 + 2] = s.c.b * 2 * l;
  }
  spGeo.attributes.position.needsUpdate = true; spGeo.attributes.color.needsUpdate = true;
  placeOrbs(t, R.idx - 30, R.idx + 450);

  // camera
  const v = Math.abs(R.v), fwd = tmp.set(Math.cos(camYaw), 0, -Math.sin(camYaw));
  if (game.mode === "menu") {
    menuA += dt * 0.25;
    camPos.set(R.x + Math.sin(menuA) * 6.5, 1.7, R.z + Math.cos(menuA) * 6.5); camLook.set(R.x, 0.8, R.z);
    camYaw = R.yaw;
  } else {
    camYaw += Math.atan2(Math.sin(R.yaw - camYaw), Math.cos(R.yaw - camYaw)) * (1 - Math.exp(-dt * (R.air ? 2 : 5)));
    const [dist, hgt] = [[5.6 + v * 0.03, 1.9 + v * 0.008], [9 + v * 0.04, 3.4 + v * 0.01], [3.6 + v * 0.02, 0.8]][game.cam];
    const want = tmp2.set(R.x, R.y * 0.6, R.z).addScaledVector(fwd, -dist); want.y += hgt;
    camPos.lerp(want, firstFrame || game.mode === "count" ? 1 : 1 - Math.exp(-dt * 10));
    camLook.set(R.x, R.y * 0.8 + 0.9, R.z).addScaledVector(fwd, 5);
  }
  shake *= Math.exp(-dt * 5);
  const rumble = (R.off && v > 5 ? 0.04 : 0) + (R.boosting ? 0.02 : 0);
  camera.position.copy(camPos).add(tmp.set(Math.sin(t * 73) * (shake + rumble), Math.sin(t * 91) * (shake + rumble), Math.sin(t * 67) * shake));
  camera.lookAt(camLook);
  const fovWant = 58 + v * 0.16 + (R.boosting ? 8 : 0);
  camera.fov += (fovWant - camera.fov) * (1 - Math.exp(-dt * 3)); camera.updateProjectionMatrix();
  camera.rotation.z += -R.lean * 0.12; // the horizon tilts a little with the lean
  U.uCam.value.copy(camera.position);
  ground.position.set(Math.round(camera.position.x / 50) * 50, -0.04, Math.round(camera.position.z / 50) * 50);
  sky.position.copy(camera.position); stars.position.copy(camera.position);
  moon.position.set(R.x - 60, 120, R.z + 80); moon.target.position.set(R.x, 0, R.z);
  keyLight.position.copy(camera.position).add(tmp.set(-1.5, 3.5, 0)); keyLight.target.position.copy(bike.position);
  fx.uniforms.uAb.value = REDUCED ? 0 : 0.003 + v * 0.00012 + shake * 0.05;
  fx.uniforms.uZoom.value = REDUCED || LITE ? 0 : (R.boosting ? 0.6 : 0) + smooth(60, 90, v) * 0.4;
  bloom.strength = 0.75 + (R.boosting ? 0.25 : 0);
  composer.render(dt);
}

function hud() {
  HUD.time.textContent = fmt(game.time);
  HUD.speed.textContent = Math.round(Math.abs(R.v) * 3.6);
  HUD.gear.textContent = game.mode === "run" ? (R.v < -0.5 ? "R" : String(game.gear + 1)) : "N";
  HUD.rpm.style.transform = "scaleX(" + clamp(game.rpm / 13000, 0, 1).toFixed(3) + ")";
  HUD.rpm.parentNode.classList.toggle("is-red", game.rpm > 11500);
  HUD.nitro.style.transform = "scaleX(" + R.nitro.toFixed(3) + ")";
  HUD.nitro.parentNode.classList.toggle("is-on", R.boosting);
  const w = HUD.msg.dataset.warn || "";
  $("h-warn").textContent = w; $("h-warn").classList.toggle("is-on", !!w);
}

/* ---------------- speed governor: lighter effects on slow devices; phones that stay slow are told so ---------------- */
function governor(raw) {
  if (raw > 0.5 || !document.documentElement.classList.contains("is-loaded")) return;
  if (perf.wait > 0) { perf.wait -= raw; return; }
  perf.t += raw; perf.n++;
  if (perf.t < 2) return;
  const ms = perf.t / perf.n * 1000; perf.t = perf.n = 0;
  if (ms < 26) { perf.slowT = 0; return; }
  if (perf.level < 2) {
    perf.level++; perf.wait = 1.5;
    renderer.setPixelRatio(perf.level === 1 ? Math.min(renderer.getPixelRatio(), 1) : 0.7);
    if (perf.level === 2) bloom.enabled = false;
    resize(); return;
  }
  // a phone still under ~22 fps at the lightest settings: say so, and offer the way back
  if (TOUCH && ms > 45 && !perf.ignore) { perf.slowT += 2; if (perf.slowT >= 4 && (game.mode === "run" || game.mode === "count")) { pause(true); show("s-slow"); perf.ignore = true; } }
}

/* ---------------- loop ---------------- */
const clock = new THREE.Clock();
(function loop() {
  const raw = clock.getDelta(), dt = Math.min(raw, 0.05);
  if (!document.hidden) { tick(game.mode === "pause" ? 0 : dt, raw); governor(raw); }
  requestAnimationFrame(loop);
})();
document.documentElement.classList.add("has-gl");

// test hooks
window.__game = {
  C, get R() { return R; }, game, keys, touch, perf: () => ({ level: perf.level, ratio: renderer.getPixelRatio() }), model: () => modelReady,
  audio: () => ({ on: snd.on, state: snd.ctx && snd.ctx.state, rpm: Math.round(snd.rpm), layers: snd.layers.length }),
  jump: (s) => { R.best = s + 10; reset(C, R); R.v = 30; firstFrame = true; camYaw = R.yaw; }, // reset() lands 10 m behind your furthest point finishNow: () => { game.gate = C.gates.length - 1; R.best = C.gates[C.gates.length - 1]; },
  tick: (dt) => tick(dt, dt), TUNE
};
