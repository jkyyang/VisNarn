"""Snap points to the rail graph and route between them (reused by Phase 2)."""
import math
import pickle
from pathlib import Path

import networkx as nx
import numpy as np
from scipy.spatial import cKDTree

ROOT = Path(__file__).resolve().parent.parent


class RailRouter:
    def __init__(self, graph_path=ROOT / "data/processed/rail_graph.pkl", mainline_only_snap=True):
        with open(graph_path, "rb") as fh:
            self.G = pickle.load(fh)
        # Snap only to nodes touching a mainline edge, so a city lands on the main track
        # rather than a random yard spur.
        nodes = [n for n in self.G if not mainline_only_snap
                 or any(d["net"] == "M" for *_, d in self.G.edges(n, data=True))]
        self.ids = np.array(nodes)
        self.xyz = np.array([self._xyz(self.G.nodes[n]["lon"], self.G.nodes[n]["lat"]) for n in nodes])
        self.tree = cKDTree(self.xyz)

    @staticmethod
    def _xyz(lon, lat):
        lo, la = math.radians(lon), math.radians(lat)
        return (math.cos(la) * math.cos(lo), math.cos(la) * math.sin(lo), math.sin(la))

    def snap(self, lon, lat):
        """Return (node_id, distance_km) of the nearest graph node."""
        d, i = self.tree.query(self._xyz(lon, lat))
        return int(self.ids[i]), d * 6371.0

    def route(self, a, b):
        """Shortest path a->b. Returns (km, [(lon, lat), ...]) following the track geometry."""
        nodes = nx.shortest_path(self.G, a, b, weight="km")
        coords, km = [], 0.0
        for u, v in zip(nodes, nodes[1:]):
            e = self.G[u][v]
            seg = e["geom"] if u < v else e["geom"][::-1]
            coords.extend(seg if not coords else seg[1:])
            km += e["km"]
        return km, coords
