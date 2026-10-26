import { searchDocs, hasAbout } from "./query.mjs";

/** Small local collection: suggest past queries and matching note titles, never load a model. */
export function buildSearchSuggestions(query, posts = [], history = []) {
  const q = String(query || "").trim();
  const result = searchDocs(posts, q);
  if (!result.ok) return [];
  const items = [], seen = new Set();
  function add(value, label, hint) {
    if (seen.has(value) || items.length >= 7) return;
    seen.add(value);
    items.push({ value, label, hint });
  }
  if (q) add(q, q, "搜索");
  for (const previous of history) {
    if (typeof previous === "string" && (!q || previous.toLowerCase().startsWith(q.toLowerCase()))) {
      add(previous, previous, "最近搜索");
    }
  }
  if (q && !hasAbout(result.ast)) {
    for (const post of result.results) {
      const value = 'title:"' + String(post.title).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
      add(value, post.title, "笔记标题");
    }
  }
  return items;
}
