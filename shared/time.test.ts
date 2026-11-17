import { afterEach, describe, expect, it } from "vitest";
import { addHours, asInstant, hoursBetween, instant, isTimeZone, readTime, type Instant } from "./time.ts";

const at = (text: string) => {
  const reading = readTime(text, "reject");
  if (!reading.ok) throw new Error(`${text}: ${reading.why}`);
  return reading.at;
};

describe("readTime", () => {
  it("reads a time with Z or an offset whatever the rule", () => {
    for (const rule of ["reject", { zone: "Asia/Tokyo" }] as const) {
      expect(readTime("2026-11-17T15:00:00Z", rule)).toEqual({ ok: true, at: "2026-11-17T15:00:00.000Z" });
      expect(readTime("2026-11-17 09:00-06:00", rule)).toEqual({ ok: true, at: "2026-11-17T15:00:00.000Z" });
      expect(readTime("2026-11-17T20:30+0530", rule)).toEqual({ ok: true, at: "2026-11-17T15:00:00.000Z" });
    }
  });

  it("reads 'YYYY-MM-DD HH:MM' in the rule's zone, including the hours around a DST change", () => {
    const chicago = { zone: "America/Chicago" };
    expect(readTime("2026-11-17 09:00", chicago)).toEqual({ ok: true, at: "2026-11-17T15:00:00.000Z" });
    expect(readTime("2026-07-01T09:00:30", chicago)).toEqual({ ok: true, at: "2026-07-01T14:00:30.000Z" });
    // Spring forward (8 Mar 2026): 01:59 is still CST, 03:00 is CDT, and the skipped 02:30 reads as 03:30 CDT.
    expect(readTime("2026-03-08 01:59", chicago)).toEqual({ ok: true, at: "2026-03-08T07:59:00.000Z" });
    expect(readTime("2026-03-08 03:00", chicago)).toEqual({ ok: true, at: "2026-03-08T08:00:00.000Z" });
    expect(readTime("2026-03-08 02:30", chicago)).toEqual({ ok: true, at: "2026-03-08T08:30:00.000Z" });
    // Fall back (1 Nov 2026): 01:30 happens twice; the first one (CDT) is taken.
    expect(readTime("2026-11-01 01:30", chicago)).toEqual({ ok: true, at: "2026-11-01T06:30:00.000Z" });
    expect(readTime("2026-11-01 02:30", chicago)).toEqual({ ok: true, at: "2026-11-01T08:30:00.000Z" });
  });

  it("rejects a zone-less time under 'reject' with why: no-zone", () => {
    expect(readTime("2026-11-17 09:00", "reject")).toEqual({ ok: false, why: "no-zone" });
  });

  it("says empty for blank text and unreadable for anything that is not a date and time", () => {
    expect(readTime("   ", "reject")).toEqual({ ok: false, why: "empty" });
    for (const text of ["tomorrow", "17/11/2026 09:00", "2026-11-17", "2026-02-30 10:00", "2026-11-17 25:00", "2026-11-17 09:00+19:00"]) {
      expect(readTime(text, { zone: "UTC" })).toEqual({ ok: false, why: "unreadable" });
    }
  });

  it("never depends on the zone of the machine running it (same answer under TZ=UTC and TZ=Asia/Tokyo)", () => {
    const answers = ["UTC", "Asia/Tokyo", "America/Los_Angeles"].map((tz) => {
      process.env.TZ = tz;
      return [readTime("2026-11-17 09:00", { zone: "America/Chicago" }), readTime("2026-03-08 02:30", { zone: "America/Chicago" })];
    });
    expect(answers[1]).toEqual(answers[0]);
    expect(answers[2]).toEqual(answers[0]);
  });
  afterEach(() => {
    delete process.env.TZ;
  });
});

describe("asInstant", () => {
  it("accepts only text that carries its zone, and writes it as UTC", () => {
    expect(asInstant("2026-11-17T09:00:00-06:00")).toBe("2026-11-17T15:00:00.000Z");
    expect(asInstant("2026-11-17T15:00:00.000Z")).toBe("2026-11-17T15:00:00.000Z");
    expect(asInstant("2026-11-17T09:00:00")).toBeNull();
    expect(asInstant("not a time")).toBeNull();
  });
});

describe("hour arithmetic", () => {
  it("adds and measures hours, also fractional and negative", () => {
    const start = at("2026-11-17T00:00Z");
    expect(addHours(start, 36)).toBe("2026-11-18T12:00:00.000Z");
    expect(addHours(start, -1.5)).toBe("2026-11-16T22:30:00.000Z");
    expect(hoursBetween(start, at("2026-11-18T12:00Z"))).toBe(36);
    expect(hoursBetween(at("2026-11-18T12:00Z"), start)).toBe(-36);
    expect(instant(new Date(Date.UTC(2026, 10, 17)))).toBe("2026-11-17T00:00:00.000Z" as Instant);
  });
});

describe("isTimeZone", () => {
  it("knows IANA names and refuses anything else", () => {
    expect(isTimeZone("America/Chicago")).toBe(true);
    expect(isTimeZone("UTC")).toBe(true);
    expect(isTimeZone("Mars/Olympus")).toBe(false);
    expect(isTimeZone("")).toBe(false);
  });
});
