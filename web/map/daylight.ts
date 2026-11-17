/**
 * Day and night on the map, like a phone's dynamic wallpaper: where the sun is for a time and a
 * place, and what the map should look like then. Pure numbers, no map code.
 *
 * Sun position: the low-precision formulas of the Astronomical Almanac (as used by NOAA's solar
 * calculator), good to about 0.01° in declination for 1950–2050. No refraction: the map only needs
 * to know day from dusk from night, not the minute of sunrise.
 */
import type { LngLat } from "../../shared/geo.ts";

/** The switch in the layers card. Auto follows the clock at the map centre. */
export type LightMode = "auto" | "day" | "night";
export type LightPhase = "day" | "sunrise" | "sunset" | "night";

export interface Sun {
  /** Degrees above the horizon; negative below it. */
  altitudeDeg: number;
  /** Compass bearing of the sun, degrees clockwise from north. */
  azimuthDeg: number;
}

export interface MapLook {
  /** Which colour set (and, zoomed in, which street map): the light ones or the dark ones. */
  base: "day" | "night";
  phase: LightPhase;
}

export const LIGHT_WORDS: Record<LightPhase, string> = { day: "Day", sunrise: "Sunrise", sunset: "Sunset", night: "Night" };

const RAD = Math.PI / 180;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const wrap180 = (deg: number) => ((((deg + 180) % 360) + 360) % 360) - 180;

/** Days since J2000.0 (2000-01-01 12:00 UT). */
const daysSinceJ2000 = (ms: number) => ms / 86_400_000 + 2440587.5 - 2451545.0;

/** Declination and right ascension of the sun, and Greenwich mean sidereal time, all in degrees. */
function sunAngles(ms: number): { dec: number; ra: number; gmst: number } {
  const d = daysSinceJ2000(ms);
  const g = (357.529 + 0.98560028 * d) * RAD;
  const q = 280.459 + 0.98564736 * d;
  const lambda = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  const tilt = (23.439 - 0.00000036 * d) * RAD;
  const ra = Math.atan2(Math.cos(tilt) * Math.sin(lambda), Math.cos(lambda)) / RAD;
  const dec = Math.asin(Math.sin(tilt) * Math.sin(lambda)) / RAD;
  const gmst = (18.697374558 + 24.06570982441908 * d) * 15;
  return { dec, ra, gmst };
}

/** Where the sun is in the sky, seen from `at`, at the instant `when`. */
export function sunPosition(when: Date | number, at: LngLat): Sun {
  const { dec, ra, gmst } = sunAngles(+when);
  const [lon, lat] = at;
  const hourAngle = wrap180(gmst + lon - ra) * RAD;
  const phi = lat * RAD;
  const delta = dec * RAD;
  const altitude = Math.asin(Math.sin(phi) * Math.sin(delta) + Math.cos(phi) * Math.cos(delta) * Math.cos(hourAngle));
  const azimuth = Math.atan2(-Math.sin(hourAngle), Math.tan(delta) * Math.cos(phi) - Math.sin(phi) * Math.cos(hourAngle));
  return { altitudeDeg: altitude / RAD, azimuthDeg: (azimuth / RAD + 360) % 360 };
}

/** The point on Earth where the sun is straight overhead. */
export function subsolarPoint(when: Date | number): LngLat {
  const { dec, ra, gmst } = sunAngles(+when);
  return [wrap180(ra - gmst), dec];
}

const FIXED: Record<Exclude<LightMode, "auto">, MapLook> = {
  day: { base: "day", phase: "day" },
  night: { base: "night", phase: "night" },
};

/**
 * Below this sun height the map centre counts as night: where the night tiles (./nightTiles.ts)
 * are half lit by city lights, so the colours and the picture under them turn together.
 */
export const NIGHT_BASE_DEG = -3;

/**
 * What the map looks like at its centre. Day and Night are fixed; Auto follows the sun: the dark
 * colours take over 3° after sunset, and the button says Sunrise or Sunset while the light is warm
 * (from 8° above the horizon to 10° below it).
 */
export function mapLook(mode: LightMode, sun: Sun): MapLook {
  if (mode !== "auto") return FIXED[mode];
  const alt = sun.altitudeDeg;
  const warm = clamp01(1 - Math.abs(alt + 1) / 9);
  const base = alt < NIGHT_BASE_DEG ? "night" : "day";
  const morning = sun.azimuthDeg < 180;
  const phase: LightPhase = warm >= 0.25 ? (morning ? "sunrise" : "sunset") : base;
  return { base, phase };
}
