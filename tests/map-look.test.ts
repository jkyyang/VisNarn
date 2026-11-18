/**
 * Rail lines and the route must stay easy to see when the map turns dark. The whole page takes the
 * map's night look (web/styles.css, `:root:has(.map[data-look="night"])`); this checks those colours
 * against the night grounds they are drawn on, and against each other where two look alike.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RAILROADS } from "../shared/railroads.ts";

const CSS = readFileSync(new URL("../web/styles.css", import.meta.url), "utf8");

/**
 * The dark street map's land (OpenFreeMap "dark"), and NASA's Black Marble as the night side shows
 * it: its darkest blue, its night ocean, and moonlit land at its brightest.
 */
const NIGHT_GROUNDS = { "dark map": "#0c0c0c", "night lights": "#14142d", "night ocean": "#04050f", "moonlit land": "#2a2f4a" };

function tokens(selector: string): Record<string, string> {
  const start = CSS.indexOf(`${selector} {`);
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
  const night = tokens(':root:has(.map[data-look="night"])');

  it("draws every Class I railroad and the selected route at 4.5:1 or more against the dark ground", () => {
    for (const [ground, colour] of Object.entries(NIGHT_GROUNDS)) {
      for (const name of [...RAILROADS.map((r) => `--rr-${r}`), "--route"]) {
        expect(contrast(night[name], colour), `${name} on the ${ground}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  // Both are thin, faint lines in the network layer: grey beside a pale brown read as one colour.
  it("tells regional and short-line track apart, and shows each on every night ground", () => {
    expect(contrast(night["--rr-regional"], night["--rr-short-line"])).toBeGreaterThanOrEqual(2);
    for (const [ground, colour] of Object.entries(NIGHT_GROUNDS)) {
      for (const name of ["--rr-regional", "--rr-short-line"]) {
        expect(contrast(night[name], colour), `${name} on the ${ground}`).toBeGreaterThanOrEqual(3);
      }
    }
  });
});
