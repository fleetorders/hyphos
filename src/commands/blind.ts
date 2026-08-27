/**
 * Blind self-test at the argument level: shuffle whole replies (or
 * paragraphs) from the real corpus with generated ones, ask which are the
 * author's, then capture WHY — fixed reason codes plus an optional one-line
 * note. 50% discrimination means the rewrite is indistinguishable from the
 * author; 100% means it never fools them; the reason codes on the misjudged
 * items are the labeled data the structural metric layer needs.
 *
 * Sessions never re-ask: every judged unit is keyed by `sha256` of its
 * normalized text and excluded from all future sampling, and each judgment
 * is appended to the store immediately, so an interrupted session still
 * banks its labels. Stdout stays aggregates-only (repo invariant): item
 * text is shown during interaction, the closing report is counts.
 *
 * This is interactive (reads stdin) and uses random sampling (JavaScript's
 * PRNG, seeded from the OS), so runs are non-deterministic.
 */
import fs from "node:fs";
import path from "node:path";
import * as readline from "node:readline/promises";
import { pyRound } from "../lib/num.js";
import { whitespaceSplit } from "../lib/text.js";
import { corpusDir } from "../lib/paths.js";
import {
  REASON_CODES,
  buildSession,
  makeBlindArgRecord,
  parseReasons,
} from "./blind-arg.js";
import {
  appendFeedbackRecord,
  feedbackPath,
  isoSeconds,
  readUnitHashes,
} from "./feedback.js";

export type BlindUnit = "reply" | "paragraph";

// The dry-run comparison band (docs/research/argument-shape.md): 25–180
// words per item on both sides, so real and generated units are comparable.
const MIN_WORDS = 25;
const MAX_WORDS = 180;

// The ten-minute budget: ~40 s per item → 12 items (6 real + 6 generated).
const PER_SIDE = 6;

function inBand(text: string): boolean {
  const words = whitespaceSplit(text).length;
  return words >= MIN_WORDS && words <= MAX_WORDS;
}

/** Real-corpus candidates for the register, as whole replies or paragraphs. */
function realCandidates(register: string, unit: BlindUnit): string[] {
  const tagged = path.join(corpusDir(), "tagged.jsonl");
  const out: string[] = [];
  for (const line of fs.readFileSync(tagged, "utf8").split("\n")) {
    if (line.length === 0) continue;
    const o = JSON.parse(line) as {
      register: string;
      words: number;
      text: string;
    };
    if (o.register !== register) continue;
    if (unit === "reply") {
      if (o.words >= MIN_WORDS && o.words <= MAX_WORDS) out.push(o.text);
    } else {
      for (const p of o.text.split(/\n\s*\n/).map((s) => s.trim())) {
        if (inBand(p)) out.push(p);
      }
    }
  }
  return out;
}

/** Generated candidates: the file's blank-line-separated blocks, same band. */
function generatedCandidates(generatedFile: string): string[] {
  return fs
    .readFileSync(generatedFile, "utf8")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(inBand);
}

/** Run the interactive labeling loop. Returns an exit code. */
export async function blind(
  register: string,
  generatedFile: string,
  unit: BlindUnit,
): Promise<number> {
  const real = realCandidates(register, unit);
  const gen = generatedCandidates(generatedFile);
  const seen = readUnitHashes(feedbackPath());
  const session = buildSession(real, gen, PER_SIDE, seen);
  if (!session.ok) {
    process.stdout.write(
      `unseen pool too small: real ${session.unseenReal}, generated ` +
        `${session.unseenGenerated} — a session needs ${session.need} of ` +
        `each; stopping rather than recycling judged units\n`,
    );
    return 1;
  }

  // One interface, one 'line' handler feeding a queue. rl.question() cannot
  // replace this: readline drops 'line' events that arrive while no question
  // is pending, so piped or pasted-ahead input deadlocks the loop after the
  // first answer. ask() resolves null once stdin ends (graceful early exit —
  // judgments already banked stay banked).
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const queued: string[] = [];
  const waiters: ((line: string | null) => void)[] = [];
  let ended = false;
  rl.on("line", (l: string) => {
    const w = waiters.shift();
    if (w) w(l);
    else queued.push(l);
  });
  rl.on("close", () => {
    ended = true;
    for (const w of waiters.splice(0)) w(null);
  });
  async function ask(prompt: string): Promise<string | null> {
    if (queued.length > 0) return queued.shift() ?? null;
    if (ended) return null;
    process.stdout.write(prompt);
    return new Promise((resolve) => waiters.push(resolve));
  }

  const n = session.items.length;
  process.stdout.write(
    `${n} ${unit}s (${PER_SIDE} real, ${PER_SIDE} generated). ` +
      `Answer y if YOU wrote it, n if not.\n` +
      `codes: ${REASON_CODES.join(", ")}\n\n`,
  );
  let correct = 0;
  let judged = 0;
  const reasonCounts = new Map<string, number>();
  let i = 0;
  for (const item of session.items) {
    i++;
    process.stdout.write(`--- ${i}/${n} ---\n${item.text}\n\n`);

    let mine: boolean | undefined;
    while (mine === undefined) {
      const ans = await ask("yours? [y/n] ");
      if (ans === null) break; // stdin ended — bank nothing for this item
      const a = ans.trim().toLowerCase();
      if (a === "y") mine = true;
      else if (a === "n") mine = false;
    }
    if (mine === undefined) break;

    let reasons: string[] = [];
    let eof = false;
    for (;;) {
      const raw = await ask("reasons (comma-separated, empty ok): ");
      if (raw === null) {
        eof = true;
        break;
      }
      const parsed = parseReasons(raw);
      if (parsed.ok) {
        reasons = parsed.codes;
        break;
      }
      process.stdout.write(
        `unknown code(s): ${parsed.unknown.join(", ")} — ` +
          `valid: ${REASON_CODES.join(", ")}\n`,
      );
    }
    const noteRaw = eof ? "" : await ask("note (one line, enter to skip): ");
    const note = noteRaw === null ? "" : noteRaw.trim();

    appendFeedbackRecord(
      makeBlindArgRecord({
        ts: isoSeconds(new Date()),
        register,
        unitHash: item.hash,
        verdict: mine ? "mine" : "not-mine",
        wasReal: item.wasReal,
        reasons,
        note,
      }),
    );
    judged++;
    if (mine === item.wasReal) correct++;
    for (const code of reasons) {
      reasonCounts.set(code, (reasonCounts.get(code) ?? 0) + 1);
    }
    if (eof || noteRaw === null) break;
  }
  rl.close();

  if (judged === 0) {
    process.stdout.write(
      "session ended before the first judgment — nothing recorded\n",
    );
    return 1;
  }
  const rate = correct / judged;
  const pct = `${pyRound(rate * 100, 0)}%`;
  process.stdout.write(`\ndiscrimination: ${correct}/${judged} = ${pct}\n`);
  const histogram = [...reasonCounts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([code, count]) => `${code} ${count}`)
    .join(", ");
  process.stdout.write(`reasons: ${histogram || "(none)"}\n`);
  process.stdout.write(
    "50% = the rewrite is indistinguishable from you; 100% = it fools you never.\n",
  );
  return 0;
}

/** `blind` subcommand entry. */
export async function runBlind(opts: {
  register: string;
  generated: string;
  unit: string;
}): Promise<number> {
  const unit = opts.unit === "paragraph" ? "paragraph" : "reply";
  return blind(opts.register, opts.generated, unit);
}
