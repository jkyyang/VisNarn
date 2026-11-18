/**
 * Routing one trip through its points in order: the start, any stops, the destination. In: waypoints
 * with stable ids. Out: paths with stable ids. The node and edge indexes of engine/core stay in this file.
 */
import { round5, roundLngLat, type LngLat } from "../shared/geo.ts";
import type { FraId, Waypoint } from "../shared/places.ts";
import { LINES, RAILROADS, type Line, type TrackIncluded } from "../shared/railroads.ts";
import type { Leg, Milestone, RoutePath, RouteStrategy, TurnBack } from "../shared/route.ts";
import { ALL_RAILROADS_MASK, REGIONAL, SHORT_LINE, type Point, type RailGraph, type Track } from "./core/graph.ts";
import { RouteError, Router, SPUR, turnDeg, type Route, type RouteOptions } from "./core/router.ts";
import { coreOf, type RailNetwork } from "./network.ts";
import { INTERCHANGE_PENALTY_KM, NEAR_DUPLICATE_SHARE, REVERSE_KM, SNAP_KM } from "./rules.ts";

export interface Trip {
  /** Travel order, 2 or more. */
  points: Waypoint[];
  /** Track beyond the Class I railroads the route may use. */
  include: TrackIncluded;
  /** The route may leave a stop in either direction. A shop with one link is always left that way, back out of its track. */
  turnAtStops: boolean;
}

export interface NoRoute {
  /**
   * "not-served": no railroad has track at that waypoint. "no-path": nothing joins them without reversing outside a yard.
   * "dead-end": the stop is reached, but every way of reaching it faces away from the next waypoint.
   */
  kind: "not-served" | "no-path" | "dead-end";
  /** The point at fault: an index into `Trip.points`. */
  at: number;
  /** One line for a developer; the planner shows its own words. */
  message: string;
}

export type RouteResult = { ok: true; path: RoutePath } | { ok: false; noRoute: NoRoute };

/**
 * A router bound to one network. It holds about 85 MB of search scratch and is not re-entrant:
 * one per thread, one `route` call at a time. Creating it takes about 20 ms.
 */
export interface CarRouter {
  /** One way to run the trip; {ok: false} when there is no route. Deterministic for a given network version. */
  route(trip: Trip, strategy: RouteStrategy): RouteResult;
}


/**
 * Every Class I railroad, plus regional railroads and short lines when included. Passenger-owned track is
 * included unless turned off; the router then uses it only where no freight-owned way is close in length
 * (core/router.ts PASSENGER_TRACK_COST).
 */
function trackOf(include: TrackIncluded): Track {
  const allowedMask = ALL_RAILROADS_MASK | (include.regional ? 1 << REGIONAL : 0) | (include.shortLine ? 1 << SHORT_LINE : 0);
  return { allowedMask, passenger: include.passenger };
}

/** Fewest interchanges: any length of single-railroad track beats a change of railroad. */
const NO_INTERCHANGE_KM = 100_000;

/** Routing penalties per strategy. They steer which path is found; `km` stays real track distance. */
function costsOf(strategy: RouteStrategy): Pick<RouteOptions, "interchangeKm" | "reverseKm"> {
  switch (strategy) {
    case "pick":
      return { interchangeKm: INTERCHANGE_PENALTY_KM, reverseKm: REVERSE_KM };
    case "shortest":
      // Where railroads share track, a free interchange would win ties and invent a change of railroad: 1 km.
      return { interchangeKm: 1, reverseKm: 0 };
    case "fewest-interchanges":
      return { interchangeKm: NO_INTERCHANGE_KM, reverseKm: REVERSE_KM };
    case "no-turn-backs":
      return { interchangeKm: INTERCHANGE_PENALTY_KM, reverseKm: Infinity };
  }
}

/** How a message names a point. Never its label: results are cached under keys without labels. */
const nameOf = (at: number) => `point ${at + 1}`;

