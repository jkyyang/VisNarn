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

/** A phone-sized map (390 px wide): the search bar across the top, the map buttons down the right. */
const RECTS: Record<string, { x: number; y: number; width: number; height: number }> = {
  frame: { x: 0, y: 0, width: 390, height: 700 },
  search: { x: 12, y: 12, width: 310, height: 44 },
  layers: { x: 334, y: 12, width: 40, height: 40 },
  fit: { x: 334, y: 140, width: 40, height: 40 },
  // The popover, 240 × 40, centred on a disc at (300, 100): above it, or below it once flipped.
  above: { x: 180, y: 52, width: 240, height: 40 },
  below: { x: 180, y: 108, width: 240, height: 40 },
};

afterEach(() => vi.restoreAllMocks());

describe("the turn-back popover on a phone", () => {
  it("opens below the search bar and to the left of the map buttons, fully in view", async () => {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      const name = this.classList.contains("turn-pop") ? (this.classList.contains("turn-pop--below") ? "below" : "above") : (this.getAttribute("data-rect") ?? "");
      return DOMRect.fromRect(RECTS[name] ?? { x: 0, y: 0, width: 0, height: 0 });
    });
    render(
      <div className="map-canvas" data-rect="frame">
        <div className="map-search" data-rect="search" />
        <div className="map-controls">
          <button type="button" data-rect="layers">Layers</button>
          <button type="button" data-rect="fit">Fit whole route</button>
        </div>
        <TurnBackMark turnBack={TURN_BACK} />
      </div>,
    );
    await userEvent.setup().click(screen.getByRole("button", { name: "Turn-back at Chicago, IL" }));
    const pop = screen.getByRole("tooltip");
    // Above the disc it would sit under the search bar (which ends at 56 px), so it goes below.
    expect(pop).toHaveClass("turn-pop--below");
    // Below, it is level with the Fit button (left edge 334 px): its right edge (420) moves to 326.
    expect(pop.style.marginLeft).toBe("-94px");
  });
});
