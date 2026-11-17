import { describe, expect, it } from "vitest";
import { AppError } from "../../shared/app.ts";
import type { ImportProfile } from "../../shared/cars.ts";
import type { Instant } from "../../shared/time.ts";
import { exampleBatch, exampleShops } from "./example.ts";
import { openSource, readCars, readCodes, readShops, type RecordSource } from "./intake.ts";

const PROFILE: ImportProfile = {
  columns: { carId: "car_id", a: "last_node", b: "next_node", shop: "shop", reportedAt: "reported_at", prepEnd: "prep_end" },
  positions: "text",
  zonelessTimes: { zone: "America/Chicago" },
};
const csv = (text: string, fileName = "cars.csv") => openSource({ kind: "csv", fileName, text });
const HEADER = "car_id,last_node,next_node,reported_at,shop,prep_end";

async function refusal(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    if (error instanceof AppError) return `${error.kind}: ${error.message}`;
    throw error;
  }
  return "accepted";
}

describe("parseCsv (through the intake door)", () => {
  it("keeps a line break inside a quoted cell (the old parser could not round-trip its own output)", async () => {
    const { items, issues } = await readCars(csv(`${HEADER}\n"EXAMPLE 1","Taylor,\nTX",Temple TX,2026-11-17 09:00,EX-NLR-01,2026-11-19 00:00\n`), PROFILE);
    expect(issues).toEqual([]);
    expect(items[0].a).toEqual({ kind: "text", text: "Taylor,\nTX" });
  });

  it("reads quotes, doubled quotes, CRLF and a UTF-8 BOM; skips blank lines; reports file line numbers", async () => {
    const text = `﻿${HEADER}\r\n"EXAMPLE ""1""",A,B,2026-11-17 09:00,S,\r\n\r\n"EXAMPLE 2",A,B,,S,2026-11-19 00:00\r\n`;
    const { items, issues } = await readCars(csv(text), PROFILE);
    expect(items.map((i) => i.carId)).toEqual(['EXAMPLE "1"', "EXAMPLE 2"]);
    expect(issues.map((i) => [i.row, i.line, i.field])).toEqual([
      [0, 2, "prepEnd"],
      [1, 4, "reportedAt"],
    ]);
  });
});

describe("readCars", () => {
  it("maps the profile's column names, in any order and case", async () => {
    const profile: ImportProfile = {
      ...PROFILE,
      columns: { carId: "Car", a: "Last Node", b: "Next Node", shop: "Repair Shop", reportedAt: "Seen", prepEnd: "Ready" },
    };
    const { items, issues } = await readCars(csv("READY,repair shop,NEXT NODE,car,seen,last node\n2026-11-19 00:00Z,EX-NLR-01,Temple,104233,2026-11-17 15:00Z,Taylor\n"), profile);
    expect(issues).toEqual([]);
    expect(items).toEqual([
      {
        carId: "104233",
        a: { kind: "text", text: "Taylor" },
        b: { kind: "text", text: "Temple" },
        shop: { kind: "text", text: "EX-NLR-01" },
        stops: [],
        reportedAt: "2026-11-17T15:00:00.000Z",
        prepEnd: "2026-11-19T00:00:00.000Z",
      },
    ]);
  });

  it("names every missing column in one AppError(invalid)", async () => {
    const message = await refusal(() => readCars(csv("car_id,last_node,next_node\n1,A,B\n", "morning.csv"), PROFILE));
    expect(message).toMatch(/^invalid: morning\.csv has no columns "shop" \(shop\), "reported_at" \(report time\), "prep_end" \(prep end time\)\./);
    expect(message).toMatch(/import settings/);
  });

  it("positions: 'text' gives text refs; a code set gives code refs of that set", async () => {
    const text = `${HEADER}\n1,668240,668241,2026-11-17 09:00,EX-NLR-01,2026-11-19 00:00\n`;
    const asText = await readCars(csv(text), PROFILE);
    expect([asText.items[0].a, asText.items[0].b]).toEqual([
      { kind: "text", text: "668240" },
      { kind: "text", text: "668241" },
    ]);
    const asCodes = await readCars(csv(text), { ...PROFILE, positions: { codeType: "splc" } });
    expect([asCodes.items[0].a, asCodes.items[0].b]).toEqual([
      { kind: "code", codeType: "splc", code: "668240" },
      { kind: "code", codeType: "splc", code: "668241" },
    ]);
    // The shop is always free text: Your shops are found by name or code first.
    expect(asCodes.items[0].shop).toEqual({ kind: "text", text: "EX-NLR-01" });
  });

  it("a time with no zone follows the profile: read in its zone, or an issue 'line 7 has no time zone'", async () => {
    const rows = ["1,A,B,2026-11-17 09:00-06:00,S,2026-11-19 00:00Z", "2,A,B,2026-11-17 09:00,S,2026-11-19 00:00Z"];
    const text = `${HEADER}\n\n\n\n\n${rows.join("\n")}\n`;
    const chicago = await readCars(csv(text), PROFILE);
    expect(chicago.items.map((i) => i.reportedAt)).toEqual(["2026-11-17T15:00:00.000Z", "2026-11-17T15:00:00.000Z"]);
    expect(chicago.issues).toEqual([]);

    const strict = await readCars(csv(text), { ...PROFILE, zonelessTimes: "reject" });
    expect(strict.items.map((i) => i.reportedAt)).toEqual(["2026-11-17T15:00:00.000Z", null]);
    expect(strict.issues).toEqual([{ row: 1, line: 7, field: "reportedAt", message: expect.stringMatching(/"2026-11-17 09:00" has no time zone/) }]);
  });

  it("keeps a row it cannot fully read, with null times and an issue, so the list shows it as Cannot check", async () => {
    const { items, issues } = await readCars(csv(`${HEADER}\n,A,,tomorrow,,2026-13-01 00:00Z\n2,A,B,2026-11-17 09:00Z,S,2026-11-19 00:00Z\n`), PROFILE);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ carId: "", b: { kind: "text", text: "" }, reportedAt: null, prepEnd: null });
    expect(issues.map((i) => i.field)).toEqual(["carId", "b", "shop", "reportedAt", "prepEnd"]);
    expect(issues.every((i) => i.row === 0 && i.line === 2)).toBe(true);
    expect(issues.find((i) => i.field === "reportedAt")?.message).toMatch(/"tomorrow" is not a time this tool can read/);
  });

  it("the same records give the same content hash, whatever the file was called", async () => {
    const text = `${HEADER}\n1,A,B,2026-11-17 09:00Z,S,2026-11-19 00:00Z\n`;
    const one = await readCars(csv(text, "monday.csv"), PROFILE);
    const two = await readCars(csv(text.replace("\n", "\r\n"), "copy of monday.csv"), PROFILE);
    const other = await readCars(csv(text.replace("S,", "T,")), PROFILE);
    expect(two.contentHash).toBe(one.contentHash);
    expect(other.contentHash).not.toBe(one.contentHash);
    expect(two.source).toEqual({ kind: "csv", label: "copy of monday.csv" });
  });

  it("reads from any record source, so a database later is one more source", async () => {
    const source: RecordSource = {
      info: { kind: "database", label: "EXAMPLE saved query" },
      async *records() {
        yield { line: 1, cells: { car_id: "1", last_node: "A", next_node: "B", reported_at: "2026-11-17 09:00Z", shop: "S", prep_end: "2026-11-19 00:00Z" } };
      },
    };
    const { items, source: info } = await readCars(source, PROFILE);
    expect(info.kind).toBe("database");
    expect(items[0].prepEnd).toBe("2026-11-19T00:00:00.000Z" as Instant);
  });
});

