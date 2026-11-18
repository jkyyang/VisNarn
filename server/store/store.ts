/**
 * Everything the user owns, on disk: shops and saved routes.
 *
 * The interface speaks domain types only. Tables, columns, SQL and the JSON inside the columns are
 * private to ./sqlite.ts, the only file that imports node:sqlite. Nothing derived is stored: no
 * route, no graph index. A saved place is an FRA id, coordinates, or a name the user owns.
 */
import type { Shop, ShopId } from "../../shared/places.ts";
import type { SavedRoute, SavedRouteId } from "../../shared/plans.ts";

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

  savedRoutes: {
    /** By name ignoring case; ties in the order saved. */
    all(): SavedRoute[];
    get(id: SavedRouteId): SavedRoute | null;
    /** Insert, or replace by id (keeping its place among ties). */
    save(route: SavedRoute): void;
    remove(id: SavedRouteId): boolean;
  };

  close(): void;
}
