/**
 * What the screens read from the server and what they may change, by name. This file is the page's
 * whole view of the back end: a component imports from here (and domain types from shared/), never
 * from ./query.ts or shared/api.ts.
 */
import type { LngLat } from "../../shared/geo.ts";
import type { ImportRequest, NetworkNode, PlaceRef, PlaceRole, ShopDraft, ShopId } from "../../shared/places.ts";
import type { Plan, SavedRoute, SavedRouteDraft, SavedRouteId } from "../../shared/plans.ts";
import { read, useQuery, write } from "./query.ts";

export type { AppError, Meta } from "../../shared/app.ts";
export { fresh, type QueryState } from "./query.ts";

// ---- reads ----
export const useMeta = () => useQuery("GET /api/meta", {});
export const useShops = () => useQuery("GET /api/shops", {});
export const useSavedRoutes = () => useQuery("GET /api/saved-routes", {});

/** Autocomplete for a place input. Empty text asks nothing. */
export const usePlaceSuggestions = (text: string, role: PlaceRole) =>
  useQuery("GET /api/places/suggest", text.trim() ? { query: { q: text, role } } : null);

/** What the network makes of one place: the hint under an input. */
export const usePlace = (ref: PlaceRef | null, role: PlaceRole) =>
  useQuery("POST /api/places/resolve", ref ? { body: { ref, role } } : null);

/** The routes for a plan, as far as its places resolve. Null asks nothing. */
export const usePlannedRoute = (plan: Plan | null) => useQuery("POST /api/route", plan ? { body: plan } : null);

/** The same paths drawn along the real track, in the same order. Null asks nothing. */
export const useTrackPaths = (paths: LngLat[][] | null) => useQuery("POST /api/track", paths ? { body: { paths } } : null);

// ---- one-off reads ----
/** The node a map click snaps to, or null when no track is that close. */
export const snapToNetwork = (lon: number, lat: number, withinKm: number): Promise<NetworkNode | null> =>
  read("GET /api/places/nearest", { query: { lon, lat, withinKm } });

// ---- changes ----
export const saveShop = (draft: ShopDraft, id: ShopId | null) =>
  id ? write("PUT /api/shops/:shopId", { params: { shopId: id }, body: draft }) : write("POST /api/shops", { body: draft });
export const removeShop = (id: ShopId) => write("DELETE /api/shops/:shopId", { params: { shopId: id } });
export const importShops = (request: ImportRequest) => write("POST /api/shops/import", { body: request });

/** A new saved route when `id` is null. */
export const saveRoute = (draft: SavedRouteDraft, id: SavedRouteId | null): Promise<SavedRoute> =>
  id ? write("PUT /api/saved-routes/:routeId", { params: { routeId: id }, body: draft }) : write("POST /api/saved-routes", { body: draft });
export const removeRoute = (id: SavedRouteId) => write("DELETE /api/saved-routes/:routeId", { params: { routeId: id } });
