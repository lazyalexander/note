import { readdir, readFile, writeFile, mkdir, cp } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const postsDir = join(root, "posts");
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
  return `<header class="term-bar"><div class="term-bar-inner">
  <a class="brand" href="${href("")}" aria-label="首页"><span class="brand-mark">n</span><span class="brand-name">note</span></a>
  <div class="term">
    <label class="term-line" for="term-input">
      <span class="prompt-label">$</span>
      <input class="term-input" id="term-input" type="text" autocomplete="off" spellcheck="false" autofocus placeholder="输入命令或搜索… 试试 /goto  /about  /theme" aria-autocomplete="list" aria-controls="suggest" aria-haspopup="listbox">
      <kbd class="term-kbd" aria-hidden="true">/</kbd>
    </label>
    <div class="term-pop">
      <pre class="term-echo" id="term-echo" hidden></pre>
      <ul class="suggest" id="suggest" role="listbox" hidden></ul>
    </div>
  </div>
  <button class="theme-toggle" id="theme-toggle" type="button" aria-label="切换主题" title="切换主题（自动 / paper / tokyo / ink）">◐</button>
</div></header>`;
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
<link rel="stylesheet" href="assets/style.css?v=27">
</head>
<body>
${termBarHtml()}
${wide ? body : `<div class="wrap">
${backLink}
${body}
<p class="footer">note // tui</p>
</div>`}
${scriptTags}
</body>
</html>
`;
}

async function main() {
  await mkdir(join(distDir, "posts"), { recursive: true });
  await mkdir(join(distDir, "assets"), { recursive: true });
  await cp(join(root, "assets", "style.css"), join(distDir, "assets", "style.css"));
  // Bundle split engine sources into one browser file (avoids multi-.mjs load issues).
  const scrubSrc = await readFile(join(root, "src", "text-scrub.mjs"), "utf8");
  const tagSrc = await readFile(join(root, "src", "tag-match.mjs"), "utf8");
  const engSrc = await readFile(join(root, "src", "term-engine.mjs"), "utf8");
  function stripImports(src) {
    return src.replace(/^import\s+[\s\S]*?from\s+["'][^"']+["'];\s*/gm, "");
  }
  function stripReexport(src) {
    return src.replace(/^export\s*\{[\s\S]*?\};\s*/m, "");
  }
  const engineBundle = [
    "/** Auto-bundled from text-scrub + tag-match + term-engine. */",
    scrubSrc.trim(),
    stripImports(tagSrc).trim(),
    stripReexport(stripImports(engSrc)).trim(),
    "",
  ].join("\n\n");
  await writeFile(join(root, "assets", "term-engine.js"), engineBundle);
  await writeFile(join(distDir, "assets", "term-engine.js"), engineBundle);
  // Keep split sources in dist for debugging / egg raw view of entry.
  for (const f of ["text-scrub.mjs", "tag-match.mjs", "term-engine.mjs"]) {
    await cp(join(root, "src", f), join(distDir, "assets", f));
    await cp(join(root, "src", f), join(root, "assets", f));
  }
  await cp(join(root, "assets", "terminal.js"), join(distDir, "assets", "terminal.js"));
  await cp(join(root, "assets", "reader.js"), join(distDir, "assets", "reader.js"));
  await cp(join(root, "assets", "about-search.js"), join(distDir, "assets", "about-search.js"));
  await cp(join(root, "assets", "embeddings.json"), join(distDir, "assets", "embeddings.json"));
  await mkdir(join(distDir, "assets", "bad-apple"), { recursive: true });
  await cp(join(root, "assets", "bad-apple"), join(distDir, "assets", "bad-apple"), { recursive: true });

  const files = (await readdir(postsDir)).filter((f) => f.endsWith(".md")).sort();
  const posts = [];

  for (const file of files) {
    const stem = file.replace(/\.md$/, "");
    const md = await readFile(join(postsDir, file), "utf8");
    const title = extractTitle(md, stem);
    let meta = { tags: [] };
    try {
      const rawMeta = await readFile(join(postsDir, stem + ".json"), "utf8");
      meta = JSON.parse(rawMeta);
    } catch (err) {
      if (!err || err.code !== "ENOENT") throw err;
    }
    const tags = Array.isArray(meta.tags)
      ? meta.tags.map((x) => String(x)).filter(Boolean)
      : [];
    const key = sortKey(stem, title);
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
    const outName = stem + ".html";
    // Keep full meta for future fields; index still exposes tags.
    posts.push({ stem, title, key, outName, htmlBody, tags, meta, outline, minutes });
  }

  posts.sort((a, b) => a.key - b.key || a.stem.localeCompare(b.stem));

  const postsIndex = posts.map((p) => ({
    title: p.title,
    stem: p.stem,
    href: `posts/${p.outName}`,
    tags: p.tags,
  }));

  const postsJsonLiteral = JSON.stringify(postsIndex).replace(/</g, "\\u003c");
  const scripts = `<script>window.__POSTS__=${postsJsonLiteral};window.__BASE__=${JSON.stringify(BASE)};</script>
