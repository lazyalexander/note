import { readdir, readFile, writeFile, mkdir, cp, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";
import hljs from "highlight.js";
import { loadContent } from "./content.mjs";
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

function termBarHtml() {
  // Hidden by default (see .term-bar in style.css); terminal.js shows it on "/" or ":".
  return `<header class="term-bar" id="term-bar" aria-hidden="true" inert><div class="term-bar-inner">
  <div class="term">
    <label class="term-line" for="term-input">
      <span class="prompt-label">$</span>
      <span class="term-field">
        <span class="term-ghost" id="term-ghost" aria-hidden="true"><span class="term-ghost-typed"></span><span class="term-ghost-rest"></span></span>
        <input class="term-input" id="term-input" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="/find  /theme  ·  Tab 补全  ·  Esc 关闭" aria-autocomplete="list" aria-controls="suggest" aria-haspopup="listbox">
      </span>
      <kbd class="term-kbd" aria-hidden="true">Esc</kbd>
    </label>
    <div class="term-pop">
      <pre class="term-echo" id="term-echo" hidden></pre>
      <ul class="suggest" id="suggest" role="listbox" hidden></ul>
    </div>
  </div>
</div></header>`;
}

function statuslineHtml() {
  return `<footer class="statusline" id="statusline">
  <span class="sl-mode" id="sl-mode" data-mode="NORMAL">NORMAL</span>
  <a class="sl-brand" href="${href("")}" title="首页 (Space h)">n note</a>
  <span class="sl-pending" id="sl-pending"></span>
  <span class="sl-msg" id="sl-msg" role="status" aria-live="polite"></span>
  <span class="sl-spacer"></span>
  <button class="theme-toggle" id="theme-toggle" type="button" aria-label="切换主题" title="切换主题（Space T · 自动 / paper / tokyo / ink）">◐</button>
  <button class="sl-btn" id="sl-cmd" type="button" title="打开命令栏"><kbd>/</kbd> 命令</button>
  <button class="sl-btn" id="sl-help" type="button" title="快捷键"><kbd>?</kbd> 帮助</button>
</footer>`;
}

function layout({ title, body, back, scripts, wide }) {
  const backLink = back
    ? `<a class="back" href="${href("")}">&lt;-- back</a>`
    : "";
  const scriptTags = scripts || "";
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<base href="${baseHref}">
<title>${escapeHtml(title)}</title>
<script>(function(){function pick(){var m="auto";try{m=localStorage.getItem("note-theme")||"auto"}catch(e){}var t=m;if(m==="auto"){var h=new Date().getHours();t=(h>=6&&h<18)?"paper":"tokyo"}return{mode:m,theme:t}}
window.__applyTheme=function(){var r=pick(),d=document.documentElement;if(r.theme==="tokyo")d.removeAttribute("data-theme");else d.setAttribute("data-theme",r.theme);d.setAttribute("data-theme-mode",r.mode);return r};window.__applyTheme()})();</script>
<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>
${FONT_LINKS}
<link rel="stylesheet" href="assets/style.css?v=37">
<link rel="stylesheet" href="assets/code.css?v=37">
</head>
<body>
${termBarHtml()}
${wide ? body : `<div class="wrap">
${backLink}
${body}
<p class="footer">note // tui</p>
</div>`}
${statuslineHtml()}
${scriptTags}
</body>
</html>
`;
}

async function main() {
  await rm(distDir, { recursive: true, force: true });
  await mkdir(join(distDir, "posts"), { recursive: true });
  await mkdir(join(distDir, "assets"), { recursive: true });
  await cp(join(root, "assets", "style.css"), join(distDir, "assets", "style.css"));
  await cp(join(root, "assets", "code.css"), join(distDir, "assets", "code.css"));
  // Bundle split engine sources into one browser file (avoids multi-.mjs load issues).
  const scrubSrc = await readFile(join(root, "src", "text-scrub.mjs"), "utf8");
  const tagSrc = await readFile(join(root, "src", "tag-match.mjs"), "utf8");
  const engSrc = await readFile(join(root, "src", "term-engine.mjs"), "utf8");
  const aboutSrc = await readFile(join(root, "src", "about.mjs"), "utf8");
  const querySrc = await readFile(join(root, "src", "query.mjs"), "utf8");
  const cmdsSrc = await readFile(join(root, "src", "commands-list.mjs"), "utf8");
  const compSrc = await readFile(join(root, "src", "complete.mjs"), "utf8");
  function stripImports(src) {
    return src.replace(/^import\s+[\s\S]*?from\s+["'][^"']+["'];\s*/gm, "");
  }
  function stripReexport(src) {
    return src.replace(/^export\s*\{[\s\S]*?\};\s*/m, "");
  }
  const engineBundle = [
    "/** Auto-bundled from text-scrub + tag-match + about + query + commands-list + complete + term-engine. */",
    scrubSrc.trim(),
    stripImports(tagSrc).trim(),
    stripImports(aboutSrc).trim(),
    stripImports(querySrc).trim(),
    stripImports(cmdsSrc).trim(),
    stripImports(compSrc).trim(),
    stripReexport(stripImports(engSrc)).trim(),
    "",
  ].join("\n\n");
  await writeFile(join(root, "assets", "term-engine.js"), engineBundle);
  await writeFile(join(distDir, "assets", "term-engine.js"), engineBundle);
  // Keep split sources in dist for debugging / egg raw view of entry.
  for (const f of ["text-scrub.mjs", "tag-match.mjs", "about.mjs", "query.mjs", "commands-list.mjs", "complete.mjs", "term-engine.mjs"]) {
    await cp(join(root, "src", f), join(distDir, "assets", f));
  }
  // the two long-tracked split sources are also mirrored into assets/
  for (const f of ["text-scrub.mjs", "tag-match.mjs"]) await cp(join(root, "src", f), join(root, "assets", f));
  await cp(join(root, "assets", "terminal.js"), join(distDir, "assets", "terminal.js"));
  await cp(join(root, "assets", "reader.js"), join(distDir, "assets", "reader.js"));
  await cp(join(root, "assets", "nav.js"), join(distDir, "assets", "nav.js"));
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
<script type="module" src="assets/terminal.js?v=37"></script>`;
  const navScript = `<script type="module" src="assets/nav.js?v=37"></script>`;
  const scripts = `${dataScript}
<script src="assets/reader.js?v=37" defer></script>
${navScript}`;
  const pageScripts = `${dataScript}\n${navScript}`;
  const searchScripts = `${dataScript}
<script type="module" src="assets/search.js?v=37"></script>
${navScript}`;

  const engineSrc = await readFile(join(root, "assets", "term-engine.js"), "utf8");
  const eggScripts = `${scripts}
<script src="assets/bad-apple/lz-string.min.js"></script>
<script src="assets/bad-apple/player.js?v=1"></script>`;
  const eggBody = `<div class="box egg-box"><div class="box-title">~/lost · bad apple</div><div class="box-body">
<p class="egg-msg">no such file — ascii radio instead</p>
<p id="ba-status">…</p>
<button type="button" id="play-button">Play</button>
<div class="ba-wrap"><pre id="ascii-display"></pre></div>
<audio id="audio-player" preload="auto">
  <source src="assets/bad-apple/bad_apple.mp3" type="audio/mpeg">
</audio>
<p class="ba-credit">ASCII player adapted from <a href="https://github.com/EmirXK/bad_apple" target="_blank" rel="noopener noreferrer">EmirXK/bad_apple</a> (MIT). Animation: Bad Apple!! feat. nomico.</p>
</div></div>
<div class="box egg-box" style="margin-top:1rem"><div class="box-title">assets/term-engine.js</div><div class="box-body">
<p class="egg-msg">source · <a href="assets/term-engine.js">raw file</a></p>
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
      prev ? `<a class="prev" href="posts/${prev.outName}"><small>上一篇</small><span>${escapeHtml(prev.title)}</span></a>` : "<span></span>"
    }${
      next ? `<a class="next" href="posts/${next.outName}"><small>下一篇</small><span>${escapeHtml(next.title)}</span></a>` : "<span></span>"
    }</nav>`;
    const body = `<div class="reading-progress"><div></div></div>
<div class="reader-grid">
  <aside class="chapter-rail">
    <a class="back-to-book" href="${href("")}">← 目录</a>
    <div class="rail-series">${escapeHtml(post.series.title)}</div>
    ${post.series.description ? `<p class="rail-desc">${escapeHtml(post.series.description)}</p>` : ""}
    <nav class="chapter-navigation" aria-label="本文件夹下的文章">
${railHtml(post)}
    </nav>
  </aside>
  <main class="reading-main">
    <div class="reader-topline"><a href="${href("")}">首页</a><span>/</span><span>${escapeHtml(post.series.title)}</span><span>/</span><span>${n}</span><span class="reading-time">约 ${post.minutes} 分钟阅读</span></div>
    <header class="chapter-heading">
      <p class="eyebrow"><span class="chapter-badge">${n}</span>${escapeHtml(post.stem)}.md</p>
      <h1>${escapeHtml(post.title)}</h1>
      ${tagsHtml}
    </header>
    ${outlineHtml ? `<details class="mobile-outline"><summary><span>本文内容</span></summary><nav>${outlineHtml}</nav></details>` : ""}
    <article class="post prose">${post.htmlBody}</article>
    ${pager}
    <p class="footer">note // tui</p>
  </main>
  <aside class="outline-rail">
    ${outlineHtml ? `<div class="rail-label">本文内容</div><nav class="section-outline" aria-label="本文内容">\n${outlineHtml}\n</nav>` : ""}
    <a class="back-to-top" href="#top">↑ 回到顶部</a>
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

  const seriesHtml = `<ul class="folders">${seriesList
    .map((s) => {
      const first = s.posts[0];
      const desc = s.description ? `<span class="folder-desc">${escapeHtml(s.description)}</span>` : "";
      return `<li><a class="folder" data-nav href="posts/${first.outName}"><span class="folder-icon" aria-hidden="true">▸</span><span class="folder-body"><span class="folder-name">${escapeHtml(s.title)}<span class="folder-dir">${escapeHtml(s.dir)}/</span></span>${desc}</span><span class="folder-count">${s.posts.length} 篇</span></a></li>`;
    })
    .join("\n")}</ul>`;

  const banner = String.raw`██╗    ██╗███████╗██╗      ██████╗ ██████╗ ███╗   ███╗███████╗██╗
██║    ██║██╔════╝██║     ██╔════╝██╔═══██╗████╗ ████║██╔════╝██║
██║ █╗ ██║█████╗  ██║     ██║     ██║   ██║██╔████╔██║█████╗  ██║
██║███╗██║██╔══╝  ██║     ██║     ██║   ██║██║╚██╔╝██║██╔══╝  ╚═╝
╚███╔███╔╝███████╗███████╗╚██████╗╚██████╔╝██║ ╚═╝ ██║███████╗██╗
 ╚══╝╚══╝ ╚══════╝╚══════╝ ╚═════╝ ╚═════╝ ╚═╝     ╚═╝╚══════╝╚═╝`;
  const indexBody = `<div class="wrap home">
<section class="hero">
  <pre class="banner" role="img" aria-label="Welcome!">${banner}</pre>
  <p class="hero-sub">终端式的静态博客。按 <kbd>/</kbd> 唤出命令栏：<code>/find</code> 搜索（词、<code>tag:</code>、<code>grep:</code>、语义 <code>about:</code>），<code>/theme</code> 切换主题；<kbd>Space</kbd> 是 leader 键，<kbd>?</kbd> 查看全部快捷键；也可以看 <a href="posts/00-help/help.html">/help → 命令说明</a>。</p>
</section>
<div class="rail-label">目录 · ${seriesList.length} 个文件夹</div>
${seriesHtml}
<p class="footer">note // tui</p>
</div>`;

  await writeFile(
    join(distDir, "index.html"),
    layout({ title: "note", body: indexBody, back: false, scripts, wide: true })
  );
  const searchBody = `<div class="wrap home search-page">
<section class="sr-head">
  <p class="sr-prompt"><span class="sr-dollar">$</span> <span class="sr-cmd">/find</span> <span class="sr-expr" id="sr-expr"></span></p>
  <p class="sr-summary" id="sr-summary">searching…</p>
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
