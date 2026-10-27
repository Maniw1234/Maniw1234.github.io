// Ride mode: the course and the bike's handling. No three.js in here, so it can be tested on its own.
// Units are metres (the bike is about 2 m long). The bike faces +x at yaw 0 and moves along (cos yaw, -sin yaw).

export const HALF = 7; // half the road width
const SCALE = 1.7; // stretches the whole course; at racing pace a run takes 5 minutes or more

// The route as pieces of road: [length in metres, how far it turns in degrees (+ = left)]
const PIECES = [
  // 1 city blocks
  [420, 0], [160, 90], [260, 0], [160, -90], [300, 0], [120, -90], [200, 0], [220, 120], [260, 0],
  // 2 valley sweepers
  [500, -70], [400, 0], [600, 140], [300, 0], [400, -80],
  // 3 the tunnel
  [300, 0], [900, -60], [300, 0],
  // 4 canyon esses
  [180, 80], [180, -100], [200, 110], [160, -90], [220, 70], [300, 0], [260, -150], [200, 0],
  // 5 the bridge
  [900, 0], [500, 50], [600, 0], [400, -120],
  // 6 hairpins and the home straight
  [250, 0], [140, 170], [260, 0], [140, -170], [300, 0], [300, 60], [700, 0]
];
// Each zone starts at a piece: [first piece, name, scenery, colour 0..1 along blue → violet → rose]
const ZONE_DEF = [
  [0, "Neon City", "city", 0.0],
  [9, "Crystal Valley", "crystal", 0.3],
  [14, "The Tunnel", "tunnel", 0.55],
  [17, "Canyon Run", "canyon", 0.95],
  [25, "Skyline Bridge", "bridge", 0.15],
  [29, "Final Stretch", "final", 0.7]
];

