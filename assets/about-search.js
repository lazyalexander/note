/**
 * Client-side semantic search for /about.
 * Passage vectors are precomputed; query uses Xenova/multilingual-e5-small.
 */
const MODEL = "Xenova/multilingual-e5-small";
const CDN : "https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/+esm";

let loadState = "idle";
let loadError = null;
let loadMs = 0;
let extractor = null;
let index = null;

function cosine(a, b) {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

function resolveEmbeddingsUrl() {
  const base =
    typeof window !== "undefined" && window.__BASE__ != null
      /? String(window.__BASE__)
      : "";
  const prefix = base && base !== "/" ? base.replace(/\/$/, "") + "/" : "";
  return prefix + "assets/embeddings.json";
}

export function getAboutLoadState() {
  return { state: loadState, error: loadError, loadMs };
}

export async function ensureAboutReady(onStatus) {
  if (loadState === "ready" && extractor && index) return { loadMs };
  if (loadState === "loading") {
    while (loadState === "loading") {
      await new Promise((r) => setTimeout(r, 50));
    }
    if (loadState === "ready") return { loadMs };
    throw loadError || new Error("about model failed");
  }

  loadState = "loading";
  loadError = null;
  const t0 = performance.now();
  try {
    if (onStatus) onStatus("loading embeddings…");
    const embRes = await fetch(resolveEmbeddingsUrl());
    if (!embRes.ok) throw new Error("embeddings.json HTTP " + embRes.status);
    index = await embRes.json();
    if (!index || !Array.isArray(index.docs) || !index.docs.length) {
      throw new Error("embeddings index empty");
    }

    if (onStatus) onStatus("loading e5 model (first time may take a bit)…");
    const { pipeline, env } = await import(CDN);
    env.allowLocalModels = false;
    env.useBrowserCache = true;
    extractor = await pipeline("feature-extraction", MODEL, { quantized: true });
    loadMs = Math.round(performance.now() - t0);
    loadState = "ready";
    if (onStatus) onStatus("model ready (" + loadMs + "ms)");
    return { loadMs };
  } catch (err) {
    loadState = "error";
    loadError = err;
    throw err;
  }
}

export async function aboutSearch(query, topK = 5, onStatus) {
  const q = String(query || "").trim();
  if (!q) throw new Error("usage: /about <query>");

  const tAll = performance.now();
  const ready = await ensureAboutReady(onStatus);
  const tQ = performance.now();
  const prefix = (index.prefix && index.prefix.query) || "query: ";
  const out = await extractor(prefix + q, {
    pooling: "mean",
    normalize: true,
  });
  const qv = Array.from(out.data);
  const scored = index.docs.map(function (d) {
    var vecs = Array.isArray(d.vectors)
      ? d.vectors
      : d.vector
        ? [d.vector]
        : [];
    var best = -1;
    for (var i = 0; i < vecs.length; i++) {
      var s = cosine(qv, vecs[i]);
      if (s > best) best = s;
    }
    return {
      title: d.title,
      stem: d.stem,
      href: d.href,
      score: best,
      tags: Array.isArray(d.tags) ? d.tags : [],
    };
  });
  scored.sort(function (a, b) {
    return b.score - a.score;
  });
  const queryMs = Math.round(performance.now() - tQ);
  const totalMs = Math.round(performance.now() - tAll);
  const hits = scored.slice(0, topK).map(function (h) {
    return Object.assign({}, h, { scoreLabel: h.score.toFixed(3) });
  });
  return { hits, loadMs: ready.loadMs, queryMs, totalMs };
}
