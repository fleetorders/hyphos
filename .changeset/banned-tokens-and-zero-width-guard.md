---
"hyphos": minor
---

The banned-words rule class gains a token mode: `tokens` are literal marks
matched without word boundaries — for tokens that are not words, like an
em-dash, which a word boundary can never bracket. Banned tokens are flagged
like banned words, never rewritten; the personal overlay carries them once,
register-independent, so every register counts them. Rule patterns that can
match the empty string — a missing `pattern` field, an empty word entry, a
zero-width regex like `x*` — are now inert instead of firing at every
position: such a rule reported the text's length plus one as its hit count
while leaving the text unchanged. `rules --test` carries guard cases that
pin both behaviors.
