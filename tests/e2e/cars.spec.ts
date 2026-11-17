/**
 * The Cars screen (the morning list) in a real browser: a CSV is uploaded through the dialog, the
 * server checks every row, and the list is walked with the keyboard and copied for the shops.
 *
 * The fixture is the six EXAMPLE cars with fixed times and one row whose time cannot be read, so the
 * groups are the same on every run: positions are judged "as of" 2026-11-17 01:00 Chicago time.
 */
import { fileURLToPath } from "node:url";
import { expectMapCanvases, keepScreenshot, test, expect } from "./app.ts";

const CSV = fileURLToPath(new URL("./fixtures/EXAMPLE cars-e2e.csv", import.meta.url));

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

test("Cars: upload the EXAMPLE CSV, see the groups and counts, walk the list with the keys, copy the at-risk list", async ({ page }) => {
  // Map tiles and fonts come from public servers; car rows must only ever go to this laptop's server.
  const outside: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.protocol.startsWith("http") && url.hostname !== "127.0.0.1") outside.push(`${request.method()} ${request.url()} ${request.postData() ?? ""}`);
  });

  await page.goto("/cars");
  await page.getByRole("button", { name: "Upload batch" }).click();
  const dialog = page.getByRole("dialog", { name: "Upload batch" });
  await dialog.getByLabel("CSV file").setInputFiles(CSV);
  await expect(dialog).toContainText("7 data rows in EXAMPLE cars-e2e.csv");
  await dialog.getByLabel("Batch name").fill("EXAMPLE morning list (e2e)");
  await dialog.getByLabel("Positions as of").fill("2026-11-17T01:00");
  await dialog.getByRole("button", { name: "Upload and check" }).click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/cars\/[^/?]+$/);

  await expect(page.getByRole("heading", { name: "Morning list · Tue Nov 17", level: 1 })).toBeVisible();
  const summary = page.getByRole("status").filter({ hasText: "rows read" });
  await expect(summary).toContainText("7 rows read · 1 need fixing · reports 0 days old");
  await expect(summary).toContainText("Rough estimate");

  const chips = page.getByRole("group", { name: "Filter by group" }).getByRole("button");
  await expect(chips).toHaveText(["Act now 2", "Check first 3", "OK 2"]);
  const ids = (group: string) => page.getByRole("region", { name: group }).locator(".car-id");
  await expect(ids("Act now")).toHaveText(["EXAMPLE 551930", "EXAMPLE 402196"]);
  await expect(ids("Check first")).toHaveText(["EXAMPLE 700001", "EXAMPLE 104233", "EXAMPLE 318045"]);
  const okFold = page.getByRole("region", { name: "OK" }).getByRole("button", { name: /^OK · 2/ });
  await expect(okFold).toHaveAttribute("aria-expanded", "false");

  // Word + shape for every status; a row the import could not read is "Cannot check", never OK.
  const unreadable = page.getByRole("link", { name: /EXAMPLE 700001/ });
  await expect(unreadable).toContainText("Cannot check");
  await expect(unreadable.locator("svg.shape")).toHaveCount(1);
  const turnsBack = page.getByRole("link", { name: /EXAMPLE 318045/ });
  await expect(turnsBack).toContainText("Check route");
  await expect(turnsBack).not.toContainText("On time");
  await expect(page.getByRole("region", { name: "Act now" }).getByText("At risk")).toHaveCount(2);

  // The most urgent car is selected first, with its card over the map, and the map says what its marks are.
  await expect(page.getByRole("region", { name: "Selected car EXAMPLE 551930" })).toContainText("Prep may end too late");
  await expect(page.locator("section.map .map-chip")).toContainText("Cars drawn at their next node (B), from the report · not live tracking");
  await expect(page.getByRole("link", { name: /EXAMPLE 551930/ })).toContainText("Kansas City, MO EXAMPLE");
  await expectMapCanvases(page);
  await keepScreenshot(page, "cars");

  await page.keyboard.press("ArrowDown");
  const second = page.getByRole("link", { name: /EXAMPLE 402196/ });
  await expect(second).toHaveAttribute("aria-current", "true");
  await expect(second).toBeFocused();
  await expect(page.getByRole("region", { name: "Selected car EXAMPLE 402196" })).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await expect(unreadable).toHaveAttribute("aria-current", "true");
  await expect(page.getByRole("region", { name: "Selected car EXAMPLE 700001" })).toContainText("Cannot check");
  await page.keyboard.press("ArrowUp");
  await expect(second).toHaveAttribute("aria-current", "true");

  await page.keyboard.press("c");
  const note = page.getByRole("status").filter({ hasText: "Copied:" });
  await expect(note).toContainText("Copied: EXAMPLE 402196 → Birmingham, AL:");
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toMatch(/^EXAMPLE 402196 → Birmingham, AL: .*\(rough estimate\)$/);

  await page.getByRole("button", { name: "Copy at-risk list" }).click();
  const copied = page.locator(".copied pre");
  await expect(page.getByRole("status").filter({ hasText: /^Copied$/ })).toBeVisible();
  await expect(copied).toContainText("At-risk cars, Tue Nov 17 (rough estimate, EXAMPLE)");
  const text = (await copied.textContent()) ?? "";
  // The server's first-start shops are EXAMPLE locations, and the list for the shop planner says so.
  expect(text).toMatch(/^Kansas City, MO \(EXAMPLE shop\)\n {2}EXAMPLE 551930 {2}can arrive ~14 h before prep ends$/m);
  expect(text).toMatch(/^Birmingham, AL \(EXAMPLE shop\)\n {2}EXAMPLE 402196 {2}can arrive ~13 h before prep ends$/m);
  expect(text).toContain("also check route:");
  expect(text).toMatch(/^Assumes 400 km\/day placeholder/m);
  for (const notAtRisk of ["104233", "318045", "700001", "663012", "220871"]) expect(text).not.toContain(notAtRisk);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(text);

  // Focus is on the copy button now, where Enter presses the button; the arrows bring it back to the list.
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowUp");
  await expect(second).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/route\/[^/]+\/\d+$/);
  await expect(page.getByRole("form", { name: "Car position and shop" }).getByRole("textbox", { name: "Car" })).toHaveValue("EXAMPLE 402196");
  await expect(page.getByRole("region", { name: "Verdict" })).toContainText("At risk");

  await page.goBack();
  await expect(page.getByRole("link", { name: /EXAMPLE 402196/ })).toHaveAttribute("aria-current", "true");
  await page.keyboard.press("f");
  await expect(page).toHaveURL(/\/route\/[^/]+\/\d+\/fix$/);
  await expect(page.getByText(/^EXAMPLE 402196 · /)).toBeVisible();

  expect(outside.length).toBeGreaterThan(0);
  for (const request of outside) {
    expect(request).toMatch(/^GET /);
    expect(request).not.toMatch(/EXAMPLE|104233|402196|551930|Fargo|Savannah|Taylor|cars-e2e/i);
  }
});
