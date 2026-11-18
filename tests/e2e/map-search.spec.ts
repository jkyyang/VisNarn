/**
 * The search box on the map: find a place by name, the map flies there and pins it, and the pin's card
 * hands the place to the planner. Only our own server is asked.
 */
import type { Page } from "@playwright/test";
import { expectMapCanvases, keepScreenshot, mapRegion, test, expect } from "./app.ts";

/** Types into the search box and picks the city of that name (Your shops may list a shop with it too). */
async function findCity(page: Page, name: string) {
  await page.goto("/route");
  await expectMapCanvases(page);
  const box = page.getByRole("combobox", { name: "Search the map" });
  await box.fill(name);
  const city = page.getByRole("option", { name: new RegExp(`^${name}, \\w\\w\\s*City`) });
  await expect(city).toContainText("BNSF");
  await city.click();
  return page.getByRole("region", { name: /^Found: / });
}

test("Search Kansas City: the map centres on it, and Set as start makes it the planner's start", async ({ page }) => {
  const requests: URL[] = [];
  page.on("request", (request) => requests.push(new URL(request.url())));

  const card = await findCity(page, "Kansas City");
  await expect(card).toContainText("Kansas City, MO");
  await expect(card).toContainText("City");

  // The pin is in the middle of the map: the camera went there (reduced motion: no flight).
  const canvas = await mapRegion(page).locator("canvas.maplibregl-canvas").boundingBox();
  const pin = await mapRegion(page).locator(".found-dot").boundingBox();
  if (!canvas || !pin) throw new Error("The map or the pin is not on the page.");
  expect(Math.abs(pin.x + pin.width / 2 - (canvas.x + canvas.width / 2))).toBeLessThan(3);
  expect(Math.abs(pin.y + pin.height / 2 - (canvas.y + canvas.height / 2))).toBeLessThan(3);
  await keepScreenshot(page, "map-search");

  await card.getByRole("button", { name: "Set as start" }).click();
  await expect(page.getByRole("combobox", { name: "Start" })).toHaveValue("Kansas City, MO");
  // The click on the card placed nothing else on the map.
  await expect(page.getByRole("combobox", { name: "Destination" })).toHaveValue("");
  await expect(card).toBeHidden();

  // What was typed went to our own server and nowhere else (map tiles go out, but carry no text).
  expect(requests.some((url) => url.pathname === "/api/places/suggest")).toBe(true);
  expect(requests.filter((url) => url.hostname !== "127.0.0.1" && /kansas/i.test(decodeURIComponent(url.href)))).toEqual([]);
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("the box runs across the top of the map, clear of the layers button and the legend", async ({ page }) => {
    await findCity(page, "Kansas City");
    const search = await page.locator(".map-search").boundingBox();
    const map = await mapRegion(page).boundingBox();
    const layers = await page.getByRole("button", { name: /^Map layers/ }).boundingBox();
    const legend = await page.getByRole("list", { name: "Railroad colors" }).boundingBox();
    if (!search || !map || !layers || !legend) throw new Error("Something is not on the page.");
    expect(search.width).toBeGreaterThan(map.width * 0.7);
    expect(search.x + search.width).toBeLessThanOrEqual(layers.x);
    expect(search.y + search.height).toBeLessThanOrEqual(legend.y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await keepScreenshot(page, "map-search-phone");
  });
});
