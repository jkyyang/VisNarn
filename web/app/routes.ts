/**
 * Where the user is, as a value. The URL is the single owner of "which screen, which car, which
 * option": a link is built from a Screen and a URL is parsed into one, so no component writes a
 * path by hand and Back, reload and a pasted link all land on the same place.
 *
 *   /route                              Route (Main / Phone), a car typed by hand     ?option=shortest
 *   /route/:batchId/:row                Route, a row of a batch
 *   /route/fix   /route/:batchId/:row/fix    Fix route                                ?at=0  (turn-back being inspected)
 *   /cars        /cars/:batchId         Cars (no id: the newest batch)                ?car=3&shop=…&hide=ok
 *   /shops       /shops/new   /shops/:shopId   Shops
 *
 * Car ids and places are never in a URL: only batch ids, row numbers and view choices.
 */
import { useSyncExternalStore } from "react";
import type { BatchId } from "../../shared/cars.ts";
import type { ShopId } from "../../shared/places.ts";
import { ROUTE_STRATEGIES, type RouteStrategy, type TriageGroup } from "../../shared/route.ts";

export type CarKey = { kind: "typed" } | { kind: "row"; batchId: BatchId; row: number };

export type Screen =
  | { name: "route"; car: CarKey; option: RouteStrategy | null }
  | { name: "fix"; car: CarKey; at: number | null }
  | { name: "cars"; batchId: BatchId | null; car: number | null; shop: string | null; hide: TriageGroup[] }
  | { name: "shops"; edit: ShopId | "new" | null };

export const HOME: Screen = { name: "route", car: { kind: "typed" }, option: null };

const GROUPS: readonly TriageGroup[] = ["act-now", "check-first", "ok"];

/** A whole number ≥ 0 written in plain digits, or null. */
function count(text: string | null): number | null {
  return text !== null && /^\d{1,9}$/.test(text) ? Number(text) : null;
}

function decode(segment: string): string | null {
  try {
    const value = decodeURIComponent(segment);
    return value === "" ? null : value;
  } catch {
    return null;
  }
}

/** Unknown paths parse as HOME. `parseLocation(hrefFor(s))` is `s` for every Screen. */
export function parseLocation(pathname: string, search: string): Screen {
  const parts = pathname.split("/").filter(Boolean);
  const query = new URLSearchParams(search);
  const [head, ...rest] = parts;

  if (head === "route") {
    const fix = rest[rest.length - 1] === "fix";
    const carParts = fix ? rest.slice(0, -1) : rest;
    let car: CarKey | null = null;
    if (carParts.length === 0) car = { kind: "typed" };
    else if (carParts.length === 2) {
      const batchId = decode(carParts[0]);
      const row = count(carParts[1]);
      if (batchId !== null && row !== null) car = { kind: "row", batchId: batchId as BatchId, row };
    }
    if (!car) return HOME;
    if (fix) return { name: "fix", car, at: count(query.get("at")) };
    const option = query.get("option");
    return { name: "route", car, option: (ROUTE_STRATEGIES as readonly string[]).includes(option ?? "") ? (option as RouteStrategy) : null };
  }

  if (head === "cars" && rest.length <= 1) {
    const batchId = rest.length ? decode(rest[0]) : null;
    if (rest.length && batchId === null) return HOME;
    const hide = (query.get("hide") ?? "").split(",").filter((g): g is TriageGroup => (GROUPS as readonly string[]).includes(g));
    return {
      name: "cars",
      batchId: batchId as BatchId | null,
      car: count(query.get("car")),
      shop: query.get("shop") || null,
      hide: GROUPS.filter((g) => hide.includes(g)),
    };
  }

  if (head === "shops" && rest.length <= 1) {
    if (!rest.length) return { name: "shops", edit: null };
    if (rest[0] === "new") return { name: "shops", edit: "new" };
    const id = decode(rest[0]);
    return id === null ? HOME : { name: "shops", edit: id as ShopId };
  }

  return HOME;
}

const carPath = (car: CarKey) => (car.kind === "typed" ? "/route" : `/route/${encodeURIComponent(car.batchId)}/${car.row}`);

function withQuery(path: string, entries: [string, string | null][]): string {
  const query = new URLSearchParams();
  for (const [key, value] of entries) if (value !== null && value !== "") query.set(key, value);
  const text = query.toString();
  return text ? `${path}?${text}` : path;
}

export function hrefFor(screen: Screen): string {
  switch (screen.name) {
    case "route":
      return withQuery(carPath(screen.car), [["option", screen.option]]);
    case "fix":
      return withQuery(screen.car.kind === "typed" ? "/route/fix" : `${carPath(screen.car)}/fix`, [["at", screen.at === null ? null : String(screen.at)]]);
    case "cars":
      return withQuery(screen.batchId ? `/cars/${encodeURIComponent(screen.batchId)}` : "/cars", [
        ["car", screen.car === null ? null : String(screen.car)],
        ["shop", screen.shop],
        ["hide", GROUPS.filter((g) => screen.hide.includes(g)).join(",")],
      ]);
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
  return useSyncExternalStore(subscribe, currentScreen, () => HOME);
}

/** `replace` for view choices that should not add a Back step (selecting a row, picking an option). */
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

/** The same, for a link given as an href that hrefFor built. */
export function linkToHref(href: string): ReturnType<typeof linkTo> {
  return {
    href,
    onClick: navigateOnClick(() => {
      const url = new URL(href, window.location.origin);
      return parseLocation(url.pathname, url.search);
    }),
  };
}
