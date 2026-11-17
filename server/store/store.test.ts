/** The Store against a ":memory:" database. Domain values in, the same values out. */
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AppError } from "../../shared/app.ts";
import { DEFAULT_ASSUMPTIONS } from "../../shared/assumptions.ts";
import type { FraId, NodeCode, Shop, ShopId } from "../../shared/places.ts";
import type { SavedRoute, SavedRouteId } from "../../shared/plans.ts";
import type { Instant } from "../../shared/time.ts";
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

const T = "2026-11-17T12:00:00.000Z" as Instant;
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
  plan: { start: { kind: "text", text: "Kansas City, MO" }, stops: [{ kind: "node", fraId: 358070 as FraId, railroad: "BNSF" }], destination: { kind: "shop", shopId: "s1" as ShopId } },
  option: null,
  ...over,
});
const code = (c: string, over: Partial<NodeCode> = {}): NodeCode => ({ codeType: "splc", code: c, name: null, location: { fraId: 358070 as FraId, railroad: null }, ...over });

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

  it("round-trips a shop, a code set, a saved route, the assumptions", () => {
    const store = memory();
    store.shops.save(shop());
    store.shops.save(shop({ id: "s2" as ShopId, name: "Kansas City, MO", code: null, location: { fraId: 358070 as FraId, railroad: "UP" }, example: false }));
    expect(store.shops.get("s1" as ShopId)).toEqual(shop());
    expect(store.shops.all().map((s) => s.name)).toEqual(["Kansas City, MO", "North Little Rock, AR"]);
    expect(store.shops.named("ex-nlr-01")).toEqual([shop()]);
    expect(store.shops.named("  kansas city, mo ")).toHaveLength(1);

    store.codes.replaceSet({ codeType: "splc", label: "SPLC" }, [code("668240", { name: "Temple" }), code("668241", { location: { lon: -97.3, lat: 31.1 } })], T);
    expect(store.codes.sets()).toEqual([{ codeType: "splc", label: "SPLC", count: 2, importedAt: T }]);
    expect(store.codes.find("668240", "splc")).toEqual([code("668240", { name: "Temple" })]);
    expect(store.codes.find("668240", "fsac")).toEqual([]);
    expect(store.codes.search("tem", 5).map((c) => c.code)).toEqual(["668240"]);
    expect(store.codes.search("66824", 1)).toHaveLength(1);

    store.savedRoutes.save(route("r1", "KC → Chicago", { option: "shortest" }));
    expect(store.savedRoutes.get("r1" as SavedRouteId)).toEqual(route("r1", "KC → Chicago", { option: "shortest" }));
    expect(store.savedRoutes.get("nope" as SavedRouteId)).toBeNull();

    const mine = { ...DEFAULT_ASSUMPTIONS, timing: { ...DEFAULT_ASSUMPTIONS.timing, speedKmPerDay: 550 } };
    expect(store.settings.assumptions()).toEqual(DEFAULT_ASSUMPTIONS);
    store.settings.saveAssumptions(mine);
    expect(store.settings.assumptions()).toEqual(mine);
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
    expect(check.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get()).toEqual({ value: "2" });
    expect(check.prepare("SELECT id FROM batches").all()).toEqual([{ id: "b1" }]);
    expect(check.prepare("SELECT key FROM settings WHERE key = 'import_profile'").get()).toEqual({ key: "import_profile" });
    check.close();
  });

  it("revision goes up on every write and on no read", () => {
    const store = memory();
    const steps: [string, () => unknown][] = [
      ["save shop", () => store.shops.save(shop())],
      ["save code set", () => store.codes.replaceSet({ codeType: "splc", label: "SPLC" }, [code("1")], T)],
      ["save route", () => store.savedRoutes.save(route("r1", "KC → Chicago"))],
      ["save assumptions", () => store.settings.saveAssumptions(DEFAULT_ASSUMPTIONS)],
      ["remove code set", () => store.codes.removeSet("splc")],
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
    store.codes.sets();
    store.codes.search("1", 5);
    store.savedRoutes.all();
    store.savedRoutes.get("r1" as SavedRouteId);
    store.settings.assumptions();
    expect(store.revision).toBe(before);
    // Removing what is not there writes nothing.
    expect(store.shops.remove("s1" as ShopId)).toBe(false);
    expect(store.savedRoutes.remove("r1" as SavedRouteId)).toBe(false);
    expect(store.codes.removeSet("splc")).toBe(false);
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

  it("codes.replaceSet twice with the same rows leaves one copy", () => {
    const store = memory();
    const rows = [code("668240"), code("668241")];
    store.codes.replaceSet({ codeType: "splc", label: "SPLC" }, rows, T);
    store.codes.replaceSet({ codeType: "splc", label: "SPLC codes" }, rows, T);
    expect(store.codes.sets()).toEqual([{ codeType: "splc", label: "SPLC codes", count: 2, importedAt: T }]);
    expect(store.codes.find("668240", null)).toHaveLength(1);
    // Another set may hold the same code: that is what makes text ambiguous.
    store.codes.replaceSet({ codeType: "fsac", label: "FSAC" }, [code("668240", { codeType: "fsac" })], T);
    expect(store.codes.find("668240", null).map((c) => c.codeType)).toEqual(["fsac", "splc"]);
    expect(store.codes.removeSet("splc")).toBe(true);
    expect(store.codes.find("668240", null).map((c) => c.codeType)).toEqual(["fsac"]);
  });

  it("finds a code with % or _ in it as written, not as a pattern", () => {
    const store = memory();
    store.codes.replaceSet({ codeType: "yard", label: "Yard" }, [code("A_1"), code("AB1"), code("50%")], T);
    expect(store.codes.search("A_", 10).map((c) => c.code)).toEqual(["A_1"]);
    expect(store.codes.search("50%", 10).map((c) => c.code)).toEqual(["50%"]);
  });

  it("no stored value contains a graph index: places are FRA ids, coordinates or user names", () => {
    const store = memory();
    store.shops.save(shop());
    store.shops.save(shop({ id: "s2" as ShopId, code: "X", location: { fraId: 358070 as FraId, railroad: null } }));
    store.codes.replaceSet({ codeType: "splc", label: "SPLC" }, [code("1")], T);
    store.savedRoutes.save(route("r1", "KC → Chicago"));
    const stored = JSON.stringify([store.shops.all(), store.codes.find("1", null), store.savedRoutes.all()]);
    const keys = new Set([...stored.matchAll(/"(\w+)":/g)].map((m) => m[1]));
    for (const key of keys) expect(["node", "index", "edge", "nodes"], key).not.toContain(key);
    expect(stored).toContain('"fraId":358070');
  });
});
