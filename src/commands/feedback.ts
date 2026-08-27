/**
 * The feedback store: `corpus/feedback.jsonl`, one append-only JSON-lines log
 * shared by every judge of the tool's output. `serve record_feedback` appends
 * good/fine/bad verdicts; the blind labeling loop appends `kind: "blind-arg"`
 * records. One module owns the file's location and write convention
 * (pyDumps with ensure_ascii=False) so the two record shapes can never drift
 * apart at the storage layer.
 */
import fs from "node:fs";
import path from "node:path";
import { corpusDir } from "../lib/paths.js";
import { pyDumps } from "./pyjson.js";

export function feedbackPath(): string {
  return path.join(corpusDir(), "feedback.jsonl");
}

// Python datetime.now().isoformat(timespec="seconds"): local time, no timezone.
export function isoSeconds(d: Date): string {
  const p = (x: number): string => String(x).padStart(2, "0");
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  );
}

/** Append one record to the store. The corpus dir is created on first write. */
export function appendFeedbackRecord(rec: object): void {
  fs.mkdirSync(corpusDir(), { recursive: true });
  fs.appendFileSync(
    feedbackPath(),
    pyDumps(rec, { ensureAscii: false }) + "\n",
  );
}

/**
 * Every `unit_hash` already in the store, across record kinds — the blind
 * loop's "never re-ask" key. Lines that are not valid JSON are skipped: an
 * append-only log must stay readable even if a past write was truncated.
 */
export function readUnitHashes(storePath = feedbackPath()): Set<string> {
  let raw: string;
  try {
    raw = fs.readFileSync(storePath, "utf8");
  } catch {
    return new Set(); // no store yet — nothing has been judged
  }
  const hashes = new Set<string>();
  for (const line of raw.split("\n")) {
    if (line.length === 0) continue;
    try {
      const o = JSON.parse(line) as { unit_hash?: unknown };
      if (typeof o.unit_hash === "string") hashes.add(o.unit_hash);
    } catch {
      // unreadable line — skip rather than refuse every future session
    }
  }
  return hashes;
}
