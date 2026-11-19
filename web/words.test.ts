import { describe, expect, it } from "vitest";
import type { FraId, PlaceResolution } from "../shared/places.ts";
import type { RoutePath, RouteStrategy, TurnBack } from "../shared/route.ts";
import { interchangesWord, isApproximate, pillText, placeHint, placeProblem, routeName, shortPlace, trackWords, turnBackMove } from "./words.ts";

function route(id: RouteStrategy, km: number, interchanges: number): RoutePath {
  return { strategies: [id], km, interchanges, railroads: ["BNSF"], legs: [], turnBacks: [], steps: [] };
}

const found = (label: string): PlaceResolution => ({
  ok: true,
  place: {
    ref: { kind: "text", text: label },
    label,
    lon: -94.58,
    lat: 39.1,
    fraId: null,
    railroad: null,
    railroads: ["BNSF"],
    match: { method: "city", confidence: "snapped", snapKm: 0.4 },
  },
});
const missing: PlaceResolution = { ok: false, problem: { kind: "unknown", message: 'No place called "Xyz".', candidates: [] } };

describe("words", () => {
  it("pillText: the selected route's length; another's difference from it, in the viewer's unit", () => {
    const selected = route("pick", 828, 1);
    expect(pillText(selected, selected, "km")).toBe("828 km");
    expect(pillText(route("shortest", 1008, 2), selected, "km")).toBe("+180 km · 1 more interchange");
    expect(pillText(route("shortest", 788, 1), selected, "km")).toBe("−40 km");
    expect(pillText(route("shortest", 828.4, 0), selected, "km")).toBe("same length · 1 fewer interchange");
    expect(pillText(route("shortest", 2828, 4), selected, "km")).toBe("+2,000 km · 3 more interchanges");
    expect(pillText(selected, selected, "mi")).toBe("514 mi");
    expect(pillText(route("shortest", 1008, 2), selected, "mi")).toBe("+112 mi · 1 more interchange");
    expect(pillText(route("shortest", 828.4, 1), selected, "mi")).toBe("same length");
  });

  it("placeHint says how far the nearest track is, in the viewer's unit, once it is 1 km or more", () => {
    const at = (snapKm: number): PlaceResolution => {
      const resolution = found("Ville Platte, LA");
      return resolution.ok ? { ok: true, place: { ...resolution.place, match: { method: "city", confidence: "snapped", snapKm } } } : resolution;
    };
    expect(placeHint(at(0.4), "km")).toEqual({ ok: true, text: "On the network · BNSF" });
    expect(placeHint(at(20), "km")).toEqual({ ok: true, text: "Nearest track 20 km away · BNSF" });
    expect(placeHint(at(20), "mi")).toEqual({ ok: true, text: "Nearest track 12 mi away · BNSF" });
    expect(placeHint(missing, "mi")).toEqual({ ok: false, text: 'No place called "Xyz".' });
  });

  it("routeName joins the short names of the places, stops after 'via'", () => {
    expect(routeName([found("Kansas City, MO"), found("Chicago, IL")])).toBe("Kansas City → Chicago");
    expect(routeName([found("Kansas City, MO"), found("Galesburg, IL"), null, found("Peoria, IL"), found("Chicago, IL")])).toBe("Kansas City → Chicago via Galesburg, Peoria");
    expect(routeName([found("Texarkana, AR · UTLX"), found("Regina, SK · Procor (approximate)")])).toBe("Texarkana → Regina");
  });

  it("placeProblem is the problem's own line, or nothing", () => {
    expect(placeProblem(missing)).toBe('No place called "Xyz".');
    expect(placeProblem(found("Chicago, IL"))).toBeNull();
    expect(placeProblem(null)).toBeNull();
  });

  it("short words for places, interchanges and turn-backs", () => {
    expect(shortPlace("Temple, TX")).toBe("Temple");
    expect(shortPlace("72 km from Jacksonville, FL")).toBe("72 km from Jacksonville");
    expect(shortPlace("Regina, SK · Procor (approximate)")).toBe("Regina");
    expect(shortPlace("Texarkana, AR · UTLX")).toBe("Texarkana");
    expect(isApproximate("Regina, SK · Procor (approximate)")).toBe(true);
    expect(isApproximate("Ville Platte, LA · UTLX (ends at UP, 20 km away)")).toBe(false);
    expect(interchangesWord(1)).toBe("1 interchange");
    expect(interchangesWord(2)).toBe("2 interchanges");
    const turnBack: TurnBack = {
      at: { fraId: 357961 as FraId, lon: -97.35, lat: 31.1, near: "Temple, TX" },
      railroad: "BNSF",
      arrives: { subdivision: "LAMPASAS", headingDeg: 182 },
      leaves: { subdivision: "LAMPASAS", headingDeg: 6 },
      turnDeg: 176,
      track: "stub-end",
    };
    expect(turnBackMove(turnBack)).toBe("Lampasas Sub S → N");
    expect(turnBackMove({ ...turnBack, leaves: { subdivision: "GALVESTON", headingDeg: 135 } })).toBe("Lampasas Sub S → Galveston Sub SE");
    expect(trackWords("stub-end")).toBe("yard track (stub end)");
    expect(trackWords("yard")).toBe("yard track");
    expect(trackWords("stop")).toBe("turned at the stop");
  });
});
