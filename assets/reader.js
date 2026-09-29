(function () {
  "use strict";
  var bar = document.querySelector(".reading-progress > div");
  var rail = document.querySelector(".outline-rail");
  var links = Array.prototype.slice.call(document.querySelectorAll(".outline-rail .section-outline a[data-target]"));
  var heads = links
    .map(function (a) { return document.getElementById(a.getAttribute("data-target")); });
  var hdr = document.querySelector(".term-bar, header");
  function headerH() { return hdr ? hdr.getBoundingClientRect().height : 56; }
  var current = -2;
  var lockUntil = 0;          // while a click-initiated smooth scroll is running
  var hovering = false;
  var railTimer = 0;
  var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  function updateBar() {
    var d = document.documentElement, m = d.scrollHeight - window.innerHeight;
    if (bar) bar.style.width = (m > 0 ? Math.min(100, (window.scrollY / m) * 100) : 0) + "%";
  }
  function mark(i) {
    if (i === current) return;
    current = i;
    links.forEach(function (a, k) {
      if (k === i) a.setAttribute("aria-current", "location");
      else a.removeAttribute("aria-current");
    });
    scheduleRail();
  }
  // keep the active item visible inside the outline rail (paused while the pointer is over it)
  function scheduleRail() {
    clearTimeout(railTimer);
    railTimer = setTimeout(followInRail, 120);
  }
  function followInRail() {
    if (!rail || hovering || (rail.contains(document.activeElement) && document.activeElement.matches && document.activeElement.matches(":focus-visible")) || current < 0) return;
    var a = links[current];
    if (!a || rail.scrollHeight <= rail.clientHeight + 2) return;
    var ar = a.getBoundingClientRect(), rr = rail.getBoundingClientRect(), pad = 24;
    var topLimit = rr.top + 56, bottomLimit = rr.bottom - pad;
    var delta = 0;
    if (ar.top < topLimit) delta = ar.top - topLimit;
    else if (ar.bottom > bottomLimit) delta = ar.bottom - bottomLimit;
    if (delta) rail.scrollTo({ top: rail.scrollTop + delta, behavior: reduce ? "auto" : "smooth" });
  }
  function spy() {
    updateBar();
    if (Date.now() < lockUntil) return;
    var line = headerH() + 24;
    var cur = -1;
    for (var i = 0; i < heads.length; i++) {
      if (heads[i] && heads[i].getBoundingClientRect().top <= line) cur = i; else if (heads[i]) break;
    }
    var d = document.documentElement;
    if (d.scrollHeight - window.innerHeight > 0 && window.scrollY >= d.scrollHeight - window.innerHeight - 4) cur = heads.length - 1;
    mark(cur);
    clearTimeout(hashTimer);
    hashTimer = setTimeout(syncHash, 200);
  }
  var hashTimer = 0;
  function syncHash() {
    if (lockUntil) return;
    var id = current >= 0 && links[current] ? links[current].getAttribute("data-target") : "";
    var want = id ? "#" + id : "";
    if (location.hash === want || (!want && !location.hash)) return;
    try { history.replaceState(null, "", location.pathname + location.search + want); } catch (e) {}
  }
  // <base href> makes plain "#id" links leave the page, so we scroll ourselves.
  function goTo(id, push) {
    var el = document.getElementById(id);
    if (!el) return;
    var i = links.findIndex(function (a) { return a.getAttribute("data-target") === id; });
    var y = el.getBoundingClientRect().top + window.scrollY - headerH() - 12;
    var maxY = document.documentElement.scrollHeight - window.innerHeight;
    y = Math.max(0, Math.min(y, maxY));
    // lock the spy until the scroll has really stopped (works for any distance)
    lockUntil = Infinity;
    mark(i);
    var last = window.scrollY, still = 0;
    var t = setInterval(function () {
      var now = window.scrollY;
      if (Math.abs(now - last) < 1) still++; else still = 0;
      last = now;
      if (still >= 3 || Math.abs(now - y) < 2) { clearInterval(t); lockUntil = 0; spy(); }
    }, 60);
    setTimeout(function () { clearInterval(t); lockUntil = 0; }, 4000);
    window.scrollTo({ top: y, behavior: reduce ? "auto" : "smooth" });
    try { history[push ? "pushState" : "replaceState"](null, "", location.pathname + location.search + "#" + id); } catch (e) {}
  }
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("a[data-target]");
    if (!a) return;
    e.preventDefault();
    if (a.blur) a.blur();
    goTo(a.getAttribute("data-target"), false);
    var d = a.closest("details");
    if (d) d.open = false;
  });
  if (rail) {
    rail.addEventListener("mouseenter", function () { hovering = true; });
    rail.addEventListener("mouseleave", function () { hovering = false; scheduleRail(); });
  }
  // wheel/touch/keys cancel a running click-scroll lock so the user is never fought
  ["wheel", "touchstart", "keydown"].forEach(function (ev) {
    window.addEventListener(ev, function () { if (lockUntil) { lockUntil = 0; } }, { passive: true });
  });
  // left rail: bring the active chapter into view once
  var act = document.querySelector(".chapter-navigation a.active, .chapter-navigation a[aria-current]");
  if (act) { var lr = act.closest(".chapter-rail"); if (lr && lr.scrollHeight > lr.clientHeight) lr.scrollTop = Math.max(0, act.offsetTop - lr.clientHeight / 3); }

  if (location.hash.length > 1) {
    setTimeout(function () { goTo(decodeURIComponent(location.hash.slice(1)), false); }, 60);
  }
  window.addEventListener("scroll", spy, { passive: true });
  window.addEventListener("resize", function () { spy(); scheduleRail(); });
  spy();
  var top = document.querySelector(".back-to-top");
  if (top) top.addEventListener("click", function (e) { e.preventDefault(); window.scrollTo({ top: 0, behavior: "smooth" }); });
  setInterval(function () { if (window.__applyTheme) window.__applyTheme(); }, 300000);
})();
