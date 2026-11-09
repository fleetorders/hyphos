---
"hyphos": patch
---

Dependency advisory sweep: source-map-js 1.2.1 → 1.2.2 (lockfile-only;
transitive via tsup → postcss, dev-only), clearing the high-severity
event-loop denial-of-service advisory via indexed source-map section
offsets (GHSA-68fv-2mgg-jv7q). Remaining advisories are unchanged and
previously adjudicated: vitest 4 major (@vitest/mocker file-read; the
suite never starts the UI/API server) and esbuild (dev-server file read
on Windows; within tsup's band the only offered "fix" is a downgrade
below the vulnerable range — audit theater, not a fix).
