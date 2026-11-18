/** Where things are on this laptop. Read once at start; nothing else reads the environment. */
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_NETWORK_DIR } from "../engine/index.ts";

/** The server answers on this address only. There is no setting for it: with no login yet, the tool must not be reachable from the network. */
export const LOOPBACK = "127.0.0.1";

export interface Config {
  port: number;
  /**
   * Folder for the database file. Default: ~/.visnarn. Deliberately outside the repo, outside
   * public/ and dist/ (Vite serves and copies those), and outside ~/Documents (which a laptop may
   * sync to a cloud drive): real car data stays on this machine.
   */
  dataDir: string;
  /** Folder with graph.bin and graph_meta.json. */
  networkDir: string;
  /** Built front end to serve next to the API (`npm start`), or null: API only, unless `dev`. */
  webDir: string | null;
  /** `npm run dev`: Vite serves the page from source inside this server, on the same port, with hot reload. */
  dev?: boolean;
  /** Routing worker threads. Each holds its own router, about 70 MB. */
  routeWorkers: number;
}

const REPO = fileURLToPath(new URL("../", import.meta.url));

export function readConfig(argv: readonly string[], env: Readonly<Record<string, string | undefined>>): Config {
  let webDir: string | null = null;
  let dev = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--web") {
      const dir = argv[++i];
      if (!dir || dir.startsWith("--")) throw new Error("--web needs a folder, such as: --web dist");
      webDir = resolve(dir);
    } else if (arg === "--dev") dev = true;
    else if (arg !== "--selftest") throw new Error(`Unknown option "${arg}". Options: --dev, --web <folder>, --selftest.`);
  }
  if (dev && webDir) throw new Error("--dev serves the page from source and --web serves a built page: use one of them.");

  const dataDir = resolve(env.VISNARN_DATA_DIR?.trim() || join(env.HOME || homedir(), ".visnarn"));
  // The whole repo: in development Vite serves any file under it.
  for (const served of [REPO, ...(webDir ? [webDir] : [])]) {
    if (isInside(dataDir, served)) throw new Error(`The data folder ${dataDir} is inside ${served}, which the browser can read. Set VISNARN_DATA_DIR to a folder outside it.`);
  }
  return {
    port: wholeNumber(env.VISNARN_PORT, 5173, 0, 65535, "VISNARN_PORT"),
    dataDir,
    networkDir: DEFAULT_NETWORK_DIR,
    webDir,
    dev,
    routeWorkers: wholeNumber(env.VISNARN_ROUTE_WORKERS, 2, 1, 16, "VISNARN_ROUTE_WORKERS"),
  };
}

/** `node server/main.ts --selftest`: check that the server can start and route, then exit. */
export function selfTestRequested(argv: readonly string[]): boolean {
  return argv.includes("--selftest");
}

function wholeNumber(text: string | undefined, fallback: number, min: number, max: number, name: string): number {
  if (text === undefined || text.trim() === "") return fallback;
  const n = Number(text);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name} must be a whole number from ${min} to ${max} (it is "${text}").`);
  return n;
}

function isInside(child: string, parent: string): boolean {
  const rel = relative(resolve(parent), child);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}
