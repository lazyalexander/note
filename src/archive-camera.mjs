const clamp = (n) => Math.max(0, Math.min(1, n));

/** SVG world coordinates keep the little house centered on all viewport sizes. */
export function archiveCameraFrame(scrollY, deskTop, viewportHeight, reducedMotion = false) {
  if (reducedMotion) return { transform: "matrix(1 0 0 1 0 0)", progress: 0 };
  const end = Math.max(1, deskTop - viewportHeight * .4);
  const progress = clamp(scrollY / end);
  const eased = progress * progress * (3 - 2 * progress);
  // An exponential dolly: overview -> district -> the house at (1640, 1080).
  const scale = 4.8 ** eased;
  const focusX = 1200 + (1640 - 1200) * eased;
  const focusY = 700 + (1080 - 700) * eased;
  return {
    transform: `matrix(${scale} 0 0 ${scale} ${1200 - focusX * scale} ${700 - focusY * scale})`,
    progress,
  };
}
