/** The namespace rules, on the real network and a ":memory:" store. */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { loadNetwork, type RailNetwork } from "../../engine/index.ts";
import { AppError } from "../../shared/app.ts";
import type { FraId, PlaceRef, PlaceResolution, Shop, ShopId, UploadSource } from "../../shared/places.ts";
import { openStore } from "../store/sqlite.ts";
import type { Store } from "../store/store.ts";
import { createDirectory, type Directory } from "./directory.ts";
import { createShops } from "./shops.ts";

let network: RailNetwork;
beforeAll(() => {
  network = loadNetwork();
});

const stores: Store[] = [];
afterEach(() => stores.splice(0).forEach((s) => s.close()));

function setup(): { store: Store; directory: Directory } {
  const store = openStore(":memory:");
  stores.push(store);
  return { store, directory: createDirectory(network, store) };
}

/** FRA node 358070 is at Temple, TX, where BNSF and UP have track. */
const TEMPLE = 358070 as FraId;
const KANSAS_CITY = { lon: -94.58, lat: 39.1 };
const WACO = { lon: -97.14, lat: 31.55 };
const text = (t: string): PlaceRef => ({ kind: "text", text: t });
const shop = (over: Partial<Shop>): Shop => ({ id: "s1" as ShopId, name: "EXAMPLE shop", code: null, location: KANSAS_CITY, links: [], ...over });
const csv = (body: string): UploadSource => ({ kind: "csv", fileName: "EXAMPLE.csv", text: body });

const placeOf = (r: PlaceResolution) => {
  if (!r.ok) throw new Error(`did not resolve: ${r.problem.message}`);
  return r.place;
};
const problemOf = (r: PlaceResolution) => {
  if (r.ok) throw new Error(`resolved to ${r.place.label}`);
  return r.problem;
};

describe("Directory.resolve", () => {
  it("a bare number typed by a person is never an FRA node; 'FRA 358070' is the node", () => {
    const { directory } = setup();
    const unknown = problemOf(directory.resolve(text("358070"), "position"));
    expect(unknown.kind).toBe("unknown");
    expect(unknown.message).toMatch(/type "FRA 358070"/);
    // Offered, labelled as an FRA node, for the person to pick on purpose.
    expect(unknown.candidates).toContainEqual(expect.objectContaining({ ref: { kind: "node", fraId: TEMPLE, railroad: null }, detail: "FRA node 358070" }));
    // Never as you type: Enter on a highlighted suggestion would turn a typed number into an FRA node.
    expect(directory.suggest("358070", "position", 8).filter((s) => s.source === "node")).toEqual([]);

    for (const typed of ["FRA 358070", "fra node 358070", "FRA:358070"]) {
      const place = placeOf(directory.resolve(text(typed), "position"));
      expect(place, typed).toMatchObject({ fraId: TEMPLE, label: "Temple, TX", match: { method: "node", confidence: "exact", snapKm: 0 } });
    }
    expect(problemOf(directory.resolve(text("FRA 1"), "position")).kind).toBe("removed");
  });

  it("role shop prefers Your shops over a city of the same name; role position prefers the city", () => {
    const { store, directory } = setup();
    store.shops.save(shop({ name: "Temple, TX", code: "EX-TPL", location: WACO }));
    const asShop = placeOf(directory.resolve(text("Temple, TX"), "shop"));
    expect(asShop.match.method).toBe("shop");
    expect([asShop.lon, asShop.lat]).toEqual([WACO.lon, WACO.lat]);
    const asPosition = placeOf(directory.resolve(text("temple, tx"), "position"));
    expect(asPosition.match.method).toBe("city");
    expect(asPosition.label).toBe("Temple, TX");
    // A shop's code works for either role; nothing else has that name.
    expect(placeOf(directory.resolve(text("ex-tpl"), "position")).match.method).toBe("shop");
    // Two shops with one name: the person must pick.
    store.shops.save(shop({ id: "s2" as ShopId, name: "Temple, TX", code: null, location: KANSAS_CITY }));
    expect(problemOf(directory.resolve(text("Temple, TX"), "shop"))).toMatchObject({ kind: "ambiguous", candidates: [expect.objectContaining({ source: "shop" }), expect.objectContaining({ source: "shop" })] });
  });

  it("'lon, lat' and 'lat, lon' both read as coordinates in North America", () => {
    const { directory } = setup();
    for (const typed of ["-97.34, 31.09", "31.09, -97.34", "−97.34 31.09", "31.09;-97.34"]) {
      const place = placeOf(directory.resolve(text(typed), "position"));
      expect(place, typed).toMatchObject({ lon: -97.34, lat: 31.09, fraId: null, label: "Temple, TX", match: { method: "coordinates", confidence: "snapped" } });
      expect(place.railroads).toEqual(["BNSF", "UP"]);
    }
  });

  it("coordinates over 15 km from mainline are off-network; a deleted shop is removed", () => {
    const { store, directory } = setup();
    const sea = problemOf(directory.resolve({ kind: "coord", lon: -90, lat: 25 }, "position"));
    expect(sea).toMatchObject({ kind: "off-network", message: "No track near -90, 25." });
    store.shops.save(shop({ location: { lon: -90, lat: 25 }, name: "EXAMPLE at sea" }));
    expect(problemOf(directory.resolve({ kind: "shop", shopId: "s1" as ShopId }, "shop")).message).toMatch(/^The shop EXAMPLE at sea: /);
    store.shops.remove("s1" as ShopId);
    expect(problemOf(directory.resolve({ kind: "shop", shopId: "s1" as ShopId }, "shop")).kind).toBe("removed");
    expect(problemOf(directory.resolve(text("  "), "shop")).kind).toBe("empty");
  });

  it("a node ref with a railroad keeps it; railroads lists every railroad with track there", () => {
    const { directory } = setup();
    expect(placeOf(directory.resolve({ kind: "node", fraId: TEMPLE, railroad: "UP" }, "position"))).toMatchObject({ fraId: TEMPLE, railroad: "UP", railroads: ["BNSF", "UP"] });
    expect(problemOf(directory.resolve({ kind: "node", fraId: TEMPLE, railroad: "CSXT" }, "position"))).toMatchObject({ kind: "off-network", message: "CSXT has no track at Temple, TX." });
    expect(problemOf(directory.resolve({ kind: "node", fraId: 1 as FraId, railroad: null }, "position"))).toMatchObject({ kind: "removed", message: "No track found for that code." });
  });

  it("answers change after a shop is saved (memo follows store.revision)", () => {
    const { store, directory } = setup();
    expect(directory.resolve(text("EX-NEW"), "shop").ok).toBe(false);
    store.shops.save(shop({ code: "EX-NEW" }));
    expect(placeOf(directory.resolve(text("EX-NEW"), "shop")).match.method).toBe("shop");
    store.shops.save(shop({ code: "EX-NEW", location: WACO }));
    expect(placeOf(directory.resolve({ kind: "shop", shopId: "s1" as ShopId }, "shop")).lat).toBe(WACO.lat);
  });
});

