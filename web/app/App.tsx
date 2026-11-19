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
  const covered = useCoveredLeft(panel, folded);
  const [text, setText] = useState<string | null>(null);
  const [chosen, setChosen] = useState<PlaceSuggestion | null>(null);
  const [selectedShop, setSelectedShop] = useState<ShopId | null>(null);
  const resolution = usePlace(chosen?.ref ?? null, "shop");
  const found = chosen && fresh(resolution);
  // On Shops a shop found is that shop selected in the list; anything else gets a pin and a card on the map.
  const asShop = screen.name === "shops" && chosen?.ref.kind === "shop";

  const choose = (suggestion: PlaceSuggestion | null) => {
    setChosen(suggestion);
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
              {shops.status === "error" && (
                <div className="alert server-note" role="alert">
                  <span>{shops.error.message}</span>
                  <button type="button" className="btn" onClick={shops.retry}>
                    Try again
                  </button>
                </div>
              )}
              <ErrorBoundary key={screen.name} fallback={<p className="error page-error">This screen could not be shown. Go back or reload the page.</p>}>
                <ScreenView screen={screen} query={text ?? ""} selectedShop={selectedShop} onSelectShop={setSelectedShop} />
              </ErrorBoundary>
            </div>
          </main>
          {folded && (
            <button type="button" ref={reopen} className="glass panel-open" aria-label="Open panel" title="Open panel" onClick={() => fold(false)}>
              <PanelIcon />
            </button>
          )}
          <MapStage coveredLeft={covered} found={chosen && found?.ok && !asShop ? { suggestion: chosen, place: found.place } : null} onCloseFound={() => setChosen(null)} />
        </div>
      </MapStageProvider>
    </ErrorBoundary>
  );
}

/**
 * How far the panel reaches over the map from its left edge, so the camera centres places in the
 * map that shows. On a phone the panel is as wide as the map and lies below it, and folded it is
 * gone: nothing is covered. The panel's width follows the window only, so a window resize and a
 * fold are the times to measure again.
 */
function useCoveredLeft(panel: RefObject<HTMLElement | null>, folded: boolean): number {
  const [covered, setCovered] = useState(0);
  useLayoutEffect(() => {
    const element = panel.current;
    const frame = element?.parentElement;
    if (!element || !frame) return;
    const measure = () => {
      const box = element.getBoundingClientRect();
      const map = frame.getBoundingClientRect();
      setCovered(box.width && box.width < map.width ? Math.round(box.right - map.left) : 0);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [panel, folded]);
  return covered;
}

function ScreenView(props: { screen: Screen; query: string; selectedShop: ShopId | null; onSelectShop: (id: ShopId | null) => void }): ReactElement {
  const { screen } = props;
  switch (screen.name) {
    case "route":
      return <RouteWorkspace screen={screen} />;
    case "shops":
      return <ShopsScreen screen={screen} query={props.query} selected={props.selectedShop} onSelect={props.onSelectShop} />;
  }
}
