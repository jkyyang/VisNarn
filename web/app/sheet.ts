/**
 * The phone's sheet: the panel lies over the foot of the map and rests at one of three heights: its head
 * alone, about half the screen, or all of it below the status bar. The head drags it, and so does its body
 * where the body cannot scroll that way (at its top, pulled down; below full, pushed up). On release it
 * settles on a spring at the rest its momentum points to; only `transform` changes while it moves.
 *
 * It writes on the panel its transform, --sheet-hidden (how much of it is below the screen, which the body
 * keeps clear so every row can scroll into view) and --keyboard (the on-screen keyboard's height); on the
 * frame, --sheet-covered (how much of the map it covers). A text field focused raises it full, above the
 * keyboard; lowered, it closes the keyboard; Enter in a field closes it too, as a phone's Go key does.
 */
import { useLayoutEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { PHONE_QUERY } from "../map/config.ts";
import { projected, record, reducedMotion, rubber, speed, spring, type Track } from "../ui/motion.ts";

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

/** The sheet's rest, on a phone held upright. */
export function useSheet(panel: RefObject<HTMLElement | null>): Rest {
  const on = usePhone();
  const [rest, setRest] = useState<Rest>("half");
  const restRef = useRef(rest);

  useLayoutEffect(() => {
    const el = panel.current;
    if (!el || !on) return;
    let y = 0;
    let stop: (() => void) | null = null;

    const place = (to: number) => {
      y = to;
      el.style.transform = `translate3d(0, ${to}px, 0)`;
    };
    const rested = (to: number) => {
      el.style.setProperty("--sheet-hidden", `${to}px`);
      el.parentElement?.style.setProperty("--sheet-covered", `${el.parentElement.clientHeight - el.offsetTop - to}px`);
    };
    const settle = (next: Rest, velocity = 0) => {
      stop?.();
      restRef.current = next;
      setRest(next);
      // A field the sheet lowers over takes no more typing: its keyboard goes.
      if (next !== "full" && isTextField(document.activeElement) && el.contains(document.activeElement)) document.activeElement.blur();
      const to = offsets(el)[next];
      if (reducedMotion()) {
        place(to);
        rested(to);
      } else {
        stop = spring(y, to, velocity, place, () => rested(to));
      }
    };
    const replace = () => {
      stop?.();
      const to = offsets(el)[restRef.current];
      place(to);
      rested(to);
    };
    replace();
    current = settle;
    // The rests move with the panel's size: the page laid out, the phone turned, Android's keyboard.
    const resized = new ResizeObserver(replace);
    resized.observe(el);

    // One drag at a time, from the head or the body.
    let drag: { startY: number; from: number; max: number; track: Track; started: boolean } | null = null;
    const begin = (clientY: number) => {
      stop?.();
      drag = { startY: clientY, from: y, max: offsets(el).head, track: [], started: false };
    };
    const follow = (clientY: number) => {
      if (!drag) return;
      const dy = clientY - drag.startY;
      if (!drag.started && Math.abs(dy) < DRAG_AFTER_PX) return;
      drag.started = true;
      record(drag.track, clientY);
      const to = drag.from + dy;
      const size = el.offsetHeight;
      place(to < 0 ? rubber(to, size) : to > drag.max ? drag.max + rubber(to - drag.max, size) : to);
    };
    /** Settles the sheet; true when the press was a drag. */
    const release = (cancelled: boolean): boolean => {
      const d = drag;
      drag = null;
      if (!d?.started) return false;
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
    const body = el.querySelector<HTMLElement>(".panel-body");
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

    // The keyboard covers the screen's foot without resizing the page (iOS): the body keeps that much clear.
    const viewport = window.visualViewport;
    const onViewport = () => {
      if (!viewport || viewport.scale > 1.01) return;
      el.style.setProperty("--keyboard", `${Math.max(0, Math.round(window.innerHeight - viewport.height))}px`);
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

  return rest;
}
