import { describe, expect, it } from "vitest";
import { fmtCompass, fmtKmShort, fmtLonLat, fmtSub, fmtSubdivision, titleCase } from "./format.ts";

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
  it("writes km with thousands and lon, lat with a real minus", () => {
    expect(fmtKmShort(1045.6)).toBe("1,046 km");
    expect(fmtLonLat(-92.27, 34.77)).toBe("−92.27, 34.77");
  });
});

describe("small words", () => {
  it("names eight compass points", () => {
    expect([0, 44, 46, 90, 180, 225, 270, 315, 359].map(fmtCompass)).toEqual(["N", "NE", "NE", "E", "S", "SW", "W", "NW", "N"]);
  });
});
