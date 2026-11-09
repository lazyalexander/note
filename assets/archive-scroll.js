import { archiveCameraFrame } from "./archive-camera.mjs?v=48";

/** Native scrolling drives the camera; content never waits for animation. */
(function () {
  const world = document.getElementById("archive-world");
  if (!world) return;
  const camera = world.querySelector(".archive-camera");
  const desk = document.getElementById("archive-desk");
  const stage = world.querySelector(".archive-stage");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");
  let frame = 0, deskTop = 1;
  function measure() {
    deskTop = desk.getBoundingClientRect().top + window.scrollY;
    schedule();
  }
  function paint() {
    frame = 0;
    const { transform, progress } = archiveCameraFrame(window.scrollY, deskTop, window.innerHeight, reduce.matches);
    camera.setAttribute("transform", transform);
    stage.style.setProperty("--approach", progress);
  }
  function schedule() { if (!frame) frame = requestAnimationFrame(paint); }
  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", measure);
  window.addEventListener("pageshow", measure);
  reduce.addEventListener("change", schedule);
  if (document.fonts) document.fonts.ready.then(measure);
  measure();
})();
