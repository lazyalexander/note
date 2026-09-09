/** Auto-bundled from text-scrub + tag-match + term-engine. */

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

/** Pure terminal command engine for the note TUI blog. */
/** @deprecated use TAG_QUERY_MAX */
export const TAG_EXPR_MAX = TAG_QUERY_MAX;

/** Hidden page for /goto with no matches. */
export const EGG_HREF = "egg.html";
export const EGG_POST = {
  title: "???",
  stem: "egg",
  href: EGG_HREF,
  tags: [],
};

export function parseLine(raw) {
  const line = scrubInvisible(raw).trim();
  if (/^\/?help$/i.test(line)) return { kind: "help" };
  if (/^\/?welcome$/i.test(line)) return { kind: "welcome" };
  let m = line.match(/^\/?tag(?:\s+(.*))?$/i);
  if (m) return { kind: "tag", query: m[1] == null ? null : m[1] };
  m = line.match(/^\/?goto(?:\s+(.*))?$/i);
  if (m) return { kind: "goto", query: m[1] == null ? null : m[1] };
  m = line.match(/^\/?about(?:\s+(.*))?$/i);
  if (m) return { kind: "about", query: m[1] == null ? null : m[1] };
  if (/^clear$/i.test(line)) return { kind: "clear" };
  return { kind: "other", text: line };
}

export function filterPostsByTitle(posts, query) {
  const list = Array.isArray(posts) ? posts : [];
  const q = scrubInvisible(query).trim().toLowerCase();
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
  const tagQueryMax = options.tagExprMax ?? options.tagQueryMax ?? TAG_QUERY_MAX;
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
      if (parsed.query === null) return { parsed, matches: [], error: null };
      const r = filterPostsByTag(posts, parsed.query, tagQueryMax);
      return { parsed, matches: r.posts, error: r.error };
    }
    return { parsed, matches: [], error: null };
  }

  function pickGoto(matches, query, selectedIndex) {
    if (!matches.length) return null;
    const q = scrubInvisible(query).trim().toLowerCase();
    const exact = matches.filter(
      (p) => p.title.toLowerCase() === q || p.stem.toLowerCase() === q
    );
    if (exact.length === 1) return exact[0];
    const i =
      selectedIndex >= 0 && selectedIndex < matches.length ? selectedIndex : 0;
    return matches[i] || matches[0];
  }

  function submit(raw, selectedIndex = 0) {
    const line = scrubInvisible(raw).trim();
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
      const tagQ =
        parsed.query == null ? "" : scrubInvisible(parsed.query).trim();
      if (!tagQ) {
        return {
          type: "echo",
          message: "usage: /tag <prefix>  e.g. /tag poe  or  /tag 欢",
          err: true,
        };
      }
      if (!matches.length) {
        return {
          type: "echo",
          message: "no match: " + tagQ + " · cp " + codepointsHex(parsed.query),
          err: true,
        };
      }
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
      return { type: "about", query: scrubInvisible(parsed.query).trim() };
    }

    return { type: "echo", message: "command not found: " + line, err: true };
  }

  return {
    parseLine,
    suggest,
    submit,
    filterPostsByTitle: (q) => filterPostsByTitle(posts, q),
    filterPostsByTag: (q) => filterPostsByTag(posts, q, tagQueryMax),
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

