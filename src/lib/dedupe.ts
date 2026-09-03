/**
 * Near-duplicate removal for corpus records.
 *
 * The same composition reaches a corpus more than once: a letter sent to five
 * recipients, a draft saved beside its redraft and the sent copy, a message
 * quoted back and re-extracted. Each copy weights that one composition again in
 * the fingerprint, so a single letter can speak five times louder than anything
 * else the author wrote.
 *
 * Two guards keep this from eating real writing:
 *
 * - A length floor. Below it, repetition is habit rather than filing: saying
 *   "ok" a hundred times is part of a voice and must survive untouched.
 * - Jaccard rather than containment. Containment (shared runs over the SMALLER
 *   text) is asymmetric, so a short message quoted inside a long one scores
 *   near 1.0 against it — and since the longest copy is the one kept, the short
 *   original is the one deleted. Jaccard only fires when two texts are
 *   substantially the same text.
 */

/** Below this many words, a repeat is a habit, not a filing artifact. */
export const DEDUP_MIN_WORDS = 25;
/** Jaccard overlap of five-word runs above which two texts are one composition. */
export const DEDUP_THRESHOLD = 0.6;
/**
 * Two copies of one composition are close in length. Comparing only texts
 * within this ratio prunes almost every pair before the set arithmetic, which
 * matters because the comparison is quadratic and some records are enormous.
 */
const LENGTH_RATIO = 0.6;

/** Overlapping five-word runs, the unit of comparison. */
export function shingles(text: string): Set<string> {
  const w = text
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i + 4 < w.length; i++) out.add(w.slice(i, i + 5).join(" "));
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of b) if (a.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

export interface DedupeResult<T> {
  kept: T[];
  removed: number;
  /** Words carried by the removed copies, for aggregate reporting. */
  removedWords: number;
}

/**
 * Drop repeat copies of a composition, keeping the fullest one.
 *
 * The fullest copy is kept because a redraft is usually the longest of its set,
 * and because keeping the shortest would silently truncate the composition.
 * Order among the kept records is preserved.
 */
export function dropNearDuplicates<T>(
  items: T[],
  textOf: (item: T) => string,
  wordsOf: (item: T) => number,
): DedupeResult<T> {
  const long: number[] = [];
  for (let i = 0; i < items.length; i++) {
    if (wordsOf(items[i]!) >= DEDUP_MIN_WORDS) long.push(i);
  }
  // Longest first, so the copy that survives a group is the fullest one.
  long.sort((a, b) => wordsOf(items[b]!) - wordsOf(items[a]!));

  const shing = new Map<number, Set<string>>();
  const drop = new Set<number>();
  let removedWords = 0;

  for (let a = 0; a < long.length; a++) {
    const i = long[a]!;
    if (drop.has(i)) continue;
    const wi = wordsOf(items[i]!);
    let si = shing.get(i);
    for (let b = a + 1; b < long.length; b++) {
      const j = long[b]!;
      if (drop.has(j)) continue;
      const wj = wordsOf(items[j]!);
      // Sorted by length, so once a candidate is too short every later one is.
      if (wj < wi * LENGTH_RATIO) break;
      if (!si) {
        si = shingles(textOf(items[i]!));
        shing.set(i, si);
      }
      let sj = shing.get(j);
      if (!sj) {
        sj = shingles(textOf(items[j]!));
        shing.set(j, sj);
      }
      if (jaccard(si, sj) > DEDUP_THRESHOLD) {
        drop.add(j);
        removedWords += wj;
      }
    }
  }

  return {
    kept: items.filter((_, i) => !drop.has(i)),
    removed: drop.size,
    removedWords,
  };
}

/**
 * The same, for the JSONL lines the ingest stages buffer before writing.
 *
 * Every stage holds its output as encoded lines rather than records, so this
 * saves each one re-deriving the same two accessors.
 */
export function dropNearDuplicateLines(lines: string[]): DedupeResult<string> {
  return dropNearDuplicates(
    lines,
    (l) => String((JSON.parse(l) as { text?: unknown }).text ?? ""),
    (l) => Number((JSON.parse(l) as { words?: unknown }).words ?? 0),
  );
}
