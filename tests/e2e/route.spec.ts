/**
 * The route planner in a real browser against the real server: Taylor, TX to the EXAMPLE shop at
 * North Little Rock, a stop clicked at Temple, the routes told apart by their pills, saved and opened
 * again.
 */
import type { Locator, Page } from "@playwright/test";
import type { NetworkNode } from "../../shared/places.ts";
import type { Plan, PlannedRoute } from "../../shared/plans.ts";
import { DEFAULT_INCLUDE, RAILROADS } from "../../shared/railroads.ts";
import { clickMapCentre, expect, expectMapCanvas, freeMapCentre, keepScreenshot, mapRegion, planRoute, test } from "./app.ts";

const routeRows = (page: Page): Locator => page.getByRole("region", { name: "Routes" }).getByRole("button");
/** Every place is a row: start, stops, destination. */
const placeRows = (page: Page): Locator => page.getByRole("region", { name: "Places" }).getByRole("listitem");
const legend = (page: Page): Locator => page.getByRole("list", { name: "Railroad colors" }).getByRole("listitem");
const pressedRow = (page: Page): Locator => page.getByRole("region", { name: "Routes" }).locator('[aria-pressed="true"]');

/** The next routing answer the page gets. */
const nextRoute = (page: Page) =>
  page.waitForResponse((r) => r.url().endsWith("/api/route") && r.request().method() === "POST").then(async (r) => (await r.json()) as PlannedRoute);

/** Clicks FRA node 358070 at Temple, TX, where BNSF and UP meet: the search box centres the map on it. */
async function clickTemple(page: Page): Promise<PlannedRoute> {
  await page.getByRole("combobox", { name: "Search the map" }).fill("FRA 358070");
  await page.getByRole("option", { name: /FRA node 358070/ }).click();
  await page.locator(".found-card").getByRole("button", { name: "Close" }).click();
  const answer = nextRoute(page);
  await clickMapCentre(page);
  return answer;
}

