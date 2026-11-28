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
    // Runs against a relocated path (HYPHOS_SCRATCH): planting the symlink at
    // the real scratch path raced every other caller of it in the same run,
    // and on Linux the real path is not under the system temp at all. The
    // override names a parent; the guarded path is its hyphos-rewrite child.
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "hyphos-scratch-test-"));
    process.env.HYPHOS_SCRATCH = base;
    const dir = path.join(base, "hyphos-rewrite");
    try {
      claudeScratchDir();
      const decoy = fs.mkdtempSync(path.join(base, "decoy-"));
      fs.rmSync(dir, { recursive: true, force: true });
      fs.symlinkSync(decoy, dir);
      expect(() => claudeScratchDir()).toThrow(/not a folder you own/);
      // Remove the link (not the decoy) and leave a real scratch directory
      // behind, so the final call sees the guarded path resolve clean again.
      fs.rmSync(dir, { force: true });
      fs.rmSync(decoy, { recursive: true, force: true });
      expect(claudeScratchDir()).toBe(dir);
    } finally {
      delete process.env.HYPHOS_SCRATCH;
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  it("never clears anything but its own child under a relocated parent", () => {
    // The override names a parent the operator may keep other things in; an
    // unrelated file beside the scratch child must survive initialization
    // (and re-initialization), while stale contents inside the child do not.
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "hyphos-scratch-test-"));
    fs.writeFileSync(path.join(base, "operators-notes.txt"), "not hyphos's");
    process.env.HYPHOS_SCRATCH = base;
    try {
      const dir = claudeScratchDir();
      expect(dir).toBe(path.join(base, "hyphos-rewrite"));
      expect(fs.existsSync(path.join(base, "operators-notes.txt"))).toBe(true);
      fs.writeFileSync(path.join(dir, "CLAUDE.md"), "stale");
      claudeScratchDir();
      expect(fs.readdirSync(dir)).toEqual([]);
      expect(fs.existsSync(path.join(base, "operators-notes.txt"))).toBe(true);
    } finally {
      delete process.env.HYPHOS_SCRATCH;
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});
