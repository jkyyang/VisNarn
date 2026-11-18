/**
 * Routing one car: from where it is (between A and B, moving toward B), through any stops a person
 * added, to the shop. In: waypoints with stable ids. Out: paths with stable ids. The node and edge
 * indexes of engine/core never leave this file.
 */
import type { Assumptions } from "../shared/assumptions.ts";
import { haversineKm, round5, type LngLat } from "../shared/geo.ts";
import type { FraId, Waypoint } from "../shared/places.ts";
import { DEFAULT_INCLUDE, LINES, RAILROADS } from "../shared/railroads.ts";
import type { Approach, Leg, Milestone, RoutePath, RouteStrategy, TurnBack } from "../shared/route.ts";
import { maskOf, MAX_SNAP_KM, REGIONAL, SHORT_LINE, type Point, type RailGraph, type Track } from "./core/graph.ts";
import { RouteError, Router, turnDeg, type Route, type RouteOptions, type RouteStart } from "./core/router.ts";
import { coreOf, type RailNetwork } from "./network.ts";

export interface Trip {
  a: Waypoint;
  b: Waypoint;
  stops: Waypoint[];
  shop: Waypoint;
  rules: Assumptions["routing"];
}

export interface NoRoute {
  /**
   * "not-served": no allowed railroad has track at that waypoint. "no-path": nothing joins them without reversing outside a yard.
   * "dead-end": the stop is reached, but every way of reaching it faces away from the next waypoint.
   */
  kind: "not-served" | "no-path" | "dead-end";
  /** The waypoint at fault: "a", "b", "shop", or the index of a stop. */
  at: "a" | "b" | "shop" | number;
  message: string;
}

export type RouteResult =
  | { ok: true; approach: Approach; straightKm: number; path: RoutePath }
  | { ok: false; noRoute: NoRoute };

/**
 * A router bound to one network. It holds about 85 MB of search scratch and is not re-entrant:
 * one per thread, one `route` call at a time. Creating it takes about 20 ms.
 */
export interface CarRouter {
  /** One way to run the trip. "No route" is an answer, not an exception. Deterministic for a given network version. */
  route(trip: Trip, strategy: RouteStrategy): RouteResult;
}

/** The approach when the allowed track does not join A to B: the straight line, stretched by this much. */
const STRAIGHT_LINE_FACTOR = 1.2;
const REVERSE_KM = 100;

/**
 * Lines and track the rules allow: the Class I railroads ticked, plus regional railroads and short lines when
 * included. Passenger-owned track is included unless turned off; the router then uses it only where no
 * freight-owned way is close in length (core/router.ts PASSENGER_TRACK_COST).
 */
function trackOf(rules: Trip["rules"]): Track {
  const include = rules.include ?? DEFAULT_INCLUDE;
  const allowedMask = maskOf(rules.allowed) | (include.regional ? 1 << REGIONAL : 0) | (include.shortLine ? 1 << SHORT_LINE : 0);
  return { allowedMask, passenger: include.passenger };
}

/** Routing penalties per strategy. They steer which path is found; `km` stays real track distance. */
function costsOf(strategy: RouteStrategy, rules: Trip["rules"]): Omit<RouteOptions, keyof Track> {
  switch (strategy) {
    case "pick":
      return { interchangeKm: rules.interchangePenaltyKm, reverseKm: REVERSE_KM };
    case "shortest":
      // Not 0: where railroads share track, a free interchange would win ties and invent a change of railroad.
      return { interchangeKm: 1, reverseKm: 0 };
    case "fewest-interchanges":
      return { interchangeKm: 100_000, reverseKm: REVERSE_KM };
    case "no-turn-backs":
      return { interchangeKm: rules.interchangePenaltyKm, reverseKm: Infinity };
  }
}

type At = NoRoute["at"];

