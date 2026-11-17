/**
 * Railroad-aware routing, like a transit trip planner, with train movement rules.
 *
 * INTERNAL to engine/ (see graph.ts): legs, reversals and route ends here carry node and edge
 * indexes. engine/trip.ts turns a Route into the stable-id RoutePath the rest of the app sees.
 *
 * Search state = (directed track segment the car is on, line, interchanges used). A line is a Class I
 * railroad, or all regional railroads together, or all short lines together (graph.ts LINES).
 * - Moving onto the next segment needs the line to own or have trackage rights on it (cost = km), and
 *   passenger-owned track only when `passenger` is allowed (cost = PASSENGER_TRACK_COST × km).
 * - The turn between the arriving and leaving segment must be gentle (<= maxTurnDeg). A sharper turn is a
 *   reversal: trains cannot reverse at a switch, so it is only allowed when the car both arrives and leaves
 *   on yard track (it is switched onto another train inside the yard). A junction that merely touches a yard
 *   lead does not count. It costs `reverseKm` and is reported in Route.reversals so a person can check it.
 * - Changing line at a node is an interchange: allowed only where both lines have track, costs
 *   `interchangeKm` so the router prefers single-line routes.
 * Because state includes the direction of travel, a route can continue from where the previous one ended
 * (a via point, or the car's A→B approach) without turning back.
 */
import { LINES, MAX_SNAP_KM, type Line, type Point, type RailGraph, type Track } from "./graph.ts";

export interface Leg {
  railroad: Line;
  km: number;
  nodes: number[];
  path: [number, number][];
  subdivisions: string[];
  from: string;
  to: string;
}

export interface Reversal {
  node: number;
  position: [number, number];
  place: string;
  railroad: Line;
  /** The segments the car arrived and left on, and its heading on each: what the junction inspector shows. */
  arrivedOn: number;
  leftOn: number;
  arrivingDeg: number;
  leavingDeg: number;
  /** Track km from the start of the route to this point. */
  km: number;
}

/** Where a route ended and which way the car was moving, so the next route can continue from there. */
export interface RouteEnd {
  /** Segment the car arrived on, and the node it arrived at. */
  edge: number;
  node: number;
  railroad: number;
}

export interface Route {
  legs: Leg[];
  km: number;
  interchanges: number;
  reversals: Reversal[];
  /** Null when the route has no movement (start is already at the goal). */
  end: RouteEnd | null;
}

export interface RouteOptions extends Track {
  /** Cost of changing railroad, in km-equivalent. */
  interchangeKm: number;
  /** Cost of reversing direction in a yard, in km-equivalent. Default 100. */
  reverseKm?: number;
  /** Largest change of heading (degrees) allowed outside a yard. Default 90. */
  maxTurnDeg?: number;
}

/** How the first route starts: from a known move (continuing), or with the car's heading only. */
export type RouteStart = { continueFrom: RouteEnd } | { headingDeg: number };

export class RouteError extends Error {
  /** Index, in the points given to `route`, of the point that could not be served or reached; -1 when none. */
  readonly point: number;

  constructor(message: string, point = -1) {
    super(message);
    this.point = point;
  }
}

const NR = LINES.length;
const DEFAULT_REVERSE_KM = 100;
const DEFAULT_MAX_TURN = 90;
/**
 * Passenger-owned track, when allowed, costs this many times its km: a freight car takes it only where no
 * freight-owned way is close in length (a shop on a commuter line), not as a short cut through a city centre.
 */
const PASSENGER_TRACK_COST = 4;

/** Absolute difference between two headings, 0..180. */
export function turnDeg(fromHeading: number, toHeading: number): number {
  return Math.abs((((toHeading - fromHeading) % 360) + 540) % 360 - 180);
}

class MinHeap {
  private keys: number[] = [];
  private vals: number[] = [];
  get size() {
    return this.keys.length;
  }
  push(key: number, val: number) {
    const K = this.keys, V = this.vals;
    let i = K.length;
    K.push(key);
    V.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (K[p] <= key) break;
      K[i] = K[p];
      V[i] = V[p];
      i = p;
    }
    K[i] = key;
    V[i] = val;
  }
  pop(): [number, number] {
    const K = this.keys, V = this.vals;
    const top: [number, number] = [K[0], V[0]];
    const lk = K.pop()!, lv = V.pop()!;
    const n = K.length;
    if (n) {
      let i = 0;
      for (;;) {
        let l = 2 * i + 1;
        if (l >= n) break;
        if (l + 1 < n && K[l + 1] < K[l]) l++;
        if (K[l] >= lk) break;
        K[i] = K[l];
        V[i] = V[l];
        i = l;
      }
      K[i] = lk;
      V[i] = lv;
    }
    return top;
  }
}

