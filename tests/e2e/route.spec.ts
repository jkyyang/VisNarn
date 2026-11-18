/**
 * The route planner in a real browser against the real server: Taylor, TX to the EXAMPLE shop at
 * North Little Rock, a stop clicked at Temple, the routes told apart by their pills, saved and opened
 * again. Places only: no car and no clock.
 */
import type { Locator, Page } from "@playwright/test";
import type { PlannedRoute } from "../../shared/plans.ts";
import { RAILROADS } from "../../shared/railroads.ts";
import { clickMapAt, expect, expectMapCanvases, fittedCamera, keepScreenshot, mapRegion, planRoute, routeBounds, test } from "./app.ts";

/** FRA node 358070 at Temple, TX, where BNSF and UP meet. */
const TEMPLE = { lon: -97.33832, lat: 31.08799 };

const routeRows = (page: Page): Locator => page.getByRole("region", { name: "Routes" }).getByRole("button");
const stopRows = (page: Page): Locator => page.getByRole("list", { name: "Stops" }).getByRole("listitem");
const legend = (page: Page): Locator => page.getByRole("list", { name: "Railroad colors" }).getByRole("listitem");
const pressedRow = (page: Page): Locator => page.getByRole("region", { name: "Routes" }).locator('[aria-pressed="true"]');

/** The next routing answer the page gets. */
const nextRoute = (page: Page) =>
  page.waitForResponse((r) => r.url().endsWith("/api/route") && r.request().method() === "POST").then(async (r) => (await r.json()) as PlannedRoute);

/** Clicks Temple on the map, after "Fit whole route" has put the camera where the test can work it out. */
async function clickTemple(page: Page, planned: PlannedRoute): Promise<PlannedRoute> {
  await page.getByRole("button", { name: "Fit whole route" }).click();
  const answer = nextRoute(page);
  await clickMapAt(page, TEMPLE, await fittedCamera(page, routeBounds(planned)));
  return answer;
}

