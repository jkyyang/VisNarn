/**
 * The heavy half of the map: MapLibre, the deck.gl overlay, the route pills, the layer card, zoom,
 * fit, legend, the search box. Loaded lazily by ./MapStage.tsx, which is the only importer.
 */
import type { Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { createPortal } from "react-dom";
import MapGL, { AttributionControl, useControl, useMap, type ViewStateChangeEvent } from "react-map-gl/maplibre";
import type { LngLat } from "../../shared/geo.ts";
import type { PlaceSuggestion } from "../../shared/places.ts";
import { DEFAULT_INCLUDE, drawnClasses } from "../../shared/railroads.ts";
import type { Mainline } from "../data/basemap.ts";
import { usePlace } from "../data/hooks.ts";
import { useTrackPaths } from "../data/hooks.ts";
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
import { PICK_RADIUS_PX, type MapContentProps, type MapFocus } from "./MapStage.tsx";
import { REAL_TRACKS_MIN_ZOOM, RealTracks } from "./RealTracks.tsx";
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

/** The farthest the server snaps a click (GET /api/places/nearest): zoomed far out, 36 px is more than that. */
const MAX_PICK_KM = 100;

const NETWORK_ATTRIBUTION = "Rail network: BTS NTAD North American Rail Network";
const INITIAL_VIEW = {
  bounds: [
    [NETWORK_BOUNDS[0], NETWORK_BOUNDS[1]],
    [NETWORK_BOUNDS[2], NETWORK_BOUNDS[3]],
  ] as [[number, number], [number, number]],
  fitBoundsOptions: { padding: 24 },
};
/**
 * How far the map pans: North America with a wide margin, so a glimpse of Greenland, the Caribbean
 * and northern South America stays but the map cannot drift to another continent. MapLibre keeps
 * the whole screen inside these, which also stops zooming out once they fill the screen.
 */
const PAN_BOUNDS: [[number, number], [number, number]] = [
  [-170, 5],
  [-20, 83],
];

/** Web-mercator ground distance covered by one screen pixel (MapLibre zoom levels use 512 px tiles). */
const kmPerPixel = (lat: number, zoom: number) => (40075 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom);

/**
 * In Auto, the dark street map only from this zoom in. Further out the screen spans the twilight
 * band, so the light map stays and the night tiles cover the night side, like the Earth from space;
 * from here in the screen (about 700 km) is nearly all day or all night.
 */
export const AUTO_DARK_ZOOM = 7;

/** A place found with the search box is shown this close: its yard and the lines through it. */
const FOUND_ZOOM = 12;

/** Flies to one junction when the screen asks for it. Renders nothing; must be a child of the map. */
function FlyTo({ focus }: { focus: MapFocus | undefined }) {
  const map = useMap().current;
  const key = focus?.kind === "place" ? `${focus.lon},${focus.lat},${focus.zoom}` : null;
  useEffect(() => {
    if (!map || focus?.kind !== "place") return;
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    map.flyTo({ center: [focus.lon, focus.lat], zoom: focus.zoom, duration: still ? 0 : 900 });
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
  const found = chosen && resolution.status === "ready" && !resolution.stale ? resolution.data : null;
  const [fitNonce, setFitNonce] = useState(0);
  const given = content?.scene ?? null;
  // With Real tracks on, the routes follow the surveyed track and the real lines replace the
  // network where the tiles have them; with it off, both are drawn node to node, like the network layer.
  const asked = useMemo(() => (layers.tracks && given ? routePaths(given) : []), [layers.tracks, given]);
  const onTrack = useTrackPaths(asked.length ? asked : null);
  const trackPaths = layers.tracks && onTrack.status === "ready" && !onTrack.stale ? onTrack.data : null;
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
  // Half-zoom steps: enough for the chevron spacings, without rebuilding layers on every frame of a zoom.
  const onMoveEnd = (event: ViewStateChangeEvent) => {
    setZoom(Math.floor(event.viewState.zoom * 2) / 2);
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
          setZoom(Math.floor(event.target.getZoom() * 2) / 2);
          watchCamera(event.target);
        }}
      >
        {/* deck.gl hears every map click, on an object or on empty map: one handler for both. */}
        <DeckOverlay
          layers={deckLayers}
          getTooltip={sceneTooltip}
          pickingRadius={8}
          onClick={(info) => {
            const target = sceneTarget(info);
            const current = latest.current;
            if (target === "inert" || !current) return;
            if (target && current.onSelect) return current.onSelect(target);
            if (current.onPick && info.coordinate) {
              const [lon, lat] = info.coordinate;
              current.onPick(lon, lat, Math.min(MAX_PICK_KM, PICK_RADIUS_PX * kmPerPixel(lat, info.viewport?.zoom ?? zoom)));
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
