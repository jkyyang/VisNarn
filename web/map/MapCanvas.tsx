/**
 * The heavy half of the map: MapLibre, the deck.gl overlay, the layer card, zoom, fit, legend.
 * Loaded lazily by ./MapStage.tsx, which is the only importer.
 */
import type { PickingInfo } from "deck.gl";
import type { Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import MapGL, { AttributionControl, useMap, type MapLayerMouseEvent, type ViewStateChangeEvent } from "react-map-gl/maplibre";
import type { LngLat } from "../../shared/geo.ts";
import type { Mainline } from "../data/basemap.ts";
import { useThemeColors } from "../theme.ts";
import { PHONE_QUERY, useMedia } from "../ui/media.ts";
import { basemapStyle, type BasemapKind } from "./basemaps.ts";
import type { LightMode, MapLook } from "./daylight.ts";
import { NightLights } from "./DayNight.tsx";
import { DeckOverlay } from "./DeckOverlay.tsx";
import { FitBounds } from "./FitBounds.tsx";
import { LAYER, networkLayer, sceneLayers, sceneTarget, sceneTooltip, type LabelView } from "./layers.ts";
import { Legend } from "./Legend.tsx";
import { MapControls } from "./MapControls.tsx";
import type { MapContentProps, MapFocus } from "./MapStage.tsx";
import { RealTracks } from "./RealTracks.tsx";
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

const NETWORK_ATTRIBUTION = "Rail network: BTS NTAD North American Rail Network";
/** The selected car's card on the Cars map: 360 px wide, 16 px from the edge, and 16 px of air. */
const CAR_CARD_INSET = 392;
/** On a phone the card folds to one block across the top of the map (about 64 px, 12 px from the edge). */
const CAR_CARD_TOP_PHONE = 92;
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

const noTooltip = () => null;

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
      tracksForced={!!content?.forceTracks}
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
    // A phone's map has no room for the route boxes; the route cards below it say the same.
    const drawn = scene ? sceneLayers(scene, colors, zoom, view).filter((layer) => !(narrow && (layer as { id?: string } | null)?.id === LAYER.callouts)) : [];
    return [network && networkLayer(network, layers.network, scene !== null, colors), ...drawn];
  }, [network, layers.network, scene, colors, zoom, narrow, view]);
  const watchCamera = (map: Pick<MapLibreMap, "getContainer" | "project" | "getCenter">) => {
    setView({ compact: narrow, width: map.getContainer().clientWidth - MAP_BUTTONS_PX, screenX: (position) => map.project(position).x, screenY: (position) => map.project(position).y });
    const { lng, lat } = map.getCenter();
    props.onCentre([lng, lat]);
  };

  const onMapClick = (event: MapLayerMouseEvent) => {
    const onPick = latest.current?.onPick;
    if (!onPick) return;
    const { lng, lat } = event.lngLat;
    onPick(lng, lat, PICK_RADIUS_PX * kmPerPixel(lat, event.target.getZoom()));
  };
  const onDeckClick = (info: PickingInfo) => {
    if (latest.current?.onPick) return;
    const target = sceneTarget(info);
    if (target) latest.current?.onSelect?.(target);
  };
  // Half-zoom steps: enough for the chevron spacings, without rebuilding layers on every frame of a zoom.
  const onMoveEnd = (event: ViewStateChangeEvent) => {
    setZoom(Math.floor(event.viewState.zoom * 2) / 2);
    watchCamera(event.target);
  };
  const railroadsShown = scene?.kind === "route" ? [scene.selected, ...scene.alternatives] : scene?.kind === "fleet" && scene.selected ? [scene.selected] : [];
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
        onClick={onMapClick}
        onMoveEnd={onMoveEnd}
        onLoad={(event) => {
          setZoom(Math.floor(event.target.getZoom() * 2) / 2);
          watchCamera(event.target);
        }}
      >
        <DeckOverlay layers={deckLayers} getTooltip={picking ? noTooltip : sceneTooltip} pickingRadius={6} onClick={onDeckClick} />
        <AttributionControl compact customAttribution={NETWORK_ATTRIBUTION} position="bottom-right" />
        <NightLights mode={layers.light === "day" ? "off" : layers.light} now={props.now} satellite={layers.basemap === "satellite"} />
        <FoldAttribution fold={narrow} />
        {(layers.tracks || content?.forceTracks) && <RealTracks dark={darkStreets || layers.basemap === "satellite"} />}
        {content?.focus.kind !== "place" && <FitBounds bounds={scene?.bounds ?? null} nonce={fitNonce} leftInset={scene?.kind === "fleet" && !narrow ? CAR_CARD_INSET : 0} topInset={scene?.kind === "fleet" && narrow ? CAR_CARD_TOP_PHONE : 0} />}
        <FlyTo focus={content?.focus} />
        <Controls canvas={props} onFit={() => setFitNonce((n) => n + 1)} />
      </MapGL>
      <Legend kind={scene?.kind ?? null} railroads={narrow && railroadsShown.length ? [...new Set(railroadsShown.flatMap((route) => route.legs.map((leg) => leg.railroad)))] : undefined} />
    </div>
  );
}
