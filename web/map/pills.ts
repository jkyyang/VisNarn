/**
 * Where the route pills go on screen, as plain geometry: each pill takes the first of its anchors and
 * sides that keeps it on the map and clear of the pins, the legend and the pills placed before it. A
 * pill with no room is left out; its line and its row in the panel still select the route.
 */

/** Screen pixels from the map's top-left corner. */
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export type PillSide = "right" | "left" | "above" | "below";

export interface PillAsk {
  id: string;
  width: number;
  height: number;
  /** Screen points the pill may hang from, best first. */
  anchors: { x: number; y: number }[];
}

export interface PillPlace {
  id: string;
  /** Index into the ask's anchors. */
  anchor: number;
  side: PillSide;
  box: Box;
}

/** From the anchor to the near edge of the pill: room for its pointer. */
const OFFSET_PX = 12;
/** Air kept between a pill and anything else. */
const CLEAR_PX = 4;

/** Matches .route-pill in styles.css. */
export const PILL_HEIGHT_PX = 26;

/** 12.5 px semibold text is about 7 px a character; 10 px padding each side; the ↩ badge adds 18. */
export function pillWidthPx(text: string, turnBacks: number): number {
  return text.length * 7 + 20 + (turnBacks > 0 ? 18 : 0);
}

function boxAt(anchor: { x: number; y: number }, side: PillSide, width: number, height: number): Box {
  const { x, y } = anchor;
  switch (side) {
    case "right":
      return { left: x + OFFSET_PX, top: y - height / 2, right: x + OFFSET_PX + width, bottom: y + height / 2 };
    case "left":
      return { left: x - OFFSET_PX - width, top: y - height / 2, right: x - OFFSET_PX, bottom: y + height / 2 };
    case "above":
      return { left: x - width / 2, top: y - OFFSET_PX - height, right: x + width / 2, bottom: y - OFFSET_PX };
    case "below":
      return { left: x - width / 2, top: y + OFFSET_PX, right: x + width / 2, bottom: y + OFFSET_PX + height };
  }
}

const inside = (box: Box, view: Box) => box.left >= view.left && box.top >= view.top && box.right <= view.right && box.bottom <= view.bottom;
const near = (a: Box, b: Box) => a.left < b.right + CLEAR_PX && b.left < a.right + CLEAR_PX && a.top < b.bottom + CLEAR_PX && b.top < a.bottom + CLEAR_PX;

/**
 * Asks in priority order (selected first). For each anchor in order, the sides are tried with the
 * horizontal one facing away from the other pills' first anchors first, then the other horizontal one,
 * then above, below. The first box inside `view` and clear of the obstacles and of the pills already
 * placed is taken.
 */
export function placePills(asks: PillAsk[], obstacles: Box[], view: Box): PillPlace[] {
  const placed: PillPlace[] = [];
  asks.forEach((ask, i) => {
    const others = asks.filter((_, j) => j !== i).flatMap((other) => other.anchors.slice(0, 1));
    for (const [index, anchor] of ask.anchors.entries()) {
      const middle = others.length ? others.reduce((sum, p) => sum + p.x, 0) / others.length : anchor.x;
      const away: PillSide = middle > anchor.x ? "left" : "right";
      const sides: PillSide[] = [away, away === "left" ? "right" : "left", "above", "below"];
      for (const side of sides) {
        const box = boxAt(anchor, side, ask.width, ask.height);
        if (!inside(box, view) || obstacles.some((o) => near(box, o)) || placed.some((p) => near(box, p.box))) continue;
        placed.push({ id: ask.id, anchor: index, side, box });
        return;
      }
    }
  });
  return placed;
}
