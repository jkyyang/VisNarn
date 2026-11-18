/**
 * The route as the industry writes it on a waybill: the carriers in order and the junction where
 * each hands the car to the next. Saved compact, "BNSF-[Kansas City, MO]-UP"; shown with spaces,
 * "BNSF – [Kansas City, MO] – UP".
 *
 * No code is made up. A junction shows our own place name in brackets until its real Rule 260 code
 * is known, and a regional railroad or short line shows its class label until its mark is known.
 * Turn-backs, subdivisions and plain stops are not part of a route string.
 */
import type { PlaceRef } from "./places.ts";
import type { Line } from "./railroads.ts";
import type { RoutePath } from "./route.ts";

export interface Junction {
  /** Our own place name, or "72 km from Topeka, KS" when no named place is near. */
  place: string;
  /** The person chose the next carrier here; otherwise it is the router's pick. */
  chosen: boolean;
  /** Its interchange row in `route.steps`. */
  step: number;
}

/** `junctions[i]` lies between `carriers[i]` and `carriers[i + 1]`. */
export interface RouteString {
  carriers: Line[];
  junctions: Junction[];
}

/** False for a point named by its distance to a city ("250 km from Chicago, IL"): no place of its own. */
export const isPlaceName = (label: string): boolean => !/^[\d,.]+ km from /.test(label);

/**
 * Read off the route's steps in travel order. `stops` are the plan's stops: a stop with a chosen
 * railroad ("Next carrier") makes the last railroad change before it the person's choice.
 */
export function routeStringOf(route: RoutePath, stops: PlaceRef[]): RouteString {
  const carriers: Line[] = [];
  const junctions: Junction[] = [];
  let change: Junction | null = null;
  route.steps.forEach((step, i) => {
    if (step.kind === "interchange") {
      // A change before the first carrier is a tie the router broke at the start, not a handoff; nor is a change to the same carrier.
      if (carriers.length && step.from !== step.to) change = { place: step.at, chosen: false, step: i };
    } else if (step.kind === "leg") {
      const carrier = route.legs[step.leg].railroad;
      if (!carriers.length) carriers.push(carrier);
      else if (change) {
        junctions.push(change);
        carriers.push(carrier);
        change = null;
      }
      // Otherwise the same carrier goes on after a turn-back.
    } else if (step.kind === "stop") {
      const stop = stops[step.stop];
      const last = change ?? junctions[junctions.length - 1];
      if (stop?.kind === "node" && stop.railroad && last) last.chosen = true;
    }
  });
  return { carriers, junctions };
}

const parts = ({ carriers, junctions }: RouteString): string[] => carriers.flatMap((carrier, i) => (i ? [`[${junctions[i - 1].place}]`, carrier] : [carrier]));

/** "BNSF-[Kansas City, MO]-UP": the form that is saved. */
export const compactRouteString = (route: RouteString): string => parts(route).join("-");

/** "BNSF – [Kansas City, MO] – UP": the form that is shown. */
export const shownRouteString = (route: RouteString): string => parts(route).join(" – ");
