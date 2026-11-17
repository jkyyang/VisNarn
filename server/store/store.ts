/**
 * Everything the user owns, on disk: shops, code sets, saved routes, the routing rules.
 *
 * The interface speaks domain types only. Tables, columns, SQL and the JSON inside the columns are
 * private to ./sqlite.ts, the only file that imports node:sqlite. Nothing derived is stored: no
 * route, no graph index. A saved place is an FRA id, coordinates, or a name the user owns.
 */
import type { Assumptions } from "../../shared/assumptions.ts";
import type { CodeSet, CodeType, NodeCode, Shop, ShopId } from "../../shared/places.ts";
import type { SavedRoute, SavedRouteId } from "../../shared/plans.ts";
import type { Instant } from "../../shared/time.ts";

export interface Store {
  /** True when opening created the database: the one moment the EXAMPLE rows are added. */
  readonly fresh: boolean;

  /**
   * Goes up on every write. Whatever is computed from stored data (resolved places) is valid for
   * the revision it was computed at, and for no other.
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

  savedRoutes: {
    /** By name ignoring case; ties in the order saved. */
    all(): SavedRoute[];
    get(id: SavedRouteId): SavedRoute | null;
    /** Insert, or replace by id (keeping its place among ties). */
    save(route: SavedRoute): void;
    remove(id: SavedRouteId): boolean;
  };

  settings: {
    /** DEFAULT_ASSUMPTIONS until the user saves their own. */
    assumptions(): Assumptions;
    saveAssumptions(assumptions: Assumptions): void;
  };

  close(): void;
}
