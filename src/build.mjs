import { readdir, readFile, writeFile, mkdir, cp, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";
import hljs from "highlight.js";
import { loadContent } from "./content.mjs";
import { partitionHomeSeries } from "./home-content.mjs";
import { resolveTheme } from "./themes.mjs";
import { formatMessage, languages } from "../assets/messages.mjs";
import { exhaustHtml, fleetEscortsHtml } from "./fleet.mjs";
import { buildSearchIndex } from "./search-index.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
// Fonts: Source Serif 4 + Noto Serif SC (body), Source Sans 3 + Noto Sans SC (UI/headings); Adobe/Google "Source Han" family, designed to pair.
const FONT_LINKS = [
  "source-serif-4/400", "source-serif-4/400-italic", "source-serif-4/600",
  "noto-serif-sc/400", "noto-serif-sc/600",
  "source-sans-3/400", "source-sans-3/600", "source-sans-3/700",
  "noto-sans-sc/400", "noto-sans-sc/600", "noto-sans-sc/700",
].map((f) => `<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@fontsource/${f}.css">`).join("\n");
marked.use({
  renderer: {
    code({ text, lang }) {
      const l = (lang || "").split(/\s+/)[0];
      let html;
      if (l && hljs.getLanguage(l)) html = hljs.highlight(text, { language: l, ignoreIllegals: true }).value;
      else html = escapeHtml(text);
      return `<pre><code class="hljs${l ? " language-" + escapeHtml(l) : ""}">${html}\n</code></pre>\n`;
    },
  },
});
const contentDir = join(root, "content");
const distDir = join(root, "dist");
const rawBase = process.env.BASE_PATH ?? "/note";
const BASE = rawBase === "/" ? "" : rawBase.replace(/\/$/, "");
const baseHref = BASE ? BASE + "/" : "/";

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sortKey(stem, title) {
  const fromName = stem.match(/^(\d+)/);
  if (fromName) return Number(fromName[1]);
  const fromTitle = title.match(/(\d+)/);
  if (fromTitle) return Number(fromTitle[1]);
  return Number.POSITIVE_INFINITY;
}

function extractTitle(md, stem) {
  const m = md.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : stem;
}

function href(path) {
  return baseHref + path.replace(/^\//, "");
}

// Bind only interface strings. Titles, queries and article prose belong to their authors.
function ui(source, ...values) {
  const args = values.length ? ` data-values="${escapeHtml(JSON.stringify(values))}"` : "";
  return `<span data-msg="${escapeHtml(source)}"${args}>${escapeHtml(formatMessage("zh", source, ...values))}</span>`;
}

function searchFieldHtml(id, feedbackId) {
  return `<div class="search-box"><div class="home-search-field"><span aria-hidden="true">⌕</span><input id="${id}" aria-describedby="${feedbackId}" name="q" type="search" enterkeyhint="search" required data-msg-placeholder="find 关键词、标题或 tag:标签" placeholder="find 关键词、标题或 tag:标签" autocomplete="off"><button class="search-clear" type="button" data-msg-aria-label="清空搜索" aria-label="清空搜索" hidden>×</button><button type="submit">${ui("搜索")} <span aria-hidden="true">↗</span></button></div></div>`;
}

function termBarHtml() {
  // Hidden by default (see .term-bar in style.css); terminal.js shows it on "/" or ":".
  return `<header class="term-bar" id="term-bar" aria-hidden="true" inert><div class="term-bar-inner">
  <div class="term">
    <label class="term-line" for="term-input">
      <span class="prompt-label">$</span>
      <span class="term-field">
        <span class="term-ghost" id="term-ghost" aria-hidden="true"><span class="term-ghost-typed"></span><span class="term-ghost-rest"></span></span>
        <input class="term-input" id="term-input" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" data-msg-placeholder="输入 /find 关键词，或 /help 查看说明" placeholder="输入 /find 关键词，或 /help 查看说明" data-msg-aria-label="命令栏" aria-label="命令栏" aria-describedby="term-hint" role="combobox" aria-expanded="false" aria-autocomplete="list" aria-controls="suggest" aria-haspopup="listbox">
      </span>
      <kbd class="term-kbd" aria-hidden="true">Esc</kbd>
    </label>
    <div class="term-pop">
      <p class="term-hint" id="term-hint">${ui("↑ ↓ 选择 · Tab 补全 · Enter 执行 · Esc 收起")}</p>
      <pre class="term-echo" id="term-echo" role="status" aria-live="polite" aria-atomic="true" hidden></pre>
      <ul class="suggest" id="suggest" role="listbox" hidden></ul>
    </div>
  </div>
</div></header>`;
}

function statuslineHtml() {
  return `<footer class="statusline" id="statusline">
  <span class="sl-mode" id="sl-mode" data-mode="NORMAL" data-msg="NORMAL">常规</span>
  <a class="sl-brand" href="${href("")}" data-msg-title="首页 (Space h)" title="首页 (Space h)">n note</a>
  <span class="sl-pending" id="sl-pending"></span>
  <span class="sl-msg" id="sl-msg" role="status" aria-live="polite"></span>
  <span class="sl-spacer"></span>
  <select id="ui-language" data-msg-aria-label="语言" aria-label="语言">${Object.entries(languages).map(([code, name]) => `<option value="${code}" lang="${code}">${name}</option>`).join("")}</select>
  <button class="theme-toggle" id="theme-toggle" type="button" data-msg-aria-label="切换主题" aria-label="切换主题" data-msg-title="切换主题（Space T · day / tokyo）" title="切换主题（Space T · day / tokyo）"><span class="night-choice">☾ ${ui("夜间")}</span><span class="day-choice">☀ ${ui("白天")}</span></button>
  <button class="sl-btn" id="sl-cmd" type="button" data-msg-title="打开命令栏" title="打开命令栏"><kbd>/</kbd> ${ui("命令")}</button>
  <button class="sl-btn" id="sl-help" type="button" data-msg-title="快捷键" title="快捷键"><kbd>?</kbd> ${ui("帮助")}</button>
</footer>`;
}

function layout({ title, body, back, scripts, wide }) {
  const backLink = back
    ? `<a class="back" href="${href("")}">← ${ui("返回")}</a>`
    : "";
  const scriptTags = scripts || "";
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<base href="${baseHref}">
<title>${escapeHtml(title)}</title>
<script>(function(){var resolve=${resolveTheme.toString()};
window.__applyTheme=function(){var stored=null;try{stored=localStorage.getItem("note-theme")}catch(e){}var theme=resolve(stored);try{if(stored!==theme)localStorage.setItem("note-theme",theme)}catch(e){}var d=document.documentElement;d.setAttribute("data-theme",theme);d.setAttribute("data-theme-mode",theme);return{mode:theme,theme:theme}};window.__applyTheme()})();</script>
<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>
${FONT_LINKS}
<link rel="stylesheet" href="assets/style.css?v=52">
<link rel="stylesheet" href="assets/code.css?v=47">
</head>
<body>
${termBarHtml()}
${wide ? body : `<div class="wrap">
${backLink}
${body}
<p class="footer">note // tui</p>
</div>`}
${statuslineHtml()}
<script type="module" src="assets/language.js?v=49"></script>
${scriptTags}
<script type="module" src="assets/search-box.js?v=49"></script>
</body>
</html>
`;
}

async function main() {
  await rm(distDir, { recursive: true, force: true });
  await mkdir(join(distDir, "posts"), { recursive: true });
  await mkdir(join(distDir, "assets"), { recursive: true });
  for (const file of ["cathedral-ship.webp", "archive-day.webp", "archive-night.webp", "language.js", "messages.mjs"]) {
    await cp(join(root, "assets", file), join(distDir, "assets", file));
  }
  await cp(join(root, "assets", "fleet"), join(distDir, "assets", "fleet"), { recursive: true });
  await cp(join(root, "assets", "style.css"), join(distDir, "assets", "style.css"));
  await cp(join(root, "assets", "code.css"), join(distDir, "assets", "code.css"));
  // Bundle split engine sources into one browser file (avoids multi-.mjs load issues).
  const themesSrc = await readFile(join(root, "src", "themes.mjs"), "utf8");
  const scrubSrc = await readFile(join(root, "src", "text-scrub.mjs"), "utf8");
  const tagSrc = await readFile(join(root, "src", "tag-match.mjs"), "utf8");
  const engSrc = await readFile(join(root, "src", "term-engine.mjs"), "utf8");
  const aboutSrc = await readFile(join(root, "src", "about.mjs"), "utf8");
  const querySrc = await readFile(join(root, "src", "query.mjs"), "utf8");
  const cmdsSrc = await readFile(join(root, "src", "commands-list.mjs"), "utf8");
  const searchSuggestionsSrc = await readFile(join(root, "src", "search-suggestions.mjs"), "utf8");
  const compSrc = await readFile(join(root, "src", "complete.mjs"), "utf8");
  function stripImports(src) {
    return src.replace(/^import\s+[\s\S]*?from\s+["'][^"']+["'];\s*/gm, "");
  }
  function stripReexport(src) {
    return src.replace(/^export\s*\{[\s\S]*?\};\s*/m, "");
  }
  const engineBundle = [
    "/** Auto-bundled from text-scrub + tag-match + about + query + commands-list + complete + term-engine. */",
    'import { t } from "./messages.mjs?v=49";',
    "export { t };",
    themesSrc.trim(),
    scrubSrc.trim(),
    stripImports(tagSrc).trim(),
    stripImports(aboutSrc).trim(),
    stripImports(querySrc).trim(),
    stripImports(cmdsSrc).trim(),
    stripImports(compSrc).trim(),
    stripImports(searchSuggestionsSrc).trim(),
    stripReexport(stripImports(engSrc)).trim(),
    "",
  ].join("\n\n");
  await writeFile(join(root, "assets", "term-engine.js"), engineBundle);
  await writeFile(join(distDir, "assets", "term-engine.js"), engineBundle);
  // Keep split sources in dist for debugging / egg raw view of entry.
  for (const f of ["themes.mjs", "text-scrub.mjs", "tag-match.mjs", "about.mjs", "query.mjs", "commands-list.mjs", "complete.mjs", "term-engine.mjs"]) {
    await cp(join(root, "src", f), join(distDir, "assets", f));
  }
  // the two long-tracked split sources are also mirrored into assets/
  for (const f of ["text-scrub.mjs", "tag-match.mjs"]) await cp(join(root, "src", f), join(root, "assets", f));
  await cp(join(root, "assets", "terminal.js"), join(distDir, "assets", "terminal.js"));
  await cp(join(root, "src", "archive-camera.mjs"), join(distDir, "assets", "archive-camera.mjs"));
  await cp(join(root, "assets", "archive-scroll.js"), join(distDir, "assets", "archive-scroll.js"));
  await cp(join(root, "assets", "reader.js"), join(distDir, "assets", "reader.js"));
  await cp(join(root, "assets", "nav.js"), join(distDir, "assets", "nav.js"));
  await cp(join(root, "assets", "search-box.js"), join(distDir, "assets", "search-box.js"));
  await cp(join(root, "assets", "search.js"), join(distDir, "assets", "search.js"));
  await cp(join(root, "assets", "about-search.js"), join(distDir, "assets", "about-search.js"));
  await cp(join(root, "assets", "embeddings.json"), join(distDir, "assets", "embeddings.json"));
  await mkdir(join(distDir, "assets", "bad-apple"), { recursive: true });
  await cp(join(root, "assets", "bad-apple"), join(distDir, "assets", "bad-apple"), { recursive: true });

  const seriesList = await loadContent(contentDir);
  const posts = [];

  for (const [si, s] of seriesList.entries()) {
    s.posts = s.posts.map((src, pi) => {
      const { stem, md, meta } = src;
      const title = extractTitle(md, src.name);
      const tags = Array.isArray(meta.tags)
        ? meta.tags.map((x) => String(x)).filter(Boolean)
        : [];
      let htmlBody = marked.parse(md);
      htmlBody = htmlBody.replace(/<h1[^>]*>[\s\S]*?<\/h1>\s*/i, "");
      const outline = [];
      htmlBody = htmlBody.replace(/<h([23])>([\s\S]*?)<\/h\1>/gi, (_m, lv, inner) => {
        const id = "s" + (outline.length + 1);
        outline.push({ id, level: Number(lv), text: inner.replace(/<[^>]+>/g, "").trim() });
        return `<h${lv} id="${id}">${inner}</h${lv}>`;
      });
      const plain = md.replace(/```[\s\S]*?```/g, " ");
      const cjk = (plain.match(/[\u3400-\u9fff]/g) || []).length;
      const words = (plain.replace(/[\u3400-\u9fff]/g, " ").match(/[A-Za-z0-9'’-]+/g) || []).length;
      const minutes = Math.max(1, Math.round(cjk / 400 + words / 220));
      const post = {
        stem, title, outName: stem + ".html", htmlBody, tags, meta, outline, minutes,
        series: s, seriesIndex: si, index: pi,
      };
      posts.push(post);
      return post;
    });
  }

  const postsIndex = posts.map((p) => ({
    title: p.title,
    stem: p.stem,
    series: p.series.title,
    dir: p.series.dir,
    n: String(p.index + 1).padStart(2, "0"),
    href: `posts/${p.outName}`,
    tags: p.tags,
  }));
  const searchIndex = buildSearchIndex(seriesList, posts);
  await writeFile(join(distDir, "search-index.json"), JSON.stringify(searchIndex));

  const postsJsonLiteral = JSON.stringify(postsIndex).replace(/</g, "\\u003c");
  const seriesJsonLiteral = JSON.stringify(searchIndex.series).replace(/</g, "\\u003c");
  const dataScript = `<script>window.__POSTS__=${postsJsonLiteral};window.__SERIES__=${seriesJsonLiteral};window.__BASE__=${JSON.stringify(BASE)};</script>
<script type="module" src="assets/terminal.js?v=49"></script>`;
  const navScript = `<script type="module" src="assets/nav.js?v=49"></script>`;
  const scripts = `${dataScript}
<script src="assets/reader.js?v=47" defer></script>
${navScript}`;
  const pageScripts = `${dataScript}\n${navScript}`;
  const searchScripts = `${dataScript}
<script type="module" src="assets/search.js?v=49"></script>
${navScript}`;

  const engineSrc = await readFile(join(root, "assets", "term-engine.js"), "utf8");
  const eggScripts = `${scripts}
<script src="assets/bad-apple/lz-string.min.js"></script>
<script type="module" src="assets/bad-apple/player.js?v=49"></script>`;
  const eggBody = `<div class="box egg-box"><div class="box-title">~/lost · bad apple</div><div class="box-body">
<p class="egg-msg">no such file — ascii radio instead</p>
<p id="ba-status">…</p>
<button type="button" id="play-button">${ui("Play")}</button>
<div class="ba-wrap"><pre id="ascii-display"></pre></div>
<audio id="audio-player" preload="auto">
  <source src="assets/bad-apple/bad_apple.mp3" type="audio/mpeg">
</audio>
<p class="ba-credit">ASCII player adapted from <a href="https://github.com/EmirXK/bad_apple" target="_blank" rel="noopener noreferrer">EmirXK/bad_apple</a> (MIT). Animation: Bad Apple!! feat. nomico.</p>
</div></div>
<div class="box egg-box" style="margin-top:1rem"><div class="box-title">assets/term-engine.js</div><div class="box-body">
<p class="egg-msg">source · <a href="assets/term-engine.js">${ui("raw file")}</a></p>
<pre class="egg-source"><code>${escapeHtml(engineSrc)}</code></pre>
</div></div>`;
  await writeFile(
    join(distDir, "egg.html"),
    layout({ title: "???", body: eggBody, back: true, scripts: eggScripts })
  );

  const railHtml = (post) =>
    post.series.posts
      .map((q, i) => {
        const n = String(i + 1).padStart(2, "0");
        const cls = q.stem === post.stem ? ' class="active" aria-current="page"' : "";
        return `<a${cls} href="posts/${q.outName}"><span class="rail-number">${n}</span><span class="rail-text">${escapeHtml(q.title)}</span></a>`;
      })
      .join("\n");

  for (const post of posts) {
    const idx = post.index;
    const sp = post.series.posts;
    const n = String(idx + 1).padStart(2, "0");
    const tagsHtml = post.tags.length
      ? `<p class="tags">${post.tags.map((tg) => `<span class="tag">@${escapeHtml(tg)}</span>`).join(" ")}</p>`
      : "";
    const outlineHtml = post.outline.length
      ? post.outline
          .map((o) => `<a href="#${o.id}" data-target="${o.id}"${o.level === 3 ? ' class="subsection"' : ""}>${escapeHtml(o.text)}</a>`)
          .join("\n")
      : "";
    const prev = sp[idx - 1];
    const next = sp[idx + 1];
    const pager = `<nav class="pager">${
      prev ? `<a class="prev" href="posts/${prev.outName}"><small>${ui("上一篇")}</small><span>${escapeHtml(prev.title)}</span></a>` : "<span></span>"
    }${
      next ? `<a class="next" href="posts/${next.outName}"><small>${ui("下一篇")}</small><span>${escapeHtml(next.title)}</span></a>` : "<span></span>"
    }</nav>`;
    const body = `<div class="reading-progress"><div></div></div>
<div class="reader-grid">
  <aside class="chapter-rail">
    <a class="back-to-book" href="${href("")}">${ui("← 目录")}</a>
    <div class="rail-series">${escapeHtml(post.series.title)}</div>
    ${post.series.description ? `<p class="rail-desc">${escapeHtml(post.series.description)}</p>` : ""}
    <nav class="chapter-navigation" data-msg-aria-label="本文件夹下的文章" aria-label="本文件夹下的文章">
${railHtml(post)}
    </nav>
  </aside>
  <main class="reading-main">
    <div class="reader-topline"><a href="${href("")}">${ui("首页")}</a><span>/</span><span>${escapeHtml(post.series.title)}</span><span>/</span><span>${n}</span><span class="reading-time">${ui("约 {0} 分钟阅读", post.minutes)}</span></div>
    <header class="chapter-heading">
      <p class="eyebrow"><span class="chapter-badge">${n}</span>${escapeHtml(post.stem)}.md</p>
      <h1>${escapeHtml(post.title)}</h1>
      ${tagsHtml}
    </header>
    ${outlineHtml ? `<details class="mobile-outline"><summary><span>${ui("本文内容")}</span></summary><nav>${outlineHtml}</nav></details>` : ""}
    <article class="post prose">${post.htmlBody}</article>
    ${pager}
    <p class="footer">note // tui</p>
  </main>
  <aside class="outline-rail">
    ${outlineHtml ? `<div class="rail-label">${ui("本文内容")}</div><nav class="section-outline" data-msg-aria-label="本文内容" aria-label="本文内容">\n${outlineHtml}\n</nav>` : ""}
    <a class="back-to-top" href="#top">${ui("↑ 回到顶部")}</a>
  </aside>
</div>`;
    const page = layout({ title: post.title, body, back: false, scripts, wide: true });
    const outPath = join(distDir, "posts", post.outName);
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, page);
  }

  await writeFile(
    join(distDir, "posts.json"),
    JSON.stringify({ base: BASE, posts: postsIndex }, null, 2) + "\n"
  );

  const homeGroups = partitionHomeSeries(seriesList);
  const blogPosts = homeGroups.blog.flatMap((s) => s.posts);
  const seriesHtml = `<ul class="folders">${homeGroups.blog
    .map((s) => {
      const desc = s.description ? `<span class="folder-desc">${escapeHtml(s.description)}</span>` : "";
      const articles = s.posts.map((p, i) => `<li><a class="home-post" data-nav href="posts/${p.outName}"><span class="home-post-number">${String(i + 1).padStart(2, "0")}</span><span class="home-post-title">${escapeHtml(p.title)}</span><span class="home-post-time">${ui("{0} 分钟", p.minutes)}</span></a></li>`).join("\n");
      return `<li><details class="folder-group"><summary class="folder" data-nav><span class="folder-chevron" aria-hidden="true">›</span><span class="folder-body"><span class="folder-name">${escapeHtml(s.title)}</span>${desc}</span><span class="folder-count">${ui("{0} 篇", s.posts.length)}</span></summary><ul class="home-posts">${articles}</ul></details></li>`;
    })
    .join("\n")}</ul>`;

  function infoLinks(folders) {
    return folders.flatMap((s) => s.posts).map((p) => `<li><a href="posts/${p.outName}">${escapeHtml(p.title)}<span aria-hidden="true">↗</span></a></li>`).join("\n");
  }
  const indexBody = `<main class="home library archive-world" id="archive-world">
<div class="archive-stage" aria-hidden="true">
  <div class="star-field">
    <div class="orbital-arc"></div>
    <svg class="archive-moon" viewBox="0 0 100 100" focusable="false">
      <defs>
        <radialGradient id="moon-dark" cx="36%" cy="28%" r="70%"><stop stop-color="var(--orbit)"/><stop offset="1" stop-color="var(--moon-shadow)"/></radialGradient>
        <radialGradient id="moon-sun" cx="32%" cy="26%" r="75%"><stop stop-color="#f6efff"/><stop offset=".62" stop-color="#baa1ce"/><stop offset="1" stop-color="#776289"/></radialGradient>
      </defs>
      <circle cx="50" cy="50" r="48" fill="url(#moon-dark)"/>
      <path id="moon-light" fill="url(#moon-sun)" d="M50 2a48 48 0 0 1 0 96a35 48 0 0 0 0-96"/>
      <g fill="var(--orbit)" opacity=".28"><circle cx="67" cy="29" r="5"/><circle cx="65" cy="67" r="9"/><circle cx="38" cy="48" r="4"/></g>
    </svg>
  </div>
  <div class="fleet-formation">
  <div class="escorts">${fleetEscortsHtml()}</div>
  <svg class="ship-plate" viewBox="0 0 1536 1024" focusable="false">
    <defs>
      <!-- Ship paint sampled from the flagship at matching luminance percentiles. -->
      <filter id="flagship-palette" color-interpolation-filters="sRGB">
        <feColorMatrix type="saturate" values="0"/>
        <feComponentTransfer>
          <feFuncR type="table" tableValues=".031 .082 .361 .600 .733 .839 .937 .988 1"/>
          <feFuncG type="table" tableValues="0 .004 .188 .431 .576 .702 .835 .925 .992"/>
          <feFuncB type="table" tableValues=".125 .192 .463 .651 .753 .835 .882 .929 .988"/>
        </feComponentTransfer>
      </filter>
      <radialGradient id="exhaust-halo">
        <stop stop-color="var(--jet-halo)" stop-opacity=".65"/><stop offset=".46" stop-color="var(--jet-halo)" stop-opacity=".26"/>
        <stop offset="1" stop-color="var(--jet-halo)" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="exhaust-stream" gradientUnits="userSpaceOnUse" x1="-224" x2="6">
        <stop stop-color="var(--jet-violet)" stop-opacity="0"/><stop offset=".28" stop-color="var(--jet-violet)" stop-opacity=".22"/>
        <stop offset=".63" stop-color="var(--jet-violet)" stop-opacity=".78"/><stop offset=".88" stop-color="#e1bcff"/><stop offset="1" stop-color="#fff9ff"/>
      </linearGradient>
      <g id="plume">
        <ellipse cx="-74" rx="144" ry="21" fill="url(#exhaust-halo)"/>
        <path d="M6 -10 C-15 -12 -27 -7 -46 -8 S-84 -10 -111 -5 S-178 -5 -224 -1 C-180 0 -156 6 -122 4 S-71 12 -45 8 S-12 11 6 9Z" fill="url(#exhaust-stream)"/>
        <path d="M5 -6 Q-12 -7 -29 0 Q-15 6 5 5Z M-30 0 Q-41 -3 -55 0 Q-42 3 -30 0Z M-59 0 Q-68 -1.8 -80 0 Q-67 1.8 -59 0Z" fill="#fff3ff" opacity=".86"/>
      </g>
    </defs>
    <g class="archive-camera">
      ${exhaustHtml([[119, 304, .91], [86, 352, 1.06], [73, 425, 1.14]], 14)}
      <image href="assets/cathedral-ship.webp" width="1536" height="1024"/>
      <g class="chapel-callout">
        <path d="M800 600 L726 881 H520" fill="none" stroke="currentColor" vector-effect="non-scaling-stroke"/>
        <circle cx="800" cy="600" r="5" fill="currentColor"/>
        <text x="520" y="862" fill="currentColor" data-msg="档案舱">档案舱</text>
      </g>
    </g>
  </svg>
  </div>
  <div class="archive-portal"><div class="cabin-scene"></div></div>
  <svg class="porthole-rim" viewBox="-100 -100 200 200" preserveAspectRatio="none" focusable="false">
    <defs><path id="window-cusp" d="M-38 -92 Q-17 -91 0 -72 Q17 -91 38 -92"/></defs>
    <circle r="98" class="rim-stone"/><circle r="95" class="rim-inlay"/>
    <g class="rim-tracery">${Array.from({length: 8}, (_, i) => `<use href="#window-cusp" transform="rotate(${i * 45})"/>`).join("")}</g>
  </svg>
</div>
<section class="archive-journey" id="fleet" aria-labelledby="archive-title">
  <div class="archive-arrival">
    <header class="archive-masthead">
      <span class="site-signature">~/note</span>
      <nav data-msg-aria-label="首页模块" aria-label="首页模块"><a href="#notebook">${ui("Blog 正文")}</a><a href="#site-about">${ui("关于本站")}</a><a href="#site-help">${ui("使用说明")}</a></nav>
    </header>
    <h1 id="archive-title">${ui("舰上手记")}</h1>
    <p class="archive-subtitle" lang="en">Shipboard notes</p>
    <a class="archive-cue" href="#archive-desk"><span class="descent-arrow" aria-hidden="true">↓</span>${ui("进入档案舱")}</a>
  </div>
</section>
<div class="archive-desk" id="archive-desk" tabindex="-1">
  <a class="fleet-return" href="#fleet">↑ ${ui("返回舰队")}</a>
  <div class="desk-grid">
    <section class="notebook-window blog-window" id="notebook" aria-labelledby="notebook-title">
      <div class="library-heading"><h2 id="notebook-title">${ui("Blog / 正文")}</h2><span>${ui("{0} 篇 · {1} 个文件夹", blogPosts.length, homeGroups.blog.length)}</span></div>
      <div class="notebook-content">
        <form class="home-search" action="search.html" method="get" role="search">
          <label for="home-query">${ui("搜索笔记")}</label>
          ${searchFieldHtml("home-query", "home-search-feedback")}
          <p class="search-hint">${ui("find 关键词 · 搜索范围包含正文、使用说明和关于本站。")}</p>
          <p id="home-search-feedback" class="search-feedback" role="status" hidden></p>
        </form>
        <div class="notebook-directory">${ui("文章目录")}</div>
        ${seriesHtml}
        <p class="library-help">${ui("展开文件夹，选择一篇开始阅读。")}</p>
      </div>
    </section>
    <div class="desk-sidebar">
      <section class="notebook-window info-window" id="site-about" aria-labelledby="about-title">
        <div class="library-heading"><h2 id="about-title">${ui("关于本站")}</h2><span aria-hidden="true" lang="en">ABOUT</span></div>
        <div class="notebook-content"><p>${ui("一个存放文字、想法和阅读片段的私人档案室。")}</p><p class="info-caption">${ui("设计与来由")}</p><ul class="info-links">${infoLinks(homeGroups.about)}</ul></div>
      </section>
      <section class="notebook-window info-window" id="site-help" aria-labelledby="help-title">
        <div class="library-heading"><h2 id="help-title">${ui("使用说明")}</h2><span aria-hidden="true" lang="en">GUIDE</span></div>
        <div class="notebook-content"><dl class="desk-shortcuts"><dt><kbd>/</kbd></dt><dd>${ui("打开命令栏")}</dd><dt><kbd>↑</kbd> <kbd>↓</kbd></dt><dd>${ui("选择搜索建议")}</dd><dt><kbd>Enter</kbd></dt><dd>${ui("搜索或打开选中项")}</dd><dt><kbd>Esc</kbd></dt><dd>${ui("收起建议与命令栏")}</dd></dl><ul class="info-links">${infoLinks(homeGroups.help)}</ul></div>
      </section>
    </div>
  </div>
</div>
<p class="footer archive-footer">note // tui</p>
</main>`;

  await writeFile(
    join(distDir, "index.html"),
    layout({ title: "note", body: indexBody, back: false, scripts: pageScripts + '\n<script type="module" src="assets/archive-scroll.js?v=50"></script>', wide: true })
  );
  const searchBody = `<div class="wrap home search-page">
<section class="sr-head">
  <p class="sr-prompt"><span class="sr-dollar">$</span> <span class="sr-cmd">/find</span> <span class="sr-expr" id="sr-expr"></span></p>
  <form class="home-search sr-search" action="search.html" method="get" role="search">
    <label for="search-query">${ui("搜索笔记")}</label>
    ${searchFieldHtml("search-query", "search-feedback")}
    <p id="search-feedback" class="search-feedback" role="status" hidden></p>
  </form>
  <p class="sr-summary" id="sr-summary">${ui("搜索中…")}</p>
  <p class="sr-notes" id="sr-notes"></p>
</section>
<div id="sr-root"><noscript><p class="sr-empty">搜索需要 JavaScript。</p></noscript></div>
<p class="footer">note // tui</p>
</div>`;
  await writeFile(
    join(distDir, "search.html"),
    layout({ title: "search · note", body: searchBody, back: false, scripts: searchScripts, wide: true })
  );
  console.log(`Built ${seriesList.length} series / ${posts.length} posts -> dist/ (BASE_PATH=${BASE || "(root)"})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
