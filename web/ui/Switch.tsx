/** A setting that is on or off, as a row: its name, and a switch that is the accent when on. */
import type { ReactElement } from "react";

export function Switch(props: { label: string; on: boolean; onChange: (on: boolean) => void; title?: string }): ReactElement {
  return (
    <button type="button" role="switch" aria-checked={props.on} className="switch-row" title={props.title} onClick={() => props.onChange(!props.on)}>
      <span>{props.label}</span>
      <span className="switch" aria-hidden="true" />
    </button>
  );
}
