/** Plans on the real network: a real Directory, one routing worker, a ":memory:" store. */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_NETWORK_DIR, loadNetwork } from "../../engine/index.ts";
import { AppError } from "../../shared/app.ts";
import { DEFAULT_ASSUMPTIONS } from "../../shared/assumptions.ts";
import { DEFAULT_INCLUDE } from "../../shared/railroads.ts";
import type { FraId, PlaceRef } from "../../shared/places.ts";
import type { Plan, PlannedRoute, SavedRouteDraft, SavedRouteId } from "../../shared/plans.ts";
import { createDirectory } from "../places/directory.ts";
import { startRoutePlanner, type RoutePlanner } from "../routing/planner.ts";
import { openStore } from "../store/sqlite.ts";
import type { Store } from "../store/store.ts";
import { createPlans, type Plans } from "./plans.ts";

let store: Store;
let planner: RoutePlanner;
let plans: Plans;

beforeAll(() => {
  const network = loadNetwork();
  store = openStore(":memory:");
  planner = startRoutePlanner({ networkDir: DEFAULT_NETWORK_DIR, networkVersion: network.version, workers: 1 });
  plans = createPlans({ store, directory: createDirectory(network, store), planner, rules: () => store.settings.assumptions().routing });
});
afterAll(async () => {
  await planner.close();
  store.close();
});
afterEach(() => store.settings.saveAssumptions(DEFAULT_ASSUMPTIONS));

const text = (t: string): PlaceRef => ({ kind: "text", text: t });
const plan = (start: PlaceRef | null, destination: PlaceRef | null, stops: PlaceRef[] = []): Plan => ({ start, stops, destination, include: DEFAULT_INCLUDE });
const TAYLOR_TO_NLR = plan(text("Taylor, TX"), text("North Little Rock, AR"));
/** The Temple wye, where BNSF and UP meet. */
const WYE = 358070 as FraId;

