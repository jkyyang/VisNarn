/** The namespace rules, on the real network and an in-memory store. */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { loadNetwork, type RailNetwork } from "../../engine/index.ts";
import { AppError } from "../../shared/app.ts";
import type { FraId, PlaceRef, PlaceResolution, Shop, ShopId, UploadSource } from "../../shared/places.ts";
import { openStore } from "../store/postgres.ts";
import type { Store } from "../store/store.ts";
import { createDirectory, type Directory } from "./directory.ts";
import { createShops } from "./shops.ts";

let network: RailNetwork;
beforeAll(() => {
  network = loadNetwork();
});

const stores: Store[] = [];
afterEach(() => Promise.all(stores.splice(0).map((s) => s.close())));

async function setup(): Promise<{ store: Store; directory: Directory }> {
  const store = await openStore("memory://");
  stores.push(store);
  return { store, directory: createDirectory(network, store) };
}

/** FRA node 358070 is at Temple, TX, where BNSF and UP have track. */
const TEMPLE = 358070 as FraId;
const KANSAS_CITY = { lon: -94.58, lat: 39.1 };
const WACO = { lon: -97.14, lat: 31.55 };
const text = (t: string): PlaceRef => ({ kind: "text", text: t });
/** Shop ids are UUIDs. */
const S1 = "00000000-0000-4000-8000-000000000001" as ShopId;
const shop = (over: Partial<Shop>): Shop => ({ id: S1, name: "EXAMPLE shop", code: null, location: KANSAS_CITY, links: [], ...over });
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
  it("a bare number typed by a person is never an FRA node; 'FRA 358070' is the node", async () => {
    const { directory } = await setup();
    const unknown = problemOf(await directory.resolve(text("358070"), "position"));
    expect(unknown.kind).toBe("unknown");
    expect(unknown.message).toMatch(/type "FRA 358070"/);
    // Offered, labelled as an FRA node, for the person to pick on purpose.
    expect(unknown.candidates).toContainEqual(expect.objectContaining({ ref: { kind: "node", fraId: TEMPLE, railroad: null }, detail: "FRA node 358070" }));
    // Never as you type: Enter on a highlighted suggestion would turn a typed number into an FRA node.
    expect((await directory.suggest("358070", "position", 8)).filter((s) => s.source === "node")).toEqual([]);

    for (const typed of ["FRA 358070", "fra node 358070", "FRA:358070"]) {
      const place = placeOf(await directory.resolve(text(typed), "position"));
      expect(place, typed).toMatchObject({ fraId: TEMPLE, label: "Temple, TX", match: { method: "node", confidence: "exact", snapKm: 0 } });
    }
    expect(problemOf(await directory.resolve(text("FRA 1"), "position")).kind).toBe("removed");
  });

  it("role shop prefers Your shops over a city of the same name; role position prefers the city", async () => {
    const { store, directory } = await setup();
    await store.shops.save(shop({ name: "Temple, TX", code: "EX-TPL", location: WACO }));
    const asShop = placeOf(await directory.resolve(text("Temple, TX"), "shop"));
    expect(asShop.match.method).toBe("shop");
    expect([asShop.lon, asShop.lat]).toEqual([WACO.lon, WACO.lat]);
    const asPosition = placeOf(await directory.resolve(text("temple, tx"), "position"));
    expect(asPosition.match.method).toBe("city");
    expect(asPosition.label).toBe("Temple, TX");
    // A shop's code works for either role; nothing else has that name.
    expect(placeOf(await directory.resolve(text("ex-tpl"), "position")).match.method).toBe("shop");
    // Two shops with one name: the person must pick.
    await store.shops.save(shop({ id: "00000000-0000-4000-8000-000000000002" as ShopId, name: "Temple, TX", code: null, location: KANSAS_CITY }));
    expect(problemOf(await directory.resolve(text("Temple, TX"), "shop"))).toMatchObject({ kind: "ambiguous", candidates: [expect.objectContaining({ source: "shop" }), expect.objectContaining({ source: "shop" })] });
  });

  it("'lon, lat' and 'lat, lon' both read as coordinates in North America", async () => {
    const { directory } = await setup();
    for (const typed of ["-97.34, 31.09", "31.09, -97.34", "−97.34 31.09", "31.09;-97.34"]) {
      const place = placeOf(await directory.resolve(text(typed), "position"));
      expect(place, typed).toMatchObject({ lon: -97.34, lat: 31.09, fraId: null, label: "Temple, TX", match: { method: "coordinates", confidence: "snapped" } });
      expect(place.railroads).toEqual(["BNSF", "UP"]);
    }
  });

  it("coordinates over 15 km from mainline are off-network; a deleted shop is removed", async () => {
    const { store, directory } = await setup();
    const sea = problemOf(await directory.resolve({ kind: "coord", lon: -90, lat: 25 }, "position"));
    expect(sea).toMatchObject({ kind: "off-network", message: "No track near -90, 25." });
    await store.shops.save(shop({ location: { lon: -90, lat: 25 }, name: "EXAMPLE at sea" }));
    expect(problemOf(await directory.resolve({ kind: "shop", shopId: S1 }, "shop")).message).toMatch(/^The shop EXAMPLE at sea: /);
    await store.shops.remove(S1);
    expect(problemOf(await directory.resolve({ kind: "shop", shopId: S1 }, "shop")).kind).toBe("removed");
    expect(problemOf(await directory.resolve(text("  "), "shop")).kind).toBe("empty");
  });

  it("a node ref with a railroad keeps it; railroads lists every railroad with track there", async () => {
    const { directory } = await setup();
    expect(placeOf(await directory.resolve({ kind: "node", fraId: TEMPLE, railroad: "UP" }, "position"))).toMatchObject({ fraId: TEMPLE, railroad: "UP", railroads: ["BNSF", "UP"] });
    expect(problemOf(await directory.resolve({ kind: "node", fraId: TEMPLE, railroad: "CSXT" }, "position"))).toMatchObject({ kind: "off-network", message: "CSXT has no track at Temple, TX." });
    expect(problemOf(await directory.resolve({ kind: "node", fraId: 1 as FraId, railroad: null }, "position"))).toMatchObject({ kind: "removed", message: "No track found for that code." });
  });

  it("answers change after a shop is saved (nothing read from the store is kept)", async () => {
    const { store, directory } = await setup();
    expect((await directory.resolve(text("EX-NEW"), "shop")).ok).toBe(false);
    await store.shops.save(shop({ code: "EX-NEW" }));
    expect(placeOf(await directory.resolve(text("EX-NEW"), "shop")).match.method).toBe("shop");
    await store.shops.save(shop({ code: "EX-NEW", location: WACO }));
    expect(placeOf(await directory.resolve({ kind: "shop", shopId: S1 }, "shop")).lat).toBe(WACO.lat);
  });
});

