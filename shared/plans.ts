/**
 * A route a person plans on the map: a start, the stops it must pass in order, a destination. No
 * clock and no car: only places, and the routes the network has between them.
 */
import type { PlaceRef, PlaceResolution } from "./places.ts";
import type { TrackIncluded } from "./railroads.ts";
import type { RoutePath, RouteStrategy } from "./route.ts";

export interface Plan {
  start: PlaceRef | null;
  /** Travel order. A clicked node's `railroad` is the next carrier chosen at that junction; null = the router's pick. */
  stops: PlaceRef[];
  destination: PlaceRef | null;
  /** Track beyond the Class I railroads the route may use. */
  include: TrackIncluded;
}

/** A plan that can be routed and saved: both ends are set. */
export interface FullPlan extends Plan {
  start: PlaceRef;
  destination: PlaceRef;
}

export type PlanField = "start" | "destination";

/** What each place of a plan resolved to, in the plan's own shape. */
export interface PlanPlaces {
  start: PlaceResolution | null;
  stops: PlaceResolution[];
  destination: PlaceResolution | null;
}

/** Where the route breaks (a field, or a stop index) and one short line. */
export interface PlanProblem {
  at: PlanField | number;
  message: string;
}

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
