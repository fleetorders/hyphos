# Design decisions

What was decided and why, for anyone changing the code. Code comments cite an entry as
`docs/decisions.md, D-003`. Numbers are stable; a gap is an entry deleted because it no
longer shapes the code.

### D-001 — Voice data is local-only by design

The corpus (your extracted writing) and the profiles derived from it live under `corpus/`
and `profiles/`, both gitignored. The tool never commits or logs their contents; the only
data that leaves the machine is the draft and the profile guidance sent to the rewrite
backend you chose (D-005).

**Why:** a person's collected writing is among the most sensitive data they own; it
carries identity, relationships and workplace context. A voice tool is trustworthy only if
its data stays local by construction, not by policy.

**Consequences:** no hosted features; every machine builds its own corpus; everything
tracked (code, docs) must make sense without the data.

### D-003 — Quirks are enforced after the model, as deterministic rules

Mechanical style habits (punctuation policy, banned words, casing, rhythm bounds) are
applied in a pass after the model, as hard rules, not as prompt instructions.

**Why:** language models smooth personal quirks toward generic polish, and style
instructions fade as context grows. A deterministic pass cannot be argued with; a prompt
can.

**Consequences:** the rewrite output may differ from the raw model output, and the list of
what enforcement changed is part of the result.

### D-004 — Non-English sources contribute rhythm, never vocabulary

Writing in other languages may enter the corpus as low-weight signal for register, rhythm
and punctuation habits, tagged as such. It is never mined for English word choice.

**Why:** traits like directness, sentence rhythm, punctuation and humour cadence carry
across languages; idiom and vocabulary do not. Mixing them degrades the profile.

### D-005 — The rewrite backend is subscription-first, API key second

Rewrite and judging calls go first to the locally installed `claude` CLI, which uses the
user's existing Claude subscription. A direct Anthropic API key (`ANTHROPIC_API_KEY`) is
the second backend, for headless or scripted use.

**Why:** the likeliest user already pays for a subscription; metered API spend should be
an option, never a prerequisite. Both backends run under credentials the user controls.

**Consequences:** the CLI detects an available `claude` binary and says clearly when
neither backend is present; per-call cost is reported only on the API path.

### D-006 — Output is clean by default; imperfections are opt-in and measured

Rewritten output is typo-free however typo-rich the corpus is. An opt-in feature may add
characteristic imperfections at the author's measured per-register rate, never invented
ones.

**Why:** corpus typos are register artefacts: they cluster in quick prompts and dictation,
not in text sent to people. Reproducing them by default would fake carelessness rather
than voice; typo rate is a property of the register, not of the person.

**Consequences:** fingerprints carry a per-register typo rate; `rewrite` has
`--typos natural|none`, defaulting to `none`.

### D-007 — Registers are discovered from data, never declared in code

The register list is whatever profile buckets exist with corpus behind them. Each register
is shown with a confidence derived from how much material backs it, and a low-confidence
register says how to improve it (add source material). An "auto" mode infers the register
from the draft by stylistic proximity, always showing the inference and its confidence and
letting the user override it. Local feedback (good / fine / bad, with a one-line reason on
bad) accumulates per register and surfaces suggestions once a pattern forms.

**Why:** hard-coded registers make the tool rigid exactly where voices differ most. A
register defined as "a folder of samples" lets users create new ones by supplying
material. Confidence shown honestly beats capability implied falsely, and the user's own
verdicts are the cheapest reliable improvement signal a local tool has.

**Consequences:** the web UI builds its tabs from `/api/registers` at load; `/api/infer`
ranks buckets by proximity; feedback lands in `corpus/feedback.jsonl` (local, like all
voice data).

### D-008 — Content adaptation is a rule registry, never ad-hoc prose rework

Every deterministic content-adaptation step is a declared rule (id, kind: remove, replace
or flag, pattern, and its own test cases), applied by one engine in listed order with a
per-rule report. `hyphos rules` lists them; `hyphos rules --test` checks every rule against
its cases plus whole-pipeline fixtures. Personal rules extend the list through
`profiles/rules.json`, with the same schema.

**Why:** transformations written as ad-hoc code grow into behaviour nobody can predict or
verify. Rules as data can be listed, tested one by one, and reported on.

**Consequences:** a new adaptation arrives as a rule with tests; a rule without tests
fails review.

### D-010 — An overlay rule with a built-in's id replaces it in place

An entry in `profiles/rules.json` whose id matches a built-in rule replaces that rule at
the same position, with its own replacement and tests. Entries with new ids are appended
after the built-ins.

**Why:** appending alone cannot retune a pattern a built-in rule already consumed: an
appended rule never sees text the built-ins rewrote before it.

### D-011 — The engine never rewrites a dash

The rules registry has no dash rewrites (such as an em-dash pair to parentheses, or a
single em-dash to a comma), and nothing replaces them. How a voice uses dashes is voice
data: the corpus curation already excludes em-dash-heavy text as a machine-writing marker,
and the fidelity pass scores `emdash_per_1k`.

**Why:** a blanket substitution reshapes drafts toward a join style the voice may barely
use. Where a dash must go, the replacement is chosen per instance (D-016).

### D-014 — The built-in banned-words list ships empty

The `banned` rule class is part of the engine, but its built-in word list is empty. The
personal overlay (`profiles/rules.json`, overriding the `banned-words` id) carries the
words a writer avoids in every register, and `profiles/<register>/banned.json` extends it
per register. Both are machine-local and gitignored.

**Why:** which words a writer avoids is a personal choice, not a machine-writing marker.
The engine is the product; the words are data.

### D-016 — Banned tokens are flagged by the engine and replaced per instance by the rewriter

The banned rule class has a token mode: `tokens` are literal marks matched case-sensitively
and without word boundaries, for marks that are not words (the em-dash, which `\b` can
never bracket). A writer who bans the em-dash (U+2014) and the en-dash (U+2013) used as a
dash lists them once in the register-independent overlay (`profiles/rules.json`), so every
register flags them. The deterministic pass counts them but never rewrites them (D-011);
the rewrite prompt asks the model to choose a replacement per instance: a colon, comma,
semicolon or new sentence, and "from X to Y" for a range.

**Why:** a ban without a counter cannot be enforced, and a counter with one blanket swap
produces text that fails the fidelity score anyway. Flagging is deterministic; choosing
the replacement is the model's job. Empty or missing patterns are inert, so the count
stays trustworthy.
