/**
 * `node server/main.ts --selftest`: proves, under plain Node rather than vitest's esbuild (which
 * accepts syntax Node refuses), that the server's sources load, a routing worker thread starts, and
 * the EXAMPLE car routes. It touches no database and opens no port.
 */
import { loadNetwork, type Trip } from "../engine/index.ts";
import { DEFAULT_ASSUMPTIONS } from "../shared/assumptions.ts";
import type { Waypoint } from "../shared/places.ts";
import type { Config } from "./config.ts";
import { startRoutePlanner } from "./routing/planner.ts";

export async function selfTest(config: Pick<Config, "networkDir">, log: (line: string) => void): Promise<boolean> {
  const started = performance.now();
  const network = loadNetwork(config.networkDir);
  const city = (name: string): Waypoint => {
    const found = network.city(name);
    if (!found) throw new Error(`The network has no city named ${name}.`);
    return { label: found.name, lon: found.lon, lat: found.lat, fraId: null, railroad: null };
  };
  const trip: Trip = { a: city("Taylor, TX"), b: city("Temple, TX"), stops: [], shop: city("North Little Rock, AR"), rules: DEFAULT_ASSUMPTIONS.routing };
  const planner = startRoutePlanner({ networkDir: config.networkDir, networkVersion: network.version, workers: 1 });
  try {
    const routed = await planner.plan(trip, "pick");
    if (!routed.ok) {
      log(`selftest FAILED: the EXAMPLE car (Taylor, TX → Temple, TX → North Little Rock, AR) has no route: ${routed.noRoute.message}`);
      return false;
    }
    const [path] = routed.trip.paths;
    const ms = Math.round(performance.now() - started);
    log(`selftest ok: network ${network.version}; EXAMPLE car Temple, TX → North Little Rock, AR routed in a worker thread: ${Math.round(path.km)} km on ${path.railroads.join(", ")} (${ms} ms)`);
    return true;
  } finally {
    await planner.close();
  }
}
