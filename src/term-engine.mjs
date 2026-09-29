/** Pure terminal command engine for the note TUI blog. */
import { scrubInvisible, codepointsHex, normalizeTag } from "./text-scrub.mjs";
import { postTags, tagAtomMatches } from "./tag-match.mjs";
import { parseQuery, formatQueryError, cleanExpr, searchDocs, makeSnippet, highlightParts } from "./query.mjs";
import { complete } from "./complete.mjs";
import { COMMANDS_LIST } from "./commands-list.mjs";

export {
  parseQuery,
  formatQueryError,
  cleanExpr,
  searchDocs,
  makeSnippet,
  highlightParts,
  complete,
  scrubInvisible,
  codepointsHex,
  normalizeTag,
  postTags,
  tagAtomMatches,
};

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

export function parseLine(raw) {
  const line = scrubInvisible(raw).trim();
  if (/^\/?help$/i.test(line)) return { kind: "help" };
  // /tag keeps the raw text: the query parser handles full-width operators itself.
  let m = String(raw == null ? "" : raw).replace(/[\p{Cf}]/gu, "").trim().match(/^\/?tag(?:\s+([\s\S]*))?$/i);
  if (m) return { kind: "tag", query: m[1] == null ? null : m[1].trim() };
  m = line.match(/^\/?goto(?:\s+(.*))?$/i);
  if (m) {
    return { kind: "echo", message: "/goto is gone — use /tag <expr>  (e.g. /tag poe/ 乌鸦)", err: true };
  }
  m = line.match(/^\/?about(?:\s+(.*))?$/i);
  if (m) return { kind: "about", query: m[1] == null ? null : m[1] };
  if (/^\/?clear$/i.test(line)) return { kind: "clear" };
  if (/^\/?lost$/i.test(line)) return { kind: "lost" };
  m = line.match(/^\/?theme(?:\s+(.*))?$/i);
  if (m) return { kind: "theme", name: m[1] == null ? null : m[1].trim().toLowerCase() };
  return { kind: "other", text: line };
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

/**
 * Create a stateful terminal engine.
 * `navigating` must be reset on pageshow (bfcache back) or goTo stays dead.
 */
export function createTermEngine(options = {}) {
  const posts = Array.isArray(options.posts) ? options.posts : [];
  let navigating = false;

  function submit(raw) {
    const line = scrubInvisible(raw).trim();
    if (!line) return { type: "noop" };
    const parsed = parseLine(raw);

    if (parsed.kind === "echo") return { type: "echo", message: parsed.message, err: true };
    if (parsed.kind === "help") {
      const post = findHelpPost(posts);
      if (!post) return { type: "echo", message: "help post not found", err: true };
      return { type: "navigate", post };
    }
    if (parsed.kind === "clear") return { type: "clear" };
    if (parsed.kind === "lost") return { type: "navigate", post: EGG_POST, egg: true };

    if (parsed.kind === "tag") {
      if (!parsed.query) {
        return { type: "echo", message: "usage: /tag <expr>   e.g.  /tag poe/ & (乌鸦 | 死亡) & !#draft", err: true };
      }
      const r = parseQuery(parsed.query);
      if (!r.ok) return { type: "echo", message: formatQueryError(parsed.query, r.error), err: true };
      if (!r.ast) return { type: "echo", message: "usage: /tag <expr>", err: true };
      return { type: "search", query: parsed.query, href: searchHref(parsed.query) };
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

    if (parsed.kind === "about") {
      if (parsed.query === null || !scrubInvisible(parsed.query).trim()) {
        return { type: "echo", message: "usage: /about <query>  (semantic full-text)", err: true };
      }
      return { type: "about", query: scrubInvisible(parsed.query).trim() };
    }

    return { type: "echo", message: "command not found: " + line + "   (try /tag /about /theme /help)", err: true };
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
