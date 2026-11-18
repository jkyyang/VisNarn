import { describe, expect, it } from "vitest";
import { AppError } from "../../shared/app.ts";
import { DEFAULT_ASSUMPTIONS } from "../../shared/assumptions.ts";
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
  start: { kind: "text", text: "Kansas City, MO" },
  stops: [{ kind: "node", fraId: 357961, railroad: "BNSF" }],
  destination: { kind: "shop", shopId: "s1" },
  include: { regional: false, shortLine: true, passenger: false },
};

describe("decodeBody", () => {
  it("reads a plan; unknown fields are dropped and an end may be empty", () => {
    expect(decodeBody["POST /api/route"]({ ...plan, extra: "x" })).toEqual(plan);
    expect(decodeBody["POST /api/route"]({ start: null, stops: [], destination: null, include: DEFAULT_INCLUDE })).toEqual({ start: null, stops: [], destination: null, include: DEFAULT_INCLUDE });
  });

  it("a plan without the track it includes gets the default; a bad one names its field", () => {
    expect(decodeBody["POST /api/route"]({ ...plan, include: undefined }).include).toEqual(DEFAULT_INCLUDE);
    expect(refusal(() => decodeBody["POST /api/route"]({ ...plan, include: { ...plan.include, regional: "yes" } }))).toMatch(/^invalid include\.regional: /);
  });

  it("names the field at fault in a plan", () => {
    const route = (over: object) => refusal(() => decodeBody["POST /api/route"]({ ...plan, ...over }));
    expect(route({ start: { kind: "lookup", text: "x" } })).toMatch(/^invalid start\.kind: /);
    expect(route({ stops: [{ kind: "node", fraId: 1.5, railroad: null }] })).toMatch(/^invalid stops\[0\]\.fraId: /);
    expect(route({ stops: [{ kind: "node", fraId: 357961, railroad: "ATSF" }] })).toMatch(/^invalid stops\[0\]\.railroad: .*BNSF/);
    expect(route({ stops: [{ kind: "coord", lon: 200, lat: 0 }] })).toMatch(/^invalid stops\[0\]\.lon: /);
    expect(route({ stops: "none" })).toMatch(/^invalid stops: /);
    expect(route({ stops: Array.from({ length: 51 }, () => plan.stops[0]) })).toMatch(/^invalid stops: .*more than 50/);
    expect(refusal(() => decodeBody["POST /api/route"]("not an object"))).toMatch(/^invalid null: /);
  });

  it("reads a saved route: a name, both ends, a known option or none, and its route string", () => {
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
    expect(refusal(() => decodeBody["POST /api/saved-routes"]({ ...draft, plan: { ...plan, start: null } }))).toMatch(/^invalid plan\.start: /);
    expect(refusal(() => decodeBody["POST /api/saved-routes"]({ ...draft, routeString: undefined }))).toMatch(/^invalid routeString: /);
  });

  it("reads assumptions in their three groups and refuses a number that is not finite", () => {
    expect(decodeBody["PUT /api/assumptions"](JSON.parse(JSON.stringify(DEFAULT_ASSUMPTIONS)))).toEqual(DEFAULT_ASSUMPTIONS);
    const broken = { ...DEFAULT_ASSUMPTIONS, timing: { ...DEFAULT_ASSUMPTIONS.timing, speedKmPerDay: "fast" } };
    expect(refusal(() => decodeBody["PUT /api/assumptions"](broken))).toMatch(/^invalid timing\.speedKmPerDay: /);
    expect(refusal(() => decodeBody["PUT /api/assumptions"]({ ...DEFAULT_ASSUMPTIONS, routing: { allowed: ["XX"], interchangePenaltyKm: 1 } }))).toMatch(
      /^invalid routing\.allowed\[0\]: /,
    );
  });

  it("reads imports and shops", () => {
    const source = { kind: "csv", fileName: "EXAMPLE shops.csv", text: "name\n1" };
    expect(decodeBody["POST /api/codes/import"]({ source, commit: false, codeType: "splc", label: "SPLC" })).toEqual({ source, commit: false, codeType: "splc", label: "SPLC" });
    expect(refusal(() => decodeBody["POST /api/shops/import"]({ source: { ...source, kind: "xlsx" }, commit: true }))).toMatch(/^invalid source\.kind: /);
    expect(decodeBody["POST /api/shops"]({ name: "EXAMPLE shop", code: null, location: { kind: "text", text: "" } })).toEqual({
      name: "EXAMPLE shop",
      code: null,
      location: { kind: "text", text: "" },
    });
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
