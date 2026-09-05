import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Corpus and profiles locations. The data root is the hyphos package root,
 * anchored to this module's own location (a `package.json` walk) rather than
 * the current working directory, so the CLI works from any directory. The
 * published package ships no `profiles/` (it is gitignored data), so when the
 * package root carries none the cwd is searched for a hyphos checkout that
 * does — running via `npx` from inside your checkout then finds YOUR
 * profiles instead of rewriting in nobody's voice. Users who keep corpus
 * data elsewhere point `HYPHOS_HOME` at it; the finer-grained
 * `HYPHOS_CORPUS` / `HYPHOS_PROFILES` overrides win over `HYPHOS_HOME`.
 */
export function corpusDir(): string {
  return process.env.HYPHOS_CORPUS ?? path.join(dataRoot(), "corpus");
}

export function profilesDir(): string {
  return process.env.HYPHOS_PROFILES ?? path.join(dataRoot(), "profiles");
}

function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * A hyphos checkout with profile data: a `package.json` named `hyphos` next
 * to a `profiles/` directory. The profiles requirement is what separates a
 * checkout from an installed copy of the package, which ships no profiles.
 */
function isCheckoutWithProfiles(dir: string): boolean {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(dir, "package.json"), "utf8"),
    ) as { name?: string };
    return pkg.name === "hyphos" && isDir(path.join(dir, "profiles"));
  } catch {
    return false;
  }
}

/**
 * Walk up from `start` to the nearest hyphos checkout carrying `profiles/`.
 */
function checkoutFrom(start: string): string | null {
  let dir = start;
  for (;;) {
    if (isCheckoutWithProfiles(dir)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * The package root — walk up from this module to the nearest `package.json`
 * named `hyphos`, whether running from `src/` (tsx, tests) or from the
 * bundled `dist/` CLI. Falls back to the cwd (the historical behavior) only
 * if the walk leaves the package entirely, e.g. an exotic embedding.
 */
export function dataRoot(): string {
  if (process.env.HYPHOS_HOME) return process.env.HYPHOS_HOME;
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (;;) {
    try {
      const pkg = JSON.parse(
        fs.readFileSync(path.join(dir, "package.json"), "utf8"),
      ) as { name?: string };
      if (pkg.name === "hyphos") break;
    } catch {
      // no readable package.json here — keep walking up
    }
    const parent = path.dirname(dir);
    if (parent === dir) return process.cwd();
    dir = parent;
  }
  // The package root carries no profiles (e.g. an `npx` cache install of the
  // published package): prefer the cwd's checkout, which has them.
  if (!isDir(path.join(dir, "profiles"))) {
    const checkout = checkoutFrom(process.cwd());
    if (checkout !== null) return checkout;
  }
  return dir;
}
