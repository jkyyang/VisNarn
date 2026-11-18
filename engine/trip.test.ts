/** The engine's contract as the server sees it: stable ids in and out, alternatives, turn-back facts. */
import { beforeAll, describe, expect, it } from "vitest";
import { haversineKm, type LngLat } from "../shared/geo.ts";
import type { FraId, Waypoint } from "../shared/places.ts";
import { RAILROADS, type Line, type Railroad } from "../shared/railroads.ts";
import { ROUTE_STRATEGIES, type RoutePath } from "../shared/route.ts";
import { loadNetwork } from "./load.ts";
import { ALL_RAILROADS_MASK } from "./core/graph.ts";
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
const rules = (allowed: readonly Railroad[] = RAILROADS) => ({ allowed: [...allowed], interchangePenaltyKm: 500 });
const exampleTrip = (): Trip => ({ a: city("Taylor, TX"), b: city("Temple, TX"), stops: [], shop: city("North Little Rock, AR"), rules: rules() });

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
  it("routes the EXAMPLE car (Taylor → Temple → North Little Rock) continuing the A→B move", () => {
    const result = routed(exampleTrip());
    expect(result.approach.onTrack).toBe(true);
    expect(result.approach.km).toBeGreaterThan(55);
    expect(result.approach.km).toBeLessThan(70);
    expect(result.path.km).toBeGreaterThan(result.straightKm);
    expect(result.path.steps[0].kmFromB).toBe(0);
    expect(result.path.steps.at(-1)).toEqual({ kind: "shop", kmFromB: result.path.km });

    // Arriving from Taylor, the car can only head for Little Rock by turning back on yard track at
    // Temple. A car with no known direction at Temple needs no such move.
    expect(result.path.turnBacks.map((t) => t.at.near)).toContain("Temple, TX");
    const noDirection = routed({ ...exampleTrip(), a: city("Temple, TX") });
    expect(noDirection.approach.km).toBe(0);
    expect(noDirection.path.turnBacks.filter((t) => t.at.near === "Temple, TX")).toEqual([]);
  });

  it("returns FRA ids, 5-dp coordinates and names only: no field of the result is a graph index", () => {
    const result = routed(exampleTrip());
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
      const asNode = [...graph.serving(graph.nodePoint(i), { allowedMask: ALL_RAILROADS_MASK, passenger: true })];
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
    const one = routed({ ...exampleTrip(), shop: byId });
    const other = routed({ ...exampleTrip(), shop: byCoordinates });
    expect(other.path).toEqual(one.path);
  });

  it("reaches a shop on a short line only when short lines are included (Ville Platte, LA: UP is 20 km away)", () => {
    const villePlatte: Waypoint = { label: "Ville Platte, LA", lon: -92.271, lat: 30.688, fraId: null, railroad: null };
    const trip: Trip = { a: city("Houston, TX"), b: city("Baton Rouge, LA"), stops: [], shop: villePlatte, rules: rules() };
    expect(router.route(trip, "pick")).toMatchObject({ ok: false, noRoute: { kind: "not-served", at: "shop" } });
    const { path } = routed({ ...trip, rules: { ...rules(), include: { regional: false, shortLine: true, passenger: true } } });
    const last = path.legs[path.legs.length - 1];
    expect(last.railroad).toBe("short line");
    expect(path.steps.find((step) => step.kind === "interchange")).toMatchObject({ from: "UP", to: "short line" });
    expect(haversineKm(villePlatte.lon, villePlatte.lat, ...last.path[last.path.length - 1])).toBeLessThan(1);
  });

  it("reaches the Oakville, ON shop over GO Transit's track by default, and not at all with passenger-owned track turned off", () => {
    const trip: Trip = { ...exampleTrip(), shop: { label: "Oakville, ON", lon: -79.7195, lat: 43.4169, fraId: null, railroad: null } };
    expect(router.route(trip, "pick").ok).toBe(true);
    const off = router.route({ ...trip, rules: { ...rules(), include: { regional: false, shortLine: false, passenger: false } } }, "pick");
    expect(off).toMatchObject({ ok: false, noRoute: { kind: "no-path", at: "shop" } });
  });

  it("honours a waypoint's railroad: a stop pinned to BNSF is not reached on UP", () => {
    for (const railroad of ["BNSF", "UP"] as const) {
      const { path } = routed({ ...exampleTrip(), stops: [city("Fort Worth, TX", railroad)] });
      const stopRow = path.steps.findIndex((s) => s.kind === "stop");
      expect(stopRow).toBeGreaterThan(0);
      expect(railroadAtStep(path, stopRow)).toBe(railroad);
    }
  });

  it("splits legs at a turn-back and reports subdivisions, headings, angle and yard / stub-end", () => {
    const { path } = routed(exampleTrip());
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
      expect(path.steps[i + 1]).toMatchObject({ kind: "leg", kmFromB: step.kmFromB });
    });
    expect(path.legs.length).toBe(path.turnBacks.length + path.interchanges + 1);
    expect(path.legs.at(-1)!.subdivisions.length).toBeGreaterThan(1);
  });

  it("places each stop row at the km where the path reaches it", () => {
    const kc = city("Kansas City, MO");
    const { path } = routed({ a: city("Taylor, TX"), b: city("Austin, TX"), stops: [kc], shop: city("Chicago, IL"), rules: rules() });
    const stop = path.steps.find((s) => s.kind === "stop");
    expect(stop).toMatchObject({ kind: "stop", stop: 0, label: "Kansas City, MO" });
    expect(stop!.kmFromB).toBeGreaterThan(0);
    expect(stop!.kmFromB).toBeLessThan(path.km);
    const [lon, lat] = pointAtKm(path, stop!.kmFromB);
    expect(haversineKm(lon, lat, kc.lon, kc.lat)).toBeLessThan(15);
    const kms = path.steps.map((s) => s.kmFromB);
    expect(kms).toEqual([...kms].sort((x, y) => x - y));
  });

  it("answers no-path (not an exception) when the allowed railroads cannot make the trip", () => {
    // On UP track alone, the UP lines around Pasco, WA are not joined to Houston.
    const result = router.route({ a: city("Austin, TX"), b: city("Houston, TX"), stops: [], shop: city("Pasco, WA"), rules: rules(["UP"]) }, "pick");
    expect(result).toEqual({ ok: false, noRoute: { kind: "no-path", at: "shop", message: expect.stringContaining("from B to the shop") } });
  });

  it("answers not-served, naming the waypoint, when coordinates are over 15 km from allowed mainline", () => {
    const desert: Waypoint = { label: "EXAMPLE desert shop", lon: -116.5, lat: 40.0, fraId: null, railroad: null };
    expect(router.route({ ...exampleTrip(), shop: desert }, "pick")).toEqual({
      ok: false,
      noRoute: { kind: "not-served", at: "shop", message: "No allowed railroad has mainline within 15 km of the shop." },
    });
    // Austin is UP-only, so with BNSF alone B cannot be reached.
    expect(router.route({ ...exampleTrip(), b: city("Austin, TX"), rules: rules(["BNSF"]) }, "pick")).toMatchObject({ ok: false, noRoute: { kind: "not-served", at: "b" } });
    expect(router.route({ ...exampleTrip(), stops: [city("Fort Worth, TX", "CSXT")], rules: rules(["BNSF", "UP"]) }, "pick")).toMatchObject({
      ok: false,
      noRoute: { kind: "not-served", at: 0, message: "Stop 1 must be reached on CSXT, but CSXT is not allowed." },
    });
  });

  it("falls back to a straight-line approach when A and B are not connected, and says so", () => {
    const pasco = city("Pasco, WA"), portland = city("Portland, OR");
    const result = routed({ a: pasco, b: portland, stops: [], shop: city("Salt Lake City, UT"), rules: rules(["UP"]) });
    expect(result.approach.onTrack).toBe(false);
    expect(result.approach.km).toBeCloseTo(haversineKm(pasco.lon, pasco.lat, portland.lon, portland.lat) * 1.2, 6);
    expect(result.approach.paths).toEqual([[[pasco.lon, pasco.lat].map((n) => Math.round(n * 1e5) / 1e5), [portland.lon, portland.lat].map((n) => Math.round(n * 1e5) / 1e5)]]);
    expect(result.path.km).toBeGreaterThan(0);
  });

  it("no-turn-backs finds a path without reversals when one exists", () => {
    expect(routed(exampleTrip(), "pick").path.turnBacks.length).toBeGreaterThan(0);
    const { path } = routed(exampleTrip(), "no-turn-backs");
    expect(path.turnBacks).toEqual([]);
    expect(path.steps.some((s) => s.kind === "turn-back")).toBe(false);
  });

  it("km is real track distance under every strategy (penalties never leak into it)", () => {
    for (const strategy of ROUTE_STRATEGIES) {
      const { path } = routed(exampleTrip(), strategy);
      const legKm = path.legs.reduce((s, leg) => s + leg.km, 0);
      const drawn = path.legs.reduce((s, leg) => s + leg.path.slice(1).reduce((t, p, i) => t + haversineKm(leg.path[i][0], leg.path[i][1], p[0], p[1]), 0), 0);
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
    const { paths } = combined.trip;
    expect(paths[0].strategies[0]).toBe("pick");
    expect(paths.flatMap((p) => p.strategies).sort()).toEqual([...ROUTE_STRATEGIES].sort());
    const kms = paths.map((p) => Math.round(p.km));
    expect(new Set(kms).size).toBe(kms.length);
    // The cached answers are left as they were.
    expect(results.map((r) => r.ok && r.path.strategies)).toEqual(ROUTE_STRATEGIES.map((s) => [s]));
  });

  it("shows one line once: the same track under other railroad names, or a few metres of parallel track, is not a second option", () => {
    const lines = (trip: Trip) => {
      const combined = combine(ROUTE_STRATEGIES.map((s) => router.route(trip, s)));
      if (!combined.ok) throw new Error("no route");
      return combined.trip.paths;
    };
    const share = (x: RoutePath, y: RoutePath) => {
      const points = (p: RoutePath) => new Set(p.legs.flatMap((leg) => leg.path.map((pt) => pt.join(","))));
      const px = points(x), py = points(y);
      return [...px].filter((pt) => py.has(pt)).length / Math.max(px.size, py.size);
    };
    // Temple → Taylor → North Little Rock: every strategy runs the same line (BNSF then UP, or UP then BNSF on shared rails).
    const sameLine = lines({ ...exampleTrip(), a: city("Temple, TX"), b: city("Taylor, TX") });
    expect(sameLine).toHaveLength(1);
    expect([...sameLine[0].strategies].sort()).toEqual([...ROUTE_STRATEGIES].sort());
    // Savannah → Jacksonville → Birmingham: "shortest" used to add a 2 km NS run, an interchange that does not exist.
    const savannah = lines({ a: city("Savannah, GA"), b: city("Jacksonville, FL"), stops: [], shop: city("Birmingham, AL"), rules: rules() });
    expect(savannah[0].strategies).toContain("shortest");
    expect(savannah[0].interchanges).toBe(0);
    for (const trip of [exampleTrip(), { a: city("Savannah, GA"), b: city("Jacksonville, FL"), stops: [], shop: city("Birmingham, AL"), rules: rules() }]) {
      const paths = lines(trip);
      for (let i = 0; i < paths.length; i++) for (let j = i + 1; j < paths.length; j++) expect(share(paths[i], paths[j])).toBeLessThan(0.95);
    }
    // Taylor → Temple → Oakville, ON: "pick" and "fewest interchanges" ran the same BNSF + CN line, 18 m
    // apart in length, but only 92 % of their points matched (a stretch of parallel yard track). One card.
    const oakville = { label: "Oakville, ON", lon: -79.7195, lat: 43.4169, fraId: null, railroad: null };
    const toOakville = lines({ ...exampleTrip(), shop: oakville });
    const look = (p: RoutePath) => `${p.interchanges}|${p.turnBacks.length}|${Math.round(p.km)}`;
    expect(new Set(toOakville.map(look)).size).toBe(toOakville.length);
    // Fargo → Minneapolis → Edmonton: BNSF to Winnipeg then CN, twice, 10 m apart. One card.
    const edmonton = { label: "Edmonton, AB", lon: -113.3956, lat: 53.5308, fraId: null, railroad: null };
    const toEdmonton = lines({ a: city("Fargo, ND"), b: city("Minneapolis, MN"), stops: [], shop: edmonton, rules: rules() });
    expect(new Set(toEdmonton.map(look)).size).toBe(toEdmonton.length);
  });

  it("is no-route when the pick found none, whatever the others found", () => {
    const fine = router.route(exampleTrip(), "shortest");
    const none: RouteResult = { ok: false, noRoute: { kind: "no-path", at: "shop", message: "No route." } };
    expect(combine([none, fine])).toEqual({ ok: false, noRoute: none.noRoute });
    expect(combine([fine, none])).toMatchObject({ ok: true });
  });

  it("tripKey ignores labels and changes with the network version, any waypoint, or the routing rules", () => {
    const trip = exampleTrip();
    const key = tripKey("v1", trip);
    expect(tripKey("v1", { ...trip, a: { ...trip.a, label: "Somewhere else" }, shop: { ...trip.shop, label: "EXAMPLE shop" } })).toBe(key);
    const changed: Trip[] = [
      { ...trip, a: { ...trip.a, lon: trip.a.lon + 0.01 } },
      { ...trip, b: { ...trip.b, railroad: "UP" } },
      { ...trip, shop: { ...trip.shop, fraId: 358070 as FraId } },
      { ...trip, stops: [city("Fort Worth, TX")] },
      { ...trip, rules: rules(["BNSF", "UP"]) },
      { ...trip, rules: { ...trip.rules, interchangePenaltyKm: 300 } },
    ];
    for (const other of changed) expect(tripKey("v1", other)).not.toBe(key);
    expect(tripKey("v2", trip)).not.toBe(key);
    expect(tripKey("v1", { ...trip, rules: { ...trip.rules, allowed: [...trip.rules.allowed].reverse() } })).toBe(key);
  });
});

