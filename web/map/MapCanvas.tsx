/**
 * The heavy half of the map: MapLibre, the deck.gl overlay, the route pills, the layer card, zoom,
 * fit, legend. Loaded lazily by ./MapStage.tsx, which is the only importer.
 */
import type { Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import MapGL, { AttributionControl, useMap, type ViewStateChangeEvent } from "react-map-gl/maplibre";
import type { LngLat } from "../../shared/geo.ts";
import type { Mainline } from "../data/basemap.ts";
import { useThemeColors } from "../theme.ts";
import { PHONE_QUERY, useMedia } from "../ui/media.ts";
import { basemapStyle, type BasemapKind } from "./basemaps.ts";
import type { LightMode, MapLook } from "./daylight.ts";
import { NightLights } from "./DayNight.tsx";
import { DeckOverlay } from "./DeckOverlay.tsx";
import { FitBounds } from "./FitBounds.tsx";
import { networkLayer, sceneLayers, sceneTarget, sceneTooltip, type LabelView } from "./layers.ts";
import { Legend, legendFor } from "./Legend.tsx";
import { MapControls } from "./MapControls.tsx";
import type { MapContentProps, MapFocus } from "./MapStage.tsx";
import { RealTracks } from "./RealTracks.tsx";
import { RouteMarks } from "./RouteMarks.tsx";
import { NETWORK_BOUNDS } from "./scene.ts";

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

/** A click snaps to a track node if one is within this many screen pixels; the tolerance in km follows the zoom. */
export const PICK_RADIUS_PX = 36;
/** The farthest the server snaps a click (GET /api/places/nearest): zoomed far out, 36 px is more than that. */
const MAX_PICK_KM = 100;

const NETWORK_ATTRIBUTION = "Rail network: BTS NTAD North American Rail Network";
/** The round buttons down the map's right edge, with their margin. */
const MAP_BUTTONS_PX = 60;
const INITIAL_VIEW = {
  bounds: [
    [NETWORK_BOUNDS[0], NETWORK_BOUNDS[1]],
    [NETWORK_BOUNDS[2], NETWORK_BOUNDS[3]],
  ] as [[number, number], [number, number]],
  fitBoundsOptions: { padding: 24 },
};

/** Web-mercator ground distance covered by one screen pixel (MapLibre zoom levels use 512 px tiles). */
const kmPerPixel = (lat: number, zoom: number) => (40075 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom);

/**
 * In Auto, the dark street map only from this zoom in. Further out the screen spans the twilight
 * band, so the light map stays and the night tiles cover the night side, like the Earth from space;
 * from here in the screen (about 700 km) is nearly all day or all night.
 */
export const AUTO_DARK_ZOOM = 7;

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
 * MapLibre opens a compact attribution at first and folds it only after the first drag. On a phone
 * it would cover the legend, so it starts folded there; the (i) button opens it.
 */
function FoldAttribution({ fold }: { fold: boolean }) {
  const map = useMap().current;
  useEffect(() => {
    if (!map || !fold) return;
    const tryFold = () => {
      const open = map.getContainer().querySelector(".maplibregl-ctrl-attrib.maplibregl-compact-show");
      if (!open) return;
      open.classList.remove("maplibregl-compact-show");
      map.off("idle", tryFold);
    };
    map.on("idle", tryFold);
    tryFold();
    return () => void map.off("idle", tryFold);
  }, [map, fold]);
  return null;
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
  const [fitNonce, setFitNonce] = useState(0);
  const scene = content?.scene ?? null;
  const picking = !!content?.onPick;
  const latest = useRef(content);
  latest.current = content;

  const narrow = useMedia(PHONE_QUERY);
  // Labels that must stay on screen need the camera; it is read again whenever the map stops moving.
  const [view, setView] = useState<LabelView | undefined>(undefined);
  const deckLayers = useMemo(() => {
    const drawn = scene ? sceneLayers(scene, colors, zoom, view) : [];
    // The network dims under a route (and under the shops), so that is what the eye finds.
    const dimmed = scene?.kind === "shops" || (scene?.kind === "route" && scene.selected !== null);
    return [network && networkLayer(network, layers.network, dimmed, colors), ...drawn];
  }, [network, layers.network, scene, colors, zoom, view]);
  const watchCamera = (map: Pick<MapLibreMap, "getContainer" | "project" | "getCenter">) => {
    setView({ width: map.getContainer().clientWidth - MAP_BUTTONS_PX, screenX: (position) => map.project(position).x, screenY: (position) => map.project(position).y });
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
    <div className="map-canvas" ref={root}>
      <MapGL
        initialViewState={INITIAL_VIEW}
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
        <AttributionControl compact customAttribution={NETWORK_ATTRIBUTION} position="bottom-right" />
        <NightLights mode={layers.light === "day" ? "off" : layers.light} now={props.now} satellite={layers.basemap === "satellite"} />
        <FoldAttribution fold={narrow} />
        {layers.tracks && <RealTracks dark={darkStreets || layers.basemap === "satellite"} />}
        {content?.focus.kind !== "place" && <FitBounds bounds={scene?.bounds ?? null} nonce={fitNonce} />}
        <FlyTo focus={content?.focus} />
        <Controls canvas={props} onFit={() => setFitNonce((n) => n + 1)} />
        {scene?.kind === "route" && <RouteMarks scene={scene} onSelect={(target) => latest.current?.onSelect?.(target)} />}
      </MapGL>
      <Legend {...legendFor(scene)} />
    </div>
  );
}
