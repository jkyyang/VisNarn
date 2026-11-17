/**
 * The night half of the day/night map, drawn inside MapLibre (under the deck.gl canvas, so the rail
 * lines and the route are never covered): NASA's city lights, and the optional day-night line.
 */
import type { LayerSpecification, StyleSpecification } from "maplibre-gl";
import { useEffect, useMemo } from "react";
import { Layer, Source, useMap } from "react-map-gl/maplibre";
import { terminator } from "./daylight.ts";

/** VIIRS Black Marble 2016 from NASA GIBS: free, no key, served with CORS, tiles to zoom 8. */
export const NIGHT_LIGHTS_TILES = [
  "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png",
];
export const NIGHT_LIGHTS_ATTRIBUTION = 'Night lights: <a href="https://earthobservatory.nasa.gov/features/NightLights">NASA Earth Observatory</a> VIIRS Black Marble, via NASA GIBS';

const LIGHTS_ID = "night-lights";

/**
 * Bright and sharp while the whole region is in view; zoomed in, its 8th-level pixels turn to blur,
 * so it fades and lets the dark street map through.
 */
const lightsOpacity = (strength: number) => ["interpolate", ["linear"], ["zoom"], 6, 0.95 * strength, 11, 0.3 * strength];

/** Under the place names, so towns stay labelled: the first text layer of whatever style is loaded. */
function firstLabelLayer(style: StyleSpecification): string | undefined {
  return style.layers.find((layer) => layer.type === "symbol" || layer.id === "labels")?.id;
}

/**
 * Managed by hand rather than as a react-map-gl <Layer>: its place in the stack depends on the
 * loaded style's own layer ids, which change with every basemap switch.
 */
export function NightLights({ strength }: { strength: number }) {
  const map = useMap().current?.getMap();
  const shown = strength >= 0.02;

  useEffect(() => {
    if (!map) return;
    const ensure = () => {
      // Undefined until the style has loaded; "style.load" calls again then.
      const style = map.getStyle();
      if (!style) return;
      if (!map.getSource(LIGHTS_ID)) {
        map.addSource(LIGHTS_ID, { type: "raster", tiles: NIGHT_LIGHTS_TILES, tileSize: 256, maxzoom: 8, attribution: NIGHT_LIGHTS_ATTRIBUTION });
      }
      if (!map.getLayer(LIGHTS_ID)) {
        const layer: LayerSpecification = { id: LIGHTS_ID, type: "raster", source: LIGHTS_ID, layout: { visibility: "none" }, paint: { "raster-fade-duration": 0 } };
        map.addLayer(layer, firstLabelLayer(style));
      }
      map.setLayoutProperty(LIGHTS_ID, "visibility", shown ? "visible" : "none");
      if (shown) map.setPaintProperty(LIGHTS_ID, "raster-opacity", lightsOpacity(strength));
    };
    ensure();
    // A basemap switch replaces the whole style, this layer with it.
    map.on("style.load", ensure);
    return () => void map.off("style.load", ensure);
  }, [map, shown, strength]);

  return null;
}

/** Where the sun is setting or rising right now, as a thin dashed line. */
export function DayNightLine({ now, night }: { now: number; night: boolean }) {
  // The line moves about 0.25° a minute; redrawing it each clock tick is enough.
  const data = useMemo(() => ({ type: "Feature" as const, properties: {}, geometry: { type: "LineString" as const, coordinates: terminator(now) } }), [now]);
  return (
    <Source id="day-night-line" type="geojson" data={data}>
      <Layer
        id="day-night-line"
        type="line"
        layout={{ "line-cap": "round", "line-join": "round" }}
        paint={{ "line-color": night ? "#ffd89a" : "#3c4043", "line-opacity": 0.8, "line-width": 1.6, "line-dasharray": [3, 2] }}
      />
    </Source>
  );
}
