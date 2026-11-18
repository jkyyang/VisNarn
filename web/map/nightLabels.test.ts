import type { StyleSpecification } from "maplibre-gl";
import { describe, expect, it } from "vitest";
import { OCEAN_FROM_SPACE, paintLabels, paintOcean } from "./DayNight.tsx";

function fakeMap() {
  const paint = new Map<string, unknown>([["city:text-color", "#333"], ["city:text-halo-color", "#fff"], ["water:fill-color", "rgb(158,189,255)"]]);
  return {
    paint,
    getPaintProperty: (layer: string, name: string) => paint.get(`${layer}:${name}`),
    setPaintProperty: (layer: string, name: string, value: unknown) => void paint.set(`${layer}:${name}`, value),
  };
}
const style = { version: 8, name: "liberty", sources: {}, layers: [
  { id: "water", type: "fill", source: "x" },
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

describe("the ocean in Auto", () => {
  it("is the deep blue seen from space zoomed out, the map's own blue zoomed in, and all the map's own outside Auto", () => {
    const map = fakeMap();
    paintOcean(map, style, true);
    expect(map.paint.get("water:fill-color")).toEqual(["interpolate", ["linear"], ["zoom"], 5, OCEAN_FROM_SPACE, 7, "rgb(158,189,255)"]);
    paintOcean(map, style, false);
    expect(map.paint.get("water:fill-color")).toBe("rgb(158,189,255)");
  });

  it("leaves a style with no water layer (Satellite) alone", () => {
    const map = fakeMap();
    paintOcean(map, { ...style, layers: [] }, true);
    expect(map.paint.get("water:fill-color")).toBe("rgb(158,189,255)");
  });
});
