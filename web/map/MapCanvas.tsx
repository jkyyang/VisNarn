/**
 * The heavy half of the map: MapLibre, the deck.gl overlay, the route pills, the layer card, zoom,
 * fit, legend, the search box. Loaded lazily by ./MapStage.tsx, which is the only importer.
 */
import type { Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { createPortal } from "react-dom";
import MapGL, { AttributionControl, useControl, useMap, type ViewStateChangeEvent } from "react-map-gl/maplibre";
import type { LngLat } from "../../shared/geo.ts";
import { NEAREST_MAX_KM, type PlaceSuggestion } from "../../shared/places.ts";
import { DEFAULT_INCLUDE, drawnClasses } from "../../shared/railroads.ts";
import type { Mainline } from "../data/basemap.ts";
import { fresh, usePlace, useTrackPaths } from "../data/hooks.ts";
import { useThemeColors } from "../theme.ts";
import { basemapStyle, type BasemapKind } from "./basemaps.ts";
import type { LightMode, MapLook } from "./daylight.ts";
import { NightLights } from "./DayNight.tsx";
import { DeckOverlay } from "./DeckOverlay.tsx";
import { FitBounds } from "./FitBounds.tsx";
import { FoundPin } from "./FoundPin.tsx";
import { networkLayers, sceneLayers, sceneTarget, sceneTooltip } from "./layers.ts";
import { Legend, legendFor } from "./Legend.tsx";
import { MapControls } from "./MapControls.tsx";
import { MapSearch } from "./MapSearch.tsx";
import { AUTO_DARK_ZOOM, DECK_PICK_RADIUS_PX, FLY_MS, FOUND_ZOOM, INITIAL_PADDING_PX, PAN_BOUNDS, PICK_RADIUS_PX, REAL_TRACKS_MIN_ZOOM } from "./config.ts";
import type { MapContentProps, MapFocus } from "./MapStage.tsx";
import { RealTracks } from "./RealTracks.tsx";
import { RouteMarks } from "./RouteMarks.tsx";
import { NETWORK_BOUNDS, routePaths, withRoutePaths } from "./scene.ts";

export interface MapLayerChoice {
  basemap: BasemapKind;
  network: boolean;
  tracks: boolean;
  /** Auto follows the clock at the map centre; Day and Night stay put. */
  light: LightMode;
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
}


const NETWORK_ATTRIBUTION = "Rail network: BTS NTAD North American Rail Network";
const INITIAL_VIEW = {
  bounds: [
    [NETWORK_BOUNDS[0], NETWORK_BOUNDS[1]],
    [NETWORK_BOUNDS[2], NETWORK_BOUNDS[3]],
  ] as [[number, number], [number, number]],
  fitBoundsOptions: { padding: INITIAL_PADDING_PX },
};

/** Half-zoom steps: enough for the chevron spacings, without rebuilding layers on every frame of a zoom. */
const halfZoom = (zoom: number) => Math.floor(zoom * 2) / 2;

/** Web-mercator ground distance covered by one screen pixel (MapLibre zoom levels use 512 px tiles). */
const kmPerPixel = (lat: number, zoom: number) => (40075 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom);


/** Flies to one junction when the screen asks for it. Renders nothing; must be a child of the map. */
function FlyTo({ focus }: { focus: MapFocus | undefined }) {
  const map = useMap().current;
  const key = focus?.kind === "place" ? `${focus.lon},${focus.lat},${focus.zoom}` : null;
  useEffect(() => {
    if (!map || focus?.kind !== "place") return;
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    map.flyTo({ center: [focus.lon, focus.lat], zoom: focus.zoom, duration: still ? 0 : FLY_MS });
    // Keyed on the numbers: a re-render with the same place must not pull the camera back.
  }, [map, key]);
  return null;
}

/**
 * MapLibre opens a compact attribution at first and folds it only after the first drag. Open, it
 * lifts the legend above it, so it starts folded; the (i) button opens it.
 */
function FoldAttribution() {
  const map = useMap().current;
  useEffect(() => {
    if (!map) return;
    const tryFold = () => {
      const open = map.getContainer().querySelector(".maplibregl-ctrl-attrib.maplibregl-compact-show");
      if (!open) return;
      open.classList.remove("maplibregl-compact-show");
      map.off("idle", tryFold);
    };
    map.on("idle", tryFold);
    tryFold();
    return () => void map.off("idle", tryFold);
  }, [map]);
  return null;
}

/**
 * The legend as a control in the map's bottom-left corner, added after the credits: MapLibre stacks
 * the controls of a corner, so the legend sits above the credits and the two never overlap.
 */
function CornerLegend(props: Parameters<typeof Legend>[0]) {
  const [box] = useState(() => Object.assign(document.createElement("div"), { className: "maplibregl-ctrl" }));
  useControl(() => ({ onAdd: () => box, onRemove: () => box.remove() }), { position: "bottom-left" });
  return createPortal(<Legend {...props} />, box);
}

/** The controls need the map instance for zoom, so they live inside the map. */
function Controls(props: { canvas: MapCanvasProps; onFit: () => void }): ReactElement {
  const map = useMap().current;
  const { content, layers, onLayers } = props.canvas;
  return (
    <MapControls
      layers={layers}
      onLayers={onLayers}
      look={props.canvas.look}
      onZoom={(step) => (step > 0 ? map?.zoomIn() : map?.zoomOut())}
      onFit={props.onFit}
      history={content?.history ?? null}
    />
  );
}

export default function MapCanvas(props: MapCanvasProps): ReactElement {
  const { network, content, layers, look } = props;
  const root = useRef<HTMLDivElement>(null);
  const colors = useThemeColors(root, look.base);
  const [zoom, setZoom] = useState(3);
  const [chosen, setChosen] = useState<PlaceSuggestion | null>(null);
  const resolution = usePlace(chosen?.ref ?? null, "shop");
  const found = chosen && fresh(resolution);
  const [fitNonce, setFitNonce] = useState(0);
  const given = content?.scene ?? null;
  // With Real tracks on, the routes follow the surveyed track and the real lines replace the
  // network where the tiles have them; with it off, both are drawn node to node, like the network layer.
  const asked = useMemo(() => (layers.tracks && given ? routePaths(given) : []), [layers.tracks, given]);
  const onTrack = useTrackPaths(asked.length ? asked : null);
  const trackPaths = layers.tracks ? fresh(onTrack) : null;
  const scene = useMemo(() => (given && trackPaths ? withRoutePaths(given, trackPaths) : given), [given, trackPaths]);
  const networkShown = layers.network && !(layers.tracks && zoom >= REAL_TRACKS_MIN_ZOOM);
  const include = content?.include ?? DEFAULT_INCLUDE;
  const networkClasses = useMemo(() => (networkShown ? drawnClasses(include) : []), [networkShown, include]);
  const picking = !!content?.onPick;
  const latest = useRef(content);
  latest.current = content;

  const deckLayers = useMemo(() => {
    const drawn = scene ? sceneLayers(scene, colors, zoom) : [];
    // The network dims under a route (and under the shops), so that is what the eye finds.
    const dimmed = scene?.kind === "shops" || (scene?.kind === "route" && scene.selected !== null);
    return [...(network ? networkLayers(network, networkClasses, dimmed, colors) : []), ...drawn];
  }, [network, networkClasses, scene, colors, zoom]);
  const watchCamera = (map: Pick<MapLibreMap, "getCenter">) => {
    const { lng, lat } = map.getCenter();
    props.onCentre([lng, lat]);
  };
  const onMoveEnd = (event: ViewStateChangeEvent) => {
    setZoom(halfZoom(event.viewState.zoom));
    watchCamera(event.target);
  };
  const darkStreets = look.base === "night" && (layers.light === "night" || zoom >= AUTO_DARK_ZOOM);

  return (
    <div className="map-canvas" ref={root} data-network={networkShown ? "shown" : "hidden"} data-network-classes={networkClasses.filter((c) => network?.[c].length).join(" ")}>
      <MapGL
        initialViewState={INITIAL_VIEW}
        maxBounds={PAN_BOUNDS}
        // `zoom` changes only when a move ends, so the style never swaps in the middle of a zoom.
        mapStyle={basemapStyle(layers.basemap, darkStreets)}
        // Map ↔ Satellite ↔ dark share nothing, so load each style clean instead of diffing into it.
        styleDiffing={false}
        attributionControl={false}
        cursor={picking ? "crosshair" : undefined}
        // Every click places something, so a double click must not also zoom.
        doubleClickZoom={false}
        onMoveEnd={onMoveEnd}
        onLoad={(event) => {
          setZoom(halfZoom(event.target.getZoom()));
          watchCamera(event.target);
        }}
      >
        {/* deck.gl hears every map click, on an object or on empty map: one handler for both. */}
        <DeckOverlay
          layers={deckLayers}
          getTooltip={sceneTooltip}
          pickingRadius={DECK_PICK_RADIUS_PX}
          onClick={(info) => {
            const target = sceneTarget(info);
            const current = latest.current;
            if (target === "inert" || !current) return;
            if (target && current.onSelect) return current.onSelect(target);
            if (current.onPick && info.coordinate) {
              const [lon, lat] = info.coordinate;
              current.onPick(lon, lat, Math.min(NEAREST_MAX_KM, PICK_RADIUS_PX * kmPerPixel(lat, info.viewport?.zoom ?? zoom)));
            }
          }}
        />
        <AttributionControl compact customAttribution={NETWORK_ATTRIBUTION} position="bottom-left" />
        <CornerLegend {...legendFor(scene, networkClasses)} />
        <NightLights mode={layers.light === "day" ? "off" : layers.light} now={props.now} satellite={layers.basemap === "satellite"} />
        <FoldAttribution />
        {layers.tracks && <RealTracks dark={darkStreets || layers.basemap === "satellite"} />}
        {content?.focus.kind !== "place" && <FitBounds bounds={scene?.bounds ?? null} nonce={fitNonce} />}
        <FlyTo focus={content?.focus} />
        <FlyTo focus={found?.ok ? { kind: "place", lon: found.place.lon, lat: found.place.lat, zoom: FOUND_ZOOM } : undefined} />
        <Controls canvas={props} onFit={() => setFitNonce((n) => n + 1)} />
        {scene?.kind === "route" && <RouteMarks scene={scene} onSelect={(target) => latest.current?.onSelect?.(target)} />}
        {chosen && found?.ok && <FoundPin chosen={chosen} place={found.place} actions={content?.placeActions ?? []} onClose={() => setChosen(null)} />}
      </MapGL>
      <MapSearch chosen={chosen} problem={found && !found.ok ? found.problem.message : null} onChoose={setChosen} />
    </div>
  );
}
