import { describe, expect, it } from "vitest";
import type { BatchCar, BatchId } from "../../../shared/cars.ts";
import type { FraId, NetworkNode } from "../../../shared/places.ts";
import type { Instant } from "../../../shared/time.ts";
import { draftOf, exampleDraft, reportOf, sessionReducer, startSession, stopInsertIndex, type CarSession, type SessionAction } from "./session.ts";

const node = (fraId: number, railroads: NetworkNode["railroads"]): NetworkNode => ({ fraId: fraId as FraId, lon: -97.36, lat: 31.12, near: "TEMPLE, TX wye", railroads, yard: false, km: 0.4 });

function session(): CarSession {
  return startSession({ kind: "typed" }, exampleDraft(new Date(2026, 10, 17, 9, 30)), [], "2026-11-17T15:00:00.000Z" as Instant);
}
const run = (start: CarSession, ...actions: SessionAction[]) => actions.reduce(sessionReducer, start);
const text = (value: string) => ({ ref: { kind: "text" as const, text: value }, shown: value });

describe("car session", () => {
  it("starts from the EXAMPLE car, reported this hour, with prep ending at midnight two days on", () => {
    const s = session();
    expect(s.draft.carId).toBe("EXAMPLE 104233");
    expect(s.draft.reportedAt).toBe("2026-11-17T09:00");
    expect(s.draft.prepEnd).toBe("2026-11-19T00:00");
  });

  it("keeps typing in the draft until it is submitted", () => {
    const typed = run(session(), { type: "editPlace", field: "b", value: text("Waco, TX") }, { type: "edit", field: "carId", value: "ABC 1" });
    expect(typed.draft.b.shown).toBe("Waco, TX");
    expect(typed.submitted.b.shown).toBe("Temple, TX");
    expect(reportOf(typed)?.b).toEqual({ kind: "text", text: "Temple, TX" });
    const submitted = sessionReducer(typed, { type: "submit" });
    expect(reportOf(submitted)?.b).toEqual({ kind: "text", text: "Waco, TX" });
    expect(reportOf(submitted)?.carId).toBe("ABC 1");
  });

  it("applies a map pick at once, without submitting other edits", () => {
    const picked = run(
      session(),
      { type: "edit", field: "carId", value: "not yet" },
      { type: "pick", target: "a" },
      { type: "picked", field: "a", value: { ref: { kind: "node", fraId: 1 as FraId, railroad: null }, shown: "Taylor, TX" } },
    );
    expect(picked.pick).toBeNull();
    expect(reportOf(picked)?.a).toEqual({ kind: "node", fraId: 1, railroad: null });
    expect(reportOf(picked)?.carId).toBe("EXAMPLE 104233");
  });

  it("swapAB swaps A and B in the draft and in what is checked", () => {
    const swapped = sessionReducer(session(), { type: "swapAB" });
    expect(swapped.draft.a.shown).toBe("Temple, TX");
    expect(reportOf(swapped)?.a).toEqual({ kind: "text", text: "Temple, TX" });
    expect(reportOf(swapped)?.b).toEqual({ kind: "text", text: "Taylor, TX" });
  });

  it("a stop where railroads meet waits for Which line?, then carries the chosen railroad", () => {
    const waiting = run(session(), { type: "pick", target: "stop" }, { type: "stopPicked", node: node(358070, ["BNSF", "UP"]), index: 0 });
    expect(waiting.lineChoice?.fraId).toBe(358070);
    expect(waiting.stops.present).toEqual([]);
    const chosen = sessionReducer(waiting, { type: "lineChosen", railroad: "BNSF" });
    expect(chosen.lineChoice).toBeNull();
    expect(chosen.stops.present).toEqual([{ place: { kind: "node", fraId: 358070, railroad: "BNSF" }, note: null }]);
  });

  it("undo and redo walk the stop history; a new stop clears redo", () => {
    const one = run(session(), { type: "stopPicked", node: node(1, ["BNSF"]), index: 0 });
    const two = run(one, { type: "stopPicked", node: node(2, ["UP"]), index: 1 });
    const undone = sessionReducer(two, { type: "undo" });
    expect(undone.stops.present.map((s) => s.place)).toEqual([{ kind: "node", fraId: 1, railroad: null }]);
    expect(sessionReducer(undone, { type: "redo" }).stops.present).toHaveLength(2);
    const branched = sessionReducer(undone, { type: "stopPicked", node: node(3, ["CN"]), index: 1 });
    expect(branched.stops.future).toEqual([]);
    expect(sessionReducer(branched, { type: "redo" })).toBe(branched);
    const removed = sessionReducer(branched, { type: "removeStop", index: 0 });
    expect(removed.stops.present.map((s) => (s.place.kind === "node" ? s.place.fraId : 0))).toEqual([3]);
    expect(sessionReducer(removed, { type: "undo" }).stops.present).toHaveLength(2);
  });

  it("ignores a stop on a node that is already a stop", () => {
    const one = run(session(), { type: "stopPicked", node: node(1, ["BNSF"]), index: 0 });
    const again = run(one, { type: "pick", target: "stop" }, { type: "stopPicked", node: node(1, ["BNSF"]), index: 0 });
    expect(again.stops).toBe(one.stops);
    expect(again.pick).toBeNull();
  });

  it("reportOf is null until both times are filled in, and reads them in the browser's zone", () => {
    expect(reportOf(run(session(), { type: "edit", field: "prepEnd", value: "" }, { type: "submit" }))).toBeNull();
    expect(reportOf(session())?.prepEnd).toBe(new Date(2026, 10, 19, 0, 0).toISOString());
  });

  it("stopInsertIndex puts a new stop where it adds the least detour", () => {
    const b = { lon: 0, lat: 0 };
    const shop = { lon: 10, lat: 0 };
    const stops = [{ lon: 3, lat: 0 }, { lon: 7, lat: 0 }];
    expect(stopInsertIndex(b, stops, shop, { lon: 1, lat: 0.1 })).toBe(0);
    expect(stopInsertIndex(b, stops, shop, { lon: 5, lat: 0.1 })).toBe(1);
    expect(stopInsertIndex(b, stops, shop, { lon: 9, lat: 0.1 })).toBe(2);
    expect(stopInsertIndex(b, [], shop, { lon: 4, lat: 3 })).toBe(0);
  });

  it("a batch row becomes form values with its saved stops", () => {
    const row: BatchCar = {
      batch: { id: "b" as BatchId, name: "n", asOf: "2026-11-17T15:00:00.000Z" as Instant, createdAt: "2026-11-17T15:00:00.000Z" as Instant, source: { kind: "csv", label: "x" }, rows: 1, issues: [], example: false },
      row: 0,
      report: { carId: "551930", a: { kind: "text", text: "Fargo, ND" }, b: { kind: "code", codeType: "splc", code: "668240" }, shop: { kind: "text", text: "EX-KCY-01" }, stops: [], reportedAt: null, prepEnd: "2026-11-20T06:00:00.000Z" as Instant },
      fix: null,
    };
    const draft = draftOf(row);
    expect(draft.b.shown).toBe("668240");
    expect(draft.reportedAt).toBe("");
    expect(reportOf(startSession({ kind: "row", batchId: "b" as BatchId, row: 0 }, draft, [], row.batch.asOf))).toBeNull();
  });
});
