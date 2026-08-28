import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  RULES,
  PIPELINE_FIXTURES,
  applyOne,
  enforce,
  loadRules,
  rulesSelftest,
} from "../src/commands/rules.js";

/**
 * `hyphos rules --test` mirror: every rule is checked against its own declared
 * cases and the whole-pipeline fixtures. This must report zero failures
 * (D-003: deterministic enforcement).
 */
describe("rules self-test (D-003 deterministic enforcement)", () => {
  it("passes every rule case and pipeline fixture with 0 failures", () => {
    // quiet=false would print the summary; pass verbose=false to keep test output clean.
    expect(rulesSelftest(false)).toBe(0);
  });

  it("has the expected rule and test counts (10 rules, 14 tests)", () => {
    const nTests =
      RULES.reduce((s, r) => s + (r.tests?.length ?? 0), 0) +
      PIPELINE_FIXTURES.length;
    expect(RULES.length).toBe(10);
    expect(nTests).toBe(14);
  });

  it("leaves em-dashes untouched (rewrite family dropped, D-011)", () => {
    const [out] = enforce("a — mostly — b");
    expect(out).toBe("a — mostly — b");
  });

  it("checks each rule's individual cases directly", () => {
    for (const rule of RULES) {
      for (const t of rule.tests ?? []) {
        const [out, n] = applyOne(rule, t.in);
        if (t.out !== undefined) expect(out, `${rule.id}: ${t.in}`).toBe(t.out);
        if (t.flags !== undefined)
          expect(n, `${rule.id}: ${t.in}`).toBe(t.flags);
      }
    }
  });

  it("runs the pipeline fixtures through enforce", () => {
    for (const fx of PIPELINE_FIXTURES) {
      const [out] = enforce(fx.in);
      expect(out).toBe(fx.out);
    }
  });
});

describe("banned words (rule class and per-register list)", () => {
  const prevProfiles = process.env.HYPHOS_PROFILES;

  const withProfiles = (mutate: (dir: string) => void): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hyphos-banned-test-"));
    mutate(dir);
    process.env.HYPHOS_PROFILES = dir;
    return dir;
  };

  afterEach(() => {
    if (prevProfiles === undefined) delete process.env.HYPHOS_PROFILES;
    else process.env.HYPHOS_PROFILES = prevProfiles;
  });

  it("flags a banned word case-insensitively and leaves the text alone", () => {
    const [out, report] = enforce("the sidecar process works");
    expect(out).toBe("the sidecar process works");
    expect(report.flags["banned-words"]).toBe(1);
    const [, capitalized] = enforce("the Sidecar process works");
    expect(capitalized.flags["banned-words"]).toBe(1);
  });

  it("does not fire inside a larger word", () => {
    const [, report] = enforce("the sidecars retired");
    expect(report.flags["banned-words"]).toBeUndefined();
  });

  it("appends the register's banned.json as a banned rule", () => {
    const dir = withProfiles((d) => {
      fs.mkdirSync(path.join(d, "editorial"));
      fs.writeFileSync(
        path.join(d, "editorial", "banned.json"),
        JSON.stringify(["bundle", "leverage"]),
      );
    });
    try {
      const merged = loadRules("editorial");
      const rule = merged.find((r) => r.id === "banned-words-editorial");
      expect(rule).toBeDefined();
      expect(rule!.kind).toBe("banned");
      expect(rule!.words).toEqual(["bundle", "leverage"]);
      // the register list fires only when the register is named
      const [, withReg] = enforce("let's leverage the bundle", "editorial");
      expect(withReg.flags["banned-words-editorial"]).toBe(2);
      const [, withoutReg] = enforce("let's leverage the bundle");
      expect(withoutReg.flags["banned-words-editorial"]).toBeUndefined();
      // no built-in seed word here
      expect(withReg.flags["banned-words"]).toBeUndefined();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("ignores a missing or malformed register list", () => {
    const dir = withProfiles(() => {}); // no banned.json anywhere
    try {
      expect(loadRules("editorial")).toEqual(loadRules());
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    const bad = withProfiles((d) => {
      fs.mkdirSync(path.join(d, "editorial"));
      fs.writeFileSync(path.join(d, "editorial", "banned.json"), "{ not json");
    });
    try {
      expect(loadRules("editorial")).toEqual(loadRules());
    } finally {
      fs.rmSync(bad, { recursive: true, force: true });
    }
  });
});

describe("personal rules overlay (loadRules)", () => {
  const prevProfiles = process.env.HYPHOS_PROFILES;

  const withOverlay = (overlay: unknown): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hyphos-rules-test-"));
    fs.writeFileSync(path.join(dir, "rules.json"), JSON.stringify(overlay));
    process.env.HYPHOS_PROFILES = dir;
    return dir;
  };

  afterEach(() => {
    if (prevProfiles === undefined) delete process.env.HYPHOS_PROFILES;
    else process.env.HYPHOS_PROFILES = prevProfiles;
  });

  it("retunes a built-in in place when ids match", () => {
    const dir = withOverlay([
      {
        id: "opener-worth-noting",
        kind: "replace",
        pattern: "It(?:'|’)s worth noting that\\s+",
        replacement: "Recall that ",
        tests: [
          {
            in: "It's worth noting that X works.",
            out: "Recall that X works.",
          },
        ],
      },
    ]);
    try {
      const merged = loadRules();
      const i = merged.findIndex((r) => r.id === "opener-worth-noting");
      expect(merged.length).toBe(RULES.length);
      expect(merged[i]!.replacement).toBe("Recall that ");
      // position preserved — neighbors are the untouched built-ins
      expect(merged[i - 1]).toBeUndefined();
      expect(merged[i + 1]!.id).toBe("opener-importantly");
      // the retuned rule wins end to end, where an appended one never fired
      const [out] = enforce("It's worth noting that X works.");
      expect(out).toBe("Recall that X works.");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("appends entries with new ids after the built-ins", () => {
    const dir = withOverlay([
      {
        id: "personal-quirk",
        kind: "remove",
        pattern: "TODO\\s+",
        tests: [{ in: "TODO ship it", out: "ship it" }],
      },
    ]);
    try {
      const merged = loadRules();
      expect(merged.length).toBe(RULES.length + 1);
      expect(merged[RULES.length]!.id).toBe("personal-quirk");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("ignores a malformed overlay and keeps the built-ins", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hyphos-rules-test-"));
    fs.writeFileSync(path.join(dir, "rules.json"), "{ not json");
    process.env.HYPHOS_PROFILES = dir;
    try {
      expect(loadRules()).toEqual(RULES);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
