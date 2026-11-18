/**
 * Routing one plan: from the start, through the stops in order, to the destination. In: waypoints with
 * stable ids. Out: paths with stable ids. The node and edge indexes of engine/core never leave this file.
 */
import { haversineKm, round5, type LngLat } from "../shared/geo.ts";
import type { FraId, Waypoint } from "../shared/places.ts";
import { DEFAULT_INCLUDE, LINES, RAILROADS, type TrackIncluded } from "../shared/railroads.ts";
import type { Leg, Milestone, RoutePath, RouteStrategy, TurnBack } from "../shared/route.ts";
import { ALL_RAILROADS_MASK, MAX_SNAP_KM, REGIONAL, SHORT_LINE, type Point, type RailGraph, type Track } from "./core/graph.ts";
import { RouteError, Router, turnDeg, type Route, type RouteOptions } from "./core/router.ts";
import { coreOf, type RailNetwork } from "./network.ts";

export interface Trip {
  start: Waypoint;
  stops: Waypoint[];
  destination: Waypoint;
  /** Track beyond the Class I railroads the route may use. */
  include: TrackIncluded;
}

export interface NoRoute {
  /**
   * "not-served": no railroad has track at that waypoint. "no-path": nothing joins them without reversing outside a yard.
   * "dead-end": the stop is reached, but every way of reaching it faces away from the next waypoint.
   */
  kind: "not-served" | "no-path" | "dead-end";
  /** The waypoint at fault: "start", "destination", or the index of a stop. */
  at: "start" | "destination" | number;
  message: string;
}

export type RouteResult = { ok: true; path: RoutePath } | { ok: false; noRoute: NoRoute };

/**
 * A router bound to one network. It holds about 85 MB of search scratch and is not re-entrant:
 * one per thread, one `route` call at a time. Creating it takes about 20 ms.
 */
export interface CarRouter {
  /** One way to run the trip. "No route" is an answer. Deterministic for a given network version. */
  route(trip: Trip, strategy: RouteStrategy): RouteResult;
}

/** Extra km the router accepts to avoid changing railroad. */
const INTERCHANGE_PENALTY_KM = 500;
const REVERSE_KM = 100;

/**
 * Every Class I railroad, plus regional railroads and short lines when included. Passenger-owned track is
 * included unless turned off; the router then uses it only where no freight-owned way is close in length
 * (core/router.ts PASSENGER_TRACK_COST).
 */
function trackOf(include: TrackIncluded = DEFAULT_INCLUDE): Track {
  const allowedMask = ALL_RAILROADS_MASK | (include.regional ? 1 << REGIONAL : 0) | (include.shortLine ? 1 << SHORT_LINE : 0);
  return { allowedMask, passenger: include.passenger };
}

/** Routing penalties per strategy. They steer which path is found; `km` stays real track distance. */
function costsOf(strategy: RouteStrategy): Omit<RouteOptions, keyof Track> {
  switch (strategy) {
    case "pick":
      return { interchangeKm: INTERCHANGE_PENALTY_KM, reverseKm: REVERSE_KM };
    case "shortest":
      // Where railroads share track, a free interchange would win ties and invent a change of railroad: 1 km.
      return { interchangeKm: 1, reverseKm: 0 };
    case "fewest-interchanges":
      return { interchangeKm: 100_000, reverseKm: REVERSE_KM };
    case "no-turn-backs":
      return { interchangeKm: INTERCHANGE_PENALTY_KM, reverseKm: Infinity };
  }
}

type At = NoRoute["at"];

