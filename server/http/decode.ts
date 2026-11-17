/**
 * The boundary where untrusted JSON becomes domain values. Every request body and query string is
 * decoded here and nowhere else; past this file the server trusts its types.
 *
 * Each decoder checks shape and ranges only (a number is finite, a `kind` is one we know, a
 * railroad is in RAILROADS, an Instant has a zone) and throws AppError("invalid") naming the
 * field. Whether a shop exists or a place resolves is the application's business, not the decoder's.
 * Decoders build new objects from the fields they know, so anything else a client sends is dropped.
 */
import type { Api, Route } from "../../shared/api.ts";
import { AppError } from "../../shared/app.ts";
import type { Assumptions, EstimateBasis } from "../../shared/assumptions.ts";
import type { BatchId, BatchUpload, CarField, CarReport, ImportProfile, ImportRequest, StopRef, UploadSource } from "../../shared/cars.ts";
import type { CodeType, FraId, PlaceRef, PlaceRole, ShopDraft, ShopId } from "../../shared/places.ts";
import { RAILROADS, type Railroad } from "../../shared/railroads.ts";
import { asInstant, isTimeZone, type Instant, type ZonelessRule } from "../../shared/time.ts";

type RoutesWith<Part extends "body" | "query"> = { [R in Route]: Api[R][Part] extends undefined ? never : R }[Route];

/** A value at `path` ("report.a.lon") turned into T, or AppError("invalid") naming that path. */
type Decoder<T> = (value: unknown, path: string) => T;

const SHORT_TEXT = 1_000;

function invalid(path: string, message: string): never {
  throw new AppError("invalid", message, path || null);
}

const at = (path: string, key: string) => (path ? `${path}.${key}` : key);

function object(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid(path, `${path || "The request"} must be an object.`);
  return value as Record<string, unknown>;
}

function field<T>(value: unknown, path: string, key: string, decode: Decoder<T>): T {
  return decode(object(value, path)[key], at(path, key));
}

const text =
  (max = SHORT_TEXT): Decoder<string> =>
  (value, path) => {
    if (typeof value !== "string") invalid(path, `${path} must be text.`);
    if (value.length > max) invalid(path, `${path} is longer than ${max} characters.`);
    return value;
  };

const nonEmpty =
  (max = SHORT_TEXT): Decoder<string> =>
  (value, path) => {
    const t = text(max)(value, path).trim();
    if (!t) invalid(path, `${path} cannot be empty.`);
    return t;
  };

const nullable =
  <T>(decode: Decoder<T>): Decoder<T | null> =>
  (value, path) =>
    value === null || value === undefined ? null : decode(value, path);

const number: Decoder<number> = (value, path) => {
  if (typeof value !== "number" || !Number.isFinite(value)) invalid(path, `${path} must be a number.`);
  return value;
};

const inRange =
  (min: number, max: number): Decoder<number> =>
  (value, path) => {
    const n = number(value, path);
    if (n < min || n > max) invalid(path, `${path} must be between ${min} and ${max}.`);
    return n;
  };

const wholeNumber: Decoder<number> = (value, path) => {
  const n = number(value, path);
  if (!Number.isSafeInteger(n) || n < 0) invalid(path, `${path} must be a whole number.`);
  return n;
};

const boolean: Decoder<boolean> = (value, path) => {
  if (typeof value !== "boolean") invalid(path, `${path} must be true or false.`);
  return value;
};

const oneOf =
  <T extends string>(options: readonly T[]): Decoder<T> =>
  (value, path) => {
    if (typeof value !== "string" || !options.includes(value as T)) invalid(path, `${path} must be one of: ${options.join(", ")}.`);
    return value as T;
  };

const list =
  <T>(decode: Decoder<T>, max = 1_000): Decoder<T[]> =>
  (value, path) => {
    if (!Array.isArray(value)) invalid(path, `${path} must be a list.`);
    if (value.length > max) invalid(path, `${path} has more than ${max} items.`);
    return value.map((item, i) => decode(item, `${path}[${i}]`));
  };

const railroad: Decoder<Railroad> = oneOf(RAILROADS);

