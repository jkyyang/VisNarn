import type { LayerSpecification, StyleSpecification } from "maplibre-gl";
import { describe, expect, it } from "vitest";
import { carryOwnLayers } from "./basemaps.ts";

const style = (sources: string[], layers: LayerSpecification[]): StyleSpecification => ({
  version: 8,
  sources: Object.fromEntries(sources.map((id) => [id, { type: "vector", url: `https://example.com/${id}` }])),
  layers,
});
const fill = (id: string, source: string): LayerSpecification => ({ id, type: "fill", source, "source-layer": "water" });
const text = (id: string, source: string): LayerSpecification => ({ id, type: "symbol", source, "source-layer": "place", layout: { "text-field": "{name}" } });
const raster = (id: string): LayerSpecification => ({ id, type: "raster", source: id });

describe("a switch between the street maps", () => {
  it("carries the app's own sources and layers into the next style, under the place names where they were", () => {
    const light = style(["streets", "night", "tracks"], [fill("water", "streets"), raster("night"), text("places", "streets"), { id: "tracks", type: "line", source: "tracks", "source-layer": "rail" }]);
    const dark = style(["streets"], [fill("dark-water", "streets"), fill("dark-land", "streets"), text("dark-places", "streets")]);
    const next = carryOwnLayers(light, dark);
    expect(Object.keys(next.sources)).toEqual(["streets", "night", "tracks"]);
    expect(next.layers.map((layer) => layer.id)).toEqual(["dark-water", "dark-land", "night", "dark-places", "tracks"]);
  });

  it("leaves the next style as it is when the app added nothing", () => {
    const dark = style(["streets"], [fill("dark-water", "streets")]);
    expect(carryOwnLayers(style(["streets"], [fill("water", "streets")]), dark)).toBe(dark);
    expect(carryOwnLayers(undefined, dark)).toBe(dark);
  });
});
