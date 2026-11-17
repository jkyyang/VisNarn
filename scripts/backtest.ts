/**
 * Headless backtest (SCOPE milestone M2): run completed shop trips through the same engine the
 * server uses and compare modelled with actual hours. No HTTP, no database: the engine alone.
 *
 *   npm run backtest -- trips.csv
 */
import { createCarRouter, loadNetwork, travelHours, type Trip } from "../engine/index.ts";
import { DEFAULT_ASSUMPTIONS } from "../shared/assumptions.ts";

export interface CompletedTrip {
  trip: Trip;
  actualHours: number;
}

export interface BacktestRow {
  km: number;
  interchanges: number;
  modelHours: number;
  actualHours: number;
  /** actual ÷ model: the distribution of this ratio (P10 / P50 / P90) is what calibrates the speed. */
  ratio: number;
}

export function backtest(trips: CompletedTrip[]): BacktestRow[] {
  const router = createCarRouter(loadNetwork());
  return trips.flatMap(({ trip, actualHours }) => {
    const result = router.route(trip, "pick");
    if (!result.ok) return [];
    const { km, interchanges } = result.path;
    const modelHours = travelHours(km, interchanges, DEFAULT_ASSUMPTIONS.timing);
    return [{ km, interchanges, modelHours, actualHours, ratio: actualHours / modelHours }];
  });
}

// TODO entry: read the trips file through server/intake (the same door as every other company file),
//       resolve places with a Directory on a ":memory:" store, print P10 / P50 / P90 of `ratio`.
