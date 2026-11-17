import { describe, expect, it } from "vitest";
import { pillWidthPx, placePills, type Box, type PillAsk } from "./pills.ts";

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
    expect(left.side).toBe("left");
    const [edge] = placePills([ask("a", [60, 300]), ask("b", [600, 300])], [], VIEW);
    expect(edge.side).toBe("right");
    expect(edge.box.left).toBeGreaterThanOrEqual(VIEW.left);
  });

  it("keeps clear of pins and the legend", () => {
    const pin: Box = { left: 335, top: 280, right: 365, bottom: 320 };
    const [placed] = placePills([ask("a", [320, 300])], [pin], VIEW);
    expect(overlap(placed.box, pin)).toBe(false);
    expect(placed.side).not.toBe("right");
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
