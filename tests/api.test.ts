/**
 * The API end to end, over HTTP, typed by the contract. These are the tests that say the back end
 * works: every flow a screen needs, driven the way the page drives it.
 */
import { connect } from "node:net";
import { networkInterfaces } from "node:os";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Res, Route } from "../shared/api.ts";
import { DEFAULT_ASSUMPTIONS, type Assumptions } from "../shared/assumptions.ts";
import type { BatchCar, BatchId, BatchView, CarCheck, CarReport, CarSummary, CheckedCar } from "../shared/cars.ts";
import type { ShopId } from "../shared/places.ts";
import type { Instant } from "../shared/time.ts";
import { startTestApp, type TestApp } from "./harness.ts";

vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 });

const HEADER = "car_id,last_node,next_node,reported_at,shop,prep_end";
const NOW = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000);
const at = (hours: number) => new Date(NOW.getTime() + hours * 3_600_000).toISOString() as Instant;
const ASOF = at(0);
const csv = (fileName: string, rows: string[]) => ({ kind: "csv" as const, fileName, text: `${HEADER}\n${rows.join("\n")}\n` });

/** One HTTP/1.1 request over a fresh socket, so the Host header can be anything a hostile page could send. */
function raw(port: number, path: string, host: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, "127.0.0.1");
    socket.write(`GET ${path} HTTP/1.1\r\nhost: ${host}\r\nconnection: close\r\n\r\n`);
    const chunks: Buffer[] = [];
    socket.on("data", (c) => chunks.push(c));
    socket.on("error", reject);
    socket.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      resolve({ status: Number(text.split(" ")[1]), body: text.slice(text.indexOf("\r\n\r\n") + 4) });
    });
  });
}

const checked = (check: CarCheck): CheckedCar => {
  if (check.outcome !== "checked") throw new Error(`cannot check: ${check.problems.map((p) => `${p.field}: ${p.message}`).join("; ")}`);
  return check;
};
/** The seeded EXAMPLE batch, whatever else has been uploaded since. */
const exampleBatchId = async (t: TestApp): Promise<BatchId> => {
  const batch = (await t.api("GET /api/batches")).find((b) => b.source.label.startsWith("EXAMPLE cars-"));
  if (!batch) throw new Error("no EXAMPLE batch");
  return batch.id;
};
const rowOf = (view: BatchView, carId: string): CarSummary => {
  const line = view.cars.find((c) => c.carId === carId);
  if (!line) throw new Error(`no row ${carId}`);
  return line;
};

let t: TestApp;
beforeAll(async () => {
  t = await startTestApp();
});
afterAll(async () => {
  await t.close();
});

