import { describe, expect, it } from "vitest";
import type { Bounds } from "../../shared/geo.ts";
import { isInView } from "./FitBounds.tsx";

const view = (west: number, south: number, east: number, north: number) => ({ getWest: () => west, getSouth: () => south, getEast: () => east, getNorth: () => north });

describe("isInView", () => {
  it("keeps the camera when the new content is already on screen", () => {
    expect(isInView(view(-110, 25, -80, 45), [-100, 30, -90, 40] as Bounds)).toBe(true);
  });
  it("moves the camera when any part is off screen", () => {
    expect(isInView(view(-110, 25, -80, 45), [-100, 30, -75, 40] as Bounds)).toBe(false);
    expect(isInView(view(-110, 25, -80, 45), [-100, 20, -90, 40] as Bounds)).toBe(false);
  });
});
