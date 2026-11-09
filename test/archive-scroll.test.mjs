import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { archiveCameraFrame, cabinThreshold, moonLightPath, windowAperture } from "../src/archive-camera.mjs";
import { fleetEscortsHtml } from "../src/fleet.mjs";

const source = (await readFile(new URL("../assets/archive-scroll.js", import.meta.url), "utf8"))
  .replace(/^import[^;]+;\s*/, "");
const height = 800, deskTop = height * 2.44;
const travel = deskTop - height * 1.08;
const viewAt = (t) => archiveCameraFrame(travel * t, deskTop, height);

test("the approach begins with the full ship, banks past the towers and meets the painted rose", () => {
  const far = viewAt(0);
  assert.equal(far.transform, "matrix(1 0 0 1 0 0)");
  assert.equal(far.entry, 0);
  const mid = viewAt(.365);
  assert.equal(mid.progress, .5);
  assert.ok(mid.roseX > 960 && mid.roseY > 650);
  assert.equal(viewAt(.65).entry, 0);
  const near = viewAt(.82);
  assert.ok(near.entry > 0 && near.entry < 1);
  assert.ok(Math.abs(near.roseX - 768) < 1e-8 && Math.abs(near.roseY - 512) < 1e-8);
  assert.equal(viewAt(1).entry, 1);
  assert.deepEqual(viewAt(4), viewAt(1));
  assert.deepEqual(viewAt(-1), far);
});

test("the aperture starts on the actual glass and grows beyond all four viewport corners", () => {
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    const plate = { left: 37, top: 76, width: viewport.width * .77, height: viewport.height * .52 };
    const unit = Math.min(plate.width / 1536, plate.height / 1024);
    const initial = viewAt(.68), start = windowAperture(initial, plate, viewport);
    assert.ok(Math.abs(start.x - (plate.left + (plate.width - 1536 * unit) / 2 + initial.roseX * unit)) < 1e-8);
    assert.ok(Math.abs(start.y - (plate.top + (plate.height - 1024 * unit) / 2 + initial.roseY * unit)) < 1e-8);
    assert.equal(start.rx, 20 * unit * initial.scale);
    let last = start.rx;
    for (let i = 69; i <= 100; i++) {
      const gate = windowAperture(viewAt(i / 100), plate, viewport);
      assert.ok(gate.rx >= last);
      last = gate.rx;
    }
    const end = windowAperture(viewAt(1), plate, viewport);
    for (const x of [0, viewport.width]) for (const y of [0, viewport.height]) {
      assert.ok(((x - end.x) / end.rx) ** 2 + ((y - end.y) / end.ry) ** 2 < 1);
    }
  }
});