describe("server", () => {
  it("listens on 127.0.0.1 only, and refuses a request whose Host is not loopback", async () => {
    const { port, hostname } = new URL(t.url);
    expect(hostname).toBe("127.0.0.1");
    expect((await raw(Number(port), "/api/meta", `127.0.0.1:${port}`)).status).toBe(200);
    for (const host of ["evil.example", `evil.example:${port}`, `192.168.1.20:${port}`]) {
      const answer = await raw(Number(port), "/api/meta", host);
      expect(answer.status, host).toBe(403);
      expect(JSON.parse(answer.body).error.kind).toBe("invalid");
    }
    const lan = Object.values(networkInterfaces())
      .flat()
      .find((i) => i && i.family === "IPv4" && !i.internal)?.address;
    if (lan) {
      await expect(
        new Promise((resolve, reject) => {
          const socket = connect(Number(port), lan, () => (socket.destroy(), resolve("connected")));
          socket.on("error", reject);
        }),
      ).rejects.toThrow(/ECONNREFUSED|EADDRNOTAVAIL|ENETUNREACH/);
    }
  });

  it("answers an unknown route with 404 and the error envelope; a malformed body with 400 and the field", async () => {
    const unknown = await fetch(`${t.url}/api/nothing`);
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ error: { kind: "not-found", message: "There is no GET /api/nothing.", field: null } });

    const malformed = await fetch(`${t.url}/api/check`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ report: { carId: "1", a: { kind: "lookup" } }, asOf: ASOF }),
    });
    expect(malformed.status).toBe(400);
    expect((await malformed.json()).error).toMatchObject({ kind: "invalid", field: "report.a.kind" });
    // The page's transport turns the envelope back into the same error.
    await expect(t.api("GET /api/batches/:batchId", { params: { batchId: "no-such-batch" } })).rejects.toMatchObject({ kind: "not-found" });
    await expect(t.api("PUT /api/assumptions", { body: { ...DEFAULT_ASSUMPTIONS, timing: { ...DEFAULT_ASSUMPTIONS.timing, speedKmPerDay: -1 } } })).rejects.toMatchObject({
      kind: "invalid",
      field: "timing.speedKmPerDay",
      message: "Speed must be more than 0 km/day.",
    });
  });

  it("every route in shared/api.ts answers (a smoke call per key of the handler table)", async () => {
    const s = await startTestApp();
    try {
      const batchId = await exampleBatchId(s);
      let shopId = "" as ShopId;
      let uploaded = "" as BatchId;
      const report: CarReport = {
        carId: "EXAMPLE 1",
        a: { kind: "text", text: "Taylor, TX" },
        b: { kind: "text", text: "Temple, TX" },
        shop: { kind: "text", text: "EX-NLR-01" },
        stops: [],
        reportedAt: at(0),
        prepEnd: at(40),
      };
      // Keyed by Route: a route added to the contract without a call here does not compile.
      const calls: { [R in Route]: () => Promise<Res<R>> } = {
        "GET /api/meta": () => s.api("GET /api/meta"),
        "GET /api/assumptions": () => s.api("GET /api/assumptions"),
        "PUT /api/assumptions": () => s.api("PUT /api/assumptions", { body: DEFAULT_ASSUMPTIONS }),
        "GET /api/import-profile": () => s.api("GET /api/import-profile"),
        "PUT /api/import-profile": async () => s.api("PUT /api/import-profile", { body: await s.api("GET /api/import-profile") }),
        "GET /api/places/suggest": () => s.api("GET /api/places/suggest", { query: { q: "temple", role: "position" } }),
        "POST /api/places/resolve": () => s.api("POST /api/places/resolve", { body: { ref: { kind: "text", text: "Temple, TX" }, role: "position" } }),
        "GET /api/places/nearest": () => s.api("GET /api/places/nearest", { query: { lon: -97.34, lat: 31.09, withinKm: 5 } }),
        "GET /api/shops": () => s.api("GET /api/shops"),
        "POST /api/shops": async () => {
          const shop = await s.api("POST /api/shops", { body: { name: "EXAMPLE smoke", code: "EX-SMOKE", location: { kind: "text", text: "Temple, TX" } } });
          shopId = shop.id;
          return shop;
        },
        "PUT /api/shops/:shopId": () => s.api("PUT /api/shops/:shopId", { params: { shopId }, body: { name: "EXAMPLE smoke 2", code: "EX-SMOKE", location: { kind: "text", text: "Waco, TX" } } }),
        "DELETE /api/shops/:shopId": () => s.api("DELETE /api/shops/:shopId", { params: { shopId } }),
        "POST /api/shops/import": () => s.api("POST /api/shops/import", { body: { source: { kind: "csv", fileName: "EXAMPLE shops.csv", text: "name,lon,lat\nEXAMPLE x,-97.34,31.09\n" }, commit: false } }),
        "GET /api/codes": () => s.api("GET /api/codes"),
        "POST /api/codes/import": () =>
          s.api("POST /api/codes/import", { body: { source: { kind: "csv", fileName: "EXAMPLE codes.csv", text: "code,fra_id\n1,358070\n" }, commit: true, codeType: "smoke", label: "Smoke" } }),
        "DELETE /api/codes/:codeType": () => s.api("DELETE /api/codes/:codeType", { params: { codeType: "smoke" } }),
        "GET /api/batches": () => s.api("GET /api/batches"),
        "POST /api/batches": async () => {
          const batch = await s.api("POST /api/batches", { body: { name: "EXAMPLE smoke", asOf: ASOF, source: csv("EXAMPLE smoke.csv", [`EXAMPLE 9,Taylor TX,Temple TX,${at(0)},EX-NLR-01,${at(9)}`]) } });
          uploaded = batch.id;
          return batch;
        },
        "GET /api/batches/:batchId": () => s.api("GET /api/batches/:batchId", { params: { batchId } }),
        "GET /api/batches/:batchId/cars/:row": () => s.api("GET /api/batches/:batchId/cars/:row", { params: { batchId, row: "0" } }),
        "PUT /api/batches/:batchId/cars/:row/fix": () =>
          s.api("PUT /api/batches/:batchId/cars/:row/fix", { params: { batchId, row: "0" }, body: { stops: [{ place: { kind: "text", text: "Fort Worth, TX" }, note: null }] } }),
        "DELETE /api/batches/:batchId/cars/:row/fix": () => s.api("DELETE /api/batches/:batchId/cars/:row/fix", { params: { batchId, row: "0" } }),
        "DELETE /api/batches/:batchId": () => s.api("DELETE /api/batches/:batchId", { params: { batchId: uploaded } }),
        "POST /api/check": () => s.api("POST /api/check", { body: { report, asOf: ASOF } }),
      };
      for (const [route, call] of Object.entries(calls)) {
        const answer = await (call as () => Promise<unknown>)().catch((error: Error) => `${route} failed: ${error.message}`);
        expect(typeof answer === "string" && answer.endsWith("failed") ? answer : "answered", route).toBe("answered");
        expect(answer, route).not.toEqual(expect.stringMatching(/ failed: /));
      }
    } finally {
      await s.close();
    }
  });

  it("knows it holds EXAMPLE data only until the user adds their own", async () => {
    const s = await startTestApp();
    try {
      const meta = await s.api("GET /api/meta");
      expect(meta).toMatchObject({ exampleOnly: true, railroads: ["BNSF", "UP", "CSXT", "NS", "CN", "CPKC"], graphVersion: expect.stringMatching(/^[0-9a-f]{12}$/) });
      expect(meta.storage).toBe(`${s.dataDir}/visnarn.db`);
      const shops = await s.api("GET /api/shops");
      expect(shops.map((shop) => [shop.code, shop.example])).toEqual(
        expect.arrayContaining([
          ["EX-NLR-01", true],
          ["EX-KCY-01", true],
        ]),
      );
      expect((await s.api("GET /api/batches")).map((b) => [b.name.startsWith("EXAMPLE "), b.example, b.rows])).toEqual([[true, true, 6]]);
      await s.api("POST /api/shops", { body: { name: "Temple shop", code: "TPL", location: { kind: "text", text: "Temple, TX" } } });
      expect((await s.api("GET /api/meta")).exampleOnly).toBe(false);
    } finally {
      await s.close();
    }
  });
});

