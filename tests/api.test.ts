/**
 * The API end to end, over HTTP, typed by the contract. These are the tests that say the back end
 * works: every flow a screen needs, driven the way the page drives it.
 */
import { connect } from "node:net";
import { networkInterfaces } from "node:os";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Res, Route } from "../shared/api.ts";
import { DEFAULT_ASSUMPTIONS, type Assumptions } from "../shared/assumptions.ts";
import type { FraId, PlaceRef, ShopId } from "../shared/places.ts";
import type { FullPlan, Plan, PlannedRoute, SavedRouteDraft, SavedRouteId } from "../shared/plans.ts";
import { startTestApp, type TestApp } from "./harness.ts";

vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 });

const text = (t: string): PlaceRef => ({ kind: "text", text: t });
const plan = (start: PlaceRef | null, destination: PlaceRef | null, stops: PlaceRef[] = []): Plan => ({ start, stops, destination });
const TAYLOR_TO_NLR: FullPlan = { start: text("Taylor, TX"), stops: [], destination: text("EX-NLR-01") };
/** The Temple wye, where BNSF and UP meet. */
const WYE = 358070 as FraId;

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

const routed = (answer: PlannedRoute) => {
  if (answer.outcome !== "routed") throw new Error(`not routed: ${answer.outcome}${answer.outcome === "no-route" ? ` (${answer.problem.message})` : ""}`);
  return answer;
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

    const malformed = await fetch(`${t.url}/api/route`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ start: { kind: "lookup" }, stops: [], destination: null }),
    });
    expect(malformed.status).toBe(400);
    expect((await malformed.json()).error).toMatchObject({ kind: "invalid", field: "start.kind" });
    // The page's transport turns the envelope back into the same error.
    await expect(t.api("DELETE /api/saved-routes/:routeId", { params: { routeId: "no-such-route" } })).rejects.toMatchObject({ kind: "not-found" });
    await expect(t.api("PUT /api/assumptions", { body: { ...DEFAULT_ASSUMPTIONS, timing: { ...DEFAULT_ASSUMPTIONS.timing, speedKmPerDay: -1 } } })).rejects.toMatchObject({
      kind: "invalid",
      field: "timing.speedKmPerDay",
      message: "Speed must be more than 0 km/day.",
    });
  });

  it("every route in shared/api.ts answers (a smoke call per key of the handler table)", async () => {
    const s = await startTestApp();
    try {
      let shopId = "" as ShopId;
      let routeId = "" as SavedRouteId;
      const draft: SavedRouteDraft = { name: "EXAMPLE smoke", plan: { start: text("Taylor, TX"), stops: [], destination: text("Waco, TX") }, option: null };
      // Keyed by Route: a route added to the contract without a call here does not compile.
      const calls: { [R in Route]: () => Promise<Res<R>> } = {
        "GET /api/meta": () => s.api("GET /api/meta"),
        "GET /api/assumptions": () => s.api("GET /api/assumptions"),
        "PUT /api/assumptions": () => s.api("PUT /api/assumptions", { body: DEFAULT_ASSUMPTIONS }),
        "GET /api/places/suggest": () => s.api("GET /api/places/suggest", { query: { q: "temple", role: "position" } }),
        "POST /api/places/resolve": () => s.api("POST /api/places/resolve", { body: { ref: text("Temple, TX"), role: "position" } }),
        "GET /api/places/nearest": () => s.api("GET /api/places/nearest", { query: { lon: -97.34, lat: 31.09, withinKm: 5 } }),
        "GET /api/shops": () => s.api("GET /api/shops"),
        "POST /api/shops": async () => {
          const shop = await s.api("POST /api/shops", { body: { name: "EXAMPLE smoke", code: "EX-SMOKE", location: text("Temple, TX") } });
          shopId = shop.id;
          return shop;
        },
        "PUT /api/shops/:shopId": () => s.api("PUT /api/shops/:shopId", { params: { shopId }, body: { name: "EXAMPLE smoke 2", code: "EX-SMOKE", location: text("Waco, TX") } }),
        "DELETE /api/shops/:shopId": () => s.api("DELETE /api/shops/:shopId", { params: { shopId } }),
        "POST /api/shops/import": () => s.api("POST /api/shops/import", { body: { source: { kind: "csv", fileName: "EXAMPLE shops.csv", text: "name,lon,lat\nEXAMPLE x,-97.34,31.09\n" }, commit: false } }),
        "GET /api/codes": () => s.api("GET /api/codes"),
        "POST /api/codes/import": () =>
          s.api("POST /api/codes/import", { body: { source: { kind: "csv", fileName: "EXAMPLE codes.csv", text: "code,fra_id\n1,358070\n" }, commit: true, codeType: "smoke", label: "Smoke" } }),
        "DELETE /api/codes/:codeType": () => s.api("DELETE /api/codes/:codeType", { params: { codeType: "smoke" } }),
        "POST /api/route": () => s.api("POST /api/route", { body: draft.plan }),
        "GET /api/saved-routes": () => s.api("GET /api/saved-routes"),
        "POST /api/saved-routes": async () => {
          const saved = await s.api("POST /api/saved-routes", { body: draft });
          routeId = saved.id;
          return saved;
        },
        "PUT /api/saved-routes/:routeId": () => s.api("PUT /api/saved-routes/:routeId", { params: { routeId }, body: { ...draft, name: "EXAMPLE smoke 2" } }),
        "DELETE /api/saved-routes/:routeId": () => s.api("DELETE /api/saved-routes/:routeId", { params: { routeId } }),
      };
      expect(Object.keys(calls)).toHaveLength(19);
      for (const [route, call] of Object.entries(calls)) {
        const answer = await (call as () => Promise<unknown>)().catch((error: Error) => `${route} failed: ${error.message}`);
        expect(answer, route).not.toEqual(expect.stringMatching(/ failed: /));
      }
    } finally {
      await s.close();
    }
  });

  it("knows it holds EXAMPLE data only until the user adds their own: a shop, or a saved route", async () => {
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
      expect(await s.api("GET /api/saved-routes")).toEqual([]);
      const saved = await s.api("POST /api/saved-routes", { body: { name: "Taylor → NLR", plan: { start: text("Taylor, TX"), stops: [], destination: text("EX-NLR-01") }, option: null } });
      expect((await s.api("GET /api/meta")).exampleOnly).toBe(false);
      await s.api("DELETE /api/saved-routes/:routeId", { params: { routeId: saved.id } });
      expect((await s.api("GET /api/meta")).exampleOnly).toBe(true);
      await s.api("POST /api/shops", { body: { name: "Temple shop", code: "TPL", location: text("Temple, TX") } });
      expect((await s.api("GET /api/meta")).exampleOnly).toBe(false);
    } finally {
      await s.close();
    }
  });
});

