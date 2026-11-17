/**
 * The application: everything the HTTP layer may ask for, as plain functions over domain types.
 * `createApp` is the composition root: the only place that knows which module needs which.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { assumptionsProblem, loadNetwork } from "../engine/index.ts";
import { AppError, type Meta } from "../shared/app.ts";
import { DEFAULT_ASSUMPTIONS, type Assumptions } from "../shared/assumptions.ts";
import type { CarField, ImportProfile } from "../shared/cars.ts";
import { RAILROADS } from "../shared/railroads.ts";
import { createBatches, type Batches } from "./cars/batches.ts";
import { createChecks, type Checks } from "./cars/checks.ts";
import type { Config } from "./config.ts";
import { exampleBatch, exampleShops } from "./intake/example.ts";
import { createCodes, type Codes } from "./places/codes.ts";
import { createDirectory, type Directory } from "./places/directory.ts";
import { createShops, type Shops } from "./places/shops.ts";
import { startRoutePlanner } from "./routing/planner.ts";
import type { Store } from "./store/store.ts";

export interface App {
  meta(): Meta;
  settings: {
    assumptions(): Assumptions;
    /** Throws AppError("invalid") with the reason when the numbers cannot produce a result. */
    saveAssumptions(assumptions: Assumptions): Assumptions;
    importProfile(): ImportProfile;
    saveImportProfile(profile: ImportProfile): ImportProfile;
  };
  places: Directory;
  shops: Shops;
  codes: Codes;
  batches: Batches;
  checks: Checks;
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
  const batches = createBatches(store);
  const checks = createChecks({ network, store, directory, planner, batches });

  try {
    if (store.fresh) await addExamples(store, shops, batches);
  } catch (error) {
    await planner.close();
    store.close();
    throw error;
  }

  return {
    meta() {
      const rows = [...store.shops.all(), ...store.batches.all()];
      return {
        graphVersion: network.version,
        railroads: RAILROADS,
        exampleOnly: rows.length > 0 && rows.every((row) => row.example),
        storage: databaseFile,
      };
    },
    settings: {
      assumptions: () => store.settings.assumptions(),
      saveAssumptions(assumptions) {
        const problem = assumptionsProblem(assumptions);
        if (problem) throw new AppError("invalid", problem, fieldAtFault(assumptions));
        // Saving the numbers already in force writes nothing, so it leaves every batch's routing where it was.
        if (JSON.stringify(assumptions) !== JSON.stringify(store.settings.assumptions())) store.settings.saveAssumptions(assumptions);
        return store.settings.assumptions();
      },
      importProfile: () => store.settings.importProfile(),
      saveImportProfile(profile) {
        const seen = new Map<string, Exclude<CarField, "stops">>();
        for (const [field, column] of Object.entries(profile.columns) as [Exclude<CarField, "stops">, string][]) {
          const name = column.trim().toLowerCase();
          const other = seen.get(name);
          if (other) throw new AppError("invalid", `Two fields read the same column "${column.trim()}". Give each field its own column.`, `columns.${field}`);
          seen.set(name, field);
        }
        const clean: ImportProfile = {
          columns: Object.fromEntries(Object.entries(profile.columns).map(([field, column]) => [field, column.trim()])) as ImportProfile["columns"],
          positions: profile.positions === "text" ? "text" : { codeType: profile.positions.codeType.trim() },
          zonelessTimes: profile.zonelessTimes,
        };
        if (JSON.stringify(clean) !== JSON.stringify(store.settings.importProfile())) store.settings.saveImportProfile(clean);
        return store.settings.importProfile();
      },
    },
    places: directory,
    shops,
    codes,
    batches,
    checks,
    async close() {
      await planner.close();
      store.close();
    },
  };
}

/**
 * The first start only (an empty database): the EXAMPLE shops and the EXAMPLE batch. A user who
 * deletes them does not get them back. An EXAMPLE shop this network cannot place is left out.
 */
async function addExamples(store: Store, shops: Shops, batches: Batches): Promise<void> {
  for (const draft of exampleShops()) {
    try {
      const { place: _place, ...shop } = shops.save(draft, null);
      store.shops.save({ ...shop, example: true });
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      console.error(`EXAMPLE shop ${draft.name} was not added: ${error.message}`);
    }
  }
  await batches.upload(exampleBatch(new Date()));
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
