// Page UI that works with or without the 3D ride: menu, section spy, section-by-section scrolling,
// project cards (loaded from content/projects.json) and the full-screen project view.
(function () {
  "use strict";
  var REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var root = document.documentElement;
  var view = document.getElementById("project-view");

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

  /* ---------- mobile menu ---------- */
  var nav = document.querySelector(".nav"), toggle = document.querySelector(".nav__toggle");
  function setMenu(open) {
    nav.classList.toggle("is-open", open);
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
  }
  if (nav && toggle) {
    toggle.addEventListener("click", function () { setMenu(!nav.classList.contains("is-open")); });
    nav.querySelectorAll(".nav__links a").forEach(function (a) { a.addEventListener("click", function () { setMenu(false); }); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && nav.classList.contains("is-open")) { setMenu(false); toggle.focus(); } });
  }

  /* ---------- active section in the nav ---------- */
  var SECTIONS = ["hero", "about", "projects", "skills", "contact"];
  var links = document.querySelectorAll(".nav__links a[data-section]");
  if ("IntersectionObserver" in window) {
    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        links.forEach(function (a) { a.classList.toggle("is-active", a.dataset.section === en.target.id); });
      });
    }, { rootMargin: "-45% 0px -50% 0px" });
    SECTIONS.forEach(function (id) { var s = document.getElementById(id); if (s) spy.observe(s); });
  }

  /* ---------- section-by-section scrolling ----------
     With the 3D ride running, a hard scroll (or a flick, or an arrow key) glides the page to the next
     section while the bike plays one full stunt and lands. A gentle scroll or slow drag keeps the page
     still and revs the parked bike instead. Without 3D, or with reduced motion, the page scrolls normally. */
  var STOP_IDS = ["hero", "about", "projects", "skills"];
  var step = { busy: false, until: 0, sum: 0, dir: true, last: 0, hold: false }, RIDE_AT = 140;
  function rev(amount) { if (typeof window.__rideRev === "function") window.__rideRev(amount); }
  function stepping() { return root.classList.contains("has-gl") && !REDUCED && !(view && view.open); }
  function stops() {
    var y0 = window.scrollY, list = STOP_IDS.map(function (id) {
      var s = document.getElementById(id); return s ? Math.round(s.getBoundingClientRect().top + y0) : 0;
    });
    list.push(Math.max(0, document.documentElement.scrollHeight - window.innerHeight));
    return list;
  }
  function glide(target) {
    var from = window.scrollY, dist = target - from;
    if (Math.abs(dist) < 2) return;
    // one section per glide, slow enough to watch the whole stunt; sine easing keeps the middle from rushing
    var dur = Math.min(4600, 3400 + Math.max(0, Math.abs(dist) / window.innerHeight - 1.6) * 500), t0 = performance.now();
    step.busy = true;
    (function tick(now) {
      var k = Math.min(1, (now - t0) / dur), e = (1 - Math.cos(Math.PI * k)) / 2;
      window.scrollTo({ top: from + dist * e, behavior: "instant" });
      if (k < 1) requestAnimationFrame(tick);
      else { step.busy = false; step.until = performance.now() + 450; }
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
    glide(s[i]); return true;
  }
  window.addEventListener("wheel", function (e) {
    if (!stepping() || e.ctrlKey) return;
    if (e.target.closest && e.target.closest(".rail") && Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    e.preventDefault();
    var now = e.timeStamp || performance.now(), dy = e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? window.innerHeight : 1);
    // ignore the rest of the gesture that started a ride (trackpad momentum), until the wheel goes quiet
    if (step.busy || now < step.until || (step.hold && now - step.last < 220)) { step.last = now; step.hold = true; step.sum = 0; return; }
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
    document.querySelectorAll(".rbtn").forEach(function (b) {
      b.hidden = cards.length < 2;
      b.addEventListener("click", function () { rail.scrollBy({ left: stepW() * Number(b.dataset.dir), behavior: REDUCED ? "auto" : "smooth" }); });
    });
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
  var opener = null, spinRaf = 0;
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
  if (rail) rail.addEventListener("click", function (e) {
    var a = e.target.closest(".pcard__open"); if (!a) return;
    if (openProject(Number(a.dataset.index), a)) { e.preventDefault(); e.stopPropagation(); }
  });

  Promise.all([
    getJSON("content/projects.json").then(renderProjects).catch(function () {}),
    getJSON("content/socials.json").then(renderSocials).catch(function () {})
  ]).then(function () {
    initRail();
    // deep link: #project-<name> opens that project
    var h = location.hash.slice(1);
    for (var i = 0; i < projects.length; i++) if (projects[i]._id === h) { document.getElementById("projects").scrollIntoView(); openProject(i); break; }
  });
})();
