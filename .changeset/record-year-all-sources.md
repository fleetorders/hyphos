---
"hyphos": minor
---

Build the `-pre2023` and `-recent` profiles for every source, not just mail.

Splitting a register by period is how a voice's drift over time becomes
visible, and it matters most where the corpus straddles a change in how you
write. The split was never meant to be a mail feature — but the year was read
by whitespace-splitting the timestamp and taking a four-digit token, which only
the RFC-5322 dates written by the mail ingest produce. Chat sources write epoch
milliseconds and the session sources write ISO-8601, so for all of them the
split silently did nothing and the sub-profiles were never built.

The year is now read from any of the three shapes: an ISO-8601 date, a bare
four-digit token, or an epoch in seconds or milliseconds. Chat and other
non-mail registers gain their period profiles on the next `fingerprint` run.
`recordYear` is exported for anyone building on the corpus format.
