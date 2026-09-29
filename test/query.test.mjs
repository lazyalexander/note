import test from "node:test";
import assert from "node:assert/strict";
import {
  parseQuery, searchDocs, searchDocsAsync, formatQueryError, makeSnippet, highlightParts, findMatches, collectTerms,
  computeAboutSets, hasAbout, aboutQueries, makeResultView, grepMatchLines,
} from "../src/query.mjs";

const docs = [
  { stem: "00-help/help", dir: "00-help", seriesNo: "00", seriesTitle: "使用说明", title: "命令说明", tags: ["help", "meta", "说明"], body: "在顶部命令栏输入命令。/tag 搜索 乌鸦 与 死亡。" },
  { stem: "01-blog/a", dir: "01-blog", seriesNo: "01", seriesTitle: "关于本站", title: "How to write", tags: ["guide", "meta", "js"], body: "Write posts in markdown. Use JS for fun. The Raven is elsewhere." },
  { stem: "01-blog/b", dir: "01-blog", seriesNo: "01", seriesTitle: "关于本站", title: "TUI Notes", tags: ["tui", "draft"], body: "A tiny static blog with terminal vibes. 死亡 of the mouse." },
  { stem: "02-poe/1", dir: "02-poe", seriesNo: "02", seriesTitle: "爱伦·坡", title: "The Raven", tags: ["poe", "poem"], body: "Once upon a midnight dreary, the raven said \"Nevermore\". 乌鸦 说:永不复还。 死亡" },
  { stem: "02-poe/2", dir: "02-poe", seriesNo: "02", seriesTitle: "爱伦·坡", title: "The Black Cat", tags: ["poe", "draft"], body: "I was mad; the cat, the gallows. rav-en. ravon" },
  { stem: "02-poe/3", dir: "02-poe", seriesNo: "02", seriesTitle: "爱伦·坡", title: "Cask", tags: ["poe"], body: "For the love of God, Montresor! 酒窖 the raven? no." },
];
const stems = (expr) => {
  const r = searchDocs(docs, expr);
  assert.ok(r.ok, expr + " → " + JSON.stringify(r.error));
  return r.results.map((d) => d.stem);
};

test("bare word matches title and body, case-insensitive", () => {
  assert.deepEqual(stems("raven"), ["01-blog/a", "02-poe/1", "02-poe/3"]);
  assert.deepEqual(stems("RAVEN"), ["01-blog/a", "02-poe/1", "02-poe/3"]);
  assert.deepEqual(stems("tui"), ["01-blog/b"]);
});

test("Chinese substring", () => {
  assert.deepEqual(stems("乌鸦"), ["00-help/help", "02-poe/1"]);
  assert.deepEqual(stems("死"), ["00-help/help", "01-blog/b", "02-poe/1"]);
});

test("quoted phrase", () => {
  assert.deepEqual(stems('"the raven"'), ["01-blog/a", "02-poe/1", "02-poe/3"]);
  assert.deepEqual(stems('"a midnight"'), ["02-poe/1"]);
  assert.deepEqual(stems('"midnight  dreary"'), []);
  assert.deepEqual(stems('"say \\"x\\""'), []);
  assert.deepEqual(stems('"Nevermore"'), ["02-poe/1"]);
});

test("regex with optional flags", () => {
  assert.deepEqual(stems("/rav.n/"), ["02-poe/1", "02-poe/2", "02-poe/3"]); // case-sensitive: no "Raven" in 01-blog/a
  assert.deepEqual(stems("/RAV.N/i"), ["01-blog/a", "02-poe/1", "02-poe/2", "02-poe/3"]);
  assert.deepEqual(stems("/^the black/i"), ["02-poe/2"]); // title match
  assert.deepEqual(stems("/rav[o-z]n/"), ["02-poe/2"]);
  assert.deepEqual(stems("/a\\/b/"), []);
  assert.deepEqual(stems("/rav.n/ & poe/"), ["02-poe/1", "02-poe/2", "02-poe/3"]);
});

