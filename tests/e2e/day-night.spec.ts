/**
 * The day/night map in a real browser. Auto draws the Earth as seen from space: the night side is
 * NASA's Black Marble with its city lights, fading softly into day where the sun is setting or
 * rising, with no line drawn. The Time of day switch forces night (dark streets, city lights) or day,
 * and the route stays drawn on top throughout.
 */
import type { Page } from "@playwright/test";
import { expectMapCanvases, keepScreenshot, mapRegion, planRoute, test, expect } from "./app.ts";

/** NASA's tiles are downloaded once and kept by the page, so the first download is the one to wait for. */
const nasaTiles = (page: Page) =>
  page.waitForResponse((response) => response.url().includes("gibs.earthdata.nasa.gov"), { timeout: 15_000 }).catch(() => null);

test("Night turns the map dark with city lights, the route stays on top, and Day brings the day map back", async ({ page }) => {
  const lights = nasaTiles(page);
  await page.goto("/route");
  await planRoute(page, "Taylor, TX", "North Little Rock, AR");
  const selectedRow = page.getByRole("region", { name: "Routes" }).getByRole("button", { pressed: true });
  await expect(selectedRow).toBeVisible();
  await expectMapCanvases(page);
  const map = mapRegion(page);

  const layers = page.getByRole("button", { name: /^Map layers/ });
  await layers.click();
  await expect(page.getByRole("radio", { name: "Auto" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText(/^Follows the clock\. Now: (Day|Sunrise|Sunset|Night)$/)).toBeVisible();
  // The edge of night comes from the picture itself: there is no line to switch on.
  await expect(page.getByText("Day-night line")).toHaveCount(0);

  await page.getByRole("radio", { name: "Night" }).click();
  await expect(map).toHaveAttribute("data-look", "night");
  await expect(layers).toHaveAccessibleName("Map layers: Map · Night");
  await expect(map.locator(".maplibregl-ctrl-attrib")).toContainText("NASA");
  await layers.click();

  await expectMapCanvases(page);
  await expect(selectedRow).toBeVisible();
  await lights;
  await keepScreenshot(page, "night");

  await layers.click();
  await page.getByRole("radio", { name: "Day" }).click();
  await expect(map).toHaveAttribute("data-look", "day");
  await expect(layers).toHaveAccessibleName("Map layers: Map · Day");
  await layers.click();
  await expectMapCanvases(page);
  await keepScreenshot(page, "day");
});

test("Auto at dusk over North America: the satellite picture by day, city lights by night, a soft edge between", async ({ page }) => {
  // Half an hour after sunset in Kansas: day on the West Coast, night in the East.
  await page.clock.setFixedTime("2026-11-17T23:45:00Z");
  const lights = nasaTiles(page);
  await page.goto("/route");
  await planRoute(page, "Taylor, TX", "North Little Rock, AR");
  const selectedRow = page.getByRole("region", { name: "Routes" }).getByRole("button", { pressed: true });
  await expect(selectedRow).toBeVisible();
  await expectMapCanvases(page);
  const map = mapRegion(page);

  const layers = page.getByRole("button", { name: /^Map layers/ });
  await layers.click();
  await page.getByRole("radio", { name: "Satellite" }).click();
  await expect(page.getByRole("radio", { name: "Auto" })).toHaveAttribute("aria-checked", "true");
  await layers.click();
  for (let step = 0; step < 3; step++) await page.getByRole("button", { name: "Zoom out" }).click();

  // The map centre is past sunset; the colours over it follow.
  await expect(map).toHaveAttribute("data-look", "night");
  await expect(layers).toHaveAccessibleName(/^Map layers: Satellite · (Sunset|Night)$/);
  await expect(map.locator(".maplibregl-ctrl-attrib")).toContainText("NASA");
  await expect(selectedRow).toBeVisible();
  await lights;
  await expectMapCanvases(page);
  await keepScreenshot(page, "earth-dusk");
});
