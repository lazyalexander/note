(function () {
  "use strict";
  var bar = document.querySelector(".reading-progress > div");
  var links = Array.prototype.slice.call(document.querySelectorAll(".outline-rail .section-outline a"));
  var heads = links
    .map(function (a) { return document.getElementById(a.getAttribute("data-target")); })
    .filter(Boolean);
  function onScroll() {
    var doc = document.documentElement;
    var max = doc.scrollHeight - window.innerHeight;
    if (bar) bar.style.width = (max > 0 ? Math.min(100, (window.scrollY / max) * 100) : 0) + "%";
    var cur = -1;
    for (var i = 0; i < heads.length; i++) {
      if (heads[i].getBoundingClientRect().top <= 140) cur = i;
    }
    if (max > 0 && window.scrollY >= max - 4) cur = heads.length - 1;
    links.forEach(function (a, i) {
      if (i === cur) {
        a.setAttribute("aria-current", "location");
        var box = a.parentElement && a.parentElement.parentElement;
        if (box && box.scrollHeight > box.clientHeight) {
          var ar = a.getBoundingClientRect(), br = box.getBoundingClientRect();
          if (ar.top < br.top + 40 || ar.bottom > br.bottom - 40) box.scrollTop += ar.top - br.top - 80;
        }
      } else a.removeAttribute("aria-current");
    });
  }
  // <base href> makes plain "#id" links navigate to the site root, so scroll ourselves.
  function goTo(id, push) {
    var el = document.getElementById(id);
    if (!el) return;
    var y = el.getBoundingClientRect().top + window.scrollY - 72;
    window.scrollTo({ top: Math.max(0, y), behavior: "smooth" });
    try {
      history[push ? "pushState" : "replaceState"](null, "", location.pathname + location.search + "#" + id);
    } catch (e) {}
  }
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("a[data-target]");
    if (!a) return;
    e.preventDefault();
    goTo(a.getAttribute("data-target"), false);
    var d = a.closest("details");
    if (d) d.open = false;
  });
  if (location.hash.length > 1) {
    setTimeout(function () { goTo(decodeURIComponent(location.hash.slice(1)), false); }, 60);
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);
  onScroll();
  var top = document.querySelector(".back-to-top");
  if (top) top.addEventListener("click", function (e) { e.preventDefault(); window.scrollTo({ top: 0, behavior: "smooth" }); });
  // auto theme: re-check every 5 min
  setInterval(function () { if (window.__applyTheme) window.__applyTheme(); }, 300000);
})();
