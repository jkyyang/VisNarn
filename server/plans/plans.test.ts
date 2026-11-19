/** Plans on the real network: a real Directory, one routing worker, an in-memory store. */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DEFAULT_NETWORK_DIR, loadNetwork } from "../../engine/index.ts";
import { AppError } from "../../shared/app.ts";
import { DEFAULT_INCLUDE } from "../../shared/railroads.ts";
import type { FraId, PlaceRef } from "../../shared/places.ts";
import type { Plan, PlannedRoute, PlanProblem, SavedRouteDraft, SavedRouteId } from "../../shared/plans.ts";
import { createDirectory } from "../places/directory.ts";
import { startRoutePlanner, type RoutePlanner } from "../routing/planner.ts";
import { openStore } from "../store/postgres.ts";
import type { Store } from "../store/store.ts";
import { createPlans, type Plans } from "./plans.ts";

let store: Store;
let planner: RoutePlanner;
let plans: Plans;

beforeAll(async () => {
  const network = loadNetwork();
  store = await openStore("memory://");
  planner = startRoutePlanner({ networkDir: DEFAULT_NETWORK_DIR, networkVersion: network.version, workers: 1 });
  plans = createPlans({ store, directory: createDirectory(network, store), planner });
});
afterAll(async () => {
  await planner.close();
  await store.close();
});

const text = (t: string): PlaceRef => ({ kind: "text", text: t });
const plan = (start: PlaceRef | null, destination: PlaceRef | null, stops: (PlaceRef | null)[] = []): Plan => ({ places: [start, ...stops, destination], include: DEFAULT_INCLUDE, turnAtStops: false });
const TAYLOR_TO_NLR = plan(text("Taylor, TX"), text("North Little Rock, AR"));
/** The Temple wye, where BNSF and UP meet. */
const WYE = 358070 as FraId;

