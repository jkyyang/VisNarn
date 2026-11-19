/**
 * The boundary where untrusted JSON becomes domain values. Every request body and query string is
 * decoded here and nowhere else; past this file the server trusts its types.
 *
 * Each decoder checks shape and ranges only (a number is finite, a `kind` is one we know, a
 * railroad is in RAILROADS) and throws AppError("invalid") naming the
 * field. Whether a shop exists or a place resolves is for the application to check.
 * Decoders build new objects from the fields they know, so anything else a client sends is dropped.
 */
import type { Api, Route } from "../../shared/api.ts";
import { AppError } from "../../shared/app.ts";
import type { LngLat } from "../../shared/geo.ts";
import {
  NEAREST_MAX_KM, SHOP_LINKS_MAX, SHOP_TEXT_MAX, UNSEEN, type FraId, type ImportRequest, type LinkEnd, type PlaceRef, type PlaceRole, type ShopDraft, type ShopId,
  type UploadSource,
} from "../../shared/places.ts";
import type { FullPlan, Plan, SavedRouteDraft, SavedRouteId } from "../../shared/plans.ts";
import { RAILROADS, type Railroad, type TrackIncluded } from "../../shared/railroads.ts";
import { ROUTE_STRATEGIES } from "../../shared/route.ts";

type RoutesWith<Part extends "body" | "query"> = { [R in Route]: Api[R][Part] extends undefined ? never : R }[Route];

/** A value at `path` ("plan.start.lon") turned into T, or AppError("invalid") naming that path. */
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

/** Text stored and read back as given: no character SQLite would cut at or a person could not see. */
const visible =
  (decode: Decoder<string>): Decoder<string> =>
  (value, path) => {
    const t = decode(value, path);
    if (UNSEEN.test(t)) invalid(path, `${path} cannot hold control or invisible characters.`);
    return t;
  };

/** A name a person reads back in a list: plain visible text, so it is stored exactly as answered. */
const name = (max: number): Decoder<string> => visible(nonEmpty(max));

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
  <T>(decode: Decoder<T>, max = 1_000, min = 0): Decoder<T[]> =>
  (value, path) => {
    if (!Array.isArray(value)) invalid(path, `${path} must be a list.`);
    if (value.length > max) invalid(path, `${path} has more than ${max} items.`);
    if (value.length < min) invalid(path, `${path} needs at least ${min} items.`);
    return value.map((item, i) => decode(item, `${path}[${i}]`));
  };

const railroad: Decoder<Railroad> = oneOf(RAILROADS);

/** The longest id the server reads: ids are made by the server, so anything longer is not one. */
const ID_MAX = 200;

const lon = inRange(-180, 180);
const lat = inRange(-90, 90);

// ---- domain values ----

const placeRef: Decoder<PlaceRef> = (value, path) => {
  const kind = field(value, path, "kind", oneOf(["text", "shop", "node", "coord"] as const));
  switch (kind) {
    case "text":
      return { kind, text: field(value, path, "text", text()) };
    case "shop":
      return { kind, shopId: field(value, path, "shopId", nonEmpty(ID_MAX)) as ShopId };
    case "node":
      return { kind, fraId: field(value, path, "fraId", wholeNumber) as FraId, railroad: field(value, path, "railroad", nullable(railroad)) };
    case "coord":
      return { kind, lon: field(value, path, "lon", lon), lat: field(value, path, "lat", lat) };
  }
};

/** At most this many stops: a plan is clicked together by hand. */
const MAX_STOPS = 50;

const trackIncluded: Decoder<TrackIncluded> = (value, path) => ({
  regional: field(value, path, "regional", boolean),
  shortLine: field(value, path, "shortLine", boolean),
  passenger: field(value, path, "passenger", boolean),
});

/** `plan` takes empty rows (null); `fullPlan`, saved, takes none. */
const planDecoder =
  <P extends Plan>(row: Decoder<P["places"][number]>): Decoder<P> =>
  (value, path) =>
    ({
      places: field(value, path, "places", list(row, MAX_STOPS + 2, 2)),
      include: field(value, path, "include", trackIncluded),
      turnAtStops: field(value, path, "turnAtStops", boolean),
    }) as P;

const plan = planDecoder<Plan>(nullable(placeRef));
const fullPlan = planDecoder<FullPlan>(placeRef);

