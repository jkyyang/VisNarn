import { useSyncExternalStore } from "react";

/** Whether a CSS media query matches now; false where the browser cannot tell (tests without a layout). */
export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof matchMedia !== "function") return () => {};
      const list = matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => (typeof matchMedia === "function" ? matchMedia(query).matches : false),
    () => false,
  );
}

/** The Phone layout: the panel under the map, the inputs folded. */
export const PHONE_QUERY = "(max-width: 640px)";