describe("Route screen: check one car", () => {
  const exampleCar = (over: Partial<CarReport> = {}): CarReport => ({
    carId: "EXAMPLE 104233",
    a: { kind: "text", text: "Taylor, TX" },
    b: { kind: "text", text: "Temple, TX" },
    shop: { kind: "text", text: "EX-NLR-01" },
    stops: [],
    reportedAt: at(0),
    prepEnd: at(40),
    ...over,
  });

  it("POST /api/check on the EXAMPLE car is checked, with the pick first and steps from B to the shop", async () => {
    const check = checked(await t.api("POST /api/check", { body: { report: exampleCar(), asOf: ASOF } }));
    const [pick, ...others] = check.options;
    expect(pick.id).toBe("pick");
    expect(others.length).toBeGreaterThan(0);
    expect(pick.steps[0].kmFromB).toBe(0);
    expect(pick.steps.at(-1)).toMatchObject({ kind: "shop", eta: pick.verdict.arrival });
    expect(pick.steps.map((s) => s.kmFromB)).toEqual([...pick.steps.map((s) => s.kmFromB)].sort((x, y) => x - y));
    expect(pick.railroads).toEqual(["BNSF"]);
    expect(check.places.shop.ok && check.places.shop.place.label).toBe("North Little Rock, AR");
    // The router's pick turns back at Temple: such a route is never "On time" in the list.
    expect(pick.verdict.flags.map((f) => f.kind)).toContain("turn-back");
    expect(pick.verdict.group).not.toBe("ok");
    expect(check.assumptions.timing.basis).toEqual({ kind: "placeholder" });
    expect(Date.parse(pick.verdict.arrival.ifAtB)).toBeLessThan(Date.parse(pick.verdict.arrival.ifJustPastA));
  });

  it("B is optional: with no next node the car starts at A, and the route is flagged as direction unknown", async () => {
    const check = checked(await t.api("POST /api/check", { body: { report: exampleCar({ b: { kind: "text", text: "  " } }), asOf: ASOF } }));
    expect(check.places.b.ok && check.places.b.place.label).toBe("Taylor, TX");
    expect(check.approach.km).toBe(0);
    for (const option of check.options) {
      expect(option.verdict.flags.map((f) => f.kind)).toContain("direction-unknown");
      expect(option.verdict.group).not.toBe("ok");
    }
  });

  it("the same request twice gives the same answer, and the second does not route again", async () => {
    // A continental car not in the EXAMPLE batch: routing it four ways takes a while; a cached answer does not.
    const report = exampleCar({ carId: "EXAMPLE 777", a: { kind: "text", text: "Fresno, CA" }, b: { kind: "text", text: "Stockton, CA" }, shop: { kind: "text", text: "EX-BHM-01" } });
    const started = performance.now();
    const first = await t.api("POST /api/check", { body: { report, asOf: ASOF } });
    const routedMs = performance.now() - started;
    const again = performance.now();
    const second = await t.api("POST /api/check", { body: { report, asOf: ASOF } });
    const cachedMs = performance.now() - again;
    expect(second).toEqual(first);
    expect(checked(first).options[0].km).toBeGreaterThan(3000);
    expect(cachedMs).toBeLessThan(Math.max(50, routedMs / 4));
  });

  it("an unknown place is cannot-check naming the field, with HTTP 200", async () => {
    const answer = await fetch(`${t.url}/api/check`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ report: exampleCar({ b: { kind: "text", text: "Nowhere Junction" } }), asOf: ASOF }),
    });
    expect(answer.status).toBe(200);
    const check = (await answer.json()) as CarCheck;
    expect(check).toMatchObject({ outcome: "cannot-check", problems: [{ field: "b", message: expect.stringMatching(/Nothing called "Nowhere Junction"/) }] });
    expect(check).not.toHaveProperty("options");
    expect(check.places.a.ok).toBe(true);
  });

  it("a stop changes the route; the same report without stops is the 'before'", async () => {
    const before = checked(await t.api("POST /api/check", { body: { report: exampleCar(), asOf: ASOF } }));
    const withStop = checked(
      await t.api("POST /api/check", { body: { report: exampleCar({ stops: [{ place: { kind: "text", text: "Fort Worth, TX" }, note: "EXAMPLE stop" }] }), asOf: ASOF } }),
    );
    expect(withStop.options[0].km).not.toBe(before.options[0].km);
    expect(withStop.options[0].steps.find((s) => s.kind === "stop")).toMatchObject({ kind: "stop", stop: 0, label: "Fort Worth, TX" });
    expect(withStop.places.stops[0]).toMatchObject({ ok: true, place: { label: "Fort Worth, TX" } });
    expect(await t.api("POST /api/check", { body: { report: exampleCar(), asOf: ASOF } })).toEqual(before);
  });

  it("GET /api/places/suggest, POST /api/places/resolve and GET /api/places/nearest answer what the form and the map need", async () => {
    const suggestions = await t.api("GET /api/places/suggest", { query: { q: "north", role: "shop" } });
    expect(suggestions[0]).toMatchObject({ source: "shop", label: "North Little Rock, AR", detail: "Your shop · EXAMPLE · EX-NLR-01", ref: { kind: "shop" } });
    expect(suggestions.some((s) => s.source === "city")).toBe(true);
    expect(await t.api("GET /api/places/suggest", { query: { q: "", role: "shop" } })).toEqual([]);

    const found = await t.api("POST /api/places/resolve", { body: { ref: { kind: "text", text: "EX-KCY-01" }, role: "shop" } });
    expect(found).toMatchObject({ ok: true, place: { label: "Kansas City, MO", match: { method: "shop" }, railroads: expect.arrayContaining(["BNSF", "UP"]) } });
    const number = await t.api("POST /api/places/resolve", { body: { ref: { kind: "text", text: "358070" }, role: "position" } });
    expect(number).toMatchObject({ ok: false, problem: { kind: "unknown" } });
    const fra = await t.api("POST /api/places/resolve", { body: { ref: { kind: "text", text: "FRA 358070" }, role: "position" } });
    expect(fra).toMatchObject({ ok: true, place: { fraId: 358070, label: "Temple, TX" } });

    expect(await t.api("GET /api/places/nearest", { query: { lon: -97.34, lat: 31.09, withinKm: 5 } })).toMatchObject({ fraId: 358070, near: "Temple, TX", railroads: ["BNSF", "UP"] });
    expect(await t.api("GET /api/places/nearest", { query: { lon: -90, lat: 25, withinKm: 5 } })).toBeNull();
    await expect(t.api("GET /api/places/nearest", { query: { lon: -90, lat: 95, withinKm: 5 } })).rejects.toMatchObject({ kind: "invalid", field: "lat" });
  });
});

