"""Build a routing graph from the downloaded NARN freight lines.

Nodes: FRA node IDs (FRFRANODE / TOFRANODE), positioned at segment endpoints.
Edges: line segments, weight = KM; `carriers` = who may run trains on the segment (owners and trackage-rights
holders): each Class I by name, plus "regional" and "short line" for smaller freight railroads (see
railroad_classes.py). Passenger agencies are not carriers, so track only they may use is left out.
Parallel segments keep the shortest one, but the edge stores its FRAARCID and full geometry for drawing paths later.
Outputs (data/processed/):
  rail_graph.pkl       networkx Graph (largest connected component)
  rail_nodes.csv       node_id, lon, lat, degree  (used for snapping)
"""
import csv
import json
import pickle
import sys
from pathlib import Path

import networkx as nx

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "pipeline"))
from railroad_classes import CLASS1, class_of  # noqa: E402
# owners + trackage-rights holders = railroads allowed to run trains on the segment
CARRIER_COLS = ["RROWNER1", "RROWNER2", "RROWNER3"] + [f"TRKRGHTS{i}" for i in range(1, 10)]


def carriers_of(p) -> set:
    """Class I names, "regional" and "short line": who may run freight trains on this segment."""
    carriers = set()
    for code in filter(None, (p.get(k) for k in CARRIER_COLS)):
        kind = class_of(code)
        if kind != "passenger":
            carriers.add(code if kind == "class1" else kind)
    return carriers


def keep_class1_network(G):
    """Class I track counts only where it joins the main Class I network on Class I track. A Class I fragment
    that short lines connect to the network would otherwise be a dead end a place could snap to."""
    class1 = G.edge_subgraph((a, b) for a, b, d in G.edges(data=True) if d["carriers"] & set(CLASS1))
    network = max(nx.connected_components(class1), key=len)
    for a, b, d in list(G.edges(data=True)):
        if a not in network:
            d["carriers"] -= set(CLASS1)
            if not d["carriers"]:
                G.remove_edge(a, b)


def main():
    features = json.loads((ROOT / "data/raw/narn_class1_lines.geojson").read_text())["features"]
    # Mexican railroads are outside the US/Canada classes, so Mexico keeps only its Class I (CPKC) track.
    features += [f for f in json.loads((ROOT / "data/raw/narn_other_lines.geojson").read_text())["features"]
                 if f["properties"]["COUNTRY"] != "MX"]
    G = nx.Graph()
    skipped = 0
    for f in features:
        p, g = f["properties"], f["geometry"]
        carriers = carriers_of(p)
        if not g or p["FRFRANODE"] is None or p["TOFRANODE"] is None or not carriers:
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

    keep_class1_network(G)
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
