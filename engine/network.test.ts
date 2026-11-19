/** The network as the server sees it: nodes by FRA id, coordinates, public city names. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { haversineKm, pathKm, type LngLat } from "../shared/geo.ts";
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
    const near = network.nearest(temple.lon, temple.lat, 5)!;
    expect(near.km).toBeLessThan(5);
    const node = network.node(near.fraId)!;
    expect(node).toEqual({ ...near, km: 0 });
    expect(node.near).toBe("Temple, TX");
    expect(node.railroads.length).toBeGreaterThan(0);
    expect(Math.round(node.lon * 1e5) / 1e5).toBe(node.lon);
    expect(network.node(1 as FraId)).toBeNull();
  });

  it("nearest is null when no track is within the distance asked", () => {
    expect(network.nearest(-140, 30, 50)).toBeNull();
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

  it("refines a rough spot anywhere on a plant's track to where its lead meets the main line, and keeps one on the main line there", () => {
    // Procor's Oakville plant: the fan, the lead half way, and 23 m from 633683 where the lead meets the CN line.
    for (const [lon, lat] of [[-79.7193, 43.4186], [-79.7183, 43.4203], [-79.7166, 43.4221]]) expect(network.wayIn(lon, lat)?.fraId, `${lon}, ${lat}`).toBe(633683);
    // On the main line beside the plant, next to 633676.
    expect(network.wayIn(-79.7176, 43.4212)?.fraId).toBe(633676);
  });

  it("refines a spot away from any track to the way in nearest it", () => {
    // A field 2.8 km north of the Sarnia plant: the plant's lead to the main line.
    expect(network.wayIn(-82.3376, 42.986)?.fraId).toBe(628925);
  });
});

describe("lead: a shop's own track to the node a link joins", () => {
  const OAKVILLE = { lon: -79.72024, lat: 43.41766 };
  const kmTo = (at: { lon: number; lat: number }, fraId: number) => {
    const node = network.node(fraId as FraId)!;
    return haversineKm(at.lon, at.lat, node.lon, node.lat);
  };
  const nodeAt = (point: LngLat) => network.nearest(point[0], point[1], 0.001);

  it("Oakville to 633683: straight to the plant's yard, then node by node along it, a little longer than the straight line", () => {
    const lead = network.lead(OAKVILLE.lon, OAKVILLE.lat, 633683 as FraId)!;
    expect(lead.path.length).toBeGreaterThan(2);
    expect(lead.path[0]).toEqual([OAKVILLE.lon, OAKVILLE.lat]);
    expect(nodeAt(lead.path.at(-1)!)?.fraId).toBe(633683);
    // Each step after the first is one yard segment: its two ends are nodes, and the piece is no longer than the drawn km.
    const nodes = lead.path.slice(1).map((point) => nodeAt(point)!);
    expect(nodes.every((node) => node.yard)).toBe(true);
    expect(pathKm(lead.path.slice(1))).toBeLessThanOrEqual(lead.km);
    expect(lead.km).toBeCloseTo(0.609, 2);
    expect(lead.km).toBeGreaterThanOrEqual(kmTo(OAKVILLE, 633683));
  });

  it("Oakville to 633676, on the main line with no yard between: the straight line", () => {
    const lead = network.lead(OAKVILLE.lon, OAKVILLE.lat, 633676 as FraId)!;
    expect(lead.path).toHaveLength(2);
    // Node coordinates leave graph.bin rounded to about a metre.
    expect(Math.abs(lead.km - kmTo(OAKVILLE, 633676))).toBeLessThan(0.001);
    expect(lead.km).toBeCloseTo(0.445, 2);
  });

  it("Sarnia's seeded pin to 628925 and Edmonton to 612042: off the track to the yard, then the rest of the way on it", () => {
    const sarnia = network.lead(-82.3376, 42.9596, 628925 as FraId)!;
    expect(haversineKm(...sarnia.path[0], ...sarnia.path[1])).toBeCloseTo(0.339, 2);
    expect(sarnia.km).toBeCloseTo(1.294, 2);
    expect(network.lead(-113.3956, 53.5308, 612042 as FraId)!.km).toBeCloseTo(1.053, 2);
  });

  it("is the straight line to a node over 5 km away, the same every time, and null for an unknown node", () => {
    const far = network.lead(-82.3376, 42.9596, 633683 as FraId)!;
    expect(far.path).toHaveLength(2);
    expect(Math.abs(far.km - kmTo({ lon: -82.3376, lat: 42.9596 }, 633683))).toBeLessThan(0.001);
    expect(network.lead(OAKVILLE.lon, OAKVILLE.lat, 633683 as FraId)).toEqual(network.lead(OAKVILLE.lon, OAKVILLE.lat, 633683 as FraId));
    expect(network.lead(OAKVILLE.lon, OAKVILLE.lat, 1 as FraId)).toBeNull();
  });
});