export function createCarRouter(network: RailNetwork): CarRouter {
  const graph = coreOf(network);
  const router = new Router(graph);

  /** Null when the network has no node for the waypoint's FRA id or one of its links'. */
  const pointOf = (w: Waypoint): Point | null => {
    const point: Point = { label: w.label, lon: w.lon, lat: w.lat, only: w.railroad ? RAILROADS.indexOf(w.railroad) : undefined };
    if (w.links?.length) {
      const links = w.links.map(({ fraId, km }) => ({ node: graph.indexOf(fraId), km }));
      return links.every((link) => link.node >= 0) ? { ...point, links } : null;
    }
    if (w.fraId === null) return point;
    const node = graph.indexOf(w.fraId);
    return node < 0 ? null : { ...point, node };
  };

  /** Why no allowed railroad can serve this waypoint, or null when one can. */
  const notServed = (w: Waypoint, p: Point | null, at: number, track: Track): NoRoute | null => {
    if (!p) {
      const lost = w.links?.find((link) => graph.indexOf(link.fraId) < 0)?.fraId ?? w.fraId;
      return { kind: "not-served", at, message: `${nameOf(at)} (FRA node ${lost}) is not in this network` };
    }
    if (graph.serving(p, track).length) return null;
    const where = p.links ? `track at the links of ${nameOf(at)}` : p.node !== undefined ? `track at ${nameOf(at)} (FRA node ${w.fraId})` : `mainline within ${SNAP_KM} km of ${nameOf(at)}`;
    return { kind: "not-served", at, message: w.railroad ? `${w.railroad} has no ${where}` : `no allowed railroad has ${where}` };
  };

  /**
   * Of two points no route joins, the one on the smaller piece of the allowed network; null when both are
   * on one piece, so direction (no turning back) blocks the route rather than the track.
   */
  const cutOff = (from: Point, to: Point, track: Track): "from" | "to" | null => {
    const nodes = (p: Point) => graph.serving(p, track).map((entry) => entry.node);
    const near = graph.piece(nodes(from), track);
    if (nodes(to).some((node) => near.has[node])) return null;
    return near.size < graph.piece(nodes(to), track).size ? "from" : "to";
  };

  return {
    route(trip, strategy) {
      const track = trackOf(trip.include);
      const options: RouteOptions = { ...track, ...costsOf(strategy), turnAtStops: trip.turnAtStops };

      const points: Point[] = [];
      for (const [at, w] of trip.points.entries()) {
        const p = pointOf(w);
        const problem = notServed(w, p, at, track);
        if (problem) return { ok: false, noRoute: problem };
        points.push(p!);
      }

      let route: Route;
      try {
        route = router.route(points, options);
      } catch (error) {
        if (!(error instanceof RouteError)) throw error;
        if (error.deadEnd) {
          const message = `${nameOf(error.point)} is reached but cannot be left toward ${nameOf(error.point + 1)} without turning back outside a yard`;
          return { ok: false, noRoute: { kind: "dead-end", at: error.point, message } };
        }
        const target = error.point > 0 ? error.point : points.length - 1;
        const message = `no route from ${nameOf(target - 1)} to ${nameOf(target)} on the track allowed without turning back outside a yard`;
        // Blame the end the allowed track cuts off (Oakville, ON without passenger-owned track, 2026-11-18).
        const cut = cutOff(points[target - 1], points[target], track);
        return { ok: false, noRoute: { kind: "no-path", at: cut === "from" ? target - 1 : target, message } };
      }
      return { ok: true, path: describe(graph, route, strategy, points, track) };
    },
  };
}


/** Initial great-circle bearing from one point to another, degrees clockwise from north. */
function bearingDeg(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const r = Math.PI / 180;
  const y = Math.sin((lon2 - lon1) * r) * Math.cos(lat2 * r);
  const x = Math.cos(lat1 * r) * Math.sin(lat2 * r) - Math.sin(lat1 * r) * Math.cos(lat2 * r) * Math.cos((lon2 - lon1) * r);
  return ((Math.atan2(y, x) / r) % 360 + 360) % 360;
}

