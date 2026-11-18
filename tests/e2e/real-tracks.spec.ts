/**
 * Real tracks in a real browser: ticked, the routes are drawn along the surveyed track and, zoomed in,
 * the OpenStreetMap lines replace the network layers; unticked, both are node to node again.
 */
import type { Page } from "@playwright/test";
import { expect, expectMapCanvases, planRoute, test } from "./app.ts";

async function setRealTracks(page: Page, on: boolean): Promise<void> {
  const layers = page.getByRole("button", { name: /^Map layers/ });
  await layers.click();
  const box = page.getByRole("checkbox", { name: "Real tracks" });
  if ((await box.getAttribute("aria-checked")) !== String(on)) await box.click();
  await expect(box).toHaveAttribute("aria-checked", String(on));
  await layers.click();
}

test("Real tracks draws the routes on the surveyed track and, zoomed in, shows the real lines instead of the network", async ({ page }) => {
  await page.goto("/route");
  await expectMapCanvases(page);
  await planRoute(page, "Taylor, TX", "North Little Rock, AR");
  const network = page.locator(".map-canvas");
  await expect(network).toHaveAttribute("data-network", "shown");

  // The routes are drawn along the surveyed track (tests/api.test.ts checks the shapes and the km).
  const asked = page.waitForResponse((r) => r.url().endsWith("/api/track") && r.ok());
  await setRealTracks(page, true);
  await asked;

  // Zoomed out, OpenStreetMap has few rail lines, so the network stays; zoomed in, the real lines replace it.
  await expect(network).toHaveAttribute("data-network", "shown");
  for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "Zoom in" }).click();
  await expect(network).toHaveAttribute("data-network", "hidden");

  await setRealTracks(page, false);
  await expect(network).toHaveAttribute("data-network", "shown");
});