/** How a message names a waypoint. Never its label: results are cached under keys without labels. */
function roleOf(at: At): string {
  return at === "a" ? "A" : at === "b" ? "B" : at === "shop" ? "the shop" : `stop ${at + 1}`;
}
const capital = (text: string) => text[0].toUpperCase() + text.slice(1);

export function createCarRouter(network: RailNetwork): CarRouter {
  const graph = coreOf(network);
  const router = new Router(graph);

  const pointOf = (w: Waypoint): Point | null => {
    const only = w.railroad ? RAILROADS.indexOf(w.railroad) : undefined;
    if (w.fraId === null) return { label: w.label, lon: w.lon, lat: w.lat, only };
    const node = graph.indexOf(w.fraId);
    return node < 0 ? null : { label: w.label, lon: w.lon, lat: w.lat, node, only };
  };

  /** Why no allowed railroad can serve this waypoint, or null when one can. */
  const notServed = (w: Waypoint, p: Point | null, at: At, track: Track): NoRoute | null => {
    const role = capital(roleOf(at));
    if (!p) return { kind: "not-served", at, message: `${role} is FRA node ${w.fraId}, which this network does not have.` };
    if (w.railroad && !(track.allowedMask & (1 << RAILROADS.indexOf(w.railroad)))) {
      return { kind: "not-served", at, message: `${role} must be reached on ${w.railroad}, but ${w.railroad} is not allowed.` };
    }
    if (graph.serving(p, track).size) return null;
    const where = p.node !== undefined ? `track at ${roleOf(at)} (FRA node ${w.fraId})` : `mainline within ${MAX_SNAP_KM} km of ${roleOf(at)}`;
    const message = w.railroad ? `${w.railroad} has no ${where}.` : `No allowed railroad has ${where}.`;
    return { kind: "not-served", at, message };
  };

  return {
    route(trip, strategy) {
      const track = trackOf(trip.rules);
      const pick: RouteOptions = { ...track, ...costsOf("pick", trip.rules) };
      const options: RouteOptions = { ...track, ...costsOf(strategy, trip.rules) };

      const ends: [Waypoint, At][] = [[trip.b, "b"], ...trip.stops.map((w, i): [Waypoint, At] => [w, i]), [trip.shop, "shop"]];
      const onwardPoints: Point[] = [];
      for (const [w, at] of ends) {
        const p = pointOf(w);
        const problem = notServed(w, p, at, track);
        if (problem) return { ok: false, noRoute: problem };
        onwardPoints.push(p!);
      }
      const a = pointOf(trip.a);
      const b = onwardPoints[0];

      let approachRoute: Route | null = null;
      if (a) {
        try {
          approachRoute = router.route([a, b], pick);
        } catch (error) {
          if (!(error instanceof RouteError)) throw error;
        }
      }
      const approach: Approach = approachRoute
        ? { onTrack: true, km: approachRoute.km, paths: approachRoute.legs.map((leg) => leg.path.map(lngLat)) }
        : {
            onTrack: false,
            km: haversineKm(trip.a.lon, trip.a.lat, trip.b.lon, trip.b.lat) * STRAIGHT_LINE_FACTOR,
            paths: [[lngLat([trip.a.lon, trip.a.lat]), lngLat([trip.b.lon, trip.b.lat])]],
          };
      // No movement from A to B (the same node, or the same point) gives no direction: the search is
      // then free to leave B either way, and judge flags the result because approach.km is 0.
      const start: RouteStart | null = approachRoute
        ? approachRoute.end && { continueFrom: approachRoute.end }
        : approach.km > 0
          ? { headingDeg: bearingDeg(trip.a.lon, trip.a.lat, trip.b.lon, trip.b.lat) }
          : null;

      let onward: Route;
      try {
        onward = router.route(onwardPoints, options, start);
      } catch (error) {
        if (!(error instanceof RouteError)) throw error;
        const roleAt = (point: number): At => (point === onwardPoints.length - 1 ? "shop" : point - 1);
        if (error.deadEnd) {
          const message = `${capital(roleOf(roleAt(error.point)))} is reached, but the car cannot go on from it to ${roleOf(roleAt(error.point + 1))} without turning back outside a yard.`;
          return { ok: false, noRoute: { kind: "dead-end", at: roleAt(error.point), message } };
        }
        const target = error.point > 0 ? error.point : onwardPoints.length - 1;
        const at: At = target === onwardPoints.length - 1 ? "shop" : target - 1;
        const from: At = target === 1 ? "b" : target - 2;
        const message = `No route from ${roleOf(from)} to ${roleOf(at)} with the railroads allowed, without turning back outside a yard.`;
        return { ok: false, noRoute: { kind: "no-path", at, message } };
      }

      const aNodes = new Set<number>();
      if (approachRoute?.legs.length) aNodes.add(approachRoute.legs[0].nodes[0]);
      else if (a) for (const node of graph.serving(a, track).values()) aNodes.add(node);
      if (a?.node !== undefined) aNodes.add(a.node);

      const path = describe(graph, onward, strategy, onwardPoints.slice(1, -1), aNodes, track);
      return { ok: true, approach, straightKm: haversineKm(trip.b.lon, trip.b.lat, trip.shop.lon, trip.shop.lat), path };
    },
  };
}

