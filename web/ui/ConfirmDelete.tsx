import type { ReactElement } from "react";

/** The inline "Delete this …?" question. Keep comes first and takes focus, so a double click on the button that opened it lands on Keep. */
export function ConfirmDelete(props: { question: string; label?: string; busy?: boolean; onConfirm: () => void; onKeep: () => void }): ReactElement {
  return (
    <div className="confirm" role="group" aria-label={props.label ?? props.question}>
      <span>{props.question}</span>
      <button type="button" className="btn" autoFocus onClick={props.onKeep}>
        Keep
      </button>
      <button type="button" className="btn btn--danger" disabled={props.busy} onClick={props.onConfirm}>
        Delete
      </button>
    </div>
  );
}
