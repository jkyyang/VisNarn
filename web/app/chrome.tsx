/** The panel's header on every screen: Route | Shops, and the screen's Undo and Redo when it has any. */
import type { ReactElement } from "react";
import { MapGlyph } from "../map/MapControls.tsx";
import { useStagedHistory } from "../map/MapStage.tsx";
import { thumbAt } from "../ui/segmented.ts";
import { HOME, linkTo, type Screen } from "./routes.ts";

const SHOPS: Screen = { name: "shops", edit: null };
const UNDO = ["M9 14L4 9l5-5", "M4 9h10a6 6 0 010 12h-3"];
const REDO = ["M15 14l5-5-5-5", "M20 9H10a6 6 0 000 12h3"];

function HistoryButtons(): ReactElement | null {
  const history = useStagedHistory();
  if (!history) return null;
  return (
    <div className="history-btns">
      <button type="button" className="icon-btn" aria-label={`Undo ${history.what}`} disabled={!history.undo} onClick={() => history.undo?.()}>
        <MapGlyph paths={UNDO} />
      </button>
      <button type="button" className="icon-btn" aria-label={`Redo ${history.what}`} disabled={!history.redo} onClick={() => history.redo?.()}>
        <MapGlyph paths={REDO} />
      </button>
    </div>
  );
}

export function AppHeader(props: { current: Screen["name"] }): ReactElement {
  const tab = (target: Screen, label: string) => (
    <a {...linkTo(target)} aria-current={props.current === target.name ? "page" : undefined}>
      {label}
    </a>
  );
  return (
    <header className="app-header">
      <nav className="segmented" aria-label="Mode" style={thumbAt(2, props.current === "route" ? 0 : 1)}>
        {tab(HOME, "Route")}
        {tab(SHOPS, "Shops")}
      </nav>
      <HistoryButtons />
    </header>
  );
}
