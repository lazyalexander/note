/** Pure terminal command engine for the note TUI blog. */
import { scrubInvisible, codepointsHex, normalizeTag } from "./text-scrub.mjs";
import { postTags, tagAtomMatches } from "./tag-match.mjs";
import { parseQuery, formatQueryError, cleanExpr, searchDocs, searchDocsAsync, makeSnippet, highlightParts, hasAbout, grepMatchLines, makeResultView } from "./query.mjs";
import { complete } from "./complete.mjs";
import { scoreEmbeddings, selectAbout, dynamicCount } from "./about.mjs";
import { COMMANDS_LIST } from "./commands-list.mjs";

export {
  parseQuery,
  formatQueryError,
  cleanExpr,
  searchDocs,
  searchDocsAsync,
  hasAbout,
  grepMatchLines,
  makeResultView,
  makeSnippet,
  highlightParts,
  complete,
  scoreEmbeddings,
  selectAbout,
  dynamicCount,
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
  let m = stripCf(raw).replace(/^\S+/, (command) => scrubInvisible(command)).match(/^\/?(find|tag|about|grep)(?:\s+([\s\S]*))?$/i);
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
  find: "用法：/find 关键词，例如 /find 心跳 或 /find tag:poe",
  tag: "用法：/tag 标签，例如 /tag meta（等同 /find tag:meta）",
  about: "用法：/about 描述，例如 /about 死亡:top-3",
  grep: "用法：/grep 关键词或正则，例如 /grep raven 或 /grep /rav.n/i",
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
    if (line === "/" || line === ":") return { type: "echo", message: "输入 /find 关键词 搜索笔记，或 /help 查看命令说明。", err: false };
    const parsed = parseLine(raw, knownTags);

    if (parsed.kind === "echo") return { type: "echo", message: parsed.message, err: true };
    if (parsed.kind === "help") {
      const post = findHelpPost(posts);
      if (!post) return { type: "echo", message: "未找到命令说明文章。", err: true };
      return { type: "navigate", post };
    }
    if (parsed.kind === "clear") return { type: "clear" };
    if (parsed.kind === "lost") return { type: "navigate", post: EGG_POST, egg: true };

    if (parsed.kind === "find") {
      if (!parsed.query) return { type: "echo", message: USAGE[parsed.cmd], err: true };
      const r = parseQuery(parsed.query);
      if (!r.ok) {
        const shown = parsed.query === parsed.arg ? "" : "\n(as /find " + parsed.query + ")";
        return { type: "echo", message: "表达式有误 · " + formatQueryError(parsed.query, r.error) + shown + "\n请修改标记处后重试；/help 可查看语法。", err: true };
      }
      if (!r.ast) return { type: "echo", message: USAGE[parsed.cmd], err: true };
      return { type: "search", cmd: parsed.cmd, query: parsed.query, href: searchHref(parsed.query) };
    }

    if (parsed.kind === "theme") {
      if (!parsed.name || !THEMES.includes(parsed.name)) {
        return {
          type: "echo",
          message: (parsed.name ? "未知主题：" + parsed.name + "。\n" : "") + "用法：/theme paper（白天）| tokyo（夜间）| ink（深色）| auto（自动）",
          err: !!parsed.name,
        };
      }
      return { type: "theme", name: parsed.name };
    }

    return { type: "echo", message: "未知命令：" + line + "\n可用命令：/find 搜索 · /theme 主题 · /help 说明。搜索文字请写成 /find " + line, err: true };
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