describe("Directory.suggest / nearest", () => {
  it("suggests shops and cities, each as a typed ref, shops first for role shop", async () => {
    const { store, directory } = await setup();
    await store.shops.save(shop({ name: "Kansas City, MO", code: "EX-KCY-01" }));
    const forShop = await directory.suggest("kansas city, mo", "shop", 8);
    expect(forShop.map((s) => s.source)).toEqual(["shop", "city"]);
    expect(forShop[0]).toEqual({ ref: { kind: "shop", shopId: S1 }, label: "Kansas City, MO", detail: "Your shop · EX-KCY-01", source: "shop", railroads: expect.arrayContaining(["BNSF"]) });
    expect(forShop[1]).toMatchObject({ ref: { kind: "coord" }, label: "Kansas City, MO", detail: "City" });
    expect(forShop.every((s) => s.ref.kind !== "text")).toBe(true);
    expect((await directory.suggest("kansas city, mo", "position", 8)).map((s) => s.source)).toEqual(["city", "shop"]);
    expect(await directory.suggest("kansas", "position", 1)).toHaveLength(1);
    expect(await directory.suggest("  ", "shop", 8)).toEqual([]);
    expect(await directory.suggest("FRA 358070", "position", 8)).toEqual([{ ref: { kind: "node", fraId: TEMPLE, railroad: null }, label: "Temple, TX", detail: "FRA node 358070", source: "junction", railroads: ["BNSF", "UP"] }]);
  });

  it("names what a suggested node is (yard, junction, plain node) and lists the railroads at every suggestion", async () => {
    const { directory } = await setup();
    // Both near Billings, MT, on BNSF only: one on yard track, one on the main line.
    expect((await directory.suggest("FRA 336746", "position", 8))[0]).toMatchObject({ source: "yard", railroads: ["BNSF"] });
    expect((await directory.suggest("FRA 337291", "position", 8))[0]).toMatchObject({ source: "node", railroads: ["BNSF"] });
    const city = (await directory.suggest("Temple, TX", "position", 8))[0];
    expect(city).toMatchObject({ source: "city", railroads: ["BNSF", "UP"] });
    expect(city.railroads).toEqual(placeOf(await directory.resolve(city.ref, "position")).railroads);
  });

  it("nearest returns the node within the tolerance with its railroads, else null", async () => {
    const { directory } = await setup();
    const hit = directory.nearest(-97.34, 31.09, 5);
    expect(hit).toMatchObject({ fraId: TEMPLE, near: "Temple, TX", railroads: ["BNSF", "UP"] });
    expect(hit!.km).toBeLessThan(1);
    expect(directory.nearest(-90, 25, 5)).toBeNull();
  });
});

