// Ride mode scenery: each of the ten zones builds its own world here, plus the moving parts (traffic, the desert
// train, the avalanche, the helicopter, fireworks, snow). game.js owns the camera, the bike and the HUD.
import * as THREE from "three";
import { at, HALF } from "./course.js";

const dummy = new THREE.Object3D(), tcol = new THREE.Color();
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// one InstancedMesh for a list of things; place(o, dummy, colour) sets each one up
export function instanced(scene, geo, mat, list, place, colored = false) {
  if (!list.length) return null;
  const m = new THREE.InstancedMesh(geo, mat, list.length);
  list.forEach((o, i) => { tcol.set(0xffffff); place(o, dummy, tcol, i); dummy.updateMatrix(); m.setMatrixAt(i, dummy.matrix); if (colored) m.setColorAt(i, tcol); dummy.position.set(0, 0, 0); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1); });
  m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true;
  m.computeBoundingSphere(); scene.add(m); return m;
}

export function buildZones(E) {
  const { scene, C, Z, U, FOG, LITE, GLOW } = E, rnd = C.rnd;
  const live = []; // per-frame updaters: (t, dt, R, cam, zi) => void
  const thin = (n) => (LITE ? Math.ceil(n * 0.5) : n);
  const step = (s) => (LITE ? s * 1.8 : s);
  const std = (o) => new THREE.MeshStandardMaterial(o);
  const glow = (c, k = 2) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k) });
  const add = (geo, mat, list, place, colored) => instanced(scene, geo, mat, list, place, colored);
  const solid = (x, z, r, hgt) => C.addSolid({ x, z, r, hgt });
  // a strip running along the road between two lateral offsets
  function ribbon(s0, s1, l0, l1, y, mat, st = 4) {
    const pos = [], idx = []; let row = 0;
    for (let s = s0; s <= s1; s += st, row++) { const a = at(C, s, l0), b = at(C, s, l1); pos.push(a[0], y, a[1], b[0], y, b[1]); if (row) { const q = (row - 1) * 2; idx.push(q, q + 2, q + 1, q + 1, q + 2, q + 3); } }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat); m.frustumCulled = false; scene.add(m); return m;
  }
  // an upright wall along the road (sides of the bridge deck, snow banks, sea walls)
  function wall(s0, s1, lat, y0, y1, mat, st = 4) {
    const pos = [], idx = []; let row = 0;
    for (let s = s0; s <= s1; s += st, row++) { const a = at(C, s, lat); pos.push(a[0], y0, a[1], a[0], y1, a[1]); if (row) { const q = (row - 1) * 2; idx.push(q, q + 2, q + 1, q + 1, q + 2, q + 3); } }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat); m.frustumCulled = false; scene.add(m); return m;
  }
  const side = () => (rnd() < 0.5 ? -1 : 1);

  // towers with lit windows, shaded from each instance's own size so the windows stay square
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
      ${FOG}
      float h21(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }
      void main(){
        vec2 f = abs(vN.x) > 0.5 ? vL.zy : vL.xy;
        vec2 cell = floor(f / vec2(2.4, 3.4)), q = fract(f / vec2(2.4, 3.4));
        float lit = step(0.74, h21(cell + vC.r * 17. + vC.g * 5.)) * step(0.18, q.x) * step(q.x, 0.82) * step(0.22, q.y) * step(q.y, 0.78);
        vec3 c = vec3(0.022, 0.024, 0.04) + vec3(0.03) * max(0., vN.y);
        if (abs(vN.y) < 0.5) c += mix(vec3(1.0, 0.82, 0.55), vec3(0.75, 0.85, 1.0), h21(cell * 0.7)) * lit * (0.28 + 0.34 * h21(cell * 3.1));
        c += vC * step(0.988, fract(vL.y / 22.)) * 1.2; // trim lines
        gl_FragColor = vec4(fogged(c, vW), 1.);
      }`
  });
  const box = new THREE.BoxGeometry(1, 1, 1);
  const towerPlace = (o, d, c) => { d.position.set(o.x, o.hgt / 2, o.z); d.rotation.set(0, o.rot, 0); d.scale.set(o.w, o.hgt, o.d); c.copy(o.col || Z[o.zone].edge); };
  const skyline = (s0, s1, near, far, every, hmin, hmax, zi) => {
    const list = [];
    for (let s = s0; s < s1; s += step(every)) for (const sd of [-1, 1]) {
      const off = near + rnd() * (far - near), p = at(C, s, sd * off), w = 18 + rnd() * 30;
      if (C.clear(p[0], p[1], w)) list.push({ x: p[0], z: p[1], w, d: w * (0.7 + rnd() * 0.6), hgt: hmin + rnd() * rnd() * (hmax - hmin), rot: rnd() * 3, zone: zi });
    }
    add(box, towerMat, list, towerPlace, true);
  };

  // pole lamps along the road
  const lamps = (zn, every, color, latOff = HALF + 1.2, hgt = 6) => {
    const list = [];
    for (let s = zn.s; s < zn.e; s += step(every)) for (const sd of [-1, 1]) list.push({ s, lat: sd * latOff });
    add(new THREE.CylinderGeometry(0.07, 0.1, hgt, 6).translate(0, hgt / 2, 0), std({ color: 0x1b1f2e, metalness: 0.8, roughness: 0.35 }), list, (o, d) => { const p = at(C, o.s, o.lat); d.position.set(p[0], 0, p[1]); });
    add(new THREE.SphereGeometry(0.25, 10, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }), list, (o, d, c) => { const p = at(C, o.s, o.lat * 0.9); d.position.set(p[0], hgt + 0.1, p[1]); c.set(color).multiplyScalar(2.4); }, true);
  };

  /* ================= the zones ================= */
  const B = {};

  // 1 · Midtown: avenues walled with towers, cross streets, traffic lights, billboards, a helicopter overhead
  B.city = (zn, zi) => {
    const front = [], roofs = [], spires = [], signals = [], boards = [];
    for (const sd of [-1, 1]) {
      let s = zn.s + 10;
      while (s < zn.e - 10) {
        const w = 18 + rnd() * 18;
        if ((s - zn.s) % 120 < w && s > zn.s + 60) { // a cross street
          const p = at(C, s + 9, sd * (HALF + 2.2)); signals.push({ x: p[0], z: p[1], rot: C.h[Math.round(s)], sd, s: s + 9 });
          s += 26; continue;
        }
        const d = 22 + rnd() * 18, off = HALF + 4.5 + d / 2, p = at(C, s + w / 2, sd * off), hgt = 40 + rnd() * rnd() * 240;
        const o = { x: p[0], z: p[1], w, d, hgt, rot: C.h[Math.round(s + w / 2)], zone: zi };
        if (C.clear(p[0], p[1], Math.min(w, d) * 0.45)) {
          front.push(o); solid(p[0], p[1], d / 2 - 0.5, hgt);
          if (hgt < 110 && rnd() < 0.35) roofs.push({ x: p[0] + (rnd() - 0.5) * w * 0.4, z: p[1] + (rnd() - 0.5) * d * 0.4, y: hgt });
          if (hgt > 190) spires.push({ x: p[0], z: p[1], y: hgt, k: 20 + rnd() * 30 });
          if (rnd() < 0.3 && hgt > 30) { const q = at(C, s + w / 2, sd * (HALF + 4.4)); boards.push({ x: q[0], z: q[1], rot: C.h[Math.round(s + w / 2)] + (sd > 0 ? 0 : Math.PI), y: 9 + rnd() * 14, w: Math.min(w - 4, 14), seed: rnd() }); }
        }
        s += w + 1.5;
      }
    }
    add(box, towerMat, front, towerPlace, true);
    skyline(zn.s - 200, zn.e + 200, 70, 420, 22, 60, 320, zi);
    // water towers and spires on the roofs
    add(new THREE.CylinderGeometry(2.2, 2.2, 4, 10).translate(0, 4.6, 0), std({ color: 0x3a2a22, roughness: 0.9 }), roofs, (o, d) => d.position.set(o.x, o.y, o.z));
    add(new THREE.ConeGeometry(2.5, 2, 10).translate(0, 7.6, 0), std({ color: 0x2a201c, roughness: 0.9 }), roofs, (o, d) => d.position.set(o.x, o.y, o.z));
    add(new THREE.ConeGeometry(1.2, 1, 6).translate(0, 0.5, 0), std({ color: 0x8d929c, metalness: 0.9, roughness: 0.3 }), spires, (o, d) => { d.position.set(o.x, o.y, o.z); d.scale.set(1, o.k, 1); });
    const blink = add(new THREE.SphereGeometry(0.8, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff2030).multiplyScalar(3), transparent: true }), spires, (o, d) => d.position.set(o.x, o.y + o.k, o.z));
    // sidewalks and kerbs
    const walk = std({ color: 0x24262e, roughness: 0.85 });
    ribbon(zn.s, zn.e, HALF + 0.5, HALF + 4.5, 0.14, walk); ribbon(zn.s, zn.e, -HALF - 0.5, -HALF - 4.5, 0.14, walk);
    lamps(zn, 34, 0xffd9a0, HALF + 1.4, 7);
    // traffic lights: a mast arm over the road with three lamps that cycle together
    add(new THREE.CylinderGeometry(0.15, 0.18, 7, 8).translate(0, 3.5, 0), std({ color: 0x222630, metalness: 0.7, roughness: 0.4 }), signals, (o, d) => d.position.set(o.x, 0, o.z));
    add(new THREE.BoxGeometry(0.2, 0.2, 7).translate(0, 6.8, 3.5), std({ color: 0x222630, metalness: 0.7, roughness: 0.4 }), signals, (o, d) => { d.position.set(o.x, 0, o.z); d.rotation.y = o.rot + (o.sd > 0 ? Math.PI : 0); });
    add(new THREE.BoxGeometry(0.7, 2.2, 0.7).translate(0, 6.1, 6), std({ color: 0x15171c, roughness: 0.6 }), signals, (o, d) => { d.position.set(o.x, 0, o.z); d.rotation.y = o.rot + (o.sd > 0 ? Math.PI : 0); });
    const lights = [0, 1, 2].map((k) => add(new THREE.SphereGeometry(0.24, 8, 6).translate(-0.36, 6.8 - k * 0.68, 6), new THREE.MeshBasicMaterial({ color: 0x111111 }), signals, (o, d) => { d.position.set(o.x, 0, o.z); d.rotation.y = o.rot + (o.sd > 0 ? Math.PI : 0); }));
    const LC = [new THREE.Color(3, 0.3, 0.3), new THREE.Color(3, 2, 0.2), new THREE.Color(0.3, 3, 0.8)], OFF = new THREE.Color(0.08, 0.08, 0.08);
    live.push((t) => { const ph = (t % 12) < 6 ? 2 : (t % 12) < 7.5 ? 1 : 0; lights.forEach((m, k) => m && m.material.color.copy(k === ph ? LC[k] : OFF)); if (blink) blink.material.opacity = (t % 1.6) < 0.25 ? 1 : 0.15; });
    // billboards: abstract animated colour fields (no brands, no fake content)
    if (boards.length) {
      const bm = new THREE.ShaderMaterial({
        uniforms: U, side: THREE.DoubleSide,
        vertexShader: "attribute float aSeed; varying vec2 vUv; varying float vS; void main(){ vUv = uv; vS = 0.; gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position,1.); }",
        fragmentShader: `varying vec2 vUv; uniform float uTime;
          void main(){ vec2 p = vUv * vec2(2.6, 1.);
            float a = sin(p.x * 3. + uTime * 1.3) + sin(p.y * 5. - uTime * 0.9) + sin((p.x + p.y) * 2.2 + uTime * 0.6);
            vec3 c = 0.5 + 0.5 * cos(a + vec3(0., 2.1, 4.2) + uTime * 0.2);
            float frame = step(0.04, vUv.x) * step(vUv.x, 0.96) * step(0.07, vUv.y) * step(vUv.y, 0.93);
            gl_FragColor = vec4(mix(vec3(0.9), c * 1.4, frame), 1.); }`
      });
      add(new THREE.PlaneGeometry(1, 1), bm, boards, (o, d) => { d.position.set(o.x, o.y, o.z); d.rotation.y = o.rot + Math.PI / 2; d.scale.set(o.w, o.w * 0.42, 1); });
    }
    // steam from the manholes
    const steam = [];
    for (let k = 0; k < thin(14); k++) { const s = zn.s + 80 + rnd() * (zn.e - zn.s - 160), lat = (rnd() - 0.5) * 10; const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color: 0xc8ccd8, transparent: true, opacity: 0, depthWrite: false })); const p = at(C, s, lat); sp.userData = { x: p[0], z: p[1], ph: rnd() * 4 }; scene.add(sp); steam.push(sp); }
    live.push((t) => steam.forEach((sp) => { const u = ((t * 0.35 + sp.userData.ph) % 1); sp.position.set(sp.userData.x, 0.3 + u * 7, sp.userData.z); sp.scale.setScalar(2 + u * 6); sp.material.opacity = Math.sin(Math.PI * u) * 0.22; }));
    // a police helicopter that tracks you with its searchlight
    const heli = new THREE.Group(), hm = std({ color: 0x1c2230, metalness: 0.6, roughness: 0.4 });
    const hb = new THREE.Mesh(new THREE.SphereGeometry(1.6, 16, 10), hm); hb.scale.set(1.6, 1, 1); heli.add(hb);
    const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.35, 6, 8), hm); tail.rotation.z = Math.PI / 2; tail.position.x = -4.4; heli.add(tail);
    const rotor = new THREE.Mesh(new THREE.BoxGeometry(11, 0.08, 0.4), std({ color: 0x0a0a0c })); rotor.position.y = 1.4; heli.add(rotor);
    const rotor2 = rotor.clone(); rotor2.rotation.y = Math.PI / 2; rotor.add(rotor2);
    const nav = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color: 0xff3344, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); nav.position.set(-7, 0.4, 0); nav.scale.setScalar(1.4); heli.add(nav);
    const beam = new THREE.Mesh(new THREE.ConeGeometry(7, 1, 24, 1, true).translate(0, -0.5, 0), new THREE.MeshBasicMaterial({ color: 0xdfe8ff, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    scene.add(heli, beam); heli.visible = beam.visible = false;
    const hp = new THREE.Vector3(), tv = new THREE.Vector3(), cv = new THREE.Vector3();
    live.push((t, dt, R, cam, zi2) => {
      const on = zi2 === zi; heli.visible = beam.visible = on; if (!on) { hp.set(R.x, 60, R.z); return; }
      tv.set(R.x + Math.cos(R.yaw) * 40 + Math.sin(t * 0.3) * 20, 48, R.z - Math.sin(R.yaw) * 40 + Math.cos(t * 0.3) * 20);
      hp.lerp(tv, 1 - Math.exp(-dt * 1.2)); heli.position.copy(hp); heli.lookAt(R.x, 30, R.z); heli.rotateY(-Math.PI / 2);
      rotor.rotation.y += dt * 40; nav.material.opacity = (t % 1) < 0.2 ? 1 : 0.2;
      // the spot lands on the road ahead of you, so the camera never sits inside the beam
      const d = tv.set(R.x + Math.cos(R.yaw) * 30, 0, R.z - Math.sin(R.yaw) * 30).sub(hp), L = d.length(); beam.position.copy(hp); beam.scale.set(0.7, L, 0.7);
      beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), d.normalize());
      // fade the beam out when it swings close to the camera, so it never fogs the whole screen
      const k = clamp(cv.copy(cam.position).sub(hp).dot(d) / L, 0, 1), near = cv.copy(hp).addScaledVector(d, k * L).distanceTo(cam.position);
      beam.material.opacity = 0.06 * smooth(6 + k * 5, 16 + k * 5, near);
    });
  };

  // 2 · Harbor Bridge: the whole zone is a suspension bridge over open water
  B.bridge = (zn, zi) => {
    const deck = std({ color: 0x1a2230, metalness: 0.5, roughness: 0.5 }), z = Z[zi];
    wall(zn.s - 10, zn.e + 10, HALF + 2, -4, 0.04, deck); wall(zn.s - 10, zn.e + 10, -HALF - 2, -4, 0.04, deck);
    ribbon(zn.s - 10, zn.e + 10, HALF + 2, -HALF - 2, -3.6, deck, 8);
    ribbon(zn.s, zn.e, HALF + 0.6, HALF + 2, 0.12, std({ color: 0x2a3446 })); ribbon(zn.s, zn.e, -HALF - 0.6, -HALF - 2, 0.12, std({ color: 0x2a3446 }));
    // two big towers, each two legs with cross beams and red lights on top
    const L = zn.e - zn.s, T1 = zn.s + L * 0.3, T2 = zn.s + L * 0.7, TH = 120, legs = [], beams = [], tops = [];
    [T1, T2].forEach((s) => { [-1, 1].forEach((sd) => { const p = at(C, s, sd * (HALF + 3.2)); legs.push({ x: p[0], z: p[1], rot: C.h[Math.round(s)] }); solid(p[0], p[1], 1.6, TH); tops.push({ x: p[0], z: p[1] }); }); [40, 80, 116].forEach((y) => { const p = at(C, s, 0); beams.push({ x: p[0], z: p[1], y, rot: C.h[Math.round(s)] }); }); });
    const tm = std({ color: 0x2a3a52, metalness: 0.6, roughness: 0.4, emissive: 0x05101c });
    add(new THREE.BoxGeometry(3, TH, 3).translate(0, TH / 2, 0), tm, legs, (o, d) => { d.position.set(o.x, -4, o.z); d.rotation.y = o.rot; });
    add(new THREE.BoxGeometry(2.4, 3, HALF * 2 + 8), tm, beams, (o, d) => { d.position.set(o.x, o.y, o.z); d.rotation.y = o.rot; });
    const red = add(new THREE.SphereGeometry(0.9, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff2030).multiplyScalar(3), transparent: true }), tops, (o, d) => d.position.set(o.x, TH - 2, o.z));
    live.push((t) => { if (red) red.material.opacity = (t % 2) < 0.4 ? 1 : 0.2; });
    // main cables (a sag between the towers, down to anchors at each end) and the hangers
    const cable = new THREE.MeshBasicMaterial({ color: z.edge.clone().multiplyScalar(1.6) }), hang = [], hc = [], ce = z.edge.clone().multiplyScalar(1.2);
    const hAt = (s) => { if (s < T1) return 2 + (TH - 4) * Math.pow((s - zn.s) / (T1 - zn.s), 1.6); if (s > T2) return 2 + (TH - 4) * Math.pow((zn.e - s) / (zn.e - T2), 1.6); const u = (s - T1) / (T2 - T1); return 14 + (TH - 18) * (2 * u - 1) ** 2; };
    [-1, 1].forEach((sd) => {
      const pts = []; for (let s = zn.s + 10; s <= zn.e - 10; s += 10) { const p = at(C, s, sd * (HALF + 3.2)); pts.push(new THREE.Vector3(p[0], hAt(s), p[1])); }
      const m = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), pts.length * 2, 0.5, 6), cable); scene.add(m);
      for (let s = zn.s + 20; s < zn.e - 20; s += 12) { const p = at(C, s, sd * (HALF + 3.2)), y = hAt(s); hang.push(p[0], y, p[1], p[0], 0.5, p[1]); hc.push(ce.r, ce.g, ce.b, ce.r * 0.3, ce.g * 0.3, ce.b * 0.3); }
    });
    const hg = new THREE.BufferGeometry(); hg.setAttribute("position", new THREE.Float32BufferAttribute(hang, 3)); hg.setAttribute("color", new THREE.Float32BufferAttribute(hc, 3));
    scene.add(new THREE.LineSegments(hg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false })));
    // glowing rails and lamps along the deck
    const rail = []; [-1, 1].forEach((sd) => { for (let s = zn.s; s < zn.e - 4; s += 4) { const a = at(C, s, sd * (HALF + 1.9)), b = at(C, s + 4, sd * (HALF + 1.9)); rail.push(a[0], 1.1, a[1], b[0], 1.1, b[1]); } });
    const rg = new THREE.BufferGeometry(); rg.setAttribute("position", new THREE.Float32BufferAttribute(rail, 3));
    scene.add(new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: z.edge.clone().multiplyScalar(1.8) })));
    lamps(zn, 40, 0xbfe6ff, HALF + 1.8, 8);
    skyline(zn.s - 300, zn.e + 300, 500, 1100, 45, 60, 300, zi);
    boats(zn, 10);
  };
  // small boats with lights drifting on the water
  function boats(zn, n) {
    const list = [];
    for (let k = 0; k < thin(n); k++) { const sd = side(), s = zn.s + rnd() * (zn.e - zn.s), p = at(C, s, sd * (80 + rnd() * 300)); if (C.clear(p[0], p[1], 10)) list.push({ x: p[0], z: p[1], r: rnd() * 6.3, k: 0.6 + rnd() }); }
    add(new THREE.BoxGeometry(14, 2, 4).translate(0, 0.6, 0), std({ color: 0x1a1d26, roughness: 0.6 }), list, (o, d) => { d.position.set(o.x, 0, o.z); d.rotation.y = o.r; d.scale.setScalar(o.k); });
    add(new THREE.SphereGeometry(0.4, 6, 4), new THREE.MeshBasicMaterial({ color: 0xffffff }), list, (o, d, c) => { d.position.set(o.x, 3 * o.k, o.z); c.setHSL(rnd() < 0.5 ? 0.1 : 0.55, 0.8, 0.7).multiplyScalar(2.5); }, true);
  }

  // 3 · Underpass: a lit tunnel for the whole zone, jet fans in the roof, green exit signs
  B.tunnel = (zn, zi) => {
    const [a, b] = C.tunnel, ST = 3, SEG = 18, Rr = HALF + 2.6, pos = [], uv = [], idx = [];
    let row = 0;
    for (let s = a; s <= b; s += ST, row++) {
      for (let k = 0; k <= SEG; k++) { const th = Math.PI * k / SEG, p = at(C, s, Math.cos(th) * Rr); pos.push(p[0], Math.sin(th) * Rr * 0.82, p[1]); uv.push(k / SEG, s); }
      if (s > a) for (let k = 0; k < SEG; k++) { const p0 = (row - 1) * (SEG + 1) + k, p1 = row * (SEG + 1) + k; idx.push(p0, p1, p0 + 1, p0 + 1, p1, p1 + 1); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
    const tz = Z[zi], tube = new THREE.Mesh(g, new THREE.ShaderMaterial({
      side: THREE.DoubleSide, uniforms: { ...U, uC: { value: tz.edge.clone() } },
      vertexShader: "varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }",
      fragmentShader: `varying vec2 vUv; varying vec3 vW; uniform vec3 uFog, uCam, uC; uniform float uDen, uTime;
        ${FOG}
        void main(){
          float ring = smoothstep(0.455, 0.49, abs(fract(vUv.y / 24.) - 0.5));
          float strip = smoothstep(0.03, 0.0, abs(vUv.x - 0.5) - 0.02) * 0.9 + (smoothstep(0.02, 0.0, abs(vUv.x - 0.2) - 0.004) + smoothstep(0.02, 0.0, abs(vUv.x - 0.8) - 0.004)) * 0.5;
          float tile = step(0.96, fract(vUv.y / 3.)) * 0.05 + step(0.97, fract(vUv.x * 18.)) * 0.04;
          float low = smoothstep(0.12, 0.08, min(vUv.x, 1. - vUv.x)); // painted lower walls
          vec3 c = mix(vec3(0.05, 0.045, 0.04), vec3(0.16, 0.14, 0.1), low) + uC * (ring * 1.8 + strip * 0.9) + tile;
          gl_FragColor = vec4(fogged(c, vW), 1.);
        }`
    }));
    tube.frustumCulled = false; scene.add(tube);
    // portals at both ends
    const portal = std({ color: 0x2a2620, roughness: 0.9 });
    [a, b].forEach((s) => { const p = at(C, s); const m = new THREE.Mesh(new THREE.BoxGeometry(2, 14, 34), portal); m.position.set(p[0], 5, p[1]); m.rotation.y = p[2]; scene.add(m); const top = new THREE.Mesh(new THREE.BoxGeometry(2.4, 6, 34), portal); top.position.set(p[0], 11, p[1]); top.rotation.y = p[2]; scene.add(top); });
    // jet fans in pairs under the roof
    const fans = []; for (let s = a + 80; s < b - 40; s += 150) [-1, 1].forEach((sd) => { const p = at(C, s, sd * 3); fans.push({ x: p[0], z: p[1], rot: C.h[s] }); });
    add(new THREE.CylinderGeometry(0.9, 0.9, 4.5, 14), std({ color: 0x4a4e58, metalness: 0.8, roughness: 0.35 }), fans, (o, d) => { d.position.set(o.x, Rr * 0.82 - 1.6, o.z); d.rotation.set(0, o.rot, Math.PI / 2); });
    // emergency exits
    const exits = []; for (let s = a + 50; s < b; s += 110) { const sd = side(), p = at(C, s, sd * (Rr - 0.2)); exits.push({ x: p[0], z: p[1], rot: C.h[s] }); }
    add(new THREE.BoxGeometry(1.6, 0.6, 0.1), glow(0x30ff80, 2.2), exits, (o, d) => { d.position.set(o.x, 3.2, o.z); d.rotation.y = o.rot; });
    // walls get a kerb with reflectors
    ribbon(a, b, HALF + 0.6, HALF + 2.4, 0.2, std({ color: 0x302a24 })); ribbon(a, b, -HALF - 0.6, -HALF - 2.4, 0.2, std({ color: 0x302a24 }));
  };

  // 4 · Red Desert: a dirt track through mesas and cactus, with a train crossing
  B.desert = (zn, zi) => {
    const mesas = [], rocks = [], cacti = [];
    for (let s = zn.s - 200; s < zn.e + 200; s += step(60)) { const sd = side(), off = 90 + rnd() * 500, p = at(C, s, sd * off), r = 20 + rnd() * 60; if (C.clear(p[0], p[1], r)) mesas.push({ x: p[0], z: p[1], r, hgt: 25 + rnd() * 70, rot: rnd() * 6 }); }
    add(new THREE.CylinderGeometry(0.8, 1, 1, 7).translate(0, 0.5, 0), std({ color: 0x8a3a22, roughness: 0.95, flatShading: true }), mesas, (o, d) => { d.position.set(o.x, 0, o.z); d.rotation.y = o.rot; d.scale.set(o.r, o.hgt, o.r * (0.6 + rnd() * 0.5)); });
    for (let s = zn.s; s < zn.e; s += step(14)) { const sd = side(), sz = 1 + rnd() * rnd() * 7, off = HALF + 4 + rnd() * 50, p = at(C, s, sd * off); if (C.clear(p[0], p[1], sz)) { rocks.push({ x: p[0], z: p[1], sz }); if (sz > 2.5) solid(p[0], p[1], sz * 0.6, sz); } }
    add(new THREE.DodecahedronGeometry(1, 0), std({ color: 0x9a4a2a, roughness: 0.95, flatShading: true }), rocks, (o, d) => { d.position.set(o.x, o.sz * 0.3, o.z); d.rotation.set(rnd(), rnd() * 6, rnd()); d.scale.set(o.sz, o.sz * 0.7, o.sz * 0.9); });
    for (let s = zn.s; s < zn.e; s += step(18)) { const sd = side(), off = HALF + 5 + rnd() * 60, p = at(C, s, sd * off); if (C.clear(p[0], p[1], 1)) { cacti.push({ x: p[0], z: p[1], k: 0.7 + rnd() * 0.8, r: rnd() * 6 }); solid(p[0], p[1], 0.5, 7); } }
    const cm = std({ color: 0x2f5a2a, roughness: 0.8 });
    add(new THREE.CylinderGeometry(0.45, 0.5, 7, 8).translate(0, 3.5, 0), cm, cacti, (o, d) => { d.position.set(o.x, 0, o.z); d.scale.setScalar(o.k); });
    const arm = new THREE.CylinderGeometry(0.3, 0.32, 3, 7).translate(0, 1.5, 0).rotateZ(0.0);
    add(arm.clone().translate(1.1, 2.6, 0), cm, cacti, (o, d) => { d.position.set(o.x, 0, o.z); d.rotation.y = o.r; d.scale.setScalar(o.k); });
    add(arm.clone().translate(-1.1, 3.4, 0), cm, cacti, (o, d) => { d.position.set(o.x, 0, o.z); d.rotation.y = o.r; d.scale.set(o.k, o.k * 0.8, o.k); });
    add(new THREE.BoxGeometry(2.2, 0.3, 0.3).translate(0, 2.6, 0), cm, cacti, (o, d) => { d.position.set(o.x, 0, o.z); d.rotation.y = o.r; d.scale.setScalar(o.k); });
    // tumbleweeds blowing across in front of you
    const weeds = []; for (let k = 0; k < thin(6); k++) { const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.8, 1), new THREE.MeshStandardMaterial({ color: 0x8a6a3a, wireframe: true })); m.userData = { ph: rnd() * 10, sp: 6 + rnd() * 6, lat0: 40 }; scene.add(m); weeds.push(m); }
    live.push((t, dt, R, cam, zi2) => weeds.forEach((m, k) => { m.visible = zi2 === zi; if (!m.visible) return; const u = ((t * m.userData.sp / 80 + m.userData.ph) % 1); const s = R.idx + 40 + k * 25, p = at(C, s, 40 - u * 80); m.position.set(p[0], 0.8 + Math.abs(Math.sin(t * 5 + k)) * 0.8, p[1]); m.rotation.set(t * 4, 0, t * 3); }));
    // the railway and its train
    const tr = C.events.find((e) => e.type === "train");
    if (tr) {
      const h0 = C.h[tr.s], c0 = at(C, tr.s), dir = [-Math.sin(h0), -Math.cos(h0)]; // the track runs across the road (lat axis)
      const P = (l) => [c0[0] + dir[0] * l, c0[1] + dir[1] * l];
      const sleepers = []; for (let l = -320; l <= 320; l += 1.4) sleepers.push(l);
      add(new THREE.BoxGeometry(2.8, 0.18, 0.4), std({ color: 0x3a2a1e, roughness: 0.9 }), sleepers, (l, d) => { const p = P(l); d.position.set(p[0], 0.1, p[1]); d.rotation.y = h0; });
      [-0.75, 0.75].forEach((o) => { const a = P(-320), b = P(320), m = new THREE.Mesh(new THREE.BoxGeometry(640, 0.18, 0.12), std({ color: 0x8a8a90, metalness: 1, roughness: 0.3 })); m.position.set((a[0] + b[0]) / 2 + Math.cos(h0) * o, 0.28, (a[1] + b[1]) / 2 - Math.sin(h0) * o); m.rotation.y = h0 + Math.PI / 2; scene.add(m); });
      // crossing signs with lights that flash while the train is coming
      const xs = [-1, 1].map((sd) => { const p = at(C, tr.s - sd * 6, sd * (HALF + 2)), g = new THREE.Group(); g.position.set(p[0], 0, p[1]); g.rotation.y = h0; const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 4.5, 6).translate(0, 2.25, 0), std({ color: 0xdddddd })); g.add(pole); const xb = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.35, 2.6), std({ color: 0xf2f2f2 })); xb.position.y = 4.1; xb.rotation.x = 0.7; g.add(xb); const xb2 = xb.clone(); xb2.rotation.x = -0.7; g.add(xb2); const ls = [-0.5, 0.5].map((z) => { const l = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color: 0xff2020, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })); l.position.set(0.2, 3.3, z); l.scale.setScalar(1.2); g.add(l); return l; }); scene.add(g); return ls; }).flat();
      const carM = new THREE.InstancedMesh(new THREE.BoxGeometry(20, 4.2, 3.2).translate(0, 2.6, 0), std({ color: 0x5a3a2a, metalness: 0.4, roughness: 0.6 }), 7);
      for (let k = 0; k < 7; k++) carM.setColorAt(k, tcol.set(k === 0 ? 0xd8a020 : [0x6a3a2a, 0x3a4a5a, 0x5a5a5a][k % 3]));
      carM.frustumCulled = false; scene.add(carM);
      const lamp = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color: 0xfff0c0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); lamp.scale.setScalar(5); scene.add(lamp);
      live.push((t) => {
        const on = tr.t >= 0; carM.visible = lamp.visible = on;
        xs.forEach((l, k) => { l.material.opacity = on && tr.pos < 60 ? ((t * 2 + (k % 2) * 0.5) % 1 < 0.5 ? 1 : 0) : 0; });
        if (!on) return;
        for (let k = 0; k < 7; k++) { const l = tr.pos - 10 - k * 21.5, p = P(l); dummy.position.set(p[0], 0, p[1]); dummy.rotation.set(0, h0 + Math.PI / 2, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); carM.setMatrixAt(k, dummy.matrix); }
        carM.instanceMatrix.needsUpdate = true; const f = P(tr.pos + 1); lamp.position.set(f[0], 3.2, f[1]);
      });
    }
  };

  // 5 · Pine Switchbacks: dense pines, guard rails, mountains behind, fireflies
  const pines = (zn, every, snowy) => {
    const list = [];
    for (let s = zn.s - 60; s < zn.e + 60; s += step(every)) for (const sd of [-1, 1]) { if (rnd() < 0.25) continue; const off = HALF + 5 + rnd() * rnd() * 90, p = at(C, s, sd * off), k = 0.8 + rnd() * 1.1; if (C.clear(p[0], p[1], 2.5 * k)) { list.push({ x: p[0], z: p[1], k, r: rnd() * 6 }); if (off < 30) solid(p[0], p[1], 0.8, 20); } }
    add(new THREE.CylinderGeometry(0.35, 0.5, 4, 6).translate(0, 2, 0), std({ color: 0x2a1c14, roughness: 0.9 }), list, (o, d) => { d.position.set(o.x, 0, o.z); d.scale.setScalar(o.k); });
    const needles = std({ color: snowy ? 0x2a3a34 : 0x16301e, roughness: 0.85, flatShading: true });
    [[3.4, 6, 4.5], [2.6, 5, 7.4], [1.7, 4, 10]].forEach(([r, hh, y]) => add(new THREE.ConeGeometry(r, hh, 8).translate(0, y, 0), needles, list, (o, d) => { d.position.set(o.x, 0, o.z); d.rotation.y = o.r; d.scale.setScalar(o.k); }));
    if (snowy) add(new THREE.ConeGeometry(1.3, 2.4, 8).translate(0, 11.4, 0), std({ color: 0xf2f6ff, roughness: 0.6 }), list, (o, d) => { d.position.set(o.x, 0, o.z); d.rotation.y = o.r; d.scale.setScalar(o.k); });
  };
  const mountains = (zn, snow) => {
    const list = [];
    for (let s = zn.s - 400; s < zn.e + 400; s += step(120)) for (const sd of [-1, 1]) { const off = 350 + rnd() * 700, p = at(C, s, sd * off), r = 120 + rnd() * 220; if (C.clear(p[0], p[1], r * 0.9)) list.push({ x: p[0], z: p[1], r, hgt: 120 + rnd() * 260 }); }
    add(new THREE.ConeGeometry(1, 1, 7).translate(0, 0.5, 0), std({ color: snow ? 0x5a6070 : 0x18202a, roughness: 1, flatShading: true }), list, (o, d) => { d.position.set(o.x, -2, o.z); d.rotation.y = rnd() * 6; d.scale.set(o.r, o.hgt, o.r); });
    add(new THREE.ConeGeometry(1, 1, 7).translate(0, 0.5, 0), std({ color: 0xeef2fa, roughness: 0.7, flatShading: true }), list, (o, d) => { d.position.set(o.x, o.hgt * 0.62 - 2, o.z); d.rotation.y = rnd() * 6; d.scale.set(o.r * 0.39, o.hgt * 0.38, o.r * 0.39); });
  };
  const rails = (zn, color) => {
    const posts = [], bars = [];
    for (let s = zn.s; s < zn.e; s += 4) { if (Math.abs(C.k[s]) < 0.004) continue; for (const sd of [-1, 1]) { const p = at(C, s, sd * (HALF + 1.4)); posts.push({ x: p[0], z: p[1] }); const q = at(C, s + 2, sd * (HALF + 1.4)); bars.push({ x: q[0], z: q[1], rot: C.h[s + 2] }); } }
    add(new THREE.BoxGeometry(0.18, 0.9, 0.18).translate(0, 0.45, 0), std({ color: 0x5a4a3a, roughness: 0.9 }), posts, (o, d) => d.position.set(o.x, 0, o.z));
    add(new THREE.BoxGeometry(4.1, 0.28, 0.08).translate(0, 0.75, 0), std({ color, metalness: 0.7, roughness: 0.35 }), bars, (o, d) => { d.position.set(o.x, 0, o.z); d.rotation.y = o.rot; });
  };
  B.forest = (zn, zi) => {
    pines(zn, 6, false); mountains(zn, false); rails(zn, 0x8a8f98);
    // fireflies drifting near the road
    const n = thin(700), pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const s = zn.s + rnd() * (zn.e - zn.s), p = at(C, s, (rnd() - 0.5) * 60); pos.set([p[0], 0.5 + rnd() * 5, p[1]], i * 3); }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const ff = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.35, map: GLOW, color: 0xd8ff70, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    ff.frustumCulled = false; scene.add(ff);
    live.push((t) => { ff.material.opacity = 0.55 + 0.45 * Math.sin(t * 3.1) * Math.sin(t * 1.7); ff.position.y = Math.sin(t * 0.8) * 0.3; });
  };

  // 6 · Summit Pass: snowy pines, rock walls, snow banks, falling snow, avalanches
  B.snow = (zn, zi) => {
    pines(zn, 8, true); mountains(zn, true); rails(zn, 0xb8c0cc);
    const bank = std({ color: 0xe8eef8, roughness: 0.6 });
    ribbon(zn.s, zn.e, HALF + 0.8, HALF + 3.5, 0.35, bank); ribbon(zn.s, zn.e, -HALF - 0.8, -HALF - 3.5, 0.35, bank);
    const cliffs = [];
    for (let s = zn.s; s < zn.e; s += step(10)) { const sz = 10 + rnd() * 20, off = HALF + 8 + sz * 0.5, p = at(C, s, off); if (C.clear(p[0], p[1], sz * 0.55)) { cliffs.push({ x: p[0], z: p[1], sz, hgt: 14 + rnd() * 40 }); solid(p[0], p[1], sz * 0.55, 40); } }
    add(new THREE.DodecahedronGeometry(1, 0), std({ color: 0x5c6270, roughness: 0.95, flatShading: true }), cliffs, (o, d) => { d.position.set(o.x, o.hgt * 0.4, o.z); d.rotation.set(rnd() * 0.5, rnd() * 6, rnd() * 0.5); d.scale.set(o.sz * 0.6, o.hgt * 0.6, o.sz * 0.55); });
    add(new THREE.DodecahedronGeometry(1, 0), std({ color: 0xf0f4fc, roughness: 0.7, flatShading: true }), cliffs, (o, d) => { d.position.set(o.x, o.hgt * 0.75, o.z); d.rotation.set(0, rnd() * 6, 0); d.scale.set(o.sz * 0.45, o.hgt * 0.2, o.sz * 0.42); });
    // falling snow around the camera
    const n = thin(2200), pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) pos.set([(rnd() - 0.5) * 120, rnd() * 50, (rnd() - 0.5) * 120], i * 3);
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const flakes = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.22, map: GLOW, color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
    flakes.frustumCulled = false; scene.add(flakes);
    live.push((t, dt, R, cam) => {
      const w = E.weight(zn.kind); flakes.visible = w > 0.01; if (!flakes.visible) return;
      flakes.material.opacity = w * 0.9; flakes.position.set(cam.position.x, 0, cam.position.z);
      const a = g.attributes.position.array; for (let i = 0; i < n; i++) { let y = a[i * 3 + 1] - dt * (4 + (i % 5)); if (y < 0) y += 50; a[i * 3 + 1] = y; a[i * 3] += Math.sin(t + i) * dt * 0.6; }
      g.attributes.position.needsUpdate = true;
    });
    // avalanche boulders rolling down across the road
    const ev = C.events.filter((e) => e.type === "avalanche"), rocks = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), std({ color: 0xdfe6f2, roughness: 0.8, flatShading: true }), 12);
    rocks.frustumCulled = false; scene.add(rocks);
    live.push((t) => {
      let k = 0;
      ev.forEach((e) => e.rocks.forEach((r) => { if (k >= 12) return; const p = at(C, r.s, r.lat); dummy.position.set(p[0], r.r, p[1]); dummy.rotation.set(t * r.v * 0.4, 0, t * 2); dummy.scale.setScalar(r.r); dummy.updateMatrix(); rocks.setMatrixAt(k++, dummy.matrix); }));
      rocks.count = k; rocks.instanceMatrix.needsUpdate = true;
    });
  };

  // 7 · Neon Highway: holo pillars, floating rings, speed traps
  B.cyber = (zn, zi) => {
    const pillars = [];
    for (let s = zn.s; s < zn.e; s += step(26)) for (const sd of [-1, 1]) { const off = HALF + 6 + rnd() * 50, p = at(C, s, sd * off), hgt = 10 + rnd() * rnd() * 90; if (C.clear(p[0], p[1], 2)) pillars.push({ x: p[0], z: p[1], hgt, w: 1.5 + rnd() * 4, hue: rnd() }); }
    const pm = new THREE.ShaderMaterial({
      uniforms: U, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: "varying vec3 vL; varying vec3 vC; void main(){ vL = position; vC = vec3(1.); \n#ifdef USE_INSTANCING_COLOR\n vC = instanceColor;\n#endif\n gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position,1.); }",
      fragmentShader: "varying vec3 vL; varying vec3 vC; uniform float uTime; void main(){ float scan = 0.35 + 0.65 * step(0.5, fract(vL.y * 40. - uTime * 2.)); float edge = smoothstep(0.42, 0.5, max(abs(vL.x), abs(vL.z))); gl_FragColor = vec4(vC * (0.25 * scan + edge * 1.4), 1.); }"
    });
    add(box, pm, pillars, (o, d, c) => { d.position.set(o.x, o.hgt / 2, o.z); d.scale.set(o.w, o.hgt, o.w); c.setHSL(0.5 + o.hue * 0.4, 0.9, 0.55); }, true);
    const rings = []; for (let s = zn.s + 60; s < zn.e - 40; s += 90) rings.push({ s });
    const rm = add(new THREE.TorusGeometry(HALF + 3, 0.35, 8, 48), new THREE.MeshBasicMaterial({ color: 0xffffff }), rings, (o, d, c) => { const p = at(C, o.s); d.position.set(p[0], 2, p[1]); d.rotation.set(0, p[2] + Math.PI / 2, 0); c.setHSL((o.s / 400) % 1, 0.9, 0.55).multiplyScalar(2); }, true);
    if (rm) live.push((t) => { rm.material.color.setScalar(0.8 + 0.4 * Math.sin(t * 6)); });
    // data streams rising off the ground
    const n = thin(400), pos = new Float32Array(n * 6), base = [];
    for (let i = 0; i < n; i++) { const s = zn.s + rnd() * (zn.e - zn.s), p = at(C, s, side() * (HALF + 6 + rnd() * 80)); base.push([p[0], p[1], rnd() * 30, 4 + rnd() * 10]); }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: new THREE.Color(0x40e0ff).multiplyScalar(1.6), transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
    lines.frustumCulled = false; scene.add(lines);
    live.push((t, dt, R, cam, zi2) => { if (Math.abs(zi2 - zi) > 1) return; base.forEach(([x, z, ph, L], i) => { const y = ((t * 12 + ph) % 40); pos.set([x, y, z, x, y + L, z], i * 6); }); g.attributes.position.needsUpdate = true; });
    lamps(zn, 50, 0xff40c0, HALF + 1.2, 6);
  };

  // 8 · Sunset Coast: beach and sea on one side, cliffs on the other, palms and a lighthouse
  B.coast = (zn, zi) => {
    ribbon(zn.s - 40, zn.e + 40, HALF + 0.6, HALF + 26, 0.02, std({ color: 0xc8a070, roughness: 0.95 }));
    const surf = ribbon(zn.s - 40, zn.e + 40, HALF + 26, HALF + 30, 0.04, new THREE.MeshBasicMaterial({ color: 0xffe8d0, transparent: true, opacity: 0.35 }));
    live.push((t) => { surf.material.opacity = 0.2 + 0.2 * Math.sin(t * 1.4); });
    const cliffs = [];
    for (let s = zn.s; s < zn.e; s += step(9)) { const sz = 10 + rnd() * 22, off = HALF + 9 + sz * 0.5 + rnd() * 6, p = at(C, s, -off); if (C.clear(p[0], p[1], sz * 0.55)) { cliffs.push({ x: p[0], z: p[1], sz, hgt: 12 + rnd() * 36 }); solid(p[0], p[1], sz * 0.55, 40); } }
    add(new THREE.DodecahedronGeometry(1, 0), std({ color: 0x6a4434, roughness: 0.95, flatShading: true }), cliffs, (o, d) => { d.position.set(o.x, o.hgt * 0.4, o.z); d.rotation.set(rnd() * 0.4, rnd() * 6, rnd() * 0.4); d.scale.set(o.sz * 0.6, o.hgt * 0.6, o.sz * 0.55); });
    // palms: a curved trunk and a crown of fronds
    const palms = [];
    for (let s = zn.s; s < zn.e; s += step(16)) { const off = HALF + 4 + rnd() * 18, p = at(C, s, off); palms.push({ x: p[0], z: p[1], r: rnd() * 6, k: 0.8 + rnd() * 0.5 }); if (off < HALF + 8) solid(p[0], p[1], 0.5, 12); }
    const trunkPts = []; for (let i = 0; i <= 8; i++) trunkPts.push(new THREE.Vector3(Math.pow(i / 8, 2) * 2.5, i * 1.4, 0));
    add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(trunkPts), 12, 0.3, 6), std({ color: 0x6a5032, roughness: 0.9 }), palms, (o, d) => { d.position.set(o.x, 0, o.z); d.rotation.y = o.r; d.scale.setScalar(o.k); });
    const frond = new THREE.ConeGeometry(0.9, 5, 4).rotateZ(Math.PI / 2 + 0.35).translate(2.4, -0.6, 0);
    for (let f = 0; f < 6; f++) add(frond.clone().rotateY(f * Math.PI / 3).translate(2.5, 11.2, 0), std({ color: 0x2a5a2e, roughness: 0.8, flatShading: true }), palms, (o, d) => { d.position.set(o.x, 0, o.z); d.rotation.y = o.r; d.scale.set(o.k, o.k * 0.55, o.k); });
    // a lighthouse on a headland, sweeping its beam
    const lp = at(C, zn.s + (zn.e - zn.s) * 0.55, HALF + 70), lh = new THREE.Group(); lh.position.set(lp[0], 0, lp[1]);
    for (let k = 0; k < 6; k++) { const m = new THREE.Mesh(new THREE.CylinderGeometry(2.6 - k * 0.2, 2.8 - k * 0.2, 4, 16), std({ color: k % 2 ? 0xd8d8dc : 0xb02a2a, roughness: 0.6 })); m.position.y = 2 + k * 4; lh.add(m); }
    const lampG = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color: 0xfff2c0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); lampG.position.y = 26; lampG.scale.setScalar(8); lh.add(lampG);
    const lb = new THREE.Mesh(new THREE.ConeGeometry(9, 180, 24, 1, true).translate(0, -90, 0).rotateZ(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xfff2c0, transparent: true, opacity: 0.08, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    lb.position.y = 26; lh.add(lb); scene.add(lh);
    live.push((t) => { lb.rotation.y = t * 0.8; });
    boats(zn, 12);
  };

  // 9 · The Docks: container stacks, gantry cranes, ships, sodium lights
  B.port = (zn, zi) => {
    const boxes = [], PAL = [0xb03a2e, 0x2e6ab0, 0xd8a020, 0x2e8a4a, 0x8a8f98, 0xc8642a, 0x5a3a8a];
    for (const sd of [-1, 1]) for (let s = zn.s + 20; s < zn.e - 20; s += 13.5) {
      for (let row = 0; row < 3; row++) {
        const off = HALF + 6 + row * 3.2, p = at(C, s, sd * off); if (!C.clear(p[0], p[1], 2)) continue;
        const n = 1 + Math.floor(rnd() * (row + 2)); for (let k = 0; k < n; k++) boxes.push({ x: p[0], z: p[1], y: 1.3 + k * 2.65, rot: C.h[s], col: PAL[Math.floor(rnd() * PAL.length)] });
        if (row === 0) solid(p[0], p[1], 2.4, 3 * n);
      }
      if (rnd() < 0.15) s += 14; // a gap between blocks
    }
    add(new THREE.BoxGeometry(12.2, 2.6, 2.44), std({ color: 0xffffff, metalness: 0.3, roughness: 0.7 }), boxes, (o, d, c) => { d.position.set(o.x, o.y, o.z); d.rotation.y = o.rot; c.set(o.col); }, true);
    // gantry cranes straddling the stacks on one side
    const cranes = []; for (let s = zn.s + 150; s < zn.e - 100; s += 320) cranes.push({ s, sd: side() });
    const cm = std({ color: 0xd88a20, metalness: 0.5, roughness: 0.5 });
    cranes.forEach((c) => {
      const g = new THREE.Group(), p = at(C, c.s, c.sd * (HALF + 13)); g.position.set(p[0], 0, p[1]); g.rotation.y = C.h[c.s];
      [[-6, -9], [6, -9], [-6, 9], [6, 9]].forEach(([x, z]) => { const l = new THREE.Mesh(new THREE.BoxGeometry(1, 34, 1).translate(0, 17, 0), cm); l.position.set(x, 0, z); g.add(l); });
      const top = new THREE.Mesh(new THREE.BoxGeometry(14, 2, 60), cm); top.position.set(0, 35, c.sd * 10); g.add(top);
      const lt = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color: 0xff3030, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); lt.position.set(0, 37, c.sd * 38); lt.scale.setScalar(3); g.add(lt);
      scene.add(g); live.push((t) => { lt.material.opacity = (t % 1.4) < 0.3 ? 1 : 0.2; });
    });
    // ships moored beyond the stacks
    const ships = []; for (let s = zn.s + 80; s < zn.e; s += step(260)) { const sd = side(), p = at(C, s, sd * (70 + rnd() * 60)); if (C.clear(p[0], p[1], 30)) ships.push({ x: p[0], z: p[1], rot: C.h[s], k: 0.8 + rnd() * 0.5 }); }
    add(new THREE.BoxGeometry(140, 12, 22).translate(0, 4, 0), std({ color: 0x1e2632, roughness: 0.6 }), ships, (o, d) => { d.position.set(o.x, 0, o.z); d.rotation.y = o.rot; d.scale.setScalar(o.k); });
    add(new THREE.BoxGeometry(18, 14, 18).translate(-52, 17, 0), towerMat, ships, (o, d, c) => { d.position.set(o.x, 0, o.z); d.rotation.y = o.rot; d.scale.setScalar(o.k); c.set(0xffc070); }, true);
    lamps(zn, 36, 0xff9a30, HALF + 1.4, 12);
  };

  // 10 · The Stadium: grandstands, crowd flashes, floodlights and fireworks to the finish
  B.stadium = (zn, zi) => {
    const fin = zn.e - 700, stands = [], crowd = [], floods = [];
    for (const sd of [-1, 1]) for (let s = fin; s < zn.e + 20; s += 20) for (let tier = 0; tier < 6; tier++) { const p = at(C, s, sd * (HALF + 7 + tier * 3)); stands.push({ x: p[0], z: p[1], y: tier * 2.2, rot: C.h[Math.min(C.N - 1, s)] }); if (tier === 0) solid(p[0], p[1], 2.5, 20); }
    add(new THREE.BoxGeometry(20.5, 2.2, 3.2).translate(0, 1.1, 0), std({ color: 0x23262f, roughness: 0.8 }), stands, (o, d) => { d.position.set(o.x, o.y, o.z); d.rotation.y = o.rot; });
    const n = thin(3000), pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const sd = side(), tier = Math.floor(rnd() * 6), s = fin + rnd() * 700, p = at(C, s, sd * (HALF + 7 + tier * 3 + (rnd() - 0.5) * 2)); pos.set([p[0], tier * 2.2 + 2.8, p[1]], i * 3); tcol.setHSL(rnd(), 0.6, 0.6).toArray(col, i * 3); }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.45, map: GLOW, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    pts.frustumCulled = false; scene.add(pts);
    live.push((t) => { pts.material.size = 0.4 + 0.15 * Math.sin(t * 9); });
    for (let s = fin; s < zn.e; s += 120) for (const sd of [-1, 1]) { const p = at(C, s, sd * (HALF + 28)); floods.push({ x: p[0], z: p[1] }); }
    add(new THREE.CylinderGeometry(0.4, 0.6, 40, 8).translate(0, 20, 0), std({ color: 0x3a3e48, metalness: 0.8, roughness: 0.4 }), floods, (o, d) => d.position.set(o.x, 0, o.z));
    floods.forEach((o) => { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color: 0xf0f4ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false })); sp.position.set(o.x, 41, o.z); sp.scale.setScalar(14); scene.add(sp); });
    lamps({ s: zn.s, e: fin }, 30, 0xffd080, HALF + 1.2, 6);
    // fireworks over the stands while you're in the zone
    let next = 0;
    live.push((t, dt, R, cam, zi2) => {
      if (zi2 !== zi || t < next) return; next = t + 0.5 + rnd() * 0.9;
      const s = Math.min(zn.e - 10, R.idx + 60 + rnd() * 200), p = at(C, s, side() * (20 + rnd() * 30));
      E.burst(new THREE.Vector3(p[0], 30 + rnd() * 25, p[1]), 50, new THREE.Vector3(0, 0, 0), 2, 13, new THREE.Color().setHSL(rnd(), 0.85, 0.6), 1.5, 3);
    });
  };

  C.zones.forEach((zn, zi) => B[zn.kind] && B[zn.kind](zn, zi));

  /* ---------------- traffic ---------------- */
  const cars = C.cars, CAR_PAL = [0xc8ccd4, 0x1a1c22, 0x8a1a22, 0x2a4a8a, 0x5a5e66, 0xe8e8ea, 0x2a5a3a];
  const bodyM = new THREE.InstancedMesh(new THREE.BoxGeometry(4.4, 1.1, 1.9).translate(0, 0.75, 0), std({ color: 0xffffff, metalness: 0.6, roughness: 0.35 }), cars.length);
  const cabM = new THREE.InstancedMesh(new THREE.BoxGeometry(2.3, 0.75, 1.7).translate(-0.2, 1.65, 0), std({ color: 0x0c0e14, metalness: 0.8, roughness: 0.15 }), cars.length);
  const tailM = new THREE.InstancedMesh(new THREE.BoxGeometry(0.06, 0.18, 1.7).translate(-2.22, 0.95, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.1, 0.15).multiplyScalar(2.5) }), cars.length);
  const headM = new THREE.InstancedMesh(new THREE.BoxGeometry(0.06, 0.16, 1.5).translate(2.22, 0.85, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.95, 0.85).multiplyScalar(2.2) }), cars.length);
  cars.forEach((c, i) => bodyM.setColorAt(i, tcol.set(c.kind === "taxi" ? 0xf2c020 : c.kind === "truck" ? [0xb03a2e, 0x2e6ab0, 0xd8a020][i % 3] : CAR_PAL[Math.floor(c.col * CAR_PAL.length)])));
  [bodyM, cabM, tailM, headM].forEach((m) => { m.frustumCulled = false; scene.add(m); });
  live.push((t, dt, R) => {
    cars.forEach((c, i) => {
      const near = Math.abs(c.s - R.idx) < 700;
      if (!near) { dummy.scale.setScalar(0); } else {
        const p = at(C, c.s, c.lat); dummy.position.set(p[0], 0, p[1]); dummy.rotation.set(0, p[2], 0);
        if (c.kind === "truck") dummy.scale.set(2.1, 2.3, 1.3); else dummy.scale.set(1, 1, 1);
      }
      dummy.updateMatrix(); bodyM.setMatrixAt(i, dummy.matrix); tailM.setMatrixAt(i, dummy.matrix); headM.setMatrixAt(i, dummy.matrix);
      if (near && c.kind === "truck") { dummy.scale.set(1.1, 1.4, 1.2); dummy.position.x += Math.cos(dummy.rotation.y) * 5.5; dummy.position.z -= Math.sin(dummy.rotation.y) * 5.5; dummy.updateMatrix(); }
      cabM.setMatrixAt(i, dummy.matrix);
    });
    [bodyM, cabM, tailM, headM].forEach((m) => { m.instanceMatrix.needsUpdate = true; });
  });

  /* ---------------- speed traps ---------------- */
  const traps = C.events.filter((e) => e.type === "trap").map((e) => {
    const c = document.createElement("canvas"); c.width = 512; c.height = 160; const x = c.getContext("2d"), tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const draw = (big, sub) => { x.fillStyle = "#06060c"; x.fillRect(0, 0, 512, 160); x.strokeStyle = "#ff40c0"; x.lineWidth = 6; x.strokeRect(6, 6, 500, 148); x.textAlign = "center"; x.fillStyle = "#fff"; x.font = "800 64px Inter, system-ui, sans-serif"; x.fillText(big, 256, 88); x.fillStyle = "#ff8ad8"; x.font = "600 30px Inter, system-ui, sans-serif"; x.fillText(sub, 256, 132); tex.needsUpdate = true; };
    draw("SPEED TRAP", "how fast can you go?");
    const g = new THREE.Group(), mat = glow(0xff40c0, 2), p = at(C, e.s);
    [-1, 1].forEach((sd) => { const m = new THREE.Mesh(new THREE.BoxGeometry(0.5, 9, 0.5), mat); m.position.set(0, 4.5, sd * (HALF + 1.5)); g.add(m); });
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, HALF * 2 + 3.5), mat); bar.position.y = 9; g.add(bar);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(10, 3.1), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide })); sign.position.y = 11.2; sign.rotation.y = -Math.PI / 2; g.add(sign);
    g.position.set(p[0], 0, p[1]); g.rotation.y = p[2]; scene.add(g);
    return { e, draw };
  });

  return {
    update(t, dt, R, cam, zi) { for (const f of live) f(t, dt, R, cam, zi); },
    trap(e, mph, best) { const tr = traps.find((q) => q.e === e); if (tr) tr.draw(mph + " MPH", best ? "new best here!" : "best here: " + Math.round(e.best) + " mph"); },
    resetTraps() { traps.forEach((q) => q.draw("SPEED TRAP", q.e.best ? "best here: " + Math.round(q.e.best) + " mph" : "how fast can you go?")); }
  };
}
