/** The network as the server sees it: nodes by FRA id, coordinates, public city names. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { FraId } from "../shared/places.ts";
import { DEFAULT_NETWORK_DIR, loadNetwork } from "./load.ts";
import type { RailNetwork } from "./network.ts";

let network: RailNetwork;
beforeAll(() => {
  network = loadNetwork();
});

describe("loadNetwork", () => {
  it("names the build by its bytes: loading twice gives the same version", () => {
    expect(network.version).toMatch(/^[0-9a-f]{12}$/);
    expect(loadNetwork(DEFAULT_NETWORK_DIR).version).toBe(network.version);
  });
  it("says how to build the files when they are missing", () => {
    const empty = mkdtempSync(join(tmpdir(), "visnarn-net-"));
    try {
      expect(() => loadNetwork(empty)).toThrow(/npm run data/);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});

describe("RailNetwork", () => {
  it("finds a node by FRA id with its railroads and place, and nothing for an id it does not have", () => {
    const temple = network.city("Temple, TX")!;
    const near = network.nearest(temple.lon, temple.lat, 5, "track")!;
    expect(near.km).toBeLessThan(5);
    const node = network.node(near.fraId)!;
    expect(node).toEqual({ ...near, km: 0 });
    expect(node.near).toBe("Temple, TX");
    expect(node.railroads.length).toBeGreaterThan(0);
    expect(Math.round(node.lon * 1e5) / 1e5).toBe(node.lon);
    expect(network.node(1 as FraId)).toBeNull();
  });

  it("nearest is null when no track is within the distance asked", () => {
    expect(network.nearest(-140, 30, 50, "track")).toBeNull();
  });

  it("snaps coordinates to every railroad with mainline within 15 km, or says none", () => {
    const fortWorth = network.city("Fort Worth, TX")!;
    const snap = network.snap(fortWorth.lon, fortWorth.lat)!;
    expect(snap.railroads).toEqual(expect.arrayContaining(["BNSF", "UP"]));
    expect(snap.km).toBeLessThan(15);
    expect(network.snap(-116.5, 40.0)).toBeNull();
  });

  it("leaves out a railroad whose mainline is much farther than the nearest one", () => {
    // Oakville, ON: CN track 1 km away, CPKC only in Mississauga 14 km away. A route must not end on CPKC there.
    const snap = network.snap(-79.687, 43.467)!;
    expect(snap.railroads).toEqual(["CN"]);
    expect(snap.km).toBeLessThan(2);
  });

  it("matches city names without regard to case, and suggests those starting with the text first", () => {
    expect(network.city("  temple, tx ")?.name).toBe("Temple, TX");
    expect(network.city("Temple")).toBeNull();
    const names = network.cities("little", 5).map((c) => c.name);
    expect(names).toContain("Little Rock, AR");
    expect(names).toContain("North Little Rock, AR");
    expect(names.indexOf("Little Rock, AR")).toBeLessThan(names.indexOf("North Little Rock, AR"));
    expect(network.cities("a", 3)).toHaveLength(3);
  });

  it("describes a place by the nearest city, or the distance to it beyond 25 km", () => {
    const temple = network.city("Temple, TX")!;
    expect(network.near(temple.lon, temple.lat)).toBe("Temple, TX");
    expect(network.near(temple.lon + 1, temple.lat)).toMatch(/^\d+ km from /);
  });
});

describe("wayIn", () => {
  it("follows a plant's yard track to where it meets the main line, and keeps a point already on a line where it is", () => {
    expect(network.wayIn(-82.3376, 42.9596)).toMatchObject({ fraId: 628925, railroads: ["CN", "CPKC"] });
    expect(network.wayIn(-82.3405, 42.9568)?.fraId).toBe(628925);
    expect(network.wayIn(-79.7195, 43.4169)?.fraId).toBe(633683);
    const main = network.node(628912 as FraId)!;
    expect(network.wayIn(main.lon, main.lat)).toMatchObject({ fraId: 628912, km: expect.closeTo(0, 2) });
    expect(network.wayIn(-60, 40)).toBeNull();
  });

  it("nearest on mainline passes over yard track: beside the plant it takes the main line's node, where a link joins", () => {
    expect(network.nearest(-82.3452, 42.9556, 5, "track")).toMatchObject({ fraId: 628887, yard: true });
    expect(network.nearest(-82.3452, 42.9556, 5, "mainline")).toMatchObject({ fraId: 628886, railroads: ["CN", "CPKC"] });
  });
});