function setup(reduced = false, present = true) {
  const events = {}, queue = [], classes = new Set(), historyEntries = [];
  const camera = { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } };
  const stage = {
    style: { setProperty(name, value) { this[name] = value; } },
    classList: { toggle(k, on) { if (on) classes.add(k); else classes.delete(k); } },
    getBoundingClientRect: () => ({ width: 1280, height }),
  };
  const rect = { left: 320, top: 136, width: 832, height: 544 };
  const preference = { matches: reduced, addEventListener: (_, fn) => { events.preference = fn; } };
  const listeners = new Map();
  const window = {
    scrollY: 0, location: { pathname: "/note/", search: "?preview", hash: "" },
    addEventListener(name, fn, options) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      const group = listeners.get(name);
      group.add(fn);
      events[name] = (event = {}) => { for (const handler of group) handler(event); };
      options?.signal?.addEventListener("abort", () => group.delete(fn));
    },
    scrollTo({ top }) { this.scrollY = top; events.scroll(); },
  };
  const style = () => ({ setProperty(name, value) { this[name] = value; } });
  function target(id, y, size) {
    return {
      id, style: style(), classList: { toggle(name, on) { this[name] = on; } },
      getBoundingClientRect: () => ({ top: y - window.scrollY, bottom: y + size - window.scrollY }),
      focus() { this.focused = true; },
    };
  }
  const modules = [
    target("notebook", deskTop + 80, 420), target("site-about", deskTop + 530, 150), target("site-help", deskTop + 710, 900),
  ];
  const desk = target("archive-desk", deskTop, 1660);
  const fleet = target("fleet", 0, deskTop);
  const toolbar = { getBoundingClientRect: () => ({ height: 44 }) };
  desk.querySelector = () => toolbar;
  desk.querySelectorAll = () => modules;
  desk.addEventListener = () => {};
  function linkTo(id) {
    return {
      hash: "#" + id, addEventListener(_, fn) { this.click = fn; },
      setAttribute(name, value) { this[name] = value; }, removeAttribute(name) { delete this[name]; },
    };
  }
  const links = [desk, fleet, ...modules, ...modules].map(el => linkTo(el.id));
  const elements = { ".archive-camera": camera, ".ship-plate": { getBoundingClientRect: () => rect }, ".archive-stage": stage };
  const world = { querySelector: (s) => elements[s], querySelectorAll: () => links };
  const ids = Object.fromEntries([fleet, desk, ...modules].map(el => [el.id, el]));
  vm.runInNewContext(source, {
    archiveCameraFrame, cabinThreshold, moonLightPath, windowAperture, AbortController,
    clearInterval() {}, setInterval() { return 1; }, performance: { now: () => 0, getEntriesByType: () => [] },
    document: {
      addEventListener() {}, documentElement: { scrollHeight: deskTop + 1660 },
      getElementById: (id) => ({ ...ids, "archive-world": present ? world : null, "moon-light": camera })[id],
    },
    window, matchMedia: () => preference, getComputedStyle: () => ({ scrollMarginTop: "24px" }),
    history: {
      replaceState(state) { this.state = state; },
      pushState(_, __, href) { historyEntries.push(href); window.location.hash = new URL(href, "https://notes.test").hash; },
    },
    requestAnimationFrame: (fn) => { queue.push(fn); return queue.length; },
  });
  const flush = (now = 0) => queue.splice(0).forEach((fn) => fn(now));
  const enter = (id = "archive-desk") => {
    const link = links.find(link => link.hash === "#" + id);
    link.click({ currentTarget: link, preventDefault() {} });
  };
  return { stage, window, events, preference, classes, camera, desk, modules, links, queue, flush, enter, historyEntries };
}

test("manual scroll, reversing through the window and history restore share a single camera", () => {
  const ui = setup();
  assert.equal(ui.events.wheel, undefined);
  ui.window.scrollY = .85 * travel; ui.events.scroll(); ui.events.scroll();
  assert.equal(ui.queue.length, 1);
  ui.flush();
  assert.ok(ui.classes.has("at-window"));
  const gate = ui.stage.style["--gate-rx"];
  ui.window.scrollY = deskTop; ui.events.pageshow(); ui.flush();
  assert.ok(ui.classes.has("in-cabin"));
  ui.window.scrollY = .85 * travel; ui.events.scroll(); ui.flush();
  assert.equal(ui.stage.style["--gate-rx"], gate);
  assert.ok(!ui.classes.has("in-cabin"));
});

test("automatic boarding can be interrupted before it changes focus or history", () => {
  const ui = setup();
  ui.flush(); ui.enter(); ui.flush(600);
  const before = ui.window.scrollY;
  assert.ok(before > 0 && before < deskTop);
  ui.events.wheel(); ui.flush(2600);
  assert.equal(ui.window.scrollY, before);
  assert.equal(ui.desk.focused, undefined);
  assert.deepEqual(ui.historyEntries, []);
});

test("completed boarding preserves the preview URL and lands keyboard focus on the archive", () => {
  const ui = setup();
  ui.flush(); ui.enter(); ui.flush(2500); ui.flush(2501);
  assert.ok(ui.classes.has("in-cabin"));
  assert.equal(ui.desk.focused, true);
  assert.deepEqual(ui.historyEntries, ["/note/?preview#archive-desk"]);
});

