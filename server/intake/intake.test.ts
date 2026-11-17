import { describe, expect, it } from "vitest";
import { AppError } from "../../shared/app.ts";
import { exampleShops } from "./example.ts";
import { openSource, readCodes, readShops, type RecordSource } from "./intake.ts";

const csv = (text: string, fileName = "shops.csv") => openSource({ kind: "csv", fileName, text });

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
  it("keeps a line break inside a quoted cell", async () => {
    const { items, issues } = await readShops(csv(`name,lon,lat\n"EXAMPLE Taylor,\nTX",-97.41,30.57\n`));
    expect(issues).toEqual([]);
    expect(items[0].name).toBe("EXAMPLE Taylor,\nTX");
  });

  it("reads quotes, doubled quotes, CRLF and a UTF-8 BOM; skips blank lines; reports file line numbers", async () => {
    const text = `\ufeffname,lon,lat\r\n"EXAMPLE ""1""",-97.41,\r\n\r\n"EXAMPLE 2",,30.57\r\n`;
    const { items, issues } = await readShops(csv(text));
    expect(items.map((i) => i.name)).toEqual(['EXAMPLE "1"', "EXAMPLE 2"]);
    expect(issues.map((i) => [i.row, i.line])).toEqual([
      [0, 2],
      [1, 4],
    ]);
  });

  it("the same records give the same content hash, whatever the file was called", async () => {
    const text = "name,lon,lat\nEXAMPLE A,-97.41,30.57\n";
    const one = await readShops(csv(text, "monday.csv"));
    const two = await readShops(csv(text.replace("\n", "\r\n"), "copy of monday.csv"));
    const other = await readShops(csv(text.replace("A,", "B,")));
    expect(two.contentHash).toBe(one.contentHash);
    expect(other.contentHash).not.toBe(one.contentHash);
    expect(two.source).toEqual({ kind: "csv", label: "copy of monday.csv" });
  });

  it("reads from any record source, so a database later is one more source", async () => {
    const source: RecordSource = {
      info: { kind: "database", label: "EXAMPLE saved query" },
      async *records() {
        yield { line: 1, cells: { name: "EXAMPLE A", lon: "-97.41", lat: "30.57" } };
      },
    };
    const { items, source: info } = await readShops(source);
    expect(info.kind).toBe("database");
    expect(items[0].location).toEqual({ kind: "coord", lon: -97.41, lat: 30.57 });
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
  it("six EXAMPLE shops with EX- codes", () => {
    expect(exampleShops().map((s) => s.code)).toEqual(["EX-NLR-01", "EX-KCY-01", "EX-BHM-01", "EX-CHI-01", "EX-CAL-01", "EX-NPL-01"]);
  });
});
