# hyphos

<div align="center">
  <img src="https://raw.githubusercontent.com/fleetorders/hyphos/main/media/hyphos-logo.png" width="520" alt="hyphos — a pen nib tracing a personal signature waveform, the shape of one writer's voice">
  <p>
    <a href="https://www.npmjs.com/package/hyphos"><img src="https://img.shields.io/npm/v/hyphos.svg?label=npm&color=cb3837" alt="npm version"></a>
    <a href="https://github.com/fleetorders/hyphos/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/fleetorders/hyphos/ci.yml?branch=main&label=CI" alt="CI"></a>
    <a href="https://github.com/fleetorders/hyphos/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-green" alt="MIT license"></a>
  </p>
</div>

_ύφος — Greek for the style and tone of one's expression._

Rewrite any AI draft so it reads as written by **you**. hyphos builds
register-aware voice profiles from your own writing — chat transcripts, exports,
posts — preserves your quirk-level habits with enforcement rules a model can't
drift away from, and scores every output for how much it actually sounds like you.

**Status: working end to end, with named rough edges.** The corpus pipeline —
extraction, curation, register tagging, chat/email ingest, stylometric
fingerprints — and the output side both run today: `rewrite` (a model pass
over your own claude CLI or Anthropic API credentials, then the deterministic
enforcement pass), `score` (the model-free fidelity v1, plus the model-judged
half via `score --judge`), `blind` self-tests, and the local web app
(`serve`). Still open: score calibration and email quote-fragment cleanup; see
the [roadmap](#roadmap).

## What it does

- **Voice profiles, per register** — you don't have one voice; you have modes
  (technical, informal, editorial). hyphos profiles each: a stylometric
  fingerprint (sentence lengths, punctuation habits, openers, rhythm) plus a
  style guide with your quirks and anti-patterns, which you write from
  [the template](https://github.com/fleetorders/hyphos/blob/main/docs/styleguide-template.md).
- **Rewrite** — feed it any AI-generated draft and a target register; it rewrites
  the draft in your voice.
- **Hard quirk enforcement** — mechanical habits (punctuation policy, banned
  words, casing) are applied _after_ the model as deterministic rules, because
  models normalize personal quirks away and drift from style instructions as
  context grows.
- **A fidelity score** — every output gets a "how-much-like-you" number
  (stylometric match plus a judge rubric), checked by blind self-tests; its
  calibration is still open.

## Quick start

```sh
npx hyphos extract            # extract your own messages from local transcripts
npx hyphos fingerprint        # compute stylometric fingerprints per register
npx hyphos rules --test       # self-test the deterministic enforcement rules
```

Before `rewrite` works for a register, write its style guide by hand: copy
[docs/styleguide-template.md](https://github.com/fleetorders/hyphos/blob/main/docs/styleguide-template.md) to
`profiles/<register>/styleguide.md` and fill it in. A register without one can
be scored but not rewritten.

Corpus output lands in `corpus/` and profiles in `profiles/` under the
package root (resolved from the CLI's own location, so commands work from any
directory). The published package ships no `profiles/`, so when the package
root carries none, a current working directory inside a hyphos checkout wins —
`npx hyphos rewrite` run from your checkout uses your profiles, and prints the
profiles dir it used. Point `HYPHOS_HOME` at another location to relocate
both, or `HYPHOS_CORPUS` / `HYPHOS_PROFILES` to override one.
`HYPHOS_BACKEND` is reserved for hyphos's own internal use; a hyphos started
under it refuses to run, so never set it yourself. Stdout
prints aggregate numbers only — never your text — so it is safe to share.

## Non-English writing

Writing in another language (including Greeklish — Greek written in Latin
characters) contributes rhythm, register and punctuation habits, tagged as such.
It is never mined for word choice and never transliterated.

## Privacy by design

Your corpus and profiles stay on your machine: `corpus/` and `profiles/` are
gitignored and never uploaded. The one thing that leaves it is a rewrite or judge
call: the draft and the profile's style guidance go to the backend you chose (your
`claude` CLI or your Anthropic API key), under your own credentials.

## Development

```sh
npm install
npm test          # unit tests
npm run build     # bundle to dist/ (the published CLI)
```

The git hooks under `.githooks/` and the `.etymd/` config come from
[etymd](https://www.npmjs.com/package/etymd) and do nothing where it is not installed;
`.githooks/*.local` runs a gitignored `local/` directory for machine-specific checks.
The design record is [docs/decisions.md](docs/decisions.md).

## Roadmap

- Score calibration: tie the fidelity number to blind-test verdicts.
- Email ingest: remove the remaining quoted-reply fragments.
- A command that drafts a register's style guide from your corpus, for you to edit.
- More output registers and per-audience presets.
- Era-weighted profiles, with text written before AI assistants as the anchor.

## License

[MIT](LICENSE)