describe("Directory.suggest / nearest", () => {
  it("suggests shops and cities, each as a typed ref, shops first for role shop", () => {
    const { store, directory } = setup();
    store.shops.save(shop({ name: "Kansas City, MO", code: "EX-KCY-01" }));
    const forShop = directory.suggest("kansas", "shop", 8);
    expect(forShop.map((s) => s.source)).toEqual(["shop", "city"]);
    expect(forShop[0]).toEqual({ ref: { kind: "shop", shopId: "s1" }, label: "Kansas City, MO", detail: "Your shop · EX-KCY-01", source: "shop", railroads: expect.arrayContaining(["BNSF"]) });
    expect(forShop[1]).toMatchObject({ ref: { kind: "coord" }, label: "Kansas City, MO", detail: "City" });
    expect(forShop.every((s) => s.ref.kind !== "text")).toBe(true);
    expect(directory.suggest("kansas", "position", 8).map((s) => s.source)).toEqual(["city", "shop"]);
    expect(directory.suggest("kansas", "position", 1)).toHaveLength(1);
    expect(directory.suggest("  ", "shop", 8)).toEqual([]);
    expect(directory.suggest("FRA 358070", "position", 8)).toEqual([{ ref: { kind: "node", fraId: TEMPLE, railroad: null }, label: "Temple, TX", detail: "FRA node 358070", source: "junction", railroads: ["BNSF", "UP"] }]);
  });

  it("names what a suggested node is (yard, junction, plain node) and lists the railroads at every suggestion", () => {
    const { directory } = setup();
    // Both near Billings, MT, on BNSF only: one on yard track, one on the main line.
    expect(directory.suggest("FRA 336746", "position", 8)[0]).toMatchObject({ source: "yard", railroads: ["BNSF"] });
    expect(directory.suggest("FRA 337291", "position", 8)[0]).toMatchObject({ source: "node", railroads: ["BNSF"] });
    const city = directory.suggest("Temple, TX", "position", 8)[0];
    expect(city).toMatchObject({ source: "city", railroads: ["BNSF", "UP"] });
    expect(city.railroads).toEqual(placeOf(directory.resolve(city.ref, "position")).railroads);
  });

  it("nearest returns the node within the tolerance with its railroads, else null", () => {
    const { directory } = setup();
    const hit = directory.nearest(-97.34, 31.09, 5, "track");
    expect(hit).toMatchObject({ fraId: TEMPLE, near: "Temple, TX", railroads: ["BNSF", "UP"] });
    expect(hit!.km).toBeLessThan(1);
    expect(directory.nearest(-90, 25, 5, "track")).toBeNull();
  });
});

