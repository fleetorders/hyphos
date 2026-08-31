# hyphos

## 0.3.0

### Minor Changes

- 80354c2: The banned-words rule class gains a token mode: `tokens` are literal marks
  matched without word boundaries — for tokens that are not words, like an
  em-dash, which a word boundary can never bracket. Banned tokens are flagged
  like banned words, never rewritten; the personal overlay carries them once,
  register-independent, so every register counts them. Rule patterns that can
  match the empty string — a missing `pattern` field, an empty word entry, a
  zero-width regex like `x*` — are now inert instead of firing at every
  position: such a rule reported the text's length plus one as its hit count
  while leaving the text unchanged. `rules --test` carries guard cases that
  pin both behaviors.

## 0.2.0

### Minor Changes

- 3043905: The deterministic enforcement pass gains a banned-words rule class: whole
  words a voice never uses are flagged — never amputated, since mid-sentence
  removal mangles meaning — wherever they appear. The built-in list ships
  empty: which words a writer avoids is personal, so the personal overlay
  (`profiles/rules.json`, overriding the `banned-words` id) fills it, and a
  register extends it with a `profiles/<register>/banned.json` file (one word
  per entry). `enforce --register`, `rewrite`, and the serve API apply the
  register's list; `rules --test` covers the new rule class.
- 309b6f0: `blind` now runs the argument-level labeling loop from the argument-shape
  research note: items are whole replies (25–180 words, `--unit paragraph` for
  per-paragraph items) instead of line snippets, each y/n judgment is followed
  by fixed reason codes plus an optional one-line note, and every judgment is
  appended to `corpus/feedback.jsonl` as a `kind: "blind-arg"` record —
  immediately, so an interrupted session still banks its labels. Units are
  keyed by `sha256` of their normalized text and never re-asked; when the
  unseen pool cannot fill a 12-item session (6 real + 6 generated) the command
  says so and stops rather than recycling. Sessions end with the discrimination
  rate and a reason histogram. The `-n` flag is gone — the session size is the
  ten-minute budget's fixed arithmetic. Also fixes non-TTY stdin: sequential
  `rl.question` calls dropped buffered lines, so piped or pasted-ahead answers
  deadlocked the loop after the first item; the loop now feeds one `line`
  handler through a queue and ends gracefully on stdin EOF.
- 8011af5: The deterministic em-dash rewrites (paired asides to parentheses, single and
  tight joins to commas) are removed from the rules registry. Dash usage is
  voice data, not a fixed substitution: profiles carry the voice's own baseline
  (~0 per 1k words for the calibration voice, and em-dash carriers are already
  excluded from the voice corpus as AI markers) and the fidelity score measures
  `emdash_per_1k`, so a rewritten draft is scored against the voice's actual
  dash density instead of being deterministically reshaped. The self-test
  counts and the whole-pipeline fixture now pin that em-dashes pass through
  the deterministic pass untouched.
- 8011af5: Personal rules overlay (`profiles/rules.json`) can now retune built-in rules:
  an overlay entry whose id matches a built-in replaces it in place — same
  position, its own replacement and tests — while entries with new ids still
  append after the built-ins. Appending alone could never redirect a built-in's
  pattern (an appended em-dash rule never saw an em-dash; the built-ins had
  already rewritten them all), so per-voice tuning of the deterministic pass
  was unreachable for exactly the rules it matters most for. A missing or
  malformed overlay still falls back to built-ins only.

### Patch Changes

- 9b82812: Dependency advisory sweep: mailparser 3.7.1 → 3.9.15 (clears the linkify-it
  quadratic-scan, nodemailer raw-attachment/SSRF/SMTP-injection, and mailparser
  XSS advisories), vitest 2.1.8 → 2.1.9, tsup 8.3.5 → 8.5.1, tsx 4.19.2 →
  4.23.12 (esbuild dev-server advisory). Remaining advisories need semver-major
  bumps and are parked for a decision: adm-zip 0.6.0 (crafted-ZIP allocation;
  here it only ever opens the user's own export archives) and vitest 4.x (API
  server RCE pair; the test suite never starts the UI/API server).
- e6f7a7e: The CLI now resolves `corpus/` and `profiles/` from the package root instead
  of the current working directory, so `hyphos score` (and every other
  command) works from any directory; `HYPHOS_HOME` overrides the data root for
  installations that keep corpus data elsewhere. Stage error hints now name the
  actual CLI commands (`hyphos fingerprint`, `hyphos curate`, `hyphos extract`)
  instead of the old stage-script names.
- 2724145: Curate and salvage now exclude em-dash-carrying messages from the voice
  corpus (routed to corpus/ai-marked.jsonl, never quarantine), closing the
  gap where pasted or AI-influenced text under the length ceiling reached the
  register fingerprints; the salvage summary prints the live quarantine count
  instead of a hardcoded literal.
- 30c481f: package.json now ships repository/homepage/bugs links pointing at the fleetorders GitHub org — the npm page gains a Repository link.
- a503948: Dependency major bumps that clear the remaining high-severity advisory set:
  vitest 2.1.8 → 4.1.10 (dev-only; the suite runs unchanged) and adm-zip
  0.5.16 → 0.6.0 (crafted-archive allocation fix, GHSA-xcpc-8h2w-3j85).
  adm-zip 0.6.0 bundles its own TypeScript types, so the @types/adm-zip stub is
  dropped; zip entries are still visited in stored central-directory order
  (`noSort`), the ordering the ingest stage relies on, verified unchanged
  across the bump.
- 05e58d3: README status reconciled with what actually ships: the rewrite backend
  (model pass + deterministic enforcement), the fidelity score (model-free v1
  and `--judge`), blind self-tests, and the local web app are stated as working,
  with the genuinely open items (score calibration, fingerprint refinements,
  `--typos natural` mode) named instead of a blanket "in progress". The
  quick-start data-location note now matches the package-root resolution
  (`HYPHOS_HOME` / per-directory overrides) instead of the retired cwd default.

## 0.1.0

### Minor Changes

- Initial release: corpus extraction and curation, register tagging, chat and
  email ingest, and stylometric fingerprints. The rewrite backend and the
  fidelity score are in progress.
