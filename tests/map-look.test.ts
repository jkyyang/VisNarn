/**
 * Rail lines and the route must stay easy to see on every ground, and the railroads easy to tell apart,
 * also for people with colour-blind vision. The whole page takes the map's look (web/styles.css,
 * `:root:has(.map[data-look="night"])`); this checks those colours against the grounds they are drawn
 * on, and against each other.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RAILROADS } from "../shared/railroads.ts";
import { GROUND } from "../web/map/basemaps.ts";
import { MAP_LINES } from "../web/theme.ts";

const CSS = readFileSync(new URL("../web/styles.css", import.meta.url), "utf8");

/** The night street map's land, and NASA's Black Marble as the night side shows it: its darkest blue, its night ocean, and moonlit land at its brightest. */
const NIGHT_GROUNDS = { "night street map": GROUND.night.land, "night lights": "#14142d", "night ocean": "#04050f", "moonlit land": "#2a2f4a" };

function tokens(selector: string): Record<string, string> {
  const start = CSS.indexOf(`${selector} {`);
  expect(start, `${selector} is in styles.css`).toBeGreaterThanOrEqual(0);
  const body = CSS.slice(start, CSS.indexOf("}", start));
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const linear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const gamma = (c: number) => {
  const v = Math.min(Math.max(c, 0), 1);
  return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
};

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map(linear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/** Machado, Oliveira and Fernandes (2009) at severity 1: what each kind of colour-blind vision sees, in linear RGB. */
const VISION = {
  normal: null,
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
} as const;
type Vision = keyof typeof VISION;

function seen(hex: string, vision: Vision): number[] {
  const m = VISION[vision];
  if (!m) return channels(hex);
  const rgb = channels(hex).map(linear);
  return m.map((row) => gamma(row[0] * rgb[0] + row[1] * rgb[1] + row[2] * rgb[2]));
}

/** sRGB (0 to 1) to CIELAB, D65. */
function lab(rgb: number[]): [number, number, number] {
  const [r, g, b] = rgb.map(linear);
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

/** CIEDE2000 colour difference: about 2 is just noticeable; two lines on a map want 10 or more. */
function deltaE2000([L1, a1, b1]: number[], [L2, a2, b2]: number[]): number {
  const rad = Math.PI / 180;
  const C7 = (c: number) => c ** 7 / (c ** 7 + 25 ** 7);
  const G = 0.5 * (1 - Math.sqrt(C7((Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2)));
  const [a1p, a2p] = [(1 + G) * a1, (1 + G) * a2];
  const [C1p, C2p] = [Math.hypot(a1p, b1), Math.hypot(a2p, b2)];
  const hue = (b: number, a: number) => ((Math.atan2(b, a) / rad) % 360 + 360) % 360;
  const [h1p, h2p] = [hue(b1, a1p), hue(b2, a2p)];
  let dh = h2p - h1p;
  if (C1p * C2p === 0) dh = 0;
  else if (dh > 180) dh -= 360;
  else if (dh < -180) dh += 360;
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dh / 2) * rad);
  const Lbp = (L1 + L2) / 2;
  const Cbp = (C1p + C2p) / 2;
  let hbp = h1p + h2p;
  if (C1p * C2p !== 0) hbp = Math.abs(h1p - h2p) <= 180 ? hbp / 2 : hbp < 360 ? (hbp + 360) / 2 : (hbp - 360) / 2;
  const T = 1 - 0.17 * Math.cos((hbp - 30) * rad) + 0.24 * Math.cos(2 * hbp * rad) + 0.32 * Math.cos((3 * hbp + 6) * rad) - 0.2 * Math.cos((4 * hbp - 63) * rad);
  const Rt = -Math.sin(2 * 30 * Math.exp(-(((hbp - 275) / 25) ** 2)) * rad) * 2 * Math.sqrt(C7(Cbp));
  const Sl = 1 + (0.015 * (Lbp - 50) ** 2) / Math.sqrt(20 + (Lbp - 50) ** 2);
  const Sc = 1 + 0.045 * Cbp;
  const Sh = 1 + 0.015 * Cbp * T;
  const [dL, dC, dH] = [(L2 - L1) / Sl, (C2p - C1p) / Sc, dHp / Sh];
  return Math.sqrt(dL ** 2 + dC ** 2 + dH ** 2 + Rt * dC * dH);
}

const difference = (a: string, b: string, vision: Vision = "normal") => deltaE2000(lab(seen(a, vision)), lab(seen(b, vision)));
const lineToken = (line: string) => `--rr-${line.replace(" ", "-")}`;
const LOOKS = { day: tokens(":root"), night: tokens(':root:has(.map[data-look="night"])') };

describe("the railroad colours", () => {
  // The smallest difference between any two of the nine lines, for each kind of vision.
  const LEAST: Record<Vision, number> = { normal: 14, protan: 8, deutan: 8, tritan: 8 };

  for (const [look, colours] of Object.entries(LOOKS)) {
    it(`tells every line from every other by ${look}, also with colour-blind vision`, () => {
      for (const vision of Object.keys(VISION) as Vision[]) {
        for (const [i, a] of MAP_LINES.entries()) {
          for (const b of MAP_LINES.slice(i + 1)) {
            expect(difference(colours[lineToken(a)], colours[lineToken(b)], vision), `${a} and ${b}, ${vision} vision, by ${look}`).toBeGreaterThanOrEqual(LEAST[vision]);
          }
        }
      }
    });

    it(`tells every line from the grey of routes not selected by ${look}`, () => {
      for (const line of MAP_LINES) expect(difference(colours[lineToken(line)], colours["--alt-route"]), `${line} by ${look}`).toBeGreaterThanOrEqual(8);
    });
  }

  // UP's yellow is the faintest; the line's width, its casing and the hover card carry it.
  it("shows every line on the day map's land", () => {
    for (const line of MAP_LINES) expect(contrast(LOOKS.day[lineToken(line)], GROUND.day.land), line).toBeGreaterThanOrEqual(2.4);
  });

  it("checks itself against published values", () => {
    // Sharma, Wu and Dalal (2005), test pairs 1 and 17.
    expect(deltaE2000([50, 2.6772, -79.7751], [50, 0, -82.7485])).toBeCloseTo(2.0425, 4);
    expect(deltaE2000([50, 2.5, 0], [73, 25, -18])).toBeCloseTo(27.1492, 4);
  });
});

describe("the night map", () => {
  const night = LOOKS.night;

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