const lngLat = ([lon, lat]: [number, number]): LngLat => [round5(lon), round5(lat)];

/** Initial great-circle bearing from one point to another, degrees clockwise from north. */
function bearingDeg(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const r = Math.PI / 180;
  const y = Math.sin((lon2 - lon1) * r) * Math.cos(lat2 * r);
  const x = Math.cos(lat1 * r) * Math.sin(lat2 * r) - Math.sin(lat1 * r) * Math.cos(lat2 * r) * Math.cos((lon2 - lon1) * r);
  return ((Math.atan2(y, x) / r) % 360 + 360) % 360;
}

/**
 * The core route as a RoutePath: indexes become FRA ids and coordinates here, once. Legs are split at
 * turn-backs so each has one direction, and the steps are read off in travel order.
 */
function describe(
  graph: RailGraph,
  route: Route,
  strategy: RouteStrategy,
  stops: Point[],
  aNodes: Set<number>,
  track: Track,
): RoutePath {
  const subdivision = (edge: number) => (edge >= 0 ? graph.meta.subdivs[graph.edgeSubdiv[edge]] || null : null);
  const turnBacks: TurnBack[] = route.reversals.map((r) => ({
    at: { fraId: graph.fraId(r.node), lon: round5(graph.lon[r.node]), lat: round5(graph.lat[r.node]), near: r.place },
    railroad: r.railroad,
    arrives: { subdivision: subdivision(r.arrivedOn), headingDeg: r.arrivingDeg },
    leaves: { subdivision: subdivision(r.leftOn), headingDeg: r.leavingDeg },
    turnDeg: turnDeg(r.arrivingDeg, r.leavingDeg),
    track: r.arrivedOn === r.leftOn ? "stub-end" : "yard",
  }));
  const stopNodes = stops.map((p) => graph.serving(p, track));

  const legs: (Leg & { nodes: number[] })[] = [];
  const steps: Milestone[] = [];
  let km = 0;
  let nextStop = 0;
  let nextTurnBack = 0;
  let passesA = false;
  let first = true;

  const visit = (node: number, rr: number) => {
    if (!first && aNodes.has(node)) passesA = true;
    first = false;
    while (nextStop < stops.length && stopNodes[nextStop].get(rr) === node) {
      steps.push({ kind: "stop", kmFromB: km, stop: nextStop, label: stops[nextStop].label });
      nextStop++;
    }
  };

  for (const [legIndex, coreLeg] of route.legs.entries()) {
    const rr = LINES.indexOf(coreLeg.railroad);
    const railroad = coreLeg.railroad;
    // Each core leg is one line, so every leg after the first starts with an interchange. A change of railroad
    // right at B makes no leg of its own: on shared track the approach's railroad is a tie the search broke, not a fact.
    if (legIndex > 0) {
      steps.push({ kind: "interchange", kmFromB: km, from: route.legs[legIndex - 1].railroad, to: railroad, at: graph.nearestPlace(graph.lon[coreLeg.nodes[0]], graph.lat[coreLeg.nodes[0]]) });
    }
    visit(coreLeg.nodes[0], rr);
    let piece: (typeof legs)[number] | null = null;
    for (let j = 0; j + 1 < coreLeg.nodes.length; j++) {
      const u = coreLeg.nodes[j], v = coreLeg.nodes[j + 1];
      const edge = graph.edgeBetween(u, v);
      const reversal = route.reversals[nextTurnBack];
      if (reversal && reversal.node === u && reversal.leftOn === edge && Math.abs(reversal.km - km) < 0.01) {
        steps.push({ kind: "turn-back", kmFromB: km, turnBack: nextTurnBack++ });
        piece = null;
      }
      if (!piece) {
        piece = { railroad, km: 0, from: "", to: "", headingDeg: 0, subdivisions: [], path: [], nodes: [u] };
        steps.push({ kind: "leg", kmFromB: km, leg: legs.length });
        legs.push(piece);
      }
      piece.km += graph.edgeKm[edge];
      piece.nodes.push(v);
      const name = subdivision(edge);
      if (name && piece.subdivisions[piece.subdivisions.length - 1] !== name) piece.subdivisions.push(name);
      km += graph.edgeKm[edge];
      visit(v, rr);
    }
  }
  // Reversals the walk did not meet (none are expected) still get their row, so nothing goes unreported.
  for (; nextTurnBack < route.reversals.length; nextTurnBack++) {
    steps.push({ kind: "turn-back", kmFromB: route.reversals[nextTurnBack].km, turnBack: nextTurnBack });
  }
  for (; nextStop < stops.length; nextStop++) steps.push({ kind: "stop", kmFromB: km, stop: nextStop, label: stops[nextStop].label });
  steps.push({ kind: "shop", kmFromB: km });
  steps.sort((x, y) => x.kmFromB - y.kmFromB);

  const outLegs: Leg[] = legs.map(({ nodes, ...leg }) => {
    const x0 = graph.lon[nodes[0]], y0 = graph.lat[nodes[0]];
    const x1 = graph.lon[nodes[nodes.length - 1]], y1 = graph.lat[nodes[nodes.length - 1]];
    return {
      ...leg,
      from: graph.nearestPlace(x0, y0),
      to: graph.nearestPlace(x1, y1),
      headingDeg: Math.round(bearingDeg(x0, y0, x1, y1)),
      path: nodes.map((n) => lngLat([graph.lon[n], graph.lat[n]])),
    };
  });

  return {
    strategies: [strategy],
    km,
    interchanges: steps.filter((s) => s.kind === "interchange").length,
    railroads: [...new Set(outLegs.map((leg) => leg.railroad))],
    legs: outLegs,
    turnBacks,
    steps,
    passesA,
  };
}

