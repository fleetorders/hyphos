---
"hyphos": minor
---

The claude-CLI model backend is an agentic tool, and an agent asked to
rewrite text can decide to route that prose through hyphos itself —
re-invoking the tool on its own input and recursing until the spawn
timeout. The backend child is now marked and constrained: it runs with no
tools and no session persistence, a one-line backend role appended to its
system prompt, and a `HYPHOS_BACKEND=1` marker in its environment under
which the hyphos CLI refuses to start, exiting immediately with a message
that tells the caller to rewrite the text directly in its reply. When
every model backend fails, `rewrite` and `score --judge` now name each
backend's own error instead of only the last one, so a claude-CLI timeout
is no longer hidden behind an API-key error.
