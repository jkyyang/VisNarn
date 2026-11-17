import type { ReactElement } from "react";
import { RAILROADS, type Railroad } from "../../shared/railroads.ts";
import { Shape } from "../ui/badges.tsx";
import { PILL_LABELS, type Pill } from "../words.ts";
import type { MapScene } from "./scene.ts";

const PILLS: Pill[] = ["at-risk", "tight", "on-time", "check-route", "cannot-check"];

/** Which colour is which railroad, and what the scene's own marks mean. `railroads`: only these (a phone shows the ones in view). */
export function Legend(props: { kind?: MapScene["kind"] | null; railroads?: Railroad[] }): ReactElement {
  const shown = props.railroads ? RAILROADS.filter((railroad) => props.railroads!.includes(railroad)) : RAILROADS;
  return (
    <div className="map-ctl legend">
      <div className="legend-title">Class I railroads</div>
      <div className="legend-rr" role="list" aria-label="Railroad colors">
        {shown.map((railroad) => (
          <span role="listitem" key={railroad}>
            <i className="legend-line" style={{ background: `var(--rr-${railroad})` }} />
            {railroad}
          </span>
        ))}
      </div>
      {props.kind === "route" && (
        <>
          <div className="legend-sep" />
          <div className="legend-marks" role="list" aria-label="Route marks">
            <span role="listitem">
              <i className="legend-route" />
              Selected route
            </span>
            <span role="listitem">
              <i className="legend-route legend-route--alt" />
              Alternative
            </span>
            <span role="listitem">
              <i className="legend-dash" />A to B
            </span>
            <span role="listitem">
              <i className="legend-ring" />
              Turn-back
            </span>
          </div>
        </>
      )}
      {props.kind === "fleet" && (
        <>
          <div className="legend-sep" />
          <div className="legend-marks" role="list" aria-label="Car status">
            {PILLS.map((pill) => (
              <span role="listitem" key={pill} className={`pill-color--${pill}`}>
                <Shape name={pill} size={12} />
                {PILL_LABELS[pill]}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
