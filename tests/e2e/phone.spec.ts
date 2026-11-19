/**
 * Phone held upright, as the "iphone" (WebKit, iPhone 15 Pro) and "android" (Chrome, Pixel 7) projects run it:
 * the map fills the screen and the panel is a sheet over its foot, at three rests: its head, half, full.
 */
import type { Page } from "@playwright/test";
import { expect, expectMapCanvas, expectNoSideScroll, keepScreenshot, mapPoint, mapRegion, planRoute, test } from "./app.ts";

/** How far down the screen the sheet's top is, 0 to 1. */
const sheetTop = (page: Page) => page.locator(".panel").evaluate((panel) => panel.getBoundingClientRect().top / window.innerHeight);

/** Drags the sheet by its grabber, in steps, from where it is to `to` (0 to 1 of the screen's height). */
async function dragSheet(page: Page, to: number): Promise<void> {
  const grabber = await page.locator(".sheet-grabber").boundingBox();
  const height = page.viewportSize()?.height ?? 0;
  if (!grabber) throw new Error("The sheet has no grabber.");
  const x = grabber.x + grabber.width / 2;
  await page.mouse.move(x, grabber.y + grabber.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, to * height, { steps: 12 });
  await page.mouse.up();
}

test("The map fills the screen; the sheet rests at half and drags to full and to its head", async ({ page }) => {
  await page.goto("/route");
  await expectMapCanvas(page);
  const map = await mapRegion(page).boundingBox();
  const size = page.viewportSize();
  expect(map).toMatchObject({ x: 0, y: 0, width: size?.width, height: size?.height });
  await expect.poll(() => sheetTop(page)).toBeCloseTo(0.58, 1);

  await dragSheet(page, 0.1);
  await expect.poll(() => sheetTop(page)).toBeLessThan(0.1);
  await expect(page.getByRole("button", { name: "Lower the panel" })).toBeVisible();

  // Down to its head: the search and Route | Shops stay on screen, nothing else.
  await dragSheet(page, 0.95);
  const search = page.getByRole("combobox", { name: "Search shops and cities" });
  await expect(search).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole("navigation", { name: "Mode" })).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole("combobox", { name: "Start" })).not.toBeInViewport();

  // The grabber's tap goes to half.
  await page.getByRole("button", { name: "Raise the panel" }).tap();
  await expect.poll(() => sheetTop(page)).toBeCloseTo(0.58, 1);
  await expectNoSideScroll(page);
});

test("Text fields are 16 px or larger, so iOS does not zoom; a focused field raises the sheet above the keyboard", async ({ page }) => {
  for (const path of ["/route", "/shops/new"]) {
    await page.goto(path);
    await expect(page.locator(".panel input").first()).toBeVisible();
    const sizes = await page.locator("input").evaluateAll((inputs) => inputs.map((input) => parseFloat(getComputedStyle(input).fontSize)));
    expect(Math.min(...sizes), path).toBeGreaterThanOrEqual(16);
  }
  await page.goto("/route");
  const search = page.getByRole("combobox", { name: "Search shops and cities" });
  await search.tap();
  await expect(search).toBeFocused();
  await expect.poll(() => sheetTop(page)).toBeLessThan(0.1);
  // Enter, a phone's Go key: the keyboard goes.
  await search.press("Enter");
  await expect(search).not.toBeFocused();
});

test("A plan on a phone: ⌖ lowers the sheet for the map, the route's places lower it to half, and full shows the result", async ({ page }) => {
  await page.goto("/route");
  // Start's ⌖ is on as the planner opens; Destination's is pressed.
  await page.getByRole("button", { name: "Pick on the map: Destination" }).tap();
  await expect(page.getByRole("combobox", { name: "Destination" })).not.toBeInViewport();
  await expect(page.locator("section.map")).toHaveAttribute("data-picking", "true");
  await page.getByRole("button", { name: "Raise the panel" }).tap();

  const planned = await planRoute(page, "Taylor, TX", "North Little Rock, AR");
  await expect(page.getByRole("combobox", { name: "Destination" })).not.toBeFocused();
  await expect.poll(() => sheetTop(page)).toBeCloseTo(0.58, 1);
  // The camera frames the whole route above the sheet.
  if (planned.outcome !== "routed") throw new Error("No route.");
  const points = planned.routes[0].legs.flatMap((leg) => leg.path);
  const [lons, lats] = [points.map((p) => p[0]), points.map((p) => p[1])];
  const northWest = await mapPoint(page, [Math.min(...lons), Math.max(...lats)]);
  const southEast = await mapPoint(page, [Math.max(...lons), Math.min(...lats)]);
  expect(northWest.x).toBeGreaterThan(0);
  expect(northWest.y).toBeGreaterThan(0);
  expect(southEast.x).toBeLessThan(page.viewportSize()?.width ?? 0);
  expect(southEast.y).toBeLessThan((await sheetTop(page)) * (page.viewportSize()?.height ?? 0));
  await page.getByRole("button", { name: "Raise the panel" }).tap();
  const result = page.getByRole("region", { name: "Route", exact: true });
  await result.scrollIntoViewIfNeeded();
  await expect(result).toBeInViewport();
  await expect(page.getByRole("list", { name: "Sections" })).toBeVisible();
  await keepScreenshot(page, "phone");

  // The layers card stays on the map, over the sheet's top.
  await page.getByRole("button", { name: "Lower the panel" }).tap();
  await page.getByRole("button", { name: /^Map layers/ }).tap();
  const card = await page.locator(".layers-card").boundingBox();
  const top = (await sheetTop(page)) * (page.viewportSize()?.height ?? 0);
  expect((card?.y ?? 0) + (card?.height ?? 0)).toBeLessThanOrEqual(top);
  await page.keyboard.press("Escape");
  await expect(page.locator(".layers-card")).toBeHidden();
  await expectNoSideScroll(page);
});

test("A red edge says why on a tap: no hover on a phone", async ({ page }) => {
  await page.goto("/route");
  const search = page.getByRole("combobox", { name: "Search shops and cities" });
  await search.fill("Qqzzx");
  await expect(page.locator(".search-field")).toHaveClass(/is-wrong/);
  await search.tap();
  await expect(page.locator(".why-tip")).toHaveText("No shop, code or city called “Qqzzx”.");
  await expect(page.locator(".why-tip")).toBeInViewport();
});

test("Shops fits the width; a shop picked stays on show at half, and its Edit opens the form at its heading", async ({ page }) => {
  await page.goto("/shops");
  await expectMapCanvas(page);
  await expectNoSideScroll(page);
  await page.getByRole("button", { name: "Raise the panel" }).tap();
  // A row's tap selects it: the sheet lowers to half with the row, and now its Edit, still on show.
  const row = page.getByRole("listitem").filter({ has: page.getByRole("button", { name: /^Edit / }) }).last();
  await row.scrollIntoViewIfNeeded();
  await row.getByRole("button").first().tap();
  await expect.poll(() => sheetTop(page)).toBeCloseTo(0.58, 1);
  await expect(row).toBeInViewport({ ratio: 1 });
  await row.getByRole("button", { name: /^Edit / }).tap();
  await expect.poll(() => sheetTop(page)).toBeCloseTo(0.58, 1);
  const form = page.getByRole("region", { name: "Edit shop" });
  await expect(form.getByRole("heading", { name: "Edit shop" })).toBeInViewport({ ratio: 1 });
  // The name waits for a tap: no keyboard over the map the shop is set on.
  await expect(form.getByRole("textbox", { name: "Name", exact: true })).not.toBeFocused();
  await expectNoSideScroll(page);
});
