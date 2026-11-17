import { describe, expect, it } from "vitest";
import { instant } from "../shared/time.ts";
import { fmtAge, fmtCompass, fmtDays, fmtGiven, fmtSlack, fmtSub, fmtSubdivision, fmtWhen, fmtWindow, fromLocalInput, instantToLocalInput, titleCase } from "./format.ts";

const PLACEHOLDER = { kind: "placeholder" } as const;
/** Local wall-clock times, so the tests read the same in any time zone. */
const at = (day: number, hour: number, minute = 0) => instant(new Date(2026, 10, day, hour, minute));

describe("format", () => {
  it("title-cases accented names without breaking words", () => {
    expect(titleCase("QUÉRETARO")).toBe("Quéretaro");
    expect(titleCase("LITTLE ROCK")).toBe("Little Rock");
  });
  it("keeps railroad marks and ampersand names in subdivision labels", () => {
    expect(fmtSubdivision("CHICAGO (CN)")).toBe("Chicago (CN)");
    expect(fmtSubdivision("A&WP")).toBe("A&WP");
    expect(fmtSub("LAMPASAS")).toBe("Lampasas Sub");
    expect(fmtSub("GALVESTON (BNSF)")).toBe("Galveston Sub (BNSF)");
  });
  it("signs slack and switches to days past 48 h", () => {
    expect(fmtSlack(-5)).toBe("−5 h");
    expect(fmtSlack(72)).toBe("+3.0 days");
  });
});

describe("rough times while the speed is a placeholder", () => {
  it("say the day and the part of the day, never minutes", () => {
    expect(fmtWhen(at(19, 23, 47), PLACEHOLDER)).toBe("about Thu 19 night");
    expect(fmtWhen(at(20, 3, 5), PLACEHOLDER)).toBe("about Fri 20 early");
    expect(fmtWhen(at(20, 9, 59), PLACEHOLDER)).not.toMatch(/\d:\d/);
  });
  it("join the two ends of a window, and say one phrase when they fall together", () => {
    expect(fmtWindow({ ifAtB: at(19, 22), ifJustPastA: at(20, 4) }, PLACEHOLDER)).toBe("about Thu 19 night – Fri 20 early");
    expect(fmtWindow({ ifAtB: at(20, 8), ifJustPastA: at(20, 13) }, PLACEHOLDER)).toBe("about Fri 20 morning – afternoon");
    expect(fmtWindow({ ifAtB: at(20, 8), ifJustPastA: at(20, 10) }, PLACEHOLDER)).toBe("about Fri 20 morning");
  });
  it("show minutes once the estimate is calibrated, and for times someone gave", () => {
    expect(fmtWhen(at(19, 23, 47), { kind: "calibrated", trips: 40, scope: "lane" })).toBe("Thu 19, 23:47");
    expect(fmtGiven(at(19, 0))).toBe("Thu 19, 00:00");
    expect(fmtDays(at(17, 9), at(19, 2))).toBe("Tue 17 – Thu 19");
  });
});

describe("small words", () => {
  it("names eight compass points", () => {
    expect([0, 44, 46, 90, 180, 225, 270, 315, 359].map(fmtCompass)).toEqual(["N", "NE", "NE", "E", "S", "SW", "W", "NW", "N"]);
  });
  it("says how old a report is in whole days", () => {
    expect(fmtAge(3)).toBe("0 days old");
    expect(fmtAge(30)).toBe("1 day old");
    expect(fmtAge(60)).toBe("2 days old");
  });
  it("reads a date-time input in the browser's zone and writes it back the same", () => {
    const read = fromLocalInput("2026-11-19T00:00");
    expect(read).toBe(at(19, 0));
    expect(instantToLocalInput(read)).toBe("2026-11-19T00:00");
    expect(fromLocalInput("")).toBeNull();
    expect(fromLocalInput("2026-02-31T10:00")).toBeNull();
    expect(fromLocalInput("tomorrow")).toBeNull();
  });
});
