/**
 * The one door company data comes in through.
 *
 * A source (a CSV file now, a database query later) yields records: header → text, nothing more.
 * The readers below turn records into domain rows and a list of what they could not read. They do
 * not touch the network or the database, so a new source is one new `RecordSource` and nothing else
 * changes: shops and codes from a company database would arrive as the same rows.
 */
import { createHash } from "node:crypto";
import { AppError } from "../../shared/app.ts";
import type { CodeType, FraId, PlaceRef, RowIssue, ShopDraft, SourceInfo, UploadSource } from "../../shared/places.ts";
import { csvSource } from "./csv.ts";

export interface RawRecord {
  /** Line in the file (or row in the query result), for messages. */
  line: number;
  /** Lower-cased header → trimmed cell text. */
  cells: Readonly<Record<string, string>>;
}

export interface RecordSource {
  info: SourceInfo;
  records(): AsyncIterable<RawRecord>;
}

/** The source for an upload. Exhaustive over UploadSource: a new kind does not compile until it has a source. */
export function openSource(upload: UploadSource): RecordSource {
  switch (upload.kind) {
    case "csv":
      return csvSource(upload.fileName, upload.text);
  }
}

export interface Parsed<T> {
  source: SourceInfo;
  /** One per data row, in order, including rows with issues (as far as they could be read). */
  items: T[];
  /** The source line of each item, for issues found after reading (a shop that matches no node). */
  lines: number[];
  issues: RowIssue[];
  /** Hash of the records as read, to recognise the same upload again. */
  contentHash: string;
}

/**
 * Shops: a `name`, and a location given by `fra_id`, by `lon` and `lat`, or by `node_code` (a code
 * looked up in the imported code sets). The shop's own code is `code`, or else `node_code`.
 */
export async function readShops(source: RecordSource): Promise<Parsed<ShopDraft>> {
  const records = await all(source);
  requireColumns(source, records, [{ names: ["name"], what: "shop name" }]);
  requireLocationColumns(source, records, ["node_code", "fra_id", "lon, lat"]);

  const items: ShopDraft[] = [];
  const issues: RowIssue[] = [];
  records.forEach((record, row) => {
    const issue = (message: string) => issues.push({ row, line: record.line, message });
    const name = record.cells.name ?? "";
    if (!name) issue("The shop name is empty.");
    const nodeCode = record.cells.node_code ?? "";
    const code = record.cells.code || nodeCode || null;
    const location = locationOf(record, nodeCode ? { kind: "text", text: nodeCode } : null, issue, "Give the shop a node_code, an fra_id, or lon and lat.");
    items.push({ name, code, location });
  });
  return parsed(source, records, items, issues);
}

export interface NodeCodeDraft {
  code: string;
  name: string | null;
  /** A `node` or `coord` ref, as the row gave it. */
  location: PlaceRef;
}

/** Codes of one code set: `code`, an optional `name`, and `fra_id` or `lon` and `lat`. */
export async function readCodes(source: RecordSource, codeType: CodeType): Promise<Parsed<NodeCodeDraft>> {
  const records = await all(source);
  requireColumns(source, records, [{ names: ["code"], what: `code (of the ${codeType} code set)` }]);
  requireLocationColumns(source, records, ["fra_id", "lon, lat"]);

  const items: NodeCodeDraft[] = [];
  const issues: RowIssue[] = [];
  records.forEach((record, row) => {
    const issue = (message: string) => issues.push({ row, line: record.line, message });
    const code = record.cells.code ?? "";
    if (!code) issue("The code is empty.");
    const location = locationOf(record, null, issue, "Give the code an fra_id, or lon and lat.");
    items.push({ code, name: record.cells.name || null, location });
  });
  return parsed(source, records, items, issues);
}

// ---- shared pieces ----

async function all(source: RecordSource): Promise<RawRecord[]> {
  const out: RawRecord[] = [];
  for await (const record of source.records()) out.push(record);
  return out;
}

/** Columns are judged from the first record: every record of a source has the same keys. */
function requireColumns(source: RecordSource, records: RawRecord[], wanted: { names: string[]; what: string }[]): void {
  if (!records.length) return;
  const have = new Set(Object.keys(records[0].cells));
  const missing = wanted.filter((w) => !w.names.some((name) => have.has(name)));
  if (!missing.length) return;
  const named = missing.map((w) => `"${w.names[0]}" (${w.what})`).join(", ");
  throw new AppError("invalid", `${source.info.label} has no ${missing.length > 1 ? "columns" : "column"} ${named}. Rename them in the file.`, "source");
}

/** At least one way to say where a row is. "lon, lat" means both columns. */
function requireLocationColumns(source: RecordSource, records: RawRecord[], ways: string[]): void {
  if (!records.length) return;
  const have = new Set(Object.keys(records[0].cells));
  const ok = ways.some((way) => way.split(", ").every((name) => have.has(name)));
  if (!ok) throw new AppError("invalid", `${source.info.label} has no location columns. Add ${ways.map((w) => `"${w}"`).join(" or ")}.`, "source");
}

/** A row's location: fra_id first, then lon and lat, then the fallback. Null (with an issue) when there is none. */
function locationOf(record: RawRecord, fallback: PlaceRef | null, issue: (message: string) => void, none: string): PlaceRef {
  const fra = record.cells.fra_id ?? "";
  const lon = record.cells.lon ?? "";
  const lat = record.cells.lat ?? "";
  if (fra) {
    if (/^\d{1,9}$/.test(fra)) return { kind: "node", fraId: Number(fra) as FraId, railroad: null };
    issue(`The fra_id "${fra}" is not a whole number.`);
    return { kind: "text", text: "" };
  }
  if (lon || lat) {
    const x = Number(lon.replace("−", "-"));
    const y = Number(lat.replace("−", "-"));
    if (lon && lat && Number.isFinite(x) && Number.isFinite(y) && Math.abs(x) <= 180 && Math.abs(y) <= 90) return { kind: "coord", lon: x, lat: y };
    issue(`"${lon}, ${lat}" is not a longitude and latitude (such as -92.27, 34.77).`);
    return { kind: "text", text: "" };
  }
  if (fallback) return fallback;
  issue(none);
  return { kind: "text", text: "" };
}

function parsed<T>(source: RecordSource, records: RawRecord[], items: T[], issues: RowIssue[]): Parsed<T> {
  // Of what was read, not of the file: the same rows read the same way are the same upload, whatever the file is called.
  const contentHash = createHash("sha256").update(JSON.stringify({ items, issues })).digest("hex");
  return { source: source.info, items, lines: records.map((r) => r.line), issues, contentHash };
}
