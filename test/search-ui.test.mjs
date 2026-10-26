import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { normalizeSearchInput, describeQueryError, searchDocs, searchDocsAsync, hasAbout, makeResultView, highlightParts, formatQueryError } from "../src/term-engine.mjs";

const source = (await readFile(new URL("../assets/search.js", import.meta.url), "utf8"))
  .replace(/^import[^;]+;\s*/, "");
async function searchPage(q, unavailable = false) {
  const elements = Object.fromEntries(["sr-root", "sr-expr", "sr-summary", "sr-notes", "search-query", "search-feedback"].map((id) => [id, {
    dataset: {}, attrs: {}, handlers: {}, hidden: true,
    setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; },
    addEventListener(k, fn) { this.handlers[k] = fn; },
  }]));
  vm.runInNewContext(source, {
    window: { __POSTS__: [] }, document: { getElementById: (id) => elements[id] },
    location: { search: "?q=" + encodeURIComponent(q), href: "http://localhost/search.html?q=" + encodeURIComponent(q) },
    history: { replaceState() {} }, URL, URLSearchParams,
    fetch: async () => { if (unavailable) throw new Error("internal connection details"); return { ok: true, json: async () => ({ docs: [], series: [] }) }; },
    normalizeSearchInput, describeQueryError, searchDocs, searchDocsAsync, hasAbout, makeResultView, highlightParts, formatQueryError,
  });
  await new Promise(setImmediate);
  return elements;
}

test("invalid result URLs retain the editable input and collapse technical diagnostics", async () => {
  const el = await searchPage("find (心跳");
  assert.equal(el["sr-root"].dataset.state, "invalid");
  assert.equal(el["search-query"].value, "find (心跳");
  assert.match(el["search-feedback"].textContent, /右括号/);
  assert.match(el["sr-root"].innerHTML, /<details><summary>查看具体位置/);
  assert.doesNotMatch(el["sr-root"].innerHTML, /<details open/);
  el["search-query"].handlers.input();
  assert.equal(el["search-feedback"].hidden, true);
  assert.equal(el["search-query"].attrs["aria-invalid"], undefined);
});

test("unavailable index offers retry without dumping internal errors", async () => {
  const el = await searchPage("find 心跳", true);
  assert.equal(el["sr-root"].dataset.state, "error");
  assert.equal(el["search-query"].value, "find 心跳");
  assert.match(el["sr-root"].innerHTML, /重新搜索/);
  assert.doesNotMatch(el["sr-root"].innerHTML, /internal connection details/);
});

test("invalid pasted expressions are escaped inside diagnostic details", async () => {
  const el = await searchPage('find ("<img src=x onerror=alert(1)>"');
  assert.equal(el["sr-root"].dataset.state, "invalid");
  assert.doesNotMatch(el["sr-root"].innerHTML, /<img/);
  assert.match(el["sr-root"].innerHTML, /&lt;img/);
});
