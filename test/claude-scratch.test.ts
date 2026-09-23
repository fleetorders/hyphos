import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { claudeScratchDir } from "../src/commands/rewrite.js";

/**
 * The claude backend runs from one fixed scratch directory instead of a fresh
 * temp folder per call: the harness files transcripts under a project folder
 * named after the working directory, so a per-call folder accumulated a new
 * project folder per call. The directory must also come back empty every
 * time — a leftover file could carry project instructions into the rewrite.
 */

describe("claudeScratchDir", () => {
  it("returns the same path on every call", () => {
    expect(claudeScratchDir()).toBe(claudeScratchDir());
  });

  it("clears stale contents that could carry project instructions", () => {
    const dir = claudeScratchDir();
    fs.writeFileSync(path.join(dir, "CLAUDE.md"), "borrowed instructions");
    expect(claudeScratchDir()).toBe(dir);
    expect(fs.readdirSync(dir)).toEqual([]);
  });
});