/**
 * The core route as a RoutePath: indexes become FRA ids and coordinates here, once. Legs are split at
 * turn-backs and where the car backs out of a shop, so each has one direction, and the steps are read off
 * in travel order. A linked point's own track is added here: the core route is network track only.
 */
function describe(
  graph: RailGraph,
  route: Route,
  strategy: RouteStrategy,
  points: Point[],
  track: Track,
): RoutePath {
  const subdivision = (edge: number) => (edge >= 0 ? graph.meta.subdivs[graph.edgeSubdiv[edge]] || null : null);
  const turnBacks: TurnBack[] = route.reversals.map((r) => ({
    at: { fraId: graph.fraId(r.node), lon: round5(graph.lon[r.node]), lat: round5(graph.lat[r.node]), near: r.place },
    railroad: r.railroad,
    arrives: { subdivision: subdivision(r.arrivedOn), headingDeg: r.arrivingDeg },
    leaves: { subdivision: subdivision(r.leftOn), headingDeg: r.leavingDeg },
    turnDeg: turnDeg(r.arrivingDeg, r.leavingDeg),
    // Off yard track the rules allow a reversal only at a stop the plan lets the route turn at.
    track: !(graph.edgeYard[r.arrivedOn] && graph.edgeYard[r.leftOn]) ? "stop" : r.arrivedOn === r.leftOn ? "stub-end" : "yard",
  }));
  const [start, destination] = [points[0], points[points.length - 1]];
  const stops = points.slice(1, -1);
  const stopNodes = stops.map((p) => graph.serving(p, track));
  // A stop pinned to a railroad is reached on that railroad. Any other stop is reached at any line's entry node:
  // the router may arrive on one line and change railroad right there, at another line's entry node (2026-11-18).
  // A linked stop is reached at the end of its own track, where the route leaves the network for it.
  const reaches = (stop: number, node: number, rr: number) =>
    !stops[stop].links && stopNodes[stop].some((entry) => entry.node === node && (stops[stop].only === undefined || entry.line === rr));
  /** The point's own track to a node it is linked at. */
  const ownKm = (p: Point, node: number) => p.links!.find((link) => link.node === node)!.km;
  const at = (node: number): [number, number] => [graph.lon[node], graph.lat[node]];

  const legs: (Omit<Leg, "path"> & { points: [number, number][] })[] = [];
  const steps: Milestone[] = [];
  let km = 0;
  let nextStop = 0;
  let nextTurnBack = 0;
  let piece: (typeof legs)[number] | null = null;
  const visit = (node: number, rr: number) => {
    while (nextStop < stops.length && reaches(nextStop, node, rr)) {
      steps.push({ kind: "stop", kmFromStart: km, stop: nextStop, label: stops[nextStop].label });
      nextStop++;
    }
  };
  const open = (railroad: Line, from: [number, number]) => {
    const opened = { railroad, km: 0, from: "", to: "", headingDeg: 0, subdivisions: [], points: [from] };
    steps.push({ kind: "leg", kmFromStart: km, leg: legs.length });
    legs.push(opened);
    return opened;
  };
  /** The car moves `length` km to a point: along the current piece of the route. */
  const move = (to: [number, number], length: number) => {
    piece!.points.push(to);
    piece!.km += length;
    km += length;
  };

  for (const [legIndex, coreLeg] of route.legs.entries()) {
    const rr = LINES.indexOf(coreLeg.railroad);
    const railroad = coreLeg.railroad;
    piece = null;
    // Each core leg is one line, so every leg after the first starts with an interchange.
    if (legIndex > 0) {
      steps.push({ kind: "interchange", kmFromStart: km, from: route.legs[legIndex - 1].railroad, to: railroad, at: graph.nearestPlace(graph.lon[coreLeg.nodes[0]], graph.lat[coreLeg.nodes[0]]) });
    }
    visit(coreLeg.nodes[0], rr);
    for (const [j, edge] of coreLeg.edges.entries()) {
      const u = coreLeg.nodes[j], v = coreLeg.nodes[j + 1];
      const reversal = route.reversals[nextTurnBack];
      if (reversal?.leg === legIndex && reversal.step === j) {
        steps.push({ kind: "turn-back", kmFromStart: km, turnBack: nextTurnBack++ });
        piece = null;
      }
      if (!piece) {
        // A linked start: the route begins on its own track.
        const first = start.links && !legs.length;
        piece = open(railroad, first ? [start.lon, start.lat] : at(u));
        if (first) move(at(u), ownKm(start, u));
      }
      if (edge === SPUR) {
        // Into the next stop's own track and out again: back the same way at a stub, on at the other link of a through shop.
        const stop = stops[nextStop];
        move([stop.lon, stop.lat], ownKm(stop, u));
        steps.push({ kind: "stop", kmFromStart: km, stop: nextStop, label: stop.label });
        if (u === v) {
          steps.push({ kind: "back-out", kmFromStart: km, stop: nextStop });
          piece = open(railroad, [stop.lon, stop.lat]);
        }
        nextStop++;
        move(at(v), ownKm(stop, v));
      } else {
        move(at(v), graph.edgeKm[edge]);
        const name = subdivision(edge);
        if (name && piece!.subdivisions[piece!.subdivisions.length - 1] !== name) piece!.subdivisions.push(name);
      }
      visit(v, rr);
    }
  }
  // The route ends on the destination's own track.
  if (destination.links && piece) move([destination.lon, destination.lat], ownKm(destination, route.legs.at(-1)!.nodes.at(-1)!));
  for (; nextStop < stops.length; nextStop++) steps.push({ kind: "stop", kmFromStart: km, stop: nextStop, label: stops[nextStop].label });
  steps.push({ kind: "destination", kmFromStart: km });
  steps.sort((x, y) => x.kmFromStart - y.kmFromStart);

  const outLegs: Leg[] = legs.map(({ points: path, ...leg }) => {
    const [x0, y0] = path[0], [x1, y1] = path[path.length - 1];
    return {
      ...leg,
      from: graph.nearestPlace(x0, y0),
      to: graph.nearestPlace(x1, y1),
      headingDeg: Math.round(bearingDeg(x0, y0, x1, y1)),
      path: path.map(([x, y]) => roundLngLat(x, y)),
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
 * if it found no route, there is none. A path that is the same line as one already kept (sameLine)
 * is not kept: that path lists its strategy too.
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

/**
 * One route to a person reading the cards: the same points, or the same turn-backs and interchanges at
 * nearly the same length (NEAR_DUPLICATE_SHARE). Railroad names are left out on purpose: on shared track
 * two railroads run over the same rails, and a card per name would show one line several times.
 */
function sameLine(x: RoutePath, y: RoutePath): boolean {
  if (x.turnBacks.length !== y.turnBacks.length) return false;
  const px = pointsOf(x), py = pointsOf(y);
  if (px.length === py.length && px.every((p, i) => p[0] === py[i][0] && p[1] === py[i][1])) return true;
  return x.interchanges === y.interchanges && Math.abs(x.km - y.km) <= NEAR_DUPLICATE_SHARE * Math.max(x.km, y.km);
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
 * waypoint's FRA id (or rounded coordinates), railroad and links, the track included and turning at stops. Labels are not in it.
 */
export function tripKey(networkVersion: string, trip: Trip): string {
  const place = (w: Waypoint): unknown[] => {
    const at = w.fraId !== null ? [w.fraId as FraId, w.railroad] : [round5(w.lon), round5(w.lat), w.railroad];
    return w.links?.length ? [...at, w.links.map((link) => [link.fraId, link.km])] : at;
  };
  const { allowedMask, passenger } = trackOf(trip.include);
  return JSON.stringify([networkVersion, trip.points.map(place), allowedMask, passenger, trip.turnAtStops]);
}
