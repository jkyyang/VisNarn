/**
 * Every route of the contract, mapped to the application. `Handlers` is keyed by `Api`, so a route
 * in shared/api.ts with no handler here (or a handler returning the wrong type) does not compile.
 *
 * A handler is one line: pick the pieces out of the request, call the app. Anything longer belongs
 * in the module that owns the knowledge.
 */
import type { Request, Res, Route } from "../../shared/api.ts";
import type { App } from "../app.ts";
import { SUGGESTIONS_SHOWN } from "../places/directory.ts";
import { savedRouteId, shopId } from "./decode.ts";

export interface HandlerContext {
  app: App;
  /** Aborted when the browser gives up on the request (a newer plan replaced it). */
  signal: AbortSignal;
}

export type Handlers = { [R in Route]: (request: Request<R>, context: HandlerContext) => Res<R> | Promise<Res<R>> };

export const handlers: Handlers = {
  "GET /api/places/suggest": ({ query }, { app }) => app.places.suggest(query.q, query.role, SUGGESTIONS_SHOWN),
  "POST /api/places/resolve": ({ body }, { app }) => app.places.resolve(body.ref, body.role),
  "GET /api/places/nearest": ({ query }, { app }) => app.places.nearest(query.lon, query.lat, query.withinKm),
  "POST /api/places/links": ({ body }, { app }) => app.places.links(body.lon, body.lat, body.ends),

  "GET /api/shops": (_request, { app }) => app.shops.list(),
  "POST /api/shops": ({ body }, { app }) => app.shops.save(body, null),
  "PUT /api/shops/:shopId": ({ params, body }, { app }) => app.shops.save(body, shopId(params.shopId)),
  "DELETE /api/shops/:shopId": ({ params }, { app }) => (app.shops.remove(shopId(params.shopId)), null),
  "POST /api/shops/import": ({ body }, { app }) => app.shops.import(body),

  "POST /api/route": ({ body }, { app, signal }) => app.plans.route(body, signal),
  "GET /api/saved-routes": (_request, { app }) => app.plans.saved(),
  "POST /api/saved-routes": ({ body }, { app }) => app.plans.save(body, null),
  "PUT /api/saved-routes/:routeId": ({ params, body }, { app }) => app.plans.save(body, savedRouteId(params.routeId)),
  "DELETE /api/saved-routes/:routeId": ({ params }, { app }) => (app.plans.remove(savedRouteId(params.routeId)), null),

  "POST /api/track": ({ body }, { app }) => body.paths.map((path) => app.track.follow(path)),
};
