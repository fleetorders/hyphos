import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runReference } from "../src/stages/reference.js";
import { runFingerprint } from "../src/stages/fingerprint.js";

/**
 * The reference corpus is the voice's last line of defense against learning
 * from the drafting agent's own output: everything dated in the agent era,
 * everything undated, every AI-marked text and every duplicate must be out,
 * and the provenance must say so. These cases pin each exclusion, the
 * register split, the reviewed-chat supersedence, and the guarantees around
 * the rebuild itself: recognized arguments only, a failed rebuild that
 * leaves the previous build alone, owner-only output permissions, and output
 * names the fingerprint stage can read directly.
 */

/** A minimal corpus record, as the ingest stages write them. */
function rec(fields: Record<string, unknown>): string {
  return JSON.stringify({
    ts: null,
    source: "test",
    lang: "en",
    words: 3,
    text: "some words here",
    ...fields,
  });
}

function writeJsonl(dir: string, name: string, records: string[]): void {
  fs.writeFileSync(path.join(dir, name), records.map((r) => r + "\n").join(""));
}

function run(dir: string, argv: string[] = []): number {
  process.env.HYPHOS_CORPUS = dir;
  return runReference(argv);
}

function outDir(dir: string): string {
  return path.join(dir, "reference-pre-agent");
}

/** The output file each register lands in, named for fingerprint to read. */
const OUT = {
  email: "email-reference.jsonl",
  chat: "chat-reference.jsonl",
  essay: "tagged.jsonl",
} as const;

function readLines(dir: string, name: string): Record<string, unknown>[] {
  const f = path.join(outDir(dir), name);
  if (!fs.existsSync(f)) return [];
  return fs
    .readFileSync(f, "utf8")
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l));
}

function provenance(dir: string): Record<string, any> {
  return JSON.parse(
    fs.readFileSync(path.join(outDir(dir), "provenance.json"), "utf8"),
  );
}

/** Run the stage with stderr captured, so refusal messages can be asserted. */
function runCapturing(
  dir: string,
  argv: string[] = [],
): { code: number; stderr: string } {
  process.env.HYPHOS_CORPUS = dir;
  const errs: string[] = [];
  const orig = process.stderr.write.bind(process.stderr);
  (process.stderr as { write: unknown }).write = (s: unknown) => {
    errs.push(String(s));
    return true;
  };
  try {
    return { code: runReference(argv), stderr: errs.join("") };
  } finally {
    (process.stderr as { write: unknown }).write = orig;
  }
}

