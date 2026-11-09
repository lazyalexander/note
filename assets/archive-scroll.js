import { archiveCameraFrame } from "./archive-camera.mjs";

/** Native scrolling drives the camera; content never waits for animation. */
(function () {
  const world = document.getElementById("archive-world");
  if (!world) return;
  const camera = world.querySelector(".archive-camera");
  const desk = document.getElementById("archive-desk");
  const captions = world.querySelectorAll(".journey-caption span");
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
    const phase = Math.min(2, Math.floor(progress * 3));
    captions.forEach((caption, i) => caption.classList.toggle("current", i === phase));
  }
  function schedule() { if (!frame) frame = requestAnimationFrame(paint); }
  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", measure);
  window.addEventListener("pageshow", measure);
  reduce.addEventListener("change", schedule);
  if (document.fonts) document.fonts.ready.then(measure);
  measure();
})();
