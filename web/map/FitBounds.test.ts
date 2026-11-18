import { describe, expect, it } from "vitest";
import type { Bounds } from "../../shared/geo.ts";
import { isInView, shouldRefit } from "./FitBounds.tsx";

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

describe("shouldRefit", () => {
  // EXAMPLE: zoomed in on Iowa/Illinois while the whole route runs Kansas City to Chicago.
  const zoomedIn = view(-93, 40, -88, 43);
  const kcToChicago = [-94.6, 39.1, -87.6, 41.9] as Bounds;
  it("keeps a zoomed-in view when a stop is added to a route the user was not seeing whole", () => {
    expect(shouldRefit(zoomedIn, kcToChicago, [-94.6, 39.1, -87.4, 42.1] as Bounds)).toBe(false);
  });
  it("re-frames a zoomed-in view only when the new route has left the screen entirely", () => {
    expect(shouldRefit(zoomedIn, kcToChicago, [-80, 30, -75, 35] as Bounds)).toBe(true);
  });
  it("re-frames when the whole route was on screen and now runs past the edge", () => {
    const whole = view(-100, 35, -85, 45);
    expect(shouldRefit(whole, kcToChicago, [-94.6, 39.1, -80, 41.9] as Bounds)).toBe(true);
    expect(shouldRefit(whole, kcToChicago, [-94.6, 39.1, -88, 42] as Bounds)).toBe(false);
  });
});