describe("the reference corpus rebuild", () => {
  it("keeps only records dated before the agent era, in every timestamp shape", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hyphos-reference-"));
    writeJsonl(dir, "email-sent.jsonl", [
      rec({ ts: "Fri, 01 Nov 2019 09:41:11 +0100", text: "mail kept" }), // RFC-5322
      rec({ ts: "Thu, 12 Jan 2023 09:00:00 +0000", text: "mail cut" }), // cutoff year
      rec({ ts: "2022-12-31T23:00:00.000Z", text: "iso kept" }), // ISO-8601
    ]);
    writeJsonl(dir, "chat-archived.jsonl", [
      rec({ ts: 1612541653050, text: "chat kept" }), // epoch ms, 2021
      rec({ ts: 1749263524733, text: "chat cut" }), // epoch ms, 2025
    ]);
    expect(run(dir)).toBe(0);

    const email = readLines(dir, OUT.email);
    const chat = readLines(dir, OUT.chat);
    expect(email.map((o) => o.text)).toEqual(["mail kept", "iso kept"]);
    expect(chat.map((o) => o.text)).toEqual(["chat kept"]);
  });

  it("applies the cutoff on the same UTC day the date range reports", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hyphos-reference-"));
    writeJsonl(dir, "email-sent.jsonl", [
      // Written Dec 31 2022 at 23:30 -0500 — UTC Jan 1 2023. The cutoff reads
      // the UTC day, so it is agent era, and can never show up in the range.
      rec({ ts: "2022-12-31T23:30:00-0500", text: "boundary cut" }),
      rec({ ts: "2021-06-01T00:30:00+0500", text: "boundary kept" }),
      // An impossible date resolves to no calendar day: undated, not trusted.
      rec({ ts: "2022-99-99", text: "impossible date" }),
    ]);
    expect(run(dir)).toBe(0);
    expect(readLines(dir, OUT.email).map((o) => o.text)).toEqual([
      "boundary kept",
    ]);
    const prov = provenance(dir);
    expect(prov.registers[0].excluded.dateCutoff).toBe(1);
    expect(prov.registers[0].excluded.undated).toBe(1);
    expect(prov.registers[0].dateRange).toEqual({
      min: "2021-05-31",
      max: "2021-05-31",
    });
  });

  it("excludes undated and unresolvable records rather than trusting them", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hyphos-reference-"));
    writeJsonl(dir, "email-sent.jsonl", [
      rec({ ts: "Fri, 01 Nov 2019 09:41:11 +0100", text: "dated" }),
      rec({ ts: null, text: "no timestamp" }),
      rec({ ts: "last tuesday", text: "unresolvable" }),
    ]);
    expect(run(dir)).toBe(0);
    const email = readLines(dir, OUT.email);
    expect(email.map((o) => o.text)).toEqual(["dated"]);
    expect(provenance(dir).registers[0].excluded.undated).toBe(2);
  });

  it("counts a non-object JSON row as malformed instead of crashing on it", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hyphos-reference-"));
    fs.writeFileSync(
      path.join(dir, "email-sent.jsonl"),
      rec({ ts: "2019-01-01", text: "good row" }) + "\nnull\n",
    );
    expect(run(dir)).toBe(0);
    expect(readLines(dir, OUT.email).map((o) => o.text)).toEqual(["good row"]);
    expect(provenance(dir).registers[0].excluded.malformed).toBe(1);
  });

  it("excludes an em-dash text as AI-influenced, per the curate marker", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hyphos-reference-"));
    writeJsonl(dir, "email-sent.jsonl", [
      rec({ ts: "2021-03-01", text: "clean text" }),
      rec({ ts: "2021-03-02", text: "marked text — with a dash" }),
    ]);
    expect(run(dir)).toBe(0);
    expect(readLines(dir, OUT.email).map((o) => o.text)).toEqual([
      "clean text",
    ]);
    expect(provenance(dir).registers[0].excluded.aiMarker).toBe(1);
  });

  it("reduces near-duplicate compositions to the fullest copy", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hyphos-reference-"));
    const body =
      "the same composition sent twice should speak once in the reference corpus and not once per copy";
    writeJsonl(dir, "email-sent.jsonl", [
      rec({ ts: "2021-03-01", text: body, words: 30 }),
      rec({
        ts: "2021-03-02",
        text: body + " with a short tail added",
        words: 35,
      }),
    ]);
    expect(run(dir)).toBe(0);
    const email = readLines(dir, OUT.email);
    expect(email).toHaveLength(1);
    expect(email[0]!.words).toBe(35);
    expect(provenance(dir).registers[0].excluded.duplicates).toBe(1);
  });

  it("reduces the same composition filed in two exports to one copy", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hyphos-reference-"));
    const body =
      "one letter archived in two mailboxes must still speak once, whatever export each copy arrived in";
    writeJsonl(dir, "email-first.jsonl", [
      rec({ ts: "2021-03-01", text: body, words: 31 }),
    ]);
    writeJsonl(dir, "email-second.jsonl", [
      rec({ ts: "2021-04-01", text: body + " and a closing line", words: 36 }),
    ]);
    expect(run(dir)).toBe(0);
    const email = readLines(dir, OUT.email);
    expect(email).toHaveLength(1);
    expect(email[0]!.words).toBe(36);
    const prov = provenance(dir);
    expect(prov.registers[0].excluded.duplicates).toBe(1);
    const kept = prov.registers[0].sources.map(
      (s: { file: string; kept: number }) => `${s.file}:${s.kept}`,
    );
    expect(kept).toEqual(["email-first.jsonl:0", "email-second.jsonl:1"]);
  });

  it("reduces duplicate Greek compositions too, not only Latin", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hyphos-reference-"));
    const greek =
      "πρέπει να δούμε το θέμα ξανά και να αποφασίσουμε τι θα κάνουμε με το " +
      "σχέδιο που συζητήσαμε χθες το βράδυ για την επόμενη χρονιά ώστε να " +
      "είμαστε έτοιμοι";
    writeJsonl(dir, "chat-archived.jsonl", [
      rec({ ts: "2019-01-01", lang: "el", text: greek, words: 28 }),
      rec({ ts: "2019-01-02", lang: "el", text: greek, words: 28 }),
    ]);
    expect(run(dir)).toBe(0);
    expect(readLines(dir, OUT.chat)).toHaveLength(1);
    expect(provenance(dir).registers[1].excluded.duplicates).toBe(1);
  });

  it("reads the essay register from editorial-tagged rows only", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hyphos-reference-"));
    writeJsonl(dir, "tagged.jsonl", [
      rec({ ts: "2021-06-01", register: "editorial", text: "old essay" }),
      rec({ ts: "2026-06-01", register: "editorial", text: "new essay" }),
      rec({ ts: "2021-06-02", register: "technical-instruction" }),
    ]);
    writeJsonl(dir, "salvaged.jsonl", [
      rec({ ts: "2022-09-09", register: "editorial", text: "salvaged essay" }),
    ]);
    expect(run(dir)).toBe(0);
    const essay = readLines(dir, OUT.essay);
    expect(essay.map((o) => o.text)).toEqual(["old essay", "salvaged essay"]);
    const prov = provenance(dir);
    const essayReg = prov.registers[2];
    expect(essayReg.kept).toBe(2);
    expect(essayReg.dateRange).toEqual({
      min: "2021-06-01",
      max: "2022-09-09",
    });
    expect(essayReg.excluded.dateCutoff).toBe(1);
  });

  it("tags a kept record that arrived without a language tag", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hyphos-reference-"));
    const greek =
      "πρέπει να δούμε το θέμα ξανά και να αποφασίσουμε τι θα κάνουμε με το " +
      "σχέδιο που συζητήσαμε χθες το βράδυ για την επόμενη χρονιά ώστε να " +
      "είμαστε έτοιμοι";
    writeJsonl(dir, "tagged.jsonl", [
      JSON.stringify({
        ts: "2019-01-01",
        register: "editorial",
        words: 28,
        text: greek,
      }),
    ]);
    expect(run(dir)).toBe(0);
    const essay = readLines(dir, OUT.essay);
    expect(essay).toHaveLength(1);
    expect(essay[0]!.lang).toBe("el");
    expect(provenance(dir).registers[2].langs).toEqual({ el: 1 });
  });

  it("creates an empty essay file when no register carries pre-era material", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hyphos-reference-"));
    writeJsonl(dir, "email-sent.jsonl", [
      rec({ ts: "2021-01-01", text: "only email" }),
    ]);
    expect(run(dir)).toBe(0);
    expect(fs.existsSync(path.join(outDir(dir), OUT.essay))).toBe(true);
    expect(fs.readFileSync(path.join(outDir(dir), OUT.essay), "utf8")).toBe("");
    const md = fs.readFileSync(path.join(outDir(dir), "PROVENANCE.md"), "utf8");
    expect(md).toContain("### essay — kept 0 records");
  });

  it("lets the reviewed owner-only voice set supersede the raw teams output", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hyphos-reference-"));
    fs.mkdirSync(path.join(dir, "teams-review"));
    writeJsonl(dir, "chat-teams.jsonl", [
      rec({ ts: "2021-01-01", source: "chat:teams", text: "raw teams row" }),
    ]);
    writeJsonl(path.join(dir, "teams-review"), "voice.jsonl", [
      rec({ ts: "2021-02-01", source: "chat:teams", text: "reviewed row" }),
    ]);
    writeJsonl(dir, "chat-other.jsonl", [
      rec({ ts: "2021-03-01", source: "chat:facebook", text: "facebook row" }),
    ]);
    expect(run(dir)).toBe(0);
    const chat = readLines(dir, OUT.chat);
    expect(chat.map((o) => o.text)).toEqual(["reviewed row", "facebook row"]);
    expect(
      provenance(dir).registers[1].sources.map((s: { file: string }) => s.file),
    ).toEqual(["teams-review/voice.jsonl", "chat-other.jsonl"]);
  });

  it("never reads the raw teams export when the reviewed set is absent", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hyphos-reference-"));
    writeJsonl(dir, "chat-teams.jsonl", [
      rec({ ts: "2021-01-01", source: "chat:teams", text: "unreviewed row" }),
    ]);
    expect(run(dir)).toBe(0);
    expect(readLines(dir, OUT.chat)).toEqual([]);
    expect(provenance(dir).registers[1].sources).toEqual([]);
  });

  it("keeps non-English records, tagged, per the language invariant", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hyphos-reference-"));
    writeJsonl(dir, "email-sent.jsonl", [
      rec({ ts: "2021-01-01", lang: "gr-latn", text: "rhythm-only row" }),
    ]);
    expect(run(dir)).toBe(0);
    expect(readLines(dir, OUT.email)).toHaveLength(1);
    const prov = provenance(dir);
    expect(prov.registers[0].langs).toEqual({ "gr-latn": 1 });
    expect(prov.languageRule).toContain("never vocabulary");
  });

  it("records the provenance: cutoff, exclusion rule, date ranges", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hyphos-reference-"));
    writeJsonl(dir, "email-sent.jsonl", [
      rec({ ts: "2016-02-01", text: "earliest" }),
      rec({ ts: "2022-11-30", text: "latest" }),
    ]);
    expect(run(dir)).toBe(0);
    const prov = provenance(dir);
    expect(prov.cutoff).toBe(2023);
    expect(prov.exclusionRule).toHaveLength(6);
    expect(prov.registers[0].dateRange).toEqual({
      min: "2016-02-01",
      max: "2022-11-30",
    });
    const md = fs.readFileSync(path.join(outDir(dir), "PROVENANCE.md"), "utf8");
    expect(md).toContain("Cutoff: records before 2023");
    expect(md).toContain("## Exclusion rule");
    expect(md).toContain("### email — kept 2 records");
    expect(md).toContain("2016-02-01 .. 2022-11-30");
  });

  it("writes output the fingerprint stage reads when pointed at it", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hyphos-reference-"));
    writeJsonl(dir, "email-sent.jsonl", [
      rec({ ts: "2019-01-01", source: "email:ref", text: "reference mail" }),
    ]);
    writeJsonl(dir, "chat-archived.jsonl", [
      rec({ ts: "2019-02-01", source: "chat:ref", text: "reference chat" }),
    ]);
    writeJsonl(dir, "tagged.jsonl", [
      rec({ ts: "2019-03-01", register: "editorial", text: "reference essay" }),
    ]);
    expect(run(dir)).toBe(0);

    const profiles = fs.mkdtempSync(path.join(os.tmpdir(), "hyphos-prof-"));
    const prevCorpus = process.env.HYPHOS_CORPUS;
    const prevProfiles = process.env.HYPHOS_PROFILES;
    process.env.HYPHOS_CORPUS = outDir(dir);
    process.env.HYPHOS_PROFILES = profiles;
    try {
      expect(runFingerprint()).toBe(0);
      for (const bucket of ["email-ref", "chat-ref", "editorial"]) {
        expect(
          fs.existsSync(path.join(profiles, bucket, "fingerprint.json")),
        ).toBe(true);
      }
    } finally {
      if (prevCorpus === undefined) delete process.env.HYPHOS_CORPUS;
      else process.env.HYPHOS_CORPUS = prevCorpus;
      if (prevProfiles === undefined) delete process.env.HYPHOS_PROFILES;
      else process.env.HYPHOS_PROFILES = prevProfiles;
      fs.rmSync(profiles, { recursive: true, force: true });
    }
  });

  it("writes owner-only output: a 0700 directory and 0600 files", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hyphos-reference-"));
    writeJsonl(dir, "email-sent.jsonl", [
      rec({ ts: "2019-01-01", text: "private writing" }),
    ]);
    expect(run(dir)).toBe(0);
    expect(fs.statSync(outDir(dir)).mode & 0o777).toBe(0o700);
    for (const name of [
      OUT.email,
      OUT.chat,
      OUT.essay,
      "provenance.json",
      "PROVENANCE.md",
    ]) {
      expect(fs.statSync(path.join(outDir(dir), name)).mode & 0o777).toBe(
        0o600,
      );
    }
    // A pre-existing loose build is tightened by the rebuild.
    fs.chmodSync(outDir(dir), 0o755);
    fs.chmodSync(path.join(outDir(dir), OUT.email), 0o644);
    expect(run(dir)).toBe(0);
    expect(fs.statSync(outDir(dir)).mode & 0o777).toBe(0o700);
    expect(fs.statSync(path.join(outDir(dir), OUT.email)).mode & 0o777).toBe(
      0o600,
    );
  });

  it("leaves no staging or previous-build siblings behind", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hyphos-reference-"));
    writeJsonl(dir, "email-sent.jsonl", [
      rec({ ts: "2019-01-01", text: "once" }),
    ]);
    expect(run(dir)).toBe(0);
    expect(run(dir)).toBe(0);
    expect(
      fs.readdirSync(dir).filter((f) => f.startsWith("reference-")),
    ).toEqual(["reference-pre-agent"]);
  });

  it("aborts on an unreadable source, naming it, and preserves the previous build", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hyphos-reference-"));
    writeJsonl(dir, "email-sent.jsonl", [
      rec({ ts: "2019-01-01", text: "first build" }),
    ]);
    expect(run(dir)).toBe(0);
    const before = fs.readFileSync(
      path.join(outDir(dir), "provenance.json"),
      "utf8",
    );

    const source = path.join(dir, "email-sent.jsonl");
    fs.chmodSync(source, 0o000);
    try {
      const { code, stderr } = runCapturing(dir);
      expect(code).toBe(1);
      expect(stderr).toContain("email-sent.jsonl");
      expect(
        fs.readFileSync(path.join(outDir(dir), "provenance.json"), "utf8"),
      ).toBe(before);
      expect(readLines(dir, OUT.email).map((o) => o.text)).toEqual([
        "first build",
      ]);
    } finally {
      fs.chmodSync(source, 0o644);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("honors a --year override for the cutoff, in both spellings", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hyphos-reference-"));
    writeJsonl(dir, "email-sent.jsonl", [
      rec({ ts: "2019-01-01", text: "kept" }),
      rec({ ts: "2020-06-01", text: "cut by override" }),
    ]);
    expect(run(dir, ["--year", "2020"])).toBe(0);
    expect(readLines(dir, OUT.email).map((o) => o.text)).toEqual(["kept"]);
    expect(provenance(dir).cutoff).toBe(2020);

    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), "hyphos-reference-"));
    writeJsonl(dir2, "email-sent.jsonl", [
      rec({ ts: "2019-01-01", text: "kept" }),
      rec({ ts: "2020-06-01", text: "cut by override" }),
    ]);
    expect(run(dir2, ["--year=2020"])).toBe(0);
    expect(readLines(dir2, OUT.email).map((o) => o.text)).toEqual(["kept"]);
    expect(provenance(dir2).cutoff).toBe(2020);
  });

  it("refuses an empty --year without building anything", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hyphos-reference-"));
    expect(run(dir, ["--year", "whenever"])).toBe(2);
    expect(fs.existsSync(outDir(dir))).toBe(false);
  });

  it("refuses an unrecognized argument instead of ignoring it", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hyphos-reference-"));
    writeJsonl(dir, "email-sent.jsonl", [
      rec({ ts: "2020-06-01", text: "would be rebuilt wrong" }),
    ]);
    // A silently ignored --year once rebuilt a 2020-cut corpus at 2023.
    const { code, stderr } = runCapturing(dir, ["--year=2020", "--wat"]);
    expect(code).toBe(2);
    expect(stderr).toContain("--wat");
    expect(fs.existsSync(outDir(dir))).toBe(false);
  });

  it("prints help and builds nothing for --help", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hyphos-reference-"));
    writeJsonl(dir, "email-sent.jsonl", [
      rec({ ts: "2019-01-01", text: "must stay unbuilt" }),
    ]);
    const outs: string[] = [];
    const orig = process.stdout.write.bind(process.stdout);
    (process.stdout as { write: unknown }).write = (s: unknown) => {
      outs.push(String(s));
      return true;
    };
    try {
      expect(run(dir, ["--help"])).toBe(0);
    } finally {
      (process.stdout as { write: unknown }).write = orig;
    }
    expect(outs.join("")).toContain("--year");
    expect(fs.existsSync(outDir(dir))).toBe(false);
  });

  it("reports a missing corpus dir instead of throwing", () => {
    process.env.HYPHOS_CORPUS = path.join(
      os.tmpdir(),
      "hyphos-reference-absent",
    );
    expect(runReference([])).toBe(1);
  });
});
