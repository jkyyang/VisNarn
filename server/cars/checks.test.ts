/** Checks with a real Directory and Store and a stub RoutePlanner (routes from the engine, no threads). */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { combine, createCarRouter, loadNetwork, tripKey, type CarRouter, type RailNetwork, type RouteResult, type Trip } from "../../engine/index.ts";
import { DEFAULT_ASSUMPTIONS } from "../../shared/assumptions.ts";
import type { BatchId, CarCheck, CarReport, CarSummary, CheckedCar } from "../../shared/cars.ts";
import type { FraId, ShopId } from "../../shared/places.ts";
import { ROUTE_STRATEGIES, type RouteStrategy } from "../../shared/route.ts";
import type { Instant } from "../../shared/time.ts";
import { exampleBatch, exampleShops } from "../intake/example.ts";
import { createDirectory } from "../places/directory.ts";
import { createShops } from "../places/shops.ts";
import type { RoutePlanner, Want } from "../routing/planner.ts";
import { openStore } from "../store/sqlite.ts";
import type { Store } from "../store/store.ts";
import { createBatches, type Batches } from "./batches.ts";
import { createChecks, summarize, urgency, type Checks } from "./checks.ts";

let network: RailNetwork;
let router: CarRouter;
beforeAll(() => {
  network = loadNetwork();
  router = createCarRouter(network);
});

interface PlanCall {
  key: string;
  want: Want;
  background: boolean;
  signal?: AbortSignal;
}

/** The planner's contract without threads: routes from the engine, a cache, and background work that waits until released. */
function stubPlanner() {
  const cache = new Map<string, RouteResult>();
  const calls: PlanCall[] = [];
  const held: (() => void)[] = [];
  let holding = false;
  let crashing = false;
  const keyOf = (trip: Trip, strategy: RouteStrategy) => `${tripKey(network.version, trip)}|${strategy}`;
  const strategies = (want: Want): readonly RouteStrategy[] => (want === "pick" ? ["pick"] : ROUTE_STRATEGIES);
  const run = (trip: Trip, want: Want) =>
    combine(
      strategies(want).map((s) => {
        const key = keyOf(trip, s);
        if (!cache.has(key)) cache.set(key, router.route(trip, s));
        return cache.get(key)!;
      }),
    );
  const planner: RoutePlanner = {
    plan(trip, want, options = {}) {
      calls.push({ key: tripKey(network.version, trip), want, background: !!options.background, signal: options.signal });
      if (options.signal?.aborted) return Promise.reject(options.signal.reason);
      if (crashing) return Promise.reject(new Error("The routing worker stopped (exit code 1)."));
      if (!(options.background && holding)) return Promise.resolve(run(trip, want));
      return new Promise((resolve, reject) => {
        held.push(() => {
          if (!options.signal?.aborted) resolve(run(trip, want));
        });
        options.signal?.addEventListener("abort", () => reject(options.signal!.reason), { once: true });
      });
    },
    peek(trip, want) {
      const results = strategies(want).map((s) => cache.get(keyOf(trip, s)));
      return results.every((r) => r !== undefined) ? combine(results as RouteResult[]) : undefined;
    },
    close: async () => {},
  };
  return {
    planner,
    calls,
    hold: () => void (holding = true),
    /** Every search fails, as when a worker thread dies. */
    crash: (on: boolean) => void (crashing = on),
    /** Runs the held background work, then lets its promises settle. */
    async release() {
      holding = false;
      held.splice(0).forEach((go) => go());
      await new Promise((done) => setTimeout(done, 0));
    },
  };
}

const stores: Store[] = [];
afterEach(() => stores.splice(0).forEach((s) => s.close()));

/** The EXAMPLE shops and batch, as a first start would have them. */
async function setup(): Promise<{ store: Store; checks: Checks; batches: Batches; stub: ReturnType<typeof stubPlanner>; batchId: BatchId }> {
  const store = openStore(":memory:");
  stores.push(store);
  const directory = createDirectory(network, store);
  const shops = createShops(store, directory);
  for (const draft of exampleShops()) shops.save(draft, null);
  const batches = createBatches(store);
  const batch = await batches.upload(exampleBatch(new Date("2026-11-17T15:00:00Z")));
  const stub = stubPlanner();
  const checks = createChecks({ network, store, directory, planner: stub.planner, batches });
  return { store, checks, batches, stub, batchId: batch.id };
}

