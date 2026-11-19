/**
 * The application: everything the HTTP layer may ask for, as plain functions over domain types.
 * `createApp` is the composition root: the only place that knows which module needs which.
 */
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { loadNetwork, loadTrackShapes, type TrackShapes } from "../engine/index.ts";
import type { Config } from "./config.ts";
import { createDirectory, type Directory } from "./places/directory.ts";
import { createShops, type Shops } from "./places/shops.ts";
import { createPlans, type Plans } from "./plans/plans.ts";
import { startRoutePlanner } from "./routing/planner.ts";
import { importSqlite } from "./store/import-sqlite.ts";
import { openStore } from "./store/postgres.ts";
import type { Store } from "./store/store.ts";

export interface App {
  places: Directory;
  shops: Shops;
  plans: Plans;
  /** Routes drawn on the real track (the map's Real tracks). */
  track: TrackShapes;
  /** Stops the routing workers and closes the database. */
  close(): Promise<void>;
}

export async function createApp(config: Config): Promise<App> {
  const network = loadNetwork(config.networkDir);
  const track = loadTrackShapes(network, config.networkDir);
  const store = config.databaseUrl ? await openStore(config.databaseUrl) : await openLaptopStore(config.dataDir);
  const directory = createDirectory(network, store);
  const shops = createShops(store, directory);
  const planner = startRoutePlanner({ networkDir: config.networkDir, networkVersion: network.version, workers: config.routeWorkers });
  const plans = createPlans({ store, directory, planner });

  return {
    places: directory,
    shops,
    plans,
    track,
    async close() {
      await planner.close();
      await store.close();
    },
  };
}

/** PGlite in dataDir/postgres. Created once: then it takes in the SQLite file (visnarn.db) an older copy of the app left. */
async function openLaptopStore(dataDir: string): Promise<Store> {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const folder = join(dataDir, "postgres");
  const sqlite = join(dataDir, "visnarn.db");
  const created = !existsSync(folder);
  const store = await openStore(folder);
  if (!created || !existsSync(sqlite)) return store;
  try {
    const moved = await importSqlite(sqlite, store);
    console.log(`Moved ${moved.shops} shops and ${moved.routes} saved routes from ${sqlite} (left as it was) into ${folder}.`);
    return store;
  } catch (error) {
    // Half moved is not moved: the next start tries again from the start.
    await store.close();
    rmSync(folder, { recursive: true, force: true });
    throw error;
  }
}
