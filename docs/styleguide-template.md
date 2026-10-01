# Style guide template

`hyphos rewrite` needs one style guide per register, at `profiles/<register>/styleguide.md`.
You write it by hand: copy this file there and replace each placeholder with what is true of
your own writing in that register. The whole file goes into the rewrite prompt, so keep it short
(one screen is plenty) and concrete. Cite a real line of yours for each claim where you can;
a quoted example steers the model better than a description.

`hyphos fingerprint` measures the numbers (sentence lengths, punctuation, openers); this guide
carries what a count cannot. Mechanical habits that must always hold (a punctuation policy,
banned words, casing) belong in the deterministic rules instead, because a model drifts from
them.

---

# <register> style guide

## Who is writing, to whom

<One or two sentences: the usual reader and the usual purpose of text in this register.>

## Recurring structures

- <How a message usually opens, e.g. "starts with the answer, no greeting".>
- <How points are ordered and how a message ends.>
- <Paragraph length and when lists appear.>

## Quirks to keep

- <A habit that is yours and must survive the rewrite.> Example: "<a real line of yours>"
- <Another one.>

## Anti-patterns

- <Something you never write in this register.>
- <A phrase or construction that marks text as not yours.>
