/**
 * Popovers: one open at a time in the whole page. Opening one closes any other; a click outside it
 * (`root`: its button and its card) or Escape closes it.
 */
import { useEffect, useId, useRef, useSyncExternalStore, type RefObject } from "react";
import { useEscape } from "./useEscape.ts";

let openId: string | null = null;
const listeners = new Set<() => void>();
function setOpenId(id: string | null): void {
  openId = id;
  listeners.forEach((listener) => listener());
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

export interface Popover<T extends HTMLElement> {
  open: boolean;
  setOpen: (open: boolean) => void;
  /** The element holding the popover's button and its card: a press anywhere else closes it. */
  root: RefObject<T>;
}

export function usePopover<T extends HTMLElement = HTMLDivElement>(): Popover<T> {
  const id = useId();
  const root = useRef<T>(null);
  const open = useSyncExternalStore(subscribe, () => openId === id, () => false);
  const setOpen = (next: boolean) => {
    if (next) setOpenId(id);
    else if (openId === id) setOpenId(null);
  };
  useEscape(open, () => setOpen(false));
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpenId(null);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [open]);
  // A popover that goes away closed: the next one may open.
  useEffect(() => () => void (openId === id && setOpenId(null)), [id]);
  return { open, setOpen, root };
}
