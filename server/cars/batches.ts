/** Batches of cars: the morning list as uploaded, and the route fixes people saved on its rows. */
import { createHash, randomUUID } from "node:crypto";
import { AppError } from "../../shared/app.ts";
import type { Batch, BatchCar, BatchId, BatchUpload, CarReport, SavedFix, StopRef } from "../../shared/cars.ts";
import { instant } from "../../shared/time.ts";
import { openSource, readCars } from "../intake/intake.ts";
import type { Store } from "../store/store.ts";

export interface Batches {
  /** Newest first. */
  list(): Batch[];
  /**
   * Reads the upload through server/intake with the saved import profile and stores
   * it. Rows the import could not read are kept, with their issues, so the list can show them as
   * "Cannot check". Uploading the same content again returns the batch that is already there.
   */
  upload(upload: BatchUpload): Promise<Batch>;
  remove(id: BatchId): void;
  /**
   * The rows as they should be checked: file order, each with its saved fix as `stops`.
   * The one place a fix is laid over a row.
   */
  reports(id: BatchId): { reports: CarReport[]; fixed: ReadonlySet<number> };
  car(id: BatchId, row: number): BatchCar;
  saveFix(id: BatchId, row: number, stops: StopRef[]): SavedFix;
  revertFix(id: BatchId, row: number): void;
}

/** A batch is EXAMPLE data when its name says so: the seeded one does, and so may a user's practice upload. */
const EXAMPLE_NAME = /^EXAMPLE\b/;

/** Every method throws AppError("not-found") for an unknown batch or row. */
export function createBatches(store: Store): Batches {
  const batchOf = (id: BatchId): Batch => {
    const batch = store.batches.get(id);
    if (!batch) throw new AppError("not-found", "This batch does not exist any more. It may have been deleted.");
    return batch;
  };

  const rowOf = (batch: Batch, row: number): void => {
    if (!Number.isInteger(row) || row < 0 || row >= batch.rows) {
      throw new AppError("not-found", `The batch ${batch.name} has no row ${row + 1} (it has ${batch.rows}).`, "row");
    }
  };

  const reports = (id: BatchId) => {
    batchOf(id);
    const fixes = store.fixes.current(id);
    const rows = store.batches.reports(id).map((report, row) => {
      const fix = fixes.get(row);
      return fix ? { ...report, stops: fix.stops } : report;
    });
    return { reports: rows, fixed: new Set(fixes.keys()) as ReadonlySet<number> };
  };

  return {
    list: () => store.batches.all(),

    async upload(upload) {
      const parsed = await readCars(openSource(upload.source), store.settings.importProfile());
      const name = upload.name.trim() || upload.source.fileName;
      const batch: Batch = {
        id: randomUUID() as BatchId,
        name,
        asOf: upload.asOf,
        createdAt: instant(new Date()),
        source: parsed.source,
        rows: parsed.items.length,
        issues: parsed.issues,
        example: EXAMPLE_NAME.test(name),
      };
      // The same rows judged at the same moment are the same batch: a retried or double-clicked upload adds nothing.
      const key = createHash("sha256").update(`${parsed.contentHash}\u0000${upload.asOf}`).digest("hex");
      return store.batches.create(batch, parsed.items, key);
    },

    remove(id) {
      if (!store.batches.remove(id)) throw new AppError("not-found", "This batch does not exist any more. It may have been deleted.");
    },

    reports,

    car(id, row) {
      const batch = batchOf(id);
      rowOf(batch, row);
      const fix = store.fixes.current(id).get(row) ?? null;
      const report = store.batches.reports(id)[row];
      return { batch, row, report: fix ? { ...report, stops: fix.stops } : report, fix };
    },

    saveFix(id, row, stops) {
      rowOf(batchOf(id), row);
      if (!stops.length) throw new AppError("invalid", "Add at least one stop, or go back to the router's own route.", "stops");
      return store.fixes.save(id, row, stops, instant(new Date()));
    },

    revertFix(id, row) {
      rowOf(batchOf(id), row);
      store.fixes.revert(id, row, instant(new Date()));
    },
  };
}
