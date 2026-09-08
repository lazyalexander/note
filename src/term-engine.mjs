/** Pure terminal command engine for the note TUI blog. */

export const TAG_EXPR_MAX = 64;

export function normalizeTag(t) {
  return String(t || "")
    .trim()
    .toLowerCase()
    .replace(/^@/, "");
}

export function parseLine(raw) {
  const line = String(raw || "").trim();
  if (/^\/?help$/i.test(line)) return { kind: "help" };
  if (/^\/?welcome$/i.test(line)) return { kind: "welcome" };
  let m = line.match(/^\/?goto(?:\s+(.*))?$/i);
  if (m) return { kind: "goto", query: m[1] == null ? null : m[1] };
  m = line.match(/^\/?tag(?:\s+(.*))?$/i);
  if (m) return { kind: "tag", query: m[1] == null ? null : m[1] };
  if (/^clear$/i.test(line)) return { kind: "clear" };
  return { kind: "other", text: line };
}

export function postTags(p) {
  return Array.isArray(p?.tags) ? p.tags : [];
}

export function postHasTag(p, atom) {
  const want = normalizeTag(atom);
  if (!want) return false;
  return postTags(p).some((t) => normalizeTag(t) === want);
}

export function postHasTagFuzzy(p, atom) {
  const want = normalizeTag(atom);
  if (!want) return false;
  return postTags(p).some((t) => normalizeTag(t).indexOf(want) !== -1);
}

export function tokenizeTagExpr(src) {
  const s = String(src || "");
  const tokens = [];
  let i = 0;
  while (i < s.length) {
    if (/\s/.test(s[i])) {
      i++;
      continue;
    }
    if (s[i] === "(" || s[i] === ")") {
      tokens.push({ type: s[i] });
      i++;
      continue;
    }
    if (s[i] === "&") {
      tokens.push({ type: "&" });
      i++;
      continue;
    }
    if (s[i] === "|" && s[i + 1] === "|") {
      tokens.push({ type: "||" });
      i += 2;
      continue;
    }
    const m = s.slice(i).match(/^@?[\w\-\u4e00-\u9fff]+/);
    if (m) {
      tokens.push({ type: "tag", value: m[0] });
      i += m[0].length;
      continue;
    }
    throw new Error("bad token near: " + s.slice(i, i + 8));
  }
  return tokens;
}

export function parseTagExpr(src) {
  const tokens = tokenizeTagExpr(src);
  let pos = 0;

  function peek() {
    return tokens[pos] || null;
  }
  function take(type) {
    const t = peek();
    if (!t || (type && t.type !== type)) return null;
    pos++;
    return t;
  }

  function parsePrimary() {
    if (take("(")) {
      const node = parseOr();
      if (!take(")")) throw new Error("missing )");
      return node;
    }
    const t = take("tag");
    if (!t) throw new Error("expected tag");
    return { type: "tag", value: t.value };
  }

  function parseAnd() {
    let node = parsePrimary();
    while (peek() && peek().type === "&") {
      take("&");
      node = { type: "&", left: node, right: parsePrimary() };
    }
    return node;
  }

  function parseOr() {
    let node = parseAnd();
    while (peek() && peek().type === "||") {
      take("||");
      node = { type: "||", left: node, right: parseAnd() };
    }
    return node;
  }

  if (!tokens.length) throw new Error("empty");
  const tree = parseOr();
  if (pos !== tokens.length) throw new Error("trailing input");
  return tree;
}

export function evalTagNode(node, p, fuzzy) {
  if (!node) return false;
  if (node.type === "tag") {
    return fuzzy ? postHasTagFuzzy(p, node.value) : postHasTag(p, node.value);
  }
  if (node.type === "&") {
    return evalTagNode(node.left, p, fuzzy) && evalTagNode(node.right, p, fuzzy);
  }
  if (node.type === "||") {
    return evalTagNode(node.left, p, fuzzy) || evalTagNode(node.right, p, fuzzy);
  }
  return false;
}

export function exprHasOps(node) {
  return !!(node && node.type !== "tag");
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

export function filterPostsByTag(posts, query, maxLen = TAG_EXPR_MAX) {
  const list = Array.isArray(posts) ? posts : [];
  const q = String(query || "").trim();
  if (!q) {
    return {
      posts: list.filter((p) => postTags(p).length > 0),
      error: null,
    };
  }
  if (q.length > maxLen) {
    return { posts: [], error: `tag expr max ${maxLen} chars` };
  }
  try {
    const tree = parseTagExpr(q);
    const fuzzy = !exprHasOps(tree);
    return {
      posts: list.filter((p) => evalTagNode(tree, p, fuzzy)),
      error: null,
    };
  } catch (err) {
    return {
      posts: [],
      error: "tag parse: " + (err && err.message ? err.message : "error"),
    };
  }
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
      if (!post)
        return { type: "echo", message: "no match: " + parsed.query, err: true };
      return { type: "navigate", post };
    }
    if (parsed.kind === "tag") {
      if (parsed.query === null) {
        return {
          type: "suggest",
          matches: filterPostsByTag(posts, "", tagExprMax).posts,
        };
      }
      if (!matches.length)
        return { type: "echo", message: "no match: " + parsed.query, err: true };
      const i =
        selectedIndex >= 0 && selectedIndex < matches.length
          ? selectedIndex
          : 0;
      return { type: "navigate", post: matches[i] };
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
