---
"hyphos": patch
---

Resolve profiles from the cwd's hyphos checkout when the package root ships none, and say which dir was used.

The published package carries only `dist/`, so `npx hyphos rewrite` resolved its profiles dir inside the npx cache — empty. The rewrite then ran with no style guide (older versions: nobody's voice, silently) or refused (0.3.0+: loud, but still no rewrite). When the package root has no `profiles/`, the data root now prefers a current working directory inside a hyphos checkout that has one, so running `npx hyphos rewrite` from your checkout uses your profiles. `rewrite` prints the profiles dir it used next to the backend, and the no-style-guide refusal names the dir it searched, so a wrong root is visible in one line. `HYPHOS_HOME` and `HYPHOS_CORPUS` / `HYPHOS_PROFILES` keep precedence.
