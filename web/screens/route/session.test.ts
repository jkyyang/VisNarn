// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { LngLat } from "../../../shared/geo.ts";
import type { FraId, NetworkNode, PlaceRef, ShopId } from "../../../shared/places.ts";
import type { SavedRouteId } from "../../../shared/plans.ts";
import { DEFAULT_INCLUDE } from "../../../shared/railroads.ts";
import { snapToNetwork } from "../../data/hooks.ts";
import { EMPTY_PLAN, forgetPlan, fullPlan, nextTarget, placeAtEnd, planReducer, routeNodeNear, samePlan, startSession, stopInsertIndex, usePlanSession, type PlanAction, type PlanSession } from "./session.ts";

vi.mock("../../data/hooks.ts", () => ({ snapToNetwork: vi.fn() }));

const node = (fraId: number): PlaceRef => ({ kind: "node", fraId: fraId as FraId, railroad: null });
const shop = (id: string): PlaceRef => ({ kind: "shop", shopId: id as ShopId });
const KC: PlaceRef = { kind: "text", text: "Kansas City, MO" };
const CHICAGO: PlaceRef = { kind: "text", text: "Chicago, IL" };

const run = (start: PlanSession, ...actions: PlanAction[]) => actions.reduce(planReducer, start);
const fresh = () => startSession(null, EMPTY_PLAN);
const planned = () => run(fresh(), { type: "setPlace", at: 0, ref: KC }, { type: "setPlace", at: 1, ref: CHICAGO });
const ids = (s: PlanSession) => s.plan.present.places.map((place) => (place === null ? null : place.kind === "node" ? place.fraId : place.kind === "shop" ? place.shopId : place.kind === "text" ? place.text : place.kind));
const stopIds = (s: PlanSession) => ids(s).slice(1, -1);

