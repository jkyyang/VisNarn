/**
 * The Store on node:sqlite. The only file that knows the schema.
 *
 *   meta         (key PK, value)                                  schema_version
 *   shops        (id PK, name, code UNIQUE NULL, location_json, example, updated_at)
 *   saved_routes (id PK, name, plan_json, option NULL, route_string)            since schema 2; route_string since 3
 *
 * Dormant, kept because they may hold user data: settings, code_sets, node_codes, batches, batch_rows,
 * route_fixes. Nothing reads or writes them.
 *
 * Nested domain values (NodeLocation, a plan) are stored as JSON text: no query needs to look inside
 * them. Columns exist only for what is looked up: ids, shop code and name, a saved route's name.
 */
import { chmodSync } from "node:fs";
import process from "node:process";
import { AppError } from "../../shared/app.ts";
import type { NodeLocation, PlaceRef, Shop, ShopId } from "../../shared/places.ts";
import type { FullPlan, SavedRoute, SavedRouteId } from "../../shared/plans.ts";
import { DEFAULT_INCLUDE } from "../../shared/railroads.ts";
import { ROUTE_STRATEGIES, type RouteStrategy } from "../../shared/route.ts";
import type { Store } from "./store.ts";

/** Applied in order; the database records how many it has. Never edit one that has shipped: add another. */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE settings (key TEXT PRIMARY KEY, json TEXT NOT NULL);
  CREATE TABLE shops (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    code TEXT UNIQUE COLLATE NOCASE,
    location_json TEXT NOT NULL,
    example INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX shops_by_name ON shops (name COLLATE NOCASE);
  CREATE TABLE code_sets (code_type TEXT PRIMARY KEY COLLATE NOCASE, label TEXT NOT NULL, imported_at TEXT NOT NULL);
  CREATE TABLE node_codes (
    code_type TEXT NOT NULL COLLATE NOCASE REFERENCES code_sets (code_type) ON DELETE CASCADE,
    code TEXT NOT NULL COLLATE NOCASE,
    name TEXT,
    location_json TEXT NOT NULL,
    PRIMARY KEY (code_type, code)
  );
  CREATE INDEX node_codes_by_code ON node_codes (code COLLATE NOCASE);
  CREATE TABLE batches (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    as_of TEXT NOT NULL,
    created_at TEXT NOT NULL,
    source_json TEXT NOT NULL,
    issues_json TEXT NOT NULL,
    example INTEGER NOT NULL DEFAULT 0,
    content_hash TEXT NOT NULL UNIQUE
  );
  CREATE TABLE batch_rows (
    batch_id TEXT NOT NULL REFERENCES batches (id) ON DELETE CASCADE,
    row INTEGER NOT NULL,
    report_json TEXT NOT NULL,
    PRIMARY KEY (batch_id, row)
  );
  CREATE TABLE route_fixes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id TEXT NOT NULL REFERENCES batches (id) ON DELETE CASCADE,
    row INTEGER NOT NULL,
    stops_json TEXT NOT NULL,
    saved_at TEXT NOT NULL,
    reverted_at TEXT
  );
  CREATE INDEX route_fixes_by_row ON route_fixes (batch_id, row, id);
  `,
  `
  CREATE TABLE saved_routes (id TEXT PRIMARY KEY, name TEXT NOT NULL, plan_json TEXT NOT NULL, option TEXT);
  `,
  `
  ALTER TABLE saved_routes ADD COLUMN route_string TEXT NOT NULL DEFAULT '';
  `,
];

type Row = Record<string, unknown>;

// Not a static import: vitest 2's module runner does not know prefix-only built-ins and fails to load "sqlite".
const { DatabaseSync } = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");

/**
 * Opens (and creates or migrates) the database. ":memory:" for tests.
 * The file is opened with WAL and foreign keys on; migrations run in order inside one transaction.
 */
export function openStore(file: string): Store {
  const db = new DatabaseSync(file);
  if (file !== ":memory:") chmodSync(file, 0o600);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");

  // node:sqlite is synchronous and a method never awaits, so a transaction cannot interleave with another request.
  const transaction = <T>(work: () => T): T => {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  };

  const fresh = !db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'meta'").get();
  transaction(() => {
    db.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    const stored = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as Row | undefined;
    const version = stored ? Number(stored.value) : 0;
    if (version > MIGRATIONS.length) {
      throw new Error(`${file} was written by a newer version of Shop Arrival Check (schema ${version}). Update this copy of the app.`);
    }
    for (const sql of MIGRATIONS.slice(version)) db.exec(sql);
    db.prepare("INSERT INTO meta (key, value) VALUES ('schema_version', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(String(MIGRATIONS.length));
  });

  let revision = 0;
  let open = true;
  /** A write that changed something: whatever was computed from the store before it is now stale. */
  const wrote = <T>(result: T): T => {
    revision++;
    return result;
  };

  const now = () => new Date().toISOString();
  const json = (value: unknown) => JSON.stringify(value);
  const parse = <T>(text: unknown): T => JSON.parse(String(text)) as T;

  const shopOf = (row: Row): Shop => ({
    id: String(row.id) as ShopId,
    name: String(row.name),
    code: row.code === null ? null : String(row.code),
    location: parse<NodeLocation>(row.location_json),
    example: row.example === 1,
  });

  const planOf = (text: unknown): FullPlan => {
    const plan = parse<Partial<FullPlan> & { start?: PlaceRef; stops?: PlaceRef[]; destination?: PlaceRef }>(text);
    return {
      // Routes saved before the places list keep start, stops and destination as three fields.
      places: plan.places ?? [plan.start!, ...(plan.stops ?? []), plan.destination!],
      // A route saved before track could be chosen has no `include`.
      include: plan.include ?? DEFAULT_INCLUDE,
    };
  };

  const savedRouteOf = (row: Row): SavedRoute => ({
    id: String(row.id) as SavedRouteId,
    name: String(row.name),
    plan: planOf(row.plan_json),
    // A value this version does not know reads as "no choice": the router's own route.
    option: (ROUTE_STRATEGIES as readonly unknown[]).includes(row.option) ? (row.option as RouteStrategy) : null,
    routeString: String(row.route_string),
  });

  return {
    fresh,
    get revision() {
      return revision;
    },

    shops: {
      all: () => (db.prepare("SELECT * FROM shops ORDER BY name COLLATE NOCASE, id").all() as Row[]).map(shopOf),
      get: (id) => {
        const row = db.prepare("SELECT * FROM shops WHERE id = ?").get(id) as Row | undefined;
        return row ? shopOf(row) : null;
      },
      named: (text) => {
        const t = text.trim();
        return (db.prepare("SELECT * FROM shops WHERE name = ? COLLATE NOCASE OR code = ? COLLATE NOCASE ORDER BY name COLLATE NOCASE, id").all(t, t) as Row[]).map(shopOf);
      },
      save: (shop) =>
        transaction(() => {
          if (shop.code !== null) {
            const other = db.prepare("SELECT name FROM shops WHERE code = ? COLLATE NOCASE AND id <> ?").get(shop.code, shop.id) as Row | undefined;
            if (other) throw new AppError("conflict", `The shop "${String(other.name)}" already has the code ${shop.code}. Give each shop its own code.`, "code");
          }
          db.prepare(
            `INSERT INTO shops (id, name, code, location_json, example, updated_at) VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT (id) DO UPDATE SET name = excluded.name, code = excluded.code, location_json = excluded.location_json,
               example = excluded.example, updated_at = excluded.updated_at`,
          ).run(shop.id, shop.name, shop.code, json(shop.location), shop.example ? 1 : 0, now());
          wrote(null);
        }),
      remove: (id) => {
        const removed = db.prepare("DELETE FROM shops WHERE id = ?").run(id).changes;
        return Number(removed) > 0 ? wrote(true) : false;
      },
    },

    savedRoutes: {
      all: () => (db.prepare("SELECT * FROM saved_routes ORDER BY name COLLATE NOCASE, rowid").all() as Row[]).map(savedRouteOf),
      get: (id) => {
        const row = db.prepare("SELECT * FROM saved_routes WHERE id = ?").get(id) as Row | undefined;
        return row ? savedRouteOf(row) : null;
      },
      save: (route) => {
        // ON CONFLICT DO UPDATE keeps the row's rowid, and with it the route's place among same-named routes.
        db.prepare(
          `INSERT INTO saved_routes (id, name, plan_json, option, route_string) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (id) DO UPDATE SET name = excluded.name, plan_json = excluded.plan_json, option = excluded.option, route_string = excluded.route_string`,
        ).run(route.id, route.name, json(route.plan), route.option, route.routeString);
        wrote(null);
      },
      remove: (id) => {
        const removed = db.prepare("DELETE FROM saved_routes WHERE id = ?").run(id).changes;
        return Number(removed) > 0 ? wrote(true) : false;
      },
    },

    close: () => {
      if (!open) return;
      open = false;
      db.close();
    },
  };
}