test("folder scope by slug fragment, number, dir and title", () => {
  assert.deepEqual(stems("poe/"), ["02-poe/1", "02-poe/2", "02-poe/3"]);
  assert.deepEqual(stems("02/"), ["02-poe/1", "02-poe/2", "02-poe/3"]);
  assert.deepEqual(stems("2/"), ["02-poe/1", "02-poe/2", "02-poe/3"]);
  assert.deepEqual(stems("02-poe/"), ["02-poe/1", "02-poe/2", "02-poe/3"]);
  assert.deepEqual(stems("爱伦/"), ["02-poe/1", "02-poe/2", "02-poe/3"]);
  assert.deepEqual(stems("blo/"), ["01-blog/a", "01-blog/b"]);
  assert.deepEqual(stems("folder:blog"), ["01-blog/a", "01-blog/b"]);
  assert.deepEqual(stems("nosuch/"), []);
});

test("#tag (exact, case-insensitive) and tag:", () => {
  assert.deepEqual(stems("#js"), ["01-blog/a"]);
  assert.deepEqual(stems("#JS"), ["01-blog/a"]);
  assert.deepEqual(stems("#draft"), ["01-blog/b", "02-poe/2"]);
  assert.deepEqual(stems("tag:meta"), ["00-help/help", "01-blog/a"]);
  assert.deepEqual(stems("#说明"), ["00-help/help"]);
  assert.deepEqual(stems("#j"), []); // exact, not prefix
});

test("field qualifiers", () => {
  assert.deepEqual(stems("title:raven"), ["02-poe/1"]);
  assert.deepEqual(stems("body:raven"), ["01-blog/a", "02-poe/1", "02-poe/3"]);
  assert.deepEqual(stems("title:cat"), ["02-poe/2"]);
  assert.deepEqual(stems('body:"midnight dreary"'), ["02-poe/1"]);
  assert.deepEqual(stems("title:/^tui/i"), ["01-blog/b"]);
});

test("operators: & | ! and precedence", () => {
  assert.deepEqual(stems("raven & poe/"), ["02-poe/1", "02-poe/3"]);
  assert.deepEqual(stems("乌鸦 | 酒窖"), ["00-help/help", "02-poe/1", "02-poe/3"]);
  assert.deepEqual(stems("poe/ & !#draft"), ["02-poe/1", "02-poe/3"]);
  assert.deepEqual(stems("!#draft").length, 4);
  assert.deepEqual(stems("!!#draft"), ["01-blog/b", "02-poe/2"]);
  // ! > & > | :   a | b & c  ==  a | (b & c)
  assert.deepEqual(stems("tui | poe/ & raven"), ["01-blog/b", "02-poe/1", "02-poe/3"]);
  assert.deepEqual(stems("(tui | poe/) & raven"), ["02-poe/1", "02-poe/3"]);
  assert.deepEqual(stems("poe/ & (乌鸦 | 死亡) & !#draft"), ["02-poe/1"]);
  assert.deepEqual(stems("!poe/ & !blog/"), ["00-help/help"]);
});

test("whitespace is implicit &", () => {
  assert.deepEqual(stems("poe/ 乌鸦"), stems("poe/ & 乌鸦"));
  assert.deepEqual(stems("poe/ 乌鸦"), ["02-poe/1"]);
  assert.deepEqual(stems("poe/ !#draft raven"), ["02-poe/1", "02-poe/3"]);
  assert.deepEqual(stems("poe/ (乌鸦 | cat)"), ["02-poe/1", "02-poe/2"]);
  // implicit & binds tighter than |
  assert.deepEqual(stems("tui poe/ | 酒窖"), ["02-poe/3"]);
});

test("full-width operators from a Chinese IME", () => {
  assert.deepEqual(stems("poe/ ＆ （乌鸦 ｜ 酒窖）"), ["02-poe/1", "02-poe/3"]);
  assert.deepEqual(stems("poe/ ！#draft"), ["02-poe/1", "02-poe/3"]);
});

test("invisible IME junk is ignored", () => {
  assert.deepEqual(stems("po\u200be/"), ["02-poe/1", "02-poe/2", "02-poe/3"]);
});

test("empty expression → ok, empty", () => {
  const r = searchDocs(docs, "   ");
  assert.equal(r.ok, true);
  assert.equal(r.empty, true);
  assert.deepEqual(r.results, []);
});

