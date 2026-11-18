/**
 * Real tracks in a real browser: ticked, the routes are drawn along the surveyed track and, zoomed in,
 * the OpenStreetMap lines replace the network layers; unticked, both are node to node again.
 */
import type { Page } from "@playwright/test";
import type { LngLat } from "../../shared/geo.ts";
import { haversineKm } from "../../shared/geo.ts";
import { expect, expectMapCanvases, planRoute, test } from "./app.ts";

const lengthKm = (path: LngLat[]) => path.slice(1).reduce((km, [lon, lat], i) => km + haversineKm(path[i][0], path[i][1], lon, lat), 0);

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
  const planned = await planRoute(page, "Taylor, TX", "North Little Rock, AR");
  if (planned.outcome !== "routed") throw new Error(`not routed: ${planned.outcome}`);
  const network = page.locator(".map-canvas");
  await expect(network).toHaveAttribute("data-network", "shown");

  const asked = page.waitForResponse((r) => r.url().endsWith("/api/track") && r.ok());
  await setRealTracks(page, true);
  const answer = await asked;
  const nodes = (answer.request().postDataJSON() as { paths: LngLat[][] }).paths;
  const drawn = (await answer.json()) as LngLat[][];

  // Every leg of every route, each from the same node to the same node, with the track's curves in between.
  expect(nodes.length).toBe(planned.routes.reduce((n, route) => n + route.legs.length, 0));
  expect(drawn.length).toBe(nodes.length);
  drawn.forEach((line, i) => {
    expect(line[0]).toEqual(nodes[i][0]);
    expect(line.at(-1)).toEqual(nodes[i].at(-1));
  });
  const count = (paths: LngLat[][]) => paths.reduce((n, path) => n + path.length, 0);
  expect(count(drawn)).toBeGreaterThan(3 * count(nodes));
  // Along the track, the routes are as long as the track km they were routed on; node to node they cut the curves.
  const km = planned.routes.reduce((sum, route) => sum + route.km, 0);
  const drawnKm = drawn.reduce((sum, line) => sum + lengthKm(line), 0);
  expect(Math.abs(drawnKm - km) / km).toBeLessThan(0.005);
  expect(nodes.reduce((sum, path) => sum + lengthKm(path), 0)).toBeLessThan(0.98 * km);

  // Zoomed out, OpenStreetMap has few rail lines, so the network stays; zoomed in, the real lines replace it.
  await expect(network).toHaveAttribute("data-network", "shown");
  for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "Zoom in" }).click();
  await expect(network).toHaveAttribute("data-network", "hidden");

  await setRealTracks(page, false);
  await expect(network).toHaveAttribute("data-network", "shown");
});
