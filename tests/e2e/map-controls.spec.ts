/**
 * The map controls in a real browser: one column top right (Layers, zoom, Reset view, Fullscreen),
 * the Layers card beside its button with the carrier filter, the credits beside the "i", the cursors,
 * and Reset view framing the whole network beside the panel.
 */
import type { Page } from "@playwright/test";
import { NETWORK_BOUNDS } from "../../web/map/scene.ts";
import { EXAMPLE_SHOPS } from "../fixtures.ts";
import { expect, expectMapCanvas, keepScreenshot, mapPoint, mapRegion, test } from "./app.ts";

const layersButton = (page: Page) => page.getByRole("button", { name: /^Map layers/ });
const layersCard = (page: Page) => page.getByRole("dialog", { name: "Layers" });
const canvasCursor = (page: Page) => mapRegion(page).locator("canvas.maplibregl-canvas").evaluate((canvas) => getComputedStyle(canvas).cursor);

test("the controls stand in one column 8 px apart; the Layers card opens beside its button, top edges in line", async ({ page }) => {
  await page.goto("/shops");
  await expectMapCanvas(page);
  const names = ["Zoom in", "Reset view to the whole network", "Fullscreen"];
  const boxes = [await layersButton(page).boundingBox(), ...(await Promise.all(names.map((name) => page.getByRole("button", { name }).boundingBox())))];
  const zoomGroup = await page.locator(".ctl-group--zoom").boundingBox();
  if (boxes.some((box) => !box) || !zoomGroup) throw new Error("A map control is not on the page.");
  const [layers, , reset, fullscreen] = boxes.map((box) => box!);
  expect([layers.width, layers.height, reset.width, fullscreen.width]).toEqual([40, 40, 40, 40]);
  expect(zoomGroup.y - (layers.y + layers.height)).toBe(8);
  expect(reset.y - (zoomGroup.y + zoomGroup.height)).toBe(8);
  expect(fullscreen.y - (reset.y + reset.height)).toBe(8);

  // A mouse click opens the card and leaves no focus ring; Tab brings one.
  await layersButton(page).click();
  await expect(layersButton(page)).toHaveAttribute("aria-expanded", "true");
  expect(await layersButton(page).evaluate((button) => button.matches(":focus-visible"))).toBe(false);
  const card = await layersCard(page).boundingBox();
  if (!card) throw new Error("The Layers card is not on the page.");
  expect(card.y).toBe(layers.y);
  expect(layers.x - (card.x + card.width)).toBe(8);
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => document.activeElement?.matches(":focus-visible"))).toBe(true);

  // A press on the map outside closes it.
  await page.mouse.click(card.x - 200, card.y + card.height + 100);
  await expect(layersCard(page)).toBeHidden();
});

test("Carriers: a row shows its carrier alone and says Only, Layers wears a dot; again, or Show all, brings all back", async ({ page }) => {
  await page.goto("/shops");
  await expectMapCanvas(page);
  const map = page.locator(".map-canvas");
  await layersButton(page).click();
  const carriers = layersCard(page).getByRole("group", { name: "Carriers" });
  await expect(carriers.getByRole("button", { pressed: false })).toHaveText(["BNSF", "UP", "CSXT", "NS", "CN", "CPKC"]);

  await carriers.getByRole("button", { name: /^CPKC/ }).click();
  await expect(carriers.getByRole("button", { pressed: true })).toHaveText("CPKCOnly");
  await expect(map).toHaveAttribute("data-carrier", "CPKC");
  await expect(layersButton(page)).toHaveAccessibleName(/· CPKC only$/);
  await expect(layersButton(page).locator(".layers-badge")).toHaveCSS("opacity", "1");
  await keepScreenshot(page, "carrier-filter");

  // The pointer on another row previews it; off the rows, the chosen one is back.
  await carriers.getByRole("button", { name: /^BNSF/ }).hover();
  await expect(map).toHaveAttribute("data-carrier", "BNSF");
  await layersCard(page).getByRole("radiogroup", { name: "Basemap" }).hover();
  await expect(map).toHaveAttribute("data-carrier", "CPKC");

  await carriers.getByRole("button", { name: /^CPKC/ }).click();
  await expect(map).not.toHaveAttribute("data-carrier");
  await carriers.getByRole("button", { name: /^UP/ }).click();
  await carriers.getByRole("button", { name: "Show all" }).click();
  await expect(map).not.toHaveAttribute("data-carrier");
  await expect(carriers.getByRole("button", { pressed: true })).toHaveCount(0);
  await expect(layersButton(page).locator(".layers-badge")).toHaveCSS("opacity", "0");
});

