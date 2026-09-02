import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildPrompt, judge } from "../src/commands/rewrite.js";
import { registersInfo } from "../src/commands/score.js";
import { SysExit } from "../src/commands/sysexit.js";

/**
 * A register with a fingerprint but no style guide can be scored and cannot be
 * rewritten. The failure used to be silent: the prompt simply omitted the
 * voice description, the model answered anyway, and the output was in nobody's
 * voice with no error to notice.
 */

const tmpDirs: string[] = [];
const savedEnv = { ...process.env };

function profilesWith(register: string, guide: boolean): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hyphos-guide-"));
  tmpDirs.push(root);
  const dir = path.join(root, register);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "fingerprint.json"),
    JSON.stringify({ words: 40000 }),
    "utf8",
  );
  if (guide) {
    fs.writeFileSync(
      path.join(dir, "styleguide.md"),
      "# Voice\n\nShort sentences. Plain words.\n",
      "utf8",
    );
  }
  process.env.HYPHOS_PROFILES = root;
  return root;
}

afterEach(() => {
  process.env = { ...savedEnv };
  for (const d of tmpDirs.splice(0))
    fs.rmSync(d, { recursive: true, force: true });
});

describe("a rewrite refuses a register with no style guide", () => {
  it("throws rather than building a prompt without the voice", () => {
    profilesWith("nogui", false);
    expect(() => buildPrompt("nogui", "some draft text")).toThrow(SysExit);
    expect(() => buildPrompt("nogui", "some draft text")).toThrow(/styleguide/);
  });

  it("names the register in the refusal, so the gap is actionable", () => {
    profilesWith("nogui", false);
    expect(() => buildPrompt("nogui", "draft")).toThrow(/"nogui"/);
  });

  it("builds the prompt, style guide included, once the guide exists", () => {
    profilesWith("hasgui", true);
    const prompt = buildPrompt("hasgui", "some draft text");
    expect(prompt).toContain("== STYLE GUIDE ==");
    expect(prompt).toContain("Short sentences.");
    expect(prompt).toContain("some draft text");
  });

  it("refuses to judge against a guide it does not have", async () => {
    profilesWith("nogui", false);
    // Refuses before any backend is reached, so no model call is made.
    await expect(judge("some text", "nogui")).rejects.toThrow(SysExit);
  });
});

describe("register listing says which registers can be rewritten", () => {
  it("marks a register with a style guide as rewritable", () => {
    profilesWith("hasgui", true);
    const info = registersInfo().find((r) => r.register === "hasgui");
    expect(info?.rewritable).toBe(true);
    expect(info?.hint).toBeNull();
  });

  it("marks one without a guide as not rewritable, and says so", () => {
    profilesWith("nogui", false);
    const info = registersInfo().find((r) => r.register === "nogui");
    expect(info?.rewritable).toBe(false);
    expect(info?.hint).toMatch(/scored but not rewritten/);
  });

  it("still lists it, because scoring against it works", () => {
    profilesWith("nogui", false);
    expect(registersInfo().map((r) => r.register)).toContain("nogui");
  });
});
