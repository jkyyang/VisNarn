/** Two things every part of the app shares that are about the app itself, not about routes or places. */
import type { Railroad } from "./railroads.ts";

/** What the page needs to know about the server it is talking to. */
export interface Meta {
  /** Hash of graph.bin. Route caches are keyed by it; saved data never depends on it. */
  graphVersion: string;
  railroads: readonly Railroad[];
  /** True while every shop and batch is a seeded EXAMPLE row: the header shows "EXAMPLE DATA". */
  exampleOnly: boolean;
  /** Where the database file lives on this laptop, for the "data stays here" note. */
  storage: string;
}

/**
 * "invalid": the request cannot be carried out as given (`field` says which input).
 * "not-found" / "conflict": about a stored thing. "internal": a bug or the server is unreachable.
 */
export type AppErrorKind = "invalid" | "not-found" | "conflict" | "internal";

/**
 * A request the application refuses. Server modules throw it; the HTTP layer turns it into a status
 * and the page's data layer turns that back into the same error.
 */
export class AppError extends Error {
  readonly kind: AppErrorKind;
  readonly field: string | null;

  constructor(kind: AppErrorKind, message: string, field: string | null = null) {
    super(message);
    this.kind = kind;
    this.field = field;
  }
}
