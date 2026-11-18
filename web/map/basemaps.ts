/**
 * Free basemaps, no API key.
 * - Map: OpenFreeMap vector styles (OpenStreetMap data), light "liberty" / dark "dark".
 * - Satellite: Esri World Imagery + Esri boundaries & places labels.
 * - Optional overlay, Real tracks: the rail lines in the same OpenFreeMap vector tiles.
 */
import type { LayerSpecification, StyleSpecification } from "maplibre-gl";

export type BasemapKind = "map" | "satellite";

const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services";
const OPENFREEMAP = "https://tiles.openfreemap.org";

const SATELLITE: StyleSpecification = {
  version: 8,
  glyphs: `${OPENFREEMAP}/fonts/{fontstack}/{range}.pbf`,
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
    { id: "labels", type: "raster", source: "labels" },
  ],
};

export function basemapStyle(kind: BasemapKind, dark: boolean): string | StyleSpecification {
  if (kind === "satellite") return SATELLITE;
  return `${OPENFREEMAP}/styles/${dark ? "dark" : "liberty"}`;
}

/** OpenFreeMap's vector tiles (OpenMapTiles schema) as TileJSON, which also carries their attribution. */
export const OPENFREEMAP_TILES = `${OPENFREEMAP}/planet`;

/** The id of the street maps' own vector source, which Real tracks draws from too. */
export const STREET_SOURCE = "openmaptiles";

/** Under the place names, so towns stay labelled: the first text layer of a style. */
export function firstLabelLayer(style: StyleSpecification): string | undefined {
  return style.layers.find((layer) => layer.type === "symbol" || layer.id === "labels")?.id;
}

/**
 * For a switch between the two street maps (`transformStyle`): the sources the app added to the
 * previous style (the night tiles), with their layers, carried into the next one, so their tiles stay
 * on screen. A layer that was under the place names goes under them again; any other goes on top.
 */
export function carryOwnLayers(previous: StyleSpecification | undefined, next: StyleSpecification): StyleSpecification {
  if (!previous) return next;
  const own = Object.keys(previous.sources).filter((id) => !(id in next.sources));
  if (!own.length) return next;
  const labelsAt = previous.layers.findIndex((layer) => layer.id === firstLabelLayer(previous));
  const carried = previous.layers.flatMap((layer, at) => ("source" in layer && own.includes(layer.source) ? [{ layer, under: labelsAt >= 0 && at < labelsAt }] : []));
  const under: LayerSpecification[] = carried.filter((c) => c.under).map((c) => c.layer);
  const over: LayerSpecification[] = carried.filter((c) => !c.under).map((c) => c.layer);
  const layers = [...next.layers];
  const nextLabels = layers.findIndex((layer) => layer.id === firstLabelLayer(next));
  layers.splice(nextLabels >= 0 ? nextLabels : layers.length, 0, ...under);
  return {
    ...next,
    sources: { ...next.sources, ...Object.fromEntries(own.map((id) => [id, previous.sources[id]])) },
    layers: [...layers, ...over],
  };
}
