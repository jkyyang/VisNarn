/**
 * The route planner in a real browser against the real server: Taylor, TX to the EXAMPLE shop at
 * North Little Rock, a stop clicked at Temple, the routes told apart by their pills, saved and opened
 * again.
 */
import type { Locator, Page } from "@playwright/test";
import type { NetworkNode } from "../../shared/places.ts";
import type { Plan, PlannedRoute } from "../../shared/plans.ts";
import { DEFAULT_INCLUDE } from "../../shared/railroads.ts";
import { clickMapCentre, expect, expectMapCanvas, keepScreenshot, mapRegion, planRoute, test } from "./app.ts";

const routeRows = (page: Page): Locator => page.getByRole("region", { name: "Routes" }).getByRole("button");
/** Every place is a row: start, stops, destination. */
const placeRows = (page: Page): Locator => page.getByRole("region", { name: "Places" }).getByRole("listitem");
const pressedRow = (page: Page): Locator => page.getByRole("region", { name: "Routes" }).locator('[aria-pressed="true"]');
/** The result card: the selected route's length, carriers and legs. */
const result = (page: Page): Locator => page.getByRole("region", { name: "Route", exact: true });
/** One of the route's actions, from the bar's ⋯ menu. */
async function routeAction(page: Page, item: string): Promise<void> {
  await page.getByRole("button", { name: "Route actions" }).click();
  await page.getByRole("menuitem", { name: item }).click();
}
/** Route options, opened: the track classes, Turn at stops, and the carrier from a place where several meet. */
async function routeOptions(page: Page): Promise<Locator> {
  const head = page.getByRole("button", { name: /^Route options/ });
  if ((await head.getAttribute("aria-expanded")) !== "true") await head.click();
  return page.getByRole("region", { name: "Route options" });
}

/** The railroads the selected route runs on, as its legs in the result card name them. */
const selectedRailroads = (page: Page): Promise<Set<string>> => result(page).locator(".leg-carrier").allTextContents().then((names) => new Set(names));

/** The next routing answer the page gets for a plan with every row set. */
const nextRoute = (page: Page) =>
  page
    .waitForResponse((r) => r.url().endsWith("/api/route") && r.request().method() === "POST" && (r.request().postDataJSON() as Plan).places.every(Boolean))
    .then(async (r) => (await r.json()) as PlannedRoute);

/** Add stop, then a click at FRA node 358070 at Temple, TX, where BNSF and UP meet: the search box centres the map on it. */
async function clickTemple(page: Page): Promise<PlannedRoute> {
  await page.getByRole("combobox", { name: "Search shops and cities" }).fill("FRA 358070");
  await page.getByRole("option", { name: /FRA node 358070/ }).click();
  await page.locator(".found-card").getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Add stop" }).click();
  const answer = nextRoute(page);
  await clickMapCentre(page);
  return answer;
}

