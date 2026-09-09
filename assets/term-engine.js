/** Pure terminal command engine for the note TUI blog. */

export const TAG_EXPR_MAX = 64;

/** Hidden page for /goto with no matches. */
export const EGG_HREF = "egg.html";
export const EGG_POST = {
  title: "???",
  stem: "egg",
  href: EGG_HREF,
  tags: [],
};

/**
 * Strip IME / Unicode junk that looks empty but breaks exact tag match:
 * ZWSP, ZWNJ/ZWJ, BOM, soft hyphen, word joiner, bidi marks, etc.
 * Also NFKC + fullwidth ASCII → halfwidth so ＂ｍｅｔａ＂ ≡ "meta".
 */
export function scrubInvisible(s) {
  return (
    String(s || "")
      .normalize("NFKC")
      // All Unicode Format chars (ZWSP/BOM/bidi/soft-hyphen/…) — IME favorites.
      .replace(/\p{Cf}/gu, "")
      // Other controls except TAB/LF/CR (should not appear in tags anyway).
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "")
  );
}

/** Hex codepoints for diagnostics (e.g. echo when tag query misses). */
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

export function parseLine(raw) {
  const line = scrubInvisible(raw).trim();
  if (/^\/?help$/i.test(line)) return { kind: "help" };
  if (/^\/?welcome$/i.test(line)) return { kind: "welcome" };
  let m = line.match(/^\/?goto(?:\s+(.*))?$/i);
  if (m) return { kind: "goto", query: m[1] == null ? null : m[1] };
  m = line.match(/^\/?tag(?:\s+(.*))?$/i);
  if (m) return { kind: "tag", query: m[1] == null ? null : m[1] };
  m = line.match(/^\/?about(?:\s+(.*))?$/i);
  if (m) return { kind: "about", query: m[1] == null ? null : m[1] };
  if (/^clear$/i.test(line)) return { kind: "clear" };
  return { kind: "other", text: line };
}

export function postTags(p) {
  return Array.isArray(p?.tags) ? p.tags : [];
}

export function postHasTag(p, atom) {
  return postMatchesAtom(p, atom);
}

/**
 * Dumb stable matcher for small blogs: exact or prefix on normalized tags.
 * ASCII lowercased; Chinese kept as-is (no case). Mid-string does NOT match.
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

/** Tag token: optional @, then letters/digits/_/-/CJK (incl. extension A bit). */
const TAG_ATOM_RE = /@?[\w\u3400-\u9fff\uF900-\uFAFF\-]+/u;

function stripOuterParens(s) {
  let t = s.trim();
  while (t.startsWith("(") && t.endsWith(")")) {
    let depth = 0;
    let ok = true;
    for (let i = 0; i < t.length; i++) {
      if (t[i] === "(") depth++;
      else if (t[i] === ")") {
        depth--;
        if (depth === 0 && i !== t.length - 1) {
          ok = false;
          break;
        }
      }
    }
    if (!ok || depth !== 0) break;
    t = t.slice(1, -1).trim();
  }
  return t;
}

/**
 * Split by top-level separator (e.g. '||' or '&'), respecting parentheses.
 */
function splitTopLevel(s, sep) {
  const out = [];
  let depth = 0;
  let buf = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "(") {
      depth++;
      buf += ch;
      continue;
    }
    if (ch === ")") {
      depth--;
      buf += ch;
      continue;
    }
    if (depth === 0 && s.startsWith(sep, i)) {
      out.push(buf.trim());
      buf = "";
      i += sep.length - 1;
      continue;
    }
    buf += ch;
  }
  out.push(buf.trim());
  return out.filter(Boolean);
}

/**
 * Soften incomplete queries while typing: drop trailing & / || / (
 */
