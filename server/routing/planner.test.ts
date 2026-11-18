/** The planner with real worker threads (Node runs worker.ts directly, also under vitest). */
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createCarRouter, DEFAULT_NETWORK_DIR, loadNetwork, type RailNetwork, type Trip } from "../../engine/index.ts";
import { DEFAULT_INCLUDE } from "../../shared/railroads.ts";
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
const trip = (start: string, stop: string, destination: string): Trip => ({ start: city(start), stops: [city(stop)], destination: city(destination), include: DEFAULT_INCLUDE });
const EXAMPLE = () => trip("Taylor, TX", "Temple, TX", "North Little Rock, AR");
/** A long trip (a few hundred ms), to keep a worker busy. */
const LONG = trip("Fresno, CA", "Stockton, CA", "Miami, FL");
const SHORT = [trip("Austin, TX", "Taylor, TX", "Waco, TX"), trip("Dallas, TX", "Fort Worth, TX", "Waco, TX"), trip("Omaha, NE", "Council Bluffs, IA", "Lincoln, NE")];

describe("RoutePlanner", () => {
  it("plans the EXAMPLE trip in a worker and returns the engine's own answer", async () => {
    const routed = await planner(1).plan(EXAMPLE(), "pick");
    const direct = createCarRouter(network).route(EXAMPLE(), "pick");
    expect(direct.ok).toBe(true);
    expect(routed).toEqual({ ok: true, paths: [direct.ok && direct.path] });
  });

  it("two identical requests in flight cost one search", async () => {
    const p = planner(2);
    const [one, two] = await Promise.all([p.plan(EXAMPLE(), "pick"), p.plan(EXAMPLE(), "pick")]);
    // One search, so both callers hold the very same answer, not two equal copies from two workers.
    expect(one.ok && two.ok && one.paths[0] === two.paths[0]).toBe(true);
  });

  it("'all' reuses a cached 'pick'", async () => {
    const p = planner(1);
    const pick = await p.plan(EXAMPLE(), "pick");
    const all = await p.plan(EXAMPLE(), "all");
    if (!pick.ok || !all.ok) throw new Error("no route");
    expect(all.paths[0].strategies[0]).toBe("pick");
    expect(all.paths.length).toBeGreaterThan(1);
  });

  it("an aborted request that has not started is dropped and rejects", async () => {
    const p = planner(1);
    await p.plan(SHORT[0], "pick");
    const busy = p.plan(LONG, "pick");
    const controller = new AbortController();
    const dropped = p.plan(SHORT[1], "pick", { signal: controller.signal });
    controller.abort(new Error("A newer check replaced this one."));
    await expect(dropped).rejects.toThrow("A newer check replaced this one.");
    await busy;
    await p.plan(SHORT[2], "pick");
    await expect(p.plan(SHORT[1], "pick", { signal: AbortSignal.abort(new Error("gone")) })).rejects.toThrow("gone");
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
    const queued = expect(p.plan(LONG, "pick")).rejects.toThrow(/closed/);
    await p.close();
    await queued;
    await expect(p.plan(SHORT[0], "pick")).rejects.toThrow(/closed/);
  });
});
