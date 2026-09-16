---
"hyphos": patch
---

Dependency advisory sweep: mailparser 3.9.15 → 3.9.23 (clears all four open
nodemailer highs — the addressparser quadratic-DoS pair, the domain
allow-list and recipient-domain validation bypasses, and the legacy
resolveContent() access-bypass — plus the deepmerge-ts stack-exhaustion
high, via html-to-text 10.0.1 now declaring deepmerge-ts ^8). Remaining
advisories are unchanged and previously adjudicated: vitest 4 major
(@vitest/mocker file-read; the suite never starts the UI/API server),
adm-zip (destination-symlink overwrite; here it only opens the user's own
export archives), and esbuild (dev-server file read on Windows; within tsup's ^0.27.0 the
only offered "fix" is a downgrade below the vulnerable band — audit
theater, not a fix).
