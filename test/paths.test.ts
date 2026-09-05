import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, afterEach } from "vitest";
import { corpusDir, profilesDir, dataRoot } from "../src/lib/paths.js";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const tmpCleanups: string[] = [];

/** A fake hyphos checkout: `package.json` named hyphos plus a profiles dir. */
function fakeCheckout(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hyphos-checkout-"));
  tmpCleanups.push(root);
  fs.writeFileSync(path.join(root, "package.json"), '{"name": "hyphos"}');
  fs.mkdirSync(path.join(root, "profiles", "editorial"), { recursive: true });
  return root;
}

afterEach(() => {
  delete process.env.HYPHOS_HOME;
  delete process.env.HYPHOS_CORPUS;
  delete process.env.HYPHOS_PROFILES;
  for (const d of tmpCleanups.splice(0))
    fs.rmSync(d, { recursive: true, force: true });
});

describe("data root resolution", () => {
  it("anchors corpus/profiles at the package root, not the cwd", () => {
    const was = process.cwd();
    process.chdir(os.tmpdir());
    try {
      expect(dataRoot()).toBe(repoRoot);
      expect(corpusDir()).toBe(path.join(repoRoot, "corpus"));
      expect(profilesDir()).toBe(path.join(repoRoot, "profiles"));
    } finally {
      process.chdir(was);
    }
  });

  it("prefers a cwd hyphos checkout when the package root has no profiles", () => {
    // The published package ships no profiles/, so a cwd checkout wins —
    // `npx hyphos` run from inside a checkout must find THAT checkout's data.
    const checkout = fakeCheckout();
    const was = process.cwd();
    process.chdir(checkout);
    try {
      const root = dataRoot();
      if (root === repoRoot && fs.existsSync(path.join(repoRoot, "profiles")))
        return; // this run's package root IS a stocked checkout — same answer
      // realpath: on macOS the cwd resolves /var → /private/var.
      expect(fs.realpathSync(root)).toBe(fs.realpathSync(checkout));
      expect(fs.realpathSync(profilesDir())).toBe(
        fs.realpathSync(path.join(checkout, "profiles")),
      );
    } finally {
      process.chdir(was);
    }
  });

  it("keeps the package root when the cwd is no hyphos checkout", () => {
    const was = process.cwd();
    process.chdir(os.tmpdir());
    try {
      expect(dataRoot()).toBe(repoRoot);
    } finally {
      process.chdir(was);
    }
  });

  it("HYPHOS_HOME overrides the data root", () => {
    process.env.HYPHOS_HOME = path.join(os.tmpdir(), "hyphos-home");
    expect(corpusDir()).toBe(path.join(process.env.HYPHOS_HOME, "corpus"));
    expect(profilesDir()).toBe(path.join(process.env.HYPHOS_HOME, "profiles"));
  });

  it("per-dir overrides win over HYPHOS_HOME", () => {
    process.env.HYPHOS_HOME = path.join(os.tmpdir(), "hyphos-home");
    process.env.HYPHOS_CORPUS = path.join(os.tmpdir(), "corpus-override");
    expect(corpusDir()).toBe(process.env.HYPHOS_CORPUS);
    expect(profilesDir()).toBe(path.join(process.env.HYPHOS_HOME, "profiles"));
  });
});