const T0 = "2026-11-17T15:00:00.000Z" as Instant;
const later = (hours: number) => new Date(Date.parse(T0) + hours * 3_600_000).toISOString() as Instant;
const car = (over: Partial<CarReport> = {}): CarReport => ({
  carId: "EXAMPLE 104233",
  a: { kind: "text", text: "Taylor, TX" },
  b: { kind: "text", text: "Temple, TX" },
  shop: { kind: "text", text: "EX-NLR-01" },
  stops: [],
  reportedAt: T0,
  prepEnd: later(40),
  ...over,
});

const checked = (check: CarCheck): CheckedCar => {
  if (check.outcome !== "checked") throw new Error(`cannot check: ${check.problems.map((p) => p.message).join("; ")}`);
  return check;
};

describe("Checks.car", () => {
  it("an unresolved place, a null time, bad assumptions or no route is cannot-check with the field at fault", async () => {
    const { store, checks } = await setup();
    const fields = async (report: CarReport) => {
      const check = await checks.car(report, T0);
      expect(check).not.toHaveProperty("options");
      return check.outcome === "cannot-check" ? check.problems.map((p) => p.field) : [];
    };
    expect(await fields(car({ a: { kind: "text", text: "Nowhere at all" } }))).toEqual(["a"]);
    expect(await fields(car({ shop: { kind: "shop", shopId: "gone" as ShopId } }))).toEqual(["shop"]);
    expect(await fields(car({ stops: [{ place: { kind: "node", fraId: 1 as FraId, railroad: null }, note: null }] }))).toEqual(["stops"]);
    expect(await fields(car({ reportedAt: null, prepEnd: null }))).toEqual(["reportedAt", "prepEnd"]);
    // Places still resolve, so the form can show each one under its input.
    const partial = await checks.car(car({ a: { kind: "text", text: "Nowhere at all" } }), T0);
    expect(partial.places.b.ok && partial.places.shop.ok).toBe(true);

    const pasco = car({ a: { kind: "text", text: "Austin, TX" }, b: { kind: "text", text: "Houston, TX" }, shop: { kind: "text", text: "Pasco, WA" } });
    expect((await checks.car(pasco, T0)).outcome).toBe("checked");
    store.settings.saveAssumptions({ ...DEFAULT_ASSUMPTIONS, routing: { ...DEFAULT_ASSUMPTIONS.routing, allowed: ["UP"] } });
    expect(await fields(pasco)).toEqual(["route"]);
    store.settings.saveAssumptions({ ...DEFAULT_ASSUMPTIONS, routing: { ...DEFAULT_ASSUMPTIONS.routing, allowed: ["CN"] } });
    expect(await fields(car())).toEqual(["b"]);
    store.settings.saveAssumptions({ ...DEFAULT_ASSUMPTIONS, timing: { ...DEFAULT_ASSUMPTIONS.timing, speedKmPerDay: 0 } });
    const bad = await checks.car(car(), T0);
    expect(bad.outcome === "cannot-check" && bad.problems).toEqual([{ field: "assumptions", message: "Speed must be more than 0 km/day." }]);
  });

  it("a checked car has every option judged, the pick first", async () => {
    const { checks, stub } = await setup();
    const check = checked(await checks.car(car(), later(3)));
    expect(stub.calls).toMatchObject([{ want: "all", background: false }]);
    expect(check.options[0].id).toBe("pick");
    expect(check.options.length).toBeGreaterThan(1);
    expect(new Set(check.options.map((o) => o.id)).size).toBe(check.options.length);
    for (const option of check.options) {
      expect(option.verdict.group).toMatch(/^(act-now|check-first|ok)$/);
      expect(option.steps.at(-1)).toMatchObject({ kind: "shop", eta: option.verdict.arrival });
    }
    expect(check).toMatchObject({ positionAgeH: 3, graphVersion: network.version, assumptions: DEFAULT_ASSUMPTIONS, reportedAt: T0, prepEnd: later(40) });
    expect(check.places.shop.ok && check.places.shop.place.label).toBe("North Little Rock, AR");
  });

  it("a report time after the 'as of' time (a year typo, a wrong zone) is cannot-check, never an on-time car", async () => {
    const { checks } = await setup();
    const asOf = later(1);
    // Prep ends 100 h after the report; the car can arrive about 63 h after it, so it is Act now.
    const real = await checks.car(car({ prepEnd: later(100) }), asOf);
    expect(checked(real).options[0].verdict.group).toBe("act-now");
    const typo = await checks.car(car({ reportedAt: "2027-11-17T15:00:00.000Z" as Instant, prepEnd: later(100) }), asOf);
    expect(typo).not.toHaveProperty("options");
    expect(typo.outcome === "cannot-check" && typo.problems).toEqual([{ field: "reportedAt", message: expect.stringMatching(/about 1 year after the "as of" time.*time zone/) }]);
    const monthAhead = await checks.car(car({ reportedAt: later(24 * 30) }), asOf);
    expect(monthAhead.outcome === "cannot-check" && monthAhead.problems[0].message).toMatch(/^The report time is 30 days after/);
    // A clock a few minutes fast is not a problem.
    expect((await checks.car(car({ reportedAt: later(1.5) }), asOf)).outcome).toBe("checked");
  });

  it("is deterministic: the same report and asOf give the same answer", async () => {
    const { checks } = await setup();
    expect(await checks.car(car(), T0)).toEqual(await checks.car(car(), T0));
  });

  it("gives up when the request is aborted, instead of answering", async () => {
    const { checks } = await setup();
    await expect(checks.car(car(), T0, AbortSignal.abort(new Error("A newer check replaced this one.")))).rejects.toThrow("newer check");
  });
});

