import { beforeAll, describe, expect, it } from "vitest";
import { RAILROADS } from "../../shared/railroads.ts";
import { ALL_RAILROADS_MASK, type RailGraph } from "./graph.ts";
import { INTERCHANGE_PENALTY_KM, REVERSE_KM } from "../rules.ts";
import { isSharpTurn, RouteError, type Router } from "./router.ts";
import { cityPoint, loadTestCore, nodePoint } from "./testing.ts";

let graph: RailGraph;
let router: Router;
const opt = { allowedMask: ALL_RAILROADS_MASK, passenger: false, interchangeKm: INTERCHANGE_PENALTY_KM, reverseKm: REVERSE_KM, turnAtStops: false };
const only = (...rr: string[]) => ({ ...opt, allowedMask: rr.reduce((m, r) => m | (1 << RAILROADS.indexOf(r as never)), 0) });
const at = (name: string) => cityPoint(graph, name);

beforeAll(() => {
  ({ graph, router } = loadTestCore());
});

describe("RailGraph", () => {
  it("unpacks the network", () => {
    expect(graph.nodeCount).toBeGreaterThan(100_000);
    expect(graph.edgeCount).toBeGreaterThan(graph.nodeCount);
  });
  it("maps FRA ids to nodes and back", () => {
    expect(graph.indexOf(graph.fraId(0))).toBe(0);
    expect(graph.indexOf(1 as never)).toBe(-1);
  });
  it("lets a point be served by one chosen railroad only", () => {
    const hit = graph.nearestNode(-97.34, 31.1)!;
    const all = graph.serving(nodePoint(graph, hit.node), { allowedMask: ALL_RAILROADS_MASK, passenger: true });
    const [first] = all.map((entry) => entry.line);
    expect(graph.serving({ ...nodePoint(graph, hit.node), only: first }, { allowedMask: ALL_RAILROADS_MASK, passenger: true }).map((entry) => entry.line)).toEqual([first]);
  });
  it("finds who serves Austin", () => {
    expect(graph.serving(at("Austin, TX"), { allowedMask: ALL_RAILROADS_MASK, passenger: true }).map((entry) => RAILROADS[entry.line])).toEqual(["UP"]);
  });
});

describe("the yard walk", () => {
  // Procor's Sarnia plant: its yard fans out north of the CN main line and joins it at the east end (FRA 628925).
  const inSarniaYard = () => graph.nearestNode(-82.3405, 42.9568, ALL_RAILROADS_MASK, 5, graph.atMask)!.node;
  const walk = (from: number, maxKm: number) => [...graph.yardWalk(from, ALL_RAILROADS_MASK, maxKm)];

  it("comes nearest first, from where it starts, each node reached over one yard segment from one before it", () => {
    const from = inSarniaYard();
    const steps = walk(from, 5);
    expect(steps[0]).toEqual({ node: from, km: 0, before: -1 });
    expect(steps.length).toBeGreaterThan(10);
    const seen = new Map(steps.map((step) => [step.node, step]));
    for (const [i, step] of steps.entries()) {
      if (i > 0) expect(step.km).toBeGreaterThanOrEqual(steps[i - 1].km);
      if (step.before < 0) continue;
      const edge = graph.edgeBetween(step.before, step.node);
      expect(graph.edgeYard[edge]).toBe(1);
      expect(step.km).toBeCloseTo(seen.get(step.before)!.km + graph.edgeKm[edge], 6);
    }
  });

  it("goes no further than it is told, and never on past a node on a line's own track", () => {
    const from = inSarniaYard();
    const near = walk(from, 0.3);
    expect(near.every((step) => step.km <= 0.3)).toBe(true);
    expect(near.length).toBeLessThan(walk(from, 5).length);
    const steps = walk(from, 5);
    const own = new Set(steps.filter((step) => step.node !== from && graph.ownTrack(step.node, ALL_RAILROADS_MASK)).map((step) => step.node));
    expect(own.size).toBeGreaterThan(0);
    expect(steps.filter((step) => own.has(step.before))).toEqual([]);
  });

  it("yardExit is the walk's first node on a line's own track: as before, the plant's lead to the main line, or the node itself", () => {
    const from = inSarniaYard();
    expect(graph.fraId(graph.yardExit(from, ALL_RAILROADS_MASK, 5)!)).toBe(628925);
    const exit = walk(from, 5).find((step) => graph.ownTrack(step.node, ALL_RAILROADS_MASK))!.node;
    expect(graph.yardExit(from, ALL_RAILROADS_MASK, 5)).toBe(exit);
    const main = graph.indexOf(628912 as never);
    expect(graph.yardExit(main, ALL_RAILROADS_MASK, 5)).toBe(main);
    expect(graph.yardExit(from, ALL_RAILROADS_MASK, 0.01)).toBeNull();
  });

  it("a lead runs from its foot over yard track to the join, through no other node on a line's own track", () => {
    const join = graph.indexOf(628925 as never);
    const { nodes, km } = graph.lead(-82.3376, 42.9596, join, ALL_RAILROADS_MASK, 5);
    expect(nodes.length).toBeGreaterThan(2);
    expect(nodes.at(-1)).toBe(join);
    for (let i = 1; i < nodes.length; i++) expect(graph.edgeYard[graph.edgeBetween(nodes[i - 1], nodes[i])]).toBe(1);
    expect(nodes.slice(0, -1).filter((node) => graph.ownTrack(node, ALL_RAILROADS_MASK))).toEqual([]);
    expect(km).toBeLessThanOrEqual(5);
  });
});

