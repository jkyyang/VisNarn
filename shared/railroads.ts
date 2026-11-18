/**
 * The Class I railroads the network file knows, in the bit order graph.bin uses. This is the only
 * fixed list in the app, and the data dictates it: engine/core/graph.ts refuses a network whose
 * own list differs. Shops, codes and batches are all user data.
 */
export const RAILROADS = ["BNSF", "UP", "CSXT", "NS", "CN", "CPKC"] as const;
export type Railroad = (typeof RAILROADS)[number];

export const isClassI = (name: string): name is Railroad => (RAILROADS as readonly string[]).includes(name);

/**
 * What a stretch of route runs on: a Class I railroad, or one of the two groups of smaller railroads.
 * The network file knows a smaller railroad's class, not its name.
 */
export const LINES = [...RAILROADS, "regional", "short line"] as const;
export type Line = (typeof LINES)[number];

/** Regional (US Class II) railroads, short lines, and track owned by passenger agencies (Amtrak, Metra, GO, ...). */
export interface TrackIncluded {
  regional: boolean;
  shortLine: boolean;
  passenger: boolean;
}

/** Passenger-owned track only: the router then takes it only where no freight-owned way is close in length. */
export const DEFAULT_INCLUDE: TrackIncluded = { regional: false, shortLine: false, passenger: true };