export function softenTagQuery(q) {
  return scrubInvisible(q)
    .trim()
    .replace(/(\s*(&|\|\||\()\s*)+$/g, "")
    .trim();
}

/**
 * Evaluate a tag expression against one post.
 * Grammar (top-down): OR (||) > AND (&) > ( groups ) > atom
 */
export function postMatchesTagExpr(p, expr) {
  const raw = softenTagQuery(expr);
  if (!raw) return postTags(p).length > 0;

  function evalExpr(s) {
    const t = stripOuterParens(s);
    const orParts = splitTopLevel(t, "||");
    if (orParts.length > 1) {
      return orParts.some((part) => evalExpr(part));
    }
    const andParts = splitTopLevel(t, "&");
    if (andParts.length > 1) {
      return andParts.every((part) => evalExpr(part));
    }
    const atom = t.trim();
    if (!atom) return true;
    if (!TAG_ATOM_RE.test(atom) && /[()]/.test(atom)) {
      // unbalanced junk — no match
      return false;
    }
    // single atom (allow @); scrub invisibles so IME ZWSP does not break ===
    const atomClean = scrubInvisible(atom).replace(/\s/g, "");
    const m = atomClean.match(TAG_ATOM_RE);
    if (!m || m[0] !== atomClean) {
      const cleaned = atomClean.replace(/[()]/g, "");
      if (!cleaned) return true;
      return postMatchesAtom(p, cleaned);
    }
    return postMatchesAtom(p, m[0]);
  }

  return evalExpr(raw);
}

export function filterPostsByTag(posts, query, maxLen = TAG_EXPR_MAX) {
  const list = Array.isArray(posts) ? posts : [];
  const raw = scrubInvisible(query).trim();
  // Empty expr → no matches (never dump the whole catalog).
  if (!raw) {
    return { posts: [], error: null };
  }
  if (raw.length > maxLen) {
    return { posts: [], error: `tag expr max ${maxLen} chars` };
  }
  // Always soft-parse for live typing; never throw to the UI.
  try {
    const hits = list.filter((p) => postMatchesTagExpr(p, raw));
    return { posts: hits, error: null };
  } catch (err) {
    return {
      posts: [],
      error: "tag parse: " + (err && err.message ? err.message : "error"),
    };
  }
}

export function filterPostsByTitle(posts, query) {
  const list = Array.isArray(posts) ? posts : [];
  const q = String(query || "").trim().toLowerCase();
  if (!q) return list.slice();
  return list.filter(
    (p) =>
      String(p.title).toLowerCase().includes(q) ||
      String(p.stem).toLowerCase().includes(q)
  );
}

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

export function findWelcomePost(posts) {
  return (
    findPostByStem(posts, "01-welcome") ||
    (Array.isArray(posts) ? posts : []).find((p) =>
      postTags(p).some((t) => normalizeTag(t) === "welcome")
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
  const tagExprMax = options.tagExprMax ?? TAG_EXPR_MAX;
  let navigating = false;

  function suggest(raw) {
    const parsed = parseLine(raw);
    if (parsed.kind === "goto") {
      if (parsed.query === null) return { parsed, matches: [], error: null };
      return {
        parsed,
        matches: filterPostsByTitle(posts, parsed.query),
        error: null,
      };
    }
    if (parsed.kind === "tag") {
      // No query yet (just `/tag`) → no dropdown. Need an expression to filter.
      if (parsed.query === null) return { parsed, matches: [], error: null };
      const r = filterPostsByTag(posts, parsed.query, tagExprMax);
      return { parsed, matches: r.posts, error: r.error };
    }
    return { parsed, matches: [], error: null };
  }

  function pickGoto(matches, query, selectedIndex) {
    if (!matches.length) return null;
    const q = String(query || "").trim().toLowerCase();
    const exact = matches.filter(
      (p) => p.title.toLowerCase() === q || p.stem.toLowerCase() === q
    );
    if (exact.length === 1) return exact[0];
    const i =
      selectedIndex >= 0 && selectedIndex < matches.length ? selectedIndex : 0;
    return matches[i] || matches[0];
  }

  function submit(raw, selectedIndex = 0) {
    const line = String(raw || "").trim();
    if (!line) return { type: "noop" };

    const { parsed, matches, error } = suggest(line);
    if (error) return { type: "echo", message: error, err: true };

    if (parsed.kind === "help") {
      const post = findHelpPost(posts);
      if (!post) return { type: "echo", message: "help post not found", err: true };
      return { type: "navigate", post };
    }
    if (parsed.kind === "welcome") {
      const post = findWelcomePost(posts);
      if (!post)
        return { type: "echo", message: "welcome post not found", err: true };
      return { type: "navigate", post };
    }
    if (parsed.kind === "clear") return { type: "clear" };

    if (parsed.kind === "goto") {
      if (parsed.query === null) return { type: "noop" };
      const post = pickGoto(matches, parsed.query, selectedIndex);
      if (!post) return { type: "navigate", post: EGG_POST, egg: true };
      return { type: "navigate", post };
    }
    if (parsed.kind === "tag") {
      const tagQ = parsed.query == null ? "" : String(parsed.query).trim();
      if (!tagQ) {
        return {
          type: "echo",
          message: "usage: /tag <expr>  e.g. /tag poe  or  /tag meta&intro",
          err: true,
        };
      }
      if (!matches.length)
        return { type: "echo", message: "no match: " + tagQ, err: true };
      const i =
        selectedIndex >= 0 && selectedIndex < matches.length
          ? selectedIndex
          : 0;
      return { type: "navigate", post: matches[i] };
    }

    if (parsed.kind === "about") {
      if (parsed.query === null || !String(parsed.query).trim()) {
        return {
          type: "echo",
          message: "usage: /about <query>  (semantic full-text)",
          err: true,
        };
      }
      return { type: "about", query: String(parsed.query).trim() };
    }

    return { type: "echo", message: "command not found: " + line, err: true };
  }

  return {
    parseLine,
    suggest,
    submit,
    filterPostsByTitle: (q) => filterPostsByTitle(posts, q),
    filterPostsByTag: (q) => filterPostsByTag(posts, q, tagExprMax),
    findHelpPost: () => findHelpPost(posts),
    findWelcomePost: () => findWelcomePost(posts),
    isNavigating: () => navigating,
    beginNavigate() {
      if (navigating) return false;
      navigating = true;
      return true;
    },
    /** Call on pageshow / visibility restore after bfcache back. */
    resetNavigation() {
      navigating = false;
    },
  };
}
