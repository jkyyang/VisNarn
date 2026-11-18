/** Routes drawn on the real track: which way each segment's line runs, and how the lines join. */
import { beforeAll, describe, expect, it } from "vitest";
import { pathKm, round5, type LngLat } from "../shared/geo.ts";
import { loadNetwork, loadTrackShapes } from "./load.ts";
import { coreOf, type RailNetwork } from "./network.ts";
import { openTrackShapes } from "./track.ts";

let network: RailNetwork;
let u: LngLat, v: LngLat, far: LngLat;
beforeAll(() => {
  network = loadNetwork();
  const graph = coreOf(network);
  const at = (node: number): LngLat => [round5(graph.lon[node]), round5(graph.lat[node])];
  [u, v] = [at(graph.edgeU[0]), at(graph.edgeV[0])];
  far = at(graph.edgeV[graph.edgeCount - 1]);
});

/** A track.bin for this network in which edge 0, from edgeU to edgeV, has `points` between its nodes and every other edge none. */
function trackBin(points: LngLat[], edges = coreOf(network).edgeCount): ArrayBuffer {
  const first = new Uint32Array(edges + 1).fill(points.length);
  first[0] = 0;
  const bytes = new Uint8Array(4 * (edges + 2) + 8 * points.length);
  new Uint32Array(bytes.buffer, 0, edges + 2).set([edges, ...first]);
  new Float32Array(bytes.buffer, 4 * (edges + 2)).set(points.flat());
  return bytes.buffer;
}

describe("TrackShapes.follow", () => {
  it("draws a segment along its line in the direction travelled", () => {
    const p1: LngLat = [round5(u[0] + 0.001), round5(u[1] + 0.002)];
    const p2: LngLat = [round5(v[0] - 0.001), round5(v[1] - 0.002)];
    const track = openTrackShapes(network, trackBin([p1, p2]));
    const fl = (p: LngLat) => p.map((x) => round5(Math.fround(x))) as LngLat;
    expect(track.follow([u, v])).toEqual([u, fl(p1), fl(p2), v]);
    expect(track.follow([v, u])).toEqual([v, fl(p2), fl(p1), u]);
  });

  it("joins consecutive segments without repeating the node between them, or a line point lying on a node", () => {
    const track = openTrackShapes(network, trackBin([u, v]));
    expect(track.follow([u, v, u])).toEqual([u, v, u]);
  });

  it("leaves a step that no single segment joins straight, and a path of one point as it is", () => {
    const track = openTrackShapes(network, trackBin([]));
    expect(track.follow([u, far])).toEqual([u, far]);
    expect(track.follow([u])).toEqual([u]);
    expect(track.follow([])).toEqual([]);
  });

  it("refuses a track.bin from another build of the network", () => {
    expect(() => openTrackShapes(network, trackBin([], 3))).toThrow(/different builds/);
  });

  it("on the real track.bin, each segment drawn from either end is as long as its track km", () => {
    const track = loadTrackShapes(network);
    const graph = coreOf(network);
    const at = (node: number): LngLat => [round5(graph.lon[node]), round5(graph.lat[node])];
    for (let edge = 0; edge < graph.edgeCount; edge += 997) {
      const [a, b] = [at(graph.edgeU[edge]), at(graph.edgeV[edge])];
      const line = track.follow([a, b]);
      // A line run the wrong way would jump to the far end and back: about twice the segment's length too long.
      expect(Math.abs(pathKm(line) - graph.edgeKm[edge]), `edge ${edge}`).toBeLessThan(Math.max(0.05, 0.03 * graph.edgeKm[edge]));
      expect(track.follow([b, a]), `edge ${edge}`).toEqual([...line].reverse());
      for (let i = 1; i < line.length; i++) expect(line[i], `edge ${edge}`).not.toEqual(line[i - 1]);
    }
  });
});
