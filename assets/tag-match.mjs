/** Simplest tag filter: one prefix/exact atom, no & / || / parens. */
import { scrubInvisible, normalizeTag } from "./text-scrub.mjs";

export const TAG_QUERY_MAX = 64;

export function postTags(p) {
  return Array.isArray(p?.tags) ? p.tags : [];
}

/**
 * Exact or prefix on normalized tags. Mid-string does NOT match.
 * ASCII lowercased; Chinese kept as-is after NFKC scrub.
 */
export function tagAtomMatches(postTag, atom) {
  const a = normalizeTag(atom);
  const t = normalizeTag(postTag);
  if (!a || !t) return false;
  return t === a || t.startsWith(a);
}

export function postMatchesAtom(p, atom) {
  return postTags(p).some((tg) => tagAtomMatches(tg, atom));
}

/**
 * Filter posts by a single tag query string (optional leading @).
 * Empty → no posts (never dump the catalog).
 */
export function filterPostsByTag(posts, query, maxLen = TAG_QUERY_MAX) {
  const list = Array.isArray(posts) ? posts : [];
  const raw = scrubInvisible(query).trim().replace(/^@+/, "");
  if (!raw) return { posts: [], error: null };
  if (raw.length > maxLen) {
    return { posts: [], error: `tag query max ${maxLen} chars` };
  }
  const hits = list.filter((p) => postMatchesAtom(p, raw));
  return { posts: hits, error: null };
}
