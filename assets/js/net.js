// Multiplayer: one player hosts a room and gets a four-letter code, friends join with it.
// PeerJS links the browsers to each other directly; its free public server only introduces them.
// The host relays everything, so each guest only ever talks to the host.
const PEERJS = "https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js";
const PREFIX = "maniw1234-ride-";
const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I or O, they read as 1 and 0
export const MAX_PLAYERS = 6;

let lib = null;
function loadPeer() {
  if (window.Peer) return Promise.resolve(window.Peer);
  if (lib) return lib;
  lib = new Promise((ok, no) => {
    const s = document.createElement("script"); s.src = PEERJS; s.async = true;
    s.onload = () => (window.Peer ? ok(window.Peer) : no(new Error("PeerJS did not load")));
    s.onerror = () => { lib = null; no(new Error("PeerJS did not load")); };
    document.head.appendChild(s);
  });
  return lib;
}
// ?peer=localhost:9000 points at a local PeerJS server instead of the public one (for testing)
function options() {
  const q = new URLSearchParams(location.search).get("peer");
  if (!q) return { debug: 0 };
  const [host, port] = q.split(":");
  return { host, port: Number(port) || 9000, path: "/", secure: false, debug: 0 };
}
const newCode = () => Array.from({ length: 4 }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join("");
export const cleanCode = (s) => String(s || "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);

// hooks: lobby(players, me, host), start(players), state(id, s), fin(id, time), left(player), status(text, bad), closed(text)
export function createNet(hooks) {
  const net = { on: false, host: false, code: "", me: "", players: [], started: false };
  let peer = null, conns = new Map(), hostConn = null;
  const player = (id) => net.players.find((p) => p.id === id);
  const send = (c, m) => { try { if (c && c.open) c.send(m); } catch (e) { /* the channel closed */ } };
  const toAll = (m, except) => conns.forEach((c, id) => { if (id !== except) send(c, m); });
  const lobby = () => { const m = { t: "lobby", players: net.players, started: net.started }; toAll(m); hooks.lobby(net.players, net.me, net.host); };
  function fail(text) { hooks.status(text, true); leave(true); }

  // host side: every message from a guest comes here
  function fromGuest(id, m) {
    if (m.t === "hello") {
      if (net.players.length >= MAX_PLAYERS) { send(conns.get(id), { t: "full" }); return; }
      if (net.started) { send(conns.get(id), { t: "busy" }); return; }
      if (!player(id)) net.players.push({ id, name: String(m.name || "Rider").slice(0, 14), veh: String(m.veh || "h2") });
      lobby();
    } else if (m.t === "veh") { const p = player(id); if (p) { p.veh = String(m.veh); lobby(); } }
    else if (m.t === "st") { toAll({ t: "st", id, s: m.s }, id); hooks.state(id, m.s); }
    else if (m.t === "fin") { toAll({ t: "fin", id, time: m.time }, id); hooks.fin(id, m.time); }
  }
  function dropGuest(id) {
    conns.delete(id); const p = player(id); if (!p) return;
    net.players = net.players.filter((q) => q.id !== id); toAll({ t: "left", id }); hooks.left(p); lobby();
  }

  net.hostGame = async (name, veh, tries = 0) => {
    leave(true); hooks.status("Opening a room…");
    let Peer; try { Peer = await loadPeer(); } catch (e) { return fail("Couldn't reach the multiplayer service. Check your connection and try again."); }
    const code = newCode(); peer = new Peer(PREFIX + code, options());
    peer.on("open", () => {
      Object.assign(net, { on: true, host: true, code, me: "host", started: false, players: [{ id: "host", name, veh }] });
      hooks.status(""); lobby();
    });
    peer.on("connection", (c) => {
      c.on("open", () => conns.set(c.peer, c));
      c.on("data", (m) => m && typeof m === "object" && fromGuest(c.peer, m));
      c.on("close", () => dropGuest(c.peer)); c.on("error", () => dropGuest(c.peer));
    });
    peer.on("disconnected", () => { if (peer && !peer.destroyed) peer.reconnect(); }); // guests already linked stay linked
    peer.on("error", (e) => {
      if (e.type === "unavailable-id" && tries < 4) { net.hostGame(name, veh, tries + 1); return; } // that code is taken: pick another
      if (!net.on) fail("Couldn't open a room (" + (e.type || "error") + "). Try again.");
    });
  };

  net.join = async (rawCode, name, veh) => {
    const code = cleanCode(rawCode);
    if (code.length !== 4) { hooks.status("Room codes are four letters.", true); return; }
    leave(true); hooks.status("Joining " + code + "…");
    let Peer; try { Peer = await loadPeer(); } catch (e) { return fail("Couldn't reach the multiplayer service. Check your connection and try again."); }
    peer = new Peer(options());
    peer.on("open", (id) => {
      net.me = id;
      const c = peer.connect(PREFIX + code, { reliable: true, serialization: "json" }); hostConn = c;
      const timer = setTimeout(() => { if (!net.on) fail("No answer from room " + code + ". Check the code with the host."); }, 12000);
      c.on("open", () => { clearTimeout(timer); Object.assign(net, { on: true, host: false, code }); send(c, { t: "hello", name, veh }); });
      c.on("data", (m) => {
        if (!m || typeof m !== "object") return;
        if (m.t === "lobby") { net.players = m.players; hooks.status(""); hooks.lobby(net.players, net.me, false); }
        else if (m.t === "start") { net.started = true; net.players = m.players; hooks.start(net.players); }
        else if (m.t === "st") hooks.state(m.id, m.s);
        else if (m.t === "fin") hooks.fin(m.id, m.time);
        else if (m.t === "left") { const p = player(m.id); net.players = net.players.filter((q) => q.id !== m.id); if (p) hooks.left(p); }
        else if (m.t === "full") fail("That room is full (" + MAX_PLAYERS + " players).");
        else if (m.t === "busy") fail("That race has already started. Ask the host to let you in after it.");
      });
      c.on("close", () => { if (net.on) { leave(true); hooks.closed("The host closed the room."); } });
    });
    peer.on("error", (e) => {
      if (e.type === "peer-unavailable") fail("There's no room called " + code + ". Check the code with the host.");
      else if (!net.on) fail("Couldn't join (" + (e.type || "error") + "). Try again.");
    });
  };

  // host only: everyone starts the countdown together
  net.start = () => { if (!net.host) return; net.started = true; toAll({ t: "start", players: net.players }); hooks.start(net.players); };
  net.backToLobby = () => { if (net.host) { net.started = false; lobby(); } };
  net.setVehicle = (veh) => {
    if (!net.on) return; const me = player(net.me); if (me) me.veh = veh;
    if (net.host) lobby(); else send(hostConn, { t: "veh", veh });
  };
  net.state = (s) => { if (!net.on) return; if (net.host) toAll({ t: "st", id: "host", s }); else send(hostConn, { t: "st", s }); };
  net.finish = (time) => { if (!net.on) return; if (net.host) toAll({ t: "fin", id: "host", time }); else send(hostConn, { t: "fin", time }); };
  function leave(quiet) {
    const was = net.on;
    Object.assign(net, { on: false, host: false, code: "", started: false, players: [] });
    conns.forEach((c) => { try { c.close(); } catch (e) { /* already closed */ } }); conns = new Map();
    if (hostConn) { try { hostConn.close(); } catch (e) { /* already closed */ } hostConn = null; }
    if (peer) { try { peer.destroy(); } catch (e) { /* already gone */ } peer = null; }
    if (was && !quiet) hooks.closed("");
  }
  net.leave = () => leave(false);
  addEventListener("pagehide", () => leave(true));
  return net;
}
