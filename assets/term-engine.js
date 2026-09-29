/** Auto-bundled from text-scrub + tag-match + about + query + commands-list + complete + term-engine. */

/** IME / Unicode cleanup helpers for the note TUI. */

/**
 * Strip IME junk (ZWSP/BOM/bidi/…) and NFKC-normalize (fullwidth → halfwidth).
 */
export function scrubInvisible(s) {
  return (
    String(s || "")
      .normalize("NFKC")
      .replace(/\p{Cf}/gu, "")
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "")
  );
}

/** Hex codepoints for diagnostics (shown on tag no-match). */
export function codepointsHex(s) {
  return [...String(s || "")]
    .map((c) => c.codePointAt(0).toString(16))
    .join(" ");
}

export function normalizeTag(t) {
  return scrubInvisible(t)
    .trim()
    .toLowerCase()
    .replace(/^@/, "");
}

/** Simplest tag filter: one prefix/exact atom, no & / || / parens. */
export const TAG_QUERY_MAX = 64;

export function postTags(p) {
  return Array.isArray(p?.tags) ? p.tags : [];
}

/**
 * Exact or prefix on normalized tags. Mid-string does NOT match.
 * ASCII lowercased; Chinese kept as-is after NFKC scrub.
 */
export function tagAtomMatches(postTag, atom) {
  const a = normalizeTag(atom);
  const t = normalizeTag(postTag);
  if (!a || !t) return false;
  return t === a || t.startsWith(a);
}

export function postMatchesAtom(p, atom) {
  return postTags(p).some((tg) => tagAtomMatches(tg, atom));
}

/**
 * Filter posts by a single tag query string (optional leading @).
 * Empty → no posts (never dump the catalog).
 */
export function filterPostsByTag(posts, query, maxLen = TAG_QUERY_MAX) {
  const list = Array.isArray(posts) ? posts : [];
  const raw = scrubInvisible(query).trim().replace(/^@+/, "");
  if (!raw) return { posts: [], error: null };
  if (raw.length > maxLen) {
    return { posts: [], error: `tag query max ${maxLen} chars` };
  }
  const hits = list.filter((p) => postMatchesAtom(p, raw));
  return { posts: hits, error: null };
}

/**
 * Semantic-search helpers (pure, no DOM / no model): cosine scoring over a precomputed passage-embedding index,
 * selector picking (top-N / bottom-N / >threshold) and the adaptive default set size.
 */

/** Adaptive default: keep the outliers of the score distribution, z >= DYN_Z above the mean. */
export const DYN_Z = 0.75;
/** If best - worst is below this the scores are flat (e5 scores live in ~0.75–0.90): no real signal → keep only the best one. */
export const DYN_MIN_SPREAD = 0.035;

