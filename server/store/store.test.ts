/** The Store against a ":memory:" database. Domain values in, the same values out. */
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AppError } from "../../shared/app.ts";
import { DEFAULT_INCLUDE } from "../../shared/railroads.ts";
import type { FraId, Shop, ShopId } from "../../shared/places.ts";
import type { SavedRoute, SavedRouteId } from "../../shared/plans.ts";
import { openStore } from "./sqlite.ts";
import type { Store } from "./store.ts";

const open: Store[] = [];
const folders: string[] = [];
afterEach(() => {
  open.splice(0).forEach((s) => s.close());
  folders.splice(0).forEach((f) => rmSync(f, { recursive: true, force: true }));
});
const memory = () => {
  const store = openStore(":memory:");
  open.push(store);
  return store;
};

const shop = (over: Partial<Shop> = {}): Shop => ({
  id: "s1" as ShopId,
  name: "North Little Rock, AR",
  code: "EX-NLR-01",
  location: { lon: -92.27, lat: 34.77 },
  links: [],
  ...over,
});
const route = (id: string, name: string, over: Partial<SavedRoute> = {}): SavedRoute => ({
  id: id as SavedRouteId,
  name,
  plan: { places: [{ kind: "text", text: "Kansas City, MO" }, { kind: "node", fraId: 358070 as FraId, railroad: "BNSF" }, { kind: "shop", shopId: "s1" as ShopId }], include: DEFAULT_INCLUDE, turnAtStops: false },
  option: null,
  routeString: "BNSF-[Temple, TX]-UP",
  ...over,
});

/**
 * A database file as an older copy of the app left it at schema `version` (1 to 6): one shop and no shop_link
 * table, before schema 5 the EXAMPLE flag set, and before schema 4 the car tables with rows.
 */
function olderFile(version: number, shape: (raw: { exec(sql: string): void }) => void): string {
  const dir = mkdtempSync(join(tmpdir(), "visnarn-store-"));
  folders.push(dir);
  const file = join(dir, "visnarn.db");
  const current = openStore(file);
  current.shops.save(shop());
  current.close();
  const { DatabaseSync } = process.getBuiltinModule("node:sqlite");
  const raw = new DatabaseSync(file);
  raw.exec(`DROP TABLE shop_link;
    UPDATE meta SET value = '${version}' WHERE key = 'schema_version';`);
  if (version < 5) raw.exec("ALTER TABLE shops ADD COLUMN example INTEGER NOT NULL DEFAULT 0; UPDATE shops SET example = 1;");
  if (version < 4) {
    raw.exec(`PRAGMA foreign_keys = ON;
    CREATE TABLE settings (key TEXT PRIMARY KEY, json TEXT NOT NULL);
    CREATE TABLE code_sets (code_type TEXT PRIMARY KEY, label TEXT NOT NULL, imported_at TEXT NOT NULL);
    CREATE TABLE node_codes (code_type TEXT NOT NULL REFERENCES code_sets (code_type) ON DELETE CASCADE, code TEXT NOT NULL, PRIMARY KEY (code_type, code));
    CREATE TABLE batches (id TEXT PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE batch_rows (batch_id TEXT NOT NULL REFERENCES batches (id) ON DELETE CASCADE, row INTEGER NOT NULL, PRIMARY KEY (batch_id, row));
    CREATE TABLE route_fixes (id INTEGER PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES batches (id) ON DELETE CASCADE, row INTEGER NOT NULL);
    INSERT INTO settings VALUES ('import_profile', '{}');
    INSERT INTO code_sets VALUES ('SPLC', 'SPLC', 't');
    INSERT INTO node_codes VALUES ('SPLC', '123');
    INSERT INTO batches VALUES ('b1', 'EXAMPLE');
    INSERT INTO batch_rows VALUES ('b1', 1);
    INSERT INTO route_fixes (batch_id, row) VALUES ('b1', 1);`);
  }
  shape(raw);
  raw.close();
  return file;
}

/** The file is at the newest schema and holds no table but meta, shops, their links and saved routes. */
function expectCurrentSchema(file: string): void {
  const { DatabaseSync } = process.getBuiltinModule("node:sqlite");
  const check = new DatabaseSync(file);
  expect(check.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get()).toEqual({ value: "7" });
  expect(check.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all()).toEqual([{ name: "meta" }, { name: "saved_routes" }, { name: "shop_link" }, { name: "shops" }]);
  expect((check.prepare("PRAGMA table_info(shops)").all() as { name: string }[]).map((column) => column.name)).toEqual(["id", "name", "code", "location_json", "updated_at"]);
  check.close();
}

