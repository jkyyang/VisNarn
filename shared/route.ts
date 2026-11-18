/**
 * A route from B to the shop, and what to make of it.
 *
 * Two layers. A RoutePath is track only: it has no clock in it, so it is the same for any speed
 * and can be cached. A RouteOption is that path under the current assumptions and given times:
 * the same steps with rough arrival times, and a verdict.
 */
import type { LngLat } from "./geo.ts";
import type { FraId } from "./places.ts";
import type { Line } from "./railroads.ts";
import type { Instant } from "./time.ts";

/**
 * How the router was asked. "pick" is the default trade-off; the others each push one concern to
 * the limit, and are only shown when they find a different path. A path found by "shortest" is the
 * shortest by construction, and so on, so the strategies that found a path are also its labels
 * ("Router's pick", "Shortest", "Fewest interchanges", "No turn-backs").
 */
export const ROUTE_STRATEGIES = ["pick", "shortest", "fewest-interchanges", "no-turn-backs"] as const;
export type RouteStrategy = (typeof ROUTE_STRATEGIES)[number];

/** One run on one line in one direction (a leg also ends where the route turns back). */
export interface Leg {
  railroad: Line;
  km: number;
  from: string;
  to: string;
  /** Compass heading over the leg as a whole, for "BNSF toward North Little Rock (heading NE)". */
  headingDeg: number;
  /** In route order; a name repeats when the route comes back to it. */
  subdivisions: string[];
  path: LngLat[];
}

/** A place where the route reverses direction. Allowed only on yard track; always worth a person's look. */
export interface TurnBack {
  at: { fraId: FraId; lon: number; lat: number; near: string };
  railroad: Line;
  arrives: { subdivision: string | null; headingDeg: number };
  leaves: { subdivision: string | null; headingDeg: number };
  /** 0–180. */
  turnDeg: number;
  /** "stub-end": the route leaves over the same segment it arrived on. */
  track: "yard" | "stub-end";
}

/** One row of the route read top to bottom, from B to the shop. `kmFromB` is where the row starts. */
export type Milestone =
  | { kind: "turn-back"; kmFromB: number; turnBack: number }
  | { kind: "leg"; kmFromB: number; leg: number }
  | { kind: "interchange"; kmFromB: number; from: Line; to: Line; at: string }
  | { kind: "stop"; kmFromB: number; stop: number; label: string }
  | { kind: "shop"; kmFromB: number };

export interface RoutePath<Step = Milestone> {
  /** Every strategy that found this same path. */
  strategies: RouteStrategy[];
  /** Real track distance from B to the shop. Routing penalties are not in it. */
  km: number;
  interchanges: number;
  railroads: Line[];
  legs: Leg[];
  turnBacks: TurnBack[];
  /** In order; `turnBack`, `leg` and `stop` are indexes into the arrays above and into the report's stops. */
  steps: Step[];
  /** The route to the shop runs back through A: often a sign that A and B were swapped. */
  passesA: boolean;
}

/** Not a forecast range: both ends use the same speed. It only covers a start anywhere between A and B. */
export interface EtaWindow {
  ifAtB: Instant;
  ifJustPastA: Instant;
}

export type RouteStep = Milestone & { eta: EtaWindow };

export type TimingStatus = "at-risk" | "tight" | "on-time";

/** A reason to look at the route or the position before trusting the time. */
export type RouteFlag =
  | { kind: "turn-back"; places: string[] }
  | { kind: "detour"; ratio: number }
  | { kind: "approach-not-on-track" }
  | { kind: "passes-a-again" }
  | { kind: "stale-position"; ageH: number }
  /** A and B are the same place, so the direction of travel is not known and the route may hide a turn-back. */
  | { kind: "direction-unknown" };

export type TriageGroup = "act-now" | "check-first" | "ok";

export interface Verdict {
  arrival: EtaWindow;
  /** arrival.ifAtB minus prep end, in hours. Negative: arrival can come before prep ends. */
  marginH: number;
  timing: TimingStatus;
  flags: RouteFlag[];
  group: TriageGroup;
}

export interface RouteOption extends RoutePath<RouteStep> {
  /** Stable while the same route is open: the first strategy that found the path. */
  id: RouteStrategy;
  verdict: Verdict;
}

/** The stretch from A to B. Straight line (× 1.2) when the allowed track does not connect them. */
export interface Approach {
  onTrack: boolean;
  km: number;
  paths: LngLat[][];
}
