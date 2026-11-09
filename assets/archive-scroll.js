import { archiveCameraFrame, cabinEntry, moonLightPath } from "./archive-camera.mjs?v=49";

/** Native scrolling drives the camera; content never waits for animation. */
(function () {
  const world = document.getElementById("archive-world");
  if (!world) return;
  const camera = world.querySelector(".archive-camera");
  const desk = document.getElementById("archive-desk");
  const stage = world.querySelector(".archive-stage");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");
  let frame = 0, deskTop = 1;
  const moon = document.getElementById("moon-light");
  let moonTimer = 0;
  let inside = false;
  function refreshMoon() {
    clearInterval(moonTimer);
    moonTimer = 0;
    if (document.hidden || inside) return;
    const update = () => moon.setAttribute("d", moonLightPath(Date.now()));
    update();
    if (!reduce.matches) moonTimer = setInterval(update, 2000);
  }
  function measure() {
    deskTop = desk.getBoundingClientRect().top + window.scrollY;
    schedule();
  }
  function paint() {
    frame = 0;
    const { transform, progress } = archiveCameraFrame(window.scrollY, deskTop, window.innerHeight, reduce.matches);
    const entry = cabinEntry(window.scrollY, deskTop, window.innerHeight, reduce.matches);
    stage.style.setProperty("--entry", entry);
    if (inside !== (entry === 1)) {
      inside = entry === 1;
      stage.classList.toggle("in-cabin", inside);
      refreshMoon();
    }
    camera.setAttribute("transform", transform);
    stage.style.setProperty("--approach", progress);
  }
  function schedule() { if (!frame) frame = requestAnimationFrame(paint); }
  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", measure);
  reduce.addEventListener("change", () => { refreshMoon(); schedule(); });
  document.addEventListener("visibilitychange", refreshMoon);
  window.addEventListener("pagehide", () => clearInterval(moonTimer));
  window.addEventListener("pageshow", () => { refreshMoon(); measure(); });
  if (document.fonts) document.fonts.ready.then(measure);
  refreshMoon();
  measure();
})();
