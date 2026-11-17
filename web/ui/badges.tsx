/** The small mark every screen shares: a railroad's colour and code. */
import type { ReactElement } from "react";
import type { Railroad } from "../../shared/railroads.ts";

/** A railroad's colour dot and code. */
export function RailroadChip(props: { railroad: Railroad }): ReactElement {
  return (
    <span className="rr-chip" data-railroad={props.railroad}>
      <span className="rr-swatch" style={{ background: `var(--rr-${props.railroad})` }} aria-hidden="true" />
      {props.railroad}
    </span>
  );
}
