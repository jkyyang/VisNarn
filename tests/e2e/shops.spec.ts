/**
 * The Shops screen in a real browser against the real server: shops are user data, added, changed
 * and deleted here, and imported from a CSV whose bad rows are listed instead of saved.
 * The EXAMPLE shops are left as they were added (./app.ts), for the other screens' tests.
 */
import type { Page } from "@playwright/test";
import type { FraId, ShopDraft, ShopLink, ShopView } from "../../shared/places.ts";
import { SHOP_ZOOM } from "../../web/map/config.ts";
import { expectMapCanvas, freeMapCentre, keepScreenshot, mapRegion, PHONE, planRoute, test, expect } from "./app.ts";
import { EXAMPLE_SHOPS } from "../fixtures.ts";

const EXAMPLES = EXAMPLE_SHOPS.length;

test.describe("Shops", () => {
  test("add a shop on the map, refuse a spot off the network, edit it, refuse a taken code, delete it", async ({ page }) => {
    await page.goto("/shops");
    await expect(page.getByRole("heading", { name: "Your shops", level: 1 })).toBeVisible();
    const list = page.getByRole("region", { name: "Shop list", exact: true });
    const row = (text: string) => list.getByRole("listitem").filter({ hasText: text });
    const names = list.locator(".shop-name");
    await expect(names).toHaveCount(EXAMPLES);
    await expect(page.getByText(`${EXAMPLES} shops`, { exact: true })).toBeVisible();
    await expect(row("EX-NLR-01")).toContainText("North Little Rock, AR");
    await expect(row("EX-NLR-01").getByRole("img", { name: "Carriers: BNSF, UP" })).toBeVisible();
    await expectMapCanvas(page);
    await keepScreenshot(page, "shops");

    await page.getByRole("button", { name: "Add shop" }).click();
    await expect(page).toHaveURL(/\/shops\/new$/);
    const form = page.getByRole("region", { name: "Add shop" });
    const save = form.getByRole("button", { name: "Save shop" });
    await form.getByRole("textbox", { name: "Name", exact: true }).fill("Temple test shop");
    await expect(save).toBeDisabled();
    // No box to type the location in: it is set on the map. Out in the Pacific there is no track: the Location row turns red.
    await expect(form.getByRole("combobox", { name: "Location" })).toHaveCount(0);
    const location = form.getByRole("status", { name: "Location" });
    const map = await mapRegion(page).boundingBox();
    if (!map) throw new Error("No map on the page.");
    // Just right of the panel at the foot of the map: the Pacific off Mexico.
    await page.mouse.click(map.x + 420, map.y + map.height - 30);
    await expect(location).toHaveClass(/is-wrong/);
    await expect(location).toHaveAttribute("title", /^No track near/);
    await expect(save).toBeDisabled();
    // The search flies the map to Temple; a click there puts the pin.
    await page.getByRole("combobox", { name: "Search shops and cities" }).fill("Temple, TX");
    await page.getByRole("option", { name: /^Temple, TX/ }).first().click();
    await page.locator(".found-card").getByRole("button", { name: "Close" }).click();
    const centre = await freeMapCentre(page);
    await page.mouse.click(centre.x, centre.y);
    await expect(location).not.toHaveClass(/is-wrong/);
    await expect(location).toContainText("Temple");
    // Linked at once to where its track most likely joins the network, and said in a row: no sentence about it.
    await expect(form.getByRole("group", { name: "Track links" })).toContainText(/Temple · FRA \d+/);
    await expect(form.getByRole("group", { name: "Track links" })).not.toContainText(/cars|Suggested/);
    await expect(save).toBeEnabled();
    await save.click();
    await expect(page).toHaveURL(/\/shops$/);
    await expect(row("Temple test shop").getByRole("img", { name: /^Carriers: .*BNSF/ })).toBeVisible();
    await expect(names).toHaveCount(EXAMPLES + 1);

    // The server owns the shops: a reload shows the same list.
    await page.reload();
    await expect(row("Temple test shop")).toBeVisible();

    await page.getByRole("button", { name: "Edit Temple test shop" }).click();
    const edit = page.getByRole("region", { name: "Edit shop" });
    const code = edit.getByRole("textbox", { name: /Shop code/ });
    await code.fill("EX-NLR-01");
    await edit.getByRole("button", { name: "Save shop" }).click();
    await expect(edit.getByRole("alert")).toHaveText('The shop "North Little Rock, AR" already has the code EX-NLR-01. Give each shop its own code.');
    await code.fill("TEST-TPL-01");
    await edit.getByRole("textbox", { name: "Name", exact: true }).fill("Temple test shop, renamed");
    await edit.getByRole("button", { name: "Save shop" }).click();
    await expect(row("Temple test shop, renamed")).toContainText("TEST-TPL-01");

    await page.getByRole("button", { name: "Edit Temple test shop, renamed" }).click();
    await page.getByRole("button", { name: "Delete" }).click();
    await page.getByRole("group", { name: "Delete this shop?" }).getByRole("button", { name: "Delete" }).click();
    await expect(row("Temple test shop")).toHaveCount(0);
    await expect(names).toHaveCount(EXAMPLES);
    await page.reload();
    await expect(names).toHaveCount(EXAMPLES);
  });

  test("a shop CSV with a row that matches no node: the preview lists it to fix, and only the good rows are saved", async ({ page }) => {
    await page.goto("/shops");
    const list = page.getByRole("region", { name: "Shop list", exact: true });
    const row = (text: string) => list.getByRole("listitem").filter({ hasText: text });
    await expect(list.locator(".shop-name").first()).toBeVisible();
    const before = await list.locator(".shop-name").count();
    const csv = "name,lon,lat\nOmaha test shop,-95.94,41.26\nDenver test shop,-104.99,39.74\nShop in the sea,-140,10\n";
    // ⋯ → Import CSV opens the file chooser.
    await list.getByRole("button", { name: "More actions" }).click();
    const chooser = page.waitForEvent("filechooser");
    await list.getByRole("menuitem", { name: "Import CSV" }).click();
    await (await chooser).setFiles({ name: "test-shops.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });

    const card = page.getByRole("region", { name: "Import shop list" });
    const preview = card.getByRole("region", { name: "Import preview" });
    await expect(preview).toContainText("test-shops.csv · 2 ready · 1 not saved");
    await expect(preview.getByRole("list", { name: "Rows to fix before saving" })).toHaveText("Line 4: No track near -140, 10.");
    // A preview saves nothing.
    await expect(row("Omaha test shop")).toHaveCount(0);

    await preview.getByRole("button", { name: "Save 2 shops" }).click();
    // The card goes; the rows saved are in the list, lit once.
    await expect(card).toHaveCount(0);
    await expect(row("Omaha test shop")).toBeVisible();
    await expect(row("Denver test shop")).toBeVisible();
    await expect(row("Shop in the sea")).toHaveCount(0);
    await expect(list.locator(".shop-name")).toHaveCount(before + 2);

    // Imported shops are ordinary shops, deleted the same way.
    for (const name of ["Omaha test shop", "Denver test shop"]) {
      await page.getByRole("button", { name: `Edit ${name}` }).click();
      await page.getByRole("button", { name: "Delete" }).click();
      await page.getByRole("group", { name: "Delete this shop?" }).getByRole("button", { name: "Delete" }).click();
      await expect(row(name)).toHaveCount(0);
    }
    await expect(list.locator(".shop-name")).toHaveCount(before);
  });

  test("Sarnia's suggestion follows the plant's lead to the main line, and a route arrives over it", async ({ page }) => {
    // Procor's Sarnia plant: its yard fans out north of the CN main line and joins it at the east end (FRA 628925).
    const at = { lon: -82.3376, lat: 42.9596 };
    const shop = await makeShop(page, { name: "Sarnia test plant", code: "TEST-SAR", location: { kind: "coord", ...at }, links: [] });
    await page.goto(`/shops/${shop.id}`);
    const links = page.getByRole("group", { name: "Track links" });
    // 0.34 km from the pin to the plant's yard, then along it: 1.3 km of the plant's own track.
    await expect(links).toContainText("Sarnia · FRA 628925");
    await expect(links).toContainText("1.3 km");
    await expect(links).toContainText("Suggested");
    await expect(page.locator('.map-handle[aria-label="Suggested link 1"]')).toBeVisible();
    await links.getByRole("button", { name: "Use" }).click();
    await expect(links).not.toContainText("Suggested");
    await page.getByRole("region", { name: "Edit shop" }).getByRole("button", { name: "Save shop" }).click();
    await expect(page).toHaveURL(/\/shops$/);

    await page.getByRole("navigation", { name: "Mode" }).getByRole("link", { name: "Route" }).click();
    const planned = await planRoute(page, "-79.7195, 43.4169", "TEST-SAR");
    expect(planned.outcome).toBe("routed");
    if (planned.outcome !== "routed") return;
    // The route's last km are the link's 1.29 km of own track.
    expect(planned.routes[0].km).toBeCloseTo(237.79, 1);
    expect(planned.routes[0].legs.at(-1)!.path.slice(-2)).toEqual([[-82.33578, 42.95513], [at.lon, at.lat]]);
    expect((await page.request.delete(`/api/shops/${shop.id}`)).ok()).toBe(true);
  });

  test("Oakville, linked as the user had it: links are dragged on the map, refined to the track, drawn along it, undone, saved, and routed to", async ({ page }) => {
    const shop = await makeShop(page, { name: "Oakville test plant", code: "TEST-OAK", location: { kind: "coord", ...OAKVILLE }, links: [633676 as FraId] });
    await page.goto(`/shops/${shop.id}`);
    const form = page.getByRole("region", { name: "Edit shop" });
    const links = form.getByRole("group", { name: "Track links" });
    await expect(links).toContainText("Oakville · FRA 633676");
    // No ⌖, no Add link button, no sentence: a row per link, a ring to press and × to remove.
    await expect(form.locator(".pick-btn")).toHaveCount(0);
    await expect(form).not.toContainText(/Pick on map|cars/);
    await expect(handle(page, "Move link 1")).toBeVisible();
    await keepScreenshot(page, "shop-links-oakville");

    // Dropped roughly in the plant's fan, link 1 is refined to where the plant's lead meets the main line, and drawn along the lead.
    const ghost = page.waitForRequest((r) => isLinks(r.url()) && "lon" in (r.postDataJSON() as LinksBody).ends[0]);
    const drawn = waitForLinks(page, [{ fraId: 633683 }]);
    await drag(page, "Move link 1", PLANT_FAN, { beforeRelease: () => ghost });
    await expect(links).toContainText("Oakville · FRA 633683");
    expect((await drawn)[0]!.path.length).toBeGreaterThan(2);

    // The ＋ on the pin's edge, dropped on the main line west of the plant 100 m short of a node, adds link 2 at that node.
    // Undo takes it away, Redo brings it back.
    await drag(page, "Add link", { lon: -79.7256, lat: 43.41345 });
    await expect(links).toContainText("Oakville · FRA 633604");
    await page.getByRole("button", { name: "Undo link change" }).click();
    await expect(links).not.toContainText("FRA 633604");
    await page.getByRole("button", { name: "Redo link change" }).click();
    await expect(links).toContainText("Oakville · FRA 633604");

    // Dropped in the plant, where link 1 already joins, link 2 springs back and the panel says why.
    const before = await handle(page, "Move link 2").boundingBox();
    await drag(page, "Move link 2", PLANT_FAN);
    await expect(links).toContainText("Link 1 joins there");
    await expect(links).toContainText("Oakville · FRA 633604");
    await expect.poll(async () => (await handle(page, "Move link 2").boundingBox())?.x).toBeCloseTo(before!.x, 0);

    // Esc in the middle of a drag changes nothing.
    await drag(page, "Move link 2", PLANT_FAN, { beforeRelease: () => page.keyboard.press("Escape") });
    await expect(links).toContainText("Oakville · FRA 633683");
    await expect(links).toContainText("Oakville · FRA 633604");

    // With Real tracks on, link 1's piece on track follows the surveyed lead.
    const onTrack = page.waitForResponse((r) => r.url().endsWith("/api/track"));
    await page.getByRole("button", { name: /^Map layers/ }).click();
    await page.getByText("Real tracks").click();
    await page.getByRole("button", { name: /^Map layers/ }).click();
    const sent = (await (await onTrack).request().postDataJSON()) as { paths: [number, number][][] };
    const followed = (await (await onTrack).json()) as [number, number][][];
    expect(sent.paths).toHaveLength(1);
    expect(followed[0].length).toBeGreaterThan(sent.paths[0].length);
    expect(followed[0].at(-1)).toEqual(sent.paths[0].at(-1));
    await keepScreenshot(page, "shop-links-oakville-tracks");

    // The shop's own pin is dragged too: the location follows it and the links are drawn again from there.
    const redrawn = page.waitForResponse((r) => isLinks(r.url()) && (r.request().postDataJSON() as LinksBody).lon !== OAKVILLE.lon);
    await drag(page, "Oakville test plant", { lon: -79.7198, lat: 43.4177 });
    const moved = (await (await redrawn).request().postDataJSON()) as LinksBody;
    expect(moved.lon).toBeCloseTo(-79.7198, 3);
    expect(moved.lat).toBeCloseTo(43.4177, 3);
    await expect(links).toContainText("Oakville · FRA 633683");

    await form.getByRole("button", { name: "Save shop" }).click();
    await expect(page).toHaveURL(/\/shops$/);
    const saved = ((await (await page.request.get("/api/shops")).json()) as ShopView[]).find((s) => s.id === shop.id)!;
    expect(saved.links).toEqual([633683, 633604]);
    expect(saved.location).toMatchObject({ lon: expect.closeTo(-79.7198, 3), lat: expect.closeTo(43.4177, 3) });
    await page.goto(`/shops/${shop.id}`);
    await expect(page.getByRole("group", { name: "Track links" })).toContainText("FRA 633683");
    await expect(page.getByRole("group", { name: "Track links" })).toContainText("FRA 633604");

    await page.getByRole("navigation", { name: "Mode" }).getByRole("link", { name: "Route" }).click();
    const planned = await planRoute(page, "London, ON", "TEST-OAK");
    expect(planned.outcome).toBe("routed");
    const place = saved.place.ok ? saved.place.place : null;
    if (planned.outcome === "routed") expect(planned.routes[0].legs.at(-1)!.path.at(-1)).toEqual([place?.lon, place?.lat]);
    expect((await page.request.delete(`/api/shops/${shop.id}`)).ok()).toBe(true);
  });
});

test.describe("Shops on a phone", () => {
  test.use(PHONE);

  test("a tap on a link's ring, then a tap in the plant: the link is refined to where the plant's lead meets the main line", async ({ page }) => {
    const shop = await makeShop(page, { name: "Oakville phone plant", code: "TEST-OAK-P", location: { kind: "coord", ...OAKVILLE }, links: [633676 as FraId] });
    await page.goto(`/shops/${shop.id}`);
    const links = page.getByRole("group", { name: "Track links" });
    await expect(links).toContainText("Oakville · FRA 633676");
    const ring = links.getByRole("button", { name: "Move link 1", exact: true });
    await ring.tap();
    await expect(ring).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("section.map")).toHaveAttribute("data-picking", "true");
    const fan = await mapPoint(page, OAKVILLE, PLANT_FAN);
    await page.touchscreen.tap(fan.x, fan.y);
    await expect(links).toContainText("Oakville · FRA 633683");
    await expect(ring).toHaveAttribute("aria-pressed", "false");
    await keepScreenshot(page, "shop-links-phone");
    expect((await page.request.delete(`/api/shops/${shop.id}`)).ok()).toBe(true);
  });
});

/** Procor's Oakville plant as the user had it: the pin in the plant, and a point in its fan of tracks. */
const OAKVILLE = { lon: -79.72024, lat: 43.41766 };
const PLANT_FAN = { lon: -79.7193, lat: 43.4186 };

type LinksBody = { lon: number; lat: number; ends: ({ fraId: number } | { lon: number; lat: number })[] };
const isLinks = (url: string) => url.endsWith("/api/places/links");

async function makeShop(page: Page, draft: ShopDraft): Promise<ShopView> {
  const made = await page.request.post("/api/shops", { data: draft });
  expect(made.ok()).toBe(true);
  return (await made.json()) as ShopView;
}

/** The map's handle with this name: the shop's pin, a link's ring, the ＋. */
const handle = (page: Page, name: string) => page.locator(`.map-handle[aria-label="${name}"]`);

/** The links answer for exactly these ends. */
async function waitForLinks(page: Page, ends: LinksBody["ends"]): Promise<(ShopLink | null)[]> {
  const response = await page.waitForResponse((r) => isLinks(r.url()) && JSON.stringify((r.request().postDataJSON() as LinksBody).ends) === JSON.stringify(ends));
  return (await response.json()) as (ShopLink | null)[];
}

/** Drags a handle by mouse to a point of the map, in steps, while the camera holds the Oakville shop in the middle. */
async function drag(page: Page, name: string, to: { lon: number; lat: number }, options: { beforeRelease?: () => Promise<unknown> } = {}): Promise<void> {
  // A screenshot just before makes the window taller for a moment: the handles are back in place once the map has the window's size again.
  const canvas = mapRegion(page).locator("canvas.maplibregl-canvas");
  await expect.poll(async () => (await canvas.boundingBox())?.height).toBe((await mapRegion(page).boundingBox())?.height);
  const box = await handle(page, name).boundingBox();
  if (!box) throw new Error(`No handle ${name} on the map.`);
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const end = await mapPoint(page, OAKVILLE, to);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 12 });
  await options.beforeRelease?.();
  await page.mouse.up();
}

/** Where a point is on screen while the shop at `centre` is being edited: the camera holds it in the free map's middle at SHOP_ZOOM. */
async function mapPoint(page: Page, centre: { lon: number; lat: number }, point: { lon: number; lat: number }): Promise<{ x: number; y: number }> {
  const middle = await freeMapCentre(page);
  const world = 512 * 2 ** SHOP_ZOOM;
  const mercator = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  return { x: middle.x + ((point.lon - centre.lon) * world) / 360, y: middle.y - ((mercator(point.lat) - mercator(centre.lat)) * world) / (2 * Math.PI) };
}
