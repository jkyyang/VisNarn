"""Write the network's mainline (NET=M) edges with owner and class, as input for the mapshaper basemap step.

The edges are those of rail_graph.pkl, so the map draws the track the planner routes on. `class` is the track
box that lets a route use the edge (web/map/layers.ts draws a class only while its box is ticked):
  passenger    owned by a passenger agency: used only with Passenger ticked, whoever else may run on it
  class_i      a Class I railroad may run on it (always used)
  regional     otherwise, a regional railroad may run on it
  short_line   otherwise
"""
import json
import pickle
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "pipeline"))
from railroad_classes import CLASS1, PASSENGER  # noqa: E402


def line_class(d) -> str:
    if d["owner"] in PASSENGER:
        return "passenger"
    if d["carriers"] & set(CLASS1):
        return "class_i"
    return "regional" if "regional" in d["carriers"] else "short_line"


G = pickle.load(open(ROOT / "data/processed/rail_graph.pkl", "rb"))
keep = [{"type": "Feature", "geometry": {"type": "LineString", "coordinates": d["geom"]},
         "properties": {"owner": d["owner"], "class": line_class(d)}}
        for *_, d in G.edges(data=True) if d["net"] == "M"]
json.dump({"type": "FeatureCollection", "features": keep}, open(ROOT / "data/processed/mainline_full.geojson", "w"))
print(len(keep), "mainline segments")