describe("Directory.links", () => {
  // Procor's Oakville plant as the user had it: its yard fans out north-east to the CN line at 633683.
  const OAKVILLE = { lon: -79.72024, lat: 43.41766 };
  const at = (lon: number, lat: number) => ({ lon, lat });

  it("refines a rough spot in the plant to where its lead meets the main line, and draws the link along the yard", async () => {
    const { directory } = await setup();
    const [fan, lead] = directory.links(OAKVILLE.lon, OAKVILLE.lat, [at(-79.7193, 43.4186), at(-79.7183, 43.4203)]);
    expect(fan).toMatchObject({ fraId: 633683, railroads: ["CN"], km: expect.closeTo(0.609, 2) });
    expect(fan!.path.length).toBeGreaterThan(2);
    expect(fan!.path[0]).toEqual([OAKVILLE.lon, OAKVILLE.lat]);
    expect(fan!.path.at(-1)).toEqual([fan!.lon, fan!.lat]);
    expect(lead).toEqual(fan);
  });

  it("takes a node as it is: on the main line with no yard between, the link is the straight line", async () => {
    const { directory } = await setup();
    const [main, joined] = directory.links(OAKVILLE.lon, OAKVILLE.lat, [{ fraId: 633676 as FraId }, { fraId: 633683 as FraId }]);
    expect(main).toMatchObject({ fraId: 633676, km: expect.closeTo(0.445, 2) });
    expect(main!.path).toHaveLength(2);
    expect(joined).toMatchObject({ fraId: 633683, km: expect.closeTo(0.609, 2) });
  });

  it("is null for a spot with no track within 5 km, a node this network lacks, or a link over 5 km", async () => {
    const { directory } = await setup();
    const atSea = at(-60, 40);
    expect(directory.links(-82.3376, 42.9596, [atSea, { fraId: 1 as FraId }, { fraId: 633683 as FraId }])).toEqual([null, null, null]);
    expect(directory.links(-82.3376, 42.9596, [])).toEqual([]);
  });
});

