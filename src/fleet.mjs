// Each position is the center of the hull in viewport percentages, followed by its width.
// Engine sockets are measured on the individual 512 × 384 illustration plates.
const escorts = [
  { hull: "carrier", wide: [29, 74, 20], tall: [29, 67, 32], engine: [18, 164], depth: 10 },
  { hull: "clipper", wide: [73, 26, 14], tall: [78, 35, 22], engine: [18, 278], depth: 4 },
  { hull: "forge",   wide: [15, 52, 13], tall: [15, 35, 22], engine: [24, 175], depth: 6 },
  { hull: "courier", wide: [48, 19, 12], tall: [48, 28, 20], engine: [16, 184], depth: 2 },
  { hull: "salvage", wide: [79, 81, 13], tall: [78, 68, 25], engine: [18, 176], depth: 5 },
];

export function fleetEscortsHtml() {
  return escorts.map(({ hull, wide, tall, engine, depth }) => {
    const [x, y, width] = wide;
    const [px, py, pwidth] = tall;
    const layout = `--x:${x}%;--y:${y}%;--w:${width}%;--px:${px}%;--py:${py}%;--pw:${pwidth}%;--depth:${depth}`;
    return `<svg class="escort" style="${layout}" viewBox="0 0 512 384" focusable="false">
      <g transform="translate(${engine.join(" ")}) scale(.58)"><use class="engine-flame" href="#plume"/></g>
      <image href="assets/fleet/${hull}.webp" width="512" height="384" filter="url(#flagship-palette)"/>
    </svg>`;
  }).join("\n");
}
