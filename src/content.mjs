import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

/** "02-poe" -> "poe" (display fallback for a series title). */
export function prettyName(name) {
  return name.replace(/^\d+[-_.\s]*/, "") || name;
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (err) {
    if (err && err.code === "ENOENT") return fallback;
    throw err;
  }
}

/**
 * Scan `content/`: every sub-folder is a series, every post is a `.md` inside a
 * series folder (a single post still gets its own folder). Files placed directly
 * in `content/` and folders starting with "." or "_" are not published; folders
 * outside `content/` are never read.
 *
 * content/<NN-series>/series.json     optional { title, description }
 * content/<NN-series>/<NN-post>.md    post (first "# " line is the title)
 * content/<NN-series>/<NN-post>.json  optional { tags: [] }
 */
export async function loadContent(contentDir) {
  const entries = await readdir(contentDir, { withFileTypes: true });
  const dirs = entries
    .filter((e) => e.isDirectory() && !/^[._]/.test(e.name))
    .map((e) => e.name)
    .sort(collator.compare);
  const series = [];
  for (const dir of dirs) {
    const sdir = join(contentDir, dir);
    const smeta = await readJson(join(sdir, "series.json"), {});
    const files = (await readdir(sdir))
      .filter((f) => f.endsWith(".md") && !/^[._]/.test(f))
      .sort(collator.compare);
    if (!files.length) continue;
    const posts = [];
    for (const file of files) {
      const name = file.replace(/\.md$/, "");
      const md = await readFile(join(sdir, file), "utf8");
      const meta = await readJson(join(sdir, name + ".json"), { tags: [] });
      posts.push({ seriesDir: dir, name, stem: `${dir}/${name}`, md, meta });
    }
    series.push({
      dir,
      title: String(smeta.title || prettyName(dir)),
      description: String(smeta.description || ""),
      posts,
    });
  }
  return series;
}
