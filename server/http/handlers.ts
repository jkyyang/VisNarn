/**
 * Every route of the contract, mapped to the application. `Handlers` is keyed by `Api`, so a route
 * in shared/api.ts with no handler here (or a handler returning the wrong type) does not compile.
 *
 * A handler is one line: pick the pieces out of the request, call the app. Anything longer belongs
 * in the module that owns the knowledge.
 */
import type { Request, Res, Route } from "../../shared/api.ts";
import type { App } from "../app.ts";
import { batchId, codeType, rowNumber, shopId } from "./decode.ts";

export interface HandlerContext {
  app: App;
  /** Aborted when the browser gives up on the request (a newer check replaced it). */
  signal: AbortSignal;
}

export type Handlers = { [R in Route]: (request: Request<R>, context: HandlerContext) => Res<R> | Promise<Res<R>> };

export const handlers: Handlers = {
  "GET /api/meta": (_request, { app }) => app.meta(),

  "GET /api/assumptions": (_request, { app }) => app.settings.assumptions(),
  "PUT /api/assumptions": ({ body }, { app }) => app.settings.saveAssumptions(body),
  "GET /api/import-profile": (_request, { app }) => app.settings.importProfile(),
  "PUT /api/import-profile": ({ body }, { app }) => app.settings.saveImportProfile(body),

  "GET /api/places/suggest": ({ query }, { app }) => app.places.suggest(query.q, query.role, 8),
  "POST /api/places/resolve": ({ body }, { app }) => app.places.resolve(body.ref, body.role),
  "GET /api/places/nearest": ({ query }, { app }) => app.places.nearest(query.lon, query.lat, query.withinKm),

  "GET /api/shops": (_request, { app }) => app.shops.list(),
  "POST /api/shops": ({ body }, { app }) => app.shops.save(body, null),
  "PUT /api/shops/:shopId": ({ params, body }, { app }) => app.shops.save(body, shopId(params.shopId)),
  "DELETE /api/shops/:shopId": ({ params }, { app }) => (app.shops.remove(shopId(params.shopId)), null),
  "POST /api/shops/import": ({ body }, { app }) => app.shops.import(body),

  "GET /api/codes": (_request, { app }) => app.codes.sets(),
  "POST /api/codes/import": ({ body }, { app }) => app.codes.import(body),
  "DELETE /api/codes/:codeType": ({ params }, { app }) => (app.codes.remove(codeType(params.codeType)), null),

  "GET /api/batches": (_request, { app }) => app.batches.list(),
  "POST /api/batches": ({ body }, { app }) => app.batches.upload(body),
  "GET /api/batches/:batchId": ({ params }, { app }) => app.checks.batch(batchId(params.batchId)),
  "DELETE /api/batches/:batchId": ({ params }, { app }) => (app.batches.remove(batchId(params.batchId)), null),
  "GET /api/batches/:batchId/cars/:row": ({ params }, { app }) => app.batches.car(batchId(params.batchId), rowNumber(params.row)),
  "PUT /api/batches/:batchId/cars/:row/fix": ({ params, body }, { app }) =>
    app.batches.saveFix(batchId(params.batchId), rowNumber(params.row), body.stops),
  "DELETE /api/batches/:batchId/cars/:row/fix": ({ params }, { app }) =>
    (app.batches.revertFix(batchId(params.batchId), rowNumber(params.row)), null),

  "POST /api/check": ({ body }, { app, signal }) => app.checks.car(body.report, body.asOf, signal),
};
