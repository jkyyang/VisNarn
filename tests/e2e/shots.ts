import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";

/** Screenshots we keep, unlike Playwright's outputDir, which it empties on every run. */
export const SHOTS_DIR = fileURLToPath(new URL("../../docs/screenshots/", import.meta.url));

export async function saveShot(page: Page, name: string): Promise<string> {
  mkdirSync(SHOTS_DIR, { recursive: true });
  const path = join(SHOTS_DIR, `${name}.png`);
  await page.screenshot({ path, fullPage: true });
  return path;
}
