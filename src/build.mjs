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

function layout({ title, body, back }) {
  const backLink = back
    ? `<a class="back" href="${href("")}">&lt;-- back</a>`
    : "";
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
</body>
</html>
`;
}

async function main() {
  await mkdir(join(distDir, "posts"), { recursive: true });
  await mkdir(join(distDir, "assets"), { recursive: true });
  await cp(join(root, "assets", "style.css"), join(distDir, "assets", "style.css"));

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

  const items = posts.map((p, i) => {
    const n = String(i + 1).padStart(2, "0");
    return `<li><span class="idx">${n}</span><a href="posts/${p.outName}"><span class="title">${escapeHtml(p.title)}</span></a></li>`;
  }).join("\n");

  const indexBody = `<div class="box"><div class="box-title">~/note</div><div class="box-body"><div class="prompt">guest@pages:<span class="cwd">~/note</span>$ ls posts/</div><ul class="menu">${items}</ul><p class="hint">select a post // drop .md into posts/ then push</p></div></div>`;
  await writeFile(join(distDir, "index.html"), layout({ title: "note", body: indexBody, back: false }));
  console.log(`Built ${posts.length} posts -> dist/ (BASE_PATH=${BASE || "(root)"})`);
}

main().catch((err) => { console.error(err); process.exit(1); });
