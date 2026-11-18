/**
 * Routes drawn on the real track. graph.bin holds each track segment as a straight step between its
 * two nodes, which is all routing needs. track.bin holds each segment's surveyed line (the NARN
 * geometry, thinned to within 2 m), so the map can draw a route along the track when Real tracks is on.
 *
 * track.bin layout (little-endian), written by pipeline/export_web_graph.py:
 *   uint32 nEdges   uint32[nEdges + 1] first point of each edge   float32[nPoints * 2] lon,lat
 * Edge k's points are the ones between its two nodes, in graph.bin edge order, from edgeU toward edgeV.
 * The nodes themselves are not repeated: their coordinates are in graph.bin.
 */
import { round5, type LngLat } from "../shared/geo.ts";
import { coreOf, type RailNetwork } from "./network.ts";

export interface TrackShapes {
  /**
   * The same path, with each step between two neighbouring network nodes drawn along that segment's
   * surveyed line. Any other step (the straight A → B line when no track joins them) stays straight.
   */
  follow(path: LngLat[]): LngLat[];
}

export function openTrackShapes(network: RailNetwork, bin: ArrayBuffer): TrackShapes {
  const graph = coreOf(network);
  const [edges] = new Uint32Array(bin, 0, 1);
  if (edges !== graph.edgeCount) throw new Error(`track.bin has ${edges} segments, graph.bin ${graph.edgeCount}: they are from different builds. Run "npm run data".`);
  const first = new Uint32Array(bin, 4, edges + 1);
  const points = new Float32Array(bin, 4 * (edges + 2));
  if (points.length !== 2 * first[edges]) throw new Error(`track.bin size mismatch: ${points.length / 2} points, ${first[edges]} expected`);

  // Paths name nodes by their coordinates rounded to 5 decimals (engine/trip.ts). Two nodes can round
  // to the same point (2 pairs in 142,835), so each point keeps every node there.
  const key = (lon: number, lat: number) => `${round5(lon)},${round5(lat)}`;
  const nodesAt = new Map<string, number[]>();
  for (let n = 0; n < graph.nodeCount; n++) {
    const k = key(graph.lon[n], graph.lat[n]);
    const known = nodesAt.get(k);
    if (known) known.push(n);
    else nodesAt.set(k, [n]);
  }

  /** The segment from p to q, and whether it runs that way in track.bin; null when no segment joins them. */
  const segment = (p: LngLat, q: LngLat): { edge: number; forward: boolean } | null => {
    for (const a of nodesAt.get(key(...p)) ?? []) {
      for (const b of nodesAt.get(key(...q)) ?? []) {
        const edge = graph.edgeBetween(a, b);
        if (edge >= 0) return { edge, forward: graph.edgeU[edge] === a };
      }
    }
    return null;
  };

  return {
    follow(path) {
      const out: LngLat[] = [];
      const add = (point: LngLat) => {
        const last = out[out.length - 1];
        if (!last || last[0] !== point[0] || last[1] !== point[1]) out.push(point);
      };
      path.forEach((q, i) => {
        const step = i > 0 ? segment(path[i - 1], q) : null;
        if (step) {
          const from = first[step.edge], to = first[step.edge + 1];
          for (let j = 0; j < to - from; j++) {
            const k = step.forward ? from + j : to - 1 - j;
            add([round5(points[2 * k]), round5(points[2 * k + 1])]);
          }
        }
        add(q);
      });
      return out;
    },
  };
}
