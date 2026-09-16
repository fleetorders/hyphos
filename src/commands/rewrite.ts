/**
 * Model-driven rewrite and the LLM judge, plus the two model backends (D-005).
 *
 * `rewrite` builds a style-guided prompt, calls the model, then runs the
 * deterministic enforcement pass over the result. `judge` asks the model to
 * score voice fidelity and is reported beside the stylometric score, never
 * averaged into it. Backends: "claude" drives the local `claude` CLI as a
 * subprocess (the existing subscription); "api" uses ANTHROPIC_API_KEY; "auto"
 * prefers claude and falls back to the API.
 *
 * These paths depend on an external model, so their text output is inherently
 * non-deterministic — but the prompt construction, backend order, fallback
 * logic, and enforcement wiring are deterministic. See the notes on
 * `injectTypos` (seeded RNG) below.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { pyRound } from "../lib/num.js";
import { profilesDir } from "../lib/paths.js";
import { enforce, type EnforceReport } from "./rules.js";
import { pyDumps, pyJsonParse } from "./pyjson.js";
import { SysExit } from "./sysexit.js";

function readTextIfFile(p: string): string | null {
  try {
    if (fs.statSync(p).isFile()) return fs.readFileSync(p, "utf8");
  } catch {
    // not a file / unreadable
  }
  return null;
}

/**
 * The output contract with the backend.
 *
 * A backend is asked for rewritten text and can answer with a conversation:
 * a preamble, a note on what it changed, a suggestion. Without a delimiter
 * there is no way to tell the rewrite from the talk around it, and the talk
 * travels into whatever the user sends. Markers make the contract checkable,
 * and a backend that ignores them fails loudly instead of quietly handing
 * back its own commentary.
 */
const OPEN = "<<<REWRITE";
const CLOSE = "REWRITE>>>";

/**
 * Pull the rewritten text out of a backend reply, or refuse it.
 */
export function extractRewrite(out: string): string {
  const i = out.indexOf(OPEN);
  const j = out.lastIndexOf(CLOSE);
  if (i < 0 || j < 0 || j < i) {
    throw new SysExit(
      "the backend did not honour the output contract: no " +
        `${OPEN} ... ${CLOSE} block in its reply, so the rewrite cannot be ` +
        "separated from any commentary around it. Nothing was written.",
    );
  }
  const text = out.slice(i + OPEN.length, j).trim();
  if (!text) {
    throw new SysExit("the backend returned an empty rewrite.");
  }
  return text;
}

/**
 * The register's distilled style guide, or a refusal.
 *
 * A register can be scored from its fingerprint alone, but nothing can be
 * written IN a voice without a description of it. When the guide was merely
 * skipped, the prompt still formed and the model still answered — it just
 * answered in nobody's voice, and the only way to notice was to read the
 * output and be disappointed. Refusing names the gap instead.
 */
function styleGuide(register: string): string {
  const g = readTextIfFile(path.join(profilesDir(), register, "styleguide.md"));
  if (g === null) {
    throw new SysExit(
      `register "${register}" has no styleguide.md, so a rewrite would not be ` +
        `in your voice. Registers without one can be scored but not rewritten. ` +
        `(profiles dir: ${profilesDir()})`,
    );
  }
  return g;
}

/** Compose the rewrite prompt from the register's style guide and anti-patterns. */
export function buildPrompt(register: string, draft: string): string {
  const isms = path.join(profilesDir(), "model-isms.md");
  const parts = [
    "Rewrite the draft below so it reads as written by the person",
    "described in the style guide. Preserve the meaning and all facts.",
    "Match the register exactly; keep protected quirks; remove every",
    "anti-pattern.",
    `Emit the rewritten text between ${OPEN} and ${CLOSE}, on their own`,
    "lines, and write nothing else at all: no preamble, no explanation of",
    "what you changed, no note about how you produced it.\n",
  ];
  parts.push("== STYLE GUIDE ==", styleGuide(register));
  const im = readTextIfFile(isms);
  if (im !== null) parts.push("== ANTI-PATTERNS (never produce these) ==", im);
  parts.push("== DRAFT ==", draft);
  return parts.join("\n");
}

/**
 * Env var that marks a process as the model backend of a running hyphos (set
 * on the child by `callClaudeCli`). The CLI entry refuses to start under it —
 * see `backendRefusal`.
 */
export const BACKEND_ENV = "HYPHOS_BACKEND";

/**
 * Refusal message for a hyphos started from inside its own model backend, or
 * null when the env is clean. The spawn flags in `callClaudeCli` strip the
 * backend's agency, but a flag's meaning can drift as the CLI updates under a
 * fixed name, and a user's global agent instructions may route prose through
 * this tool — so an unguarded backend call can recurse, the child re-invoking
 * hyphos on its own input until the spawn timeout. This guard kills the class
 * backend-agnostically: whatever the backend model decides, the nested hyphos
 * exits immediately and tells it to answer in place.
 */
