---
"hyphos": minor
---

Put controls on the rewrite backend: no agency, and a checkable output
contract.

`claude -p` is an agent, not a completion endpoint. Started in the user's
project directory it loaded that project's instructions and the user's
settings, and it could act — asked to rewrite a paragraph it was observed
performing unrelated work on the machine and narrating that in place of the
rewrite. The CLI backend now runs with `--restricted` (no command-running
tools, and user, project and local settings ignored), with
`--permission-prompts none` so anything that would prompt is denied, and in an
empty working directory so no project instructions are found. The config
directory is deliberately left alone, because credentials live there. A CLI too
old to accept `--restricted` is refused rather than retried without it: falling
back would give exactly the behaviour the flags prevent.

The prompt now asks for the rewrite between two markers and forbids anything
outside them, and the reply is parsed for that block. A backend that answers
conversationally — a preamble, a note on what it changed, a suggestion — used
to have all of that pass through as if it were the rewritten text and into
whatever the user sent. It is now a loud failure instead. `extractRewrite` is
exported for anyone driving a backend of their own.
