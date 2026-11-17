import { Layer, Source } from "react-map-gl/maplibre";
import { OPENRAILWAYMAP_ATTRIBUTION, OPENRAILWAYMAP_TILES } from "./basemaps.ts";

/**
 * OpenRailwayMap raster tiles above the basemap. react-map-gl re-adds a <Source> and its <Layer>
 * after every style load, which is what keeps this overlay alive across basemap switches.
 */
export function RealTracks() {
  return (
    <Source
      id="openrailwaymap"
      type="raster"
      tiles={OPENRAILWAYMAP_TILES}
      tileSize={256}
      maxzoom={19}
      attribution={OPENRAILWAYMAP_ATTRIBUTION}
    >
      <Layer id="openrailwaymap" type="raster" />
    </Source>
  );
}
