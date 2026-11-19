/**
 * The viewer's distance unit, kept in this browser. Only the words change: the engine, the server and
 * storage stay in km (web/format.ts converts while it writes the number).
 */
import { storedChoice } from "./ui/stored.ts";

export type DistanceUnit = "km" | "mi";
export const DISTANCE_UNITS: readonly DistanceUnit[] = ["km", "mi"];
export const DEFAULT_UNIT: DistanceUnit = "km";

export const useDistanceUnit = storedChoice("visnarn.distance-unit", DISTANCE_UNITS, () => DEFAULT_UNIT);
