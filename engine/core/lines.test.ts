/** Which track a route may use: regional railroads, short lines and passenger-owned track, on a small made-up network. */
import { describe, expect, it } from "vitest";
import { LINES, RAILROADS } from "../../shared/railroads.ts";
import { REGIONAL, RailGraph, SHORT_LINE, type GraphMeta } from "./graph.ts";
import { REVERSE_KM } from "../rules.ts";
import { Router, type RouteOptions } from "./router.ts";
import { nodePoint } from "./testing.ts";

const BNSF = 1 << RAILROADS.indexOf("BNSF");
const PASSENGER_OWNED = 2;

/**
 * Four ways from A (0, 0) to Z (1, 0), each through its own middle node:
 *   north (0.5, 0.3)    BNSF-owned            40 km
 *   (0.5, 0.1)          a regional railroad   20 km
 *   (0.5, -0.1)         a short line          15 km
 *   south (0.5, -0.3)   commuter-owned, BNSF has trackage rights   35 km
 */
const nodes: [number, number][] = [[0, 0], [1, 0], [0.5, 0.3], [0.5, 0.1], [0.5, -0.1], [0.5, -0.3]];
const A = 0, Z = 1, COMMUTER = 5;
const ways: { middle: number; mask: number; km: number; flags: number }[] = [
  { middle: 2, mask: BNSF, km: 40, flags: 0 },
  { middle: 3, mask: 1 << REGIONAL, km: 20, flags: 0 },
  { middle: 4, mask: 1 << SHORT_LINE, km: 15, flags: 0 },
  { middle: COMMUTER, mask: BNSF, km: 35, flags: PASSENGER_OWNED },
];

/** Compass heading from p to q on this flat little map. */
const heading = (p: [number, number], q: [number, number]) => Math.round(((Math.atan2(q[0] - p[0], q[1] - p[1]) * 180) / Math.PI + 360) % 360);

/** graph.bin, as pipeline/export_web_graph.py writes it. */
function graphBin(): RailGraph {
  const edges = ways.flatMap((w) => [[A, w.middle, w], [w.middle, Z, w]] as const);
  const n = nodes.length, e = edges.length;
  const pad = (4 - (n % 4)) % 4;
  const buf = new ArrayBuffer(8 + n * 9 + pad + e * 20);
  const view = new DataView(buf);
  let o = 0;
  const u32 = (x: number) => (view.setUint32(o, x, true), (o += 4));
  const f32 = (x: number) => (view.setFloat32(o, x, true), (o += 4));
  const u16 = (x: number) => (view.setUint16(o, x, true), (o += 2));
  const u8 = (x: number) => view.setUint8(o++, x);
  u32(n);
  u32(e);
  for (const [lon, lat] of nodes) f32(lon), f32(lat);
  for (let i = 0; i < n; i++) u8(edges.filter(([a, b]) => a === i || b === i).reduce((m, [, , w]) => m | w.mask, 0));
  o += pad;
  for (const [a] of edges) u32(a);
  for (const [, b] of edges) u32(b);
  for (const [, , w] of edges) f32(w.km / 2);
  for (const [, , w] of edges) u8(w.mask);
  for (let k = 0; k < e; k++) u16(0);
  for (const [a, b] of edges) u16(heading(nodes[a], nodes[b]));
  for (const [a, b] of edges) u16(heading(nodes[b], nodes[a]));
  for (const [, , w] of edges) u8(w.flags);
  const meta: GraphMeta = { lines: [...LINES], pad, subdivs: [""], fra_ids: nodes.map((_, i) => 1000 + i), places: { "A, XX": nodes[A] } };
  return new RailGraph(buf, meta);
}

const graph = graphBin();
const router = new Router(graph);
const route = (to: number, include: Partial<{ regional: boolean; shortLine: boolean; passenger: boolean }>) => {
  const opt: RouteOptions = {
    allowedMask: BNSF | (include.regional ? 1 << REGIONAL : 0) | (include.shortLine ? 1 << SHORT_LINE : 0),
    passenger: include.passenger ?? false,
    interchangeKm: 1,
    reverseKm: REVERSE_KM,
  };
  return router.route([nodePoint(graph, A), nodePoint(graph, to)], opt);
};
const way = (r: ReturnType<typeof route>) => ({ km: r.km, lines: r.legs.map((leg) => leg.railroad) });

describe("track a route may use", () => {
  it("uses Class I track only by default", () => {
    expect(way(route(Z, {}))).toEqual({ km: 40, lines: ["BNSF"] });
  });
  it("takes a regional railroad or a short line only when it is ticked", () => {
    expect(way(route(Z, { regional: true }))).toEqual({ km: 20, lines: ["regional"] });
    expect(way(route(Z, { shortLine: true }))).toEqual({ km: 15, lines: ["short line"] });
  });
  it("never uses commuter-owned track unless ticked, and then prefers freight-owned track of similar length", () => {
    expect(() => route(COMMUTER, {})).toThrow();
    expect(way(route(Z, { passenger: true }))).toEqual({ km: 40, lines: ["BNSF"] });
    // The commuter line is the only way to its middle node: ticked, the route takes it.
    expect(way(route(COMMUTER, { passenger: true }))).toEqual({ km: 17.5, lines: ["BNSF"] });
  });
});
