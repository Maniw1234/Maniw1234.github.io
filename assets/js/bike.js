// Stand-in sport bike, built from code so the site works before a real model is added.
// Forward is +x, the ground is y = 0, units are roughly metres before BIKE_SCALE.
// If assets/models/bike.glb exists, loadBikeModel() swaps it in (see main.js).
import * as THREE from "three";

export const BIKE_SCALE = 1.3;

function taperZ(geo, fn) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) * fn(p.getX(i), p.getY(i)));
  geo.computeVertexNormals();
  return geo;
}

function panel(points, depth, bevel, mat, taper) {
  const s = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 4, curveSegments: 24, steps: 1 });
  g.translate(0, 0, -depth / 2);
  if (taper) taperZ(g, taper);
  return new THREE.Mesh(g, mat);
}

function smoothShape(pts, n = 8) {
  // Catmull-Rom through the control points, closed, so panels read as moulded plastic
  const c = new THREE.CatmullRomCurve3(pts.map(([x, y]) => new THREE.Vector3(x, y, 0)), true, "centripetal");
  return c.getPoints(pts.length * n).map((v) => [v.x, v.y]);
}

function discTexture() {
  const c = document.createElement("canvas"); c.width = c.height = 256; const x = c.getContext("2d");
  x.fillStyle = "#fff"; x.fillRect(0, 0, 256, 256);
  x.fillStyle = "#000";
  for (let r = 0; r < 3; r++) for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2 + r * 0.11, rad = 84 + r * 14;
    x.beginPath(); x.arc(128 + Math.cos(a) * rad, 128 + Math.sin(a) * rad, 3.2, 0, Math.PI * 2); x.fill();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.NoColorSpace; return t;
}

