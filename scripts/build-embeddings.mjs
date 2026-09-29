/**
 * Build passage embeddings for /about semantic search.
 * Model: Xenova/multilingual-e5-small (query:/passage: prefixes).
 * Posts are split into paragraph-aware passages (<= CHUNK chars); each passage text is stored next to its
 * vector so the results page can show the best-matching passage. The client scores a post as the max cosine
 * over its passages (the last passage is the title alone).
 */
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { loadContent } from "../src/content.mjs";
import { fileURLToPath } from "node:url";
import { pipeline } from "@xenova/transformers";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const contentDir = join(root, "content");
const outDir = join(root, "assets");
const outFile = join(outDir, "embeddings.json");
const CHUNK = 450; // max chars per passage (e5-small handles 512 tokens; CJK is ~1 token/char)
const VEC_DIGITS = 4;

function extractTitle(md, stem) {
  const m = md.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : stem;
}

function extractTags(md) {
  const m = md.match(/^@[^\n]+$/m);
  if (!m) return [];
  return [...m[0].matchAll(/@([\w\-\u4e00-\u9fff]+)/g)].map((x) => x[1]);
}

/** Markdown → plain paragraphs (blank-line separated blocks, inner whitespace collapsed). */
function paragraphs(md) {
  return String(md)
    .replace(/^#[^\n]*\n/, "")
    .replace(/^@[^\n]*\n/m, "")
    .replace(/```[\s\S]*?```/g, "\n\n")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[#>*_`~|]/g, " ")
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p.length > 1);
}

/** Split an over-long paragraph at sentence ends (then hard-cut at spaces). */
function splitLong(p, max) {
  const sents = p.split(/(?<=[.!?。！？;；”"])\s+|(?<=[。！？；])/u).filter(Boolean);
  const out = [];
  let cur = "";
  const flush = () => { if (cur.trim()) out.push(cur.trim()); cur = ""; };
  for (let s of sents) {
    while (s.length > max) {
      const cut = s.lastIndexOf(" ", max) > max / 2 ? s.lastIndexOf(" ", max) : max;
      if (cur) flush();
      out.push(s.slice(0, cut).trim());
      s = s.slice(cut).trim();
    }
    if (cur && cur.length + 1 + s.length > max) flush();
    cur = cur ? cur + " " + s : s;
  }
  flush();
  return out;
}

/** Paragraph-aware chunks of at most `max` chars (short paragraphs are packed together up to `max`). */
function chunkParagraphs(paras, max) {
  const out = [];
  let cur = "";
  for (const p of paras) {
    for (const piece of p.length > max ? splitLong(p, max) : [p]) {
      if (cur && cur.length + 1 + piece.length > max) {
        out.push(cur);
        cur = "";
      }
      cur = cur ? cur + " " + piece : piece;
    }
  }
  if (cur) out.push(cur);
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

  const all = (await loadContent(contentDir)).flatMap((s) => s.posts);
  const docs = [];
  for (const src of all) {
    const { stem, md } = src;
    const title = extractTitle(md, src.name);
    const tags = [];
    const body = paragraphs(md);
    const chunks = chunkParagraphs(body, CHUNK);
    const vectors = [];
    const passages = [];
    const t1 = Date.now();
    for (const c of chunks) {
      vectors.push(await embedPassage(extractor, `passage: ${c}`));
      passages.push(c);
    }
    // title-only vector helps short queries (empty passage text = no snippet)
    vectors.push(await embedPassage(extractor, `passage: ${title}`));
    passages.push("");
    console.log(
      `embedded ${stem} passages=${vectors.length} dim=${vectors[0].length} in ${Date.now() - t1}ms`
    );
    docs.push({
      stem,
      title,
      href: `posts/${stem}.html`,
      chars: body.join(" ").length,
      tags,
      passages,
      vectors: vectors.map((v) => v.map((x) => Number(x.toFixed(VEC_DIGITS)))),
    });
  }

  const payload = {
    v: 2,
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
