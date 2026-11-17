import { describe, expect, it } from "vitest";
import type { BatchId } from "../../shared/cars.ts";
import type { ShopId } from "../../shared/places.ts";
import { HOME, hrefFor, parseLocation, type Screen } from "./routes.ts";

const batchId = "batch 7/a" as BatchId;
const SCREENS: Screen[] = [
  HOME,
  { name: "route", car: { kind: "typed" }, option: "shortest" },
  { name: "route", car: { kind: "row", batchId, row: 3 }, option: null },
  { name: "route", car: { kind: "row", batchId, row: 0 }, option: "no-turn-backs" },
  { name: "fix", car: { kind: "typed" }, at: null },
  { name: "fix", car: { kind: "typed" }, at: 0 },
  { name: "fix", car: { kind: "row", batchId, row: 12 }, at: 2 },
  { name: "cars", batchId: null, car: null, shop: null, hide: [] },
  { name: "cars", batchId, car: 4, shop: "Kansas City, MO", hide: ["ok"] },
  { name: "cars", batchId, car: null, shop: null, hide: ["act-now", "check-first", "ok"] },
  { name: "shops", edit: null },
  { name: "shops", edit: "new" },
  { name: "shops", edit: "shop-ex-1" as ShopId },
];

const parse = (href: string) => {
  const url = new URL(href, "http://127.0.0.1");
  return parseLocation(url.pathname, url.search);
};

describe("screens and URLs", () => {
  it("parseLocation(hrefFor(screen)) is the screen, for each kind of Screen", () => {
    for (const screen of SCREENS) expect(parse(hrefFor(screen))).toEqual(screen);
  });

  it("an unknown path is HOME", () => {
    for (const href of ["/", "/nowhere", "/route/b", "/route/b/x", "/route/b/1/2/fix", "/cars/a/b", "/shops/a/b"]) expect(parse(href)).toEqual(HOME);
  });

  it("drops view choices it does not know instead of failing", () => {
    expect(parse("/route?option=fastest")).toEqual(HOME);
    expect(parse("/cars?hide=ok,maybe&car=-1")).toEqual({ name: "cars", batchId: null, car: null, shop: null, hide: ["ok"] });
  });

  it("no car id or place ever appears in a URL", () => {
    const href = hrefFor({ name: "route", car: { kind: "row", batchId: "b1" as BatchId, row: 3 }, option: null });
    expect(href).toBe("/route/b1/3");
    expect(hrefFor({ name: "fix", car: { kind: "typed" }, at: 0 })).toBe("/route/fix?at=0");
  });
});