describe("Checks.batch", () => {
  it("never waits: rows not routed yet are pending, and progress counts the rest", async () => {
    const { checks, stub, batchId } = await setup();
    stub.hold();
    const view = checks.batch(batchId);
    expect(view.progress).toEqual({ checked: 0, total: 6 });
    expect(view.cars.every((c) => c.check.outcome === "pending" && c.group === null)).toBe(true);
    expect(view.cars.map((c) => c.carId)).toContain("EXAMPLE 104233");
    expect(stub.calls).toHaveLength(6);
    expect(stub.calls.every((c) => c.background && c.want === "pick")).toBe(true);
    // Reading again while routing is under way does not ask again.
    checks.batch(batchId);
    expect(stub.calls).toHaveLength(6);
  });

  it("a second call after routing finishes has every row checked or cannot-check", async () => {
    const { checks, stub, batchId } = await setup();
    stub.hold();
    checks.batch(batchId);
    await stub.release();
    const view = checks.batch(batchId);
    expect(view.progress).toEqual({ checked: 6, total: 6 });
    expect(view.cars.every((c) => c.check.outcome === "checked" && c.group !== null)).toBe(true);
    expect(view.cars.map((c) => c.shop)).toContain("North Little Rock, AR");
  });

  it("a timing change re-sorts the list without one planner call", async () => {
    const { store, checks, stub, batchId } = await setup();
    checks.batch(batchId);
    await stub.release();
    const before = checks.batch(batchId);
    const asked = stub.calls.length;
    store.settings.saveAssumptions({ ...DEFAULT_ASSUMPTIONS, timing: { ...DEFAULT_ASSUMPTIONS.timing, speedKmPerDay: 2000 } });
    const after = checks.batch(batchId);
    expect(stub.calls).toHaveLength(asked);
    expect(after.progress.checked).toBe(6);
    const groups = (cars: CarSummary[]) => cars.map((c) => c.group);
    expect(groups(after.cars)).not.toEqual(groups(before.cars));
    expect(after.cars.filter((c) => c.group === "act-now").length).toBeGreaterThan(before.cars.filter((c) => c.group === "act-now").length);
  });

  it("a routing change, a moved shop or a saved fix asks the planner under a new key and aborts the old work", async () => {
    const { store, checks, batches, stub, batchId } = await setup();
    stub.hold();
    checks.batch(batchId);
    const first = stub.calls.splice(0);
    const firstKeys = new Set(first.map((c) => c.key));

    store.settings.saveAssumptions({ ...DEFAULT_ASSUMPTIONS, routing: { ...DEFAULT_ASSUMPTIONS.routing, interchangePenaltyKm: 900 } });
    checks.batch(batchId);
    expect(first.every((c) => c.signal?.aborted)).toBe(true);
    const second = stub.calls.splice(0);
    expect(second).toHaveLength(6);
    expect(second.some((c) => firstKeys.has(c.key))).toBe(false);

    const shop = store.shops.named("EX-NLR-01")[0];
    store.shops.save({ ...shop, location: { lon: -92.3, lat: 34.75 } });
    checks.batch(batchId);
    expect(second.every((c) => c.signal?.aborted)).toBe(true);
    const third = stub.calls.splice(0);
    const row0 = (calls: typeof first) => calls.filter((c) => c.key.includes("-92.3,34.75"));
    expect(row0(third)).toHaveLength(1);

    batches.saveFix(batchId, 0, [{ place: { kind: "text", text: "Fort Worth, TX" }, note: "EXAMPLE stop" }]);
    checks.batch(batchId);
    const fourth = stub.calls.splice(0);
    const withStop = fourth.filter((c) => !third.some((t) => t.key === c.key));
    expect(withStop).toHaveLength(1);
  });

  it("a row with a saved fix is routed through its stops and marked fixed", async () => {
    const { checks, batches, stub, batchId } = await setup();
    checks.batch(batchId);
    await stub.release();
    const before = checks.batch(batchId).cars.find((c) => c.row === 0)!;
    batches.saveFix(batchId, 0, [{ place: { kind: "text", text: "Fort Worth, TX" }, note: null }]);
    checks.batch(batchId);
    await stub.release();
    const after = checks.batch(batchId).cars.find((c) => c.row === 0)!;
    expect(before.fixed).toBe(false);
    expect(after.fixed).toBe(true);
    expect(after.check.outcome === "checked" && before.check.outcome === "checked" && after.check.km !== before.check.km).toBe(true);
    const { report } = batches.car(batchId, 0);
    const full = checked(await checks.car(report, T0));
    expect(full.options[0].steps.some((s) => s.kind === "stop")).toBe(true);
    batches.revertFix(batchId, 0);
    expect(checks.batch(batchId).cars.find((c) => c.row === 0)).toEqual(before);
  });

  it("summarize(check) agrees with the full check's first option", async () => {
    const { checks, batches, stub, batchId } = await setup();
    checks.batch(batchId);
    await stub.release();
    const view = checks.batch(batchId);
    for (const line of view.cars) {
      const { report } = batches.car(batchId, line.row);
      const full = await checks.car(report, view.batch.asOf);
      expect(summarize(line.row, full, line.fixed), line.carId).toEqual(line);
    }
  });

  it("a row the import could not read is cannot-check, in check-first, with the import's own words", async () => {
    const { checks, batches, stub } = await setup();
    const batch = await batches.upload({
      name: "EXAMPLE broken",
      asOf: T0,
      source: { kind: "csv", fileName: "EXAMPLE broken.csv", text: "car_id,last_node,next_node,reported_at,shop,prep_end\nEXAMPLE 1,Taylor TX,Temple TX,yesterday,EX-NLR-01,2026-11-19 00:00Z\n" },
    });
    checks.batch(batch.id);
    await stub.release();
    const [line] = checks.batch(batch.id).cars;
    expect(line.group).toBe("check-first");
    expect(line.check.outcome === "cannot-check" && line.check.problems.find((p) => p.field === "reportedAt")?.message).toMatch(/"yesterday" is not a time/);
    expect(line.check.outcome === "cannot-check" && line.check.problems.map((p) => p.field)).toEqual(["reportedAt", "a", "b"]);
  });

  it("a row whose routing failed (a worker crashed) is cannot-check, field route, so the list settles; it is tried again later", async () => {
    const { checks, stub, batchId } = await setup();
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      stub.crash(true);
      checks.batch(batchId);
      await stub.release();
      const failed = checks.batch(batchId);
      expect(failed.progress).toEqual({ checked: 6, total: 6 });
      expect(failed.cars.every((c) => c.group === "check-first" && c.check.outcome === "cannot-check" && c.check.problems[0].field === "route")).toBe(true);
      stub.crash(false);
      vi.setSystemTime(Date.now() + 31_000);
      checks.batch(batchId);
      await stub.release();
      expect(checks.batch(batchId).cars.every((c) => c.check.outcome === "checked")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("orders act-now, check-first, ok, pending", () => {
    const line = (row: number, group: CarSummary["group"], marginH: number | "cannot" | "pending"): CarSummary => ({
      row,
      carId: `EXAMPLE ${row}`,
      shop: "EXAMPLE shop",
      shopExample: true,
      fixed: false,
      group,
      check:
        marginH === "pending"
          ? { outcome: "pending" }
          : marginH === "cannot"
            ? { outcome: "cannot-check", problems: [{ field: "a", message: "x" }] }
            : {
                outcome: "checked",
                verdict: { arrival: { ifAtB: T0, ifJustPastA: T0 }, marginH, timing: "on-time", flags: [], group: group ?? "ok" },
                km: 1,
                straightKm: 1,
                railroads: [],
                at: [0, 0],
                positionAgeH: 0,
              },
    });
    const list = [line(0, null, "pending"), line(1, "ok", 50), line(2, "check-first", 10), line(3, "act-now", -2), line(4, "ok", 30), line(5, "check-first", "cannot"), line(6, "act-now", -20), line(7, "check-first", 5), line(8, "act-now", -2)];
    expect(list.sort(urgency).map((c) => c.row)).toEqual([6, 3, 8, 5, 7, 2, 4, 1, 0]);
  });

  it("an unknown batch is not-found", async () => {
    const { checks } = await setup();
    expect(() => checks.batch("nope" as BatchId)).toThrow(/does not exist/);
  });
});
