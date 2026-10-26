import test from "node:test";
import assert from "node:assert/strict";
import { buildSearchSuggestions } from "../src/search-suggestions.mjs";
const posts = [
  { title: "The Black Cat", stem: "cat", tags: ["猫", "poe"] },
  { title: "心跳", stem: "heart", tags: ["poe"] },
];
test("suggestions combine literal query, matching history and note titles without duplicates", () => {
  const items = buildSearchSuggestions("心", posts, ["心", "心跳", "猫"]);
  assert.deepEqual(items.map((x) => x.value), ["心", "心跳", 'title:"心跳"']);
  assert.equal(new Set(items.map((x) => x.value)).size, items.length);
  assert.equal(buildSearchSuggestions("tag:poe", posts).length, 3);
});
test("empty field shows recent queries; invalid queries and semantic terms never start a model", () => {
  assert.equal(buildSearchSuggestions("", posts, ["猫"])[0].value, "猫");
  assert.deepEqual(buildSearchSuggestions("(猫", posts), []);
  assert.deepEqual(buildSearchSuggestions("about:黑暗", posts).map((x) => x.value), ["about:黑暗"]);
  assert.ok(buildSearchSuggestions("", [], Array.from({ length: 20 }, (_, i) => String(i))).length <= 7);
});
