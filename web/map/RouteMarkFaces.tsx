/** The faces of the route marks: a route's pill and a turn-back's disc. Plain DOM, no map library. */
import { useEffect, useId, useRef, useState, type ReactElement, type RefObject } from "react";
import type { TurnBack } from "../../shared/route.ts";
import { trackWords, turnBackMove } from "../words.ts";
import type { PillSide } from "./pills.ts";
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

/** One route's pill. `side`: where it hangs from its anchor (its pointer faces the anchor); null where nothing placed it. */
export function PillFace(props: { pill: ScenePill; side: PillSide | null; onSelect: () => void }): ReactElement {
  const { pill } = props;
  const ref = useRef<HTMLButtonElement>(null);
  useNativeClick(ref, () => {
    if (!pill.selected) props.onSelect();
  });
  return (
    <button
      ref={ref}
      type="button"
      className={`route-pill route-pill--${props.side ?? "right"}${pill.selected ? " is-selected" : ""}`}
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

const UTurn = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
    <path d="M4 12V6a3 3 0 0 1 6 0v6M7.6 9.6L10 12l2.4-2.4" fill="none" stroke="#fff" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** The amber disc at a turn-back. Hover, focus or a tap shows two lines: where, and how the route arrives and leaves. */
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
  const move = turnBackMove(turnBack);
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
        <UTurn />
      </button>
      {open && (
        <span role="tooltip" id={id} className="turn-pop">
          <span className="turn-pop-line strong">
            {turnBack.at.near} · {trackWords(turnBack.track)}
          </span>
          <span className="turn-pop-line">
            arrives {move.arrives} · leaves {move.leaves}
          </span>
        </span>
      )}
    </span>
  );
}
