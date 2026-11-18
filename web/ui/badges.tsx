/** The small mark every screen shares: a line's colour and name. */
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
