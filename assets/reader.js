(function () {
  "use strict";
  var bar = document.querySelector(".reading-progress > div");
  var rail = document.querySelector(".outline-rail");
  var links = Array.prototype.slice.call(document.querySelectorAll(".outline-rail .section-outline a[data-target]"));
  var heads = links.map(function (a) { return document.getElementById(a.getAttribute("data-target")); });
  var hdr = document.querySelector(".term-bar");
  var main = document.querySelector(".reading-main");
  var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  var GAP = 12;               // where a clicked heading rests, below the top bar
  var current = -2;           // index currently marked
  var clicking = false;       // a click-initiated scroll is in flight: only the clicked item may be active
  var hovering = false, railTimer = 0, hashTimer = 0, settleTimer = 0;

  function headerH() { return hdr ? hdr.getBoundingClientRect().height : 56; }
  function maxScroll() { return document.documentElement.scrollHeight - window.innerHeight; }

  // Short pages cannot scroll far enough to bring the last headings to the top, so the
  // highlight would fall on a neighbour. Add just enough blank space at the end so that
  // every heading can be scrolled to the same resting position.
  var spacer = document.createElement("div");
  spacer.className = "reader-spacer";
  spacer.setAttribute("aria-hidden", "true");
  if (main) main.appendChild(spacer);
  function contentBottom() {
    // the grid stretches to a min-height, so measure the article column itself
    return main ? main.getBoundingClientRect().bottom + window.scrollY : document.documentElement.scrollHeight;
  }
  function fitSpacer() {
    var last = heads.filter(Boolean).pop();
    if (!last) return;
    spacer.style.height = "0px";
    var y = last.getBoundingClientRect().top + window.scrollY - headerH() - GAP;
    var need = Math.ceil(y + window.innerHeight - contentBottom());
    spacer.style.height = Math.max(0, need) + "px";
  }
  function targetY(el) {
    var y = el.getBoundingClientRect().top + window.scrollY - headerH() - GAP;
    return Math.max(0, Math.min(y, maxScroll()));
  }

  function updateBar() {
    var m = maxScroll();
    if (bar) bar.style.width = (m > 0 ? Math.min(100, (window.scrollY / m) * 100) : 0) + "%";
  }
  function mark(i) {
    if (i === current) return;
    current = i;
    links.forEach(function (a, k) {
      if (k === i) a.setAttribute("aria-current", "location"); else a.removeAttribute("aria-current");
    });
    scheduleRail();
  }
  function scheduleRail() { clearTimeout(railTimer); railTimer = setTimeout(followInRail, 120); }
  function followInRail() {
    if (!rail || hovering || current < 0) return;
    var f = document.activeElement;
    if (f && rail.contains(f) && f.matches && f.matches(":focus-visible")) return;
    var a = links[current];
    if (!a || rail.scrollHeight <= rail.clientHeight + 2) return;
    var ar = a.getBoundingClientRect(), rr = rail.getBoundingClientRect();
    var topLimit = rr.top + 56, bottomLimit = rr.bottom - 24, delta = 0;
    if (ar.top < topLimit) delta = ar.top - topLimit;
    else if (ar.bottom > bottomLimit) delta = ar.bottom - bottomLimit;
    if (delta) rail.scrollTo({ top: rail.scrollTop + delta, behavior: reduce ? "auto" : "smooth" });
  }

  // Scroll-spy for real scrolling: the last heading that has passed the reading line.
  function spy() {
    updateBar();
    if (clicking) return;
    var line = headerH() + GAP + 12, cur = -1;
    for (var i = 0; i < heads.length; i++) {
      if (!heads[i]) continue;
      if (heads[i].getBoundingClientRect().top <= line) cur = i; else break;
    }
    mark(cur);
    clearTimeout(hashTimer);
    hashTimer = setTimeout(syncHash, 200);
  }
  function syncHash() {
    if (clicking) return;
    var id = current >= 0 && links[current] ? links[current].getAttribute("data-target") : "";
    var want = id ? "#" + id : "";
    if (location.hash === want || (!want && !location.hash)) return;
    try { history.replaceState(null, "", location.pathname + location.search + want); } catch (e) {}
  }

  // Click: the clicked item wins. It is marked immediately and stays marked while the
  // page scrolls to it and after it lands. Only a real user scroll (wheel, touch, keys,
  // scrollbar drag) hands control back to the spy.
  var lastY = 0, aimY = 0, ownScroll = false;
  function endClick() { clicking = false; clearTimeout(settleTimer); }
  function goTo(id, push) {
    var el = document.getElementById(id);
    if (!el) return;
    var i = links.findIndex(function (a) { return a.getAttribute("data-target") === id; });
    fitSpacer();
    aimY = targetY(el);
    clicking = true;
    ownScroll = true;
    mark(i);
    try { history[push ? "pushState" : "replaceState"](null, "", location.pathname + location.search + "#" + id); } catch (e) {}
    window.scrollTo({ top: aimY, behavior: reduce ? "auto" : "smooth" });
    // consider the scroll finished when it reaches the target or stops moving
    var still = 0, prev = window.scrollY;
    clearTimeout(settleTimer);
    (function poll() {
      settleTimer = setTimeout(function () {
        var now = window.scrollY;
        still = Math.abs(now - prev) < 1 ? still + 1 : 0;
        prev = now;
        if (Math.abs(now - aimY) < 2 || still >= 4) { ownScroll = false; updateBar(); return; }
        poll();
      }, 60);
    })();
    setTimeout(function () { ownScroll = false; }, 5000);
  }
  // user-driven scrolling ends the click lock (wheel over the outline rail scrolls only the rail)
  function userScroll(e) {
    if (!clicking) return;
    if (e && e.type === "wheel" && rail && rail.contains(e.target)) return;
    ownScroll = false; endClick();
  }
  ["wheel", "touchmove", "keydown", "mousedown"].forEach(function (ev) {
    window.addEventListener(ev, function (e) {
      if (ev === "mousedown" && e.target.closest && e.target.closest("a[data-target]")) return;
      userScroll(e);
    }, { passive: true });
  });

  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("a[data-target]");
    if (!a) return;
    e.preventDefault();
    if (a.blur) a.blur();
    var d = a.closest("details"); if (d) d.open = false;
    goTo(a.getAttribute("data-target"), false);
  });
  if (rail) {
    rail.addEventListener("mouseenter", function () { hovering = true; });
    rail.addEventListener("mouseleave", function () { hovering = false; scheduleRail(); });
  }
  var act = document.querySelector(".chapter-navigation a.active");
  if (act) { var lr = act.closest(".chapter-rail"); if (lr && lr.scrollHeight > lr.clientHeight) lr.scrollTop = Math.max(0, act.offsetTop - lr.clientHeight / 3); }

  window.addEventListener("scroll", spy, { passive: true });
  window.addEventListener("resize", function () { fitSpacer(); spy(); scheduleRail(); });
  window.addEventListener("load", function () { fitSpacer(); if (!clicking) spy(); });
  if (window.ResizeObserver && main) new ResizeObserver(function () { if (!clicking) { fitSpacer(); } }).observe(main.querySelector(".prose") || main);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { fitSpacer(); if (!clicking) spy(); });
  fitSpacer();
  if (location.hash.length > 1) {
    setTimeout(function () { goTo(decodeURIComponent(location.hash.slice(1)), false); }, 60);
  } else spy();
  var top = document.querySelector(".back-to-top");
  if (top) top.addEventListener("click", function (e) { e.preventDefault(); userScroll(); window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" }); });
  setInterval(function () { if (window.__applyTheme) window.__applyTheme(); }, 300000);
})();
