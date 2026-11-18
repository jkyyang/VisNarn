/** The engine's contract as the server sees it: stable ids in and out, alternatives, turn-back facts. */
import { beforeAll, describe, expect, it } from "vitest";
import { haversineKm, pathKm, type LngLat } from "../shared/geo.ts";
import type { FraId, Waypoint } from "../shared/places.ts";
import { DEFAULT_INCLUDE, type Line, type Railroad } from "../shared/railroads.ts";
import { ROUTE_STRATEGIES, type RoutePath, type RouteStrategy } from "../shared/route.ts";
import { loadNetwork } from "./load.ts";
import { ALL_RAILROADS_MASK } from "./core/graph.ts";
import { nodePoint } from "./core/testing.ts";
import { NEAR_DUPLICATE_SHARE } from "./rules.ts";
import { coreOf, type RailNetwork } from "./network.ts";
import { combine, createCarRouter, tripKey, type CarRouter, type RouteResult, type Trip } from "./trip.ts";

let network: RailNetwork;
let router: CarRouter;

beforeAll(() => {
  network = loadNetwork();
  router = createCarRouter(network);
});

const city = (name: string, railroad: Railroad | null = null): Waypoint => {
  const c = network.city(name);
  if (!c) throw new Error(`no city ${name}`);
  return { label: c.name, lon: c.lon, lat: c.lat, fraId: null, railroad };
};
const trip = (start: Waypoint, destination: Waypoint, stops: Waypoint[] = []): Trip => ({ points: [start, ...stops, destination], include: DEFAULT_INCLUDE, turnAtStops: false });
const exampleTrip = (): Trip => trip(city("Temple, TX"), city("North Little Rock, AR"));
/** Arriving at Temple from Taylor, the route can only head for Little Rock by turning back on yard track. */
const viaTemple = (): Trip => trip(city("Taylor, TX"), city("North Little Rock, AR"), [city("Temple, TX")]);

function routed(trip: Trip, strategy: (typeof ROUTE_STRATEGIES)[number] = "pick") {
  const result = router.route(trip, strategy);
  if (!result.ok) throw new Error(result.noRoute.message);
  return result;
}

/** Where the path is `km` along it, measured on the drawn line scaled to the leg's track km. */
function pointAtKm(path: RoutePath, km: number): LngLat {
  let start = 0;
  for (const leg of path.legs) {
    if (km <= start + leg.km || leg === path.legs[path.legs.length - 1]) {
      const pieces = leg.path.slice(1).map((p, i) => haversineKm(leg.path[i][0], leg.path[i][1], p[0], p[1]));
      const scale = leg.km / Math.max(1e-9, pieces.reduce((s, d) => s + d, 0));
      let left = km - start;
      for (let i = 0; i < pieces.length; i++) {
        if (left <= pieces[i] * scale) return leg.path[i + 1];
        left -= pieces[i] * scale;
      }
      return leg.path[leg.path.length - 1];
    }
    start += leg.km;
  }
  throw new Error("empty path");
}

/** The railroad the car is on at a step: the last leg row above it. */
function railroadAtStep(path: RoutePath, stepIndex: number): Line {
  const legRow = path.steps.slice(0, stepIndex).reverse().find((s) => s.kind === "leg");
  if (!legRow || legRow.kind !== "leg") throw new Error("no leg before the step");
  return path.legs[legRow.leg].railroad;
}

