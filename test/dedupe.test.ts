import { describe, it, expect } from "vitest";
import {
  dropNearDuplicates,
  shingles,
  DEDUP_MIN_WORDS,
} from "../src/lib/dedupe.js";

/**
 * The two guards are the whole point of this primitive: a length floor, so
 * repeated acknowledgements survive, and Jaccard rather than containment, so a
 * short message quoted inside a long one is not mistaken for a copy of it.
 */

interface Rec {
  text: string;
  words: number;
}
const rec = (text: string): Rec => ({
  text,
  words: text.split(/\s+/).filter(Boolean).length,
});
const run = (items: Rec[]) =>
  dropNearDuplicates(
    items,
    (r) => r.text,
    (r) => r.words,
  );

const LETTER =
  "I am writing about the scope of the work we discussed on the call and the " +
  "timeline that follows from it, which I would like to confirm before " +
  "anything else is committed to the plan for the coming quarter";

describe("dropNearDuplicates", () => {
  it("keeps one copy of a composition that was sent several times", () => {
    const { kept, removed } = run([rec(LETTER), rec(LETTER), rec(LETTER)]);
    expect(kept).toHaveLength(1);
    expect(removed).toBe(2);
  });

  it("keeps the fullest copy, not the first one seen", () => {
    const full = rec(LETTER + " and one further point about the budget");
    const { kept } = run([rec(LETTER), full]);
    expect(kept).toHaveLength(1);
    expect(kept[0]!.words).toBe(full.words);
  });

  it("preserves the order of what it keeps", () => {
    const a = rec("first distinct message with quite a few words in it here");
    const b = rec(LETTER);
    const c = rec("third distinct message with quite a few words in it here");
    const { kept } = run([a, b, rec(LETTER), c]);
    expect(kept.map((r) => r.text)).toEqual([a.text, b.text, c.text]);
  });

  it("leaves distinct compositions alone", () => {
    const { kept, removed } = run([
      rec(LETTER),
      rec(
        "an entirely different message about the release train and the cadence " +
          "we want for it over the next couple of months, nothing to do with scope",
      ),
    ]);
    expect(kept).toHaveLength(2);
    expect(removed).toBe(0);
  });

  it("never touches messages below the floor — repetition there is the voice", () => {
    const items = Array.from({ length: 6 }, () => rec("ok will do"));
    const { kept, removed } = run(items);
    expect(kept).toHaveLength(6);
    expect(removed).toBe(0);
    expect(items[0]!.words).toBeLessThan(DEDUP_MIN_WORDS);
  });

  it("does NOT delete a short message merely quoted inside a long one", () => {
    // The bug this rule was rewritten to prevent. Containment scores the short
    // text 1.0 against the long one; Jaccard does not, because the long text
    // has far more runs the short one lacks.
    const quoted = rec(
      "the timeline that follows from it, which I would like to confirm before " +
        "anything else is committed",
    );
    const containing = rec(
      LETTER +
        " " +
        "There are several further considerations that bear on this decision, " +
        "including the staffing available in the period, the dependencies that " +
        "have not yet been resolved, and the question of who signs it off.",
    );
    const { kept, removed } = run([containing, quoted]);
    expect(removed).toBe(0);
    expect(kept).toHaveLength(2);
  });

  it("reports the words carried by what it removed", () => {
    const { removedWords } = run([rec(LETTER), rec(LETTER)]);
    expect(removedWords).toBe(rec(LETTER).words);
  });

  it("handles an empty input and a single record", () => {
    expect(run([]).kept).toHaveLength(0);
    expect(run([rec(LETTER)]).kept).toHaveLength(1);
  });
});

describe("shingles", () => {
  it("produces overlapping five-word runs, case and punctuation folded", () => {
    expect([...shingles("One two three four five six")]).toEqual([
      "one two three four five",
      "two three four five six",
    ]);
    expect(shingles("One, two! three? four. five")).toEqual(
      shingles("one two three four five"),
    );
  });

  it("is empty for a text shorter than one run", () => {
    expect(shingles("one two three four").size).toBe(0);
  });
});
