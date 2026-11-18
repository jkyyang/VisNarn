/**
 * The HTTP contract, once. The server's handler table and the browser's client are both typed from
 * `Api`, so a route that exists on one side only, or a body one side reads differently, is a
 * compile error.
 *
 * Only server/http and web/data import this file (scripts/architecture.test.ts checks). Everything
 * else speaks the domain types the routes carry (./places.ts, ./plans.ts, ./route.ts), and those are
 * plain JSON by construction, so there is no second set of "wire"
 * types to keep in step with them.
 */
import type { AppErrorKind } from "./app.ts";
import type { LngLat } from "./geo.ts";
import type {
  ImportReport, ImportRequest, NetworkNode, NodesOn, PlaceRef, PlaceResolution, PlaceRole, PlaceSuggestion, ShopDraft, ShopView,
} from "./places.ts";
import type { Plan, PlannedRoute, SavedRoute, SavedRouteDraft } from "./plans.ts";

type Endpoint<Res, Body = undefined, Query = undefined> = { res: Res; body: Body; query: Query };

export interface Api {
  /** Autocomplete for a place input: Your shops and city names that match. */
  "GET /api/places/suggest": Endpoint<PlaceSuggestion[], undefined, { q: string; role: PlaceRole }>;
  /** What one place means on the network: "Found on the network · served by BNSF and UP". */
  "POST /api/places/resolve": Endpoint<PlaceResolution, { ref: PlaceRef; role: PlaceRole }>;
  /** The node a map click snaps to (`on` "mainline": only where a railroad's mainline runs), or null when none is within `withinKm`. */
  "GET /api/places/nearest": Endpoint<NetworkNode | null, undefined, { lon: number; lat: number; withinKm: number; on: NodesOn }>;
  /** Where a shop at this point most likely joins the network (its own track followed to the main line), or null. */
  "GET /api/places/way-in": Endpoint<NetworkNode | null, undefined, { lon: number; lat: number }>;

  "GET /api/shops": Endpoint<ShopView[]>;
  "POST /api/shops": Endpoint<ShopView, ShopDraft>;
  "PUT /api/shops/:shopId": Endpoint<ShopView, ShopDraft>;
  "DELETE /api/shops/:shopId": Endpoint<null>;
  "POST /api/shops/import": Endpoint<ImportReport<ShopView>, ImportRequest>;

  /** The routes for a plan, as far as its places resolve. Nothing is stored; the same plan always gives the same answer. */
  "POST /api/route": Endpoint<PlannedRoute, Plan>;
  /** By name, ignoring case. */
  "GET /api/saved-routes": Endpoint<SavedRoute[]>;
  "POST /api/saved-routes": Endpoint<SavedRoute, SavedRouteDraft>;
  /** Saving what is already stored changes nothing. */
  "PUT /api/saved-routes/:routeId": Endpoint<SavedRoute, SavedRouteDraft>;
  "DELETE /api/saved-routes/:routeId": Endpoint<null>;

  /**
   * The same paths drawn along the real track, for the map when Real tracks is on: each step between two
   * neighbouring network nodes becomes that segment's surveyed line. Paths come back in the order sent.
   */
  "POST /api/track": Endpoint<LngLat[][], { paths: LngLat[][] }>;
}

export type Route = keyof Api;
export type Res<R extends Route> = Api[R]["res"];

type PathOf<R> = R extends `${string} ${infer Path}` ? Path : never;
type ParamNames<Path> = Path extends `${string}:${infer Name}/${infer Rest}`
  ? Name | ParamNames<`/${Rest}`>
  : Path extends `${string}:${infer Name}`
    ? Name
    : never;

/** ":shopId" in a route becomes `params.shopId`. Always text here; handlers turn it into ids and numbers. */
export type Params<R extends Route> = { [Name in ParamNames<PathOf<R>>]: string };

