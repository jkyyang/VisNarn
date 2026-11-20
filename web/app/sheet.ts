/**
 * The phone's sheet: the panel lies over the foot of the map and rests at one of three heights: its head
 * alone, about half the screen, or all of it below the status bar. The head drags it, and so does its body
 * where the body cannot scroll that way (at its top, pulled down; below full, pushed up). It moves between
 * full and its head and no further, so wherever a finger leaves it, it covers the screen's foot and its top
 * is on screen. On release it settles on a spring at the rest its momentum points to; only `transform`
 * changes while it moves.
 *
 * It writes on the panel its transform, --sheet-hidden (how much of it is below the screen, which the body
 * keeps clear so every row can scroll into view) and --keyboard (the on-screen keyboard's height); lowered, its
 * body starts at its first rows again; on the
 * frame, --sheet-covered (how much of the map it covers) once it rests; the camera is told at once where it
 * goes to rest, so a flight started with it frames clear of it. A text field focused raises it full, above the
 * keyboard; lowered, it closes the keyboard; Enter in a field closes it too, as a phone's Go key does.
 */
import { useLayoutEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { PHONE_QUERY } from "../map/config.ts";
import { projected, record, reducedMotion, speed, spring, type Track } from "../ui/motion.ts";

export type Rest = "head" | "half" | "full";

/** The share of the screen the sheet covers at "half". */
const HALF_SHARE = 0.42;
/** Travel before a press becomes a drag, so a tap stays a tap. */
const DRAG_AFTER_PX = 6;

/** The sheet on the page, while there is one (a phone held upright). */
let current: ((rest: Rest) => void) | null = null;

/** Sends the phone's sheet to a rest: "head" for a tap on the map next, "half" for something just shown on it. Elsewhere nothing happens. */
export const showSheet = (rest: Rest): void => current?.(rest);

/** Where the sheet's top sits at each rest, in px below where it sits full. */
function offsets(panel: HTMLElement): Record<Rest, number> {
  const head = panel.querySelector<HTMLElement>(".panel-head");
  const height = panel.offsetHeight;
  const shown = (head ? head.offsetTop + head.offsetHeight : 0) + parseFloat(getComputedStyle(panel).paddingBottom);
  const headRest = Math.max(0, height - shown);
  const screen = panel.parentElement?.clientHeight ?? window.innerHeight;
  return { full: 0, half: Math.min(headRest, Math.round(height - screen * HALF_SHARE)), head: headRest };
}

const isTextField = (target: EventTarget | null): target is HTMLInputElement => target instanceof HTMLInputElement && /^(text|search)$/.test(target.type);

/** Whether the window is a phone's, held upright: the panel is a sheet then. */
function usePhone(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia?.(PHONE_QUERY);
      query?.addEventListener("change", onChange);
      return () => query?.removeEventListener("change", onChange);
    },
    () => window.matchMedia?.(PHONE_QUERY).matches ?? false,
  );
}

