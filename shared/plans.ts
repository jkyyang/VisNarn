/** A route a person plans on the map: places in travel order, and the routes the network has between them. */
import type { PlaceRef, PlaceResolution } from "./places.ts";
import type { TrackIncluded } from "./railroads.ts";
import type { RoutePath, RouteStrategy } from "./route.ts";

export interface Plan {
  /**
   * Travel order, 2 or more rows: the first is the start, the last the destination, the rest stops.
   * Null is an empty row; the route runs through the rows that are set. A clicked node's `railroad` is
   * the next carrier chosen there; null means the router's pick.
   */
  places: (PlaceRef | null)[];
  /** Track beyond the Class I railroads the route may use. */
  include: TrackIncluded;
}

/** A plan that can be routed and saved: 2 or more places, none empty. */
export interface FullPlan extends Plan {
  places: PlaceRef[];
}

/** What each place resolved to, in the same order as `Plan.places`; null for an empty row. */
export type PlanPlaces = (PlaceResolution | null)[];

/** Where the route breaks (an index into `Plan.places`) and one short line. */
export interface PlanProblem {
  at: number;
  message: string;
}

export type PlaceKind = "start" | "stop" | "destination";

/** A row's part in the trip, by its position. */
export const placeKind = (at: number, count: number): PlaceKind => (at === 0 ? "start" : at === count - 1 ? "destination" : "stop");

export type PlannedRoute =
  | { outcome: "incomplete"; places: PlanPlaces }
  | { outcome: "no-route"; places: PlanPlaces; problem: PlanProblem }
  /** Distinct routes, the router's own first; a route's id is `strategies[0]`. */
  | { outcome: "routed"; places: PlanPlaces; routes: [RoutePath, ...RoutePath[]] };

export type SavedRouteId = string & { readonly __brand: "SavedRouteId" };

/**
 * What is saved: the places with the next carrier chosen at each junction stop, the track included,
 * the chosen alternative and its route string. The route itself is worked out again on open.
 */
export interface SavedRouteDraft {
  name: string;
  plan: FullPlan;
  option: RouteStrategy | null;
  /** The compact route string when saved, "BNSF-[Kansas City, MO]-UP" (shared/routeString.ts); "" for a route saved before route strings. */
  routeString: string;
}

export interface SavedRoute extends SavedRouteDraft {
  id: SavedRouteId;
}