describe("Cars screen: the morning list", () => {
  let c: TestApp;
  beforeAll(async () => {
    c = await startTestApp();
  });
  afterAll(async () => {
    await c.close();
  });
  afterEach(async () => {
    await c.api("PUT /api/assumptions", { body: DEFAULT_ASSUMPTIONS });
  });

  const morning = () =>
    csv("EXAMPLE morning.csv", [
      `EXAMPLE 1,"Tucson, AZ","Phoenix, AZ",${at(-2)},EX-CHI-01,${at(30)}`,
      `EXAMPLE 2,"Omaha, NE","Lincoln, NE",${at(-1)},EX-KCY-01,${at(90)}`,
      `EXAMPLE 3,"Dallas, TX","Fort Worth, TX",not a time,EX-NLR-01,${at(50)}`,
    ]);

  it("POST /api/batches reads the CSV and reports rows and issues; the same upload again returns the same batch", async () => {
    const batch = await c.api("POST /api/batches", { body: { name: "EXAMPLE Tuesday", asOf: ASOF, source: morning() } });
    expect(batch).toMatchObject({ name: "EXAMPLE Tuesday", rows: 3, asOf: ASOF, source: { kind: "csv", label: "EXAMPLE morning.csv" }, example: true });
    expect(batch.issues).toEqual([{ row: 2, line: 4, field: "reportedAt", message: expect.stringMatching(/"not a time" is not a time/) }]);
    const again = await c.api("POST /api/batches", { body: { name: "EXAMPLE Tuesday again", asOf: ASOF, source: { ...morning(), fileName: "copy.csv" } } });
    expect(again).toEqual(batch);
    expect((await c.api("GET /api/batches")).filter((b) => b.id === batch.id)).toHaveLength(1);
    await expect(c.api("POST /api/batches", { body: { name: "x", asOf: ASOF, source: { kind: "csv", fileName: "bad.csv", text: "car_id\n1\n" } } })).rejects.toMatchObject({
      kind: "invalid",
      message: expect.stringMatching(/^bad\.csv has no columns "last_node"/),
    });
  });

  it("GET /api/batches/:id starts with pending rows and settles with every row grouped", async () => {
    const batch = await c.api("POST /api/batches", { body: { name: "EXAMPLE Wednesday", asOf: at(1), source: morning() } });
    const first = await c.api("GET /api/batches/:batchId", { params: { batchId: batch.id } });
    expect(first.progress.total).toBe(3);
    expect(first.progress.checked).toBeLessThan(3);
    expect(first.cars.filter((car) => car.check.outcome === "pending").every((car) => car.group === null)).toBe(true);
    // Pending rows come last, never as OK.
    expect(first.cars.at(-1)?.check.outcome).toBe("pending");
    const done = await c.settled(batch.id);
    expect(done.cars.every((car) => car.check.outcome !== "pending" && car.group !== null)).toBe(true);
    const order = ["act-now", "check-first", "ok"];
    expect(done.cars.map((car) => order.indexOf(car.group!))).toEqual(done.cars.map((car) => order.indexOf(car.group!)).sort());
  });

  it("a row the import could not read is cannot-check in check-first, never ok", async () => {
    const batch = await c.api("POST /api/batches", { body: { name: "EXAMPLE Thursday", asOf: at(2), source: morning() } });
    const view = await c.settled(batch.id);
    const broken = rowOf(view, "EXAMPLE 3");
    expect(broken.group).toBe("check-first");
    expect(broken.check).toEqual({ outcome: "cannot-check", problems: [{ field: "reportedAt", message: expect.stringMatching(/"not a time"/) }] });
  });

  it("PUT /api/assumptions with a new speed re-sorts the list at once (no pending rows)", async () => {
    const batchId = await exampleBatchId(c);
    const before = await c.settled(batchId);
    const fast: Assumptions = { ...DEFAULT_ASSUMPTIONS, timing: { ...DEFAULT_ASSUMPTIONS.timing, speedKmPerDay: 2000 } };
    expect(await c.api("PUT /api/assumptions", { body: fast })).toEqual(fast);
    const after = await c.api("GET /api/batches/:batchId", { params: { batchId } });
    expect(after.progress).toEqual({ checked: 6, total: 6 });
    const groups = (view: BatchView) => view.cars.map((car) => `${car.carId}:${car.group}`);
    expect(groups(after)).not.toEqual(groups(before));
    expect(after.cars.filter((car) => car.group === "act-now").length).toBeGreaterThan(before.cars.filter((car) => car.group === "act-now").length);
  });

  it("PUT …/fix marks the row 'Route set by you' and changes its summary; DELETE …/fix restores it", async () => {
    const batchId = await exampleBatchId(c);
    const before = rowOf(await c.settled(batchId), "EXAMPLE 104233");
    const params = { batchId, row: String(before.row) };
    const stops = [{ place: { kind: "text" as const, text: "Fort Worth, TX" }, note: "EXAMPLE stop" }];
    const fix = await c.api("PUT /api/batches/:batchId/cars/:row/fix", { params, body: { stops } });
    expect(fix.stops).toEqual(stops);
    // Saving the stops already in force changes nothing.
    expect(await c.api("PUT /api/batches/:batchId/cars/:row/fix", { params, body: { stops } })).toEqual(fix);

    const fixed = rowOf(await c.settled(batchId), "EXAMPLE 104233");
    expect(fixed.fixed).toBe(true);
    expect(fixed.check.outcome === "checked" && before.check.outcome === "checked" && fixed.check.km !== before.check.km).toBe(true);
    const row: BatchCar = await c.api("GET /api/batches/:batchId/cars/:row", { params });
    expect(row).toMatchObject({ row: before.row, fix, report: { stops } });

    expect(await c.api("DELETE /api/batches/:batchId/cars/:row/fix", { params })).toBeNull();
    expect(rowOf(await c.settled(batchId), "EXAMPLE 104233")).toEqual(before);
    expect((await c.api("GET /api/batches/:batchId/cars/:row", { params })).fix).toBeNull();
    await expect(c.api("PUT /api/batches/:batchId/cars/:row/fix", { params: { batchId, row: "99" }, body: { stops } })).rejects.toMatchObject({ kind: "not-found" });
  });

  it("summaries carry no geometry; GET …/cars/:row then POST /api/check gives the route", async () => {
    const batchId = await exampleBatchId(c);
    const view = await c.settled(batchId);
    expect(JSON.stringify(view)).not.toMatch(/"(path|paths|legs|steps)":/);
    const line = view.cars[0];
    const row = await c.api("GET /api/batches/:batchId/cars/:row", { params: { batchId, row: String(line.row) } });
    expect(row.report.carId).toBe(line.carId);
    const check = checked(await c.api("POST /api/check", { body: { report: row.report, asOf: row.batch.asOf } }));
    expect(check.options[0].legs[0].path.length).toBeGreaterThan(1);
    expect(line.check.outcome === "checked" && line.check.verdict).toEqual(check.options[0].verdict);
    expect(line.check.outcome === "checked" && line.check.positionAgeH).toBe(check.positionAgeH);
  });

  it("DELETE /api/batches/:id removes it; reading it again is not-found", async () => {
    const batch = await c.api("POST /api/batches", { body: { name: "EXAMPLE Friday", asOf: at(3), source: morning() } });
    expect(await c.api("DELETE /api/batches/:batchId", { params: { batchId: batch.id } })).toBeNull();
    await expect(c.api("GET /api/batches/:batchId", { params: { batchId: batch.id } })).rejects.toMatchObject({ kind: "not-found" });
    await expect(c.api("DELETE /api/batches/:batchId", { params: { batchId: batch.id } })).rejects.toMatchObject({ kind: "not-found" });
  });
});