const bad = [
  ["(a | b", "missing ')'", 0],
  ["a | b)", "unexpected ')'", 5],
  ["a &", "expected a term after '&'", 2],
  ["| a", "expected a term before '|'", 0],
  ["a |", "expected a term after '|'", 2],
  ["!", "expected a term after '!'", 0],
  ['"abc', "unterminated quote", 0],
  ["/abc", "unterminated regex", 0],
  ["/(/", "invalid regex", 0],
  ["/a/x", "unsupported regex flag", 3],
  ["()", "empty parentheses", 0],
  ["#", "empty tag", 0],
  ["title:", "expected a value after", 0],
  ["tag:/x/", "regex is not supported", 0],
  ['""', "empty quoted phrase", 0],
];
for (const [expr, msg, pos] of bad) {
  test("syntax error: " + JSON.stringify(expr), () => {
    const r = parseQuery(expr);
    assert.equal(r.ok, false);
    assert.ok(r.error.message.includes(msg), r.error.message);
    assert.equal(r.error.pos, pos);
    const text = formatQueryError(expr, r.error);
    assert.match(text, /syntax error: /);
    assert.match(text, /\^/);
    assert.deepEqual(searchDocs(docs, expr).results, []);
  });
}

test("error caret accounts for double-width CJK", () => {
  const e = parseQuery("乌鸦 (x");
  assert.equal(e.ok, false);
  const lines = formatQueryError("乌鸦 (x", e.error).split("\n");
  assert.equal(lines[2].indexOf("^"), 2 + 5); // 2 indent + "乌鸦 " = 5 columns
});

test("brute-force cross-check on random expressions", () => {
  // independent naive evaluator over a small term set
  const atoms = [
    ["raven", (d) => (d.title + " " + d.body).toLowerCase().includes("raven")],
    ["乌鸦", (d) => (d.title + " " + d.body).includes("乌鸦")],
    ["poe/", (d) => d.dir.includes("poe")],
    ["#draft", (d) => d.tags.includes("draft")],
    ["title:the", (d) => d.title.toLowerCase().includes("the")],
    ["死亡", (d) => (d.title + " " + d.body).includes("死亡")],
  ];
  let seed = 12345;
  const rnd = (n) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), seed % n);
  function gen(depth) {
    if (depth === 0 || rnd(3) === 0) { const a = atoms[rnd(atoms.length)]; return { s: a[0], f: a[1] }; }
    const k = rnd(4);
    if (k === 0) { const x = gen(depth - 1); return { s: "!" + wrap(x), f: (d) => !x.f(d) }; }
    const x = gen(depth - 1), y = gen(depth - 1);
    if (k === 1) return { s: wrap(x) + " & " + wrap(y), f: (d) => x.f(d) && y.f(d) };
    if (k === 2) return { s: wrap(x) + " | " + wrap(y), f: (d) => x.f(d) || y.f(d) };
    return { s: wrap(x) + " " + wrap(y), f: (d) => x.f(d) && y.f(d) };
  }
  const wrap = (x) => "(" + x.s + ")";
  for (let i = 0; i < 300; i++) {
    const g = gen(3);
    const got = stems(g.s);
    const want = docs.filter(g.f).map((d) => d.stem);
    assert.deepEqual(got, want, g.s);
  }
});

test("snippets and highlights", () => {
  const r = searchDocs(docs, "raven & poe/");
  const d = r.results.find((x) => x.stem === "02-poe/1");
  const s = makeSnippet(d, r.terms);
  assert.equal(s.matched, true);
  const joined = s.parts.map((p) => p.text).join("");
  assert.ok(/raven/i.test(joined));
  assert.ok(s.parts.some((p) => p.hit && /^raven$/i.test(p.text)));
  // Chinese hit
  const c = searchDocs(docs, "乌鸦");
  const cs = makeSnippet(c.results[0], c.terms);
  assert.ok(cs.parts.some((p) => p.hit && p.text === "乌鸦"));
  // title-only hit falls back to the start of the body, no highlight
  const t = searchDocs(docs, "title:cat");
  const ts = makeSnippet(t.results[0], t.terms);
  assert.equal(ts.matched, false);
  assert.ok(ts.parts[0].text.startsWith("I was mad"));
  // negated terms are not highlighted
  const n = searchDocs(docs, "poe/ & !cat");
  assert.deepEqual(collectTerms(n.ast).map((x) => x.value), []);
  assert.deepEqual(highlightParts("The Raven", r.terms, "title").filter((p) => p.hit).map((p) => p.text), ["Raven"]);
  assert.deepEqual(findMatches("aXbxc", [{ kind: "word", field: "any", value: "x" }]), [[1, 2], [3, 4]]);
});

