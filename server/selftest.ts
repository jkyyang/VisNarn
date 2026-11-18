/**
 * `node server/main.ts --selftest`: proves, under plain Node rather than vitest's esbuild (which
 * accepts syntax Node refuses), that the server's sources load, a routing worker thread starts, the
 * EXAMPLE route plans, and it draws along the real track (track.bin matches graph.bin). It
 * touches no database and opens no port.
 */
import { loadNetwork, loadTrackShapes, type Trip } from "../engine/index.ts";
import { pathKm } from "../shared/geo.ts";
import type { Waypoint } from "../shared/places.ts";
import { DEFAULT_INCLUDE } from "../shared/railroads.ts";
import type { Config } from "./config.ts";
import { startRoutePlanner } from "./routing/planner.ts";

export async function selfTest(config: Pick<Config, "networkDir">, log: (line: string) => void): Promise<boolean> {
  const started = performance.now();
  const network = loadNetwork(config.networkDir);
  const track = loadTrackShapes(network, config.networkDir);
  const city = (name: string): Waypoint => {
    const found = network.city(name);
    if (!found) throw new Error(`The network has no city named ${name}.`);
    return { label: found.name, lon: found.lon, lat: found.lat, fraId: null, railroad: null };
  };
  const trip: Trip = { points: [city("Taylor, TX"), city("Temple, TX"), city("North Little Rock, AR")], include: DEFAULT_INCLUDE, turnAtStops: false };
  const planner = startRoutePlanner({ networkDir: config.networkDir, networkVersion: network.version, workers: 1 });
  try {
    const routed = await planner.plan(trip);
    if (!routed.ok) {
      log(`selftest FAILED: the EXAMPLE route Taylor, TX to North Little Rock, AR (via Temple, TX) has no path: ${routed.noRoute.message}`);
      return false;
    }
    const [path] = routed.paths;
    // Drawn on the surveyed lines, the route is as long as the track km it was routed on; node to node it is shorter.
    const drawnKm = path.legs.reduce((km, leg) => km + pathKm(track.follow(leg.path)), 0);
    if (Math.abs(drawnKm - path.km) > 0.01 * path.km) {
      log(`selftest FAILED: the EXAMPLE route drawn on the real track is ${Math.round(drawnKm)} km against ${Math.round(path.km)} km routed: track.bin does not fit graph.bin. Run "npm run data".`);
      return false;
    }
    const ms = Math.round(performance.now() - started);
    log(`selftest ok: network ${network.version}; EXAMPLE route Taylor, TX to North Little Rock, AR routed in a worker thread: ${Math.round(path.km)} km on ${path.railroads.join(", ")} (${ms} ms)`);
    return true;
  } finally {
    await planner.close();
  }
}

