import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSearchInput, createTermEngine, searchDocs } from "../src/term-engine.mjs";
import { THEME_NAMES, localTheme } from "../src/themes.mjs";

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
test("local daytime starts at 06:00 and ends at 18:00", () => {
  assert.deepEqual(THEME_NAMES, ["day", "tokyo"]);
  for (let hour = 0; hour < 24; hour++) {
    assert.equal(localTheme(hour), hour >= 6 && hour < 18 ? "day" : "tokyo");
  }
});