// ======================================================================= find: tag: grep: about:

test("tag: is the same as #tag", () => {
  assert.deepEqual(stems("tag:js"), stems("#js"));
  assert.deepEqual(stems("tag:draft"), ["01-blog/b", "02-poe/2"]);
  assert.deepEqual(stems("poe/ & !tag:draft"), ["02-poe/1", "02-poe/3"]);
});

// --- docs with `lines` (what search-index.json ships) for grep tests
const ldocs = [
  { stem: "a", dir: "01-x", seriesNo: "01", seriesTitle: "X", title: "Alpha", tags: [], lines: ["first line", "The Raven speaks", "third Line here", "RAVEN again & again"] },
  { stem: "b", dir: "02-poe", seriesNo: "02", seriesTitle: "Poe", title: "Raven Beta", tags: ["poe"], lines: ["nothing here", "raven? no. rav-en"] },
  { stem: "c", dir: "02-poe", seriesNo: "02", seriesTitle: "Poe", title: "Gamma", tags: [], lines: ["only ravon", "x"] },
];
const gstems = (e) => { const r = searchDocs(ldocs, e); assert.ok(r.ok, e); return r.results.map((d) => d.stem); };

test("grep: literal, phrase, regex; case-insensitive; matches title and body lines", () => {
  assert.deepEqual(gstems("grep:raven"), ["a", "b"]);
  assert.deepEqual(gstems("grep:RAVEN"), ["a", "b"]);
  assert.deepEqual(gstems('grep:"third line"'), ["a"]);
  assert.deepEqual(gstems("grep:/rav.n/"), ["a", "b", "c"]); // regex: case-insensitive by default too
  assert.deepEqual(gstems("grep:/^the raven/"), ["a"]);
  assert.deepEqual(gstems("grep:/rav.n/i"), ["a", "b", "c"]);
  assert.deepEqual(gstems("grep:/rav[o]n/"), ["c"]);
  assert.deepEqual(gstems("grep:gamma"), ["c"]); // title
  assert.deepEqual(gstems("grep:a.b"), []); // literal, "." is not a wildcard
  assert.deepEqual(gstems("grep:rav-en"), ["b"]);
  assert.deepEqual(gstems("grep:/again & again/"), ["a"]); // operators inside /…/ are regex text
});

test("grep: is line-oriented (a regex never spans two lines) and composes with & | !", () => {
  assert.deepEqual(gstems("grep:/first line.*The Raven/"), []);
  assert.deepEqual(gstems("grep:raven & !grep:again"), ["b"]);
  assert.deepEqual(gstems("grep:raven & poe/"), ["b"]);
  assert.deepEqual(gstems("grep:ravon | grep:third"), ["a", "c"]);
  assert.deepEqual(gstems("!grep:raven"), ["c"]);
  assert.deepEqual(gstems("(grep:raven | grep:ravon) !poe/"), ["a"]);
});

test("grep: matching lines carry line numbers (0 = title); negated grep contributes none", () => {
  const r = searchDocs(ldocs, "grep:raven");
  assert.deepEqual(r.info.get("a").lines, [{ n: 2, text: "The Raven speaks" }, { n: 4, text: "RAVEN again & again" }]);
  assert.deepEqual(r.info.get("b").lines.map((l) => l.n), [0, 2]);
  const n = searchDocs(ldocs, "poe/ & !grep:raven");
  assert.deepEqual(n.results.map((d) => d.stem), ["c"]);
  assert.deepEqual(n.info.get("c").lines, []);
  assert.deepEqual(grepMatchLines(ldocs[0], r.grepTerms[0]).length, 2);
  const v = makeResultView(ldocs[0], r.info.get("a"), r.terms);
  assert.equal(v.kind, "grep");
  assert.deepEqual(v.lines.map((l) => l.n), [2, 4]);
  assert.ok(v.lines[0].parts.some((p) => p.hit && /raven/i.test(p.text)));
});

