import { archiveCameraFrame, cabinThreshold, moonLightPath, windowAperture } from "./archive-camera.mjs?v=54";

(function () {
  const world = document.getElementById("archive-world");
  if (!world) return;
  const camera = world.querySelector(".archive-camera");
  const plate = world.querySelector(".ship-plate");
  const desk = document.getElementById("archive-desk");
  const stage = world.querySelector(".archive-stage");
  const toolbar = desk.querySelector(".desk-toolbar");
  const modules = Array.from(desk.querySelectorAll(".desk-module"));
  const links = Array.from(world.querySelectorAll('a[href^="#"]'));
  const moduleLinks = links.filter(link => modules.some(slot => link.hash === "#" + slot.id));
  const moon = document.getElementById("moon-light");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");
  let frame = 0, deskTop = 1, plateRect, viewport;
  let moonTimer = 0;
  let inside = false;
  let boarding;
  let preferred = document.getElementById(window.location.hash.slice(1));
  let preferredAt = window.scrollY;
  let current;
  let dockSpace = 0;

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
    dockSpace = Math.ceil(toolbar.getBoundingClientRect().height) + 16;
    desk.style.setProperty("--dock-space", dockSpace + "px");
    schedule();
  }
  function paintModules(entry) {
    const door = cabinThreshold(deskTop, viewport.height);
    const settle = Math.max(0, Math.min(1, (window.scrollY - door) / (deskTop - door)));
    const gathering = !reduce.matches && entry > 0 && settle < 1;
    toolbar.style.setProperty("--dock-light", gathering ? Math.max(0, (settle - .85) / .15) : 1);
    const bounds = modules.map(slot => slot.getBoundingClientRect());
    const first = bounds[0];
    const layoutHeight = Math.max(...bounds.map(rect => rect.bottom)) - first.top;
    const miniature = Math.min(.55, viewport.height * .62 / Math.max(1, layoutHeight));

    if (preferred && Math.abs(window.scrollY - preferredAt) > viewport.height * .25) preferred = null;
    let firstVisible, atReadingLine, preferredVisible, lastVisible;
    for (const [i, slot] of modules.entries()) {
      const { top, bottom, left } = bounds[i];
      slot.classList.toggle("gathering", gathering);
      if (gathering) {
        // Gather the real windows into a small desk, then expand it into its document layout.
        const spread = 1 - entry;
        const x = (viewport.width / 2 - left) * (1 - miniature) + (i === 0 ? -1 : 1) * viewport.width * .38 * spread;
        const previewY = viewport.height * .2 + (top - first.top) * miniature + (i - 1) * viewport.height * .25 * spread;
        const restY = top + window.scrollY - deskTop;
        const y = previewY * (1 - settle) + restY * settle - top;
        slot.style.setProperty("--gather-transform", `translate(${x * (1 - settle)}px, ${y}px) scale(${miniature + (1 - miniature) * settle})`);
        slot.style.setProperty("--gather-light", entry);
      }
      const reveal = reduce.matches ? 1 : Math.max(0, Math.min(1, (viewport.height - top) / (viewport.height * .24)));
      slot.classList.toggle("arriving", reveal < 1);
      if (reveal < 1) slot.style.setProperty("--arrive", reveal.toFixed(3));
      if (!inside || bottom <= dockSpace || top >= viewport.height - 40) continue;
      firstVisible ??= slot;
      lastVisible = slot;
      if (top <= dockSpace + viewport.height * .18 && (!atReadingLine || top > atReadingLine.top)) atReadingLine = { slot, top };
      if (slot === preferred) preferredVisible = slot;
    }
    const atEnd = Math.ceil(window.scrollY + viewport.height) >= document.documentElement.scrollHeight - 1;
    const overview = window.scrollY <= deskTop;
    const active = preferredVisible || (overview && firstVisible) || (atEnd && lastVisible) || atReadingLine?.slot || firstVisible;
    if (current === active) return;
    current = active;
    for (const slot of modules) slot.classList.toggle("is-current", slot === active);
    for (const link of moduleLinks) {
      if (active && link.hash === "#" + active.id) link.setAttribute("aria-current", "location");
      else link.removeAttribute("aria-current");
    }
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
    paintModules(view.entry);
  }
  function schedule() { if (!frame) frame = requestAnimationFrame(paint); }

  // Keep same-document links on this page even when <base> and a preview query are present.
  for (const link of links) {
    link.href = window.location.pathname + window.location.search + link.hash;
    const target = document.getElementById(link.hash.slice(1));
    if (target) link.addEventListener("click", event => navigate(event, target));
  }

  function destination(target) {
    const margin = parseFloat(getComputedStyle(target).scrollMarginTop) || 0;
    const rect = target.getBoundingClientRect();
    let top = window.scrollY + rect.top - margin;
    if (modules.includes(target)) {
      // Preserve the desktop overview. On a stacked desk, bring the selected window up.
      const overview = deskTop - (parseFloat(getComputedStyle(desk).scrollMarginTop) || 0);
      const overviewBottom = overview + viewport.height - 48;
      const fits = slot => window.scrollY + slot.getBoundingClientRect().bottom <= overviewBottom;
      if ((target === modules[0] || modules.every(fits)) && window.scrollY + rect.top >= overview + dockSpace && fits(target)) top = overview;
    }
    return Math.max(0, Math.min(top, document.documentElement.scrollHeight - viewport.height));
  }
  function cancelBoarding() { boarding?.abort(); boarding = undefined; }
  function navigate(event, target) {
    if (event.defaultPrevented || event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.currentTarget;
    event.preventDefault();
    cancelBoarding();
    const from = window.scrollY, to = destination(target);
    const origin = { id: current?.id || (inside ? desk.id : "fleet") };
    if (window.location.hash !== "#" + origin.id) origin.top = from;
    function arrive() {
      window.scrollTo({ top: destination(target), behavior: "instant" });
      if (window.location.hash !== link.hash) {
        history.replaceState({ ...history.state, archiveOrigin: origin, archiveReturn: null }, "");
        history.pushState(null, "", link.href);
      }
      preferred = target;
      preferredAt = window.scrollY;
      target.focus({ preventScroll: true });
      schedule();
    }
    if (reduce.matches || Math.abs(from - to) < 2) { arrive(); return; }
    const controller = new AbortController();
    boarding = controller;
    // Direct manipulation always wins. Ordinary scrolling never starts a timed animation.
    for (const name of ["wheel", "touchstart", "pointerdown", "keydown", "pagehide", "resize"]) {
      window.addEventListener(name, cancelBoarding, { passive: true, signal: controller.signal });
    }
    // Every module gets the same flight to the glass. Only the indoor leg varies.
    const door = cabinThreshold(deskTop, viewport.height);
    const crossesDoor = Math.min(from, to) < door && door < Math.max(from, to);
    const legTime = distance => Math.min(1350, Math.max(240, distance / viewport.height * 960));
    const firstTime = legTime(Math.abs((crossesDoor ? door : to) - from));
    const secondTime = crossesDoor ? Math.min(1000, legTime(Math.abs(to - door))) : 0;
    const started = performance.now();
    function advance(now) {
      if (controller.signal.aborted) return;
      const elapsed = Math.max(0, now - started);
      if (elapsed >= firstTime + secondTime) { cancelBoarding(); arrive(); return; }
      const secondLeg = crossesDoor && elapsed >= firstTime;
      const start = secondLeg ? door : from, end = crossesDoor && !secondLeg ? door : to;
      const t = secondLeg ? (elapsed - firstTime) / secondTime : elapsed / firstTime;
      window.scrollTo({ top: start + (end - start) * t * t * (3 - 2 * t), behavior: "instant" });
      requestAnimationFrame(advance);
    }
    requestAnimationFrame(advance);
  }
  desk.addEventListener("focusin", event => {
    const slot = event.target.closest(".desk-module");
    if (slot) { preferred = slot; preferredAt = window.scrollY; schedule(); }
  });
  desk.addEventListener("click", event => {
    const article = event.target.closest('a[href^="posts/"]');
    if (!article || event.defaultPrevented || event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const slot = article.closest(".desk-module");
    if (slot) history.replaceState({ ...history.state, archiveReturn: { id: slot.id } }, "", "#" + slot.id);
  });
  function restoreLocation(origin) {
    const target = document.getElementById(origin?.id || window.location.hash.slice(1) || "fleet");
    if (target && (modules.includes(target) || target === desk || target.id === "fleet")) {
      requestAnimationFrame(() => {
        window.scrollTo({ top: origin?.top ?? destination(target), behavior: "instant" });
        preferred = target;
        preferredAt = window.scrollY;
        target.focus({ preventScroll: true });
        schedule();
      });
    }
  }
  window.addEventListener("popstate", event => {
    cancelBoarding();
    restoreLocation(event.state?.archiveReturn || event.state?.archiveOrigin);
  });
  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", measure);
  reduce.addEventListener("change", () => { cancelBoarding(); refreshMoon(); schedule(); });
  document.addEventListener("visibilitychange", () => { if (document.hidden) cancelBoarding(); refreshMoon(); });
  window.addEventListener("pagehide", () => {
    clearInterval(moonTimer);
    if (inside && !history.state?.archiveReturn) history.replaceState({ ...history.state, archiveReturn: { id: current?.id || desk.id } }, "");
  });
  window.addEventListener("pageshow", event => {
    refreshMoon(); measure();
    const navigation = performance.getEntriesByType("navigation")[0]?.type;
    if ((event.persisted || navigation === "back_forward") && history.state?.archiveReturn) restoreLocation(history.state.archiveReturn);
    else if (!event.persisted && window.location.hash && navigation === "navigate") restoreLocation();
  });
  if (document.fonts) document.fonts.ready.then(measure);
  if (typeof ResizeObserver !== "undefined") {
    const observer = new ResizeObserver(measure);
    observer.observe(toolbar);
    observer.observe(desk);
  }
  refreshMoon();
  measure();
})();
