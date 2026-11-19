/**
 * Where the route pills go on screen, as plain geometry: each pill takes the first of its anchors and
 * corners that keeps it on the map and clear of the route lines, the pins, the cards over the map and the pills
 * placed before it. A pill with no room is left out; its line and its row in the panel still select
 * the route. Also where a turn-back disc steps off a pin it would hide.
 */
import type { PinKind } from "./scene.ts";

/** Screen pixels from the map's top-left corner. */
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Point {
  x: number;
  y: number;
}

/** Where a pill sits from its anchor. Its corner at the anchor is drawn sharp, like a callout's tail. */
export type PillCorner = "above-right" | "above-left" | "below-right" | "below-left";

export interface PillAsk {
  id: string;
  width: number;
  height: number;
  /** Screen points the pill may hang from, best first. */
  anchors: Point[];
}

export interface PillPlace {
  id: string;
  /** Index into the ask's anchors. */
  anchor: number;
  corner: PillCorner;
  box: Box;
}

/** From the anchor to the pill's near corner, across and down, so the pill sits beside its line. Matches --pill-offset in styles.css. */
const OFFSET_PX = 8;
/** Air kept between a pill and a pin, a card over the map or another pill. */
const CLEAR_PX = 4;
/** Air kept between a pill and a route line's centre: half the selected route's 11 px casing, and a little. */
const LINE_CLEAR_PX = 7;

/** Matches .route-pill in styles.css. */
export const PILL_HEIGHT_PX = 26;

/** 12 px semibold text is about 7 px a character; 8 px padding and 1 px border each side, and a little; the ↩ badge adds 18. */
export function pillWidthPx(text: string, turnBacks: number): number {
  return text.length * 7 + 20 + (turnBacks > 0 ? 18 : 0);
}

function boxAt({ x, y }: Point, corner: PillCorner, width: number, height: number): Box {
  const left = corner.endsWith("right") ? x + OFFSET_PX : x - OFFSET_PX - width;
  const top = corner.startsWith("above") ? y - OFFSET_PX - height : y + OFFSET_PX;
  return { left, top, right: left + width, bottom: top + height };
}

const inside = (box: Box, view: Box) => box.left >= view.left && box.top >= view.top && box.right <= view.right && box.bottom <= view.bottom;
const near = (a: Box, b: Box) => a.left < b.right + CLEAR_PX && b.left < a.right + CLEAR_PX && a.top < b.bottom + CLEAR_PX && b.top < a.bottom + CLEAR_PX;

/** True when the stretch p–q passes within `pad` of the box (Liang–Barsky clipping). */
function crosses(box: Box, p: Point, q: Point, pad: number): boolean {
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const edges: [number, number][] = [
    [-dx, p.x - (box.left - pad)],
    [dx, box.right + pad - p.x],
    [-dy, p.y - (box.top - pad)],
    [dy, box.bottom + pad - p.y],
  ];
  let from = 0;
  let to = 1;
  for (const [step, room] of edges) {
    if (step === 0) {
      if (room < 0) return false;
    } else if (step < 0) from = Math.max(from, room / step);
    else to = Math.min(to, room / step);
  }
  return from <= to;
}

const onLine = (box: Box, line: Point[]) => line.some((point, i) => i > 0 && crosses(box, line[i - 1], point, LINE_CLEAR_PX));

/**
 * Asks in priority order (selected first). For each anchor in order, the four corners are tried, the
 * ones facing away from the other pills' first anchors first, above before below. The first box
 * inside `view`, off every route line, and clear of the obstacles and of the pills already placed is
 * taken.
 */
export function placePills(asks: PillAsk[], obstacles: Box[], view: Box, lines: Point[][] = []): PillPlace[] {
  const placed: PillPlace[] = [];
  asks.forEach((ask, i) => {
    const others = asks.filter((_, j) => j !== i).flatMap((other) => other.anchors.slice(0, 1));
    for (const [index, anchor] of ask.anchors.entries()) {
      const middle = others.length ? others.reduce((sum, p) => sum + p.x, 0) / others.length : anchor.x;
      const [away, toward] = middle > anchor.x ? (["left", "right"] as const) : (["right", "left"] as const);
      const corners: PillCorner[] = [`above-${away}`, `below-${away}`, `above-${toward}`, `below-${toward}`];
      for (const corner of corners) {
        const box = boxAt(anchor, corner, ask.width, ask.height);
        if (!inside(box, view) || lines.some((line) => onLine(box, line)) || obstacles.some((o) => near(box, o)) || placed.some((p) => near(box, p.box))) continue;
        placed.push({ id: ask.id, anchor: index, corner, box });
        return;
      }
    }
  });
  return placed;
}

/** Each pin's round head as layers.ts draws it: its centre from the pin's map point, and its radius. */
const PIN_HEAD: Record<PinKind, { dy: number; r: number }> = {
  start: { dy: 0, r: 9 },
  stop: { dy: 0, r: 11 },
  destination: { dy: -21, r: 13 },
  shop: { dy: 0, r: 7.5 },
};
/** Half of .turn-mark in styles.css. */
const TURN_RADIUS_PX = 11;

/**
 * A turn-back is often flagged exactly at a via stop, and its disc (an HTML marker, always above the
 * canvas) would hide the stop's numbered ring. So a turn-back that would touch a pin moves to that
 * pin's upper-right, just outside its head, as a small badge: the pin and its number stay in sight.
 * Returns the shift in px from the turn-back's own point, or null when no pin is in the way.
 */
export function turnBackShift(turn: Point, pins: readonly (Point & { kind: PinKind })[]): Point | null {
  let best: { head: Point; r: number; gap: number } | null = null;
  for (const pin of pins) {
    const { dy, r } = PIN_HEAD[pin.kind];
    const head = { x: pin.x, y: pin.y + dy };
    const gap = Math.hypot(turn.x - head.x, turn.y - head.y);
    if (gap < r + TURN_RADIUS_PX && (!best || gap < best.gap)) best = { head, r, gap };
  }
  if (!best) return null;
  // On the 45° diagonal, a little past the head's edge.
  const k = best.r * Math.SQRT1_2 + 4;
  return { x: best.head.x + k - turn.x, y: best.head.y - k - turn.y };
}
