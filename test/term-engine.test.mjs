import test from "node:test";
import assert from "node:assert/strict";
import {
  parseLine,
  parseTagExpr,
  filterPostsByTag,
  filterPostsByTitle,
  createTermEngine,
  TAG_EXPR_MAX,
} from "../src/term-engine.mjs";

const posts = [
  {
    title: "命令说明",
    stem: "00-help",
    href: "posts/00-help.html",
    tags: ["help", "meta"],
  },
  {
    title: "Welcome",
    stem: "01-welcome",
    href: "posts/01-welcome.html",
    tags: ["welcome", "meta"],
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

test("parseLine recognizes commands", () => {
  assert.equal(parseLine("/help").kind, "help");
  assert.equal(parseLine("welcome").kind, "welcome");
  assert.deepEqual(parseLine("/goto wel"), { kind: "goto", query: "wel" });
  assert.deepEqual(parseLine("/tag a&b"), { kind: "tag", query: "a&b" });
  assert.equal(parseLine("clear").kind, "clear");
});

test("nested tag expressions", () => {
  const tree = parseTagExpr("(meta&guide)||tui");
  assert.equal(tree.type, "||");
  const r = filterPostsByTag(posts, "(meta&guide)||tui");
  assert.equal(r.error, null);
  assert.deepEqual(
    r.posts.map((p) => p.stem).sort(),
    ["02-how-to-write", "03-tui-notes"].sort()
  );
});

test("tag expr rejects over max length", () => {
  const q = "a".repeat(TAG_EXPR_MAX + 1);
  const r = filterPostsByTag(posts, q);
  assert.ok(r.error);
  assert.equal(r.posts.length, 0);
});

test("goto title filter", () => {
  const hits = filterPostsByTitle(posts, "wel");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].stem, "01-welcome");
});

test("submit help/welcome navigate", () => {
  const eng = createTermEngine({ posts });
  assert.equal(eng.submit("/help").type, "navigate");
  assert.equal(eng.submit("/help").post.stem, "00-help");
  assert.equal(eng.submit("/welcome").post.stem, "01-welcome");
});

test("navigating lock blocks until reset (bfcache regression)", () => {
  const eng = createTermEngine({ posts });
  assert.equal(eng.beginNavigate(), true);
  assert.equal(eng.isNavigating(), true);
  assert.equal(eng.beginNavigate(), false);
  eng.resetNavigation();
  assert.equal(eng.isNavigating(), false);
  assert.equal(eng.beginNavigate(), true);
});

test("pageshow restore scenario", () => {
  const eng = createTermEngine({ posts });
  const nav = eng.submit("/welcome");
  assert.equal(nav.type, "navigate");
  assert.ok(eng.beginNavigate());
  // user hits Back — bfcache restores JS heap with navigating=true
  assert.equal(eng.beginNavigate(), false);
  // fix: pageshow handler
  eng.resetNavigation();
  const again = eng.submit("/help");
  assert.equal(again.type, "navigate");
  assert.ok(eng.beginNavigate());
});

test("goto miss opens egg page", () => {
  const eng = createTermEngine({ posts });
  const r = eng.submit("/goto definitely-not-a-post-xyz");
  assert.equal(r.type, "navigate");
  assert.equal(r.egg, true);
  assert.equal(r.post.href, "egg.html");
});

test("tag prefix match not mid-string", () => {
  const r = filterPostsByTag(posts, "eta");
  assert.equal(r.error, null);
  assert.equal(r.posts.length, 0);
  const m = filterPostsByTag(posts, "met");
  assert.ok(m.posts.length >= 1);
  assert.ok(m.posts.every((p) => p.tags.some((t) => t === "meta" || t.startsWith("met"))));
});

test("tag softens trailing operators while typing", () => {
  const r = filterPostsByTag(posts, "meta&");
  assert.equal(r.error, null);
  assert.ok(r.posts.length >= 1);
  assert.ok(r.posts.every((p) => p.tags.includes("meta")));
});
