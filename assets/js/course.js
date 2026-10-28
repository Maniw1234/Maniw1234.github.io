// Ride mode: the course, its zones, the AI cars and events, and the handling of the bike and the cars. No three.js in here, so it can be
// tested on its own. Units are metres (the bike is about 2 m long). The bike faces +x at yaw 0 and moves along
// (cos yaw, -sin yaw). "s" is metres along the road, "lat" metres to the left of its centre line.

export const HALF = 7; // half the road width (four lanes)
export const LANES = [-5.25, -1.75, 1.75, 5.25];

// Ten zones, each a complete setting. pieces: [length in metres, how far it turns in degrees (+ = left)]
const ZONE_DEF = [
  { name: "Midtown", kind: "city", ramps: 2, pieces: [[520, 0], [90, 90], [420, 0], [90, -90], [480, 0], [90, -90], [320, 0], [90, 90], [300, 0]] },
  { name: "Harbor Bridge", kind: "bridge", ramps: 1, pieces: [[160, 20], [1560, 0], [220, -20]] },
  { name: "Underpass", kind: "tunnel", ramps: 1, pieces: [[300, 0], [800, -50], [600, 30], [300, 0]] },
  { name: "Red Desert", kind: "desert", ramps: 3, mega: 1, pieces: [[500, 0], [600, 60], [450, 0], [550, -80]] },
  { name: "Pine Switchbacks", kind: "forest", ramps: 1, pieces: [[220, 0], [130, 150], [220, 0], [130, -150], [260, 0], [130, 150], [260, 0], [320, -60], [380, 0]] },
  { name: "Summit Pass", kind: "snow", ramps: 2, pieces: [[300, 40], [320, -60], [420, 0], [300, 70], [300, -50], [400, 0]] },
  { name: "Neon Highway", kind: "cyber", ramps: 2, mega: 1, pieces: [[800, 0], [700, 30], [650, 0]] },
  { name: "Sunset Coast", kind: "coast", ramps: 2, pieces: [[400, -40], [400, 50], [400, -50], [400, 40], [420, 0]] },
  { name: "The Docks", kind: "port", ramps: 2, pieces: [[420, 0], [100, -90], [420, 0], [100, 90], [400, 0], [100, 90], [300, 0], [100, -90], [260, 0]] },
  { name: "The Stadium", kind: "stadium", ramps: 2, mega: 1, pieces: [[560, 0], [260, -120], [400, 0], [260, 120], [600, 0]] }
];