const routed = (answer: PlannedRoute) => {
  if (answer.outcome !== "routed") throw new Error(`not routed: ${answer.outcome}`);
  return answer;
};
const refusal = (run: () => unknown): AppError | null => {
  try {
    run();
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
    expect(answer.places.start?.ok && answer.places.start.place.label).toBe("Kansas City, MO");
    expect(answer.places.destination).toBeNull();
  });

  it("a place that does not resolve is incomplete, and says so at that place", async () => {
    const answer = await plans.route(plan(text("Taylor, TX"), text("Nowhere Junction XYZ")));
    expect(answer.outcome).toBe("incomplete");
    expect(answer.places.destination?.ok).toBe(false);
    const stop = await plans.route(plan(text("Taylor, TX"), text("North Little Rock, AR"), [{ kind: "node", fraId: 1 as FraId, railroad: null }]));
    expect(stop.outcome).toBe("incomplete");
    expect(stop.places.stops[0].ok).toBe(false);
  });

  it("routes Taylor, TX to North Little Rock, AR the same way twice, with no clock in the answer", async () => {
    const first = routed(await plans.route(TAYLOR_TO_NLR));
    expect(first.routes[0].strategies[0]).toBe("pick");
    expect(first.routes[0].km).toBeGreaterThan(500);
    expect(await plans.route(TAYLOR_TO_NLR)).toEqual(first);
    const json = JSON.stringify(first);
    for (const key of ["eta", "verdict", "arrival", "marginH"]) expect(json).not.toContain(`"${key}"`);
  });

  it("the same place as start and destination is no route, said at the destination", async () => {
    const kc = (await plans.route(plan(text("Kansas City, MO"), null))).places.start;
    if (!kc?.ok) throw new Error("Kansas City, MO does not resolve");
    for (const same of [plan(text("Temple, TX"), text("Temple, TX")), plan(text("Kansas City, MO"), kc.place.ref), plan(kc.place.ref, kc.place.ref)]) {
      expect(await plans.route(same)).toMatchObject({ outcome: "no-route", problem: { at: "destination", message: "Start and destination are the same place." } });
    }
  });

  it("keeps to the line chosen at a stop", async () => {
    const answer = routed(await plans.route(plan(text("Taylor, TX"), text("North Little Rock, AR"), [{ kind: "node", fraId: WYE, railroad: "UP" }])));
    for (const route of answer.routes) {
      const at = route.steps.find((step) => step.kind === "stop");
      expect(at, route.strategies[0]).toBeDefined();
      // The leg running when the route reaches the stop is on UP.
      const leg = [...route.steps].filter((step) => step.kind === "leg" && step.kmFromB <= (at?.kmFromB ?? 0)).at(-1);
      expect(leg?.kind === "leg" && route.legs[leg.leg].railroad).toBe("UP");
    }
  });

  it("routes over the track the plan includes: Ville Platte's short-line shop only with short lines ticked", async () => {
    const villePlatte = plan(text("Baton Rouge, LA"), { kind: "coord", lon: -92.271, lat: 30.688 });
    expect(await plans.route(villePlatte)).toMatchObject({ outcome: "no-route", problem: { at: "destination" } });
    const answer = routed(await plans.route({ ...villePlatte, include: { ...DEFAULT_INCLUDE, shortLine: true } }));
    expect(answer.routes[0].legs.at(-1)?.railroad).toBe("short line");
  });

  it("no route is said at the place it breaks, in the plan's words", async () => {
    store.settings.saveAssumptions({ ...DEFAULT_ASSUMPTIONS, routing: { ...DEFAULT_ASSUMPTIONS.routing, allowed: ["CN"] } });
    const notServed = await plans.route(TAYLOR_TO_NLR);
    expect(notServed).toMatchObject({ outcome: "no-route", problem: { at: "start", message: "No allowed railroad has track here." } });

    store.settings.saveAssumptions({ ...DEFAULT_ASSUMPTIONS, routing: { ...DEFAULT_ASSUMPTIONS.routing, allowed: ["UP"] } });
    const noPath = await plans.route(plan(text("Houston, TX"), text("Pasco, WA")));
    expect(noPath).toMatchObject({ outcome: "no-route", problem: { at: "destination", message: "No allowed track reaches here from the place before." } });

    // A stop on a branch the car can only leave the wrong way: the stop is at fault, not the destination.
    store.settings.saveAssumptions(DEFAULT_ASSUMPTIONS);
    const deadEnd = await plans.route(plan(text("Taylor, TX"), { kind: "coord", lon: -94.0116, lat: 33.4423 }, [{ kind: "node", fraId: 362313 as FraId, railroad: null }]));
    expect(deadEnd).toMatchObject({ outcome: "no-route", problem: { at: 0, message: "The route cannot go on from here without turning back." } });

    for (const answer of [notServed, noPath, deadEnd]) {
      if (answer.outcome !== "no-route") continue;
      expect(answer.problem.message).not.toMatch(/\bA\b|\bB\b|shop/);
    }
  });
});

describe("Plans: saved routes", () => {
  const draft = (name: string, over: Partial<SavedRouteDraft> = {}): SavedRouteDraft => ({
    name,
    plan: { start: text("Kansas City, MO"), stops: [], destination: text("Chicago, IL"), include: DEFAULT_INCLUDE },
    option: null,
    ...over,
  });

  it("saves, lists by name, saves unchanged without a write, replaces, and removes", () => {
    const taylor = plans.save(draft("Taylor → NLR"), null);
    const kc = plans.save(draft("kc → Chicago", { option: "shortest" }), null);
    expect(kc.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(plans.saved().map((r) => r.name)).toEqual(["kc → Chicago", "Taylor → NLR"]);

    const revision = store.revision;
    expect(plans.save(draft("kc → Chicago", { option: "shortest" }), kc.id)).toEqual(kc);
    expect(store.revision).toBe(revision);

    const renamed = plans.save(draft("KC → Chicago via Galesburg", { option: "shortest" }), kc.id);
    expect(renamed).toMatchObject({ id: kc.id, name: "KC → Chicago via Galesburg" });
    expect(store.revision).toBe(revision + 1);

    plans.remove(taylor.id);
    expect(plans.saved().map((r) => r.id)).toEqual([kc.id]);
    plans.remove(kc.id);
  });

  it("an unknown id is not-found; a blank name is invalid", () => {
    const missing = "no-such-route" as SavedRouteId;
    expect(refusal(() => plans.save(draft("x"), missing))).toMatchObject({ kind: "not-found" });
    expect(refusal(() => plans.remove(missing))).toMatchObject({ kind: "not-found" });
    expect(refusal(() => plans.save(draft("   "), null))).toMatchObject({ kind: "invalid", field: "name" });
  });
});
