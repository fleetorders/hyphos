---
"hyphos": minor
---

The deterministic enforcement pass gains a banned-words rule class: words the
voice never uses are flagged — never amputated, since mid-sentence removal
mangles meaning — wherever they appear. The built-in list is seeded with
"sidecar". A register extends it with a `profiles/<register>/banned.json`
file (one word per entry): `enforce --register` and `rewrite` apply the
register's list, and `rules --test` covers the new rule class.