let seed = 7;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function buildCourse() {
  seed = 7;
  // curvature for every metre, smoothed so bends ease in and out
  const raw = [], starts = [];
  PIECES.forEach(([l, t]) => { starts.push(raw.length); const n = Math.round(l * SCALE); for (let i = 0; i < n; i++) raw.push(t * Math.PI / 180 / n); });
  const N = raw.length, W = 50, k = new Float32Array(N);
  let run = 0; for (let i = -W; i < N + W; i++) { if (i + W < N) run += raw[i + W] || 0; if (i - W - 1 >= 0) run -= raw[i - W - 1]; if (i >= 0 && i < N) k[i] = run / (2 * W + 1); }
  const x = new Float32Array(N), z = new Float32Array(N), h = new Float32Array(N);
  let px = 0, pz = 0, ph = 0;
  for (let i = 0; i < N; i++) { x[i] = px; z[i] = pz; h[i] = ph; ph += k[i]; px += Math.cos(ph); pz -= Math.sin(ph); }

  const zones = ZONE_DEF.map(([p, name, kind, hue], i) => ({ name, kind, hue, s: starts[p], e: i + 1 < ZONE_DEF.length ? starts[ZONE_DEF[i + 1][0]] : N }));
  const zoneAt = (s) => { for (let i = zones.length - 1; i >= 0; i--) if (s >= zones[i].s) return i; return 0; };
  // how much the road bends over a stretch (for placing jumps and pads on straights)
  const bend = (a, b) => { let m = 0; for (let i = Math.max(0, a); i < Math.min(N, b); i++) m = Math.max(m, Math.abs(k[i])); return m; };
  const C = { N, x, z, h, k, zones, zoneAt, length: N };

  // jumps: two per open-air zone, each on a straight
  C.ramps = [];
  zones.forEach((zn) => {
    if (zn.kind === "tunnel") return;
    [0.32, 0.72].forEach((f) => {
      for (let s = Math.round(zn.s + (zn.e - zn.s) * f); s < zn.e - 260; s += 10) if (bend(s - 90, s + 220) < 0.0016) { C.ramps.push({ s, len: 16, h: 2.6 }); break; }
    });
  });
  const nearRamp = (s, d) => C.ramps.some((r) => s > r.s - d && s < r.s + r.len + d * 3);
  // boost pads on the straighter bits, alternating sides
  C.pads = [];
  for (let s = 400, side = 1; s < N - 300; s += 340) {
    if (nearRamp(s, 60) || bend(s - 30, s + 120) > 0.004) continue;
    C.pads.push({ s, lat: side * 3.4, len: 10 }); side = -side;
  }
  // sparkles to collect: short lines that weave across the lane
  C.orbs = [];
  for (let s = 250, g = 0; s < N - 200; s += 230, g++) {
    if (nearRamp(s, 40)) continue;
    const off = (g % 3 - 1) * 3.6, swing = g % 2 ? 2.2 : -2.2;
    for (let j = 0; j < 5; j++) C.orbs.push({ s: s + j * 9, lat: off + swing * Math.sin(j / 4 * Math.PI), got: false });
  }
  C.orbs.forEach((o) => { const p = at(C, o.s, o.lat); o.x = p[0]; o.z = p[1]; });
  // checkpoints at each new zone, then the finish
  C.gates = zones.slice(1).map((zn) => zn.s).concat([N - 30]);

  // scenery: placed either side of the road, kept clear of every other part of the road
  const grid = new Map(), cell = 40, key = (i, j) => i * 100003 + j;
  for (let i = 0; i < N; i += 3) { const kk = key(Math.floor(x[i] / cell), Math.floor(z[i] / cell)); if (!grid.has(kk)) grid.set(kk, []); grid.get(kk).push(i); }
  const clear = (px, pz, r) => {
    const ci = Math.floor(px / cell), cj = Math.floor(pz / cell);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const i of grid.get(key(ci + a, cj + b)) || []) if (Math.hypot(x[i] - px, z[i] - pz) < r + HALF + 3) return false;
    return true;
  };
  C.props = []; C.solid = new Map(); C.cell = cell;
  const put = (o) => {
    C.props.push(o);
    if (!o.r) return;
    const kk = key(Math.floor(o.x / cell), Math.floor(o.z / cell)); if (!C.solid.has(kk)) C.solid.set(kk, []); C.solid.get(kk).push(o);
  };
  zones.forEach((zn, zi) => {
    const L = zn.e - zn.s;
    if (zn.kind === "city") for (let s = zn.s + 30; s < zn.e; s += 22) for (const side of [-1, 1]) {
      const w = 10 + rnd() * 16, off = HALF + 8 + w / 2 + rnd() * 25, p = at(C, s, side * off);
      if (clear(p[0], p[1], w * 0.75)) put({ type: "tower", x: p[0], z: p[1], w, d: 10 + rnd() * 16, hgt: 25 + rnd() * rnd() * 110, rot: h[s], r: w * 0.72, zone: zi });
    }
    if (zn.kind === "crystal") for (let s = zn.s; s < zn.e; s += 11) {
      const side = rnd() < 0.5 ? -1 : 1, off = HALF + 6 + rnd() * rnd() * 90, p = at(C, s, side * off), sz = 3 + rnd() * rnd() * 26;
      if (clear(p[0], p[1], sz * 0.5)) put({ type: "crystal", x: p[0], z: p[1], size: sz, rot: rnd() * 6.3, tilt: (rnd() - 0.5) * 0.5, r: sz * 0.35, zone: zi });
    }
    if (zn.kind === "canyon") for (let s = zn.s; s < zn.e; s += 9) for (const side of [-1, 1]) {
      const sz = 8 + rnd() * 18, off = HALF + 7 + sz * 0.5 + rnd() * 10, p = at(C, s, side * off);
      if (clear(p[0], p[1], sz * 0.55)) put({ type: "rock", x: p[0], z: p[1], size: sz, hgt: 10 + rnd() * 34, rot: rnd() * 6.3, r: sz * 0.6, zone: zi });
    }
    if (zn.kind === "bridge") for (let s = zn.s + 40; s < zn.e - 40; s += 120) for (const side of [-1, 1]) {
      const p = at(C, s, side * (HALF + 2.2)); put({ type: "pylon", x: p[0], z: p[1], rot: h[s], r: 1.2, zone: zi, s, side });
    }
    if (zn.kind === "final") for (let s = zn.s + 60; s < zn.e - 60; s += 80) put({ type: "arch", s, zone: zi });
    if (zn.kind !== "tunnel" && zn.kind !== "bridge") for (let s = zn.s; s < zn.e; s += 30) for (const side of [-1, 1]) put({ type: "post", s, lat: side * (HALF + 1.2), zone: zi });
    if (zn.kind === "bridge") C.bridge = [zn.s, zn.e];
    if (zn.kind === "tunnel") C.tunnel = [zn.s + 20, zn.e - 20];
  });
  return C;
}

// a point beside the road: s metres along, lat metres to the left
export function at(C, s, lat = 0) {
  const i = clamp(Math.round(s), 0, C.N - 1), hh = C.h[i];
  return [C.x[i] - Math.sin(hh) * lat, C.z[i] - Math.cos(hh) * lat, hh];
}