test.describe("Route planner", () => {
  test("a typed start and destination give a route, its result card naming its railroads", async ({ page }) => {
    await page.goto("/route");
    await expect(page.getByRole("combobox", { name: "Start" })).toHaveValue("");
    // No sentence on screen: the pressed ⌖ and the crosshair on the map say what to do.
    await expect(page.getByRole("status").filter({ hasText: "Click the map to set Start · Esc to cancel" })).toHaveClass("visually-hidden");
    await expectMapCanvas(page);

    const planned = await planRoute(page, "Taylor, TX", "North Little Rock, AR");
    expect(planned.outcome).toBe("routed");
    const count = planned.outcome === "routed" ? planned.routes.length : 0;
    // A row per route when there are two or more; the result card shows the selected one.
    await expect(routeRows(page)).toHaveCount(count > 1 ? count : 0);
    const railroads = planned.outcome === "routed" ? planned.routes[0].railroads : [];
    await expect(page.getByRole("list", { name: "Sections" })).toContainText("Taylor →");
    await expect(page.getByRole("list", { name: "Sections" })).toContainText("→ North Little Rock");
    expect(await selectedRailroads(page)).toEqual(new Set(railroads));
  });

  test("a click on a grey route selects it; after Add stop, a click there puts the stop on that route", async ({ page }) => {
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
    await page.getByRole("combobox", { name: "Search shops and cities" }).fill(`FRA ${node.fraId}`);
    await page.getByRole("option", { name: new RegExp(`FRA node ${node.fraId}`) }).click();
    await page.locator(".found-card").getByRole("button", { name: "Close" }).click();
    await clickMapCentre(page);
    await expect(page).toHaveURL(new RegExp(`\\?option=${grey.strategies[0]}$`));
    await expect(placeRows(page)).toHaveCount(2);

    await page.getByRole("button", { name: "Add stop" }).click();
    const answer = nextRoute(page);
    await clickMapCentre(page);
    const withStop = await answer;
    expect(withStop.places).toHaveLength(3);
    const stop = withStop.places[1];
    if (!stop?.ok) throw new Error("The stop did not resolve.");
    expect(nearest([stop.place.lon, stop.place.lat], grey)).toBeLessThan(0.05);
  });

  test("the cursor is a crosshair only while ⌖ is on, and a click on the map with ⌖ off places nothing", async ({ page }) => {
    await page.goto("/route");
    await expectMapCanvas(page);
    const canvas = mapRegion(page).locator("canvas.maplibregl-canvas");
    const box = await canvas.boundingBox();
    if (!box) throw new Error("The map is not on the page.");
    // Open sea off the Pacific coast: no shop under the pointer.
    const sea = { x: box.x + box.width * 0.3, y: box.y + box.height - 60 };
    // A new plan starts with the start's ⌖ on.
    await page.mouse.move(sea.x, sea.y);
    await expect(canvas).toHaveCSS("cursor", "crosshair");
    await page.keyboard.press("Escape");
    await page.mouse.move(sea.x + 4, sea.y);
    await expect(canvas).toHaveCSS("cursor", "grab");
    await page.mouse.click(sea.x + 4, sea.y);
    await page.waitForTimeout(500);
    await expect(page.getByRole("combobox", { name: "Start" })).toHaveValue("");
    await expect(page.locator(".flash")).toHaveCount(0);
  });

  test("a click at Temple adds a stop that Undo takes back", async ({ page }) => {
    await page.goto("/route");
    await planRoute(page, "Taylor, TX", "North Little Rock, AR");
    const withStop = await clickTemple(page);
    // Out of Temple, where the search box took the camera, back to the whole network.
    await page.getByRole("button", { name: "Reset view to the whole network" }).click();
    await expect(placeRows(page)).toHaveCount(3);
    await expect(placeRows(page).nth(1).getByRole("combobox")).toHaveValue(/Temple/i);
    expect(withStop.outcome).toBe("routed");

    // Once the marks have placed themselves for the new view (the frame after the camera's move ends),
    // there are pills, and every one is clear of the others and of the turn-back discs. The boxes are
    // read in one go, so a placement cannot slip in between.
    const placement = () =>
      page.evaluate(() => {
        const shown = (selector: string) => [...document.querySelectorAll(selector)].map((el) => el.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0);
        const pills = shown(".route-pill");
        const discs = shown(".turn-mark");
        const overlap = (a: DOMRect, b: DOMRect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
        const overlaps = pills.flatMap((a, i) => [...pills.slice(i + 1), ...discs].filter((b) => overlap(a, b))).length;
        return { pills: pills.length > 1, overlaps };
      });
    await expect.poll(placement).toEqual({ pills: true, overlaps: 0 });
    await keepScreenshot(page, "route");

    // A pill click selects that route; it must not also reach the map and place a stop.
    const before = (await pressedRow(page).textContent()) ?? "";
    await page.locator(".route-pill:not(.is-selected)").first().click();
    await expect(page).toHaveURL(/\?option=[a-z-]+$/);
    await expect(pressedRow(page)).not.toHaveText(before);
    await page.waitForTimeout(500);
    await expect(placeRows(page)).toHaveCount(3);

    // Undo empties the stop, then takes its row away.
    await page.getByRole("button", { name: "Undo route change" }).click();
    await page.getByRole("button", { name: "Undo route change" }).click();
    await expect(placeRows(page)).toHaveCount(2);
  });

  test("a stop where railroads meet sends the carrier chosen from there", async ({ page }) => {
    await page.goto("/route");
    await planRoute(page, "Taylor, TX", "North Little Rock, AR");
    await clickTemple(page);
    const options = await routeOptions(page);
    const carrier = options.getByRole("button", { name: /^Carrier from / });
    await expect(carrier).toHaveAccessibleName(/: Router's pick$/);
    const answered = page.waitForResponse((r) => r.url().endsWith("/api/route") && JSON.stringify(r.request().postDataJSON()).includes('"railroad":"UP"'));
    // Router's pick → BNSF → UP.
    await carrier.click();
    await carrier.click();
    await answered;
    await expect(page.locator(".route-panel.is-stale")).toHaveCount(0);
    await expect(carrier).toHaveAccessibleName(/: UP$/);

    // Pick the second route, save, and open the saved route again from its link.
    await routeRows(page).nth(1).click();
    await expect(page).toHaveURL(/\?option=/);
    const chosen = (await pressedRow(page).textContent()) ?? "";
    await routeAction(page, "Save route");
    await expect(page).toHaveURL(/\/route\/saved\/[0-9a-f-]+/);
    const savedAt = new URL(page.url()).pathname;

    await page.goto(savedAt);
    await expect(pressedRow(page)).toHaveText(chosen);
    await expect(placeRows(page)).toHaveCount(3);
    await expect((await routeOptions(page)).getByRole("button", { name: /^Carrier from / })).toHaveAccessibleName(/: UP$/);

    // Delete it again with the inline confirm, so the other tests start from no saved routes.
    await routeAction(page, "New route");
    const saved = page.getByRole("region", { name: "Saved routes" });
    if ((await saved.getByRole("button", { name: /^Saved routes/ }).getAttribute("aria-expanded")) !== "true") await saved.getByRole("button", { name: /^Saved routes/ }).click();
    await saved.getByRole("button", { name: "Delete Taylor → North Little Rock" }).click();
    await saved.getByRole("group", { name: "Delete Taylor → North Little Rock" }).getByRole("button", { name: "Delete" }).click();
    await expect(page.getByRole("region", { name: "Saved routes" })).toHaveCount(0);
  });

  test("ticking Short lines reaches the Ville Platte shop", async ({ page }) => {
    await page.goto("/route");
    const shortLines = (await routeOptions(page)).getByRole("switch", { name: "Short lines" });
    await expect(shortLines).toHaveAttribute("aria-checked", "false");
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
    await expect(result(page)).toHaveCount(0);

    const ticked = nextRoute(page);
    await shortLines.click();
    expect((await ticked).outcome).toBe("routed");
    await expect(network).toHaveAttribute("data-network-classes", "class_i short_line passenger");
    const legs = page.getByRole("list", { name: "Sections" }).getByRole("button");
    await expect(legs.first()).toContainText(/^UP/);
    await expect(legs.last()).toContainText(/^Short line/);
    expect(await selectedRailroads(page)).toEqual(new Set(["UP", "Short line"]));

    await routeAction(page, "Save route");
    await expect(page).toHaveURL(/\/route\/saved\/[0-9a-f-]+/);
    const savedAt = new URL(page.url()).pathname;
    await page.reload();
    await expect((await routeOptions(page)).getByRole("switch", { name: "Short lines" })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByRole("list", { name: "Sections" }).getByRole("button").last()).toContainText(/^Short line/);
    await page.request.delete(`/api/saved-routes/${savedAt.split("/").pop()}`);
  });

  test("hovering a turn-back mark shows where and how the route turns", async ({ page, request }) => {
    // Taylor → Temple (the city) → North Little Rock: the router's own route turns back in Temple yard.
    const plan: Plan = { places: ["Taylor, TX", "Temple, TX", "North Little Rock, AR"].map((text) => ({ kind: "text", text })), include: DEFAULT_INCLUDE, turnAtStops: false };
    const answer = (await (await request.post("/api/route", { data: plan })).json()) as PlannedRoute;
    test.skip(answer.outcome !== "routed" || !answer.routes[0].turnBacks.length, "This network build has no turn-back on that route; web/screens/route/RouteScreen.test.tsx covers the mark.");
    const saved = (await (await request.post("/api/saved-routes", { data: { name: "EXAMPLE turn-back", plan, option: null, routeString: "" } })).json()) as { id: string };

    await page.goto(`/route/saved/${saved.id}`);
    await expect(result(page)).toContainText("turn-back");
    const mark = mapRegion(page).getByRole("button", { name: /^Turn-back at / }).first();
    await expect(mark).toBeVisible();
    await mark.hover();
    await expect(page.getByRole("tooltip")).toContainText(/yard track/);
    await expect(page.getByRole("tooltip")).toContainText(/ (N|NE|E|SE|S|SW|W|NW) → /);
    await request.delete(`/api/saved-routes/${saved.id}`);
  });

  test("dragging the destination to the top makes it the start", async ({ page }) => {
    await page.goto("/route");
    await planRoute(page, "Taylor, TX", "North Little Rock, AR");
    await page.getByRole("combobox", { name: "Search shops and cities" }).fill("Temple, TX");
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

  test("a carrier chosen at a place goes into the saved route string, and Reverse turns the route round", async ({ page }) => {
    await page.goto("/route");
    await planRoute(page, "Kansas City, MO", "Chicago, IL");
    // Carriers and [our own place names] only.
    const shape = /^(BNSF|UP|CSXT|NS|CN|CPKC|regional|short line)(-\[[^\]]+\]-(BNSF|UP|CSXT|NS|CN|CPKC|regional|short line))*$/;

    // FRA node 412783 in Chicago, where BNSF, UP, NS and CN meet: NS takes the car on there.
    await page.getByRole("combobox", { name: "Search shops and cities" }).fill("FRA 412783");
    await page.getByRole("option", { name: /FRA node 412783/ }).click();
    await page.getByRole("region", { name: /^Found: / }).getByRole("button", { name: "Add stop" }).click();
    const carrier = (await routeOptions(page)).getByRole("button", { name: /^Carrier from / });
    await expect(carrier).toHaveAccessibleName(/: Router's pick$/);
    const answered = page.waitForResponse((r) => r.url().endsWith("/api/route") && JSON.stringify(r.request().postDataJSON()).includes('"railroad":"NS"'));
    while (!/: NS$/.test((await carrier.getAttribute("aria-label")) ?? "")) await carrier.click();
    await answered;
    await expect(page.locator(".route-panel.is-stale")).toHaveCount(0);
    await expect(page.getByRole("list", { name: "Sections" }).getByRole("button").last()).toContainText(/^NS/);
    await keepScreenshot(page, "route-carrier");

    await routeAction(page, "Save route");
    await expect(page).toHaveURL(/\/route\/saved\/[0-9a-f-]+/);
    const savedAt = new URL(page.url()).pathname;
    const saved = ((await (await page.request.get("/api/saved-routes")).json()) as { id: string; routeString: string }[]).find((route) => savedAt.endsWith(route.id));
    expect(saved?.routeString).toMatch(shape);
    expect(saved?.routeString).toMatch(/-NS$/);
    await page.goto(savedAt);
    await expect(result(page)).not.toContainText("Saved as");

    await routeAction(page, "Reverse route");
    await expect(page.getByRole("combobox", { name: "Start" })).toHaveValue(/^Chicago/);
    await expect(page.getByRole("combobox", { name: "Destination" })).toHaveValue(/^Kansas City/);
    await expect(page.locator(".route-panel.is-stale")).toHaveCount(0);
    await expect(page.getByRole("list", { name: "Sections" }).getByRole("button").first()).toContainText(/^NS/);

    // Delete it again, so the other tests start from no saved routes.
    await page.request.delete(`/api/saved-routes/${savedAt.split("/").pop()}`);
  });
});