/** One decoded search state: the car arrived at `node` over `edge` (or edge -1 = not moved yet). */
interface Step {
  edge: number;
  node: number;
  rr: number;
}

/**
 * A place the search may start from: node, railroad, the heading the car arrives with (null = any direction),
 * the segment it arrived on (-1 = none), the cost so far, and the steps that led here (for via points).
 */
interface Start {
  node: number;
  rr: number;
  heading: number | null;
  edge: number;
  cost: number;
  prefix: Step[];
}

/** A way of reaching a goal: total cost and every step from the very first start. */
interface Hit {
  cost: number;
  steps: Step[];
  heading: number | null;
}

/** At a via point, also keep arrivals up to this much costlier than the best: a costlier arrival direction may be the only one the car can leave by. */
const VIA_SLACK_KM = 1000;

export class Router {
  private readonly dist: Float32Array;
  private readonly prev: Int32Array;
  private readonly K: number;
  readonly graph: RailGraph;

  // No parameter properties in engine/ or server/: Node runs these files by stripping types only.
  constructor(graph: RailGraph, maxInterchanges = 3) {
    this.graph = graph;
    this.K = maxInterchanges;
    // Directed segments × railroads × interchange count. Float32 km is precise to metres at continental scale.
    const states = graph.edgeCount * 2 * NR * (maxInterchanges + 1);
    this.dist = new Float32Array(states);
    this.prev = new Int32Array(states);
  }

  /** Directed segment id: 2*edge when moving u→v (arriving at v), 2*edge+1 when moving v→u. */
  private dirEdge(edge: number, toward: number) {
    return 2 * edge + (this.graph.edgeV[edge] === toward ? 0 : 1);
  }

  private state(dir: number, rr: number, k: number) {
    return (dir * NR + rr) * (this.K + 1) + k;
  }

  private decode(s: number): Step & { k: number } {
    const k = s % (this.K + 1);
    const dr = (s - k) / (this.K + 1);
    const rr = dr % NR;
    const dir = (dr - rr) / NR;
    const edge = dir >> 1;
    const node = dir & 1 ? this.graph.edgeU[edge] : this.graph.edgeV[edge];
    return { edge, node, rr, k };
  }

  /** Heading of a car that arrived at `node` over `edge`: the reverse of the track leaving `node` back along it. */
  private arrivingHeading(edge: number, node: number) {
    return (this.graph.leaving(edge, node) + 180) % 360;
  }