/** How a message names a waypoint. Never its label: results are cached under keys without labels. */
function roleOf(at: At): string {
  return at === "start" ? "the start" : at === "destination" ? "the destination" : `stop ${at + 1}`;
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
    if (!p) return { kind: "not-served", at, message: `${capital(roleOf(at))} is FRA node ${w.fraId}, which this network does not have.` };
    if (graph.serving(p, track).size) return null;
    const where = p.node !== undefined ? `track at ${roleOf(at)} (FRA node ${w.fraId})` : `mainline within ${MAX_SNAP_KM} km of ${roleOf(at)}`;
    const message = w.railroad ? `${w.railroad} has no ${where}.` : `No allowed railroad has ${where}.`;
    return { kind: "not-served", at, message };
  };

  /**
   * Of two points no route joins, the one on the smaller piece of the allowed network; null when both are
   * on one piece, so direction (no turning back) blocks the route rather than the track.
   */
  const cutOff = (from: Point, to: Point, track: Track): "from" | "to" | null => {
    const near = graph.piece(graph.serving(from, track).values(), track);
    if ([...graph.serving(to, track).values()].some((node) => near.has[node])) return null;
    return near.size < graph.piece(graph.serving(to, track).values(), track).size ? "from" : "to";
  };

  return {
    route(trip, strategy) {
      const track = trackOf(trip.include);
      const options: RouteOptions = { ...track, ...costsOf(strategy) };

      const ends: [Waypoint, At][] = [[trip.start, "start"], ...trip.stops.map((w, i): [Waypoint, At] => [w, i]), [trip.destination, "destination"]];
      const points: Point[] = [];
      for (const [w, at] of ends) {
        const p = pointOf(w);
        const problem = notServed(w, p, at, track);
        if (problem) return { ok: false, noRoute: problem };
        points.push(p!);
      }
      const atOf = (point: number): At => (point === points.length - 1 ? "destination" : point === 0 ? "start" : point - 1);

      let route: Route;
      try {
        route = router.route(points, options);
      } catch (error) {
        if (!(error instanceof RouteError)) throw error;
        if (error.deadEnd) {
          const message = `${capital(roleOf(atOf(error.point)))} is reached, but the route cannot go on from it to ${roleOf(atOf(error.point + 1))} without turning back outside a yard.`;
          return { ok: false, noRoute: { kind: "dead-end", at: atOf(error.point), message } };
        }
        const target = error.point > 0 ? error.point : points.length - 1;
        const message = `No route from ${roleOf(atOf(target - 1))} to ${roleOf(atOf(target))} on the track allowed, without turning back outside a yard.`;
        // Blame the end the allowed track cuts off (Oakville, ON without passenger-owned track, 2026-11-18).
        const cut = cutOff(points[target - 1], points[target], track);
        return { ok: false, noRoute: { kind: "no-path", at: atOf(cut === "from" ? target - 1 : target), message } };
      }
      return { ok: true, path: describe(graph, route, strategy, points.slice(1, -1), track) };
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
  // A stop pinned to a railroad is reached on that railroad. Any other stop is reached at any line's entry node:
  // the router may arrive on one line and change railroad right there, at another line's entry node (2026-11-18).
  const reaches = (stop: number, node: number, rr: number) =>
    stops[stop].only !== undefined ? stopNodes[stop].get(rr) === node : [...stopNodes[stop].values()].includes(node);

  const legs: (Leg & { nodes: number[] })[] = [];
  const steps: Milestone[] = [];
  let km = 0;
  let nextStop = 0;
  let nextTurnBack = 0;
  const visit = (node: number, rr: number) => {
    while (nextStop < stops.length && reaches(nextStop, node, rr)) {
      steps.push({ kind: "stop", kmFromStart: km, stop: nextStop, label: stops[nextStop].label });
      nextStop++;
    }
  };

  for (const [legIndex, coreLeg] of route.legs.entries()) {
    const rr = LINES.indexOf(coreLeg.railroad);
    const railroad = coreLeg.railroad;
    // Each core leg is one line, so every leg after the first starts with an interchange.
    if (legIndex > 0) {
      steps.push({ kind: "interchange", kmFromStart: km, from: route.legs[legIndex - 1].railroad, to: railroad, at: graph.nearestPlace(graph.lon[coreLeg.nodes[0]], graph.lat[coreLeg.nodes[0]]) });
    }
    visit(coreLeg.nodes[0], rr);
    let piece: (typeof legs)[number] | null = null;
    for (let j = 0; j + 1 < coreLeg.nodes.length; j++) {
      const u = coreLeg.nodes[j], v = coreLeg.nodes[j + 1];
      const edge = graph.edgeBetween(u, v);
      const reversal = route.reversals[nextTurnBack];
      if (reversal && reversal.node === u && reversal.leftOn === edge && Math.abs(reversal.km - km) < 0.01) {
        steps.push({ kind: "turn-back", kmFromStart: km, turnBack: nextTurnBack++ });
        piece = null;
      }
      if (!piece) {
        piece = { railroad, km: 0, from: "", to: "", headingDeg: 0, subdivisions: [], path: [], nodes: [u] };
        steps.push({ kind: "leg", kmFromStart: km, leg: legs.length });
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
    steps.push({ kind: "turn-back", kmFromStart: route.reversals[nextTurnBack].km, turnBack: nextTurnBack });
  }
  for (; nextStop < stops.length; nextStop++) steps.push({ kind: "stop", kmFromStart: km, stop: nextStop, label: stops[nextStop].label });
  steps.push({ kind: "destination", kmFromStart: km });
  steps.sort((x, y) => x.kmFromStart - y.kmFromStart);

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
  };
}

/** The distinct ways a trip can run. `paths[0]` is the router's pick. */
export type Routed = { ok: true; paths: [RoutePath, ...RoutePath[]] } | { ok: false; noRoute: NoRoute };

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
  return { ok: true, paths };
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
 * waypoint's FRA id (or rounded coordinates) and railroad, and the track included. Labels are not in it.
 */
export function tripKey(networkVersion: string, trip: Trip): string {
  const place = (w: Waypoint): (number | string | null)[] =>
    w.fraId !== null ? [w.fraId as FraId, w.railroad] : [round5(w.lon), round5(w.lat), w.railroad];
  const { allowedMask, passenger } = trackOf(trip.include);
  return JSON.stringify([networkVersion, place(trip.start), trip.stops.map(place), place(trip.destination), allowedMask, passenger]);
}
