/**
 * Where the user is, as a value. The URL is the single owner of "which screen, which saved route,
 * which alternative": a link is built from a Screen and a URL is parsed into one, so no component
 * writes a path by hand and Back, reload and a pasted link all land on the same place.
 *
 *   /route                      the route planner, a new plan          ?option=shortest
 *   /route/saved/:routeId       a saved route, open in the planner     ?option=shortest
 *   /shops   /shops/new   /shops/:shopId
 *
 * Places are never in a URL: only ids and view choices.
 */
import { useEffect, useSyncExternalStore } from "react";
import type { ShopId } from "../../shared/places.ts";
import type { SavedRouteId } from "../../shared/plans.ts";
import { ROUTE_STRATEGIES, type RouteStrategy } from "../../shared/route.ts";

export type Screen =
  | { name: "route"; saved: SavedRouteId | null; option: RouteStrategy | null }
  | { name: "shops"; edit: ShopId | "new" | null };

export const HOME: Screen = { name: "route", saved: null, option: null };

function decode(segment: string): string | null {
  try {
    const value = decodeURIComponent(segment);
    return value === "" ? null : value;
  } catch {
    return null;
  }
}

const optionOf = (text: string | null): RouteStrategy | null =>
  (ROUTE_STRATEGIES as readonly string[]).includes(text ?? "") ? (text as RouteStrategy) : null;

/** Unknown paths parse as HOME. `parseLocation(hrefFor(s))` is `s` for every Screen. */
export function parseLocation(pathname: string, search: string): Screen {
  const parts = pathname.split("/").filter(Boolean);
  const query = new URLSearchParams(search);
  const [head, ...rest] = parts;

  if (head === "route") {
    if (rest.length === 0) return { name: "route", saved: null, option: optionOf(query.get("option")) };
    const id = rest.length === 2 && rest[0] === "saved" ? decode(rest[1]) : null;
    return id === null ? HOME : { name: "route", saved: id as SavedRouteId, option: optionOf(query.get("option")) };
  }

  if (head === "shops" && rest.length <= 1) {
    if (!rest.length) return { name: "shops", edit: null };
    if (rest[0] === "new") return { name: "shops", edit: "new" };
    const id = decode(rest[0]);
    return id === null ? HOME : { name: "shops", edit: id as ShopId };
  }

  return HOME;
}

export function hrefFor(screen: Screen): string {
  switch (screen.name) {
    case "route": {
      const path = screen.saved === null ? "/route" : `/route/saved/${encodeURIComponent(screen.saved)}`;
      return screen.option ? `${path}?${new URLSearchParams({ option: screen.option })}` : path;
    }
    case "shops":
      return screen.edit === null ? "/shops" : screen.edit === "new" ? "/shops/new" : `/shops/${encodeURIComponent(screen.edit)}`;
  }
}

// ---- the current screen, from the browser's location ----

const NAVIGATE = "visnarn:navigate";

function subscribe(onChange: () => void): () => void {
  window.addEventListener("popstate", onChange);
  window.addEventListener(NAVIGATE, onChange);
  return () => {
    window.removeEventListener("popstate", onChange);
    window.removeEventListener(NAVIGATE, onChange);
  };
}

/** Parsed once per distinct URL, so the snapshot is the same object until the URL changes. */
let lastHref: string | null = null;
let lastScreen: Screen = HOME;

function currentScreen(): Screen {
  const href = window.location.pathname + window.location.search;
  if (href !== lastHref) {
    lastHref = href;
    lastScreen = parseLocation(window.location.pathname, window.location.search);
  }
  return lastScreen;
}

/** The current screen; re-renders on navigation (history.pushState / popstate through useSyncExternalStore). */
export function useScreen(): Screen {
  const screen = useSyncExternalStore(subscribe, currentScreen, () => HOME);
  // An unknown or retired link (/cars, /batch) shows HOME, so the address bar names HOME too.
  useEffect(() => go(screen, { replace: true }), [screen]);
  return screen;
}

/** `replace` for view choices that should not add a Back step (picking an alternative). */
export function go(screen: Screen, options?: { replace?: boolean }): void {
  const href = hrefFor(screen);
  if (href === window.location.pathname + window.location.search) return;
  if (options?.replace) window.history.replaceState(null, "", href);
  else window.history.pushState(null, "", href);
  window.dispatchEvent(new Event(NAVIGATE));
}

type LinkClick = { preventDefault(): void; metaKey: boolean; ctrlKey: boolean; shiftKey?: boolean; button?: number };

function navigateOnClick(screen: () => Screen) {
  return (event: LinkClick) => {
    // A modified or middle click keeps the browser's own behaviour: a new tab or window.
    if (event.metaKey || event.ctrlKey || event.shiftKey || (event.button !== undefined && event.button !== 0)) return;
    event.preventDefault();
    go(screen());
  };
}

/** Props for an <a> that navigates without a page load and still opens in a new tab on a modified click. */
export function linkTo(screen: Screen): { href: string; onClick: (event: { preventDefault(): void; metaKey: boolean; ctrlKey: boolean }) => void } {
  return { href: hrefFor(screen), onClick: navigateOnClick(() => screen) };
}
