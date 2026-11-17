/** Reads the network files from disk. The one loader for the server, its routing worker, the backtest and the tests. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { GraphMeta } from "./core/graph.ts";
import { openNetwork, type RailNetwork } from "./network.ts";

/** public/data: the same files the browser draws its basemap from. */
export const DEFAULT_NETWORK_DIR = fileURLToPath(new URL("../public/data/", import.meta.url));

export function loadNetwork(dir: string = DEFAULT_NETWORK_DIR): RailNetwork {
  const read = (name: string) => {
    try {
      return readFileSync(join(dir, name));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error(`${join(dir, name)} is missing. Run "npm run data" to build public/data.`);
      throw error;
    }
  };
  const bin = read("graph.bin");
  const metaBytes = read("graph_meta.json");
  // Both files: graph_meta.json holds the FRA ids and names the paths are described with.
  const version = createHash("sha256").update(bin).update(metaBytes).digest("hex").slice(0, 12);
  const meta = JSON.parse(metaBytes.toString("utf8")) as GraphMeta;
  return openNetwork(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer, meta, version);
}