/** Everything known about how a trip can run. `paths[0]` is the router's pick. */
export interface RoutedTrip {
  approach: Approach;
  straightKm: number;
  paths: [RoutePath, ...RoutePath[]];
}

export type Routed = { ok: true; trip: RoutedTrip } | { ok: false; noRoute: NoRoute };

/**
 * Folds the answers of several strategies into the distinct paths. `results[0]` must be the pick:
 * if it found no route, there is none. Two strategies that found the same line become one path
 * that lists both.
 */
export function combine(results: RouteResult[]): Routed {
  const [pick] = results;
  if (!pick) throw new Error("combine needs the pick's result first.");
  if (!pick.ok) return { ok: false, noRoute: pick.noRoute };
  const paths: [RoutePath, ...RoutePath[]] = [pick.path];
  for (const result of results.slice(1)) {
    if (!result.ok) continue;
    const i = paths.findIndex((known) => sameLine(known, result.path));
    if (i < 0) {
      paths.push(result.path);
    } else {
      const known = paths[i].strategies;
      paths[i] = { ...paths[i], strategies: [...known, ...result.path.strategies.filter((s) => !known.includes(s))] };
    }
  }
  return { ok: true, trip: { approach: pick.approach, straightKm: pick.straightKm, paths } };
}

/** Share of the route's length two paths must share to be one line to a person (parallel tracks a few metres apart). */
const SAME_LINE_OVERLAP = 0.95;

