import { describe, expect, it } from "vitest";
import type { FraId, PlaceResolution } from "../shared/places.ts";
import type { RoutePath, RouteStrategy, TurnBack } from "../shared/route.ts";
import { interchangesWord, pillText, placeProblem, routeName, shortPlace, trackWords, turnBackMove } from "./words.ts";

function route(id: RouteStrategy, km: number, interchanges: number): RoutePath {
  return { strategies: [id], km, interchanges, railroads: ["BNSF"], legs: [], turnBacks: [], steps: [], passesA: false };
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
    match: { method: "city", codeType: null, confidence: "snapped", snapKm: 0.4 },
    example: false,
  },
});
const missing: PlaceResolution = { ok: false, problem: { kind: "unknown", message: 'Nothing called "Xyz" in the city names.', candidates: [] } };

describe("words", () => {
  it("pillText: the selected route's km; another's difference from it", () => {
    const selected = route("pick", 828, 1);
    expect(pillText(selected, selected)).toBe("828 km");
    expect(pillText(route("shortest", 1008, 2), selected)).toBe("+180 km · 1 more interchange");
    expect(pillText(route("shortest", 788, 1), selected)).toBe("−40 km");
    expect(pillText(route("shortest", 828.4, 0), selected)).toBe("same km · 1 fewer interchange");
    expect(pillText(route("shortest", 2828, 4), selected)).toBe("+2,000 km · 3 more interchanges");
  });

  it("routeName joins the short names of the places, stops after 'via'", () => {
    expect(routeName({ start: found("Kansas City, MO"), stops: [], destination: found("Chicago, IL") })).toBe("Kansas City → Chicago");
    expect(routeName({ start: found("Kansas City, MO"), stops: [found("Galesburg, IL"), found("Peoria, IL")], destination: found("Chicago, IL") })).toBe(
      "Kansas City → Chicago via Galesburg, Peoria",
    );
  });

  it("placeProblem is the problem's own line, or nothing", () => {
    expect(placeProblem(missing)).toBe('Nothing called "Xyz" in the city names.');
    expect(placeProblem(found("Chicago, IL"))).toBeNull();
    expect(placeProblem(null)).toBeNull();
  });

  it("short words for places, interchanges and turn-backs", () => {
    expect(shortPlace("Temple, TX")).toBe("Temple");
    expect(shortPlace("72 km from Jacksonville, FL")).toBe("72 km from Jacksonville");
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
    expect(turnBackMove(turnBack)).toEqual({ arrives: "on Lampasas Sub heading S", leaves: "heading N" });
    expect(turnBackMove({ ...turnBack, leaves: { subdivision: "GALVESTON", headingDeg: 135 } }).leaves).toBe("on Galveston Sub heading SE");
    expect(trackWords("stub-end")).toBe("yard track (stub end)");
    expect(trackWords("yard")).toBe("yard track");
  });
});
