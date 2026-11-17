/**
 * Everything the user owns, on disk: shops, code sets, batches, route fixes, assumptions.
 *
 * The interface speaks domain types only. Tables, columns, SQL and the JSON inside the columns are
 * private to ./sqlite.ts, the only file that imports node:sqlite. Nothing derived is stored: no
 * route, no verdict, no graph index. A saved place is an FRA id, coordinates, or a name the user owns.
 */
import type { Assumptions } from "../../shared/assumptions.ts";
import type { Batch, BatchId, CarReport, ImportProfile, SavedFix, StopRef } from "../../shared/cars.ts";
import type { CodeSet, CodeType, NodeCode, Shop, ShopId } from "../../shared/places.ts";
import type { Instant } from "../../shared/time.ts";

export interface Store {
  /** True when opening created the database: the one moment the EXAMPLE rows are added. */
  readonly fresh: boolean;

  /**
   * Goes up on every write. Whatever is computed from stored data (resolved places, a batch's
   * checks) is valid for the revision it was computed at, and for no other.
   */
  readonly revision: number;

  shops: {
    all(): Shop[];
    get(id: ShopId): Shop | null;
    /** Shops whose name or code equals the text, ignoring case. */
    named(text: string): Shop[];
    /** Insert or replace by id. Throws AppError("conflict") when another shop already has the code. */
    save(shop: Shop): void;
    remove(id: ShopId): boolean;
  };

  codes: {
    sets(): CodeSet[];
    /** Exact code (ignoring case, as people type it), in one code set or (codeType null) in every set. */
    find(code: string, codeType: CodeType | null): NodeCode[];
    /** For autocomplete: codes or names starting with the text. */
    search(text: string, limit: number): NodeCode[];
    /** Importing a code set replaces it whole, so importing the same file twice changes nothing. */
    replaceSet(set: { codeType: CodeType; label: string }, codes: NodeCode[], at: Instant): void;
    removeSet(codeType: CodeType): boolean;
  };

  batches: {
    /** Newest first. */
    all(): Batch[];
    get(id: BatchId): Batch | null;
    /**
     * Stores a batch and its rows in one transaction. `contentHash` identifies the upload: if a
     * batch with the same hash exists, nothing is written and that batch is returned.
     */
    create(batch: Batch, reports: CarReport[], contentHash: string): Batch;
    /** Also removes the batch's rows and fixes. */
    remove(id: BatchId): boolean;
    /** Rows in file order, as imported: `stops` is always empty here (fixes are kept apart). */
    reports(id: BatchId): CarReport[];
  };

  fixes: {
    /** The fix in force for each row that has one. */
    current(batchId: BatchId): Map<number, SavedFix>;
    /** Appends a revision. Saving the stops already in force appends nothing and returns that fix. */
    save(batchId: BatchId, row: number, stops: StopRef[], at: Instant): SavedFix;
    /** Marks the fix in force as reverted. It stays in the table: the history is append-only. */
    revert(batchId: BatchId, row: number, at: Instant): void;
  };

  settings: {
    /** DEFAULT_ASSUMPTIONS until the user saves their own. */
    assumptions(): Assumptions;
    saveAssumptions(assumptions: Assumptions): void;
    importProfile(): ImportProfile;
    saveImportProfile(profile: ImportProfile): void;
  };

  close(): void;
}
