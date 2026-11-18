/**
 * The page: one map filling the window, the panel floating over its left side (on a phone, a sheet
 * under it). The URL decides which screen fills the panel; the map is created once and outlives every
 * screen change.
 */
import { useLayoutEffect, useRef, useState, type ReactElement, type RefObject } from "react";
import { useBasemap } from "../data/basemap.ts";
import { useMeta } from "../data/hooks.ts";
import { MapStage, MapStageProvider } from "../map/MapStage.tsx";
import { RouteWorkspace } from "../screens/route/RouteWorkspace.tsx";
import { ShopsScreen } from "../screens/shops/ShopsScreen.tsx";
import { ErrorBoundary } from "../ui/ErrorBoundary.tsx";
import { AppHeader } from "./chrome.tsx";
import { useScreen, type Screen } from "./routes.ts";

export default function App(): ReactElement {
  const screen = useScreen();
  const network = useBasemap();
  const meta = useMeta();
  const panel = useRef<HTMLElement>(null);
  const covered = useCoveredLeft(panel);

  return (
    <ErrorBoundary fallback={<p className="error page-error">Something went wrong on this page. Reload to start again.</p>}>
      <MapStageProvider network={network}>
        <div className="app">
          <main className="panel glass" ref={panel}>
            <AppHeader current={screen.name} exampleOnly={meta.status === "ready" && meta.data.exampleOnly} />
            {meta.status === "error" && (
              <div className="alert server-note" role="alert">
                <span>{meta.error.message}</span>
                <button type="button" className="btn" onClick={meta.retry}>
                  Try again
                </button>
              </div>
            )}
            <ErrorBoundary key={screen.name} fallback={<p className="error page-error">This screen could not be shown. Go back or reload the page.</p>}>
              <ScreenView screen={screen} />
            </ErrorBoundary>
          </main>
          <MapStage coveredLeft={covered} />
        </div>
      </MapStageProvider>
    </ErrorBoundary>
  );
}

/**
 * How far the panel reaches over the map from its left edge, so the camera centres places in the
 * map that shows. On a phone the panel is as wide as the map and lies below it: nothing is covered.
 * The panel's width follows the window only, so a window resize is the one time to measure again.
 */
function useCoveredLeft(panel: RefObject<HTMLElement | null>): number {
  const [covered, setCovered] = useState(0);
  useLayoutEffect(() => {
    const element = panel.current;
    const frame = element?.parentElement;
    if (!element || !frame) return;
    const measure = () => {
      const box = element.getBoundingClientRect();
      const map = frame.getBoundingClientRect();
      setCovered(box.width < map.width ? Math.round(box.right - map.left) : 0);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [panel]);
  return covered;
}

function ScreenView({ screen }: { screen: Screen }): ReactElement {
  switch (screen.name) {
    case "route":
      return <RouteWorkspace screen={screen} />;
    case "shops":
      return <ShopsScreen screen={screen} />;
  }
}
