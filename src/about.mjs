/**
 * Semantic-search helpers (pure, no DOM / no model): cosine scoring over a precomputed passage-embedding index,
 * selector picking (top-N / bottom-N / >threshold) and the adaptive default set size.
 */

/** Adaptive default: keep the outliers of the score distribution, z >= DYN_Z above the mean. */
export const DYN_Z = 0.75;
/** If best - worst is below this the scores are flat (e5 scores live in ~0.75–0.90): no real signal → keep only the best one. */
export const DYN_MIN_SPREAD = 0.035;

export function cosine(a, b) {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

/**
 * Score every post: max cosine over its passages (the embeddings index is per passage — paragraph-packed chunks
 * of <= ~450 chars plus one title-only vector). → Map(stem → { score, idx, passage })
 * `passage` is the best-matching passage text ("" when the title-only vector wins).
 */
export function scoreEmbeddings(qv, embIndex) {
  const out = new Map();
  for (const d of (embIndex && embIndex.docs) || []) {
    const vecs = Array.isArray(d.vectors) ? d.vectors : d.vector ? [d.vector] : [];
    let best = -Infinity;
    let bi = -1;
    for (let i = 0; i < vecs.length; i++) {
      const s = cosine(qv, vecs[i]);
      if (s > best) {
        best = s;
        bi = i;
      }
    }
    if (bi < 0) continue;
    out.set(d.stem, { score: best, idx: bi, passage: (Array.isArray(d.passages) && d.passages[bi]) || "" });
  }
  return out;
}

/** Upper bound of the adaptive default for a candidate set of n posts: at most ceil(n/2), and never everything (n>=2). */
export function dynamicMax(n) {
  if (n <= 1) return Math.max(0, n);
  return Math.min(n - 1, Math.ceil(n / 2));
}

/**
 * How many of the best-scoring posts to keep when the query gives no explicit selector.
 * z-score cut on the score distribution: keep posts whose score is >= mean + DYN_Z * stddev (i.e. the clear
 * outliers of THIS query, whatever the model's absolute score range is), bounded to [1, dynamicMax(n)].
 * n=0 → 0, n=1 → 1, all-equal / nearly flat scores (no signal) → 1.
 */
export function dynamicCount(scores) {
  const s = (scores || []).filter(Number.isFinite).sort((a, b) => b - a);
  const n = s.length;
  if (n <= 1) return n;
  const cap = dynamicMax(n);
  const mean = s.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(s.reduce((a, b) => a + (b - mean) * (b - mean), 0) / n);
  if (!(sd > 1e-9) || s[0] - s[n - 1] < DYN_MIN_SPREAD) return 1;
  let k = 0;
  while (k < cap && (s[k] - mean) / sd >= DYN_Z) k++;
  return Math.max(1, k);
}

/**
 * Pick ids from [{id, score}] by selector. sel: null (adaptive) | {mode:"top"|"bottom", n} | {mode:"gt", min, inclusive}.
 * Returns ids ordered by score descending (ties keep input order).
 */
export function selectAbout(entries, sel) {
  const arr = (entries || []).filter((e) => Number.isFinite(e.score)).map((e, i) => ({ ...e, _i: i }));
  arr.sort((a, b) => b.score - a.score || a._i - b._i);
  let picked;
  if (!sel) picked = arr.slice(0, dynamicCount(arr.map((e) => e.score)));
  else if (sel.mode === "top") picked = arr.slice(0, sel.n);
  else if (sel.mode === "bottom") picked = arr.slice(Math.max(0, arr.length - sel.n));
  else if (sel.mode === "gt") picked = arr.filter((e) => (sel.inclusive ? e.score >= sel.min : e.score > sel.min));
  else picked = [];
  return picked.map((e) => e.id);
}
