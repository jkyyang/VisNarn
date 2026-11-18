/**
 * The few words the planner says, built from domain values. The server sends facts (km, railroads,
 * places); the words for them are chosen here, in one file, so the panel and the map cannot drift apart.
 */
import type { PlaceResolution, PlaceSuggestion } from "../shared/places.ts";
import type { PlanPlaces } from "../shared/plans.ts";
import { isClassI } from "../shared/railroads.ts";
import type { RoutePath, TurnBack } from "../shared/route.ts";
import { isPlaceName } from "../shared/routeString.ts";
import { fmtCompass, fmtKmShort, fmtSub } from "./format.ts";
import type { MapLine } from "./theme.ts";

/**
 * "Temple, TX" → "Temple"; "72 km from Jacksonville, FL" → "72 km from Jacksonville";
 * "Regina, SK · Procor (approximate)" → "Regina": the shop's company tag stays in the field and leaves the short name.
 */
export const shortPlace = (near: string) => near.replace(/\s+·\s.*$/, "").replace(/\s*\([^)]*\)$/, "").replace(/,\s*[A-Z]{2}$/, "");

/** "UP", "Regional", "Short line", "Passenger". */
export const lineName = (line: MapLine) => (isClassI(line) ? line : line[0].toUpperCase() + line.slice(1));

/** "1 shop", "3 shops". */
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "1 interchange", "2 interchanges". */
export const interchangesWord = (n: number) => plural(n, "interchange");

/** A thrown error's own message, else the fallback. */
export const errorText = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);

/** "Click the map to set the start", "… set stop 2". Each caller adds its own end punctuation. */
export const clickToSet = (what: string) => `Click the map to set ${what}`;
export const NO_TRACK_NEAR = "No track near there";

/** What a suggestion is: "Shop", "City". */
export const PLACE_SOURCE_WORDS: Record<PlaceSuggestion["source"], string> = { shop: "Shop", city: "City", yard: "Yard", junction: "Junction", node: "Node" };

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
  return `${km} · ${plural(Math.abs(changes), `${changes > 0 ? "more" : "fewer"} interchange`, `${changes > 0 ? "more" : "fewer"} interchanges`)}`;
}

/** "Kansas City → Chicago via Galesburg": the name a new saved route starts with. */
export function routeName(places: PlanPlaces): string {
  const labels = places.flatMap((place) => (place?.ok ? [shortPlace(place.place.label)] : []));
  // A clicked point named by its distance to a city is no name to save under.
  const via = labels.slice(1, -1).filter(isPlaceName);
  return `${labels[0] ?? ""} → ${labels.at(-1) ?? ""}${via.length ? ` via ${via.join(", ")}` : ""}`;
}

/** The one line under a place that did not resolve; null for one that did. */
export function placeProblem(resolution: PlaceResolution | null): string | null {
  return resolution && !resolution.ok ? resolution.problem.message : null;
}
