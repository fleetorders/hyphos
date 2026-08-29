---
"hyphos": minor
---

The deterministic enforcement pass gains a banned-words rule class: whole
words a voice never uses are flagged — never amputated, since mid-sentence
removal mangles meaning — wherever they appear. The built-in list ships
empty: which words a writer avoids is personal, so the personal overlay
(`profiles/rules.json`, overriding the `banned-words` id) fills it, and a
register extends it with a `profiles/<register>/banned.json` file (one word
per entry). `enforce --register`, `rewrite`, and the serve API apply the
register's list; `rules --test` covers the new rule class.
