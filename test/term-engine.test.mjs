import test from "node:test";
import assert from "node:assert/strict";
import {
  parseLine,
  createTermEngine,
  tagAtomMatches,
  scrubInvisible,
  normalizeTag,
  codepointsHex,
  EGG_HREF,
} from "../src/term-engine.mjs";

const posts = [
  { title: "命令说明", stem: "00-help/help", href: "posts/00-help/help.html", tags: ["help", "meta", "说明"] },
  { title: "How to write", stem: "01-blog/01-how-to-write", href: "posts/01-blog/01-how-to-write.html", tags: ["guide", "meta"] },
];

test("parseLine: /tag replaces /goto", () => {
  assert.equal(parseLine("/help").kind, "help");
  assert.deepEqual(parseLine("/tag poe/ 乌鸦"), { kind: "tag", query: "poe/ 乌鸦" });
  assert.deepEqual(parseLine("tag #js"), { kind: "tag", query: "#js" });
  assert.deepEqual(parseLine("/tag"), { kind: "tag", query: null });
  assert.equal(parseLine("/goto x").kind, "echo");
  assert.deepEqual(parseLine("/about heart"), { kind: "about", query: "heart" });
  assert.equal(parseLine("/clear").kind, "clear");
  assert.equal(parseLine("clear").kind, "clear");
});

test("submit /tag → search action with encoded URL; errors are friendly", () => {
  const eng = createTermEngine({ posts });
  const r = eng.submit("/tag poe/ & (乌鸦 | 死亡)");
  assert.equal(r.type, "search");
  assert.equal(r.href, "search.html?q=" + encodeURIComponent("poe/ & (乌鸦 | 死亡)"));
  const bad = eng.submit("/tag (a | b");
  assert.equal(bad.type, "echo");
  assert.equal(bad.err, true);
  assert.match(bad.message, /col 1/);
  assert.equal(eng.submit("/tag").type, "echo");
  assert.equal(eng.submit("/goto foo").type, "echo");
});

test("/lost opens egg; unknown command echoes", () => {
  const eng = createTermEngine({ posts });
  const r = eng.submit("/lost");
  assert.equal(r.type, "navigate");
  assert.equal(r.post.href, EGG_HREF);
  assert.equal(eng.submit("/nope").type, "echo");
});

test("IME scrub helpers", () => {
  assert.equal(scrubInvisible("ｍｅｔａ"), "meta");
  assert.equal(normalizeTag("@Meta\u200b"), "meta");
  assert.equal(codepointsHex("meta\u200b"), "6d 65 74 61 200b");
  assert.equal(tagAtomMatches("meta", "me"), true);
  // zero-width junk inside a /tag expression is ignored
  const eng = createTermEngine({ posts });
  assert.equal(eng.submit("/tag me\u200bta").type, "search");
});

test("navigating lock + help", () => {
  const eng = createTermEngine({ posts });
  assert.equal(eng.submit("/help").post.stem, "00-help/help");
  assert.equal(eng.submit("/welcome").type, "echo");
  assert.equal(eng.beginNavigate(), true);
  assert.equal(eng.beginNavigate(), false);
  eng.resetNavigation();
  assert.equal(eng.beginNavigate(), true);
});

test("/theme parses and returns theme action", () => {
  const e = createTermEngine({ posts: [] });
  assert.deepEqual(e.submit("/theme paper"), { type: "theme", name: "paper" });
  assert.deepEqual(e.submit("/theme auto"), { type: "theme", name: "auto" });
  assert.equal(e.submit("/theme nope").type, "echo");
  assert.equal(e.submit("/theme").type, "echo");
});

test("/about needs a query", () => {
  const e = createTermEngine({ posts: [] });
  assert.equal(e.submit("/about").type, "echo");
  assert.deepEqual(e.submit("/about black cat"), { type: "about", query: "black cat" });
});
