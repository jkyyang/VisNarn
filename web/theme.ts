import { useEffect, useLayoutEffect, useState, type RefObject } from "react";
import { RAILROADS, type Railroad } from "../shared/railroads.ts";

export type RGBA = [number, number, number, number];
export interface ThemeColors {
  fg: RGBA;
  muted: RGBA;
  /** The accent of the selected route's pill and of the stop pins. */
  route: RGBA;
  /** Routes that are not selected. */
  alternative: RGBA;
  /** The white edge under a route line and around rings. */
  casing: RGBA;
  /** The selected route is drawn in its railroads' colours. */
  rail: Record<Railroad, RGBA>;
}

function hexOf(style: CSSStyleDeclaration, name: string, fallback: string): RGBA {
  const value = style.getPropertyValue(name).trim() || fallback;
  const h = value.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 255];
}

const mq = () => matchMedia("(prefers-color-scheme: dark)");

const RAIL_FALLBACK: Record<Railroad, string> = { BNSF: "#d0661f", UP: "#b8920f", CSXT: "#2b6cb0", NS: "#6b55b0", CN: "#c0392b", CPKC: "#23866a" };

/** Tokens as `scope` sees them: the map redefines them for its day or night look (styles.css, `.map[data-look]`). */
function read(scope?: Element | null): ThemeColors {
  const style = getComputedStyle(scope ?? document.documentElement);
  const hex = (name: string, fallback: string) => hexOf(style, name, fallback);
  return {
    fg: hex("--fg", "#202124"),
    muted: hex("--muted", "#5f6368"),
    route: hex("--route", "#1a73e8"),
    alternative: hex("--alt-route", "#9aa0a6"),
    casing: hex("--casing", "#ffffff"),
    rail: Object.fromEntries(RAILROADS.map((r) => [r, hex(`--rr-${r}`, RAIL_FALLBACK[r])])) as Record<Railroad, RGBA>,
  };
}

/**
 * CSS theme tokens as deck.gl colors; re-reads when the OS light/dark setting changes, and when
 * `look` changes, from `scope` (an element inside the map), after the new look is on the page.
 */
export function useThemeColors(scope?: RefObject<Element | null>, look?: string): ThemeColors {
  const [colors, setColors] = useState(() => read());
  useLayoutEffect(() => {
    setColors(read(scope?.current));
  }, [scope, look]);
  useEffect(() => {
    const m = mq();
    const update = () => setColors(read(scope?.current));
    m.addEventListener("change", update);
    return () => m.removeEventListener("change", update);
  }, [scope]);
  return colors;
}
