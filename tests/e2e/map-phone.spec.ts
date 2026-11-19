/**
 * The map on a 3x phone with touch: it draws 2 device pixels per CSS pixel (MAX_PIXEL_RATIO), two
 * fingers zoom it but never turn or tilt it, and a lost WebGL context starts it again on a new canvas.
 */
import { expect, expectMapCanvas, mapPoint, mapRegion, PHONE, test } from "./app.ts";

test.use({ ...PHONE, deviceScaleFactor: 3 });

test("Phone map: 2 device pixels per CSS pixel; a two-finger twist and spread zooms, north stays up", async ({ page }) => {
  await page.goto("/shops");
  await expectMapCanvas(page);
  const canvas = mapRegion(page).locator("canvas.maplibregl-canvas");
  const size = await canvas.evaluate((c: HTMLCanvasElement) => ({ width: c.width, css: c.clientWidth }));
  expect(size.width).toBe(size.css * 2);

  const box = await canvas.boundingBox();
  if (!box) throw new Error("The map canvas is not on the page.");
  const [cx, cy] = [box.x + box.width / 2, box.y + box.height / 2];
  const fingers = (turn: number, reach: number) => [
    { x: cx + reach * Math.cos(turn), y: cy + reach * Math.sin(turn), id: 1 },
    { x: cx - reach * Math.cos(turn), y: cy - reach * Math.sin(turn), id: 2 },
  ];
  const span = async () => (await mapPoint(page, [-90, 40])).x - (await mapPoint(page, [-100, 40])).x;
  const before = await span();
  const touch = await page.context().newCDPSession(page);
  await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: fingers(0, 50) });
  for (let step = 1; step <= 20; step++) await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: fingers(step * 0.04, 50 + step * 3) });
  await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });

  await expect.poll(span).toBeGreaterThan(before * 1.3);
  // North up: a meridian is still a vertical line on the screen.
  const [north, south] = [await mapPoint(page, [-95, 45]), await mapPoint(page, [-95, 35])];
  expect(Math.abs(north.x - south.x)).toBeLessThan(0.5);
});

test("Phone map: a lost WebGL context starts the map again on a new canvas", async ({ page }) => {
  await page.goto("/route");
  await expectMapCanvas(page);
  const canvas = mapRegion(page).locator("canvas.maplibregl-canvas");
  await canvas.evaluate((c: HTMLCanvasElement) => {
    c.dataset.lost = "";
    (c.getContext("webgl2") ?? c.getContext("webgl"))?.getExtension("WEBGL_lose_context")?.loseContext();
  });
  await expect(mapRegion(page).locator("canvas.maplibregl-canvas:not([data-lost])")).toHaveCount(1);
  await expectMapCanvas(page);
});