test.describe("Route planner", () => {
  test("a typed start and destination give a route and its legend", async ({ page }) => {
    await page.goto("/route");
    await expect(page.getByRole("combobox", { name: "Start" })).toHaveValue("");
    await expect(page.getByRole("status").filter({ hasText: "Click the start on the map, or type it." })).toBeVisible();
    await expectMapCanvas(page);

    const planned = await planRoute(page, "Taylor, TX", "North Little Rock, AR");
    expect(planned.outcome).toBe("routed");
    await expect(routeRows(page)).toHaveCount(planned.outcome === "routed" ? planned.routes.length : 0);
    await expect(routeRows(page).first()).toHaveAttribute("aria-pressed", "true");
    const railroads = planned.outcome === "routed" ? planned.routes[0].railroads : [];
    await expect(legend(page)).toHaveText(RAILROADS.filter((railroad) => railroads.includes(railroad)));
    await expect(page.getByRole("list", { name: "Sections" })).toContainText("Taylor");
    await expect(page.getByRole("list", { name: "Sections" })).toContainText("North Little Rock");
  });

  test("a click on a grey route puts the stop on that route", async ({ page }) => {
    await page.goto("/route");
    const planned = await planRoute(page, "Temple, TX", "North Little Rock, AR");
    if (planned.outcome !== "routed" || planned.routes.length < 2) throw new Error("Temple to North Little Rock should have two routes.");
    const [selected, grey] = planned.routes;
    const km = ([lon1, lat1]: number[], [lon2, lat2]: number[]) => Math.hypot((lon2 - lon1) * 111 * Math.cos((lat1 * Math.PI) / 180), (lat2 - lat1) * 111);
    const nearest = (point: number[], route: typeof grey) => Math.min(...route.legs.flatMap((leg) => leg.path.map((other) => km(point, other))));
    // The point of the grey route farthest from the selected one: only the grey route is drawn there.
    const points = grey.legs.flatMap((leg) => leg.path);
    const [lon, lat] = points.reduce((best, point) => (nearest(point, selected) > nearest(best, selected) ? point : best));

    // The search box centres the map on that point's node.
    const node = (await (await page.request.get(`/api/places/nearest?lon=${lon}&lat=${lat}&withinKm=0.1`)).json()) as NetworkNode | null;
    if (!node) throw new Error("The grey route's point is no node.");
    await page.getByRole("combobox", { name: "Search the map" }).fill(`FRA ${node.fraId}`);
    await page.getByRole("option", { name: new RegExp(`FRA node ${node.fraId}`) }).click();
    await page.locator(".found-card").getByRole("button", { name: "Close" }).click();
    const answer = nextRoute(page);
    await clickMapCentre(page);
    const withStop = await answer;
    expect(withStop.places).toHaveLength(3);
    const stop = withStop.places[1];
    if (!stop?.ok) throw new Error("The stop did not resolve.");
    expect(nearest([stop.place.lon, stop.place.lat], grey)).toBeLessThan(0.05);
  });

  test("while a click places something the cursor is a crosshair", async ({ page }) => {
    await page.goto("/route");
    await expectMapCanvas(page);
    const centre = await freeMapCentre(page);
    await page.mouse.move(centre.x, centre.y);
    await expect(mapRegion(page).locator("canvas.maplibregl-canvas")).toHaveCSS("cursor", "crosshair");
  });

  test("a click at Temple adds a stop that Undo takes back", async ({ page }) => {
    await page.goto("/route");
    await planRoute(page, "Taylor, TX", "North Little Rock, AR");
    const withStop = await clickTemple(page);
    await page.getByRole("button", { name: "Fit whole route" }).click();
    await expect(placeRows(page)).toHaveCount(3);
    await expect(placeRows(page).nth(1).getByRole("combobox")).toHaveValue(/Temple/i);
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
    await expect(placeRows(page)).toHaveCount(3);

    await page.getByRole("button", { name: "Undo route change" }).click();
    await expect(placeRows(page)).toHaveCount(2);
  });

  test("a stop where railroads meet sends the chosen next carrier", async ({ page }) => {
    await page.goto("/route");
    await planRoute(page, "Taylor, TX", "North Little Rock, AR");
    await clickTemple(page);
    const lines = page.getByRole("radiogroup", { name: "Next carrier at Stop 1" });
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
    await expect(page).toHaveURL(/\/route\/saved\/[0-9a-f-]+/);
    await expect(page.getByRole("button", { name: "Saved" })).toBeDisabled();
    const savedAt = new URL(page.url()).pathname;

    await page.goto(savedAt);
    await expect(pressedRow(page)).toHaveText(chosen);
    await expect(placeRows(page)).toHaveCount(3);
    await expect(page.getByRole("radio", { name: "UP" })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByRole("button", { name: "Saved" })).toBeDisabled();

    // Delete it again with the inline confirm, so the other tests start from no saved routes.
    await page.getByRole("button", { name: "New" }).click();
    await page.getByRole("button", { name: "Delete EXAMPLE Taylor → North Little Rock via Temple" }).click();
    await page.getByRole("group", { name: "Delete EXAMPLE Taylor → North Little Rock via Temple" }).getByRole("button", { name: "Delete" }).click();
    await expect(page.getByText(/^Saved routes/)).toHaveCount(0);
  });

  test("ticking Short lines reaches the Ville Platte shop", async ({ page }) => {
    await page.goto("/route");
    const shortLines = page.getByRole("group", { name: "Route options" }).getByRole("checkbox", { name: "Short lines" });
    await expect(shortLines).not.toBeChecked();
    // The map draws the network's short-line track only while the box is ticked.
    const network = page.locator(".map-canvas");
    await expect(network).toHaveAttribute("data-network-classes", "class_i passenger");
    const firstAnswer = page.waitForResponse((r) => r.url().endsWith("/api/route") && (r.request().postDataJSON() as Plan).places.at(-1) !== null);
    await page.getByRole("combobox", { name: "Start" }).fill("Baton Rouge, LA");
    await page.getByRole("combobox", { name: "Start" }).press("Enter");
    // 1373 Union Tank Car Road, Ville Platte, LA: the end of the short line, 20 km from UP.
    await page.getByRole("combobox", { name: "Destination" }).fill("-92.271, 30.688");
    await page.getByRole("combobox", { name: "Destination" }).press("Enter");
    expect((await (await firstAnswer).json()) as PlannedRoute).toMatchObject({ outcome: "no-route", problem: { at: 1 } });
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
    await expect(page).toHaveURL(/\/route\/saved\/[0-9a-f-]+/);
    await page.reload();
    await expect(shortLines).toBeChecked();
    await expect(routeRows(page).first()).toContainText("Short line");

    await page.getByRole("button", { name: "New" }).click();
    await page.getByRole("button", { name: "Delete EXAMPLE Baton Rouge → Ville Platte" }).click();
    await page.getByRole("group", { name: "Delete EXAMPLE Baton Rouge → Ville Platte" }).getByRole("button", { name: "Delete" }).click();
    await expect(page.getByText(/^Saved routes/)).toHaveCount(0);
  });

  test("hovering a turn-back mark shows where and how the route turns", async ({ page, request }) => {
    // Taylor → Temple (the city) → North Little Rock: the router's own route turns back in Temple yard.
    const plan: Plan = { places: ["Taylor, TX", "Temple, TX", "North Little Rock, AR"].map((text) => ({ kind: "text", text })), include: DEFAULT_INCLUDE, turnAtStops: false };
    const answer = (await (await request.post("/api/route", { data: plan })).json()) as PlannedRoute;
    test.skip(answer.outcome !== "routed" || !answer.routes[0].turnBacks.length, "This network build has no turn-back on that route; web/screens/route/RouteScreen.test.tsx covers the mark.");
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

  test("dragging the destination to the top makes it the start", async ({ page }) => {
    await page.goto("/route");
    await planRoute(page, "Taylor, TX", "North Little Rock, AR");
    await page.getByRole("combobox", { name: "Search the map" }).fill("Temple, TX");
    await page.getByRole("option").first().click();
    await page.getByRole("region", { name: /^Found: / }).getByRole("button", { name: "Add stop" }).click();
    await expect(placeRows(page)).toHaveCount(3);
    const values = () => placeRows(page).getByRole("combobox").evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value));
    await expect.poll(values).toEqual(["Taylor, TX", "Temple, TX", "North Little Rock, AR"]);

    const handle = await page.getByRole("button", { name: "Move Destination", exact: true }).boundingBox();
    const top = await placeRows(page).first().boundingBox();
    if (!handle || !top) throw new Error("The rows are not on the page.");
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x + handle.width / 2, top.y + handle.height / 2, { steps: 12 });
    await page.mouse.up();
    await expect.poll(values).toEqual(["North Little Rock, AR", "Taylor, TX", "Temple, TX"]);
  });

  test("the route string marks a chosen carrier and survives save and reverse", async ({ page }) => {
    await page.goto("/route");
    await planRoute(page, "Kansas City, MO", "Chicago, IL");
    const string = page.getByRole("region", { name: "Route string" });
    // Carriers and [our own place names] only.
    const shape = /^(BNSF|UP|CSXT|NS|CN|CPKC|regional|short line)( – \[[^\]]+\] – (BNSF|UP|CSXT|NS|CN|CPKC|regional|short line))*$/;
    await expect(string.locator(".route-string-text")).toHaveText(shape);

    // FRA node 412783 in Chicago, where BNSF, UP, NS and CN meet: NS takes the car on there.
    await page.getByRole("combobox", { name: "Search the map" }).fill("FRA 412783");
    await page.getByRole("option", { name: /FRA node 412783/ }).click();
    await page.getByRole("region", { name: /^Found: / }).getByRole("button", { name: "Add stop" }).click();
    const lines = page.getByRole("radiogroup", { name: "Next carrier at Stop 1" });
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
