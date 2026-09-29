/**
 * /tag query language: parser + evaluator + snippet/highlight helpers.
 * Pure ES module (no DOM, no Node APIs) — bundled into assets/term-engine.js for the browser.
 *
 * Grammar (precedence  !  >  &  >  | ; whitespace between terms = implicit &):
 *   expr  := and ('|' and)*
 *   and   := not (['&'] not)*
 *   not   := '!' not | atom | '(' expr ')'
 *   atom  := word | "phrase" | /regex/flags | #tag | @tag | dir/ | (title|body|tag|folder):value
 *          | grep:word | grep:"phrase" | grep:/re/flags          (line-oriented, case-insensitive)
 *          | about:query[:sel]     query = word | "phrase";  sel = top-N | bottom-N | >score | >=score
 *
 * about: terms are semantic; they need similarity scores from a provider (see searchDocs / searchDocsAsync).
 */

import { selectAbout } from "./about.mjs";

export class QueryError extends Error {
  constructor(message, pos = 0, length = 1) {
    super(message);
    this.name = "QueryError";
    this.pos = pos;
    this.length = Math.max(1, length);
  }
}

const OPS = "()&|";
const REGEX_FLAGS = "imsu";
const QUALIFIER = /^(title|body|tag|folder|dir|grep|about)[:：]/i;
const MAX_TOPN = 1000;
const escRe = (t) => String(t).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Full-width operators (Chinese IME) are accepted as operators when they appear unquoted. Text itself is never rewritten. */
const FW_OPS = { "（": "(", "）": ")", "｜": "|", "＆": "&", "！": "!" };
const normOp = (c) => FW_OPS[c] || c;

