/**
 * Stage 0 — ingest chat exports (Meta/Instagram JSON) as corpus material.
 *
 * Reads `corpus/inbox/*.zip` archives holding Meta-style message threads
 * (`.../inbox/<thread>/message_*.json` with `participants` and `messages`
 * carrying `sender_name`, `timestamp_ms`, `content`), plus bare
 * `message_*.json` files dropped directly into the inbox.
 *
 * Authorship is structural: the owner is the one participant present across
 * (nearly) all threads — DMs always include you. Override with CHAT_OWNER_NAME
 * when the heuristic is not enough. Only the owner's messages are ever kept.
 *
 * Two Meta quirks are handled:
 * - The mojibake: Meta writes UTF-8 bytes escaped as latin-1, so Greek (and
 *   emoji) arrive double-encoded. Undone per string via the shared `demojibake`.
 * - Reactions/system rows have no `content` — skipped.
 *
 * Messages are language-tagged per chunk (`splitByLang`): English feeds the
 * voice corpus; Greek and greeklish stay rhythm-signal. Writes
 * `corpus/chat-<source>.jsonl`. Stdout reports aggregates only — never names or
 * message content (privacy invariant).
 */
import fs from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";
import { Counter } from "../lib/counter.js";
import { demojibake, whitespaceSplit } from "../lib/text.js";
import { splitByLang, type Lang } from "../lib/lang.js";
import { corpusDir } from "../lib/paths.js";
import { dropNearDuplicateLines } from "../lib/dedupe.js";

// A URL: the scheme, then a run of non-whitespace.
const URL_RE = /https?:\/\/\S+/gu;
// A Meta thread file inside a zip: `.../(inbox|messages)/<thread>/message_<n>.json`.
const ENTRY_RE = /(inbox|messages)\/.+\/message_\d+\.json$/;
// Bare thread files dropped directly in the inbox.
const BARE_FILE_RE = /^message_.*\.json$/;

// Export archives arrive date-and-hash-stamped (facebook-<user>-<date>-<id>); the
// platform is the stable identity, so a future export refreshes the same corpus
// file and profile bucket instead of spawning a new date-stamped one.
const PLATFORMS = [
  "facebook",
  "instagram",
  "messenger",
  "whatsapp",
  "telegram",
] as const;

function sourceName(stem: string): string {
  const low = stem.toLowerCase();
  for (const p of PLATFORMS) {
    if (low.startsWith(p)) return p;
  }
  return stem;
}

/** The filename with its final suffix removed. */
function zipStem(name: string): string {
  const ext = path.extname(name);
  return ext ? name.slice(0, name.length - ext.length) : name;
}

type ThreadEntry = [string, Record<string, unknown>];

/**
 * Yield `[source, thread]` for every Meta message file found, in a fixed
 * order: all `*.zip` archives first (sorted by name), then bare `message_*.json`
 * files (sorted). Within a zip, entries are visited in stored (central-directory)
 * order — adm-zip otherwise sorts on write, and `noSort` disables that.
 *
 * The archive open is deliberately UNGUARDED: a corrupt or
 * non-zip `*.zip` file raises and aborts the run rather than being silently
 * skipped. Only the per-entry read + JSON parse is guarded (bad entry → skip).
 */
function iterThreads(inbox: string): ThreadEntry[] {
  const out: ThreadEntry[] = [];
  // A missing directory yields no entries (no error).
  if (!fs.existsSync(inbox)) return out;
  const names = fs.readdirSync(inbox);

  const zips = names.filter((n) => n.endsWith(".zip")).sort();
  for (const zname of zips) {
    const zip = new AdmZip(path.join(inbox, zname), { noSort: true });
    const matching = zip.getEntries().filter((e) => ENTRY_RE.test(e.entryName));
    if (matching.length === 0) continue;
    const src = sourceName(zipStem(zname));
    for (const e of matching) {
      try {
        out.push([src, JSON.parse(e.getData().toString("utf8"))]);
      } catch {
        continue;
      }
    }
  }

  const bare = names.filter((n) => BARE_FILE_RE.test(n)).sort();
  for (const fname of bare) {
    try {
      out.push([
        "chat",
        JSON.parse(fs.readFileSync(path.join(inbox, fname), "utf8")),
      ]);
    } catch {
      continue;
    }
  }
  return out;
}

