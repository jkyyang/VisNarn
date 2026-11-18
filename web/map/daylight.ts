/**
 * Day and night on the map, like a phone's dynamic wallpaper: where the sun is for a time and a
 * place, and what the map should look like then. Pure numbers, no map code.
 *
 * Sun position: the low-precision formulas of the Astronomical Almanac (as used by NOAA's solar
 * calculator), good to about 0.01° in declination for 1950–2050. No refraction: telling day, dusk
 * and night apart is all the map needs.
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

const RAD = Math.PI / 180;
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
 * Sun heights (degrees) where night begins to fall and where it is complete. 10° of sun height is
 * about 1,100 km on the ground; city lights are half on at −3° and 90% on by −6°, the end of civil
 * twilight. (−12° to +1° is softer, about 1,450 km, but the edge of night is harder to see.)
 */
export const TWILIGHT_NIGHT_DEG = -8;
export const TWILIGHT_DAY_DEG = 2;

/**
 * Below this sun height the map centre counts as night: where the night tiles (./nightTiles.ts)
 * are half lit by city lights, so the colours and the picture under them turn together.
 */
const NIGHT_BASE_DEG = (TWILIGHT_NIGHT_DEG + TWILIGHT_DAY_DEG) / 2;

/** The light is warm, and the button says Sunrise or Sunset, while the sun is between these heights. */
const WARM_HIGH_DEG = 5.75;
const WARM_LOW_DEG = -7.75;

/** What the map looks like at its centre. Day and Night are fixed; Auto follows the sun. */
export function mapLook(mode: LightMode, sun: Sun): MapLook {
  if (mode !== "auto") return FIXED[mode];
  const alt = sun.altitudeDeg;
  const base = alt < NIGHT_BASE_DEG ? "night" : "day";
  const warm = alt >= WARM_LOW_DEG && alt <= WARM_HIGH_DEG;
  const phase: LightPhase = warm ? (sun.azimuthDeg < 180 ? "sunrise" : "sunset") : base;
  return { base, phase };
}
