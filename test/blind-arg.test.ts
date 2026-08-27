import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { describe, it, expect, afterEach } from "vitest";
import {
  REASON_CODES,
  buildSession,
  makeBlindArgRecord,
  normalizeUnitText,
  parseReasons,
  unitHash,
  type Session,
} from "../src/commands/blind-arg.js";
import {
  appendFeedbackRecord,
  feedbackPath,
  readUnitHashes,
} from "../src/commands/feedback.js";

// buildSession samples at random; tests assert properties that must hold for
// every draw, never a specific draw.
function okSession(s: Session): Extract<Session, { ok: true }> {
  expect(s.ok).toBe(true);
  return s as Extract<Session, { ok: true }>;
}

function drySession(s: Session): Extract<Session, { ok: false }> {
  expect(s.ok).toBe(false);
  return s as Extract<Session, { ok: false }>;
}

// Distinct texts well outside each other's hashes; word counts irrelevant to
// the sampler (band filtering is the caller's job).
const REAL = Array.from({ length: 12 }, (_, i) => `real reply number ${i}`);
const GEN = Array.from({ length: 12 }, (_, i) => `generated reply number ${i}`);

afterEach(() => {
  delete process.env.HYPHOS_CORPUS;
});

describe("sampling with exclusion", () => {
  it("never resamples a judged unit", () => {
    const first = okSession(buildSession(REAL, GEN, 6, new Set()));
    expect(first.items).toHaveLength(12);
    expect(first.items.filter((u) => u.wasReal)).toHaveLength(6);
    const judged = first.items.map((u) => u.hash);

    const second = okSession(buildSession(REAL, GEN, 6, new Set(judged)));
    for (const item of second.items) {
      expect(judged).not.toContain(item.hash);
    }

    // both sessions consumed → the pool is dry, not recycled
    const dry = drySession(
      buildSession(
        REAL,
        GEN,
        6,
        new Set([...judged, ...second.items.map((u) => u.hash)]),
      ),
    );
    expect(dry.unseenReal).toBe(0);
    expect(dry.unseenGenerated).toBe(0);
    expect(dry.need).toBe(6);
  });

  it("stops short instead of building a half session", () => {
    const short = drySession(buildSession(REAL, GEN.slice(0, 3), 6, new Set()));
    expect(short.unseenReal).toBe(12);
    expect(short.unseenGenerated).toBe(3);
  });

  it("a pool with duplicate texts yields each unit once", () => {
    const dupReal = [...REAL.slice(0, 6), ...REAL.slice(0, 6)];
    const s = okSession(buildSession(dupReal, GEN, 6, new Set()));
    const hashes = s.items.filter((u) => u.wasReal).map((u) => u.hash);
    expect(new Set(hashes).size).toBe(6);
  });
});

describe("unit hashing", () => {
  it("is stable across layout and case differences", () => {
    expect(unitHash("Fair  enough.\n\nAgreed, and")).toBe(
      unitHash("fair enough. agreed, and"),
    );
  });

  it("keys on sha256 of the normalized text", () => {
    expect(unitHash("Some text")).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(normalizeUnitText("  A\tb  c ")).toBe("a b c");
  });
});

describe("reason parsing", () => {
  it("accepts multiple codes, tolerating case and spacing", () => {
    expect(parseReasons("mechanism-run, rhythm")).toEqual({
      ok: true,
      codes: ["mechanism-run", "rhythm"],
    });
    expect(parseReasons(" Mechanism-Run ,RHYTHM ")).toEqual({
      ok: true,
      codes: ["mechanism-run", "rhythm"],
    });
  });

  it("accepts the empty answer as no codes", () => {
    expect(parseReasons("")).toEqual({ ok: true, codes: [] });
    expect(parseReasons("  ")).toEqual({ ok: true, codes: [] });
  });

  it("rejects unknown codes instead of dropping them", () => {
    expect(parseReasons("bogus, rhythm")).toEqual({
      ok: false,
      unknown: ["bogus"],
    });
  });

  it("covers the fixed list from the research note", () => {
    const parsed = parseReasons(REASON_CODES.join(","));
    expect(parsed.ok && parsed.codes).toHaveLength(12);
  });
});

describe("the stored record", () => {
  it("round-trips through the feedback store", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hyphos-blind-arg-"));
    process.env.HYPHOS_CORPUS = dir;
    const rec = makeBlindArgRecord({
      ts: "2026-08-27T02:30:00",
      register: "editorial",
      unitHash: unitHash("Some reply text worth judging"),
      verdict: "mine",
      wasReal: false,
      reasons: ["mechanism-run"],
      note: "the concession-then-because skeleton",
    });
    appendFeedbackRecord(rec);

    const lines = fs
      .readFileSync(feedbackPath(), "utf8")
      .split("\n")
      .filter((l) => l.length > 0);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toEqual(rec);
  });

  it("coexists with serve-shaped records when reading back hashes", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hyphos-blind-arg-"));
    process.env.HYPHOS_CORPUS = dir;
    appendFeedbackRecord({
      ts: "2026-08-27T02:31:00",
      register: "editorial",
      verdict: "good",
      note: "serve record, no unit hash",
    });
    const rec = makeBlindArgRecord({
      ts: "2026-08-27T02:32:00",
      register: "editorial",
      unitHash: "sha256:abc",
      verdict: "not-mine",
      wasReal: true,
      reasons: [],
      note: "",
    });
    appendFeedbackRecord(rec);

    expect(readUnitHashes()).toEqual(new Set(["sha256:abc"]));
  });

  it("reads an absent store as empty, not an error", () => {
    process.env.HYPHOS_CORPUS = path.join(os.tmpdir(), "hyphos-absent");
    expect(readUnitHashes()).toEqual(new Set());
  });
});
