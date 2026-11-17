"""Build a routing graph from the downloaded NARN Class I lines.

Nodes: FRA node IDs (FRFRANODE / TOFRANODE), positioned at segment endpoints.
Edges: line segments, weight = KM; `carriers` = Class I railroads that own or have\ntrackage rights on the segment. Parallel segments keep the shortest one,
but the edge stores its FRAARCID and full geometry for drawing paths later.
Outputs (data/processed/):
  rail_graph.pkl       networkx Graph (largest connected component)
  rail_nodes.csv       node_id, lon, lat, degree  (used for snapping)
"""
import csv
import json
import pickle
from pathlib import Path

import networkx as nx

ROOT = Path(__file__).resolve().parent.parent
CLASS1 = {"BNSF", "UP", "CSXT", "NS", "CN", "CPKC"}
# owners + trackage-rights holders = railroads allowed to run trains on the segment
CARRIER_COLS = ["RROWNER1", "RROWNER2", "RROWNER3"] + [f"TRKRGHTS{i}" for i in range(1, 10)]


def main():
    fc = json.loads((ROOT / "data/raw/narn_class1_lines.geojson").read_text())
    G = nx.Graph()
    skipped = 0
    for f in fc["features"]:
        p, g = f["properties"], f["geometry"]
        if not g or p["FRFRANODE"] is None or p["TOFRANODE"] is None:
            skipped += 1
            continue
        # MultiLineStrings in NARN are rare; flatten into one coordinate list.
        coords = g["coordinates"] if g["type"] == "LineString" else [c for part in g["coordinates"] for c in part]
        a, b = int(p["FRFRANODE"]), int(p["TOFRANODE"])
        if a == b:
            continue
        for n, xy in ((a, coords[0]), (b, coords[-1])):
            G.add_node(n, lon=round(xy[0], 6), lat=round(xy[1], 6))
        km = p["KM"] or 0.0
        carriers = {p[k] for k in CARRIER_COLS if p.get(k) in CLASS1}
        if G.has_edge(a, b):
            e = G[a][b]
            e["carriers"] |= carriers          # parallel tracks: union of who may run
            if e["km"] <= km:
                continue
            carriers = e["carriers"]
        # store geometry oriented from min(node) to max(node) so paths can re-orient it
        geom = coords if a < b else coords[::-1]
        G.add_edge(a, b, km=km, arc=p["FRAARCID"], net=p["NET"], owner=p["RROWNER1"], carriers=carriers,
                   subdiv=p["SUBDIV"], geom=[(round(x, 5), round(y, 5)) for x, y in geom])

    comps = sorted(nx.connected_components(G), key=len, reverse=True)
    print(f"raw graph: {G.number_of_nodes()} nodes, {G.number_of_edges()} edges, "
          f"{len(comps)} components, skipped {skipped}")
    print("largest components:", [len(c) for c in comps[:5]])
    H = G.subgraph(comps[0]).copy()
    print(f"kept LCC: {H.number_of_nodes()} nodes, {H.number_of_edges()} edges, "
          f"{sum(d['km'] for *_, d in H.edges(data=True)):,.0f} km")

    out = ROOT / "data/processed"
    with open(out / "rail_graph.pkl", "wb") as fh:
        pickle.dump(H, fh, protocol=pickle.HIGHEST_PROTOCOL)
    with open(out / "rail_nodes.csv", "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["node_id", "lon", "lat", "degree"])
        for n, d in H.nodes(data=True):
            w.writerow([n, d["lon"], d["lat"], H.degree(n)])


if __name__ == "__main__":
    main()
