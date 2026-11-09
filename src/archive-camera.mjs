const clamp = (n) => Math.max(0, Math.min(1, n));

/** Coordinates are pixels in the 1536 × 1024 ship plate. */
export function archiveCameraFrame(scrollY, deskTop, viewportHeight, reducedMotion = false) {
  const end = Math.max(1, deskTop - viewportHeight * .8);
  const progress = reducedMotion ? 0 : clamp(scrollY / end);
  const t = progress * progress * (3 - 2 * progress);
  const u = 1 - t;
  // A quadratic path bends toward the twin towers, ending at the rose window.
  const focusX = u * u * 768 + 2 * u * t * 300 + t * t * 800;
  const focusY = u * u * 512 + 2 * u * t * 285 + t * t * 584;
  const scale = 3.6 ** t;
  return {
    transform: `matrix(${scale} 0 0 ${scale} ${768 - focusX * scale} ${512 - focusY * scale})`,
    progress,
  };
}
