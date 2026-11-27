/**
 * Stage — rebuild a pre-agent-era reference corpus, with provenance.
 *
 * Profiles built from recent text learn the drafting agent's habits as the
 * author's: a large share of recent long-form prose arrives pre-drafted by an
 * LLM and is sent from the author's own accounts, and a voice learned from it
 * speaks in the agent's register, not the author's. The remedy is a reference
 * corpus drawn only from material dated before the agent era — writing that
 * cannot have been agent-drafted — with the exclusion applied AND recorded, so
 * anything built on it can state what it stands on.
 *
 * Sources (read from the corpus dir):
 * - email — every top-level `email-*.jsonl`, the mail ingest output. The
 *   ingest enforces authorship: only messages from the dominant From address
 *   of each mailbox survive, so "Sent" exports carrying whole threads do not
 *   leak other people's writing.
 * - chat — `teams-review/voice.jsonl` when present: the reviewed, owner-only
 *   chat set, which supersedes the raw `chat-teams.jsonl` (the same material,
 *   so reading both would count every message twice). Every other top-level
 *   `chat-*.jsonl` is read alongside it.
 * - essay — records the tag and salvage stages marked `editorial`, from
 *   `tagged.jsonl` / `salvaged.jsonl`.
 *
 * The exclusion rule, each part counted and written into the provenance:
 * 1. date cutoff — records from the cutoff year (2023) onward are the agent
 *    era and are excluded. The year matches the fingerprint stage's own
 *    `-pre2023` / `-recent` period split, so the two never disagree.
 * 2. undated — a record whose timestamp resolves to no year cannot prove its
 *    provenance, so it is excluded rather than trusted.
 * 3. ai-marker — a text carrying an em-dash is pasted or AI-influenced text
 *    riding in a human-authored file (the curate stage's marker). Curated
 *    sources should carry none; the rule is re-applied here because the
 *    reference corpus is the last line of defense before the fingerprints.
 * 4. duplicates — near-duplicate compositions (one letter sent five times, a
 *    draft quoted back) are reduced to the fullest copy by the shared dedupe
 *    pass, so no composition speaks louder than it was written.
 * 5. authorship — enforced upstream, asserted here: mail keeps only the
 *    dominant sender; the Teams voice set is owner-only, with third-party
 *    rows held back by its review pass.
 *
 * Non-English records are kept and language-tagged: per the engine's language
 * invariant they contribute rhythm and register signal only, never vocabulary.
 *
 * Writes `<corpus>/reference-pre-agent/`: one jsonl per register (created
 * even when empty, so a register's absence is visible as an empty file beside
 * the provenance that explains it), plus `provenance.json` and a human-
 * readable `PROVENANCE.md`. Stdout is aggregates only — counts and date
 * ranges, never record text.
 */
import fs from "node:fs";
import path from "node:path";
import { corpusDir } from "../lib/paths.js";
import { dropNearDuplicateLines } from "../lib/dedupe.js";
import { recordYear } from "./fingerprint.js";

/** The default first year of the agent era; the fingerprint stage splits here too. */
const DEFAULT_CUTOFF = 2023;
const OUT_DIR = "reference-pre-agent";

/** The date a timestamp was written on, as `YYYY-MM-DD`, or null. */
function recordDate(ts: unknown): string | null {
  const t = String(ts ?? "").trim();
  if (!t) return null;
  // Epoch seconds and milliseconds, as the chat sources write; ISO-8601 and
  // RFC-5322 dates both parse directly.
  if (/^\d{10}$/.test(t)) return isoDay(Number(t) * 1000);
  if (/^\d{13}$/.test(t)) return isoDay(Number(t));
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : isoDay(d.getTime());
}

function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

interface RegisterTally {
  records: number;
  words: number;
  langs: Map<string, number>;
  min: string | null;
  max: string | null;
}

/** Per-cause exclusion counters, as the provenance reports them. */
interface Excluded {
  dateCutoff: number;
  undated: number;
  malformed: number;
  aiMarker: number;
  duplicates: number;
  duplicateWords: number;
}

function emptyTally(): RegisterTally {
  return { records: 0, words: 0, langs: new Map(), min: null, max: null };
}

function emptyExcluded(): Excluded {
  return {
    dateCutoff: 0,
    undated: 0,
    malformed: 0,
    aiMarker: 0,
    duplicates: 0,
    duplicateWords: 0,
  };
}

function bump(m: Map<string, number>, k: string): void {
  m.set(k, (m.get(k) ?? 0) + 1);
}

/**
 * The candidate sources for one register, resolved against the corpus dir.
 *
 * Chat prefers the reviewed owner-only voice set: when it exists it
 * supersedes the raw teams output it was reviewed from, so both are never
 * read — that would count every message twice.
 */
