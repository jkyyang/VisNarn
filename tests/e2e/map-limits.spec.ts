/**
 * The map stays on North America: it pans only a margin past it (PAN_BOUNDS in web/map/config.ts)
 * and stops zooming out once that margin fills the screen. Zoomed all the way out, all of Alaska fits
 * right of the panel.
 * The page keeps the map instance to itself, so the test reads the map through a click: a click on
 * empty map asks the server for the nearest place at the clicked longitude and latitude.
 */
import type { Page } from "@playwright/test";
import { expect, expectMapCanvas, mapRegion, test } from "./app.ts";
import { PAN_BOUNDS } from "../../web/map/config.ts";

const [[WEST, SOUTH], [EAST, NORTH]] = PAN_BOUNDS;

/**
 * Clicks the map at a fraction of its width and height and returns the place clicked. It waits for the
 * answer, as the planner hears no other click while it is still placing one.
 */
async function placeAt(page: Page, fx: number, fy: number): Promise<{ lon: number; lat: number }> {
  const box = await mapRegion(page).locator("canvas.maplibregl-canvas").boundingBox();
  if (!box) throw new Error("The map canvas is not on the page.");
  const answered = page.waitForResponse((response) => response.url().includes("/api/places/nearest"));
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
  const query = new URL((await answered).url()).searchParams;
  // West of 180° the page sends the longitude of the world drawn again there: 110 is -250 here.
  const lon = Number(query.get("lon"));
  return { lon: lon > 0 ? lon - 360 : lon, lat: Number(query.get("lat")) };
}

/** Zooms all the way out, then drags the map as far as it goes towards one side. */
async function zoomOutAndDrag(page: Page, dx: number, dy: number): Promise<void> {
  for (let step = 0; step < 8; step++) await page.getByRole("button", { name: "Zoom out" }).click();
  const box = await mapRegion(page).locator("canvas.maplibregl-canvas").boundingBox();
  if (!box) throw new Error("The map canvas is not on the page.");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 20 });
  await page.mouse.up();
  await page.waitForTimeout(500);
}

/** MapLibre clamps to the bounds exactly; a pixel either side is a few hundredths of a degree. */
const SLACK_DEG = 0.5;

test("the map pans a margin past North America and no further, and stops zooming out there", async ({ page }) => {
  await page.goto("/route");
  await expectMapCanvas(page);

  // Pulled towards the South Atlantic: the bottom edge stops at 5° N, the right edge at 20° W.
  await zoomOutAndDrag(page, -3000, -3000);
  const southEast = await placeAt(page, 0.98, 0.98);
  expect(southEast.lat).toBeGreaterThanOrEqual(SOUTH - SLACK_DEG);
  expect(southEast.lon).toBeLessThanOrEqual(EAST + SLACK_DEG);
  // Fully zoomed out the screen spans at most the side limits: the world stays big.
  // The left edge, in the gap left of the panel that floats over the map from 12 px in.
  const west = await placeAt(page, 0.004, 0.5);
  expect(west.lon).toBeGreaterThanOrEqual(WEST - SLACK_DEG);

  // Pulled towards Siberia: the left edge stops at PAN_BOUNDS' west, the top edge at 83° N.
  await page.reload();
  await expectMapCanvas(page);
  await zoomOutAndDrag(page, 3000, 3000);
  // The corner itself: the panel sits over the map from 12 px in, and a click on it never reaches the map.
  const northWest = await placeAt(page, 0.004, 0.004);
  expect(northWest.lon).toBeGreaterThanOrEqual(WEST - SLACK_DEG);
  expect(northWest.lat).toBeLessThanOrEqual(NORTH + SLACK_DEG);
  // Just right of the panel the map is already west of the Aleutians: all of Alaska is in the free map.
  const map = await mapRegion(page).locator("canvas.maplibregl-canvas").boundingBox();
  const panel = await page.locator(".panel").boundingBox();
  if (!map || !panel) throw new Error("The map or the panel is not on the page.");
  const besidePanel = await placeAt(page, (panel.x + panel.width + 4 - map.x) / map.width, 0.5);
  expect(besidePanel.lon).toBeLessThan(-180);
});
