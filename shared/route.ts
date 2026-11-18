/** A route from the start to the destination, as the router found it. */
import type { LngLat } from "./geo.ts";
import type { FraId } from "./places.ts";
import type { Line } from "./railroads.ts";

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

/** One row of the route read top to bottom, from the start to the destination. `kmFromStart` is where the row starts. */
export type Milestone =
  | { kind: "turn-back"; kmFromStart: number; turnBack: number }
  | { kind: "leg"; kmFromStart: number; leg: number }
  | { kind: "interchange"; kmFromStart: number; from: Line; to: Line; at: string }
  | { kind: "stop"; kmFromStart: number; stop: number; label: string }
  | { kind: "destination"; kmFromStart: number };

export interface RoutePath {
  /** Every strategy that found this same path. */
  strategies: RouteStrategy[];
  /** Real track distance from the start to the destination. Routing penalties are not in it. */
  km: number;
  interchanges: number;
  railroads: Line[];
  legs: Leg[];
  turnBacks: TurnBack[];
  /** In order; `turnBack`, `leg` and `stop` are indexes into the arrays above and into the plan's stops. */
  steps: Milestone[];
}
