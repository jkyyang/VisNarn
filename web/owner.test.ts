import { describe, expect, it } from "vitest";
import { ownerOf } from "./owner.ts";

describe("ownerOf", () => {
  it("reads Procor or UTLX from the name or the code, and nothing else", () => {
    expect(ownerOf({ name: "Oakville, ON · Procor", code: "DRAFT-PROC-OAK" })).toBe("Procor");
    expect(ownerOf({ name: "Edmonton plant", code: "DRAFT-PROC-EDM" })).toBe("Procor");
    expect(ownerOf({ name: "Texarkana, AR · UTLX", code: null })).toBe("UTLX");
    expect(ownerOf({ name: "East plant", code: "DRAFT-UTLX-ECH" })).toBe("UTLX");
    expect(ownerOf({ name: "EXAMPLE Kansas City, MO", code: "EX-KCY-01" })).toBeNull();
    expect(ownerOf({ name: "Procurement office", code: null })).toBeNull();
  });
});
