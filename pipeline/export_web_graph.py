"""Pack the rail graph into compact binaries for the route planner (engine/), which the server runs.

public/data/graph.bin layout (little-endian):
  header: uint32 n_nodes, uint32 n_edges
  float32[n_nodes*2] lon,lat      uint8[n_nodes] mainline railroad mask
  uint32[n_edges] u   uint32[n_edges] v   float32[n_edges] km
  uint8[n_edges] line mask (one bit per LINES entry)   uint16[n_edges] subdivision index
  uint16[n_edges] heading leaving u (degrees, 0 = north)   uint16[n_edges] heading leaving v
  uint8[n_edges] flags (bit 0 = yard track, bit 1 = owned by a passenger agency)
Headings are measured over the first ~0.2 km of track geometry, so the router can tell a
through move or a gentle diverging move from a reversal (trains can't reverse at a switch).
public/data/graph_meta.json: line bit order ("lines"), subdivision names, FRA node ids; places.py adds the places.

public/data/track.bin: each edge's surveyed line, for drawing a route on the real track (engine/track.ts):
  uint32 n_edges   uint32[n_edges+1] index of each edge's first point   float32[n_points*2] lon,lat
Only the points between an edge's two nodes, from u toward v, thinned to within SHAPE_M of the NARN line.
"""
import json
import math
import pickle
import sys
from pathlib import Path

import numpy as np
import shapely
from shapely.geometry import LineString

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "pipeline"))
from railroad_classes import LINES, PASSENGER  # noqa: E402

BIT = {c: 1 << i for i, c in enumerate(LINES)}

YARD = 1
PASSENGER_OWNED = 2
HEADING_KM = 0.2
SHAPE_M = 2.0


def heading(p, q):
    """Initial compass bearing p -> q in whole degrees."""
    lon1, lat1, lon2, lat2 = map(math.radians, (*p, *q))
    y = math.sin(lon2 - lon1) * math.cos(lat2)
    x = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(lon2 - lon1)
    return int(round(math.degrees(math.atan2(y, x)))) % 360


def leaving_heading(coords):
    """Heading leaving coords[0], toward the first point about HEADING_KM along the line."""
    x0, y0 = coords[0]
    for x, y in coords[1:]:
        if math.hypot((x - x0) * math.cos(math.radians(y0)), y - y0) * 111.2 >= HEADING_KM:
            return heading((x0, y0), (x, y))
    return heading(coords[0], coords[-1])


def points_between(coords):
    """The line's points between its two ends, dropping those within SHAPE_M of the line without them."""
    c = math.cos(math.radians(coords[0][1]))  # metres the same both ways, for the tolerance
    line = shapely.simplify(LineString([(x * c, y) for x, y in coords]), SHAPE_M / 111_320)
    return [(x / c, y) for x, y in line.coords[1:-1]]


G = pickle.load(open(ROOT / "data/processed/rail_graph.pkl", "rb"))
ids = list(G.nodes)
idx = {n: i for i, n in enumerate(ids)}
lonlat = np.array([(G.nodes[n]["lon"], G.nodes[n]["lat"]) for n in ids], np.float32)
main = np.zeros(len(ids), np.uint8)
subdivs, sidx = [""], {"": 0}
E = G.number_of_edges()
u, v = np.zeros(E, np.uint32), np.zeros(E, np.uint32)
km, mask, sd = np.zeros(E, np.float32), np.zeros(E, np.uint8), np.zeros(E, np.uint16)
head_u, head_v, flags = np.zeros(E, np.uint16), np.zeros(E, np.uint16), np.zeros(E, np.uint8)
shape_first, shape_points = [0], []
for i, (a, b, d) in enumerate(G.edges(data=True)):
    m = sum(BIT[c] for c in d["carriers"])
    u[i], v[i], km[i], mask[i] = idx[a], idx[b], d["km"], m
    s = (d.get("subdiv") or "").strip()
    if s not in sidx:
        sidx[s] = len(subdivs); subdivs.append(s)
    sd[i] = sidx[s]
    # build_graph stores geometry from min(node id) to max(node id); orient it a -> b.
    coords = d["geom"] if a < b else d["geom"][::-1]
    head_u[i], head_v[i] = leaving_heading(coords), leaving_heading(coords[::-1])
    shape_points += points_between(coords)
    shape_first.append(len(shape_points))
    passenger = d["owner"] in PASSENGER
    flags[i] = (YARD if d["net"] == "Y" else 0) | (PASSENGER_OWNED if passenger else 0)
    if d["net"] == "M":
        main[idx[a]] |= m; main[idx[b]] |= m
out = ROOT / "public/data"
with open(out / "graph.bin", "wb") as fh:
    fh.write(np.array([len(ids), E], np.uint32).tobytes())
    for arr in (lonlat, main):
        fh.write(arr.tobytes())
    pad = (-fh.tell()) % 4                  # keep uint32 arrays 4-byte aligned
    fh.write(b"\0" * pad)
    for arr in (u, v, km, mask, sd, head_u, head_v, flags):
        fh.write(arr.tobytes())
with open(out / "track.bin", "wb") as fh:
    fh.write(np.array([E, *shape_first], np.uint32).tobytes())
    fh.write(np.array(shape_points, np.float32).tobytes())
json.dump({"lines": LINES, "pad": pad, "subdivs": subdivs, "fra_ids": ids},
          open(out / "graph_meta.json", "w"), separators=(",", ":"))
print(len(ids), "nodes", E, "edges", len(subdivs), "subdivisions, pad", pad, len(shape_points), "track shape points")
