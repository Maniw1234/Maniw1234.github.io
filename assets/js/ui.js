// Page UI that works with or without the 3D ride: nav and its way-in, section spy, section-by-section scrolling,
// project cards (loaded from content/projects.json) and the full-screen project view.
(function () {
  "use strict";
  var REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var root = document.documentElement;
  var view = document.getElementById("project-view");

  // without WebGL (or if the 3D script never runs) the loading screen still goes away
  window.addEventListener("load", function () { setTimeout(function () { if (!root.classList.contains("has-gl") && window.__load) window.__load.done(); }, 300); });

  var year = document.getElementById("year");
  if (year) year.textContent = String(new Date().getFullYear());

  /* ---------- helpers ---------- */
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  // Only web links, mail links and paths inside this site
  function safeUrl(u) {
    if (!u) return "";
    u = String(u).trim();
    if (/^(https?:\/\/|mailto:)/i.test(u)) return u;
    if (/^\/?[\w.\-\/% ]+$/.test(u) && u.indexOf("..") === -1) return u.replace(/^\//, "");
    return "";
  }
  function slugify(s, i) {
    var x = String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    return "project-" + (x || String(i + 1));
  }
  function getJSON(url) {
    return fetch(url, { cache: "no-cache" }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); });
  }
  var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8 9l-4 3 4 3M16 9l4 3-4 3M13.5 6l-3 12"/></svg>';
  var ACCENTS = [["#4796e3", "#9177c7"], ["#ca6673", "#9177c7"], ["#3fa8c4", "#4796e3"], ["#9177c7", "#ca6673"]];

  /* ---------- nav glint: the light on the bar's top edge follows the pointer, else rests on the active link ---------- */
  var bar = document.querySelector(".nav__bar"), hovering = false;
  function glintAt(el) {
    if (!bar) return;
    if (!el) { bar.style.setProperty("--ga", "0"); return; }
    var b = bar.getBoundingClientRect(), r = el.getBoundingClientRect();
    bar.style.setProperty("--gx", (r.left + r.width / 2 - b.left) + "px");
    bar.style.setProperty("--ga", "1");
  }
  function restGlint() { glintAt(document.querySelector(".nav a.is-active[data-section]")); }
  if (bar) {
    bar.addEventListener("pointermove", function (e) {
      if (e.pointerType !== "mouse") return;
      hovering = true;
      bar.style.setProperty("--gx", (e.clientX - bar.getBoundingClientRect().left) + "px");
      bar.style.setProperty("--ga", "1");
    });
    bar.addEventListener("pointerleave", function () { hovering = false; restGlint(); });
    window.addEventListener("resize", restGlint);
  }

  /* ---------- active section in the nav ----------
     The brand stands for the top of the page. During a ride the line goes straight to where the ride
     ends, instead of flickering across every section the page passes on the way. */
  var SECTIONS = ["hero", "about", "projects", "skills", "contact"];
  var links = document.querySelectorAll(".nav a[data-section]"), seen = "hero", shown = "hero", introDone = false;
  function setActive(id) {
    shown = id;
    if (!introDone) return; // the first line draws under mani as the bar's way-in animation ends
    links.forEach(function (a) { a.classList.toggle("is-active", a.dataset.section === id); });
    if (!hovering) restGlint();
  }
  function endIntro() { introDone = true; setActive(shown); }
  if (!root.classList.contains("is-loading") && !root.classList.contains("is-loaded")) endIntro();
  else {
    var waitIntro = function () {
      if (!root.classList.contains("is-loaded")) return false;
      setTimeout(endIntro, REDUCED ? 0 : root.classList.contains("has-gl") ? 3300 : 1600); return true; // after the 3D way in, when there is one
    };
    if (!waitIntro()) {
      var mo = new MutationObserver(function () { if (waitIntro()) mo.disconnect(); });
      mo.observe(root, { attributes: true, attributeFilter: ["class"] });
    }
  }
  /* Play steps aside at the footer, so it never covers the last lines */
  var foot = document.querySelector(".footer");
  if (foot && "IntersectionObserver" in window) {
    new IntersectionObserver(function (en) { root.classList.toggle("at-end", en[0].isIntersecting); }).observe(foot);
  }
  if ("IntersectionObserver" in window) {
    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) seen = en.target.id; });
      if (!step.busy) setActive(seen);
    }, { rootMargin: "-45% 0px -50% 0px" });
    SECTIONS.forEach(function (id) { var s = document.getElementById(id); if (s) spy.observe(s); });
  }

  /* ---------- section-by-section scrolling ----------
     With the 3D ride running, a hard scroll (or a flick, or an arrow key) glides the page to the next
     section while the bike plays one full stunt and lands. A gentle scroll or slow drag keeps the page
     still and revs the parked bike instead. Without 3D, or with reduced motion, the page scrolls normally. */
  var STOP_IDS = ["hero", "about", "projects", "skills"];
  var step = { busy: false, until: 0, sum: 0, dir: true, last: 0, hold: false, floor: 0 }, RIDE_AT = 140;
  function rev(amount) { if (typeof window.__rideRev === "function") window.__rideRev(amount); }
  function stepping() { return root.classList.contains("has-gl") && !REDUCED && !(view && view.open) && !root.classList.contains("in-garage"); }
  function stops() {
    var y0 = window.scrollY, list = STOP_IDS.map(function (id) {
      var s = document.getElementById(id); return s ? Math.round(s.getBoundingClientRect().top + y0) : 0;
    });
    list.push(Math.max(0, document.documentElement.scrollHeight - window.innerHeight));
    return list;
  }
  /* ---------- ride-through: the words scatter as the bike rides off and fly back in when it lands ---------- */
  function splitWords(el) {
    Array.prototype.slice.call(el.childNodes).forEach(function (n) {
      if (n.nodeType === 3) {
        var frag = document.createDocumentFragment();
        n.textContent.split(/(\s+)/).forEach(function (part) {
          if (!part) return;
          if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(part)); return; }
          var w = document.createElement("span"); w.className = "w"; w.textContent = part; frag.appendChild(w);
        });
        el.replaceChild(frag, n);
      } else if (n.nodeType === 1) {
        if (n.classList.contains("g-text")) n.classList.add("w"); // gradient text moves as one piece
        else splitWords(n);
      }
    });
  }
  function prepFx(pin) {
    pin.querySelectorAll("h1, h2").forEach(splitWords);
    var all = Array.prototype.slice.call(pin.querySelectorAll(".w, p, li, .btn, .pcard, .rail-nav"));
    var pieces = all.filter(function (el) { return !all.some(function (o) { return o !== el && o.contains(el); }); });
    pieces.forEach(function (el, i) {
      el.classList.add("fx");
      el.style.setProperty("--i", String(Math.min(i, 24)));
      el.style.setProperty("--dx", Math.round((Math.random() - 0.5) * 220) + "px");
      el.style.setProperty("--dy", Math.round((Math.random() - 0.6) * 120) + "px");
      el.style.setProperty("--r", Math.round((Math.random() - 0.5) * 50) + "deg");
    });
  }
  function riding(on) { root.classList.toggle("riding", on); }

  function glide(target, quick) {
    var from = window.scrollY, dist = target - from;
    if (Math.abs(dist) < 2) return;
    riding(true); root.classList.toggle("quick-ride", !!quick);
    window.__rideTo = target; // where this ride ends, so the bike knows when to turn back to its parked angle
    // scrolling: one section per glide, slow enough to watch the whole stunt (sine easing keeps the middle
    // from rushing). Nav links are shortcuts: the same stunts, played fast.
    var dur = quick ? Math.min(1400, 800 + Math.abs(dist) / window.innerHeight * 120)
      : Math.min(4600, 3400 + Math.max(0, Math.abs(dist) / window.innerHeight - 1.6) * 500), t0 = performance.now();
    step.busy = true;
    var s = stops(), at = s.indexOf(Math.round(target));
    if (at >= 0) setActive(at === s.length - 1 ? "contact" : STOP_IDS[at]);
    var landAt = quick ? 0.6 : 0.75; // the bike touches down about here: the words fly back in as it lands
    (function tick(now) {
      var k = Math.min(1, (now - t0) / dur), e = (1 - Math.cos(Math.PI * k)) / 2;
      window.scrollTo({ top: from + dist * e, behavior: "instant" });
      if (k >= landAt) riding(false);
      if (k < 1) requestAnimationFrame(tick);
      else { step.busy = false; step.until = performance.now() + 300; root.classList.remove("quick-ride"); setActive(seen); }
    })(t0);
  }
  function stepBy(dir) {
    if (step.busy || performance.now() < step.until) return;
    var s = stops(), y = window.scrollY, i;
    if (dir > 0) { for (i = 0; i < s.length; i++) if (s[i] > y + 4) return glide(s[i]); }
    else { for (i = s.length - 1; i >= 0; i--) if (s[i] < y - 4) return glide(s[i]); }
  }
  function goTo(id) {
    var s = stops(), i = STOP_IDS.indexOf(id);
    if (id === "contact") i = s.length - 1;
    if (i < 0) return false;
    glide(s[i], true); return true;
  }
  window.addEventListener("wheel", function (e) {
    if (!stepping() || e.ctrlKey) return;
    if (e.target.closest && e.target.closest(".rail") && Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    e.preventDefault();
    var now = e.timeStamp || performance.now(), dy = e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? window.innerHeight : 1);
    // ignore the rest of the gesture that started a ride (trackpad momentum). Momentum only fades and keeps
    // its direction, so a scroll that gets stronger again or turns around is a new gesture and counts at once
    // (before, it stayed ignored until the trackpad was touched to stop the momentum).
    var mag = Math.abs(dy), fresh = step.hold && dy !== 0 && ((dy > 0) !== step.dir || mag > step.floor * 2 + 6);
    if (step.busy || now < step.until || (step.hold && !fresh && now - step.last < 220)) {
      if (!step.hold || fresh) step.floor = mag; else step.floor = Math.min(step.floor, mag);
      if (dy !== 0) step.dir = dy > 0;
      step.last = now; step.hold = true; step.sum = 0; return;
    }
    step.hold = false;
    // ride = keep scrolling the same way (two quick wheel clicks or a short trackpad swipe);
    // rev = a single nudge, slow creeping, or rocking back and forth (a change of direction starts over).
    // The tally leaks away over time, so only a deliberate scroll fills it.
    if (dy === 0) return;
    if (step.dir !== (dy > 0)) { step.sum = 0; step.dir = dy > 0; }
    step.sum = Math.max(0, step.sum - (now - step.last) * 0.25);
    step.last = now; step.sum += Math.min(Math.abs(dy), 160);
    if (step.sum >= RIDE_AT) { step.sum = 0; rev(0); stepBy(dy > 0 ? 1 : -1); }
    else rev(dy / 180);
  }, { passive: false });
  var touch = null;
  window.addEventListener("touchstart", function (e) {
    if (!stepping() || e.touches.length !== 1) { touch = null; return; }
    var y = e.touches[0].clientY;
    var t = e.timeStamp || performance.now();
    touch = { x: e.touches[0].clientX, y: y, ly: y, t: t, pts: [{ y: y, t: t }], side: false, inRail: !!(e.target.closest && e.target.closest(".rail")) };
  }, { passive: true });
  window.addEventListener("touchmove", function (e) {
    if (!touch || !stepping()) return;
    var x = e.touches[0].clientX, y = e.touches[0].clientY, dx = x - touch.x, dy = y - touch.y;
    if (touch.inRail && (touch.side || Math.abs(dx) > Math.abs(dy))) { touch.side = true; return; } // sideways through the cards
    e.preventDefault();
    var now = e.timeStamp || performance.now();
    touch.pts.push({ y: y, t: now }); while (touch.pts.length > 2 && now - touch.pts[0].t > 120) touch.pts.shift();
    if (!step.busy && performance.now() >= step.until) rev((touch.ly - y) / 180); // slow drag revs the bike
    touch.ly = y;
  }, { passive: false });
  window.addEventListener("touchend", function () {
    if (!touch || !stepping() || touch.side) { touch = null; return; }
    var a = touch.pts[0], b = touch.pts[touch.pts.length - 1], v = (b.y - a.y) / Math.max(1, b.t - a.t), total = touch.ly - touch.y;
    if (Math.abs(total) > 40 && Math.abs(v) > 0.3) { rev(0); stepBy(total < 0 ? 1 : -1); } // a flick rides to the next section
    touch = null;
  });
  document.addEventListener("keydown", function (e) {
    if (!stepping() || e.altKey || e.ctrlKey || e.metaKey) return;
    var tag = (e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select" || e.target.isContentEditable) return;
    var down = e.key === "ArrowDown" || e.key === "PageDown" || (e.key === " " && !e.shiftKey);
    var up = e.key === "ArrowUp" || e.key === "PageUp" || (e.key === " " && e.shiftKey);
    if (down || up) { e.preventDefault(); stepBy(down ? 1 : -1); }
    else if (e.key === "Home") { e.preventDefault(); glide(0); }
    else if (e.key === "End") { e.preventDefault(); var s = stops(); glide(s[s.length - 1]); }
  });
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest('a[href^="#"]');
    if (!a || !stepping()) return;
    if (goTo(a.getAttribute("href").slice(1))) e.preventDefault();
  });

  /* ---------- project rail: swipe, drag, arrows, 3D tilt ---------- */
  var rail = document.getElementById("rail");
  function initRail() {
    if (!rail) return;
    var cards = Array.prototype.slice.call(rail.querySelectorAll(".pcard"));
    var stepW = function () { return cards[0] ? cards[0].getBoundingClientRect().width + 18 : 320; };
    var rbtns = document.querySelectorAll(".rbtn");
    rbtns.forEach(function (b) {
      b.addEventListener("click", function () { rail.scrollBy({ left: stepW() * Number(b.dataset.dir), behavior: REDUCED ? "auto" : "smooth" }); });
    });
    // arrows only when the cards don't all fit on screen
    var arrows = function () { var hide = cards.length < 2 || rail.scrollWidth <= rail.clientWidth + 4; rbtns.forEach(function (b) { b.hidden = hide; }); };
    arrows(); window.addEventListener("resize", arrows);
    var hint = document.getElementById("rail-hint");
    if (hint) hint.hidden = !rail.querySelector(".pcard__open");
    rail.addEventListener("keydown", function (e) {
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); rail.scrollBy({ left: stepW() * (e.key === "ArrowRight" ? 1 : -1), behavior: REDUCED ? "auto" : "smooth" }); }
    });
    var down = false, moved = false, startX = 0, startL = 0;
    rail.addEventListener("pointerdown", function (e) {
      if (e.pointerType !== "mouse" || e.button !== 0) return;
      down = true; moved = false; startX = e.clientX; startL = rail.scrollLeft;
    });
    window.addEventListener("pointermove", function (e) {
      if (!down) return;
      var dx = e.clientX - startX;
      if (!moved && Math.abs(dx) > 6) { moved = true; rail.classList.add("is-dragging"); }
      if (moved) rail.scrollLeft = startL - dx;
    });
    window.addEventListener("pointerup", function () {
      if (!down) return; down = false;
      if (moved) {
        rail.classList.remove("is-dragging");
        rail.scrollTo({ left: Math.round(rail.scrollLeft / stepW()) * stepW(), behavior: REDUCED ? "auto" : "smooth" });
      }
    });
    rail.addEventListener("click", function (e) { if (moved) { e.preventDefault(); e.stopPropagation(); moved = false; } }, true);
    var tilt = function () {
      if (REDUCED) return;
      var r = rail.getBoundingClientRect(), mid = r.left + r.width / 2;
      cards.forEach(function (c) {
        var b = c.getBoundingClientRect(), d = (b.left + b.width / 2 - mid) / r.width;
        c.style.setProperty("--ry", (d * -18).toFixed(2) + "deg");
        c.style.setProperty("--tz", (-Math.abs(d) * 60).toFixed(1) + "px");
      });
    };
    rail.addEventListener("scroll", function () { requestAnimationFrame(tilt); }, { passive: true });
    window.addEventListener("resize", tilt); tilt();
  }

  /* ---------- projects from content/projects.json (edited in Pages CMS) ---------- */
  var projects = [];
  function card(p, i) {
    var c = el("article", "pcard"), acc = ACCENTS[i % ACCENTS.length];
    c.id = p._id; c.style.setProperty("--a1", acc[0]); c.style.setProperty("--a2", acc[1]);
    var cover = safeUrl(p.cover);
    if (cover) {
      var fig = el("div", "pcard__cover"), img = el("img"); img.src = cover; img.alt = ""; img.loading = "lazy"; fig.appendChild(img); c.appendChild(fig);
    } else {
      var art = el("div", "pcard__art"); art.setAttribute("aria-hidden", "true"); art.innerHTML = ICON; c.appendChild(art);
    }
    c.appendChild(el("p", "pcard__n", String(i + 1).padStart(2, "0")));
    c.appendChild(el("h3", "pcard__t", p.title));
    if (p.summary) c.appendChild(el("p", "pcard__s", p.summary));
    if (Array.isArray(p.tags) && p.tags.length) {
      var ul = el("ul", "tags"); p.tags.filter(Boolean).forEach(function (t) { ul.appendChild(el("li", null, t)); }); c.appendChild(ul);
    }
    var open = el("a", "btn btn--primary pcard__open", "Open project"); open.href = "#" + p._id; open.dataset.index = String(i);
    c.appendChild(open);
    return c;
  }
  function linkBtn(label, url, primary, download) {
    var a = el("a", "btn " + (primary ? "btn--primary" : "btn--ghost"), label); a.href = url;
    if (/^https?:/i.test(url)) a.rel = "noopener";
    if (download) a.setAttribute("download", "");
    return a;
  }
  function fullView(p) {
    var frag = document.createDocumentFragment();
    var h = el("h2", "pfull__title", p.title); h.id = "pview-title"; frag.appendChild(h);
    if (p.summary) frag.appendChild(el("p", "pfull__tag", p.summary));
    var shots = (Array.isArray(p.screenshots) ? p.screenshots : []).map(safeUrl).filter(Boolean);
    if (shots.length) {
      var g = el("div", "gallery"); g.setAttribute("data-gallery", "");
      shots.forEach(function (src, k) {
        var f = el("figure", "shot"), img = el("img"); img.src = src; img.alt = p.title + " screenshot " + (k + 1); img.draggable = false; f.appendChild(img); g.appendChild(f);
      });
      frag.appendChild(g);
    }
    var grid = el("div", "pfull__grid");
    if (p.description) {
      var d = el("div", "d-block d-block--wide"); d.appendChild(el("h3", null, "About this project"));
      String(p.description).split(/\n\s*\n/).forEach(function (para) { if (para.trim()) d.appendChild(el("p", null, para.trim())); });
      grid.appendChild(d);
    }
    if (Array.isArray(p.tags) && p.tags.length) {
      var t = el("div", "d-block"); t.appendChild(el("h3", null, "Built with"));
      var ul = el("ul", "tags tags--lg"); p.tags.filter(Boolean).forEach(function (x) { ul.appendChild(el("li", null, x)); }); t.appendChild(ul);
      grid.appendChild(t);
    }
    if (grid.children.length) frag.appendChild(grid);
    var box = el("div", "pfull__links"); box.appendChild(el("h3", null, "Links & downloads"));
    var row = el("div", "links"), gh = safeUrl(p.github), web = safeUrl(p.website);
    (Array.isArray(p.downloads) ? p.downloads : []).forEach(function (dl) {
      var file = safeUrl(dl && dl.file), url = safeUrl(dl && dl.url), href = file || url;
      if (href) row.appendChild(linkBtn((dl.label || "Download"), href, true, !!file));
    });
    if (web) row.appendChild(linkBtn("Open live", web, !row.children.length));
    if (gh) row.appendChild(linkBtn("View on GitHub", gh, false));
    if (row.children.length) box.appendChild(row);
    else box.appendChild(el("p", "d-note", "Links and downloads for this project will be added here."));
    frag.appendChild(box);
    return frag;
  }
  function renderProjects(list) {
    projects = list.filter(function (p) { return p && p.title && p.published !== false; });
    projects.forEach(function (p, i) { p._id = slugify(p.title, i); });
    if (!projects.length || !rail) return;
    rail.innerHTML = "";
    projects.forEach(function (p, i) { rail.appendChild(card(p, i)); });
  }
  function renderSocials(list) {
    var ul = document.getElementById("socials"); if (!ul) return;
    list.forEach(function (s) {
      var url = safeUrl(s && s.url); if (!url || !s.label) return;
      var li = el("li"); li.appendChild(linkBtn(s.label, url, false)); ul.appendChild(li);
    });
  }

  /* ---------- full-screen project view ---------- */
  var body = document.getElementById("pview-body"), num = document.getElementById("pview-n");
  var opener = null, spinRaf = 0, shareBtn = document.getElementById("pview-share"), current = null;
  function buildGallery(rootEl) {
    var g = rootEl.querySelector("[data-gallery]"); if (!g) return;
    var shots = Array.prototype.slice.call(g.children); if (!shots.length) return;
    var ring = el("div", "gallery__ring");
    shots.forEach(function (s) { ring.appendChild(s); });
    g.appendChild(ring);
    // coverflow in 3D: each shot is placed by its distance from the current position, wrapping around
    var n = shots.length, cur = 0, vel = REDUCED || n < 2 ? 0 : 0.12, drag = null;
    function draw() {
      var w = shots[0].getBoundingClientRect().width || 360;
      shots.forEach(function (s, i) {
        var o = ((i - cur) % n + n) % n; if (o >= n / 2) o -= n;
        var a = Math.abs(o);
        s.style.transform = "translate(-50%,-50%) translateX(" + (o * w * 0.62).toFixed(1) + "px) translateZ(" + (-a * 160).toFixed(1) + "px) rotateY(" + (-o * 32).toFixed(2) + "deg)";
        s.style.opacity = String(Math.max(0, 1 - Math.max(0, a - 0.9) * 2.2));
        s.style.zIndex = String(10 - Math.round(a * 2));
      });
    }
    var last = performance.now();
    function spin(now) {
      var dt = Math.min(0.05, (now - last) / 1000); last = now;
      if (!drag) cur += vel * dt;
      draw(); spinRaf = requestAnimationFrame(spin);
    }
    if (n > 1) {
      g.addEventListener("pointerdown", function (e) { drag = { x: e.clientX, c: cur }; g.setPointerCapture(e.pointerId); });
      g.addEventListener("pointermove", function (e) { if (drag) cur = drag.c - (e.clientX - drag.x) / (shots[0].getBoundingClientRect().width || 360); });
      g.addEventListener("pointerup", function () { drag = null; });
    }
    draw(); if (vel) spinRaf = requestAnimationFrame(spin);
  }
  function openProject(i, trigger) {
    var p = projects[i];
    if (!p || !view || typeof view.showModal !== "function") return false;
    current = p;
    body.innerHTML = ""; body.appendChild(fullView(p));
    num.textContent = "Project " + String(i + 1).padStart(2, "0");
    opener = trigger || null;
    view.showModal(); view.scrollTop = 0;
    buildGallery(body);
    if (history.replaceState) history.replaceState(null, "", "#" + p._id);
    return true;
  }
  if (view) {
    view.addEventListener("close", function () {
      cancelAnimationFrame(spinRaf); body.innerHTML = "";
      if (history.replaceState) history.replaceState(null, "", "#projects");
      if (opener) opener.focus();
    });
    view.addEventListener("click", function (e) { if (e.target.closest("[data-close]")) view.close(); });
  }
  // copy link: phones get the share sheet, everything else copies the project's own link
  function copyText(t) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(t);
    return new Promise(function (ok, no) {
      var ta = el("textarea"); ta.value = t; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
      view.appendChild(ta); ta.select(); var done = false; try { done = document.execCommand("copy"); } catch (e) {} ta.remove(); done ? ok() : no();
    });
  }
  if (shareBtn) shareBtn.addEventListener("click", function () {
    if (!current) return;
    var url = location.origin + location.pathname + "#" + current._id, label = shareBtn.querySelector("span");
    var said = function (t) { label.textContent = t; shareBtn.classList.add("is-done"); setTimeout(function () { label.textContent = "Copy link"; shareBtn.classList.remove("is-done"); }, 2200); };
    if (navigator.share && window.matchMedia("(hover: none)").matches) { navigator.share({ title: current.title, url: url }).catch(function () {}); return; }
    copyText(url).then(function () { said("Link copied"); }, function () { said("Copy failed"); });
  });
  if (rail) rail.addEventListener("click", function (e) {
    var a = e.target.closest(".pcard__open"); if (!a) return;
    if (openProject(Number(a.dataset.index), a)) { e.preventDefault(); e.stopPropagation(); }
  });

  Promise.all([
    getJSON("content/projects.json").then(renderProjects).catch(function () {}),
    getJSON("content/socials.json").then(renderSocials).catch(function () {})
  ]).then(function () {
    initRail();
    if (!REDUCED) document.querySelectorAll(".sec .pin").forEach(prepFx);
    // deep link: #project-<name> opens that project
    var h = location.hash.slice(1);
    for (var i = 0; i < projects.length; i++) if (projects[i]._id === h) { document.getElementById("projects").scrollIntoView(); openProject(i); break; }
  });

  /* ---------- the glowing line down the side: fills as you go down, with a dot for each stop ---------- */
  var prog = document.querySelector(".progress");
  if (prog) {
    var ticks = [], queued = false;
    var placeTicks = function () {
      var s = stops(), max = s[s.length - 1] || 1;
      ticks.forEach(function (t) { t.remove(); });
      ticks = s.map(function (y) { var t = document.createElement("i"); t.className = "progress__tick"; t.style.top = (y / max * 100) + "%"; t._k = y / max; prog.appendChild(t); return t; });
      paint();
    };
    var paint = function () {
      queued = false;
      var max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight), k = Math.min(1, Math.max(0, window.scrollY / max));
      prog.style.setProperty("--k", k.toFixed(4));
      ticks.forEach(function (t) { t.classList.toggle("is-past", t._k <= k + 0.002); });
    };
    window.addEventListener("scroll", function () { if (!queued) { queued = true; requestAnimationFrame(paint); } }, { passive: true });
    window.addEventListener("resize", placeTicks);
    window.addEventListener("load", placeTicks);
    if ("ResizeObserver" in window) new ResizeObserver(function () { placeTicks(); }).observe(document.body); // the projects load in later
    placeTicks();
  }

  /* ---------- extras: the garage (paint, time of day, drag to spin), the day and night switch, and "vroom" ----------
     They need the 3D scene, so they only show up once main.js says the bike is ready. */
  function store(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }
  function recall(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function extras() {
    var bike = window.__bike;
    if (!bike || extras.done) return;
    extras.done = true;
    var openBtn = document.getElementById("garage-open"), panel = document.getElementById("garage"), closeBtn = document.getElementById("garage-close");
    var dayBtn = document.getElementById("daynight"), swatches = panel ? panel.querySelectorAll("[data-paint]") : [], times = panel ? panel.querySelectorAll("[data-time]") : [];
    function setPaint(name, save) {
      if (!bike.paint(name)) return;
      swatches.forEach(function (b) { b.setAttribute("aria-checked", String(b.dataset.paint === name)); });
      if (save) store("bike-paint", name === "stealth" ? null : name);
    }
    function setDay(on, save) {
      bike.day(on); root.classList.toggle("day", on);
      if (dayBtn) { dayBtn.setAttribute("aria-pressed", String(on)); dayBtn.setAttribute("aria-label", on ? "Night time" : "Daytime"); }
      times.forEach(function (b) { b.setAttribute("aria-checked", String((b.dataset.time === "day") === on)); });
      if (save) store("bike-day", on ? "1" : null);
    }
    var p0 = recall("bike-paint"); if (p0) setPaint(p0, false);
    if (recall("bike-day") === "1") setDay(true, false);
    swatches.forEach(function (b) { b.addEventListener("click", function () { setPaint(b.dataset.paint, true); }); });
    times.forEach(function (b) { b.addEventListener("click", function () { setDay(b.dataset.time === "day", true); }); });
    if (dayBtn) { dayBtn.hidden = false; dayBtn.addEventListener("click", function () { setDay(!root.classList.contains("day"), true); }); }

    function garage(on) {
      root.classList.toggle("in-garage", on); bike.garage(on);
      panel.hidden = !on; openBtn.setAttribute("aria-expanded", String(on));
      setTimeout(function () { (on ? closeBtn : openBtn).focus(); }, 450); // once the button has faded back in
    }
    if (openBtn && panel) {
      openBtn.hidden = false;
      openBtn.addEventListener("click", function () { garage(true); });
      closeBtn.addEventListener("click", function () { garage(false); });
      document.addEventListener("keydown", function (e) { if (e.key === "Escape" && root.classList.contains("in-garage")) garage(false); });
      // drag anywhere off the panel to spin the bike
      var drag = null;
      window.addEventListener("pointerdown", function (e) { if (root.classList.contains("in-garage") && !e.target.closest("#garage, .nav")) drag = { x: e.clientX, id: e.pointerId }; });
      window.addEventListener("pointermove", function (e) { if (!drag || e.pointerId !== drag.id) return; bike.spin(-(e.clientX - drag.x) * 0.009); drag.x = e.clientX; });
      window.addEventListener("pointerup", function () { drag = null; });
      window.addEventListener("pointercancel", function () { drag = null; });
    }

    // "vroom": type it on a keyboard, or tap the screen three times quickly on a phone, for a wheelie
    var typed = "", taps = [];
    document.addEventListener("keydown", function (e) {
      var tag = (e.target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || e.target.isContentEditable || e.key.length !== 1) return;
      typed = (typed + e.key.toLowerCase()).slice(-5);
      if (typed === "vroom") { typed = ""; bike.wheelie(); }
    });
    var tap0 = null;
    window.addEventListener("touchstart", function (e) { tap0 = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null; }, { passive: true });
    window.addEventListener("touchend", function (e) {
      var t = e.changedTouches[0];
      if (!tap0 || !t || Math.hypot(t.clientX - tap0.x, t.clientY - tap0.y) > 12 || (e.target.closest && e.target.closest("a, button, input, .rail, #garage, .pview"))) { taps = []; return; }
      var now = performance.now(); taps = taps.filter(function (x) { return now - x < 800; }); taps.push(now);
      if (taps.length >= 3) { taps = []; bike.wheelie(); }
    }, { passive: true });
  }
  if (window.__bike) extras(); else window.addEventListener("bike-ready", extras);
})();
