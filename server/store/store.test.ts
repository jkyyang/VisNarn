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
  example: true,
  ...over,
});
const route = (id: string, name: string, over: Partial<SavedRoute> = {}): SavedRoute => ({
  id: id as SavedRouteId,
  name,
  plan: { start: { kind: "text", text: "Kansas City, MO" }, stops: [{ kind: "node", fraId: 358070 as FraId, railroad: "BNSF" }], destination: { kind: "shop", shopId: "s1" as ShopId }, include: DEFAULT_INCLUDE },
  option: null,
  routeString: "BNSF-[Temple, TX]-UP",
  ...over,
});

describe("Store", () => {
  it("creates the schema on an empty file and is a no-op on a current one", () => {
    const dir = mkdtempSync(join(tmpdir(), "visnarn-store-"));
    folders.push(dir);
    const file = join(dir, "visnarn.db");
    const first = openStore(file);
    expect(first.fresh).toBe(true);
    first.shops.save(shop());
    first.close();
    // Company data: readable by this user only.
    expect(statSync(file).mode & 0o777).toBe(0o600);

    const again = openStore(file);
    open.push(again);
    expect(again.fresh).toBe(false);
    expect(again.shops.all()).toEqual([shop()]);
  });

  it("round-trips a shop and a saved route", () => {
    const store = memory();
    store.shops.save(shop());
    store.shops.save(shop({ id: "s2" as ShopId, name: "Kansas City, MO", code: null, location: { fraId: 358070 as FraId, railroad: "UP" }, example: false }));
    expect(store.shops.get("s1" as ShopId)).toEqual(shop());
    expect(store.shops.all().map((s) => s.name)).toEqual(["Kansas City, MO", "North Little Rock, AR"]);
    expect(store.shops.named("ex-nlr-01")).toEqual([shop()]);
    expect(store.shops.named("  kansas city, mo ")).toHaveLength(1);

    store.savedRoutes.save(route("r1", "KC → Chicago", { option: "shortest" }));
    expect(store.savedRoutes.get("r1" as SavedRouteId)).toEqual(route("r1", "KC → Chicago", { option: "shortest" }));
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

  it("opens a schema 1 file: adds the saved routes table, keeps the shops and leaves the old car tables as they were", () => {
    const dir = mkdtempSync(join(tmpdir(), "visnarn-store-"));
    folders.push(dir);
    const file = join(dir, "visnarn.db");
    const current = openStore(file);
    current.shops.save(shop());
    current.close();
    // Back to schema 1 as an older copy of the app wrote it, with a batch in its car tables.
    const { DatabaseSync } = process.getBuiltinModule("node:sqlite");
    const raw = new DatabaseSync(file);
    raw.exec(`DROP TABLE saved_routes;
      UPDATE meta SET value = '1' WHERE key = 'schema_version';
      INSERT INTO batches (id, name, as_of, created_at, source_json, issues_json, example, content_hash) VALUES ('b1', 'EXAMPLE', 't', 't', '{}', '[]', 1, 'h1');
      INSERT INTO settings (key, json) VALUES ('import_profile', '{}');`);
    raw.close();

    const migrated = openStore(file);
    open.push(migrated);
    expect(migrated.shops.all()).toEqual([shop()]);
    migrated.savedRoutes.save(route("r1", "KC → Chicago"));
    expect(migrated.savedRoutes.all()).toHaveLength(1);
    const check = new DatabaseSync(file);
    expect(check.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get()).toEqual({ value: "3" });
    expect(check.prepare("SELECT id FROM batches").all()).toEqual([{ id: "b1" }]);
    expect(check.prepare("SELECT key FROM settings WHERE key = 'import_profile'").get()).toEqual({ key: "import_profile" });
    check.close();
  });

  it("opens a schema 2 file: a route saved before route strings reads with an empty one", () => {
    const dir = mkdtempSync(join(tmpdir(), "visnarn-store-"));
    folders.push(dir);
    const file = join(dir, "visnarn.db");
    openStore(file).close();
    const { DatabaseSync } = process.getBuiltinModule("node:sqlite");
    const raw = new DatabaseSync(file);
    raw.exec(`ALTER TABLE saved_routes DROP COLUMN route_string;
      UPDATE meta SET value = '2' WHERE key = 'schema_version';
      INSERT INTO saved_routes (id, name, plan_json, option) VALUES ('r1', 'KC → Chicago', '${JSON.stringify(route("r1", "x").plan)}', NULL);`);
    raw.close();

    const migrated = openStore(file);
    open.push(migrated);
    expect(migrated.savedRoutes.get("r1" as SavedRouteId)).toEqual(route("r1", "KC → Chicago", { routeString: "" }));
  });

  it("revision goes up on every write and on no read", () => {
    const store = memory();
    const steps: [string, () => unknown][] = [
      ["save shop", () => store.shops.save(shop())],
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
