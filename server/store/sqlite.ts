/**
 * The Store on node:sqlite. The only file that knows the schema.
 *
 *   meta         (key PK, value)                                  schema_version
 *   settings     (key PK, json)                                   'assumptions'
 *   shops        (id PK, name, code UNIQUE NULL, location_json, example, updated_at)
 *   code_sets    (code_type PK, label, imported_at)
 *   node_codes   (code_type, code, name NULL, location_json, PRIMARY KEY (code_type, code))
 *   saved_routes (id PK, name, plan_json, option NULL)                          since schema 2
 *
 * Dormant since schema 2, kept because they hold user data: batches, batch_rows, route_fixes and the
 * 'import_profile' settings key. Nothing reads or writes them.
 *
 * Nested domain values (PlaceRef, NodeLocation, a plan) are stored as JSON text: the format of
 * company node codes is still unknown, and no query needs to look inside them. Columns exist only
 * for what is looked up: ids, (code_type, code), shop code and name, a saved route's name.
 */
import { chmodSync } from "node:fs";
import process from "node:process";
import { AppError } from "../../shared/app.ts";
import { DEFAULT_ASSUMPTIONS, type Assumptions } from "../../shared/assumptions.ts";
import type { CodeSet, CodeType, NodeCode, NodeLocation, Shop, ShopId } from "../../shared/places.ts";
import type { FullPlan, SavedRoute, SavedRouteId } from "../../shared/plans.ts";
import { DEFAULT_INCLUDE } from "../../shared/railroads.ts";
import { ROUTE_STRATEGIES, type RouteStrategy } from "../../shared/route.ts";
import type { Instant } from "../../shared/time.ts";
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

  const nodeCodeOf = (row: Row): NodeCode => ({
    codeType: String(row.code_type),
    code: String(row.code),
    name: row.name === null ? null : String(row.name),
    location: parse<NodeLocation>(row.location_json),
  });

  const planOf = (text: unknown): FullPlan => {
    const plan = parse<FullPlan>(text);
    // A route saved before track could be chosen has no `include`.
    return { ...plan, include: plan.include ?? DEFAULT_INCLUDE };
  };

  const savedRouteOf = (row: Row): SavedRoute => ({
    id: String(row.id) as SavedRouteId,
    name: String(row.name),
    plan: planOf(row.plan_json),
    // A value this version does not know reads as "no choice": the router's own route.
    option: (ROUTE_STRATEGIES as readonly unknown[]).includes(row.option) ? (row.option as RouteStrategy) : null,
  });

  const setting = <T>(key: string): T | null => {
    const row = db.prepare("SELECT json FROM settings WHERE key = ?").get(key) as Row | undefined;
    return row ? parse<T>(row.json) : null;
  };
  const saveSetting = (key: string, value: unknown) => {
    db.prepare("INSERT INTO settings (key, json) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET json = excluded.json").run(key, json(value));
    wrote(null);
  };

  /** LIKE treats % and _ as wildcards; a code may contain either. */
  const likePrefix = (text: string) => `${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

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

    codes: {
      sets: () =>
        (
          db
            .prepare("SELECT s.*, (SELECT COUNT(*) FROM node_codes c WHERE c.code_type = s.code_type) AS n FROM code_sets s ORDER BY s.label COLLATE NOCASE, s.code_type")
            .all() as Row[]
        ).map((row): CodeSet => ({ codeType: String(row.code_type), label: String(row.label), count: Number(row.n), importedAt: String(row.imported_at) as Instant })),
      find: (code, codeType) => {
        const t = code.trim();
        const rows =
          codeType === null
            ? db.prepare("SELECT * FROM node_codes WHERE code = ? COLLATE NOCASE ORDER BY code_type").all(t)
            : db.prepare("SELECT * FROM node_codes WHERE code = ? COLLATE NOCASE AND code_type = ? COLLATE NOCASE").all(t, codeType);
        return (rows as Row[]).map(nodeCodeOf);
      },
      search: (text, limit) => {
        const t = text.trim();
        if (!t || limit <= 0) return [];
        const like = likePrefix(t);
        return (
          db
            .prepare(
              `SELECT * FROM node_codes WHERE code LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\'
               ORDER BY (code LIKE ? ESCAPE '\\') DESC, code COLLATE NOCASE, code_type LIMIT ?`,
            )
            .all(like, like, like, limit) as Row[]
        ).map(nodeCodeOf);
      },
      replaceSet: (set: { codeType: CodeType; label: string }, codes: NodeCode[], at: Instant) =>
        transaction(() => {
          db.prepare("DELETE FROM node_codes WHERE code_type = ?").run(set.codeType);
          db.prepare(
            "INSERT INTO code_sets (code_type, label, imported_at) VALUES (?, ?, ?) ON CONFLICT (code_type) DO UPDATE SET label = excluded.label, imported_at = excluded.imported_at",
          ).run(set.codeType, set.label, at);
          const insert = db.prepare("INSERT INTO node_codes (code_type, code, name, location_json) VALUES (?, ?, ?, ?)");
          for (const code of codes) insert.run(set.codeType, code.code, code.name, json(code.location));
          wrote(null);
        }),
      removeSet: (codeType) =>
        transaction(() => {
          db.prepare("DELETE FROM node_codes WHERE code_type = ?").run(codeType);
          const removed = db.prepare("DELETE FROM code_sets WHERE code_type = ?").run(codeType).changes;
          return Number(removed) > 0 ? wrote(true) : false;
        }),
    },

    savedRoutes: {
      all: () => (db.prepare("SELECT * FROM saved_routes ORDER BY name COLLATE NOCASE, rowid").all() as Row[]).map(savedRouteOf),
      get: (id) => {
        const row = db.prepare("SELECT * FROM saved_routes WHERE id = ?").get(id) as Row | undefined;
        return row ? savedRouteOf(row) : null;
      },
      save: (route) => {
        // ON CONFLICT DO UPDATE, not REPLACE: the row keeps its rowid, so its place among same-named routes.
        db.prepare(
          `INSERT INTO saved_routes (id, name, plan_json, option) VALUES (?, ?, ?, ?)
           ON CONFLICT (id) DO UPDATE SET name = excluded.name, plan_json = excluded.plan_json, option = excluded.option`,
        ).run(route.id, route.name, json(route.plan), route.option);
        wrote(null);
      },
      remove: (id) => {
        const removed = db.prepare("DELETE FROM saved_routes WHERE id = ?").run(id).changes;
        return Number(removed) > 0 ? wrote(true) : false;
      },
    },

    settings: {
      assumptions: () => {
        const saved = setting<Assumptions>("assumptions");
        if (!saved) return structuredClone(DEFAULT_ASSUMPTIONS);
        // A group added after the user saved theirs takes its default.
        return {
          routing: { ...DEFAULT_ASSUMPTIONS.routing, ...saved.routing },
          timing: { ...DEFAULT_ASSUMPTIONS.timing, ...saved.timing },
          flags: { ...DEFAULT_ASSUMPTIONS.flags, ...saved.flags },
        };
      },
      saveAssumptions: (assumptions) => saveSetting("assumptions", assumptions),
    },

    close: () => {
      if (!open) return;
      open = false;
      db.close();
    },
  };
}