describe("createCarRouter().route", () => {
  it("keeps its direction through a stop (Taylor → Temple → North Little Rock) and may leave the start either way", () => {
    const { path } = routed(viaTemple());
    expect(path.steps[0].kmFromStart).toBe(0);
    expect(path.steps.at(-1)).toEqual({ kind: "destination", kmFromStart: path.km });
    expect(path.turnBacks.map((t) => t.at.near)).toContain("Temple, TX");
    expect(routed(exampleTrip()).path.turnBacks.filter((t) => t.at.near === "Temple, TX")).toEqual([]);
  });

  it("returns FRA ids, 5-dp coordinates and names only: no field of the result is a graph index", () => {
    const result = routed(viaTemple());
    const keys = new Set<string>();
    const coordinates: number[] = [];
    const fraIds: number[] = [];
    const walk = (value: unknown, key: string) => {
      if (Array.isArray(value)) value.forEach((v) => walk(v, key));
      else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) (keys.add(k), walk(v, k));
      else if (typeof value === "number" && (key === "path" || key === "paths" || key === "lon" || key === "lat")) coordinates.push(value);
      else if (key === "fraId") fraIds.push(value as number);
    };
    walk(result, "");
    for (const banned of ["node", "nodes", "edge", "edges", "index", "arrivedOn", "leftOn", "rr"]) expect(keys.has(banned), banned).toBe(false);
    expect(coordinates.length).toBeGreaterThan(100);
    expect(coordinates.filter((n) => Math.round(n * 1e5) / 1e5 !== n)).toEqual([]);
    expect(fraIds.length).toBeGreaterThan(0);
    for (const id of fraIds) expect(network.node(id as FraId)?.fraId).toBe(id);
  });

  it("gives the same path for a waypoint by FRA id and by that node's coordinates when they snap to it", () => {
    const graph = coreOf(network);
    const nlr = network.city("North Little Rock, AR")!;
    const same = (i: number) => {
      const asNode = [...graph.serving(nodePoint(graph, i), { allowedMask: ALL_RAILROADS_MASK, passenger: true })];
      const asCoordinates = [...graph.serving({ label: "", lon: graph.lon[i], lat: graph.lat[i] }, { allowedMask: ALL_RAILROADS_MASK, passenger: true })];
      return asNode.length > 1 && JSON.stringify(asNode) === JSON.stringify(asCoordinates);
    };
    const candidates = [...Array(graph.nodeCount).keys()]
      .filter((i) => graph.mainMask[i] && haversineKm(nlr.lon, nlr.lat, graph.lon[i], graph.lat[i]) < 10)
      .sort((x, y) => haversineKm(nlr.lon, nlr.lat, graph.lon[x], graph.lat[x]) - haversineKm(nlr.lon, nlr.lat, graph.lon[y], graph.lat[y]));
    const node = candidates.find(same);
    expect(node).toBeDefined();
    const exact = network.node(graph.fraId(node!))!;
    const byId: Waypoint = { label: "shop", lon: exact.lon, lat: exact.lat, fraId: exact.fraId, railroad: null };
    const byCoordinates: Waypoint = { ...byId, fraId: null };
    const one = routed(trip(city("Temple, TX"), byId));
    const other = routed(trip(city("Temple, TX"), byCoordinates));
    expect(other.path).toEqual(one.path);
  });

  it("reaches a shop on a short line only when short lines are included (Ville Platte, LA: UP is 20 km away)", () => {
    const villePlatte: Waypoint = { label: "Ville Platte, LA", lon: -92.271, lat: 30.688, fraId: null, railroad: null };
    const toVillePlatte = trip(city("Baton Rouge, LA"), villePlatte);
    expect(router.route(toVillePlatte, "pick")).toMatchObject({ ok: false, noRoute: { kind: "not-served", at: 1 } });
    const { path } = routed({ ...toVillePlatte, include: { regional: false, shortLine: true, passenger: true } });
    const last = path.legs[path.legs.length - 1];
    expect(last.railroad).toBe("short line");
    expect(path.steps.find((step) => step.kind === "interchange")).toMatchObject({ from: "UP", to: "short line" });
    expect(haversineKm(villePlatte.lon, villePlatte.lat, ...last.path[last.path.length - 1])).toBeLessThan(1);
  });

  it("reaches the Oakville, ON shop over GO Transit's track by default, and not at all with passenger-owned track turned off", () => {
    const oakville: Waypoint = { label: "Oakville, ON", lon: -79.7195, lat: 43.4169, fraId: null, railroad: null };
    const noPassenger = { regional: false, shortLine: false, passenger: false };
    expect(router.route(trip(city("Temple, TX"), oakville), "pick").ok).toBe(true);
    expect(router.route({ ...trip(city("Temple, TX"), oakville), include: noPassenger }, "pick")).toEqual({
      ok: false,
      noRoute: { kind: "no-path", at: 1, message: "no route from point 1 to point 2 on the track allowed without turning back outside a yard" },
    });
    // Leaving from Oakville, Oakville is still the place cut off, with or without a stop.
    const from: Trip = { ...trip(oakville, city("North Little Rock, AR")), include: noPassenger };
    expect(router.route(from, "pick")).toMatchObject({ ok: false, noRoute: { kind: "no-path", at: 0 } });
    expect(router.route({ ...from, points: [oakville, city("Chicago, IL"), city("North Little Rock, AR")] }, "pick")).toMatchObject({ ok: false, noRoute: { kind: "no-path", at: 0 } });
  });

  it("honours a waypoint's railroad: a stop pinned to BNSF is not reached on UP", () => {
    for (const railroad of ["BNSF", "UP"] as const) {
      const { path } = routed(trip(city("Temple, TX"), city("North Little Rock, AR"), [city("Fort Worth, TX", railroad)]));
      const stopRow = path.steps.findIndex((s) => s.kind === "stop");
      expect(stopRow).toBeGreaterThan(0);
      expect(railroadAtStep(path, stopRow)).toBe(railroad);
    }
  });

  it("splits legs at a turn-back and reports subdivisions, headings, angle and yard / stub-end", () => {
    const { path } = routed(viaTemple());
    const [temple] = path.turnBacks;
    expect(temple).toMatchObject({ railroad: "BNSF", track: "stub-end", at: { near: "Temple, TX" } });
    expect(temple.arrives.subdivision).toEqual(expect.any(String));
    expect(temple.leaves.subdivision).toEqual(expect.any(String));
    expect(temple.turnDeg).toBeGreaterThan(90);
    expect(temple.turnDeg).toBeLessThanOrEqual(180);
    for (const heading of [temple.arrives.headingDeg, temple.leaves.headingDeg]) expect(heading >= 0 && heading < 360).toBe(true);
    // Each turn-back row is followed by the leg that leaves it, at the same km, so a leg has one direction.
    path.steps.forEach((step, i) => {
      if (step.kind !== "turn-back") return;
      expect(path.steps[i + 1]).toMatchObject({ kind: "leg", kmFromStart: step.kmFromStart });
    });
    expect(path.legs.length).toBe(path.turnBacks.length + path.interchanges + 1);
    expect(path.legs.at(-1)!.subdivisions.length).toBeGreaterThan(1);
  });

  it("places each stop row at the km where the path reaches it", () => {
    const kc = city("Kansas City, MO");
    const { path } = routed(trip(city("Austin, TX"), city("Chicago, IL"), [kc]));
    const stop = path.steps.find((s) => s.kind === "stop");
    expect(stop).toMatchObject({ kind: "stop", stop: 0, label: "Kansas City, MO" });
    expect(stop!.kmFromStart).toBeGreaterThan(0);
    expect(stop!.kmFromStart).toBeLessThan(path.km);
    const [lon, lat] = pointAtKm(path, stop!.kmFromStart);
    expect(haversineKm(lon, lat, kc.lon, kc.lat)).toBeLessThan(15);
    const kms = path.steps.map((s) => s.kmFromStart);
    expect(kms).toEqual([...kms].sort((x, y) => x - y));
  });

  it("places stop rows where every option passes them, also when a cheap interchange lands right on the stop", () => {
    // Shortest makes interchanges almost free, so it reaches Chicago on one line and leaves on another (2026-11-18).
    const stops = [city("Chicago, IL"), city("Kansas City, MO")];
    const oakville: Waypoint = { label: "EXAMPLE Oakville shop", lon: -79.7195, lat: 43.4169, fraId: null, railroad: null };
    for (const strategy of ROUTE_STRATEGIES) {
      const { path } = routed(trip(city("Houston, TX"), oakville, stops), strategy);
      const rows = path.steps.flatMap((s) => (s.kind === "stop" ? [s] : []));
      expect(rows.map((s) => s.stop)).toEqual([0, 1]);
      for (const row of rows) {
        expect(row.kmFromStart).toBeLessThan(path.km);
        const [lon, lat] = pointAtKm(path, row.kmFromStart);
        expect(haversineKm(lon, lat, stops[row.stop].lon, stops[row.stop].lat)).toBeLessThan(25);
      }
    }
  });

  it("names the stop when every way into it faces away from the rest of the trip", () => {
    // FRA node 362313 (south Dallas, UP) lies on a branch that dead-ends south of it: from Taylor the car
    // can only arrive heading south, and Texarkana is back north. Alone, both legs route.
    const node = network.node(362313 as FraId)!;
    const dallas: Waypoint = { label: node.near, lon: node.lon, lat: node.lat, fraId: node.fraId, railroad: null };
    const taylor = city("Taylor, TX");
    const texarkana: Waypoint = { label: "EXAMPLE Texarkana shop", lon: -94.0116, lat: 33.4423, fraId: null, railroad: null };
    routed(trip(taylor, dallas));
    routed(trip(dallas, texarkana));
    expect(router.route(trip(taylor, texarkana, [dallas]), "pick")).toEqual({
      ok: false,
      noRoute: { kind: "dead-end", at: 1, message: "point 2 is reached but cannot be left toward point 3 without turning back outside a yard" },
    });
  });

  it("with turning at stops, leaves that stop the way it came: a turn-back at the stop", () => {
    const node = network.node(362313 as FraId)!;
    const dallas: Waypoint = { label: node.near, lon: node.lon, lat: node.lat, fraId: node.fraId, railroad: null };
    const texarkana: Waypoint = { label: "EXAMPLE Texarkana shop", lon: -94.0116, lat: 33.4423, fraId: null, railroad: null };
    const { path } = routed({ ...trip(city("Taylor, TX"), texarkana, [dallas]), turnAtStops: true });
    const atStop = path.turnBacks.filter((t) => t.at.fraId === node.fraId);
    expect(atStop).toHaveLength(1);
    expect(atStop[0].track).toBe("stop");
    // Every other turn-back is still on yard track.
    expect(path.turnBacks.filter((t) => t.track === "stop")).toEqual(atStop);
    expect(path.steps.filter((s) => s.kind === "turn-back")).toHaveLength(path.turnBacks.length);
  });

  it("answers not-served, naming the waypoint, when coordinates are over 15 km from allowed mainline", () => {
    const desert: Waypoint = { label: "EXAMPLE desert shop", lon: -116.5, lat: 40.0, fraId: null, railroad: null };
    expect(router.route(trip(city("Temple, TX"), desert), "pick")).toEqual({
      ok: false,
      noRoute: { kind: "not-served", at: 1, message: "no allowed railroad has mainline within 15 km of point 2" },
    });
    expect(router.route(trip(city("Temple, TX"), city("North Little Rock, AR"), [city("Fort Worth, TX", "CSXT")]), "pick")).toEqual({
      ok: false,
      noRoute: { kind: "not-served", at: 1, message: "CSXT has no mainline within 15 km of point 2" },
    });
  });

  it("no-turn-backs finds a path without reversals when one exists", () => {
    expect(routed(viaTemple(), "pick").path.turnBacks.length).toBeGreaterThan(0);
    const { path } = routed(viaTemple(), "no-turn-backs");
    expect(path.turnBacks).toEqual([]);
    expect(path.steps.some((s) => s.kind === "turn-back")).toBe(false);
  });

  it("km is real track distance under every strategy (penalties never leak into it)", () => {
    for (const strategy of ROUTE_STRATEGIES) {
      const { path } = routed(exampleTrip(), strategy);
      const legKm = path.legs.reduce((s, leg) => s + leg.km, 0);
      const drawn = path.legs.reduce((s, leg) => s + pathKm(leg.path), 0);
      expect(path.km, strategy).toBeCloseTo(legKm, 6);
      // A drawn line is a little shorter than the track it follows; a 100 km or 500 km penalty would show here.
      expect(path.km, strategy).toBeGreaterThanOrEqual(drawn - 0.5);
      expect(path.km, strategy).toBeLessThan(drawn * 1.1 + 1);
    }
  });
});

