/**
 * `npm run data:update`: keeps public/data in step with the BTS NTAD North American Rail Network.
 * launchd runs it every Monday at 07:00 (scripts/launchd/, scripts/README.md).
 *
 * 1. Ask the ArcGIS layer for its data edit date; the same date as data/source-version.json means "up to date".
 * 2. Otherwise run the pipeline in a temporary copy of it, so the live files are never half-written.
 * 3. Validate the new files: they load, the map has every class of line, the selftest passes, every shop routes from every origin.
 * 4. Only then copy them over public/data and commit them (those files and nothing else).
 * Every run ends with one line in the log and a macOS notification.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, cpSync, fstatSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCarRouter, DEFAULT_NETWORK_DIR, loadNetwork } from "../engine/index.ts";
import { csvRecords } from "../server/intake/csv.ts";
import { selfTest } from "../server/selftest.ts";
import { haversineKm } from "../shared/geo.ts";
import type { FraId, Waypoint } from "../shared/places.ts";
import { DEFAULT_INCLUDE, NETWORK_CLASSES } from "../shared/railroads.ts";

const REPO = fileURLToPath(new URL("../", import.meta.url));
const LAYER_URL = "https://services.arcgis.com/xOi1kZaI0eWDREZv/ArcGIS/rest/services/NTAD_North_American_Rail_Network_Lines/FeatureServer/0";
/** The files `npm run data` writes that the app uses (and git tracks). */
const DATA_FILES = ["graph.bin", "graph_meta.json", "track.bin", "basemap_mainline.geojson"];
const VERSION_FILE = "data/source-version.json";
const SHOPS_CSV = "docs/shops/marmon-rail-shops-public.csv";
const LOG_FILE = join(homedir(), "Library/Logs/visnarn-network-update.log");
/** Where each test route starts. Spread over the network's corners. */
const ORIGINS = ["Chicago, IL", "Temple, TX", "Barstow, CA", "Atlanta, GA", "Winnipeg, MB"];
const MAX_END_KM = 2.5;
const REPORT_KM_CHANGE = 0.05;
/** The source check: a laptop waking at 07:00 may not be online yet, so it tries again, waiting longer each time. */
const FETCH_TRIES = 3;
const FETCH_WAIT_MS = 60_000;
const FETCH_TIMEOUT_MS = 30_000;

export interface SourceVersion {
  /** The layer's editingInfo.dataLastEditDate, as an ISO date. */
  sourceDate: string;
  /** Hash of graph.bin and graph_meta.json, as the app reports it (engine/load.ts). */
  network: string;
}

export interface Shop {
  name: string;
  lon: number | null;
  lat: number | null;
  fraId: number | null;
}

/** One test car's route to one shop: its length, or why it does not count. */
export interface RouteCheck {
  route: string;
  km: number | null;
  problem: string | null;
}

/** The part of the layer's `?f=json` description used here. */
interface LayerInfo {
  editingInfo?: { dataLastEditDate?: number };
}

export function sourceDateOf(layer: LayerInfo): string {
  const ms = layer.editingInfo?.dataLastEditDate;
  if (typeof ms !== "number") throw new Error("The NARN layer did not report editingInfo.dataLastEditDate.");
  return new Date(ms).toISOString();
}

export function sourceChanged(recorded: SourceVersion | null, sourceDate: string): boolean {
  return recorded?.sourceDate !== sourceDate;
}

export function parseShops(csv: string): Shop[] {
  const number = (text: string | undefined) => (text ? Number(text) : null);
  return csvRecords("shops.csv", csv).map(({ cells }) => ({ name: cells.name, lon: number(cells.lon), lat: number(cells.lat), fraId: number(cells.fra_id) }));
}

/** Routes present before and after whose length changed by more than `limit` (0.05 = 5%). */
export function kmChanges(before: RouteCheck[], after: RouteCheck[], limit: number): string[] {
  const oldKm = new Map(before.map((r) => [r.route, r.km]));
  return after.flatMap(({ route, km }) => {
    const old = oldKm.get(route);
    if (km === null || old == null) return [];
    const change = (km - old) / old;
    if (Math.abs(change) <= limit) return [];
    return [`${route}: ${Math.round(old)} → ${Math.round(km)} km (${change > 0 ? "+" : ""}${(change * 100).toFixed(1)}%)`];
  });
}

