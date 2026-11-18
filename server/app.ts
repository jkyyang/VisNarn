/**
 * The application: everything the HTTP layer may ask for, as plain functions over domain types.
 * `createApp` is the composition root: the only place that knows which module needs which.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadNetwork, loadTrackShapes, type TrackShapes } from "../engine/index.ts";
import { AppError, type Meta } from "../shared/app.ts";
import { RAILROADS } from "../shared/railroads.ts";
import type { Config } from "./config.ts";
import { exampleShops } from "./intake/example.ts";
import { createDirectory, type Directory } from "./places/directory.ts";
import { createShops, type Shops } from "./places/shops.ts";
import { createPlans, type Plans } from "./plans/plans.ts";
import { startRoutePlanner } from "./routing/planner.ts";
import type { Store } from "./store/store.ts";

export interface App {
  meta(): Meta;
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
  mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
  const databaseFile = join(config.dataDir, "visnarn.db");
  // Loaded here and not at the top: `--selftest` imports this file and must not touch the database.
  const { openStore } = await import("./store/sqlite.ts");
  const store = openStore(databaseFile);
  const directory = createDirectory(network, store);
  const shops = createShops(store, directory);
  const planner = startRoutePlanner({ networkDir: config.networkDir, networkVersion: network.version, workers: config.routeWorkers });
  const plans = createPlans({ store, directory, planner });

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
    places: directory,
    shops,
    plans,
    track,
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
