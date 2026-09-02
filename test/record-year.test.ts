import { describe, it, expect } from "vitest";
import { recordYear } from "../src/stages/fingerprint.js";

/**
 * The year buckets were never an email feature — but only the mail ingest wrote
 * a timestamp the year could be read from, so for every other source the split
 * silently did nothing. These cases pin each timestamp shape the corpus
 * actually contains.
 */

describe("the year of a record, whatever its timestamp shape", () => {
  it("reads an RFC-5322 date, as the mail ingest writes", () => {
    expect(recordYear("Thu, 13 Aug 2026 11:24:14 +0000")).toBe(2026);
  });

  it("reads epoch milliseconds, as the chat ingests write", () => {
    // 2021-02-05T15:34:13Z
    expect(recordYear("1612541653050")).toBe(2021);
  });

  it("reads epoch seconds too", () => {
    expect(recordYear("1612541653")).toBe(2021);
  });

  it("reads ISO-8601, as the session sources write", () => {
    expect(recordYear("2026-08-01T20:38:40.533Z")).toBe(2026);
    expect(recordYear("2024-05-06 07:08:09")).toBe(2024);
    expect(recordYear("2022-11")).toBe(2022);
  });

  it("returns nothing for a timestamp it cannot read", () => {
    expect(recordYear("")).toBeNull();
    expect(recordYear("last tuesday")).toBeNull();
    expect(recordYear("12345")).toBeNull();
  });

  it("does not mistake a long digit run for a year", () => {
    // Nine digits is neither epoch seconds nor milliseconds.
    expect(recordYear("123456789")).toBeNull();
  });
});
