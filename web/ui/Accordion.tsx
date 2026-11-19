/** A card that folds: its title and, folded, a line saying what is in it; open, its rows. */
import { useId, useState, type ReactElement, type ReactNode } from "react";
import { Chevron } from "./icons.tsx";

export function Accordion(props: { title: string; summary: string; initiallyOpen?: boolean; children: ReactNode }): ReactElement {
  const [open, setOpen] = useState(props.initiallyOpen ?? false);
  const bodyId = useId();
  return (
    <section className="group accordion" aria-label={props.title}>
      <button type="button" className="accordion-head" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen(!open)}>
        <span className="accordion-title">{props.title}</span>
        {!open && <span className="accordion-summary">{props.summary}</span>}
        <span className="accordion-chevron" aria-hidden="true">
          <Chevron size={16} />
        </span>
      </button>
      {open && (
        <div className="accordion-body" id={bodyId}>
          {props.children}
        </div>
      )}
    </section>
  );
}
