/** The small marks every screen shares: a line's colour and name, a place's pin, and the turn-back mark. */
import type { ReactElement } from "react";
import type { PlaceKind } from "../../shared/plans.ts";
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

/** A place's mark, the same in the rows and the sections: the start a filled dot, a stop its number in a ring, the destination a ring. */
export function PlacePin({ kind, n }: { kind: PlaceKind; n: number | string }): ReactElement {
  switch (kind) {
    case "start":
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="8" cy="8" r="4" fill="var(--text)" stroke="var(--text)" strokeWidth="2" />
        </svg>
      );
    case "stop":
      return (
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
          <circle cx="9" cy="9" r="7.5" fill="var(--surface-solid)" stroke="var(--text)" strokeWidth="2" />
          <text x="9" y="12.2" textAnchor="middle" fontSize="9" fontWeight="600" fill="var(--text)">
            {n}
          </text>
        </svg>
      );
    case "destination":
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="8" cy="8" r="4" fill="none" stroke="var(--text)" strokeWidth="2" />
        </svg>
      );
  }
}
