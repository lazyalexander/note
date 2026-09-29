/** Build-time search index: plain-text bodies for client-side /tag search. Pure (no fs). */

const ENT = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'", "&nbsp;": " " };

/** Rendered post HTML → plain text (whitespace collapsed). */
export function htmlToPlain(html) {
  return String(html || "")
    .replace(/<\/(p|h[1-6]|li|pre|blockquote|tr|div)>/gi, " ")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (m) => ENT[m])
    .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(Number(d)))
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * posts: [{ title, stem, outName, htmlBody, tags, index, series:{dir,title} }]
 * → { v, series:[{dir,no,slug,title,count}], docs:[...] }
 */
export function buildSearchIndex(seriesList, posts) {
  const series = seriesList.map((s) => ({
    dir: s.dir,
    no: (s.dir.match(/^\d+/) || [""])[0],
    slug: s.dir.replace(/^\d+[-_.\s]*/, "") || s.dir,
    title: s.title,
    count: s.posts.length,
  }));
  const docs = posts.map((p) => ({
    stem: p.stem,
    dir: p.series.dir,
    seriesNo: (p.series.dir.match(/^\d+/) || [""])[0],
    seriesTitle: p.series.title,
    n: String(p.index + 1).padStart(2, "0"),
    title: p.title,
    href: "posts/" + p.outName,
    tags: p.tags,
    body: htmlToPlain(p.htmlBody),
  }));
  return { v: 1, series, docs };
}
