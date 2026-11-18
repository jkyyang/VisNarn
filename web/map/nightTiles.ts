/**
 * The night side of the Earth, tile by tile, like a phone's Earth wallpaper seen from space: NASA's
 * Black Marble city lights where the sun is down, nothing where it is up, and a soft twilight band
 * about 1,100 km wide between the two. No line is drawn: the edge of night is wherever the tiles fade.
 *
 * The tiles come through a MapLibre protocol (`earthnight://z/x/y?t=…&m=…`), so they sit in the
 * basemap under the place names and under deck.gl's rail lines and route, like any raster layer.
 * Most tiles are wholly day (one clear pixel) or wholly night (the Black Marble picture as it is);
 * only tiles in the twilight band, and along 180° where Black Marble has no data, run the pixel maths.
 * The maths is pure and runs in tests; only `loadNightTile` needs a browser.
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

/**
 * Black Marble has no data in a strip along 180°, where its tiles meet: black, with a dim edge. Every
 * real pixel is at least as bright as its night ocean (NIGHT_GROUND_RGB); these are darker, in blue
 * at most half of it.
 */
const isNoData = (rgba: Uint8ClampedArray, k: number) =>
  rgba[k] <= NIGHT_GROUND_RGB[0] && rgba[k + 1] <= NIGHT_GROUND_RGB[1] && rgba[k + 2] <= NIGHT_GROUND_RGB[2] / 2;

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
 * pixels (opaque RGBA), or null to paint the night side plain dark; its "no data" pixels are painted
 * that way too, so no dark line shows where the world repeats at 180°. Where the sun is up the pixels
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
      const noData = !night || isNoData(night, k);
      for (let c = 0; c < 3; c++) {
        const lit = noData ? NIGHT_GROUND_RGB[c] : night[k + c];
        out[k + c] = (lit * n * (1 - w) + WARM_RGB[c] * w) / alpha;
      }
      out[k + 3] = alpha * 255;
    }
  }
  return out;
}

/** The latitude, in radians, of the top edge of tile row `y` when the world is `n` tiles high. */
const rowLat = (n: number, y: number) => Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)));

/**
 * The lowest and highest sun over a tile, in degrees: exact, from its edges, plus the points under
 * and opposite the sun when they fall inside. Along an edge of fixed latitude the sun is highest
 * where the longitude is the sun's; along one of fixed longitude, at one latitude worked out below.
 */
export function sunRange(z: number, x: number, y: number, when: Date | number): [number, number] {
  const n = 2 ** z;
  const west = (x / n) * 360 - 180;
  const east = ((x + 1) / n) * 360 - 180;
  const north = rowLat(n, y);
  const south = rowLat(n, y + 1);
  const [sunLon, dec] = subsolarPoint(when);
  const d = dec * RAD;
  const sinAlt = (lat: number, lon: number) => Math.sin(lat) * Math.sin(d) + Math.cos(lat) * Math.cos(d) * Math.cos((lon - sunLon) * RAD);
  const inLon = (lon: number) => [-360, 0, 360].map((k) => lon + k).filter((l) => l >= west && l <= east);
  const inLat = (lat: number) => lat >= south && lat <= north;
  const lons = [west, east, ...inLon(sunLon), ...inLon(sunLon + 180)];
  const points: [number, number][] = [];
  for (const lon of lons) {
    for (const lat of [south, north]) points.push([lat, lon]);
    // On a meridian the height is R·cos(lat − peak): highest at `peak`, lowest half a turn away.
    const peak = Math.atan2(Math.sin(d), Math.cos(d) * Math.cos((lon - sunLon) * RAD));
    for (const lat of [peak, peak - Math.PI, peak + Math.PI]) if (inLat(lat)) points.push([lat, lon]);
  }
  const heights = points.map(([lat, lon]) => Math.asin(Math.min(1, Math.max(-1, sinAlt(lat, lon)))) / RAD);
  return [Math.min(...heights), Math.max(...heights)];
}

/**
 * What one tile needs. "day": clear (the sun is high enough over all of it that no pixel would show).
 * "night": the Black Marble picture itself (night everywhere, no twilight colours). "twilight": the
 * pixel maths.
 */
export function nightTileKind(z: number, x: number, y: number, when: Date | number, forceNight: boolean): "day" | "night" | "twilight" {
  if (forceNight) return "night";
  const [low, high] = sunRange(z, x, y, when);
  if (low >= LOW_SUN_DEG) return "day";
  // Below both the twilight and the warm band.
  if (high <= Math.min(TWILIGHT_NIGHT_DEG, WARM_PEAK_DEG - WARM_HALF_WIDTH_DEG)) return "night";
  return "twilight";
}

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
 * MapLibre copies a tile's picture into a texture as soon as it gets it and never closes the
 * picture; closed right after that, its memory is freed now instead of whenever it is collected.
 */
function handOver(image: ImageBitmap): { data: ImageBitmap } {
  setTimeout(() => image.close(), 0);
  return { data: image };
}

/** A day tile: one clear pixel, stretched over the tile. */
const clearTile = () => createImageBitmap(new ImageData(1, 1));

/**
 * MapLibre's loader for `earthnight://` tiles (register it with `addProtocol`). If Black Marble
 * cannot be reached, the night side is still dark, without its lights.
 */
export const loadNightTile: AddProtocolAction = async (params, abortController) => {
  const tile = parseNightTileUrl(params.url);
  if (!tile) throw new Error(`Unknown night tile: ${params.url}`);
  const forceNight = tile.mode === "night";
  // Shade for the middle of the 10-minute slot: never more than 5 minutes out.
  const when = tile.bucket + NIGHT_REFRESH_MS / 2;
  const kind = nightTileKind(tile.z, tile.x, tile.y, when, forceNight);
  if (kind === "day") return handOver(await clearTile());
  let png: Blob | null = null;
  try {
    png = await blackMarbleTile(tile.z, tile.x, tile.y);
  } catch (error) {
    // Once: offline, every tile would say the same.
    if (!warned) console.warn("Night lights unavailable; the night side is drawn plain dark.", error);
    warned = true;
  }
  if (abortController.signal.aborted) throw aborted();
  const atDateLine = tile.x === 0 || tile.x === 2 ** tile.z - 1;
  if (png && kind === "night" && !atDateLine) return handOver(await createImageBitmap(png));
  const pixels = nightShade(tile.z, tile.x, tile.y, when, png ? await pixelsOf(png) : null, forceNight);
  if (abortController.signal.aborted) throw aborted();
  // MapLibre's raster shader expects premultiplied colour, as it gets from its own PNG decoding.
  return handOver(await createImageBitmap(new ImageData(pixels, TILE_PX, TILE_PX), { premultiplyAlpha: "premultiply" }));
};