describe("Store", () => {
  it("creates the schema on an empty file and is a no-op on a current one", () => {
    const dir = mkdtempSync(join(tmpdir(), "visnarn-store-"));
    folders.push(dir);
    const file = join(dir, "visnarn.db");
    const first = openStore(file);
    first.shops.save(shop());
    first.close();
    // Company data: readable by this user only.
    expect(statSync(file).mode & 0o777).toBe(0o600);

    const again = openStore(file);
    open.push(again);
    expect(again.shops.all()).toEqual([shop()]);
    again.close();
    expectCurrentSchema(file);
  });

  it("round-trips a shop and a saved route", () => {
    const store = memory();
    store.shops.save(shop());
    store.shops.save(shop({ id: "s2" as ShopId, name: "Kansas City, MO", code: null, location: { fraId: 358070 as FraId, railroad: "UP" } }));
    expect(store.shops.get("s1" as ShopId)).toEqual(shop());
    const wired = shop({ links: [628925 as FraId, 628886 as FraId] });
    store.shops.save(wired);
    expect(store.shops.get("s1" as ShopId)).toEqual(wired);
    store.shops.save(shop({ links: [628886 as FraId] }));
    expect(store.shops.get("s1" as ShopId)?.links).toEqual([628886]);
    store.shops.save(shop());
    expect(store.shops.all().map((s) => s.name)).toEqual(["Kansas City, MO", "North Little Rock, AR"]);
    expect(store.shops.named("ex-nlr-01")).toEqual([shop()]);
    expect(store.shops.named("  kansas city, mo ")).toHaveLength(1);

    const turning = route("r1", "KC → Chicago", { option: "shortest" });
    turning.plan.turnAtStops = true;
    store.savedRoutes.save(turning);
    expect(store.savedRoutes.get("r1" as SavedRouteId)).toEqual(turning);
    expect(store.savedRoutes.get("nope" as SavedRouteId)).toBeNull();
  });

  it("lists saved routes by name ignoring case, ties in the order saved; saving again keeps a route's place", () => {
    const store = memory();
    store.savedRoutes.save(route("r1", "taylor → NLR"));
    store.savedRoutes.save(route("r2", "KC → Chicago"));
    store.savedRoutes.save(route("r3", "kc → chicago"));
    expect(store.savedRoutes.all().map((r) => r.id)).toEqual(["r2", "r3", "r1"]);
    const before = store.revision;
    store.savedRoutes.save(route("r2", "KC → Chicago", { option: "fewest-interchanges" }));
    expect(store.revision).toBe(before + 1);
    expect(store.savedRoutes.all().map((r) => [r.id, r.option])).toEqual([
      ["r2", "fewest-interchanges"],
      ["r3", null],
      ["r1", null],
    ]);
    expect(store.savedRoutes.remove("r3" as SavedRouteId)).toBe(true);
    expect(store.savedRoutes.all().map((r) => r.id)).toEqual(["r2", "r1"]);
  });

  it("opens a schema 1 file: adds the saved routes table, keeps the shops and drops the old car tables", () => {
    const file = olderFile(1, (raw) => raw.exec("DROP TABLE saved_routes;"));
    const migrated = openStore(file);
    open.push(migrated);
    expect(migrated.shops.all()).toEqual([shop()]);
    migrated.savedRoutes.save(route("r1", "KC → Chicago"));
    expect(migrated.savedRoutes.all()).toHaveLength(1);
    expectCurrentSchema(file);
  });

  it("opens a schema 3 file: drops the old car tables in one step, shops and saved routes stay", () => {
    const file = olderFile(3, (raw) =>
      raw.exec(`INSERT INTO saved_routes (id, name, plan_json, option, route_string) VALUES ('r1', 'KC → Chicago', '${JSON.stringify(route("r1", "x").plan)}', NULL, 'BNSF-[Temple, TX]-UP');`),
    );
    const migrated = openStore(file);
    open.push(migrated);
    expect(migrated.shops.all()).toEqual([shop()]);
    expect(migrated.savedRoutes.all()).toEqual([route("r1", "KC → Chicago")]);
    expectCurrentSchema(file);
    // A second start finds nothing left to do.
    migrated.close();
    const again = openStore(file);
    open.push(again);
    expect(again.savedRoutes.all()).toHaveLength(1);
  });

  it("opens a schema 2 file: a route saved before route strings, the places list, track choice and turning at stops reads in today's shape", () => {
    const { places } = route("r1", "x").plan;
    const file = olderFile(2, (raw) =>
      raw.exec(`ALTER TABLE saved_routes DROP COLUMN route_string;
        INSERT INTO saved_routes (id, name, plan_json, option) VALUES ('r1', 'KC → Chicago', '${JSON.stringify({ start: places[0], stops: [places[1]], destination: places[2] })}', NULL);`),
    );
    const migrated = openStore(file);
    open.push(migrated);
    expect(migrated.savedRoutes.get("r1" as SavedRouteId)).toEqual(route("r1", "KC → Chicago", { routeString: "" }));
  });

  it("opens a schema 4 file: drops the EXAMPLE flag, shops and saved routes stay", () => {
    const file = olderFile(4, (raw) =>
      raw.exec(`INSERT INTO saved_routes (id, name, plan_json, option, route_string) VALUES ('r1', 'KC → Chicago', '${JSON.stringify(route("r1", "x").plan)}', NULL, 'BNSF-[Temple, TX]-UP');`),
    );
    const migrated = openStore(file);
    open.push(migrated);
    expect(migrated.shops.all()).toEqual([shop()]);
    expect(migrated.savedRoutes.all()).toEqual([route("r1", "KC → Chicago")]);
    expectCurrentSchema(file);
  });

  it("opens a schema 5 file: adds shop_link, and every shop has no links", () => {
    const file = olderFile(5, () => {});
    const migrated = openStore(file);
    open.push(migrated);
    expect(migrated.shops.all()).toEqual([shop()]);
    expectCurrentSchema(file);
  });

  it("opens a schema 6 file with the route_answers experiment: drops it, adds shop_link, shops stay", () => {
    const file = olderFile(6, (raw) =>
      raw.exec(`CREATE TABLE route_answers (key TEXT PRIMARY KEY, network_version TEXT NOT NULL, answer_json TEXT NOT NULL,
          bytes INTEGER NOT NULL, hits INTEGER NOT NULL DEFAULT 0, used_at INTEGER NOT NULL);
        CREATE INDEX route_answers_by_use ON route_answers (used_at);
        INSERT INTO route_answers VALUES ('k', 'v', '{}', 2, 0, 0);`),
    );
    const migrated = openStore(file);
    open.push(migrated);
    expect(migrated.shops.all()).toEqual([shop()]);
    expectCurrentSchema(file);
  });

  it("opens a schema 6 file with the links_json experiment: moves each shop's links into shop_link in order", () => {
    const file = olderFile(6, (raw) =>
      raw.exec(`ALTER TABLE shops ADD COLUMN links_json TEXT NOT NULL DEFAULT '[]';
        UPDATE shops SET links_json = '[628925,628886]';
        INSERT INTO shops (id, name, code, location_json, updated_at) VALUES ('s2', 'Kansas City, MO', NULL, '{"lon":-94.6,"lat":39.1}', 't');`),
    );
    const migrated = openStore(file);
    open.push(migrated);
    expect(migrated.shops.all()).toEqual([
      shop({ id: "s2" as ShopId, name: "Kansas City, MO", code: null, location: { lon: -94.6, lat: 39.1 } }),
      shop({ links: [628925 as FraId, 628886 as FraId] }),
    ]);
    expectCurrentSchema(file);
  });

  it("revision goes up on every write and on no read", () => {
    const store = memory();
    const steps: [string, () => unknown][] = [
      // A shop with links: removing it removes its links too.
      ["save shop", () => store.shops.save(shop({ links: [628925 as FraId] }))],
      ["save route", () => store.savedRoutes.save(route("r1", "KC → Chicago"))],
      ["remove route", () => store.savedRoutes.remove("r1" as SavedRouteId)],
      ["remove shop", () => store.shops.remove("s1" as ShopId)],
    ];
    for (const [name, write] of steps) {
      const before = store.revision;
      write();
      expect(store.revision, name).toBe(before + 1);
    }
    const before = store.revision;
    store.shops.all();
    store.shops.named("x");
    store.savedRoutes.all();
    store.savedRoutes.get("r1" as SavedRouteId);
    expect(store.revision).toBe(before);
    // Removing what is not there writes nothing.
    expect(store.shops.remove("s1" as ShopId)).toBe(false);
    expect(store.savedRoutes.remove("r1" as SavedRouteId)).toBe(false);
    expect(store.revision).toBe(before);
  });

  it("shops.save rejects a code another shop has (conflict)", () => {
    const store = memory();
    store.shops.save(shop());
    const refusal = (() => {
      try {
        store.shops.save(shop({ id: "s2" as ShopId, name: "Another", code: "ex-nlr-01" }));
      } catch (error) {
        return error;
      }
    })();
    expect(refusal).toBeInstanceOf(AppError);
    expect(refusal).toMatchObject({ kind: "conflict", field: "code", message: expect.stringMatching(/North Little Rock, AR.*EX-NLR-01|ex-nlr-01/) });
    expect(store.shops.all()).toHaveLength(1);
    // The shop keeps its own code when it is saved again; two shops may both have none.
    store.shops.save(shop({ name: "Renamed" }));
    store.shops.save(shop({ id: "s3" as ShopId, code: null }));
    store.shops.save(shop({ id: "s4" as ShopId, code: null }));
    expect(store.shops.all()).toHaveLength(3);
  });

  it("no stored value contains a graph index: places are FRA ids, coordinates or user names", () => {
    const store = memory();
    store.shops.save(shop());
    store.shops.save(shop({ id: "s2" as ShopId, code: "X", location: { fraId: 358070 as FraId, railroad: null } }));
    store.savedRoutes.save(route("r1", "KC → Chicago"));
    const stored = JSON.stringify([store.shops.all(), store.savedRoutes.all()]);
    const keys = new Set([...stored.matchAll(/"(\w+)":/g)].map((m) => m[1]));
    for (const key of keys) expect(["node", "index", "edge", "nodes"], key).not.toContain(key);
    expect(stored).toContain('"fraId":358070');
  });
});
