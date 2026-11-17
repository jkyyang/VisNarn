import { beforeAll, describe, expect, it } from "vitest";
import { RAILROADS } from "../../shared/railroads.ts";
import { ALL_RAILROADS_MASK, type RailGraph } from "./graph.ts";
import { RouteError, turnDeg, type Router } from "./router.ts";
import { cityPoint, loadTestCore } from "./testing.ts";

let graph: RailGraph;
let router: Router;
const opt = { allowedMask: ALL_RAILROADS_MASK, interchangeKm: 500 };
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
    const all = graph.serving(graph.nodePoint(hit.node));
    const [first] = [...all.keys()];
    expect([...graph.serving({ ...graph.nodePoint(hit.node), only: first }).keys()]).toEqual([first]);
  });
  it("finds who serves Austin", () => {
    expect([...graph.serving(at("Austin, TX")).keys()].map((i) => RAILROADS[i])).toEqual(["UP"]);
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
      if ((e1 === e2 || turnDeg(arriving, graph.leaving(e2, nodes[i])) > 90) && !(graph.edgeYard[e1] && graph.edgeYard[e2])) bad++;
    }
    return bad;
  };

  it("never reverses at a junction outside a yard (the Taylor, TX U-turn)", () => {
    const approach = router.route([at("Taylor, TX"), at("Temple, TX")], opt);
    const toShop = router.route([at("Temple, TX"), at("North Little Rock, AR")], opt, { continueFrom: approach.end! });
    for (const leg of toShop.legs) expect(sharpTurnsOutsideYards(leg.nodes)).toBe(0);
    // every reported reversal is at a yard, and says how the car arrived and left
    for (const r of toShop.reversals) {
      expect(graph.yardNode[r.node]).toBe(1);
      expect(turnDeg(r.arrivingDeg, r.leavingDeg) > 90 || r.arrivedOn === r.leftOn).toBe(true);
      expect(r.km).toBeGreaterThanOrEqual(0);
    }
  });

  it("keeps long routes free of sharp turns outside yards", () => {
    for (const [a, b] of [["Austin, TX", "Toronto, ON"], ["Seattle, WA", "Atlanta, GA"], ["Barstow, CA", "North Platte, NE"]]) {
      const r = router.route([at(a), at(b)], opt);
      for (const leg of r.legs) expect(sharpTurnsOutsideYards(leg.nodes)).toBe(0);
    }
  });

  it("continues in the direction the car was moving", () => {
    const ab = router.route([at("Austin, TX"), at("Taylor, TX")], opt);
    const onward = router.route([at("Taylor, TX"), at("Chicago, IL")], opt, { continueFrom: ab.end! });
    const first = onward.legs[0].nodes;
    const e0 = graph.edgeBetween(first[0], first[1]);
    const arriving = (graph.leaving(ab.end!.edge, ab.end!.node) + 180) % 360;
    const reversedAtStart = e0 === ab.end!.edge || turnDeg(arriving, graph.leaving(e0, first[0])) > 90;
    expect(reversedAtStart && !(graph.edgeYard[ab.end!.edge] && graph.edgeYard[e0])).toBe(false);
  });
});
