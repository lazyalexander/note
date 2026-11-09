// Each position is the center of the hull in viewport percentages, followed by its width.
// Engine sockets are measured on the individual 512 × 384 illustration plates.
const escorts = [
  { hull: "armillary", wide: [13, 47, 15], tall: [13, 38, 23], engine: [25, 250], depth: 7 },
  { hull: "carrier",   wide: [26, 70, 20], tall: [27, 66, 32], engine: [18, 164], depth: 10 },
  { hull: "tanker",    wide: [45, 79, 12], tall: [54, 75, 20], engine: [21, 206], depth: 5 },
  { hull: "clipper",   wide: [74, 26, 13], tall: [74, 34, 21], engine: [18, 278], depth: 4 },
  { hull: "forge",     wide: [8, 66, 10],  tall: [10, 56, 18], engine: [24, 175], depth: 4 },
  { hull: "courier",   wide: [59, 16, 11], tall: [48, 30, 19], engine: [16, 184], depth: 2 },
  { hull: "ark",       wide: [80, 85, 13], tall: [84, 71, 22], engine: [25, 210], depth: 6 },
  { hull: "salvage",   wide: [90, 43, 10], tall: [91, 43, 16], engine: [18, 176], depth: 3 },
];

export function fleetEscortsHtml() {
  return escorts.map(({ hull, wide, tall, engine, depth }) => {
    const [x, y, width] = wide;
    const [px, py, pwidth] = tall;
    const layout = `--x:${x}%;--y:${y}%;--w:${width}%;--px:${px}%;--py:${py}%;--pw:${pwidth}%;--depth:${depth}`;
    return `<svg class="escort" style="${layout}" viewBox="0 0 512 384" focusable="false">
      <g transform="translate(${engine.join(" ")}) scale(.58)"><use class="engine-flame" href="#plume"/></g>
      <image href="assets/fleet/${hull}.webp" width="512" height="384"/>
    </svg>`;
  }).join("\n");
}
