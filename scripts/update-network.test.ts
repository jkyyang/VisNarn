import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { kmChanges, parseShops, sourceChanged, sourceDateOf, validate } from "./update-network.ts";

describe("change detection", () => {
  it("reads the data edit date the ArcGIS layer reports", () => {
    expect(sourceDateOf({ editingInfo: { dataLastEditDate: 1792540079731 } })).toBe("2026-10-20T23:47:59.731Z");
    expect(() => sourceDateOf({})).toThrow(/dataLastEditDate/);
  });

  it("is up to date only when the recorded source date is the same", () => {
    const recorded = { sourceDate: "2026-10-19T23:47:59.731Z", network: "abc" };
    expect(sourceChanged(recorded, "2026-10-19T23:47:59.731Z")).toBe(false);
    expect(sourceChanged(recorded, "2027-01-05T10:00:00.000Z")).toBe(true);
    expect(sourceChanged(null, "2026-10-19T23:47:59.731Z")).toBe(true);
  });
});

describe("km change report", () => {
  const route = (name: string, km: number | null) => ({ route: name, km, problem: null });

  it("lists routes that changed by more than the limit, either way", () => {
    const before = [route("A", 100), route("B", 100), route("C", 100)];
    const after = [route("A", 105), route("B", 106), route("C", 90)];
    expect(kmChanges(before, after, 0.05)).toEqual(["B: 100 → 106 km (+6.0%)", "C: 100 → 90 km (-10.0%)"]);
  });

  it("skips routes missing on either side", () => {
    expect(kmChanges([route("A", null)], [route("A", 200), route("B", 300)], 0.05)).toEqual([]);
  });
});

describe("shops file", () => {
  it("reads quoted names with commas, coordinates, and shops given by FRA node only", () => {
    const csv = 'name,code,lon,lat,fra_id,source\n"Sarnia, ON · Procor",X,-82.3,42.9,,"a, b"\n"Ville Platte, LA",Y,,,386145,c\n';
    expect(parseShops(csv)).toEqual([
      { name: "Sarnia, ON · Procor", lon: -82.3, lat: 42.9, fraId: null },
      { name: "Ville Platte, LA", lon: null, lat: null, fraId: 386145 },
    ]);
  });
});

describe("validation", () => {
  it("rejects a build whose graph does not load", async () => {
    const dir = mkdtempSync(join(tmpdir(), "broken-network-"));
    writeFileSync(join(dir, "graph.bin"), Buffer.alloc(16));
    writeFileSync(join(dir, "graph_meta.json"), '{"railroads":[]}');
    const { problems } = await validate(dir);
    expect(problems).toHaveLength(1);
  });
});