test("the credits open left of the i; a map move closes them, and only one popover is ever open", async ({ page }) => {
  await page.goto("/shops");
  await expectMapCanvas(page);
  const credits = page.getByRole("button", { name: "Map credits" });
  const card = page.locator(".credits-card");
  const button = await credits.boundingBox();
  expect([button?.width, button?.height]).toEqual([36, 36]);

  await credits.click();
  await expect(card).toContainText("BTS NTAD");
  await expect(card).toContainText("OpenStreetMap");
  const shown = await card.boundingBox();
  if (!button || !shown) throw new Error("The credits are not on the page.");
  expect(button.x - (shown.x + shown.width)).toBe(8);
  expect(shown.y + shown.height).toBe(button.y + button.height);

  await layersButton(page).click();
  await expect(card).toBeHidden();
  await credits.click();
  await expect(layersCard(page)).toBeHidden();
  await expect(card).toBeVisible();

  await page.getByRole("button", { name: "Zoom out" }).click();
  await expect(card).toBeHidden();
});

test("the cursor: grab on the map, grabbing while dragging it, a pointer on a shop", async ({ page }) => {
  await page.goto("/shops");
  await expectMapCanvas(page);
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  const canvas = await mapRegion(page).locator("canvas.maplibregl-canvas").boundingBox();
  if (!canvas) throw new Error("The map is not on the page.");

  await page.mouse.move(canvas.x + canvas.width - 300, canvas.y + canvas.height - 120);
  await expect.poll(() => canvasCursor(page)).toBe("grab");
  await page.mouse.down();
  await page.mouse.move(canvas.x + canvas.width - 260, canvas.y + canvas.height - 100, { steps: 5 });
  await expect.poll(() => canvasCursor(page)).toBe("grabbing");
  await page.mouse.up();

  const shop = EXAMPLE_SHOPS.find((s) => s.code === "EX-KCY-01")!;
  if (shop.location.kind !== "coord") throw new Error("The EXAMPLE shop has no coordinates.");
  const at = await mapPoint(page, [shop.location.lon, shop.location.lat]);
  await page.mouse.move(canvas.x + at.x, canvas.y + at.y - 4);
  await expect.poll(() => canvasCursor(page)).toBe("pointer");
});

test("Reset view frames the whole network right of the panel", async ({ page }) => {
  await page.goto("/shops");
  await expectMapCanvas(page);
  for (let step = 0; step < 3; step++) await page.getByRole("button", { name: "Zoom in" }).click();
  await page.getByRole("button", { name: "Reset view to the whole network" }).click();

  const panel = await page.locator(".panel").boundingBox();
  const canvas = await mapRegion(page).locator("canvas.maplibregl-canvas").boundingBox();
  if (!panel || !canvas) throw new Error("The panel or the map is not on the page.");
  const [west, south, east, north] = NETWORK_BOUNDS;
  await expect
    .poll(async () => {
      const nw = await mapPoint(page, [west, north]);
      const se = await mapPoint(page, [east, south]);
      return nw.x >= panel.x + panel.width + 16 - 1 && nw.y >= 0 && se.x <= canvas.width && se.y <= canvas.height;
    })
    .toBe(true);
  await keepScreenshot(page, "reset-view");
});
