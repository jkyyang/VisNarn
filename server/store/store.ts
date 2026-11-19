/**
 * Everything the user owns: shops and saved routes, in PostgreSQL.
 *
 * The interface speaks domain types only. Tables, columns and SQL are private to ./postgres.ts, the only
 * file that talks to the database. Nothing derived is stored: no route, no graph index. A saved place is
 * an FRA id, coordinates, a shop, or a name the user typed.
 */
import type { Shop, ShopId } from "../../shared/places.ts";
import type { SavedRoute, SavedRouteId } from "../../shared/plans.ts";

export interface Store {
  shops: {
    /** The shops not deleted, by name ignoring case. */
    all(): Promise<Shop[]>;
    /** Null for an unknown or deleted shop. */
    get(id: ShopId): Promise<Shop | null>;
    /** Shops whose name or code equals the text, ignoring case. */
    named(text: string): Promise<Shop[]>;
    /** Insert or replace by id. Throws AppError("conflict") when another shop already has the code. */
    save(shop: Shop): Promise<void>;
    /** Deletes the shop for the user; a saved route that names it still can (it then reads as deleted). */
    remove(id: ShopId): Promise<boolean>;
  };

  savedRoutes: {
    /** By name ignoring case; ties in the order saved. */
    all(): Promise<SavedRoute[]>;
    get(id: SavedRouteId): Promise<SavedRoute | null>;
    /** Insert, or replace by id (keeping its place among ties). Throws AppError("invalid") for a shop that never existed. */
    save(route: SavedRoute): Promise<void>;
    remove(id: SavedRouteId): Promise<boolean>;
  };

  close(): Promise<void>;
}
