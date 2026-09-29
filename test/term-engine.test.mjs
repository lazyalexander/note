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

test("parseLine: /find is the one command, /tag /about /grep are sugar", () => {
  assert.equal(parseLine("/help").kind, "help");
  assert.deepEqual(parseLine("/tag poe/ 乌鸦"), { kind: "find", cmd: "tag", arg: "poe/ 乌鸦", query: "poe/ 乌鸦" });
  assert.deepEqual(parseLine("tag #js"), { kind: "find", cmd: "tag", arg: "#js", query: "#js" });
  assert.deepEqual(parseLine("/tag"), { kind: "find", cmd: "tag", arg: "", query: "" });
  assert.equal(parseLine("/goto x").kind, "echo");
  assert.match(parseLine("/goto x").message, /\/find/);
  assert.deepEqual(parseLine("/about heart"), { kind: "find", cmd: "about", arg: "heart", query: "about:heart" });
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

const href = (q) => "search.html?q=" + encodeURIComponent(q);
test("sugar: /tag /about /grep rewrite to the canonical /find URL", () => {
  const eng = createTermEngine({ posts });
  const cases = [
    ["/find poe/ & about:x:top-2", "poe/ & about:x:top-2"],
    ["/tag meta", "tag:meta"], // a lone word that names a known tag becomes tag:
    ["/tag 说明", "tag:说明"],
    ["/tag js", "js"], // not a known tag here → old behaviour (text word) is kept
    ["/tag #meta | guide", "#meta | guide"],
    ["/tag poe/ 猫", "poe/ 猫"],
    ["/tag 心跳", "心跳"],
    ["/about dark", "about:dark"],
    ["/about dark:top-3", "about:dark:top-3"],
    ["/about 关于死亡的恐惧", "about:关于死亡的恐惧"],
    ["/about the raven:bottom-2", 'about:"the raven":bottom-2'],
    ['/about "the raven":bottom-2', 'about:"the raven":bottom-2'],
    ["/about dark:>0.5", "about:dark:>0.5"],
    ["/grep raven", "grep:raven"],
    ["/grep /rav.n/i", "grep:/rav.n/i"],
    ["/grep two words", 'grep:"two words"'],
  ];
  for (const [line, q] of cases) {
    const r = eng.submit(line);
    assert.equal(r.type, "search", line + " → " + JSON.stringify(r));
    assert.equal(r.query, q, line);
    assert.equal(r.href, href(q), line);
  }
  assert.equal(parseLine("/tag js").query, "tag:js"); // no tag list → assumed to be a tag
  // the sugar and the explicit form navigate to the very same URL
  assert.equal(eng.submit("/about dark:top-3").href, eng.submit("/find about:dark:top-3").href);
  assert.equal(eng.submit("/grep raven").href, eng.submit("/find grep:raven").href);
  assert.equal(eng.submit("/tag meta").href, eng.submit("/find tag:meta").href);
});

test("sugar errors point at the rewritten expression", () => {
  const eng = createTermEngine({ posts });
  const bad = eng.submit("/about dark:top-");
  assert.equal(bad.type, "echo");
  assert.match(bad.message, /bad selector/);
  assert.match(bad.message, /as \/find about:dark:top-/);
  for (const c of ["/find", "/about", "/grep", "/tag"]) assert.equal(eng.submit(c).type, "echo", c);
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

test("/about needs a query; multi-word queries get quoted", () => {
  const e = createTermEngine({ posts: [] });
  assert.equal(e.submit("/about").type, "echo");
  const r = e.submit("/about black cat");
  assert.equal(r.type, "search");
  assert.equal(r.query, 'about:"black cat"');
});
