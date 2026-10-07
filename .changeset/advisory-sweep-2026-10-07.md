---
"hyphos": patch
---

Dependency advisory sweep: shell-quote 1.10.0 → 1.12.0 (lockfile-only;
transitive via @changesets/cli → launch-editor, dev-only), clearing the
critical-severity `quote()` command-injection advisory via a line
terminator in a token after a `{ comment }` token
(GHSA-pqg4-j6r4-53mv). The tree's other advisories are unchanged and
previously adjudicated: vitest 4 major (@vitest/mocker file-read; the
suite never starts the UI/API server), esbuild (dev-server file read on
Windows; within tsup's band the only offered "fix" is a downgrade below
the vulnerable range — audit theater, not a fix), and the
mailparser/nodemailer, adm-zip and source-map-js rows whose in-range
fixes already sit on review branches ahead of this base.
