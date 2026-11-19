/** The panel's header on every screen: Route | Shops. */
import type { ReactElement } from "react";
import { thumbAt } from "../ui/segmented.ts";
import { HOME, linkTo, type Screen } from "./routes.ts";

const SHOPS: Screen = { name: "shops", edit: null };

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
    </header>
  );
}