/** Every origin to every shop on the network in `dir`. */
function checkRoutes(dir: string, shops: Shop[]): RouteCheck[] {
  const network = loadNetwork(dir);
  const router = createCarRouter(network);
  const city = (name: string): Waypoint => {
    const found = network.city(name);
    if (!found) throw new Error(`The network has no city named ${name}.`);
    return { label: found.name, lon: found.lon, lat: found.lat, fraId: null, railroad: null };
  };
  return ORIGINS.flatMap((origin) =>
    shops.map((shop): RouteCheck => {
      const route = `${origin} → ${shop.name}`;
      // A shop given only by its FRA node is wherever that node is in this build.
      const node = shop.fraId === null ? null : network.node(shop.fraId as FraId);
      if (shop.fraId !== null && !node) return { route, km: null, problem: `FRA node ${shop.fraId} is gone` };
      const lon = node?.lon ?? shop.lon!, lat = node?.lat ?? shop.lat!;
      const target: Waypoint = { label: shop.name, lon, lat, fraId: node?.fraId ?? null, railroad: null };
      const result = router.route({ points: [city(origin), target], include: DEFAULT_INCLUDE, turnAtStops: false }, "pick");
      if (!result.ok) return { route, km: null, problem: result.noRoute.message };
      const [endLon, endLat] = result.path.legs.at(-1)!.path.at(-1)!;
      const endKm = haversineKm(endLon, endLat, lon, lat);
      const problem = endKm > MAX_END_KM ? `ends ${endKm.toFixed(1)} km from the shop` : null;
      return { route, km: result.path.km, problem };
    }),
  );
}

/** Why the map's network file in `dir` will not do: its lines must have exactly the classes the map draws (web/map/layers.ts). */
function basemapProblem(dir: string): string | null {
  const { features } = JSON.parse(readFileSync(join(dir, "basemap_mainline.geojson"), "utf8")) as { features: { properties: { class: string } }[] };
  const classes = [...new Set(features.map((f) => f.properties.class))].sort();
  return classes.join() === [...NETWORK_CLASSES].sort().join() ? null : `basemap_mainline.geojson line classes: ${classes.join(", ") || "none"}; expected: ${NETWORK_CLASSES.join(", ")}`;
}

/** Problems with the network in `dir` (none means it may replace the live one), and routes whose length changed. */
export async function validate(dir: string): Promise<{ problems: string[]; changes: string[]; routes: number }> {
  const shops = parseShops(readFileSync(join(REPO, SHOPS_CSV), "utf8"));
  let after: RouteCheck[];
  try {
    loadNetwork(dir);
    const basemap = basemapProblem(dir);
    if (basemap) return { problems: [basemap], changes: [], routes: 0 };
    const selfTestLines: string[] = [];
    if (!(await selfTest({ networkDir: dir }, (line) => selfTestLines.push(line)))) return { problems: selfTestLines, changes: [], routes: 0 };
    after = checkRoutes(dir, shops);
  } catch (error) {
    return { problems: [(error as Error).message], changes: [], routes: 0 };
  }
  const problems = after.filter((r) => r.problem).map((r) => `${r.route}: ${r.problem}`);
  return { problems, changes: kmChanges(liveRoutes(shops), after, REPORT_KM_CHANGE), routes: after.length };
}

/** The same routes on the live network, to compare lengths. None if the live files no longer load (say, after a format change). */
function liveRoutes(shops: Shop[]): RouteCheck[] {
  try {
    return checkRoutes(DEFAULT_NETWORK_DIR, shops);
  } catch {
    return [];
  }
}

function log(line: string): void {
  const stamped = `${new Date().toISOString()} ${line}`;
  console.log(stamped);
  // Under launchd stdout already is the log file; writing again would double every line.
  if (!sameFile(1, LOG_FILE)) appendFileSync(LOG_FILE, `${stamped}\n`);
}

function sameFile(fd: number, path: string): boolean {
  try {
    const a = fstatSync(fd), b = statSync(path);
    return a.dev === b.dev && a.ino === b.ino;
  } catch {
    return false;
  }
}

function notify(line: string): void {
  spawnSync("osascript", ["-e", "on run argv", "-e", 'display notification (item 1 of argv) with title "Rail network update"', "-e", "end run", line]);
}

function finish(line: string, exitCode: number): number {
  log(line);
  notify(line);
  return exitCode;
}

async function fetchSourceDate(): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(`${LAYER_URL}?f=json`, { headers: { "User-Agent": "rail-network-update/1.0" }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return sourceDateOf((await response.json()) as LayerInfo);
    } catch (error) {
      if (attempt === FETCH_TRIES) throw new Error(`could not reach the NARN service: ${(error as Error).message}`);
      log(`source check attempt ${attempt} failed (${(error as Error).message}); retrying`);
      await new Promise((resolve) => setTimeout(resolve, attempt * FETCH_WAIT_MS));
    }
  }
}