describe("Shops", () => {
  it("save resolves the draft's location and stores a node or coordinates, never text", () => {
    const { store, directory } = setup();
    const shops = createShops(store, directory);
    const byFra = shops.save({ name: "EXAMPLE A", code: "EX-A", location: text("FRA 358070"), links: [] }, null);
    const byNode = shops.save({ name: "EXAMPLE B", code: "EX-B", location: { kind: "node", fraId: TEMPLE, railroad: "BNSF" }, links: [] }, null);
    const byCity = shops.save({ name: "EXAMPLE C", code: null, location: text("Temple, TX"), links: [] }, null);
    expect(store.shops.get(byFra.id)?.location).toEqual({ fraId: TEMPLE, railroad: null });
    expect(store.shops.get(byNode.id)?.location).toEqual({ fraId: TEMPLE, railroad: "BNSF" });
    expect(store.shops.get(byCity.id)?.location).toEqual({ lon: network.city("Temple, TX")!.lon, lat: network.city("Temple, TX")!.lat });
    expect(byFra).toMatchObject({ place: { ok: true, place: { railroads: ["BNSF", "UP"] } } });

    const refused = (run: () => unknown) => {
      try {
        run();
      } catch (error) {
        if (error instanceof AppError) return `${error.kind} ${error.field}`;
        throw error;
      }
      return "saved";
    };
    expect(refused(() => shops.save({ name: " ", code: null, location: text("Temple, TX"), links: [] }, null))).toBe("invalid name");
    expect(refused(() => shops.save({ name: "EXAMPLE sea", code: null, location: { kind: "coord", lon: -90, lat: 25 }, links: [] }, null))).toBe("invalid location");
    expect(refused(() => shops.save({ name: "EXAMPLE D", code: "ex-a", location: text("Temple, TX"), links: [] }, null))).toBe("conflict code");
    expect(refused(() => shops.save({ name: "EXAMPLE E", code: null, location: text("Temple, TX"), links: [] }, "nope" as ShopId))).toBe("not-found null");
    expect(refused(() => shops.remove("nope" as ShopId))).toBe("not-found null");
    expect(store.shops.all()).toHaveLength(3);
  });

  it("import with commit false saves nothing; with commit true twice leaves one copy of each shop", async () => {
    const { store, directory } = setup();
    const shops = createShops(store, directory);
    const source = csv("name,code,lon,lat\nEXAMPLE North,EX-N,-92.27,34.77\nEXAMPLE Temple,,-97.34,31.09\n");
    const preview = await shops.import({ source, commit: false });
    expect(preview).toMatchObject({ committed: false, issues: [] });
    expect(preview.ready.map((s) => [s.name, s.code, s.place.ok])).toEqual([
      ["EXAMPLE North", "EX-N", true],
      ["EXAMPLE Temple", null, true],
    ]);
    expect(store.shops.all()).toEqual([]);

    const first = await shops.import({ source, commit: true });
    expect(first.committed).toBe(true);
    const revision = store.revision;
    const second = await shops.import({ source, commit: true });
    expect(store.revision).toBe(revision);
    expect(store.shops.all().map((s) => s.name)).toEqual(["EXAMPLE North", "EXAMPLE Temple"]);
    expect(second.ready.map((s) => s.id)).toEqual(first.ready.map((s) => s.id));

    // Matched by code, then by name: a moved shop is updated in place.
    await shops.import({ source: csv("name,code,lon,lat\nEXAMPLE North renamed,EX-N,-92.3,34.8\n"), commit: true });
    expect(store.shops.all().map((s) => s.name)).toEqual(["EXAMPLE North renamed", "EXAMPLE Temple"]);
  });

  it("import lists rows that match no node as issues and does not save them", async () => {
    const { store, directory } = setup();
    const shops = createShops(store, directory);
    const report = await shops.import({
      source: csv("name,code,lon,lat\nEXAMPLE ok,EX-1,-97.34,31.09\nEXAMPLE sea,EX-2,-90,25\nEXAMPLE unknown,NO-SUCH-CODE,,\nEXAMPLE twice,EX-1,-92.27,34.77\n"),
      commit: true,
    });
    expect(report.ready.map((s) => s.name)).toEqual(["EXAMPLE ok"]);
    expect(report.issues.map((i) => [i.line, i.message])).toEqual([
      [3, "No track near -90, 25."],
      [4, "Give the shop an fra_id, or lon and lat."],
      [5, expect.stringMatching(/repeats the code EX-1 from line 2/)],
    ]);
    expect(store.shops.all().map((s) => s.name)).toEqual(["EXAMPLE ok"]);
  });

  // Procor's Sarnia plant: its lead joins the main line at 628925; track runs off west to 628886; CSXT is 4.6 km away.
  const SARNIA = { kind: "coord", lon: -82.3376, lat: 42.9596 } as const;
  const EAST = 628925 as FraId, WEST = 628886 as FraId;
  const sarnia = (links: FraId[] = [EAST]) => ({ name: "EXAMPLE Sarnia", code: "EX-SAR", location: SARNIA, links });

  it("a linked shop stays at its location and joins the network at its links, each a straight piece away, with their railroads", () => {
    const { store, directory } = setup();
    const shops = createShops(store, directory);
    const saved = shops.save(sarnia([EAST, WEST]), null);
    expect(store.shops.get(saved.id)?.links).toEqual([EAST, WEST]);
    const place = placeOf(saved.place);
    expect(place).toMatchObject({ label: "EXAMPLE Sarnia", lon: SARNIA.lon, lat: SARNIA.lat, fraId: null, railroad: null, railroads: ["CN", "CPKC"] });
    expect(place.links).toEqual([
      expect.objectContaining({ fraId: EAST, km: expect.closeTo(0.519, 2), railroads: ["CN", "CPKC"], near: "Sarnia, ON" }),
      expect.objectContaining({ fraId: WEST, km: expect.closeTo(0.766, 2) }),
    ]);
    expect(placeOf(directory.resolve({ kind: "shop", shopId: saved.id }, "shop")).links).toEqual(place.links);
    // Unlinked, the location snaps and CSXT, 4.6 km away, serves it too.
    expect(placeOf(shops.save({ ...sarnia([]), code: "EX-SAR-2" }, null).place).railroads).toEqual(["CSXT", "CN", "CPKC"]);
  });

  it("a links-only edit is written; a link that repeats, is gone or is over 5 km away is refused on 'links'", () => {
    const { store, directory } = setup();
    const shops = createShops(store, directory);
    const saved = shops.save(sarnia([]), null);
    const revision = store.revision;
    shops.save(sarnia(), saved.id);
    expect(store.revision).toBe(revision + 1);
    expect(store.shops.get(saved.id)?.links).toEqual([EAST]);
    const refusal = (links: FraId[]) => {
      try {
        shops.save(sarnia(links), saved.id);
      } catch (error) {
        if (error instanceof AppError) return [error.field, error.message];
      }
      return "saved";
    };
    expect(refusal([EAST, EAST])).toEqual(["links", "Link 2 repeats link 1."]);
    expect(refusal([EAST, 1 as FraId])).toEqual(["links", "The shop EXAMPLE Sarnia: link 2 is gone from this network."]);
    expect(refusal([633683 as FraId])).toEqual(["links", "Link 1 is more than 5 km from the shop."]);
  });

  it("a linked shop whose node a new network lacks is removed, naming the link", () => {
    const { store, directory } = setup();
    store.shops.save({ id: "s1" as ShopId, name: "EXAMPLE Sarnia", code: null, location: SARNIA, links: [1 as FraId] });
    expect(problemOf(directory.resolve({ kind: "shop", shopId: "s1" as ShopId }, "shop"))).toMatchObject({ kind: "removed", message: "The shop EXAMPLE Sarnia: link 1 is gone from this network." });
  });

  it("import keeps a shop's links while the file leaves it where it is, and drops them when it moves it", async () => {
    const { store, directory } = setup();
    const shops = createShops(store, directory);
    const saved = shops.save(sarnia(), null);
    const preview = await shops.import({ source: csv("name,code,lon,lat\nEXAMPLE Sarnia renamed,EX-SAR,-82.3376,42.9596\n"), commit: false });
    expect(preview.ready[0].links).toEqual([EAST]);
    await shops.import({ source: csv("name,code,lon,lat\nEXAMPLE Sarnia renamed,EX-SAR,-82.3376,42.9596\n"), commit: true });
    expect(store.shops.get(saved.id)).toMatchObject({ name: "EXAMPLE Sarnia renamed", links: [EAST] });
    await shops.import({ source: csv("name,code,lon,lat\nEXAMPLE Sarnia renamed,EX-SAR,-82.35,42.96\n"), commit: true });
    expect(store.shops.get(saved.id)?.links).toEqual([]);
  });
});
