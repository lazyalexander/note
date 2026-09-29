/**
 * /tag query language: parser + evaluator + snippet/highlight helpers.
 * Pure ES module (no DOM, no Node APIs) — bundled into assets/term-engine.js for the browser.
 *
 * Grammar (precedence  !  >  &  >  | ; whitespace between terms = implicit &):
 *   expr  := and ('|' and)*
 *   and   := not (['&'] not)*
 *   not   := '!' not | atom | '(' expr ')'
 *   atom  := word | "phrase" | /regex/flags | #tag | @tag | dir/ | (title|body|tag|folder):value
 */

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
const QUALIFIER = /^(title|body|tag|folder|dir):/i;

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

const lowerCache = new WeakMap();
function lowered(doc) {
  let c = lowerCache.get(doc);
  if (!c) {
    c = { title: String(doc.title || "").toLowerCase(), body: String(doc.body || "").toLowerCase(), tags: (doc.tags || []).map(normTag) };
    lowerCache.set(doc, c);
  }
  return c;
}

export function termMatches(term, doc) {
  switch (term.kind) {
    case "tag":
      return lowered(doc).tags.includes(normTag(term.value));
    case "folder":
      return folderMatches(doc, term.value);
    case "regex": {
      const t = term.field !== "body" && term.re.test(String(doc.title || ""));
      if (t) return true;
      return term.field !== "title" && term.re.test(String(doc.body || ""));
    }
    default: {
      const v = term.value.toLowerCase();
      const l = lowered(doc);
      if (term.field !== "body" && l.title.includes(v)) return true;
      return term.field !== "title" && l.body.includes(v);
    }
  }
}

export function evalNode(node, doc) {
  switch (node.type) {
    case "term":
      return termMatches(node, doc);
    case "not":
      return !evalNode(node.arg, doc);
    case "and":
      return node.args.every((a) => evalNode(a, doc));
    case "or":
      return node.args.some((a) => evalNode(a, doc));
  }
  return false;
}

const TEXT_KINDS = ["word", "phrase", "regex"];

/** Positive terms (for highlighting): everything not under an odd number of negations. Default: text terms only. */
export function collectTerms(node, negated = false, out = [], kinds = TEXT_KINDS) {
  if (!node) return out;
  if (node.type === "term") {
    if (!negated && kinds.includes(node.kind)) out.push(node);
  } else if (node.type === "not") collectTerms(node.arg, !negated, out, kinds);
  else node.args.forEach((a) => collectTerms(a, negated, out, kinds));
  return out;
}

/**
 * Run an expression over docs ({ title, body, tags, dir, seriesNo, seriesTitle, ... }).
 * Empty expression → ok with no results. Keeps the docs' original order.
 */
export function searchDocs(docs, expr) {
  const parsed = parseQuery(expr);
  if (!parsed.ok) return { ok: false, error: parsed.error, results: [], terms: [], src: parsed.src };
  if (!parsed.ast) return { ok: true, empty: true, results: [], terms: [], src: parsed.src };
  const results = (docs || []).filter((d) => evalNode(parsed.ast, d));
  return {
    ok: true,
    ast: parsed.ast,
    results,
    terms: collectTerms(parsed.ast),
    tagTerms: collectTerms(parsed.ast, false, [], ["tag"]),
    src: parsed.src,
  };
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
    if (t.kind === "regex") {
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
  const body = String(doc.body || "");
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
