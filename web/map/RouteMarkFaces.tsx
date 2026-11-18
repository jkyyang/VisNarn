/** The faces of the route marks: a route's pill and a turn-back's disc. Plain DOM, no map library. */
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactElement, type RefObject } from "react";
import type { TurnBack } from "../../shared/route.ts";
import { trackWords, turnBackMove } from "../words.ts";
import type { PillCorner } from "./pills.ts";
import type { ScenePill } from "./scene.ts";

/**
 * A click on a mark must never reach the map, or it would also place a stop there. MapLibre hears the
 * DOM click on its canvas container, which holds the markers, so the click is stopped on the element
 * itself: React's own onClick runs at the page root, after the map has heard it. A plain hover is kept
 * from the map too, so the map's hover text for what lies under the mark does not cover it.
 */
export function useNativeClick(ref: RefObject<HTMLElement | null>, handler: () => void): void {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const onClick = (event: MouseEvent) => {
      event.stopPropagation();
      latest.current();
    };
    // Only with no button down: a drag that starts on a mark still pans the map.
    const onMove = (event: MouseEvent) => {
      if (event.buttons === 0) event.stopPropagation();
    };
    element.addEventListener("click", onClick);
    element.addEventListener("mousemove", onMove);
    return () => {
      element.removeEventListener("click", onClick);
      element.removeEventListener("mousemove", onMove);
    };
  }, [ref]);
}

/** One route's pill. `corner`: where it sits from its anchor; null where nothing placed it. */
export function PillFace(props: { pill: ScenePill; corner: PillCorner | null; onSelect: () => void }): ReactElement {
  const { pill } = props;
  const ref = useRef<HTMLButtonElement>(null);
  useNativeClick(ref, () => {
    if (!pill.selected) props.onSelect();
  });
  return (
    <button
      ref={ref}
      type="button"
      className={`route-pill route-pill--${props.corner ?? "above-right"}${pill.selected ? " is-selected" : ""}`}
      aria-pressed={pill.selected}
      aria-label={pill.selected ? `Route ${pill.text}, selected` : `Route ${pill.text}`}
    >
      {pill.text}
      {pill.turnBacks > 0 && (
        <span className="route-pill-turn" aria-hidden="true">
          ↩{pill.turnBacks > 1 ? pill.turnBacks : ""}
        </span>
      )}
    </button>
  );
}

/** The amber disc at a turn-back. Hover, focus or a tap shows two lines: where, and the headings in and out. */
export function TurnBackMark(props: { turnBack: TurnBack }): ReactElement {
  const { turnBack } = props;
  // Three reasons to show the details; a tap (or click) pins them, so they stay once the pointer has gone.
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const open = pinned || hovered || focused;
  const ref = useRef<HTMLButtonElement>(null);
  const id = useId();
  useNativeClick(ref, () => setPinned((on) => !on));
  // A tap anywhere else lets go of it (a phone has no hover to end).
  useEffect(() => {
    if (!pinned) return;
    const away = (event: PointerEvent) => {
      if (!(event.target instanceof Node && ref.current?.contains(event.target))) setPinned(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [pinned]);
  // Near an edge of the map the details slide sideways, or go below the disc, instead of being cut off.
  const pop = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const details = pop.current;
    const frame = details?.closest(".map-canvas")?.getBoundingClientRect();
    if (!details || !frame) return;
    const box = details.getBoundingClientRect();
    details.style.marginLeft = `${Math.max(frame.left + 8 - box.left, 0) + Math.min(frame.right - 8 - box.right, 0)}px`;
    details.classList.toggle("turn-pop--below", box.top < frame.top + 8);
  }, [open]);
  return (
    <span className="turn-mark-wrap">
      <button
        ref={ref}
        type="button"
        className="turn-mark"
        aria-label={`Turn-back at ${turnBack.at.near}`}
        aria-describedby={open ? id : undefined}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          setPinned(false);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          setPinned(false);
          setHovered(false);
          setFocused(false);
        }}
      >
        {/* The same ↩ as the legend, the pills and the route rows. */}
        <span aria-hidden="true">↩</span>
      </button>
      {open && (
        <span role="tooltip" id={id} className="turn-pop" ref={pop}>
          <span className="turn-pop-line strong">
            {turnBack.at.near} · {trackWords(turnBack.track)}
          </span>
          <span className="turn-pop-line">{turnBackMove(turnBack)}</span>
        </span>
      )}
    </span>
  );
}
