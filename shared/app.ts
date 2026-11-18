/** What every part of the app shares about the app itself. */

/**
 * "invalid": the request cannot be carried out as given (`field` says which input).
 * "not-found" / "conflict": about a stored thing. "internal": a bug or the server is unreachable.
 */
export const APP_ERROR_KINDS = ["invalid", "not-found", "conflict", "internal"] as const;
export type AppErrorKind = (typeof APP_ERROR_KINDS)[number];

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