let seed = 7;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrapA = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export function buildCourse() {
  seed = 7;
  // curvature for every metre, smoothed so bends ease in and out
  const raw = [], zstart = [];
  ZONE_DEF.forEach((zd) => { zstart.push(raw.length); zd.pieces.forEach(([l, t]) => { for (let i = 0; i < l; i++) raw.push(t * Math.PI / 180 / l); }); });
  const N = raw.length, W = 40, k = new Float32Array(N);
  let run = 0; for (let i = -W; i < N + W; i++) { if (i + W < N) run += raw[i + W] || 0; if (i - W - 1 >= 0) run -= raw[i - W - 1]; if (i >= 0 && i < N) k[i] = run / (2 * W + 1); }
  const x = new Float32Array(N), z = new Float32Array(N), h = new Float32Array(N);
  let px = 0, pz = 0, ph = 0;
  for (let i = 0; i < N; i++) { x[i] = px; z[i] = pz; h[i] = ph; ph += k[i]; px += Math.cos(ph); pz -= Math.sin(ph); }

  const zones = ZONE_DEF.map((zd, i) => ({ ...zd, pieces: undefined, s: zstart[i], e: i + 1 < ZONE_DEF.length ? zstart[i + 1] : N }));
  const zoneAt = (s) => { for (let i = zones.length - 1; i >= 0; i--) if (s >= zones[i].s) return i; return 0; };
  const bend = (a, b) => { let m = 0; for (let i = Math.max(0, a); i < Math.min(N, b); i++) m = Math.max(m, Math.abs(k[i])); return m; };
  const C = { N, x, z, h, k, zones, zoneAt, bend, length: N };
  C.walls = zones.filter((zn) => zn.kind === "tunnel" || zn.kind === "bridge").map((zn) => [zn.s + 10, zn.e - 10]);
  C.tunnel = (() => { const t = zones.find((zn) => zn.kind === "tunnel"); return t && [t.s + 10, t.e - 10]; })();
  C.bridge = (() => { const t = zones.find((zn) => zn.kind === "bridge"); return t && [t.s, t.e]; })();

  // jumps: spread through each zone on straights; mega ramps send you high enough for doubles
  C.ramps = [];
  zones.forEach((zn) => {
    const n = zn.ramps || 0;
    for (let j = 0; j < n; j++) {
      const mega = j === n - 1 && zn.mega;
      for (let s = Math.round(zn.s + (zn.e - zn.s) * (j + 0.6) / (n + 0.4)); s < zn.e - 260; s += 10) {
        if (bend(s - 100, s + (mega ? 300 : 230)) < 0.0018 && !C.ramps.some((r) => Math.abs(r.s - s) < 350)) { C.ramps.push(mega ? { s, len: 26, h: 6, mega: true } : { s, len: 16, h: 2.8 }); break; }
      }
    }
  });
  const nearRamp = (s, d) => C.ramps.some((r) => s > r.s - d && s < r.s + r.len + d * 4);
  // boost pads on the straighter bits, alternating sides
  C.pads = [];
  for (let s = 400, side = 1; s < N - 300; s += 300) {
    if (nearRamp(s, 60) || bend(s - 30, s + 120) > 0.004) continue;
    C.pads.push({ s, lat: side * 3.5, len: 10 }); side = -side;
  }
  // sparkles to collect: short lines that weave across the lanes
  C.orbs = [];
  for (let s = 250, g = 0; s < N - 200; s += 210, g++) {
    if (nearRamp(s, 40)) continue;
    const off = (g % 3 - 1) * 3.6, swing = g % 2 ? 2.2 : -2.2;
    for (let j = 0; j < 5; j++) C.orbs.push({ s: s + j * 9, lat: off + swing * Math.sin(j / 4 * Math.PI), got: false });
  }
  C.orbs.forEach((o) => { const p = at(C, o.s, o.lat); o.x = p[0]; o.z = p[1]; });
  // checkpoints at each new zone, then the finish
  C.gates = zones.slice(1).map((zn) => zn.s).concat([N - 30]);

  C.racers = []; // filled by addRacers() when there are car models to race

  // events
  C.events = [];
  const at01 = (zn, f) => Math.round(zn.s + (zn.e - zn.s) * f);
  zones.forEach((zn) => {
    if (zn.kind === "desert") { let s = at01(zn, 0.5); while (nearRamp(s, 80)) s += 40; C.events.push({ type: "train", s, len: 150, v: 38, t: -1 }); }
    if (zn.kind === "snow") [0.35, 0.8].forEach((f) => { let s = at01(zn, f); while (nearRamp(s, 60)) s += 40; C.events.push({ type: "avalanche", s, t: -1, rocks: [] }); });
    if (zn.kind === "cyber") [0.25, 0.75].forEach((f) => { let s = at01(zn, f); while (nearRamp(s, 40)) s += 30; C.events.push({ type: "trap", s, best: 0 }); });
  });

  // scenery helpers: a hash of the road so props never land on any part of it
  const grid = new Map(), cell = 40, key = (i, j) => i * 100003 + j;
  for (let i = 0; i < N; i += 3) { const kk = key(Math.floor(x[i] / cell), Math.floor(z[i] / cell)); if (!grid.has(kk)) grid.set(kk, []); grid.get(kk).push(i); }
  C.clear = (px, pz, r) => {
    const ci = Math.floor(px / cell), cj = Math.floor(pz / cell), reach = Math.ceil((r + HALF + 3) / cell);
    for (let a = -reach; a <= reach; a++) for (let b = -reach; b <= reach; b++) for (const i of grid.get(key(ci + a, cj + b)) || []) if (Math.hypot(x[i] - px, z[i] - pz) < r + HALF + 3) return false;
    return true;
  };
  C.solid = new Map(); C.cell = cell;
  C.addSolid = (o) => { const kk = key(Math.floor(o.x / cell), Math.floor(o.z / cell)); if (!C.solid.has(kk)) C.solid.set(kk, []); C.solid.get(kk).push(o); };
  C.rnd = rnd;
  return C;
}

// a point beside the road: s metres along, lat metres to the left
export function at(C, s, lat = 0) {
  const i = clamp(Math.round(s), 0, C.N - 1), hh = C.h[i];
  return [C.x[i] - Math.sin(hh) * lat, C.z[i] - Math.cos(hh) * lat, hh];
}
const inRange = (list, s) => list.some(([a, b]) => s > a && s < b);

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
export const TUNE = { vmax: 74, vnitro: 90, acc: 13, nitroAcc: 9, brake: 26, grip: 32, offMax: 28, g: 20, flip: 5.4, spin: 6.8 };
// a car corners flat (a little body roll the other way) and pulls no wheelies; the pace is the same so races stay fair
export const CAR = { grip: 30, roll: -0.05 };

