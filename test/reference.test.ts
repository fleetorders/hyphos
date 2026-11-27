import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runReference } from "../src/stages/reference.js";

/**
 * The reference corpus is the voice's last line of defense against learning
 * from the drafting agent's own output: everything dated in the agent era,
 * everything undated, every AI-marked text and every duplicate must be out,
 * and the provenance must say so. These cases pin each exclusion, the
 * register split, and the reviewed-chat supersedence.
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

function readLines(dir: string, name: string): Record<string, unknown>[] {
  const f = path.join(outDir(dir), name);
  if (!fs.existsSync(f)) return [];
  return fs
    .readFileSync(f, "utf8")
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l));
}

describe("the reference corpus rebuild", () => {
  it("keeps only records dated before the agent era, in every timestamp shape", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hyphos-reference-"));
    writeJsonl(dir, "email-sent.jsonl", [
      rec({ ts: "Fri, 01 Nov 2019 09:41:11 +0100", text: "mail kept" }), // RFC-5322
      rec({ ts: "Thu, 12 Jan 2023 09:00:00 +0000", text: "mail cut" }), // cutoff year
      rec({ ts: "2022-12-31T23:00:00.000Z", text: "iso kept" }), // ISO-8601
    ]);
    writeJsonl(dir, "chat-teams.jsonl", [
      rec({ ts: 1612541653050, text: "chat kept" }), // epoch ms, 2021
      rec({ ts: 1749263524733, text: "chat cut" }), // epoch ms, 2025
    ]);
    expect(run(dir)).toBe(0);

    const email = readLines(dir, "email.jsonl");
    const chat = readLines(dir, "chat.jsonl");
    expect(email.map((o) => o.text)).toEqual(["mail kept", "iso kept"]);
    expect(chat.map((o) => o.text)).toEqual(["chat kept"]);
  });

  it("excludes undated and unresolvable records rather than trusting them", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hyphos-reference-"));
    writeJsonl(dir, "email-sent.jsonl", [
      rec({ ts: "Fri, 01 Nov 2019 09:41:11 +0100", text: "dated" }),
      rec({ ts: null, text: "no timestamp" }),
      rec({ ts: "last tuesday", text: "unresolvable" }),
    ]);
    expect(run(dir)).toBe(0);
    const email = readLines(dir, "email.jsonl");
    expect(email.map((o) => o.text)).toEqual(["dated"]);
    const prov = JSON.parse(
      fs.readFileSync(path.join(outDir(dir), "provenance.json"), "utf8"),
    );
    expect(prov.registers[0].excluded.undated).toBe(2);
  });

  it("excludes an em-dash text as AI-influenced, per the curate marker", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hyphos-reference-"));
    writeJsonl(dir, "email-sent.jsonl", [
      rec({ ts: "2021-03-01", text: "clean text" }),
      rec({ ts: "2021-03-02", text: "marked text — with a dash" }),
    ]);
    expect(run(dir)).toBe(0);
    expect(readLines(dir, "email.jsonl").map((o) => o.text)).toEqual([
      "clean text",
    ]);
    const prov = JSON.parse(
      fs.readFileSync(path.join(outDir(dir), "provenance.json"), "utf8"),
    );
    expect(prov.registers[0].excluded.aiMarker).toBe(1);
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
    const email = readLines(dir, "email.jsonl");
    expect(email).toHaveLength(1);
    expect(email[0]!.words).toBe(35);
    const prov = JSON.parse(
      fs.readFileSync(path.join(outDir(dir), "provenance.json"), "utf8"),
    );
    expect(prov.registers[0].excluded.duplicates).toBe(1);
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
    const essay = readLines(dir, "essay.jsonl");
    expect(essay.map((o) => o.text)).toEqual(["old essay", "salvaged essay"]);
    const prov = JSON.parse(
      fs.readFileSync(path.join(outDir(dir), "provenance.json"), "utf8"),
    );
    const essayReg = prov.registers[2];
    expect(essayReg.kept).toBe(2);
    expect(essayReg.dateRange).toEqual({
      min: "2021-06-01",
      max: "2022-09-09",
    });
    expect(essayReg.excluded.dateCutoff).toBe(1);
  });

  it("creates an empty essay file when no register carries pre-era material", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hyphos-reference-"));
    writeJsonl(dir, "email-sent.jsonl", [
      rec({ ts: "2021-01-01", text: "only email" }),
    ]);
    expect(run(dir)).toBe(0);
    expect(fs.existsSync(path.join(outDir(dir), "essay.jsonl"))).toBe(true);
    expect(fs.readFileSync(path.join(outDir(dir), "essay.jsonl"), "utf8")).toBe(
      "",
    );
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
    writeJsonl(dir, "chat-facebook.jsonl", [
      rec({ ts: "2021-03-01", source: "chat:facebook", text: "facebook row" }),
    ]);
    expect(run(dir)).toBe(0);
    const chat = readLines(dir, "chat.jsonl");
    expect(chat.map((o) => o.text)).toEqual(["reviewed row", "facebook row"]);
    const prov = JSON.parse(
      fs.readFileSync(path.join(outDir(dir), "provenance.json"), "utf8"),
    );
    expect(
      prov.registers[1].sources.map((s: { file: string }) => s.file),
    ).toEqual(["teams-review/voice.jsonl", "chat-facebook.jsonl"]);
  });

  it("keeps non-English records, tagged, per the language invariant", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hyphos-reference-"));
    writeJsonl(dir, "email-sent.jsonl", [
      rec({ ts: "2021-01-01", lang: "gr-latn", text: "rhythm-only row" }),
    ]);
    expect(run(dir)).toBe(0);
    expect(readLines(dir, "email.jsonl")).toHaveLength(1);
    const prov = JSON.parse(
      fs.readFileSync(path.join(outDir(dir), "provenance.json"), "utf8"),
    );
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
    const prov = JSON.parse(
      fs.readFileSync(path.join(outDir(dir), "provenance.json"), "utf8"),
    );
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

  it("honors a --year override for the cutoff", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hyphos-reference-"));
    writeJsonl(dir, "email-sent.jsonl", [
      rec({ ts: "2019-01-01", text: "kept" }),
      rec({ ts: "2020-06-01", text: "cut by override" }),
    ]);
    expect(run(dir, ["--year", "2020"])).toBe(0);
    expect(readLines(dir, "email.jsonl").map((o) => o.text)).toEqual(["kept"]);
    const prov = JSON.parse(
      fs.readFileSync(path.join(outDir(dir), "provenance.json"), "utf8"),
    );
    expect(prov.cutoff).toBe(2020);
  });

  it("refuses an empty --year without building anything", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hyphos-reference-"));
    expect(run(dir, ["--year", "whenever"])).toBe(2);
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
