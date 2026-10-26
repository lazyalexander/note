import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { createTermEngine, complete, searchDocs, hasAbout, scrubInvisible, formatQueryError } from "../src/term-engine.mjs";

// Exercise the real terminal event handlers without a browser or an OS keyboard layout.
const source = (await readFile(new URL("../assets/terminal.js", import.meta.url), "utf8"))
  .replace(/^import[\s\S]*?from [^;]+;\s*/, "");
function terminal() {
  class Element {
    constructor() {
      this.value = ""; this.children = []; this.dataset = {}; this.attrs = {};
      this.handlers = {}; this.hidden = true; this.clientWidth = 500; this.scrollWidth = 0;
      const classes = new Set();
      this.classList = { add: (x) => classes.add(x), remove: (x) => classes.delete(x),
        toggle: (x, on) => on ? classes.add(x) : classes.delete(x) };
    }
    addEventListener(name, fn) { (this.handlers[name] ||= []).push(fn); }
    fire(name, props = {}) {
      const e = { key: "", preventDefault() { this.defaultPrevented = true; }, ...props };
      for (const fn of this.handlers[name] || []) fn(e);
      return e;
    }
    setAttribute(k, v) { this.attrs[k] = v; }
    removeAttribute(k) { delete this.attrs[k]; }
    setSelectionRange(a, b) { this.selectionStart = a; this.selectionEnd = b; }
    appendChild(el) { this.children.push(el); }
    set innerHTML(v) { this.children = []; }
    querySelector() { return new Element(); }
    querySelectorAll() { return this.children; }
    focus() {} blur() { this.fire("blur"); } scrollIntoView() {}
  }
  const elements = Object.fromEntries(["term-bar", "term-input", "suggest", "term-echo", "term-ghost", "sl-msg"]
    .map((id) => [id, new Element()]));
  const timers = new Map(), submitted = [], navigated = [];
  let id = 0;
  const window = { addEventListener() {}, location: { assign: (href) => navigated.push(href) } };
  const ctx = {
    window, document: { getElementById: (id) => elements[id], createElement: () => new Element(),
      addEventListener() {}, dispatchEvent() {} },
    localStorage: { getItem: () => null, setItem() {} },
    CustomEvent: class {},
    setTimeout: (fn) => { timers.set(++id, fn); return id; }, clearTimeout: (id) => timers.delete(id),
    fetch: async () => ({ ok: true, json: async () => ({ docs: [] }) }),
    complete, searchDocs, hasAbout, scrubInvisible, formatQueryError,
    createTermEngine: (options) => {
      const engine = createTermEngine(options), submit = engine.submit;
      engine.submit = (line) => { submitted.push(line); return submit(line); };
      return engine;
    },
  };
  vm.runInNewContext(source, ctx);
  window.__term.open("/find 心跳");
  return { ...elements, submitted, navigated, open: window.__term.open,
    tick() { const pending = [...timers.values()]; timers.clear(); pending.forEach((fn) => fn()); } };
}

test("IME owns Enter, Tab, arrows and Escape until the committed text settles", () => {
  const ui = terminal(), input = ui["term-input"];
  input.fire("compositionstart");
  assert.equal(ui.suggest.hidden, true);
  for (const key of ["Enter", "Tab", "ArrowDown", "Escape"]) {
    assert.equal(input.fire("keydown", { key }).defaultPrevented, undefined);
  }
  input.fire("compositionend");
  input.fire("input", { isComposing: false }); // Safari final input before commit timer
  input.fire("keydown", { key: "Enter", isComposing: false });
  assert.equal(ui.submitted.length, 0);
  ui.tick();
  input.fire("keydown", { key: "Enter" });
  assert.deepEqual(ui.submitted, ["/find 心跳"]);
  assert.equal(ui.navigated.length, 1);
});

test("Safari legacy keyCode 229 cannot submit or accept a completion", () => {
  const ui = terminal(), input = ui["term-input"];
  for (const key of ["Enter", "Tab", "Escape"]) input.fire("keydown", { key, keyCode: 229 });
  assert.equal(ui.submitted.length, 0);
  assert.equal(input.value, "/find 心跳");
  input.fire("keydown", { key: "Enter", isComposing: true });
  assert.equal(ui.submitted.length, 0);
});

test("errors preserve input, close suggestions, survive index loading and clear on edit", async () => {
  const ui = terminal(), input = ui["term-input"], echo = ui["term-echo"];
  ui.open("/theme nope");
  input.fire("keydown", { key: "Enter" });
  assert.match(echo.textContent, /未知主题/);
  assert.equal(input.value, "/theme nope");
  assert.equal(input.attrs["aria-invalid"], "true");
  assert.equal(ui.suggest.hidden, true);
  await new Promise(setImmediate);
  assert.match(echo.textContent, /未知主题/);
  input.value = "/theme paper";
  input.fire("input");
  assert.equal(input.attrs["aria-invalid"], "false");
  assert.equal(echo.hidden, true);
});

test("malformed search gets live feedback and a submitted error persists until corrected", async () => {
  const ui = terminal(), input = ui["term-input"], echo = ui["term-echo"];
  await new Promise(setImmediate);
  input.value = "/find (心跳";
  input.fire("input");
  assert.match(echo.textContent, /表达式有误/);
  input.fire("keydown", { key: "Enter" });
  assert.match(echo.textContent, /修改标记处/);
  assert.equal(ui.navigated.length, 0);
  input.value = "/find 心跳";
  input.fire("input");
  assert.equal(input.attrs["aria-invalid"], "false");
  assert.match(echo.textContent, /篇匹配/);
});