export function newRider(C, s = 4) {
  const p = at(C, s);
  return { x: p[0], z: p[1], yaw: p[2], v: 0, y: 0, vy: 0, steer: 0, lean: 0, pitch: 0, nitro: 0.5, boosting: false, idx: s, lat: 0, off: false, air: false, ramp: -1, far: 0, best: s, wheelie: 0, flip: 0, spin: 0, airT: 0, clock: 0, wobble: 0, slow: 0, car: false };
}

// what a set of rotations is called
export function trickName(flips, spins, airT) {
  const n = (k) => (k === 1 ? "" : k === 2 ? "Double " : k === 3 ? "Triple " : k + "x ");
  const parts = [];
  if (flips > 0) parts.push(n(flips) + "Backflip"); else if (flips < 0) parts.push(n(-flips) + "Frontflip");
  if (spins) parts.push(360 * Math.abs(spins) + "");
  if (!parts.length) return airT > 1.1 ? "Big Air" : "";
  return parts.length === 2 ? parts.join(" ") + (Math.abs(spins) === 1 && Math.abs(flips) === 1 ? " (Corkscrew)" : "") : parts[0];
}

// one physics step. input: {up, down, left, right, nitro} (0..1). Returns the events that happened.
export function step(C, R, input, dt) {
  const ev = {};
  const T = TUNE;
  R.clock += dt;
  // on the ground the keys ride the bike; in the air they throw tricks (W/S flip, A/D spin)
  const steerIn = R.air ? 0 : input.left - input.right;
  R.steer += (steerIn - R.steer) * (1 - Math.exp(-dt * 7));
  const v = R.v, av = Math.abs(v);
  R.off = Math.abs(R.lat) > HALF + 0.4 && !R.air;
  R.boosting = !!input.nitro && R.nitro > 0.01 && v > 2;
  if (R.boosting) R.nitro = Math.max(0, R.nitro - dt * 0.22);
  // engine and brakes
  const vmax = (R.boosting ? T.vnitro : T.vmax) * (R.wobble > 0 ? 0.6 : 1);
  let a = 0;
  if (input.up && v >= -0.5) a += (T.acc * (1 - Math.pow(clamp(v / vmax, 0, 1.2), 2.2)) + (R.boosting ? T.nitroAcc : 0)) * input.up;
  if (R.boosting && !input.up) a += T.nitroAcc * 0.6;
  if (input.down) a -= v > 0.5 ? T.brake * input.down : (v > -6 ? 5 * input.down : 0); // brake, then roll back slowly
  if (input.up && v < -0.5) a += T.brake;
  a -= Math.sign(v) * (0.5 + 0.00035 * v * v);
  if (R.off && av > T.offMax) a -= Math.sign(v) * 16;
  else if (R.off) a -= Math.sign(v) * (1.5 + av * 0.05);
  if (R.air) a = 0;
  const nv = v + a * dt;
  R.v = Math.abs(nv) < 0.05 && !input.up && !input.down ? 0 : (Math.sign(nv) !== Math.sign(v) && v !== 0 && !input.down && !input.up ? 0 : nv);
  R.wobble = Math.max(0, R.wobble - dt);
  // turning: lean follows the turn the way a real bike leans into it
  const turnMax = Math.min(2.1, (R.car ? CAR.grip : T.grip) / Math.max(av, 1)) * smooth01(av / 3);
  const yawRate = R.steer * turnMax * Math.sign(R.v || 1);
  R.yaw += yawRate * dt + (R.wobble > 0 ? Math.sin(R.clock * 19) * 0.25 * dt * R.wobble : 0);
  const lat = R.v * yawRate / 9.8, shake = R.wobble > 0 ? Math.sin(R.clock * 13) * 0.2 * R.wobble : 0;
  const leanWant = R.air ? R.lean * 0.98 : R.car ? clamp(lat, -3, 3) * CAR.roll + shake * 0.3 : -Math.atan(lat) + shake;
  R.lean += (clamp(leanWant, -1.05, 1.05) - R.lean) * (1 - Math.exp(-dt * 8));
  R.x += Math.cos(R.yaw) * R.v * dt; R.z -= Math.sin(R.yaw) * R.v * dt;

  // where on the road
  const L = locate(C, R.x, R.z, R.idx, false);
  R.idx = L.i; R.lat = L.lat;
  if (R.idx > R.best && R.idx < R.best + 120) R.best = R.idx;

  // the tunnel and the bridge have walls: slide along them
  if (inRange(C.walls, R.idx) && Math.abs(R.lat) > HALF + 0.6) {
    const side = Math.sign(R.lat), hh = C.h[R.idx], push = Math.abs(R.lat) - (HALF + 0.6);
    R.x += Math.sin(hh) * side * push; R.z += Math.cos(hh) * side * push; R.lat = side * (HALF + 0.6);
    const into = Math.sin(R.yaw - hh) * side;
    if (into > 0.02) { R.yaw -= wrapA(R.yaw - hh) * 0.5; R.v *= 0.9; ev.hit = Math.min(1, R.v * into / 20); }
  }
  // solid scenery: knocks your speed off and pushes you clear
  const ci = Math.floor(R.x / C.cell), cj = Math.floor(R.z / C.cell);
  for (let p = -1; p <= 1; p++) for (let q = -1; q <= 1; q++) for (const o of C.solid.get((ci + p) * 100003 + cj + q) || []) {
    const dx = R.x - o.x, dz = R.z - o.z, d = Math.hypot(dx, dz), rr = o.r + 0.8;
    if (d < rr && R.y < (o.hgt || 30)) { R.x = o.x + dx / (d || 1) * rr; R.z = o.z + dz / (d || 1) * rr; ev.hit = Math.min(1, av / 25); R.v *= 0.35; R.wobble = 1; }
  }

  // jumps
  if (!R.air) {
    let on = -1;
    C.ramps.forEach((r, i) => { if (R.idx >= r.s && R.idx <= r.s + r.len && Math.abs(R.lat) < HALF && R.v > 0) on = i; });
    if (on >= 0) { const r = C.ramps[on]; R.y = r.h * (R.idx - r.s) / r.len; R.pitch = Math.atan2(r.h, r.len); R.ramp = on; }
    else if (R.ramp >= 0) { // leaving the lip
      const r = C.ramps[R.ramp]; R.ramp = -1;
      if (R.idx > r.s + r.len - 2) { R.air = true; R.vy = R.v * Math.sin(Math.atan2(r.h, r.len)) * (r.mega ? 1.35 : 1.15) + 2; R.flip = R.spin = R.airT = 0; R.mega = !!r.mega; ev.launch = r.mega ? 2 : 1; }
      else R.y = 0;
    } else { R.y = 0; R.pitch *= Math.exp(-dt * 10); }
  }
  if (R.air) {
    R.vy -= T.g * dt; R.y += R.vy * dt; R.airT += dt;
    R.pitch += (Math.atan2(R.vy, Math.max(8, av)) * 0.6 - R.pitch) * (1 - Math.exp(-dt * 3));
    // tricks: hold to keep rotating; let go and the bike eases to the nearest whole turn
    const fIn = input.down - input.up, sIn = input.left - input.right;
    R.flipV = (R.flipV || 0) + ((fIn ? fIn * T.flip : (Math.round(R.flip / (2 * Math.PI)) * 2 * Math.PI - R.flip) * 3) - (R.flipV || 0)) * (1 - Math.exp(-dt * 6));
    R.spinV = (R.spinV || 0) + ((sIn ? sIn * T.spin : (Math.round(R.spin / (2 * Math.PI)) * 2 * Math.PI - R.spin) * 3) - (R.spinV || 0)) * (1 - Math.exp(-dt * 6));
    R.flip += R.flipV * dt; R.spin += R.spinV * dt;
    if (R.y <= 0) {
      R.y = 0; R.air = false; ev.land = Math.min(1, -R.vy / 18); R.vy = 0;
      const fOff = Math.abs(wrapA(R.flip)), sOff = Math.abs(wrapA(R.spin));
      const flips = Math.round(R.flip / (2 * Math.PI)), spins = Math.round(R.spin / (2 * Math.PI));
      const clean = fOff < 0.6 && sOff < 0.7;
      const name = trickName(flips, spins, R.airT);
      ev.trick = { name, flips, spins, air: R.airT, clean, pts: clean ? Math.abs(flips) * 600 + Math.abs(spins) * 450 + Math.round(R.airT * 120) + (flips && spins ? 400 : 0) : 0 };
      if (!clean) { R.v *= 0.5; R.wobble = 1.6; } // a sketchy landing costs you speed, nothing worse
      else if (flips || spins) R.nitro = Math.min(1, R.nitro + 0.25);
      R.flip = R.spin = R.flipV = R.spinV = 0; R.mega = false;
    }
  }
  // a little wheelie on full throttle at low speed
  R.wheelie += ((input.up && R.v > 1 && R.v < 22 && !R.air && !R.car ? 0.45 * (1 - R.v / 22) : 0) - R.wheelie) * (1 - Math.exp(-dt * 4));

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
  racing(C, R, dt, ev);
  events(C, R, dt, ev);
  // lost: too far from the road for a few seconds puts you back on it
  R.far = L.d > 45 ? R.far + dt : 0;
  if (R.far > 2.5) { reset(C, R); ev.reset = true; }
  return ev;
}

