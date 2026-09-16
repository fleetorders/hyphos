---
"hyphos": minor
---

Guard the rewrite backend against recursion, and name every backend's own
failure.

The claude-CLI backend child now carries `HYPHOS_BACKEND=1`, and the CLI entry
refuses to start under that marker, exiting immediately with a message that
teaches the caller to rewrite the text directly in its reply. The spawn flags
already strip the backend's agency, but a flag's meaning can drift as the CLI
updates under a fixed name, and a user's global agent instructions may route
prose through this tool — an unguarded backend call could recurse, the child
re-invoking hyphos on its own input until the spawn timeout. The guard kills
that class backend-agnostically: whatever the backend model decides, the
nested hyphos refuses fast.

When every backend fails, `rewrite` and `score --judge` now report each
backend's own error instead of only the last one. A claude-CLI timeout hidden
behind an api-key error once cost a whole diagnosis: with `--backend auto` the
message used to name only the missing `ANTHROPIC_API_KEY`, silently dropping
the failure that actually mattered.
