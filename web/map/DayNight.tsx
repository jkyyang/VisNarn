/**
 * The night half of the day/night map, drawn inside MapLibre over the basemap's ground, so the rail
 * lines, the route and the place names are never covered: the night side of the Earth from
 * ./nightTiles.ts, with NASA's city lights and a soft edge where the sun is setting or rising.
 */
import { addProtocol, RasterTileSource, type LayerSpecification, type StyleSpecification } from "maplibre-gl";
import { useEffect, useRef } from "react";
import { useMap } from "react-map-gl/maplibre";
import { BLACK_MARBLE_ATTRIBUTION, BLACK_MARBLE_MAX_ZOOM } from "../data/blackMarble.ts";
import { carryOwnLayers, LABELS, STREET_SOURCE } from "./basemaps.ts";
import { loadNightTile, NIGHT_PROTOCOL, nightBucket, nightTileUrl, TILE_PX, type NightTileMode } from "./nightTiles.ts";

const LIGHTS_ID = "night-lights";

let protocolAdded = false;
/** The protocol is registered on MapLibre itself, so it is added once for every map. */
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

/**
 * Managed by hand rather than as a react-map-gl <Layer>: it must sit over the basemap's ground and under
 * everything the app draws there (Real tracks and the rail network, which deck.gl keeps right under LABELS).
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
    /** The layers `ensure` last saw; until the style changes there is nothing more to do. */
    let seen = "";
    const ensure = () => {
      if (map.getLayersOrder().join() === seen) return;
      // Undefined until the style has loaded; "styledata" calls again then.
      if (!map.getStyle()) return;
      const source = map.getSource(LIGHTS_ID);
      if (!source) {
        map.addSource(LIGHTS_ID, { type: "raster", tiles: [tiles], tileSize: TILE_PX, maxzoom: BLACK_MARBLE_MAX_ZOOM, attribution: BLACK_MARBLE_ATTRIBUTION });
      } else if (shown && source instanceof RasterTileSource && source.serialize().tiles?.[0] !== tiles) {
        // The tiles on screen stay until their redrawn copies arrive, so the map does not flash.
        source.setTiles([tiles]);
      }
      if (!map.getLayer(LIGHTS_ID)) {
        const layer: LayerSpecification = { id: LIGHTS_ID, type: "raster", source: LIGHTS_ID, layout: { visibility: "none" }, paint: { "raster-fade-duration": 0 } };
        map.addLayer(layer, LABELS);
      }
      map.setLayoutProperty(LIGHTS_ID, "visibility", shown ? "visible" : "none");
      if (shown) map.setPaintProperty(LIGHTS_ID, "raster-opacity", lightsOpacity(opacityMode, satellite));
      seen = map.getLayersOrder().join();
    };
    ensure();
    // A switch to or from Satellite replaces the whole style, this layer with it. Each change of style
    // says so with "styledata" (as do many smaller ones, which `seen` passes over).
    map.on("styledata", ensure);
    return () => void map.off("styledata", ensure);
  }, [map, mode, shown, tiles, opacityMode, satellite]);

  return null;
}

/**
 * Puts the basemap style on the map. The street looks draw the same tiles in other colours, so a switch
 * between them (Day, Night, Auto zooming in past AUTO_DARK_ZOOM at night) changes only the paint: the
 * tiles on screen and the night tiles stay. A switch to or from Satellite loads the new style clean.
 */
export function BasemapStyle({ style }: { style: StyleSpecification }) {
  const map = useMap().current?.getMap();
  const shown = useRef(style);
  useEffect(() => {
    if (!map || style === shown.current) return;
    const streets = STREET_SOURCE in style.sources && STREET_SOURCE in shown.current.sources;
    shown.current = style;
    map.setStyle(style, streets ? { diff: true, transformStyle: carryOwnLayers } : { diff: false });
  }, [map, style]);
  return null;
}
