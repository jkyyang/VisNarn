/**
 * The night side of the Earth, tile by tile, like a phone's Earth wallpaper seen from space: NASA's
 * Black Marble city lights where the sun is down, nothing where it is up, and a soft twilight band
 * about 1,100 km wide between the two. No line is drawn: the edge of night is wherever the tiles fade.
 *
 * The tiles come through a MapLibre protocol (`earthnight://z/x/y?t=…&m=…`), so they sit in the
 * basemap under the place names and under deck.gl's rail lines and route, like any raster layer.
 * The pixel maths is pure and runs in tests; only `loadNightTile` needs a browser.
 */
import type { AddProtocolAction } from "maplibre-gl";
import { blackMarbleTile } from "../data/blackMarble.ts";
import { subsolarPoint, TWILIGHT_DAY_DEG, TWILIGHT_NIGHT_DEG } from "./daylight.ts";

export const NIGHT_PROTOCOL = "earthnight";
export const TILE_PX = 256;

/** The day side darkens a little as the sun gets low, up to 30% at the horizon, none from 20° up. */
const LOW_SUN_DEG = 20;
const LOW_SUN_DIM = 0.3;
/** A faint amber along the edge of night, strongest 1° below the horizon. 0 turns it off. */
const WARM_STRENGTH = 0.08;
const WARM_PEAK_DEG = -1;
const WARM_HALF_WIDTH_DEG = 5;
const WARM_RGB = [0xff, 0x8a, 0x3d] as const;
/** Black Marble's own night ocean: what the night side shows when its tile cannot be fetched. */
export const NIGHT_GROUND_RGB = [0x04, 0x05, 0x0f] as const;

/** The sun moves about 2.5° of longitude in 10 minutes: the night tiles are redrawn that often. */
const NIGHT_REFRESH_MS = 600_000;

const RAD = Math.PI / 180;

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** How much of the night picture shows, 0 (full day) to 1 (full night), for a sun height in degrees. */
export function nightFactor(altDeg: number): number {
  return 1 - smoothstep(TWILIGHT_NIGHT_DEG, TWILIGHT_DAY_DEG, altDeg);
}

/** The start of the 10-minute slot `now` falls in; the tile URLs change only when it does. */
export const nightBucket = (now: number): number => Math.floor(now / NIGHT_REFRESH_MS) * NIGHT_REFRESH_MS;

export type NightTileMode = "auto" | "night";

/** The tile URL template for the night layer: Auto follows the sun at `bucket`, Night is night everywhere. */
export const nightTileUrl = (mode: NightTileMode, bucket: number): string => `${NIGHT_PROTOCOL}://{z}/{x}/{y}?t=${mode === "night" ? 0 : bucket}&m=${mode}`;

/**
 * One 256 px web-mercator tile of the night overlay, as RGBA. `night` is the Black Marble tile's
 * pixels (opaque RGBA), or null to paint the night side plain dark. Where the sun is up the pixels
 * are fully transparent, so the basemap underneath shows; `forceNight` makes every pixel night.
 *
 * Per pixel, with n the night factor, s the low-sun dimming and w the warm band:
 *   alpha = 1 − (1−n)(1−s)(1−w),  colour = (night·n·(1−w) + warm·w) / alpha
 * so the night picture covers the basemap by n, black dims it by s, and amber tints it by w.
 */