  /**
   * Dijkstra from all starts to the goal nodes. Returns the cheapest hit, or with `collectSlackKm` every goal
   * arrival (each direction / railroad) up to that much costlier than the cheapest, for use as via-point starts.
   */
  private search(starts: Start[], goals: Map<number, number>, opt: RouteOptions, collectSlackKm: number | null): Hit[] {
    const g = this.graph;
    const { dist, prev } = this;
    const reverseKm = opt.reverseKm ?? DEFAULT_REVERSE_KM;
    const maxTurn = opt.maxTurnDeg ?? DEFAULT_MAX_TURN;
    dist.fill(Infinity);
    prev.fill(-1);
    const goalMask = new Map<number, number>();
    for (const [rr, n] of goals) goalMask.set(n, (goalMask.get(n) ?? 0) | (1 << rr));
    const heap = new MinHeap();
    // States reached straight from a start remember which start, so the path can be rebuilt.
    const startOf = new Map<number, Start>();

    const usable = (edge: number, rr: number) => g.edgeMask[edge] & (1 << rr) && (opt.passenger || !g.edgePassenger[edge]);
    const trackCost = (edge: number) => g.edgeKm[edge] * (g.edgePassenger[edge] ? PASSENGER_TRACK_COST : 1);

    /** Cost to leave `node` on `edge` for a car arriving with `heading` (null = free), or -1 if not allowed. */
    const leaveCost = (node: number, edge: number, arrivedOn: number, heading: number | null) => {
      if (heading === null) return 0;
      const sharp = edge === arrivedOn || turnDeg(heading, g.leaving(edge, node)) > maxTurn;
      if (!sharp) return 0;
      const insideYard = g.edgeYard[edge] && (arrivedOn < 0 ? g.yardNode[node] : g.edgeYard[arrivedOn]);
      return insideYard ? reverseKm : -1;
    };

    // dist is Float32: round the key the same way, or a popped key can look "stale" against its own rounded copy.
    const relax = (t: number, nd: number, from: number) => {
      const r = Math.fround(nd);
      if (r < dist[t]) {
        dist[t] = r;
        prev[t] = from;
        heap.push(r, t);
      }
    };

    for (const st of starts) {
      if (!(opt.allowedMask & (1 << st.rr))) continue;
      for (let k = 0; k <= this.K; k++) {
        // An interchange right at the start: same position, another railroad.
        const railroads = k === 0 ? [st.rr] : [];
        if (k === 1) for (let r2 = 0; r2 < NR; r2++) if (r2 !== st.rr && g.atMask[st.node] & (1 << r2) && opt.allowedMask & (1 << r2)) railroads.push(r2);
        for (const rr of railroads) {
          const base = st.cost + k * opt.interchangeKm;
          for (let j = g.adjOffset[st.node]; j < g.adjOffset[st.node + 1]; j++) {
            const e = g.adj[j];
            if (!usable(e, rr)) continue;
            const c = leaveCost(st.node, e, st.edge, st.heading);
            if (c < 0) continue;
            const t = this.state(this.dirEdge(e, g.other(e, st.node)), rr, k);
            const nd = Math.fround(base + c + trackCost(e));
            if (nd < dist[t]) {
              startOf.set(t, { ...st, rr });
              relax(t, nd, -1);
            }
          }
        }
      }
    }

    const hits: Hit[] = [];
    while (heap.size) {
      const [d, s] = heap.pop();
      if (d > dist[s]) continue;
      if (hits.length && (collectSlackKm === null || d > hits[0].cost + collectSlackKm)) break;
      const { edge, node, rr, k } = this.decode(s);
      const bit = 1 << rr;
      if ((goalMask.get(node) ?? 0) & bit) {
        // Rebuild now: the next search reuses prev[].
        const states = [s];
        while (prev[states[states.length - 1]] >= 0) states.push(prev[states[states.length - 1]]);
        states.reverse();
        const from = startOf.get(states[0])!;
        const steps = [...from.prefix, ...states.map((x) => this.decode(x)).map(({ edge: e, node: n, rr: r }) => ({ edge: e, node: n, rr: r }))];
        hits.push({ cost: d, steps, heading: this.arrivingHeading(edge, node) });
        if (collectSlackKm === null) break;
      }
      const heading = this.arrivingHeading(edge, node);
      for (let j = g.adjOffset[node]; j < g.adjOffset[node + 1]; j++) {
        const e = g.adj[j];
        if (!usable(e, rr)) continue;
        const c = leaveCost(node, e, edge, heading);
        if (c < 0) continue;
        relax(this.state(this.dirEdge(e, g.other(e, node)), rr, k), d + c + trackCost(e), s);
      }
      if (k < this.K) {
        const dir = this.dirEdge(edge, node);
        for (let r2 = 0; r2 < NR; r2++) {
          const b2 = 1 << r2;
          if (r2 === rr || !(g.atMask[node] & b2) || !(opt.allowedMask & b2)) continue;
          relax(this.state(dir, r2, k + 1), d + opt.interchangeKm, s);
        }
      }
    }
    return hits;
  }

  private firstStarts(p: Point, how: RouteStart | null, opt: RouteOptions): Start[] {
    if (how && "continueFrom" in how) {
      const { node, edge, railroad } = how.continueFrom;
      return [{ node, rr: railroad, heading: this.arrivingHeading(edge, node), edge, cost: 0, prefix: [{ edge, node, rr: railroad }] }];
    }
    const heading = how && "headingDeg" in how ? how.headingDeg : null;
    return [...this.graph.serving(p, opt)].map(([rr, node]) => ({ node, rr, heading, edge: -1, cost: 0, prefix: [{ edge: -1, node, rr }] }));
  }

