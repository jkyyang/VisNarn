/**
 * The night half of the day/night map, drawn inside MapLibre (under the deck.gl canvas, so the rail
 * lines and the route are never covered): the night side of the Earth from ./nightTiles.ts, with
 * NASA's city lights and a soft edge where the sun is setting or rising.
 */
import { addProtocol, RasterTileSource, type LayerSpecification, type StyleSpecification } from "maplibre-gl";
import { useEffect, useRef } from "react";
import { useMap } from "react-map-gl/maplibre";
import { BLACK_MARBLE_ATTRIBUTION, BLACK_MARBLE_MAX_ZOOM } from "../data/blackMarble.ts";
import { carryOwnLayers, firstLabelLayer } from "./basemaps.ts";
import { AUTO_DARK_ZOOM, OCEAN_SPACE_ZOOM } from "./config.ts";
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

/** Place names over the night side: bright text on a dark halo, so they read on black and on city lights. */
const NIGHT_LABEL_PAINT = { "text-color": "#eef1f6", "text-halo-color": "rgba(8, 10, 18, 0.92)", "text-halo-width": 1.6, "text-halo-blur": 0.4 } as const;
type LabelPaintKey = keyof typeof NIGHT_LABEL_PAINT;
const LABEL_KEYS = Object.keys(NIGHT_LABEL_PAINT) as LabelPaintKey[];
interface PaintMap {
  getPaintProperty(layer: string, name: string): unknown;
  setPaintProperty(layer: string, name: string, value: unknown): void;
}
/**
 * The loaded style's own paint, kept per map so Day can put it back without reloading the style.
 * getStyle() returns a fresh copy each call, so the loaded style is told apart by its name and sprite.
 */
const savedPaint = new WeakMap<PaintMap, { style: string; paint: Map<string, unknown> }>();

/** The style's own value of one paint property, read before anything here changes it. */
function ownPaint(map: PaintMap, style: StyleSpecification, layer: string, key: string): unknown {
  const styleKey = `${style.name ?? ""}|${JSON.stringify(style.sprite ?? "")}`;
  let saved = savedPaint.get(map);
  if (!saved || saved.style !== styleKey) {
    saved = { style: styleKey, paint: new Map() };
    savedPaint.set(map, saved);
  }
  const id = `${layer}:${key}`;
  if (!saved.paint.has(id)) saved.paint.set(id, map.getPaintProperty(layer, key));
  return saved.paint.get(id);
}

/** Switches every text layer of the loaded style to the night paint, or back to its own. */
export function paintLabels(map: PaintMap, style: StyleSpecification, night: boolean): void {
  for (const layer of style.layers) {
    if (layer.type !== "symbol" || !(layer.layout && "text-field" in layer.layout)) continue;
    for (const key of LABEL_KEYS) {
      const own = ownPaint(map, style, layer.id, key);
      map.setPaintProperty(layer.id, key, night ? NIGHT_LABEL_PAINT[key] : own);
    }
  }
}

/** Open water seen from space: the deep blue that fades into Black Marble's dark night ocean. */
export const OCEAN_FROM_SPACE = "#1d4670";

/**
 * In Auto, the street map's water turns the deep blue of the Earth from space when zoomed out, so
 * the edge of night reads as day turning to night. It is the map's own colour again by AUTO_DARK_ZOOM
 * (./config.ts), where Auto switches to the dark street map at night. Satellite has no "water" layer
 * and is left alone.
 */
export function paintOcean(map: PaintMap, style: StyleSpecification, fromSpace: boolean): void {
  if (!style.layers.some((layer) => layer.id === "water")) return;
  const own = ownPaint(map, style, "water", "fill-color");
  // A zoom ramp can only end on a plain colour; any other own paint stays as it is.
  const space = typeof own === "string" ? ["interpolate", ["linear"], ["zoom"], OCEAN_SPACE_ZOOM, OCEAN_FROM_SPACE, AUTO_DARK_ZOOM, own] : own;
  map.setPaintProperty("water", "fill-color", fromSpace ? space : own);
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
    /** The layers `ensure` last saw; until the style changes there is nothing more to do. */
    let seen = "";
    const ensure = () => {
      if (map.getLayersOrder().join() === seen) return;
      // Undefined until the style has loaded; "styledata" calls again then.
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
      paintLabels(map, style, shown);
      paintOcean(map, style, mode === "auto");
      if (shown) map.setPaintProperty(LIGHTS_ID, "raster-opacity", lightsOpacity(opacityMode, satellite));
      seen = map.getLayersOrder().join();
    };
    ensure();
    // A switch to or from Satellite replaces the whole style, this layer with it; a switch between
    // the street maps keeps the layer but brings place names of their own. Each change of style says
    // so with "styledata" (as do many smaller ones, which `seen` passes over).
    map.on("styledata", ensure);
    return () => void map.off("styledata", ensure);
  }, [map, mode, shown, tiles, opacityMode, satellite]);

  return null;
}

/**
 * Puts the basemap style on the map. The light and dark street maps draw the same tiles in other
 * colours, so a switch between them (Auto, zooming in past AUTO_DARK_ZOOM at night) changes only
 * the paint and the place names: the tiles on screen, the shaded relief and the night tiles stay. A
 * switch to or from Satellite loads the new style clean.
 */
export function BasemapStyle({ style }: { style: string | StyleSpecification }) {
  const map = useMap().current?.getMap();
  const shown = useRef(style);
  useEffect(() => {
    if (!map || style === shown.current) return;
    const streets = typeof style === "string" && typeof shown.current === "string";
    shown.current = style;
    map.setStyle(style, streets ? { diff: true, transformStyle: carryOwnLayers } : { diff: false });
  }, [map, style]);
  return null;
}
