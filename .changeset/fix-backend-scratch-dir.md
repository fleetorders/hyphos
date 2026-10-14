---
"hyphos": patch
---

Fix: the `claude` backend now runs from one fixed scratch directory instead of
minting a fresh temp folder per call. Agent harnesses file session transcripts
under a project folder named after the working directory, so a per-call folder
accumulated one transcript folder per call (thousands over time, with a
filesystem cost even outside the harness).
