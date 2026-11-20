/**
 * The page: one map filling the window, the panel floating over its left side (on a phone, a sheet
 * over its foot). The URL decides which screen fills the panel; the map is created once and outlives every
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
import { WhyTip } from "../ui/WhyTip.tsx";
import { PanelHeader } from "./chrome.tsx";
import { PanelSearch } from "./PanelSearch.tsx";
import { useScreen, type Screen } from "./routes.ts";
import { showSheet, useSheet } from "./sheet.ts";

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
  const coveredLeft = useCoveredLeft(panel, !folded);
  const sheet = useSheet(panel);
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
    // On a phone the sheet lowers to half, for the place flown to.
    if (suggestion && flyThere) showSheet("half");
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
          <main className={`panel glass${folded ? " is-folded" : ""}`} ref={panel} data-rest={sheet.rest}>
            {/* On a phone: the sheet's grabber. A tap raises it full, or lowers it to half. */}
            <button
              type="button"
              className="sheet-grabber"
              aria-label={sheet.rest === "full" ? "Lower the panel" : "Raise the panel"}
              onClick={() => showSheet(sheet.rest === "half" ? "full" : "half")}
            />
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
          <WhyTip />
          <MapStage covered={{ left: coveredLeft, bottom: sheet.covered, top: sheet.above }} found={chosen && found?.ok && !asShop ? { suggestion: chosen, place: found.place, fly } : null} onCloseFound={() => setChosen(null)} />
        </div>
      </MapStageProvider>
    </ErrorBoundary>
  );
}

/**
 * The px of the map under the open panel on its left: up to the panel's right edge. On a phone the panel
 * is as wide as the map and lies over its foot (./sheet.ts says how far). Measured again whenever the
 * panel or the window changes size: its styles laid out, the phone turned, a fold.
 */
function useCoveredLeft(panel: RefObject<HTMLElement | null>, open: boolean): number {
  const [left, setLeft] = useState(0);
  useLayoutEffect(() => {
    const element = panel.current;
    const frame = element?.parentElement;
    if (!open || !element || !frame) {
      setLeft(0);
      return;
    }
    const measure = () => {
      const { width, right } = element.getBoundingClientRect();
      const box = frame.getBoundingClientRect();
      setLeft(width < box.width ? Math.round(right - box.left) : 0);
    };
    const resized = new ResizeObserver(measure);
    resized.observe(element);
    resized.observe(frame);
    return () => resized.disconnect();
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
