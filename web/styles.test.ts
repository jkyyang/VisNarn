import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

describe("styles.css", () => {
  // Stage 1 shows no dates or times, so no date input exists to style.
  it("has no date or time input selectors", () => {
    expect(css).not.toMatch(/type="(datetime-local|date|time)"/);
  });
});
