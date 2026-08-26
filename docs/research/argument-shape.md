# Research: the AI tell that lives above the sentence

Status: research note with a dry run. No shipped feature; nothing here
changes `rewrite`, `score`, or `rules.ts`.

## The problem

Four machine-rewritten reply drafts scored clean on every existing
surface metric — zero model-ism signals, zero em-dashes, comma rate inside
the register's published range — and a human reader still called them
generated on sight. The complaint was not tone or word choice but _"the way
you're structuring your argumentation line."_ Read side by side, all four
ran the same skeleton: validate the other party's point, restate it more
precisely than they had, give the mechanism, close on an honest limit or a
named abstraction.

Every metric in `score` operates at or below sentence level. Two things
above that line are candidates for measurement: the _discourse moves_ a
text is built from, and the _uniformity of those moves across a batch_
written in one pass. Any one of the four drafts passes as human; four in a
row with the same architecture do not. No part of the tool currently looks
at more than one text at a time.

## Candidate metrics

Each definition is computable from plain text with a regex/cue classifier.
"M" below means the classification layer, not a shipped scorer. Sentence
splitting reuses `sentencesOf`'s rule (blank line is a boundary; `.!?`
split, delimiter consumed — so question detection must check the raw text's
terminal character, not the split segment).

**Move classes (sentence-level, the base layer).** Classify each sentence
into at most one move, first match wins, collapsing consecutive repeats:

| class | move               | operative cues (regex, case-insensitive)                                                                                                                                              |
| ----- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `V`   | validate / concede | `\b(agreed\|yes,\|fair enough\|to be fair\|good point\|easy half\|smaller version\|you('re\| are) right\|that('s\| is) (right\|fair)\|i('m\| am) afraid)\b`                           |
| `L`   | honest limit       | `\b(i (do\|don\|have\|haven)t? ?(n[o']?t\|know\|have\|costed\|measured\|counted\|tested)\|no idea\|not (costed\|measured\|counted\|tested\|sure)\|untested)\b`                        |
| `M`   | mechanism          | `\b(because\|so that\|which means\|that means\|so (the\|accepted\|the definition\|the thing)\|when …,\|if …,\|every … carries\|what (nothing\|no one\|kept))\b`                       |
| `A`   | anchor / restate   | sentence opens `(the\|that\|those\|these\|your\|it\|they\|four\|both\|all)`, or contains `\b(already\|the bigger\|the easy\|the durable\|the part worth)\b` within the first 40 chars |
| `Q`   | question           | raw sentence ends `?` (checked before splitting consumes it)                                                                                                                          |
| `.`   | none of the above  |                                                                                                                                                                                       |

A text's **signature** is its collapsed move string (`VMAL`, `AM`,
`AMA.MV.LQ`). Rates are per-1000-words counts of each class.

_How it could be fooled:_ the cues are lexical proxies for functional
moves. A draft that validates without concession vocabulary ("there is a
smaller version of that in the tree already" scores `V` only via the
"smaller version" cue) or explains without "because" is undercounted. A
writer who genuinely argues by concession-and-mechanism is overcounted.
The classifier cannot see the interlocutor's text, so "restate more
precisely" is proxied by anaphoric openers — it measures addressivity, not
precision. These are exactly the errors the labeling loop (below) exists
to calibrate away.

**Opening-move class** — the `V`/`A`/`M`/`Q`/other class of the first
sentence. _Fooled by:_ same lexical-proxy caveat; also by simply moving the
concession into sentence two.

**Concession-pivot density** — per-1k count of
`\b(agreed|yes|true|fair|granted|right)[,;] (and|but|though)\b` plus
"you're right", "I'm afraid", "to be fair". _Fooled by:_ pivoting without
the pivot words ("Agreed. However…").

**Antithesis rate** — per-1k sentences matching
`\bnot\b[^.!?]{2,60}\bbut\b` or `neither…nor`. _Fooled by:_ contrast
carried by verbs ("understates where it matters") or reordered ("but" first).

**Tricolon rate** — per-1k sentences matching
`\b[\w'-]+( [\w'-]+)?, [\w'-]+( [\w'-]+)?, (and|or) [\w'-]+`. _Fooled by:_
four-item lists, semicolon lists, lists split across sentences.

**Closing-move class** — `Q` / `L` / other on the final sentence.
_Fooled by:_ closing on a named abstraction, which has no reliable lexical
surface — this class under-reports exactly the "wall to walk around" close
the finding named.

**Paragraph count and length variance** — count of blank-line-separated
paragraphs; coefficient of variation of paragraph word counts.
_Fooled by:_ honest writers who also write one even block.

**Batch uniformity** — the new idea; needs a per-batch rather than
per-text computation. Two operationalizations, and they behave very
differently (see dry run):

1. _Identity form_: fraction of text pairs in a batch with identical
   signatures. Degenerate when one class dominates the pool — with coarse
   classes nearly every corpus batch is "uniform", and the metric inverts.
