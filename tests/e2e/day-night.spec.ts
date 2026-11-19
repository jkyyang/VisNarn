/**
 * The day/night map in a real browser. Auto draws the Earth as seen from space: the night side is
 * NASA's Black Marble with its city lights, fading softly into day where the sun is setting or
 * rising, with no line drawn. The Time of day switch forces night (dark streets, city lights) or day,
 * and the route stays drawn on top throughout.
 */
import type { Page } from "@playwright/test";
import { expectMapCanvas, keepScreenshot, mapLayerOrder, mapRegion, planRoute, test, expect } from "./app.ts";

/** NASA's tiles are downloaded once and kept by the page, so the first download is the one to wait for. */
const nasaTiles = (page: Page) =>
  page.waitForResponse((response) => response.url().includes("gibs.earthdata.nasa.gov"), { timeout: 15_000 }).catch(() => null);

/** The "i" opens the map's credits beside it, which name `source`; Escape closes them again. */
async function expectCredits(page: Page, source: string): Promise<void> {
  const credits = page.getByRole("button", { name: "Map credits" });
  await credits.click();
  await expect(credits).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(".credits-card")).toBeVisible();
  await expect(page.locator(".credits-card")).toContainText(source);
  await page.keyboard.press("Escape");
  await expect(page.locator(".credits-card")).toBeHidden();
}

test("Night turns the map dark with city lights, the route stays on top, and Day brings the day map back", async ({ page }) => {
  const lights = nasaTiles(page);
  await page.goto("/route");
  await planRoute(page, "Taylor, TX", "North Little Rock, AR");
  const selectedRow = page.getByRole("region", { name: "Route", exact: true });
  await expect(selectedRow).toBeVisible();
  await expectMapCanvas(page);
  const map = mapRegion(page);

  const layers = page.getByRole("button", { name: /^Map layers/ });
  await layers.click();
  await expect(page.getByRole("radio", { name: "Auto" })).toHaveAttribute("aria-checked", "true");
  // The edge of night comes from the picture itself: there is no line to switch on.
  await expect(page.getByText("Day-night line")).toHaveCount(0);

  await page.getByRole("radio", { name: "Night" }).click();
  await expect(map).toHaveAttribute("data-look", "night");
  await expect(layers).toHaveAccessibleName("Map layers: Map · Night");
  await layers.click();
  await expectCredits(page, "NASA");

  await expectMapCanvas(page);
  await expect(selectedRow).toBeVisible();
  await lights;
  await keepScreenshot(page, "night");

  await layers.click();
  await page.getByRole("radio", { name: "Day" }).click();
  await expect(map).toHaveAttribute("data-look", "day");
  await expect(layers).toHaveAccessibleName("Map layers: Map · Day");
  await layers.click();
  await expectMapCanvas(page);
  await keepScreenshot(page, "day");
});

test("Auto at dusk over North America: the satellite picture by day, city lights by night, a soft edge between", async ({ page }) => {
  // Half an hour after sunset in Kansas: day on the West Coast, night in the East.
  await page.clock.setFixedTime("2026-11-17T23:45:00Z");
  const lights = nasaTiles(page);
  await page.goto("/route");
  await planRoute(page, "Taylor, TX", "North Little Rock, AR");
  const selectedRow = page.getByRole("region", { name: "Route", exact: true });
  await expect(selectedRow).toBeVisible();
  await expectMapCanvas(page);
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
  await expectCredits(page, "NASA");
  await expect(selectedRow).toBeVisible();
  await lights;
  await expectMapCanvas(page);
  await keepScreenshot(page, "earth-dusk");
});

test("every switch of map and time keeps the night tiles under the network, the network under the place names, and MapLibre quiet", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    // A tile the network failed to fetch is the network's business; anything else MapLibre logs is ours.
    if (message.type() === "error" && !/Failed to load resource|net::ERR_/.test(message.text())) errors.push(message.text());
  });
  await page.goto("/route");
  await planRoute(page, "Taylor, TX", "North Little Rock, AR");
  await expectMapCanvas(page);
  const map = mapRegion(page);
  const layers = page.getByRole("button", { name: /^Map layers/ });
  const choose = async (name: string) => {
    await layers.click();
    await page.getByRole("radio", { name, exact: true }).click();
    await layers.click();
  };
  const expectInOrder = async (look: string) => {
    await expect
      .poll(async () => {
        const order = await mapLayerOrder(page);
        const network = order.filter((id) => id.startsWith("network-")).map((id) => order.indexOf(id));
        return network.length > 0 && order.indexOf("night-lights") < Math.min(...network) && Math.max(...network) < order.indexOf("labels");
      }, look)
      .toBe(true);
  };

  for (const [name, look] of [["Satellite", "satellite"], ["Map", "map"], ["Night", "night"], ["Auto", "auto"], ["Day", "day"], ["Night", "night again"]] as const) {
    await choose(name);
    await expectInOrder(look);
  }
  await choose("Satellite");
  await expect(map).toHaveAttribute("data-look", "night");
  await expectInOrder("satellite at night");
  await choose("Map");
  await expectInOrder("map at night");
  expect(errors).toEqual([]);
});