export function cosine(a, b) {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

/**
 * Score every post: max cosine over its passages (the embeddings index is per passage — paragraph-packed chunks
 * of <= ~450 chars plus one title-only vector). → Map(stem → { score, idx, passage })
 * `passage` is the best-matching passage text ("" when the title-only vector wins).
 */
export function scoreEmbeddings(qv, embIndex) {
  const out = new Map();
  for (const d of (embIndex && embIndex.docs) || []) {
    const vecs = Array.isArray(d.vectors) ? d.vectors : d.vector ? [d.vector] : [];
    let best = -Infinity;
    let bi = -1;
    for (let i = 0; i < vecs.length; i++) {
      const s = cosine(qv, vecs[i]);
      if (s > best) {
        best = s;
        bi = i;
      }
    }
    if (bi < 0) continue;
    out.set(d.stem, { score: best, idx: bi, passage: (Array.isArray(d.passages) && d.passages[bi]) || "" });
  }
  return out;
}

/** Upper bound of the adaptive default for a candidate set of n posts: at most ceil(n/2), and never everything (n>=2). */
export function dynamicMax(n) {
  if (n <= 1) return Math.max(0, n);
  return Math.min(n - 1, Math.ceil(n / 2));
}

/**
 * How many of the best-scoring posts to keep when the query gives no explicit selector.
 * z-score cut on the score distribution: keep posts whose score is >= mean + DYN_Z * stddev (i.e. the clear
 * outliers of THIS query, whatever the model's absolute score range is), bounded to [1, dynamicMax(n)].
 * n=0 → 0, n=1 → 1, all-equal / nearly flat scores (no signal) → 1.
 */
export function dynamicCount(scores) {
  const s = (scores || []).filter(Number.isFinite).sort((a, b) => b - a);
  const n = s.length;
  if (n <= 1) return n;
  const cap = dynamicMax(n);
  const mean = s.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(s.reduce((a, b) => a + (b - mean) * (b - mean), 0) / n);
  if (!(sd > 1e-9) || s[0] - s[n - 1] < DYN_MIN_SPREAD) return 1;
  let k = 0;
  while (k < cap && (s[k] - mean) / sd >= DYN_Z) k++;
  return Math.max(1, k);
}

/**
 * Pick ids from [{id, score}] by selector. sel: null (adaptive) | {mode:"top"|"bottom", n} | {mode:"gt", min, inclusive}.
 * Returns ids ordered by score descending (ties keep input order).
 */
export function selectAbout(entries, sel) {
  const arr = (entries || []).filter((e) => Number.isFinite(e.score)).map((e, i) => ({ ...e, _i: i }));
  arr.sort((a, b) => b.score - a.score || a._i - b._i);
  let picked;
  if (!sel) picked = arr.slice(0, dynamicCount(arr.map((e) => e.score)));
  else if (sel.mode === "top") picked = arr.slice(0, sel.n);
  else if (sel.mode === "bottom") picked = arr.slice(Math.max(0, arr.length - sel.n));
  else if (sel.mode === "gt") picked = arr.filter((e) => (sel.inclusive ? e.score >= sel.min : e.score > sel.min));
  else picked = [];
  return picked.map((e) => e.id);
}

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

/** Command catalogue shared by the engine (help text) and completion. /find is the only real search command. */
export const COMMANDS_LIST = [
  { name: "/find", args: true, desc: "搜索 · 词 / tag: / grep: / about:（语义）· & | ! ( )" },
  { name: "/tag", args: true, desc: "= /find（/tag js → tag:js）" },
  { name: "/about", args: true, desc: "= /find about:…（语义，可加 :top-N）" },
  { name: "/grep", args: true, desc: "= /find grep:…（按行匹配）" },
  { name: "/theme", args: true, desc: "auto | paper | tokyo | ink" },
  { name: "/help", args: false, desc: "打开命令说明" },
  { name: "/clear", args: false, desc: "清空输入与提示" },
];

/**
 * Command-bar completion (pure, no DOM). Sources in priority order:
 *   command names → folders → term prefixes (tag: grep: about: …) → tags → post titles → history.
 * /find is the search command; /tag is an alias that accepts the same expressions; /about and /grep complete their own argument.
 * complete(line, ctx) → { items, ghost }
 *   ctx = { series:[{dir,no,slug,title,count}], tags:[string], posts:[{title,dir,stem}], history:[string] }
 *   item = { kind, label, hint, text, exec }   text = the whole new input line after accepting
 *   exec: Enter on this item also runs the resulting line (false → only fills the line in, e.g. "/tag " needs arguments)
 */
export const MAX_ITEMS = 12;
export const THEME_NAMES = ["auto", "paper", "tokyo", "ink"];

/** Term prefixes offered inside a /find expression: [text, hint]. */
export const TERM_PREFIXES = [
  ["tag:", "标签（同 #tag）"],
  ["grep:", "按行匹配（字面 / /正则/i）"],
  ["about:", "语义相似（可加 :top-N / :bottom-N）"],
  ["title:", "只在标题里找"],
  ["body:", "只在正文里找"],
  ["folder:", "文件夹范围"],
];
/** Selector suffixes offered after about:<query>: [text, hint, complete?]. */
export const ABOUT_SELECTORS = [
  ["top-1", "最相似的 1 篇", true],
  ["top-3", "最相似的 3 篇", true],
  ["top-5", "最相似的 5 篇", true],
  ["top-", "top-N：最相似的 N 篇", false],
  ["bottom-1", "最不相似的 1 篇", true],
  ["bottom-2", "最不相似的 2 篇", true],
  ["bottom-", "bottom-N：最不相似的 N 篇", false],
  [">0.85", "相似度 > 0.85", true],
  [">", "相似度阈值 >0.85", false],
];

const low = (s) => String(s || "").toLowerCase();

function push(items, seen, item) {
  if (items.length >= MAX_ITEMS + 8) return;
  if (seen.has(item.text)) return;
  seen.add(item.text);
  items.push(item);
}

function historyItems(line, ctx, items, seen) {
  const L = low(line);
  for (const h of ctx.history || []) {
    if (!h || h === line) continue;
    if (L === "" || low(h).startsWith(L)) push(items, seen, { kind: "hist", label: h, hint: "history", text: h, exec: true });
  }
}

/** Split off the token being typed at the end of a /tag expression. */
export function currentTagToken(rest) {
  let i = rest.length;
  while (i > 0 && !/[\s()&|（）｜＆]/.test(rest[i - 1])) i--;
  const before = rest.slice(0, i);
  let tok = rest.slice(i);
  let prefix = "";
  while (/^[!！]/.test(tok)) {
    prefix += tok[0];
    tok = tok.slice(1);
  }
  return { before, prefix, tok };
}

function inOpenQuote(rest) {
  return (rest.match(/"/g) || []).length % 2 === 1;
}

export function complete(line, ctx = {}) {
  const items = [];
  const seen = new Set([line]); // never offer the line the user already has
  const m = line.match(/^(\/?)(\S*)(\s*)([\s\S]*)$/);
  const word = m[2];
  const slash = m[1] || (word === "" ? "/" : "");
  const hasSpace = m[3].length > 0;

  if (!hasSpace) {
    // ---- command names
    const w = low(word);
    for (const c of COMMANDS_LIST) {
      const bare = c.name.slice(1);
      if (w === "" || bare.startsWith(w)) {
        push(items, seen, {
          kind: "cmd",
          label: slash + bare,
          hint: c.desc,
          text: slash + bare + (c.args ? " " : ""),
          exec: !c.args, // commands that need arguments are only filled in
        });
      }
    }
    historyItems(line, ctx, items, seen);
  } else {
    const cmd = low(word);
    const argStart = line.length - m[4].length;
    const head = line.slice(0, argStart);
    const rest = m[4];
    if (cmd === "find" || cmd === "tag") {
      tagItems(head, rest, ctx, items, seen);
    } else if (cmd === "about") {
      // /about dark:to…  → selector suffixes
      const m2 = rest.match(/^([\s\S]+?):([^\s:"]*)$/);
      if (m2 && !inOpenQuote(m2[1])) selectorItems(head + m2[1] + ":", m2[2], items, seen);
    } else if (cmd === "theme") {
      const w = low(rest.trim());
      for (const t of THEME_NAMES) {
        if (t.startsWith(w) && !/\s/.test(rest.trim())) {
          push(items, seen, { kind: "theme", label: t, hint: "theme", text: head + t, exec: true });
        }
      }
    }
    historyItems(line, ctx, items, seen);
  }

  // keep room for history entries at the end of the menu (they are the lowest priority, not invisible)
  const hist = items.filter((i) => i.kind === "hist").slice(0, 3);
  const rest = items.filter((i) => i.kind !== "hist");
  const out = rest.slice(0, MAX_ITEMS - hist.length).concat(hist);
  const gi = ghostIndex(line, out);
  // auto = item pre-selected in the menu (the one the ghost text shows); -1 = none, Enter runs the typed line
  return { items: out, ghost: gi >= 0 ? out[gi].text.slice(line.length) : "", auto: gi };
}

function tagItems(head, rest, ctx, items, seen) {
  const series = ctx.series || [];
  const tags = ctx.tags || [];
  const posts = ctx.posts || [];

  if (inOpenQuote(rest)) {
    // inside "phrase": complete a post title (closing the quote)
    const qi = rest.lastIndexOf('"');
    const partial = rest.slice(qi + 1);
    const before = rest.slice(0, qi + 1);
    const P = low(partial);
    if (!P) return;
    for (const p of posts) {
      if (low(p.title).startsWith(P) && low(p.title) !== P) {
        push(items, seen, { kind: "post", label: p.title, hint: p.dir + "/", text: head + before + p.title + '"', exec: true });
      }
    }
    return;
  }

  // about:<query>:<selector-in-progress>   (query may be a bare word or a closed "phrase")
  const sm = rest.match(/about:(?:"[^"]*"|[^\s()&|":：]+)[:：]([^\s()&|":：]*)$/i);
  if (sm) {
    const cut = rest.length - sm[1].length;
    selectorItems(head + rest.slice(0, cut), sm[1], items, seen);
    return;
  }

  const { before, prefix, tok } = currentTagToken(rest);
  if (/^\//.test(tok)) return; // regex in progress
  const base = head + before + prefix;
  const T = low(tok);

  // qualifier value: title:xxx / tag:xxx / folder:xxx
  const q = tok.match(/^(title|body|tag|folder|dir):(.*)$/i);
  if (q) {
    const qual = low(q[1]);
    const V = low(q[2]);
    if (qual === "tag") {
      for (const t of tags) if (low(t).startsWith(V)) push(items, seen, { kind: "tag", label: "#" + t, hint: "tag", text: base + q[1] + ":" + t, exec: true });
    } else if (qual === "folder" || qual === "dir") {
      for (const s of series) if (V === "" || low(s.slug).startsWith(V) || low(s.dir).startsWith(V)) push(items, seen, { kind: "folder", label: s.dir + "/", hint: folderHint(s), text: base + q[1] + ":" + s.slug, exec: true });
    } else if (qual === "title") {
      for (const p of posts) if (V && low(p.title).startsWith(V) && low(p.title) !== V) push(items, seen, { kind: "post", label: p.title, hint: p.dir + "/", text: base + q[1] + ":" + (/[\s()&|"]/.test(p.title) ? '"' + p.title + '"' : p.title), exec: true });
    }
    return;
  }

  const tagMode = T.startsWith("#") || T.startsWith("@");
  const hashPfx = tagMode ? tok[0] : "";
  const name = tagMode ? T.slice(1) : T;

  // 1. folders (prefix first, then contains)
  if (!tagMode) {
    const digits = /^\d/.test(T);
    const strong = [];
    const weak = [];
    for (const s of series) {
      const forms = digits ? [s.dir + "/", s.no + "/"] : [s.slug + "/", s.dir + "/", s.title + "/"];
      const hit = T === "" ? forms[0] : forms.find((f) => low(f).startsWith(T));
      if (hit) strong.push({ s, form: hit });
      else if (T && (low(s.slug).includes(T) || low(s.title).includes(T))) weak.push({ s, form: s.slug + "/" });
    }
    for (const { s, form } of strong.concat(weak)) {
      push(items, seen, { kind: "folder", label: form, hint: folderHint(s), text: base + form, exec: true });
    }
  }
  // 1b. term prefixes: tag: grep: about: title: body: folder:
  if (!tagMode && T !== "" && !T.includes(":")) {
    for (const [pfx, hint] of TERM_PREFIXES) {
      if (pfx.startsWith(T)) push(items, seen, { kind: "term", label: pfx, hint, text: base + pfx, exec: false });
    }
  }
  // 2. tags
  for (const t of tags) {
    const L = low(t);
    if (tagMode ? L.startsWith(name) : L.startsWith(T)) {
      push(items, seen, { kind: "tag", label: "#" + t, hint: "tag", text: base + (hashPfx || "#") + t, exec: true });
    }
  }
  // 3. post titles (bare title if it is one word, otherwise a quoted phrase)
  if (!tagMode && T !== "") {
    for (const p of posts) {
      const L = low(p.title);
      if (L.startsWith(T) || (T.length >= 2 && L.includes(T))) {
        const lit = /[\s()&|"]/.test(p.title) ? '"' + p.title + '"' : p.title;
        push(items, seen, { kind: "post", label: p.title, hint: p.dir + "/", text: base + lit, exec: true });
      }
    }
  }
}

function selectorItems(base, partial, items, seen) {
  const P = low(partial);
  for (const [sel, hint, done] of ABOUT_SELECTORS) {
    if (sel.startsWith(P) && sel !== P) push(items, seen, { kind: "term", label: sel, hint, text: base + sel, exec: done });
  }
}

function folderHint(s) {
  return `${s.title} · ${s.count} 篇`;
}

/** Index of the first candidate that literally continues what was typed (its remainder is the ghost text). */
export function ghostIndex(line, items) {
  if (!line || /\s$/.test(line)) return -1;
  const L = low(line);
  return items.findIndex((it) => it.text.length > line.length && low(it.text).startsWith(L) && it.text.slice(line.length).trim() !== "");
}

/** Pure terminal command engine for the note TUI blog. */
/** Hidden easter-egg page (type /lost). */
export const EGG_HREF = "egg.html";
export const EGG_POST = {
  title: "???",
  stem: "egg",
  href: EGG_HREF,
  tags: [],
};

export const THEMES = ["auto", "tokyo", "paper", "ink"];

export const COMMANDS = COMMANDS_LIST;

export function searchHref(expr) {
  return "search.html?q=" + encodeURIComponent(expr);
}

const stripCf = (s) => String(s == null ? "" : s).replace(/[\p{Cf}]/gu, "").trim();

/** Quote a value for a find term only when it needs it. */
function quoteIfNeeded(v) {
  if (/^"(?:[^"\\]|\\.)*"$/.test(v)) return v; // already a quoted phrase
  if (/[\s()&|!"'：:（）｜＆！]/.test(v) || v === "") return '"' + v.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
  return v;
}

/**
 * /tag sugar: a lone bare word that names a known tag becomes tag:word (/tag js → tag:js); with no tag list given it is
 * assumed to be a tag. Anything else — including a lone word that is not a tag, like the old /tag 心跳 — is already a
 * find expression and is passed through unchanged (full back-compat with the old /tag grammar).
 */
export function rewriteTag(arg, knownTags) {
  const a = stripCf(arg);
  if (/^[^\s()&|!"'#@:/\\（）｜＆！：]+$/.test(a) && !a.endsWith("/")) {
    if (!knownTags) return "tag:" + a;
    const want = normalizeTag(a);
    if (knownTags.some((t) => normalizeTag(t) === want)) return "tag:" + a;
  }
  return a;
}

/** /about sugar: `dark`, `dark:top-3`, `black cat guilt`, `"the raven":bottom-2` → about:… */
export function rewriteAbout(arg) {
  const a = stripCf(arg).replace(/[：]/g, ":");
  if (!a) return "";
  const m = a.match(/^([\s\S]*?):((?:top|bottom)(?:-\S*)?|>=?\S*)$/i);
  const sel = m ? ":" + m[2] : "";
  const q = (m ? m[1] : a).trim();
  return "about:" + quoteIfNeeded(q) + sel;
}

/** /grep sugar: `pat`, `/re/i`, `"a b"`, `two words` → grep:… */
export function rewriteGrep(arg) {
  const a = stripCf(arg);
  if (!a) return "";
  if (/^\/[\s\S]+\/[a-z]*$/.test(a)) return "grep:" + a;
  return "grep:" + quoteIfNeeded(a);
}

/**
 * Parse a command line. There is ONE search command, /find <expr>; /tag /about /grep are sugar that rewrite to a
 * find expression → { kind:"find", cmd, arg, query } (query = canonical find expression, "" when the argument is missing).
 */
export function parseLine(raw, knownTags) {
  const line = scrubInvisible(raw).trim();
  if (/^\/?help$/i.test(line)) return { kind: "help" };
  // find-family commands keep the raw text: the query parser handles full-width operators itself.
  let m = stripCf(raw).match(/^\/?(find|tag|about|grep)(?:\s+([\s\S]*))?$/i);
  if (m) {
    const cmd = m[1].toLowerCase();
    const arg = m[2] == null ? "" : m[2].trim();
    let query = "";
    if (arg) {
      if (cmd === "find") query = arg;
      else if (cmd === "tag") query = rewriteTag(arg, knownTags);
      else if (cmd === "about") query = rewriteAbout(arg);
      else query = rewriteGrep(arg);
    }
    return { kind: "find", cmd, arg, query };
  }
  m = line.match(/^\/?goto(?:\s+(.*))?$/i);
  if (m) {
    return { kind: "echo", message: "/goto is gone — use /find <expr>  (e.g. /find poe/ 乌鸦)", err: true };
  }
  if (/^\/?clear$/i.test(line)) return { kind: "clear" };
  if (/^\/?lost$/i.test(line)) return { kind: "lost" };
  m = line.match(/^\/?theme(?:\s+(.*))?$/i);
  if (m) return { kind: "theme", name: m[1] == null ? null : m[1].trim().toLowerCase() };
  return { kind: "other", text: line };
}

const USAGE = {
  find: "usage: /find <expr>   e.g.  /find poe/ & (乌鸦 | about:死亡:top-2) & !#draft",
  tag: "usage: /tag <expr>   (sugar for /find — /tag js = /find tag:js)",
  about: "usage: /about <query>[:top-N | :bottom-N]   e.g.  /about dark:top-3   (= /find about:dark:top-3)",
  grep: "usage: /grep <pattern>   e.g.  /grep raven   /grep /rav.n/i   (= /find grep:…)",
};

export function findPostByStem(posts, stem) {
  const list = Array.isArray(posts) ? posts : [];
  const want = String(stem || "").toLowerCase();
  const exact = list.find((p) => String(p.stem).toLowerCase() === want);
  if (exact) return exact;
  return list.find((p) => String(p.stem).toLowerCase().includes(want)) || null;
}

export function findHelpPost(posts) {
  return (
    findPostByStem(posts, "00-help") ||
    (Array.isArray(posts) ? posts : []).find((p) =>
      postTags(p).some((t) => normalizeTag(t) === "help")
    ) ||
    null
  );
}

/**
 * Create a stateful terminal engine.
 * `navigating` must be reset on pageshow (bfcache back) or goTo stays dead.
 */
export function createTermEngine(options = {}) {
  const posts = Array.isArray(options.posts) ? options.posts : [];
  const knownTags = Array.from(new Set(posts.reduce((a, p) => a.concat(postTags(p)), [])));
  let navigating = false;

  function submit(raw) {
    const line = scrubInvisible(raw).trim();
    if (!line) return { type: "noop" };
    const parsed = parseLine(raw, knownTags);

    if (parsed.kind === "echo") return { type: "echo", message: parsed.message, err: true };
    if (parsed.kind === "help") {
      const post = findHelpPost(posts);
      if (!post) return { type: "echo", message: "help post not found", err: true };
      return { type: "navigate", post };
    }
    if (parsed.kind === "clear") return { type: "clear" };
    if (parsed.kind === "lost") return { type: "navigate", post: EGG_POST, egg: true };

    if (parsed.kind === "find") {
      if (!parsed.query) return { type: "echo", message: USAGE[parsed.cmd], err: true };
      const r = parseQuery(parsed.query);
      if (!r.ok) {
        const shown = parsed.query === parsed.arg ? "" : "\n(as /find " + parsed.query + ")";
        return { type: "echo", message: formatQueryError(parsed.query, r.error) + shown, err: true };
      }
      if (!r.ast) return { type: "echo", message: USAGE[parsed.cmd], err: true };
      return { type: "search", cmd: parsed.cmd, query: parsed.query, href: searchHref(parsed.query) };
    }

    if (parsed.kind === "theme") {
      if (!parsed.name || !THEMES.includes(parsed.name)) {
        return {
          type: "echo",
          message: "usage: /theme " + THEMES.join(" | ") + "  (auto=白天paper/晚上tokyo)",
          err: !!parsed.name,
        };
      }
      return { type: "theme", name: parsed.name };
    }

    return { type: "echo", message: "command not found: " + line + "   (try /find /theme /help)", err: true };
  }

  return {
    parseLine,
    submit,
    findHelpPost: () => findHelpPost(posts),
    isNavigating: () => navigating,
    beginNavigate() {
      if (navigating) return false;
      navigating = true;
      return true;
    },
    resetNavigation() {
      navigating = false;
    },
  };
}

