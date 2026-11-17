import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_NETWORK_DIR } from "../engine/index.ts";
import { readConfig, selfTestRequested } from "./config.ts";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const HOME = { HOME: homedir() };

describe("readConfig", () => {
  it("defaults: port 8787, data in ~/.visnarn, two routing workers, API only", () => {
    expect(readConfig([], HOME)).toEqual({
      port: 8787,
      dataDir: join(homedir(), ".visnarn"),
      networkDir: DEFAULT_NETWORK_DIR,
      webDir: null,
      dev: false,
      routeWorkers: 2,
    });
  });

  it("reads the port, data folder and worker count from VISNARN_* variables, and the page mode from flags", () => {
    const data = join(tmpdir(), "visnarn-config-test");
    const config = readConfig(["--web", "dist"], { ...HOME, VISNARN_PORT: "0", VISNARN_DATA_DIR: data, VISNARN_ROUTE_WORKERS: "3" });
    expect(config).toMatchObject({ port: 0, dataDir: data, webDir: join(process.cwd(), "dist"), dev: false, routeWorkers: 3 });
    expect(readConfig(["--dev"], HOME).dev).toBe(true);
  });

  it("refuses bad numbers, unknown options, and --dev with --web, saying what to change", () => {
    expect(() => readConfig([], { ...HOME, VISNARN_PORT: "80a" })).toThrow(/VISNARN_PORT must be a whole number/);
    expect(() => readConfig([], { ...HOME, VISNARN_ROUTE_WORKERS: "0" })).toThrow(/VISNARN_ROUTE_WORKERS/);
    expect(() => readConfig(["--port", "1"], HOME)).toThrow(/Unknown option "--port"/);
    expect(() => readConfig(["--web"], HOME)).toThrow(/--web needs a folder/);
    expect(() => readConfig(["--dev", "--web", "dist"], HOME)).toThrow(/use one/);
  });

  it("keeps car data out of anything the browser can read: the repo (and so public/ and dist/) and the --web folder", () => {
    for (const inside of [join(ROOT, "public", "db"), join(ROOT, "dist"), ROOT, join(ROOT, ".visnarn")]) {
      expect(() => readConfig([], { ...HOME, VISNARN_DATA_DIR: inside })).toThrow(/VISNARN_DATA_DIR/);
    }
    const web = join(tmpdir(), "visnarn-web");
    expect(() => readConfig(["--web", web], { ...HOME, VISNARN_DATA_DIR: join(web, "data") })).toThrow(/inside/);
    expect(readConfig([], { ...HOME, VISNARN_DATA_DIR: `${ROOT.replace(/\/$/, "")}-data` }).dataDir).toBe(`${ROOT.replace(/\/$/, "")}-data`);
  });

  it("knows --selftest", () => {
    expect(readConfig(["--selftest"], HOME).port).toBe(8787);
    expect(selfTestRequested(["--selftest"])).toBe(true);
    expect(selfTestRequested([])).toBe(false);
  });
});
