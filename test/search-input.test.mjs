import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSearchInput, createTermEngine, searchDocs } from "../src/term-engine.mjs";
import { THEME_NAMES, resolveTheme } from "../src/themes.mjs";

const docs = [{ stem: "heart", title: "心跳", body: "心跳故事", tags: ["poe"] }];
test("home /find, bare find and direct expressions return the same search results", () => {
  for (const input of ["心跳", "/find 心跳", "find 心跳", "／ｆｉｎｄ　心跳"]) {
    const q = normalizeSearchInput(input, ["poe"]);
    assert.equal(q, "心跳");
    assert.equal(q, createTermEngine().submit("/find 心跳").query);
    assert.equal(searchDocs(docs, q).results.length, 1);
  }
});
test("search input handles aliases without damaging regex, quoted text or query errors", () => {
  assert.equal(normalizeSearchInput("/tag poe", ["poe"]), "tag:poe");
  assert.equal(normalizeSearchInput("/about 心跳"), "about:心跳");
  assert.equal(normalizeSearchInput("/grep 心跳"), "grep:心跳");
  for (const raw of ["/find/", '"find 心跳"', "tag:poe & !draft", "/(find|grep)/i"]) {
    assert.equal(normalizeSearchInput(raw), raw);
  }
  assert.equal(searchDocs(docs, normalizeSearchInput("/find (心跳")).ok, false);
  assert.equal(normalizeSearchInput("/find"), "");
});
test("only day and tokyo are available, and legacy browser preferences migrate", () => {
  assert.deepEqual(THEME_NAMES, ["day", "tokyo"]);
  for (const old of ["day", "paper"]) assert.equal(resolveTheme(old), "day");
  for (const old of [null, "tokyo", "auto", "ink", "unknown"]) assert.equal(resolveTheme(old), "tokyo");
});
