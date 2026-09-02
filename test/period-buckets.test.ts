import { describe, it, expect, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runFingerprint } from "../src/stages/fingerprint.js";

/**
 * Period sub-buckets exist to show how a voice moved. A sub-bucket holding
 * every record of its parent shows nothing: it is the same corpus under a
 * second name, and it advertises a register that does not exist.
 */

const tmpDirs: string[] = [];
const savedEnv = { ...process.env };

/** Enough words per record that a bucket clears the stage's own thresholds. */
const LINE =
  "the release went out this morning and the checks are green so far today";

function corpusOf(records: { ts: number; text?: string }[]): string {
  const corpus = fs.mkdtempSync(path.join(os.tmpdir(), "hyphos-period-c-"));
  const profiles = fs.mkdtempSync(path.join(os.tmpdir(), "hyphos-period-p-"));
  tmpDirs.push(corpus, profiles);
  process.env.HYPHOS_CORPUS = corpus;
  process.env.HYPHOS_PROFILES = profiles;
  const lines = records.map((r) =>
    JSON.stringify({
      ts: r.ts,
      source: "chat:probe",
      lang: "en",
      words: 13,
      text: r.text ?? LINE,
    }),
  );
  fs.writeFileSync(
    path.join(corpus, "chat-probe.jsonl"),
    lines.join("\n") + "\n",
    "utf8",
  );
  return profiles;
}

const YEAR_2021 = Date.UTC(2021, 5, 1);
const YEAR_2025 = Date.UTC(2025, 5, 1);

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...savedEnv };
  for (const d of tmpDirs.splice(0))
    fs.rmSync(d, { recursive: true, force: true });
});

describe("period sub-buckets", () => {
  it("builds both when the corpus straddles the split", () => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const profiles = corpusOf([
      { ts: YEAR_2021 },
      { ts: YEAR_2021 },
      { ts: YEAR_2025 },
      { ts: YEAR_2025 },
    ]);
    runFingerprint();
    expect(fs.existsSync(path.join(profiles, "chat-probe"))).toBe(true);
    expect(fs.existsSync(path.join(profiles, "chat-probe-pre2023"))).toBe(true);
    expect(fs.existsSync(path.join(profiles, "chat-probe-recent"))).toBe(true);
  });

  it("skips a sub-bucket that would hold every record of its parent", () => {
    const writes: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((c: unknown) => {
      writes.push(String(c));
      return true;
    });
    const profiles = corpusOf([{ ts: YEAR_2025 }, { ts: YEAR_2025 }]);
    runFingerprint();
    expect(fs.existsSync(path.join(profiles, "chat-probe"))).toBe(true);
    expect(fs.existsSync(path.join(profiles, "chat-probe-recent"))).toBe(false);
    // Silence would leave the reader guessing why the profile never appeared.
    expect(writes.join("")).toMatch(/chat-probe-recent: skipped/);
  });

  it("skips the earlier sub-bucket on the same rule", () => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const profiles = corpusOf([{ ts: YEAR_2021 }, { ts: YEAR_2021 }]);
    runFingerprint();
    expect(fs.existsSync(path.join(profiles, "chat-probe-pre2023"))).toBe(
      false,
    );
  });
});
