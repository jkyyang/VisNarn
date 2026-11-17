/** The planner with real worker threads (Node runs worker.ts directly, also under vitest). */
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createCarRouter, DEFAULT_NETWORK_DIR, loadNetwork, type RailNetwork, type Routed, type Trip } from "../../engine/index.ts";
import { DEFAULT_ASSUMPTIONS } from "../../shared/assumptions.ts";
import type { Waypoint } from "../../shared/places.ts";
import { startRoutePlanner, type RoutePlanner } from "./planner.ts";

const network: RailNetwork = loadNetwork();
const open: RoutePlanner[] = [];

afterEach(async () => {
  await Promise.all(open.splice(0).map((p) => p.close()));
});

const planner = (workers: number, networkDir = DEFAULT_NETWORK_DIR) => {
  const p = startRoutePlanner({ networkDir, networkVersion: network.version, workers });
  open.push(p);
  return p;
};

const city = (name: string): Waypoint => {
  const c = network.city(name)!;
  return { label: c.name, lon: c.lon, lat: c.lat, fraId: null, railroad: null };
};
const trip = (a: string, b: string, shop: string): Trip => ({ a: city(a), b: city(b), stops: [], shop: city(shop), rules: DEFAULT_ASSUMPTIONS.routing });
const EXAMPLE = () => trip("Taylor, TX", "Temple, TX", "North Little Rock, AR");
/** Long trips (a few hundred ms each), to keep a worker busy. */
const LONG = [trip("Fresno, CA", "Stockton, CA", "Miami, FL"), trip("Vancouver, BC", "Seattle, WA", "Halifax, NS"), trip("Oakland, CA", "Stockton, CA", "Jacksonville, FL"), trip("Tucson, AZ", "Phoenix, AZ", "Boston, MA")];
const SHORT = [trip("Austin, TX", "Taylor, TX", "Waco, TX"), trip("Dallas, TX", "Fort Worth, TX", "Waco, TX"), trip("Omaha, NE", "Council Bluffs, IA", "Lincoln, NE")];

/** Resolves in the order the plans finish. */
function finishOrder(plans: Record<string, Promise<Routed>>): Promise<string[]> {
  const order: string[] = [];
  return Promise.all(Object.entries(plans).map(([name, p]) => p.then(() => order.push(name)))).then(() => order);
}

describe("RoutePlanner", () => {
  it("plans the EXAMPLE trip in a worker and returns the engine's own answer", async () => {
    const routed = await planner(1).plan(EXAMPLE(), "pick");
    const direct = createCarRouter(network).route(EXAMPLE(), "pick");
    expect(direct.ok).toBe(true);
    expect(routed).toEqual({ ok: true, trip: direct.ok && { approach: direct.approach, straightKm: direct.straightKm, paths: [direct.path] } });
  });

  it("two identical requests in flight cost one search", async () => {
    const p = planner(2);
    const [one, two] = await Promise.all([p.plan(EXAMPLE(), "pick"), p.plan(EXAMPLE(), "pick")]);
    // One search, so both callers hold the very same answer, not two equal copies from two workers.
    expect(one.ok && two.ok && one.trip.approach === two.trip.approach).toBe(true);
  });

  it("'all' reuses a cached 'pick'", async () => {
    const p = planner(1);
    const pick = await p.plan(EXAMPLE(), "pick");
    expect(p.peek(EXAMPLE(), "all")).toBeUndefined();
    const all = await p.plan(EXAMPLE(), "all");
    if (!pick.ok || !all.ok) throw new Error("no route");
    expect(all.trip.approach).toBe(pick.trip.approach);
    expect(all.trip.paths[0].strategies[0]).toBe("pick");
    expect(all.trip.paths.length).toBeGreaterThan(1);
    expect(p.peek(EXAMPLE(), "all")).toEqual(all);
  });

  it("a foreground request overtakes queued background work", async () => {
    const p = planner(1);
    await p.plan(SHORT[0], "pick");
    const order = finishOrder({
      long0: p.plan(LONG[0], "pick", { background: true }),
      long1: p.plan(LONG[1], "pick", { background: true }),
      long2: p.plan(LONG[2], "pick", { background: true }),
      click: p.plan(SHORT[1], "pick"),
    });
    const done = await order;
    expect(done.indexOf("click")).toBeLessThan(done.indexOf("long1"));
    expect(done.indexOf("click")).toBeLessThan(done.indexOf("long2"));
  });

  it("with two workers, batch work leaves one thread free, so a click does not wait behind the list", async () => {
    const p = planner(2);
    await Promise.all([p.plan(SHORT[0], "pick"), p.plan(SHORT[2], "pick")]);
    const done = await finishOrder({
      long0: p.plan(LONG[0], "pick", { background: true }),
      long1: p.plan(LONG[1], "pick", { background: true }),
      long2: p.plan(LONG[3], "pick", { background: true }),
      click: p.plan(SHORT[1], "pick"),
    });
    expect(done[0]).toBe("click");
  });

  it("an aborted request that has not started is dropped and rejects", async () => {
    const p = planner(1);
    await p.plan(SHORT[0], "pick");
    const busy = p.plan(LONG[0], "pick", { background: true });
    const controller = new AbortController();
    const dropped = p.plan(SHORT[1], "pick", { signal: controller.signal });
    controller.abort(new Error("A newer check replaced this one."));
    await expect(dropped).rejects.toThrow("A newer check replaced this one.");
    await busy;
    await p.plan(SHORT[2], "pick");
    expect(p.peek(SHORT[1], "pick")).toBeUndefined();
    await expect(p.plan(SHORT[1], "pick", { signal: AbortSignal.abort(new Error("gone")) })).rejects.toThrow("gone");
  });

  it("peek never starts work", async () => {
    const p = planner(1);
    expect(p.peek(SHORT[2], "pick")).toBeUndefined();
    await p.plan(SHORT[0], "pick");
    expect(p.peek(SHORT[2], "pick")).toBeUndefined();
    const planned = await p.plan(SHORT[2], "pick");
    expect(p.peek(SHORT[2], "pick")).toEqual(planned);
  });

  it("a worker that dies is replaced and the queue keeps going", async () => {
    const dir = mkdtempSync(join(tmpdir(), "visnarn-planner-"));
    try {
      // With no network files a worker dies on start; each death costs only the job it held.
      const p = planner(1, dir);
      const first = p.plan(SHORT[0], "pick");
      const second = p.plan(SHORT[1], "pick");
      await expect(first).rejects.toThrow(/routing worker stopped/);
      await expect(second).rejects.toThrow(/routing worker stopped/);
      for (const name of ["graph.bin", "graph_meta.json"]) copyFileSync(join(DEFAULT_NETWORK_DIR, name), join(dir, name));
      const third = await p.plan(SHORT[0], "pick");
      expect(third.ok).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects what is still queued when it is closed", async () => {
    const p = planner(1);
    const queued = expect(p.plan(LONG[2], "pick")).rejects.toThrow(/closed/);
    await p.close();
    await queued;
    await expect(p.plan(SHORT[0], "pick")).rejects.toThrow(/closed/);
  });
});
