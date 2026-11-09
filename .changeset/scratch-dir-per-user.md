---
"hyphos": patch
---

Fix: the `claude` backend's scratch directory is per-user and ownership-checked.
On Linux the system temp directory is shared by every user on the machine, so
the fixed guessable name could be pre-created or symlinked by another local
user — either breaking every rewrite call at the cleanup step, or pointing
the backend at a folder of theirs whose `CLAUDE.md` would be read as project
instructions. The directory now lives under the per-user runtime directory
(`XDG_RUNTIME_DIR`, with the user's cache directory as the fallback) on
Linux, is created owner-only, and is verified with `lstat` to be a real
folder owned by the current user before every call. macOS and Windows temp
directories are already per-user and keep the previous location.