const instantOf: Decoder<Instant> = (value, path) => {
  const t = text(100)(value, path);
  const parsed = asInstant(t);
  if (!parsed) invalid(path, `${path} must be a time with its zone, such as 2026-11-17T09:00:00-06:00.`);
  return parsed;
};

const codeTypeOf: Decoder<CodeType> = nonEmpty(64);

// ---- domain values ----

const placeRef: Decoder<PlaceRef> = (value, path) => {
  const kind = field(value, path, "kind", oneOf(["text", "shop", "code", "node", "coord"] as const));
  switch (kind) {
    case "text":
      return { kind, text: field(value, path, "text", text()) };
    case "shop":
      return { kind, shopId: field(value, path, "shopId", nonEmpty(200)) as ShopId };
    case "code":
      return { kind, codeType: field(value, path, "codeType", codeTypeOf), code: field(value, path, "code", nonEmpty(200)) };
    case "node":
      return { kind, fraId: field(value, path, "fraId", wholeNumber) as FraId, railroad: field(value, path, "railroad", nullable(railroad)) };
    case "coord":
      return { kind, lon: field(value, path, "lon", inRange(-180, 180)), lat: field(value, path, "lat", inRange(-90, 90)) };
  }
};

const stopRef: Decoder<StopRef> = (value, path) => ({
  place: field(value, path, "place", placeRef),
  note: field(value, path, "note", nullable(text())),
});

const carReport: Decoder<CarReport> = (value, path) => ({
  carId: field(value, path, "carId", text(200)),
  a: field(value, path, "a", placeRef),
  b: field(value, path, "b", placeRef),
  shop: field(value, path, "shop", placeRef),
  stops: field(value, path, "stops", list(stopRef, 50)),
  reportedAt: field(value, path, "reportedAt", nullable(instantOf)),
  prepEnd: field(value, path, "prepEnd", nullable(instantOf)),
});

const shopDraft: Decoder<ShopDraft> = (value, path) => ({
  name: field(value, path, "name", text(200)),
  code: field(value, path, "code", nullable(text(200))),
  location: field(value, path, "location", placeRef),
});

const basis: Decoder<EstimateBasis> = (value, path) => {
  const kind = field(value, path, "kind", oneOf(["placeholder", "calibrated"] as const));
  if (kind === "placeholder") return { kind };
  return { kind, trips: field(value, path, "trips", wholeNumber), scope: field(value, path, "scope", oneOf(["lane", "region", "global"] as const)) };
};

const assumptions: Decoder<Assumptions> = (value, path) => {
  const group = (key: string) => [field(value, path, key, object), at(path, key)] as const;
  const [routing, routingPath] = group("routing");
  const [timing, timingPath] = group("timing");
  const [flags, flagsPath] = group("flags");
  return {
    routing: {
      allowed: [...new Set(field(routing, routingPath, "allowed", list(railroad, RAILROADS.length * 2)))],
      interchangePenaltyKm: field(routing, routingPath, "interchangePenaltyKm", number),
    },
    timing: {
      speedKmPerDay: field(timing, timingPath, "speedKmPerDay", number),
      interchangeDelayH: field(timing, timingPath, "interchangeDelayH", number),
      bufferH: field(timing, timingPath, "bufferH", number),
      basis: field(timing, timingPath, "basis", basis),
    },
    flags: {
      detourRatio: field(flags, flagsPath, "detourRatio", number),
      positionAgeH: field(flags, flagsPath, "positionAgeH", number),
    },
  };
};

const PROFILE_COLUMNS = ["carId", "a", "b", "shop", "reportedAt", "prepEnd"] as const satisfies readonly Exclude<CarField, "stops">[];

const zonelessRule: Decoder<ZonelessRule> = (value, path) => {
  if (value === "reject") return "reject";
  const zone = field(value, path, "zone", nonEmpty(100));
  if (!isTimeZone(zone)) invalid(at(path, "zone"), `${zone} is not a time zone this computer knows (try America/Chicago).`);
  return { zone };
};