2. _Presence form_: fraction of texts in the batch that contain at least
   one `V` and one `M` (the skeleton's load-bearing moves). Measures
   "every reply in this run carries the same skeleton", which is what
   four-in-a-row actually showed.

_Fooled by:_ a generator that varies which replies get the full skeleton;
and identity-form by any class-dominance in the reference pool.

## Dry run

**Sets.** Four rewritten reply drafts (26–176 words) against 192
editorial-register corpus samples in the same length band (25–180 words —
`blind`'s filter, widened). Pool and drafts are genre-adjacent, not
genre-identical: the corpus samples are replies written to an assistant,
the drafts are replies written to strangers. Same author, same register.

**Method.** The cue classifier above, applied per sentence; rates per
1k words; bootstrap of 5,000 random 4-text corpus batches for the batch
metrics. The script reads only its two inputs and prints aggregates; it is
not committed, since it hardcodes local corpus paths — the cue tables here
are the complete definition.

**Results (drafts vs pool of 192):**

| metric                                 | drafts                          | pool                   | separation                                                                    |
| -------------------------------------- | ------------------------------- | ---------------------- | ----------------------------------------------------------------------------- |
| `V` rate ≥ 5.7/1k                      | 3 of 4                          | 3 of 192 (mean 0.18)   | **hard** — no pool text reaches the drafts' max                               |
| `M` rate ≥ 11.4/1k                     | 3 of 4                          | 11 of 192 (mean 1.63)  | **hard** — 0 of 192 above drafts' max                                         |
| `V`>0 and `M`>0 in one text            | 2 of 4                          | **0 of 192**           | **hardest single cut**                                                        |
| `V`>0 or `M`>0                         | 4 of 4                          | 29 of 192              | every draft carries skeleton moves; 1 in 7 corpus texts                       |
| `L` rate ≥ 5.7/1k                      | 2 of 4                          | 31 of 192              | moderate                                                                      |
| antithesis, tricolon, concession-pivot | 0 in all drafts                 | nonzero tails          | **null** — drafts had none; absence is not a tell here                        |
| paragraph length CV                    | ~0 in 3 of 4                    | mean 0.22; 61% also 0  | **null**                                                                      |
| signature identity (batch)             | all 4 distinct; tail-share 0.00 | corpus-batch mean 0.16 | **null, inverted** — corpus batches are _more_ identical under coarse classes |
| question move present                  | 1 of 4                          | 60 of 192              | null                                                                          |

**Reading, honestly.** The dry run did not confirm the naive form of the
uniformity idea and did confirm a better one. Exact-signature uniformity
fails — the four drafts do not share literal move strings, and coarse
classes make corpus batches look _more_ uniform than the drafts. What
separates is **skeleton saturation**: concede-validate and mechanism
moves at rates the author's own editorial writing essentially never
reaches, present in every draft of the batch (4/4 carry at least one;
2/4 carry both together, against zero of 192 corpus texts). The tell is
rate elevation plus batch-wide presence, not sequence identity.

Three reasons this is not yet a finding to build on:

1. **The classifier was written after reading the four flagged drafts.**
   The cue lists encode what those drafts did; the separation may be an
   artifact of that circularity. This is the dry run's central caveat and
   the reason the labeling loop below is the prerequisite, not the
   follow-up.
2. **n = 4, one register, genre-adjacent pool.** A comment-thread corpus
   would be the matched comparison.
3. **The nulls are load-bearing.** Antithesis, tricolon, concession-pivot
   and paragraph variance show nothing on this sample; if the eventual
   labeled data also leaves them flat, they should be dropped rather than
   kept as cargo.

## Design: the labeling loop

`blind` already has the right shape at line level — shuffle real corpus
snippets with generated ones, ask which are the author's, report the
discrimination rate. The extension moves the unit up and captures _why_.

**Unit.** Whole replies (25–180 words) by default; `--unit paragraph` as
the fallback for long texts. The tell was visible in the reply alone, so
the parent comment is not shown in v1 (it doubles reading time; revisit if
labels say the judgment needs context).

**The reason codes.** After each y/n, one or more fixed codes, then
optional free text (one line). Fixed list, seeded from the finding and
prunable by the data: `open-validate`, `restate-precise`, `mechanism-run`,
`close-honest-limit`, `close-aphorism`, `para-uniform`, `tricolon`,
`antithesis`, `too-balanced`, `vocabulary`, `rhythm`, `other`.

**Session arithmetic (the ten-minute constraint).** Per item: read the
reply (~15 s), y/n (~5 s), reason codes (~10 s), optional free text (~10 s,
skip freely) → ~40 s/item. A session of **12 items** (6 real + 6 generated,
shuffled) lands at ~8 minutes plus a wrap-up line: discrimination rate and
a reason histogram. Sessions are repeatable and never re-ask: every item
is keyed by `sha256` of its normalized text, and the sampler excludes keys
already present in the store. When the unseen pool runs dry the command
says so and stops rather than recycling judgments.

**Storage.** Append-only, in the existing `corpus/feedback.jsonl` (the
store `serve record_feedback` already writes), one record per judged item:

```json
{
  "ts": "...",
  "register": "editorial",
  "kind": "blind-arg",
  "unit_hash": "sha256:...",
  "verdict": "mine",
  "was_real": true,
  "reasons": ["mechanism-run"],
  "note": "..."
}
```

`was_real` + `verdict` give the discrimination rate; `reasons` on
false-positive generated items (judged "mine") and false-negative real
ones are the labeled data the metric layer needs — each reason code is a
candidate feature whose corpus base rate the dry-run machinery can then
measure without circularity, because the codes come from the reader, not
from the drafts.

**Why the loop comes first.** Every caveat in the dry run reduces to "the
features were chosen by the same process that wrote the drafts." Ten
minutes of the author's judgment per session breaks that circle; nothing
else in this document does.

## What this implies for `rules.ts` (nothing, for now)

The restriction holds and the dry run supports it: the signal lives in
rates and batch composition, not in substitutable strings. A regex
substitution pass cannot lower a `V` rate without deleting the concessions
outright — which mangles meaning. Structure belongs in a measurement layer
fed by labeled reasons, and in `rewrite`'s prompt only after that layer
says which moves to vary.

## Next step

Build the labeling loop (the `blind` extension above) — it is the
prerequisite for trusting any structural metric, and it produces data even
if every metric in this note dies. The structural scorer is the entry
after that.
