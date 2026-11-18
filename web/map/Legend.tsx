import type { ReactElement } from "react";
import { isClassI, type NetworkClass } from "../../shared/railroads.ts";
import { CLASS_LINES, lineColor, MAP_LINES, type MapLine } from "../theme.ts";
import { TurnBadge } from "../ui/badges.tsx";
import { lineName } from "../words.ts";
import type { MapScene } from "./scene.ts";

/**
 * What the legend lists for a scene: the selected route's lines; with no route, the lines of the
 * network classes drawn (none while the network is switched off).
 */
export function legendFor(scene: MapScene | null, network: readonly NetworkClass[]): { railroads: readonly MapLine[]; turnBack: boolean } {
  const selected = scene?.kind === "route" ? scene.selected : null;
  return {
    railroads: selected ? [...new Set(selected.legs.map((leg) => leg.railroad))] : network.flatMap((c) => CLASS_LINES[c]),
    turnBack: scene?.kind === "route" && scene.turnBacks.length > 0,
  };
}

/** Which colour is which line: only those the map shows, and the turn-back mark when the route has one. Nothing to list: no legend. */
export function Legend(props: { railroads: readonly MapLine[]; turnBack: boolean }): ReactElement | null {
  const shown = MAP_LINES.filter((line) => props.railroads.includes(line));
  if (!shown.length && !props.turnBack) return null;
  return (
    <div className="map-ctl card legend">
      <div className="legend-rr" role="list" aria-label="Railroad colors">
        {shown.map((line) => (
          <span role="listitem" key={line}>
            <i className={`legend-line${isClassI(line) ? "" : " is-thin"}`} style={{ background: lineColor(line) }} />
            {lineName(line)}
          </span>
        ))}
        {props.turnBack && (
          <span role="listitem" className="legend-turn">
            <TurnBadge />
            Turn-back
          </span>
        )}
      </div>
    </div>
  );
}
