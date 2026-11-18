import { describe, expect, it } from "vitest";
import type { FraId, PlaceRef, ShopId } from "../../../shared/places.ts";
import type { SavedRouteId } from "../../../shared/plans.ts";
import { DEFAULT_INCLUDE } from "../../../shared/railroads.ts";
import { EMPTY_PLAN, nextTarget, planReducer, samePlan, startSession, stopInsertIndex, type PlanAction, type PlanSession } from "./session.ts";

const node = (fraId: number): PlaceRef => ({ kind: "node", fraId: fraId as FraId, railroad: null });
const shop = (id: string): PlaceRef => ({ kind: "shop", shopId: id as ShopId });
const KC: PlaceRef = { kind: "text", text: "Kansas City, MO" };
const CHICAGO: PlaceRef = { kind: "text", text: "Chicago, IL" };

const run = (start: PlanSession, ...actions: PlanAction[]) => actions.reduce(planReducer, start);
const fresh = () => startSession(null, EMPTY_PLAN);
const planned = () => run(fresh(), { type: "setPlace", field: "start", ref: KC }, { type: "setPlace", field: "destination", ref: CHICAGO });
const stopIds = (s: PlanSession) => s.plan.present.stops.map((stop) => (stop.kind === "node" ? stop.fraId : stop.kind === "shop" ? stop.shopId : stop.kind));

describe("plan session", () => {
  it("starts empty, with no history", () => {
    const s = fresh();
    expect(s.plan.present).toEqual({ start: null, stops: [], destination: null, include: { regional: false, shortLine: false, passenger: true } });
    expect(s.plan.past).toEqual([]);
    expect(s.pick).toBeNull();
  });

  it("clicks go to the start, then the destination, then the stops; ⌖ on a field overrides that", () => {
    expect(nextTarget(fresh())).toBe("start");
    const started = planReducer(fresh(), { type: "setPlace", field: "start", ref: KC });
    expect(nextTarget(started)).toBe("destination");
    expect(nextTarget(planned())).toBe("stop");
    expect(nextTarget(planReducer(planned(), { type: "pick", field: "start" }))).toBe("start");
    // Setting the field turns ⌖ off again.
    const repicked = run(planned(), { type: "pick", field: "start" }, { type: "setPlace", field: "start", ref: node(9) });
    expect(repicked.pick).toBeNull();
    expect(repicked.plan.present.start).toEqual(node(9));
  });

  it("addStop inserts at its index", () => {
    const s = run(planned(), { type: "addStop", ref: node(1), index: 0 }, { type: "addStop", ref: node(2), index: 1 }, { type: "addStop", ref: node(3), index: 1 });
    expect(stopIds(s)).toEqual([1, 3, 2]);
    expect(stopIds(planReducer(s, { type: "addStop", ref: node(4), index: 99 }))).toEqual([1, 3, 2, 4]);
  });

  it("ignores a node or shop already in the plan, the start and destination too", () => {
    const s = run(
      startSession(null, { ...EMPTY_PLAN, start: node(7), destination: shop("s1") }),
      { type: "addStop", ref: node(1), index: 0 },
      { type: "addStop", ref: { kind: "node", fraId: 1 as FraId, railroad: "UP" }, index: 0 },
    );
    expect(stopIds(s)).toEqual([1]);
    expect(planReducer(s, { type: "addStop", ref: node(7), index: 0 })).toBe(s);
    expect(planReducer(s, { type: "addStop", ref: shop("s1"), index: 0 })).toBe(s);
    expect(stopIds(planReducer(s, { type: "addStop", ref: shop("s2"), index: 1 }))).toEqual([1, "s2"]);
  });

  it("setLine sets and clears the railroad at a node stop, and Undo puts the old one back", () => {
    const s = run(planned(), { type: "addStop", ref: node(1), index: 0 });
    const up = planReducer(s, { type: "setLine", index: 0, railroad: "UP" });
    expect(up.plan.present.stops[0]).toEqual({ kind: "node", fraId: 1, railroad: "UP" });
    expect(planReducer(up, { type: "setLine", index: 0, railroad: null }).plan.present.stops[0]).toEqual(node(1));
    expect(planReducer(up, { type: "undo" }).plan.present.stops[0]).toEqual(node(1));
    // Choosing what is already chosen changes nothing and adds no history.
    expect(planReducer(up, { type: "setLine", index: 0, railroad: "UP" })).toBe(up);
    expect(planReducer(run(planned(), { type: "addStop", ref: shop("s1"), index: 0 }), { type: "setLine", index: 0, railroad: "UP" }).plan.present.stops[0]).toEqual(shop("s1"));
  });

  it("removes and reorders stops", () => {
    const s = run(planned(), { type: "addStop", ref: node(1), index: 0 }, { type: "addStop", ref: node(2), index: 1 }, { type: "addStop", ref: node(3), index: 2 });
    expect(stopIds(planReducer(s, { type: "removeStop", index: 1 }))).toEqual([1, 3]);
    expect(stopIds(planReducer(s, { type: "moveStop", from: 0, to: 1 }))).toEqual([2, 1, 3]);
    expect(stopIds(planReducer(s, { type: "moveStop", from: 2, to: 1 }))).toEqual([1, 3, 2]);
    expect(planReducer(s, { type: "moveStop", from: 2, to: 3 })).toBe(s);
    expect(planReducer(s, { type: "removeStop", index: 5 })).toBe(s);
  });

  it("clear empties the plan and can be undone", () => {
    const s = run(planned(), { type: "addStop", ref: node(1), index: 0 }, { type: "clear" });
    expect(s.plan.present).toEqual(EMPTY_PLAN);
    expect(stopIds(planReducer(s, { type: "undo" }))).toEqual([1]);
    expect(planReducer(fresh(), { type: "clear" }).plan.past).toEqual([]);
  });

  it("undo and redo walk the start, destination and stops; a new change clears redo", () => {
    const s = run(planned(), { type: "addStop", ref: node(1), index: 0 });
    const back = run(s, { type: "undo" }, { type: "undo" });
    expect(back.plan.present).toEqual({ ...EMPTY_PLAN, start: KC });
    expect(run(back, { type: "redo" }, { type: "redo" }).plan.present).toEqual(s.plan.present);
    const branched = planReducer(back, { type: "setPlace", field: "destination", ref: node(5) });
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

  it("saved adopts the id and keeps the history", () => {
    const s = run(planned(), { type: "saved", id: "r1" as SavedRouteId });
    expect(s.savedId).toBe("r1");
    expect(s.plan.past).toHaveLength(2);
  });

  it("a missed click is remembered until the next change", () => {
    const missed = planReducer(planned(), { type: "missed" });
    expect(missed.missed).toBe(true);
    expect(planReducer(missed, { type: "addStop", ref: node(1), index: 0 }).missed).toBe(false);
  });

  it("stopInsertIndex puts a new stop where it adds the least detour", () => {
    const start = { lon: 0, lat: 0 };
    const destination = { lon: 10, lat: 0 };
    const stops = [{ lon: 3, lat: 0 }, { lon: 7, lat: 0 }];
    expect(stopInsertIndex(start, stops, destination, { lon: 1, lat: 0.1 })).toBe(0);
    expect(stopInsertIndex(start, stops, destination, { lon: 5, lat: 0.1 })).toBe(1);
    expect(stopInsertIndex(start, stops, destination, { lon: 9, lat: 0.1 })).toBe(2);
    expect(stopInsertIndex(start, [], destination, { lon: 4, lat: 3 })).toBe(0);
  });
});
