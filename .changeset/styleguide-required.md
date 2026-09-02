---
"hyphos": minor
---

Refuse to rewrite a register that has no style guide, instead of quietly
rewriting in nobody's voice.

A register needs two things: a fingerprint, which measures a draft, and a
distilled style guide, which describes the voice to write in. Only the first is
produced by the pipeline, so a freshly fingerprinted register has one and not
the other. `buildPrompt` used to omit the style-guide section when the file was
absent — the prompt still formed, the model still answered, and the result was
simply not in the author's voice, with nothing anywhere to say why. `judge` was
worse: it substituted the literal string `(missing)` for the guide and returned
confident scores against it.

Both now raise `SysExit` naming the register. Scoring is unaffected, because a
fingerprint is all a score needs.

`RegisterInfo` gains a `rewritable` field, so a listing can distinguish a
register that can be written in from one that can only be measured against, and
a register missing its guide now carries a hint saying exactly that.
