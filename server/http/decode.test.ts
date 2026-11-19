import { describe, expect, it } from "vitest";
import { AppError } from "../../shared/app.ts";
import { DEFAULT_INCLUDE } from "../../shared/railroads.ts";
import { decodeBody, decodeQuery, savedRouteId } from "./decode.ts";

/** The AppError a decoder throws, as "kind field: message", or "accepted". */
function refusal(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof AppError) return `${error.kind} ${error.field}: ${error.message}`;
    throw error;
  }
  return "accepted";
}

const plan = {
  places: [{ kind: "text", text: "Kansas City, MO" }, { kind: "node", fraId: 357961, railroad: "BNSF" }, { kind: "shop", shopId: "s1" }],
  include: { regional: false, shortLine: true, passenger: false },
  turnAtStops: true,
};

describe("decodeBody", () => {
  it("reads a plan; unknown fields are dropped and any row may be empty", () => {
    expect(decodeBody["POST /api/route"]({ ...plan, extra: "x" })).toEqual(plan);
    const empty = { places: [null, null, null], include: DEFAULT_INCLUDE, turnAtStops: false };
    expect(decodeBody["POST /api/route"](empty)).toEqual(empty);
  });

  it("a plan needs the track it includes and whether it turns at stops, and a bad one names its field", () => {
    expect(refusal(() => decodeBody["POST /api/route"]({ ...plan, include: undefined }))).toMatch(/^invalid include: /);
    expect(refusal(() => decodeBody["POST /api/route"]({ ...plan, turnAtStops: "yes" }))).toMatch(/^invalid turnAtStops: /);
    expect(refusal(() => decodeBody["POST /api/route"]({ ...plan, include: { ...plan.include, regional: "yes" } }))).toMatch(/^invalid include\.regional: /);
  });

  it("names the field at fault in a plan", () => {
    const route = (over: object) => refusal(() => decodeBody["POST /api/route"]({ ...plan, ...over }));
    const at1 = (place: object) => route({ places: [plan.places[0], place, plan.places[2]] });
    expect(route({ places: [{ kind: "lookup", text: "x" }, null] })).toMatch(/^invalid places\[0\]\.kind: /);
    expect(at1({ kind: "node", fraId: 1.5, railroad: null })).toMatch(/^invalid places\[1\]\.fraId: /);
    expect(at1({ kind: "node", fraId: 357961, railroad: "ATSF" })).toMatch(/^invalid places\[1\]\.railroad: .*BNSF/);
    expect(at1({ kind: "coord", lon: 200, lat: 0 })).toMatch(/^invalid places\[1\]\.lon: /);
    expect(route({ places: "none" })).toMatch(/^invalid places: /);
    expect(route({ places: [null] })).toMatch(/^invalid places: .*at least 2/);
    expect(route({ places: Array.from({ length: 53 }, () => plan.places[1]) })).toMatch(/^invalid places: .*more than 52/);
    expect(refusal(() => decodeBody["POST /api/route"]("plain text"))).toMatch(/^invalid null: /);
  });

  it("reads a saved route: a name, its places with none empty, a known option or none, and its route string", () => {
    const draft = { name: "  KC → Chicago  ", plan, option: "shortest", routeString: "BNSF-[Chicago, IL]-CSXT" };
    expect(decodeBody["POST /api/saved-routes"](draft)).toEqual({ ...draft, name: "KC → Chicago" });
    expect(decodeBody["PUT /api/saved-routes/:routeId"]({ ...draft, option: null })).toMatchObject({ option: null });
    expect(refusal(() => decodeBody["POST /api/saved-routes"]({ ...draft, name: "  " }))).toMatch(/^invalid name: /);
    // SQLite would store "a\u0000b" as "a" and "a\ud800b" as "a\ufffdb"; the rest hide or reorder text.
    for (const bad of ["a\u0000b", "a\ud800b", "\u200b", "a\nb", "a\tb", "a\u202eb", "a\u2028b"]) {
      expect(refusal(() => decodeBody["POST /api/saved-routes"]({ ...draft, name: bad }))).toMatch(/^invalid name: /);
    }
    expect(decodeBody["POST /api/saved-routes"]({ ...draft, name: "Kansas City 🚂 Chicago" }).name).toBe("Kansas City 🚂 Chicago");
    expect(refusal(() => decodeBody["POST /api/saved-routes"]({ ...draft, option: "fastest" }))).toMatch(/^invalid option: .*no-turn-backs/);
    expect(refusal(() => decodeBody["POST /api/saved-routes"]({ ...draft, plan: { ...plan, places: [null, ...plan.places.slice(1)] } }))).toMatch(/^invalid plan\.places\[0\]: /);
    expect(refusal(() => decodeBody["POST /api/saved-routes"]({ ...draft, routeString: undefined }))).toMatch(/^invalid routeString: /);
    // The route string is stored and compared on save the same way, so it is held to the same rule.
    expect(refusal(() => decodeBody["POST /api/saved-routes"]({ ...draft, routeString: "a\u0000b" }))).toMatch(/^invalid routeString: .*invisible/);
  });

  it("reads imports and shops", () => {
    const source = { kind: "csv", fileName: "EXAMPLE shops.csv", text: "name\n1" };
    expect(decodeBody["POST /api/shops/import"]({ source, commit: false })).toEqual({ source, commit: false });
    expect(refusal(() => decodeBody["POST /api/shops/import"]({ source: { ...source, kind: "xlsx" }, commit: true }))).toMatch(/^invalid source\.kind: /);
    expect(decodeBody["POST /api/shops"]({ name: "EXAMPLE shop", code: null, location: { kind: "text", text: "" }, links: [] })).toEqual({
      name: "EXAMPLE shop",
      code: null,
      location: { kind: "text", text: "" },
      links: [],
    });
    // A NUL-leading name or code would be saved as "": a shop listed without its name.
    const shop = { name: "EXAMPLE shop", code: "EX-1", location: { kind: "coord", lon: -96.5, lat: 39.1 }, links: [] };
    for (const bad of ["\u0000hidden", "A\u0000x", "a\tb", "a\nb", "a\u202eb", "a\u200bb"]) {
      expect(refusal(() => decodeBody["POST /api/shops"]({ ...shop, name: bad }))).toMatch(/^invalid name: .*invisible/);
      expect(refusal(() => decodeBody["POST /api/shops"]({ ...shop, code: bad }))).toMatch(/^invalid code: .*invisible/);
    }
  });

  it("reads a shop's links: at most two FRA node ids", () => {
    const shop = { name: "EXAMPLE shop", code: null, location: { kind: "coord", lon: -82.3376, lat: 42.9596 } };
    expect(decodeBody["POST /api/shops"]({ ...shop, links: [628925, 628886] }).links).toEqual([628925, 628886]);
    expect(refusal(() => decodeBody["POST /api/shops"]({ ...shop, links: [628925, 628886, 628912] }))).toMatch(/^invalid links: links has more than 2 items/);
    expect(refusal(() => decodeBody["POST /api/shops"]({ ...shop, links: [-1] }))).toMatch(/^invalid links\[0\]: /);
    expect(refusal(() => decodeBody["POST /api/shops"](shop))).toMatch(/^invalid links: /);
  });

  it("reads a shop's link ends: each a node or a spot, at most two", () => {
    const links = decodeBody["POST /api/places/links"];
    const node = { fraId: 628925 }, spot = { lon: -82.3445, lat: 42.9562 };
    expect(links({ lon: -82.3376, lat: 42.9596, ends: [node, { ...spot, extra: 1 }] })).toEqual({ lon: -82.3376, lat: 42.9596, ends: [node, spot] });
    expect(links({ lon: -82.3376, lat: 42.9596, ends: [] }).ends).toEqual([]);
    expect(refusal(() => links({ lon: -82.3376, lat: 42.9596, ends: [node, spot, node] }))).toMatch(/^invalid ends: ends has more than 2 items/);
    expect(refusal(() => links({ lon: -82.3376, lat: 42.9596, ends: [{ fraId: -1 }] }))).toMatch(/^invalid ends\[0\]\.fraId: /);
    expect(refusal(() => links({ lon: -82.3376, lat: 42.9596, ends: [{ lon: -82.3 }] }))).toMatch(/^invalid ends\[0\]\.lat: /);
    expect(refusal(() => links({ lon: -82.3376, lat: 42.9596, ends: ["FRA 628925"] }))).toMatch(/^invalid ends\[0\]: /);
    expect(refusal(() => links({ lat: 42.9596, ends: [node] }))).toMatch(/^invalid lon: /);
  });
});

describe("decodeQuery and path params", () => {
  it("reads numbers and roles from the query string, naming a missing or bad one", () => {
    expect(decodeQuery["GET /api/places/nearest"](new URLSearchParams("lon=-97.34&lat=31.1&withinKm=2"))).toEqual({ lon: -97.34, lat: 31.1, withinKm: 2 });
    expect(refusal(() => decodeQuery["GET /api/places/nearest"](new URLSearchParams("lon=-97.34&withinKm=2")))).toMatch(/^invalid lat: /);
    expect(refusal(() => decodeQuery["GET /api/places/nearest"](new URLSearchParams("lon=abc&lat=1&withinKm=2")))).toMatch(/^invalid lon: /);
    expect(decodeQuery["GET /api/places/suggest"](new URLSearchParams("q=temp&role=shop"))).toEqual({ q: "temp", role: "shop" });
    expect(refusal(() => decodeQuery["GET /api/places/suggest"](new URLSearchParams("q=temp")))).toMatch(/^invalid role: /);
  });

  it("accepts only non-empty ids", () => {
    expect(savedRouteId("r1")).toBe("r1");
    expect(refusal(() => savedRouteId("  "))).toMatch(/^invalid routeId: /);
  });
});
