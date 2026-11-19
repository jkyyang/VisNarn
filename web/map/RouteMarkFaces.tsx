/** The faces of the route marks: a route's pill and a turn-back's disc. Plain DOM, no map library. */
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactElement, type RefObject } from "react";
import type { TurnBack } from "../../shared/route.ts";
import { TurnBadge } from "../ui/badges.tsx";
import { pressClosesPopover } from "../ui/popover.ts";
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
      if (!pressClosesPopover()) latest.current();
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
      {pill.turnBacks > 0 && <TurnBadge count={pill.turnBacks} />}
    </button>
  );
}

/** Air kept between the turn-back popover and the map's edge, the map buttons and the panel. */
const EDGE_PX = 8;

/**
 * The amber disc at a turn-back. Hover, focus or a tap shows two lines: where, and the headings in and out. A tap also
 * picks it, as its row in the panel does; `picked`, it wears the accent ring.
 */
export function TurnBackMark(props: { turnBack: TurnBack; picked: boolean; onPick: () => void }): ReactElement {
  const { turnBack } = props;
  // Three reasons to show the details; a tap (or click) pins them, so they stay once the pointer has gone.
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const open = pinned || hovered || focused;
  const ref = useRef<HTMLButtonElement>(null);
  const id = useId();
  useNativeClick(ref, () => {
    setPinned((on) => !on);
    props.onPick();
  });
  // A tap anywhere else lets go of it (a phone has no hover to end).
  useEffect(() => {
    if (!pinned) return;
    const away = (event: PointerEvent) => {
      if (!(event.target instanceof Node && ref.current?.contains(event.target))) setPinned(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [pinned]);
  // The details stay in the free part of the map: they go below the disc where the map's top edge would cut
  // them, then slide sideways to stay inside the map, clear of the map buttons on the right and of the
  // panel on the left.
  const pop = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const details = pop.current;
    const canvas = details?.closest(".map-canvas");
    const app = details?.closest(".app");
    if (!details || !canvas || !app) return;
    const frame = canvas.getBoundingClientRect();
    const rects = (selector: string) => [...app.querySelectorAll(selector)].map((element) => element.getBoundingClientRect()).filter((rect) => rect.width && rect.height);
    let box = details.getBoundingClientRect();
    if (box.top < frame.top + EDGE_PX) {
      details.classList.add("turn-pop--below");
      box = details.getBoundingClientRect();
    }
    // Only what is at the popover's own height matters; above and below it the map is free to its edge.
    const beside = (rect: DOMRect) => rect.top < box.bottom && rect.bottom > box.top;
    const right = Math.min(frame.right, ...rects(".map-controls > *").filter(beside).map((rect) => rect.left)) - EDGE_PX;
    // The panel as App measures it: beside the map when narrower than it (on a phone it is the sheet below).
    const left = Math.max(frame.left, ...rects(".panel").filter((rect) => beside(rect) && rect.width < frame.width).map((rect) => rect.right)) + EDGE_PX;
    // Clear of the right side first; the left wins if both cannot fit, so the text starts in view.
    details.style.marginLeft = `${Math.max(Math.min(right - box.right, 0), left - box.left)}px`;
  }, [open]);
  return (
    <span className="turn-mark-wrap">
      <button
        ref={ref}
        type="button"
        className="turn-badge turn-mark"
        aria-label={`Turn-back at ${turnBack.at.near}`}
        aria-pressed={props.picked}
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
        <span aria-hidden="true">↩</span>
      </button>
      {open && (
        <span role="tooltip" id={id} className="glass turn-pop" ref={pop}>
          <span className="strong">
            {turnBack.at.near} · {trackWords(turnBack.track)}
          </span>
          <span>{turnBackMove(turnBack)}</span>
        </span>
      )}
    </span>
  );
}
