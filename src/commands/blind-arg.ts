/**
 * Pure parts of the argument-level labeling loop (`blind --unit`): the fixed
 * reason codes, unit hashing, reason parsing, the stored record shape, and
 * sampling-with-exclusion. Everything here is TTY-free so the loop's logic is
 * unit-testable; only src/commands/blind.ts talks to the user.
 *
 * Design source: docs/research/argument-shape.md, "Design: the labeling
 * loop" — the author's reason-coded judgments are what break the classifier
 * circularity the research note flagged, so these shapes are data contracts,
 * not conveniences.
 */
import { createHash } from "node:crypto";
import { whitespaceSplit } from "../lib/text.js";

/** Fixed reason-code list, seeded from the finding and prunable by the data. */
export const REASON_CODES = [
  "open-validate",
  "restate-precise",
  "mechanism-run",
  "close-honest-limit",
  "close-aphorism",
  "para-uniform",
  "tricolon",
  "antithesis",
  "too-balanced",
  "vocabulary",
  "rhythm",
  "other",
] as const;

export type ReasonCode = (typeof REASON_CODES)[number];

/** One judged text: the text plus the identity it is keyed by in the store. */
export interface Unit {
  text: string;
  hash: string;
  wasReal: boolean;
}

/**
 * One stored judgment, appended per item so an interrupted session still
 * banks its labels (and never re-asks them). Field order matches the
 * research note's example; existing `serve` records keep their own shape.
 */
export interface BlindArgRecord {
  ts: string;
  register: string;
  kind: "blind-arg";
  unit_hash: string;
  verdict: "mine" | "not-mine";
  was_real: boolean;
  reasons: string[];
  note: string;
}

export function makeBlindArgRecord(args: {
  ts: string;
  register: string;
  unitHash: string;
  verdict: "mine" | "not-mine";
  wasReal: boolean;
  reasons: string[];
  note: string;
}): BlindArgRecord {
  return {
    ts: args.ts,
    register: args.register,
    kind: "blind-arg",
    unit_hash: args.unitHash,
    verdict: args.verdict,
    was_real: args.wasReal,
    reasons: args.reasons,
    note: args.note.slice(0, 500),
  };
}

/**
 * Normalize a unit for hashing: Python-whitespace collapsed to single
 * spaces, trimmed, lowercased — so a re-fed text differing only in layout or
 * case is still recognized as judged.
 */
export function normalizeUnitText(t: string): string {
  return whitespaceSplit(t).join(" ").toLowerCase();
}

/** `sha256:<hex>` of the normalized text — the never-re-ask key. */
export function unitHash(t: string): string {
  const hex = createHash("sha256").update(normalizeUnitText(t)).digest("hex");
  return `sha256:${hex}`;
}

export type ParsedReasons =
  | { ok: true; codes: ReasonCode[] }
  | { ok: false; unknown: string[] };

/**
 * Parse a comma-separated reason-code answer: trimming and case are
 * lenient, membership is not — an unknown code is reported back for a
 * re-ask rather than silently dropped (the codes are the labeled data).
 * The empty answer is valid and means "no code".
 */
export function parseReasons(input: string): ParsedReasons {
  const parts = input
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
  const unknown = parts.filter(
    (p) => !(REASON_CODES as readonly string[]).includes(p),
  );
  if (unknown.length > 0) return { ok: false, unknown };
  return { ok: true, codes: parts as ReasonCode[] };
}

export type Session =
  | { ok: true; items: Unit[] }
  | { ok: false; unseenReal: number; unseenGenerated: number; need: number };

/**
 * Draw one session's items: perSide unseen units from each side, deduped by
 * hash within a pool, shuffled together. Sampling excludes every hash in
 * `seen` — judged units are never re-asked and never recycled. If either
 * unseen pool is smaller than perSide, no session is built; the caller
 * reports the shortfall instead.
 */
export function buildSession(
  real: string[],
  generated: string[],
  perSide: number,
  seen: ReadonlySet<string>,
): Session {
  const unseenReal = dedupeUnseen(real, seen);
  const unseenGen = dedupeUnseen(generated, seen);
  if (unseenReal.length < perSide || unseenGen.length < perSide) {
    return {
      ok: false,
      unseenReal: unseenReal.length,
      unseenGenerated: unseenGen.length,
      need: perSide,
    };
  }
  const items: Unit[] = [
    ...sample(unseenReal, perSide).map((text): Unit => {
      return { text, hash: unitHash(text), wasReal: true };
    }),
    ...sample(unseenGen, perSide).map((text): Unit => {
      return { text, hash: unitHash(text), wasReal: false };
    }),
  ];
  shuffle(items);
  return { ok: true, items };
}

/** Pool minus already-judged hashes, then minus internal duplicates. */
function dedupeUnseen(pool: string[], seen: ReadonlySet<string>): string[] {
  const out: string[] = [];
  const hashes = new Set<string>();
  for (const text of pool) {
    const h = unitHash(text);
    if (seen.has(h) || hashes.has(h)) continue;
    hashes.add(h);
    out.push(text);
  }
  return out;
}

// random.sample(population, k): k distinct elements in random order.
function sample<T>(population: T[], k: number): T[] {
  const pool = [...population];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = pool[i]!;
    pool[i] = pool[j]!;
    pool[j] = tmp;
  }
  return pool.slice(0, k);
}

function shuffle<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
}
