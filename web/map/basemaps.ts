/**
 * Free basemaps, no API key.
 * - Map: OpenFreeMap vector styles (OpenStreetMap data), light "liberty" / dark "dark".
 * - Satellite: Esri World Imagery + Esri boundaries & places labels.
 * - Optional overlay: OpenRailwayMap tracks, stations and yards.
 * Check each provider's terms before production use (Esri imagery needs an ArcGIS account for commercial apps).
 */
import type { StyleSpecification } from "maplibre-gl";

export type BasemapKind = "map" | "satellite";

const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services";

const SATELLITE: StyleSpecification = {
  version: 8,
  glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
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
  return `https://tiles.openfreemap.org/styles/${dark ? "dark" : "liberty"}`;
}

export const OPENRAILWAYMAP_TILES = ["a", "b", "c"].map(
  (s) => `https://${s}.tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png`,
);
export const OPENRAILWAYMAP_ATTRIBUTION =
  'Rail overlay © <a href="https://www.openrailwaymap.org/">OpenRailwayMap</a> (CC-BY-SA), © OpenStreetMap contributors';
