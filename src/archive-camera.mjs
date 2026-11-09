const clamp = (n) => Math.max(0, Math.min(1, n));
const smooth = (n) => n * n * (3 - 2 * n);
const rose = { x: 800, y: 584 };

export const cabinThreshold = (deskTop, height) => Math.max(1, deskTop - height * 1.08);

/** The whole route follows native document scroll, including on the way back. */
export function archiveCameraFrame(scrollY, deskTop, height, reducedMotion = false) {
  const travel = cabinThreshold(deskTop, height);
  const route = clamp(scrollY / travel);
  const progress = reducedMotion ? 0 : smooth(clamp(route / .73));
  const entry = reducedMotion ? Number(deskTop - scrollY < height * .8) : smooth(clamp((route - .68) / .32));
  const u = 1 - progress;
  const focusX = u * u * 768 + 2 * u * progress * 300 + progress * progress * rose.x;
  const focusY = u * u * 512 + 2 * u * progress * 285 + progress * progress * rose.y;
  const scale = reducedMotion ? 1 : 3.7 ** progress * 1.32 ** entry;
  const tx = 768 - focusX * scale;
  const ty = 512 - focusY * scale;
  return {
    progress, entry, scale,
    roseX: rose.x * scale + tx, roseY: rose.y * scale + ty,
    transform: `matrix(${scale} 0 0 ${scale} ${tx} ${ty})`,
  };
}

/** Project the painted window through the SVG's xMidYMid meet transform into the fixed stage. */
export function windowAperture(camera, plate, viewport) {
  const unit = Math.min(plate.width / 1536, plate.height / 1024);
  const x = plate.left + plate.width / 2 + (camera.roseX - 768) * unit;
  const y = plate.top + plate.height / 2 + (camera.roseY - 512) * unit;
  const start = Math.max(1, 20 * camera.scale * unit);
  const farthestCorner = Math.hypot(Math.max(x, viewport.width - x), Math.max(y, viewport.height - y));
  // Exponential growth keeps the first glimpse inside the glass before the rim passes the viewer.
  const rx = start * ((farthestCorner + 12) / start) ** camera.entry;
  return { x, y, rx, ry: rx * (1.31 - .31 * camera.entry) };
}

// The fictional satellite completes one orbit every four minutes, shared by all tabs.
export function moonLightPath(timestamp) {
  const phase = (timestamp % 240000) / 240000;
  const cosine = Math.cos(phase * 2 * Math.PI);
  const waxing = phase < .5;
  const terminator = Math.abs(48 * cosine).toFixed(2);
  return `M50 2 A48 48 0 0 ${+waxing} 50 98 A${terminator} 48 0 0 ${+(waxing !== (cosine >= 0))} 50 2Z`;
}
