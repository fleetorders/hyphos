---
"hyphos": patch
---

Dependency advisory sweep: mailparser 3.9.23 → 3.9.32, whose nodemailer
dependency moves 10.0.1 → 10.0.13 and clears the four nodemailer
advisories audit reported (addressparser quadratic backtracking DoS,
process-global DNS cache cross-tenant TLS disclosure, nested recipient
array stack exhaustion, quoted local-part envelope malformation).
adm-zip needs no change: 0.6.1 already clears everything open against
0.6.0. Remaining advisories are unchanged and previously adjudicated:
vitest 4 major (@vitest/mocker file-read; the suite never starts the
UI/API server) and esbuild (dev-server file read on Windows; within
tsup's band the only offered "fix" is a downgrade below the vulnerable
range — audit theater, not a fix).
