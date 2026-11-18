/**
 * The map, once. MapLibre and deck.gl are created a single time for the whole app and stay mounted
 * while the user moves between screens; a screen says what the map should show by rendering
 * <MapContent> anywhere in its tree.
 *
 * Layer choices (Map / Satellite, Class I network, Real tracks, Auto / Day / Night) are view state
 * owned here. The day or night look is set on the whole map section, so the cards over the map
 * change with it.
 */
import {
  createContext,
  lazy,
  Suspense,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type { LngLat } from "../../shared/geo.ts";
import type { ResolvedPlace } from "../../shared/places.ts";
import type { Mainline } from "../data/basemap.ts";
import { ErrorBoundary } from "../ui/ErrorBoundary.tsx";
import { mapLook, sunPosition } from "./daylight.ts";
import type { MapLayerChoice } from "./MapCanvas.tsx";
import type { MapScene, SceneTarget } from "./scene.ts";

/** A click snaps to a track node if one is within this many screen pixels; the tolerance in km follows the zoom. */
export const PICK_RADIUS_PX = 36;

/** Where the camera should be. "fit": the scene's bounds. "place": zoomed in on one place. */
export type MapFocus = { kind: "fit" } | { kind: "place"; lon: number; lat: number; zoom: number };

export interface MapContentProps {
  scene: MapScene | null;
  focus: MapFocus;
  /** While set, the cursor is a crosshair and a click that hits nothing to select is reported here. */
  onPick?: (lon: number, lat: number, toleranceKm: number) => void;
  onSelect?: (target: SceneTarget) => void;
  /** Undo / redo of route changes, shown with the map controls when given. */
  history?: { undo: (() => void) | null; redo: (() => void) | null };
  /** What a place found with the map's search box can become here: "Set as start", "Add as stop". */
  placeActions?: PlaceAction[];
  /** Cards laid over the map (the pick prompt on Shops). */
  children?: ReactNode;
}

export interface PlaceAction {
  label: string;
  run: (place: ResolvedPlace) => void;
}

/** What the screens have asked the map to show; the stage subscribes, the screens publish. */
interface Stage {
  subscribe(listener: () => void): () => void;
  content(): MapContentProps | null;
  active(): string | null;
  host(): HTMLElement | null;
  publish(id: string, props: MapContentProps): void;
  remove(id: string): void;
  setHost(element: HTMLElement | null): void;
}

function createStage(): Stage {
  const listeners = new Set<() => void>();
  const published = new Map<string, MapContentProps>();
  const order: string[] = [];
  let host: HTMLElement | null = null;
  let current: MapContentProps | null = null;
  const notify = () => listeners.forEach((listener) => listener());
  const refresh = () => {
    const top = order[order.length - 1];
    current = top === undefined ? null : (published.get(top) ?? null);
    notify();
  };
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    content: () => current,
    active: () => order[order.length - 1] ?? null,
    host: () => host,
    publish(id, props) {
      if (!published.has(id)) order.push(id);
      published.set(id, props);
      refresh();
    },
    remove(id) {
      published.delete(id);
      const at = order.indexOf(id);
      if (at >= 0) order.splice(at, 1);
      refresh();
    },
    setHost(element) {
      if (host === element) return;
      host = element;
      notify();
    },
  };
}

const StageContext = createContext<Stage | null>(null);
const NetworkContext = createContext<Mainline | null>(null);

const MapCanvas = lazy(() => import("./MapCanvas.tsx"));

/** Wraps the app. Loads the map code on the side, so the panel never waits for it. */
export function MapStageProvider(props: { network: Mainline | null; children: ReactNode }): ReactElement {
  const [stage] = useState(createStage);
  return (
    <StageContext.Provider value={stage}>
      <NetworkContext.Provider value={props.network}>{props.children}</NetworkContext.Provider>
    </StageContext.Provider>
  );
}

/** WebGL is what MapLibre and deck.gl draw with; without it there is nothing to load. */
const canDrawMaps = () => typeof window !== "undefined" && ("WebGL2RenderingContext" in window || "WebGLRenderingContext" in window);

function NoMap(): ReactElement {
  return (
    <div className="no-map" role="note">
      The map couldn't start in this browser. Places can still be typed.
    </div>
  );
}

const noopSubscribe = () => () => {};

/** Where the sun is judged until the map reports its centre: the middle of the network. */
const NETWORK_CENTRE: LngLat = [-95.5, 38.5];
/** Dusk lasts about half an hour; a look checked every minute changes gently enough. */
const CLOCK_TICK_MS = 60_000;

/** The time now, refreshed every minute while `running`. */
function useNow(running: boolean): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, [running]);
  return now;
}
const nothing = () => null;

/** The map element. Rendered once, by App. With no <MapContent> mounted it shows the bare network. */
export function MapStage(): ReactElement {
  const stage = useContext(StageContext);
  const network = useContext(NetworkContext);
  const content = useSyncExternalStore(stage?.subscribe ?? noopSubscribe, stage?.content ?? nothing, nothing);
  const [layers, setLayers] = useState<MapLayerChoice>({ basemap: "map", network: true, tracks: false, light: "auto" });
  const [drawable] = useState(canDrawMaps);
  const [centre, setCentre] = useState<LngLat>(NETWORK_CENTRE);
  const now = useNow(layers.light === "auto");
  const look = mapLook(layers.light, sunPosition(now, centre));

  return (
    <section className="map" aria-label="Map" data-picking={content?.onPick ? "true" : undefined} data-look={look.base} data-light={look.phase}>
      {drawable ? (
        <ErrorBoundary fallback={<NoMap />}>
          <Suspense fallback={<div className="map-loading">Loading the map…</div>}>
            <MapCanvas network={network} content={content} layers={layers} onLayers={setLayers} look={look} now={now} onCentre={setCentre} />
          </Suspense>
        </ErrorBoundary>
      ) : (
        <NoMap />
      )}
      <div className="map-overlay" ref={(element) => stage?.setHost(element)} />
    </section>
  );
}

/**
 * Declares what the stage shows while this component is mounted, and portals its children into the
 * map's overlay area. One at a time: the most recently mounted wins.
 */
export function MapContent(props: MapContentProps): ReactElement | null {
  const stage = useContext(StageContext);
  const id = useId();
  // Every render: the props carry fresh callbacks. Only the stage re-renders, never this component's owner.
  useLayoutEffect(() => {
    stage?.publish(id, props);
  });
  useLayoutEffect(() => () => stage?.remove(id), [stage, id]);
  const host = useSyncExternalStore(stage?.subscribe ?? noopSubscribe, stage?.host ?? nothing, nothing);
  const active = useSyncExternalStore(stage?.subscribe ?? noopSubscribe, stage?.active ?? nothing, nothing);
  if (!stage) return props.children ? <div className="map-overlay map-overlay--inline">{props.children}</div> : null;
  return host && active === id && props.children ? createPortal(props.children, host) : null;
}