test("grep: also works on docs that only have a `body` (split on newlines)", () => {
  const r = searchDocs([{ stem: "z", title: "t", tags: [], dir: "d", body: "one\ntwo raven\nthree" }], "grep:raven");
  assert.deepEqual(r.info.get("z").lines, [{ n: 2, text: "two raven" }]);
});

test("other terms work on docs with `lines` (body = lines joined)", () => {
  assert.deepEqual(gstems("third"), ["a"]);
  assert.deepEqual(gstems("body:speaks"), ["a"]);
  assert.deepEqual(gstems("/RAVEN again/"), ["a"]);
});

// --- about: parsing
const aboutNode = (e) => { const r = parseQuery(e); assert.ok(r.ok, e + " " + JSON.stringify(r.error)); return r.ast; };
test("about: parse — bare word, phrase, CJK, selectors", () => {
  let n = aboutNode("about:dark");
  assert.deepEqual([n.kind, n.value, n.sel], ["about", "dark", null]);
  n = aboutNode("about:dark:top-3");
  assert.deepEqual([n.value, n.sel], ["dark", { mode: "top", n: 3 }]);
  n = aboutNode('about:"the raven":bottom-2');
  assert.deepEqual([n.value, n.sel], ["the raven", { mode: "bottom", n: 2 }]);
  n = aboutNode('about:"关于死亡的恐惧"');
  assert.deepEqual([n.value, n.sel], ["关于死亡的恐惧", null]);
  n = aboutNode("about:死亡:top-2");
  assert.deepEqual([n.value, n.sel], ["死亡", { mode: "top", n: 2 }]);
  n = aboutNode("about:dark:>0.5");
  assert.deepEqual(n.sel, { mode: "gt", min: 0.5, inclusive: false });
  n = aboutNode("about:dark:>=0.75");
  assert.deepEqual(n.sel, { mode: "gt", min: 0.75, inclusive: true });
  n = aboutNode("ABOUT:Dark:TOP-3");
  assert.deepEqual([n.value, n.sel], ["Dark", { mode: "top", n: 3 }]);
  n = aboutNode("about：死亡：top-2"); // full-width colons from a Chinese IME
  assert.deepEqual([n.value, n.sel], ["死亡", { mode: "top", n: 2 }]);
  // colon inside a word that is not a selector stays part of the query
  n = aboutNode("about:a:b");
  assert.deepEqual([n.value, n.sel], ["a:b", null]);
  n = aboutNode("about:top-3"); // a word is not mistaken for a selector when it is the whole query
  assert.deepEqual([n.value, n.sel], ["top-3", null]);
  // positions
  const r = parseQuery("poe/ about:x:top-2");
  assert.equal(r.ast.args[1].pos, 5);
  assert.equal(r.ast.args[1].len, 13);
});

test("about: composes structurally like any term", () => {
  const r = parseQuery("poe/ & (about:a:top-3 | !about:b:bottom-1) grep:x");
  assert.ok(r.ok);
  assert.equal(hasAbout(r.ast), true);
  assert.deepEqual(aboutQueries(r.ast), ["a", "b"]);
  assert.equal(hasAbout(parseQuery("poe/ raven").ast), false);
});

const badAbout = [
  ["about:x:top-", "bad selector", 8],
  ["about:x:top-0", "at least 1", 8],
  ["about:x:top-abc", "whole number", 8],
  ["about:x:top-1.5", "whole number", 8],
  ["about:x:top--2", "whole number", 8],
  ["about:x:bottom-", "bad selector", 8],
  ["about:x:bottom-0", "at least 1", 8],
  ["about:x:top-99999", "at most", 8],
  ["about:x:>", "bad selector", 8],
  ["about:x:>abc", "bad selector", 8],
  ["about:x:>1.5", "between 0 and 1", 8],
  ["about:x:top", "bad selector", 8],
  ["about:x:", "bad selector", 8],
  ['about:"the raven":top-', "bad selector", 18],
  ['about:"the raven":oops', "expected top-N", 18],
  ["poe/ & about:", "expected a value after", 7],
  ["about:", "expected a value after", 0],
  ["about::top-3", 'expected a query after "about:"', 0],
  ['about:"unterminated', "unterminated quote", 6],
  ['about:""', "empty quoted phrase", 6],
  ["about:/re/", "regex is not supported with about:", 0],
  ["grep:", "expected a value after", 0],
  ["grep:/(/", "invalid regex", 5],
  ["grep:/x/q", "unsupported regex flag", 8],
  ['grep:"abc', "unterminated quote", 5],
];
for (const [expr, msg, pos] of badAbout) {
  test("find syntax error: " + JSON.stringify(expr), () => {
    const r = parseQuery(expr);
    assert.equal(r.ok, false, expr);
    assert.ok(r.error.message.includes(msg), r.error.message);
    assert.equal(r.error.pos, pos, expr + " → " + r.error.message);
    assert.match(formatQueryError(expr, r.error), /\^/);
  });
}

