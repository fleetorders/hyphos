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
 *   chat set. The raw `chat-teams.jsonl` it was reviewed from is NEVER a
 *   source, reviewed set or not: unreviewed, it carries other participants'
 *   writing, and the provenance would still claim an owner-only set. Every
 *   other top-level `chat-*.jsonl` is read alongside the reviewed set.
 * - essay — records the tag and salvage stages marked `editorial`, from
 *   `tagged.jsonl` / `salvaged.jsonl`.
 *
 * The exclusion rule, each part counted and written into the provenance:
 * 1. date cutoff — records whose calendar day falls in the cutoff year (2023)
 *    or later are the agent era and are excluded. The day is the UTC day the
 *    provenance's date range reports, so one interpretation of the timestamp
 *    feeds both the cutoff and the range: a record can never pass the cutoff
 *    and then show up in its own provenance as agent-era.
 * 2. undated — a record whose timestamp resolves to no calendar day cannot
 *    prove its provenance, so it is excluded rather than trusted.
 * 3. ai-marker — a text carrying an em-dash is pasted or AI-influenced text
 *    riding in a human-authored file (the curate stage's marker). Curated
 *    sources should carry none; the rule is re-applied here because the
 *    reference corpus is the last line of defense before the fingerprints.
 * 4. duplicates — near-duplicate compositions (one letter sent five times, a
 *    draft quoted back, the same letter filed in two exports) are reduced to
 *    the fullest copy by the shared dedupe pass, which runs over the whole
 *    register rather than one file at a time, so a copy filed twice in
 *    different exports speaks once too.
 * 5. authorship — enforced upstream, asserted here: mail keeps only the
 *    dominant sender; the Teams voice set is owner-only, with third-party
 *    rows held back by its review pass.
 *
 * Non-English records are kept and language-tagged: per the engine's language
 * invariant they contribute rhythm and register signal only, never vocabulary.
 * A record arriving without a `lang` tag is tagged here before it is written,
 * so nothing leaves the stage without the tag downstream consumers need to
 * keep it out of vocabulary work.
 *
 * Writes `<corpus>/reference-pre-agent/`: `email-reference.jsonl` and
 * `chat-reference.jsonl` (the `email-` / `chat-` prefixes the fingerprint
 * stage reads, so pointing `HYPHOS_CORPUS` at this directory makes
 * `fingerprint` profile the reference corpus directly) and `tagged.jsonl`
 * (the essay register, under the register-row name `fingerprint` reads);
 * one file per register is created even when empty, so a register's absence
 * is visible as an empty file beside the provenance that explains it, plus
 * `provenance.json` and a human-readable `PROVENANCE.md`. Everything is
 * staged in a sibling directory and swapped in only after every register has
 * succeeded, so a failed rebuild never leaves register files and provenance
 * describing different runs; the directory and files are owner-only (0700 /
 * 0600), because they carry the user's private writing. Stdout is aggregates
 * only — counts and date ranges, never record text.
 */
import fs from "node:fs";
import path from "node:path";
import { corpusDir } from "../lib/paths.js";
import { dropNearDuplicates } from "../lib/dedupe.js";
import { detectLang } from "../lib/lang.js";

/** The default first year of the agent era; the fingerprint stage splits here too. */
const DEFAULT_CUTOFF = 2023;
const OUT_DIR = "reference-pre-agent";
/** Siblings used to stage a rebuild and to hold the previous build during the swap. */
const STAGING_DIR = `${OUT_DIR}.staging`;
const PREVIOUS_DIR = `${OUT_DIR}.prev`;
/** The output file for each register, named for what the fingerprint stage reads. */
const OUT_FILES: Record<string, string> = {
  email: "email-reference.jsonl",
  chat: "chat-reference.jsonl",
  essay: "tagged.jsonl",
};

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

/** One surviving candidate row, carrying the file it came from for the provenance. */
interface Item {
  file: string;
  line: string;
  text: string;
  words: number;
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
 * Chat prefers the reviewed owner-only voice set, and the raw teams output it
 * was reviewed from is never read: with the review absent it would pour
 * unreviewed, other-participant writing into a corpus whose provenance
 * claims an owner-only chat set, and with the review present it would count
 * every message twice.
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
    : top("chat-").filter((f) => !f.endsWith("chat-teams.jsonl"));
  const essay = ["tagged.jsonl", "salvaged.jsonl"]
    .map((f) => path.join(corpus, f))
    .filter((f) => fs.existsSync(f));
  return { email, chat, essay };
}

/**
 * One register's selection pass: keep the records that survive the exclusion
 * rule, written as jsonl lines, plus the tallies the provenance reports.
 * `filter` optionally narrows by record (the essay register reads only the
 * editorial-tagged rows of its sources).
 *
 * The pass is pure — it writes nothing — so a failure anywhere in it (a
 * source that cannot be read, a row that cannot be parsed) aborts the whole
 * rebuild before any output file is touched. Dedupe runs once over the whole
 * register, not per file, so the same composition filed in two exports counts
 * once. Throws on a source that cannot be read, naming the file.
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
  const items: Item[] = [];
  const excluded = emptyExcluded();

  for (const f of files) {
    let raw: string;
    try {
      raw = fs.readFileSync(f, "utf8");
    } catch (e) {
      throw new Error(
        `cannot read source ${f} (${e instanceof Error ? e.message : String(e)})`,
      );
    }
    for (const line of raw.split("\n")) {
      if (line.length === 0) continue;
      let o: Record<string, unknown> | null = null;
      try {
        const parsed: unknown = JSON.parse(line);
        if (
          parsed !== null &&
          typeof parsed === "object" &&
          !Array.isArray(parsed)
        ) {
          o = parsed as Record<string, unknown>;
        }
      } catch {
        // counted below
      }
      if (o === null) {
        excluded.malformed++;
        continue;
      }
      if (filter && !filter(o)) continue;
      const d = recordDate(o["ts"]);
      const y = d === null ? null : Number(d.slice(0, 4));
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
      const text = String(o["text"] ?? "");
      // Nothing leaves the stage without the tag that keeps non-English
      // writing out of vocabulary work downstream.
      if (typeof o["lang"] !== "string") {
        o["lang"] = detectLang(text);
        items.push({
          file: f,
          line: JSON.stringify(o),
          text,
          words: Number(o["words"] ?? 0),
        });
      } else {
        items.push({
          file: f,
          line,
          text,
          words: Number(o["words"] ?? 0),
        });
      }
    }
  }

  const deduped = dropNearDuplicates(
    items,
    (it) => it.text,
    (it) => it.words,
  );
  excluded.duplicates += deduped.removed;
  excluded.duplicateWords += deduped.removedWords;

  const lines: string[] = [];
  const keptPerFile = new Map<string, number>();
  for (const it of deduped.kept) {
    lines.push(it.line);
    keptPerFile.set(it.file, (keptPerFile.get(it.file) ?? 0) + 1);
  }

  const tally = emptyTally();
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

/** Write a file owner-only, tightening the mode of a file that already exists. */
function writePrivate(file: string, data: string): void {
  fs.writeFileSync(file, data, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

const USAGE = [
  "usage: hyphos reference [--year YYYY]",
  "",
  "Rebuild the pre-agent-era reference corpus from the corpus dir, with",
  "provenance. Records dated in the agent era (the cutoff year, 2023 by",
  "default) or later, undated records, AI-marked texts and duplicate",
  "compositions are excluded; every exclusion is counted in the provenance.",
  "",
  "  --year YYYY   first year of the agent era (default 2023)",
  "  --help        print this help",
  "",
  "The corpus dir comes from the environment (HYPHOS_CORPUS, else the",
  "package's corpus/). Output lands in <corpus>/reference-pre-agent/,",
  "owner-only, in the file names the fingerprint stage reads — point",
  "HYPHOS_CORPUS at that directory to profile the reference corpus.",
];

/**
 * Stage entry point. `--year YYYY` (or `--year=YYYY`) overrides the agent-era
 * cutoff; corpus paths come from the environment (see paths.ts). Any other
 * argument is refused rather than silently ignored — a stage that rebuilds a
 * corpus must not run on a misunderstood command line.
 */
export function runReference(argv: string[]): number {
  let cutoff = DEFAULT_CUTOFF;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--help" || a === "-h") {
      for (const l of USAGE) process.stdout.write(l + "\n");
      return 0;
    }
    if (a === "--year" || a.startsWith("--year=")) {
      const v = a === "--year" ? argv[++i] : a.slice("--year=".length);
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1000 || n > 9999) {
        process.stderr.write(`--year wants a four-digit year, not '${v}'\n`);
        return 2;
      }
      cutoff = n;
      continue;
    }
    process.stderr.write(`unrecognized argument '${a}' — see --help\n`);
    return 2;
  }

  const corpus = corpusDir();
  if (!fs.existsSync(corpus)) {
    process.stderr.write("no corpus dir — nothing to rebuild from\n");
    return 1;
  }

  const { email, chat, essay } = sourcesFor(corpus);
  if (
    !fs.existsSync(path.join(corpus, "teams-review", "voice.jsonl")) &&
    fs.existsSync(path.join(corpus, "chat-teams.jsonl"))
  ) {
    process.stdout.write(
      "chat: skipped chat-teams.jsonl — no reviewed owner-only set " +
        "(teams-review/voice.jsonl); the raw export is never a reference source\n",
    );
  }
  const editorial = (o: Record<string, unknown>): boolean =>
    o["register"] === "editorial";

  const registers = [
    { name: "email", files: email, filter: null },
    { name: "chat", files: chat, filter: null },
    { name: "essay", files: essay, filter: editorial },
  ];

  // Select every register before touching any output: the pass is pure, so a
  // failure here leaves the previous build exactly as it was.
  const built: {
    name: string;
    files: string[];
    r: ReturnType<typeof selectRegister>;
  }[] = [];
  try {
    for (const reg of registers) {
      built.push({ ...reg, r: selectRegister(reg.files, cutoff, reg.filter) });
    }
  } catch (e) {
    process.stderr.write(
      `reference: rebuild aborted — nothing written; the previous build (if any) is untouched — ` +
        `${e instanceof Error ? e.message : String(e)}\n`,
    );
    return 1;
  }

  for (const b of built) {
    const range =
      b.r.tally.min && b.r.tally.max
        ? `${b.r.tally.min}..${b.r.tally.max}`
        : "none";
    const note =
      b.r.tally.records === 0
        ? " — no pre-agent-era material in this corpus; the file is created empty"
        : "";
    process.stdout.write(
      `reference/${b.name}: kept ${b.r.tally.records} records, ${b.r.tally.words} words, dates ${range}${note}\n`,
    );
    process.stdout.write(
      `  excluded: date-cutoff ${b.r.excluded.dateCutoff}, undated ${b.r.excluded.undated}, malformed ${b.r.excluded.malformed}, ai-marker ${b.r.excluded.aiMarker}, duplicates ${b.r.excluded.duplicates} (${b.r.excluded.duplicateWords} words)\n`,
    );
  }

  const manifest = built.map((b) =>
    provenanceFor(corpus, b.name, b.files, b.r),
  );
  const prov = {
    generated: new Date().toISOString(),
    cutoff,
    cutoffRationale:
      "records dated in the agent era or later are excluded; the year is read from the UTC calendar day the date range reports, so the cutoff and the reported range interpret every timestamp the same way (the default year matches the fingerprint stage's -pre2023/-recent split)",
    exclusionRule: [
      "date-cutoff: records dated in the agent era or later are excluded (the year of the UTC day this provenance's date range reports)",
      "undated: records whose timestamp resolves to no calendar day are excluded — provenance needs a date",
      "malformed: lines that do not parse as a JSON object are excluded",
      "ai-marker: any text carrying an em-dash is excluded (pasted or AI-influenced text)",
      "duplicates: near-duplicate compositions are reduced to the fullest copy, across files",
      "authorship: enforced upstream — mail keeps only the dominant sender; chat comes from the reviewed owner-only set, and the raw teams export is never a source",
    ],
    languageRule:
      "non-English records are kept and language-tagged (tagged here when a source carried no tag); they contribute rhythm and register signal only, never vocabulary",
    registers: manifest,
  };

  // Stage everything in a sibling directory, then swap it in whole: a crash
  // between registers can never leave register files and provenance
  // describing different runs. The previous build survives the swap as .prev
  // until the new one is in place.
  const out = path.join(corpus, OUT_DIR);
  const staging = path.join(corpus, STAGING_DIR);
  const previous = path.join(corpus, PREVIOUS_DIR);
  fs.rmSync(staging, { recursive: true, force: true });
  fs.rmSync(previous, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true, mode: 0o700 });
  fs.chmodSync(staging, 0o700);
  for (const b of built) {
    writePrivate(
      path.join(staging, OUT_FILES[b.name]!),
      b.r.lines.map((l) => l + "\n").join(""),
    );
  }
  writePrivate(
    path.join(staging, "provenance.json"),
    JSON.stringify(prov, null, 1) + "\n",
  );
  writePrivate(path.join(staging, "PROVENANCE.md"), provenanceMarkdown(prov));

  if (fs.existsSync(out)) fs.renameSync(out, previous);
  fs.renameSync(staging, out);
  fs.rmSync(previous, { recursive: true, force: true });

  process.stdout.write(`wrote ${out}\n`);
  return 0;
}

/** The same manifest, human-readable. Aggregates only, by contract. */
function provenanceMarkdown(prov: Record<string, unknown>): string {
  const out: string[] = [
    "# Reference corpus — pre-agent era (local-only)",
    "",
    `Generated ${prov["generated"]}. Cutoff: records before ${prov["cutoff"]} (the agent era; the year is read from the UTC day the date range reports).`,
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
