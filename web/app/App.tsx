/**
 * The page: one map filling the window, the panel floating over its left side (on a phone, a sheet
 * under it). The URL decides which screen fills the panel; the map is created once and outlives every
 * screen change. The panel's search, the place it found and the shop picked on Shops are page state,
 * shared by the panel and the map.
 */
import { useLayoutEffect, useRef, useState, type ReactElement, type RefObject } from "react";
import type { PlaceSuggestion, ShopId } from "../../shared/places.ts";
import { useBasemap } from "../data/basemap.ts";
import { fresh, usePlace, useShops } from "../data/hooks.ts";
import { CAMERA_MARGIN_PX } from "../map/config.ts";
import { MapStage, MapStageProvider } from "../map/MapStage.tsx";
import { RouteWorkspace } from "../screens/route/RouteWorkspace.tsx";
import { ShopsScreen } from "../screens/shops/ShopsScreen.tsx";
import { ErrorBoundary } from "../ui/ErrorBoundary.tsx";
import { PanelIcon } from "../ui/icons.tsx";
import { storedChoice } from "../ui/stored.ts";
import { PanelHeader } from "./chrome.tsx";
import { PanelSearch } from "./PanelSearch.tsx";
import { useScreen, type Screen } from "./routes.ts";

/** The panel shown or folded away, kept in this browser. */
const usePanelState = storedChoice("visnarn.panel", ["open", "folded"], () => "open");

export default function App(): ReactElement {
  const screen = useScreen();
  const network = useBasemap();
  // Every screen shows the shops: when they cannot be read, the server cannot be reached.
  const shops = useShops();
  const panel = useRef<HTMLElement>(null);
  const reopen = useRef<HTMLButtonElement>(null);
  const [panelState, setPanelState] = usePanelState();
  const folded = panelState === "folded";
  const cameraLeft = useCameraLeft(panel, !folded);
  const [text, setText] = useState<string | null>(null);
  const [chosen, setChosen] = useState<PlaceSuggestion | null>(null);
  // The search flies to what it found; a shop square clicked on the map opens its card where the camera is.
  const [fly, setFly] = useState(true);
  const [selectedShop, setSelectedShop] = useState<ShopId | null>(null);
  const resolution = usePlace(chosen?.ref ?? null, "shop");
  const found = chosen && fresh(resolution);
  // On Shops a shop found is that shop selected in the list; anything else gets a pin and a card on the map.
  const asShop = screen.name === "shops" && chosen?.ref.kind === "shop";

  const choose = (suggestion: PlaceSuggestion | null, flyThere = true) => {
    setChosen(suggestion);
    setFly(flyThere);
    if (screen.name === "shops" && suggestion?.ref.kind === "shop") setSelectedShop(suggestion.ref.shopId);
  };
  const fold = (next: boolean) => {
    setPanelState(next ? "folded" : "open");
    // The focus goes with the panel: to the button that brings it back, or back into the panel.
    requestAnimationFrame(() => (next ? reopen.current : panel.current?.querySelector<HTMLElement>("input"))?.focus());
  };

  return (
    <ErrorBoundary fallback={<p className="error page-error">Something went wrong on this page. Reload to start again.</p>}>
      <MapStageProvider network={network}>
        <div className="app">
          <main className={`panel glass${folded ? " is-folded" : ""}`} ref={panel}>
            <PanelHeader
              current={screen.name}
              onCollapse={() => fold(true)}
              search={<PanelSearch chosen={chosen} problem={found && !found.ok ? found.problem.message : null} text={text} onText={setText} onChoose={choose} />}
            />
            <div className="panel-body">
              {/* The server did not answer: a red edge, with why on hover; screen readers hear it. */}
              {shops.status === "error" && (
                <button type="button" className="btn is-wrong server-note" title={shops.error.message} onClick={shops.retry}>
                  Try again
                  <span className="visually-hidden" role="alert">
                    {shops.error.message}
                  </span>
                </button>
              )}
              <ErrorBoundary key={screen.name} fallback={<p className="error page-error">This screen could not be shown. Go back or reload the page.</p>}>
                <ScreenView screen={screen} query={text ?? ""} selectedShop={selectedShop} onSelectShop={setSelectedShop} onFind={(shop) => choose(shop, false)} />
              </ErrorBoundary>
            </div>
          </main>
          {folded && (
            <button type="button" ref={reopen} className="glass panel-open" aria-label="Open panel" title="Open panel" onClick={() => fold(false)}>
              <PanelIcon />
            </button>
          )}
          <MapStage cameraLeft={cameraLeft} found={chosen && found?.ok && !asShop ? { suggestion: chosen, place: found.place, fly } : null} onCloseFound={() => setChosen(null)} />
        </div>
      </MapStageProvider>
    </ErrorBoundary>
  );
}

/**
 * The px every camera move keeps clear on the left: the open panel with a margin each side of it,
 * else the margin alone. On a phone the panel is as wide as the map and lies below it. The panel's
 * width follows the window only, so a window resize and a fold are the times to measure again.
 */
function useCameraLeft(panel: RefObject<HTMLElement | null>, open: boolean): number {
  const [left, setLeft] = useState(CAMERA_MARGIN_PX);
  useLayoutEffect(() => {
    const element = panel.current;
    const frame = element?.parentElement;
    if (!open || !element || !frame) {
      setLeft(CAMERA_MARGIN_PX);
      return;
    }
    const measure = () => {
      const { width } = element.getBoundingClientRect();
      setLeft(width < frame.getBoundingClientRect().width ? Math.round(width) + 2 * CAMERA_MARGIN_PX : CAMERA_MARGIN_PX);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [panel, open]);
  return left;
}

function ScreenView(props: { screen: Screen; query: string; selectedShop: ShopId | null; onSelectShop: (id: ShopId | null) => void; onFind: (found: PlaceSuggestion) => void }): ReactElement {
  const { screen } = props;
  switch (screen.name) {
    case "route":
      return <RouteWorkspace screen={screen} onFind={props.onFind} />;
    case "shops":
      return <ShopsScreen screen={screen} query={props.query} selected={props.selectedShop} onSelect={props.onSelectShop} />;
  }
}
