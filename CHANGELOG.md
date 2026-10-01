# hyphos

## 0.5.1

### Patch Changes

- 8e482d3: Update adm-zip to 0.6.1 and mailparser to 3.9.32 (nodemailer 10.0.13), clearing their open security advisories.

## 0.5.0

### Minor Changes

- 386a9dc: Rewrite backend child processes now run with `HYPHOS_BACKEND=1`, and the CLI refuses to start under that marker, preventing a nested hyphos from re-invoking itself until timeout. When every backend fails, `rewrite` and `score --judge` now report each backend's own error instead of only the last one.

### Patch Changes

- 60b8a6f: Dependency advisory sweep: mailparser 3.9.15 → 3.9.23 clears the four open nodemailer highs and the deepmerge-ts stack-exhaustion high. The remaining advisories do not affect hyphos.
- d370406: Source comments and decision records use neutral wording in place of notes about one person's own setup and mail archive.

## 0.4.0

### Minor Changes

- d7cb582: Deduplicate re-sends and redrafts in every ingest path: `curate`, `ingest-email` and `ingest-chat` now remove duplicate copies of one composition before writing, so a letter sent to five recipients no longer counts five times in the fingerprint and removals survive a re-run. Repetitions under 25 words are kept, since short repeated acknowledgements are part of a voice.
- 8a13cce: The `-pre2023` and `-recent` period profiles are now built for every source, not just mail; the year is read from ISO-8601 dates, bare four-digit tokens, or epoch seconds and milliseconds. Chat and other non-mail registers gain their period profiles on the next `fingerprint` run.
- 735de62: The claude-CLI backend now runs with `--restricted` and `--permission-prompts none` in an empty working directory, so it cannot run commands or load project instructions; the config directory is untouched, and a CLI too old for `--restricted` is refused. The rewrite must arrive between markers; anything conversational around it is now a loud failure instead of passing through as the text.
- ad55154: `rewrite` and `score --judge` now refuse a register that has a fingerprint but no style guide, naming the register, instead of quietly rewriting in nobody's voice. Scoring is unaffected, and register listings now distinguish registers that can be written in from those that can only be measured.

### Patch Changes

- 7bd0e9c: When the package root ships no `profiles/` (as with `npx`), the data root now prefers a hyphos checkout around the current working directory, so `npx hyphos rewrite` from your checkout uses your profiles. `rewrite` prints the profiles dir it used, and the no-style-guide refusal names the dir it searched. `HYPHOS_HOME` and `HYPHOS_CORPUS` / `HYPHOS_PROFILES` keep precedence.
- 53f9631: A period sub-profile that would duplicate its parent (all records on one side of the split) is no longer built or listed; the fingerprint run prints a line naming which one was skipped.

## 0.3.0

### Minor Changes

- 80354c2: The banned-words rule class gains a `tokens` mode: literal marks matched without word boundaries, for tokens like an em-dash that word boundaries can never bracket; banned tokens are flagged, never rewritten. The personal overlay carries them once for every register. Rule patterns that can match the empty string are now inert instead of firing at every position.

## 0.2.0

### Minor Changes

- 3043905: New banned-words rule class: whole words a voice never uses are flagged wherever they appear, never removed mid-sentence. The built-in list ships empty; fill the personal overlay (`profiles/rules.json`, `banned-words` id) and extend per register with `profiles/<register>/banned.json`. `enforce --register`, `rewrite`, and the serve API apply the register's list.
- 309b6f0: `blind` now runs the argument-labeling loop: whole replies as items (`--unit paragraph` for per-paragraph), each y/n judgment followed by reason codes, and every judgment appended immediately to `corpus/feedback.jsonl`, so interrupted sessions keep their labels. Items are keyed by hash and never re-asked; the `-n` flag is gone. Piped or pasted-ahead answers no longer deadlock the loop.
- 8011af5: The deterministic em-dash rewrites are removed from the rules registry: dash usage is voice data, and the fidelity score already measures `emdash_per_1k` against the voice's own density. Em-dashes now pass through the deterministic pass untouched.
- 8011af5: A `profiles/rules.json` overlay entry whose id matches a built-in rule now replaces it in place, so per-voice retuning of built-in patterns works; entries with new ids still append after the built-ins. A missing or malformed overlay still falls back to built-ins only.

### Patch Changes

- 9b82812: Dependency advisory sweep: mailparser 3.7.1 → 3.9.15 clears the linkify-it, nodemailer and mailparser XSS advisories; vitest, tsup and tsx also move. Remaining advisories need semver-major bumps and are left as they are: adm-zip (only opens the user's own export archives) and vitest 4.x (the suite never starts the UI/API server).
- e6f7a7e: `corpus/` and `profiles/` now resolve from the package root instead of the current directory, so every command works from anywhere; `HYPHOS_HOME` overrides the data root. Stage error hints now name the actual CLI commands.
- 2724145: Curate and salvage now exclude em-dash-carrying messages from the voice corpus, routing them to `corpus/ai-marked.jsonl` instead of quarantine; the salvage summary prints the live quarantine count.
- 30c481f: package.json now ships repository/homepage/bugs links pointing at the fleetorders GitHub org; the npm page gains a Repository link.
- a503948: Major bumps clear the remaining high-severity advisories: vitest 2.1.8 → 4.1.10 (dev-only) and adm-zip 0.5.16 → 0.6.0; adm-zip now bundles its own types, so the @types stub is dropped, and the central-directory entry order the ingest stage relies on is verified unchanged.
- 05e58d3: README status now matches what ships: the rewrite backend, fidelity score, blind self-tests and local web app are stated as working, with the genuinely open items named. The quick-start data-location note matches the package-root resolution.

## 0.1.0

### Minor Changes

- Initial release: corpus extraction and curation, register tagging, chat and email ingest, and stylometric fingerprints. The rewrite backend and the fidelity score are in progress.