const routed = (answer: PlannedRoute) => {
  if (answer.outcome !== "routed") throw new Error(`not routed: ${answer.outcome}`);
  return answer;
};
const refusal = async (run: () => Promise<unknown>): Promise<AppError | null> => {
  try {
    await run();
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  return null;
};

describe("Plans.route", () => {
  it("a plan with only a start is incomplete, with the start resolved", async () => {
    const answer = await plans.route(plan(text("Kansas City, MO"), null));
    expect(answer.outcome).toBe("incomplete");
    expect(answer.places[0]?.ok && answer.places[0].place.label).toBe("Kansas City, MO");
    expect(answer.places[1]).toBeNull();
  });

  it("a place that does not resolve is incomplete, and says so at that place", async () => {
    const answer = await plans.route(plan(text("Taylor, TX"), text("Nowhere Junction XYZ")));
    expect(answer.outcome).toBe("incomplete");
    expect(answer.places[1]?.ok).toBe(false);
    const stop = await plans.route(plan(text("Taylor, TX"), text("North Little Rock, AR"), [{ kind: "node", fraId: 1 as FraId, railroad: null }]));
    expect(stop.outcome).toBe("incomplete");
    expect(stop.places[1]?.ok).toBe(false);
  });

  it("routes through the set rows, skipping an empty one, and says a problem at its own row", async () => {
    const answer = routed(await plans.route(plan(text("Taylor, TX"), text("North Little Rock, AR"), [null])));
    expect(answer.places[1]).toBeNull();
    expect(answer.routes[0].km).toBeGreaterThan(500);
    const behind = await plans.route(plan(text("Taylor, TX"), { kind: "coord", lon: -94.0116, lat: 33.4423 }, [null, { kind: "node", fraId: 362313 as FraId, railroad: null }]));
    expect(behind).toMatchObject({ outcome: "no-route", problem: { at: 2 } });
  });

  it("routes Taylor, TX to North Little Rock, AR the same way twice", async () => {
    const first = routed(await plans.route(TAYLOR_TO_NLR));
    expect(first.routes[0].strategies[0]).toBe("pick");
    expect(first.routes[0].km).toBeGreaterThan(500);
    expect(await plans.route(TAYLOR_TO_NLR)).toEqual(first);
  });

  it("the same place as start and destination is no route, said at the destination", async () => {
    const kc = (await plans.route(plan(text("Kansas City, MO"), null))).places[0];
    if (!kc?.ok) throw new Error("Kansas City, MO does not resolve");
    for (const same of [plan(text("Temple, TX"), text("Temple, TX")), plan(text("Kansas City, MO"), kc.place.ref), plan(kc.place.ref, kc.place.ref)]) {
      expect(await plans.route(same)).toMatchObject({ outcome: "no-route", problem: { at: 1, message: "Start and destination are the same place." } });
    }
  });

  it("keeps to the line chosen at a stop", async () => {
    const answer = routed(await plans.route(plan(text("Taylor, TX"), text("North Little Rock, AR"), [{ kind: "node", fraId: WYE, railroad: "UP" }])));
    for (const route of answer.routes) {
      const at = route.steps.find((step) => step.kind === "stop");
      expect(at, route.strategies[0]).toBeDefined();
      // The leg running when the route reaches the stop is on UP.
      const leg = [...route.steps].filter((step) => step.kind === "leg" && step.kmFromStart <= (at?.kmFromStart ?? 0)).at(-1);
      expect(leg?.kind === "leg" && route.legs[leg.leg].railroad).toBe("UP");
    }
  });

  it("routes over the track the plan includes: Ville Platte's short-line shop only with short lines ticked", async () => {
    const villePlatte = plan(text("Baton Rouge, LA"), { kind: "coord", lon: -92.271, lat: 30.688 });
    expect(await plans.route(villePlatte)).toMatchObject({ outcome: "no-route", problem: { at: 1 } });
    const answer = routed(await plans.route({ ...villePlatte, include: { ...DEFAULT_INCLUDE, shortLine: true } }));
    expect(answer.routes[0].legs.at(-1)?.railroad).toBe("short line");
  });

  it("no route is said at the place the allowed track cuts off, start or destination, with or without stops", async () => {
    // Oakville, ON is reached only over GO Transit's passenger-owned track.
    const oakville: PlaceRef = { kind: "coord", lon: -79.7195, lat: 43.4169 };
    const include = { regional: false, shortLine: false, passenger: false };
    const cases: [Plan, PlanProblem["at"]][] = [
      [plan(oakville, text("Birmingham, AL")), 0],
      [plan(oakville, text("Birmingham, AL"), [text("Chicago, IL")]), 0],
      [plan(text("Chicago, IL"), oakville), 1],
    ];
    for (const [cut, at] of cases) {
      const answer = await plans.route({ ...cut, include });
      expect(answer).toMatchObject({ outcome: "no-route", problem: { at } });
      if (answer.outcome === "no-route") expect(answer.problem.message).not.toContain("stop before");
    }
  });

  it("no route is said at the place it breaks, in the plan's words", async () => {
    // Ville Platte, LA: only a short line has track there.
    const notServed = await plans.route(plan({ kind: "coord", lon: -92.271, lat: 30.688 }, text("Baton Rouge, LA")));
    expect(notServed).toMatchObject({ outcome: "no-route", problem: { at: 0, message: "No allowed railroad has track here." } });

    // Oakville, ON without passenger-owned track.
    const noPath = await plans.route({ ...plan(text("Chicago, IL"), { kind: "coord", lon: -79.7195, lat: 43.4169 }), include: { regional: false, shortLine: false, passenger: false } });
    expect(noPath).toMatchObject({ outcome: "no-route", problem: { at: 1, message: "No route on the allowed track joins this place to the rest of the route." } });

    // A stop on a branch the route can only leave the wrong way: the stop is the place at fault.
    const deadEnd = await plans.route(plan(text("Taylor, TX"), { kind: "coord", lon: -94.0116, lat: 33.4423 }, [{ kind: "node", fraId: 362313 as FraId, railroad: null }]));
    expect(deadEnd).toMatchObject({ outcome: "no-route", problem: { at: 1, message: "The route cannot go on from here without turning back." } });

    for (const answer of [notServed, noPath, deadEnd]) {
      if (answer.outcome !== "no-route") continue;
      expect(answer.problem.message).not.toMatch(/\bA\b|\bB\b|shop/);
    }
  });
});

describe("Plans: saved routes", () => {
  const draft = (name: string, over: Partial<SavedRouteDraft> = {}): SavedRouteDraft => ({
    name,
    plan: { places: [text("Kansas City, MO"), text("Chicago, IL")], include: DEFAULT_INCLUDE, turnAtStops: false },
    option: null,
    routeString: "BNSF",
    ...over,
  });

  it("saves, lists by name, saves unchanged without a write, replaces, and removes", async () => {
    const taylor = await plans.save(draft("Taylor → NLR"), null);
    const kc = await plans.save(draft("kc → Chicago", { option: "shortest" }), null);
    expect(kc.id).toMatch(/^[0-9a-f-]{36}$/);
    expect((await plans.saved()).map((r) => r.name)).toEqual(["kc → Chicago", "Taylor → NLR"]);

    const writes = vi.spyOn(store.savedRoutes, "save");
    expect(await plans.save(draft("kc → Chicago", { option: "shortest" }), kc.id)).toEqual(kc);
    expect(writes).not.toHaveBeenCalled();

    const renamed = await plans.save(draft("KC → Chicago via Galesburg", { option: "shortest" }), kc.id);
    expect(renamed).toMatchObject({ id: kc.id, name: "KC → Chicago via Galesburg" });
    expect(writes).toHaveBeenCalledTimes(1);

    await plans.remove(taylor.id);
    expect((await plans.saved()).map((r) => r.id)).toEqual([kc.id]);
    await plans.remove(kc.id);
  });

  it("an unknown id is not-found; a blank name is invalid", async () => {
    const missing = "no-such-route" as SavedRouteId;
    expect(await refusal(() => plans.save(draft("x"), missing))).toMatchObject({ kind: "not-found" });
    expect(await refusal(() => plans.remove(missing))).toMatchObject({ kind: "not-found" });
    expect(await refusal(() => plans.save(draft("   "), null))).toMatchObject({ kind: "invalid", field: "name" });
  });
});
