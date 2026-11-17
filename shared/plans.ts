/**
 * A route a person plans on the map: a start, the stops it must pass in order, a destination. No
 * clock and no car: only places, and the routes the network has between them.
 */
import type { PlaceRef, PlaceResolution } from "./places.ts";
import type { RoutePath, RouteStrategy } from "./route.ts";

export interface Plan {
  start: PlaceRef | null;
  /** Travel order. A clicked node's `railroad` is the line chosen there; null = any. */
  stops: PlaceRef[];
  destination: PlaceRef | null;
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

/** What is saved: the places and the chosen alternative. The route itself is worked out again on open. */
export interface SavedRouteDraft {
  name: string;
  plan: FullPlan;
  option: RouteStrategy | null;
}

export interface SavedRoute extends SavedRouteDraft {
  id: SavedRouteId;
}
