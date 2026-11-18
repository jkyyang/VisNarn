import { describe, expect, it } from "vitest";
import { AppError } from "../../shared/app.ts";
import { SHOP_TEXT_MAX } from "../../shared/places.ts";
import { exampleShops } from "./example.ts";
import { readShops } from "./intake.ts";

const csv = (text: string, fileName = "shops.csv") => ({ kind: "csv" as const, fileName, text });

function refusal(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof AppError) return `${error.kind}: ${error.message}`;
    throw error;
  }
  return "accepted";
}

describe("parseCsv (through the intake door)", () => {
  it("keeps a line break inside a quoted cell, which a shop name then may not hold (as in the shop form)", () => {
    const { items, issues } = readShops(csv(`name,lon,lat\n"EXAMPLE Taylor,\nTX",-97.41,30.57\n`));
    expect(items[0].name).toBe("EXAMPLE Taylor,\nTX");
    expect(issues.map((i) => i.message)).toEqual(["The shop name holds control or invisible characters."]);
  });

  it("reads quotes, doubled quotes, CRLF and a UTF-8 BOM; skips blank lines; reports file line numbers", () => {
    const text = `\ufeffname,lon,lat\r\n"EXAMPLE ""1""",-97.41,\r\n\r\n"EXAMPLE 2",,30.57\r\n`;
    const { items, issues } = readShops(csv(text));
    expect(items.map((i) => i.name)).toEqual(['EXAMPLE "1"', "EXAMPLE 2"]);
    expect(issues.map((i) => [i.row, i.line])).toEqual([
      [0, 2],
      [1, 4],
    ]);
  });
});

describe("readShops", () => {
  it("accepts name, code, lon, lat", () => {
    const byCoords = readShops(csv("name,code,lon,lat\nEXAMPLE North,EX-N,−92.27,34.77\nEXAMPLE bad,EX-B,abc,34\n,EX-C,-90,30\n"));
    expect(byCoords.items[0]).toEqual({ name: "EXAMPLE North", code: "EX-N", location: { kind: "coord", lon: -92.27, lat: 34.77 } });
    expect(byCoords.issues.map((i) => [i.row, i.line])).toEqual([
      [1, 3],
      [2, 4],
    ]);
    expect(byCoords.lines).toEqual([2, 3, 4]);
    expect(refusal(() => readShops(csv("name,city\nA,B\n", "shops.csv")))).toMatch(/^invalid: shops\.csv has no location columns/);
    expect(refusal(() => readShops(csv("shop,lon,lat\nA,1,2\n", "shops.csv")))).toMatch(/^invalid: shops\.csv has no column "name"/);
  });

  it("holds shop names and codes to the shop form's length limit", () => {
    const long = "n".repeat(SHOP_TEXT_MAX + 1);
    const ok = "n".repeat(SHOP_TEXT_MAX);
    const { issues } = readShops(csv(`name,code,lon,lat\n${long},EX-A,-90.2,38.6\nEXAMPLE B,${long},-90.2,38.6\n${ok},${ok},-90.2,38.6\n`));
    expect(issues.map((i) => [i.row, i.message])).toEqual([
      [0, `The shop name is longer than ${SHOP_TEXT_MAX} characters.`],
      [1, `The shop code is longer than ${SHOP_TEXT_MAX} characters.`],
    ]);
  });

  it("reports a shop name or code with control or invisible characters instead of storing a cut value", () => {
    const { issues } = readShops(csv("name,code,lon,lat\nZZ\u0000N,EX-A,-96.5,39.1\nEXAMPLE B,EX\u200bB,-96.5,39.1\nEXAMPLE C,EX-C,-96.5,39.1\n"));
    expect(issues.map((i) => [i.row, i.message])).toEqual([
      [0, "The shop name holds control or invisible characters."],
      [1, "The shop code holds control or invisible characters."],
    ]);
  });

  it("reads fra_id first, then lon and lat, and lists a row with neither", () => {
    const { items, issues } = readShops(csv("name,fra_id,lon,lat\nEXAMPLE Temple,358070,,\nEXAMPLE Waco,,-97.3,31.1\nEXAMPLE Nowhere,,,\nEXAMPLE Bad,12a,,\n"));
    expect(items.slice(0, 2).map((shop) => shop.location)).toEqual([
      { kind: "node", fraId: 358070, railroad: null },
      { kind: "coord", lon: -97.3, lat: 31.1 },
    ]);
    expect(issues.map((i) => [i.line, i.message])).toEqual([
      [4, expect.stringMatching(/fra_id, or lon and lat/)],
      [5, expect.stringMatching(/"12a" must be a whole number/)],
    ]);
  });
});

describe("EXAMPLE data", () => {
  it("six EXAMPLE shops with EX- codes", () => {
    expect(exampleShops().map((s) => s.code)).toEqual(["EX-NLR-01", "EX-KCY-01", "EX-BHM-01", "EX-CHI-01", "EX-CAL-01", "EX-NPL-01"]);
  });
});
