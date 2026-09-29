/**
 * Client-side semantic scoring for `about:` terms (find grammar).
 * Passage vectors are precomputed (assets/embeddings.json, per paragraph-packed passage);
 * the query is embedded in the browser with Xenova/multilingual-e5-small.
 *
 *   scoreAbout(query) → Promise<Map(stem → { score, passage })>   score = max cosine over the post's passages
 *
 * Query vectors are cached in memory and in localStorage (keyed by model + index build), so repeats are instant.
 */
import { scoreEmbeddings } from "./term-engine.js?v=37";

const MODEL = "Xenova/multilingual-e5-small";
const CDN = "https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/+esm";
const CACHE_KEY = "note-about-qv";
const CACHE_MAX = 40;

let loadState = "idle";
let loadError = null;
let loadMs = 0;
let extractor = null;
let index = null;
let loading = null;
const memo = new Map(); // query → Float32-ish array

function resolveEmbeddingsUrl() {
  const base = typeof window !== "undefined" && window.__BASE__ != null ? String(window.__BASE__) : "";
  const prefix = base && base !== "/" ? base.replace(/\/$/, "") + "/" : "";
  return prefix + "assets/embeddings.json?v=37";
}

export function getAboutLoadState() {
  return { state: loadState, error: loadError, loadMs };
}

function cacheTag() {
  return MODEL + "|" + ((index && index.createdAt) || "");
}
function readCache() {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
    return c && Array.isArray(c.items) ? c : { tag: "", items: [] };
  } catch (e) {
    return { tag: "", items: [] };
  }
}
function cachedVector(q) {
  if (memo.has(q)) return memo.get(q);
  const c = readCache();
  if (c.tag !== cacheTag()) return null; // model / index changed (vectors are model-specific)
  const hit = c.items.find((x) => x[0] === q);
  if (hit) {
    memo.set(q, hit[1]);
    return hit[1];
  }
  return null;
}
function storeVector(q, v) {
  memo.set(q, v);
  try {
    const c = readCache();
    const items = c.tag === cacheTag() ? c.items.filter((x) => x[0] !== q) : [];
    items.unshift([q, v.map((x) => Math.round(x * 1e4) / 1e4)]);
    localStorage.setItem(CACHE_KEY, JSON.stringify({ tag: cacheTag(), items: items.slice(0, CACHE_MAX) }));
  } catch (e) {}
}

/** Load embeddings index only (cheap, no model). */
async function ensureIndex() {
  if (index) return index;
  const res = await fetch(resolveEmbeddingsUrl());
  if (!res.ok) throw new Error("embeddings.json HTTP " + res.status);
  const j = await res.json();
  if (!j || !Array.isArray(j.docs) || !j.docs.length) throw new Error("embeddings index empty");
  index = j;
  return index;
}

/** Load the model (once). onStatus(msg) reports progress. */
export async function ensureAboutReady(onStatus) {
  if (loadState === "ready" && extractor && index) return { loadMs };
  if (loading) return loading;
  loadState = "loading";
  loadError = null;
  loading = (async () => {
    const t0 = performance.now();
    try {
      if (onStatus) onStatus("loading embeddings…");
      await ensureIndex();
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
      loading = null; // allow a retry
      throw err;
    }
  })();
  return loading;
}

/** Query embedding (cached). The model is only loaded on a cache miss. */
export async function embedQuery(query, onStatus) {
  const q = String(query || "").trim();
  if (!q) throw new Error("empty about: query");
  await ensureIndex();
  let qv = cachedVector(q);
  if (qv) return { qv, cached: true };
  await ensureAboutReady(onStatus);
  const prefix = (index.prefix && index.prefix.query) || "query: ";
  const out = await extractor(prefix + q, { pooling: "mean", normalize: true });
  qv = Array.from(out.data);
  storeVector(q, qv);
  return { qv, cached: false };
}

export async function scoreAbout(query, onStatus) {
  const { qv } = await embedQuery(query, onStatus);
  return scoreEmbeddings(qv, index);
}
