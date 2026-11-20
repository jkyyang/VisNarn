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
  // From the screen's top, and on below its foot: under the glass of Safari's bottom bar.
  expect(map).toMatchObject({ x: 0, y: 0, width: size?.width });
  expect(map?.height).toBeGreaterThanOrEqual(size?.height ?? Infinity);
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

test("A tap on the map that closes a popover only closes it; the next tap places", async ({ page }) => {
  await page.goto("/route");
  await expectMapCanvas(page);
  const start = page.getByRole("combobox", { name: "Start" });
  // North Platte, NE: the EXAMPLE shop there, where a tap sets Start.
  const shop = await mapPoint(page, [-100.77, 41.12]);
  await page.getByRole("button", { name: "Route actions" }).tap();
  await page.touchscreen.tap(shop.x, shop.y);
  await expect(page.locator(".menu-card")).toBeHidden();
  await page.waitForTimeout(500);
  await expect(start).toHaveValue("");
  await page.touchscreen.tap(shop.x, shop.y);
  await expect(start).toHaveValue("North Platte, NE");
});

test("A place chosen from the suggestions keeps the keyboard for the next empty row; the last one lowers the sheet", async ({ page }) => {
  await page.goto("/route");
  const [start, destination] = [page.getByRole("combobox", { name: "Start" }), page.getByRole("combobox", { name: "Destination" })];
  await start.tap();
  await start.fill("Taylor, TX");
  await page.getByRole("option", { name: /^Taylor, TX/ }).tap();
  await expect(destination).toBeFocused();
  await expect.poll(() => sheetTop(page)).toBeLessThan(0.1);
  await destination.fill("North Little Rock, AR");
  await page.getByRole("option", { name: /^North Little Rock, AR/ }).first().tap();
  await expect(destination).not.toBeFocused();
  await expect.poll(() => sheetTop(page)).toBeCloseTo(0.58, 1);
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

/** The lower 48 states' corners (Washington, Maine, Florida, California): on screen, above the sheet. */
async function expectNetworkAboveSheet(page: Page): Promise<void> {
  const size = page.viewportSize() ?? { width: 0, height: 0 };
  await expect
    .poll(async () => {
      const top = (await sheetTop(page)) * size.height;
      // The map may begin above the screen, under the browser's top bar.
      const above = (await mapRegion(page).boundingBox())?.y ?? 0;
      const corners = await Promise.all(([[-124, 48], [-67, 45], [-81, 25], [-117, 32.5]] as [number, number][]).map((corner) => mapPoint(page, corner)));
      return corners.every(({ x, y }) => x > 0 && x < size.width && y + above > 0 && y + above < top);
    })
    .toBe(true);
}

test("The map opens on the whole network above the sheet, on a tall screen too", async ({ page }) => {
  await page.goto("/route");
  await expectMapCanvas(page);
  await expectNetworkAboveSheet(page);

  // A phone's whole screen, as a home-screen app has it.
  await page.setViewportSize({ width: 393, height: 852 });
  await page.reload();
  await expectMapCanvas(page);
  await expectNetworkAboveSheet(page);
});

test("The sheet stays between full and its head: pulled past either, it still covers the screen's foot and its top is on screen", async ({ page }) => {
  await page.goto("/route");
  await expectMapCanvas(page);
  const edges = () =>
    page.locator(".panel").evaluate((panel) => {
      const { top, bottom } = panel.getBoundingClientRect();
      return { top, gap: window.innerHeight - bottom };
    });
  const grabber = await page.locator(".sheet-grabber").boundingBox();
  if (!grabber) throw new Error("The sheet has no grabber.");
  const x = grabber.x + grabber.width / 2;
  await page.mouse.move(x, grabber.y + grabber.height / 2);
  await page.mouse.down();
  // Held at the screen's top edge, far above where it rests full.
  await page.mouse.move(x, 0, { steps: 12 });
  const held = await edges();
  expect(held.top).toBeGreaterThanOrEqual(0);
  expect(held.gap).toBeLessThanOrEqual(0);
  await page.mouse.up();
  await expect(page.getByRole("button", { name: "Lower the panel" })).toBeVisible();
  expect((await edges()).gap).toBeLessThanOrEqual(0);
});

test("Under Safari's bars: the map runs on above and below the frame, the page rests scrolled by that much, and the frame, the map buttons and the network stay on screen", async ({ page }) => {
  // What iOS Safari gives the page: 120 px of screen under its bars.
  await page.addInitScript(() => {
    const style = document.createElement("style");
    style.textContent = ".app { --bleed: 120px !important; }";
    document.addEventListener("DOMContentLoaded", () => document.head.append(style));
  });
  await page.goto("/route");
  await expectMapCanvas(page);
  const size = page.viewportSize() ?? { width: 0, height: 0 };
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(120);
  await expect.poll(async () => (await page.locator(".app").boundingBox())?.y).toBe(0);
  expect(await mapRegion(page).boundingBox()).toMatchObject({ y: -120, height: size.height + 240 });
  await expect(page.getByRole("button", { name: /^Map layers/ })).toBeInViewport({ ratio: 1 });
  await expectNetworkAboveSheet(page);
  // A row brought into view scrolls the sheet's body only: the page goes back to its rest.
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(120);
});

test("The map buttons ride on the sheet's top while it is dragged, not only once it rests", async ({ page }) => {
  await page.goto("/route");
  await expectMapCanvas(page);
  const gap = async () => {
    const stack = await page.locator(".map-controls").boundingBox();
    const sheet = await page.locator(".panel").boundingBox();
    return (sheet?.y ?? 0) - ((stack?.y ?? 0) + (stack?.height ?? 0));
  };
  const atRest = await gap();
  const grabber = await page.locator(".sheet-grabber").boundingBox();
  if (!grabber) throw new Error("The sheet has no grabber.");
  const x = grabber.x + grabber.width / 2;
  await page.mouse.move(x, grabber.y + grabber.height / 2);
  await page.mouse.down();
  for (const dy of [60, 140, 90]) {
    await page.mouse.move(x, grabber.y + dy, { steps: 4 });
    expect(await gap()).toBeCloseTo(atRest, 0);
  }
  await page.mouse.up();
});