// timed set pieces: the desert train, avalanche boulders and speed traps
function events(C, R, dt, ev) {
  for (const e of C.events) {
    const ahead = e.s - R.idx;
    if (e.type === "train") {
      // starts rolling as you approach, timed to cross just before you arrive
      if (e.t < 0 && ahead < 420 && ahead > 0) e.t = 0;
      if (e.t >= 0) {
        e.t += dt; e.pos = -260 + e.v * e.t; // front of the train, metres from the road centre along the track
        if (e.pos - e.len > 300) e.t = -2; // gone
        if (Math.abs(R.idx - e.s) < 3 && R.y < 4 && e.pos > R.lat - 2 && e.pos - e.len < R.lat + 2 && !e.cool) { e.cool = true; R.v *= 0.3; R.wobble = 1.5; ev.hit = 1; ev.train = true; }
      }
    } else if (e.type === "avalanche") {
      if (e.t < 0 && ahead < 300 && ahead > 0) { e.t = 0; for (let k = 0; k < 6; k++) e.rocks.push({ s: e.s + (k - 2.5) * 9, lat: 26 + k * 7, r: 1.2 + (k % 3) * 0.4, v: 16 + k * 1.5, hit: false }); ev.avalanche = true; }
      if (e.t >= 0) {
        e.t += dt;
        for (const r of e.rocks) {
          r.lat -= r.v * dt;
          if (!r.hit && Math.abs(R.idx - r.s) < r.r + 1 && Math.abs(R.lat - r.lat) < r.r + 0.8 && R.y < r.r * 2) { r.hit = true; R.v *= 0.45; R.wobble = 1.2; ev.hit = 0.8; }
        }
        if (e.t > 12) e.rocks.length = 0;
      }
    } else if (e.type === "trap") {
      if (!e.done && R.idx >= e.s) { e.done = true; ev.trap = { e, v: R.v }; }
      if (R.idx < e.s - 50) e.done = false;
    }
  }
}