export function sourcesFor(corpus: string): {
  email: string[];
  chat: string[];
  essay: string[];
} {
  const listing = fs.existsSync(corpus) ? fs.readdirSync(corpus) : [];
  const top = (prefix: string): string[] =>
    listing
      .filter((f) => f.startsWith(prefix) && f.endsWith(".jsonl"))
      .sort()
      .map((f) => path.join(corpus, f));

  const email = top("email-");
  const reviewed = path.join(corpus, "teams-review", "voice.jsonl");
  const chat = fs.existsSync(reviewed)
    ? [reviewed, ...top("chat-").filter((f) => !f.endsWith("chat-teams.jsonl"))]
    : top("chat-");
  const essay = ["tagged.jsonl", "salvaged.jsonl"]
    .map((f) => path.join(corpus, f))
    .filter((f) => fs.existsSync(f));
  return { email, chat, essay };
}

/**
 * One register's selection pass: keep the records that survive the exclusion
 * rule, written as the original jsonl lines, plus the tallies the provenance
 * reports. `filter` optionally narrows by record (the essay register reads
 * only the editorial-tagged rows of its sources).
 */
function selectRegister(
  files: string[],
  cutoff: number,
  filter: ((o: Record<string, unknown>) => boolean) | null,
): {
  lines: string[];
  tally: RegisterTally;
  excluded: Excluded;
  keptPerFile: Map<string, number>;
} {
  const lines: string[] = [];
  const tally = emptyTally();
  const excluded = emptyExcluded();
  const keptPerFile = new Map<string, number>();

  for (const f of files) {
    let raw: string;
    try {
      raw = fs.readFileSync(f, "utf8");
    } catch {
      continue;
    }
    const kept: string[] = [];
    for (const line of raw.split("\n")) {
      if (line.length === 0) continue;
      let o: Record<string, unknown>;
      try {
        o = JSON.parse(line) as Record<string, unknown>;
      } catch {
        excluded.malformed++;
        continue;
      }
      if (filter && !filter(o)) continue;
      const y = recordYear(String(o["ts"] ?? ""));
      if (y === null) {
        excluded.undated++;
        continue;
      }
      if (y >= cutoff) {
        excluded.dateCutoff++;
        continue;
      }
      if (String(o["text"] ?? "").includes("—")) {
        excluded.aiMarker++;
        continue;
      }
      kept.push(line);
    }
    const deduped = dropNearDuplicateLines(kept);
    excluded.duplicates += deduped.removed;
    excluded.duplicateWords += deduped.removedWords;
    keptPerFile.set(f, deduped.kept.length);
    lines.push(...deduped.kept);
  }

  for (const line of lines) {
    const o = JSON.parse(line) as Record<string, unknown>;
    tally.records++;
    tally.words += Number(o["words"] ?? 0);
    if (typeof o["lang"] === "string") bump(tally.langs, o["lang"]);
    const d = recordDate(o["ts"]);
    if (d && (tally.min === null || d < tally.min)) tally.min = d;
    if (d && (tally.max === null || d > tally.max)) tally.max = d;
  }
  return { lines, tally, excluded, keptPerFile };
}

/**
 * One register's provenance block, shared by both manifest shapes. Source
 * paths are relative to the corpus dir, so the manifest says `chat-teams.jsonl`
 * or `teams-review/voice.jsonl`, never an absolute machine path.
 */
function provenanceFor(
  corpus: string,
  name: string,
  files: string[],
  r: ReturnType<typeof selectRegister>,
): Record<string, unknown> {
  const langs: Record<string, number> = {};
  for (const [k, v] of [...r.tally.langs.entries()].sort()) langs[k] = v;
  const sources = files.map((f) => ({
    file: path.relative(corpus, f),
    kept: r.keptPerFile.get(f) ?? 0,
  }));
  return {
    register: name,
    sources,
    kept: r.tally.records,
    words: r.tally.words,
    dateRange: { min: r.tally.min, max: r.tally.max },
    langs,
    excluded: r.excluded,
  };
}

/**
 * Stage entry point. `--year YYYY` overrides the agent-era cutoff; corpus
 * paths come from the environment (see paths.ts).
 */