describe("Shops screen", () => {
  let s: TestApp;
  beforeAll(async () => {
    s = await startTestApp();
  });
  afterAll(async () => {
    await s.close();
  });

  it("POST, PUT, DELETE /api/shops; 'On lines' comes from the network", async () => {
    const created = await s.api("POST /api/shops", { body: { name: "EXAMPLE Temple shop", code: "EX-TPL-01", location: { kind: "text", text: "FRA 358070" } } });
    expect(created).toMatchObject({ name: "EXAMPLE Temple shop", code: "EX-TPL-01", location: { fraId: 358070, railroad: null }, example: false });
    expect(created.place).toMatchObject({ ok: true, place: { railroads: ["BNSF", "UP"] } });
    const moved = await s.api("PUT /api/shops/:shopId", { params: { shopId: created.id }, body: { name: "EXAMPLE Waco shop", code: "EX-TPL-01", location: { kind: "text", text: "Waco, TX" } } });
    expect(moved).toMatchObject({ id: created.id, name: "EXAMPLE Waco shop", location: { lon: expect.any(Number), lat: expect.any(Number) } });
    expect((await s.api("GET /api/shops")).find((shop) => shop.id === created.id)?.name).toBe("EXAMPLE Waco shop");
    expect(await s.api("DELETE /api/shops/:shopId", { params: { shopId: created.id } })).toBeNull();
    expect((await s.api("GET /api/shops")).some((shop) => shop.id === created.id)).toBe(false);
    await expect(s.api("DELETE /api/shops/:shopId", { params: { shopId: created.id } })).rejects.toMatchObject({ kind: "not-found" });
  });

  it("a shop off the network is refused with the field at fault; a duplicate code is a conflict", async () => {
    await expect(s.api("POST /api/shops", { body: { name: "EXAMPLE at sea", code: null, location: { kind: "coord", lon: -90, lat: 25 } } })).rejects.toMatchObject({
      kind: "invalid",
      field: "location",
      message: expect.stringMatching(/15 km/),
    });
    await expect(s.api("POST /api/shops", { body: { name: "", code: null, location: { kind: "text", text: "Waco, TX" } } })).rejects.toMatchObject({ kind: "invalid", field: "name" });
    await expect(s.api("POST /api/shops", { body: { name: "EXAMPLE copy", code: "ex-nlr-01", location: { kind: "text", text: "Waco, TX" } } })).rejects.toMatchObject({
      kind: "conflict",
      field: "code",
    });
  });

  it("POST /api/shops/import previews without saving, then saves; a second commit changes nothing", async () => {
    const source = { kind: "csv" as const, fileName: "EXAMPLE shops.csv", text: "name,node_code,lon,lat\nEXAMPLE Pueblo,EX-PUB-01,-104.61,38.27\nEXAMPLE sea,EX-SEA-01,-90,25\n" };
    const count = async () => (await s.api("GET /api/shops")).length;
    const before = await count();
    const preview = await s.api("POST /api/shops/import", { body: { source, commit: false } });
    expect(preview).toMatchObject({ committed: false, ready: [{ name: "EXAMPLE Pueblo", code: "EX-PUB-01", place: { ok: true } }], issues: [{ line: 3 }] });
    expect(await count()).toBe(before);
    const saved = await s.api("POST /api/shops/import", { body: { source, commit: true } });
    expect(saved.committed).toBe(true);
    expect(await count()).toBe(before + 1);
    const again = await s.api("POST /api/shops/import", { body: { source, commit: true } });
    expect(again.ready.map((shop) => shop.id)).toEqual(saved.ready.map((shop) => shop.id));
    expect(await count()).toBe(before + 1);
  });

  it("adding the missing shop turns a cannot-check row into a checked one without a new upload", async () => {
    const batch = await s.api("POST /api/batches", {
      body: { name: "EXAMPLE missing shop", asOf: ASOF, source: csv("EXAMPLE missing.csv", [`EXAMPLE 5,"Taylor, TX","Temple, TX",${at(0)},EX-NEW-01,${at(60)}`]) },
    });
    const [missing] = (await s.settled(batch.id)).cars;
    expect(missing).toMatchObject({ shop: "EX-NEW-01", group: "check-first", check: { outcome: "cannot-check", problems: [{ field: "shop" }] } });
    await s.api("POST /api/shops", { body: { name: "EXAMPLE new shop", code: "EX-NEW-01", location: { kind: "text", text: "Dallas, TX" } } });
    const [found] = (await s.settled(batch.id)).cars;
    expect(found).toMatchObject({ shop: "EXAMPLE new shop", check: { outcome: "checked" } });
  });

  it("POST /api/codes/import, then a batch whose profile names that code set resolves by code", async () => {
    const codes = { kind: "csv" as const, fileName: "EXAMPLE stations.csv", text: "code,name,fra_id,lon,lat\n100001,EXAMPLE Taylor,,-97.41,30.57\n100002,EXAMPLE Temple,358070,,\n" };
    const imported = await s.api("POST /api/codes/import", { body: { source: codes, commit: true, codeType: "station", label: "Station" } });
    expect(imported).toMatchObject({ committed: true, issues: [], ready: [{ code: "100001" }, { code: "100002", location: { fraId: 358070 } }] });
    expect(await s.api("GET /api/codes")).toMatchObject([{ codeType: "station", label: "Station", count: 2 }]);

    const profile = await s.api("GET /api/import-profile");
    await s.api("PUT /api/import-profile", { body: { ...profile, positions: { codeType: "station" } } });
    const batch = await s.api("POST /api/batches", {
      body: { name: "EXAMPLE by code", asOf: ASOF, source: csv("EXAMPLE codes.csv", [`EXAMPLE 6,100001,100002,${at(0)},EX-NLR-01,${at(60)}`]) },
    });
    const [line] = (await s.settled(batch.id)).cars;
    expect(line.check.outcome).toBe("checked");
    const row = await s.api("GET /api/batches/:batchId/cars/:row", { params: { batchId: batch.id, row: "0" } });
    expect(row.report.a).toEqual({ kind: "code", codeType: "station", code: "100001" });
    const check = checked(await s.api("POST /api/check", { body: { report: row.report, asOf: ASOF } }));
    expect(check.places.b).toMatchObject({ ok: true, place: { label: "EXAMPLE Temple", fraId: 358070, match: { method: "code", codeType: "station" } } });

    await s.api("DELETE /api/codes/:codeType", { params: { codeType: "station" } });
    const [lost] = (await s.settled(batch.id)).cars;
    expect(lost.check).toMatchObject({ outcome: "cannot-check", problems: [{ field: "a" }, { field: "b" }] });
    await s.api("PUT /api/import-profile", { body: profile });
  });

  it("refuses an import profile that reads one column twice", async () => {
    const profile = await s.api("GET /api/import-profile");
    await expect(s.api("PUT /api/import-profile", { body: { ...profile, columns: { ...profile.columns, b: "LAST_NODE" } } })).rejects.toMatchObject({
      kind: "invalid",
      field: "columns.b",
    });
  });
});