describe("Router", () => {
  it("routes Austin → Chicago single-line on UP", () => {
    const r = router.route([at("Austin, TX"), at("Chicago, IL")], opt);
    expect(r.legs.map((l) => l.railroad)).toEqual(["UP"]);
    expect(r.km).toBeGreaterThan(1700);
    expect(r.km).toBeLessThan(1900);
    expect(r.legs[0].subdivisions).toContain("PALESTINE");
  });
  it("interchanges when one railroad can't do it alone", () => {
    const r = router.route([at("Austin, TX"), at("Toronto, ON")], opt);
    expect(r.interchanges).toBeGreaterThanOrEqual(1);
    expect(r.legs[0].railroad).toBe("UP");
  });
  it("respects railroad restrictions", () => {
    expect(() => router.route([at("Austin, TX"), at("Chicago, IL")], only("BNSF"))).toThrow(RouteError);
  });
  it("passes through a via point", () => {
    const direct = router.route([at("Austin, TX"), at("Chicago, IL")], opt);
    const via = router.route([at("Austin, TX"), at("Kansas City, MO"), at("Chicago, IL")], opt);
    expect(via.km).toBeGreaterThan(direct.km - 1);
    const kc = at("Kansas City, MO");
    const passes = via.legs.some((l) => l.path.some(([x, y]) => Math.abs(x - kc.lon) < 0.2 && Math.abs(y - kc.lat) < 0.2));
    expect(passes).toBe(true);
  });
});

describe("train movement rules", () => {
  const sharpTurnsOutsideYards = (nodes: number[]) => {
    let bad = 0;
    for (let i = 1; i < nodes.length - 1; i++) {
      const e1 = graph.edgeBetween(nodes[i - 1], nodes[i]), e2 = graph.edgeBetween(nodes[i], nodes[i + 1]);
      const arriving = (graph.leaving(e1, nodes[i]) + 180) % 360;
      if ((e1 === e2 || isSharpTurn(arriving, graph.leaving(e2, nodes[i]))) && !(graph.edgeYard[e1] && graph.edgeYard[e2])) bad++;
    }
    return bad;
  };

  it("never reverses at a junction outside a yard (the Taylor, TX U-turn)", () => {
    const toShop = router.route([at("Taylor, TX"), at("Temple, TX"), at("North Little Rock, AR")], opt);
    for (const leg of toShop.legs) expect(sharpTurnsOutsideYards(leg.nodes)).toBe(0);
    // every reported reversal is at a yard, and says how the car arrived and left
    for (const r of toShop.reversals) {
      expect(graph.yardNode[r.node]).toBe(1);
      expect(isSharpTurn(r.arrivingDeg, r.leavingDeg) || r.arrivedOn === r.leftOn).toBe(true);
      expect(r.km).toBeGreaterThanOrEqual(0);
    }
  });

  it("keeps long routes free of sharp turns outside yards", () => {
    for (const [a, b] of [["Austin, TX", "Toronto, ON"], ["Seattle, WA", "Atlanta, GA"], ["Barstow, CA", "North Platte, NE"]]) {
      const r = router.route([at(a), at(b)], opt);
      for (const leg of r.legs) expect(sharpTurnsOutsideYards(leg.nodes)).toBe(0);
    }
  });
});