test.describe("Route planner", () => {
  test("empty at first; a typed start and destination give a route, and the legend lists only its railroads", async ({ page }) => {
    await page.goto("/route");
    await expect(page.getByRole("combobox", { name: "Start" })).toHaveValue("");
    await expect(page.getByRole("status").filter({ hasText: "Click the start on the map, or type it." })).toBeVisible();
    await expectMapCanvases(page);

    const planned = await planRoute(page, "Taylor, TX", "North Little Rock, AR");
    expect(planned.outcome).toBe("routed");
    await expect(routeRows(page)).toHaveCount(planned.outcome === "routed" ? planned.routes.length : 0);
    await expect(routeRows(page).first()).toHaveAttribute("aria-pressed", "true");
    const railroads = planned.outcome === "routed" ? planned.routes[0].railroads : [];
    await expect(legend(page)).toHaveText(RAILROADS.filter((railroad) => railroads.includes(railroad)));
    await expect(page.getByRole("list", { name: "Sections" })).toContainText("Taylor");
    await expect(page.getByRole("list", { name: "Sections" })).toContainText("North Little Rock");
    await expect(page.locator(".panel")).not.toContainText(/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b|\d{1,2}:\d{2}|prep|margin|on time|act now|check first|not live/i);
  });

  test("a click at Temple adds a stop; a pill selects its route and adds no stop; pills keep apart; Undo takes the stop back", async ({ page }) => {
    await page.goto("/route");
    const planned = await planRoute(page, "Taylor, TX", "North Little Rock, AR");
    const withStop = await clickTemple(page, planned);
    await expect(stopRows(page)).toHaveCount(1);
    await expect(stopRows(page).first()).toContainText("Temple");
    expect(withStop.outcome).toBe("routed");

    // Every visible pill is clear of the others and of the turn-back discs.
    const pills = page.locator(".route-pill");
    await expect.poll(async () => pills.count()).toBeGreaterThan(1);
    const boxes = (await Promise.all((await pills.all()).map((p) => p.boundingBox()))).filter((b) => b !== null);
    const discs = (await Promise.all((await page.locator(".turn-mark").all()).map((p) => p.boundingBox()))).filter((b) => b !== null);
    const overlap = (a: { x: number; y: number; width: number; height: number }, b: typeof a) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
    for (const [i, a] of boxes.entries()) {
      for (const b of boxes.slice(i + 1)) expect(overlap(a, b)).toBe(false);
      for (const d of discs) expect(overlap(a, d)).toBe(false);
    }
    await keepScreenshot(page, "route");

    // A pill click selects that route; it must not also reach the map and place a stop.
    const before = (await pressedRow(page).textContent()) ?? "";
    await page.locator(".route-pill:not(.is-selected)").first().click();
    await expect(page).toHaveURL(/\?option=[a-z-]+$/);
    await expect(pressedRow(page)).not.toHaveText(before);
    await page.waitForTimeout(500);
    await expect(stopRows(page)).toHaveCount(1);

    await page.getByRole("button", { name: "Undo route change" }).click();
    await expect(page.getByRole("list", { name: "Stops" })).toHaveCount(0);
  });

  test("a stop where railroads meet offers its lines; the chosen line is sent; a saved route reopens on the same alternative", async ({ page }) => {
    await page.goto("/route");
    const planned = await planRoute(page, "Taylor, TX", "North Little Rock, AR");
    await clickTemple(page, planned);
    const lines = page.getByRole("radiogroup", { name: "Next carrier at stop 1" });
    await expect(lines.getByRole("radio", { name: "Router's pick" })).toHaveAttribute("aria-checked", "true");
    const answered = page.waitForResponse((r) => r.url().endsWith("/api/route") && JSON.stringify(r.request().postDataJSON()).includes('"railroad":"UP"'));
    await lines.getByRole("radio", { name: "UP" }).click();
    await answered;
    await expect(page.locator(".route-panel.is-stale")).toHaveCount(0);
    await expect(lines.getByRole("radio", { name: "UP" })).toHaveAttribute("aria-checked", "true");

    // Pick the second route, save, and open the saved route again from its link.
    await routeRows(page).nth(1).click();
    await expect(page).toHaveURL(/\?option=/);
    const chosen = (await pressedRow(page).textContent()) ?? "";
    await page.getByRole("textbox", { name: "Route name" }).fill("EXAMPLE Taylor → North Little Rock via Temple");
    const save = page.getByRole("form", { name: "Save route" });
    await save.getByRole("button", { name: "Save" }).click();
    // This route changes railroad where no named place is near: saving asks first.
    await expect(save.getByRole("alert")).toContainText("Railroad change with no place name");
    await save.getByRole("button", { name: "Save anyway" }).click();
    await expect(page).toHaveURL(/\/route\/saved\/[0-9a-f-]+/);
    await expect(page.getByRole("button", { name: "Saved" })).toBeDisabled();
    const savedAt = new URL(page.url()).pathname;

    await page.goto(savedAt);
    await expect(pressedRow(page)).toHaveText(chosen);
    await expect(stopRows(page)).toHaveCount(1);
    await expect(page.getByRole("radio", { name: "UP" })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByRole("button", { name: "Saved" })).toBeDisabled();

    // Delete it again with the inline confirm, so the other tests start from no saved routes.
    await page.getByRole("button", { name: "New" }).click();
    await page.getByRole("button", { name: "Delete EXAMPLE Taylor → North Little Rock via Temple" }).click();
    await page.getByRole("group", { name: "Delete EXAMPLE Taylor → North Little Rock via Temple" }).getByRole("button", { name: "Delete" }).click();
    await expect(page.getByText(/^Saved routes/)).toHaveCount(0);
  });

  test("ticking Short lines reaches the Ville Platte shop, which only a short line serves; a saved route keeps the tick", async ({ page }) => {
    await page.goto("/route");
    const shortLines = page.getByRole("group", { name: "Track" }).getByRole("checkbox", { name: "Short lines" });
    await expect(shortLines).not.toBeChecked();
    // The map draws the network's short-line track only while the box is ticked.
    const network = page.locator(".map-canvas");
    await expect(network).toHaveAttribute("data-network-classes", "class_i passenger");
    const firstAnswer = page.waitForResponse((r) => r.url().endsWith("/api/route") && (r.request().postDataJSON() as { destination: unknown }).destination !== null);
    await page.getByRole("combobox", { name: "Start" }).fill("Baton Rouge, LA");
    await page.getByRole("combobox", { name: "Start" }).press("Enter");
    // 1373 Union Tank Car Road, Ville Platte, LA: the end of the short line, 20 km from UP.
    await page.getByRole("combobox", { name: "Destination" }).fill("-92.271, 30.688");
    await page.getByRole("combobox", { name: "Destination" }).press("Enter");
    expect((await (await firstAnswer).json()) as PlannedRoute).toMatchObject({ outcome: "no-route", problem: { at: "destination" } });
    await expect(routeRows(page)).toHaveCount(0);

    const ticked = nextRoute(page);
    await shortLines.check();
    expect((await ticked).outcome).toBe("routed");
    await expect(network).toHaveAttribute("data-network-classes", "class_i short_line passenger");
    await expect(routeRows(page).first()).toContainText("Short line");
    await expect(page.getByRole("list", { name: "Sections" })).toContainText("UP → Short line");
    await expect(legend(page)).toHaveText(["UP", "Short line"]);

    await page.getByRole("textbox", { name: "Route name" }).fill("EXAMPLE Baton Rouge → Ville Platte");
    const save = page.getByRole("form", { name: "Save route" });
    await save.getByRole("button", { name: "Save" }).click();
    // UP hands over to the short line where no named place is near: saving asks first, and only Save anyway saves.
    await expect(save.getByRole("alert")).toContainText("Railroad change with no place name");
    await expect(page).not.toHaveURL(/\/route\/saved\//);
    await save.getByRole("button", { name: "Save anyway" }).click();
    await expect(page).toHaveURL(/\/route\/saved\/[0-9a-f-]+/);
    await page.reload();
    await expect(shortLines).toBeChecked();
    await expect(routeRows(page).first()).toContainText("Short line");

    await page.getByRole("button", { name: "New" }).click();
    await page.getByRole("button", { name: "Delete EXAMPLE Baton Rouge → Ville Platte" }).click();
    await page.getByRole("group", { name: "Delete EXAMPLE Baton Rouge → Ville Platte" }).getByRole("button", { name: "Delete" }).click();
    await expect(page.getByText(/^Saved routes/)).toHaveCount(0);
  });

  test("a turn-back is an amber mark on the map; hovering it shows where and how the route turns", async ({ page, request }) => {
    // Taylor → Temple (the city) → North Little Rock: the router's own route turns back in Temple yard.
    const plan = { start: { kind: "text", text: "Taylor, TX" }, stops: [{ kind: "text", text: "Temple, TX" }], destination: { kind: "text", text: "North Little Rock, AR" } };
    const answer = (await (await request.post("/api/route", { data: plan })).json()) as PlannedRoute;
    test.skip(answer.outcome !== "routed" || !answer.routes[0].turnBacks.length, "This network build has no turn-back on that route; the jsdom test covers the mark.");
    const saved = (await (await request.post("/api/saved-routes", { data: { name: "EXAMPLE turn-back", plan, option: null, routeString: "" } })).json()) as { id: string };

    await page.goto(`/route/saved/${saved.id}`);
    await expect(routeRows(page).first()).toContainText("turn-back");
    const mark = mapRegion(page).getByRole("button", { name: /^Turn-back at / }).first();
    await expect(mark).toBeVisible();
    await mark.hover();
    await expect(page.getByRole("tooltip")).toContainText(/yard track/);
    await expect(page.getByRole("tooltip")).toContainText(/ (N|NE|E|SE|S|SW|W|NW) → /);
    await expect(legend(page).last()).toHaveText("↩Turn-back");
    await request.delete(`/api/saved-routes/${saved.id}`);
  });

  test("Kansas City → Chicago: the route string; the next carrier chosen at a junction is marked; saved and reopened the same; reversed", async ({ page }) => {
    await page.goto("/route");
    await planRoute(page, "Kansas City, MO", "Chicago, IL");
    const string = page.getByRole("region", { name: "Route string" });
    // Carriers and [our own place names] only: never a made-up junction code.
    const shape = /^(BNSF|UP|CSXT|NS|CN|CPKC|regional|short line)( – \[[^\]]+\] – (BNSF|UP|CSXT|NS|CN|CPKC|regional|short line))*$/;
    await expect(string.locator(".route-string-text")).toHaveText(shape);

    // FRA node 412783 in Chicago, where BNSF, UP, NS and CN meet: NS takes the car on there.
    await page.getByRole("combobox", { name: "Search the map" }).fill("FRA 412783");
    await page.getByRole("option", { name: /FRA node 412783/ }).click();
    await page.getByRole("button", { name: "Add as stop" }).click();
    const lines = page.getByRole("radiogroup", { name: "Next carrier at stop 1" });
    await expect(lines.getByRole("radio", { name: "Router's pick" })).toHaveAttribute("aria-checked", "true");
    const answered = page.waitForResponse((r) => r.url().endsWith("/api/route") && JSON.stringify(r.request().postDataJSON()).includes('"railroad":"NS"'));
    await lines.getByRole("radio", { name: "NS", exact: true }).click();
    await answered;
    await expect(page.locator(".route-panel.is-stale")).toHaveCount(0);
    await expect(string.locator(".route-string-text")).toHaveText(/ – NS$/);
    await expect(string.locator(".route-string-text")).toHaveText(shape);
    const sections = page.getByRole("list", { name: "Sections" });
    await expect(sections.locator(".section--interchange").filter({ hasText: "→ NS" })).toContainText("you chose");
    const planned = (await string.locator(".route-string-text").textContent()) ?? "";
    await keepScreenshot(page, "route-string");

    await page.getByRole("textbox", { name: "Route name" }).fill("EXAMPLE Kansas City → Chicago, NS at Chicago");
    await page.getByRole("form", { name: "Save route" }).getByRole("button", { name: "Save" }).click();
    await expect(page).toHaveURL(/\/route\/saved\/[0-9a-f-]+/);
    const savedAt = new URL(page.url()).pathname;
    await page.goto(savedAt);
    await expect(string.locator(".route-string-text")).toHaveText(planned);
    await expect(string).not.toContainText("Saved as");
    await expect(page.getByRole("button", { name: "Saved" })).toBeDisabled();

    await page.getByRole("button", { name: "Reverse route" }).click();
    await expect(page.getByRole("combobox", { name: "Start" })).toHaveValue(/^Chicago/);
    await expect(page.getByRole("combobox", { name: "Destination" })).toHaveValue(/^Kansas City/);
    await expect(page.locator(".route-panel.is-stale")).toHaveCount(0);
    await expect(string.locator(".route-string-text")).toHaveText(/^NS – /);
    await expect(string.locator(".route-string-text")).toHaveText(shape);

    // Delete it again, so the other tests start from no saved routes.
    await page.request.delete(`/api/saved-routes/${savedAt.split("/").pop()}`);
  });
});