/** The sheet's rest, and the px of the map it covers there; on a phone held upright (elsewhere 0). */
export function useSheet(panel: RefObject<HTMLElement | null>): { rest: Rest; covered: number } {
  const on = usePhone();
  const [rest, setRest] = useState<Rest>("half");
  const [covered, setCovered] = useState(0);
  const restRef = useRef(rest);

  useLayoutEffect(() => {
    const el = panel.current;
    if (!el || !on) return;
    const body = el.querySelector<HTMLElement>(".panel-body");
    let y = 0;
    /** The head's rest: as low as the sheet goes. */
    let lowest = 0;
    let stop: (() => void) | null = null;

    const place = (to: number) => {
      y = Math.min(lowest, Math.max(0, to));
      el.style.transform = `translate3d(0, ${y}px, 0)`;
    };
    const coveredAt = (to: number) => (el.parentElement?.clientHeight ?? 0) - el.offsetTop - to;
    const rested = (to: number) => {
      el.style.setProperty("--sheet-hidden", `${to}px`);
      el.parentElement?.style.setProperty("--sheet-covered", `${coveredAt(to)}px`);
    };
    const settle = (next: Rest, velocity = 0) => {
      stop?.();
      restRef.current = next;
      setRest(next);
      // A field the sheet lowers over takes no more typing: its keyboard goes.
      if (next !== "full" && isTextField(document.activeElement) && el.contains(document.activeElement)) document.activeElement.blur();
      // Lowered, it shows its first rows again, as it opened.
      if (next !== "full") body?.scrollTo(0, 0);
      const at = offsets(el);
      const to = at[next];
      lowest = at.head;
      // At once: a row brought into view while the sheet moves stops where it will show.
      el.style.setProperty("--sheet-hidden", `${to}px`);
      setCovered(coveredAt(to));
      if (reducedMotion()) {
        place(to);
        rested(to);
      } else {
        stop = spring(y, to, velocity, place, () => rested(to));
      }
    };
    const replace = () => {
      stop?.();
      const at = offsets(el);
      const to = at[restRef.current];
      lowest = at.head;
      place(to);
      rested(to);
      setCovered(coveredAt(to));
    };
    replace();
    current = settle;
    // The rests move with the panel's size: the page laid out, the phone turned, Android's keyboard.
    const resized = new ResizeObserver(replace);
    resized.observe(el);

    // One drag at a time, from the head or the body. `from`: where the sheet was when the press became a drag; until then it is a tap, and the sheet goes on settling.
    let drag: { startY: number; from: number | null; track: Track } | null = null;
    const begin = (clientY: number) => {
      // A finger lifted over the browser's own bars may never be reported: the drag it left ends here.
      release(true);
      drag = { startY: clientY, from: null, track: [] };
    };
    const follow = (clientY: number) => {
      if (!drag) return;
      const dy = clientY - drag.startY;
      if (drag.from === null) {
        if (Math.abs(dy) < DRAG_AFTER_PX) return;
        stop?.();
        drag.from = y - dy;
      }
      record(drag.track, clientY);
      place(drag.from + dy);
    };
    /** Settles the sheet; true when the press was a drag. */
    const release = (cancelled: boolean): boolean => {
      const d = drag;
      drag = null;
      if (!d || d.from === null) return false;
      const velocity = cancelled ? 0 : speed(d.track);
      const aim = projected(y, velocity);
      const at = offsets(el);
      settle(
        (Object.keys(at) as Rest[]).reduce((best, r) => (Math.abs(at[r] - aim) < Math.abs(at[best] - aim) ? r : best)),
        velocity,
      );
      return true;
    };

    // The head: a pointer (finger or mouse). Its CSS turns off the browser's own panning there.
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element;
      if (event.button !== 0 || !target.closest(".panel-head, .sheet-grabber") || target.closest(".suggestions")) return;
      begin(event.clientY);
      const move = (e: PointerEvent) => e.pointerId === event.pointerId && follow(e.clientY);
      const end = (e: PointerEvent) => {
        if (e.pointerId !== event.pointerId) return;
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", end);
        window.removeEventListener("pointercancel", end);
        // A drag that ends on a button or a tab is no press of it.
        if (release(e.type === "pointercancel")) {
          const swallow = (click: Event) => {
            click.stopPropagation();
            click.preventDefault();
          };
          window.addEventListener("click", swallow, { capture: true, once: true });
          setTimeout(() => window.removeEventListener("click", swallow, true));
        }
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", end);
      window.addEventListener("pointercancel", end);
    };

    // The body: a finger, decided on its first move, before the browser begins to scroll. A row's drag handle keeps its own.
    let touch: { x: number; y: number; decided: boolean; mine: boolean } | null = null;
    const onTouchStart = (event: TouchEvent) => {
      const t = event.touches[0];
      touch = t && event.touches.length === 1 && !(event.target as Element).closest("[data-handle]") ? { x: t.clientX, y: t.clientY, decided: false, mine: false } : null;
    };
    const onTouchMove = (event: TouchEvent) => {
      const t = event.touches[0];
      if (!touch || !body || !t) return;
      if (!touch.decided) {
        const dy = t.clientY - touch.y;
        if (dy === 0 || Math.abs(t.clientX - touch.x) > Math.abs(dy)) return;
        touch.decided = true;
        touch.mine = dy > 0 ? body.scrollTop <= 0 : restRef.current !== "full";
        if (touch.mine) begin(touch.y);
      }
      if (!touch.mine) return;
      event.preventDefault();
      follow(t.clientY);
    };
    const onTouchEnd = (event: TouchEvent) => {
      if (touch?.mine) release(event.type === "touchcancel");
      touch = null;
    };

    const onFocus = (event: FocusEvent) => {
      if (isTextField(event.target)) settle("full");
    };
    // After the field's own Enter, and a form's submit, have done their work.
    const onEnter = (event: KeyboardEvent) => {
      const field = event.target;
      if (event.key === "Enter" && isTextField(field) && el.contains(field)) setTimeout(() => field.blur());
    };

    // The keyboard covers the screen's foot without resizing the page (iOS): the body keeps clear what it covers of the frame.
    const viewport = window.visualViewport;
    const onViewport = () => {
      const frame = el.parentElement;
      if (!viewport || !frame || viewport.scale > 1.01) return;
      el.style.setProperty("--keyboard", `${Math.max(0, Math.round(frame.getBoundingClientRect().bottom - viewport.offsetTop - viewport.height))}px`);
      if (body?.contains(document.activeElement)) document.activeElement?.scrollIntoView({ block: "nearest" });
    };

    el.addEventListener("pointerdown", onPointerDown);
    body?.addEventListener("touchstart", onTouchStart, { passive: true });
    body?.addEventListener("touchmove", onTouchMove, { passive: false });
    body?.addEventListener("touchend", onTouchEnd);
    body?.addEventListener("touchcancel", onTouchEnd);
    el.addEventListener("focusin", onFocus);
    window.addEventListener("keydown", onEnter);
    viewport?.addEventListener("resize", onViewport);
    return () => {
      stop?.();
      current = null;
      el.style.transform = "";
      el.parentElement?.style.removeProperty("--sheet-covered");
      setCovered(0);
      el.removeEventListener("pointerdown", onPointerDown);
      body?.removeEventListener("touchstart", onTouchStart);
      body?.removeEventListener("touchmove", onTouchMove);
      body?.removeEventListener("touchend", onTouchEnd);
      body?.removeEventListener("touchcancel", onTouchEnd);
      el.removeEventListener("focusin", onFocus);
      window.removeEventListener("keydown", onEnter);
      resized.disconnect();
      viewport?.removeEventListener("resize", onViewport);
    };
  }, [panel, on]);

  return { rest, covered };
}
