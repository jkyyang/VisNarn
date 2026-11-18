/**
 * The few words the planner says, built from domain values. The server sends facts (km, railroads,
 * places); the words for them are chosen here, in one file, so the panel and the map cannot drift apart.
 */
import type { NetworkNode, PlaceResolution, PlaceSuggestion } from "../shared/places.ts";
import type { PlanPlaces } from "../shared/plans.ts";
import { isClassI } from "../shared/railroads.ts";
import type { RoutePath, TurnBack } from "../shared/route.ts";
import { isPlaceName } from "../shared/routeString.ts";
import { fmtCompass, fmtDistance, fmtSub } from "./format.ts";
import type { MapLine } from "./theme.ts";
import type { DistanceUnit } from "./units.ts";

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

/** "Sarnia · FRA 628925": the node a shop's link joins. */
export const linkText = (node: NetworkNode) => `${shortPlace(node.near)} · FRA ${node.fraId}`;

/** Under a shop's links: how a car uses the shop, wired as it is. */
export function linksReadout(links: number, atNode: boolean): string {
  if (links === 1) return "One link: cars leave the way they came in.";
  if (links > 1) return "Two links: cars can pass through.";
  return atNode ? "No links: on the network at its node." : "No links: joins the nearest mainline.";
}

/** A step of a route: out of a shop's own track the way the car went in. */
export const BACK_OUT = "Backs out of the spur";

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

const TRACK_WORDS: Record<TurnBack["track"], string> = { yard: "yard track", "stub-end": "yard track (stub end)", stop: "turned at the stop" };
export const trackWords = (track: TurnBack["track"]) => TRACK_WORDS[track];

/**
 * A route's pill on the map. The selected route: its length ("828 km"). Another: how it differs from
 * the selected one ("+180 km · 1 more interchange", "−40 km", "same length").
 */
export function pillText(route: RoutePath, selected: RoutePath, unit: DistanceUnit): string {
  if (route === selected || route.strategies[0] === selected.strategies[0]) return fmtDistance(route.km, unit);
  const diff = route.km - selected.km;
  const length = Math.abs(diff) < 1 ? "same length" : `${diff > 0 ? "+" : "−"}${fmtDistance(Math.abs(diff), unit)}`;
  const changes = route.interchanges - selected.interchanges;
  if (!changes) return length;
  return `${length} · ${plural(Math.abs(changes), `${changes > 0 ? "more" : "fewer"} interchange`, `${changes > 0 ? "more" : "fewer"} interchanges`)}`;
}

/** "Kansas City → Chicago via Galesburg": the name a new saved route starts with. */
export function routeName(places: PlanPlaces): string {
  const labels = places.flatMap((place) => (place?.ok ? [shortPlace(place.place.label)] : []));
  // A clicked point named by its distance to a city is no name to save under.
  const via = labels.slice(1, -1).filter(isPlaceName);
  return `${labels[0] ?? ""} → ${labels.at(-1) ?? ""}${via.length ? ` via ${via.join(", ")}` : ""}`;
}

/** A typed spot this far or farther from the track it snapped to says how far. */
const SHOW_SNAP_KM = 1;

/** "On the network · BNSF, UP", "Nearest track 12 km away · BNSF" (without the railroads when `withLines` is false), or the problem in words. */
export function placeHint(resolution: PlaceResolution, unit: DistanceUnit, withLines = true): { ok: boolean; text: string } {
  if (!resolution.ok) return { ok: false, text: resolution.problem.message };
  const { place } = resolution;
  const lines = withLines && place.railroads.length ? ` · ${place.railroads.join(", ")}` : "";
  if (place.match.confidence === "snapped" && place.match.snapKm >= SHOW_SNAP_KM) return { ok: true, text: `Nearest track ${fmtDistance(place.match.snapKm, unit)} away${lines}` };
  return { ok: true, text: `On the network${lines}` };
}

/** The one line under a place that did not resolve; null for one that did. */
export function placeProblem(resolution: PlaceResolution | null): string | null {
  return resolution && !resolution.ok ? resolution.problem.message : null;
}
