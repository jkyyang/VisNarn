import { describe, expect, it } from "vitest";
import { locationOf, refOf, type FraId, type ResolvedPlace } from "./places.ts";

const place = (over: Partial<ResolvedPlace>): ResolvedPlace => ({
  label: "Temple, TX",
  lon: -97.3427312,
  lat: 31.0982398,
  fraId: null,
  railroad: null,
  ref: { kind: "text", text: "Temple, TX" },
  railroads: ["BNSF"],
  match: { method: "city", confidence: "snapped", snapKm: 0.4 },
  example: false,
  ...over,
});

describe("locationOf / refOf", () => {
  it("saves a node by its FRA id and railroad, and resolves back to the same node", () => {
    const location = locationOf(place({ fraId: 358070 as FraId, railroad: "BNSF" }));
    expect(location).toEqual({ fraId: 358070, railroad: "BNSF" });
    expect(refOf(location)).toEqual({ kind: "node", fraId: 358070, railroad: "BNSF" });
  });

  it("saves a place without a node as coordinates rounded to 5 decimals", () => {
    const location = locationOf(place({}));
    expect(location).toEqual({ lon: -97.34273, lat: 31.09824 });
    expect(refOf(location)).toEqual({ kind: "coord", lon: -97.34273, lat: 31.09824 });
  });
});