describe("readShops / readCodes", () => {
  it("accepts name, node_code and name, lon, lat", async () => {
    const byCode = await readShops(csv("name,node_code\nEXAMPLE Temple shop,EX-TPL\n"));
    expect(byCode.items).toEqual([{ name: "EXAMPLE Temple shop", code: "EX-TPL", location: { kind: "text", text: "EX-TPL" } }]);
    const byCoords = await readShops(csv("name,code,lon,lat\nEXAMPLE North,EX-N,−92.27,34.77\nEXAMPLE bad,EX-B,abc,34\n,EX-C,-90,30\n"));
    expect(byCoords.items[0]).toEqual({ name: "EXAMPLE North", code: "EX-N", location: { kind: "coord", lon: -92.27, lat: 34.77 } });
    expect(byCoords.issues.map((i) => [i.row, i.line])).toEqual([
      [1, 3],
      [2, 4],
    ]);
    expect(byCoords.lines).toEqual([2, 3, 4]);
    expect(await refusal(() => readShops(csv("name,city\nA,B\n", "shops.csv")))).toMatch(/^invalid: shops\.csv has no location columns/);
    expect(await refusal(() => readShops(csv("shop,lon,lat\nA,1,2\n", "shops.csv")))).toMatch(/^invalid: shops\.csv has no column "name"/);
  });

  it("accepts code, name, fra_id and code, name, lon, lat", async () => {
    const { items, issues } = await readCodes(csv("code,name,fra_id,lon,lat\n668240,Temple,358070,,\n668241,,,-97.3,31.1\n668242,Nowhere,,,\n668243,,12a,,\n"), "splc");
    expect(items.slice(0, 2)).toEqual([
      { code: "668240", name: "Temple", location: { kind: "node", fraId: 358070, railroad: null } },
      { code: "668241", name: null, location: { kind: "coord", lon: -97.3, lat: 31.1 } },
    ]);
    expect(issues.map((i) => [i.line, i.message])).toEqual([
      [4, expect.stringMatching(/fra_id, or lon and lat/)],
      [5, expect.stringMatching(/"12a" is not a whole number/)],
    ]);
    expect(await refusal(() => readCodes(csv("code,name\n1,x\n", "codes.csv"), "splc"))).toMatch(/no location columns/);
  });
});

describe("EXAMPLE data", () => {
  it("six EXAMPLE shops with EX- codes and six EXAMPLE cars that read without issues under the default columns", async () => {
    expect(exampleShops().map((s) => s.code)).toEqual(["EX-NLR-01", "EX-KCY-01", "EX-BHM-01", "EX-CHI-01", "EX-CAL-01", "EX-NPL-01"]);
    const upload = exampleBatch(new Date("2026-11-17T15:20:00Z"));
    expect(upload.name).toMatch(/^EXAMPLE cars-nov17\.csv$/);
    expect(upload.asOf).toBe("2026-11-17T15:00:00.000Z");
    const { items, issues } = await readCars(openSource(upload.source), { ...PROFILE, zonelessTimes: "reject" });
    expect(issues).toEqual([]);
    expect(items.map((i) => i.carId.startsWith("EXAMPLE "))).toEqual([true, true, true, true, true, true]);
    expect(items[0]).toMatchObject({ reportedAt: "2026-11-17T15:00:00.000Z", prepEnd: "2026-11-19T07:00:00.000Z" });
  });
});
