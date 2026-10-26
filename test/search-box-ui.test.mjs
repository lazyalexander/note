import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { buildSearchSuggestions } from "../src/search-suggestions.mjs";
import { normalizeSearchInput, parseQuery, describeQueryError } from "../src/term-engine.mjs";
const source = (await readFile(new URL("../assets/search-box.js", import.meta.url), "utf8")).replace(/^import[^;]+;\s*/, "");
function setup() {
  const doc = {}, timers = [], storage = new Map();
  class Element {
    constructor() { this.children = []; this.attrs = {}; this.handlers = {}; this.value = ""; this.hidden = false; this.classList = { toggle() {} }; }
    setAttribute(k, v) { this.attrs[k] = v; }
    getAttribute(k) { return this.attrs[k]; }
    removeAttribute(k) { delete this.attrs[k]; }
    addEventListener(k, fn) { (this.handlers[k] ||= []).push(fn); }
    fire(k, props = {}) { const e = { preventDefault() { this.defaultPrevented = true; }, ...props }; for (const fn of this.handlers[k] || []) fn(e); return e; }
    append(...children) { this.children.push(...children); }
    after(child) { this.popup = child; }
    replaceChildren() { this.children = []; }
    scrollIntoView() {}
    focus() { doc.activeElement = this; this.fire("focus"); }
  }
  const input = new Element(), clear = new Element(), feedback = new Element(), field = new Element(), form = new Element();
  input.id = "query"; input.attrs["aria-describedby"] = "feedback";
  let submitted = 0;
  form.querySelector = (selector) => selector === 'input[name="q"]' ? input : selector === ".search-clear" ? clear : field;
  form.requestSubmit = () => { if (!form.fire("submit").defaultPrevented) submitted++; };
  Object.assign(doc, { querySelectorAll: () => [form], createElement: () => new Element(), getElementById: () => feedback });
  vm.runInNewContext(source, { document: doc, window: { __POSTS__: [{ title: "心跳", stem: "heart", tags: [] }] },
    localStorage: { getItem: (k) => storage.get(k), setItem: (k, v) => storage.set(k, v) },
    setTimeout: (fn) => { timers.push(fn); return timers.length; }, clearTimeout() {},
    buildSearchSuggestions, normalizeSearchInput, parseQuery, describeQueryError });
  function type(value) { input.value = value; input.fire("input", {}); }
  return { input, clear, feedback, form, field, type, tick: () => timers.splice(0).forEach((fn) => fn()), submitted: () => submitted };
}
test("arrows select a suggestion; Enter searches it and Escape preserves the typed input", () => {
  const ui = setup(); ui.input.focus(); ui.type("find 心");
  assert.equal(ui.field.popup.hidden, false);
  ui.input.fire("keydown", { key: "ArrowDown" });
  assert.equal(ui.field.popup.children[0].attrs["aria-selected"], "true");
  ui.input.fire("keydown", { key: "ArrowDown" });
  ui.input.fire("keydown", { key: "Enter" });
  assert.equal(ui.input.value, 'title:"心跳"');
  assert.equal(ui.submitted(), 1);
  ui.type("find 心"); ui.input.fire("keydown", { key: "ArrowDown" }); ui.input.fire("keydown", { key: "Escape" });
  assert.equal(ui.input.value, "find 心"); assert.equal(ui.field.popup.hidden, true);
});
test("clear removes text and errors, refocuses the field and exposes recent searches", () => {
  const ui = setup(); ui.input.focus(); ui.type("find 心跳"); ui.form.requestSubmit();
  ui.type("find (心"); ui.form.requestSubmit(); assert.equal(ui.input.attrs["aria-invalid"], "true");
  ui.clear.fire("click");
  assert.equal(ui.input.value, ""); assert.equal(ui.feedback.hidden, true); assert.equal(ui.clear.hidden, true);
  assert.equal(ui.field.popup.children[0].children[0].textContent, "心跳");
});
test("IME confirmation cannot select suggestions or submit a search", () => {
  const ui = setup(); ui.input.focus(); ui.type("find 心");
  ui.input.fire("compositionstart");
  ui.input.fire("keydown", { key: "Enter", isComposing: false }); ui.form.requestSubmit();
  assert.equal(ui.submitted(), 0); assert.equal(ui.field.popup.hidden, true);
  ui.input.fire("compositionend"); ui.form.requestSubmit(); assert.equal(ui.submitted(), 0);
  ui.tick(); ui.input.fire("keydown", { key: "Enter", keyCode: 229 }); assert.equal(ui.submitted(), 0);
  ui.form.requestSubmit(); assert.equal(ui.submitted(), 1);
});
