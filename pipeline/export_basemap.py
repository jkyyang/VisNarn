"""Write mainline (NET=M) segments with owner, as input for the mapshaper basemap step."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
fc = json.load(open(ROOT / "data/raw/narn_class1_lines.geojson"))
keep = [{"type": "Feature", "geometry": f["geometry"], "properties": {"owner": f["properties"]["RROWNER1"]}}
        for f in fc["features"] if f["properties"]["NET"] == "M" and f["geometry"]]
json.dump({"type": "FeatureCollection", "features": keep}, open(ROOT / "data/processed/mainline_full.geojson", "w"))
print(len(keep), "mainline segments")
