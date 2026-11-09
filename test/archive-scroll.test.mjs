import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
const source = await readFile(new URL("../assets/archive-scroll.js", import.meta.url), "utf8");
function setup(reduced = false, present = true) {
  const scene = { style: {} }, events = {}, queue = [];
  const preference = { matches: reduced, addEventListener: (name, fn) => { events.preference = fn; } };
  const window = { scrollY: 0, innerHeight: 800, addEventListener: (name, fn) => { events[name] = fn; } };
  vm.runInNewContext(source, {
    document: { getElementById: () => present ? { querySelector: () => scene } : null },
    window, matchMedia: () => preference,
    requestAnimationFrame: (fn) => { queue.push(fn); return queue.length; },
  });
  return { scene, window, events, preference, queue, flush() { queue.splice(0).forEach((fn) => fn()); } };
}
test("native scroll updates only scenery and coalesces repeated events", () => {
  const ui = setup();
  assert.equal(ui.events.wheel, undefined);
  ui.window.scrollY = 400;
  ui.events.scroll(); ui.events.scroll();
  assert.equal(ui.queue.length, 1);
  ui.flush();
  assert.match(ui.scene.style.transform, /scale\(1.1\)/);
  ui.window.scrollY = 50000; ui.events.scroll(); ui.flush();
  assert.match(ui.scene.style.transform, /scale\(1.2\)/);
});
test("reduced motion stays static and can be toggled while the page is open", () => {
  const ui = setup(true);
  assert.equal(ui.scene.style.transform, "none");
  ui.preference.matches = false; ui.events.preference(); ui.flush();
  assert.notEqual(ui.scene.style.transform, "none");
  ui.preference.matches = true; ui.events.preference(); ui.flush();
  assert.equal(ui.scene.style.transform, "none");
});
test("reader and search pages do not install scene handlers", () => {
  const ui = setup(false, false);
  assert.equal(Object.keys(ui.events).length, 0);
});
