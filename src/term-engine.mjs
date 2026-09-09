/** Pure terminal command engine for the note TUI blog. */
import { scrubInvisible, codepointsHex, normalizeTag } from "./text-scrub.mjs";
import { postTags, tagAtomMatches } from "./tag-match.mjs";

export {
  scrubInvisible,
  codepointsHex,
  normalizeTag,
  postTags,
  tagAtomMatches,
};

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
  let m = line.match(/^\/?goto(?:\s+(.*))?$/i);
  if (m) return { kind: "goto", query: m[1] == null ? null : m[1] };
  m = line.match(/^\/?about(?:\s+(.*))?$/i);
  if (m) return { kind: "about", query: m[1] == null ? null : m[1] };
  if (/^clear$/i.test(line)) return { kind: "clear" };
  // Former /tag command — point people to /goto.
  m = line.match(/^\/?tag(?:\s+(.*))?$/i);
  if (m) {
    return {
      kind: "echo",
      message:
        "/tag removed — use /goto <query> (title or tag)",
      err: true,
    };
  }
  return { kind: "other", text: line };
}

/**
 * /goto search: title/stem substring OR tag prefix/exact.
 * Scrubs IME junk first. Empty query → no list (never dump catalog).
 */
export function filterPostsForGoto(posts, query) {
  const list = Array.isArray(posts) ? posts : [];
  const q = scrubInvisible(query).trim().replace(/^@+/, "");
  if (!q) return [];
  const qLower = q.toLowerCase();
  return list.filter((p) => {
    const title = String(p.title || "").toLowerCase();
    const stem = String(p.stem || "").toLowerCase();
    if (title.includes(qLower) || stem.includes(qLower)) return true;
    return postTags(p).some((tg) => tagAtomMatches(tg, q));
  });
}

/** @deprecated alias */
export function filterPostsByTitle(posts, query) {
  return filterPostsForGoto(posts, query);
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
  let navigating = false;

  function suggest(raw) {
    const parsed = parseLine(raw);
    if (parsed.kind === "echo") {
      return { parsed, matches: [], error: parsed.message };
    }
    if (parsed.kind === "goto") {
      if (parsed.query === null) return { parsed, matches: [], error: null };
      return {
        parsed,
        matches: filterPostsForGoto(posts, parsed.query),
        error: null,
      };
    }
    return { parsed, matches: [], error: null };
  }

  function pickGoto(matches, query, selectedIndex) {
    if (!matches.length) return null;
    const q = scrubInvisible(query).trim().toLowerCase().replace(/^@+/, "");
    const exact = matches.filter((p) => {
      if (String(p.title).toLowerCase() === q || String(p.stem).toLowerCase() === q)
        return true;
      return postTags(p).some((tg) => normalizeTag(tg) === q);
    });
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
      if (parsed.query === null) {
        return {
          type: "echo",
          message: "usage: /goto <query>  (title, stem, or tag)",
          err: true,
        };
      }
      const post = pickGoto(matches, parsed.query, selectedIndex);
      // Miss → easter egg page (kept on purpose).
      if (!post) return { type: "navigate", post: EGG_POST, egg: true };
      return { type: "navigate", post };
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
    filterPostsForGoto: (q) => filterPostsForGoto(posts, q),
    filterPostsByTitle: (q) => filterPostsForGoto(posts, q),
    findHelpPost: () => findHelpPost(posts),
    findWelcomePost: () => findWelcomePost(posts),
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
