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
  return `<div class="term-bar"><div class="term-bar-inner"><div class="term">
  <div class="term-line">
    <label class="prompt-label" for="term-input">guest@note:<span class="cwd">~</span>$</label>
    <input class="term-input" id="term-input" type="text" autocomplete="off" spellcheck="false" autofocus placeholder="/welcome" aria-autocomplete="list" aria-controls="suggest" aria-haspopup="listbox">
  </div>
  <ul class="suggest" id="suggest" role="listbox" hidden></ul>
  <pre class="term-echo" id="term-echo" hidden></pre>
</div></div></div>`;
}

function layout({ title, body, back, scripts }) {
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
<link rel="stylesheet" href="assets/style.css">
</head>
<body>
${termBarHtml()}
<div class="wrap">
${backLink}
${body}
<p class="footer">note // tokyo night tui</p>
</div>
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
    if (tags.length) {
      const tagsHtml = `<p class="tags">${tags
        .map((tg) => `<span class="tag">@${escapeHtml(tg)}</span>`)
        .join(" ")}</p>`;
      htmlBody = htmlBody.replace(/<\/h1>/i, `</h1>\n${tagsHtml}`);
    }
    const outName = stem + ".html";
    // Keep full meta for future fields; index still exposes tags.
    posts.push({ stem, title, key, outName, htmlBody, tags, meta });
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
<script type="module" src="assets/terminal.js?v=24"></script>`;

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

  for (const post of posts) {
    const body = `<div class="box"><div class="box-title">post/${escapeHtml(post.stem)}.md</div><div class="box-body"><article class="post">${post.htmlBody}</article></div></div>`;
    const page = layout({ title: post.title, body, back: true, scripts });
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

  const indexBody = `<div class="box"><div class="box-title">~/note</div><div class="box-body">
<div class="ls-block">
  <div class="prompt">guest@note:<span class="cwd">~/note</span>$ ls posts/</div>
  <ul class="menu">${items}</ul>
</div>
</div></div>`;

  await writeFile(
    join(distDir, "index.html"),
    layout({ title: "note", body: indexBody, back: false, scripts })
  );
  console.log(`Built ${posts.length} posts -> dist/ (BASE_PATH=${BASE || "(root)"})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
