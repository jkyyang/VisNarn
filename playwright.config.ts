import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

/**
 * Port 8797: a person's own copy of the app on 5173 may hold real data, and the tests add, change and
 * delete shops and saved routes. reuseExistingServer stays off for the same reason.
 */
const PORT = Number(process.env.VISNARN_E2E_PORT ?? 8797);

/** A throwaway database per port, wiped before each start; the tests add the EXAMPLE shops they start from (./tests/e2e/app.ts). */
const E2E_DATA_DIR = join(tmpdir(), `visnarn-e2e-data-${PORT}`);

export default defineConfig({
  testDir: "tests/e2e",
  outputDir: "test-results/e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // One app, one database: tests run one after another.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  reporter: [["list"]],
  /**
   * A laptop in the installed Google Chrome (no Playwright browser download) runs every screen; the phone held
   * upright (phone.spec.ts) runs on an iPhone in WebKit, Safari's engine, and on an Android phone in Chrome.
   */
  projects: [
    { name: "chrome", testIgnore: /phone\.spec\.ts/, use: { channel: "chrome", viewport: { width: 1440, height: 900 } } },
    { name: "iphone", testMatch: /phone\.spec\.ts/, use: { ...devices["iPhone 15 Pro"] } },
    { name: "android", testMatch: /phone\.spec\.ts/, use: { ...devices["Pixel 7"], channel: "chrome" } },
  ],
  use: {
    headless: true,
    baseURL: `http://127.0.0.1:${PORT}`,
    // Fixed so dates typed into the page and shown back are the same on any laptop.
    timezoneId: "America/Chicago",
    locale: "en-US",
    // The map then jumps instead of flying, so the camera is where the screen asked for it at once.
    reducedMotion: "reduce",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    // A headless launch once hung on this Mac: fail fast instead of waiting the default 3 minutes.
    launchOptions: { timeout: 30_000 },
  },
  webServer: {
    // The same command a person runs: build the page, then serve it and the API from one process.
    command: `node -e "require('node:fs').rmSync(process.argv[1], { recursive: true, force: true })" "${E2E_DATA_DIR}" && npm start`,
    url: `http://127.0.0.1:${PORT}/api/shops`,
    reuseExistingServer: false,
    timeout: 180_000,
    // SIGTERM lets the server close the database and its routing workers before it exits.
    gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
    env: { VISNARN_PORT: String(PORT), VISNARN_DATA_DIR: E2E_DATA_DIR },
  },
});