<script type="module" src="assets/terminal.js?v=27"></script>
<script src="assets/reader.js?v=27" defer></script>`;

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

  const railHtml = (activeStem) =>
    posts
      .map((q, i) => {
        const n = String(i + 1).padStart(2, "0");
        const cls = q.stem === activeStem ? ' class="active"' : "";
        return `<a${cls} href="posts/${q.outName}"><span class="rail-number">${n}</span><span>${escapeHtml(q.title)}</span></a>`;
      })
      .join("\n");

  for (const [idx, post] of posts.entries()) {
    const n = String(idx + 1).padStart(2, "0");
    const tagsHtml = post.tags.length
      ? `<p class="tags">${post.tags.map((tg) => `<span class="tag">@${escapeHtml(tg)}</span>`).join(" ")}</p>`
      : "";
    const outlineHtml = post.outline.length
      ? post.outline
          .map((o) => `<a href="#${o.id}"${o.level === 3 ? ' class="subsection"' : ""}>${escapeHtml(o.text)}</a>`)
          .join("\n")
      : "";
    const prev = posts[idx - 1];
    const next = posts[idx + 1];
    const pager = `<nav class="pager">${
      prev ? `<a class="prev" href="posts/${prev.outName}"><small>上一篇</small><span>${escapeHtml(prev.title)}</span></a>` : "<span></span>"
    }${
      next ? `<a class="next" href="posts/${next.outName}"><small>下一篇</small><span>${escapeHtml(next.title)}</span></a>` : "<span></span>"
    }</nav>`;
    const body = `<div class="reading-progress"><div></div></div>
<div class="reader-grid">
  <aside class="chapter-rail">
    <a class="back-to-book" href="${href("")}">← 全部文章</a>
    <div class="rail-label">文章</div>
    <nav class="chapter-navigation">
${railHtml(post.stem)}
    </nav>
    <div class="rail-bottom"><a href="${href("posts/00-help.html")}">命令说明 /help</a></div>
  </aside>
  <main class="reading-main">
    <div class="reader-topline"><a href="${href("")}">首页</a><span>/</span><span>${n}</span><span class="reading-time">约 ${post.minutes} 分钟阅读</span></div>
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
    ${outlineHtml ? `<div class="rail-label">本文内容</div><nav class="section-outline">\n${outlineHtml}\n</nav>` : ""}
    <a class="back-to-top" href="#top">↑ 回到顶部</a>
  </aside>
</div>`;
    const page = layout({ title: post.title, body, back: false, scripts, wide: true });
    await writeFile(join(distDir, "posts", post.outName), page);
  }

  await writeFile(
    join(distDir, "posts.json"),
    JSON.stringify({ base: BASE, posts: postsIndex }, null, 2) + "\n"
  );

  const items = posts
    .map((p, i) => {
      const n = String(i + 1).padStart(2, "0");
      const tagBits = p.tags.length
        ? ` <span class="menu-tags">${p.tags.map((t) => "@" + escapeHtml(t)).join(" ")}</span>`
        : "";
      return `<li><span class="idx">${n}</span><a href="posts/${p.outName}"><span class="title">${escapeHtml(p.title)}</span></a>${tagBits}</li>`;
    })
    .join("\n");

  const banner = String.raw`██╗    ██╗███████╗██╗      ██████╗ ██████╗ ███╗   ███╗███████╗██╗
██║    ██║██╔════╝██║     ██╔════╝██╔═══██╗████╗ ████║██╔════╝██║
██║ █╗ ██║█████╗  ██║     ██║     ██║   ██║██╔████╔██║█████╗  ██║
██║███╗██║██╔══╝  ██║     ██║     ██║   ██║██║╚██╔╝██║██╔══╝  ╚═╝
╚███╔███╔╝███████╗███████╗╚██████╗╚██████╔╝██║ ╚═╝ ██║███████╗██╗
 ╚══╝╚══╝ ╚══════╝╚══════╝ ╚═════╝ ╚═════╝ ╚═╝     ╚═╝╚══════╝╚═╝`;
  const indexBody = `<div class="wrap home">
<section class="hero">
  <pre class="banner" role="img" aria-label="Welcome!">${banner}</pre>
  <p class="hero-sub">终端式的静态博客。顶部命令栏输入 <code>/goto</code> 跳转，<code>/about</code> 语义搜索，<code>/theme</code> 切换主题；不记得命令就看 <a href="posts/00-help.html">/help → 命令说明</a>。</p>
</section>
<div class="rail-label">全部文章 · ${posts.length}</div>
<ul class="menu">${items}</ul>
<p class="footer">note // tui</p>
</div>`;

  await writeFile(
    join(distDir, "index.html"),
    layout({ title: "note", body: indexBody, back: false, scripts, wide: true })
  );
  console.log(`Built ${posts.length} posts -> dist/ (BASE_PATH=${BASE || "(root)"})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
