import { archiveCameraFrame, moonLightPath, windowAperture } from "./archive-camera.mjs?v=50";

(function () {
  const world = document.getElementById("archive-world");
  if (!world) return;
  const camera = world.querySelector(".archive-camera");
  const plate = world.querySelector(".ship-plate");
  const desk = document.getElementById("archive-desk");
  const stage = world.querySelector(".archive-stage");
  const moon = document.getElementById("moon-light");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");
  let frame = 0, deskTop = 1, plateRect, viewport;
  let moonTimer = 0;
  let inside = false;
  let boarding;

  function refreshMoon() {
    clearInterval(moonTimer);
    if (document.hidden || inside) return;
    const update = () => moon.setAttribute("d", moonLightPath(Date.now()));
    update();
    if (!reduce.matches) moonTimer = setInterval(update, 2000);
  }
  function measure() {
    deskTop = desk.getBoundingClientRect().top + window.scrollY;
    plateRect = plate.getBoundingClientRect();
    viewport = stage.getBoundingClientRect();
    schedule();
  }
  function paint() {
    frame = 0;
    const view = archiveCameraFrame(window.scrollY, deskTop, viewport.height, reduce.matches);
    const crossing = view.entry > 0 && view.entry < 1;
    stage.classList.toggle("at-window", crossing);
    if (crossing) {
      const aperture = windowAperture(view, plateRect, viewport);
      for (const [name, value] of Object.entries(aperture)) {
        stage.style.setProperty("--gate-" + name, value.toFixed(2) + "px");
      }
    }
    if (inside !== (view.entry === 1)) {
      inside = view.entry === 1;
      stage.classList.toggle("in-cabin", inside);
      refreshMoon();
    }
    camera.setAttribute("transform", view.transform);
    stage.style.setProperty("--entry", view.entry);
    stage.style.setProperty("--approach", view.progress);
  }
  function schedule() { if (!frame) frame = requestAnimationFrame(paint); }

  // Keep same-document links on this page even when <base> and a preview query are present.
  for (const link of world.querySelectorAll('a[href^="#"]')) {
    link.href = window.location.pathname + window.location.search + link.hash;
  }

  function cancelBoarding() { boarding?.abort(); }
  world.querySelector(".archive-cue").addEventListener("click", (event) => {
    if (event.defaultPrevented || event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || reduce.matches) return;
    const link = event.currentTarget;
    event.preventDefault();
    cancelBoarding();
    const controller = new AbortController();
    boarding = controller;
    // Direct manipulation always wins. Ordinary scrolling never starts a timed animation.
    for (const name of ["wheel", "touchstart", "pointerdown", "keydown", "popstate", "pagehide", "resize"]) {
      window.addEventListener(name, cancelBoarding, { passive: true, signal: controller.signal });
    }
    const from = window.scrollY;
    const margin = parseFloat(getComputedStyle(desk).scrollMarginTop) || 0;
    const to = Math.min(deskTop - margin, document.documentElement.scrollHeight - viewport.height);
    const duration = Math.min(2300, Math.max(420, Math.abs(to - from) / viewport.height * 960));
    const started = performance.now();
    function advance(now) {
      if (controller.signal.aborted) return;
      const t = Math.max(0, Math.min(1, (now - started) / duration));
      window.scrollTo({ top: from + (to - from) * t * t * (3 - 2 * t), behavior: "instant" });
      if (t < 1) { requestAnimationFrame(advance); return; }
      cancelBoarding();
      if (window.location.hash !== link.hash) history.pushState(null, "", link.href);
      desk.focus({ preventScroll: true });
    }
    requestAnimationFrame(advance);
  });
  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", measure);
  reduce.addEventListener("change", () => { cancelBoarding(); refreshMoon(); schedule(); });
  document.addEventListener("visibilitychange", () => { if (document.hidden) cancelBoarding(); refreshMoon(); });
  window.addEventListener("pagehide", () => clearInterval(moonTimer));
  window.addEventListener("pageshow", () => { refreshMoon(); measure(); });
  if (document.fonts) document.fonts.ready.then(measure);
  refreshMoon();
  measure();
})();
