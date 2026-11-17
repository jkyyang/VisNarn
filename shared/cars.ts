/** Cars: what is reported about one, a batch of them, and what a check says. */
import type { Assumptions } from "./assumptions.ts";
import type { LngLat } from "./geo.ts";
import type { PlaceRef, PlaceResolution } from "./places.ts";
import type { Railroad } from "./railroads.ts";
import type { Approach, RouteOption, TriageGroup, Verdict } from "./route.ts";
import type { Instant, ZonelessRule } from "./time.ts";

export type BatchId = string & { readonly __brand: "BatchId" };

/** A node the route must pass through, added by a person to correct it. */
export interface StopRef {
  place: PlaceRef;
  note: string | null;
}

export type CarField = "carId" | "a" | "b" | "shop" | "stops" | "reportedAt" | "prepEnd";

/**
 * Everything a check needs to know about one car. Places are kept as they were given and resolved at
 * check time, so adding a missing shop or importing a code set repairs old rows without a new upload.
 * A time is null when it was missing or could not be read; such a car cannot be checked.
 */
export interface CarReport {
  carId: string;
  /** Last node passed. */
  a: PlaceRef;
  /** Next node ahead. */
  b: PlaceRef;
  shop: PlaceRef;
  stops: StopRef[];
  reportedAt: Instant | null;
  prepEnd: Instant | null;
}

export interface CheckProblem {
  /** What to fix. "route": the places are fine but no route joins them. */
  field: CarField | "assumptions" | "route";
  message: string;
}

/** Places as far as they resolved. Shown under the inputs whether or not the check went through. */
export interface PlaceResolutions<R extends PlaceResolution = PlaceResolution> {
  a: R;
  b: R;
  shop: R;
  stops: R[];
}

/** No verdict exists here, so an unreadable car cannot be drawn as "On time". */
export interface CannotCheck {
  outcome: "cannot-check";
  report: CarReport;
  places: PlaceResolutions;
  problems: [CheckProblem, ...CheckProblem[]];
}

export interface CheckedCar {
  outcome: "checked";
  report: CarReport;
  /** The same shape as a car that cannot be checked has, with every place known to have resolved. */
  places: PlaceResolutions<Extract<PlaceResolution, { ok: true }>>;
  reportedAt: Instant;
  prepEnd: Instant;
  /** Hours between the report and the "as of" time of the check. */
  positionAgeH: number;
  approach: Approach;
  /** Straight line from B to the shop, for "839 km vs straight line 631 km (1.3×)". */
  straightKm: number;
  /** Every distinct route found. The first is the router's pick, and the one a batch list is judged by. */
  options: [RouteOption, ...RouteOption[]];
  /** What produced these numbers, so a copied result can say so. */
  assumptions: Assumptions;
  graphVersion: string;
}

export type CarCheck = CannotCheck | CheckedCar;

/** Where a batch came from. */
export interface SourceInfo {
  kind: "csv" | "database";
  /** "EXAMPLE cars-nov17.csv". */
  label: string;
}

export interface RowIssue {
  /** 0-based position among the data rows; `line` is the line in the file, for "line 7 has no time zone". */
  row: number;
  line: number;
  field: CarField | null;
  message: string;
}

export interface Batch {
  id: BatchId;
  name: string;
  /** The moment the positions are judged against ("reports 0 days old"). */
  asOf: Instant;
  createdAt: Instant;
  source: SourceInfo;
  rows: number;
  /** What the import could not read. Rows named here show as "Cannot check" until fixed. */
  issues: RowIssue[];
  example: boolean;
}

/**
 * How a company export maps onto a CarReport. User data, saved on the server: no company's column
 * names are built in. Until the user saves one, it is the columns car_id, last_node, next_node,
 * reported_at, shop, prep_end, positions as free text, and zone-less times read in the laptop's zone.
 */
export interface ImportProfile {
  /** Header names in the source, matched case-insensitively. */
  columns: Record<Exclude<CarField, "stops">, string>;
  /** How the A and B cells are read: by the free-text rules, or as codes of one code set. */
  positions: "text" | { codeType: string };
  zonelessTimes: ZonelessRule;
}

/** Company data arrives as one of these. Adding the database is a new member here and a new source in server/intake. */
export type UploadSource = { kind: "csv"; fileName: string; text: string };

/** A new batch. It is read with the saved import profile: there is one profile, and it is changed by saving it. */
export interface BatchUpload {
  name: string;
  asOf: Instant;
  source: UploadSource;
}

export interface SavedFix {
  stops: StopRef[];
  savedAt: Instant;
}

/** One batch row, ready to open on the Route screen. `report.stops` already holds the saved fix. */
export interface BatchCar {
  batch: Batch;
  row: number;
  report: CarReport;
  fix: SavedFix | null;
}

export type CheckSummary =
  /** Still being routed. The list fills in as the server works through the batch. */
  | { outcome: "pending" }
  | { outcome: "cannot-check"; problems: [CheckProblem, ...CheckProblem[]] }
  | {
      outcome: "checked";
      verdict: Verdict;
      km: number;
      straightKm: number;
      railroads: Railroad[];
      /** Node B, for the overview map. */
      at: LngLat;
      /** Hours between the report and the batch's "as of" time, for "reports 0 days old". */
      positionAgeH: number;
    };

/** One line of the morning list. No geometry: the route is fetched for the selected car only. */
export interface CarSummary {
  row: number;
  carId: string;
  shop: string;
  /** The shop is one of Your shops marked EXAMPLE, so the row and the copied list say so. */
  shopExample: boolean;
  /** "Route set by you". */
  fixed: boolean;
  check: CheckSummary;
  /**
   * Which pile the car is on; null while it is pending. Decided on the server for every outcome
   * (a checked car: its verdict's group; a car that cannot be checked: check-first), so the page
   * never decides it.
   */
  group: TriageGroup | null;
}

export interface BatchView {
  batch: Batch;
  progress: { checked: number; total: number };
  /** Most urgent first: Act now (least margin first), Check first, OK, then rows still pending. */
  cars: CarSummary[];
}

/** A preview (commit: false) or the result (commit: true) of importing shops or codes. */
export interface ImportRequest {
  source: UploadSource;
  commit: boolean;
}

export interface ImportReport<T> {
  committed: boolean;
  ready: T[];
  /** Rows that did not match a node, listed for the person to fix. They are never saved. */
  issues: RowIssue[];
}
