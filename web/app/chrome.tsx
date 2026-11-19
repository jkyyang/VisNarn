/** The panel's header on every screen: the one search, the fold button, then Route | Shops. */
import type { ReactElement, ReactNode } from "react";
import { Chevron } from "../ui/icons.tsx";
import { thumbAt } from "../ui/segmented.ts";
import { HOME, linkTo, type Screen } from "./routes.ts";

const SHOPS: Screen = { name: "shops", edit: null };

export function PanelHeader(props: { current: Screen["name"]; search: ReactNode; onCollapse: () => void }): ReactElement {
  const tab = (target: Screen, label: string) => (
    <a {...linkTo(target)} aria-current={props.current === target.name ? "page" : undefined}>
      {label}
    </a>
  );
  return (
    <header className="panel-head">
      <div className="panel-search-row">
        {props.search}
        <button type="button" className="icon-btn panel-fold" aria-label="Collapse panel" title="Collapse panel" onClick={props.onCollapse}>
          <Chevron />
        </button>
      </div>
      <nav className="segmented" aria-label="Mode" style={thumbAt(2, props.current === "route" ? 0 : 1)}>
        {tab(HOME, "Route")}
        {tab(SHOPS, "Shops")}
      </nav>
    </header>
  );
}
