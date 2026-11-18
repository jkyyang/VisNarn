import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";

/**
 * Not 5173: a copy of the app a person is already running there may hold real data, and the tests
 * add, change and delete shops and saved routes. reuseExistingServer stays off for the same reason.
 */
const PORT = Number(process.env.VISNARN_E2E_PORT ?? 8797);

/** A throwaway database, wiped before each start, so every run begins from the EXAMPLE rows only. */
const E2E_DATA_DIR = join(tmpdir(), "visnarn-e2e-data");

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
  use: {
    // The installed Google Chrome; no Playwright browser download.
    channel: "chrome",
    headless: true,
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1440, height: 900 },
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
    url: `http://127.0.0.1:${PORT}/api/meta`,
    reuseExistingServer: false,
    timeout: 180_000,
    // SIGTERM lets the server close the database and its routing workers before it exits.
    gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
    env: { VISNARN_PORT: String(PORT), VISNARN_DATA_DIR: E2E_DATA_DIR },
  },
});
