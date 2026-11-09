import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { archiveCameraFrame } from "../src/archive-camera.mjs";
const source = (await readFile(new URL("../assets/archive-scroll.js", import.meta.url), "utf8")).replace(/^import[^;]+;\s*/, "");
function setup(reduced = false, present = true) {
  const camera = { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } }, events = {}, queue = [];
  const preference = { matches: reduced, addEventListener: (name, fn) => { events.preference = fn; } };
  const window = { scrollY: 0, innerHeight: 800, addEventListener: (name, fn) => { events[name] = fn; } };
  const desk = { getBoundingClientRect: () => ({ top: 1920 - window.scrollY }) };
  const stage = { style: { setProperty(name, value) { this[name] = value; } } };
  vm.runInNewContext(source, {
    archiveCameraFrame,
    document: { getElementById: (id) => id === "archive-desk" ? desk : present ? { querySelector: (selector) => selector === ".archive-camera" ? camera : stage } : null },
    window, matchMedia: () => preference,
    requestAnimationFrame: (fn) => { queue.push(fn); return queue.length; },
  });
  return { camera, stage, window, events, preference, queue, flush() { queue.splice(0).forEach((fn) => fn()); } };
}
test("camera frames the full ship, arcs toward the towers and centers the rose window at arrival", () => {
  const far = archiveCameraFrame(0, 1920, 800);
  assert.equal(far.transform, "matrix(1 0 0 1 0 0)");
  const mid = archiveCameraFrame(640, 1920, 800);
  assert.equal(mid.progress, .5);
  const [midScale, , , , midTx, midTy] = mid.transform.slice(7, -1).split(" ").map(Number);
  assert.ok((768 - midTx) / midScale < 600 && (512 - midTy) / midScale < 430);
  const near = archiveCameraFrame(1280, 1920, 800);
  const [a, , , , tx, ty] = near.transform.slice(7, -1).split(" ").map(Number);
  assert.equal(a, 3.6);
  assert.ok(Math.abs(800 * a + tx - 768) < 1e-8);
  assert.ok(Math.abs(584 * a + ty - 512) < 1e-8);
  assert.deepEqual(archiveCameraFrame(50000, 1920, 800), near);
  assert.deepEqual(archiveCameraFrame(-50, 1920, 800), far);
});
test("scroll batches frame updates, never intercepts wheel and respects history restore", () => {
  const ui = setup();
  assert.equal(ui.events.wheel, undefined);
  ui.window.scrollY = 800; ui.events.scroll(); ui.events.scroll();
  assert.equal(ui.queue.length, 1);
  ui.flush();
  assert.equal(ui.camera.attrs.transform, archiveCameraFrame(800, 1920, 800).transform);
  ui.window.scrollY = 0; ui.events.pageshow(); ui.flush();
  assert.equal(ui.camera.attrs.transform, "matrix(1 0 0 1 0 0)");
});
test("reduced motion stays static and responds to preference changes", () => {
  const ui = setup(true); ui.flush();
  assert.equal(ui.camera.attrs.transform, "matrix(1 0 0 1 0 0)");
  ui.preference.matches = false; ui.window.scrollY = 800; ui.events.preference(); ui.flush();
  assert.notEqual(ui.camera.attrs.transform, "matrix(1 0 0 1 0 0)");
  ui.preference.matches = true; ui.events.preference(); ui.flush();
  assert.equal(ui.camera.attrs.transform, "matrix(1 0 0 1 0 0)");
  assert.equal(ui.stage.style["--approach"], 0);
});
test("non-home pages install no scene handlers", () => {
  assert.equal(Object.keys(setup(false, false).events).length, 0);
});
