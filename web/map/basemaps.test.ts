import type { LayerSpecification, StyleSpecification } from "maplibre-gl";
import { describe, expect, it } from "vitest";
import { basemapStyle, carryOwnLayers, GROUND, LABELS, NIGHT_LABEL_PAINT, OCEAN_FROM_SPACE, SCENE_NAMES, type StreetLook } from "./basemaps.ts";
import { AUTO_DARK_ZOOM, DETAIL_MIN_ZOOM, OCEAN_SPACE_ZOOM } from "./config.ts";

const LOOKS: StreetLook[] = [
  { ground: "day", fromSpace: false },
  { ground: "night", fromSpace: false },
  { ground: "day", fromSpace: true },
  { ground: "night", fromSpace: true },
];
const street = (look: StreetLook) => basemapStyle("map", look);
const layerOf = (style: StyleSpecification, id: string) => {
  const layer = style.layers.find((l) => l.id === id);
  if (!layer) throw new Error(`no layer ${id}`);
  return layer;
};
const paintOf = (layer: LayerSpecification) => ("paint" in layer ? (layer.paint as Record<string, unknown>) : {});

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe("the street map", () => {
  it("differs between its four looks in paint only, so every switch keeps the tiles on screen", () => {
    const shape = (style: StyleSpecification) =>
      style.layers.map(({ id, type, ...rest }) => ({ id, type, source: "source" in rest ? rest.source : null, filter: "filter" in rest ? rest.filter : null, layout: "layout" in rest ? rest.layout : null, minzoom: rest.minzoom, maxzoom: rest.maxzoom }));
    const [first, ...others] = LOOKS.map(street);
    for (const other of others) {
      expect(shape(other)).toEqual(shape(first));
      expect(other.sources).toEqual(first.sources);
    }
  });

  it("gives the same object for the same look, so a re-render asks MapLibre for no change", () => {
    for (const look of LOOKS) expect(street({ ...look })).toBe(street(look));
    expect(street(LOOKS[0])).not.toBe(street(LOOKS[1]));
  });

  it("has LABELS as its first text layer; Satellite has a layer of that id too", () => {
    const style = street(LOOKS[0]);
    expect(style.layers.find((l) => l.type === "symbol")?.id).toBe(LABELS);
    expect(basemapStyle("satellite", LOOKS[0]).layers.map((l) => l.id)).toContain(LABELS);
  });

  it("names places only: no road names, points of interest, buildings, shields or rail; water names go by city zoom", () => {
    const style = street(LOOKS[0]);
    const sourceLayers = style.layers.flatMap((l) => ("source-layer" in l ? [l["source-layer"]] : []));
    for (const unwanted of ["transportation_name", "poi", "building", "aerodrome_label", "housenumber"]) expect(sourceLayers).not.toContain(unwanted);
    expect(style.layers.filter((l) => l.type === "symbol").map((l) => ("source-layer" in l ? l["source-layer"] : ""))).toEqual(["water_name", "place", "place", "place", "place"]);
    expect(JSON.stringify(style.layers.map((l) => ("filter" in l ? l.filter : null)))).not.toMatch(/"rail"|"transit"/);
    expect(style.sprite).toBeUndefined();
    expect(layerOf(style, LABELS).maxzoom).toBe(11);
  });

  it("ends every style with the empty layer the scene's names go over, so the routes under it always have a layer to go under", () => {
    for (const style of [...LOOKS.map(street), basemapStyle("satellite", LOOKS[0])]) {
      expect(style.layers.at(-1)).toMatchObject({ id: SCENE_NAMES, type: "background", paint: { "background-opacity": 0 } });
    }
  });

  it("names the big cities only zoomed out, beside the shops' names: no states, no countries", () => {
    const style = street(LOOKS[0]);
    const city = layerOf(style, "label-city");
    const layout = ("layout" in city ? city.layout : {}) as Record<string, unknown>;
    expect(layout["text-field"]).toEqual(["step", ["zoom"], ["case", ["<=", ["get", "rank"], 3], ["coalesce", ["get", "name_en"], ["get", "name"]], ""], DETAIL_MIN_ZOOM, ["coalesce", ["get", "name_en"], ["get", "name"]]]);
    expect(layerOf(style, "label-state").minzoom).toBe(DETAIL_MIN_ZOOM);
    expect(style.layers.map((l) => l.id)).not.toContain("label-country");
  });

  it("in Auto shows the Earth from space zoomed out: the deep blue ocean and bright names, its own ground from AUTO_DARK_ZOOM", () => {
    for (const ground of ["day", "night"] as const) {
      const style = street({ ground, fromSpace: true });
      expect(paintOf(layerOf(style, "water"))["fill-color"]).toEqual(["interpolate", ["linear"], ["zoom"], OCEAN_SPACE_ZOOM, OCEAN_FROM_SPACE, AUTO_DARK_ZOOM, GROUND[ground].water]);
      const city = paintOf(layerOf(style, "label-city"));
      expect(city["text-color"]).toEqual(["step", ["zoom"], NIGHT_LABEL_PAINT["text-color"], AUTO_DARK_ZOOM, GROUND[ground].label]);
      expect(city["text-halo-color"]).toEqual(["step", ["zoom"], NIGHT_LABEL_PAINT["text-halo-color"], AUTO_DARK_ZOOM, GROUND[ground].land]);
      expect(paintOf(layerOf(style, "label-village"))["text-color"]).toEqual(["step", ["zoom"], NIGHT_LABEL_PAINT["text-color"], AUTO_DARK_ZOOM, GROUND[ground].labelFaint]);
    }
  });

  it("outside Auto is its ground's own paint alone, so the night map keeps its quiet names", () => {
    for (const ground of ["day", "night"] as const) {
      const style = street({ ground, fromSpace: false });
      expect(paintOf(layerOf(style, "background"))["background-color"]).toBe(GROUND[ground].land);
      expect(paintOf(layerOf(style, "water"))["fill-color"]).toBe(GROUND[ground].water);
      expect(paintOf(layerOf(style, "label-city"))).toMatchObject({ "text-color": GROUND[ground].label, "text-halo-color": GROUND[ground].land });
      expect(paintOf(layerOf(style, LABELS))["text-color"]).toBe(GROUND[ground].labelFaint);
    }
  });

  it("keeps the ground quiet and the names readable on it", () => {
    for (const [name, ground] of Object.entries(GROUND)) {
      expect(contrast(ground.label, ground.land), `${name} names`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(ground.labelFaint, ground.land), `${name} faint names`).toBeGreaterThanOrEqual(3);
      for (const fill of [ground.water, ground.green, ground.road]) expect(contrast(fill, ground.land), `${name} ${fill}`).toBeLessThanOrEqual(1.5);
    }
  });
});

