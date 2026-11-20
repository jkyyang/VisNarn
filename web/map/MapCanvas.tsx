/**
 * The heavy half of the map: MapLibre, the deck.gl overlay, the route pills, the map controls and
 * their Layers card, the credits, the place found with the panel's search. Loaded lazily by
 * ./MapStage.tsx, which is the only importer.
 */
import type { Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import MapGL, { useMap, type ViewStateChangeEvent } from "react-map-gl/maplibre";
import type { LngLat } from "../../shared/geo.ts";
import { NEAREST_MAX_KM } from "../../shared/places.ts";
import { DEFAULT_INCLUDE, drawnClasses, type Railroad } from "../../shared/railroads.ts";
import type { Mainline } from "../data/basemap.ts";
import { fresh, useTrackPaths } from "../data/hooks.ts";
import { useThemeColors } from "../theme.ts";
import { pressClosesPopover } from "../ui/popover.ts";
import { basemapStyle, type BasemapKind } from "./basemaps.ts";
import type { LightMode, MapLook } from "./daylight.ts";
import { Credits } from "./Credits.tsx";
import { BasemapStyle, NightLights } from "./DayNight.tsx";
import { DeckOverlay } from "./DeckOverlay.tsx";
import { FitBounds } from "./FitBounds.tsx";
import { Flash } from "./Flash.tsx";
import { FoundPin } from "./FoundPin.tsx";
import { lineAt, networkLayers, sceneLayers, sceneTarget, sceneTooltip } from "./layers.ts";
import { MapHandles } from "./MapHandles.tsx";
import { MapControls } from "./MapControls.tsx";
import {
  AUTO_DARK_ZOOM, CAMERA_MARGIN_PX, DECK_PICK_RADIUS_PX, DETAIL_MIN_ZOOM, FIT_MS, FLY_MS, FOUND_ZOOM, INITIAL_PADDING_PX, MAX_PIXEL_RATIO, PAN_BOUNDS,
  PICK_RADIUS_PX, REAL_TRACKS_MIN_ZOOM, SPARE_TILE_TEXTURES, TILE_CACHE_MAX_TILES,
} from "./config.ts";
import type { Covered, Found, MapContentProps, MapFocus } from "./MapStage.tsx";
import { RealTracks } from "./RealTracks.tsx";
import { RouteMarks } from "./RouteMarks.tsx";
import { SceneLabels } from "./SceneLabels.tsx";
import { NETWORK_BOUNDS, routePaths, withRoutePaths } from "./scene.ts";

export interface MapLayerChoice {
  basemap: BasemapKind;
  network: boolean;
  tracks: boolean;
  /** Auto follows the clock at the map centre; Day and Night stay put. */
  light: LightMode;
  /** The one carrier shown alone (Carriers in the Layers card); null: all of them. */
  carrier: Railroad | null;
}

export interface MapCanvasProps {
  network: Mainline | null;
  content: MapContentProps | null;
  layers: MapLayerChoice;
  onLayers: (next: MapLayerChoice) => void;
  /** The day or night look for the clock and the map centre, worked out by the stage. */
  look: MapLook;
  /** The clock the look was worked out for, as epoch ms; Auto's night tiles follow it too. */
  now: number;
  /** Where the map centre is after each move, for the sun's position. */
  onCentre: (centre: LngLat) => void;
  /**
   * The map under the panel, which every fit, flight and reset frames clear of. Given to each camera
   * move, never set as the camera's padding: MapLibre keeps PAN_BOUNDS on the whole canvas only, so a
   * padded camera would show past them beside the panel. A sheet that moves moves no camera; the next move frames clear of it.
   */
  covered: Covered;
  /** The place chosen in the panel's search: its pin and card, and the camera flies there when `fly`. */
  found: Found | null;
  onCloseFound: () => void;
  /** The map's WebGL context is gone (a phone short of graphics memory): this canvas draws nothing more. */
  onContextLost: () => void;
}

/** The whole network, clear of the panel: where the map opens, and where Reset view goes back to. */
const networkView = (covered: Covered) => ({
  bounds: [
    [NETWORK_BOUNDS[0], NETWORK_BOUNDS[1]],
    [NETWORK_BOUNDS[2], NETWORK_BOUNDS[3]],
  ] as [[number, number], [number, number]],
  fitBoundsOptions: {
    padding: { top: covered.top + INITIAL_PADDING_PX, right: INITIAL_PADDING_PX, bottom: covered.bottom + INITIAL_PADDING_PX, left: covered.left + CAMERA_MARGIN_PX },
  },
});

const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** A finger covers more of the map than a mouse pointer: a tap picks a thin line from further off. */
const pickRadius = () => (matchMedia("(pointer: coarse)").matches ? DECK_PICK_RADIUS_PX.finger : DECK_PICK_RADIUS_PX.mouse);

/** Half-zoom steps: enough for the chevron spacings, without rebuilding layers on every frame of a zoom. */
const halfZoom = (zoom: number) => Math.floor(zoom * 2) / 2;

/** Web-mercator ground distance covered by one screen pixel (MapLibre zoom levels use 512 px tiles). */
const kmPerPixel = (lat: number, zoom: number) => (40075 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom);

/** Flies to one place when the screen asks for it, into the middle of the map the panel leaves free. Renders nothing; must be a child of the map. */
function FlyTo({ focus, covered }: { focus: MapFocus | undefined; covered: Covered }) {
  const map = useMap().current;
  const key = focus?.kind === "place" ? `${focus.lon},${focus.lat},${focus.zoom}` : null;
  useEffect(() => {
    if (!map || focus?.kind !== "place") return;
    // `essential`: the duration already follows reduced motion, and MapLibre's own fallback for it would drop the offset.
    map.flyTo({ center: [focus.lon, focus.lat], zoom: focus.zoom, offset: [covered.left / 2, (covered.top - covered.bottom) / 2], duration: still() ? 0 : FLY_MS, essential: true });
    // Keyed on the numbers: a re-render with the same place must not pull the camera back.
  }, [map, key]);
  return null;
}

/**
 * MapLibre 4 keeps the texture of every raster tile it drops, to reuse for the next one, and never
 * frees any: after a basemap switch or a long zoom it held over 300 (about 220 MB of graphics
 * memory at 1440 × 900). Once the map is idle, all but SPARE_TILE_TEXTURES of each size are freed.
 */
function FreeSpareTextures() {
  const map = useMap().current?.getMap();
  useEffect(() => {
    if (!map) return;
    const free = () => {
      for (const spare of Object.values(map.painter._tileTextures)) for (const texture of spare.splice(SPARE_TILE_TEXTURES)) texture.destroy();
    };
    map.on("idle", free);
    return () => void map.off("idle", free);
  }, [map]);
  return null;
}

/** Two fingers and the keyboard zoom the map and never turn it, from the moment the map exists: a twist while it still loads included. Renders nothing; must be a child of the map. */
function NorthUp() {
  const map = useMap().current?.getMap();
  useEffect(() => {
    map?.touchZoomRotate.disableRotation();
    map?.keyboard.disableRotation();
  }, [map]);
  return null;
}

/** Tells the stage when the map's WebGL context is lost, from the moment the map exists. Renders nothing; must be a child of the map. */
function ContextLost({ onLost }: { onLost: () => void }) {
  const map = useMap().current?.getMap();
  useEffect(() => {
    if (!map) return;
    map.on("webglcontextlost", onLost);
    return () => void map.off("webglcontextlost", onLost);
  }, [map, onLost]);
  return null;
}

/** The controls need the map instance for zoom and reset, so they live inside the map. */
function Controls(props: { canvas: MapCanvasProps; onPreview: (carrier: Railroad | null) => void }): ReactElement {
  const map = useMap().current;
  const { layers, onLayers, covered } = props.canvas;
  const reset = () => {
    const { bounds, fitBoundsOptions } = networkView(covered);
    map?.fitBounds(bounds, { ...fitBoundsOptions, duration: still() ? 0 : FIT_MS });
  };
  return (
    <MapControls
      layers={layers}
      onLayers={onLayers}
      look={props.canvas.look}
      onPreview={props.onPreview}
      onZoom={(step) => (step > 0 ? map?.zoomIn() : map?.zoomOut())}
      onReset={reset}
    />
  );
}

export default function MapCanvas(props: MapCanvasProps): ReactElement {
  const { network, content, layers, look } = props;
  const root = useRef<HTMLDivElement>(null);
  const colors = useThemeColors(root, look.base);
  const [zoom, setZoom] = useState(3);
  const { found } = props;
  const [preview, setPreview] = useState<Railroad | null>(null);
  // The carrier in colour: the one the pointer rests on in the Carriers list, else the one shown alone; null: all alike.
  const carrier = preview ?? layers.carrier;
  const given = content?.scene ?? null;
  // With Real tracks on, the routes follow the surveyed track and the real lines replace the
  // network where the tiles have them; with it off, both are drawn node to node, like the network layer.
  const asked = useMemo(() => (layers.tracks && given ? routePaths(given) : []), [layers.tracks, given]);
  const onTrack = useTrackPaths(asked.length ? asked : null);
  const trackPaths = layers.tracks ? fresh(onTrack) : null;
  const scene = useMemo(() => (given && trackPaths ? withRoutePaths(given, trackPaths) : given), [given, trackPaths]);
  const networkShown = layers.network && !(layers.tracks && zoom >= REAL_TRACKS_MIN_ZOOM);
  const include = content?.include ?? DEFAULT_INCLUDE;
  // Zoomed out, the main lines only.
  const mainOnly = zoom < DETAIL_MIN_ZOOM;
  const networkClasses = useMemo(
    () => (networkShown ? drawnClasses(include).filter((c) => !mainOnly || (c !== "regional" && c !== "short_line")) : []),
    [networkShown, include, mainOnly],
  );
  const underRoute = scene?.kind === "route" && scene.selected !== null;
  // Auto zoomed out shows the Earth from space, the day side and the night side at once (./basemaps.ts).
  const fromSpace = layers.light === "auto" && zoom < AUTO_DARK_ZOOM;
  const picking = !!content?.onPick;
  const dragging = useRef(false);
  const latest = useRef(content);
  latest.current = content;

  const deckLayers = useMemo(() => {
    const drawn = scene ? sceneLayers(scene, colors, zoom) : [];
    return [...(network ? networkLayers(network, networkClasses, { carrier, underRoute, fromSpace }, colors) : []), ...drawn];
  }, [network, networkClasses, carrier, underRoute, fromSpace, scene, colors, zoom]);
  const watchCamera = (map: Pick<MapLibreMap, "getCenter">) => {
    const { lng, lat } = map.getCenter();
    props.onCentre([lng, lat]);
  };
  const onMoveEnd = (event: ViewStateChangeEvent) => {
    setZoom(halfZoom(event.viewState.zoom));
    watchCamera(event.target);
  };
  const darkStreets = look.base === "night" && (layers.light === "night" || zoom >= AUTO_DARK_ZOOM);
  // The same object for the same look (./basemaps.ts): the first one goes to MapLibre, every later one to <BasemapStyle>.
  const style = basemapStyle(layers.basemap, { ground: darkStreets ? "night" : "day", fromSpace: layers.light === "auto" });
  const [firstStyle] = useState(style);

  return (
    <div
      className="map-canvas"
      ref={root}
      data-network={networkShown ? "shown" : "hidden"}
      data-network-classes={networkClasses.filter((c) => network?.[c].length).join(" ")}
      data-carrier={carrier ?? undefined}
    >
      <MapGL
        initialViewState={networkView(props.covered)}
        maxBounds={PAN_BOUNDS}
        mapStyle={firstStyle}
        maxTileCacheSize={TILE_CACHE_MAX_TILES}
        pixelRatio={Math.min(devicePixelRatio, MAX_PIXEL_RATIO)}
        attributionControl={false}
        // Every click places something, so a double click must not also zoom.
        doubleClickZoom={false}
        // North stays up: the chevrons, the pills and the fits are laid out on a north-up screen, and no button turns it back.
        dragRotate={false}
        touchPitch={false}
        maxPitch={0}
        onMoveEnd={onMoveEnd}
        onDragStart={() => (dragging.current = true)}
        onDragEnd={() => (dragging.current = false)}
        onLoad={(event) => {
          setZoom(halfZoom(event.target.getZoom()));
          watchCamera(event.target);
        }}
      >
        {/* deck.gl hears every map click, on an object or on empty map: one handler for both. */}
        <DeckOverlay
          layers={deckLayers}
          getTooltip={sceneTooltip}
          // deck.gl sets the cursor of the map's canvas on every frame: grabbing while the map is dragged, a
          // crosshair while a click places something, a pointer on what a click selects, else none of its
          // own, so MapLibre's grab shows through.
          getCursor={({ isHovering }) => (dragging.current ? "grabbing" : picking ? "crosshair" : isHovering ? "pointer" : "")}
          pickingRadius={pickRadius()}
          onClick={(info) => {
            const target = sceneTarget(info);
            const current = latest.current;
            if (!current || pressClosesPopover()) return;
            // While a click places something, a pin or a shop square is still itself; a line under it is a spot on the map.
            const line = target?.kind === "option" || target?.kind === "leg";
            if (target && current.onSelect && !(line && current.onPick)) return current.onSelect(target);
            if (current.onPick && info.coordinate) {
              // West of 180° the map draws the world again (PAN_BOUNDS); a longitude goes to the server between -180 and 180.
              const lon = ((info.coordinate[0] + 540) % 360) - 180;
              const lat = info.coordinate[1];
              current.onPick(lon, lat, Math.min(NEAREST_MAX_KM, PICK_RADIUS_PX * kmPerPixel(lat, info.viewport?.zoom ?? zoom)), lineAt(info));
            }
          }}
        />
        {/* `zoom` changes only when a move ends, so the style never changes in the middle of a zoom. */}
        <BasemapStyle style={style} />
        <FreeSpareTextures />
        <NorthUp />
        <ContextLost onLost={props.onContextLost} />
        <NightLights mode={layers.light === "day" ? "off" : layers.light} now={props.now} satellite={layers.basemap === "satellite"} />
        {layers.tracks && <RealTracks dark={darkStreets || layers.basemap === "satellite"} onStreets={layers.basemap === "map"} />}
        <SceneLabels scene={scene} colors={colors} />
        {content?.focus.kind !== "place" && <FitBounds bounds={scene?.bounds ?? null} covered={props.covered} />}
        <FlyTo focus={content?.focus} covered={props.covered} />
        <FlyTo focus={content?.flyTo} covered={props.covered} />
        <FlyTo focus={found?.fly ? { kind: "place", lon: found.place.lon, lat: found.place.lat, zoom: FOUND_ZOOM } : undefined} covered={props.covered} />
        <Controls canvas={props} onPreview={setPreview} />
        <Credits />
        {scene?.kind === "route" && <RouteMarks scene={scene} onSelect={(target) => latest.current?.onSelect?.(target)} />}
        {content?.handles && <MapHandles handles={content.handles} />}
        {content?.flash && <Flash key={content.flash.key} flash={content.flash} />}
        {found && <FoundPin chosen={found.suggestion} place={found.place} actions={content?.placeActions ?? []} onClose={props.onCloseFound} />}
      </MapGL>
    </div>
  );
}
