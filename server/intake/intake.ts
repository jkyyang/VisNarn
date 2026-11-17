/**
 * The one door company data comes in through.
 *
 * A source (a CSV file now, a database query later) yields records: header → text, nothing more.
 * The readers below turn records into domain rows and a list of what they could not read. They do
 * not touch the network or the database, so a new source is one new `RecordSource` and nothing else
 * changes: batches, shops and codes from Synapse or CPS would arrive as the same rows.
 */
import { createHash } from "node:crypto";
import { AppError } from "../../shared/app.ts";
import type { CarField, CarReport, ImportProfile, RowIssue, SourceInfo, UploadSource } from "../../shared/cars.ts";
import type { CodeType, FraId, PlaceRef, ShopDraft } from "../../shared/places.ts";
import { readTime, type Instant } from "../../shared/time.ts";
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

/** How a field is named in messages. Plain words: the people reading them use English as a second language. */
const FIELD_WORDS: Record<Exclude<CarField, "stops">, string> = {
  carId: "car id",
  a: "last node (A)",
  b: "next node (B)",
  shop: "shop",
  reportedAt: "report time",
  prepEnd: "prep end time",
};

/**
 * Cars from a company export. Places stay as given: a typed `code` ref when the profile names a
 * code set for positions, free text otherwise; the shop cell is always free text (resolved against
 * Your shops first). Times become Instants under the profile's zone rule, or null plus an issue.
 * Throws AppError("invalid") when a column the profile names is missing: that is the file's
 * problem, not a row's.
 */
export async function readCars(source: RecordSource, profile: ImportProfile): Promise<Parsed<CarReport>> {
  const records = await all(source);
  const fields = Object.keys(FIELD_WORDS) as (keyof typeof FIELD_WORDS)[];
  const column = (field: keyof typeof FIELD_WORDS) => profile.columns[field].trim().toLowerCase();
  requireColumns(
    source,
    records,
    fields.map((field) => ({ names: [column(field)], what: FIELD_WORDS[field] })),
    "Rename them in the file, or change the column names in the import settings.",
  );

  const items: CarReport[] = [];
  const issues: RowIssue[] = [];
  records.forEach((record, row) => {
    const cell = (field: keyof typeof FIELD_WORDS) => record.cells[column(field)] ?? "";
    const issue = (field: CarField, message: string) => issues.push({ row, line: record.line, field, message });

    const carId = cell("carId");
    if (!carId) issue("carId", "The car id is empty.");

    const position = (field: "a" | "b"): PlaceRef => {
      const text = cell(field);
      if (!text) {
        issue(field, `The ${FIELD_WORDS[field]} is empty.`);
        return { kind: "text", text: "" };
      }
      return profile.positions === "text" ? { kind: "text", text } : { kind: "code", codeType: profile.positions.codeType, code: text };
    };
    const a = position("a");
    const b = position("b");

    const shopText = cell("shop");
    if (!shopText) issue("shop", "The shop is empty.");

    const time = (field: "reportedAt" | "prepEnd"): Instant | null => {
      const text = cell(field);
      const reading = readTime(text, profile.zonelessTimes);
      if (reading.ok) return reading.at;
      const word = FIELD_WORDS[field];
      issue(
        field,
        reading.why === "empty"
          ? `The ${word} is empty.`
          : reading.why === "no-zone"
            ? `The ${word} "${text}" has no time zone. Add one (such as 2026-11-17 09:00-06:00), or choose a time zone for such times in the import settings.`
            : `The ${word} "${text}" is not a time this tool can read. Write it like 2026-11-17 09:00.`,
      );
      return null;
    };

    items.push({ carId, a, b, shop: { kind: "text", text: shopText }, stops: [], reportedAt: time("reportedAt"), prepEnd: time("prepEnd") });
  });
  return parsed(source, records, items, issues);
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
    const issue = (message: string) => issues.push({ row, line: record.line, field: null, message });
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
    const issue = (message: string) => issues.push({ row, line: record.line, field: null, message });
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
function requireColumns(source: RecordSource, records: RawRecord[], wanted: { names: string[]; what: string }[], advice = "Rename them in the file."): void {
  if (!records.length) return;
  const have = new Set(Object.keys(records[0].cells));
  const missing = wanted.filter((w) => !w.names.some((name) => have.has(name)));
  if (!missing.length) return;
  const named = missing.map((w) => `"${w.names[0]}" (${w.what})`).join(", ");
  throw new AppError("invalid", `${source.info.label} has no ${missing.length > 1 ? "columns" : "column"} ${named}. ${advice}`, "source");
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
