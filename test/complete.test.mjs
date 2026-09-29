import test from "node:test";
import assert from "node:assert/strict";
import { complete, currentTagToken } from "../src/complete.mjs";

const ctx = {
  series: [
    { dir: "00-help", no: "00", slug: "help", title: "使用说明", count: 1 },
    { dir: "01-blog", no: "01", slug: "blog", title: "关于本站", count: 2 },
    { dir: "02-poe", no: "02", slug: "poe", title: "爱伦·坡", count: 3 },
  ],
  tags: ["fiction", "help", "js", "poe", "恐怖"],
  posts: [{ title: "The Raven", dir: "02-poe", stem: "02-poe/1" }, { title: "The Tell-Tale Heart", dir: "02-poe", stem: "02-poe/2" }],
  history: ["/tag poe/ raven", "/theme paper"],
};
const texts = (l) => complete(l, ctx).items.map((i) => i.text);

test("command names complete with ghost text", () => {
  const r = complete("/ta", ctx);
  assert.equal(r.items[0].text, "/tag ");
  assert.equal(r.ghost, "g ");
  assert.equal(r.auto, 0);
  assert.equal(complete("/", ctx).items.length >= 5, true);
  assert.equal(complete("/ab", ctx).ghost, "out ");
});

test("empty line offers all commands, no ghost", () => {
  const r = complete("", ctx);
  assert.ok(r.items.some((i) => i.text === "/tag "));
  assert.equal(r.ghost, "");
});

test("/tag: folders by slug, number, title", () => {
  assert.equal(complete("/tag po", ctx).ghost, "e/");
  assert.ok(texts("/tag 0").includes("/tag 02-poe/"));
  assert.ok(texts("/tag 爱").includes("/tag 爱伦·坡/"));
  assert.ok(texts("/tag ").includes("/tag help/"));
});

test("/tag: tags after # and priority folder > tag > title", () => {
  assert.equal(complete("/tag #f", ctx).ghost, "iction");
  const t = texts("/tag po");
  assert.ok(t.indexOf("/tag poe/") < t.indexOf("/tag #poe"));
  assert.equal(complete("/tag #", ctx).items[0].kind, "tag");
});

test("/tag: post titles and quoted phrases", () => {
  assert.ok(texts("/tag the").includes('/tag "The Raven"'));
  assert.ok(texts('/tag "the ra').includes('/tag "The Raven"'));
  assert.ok(texts("/tag raven | The").includes('/tag raven | "The Raven"'));
});

test("/tag: works after operators and parens", () => {
  assert.ok(texts("/tag poe/ & (#fi").includes("/tag poe/ & (#fiction"));
  assert.ok(texts("/tag poe/ & !#f").includes("/tag poe/ & !#fiction"));
  assert.equal(currentTagToken("poe/ & (!#f").tok, "#f");
  assert.equal(currentTagToken("poe/ & (!#f").prefix, "!");
});

test("/theme names", () => {
  assert.equal(texts("/theme p")[0], "/theme paper");
  assert.equal(complete("/theme p", ctx).items[0].exec, true);
  assert.equal(complete("/theme in", ctx).ghost, "k");
});

test("history is last and prefix-matched", () => {
  const r = complete("/tag poe/ r", ctx);
  assert.equal(r.items[r.items.length - 1].kind, "hist");
  assert.equal(r.ghost, "aven");
  const h = complete("/tag poe/ ", ctx);
  assert.ok(h.items.some((i) => i.kind === "hist" && i.text === "/tag poe/ raven"));
});

test("no ghost on a trailing space or an exact match", () => {
  const c = { ...ctx, history: [] };
  assert.equal(complete("/tag ", c).ghost, "");
  assert.equal(complete("/tag poe/", c).ghost, "");
  assert.equal(complete("/tag poe/", ctx).ghost, " raven"); // ...except when history continues it
});

test("/find is the primary command; /tag /about /grep are listed as aliases", () => {
  const names = complete("/", ctx).items.map((i) => i.text);
  assert.equal(names[0], "/find ");
  for (const n of ["/tag ", "/about ", "/grep ", "/theme ", "/help "]) assert.ok(names.includes(n) || n === "/help ", n);
  assert.equal(complete("/fi", ctx).ghost, "nd ");
  assert.equal(complete("/gr", ctx).ghost, "ep ");
  assert.match(complete("/ta", ctx).items[0].hint, /find/);
});

test("/find: term prefixes tag: grep: about: title: body:", () => {
  assert.ok(texts("/find ta").includes("/find tag:"));
  assert.ok(texts("/find gr").includes("/find grep:"));
  assert.equal(complete("/find ab", ctx).ghost, "out:");
  assert.ok(texts("/find ti").includes("/find title:"));
  assert.ok(texts("/find poe/ & bo").includes("/find poe/ & body:"));
  assert.ok(texts("/find !ab").includes("/find !about:"));
  assert.equal(complete("/find ta", ctx).items.find((i) => i.text === "/find tag:").exec, false);
});

test("/find: tag: values and folder: values", () => {
  assert.ok(texts("/find tag:j").includes("/find tag:js"));
  assert.ok(texts("/find tag:").includes("/find tag:poe"));
  assert.ok(texts("/find folder:p").includes("/find folder:poe"));
  assert.ok(texts("/find title:the").includes('/find title:"The Raven"'));
});

test("/find: selectors after about:x: (top-N / bottom-N / threshold)", () => {
  assert.equal(complete("/find about:dark:t", ctx).ghost, "op-1");
  assert.deepEqual(texts("/find about:dark:top-").sort(), ["/find about:dark:top-1", "/find about:dark:top-3", "/find about:dark:top-5"].sort());
  assert.ok(texts("/find about:dark:b").includes("/find about:dark:bottom-2"));
  assert.ok(texts('/find about:"the raven":t').includes('/find about:"the raven":top-3'));
  assert.ok(texts("/find poe/ & about:死亡:").includes("/find poe/ & about:死亡:top-3"));
  assert.ok(texts("/about dark:t").includes("/about dark:top-3"));
  // a complete selector runs on Enter, a partial one only fills in
  const items = complete("/find about:dark:", ctx).items;
  assert.equal(items.find((i) => i.text.endsWith("top-3")).exec, true);
  assert.equal(items.find((i) => i.text.endsWith("top-")).exec, false);
});

test("/find: folders, tags, titles and history still complete like /tag", () => {
  assert.ok(texts("/find po").includes("/find poe/"));
  assert.ok(texts("/find #f").includes("/find #fiction"));
  assert.ok(texts("/find the").includes('/find "The Raven"'));
  const c = { ...ctx, history: ["/find about:dark:top-3"] };
  assert.equal(complete("/find about:d", c).items.some((i) => i.kind === "hist"), true);
});
