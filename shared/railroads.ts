/**
 * The Class I railroads the network file knows, in the bit order graph.bin uses. This is the only
 * fixed list in the app, and the data dictates it: engine/core/graph.ts refuses a network whose
 * own list differs. Shops, codes and batches are all user data.
 */
export const RAILROADS = ["BNSF", "UP", "CSXT", "NS", "CN", "CPKC"] as const;
export type Railroad = (typeof RAILROADS)[number];