export function runReference(argv: string[]): number {
  let cutoff = DEFAULT_CUTOFF;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--year") {
      const v = Number(argv[i + 1]);
      if (!Number.isInteger(v) || v < 1970) {
        process.stderr.write("--year wants a four-digit year\n");
        return 2;
      }
      cutoff = v;
      i++;
    }
  }

  const corpus = corpusDir();
  if (!fs.existsSync(corpus)) {
    process.stderr.write("no corpus dir — nothing to rebuild from\n");
    return 1;
  }

  const out = path.join(corpus, OUT_DIR);
  fs.mkdirSync(out, { recursive: true });

  const { email, chat, essay } = sourcesFor(corpus);
  const editorial = (o: Record<string, unknown>): boolean =>
    o["register"] === "editorial";

  const registers = [
    { name: "email", files: email, filter: null },
    { name: "chat", files: chat, filter: null },
    { name: "essay", files: essay, filter: editorial },
  ];

  const manifest: Record<string, unknown>[] = [];
  for (const reg of registers) {
    const r = selectRegister(reg.files, cutoff, reg.filter);
    fs.writeFileSync(
      path.join(out, `${reg.name}.jsonl`),
      r.lines.map((l) => l + "\n").join(""),
    );
    manifest.push(provenanceFor(corpus, reg.name, reg.files, r));
    const range =
      r.tally.min && r.tally.max ? `${r.tally.min}..${r.tally.max}` : "none";
    const note =
      r.tally.records === 0
        ? " — no pre-agent-era material in this corpus; the file is created empty"
        : "";
    process.stdout.write(
      `reference/${reg.name}: kept ${r.tally.records} records, ${r.tally.words} words, dates ${range}${note}\n`,
    );
    process.stdout.write(
      `  excluded: date-cutoff ${r.excluded.dateCutoff}, undated ${r.excluded.undated}, malformed ${r.excluded.malformed}, ai-marker ${r.excluded.aiMarker}, duplicates ${r.excluded.duplicates} (${r.excluded.duplicateWords} words)\n`,
    );
  }

  const prov = {
    generated: new Date().toISOString(),
    cutoff,
    cutoffRationale:
      "records from this year onward are the agent era; the year matches the fingerprint stage's -pre2023/-recent split",
    exclusionRule: [
      "date-cutoff: records dated in the agent era or later are excluded",
      "undated: records whose timestamp resolves to no year are excluded — provenance needs a date",
      "malformed: lines that do not parse are excluded",
      "ai-marker: any text carrying an em-dash is excluded (pasted or AI-influenced text)",
      "duplicates: near-duplicate compositions are reduced to the fullest copy",
      "authorship: enforced upstream — mail keeps only the dominant sender; chat comes from the reviewed owner-only set",
    ],
    languageRule:
      "non-English records are kept and language-tagged; they contribute rhythm and register signal only, never vocabulary",
    registers: manifest,
  };
  fs.writeFileSync(
    path.join(out, "provenance.json"),
    JSON.stringify(prov, null, 1) + "\n",
  );
  fs.writeFileSync(path.join(out, "PROVENANCE.md"), provenanceMarkdown(prov));

  process.stdout.write(`wrote ${out}\n`);
  return 0;
}

/** The same manifest, human-readable. Aggregates only, by contract. */
function provenanceMarkdown(prov: Record<string, unknown>): string {
  const out: string[] = [
    "# Reference corpus — pre-agent era (local-only)",
    "",
    `Generated ${prov["generated"]}. Cutoff: records before ${prov["cutoff"]} (the agent era; matches the fingerprint stage's period split).`,
    "",
    "## Exclusion rule",
    "",
  ];
  for (const rule of prov["exclusionRule"] as string[]) out.push(`- ${rule}`);
  out.push("", `Language: ${prov["languageRule"]}`, "", "## Registers", "");
  for (const reg of prov["registers"] as Record<string, unknown>[]) {
    const range = reg["dateRange"] as {
      min: string | null;
      max: string | null;
    };
    const excluded = reg["excluded"] as Excluded;
    const langs = Object.entries(reg["langs"] as Record<string, number>)
      .map(([k, v]) => `${k}: ${v}`)
      .join(", ");
    const sources = (reg["sources"] as Array<{ file: string; kept: number }>)
      .map((s) => `${s.file} (${s.kept})`)
      .join(", ");
    out.push(
      `### ${reg["register"]} — kept ${reg["kept"]} records, ${reg["words"]} words`,
    );
    out.push(
      `- dates: ${range.min ?? "none"} .. ${range.max ?? "none"}`,
      `- languages: ${langs || "none"}`,
      `- sources (kept per file): ${sources || "none"}`,
      `- excluded: date-cutoff ${excluded.dateCutoff}, undated ${excluded.undated}, malformed ${excluded.malformed}, ai-marker ${excluded.aiMarker}, duplicates ${excluded.duplicates} (${excluded.duplicateWords} words)`,
      "",
    );
  }
  return out.join("\n") + "\n";
}
