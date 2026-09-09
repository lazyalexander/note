import test from "node:test";
import assert from "node:assert/strict";
import {
  parseLine,
  filterPostsByTag,
  filterPostsByTitle,
  createTermEngine,
  TAG_EXPR_MAX,
  tagAtomMatches,
  softenTagQuery,
  scrubInvisible,
  normalizeTag,
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

test("parseLine recognizes commands", () => {
  assert.equal(parseLine("/help").kind, "help");
  assert.equal(parseLine("welcome").kind, "welcome");
  assert.deepEqual(parseLine("/goto wel"), { kind: "goto", query: "wel" });
  assert.deepEqual(parseLine("/tag a&b"), { kind: "tag", query: "a&b" });
  assert.deepEqual(parseLine("/about heart"), { kind: "about", query: "heart" });
  assert.equal(parseLine("clear").kind, "clear");
});

test("nested tag expressions with prefix atoms", () => {
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
  assert.equal(eng.beginNavigate(), false);
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
  assert.equal(tagAtomMatches("meta", "eta"), false);
  assert.equal(tagAtomMatches("meta", "met"), true);
  const r = filterPostsByTag(posts, "eta");
  assert.equal(r.posts.length, 0);
  const m = filterPostsByTag(posts, "met");
  assert.ok(m.posts.length >= 1);
});

test("tag softens trailing operators while typing", () => {
  assert.equal(softenTagQuery("meta&"), "meta");
  const r = filterPostsByTag(posts, "meta&");
  assert.equal(r.error, null);
  assert.ok(r.posts.length >= 1);
  assert.ok(r.posts.every((p) => p.tags.includes("meta")));
});

test("chinese tag prefix", () => {
  const r = filterPostsByTag(posts, "欢");
  assert.equal(r.error, null);
  assert.equal(r.posts.length, 1);
  assert.equal(r.posts[0].stem, "01-welcome");
  const r2 = filterPostsByTag(posts, "说明");
  assert.equal(r2.posts[0].stem, "00-help");
  const eng = createTermEngine({ posts });
  const sub = eng.submit("/tag 欢迎");
  assert.equal(sub.type, "navigate");
  assert.equal(sub.post.stem, "01-welcome");
});


test("submit about returns async search action", () => {
  const eng = createTermEngine({ posts });
  assert.deepEqual(eng.submit("/about"), {
    type: "echo",
    message: "usage: /about <query>  (semantic full-text)",
    err: true,
  });
  assert.deepEqual(eng.submit("/about wine vault revenge"), {
    type: "about",
    query: "wine vault revenge",
  });
});


test("bare /tag does not dump all posts", () => {
  const eng = createTermEngine({ posts });
  const live = eng.suggest("/tag");
  assert.equal(live.parsed.kind, "tag");
  assert.equal(live.matches.length, 0);
  const enter = eng.submit("/tag");
  assert.equal(enter.type, "echo");
  assert.ok(String(enter.message).includes("usage"));
});


test("scrubInvisible strips ZWSP and NFKC fullwidth", () => {
  assert.equal(scrubInvisible("meta\u200b"), "meta");
  assert.equal(scrubInvisible("\ufeffmeta\u200b"), "meta");
  assert.equal(scrubInvisible("ｍｅｔａ"), "meta"); // fullwidth via NFKC
  assert.equal(normalizeTag("@Meta\u200b"), "meta");
});

test("tag match survives IME invisible chars (me vs meta)", () => {
  // Reproduce: trailing ZWSP / BOM / ZWNJ often inserted by CJK IME on commit.
  const dirtyMeta = [
    "meta\u200b",
    "meta\u200c",
    "meta\u200d",
    "\ufeffmeta",
    "meta\ufeff",
    "me\u200bta",
    "ｍｅｔａ",
    "meta\u00ad", // soft hyphen
    "/tag meta\u200b",
  ];

  for (const q of dirtyMeta) {
    const query = q.startsWith("/tag") ? parseLine(q).query : q;
    const r = filterPostsByTag(posts, query);
    assert.equal(
      r.posts.length,
      3,
      `expected 3 hits for ${JSON.stringify(q)} codepoints=${[...String(query)].map((c) => c.codePointAt(0).toString(16))}`
    );
    assert.ok(r.posts.every((p) => p.tags.includes("meta")));
  }

  // Prefix with junk still matches while typing
  const rMe = filterPostsByTag(posts, "me\u200b");
  assert.equal(rMe.posts.length, 3);

  assert.equal(tagAtomMatches("meta", "meta\u200b"), true);
  assert.equal(tagAtomMatches("meta", "ｍｅｔａ"), true);
});

test("createTermEngine suggest /tag meta with ZWSP is not no-match", () => {
  const eng = createTermEngine({ posts });
  const live = eng.suggest("/tag meta\u200b");
  assert.equal(live.parsed.kind, "tag");
  assert.equal(live.matches.length, 3);
  assert.equal(live.error, null);

  const liveMe = eng.suggest("/tag me\u200b");
  assert.equal(liveMe.matches.length, 3);
});