// --- about: evaluation with a fake provider
// scores: stem → similarity for query "q1", "q2"...
const SC = {
  "00-help/help": { s1: 0.60, s2: 0.20 },
  "01-blog/a": { s1: 0.70, s2: 0.30 },
  "01-blog/b": { s1: 0.50, s2: 0.90 },
  "02-poe/1": { s1: 0.95, s2: 0.10 },
  "02-poe/2": { s1: 0.90, s2: 0.85 },
  "02-poe/3": { s1: 0.40, s2: 0.80 },
};
const fake = async (q) => new Map(docs.map((d) => [d.stem, { score: SC[d.stem][q] ?? 0, passage: "passage of " + d.stem + " for " + q }]));
const asyncStems = async (expr, opts = {}) => {
  const r = await searchDocsAsync(docs, expr, { scoreAbout: fake, ...opts });
  assert.ok(r.ok, expr + JSON.stringify(r.error));
  return r;
};
const S = async (expr) => (await asyncStems(expr)).results.map((d) => d.stem);

test("about: top-N / bottom-N are exact set sizes and ordered by similarity", async () => {
  assert.deepEqual(await S("about:s1:top-3"), ["02-poe/1", "02-poe/2", "01-blog/a"]);
  assert.deepEqual(await S("about:s1:top-1"), ["02-poe/1"]);
  assert.equal((await S("about:s1:top-99")).length, docs.length); // min(N, corpus)
  assert.deepEqual(await S("about:s1:bottom-2"), ["01-blog/b", "02-poe/3"]); // the 2 least similar, best-first
  assert.equal((await S("about:s1:bottom-99")).length, docs.length);
  assert.deepEqual(await S("about:s1:>0.65"), ["02-poe/1", "02-poe/2", "01-blog/a"]);
  assert.deepEqual(await S("about:s1:>=0.6"), ["02-poe/1", "02-poe/2", "01-blog/a", "00-help/help"]);
});

test("about: no selector → adaptive default (pure dynamicCount on this query's scores)", async () => {
  const r = await asyncStems("about:s2");
  // s2 scores: .9 .85 .8 .3 .2 .1 → two clear outliers? cut is z-based, bounded to [1, ceil(6/2)=3]
  assert.ok(r.results.length >= 1 && r.results.length <= 3);
  assert.equal(r.results[0].stem, "01-blog/b");
  assert.deepEqual(r.aboutReport[0], { query: "s2", sel: null, candidates: 6, picked: r.results.length, auto: true });
});

