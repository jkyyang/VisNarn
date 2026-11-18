import { Layer, Source, type LineLayer } from "react-map-gl/maplibre";
import { OPENFREEMAP_TILES } from "./basemaps.ts";

const SOURCE = "real-tracks";
/** The night theme's --fg and the day theme's --fg2: MapLibre paint needs literal colours. */
const TRACK_ON_DARK = "#e8eaed";
const TRACK_ON_LIGHT = "#3c4043";


/**
 * The rail lines of OpenStreetMap as thin vector lines. Raster tiles were stretched between zoom
 * levels and on high-density screens, so their lines went thick and blurry; vector lines are drawn
 * at the screen's own resolution.
 *
 * `dark`: the ground is dark (the night street map or satellite imagery), so the lines are light.
 */
export function realTrackLayers(dark: boolean): LineLayer[] {
  const color = dark ? TRACK_ON_DARK : TRACK_ON_LIGHT;
  return [
    {
      // OpenMapTiles sets `service` on yard, siding, spur and crossover track only.
      id: "real-tracks-service",
      type: "line",
      source: SOURCE,
      "source-layer": "transportation",
      filter: ["all", ["==", ["get", "class"], "rail"], ["has", "service"]],
      paint: {
        "line-color": color,
        "line-opacity": 0.7,
        "line-width": ["interpolate", ["linear"], ["zoom"], 14, 0.6, 16, 1.4],
        "line-dasharray": [3, 2],
      },
    },
    {
      id: "real-tracks-main",
      type: "line",
      source: SOURCE,
      "source-layer": "transportation",
      filter: ["all", ["==", ["get", "class"], "rail"], ["!", ["has", "service"]]],
      paint: {
        "line-color": color,
        "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.5, 12, 1.2, 16, 2.2],
      },
    },
  ];
}

/**
 * Drawn over the basemap and under deck.gl's canvas (the network and the route). react-map-gl
 * re-adds a <Source> and its layers after every style load, which keeps them across basemap switches.
 */
export function RealTracks({ dark }: { dark: boolean }) {
  return (
    <Source id={SOURCE} type="vector" url={OPENFREEMAP_TILES}>
      {realTrackLayers(dark).map((layer) => (
        <Layer key={layer.id} {...layer} />
      ))}
    </Source>
  );
}
