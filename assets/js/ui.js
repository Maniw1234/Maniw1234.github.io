// Page UI that works with or without the 3D ride: menu, section spy, project cards and the project view.
(function () {
  "use strict";
  var REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var year = document.getElementById("year");
  if (year) year.textContent = String(new Date().getFullYear());

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
  var links = document.querySelectorAll(".nav__links a[data-section]");
  if ("IntersectionObserver" in window) {
    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        links.forEach(function (a) { a.classList.toggle("is-active", a.dataset.section === en.target.id); });
      });
    }, { rootMargin: "-45% 0px -50% 0px" });
    ["hero", "about", "projects", "skills", "contact"].forEach(function (id) { var el = document.getElementById(id); if (el) spy.observe(el); });
  }

  /* ---------- project rail: swipe, drag, arrows, 3D tilt ---------- */
  var rail = document.getElementById("rail");
  if (rail) {
    var cards = Array.prototype.slice.call(rail.querySelectorAll(".pcard"));
    var step = function () { return cards[0] ? cards[0].getBoundingClientRect().width + 18 : 320; };
    document.querySelectorAll(".rbtn").forEach(function (b) {
      b.addEventListener("click", function () { rail.scrollBy({ left: step() * Number(b.dataset.dir), behavior: REDUCED ? "auto" : "smooth" }); });
    });
    rail.addEventListener("keydown", function (e) {
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); rail.scrollBy({ left: step() * (e.key === "ArrowRight" ? 1 : -1), behavior: REDUCED ? "auto" : "smooth" }); }
    });
    // mouse drag (touch already scrolls natively)
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
        var i = Math.round(rail.scrollLeft / step()); rail.scrollTo({ left: i * step(), behavior: REDUCED ? "auto" : "smooth" });
      }
    });
    rail.addEventListener("click", function (e) { if (moved) { e.preventDefault(); e.stopPropagation(); moved = false; } }, true);
    // cards turn slightly toward the centre of the rail
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

  /* ---------- full-screen project view ---------- */
  var view = document.getElementById("project-view"), body = document.getElementById("pview-body"), num = document.getElementById("pview-n");
  var opener = null, spinRaf = 0;
  function buildGallery(root) {
    var g = root.querySelector("[data-gallery]"); if (!g) return;
    var shots = Array.prototype.slice.call(g.children); if (!shots.length) return;
    var ring = document.createElement("div"); ring.className = "gallery__ring";
    shots.forEach(function (s) { ring.appendChild(s); });
    g.appendChild(ring);
    // coverflow in 3D: each shot is placed by its distance from the current position, wrapping around
    var n = shots.length, cur = 0, vel = REDUCED ? 0 : 0.12, drag = null;
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
    g.addEventListener("pointerdown", function (e) { drag = { x: e.clientX, c: cur }; g.setPointerCapture(e.pointerId); });
    g.addEventListener("pointermove", function (e) { if (drag) cur = drag.c - (e.clientX - drag.x) / (shots[0].getBoundingClientRect().width || 360); });
    g.addEventListener("pointerup", function () { drag = null; });
    draw(); if (!REDUCED) spinRaf = requestAnimationFrame(spin);
  }
  function openProject(card, trigger) {
    if (!view || typeof view.showModal !== "function") return false;
    var full = card.querySelector(".pcard__full"); if (!full) return false;
    body.innerHTML = full.innerHTML;
    var t = body.querySelector(".pfull__title"); if (t) t.id = "pview-title";
    num.textContent = "Project " + (card.querySelector(".pcard__n") || { textContent: "" }).textContent;
    opener = trigger || null;
    view.showModal(); view.scrollTop = 0;
    buildGallery(body);
    if (history.replaceState) history.replaceState(null, "", "#" + full.id);
    return true;
  }
  function closeProject() { if (view && view.open) view.close(); }
  if (view) {
    view.addEventListener("close", function () {
      cancelAnimationFrame(spinRaf); body.innerHTML = "";
      if (history.replaceState) history.replaceState(null, "", "#projects");
      if (opener) opener.focus();
    });
    view.addEventListener("click", function (e) { if (e.target.closest("[data-close]")) closeProject(); });
  }
  document.querySelectorAll(".pcard__open").forEach(function (a) {
    a.addEventListener("click", function (e) { if (openProject(a.closest(".pcard"), a)) e.preventDefault(); });
  });
  // deep link: #<project>-details opens that project
  var h = location.hash.slice(1);
  if (h) { var target = document.getElementById(h); if (target && target.classList.contains("pcard__full")) { document.getElementById("projects").scrollIntoView(); openProject(target.closest(".pcard")); } }
})();
