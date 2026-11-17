import { useEffect, useLayoutEffect, useState, type RefObject } from "react";
import { RAILROADS, type Railroad } from "../shared/railroads.ts";
import type { Pill } from "./words.ts";

export type RGBA = [number, number, number, number];
export interface ThemeColors {
  dark: boolean;
  fg: RGBA;
  muted: RGBA;
  accent: RGBA;
  warn: RGBA;
  panel: RGBA;
  /** The selected route, Google-Maps blue. */
  route: RGBA;
  /** Routes that are not selected, and the ghost of the route before a fix. */
  alternative: RGBA;
  /** The white edge under a route line and around rings. */
  casing: RGBA;
  rail: Record<Railroad, RGBA>;
  /** The status colours, for the car markers: the same tokens the pills use, so they follow the theme. */
  status: Record<Pill, RGBA>;
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
  const scheme = style.getPropertyValue("color-scheme").trim();
  return {
    dark: scheme ? scheme === "dark" : mq().matches,
    fg: hex("--fg", "#202124"),
    muted: hex("--muted", "#5f6368"),
    accent: hex("--accent", "#1a73e8"),
    warn: hex("--tight", "#b06000"),
    panel: hex("--panel", "#ffffff"),
    route: hex("--route", "#1a73e8"),
    alternative: hex("--alt-route", "#9aa0a6"),
    casing: hex("--casing", "#ffffff"),
    rail: Object.fromEntries(RAILROADS.map((r) => [r, hex(`--rr-${r}`, RAIL_FALLBACK[r])])) as Record<Railroad, RGBA>,
    status: {
      "at-risk": hex("--risk", "#c5221f"),
      tight: hex("--tight", "#b06000"),
      "on-time": hex("--ok", "#188038"),
      "check-route": hex("--check", "#7b1fa2"),
      "cannot-check": hex("--cannot", "#5f6368"),
    },
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