const style = (sources: string[], layers: LayerSpecification[]): StyleSpecification => ({
  version: 8,
  sources: Object.fromEntries(sources.map((id) => [id, { type: "vector", url: `https://example.com/${id}` }])),
  layers,
});
const fill = (id: string, source: string): LayerSpecification => ({ id, type: "fill", source, "source-layer": "water" });
const text = (id: string, source: string): LayerSpecification => ({ id, type: "symbol", source, "source-layer": "place", layout: { "text-field": "{name}" } });
const raster = (id: string): LayerSpecification => ({ id, type: "raster", source: id });

describe("a switch between the street looks", () => {
  it("carries the app's own sources and layers into the next style, under LABELS where they were", () => {
    const light = style(["streets", "night-lights", "tracks"], [fill("water", "streets"), raster("night-lights"), text(LABELS, "streets"), { id: "tracks", type: "line", source: "tracks", "source-layer": "rail" }]);
    const dark = style(["streets"], [fill("water", "streets"), fill("land", "streets"), text(LABELS, "streets"), text("label-city", "streets")]);
    const next = carryOwnLayers(light, dark);
    expect(Object.keys(next.sources)).toEqual(["streets", "night-lights", "tracks"]);
    expect(next.layers.map((layer) => layer.id)).toEqual(["water", "land", "night-lights", LABELS, "label-city", "tracks"]);
  });

  it("leaves the next style as it is when the app added nothing", () => {
    const dark = style(["streets"], [fill("water", "streets")]);
    expect(carryOwnLayers(style(["streets"], [fill("water", "streets")]), dark)).toBe(dark);
    expect(carryOwnLayers(undefined, dark)).toBe(dark);
  });
});
