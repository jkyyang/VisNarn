/**
 * The viewer's distance unit, kept in this browser. Only the words change: the engine, the server and
 * storage stay in km (web/format.ts converts while it writes the number).
 */
import { useSyncExternalStore } from "react";

export type DistanceUnit = "km" | "mi";
export const DISTANCE_UNITS: readonly DistanceUnit[] = ["km", "mi"];
export const DEFAULT_UNIT: DistanceUnit = "km";

const KEY = "visnarn.distance-unit";
const listeners = new Set<() => void>();
/** The choice for this page while the browser refuses storage (blocked site data, some private windows). */
let unsaved: DistanceUnit = DEFAULT_UNIT;

function read(): DistanceUnit {
  try {
    const saved = localStorage.getItem(KEY);
    return DISTANCE_UNITS.find((unit) => unit === saved) ?? DEFAULT_UNIT;
  } catch {
    return unsaved;
  }
}

function choose(unit: DistanceUnit): void {
  try {
    localStorage.setItem(KEY, unit);
  } catch {
    unsaved = unit;
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useDistanceUnit(): [DistanceUnit, (unit: DistanceUnit) => void] {
  return [useSyncExternalStore(subscribe, read, () => DEFAULT_UNIT), choose];
}
