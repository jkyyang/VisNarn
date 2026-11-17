import type { StyleSpecification } from "maplibre-gl";
import { describe, expect, it } from "vitest";
import { paintLabels } from "./DayNight.tsx";

function fakeMap() {
  const paint = new Map<string, unknown>([["city:text-color", "#333"], ["city:text-halo-color", "#fff"]]);
  return {
    paint,
    getPaintProperty: (layer: string, name: string) => paint.get(`${layer}:${name}`),
    setPaintProperty: (layer: string, name: string, value: unknown) => void paint.set(`${layer}:${name}`, value),
  };
}
const style = { version: 8, name: "liberty", sources: {}, layers: [
  { id: "city", type: "symbol", source: "x", layout: { "text-field": "{name}" } },
  { id: "icons", type: "symbol", source: "x", layout: { "icon-image": "dot" } },
] } as unknown as StyleSpecification;

describe("place names at night", () => {
  it("turns text bright on a dark halo at night and puts the style's own paint back by day", () => {
    const map = fakeMap();
    paintLabels(map, style, true);
    expect(map.paint.get("city:text-color")).toBe("#eef1f6");
    expect(map.paint.has("icons:text-color")).toBe(false);
    paintLabels(map, style, true);
    paintLabels(map, style, false);
    expect(map.paint.get("city:text-color")).toBe("#333");
    expect(map.paint.get("city:text-halo-color")).toBe("#fff");
  });
});