/**
 * One line on the ground, as a person reading the cards would see it. Railroad names are left out
 * on purpose: on shared track two railroads run over the same rails, and a card per name would show
 * one line several times. Nearly the same track counts too, but only with the same interchanges,
 * turn-backs and length, because those change the estimate. "Nearly the same" is measured in km,
 * not in points: a short stretch of parallel yard track has many points but is not a different line
 * (Temple, TX to Oakville, ON, 2026-11-17: 92 % of points but 99 % of km shared).
 */
function sameLine(x: RoutePath, y: RoutePath): boolean {
  if (x.turnBacks.length !== y.turnBacks.length) return false;
  const px = pointsOf(x), py = pointsOf(y);
  if (px.length === py.length && px.every((p, i) => p[0] === py[i][0] && p[1] === py[i][1])) return true;
  if (x.interchanges !== y.interchanges) return false;
  if (Math.abs(x.km - y.km) > Math.max(1, 0.01 * Math.max(x.km, y.km))) return false;
  // The same railroads changing at the same places: the two cards would read the same, word for word
  // (Fargo, ND to Edmonton, AB: BNSF to Winnipeg then CN, 10 m apart, drawn on parallel lines near Winnipeg).
  if (storyOf(x) === storyOf(y)) return true;
  return sharedShare(px, py) >= SAME_LINE_OVERLAP && sharedShare(py, px) >= SAME_LINE_OVERLAP;
}

/** What a card says about the way: each railroad and where it hands the car on. */
const storyOf = (path: RoutePath): string => path.legs.map((leg) => `${leg.railroad}>${leg.to}`).join("|");

/** Share of `a`'s length on segments whose two ends are also points of `b`. */
function sharedShare(a: LngLat[], b: LngLat[]): number {
  const inB = new Set(b.map(([lon, lat]) => `${lon},${lat}`));
  let total = 0, shared = 0;
  for (let i = 1; i < a.length; i++) {
    const km = haversineKm(a[i - 1][0], a[i - 1][1], a[i][0], a[i][1]);
    total += km;
    if (inB.has(`${a[i - 1][0]},${a[i - 1][1]}`) && inB.has(`${a[i][0]},${a[i][1]}`)) shared += km;
  }
  return total > 0 ? shared / total : 1;
}

function pointsOf(path: RoutePath): LngLat[] {
  const points: LngLat[] = [];
  for (const leg of path.legs) {
    for (const point of leg.path) {
      const last = points[points.length - 1];
      if (!last || last[0] !== point[0] || last[1] !== point[1]) points.push(point);
    }
  }
  return points;
}

/**
 * Identity of a trip for caching: equal keys route alike. Built from the network version, each
 * waypoint's FRA id (or rounded coordinates) and railroad, and the routing rules. Labels are not in it.
 */
export function tripKey(networkVersion: string, trip: Trip): string {
  const place = (w: Waypoint): (number | string | null)[] =>
    w.fraId !== null ? [w.fraId as FraId, w.railroad] : [round5(w.lon), round5(w.lat), w.railroad];
  const { allowedMask, passenger } = trackOf(trip.rules);
  return JSON.stringify([networkVersion, place(trip.a), place(trip.b), trip.stops.map(place), place(trip.shop), allowedMask, passenger, trip.rules.interchangePenaltyKm]);
}
