/**
 * Fix route in a real browser: the stop is added by clicking the real map, the server routes again,
 * and the page shows what changed. The EXAMPLE car 104233 turns back in Temple yard; a stop on the
 * BNSF main north of the yard makes the router run through Temple instead.
 */
import type { Response } from "@playwright/test";
import type { CarCheck, CheckedCar } from "../../shared/cars.ts";
import type { TurnBack } from "../../shared/route.ts";
import { clickMapAt, expectMapCanvases, keepScreenshot, test, expect } from "./app.ts";

/** FRA node 357962, the BNSF main about 2 km north of the Temple yard turn-back (a fact of public/data/graph.bin). */
const STOP = { fraId: 357962, lon: -97.3459, lat: 31.11266 };

/** Fix route opened on a turn-back flies to it at this zoom (web/screens/route/RouteWorkspace.tsx). */
const JUNCTION_ZOOM = 14;

/** Collects what the server answered to the page's checks, to learn where the turn-back is. */
function watchChecks(page: import("@playwright/test").Page): CheckedCar[] {
  const seen: CheckedCar[] = [];
  page.on("response", async (response: Response) => {
    if (!response.url().endsWith("/api/check") || !response.ok()) return;
    const check = (await response.json().catch(() => null)) as CarCheck | null;
    if (check?.outcome === "checked") seen.push(check);
  });
  return seen;
}

async function turnBackShown(seen: CheckedCar[]): Promise<TurnBack> {
  await expect.poll(() => seen.some((check) => check.options[0].turnBacks.length > 0)).toBe(true);
  return seen.find((check) => check.options[0].turnBacks.length > 0)!.options[0].turnBacks[0];
}