test("reduced motion offers direct access to the cabin without animating the window", () => {
  const ui = setup(true); ui.flush(); ui.enter();
  assert.equal(ui.desk.focused, true);
  assert.equal(ui.events.wheel, undefined);
  ui.window.scrollY = deskTop; ui.events.scroll(); ui.flush();
  assert.equal(ui.camera.attrs.transform, "matrix(1 0 0 1 0 0)");
  assert.ok(ui.classes.has("in-cabin") && !ui.classes.has("at-window"));
  ui.preference.matches = false; ui.events.preference(); ui.flush();
  assert.notEqual(ui.camera.attrs.transform, "matrix(1 0 0 1 0 0)");
});
test("each module follows the same approach and lands focus and both navigation markers on its own window", () => {
  const windowPositions = [];
  for (const id of ["notebook", "site-about", "site-help"]) {
    const ui = setup(); ui.flush(); ui.enter(id); ui.flush(850);
    windowPositions.push(ui.window.scrollY);
    assert.deepEqual(ui.historyEntries, []);
    ui.flush(2600); ui.flush(2601);
    assert.equal(ui.modules.find(slot => slot.id === id).focused, true);
    assert.ok(ui.classes.has("in-cabin"));
    assert.equal(ui.window.location.hash, "#" + id);
    const marked = ui.links.filter(link => link["aria-current"] === "location");
    assert.deepEqual(marked.map(link => link.hash), ["#" + id, "#" + id]);
  }
  assert.equal(new Set(windowPositions).size, 1);
});

test("scrolling reveals the windows without taking focus or adding history, including on reversal", () => {
  const ui = setup(); ui.flush();
  const [blog, about] = ui.modules;
  ui.window.scrollY = deskTop - height + 180; ui.events.scroll(); ui.flush();
  assert.ok(blog.classList.arriving && about.classList.arriving);
  assert.ok(Number(blog.style["--arrive"]) > 0 && Number(about.style["--arrive"]) === 0);
  ui.window.scrollY = deskTop + 460; ui.events.scroll(); ui.flush();
  assert.equal(about.classList.arriving, false);
  assert.ok(about.classList["is-current"]);
  assert.equal(about.focused, undefined);
  ui.window.scrollY = 0; ui.events.scroll(); ui.flush();
  assert.ok(blog.classList.arriving && !about.classList["is-current"]);
  assert.deepEqual(ui.historyEntries, []);
});

test("history and reduced motion reach the requested module without playing the flight", () => {
  const ui = setup(true); ui.flush(); ui.enter("site-help"); ui.flush();
  assert.ok(ui.modules[2].focused);
  ui.window.location.hash = "#site-about"; ui.events.popstate(); ui.flush(); ui.flush();
  assert.ok(ui.modules[1].focused && ui.modules[1].classList["is-current"]);
  assert.equal(ui.modules[1].classList.arriving, false);
  assert.deepEqual(ui.historyEntries, ["/note/?preview#site-help"]);
});

test("non-home pages install no scene handlers", () => {
  assert.equal(Object.keys(setup(false, false).events).length, 0);
});

test("the five remaining escorts each ship a distinct illustration", async () => {
  const files = [...fleetEscortsHtml().matchAll(/<image href="(assets\/fleet\/[^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(files.map((file) => file.split("/").pop()).sort(), ["carrier.webp", "clipper.webp", "courier.webp", "rearguard.webp", "tender.webp"]);
  const plates = await Promise.all(files.map((file) => readFile(new URL("../" + file, import.meta.url))));
  assert.equal(new Set(plates.map((buffer) => buffer.toString("base64"))).size, files.length);
});

test("the satellite advances through four distinct phases and repeats in four minutes", () => {
  const phases = [0, 60000, 120000, 180000].map(moonLightPath);
  assert.equal(new Set(phases).size, 4);
  assert.equal(moonLightPath(240000), phases[0]);
});