/** Strip invisible IME junk (ZWSP/BOM/bidi) and control characters. */
export function cleanExpr(s) {
  return String(s == null ? "" : s).replace(/[\p{Cf}\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/gu, "");
}

const isSpace = (c) => /\s/.test(c);
const isOp = (c) => OPS.includes(normOp(c));

function lex(src) {
  const tokens = [];
  const n = src.length;
  let i = 0;

  function readQuoted(start) {
    // src[start] === '"'
    let j = start + 1;
    let out = "";
    while (j < n) {
      const c = src[j];
      if (c === "\\" && j + 1 < n && (src[j + 1] === '"' || src[j + 1] === "\\")) {
        out += src[j + 1];
        j += 2;
        continue;
      }
      if (c === '"') {
        if (!out) throw new QueryError("empty quoted phrase", start, j - start + 1);
        return { value: out, end: j + 1 };
      }
      out += c;
      j++;
    }
    throw new QueryError('unterminated quote — add a closing "', start, n - start);
  }

  function readRegex(start) {
    // src[start] === '/'
    let j = start + 1;
    let inClass = false;
    while (j < n) {
      const c = src[j];
      if (c === "\\") {
        j += 2;
        continue;
      }
      if (c === "[") inClass = true;
      else if (c === "]") inClass = false;
      else if (c === "/" && !inClass) break;
      j++;
    }
    if (j >= n) throw new QueryError("unterminated regex — add a closing /", start, n - start);
    const body = src.slice(start + 1, j);
    let k = j + 1;
    while (k < n && /[A-Za-z]/.test(src[k])) k++;
    const flags = src.slice(j + 1, k);
    if (!body) throw new QueryError("empty regex //", start, k - start);
    for (const f of flags) {
      if (!REGEX_FLAGS.includes(f) || flags.indexOf(f) !== flags.lastIndexOf(f)) {
        throw new QueryError(`unsupported regex flag "${f}" (allowed: ${REGEX_FLAGS.split("").join(" ")})`, j + 1, flags.length);
      }
    }
    let re;
    try {
      re = new RegExp(body, flags);
    } catch (e) {
      throw new QueryError("invalid regex: " + String(e.message).replace(/^Invalid regular expression: /, ""), start, k - start);
    }
    return { value: body, flags, re, end: k };
  }

  function readWord(start) {
    let j = start;
    while (j < n && !isSpace(src[j]) && !isOp(src[j])) j++;
    return { value: src.slice(start, j), end: j };
  }

  /** Parse a selector suffix (text after the ":"): top-N | bottom-N | >score | >=score. */
  function parseSelector(text, at) {
    const len = Math.max(1, text.length);
    let m = text.match(/^(top|bottom)(?:-(.*))?$/i);
    if (m) {
      const kind = m[1].toLowerCase();
      if (m[2] === undefined) throw new QueryError(`bad selector "${text}" — write ${kind}-N, e.g. ${kind}-3`, at, len);
      if (!/^\d+$/.test(m[2])) throw new QueryError(`bad selector "${text}" — N must be a whole number, e.g. ${kind}-3`, at, len);
      const num = Number(m[2]);
      if (num < 1) throw new QueryError(`bad selector "${text}" — N must be at least 1`, at, len);
      if (num > MAX_TOPN) throw new QueryError(`bad selector "${text}" — N is at most ${MAX_TOPN}`, at, len);
      return { mode: kind, n: num };
    }
    m = text.match(/^(>=?)(.*)$/);
    if (m) {
      if (!/^(\d+\.?\d*|\.\d+)$/.test(m[2])) throw new QueryError(`bad selector "${text}" — write ${m[1]}0.5 (a similarity between 0 and 1)`, at, len);
      const min = Number(m[2]);
      if (min < 0 || min > 1) throw new QueryError(`bad selector "${text}" — similarity must be between 0 and 1`, at, len);
      return { mode: "gt", min, inclusive: m[1] === ">=" };
    }
    throw new QueryError(`bad selector "${text}" — expected top-N, bottom-N or >score`, at, len);
  }
  const isSelectorish = (t) => /^(top|bottom)(-|$)/i.test(t) || /^>/.test(t) || t === "";

  /** about:query[:selector]  — src[start..) is right after "about:". */
  function readAbout(start, termStart) {
    let value;
    let j;
    if (src[start] === '"') {
      const q = readQuoted(start);
      value = q.value;
      j = q.end;
      let sel = null;
      if (j < n && (src[j] === ":" || src[j] === "：")) {
        let k = j + 1;
        while (k < n && !isSpace(src[k]) && !isOp(src[k])) k++;
        sel = parseSelector(src.slice(j + 1, k), j + 1);
        j = k;
      }
      return { value: value.trim(), sel, end: j };
    }
    if (src[start] === "/") {
      const r = readRegex(start);
      throw new QueryError("regex is not supported with about: — write a phrase in quotes", termStart, r.end - termStart);
    }
    const w = readWord(start);
    let text = w.value;
    let sel = null;
    const ci = Math.max(text.lastIndexOf(":"), text.lastIndexOf("："));
    if (ci >= 0 && isSelectorish(text.slice(ci + 1))) {
      sel = parseSelector(text.slice(ci + 1), start + ci + 1);
      text = text.slice(0, ci);
    }
    if (!text) throw new QueryError('expected a query after "about:"', termStart, w.end - termStart);
    return { value: text, sel, end: w.end };
  }

  /** grep:word | grep:"phrase" | grep:/re/flags  — always case-insensitive. */
  function readGrep(start, termStart) {
    const c = src[start];
    if (c === "/") {
      const r = readRegex(start);
      const flags = r.flags.includes("i") ? r.flags : r.flags + "i";
      return { value: r.value, isRegex: true, flags, re: new RegExp(r.value, flags), end: r.end };
    }
    if (c === '"') {
      const q = readQuoted(start);
      return { value: q.value, isRegex: false, flags: "i", re: new RegExp(escRe(q.value), "i"), end: q.end };
    }
    const w = readWord(start);
    return { value: w.value, isRegex: false, flags: "i", re: new RegExp(escRe(w.value), "i"), end: w.end };
  }

  while (i < n) {
    const c = normOp(src[i]);
    if (isSpace(c)) {
      i++;
      continue;
    }
    if (c === "(" || c === ")" || c === "&" || c === "|") {
      tokens.push({ t: c, pos: i, len: 1 });
      i++;
      continue;
    }
    if (c === "!") {
      tokens.push({ t: "!", pos: i, len: 1 });
      i++;
      continue;
    }
    const start = i;
    // qualifier  title:foo  body:"a b"  title:/re/
    let field = "any";
    let qual = null;
    const qm = src.slice(i).match(QUALIFIER);
    if (qm) {
      qual = qm[1].toLowerCase();
      i += qm[0].length;
      if (i >= n || isSpace(src[i]) || isOp(src[i])) {
        throw new QueryError(`expected a value after "${qm[0]}"`, start, qm[0].length);
      }
      if (qual === "title" || qual === "body") field = qual;
      if (qual === "about") {
        const a = readAbout(i, start);
        i = a.end;
        tokens.push({ t: "term", pos: start, len: i - start, node: { type: "term", kind: "about", field: "any", value: a.value, sel: a.sel, pos: start, len: i - start } });
        continue;
      }
      if (qual === "grep") {
        const g = readGrep(i, start);
        i = g.end;
        tokens.push({ t: "term", pos: start, len: i - start, node: { type: "term", kind: "grep", field: "any", value: g.value, isRegex: g.isRegex, flags: g.flags, re: g.re, pos: start, len: i - start } });
        continue;
      }
    }
    const ch = src[i];
    if (ch === '"') {
      const q = readQuoted(i);
      i = q.end;
      pushValue(tokens, qual, field, "phrase", q.value, start, i - start);
      continue;
    }
    if (ch === "/") {
      const r = readRegex(i);
      i = r.end;
      if (qual === "tag" || qual === "folder" || qual === "dir") {
        throw new QueryError(`regex is not supported with ${qual}:`, start, i - start);
      }
      tokens.push({ t: "term", pos: start, len: i - start, node: { type: "term", kind: "regex", field, value: r.value, flags: r.flags, re: r.re, pos: start, len: i - start } });
      continue;
    }
    const w = readWord(i);
    i = w.end;
    if (!qual && (w.value[0] === "#" || w.value[0] === "@")) {
      const name = w.value.slice(1);
      if (!name) throw new QueryError("empty tag — write #name", start, 1);
      tokens.push({ t: "term", pos: start, len: i - start, node: { type: "term", kind: "tag", field: "any", value: name, pos: start, len: i - start } });
      continue;
    }
    if (!qual && w.value.length > 1 && w.value.endsWith("/")) {
      tokens.push({ t: "term", pos: start, len: i - start, node: { type: "term", kind: "folder", field: "any", value: w.value.slice(0, -1), pos: start, len: i - start } });
      continue;
    }
    pushValue(tokens, qual, field, "word", w.value, start, i - start);
  }
  return tokens;
}

function pushValue(tokens, qual, field, kind, value, pos, len) {
  let node;
  if (qual === "tag") node = { type: "term", kind: "tag", field: "any", value: value.replace(/^[#@]/, ""), pos, len };
  else if (qual === "folder" || qual === "dir") node = { type: "term", kind: "folder", field: "any", value: value.replace(/\/$/, ""), pos, len };
  else node = { type: "term", kind, field, value, pos, len };
  tokens.push({ t: "term", pos, len, node });
}

/** Parse an expression. Returns { ok:true, ast } (ast === null for an empty expression) or { ok:false, error:{message,pos,length} }. */
export function parseQuery(input) {
  const src = cleanExpr(input);
  try {
    const tokens = lex(src);
    if (!tokens.length) return { ok: true, ast: null, src };
    let p = 0;
    const peek = () => tokens[p];
    const startsPrimary = (t) => t && (t.t === "term" || t.t === "(" || t.t === "!");

    function parseOr() {
      const args = [parseAnd()];
      while (peek() && peek().t === "|") {
        const op = tokens[p++];
        if (!startsPrimary(peek())) throw new QueryError("expected a term after '|'", op.pos, 1);
        args.push(parseAnd());
      }
      return args.length === 1 ? args[0] : { type: "or", args };
    }
    function parseAnd() {
      const args = [parseNot()];
      for (;;) {
        const t = peek();
        if (t && t.t === "&") {
          p++;
          if (!startsPrimary(peek())) throw new QueryError("expected a term after '&'", t.pos, 1);
          args.push(parseNot());
        } else if (startsPrimary(t)) {
          args.push(parseNot()); // implicit &
        } else break;
      }
      return args.length === 1 ? args[0] : { type: "and", args };
    }
    function parseNot() {
      const t = peek();
      if (!t) throw new QueryError("unexpected end of expression", src.length, 1);
      if (t.t === "!") {
        p++;
        if (!startsPrimary(peek())) throw new QueryError("expected a term after '!'", t.pos, 1);
        return { type: "not", arg: parseNot() };
      }
      if (t.t === "(") {
        p++;
        if (peek() && peek().t === ")") throw new QueryError("empty parentheses", t.pos, 2);
        if (!startsPrimary(peek())) throw new QueryError("expected a term after '('", t.pos, 1);
        const e = parseOr();
        const close = peek();
        if (!close || close.t !== ")") throw new QueryError("missing ')' to close this '('", t.pos, 1);
        p++;
        return e;
      }
      if (t.t === "term") {
        p++;
        return t.node;
      }
      if (t.t === ")") throw new QueryError("unexpected ')' — no matching '('", t.pos, 1);
      throw new QueryError(`expected a term before '${t.t}'`, t.pos, 1);
    }

    const ast = parseOr();
    if (p < tokens.length) {
      const t = tokens[p];
      if (t.t === ")") throw new QueryError("unexpected ')' — no matching '('", t.pos, 1);
      throw new QueryError("unexpected '" + t.t + "'", t.pos, t.len);
    }
    return { ok: true, ast, src };
  } catch (e) {
    if (e instanceof QueryError) {
      return { ok: false, error: { message: e.message, pos: e.pos, length: e.length }, src };
    }
    throw e;
  }
}

/** Friendly multi-line message: text, the expression, and a caret line under the error position. */
export function formatQueryError(input, error) {
  const src = cleanExpr(input);
  const pos = Math.max(0, Math.min(error.pos, src.length));
  // width-aware caret padding: CJK chars are two columns wide in a monospace font
  const col = (s) => [...s].reduce((w, ch) => w + (/[\u1100-\u115f\u2e80-\u9fff\uac00-\ud7a3\uf900-\ufaff\uff00-\uff60]/.test(ch) ? 2 : 1), 0);
  const pad = " ".repeat(col(src.slice(0, pos)));
  const carets = "^".repeat(Math.max(1, Math.min(error.length || 1, Math.max(1, src.length - pos))));
  return `syntax error: ${error.message} (col ${pos + 1})\n  ${src}\n  ${pad}${carets}`;
}

// ---------------------------------------------------------------- evaluation

export function seriesSlug(dir) {
  return String(dir || "").replace(/^\d+[-_.\s]*/, "") || String(dir || "");
}
export function seriesNumber(dir) {
  const m = String(dir || "").match(/^(\d+)/);
  return m ? m[1] : "";
}

export function folderMatches(doc, frag) {
  const f = String(frag || "").trim().toLowerCase();
  if (!f) return false;
  const dir = String(doc.dir || "").toLowerCase();
  if (/^\d+$/.test(f)) {
    const no = doc.seriesNo != null && doc.seriesNo !== "" ? doc.seriesNo : seriesNumber(dir);
    return no !== "" && Number(no) === Number(f);
  }
  return dir.includes(f) || String(doc.seriesTitle || "").toLowerCase().includes(f) || seriesSlug(dir).includes(f);
}

const normTag = (t) => String(t || "").trim().replace(/^[#@]/, "").toLowerCase();

/** Body text of a doc: `body`, or the joined `lines` (the search index stores lines). */
export function bodyOf(doc) {
  if (doc.body != null) return String(doc.body);
  return Array.isArray(doc.lines) ? doc.lines.join(" ") : "";
}
/** Lines of a doc (1-based numbering is applied by callers); falls back to newline-split body. */
export function linesOf(doc) {
  if (Array.isArray(doc.lines)) return doc.lines;
  const b = doc.body == null ? "" : String(doc.body);
  return b ? b.split(/\r?\n/) : [];
}

const lowerCache = new WeakMap();
function lowered(doc) {
  let c = lowerCache.get(doc);
  if (!c) {
    c = { title: String(doc.title || "").toLowerCase(), body: bodyOf(doc).toLowerCase(), tags: (doc.tags || []).map(normTag) };
    lowerCache.set(doc, c);
  }
  return c;
}

/** Lines that match a grep term: [{ n, text }] — n = 0 for the title, 1-based body line numbers otherwise. */
export function grepMatchLines(doc, term) {
  const out = [];
  if (term.re.test(String(doc.title || ""))) out.push({ n: 0, text: String(doc.title || "") });
  linesOf(doc).forEach((text, i) => {
    if (term.re.test(text)) out.push({ n: i + 1, text });
  });
  return out;
}

/** Literal (non-semantic) term test. about: terms are decided by the score sets, not here. */
export function termMatches(term, doc) {
  switch (term.kind) {
    case "tag":
      return lowered(doc).tags.includes(normTag(term.value));
    case "folder":
      return folderMatches(doc, term.value);
    case "regex": {
      const t = term.field !== "body" && term.re.test(String(doc.title || ""));
      if (t) return true;
      return term.field !== "title" && term.re.test(bodyOf(doc));
    }
    case "grep":
      return grepMatchLines(doc, term).length > 0;
    case "about":
      return false;
    default: {
      const v = term.value.toLowerCase();
      const l = lowered(doc);
      if (term.field !== "body" && l.title.includes(v)) return true;
      return term.field !== "title" && l.body.includes(v);
    }
  }
}

export function hasAbout(node) {
  if (!node) return false;
  if (node.type === "term") return node.kind === "about";
  if (node.type === "not") return hasAbout(node.arg);
  return node.args.some(hasAbout);
}

/** Distinct about-queries (in order of appearance). */
export function aboutQueries(node, out = []) {
  if (!node) return out;
  if (node.type === "term") {
    if (node.kind === "about" && !out.includes(node.value)) out.push(node.value);
  } else if (node.type === "not") aboutQueries(node.arg, out);
  else node.args.forEach((a) => aboutQueries(a, out));
  return out;
}
export function aboutTerms(node, out = []) {
  if (!node) return out;
  if (node.type === "term") {
    if (node.kind === "about") out.push(node);
  } else if (node.type === "not") aboutTerms(node.arg, out);
  else node.args.forEach((a) => aboutTerms(a, out));
  return out;
}

/** Literal-only truth value (about-free subtrees only — used to derive the scope of an about: selector). */
function evalLiteral(node, doc) {
  switch (node.type) {
    case "term":
      return termMatches(node, doc);
    case "not":
      return !evalLiteral(node.arg, doc);
    case "and":
      return node.args.every((a) => evalLiteral(a, doc));
    case "or":
      return node.args.some((a) => evalLiteral(a, doc));
  }
  return false;
}

/**
 * Decide, for every about: term, which posts it selects.
 *   scores: Map(query → Map(stem → { score, passage })).  A query that is missing / empty selects nothing.
 * SCOPE RULE: a selector (top-N / bottom-N / adaptive default) is computed among the posts that satisfy the
 * about-free terms AND-ed next to it (its "scope"), and among the whole corpus when there are none.
 *   poe/ & about:x:top-2   → the 2 posts of poe/ most similar to x
 *   (poe/ | blog/) about:x → adaptive cut among poe/ + blog/ posts
 * OR and NOT pass the scope of their parent through unchanged. `>score` thresholds ignore scope.
 * Returns { sets: Map(termNode → Map(stem → { score, passage })), report: [{ query, sel, candidates, picked, auto }] }.
 */
export function computeAboutSets(ast, docs, scores) {
  const sets = new Map();
  const report = [];
  function walk(node, cand) {
    if (!hasAbout(node)) return;
    switch (node.type) {
      case "term": {
        const sc = scores && scores.get(node.value);
        const entries = [];
        if (sc) for (const d of cand) if (sc.has(d.stem)) entries.push({ id: d.stem, score: sc.get(d.stem).score });
        const ids = selectAbout(entries, node.sel);
        const m = new Map();
        for (const id of ids) m.set(id, sc.get(id));
        sets.set(node, m);
        report.push({ query: node.value, sel: node.sel || null, candidates: entries.length, picked: ids.length, auto: !node.sel });
        return;
      }
      case "not":
        return walk(node.arg, cand);
      case "or":
        return node.args.forEach((a) => walk(a, cand));
      case "and": {
        const free = node.args.filter((a) => !hasAbout(a));
        const scope = free.length ? cand.filter((d) => free.every((a) => evalLiteral(a, d))) : cand;
        return node.args.forEach((a) => walk(a, scope));
      }
    }
  }
  walk(ast, docs || []);
  return { sets, report };
}

/**
 * Score one doc: null = no match, else { s, a } — s = combined score (literal terms 1, about-terms their
 * similarity; AND = min, OR = max, NOT contributes nothing), a = best contributing about hit { query, score, passage }.
 */
export function evalScore(node, doc, sets) {
  switch (node.type) {
    case "term": {
      if (node.kind === "about") {
        const h = sets && sets.get(node) && sets.get(node).get(doc.stem);
        return h ? { s: h.score, a: { query: node.value, score: h.score, passage: h.passage || "" } } : null;
      }
      return termMatches(node, doc) ? { s: 1, a: null } : null;
    }
    case "not":
      return evalScore(node.arg, doc, sets) ? null : { s: 1, a: null };
    case "and": {
      let s = 1;
      let a = null;
      for (const c of node.args) {
        const r = evalScore(c, doc, sets);
        if (!r) return null;
        if (r.s < s) s = r.s;
        if (r.a && (!a || r.a.score > a.score)) a = r.a;
      }
      return { s, a };
    }
    case "or": {
      let best = null;
      let a = null;
      for (const c of node.args) {
        const r = evalScore(c, doc, sets);
        if (!r) continue;
        if (!best || r.s > best.s) best = r;
        if (r.a && (!a || r.a.score > a.score)) a = r.a;
      }
      return best ? { s: best.s, a } : null;
    }
  }
  return null;
}

/** Boolean evaluation (sets = result of computeAboutSets().sets; only needed for expressions with about:). */
export function evalNode(node, doc, sets) {
  return evalScore(node, doc, sets) !== null;
}

const TEXT_KINDS = ["word", "phrase", "regex", "grep"];

/** Positive terms (for highlighting): everything not under an odd number of negations. Default: text terms only. */
export function collectTerms(node, negated = false, out = [], kinds = TEXT_KINDS) {
  if (!node) return out;
  if (node.type === "term") {
    if (!negated && kinds.includes(node.kind)) out.push(node);
  } else if (node.type === "not") collectTerms(node.arg, !negated, out, kinds);
  else node.args.forEach((a) => collectTerms(a, negated, out, kinds));
  return out;
}

function finishSearch(docs, parsed, scores, extra = {}) {
  const ast = parsed.ast;
  const { sets, report } = computeAboutSets(ast, docs, scores);
  const withAbout = hasAbout(ast);
  const info = new Map();
  let rows = [];
  (docs || []).forEach((d, i) => {
    const r = evalScore(ast, d, sets);
    if (r) rows.push({ d, i, r });
  });
  if (withAbout) rows.sort((x, y) => y.r.s - x.r.s || x.i - y.i);
  const grepTerms = collectTerms(ast, false, [], ["grep"]);
  for (const { d, r } of rows) {
    const lines = [];
    for (const t of grepTerms) {
      for (const l of grepMatchLines(d, t)) if (!lines.some((x) => x.n === l.n)) lines.push(l);
    }
    lines.sort((x, y) => x.n - y.n);
    info.set(d.stem, { score: r.s, about: r.a, lines });
  }
  return {
    ok: true,
    ast,
    results: rows.map((x) => x.d),
    info,
    terms: collectTerms(ast),
    tagTerms: collectTerms(ast, false, [], ["tag"]),
    grepTerms,
    hasAbout: withAbout,
    ordered: withAbout,
    aboutReport: report,
    src: parsed.src,
    ...extra,
  };
}

/**
 * Run an expression over docs ({ stem, title, body|lines, tags, dir, seriesNo, seriesTitle, ... }).
 * Empty expression → ok with no results. Literal-only expressions keep the docs' original order; expressions with
 * about: terms are ordered by combined similarity (desc, stable).
 * about: scores come from opts.about (Map query → Map stem → {score, passage}); queries that are absent are listed in
 * `pending` and select nothing. See searchDocsAsync for the async provider interface.
 */
export function searchDocs(docs, expr, opts = {}) {
  const parsed = parseQuery(expr);
  if (!parsed.ok) return { ok: false, error: parsed.error, results: [], terms: [], src: parsed.src };
  if (!parsed.ast) return { ok: true, empty: true, results: [], terms: [], src: parsed.src };
  const scores = opts.about || new Map();
  const pending = aboutQueries(parsed.ast).filter((q) => !scores.has(q));
  return finishSearch(docs, parsed, scores, { pending });
}

/**
 * Async variant. opts.scoreAbout(query) → Promise<Map(stem → { score, passage })>  (or a plain Map).
 * Each distinct query is requested once, in parallel. A provider failure does not fail the search: that query selects
 * nothing and is reported in `aboutErrors` [{ query, message }], the literal parts of the expression still work.
 */
export async function searchDocsAsync(docs, expr, opts = {}) {
  const parsed = parseQuery(expr);
  if (!parsed.ok) return { ok: false, error: parsed.error, results: [], terms: [], src: parsed.src };
  if (!parsed.ast) return { ok: true, empty: true, results: [], terms: [], src: parsed.src };
  const queries = aboutQueries(parsed.ast);
  const scores = new Map();
  const aboutErrors = [];
  await Promise.all(
    queries.map(async (q) => {
      try {
        if (typeof opts.scoreAbout !== "function") throw new Error("semantic search is not available");
        scores.set(q, await opts.scoreAbout(q));
      } catch (e) {
        scores.set(q, new Map());
        aboutErrors.push({ query: q, message: String((e && e.message) || e) });
      }
    })
  );
  return finishSearch(docs, parsed, scores, { pending: [], aboutErrors });
}

// ---------------------------------------------------------------- snippets

/** Merged [start,end) ranges where any applicable text term matches `text`. */
export function findMatches(text, terms, field = "body") {
  const s = String(text || "");
  const low = s.toLowerCase();
  const hay = low.length === s.length ? low : s;
  const ranges = [];
  for (const t of terms) {
    if (!TEXT_KINDS.includes(t.kind)) continue;
    if (t.field !== "any" && t.field !== field) continue;
    if (t.kind === "regex" || t.kind === "grep") {
      const re = new RegExp(t.re.source, t.re.flags.replace("g", "") + "g");
      let m;
      let guard = 0;
      while ((m = re.exec(s)) && guard++ < 500) {
        if (m[0] === "") {
          re.lastIndex++;
          continue;
        }
        ranges.push([m.index, m.index + m[0].length]);
      }
    } else {
      const v = hay === low ? t.value.toLowerCase() : t.value;
      if (!v) continue;
      let from = 0;
      let at;
      let guard = 0;
      while ((at = hay.indexOf(v, from)) !== -1 && guard++ < 500) {
        ranges.push([at, at + v.length]);
        from = at + v.length;
      }
    }
  }
  ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  return merged;
}

/** Split text into [{text, hit}] parts using the matches for `field`. */
export function highlightParts(text, terms, field = "title") {
  const s = String(text || "");
  const parts = [];
  let at = 0;
  for (const [a, b] of findMatches(s, terms, field)) {
    if (a > at) parts.push({ text: s.slice(at, a), hit: false });
    parts.push({ text: s.slice(a, b), hit: true });
    at = b;
  }
  if (at < s.length) parts.push({ text: s.slice(at), hit: false });
  return parts;
}

/**
 * Snippet around the first body match: { parts:[{text,hit}], matched:boolean }.
 * No body match (title/tag/folder-only hit) → the beginning of the body, unhighlighted.
 */
export function makeSnippet(doc, terms, { before = 36, after = 84 } = {}) {
  const body = bodyOf(doc);
  const ranges = findMatches(body, terms, "body");
  if (!ranges.length) {
    const end = Math.min(body.length, before + after);
    return { parts: body ? [{ text: body.slice(0, end) + (end < body.length ? "…" : ""), hit: false }] : [], matched: false };
  }
  const first = ranges[0];
  const start = Math.max(0, first[0] - before);
  const end = Math.min(body.length, Math.max(first[1] + after, start + before + after));
  const parts = [];
  if (start > 0) parts.push({ text: "…", hit: false });
  let at = start;
  for (const [a, b] of ranges) {
    if (b <= start || a >= end) continue;
    const a2 = Math.max(a, start);
    const b2 = Math.min(b, end);
    if (a2 > at) parts.push({ text: body.slice(at, a2), hit: false });
    parts.push({ text: body.slice(a2, b2), hit: true });
    at = b2;
  }
  if (at < end) parts.push({ text: body.slice(at, end), hit: false });
  if (end < body.length) parts.push({ text: "…", hit: false });
  return { parts, matched: true };
}

// ---------------------------------------------------------------- result view (search page)

/** Shorten `text` to about `max` chars around the first highlighted range; returns { text, offset } (offset = chars cut at the start). */
function clipAround(text, ranges, max) {
  if (text.length <= max) return { text, offset: 0, cutStart: false, cutEnd: false };
  const first = ranges.length ? ranges[0][0] : 0;
  const start = Math.max(0, Math.min(first - Math.floor(max / 4), text.length - max));
  return { text: text.slice(start, start + max), offset: start, cutStart: start > 0, cutEnd: start + max < text.length };
}
function partsWithEllipsis(text, terms, field, max) {
  const ranges = findMatches(text, terms, field);
  const c = clipAround(text, ranges, max);
  const parts = highlightParts(c.text, terms, field);
  if (c.cutStart) parts.unshift({ text: "…", hit: false });
  if (c.cutEnd) parts.push({ text: "…", hit: false });
  return parts;
}

/**
 * What the results page shows under a hit:
 *   { kind:"grep",    lines:[{ n, parts }], more }   grep -n style: matching lines (n=0 → title), capped
 *   { kind:"passage", parts, score, query }          best semantic passage (about: hit)
 *   { kind:"snippet", parts, matched }               ordinary snippet around the first literal match
 * `info` = searchDocs().info.get(stem).
 */
export function makeResultView(doc, info, terms, { maxLines = 4, passageChars = 240 } = {}) {
  const lines = (info && info.lines) || [];
  if (lines.length) {
    const shown = lines.slice(0, maxLines).map((l) => ({ n: l.n, parts: partsWithEllipsis(l.text, terms, l.n === 0 ? "title" : "body", 160) }));
    return { kind: "grep", lines: shown, more: Math.max(0, lines.length - shown.length) };
  }
  const a = info && info.about;
  if (a && a.passage) {
    return { kind: "passage", parts: partsWithEllipsis(a.passage, terms, "body", passageChars), score: a.score, query: a.query };
  }
  const sn = makeSnippet(doc, terms);
  if (a) return { kind: "passage", parts: sn.parts, score: a.score, query: a.query, fallback: true };
  return { kind: "snippet", parts: sn.parts, matched: sn.matched };
}
