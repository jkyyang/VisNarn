import { describe, expect, it } from "vitest";
import type { ShopId } from "../../shared/places.ts";
import type { SavedRouteId } from "../../shared/plans.ts";
import { HOME, hrefFor, parseLocation, type Screen } from "./routes.ts";

const saved = "route 7/a" as SavedRouteId;
const SCREENS: Screen[] = [
  HOME,
  { name: "route", saved: null, option: "shortest" },
  { name: "route", saved, option: null },
  { name: "route", saved, option: "no-turn-backs" },
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

  it("an unknown or retired path is HOME", () => {
    for (const href of ["/", "/nowhere", "/cars", "/cars/b1", "/route/fix", "/route/x/1", "/route/b/1/fix", "/route/saved", "/route/saved/a/b", "/shops/a/b"]) {
      expect(parse(href), href).toEqual(HOME);
    }
  });

  it("drops view choices it does not know instead of failing", () => {
    expect(parse("/route?option=fastest")).toEqual(HOME);
    expect(parse(`/route/saved/r1?option=fastest`)).toEqual({ name: "route", saved: "r1", option: null });
  });

  it("no place ever appears in a URL: only ids and the alternative", () => {
    expect(hrefFor({ name: "route", saved: "r1" as SavedRouteId, option: null })).toBe("/route/saved/r1");
    expect(hrefFor({ name: "route", saved: null, option: "shortest" })).toBe("/route?option=shortest");
  });
});
