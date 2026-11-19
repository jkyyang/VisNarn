/**
 * Phone: the route planner in a 390 × 844 window with touch, as on an iPhone 14. The map sits on top,
 * the same rows follow in one column, and nothing is cut off at the sides.
 */
import { expect, expectMapCanvas, expectNoSideScroll, keepScreenshot, mapRegion, PHONE, planRoute, test } from "./app.ts";

test.use(PHONE);

test("Phone: map on top, then the places, the routes and the sections in one column", async ({ page }) => {
  await page.goto("/route");

  const map = mapRegion(page);
  await expectMapCanvas(page);
  const mapBox = await map.boundingBox();
  expect(mapBox?.y ?? -1).toBeLessThan(10);
  expect(mapBox?.width ?? 0).toBeGreaterThan(380);

  await expect(page.getByRole("navigation", { name: "Mode" }).getByRole("link")).toHaveText([/^Route/, /^Shops/]);

  await planRoute(page, "Taylor, TX", "North Little Rock, AR");
  await expect(page.getByRole("combobox", { name: "Start" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Route", exact: true })).toBeVisible();
  await expect(page.getByRole("list", { name: "Sections" })).toBeVisible();
  const undo = page.getByRole("button", { name: "Undo route change" });
  await expect(undo).toBeVisible();

  // The layers card is a popover: opening it moves no button, it stays on the map, and Escape closes it.
  const before = await undo.boundingBox();
  await page.getByRole("button", { name: /^Map layers/ }).tap();
  const card = await page.locator(".layers-card").boundingBox();
  const shown = await map.boundingBox();
  if (!card || !shown) throw new Error("The layers card or the map is not on the page.");
  expect(await undo.boundingBox()).toEqual(before);
  expect(card.x).toBeGreaterThanOrEqual(shown.x);
  expect(card.y + card.height).toBeLessThanOrEqual(shown.y + shown.height);
  await page.keyboard.press("Escape");
  await expect(page.locator(".layers-card")).toBeHidden();

  // Nothing wider than the phone: no sideways scrolling.
  await expectNoSideScroll(page);
  await keepScreenshot(page, "phone");
});

test("Phone: Shops fits the width; a shop's form comes into view when Edit is tapped", async ({ page }) => {
  for (const path of ["/route", "/shops"]) {
    await page.goto(path);
    await expectMapCanvas(page);
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    await expectNoSideScroll(page, path);
  }

  await page.goto("/shops");
  await page.getByRole("button", { name: /^Edit / }).first().tap();
  const form = page.getByRole("region", { name: "Edit shop" });
  await expect(form.getByRole("textbox", { name: "Name", exact: true })).toBeFocused();
  await expect(form.getByRole("textbox", { name: "Name", exact: true })).toBeInViewport();
  await expectNoSideScroll(page);

  // With the sheet already slid up over the map, the form still opens at its heading.
  await page.goto("/shops");
  const last = page.getByRole("button", { name: /^Edit / }).last();
  await last.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy({ top: 400 }));
  await expect.poll(() => page.locator(".panel").evaluate((panel) => panel.getBoundingClientRect().top)).toBeLessThan(20);
  await last.tap();
  await expect(form.getByRole("heading", { name: "Edit shop" })).toBeInViewport({ ratio: 1 });
});
