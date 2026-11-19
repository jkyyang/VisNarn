/** The Store on PGlite (in memory, or in a folder). Domain values in, the same values out. */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AppError } from "../../shared/app.ts";
import type { FraId, Shop, ShopId } from "../../shared/places.ts";
import type { SavedRoute, SavedRouteId } from "../../shared/plans.ts";
import { DEFAULT_INCLUDE } from "../../shared/railroads.ts";
import { importSqlite } from "./import-sqlite.ts";
import { openStore } from "./postgres.ts";
import type { Store } from "./store.ts";

const open: Store[] = [];
const folders: string[] = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map((s) => s.close()));
  folders.splice(0).forEach((f) => rmSync(f, { recursive: true, force: true }));
});
const opened = async (database: string) => {
  const store = await openStore(database);
  open.push(store);
  return store;
};
const memory = () => opened("memory://");
const folder = () => {
  const dir = mkdtempSync(join(tmpdir(), "visnarn-store-"));
  folders.push(dir);
  return dir;
};

/** Ids are UUIDs: the n-th of each kind. */
const shopId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}` as ShopId;
const routeId = (n: number) => `00000000-0000-4000-9000-${String(n).padStart(12, "0")}` as SavedRouteId;

const shop = (over: Partial<Shop> = {}): Shop => ({
  id: shopId(1),
  name: "North Little Rock, AR",
  code: "EX-NLR-01",
  location: { lon: -92.27, lat: 34.77 },
  links: [],
  ...over,
});
const route = (n: number, name: string, over: Partial<SavedRoute> = {}): SavedRoute => ({
  id: routeId(n),
  name,
  plan: {
    places: [{ kind: "text", text: "Kansas City, MO" }, { kind: "node", fraId: 358070 as FraId, railroad: "BNSF" }, { kind: "coord", lon: -97.1, lat: 31.5 }, { kind: "shop", shopId: shopId(1) }],
    include: DEFAULT_INCLUDE,
    turnAtStops: false,
  },
  option: null,
  routeString: "BNSF-[Temple, TX]-UP",
  ...over,
});

const refusal = async (run: () => Promise<unknown>) => {
  try {
    await run();
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  return null;
};

describe("Store", () => {
  it("creates the schema in an empty folder, and finds it there on the next start", async () => {
    const dir = folder();
    const first = await openStore(dir);
    await first.shops.save(shop());
    await first.close();
    const again = await opened(dir);
    expect(await again.shops.all()).toEqual([shop()]);
  });

  it("round-trips a shop and a saved route: every kind of place, the track included and turning at stops", async () => {
    const store = await memory();
    await store.shops.save(shop());
    await store.shops.save(shop({ id: shopId(2), name: "Kansas City, MO", code: null, location: { fraId: 358070 as FraId, railroad: "UP" } }));
    expect(await store.shops.get(shopId(1))).toEqual(shop());
    const wired = shop({ links: [628925 as FraId, 628886 as FraId] });
    await store.shops.save(wired);
    expect(await store.shops.get(shopId(1))).toEqual(wired);
    await store.shops.save(shop({ links: [628886 as FraId] }));
    expect((await store.shops.get(shopId(1)))?.links).toEqual([628886]);
    await store.shops.save(shop());
    expect((await store.shops.all()).map((s) => s.name)).toEqual(["Kansas City, MO", "North Little Rock, AR"]);
    expect(await store.shops.named("ex-nlr-01")).toEqual([shop()]);
    expect(await store.shops.named("  kansas city, mo ")).toHaveLength(1);

    const turning = route(1, "KC → Chicago", { option: "shortest" });
    turning.plan.turnAtStops = true;
    turning.plan.include = { regional: true, shortLine: true, passenger: false };
    await store.savedRoutes.save(turning);
    expect(await store.savedRoutes.get(routeId(1))).toEqual(turning);
    expect(await store.savedRoutes.get(routeId(9))).toBeNull();
    expect(await store.savedRoutes.get("nope" as SavedRouteId)).toBeNull();
  });

  it("lists saved routes by name ignoring case, ties in the order saved; saving again keeps a route's place", async () => {
    const store = await memory();
    await store.shops.save(shop());
    await store.savedRoutes.save(route(1, "taylor → NLR"));
    await store.savedRoutes.save(route(2, "KC → Chicago"));
    await store.savedRoutes.save(route(3, "kc → chicago"));
    expect((await store.savedRoutes.all()).map((r) => r.id)).toEqual([routeId(2), routeId(3), routeId(1)]);
    await store.savedRoutes.save(route(2, "KC → Chicago", { option: "fewest-interchanges" }));
    expect((await store.savedRoutes.all()).map((r) => [r.id, r.option])).toEqual([
      [routeId(2), "fewest-interchanges"],
      [routeId(3), null],
      [routeId(1), null],
    ]);
    expect(await store.savedRoutes.remove(routeId(3))).toBe(true);
    expect(await store.savedRoutes.remove(routeId(3))).toBe(false);
    expect((await store.savedRoutes.all()).map((r) => r.id)).toEqual([routeId(2), routeId(1)]);
  });

  it("a deleted shop is gone from every list and frees its code, while a saved route that names it keeps it", async () => {
    const store = await memory();
    await store.shops.save(shop({ links: [628925 as FraId] }));
    await store.savedRoutes.save(route(1, "KC → NLR"));
    expect(await store.shops.remove(shopId(1))).toBe(true);
    expect(await store.shops.remove(shopId(1))).toBe(false);
    expect(await store.shops.get(shopId(1))).toBeNull();
    expect(await store.shops.all()).toEqual([]);
    expect(await store.shops.named("EX-NLR-01")).toEqual([]);
    await store.shops.save(shop({ id: shopId(2) }));
    expect((await store.savedRoutes.get(routeId(1)))?.plan.places[3]).toEqual({ kind: "shop", shopId: shopId(1) });
    // Saved again, unchanged: the deleted shop still reads as a place, and resolves as deleted.
    await store.savedRoutes.save(route(1, "KC → NLR"));
  });

  it("refuses a saved route naming a shop that never existed, and a code another shop has", async () => {
    const store = await memory();
    expect(await refusal(() => store.savedRoutes.save(route(1, "KC → NLR")))).toMatchObject({ kind: "invalid", field: "plan" });
    const bad = route(2, "KC → nowhere");
    bad.plan.places[3] = { kind: "shop", shopId: "s1" as ShopId };
    expect(await refusal(() => store.savedRoutes.save(bad))).toMatchObject({ kind: "invalid", field: "plan" });
    expect(await store.savedRoutes.all()).toEqual([]);

    await store.shops.save(shop());
    expect(await refusal(() => store.shops.save(shop({ id: shopId(2), name: "Another", code: "ex-nlr-01" })))).toMatchObject({
      kind: "conflict",
      field: "code",
      message: expect.stringMatching(/North Little Rock, AR.*ex-nlr-01/),
    });
    expect(await store.shops.all()).toHaveLength(1);
    // The shop keeps its own code when it is saved again; two shops may both have none.
    await store.shops.save(shop({ name: "Renamed" }));
    await store.shops.save(shop({ id: shopId(3), code: null }));
    await store.shops.save(shop({ id: shopId(4), code: null }));
    expect(await store.shops.all()).toHaveLength(3);
  });

  it("refuses a database a newer copy of the app wrote", async () => {
    const dir = folder();
    const { PGlite } = await import("@electric-sql/pglite");
    const raw = await PGlite.create(dir);
    await raw.exec("CREATE SCHEMA ops; CREATE TABLE ops.schema_migration (version integer PRIMARY KEY); INSERT INTO ops.schema_migration VALUES (99);");
    await raw.close();
    await expect(openStore(dir)).rejects.toThrow(/newer version.*schema 99/);
  });

  it("no stored value contains a graph index: places are FRA ids, coordinates or user names", async () => {
    const store = await memory();
    await store.shops.save(shop());
    await store.shops.save(shop({ id: shopId(2), code: "X", location: { fraId: 358070 as FraId, railroad: null } }));
    await store.savedRoutes.save(route(1, "KC → Chicago"));
    const stored = JSON.stringify([await store.shops.all(), await store.savedRoutes.all()]);
    const keys = new Set([...stored.matchAll(/"(\w+)":/g)].map((m) => m[1]));
    for (const key of keys) expect(["node", "index", "edge", "nodes"], key).not.toContain(key);
    expect(stored).toContain('"fraId":358070');
  });
});

describe("importSqlite", () => {
  /** A visnarn.db as the SQLite store left it at schema 7. */
  function sqliteFile(): string {
    const file = join(folder(), "visnarn.db");
    const { DatabaseSync } = process.getBuiltinModule("node:sqlite");
    const db = new DatabaseSync(file);
    const saved = route(1, "KC → NLR", { option: "shortest" });
    db.exec(`PRAGMA journal_mode = WAL;
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO meta VALUES ('schema_version', '7');
      CREATE TABLE shops (id TEXT PRIMARY KEY, name TEXT NOT NULL, code TEXT UNIQUE COLLATE NOCASE, location_json TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE shop_link (shop_id TEXT NOT NULL REFERENCES shops (id) ON DELETE CASCADE, link_no INTEGER NOT NULL, join_fra_node_id INTEGER NOT NULL, PRIMARY KEY (shop_id, link_no));
      CREATE TABLE saved_routes (id TEXT PRIMARY KEY, name TEXT NOT NULL, plan_json TEXT NOT NULL, option TEXT, route_string TEXT NOT NULL DEFAULT '');
      INSERT INTO shops VALUES ('${shopId(1)}', 'North Little Rock, AR', 'EX-NLR-01', '{"lon":-92.27,"lat":34.77}', 't');
      INSERT INTO shops VALUES ('${shopId(2)}', 'Kansas City, MO', NULL, '{"fraId":358070,"railroad":null}', 't');
      INSERT INTO shop_link VALUES ('${shopId(1)}', 2, 628886), ('${shopId(1)}', 1, 628925);
      INSERT INTO saved_routes VALUES ('${saved.id}', '${saved.name}', '${JSON.stringify(saved.plan)}', 'shortest', '${saved.routeString}');`);
    db.close();
    return file;
  }

  it("moves the shops, their links in order and the saved routes, and leaves the file as it was", async () => {
    const file = sqliteFile();
    const before = readFileSync(file);
    const store = await memory();
    expect(await importSqlite(file, store)).toEqual({ shops: 2, routes: 1 });
    expect(await store.shops.all()).toEqual([
      shop({ id: shopId(2), name: "Kansas City, MO", code: null, location: { fraId: 358070 as FraId, railroad: null } }),
      shop({ links: [628925 as FraId, 628886 as FraId] }),
    ]);
    expect(await store.savedRoutes.all()).toEqual([route(1, "KC → NLR", { option: "shortest" })]);
    expect(readFileSync(file).equals(before)).toBe(true);
  });
});
