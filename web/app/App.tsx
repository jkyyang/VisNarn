/**
 * The page: a panel on the left, the map on the right (stacked on a phone). The URL decides which
 * screen fills the panel; the map is created once and outlives every screen change.
 */
import type { ReactElement } from "react";
import { useBasemap } from "../data/basemap.ts";
import { useBatches, useBatchView, useMeta } from "../data/hooks.ts";
import { MapStage, MapStageProvider } from "../map/MapStage.tsx";
import { CarsScreen } from "../screens/cars/CarsScreen.tsx";
import { RouteWorkspace } from "../screens/route/RouteWorkspace.tsx";
import { ShopsScreen } from "../screens/shops/ShopsScreen.tsx";
import { ErrorBoundary } from "../ui/ErrorBoundary.tsx";
import { AppHeader, ModeTabs } from "./chrome.tsx";
import { useScreen, type Screen } from "./routes.ts";

export default function App(): ReactElement {
  const screen = useScreen();
  const network = useBasemap();
  const meta = useMeta();

  // The number on the Cars tab: cars to act on in the newest batch. The same cached read the Cars
  // screen uses, so the tab and the list always show one number.
  const batches = useBatches();
  const newest = useBatchView(batches.status === "ready" ? (batches.data[0]?.id ?? null) : null);
  const actNow = newest.status === "ready" ? newest.data.cars.filter((car) => car.group === "act-now").length : null;

  // Fix route and Shops have their own back header; Route and Cars share the brand header and tabs.
  const tabbed = screen.name === "route" || screen.name === "cars";

  return (
    <ErrorBoundary fallback={<p className="error page-error">Something went wrong on this page. Reload to start again; nothing was lost on the server.</p>}>
      <MapStageProvider network={network}>
        <div className="app" data-screen={screen.name}>
          <main className="panel">
            {tabbed && <AppHeader exampleOnly={meta.status === "ready" && meta.data.exampleOnly} />}
            {tabbed && <ModeTabs current={screen.name} actNow={actNow} />}
            {meta.status === "error" && (
              <div className="server-note" role="alert">
                <span>{meta.error.message}</span>
                <button type="button" className="btn btn--small" onClick={meta.retry}>
                  Try again
                </button>
              </div>
            )}
            {/* Route and Fix route share one key: going between them must keep the car session. */}
            <ErrorBoundary key={screen.name === "fix" ? "route" : screen.name} fallback={<p className="error page-error">This screen could not be shown. Go back or reload the page.</p>}>
              <ScreenView screen={screen} />
            </ErrorBoundary>
          </main>
          <MapStage />
        </div>
      </MapStageProvider>
    </ErrorBoundary>
  );
}

function ScreenView({ screen }: { screen: Screen }): ReactElement {
  switch (screen.name) {
    case "route":
    case "fix":
      return <RouteWorkspace screen={screen} />;
    case "cars":
      return <CarsScreen screen={screen} />;
    case "shops":
      return <ShopsScreen screen={screen} />;
  }
}