test("about: composition with & | ! and folder scopes (scope rule: selector runs among the AND-ed literal scope)", async () => {
  // poe/ scope: top-2 among poe posts only (1: .95, 2: .90) — NOT top-2 over the corpus then intersect (would be the same here…)
  assert.deepEqual(await S("poe/ & about:s2:top-2"), ["02-poe/2", "02-poe/3"]); // s2 within poe: 2 (.85), 3 (.80)
  // the whole-corpus top-2 for s2 is blog/b (.9) and poe/2 (.85); intersect poe/ would give only poe/2 — scoped gives 2 hits
  assert.deepEqual(await S("about:s2:top-2 & poe/"), ["02-poe/2", "02-poe/3"]); // order of terms does not matter
  assert.deepEqual(await S("poe/ about:s2:top-1"), ["02-poe/2"]);
  // scope is literal-only: an OR of scopes widens it
  assert.deepEqual(await S("(poe/ | blog/) & about:s2:top-2"), ["01-blog/b", "02-poe/2"]);
  // OR of two about terms → union, ordered by max score
  assert.deepEqual(await S("about:s1:top-1 | about:s2:top-1"), ["02-poe/1", "01-blog/b"]);
  // AND of two about terms → intersection, order by min score
  assert.deepEqual(await S("about:s1:top-3 & about:s2:top-3"), ["02-poe/2"]);
  // NOT: the complement of top-1 (scope = whole corpus), keeps folder order (no positive about hit... but hasAbout → sorted, all score 1 → stable)
  assert.deepEqual(await S("!about:s1:top-1"), ["00-help/help", "01-blog/a", "01-blog/b", "02-poe/2", "02-poe/3"]);
  assert.deepEqual(await S("poe/ & !about:s1:top-1"), ["02-poe/2", "02-poe/3"]);
  // a literal term next to an about term
  // "raven" matches blog/a, poe/1, poe/3 → that is the scope, so top-3 of it is all three (not corpus-top-3 ∩ raven)
  assert.deepEqual(await S("about:s1:top-3 & raven"), ["02-poe/1", "01-blog/a", "02-poe/3"]);
  assert.deepEqual(await S("about:s1:top-2 & raven"), ["02-poe/1", "01-blog/a"]);
  // !#draft removes blog/b and poe/2 from the scope, so top-3 reaches down to help (.60)
  assert.deepEqual(await S("about:s1:top-3 & !#draft"), ["02-poe/1", "01-blog/a", "00-help/help"]);
});

test("about: ordering — similarity descending, literal terms score 1, AND=min OR=max, negations don't contribute", async () => {
  const r = await asyncStems("poe/ | about:s1:top-2");
  // poe/ matches score 1 (literal) → they come first (stable folder order), then about-only hits
  assert.deepEqual(r.results.map((d) => d.stem), ["02-poe/1", "02-poe/2", "02-poe/3"]);
  const r2 = await asyncStems("about:s1:top-4 & about:s2:top-4");
  // combined = min(s1, s2)
  const info = r2.info;
  for (const d of r2.results) assert.equal(info.get(d.stem).score, Math.min(SC[d.stem].s1, SC[d.stem].s2));
  const sc = r2.results.map((d) => info.get(d.stem).score);
  assert.deepEqual(sc, [...sc].sort((a, b) => b - a));
  // negated about does not contribute a score or a passage
  const r3 = await asyncStems("poe/ & !about:s1:top-1");
  assert.equal(r3.info.get("02-poe/2").about, null);
  // best passage is the winning about term's
  const r4 = await asyncStems("about:s1:top-2 | about:s2:top-2");
  assert.match(r4.info.get("02-poe/1").about.passage, /for s1$/);
  assert.match(r4.info.get("01-blog/b").about.passage, /for s2$/);
  // literal-only expressions keep folder order and have no `ordered`
  assert.equal((await asyncStems("poe/")).ordered, false);
  assert.equal(r4.ordered, true);
});

test("about: threshold and scope: > ignores scope, top-N respects it", () => {
  const scores = new Map([["s1", new Map(docs.map((d) => [d.stem, { score: SC[d.stem].s1, passage: "" }]))]]);
  const r = searchDocs(docs, "poe/ & about:s1:>0.65", { about: scores });
  assert.deepEqual(r.results.map((d) => d.stem), ["02-poe/1", "02-poe/2"]);
});

test("about: sync searchDocs without scores reports pending and matches nothing for the about part", () => {
  const r = searchDocs(docs, "poe/ | about:zzz");
  assert.deepEqual(r.pending, ["zzz"]);
  assert.deepEqual(r.results.map((d) => d.stem), ["02-poe/1", "02-poe/2", "02-poe/3"]);
});

test("about: provider failure → friendly aboutErrors, literal parts keep working", async () => {
  const boom = async () => { throw new Error("model failed to load"); };
  const r = await searchDocsAsync(docs, "poe/ & (about:x:top-2 | raven)", { scoreAbout: boom });
  assert.ok(r.ok);
  assert.deepEqual(r.aboutErrors, [{ query: "x", message: "model failed to load" }]);
  assert.deepEqual(r.results.map((d) => d.stem), ["02-poe/1", "02-poe/3"]);
  const none = await searchDocsAsync(docs, "about:x", {});
  assert.equal(none.results.length, 0);
  assert.equal(none.aboutErrors.length, 1);
});

