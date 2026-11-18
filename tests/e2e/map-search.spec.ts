/**
 * The search box on the map: find a place by name, the map flies there and pins it, and the pin's card
 * hands the place to the planner. Only our own server is asked.
 */
import type { Page } from "@playwright/test";
import { expect, expectMapCanvases, expectNoSideScroll, freeMapCentre, keepScreenshot, mapRegion, PHONE, test } from "./app.ts";

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

test("Search Kansas City: the map centres on it, and Start makes it the planner's start", async ({ page }) => {
  const requests: URL[] = [];
  page.on("request", (request) => requests.push(new URL(request.url())));

  const card = await findCity(page, "Kansas City");
  await expect(card).toContainText("Kansas City, MO");
  await expect(card).toContainText("City");

  // The pin is in the middle of the map beside the panel: the camera went there (reduced motion: no flight).
  const centre = await freeMapCentre(page);
  const pin = await mapRegion(page).locator(".found-dot").boundingBox();
  if (!pin) throw new Error("The pin is not on the page.");
  expect(Math.abs(pin.x + pin.width / 2 - centre.x)).toBeLessThan(3);
  expect(Math.abs(pin.y + pin.height / 2 - centre.y)).toBeLessThan(3);
  await keepScreenshot(page, "map-search");

  await card.getByRole("button", { name: "Start" }).click();
  await expect(page.getByRole("combobox", { name: "Start" })).toHaveValue("Kansas City, MO");
  // The click on the card placed nothing else on the map.
  await expect(page.getByRole("combobox", { name: "Destination" })).toHaveValue("");
  await expect(card).toBeHidden();

  // What was typed went to our own server and nowhere else (map tiles go out, but carry no text).
  expect(requests.some((url) => url.pathname === "/api/places/suggest")).toBe(true);
  expect(requests.filter((url) => url.hostname !== "127.0.0.1" && /kansas/i.test(decodeURIComponent(url.href)))).toEqual([]);
});

test.describe("on a phone", () => {
  test.use(PHONE);

  test("the box runs across the top of the map, clear of the layers button and the legend", async ({ page }) => {
    const card = await findCity(page, "Kansas City");
    // The found card takes the legend's room on a phone: the legend is back once the card is closed.
    await card.getByRole("button", { name: "Close" }).click();
    const search = await page.locator(".map-search").boundingBox();
    const map = await mapRegion(page).boundingBox();
    const layers = await page.getByRole("button", { name: /^Map layers/ }).boundingBox();
    const legend = await page.getByRole("list", { name: "Railroad colors" }).boundingBox();
    if (!search || !map || !layers || !legend) throw new Error("Something is not on the page.");
    expect(search.width).toBeGreaterThan(map.width * 0.7);
    expect(search.x + search.width).toBeLessThanOrEqual(layers.x);
    expect(search.y + search.height).toBeLessThanOrEqual(legend.y);
    await expectNoSideScroll(page);
    await keepScreenshot(page, "map-search-phone");
  });
});
