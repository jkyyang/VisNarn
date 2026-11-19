/**
 * The map, once. MapLibre and deck.gl are created a single time for the whole app and stay mounted
 * while the user moves between screens; a screen says what the map should show by rendering
 * <MapContent> anywhere in its tree.
 *
 * Layer choices (Map / Satellite, Rail network, Real tracks, Auto / Day / Night, the carrier shown
 * alone) are view state owned here. The day or night look is set on the map section, and the whole
 * page takes it from there (web/styles.css).
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
import type { LngLat } from "../../shared/geo.ts";
import type { ResolvedPlace } from "../../shared/places.ts";
import type { TrackIncluded } from "../../shared/railroads.ts";
import type { RouteStrategy } from "../../shared/route.ts";
import { canDrawMaps, type Mainline } from "../data/basemap.ts";
import { ErrorBoundary } from "../ui/ErrorBoundary.tsx";
import { NETWORK_CENTRE } from "./config.ts";
import { mapLook, sunPosition } from "./daylight.ts";
import type { MapLayerChoice } from "./MapCanvas.tsx";
import type { MapHandle } from "./MapHandles.tsx";
import type { MapScene, SceneTarget } from "./scene.ts";

/** Where the camera should be. "fit": the scene's bounds. "place": zoomed in on one place. */
export type MapFocus = { kind: "fit" } | { kind: "place"; lon: number; lat: number; zoom: number };

export interface MapContentProps {
  scene: MapScene | null;
  focus: MapFocus;
  /** The track the plan may use: the network shows the same classes. No plan: DEFAULT_INCLUDE. */
  include?: TrackIncluded;
  /** While set, the cursor is a crosshair and a click that hits nothing to select is reported here, with the grey route it landed on. */
  onPick?: (lon: number, lat: number, toleranceKm: number, line: RouteStrategy | null) => void;
  onSelect?: (target: SceneTarget) => void;
  /** Things on the map a person drags or taps: on Shops, the edited shop's pin and its links' rings. */
  handles?: MapHandle[];
  /** Undo / redo, shown in the panel's header when given. */
  history?: MapHistory;
  /** What a place found with the map's search box can become here: "Start", "Add stop". */
  placeActions?: PlaceAction[];
}

/** Undo and redo of the screen's changes; `what` names them on the buttons ("Undo route change"). */
export interface MapHistory {
  what: string;
  undo: (() => void) | null;
  redo: (() => void) | null;
}

export interface PlaceAction {
  label: string;
  run: (place: ResolvedPlace) => void;
}

/** What the screens have asked the map to show; the stage subscribes, the screens publish. */
interface Stage {
  subscribe(listener: () => void): () => void;
  content(): MapContentProps | null;
  publish(id: string, props: MapContentProps): void;
  remove(id: string): void;
}

function createStage(): Stage {
  const listeners = new Set<() => void>();
  const published = new Map<string, MapContentProps>();
  const order: string[] = [];
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

function NoMap(): ReactElement {
  return (
    <div className="no-map" role="note">
      The map could not start in this browser. Type places in the panel.
    </div>
  );
}

const noopSubscribe = () => () => {};

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

/** What the screens have asked the map to show now. */
function useStagedContent(): MapContentProps | null {
  const stage = useContext(StageContext);
  return useSyncExternalStore(stage?.subscribe ?? noopSubscribe, stage?.content ?? nothing, nothing);
}

/** The undo and redo of the screen the map shows now, for the panel's header. */
export const useStagedHistory = (): MapHistory | null => useStagedContent()?.history ?? null;

/**
 * The map element. Rendered once, by App. With no <MapContent> mounted it shows the bare network.
 * `cameraLeft`: how many px of the map every camera move keeps clear on the left, for the panel.
 */
export function MapStage(props: { cameraLeft: number }): ReactElement {
  const network = useContext(NetworkContext);
  const content = useStagedContent();
  const [layers, setLayers] = useState<MapLayerChoice>({ basemap: "map", network: true, tracks: false, light: "auto", carrier: null });
  const [drawable] = useState(canDrawMaps);
  const [centre, setCentre] = useState<LngLat>(NETWORK_CENTRE);
  const now = useNow(layers.light === "auto");
  const look = mapLook(layers.light, sunPosition(now, centre));

  return (
    <section className="map" aria-label="Map" data-picking={content?.onPick ? "true" : undefined} data-look={look.base} data-light={look.phase}>
      {drawable ? (
        <ErrorBoundary fallback={<NoMap />}>
          <Suspense fallback={<div className="map-loading">Loading the map…</div>}>
            <MapCanvas
              network={network}
              content={content}
              layers={layers}
              onLayers={setLayers}
              look={look}
              now={now}
              onCentre={setCentre}
              cameraLeft={props.cameraLeft}
            />
          </Suspense>
        </ErrorBoundary>
      ) : (
        <NoMap />
      )}
    </section>
  );
}

/** Declares what the stage shows while this component is mounted. One at a time: the most recently mounted wins. */
export function MapContent(props: MapContentProps): null {
  const stage = useContext(StageContext);
  const id = useId();
  // Every render: the props carry fresh callbacks. Only the stage re-renders, never this component's owner.
  useLayoutEffect(() => {
    stage?.publish(id, props);
  });
  useLayoutEffect(() => () => stage?.remove(id), [stage, id]);
  return null;
}