/** Runs the pipeline in a copy of it under `work`; returns the folder with the new public/data files. */
function build(work: string): string {
  cpSync(join(REPO, "pipeline"), join(work, "pipeline"), { recursive: true });
  cpSync(join(REPO, "requirements.txt"), join(work, "requirements.txt"));
  symlinkSync(join(REPO, ".venv"), join(work, ".venv"));
  const run = spawnSync("bash", [join(work, "pipeline/run_all.sh")], { cwd: work, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  for (const line of `${run.stdout}${run.stderr}`.split(/[\r\n]+/)) if (line.trim()) log(`  build| ${line}`);
  if (run.status !== 0) throw new Error(`the pipeline failed (exit ${run.status}); output above`);
  return join(work, "public/data");
}

function readVersion(): SourceVersion | null {
  try {
    return JSON.parse(readFileSync(join(REPO, VERSION_FILE), "utf8")) as SourceVersion;
  } catch {
    return null;
  }
}

function graphSize(dir: string): string {
  const bin = readFileSync(join(dir, "graph.bin"));
  return `${bin.readUInt32LE(0).toLocaleString("en-US")} nodes, ${bin.readUInt32LE(4).toLocaleString("en-US")} edges`;
}

/** Copies each file next to its live twin, then renames it over: the app never reads a half-copied file. */
function swapIn(dir: string): void {
  for (const name of DATA_FILES) {
    const live = join(DEFAULT_NETWORK_DIR, name);
    cpSync(join(dir, name), `${live}.new`);
    renameSync(`${live}.new`, live);
  }
}

/** Commits the data files and the version file only, whatever else is uncommitted. False when nothing changed. */
function commit(message: string): boolean {
  const paths = [...DATA_FILES.map((name) => `public/data/${name}`), VERSION_FILE];
  const git = (...args: string[]) => execFileSync("git", args, { cwd: REPO, encoding: "utf8" });
  git("add", "--", ...paths);
  if (!git("diff", "--cached", "--name-only", "--", ...paths).trim()) return false;
  git("commit", "--quiet", "-m", message, "--only", "--", ...paths);
  return true;
}

async function main(): Promise<number> {
  const recorded = readVersion();
  const sourceDate = await fetchSourceDate();
  const day = sourceDate.slice(0, 10);
  if (!sourceChanged(recorded, sourceDate)) return finish(`up to date: NARN data of ${day}, network ${recorded!.network}`, 0);

  log(`NARN data of ${day} differs from the last build (${recorded?.sourceDate.slice(0, 10) ?? "none recorded"}); rebuilding`);
  const work = mkdtempSync(join(tmpdir(), "visnarn-network-"));
  const built = build(work);
  const { problems, changes, routes } = await validate(built);
  if (problems.length) {
    for (const problem of problems) log(`  invalid: ${problem}`);
    return finish(`update FAILED validation, kept the old data: ${problems[0]}${problems.length > 1 ? ` (+${problems.length - 1} more)` : ""}; build left in ${work}`, 1);
  }

  const oldNetwork = loadNetwork().version, oldSize = graphSize(DEFAULT_NETWORK_DIR);
  const newNetwork = loadNetwork(built).version, newSize = graphSize(built);
  swapIn(built);
  writeFileSync(join(REPO, VERSION_FILE), `${JSON.stringify({ sourceDate, network: newNetwork } satisfies SourceVersion, null, 2)}\n`);
  rmSync(work, { recursive: true, force: true });

  const summary = newNetwork === oldNetwork ? `network unchanged (${newNetwork})` : `network ${oldNetwork} → ${newNetwork}: ${oldSize} → ${newSize}`;
  for (const change of changes) log(`  km change: ${change}`);
  const routeLine = `${routes} shop routes checked, all end within ${MAX_END_KM} km; ${changes.length} changed by more than ${REPORT_KM_CHANGE * 100}%`;
  const message = [`Network data: NARN source of ${day}`, "", summary + ".", routeLine + (changes.length ? ":" : "."), ...changes.map((c) => `  ${c}`)].join("\n");
  const committed = commit(message);
  return finish(`updated to NARN data of ${day}: ${summary}; ${changes.length} routes changed >5%${committed ? "" : " (no file changed, nothing to commit)"}`, 0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await main();
  } catch (error) {
    process.exitCode = finish(`update FAILED, kept the old data: ${(error as Error).message}`, 1);
  }
}
