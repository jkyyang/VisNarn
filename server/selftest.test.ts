/** Boots the real entry point under plain Node, which refuses syntax that vitest's esbuild lets through. */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

describe("node server/main.ts --selftest", () => {
  it("loads the network, starts one routing worker, routes the EXAMPLE car and exits 0", () => {
    const run = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", "server/main.ts", "--selftest"], {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 60_000,
      env: { ...process.env, VISNARN_DATA_DIR: "" },
    });
    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
    expect(run.stdout).toMatch(/^selftest ok: network [0-9a-f]{12}; EXAMPLE car .* routed in a worker thread: \d+ km on /);
  }, 60_000);

  it("refuses an unknown option with a plain message and exit code 1", () => {
    const run = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", "server/main.ts", "--selftst"], { cwd: ROOT, encoding: "utf8", timeout: 30_000 });
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/could not start: Unknown option "--selftst"/);
  }, 30_000);
});
