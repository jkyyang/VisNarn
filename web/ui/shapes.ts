/**
 * The status shapes, once, as SVG markup on a 14 × 14 box. The page draws them with CSS colours
 * (`.s-fill` takes the status colour, `.s-mark` the panel colour) so they follow the theme; the map
 * draws the same markup with fixed colours as icons.
 */
import type { TriageGroup } from "../../shared/route.ts";
import type { Pill } from "../words.ts";

export type ShapeName = Pill | `group-${TriageGroup}`;

const MARKUP: Record<ShapeName, string> = {
  "at-risk":
    '<path class="s-fill" d="M4.5 1h5L13 4.5v5L9.5 13h-5L1 9.5v-5z"/><path class="s-mark" d="M7 4v3.6M7 9.8v.1" fill="none" stroke-width="1.7" stroke-linecap="round"/>',
  tight:
    '<path class="s-fill" d="M7 1.3l6.2 11.2H.8z"/><path class="s-mark" d="M7 5.4v3.2M7 10.4v.1" fill="none" stroke-width="1.6" stroke-linecap="round"/>',
  "on-time":
    '<circle class="s-fill" cx="7" cy="7" r="6.2"/><path class="s-mark" d="M4.2 7.2l1.9 1.9 3.7-4" fill="none" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
  "check-route":
    '<rect class="s-fill" x=".5" y=".5" width="13" height="13" rx="3.5"/><path class="s-mark" d="M4.5 11V6.3a2.3 2.3 0 0 1 4.6 0v3.4M7.4 8.2l1.7 1.7 1.7-1.7" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
  "cannot-check": '<rect class="s-fill" x="1" y="1" width="12" height="12"/><path class="s-mark" d="M4 7h6" fill="none" stroke-width="1.8" stroke-linecap="round"/>',
  "group-act-now":
    '<path class="s-fill" d="M4.5 1h5L13 4.5v5L9.5 13h-5L1 9.5v-5z"/><path class="s-mark" d="M7 4v3.6M7 9.8v.1" fill="none" stroke-width="1.7" stroke-linecap="round"/>',
  "group-check-first":
    '<circle class="s-fill" cx="7" cy="7" r="6.2"/><path class="s-mark" d="M5.3 5.4a1.8 1.8 0 1 1 2.4 1.7c-.5.2-.7.5-.7 1v.3M7 10.3v.1" fill="none" stroke-width="1.5" stroke-linecap="round"/>',
  "group-ok":
    '<circle class="s-fill" cx="7" cy="7" r="6.2"/><path class="s-mark" d="M4.2 7.2l1.9 1.9 3.7-4" fill="none" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
};

export const shapeMarkup = (name: ShapeName) => MARKUP[name];

/** Light-theme colours of the statuses, for the map's icons (the page uses CSS variables). */
export const STATUS_HEX: Record<Pill, string> = {
  "at-risk": "#c5221f",
  tight: "#b06000",
  "on-time": "#188038",
  "check-route": "#7b1fa2",
  "cannot-check": "#5f6368",
};

/** The shape as a stand-alone SVG image (a data URL) in one colour with a white mark. */
export function shapeDataUrl(pill: Pill, size: number): string {
  const body = MARKUP[pill]
    .replaceAll('class="s-fill"', `fill="${STATUS_HEX[pill]}" stroke="#ffffff" stroke-width="1.2"`)
    .replaceAll('class="s-mark"', 'stroke="#ffffff"');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="-1 -1 16 16">${body}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
