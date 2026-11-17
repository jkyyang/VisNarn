/**
 * What every browser test shares: a page that fails the test on an uncaught error or a server
 * error, the map checks, a click at a place on the real map, and the screenshots we keep.
 */
import { expect, test as base, type Locator, type Page } from "@playwright/test";
import { saveShot } from "./shots.ts";

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

export interface Camera {
  lon: number;
  lat: number;
  zoom: number;
}

/** Web Mercator in MapLibre's units: one zoom level doubles a 512 px world. */
function worldPx(lon: number, lat: number, zoom: number): [number, number] {
  const size = 512 * 2 ** zoom;
  const y = (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;
  return [((lon + 180) / 360) * size, y * size];
}

/**
 * Clicks the map where a place is, given where the camera is. The page keeps the map instance to
 * itself, so the camera is the one the screen asked for (a junction at zoom 14, say) and the test
 * works out the pixel the way MapLibre does.
 */
export async function clickMapAt(page: Page, place: { lon: number; lat: number }, camera: Camera): Promise<void> {
  const box = await mapRegion(page).locator("canvas.maplibregl-canvas").boundingBox();
  if (!box) throw new Error("The map canvas is not on the page.");
  const [cx, cy] = worldPx(camera.lon, camera.lat, camera.zoom);
  const [px, py] = worldPx(place.lon, place.lat, camera.zoom);
  const x = box.x + box.width / 2 + (px - cx);
  const y = box.y + box.height / 2 + (py - cy);
  if (x < box.x || x > box.x + box.width || y < box.y || y > box.y + box.height) throw new Error(`(${place.lon}, ${place.lat}) is outside the map at zoom ${camera.zoom}.`);
  await page.mouse.click(x, y);
}

/**
 * A full-page screenshot in docs/screenshots/<name>.png, after the map has had its chance to load
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
  await saveShot(page, name);
  if (grow) await page.setViewportSize(size);
}