describe("plan session", () => {
  it("starts with two empty rows and no history", () => {
    const s = fresh();
    expect(s.plan.present).toEqual({ places: [null, null], include: { regional: false, shortLine: false, passenger: true }, turnAtStops: false });
    expect(s.plan.past).toEqual([]);
    expect(s.pick).toBeNull();
  });

  it("a click fills the first empty row, else adds a stop; ⌖ on a row overrides that", () => {
    expect(nextTarget(fresh())).toBe(0);
    expect(nextTarget(planReducer(fresh(), { type: "setPlace", at: 0, ref: KC }))).toBe(1);
    expect(nextTarget(planned())).toBeNull();
    expect(nextTarget(planReducer(planned(), { type: "pick", at: 0 }))).toBe(0);
    // Setting the row turns ⌖ off again.
    const repicked = run(planned(), { type: "pick", at: 0 }, { type: "setPlace", at: 0, ref: node(9) });
    expect(repicked.pick).toBeNull();
    expect(repicked.plan.present.places[0]).toEqual(node(9));
  });

  it("insert puts a row before its index; an empty row turns its ⌖ on", () => {
    const s = run(planned(), { type: "insert", at: 1, ref: node(1) }, { type: "insert", at: 2, ref: node(2) }, { type: "insert", at: 2, ref: node(3) });
    expect(stopIds(s)).toEqual([1, 3, 2]);
    expect(ids(planReducer(s, { type: "insert", at: 99, ref: node(4) }))).toEqual(["Kansas City, MO", 1, 3, 2, "Chicago, IL", 4]);
    expect(ids(planReducer(s, { type: "insert", at: 0, ref: node(5) }))[0]).toBe(5);
    const added = planReducer(s, { type: "insert", at: 4, ref: null });
    expect(stopIds(added)).toEqual([1, 3, 2, null]);
    expect(added.pick).toBe(4);
    expect(nextTarget(planReducer(added, { type: "pick", at: null }))).toBe(4);
  });

  it("ignores a node or shop already in the plan", () => {
    const s = run(
      startSession(null, { ...EMPTY_PLAN, places: [node(7), shop("s1")] }),
      { type: "insert", at: 1, ref: node(1) },
      { type: "insert", at: 1, ref: { kind: "node", fraId: 1 as FraId, railroad: "UP" } },
    );
    expect(stopIds(s)).toEqual([1]);
    expect(planReducer(s, { type: "insert", at: 1, ref: node(7) })).toBe(s);
    expect(planReducer(s, { type: "insert", at: 1, ref: shop("s1") })).toBe(s);
    expect(stopIds(planReducer(s, { type: "insert", at: 2, ref: shop("s2") }))).toEqual([1, "s2"]);
  });

  it("setLine sets and clears the next carrier at a node, and Undo puts the old one back", () => {
    const s = run(planned(), { type: "insert", at: 1, ref: node(1) });
    const up = planReducer(s, { type: "setLine", at: 1, railroad: "UP" });
    expect(up.plan.present.places[1]).toEqual({ kind: "node", fraId: 1, railroad: "UP" });
    expect(planReducer(up, { type: "setLine", at: 1, railroad: null }).plan.present.places[1]).toEqual(node(1));
    expect(planReducer(up, { type: "undo" }).plan.present.places[1]).toEqual(node(1));
    // Choosing what is already chosen changes nothing and adds no history.
    expect(planReducer(up, { type: "setLine", at: 1, railroad: "UP" }).plan).toBe(up.plan);
    expect(planReducer(run(planned(), { type: "insert", at: 1, ref: shop("s1") }), { type: "setLine", at: 1, railroad: "UP" }).plan.present.places[1]).toEqual(shop("s1"));
  });

  it("moves any row to any place, the ends too, and removes rows down to two, which it empties", () => {
    const s = run(planned(), { type: "insert", at: 1, ref: node(1) }, { type: "insert", at: 2, ref: node(2) });
    expect(ids(planReducer(s, { type: "move", from: 1, to: 2 }))).toEqual(["Kansas City, MO", 2, 1, "Chicago, IL"]);
    expect(ids(planReducer(s, { type: "move", from: 0, to: 3 }))).toEqual([1, 2, "Chicago, IL", "Kansas City, MO"]);
    expect(ids(planReducer(s, { type: "move", from: 3, to: 0 }))).toEqual(["Chicago, IL", "Kansas City, MO", 1, 2]);
    expect(planReducer(s, { type: "move", from: 2, to: 4 })).toBe(s);
    expect(ids(planReducer(s, { type: "remove", at: 0 }))).toEqual([1, 2, "Chicago, IL"]);
    expect(ids(run(s, { type: "remove", at: 1 }, { type: "remove", at: 1 }, { type: "remove", at: 1 }))).toEqual(["Kansas City, MO", null]);
    expect(planReducer(s, { type: "remove", at: 5 })).toBe(s);
  });

  it("reverse runs the list the other way, keeping each chosen carrier, and can be undone", () => {
    const s = run(planned(), { type: "insert", at: 1, ref: node(1) }, { type: "insert", at: 2, ref: node(2) }, { type: "setLine", at: 2, railroad: "UP" });
    const back = planReducer(s, { type: "reverse" });
    expect(back.plan.present.places).toEqual([CHICAGO, { kind: "node", fraId: 2, railroad: "UP" }, node(1), KC]);
    expect(planReducer(back, { type: "reverse" }).plan.present).toEqual(s.plan.present);
    expect(planReducer(back, { type: "undo" }).plan.present).toEqual(s.plan.present);
  });

  it("clear empties the plan and can be undone", () => {
    const s = run(planned(), { type: "insert", at: 1, ref: node(1) }, { type: "clear" });
    expect(s.plan.present).toEqual(EMPTY_PLAN);
    expect(stopIds(planReducer(s, { type: "undo" }))).toEqual([1]);
    expect(planReducer(fresh(), { type: "clear" }).plan.past).toEqual([]);
  });

  it("undo and redo walk the list; a new change clears redo", () => {
    const s = run(planned(), { type: "insert", at: 1, ref: node(1) });
    const back = run(s, { type: "undo" }, { type: "undo" });
    expect(back.plan.present).toEqual({ ...EMPTY_PLAN, places: [KC, null] });
    expect(run(back, { type: "redo" }, { type: "redo" }).plan.present).toEqual(s.plan.present);
    const branched = planReducer(back, { type: "setPlace", at: 1, ref: node(5) });
    expect(branched.plan.future).toEqual([]);
    expect(planReducer(branched, { type: "redo" })).toBe(branched);
    expect(planReducer(fresh(), { type: "undo" })).toEqual(fresh());
  });

  it("ticking a track type is one undoable change of plan; the same choice again is none", () => {
    const ticked = planReducer(planned(), { type: "setInclude", include: { ...DEFAULT_INCLUDE, shortLine: true } });
    expect(ticked.plan.present.include).toEqual({ regional: false, shortLine: true, passenger: true });
    expect(samePlan(ticked.plan.present, planned().plan.present)).toBe(false);
    expect(planReducer(ticked, { type: "undo" }).plan.present.include).toEqual(DEFAULT_INCLUDE);
    expect(planReducer(ticked, { type: "setInclude", include: { ...ticked.plan.present.include } })).toBe(ticked);
  });

  it("turning at stops is one undoable change of plan, off to start with", () => {
    expect(planned().plan.present.turnAtStops).toBe(false);
    const on = planReducer(planned(), { type: "setTurnAtStops", turnAtStops: true });
    expect(on.plan.present.turnAtStops).toBe(true);
    expect(samePlan(on.plan.present, planned().plan.present)).toBe(false);
    expect(fullPlan(on.plan.present)?.turnAtStops).toBe(true);
    expect(planReducer(on, { type: "undo" }).plan.present.turnAtStops).toBe(false);
    expect(planReducer(on, { type: "setTurnAtStops", turnAtStops: true })).toBe(on);
  });

  it("saves the set rows only, and needs two of them", () => {
    const withEmpty = run(planned(), { type: "insert", at: 1, ref: null });
    expect(fullPlan(withEmpty.plan.present)?.places).toEqual([KC, CHICAGO]);
    expect(fullPlan(planReducer(fresh(), { type: "setPlace", at: 0, ref: KC }).plan.present)).toBeNull();
  });

  it("a found place's Start or Destination fills that end's empty row, else adds a new end", () => {
    const half = planReducer(fresh(), { type: "setPlace", at: 0, ref: KC }).plan.present;
    expect(placeAtEnd(half, "destination", CHICAGO)).toEqual({ type: "setPlace", at: 1, ref: CHICAGO });
    expect(placeAtEnd(half, "start", CHICAGO)).toEqual({ type: "insert", at: 0, ref: CHICAGO });
    expect(placeAtEnd(planned().plan.present, "destination", node(3))).toEqual({ type: "insert", at: 2, ref: node(3) });
  });

  it("saved adopts the id and keeps the history", () => {
    const s = run(planned(), { type: "saved", id: "r1" as SavedRouteId });
    expect(s.savedId).toBe("r1");
    expect(s.plan.past).toHaveLength(2);
  });

  it("a missed click is remembered until the next change", () => {
    const missed = planReducer(planned(), { type: "missed" });
    expect(missed.missed).toBe(true);
    expect(planReducer(missed, { type: "insert", at: 1, ref: node(1) }).missed).toBe(false);
  });

  it("stopInsertIndex puts a new stop in the gap where it adds the least detour", () => {
    const chain = [{ lon: 0, lat: 0 }, { lon: 3, lat: 0 }, { lon: 7, lat: 0 }, { lon: 10, lat: 0 }];
    expect(stopInsertIndex(chain, { lon: 1, lat: 0.1 })).toBe(1);
    expect(stopInsertIndex(chain, { lon: 5, lat: 0.1 })).toBe(2);
    expect(stopInsertIndex(chain, { lon: 9, lat: 0.1 })).toBe(3);
    expect(stopInsertIndex([chain[0], chain[3]], { lon: 4, lat: 3 })).toBe(1);
  });

  // A straight line east along the equator, a node every 0.1° (about 11 km), and a spur node 1 km north of it.
  const line: LngLat[][] = [[[0, 0], [0.1, 0], [0.2, 0]], [[0.2, 0], [0.3, 0], [0.4, 0]]];

  it("routeNodeNear snaps a click on the route to its nearest inner node, and leaves a click off it alone", () => {
    expect(routeNodeNear(line, { lon: 0.12, lat: 0.009 }, 2)).toEqual([0.1, 0]);
    expect(routeNodeNear(line, { lon: 0.27, lat: -0.005 }, 2)).toEqual([0.3, 0]);
    // The two ends are the start and destination: the nearest inner node instead.
    expect(routeNodeNear(line, { lon: 0.01, lat: 0 }, 2)).toEqual([0.1, 0]);
    expect(routeNodeNear(line, { lon: 0.2, lat: 0.05 }, 2)).toBeNull();
    expect(routeNodeNear([], { lon: 0.2, lat: 0 }, 2)).toBeNull();
  });

  it("a click on the selected route adds the route's own node even when a spur node is nearer", async () => {
    forgetPlan();
    const at = (fraId: number, lon: number, lat: number): NetworkNode => ({ fraId: fraId as FraId, lon, lat, near: "EXAMPLE", railroads: ["BNSF"], yard: false, km: 0 });
    const nodes: Record<string, NetworkNode> = { "0.1,0": at(10, 0.1, 0), spur: at(99, 0.14, 0.009) };
    // The server's nearest node: the route node when asked at its own point, else the spur.
    vi.mocked(snapToNetwork).mockImplementation(async (lon, lat) => nodes[`${lon},${lat}`] ?? nodes.spur);
    const { result } = renderHook(() => usePlanSession(null, null));
    act(() => {
      result.current.dispatch({ type: "setPlace", at: 0, ref: KC });
      result.current.dispatch({ type: "setPlace", at: 1, ref: CHICAGO });
    });
    // 36 px of tolerance, 9 km: the route counts within 10 px, 2.5 km.
    await act(() => result.current.clickMap(0.14, 0.005, 9, null, line));
    expect(stopIds(result.current.session)).toEqual([10]);
    // Off the route, the nearest node wins as before.
    await act(() => result.current.clickMap(0.15, 0.05, 9, null, line));
    expect(stopIds(result.current.session)).toEqual([10, 99]);
  });
});