// nearest piece of road, searched around the last one so the route can't be skipped by cutting across
export function locate(C, px, pz, hint, wide) {
  let best = hint, bd = Infinity;
  const r = wide ? C.N : 80, a = Math.max(0, hint - r), b = Math.min(C.N - 1, hint + r), st = wide ? 4 : 1;
  for (let i = a; i <= b; i += st) { const d = (C.x[i] - px) ** 2 + (C.z[i] - pz) ** 2; if (d < bd) { bd = d; best = i; } }
  if (wide) for (let i = Math.max(0, best - 4); i <= Math.min(C.N - 1, best + 4); i++) { const d = (C.x[i] - px) ** 2 + (C.z[i] - pz) ** 2; if (d < bd) { bd = d; best = i; } }
  const hh = C.h[best], lat = -(px - C.x[best]) * Math.sin(hh) - (pz - C.z[best]) * Math.cos(hh);
  return { i: best, lat, d: Math.sqrt(bd) };
}

/* ---------------- handling ---------------- */
export const TUNE = { vmax: 74, vnitro: 90, acc: 13, nitroAcc: 9, brake: 26, grip: 20, offMax: 28, g: 20 };

export function newRider(C, s = 4) {
  const p = at(C, s);
  return { x: p[0], z: p[1], yaw: p[2], v: 0, y: 0, vy: 0, steer: 0, lean: 0, pitch: 0, nitro: 0.5, boosting: false, idx: s, lat: 0, off: false, air: false, ramp: -1, far: 0, best: s, wheelie: 0 };
}

