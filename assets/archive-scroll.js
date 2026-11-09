/** Native scrolling drives the scenery. No wheel interception or scroll locking. */
(function () {
  const world = document.getElementById("archive-world");
  if (!world) return;
  const scene = world.querySelector(".archive-city");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");
  let frame = 0;
  function paint() {
    frame = 0;
    const progress = Math.max(0, Math.min(1, window.scrollY / Math.max(1, window.innerHeight)));
    if (reduce.matches) { scene.style.transform = "none"; return; }
    scene.style.transform = `translate3d(${-progress * 4}%, ${-progress * 8}%, 0) scale(${1 + progress * .2})`;
  }
  function schedule() { if (!frame) frame = requestAnimationFrame(paint); }
  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule);
  reduce.addEventListener("change", schedule);
  paint();
})();