describe("Route screen: plan a route", () => {
  it("a plan with only a start is incomplete, with the start resolved; an unknown place stays unresolved", async () => {
    const partial = await t.api("POST /api/route", { body: plan(text("Kansas City, MO"), null) });
    expect(partial).toMatchObject({ outcome: "incomplete", places: { start: { ok: true, place: { label: "Kansas City, MO" } }, stops: [], destination: null } });
    const unknown = await t.api("POST /api/route", { body: plan(text("Taylor, TX"), text("Nowhere Junction XYZ")) });
    expect(unknown).toMatchObject({ outcome: "incomplete", places: { destination: { ok: false, problem: { kind: "unknown" } } } });
  });

  it("routes the EXAMPLE plan the same way twice, the router's own route first, with no clock in the answer", async () => {
    const first = routed(await t.api("POST /api/route", { body: TAYLOR_TO_NLR }));
    expect(first.routes[0].strategies[0]).toBe("pick");
    expect(first.places.destination).toMatchObject({ ok: true, place: { label: "North Little Rock, AR", match: { method: "shop" }, example: true } });
    expect(await t.api("POST /api/route", { body: TAYLOR_TO_NLR })).toEqual(first);
    const json = JSON.stringify(first);
    for (const key of ["eta", "verdict", "arrival", "marginH"]) expect(json).not.toContain(`"${key}"`);
  });

  it("a stop with a line chosen keeps the route on that line there", async () => {
    const answer = routed(await t.api("POST /api/route", { body: plan(text("Taylor, TX"), text("EX-NLR-01"), [{ kind: "node", fraId: WYE, railroad: "UP" }]) }));
    for (const route of answer.routes) {
      const stop = route.steps.find((step) => step.kind === "stop");
      const leg = route.steps.filter((step) => step.kind === "leg" && step.kmFromB <= (stop?.kmFromB ?? 0)).at(-1);
      expect(leg?.kind === "leg" && route.legs[leg.leg].railroad, route.strategies[0]).toBe("UP");
    }
  });

  it("no route is said at the place it breaks, in the plan's words", async () => {
    await t.api("PUT /api/assumptions", { body: { ...DEFAULT_ASSUMPTIONS, routing: { ...DEFAULT_ASSUMPTIONS.routing, allowed: ["UP"] } } });
    try {
      const answer = await t.api("POST /api/route", { body: plan(text("Houston, TX"), text("Pasco, WA")) });
      expect(answer).toMatchObject({ outcome: "no-route", problem: { at: "destination", message: "No allowed track reaches here from the place before." } });
    } finally {
      await t.api("PUT /api/assumptions", { body: DEFAULT_ASSUMPTIONS });
    }
  });

  it("GET /api/places/suggest, POST /api/places/resolve and GET /api/places/nearest answer what the fields and the map need", async () => {
    const suggestions = await t.api("GET /api/places/suggest", { query: { q: "north", role: "shop" } });
    expect(suggestions[0]).toMatchObject({ source: "shop", label: "North Little Rock, AR", detail: "Your shop · EXAMPLE · EX-NLR-01", ref: { kind: "shop" } });
    expect(suggestions.some((s) => s.source === "city")).toBe(true);
    expect(await t.api("GET /api/places/suggest", { query: { q: "", role: "shop" } })).toEqual([]);

    const found = await t.api("POST /api/places/resolve", { body: { ref: text("EX-KCY-01"), role: "shop" } });
    expect(found).toMatchObject({ ok: true, place: { label: "Kansas City, MO", match: { method: "shop" }, railroads: expect.arrayContaining(["BNSF", "UP"]) } });
    const number = await t.api("POST /api/places/resolve", { body: { ref: text("358070"), role: "position" } });
    expect(number).toMatchObject({ ok: false, problem: { kind: "unknown" } });
    const fra = await t.api("POST /api/places/resolve", { body: { ref: text("FRA 358070"), role: "position" } });
    expect(fra).toMatchObject({ ok: true, place: { fraId: 358070, label: "Temple, TX" } });

    expect(await t.api("GET /api/places/nearest", { query: { lon: -97.34, lat: 31.09, withinKm: 5 } })).toMatchObject({ fraId: 358070, near: "Temple, TX", railroads: ["BNSF", "UP"] });
    expect(await t.api("GET /api/places/nearest", { query: { lon: -90, lat: 25, withinKm: 5 } })).toBeNull();
    await expect(t.api("GET /api/places/nearest", { query: { lon: -90, lat: 95, withinKm: 5 } })).rejects.toMatchObject({ kind: "invalid", field: "lat" });
  });
});