/**
 * Serialize one JSONL record in the canonical corpus line format: a SPACE
 * after every comma and colon.
 *
 * FORMAT NOTE: a bare `JSON.stringify(obj)` emits none of those spaces, so the
 * line is assembled with the fixed separators and key order (ts, source, lang,
 * words, text). Each value still goes through `JSON.stringify`, whose string
 * escaping (short control-char forms like \n/\t, literal non-ASCII, escaped
 * `"` and `\`) is the format's own. Numbers/`null` likewise render in their
 * usual form for integer timestamps and word counts.
 */
function jsonlLine(
  ts: unknown,
  source: string,
  lang: string,
  words: number,
  text: string,
): string {
  const tsJson = JSON.stringify(ts ?? null); // undefined → null
  return (
    `{"ts": ${tsJson}, "source": ${JSON.stringify(source)}, ` +
    `"lang": ${JSON.stringify(lang)}, "words": ${words}, ` +
    `"text": ${JSON.stringify(text)}}`
  );
}

export function runIngestChat(argv: string[]): number {
  void argv; // accepted for CLI uniformity; the stage takes no arguments.

  const corpus = corpusDir();
  const inbox = path.join(corpus, "inbox");
  const threads = iterThreads(inbox);
  if (threads.length === 0) {
    process.stdout.write(
      "no chat exports found in corpus/inbox/ — nothing to do\n",
    );
    return 0;
  }

  // Owner detection: the sender appearing in the most distinct threads. Insertion
  // order into the counter decides the (rare) count tie, matching Counter.
  const presence = new Counter<string>();
  for (const [, t] of threads) {
    const messages = (t["messages"] as unknown[] | undefined) ?? [];
    const senders = new Set<string>();
    for (const mu of messages) {
      const m = mu as Record<string, unknown>;
      const sn = m["sender_name"];
      if (sn) senders.add(demojibake(sn as string));
    }
    for (const s of senders) presence.add(s);
  }
  const owner =
    process.env.CHAT_OWNER_NAME ||
    (presence.size ? presence.mostCommon(1)[0]![0] : "");
  process.stdout.write(
    `owner detected: present in ${presence.get(owner)}/${threads.length} ` +
      `threads (override with CHAT_OWNER_NAME)\n`,
  );

  // Lines are buffered per source and written once at the end: a duplicate
  // can only be recognised against the rest of the source, and a source with
  // no kept messages still leaves an empty chat-<source>.jsonl behind.
  const bySource = new Map<string, string[]>();
  let kept = 0;
  const wordsByLang = new Map<Lang, number>();
  let droppedOthers = 0;

  for (const [source, t] of threads) {
    let buf = bySource.get(source);
    if (buf === undefined) {
      buf = [];
      bySource.set(source, buf);
    }
    const messages = (t["messages"] as unknown[] | undefined) ?? [];
    for (const mu of messages) {
      const m = mu as Record<string, unknown>;
      if (
        demojibake((m["sender_name"] as string | null | undefined) ?? "") !==
        owner
      ) {
        droppedOthers++;
        continue;
      }
      let text = demojibake(
        ((m["content"] as string | null | undefined) ?? "") || "",
      ).trim();
      text = text.replace(URL_RE, " ").trim();
      if (whitespaceSplit(text).length < 3) continue;
      for (const [lang, chunk] of splitByLang(text)) {
        const words = whitespaceSplit(chunk).length;
        buf.push(
          jsonlLine(m["timestamp_ms"], `chat:${source}`, lang, words, chunk) +
            "\n",
        );
        wordsByLang.set(lang, (wordsByLang.get(lang) ?? 0) + words);
      }
    }
  }

  let deduped = 0;
  for (const [source, buf] of bySource) {
    const r = dropNearDuplicateLines(buf);
    deduped += r.removed;
    kept += r.kept.length;
    fs.writeFileSync(
      path.join(corpus, `chat-${source}.jsonl`),
      r.kept.join(""),
    );
  }

  process.stdout.write(
    `kept: ${kept} messages (owner only; ${droppedOthers} others dropped, ` +
      `${deduped} duplicates)\n`,
  );
  // By language tag, in code-point order.
  const langs = [...wordsByLang.keys()].sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  for (const lang of langs) {
    process.stdout.write(`  ${lang}: ${wordsByLang.get(lang)} words\n`);
  }
  return 0;
}
