import { describe, expect, it } from "vitest";
import { subsolarPoint } from "./daylight.ts";
import { NIGHT_GROUND_RGB, nightBucket, nightFactor, nightShade, nightTileUrl, parseNightTileUrl, TILE_PX } from "./nightTiles.ts";

const at = (iso: string) => new Date(iso);

/** The web-mercator tile a place is in, at zoom z. */
function tileAt(lon: number, lat: number, z: number): { x: number; y: number } {
  const n = 2 ** z;
  const y = (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;
  return { x: Math.floor(((lon + 180) / 360) * n), y: Math.floor(y * n) };
}

/** The tile with the point on Earth where the sun is overhead, or the opposite point. */
function tileUnder(lon: number, lat: number, z: number) {
  return { z, ...tileAt(lon, lat, z) };
}

/** A made-up opaque night picture, different in every pixel, standing in for Black Marble. */
function fakeBlackMarble(): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(TILE_PX * TILE_PX * 4);
  for (let k = 0; k < pixels.length; k += 4) {
    pixels[k] = (k >> 2) % 251;
    pixels[k + 1] = (k >> 3) % 253;
    pixels[k + 2] = (k >> 4) % 255;
    pixels[k + 3] = 255;
  }
  return pixels;
}

const alphas = (rgba: Uint8ClampedArray) => rgba.filter((_, k) => k % 4 === 3);
const KANSAS = tileUnder(-97, 38.5, 4);

describe("the night factor", () => {
  it("is full night from 8° below the horizon, full day from 2° above, and half at 3° below", () => {
    for (const alt of [-90, -30, -8]) expect(nightFactor(alt)).toBe(1);
    for (const alt of [2, 10, 90]) expect(nightFactor(alt)).toBe(0);
    expect(nightFactor(-3)).toBeCloseTo(0.5, 6);
    // Most of the city lights are on by the end of civil twilight.
    expect(nightFactor(-6)).toBeGreaterThan(0.85);
  });

  it("never grows as the sun rises: a soft edge with no bands", () => {
    let last = nightFactor(-20);
    for (let alt = -20; alt <= 20; alt += 0.1) {
      const next = nightFactor(alt);
      expect(next).toBeLessThanOrEqual(last);
      // About a tenth of a degree is under 15 km: no jump anywhere near a visible step.
      expect(last - next).toBeLessThan(0.025);
      last = next;
    }
  });
});

describe("a night tile", () => {
  it("is clear where the sun is overhead and the full night picture on the far side of the Earth", () => {
    const when = at("2026-11-17T23:00:00Z");
    const [lon, lat] = subsolarPoint(when);
    const night = fakeBlackMarble();
    const under = tileUnder(lon, lat, 3);
    expect(alphas(nightShade(under.z, under.x, under.y, when, night, false)).every((a) => a === 0)).toBe(true);
    const far = tileUnder(lon > 0 ? lon - 180 : lon + 180, -lat, 3);
    expect(nightShade(far.z, far.x, far.y, when, night, false)).toEqual(night);
  });

  it("over Kansas at 2 a.m. is the night picture itself, every pixel opaque", () => {
    const night = fakeBlackMarble();
    const shaded = nightShade(KANSAS.z, KANSAS.x, KANSAS.y, at("2026-11-18T08:00:00Z"), night, false);
    expect(shaded).toEqual(night);
  });

  it("over Kansas at noon is fully clear, so the day map shows untouched", () => {
    const shaded = nightShade(KANSAS.z, KANSAS.x, KANSAS.y, at("2026-11-17T18:15:00Z"), fakeBlackMarble(), false);
    expect(alphas(shaded).every((a) => a === 0)).toBe(true);
  });

  it("just after sunset in the West grows darker from west to east across the tile, with no line drawn", () => {
    const west = tileUnder(-110, 38.5, 4);
    const shaded = nightShade(west.z, west.x, west.y, at("2026-11-18T00:30:00Z"), fakeBlackMarble(), false);
    const row = TILE_PX / 2;
    const line = Array.from({ length: TILE_PX }, (_, i) => shaded[(row * TILE_PX + i) * 4 + 3]);
    expect(line[0]).toBeLessThan(255);
    expect(line[TILE_PX - 1]).toBe(255);
    for (let i = 1; i < TILE_PX; i++) {
      expect(line[i], `pixel ${i}`).toBeGreaterThanOrEqual(line[i - 1]);
      // Soft: neighbouring pixels (about 10 km apart here) differ by a few levels at most.
      expect(line[i] - line[i - 1]).toBeLessThanOrEqual(4);
    }
  });

  it("in Night mode is the night picture everywhere, even at noon", () => {
    const night = fakeBlackMarble();
    expect(nightShade(KANSAS.z, KANSAS.x, KANSAS.y, at("2026-11-17T18:15:00Z"), night, true)).toEqual(night);
  });

  it("without the night picture (offline) still turns the night side dark, Black Marble's night ocean colour", () => {
    const shaded = nightShade(KANSAS.z, KANSAS.x, KANSAS.y, at("2026-11-18T08:00:00Z"), null, false);
    // Every 997th pixel is sample enough.
    for (let k = 0; k < shaded.length; k += 4 * 997) {
      expect([shaded[k], shaded[k + 1], shaded[k + 2], shaded[k + 3]]).toEqual([...NIGHT_GROUND_RGB, 255]);
    }
  });
});

describe("night tile URLs", () => {
  it("change every 10 minutes in Auto and never in Night, and read back as written", () => {
    const t = +at("2026-11-17T23:07:12Z");
    expect(nightBucket(t)).toBe(+at("2026-11-17T23:00:00Z"));
    expect(nightBucket(t + 60_000)).toBe(nightBucket(t));
    expect(nightTileUrl("night", nightBucket(t))).toBe(nightTileUrl("night", nightBucket(t + 3_600_000)));
    const url = nightTileUrl("auto", nightBucket(t)).replace("{z}", "4").replace("{x}", "3").replace("{y}", "6");
    expect(parseNightTileUrl(url)).toEqual({ z: 4, x: 3, y: 6, bucket: nightBucket(t), mode: "auto" });
    expect(parseNightTileUrl("https://example.com/4/3/6.png")).toBeNull();
  });
});
