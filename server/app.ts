/**
 * The application: everything the HTTP layer may ask for, as plain functions over domain types.
 * `createApp` is the composition root: the only place that knows which module needs which.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { assumptionsProblem, loadNetwork } from "../engine/index.ts";
import { AppError, type Meta } from "../shared/app.ts";
import { DEFAULT_ASSUMPTIONS, type Assumptions } from "../shared/assumptions.ts";
import { RAILROADS } from "../shared/railroads.ts";
import type { Config } from "./config.ts";
import { exampleShops } from "./intake/example.ts";
import { createCodes, type Codes } from "./places/codes.ts";
import { createDirectory, type Directory } from "./places/directory.ts";
import { createShops, type Shops } from "./places/shops.ts";
import { createPlans, type Plans } from "./plans/plans.ts";
import { startRoutePlanner } from "./routing/planner.ts";
import type { Store } from "./store/store.ts";

export interface App {
  meta(): Meta;
  /** The routing rules. Kept on the server; no screen shows them in stage 1. */
  settings: {
    assumptions(): Assumptions;
    /** Throws AppError("invalid") with the reason when the numbers cannot produce a result. */
    saveAssumptions(assumptions: Assumptions): Assumptions;
  };
  places: Directory;
  shops: Shops;
  /** Company node codes: the seam for the company's own codes, with no screen yet. */
  codes: Codes;
  plans: Plans;
  /** Stops the routing workers and closes the database. */
  close(): Promise<void>;
}

export async function createApp(config: Config): Promise<App> {
  const network = loadNetwork(config.networkDir);
  mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
  const databaseFile = join(config.dataDir, "visnarn.db");
  // Loaded here and not at the top: `--selftest` imports this file and must not touch the database.
  const { openStore } = await import("./store/sqlite.ts");
  const store = openStore(databaseFile);
  const directory = createDirectory(network, store);
  const shops = createShops(store, directory);
  const codes = createCodes(store, directory);
  const planner = startRoutePlanner({ networkDir: config.networkDir, networkVersion: network.version, workers: config.routeWorkers });
  const plans = createPlans({ store, directory, planner, rules: () => store.settings.assumptions().routing });

  try {
    if (store.fresh) addExamples(store, shops);
  } catch (error) {
    await planner.close();
    store.close();
    throw error;
  }

  return {
    meta() {
      const shopRows = store.shops.all();
      return {
        graphVersion: network.version,
        railroads: RAILROADS,
        exampleOnly: shopRows.length > 0 && shopRows.every((shop) => shop.example) && store.savedRoutes.all().length === 0,
        storage: databaseFile,
      };
    },
    settings: {
      assumptions: () => store.settings.assumptions(),
      saveAssumptions(assumptions) {
        const problem = assumptionsProblem(assumptions);
        if (problem) throw new AppError("invalid", problem, fieldAtFault(assumptions));
        // Saving the numbers already in force writes nothing, so every route worked out under them stays valid.
        if (JSON.stringify(assumptions) !== JSON.stringify(store.settings.assumptions())) store.settings.saveAssumptions(assumptions);
        return store.settings.assumptions();
      },
    },
    places: directory,
    shops,
    codes,
    plans,
    async close() {
      await planner.close();
      store.close();
    },
  };
}

/**
 * The first start only (an empty database): the EXAMPLE shops. A user who deletes them does not get
 * them back. An EXAMPLE shop this network cannot place is left out.
 */
function addExamples(store: Store, shops: Shops): void {
  for (const draft of exampleShops()) {
    try {
      const { place: _place, ...shop } = shops.save(draft, null);
      store.shops.save({ ...shop, example: true });
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      console.error(`EXAMPLE shop ${draft.name} was not added: ${error.message}`);
    }
  }
}

/** The assumption a problem is about: the one whose default value makes that problem go away. */
function fieldAtFault(given: Assumptions): string | null {
  const problem = assumptionsProblem(given);
  for (const group of ["routing", "timing", "flags"] as const) {
    for (const key of Object.keys(given[group])) {
      const trial = structuredClone(given) as unknown as Record<string, Record<string, unknown>>;
      trial[group][key] = (DEFAULT_ASSUMPTIONS[group] as Record<string, unknown>)[key];
      if (assumptionsProblem(trial as unknown as Assumptions) !== problem) return `${group}.${key}`;
    }
  }
  return null;
}
