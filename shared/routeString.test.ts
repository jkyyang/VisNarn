import { describe, expect, it } from "vitest";
import type { FraId, PlaceRef } from "./places.ts";
import type { Line } from "./railroads.ts";
import type { Leg, Milestone, RoutePath } from "./route.ts";
import { compactRouteString, routeStringOf, shownRouteString } from "./routeString.ts";

/** A route from rows written in travel order: a line is a leg, "[place]" a railroad change, "stop N" a stop, "↩" a turn-back. */
function route(...rows: string[]): RoutePath {
  const legs: Leg[] = [];
  const steps: Milestone[] = [];
  const isLine = (row: string) => !row.startsWith("[") && !row.startsWith("stop ") && row !== "↩";
  let line = rows.find(isLine) as Line;
  for (const [km, row] of rows.entries()) {
    const next = rows.slice(km).find(isLine) as Line;
    if (row.startsWith("[")) steps.push({ kind: "interchange", kmFromStart: km, from: line, to: next, at: row.slice(1, -1) });
    else if (row.startsWith("stop ")) steps.push({ kind: "stop", kmFromStart: km, stop: Number(row.slice(5)), label: row });
    else if (row === "↩") steps.push({ kind: "turn-back", kmFromStart: km, turnBack: 0 });
    else {
      line = row as Line;
      steps.push({ kind: "leg", kmFromStart: km, leg: legs.length });
      legs.push({ railroad: line, km: 100, from: "", to: "", headingDeg: 0, subdivisions: [], path: [] });
    }
  }
  steps.push({ kind: "destination", kmFromStart: rows.length });
  return { strategies: ["pick"], km: 100 * legs.length, interchanges: 0, railroads: [], legs, turnBacks: [], steps };
}

const node = (railroad: "BNSF" | "UP" | null): PlaceRef => ({ kind: "node", fraId: 412783 as FraId, railroad });

describe("route string", () => {
  it("names carriers and junctions in travel order, compact for saving and spaced for showing", () => {
    const string = routeStringOf(route("BNSF", "[Kansas City, MO]", "UP", "[Chicago, IL]", "NS"), []);
    expect(compactRouteString(string)).toBe("BNSF-[Kansas City, MO]-UP-[Chicago, IL]-NS");
    expect(shownRouteString(string)).toBe("BNSF – [Kansas City, MO] – UP – [Chicago, IL] – NS");
    expect(string.junctions.map((j) => j.chosen)).toEqual([false, false]);
  });

  it("is one carrier when the route never changes railroad", () => {
    expect(shownRouteString(routeStringOf(route("BNSF"), []))).toBe("BNSF");
  });

  it("leaves turn-backs and plain stops out", () => {
    const string = routeStringOf(route("BNSF", "↩", "BNSF", "stop 0", "[Temple, TX]", "UP"), [{ kind: "text", text: "Waco, TX" }]);
    expect(shownRouteString(string)).toBe("BNSF – [Temple, TX] – UP");
    expect(string.junctions[0].chosen).toBe(false);
  });

  it("shows a regional railroad or short line by its class label, never a made-up mark", () => {
    expect(shownRouteString(routeStringOf(route("UP", "[Topeka, KS]", "short line", "[Salina, KS]", "regional"), []))).toBe(
      "UP – [Topeka, KS] – short line – [Salina, KS] – regional",
    );
  });

  it("drops a change of railroad before the first carrier (the router breaking a tie at the start) and a change to the same carrier", () => {
    expect(shownRouteString(routeStringOf(route("[Chicago, IL]", "CSXT"), []))).toBe("CSXT");
    expect(shownRouteString(routeStringOf(route("BNSF", "[Temple, TX]", "BNSF", "[Fort Worth, TX]", "UP"), []))).toBe("BNSF – [Fort Worth, TX] – UP");
  });

  it("marks the change before a stop with a chosen next carrier as the person's choice", () => {
    // The change to UP is at the stop itself (the stop row comes before the UP leg) or before it.
    expect(routeStringOf(route("BNSF", "[Chicago, IL]", "stop 0", "UP"), [node("UP")]).junctions[0].chosen).toBe(true);
    expect(routeStringOf(route("BNSF", "[Chicago, IL]", "UP", "stop 0"), [node("UP")]).junctions[0].chosen).toBe(true);
    // "Router's pick" at the stop: no choice.
    expect(routeStringOf(route("BNSF", "[Chicago, IL]", "UP", "stop 0"), [node(null)]).junctions[0].chosen).toBe(false);
    // A change after the stop is the router's.
    expect(routeStringOf(route("BNSF", "stop 0", "[Chicago, IL]", "UP"), [node("BNSF")]).junctions[0].chosen).toBe(false);
  });
});
