/**
 * Backend guard: the claude-CLI backend child is marked with
 * HYPHOS_BACKEND=1, the CLI entry refuses to start under the marker, and a
 * total backend failure reports each backend's own error (never only the
 * last).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { spawnSyncMock } = vi.hoisted(() => ({ spawnSyncMock: vi.fn() }));
// rewrite.ts's spawnSync is the mock; execFileSync above stays real for the
// CLI-entry subprocess case.
vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  spawnSync: spawnSyncMock,
}));

import {
  callClaudeCli,
  rewrite,
  judge,
  backendRefusal,
} from "../src/commands/rewrite.js";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

let hadKey: string | undefined;
let hadProfiles: string | undefined;
const tmpDirs: string[] = [];
beforeEach(() => {
  spawnSyncMock.mockReset();
  hadKey = process.env.ANTHROPIC_API_KEY;
  hadProfiles = process.env.HYPHOS_PROFILES;
  // A register with a style guide, so the refusal under test is the backend
  // one and not the no-style-guide refusal.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hyphos-backend-"));
  tmpDirs.push(root);
  fs.mkdirSync(path.join(root, "editorial"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "editorial", "styleguide.md"),
    "# Voice\n\nShort sentences. Plain words.\n",
    "utf8",
  );
  process.env.HYPHOS_PROFILES = root;
});
afterEach(() => {
  if (hadKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = hadKey;
  if (hadProfiles === undefined) delete process.env.HYPHOS_PROFILES;
  else process.env.HYPHOS_PROFILES = hadProfiles;
  for (const d of tmpDirs.splice(0))
    fs.rmSync(d, { recursive: true, force: true });
});

describe("backendRefusal", () => {
  it("refuses under the marker env with the model-backend message", () => {
    const msg = backendRefusal({ HYPHOS_BACKEND: "1" });
    expect(msg).toMatch(/model backend/);
    expect(msg).toMatch(/do not invoke hyphos/);
  });

  it("allows a clean env", () => {
    expect(backendRefusal({})).toBeNull();
  });
});

describe("callClaudeCli", () => {
  it("marks the child env and runs it restricted", () => {
    spawnSyncMock.mockReturnValue({ status: 0, stdout: "out", stderr: "" });
    callClaudeCli("rewrite this");
    expect(spawnSyncMock).toHaveBeenCalledTimes(1);
    const [cmd, args, opts] = spawnSyncMock.mock.calls[0] as [
      string,
      string[],
      { env: Record<string, string> },
    ];
    expect(cmd).toBe("claude");
    expect(args.at(-1)).toBe("rewrite this");
    expect(args).toContain("--restricted");
    expect(opts.env.HYPHOS_BACKEND).toBe("1");
  });
});

describe("total backend failure", () => {
  it("rewrite names each backend with its own error", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    spawnSyncMock.mockReturnValue({
      error: Object.assign(new Error("spawn failed"), { code: "ENOENT" }),
    });
    await expect(rewrite("editorial", "draft text", "auto")).rejects.toThrow(
      "no backend succeeded — claude: claude CLI not found on PATH; api: ANTHROPIC_API_KEY not set",
    );
  });

  it("judge names each backend with its own error", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    spawnSyncMock.mockReturnValue({
      error: Object.assign(new Error("spawn failed"), { code: "ENOENT" }),
    });
    const out = await judge("text", "editorial", "auto");
    expect(out.error).toBe(
      "judge failed — claude: claude CLI not found on PATH; api: ANTHROPIC_API_KEY not set",
    );
  });
});

describe("CLI entry", () => {
  it("refuses to start under HYPHOS_BACKEND=1, non-zero, immediately", () => {
    const draft = path.join(os.tmpdir(), "hyphos-backend-guard-draft.md");
    fs.writeFileSync(draft, "Some draft text.\n");
    let caught: { status?: number; stderr?: string } | null = null;
    try {
      execFileSync(
        process.execPath,
        [
          "--import",
          "tsx",
          path.join(repoRoot, "src", "cli.ts"),
          "rewrite",
          draft,
        ],
        {
          encoding: "utf8",
          env: { ...process.env, HYPHOS_BACKEND: "1" },
          timeout: 30000,
        },
      );
    } catch (e) {
      caught = e as { status?: number; stderr?: string };
    }
    expect(caught?.status).toBe(1);
    expect(caught?.stderr).toMatch(/model backend/);
    expect(caught?.stderr).toMatch(/do not invoke hyphos/);
    fs.rmSync(draft, { force: true });
  });
});