export function backendRefusal(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (env[BACKEND_ENV] === "1") {
    return (
      "hyphos: refusing to start: this process is the model backend of an " +
      "already-running hyphos (HYPHOS_BACKEND=1) — rewrite the text " +
      "directly in your reply; do not invoke hyphos."
    );
  }
  return null;
}

/** Drive the local `claude` CLI as a subprocess (synchronous). */
export function callClaudeCli(prompt: string): string {
  // Run the backend with no agency and no borrowed instructions.
  //
  // `claude -p` is an agent, not a completion endpoint: started in a project
  // directory it loads that project's instructions and the user's settings,
  // and it can act. Asked to rewrite a paragraph it has been observed doing
  // unrelated work on the machine and narrating it in place of the rewrite.
  // `--restricted` drops the command-running tools and the user, project and
  // local settings files; `--permission-prompts none` denies anything that
  // would otherwise prompt; and an empty working directory means no project
  // instructions are found. The config directory is left alone on purpose —
  // credentials live there, and moving it would break authentication.
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "hyphos-rewrite-"));
  try {
    const r = spawnSync(
      "claude",
      ["--restricted", "--permission-prompts", "none", "-p", prompt],
      {
        cwd: workdir,
        encoding: "utf8",
        // Mark the child so a nested `hyphos` invocation refuses to start —
        // see backendRefusal.
        env: { ...process.env, [BACKEND_ENV]: "1" },
        timeout: 600000,
        // Model output can be large; there is no size limit, so lift Node's
        // default 1 MB cap to avoid truncating the response.
        maxBuffer: 64 * 1024 * 1024,
      },
    );
    if (r.error) {
      const code = (r.error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") throw new Error("claude CLI not found on PATH");
      throw new Error(`claude CLI failed: ${String(r.error).slice(0, 300)}`);
    }
    if (r.status !== 0) {
      const err = (r.stderr ?? "").slice(0, 300);
      // Refuse rather than retrying unisolated: a backend that cannot be
      // restricted is one that can act, and silently falling back would give
      // exactly the behaviour the flags exist to prevent.
      if (/unknown option|unrecognized option/i.test(err)) {
        throw new Error(
          "this claude CLI does not support --restricted, so the rewrite " +
            "cannot be run without tool access. Upgrade it, or use the api " +
            "backend (--backend api).",
        );
      }
      throw new Error(`claude CLI failed: ${err}`);
    }
    return (r.stdout ?? "").trim();
  } finally {
    fs.rmSync(workdir, { recursive: true, force: true });
  }
}

/** Call the Anthropic Messages API using ANTHROPIC_API_KEY. */
export async function callApi(prompt: string): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY not set");
  const body = JSON.stringify({
    model: process.env.HYPHOS_MODEL ?? "claude-sonnet-5",
    max_tokens: 4096,
    messages: [{ role: "user", content: prompt }],
  });
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body,
    signal: AbortSignal.timeout(300000),
  });
  if (!resp.ok) throw new Error(`api request failed: HTTP ${resp.status}`);
  const data = (await resp.json()) as { content?: { text?: string }[] };
  return (data.content ?? [])
    .map((b) => b.text ?? "")
    .join("")
    .trim();
}

/**
 * Model-judged fidelity: does this read as written by the profiled author, in
 * this register? Returns the parsed JSON (with a `backend` field) or an `error`
 * object if no backend produced usable JSON.
 */
