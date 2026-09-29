(function () {
  "use strict";
  var bar = document.querySelector(".reading-progress > div");
  var links = Array.prototype.slice.call(document.querySelectorAll(".outline-rail .section-outline a"));
  var heads = links
    .map(function (a) { return document.getElementById(a.getAttribute("href").slice(1)); })
    .filter(Boolean);
  function onScroll() {
    var doc = document.documentElement;
    var max = doc.scrollHeight - window.innerHeight;
    if (bar) bar.style.width = (max > 0 ? Math.min(100, (window.scrollY / max) * 100) : 0) + "%";
    var cur = -1;
    for (var i = 0; i < heads.length; i++) {
      if (heads[i].getBoundingClientRect().top <= 140) cur = i;
    }
    links.forEach(function (a, i) {
      if (i === cur) a.setAttribute("aria-current", "location");
      else a.removeAttribute("aria-current");
    });
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);
  onScroll();
  var top = document.querySelector(".back-to-top");
  if (top) top.addEventListener("click", function (e) { e.preventDefault(); window.scrollTo({ top: 0, behavior: "smooth" }); });
  // auto theme: re-check every 5 min
  setInterval(function () { if (window.__applyTheme) window.__applyTheme(); }, 300000);
})();
