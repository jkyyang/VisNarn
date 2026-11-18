/**
 * The few words the planner says, built from domain values. The server sends facts (km, railroads,
 * places); the words for them are chosen here, in one file, so the panel and the map cannot drift apart.
 */
import type { PlaceResolution } from "../shared/places.ts";
import type { PlanPlaces } from "../shared/plans.ts";
import type { Line } from "../shared/railroads.ts";
import type { RoutePath, TurnBack } from "../shared/route.ts";
import { fmtCompass, fmtKmShort, fmtSub } from "./format.ts";

/** "Temple, TX" → "Temple"; "72 km from Jacksonville, FL" → "72 km from Jacksonville". */
export const shortPlace = (near: string) => near.replace(/,\s*[A-Z]{2}$/, "");

/** "UP", "Regional", "Short line". */
export const lineName = (line: Line) => (line === "regional" ? "Regional" : line === "short line" ? "Short line" : line);

/** "1 interchange", "2 interchanges". */
export const interchangesWord = (n: number) => `${n} ${n === 1 ? "interchange" : "interchanges"}`;

/** "Lampasas Sub S" */
const onSub = (subdivision: string | null, headingDeg: number) => (subdivision ? `${fmtSub(subdivision)} ${fmtCompass(headingDeg)}` : fmtCompass(headingDeg));

/** "Lampasas Sub S → N", "Lampasas Sub S → Galveston Sub SE": the line and heading a turn-back is reached on, then left on. */
export function turnBackMove(turnBack: TurnBack): string {
  const { arrives, leaves } = turnBack;
  const sameSub = leaves.subdivision === arrives.subdivision;
  return `${onSub(arrives.subdivision, arrives.headingDeg)} → ${sameSub ? fmtCompass(leaves.headingDeg) : onSub(leaves.subdivision, leaves.headingDeg)}`;
}

export const trackWords = (track: TurnBack["track"]) => (track === "stub-end" ? "yard track (stub end)" : "yard track");

/**
 * A route's pill on the map. The selected route: its length ("828 km"). Another: how it differs from
 * the selected one ("+180 km · 1 more interchange", "−40 km", "same km").
 */
export function pillText(route: RoutePath, selected: RoutePath): string {
  if (route === selected || route.strategies[0] === selected.strategies[0]) return fmtKmShort(route.km);
  const diff = route.km - selected.km;
  const km = Math.abs(diff) < 1 ? "same km" : `${diff > 0 ? "+" : "−"}${fmtKmShort(Math.abs(diff))}`;
  const changes = route.interchanges - selected.interchanges;
  if (!changes) return km;
  const n = Math.abs(changes);
  return `${km} · ${n} ${changes > 0 ? "more" : "fewer"} ${n === 1 ? "interchange" : "interchanges"}`;
}

const labelOf = (place: PlaceResolution | null) => (place?.ok ? shortPlace(place.place.label) : "");
/** A clicked track point with no town of its own is named by distance ("250 km from Chicago, IL"): not a name to save under. */
const unnamed = (label: string) => /^[\d,.]+ km from /.test(label);

/** "Kansas City → Chicago via Galesburg": the name a new saved route starts with. */
export function routeName(places: PlanPlaces): string {
  const stops = places.stops.map(labelOf).filter((label) => label && !unnamed(label));
  return `${labelOf(places.start)} → ${labelOf(places.destination)}${stops.length ? ` via ${stops.join(", ")}` : ""}`;
}

/** The one line under a place that did not resolve; null for one that did. */
export function placeProblem(resolution: PlaceResolution | null): string | null {
  return resolution && !resolution.ok ? resolution.problem.message : null;
}