const importProfile: Decoder<ImportProfile> = (value, path) => {
  const columnsPath = at(path, "columns");
  const given = field(value, path, "columns", object);
  const columns = Object.fromEntries(PROFILE_COLUMNS.map((name) => [name, field(given, columnsPath, name, nonEmpty(200))])) as ImportProfile["columns"];
  const positions = object(value, path).positions;
  return {
    columns,
    positions: positions === "text" ? "text" : { codeType: field(positions, at(path, "positions"), "codeType", codeTypeOf) },
    zonelessTimes: field(value, path, "zonelessTimes", zonelessRule),
  };
};

/** CSV text can be large; the HTTP layer already caps the whole body. */
const uploadSource: Decoder<UploadSource> = (value, path) => {
  field(value, path, "kind", oneOf(["csv"] as const));
  return { kind: "csv", fileName: field(value, path, "fileName", nonEmpty(300)), text: field(value, path, "text", text(Number.MAX_SAFE_INTEGER)) };
};

const importRequest: Decoder<ImportRequest> = (value, path) => ({
  source: field(value, path, "source", uploadSource),
  commit: field(value, path, "commit", boolean),
});

const batchUpload: Decoder<BatchUpload> = (value, path) => ({
  name: field(value, path, "name", text(300)),
  asOf: field(value, path, "asOf", instantOf),
  source: field(value, path, "source", uploadSource),
});

const role: Decoder<PlaceRole> = oneOf(["position", "shop"] as const);

/** One decoder per route that has a body: a route added to `Api` without one does not compile. */
export const decodeBody: { [R in RoutesWith<"body">]: (json: unknown) => Api[R]["body"] } = {
  "PUT /api/assumptions": (json) => assumptions(json, ""),
  "PUT /api/import-profile": (json) => importProfile(json, ""),
  "POST /api/places/resolve": (json) => ({ ref: field(json, "", "ref", placeRef), role: field(json, "", "role", role) }),
  "POST /api/shops": (json) => shopDraft(json, ""),
  "PUT /api/shops/:shopId": (json) => shopDraft(json, ""),
  "POST /api/shops/import": (json) => importRequest(json, ""),
  "POST /api/codes/import": (json) => ({ ...importRequest(json, ""), codeType: field(json, "", "codeType", codeTypeOf), label: field(json, "", "label", text(200)) }),
  "POST /api/batches": (json) => batchUpload(json, ""),
  "PUT /api/batches/:batchId/cars/:row/fix": (json) => ({ stops: field(json, "", "stops", list(stopRef, 50)) }),
  "POST /api/check": (json) => ({ report: field(json, "", "report", carReport), asOf: field(json, "", "asOf", instantOf) }),
};

/** A query value as a number: "-97.3" → -97.3; missing or not a number → AppError naming the key. */
function queryNumber(query: URLSearchParams, key: string, min: number, max: number): number {
  const raw = query.get(key);
  return inRange(min, max)(raw === null || raw.trim() === "" ? undefined : Number(raw), key);
}

export const decodeQuery: { [R in RoutesWith<"query">]: (query: URLSearchParams) => Api[R]["query"] } = {
  "GET /api/places/suggest": (query) => ({ q: text(200)(query.get("q") ?? "", "q"), role: role(query.get("role"), "role") }),
  "GET /api/places/nearest": (query) => ({
    lon: queryNumber(query, "lon", -180, 180),
    lat: queryNumber(query, "lat", -90, 90),
    withinKm: queryNumber(query, "withinKm", 0, 100),
  }),
};

// Path parameters arrive as text. These turn them into the ids and numbers handlers work with.
export function shopId(text: string): ShopId {
  return nonEmpty(200)(text, "shopId") as ShopId;
}
export function batchId(text: string): BatchId {
  return nonEmpty(200)(text, "batchId") as BatchId;
}
export function codeType(text: string): CodeType {
  return codeTypeOf(text, "codeType");
}
/** A whole number ≥ 0. */
export function rowNumber(text: string): number {
  if (!/^\d{1,9}$/.test(text)) invalid("row", "row must be a whole number.");
  return Number(text);
}
