import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

/** The token blocks: the day values on :root, the night values, the phone sizes. */
const TOKEN_BLOCKS = [...css.matchAll(/(:root[^{]*)\{([^}]*)\}/g)];
const tokens = (selector: string) =>
  Object.fromEntries([...(TOKEN_BLOCKS.find((m) => m[1]?.trim() === selector)?.[2] ?? "").matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2]?.trim() ?? ""]));

/** Red, green and blue (0 to 255) of "#rrggbb" or "rgba(r, g, b, a)". */
function rgb(value: string): number[] | null {
  const hex = /^#([0-9a-f]{6})$/i.exec(value)?.[1];
  if (hex) return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const numbers = /^rgba?\(([^)]+)\)/.exec(value)?.[1]?.split(",").map(Number);
  return numbers ? numbers.slice(0, 3) : null;
}

/** Blue: a hue between cyan and violet, with enough colour in it to read as a hue at all. */
function isBlue([r = 0, g = 0, b = 0]: number[]): boolean {
  const [max, min] = [Math.max(r, g, b), Math.min(r, g, b)];
  if (max - min < 24) return false;
  const hue = max === b ? 240 + (60 * (r - g)) / (max - min) : max === g ? 120 + (60 * (b - r)) / (max - min) : (360 + (60 * (g - b)) / (max - min)) % 360;
  return hue >= 180 && hue <= 260;
}

/** The chrome's tokens: everything but the map's own colours (the railroads, the ground behind the tiles). */
const chrome = (block: Record<string, string>) => Object.entries(block).filter(([name]) => !name.startsWith("--rr-") && name !== "--bg");

describe("styles.css", () => {
  it("writes every colour as a token: no colour outside the token blocks", () => {
    const outside = css.replace(/:root[^{]*\{[^}]*\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(outside.match(/#[0-9a-f]{3,8}\b|rgba?\(/gi) ?? []).toEqual([]);
  });

  it("has no blue anywhere in the chrome, by day or by night", () => {
    for (const block of [tokens(":root"), tokens(':root:has(.map[data-look="night"])')]) {
      for (const [name, value] of chrome(block)) {
        for (const colour of value.match(/#[0-9a-f]{6}\b|rgba?\([^)]*\)/gi) ?? []) expect(isBlue(rgb(colour) ?? []), `${name}: ${colour}`).toBe(false);
      }
    }
  });

  it("never writes text or a thin icon in the accent: it is a fill, with --on-accent on it", () => {
    expect(css).not.toMatch(/(^|[^-])color:\s*var\(--accent\)/m);
    expect(css).not.toMatch(/stroke:\s*var\(--accent\)/);
  });

  it("shows a focus ring only for the keyboard (:focus-visible), never after a click", () => {
    expect(css).not.toMatch(/:focus(?![-\w])/);
  });

  // jsdom has no layout: a 190-character unbroken shop name made the Sections list and the shop table thousands of px wide on a phone,
  // and a nowrap "DRAFT-UTLX-ECH" code pushed each row's Edit out of a 360 px panel.
  it("lets a long unbroken shop name or code break anywhere", () => {
    const anywhere = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter((m) => /overflow-wrap:\s*anywhere/.test(m[2] ?? ""));
    const selectors = anywhere.flatMap((m) => (m[1] ?? "").split(",").map((s) => s.replace(/\/\*[\s\S]*?\*\//g, "").trim()));
    for (const selector of [".section-text", ".shop-name", ".shop-sub", ".import-preview", ".suggestions li > span:first-child"]) {
      expect(selectors).toContain(selector);
    }
  });

});
