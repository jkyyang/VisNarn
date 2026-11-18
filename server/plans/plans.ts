/**
 * Plans: from the places a person set on the map to the routes between them, and the routes they
 * saved by name. Routing composes two things that can each say "no": the Directory (does every
 * place resolve?) and the route planner (is there a route?).
 *
 * A routed plan is not stored. It is a function of the plan, the stored shops and codes, the routing
 * rules and the network version: ask again and you get the same answer.
 */
import { randomUUID } from "node:crypto";
import type { NoRoute, Trip } from "../../engine/index.ts";
import { AppError } from "../../shared/app.ts";
import type { Assumptions } from "../../shared/assumptions.ts";
import type { PlaceResolution, ResolvedPlace, Waypoint } from "../../shared/places.ts";
import type { Plan, PlannedRoute, PlanPlaces, PlanProblem, SavedRoute, SavedRouteDraft, SavedRouteId } from "../../shared/plans.ts";
import type { Directory } from "../places/directory.ts";
import type { RoutePlanner } from "../routing/planner.ts";
import type { Store } from "../store/store.ts";

export interface Plans {
  /** Resolves every place; routes once start and destination resolve. Stores nothing; same plan → same answer. */
  route(plan: Plan, signal?: AbortSignal): Promise<PlannedRoute>;
  /** By name ignoring case; ties in the order saved. */
  saved(): SavedRoute[];
  /** New when id is null. AppError("not-found") for an unknown id. Saving what is stored writes nothing. */
  save(draft: SavedRouteDraft, id: SavedRouteId | null): SavedRoute;
  /** AppError("not-found") for an unknown id. */
  remove(id: SavedRouteId): void;
}

type Resolved = Extract<PlaceResolution, { ok: true }>;

const isResolved = (place: PlaceResolution | null): place is Resolved => place !== null && place.ok;

export function createPlans(parts: { store: Store; directory: Directory; planner: RoutePlanner; rules: () => Assumptions["routing"] }): Plans {
  const { store, directory, planner } = parts;

  const unknown = (): never => {
    throw new AppError("not-found", "This saved route does not exist any more. It may have been deleted.");
  };

  return {
    async route(plan, signal) {
      // The ends look in Your shops first; a stop is a position on the track.
      const places: PlanPlaces = {
        start: plan.start && directory.resolve(plan.start, "shop"),
        stops: plan.stops.map((ref) => directory.resolve(ref, "position")),
        destination: plan.destination && directory.resolve(plan.destination, "shop"),
      };
      const { start, destination } = places;
      const stops = places.stops.filter(isResolved);
      if (!isResolved(start) || !isResolved(destination) || stops.length !== places.stops.length) return { outcome: "incomplete", places };

      // A = B (the engine's precedent for "no next node"): the route may leave the start either way.
      const from = waypoint(start.place);
      const trip: Trip = { a: from, b: from, stops: stops.map((s) => waypoint(s.place)), shop: waypoint(destination.place), rules: { ...parts.rules(), include: plan.include } };
      const routed = await planner.plan(trip, "all", { signal });
      if (!routed.ok) return { outcome: "no-route", places, problem: problemOf(routed.noRoute, trip) };
      // Every place on one spot: nothing moves, so there is no route to show or save.
      if (routed.trip.paths.every((path) => path.legs.length === 0)) return { outcome: "no-route", places, problem: { at: "destination", message: "Start and destination are the same place." } };
      return { outcome: "routed", places, routes: routed.trip.paths };
    },

    saved: () => store.savedRoutes.all(),

    save(draft, id) {
      const name = draft.name.trim();
      if (!name) throw new AppError("invalid", "Give the route a name.", "name");
      const next: SavedRoute = { id: id ?? (randomUUID() as SavedRouteId), name, plan: draft.plan, option: draft.option };
      if (id !== null) {
        const known = store.savedRoutes.get(id) ?? unknown();
        if (canonical(known) === canonical(next)) return known;
      }
      store.savedRoutes.save(next);
      return next;
    },

    remove(id) {
      if (!store.savedRoutes.remove(id)) unknown();
    },
  };
}

function waypoint(place: ResolvedPlace): Waypoint {
  return { label: place.label, lon: place.lon, lat: place.lat, fraId: place.fraId, railroad: place.railroad };
}

/**
 * Where the plan breaks, in the plan's own words. The engine's messages name "A", "B" and "the shop",
 * which this screen does not have, so they never pass through.
 */
function problemOf(noRoute: NoRoute, trip: Trip): PlanProblem {
  const at: PlanProblem["at"] = noRoute.at === "a" || noRoute.at === "b" ? "start" : noRoute.at === "shop" ? "destination" : noRoute.at;
  if (noRoute.kind === "no-path") return { at, message: "No track reaches here from the stop before." };
  if (noRoute.kind === "dead-end") return { at, message: "The route cannot go on from here without turning back." };
  const point = at === "start" ? trip.b : at === "destination" ? trip.shop : trip.stops[at];
  return { at, message: point?.railroad ? `${point.railroad} has no track here.` : "No allowed railroad has track here." };
}

/** JSON with object keys sorted: two saved routes that mean the same compare equal. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined);
    entries.sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
