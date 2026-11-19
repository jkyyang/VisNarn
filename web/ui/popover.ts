/**
 * The one popover open on the page: opening one closes the one before. While open, Escape or a press
 * anywhere outside its own elements closes it. A press on the map that closes it does nothing else.
 */
import { useCallback, useEffect, useId, useSyncExternalStore, type RefObject } from "react";
import { useEscape } from "./useEscape.ts";

let openId: string | null = null;
const listeners = new Set<() => void>();

function show(id: string | null): void {
  openId = id;
  listeners.forEach((listener) => listener());
}

/** Whether the press going on began with a popover open. Heard first, on the window, before that popover closes. */
let closingPress = false;
window.addEventListener("pointerdown", () => void (closingPress = openId !== null), true);
/** A press that closes a popover only closes it: the map and its marks ask this before they act on a click. */
export const pressClosesPopover = (): boolean => closingPress;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** Whether this popover is open, and its setter. `inside`: the popover and the button that opens it, where a press keeps it open. */
export function usePopover(inside: readonly RefObject<Element | null>[]): [boolean, (open: boolean) => void] {
  const id = useId();
  const open = useSyncExternalStore(subscribe, () => openId === id, () => false);
  const setOpen = useCallback(
    (next: boolean) => {
      if (next) show(id);
      else if (openId === id) show(null);
    },
    [id],
  );
  useEscape(open, () => setOpen(false));

  useEffect(() => {
    if (!open) return;
    // Capture: the map takes its own presses, and this one must still hear them.
    const onPress = (event: PointerEvent) => {
      if (!inside.some((ref) => ref.current?.contains(event.target as Node))) setOpen(false);
    };
    document.addEventListener("pointerdown", onPress, true);
    return () => document.removeEventListener("pointerdown", onPress, true);
  }, [open]);

  // Gone while open: nothing is open.
  useEffect(() => () => setOpen(false), [setOpen]);
  return [open, setOpen];
}