/** What a caller passes for a route: only the parts that route has. */
export type Request<R extends Route> = ([ParamNames<PathOf<R>>] extends [never] ? unknown : { params: Params<R> }) &
  (Api[R]["body"] extends undefined ? unknown : { body: Api[R]["body"] }) &
  (Api[R]["query"] extends undefined ? unknown : { query: Api[R]["query"] });

/** `call("GET /api/shops")` needs no second argument; `call("PUT /api/shops/:shopId", {...})` does. */
export type RequestArgs<R extends Route> = unknown extends Request<R> ? [request?: undefined] : [request: Request<R>];

/** The body of every non-2xx answer: an AppError on the wire. */
export interface ApiErrorBody {
  error: { kind: AppErrorKind; message: string; field: string | null };
}

export const STATUS_OF: Record<AppErrorKind, number> = { invalid: 400, "not-found": 404, conflict: 409, internal: 500 };

/** Method and URL for a call. The one place a route template is turned into a path. */
export function urlFor<R extends Route>(route: R, ...request: RequestArgs<R>): { method: string; url: string } {
  const space = route.indexOf(" ");
  const method = route.slice(0, space);
  const parts = (request[0] ?? {}) as { params?: Record<string, string>; query?: Record<string, string | number | undefined> };
  const path = route.slice(space + 1).replace(/:(\w+)/g, (_match, name: string) => {
    const value = parts.params?.[name];
    if (value === undefined || value === "") throw new Error(`${route}: no value for :${name}`);
    return encodeURIComponent(value);
  });
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(parts.query ?? {})) if (value !== undefined) search.append(key, String(value));
  const query = search.toString();
  return { method, url: query ? `${path}?${query}` : path };
}

/**
 * The inverse of `urlFor`, for the server: which route a request is for, and its params.
 * Built from the handler table's keys, so there is no second list of routes.
 */
export function routeMatcher(routes: readonly Route[]): (method: string, pathname: string) => { route: Route; params: Record<string, string> } | null {
  const compiled = routes.map((route) => {
    const space = route.indexOf(" ");
    const segments = route.slice(space + 1).split("/");
    return { route, method: route.slice(0, space), segments, literals: segments.filter((s) => !s.startsWith(":")).length };
  });
  // A literal segment beats a parameter ("/api/shops/import" before "/api/shops/:shopId").
  compiled.sort((x, y) => y.literals - x.literals);
  return (method, pathname) => {
    const given = pathname.split("/");
    for (const candidate of compiled) {
      if (candidate.method !== method || candidate.segments.length !== given.length) continue;
      const params: Record<string, string> = {};
      let matched = true;
      for (let i = 0; i < given.length && matched; i++) {
        const want = candidate.segments[i];
        if (!want.startsWith(":")) matched = want === given[i];
        else if (given[i] === "") matched = false;
        else {
          try {
            params[want.slice(1)] = decodeURIComponent(given[i]);
          } catch {
            matched = false;
          }
        }
      }
      if (matched) return { route: candidate.route, params };
    }
    return null;
  };
}

// ---- compile-time guard: every answer is plain JSON (no Date, Map, class instance or function) ----
type IsJson<T> = [T] extends [string | number | boolean | null]
  ? true
  : T extends string | number | boolean | null
    ? true
    : T extends Date | Map<unknown, unknown> | Set<unknown> | ((...args: never[]) => unknown) | undefined
      ? false
      : T extends readonly (infer Item)[]
        ? IsJson<Item>
        : T extends object
          ? // An undefined property is left out of the JSON, so `include?: X` is plain JSON when X is.
            false extends { [K in keyof T]-?: IsJson<Exclude<T[K], undefined>> }[keyof T]
            ? false
            : true
          : false;
type NonJsonRoutes = { [R in Route]: false extends IsJson<Res<R>> ? R : never }[Route];
/** Fails to compile, naming the routes at fault, if any answer type stops being plain JSON. */
export const ALL_ANSWERS_ARE_JSON: [NonJsonRoutes] extends [never] ? true : { notJson: NonJsonRoutes } = true;
