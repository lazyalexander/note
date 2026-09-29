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
 * Rendered post HTML → plain-text LINES (what /find grep: numbers like grep -n): one line per block element
 * (paragraph, heading, list item, quote, table row), and one per source line inside code blocks.
 */
export function htmlToLines(html) {
  const dec = (t) =>
    t
      .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (m) => ENT[m])
      .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(Number(d)));
  const out = [];
  const parts = String(html || "").split(/(<pre[\s\S]*?<\/pre>)/i);
  for (const part of parts) {
    if (/^<pre/i.test(part)) {
      for (const l of dec(part.replace(/<[^>]+>/g, "")).split(/\r?\n/)) if (l.trim()) out.push(l.replace(/\s+$/, ""));
      continue;
    }
    const flat = dec(
      part
        .replace(/<\/(p|h[1-6]|li|blockquote|tr|div|ul|ol|table)>/gi, "\u0001")
        .replace(/<br\s*\/?>/gi, "\u0001")
        .replace(/<[^>]+>/g, "")
    );
    for (const l of flat.split("\u0001")) {
      const t = l.replace(/\s+/g, " ").trim();
      if (t) out.push(t);
    }
  }
  return out;
}

/**
 * posts: [{ title, stem, outName, htmlBody, tags, index, series:{dir,title} }]
 * → { v, series:[{dir,no,slug,title,count}], docs:[{..., lines:[string]}] }
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
    lines: htmlToLines(p.htmlBody), // body text = lines joined by " " (client side)
  }));
  return { v: 2, series, docs };
}
