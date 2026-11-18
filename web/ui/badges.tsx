/** The small marks every screen shares: a line's colour and name, and the turn-back mark. */
import type { ReactElement } from "react";
import type { Line } from "../../shared/railroads.ts";
import { lineColor } from "../theme.ts";
import { lineName } from "../words.ts";

/** A line's colour dot and name: "UP", "Short line". */
export function RailroadChip(props: { railroad: Line }): ReactElement {
  return (
    <span className="rr-chip" data-railroad={props.railroad}>
      <span className="rr-swatch" style={{ background: lineColor(props.railroad) }} aria-hidden="true" />
      {lineName(props.railroad)}
    </span>
  );
}

export function RailroadChips(props: { railroads: readonly Line[] }): ReactElement {
  return (
    <span className="rr-list">
      {props.railroads.map((railroad) => (
        <RailroadChip key={railroad} railroad={railroad} />
      ))}
    </span>
  );
}

/** ↩, with the count when there is more than one. Decorative: each user says the words. */
export function TurnBadge({ count = 1 }: { count?: number }): ReactElement {
  return (
    <span className="turn-badge" aria-hidden="true">
      ↩{count > 1 ? count : ""}
    </span>
  );
}
