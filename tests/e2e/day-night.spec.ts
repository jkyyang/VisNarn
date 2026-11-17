/**
 * The day/night map in a real browser: the Time of day switch in the layers card turns the map to
 * night (dark streets, NASA's city lights) while the route stays drawn on top, and back to day.
 */
import { expectMapCanvases, keepScreenshot, mapRegion, test, expect } from "./app.ts";

test("Night turns the map dark with city lights, the route stays on top, and Day brings the day map back", async ({ page }) => {
  await page.goto("/route");
  await expect(page.getByRole("region", { name: "Verdict" }).getByRole("heading")).toBeVisible();
  await expectMapCanvases(page);
  const map = mapRegion(page);

  const layers = page.getByRole("button", { name: /^Map layers/ });
  await layers.click();
  await expect(page.getByRole("radio", { name: "Auto" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText(/^Follows the clock\. Now: (Day|Sunrise|Sunset|Night)$/)).toBeVisible();

  const lights = page.waitForResponse((response) => response.url().includes("gibs.earthdata.nasa.gov"), { timeout: 15_000 }).catch(() => null);
  await page.getByRole("radio", { name: "Night" }).click();
  await expect(map).toHaveAttribute("data-look", "night");
  await expect(layers).toHaveAccessibleName("Map layers: Map · Night");
  await expect(map.locator(".maplibregl-ctrl-attrib")).toContainText("NASA");
  await layers.click();

  await expectMapCanvases(page);
  await expect(map).toContainText("Planned route from the report · not live tracking");
  await lights;
  await keepScreenshot(page, "night");

  await layers.click();
  await page.getByRole("radio", { name: "Day" }).click();
  await expect(map).toHaveAttribute("data-look", "day");
  await expect(layers).toHaveAccessibleName("Map layers: Map · Day");
  await layers.click();
  await expectMapCanvases(page);
  await keepScreenshot(page, "day");
});
