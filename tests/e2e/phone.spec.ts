/**
 * Phone: the route planner in a 390 × 844 window with touch, as on an iPhone 14. The map sits on top,
 * the same rows follow in one column, and nothing is cut off at the sides.
 */
import { expect, expectMapCanvases, expectNoSideScroll, keepScreenshot, mapRegion, PHONE, planRoute, test } from "./app.ts";

test.use(PHONE);

test("Phone: map on top, then the places, the routes and the sections in one column", async ({ page }) => {
  await page.goto("/route");

  const map = mapRegion(page);
  await expectMapCanvases(page);
  const mapBox = await map.boundingBox();
  expect(mapBox?.y ?? -1).toBeLessThan(10);
  expect(mapBox?.width ?? 0).toBeGreaterThan(380);

  await expect(page.getByRole("navigation", { name: "Mode" }).getByRole("link")).toHaveText([/^Route/, /^Shops/]);
  // The one honesty cue that stays on a phone: the shops are made up.
  await expect(page.getByText("EXAMPLE DATA")).toBeVisible();

  await planRoute(page, "Taylor, TX", "North Little Rock, AR");
  await expect(page.getByRole("combobox", { name: "Start" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Routes" }).getByRole("button", { pressed: true })).toBeVisible();
  await expect(page.getByRole("list", { name: "Sections" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Undo route change" })).toBeVisible();

  // Nothing wider than the phone: no sideways scrolling.
  await expectNoSideScroll(page);
  await keepScreenshot(page, "phone");
});

test("Phone: Shops fits the width; a shop's form comes into view when Edit is tapped", async ({ page }) => {
  for (const path of ["/route", "/shops"]) {
    await page.goto(path);
    await expectMapCanvases(page);
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    await expectNoSideScroll(page, path);
  }

  await page.goto("/shops");
  await page.getByRole("button", { name: /^Edit / }).first().tap();
  const form = page.getByRole("region", { name: "Edit shop" });
  await expect(form.getByRole("textbox", { name: "Name", exact: true })).toBeFocused();
  await expect(form.getByRole("textbox", { name: "Name", exact: true })).toBeInViewport();
  await expectNoSideScroll(page);
});
