/**
 * The engine's public surface. server/ and scripts/ import the engine from this file only; the rest
 * of engine/ (core/ above all, which speaks graph indexes) is internal.
 *
 *   const network = loadNetwork();                    // public/data, ~20 ms
 *   const router = createCarRouter(network);          // ~85 MB, one per thread
 *   const result = router.route(trip, "pick");        // stable ids in, stable ids out
 *   const track = loadTrackShapes(network);           // main thread only: routes drawn on the real track
 */
export { DEFAULT_NETWORK_DIR, loadNetwork, loadTrackShapes } from "./load.ts";
export { MAX_SNAP_KM, type City, type RailNetwork, type Snap } from "./network.ts";
export { combine, createCarRouter, tripKey, type CarRouter, type NoRoute, type Routed, type RouteResult, type Trip } from "./trip.ts";
export type { TrackShapes } from "./track.ts";
