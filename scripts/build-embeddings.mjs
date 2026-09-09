/**
 * Build passage embeddings for /about semantic search.
 * Model: Xenova/multilingual-e5-small (query:/passage: prefixes).
 * Long posts are chunked; client takes max cosine per doc.
 */
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "@xenova/transformers";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const postsDir = join(root, "posts");
const outDir = join(root, "assets");
const outFile = join(outDir, "embeddings.json");
const CHUNK = 1400;
const OVERLAP = 200;

function extractTitle(md, stem) {
  const m = md.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : stem;
}

function extractTags(md) {
  const m = md.match(/^@[^\n]+$/m);
  if (!m) return [];
  return [...m[0].matchAll(/@([\w\-\u4e00-\u9fff]+)/g)].map((x) => x[1]);
}

function stripMd(md) {
  return String(md)
    .replace(/^#[^\n]*\n/, "")
    .replace(/^@[^\n]*\n/m, "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[#>*_`~]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function chunkText(text, size, overlap) {
  if (text.length <= size) return [text];
  const out = [];
  let i = 0;
  while (i < text.length) {
    out.push(text.slice(i, i + size));
    if (i + size >= text.length) break;
    i += size - overlap;
  }
  return out;
}

async function embedPassage(extractor, text) {
  const out = await extractor(text, { pooling: "mean", normalize: true });
  return Array.from(out.data);
}

async function main() {
  console.log("Loading multilingual-e5-small…");
  const t0 = Date.now();
  const extractor = await pipeline(
    "feature-extraction",
    "Xenova/multilingual-e5-small",
    { quantized: true }
  );
  console.log(`Model ready in ${Date.now() - t0}ms`);

  const files = (await readdir(postsDir)).filter((f) => f.endsWith(".md")).sort();
  const docs = [];
  for (const file of files) {
    const stem = file.replace(/\.md$/, "");
    const md = await readFile(join(postsDir, file), "utf8");
    const title = extractTitle(md, stem);
    const tags = [];
    const body = stripMd(md);
    const tagLine = tags.length ? tags.map((t) => "@" + t).join(" ") : "";
    const head = `${title}. ${tagLine}`.trim();
    const chunks = chunkText(body, CHUNK, OVERLAP);
    const vectors = [];
    const t1 = Date.now();
    for (let i = 0; i < chunks.length; i++) {
      const passage = `passage: ${head}. ${chunks[i]}`.slice(0, 8000);
      vectors.push(await embedPassage(extractor, passage));
    }
    // title-only vector helps short queries
    vectors.push(await embedPassage(extractor, `passage: ${head}`));
    console.log(
      `embedded ${stem} chunks=${vectors.length} dim=${vectors[0].length} in ${Date.now() - t1}ms`
    );
    docs.push({
      stem,
      title,
      href: `posts/${stem}.html`,
      chars: body.length,
      tags,
      vectors,
    });
  }

  const payload = {
    model: "Xenova/multilingual-e5-small",
    prefix: { query: "query: ", passage: "passage: " },
    createdAt: new Date().toISOString(),
    docs,
  };
  await mkdir(outDir, { recursive: true });
  await writeFile(outFile, JSON.stringify(payload));
  console.log(`Wrote ${outFile} (${docs.length} docs)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
