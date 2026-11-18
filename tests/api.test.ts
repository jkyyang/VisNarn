/**
 * The API end to end, over HTTP, typed by the contract. These are the tests that say the back end
 * works: every flow a screen needs, driven the way the page drives it.
 */
import { connect } from "node:net";
import { networkInterfaces } from "node:os";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Res, Route } from "../shared/api.ts";
import type { FraId, PlaceRef, ShopId } from "../shared/places.ts";
import type { FullPlan, Plan, PlannedRoute, SavedRouteDraft, SavedRouteId } from "../shared/plans.ts";
import { pathKm, type LngLat } from "../shared/geo.ts";
import { DEFAULT_INCLUDE } from "../shared/railroads.ts";
import { startTestApp, type TestApp } from "./harness.ts";

vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 });

const text = (t: string): PlaceRef => ({ kind: "text", text: t });
const plan = (start: PlaceRef | null, destination: PlaceRef | null, stops: PlaceRef[] = []): Plan => ({ places: [start, ...stops, destination], include: DEFAULT_INCLUDE });
const TAYLOR_TO_NLR: FullPlan = { places: [text("Taylor, TX"), text("EX-NLR-01")], include: DEFAULT_INCLUDE };
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
      body: JSON.stringify({ places: [{ kind: "lookup" }, null], include: DEFAULT_INCLUDE }),
    });
    expect(malformed.status).toBe(400);
    expect((await malformed.json()).error).toMatchObject({ kind: "invalid", field: "places[0].kind" });
    // The page's transport turns the envelope back into the same error.
    await expect(t.api("DELETE /api/saved-routes/:routeId", { params: { routeId: "no-such-route" } })).rejects.toMatchObject({ kind: "not-found" });
    await expect(t.api("POST /api/saved-routes", { body: { name: " ", plan: TAYLOR_TO_NLR, option: null, routeString: "" } })).rejects.toMatchObject({
      kind: "invalid",
      field: "name",
      message: "name cannot be empty.",
    });
  });

  it("every route in shared/api.ts answers (a smoke call per key of the handler table)", async () => {
    const s = await startTestApp();
    try {
      let shopId = "" as ShopId;
      let routeId = "" as SavedRouteId;
      const draft: SavedRouteDraft = { name: "EXAMPLE smoke", plan: { places: [text("Taylor, TX"), text("Waco, TX")], include: DEFAULT_INCLUDE }, option: null, routeString: "BNSF" };
      // Keyed by Route: a route added to the contract without a call here does not compile.
      const calls: { [R in Route]: () => Promise<Res<R>> } = {
        "GET /api/meta": () => s.api("GET /api/meta"),
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
        "POST /api/route": () => s.api("POST /api/route", { body: draft.plan }),
        "GET /api/saved-routes": () => s.api("GET /api/saved-routes"),
        "POST /api/saved-routes": async () => {
          const saved = await s.api("POST /api/saved-routes", { body: draft });
          routeId = saved.id;
          return saved;
        },
        "PUT /api/saved-routes/:routeId": () => s.api("PUT /api/saved-routes/:routeId", { params: { routeId }, body: { ...draft, name: "EXAMPLE smoke 2" } }),
        "DELETE /api/saved-routes/:routeId": () => s.api("DELETE /api/saved-routes/:routeId", { params: { routeId } }),
        "POST /api/track": () => s.api("POST /api/track", { body: { paths: [[[-97.34, 31.09], [-97.3, 31.1]]] } }),
      };
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
      expect(meta).toEqual({ exampleOnly: true });
      const shops = await s.api("GET /api/shops");
      expect(shops.map((shop) => [shop.code, shop.example])).toEqual(
        expect.arrayContaining([
          ["EX-NLR-01", true],
          ["EX-KCY-01", true],
        ]),
      );
      expect(await s.api("GET /api/saved-routes")).toEqual([]);
      const saved = await s.api("POST /api/saved-routes", { body: { name: "Taylor → NLR", plan: TAYLOR_TO_NLR, option: null, routeString: "" } });
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
    expect(partial).toMatchObject({ outcome: "incomplete", places: [{ ok: true, place: { label: "Kansas City, MO" } }, null] });
    const unknown = await t.api("POST /api/route", { body: plan(text("Taylor, TX"), text("Nowhere Junction XYZ")) });
    expect(unknown).toMatchObject({ outcome: "incomplete", places: [{ ok: true }, { ok: false, problem: { kind: "unknown" } }] });
  });

  it("routes the EXAMPLE plan the same way twice, the router's own route first", async () => {
    const first = routed(await t.api("POST /api/route", { body: TAYLOR_TO_NLR }));
    expect(first.routes[0].strategies[0]).toBe("pick");
    expect(first.places[1]).toMatchObject({ ok: true, place: { label: "North Little Rock, AR", match: { method: "shop" }, example: true } });
    expect(await t.api("POST /api/route", { body: TAYLOR_TO_NLR })).toEqual(first);
  });

  it("a stop with a line chosen keeps the route on that line there", async () => {
    const answer = routed(await t.api("POST /api/route", { body: plan(text("Taylor, TX"), text("EX-NLR-01"), [{ kind: "node", fraId: WYE, railroad: "UP" }]) }));
    for (const route of answer.routes) {
      const stop = route.steps.find((step) => step.kind === "stop");
      const leg = route.steps.filter((step) => step.kind === "leg" && step.kmFromStart <= (stop?.kmFromStart ?? 0)).at(-1);
      expect(leg?.kind === "leg" && route.legs[leg.leg].railroad, route.strategies[0]).toBe("UP");
    }
  });

  it("no route is said at the place it breaks, in the plan's words", async () => {
    // Oakville, ON is reached only over passenger-owned track.
    const oakville: Plan = { ...plan(text("Chicago, IL"), { kind: "coord", lon: -79.7195, lat: 43.4169 }), include: { regional: false, shortLine: false, passenger: false } };
    const answer = await t.api("POST /api/route", { body: oakville });
    expect(answer).toMatchObject({ outcome: "no-route", problem: { at: 1, message: "No route on the allowed track joins this place to the rest of the route." } });
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
    const draft = (name: string): SavedRouteDraft => ({ name, plan: TAYLOR_TO_NLR, option: "shortest", routeString: "BNSF-[Fort Worth, TX]-UP" });
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
      message: "No track near -90, 25.",
    });
    await expect(s.api("POST /api/shops", { body: { name: "", code: null, location: { kind: "text", text: "Waco, TX" } } })).rejects.toMatchObject({ kind: "invalid", field: "name" });
    await expect(s.api("POST /api/shops", { body: { name: "EXAMPLE copy", code: "ex-nlr-01", location: { kind: "text", text: "Waco, TX" } } })).rejects.toMatchObject({
      kind: "conflict",
      field: "code",
    });
  });

  it("POST /api/shops/import previews without saving, then saves; a second commit changes nothing", async () => {
    const source = { kind: "csv" as const, fileName: "EXAMPLE shops.csv", text: "name,code,lon,lat\nEXAMPLE Pueblo,EX-PUB-01,-104.61,38.27\nEXAMPLE sea,EX-SEA-01,-90,25\n" };
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
    expect(missing).toMatchObject({ outcome: "incomplete", places: [{ ok: true }, { ok: false }] });
    await s.api("POST /api/shops", { body: { name: "EXAMPLE new shop", code: "EX-NEW-01", location: text("Dallas, TX") } });
    const found = routed(await s.api("POST /api/route", { body: plan(text("Taylor, TX"), text("EX-NEW-01")) }));
    expect(found.places[1]).toMatchObject({ ok: true, place: { label: "EXAMPLE new shop" } });
  });
});

