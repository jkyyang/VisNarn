// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FraId } from "../../shared/places.ts";
import type { TurnBack } from "../../shared/route.ts";
import { TurnBackMark } from "./RouteMarkFaces.tsx";

// EXAMPLE turn-back near Chicago.
const TURN_BACK: TurnBack = {
  at: { fraId: 300001 as FraId, lon: -87.63, lat: 41.85, near: "Chicago, IL" },
  railroad: "UP",
  arrives: { subdivision: null, headingDeg: 90 },
  leaves: { subdivision: null, headingDeg: 270 },
  turnDeg: 180,
  track: "stub-end",
};

/** A phone-sized map (390 px wide): the map buttons down the right, the panel below. */
const RECTS: Record<string, { x: number; y: number; width: number; height: number }> = {
  frame: { x: 0, y: 0, width: 390, height: 700 },
  sheet: { x: 0, y: 682, width: 390, height: 800 },
  layers: { x: 334, y: 12, width: 40, height: 40 },
  reset: { x: 334, y: 60, width: 40, height: 40 },
  // The popover, 240 × 40, centred on a disc at (300, 44): above it, or below it once flipped.
  above: { x: 180, y: -4, width: 240, height: 40 },
  below: { x: 180, y: 52, width: 240, height: 40 },
};

afterEach(() => vi.restoreAllMocks());

function mockRects(rects: typeof RECTS) {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const name = this.classList.contains("turn-pop") ? (this.classList.contains("turn-pop--below") ? "below" : "above") : (this.getAttribute("data-rect") ?? "");
    return DOMRect.fromRect(rects[name] ?? { x: 0, y: 0, width: 0, height: 0 });
  });
}

describe("the turn-back popover on a phone", () => {
  it("opens below a disc near the map's top edge and to the left of the map buttons, fully in view", async () => {
    mockRects(RECTS);
    render(
      <div className="app">
        <main className="panel" data-rect="sheet" />
        <div className="map-canvas" data-rect="frame">
          <div className="map-controls">
            <button type="button" data-rect="layers">Layers</button>
            <button type="button" data-rect="reset">Reset view</button>
          </div>
          <TurnBackMark turnBack={TURN_BACK} picked={false} onPick={() => {}} />
        </div>
      </div>,
    );
    await userEvent.setup().click(screen.getByRole("button", { name: "Turn-back at Chicago, IL" }));
    const pop = screen.getByRole("tooltip");
    // Above the disc it would start over the map's top edge, so it goes below.
    expect(pop).toHaveClass("turn-pop--below");
    // Below, it is level with the Reset view button (left edge 334 px): its right edge (420) moves to 326.
    expect(pop.style.marginLeft).toBe("-94px");
  });
});

describe("the turn-back popover beside the panel", () => {
  it("slides right, clear of the panel that floats over the map's left side", async () => {
    // A desktop map: the panel covers its left 392 px; the disc at (400, 300) has its popover centred on it.
    mockRects({
      frame: { x: 0, y: 0, width: 1440, height: 900 },
      panel: { x: 12, y: 12, width: 380, height: 600 },
      above: { x: 280, y: 252, width: 240, height: 40 },
    });
    render(
      <div className="app">
        <main className="panel" data-rect="panel" />
        <div className="map-canvas" data-rect="frame">
          <TurnBackMark turnBack={TURN_BACK} picked={false} onPick={() => {}} />
        </div>
      </div>,
    );
    await userEvent.setup().click(screen.getByRole("button", { name: "Turn-back at Chicago, IL" }));
    const pop = screen.getByRole("tooltip");
    expect(pop).not.toHaveClass("turn-pop--below");
    // Its left edge (280) moves to 8 px past the panel's right edge (392).
    expect(pop.style.marginLeft).toBe("120px");
  });
});
