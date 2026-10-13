/**
 * Text primitives shared across stages. The regexes are deliberately not the
 * JS defaults:
 *
 * - Word tokenization uses `\p{L}\p{N}_` under the `u` flag, so a word is
 *   Unicode-aware (letters, numbers, underscore) rather than ASCII-only. This
 *   matters for Greek/greeklish rhythm counting.
 * - `demojibake` reverses a latin-1 mis-decoding of UTF-8 bytes, falling back
 *   to the original string when a character is outside latin-1 or the bytes
 *   are not valid UTF-8.
 */

const WORD_RE = /[\p{L}\p{N}_']+/gu;
const TYPO_RE = /[a-z']{4,14}/g;
const LATIN_LOWER_RE = /[a-z]+/g;

/** Unicode-aware word tokens (letters, numbers, underscore, apostrophe). */
export function words(t: string): string[] {
  return t.match(WORD_RE) ?? [];
}

/** ASCII typo-candidate tokens: 4–14 lowercase letters/apostrophes. */
export function typoTokens(t: string): string[] {
  return t.match(TYPO_RE) ?? [];
}

/** ASCII lowercase runs of the lowercased input. */
export function latinLowerWords(s: string): string[] {
  return s.toLowerCase().match(LATIN_LOWER_RE) ?? [];
}

/**
 * Sentence splitting: newlines are layout, not punctuation. A blank line is a
 * boundary; a single newline reads as a space. Split on `.!?` and the blank-line
 * marker, trimming and dropping empties.
 */
export function sentencesOf(text: string): string[] {
  let t = text.replace(/\n\s*\n/g, "¶"); // blank line → ¶
  t = t.replace(/\n/g, " ");
  return t
    .split(/[.!?¶]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// The whitespace set for splitting and trimming: ASCII 0x09–0x0d, 0x1c–0x1f
// and 0x20, NEL 0x85, plus the Unicode White_Space characters — but NOT the
// BOM (0xFEFF), which JS `\s` wrongly includes. Keeping this set fixed keeps
// word counts stable.
const PY_WS =
  "\\t\\n\\x0b\\f\\r\\x1c\\x1d\\x1e\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const PY_WS_SPLIT = new RegExp(`[${PY_WS}]+`);
const PY_WS_TRIM = new RegExp(`^[${PY_WS}]+|[${PY_WS}]+$`, "g");

/** Split on runs of the whitespace set above, dropping empty pieces. */
export function whitespaceSplit(s: string): string[] {
  const t = s.replace(PY_WS_TRIM, "");
  return t.length === 0 ? [] : t.split(PY_WS_SPLIT);
}

/**
 * Undo Meta's mojibake: it writes UTF-8 bytes escaped as latin-1, so text
 * arrives double-encoded. Re-reads the code points as bytes and decodes them
 * as UTF-8, falling back to the original string when that is not possible.
 */
export function demojibake(s: string): string {
  // A code point above 0xFF cannot be a latin-1 byte — properly-encoded Greek
  // and emoji land here and are returned unchanged.
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c > 0xff) return s;
    bytes[i] = c;
  }
  // Node's UTF-8 decoder inserts U+FFFD for invalid bytes and never throws;
  // treat a replacement char as the decode having failed.
  const decoded = Buffer.from(bytes).toString("utf8");
  if (decoded.includes("�")) return s;
  return decoded;
}
