/**
 * Drag to reorder a vertical list, with a physical feel, and the same by keyboard.
 *
 * Pointer, from a row's handle: the row follows the pointer 1:1 and the others slide aside to open its
 * slot; past the first or last slot it rubber-bands. On release it settles into the slot its momentum
 * points to, on a spring that starts at the release speed, and only then does the list change order.
 * Keyboard, on the handle: Space or Enter grabs the row, the arrows (Home, End) move it, Space or Enter
 * drops it, Esc puts it back. Every other change of order slides the rows from where they were (FLIP).
 * With prefers-reduced-motion nothing slides, scales or springs.
 *
 * The list is an element whose children are the rows, in order; slide timing is CSS (.place-row).
 */
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from "react";
import { flushSync } from "react-dom";

/** Travel before a press on the handle becomes a drag, so a tap stays a tap. */
const DRAG_AFTER_PX = 4;
/** How far momentum carries a released row: Apple's deceleration rate, the snappier one. */
const DECELERATION = 0.99;
/** Release speed is measured over the pointer's last moves within this window. */
const VELOCITY_MS = 100;
/** Rubber band stiffness past the ends (Apple's constant). */
const RUBBER = 0.55;
/** The settle spring: response 0.4 s, critically damped, so a row lands without bouncing. */
const SPRING = { stiffness: (2 * Math.PI / 0.4) ** 2, damping: (4 * Math.PI * 1) / 0.4 };
/** The lift of a dragged row. */
const LIFT_SCALE = 1.02;

const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Distance past an end, shortened the further it goes. */
const rubber = (over: number, size: number) => (over * size * RUBBER) / (size + RUBBER * Math.abs(over));