describe("restart", () => {
  it("a new server on the same data folder has the shops and the saved routes; routes are worked out again", async () => {
    const first = await startTestApp();
    const shop = await first.api("POST /api/shops", { body: { name: "Temple shop", code: "TPL-1", location: text("FRA 358070") } });
    const saved = await first.api("POST /api/saved-routes", { body: { name: "Taylor → Temple shop", plan: { places: [text("Taylor, TX"), { kind: "shop", shopId: shop.id }], include: DEFAULT_INCLUDE }, option: null, routeString: "BNSF" } });
    // The user deletes every EXAMPLE shop: they must not come back on the next start.
    for (const example of (await first.api("GET /api/shops")).filter((s) => s.example)) {
      await first.api("DELETE /api/shops/:shopId", { params: { shopId: example.id } });
    }
    await first.close({ keepData: true });

    const second = await startTestApp({ dataDir: first.dataDir });
    try {
      expect((await second.api("GET /api/shops")).map((s) => s.id)).toEqual([shop.id]);
      expect(await second.api("GET /api/saved-routes")).toEqual([saved]);
      const reopened = routed(await second.api("POST /api/route", { body: saved.plan }));
      expect(reopened.places[1]).toMatchObject({ ok: true, place: { label: "Temple shop" } });
      // A saved route naming a deleted shop says so at that place.
      await second.api("DELETE /api/shops/:shopId", { params: { shopId: shop.id } });
      expect(await second.api("POST /api/route", { body: saved.plan })).toMatchObject({ outcome: "incomplete", places: [{ ok: true }, { ok: false, problem: { kind: "removed" } }] });
      expect((await second.api("GET /api/meta")).exampleOnly).toBe(false);
    } finally {
      await second.close();
    }
  });
});

describe("Real tracks: routes drawn on the surveyed track", () => {

  it("each leg follows the track through every node, as long as the track km, and comes back in the order sent", async () => {
    const [route] = routed(await t.api("POST /api/route", { body: TAYLOR_TO_NLR })).routes;
    const paths = route.legs.map((leg) => leg.path);
    const drawn = await t.api("POST /api/track", { body: { paths } });
    expect(drawn).toHaveLength(paths.length);
    drawn.forEach((line, i) => {
      const nodes = paths[i];
      expect(line[0]).toEqual(nodes[0]);
      expect(line.at(-1)).toEqual(nodes.at(-1));
      // Every node, in order: the track line only adds the points between them.
      let at = -1;
      for (const node of nodes) {
        const next = line.findIndex((p, j) => j > at && p[0] === node[0] && p[1] === node[1]);
        expect(next).toBeGreaterThan(at);
        at = next;
      }
      expect(at).toBe(line.length - 1);
      expect(line.length).toBeGreaterThan(3 * nodes.length);
    });
    const km = route.legs.reduce((sum, leg) => sum + leg.km, 0);
    const drawnKm = drawn.reduce((sum, line) => sum + pathKm(line), 0);
    expect(Math.abs(drawnKm - km) / km).toBeLessThan(0.005);
    // Node to node, the same route cuts the curves.
    expect(paths.reduce((sum, path) => sum + pathKm(path), 0)).toBeLessThan(0.98 * km);
  });

  it("a step no single segment joins (two far-apart points) stays straight, and a malformed point is refused", async () => {
    const straight: LngLat[] = [[-97.34, 31.09], [-92.27, 34.76]];
    expect(await t.api("POST /api/track", { body: { paths: [straight] } })).toEqual([straight]);
    await expect(t.api("POST /api/track", { body: { paths: [[[-97.34]]] as unknown as LngLat[][] } })).rejects.toMatchObject({ kind: "invalid", field: "paths[0][0]" });
  });
});
