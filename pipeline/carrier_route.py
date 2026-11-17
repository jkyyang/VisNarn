"""Carrier-aware rail routing (like a transit trip planner).

State = (node, railroad). Moving along an edge is allowed only if that railroad owns
or has trackage rights on it (cost = km). Changing railroad at a node (an interchange)
is allowed only where both railroads have track, and costs `interchange_km`.

Usage:
  .venv/bin/python -I scripts/carrier_route.py "Austin, TX" "Chicago, IL"
  .venv/bin/python -I scripts/carrier_route.py -97.74,30.27 -87.63,41.88 --via -94.58,39.10
"""
import argparse
import heapq
import math
import pickle
import sys
from pathlib import Path

import numpy as np
from scipy.spatial import cKDTree

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "pipeline"))
from places import PLACES, nearest_place  # noqa: E402

CLASS1 = ["BNSF", "UP", "CSXT", "NS", "CN", "CPKC"]


def _xyz(lon, lat):
    lo, la = np.radians(lon), np.radians(lat)
    return np.stack([np.cos(la) * np.cos(lo), np.cos(la) * np.sin(lo), np.sin(la)], -1)


class CarrierRouter:
    def __init__(self, graph_path=ROOT / "data/processed/rail_graph.pkl"):
        with open(graph_path, "rb") as fh:
            self.G = pickle.load(fh)
        self.at = {n: set() for n in self.G}          # railroads present at each node
        for u, v, d in self.G.edges(data=True):
            self.at[u] |= d["carriers"]
            self.at[v] |= d["carriers"]
        # one KD-tree per railroad, mainline nodes only, to find who serves a place
        self.trees = {}
        for c in CLASS1:
            ids = [n for n in self.G if any(c in d["carriers"] and d["net"] == "M"
                                            for *_, d in self.G.edges(n, data=True))]
            xy = np.array([(self.G.nodes[n]["lon"], self.G.nodes[n]["lat"]) for n in ids])
            self.trees[c] = (np.array(ids), cKDTree(_xyz(xy[:, 0], xy[:, 1])))

    def serving(self, lon, lat, max_km=15.0):
        """Railroads with mainline within max_km: {railroad: (node, km)}."""
        out = {}
        for c, (ids, tree) in self.trees.items():
            d, i = tree.query(_xyz(np.array(lon), np.array(lat)))
            if d * 6371 <= max_km:
                out[c] = (int(ids[i]), d * 6371)
        return out

    def _search(self, starts, goals, allowed, interchange_km, max_interchanges):
        """Dijkstra over (node, railroad, n_interchanges). starts/goals: {railroad: node}."""
        pq, best, prev = [], {}, {}
        for c, n in starts.items():
            if c in allowed:
                s = (n, c, 0)
                best[s] = 0.0
                heapq.heappush(pq, (0.0, s))
        goal_set = {(n, c) for c, n in goals.items() if c in allowed}
        while pq:
            cost, s = heapq.heappop(pq)
            if cost > best.get(s, math.inf):
                continue
            n, c, k = s
            if (n, c) in goal_set:
                path = [s]
                while path[-1] in prev:
                    path.append(prev[path[-1]])
                return cost, path[::-1]
            steps = [((m, c, k), d["km"]) for m, d in self.G[n].items() if c in d["carriers"]]
            if k < max_interchanges:
                steps += [((n, c2, k + 1), interchange_km) for c2 in self.at[n] & allowed if c2 != c]
            for t, w in steps:
                nc = cost + w
                if nc < best.get(t, math.inf):
                    best[t], prev[t] = nc, s
                    heapq.heappush(pq, (nc, t))
        return math.inf, None

    def route(self, points, allowed=None, interchange_km=500.0, max_interchanges=3, snap_km=15.0):
        """points: [(lon, lat), ...] source, optional via points, destination."""
        allowed = set(allowed or CLASS1)
        legs, carry = [], None   # carry = railroad we arrived on, so a via point isn't a free switch
        for (a, b) in zip(points, points[1:]):
            sa, sb = self.serving(*a, snap_km), self.serving(*b, snap_km)
            if carry:
                sa = {carry[0]: carry[1]}
            if not sa or not sb:
                raise ValueError(f"no Class I mainline within {snap_km} km of {a if not sa else b}")
            cost, path = self._search({c: v[0] if isinstance(v, tuple) else v for c, v in sa.items()},
                                      {c: v[0] for c, v in sb.items()}, allowed, interchange_km,
                                      max_interchanges)
            if path is None:
                raise ValueError(f"no route {a} -> {b} with railroads {sorted(allowed)}")
            legs.extend(path if not legs else path[1:])
            carry = (path[-1][1], path[-1][0])
        return self._describe(legs)

    def _describe(self, states):
        segs, cur = [], None
        for (n, c, _), (m, c2, _) in zip(states, states[1:]):
            if n == m:                                   # interchange
                cur = None
                continue
            d = self.G[n][m]
            if cur is None or cur["railroad"] != c:
                cur = {"railroad": c, "km": 0.0, "subdivs": [], "nodes": [n]}
                segs.append(cur)
            cur["km"] += d["km"]
            cur["nodes"].append(m)
            sd = d.get("subdiv")
            if sd and (not cur["subdivs"] or cur["subdivs"][-1] != sd):
                cur["subdivs"].append(sd)
        for s in segs:
            a, b = (self.G.nodes[s["nodes"][i]] for i in (0, -1))
            s["from"], s["to"] = nearest_place(a["lon"], a["lat"]), nearest_place(b["lon"], b["lat"])
        return segs


def parse_point(text):
    if text in PLACES:
        return PLACES[text]
    lon, lat = (float(x) for x in text.split(","))
    return lon, lat


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("source"); ap.add_argument("dest")
    ap.add_argument("--via", action="append", default=[])
    ap.add_argument("--only", help="comma list of railroads allowed, e.g. UP or BNSF,NS")
    ap.add_argument("--interchange-km", type=float, default=500.0)
    a = ap.parse_args()
    r = CarrierRouter()
    pts = [parse_point(a.source)] + [parse_point(v) for v in a.via] + [parse_point(a.dest)]
    print("Served by:", {k: f"{v[1]:.1f} km" for k, v in r.serving(*pts[0]).items()}, "->",
          {k: f"{v[1]:.1f} km" for k, v in r.serving(*pts[-1]).items()})
    segs = r.route(pts, allowed=a.only.split(",") if a.only else None, interchange_km=a.interchange_km)
    total = sum(s["km"] for s in segs)
    print(f"\n{len(segs)} railroad leg(s), {len(segs) - 1} interchange(s), {total:,.0f} km ({total / 1.609:,.0f} mi)")
    for s in segs:
        print(f"  {s['railroad']:5s} {s['from']} -> {s['to']}: {s['km']:,.0f} km")
        print(f"        via subdivisions: {' > '.join(s['subdivs'][:12])}{' ...' if len(s['subdivs']) > 12 else ''}")


if __name__ == "__main__":
    main()
