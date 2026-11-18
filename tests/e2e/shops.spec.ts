/**
 * The Shops screen in a real browser against the real server: shops are user data, added, changed
 * and deleted here, and imported from a CSV whose bad rows are listed instead of saved.
 * The EXAMPLE shops are left as they were added (./app.ts), for the other screens' tests.
 */
import type { Page } from "@playwright/test";
import type { ShopView } from "../../shared/places.ts";
import { SHOP_ZOOM } from "../../web/map/config.ts";
import { expectMapCanvases, freeMapCentre, keepScreenshot, planRoute, test, expect } from "./app.ts";
import { EXAMPLE_SHOPS } from "../fixtures.ts";

const EXAMPLES = EXAMPLE_SHOPS.length;

test.describe("Shops", () => {
  test("add a shop, refuse a spot off the network, edit it, refuse a taken code, delete it", async ({ page }) => {
    await page.goto("/shops");
    await expect(page.getByRole("heading", { name: "Your shops", level: 1 })).toBeVisible();
    const table = page.getByRole("table");
    const names = table.locator(".shop-name");
    await expect(names).toHaveCount(EXAMPLES);
    await expect(page.getByText(`${EXAMPLES} shops`, { exact: true })).toBeVisible();
    const nlr = table.getByRole("row").filter({ hasText: "EX-NLR-01" });
    await expect(nlr).toContainText("North Little Rock, AR");
    await expect(nlr).toContainText("BNSF, UP");
    await expectMapCanvases(page);
    await keepScreenshot(page, "shops");

    await page.getByRole("button", { name: "Add shop" }).click();
    await expect(page).toHaveURL(/\/shops\/new$/);
    const form = page.getByRole("region", { name: "Add shop" });
    const save = form.getByRole("button", { name: "Save shop" });
    await form.getByRole("textbox", { name: "Name", exact: true }).fill("Temple test shop");
    await expect(save).toBeDisabled();
    const location = form.getByRole("combobox", { name: "Location" });
    await location.fill("-140, 70");
    await expect(form).toContainText("No track near -140, 70.");
    await expect(save).toBeDisabled();
    await location.fill("-97.34, 31.10");
    await expect(form).toContainText("On the network");
    await expect(form.getByRole("group", { name: "Track links" })).toContainText("One link: cars leave the way they came in.");
    await expect(save).toBeEnabled();
    await save.click();
    await expect(page).toHaveURL(/\/shops$/);
    const added = table.getByRole("row").filter({ hasText: "Temple test shop" });
    await expect(added).toContainText("BNSF");
    await expect(names).toHaveCount(EXAMPLES + 1);

    // The server owns the shops: a reload shows the same list.
    await page.reload();
    await expect(page.getByRole("table").getByRole("row").filter({ hasText: "Temple test shop" })).toBeVisible();

    await page.getByRole("button", { name: "Edit Temple test shop" }).click();
    const edit = page.getByRole("region", { name: "Edit shop" });
    const code = edit.getByRole("textbox", { name: /Shop code/ });
    await code.fill("EX-NLR-01");
    await edit.getByRole("button", { name: "Save shop" }).click();
    await expect(edit.getByRole("alert")).toHaveText('The shop "North Little Rock, AR" already has the code EX-NLR-01. Give each shop its own code.');
    await code.fill("TEST-TPL-01");
    await edit.getByRole("textbox", { name: "Name", exact: true }).fill("Temple test shop, renamed");
    await edit.getByRole("button", { name: "Save shop" }).click();
    const renamed = page.getByRole("table").getByRole("row").filter({ hasText: "Temple test shop, renamed" });
    await expect(renamed).toContainText("TEST-TPL-01");

    await page.getByRole("button", { name: "Edit Temple test shop, renamed" }).click();
    await page.getByRole("button", { name: "Delete" }).click();
    await page.getByRole("group", { name: "Delete this shop?" }).getByRole("button", { name: "Delete" }).click();
    await expect(page.getByRole("table").getByRole("row").filter({ hasText: "Temple test shop" })).toHaveCount(0);
    await expect(page.getByRole("table").locator(".shop-name")).toHaveCount(EXAMPLES);
    await page.reload();
    await expect(page.getByRole("table").locator(".shop-name")).toHaveCount(EXAMPLES);
  });

  test("a shop CSV with a row that matches no node: the preview lists it to fix, and only the good rows are saved", async ({ page }) => {
    await page.goto("/shops");
    await expect(page.getByRole("table").locator(".shop-name").first()).toBeVisible();
    const before = await page.getByRole("table").locator(".shop-name").count();
    const card = page.getByRole("region", { name: "Import shop list" });
    const csv = "name,lon,lat\nOmaha test shop,-95.94,41.26\nDenver test shop,-104.99,39.74\nShop in the sea,-140,10\n";
    await card.getByLabel("Choose CSV file").setInputFiles({ name: "test-shops.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });

    const preview = card.getByRole("region", { name: "Import preview" });
    await expect(preview).toContainText("test-shops.csv · 2 ready · 1 not saved");
    await expect(preview.getByRole("list", { name: "Rows to fix before saving" })).toHaveText("Line 4: No track near -140, 10.");
    // A preview saves nothing.
    await expect(page.getByRole("table").getByRole("row").filter({ hasText: "Omaha test shop" })).toHaveCount(0);

    await preview.getByRole("button", { name: "Save 2 shops" }).click();
    await expect(card.getByText("Saved 2 shops.")).toBeVisible();
    const table = page.getByRole("table");
    await expect(table.getByRole("row").filter({ hasText: "Omaha test shop" })).toBeVisible();
    await expect(table.getByRole("row").filter({ hasText: "Denver test shop" })).toBeVisible();
    await expect(table.getByRole("row").filter({ hasText: "Shop in the sea" })).toHaveCount(0);

    await expect(table.locator(".shop-name")).toHaveCount(before + 2);

    // Imported shops are ordinary shops, deleted the same way.
    for (const name of ["Omaha test shop", "Denver test shop"]) {
      await page.getByRole("button", { name: `Edit ${name}` }).click();
      await page.getByRole("button", { name: "Delete" }).click();
      await page.getByRole("group", { name: "Delete this shop?" }).getByRole("button", { name: "Delete" }).click();
      await expect(table.getByRole("row").filter({ hasText: name })).toHaveCount(0);
    }
    await expect(table.locator(".shop-name")).toHaveCount(before);
  });

  test("a shop wired to its own track: Sarnia's suggestion follows the plant's lead to the main line, a route arrives over it, a second link makes it through", async ({ page }) => {
    // Procor's Sarnia plant: its yard fans out north of the CN main line and joins it at the east end (FRA 628925).
    const at = { lon: -82.3376, lat: 42.9596 };
    const made = await page.request.post("/api/shops", { data: { name: "Sarnia test plant", code: "TEST-SAR", location: { kind: "coord", ...at }, links: [] } });
    const shop = (await made.json()) as ShopView;
    await page.goto(`/shops/${shop.id}`);
    const links = page.getByRole("group", { name: "Track links" });
    await expect(links).toContainText("Sarnia · FRA 628925");
    await expect(links).toContainText("0.5 km");
    await expect(links).toContainText("Suggested");
    await expect(links).toContainText("No links: joins the nearest mainline.");
    await links.getByRole("button", { name: "Use" }).click();
    await expect(links).toContainText("One link: cars leave the way they came in.");
    await page.getByRole("region", { name: "Edit shop" }).getByRole("button", { name: "Save shop" }).click();
    await expect(page).toHaveURL(/\/shops$/);

    await page.getByRole("navigation", { name: "Mode" }).getByRole("link", { name: "Route" }).click();
    const planned = await planRoute(page, "-79.7195, 43.4169", "TEST-SAR");
    expect(planned.outcome).toBe("routed");
    const end = planned.outcome === "routed" ? planned.routes[0].legs.at(-1)!.path.slice(-2) : [];
    expect(end).toEqual([[-82.33578, 42.95513], [at.lon, at.lat]]);

    // The west link: track also runs off the plant's west side. A click beside it there takes the main line's node, FRA 628886.
    await page.goto(`/shops/${shop.id}`);
    await links.getByRole("button", { name: "Add link" }).click();
    const west = await mapPoint(page, at, { lon: -82.3445, lat: 42.9562 });
    await page.mouse.click(west.x, west.y);
    await expect(links).toContainText("Two links: cars can pass through.");
    await expect(links).toContainText("Sarnia · FRA 628886");
    await expect(links).toContainText("0.8 km");
    await keepScreenshot(page, "shop-links");
    await page.getByRole("region", { name: "Edit shop" }).getByRole("button", { name: "Save shop" }).click();
    await expect(page).toHaveURL(/\/shops$/);
    const saved = ((await (await page.request.get("/api/shops")).json()) as ShopView[]).find((s) => s.id === shop.id)!;
    expect(saved.links).toEqual([628925, 628886]);
    expect((await page.request.delete(`/api/shops/${shop.id}`)).ok()).toBe(true);
  });
});

/** Where a point is on screen while the shop at `centre` is being edited: the camera holds it in the free map's middle at SHOP_ZOOM. */
async function mapPoint(page: Page, centre: { lon: number; lat: number }, point: { lon: number; lat: number }): Promise<{ x: number; y: number }> {
  const middle = await freeMapCentre(page);
  const world = 512 * 2 ** SHOP_ZOOM;
  const mercator = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  return { x: middle.x + ((point.lon - centre.lon) * world) / 360, y: middle.y - ((mercator(point.lat) - mercator(centre.lat)) * world) / (2 * Math.PI) };
}