  /**
   * Route through [start, ...vias, end]. Direction and railroad carry over at each via point, so a via
   * point never becomes a free reversal or interchange; every way of arriving at a via point is kept, so
   * the next part can pick the arrival the car can actually continue from. `start` continues an earlier
   * move or sets the car's heading at the first point.
   */
  route(points: Point[], opt: RouteOptions, start: RouteStart | null = null): Route {
    if (points.length < 2) throw new RouteError("Need at least two points.");
    let frontier = this.firstStarts(points[0], start, opt);
    if (!frontier.length) throw new RouteError(`No allowed mainline within ${MAX_SNAP_KM} km of ${points[0].label}.`, 0);
    for (let i = 0; i < points.length - 1; i++) {
      const from = points[i], to = points[i + 1];
      const last = i === points.length - 2;
      const goals = this.graph.serving(to, opt);
      if (!goals.size) throw new RouteError(`No allowed mainline within ${MAX_SNAP_KM} km of ${to.label}.`, i + 1);
      const already: Hit[] = frontier
        .filter((st) => goals.get(st.rr) === st.node && opt.allowedMask & (1 << st.rr))
        .map((st) => ({ cost: st.cost, steps: st.prefix, heading: st.heading }));
      const hits = [...already, ...this.search(frontier, goals, opt, last ? null : VIA_SLACK_KM)].sort((x, y) => x.cost - y.cost);
      if (!hits.length) {
        throw new RouteError(
          `No route from ${from.label} to ${to.label} with the railroads allowed, without reversing outside a yard.`,
          i + 1,
        );
      }
      if (last) return this.describe(hits[0].steps, opt, start);
      frontier = hits.map((h) => {
        const end = h.steps[h.steps.length - 1];
        return { node: end.node, rr: end.rr, edge: end.edge, heading: h.heading, cost: h.cost, prefix: h.steps };
      });
    }
    throw new RouteError("unreachable");
  }

  private describe(steps: Step[], opt: RouteOptions, start: RouteStart | null): Route {
    const g = this.graph;
    const maxTurn = opt.maxTurnDeg ?? DEFAULT_MAX_TURN;
    const legs: (Omit<Leg, "path" | "from" | "to"> & { rr: number })[] = [];
    const reversals: Reversal[] = [];
    let cur: (typeof legs)[number] | null = null;
    let heading: number | null =
      start && "headingDeg" in start ? start.headingDeg : steps[0].edge >= 0 ? this.arrivingHeading(steps[0].edge, steps[0].node) : null;
    let km = 0;
    for (let i = 1; i < steps.length; i++) {
      const a = steps[i - 1], b = steps[i];
      if (a.node === b.node && a.edge === b.edge) {
        cur = null; // interchange: same place, another railroad
        continue;
      }
      if (heading !== null && (b.edge === a.edge || turnDeg(heading, g.leaving(b.edge, a.node)) > maxTurn)) {
        reversals.push({
          node: a.node, position: [g.lon[a.node], g.lat[a.node]], place: g.nearestPlace(g.lon[a.node], g.lat[a.node]), railroad: LINES[b.rr],
          arrivedOn: a.edge, leftOn: b.edge, arrivingDeg: heading, leavingDeg: g.leaving(b.edge, a.node), km,
        });
      }
      km += g.edgeKm[b.edge];
      if (!cur || cur.rr !== b.rr) {
        cur = { rr: b.rr, railroad: LINES[b.rr], km: 0, nodes: [a.node], subdivisions: [] };
        legs.push(cur);
      }
      cur.km += g.edgeKm[b.edge];
      cur.nodes.push(b.node);
      const sd = g.meta.subdivs[g.edgeSubdiv[b.edge]];
      if (sd && cur.subdivisions[cur.subdivisions.length - 1] !== sd) cur.subdivisions.push(sd);
      heading = this.arrivingHeading(b.edge, b.node);
    }
    const out: Leg[] = legs.map(({ rr: _rr, ...l }) => {
      const path = l.nodes.map((n) => [g.lon[n], g.lat[n]] as [number, number]);
      const [x0, y0] = path[0], [x1, y1] = path[path.length - 1];
      return { ...l, path, from: g.nearestPlace(x0, y0), to: g.nearestPlace(x1, y1) };
    });
    const last = steps[steps.length - 1];
    return {
      legs: out,
      km: out.reduce((s, l) => s + l.km, 0),
      interchanges: Math.max(0, out.length - 1),
      reversals,
      end: last.edge >= 0 ? { edge: last.edge, node: last.node, railroad: last.rr } : null,
    };
  }
}
