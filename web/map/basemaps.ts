/**
 * Free basemaps, no API key.
 * - Map: a quiet style of our own over OpenFreeMap's vector tiles (OpenStreetMap data), like a transit
 *   map: pale land, water and parks, roads as faint lines, and the names of places only, so the rail
 *   network and the route stand out. A day ground and a night ground.
 * - Satellite: Esri World Imagery + Esri boundaries & places labels.
 * - Optional overlay, Real tracks: the rail lines in the same OpenFreeMap vector tiles.
 */
import type { ExpressionSpecification, FilterSpecification, LayerSpecification, StyleSpecification, SymbolLayerSpecification } from "maplibre-gl";
import { AUTO_DARK_ZOOM, OCEAN_SPACE_ZOOM } from "./config.ts";

export type BasemapKind = "map" | "satellite";
export type Ground = "day" | "night";
/** How the street map looks: its ground, and whether Auto shows the Earth from space when zoomed out. */
export interface StreetLook {
  ground: Ground;
  fromSpace: boolean;
}

const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services";
const OPENFREEMAP = "https://tiles.openfreemap.org";
const GLYPHS = `${OPENFREEMAP}/fonts/{fontstack}/{range}.pbf`;

/** OpenFreeMap's vector tiles (OpenMapTiles schema) as TileJSON, which also carries their attribution. */
export const OPENFREEMAP_TILES = `${OPENFREEMAP}/planet`;

/** The id of the street map's own vector source, which Real tracks draws from too. */
export const STREET_SOURCE = "openmaptiles";

/** The bottom text layer of both styles. The night tiles, Real tracks and the rail network go under it, so place names stay on top. */
export const LABELS = "labels";

/** The street map's colours. Land, water, parks and roads stay within 1.5:1 of each other; names read at 4.5:1, faint ones at 3:1. */
export const GROUND = {
  day: { land: "#eff0ec", water: "#c3d5e4", green: "#e1e9db", road: "#ffffff", roadFar: "#d9dcd7", boundary: "#b4b9be", label: "#5f656b", labelFaint: "#858b91" },
  night: { land: "#1c1f24", water: "#0f1722", green: "#1e2622", road: "#2b3038", roadFar: "#2b3038", boundary: "#4a515a", label: "#a3aab3", labelFaint: "#7b838d" },
} as const satisfies Record<Ground, Record<string, string>>;

/** Place names over the night side seen from space: bright text on a dark halo, so they read on black and on city lights. */
export const NIGHT_LABEL_PAINT = { "text-color": "#eef1f6", "text-halo-color": "rgba(8, 10, 18, 0.92)", "text-halo-width": 1.6, "text-halo-blur": 0.4 } as const;

/** Open water seen from space: the deep blue that fades into Black Marble's dark night ocean. */
export const OCEAN_FROM_SPACE = "#1d4670";

const HALO_PX = 1.5;

const SATELLITE: StyleSpecification = {
  version: 8,
  glyphs: GLYPHS,
  sources: {
    imagery: {
      type: "raster",
      tiles: [`${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`],
      tileSize: 256,
      maxzoom: 19,
      attribution: "Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community",
    },
    labels: {
      type: "raster",
      tiles: [`${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`],
      tileSize: 256,
      maxzoom: 19,
    },
  },
  layers: [
    { id: "imagery", type: "raster", source: "imagery" },
    { id: LABELS, type: "raster", source: "labels" },
  ],
};

const zoomRamp = (...stops: (number | string)[]) => ["interpolate", ["linear"], ["zoom"], ...stops] as ExpressionSpecification;
const classIn = (...names: string[]): FilterSpecification => ["in", ["get", "class"], ["literal", names]];
const onLand = (level: number): FilterSpecification => ["all", ["==", ["get", "admin_level"], level], ["!=", ["get", "maritime"], 1]];
const NAME: ExpressionSpecification = ["coalesce", ["get", "name_en"], ["get", "name"]];

/**
 * A text layer's paint in its ground's colours. In Auto, zoomed out past AUTO_DARK_ZOOM, the screen
 * shows the Earth from space, day and night side by side, so names take the bright night paint there.
 */
function textPaint(ground: (typeof GROUND)[Ground], tone: "label" | "labelFaint", fromSpace: boolean): SymbolLayerSpecification["paint"] {
  const zoomedOut = <T extends string | number>(space: T, own: T) => (fromSpace ? (["step", ["zoom"], space, AUTO_DARK_ZOOM, own] as ExpressionSpecification) : own);
  return {
    "text-color": zoomedOut(NIGHT_LABEL_PAINT["text-color"], ground[tone]),
    "text-halo-color": zoomedOut(NIGHT_LABEL_PAINT["text-halo-color"], ground.land),
    "text-halo-width": zoomedOut(NIGHT_LABEL_PAINT["text-halo-width"], HALO_PX),
    "text-halo-blur": zoomedOut(NIGHT_LABEL_PAINT["text-halo-blur"], 0),
  };
}

