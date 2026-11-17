import type { ReactElement } from "react";
import { RAILROADS, type Railroad } from "../../shared/railroads.ts";
import type { MapScene } from "./scene.ts";

/** What the legend lists for a scene: the selected route's railroads, or all six where the whole network is the picture. */
export function legendFor(scene: MapScene | null): { railroads: readonly Railroad[]; turnBack: boolean } {
  const selected = scene?.kind === "route" ? scene.selected : null;
  return {
    railroads: selected ? [...new Set(selected.legs.map((leg) => leg.railroad))] : RAILROADS,
    turnBack: scene?.kind === "route" && scene.turnBacks.length > 0,
  };
}

/** Which colour is which railroad: only those the map shows, and the turn-back mark when the route has one. */
export function Legend(props: { railroads: readonly Railroad[]; turnBack: boolean }): ReactElement {
  const shown = RAILROADS.filter((railroad) => props.railroads.includes(railroad));
  return (
    <div className="map-ctl legend">
      <div className="legend-rr" role="list" aria-label="Railroad colors">
        {shown.map((railroad) => (
          <span role="listitem" key={railroad}>
            <i className="legend-line" style={{ background: `var(--rr-${railroad})` }} />
            {railroad}
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
