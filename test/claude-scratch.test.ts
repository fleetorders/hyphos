import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { claudeScratchDir } from "../src/commands/rewrite.js";

/**
 * The claude backend runs from one fixed scratch directory instead of a fresh
 * temp folder per call: the harness files transcripts under a project folder
 * named after the working directory, so a per-call folder accumulated a new
 * project folder per call. The directory must also come back empty every
 * time — a leftover file could carry project instructions into the rewrite.
 * And the location is per-user: on Linux the system temp directory is shared
 * by every user on the machine, where a guessable fixed name could be
 * pre-created or symlinked by someone else.
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

  it("stays out of the system temp directory on Linux", () => {
    const dir = claudeScratchDir();
    const perUserTemp =
      process.platform === "darwin" || process.platform === "win32";
    expect(dir.startsWith(os.tmpdir() + path.sep)).toBe(perUserTemp);
    expect(path.basename(dir)).toBe("hyphos-rewrite");
  });

  it("refuses a scratch path that is not a folder the user owns", () => {
    const dir = claudeScratchDir();
    const decoy = fs.mkdtempSync(path.join(os.tmpdir(), "hyphos-decoy-"));
    fs.rmSync(dir, { recursive: true, force: true });
    fs.symlinkSync(decoy, dir);
    expect(() => claudeScratchDir()).toThrow(/not a folder you own/);
    // Remove the link (not the decoy) and leave a real scratch directory
    // behind, so later tests and later runs start clean.
    fs.rmSync(dir, { force: true });
    fs.rmSync(decoy, { recursive: true, force: true });
    expect(claudeScratchDir()).toBe(dir);
  });
});
