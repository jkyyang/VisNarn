/**
 * Free basemaps, no API key.
 * - Map: OpenFreeMap vector styles (OpenStreetMap data), light "liberty" / dark "dark".
 * - Satellite: Esri World Imagery + Esri boundaries & places labels.
 * - Optional overlay, Real tracks: the rail lines in the same OpenFreeMap vector tiles.
 */
import type { StyleSpecification } from "maplibre-gl";

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
