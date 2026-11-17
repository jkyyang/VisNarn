/**
 * The page: a panel on the left, the map on the right (stacked on a phone). The URL decides which
 * screen fills the panel; the map is created once and outlives every screen change.
 */
import type { ReactElement } from "react";
import { useBasemap } from "../data/basemap.ts";
import { useMeta } from "../data/hooks.ts";
import { MapStage, MapStageProvider } from "../map/MapStage.tsx";
import { RouteWorkspace } from "../screens/route/RouteWorkspace.tsx";
import { ShopsScreen } from "../screens/shops/ShopsScreen.tsx";
import { ErrorBoundary } from "../ui/ErrorBoundary.tsx";
import { AppHeader, ModeTabs } from "./chrome.tsx";
import { useScreen, type Screen } from "./routes.ts";

export default function App(): ReactElement {
  const screen = useScreen();
  const network = useBasemap();
  const meta = useMeta();

  // Shops has its own back header; Route has the brand header and tabs.
  const tabbed = screen.name === "route";

  return (
    <ErrorBoundary fallback={<p className="error page-error">Something went wrong on this page. Reload to start again; nothing was lost on the server.</p>}>
      <MapStageProvider network={network}>
        <div className="app" data-screen={screen.name}>
          <main className="panel">
            {tabbed && <AppHeader exampleOnly={meta.status === "ready" && meta.data.exampleOnly} />}
            {tabbed && <ModeTabs current={screen.name} />}
            {meta.status === "error" && (
              <div className="server-note" role="alert">
                <span>{meta.error.message}</span>
                <button type="button" className="btn btn--small" onClick={meta.retry}>
                  Try again
                </button>
              </div>
            )}
            <ErrorBoundary key={screen.name} fallback={<p className="error page-error">This screen could not be shown. Go back or reload the page.</p>}>
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
      return <RouteWorkspace screen={screen} />;
    case "shops":
      return <ShopsScreen screen={screen} />;
  }
}
