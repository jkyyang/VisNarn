/** The panel's header on every screen: Route | Shops, and "EXAMPLE DATA" while the server holds only seeded EXAMPLE shops. */
import type { ReactElement } from "react";
import { HOME, linkTo, type Screen } from "./routes.ts";

const SHOPS: Screen = { name: "shops", edit: null };

export function AppHeader(props: { current: Screen["name"]; exampleOnly: boolean }): ReactElement {
  const tab = (target: Screen, label: string) => (
    <a {...linkTo(target)} aria-current={props.current === target.name ? "page" : undefined}>
      {label}
    </a>
  );
  return (
    <header className="app-header">
      <nav className="segmented" aria-label="Mode">
        {tab(HOME, "Route")}
        {tab(SHOPS, "Shops")}
      </nav>
      {props.exampleOnly && <span className="caption">EXAMPLE DATA</span>}
    </header>
  );
}