export function buildBike() {
  const bike = new THREE.Group();
  const body = new THREE.Group(); bike.add(body);

  const paint = new THREE.MeshPhysicalMaterial({ color: 0x0a0b0f, metalness: 0.55, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.25 });
  const satin = new THREE.MeshPhysicalMaterial({ color: 0x15171d, metalness: 0.35, roughness: 0.55, clearcoat: 0.4, clearcoatRoughness: 0.3 });
  const matte = new THREE.MeshStandardMaterial({ color: 0x111215, metalness: 0.1, roughness: 0.85 });
  const frameM = new THREE.MeshStandardMaterial({ color: 0x1c1e24, metalness: 0.8, roughness: 0.38 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xd9dde6, metalness: 1, roughness: 0.18 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x8d929c, metalness: 1, roughness: 0.32 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x0b0b0c, metalness: 0, roughness: 0.92 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xc8892e, metalness: 1, roughness: 0.3 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x9aa6b8, metalness: 0, roughness: 0.05, transparent: true, opacity: 0.28, clearcoat: 1, side: THREE.DoubleSide, depthWrite: false });

  const nose = (x) => THREE.MathUtils.clamp(1 - Math.max(0, x - 0.6) / 0.45 * 0.6, 0.35, 1);

  // Upper fairing with the sharp nose
  body.add(panel(smoothShape([[1.05, 0.79], [0.88, 0.94], [0.68, 1.02], [0.57, 0.97], [0.53, 0.8], [0.6, 0.63], [0.8, 0.65], [0.96, 0.72]], 3), 0.34, 0.025, paint, (x) => nose(x)));
  // Side fairing: one long angular panel down to the belly
  body.add(panel(smoothShape([[0.62, 0.68], [0.6, 0.5], [0.46, 0.3], [0.18, 0.19], [-0.06, 0.22], [-0.02, 0.38], [0.18, 0.56], [0.44, 0.8]], 3), 0.31, 0.022, paint, (x, y) => 0.82 + 0.18 * THREE.MathUtils.clamp((y - 0.2) / 0.5, 0, 1)));
  // Vent cut into the side fairing
  [1, -1].forEach((sd) => { const v = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, 0.01), new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 0.9 })); v.position.set(0.44, 0.58, sd * 0.172); v.rotation.z = 0.55; body.add(v); });
  // Tank
  body.add(panel(smoothShape([[0.54, 0.9], [0.36, 1.0], [0.12, 1.02], [-0.08, 0.95], [-0.12, 0.84], [0.1, 0.78], [0.46, 0.8]], 4), 0.34, 0.05, paint, (x) => 0.78 + 0.22 * THREE.MathUtils.clamp((x + 0.1) / 0.4, 0, 1)));
  // Seat (rider) and pillion hump
  body.add(panel(smoothShape([[-0.08, 0.86], [-0.44, 0.84], [-0.5, 0.88], [-0.4, 0.9], [-0.1, 0.9]]), 0.24, 0.03, matte));
  body.add(panel(smoothShape([[-0.52, 0.9], [-0.74, 0.97], [-0.78, 1.0], [-0.6, 1.0], [-0.5, 0.94]]), 0.18, 0.025, matte));
  // Tail section, swept up and narrowing
  body.add(panel(smoothShape([[-0.36, 0.86], [-0.62, 0.95], [-0.94, 1.06], [-1.0, 1.03], [-0.96, 0.97], [-0.62, 0.8], [-0.36, 0.76]], 3), 0.26, 0.025, paint, (x) => THREE.MathUtils.clamp(1 - Math.max(0, -x - 0.4) / 0.6 * 0.55, 0.35, 1)));
  // Silver accent line on the fairing
  const accent = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.012, 0.005), steel);
  [1, -1].forEach((s) => { const a = accent.clone(); a.position.set(0.3, 0.42, s * 0.158); a.rotation.z = 0.5; body.add(a); });

  // Windscreen
  const ws = new THREE.Mesh(taperZ(new THREE.ExtrudeGeometry(new THREE.Shape(smoothShape([[0.84, 0.97], [0.66, 1.15], [0.6, 1.17], [0.6, 1.03]], 6).map(([x, y]) => new THREE.Vector2(x, y))), { depth: 0.3, bevelEnabled: false }).translate(0, 0, -0.15), (x) => 0.45 + 0.55 * THREE.MathUtils.clamp((0.84 - x) / 0.24, 0, 1)), glass);
  body.add(ws);

  // Headlights: two slanted LED slits plus the centre intake
  const ledM = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xe8f0ff).multiplyScalar(3.2) });
  const lights = new THREE.Group(); body.add(lights);
  [1, -1].forEach((s) => {
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.025, 0.02), ledM);
    l.position.set(0.97, 0.75, s * 0.075); l.rotation.set(0, s * 0.55, -0.32); lights.add(l);
  });
  const intake = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.07), new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 0.9 }));
  intake.position.set(1.03, 0.7, 0); body.add(intake);

  // Mirrors
  [1, -1].forEach((s) => {
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.12), frameM); stalk.position.set(0.68, 1.02, s * 0.22); stalk.rotation.x = s * 0.9; body.add(stalk);
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.12), paint); m.position.set(0.66, 1.06, s * 0.28); body.add(m);
  });

  // Frame, engine and exhaust headers (visible between the panels)
  const engine = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.34, 0.3), frameM); engine.position.set(0.18, 0.46, 0); engine.rotation.z = 0.15; body.add(engine);
  const cover = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.33, 24), satin); cover.rotation.x = Math.PI / 2; cover.position.set(0.02, 0.38, 0); body.add(cover);
  [1, -1].forEach((s) => {
    const spar = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.07, 0.04), frameM); spar.position.set(0.26, 0.74, s * 0.15); spar.rotation.z = -0.5; body.add(spar);
    const sub = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.03, 0.03), frameM); sub.position.set(-0.44, 0.72, s * 0.11); sub.rotation.z = -0.3; body.add(sub);
  });
  for (let i = 0; i < 4; i++) {
    const h = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0.42, 0.56, (i - 1.5) * 0.06), new THREE.Vector3(0.48, 0.32, (i - 1.5) * 0.05), new THREE.Vector3(0.3, 0.17, (i - 1.5) * 0.03), new THREE.Vector3(0.0, 0.17, 0)]), 20, 0.018, 8), steel);
    body.add(h);
  }
  const link = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.42, 16), steel); link.rotation.z = Math.PI / 2 - 0.08; link.position.set(-0.18, 0.2, 0.05); body.add(link);

  // Muffler (right side), angled up and back: the flames come out of this
  const muffler = new THREE.Group(); body.add(muffler);
  const can = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.095, 0.5, 6), satin); can.rotation.z = Math.PI / 2 - 0.32; muffler.add(can);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.085, 0.05, 24), chrome); cap.rotation.z = Math.PI / 2 - 0.32; cap.position.set(-0.26, 0.085, 0); muffler.add(cap);
  const hole = new THREE.Mesh(new THREE.CircleGeometry(0.05, 20), new THREE.MeshBasicMaterial({ color: 0x050505 })); hole.rotation.y = -Math.PI / 2; hole.rotation.x = 0; hole.position.set(-0.29, 0.095, 0); hole.rotateOnAxis(new THREE.Vector3(1, 0, 0), 0); muffler.add(hole);
  muffler.position.set(-0.42, 0.52, 0.17);
  const exhaustTip = new THREE.Object3D(); exhaustTip.position.set(-0.3, 0.1, 0); muffler.add(exhaustTip);
  const exhaustDir = new THREE.Vector3(-Math.cos(0.32), Math.sin(0.32), 0); // in body space

  // Swingarm
  [1, -1].forEach((s) => { const a = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.07, 0.035), frameM); a.position.set(-0.4, 0.37, s * 0.1); a.rotation.z = 0.17; body.add(a); });
  // Footpegs
  [1, -1].forEach((s) => { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.1), chrome); p.rotation.x = Math.PI / 2; p.position.set(-0.22, 0.42, s * 0.2); body.add(p); });

  // Fork and clip-ons
  const forkTop = new THREE.Vector3(0.56, 0.95, 0), axleF = new THREE.Vector3(0.74, 0.31, 0);
  const forkLen = forkTop.distanceTo(axleF), forkAng = Math.atan2(forkTop.x - axleF.x, forkTop.y - axleF.y);
  [1, -1].forEach((s) => {
    const up = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, forkLen * 0.55, 16), chrome); up.position.copy(forkTop).lerp(axleF, 0.27).setZ(s * 0.085); up.rotation.z = -forkAng; body.add(up);
    const lo = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.034, forkLen * 0.48, 16), frameM); lo.position.copy(forkTop).lerp(axleF, 0.74).setZ(s * 0.085); lo.rotation.z = -forkAng; body.add(lo);
    const cal = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 0.03), gold); cal.position.set(axleF.x - 0.1, axleF.y + 0.1, s * 0.1); cal.rotation.z = -0.9; body.add(cal);
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.2), frameM); bar.rotation.x = Math.PI / 2; bar.rotation.y = s * 0.2; bar.position.set(0.5, 0.95, s * 0.2); body.add(bar);
  });
  const fender = panel(smoothShape([[0.6, 0.6], [0.74, 0.66], [0.92, 0.6], [0.95, 0.56], [0.74, 0.62]]), 0.12, 0.02, paint); body.add(fender);

  // Tail light and plate hanger
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.025, 0.14), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff2a3a).multiplyScalar(2.6) }));
  tail.position.set(-1.0, 1.01, 0); body.add(tail);
  const hanger = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.26, 0.08), frameM); hanger.position.set(-0.92, 0.84, 0); hanger.rotation.z = -0.5; body.add(hanger);

  // Wheels
  const discTex = discTexture();
  function wheel(front) {
    const w = new THREE.Group(), spin = new THREE.Group(); w.add(spin);
    const tire = new THREE.Mesh(new THREE.TorusGeometry(0.255, 0.068, 20, 64), rubber); spin.add(tire);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.228, 0.016, 10, 64), satin); spin.add(rim);
    const stripe = new THREE.Mesh(new THREE.TorusGeometry(0.236, 0.004, 6, 64), chrome); stripe.position.z = 0.03; spin.add(stripe);
    const stripe2 = stripe.clone(); stripe2.position.z = -0.03; spin.add(stripe2);
    for (let i = 0; i < 5; i++) for (const off of [-0.07, 0.07]) {
      const sp = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.022, 0.022), satin);
      const a = (i / 5) * Math.PI * 2 + off; sp.position.set(Math.cos(a) * 0.12, Math.sin(a) * 0.12, 0); sp.rotation.z = a; spin.add(sp);
    }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.16, 20), steel); hub.rotation.x = Math.PI / 2; spin.add(hub);
    const discMat = new THREE.MeshStandardMaterial({ color: 0xb7bcc6, metalness: 1, roughness: 0.28, alphaMap: discTex, alphaTest: 0.5, side: THREE.DoubleSide });
    (front ? [0.07, -0.07] : [-0.06]).forEach((z) => { const d = new THREE.Mesh(new THREE.RingGeometry(0.07, 0.15, 48), discMat); d.position.z = z; spin.add(d); });
    return { w, spin };
  }
  const wF = wheel(true), wR = wheel(false);
  wF.w.position.copy(axleF); wR.w.position.set(-0.72, 0.31, 0); body.add(wF.w, wR.w);
  const chain = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.012, 0.012), steel); chain.position.set(-0.36, 0.33, -0.1); chain.rotation.z = 0.05; body.add(chain);

  body.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
  bike.scale.setScalar(BIKE_SCALE);
  return { bike, body, wheels: [wF.spin, wR.spin], exhaustTip, exhaustDir, headlight: new THREE.Vector3(1.0, 0.75, 0), tail, lights };
}
