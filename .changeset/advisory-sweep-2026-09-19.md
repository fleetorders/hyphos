---
"hyphos": patch
---

Dependency advisory sweep: adm-zip 0.6.0 → 0.6.1 (clears both open
advisories — the uncontrolled memory allocation via the declared
uncompressed size, and the destination-symlink overwrite previously
adjudicated as accepted-risk pending an in-range fix, which 0.6.1 now
is). Remaining advisories are unchanged and previously adjudicated:
vitest 4 major (@vitest/mocker file-read; the suite never starts the
UI/API server) and esbuild (dev-server file read on Windows; within
tsup's ^0.27.0 the only offered "fix" is a downgrade below the
vulnerable band — audit theater, not a fix).
