/**
 * The night half of the day/night map, drawn inside MapLibre (under the deck.gl canvas, so the rail
 * lines and the route are never covered): the night side of the Earth from ./nightTiles.ts, with
 * NASA's city lights and a soft edge where the sun is setting or rising.
 */
import { addProtocol, RasterTileSource, type LayerSpecification, type StyleSpecification } from "maplibre-gl";
import { useEffect } from "react";
import { useMap } from "react-map-gl/maplibre";
import { BLACK_MARBLE_ATTRIBUTION, BLACK_MARBLE_MAX_ZOOM } from "../data/blackMarble.ts";
import { loadNightTile, NIGHT_PROTOCOL, nightBucket, nightTileUrl, TILE_PX, type NightTileMode } from "./nightTiles.ts";

const LIGHTS_ID = "night-lights";

let protocolAdded = false;
/** The protocol is global to MapLibre, not to one map: added once. */
function ensureProtocol(): void {
  if (protocolAdded) return;
  addProtocol(NIGHT_PROTOCOL, loadNightTile);
  protocolAdded = true;
}

const ramp = (z0: number, o0: number, z1: number, o1: number) => ["interpolate", ["linear"], ["zoom"], z0, o0, z1, o1];

/**
 * How much of the night tiles shows. Their 8th-level pixels blur when zoomed in, so they fade a
 * little there and let the street map or the photo through. Auto keeps them fully opaque zoomed
 * out: the night side then is the Black Marble picture itself, the Earth seen from space.
 */
function lightsOpacity(mode: NightTileMode, satellite: boolean) {
  if (satellite) return ramp(8, 1, 12, 0.8);
  return mode === "night" ? ramp(6, 0.95, 11, 0.3) : ramp(7, 1, 11, 0.35);
}

/** Under the place names, so towns stay labelled: the first text layer of whatever style is loaded. */
function firstLabelLayer(style: StyleSpecification): string | undefined {
  return style.layers.find((layer) => layer.type === "symbol" || layer.id === "labels")?.id;
}

/**
 * Managed by hand rather than as a react-map-gl <Layer>: its place in the stack depends on the
 * loaded style's own layer ids, which change with every basemap switch.
 *
 * `mode` "off" hides it (Day); "night" is night everywhere; "auto" follows the sun at `now`, redrawn
 * every 10 minutes (only the pixel maths reruns: the downloads are kept).
 */
export function NightLights({ mode, now, satellite }: { mode: NightTileMode | "off"; now: number; satellite: boolean }) {
  const map = useMap().current?.getMap();
  const shown = mode !== "off";
  const tiles = nightTileUrl(mode === "off" ? "night" : mode, nightBucket(now));
  const opacityMode: NightTileMode = mode === "auto" ? "auto" : "night";

  useEffect(() => {
    if (!map) return;
    ensureProtocol();
    const ensure = () => {
      // Undefined until the style has loaded; "style.load" calls again then.
      const style = map.getStyle();
      if (!style) return;
      const source = map.getSource(LIGHTS_ID);
      if (!source) {
        map.addSource(LIGHTS_ID, { type: "raster", tiles: [tiles], tileSize: TILE_PX, maxzoom: BLACK_MARBLE_MAX_ZOOM, attribution: BLACK_MARBLE_ATTRIBUTION });
      } else if (shown && source instanceof RasterTileSource && source.serialize().tiles?.[0] !== tiles) {
        // The tiles on screen stay until their redrawn copies arrive, so the map does not flash.
        source.setTiles([tiles]);
      }
      if (!map.getLayer(LIGHTS_ID)) {
        const layer: LayerSpecification = { id: LIGHTS_ID, type: "raster", source: LIGHTS_ID, layout: { visibility: "none" }, paint: { "raster-fade-duration": 0 } };
        map.addLayer(layer, firstLabelLayer(style));
      }
      map.setLayoutProperty(LIGHTS_ID, "visibility", shown ? "visible" : "none");
      if (shown) map.setPaintProperty(LIGHTS_ID, "raster-opacity", lightsOpacity(opacityMode, satellite));
    };
    ensure();
    // A basemap switch replaces the whole style, this layer with it.
    map.on("style.load", ensure);
    return () => void map.off("style.load", ensure);
  }, [map, shown, tiles, opacityMode, satellite]);

  return null;
}
