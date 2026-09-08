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
<div class="wrap">
${backLink}
${body}
<p class="footer">note // static tui blog</p>
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
  await cp(join(root, "assets", "terminal.js"), join(distDir, "assets", "terminal.js"));

  const files = (await readdir(postsDir)).filter((f) => f.endsWith(".md")).sort();
  const posts = [];

  for (const file of files) {
    const stem = file.replace(/\.md$/, "");
    const md = await readFile(join(postsDir, file), "utf8");
    const title = extractTitle(md, stem);
    const key = sortKey(stem, title);
    const htmlBody = marked.parse(md);
    const outName = stem + ".html";
    posts.push({ stem, title, key, outName, htmlBody });
  }

  posts.sort((a, b) => a.key - b.key || a.stem.localeCompare(b.stem));

  for (const post of posts) {
    const body = `<div class="box"><div class="box-title">post/${escapeHtml(post.stem)}.md</div><div class="box-body"><article class="post">${post.htmlBody}</article></div></div>`;
    const page = layout({ title: post.title, body, back: true });
    await writeFile(join(distDir, "posts", post.outName), page);
  }

  const postsIndex = posts.map((p) => ({
    title: p.title,
    stem: p.stem,
    href: `posts/${p.outName}`,
  }));

  await writeFile(
    join(distDir, "posts.json"),
    JSON.stringify({ base: BASE, posts: postsIndex }, null, 2) + "\n"
  );

  const items = posts
    .map((p, i) => {
      const n = String(i + 1).padStart(2, "0");
      return `<li><span class="idx">${n}</span><a href="posts/${p.outName}"><span class="title">${escapeHtml(p.title)}</span></a></li>`;
    })
    .join("\n");

  const postsJsonLiteral = JSON.stringify(postsIndex).replace(/</g, "\\u003c");

  const indexBody = `<div class="box"><div class="box-title">~/note</div><div class="box-body">
<div class="term">
  <div class="term-line">
    <label class="prompt-label" for="term-input">guest@note:<span class="cwd">~</span>$</label>
    <input class="term-input" id="term-input" type="text" autocomplete="off" spellcheck="false" autofocus placeholder="/goto &lt;title&gt;" aria-autocomplete="list" aria-controls="suggest" aria-haspopup="listbox">
  </div>
  <ul class="suggest" id="suggest" role="listbox" hidden></ul>
  <pre class="term-echo" id="term-echo" hidden></pre>
</div>
<p class="hint">commands: /goto &lt;title&gt; · ↑↓ / Tab cycle · Enter open · Esc clear</p>
<div class="ls-block">
  <div class="prompt">guest@note:<span class="cwd">~/note</span>$ ls posts/</div>
  <ul class="menu">${items}</ul>
</div>
</div></div>`;

  const scripts = `<script>window.__POSTS__=${postsJsonLiteral};window.__BASE__=${JSON.stringify(BASE)};</script>
<script src="assets/terminal.js"></script>`;

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