/** Moves `x` to `to` along a damped spring starting at velocity `v` (px/s); returns a stop function. */
function spring(from: number, to: number, v: number, onUpdate: (x: number) => void, onDone: () => void): () => void {
  let x = from;
  let last = performance.now();
  let frame = 0;
  const tick = (now: number) => {
    const dt = Math.min((now - last) / 1000, 1 / 30);
    last = now;
    v += (-SPRING.stiffness * (x - to) - SPRING.damping * v) * dt;
    x += v * dt;
    if (Math.abs(x - to) < 0.3 && Math.abs(v) < 5) {
      onUpdate(to);
      onDone();
      return;
    }
    onUpdate(x);
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(frame);
}

interface Drag {
  from: number;
  pointerId: number;
  startY: number;
  rows: HTMLElement[];
  heights: number[];
  gap: number;
  offset: number;
  target: number;
  samples: { t: number; y: number }[];
  started: boolean;
  stop: (() => void) | null;
}

export interface Reorder {
  listRef: RefObject<HTMLOListElement>;
  /** The row grabbed by keyboard, if any. */
  grabbed: number | null;
  /** What a live region should say. */
  announcement: string;
  handleProps: (at: number) => {
    "data-handle": true;
    "aria-pressed": boolean;
    onPointerDown: (event: PointerEvent<HTMLElement>) => void;
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
    onBlur: () => void;
  };
}

/**
 * `keys` name the rows in order (FLIP follows a key from its old place to its new one); `onMove`
 * changes the order; `nameOf` names a row for the announcements.
 */
export function useReorder(keys: string[], onMove: (from: number, to: number) => void, nameOf: (at: number) => string): Reorder {
  const listRef = useRef<HTMLOListElement>(null);
  const [grabbed, setGrabbed] = useState<{ at: number; origin: number } | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const drag = useRef<Drag | null>(null);
  const skipSlide = useRef(false);
  const before = useRef<{ keys: string[]; tops: Map<string, number> }>({ keys: [], tops: new Map() });

  const rowsOf = () => [...(listRef.current?.children ?? [])] as HTMLElement[];
  const announce = (text: string) => {
    // Cleared first, so the same words twice are read twice.
    setAnnouncement("");
    setTimeout(() => setAnnouncement(text), 100);
  };
  const where = (at: number) => `position ${at + 1} of ${keys.length}`;

  // FLIP: after a change of order, each row starts where it was and slides to where it is.
  useLayoutEffect(() => {
    const rows = rowsOf();
    const tops = new Map(keys.map((key, i) => [key, rows[i]?.offsetTop ?? 0]));
    const last = before.current;
    before.current = { keys, tops };
    const reordered = last.keys.length > 0 && last.keys.join("\n") !== keys.join("\n");
    if (skipSlide.current || !reordered || reducedMotion()) {
      skipSlide.current = false;
      return;
    }
    const moved = rows.flatMap((row, i) => {
      const was = last.tops.get(keys[i]);
      const dy = was === undefined ? 0 : was - tops.get(keys[i])!;
      if (!dy) return [];
      row.style.transition = "none";
      row.style.transform = `translateY(${dy}px)`;
      return [row];
    });
    if (!moved.length) return;
    void listRef.current?.offsetHeight;
    for (const row of moved) {
      row.style.transition = "";
      row.style.transform = "";
    }
  });

  // A list that goes away mid-settle stops its spring.
  useEffect(() => () => drag.current?.stop?.(), []);

  // Keyboard moves re-render the rows by position: focus follows the grabbed row's handle.
  useLayoutEffect(() => {
    if (grabbed) rowsOf()[grabbed.at]?.querySelector<HTMLElement>("[data-handle]")?.focus({ preventScroll: true });
  }, [grabbed]);

  /** The dragged row's offset when it sits in slot `to`, and the shift each other row makes for it. */
  const slotOffset = (d: Drag, to: number) => {
    let offset = 0;
    for (let i = Math.min(d.from, to); i <= Math.max(d.from, to); i++) if (i !== d.from) offset += (d.heights[i] + d.gap) * Math.sign(to - d.from);
    return offset;
  };
  const shiftOthers = (d: Drag, to: number) => {
    const size = d.heights[d.from] + d.gap;
    d.rows.forEach((row, i) => {
      if (i === d.from) return;
      const shift = d.from < i && i <= to ? -size : to <= i && i < d.from ? size : 0;
      row.style.transform = shift ? `translateY(${shift}px)` : "";
    });
  };
  const place = (d: Drag, offset: number) => {
    d.offset = offset;
    d.rows[d.from].style.transform = `translate3d(0, ${offset}px, 0)${reducedMotion() ? "" : ` scale(${LIFT_SCALE})`}`;
  };
  /** The slot nearest an offset of the dragged row. */
  const slotAt = (d: Drag, offset: number) => {
    let best = d.from;
    for (let to = 0; to < d.rows.length; to++) if (Math.abs(slotOffset(d, to) - offset) < Math.abs(slotOffset(d, best) - offset)) best = to;
    return best;
  };

  const finish = (d: Drag, to: number) => {
    const list = listRef.current;
    list?.classList.remove("is-reordering");
    for (const row of d.rows) {
      row.classList.remove("is-dragging");
      row.style.transition = "none";
      row.style.transform = "";
    }
    // The rows already stand in their new places: the new order must not slide them again.
    if (to !== d.from) {
      skipSlide.current = true;
      flushSync(() => onMove(d.from, to));
    }
    void list?.offsetHeight;
    for (const row of d.rows) row.style.transition = "";
    drag.current = null;
  };

  const onPointerDown = (at: number) => (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || drag.current || grabbed) return;
    const rows = rowsOf();
    if (rows.length < 2) return;
    const handle = event.currentTarget;
    const heights = rows.map((row) => row.offsetHeight);
    const gap = rows[1].offsetTop - rows[0].offsetTop - heights[0];
    const d: Drag = { from: at, pointerId: event.pointerId, startY: event.clientY, rows, heights, gap, offset: 0, target: at, samples: [], started: false, stop: null };
    drag.current = d;
    handle.setPointerCapture?.(event.pointerId);

    const move = (e: globalThis.PointerEvent) => {
      if (e.pointerId !== d.pointerId) return;
      const dy = e.clientY - d.startY;
      if (!d.started) {
        if (Math.abs(dy) < DRAG_AFTER_PX) return;
        d.started = true;
        rows[at].classList.add("is-dragging");
        listRef.current?.classList.add("is-reordering");
      }
      const now = performance.now();
      d.samples.push({ t: now, y: e.clientY });
      while (d.samples.length > 2 && now - d.samples[0].t > VELOCITY_MS) d.samples.shift();
      const low = slotOffset(d, 0);
      const high = slotOffset(d, rows.length - 1);
      const size = heights[at];
      place(d, dy < low ? low + rubber(dy - low, size) : dy > high ? high + rubber(dy - high, size) : dy);
      const to = slotAt(d, d.offset);
      if (to !== d.target) {
        d.target = to;
        shiftOthers(d, to);
      }
    };
    const end = (e: globalThis.PointerEvent) => {
      if (e.pointerId !== d.pointerId) return;
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      if (!d.started) {
        drag.current = null;
        return;
      }
      const first = d.samples[0];
      const latest = d.samples[d.samples.length - 1];
      const ms = latest && first ? latest.t - first.t : 0;
      const velocity = e.type === "pointercancel" || ms <= 0 ? 0 : ((latest.y - first.y) / ms) * 1000;
      // Where momentum would carry it, as Apple projects a flick; a cancelled drag goes back.
      const projected = d.offset + (velocity / 1000) * (DECELERATION / (1 - DECELERATION));
      const to = e.type === "pointercancel" ? d.from : slotAt(d, projected);
      d.target = to;
      shiftOthers(d, to);
      if (reducedMotion()) return finish(d, to);
      d.stop = spring(d.offset, slotOffset(d, to), velocity, (x) => place(d, x), () => finish(d, to));
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  };

  const onKeyDown = (at: number) => (event: KeyboardEvent<HTMLElement>) => {
    const last = keys.length - 1;
    const step = (to: number) => {
      event.preventDefault();
      if (!grabbed || to < 0 || to > last || to === at) return;
      onMove(at, to);
      setGrabbed({ at: to, origin: grabbed.origin });
      announce(`${nameOf(at)}, ${where(to)}`);
    };
    switch (event.key) {
      case " ":
      case "Enter":
        event.preventDefault();
        if (grabbed) {
          setGrabbed(null);
          announce(`Dropped, ${where(at)}`);
        } else {
          setGrabbed({ at, origin: at });
          announce(`Grabbed ${nameOf(at)}, ${where(at)}. Arrows move it, Space drops it, Escape puts it back.`);
        }
        return;
      case "ArrowUp":
        return step(at - 1);
      case "ArrowDown":
        return step(at + 1);
      case "Home":
        return step(0);
      case "End":
        return step(last);
      case "Escape":
        if (!grabbed) return;
        event.preventDefault();
        event.stopPropagation();
        if (grabbed.origin !== at) onMove(at, grabbed.origin);
        setGrabbed(null);
        announce(`Put back, ${where(grabbed.origin)}`);
    }
  };

  return {
    listRef,
    grabbed: grabbed?.at ?? null,
    announcement,
    handleProps: (at) => ({
      "data-handle": true,
      "aria-pressed": grabbed?.at === at,
      onPointerDown: onPointerDown(at),
      onKeyDown: onKeyDown(at),
      // Leaving the list drops the row where it is; focus moving to the row's own new handle does not.
      onBlur: () => {
        requestAnimationFrame(() => {
          if (grabbed && !listRef.current?.contains(document.activeElement)) setGrabbed(null);
        });
      },
    }),
  };
}
