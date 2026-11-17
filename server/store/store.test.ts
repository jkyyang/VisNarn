/** The Store against a ":memory:" database. Domain values in, the same values out. */
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AppError } from "../../shared/app.ts";
import { DEFAULT_ASSUMPTIONS } from "../../shared/assumptions.ts";
import type { Batch, BatchId, CarReport, StopRef } from "../../shared/cars.ts";
import type { FraId, NodeCode, Shop, ShopId } from "../../shared/places.ts";
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
const report = (carId: string): CarReport => ({
  carId,
  a: { kind: "text", text: "Taylor, TX" },
  b: { kind: "code", codeType: "splc", code: "668240" },
  shop: { kind: "text", text: "EX-NLR-01" },
  stops: [],
  reportedAt: T,
  prepEnd: null,
});
const batch = (id: string, over: Partial<Batch> = {}): Batch => ({
  id: id as BatchId,
  name: `EXAMPLE ${id}`,
  asOf: T,
  createdAt: T,
  source: { kind: "csv", label: `${id}.csv` },
  rows: 0,
  issues: [{ row: 1, line: 3, field: "prepEnd", message: "The prep end time is empty." }],
  example: false,
  ...over,
});
const stop = (fraId: number): StopRef => ({ place: { kind: "node", fraId: fraId as FraId, railroad: "BNSF" }, note: null });
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
    // Car data: readable by this user only.
    expect(statSync(file).mode & 0o777).toBe(0o600);

    const again = openStore(file);
    open.push(again);
    expect(again.fresh).toBe(false);
    expect(again.shops.all()).toEqual([shop()]);
  });

  it("round-trips a shop, a code set, a batch with rows, a fix, the assumptions", () => {
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

    const reports = [report("EXAMPLE 1"), { ...report("EXAMPLE 2"), stops: [stop(1)] }];
    const created = store.batches.create(batch("b1"), reports, "hash-1");
    expect(created.rows).toBe(2);
    expect(store.batches.get("b1" as BatchId)).toEqual({ ...batch("b1"), rows: 2 });
    // Fixes are kept apart: a row comes back as imported.
    expect(store.batches.reports("b1" as BatchId)).toEqual([report("EXAMPLE 1"), report("EXAMPLE 2")]);

    const fix = store.fixes.save("b1" as BatchId, 1, [stop(358070)], T);
    expect(fix).toEqual({ stops: [stop(358070)], savedAt: T });
    expect(store.fixes.current("b1" as BatchId)).toEqual(new Map([[1, fix]]));

    const mine = { ...DEFAULT_ASSUMPTIONS, timing: { ...DEFAULT_ASSUMPTIONS.timing, speedKmPerDay: 550 } };
    expect(store.settings.assumptions()).toEqual(DEFAULT_ASSUMPTIONS);
    store.settings.saveAssumptions(mine);
    expect(store.settings.assumptions()).toEqual(mine);
    const profile = { ...store.settings.importProfile(), positions: { codeType: "splc" } };
    store.settings.saveImportProfile(profile);
    expect(store.settings.importProfile()).toEqual(profile);
  });

  it("starts from the old fixed columns, positions as text, and zone-less times in this laptop's zone", () => {
    expect(memory().settings.importProfile()).toEqual({
      columns: { carId: "car_id", a: "last_node", b: "next_node", shop: "shop", reportedAt: "reported_at", prepEnd: "prep_end" },
      positions: "text",
      zonelessTimes: { zone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    });
  });

  it("revision goes up on every write and on no read", () => {
    const store = memory();
    const steps: [string, () => unknown][] = [
      ["save shop", () => store.shops.save(shop())],
      ["save code set", () => store.codes.replaceSet({ codeType: "splc", label: "SPLC" }, [code("1")], T)],
      ["create batch", () => store.batches.create(batch("b1"), [report("1")], "h1")],
      ["save fix", () => store.fixes.save("b1" as BatchId, 0, [stop(1)], T)],
      ["revert fix", () => store.fixes.revert("b1" as BatchId, 0, T)],
      ["save assumptions", () => store.settings.saveAssumptions(DEFAULT_ASSUMPTIONS)],
      ["save profile", () => store.settings.saveImportProfile(store.settings.importProfile())],
      ["remove code set", () => store.codes.removeSet("splc")],
      ["remove batch", () => store.batches.remove("b1" as BatchId)],
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
    store.batches.all();
    store.fixes.current("b1" as BatchId);
    store.settings.assumptions();
    store.settings.importProfile();
    expect(store.revision).toBe(before);
    // Removing what is not there writes nothing.
    expect(store.shops.remove("s1" as ShopId)).toBe(false);
    expect(store.batches.remove("b1" as BatchId)).toBe(false);
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

  it("batches.create with a known content hash writes nothing and returns the first batch", () => {
    const store = memory();
    const first = store.batches.create(batch("b1"), [report("1")], "same");
    const revision = store.revision;
    const again = store.batches.create(batch("b2", { name: "Other name" }), [report("1"), report("2")], "same");
    expect(again).toEqual(first);
    expect(store.revision).toBe(revision);
    expect(store.batches.all().map((b) => b.id)).toEqual(["b1"]);
  });

  it("lists batches newest first", () => {
    const store = memory();
    store.batches.create(batch("old", { createdAt: "2026-11-16T12:00:00.000Z" as Instant }), [report("1")], "h1");
    store.batches.create(batch("new", { createdAt: "2026-11-17T12:00:00.000Z" as Instant }), [report("1")], "h2");
    expect(store.batches.all().map((b) => b.id)).toEqual(["new", "old"]);
  });

  it("batches.remove takes the rows and fixes with it", () => {
    const store = memory();
    store.batches.create(batch("b1"), [report("1"), report("2")], "h1");
    store.fixes.save("b1" as BatchId, 0, [stop(1)], T);
    expect(store.batches.remove("b1" as BatchId)).toBe(true);
    expect(store.batches.get("b1" as BatchId)).toBeNull();
    expect(store.batches.reports("b1" as BatchId)).toEqual([]);
    expect(store.fixes.current("b1" as BatchId).size).toBe(0);
    // The same content may be uploaded again once its batch is gone.
    expect(store.batches.create(batch("b2"), [report("1")], "h1").id).toBe("b2");
  });

  it("fixes.save with the stops already in force appends nothing; revert keeps the row and ends it", () => {
    const store = memory();
    store.batches.create(batch("b1"), [report("1"), report("2")], "h1");
    const id = "b1" as BatchId;
    const first = store.fixes.save(id, 0, [stop(1), stop(2)], T);
    const revision = store.revision;
    const later = "2026-11-17T13:00:00.000Z" as Instant;
    // Same stops, keys in another order: still the same fix.
    const same = store.fixes.save(id, 0, [{ note: null, place: { railroad: "BNSF", fraId: 1 as FraId, kind: "node" } }, stop(2)], later);
    expect(same).toEqual(first);
    expect(store.revision).toBe(revision);

    const second = store.fixes.save(id, 0, [stop(3)], later);
    expect(store.fixes.current(id).get(0)).toEqual(second);
    store.fixes.revert(id, 0, later);
    expect(store.fixes.current(id).has(0)).toBe(false);
    // Reverting ends the fix in force: the one before it does not come back.
    store.fixes.revert(id, 0, later);
    expect(store.fixes.current(id).has(0)).toBe(false);
    // Saving the first stops again appends a new revision.
    expect(store.fixes.save(id, 0, [stop(1), stop(2)], later)).toEqual({ stops: [stop(1), stop(2)], savedAt: later });
    expect(store.fixes.current(id).get(0)?.savedAt).toBe(later);
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
    store.batches.create(batch("b1"), [report("1")], "h1");
    store.fixes.save("b1" as BatchId, 0, [stop(358070)], T);
    const stored = JSON.stringify([store.shops.all(), store.codes.find("1", null), store.batches.reports("b1" as BatchId), [...store.fixes.current("b1" as BatchId).values()]]);
    const keys = new Set([...stored.matchAll(/"(\w+)":/g)].map((m) => m[1]));
    for (const key of keys) expect(["node", "index", "edge", "nodes"], key).not.toContain(key);
    expect(stored).toContain('"fraId":358070');
  });
});
