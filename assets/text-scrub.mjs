/** IME / Unicode cleanup helpers for the note TUI. */

/**
 * Strip IME junk (ZWSP/BOM/bidi/…) and NFKC-normalize (fullwidth → halfwidth).
 */
export function scrubInvisible(s) {
  return (
    String(s || "")
      .normalize("NFKC")
      .replace(/\p{Cf}/gu, "")
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "")
  );
}

/** Hex codepoints for diagnostics (shown on tag no-match). */
export function codepointsHex(s) {
  return [...String(s || "")]
    .map((c) => c.codePointAt(0).toString(16))
    .join(" ");
}

export function normalizeTag(t) {
  return scrubInvisible(t)
    .trim()
    .toLowerCase()
    .replace(/^@/, "");
}
