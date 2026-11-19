/** Undo and Redo: two buttons shown while there is history, and Cmd/Ctrl+Z, Shift+Cmd/Ctrl+Z anywhere but in a text field. */
import { useEffect, useRef, type ReactElement } from "react";
import { Redo, Undo } from "./icons.tsx";

/** Undo and redo of a screen's changes; `what` names them ("Undo route change"). Null: nothing to go back or forward to. */
export interface History {
  what: string;
  undo: (() => void) | null;
  redo: (() => void) | null;
}

const inTextField = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

/** The keys for `history` while it is shown. A text field keeps them for its own text. */
export function useHistoryKeys(history: History | null): void {
  const latest = useRef(history);
  latest.current = history;
  useEffect(() => {
    if (!history) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "z" || !(event.metaKey || event.ctrlKey) || event.altKey || inTextField(event.target)) return;
      const step = event.shiftKey ? latest.current?.redo : latest.current?.undo;
      event.preventDefault();
      step?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [!history]);
}

/** Undo · Redo, while there is any history; each off while there is nothing on its side. */
export function HistoryButtons({ history }: { history: History }): ReactElement | null {
  useHistoryKeys(history.undo || history.redo ? history : null);
  if (!history.undo && !history.redo) return null;
  return (
    <span className="history">
      <button type="button" className="icon-btn" aria-label={`Undo ${history.what}`} title="Undo" disabled={!history.undo} onClick={() => history.undo?.()}>
        <Undo />
      </button>
      <button type="button" className="icon-btn" aria-label={`Redo ${history.what}`} title="Redo" disabled={!history.redo} onClick={() => history.redo?.()}>
        <Redo />
      </button>
    </span>
  );
}