describe("restart", () => {
  it("a new server on the same data folder has the shops, batches, fixes and assumptions; routes are computed again", async () => {
    const first = await startTestApp();
    const exampleId = await exampleBatchId(first);
    const shop = await first.api("POST /api/shops", { body: { name: "Temple shop", code: "TPL-1", location: { kind: "text", text: "FRA 358070" } } });
    const mineBatch = await first.api("POST /api/batches", {
      body: { name: "Tuesday", asOf: ASOF, source: csv("tuesday.csv", [`1,"Fresno, CA","Stockton, CA",${at(0)},TPL-1,${at(90)}`, `2,"Austin, TX","Taylor, TX",${at(0)},TPL-1,${at(9)}`]) },
    });
    const batchId = mineBatch.id;
    await first.settled(batchId);
    const stops = [{ place: { kind: "text" as const, text: "Fort Worth, TX" }, note: null }];
    await first.api("PUT /api/batches/:batchId/cars/:row/fix", { params: { batchId, row: "1" }, body: { stops } });
    const mine: Assumptions = { ...DEFAULT_ASSUMPTIONS, timing: { ...DEFAULT_ASSUMPTIONS.timing, bufferH: 12 } };
    await first.api("PUT /api/assumptions", { body: mine });
    // The user deletes every EXAMPLE shop: they must not come back on the next start.
    for (const example of (await first.api("GET /api/shops")).filter((s) => s.example)) {
      await first.api("DELETE /api/shops/:shopId", { params: { shopId: example.id } });
    }
    await first.close({ keepData: true });

    const second = await startTestApp({ dataDir: first.dataDir });
    try {
      expect((await second.api("GET /api/shops")).map((s) => s.id)).toEqual([shop.id]);
      expect((await second.api("GET /api/batches")).map((b) => b.id)).toEqual([batchId, exampleId]);
      expect(await second.api("GET /api/assumptions")).toEqual(mine);
      expect((await second.api("GET /api/batches/:batchId/cars/:row", { params: { batchId, row: "1" } })).fix?.stops).toEqual(stops);
      // Routes are not stored: the first read after a restart finds them pending again.
      const reopened = await second.api("GET /api/batches/:batchId", { params: { batchId } });
      expect(reopened.progress).toEqual({ checked: 0, total: 2 });
      const settled = await second.settled(batchId);
      expect(settled.cars.every((c) => c.check.outcome === "checked")).toBe(true);
      expect(settled.cars.find((c) => c.row === 1)?.fixed).toBe(true);
      // The EXAMPLE shops are gone, so the EXAMPLE rows that named them cannot be checked.
      const example = await second.settled(exampleId);
      expect(example.cars.every((c) => c.check.outcome === "cannot-check" && c.check.problems[0].field === "shop")).toBe(true);
      expect((await second.api("GET /api/meta")).exampleOnly).toBe(false);
    } finally {
      await second.close();
    }
  });
});