describe("Shops", () => {
  it("save resolves the draft's location and stores a node or coordinates, never text", async () => {
    const { store, directory } = await setup();
    const shops = createShops(store, directory);
    const byFra = await shops.save({ name: "EXAMPLE A", code: "EX-A", location: text("FRA 358070"), links: [] }, null);
    const byNode = await shops.save({ name: "EXAMPLE B", code: "EX-B", location: { kind: "node", fraId: TEMPLE, railroad: "BNSF" }, links: [] }, null);
    const byCity = await shops.save({ name: "EXAMPLE C", code: null, location: text("Temple, TX"), links: [] }, null);
    expect((await store.shops.get(byFra.id))?.location).toEqual({ fraId: TEMPLE, railroad: null });
    expect((await store.shops.get(byNode.id))?.location).toEqual({ fraId: TEMPLE, railroad: "BNSF" });
    expect((await store.shops.get(byCity.id))?.location).toEqual({ lon: network.city("Temple, TX")!.lon, lat: network.city("Temple, TX")!.lat });
    expect(byFra).toMatchObject({ place: { ok: true, place: { railroads: ["BNSF", "UP"] } } });

    const refused = async (run: () => Promise<unknown>) => {
      try {
        await run();
      } catch (error) {
        if (error instanceof AppError) return `${error.kind} ${error.field}`;
        throw error;
      }
      return "saved";
    };
    expect(await refused(() => shops.save({ name: " ", code: null, location: text("Temple, TX"), links: [] }, null))).toBe("invalid name");
    expect(await refused(() => shops.save({ name: "EXAMPLE sea", code: null, location: { kind: "coord", lon: -90, lat: 25 }, links: [] }, null))).toBe("invalid location");
    expect(await refused(() => shops.save({ name: "EXAMPLE D", code: "ex-a", location: text("Temple, TX"), links: [] }, null))).toBe("conflict code");
    expect(await refused(() => shops.save({ name: "EXAMPLE E", code: null, location: text("Temple, TX"), links: [] }, "nope" as ShopId))).toBe("not-found null");
    expect(await refused(() => shops.remove("nope" as ShopId))).toBe("not-found null");
    expect(await store.shops.all()).toHaveLength(3);
  });

  it("import with commit false saves nothing; with commit true twice leaves one copy of each shop", async () => {
    const { store, directory } = await setup();
    const shops = createShops(store, directory);
    const source = csv("name,code,lon,lat\nEXAMPLE North,EX-N,-92.27,34.77\nEXAMPLE Temple,,-97.34,31.09\n");
    const preview = await shops.import({ source, commit: false });
    expect(preview).toMatchObject({ committed: false, issues: [] });
    expect(preview.ready.map((s) => [s.name, s.code, s.place.ok])).toEqual([
      ["EXAMPLE North", "EX-N", true],
      ["EXAMPLE Temple", null, true],
    ]);
    expect(await store.shops.all()).toEqual([]);

    const first = await shops.import({ source, commit: true });
    expect(first.committed).toBe(true);
    const writes = vi.spyOn(store.shops, "save");
    const second = await shops.import({ source, commit: true });
    expect(writes).not.toHaveBeenCalled();
    expect((await store.shops.all()).map((s) => s.name)).toEqual(["EXAMPLE North", "EXAMPLE Temple"]);
    expect(second.ready.map((s) => s.id)).toEqual(first.ready.map((s) => s.id));

    // Matched by code, then by name: a moved shop is updated in place.
    await shops.import({ source: csv("name,code,lon,lat\nEXAMPLE North renamed,EX-N,-92.3,34.8\n"), commit: true });
    expect((await store.shops.all()).map((s) => s.name)).toEqual(["EXAMPLE North renamed", "EXAMPLE Temple"]);
  });

  it("import lists rows that match no node as issues and does not save them", async () => {
    const { store, directory } = await setup();
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
    expect((await store.shops.all()).map((s) => s.name)).toEqual(["EXAMPLE ok"]);
  });

  // Procor's Sarnia plant: its lead joins the main line at 628925; track runs off west to 628886; CSXT is 4.6 km away.
  const SARNIA = { kind: "coord", lon: -82.3376, lat: 42.9596 } as const;
  const EAST = 628925 as FraId, WEST = 628886 as FraId;
  const sarnia = (links: FraId[] = [EAST]) => ({ name: "EXAMPLE Sarnia", code: "EX-SAR", location: SARNIA, links });

  it("a linked shop stays at its location and joins the network at its links, each over its own track, with their railroads", async () => {
    const { store, directory } = await setup();
    const shops = createShops(store, directory);
    const saved = await shops.save(sarnia([EAST, WEST]), null);
    expect((await store.shops.get(saved.id))?.links).toEqual([EAST, WEST]);
    const place = placeOf(saved.place);
    expect(place).toMatchObject({ label: "EXAMPLE Sarnia", lon: SARNIA.lon, lat: SARNIA.lat, fraId: null, railroad: null, railroads: ["CN", "CPKC"] });
    expect(place.links).toEqual([
      // East: 0.34 km to the plant's yard, then along it to the main line. West: on the main line, the straight line.
      expect.objectContaining({ fraId: EAST, km: expect.closeTo(1.294, 2), railroads: ["CN", "CPKC"], near: "Sarnia, ON" }),
      expect.objectContaining({ fraId: WEST, km: expect.closeTo(0.766, 2) }),
    ]);
    expect(placeOf(await directory.resolve({ kind: "shop", shopId: saved.id }, "shop")).links).toEqual(place.links);
    // Unlinked, the location snaps and CSXT, 4.6 km away, serves it too.
    expect(placeOf((await shops.save({ ...sarnia([]), code: "EX-SAR-2" }, null)).place).railroads).toEqual(["CSXT", "CN", "CPKC"]);
  });

  it("a links-only edit is written; a link that repeats, is gone or is over 5 km away is refused on 'links'", async () => {
    const { store, directory } = await setup();
    const shops = createShops(store, directory);
    const saved = await shops.save(sarnia([]), null);
    const writes = vi.spyOn(store.shops, "save");
    await shops.save(sarnia(), saved.id);
    expect(writes).toHaveBeenCalledTimes(1);
    expect((await store.shops.get(saved.id))?.links).toEqual([EAST]);
    const refusal = async (links: FraId[]) => {
      try {
        await shops.save(sarnia(links), saved.id);
      } catch (error) {
        if (error instanceof AppError) return [error.field, error.message];
      }
      return "saved";
    };
    expect(await refusal([EAST, EAST])).toEqual(["links", "Link 2 repeats link 1."]);
    expect(await refusal([EAST, 1 as FraId])).toEqual(["links", "The shop EXAMPLE Sarnia: link 2 is gone from this network."]);
    expect(await refusal([633683 as FraId])).toEqual(["links", "Link 1 is more than 5 km from the shop."]);
  });

  it("a linked shop whose node a new network lacks is removed, naming the link", async () => {
    const { store, directory } = await setup();
    await store.shops.save({ id: S1, name: "EXAMPLE Sarnia", code: null, location: SARNIA, links: [1 as FraId] });
    expect(problemOf(await directory.resolve({ kind: "shop", shopId: S1 }, "shop"))).toMatchObject({ kind: "removed", message: "The shop EXAMPLE Sarnia: link 1 is gone from this network." });
  });

  it("import keeps a shop's links while the file leaves it where it is, and drops them when it moves it", async () => {
    const { store, directory } = await setup();
    const shops = createShops(store, directory);
    const saved = await shops.save(sarnia(), null);
    const preview = await shops.import({ source: csv("name,code,lon,lat\nEXAMPLE Sarnia renamed,EX-SAR,-82.3376,42.9596\n"), commit: false });
    expect(preview.ready[0].links).toEqual([EAST]);
    await shops.import({ source: csv("name,code,lon,lat\nEXAMPLE Sarnia renamed,EX-SAR,-82.3376,42.9596\n"), commit: true });
    expect(await store.shops.get(saved.id)).toMatchObject({ name: "EXAMPLE Sarnia renamed", links: [EAST] });
    await shops.import({ source: csv("name,code,lon,lat\nEXAMPLE Sarnia renamed,EX-SAR,-82.35,42.96\n"), commit: true });
    expect((await store.shops.get(saved.id))?.links).toEqual([]);
  });
});