test.describe("Fix route", () => {
  test("a stop added by clicking the map takes the turn-back out; the change shows, and Undo puts the old route back", async ({ page, request }) => {
    const node = await (await request.get(`/api/places/nearest?lon=${STOP.lon}&lat=${STOP.lat}&withinKm=0.05`)).json();
    expect(node).toMatchObject({ fraId: STOP.fraId, railroads: ["BNSF"] });

    const seen = watchChecks(page);
    await page.goto("/route");
    const steps = page.getByRole("region", { name: "Steps" });
    await steps.locator(".step-text").filter({ hasText: "Turns back at Temple, TX" }).getByRole("link", { name: "Fix route" }).click();
    await expect(page).toHaveURL(/\/route\/fix\?at=0$/);

    await expect(page.getByRole("heading", { name: "Fix route", level: 1 })).toBeVisible();
    await expect(page.getByText("EXAMPLE 104233 · Temple, TX → North Little Rock, AR")).toBeVisible();
    await expect(page.getByRole("region", { name: "The step with the problem" })).toContainText("Turns back at Temple, TX (yard track): check");
    await expect(page.getByRole("region", { name: "Junction inspector" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Map layers: .*tracks/ })).toBeVisible();
    await expectMapCanvases(page);
    const changed = page.getByRole("region", { name: "What changed" });
    await expect(changed).toContainText("Add a stop where the route should pass");
    const turnBack = await turnBackShown(seen);

    await page.getByRole("button", { name: "Add a stop" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Esc to cancel" })).toContainText("Click the map to add a stop");
    // One step out, so the stop 2 km away is on screen with the junction still in the middle.
    await page.getByRole("button", { name: "Zoom out" }).click();
    await page.waitForTimeout(300);
    await clickMapAt(page, STOP, { lon: turnBack.at.lon, lat: turnBack.at.lat, zoom: JUNCTION_ZOOM - 1 });

    const balloon = page.getByRole("status").filter({ hasText: "Grey dashed line = the old route" });
    await expect(balloon).toContainText("−218 km · 1 more interchange · now: On time (rough)");
    await expect(page.getByRole("region", { name: "Stops" })).toContainText("Temple, TX");
    const row = (name: string) => changed.getByRole("row").filter({ has: page.getByRole("rowheader", { name }) });
    await expect(row("Route length")).toContainText("1,046 km");
    await expect(row("Route length")).toContainText("828 km");
    await expect(row("Turn-backs")).toContainText(/1\s*0/);
    await expect(row("Status")).toContainText("Check route");
    await expect(row("Status")).toContainText("On time");
    await keepScreenshot(page, "fix-route");

    await balloon.getByRole("button", { name: "Undo" }).click();
    await expect(balloon).toBeHidden();
    await expect(changed).toContainText("Add a stop where the route should pass");
    await expect(page.getByRole("button", { name: "Undo route change" })).toBeDisabled();

    await page.getByRole("button", { name: "Redo route change" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Grey dashed line = the old route" })).toContainText("−218 km");
  });

  test("'Use for this batch row' saves the stop on the server: the morning list says Route set by you, also after a reload", async ({ page, request }) => {
    const batches = (await (await request.get("/api/batches")).json()) as { id: string; source: { label: string } }[];
    const example = batches.find((batch) => /^EXAMPLE cars-[a-z]{3}\d+\.csv$/.test(batch.source.label));
    expect(example, "the EXAMPLE batch the server creates on first start").toBeDefined();

    const seen = watchChecks(page);
    await page.goto(`/cars/${example!.id}`);
    const car = page.getByRole("link", { name: /EXAMPLE 104233/ });
    await car.click();
    await expect(car).toHaveAttribute("aria-current", "true");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/route/${example!.id}/\\d+$`));
    await page.getByRole("region", { name: "Steps" }).getByRole("link", { name: "Fix route" }).click();
    await expect(page).toHaveURL(/\/fix\?at=0$/);
    const turnBack = await turnBackShown(seen);
    await expect(page.getByRole("button", { name: "Saved for this batch row" })).toBeDisabled();

    await page.getByRole("button", { name: "Add a stop" }).click();
    await page.getByRole("button", { name: "Zoom out" }).click();
    await page.waitForTimeout(300);
    await clickMapAt(page, STOP, { lon: turnBack.at.lon, lat: turnBack.at.lat, zoom: JUNCTION_ZOOM - 1 });
    await expect(page.getByRole("status").filter({ hasText: "Grey dashed line = the old route" })).toContainText("−218 km");

    await page.getByRole("button", { name: "Use for this batch row" }).click();
    await expect(page.getByRole("button", { name: "Saved for this batch row" })).toBeDisabled();
    await expect(page.getByRole("region", { name: "Stops" })).toContainText("Route set by you");

    // With the turn-back gone and time to spare, the car leaves "Check first" for the folded OK pile.
    const openOk = async () => {
      await expect(page.getByRole("region", { name: "Check first" })).not.toContainText("EXAMPLE 104233");
      await page.getByRole("region", { name: "OK" }).getByRole("button", { name: /^OK · \d/ }).click();
    };
    await page.goto(`/cars/${example!.id}`);
    await openOk();
    await expect(page.getByRole("link", { name: /EXAMPLE 104233/ })).toContainText("Route set by you");
    await page.reload();
    await openOk();
    const fixed = page.getByRole("link", { name: /EXAMPLE 104233/ });
    await expect(fixed).toContainText("Route set by you");
    await expect(fixed).not.toContainText("Turns back");

    // Back to the router's own route, so the EXAMPLE batch is as the server made it.
    await fixed.click();
    await page.keyboard.press("f");
    await expect(page).toHaveURL(/\/fix$/);
    await page.getByRole("button", { name: /^Remove stop 1/ }).click();
    await page.getByRole("button", { name: "Use for this batch row" }).click();
    await expect(page.getByRole("button", { name: "Saved for this batch row" })).toBeDisabled();
    await page.goto(`/cars/${example!.id}`);
    const back = page.getByRole("region", { name: "Check first" }).getByRole("link", { name: /EXAMPLE 104233/ });
    await expect(back).toContainText("Turns back at Temple, TX");
    await expect(back).not.toContainText("Route set by you");
  });
});