const savedRouteDraft: Decoder<SavedRouteDraft> = (value, path) => ({
  name: field(value, path, "name", name(120)),
  plan: field(value, path, "plan", fullPlan),
  option: field(value, path, "option", nullable(oneOf(ROUTE_STRATEGIES))),
  routeString: field(value, path, "routeString", visible(text(5_000))),
});

const shopDraft: Decoder<ShopDraft> = (value, path) => ({
  name: field(value, path, "name", visible(text(SHOP_TEXT_MAX))),
  code: field(value, path, "code", nullable(visible(text(SHOP_TEXT_MAX)))),
  location: field(value, path, "location", placeRef),
  links: field(value, path, "links", list(wholeNumber, SHOP_LINKS_MAX)) as FraId[],
});

/** A node by its FRA id, else a spot on the map. */
const linkEnd: Decoder<LinkEnd> = (value, path) =>
  "fraId" in object(value, path) ? { fraId: field(value, path, "fraId", wholeNumber) as FraId } : { lon: field(value, path, "lon", lon), lat: field(value, path, "lat", lat) };

/** CSV text can be large; the HTTP layer already caps the whole body. */
const uploadSource: Decoder<UploadSource> = (value, path) => {
  field(value, path, "kind", oneOf(["csv"] as const));
  return { kind: "csv", fileName: field(value, path, "fileName", nonEmpty(300)), text: field(value, path, "text", text(Number.MAX_SAFE_INTEGER)) };
};

const importRequest: Decoder<ImportRequest> = (value, path) => ({
  source: field(value, path, "source", uploadSource),
  commit: field(value, path, "commit", boolean),
});

const role: Decoder<PlaceRole> = oneOf(["position", "shop"] as const);

const lngLat: Decoder<LngLat> = (value, path) => {
  if (!Array.isArray(value) || value.length !== 2) invalid(path, `${path} must be [longitude, latitude].`);
  return [lon(value[0], `${path}[0]`), lat(value[1], `${path}[1]`)];
};

/** The routes on one map: a few paths of up to a few thousand nodes each. */
const MAX_PATHS = 100;
const MAX_PATH_POINTS = 50_000;

/** One decoder per route that has a body: a route added to `Api` without one does not compile. */
export const decodeBody: { [R in RoutesWith<"body">]: (json: unknown) => Api[R]["body"] } = {
  "POST /api/places/resolve": (json) => ({ ref: field(json, "", "ref", placeRef), role: field(json, "", "role", role) }),
  "POST /api/places/links": (json) => ({ lon: field(json, "", "lon", lon), lat: field(json, "", "lat", lat), ends: field(json, "", "ends", list(linkEnd, SHOP_LINKS_MAX)) }),
  "POST /api/shops": (json) => shopDraft(json, ""),
  "PUT /api/shops/:shopId": (json) => shopDraft(json, ""),
  "POST /api/shops/import": (json) => importRequest(json, ""),
  "POST /api/route": (json) => plan(json, ""),
  "POST /api/saved-routes": (json) => savedRouteDraft(json, ""),
  "PUT /api/saved-routes/:routeId": (json) => savedRouteDraft(json, ""),
  "POST /api/track": (json) => ({ paths: field(json, "", "paths", list(list(lngLat, MAX_PATH_POINTS), MAX_PATHS)) }),
};

/** A query value as a number: "-97.3" → -97.3; missing or malformed → AppError naming the key. */
function queryNumber(query: URLSearchParams, key: string, min: number, max: number): number {
  const raw = query.get(key);
  return inRange(min, max)(raw === null || raw.trim() === "" ? undefined : Number(raw), key);
}

export const decodeQuery: { [R in RoutesWith<"query">]: (query: URLSearchParams) => Api[R]["query"] } = {
  "GET /api/places/suggest": (query) => ({ q: text(200)(query.get("q") ?? "", "q"), role: role(query.get("role"), "role") }),
  "GET /api/places/nearest": (query) => ({
    lon: queryNumber(query, "lon", -180, 180),
    lat: queryNumber(query, "lat", -90, 90),
    withinKm: queryNumber(query, "withinKm", 0, NEAREST_MAX_KM),
  }),
};

// Path parameters arrive as text. These turn them into the ids and numbers handlers work with.
export function shopId(text: string): ShopId {
  return nonEmpty(ID_MAX)(text, "shopId") as ShopId;
}
export function savedRouteId(text: string): SavedRouteId {
  return nonEmpty(ID_MAX)(text, "routeId") as SavedRouteId;
}
