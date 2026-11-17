import { RAILROADS, type Railroad } from "./railroads.ts";

/** Where the speed came from. Until it is fitted from car history, every time is shown as a rough estimate. */
export type EstimateBasis = { kind: "placeholder" } | { kind: "calibrated"; trips: number; scope: "lane" | "region" | "global" };

/**
 * The numbers behind every check, in three groups that change different things. The grouping is the
 * cache seam: a route depends on `routing` only, so editing `timing` or `flags` re-times and
 * re-sorts every car without routing any of them again.
 */
export interface Assumptions {
  /** Decides which route is found. */
  routing: {
    allowed: Railroad[];
    /** Extra km the router accepts to avoid changing railroad. Adds no time. */
    interchangePenaltyKm: number;
  };
  /** Decides when the car arrives on a given route. */
  timing: {
    speedKmPerDay: number;
    interchangeDelayH: number;
    /** Prep must end this long before the earliest arrival to count as "On time". */
    bufferH: number;
    basis: EstimateBasis;
  };
  /** Decides when a route or a position is sent to "Check first" instead of being trusted. */
  flags: {
    /** Route km ÷ straight-line km above this is a detour worth a look. */
    detourRatio: number;
    /** A position report older than this, at the batch's "as of" time, is stale. */
    positionAgeH: number;
  };
}

/** Placeholders until they are agreed with the team and fitted from car history. */
export const DEFAULT_ASSUMPTIONS: Assumptions = {
  routing: { allowed: [...RAILROADS], interchangePenaltyKm: 500 },
  timing: { speedKmPerDay: 400, interchangeDelayH: 24, bufferH: 24, basis: { kind: "placeholder" } },
  flags: { detourRatio: 1.5, positionAgeH: 48 },
};
