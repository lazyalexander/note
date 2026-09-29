import test from "node:test";
import assert from "node:assert/strict";
import { dynamicCount, dynamicMax, selectAbout, scoreEmbeddings, cosine } from "../src/about.mjs";

test("dynamicMax: bounded by ceil(n/2) and never everything for n>=2", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7, 10, 100].map(dynamicMax), [0, 1, 1, 2, 2, 3, 3, 4, 5, 50]);
});

test("dynamicCount: edge cases", () => {
  assert.equal(dynamicCount([]), 0);
  assert.equal(dynamicCount(undefined), 0);
  assert.equal(dynamicCount([0.8]), 1); // N=1
  assert.equal(dynamicCount([0.8, 0.8, 0.8, 0.8]), 1); // all equal → no signal → 1
  assert.equal(dynamicCount([0.81, 0.8, 0.8, 0.8, 0.8, 0.8]), 1); // nearly flat
  assert.equal(dynamicCount([0.9, 0.5]), 1); // n=2 → at most 1
  assert.equal(dynamicCount([NaN, 0.9, 0.5, 0.4]), dynamicCount([0.9, 0.5, 0.4])); // NaN ignored
});

test("dynamicCount: keeps the clear outliers, never more than ceil(n/2)", () => {
  // two clear winners among six
  assert.equal(dynamicCount([0.9, 0.88, 0.8, 0.79, 0.78, 0.77]), 2);
  // one clear winner
  assert.equal(dynamicCount([0.88, 0.8, 0.79, 0.79, 0.78, 0.77]), 1);
  // graded scores: capped at ceil(6/2)=3
  assert.ok(dynamicCount([0.95, 0.93, 0.91, 0.89, 0.87, 0.85]) <= 3);
  // order independent
  assert.equal(dynamicCount([0.77, 0.9, 0.79, 0.88, 0.78, 0.8]), 2);
  // big corpus: bounded
  const many = Array.from({ length: 200 }, (_, i) => 0.6 + i / 1000);
  const k = dynamicCount(many);
  assert.ok(k >= 1 && k <= 100);
});

test("dynamicCount: property — always within [1, dynamicMax(n)] for n>=1", () => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), seed / 0x7fffffff);
  for (let t = 0; t < 500; t++) {
    const n = 1 + Math.floor(rnd() * 30);
    const s = Array.from({ length: n }, () => 0.6 + rnd() * 0.35);
    const k = dynamicCount(s);
    assert.ok(k >= 1 && k <= Math.max(1, dynamicMax(n)), `n=${n} k=${k}`);
  }
});

const E = [
  { id: "a", score: 0.5 },
  { id: "b", score: 0.9 },
  { id: "c", score: 0.7 },
  { id: "d", score: 0.7 },
  { id: "e", score: 0.1 },
];
test("selectAbout: top / bottom / threshold / auto", () => {
  assert.deepEqual(selectAbout(E, { mode: "top", n: 2 }), ["b", "c"]); // ties keep input order
  assert.deepEqual(selectAbout(E, { mode: "top", n: 99 }), ["b", "c", "d", "a", "e"]);
  assert.deepEqual(selectAbout(E, { mode: "bottom", n: 2 }), ["a", "e"]); // returned best-first
  assert.deepEqual(selectAbout(E, { mode: "bottom", n: 99 }).length, 5);
  assert.deepEqual(selectAbout(E, { mode: "gt", min: 0.7, inclusive: false }), ["b"]);
  assert.deepEqual(selectAbout(E, { mode: "gt", min: 0.7, inclusive: true }), ["b", "c", "d"]);
  assert.deepEqual(selectAbout(E, null), ["b"]);
  assert.deepEqual(selectAbout([], { mode: "top", n: 3 }), []);
  assert.deepEqual(selectAbout([], null), []);
  assert.deepEqual(selectAbout([{ id: "x", score: 0.3 }], null), ["x"]); // N=1
});

test("scoreEmbeddings: max over passages, best passage text", () => {
  const idx = {
    docs: [
      { stem: "p", vectors: [[1, 0], [0, 1], [0.6, 0.8]], passages: ["one", "two", ""] },
      { stem: "q", vectors: [[0, 1]] }, // no passages → ""
      { stem: "r", vectors: [] },
    ],
  };
  const m = scoreEmbeddings([0, 1], idx);
  assert.equal(m.get("p").score, 1);
  assert.equal(m.get("p").passage, "two");
  assert.equal(m.get("q").passage, "");
  assert.equal(m.has("r"), false);
  assert.equal(cosine([1, 2], [3, 4]), 11);
});
