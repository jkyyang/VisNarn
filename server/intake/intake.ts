/**
 * The one door shop lists come in through: an upload's records become shop drafts and a list of what
 * could not be read. Nothing here touches the network or the database.
 */
import { AppError } from "../../shared/app.ts";
import { isLngLat, plainMinus } from "../../shared/geo.ts";
import { SHOP_TEXT_MAX, UNSEEN, type FraId, type PlaceRef, type RowIssue, type ShopDraft, type UploadSource } from "../../shared/places.ts";
import { csvRecords } from "./csv.ts";

export interface RawRecord {
  /** Line in the file (or row in the query result), for messages. */
  line: number;
  /** Lower-cased header → trimmed cell text. */
  cells: Readonly<Record<string, string>>;
}

export interface Parsed<T> {
  /** One per data row, in order, including rows with issues (as far as they could be read). */
  items: T[];
  /** The source line of each item, for issues found after reading (a shop that matches no node). */
  lines: number[];
  issues: RowIssue[];
}

/** Shops: a `name`, an optional `code`, and a location given by `fra_id` or by `lon` and `lat`. */
export function readShops(upload: UploadSource): Parsed<ShopDraft> {
  const records = csvRecords(upload.fileName, upload.text);
  requireColumns(upload.fileName, records, [{ names: ["name"], what: "shop name" }]);
  requireLocationColumns(upload.fileName, records);

  const items: ShopDraft[] = [];
  const issues: RowIssue[] = [];
  records.forEach((record, row) => {
    const issue = (message: string) => issues.push({ row, line: record.line, message });
    const name = record.cells.name ?? "";
    if (!name) issue("The shop name is empty.");
    else if (name.length > SHOP_TEXT_MAX) issue(`The shop name is longer than ${SHOP_TEXT_MAX} characters.`);
    else if (UNSEEN.test(name)) issue("The shop name holds control or invisible characters.");
    const code = record.cells.code || null;
    // The same limits as the shop form (POST /api/shops), so both doors store the same shops.
    if (code && code.length > SHOP_TEXT_MAX) issue(`The shop code is longer than ${SHOP_TEXT_MAX} characters.`);
    else if (code && UNSEEN.test(code)) issue("The shop code holds control or invisible characters.");
    const location = locationOf(record, issue);
    items.push({ name, code, location, links: [] });
  });
  return { items, lines: records.map((r) => r.line), issues };
}

// ---- shared pieces ----

/** Columns are judged from the first record: every record of a source has the same keys. */
function requireColumns(file: string, records: RawRecord[], wanted: { names: string[]; what: string }[]): void {
  if (!records.length) return;
  const have = new Set(Object.keys(records[0].cells));
  const missing = wanted.filter((w) => !w.names.some((name) => have.has(name)));
  if (!missing.length) return;
  const named = missing.map((w) => `"${w.names[0]}" (${w.what})`).join(", ");
  throw new AppError("invalid", `${file} has no ${missing.length > 1 ? "columns" : "column"} ${named}. Rename them in the file.`, "source");
}

/** At least one way to say where a row is. "lon, lat" means both columns. */
function requireLocationColumns(file: string, records: RawRecord[]): void {
  const ways = ["fra_id", "lon, lat"];
  if (!records.length) return;
  const have = new Set(Object.keys(records[0].cells));
  const ok = ways.some((way) => way.split(", ").every((name) => have.has(name)));
  if (!ok) throw new AppError("invalid", `${file} has no location columns. Add ${ways.map((w) => `"${w}"`).join(" or ")}.`, "source");
}

/** A row's location: fra_id first, then lon and lat. Empty text (with an issue) when there is none. */
function locationOf(record: RawRecord, issue: (message: string) => void): PlaceRef {
  const fra = record.cells.fra_id ?? "";
  const lon = record.cells.lon ?? "";
  const lat = record.cells.lat ?? "";
  if (fra) {
    if (/^\d{1,9}$/.test(fra)) return { kind: "node", fraId: Number(fra) as FraId, railroad: null };
    issue(`The fra_id "${fra}" must be a whole number.`);
    return { kind: "text", text: "" };
  }
  if (lon || lat) {
    const x = Number(plainMinus(lon));
    const y = Number(plainMinus(lat));
    if (lon && lat && isLngLat(x, y)) return { kind: "coord", lon: x, lat: y };
    issue(`"${lon}, ${lat}" cannot be read as a longitude and latitude (such as -92.27, 34.77).`);
    return { kind: "text", text: "" };
  }
  issue("Give the shop an fra_id, or lon and lat.");
  return { kind: "text", text: "" };
}
