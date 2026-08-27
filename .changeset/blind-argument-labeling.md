---
"hyphos": minor
---

`blind` now runs the argument-level labeling loop from the argument-shape
research note: items are whole replies (25–180 words, `--unit paragraph` for
per-paragraph items) instead of line snippets, each y/n judgment is followed
by fixed reason codes plus an optional one-line note, and every judgment is
appended to `corpus/feedback.jsonl` as a `kind: "blind-arg"` record —
immediately, so an interrupted session still banks its labels. Units are
keyed by `sha256` of their normalized text and never re-asked; when the
unseen pool cannot fill a 12-item session (6 real + 6 generated) the command
says so and stops rather than recycling. Sessions end with the discrimination
rate and a reason histogram. The `-n` flag is gone — the session size is the
ten-minute budget's fixed arithmetic. Also fixes non-TTY stdin: sequential
`rl.question` calls dropped buffered lines, so piped or pasted-ahead answers
deadlocked the loop after the first item; the loop now feeds one `line`
handler through a queue and ends gracefully on stdin EOF.
