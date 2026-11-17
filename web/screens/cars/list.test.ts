import { describe, expect, it } from "vitest";
import type { CarSummary } from "../../../shared/cars.ts";
import type { TriageGroup } from "../../../shared/route.ts";
import { groupCars, neighbour } from "./list.ts";

const car = (row: number, group: TriageGroup | null, shop = "Kansas City, MO"): CarSummary => ({
  row,
  carId: `C${row}`,
  shop,
  shopExample: false,
  fixed: false,
  check: group === null ? { outcome: "pending" } : { outcome: "cannot-check", problems: [{ field: "b", message: "x" }] },
  group,
});

const CARS = [car(4, "act-now"), car(1, "act-now", "Birmingham, AL"), car(0, "check-first"), car(3, "ok", "Calgary, AB"), car(5, "ok"), car(2, null)];

describe("morning list", () => {
  it("splits cars by the group the server gave them and counts every group before filtering", () => {
    const groups = groupCars(CARS, { hide: ["ok"], shop: "Kansas City, MO" });
    expect(groups.counts).toEqual({ "act-now": 2, "check-first": 1, ok: 2 });
    expect(groups.groups["act-now"].map((c) => c.row)).toEqual([4]);
    expect(groups.groups.ok).toEqual([]);
  });

  it("hides switched-off groups and other shops' cars; pending cars are counted apart", () => {
    const groups = groupCars(CARS, { hide: [], shop: null });
    expect(groups.pending).toBe(1);
    expect([...groups.groups["act-now"], ...groups.groups["check-first"], ...groups.groups.ok].map((c) => c.row)).toEqual([4, 1, 0, 3, 5]);
    expect(groups.shops).toEqual([
      { name: "Birmingham, AL", count: 1 },
      { name: "Calgary, AB", count: 1 },
      { name: "Kansas City, MO", count: 4 },
    ]);
  });

  it("neighbour walks the visible rows in order and stops at both ends", () => {
    const groups = groupCars(CARS, { hide: ["check-first"], shop: null });
    expect(neighbour(groups, null, 1)).toBe(4);
    expect(neighbour(groups, 4, 1)).toBe(1);
    expect(neighbour(groups, 1, 1)).toBe(3);
    expect(neighbour(groups, 5, 1)).toBeNull();
    expect(neighbour(groups, 4, -1)).toBeNull();
    expect(neighbour(groups, 0, 1)).toBe(4);
  });
});
