import { statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { preview, type PreviewServer } from "vite";
import { saveShot } from "./shots.ts";

// Served by Vite's preview server rather than node:http: only server/http/serve.ts may speak HTTP directly.
const FIXTURE = fileURLToPath(new URL("./fixtures/smoke/", import.meta.url));

let server: PreviewServer;
let url: string;

test.beforeAll(async () => {
  server = await preview({
    configFile: false,
    root: FIXTURE,
    logLevel: "silent",
    build: { outDir: FIXTURE },
    preview: { host: "127.0.0.1", port: 0, strictPort: false, open: false },
  });
  const local = server.resolvedUrls?.local[0];
  if (!local) throw new Error("preview server did not report a URL");
  url = local;
});

test.afterAll(async () => {
  await server?.close();
});

test("the browser opens a page, clicks a button and saves a screenshot", async ({ page }) => {
  await page.goto(url);
  await expect(page.getByRole("heading", { name: "Harness check" })).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("Not checked yet");

  await page.getByRole("button", { name: "Check" }).click();
  await expect(page.getByRole("status")).toHaveText("Browser works");

  const path = await saveShot(page, "harness-smoke");
  expect(statSync(path).size).toBeGreaterThan(0);
});
