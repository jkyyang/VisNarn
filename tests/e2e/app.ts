/**
 * What every browser test shares: a page that fails the test on an uncaught error or a server
 * error, the map checks, a click on the real map, a phone window, and the screenshots we keep.
 */
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test as base, type Locator, type Page } from "@playwright/test";
import type { Plan, PlannedRoute } from "../../shared/plans.ts";

export { expect };

/**
 * A screen that threw, or an API answer of 500 or more, fails the test even when the assertions it
 * makes still pass: a person would see a broken screen. A 4xx is the server refusing bad input,
 * which some tests do on purpose.
 */
export const test = base.extend<{ problems: string[] }>({
  problems: [
    async ({ page }, use) => {
      const problems: string[] = [];
      page.on("pageerror", (error) => problems.push(`Uncaught in the page: ${error.message}`));
      page.on("response", (response) => {
        if (new URL(response.url()).pathname.startsWith("/api/") && response.status() >= 500) problems.push(`${response.status()} from ${response.url()}`);
      });
      await use(problems);
      expect(problems).toEqual([]);
    },
    { auto: true },
  ],
});

/** The app's map section. MapLibre also labels its own canvas "Map", so the name alone matches two. */
export const mapRegion = (page: Page): Locator => page.locator("section.map");

/** MapLibre's basemap canvas and, over it, the canvas deck.gl draws the routes and pins on. */
export async function expectMapCanvases(page: Page): Promise<void> {
  const map = mapRegion(page);
  await expect(map.locator("canvas.maplibregl-canvas")).toBeVisible();
  await expect.poll(async () => map.locator("canvas").count()).toBeGreaterThanOrEqual(2);
  for (const canvas of await map.locator("canvas").all()) {
    const box = await canvas.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(100);
    expect(box?.height ?? 0).toBeGreaterThan(100);
  }
}

/**
 * The middle of the map the panel leaves free, where the search box puts the place it found: beside
 * the panel on a desktop (the panel floats over the map's left side), the whole map on a phone.
 */
export async function freeMapCentre(page: Page): Promise<{ x: number; y: number }> {
  const map = await mapRegion(page).locator("canvas.maplibregl-canvas").boundingBox();
  const panel = await page.locator(".panel").boundingBox();
  if (!map || !panel) throw new Error("The map or the panel is not on the page.");
  const covered = panel.width < map.width ? panel.x + panel.width - map.x : 0;
  return { x: map.x + covered + (map.width - covered) / 2, y: map.y + map.height / 2 };
}

/** Clicks the middle of the free map. */
export async function clickMapCentre(page: Page): Promise<void> {
  const centre = await freeMapCentre(page);
  await page.mouse.click(centre.x, centre.y);
}

/** A phone: an iPhone 14's window, with touch. */
export const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };

/** Nothing on the page is wider than the window. */
export async function expectNoSideScroll(page: Page, why?: string): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth), why).toBeLessThanOrEqual(page.viewportSize()?.width ?? 0);
}

/** Types the start and the destination, each with Enter, and waits for the routes. */
export async function planRoute(page: Page, start: string, destination: string): Promise<PlannedRoute> {
  const answer = page.waitForResponse((r) => r.url().endsWith("/api/route") && r.request().method() === "POST" && (r.request().postDataJSON() as Plan).places.at(-1) !== null);
  await page.getByRole("combobox", { name: "Start" }).fill(start);
  await page.getByRole("combobox", { name: "Start" }).press("Enter");
  await page.getByRole("combobox", { name: "Destination" }).fill(destination);
  await page.getByRole("combobox", { name: "Destination" }).press("Enter");
  const planned = (await (await answer).json()) as PlannedRoute;
  await expect(page.getByRole("region", { name: "Routes" }).getByRole("button").first()).toBeVisible();
  return planned;
}

/** Outside Playwright's outputDir (test-results/e2e), which it empties on every run. */
const SHOTS_DIR = fileURLToPath(new URL("../../test-results/screenshots/", import.meta.url));

/**
 * A full-page screenshot in test-results/screenshots/<name>.png, after the map has had its chance to load
 * tiles. Tiles come from public servers; without a network the shot still saves, with a grey map.
 *
 * On a desktop the panel scrolls inside a page that does not, so a plain full-page shot would stop
 * at the fold: the window is made as tall as the longest scrolling part for the shot, then put back.
 */
export async function keepScreenshot(page: Page, name: string): Promise<void> {
  const size = page.viewportSize();
  const tallest = await page.evaluate(() => {
    let bottom = document.documentElement.scrollHeight;
    for (const el of document.querySelectorAll<HTMLElement>("body *")) {
      if (el.scrollHeight > el.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(el).overflowY)) {
        bottom = Math.max(bottom, el.getBoundingClientRect().top + window.scrollY + el.scrollHeight);
      }
    }
    return Math.ceil(bottom);
  });
  const grow = size !== null && tallest > size.height && size.width > 640;
  if (grow) await page.setViewportSize({ width: size.width, height: Math.min(tallest, 5000) });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(800);
  mkdirSync(SHOTS_DIR, { recursive: true });
  await page.screenshot({ path: `${SHOTS_DIR}${name}.png`, fullPage: true });
  if (grow) await page.setViewportSize(size);
}