export function nightShade(z: number, x: number, y: number, when: Date | number, night: Uint8ClampedArray | null, forceNight: boolean): Uint8ClampedArray {
  const out = new Uint8ClampedArray(TILE_PX * TILE_PX * 4);
  const worldPx = TILE_PX * 2 ** z;
  const [sunLon, dec] = subsolarPoint(when);
  const sinDec = Math.sin(dec * RAD);
  const cosDec = Math.cos(dec * RAD);
  // The sun's height depends on longitude only through cos(lon − sunLon), and on latitude only
  // through sin and cos of it: one table per column and per row instead of trig per pixel.
  const cosHour = new Float64Array(TILE_PX);
  for (let i = 0; i < TILE_PX; i++) {
    const lon = ((x * TILE_PX + i + 0.5) / worldPx) * 360 - 180;
    cosHour[i] = Math.cos((lon - sunLon) * RAD);
  }
  for (let j = 0; j < TILE_PX; j++) {
    const lat = Math.atan(Math.sinh(Math.PI * (1 - (2 * (y * TILE_PX + j + 0.5)) / worldPx)));
    const a1 = Math.sin(lat) * sinDec;
    const a2 = Math.cos(lat) * cosDec;
    for (let i = 0; i < TILE_PX; i++) {
      let n = 1;
      let s = 0;
      let w = 0;
      if (!forceNight) {
        const alt = Math.asin(Math.min(1, Math.max(-1, a1 + a2 * cosHour[i]))) / RAD;
        n = nightFactor(alt);
        s = LOW_SUN_DIM * (1 - smoothstep(0, LOW_SUN_DEG, alt));
        w = WARM_STRENGTH * Math.max(0, 1 - Math.abs(alt - WARM_PEAK_DEG) / WARM_HALF_WIDTH_DEG) ** 2;
      }
      const alpha = 1 - (1 - n) * (1 - s) * (1 - w);
      // Under half a step of 8-bit alpha: leave the pixel clear.
      if (alpha < 0.002) continue;
      const k = (j * TILE_PX + i) * 4;
      for (let c = 0; c < 3; c++) {
        const lit = night ? night[k + c] : NIGHT_GROUND_RGB[c];
        out[k + c] = (lit * n * (1 - w) + WARM_RGB[c] * w) / alpha;
      }
      out[k + 3] = alpha * 255;
    }
  }
  return out;
}

const hasAlpha = (pixels: Uint8ClampedArray) => {
  for (let k = 3; k < pixels.length; k += 4) if (pixels[k] !== 0) return true;
  return false;
};

/**
 * What a night tile URL asks for. The format is ours (see `nightTileUrl`), so anything else is a
 * mistake and is refused.
 */
export function parseNightTileUrl(url: string): { z: number; x: number; y: number; bucket: number; mode: NightTileMode } | null {
  const match = /^earthnight:\/\/(\d+)\/(\d+)\/(\d+)\?t=(\d+)&m=(auto|night)$/.exec(url);
  if (!match) return null;
  const mode: NightTileMode = match[5] === "night" ? "night" : "auto";
  return { z: Number(match[1]), x: Number(match[2]), y: Number(match[3]), bucket: Number(match[4]), mode };
}

let scratch: OffscreenCanvasRenderingContext2D | null = null;

async function pixelsOf(blob: Blob): Promise<Uint8ClampedArray> {
  const bitmap = await createImageBitmap(blob);
  scratch ??= new OffscreenCanvas(TILE_PX, TILE_PX).getContext("2d", { willReadFrequently: true });
  if (!scratch) throw new Error("No 2D canvas to read the night tile with.");
  scratch.clearRect(0, 0, TILE_PX, TILE_PX);
  scratch.drawImage(bitmap, 0, 0, TILE_PX, TILE_PX);
  bitmap.close();
  return scratch.getImageData(0, 0, TILE_PX, TILE_PX).data;
}

let warned = false;
const aborted = () => new DOMException("The night tile is no longer needed.", "AbortError");

/**
 * MapLibre's loader for `earthnight://` tiles (register it with `addProtocol`). Tiles wholly in
 * daylight are answered without a download. If Black Marble cannot be reached, the night side is
 * still dark, just without its lights.
 */
export const loadNightTile: AddProtocolAction = async (params, abortController) => {
  const tile = parseNightTileUrl(params.url);
  if (!tile) throw new Error(`Not a night tile: ${params.url}`);
  const forceNight = tile.mode === "night";
  // Shade for the middle of the 10-minute slot: never more than 5 minutes out.
  const when = tile.bucket + NIGHT_REFRESH_MS / 2;
  let pixels = nightShade(tile.z, tile.x, tile.y, when, null, forceNight);
  if (hasAlpha(pixels)) {
    try {
      const night = await pixelsOf(await blackMarbleTile(tile.z, tile.x, tile.y));
      if (abortController.signal.aborted) throw aborted();
      pixels = nightShade(tile.z, tile.x, tile.y, when, night, forceNight);
    } catch (error) {
      if (abortController.signal.aborted) throw aborted();
      // Once: offline, every tile would say the same.
      if (!warned) console.warn("Night lights unavailable; the night side is drawn plain dark.", error);
      warned = true;
    }
  }
  if (abortController.signal.aborted) throw aborted();
  // MapLibre's raster shader expects premultiplied colour, as it gets from its own PNG decoding.
  const image = await createImageBitmap(new ImageData(pixels, TILE_PX, TILE_PX), { premultiplyAlpha: "premultiply" });
  return { data: image };
};
