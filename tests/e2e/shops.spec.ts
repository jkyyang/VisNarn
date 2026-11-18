/**
 * The Shops screen in a real browser against the real server: shops are user data, added, changed
 * and deleted here, and imported from a CSV whose bad rows are listed instead of saved.
 * The EXAMPLE shops are left as they were added (./app.ts), for the other screens' tests.
 */
import { expectMapCanvases, keepScreenshot, test, expect } from "./app.ts";
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
    await expect(form).toContainText(/On the network · BNSF/);
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
});
