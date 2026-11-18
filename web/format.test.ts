import { describe, expect, it } from "vitest";
import { fmtCompass, fmtKmShort, fmtSub, fmtSubdivision, titleCase } from "./format.ts";

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
  it("writes km with thousands", () => {
    expect(fmtKmShort(1045.6)).toBe("1,046 km");
  });
});

describe("small words", () => {
  it("names eight compass points", () => {
    expect([0, 44, 46, 90, 180, 225, 270, 315, 359].map(fmtCompass)).toEqual(["N", "NE", "NE", "E", "S", "SW", "W", "NW", "N"]);
  });
});
