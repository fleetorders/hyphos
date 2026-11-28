---
"hyphos": minor
---

New `hyphos reference` stage: rebuilds a pre-agent-era reference corpus from the dated sources in `corpus/` (mail, the reviewed owner-only chat set, editorial-tagged records), excluding everything dated in the agent era (default 2023, matching the fingerprint stage's period split), everything undated, em-dash-marked text and near-duplicate compositions, and records the exclusion rule, date ranges and per-register counts into `corpus/reference-pre-agent/provenance.json` and `PROVENANCE.md`. A profile built from the reference corpus states what it stands on instead of learning the drafting agent's habits from recent text.
