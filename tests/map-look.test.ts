/**
 * Rail lines and the route must stay easy to see when the map turns dark. The map's night look
 * swaps in its own colour set (web/styles.css, `.map[data-look="night"]`); this checks those colours
 * against the two night grounds they are drawn on.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RAILROADS } from "../shared/railroads.ts";

const CSS = readFileSync(new URL("../web/styles.css", import.meta.url), "utf8");

/** The dark street map's land (OpenFreeMap "dark") and the darkest blue of NASA's Black Marble. */
const NIGHT_GROUNDS = { "dark map": "#0c0c0c", "night lights": "#14142d" };

function tokens(selector: string, from = 0): Record<string, string> {
  const start = CSS.indexOf(`${selector} {`, from);
  expect(start, `${selector} is in styles.css`).toBeGreaterThanOrEqual(0);
  const body = CSS.slice(start, CSS.indexOf("}", start));
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe("the night map", () => {
  const night = tokens('.map[data-look="night"]');

  it("draws every Class I railroad and the selected route at 4.5:1 or more against the dark ground", () => {
    for (const [ground, colour] of Object.entries(NIGHT_GROUNDS)) {
      for (const name of [...RAILROADS.map((r) => `--rr-${r}`), "--route"]) {
        expect(contrast(night[name], colour), `${name} on the ${ground}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("uses the app's dark theme colours, and the day map the light theme's, so the cards over the map match the map", () => {
    const day = tokens('.map[data-look="day"]');
    const lightTheme = tokens(":root");
    const darkTheme = tokens(":root", CSS.indexOf("@media (prefers-color-scheme: dark)"));
    for (const name of ["--panel", "--fg", "--route", "--casing", ...RAILROADS.map((r) => `--rr-${r}`)]) {
      expect(day[name], `day ${name}`).toBe(lightTheme[name]);
      expect(night[name], `night ${name}`).toBe(darkTheme[name]);
    }
  });
});