/* ---------------- the race: AI cars ---------------- */
export const RACE = { top: 62, grip: 18, band: true }; // tuned so a clean run just beats the quickest car
// list: [{ name, skill }] — skill near 1 is quick. Cars line up on a grid ahead of you and race to the finish.
export function addRacers(C, list) {
  C.racers = list.map((m, i) => ({ i, name: m.name || "Car " + (i + 1), skill: m.skill || 0.95, len: m.len || 4.5 }));
  resetRacers(C);
  return C.racers;
}
export function resetRacers(C) {
  C.racers.forEach((c, k) => Object.assign(c, { s: 14 + 9 * Math.floor(k / 2), lane: k % 2 ? 2 : 1, lat: LANES[k % 2 ? 2 : 1], v: 0, y: 0, vy: 0, air: false, ramp: -1, cool: 0, passed: false, done: false, time: 0, steer: 0 }));
}
// fastest speed the car can hold through the bends ahead, braking in time for each one
function cornerSpeed(C, c, top) {
  let want = top;
  for (let d = 8; d <= 200; d += 8) {
    const i = Math.min(C.N - 1, Math.round(c.s + d)), k = Math.abs(C.k[i]) + 1e-5;
    const vc = Math.sqrt(RACE.grip * c.skill / k), allow = Math.sqrt(vc * vc + 2 * 20 * d);
    if (allow < want) want = allow;
  }
  return want;
}
function racing(C, R, dt, ev) {
  for (const c of C.racers) {
    if (c.done && c.v < 0.5) continue;
    // speed: corners, then a little rubber band so the pack stays in sight
    const gap = c.s - R.idx;
    let top = RACE.top * c.skill * (!RACE.band ? 1 : gap > 160 ? 0.94 : gap < -160 ? 1.07 : 1);
    if (c.done || c.s > C.N - 40) top = 8;
    const want = Math.min(top, cornerSpeed(C, c, top));
    if (!c.air) c.v += clamp(want - c.v, -20 * dt, 11 * c.skill * dt * (1 - Math.pow(clamp(c.v / 80, 0, 1), 2)) + 0.6 * dt);
    c.s = Math.min(C.N - 2, c.s + c.v * dt);
    // lanes: pull out round anything slower just ahead, the player included
    const blocked = (lane) => C.racers.some((o) => o !== c && Math.abs(o.lat - LANES[lane]) < 2 && o.s - c.s > 0 && o.s - c.s < 16 && o.v < c.v + 1) || (R.idx - c.s > 0 && R.idx - c.s < 14 && Math.abs(R.lat - LANES[lane]) < 2 && R.v < c.v + 1);
    if (blocked(c.lane)) { const alt = [c.lane - 1, c.lane + 1].filter((l) => l >= 0 && l < LANES.length && !blocked(l)); if (alt.length) c.lane = alt[Math.abs(LANES[alt[0]]) < Math.abs(LANES[alt[alt.length - 1]]) ? 0 : alt.length - 1]; }
    const lr = Math.min(5, 0.3 * c.v) * dt, dLat = clamp(LANES[c.lane] - c.lat, -lr, lr); c.lat += dLat; c.steer = dLat / Math.max(dt, 1e-4) / 5;
    // jumps: same ramps as the bike
    const on = C.ramps.findIndex((r) => c.s >= r.s && c.s <= r.s + r.len);
    if (on >= 0 && !c.air) { const r = C.ramps[on]; c.y = r.h * (c.s - r.s) / r.len; c.ramp = on; }
    else if (c.ramp >= 0 && !c.air) { const r = C.ramps[c.ramp]; c.ramp = -1; c.air = true; c.vy = c.v * Math.sin(Math.atan2(r.h, r.len)) * (r.mega ? 1.35 : 1.15) + 1; }
    if (c.air) { c.vy -= 20 * dt; c.y += c.vy * dt; if (c.y <= 0) { c.y = 0; c.air = false; c.vy = 0; } }
    if (!c.done && c.s >= C.N - 30) { c.done = true; c.time = R.clock; }
    // contact with the player: a bump slows you, a close fast pass is a near miss
    c.cool = Math.max(0, c.cool - dt);
    const ds = R.idx - c.s, dl = R.lat - c.lat;
    if (Math.abs(ds) < c.len * 0.55 + 0.6 && Math.abs(dl) < 1.6 && Math.abs(R.y - c.y) < 1.5 && !c.cool) {
      c.cool = 1; R.wobble = 1; ev.hit = 0.7; ev.bump = true;
      if (ds < 0) R.v = Math.min(R.v, c.v * 0.85); else c.v *= 0.85; // whoever is behind loses out
      const side = Math.sign(dl) || 1, hh = C.h[R.idx]; R.x -= Math.sin(hh) * side * 0.7; R.z -= Math.cos(hh) * side * 0.7;
    }
    if (ds < -6) c.passed = false;
    if (!c.passed && ds > c.len * 0.55 && ds < c.len * 0.55 + 6) { c.passed = true; if (Math.abs(dl) < 2.8 && R.v - c.v > 5 && !c.cool) ev.near = (ev.near || 0) + 1; ev.overtake = (ev.overtake || 0) + 1; }
  }
}
// where you are in the race: 1 is in front
export function place(C, R, done) {
  const ahead = (s, d, t) => (done ? d && t < R.clock : s > R.idx);
  return 1 + C.racers.filter((c) => ahead(c.s, c.done, c.time)).length;
}

export function reset(C, R) {
  const s = Math.max(4, R.best - 10), p = at(C, s);
  Object.assign(R, { x: p[0], z: p[1], yaw: p[2], v: 0, y: 0, vy: 0, steer: 0, lean: 0, pitch: 0, idx: s, lat: 0, air: false, ramp: -1, far: 0, flip: 0, spin: 0, flipV: 0, spinV: 0, wobble: 0 });
}
// back to the start for a new run: traffic and events rewind too
export function rewind(C) {
  C.orbs.forEach((o) => { o.got = false; });
  C.events.forEach((e) => { e.t = -1; e.cool = false; e.done = false; if (e.rocks) e.rocks.length = 0; });
  resetRacers(C);
}

function smooth01(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