describe("Route screen: saved routes", () => {
  it("saves, lists by name, saves unchanged, replaces, removes; an unknown id is not-found and a blank name invalid", async () => {
    const draft = (name: string): SavedRouteDraft => ({ name, plan: TAYLOR_TO_NLR, option: "shortest" });
    const zulu = await t.api("POST /api/saved-routes", { body: draft("zulu → somewhere") });
    const alpha = await t.api("POST /api/saved-routes", { body: draft("Alpha → somewhere") });
    expect(alpha).toMatchObject({ name: "Alpha → somewhere", option: "shortest", plan: TAYLOR_TO_NLR });
    expect((await t.api("GET /api/saved-routes")).map((r) => r.name)).toEqual(["Alpha → somewhere", "zulu → somewhere"]);
    expect(await t.api("PUT /api/saved-routes/:routeId", { params: { routeId: alpha.id }, body: draft("Alpha → somewhere") })).toEqual(alpha);
    const renamed = await t.api("PUT /api/saved-routes/:routeId", { params: { routeId: alpha.id }, body: { ...draft("Alpha via Temple"), option: null } });
    expect(renamed).toMatchObject({ id: alpha.id, name: "Alpha via Temple", option: null });

    await expect(t.api("PUT /api/saved-routes/:routeId", { params: { routeId: "nope" }, body: draft("x") })).rejects.toMatchObject({ kind: "not-found" });
    await expect(t.api("POST /api/saved-routes", { body: draft("   ") })).rejects.toMatchObject({ kind: "invalid", field: "name" });
    for (const id of [alpha.id, zulu.id]) expect(await t.api("DELETE /api/saved-routes/:routeId", { params: { routeId: id } })).toBeNull();
    expect(await t.api("GET /api/saved-routes")).toEqual([]);
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

  it("adding the missing shop turns an incomplete plan into a routed one", async () => {
    const missing = await s.api("POST /api/route", { body: plan(text("Taylor, TX"), text("EX-NEW-01")) });
    expect(missing).toMatchObject({ outcome: "incomplete", places: { destination: { ok: false } } });
    await s.api("POST /api/shops", { body: { name: "EXAMPLE new shop", code: "EX-NEW-01", location: text("Dallas, TX") } });
    const found = routed(await s.api("POST /api/route", { body: plan(text("Taylor, TX"), text("EX-NEW-01")) }));
    expect(found.places.destination).toMatchObject({ ok: true, place: { label: "EXAMPLE new shop" } });
  });

  it("POST /api/codes/import: a code of that set then names a place on a route; removing the set unnames it", async () => {
    const codes = { kind: "csv" as const, fileName: "EXAMPLE stations.csv", text: "code,name,fra_id,lon,lat\n100001,EXAMPLE Taylor,,-97.41,30.57\n100002,EXAMPLE Temple,358070,,\n" };
    const imported = await s.api("POST /api/codes/import", { body: { source: codes, commit: true, codeType: "station", label: "Station" } });
    expect(imported).toMatchObject({ committed: true, issues: [], ready: [{ code: "100001" }, { code: "100002", location: { fraId: 358070 } }] });
    expect(await s.api("GET /api/codes")).toMatchObject([{ codeType: "station", label: "Station", count: 2 }]);

    const byCode = plan(text("100001"), text("EX-NLR-01"), [{ kind: "code", codeType: "station", code: "100002" }]);
    const answer = routed(await s.api("POST /api/route", { body: byCode }));
    expect(answer.places.stops[0]).toMatchObject({ ok: true, place: { label: "EXAMPLE Temple", fraId: 358070, match: { method: "code", codeType: "station" } } });

    await s.api("DELETE /api/codes/:codeType", { params: { codeType: "station" } });
    expect(await s.api("POST /api/route", { body: byCode })).toMatchObject({ outcome: "incomplete" });
  });
});

describe("restart", () => {
  it("a new server on the same data folder has the shops, the saved routes and the routing rules; routes are worked out again", async () => {
    const first = await startTestApp();
    const shop = await first.api("POST /api/shops", { body: { name: "Temple shop", code: "TPL-1", location: text("FRA 358070") } });
    const saved = await first.api("POST /api/saved-routes", { body: { name: "Taylor → Temple shop", plan: { start: text("Taylor, TX"), stops: [], destination: { kind: "shop", shopId: shop.id } }, option: null } });
    const mine: Assumptions = { ...DEFAULT_ASSUMPTIONS, routing: { ...DEFAULT_ASSUMPTIONS.routing, interchangePenaltyKm: 300 } };
    await first.api("PUT /api/assumptions", { body: mine });
    // The user deletes every EXAMPLE shop: they must not come back on the next start.
    for (const example of (await first.api("GET /api/shops")).filter((s) => s.example)) {
      await first.api("DELETE /api/shops/:shopId", { params: { shopId: example.id } });
    }
    await first.close({ keepData: true });

    const second = await startTestApp({ dataDir: first.dataDir });
    try {
      expect((await second.api("GET /api/shops")).map((s) => s.id)).toEqual([shop.id]);
      expect(await second.api("GET /api/saved-routes")).toEqual([saved]);
      expect(await second.api("GET /api/assumptions")).toEqual(mine);
      const reopened = routed(await second.api("POST /api/route", { body: saved.plan }));
      expect(reopened.places.destination).toMatchObject({ ok: true, place: { label: "Temple shop" } });
      // A saved route naming a deleted shop says so at that place.
      await second.api("DELETE /api/shops/:shopId", { params: { shopId: shop.id } });
      expect(await second.api("POST /api/route", { body: saved.plan })).toMatchObject({ outcome: "incomplete", places: { destination: { ok: false, problem: { kind: "removed" } } } });
      expect((await second.api("GET /api/meta")).exampleOnly).toBe(false);
    } finally {
      await second.close();
    }
  });
});