// one physics step. input: {up, down, left, right, nitro} (0..1). Returns the events that happened.
export function step(C, R, input, dt) {
  const ev = {};
  const T = TUNE;
  // steering eases in, and gets calmer at speed (grip limits how hard the bike can turn)
  R.steer += ((input.left - input.right) - R.steer) * (1 - Math.exp(-dt * 7));
  const v = R.v, av = Math.abs(v);
  R.off = Math.abs(R.lat) > HALF + 0.4 && !R.air;
  R.boosting = !!input.nitro && R.nitro > 0.01 && v > 2;
  if (R.boosting) R.nitro = Math.max(0, R.nitro - dt * 0.22);
  // engine and brakes
  const vmax = R.boosting ? T.vnitro : T.vmax;
  let a = 0;
  if (input.up && v >= -0.5) a += (T.acc * (1 - Math.pow(clamp(v / vmax, 0, 1.2), 2.2)) + (R.boosting ? T.nitroAcc : 0)) * input.up;
  if (R.boosting && !input.up) a += T.nitroAcc * 0.6;
  if (input.down) a -= v > 0.5 ? T.brake * input.down : (v > -6 ? 5 * input.down : 0); // brake, then roll back slowly
  if (input.up && v < -0.5) a += T.brake;
  a -= Math.sign(v) * (0.5 + 0.00035 * v * v);
  if (R.off && av > T.offMax) a -= Math.sign(v) * 16; // grass and gravel scrub speed off
  else if (R.off) a -= Math.sign(v) * (1.5 + av * 0.05);
  if (R.air) a = 0;
  const nv = v + a * dt;
  R.v = Math.abs(nv) < 0.05 && !input.up && !input.down ? 0 : (Math.sign(nv) !== Math.sign(v) && v !== 0 && !input.down && !input.up ? 0 : nv);
  // turning: lean follows the turn the way a real bike leans into it
  const turnMax = Math.min(1.5, T.grip / Math.max(av, 1)) * smooth01(av / 3);
  const yawRate = R.steer * turnMax * Math.sign(R.v || 1) * (R.air ? 0.35 : 1);
  R.yaw += yawRate * dt;
  const leanWant = R.air ? R.lean * 0.98 : -Math.atan(R.v * yawRate / 9.8) * 0.95;
  R.lean += (clamp(leanWant, -0.9, 0.9) - R.lean) * (1 - Math.exp(-dt * 8));
  R.x += Math.cos(R.yaw) * R.v * dt; R.z -= Math.sin(R.yaw) * R.v * dt;

  // where on the road
  const L = locate(C, R.x, R.z, R.idx, false);
  R.idx = L.i; R.lat = L.lat;
  if (R.idx > R.best && R.idx < R.best + 120) R.best = R.idx;

  // the tunnel and the bridge have walls: slide along them
  const walled = (C.tunnel && R.idx > C.tunnel[0] && R.idx < C.tunnel[1]) || (C.bridge && R.idx > C.bridge[0] && R.idx < C.bridge[1]);
  if (walled && Math.abs(R.lat) > HALF + 0.6) {
    const side = Math.sign(R.lat), hh = C.h[R.idx], push = Math.abs(R.lat) - (HALF + 0.6);
    R.x += Math.sin(hh) * side * push; R.z += Math.cos(hh) * side * push; R.lat = side * (HALF + 0.6);
    const into = Math.sin(R.yaw - hh) * side; // heading into the wall
    if (into > 0.02) { R.yaw -= (R.yaw - hh - Math.round((R.yaw - hh) / (2 * Math.PI)) * 2 * Math.PI) * 0.5; R.v *= 0.9; ev.hit = Math.min(1, R.v * into / 20); }
  }
  // solid scenery: bounce off
  const ci = Math.floor(R.x / C.cell), cj = Math.floor(R.z / C.cell);
  for (let p = -1; p <= 1; p++) for (let q = -1; q <= 1; q++) for (const o of C.solid.get((ci + p) * 100003 + cj + q) || []) {
    const dx = R.x - o.x, dz = R.z - o.z, d = Math.hypot(dx, dz), rr = o.r + 0.8;
    if (d < rr && R.y < (o.hgt || 30)) { R.x = o.x + dx / (d || 1) * rr; R.z = o.z + dz / (d || 1) * rr; ev.hit = Math.min(1, av / 25); R.v *= -0.25; }
  }

  // jumps
  if (!R.air) {
    let on = -1;
    C.ramps.forEach((r, i) => { if (R.idx >= r.s && R.idx <= r.s + r.len && Math.abs(R.lat) < HALF && R.v > 0) on = i; });
    if (on >= 0) { const r = C.ramps[on]; R.y = r.h * (R.idx - r.s) / r.len; R.pitch = Math.atan2(r.h, r.len); R.ramp = on; }
    else if (R.ramp >= 0) { // leaving the lip
      const r = C.ramps[R.ramp]; R.ramp = -1;
      if (R.idx > r.s + r.len - 2) { R.air = true; R.vy = R.v * Math.sin(Math.atan2(r.h, r.len)) * 1.15 + 2; ev.launch = true; }
      else R.y = 0;
    } else { R.y = 0; R.pitch *= Math.exp(-dt * 10); }
  }
  if (R.air) {
    R.vy -= T.g * dt; R.y += R.vy * dt;
    R.pitch += (Math.atan2(R.vy, Math.max(8, av)) * 0.6 - R.pitch) * (1 - Math.exp(-dt * 3));
    if (R.y <= 0) { R.y = 0; R.air = false; ev.land = Math.min(1, -R.vy / 18); R.vy = 0; }
  }
  // a little wheelie on full throttle at low speed
  R.wheelie += ((input.up && R.v > 1 && R.v < 22 && !R.air ? 0.45 * (1 - R.v / 22) : 0) - R.wheelie) * (1 - Math.exp(-dt * 4));

  // boost pads
  C.pads.forEach((p, i) => {
    if (!R.air && R.idx >= p.s && R.idx <= p.s + p.len && Math.abs(R.lat - p.lat) < 2.4 && R.v > 0 && R.lastPad !== i) {
      R.lastPad = i; R.v = Math.min(T.vnitro, R.v + 14); R.nitro = Math.min(1, R.nitro + 0.35); ev.pad = true;
    }
  });
  // sparkles
  for (const o of C.orbs) {
    if (o.got || Math.abs(o.s - R.idx) > 12) continue;
    if (Math.hypot(o.x - R.x, o.z - R.z) < 2.3 && R.y < 3.5) { o.got = true; R.nitro = Math.min(1, R.nitro + 0.06); ev.orb = (ev.orb || 0) + 1; }
  }
  // lost: too far from the road for a few seconds puts you back on it
  R.far = L.d > 45 ? R.far + dt : 0;
  if (R.far > 2.5) { reset(C, R); ev.reset = true; }
  return ev;
}

export function reset(C, R) {
  const s = Math.max(4, R.best - 10), p = at(C, s);
  Object.assign(R, { x: p[0], z: p[1], yaw: p[2], v: 0, y: 0, vy: 0, steer: 0, lean: 0, pitch: 0, idx: s, lat: 0, air: false, ramp: -1, far: 0 });
}

function smooth01(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
