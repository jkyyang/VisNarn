/**
 * Once per laptop: copies the shops, shop links and saved routes of the SQLite file an older copy of the app
 * wrote (visnarn.db, schema 7) into a new Store. It reads a copy: the file itself is never opened or changed.
 * Delete this file once no laptop has a visnarn.db left to move.
 */
import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import type { FraId, NodeLocation, Shop, ShopId } from "../../shared/places.ts";
import type { FullPlan, SavedRoute, SavedRouteId } from "../../shared/plans.ts";
import type { RouteStrategy } from "../../shared/route.ts";
import type { Store } from "./store.ts";

type Row = Record<string, unknown>;

/** The last schema the SQLite store had. */
const SQLITE_SCHEMA = 7;

export async function importSqlite(file: string, store: Store): Promise<{ shops: number; routes: number }> {
  // Imported on demand: vitest 2's module runner does not know prefix-only built-ins and fails to load "sqlite".
  const { DatabaseSync } = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");
  // The file and its write-ahead log, if the last run left one, copied to a folder of its own.
  const copy = mkdtempSync(join(tmpdir(), "visnarn-import-"));
  for (const suffix of ["", "-wal"]) if (existsSync(file + suffix)) copyFileSync(file + suffix, join(copy, `visnarn.db${suffix}`));
  const db = new DatabaseSync(join(copy, "visnarn.db"));
  try {
    const version = Number((db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as Row).value);
    if (version !== SQLITE_SCHEMA) throw new Error(`${file} is at schema ${version}; open it once with the app at commit b9e50f0 (schema ${SQLITE_SCHEMA}), then start this one.`);
    const links = db.prepare("SELECT join_fra_node_id FROM shop_link WHERE shop_id = ? ORDER BY link_no");
    const shops = (db.prepare("SELECT * FROM shops").all() as Row[]).map(
      (row): Shop => ({
        id: String(row.id) as ShopId,
        name: String(row.name),
        code: row.code === null ? null : String(row.code),
        location: JSON.parse(String(row.location_json)) as NodeLocation,
        links: (links.all(String(row.id)) as Row[]).map((link) => Number(link.join_fra_node_id) as FraId),
      }),
    );
    const routes = (db.prepare("SELECT * FROM saved_routes ORDER BY rowid").all() as Row[]).map(
      (row): SavedRoute => ({
        id: String(row.id) as SavedRouteId,
        name: String(row.name),
        plan: JSON.parse(String(row.plan_json)) as FullPlan,
        option: row.option as RouteStrategy | null,
        routeString: String(row.route_string),
      }),
    );
    for (const shop of shops) await store.shops.save(shop);
    for (const route of routes) await store.savedRoutes.save(route);
    return { shops: shops.length, routes: routes.length };
  } finally {
    db.close();
    rmSync(copy, { recursive: true, force: true });
  }
}