export async function judge(
  text: string,
  register: string,
  backend = "auto",
): Promise<Record<string, unknown>> {
  const isms = path.join(profilesDir(), "model-isms.md");
  // Refuse for the same reason a rewrite refuses: judging a voice against a
  // guide that says "(missing)" returns confident numbers about nothing.
  const guideText = styleGuide(register);
  const prompt = [
    "You are judging whether the TEXT below reads as written by the",
    "specific person described in the STYLE GUIDE, in that register.",
    "Judge voice, not content. Score each 0-100:",
    "- register_match: right mode (tone, formality, shape) for this register",
    "- quirk_fidelity: the author's protected habits present and natural",
    "- model_ism_freedom: absence of the anti-patterns listed",
    "- overall: would a careful reader accept this as the author's writing",
    "Cite up to 3 short evidence phrases from the TEXT. Output ONLY a JSON",
    'object: {"register_match":N,"quirk_fidelity":N,"model_ism_freedom":N,',
    '"overall":N,"evidence":["...","..."]}',
    "",
    "== STYLE GUIDE ==",
    guideText,
    "== ANTI-PATTERNS ==",
    readTextIfFile(isms) ?? "(missing)",
    "== TEXT ==",
    text,
  ].join("\n");

  const order = backend === "auto" ? ["claude", "api"] : [backend];
  // Report every backend's own failure, never only the last: a claude-CLI
  // timeout hidden behind an api-key error once cost a whole diagnosis.
  const failures: string[] = [];
  for (const b of order) {
    try {
      const raw =
        b === "claude" ? callClaudeCli(prompt) : await callApi(prompt);
      const m = raw.match(/\{[\s\S]*\}/); // first "{" to last "}" (re.S greedy)
      if (!m) throw new Error(`no JSON in judge output: ${raw.slice(0, 120)}`);
      const out = pyJsonParse(m[0]) as Record<string, unknown>;
      out["backend"] = b;
      return out;
    } catch (e) {
      failures.push(`${b}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { error: `judge failed — ${failures.join("; ")}` };
}

// --- typo injection (D-006, opt-in) ---

// Deterministic 32-bit FNV-1a string hash, used only to seed the shuffle.
function strHash(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

// Small deterministic PRNG (mulberry32) so typo injection is reproducible per
// input. The count `k` and the candidate set are computed deterministically;
// which words receive a typo is seeded by the input's hash.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleInPlace<T>(arr: T[], rng: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
}

/**
 * Re-introduce the author's real typos at the measured per-register rate. The
 * catalog and rate come from the profile; `k` (how many to inject) is
 * `round(rate * words / 1000)`. The selection order uses a seeded shuffle (see
 * the note above).
 */
export function injectTypos(text: string, register: string): [string, number] {
  const tj = path.join(profilesDir(), register, "typos.json");
  const fp = path.join(profilesDir(), register, "fingerprint.json");
  let tjText: string;
  let fpText: string;
  try {
    if (!fs.statSync(tj).isFile() || !fs.statSync(fp).isFile())
      return [text, 0];
    tjText = fs.readFileSync(tj, "utf8");
    fpText = fs.readFileSync(fp, "utf8");
  } catch {
    return [text, 0];
  }
  const catalog = JSON.parse(tjText) as Record<string, string>; // {typo: correction}
  const rate =
    (JSON.parse(fpText) as { typo_per_1k?: number }).typo_per_1k ?? 0;

  const byCorrect: Record<string, string> = {};
  for (const [typo, correct] of Object.entries(catalog)) {
    if (!(correct in byCorrect)) byCorrect[correct] = typo; // setdefault: first wins
  }

  const wordCount = (text.toLowerCase().match(/[a-z']+/g) ?? []).length;
  const k = pyRound((rate * wordCount) / 1000, 0);
  if (k <= 0) return [text, 0];

  const positions: [number, string][] = [];
  for (const m of text.matchAll(/\b[a-z']+\b/g)) {
    if (m[0] in byCorrect) positions.push([m.index!, m[0]]);
  }
  shuffleInPlace(positions, mulberry32(strHash(text)));

  // In-place mutation: each edit uses its original
  // captured offset applied to the progressively-mutated string.
  let out = text;
  let injected = 0;
  for (const [start, word] of positions.slice(0, k)) {
    out =
      out.slice(0, start) + byCorrect[word]! + out.slice(start + word.length);
    injected++;
  }
  return [out, injected];
}

/**
 * Rewrite a draft via the model then the deterministic pass. Tries backends in
 * order and returns [finalText, report, backendUsed]. Throws {@link SysExit} if
 * no backend succeeds (a `SysExit` is raised).
 */
export async function rewrite(
  register: string,
  draft: string,
  backend: string,
  typos = "none",
): Promise<[string, EnforceReport, string]> {
  const prompt = buildPrompt(register, draft);
  const order = backend === "auto" ? ["claude", "api"] : [backend];
  // Same honest-error rule as `judge`: every backend's own failure is named.
  const failures: string[] = [];
  for (const b of order) {
    try {
      const raw =
        b === "claude" ? callClaudeCli(prompt) : await callApi(prompt);
      const out = extractRewrite(raw);
      const [final, report] = enforce(out, register);
      let finalText = final;
      if (typos === "natural") {
        const [t, n] = injectTypos(finalText, register);
        finalText = t;
        report.typos_injected = n;
      }
      return [finalText, report, b];
    } catch (e) {
      failures.push(`${b}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  throw new SysExit(`no backend succeeded — ${failures.join("; ")}`);
}

/**
 * `rewrite` subcommand: rewrite a file, write the result to stdout (no trailing
 * newline) and the backend + enforcement report to stderr. Returns an exit code.
 */
export async function runRewrite(
  file: string,
  opts: { register: string; backend: string; typos: string },
): Promise<number> {
  const text = fs.readFileSync(file, "utf8");
  const [out, report, backend] = await rewrite(
    opts.register,
    text,
    opts.backend,
    opts.typos,
  );
  process.stdout.write(out);
  process.stderr.write(
    `\n== backend: ${backend} ==\n== profiles: ${profilesDir()} ==\n` +
      `== enforcement ==\n` +
      pyDumps(report, { indent: 1 }) +
      "\n",
  );
  return 0;
}