test("about: each distinct query is requested once", async () => {
  const seen = [];
  const prov = async (q) => { seen.push(q); return fake(q); };
  await searchDocsAsync(docs, "about:s1:top-1 | about:s1:bottom-1 | about:s2:top-1", { scoreAbout: prov });
  assert.deepEqual(seen.sort(), ["s1", "s2"]);
});

test("about: syntax errors and empty expressions never call the provider", async () => {
  let calls = 0;
  const prov = async () => { calls++; return new Map(); };
  assert.equal((await searchDocsAsync(docs, "about:x:top-", { scoreAbout: prov })).ok, false);
  assert.equal((await searchDocsAsync(docs, "  ", { scoreAbout: prov })).empty, true);
  assert.equal(calls, 0);
});

test("about: result view shows the best passage with score", async () => {
  const r = await asyncStems("about:s1:top-1");
  const v = makeResultView(r.results[0], r.info.get(r.results[0].stem), r.terms);
  assert.equal(v.kind, "passage");
  assert.equal(v.score, 0.95);
  assert.equal(v.parts.map((p) => p.text).join(""), "passage of 02-poe/1 for s1");
});

test("randomized cross-check with about-terms against an independent naive evaluator", async () => {
  // naive semantics (documented scope rule) written independently of computeAboutSets
  const N = docs.length;
  const lit = [
    ["raven", (d) => (d.title + " " + d.body).toLowerCase().includes("raven")],
    ["poe/", (d) => d.dir.includes("poe")],
    ["#draft", (d) => d.tags.includes("draft")],
    ["blog/", (d) => d.dir.includes("blog")],
  ];
  const order = docs.map((d) => d.stem);
  const pick = (q, sel, scope) => {
    const c = scope.slice().sort((a, b) => SC[b][q] - SC[a][q] || order.indexOf(a) - order.indexOf(b));
    if (sel.k === "top") return new Set(c.slice(0, sel.n));
    return new Set(c.slice(Math.max(0, c.length - sel.n)));
  };
  let seed = 4242;
  const rnd = (n) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), seed % n);
  // gen returns { s: source, f: (doc, scope) => bool } — the scope is the list of stems the about-selector ranks among
  function gen(depth) {
    if (depth === 0 || rnd(3) === 0) {
      if (rnd(2) === 0) { const a = lit[rnd(lit.length)]; return { s: a[0], f: (d) => a[1](d), isAbout: false, lit: (d) => a[1](d) }; }
      const q = rnd(2) ? "s1" : "s2";
      const sel = rnd(2) ? { k: "top", n: 1 + rnd(4) } : { k: "bottom", n: 1 + rnd(3) };
      return { s: `about:${q}:${sel.k}-${sel.n}`, isAbout: true, f: (d, scope) => pick(q, sel, scope).has(d.stem), lit: null };
    }
    const k = rnd(4);
    if (k === 0) { const x = gen(depth - 1); return { s: "!" + w(x), isAbout: x.isAbout, f: (d, sc) => !x.f(d, sc), lit: x.lit ? (d) => !x.lit(d) : null }; }
    const x = gen(depth - 1), y = gen(depth - 1);
    if (k === 2) return { s: w(x) + " | " + w(y), isAbout: x.isAbout || y.isAbout, f: (d, sc) => x.f(d, sc) || y.f(d, sc), lit: x.lit && y.lit ? (d) => x.lit(d) || y.lit(d) : null };
    // AND: the scope for about-children = current scope filtered by the AND's about-free children
    const free = [x, y].filter((c) => !c.isAbout && c.lit);
    return {
      s: w(x) + (k === 1 ? " & " : " ") + w(y),
      isAbout: x.isAbout || y.isAbout,
      f: (d, sc) => {
        const scope = free.length ? sc.filter((st) => free.every((c) => c.lit(docs.find((z) => z.stem === st)))) : sc;
        return x.f(d, scope) && y.f(d, scope);
      },
      lit: x.lit && y.lit ? (d) => x.lit(d) && y.lit(d) : null,
    };
  }
  const w = (x) => "(" + x.s + ")";
  for (let i = 0; i < 400; i++) {
    const g = gen(3);
    const got = (await S(g.s)).slice().sort();
    const want = docs.filter((d) => g.f(d, order)).map((d) => d.stem).sort();
    assert.deepEqual(got, want, g.s);
  }
  assert.ok(N === 6);
});
