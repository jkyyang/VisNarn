import { describe, expect, it } from "vitest";
import { pillWidthPx, placePills, turnBackShift, type Box, type PillAsk } from "./pills.ts";

const VIEW: Box = { left: 8, top: 8, right: 1000, bottom: 700 };
const ask = (id: string, ...anchors: [number, number][]): PillAsk => ({ id, width: 100, height: 26, anchors: anchors.map(([x, y]) => ({ x, y })) });
const overlap = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

describe("placePills", () => {
  it("places the selected pill first and keeps every pill apart", () => {
    // Three routes whose best spots are close together; their other anchors are further along each line.
    const placed = placePills(
      [ask("pick", [400, 300], [300, 300], [500, 300]), ask("shortest", [410, 305], [310, 350], [510, 250]), ask("fewest", [405, 296], [300, 250], [520, 350])],
      [],
      VIEW,
    );
    expect(placed[0].id).toBe("pick");
    expect(placed).toHaveLength(3);
    for (const a of placed) for (const b of placed) if (a !== b) expect(overlap(a.box, b.box), `${a.id} / ${b.id}`).toBe(false);
  });

  it("puts a pill on the side away from the other routes, and flips it at the edge of the map", () => {
    const [left] = placePills([ask("a", [300, 300]), ask("b", [600, 300])], [], VIEW);
    expect(left.corner).toBe("above-left");
    const [edge] = placePills([ask("a", [60, 300]), ask("b", [600, 300])], [], VIEW);
    expect(edge.corner).toBe("above-right");
    expect(edge.box.left).toBeGreaterThanOrEqual(VIEW.left);
  });

  it("keeps clear of pins and the cards over the map", () => {
    const pin: Box = { left: 335, top: 260, right: 365, bottom: 340 };
    const [placed] = placePills([ask("a", [320, 300])], [pin], VIEW);
    expect(overlap(placed.box, pin)).toBe(false);
    expect(placed.corner).toMatch(/left$/);
  });

  it("sits beside the route lines", () => {
    // A line running up and to the right through the anchor: only the corners off it are free.
    const line = [{ x: 200, y: 400 }, { x: 400, y: 200 }];
    const [placed] = placePills([ask("a", [300, 300])], [], VIEW, [line]);
    expect(placed.corner).toBe("below-right");
  });

  it("moves to the next anchor when every side of the first is blocked, and leaves out a pill with no room", () => {
    const wall: Box = { left: 0, top: 0, right: 1000, bottom: 400 };
    const [moved] = placePills([ask("a", [500, 200], [500, 600])], [wall], VIEW);
    expect(moved.anchor).toBe(1);
    expect(placePills([ask("a", [500, 200])], [wall], VIEW)).toEqual([]);
  });

  it("estimates a pill's width from its text and its ↩ badge", () => {
    expect(pillWidthPx("828 km", 0)).toBe(62);
    expect(pillWidthPx("828 km", 1)).toBe(80);
  });
});

describe("turnBackShift", () => {
  // Matches the stop ring in layers.ts (22 px) and the badge in styles.css (16 px).
  const STOP_R = 11;
  const BADGE_R = 8;

  it("moves a turn-back flagged at a via stop off the stop's ring, leaving its number in sight", () => {
    const stop = { kind: "stop" as const, x: 400, y: 300 };
    const shift = turnBackShift({ x: 400, y: 300 }, [stop]);
    expect(shift).not.toBeNull();
    if (!shift) return;
    // Up and to the right, and the badge clears the middle of the ring where the number is drawn.
    expect(shift.x).toBeGreaterThan(0);
    expect(shift.y).toBeLessThan(0);
    expect(Math.hypot(shift.x, shift.y) - BADGE_R).toBeGreaterThan(STOP_R / 2);
  });

  it("sits by the destination drop's head", () => {
    const shift = turnBackShift({ x: 400, y: 300 }, [{ kind: "destination", x: 400, y: 300 }]);
    expect(shift?.y).toBeLessThan(-21);
  });

  it("leaves a turn-back alone when no pin is under it, and picks the nearest pin when several are", () => {
    expect(turnBackShift({ x: 400, y: 300 }, [{ kind: "stop", x: 460, y: 300 }])).toBeNull();
    const shift = turnBackShift({ x: 400, y: 300 }, [
      { kind: "shop", x: 412, y: 300 },
      { kind: "stop", x: 402, y: 300 },
    ]);
    expect(shift && shift.x + 400).toBeCloseTo(402 + STOP_R * Math.SQRT1_2 + 4);
  });
});
