/**
 * Phone: the Route screen in a 390 × 844 window with touch, as on an iPhone 14. The map sits on
 * top, the inputs fold into one summary row, and the page scrolls as one column with nothing cut off
 * at the sides.
 */
import { expectMapCanvases, keepScreenshot, mapRegion, test, expect } from "./app.ts";

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

test("Phone: map on top, the car in one summary row, verdict, routes and steps in one column", async ({ page }) => {
  await page.goto("/route");

  const map = mapRegion(page);
  await expectMapCanvases(page);
  const mapBox = await map.boundingBox();
  expect(mapBox?.y ?? -1).toBeLessThan(10);
  expect(mapBox?.width ?? 0).toBeGreaterThan(380);

  await expect(page.getByRole("navigation", { name: "Mode" }).getByRole("link")).toHaveText([/^Route/, /^Cars/, /^Shops/]);
  // The honesty cues stay on a phone: which car, that it is EXAMPLE data, and that the map is not live.
  await expect(page.getByText("EXAMPLE DATA")).toBeVisible();
  await expect(map.locator(".map-chip .chip-short")).toBeVisible();
  await expect(map.locator(".map-chip .chip-short")).toHaveText("EXAMPLE 104233 · not live");
  const summary = page.getByRole("button", { name: "Edit car position, shop and times" });
  await expect(summary).toContainText("EXAMPLE 104233");
  await expect(summary).toContainText("Taylor, TX · A, last passed");
  await expect(summary).toContainText("Temple, TX · B, next");
  await expect(summary).toContainText("North Little Rock, AR · shop");
  await expect(page.getByRole("form", { name: "Car position and shop" })).toHaveCount(0);

  const verdict = page.getByRole("region", { name: "Verdict" });
  await expect(verdict.getByRole("heading")).toHaveText("Check the route before using this result");
  await expect(verdict).not.toContainText("On time");
  const routes = page.getByRole("region", { name: "Routes" });
  await expect(routes.getByRole("button", { pressed: true })).toContainText("1,046 km · no interchanges");
  await expect(routes.getByRole("button", { pressed: false })).toHaveCount(2);
  await expect(routes.getByRole("link", { name: "Fix route" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Steps" })).toContainText("Turns back at Temple, TX (yard track): check");

  // Nothing wider than the phone: no sideways scrolling.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await keepScreenshot(page, "phone");

  await routes.getByRole("button", { name: /No turn-backs/ }).tap();
  await expect(page).toHaveURL(/\?option=no-turn-backs$/);
  await expect(routes.getByRole("button", { pressed: true })).toContainText("828 km");

  await summary.tap();
  const form = page.getByRole("form", { name: "Car position and shop" });
  await expect(form).toBeVisible();
  await expect(form.getByRole("textbox", { name: "Car" })).toHaveValue("EXAMPLE 104233");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test("Phone: Cars, Shops and Fix route fit the width; a shop's form comes into view when Edit is tapped", async ({ page }) => {
  for (const path of ["/cars", "/shops", "/route/fix"]) {
    await page.goto(path);
    await expectMapCanvases(page);
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    expect(await page.evaluate(() => document.documentElement.scrollWidth), path).toBeLessThanOrEqual(390);
  }

  await page.goto("/cars");
  const card = page.getByRole("region", { name: /^Selected car / });
  await expect(card.getByRole("link", { name: "Open route" })).toBeVisible();
  // The card is one short block, so most of the map stays in view.
  expect((await card.boundingBox())?.height ?? 999).toBeLessThan(110);

  await page.goto("/shops");
  await page.getByRole("button", { name: /^Edit / }).first().tap();
  const form = page.getByRole("region", { name: "Edit shop" });
  await expect(form.getByRole("textbox", { name: "Name", exact: true })).toBeFocused();
  await expect(form.getByRole("textbox", { name: "Name", exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
