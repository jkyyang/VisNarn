/**
 * The page: one map filling the window, the panel floating over its left side (on a phone, a sheet
 * under it). The URL decides which screen fills the panel; the map is created once and outlives every
 * screen change.
 */
import { useLayoutEffect, useRef, useState, type ReactElement, type RefObject } from "react";
import { useBasemap } from "../data/basemap.ts";
import { useShops } from "../data/hooks.ts";
import { CAMERA_MARGIN_PX } from "../map/config.ts";
import { MapStage, MapStageProvider } from "../map/MapStage.tsx";
import { RouteWorkspace } from "../screens/route/RouteWorkspace.tsx";
import { ShopsScreen } from "../screens/shops/ShopsScreen.tsx";
import { ErrorBoundary } from "../ui/ErrorBoundary.tsx";
import { AppHeader } from "./chrome.tsx";
import { usePanelState } from "./panel.ts";
import { useScreen, type Screen } from "./routes.ts";

export default function App(): ReactElement {
  const screen = useScreen();
  const network = useBasemap();
  // Every screen shows the shops: when they cannot be read, the server cannot be reached.
  const shops = useShops();
  const panel = useRef<HTMLElement>(null);
  const [panelState] = usePanelState();
  const cameraLeft = useCameraLeft(panel, panelState === "open");

  return (
    <ErrorBoundary fallback={<p className="error page-error">Something went wrong on this page. Reload to start again.</p>}>
      <MapStageProvider network={network}>
        <div className="app">
          <main className="panel glass" ref={panel}>
            <AppHeader current={screen.name} />
            {shops.status === "error" && (
              <div className="alert server-note" role="alert">
                <span>{shops.error.message}</span>
                <button type="button" className="btn" onClick={shops.retry}>
                  Try again
                </button>
              </div>
            )}
            <ErrorBoundary key={screen.name} fallback={<p className="error page-error">This screen could not be shown. Go back or reload the page.</p>}>
              <ScreenView screen={screen} />
            </ErrorBoundary>
          </main>
          <MapStage cameraLeft={cameraLeft} />
        </div>
      </MapStageProvider>
    </ErrorBoundary>
  );
}

/**
 * The px every camera move keeps clear on the left: the open panel with a margin each side of it,
 * else the margin alone. On a phone the panel is as wide as the map and lies below it. The panel's
 * width follows the window only, so a window resize is the one time to measure again.
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

function ScreenView({ screen }: { screen: Screen }): ReactElement {
  switch (screen.name) {
    case "route":
      return <RouteWorkspace screen={screen} />;
    case "shops":
      return <ShopsScreen screen={screen} />;
  }
}
