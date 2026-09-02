import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildPrompt, judge, extractRewrite } from "../src/commands/rewrite.js";
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

describe("the backend's reply must be a rewrite, not a conversation", () => {
  it("takes the text between the markers", () => {
    const out = extractRewrite("<<<REWRITE\nthe rewritten line\nREWRITE>>>");
    expect(out).toBe("the rewritten line");
  });

  it("drops preamble and trailing commentary around the markers", () => {
    // The observed failure: the backend answers conversationally and explains
    // itself, and without a delimiter the explanation travels with the text.
    const reply = [
      "Here is the rewritten draft, and a note on what I changed.",
      "<<<REWRITE",
      "could you please review the PR when you get a minute?",
      "REWRITE>>>",
      "",
      "Note: I produced this by imitation, not by running the engine.",
    ].join("\n");
    const out = extractRewrite(reply);
    expect(out).toBe("could you please review the PR when you get a minute?");
    expect(out).not.toMatch(/Note:/);
    expect(out).not.toMatch(/rewritten draft/);
  });

  it("refuses a reply with no markers rather than passing the talk through", () => {
    expect(() =>
      extractRewrite("Sure! Here is your text, rewritten in your voice."),
    ).toThrow(SysExit);
    expect(() => extractRewrite("no markers here")).toThrow(
      /did not honour the output contract/,
    );
  });

  it("refuses an empty rewrite", () => {
    expect(() => extractRewrite("<<<REWRITE\n \nREWRITE>>>")).toThrow(
      /empty rewrite/,
    );
  });

  it("asks for the markers in the prompt it builds", () => {
    profilesWith("hasgui", true);
    const prompt = buildPrompt("hasgui", "draft");
    expect(prompt).toContain("<<<REWRITE");
    expect(prompt).toContain("REWRITE>>>");
    expect(prompt).toMatch(/no preamble/);
  });
});
