import test from "node:test";
import assert from "node:assert/strict";
import {
  parseLine,
  filterPostsForGoto,
  createTermEngine,
  tagAtomMatches,
  scrubInvisible,
  normalizeTag,
  codepointsHex,
  EGG_HREF,
} from "../src/term-engine.mjs";

const posts = [
  {
    title: "命令说明",
    stem: "00-help",
    href: "posts/00-help.html",
    tags: ["help", "meta", "说明"],
  },
  {
    title: "Welcome",
    stem: "01-welcome",
    href: "posts/01-welcome.html",
    tags: ["welcome", "meta", "欢迎"],
  },
  {
    title: "How to write",
    stem: "02-how-to-write",
    href: "posts/02-how-to-write.html",
    tags: ["guide", "meta"],
  },
  {
    title: "TUI Notes",
    stem: "03-tui-notes",
    href: "posts/03-tui-notes.html",
    tags: ["tui", "design"],
  },
];

test("parseLine has goto but not tag command", () => {
  assert.equal(parseLine("/help").kind, "help");
  assert.deepEqual(parseLine("/goto wel"), { kind: "goto", query: "wel" });
  assert.deepEqual(parseLine("/about heart"), { kind: "about", query: "heart" });
  assert.equal(parseLine("/tag meta").kind, "echo");
  assert.equal(parseLine("clear").kind, "clear");
});

test("/goto matches title stem or tag (meta)", () => {
  const hits = filterPostsForGoto(posts, "meta");
  assert.equal(hits.length, 3);
  assert.ok(hits.every((p) => p.tags.includes("meta")));
  const wel = filterPostsForGoto(posts, "wel");
  assert.equal(wel.length, 1);
  assert.equal(wel[0].stem, "01-welcome");
});

test("/goto empty query lists nothing", () => {
  assert.deepEqual(filterPostsForGoto(posts, ""), []);
  assert.deepEqual(filterPostsForGoto(posts, "   "), []);
});

test("submit /goto miss opens egg", () => {
  const eng = createTermEngine({ posts });
  const r = eng.submit("/goto definitely-not-a-post-xyz");
  assert.equal(r.type, "navigate");
  assert.equal(r.egg, true);
  assert.equal(r.post.href, EGG_HREF);
});

test("submit /goto meta navigates to a meta post", () => {
  const eng = createTermEngine({ posts });
  const live = eng.suggest("/goto meta");
  assert.equal(live.matches.length, 3);
  const r = eng.submit("/goto meta", 0);
  assert.equal(r.type, "navigate");
  assert.ok(r.post.tags.includes("meta"));
});

test("IME scrub still applied for goto", () => {
  const hits = filterPostsForGoto(posts, "meta\u200b");
  assert.equal(hits.length, 3);
  assert.equal(scrubInvisible("ｍｅｔａ"), "meta");
  assert.equal(normalizeTag("@Meta\u200b"), "meta");
  assert.equal(codepointsHex("meta\u200b"), "6d 65 74 61 200b");
  assert.equal(tagAtomMatches("meta", "me"), true);
});

test("navigating lock + help/welcome", () => {
  const eng = createTermEngine({ posts });
  assert.equal(eng.submit("/help").post.stem, "00-help");
  assert.equal(eng.submit("/welcome").post.stem, "01-welcome");
  assert.equal(eng.beginNavigate(), true);
  assert.equal(eng.beginNavigate(), false);
  eng.resetNavigation();
  assert.equal(eng.beginNavigate(), true);
});

test("chinese tag via goto", () => {
  const hits = filterPostsForGoto(posts, "欢");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].stem, "01-welcome");
});