describe("combine / tripKey", () => {
  it("merges strategies that found the same path and keeps the pick first", () => {
    const results = ROUTE_STRATEGIES.map((s) => router.route(exampleTrip(), s));
    const combined = combine(results);
    if (!combined.ok) throw new Error("no route");
    const { paths } = combined;
    expect(paths[0].strategies[0]).toBe("pick");
    expect(paths.flatMap((p) => p.strategies).sort()).toEqual([...ROUTE_STRATEGIES].sort());
    const kms = paths.map((p) => Math.round(p.km));
    expect(new Set(kms).size).toBe(kms.length);
    // The cached answers are left as they were.
    expect(results.map((r) => r.ok && r.path.strategies)).toEqual(ROUTE_STRATEGIES.map((s) => [s]));
  });

  it("shows one line once when routes share track under other names or run a few metres apart", () => {
    const lines = (trip: Trip) => {
      const combined = combine(ROUTE_STRATEGIES.map((s) => router.route(trip, s)));
      if (!combined.ok) throw new Error("no route");
      return combined.paths;
    };
    const share = (x: RoutePath, y: RoutePath) => {
      const points = (p: RoutePath) => new Set(p.legs.flatMap((leg) => leg.path.map((pt) => pt.join(","))));
      const px = points(x), py = points(y);
      return [...px].filter((pt) => py.has(pt)).length / Math.max(px.size, py.size);
    };
    // Taylor → North Little Rock: every strategy runs the same line (BNSF then UP, or UP then BNSF on shared rails).
    const sameLine = lines(trip(city("Taylor, TX"), city("North Little Rock, AR")));
    expect(sameLine).toHaveLength(1);
    expect([...sameLine[0].strategies].sort()).toEqual([...ROUTE_STRATEGIES].sort());
    // Savannah → Jacksonville → Birmingham: "shortest" used to add a 2 km NS run, an interchange that does not exist.
    const savannahTrip = trip(city("Savannah, GA"), city("Birmingham, AL"), [city("Jacksonville, FL")]);
    const savannah = lines(savannahTrip);
    expect(savannah[0].strategies).toContain("shortest");
    expect(savannah[0].interchanges).toBe(0);
    for (const each of [viaTemple(), savannahTrip]) {
      const paths = lines(each);
      for (let i = 0; i < paths.length; i++) for (let j = i + 1; j < paths.length; j++) expect(share(paths[i], paths[j])).toBeLessThan(0.95);
    }
    // Taylor → Temple → Oakville, ON: "pick" and "fewest interchanges" ran the same BNSF + CN line, 18 m
    // apart in length, but only 92 % of their points matched (a stretch of parallel yard track). One card.
    const oakville = { label: "Oakville, ON", lon: -79.7195, lat: 43.4169, fraId: null, railroad: null };
    const toOakville = lines(trip(city("Taylor, TX"), oakville, [city("Temple, TX")]));
    const look = (p: RoutePath) => `${p.interchanges}|${p.turnBacks.length}|${Math.round(p.km)}`;
    expect(new Set(toOakville.map(look)).size).toBe(toOakville.length);
    // Fargo → Minneapolis → Edmonton: BNSF to Winnipeg then CN, twice, 10 m apart. One card.
    const edmonton = { label: "Edmonton, AB", lon: -113.3956, lat: 53.5308, fraId: null, railroad: null };
    const toEdmonton = lines(trip(city("Fargo, ND"), edmonton, [city("Minneapolis, MN")]));
    expect(new Set(toEdmonton.map(look)).size).toBe(toEdmonton.length);
  });

  it("hides an alternative within NEAR_DUPLICATE_SHARE of a shown route's length with the same interchanges and turn-backs", () => {
    const path = (strategy: RouteStrategy, km: number, interchanges: number, lat: number): RouteResult => ({
      ok: true,
      path: { strategies: [strategy], km, interchanges, railroads: ["BNSF"], legs: [{ railroad: "BNSF", km, from: "a", to: "b", headingDeg: 0, subdivisions: [], path: [[-97, 31], [-96, lat], [-95, 32]] }], turnBacks: [], steps: [] },
    });
    const near = 1000 * (1 - NEAR_DUPLICATE_SHARE);
    const combined = combine([path("pick", 1000, 1, 31.1), path("shortest", near, 1, 31.2), path("fewest-interchanges", near, 0, 31.3), path("no-turn-backs", near - 1, 1, 31.4)]);
    if (!combined.ok) throw new Error("no route");
    expect(combined.paths.map((p) => [p.strategies, p.km])).toEqual([
      [["pick", "shortest"], 1000],
      [["fewest-interchanges"], near],
      [["no-turn-backs"], near - 1],
    ]);
  });

  it("is no-route when the pick found none, whatever the others found", () => {
    const fine = router.route(exampleTrip(), "shortest");
    const none: RouteResult = { ok: false, noRoute: { kind: "no-path", at: 1, message: "no route" } };
    expect(combine([none, fine])).toEqual({ ok: false, noRoute: none.noRoute });
    expect(combine([fine, none])).toMatchObject({ ok: true });
  });

  it("tripKey ignores labels and changes with the network version, any waypoint, the track included, or turning at stops", () => {
    const base = viaTemple();
    const key = tripKey("v1", base);
    const [start, stop, destination] = base.points;
    expect(tripKey("v1", { ...base, points: [{ ...start, label: "Somewhere else" }, stop, { ...destination, label: "EXAMPLE shop" }] })).toBe(key);
    const changed: Trip[] = [
      { ...base, points: [{ ...start, lon: start.lon + 0.01 }, stop, destination] },
      { ...base, points: [{ ...start, railroad: "UP" }, stop, destination] },
      { ...base, points: [start, stop, { ...destination, fraId: 358070 as FraId }] },
      { ...base, points: [start, city("Fort Worth, TX"), destination] },
      { ...base, include: { ...DEFAULT_INCLUDE, shortLine: true } },
      { ...base, turnAtStops: true },
    ];
    for (const other of changed) expect(tripKey("v1", other)).not.toBe(key);
    expect(tripKey("v2", base)).not.toBe(key);
  });
});

