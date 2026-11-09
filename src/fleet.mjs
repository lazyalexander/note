// Hull centers and widths are percentages of the formation. Each nozzle is
// [x, y, scale] in its 512 × 384 illustration; angle follows the engine barrel.
const escorts = [
  { hull: "carrier", wide: [35, 71, 23], tall: [37, 67, 34], nozzles: [[8, 147, .64], [7, 204, .72]], angle: 14, depth: 10 },
  { hull: "clipper", wide: [73, 34, 16], tall: [76, 24, 25], nozzles: [[11, 254, .52]], angle: 10, depth: 4 },
  { hull: "forge",   wide: [21, 53, 15], tall: [19, 51, 22], nozzles: [[25, 154, .54], [19, 218, .62]], angle: 13, depth: 6 },
  { hull: "courier", wide: [51, 22, 12], tall: [45, 14, 22], nozzles: [[8, 156, .46], [10, 200, .50]], angle: 9, depth: 2 },
  { hull: "tender",  wide: [68, 82, 18], tall: [78, 74, 27], nozzles: [[25, 175, .85]], angle: 15, depth: 7 },
];

export function exhaustHtml(nozzles, angle) {
  return nozzles.map(([x, y, scale]) => `<g transform="translate(${x} ${y}) rotate(${angle}) scale(${scale})">
    <use class="engine-flame" style="animation-delay:-${y * 9}ms" href="#plume"/>
  </g>`).join("");
}

export function fleetEscortsHtml() {
  return escorts.map(({ hull, wide, tall, nozzles, angle, depth }) => {
    const [x, y, width] = wide;
    const [px, py, pwidth] = tall;
    const layout = `--x:${x}%;--y:${y}%;--w:${width}%;--px:${px}%;--py:${py}%;--pw:${pwidth}%;--depth:${depth}`;
    return `<svg class="escort" style="${layout}" viewBox="0 0 512 384" focusable="false">
      ${exhaustHtml(nozzles, angle)}
      <image href="assets/fleet/${hull}.webp" width="512" height="384" filter="url(#flagship-palette)"/>
    </svg>`;
  }).join("\n");
}
