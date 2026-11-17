/**
 * The Route screen (Main) in a real browser against the real server: the EXAMPLE car 104233,
 * reported between Taylor, TX (A) and Temple, TX (B), going to the EXAMPLE shop at North Little Rock.
 * Its shortest-looking route turns back in Temple yard, which is what the screen must not hide.
 */
import { expectMapCanvases, keepScreenshot, mapRegion, test, expect } from "./app.ts";

test.describe("Route screen", () => {
  test("EXAMPLE 104233: a verdict that asks to check the route, three routes, the steps with the turn-back, and the map", async ({ page }) => {
    await page.goto("/route");

    const form = page.getByRole("form", { name: "Car position and shop" });
    await expect(form.getByRole("textbox", { name: "Car" })).toHaveValue("EXAMPLE 104233");
    await expect(form).toContainText("Found on the network · served by BNSF and UP");

    const verdict = page.getByRole("region", { name: "Verdict" });
    await expect(verdict.getByRole("heading")).toHaveText("Check the route before using this result");
    await expect(verdict).toContainText("Check route");
    // A route that turns back is never "On time", whatever the hour the test runs at.
    await expect(verdict).not.toContainText("On time");
    await expect(verdict).toContainText("Rough estimate");
    await expect(verdict).toContainText("If the car is at B now");
    await expect(verdict).toContainText("If the car just passed A");
    await expect(verdict).toContainText("400 km/day placeholder");
    // Rough times only, while the speed is a placeholder: a day and a part of the day, no clock time.
    await expect(verdict).toContainText(/about (Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d+ (early|morning|afternoon|evening|night)/);

    const routes = page.getByRole("region", { name: "Routes" });
    await expect(routes.getByRole("heading", { name: "3 routes" })).toBeVisible();
    const pick = routes.getByRole("button", { name: /Router.s pick/ });
    await expect(pick).toHaveAttribute("aria-pressed", "true");
    await expect(pick).toContainText("1,046 km · no interchanges");
    await expect(routes.getByRole("note").first()).toContainText("This route turns back at Temple, TX (yard track). Check it before trusting the time.");
    const shortest = routes.getByRole("button", { name: /Shortest/ });
    await expect(shortest).toContainText("758 km · 1 interchange");
    // It turns back too, so its pill is never "On time". Which warning shows (Tight or Check route)
    // depends on the hour the test runs, because the EXAMPLE times are relative to now.
    await expect(shortest).toContainText(/Tight|Check route/);
    await expect(shortest).not.toContainText("On time");
    const noTurnBacks = routes.getByRole("button", { name: /No turn-backs/ });
    await expect(noTurnBacks).toContainText("828 km · 1 interchange (BNSF → UP)");
    await expect(noTurnBacks).toContainText("On time");

    const steps = page.getByRole("region", { name: "Steps" });
    await expect(steps.getByRole("heading", { level: 3 })).toHaveText(/^Steps · BNSF/);
    for (const text of ["Taylor, TX", "A · last passed", "Car is somewhere here · 63 km", "Temple, TX", "B · next node", "BNSF toward North Little Rock (heading NE)", "North Little Rock, AR", "Route 1,046 km vs straight line 625 km (1.7×)"]) {
      await expect(steps).toContainText(text);
    }
    const turnBack = steps.locator(".step-text").filter({ hasText: "Turns back at Temple, TX (yard track): check" });
    await expect(turnBack).toContainText("Arrives on Galveston Sub heading NW, leaves heading SE");
    await expect(turnBack.getByRole("button", { name: "Show on map" })).toBeVisible();
    await expect(turnBack.getByRole("link", { name: "Fix route" })).toHaveAttribute("href", "/route/fix?at=0");
    await expect(steps).toContainText("Yard turn-back time: not counted");

    await expectMapCanvases(page);
    await expect(mapRegion(page)).toContainText("Planned route from the report · not live tracking");
    await keepScreenshot(page, "route");
  });

  test("choosing another route shows its steps, keeps the choice in the link, and survives a reload", async ({ page }) => {
    await page.goto("/route");
    const routes = page.getByRole("region", { name: "Routes" });
    const pick = routes.getByRole("button", { name: /Router.s pick/ });
    await expect(pick).toHaveAttribute("aria-pressed", "true");

    await routes.getByRole("button", { name: /No turn-backs/ }).click();
    await expect(page).toHaveURL(/\/route\?option=no-turn-backs$/);
    const noTurnBacks = routes.getByRole("button", { name: /No turn-backs/ });
    await expect(noTurnBacks).toHaveAttribute("aria-pressed", "true");
    await expect(pick).toHaveAttribute("aria-pressed", "false");

    const steps = page.getByRole("region", { name: "Steps" });
    await expect(steps.getByRole("heading", { level: 3 })).toHaveText(/^Steps · UP via Fort Worth/);
    await expect(steps).not.toContainText("Turns back");
    await expect(steps).toContainText(/BNSF → UP|Change to UP|interchange/i);
    await expect(page.getByRole("region", { name: "Verdict" })).toContainText("On time");

    await page.reload();
    await expect(page.getByRole("region", { name: "Routes" }).getByRole("button", { name: /No turn-backs/ })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("region", { name: "Steps" }).getByRole("heading", { level: 3 })).toHaveText(/^Steps · UP via Fort Worth/);

    await page.getByRole("region", { name: "Routes" }).getByRole("button", { name: /Shortest/ }).click();
    await expect(page).toHaveURL(/\/route\?option=shortest$/);
    await expect(page.getByRole("region", { name: "Verdict" }).getByRole("heading")).toHaveText("Check the route before using this result");
  });
});