function streetStyle({ ground: which, fromSpace }: StreetLook): StyleSpecification {
  const ground = GROUND[which];
  const source = STREET_SOURCE;
  const names = (
    id: string,
    sourceLayer: string,
    filter: FilterSpecification,
    zooms: { minzoom: number; maxzoom?: number },
    tone: "label" | "labelFaint",
    layout: SymbolLayerSpecification["layout"],
  ): SymbolLayerSpecification => ({
    id,
    type: "symbol",
    source,
    "source-layer": sourceLayer,
    filter,
    ...zooms,
    layout: { "text-field": NAME, "text-font": ["Noto Sans Regular"], "text-size": 12, "text-padding": 6, ...layout },
    paint: textPaint(ground, tone, fromSpace),
  });
  const layers: LayerSpecification[] = [
    { id: "background", type: "background", paint: { "background-color": ground.land } },
    { id: "green", type: "fill", source, "source-layer": "park", paint: { "fill-color": ground.green } },
    { id: "wood", type: "fill", source, "source-layer": "landcover", minzoom: 8, filter: classIn("wood"), paint: { "fill-color": ground.green, "fill-opacity": zoomRamp(8, 0, 10, 0.7) } },
    {
      id: "water",
      type: "fill",
      source,
      "source-layer": "water",
      filter: ["!=", ["get", "brunnel"], "tunnel"],
      paint: { "fill-color": fromSpace ? zoomRamp(OCEAN_SPACE_ZOOM, OCEAN_FROM_SPACE, AUTO_DARK_ZOOM, ground.water) : ground.water },
    },
    { id: "waterway", type: "line", source, "source-layer": "waterway", minzoom: 9, filter: classIn("river", "canal"), paint: { "line-color": ground.water, "line-width": zoomRamp(9, 0.6, 14, 2.5) } },
    { id: "boundary-state", type: "line", source, "source-layer": "boundary", minzoom: 3, filter: onLand(4), paint: { "line-color": ground.boundary, "line-width": 0.7, "line-dasharray": [3, 2] } },
    { id: "boundary-country", type: "line", source, "source-layer": "boundary", filter: onLand(2), paint: { "line-color": ground.boundary, "line-width": 1.1 } },
    {
      id: "road-minor",
      type: "line",
      source,
      "source-layer": "transportation",
      minzoom: 12,
      filter: classIn("secondary", "tertiary", "minor"),
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": ground.road, "line-width": zoomRamp(12, 0.6, 14, 2, 17, 9) },
    },
    {
      id: "road-major",
      type: "line",
      source,
      "source-layer": "transportation",
      minzoom: 6,
      filter: classIn("motorway", "trunk", "primary"),
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": zoomRamp(9, ground.roadFar, 11, ground.road), "line-width": zoomRamp(6, 0.5, 10, 1.4, 14, 4, 17, 12) },
    },
    names(LABELS, "water_name", ["==", ["geometry-type"], "Point"], { minzoom: 5, maxzoom: 11 }, "labelFaint", { "text-font": ["Noto Sans Italic"], "text-size": 11, "text-padding": 20 }),
    names("label-village", "place", classIn("village"), { minzoom: 11 }, "labelFaint", { "text-size": 11, "text-padding": 10 }),
    names("label-town", "place", classIn("town"), { minzoom: 8 }, "label", { "text-size": zoomRamp(8, 11, 12, 13), "text-padding": 10 }),
    names("label-city", "place", classIn("city"), { minzoom: 3 }, "label", { "text-font": ["Noto Sans Bold"], "text-size": zoomRamp(3, 11, 8, 14, 12, 17), "symbol-sort-key": ["get", "rank"], "text-padding": 10 }),
    names("label-state", "place", classIn("state"), { minzoom: 4, maxzoom: 7 }, "labelFaint", { "text-size": 10, "text-transform": "uppercase", "text-letter-spacing": 0.15, "text-padding": 20 }),
    names("label-country", "place", classIn("country"), { minzoom: 1, maxzoom: 5 }, "label", { "text-font": ["Noto Sans Bold"], "text-size": 13, "text-padding": 20 }),
  ];
  return { version: 8, glyphs: GLYPHS, sources: { [source]: { type: "vector", url: OPENFREEMAP_TILES } }, layers };
}

const streetStyles = new Map<string, StyleSpecification>();

/**
 * The basemap style for a choice. Each street look is built once and the same object given back, so a
 * re-render asks for no change; the looks differ in paint only, so a switch between them keeps the tiles.
 */
export function basemapStyle(kind: BasemapKind, look: StreetLook): StyleSpecification {
  if (kind === "satellite") return SATELLITE;
  const key = `${look.ground}|${look.fromSpace}`;
  let style = streetStyles.get(key);
  if (!style) streetStyles.set(key, (style = streetStyle(look)));
  return style;
}

/**
 * For a switch between two street looks (`transformStyle`): the sources the app added to the previous
 * style (the night tiles), with their layers, carried into the next one, so their tiles stay on screen.
 * A layer that was under LABELS goes under it again; any other goes on top.
 */
export function carryOwnLayers(previous: StyleSpecification | undefined, next: StyleSpecification): StyleSpecification {
  if (!previous) return next;
  const own = Object.keys(previous.sources).filter((id) => !(id in next.sources));
  if (!own.length) return next;
  const labelsAt = previous.layers.findIndex((layer) => layer.id === LABELS);
  const carried = previous.layers.flatMap((layer, at) => ("source" in layer && own.includes(layer.source) ? [{ layer, under: labelsAt >= 0 && at < labelsAt }] : []));
  const under: LayerSpecification[] = carried.filter((c) => c.under).map((c) => c.layer);
  const over: LayerSpecification[] = carried.filter((c) => !c.under).map((c) => c.layer);
  const layers = [...next.layers];
  const nextLabels = layers.findIndex((layer) => layer.id === LABELS);
  layers.splice(nextLabels >= 0 ? nextLabels : layers.length, 0, ...under);
  return {
    ...next,
    sources: { ...next.sources, ...Object.fromEntries(own.map((id) => [id, previous.sources[id]])) },
    layers: [...layers, ...over],
  };
}
