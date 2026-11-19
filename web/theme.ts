import { useLayoutEffect, useState, type RefObject } from "react";
import { LINES, RAILROADS, type Line, type NetworkClass } from "../shared/railroads.ts";

/** A line the map can colour: a route's line, or passenger-owned track in the network. */
export type MapLine = Line | "passenger";
export const MAP_LINES: readonly MapLine[] = [...LINES, "passenger"];
/** The lines each network class is drawn in. */
export const CLASS_LINES: Record<NetworkClass, readonly MapLine[]> = { class_i: RAILROADS, regional: ["regional"], short_line: ["short line"], passenger: ["passenger"] };

export type RGBA = [number, number, number, number];
/** A theme colour for what takes CSS colours but cannot read a variable: an image, MapLibre paint. */
export const css = ([r, g, b, a]: RGBA) => `rgba(${r},${g},${b},${a / 255})`;
export interface ThemeColors {
  /** The page's font stack, for text deck.gl draws on its canvas. */
  sans: string;
  fg: RGBA;
  /** The selected and the edited, filled or as a ring; never thin lines or text. */
  accent: RGBA;
  /** The dark outline round an accent ring. */
  onAccent: RGBA;
  /** Routes that are not selected. */
  alternative: RGBA;
  /** The edge under a route line, round markers and under names: the map's paper. */
  casing: RGBA;
  /** Every line of the network, whatever its carrier. */
  neutral: RGBA;
  /** In Auto zoomed out, the day side and the night side share the screen: the network is a light line on a dark see-through casing, like the place names there. */
  fromSpace: { line: RGBA; casing: RGBA };
  /** What will not work: a shop link the drop would refuse. */
  risk: RGBA;
  /** The selected route, and the carrier the Layers popover shows, are drawn in their lines' colours. */
  rail: Record<MapLine, RGBA>;
}

/** jsdom has no stylesheet, so there every token reads empty: grey, in the default sans. */
const NO_TOKEN = "#808080";
const NO_FONT = "sans-serif";

/** "#rrggbb", or "#rrggbbaa" for a see-through one. */
function hexOf(style: CSSStyleDeclaration, name: string): RGBA {
  const h = (style.getPropertyValue(name).trim() || NO_TOKEN).replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), parseInt(h.slice(6, 8) || "ff", 16)];
}

/** The CSS colour token of a line: `--rr-UP`, `--rr-short-line`, `--rr-passenger`. */
const lineToken = (line: MapLine) => `--rr-${line.replace(" ", "-")}`;
export const lineColor = (line: MapLine) => `var(${lineToken(line)})`;

/** Tokens as `scope` sees them: the whole page takes the map's day or night look (styles.css, `:root:has(.map[data-look="night"])`). */
function read(scope?: Element | null): ThemeColors {
  const style = getComputedStyle(scope ?? document.documentElement);
  const hex = (name: string) => hexOf(style, name);
  return {
    sans: style.getPropertyValue("--font").trim() || NO_FONT,
    fg: hex("--text"),
    accent: hex("--accent"),
    onAccent: hex("--on-accent"),
    alternative: hex("--alt-route"),
    casing: hex("--casing"),
    neutral: hex("--rail-neutral"),
    fromSpace: { line: hex("--rail-from-space"), casing: hex("--rail-casing-from-space") },
    risk: hex("--risk"),
    rail: Object.fromEntries(MAP_LINES.map((line) => [line, hex(lineToken(line))])) as Record<MapLine, RGBA>,
  };
}

/** CSS theme tokens as deck.gl values, read from `scope` (an element inside the map) after each change of `look`. */
export function useThemeColors(scope?: RefObject<Element | null>, look?: string): ThemeColors {
  const [colors, setColors] = useState(() => read());
  useLayoutEffect(() => {
    setColors(read(scope?.current));
  }, [scope, look]);
  return colors;
}
