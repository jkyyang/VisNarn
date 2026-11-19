/** ⋯: a list's other actions, in a popover. `items` gets `close`, for an item of its own kind (a file chooser's label) to call. */
import { useRef, type ReactElement, type ReactNode } from "react";
import { More } from "./icons.tsx";
import { usePopover } from "./popover.ts";

export function Menu(props: { label: string; items: (close: () => void) => ReactNode; children?: ReactNode }): ReactElement {
  const root = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = usePopover([root]);
  return (
    <span className="menu" ref={root}>
      <button type="button" className="icon-btn" aria-label={props.label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <More />
      </button>
      {props.children}
      {open && (
        <div className="glass menu-card" role="menu">
          {props.items(() => setOpen(false))}
        </div>
      )}
    </span>
  );
}

/** One action of a menu. */
export function MenuItem(props: { label: string; disabled?: boolean; onSelect: () => void }): ReactElement {
  return (
    <button type="button" role="menuitem" className="menu-item" disabled={props.disabled} onClick={props.onSelect}>
      {props.label}
    </button>
  );
}
