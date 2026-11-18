import { useLayoutEffect, useState, type RefObject } from "react";
import { LINES, RAILROADS, type Line, type NetworkClass } from "../shared/railroads.ts";

/** A line the map can colour: a route's line, or passenger-owned track in the network. */
export type MapLine = Line | "passenger";
export const MAP_LINES: readonly MapLine[] = [...LINES, "passenger"];
/** The lines each network class is drawn in. */
export const CLASS_LINES: Record<NetworkClass, readonly MapLine[]> = { class_i: RAILROADS, regional: ["regional"], short_line: ["short line"], passenger: ["passenger"] };

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
  /** The selected route is drawn in its lines' colours, the network in its classes' colours. */
  rail: Record<MapLine, RGBA>;
}

/** jsdom has no stylesheet, so there every token reads empty: grey. */
const NO_TOKEN = "#808080";

function hexOf(style: CSSStyleDeclaration, name: string): RGBA {
  const h = (style.getPropertyValue(name).trim() || NO_TOKEN).replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 255];
}

/** The CSS colour token of a line: `--rr-UP`, `--rr-short-line`, `--rr-passenger`. */
const lineToken = (line: MapLine) => `--rr-${line.replace(" ", "-")}`;
export const lineColor = (line: MapLine) => `var(${lineToken(line)})`;

/** Tokens as `scope` sees them: the map redefines them for its day or night look (styles.css, `.map[data-look]`). */
function read(scope?: Element | null): ThemeColors {
  const style = getComputedStyle(scope ?? document.documentElement);
  const hex = (name: string) => hexOf(style, name);
  return {
    fg: hex("--fg"),
    muted: hex("--muted"),
    route: hex("--route"),
    alternative: hex("--alt-route"),
    casing: hex("--casing"),
    rail: Object.fromEntries(MAP_LINES.map((line) => [line, hex(lineToken(line))])) as Record<MapLine, RGBA>,
  };
}

/** CSS theme tokens as deck.gl colors, read from `scope` (an element inside the map) after each change of `look`. */
export function useThemeColors(scope?: RefObject<Element | null>, look?: string): ThemeColors {
  const [colors, setColors] = useState(() => read());
  useLayoutEffect(() => {
    setColors(read(scope?.current));
  }, [scope, look]);
  return colors;
}
