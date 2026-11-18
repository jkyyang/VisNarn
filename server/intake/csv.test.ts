import { describe, expect, it } from "vitest";
import { AppError } from "../../shared/app.ts";
import { csvRecords, parseCsv } from "./csv.ts";

describe("parseCsv", () => {
  it("keeps a line break inside a quoted cell", () => {
    const text = 'car_id,note\n104233,"first line\nsecond line"\n104234,plain\n';
    expect(parseCsv(text)).toEqual([
      { line: 1, cells: ["car_id", "note"] },
      { line: 2, cells: ["104233", "first line\nsecond line"] },
      { line: 4, cells: ["104234", "plain"] },
    ]);
  });

  it("reads quotes, doubled quotes, CRLF and a UTF-8 BOM; skips blank lines; reports file line numbers", () => {
    const text = '﻿name,code\r\n"Shop, North","EX ""NLR"" 01"\r\n\r\n,\r\nTemple yard,EX-TPL\r\n"multi\r\nline",x';
    expect(parseCsv(text)).toEqual([
      { line: 1, cells: ["name", "code"] },
      { line: 2, cells: ["Shop, North", 'EX "NLR" 01'] },
      { line: 5, cells: ["Temple yard", "EX-TPL"] },
      { line: 6, cells: ["multi\r\nline", "x"] },
    ]);
  });

  it("keeps empty cells, and text around stray quotes as written", () => {
    expect(parseCsv('a,,c\n"",b,\nab"c,"q"x')).toEqual([
      { line: 1, cells: ["a", "", "c"] },
      { line: 2, cells: ["", "b", ""] },
      { line: 3, cells: ['ab"c', "qx"] },
    ]);
  });

  it("refuses a quoted cell that never closes, naming the line it starts on", () => {
    expect(() => parseCsv('a,b\n1,"never closed\n2,3')).toThrow(/Line 2/);
  });

  it("round-trips any cell written by the usual quoting rule", () => {
    const cells = ["plain", "comma, inside", 'quote " inside', "line\nbreak", "", "  spaces  ", "both,\"\n"];
    const quote = (c: string) => (/[",\r\n]/.test(c) ? `"${c.replaceAll('"', '""')}"` : c);
    expect(parseCsv(`${cells.map(quote).join(",")}\n`)[0].cells).toEqual(cells);
  });
});

describe("csvRecords", () => {
  it("gives one record per data row, keyed by lower-cased header, with trimmed cells and file line numbers", () => {
    const records = csvRecords("EXAMPLE cars.csv", 'Car_ID , Shop\n 104233 ,"EX-NLR-01 "\n\n104234\n');
    expect(records).toEqual([
      { line: 2, cells: { car_id: "104233", shop: "EX-NLR-01" } },
      { line: 4, cells: { car_id: "104234", shop: "" } },
    ]);
  });

  it("refuses an empty file, a header without rows, and a column named twice", () => {
    const refused = (text: string) => {
      try {
        csvRecords("cars.csv", text);
      } catch (error) {
        return error instanceof AppError ? `${error.kind}: ${error.message}` : String(error);
      }
      return "accepted";
    };
    expect(refused("﻿\n\n")).toBe("invalid: cars.csv is empty.");
    expect(refused("car_id,shop\n")).toBe("invalid: cars.csv has a header row but no data rows.");
    expect(refused("shop,SHOP\n1,2")).toBe('invalid: cars.csv has the column "shop" twice.');
  });

  it("keeps a column called __proto__ as data", () => {
    const [record] = csvRecords("odd.csv", "__proto__,b\nx,y");
    expect(Object.keys(record.cells)).toEqual(["__proto__", "b"]);
    expect(record.cells.__proto__).toBe("x");
  });
});
