/** Messages between the route planner and its worker threads. Used by ./planner.ts and ./worker.ts only. */
import type { RouteResult, Trip } from "../../engine/index.ts";
import type { RouteStrategy } from "../../shared/route.ts";

export interface WorkerData {
  networkDir: string;
}

export interface Job {
  id: number;
  trip: Trip;
  strategy: RouteStrategy;
}

export type JobResult = { id: number; result: RouteResult } | { id: number; failed: string };
