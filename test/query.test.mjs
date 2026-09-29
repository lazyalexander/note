import test from "node:test";
import assert from "node:assert/strict";
import {
  parseQuery, searchDocs, formatQueryError, makeSnippet, highlightParts, findMatches, collectTerms,
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
