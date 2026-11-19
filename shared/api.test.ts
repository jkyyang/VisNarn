import { describe, expect, it } from "vitest";
import { CHANGES_DATA, routeMatcher, urlFor, type Route } from "./api.ts";

/** Every route of the contract: CHANGES_DATA names each one, or does not compile. */
const ROUTES = Object.keys(CHANGES_DATA) as Route[];

/** Awkward values on purpose: a slash, a space, a percent sign and non-ASCII letters must survive the trip. */
const PARAM_VALUES: Record<string, string> = { shopId: "EX/NLR 01", routeId: "r%7 é" };

describe("urlFor / routeMatcher", () => {
  it("urlFor fills path params (encoded) and appends the query", () => {
    expect(urlFor("GET /api/shops")).toEqual({ method: "GET", url: "/api/shops" });
    expect(urlFor("PUT /api/shops/:shopId", { params: { shopId: "EX/NLR 01" }, body: { name: "x", code: null, location: { kind: "text", text: "x" }, links: [] } })).toEqual({
      method: "PUT",
      url: "/api/shops/EX%2FNLR%2001",
    });
    expect(urlFor("GET /api/places/nearest", { query: { lon: -97.34, lat: 31.1, withinKm: 2.5 } }).url).toBe("/api/places/nearest?lon=-97.34&lat=31.1&withinKm=2.5");
    expect(urlFor("GET /api/places/suggest", { query: { q: "Temple, TX & co", role: "shop" } }).url).toBe("/api/places/suggest?q=Temple%2C+TX+%26+co&role=shop");
    expect(urlFor("DELETE /api/saved-routes/:routeId", { params: { routeId: "r1" } }).url).toBe("/api/saved-routes/r1");
  });

  it("routeMatcher(urlFor(route, request)) finds the same route and params, for every route in Api", () => {
    const match = routeMatcher(ROUTES);
    for (const route of ROUTES) {
      const names = [...route.matchAll(/:(\w+)/g)].map((m) => m[1]);
      const params = Object.fromEntries(names.map((name) => [name, PARAM_VALUES[name]]));
      const { method, url } = urlFor(route as "DELETE /api/saved-routes/:routeId", { params } as never);
      const found = match(method, new URL(url, "http://127.0.0.1").pathname);
      expect(found, route).toEqual({ route, params });
    }
  });

  it("a literal path segment wins over a parameter in the same place", () => {
    const match = routeMatcher(ROUTES);
    expect(match("POST", "/api/shops/import")?.route).toBe("POST /api/shops/import");
    expect(match("PUT", "/api/shops/import")).toEqual({ route: "PUT /api/shops/:shopId", params: { shopId: "import" } });
  });

  it("an unknown path or a known path with another method matches nothing", () => {
    const match = routeMatcher(ROUTES);
    expect(match("GET", "/api/nothing")).toBeNull();
    expect(match("GET", "/api/shops/EX-1")).toBeNull();
    expect(match("PUT", "/api/saved-routes")).toBeNull();
    expect(match("GET", "/api/shops/")).toBeNull();
    expect(match("GET", "/api/saved-routes/r1/x")).toBeNull();
    expect(match("DELETE", "/api/saved-routes/%E0%A4%A")).toBeNull();
  });
});
