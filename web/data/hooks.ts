/**
 * What the screens read from the server and what they may change, by name. This file is the page's
 * whole view of the back end: a component imports from here (and domain types from shared/), never
 * from ./query.ts or shared/api.ts.
 */
import type { Assumptions } from "../../shared/assumptions.ts";
import type { BatchId, BatchUpload, BatchView, CarReport, ImportProfile, ImportRequest, StopRef } from "../../shared/cars.ts";
import type { CodeType, NetworkNode, PlaceRef, PlaceRole, ShopDraft, ShopId } from "../../shared/places.ts";
import type { Instant } from "../../shared/time.ts";
import { read, useQuery, write } from "./query.ts";

export type { AppError, Meta } from "../../shared/app.ts";
export type { QueryState } from "./query.ts";

/** A batch row, as the URL names it. */
export interface RowKey {
  batchId: BatchId;
  row: number;
}

const rowParams = ({ batchId, row }: RowKey) => ({ batchId, row: String(row) });

// ---- reads ----
export const useMeta = () => useQuery("GET /api/meta", {});
export const useAssumptions = () => useQuery("GET /api/assumptions", {});
export const useImportProfile = () => useQuery("GET /api/import-profile", {});
export const useShops = () => useQuery("GET /api/shops", {});
export const useCodeSets = () => useQuery("GET /api/codes", {});
export const useBatches = () => useQuery("GET /api/batches", {});

/** Autocomplete for a place input. Empty text asks nothing. */
export const usePlaceSuggestions = (text: string, role: PlaceRole) =>
  useQuery("GET /api/places/suggest", text.trim() ? { query: { q: text, role } } : null);

/** What the network makes of one place: the hint under an input. */
export const usePlace = (ref: PlaceRef | null, role: PlaceRole) =>
  useQuery("POST /api/places/resolve", ref ? { body: { ref, role } } : null);

/** The morning list. Reads again every 400 ms while the server is still routing rows. */
export const useBatchView = (batchId: BatchId | null) =>
  useQuery("GET /api/batches/:batchId", batchId ? { params: { batchId } } : null, {
    pollMs: (view: BatchView) => (view.progress.checked < view.progress.total ? 400 : null),
  });

export const useBatchCar = (key: RowKey | null) =>
  useQuery("GET /api/batches/:batchId/cars/:row", key ? { params: rowParams(key) } : null);

/** The check of one car. Every screen that shows a verdict gets it here, for typed cars and batch rows alike. */
export const useCarCheck = (car: { report: CarReport; asOf: Instant } | null) =>
  useQuery("POST /api/check", car ? { body: car } : null);

// ---- one-off reads ----
/** The node a map click snaps to, or null when no track is that close. */
export const snapToNetwork = (lon: number, lat: number, withinKm: number): Promise<NetworkNode | null> =>
  read("GET /api/places/nearest", { query: { lon, lat, withinKm } });

// ---- changes ----
export const saveAssumptions = (assumptions: Assumptions) => write("PUT /api/assumptions", { body: assumptions });
export const saveImportProfile = (profile: ImportProfile) => write("PUT /api/import-profile", { body: profile });

export const saveShop = (draft: ShopDraft, id: ShopId | null) =>
  id ? write("PUT /api/shops/:shopId", { params: { shopId: id }, body: draft }) : write("POST /api/shops", { body: draft });
export const removeShop = (id: ShopId) => write("DELETE /api/shops/:shopId", { params: { shopId: id } });
export const importShops = (request: ImportRequest) => write("POST /api/shops/import", { body: request });

export const importCodes = (request: ImportRequest & { codeType: CodeType; label: string }) =>
  write("POST /api/codes/import", { body: request });
export const removeCodeSet = (codeType: CodeType) => write("DELETE /api/codes/:codeType", { params: { codeType } });

export const uploadBatch = (upload: BatchUpload) => write("POST /api/batches", { body: upload });
export const removeBatch = (batchId: BatchId) => write("DELETE /api/batches/:batchId", { params: { batchId } });

/** "Use for this batch row". */
export const saveFix = (key: RowKey, stops: StopRef[]) =>
  write("PUT /api/batches/:batchId/cars/:row/fix", { params: rowParams(key), body: { stops } });
export const revertFix = (key: RowKey) => write("DELETE /api/batches/:batchId/cars/:row/fix", { params: rowParams(key) });

