import { describe, expect, it } from "vitest";
import { AppError } from "../../shared/app.ts";
import { DEFAULT_ASSUMPTIONS } from "../../shared/assumptions.ts";
import { batchId, decodeBody, decodeQuery, rowNumber } from "./decode.ts";

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

const report = {
  carId: "EXAMPLE 104233",
  a: { kind: "text", text: "Taylor, TX" },
  b: { kind: "node", fraId: 357961, railroad: "BNSF" },
  shop: { kind: "shop", shopId: "s1" },
  stops: [{ place: { kind: "coord", lon: -97.3, lat: 31.1 }, note: null }],
  reportedAt: "2026-11-17T09:00:00-06:00",
  prepEnd: null,
};

describe("decodeBody", () => {
  it("turns a check request into domain values: times become UTC Instants, unknown fields are dropped", () => {
    const decoded = decodeBody["POST /api/check"]({ report: { ...report, extra: "x" }, asOf: "2026-11-17T15:00:00Z", admin: true });
    expect(decoded).toEqual({ report: { ...report, reportedAt: "2026-11-17T15:00:00.000Z" }, asOf: "2026-11-17T15:00:00.000Z" });
  });

  it("names the field at fault", () => {
    const check = (over: object) => refusal(() => decodeBody["POST /api/check"]({ report: { ...report, ...over }, asOf: "2026-11-17T15:00:00Z" }));
    expect(check({ reportedAt: "2026-11-17 09:00" })).toMatch(/^invalid report\.reportedAt: .*time with its zone/);
    expect(check({ a: { kind: "lookup", text: "x" } })).toMatch(/^invalid report\.a\.kind: /);
    expect(check({ b: { kind: "node", fraId: 1.5, railroad: null } })).toMatch(/^invalid report\.b\.fraId: /);
    expect(check({ b: { kind: "node", fraId: 357961, railroad: "ATSF" } })).toMatch(/^invalid report\.b\.railroad: .*BNSF/);
    expect(check({ stops: [{ place: { kind: "coord", lon: 200, lat: 0 }, note: null }] })).toMatch(/^invalid report\.stops\[0\]\.place\.lon: /);
    expect(check({ stops: "none" })).toMatch(/^invalid report\.stops: /);
    expect(refusal(() => decodeBody["POST /api/check"]("not an object"))).toMatch(/^invalid null: /);
  });

  it("reads assumptions in their three groups and refuses a number that is not finite", () => {
    expect(decodeBody["PUT /api/assumptions"](JSON.parse(JSON.stringify(DEFAULT_ASSUMPTIONS)))).toEqual(DEFAULT_ASSUMPTIONS);
    const ticked = { ...DEFAULT_ASSUMPTIONS, routing: { ...DEFAULT_ASSUMPTIONS.routing, include: { regional: true, shortLine: false, passenger: true } } };
    expect(decodeBody["PUT /api/assumptions"](JSON.parse(JSON.stringify(ticked)))).toEqual(ticked);
    const broken = { ...DEFAULT_ASSUMPTIONS, timing: { ...DEFAULT_ASSUMPTIONS.timing, speedKmPerDay: "fast" } };
    expect(refusal(() => decodeBody["PUT /api/assumptions"](broken))).toMatch(/^invalid timing\.speedKmPerDay: /);
    expect(refusal(() => decodeBody["PUT /api/assumptions"]({ ...DEFAULT_ASSUMPTIONS, routing: { allowed: ["XX"], interchangePenaltyKm: 1 } }))).toMatch(
      /^invalid routing\.allowed\[0\]: /,
    );
  });

  it("checks an import profile's time zone and column names", () => {
    const profile = {
      columns: { carId: "car_id", a: "last_node", b: "next_node", shop: "shop", reportedAt: "reported_at", prepEnd: "prep_end" },
      positions: { codeType: "splc" },
      zonelessTimes: { zone: "America/Chicago" },
    };
    expect(decodeBody["PUT /api/import-profile"](profile)).toEqual(profile);
    expect(decodeBody["PUT /api/import-profile"]({ ...profile, positions: "text", zonelessTimes: "reject" })).toMatchObject({ positions: "text", zonelessTimes: "reject" });
    expect(refusal(() => decodeBody["PUT /api/import-profile"]({ ...profile, zonelessTimes: { zone: "Texas" } }))).toMatch(/^invalid zonelessTimes\.zone: Texas is not a time zone/);
    expect(refusal(() => decodeBody["PUT /api/import-profile"]({ ...profile, columns: { ...profile.columns, shop: " " } }))).toMatch(/^invalid columns\.shop: /);
  });

  it("reads uploads, imports and fixes", () => {
    const source = { kind: "csv", fileName: "EXAMPLE cars.csv", text: "car_id\n1" };
    expect(decodeBody["POST /api/batches"]({ name: "Morning", asOf: "2026-11-17T12:00:00Z", source })).toEqual({ name: "Morning", asOf: "2026-11-17T12:00:00.000Z", source });
    expect(decodeBody["POST /api/codes/import"]({ source, commit: false, codeType: "splc", label: "SPLC" })).toEqual({ source, commit: false, codeType: "splc", label: "SPLC" });
    expect(refusal(() => decodeBody["POST /api/shops/import"]({ source: { ...source, kind: "xlsx" }, commit: true }))).toMatch(/^invalid source\.kind: /);
    expect(decodeBody["PUT /api/batches/:batchId/cars/:row/fix"]({ stops: report.stops })).toEqual({ stops: report.stops });
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

  it("accepts only whole row numbers and non-empty ids", () => {
    expect(rowNumber("12")).toBe(12);
    for (const bad of ["-1", "1.5", "", "1e3", " 2"]) expect(refusal(() => rowNumber(bad))).toMatch(/^invalid row: /);
    expect(refusal(() => batchId("  "))).toMatch(/^invalid batchId: /);
  });
});
