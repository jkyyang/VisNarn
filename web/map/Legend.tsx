import type { ReactElement } from "react";
import { isClassI, LINES, RAILROADS, type Line, type NetworkClass } from "../../shared/railroads.ts";
import { lineColor } from "../theme.ts";
import { lineName } from "../words.ts";
import type { MapScene } from "./scene.ts";

/** A line the map can draw: a route's line, or passenger-owned track in the network. */
type LegendLine = Line | "passenger";
const LEGEND_ORDER: readonly LegendLine[] = [...LINES, "passenger"];
const NETWORK_LINES: Record<NetworkClass, readonly LegendLine[]> = { class_i: RAILROADS, regional: ["regional"], short_line: ["short line"], passenger: ["passenger"] };

/**
 * What the legend lists for a scene: the selected route's lines; with no route, the lines of the
 * network classes drawn (none while the network is switched off).
 */
export function legendFor(scene: MapScene | null, network: readonly NetworkClass[]): { railroads: readonly LegendLine[]; turnBack: boolean } {
  const selected = scene?.kind === "route" ? scene.selected : null;
  return {
    railroads: selected ? [...new Set(selected.legs.map((leg) => leg.railroad))] : network.flatMap((c) => NETWORK_LINES[c]),
    turnBack: scene?.kind === "route" && scene.turnBacks.length > 0,
  };
}

/** Which colour is which line: only those the map shows, and the turn-back mark when the route has one. Nothing to list: no legend. */
export function Legend(props: { railroads: readonly LegendLine[]; turnBack: boolean }): ReactElement | null {
  const shown = LEGEND_ORDER.filter((line) => props.railroads.includes(line));
  if (!shown.length && !props.turnBack) return null;
  return (
    <div className="map-ctl legend">
      <div className="legend-rr" role="list" aria-label="Railroad colors">
        {shown.map((line) => (
          <span role="listitem" key={line}>
            <i className={`legend-line${isClassI(line) ? "" : " is-thin"}`} style={{ background: lineColor(line) }} />
            {lineName(line)}
          </span>
        ))}
        {props.turnBack && (
          <span role="listitem" className="legend-turn">
            <i className="legend-turn-mark" aria-hidden="true">
              ↩
            </i>
            Turn-back
          </span>
        )}
      </div>
    </div>
  );
}
